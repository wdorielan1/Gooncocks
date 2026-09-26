/*
 * Manager Career Center UI. Loads the history through CareerData, computes
 * everything through Career (career.js), and renders three views from one
 * state: League overview, Manager profile, Compare careers.
 * Selections and filters are remembered in this browser (localStorage) and
 * the open view is kept in the address (#overview / #profile / #compare).
 */
(function () {
  var STORE_KEY = 'gooncocks-career-center';
  var VIEWS = ['overview', 'profile', 'compare'];
  var $ = function (id) { return document.getElementById(id); };
  var data, byId;
  var state = { view: 'overview', season: 'all', search: '', sortKey: 'titles', sortDir: 'desc',
                selected: null, profile: null, a: null, b: null };
  var openSeasons = {};

  // ---------- formatting ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function name(id) { return byId[id] ? byId[id].name : id; }
  function rec(o) { return o.w + '-' + o.l + '-' + o.t; }
  function pctText(p) { return p == null ? '—' : p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''); }
  function pts(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money(n) { return (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function signed(n) { return (n >= 0 ? '+' : '-') + money(Math.abs(n)); }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function when(x) { return x.season + ' · Week ' + x.week; }
  function scope() { return state.season; }
  function scopeLabel() { return state.season === 'all' ? 'Career totals · all seasons' : state.season + ' season only'; }
  function photoFor(id) {
    return data.photoBaseUrl && byId[id] && byId[id].active
      ? '<img src="' + esc(data.photoBaseUrl + id + '.jpg') + '" alt="" loading="lazy" onerror="this.remove()">' : '';
  }
  function avatar(id, cls) {
    var former = byId[id] && !byId[id].active ? ' former' : '';
    return '<span class="av ' + (cls || '') + former + '" aria-hidden="true">' + esc(name(id).charAt(0).toUpperCase()) + photoFor(id) + '</span>';
  }

  // ---------- persistence ----------
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
  }
  function restore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved === 'object') {
      if (VIEWS.indexOf(saved.view) >= 0) state.view = saved.view;
      if (saved.season === 'all' || Career.seasons(data).indexOf(Number(saved.season)) >= 0) state.season = saved.season === 'all' ? 'all' : Number(saved.season);
      if (typeof saved.search === 'string') state.search = saved.search;
      if (typeof saved.sortKey === 'string' && SORTS[saved.sortKey]) state.sortKey = saved.sortKey;
      if (saved.sortDir === 'asc' || saved.sortDir === 'desc') state.sortDir = saved.sortDir;
      ['selected', 'profile', 'a', 'b'].forEach(function (k) { if (byId[saved[k]]) state[k] = saved[k]; });
    }
    var hash = location.hash.replace('#', '');
    if (VIEWS.indexOf(hash) >= 0) state.view = hash;
    var top = boardRows()[0];
    var first = top ? top.manager.id : (data.managers[0] || {}).id;
    if (!state.selected || !byId[state.selected].active) state.selected = first;
    if (!state.profile) state.profile = state.selected;
    if (!state.a) state.a = state.selected;
    if (!state.b || state.b === state.a) state.b = (data.managers.filter(function (m) { return m.id !== state.a; })[0] || {}).id;
  }

  // ---------- shared controls ----------
  function managerOptions(select, disabledId) {
    function opt(m) { return '<option value="' + esc(m.id) + '"' + (m.id === disabledId ? ' disabled' : '') + '>' + esc(m.name) + '</option>'; }
    var current = data.managers.filter(function (m) { return m.active; });
    var former = data.managers.filter(function (m) { return !m.active; });
    select.innerHTML = current.map(opt).join('') +
      (former.length ? '<optgroup label="Former managers">' + former.map(opt).join('') + '</optgroup>' : '');
  }

  function setView(view, opts) {
    if (VIEWS.indexOf(view) < 0) view = 'overview';
    state.view = view;
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* file: or sandboxed */ }
    render();
    if (opts && opts.top) {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  // ---------- league overview ----------
  var SORTS = {
    name: function (r) { return r.manager.name.toLowerCase(); },
    seasons: function (r) { return r.c.seasons.length; },
    wins: function (r) { return r.c.reg.w + r.c.reg.t / 2; },
    pct: function (r) { return r.c.regPct == null ? -1 : r.c.regPct; },
    playoffs: function (r) { return r.c.po.w + r.c.po.t / 2 + (r.c.poPct || 0) / 100; },
    titles: function (r) { return r.c.titles.length * 1000 + r.c.runnerUps.length * 10 + (r.c.regPct || 0); },
    goon: function (r) { return r.c.goon; },
    cock: function (r) { return r.c.cock; }
  };

  // The leaderboard and leader cards are the league's current managers only;
  // former managers stay reachable through the Manager / Versus dropdowns.
  function boardRows() {
    var rows = Career.leaderboard(data, scope()).filter(function (r) { return r.manager.active; });
    var key = SORTS[state.sortKey] ? state.sortKey : 'titles';
    var dir = state.sortDir === 'asc' ? 1 : -1;
    rows.sort(function (x, y) {
      var a = SORTS[key](x), b = SORTS[key](y);
      if (a < b) return -dir;
      if (a > b) return dir;
      return x.manager.name.localeCompare(y.manager.name);
    });
    return rows;
  }

  var ICON = {
    trophy: '<svg viewBox="0 0 24 24"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6"/></svg>',
    crown: '<svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/></svg>',
    bars: '<svg viewBox="0 0 24 24"><path d="M4 20h16M6 20v-5M10 20V11M14 20V7M18 20V4"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M3 6l6 6 4-4 8 8M21 11v5h-5"/></svg>',
    medal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="15" r="5"/><path d="M8.5 11L6 3h4l2 5 2-5h4l-2.5 8"/></svg>'
  };

  function leaderCard(kind, title, icon, lead, valueText, sub) {
    if (!lead) {
      return '<article class="lead ' + kind + '"><p class="lead-k">' + icon + esc(title) + '</p><p class="lead-empty">No leader yet</p><p class="lead-s">' + sub + '</p></article>';
    }
    var who = lead.rows.map(function (r) { return r.manager.id; });
    var names = who.map(name).join(' & ');
    return '<article class="lead ' + kind + '"><p class="lead-k">' + icon + esc(title) + '</p>' +
      '<div class="lead-v">' + who.map(function (id) { return avatar(id, kind === 'gold' ? 'gold' : ''); }).join('') +
      '<b>' + valueText + '</b>' + (who.length === 1 ? '<span class="who-n">' + esc(names) + '</span>' : '') + '</div>' +
      '<p class="lead-s">' + (who.length > 1 ? esc(names) + ' <span class="joint">Joint leaders</span> · ' : '') + sub + '</p></article>';
  }

  function renderLeaders(allRows) {
    var L = Career.leaders(allRows, scope());
    var titleYears = L.titles && L.titles.rows.length === 1 ? L.titles.rows[0].c.titles.join(' · ') : 'Final Yahoo standings';
    $('leaders').innerHTML =
      leaderCard('gold', 'Most championships', ICON.trophy, L.titles, L.titles ? L.titles.value : '', esc(titleYears)) +
      leaderCard('', 'Most Goon of the Week', ICON.crown, L.goon, L.goon ? L.goon.value : '', 'Top score of the week, regular season') +
      leaderCard('blue', 'Best regular-season win %', ICON.bars, L.winPct, L.winPct ? pctText(L.winPct.value) : '',
        'Min. ' + L.minGames + ' regular-season games');
  }

  function renderBoard() {
    var all = boardRows();
    var q = state.search.trim().toLowerCase();
    var rows = q ? all.filter(function (r) { return r.manager.name.toLowerCase().indexOf(q) >= 0; }) : all;
    var minGames = scope() === 'all' ? Career.MIN_GAMES_ALL : Career.MIN_GAMES_SEASON;
    var cols = [['name', 'Manager', ''], ['seasons', 'Seasons', 'c'], ['wins', 'Reg. W-L-T', 'c'], ['pct', 'Win %', 'r'],
                ['playoffs', 'Playoffs', 'c'], ['titles', 'Titles', 'c'], ['goon', 'Goon', 'c'], ['cock', 'Cock', 'c']];
    var head = '<thead><tr><th class="static">#</th>' + cols.map(function (c) {
      var sorted = state.sortKey === c[0];
      return '<th class="' + c[2] + '"' + (sorted ? ' aria-sort="' + (state.sortDir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '>' +
        '<button type="button" data-sort="' + c[0] + '">' + c[1] + '<span class="arr"></span></button></th>';
    }).join('') + '</tr></thead>';
    var body = rows.length ? rows.map(function (r, i) {
      var c = r.c, m = r.manager, below = c.reg.n < minGames;
      return '<tr tabindex="0" data-id="' + esc(m.id) + '" class="' + (m.id === state.selected ? 'sel' : '') + '" aria-selected="' + (m.id === state.selected) + '">' +
        '<td class="dim">' + (i + 1) + '</td>' +
        '<td><span class="who">' + avatar(m.id, c.titles.length ? 'gold' : '') + '<span>' + esc(m.name) +
          (m.active ? '' : '<span class="tag">Former</span>') + '<small>' + esc(c.lines.length ? c.lines[c.lines.length - 1].team : '') + '</small></span></span></td>' +
        '<td class="c">' + c.seasons.length + '</td>' +
        '<td class="c">' + rec(c.reg) + '</td>' +
        '<td class="r' + (below ? ' dim' : '') + '">' + pctText(c.regPct) + (below ? '*' : '') + '</td>' +
        '<td class="c">' + (c.po.n ? rec(c.po) : '<span class="dim">—</span>') + '</td>' +
        '<td class="c big-n' + (c.titles.length ? ' ring' : '') + '">' + c.titles.length + '</td>' +
        '<td class="c">' + c.goon + '</td><td class="c">' + c.cock + '</td></tr>';
    }).join('') : '<tr class="empty-row"><td colspan="9">No managers match “' + esc(state.search) + '”.</td></tr>';
    $('leaderboard').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('boardNote').textContent = 'Select a column to sort and a row to preview. * Fewer than ' + minGames +
      ' regular-season games, so not eligible for the win-% leader card. Former managers are in the Manager dropdowns.';
    renderPreview(all);
  }

  function renderPreview(rows) {
    var row = rows.filter(function (r) { return r.manager.id === state.selected; })[0] || rows[0];
    if (!row) { $('preview').innerHTML = '<p class="dim">No games in this season yet.</p>'; return; }
    state.selected = row.manager.id;
    var c = row.c, m = row.manager, all = Career.career(data, m.id, 'all');
    $('preview').innerHTML =
      '<div class="pv-top">' + avatar(m.id, 'lg') + '<div><h3>' + esc(m.name) + '</h3><p>' +
        esc(all.currentTeam) + ' · since ' + all.firstSeason + (m.active ? '' : ' · former') + '</p></div></div>' +
      (c.titles.length ? '<div class="chips">' + c.titles.map(function (y) { return '<span class="chip">★ ' + y + '</span>'; }).join('') + '</div>' : '') +
      '<dl class="pv-stats">' +
        '<div><dt>Regular season</dt><dd>' + rec(c.reg) + '</dd></div>' +
        '<div><dt>Win %</dt><dd>' + pctText(c.regPct) + '</dd></div>' +
        '<div><dt>Playoffs</dt><dd>' + (c.po.n ? rec(c.po) : '—') + '</dd></div>' +
        '<div><dt>Titles</dt><dd>' + c.titles.length + '</dd></div>' +
      '</dl>' +
      '<button type="button" class="btn pri" data-go="profile" data-id="' + esc(m.id) + '">Open full profile &rarr;</button>' +
      '<button type="button" class="btn sec" data-go="compare" data-id="' + esc(m.id) + '">Compare careers</button>';
  }

  function renderOverview() {
    var rows = Career.leaderboard(data, scope()).filter(function (r) { return r.manager.active; });
    $('scopeOverview').textContent = scopeLabel();
    if (document.activeElement !== $('search')) $('search').value = state.search;
    renderLeaders(rows);
    renderBoard();
  }

  // ---------- manager profile ----------
  function resultTag(ln) {
    var r = ln.result;
    if (!r) return '';
    var cls = r === 'Champion' ? 'champ' : r === 'Runner-up' ? 'ru' : r === 'Third place' ? 'third' :
      r === 'Missed playoffs' ? 'miss' : r === 'In progress' ? 'live' : r === 'Unavailable' ? 'na' : '';
    return '<span class="result ' + cls + '">' + esc(r) + '</span>';
  }
  function finishText(ln) {
    if (ln.rank == null) return ln.finished ? '<span class="na">Unavailable</span>' : '—';
    return ordinal(ln.rank) + (ln.teams ? ' of ' + ln.teams : '') + (ln.finished ? '' : ' <span class="dim">so far</span>');
  }

  function renderBanner(id, c, all) {
    var m = byId[id];
    var team = state.season === 'all' ? all.currentTeam : (c.lines[0] ? c.lines[0].team : '');
    var played = c.seasons.length > 0;
    var w = c.winnings;
    var summary = played ? [
      ['Reg. season', rec(c.reg)],
      ['Win %', pctText(c.regPct)],
      ['Playoff trips', c.playoffApps],
      ['Playoff record', c.po.n ? rec(c.po) : '—'],
      ['Titles', '<span style="color:var(--gold)">' + c.titles.length + '</span>'],
      ['Runner-up', c.runnerUps.length],
      ['Winnings', w ? money(w.gross) + '<small>' + (w.estimated ? 'Estimated · ' : '') + 'net ' + signed(w.net) + '</small>' : null]
    ] : [];
    $('banner').innerHTML =
      '<div class="rig rig-l" aria-hidden="true"></div><div class="rig rig-r" aria-hidden="true"></div>' +
      '<div class="ban-main">' + avatar(id, 'xl') + '<div>' +
        '<p class="eyebrow">' + (state.season === 'all' ? 'Career profile' : state.season + ' season') + '</p>' +
        '<h2>' + esc(m.name) + '</h2>' +
        (team ? '<p class="ban-team">' + esc(team) + '</p>' : '') +
        '<p class="ban-meta"><span>League debut <b>' + all.firstSeason + '</b></span><span><b>' + all.totalSeasons + '</b> ' +
          (all.totalSeasons === 1 ? 'season' : 'seasons') + '</span>' + (m.active ? '' : '<span><b>Former manager</b></span>') + '</p>' +
        (all.titles.length ? '<div class="chips ban-chips">' + all.titles.map(function (y) { return '<span class="chip">★ ' + y + ' Champion</span>'; }).join('') + '</div>'
          : '<p class="ban-meta"><span>No championships yet</span></p>') +
      '</div></div>' +
      (played ? '<dl class="summary">' + summary.map(function (s) {
        return '<div><dt>' + s[0] + '</dt><dd class="' + (s[1] == null ? 'na' : '') + '">' + (s[1] == null ? 'Unavailable' : s[1]) + '</dd></div>';
      }).join('') + '</dl>' : '<dl class="summary"><div style="grid-column:1/-1"><dt>' + esc(m.name) + ' didn’t play in ' + state.season + '</dt><dd class="na">Pick another season or All seasons</dd></div></dl>');
  }

  function renderTrophies(c) {
    var t = c.titles, ru = c.runnerUps, th = c.thirds;
    $('trophies').innerHTML =
      '<div class="trophies">' +
        '<div class="trophy gold">' + ICON.trophy + '<b>' + t.length + '</b><span>Championships</span><small>' + (t.length ? t.join(' · ') : 'None yet') + '</small></div>' +
        '<div class="trophy">' + ICON.crown + '<b>' + c.goon + '</b><span>Goon of the Week</span><small>Top score of the week</small></div>' +
        '<div class="trophy red">' + ICON.down + '<b>' + c.cock + '</b><span>Cock of the Week</span><small>Lowest score of the week</small></div>' +
      '</div>' +
      '<ul class="also">' +
        '<li>' + ICON.medal.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px;margin-right:6px"') + '<b>' + ru.length + '</b> runner-up ' + (ru.length === 1 ? 'finish' : 'finishes') + (ru.length ? ' (' + ru.join(', ') + ')' : '') + '</li>' +
        '<li>' + ICON.medal.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px;margin-right:6px"') + '<b>' + th.length + '</b> third-place ' + (th.length === 1 ? 'finish' : 'finishes') + (th.length ? ' (' + th.join(', ') + ')' : '') + '</li>' +
      '</ul>';
  }

  // Any game opens its box score (both lineups) in a pop-up.
  function boxLink(me, x, html) {
    return '<button type="button" class="bx-link" data-bx="' + x.season + '|' + x.week + '|' + esc(me) + '|' + esc(x.opp) + '">' + html + '</button>';
  }
  function openBox(key) {
    var k = key.split('|'), season = Number(k[0]), week = Number(k[1]);
    var g = data.matchups.filter(function (x) {
      return x.season === season && x.week === week && x.status === 'final' &&
        ((x.managerA === k[2] && x.managerB === k[3]) || (x.managerA === k[3] && x.managerB === k[2]));
    })[0];
    if (!g || !window.BoxScore) return;
    function team(m) { return ((data.teams || {})[g.season] || {})[m] || ''; }
    var label = g.gameType === 'regular' ? 'Week ' + g.week : (g.round || (g.gameType === 'consolation' ? 'Consolation' : 'Playoffs')) + ' · Week ' + g.week;
    BoxScore.open({ id: g.id, season: g.season, week: g.week, label: label,
                    a: { id: g.managerA, name: name(g.managerA), team: team(g.managerA), score: g.scoreA },
                    b: { id: g.managerB, name: name(g.managerB), team: team(g.managerB), score: g.scoreB } });
  }

  function renderBests(c) {
    var b = c.bests, me = state.profile;
    function item(k, v, d) {
      return '<li><span class="k">' + k + '</span><span class="v">' + (v == null ? '<span class="na">—</span>' : v) + '</span><span class="d">' + (d || '') + '</span></li>';
    }
    function vs(x) { return boxLink(me, x, 'vs ' + esc(name(x.opp)) + ' · ' + when(x) + ' · ' + esc(x.type)); }
    $('scopeBests').textContent = scopeLabel();
    $('bests').innerHTML =
      item('Highest week', b.highWeek && pts(b.highWeek.score), b.highWeek && vs(b.highWeek)) +
      item('Biggest win', b.bigWin && '+' + pts(b.bigWin.margin), b.bigWin && pts(b.bigWin.score) + '–' + pts(b.bigWin.against) + ' ' + vs(b.bigWin)) +
      item('Longest win streak', b.streak && b.streak.count, b.streak && (b.streak.count === 1 ? when(b.streak.from) : when(b.streak.from) + ' to ' + when(b.streak.to)) + ' · includes playoffs') +
      item('Best reg. season', b.bestSeason && b.bestSeason.w + '-' + b.bestSeason.l + (b.bestSeason.t ? '-' + b.bestSeason.t : ''),
        b.bestSeason && b.bestSeason.season + ' · ' + pctText(b.bestSeason.pct) + (b.bestSeason.inProgress ? ' · in progress' : '')) +
      item('Highest-scoring season', b.topSeason && pts(b.topSeason.pf), b.topSeason && b.topSeason.season + ' · ' + b.topSeason.perGame.toFixed(1) + ' per game' + (b.topSeason.inProgress ? ' · in progress' : '')) +
      item('Closest win', b.closeWin && '+' + pts(b.closeWin.margin), b.closeWin && pts(b.closeWin.score) + '–' + pts(b.closeWin.against) + ' ' + vs(b.closeWin));
  }

  function seasonDetail(id, ln) {
    var path = ln.playoffGames.length ? '<ul>' + ln.playoffGames.map(function (p) {
      return '<li>' + boxLink(id, { season: p.game.season, week: p.game.week, opp: p.side.opp },
        (p.side.result === 'W' ? 'Beat ' : p.side.result === 'L' ? 'Lost to ' : 'Tied ') + esc(name(p.side.opp)) + ' ' +
        pts(p.side.mine) + '–' + pts(p.side.theirs) + ' · ' + esc(p.game.round || 'Playoffs')) + '</li>';
    }).join('') + '</ul>' : (ln.finished ? 'Didn’t make the playoffs' : 'Season in progress');
    var weeks = ln.weeks.slice().sort(function (a, b) { return a.week - b.week; });
    var hi = weeks.reduce(function (m, w) { return !m || w.score > m.score ? w : m; }, null);
    var lo = weeks.reduce(function (m, w) { return !m || w.score < m.score ? w : m; }, null);
    var top = hi ? hi.score : 1;
    var w = ln.winnings;
    var cash = !w ? '<span class="na">Unavailable</span>' : (w.parts.length ? w.parts.map(function (p) { return esc(p.label) + ' ' + money(p.amount); }).join(' + ') + ' = ' + money(w.total) : '$0') +
      '<br><span class="dim">' + money(w.buyIn) + ' buy-in' + (w.estimated ? ' (estimated)' : '') + (w.final ? '' : ' · season not finished') + '</span>';
    var awards = [];
    if (ln.goon.length) awards.push('Goon: Week ' + ln.goon.map(function (a) { return a.week; }).join(', '));
    if (ln.cock.length) awards.push('Cock: Week ' + ln.cock.map(function (a) { return a.week; }).join(', '));
    return '<tr class="detail"><td colspan="8"><dl class="detail-grid">' +
      '<div><dt>Playoff path</dt>' + path + '</div>' +
      '<div><dt>Best / worst week</dt>' + (hi ? boxLink(id, { season: ln.season, week: hi.week, opp: hi.opp }, pts(hi.score) + ' (Wk ' + hi.week + ', vs ' + esc(name(hi.opp)) + ')') + '<br>' +
        boxLink(id, { season: ln.season, week: lo.week, opp: lo.opp }, pts(lo.score) + ' (Wk ' + lo.week + ', vs ' + esc(name(lo.opp)) + ')') : '—') + '</div>' +
      '<div><dt>Points against · awards</dt>' + pts(ln.reg.pa) + ' against' + (awards.length ? '<br>' + awards.join('<br>') : '') + '</div>' +
      '<div><dt>Winnings</dt>' + cash + '</div>' +
      '</dl>' +
      (weeks.length ? '<div class="weeks">' + weeks.map(function (x) {
        var label = 'Week ' + x.week + ': ' + pts(x.score) + ', ' + (x.result === 'W' ? 'beat ' : x.result === 'T' ? 'tied ' : 'lost to ') + name(x.opp);
        return '<button type="button" class="bar' + (x.result === 'W' ? ' w' : x.result === 'T' ? ' t' : '') + '" style="height:' + Math.max(8, Math.round(x.score / top * 100)) + '%"' +
          ' data-bx="' + ln.season + '|' + x.week + '|' + esc(id) + '|' + esc(x.opp) + '" title="' + esc(label) + '" aria-label="' + esc(label) + ' (open box score)"></button>';
      }).join('') + '</div><p class="weeks-cap">Regular-season scores, week by week · gold = win, blue = loss · select a bar for its box score</p>' : '') +
      '</td></tr>';
  }

  function renderSeasons(id, c) {
    var lines = c.lines.slice().sort(function (a, b) { return b.season - a.season; });
    var head = '<thead><tr><th class="static">Season</th><th class="static">Team</th><th class="static c">Reg. W-L-T</th><th class="static r">Points for</th>' +
      '<th class="static">Playoff result</th><th class="static c">Finish</th><th class="static c">Goon</th><th class="static c">Cock</th></tr></thead>';
    var body = lines.length ? lines.map(function (ln) {
      var open = !!openSeasons[ln.season];
      return '<tr class="row' + (open ? ' open' : '') + '" data-season="' + ln.season + '">' +
        '<td><button type="button" class="season-btn" aria-expanded="' + open + '"><span class="caret"></span>' + ln.season + '</button></td>' +
        '<td>' + esc(ln.team) + '</td><td class="c">' + rec(ln.reg) + '</td><td class="r">' + pts(ln.reg.pf) + '</td>' +
        '<td>' + resultTag(ln) + '</td><td class="c">' + finishText(ln) + '</td>' +
        '<td class="c">' + ln.goon.length + '</td><td class="c">' + ln.cock.length + '</td></tr>' +
        (open ? seasonDetail(id, ln) : '');
    }).join('') : '<tr class="empty-row"><td colspan="8">No games in this season.</td></tr>';
    $('seasonTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  function renderMilestones(id) {
    var ms = Career.milestones(data, id);
    $('milestones').innerHTML = ms.map(function (m) {
      var cls = m.kind === 'title' ? 'g' : m.kind === 'final' ? 's' : '';
      return '<li class="' + cls + '"><b>' + m.season + '</b><span>' + esc(m.title) + '</span><small>' + esc(m.note) + '</small></li>';
    }).join('');
  }

  function renderProfile() {
    var id = state.profile;
    managerOptions($('profileSel'), null);
    $('profileSel').value = id;
    var c = Career.career(data, id, scope());
    var all = state.season === 'all' ? c : Career.career(data, id, 'all');
    renderBanner(id, c, all);
    renderTrophies(c);
    renderBests(c);
    renderSeasons(id, c);
    renderMilestones(id);
  }

  // ---------- compare ----------
  function renderCompare() {
    managerOptions($('cmpA'), state.b);
    managerOptions($('cmpB'), state.a);
    $('cmpA').value = state.a;
    $('cmpB').value = state.b;
    var A = Career.career(data, state.a, scope()), B = Career.career(data, state.b, scope());
    var allA = Career.career(data, state.a, 'all'), allB = Career.career(data, state.b, 'all');
    function head(id, c, all, side) {
      var t = all.titles.length;
      var info = '<div><h3>' + esc(name(id)) + '</h3><p>' + t + (t === 1 ? ' title' : ' titles') + ' · since ' + all.firstSeason + '</p></div>';
      return '<div class="cmp-side ' + side + '">' + (side === 'a' ? avatar(id, 'lg') + info : info + avatar(id, 'lg gold')) + '</div>';
    }
    $('cmpHead').innerHTML = head(state.a, A, allA, 'a') + head(state.b, B, allB, 'b');
    $('scopeCompare').textContent = scopeLabel();

    // [label, sub, value A, value B, number A, number B, higher is better?]
    function winsOf(c) { return c.seasons.length ? c.reg.w : null; }
    var rows = [
      ['Seasons played', '', A.seasons.length, B.seasons.length, null, null, false],
      ['Reg. season wins', rec(A.reg) + ' vs ' + rec(B.reg), winsOf(A), winsOf(B), winsOf(A), winsOf(B), true],
      ['Reg. season win %', '', pctText(A.regPct), pctText(B.regPct), A.regPct, B.regPct, true],
      ['Playoff appearances', '', A.playoffApps, B.playoffApps, A.playoffApps, B.playoffApps, true],
      ['Playoff record', 'Compared by playoff win %', A.po.n ? rec(A.po) : '—', B.po.n ? rec(B.po) : '—', A.poPct, B.poPct, true],
      ['Championships', '', A.titles.length, B.titles.length, A.titles.length, B.titles.length, true],
      ['Runner-up finishes', '', A.runnerUps.length, B.runnerUps.length, A.runnerUps.length, B.runnerUps.length, true],
      ['Goon of the Week', '', A.goon, B.goon, A.goon, B.goon, true],
      ['Cock of the Week', 'Shown, never judged', A.cock, B.cock, null, null, false],
      ['Highest weekly score', '', A.bests.highWeek ? pts(A.bests.highWeek.score) : '—', B.bests.highWeek ? pts(B.bests.highWeek.score) : '—',
        A.bests.highWeek ? A.bests.highWeek.score : null, B.bests.highWeek ? B.bests.highWeek.score : null, true],
      ['Winnings', (A.winnings && A.winnings.estimated) || (B.winnings && B.winnings.estimated) ? 'Estimated from payout rules' : '',
        A.winnings ? money(A.winnings.gross) : null, B.winnings ? money(B.winnings.gross) : null,
        A.winnings ? A.winnings.gross : null, B.winnings ? B.winnings.gross : null, true]
    ];
    $('cmpRows').innerHTML = rows.map(function (r) {
      var judge = r[6] && r[4] != null && r[5] != null && r[4] !== r[5];
      var aWin = judge && r[4] > r[5], bWin = judge && r[5] > r[4];
      function cell(v, win, side) {
        return '<span class="v ' + side + (win ? ' win' : '') + '">' + (v == null ? '<span class="na">Unavailable</span>' : v) + '</span>';
      }
      return '<li>' + cell(r[2], aWin, 'a') + '<span class="k">' + r[0] + (r[1] ? '<small>' + esc(r[1]) + '</small>' : '') + '</span>' + cell(r[3], bWin, 'b') + '</li>';
    }).join('');
  }

  // ---------- share ----------
  function summaryText() {
    var id = state.profile, c = Career.career(data, id, scope()), all = Career.career(data, id, 'all');
    var lines = ['Gooncocks Career Center: ' + name(id) + ' (' + (state.season === 'all' ? 'career' : state.season + ' season') + ')'];
    if (!c.seasons.length) {
      lines.push('Didn’t play in ' + state.season + '.');
    } else {
      lines.push('Debut ' + all.firstSeason + ' · ' + all.totalSeasons + (all.totalSeasons === 1 ? ' season' : ' seasons') + (all.currentTeam ? ' · ' + all.currentTeam : ''));
      lines.push('Regular season: ' + rec(c.reg) + ' (' + pctText(c.regPct) + ')');
      lines.push('Playoffs: ' + (c.po.n ? rec(c.po) + ' in ' + c.playoffApps + (c.playoffApps === 1 ? ' trip' : ' trips') : 'none'));
      lines.push('Championships: ' + (c.titles.length ? c.titles.length + ' (' + c.titles.join(', ') + ')' : '0') +
        (c.runnerUps.length ? ' · Runner-up: ' + c.runnerUps.join(', ') : ''));
      lines.push('Goon of the Week: ' + c.goon + ' · Cock of the Week: ' + c.cock);
      if (c.bests.highWeek) lines.push('Highest week: ' + pts(c.bests.highWeek.score) + ' (' + when(c.bests.highWeek) + ')');
      if (c.winnings) lines.push('Winnings: ' + money(c.winnings.gross) + (c.winnings.estimated ? ' (estimated from payout rules)' : ''));
    }
    lines.push(data.source === 'yahoo' ? '(From the league’s Yahoo history.)' : '(Demo data, not real league results.)');
    return lines.join('\n');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }
  function share() {
    var text = summaryText();
    function fallback() {
      $('copyText').value = text;
      $('copyFallback').hidden = false;
      $('copyText').focus();
      $('copyText').select();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Career summary copied'); }, fallback);
    } else fallback();
  }

  // ---------- render + wiring ----------
  function render() {
    VIEWS.forEach(function (v) {
      $('view-' + v).hidden = v !== state.view;
      var tab = $('tab-' + v);
      tab.setAttribute('aria-selected', String(v === state.view));
      tab.tabIndex = v === state.view ? 0 : -1;
    });
    $('seasonSel').value = String(state.season);
    if (state.view === 'overview') renderOverview();
    if (state.view === 'profile') renderProfile();
    if (state.view === 'compare') renderCompare();
    save();
  }

  function openProfile(id) {
    state.profile = id; state.selected = id; openSeasons = {};
    setView('profile', { top: true });
  }
  function openCompare(id) {
    state.a = id;
    if (!state.b || state.b === id) {
      var rows = boardRows().filter(function (r) { return r.manager.id !== id; });
      state.b = rows.length ? rows[0].manager.id : data.managers.filter(function (m) { return m.id !== id; })[0].id;
    }
    setView('compare', { top: true });
  }

  function wire() {
    var seasons = Career.seasons(data).slice().reverse();
    $('seasonSel').innerHTML = '<option value="all">All seasons</option>' + seasons.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');
    $('seasonSel').addEventListener('change', function (e) {
      state.season = e.target.value === 'all' ? 'all' : Number(e.target.value);
      openSeasons = {};
      render();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var i = VIEWS.indexOf(state.view) + (e.key === 'ArrowRight' ? 1 : -1);
        setView(VIEWS[(i + VIEWS.length) % VIEWS.length]);
        $('tab-' + state.view).focus();
      });
    });
    $('search').addEventListener('input', function (e) { state.search = e.target.value; renderBoard(); save(); });
    $('leaderboard').addEventListener('click', function (e) {
      var sort = e.target.closest('[data-sort]');
      if (sort) {
        var key = sort.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        else { state.sortKey = key; state.sortDir = key === 'name' ? 'asc' : 'desc'; }
        renderBoard(); save();
        var again = $('leaderboard').querySelector('[data-sort="' + key + '"]');
        if (again && e.detail === 0) again.focus();
        return;
      }
      var row = e.target.closest('tr[data-id]');
      if (row) { state.selected = row.getAttribute('data-id'); renderBoard(); save(); }
    });
    $('leaderboard').addEventListener('keydown', function (e) {
      var row = e.target.closest && e.target.closest('tr[data-id]');
      if (!row || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      var id = row.getAttribute('data-id');
      if (e.key === 'Enter' && state.selected === id) { openProfile(id); return; }
      state.selected = id; renderBoard(); save();
      var again = $('leaderboard').querySelector('tr[data-id="' + id + '"]');
      if (again) again.focus();
    });
    $('preview').addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (!b) return;
      if (b.getAttribute('data-go') === 'profile') openProfile(b.getAttribute('data-id'));
      else openCompare(b.getAttribute('data-id'));
    });
    $('backBtn').addEventListener('click', function () { state.selected = state.profile; setView('overview', { top: true }); });
    $('profileSel').addEventListener('change', function (e) { state.profile = e.target.value; state.selected = e.target.value; openSeasons = {}; render(); });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-bx]');
      if (b) openBox(b.getAttribute('data-bx'));
    });
    $('seasonTable').addEventListener('click', function (e) {
      var row = e.target.closest('tr.row');
      if (!row) return;
      var s = row.getAttribute('data-season');
      openSeasons[s] = !openSeasons[s];
      renderSeasons(state.profile, Career.career(data, state.profile, scope()));
      var btn = $('seasonTable').querySelector('tr[data-season="' + s + '"] .season-btn');
      if (btn && e.detail === 0) btn.focus();
    });
    $('shareBtn').addEventListener('click', share);
    $('copyClose').addEventListener('click', function () { $('copyFallback').hidden = true; $('shareBtn').focus(); });
    $('cmpA').addEventListener('change', function (e) { if (e.target.value !== state.b) state.a = e.target.value; render(); });
    $('cmpB').addEventListener('change', function (e) { if (e.target.value !== state.a) state.b = e.target.value; render(); });
    $('swapBtn').addEventListener('click', function () { var t = state.a; state.a = state.b; state.b = t; render(); });
    window.addEventListener('hashchange', function () {
      var v = location.hash.replace('#', '');
      if (VIEWS.indexOf(v) >= 0 && v !== state.view) { state.view = v; render(); }
    });
  }

  function start(loaded) {
    data = loaded;
    byId = {};
    data.managers.forEach(function (m) { byId[m.id] = m; });
    var seasons = Career.seasons(data);
    var range = seasons.length ? seasons[0] + '–' + seasons[seasons.length - 1] : '';
    $('sourceBadge').textContent = data.source === 'yahoo' ? 'Yahoo league history · ' + range : 'Demo data · not from Yahoo';
    var p = data.payouts;
    var confirmed = p ? Object.keys(p.seasons).filter(function (y) { return p.seasons[y].confirmed; }).map(Number).sort() : [];
    $('footNote').textContent = (data.source === 'yahoo' ? 'Records, playoffs and final finishes come from the league’s Yahoo history (' + range + '). ' : 'Demo data. ') +
      'Goon and Cock of the Week are the top and bottom regular-season scores each completed week. Winnings are estimates from the league’s payout rules' +
      (confirmed.length ? ' (buy-ins confirmed for ' + confirmed[0] + '–' + confirmed[confirmed.length - 1] + ', $' + (p.DEFAULT ? p.DEFAULT.buyIn : 150) + ' assumed before that)' : '') +
      ', not payment records.';
    restore();
    wire();
    render();
  }

  CareerData.load().then(start).catch(function (err) {
    var box = document.createElement('p');
    box.className = 'load-error';
    box.textContent = 'The league history could not be loaded. ' + err.message;
    document.querySelector('.viewbar').after(box);
    console.error(err);
  });
})();
