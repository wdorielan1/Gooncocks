/*
 * Rivalry math. Pure functions over the normalized matchup list from
 * data.js - no DOM access - so every panel on the page (featured series,
 * spotlight cards, the grid, the receipts) reads the same numbers.
 *
 * Rules:
 *  - Only completed ("final") games count.
 *  - "All games" means regular season + championship playoffs. Consolation
 *    games are left out unless the consolation toggle is on.
 *  - A tie (identical scores) counts as a tie for both managers.
 */
(function () {
  var MIN_MEETINGS_ALL = 6;   // spotlights need this many meetings across all seasons
  var MIN_MEETINGS_SEASON = 2; // ... or this many inside a single season

  function inScope(g, f) {
    if (g.status !== 'final') return false;
    if (f.season !== 'all' && g.season !== Number(f.season)) return false;
    if (g.gameType === 'consolation') return !!f.consolation && f.type !== 'regular';
    if (f.type === 'regular') return g.gameType === 'regular';
    if (f.type === 'playoff') return g.gameType === 'playoff';
    return true;
  }

  function newestFirst(x, y) { return (y.season - x.season) || (y.week - x.week); }

  // Scores and result from one manager's side of a game.
  function side(g, id) {
    var mine = g.managerA === id ? g.scoreA : g.scoreB;
    var theirs = g.managerA === id ? g.scoreB : g.scoreA;
    return { mine: mine, theirs: theirs, result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T' };
  }

  function winnerOf(g) {
    return g.scoreA > g.scoreB ? g.managerA : g.scoreB > g.scoreA ? g.managerB : null;
  }

  function between(games, a, b) {
    return games.filter(function (g) {
      return (g.managerA === a && g.managerB === b) || (g.managerA === b && g.managerB === a);
    }).sort(newestFirst);
  }

  // Head-to-head summary from a's side. `games` is already filtered to scope.
  function series(games, a, b) {
    var list = between(games, a, b);
    var out = { a: a, b: b, games: list, meetings: list.length, winsA: 0, winsB: 0, ties: 0,
                pointsA: 0, pointsB: 0, streak: null, closest: null, biggest: null };
    list.forEach(function (g) {
      var s = side(g, a);
      out.pointsA += s.mine; out.pointsB += s.theirs;
      if (s.result === 'W') out.winsA += 1; else if (s.result === 'L') out.winsB += 1; else out.ties += 1;
      var margin = Math.abs(g.scoreA - g.scoreB);
      // Newest-first order means ties on margin keep the most recent game.
      if (!out.closest || margin < out.closest.margin) out.closest = { game: g, margin: margin, winner: winnerOf(g) };
      if (winnerOf(g) && (!out.biggest || margin > out.biggest.margin)) out.biggest = { game: g, margin: margin, winner: winnerOf(g) };
    });
    if (list.length) {
      var first = winnerOf(list[0]);
      var n = 0;
      for (var i = 0; i < list.length && winnerOf(list[i]) === first; i++) n += 1;
      out.streak = { winner: first, count: first ? n : 1 };
    }
    out.leader = out.winsA > out.winsB ? a : out.winsB > out.winsA ? b : null;
    return out;
  }

  // Every pairing's record, from each side. matrix[a][b] = {w, l, t, n}.
  // Both directions are filled from the same games, so they always mirror.
  function matrix(games, ids) {
    var m = {};
    ids.forEach(function (a) {
      m[a] = {};
      ids.forEach(function (b) { if (a !== b) m[a][b] = { w: 0, l: 0, t: 0, n: 0 }; });
    });
    games.forEach(function (g) {
      var A = m[g.managerA] && m[g.managerA][g.managerB];
      var B = m[g.managerB] && m[g.managerB][g.managerA];
      if (!A || !B) return;
      var r = side(g, g.managerA).result;
      A.n += 1; B.n += 1;
      if (r === 'W') { A.w += 1; B.l += 1; } else if (r === 'L') { A.l += 1; B.w += 1; } else { A.t += 1; B.t += 1; }
    });
    return m;
  }

  function pairs(ids) {
    var out = [];
    for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
    return out;
  }

  /*
   * Spotlight cards, from the games in scope.
   *  Closest Rivalry: smallest gap between the two win totals (min meetings
   *    applies); ties broken by more meetings, then closer average score.
   *  Most One-Sided: highest win share for the leader (min meetings);
   *    ties broken by more meetings, then bigger average margin.
   *  Playoff Grudge: championship-playoff games only in the season scope;
   *    the pairing that has met most often (at least 2), ties broken by
   *    the more lopsided record, then most recent meeting.
   */
  function spotlights(scopeGames, playoffGames, ids, singleSeason) {
    var min = singleSeason ? MIN_MEETINGS_SEASON : MIN_MEETINGS_ALL;
    var all = pairs(ids).map(function (p) { return series(scopeGames, p[0], p[1]); })
      .filter(function (s) { return s.meetings >= min; });

    function avgGap(s) { return Math.abs(s.pointsA - s.pointsB) / s.meetings; }
    function lead(s) { return Math.max(s.winsA, s.winsB) / s.meetings; }

    var closest = all.slice().sort(function (x, y) {
      return (Math.abs(x.winsA - x.winsB) - Math.abs(y.winsA - y.winsB)) || (y.meetings - x.meetings) || (avgGap(x) - avgGap(y));
    })[0] || null;
    var oneSided = all.filter(function (s) { return s.leader; }).sort(function (x, y) {
      return (lead(y) - lead(x)) || (y.meetings - x.meetings) || (avgGap(y) - avgGap(x));
    })[0] || null;
    var grudge = pairs(ids).map(function (p) { return series(playoffGames, p[0], p[1]); })
      .filter(function (s) { return s.meetings >= 2; })
      .sort(function (x, y) {
        return (y.meetings - x.meetings) || (lead(y) - lead(x)) || newestFirst(x.games[0], y.games[0]);
      })[0] || null;

    return { closest: closest, oneSided: oneSided, grudge: grudge, minMeetings: min };
  }

  window.Rivalry = {
    inScope: inScope, side: side, winnerOf: winnerOf, series: series, matrix: matrix,
    spotlights: spotlights, newestFirst: newestFirst,
    MIN_MEETINGS_ALL: MIN_MEETINGS_ALL, MIN_MEETINGS_SEASON: MIN_MEETINGS_SEASON
  };
})();
