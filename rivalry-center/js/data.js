/*
 * Data layer for the Rivalry Center.
 *
 * Everything on the page is calculated from the one normalized history this
 * file returns. To switch from demo data to real Yahoo history, produce a
 * file with the same shape (see README.md) and either:
 *   - replace data/demo-history.js with one that sets window.GOONCOCKS_HISTORY, or
 *   - set window.GOONCOCKS_HISTORY_URL (in index.html) to a JSON file with the
 *     same shape. The browser only ever reads a finished export: Yahoo
 *     credentials stay on the server side (the Lambda) and never belong here.
 */
(function () {
  var GAME_TYPES = { regular: true, playoff: true, consolation: true };

  function isScore(v) { return typeof v === 'number' && isFinite(v); }

  function normalize(raw) {
    if (!raw || !Array.isArray(raw.managers) || !Array.isArray(raw.matchups)) {
      throw new Error('History file is missing its managers or matchups list.');
    }
    var managers = raw.managers
      .filter(function (m) { return m && typeof m.id === 'string' && m.id; })
      .map(function (m) { return { id: m.id, name: String(m.name || m.id) }; });
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
      return {
        id: String(g.id || [g.season, g.week, g.managerA, g.managerB].join('-')),
        season: g.season, week: g.week, gameType: g.gameType, round: g.round || null,
        status: g.status === 'final' ? 'final' : 'scheduled',
        managerA: g.managerA, managerB: g.managerB,
        scoreA: g.status === 'final' ? g.scoreA : null, scoreB: g.status === 'final' ? g.scoreB : null
      };
    });
    if (skipped) console.warn('Rivalry Center: skipped ' + skipped + ' matchup rows that did not match the expected format.');

    return {
      source: raw.source === 'yahoo' ? 'yahoo' : 'demo',
      label: raw.label || '',
      league: raw.league || '',
      photoBaseUrl: raw.photoBaseUrl || '',
      managers: managers,
      teams: raw.teams || {},
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
    return Promise.reject(new Error('No league history found. Add data/demo-history.js or set GOONCOCKS_HISTORY_URL.'));
  }

  window.RivalryData = { load: load, normalize: normalize };
})();
