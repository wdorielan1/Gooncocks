/*
 * Record math for the Record Room. Every record is defined once here and
 * calculated from the normalized history (data.js); the featured cards, the
 * record book, the spotlight, the challenger rankings and shared summaries
 * all read these results. No page code in this file.
 *
 * Rules:
 *  - Only completed games with both scores count (no byes, no scheduled
 *    games). Consolation games never count toward any record.
 *  - Game-type filter: "regular" = regular season, "playoff" = championship
 *    playoffs, "both" = the two together.
 *  - Closest victory is the smallest positive margin; ties are excluded.
 *  - Combined score counts each matchup once.
 *  - Ties break winning and losing streaks. Streaks can run across seasons
 *    and say so.
 *  - Championships come from Yahoo's final standings for finished seasons.
 *  - Goon / Cock of the Week: the top / bottom score of each completed
 *    regular-season week; exact ties share the award. Only 2026 awards were
 *    actually issued (paid); earlier ones are rebuilt from the scores.
 *  - Season totals and averages use completed seasons only.
 *  - Scoring eras: a season whose league-wide regular-season average is more
 *    than 25% above the typical (median) season is marked high-scoring; its
 *    scoring rules must have differed. "Standard scoring only" leaves those
 *    seasons out of game-based records (not championships or award counts).
 *  - Streaks stop at gaps: a season missing from the data, or (outside the
 *    playoffs-only view) a season that manager didn't play.
 */
(function (root) {
  var EPS = 0.005;
  var ISSUED_FROM = 2026; // first season Goon of the Week was actually awarded

  function chrono(a, b) { return (a.season - b.season) || (a.week - b.week) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function fmt(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(w, l, t) { var n = w + l + t; return n ? (w + t / 2) / n : null; }
  function pctText(p) { return p == null ? '—' : p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''); }

  /* ---------- shared, computed once per dataset ---------- */
  function context(data) {
    if (data._records) return data._records;
    var finals = data.matchups.filter(function (g) {
      return g.status === 'final' && g.gameType !== 'consolation' && typeof g.scoreA === 'number' && typeof g.scoreB === 'number';
    }).sort(chrono);
    var seasons = [];
    finals.forEach(function (g) { if (seasons.indexOf(g.season) < 0) seasons.push(g.season); });
    var last = seasons[seasons.length - 1];
    function finished(season) {
      var st = data.standings && data.standings[season];
      return st ? !!st.finished : season < last;
    }
    // Goon / Cock of the Week from every completed regular-season week.
    var weeks = {};
    data.matchups.forEach(function (g) {
      if (g.gameType !== 'regular') return;
      (weeks[g.season + ':' + g.week] = weeks[g.season + ':' + g.week] || []).push(g);
    });
    var awards = [];
    Object.keys(weeks).forEach(function (k) {
      var games = weeks[k];
      if (!games.every(function (g) { return g.status === 'final'; })) return;
      var scores = [];
      games.forEach(function (g) { scores.push([g.managerA, g.scoreA, g], [g.managerB, g.scoreB, g]); });
      var hi = Math.max.apply(null, scores.map(function (s) { return s[1]; }));
      var lo = Math.min.apply(null, scores.map(function (s) { return s[1]; }));
      var season = games[0].season, week = games[0].week;
      ['goon', 'cock'].forEach(function (type) {
        var target = type === 'goon' ? hi : lo;
        var winners = scores.filter(function (s) { return s[1] === target; });
        awards.push({ type: type, season: season, week: week, score: target, issued: season >= ISSUED_FROM,
                      winners: winners.map(function (s) { return s[0]; }), games: winners.map(function (s) { return s[2]; }) });
      });
    });
    awards.sort(chrono);

    // Scoring eras, from each season's average regular-season score.
    var avgs = {};
    seasons.forEach(function (s) {
      var sc = [];
      finals.forEach(function (g) { if (g.season === s && g.gameType === 'regular') sc.push(g.scoreA, g.scoreB); });
      if (sc.length) avgs[s] = sc.reduce(function (a, b) { return a + b; }, 0) / sc.length;
    });
    var sorted = Object.keys(avgs).map(function (k) { return avgs[k]; }).sort(function (a, b) { return a - b; });
    var median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    var eras = {};
    Object.keys(avgs).forEach(function (s) { eras[s] = { avg: avgs[s], high: median && avgs[s] > median * 1.25 }; });

    data._records = { data: data, finals: finals, seasons: seasons, last: last, finished: finished, awards: awards,
                      eras: eras, medianAvg: median };
    return data._records;
  }

  function teamOf(ctx, season, id) { return ((ctx.data.teams || {})[season] || {})[id] || ''; }
  function inSeason(f, season) { return f.season === 'all' || season === Number(f.season); }
  function games(ctx, f) {
    return ctx.finals.filter(function (g) {
      if (!inSeason(f, g.season)) return false;
      if (f.standard && ctx.eras[g.season] && ctx.eras[g.season].high) return false;
      if (f.type === 'regular') return g.gameType === 'regular';
      if (f.type === 'playoff') return g.gameType === 'playoff';
      return true;
    });
  }
  function side(g, id) {
    var mine = g.managerA === id ? g.scoreA : g.scoreB, theirs = g.managerA === id ? g.scoreB : g.scoreA;
    return { id: id, opp: g.managerA === id ? g.managerB : g.managerA, score: mine, oppScore: theirs,
             result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T', margin: Math.abs(mine - theirs) };
  }
  function winnerSide(g) { return g.scoreA > g.scoreB ? side(g, g.managerA) : g.scoreB > g.scoreA ? side(g, g.managerB) : null; }
  function loserSide(g) { return g.scoreA < g.scoreB ? side(g, g.managerA) : g.scoreB < g.scoreA ? side(g, g.managerB) : null; }
  function gameLabel(g) {
    if (g.gameType === 'regular') return 'Week ' + g.week;
    return (g.round || 'Playoffs') + ' · Week ' + g.week;
  }
  function when(g) { return g.season + ' · ' + gameLabel(g); }

  // Entry helpers. Every entry: { holders, value, mark, when, time, kind, ... }
  function gameEntry(g, s, value, mark, extra) {
    return Object.assign({ kind: 'game', holders: [s.id], value: value, mark: mark, when: when(g), time: g.season * 100 + g.week,
                           season: g.season, week: g.week, game: g, side: s }, extra || {});
  }

  function highSeason(ctx, season) { return !!(ctx.eras[season] && ctx.eras[season].high); }

  function seasonLines(ctx, f, opts) {
    var byKey = {};
    games(ctx, f).forEach(function (g) {
      [g.managerA, g.managerB].forEach(function (id) {
        var k = g.season + ':' + id, s = side(g, id);
        var ln = byKey[k] = byKey[k] || { id: id, season: g.season, pts: 0, n: 0, w: 0, l: 0, t: 0, games: [] };
        ln.pts += s.score; ln.n += 1; ln[s.result === 'W' ? 'w' : s.result === 'L' ? 'l' : 't'] += 1;
        ln.games.push({ g: g, s: s });
      });
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; })
      .filter(function (ln) { return !opts || !opts.completedOnly || ctx.finished(ln.season); });
  }
  function seasonEntry(ctx, ln, value, mark) {
    return { kind: 'season', holders: [ln.id], value: value, mark: mark, when: String(ln.season), time: ln.season * 100 + 99,
             season: ln.season, line: ln, team: teamOf(ctx, ln.season, ln.id) };
  }

  function streaks(ctx, f, want) {
    var byId = {};
    games(ctx, f).forEach(function (g) {
      [g.managerA, g.managerB].forEach(function (id) { (byId[id] = byId[id] || []).push({ g: g, s: side(g, id) }); });
    });
    // "Ongoing" is judged against each manager's most recent game of this type in the whole history.
    var latest = {};
    games(ctx, { season: 'all', type: f.type }).forEach(function (g) { latest[g.managerA] = g; latest[g.managerB] = g; });
    var out = [];
    Object.keys(byId).forEach(function (id) {
      var list = byId[id], run = [], prevSeason = null;
      function close() {
        if (!run.length) return;
        var a = run[0].g, b = run[run.length - 1].g;
        out.push({ kind: 'streak', holders: [id], value: run.length, mark: run.length + (run.length === 1 ? ' game' : ' games'),
                   when: a.season === b.season ? a.season + ' · Wk ' + a.week + '–' + b.week : a.season + ' Wk ' + a.week + ' – ' + b.season + ' Wk ' + b.week,
                   time: b.season * 100 + b.week, season: b.season, start: a, end: b, run: run.slice(),
                   crossesSeasons: a.season !== b.season, ongoing: latest[id] === b });
        run = [];
      }
      list.forEach(function (x) {
        if (prevSeason !== null && x.g.season !== prevSeason && gap(ctx, prevSeason, x.g.season, f.type)) close();
        prevSeason = x.g.season;
        if (x.s.result === want) run.push(x); else close();
      });
      close();
    });
    return out;
  }

  // A streak can't be carried over a season missing from the data, or (for
  // regular-season streaks) over a season the manager sat out.
  function gap(ctx, from, to, type) {
    for (var s = from + 1; s < to; s++) {
      if (ctx.seasons.indexOf(s) < 0) return true;
      if (type !== 'playoff') return true;
    }
    return false;
  }

  function totals(ctx, f, events, label) {
    var by = {};
    events.forEach(function (e) { e.holders.forEach(function (id) { (by[id] = by[id] || []).push(e); }); });
    return Object.keys(by).map(function (id) {
      var ev = by[id];
      return { kind: 'total', holders: [id], value: ev.length, mark: String(ev.length), when: f.season === 'all' ? 'Career' : String(f.season),
               time: 0, events: ev, label: label };
    });
  }
  function awardEvents(ctx, f, type) {
    return ctx.awards.filter(function (a) { return a.type === type && inSeason(f, a.season); }).map(function (a) {
      return { holders: a.winners, season: a.season, week: a.week, score: a.score, issued: a.issued, shared: a.winners.length > 1, games: a.games };
    });
  }
  function titleEvents(ctx, f) {
    var out = [], st = ctx.data.standings || {};
    Object.keys(st).map(Number).sort(function (a, b) { return a - b; }).forEach(function (s) {
      if (!st[s].finished || !inSeason(f, s)) return;
      Object.keys(st[s].ranks).forEach(function (id) {
        if (st[s].ranks[id] === 1) out.push({ holders: [id], season: s, team: teamOf(ctx, s, id) });
      });
    });
    return out;
  }

  /* ---------- the 18 records ---------- */
  var RECORDS = [
    { id: 'high-week', name: 'Highest weekly score', cat: 'scoring', core: true, dir: 'desc', unit: 'points',
      def: 'The most points one manager scored in a single game.', applies: { season: true, type: true },
      entries: function (ctx, f) { var o = []; games(ctx, f).forEach(function (g) { [g.managerA, g.managerB].forEach(function (id) { var s = side(g, id); o.push(gameEntry(g, s, s.score, fmt(s.score))); }); }); return o; } },
    { id: 'big-margin', name: 'Biggest winning margin', short: 'Biggest blowout', cat: 'wins', core: true, dir: 'desc', unit: 'point margin',
      def: 'The largest margin of victory in a single game.', applies: { season: true, type: true },
      entries: function (ctx, f) { return games(ctx, f).map(function (g) { var w = winnerSide(g); return w && gameEntry(g, w, w.margin, '+' + fmt(w.margin)); }).filter(Boolean); } },
    { id: 'close-win', name: 'Closest victory', short: 'Closest finish', cat: 'wins', core: true, dir: 'asc', unit: 'point margin',
      def: 'The smallest positive margin of victory. Tied games are left out.', applies: { season: true, type: true },
      entries: function (ctx, f) { return games(ctx, f).map(function (g) { var w = winnerSide(g); return w && gameEntry(g, w, w.margin, fmt(w.margin)); }).filter(Boolean); } },
    { id: 'win-streak', name: 'Longest winning streak', cat: 'streaks', core: true, dir: 'desc', unit: 'straight wins',
      def: 'Most wins in a row. A loss or tie ends it; consolation games are skipped.', applies: { season: true, type: true },
      entries: function (ctx, f) { return streaks(ctx, f, 'W'); } },
    { id: 'titles', name: 'Most championships', cat: 'hardware', core: true, dir: 'desc', unit: 'championships', total: true,
      def: 'League titles, from each finished season’s final Yahoo standings.', applies: { season: true, type: false },
      entries: function (ctx, f) { return totals(ctx, f, titleEvents(ctx, f), 'Championships'); } },
    { id: 'goon-total', name: 'Most Goon awards', cat: 'hardware', core: true, dir: 'desc', unit: 'Goon of the Week awards', total: true,
      def: 'Goon of the Week: the top score of a completed regular-season week. Ties share it.', applies: { season: true, type: false },
      entries: function (ctx, f) { return totals(ctx, f, awardEvents(ctx, f, 'goon'), 'Goon of the Week'); } },
    { id: 'season-points', name: 'Most points in a season', cat: 'scoring', core: true, dir: 'desc', unit: 'points',
      def: 'Total points in one completed season, for the selected game type.', applies: { season: true, type: true },
      entries: function (ctx, f) { return seasonLines(ctx, f, { completedOnly: true }).map(function (ln) { return seasonEntry(ctx, ln, ln.pts, fmt(ln.pts)); }); } },
    { id: 'combined', name: 'Highest combined score', cat: 'scoring', core: true, dir: 'desc', unit: 'combined points',
      def: 'Both teams’ scores added together in one matchup, counted once per game.', applies: { season: true, type: true },
      entries: function (ctx, f) { return games(ctx, f).map(function (g) { var t = g.scoreA + g.scoreB; var e = gameEntry(g, side(g, g.managerA), t, fmt(t)); e.holders = [g.managerA, g.managerB]; e.pair = true; return e; }); } },
    { id: 'cock-total', name: 'Most Cock awards', cat: 'hardware', core: true, unwanted: true, dir: 'desc', unit: 'Cock of the Week awards', total: true,
      def: 'Cock of the Week: the lowest score of a completed regular-season week. Ties share it.', applies: { season: true, type: false },
      entries: function (ctx, f) { return totals(ctx, f, awardEvents(ctx, f, 'cock'), 'Cock of the Week'); } },
    { id: 'low-week', name: 'Lowest weekly score', cat: 'scoring', core: true, unwanted: true, dir: 'asc', unit: 'points',
      def: 'The fewest points one manager scored in a single completed game.', applies: { season: true, type: true },
      entries: function (ctx, f) { var o = []; games(ctx, f).forEach(function (g) { [g.managerA, g.managerB].forEach(function (id) { var s = side(g, id); o.push(gameEntry(g, s, s.score, fmt(s.score))); }); }); return o; } },
    { id: 'lose-streak', name: 'Longest losing streak', cat: 'streaks', core: true, unwanted: true, dir: 'desc', unit: 'straight losses',
      def: 'Most losses in a row. A win or tie ends it; consolation games are skipped.', applies: { season: true, type: true },
      entries: function (ctx, f) { return streaks(ctx, f, 'L'); } },
    // Additional records
    { id: 'loss-points', name: 'Most points in a loss', cat: 'scoring', dir: 'desc', unit: 'points',
      def: 'The highest score that still lost.', applies: { season: true, type: true },
      entries: function (ctx, f) { return games(ctx, f).map(function (g) { var l = loserSide(g); return l && gameEntry(g, l, l.score, fmt(l.score)); }).filter(Boolean); } },
    { id: 'win-points', name: 'Fewest points in a win', cat: 'scoring', dir: 'asc', unit: 'points',
      def: 'The lowest score that still won.', applies: { season: true, type: true },
      entries: function (ctx, f) { return games(ctx, f).map(function (g) { var w = winnerSide(g); return w && gameEntry(g, w, w.score, fmt(w.score)); }).filter(Boolean); } },
    { id: 'season-avg', name: 'Highest scoring average in a season', cat: 'scoring', dir: 'desc', unit: 'points per game',
      def: 'Points per game over one completed season (at least 10 games; 2 for playoffs only).', applies: { season: true, type: true },
      entries: function (ctx, f) { var min = f.type === 'playoff' ? 2 : 10; return seasonLines(ctx, f, { completedOnly: true }).filter(function (ln) { return ln.n >= min; }).map(function (ln) { return seasonEntry(ctx, ln, ln.pts / ln.n, fmt(ln.pts / ln.n)); }); } },
    { id: 'season-pct', name: 'Best regular-season win %', cat: 'wins', dir: 'desc', unit: 'win percentage',
      def: 'Best regular-season record in a completed season (ties count as half a win).', applies: { season: true, type: false },
      entries: function (ctx, f) { return seasonLines(ctx, { season: f.season, type: 'regular' }, { completedOnly: true }).map(function (ln) { var p = pct(ln.w, ln.l, ln.t); var e = seasonEntry(ctx, ln, p + ln.w / 1e4, pctText(p)); e.pctValue = p; e.mark = pctText(p) + ' (' + ln.w + '-' + ln.l + (ln.t ? '-' + ln.t : '') + ')'; return e; }); } },
    { id: 'consec-titles', name: 'Most consecutive championships', cat: 'hardware', dir: 'desc', unit: 'titles in a row',
      def: 'Championships won in back-to-back seasons.', applies: { season: false, type: false },
      entries: function (ctx) {
        var ev = titleEvents(ctx, { season: 'all' }), by = {}, out = [];
        ev.forEach(function (e) { (by[e.holders[0]] = by[e.holders[0]] || []).push(e); });
        Object.keys(by).forEach(function (id) {
          var run = [];
          function close() { if (run.length) out.push({ kind: 'titlerun', holders: [id], value: run.length, mark: String(run.length), when: run.length > 1 ? run[0].season + '–' + run[run.length - 1].season : String(run[0].season), time: run[run.length - 1].season * 100 + 99, season: run[run.length - 1].season, events: run.slice() }); run = []; }
          by[id].forEach(function (e) { if (run.length && e.season !== run[run.length - 1].season + 1) close(); run.push(e); });
          close();
        });
        return out;
      } },
    { id: 'goon-season', name: 'Most Goon awards in a season', cat: 'hardware', dir: 'desc', unit: 'Goon of the Week awards',
      def: 'Goon of the Week awards won within one season.', applies: { season: true, type: false },
      entries: function (ctx, f) { return seasonAwardEntries(ctx, f, 'goon'); } },
    { id: 'cock-season', name: 'Most Cock awards in a season', cat: 'hardware', dir: 'desc', unit: 'Cock of the Week awards',
      def: 'Cock of the Week awards within one season.', applies: { season: true, type: false },
      entries: function (ctx, f) { return seasonAwardEntries(ctx, f, 'cock'); } }
  ];
  function seasonAwardEntries(ctx, f, type) {
    var by = {};
    awardEvents(ctx, f, type).forEach(function (e) {
      e.holders.forEach(function (id) { var k = e.season + ':' + id; (by[k] = by[k] || { id: id, season: e.season, events: [] }).events.push(e); });
    });
    return Object.keys(by).map(function (k) {
      var x = by[k];
      return { kind: 'awardseason', holders: [x.id], value: x.events.length, mark: String(x.events.length), when: String(x.season) + (ctx.finished(x.season) ? '' : ' (in progress)'),
               time: x.season * 100 + 99, season: x.season, events: x.events, team: teamOf(ctx, x.season, x.id) };
    });
  }
  var BY_ID = {};
  RECORDS.forEach(function (r) { BY_ID[r.id] = r; });

  /* ---------- ranking, holders, challengers, previous holder ---------- */
  function sameValue(a, b) { return Math.abs(a - b) <= EPS / 10; }
  function compute(data, recordId, f) {
    var ctx = context(data), rec = BY_ID[recordId];
    var entries = rec.entries(ctx, f);
    var sign = rec.dir === 'asc' ? 1 : -1;
    entries.sort(function (a, b) { return sign * (a.value - b.value) || (a.time - b.time); });
    if (rec.total) {
      // Career totals: one row per manager; ties share the lead.
      entries = entries.filter(function (e) { return e.value > 0; });
    }
    var res = { record: rec, filters: f, entries: entries, holders: [], top: [], previous: null };
    if (!entries.length) return res;
    var best = entries[0].value;
    res.holders = entries.filter(function (e) { return sameValue(e.value, best); });
    // Top five, keeping any tie with fifth place visible.
    var top = entries.slice(0, 5);
    while (top.length < entries.length && sameValue(entries[top.length].value, top[top.length - 1].value)) top.push(entries[top.length]);
    res.top = top;
    res.previous = previousHolder(rec, entries);
    return res;
  }

  // Walk the entries in time order; each strict improvement sets a new
  // record. The previous holder is whoever held it before the current
  // record was first reached. Career totals have no single moment, so none.
  function previousHolder(rec, entries) {
    if (rec.total) return { kind: 'na' };
    var byTime = entries.slice().sort(function (a, b) { return a.time - b.time; });
    var better = rec.dir === 'asc' ? function (a, b) { return a < b - EPS / 10; } : function (a, b) { return a > b + EPS / 10; };
    var setters = [];
    byTime.forEach(function (e) {
      if (!setters.length || better(e.value, setters[setters.length - 1].value)) setters.push(e);
    });
    if (setters.length < 2) return { kind: 'first', entry: setters[0] };
    return { kind: 'previous', entry: setters[setters.length - 2], current: setters[setters.length - 1] };
  }

  function scopeText(rec, f) {
    var parts = [];
    var eraApplies = rec.applies.type || rec.id === 'season-pct';
    if (rec.applies.season) parts.push(f.season === 'all' ? 'All seasons' : String(f.season));
    else parts.push('All seasons (season filter doesn’t apply)');
    if (rec.applies.type) parts.push(f.type === 'regular' ? 'Regular season' : f.type === 'playoff' ? 'Playoffs' : 'Regular season + playoffs');
    else if (rec.id === 'titles' || rec.id === 'consec-titles') parts.push('Final standings');
    else parts.push('Regular-season weeks');
    if (f.standard && eraApplies) parts.push('Standard-scoring seasons only');
    return parts.join(' · ');
  }

  root.Records = {
    list: RECORDS, byId: BY_ID, compute: compute, context: context, scopeText: scopeText, gameLabel: gameLabel, when: when,
    side: side, fmt: fmt, pctText: pctText, teamOf: teamOf, highSeason: highSeason, ISSUED_FROM: ISSUED_FROM
  };
})(typeof window !== 'undefined' ? window : globalThis);
