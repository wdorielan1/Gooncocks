/*
 * Trade Lab data layer - the only file that talks to the server.
 *
 * Live: the Trade Lab API at /api/trade-lab (same site, cookies included).
 * The browser never holds Yahoo tokens or decides who you are; it gets a
 * CSRF token from /me and sends it with every change, and the server
 * checks everything again.
 *
 * Preview: when window.TRADE_LAB_PREVIEW is set (the design preview only),
 * a fake in-browser server with clearly labeled sample listings stands
 * in, so the page can be tried without Yahoo. It is never the live data.
 */
(function () {
  var BASE = window.TRADE_LAB_API || '/api/trade-lab';

  function LiveApi() { this.csrf = null; }
  LiveApi.prototype.call = function (method, path, body) {
    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && this.csrf) headers['X-CSRF-Token'] = this.csrf;
    return fetch(BASE + path, { method: method, headers: headers, credentials: 'same-origin', cache: 'no-store',
                                body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok && r.status !== 409) { var e = new Error(data.message || 'Request failed (' + r.status + ').'); e.status = r.status; e.data = data; throw e; }
          data._status = r.status;
          return data;
        });
      }, function () { throw new Error('Can’t reach the Trade Lab right now. Check your connection and try again.'); });
  };
  LiveApi.prototype.me = function () {
    var self = this;
    return this.call('GET', '/me').then(function (m) { self.csrf = m.csrf || null; return m; });
  };
  LiveApi.prototype.listings = function () { return this.call('GET', '/listings'); };
  // Counts a signed-in manager's visit (the server ignores anyone signed out). Never fails loudly.
  LiveApi.prototype.visit = function (page, tool) {
    if (!this.csrf) return Promise.resolve(null);
    return this.call('POST', '/visit', { page: page, tool: tool || null }).catch(function () { return null; });
  };
  LiveApi.prototype.commissioner = function () { return this.call('GET', '/commissioner'); };
  LiveApi.prototype.rosters = function () { return this.call('GET', '/rosters'); };
  LiveApi.prototype.myRoster = function () { return this.call('GET', '/roster'); };
  LiveApi.prototype.saveNeeds = function (wants, note) { return this.call('PUT', '/needs', { wants: wants, note: note }); };
  LiveApi.prototype.save = function (items) { return this.call('PUT', '/listings', { items: items }); };
  LiveApi.prototype.remove = function (playerKey, version) {
    return this.call('DELETE', '/listings/' + encodeURIComponent(playerKey) + '?version=' + encodeURIComponent(version));
  };
  LiveApi.prototype.signInUrl = function (next) { return BASE + '/login' + (next ? '?next=' + encodeURIComponent(next) : ''); };
  LiveApi.prototype.signOut = function () { return this.call('POST', '/logout', {}); };
  LiveApi.prototype.pointsAgainst = function (season) {
    return fetch('/nfl/points_against_' + season + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  };
  LiveApi.prototype.available = function () { return this.call('GET', '/available'); };
  LiveApi.prototype.injuries = function () { return this.call('GET', '/injuries'); };
  LiveApi.prototype.transactions = function () { return this.call('GET', '/transactions'); };
  LiveApi.prototype.nflPlayers = function (season) {
    return fetch('/nfl/players_' + season + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  };
  LiveApi.prototype.leaders = function () {
    return fetch('/leaders/live.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  };
  LiveApi.prototype.gameLog = function (season) {
    return fetch('/nfl/gamelog_' + season + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  };
  LiveApi.prototype.leadersWeek = function (week) {
    return fetch('/leaders/week-' + week + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  };
  LiveApi.prototype.liveWeek = function () {
    return fetch('/boxscores/live.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  };
  LiveApi.prototype.boxscores = function (season) {
    return fetch('/boxscores/' + season + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  };

  // ---------- preview: a pretend server over clearly labeled sample data ----------
  function PreviewApi(sample) {
    this.s = JSON.parse(JSON.stringify(sample));
    this.signedIn = false;
  }
  function later(v) { return new Promise(function (res) { setTimeout(function () { res(JSON.parse(JSON.stringify(v))); }, 250); }); }
  PreviewApi.prototype.me = function () {
    return later(this.signedIn ? { signed_in: true, team_key: this.s.me, manager: this.s.managerOf[this.s.me], can_edit: true, commish: true, csrf: 'preview' }
      : { signed_in: false });
  };
  PreviewApi.prototype.visit = function (page, tool) { (this.visits = this.visits || []).push([page, tool || null]); return later(null); };
  PreviewApi.prototype.commissioner = function () {
    return this.signedIn ? later(this.s.commissioner) : Promise.reject(Object.assign(new Error('Sign in with Yahoo to see the commissioner page.'), { status: 401 }));
  };
  PreviewApi.prototype.listings = function () {
    var s = this.s;
    return later({ league_key: s.league_key, listings: s.listings.slice().sort(function (a, b) { return b.updated_at - a.updated_at; }), needs: s.needs || [],
                   positions: s.positions, teams: s.teams, rosters_checked_at: s.now - 240, rosters_stale: false, preview: true });
  };
  PreviewApi.prototype.rosters = function () {
    var s = this.s;
    return later({ teams: s.teams.map(function (t) { return { team_key: t.team_key, manager: t.manager, players: s.rosters[t.team_key] || [] }; }),
                   slots: s.slots || [], rosters_checked_at: s.now - 240 });
  };
  PreviewApi.prototype.myRoster = function () {
    var s = this.s;
    return later({ team_key: s.me, players: s.rosters[s.me], positions: s.positions, roster_checked_at: s.now - 60, roster_stale: false,
                   listings: s.listings.filter(function (l) { return l.team_key === s.me; }) });
  };
  PreviewApi.prototype.save = function (items) {
    var s = this.s, results = [], saved = [], roster = s.rosters[s.me];
    for (var i = 0; i < items.length; i++) {
      var it = items[i], p = roster.filter(function (x) { return x.player_key === it.player_key; })[0];
      if (!p) return Promise.reject(Object.assign(new Error('Only players on your current Yahoo roster can be listed.'), { status: 403 }));
      if ((it.note || '').length > 200) return Promise.reject(Object.assign(new Error('Keep the note to 200 characters.'), { status: 400 }));
    }
    items.forEach(function (it) {
      var p = roster.filter(function (x) { return x.player_key === it.player_key; })[0];
      var existing = s.listings.filter(function (l) { return l.player_key === it.player_key; })[0];
      if (existing && existing.version !== (it.version || 0)) { results.push({ player_key: it.player_key, ok: false, error: 'conflict', current: existing }); return; }
      var now = Date.now() / 1000;
      var l = { player_key: p.player_key, name: p.name, position: p.position, nfl_team: p.nfl_team, headshot: p.headshot, team_key: s.me,
                manager: s.managerOf[s.me], status: it.status, wants: it.wants, note: String(it.note || '').replace(/\s+/g, ' ').trim(),
                created_at: existing ? existing.created_at : now, updated_at: now, version: (existing ? existing.version : 0) + 1 };
      s.listings = s.listings.filter(function (x) { return x.player_key !== it.player_key; }).concat([l]);
      saved.push(l); results.push({ player_key: it.player_key, ok: true });
    });
    return later({ results: results, listings: saved, _status: results.every(function (r) { return r.ok; }) ? 200 : 409 });
  };
  PreviewApi.prototype.saveNeeds = function (wants, note) {
    var s = this.s, me = s.me;
    s.needs = (s.needs || []).filter(function (n) { return n.team_key !== me; });
    if (!wants.length && !note) return later({ needs: null });
    var n = { team_key: me, manager: s.managerOf[me], wants: wants.slice(), note: note, updated_at: Math.floor(Date.now() / 1000) };
    s.needs.push(n);
    return later({ needs: n });
  };
  PreviewApi.prototype.remove = function (playerKey) {
    var s = this.s;
    s.listings = s.listings.filter(function (l) { return !(l.player_key === playerKey && l.team_key === s.me); });
    return later({ removed: playerKey });
  };
  PreviewApi.prototype.signInUrl = function () { return null; };
  PreviewApi.prototype.signIn = function () { this.signedIn = true; };
  PreviewApi.prototype.signOut = function () { this.signedIn = false; return later({ signed_in: false }); };
  PreviewApi.prototype.liveWeek = function () { return later(this.s.live || null); };
  PreviewApi.prototype.pointsAgainst = function () { return later(this.s.pointsAgainst || null); };
  PreviewApi.prototype.available = function () {
    return later({ players: this.s.available || [], checked_at: this.s.now - 600, stale: false });
  };
  PreviewApi.prototype.transactions = function () {
    return later({ transactions: this.s.transactions || [], checked_at: this.s.now - 120, stale: false });
  };
  PreviewApi.prototype.leaders = function () { return later(this.s.leaders || null); };
  PreviewApi.prototype.gameLog = function () { return later(this.s.gameLog || null); };
  PreviewApi.prototype.leadersWeek = function (week) { return later((this.s.leadersWeeks || {})[week] || null); };
  PreviewApi.prototype.injuries = function () {
    var i = this.s.injuries || { injured: [], back: [] };
    return later({ injured: i.injured, back: i.back, checked_at: this.s.now - 300, stale: false });
  };
  PreviewApi.prototype.nflPlayers = function () { return later(this.s.nflPlayers || null); };
  PreviewApi.prototype.boxscores = function (season) { return later((this.s.boxscores || {})[season] || null); };

  window.TradeApi = window.TRADE_LAB_PREVIEW && window.TRADE_LAB_SAMPLE ? new PreviewApi(window.TRADE_LAB_SAMPLE) : new LiveApi();
  window.TradeApi.preview = !!(window.TRADE_LAB_PREVIEW && window.TRADE_LAB_SAMPLE);
})();
