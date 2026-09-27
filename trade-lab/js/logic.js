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
  function needs(listings, teams) {
    var by = {};
    listings.forEach(function (l) {
      var n = by[l.team_key] = by[l.team_key] || { team_key: l.team_key, manager: l.manager, wants: [] };
      l.wants.forEach(function (w) { if (n.wants.indexOf(w) < 0) n.wants.push(w); });
    });
    var order = (teams || []).map(function (t) { return t.team_key; });
    return Object.keys(by).map(function (k) { return by[k]; }).filter(function (n) { return n.wants.length; })
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
  function matchmaker(listings, teamKey) {
    var mine = listings.filter(function (l) { return l.team_key === teamKey; });
    var myWants = [];
    mine.forEach(function (l) { l.wants.forEach(function (w) { if (myWants.indexOf(w) < 0) myWants.push(w); }); });
    var byTeam = {};
    listings.forEach(function (l) { if (l.team_key !== teamKey) (byTeam[l.team_key] = byTeam[l.team_key] || []).push(l); });
    var out = [];
    Object.keys(byTeam).forEach(function (k) {
      var theirs = byTeam[k], manager = theirs[0].manager;
      var theirWants = [];
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
  function playerWeeks(boxscores) {
    var by = {};
    Object.keys((boxscores && boxscores.games) || {}).forEach(function (id) {
      var m = /-w(\d+)-/.exec(id);
      if (!m) return;
      var week = Number(m[1]), g = boxscores.games[id];
      [g.a, g.b].forEach(function (lineup) {
        (lineup || []).forEach(function (p) {
          if (typeof p[4] !== 'number') return;
          var key = norm(p[1]) + '|' + String(p[2] || '').split(',')[0];
          (by[key] = by[key] || {})[week] = p[4];
        });
      });
    });
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
    STATUS_LABEL: STATUS_LABEL, filterListings: filterListings, needs: needs, matchmaker: matchmaker,
    playerWeeks: playerWeeks, playerStats: playerStats, sideTotals: sideTotals, ago: ago,
    playerRating: playerRating, slotsFromBox: slotsFromBox, teamReport: teamReport, scouting: scouting,
    tradeFits: tradeFits, fairness: fairness, grade: grade, GROUPS: GROUPS, PRIOR_WEEKS: PRIOR_WEEKS
  };
})(typeof window !== 'undefined' ? window : globalThis);
