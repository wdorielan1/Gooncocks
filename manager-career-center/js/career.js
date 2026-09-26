/*
 * Career math for the Manager Career Center. Pure functions over the
 * normalized history from data.js (no page code), so the leaderboard,
 * profiles and comparisons all read the same numbers.
 *
 * Rules:
 *  - Only completed ("final") games count; scheduled games are ignored.
 *  - Regular season, championship playoffs and consolation games are kept
 *    apart. Playoff records exclude consolation games. A tie (identical
 *    scores) is a tie, and counts as half a win in win percentages.
 *  - Championships, runner-ups and third places come from Yahoo's final
 *    standings for finished seasons, never from inferring bracket results.
 *  - Goon / Cock of the Week: the highest / lowest score of each completed
 *    regular-season week. Exact ties share the award (and split its payout).
 *  - Winnings are estimated from data/payouts.js and final standings.
 */
(function (root) {
  var MIN_GAMES_ALL = 40;     // win-% leader across all seasons
  var MIN_GAMES_SEASON = 10;  // win-% leader within one season

  function chrono(a, b) { return (a.season - b.season) || (a.week - b.week) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
  function inScope(season, scope) { return scope === 'all' || season === Number(scope); }
  function involves(g, id) { return g.managerA === id || g.managerB === id; }
  function side(g, id) {
    var mine = g.managerA === id ? g.scoreA : g.scoreB;
    var theirs = g.managerA === id ? g.scoreB : g.scoreA;
    return { mine: mine, theirs: theirs, opp: g.managerA === id ? g.managerB : g.managerA,
             result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T', margin: Math.abs(mine - theirs) };
  }
  function pct(w, l, t) { var n = w + l + t; return n ? (w + t / 2) / n : null; }
  function roundLabel(g) {
    if (g.gameType === 'regular') return 'Regular season';
    if (g.gameType === 'consolation') return 'Consolation';
    return g.round ? 'Playoffs · ' + g.round : 'Playoffs';
  }

  /* ---------- league-wide pieces, computed once per dataset ---------- */

  function index(data) {
    if (data._career) return data._career;
    var finals = data.matchups.filter(function (g) { return g.status === 'final'; }).sort(chrono);
    var byWeek = {};
    data.matchups.forEach(function (g) {
      if (g.gameType !== 'regular') return;
      var k = g.season + ':' + g.week;
      (byWeek[k] = byWeek[k] || []).push(g);
    });
    // Goon / Cock of the Week, for every regular-season week with every game final.
    var awards = [];
    Object.keys(byWeek).forEach(function (k) {
      var games = byWeek[k];
      if (!games.every(function (g) { return g.status === 'final'; })) return;
      var scores = [];
      games.forEach(function (g) { scores.push([g.managerA, g.scoreA], [g.managerB, g.scoreB]); });
      var hi = Math.max.apply(null, scores.map(function (s) { return s[1]; }));
      var lo = Math.min.apply(null, scores.map(function (s) { return s[1]; }));
      var season = games[0].season, week = games[0].week;
      awards.push({ type: 'goon', season: season, week: week, score: hi,
                    winners: scores.filter(function (s) { return s[1] === hi; }).map(function (s) { return s[0]; }) });
      awards.push({ type: 'cock', season: season, week: week, score: lo,
                    winners: scores.filter(function (s) { return s[1] === lo; }).map(function (s) { return s[0]; }) });
    });
    awards.sort(chrono);
    var seasons = {};
    finals.forEach(function (g) { seasons[g.season] = true; });
    data._career = { finals: finals, awards: awards, seasons: Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; }) };
    return data._career;
  }

  function seasons(data) { return index(data).seasons.slice(); }

  function payoutRules(data, season) {
    var cfg = data.payouts;
    if (!cfg) return null;
    var base = cfg.seasons && cfg.seasons[season] ? cfg.seasons[season] : cfg.DEFAULT;
    if (!base) return null;
    var st = data.standings[season];
    var teams = st && st.teams ? st.teams : Object.keys(data.teams[season] || {}).length;
    var r = { buyIn: base.buyIn, confirmed: !!base.confirmed, goonWeekly: base.goonWeekly || 0, teams: teams };
    if (base.first != null) {
      r.first = base.first; r.second = base.second || 0; r.third = base.third || 0;
    } else {
      r.second = 2 * base.buyIn;
      r.third = base.buyIn;
      r.first = teams * base.buyIn - r.second - r.third;
    }
    return r;
  }

  /* ---------- one manager, one season ---------- */

  function seasonLine(data, id, season) {
    var idx = index(data);
    var games = idx.finals.filter(function (g) { return g.season === season && involves(g, id); });
    var st = data.standings[season];
    var rank = st && st.ranks[id] != null ? st.ranks[id] : null;
    var lastSeason = index(data).seasons[index(data).seasons.length - 1];
    // Without Yahoo's standings a past season's finish is unknown, not "in progress".
    var finished = st ? !!st.finished : season < lastSeason;
    var line = {
      season: season, team: (data.teams[season] || {})[id] || '',
      reg: { w: 0, l: 0, t: 0, pf: 0, pa: 0, n: 0 }, po: { w: 0, l: 0, t: 0, n: 0 }, co: { w: 0, l: 0, t: 0, n: 0 },
      weeks: [], playoffGames: [], rank: rank, finished: finished, teams: st ? st.teams : null,
      goon: [], cock: [], winnings: null
    };
    games.forEach(function (g) {
      var s = side(g, id);
      var bucket = g.gameType === 'regular' ? line.reg : g.gameType === 'playoff' ? line.po : line.co;
      bucket.n += 1;
      bucket[s.result === 'W' ? 'w' : s.result === 'L' ? 'l' : 't'] += 1;
      if (g.gameType === 'regular') {
        line.reg.pf += s.mine; line.reg.pa += s.theirs;
        line.weeks.push({ week: g.week, score: s.mine, result: s.result, opp: s.opp });
      } else if (g.gameType === 'playoff') {
        line.playoffGames.push({ game: g, side: s });
      }
    });
    idx.awards.forEach(function (a) {
      if (a.season === season && a.winners.indexOf(id) >= 0) line[a.type].push(a);
    });

    // Playoff result, from final standings first.
    if (!games.length) line.result = null;
    else if (!st && finished) line.result = 'Unavailable';
    else if (!finished) line.result = 'In progress';
    else if (rank === 1) line.result = 'Champion';
    else if (rank === 2) line.result = 'Runner-up';
    else if (rank === 3) line.result = 'Third place';
    else if (line.po.n) {
      var loss = line.playoffGames.filter(function (p) { return p.side.result === 'L'; })[0];
      line.result = loss && loss.game.round && loss.game.round !== 'Third Place' ? 'Out in ' + loss.game.round.toLowerCase() : 'Playoffs';
    } else line.result = 'Missed playoffs';

    // Estimated winnings: finish payouts once the season is final, plus Goon payouts.
    var rules = payoutRules(data, season);
    if (rules && games.length && (st || !finished)) {  // no standings for a finished season: finish payouts unknown
      var parts = [];
      if (finished && rank === 1 && rules.first) parts.push({ label: '1st place', amount: rules.first });
      if (finished && rank === 2 && rules.second) parts.push({ label: '2nd place', amount: rules.second });
      if (finished && rank === 3 && rules.third) parts.push({ label: '3rd place (buy-in back)', amount: rules.third });
      if (rules.goonWeekly) {
        var goonCash = line.goon.reduce(function (sum, a) { return sum + rules.goonWeekly / a.winners.length; }, 0);
        if (goonCash) parts.push({ label: line.goon.length + ' Goon of the Week', amount: goonCash });
      }
      var total = parts.reduce(function (sum, p) { return sum + p.amount; }, 0);
      line.winnings = { total: total, buyIn: rules.buyIn, parts: parts, estimated: !rules.confirmed, final: finished };
    }
    return line;
  }

  /* ---------- a manager's career (or one season) ---------- */

  function career(data, id, scope) {
    var idx = index(data);
    var mine = idx.finals.filter(function (g) { return involves(g, id); });
    var allSeasons = [];
    mine.forEach(function (g) { if (allSeasons.indexOf(g.season) < 0) allSeasons.push(g.season); });
    var scoped = allSeasons.filter(function (s) { return inScope(s, scope); });
    var lines = scoped.map(function (s) { return seasonLine(data, id, s); });

    var c = {
      id: id, scope: scope, seasons: scoped, lines: lines,
      firstSeason: allSeasons.length ? allSeasons[0] : null, totalSeasons: allSeasons.length,
      currentTeam: allSeasons.length ? ((data.teams[allSeasons[allSeasons.length - 1]] || {})[id] || '') : '',
      reg: { w: 0, l: 0, t: 0, pf: 0, n: 0 }, po: { w: 0, l: 0, t: 0, n: 0 }, playoffApps: 0,
      titles: [], runnerUps: [], thirds: [], goon: 0, cock: 0,
      winnings: { gross: 0, buyIns: 0, estimated: false, seasons: 0, missing: [] }
    };
    lines.forEach(function (ln) {
      ['w', 'l', 't', 'n'].forEach(function (k) { c.reg[k] += ln.reg[k]; c.po[k] += ln.po[k]; });
      c.reg.pf += ln.reg.pf;
      if (ln.po.n) c.playoffApps += 1;
      if (ln.finished && ln.rank === 1) c.titles.push(ln.season);
      if (ln.finished && ln.rank === 2) c.runnerUps.push(ln.season);
      if (ln.finished && ln.rank === 3) c.thirds.push(ln.season);
      c.goon += ln.goon.length;
      c.cock += ln.cock.length;
      if (ln.winnings) {
        c.winnings.gross += ln.winnings.total;
        c.winnings.buyIns += ln.winnings.buyIn;
        c.winnings.seasons += 1;
        if (ln.winnings.estimated) c.winnings.estimated = true;
      } else {
        c.winnings.missing.push(ln.season);
      }
    });
    c.regPct = pct(c.reg.w, c.reg.l, c.reg.t);
    c.poPct = pct(c.po.w, c.po.l, c.po.t);
    if (!c.winnings.seasons) c.winnings = null;
    else c.winnings.net = c.winnings.gross - c.winnings.buyIns;
    c.bests = bests(data, id, scope, lines);
    return c;
  }

  function bests(data, id, scope, lines) {
    var games = index(data).finals.filter(function (g) {
      return involves(g, id) && g.gameType !== 'consolation' && inScope(g.season, scope);
    });
    var b = { highWeek: null, bigWin: null, closeWin: null, streak: null, bestSeason: null, topSeason: null };
    var run = 0, runStart = null;
    games.forEach(function (g) {
      var s = side(g, id), at = { season: g.season, week: g.week, opp: s.opp, type: roundLabel(g), round: g.round };
      if (!b.highWeek || s.mine > b.highWeek.score) b.highWeek = Object.assign({ score: s.mine }, at);
      if (s.result === 'W') {
        if (!b.bigWin || s.margin > b.bigWin.margin) b.bigWin = Object.assign({ margin: s.margin, score: s.mine, against: s.theirs }, at);
        if (!b.closeWin || s.margin < b.closeWin.margin) b.closeWin = Object.assign({ margin: s.margin, score: s.mine, against: s.theirs }, at);
        run += 1;
        if (run === 1) runStart = at;
        if (!b.streak || run > b.streak.count) b.streak = { count: run, from: runStart, to: at };
      } else {
        run = 0;
      }
    });
    // A season still being played only counts when it's the one selected.
    var done = lines.filter(function (ln) { return ln.finished; });
    (done.length ? done : lines).forEach(function (ln) {
      var p = pct(ln.reg.w, ln.reg.l, ln.reg.t);
      if (ln.reg.n && (!b.bestSeason || p > b.bestSeason.pct || (p === b.bestSeason.pct && ln.reg.n > b.bestSeason.n))) {
        b.bestSeason = { season: ln.season, w: ln.reg.w, l: ln.reg.l, t: ln.reg.t, n: ln.reg.n, pct: p, inProgress: !ln.finished };
      }
      if (ln.reg.n && (!b.topSeason || ln.reg.pf > b.topSeason.pf)) {
        b.topSeason = { season: ln.season, pf: ln.reg.pf, perGame: ln.reg.pf / ln.reg.n, inProgress: !ln.finished };
      }
    });
    return b;
  }

  /* Career milestones, always across the whole career. */
  function milestones(data, id) {
    var idx = index(data), out = [];
    var games = idx.finals.filter(function (g) { return involves(g, id); });
    if (!games.length) return out;
    var first = games[0];
    out.push({ season: first.season, week: first.week, kind: 'debut', title: 'League debut',
               note: (data.teams[first.season] || {})[id] || '' });
    var firstPlayoff = games.filter(function (g) { return g.gameType === 'playoff'; })[0];
    if (firstPlayoff) out.push({ season: firstPlayoff.season, week: firstPlayoff.week, kind: 'playoffs', title: 'First playoff game', note: roundLabel(firstPlayoff) });
    var firstGoon = idx.awards.filter(function (a) { return a.type === 'goon' && a.winners.indexOf(id) >= 0; })[0];
    if (firstGoon) out.push({ season: firstGoon.season, week: firstGoon.week, kind: 'goon', title: 'First Goon of the Week', note: firstGoon.score.toFixed(2) + ' points' });
    var wins = 0;
    games.forEach(function (g) {
      if (g.gameType !== 'regular' || side(g, id).result !== 'W') return;
      wins += 1;
      if (wins % 50 === 0) out.push({ season: g.season, week: g.week, kind: 'wins', title: wins + ' regular-season wins', note: 'Week ' + g.week });
    });
    var titles = 0;
    Object.keys(data.standings).map(Number).sort(function (a, b) { return a - b; }).forEach(function (s) {
      var st = data.standings[s];
      if (!st.finished) return;
      if (st.ranks[id] === 1) {
        titles += 1;
        out.push({ season: s, week: 99, kind: 'title', title: titles === 1 ? 'First championship' : 'Championship No. ' + titles, note: (data.teams[s] || {})[id] || '' });
      } else if (st.ranks[id] === 2) {
        out.push({ season: s, week: 98, kind: 'final', title: 'Reached the final', note: 'Runner-up' });
      }
    });
    var high = null;
    games.forEach(function (g) { if (g.gameType !== 'consolation') { var s = side(g, id); if (!high || s.mine > high.score) high = { score: s.mine, g: g }; } });
    if (high) out.push({ season: high.g.season, week: high.g.week, kind: 'high', title: 'Career-high week', note: high.score.toFixed(2) + ' points' });
    return out.sort(function (a, b) { return (a.season - b.season) || (a.week - b.week); });
  }

  /* ---------- league views ---------- */

  function roster(data, scope) {
    var idx = index(data), seen = {};
    idx.finals.forEach(function (g) {
      if (inScope(g.season, scope)) { seen[g.managerA] = true; seen[g.managerB] = true; }
    });
    return data.managers.filter(function (m) { return seen[m.id]; });
  }

  function leaderboard(data, scope) {
    return roster(data, scope).map(function (m) {
      return { manager: m, c: career(data, m.id, scope) };
    });
  }

  // Leader cards; every tie for first is reported as a joint lead.
  function leaders(rows, scope) {
    function top(list, value) {
      var best = null, who = [];
      list.forEach(function (r) {
        var v = value(r);
        if (v == null) return;
        if (best === null || v > best + 1e-9) { best = v; who = [r]; }
        else if (Math.abs(v - best) <= 1e-9) who.push(r);
      });
      return best === null ? null : { value: best, rows: who };
    }
    var minGames = scope === 'all' ? MIN_GAMES_ALL : MIN_GAMES_SEASON;
    return {
      titles: top(rows, function (r) { return r.c.titles.length || null; }),
      goon: top(rows, function (r) { return r.c.goon || null; }),
      winPct: top(rows.filter(function (r) { return r.c.reg.n >= minGames; }), function (r) { return r.c.regPct; }),
      minGames: minGames
    };
  }

  root.Career = {
    career: career, seasonLine: seasonLine, milestones: milestones, leaderboard: leaderboard, leaders: leaders,
    roster: roster, seasons: seasons, payoutRules: payoutRules, pct: pct, side: side,
    MIN_GAMES_ALL: MIN_GAMES_ALL, MIN_GAMES_SEASON: MIN_GAMES_SEASON
  };
})(typeof window !== 'undefined' ? window : globalThis);
