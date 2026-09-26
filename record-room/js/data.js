/*
 * Data layer for the Record Room.
 *
 * Every record on the page is calculated from the one league history this
 * returns (the same format the Rivalry Center and Career Center use).
 *   - Opened from this folder, it uses data/league-history.js, a snapshot of
 *     the real Yahoo history (refresh it with tools/snapshot_history.py).
 *   - Set window.GOONCOCKS_HISTORY_URL (see index.html) to read a live JSON
 *     file instead, e.g. '/rivalry-history.json' once this page is hosted on
 *     the same site. The browser only reads a finished export; Yahoo
 *     credentials stay with the Lambda and never belong here.
 */
(function () {
  var GAME_TYPES = { regular: true, playoff: true, consolation: true };
  function isScore(v) { return typeof v === 'number' && isFinite(v); }

  function normalize(raw) {
    if (!raw || !Array.isArray(raw.managers) || !Array.isArray(raw.matchups)) {
      throw new Error('The history file is missing its managers or matchups list.');
    }
    var managers = raw.managers
      .filter(function (m) { return m && typeof m.id === 'string' && m.id; })
      .map(function (m) { return { id: m.id, name: String(m.name || m.id), active: m.active !== false }; });
    var known = {};
    managers.forEach(function (m) { known[m.id] = true; });

    var skipped = 0;
    var matchups = raw.matchups.filter(function (g) {
      var ok = g && known[g.managerA] && known[g.managerB] && g.managerA !== g.managerB &&
        Number.isInteger(g.season) && Number.isInteger(g.week) && GAME_TYPES[g.gameType];
      if (ok && g.status === 'final') ok = isScore(g.scoreA) && isScore(g.scoreB);
      if (!ok) skipped += 1;
      return ok;
    }).map(function (g) {
      var final = g.status === 'final';
      return {
        id: String(g.id || [g.season, g.week, g.managerA, g.managerB].join('-')),
        season: g.season, week: g.week, gameType: g.gameType, round: g.round || null,
        status: final ? 'final' : 'scheduled',
        managerA: g.managerA, managerB: g.managerB,
        scoreA: final ? g.scoreA : null, scoreB: final ? g.scoreB : null
      };
    });
    if (skipped) console.warn('Record Room: skipped ' + skipped + ' matchup rows that did not match the expected format.');

    // Final standings: { "2025": { finished, teams, ranks: { managerId: rank } } }.
    var standings = {};
    Object.keys(raw.standings || {}).forEach(function (year) {
      var s = raw.standings[year] || {};
      var ranks = {};
      Object.keys(s.ranks || {}).forEach(function (id) {
        if (known[id] && Number.isInteger(s.ranks[id])) ranks[id] = s.ranks[id];
      });
      standings[year] = { finished: !!s.finished, teams: s.teams || Object.keys(ranks).length, ranks: ranks };
    });

    return {
      source: raw.source === 'yahoo' ? 'yahoo' : 'demo',
      label: raw.label || '',
      photoBaseUrl: raw.photoBaseUrl || '',
      managers: managers,
      teams: raw.teams || {},
      standings: standings,
      matchups: matchups
    };
  }

  function load() {
    if (window.GOONCOCKS_HISTORY_URL) {
      return fetch(window.GOONCOCKS_HISTORY_URL, { cache: 'no-cache' })
        .then(function (r) {
          if (!r.ok) throw new Error('Could not load ' + window.GOONCOCKS_HISTORY_URL + ' (HTTP ' + r.status + ').');
          return r.json();
        })
        .then(normalize);
    }
    if (window.GOONCOCKS_HISTORY) return Promise.resolve(normalize(window.GOONCOCKS_HISTORY));
    return Promise.reject(new Error('No league history found. Add data/league-history.js or set GOONCOCKS_HISTORY_URL.'));
  }

  window.RecordData = { load: load, normalize: normalize };
})();
