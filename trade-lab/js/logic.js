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
    playerWeeks: playerWeeks, playerStats: playerStats, sideTotals: sideTotals, ago: ago
  };
})(typeof window !== 'undefined' ? window : globalThis);
