/*
 * Trade Lab logic with no page code: filtering the trading block, "who
 * needs what", Matchmaker, and the Trade Calculator's numbers. Everything
 * here works from published listings and real weekly scores only - it
 * never treats an unlisted player as available and never invents values.
 */
(function (root) {
  var STATUS_LABEL = { available: 'Available', listening: 'Listening to offers' };

  function norm(s) { return String(s || '').toLowerCase(); }

  // ---------- trading block ----------
  function filterListings(listings, f) {
    var q = norm(f.search).trim();
    var out = listings.filter(function (l) {
      if (f.position && f.position !== 'all' && l.position !== f.position) return false;
      if (f.team && f.team !== 'all' && l.team_key !== f.team) return false;
      if (f.status && f.status !== 'all' && l.status !== f.status) return false;
      if (q && norm(l.name).indexOf(q) < 0 && norm(l.manager).indexOf(q) < 0) return false;
      return true;
    });
    out.sort(f.sort === 'name'
      ? function (a, b) { return a.name.localeCompare(b.name); }
      : function (a, b) { return b.updated_at - a.updated_at || a.name.localeCompare(b.name); });
    return out;
  }

  // Each manager's wanted positions, from their own listings.
  // What each manager is looking for: what they said for their team
  // (teamNeeds: [{team_key, manager, wants, note}]) plus the positions on
  // their listings.
  function needs(listings, teams, teamNeeds) {
    var by = {};
    function row(k, manager) { return by[k] = by[k] || { team_key: k, manager: manager, wants: [], note: '' }; }
    (teamNeeds || []).forEach(function (t) {
      var n = row(t.team_key, t.manager);
      n.note = t.note || '';
      (t.wants || []).forEach(function (w) { if (n.wants.indexOf(w) < 0) n.wants.push(w); });
    });
    listings.forEach(function (l) {
      var n = row(l.team_key, l.manager);
      l.wants.forEach(function (w) { if (n.wants.indexOf(w) < 0) n.wants.push(w); });
    });
    var order = (teams || []).map(function (t) { return t.team_key; });
    return Object.keys(by).map(function (k) { return by[k]; }).filter(function (n) { return n.wants.length || n.note; })
      .sort(function (a, b) { return (order.indexOf(a.team_key) - order.indexOf(b.team_key)) || a.manager.localeCompare(b.manager); });
  }

  function listJoin(items) {
    return items.length < 3 ? items.join(' and ') : items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
  }
  function article(pos) { return /^[AEFHILMNORSX]/.test(pos) ? 'an' : 'a'; }
  function playerList(ls) { return listJoin(ls.map(function (l) { return l.name + ' (' + l.position + ')'; })); }

  // Trade partners for one team, from published listings only. A partner
  // must have a listed player at a position this team wants; it's mutual
  // when this team has a listed player at a position the partner wants.
  function matchmaker(listings, teamKey, teamNeeds) {
    var mine = listings.filter(function (l) { return l.team_key === teamKey; });
    var said = {};
    (teamNeeds || []).forEach(function (t) { said[t.team_key] = t.wants || []; });
    var myWants = (said[teamKey] || []).slice();
    mine.forEach(function (l) { l.wants.forEach(function (w) { if (myWants.indexOf(w) < 0) myWants.push(w); }); });
    var byTeam = {};
    listings.forEach(function (l) { if (l.team_key !== teamKey) (byTeam[l.team_key] = byTeam[l.team_key] || []).push(l); });
    var out = [];
    Object.keys(byTeam).forEach(function (k) {
      var theirs = byTeam[k], manager = theirs[0].manager;
      var theirWants = (said[k] || []).slice();
      theirs.forEach(function (l) { l.wants.forEach(function (w) { if (theirWants.indexOf(w) < 0) theirWants.push(w); }); });
      var canGet = theirs.filter(function (l) { return myWants.indexOf(l.position) >= 0; });
      if (!canGet.length) return;
      var canGive = mine.filter(function (l) { return theirWants.indexOf(l.position) >= 0; });
      var wantedHere = myWants.filter(function (w) { return canGet.some(function (l) { return l.position === w; }); });
      var text = 'You’re looking for ' + article(wantedHere[0]) + ' ' + listJoin(wantedHere) + '. ' + manager + ' has ' +
        playerList(canGet) + ' on the block';
      if (canGive.length) {
        var theyWant = theirWants.filter(function (w) { return canGive.some(function (l) { return l.position === w; }); });
        text += ' and is looking for ' + article(theyWant[0]) + ' ' + listJoin(theyWant) + ', which you have listed: ' + playerList(canGive) + '.';
      } else {
        text += (theirWants.length ? ', but is looking for ' + listJoin(theirWants) + ', and you haven’t listed ' + (theirWants.length > 1 ? 'any of those' : 'one') + '.'
          : '. They haven’t said what they want back.');
      }
      out.push({ team_key: k, manager: manager, mutual: canGive.length > 0, get: canGet, give: canGive, text: text });
    });
    out.sort(function (a, b) { return (b.mutual - a.mutual) || (b.get.length + b.give.length) - (a.get.length + a.give.length) || a.manager.localeCompare(b.manager); });
    return { wants: myWants, listed: mine.length, matches: out };
  }

  // ---------- trade calculator ----------
  // Per-player weekly points from the season's box scores (Yahoo's own
  // league scoring, as recorded in each week's lineups). Players are
  // matched by name and position; weeks a player wasn't on any league
  // roster aren't recorded, so the sample is "weeks on a roster".
  // `live` is the in-progress week (boxscores/live.json): it adds only
  // players whose games have started, and only while that week isn't in
  // the final box scores yet.
  function playerWeeks(boxscores, live) {
    var by = {}, finished = {};
    Object.keys((boxscores && boxscores.games) || {}).forEach(function (id) {
      var m = /-w(\d+)-/.exec(id);
      if (!m) return;
      var week = Number(m[1]), g = boxscores.games[id];
      finished[week] = 1;
      [g.a, g.b].forEach(function (lineup) {
        (lineup || []).forEach(function (p) {
          if (typeof p[4] !== 'number') return;
          var key = norm(p[1]) + '|' + String(p[2] || '').split(',')[0];
          (by[key] = by[key] || {})[week] = p[4];
        });
      });
    });
    if (live && live.teams && live.week && !finished[live.week]) {
      Object.keys(live.teams).forEach(function (t) {
        live.teams[t].forEach(function (p) {
          if (!p[5] || typeof p[4] !== 'number') return;
          var key = norm(p[1]) + '|' + String(p[2] || '').split(',')[0];
          (by[key] = by[key] || {})[live.week] = p[4];
        });
      });
    }
    return by;
  }
  function playerStats(weeksByPlayer, player, recentN) {
    var w = weeksByPlayer[norm(player.name) + '|' + player.position] || {};
    var weeks = Object.keys(w).map(Number).sort(function (a, b) { return a - b; });
    var total = weeks.reduce(function (t, k) { return t + w[k]; }, 0);
    var recent = weeks.slice(-(recentN || 3));
    return {
      games: weeks.length, total: total, ppg: weeks.length ? total / weeks.length : null,
      recent: recent.length ? recent.reduce(function (t, k) { return t + w[k]; }, 0) / recent.length : null,
      recentWeeks: recent, first: weeks[0] || null, last: weeks[weeks.length - 1] || null
    };
  }
  // One player's weekly points for the stats panel: {week: points}, plus his
  // best week.
  function weekLine(weeksByPlayer, player) {
    var w = weeksByPlayer[norm(player.name) + '|' + String(player.position || '').split(',')[0]] || {};
    var best = null;
    Object.keys(w).forEach(function (k) { if (best === null || w[k] > w[best]) best = k; });
    return { weeks: w, best: best === null ? null : { week: Number(best), points: w[best] } };
  }
  function sideTotals(stats) {
    var t = { total: 0, ppg: 0, recent: 0, games: 0, missing: 0 };
    stats.forEach(function (s) {
      if (!s.games) { t.missing += 1; return; }
      t.total += s.total; t.ppg += s.ppg; t.recent += s.recent; t.games += s.games;
    });
    return t;
  }

  // ---------- ratings ----------
  // A player's rating is his points per week this season, with last
  // season's average counting as PRIOR_WEEKS extra weeks - so two good
  // (or bad) weeks in September don't outweigh a whole season, and the
  // pull of last season fades as this one goes on. Only real scores.
  var PRIOR_WEEKS = 2;
  function playerRating(cur, prev, player) {
    var c = playerStats(cur || {}, player, 3), p = playerStats(prev || {}, player, 3), value = null, basis = 'none';
    if (c.games && p.games) { value = (c.total + PRIOR_WEEKS * p.ppg) / (c.games + PRIOR_WEEKS); basis = 'blend'; }
    else if (c.games) { value = c.ppg; basis = 'season'; }
    else if (p.games) { value = p.ppg; basis = 'last'; }
    return { value: value, basis: basis, games: c.games, ppg: c.ppg, total: c.total, recent: c.recent,
             lastPpg: p.games ? p.ppg : null, lastGames: p.games };
  }

  // ---------- scouting ----------
  var FLEX = { 'W/R/T': ['WR', 'RB', 'TE'], 'W/R': ['WR', 'RB'], 'W/T': ['WR', 'TE'], 'R/T': ['RB', 'TE'], 'Q/W/R/T': ['QB', 'WR', 'RB', 'TE'] };
  var GROUPS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  var OUT = { IR: 1, 'IR+': 1, NA: 1 };
  var DEFAULT_SLOTS = ['QB', 'WR', 'WR', 'WR', 'RB', 'RB', 'TE', 'W/R/T', 'K', 'DEF'];

  // The league's starting slots, as seen in the latest week's box scores
  // (a fallback when the server doesn't send them).
  function slotsFromBox(box) {
    var ids = Object.keys((box && box.games) || {}).sort();
    for (var i = ids.length - 1; i >= 0; i--) {
      var lineup = box.games[ids[i]].a || [];
      var s = lineup.map(function (p) { return p[0]; }).filter(function (x) { return x && x !== 'BN' && !OUT[x]; });
      if (s.length) return s;
    }
    return DEFAULT_SLOTS.slice();
  }
  function eligible(p, pos) { return p.position === pos || (p.positions || []).indexOf(pos) >= 0; }

  // One team's best lineup from its current roster, by rating. Each group
  // (QB, RB, WR, TE, FLEX, K, DEF) gets the points per week of the players
  // who'd fill its slots; injured-reserve players don't start.
  function teamReport(players, slots, rate) {
    var pool = [], out = [];
    players.forEach(function (p) {
      var r = rate(p);
      (OUT[p.slot] ? out : pool).push({ player: p, rating: r });
    });
    pool.sort(function (a, b) { return (b.rating.value === null ? -1 : b.rating.value) - (a.rating.value === null ? -1 : a.rating.value); });
    var used = {}, groups = {};
    GROUPS.forEach(function (g) { groups[g] = { slots: 0, points: 0, starters: [], missing: 0 }; });
    function fill(group, ok) {
      var pick = pool.filter(function (x) { return !used[x.player.player_key] && ok(x.player); })[0];
      var g = groups[group];
      g.slots += 1;
      if (!pick) { g.missing += 1; return; }
      used[pick.player.player_key] = 1;
      g.starters.push(pick);
      g.points += pick.rating.value || 0;
      if (pick.rating.value === null) g.missing += 1;
    }
    slots.forEach(function (s) { if (!FLEX[s] && groups[s]) fill(s, function (p) { return eligible(p, s); }); });
    slots.forEach(function (s) {
      if (FLEX[s]) fill('FLEX', function (p) { return FLEX[s].some(function (pos) { return eligible(p, pos); }); });
    });
    var bench = pool.filter(function (x) { return !used[x.player.player_key]; });
    var total = GROUPS.reduce(function (t, g) { return t + groups[g].points; }, 0);
    return { groups: groups, bench: bench, out: out, total: total };
  }

  // A letter grade for how a position compares with the average team:
  // by percent above or below average (A- or better is at least 12% and
  // 1.5 points above; D or worse at least 12% and 1.5 points below).
  var GRADES = [[0.30, 'A+'], [0.20, 'A'], [0.12, 'A-'], [0.07, 'B+'], [0.03, 'B'], [-0.03, 'C'],
                [-0.07, 'C-'], [-0.12, 'D+'], [-0.20, 'D'], [-0.30, 'D-']];
  function grade(diff, avg) {
    var pct = avg > 0 ? diff / avg : 0;
    if (Math.abs(diff) < 1.5) pct = Math.max(-0.119, Math.min(0.119, pct));  // too few points to call strong or weak
    var g = 'F';
    for (var i = 0; i < GRADES.length; i++) {
      var cut = GRADES[i][0];
      if (cut >= 0 ? pct >= cut : pct > cut) { g = GRADES[i][1]; break; }
    }
    return { grade: g, label: g.charAt(0) === 'A' ? 'strong' : (g === 'D' || g === 'D-' || g === 'F') ? 'weak' : 'average' };
  }

  // Every team's report, compared with the league average at each group.
  // A group is "strong" or "weak" when it's at least 12% (and 1.5 points)
  // away from the average.
  function scouting(teams, slots, rate) {
    var reports = teams.map(function (t) {
      return { team_key: t.team_key, manager: t.manager, report: teamReport(t.players || [], slots, rate) };
    });
    var groups = GROUPS.filter(function (g) { return reports.length && reports[0].report.groups[g].slots > 0; });
    var avg = {};
    groups.forEach(function (g) {
      avg[g] = reports.reduce(function (t, r) { return t + r.report.groups[g].points; }, 0) / (reports.length || 1);
    });
    reports.forEach(function (r) {
      r.cells = {};
      groups.forEach(function (g) {
        var pts = r.report.groups[g].points, diff = pts - avg[g], gr = grade(diff, avg[g]);
        var rank = 1 + reports.filter(function (o) { return o.report.groups[g].points > pts; }).length;
        r.cells[g] = { points: pts, diff: diff, rank: rank, grade: gr.grade, label: gr.label, missing: r.report.groups[g].missing };
      });
      r.strengths = groups.filter(function (g) { return r.cells[g].label === 'strong'; })
        .sort(function (a, b) { return r.cells[b].diff - r.cells[a].diff; });
      r.weaknesses = groups.filter(function (g) { return r.cells[g].label === 'weak'; })
        .sort(function (a, b) { return r.cells[a].diff - r.cells[b].diff; });
    });
    return { groups: groups, avg: avg, teams: reports, count: reports.length };
  }

  // ---------- trade partners ----------
  // Positions a trade could fix (flex, kicker and defense aren't matched on).
  var TRADE_GROUPS = ['QB', 'RB', 'WR', 'TE'];
  function playersAt(report, group) {
    var all = [];
    Object.keys(report.groups).forEach(function (g) {
      report.groups[g].starters.forEach(function (x) { all.push({ player: x.player, rating: x.rating, role: 'starter' }); });
    });
    report.bench.forEach(function (x) { all.push({ player: x.player, rating: x.rating, role: 'bench' }); });
    return all.filter(function (x) { return x.player.position === group; })
      .sort(function (a, b) { return (b.rating.value || 0) - (a.rating.value || 0); });
  }
  // Teams that are strong where `teamKey` is weak, and weak where it's
  // strong (a two-way fit ranks first). Players are suggestions to ask
  // about - only the ones on the block are marked as listed.
  function tradeFits(scout, teamKey, listings) {
    var me = scout.teams.filter(function (t) { return t.team_key === teamKey; })[0];
    if (!me) return { team: null, fits: [] };
    var listed = {};
    (listings || []).forEach(function (l) { listed[l.player_key] = l; });
    var fits = [];
    scout.teams.forEach(function (o) {
      if (o.team_key === teamKey) return;
      var gets = [], gives = [];
      TRADE_GROUPS.forEach(function (g) {
        if (!me.cells[g] || !o.cells[g]) return;
        if (me.cells[g].label === 'weak' && o.cells[g].diff > 0) gets.push({ group: g, need: -me.cells[g].diff, surplus: o.cells[g].diff });
        if (me.cells[g].label === 'strong' && o.cells[g].diff < 0) gives.push({ group: g, need: -o.cells[g].diff, surplus: me.cells[g].diff });
      });
      // Biggest gap first, so the strongest reason leads.
      function byFit(a, b) { return Math.min(b.need, b.surplus) - Math.min(a.need, a.surplus); }
      gets.sort(byFit); gives.sort(byFit);
      var theirListed = (listings || []).filter(function (l) {
        return l.team_key === o.team_key && gets.some(function (x) { return x.group === l.position; });
      });
      if (!gets.length && !gives.length) return;
      var score = gets.concat(gives).reduce(function (t, x) { return t + Math.min(x.need, x.surplus); }, 0) + theirListed.length;
      function offer(report, list, team) {
        var out = [];
        list.forEach(function (x) {
          playersAt(report, x.group).slice(0, 3).forEach(function (c) {
            out.push({ player: c.player, rating: c.rating, role: c.role, group: x.group, listed: !!listed[c.player.player_key] && listed[c.player.player_key].team_key === team });
          });
        });
        // Listed players first, then bench (spare) players, then by rating.
        return out.sort(function (a, b) { return (b.listed - a.listed) || ((a.role === 'bench') ? -1 : 0) - ((b.role === 'bench') ? -1 : 0) || (b.rating.value || 0) - (a.rating.value || 0); });
      }
      fits.push({ team_key: o.team_key, manager: o.manager, mutual: gets.length > 0 && gives.length > 0, score: score,
                  gets: gets, gives: gives, theyOffer: offer(o.report, gets, o.team_key), youOffer: offer(me.report, gives, teamKey) });
    });
    fits.sort(function (a, b) { return (b.mutual - a.mutual) || (b.score - a.score) || a.manager.localeCompare(b.manager); });
    return { team: me, fits: fits };
  }

  // ---------- trade finder ----------
  // Real, specific offers for one team: every 1-for-1, 2-for-1 and 1-for-2
  // with each other team.
  //
  // Every player gets two values:
  //   production - what he scores per week in our league (his rating),
  //   name       - what his draft slot says he should score: the 3rd RB
  //                taken is worth what the 3rd-best RB is scoring now;
  //                undrafted players, the first spot after the last one
  //                taken at the position.
  // Our side uses his likely value going forward: production pulled toward
  // the name by NAME_GAMES games' worth (a hot pickup cools, a slumping
  // star tends to recover), times each of the next 4 weeks' matchups
  // (Points Against; 0 on a bye; questionable/doubtful discounted next
  // week). A deal must lift our starting lineup over those weeks.
  // Their side is how the deal looks to them: their lineup change, plus
  // what they get by reputation (the name counts more early in the season),
  // plus a position they posted they want (top priority), players on their
  // block, and their record (a losing team takes depth, a winning team a
  // star).
  var FINDER_POS = { QB: 1, RB: 1, WR: 1, TE: 1 };
  var NOT_PLAYING = { O: 1, IR: 1, 'PUP-R': 1, 'NFI-R': 1, SUSP: 1, NA: 1 };
  var NEXT_WEEK = { Q: 0.85, D: 0.6 };
  var FINDER_CANDIDATES = 8;  // best players per team considered
  var NAME_GAMES = 3;         // how many games the draft slot is worth as a prior
  var HORIZON = 4;            // weeks ahead a deal is judged over
  var TEAM_FIX = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
  function nflTeam(t) { t = String(t || '').toUpperCase(); return TEAM_FIX[t] || t; }
  function tradeFinder(o) {
    var byKey = {};
    o.teams.forEach(function (t) { byKey[t.team_key] = t; });
    var me = byKey[o.teamKey];
    if (!me) return { team: null, deals: [] };
    var listed = {}, wants = {}, picks = o.draftInfo || {}, records = o.records || {}, pa = o.pa || null;
    (o.listings || []).forEach(function (l) { listed[l.player_key] = l.team_key; });
    (o.needs || []).forEach(function (n) { wants[n.team_key] = n.wants || []; });
    var played = o.week || 0;
    function prod(p) { var r = o.rate(p); return r && r.value !== null && r.value !== undefined ? r.value : null; }
    function games(p) { var r = o.rate(p); return (r && r.games) || 0; }
    // production ranks at each position, among every rostered player
    var all = [], byPos = {}, prodRank = {}, drafted = {};
    o.teams.forEach(function (t) { (t.players || []).forEach(function (p) { all.push(p); }); });
    all.forEach(function (p) { if (prod(p) !== null) (byPos[p.position] = byPos[p.position] || []).push(p); });
    Object.keys(byPos).forEach(function (pos) {
      byPos[pos].sort(function (a, b) { return prod(b) - prod(a); });
      byPos[pos].forEach(function (p, i) { prodRank[p.player_key] = i + 1; });
    });
    Object.keys(picks).forEach(function (k) { var d = picks[k]; if (d.pos) drafted[d.pos] = Math.max(drafted[d.pos] || 0, d.pos_rank || 0); });
    var haveDraft = Object.keys(picks).length > 0;
    function valueAt(pos, rank) { var l = byPos[pos] || []; return l.length ? prod(l[Math.min(rank, l.length) - 1]) : null; }
    function name(p) {
      if (!haveDraft) return prod(p);
      var d = picks[p.player_key];
      var v = d && d.pos_rank ? valueAt(d.pos || p.position, d.pos_rank) : valueAt(p.position, (drafted[p.position] || 0) + 1);
      return v === null ? prod(p) : v;
    }
    function est(p) {
      var v = prod(p), n = name(p);
      if (v === null) return n;
      if (n === null) return v;
      var g = games(p);
      return (g * v + NAME_GAMES * n) / (g + NAME_GAMES);
    }
    // the next HORIZON weeks and each player's matchup factor in them
    var start = played + 1, weeks = [];
    for (var w = start; w < start + HORIZON && w <= 18; w++) weeks.push(w);
    if (!weeks.length) weeks = [start];
    var paAvg = {};
    function factor(p, wk, first) {
      var f = 1;
      if (pa && pa.schedule) {
        var sched = pa.schedule[nflTeam(p.nfl_team)];
        if (sched) {
          var opp = sched[wk];
          if (!opp) return 0;  // bye
          if (pa.teams) {
            var pos = p.position, a = paAvg[pos];
            if (!a) {
              a = paAvg[pos] = { ppg: {}, mean: 0 };
              var codes = Object.keys(pa.teams);
              codes.forEach(function (c) {
                var t = pa.teams[c], ws = Object.keys(t.weeks || {});
                a.ppg[c] = ws.length ? ws.reduce(function (x, k) { return x + ((t.weeks[k] || {})[pos] || 0); }, 0) / ws.length : 0;
                a.mean += a.ppg[c] / codes.length;
              });
            }
            if (a.ppg[opp] !== undefined && a.mean) f = Math.max(0.7, Math.min(1.3, a.ppg[opp] / a.mean));
          }
        }
      }
      if (first && p.injury && NEXT_WEEK[p.injury.code]) f *= NEXT_WEEK[p.injury.code];
      return f;
    }
    var estCache = {}, wkCache = weeks.map(function () { return {}; });
    function estOf(p) { return estCache[p.player_key] !== undefined ? estCache[p.player_key] : (estCache[p.player_key] = est(p)); }
    var rates = weeks.map(function (wk, i) {
      return function (p) {
        var c = wkCache[i];
        if (c[p.player_key] === undefined) {
          var e = OUT[p.slot] || (p.injury && NOT_PLAYING[p.injury.code]) ? null : estOf(p);
          c[p.player_key] = { value: e === null ? null : e * factor(p, wk, i === 0), games: games(p) };
        }
        return c[p.player_key];
      };
    });
    function lineup(players) {
      return rates.reduce(function (s, rate) { return s + teamReport(players, o.slots, rate).total; }, 0) / rates.length;
    }
    function nowReport(players) { return teamReport(players, o.slots, function (p) { return { value: OUT[p.slot] ? null : estOf(p), games: games(p) }; }); }
    function tradable(p) {
      return FINDER_POS[p.position] && !OUT[p.slot] && prod(p) !== null && !(p.injury && NOT_PLAYING[p.injury.code]);
    }
    function cands(t) {
      return (t.players || []).filter(tradable).sort(function (a, b) { return estOf(b) - estOf(a); }).slice(0, FINDER_CANDIDATES);
    }
    function starters(rep) {
      var s = {};
      Object.keys(rep.groups).forEach(function (g) { rep.groups[g].starters.forEach(function (x) { s[x.player.player_key] = { player: x.player, value: x.rating.value, group: g }; }); });
      return s;
    }
    function swap(players, out, inn) {
      var gone = {};
      out.forEach(function (p) { gone[p.player_key] = 1; });
      return players.filter(function (p) { return !gone[p.player_key]; }).concat(inn);
    }
    function changes(before, after) {
      var a = starters(before), b = starters(after);
      return { into: Object.keys(b).filter(function (k) { return !a[k]; }).map(function (k) { return b[k]; }),
               outOf: Object.keys(a).filter(function (k) { return !b[k]; }).map(function (k) { return a[k]; }),
               empty: Object.keys(after.groups).filter(function (g) { return after.groups[g].starters.length < before.groups[g].starters.length; }) };
    }
    // Starters on a bye in each coming week: {week: [players]}.
    function byes(rep) {
      var out = {}, s = starters(rep);
      weeks.forEach(function (wk) {
        var on = Object.keys(s).map(function (k) { return s[k].player; }).filter(function (p) { return factor(p, wk, false) === 0; });
        if (on.length) out[wk] = on;
      });
      return out;
    }
    function groupsOf(list) {
      var out = list.map(function (p) { return [p]; });
      for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
      return out;
    }
    var nameWeight = Math.max(0.2, Math.min(0.6, 0.6 - 0.05 * played));  // how much reputation sways them, fading as the season goes
    function looks(p) { var n = name(p), v = prod(p); return nameWeight * (n === null ? v : n) + (1 - nameWeight) * v; }
    function early(p) { var d = picks[p.player_key]; return d && d.round <= 3; }
    // the positional rank his draft slot implies (undrafted: just after the last one taken)
    function slotRank(p) { var d = picks[p.player_key]; return d && d.pos_rank ? d.pos_rank : (drafted[p.position] || 0) + 1; }
    function slumping(p) { var n = name(p); return early(p) && n !== null && prod(p) < n - 2.5 && (prodRank[p.player_key] || 0) - slotRank(p) >= 3; }
    function hot(p) { var n = name(p); return haveDraft && n !== null && prod(p) >= n + 2 && slotRank(p) - (prodRank[p.player_key] || 99) >= 2; }
    function who(p) {  // "drafted RB3, scoring like RB14"
      var d = picks[p.player_key];
      return (d && d.pos_rank ? 'drafted ' + (d.pos || p.position) + d.pos_rank : 'undrafted') + ', scoring like ' + p.position + (prodRank[p.player_key] || '?');
    }
    var mine = cands(me), base = lineup(me.players || []), baseNow = nowReport(me.players || []), baseByes = byes(baseNow), deals = [];
    o.teams.forEach(function (t) {
      if (t.team_key === me.team_key) return;
      var theirs = cands(t), tBase = lineup(t.players || []), tNow = nowReport(t.players || []), rec = records[t.team_key] || null;
      var gp = rec ? rec.w + rec.l : 0, pct = gp ? rec.w / gp : 0.5;
      var theyWant = wants[t.team_key] || [];
      groupsOf(mine).forEach(function (give) {
        groupsOf(theirs).forEach(function (get) {
          if (give.length === 2 && get.length === 2) return;  // 1-for-1, 2-for-1 and 1-for-2 only
          var meNew = swap(me.players, give, get), themNew = swap(t.players, get, give);
          var myGain = lineup(meNew) - base;
          if (myGain < 1) return;  // not worth asking for
          var theirGain = lineup(themNew) - tBase;
          var perceived = give.reduce(function (s, p) { return s + looks(p); }, 0) - get.reduce(function (s, p) { return s + looks(p); }, 0);
          var why = [], tags = [], yes = 0.6 * theirGain + 0.5 * perceived;
          var fills = give.filter(function (p) {
            return theyWant.indexOf(p.position) >= 0 && !get.some(function (x) { return x.position === p.position; });
          }).map(function (p) { return p.position; });
          if (fills.length) { yes += 3; why.push({ kind: 'wants', text: t.manager + ' is looking for ' + article(fills[0]) + ' ' + fills[0] }); }
          var onBlock = get.filter(function (p) { return listed[p.player_key] === t.team_key; });
          if (onBlock.length) { yes += 1.5 * Math.min(2, onBlock.length); why.push({ kind: 'block', text: listJoin(onBlock.map(function (p) { return p.name; })) + (onBlock.length > 1 ? ' are' : ' is') + ' on ' + t.manager + '’s block' }); }
          var bigGive = give.filter(slumping), hotGet = get.filter(hot), lowGet = get.filter(slumping);
          if (bigGive.length && hotGet.length) {
            tags.push('sell');
            why.push({ kind: 'name', text: bigGive[0].name + ' (' + who(bigGive[0]) + ') has the bigger name; ' + hotGet[0].name + ' (' + who(hotGet[0]) + ') has the points' });
          }
          if (lowGet.length) {
            tags.push('buy');
            why.push({ kind: 'name', text: lowGet[0].name + ' (' + who(lowGet[0]) + ') is slumping, so his price is down; players taken that early usually bounce back' });
          }
          get.forEach(function (p) {
            var d = picks[p.player_key];
            if (d && d.round <= 2 && lowGet.indexOf(p) < 0) why.push({ kind: 'draft', text: p.name + ' was a ' + (d.round === 1 ? '1st' : '2nd') + '-round pick, so ' + t.manager + ' may need convincing' });
          });
          if (gp >= 2 && pct < 0.45 && give.length > get.length) { yes += 1.5; why.push({ kind: 'record', text: 'At ' + rec.w + '–' + rec.l + ', two starters help ' + t.manager + ' more than one star' }); }
          if (gp >= 2 && pct > 0.55 && give.length < get.length) { yes += 1; why.push({ kind: 'record', text: 'At ' + rec.w + '–' + rec.l + ', ' + t.manager + ' can trade depth for a star' }); }
          // Easy yes: their lineup gets better too, and it looks fair to them.
          var odds = yes >= 0.5 && theirGain >= 0 ? 'easy' : yes >= -2.5 ? 'pitch' : yes >= -5 ? 'long' : null;
          if (!odds) return;
          var meAfter = nowReport(meNew), byeNote = null, newByes = byes(meAfter);
          Object.keys(newByes).forEach(function (wk) {
            if (!byeNote && newByes[wk].length >= 2 && newByes[wk].length > (baseByes[wk] || []).length) byeNote = { week: +wk, players: newByes[wk] };
          });
          deals.push({ team_key: t.team_key, manager: t.manager, record: rec, give: give, get: get, tags: tags, byeNote: byeNote,
                       myGain: myGain, theirGain: theirGain, perceived: perceived, yes: yes, odds: odds, wanted: fills.length > 0, why: why,
                       mine: changes(baseNow, meAfter), theirs: changes(tNow, nowReport(themNew)),
                       // what it's worth to us, times how likely they are to take it
                       score: myGain / (1 + Math.exp(-(yes + 1) / 1.5)) + (fills.length ? 3 : 0) });
        });
      });
    });
    // A deal with a throw-in player is dropped when the deal without him is
    // just as good: the simplest version of each idea is the one to ask for.
    var byId = {};
    function id(d) {
      return d.team_key + '|' + d.give.map(function (p) { return p.player_key; }).sort().join(',') + '>' + d.get.map(function (p) { return p.player_key; }).sort().join(',');
    }
    deals.forEach(function (d) { byId[id(d)] = d; });
    deals = deals.filter(function (d) {
      var smaller = [];
      if (d.give.length === 2) d.give.forEach(function (p) { smaller.push({ team_key: d.team_key, give: d.give.filter(function (x) { return x !== p; }), get: d.get }); });
      if (d.get.length === 2) d.get.forEach(function (p) { smaller.push({ team_key: d.team_key, give: d.give, get: d.get.filter(function (x) { return x !== p; }) }); });
      return !smaller.some(function (x) { var y = byId[id(x)]; return y && y.score >= d.score - 0.5; });
    });
    // Best first: a position they asked for leads, then overall score.
    deals.sort(function (a, b) { return (b.wanted - a.wanted) || (b.score - a.score); });
    // Variety: at most two deals per team, never the same ask twice, and
    // each of our players offered in at most two deals (o.every: all of them).
    var perTeam = {}, seen = {}, offered = {}, out = [];
    deals.forEach(function (d) {
      var ask = d.team_key + '|' + d.get.map(function (p) { return p.player_key; }).sort().join(',');
      if (o.every) { out.push(d); return; }
      if (out.length >= (o.limit || 6) || seen[ask] || (perTeam[d.team_key] || 0) >= 2) return;
      if (d.give.some(function (p) { return (offered[p.player_key] || 0) >= 2; })) return;
      seen[ask] = 1; perTeam[d.team_key] = (perTeam[d.team_key] || 0) + 1;
      d.give.forEach(function (p) { offered[p.player_key] = (offered[p.player_key] || 0) + 1; });
      out.push(d);
    });
    // How each player in the deals is seen: production, name, draft slot.
    var info = {};
    out.forEach(function (d) {
      d.give.concat(d.get).forEach(function (p) {
        var dr = picks[p.player_key];
        info[p.player_key] = { prod: prod(p), est: estOf(p), name: name(p), rank: prodRank[p.player_key] || null,
                               round: dr ? dr.round : null, draftRank: dr && dr.pos_rank ? (dr.pos || p.position) + dr.pos_rank : null };
      });
    });
    return { team: me, deals: out, considered: deals.length, weeks: weeks, info: info };
  }
  // Each team's record from the season's box scores (starters' points decide
  // each game): {team key: {w, l}}. Game ids hold the two managers' ids.
  function recordsFromBox(box, teams) {
    var id = {}, out = {};
    (teams || []).forEach(function (t) { id[String(t.manager || '').toLowerCase().replace(/[^a-z0-9]+/g, '')] = t.team_key; });
    function pts(lineup) { return (lineup || []).reduce(function (s, p) { return s + (p[0] === 'BN' || OUT[p[0]] || typeof p[4] !== 'number' ? 0 : p[4]); }, 0); }
    Object.keys((box && box.games) || {}).forEach(function (gid) {
      var m = /^\d+-w\d+-([^-]+)-([^-]+)$/.exec(gid), g = box.games[gid];
      if (!m || !id[m[1]] || !id[m[2]]) return;
      var a = pts(g.a), b = pts(g.b);
      [[m[1], a > b], [m[2], b > a]].forEach(function (x) {
        var r = out[id[x[0]]] = out[id[x[0]]] || { w: 0, l: 0 };
        if (a !== b) { if (x[1]) r.w += 1; else r.l += 1; }
      });
    });
    return out;
  }

  // ---------- fairness ----------
  // Compares what each side receives, by rating (points per week). Within
  // 10% is fair; up to 25% leans one way; beyond that it's lopsided.
  function fairness(aGives, bGives) {
    function sum(list) {
      return list.reduce(function (t, x) { return t + (x.value === null || x.value === undefined ? 0 : x.value); }, 0);
    }
    var a = sum(aGives), b = sum(bGives), top = Math.max(a, b);
    var diff = b - a;  // positive: side A receives more (A gets B's players)
    var pct = top > 0 ? Math.abs(diff) / top : 0;
    var verdict = pct < 0.10 ? 'fair' : pct < 0.25 ? 'leans' : 'lopsided';
    var missing = aGives.concat(bGives).filter(function (x) { return x.value === null || x.value === undefined; }).length;
    var thin = aGives.concat(bGives).filter(function (x) { return x.value !== null && x.value !== undefined && x.games < 3; }).length;
    return { aReceives: b, bReceives: a, diff: diff, pct: pct, verdict: verdict, favors: pct < 0.10 ? null : diff > 0 ? 'A' : 'B',
             missing: missing, thin: thin, uneven: aGives.length !== bGives.length };
  }

  // ---------- time ----------
  function ago(epochSeconds, now) {
    if (!epochSeconds) return 'never';
    var s = Math.max(0, (now || Date.now() / 1000) - epochSeconds);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' hr ago';
    var d = Math.round(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

  root.TradeLogic = {
    STATUS_LABEL: STATUS_LABEL, filterListings: filterListings, needs: needs, matchmaker: matchmaker, tradeFinder: tradeFinder, recordsFromBox: recordsFromBox,
    playerWeeks: playerWeeks, playerStats: playerStats, weekLine: weekLine, sideTotals: sideTotals, ago: ago,
    playerRating: playerRating, slotsFromBox: slotsFromBox, teamReport: teamReport, scouting: scouting,
    tradeFits: tradeFits, fairness: fairness, grade: grade, GROUPS: GROUPS, PRIOR_WEEKS: PRIOR_WEEKS
  };
})(typeof window !== 'undefined' ? window : globalThis);
