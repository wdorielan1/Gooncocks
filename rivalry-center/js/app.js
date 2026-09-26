/*
 * Rivalry Center UI. Reads the normalized history from RivalryData,
 * calculates with Rivalry, and renders every panel from the same state:
 *   { a, b, season, type, consolation }
 * Selections are remembered in this browser (localStorage) when allowed.
 */
(function () {
  var STORE_KEY = 'gooncocks-rivalry-center';
  var RECENT_COUNT = 5;
  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
               'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

  var $ = function (id) { return document.getElementById(id); };
  var data, ids, byId, seasons; // ids: current managers (grid + spotlights)
  var state = { a: 'will', b: 'gabe', season: 'all', type: 'all', consolation: false };
  var showAll = false;
  var hoverPair = null;

  // ---------- small helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function name(id) { return byId[id] ? byId[id].name : id; }
  function pts(n) { return n.toFixed(2); }
  function word(n) { return n < WORDS.length ? WORDS[n] : String(n); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  // Word joiners keep a record like 9–7 from breaking across lines.
  function rec(w, l, t) { return w + '\u2060–\u2060' + l + (t ? '\u2060–\u2060' + t : ''); }

  function slug(s) { return String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  // Letter badge, covered by the manager's headshot when one exists.
  function avatar(id, cls) {
    var photo = data.photoBaseUrl
      ? '<img src="' + esc(data.photoBaseUrl + slug(id) + '.jpg') + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<span class="av ' + (cls || '') + '" aria-hidden="true">' + esc(name(id).charAt(0).toUpperCase()) + photo + '</span>';
  }
  function setAvatar(el, id) {
    el.innerHTML = '';
    el.textContent = name(id).charAt(0).toUpperCase();
    if (data.photoBaseUrl) {
      var img = new Image();
      img.alt = '';
      img.onerror = function () { img.remove(); };
      img.src = data.photoBaseUrl + slug(id) + '.jpg';
      el.appendChild(img);
    }
  }

  // Team name for the scope: that season's, or the most recent one on file.
  function teamName(id) {
    var list = state.season === 'all' ? Object.keys(data.teams).sort().reverse() : [String(state.season)];
    for (var i = 0; i < list.length; i++) {
      var t = data.teams[list[i]];
      if (t && t[id]) return t[id];
    }
    return '';
  }

  function gameLabel(g) {
    if (g.gameType === 'regular') return 'Week ' + g.week;
    if (g.gameType === 'consolation') return 'Consolation · Week ' + g.week;
    return g.round || ('Playoffs · Week ' + g.week);
  }
  function when(g) { return g.season + ' ' + gameLabel(g); }

  function scopeGames() { return data.matchups.filter(function (g) { return Rivalry.inScope(g, state); }); }
  function playoffGames() {
    return data.matchups.filter(function (g) {
      return g.status === 'final' && g.gameType === 'playoff' && (state.season === 'all' || g.season === Number(state.season));
    });
  }
  function scopeText() {
    var s = state.season === 'all' ? 'all seasons' : state.season + ' season';
    var t = state.type === 'regular' ? 'regular season' : state.type === 'playoff' ? 'playoffs' : 'all games';
    return s + ', ' + t + (state.consolation && state.type !== 'regular' ? ' (with consolation)' : '');
  }

  // ---------- persistence ----------
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: fine */ }
  }
  function restore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || typeof saved !== 'object') return;
    if (byId[saved.a] && byId[saved.b] && saved.a !== saved.b) { state.a = saved.a; state.b = saved.b; }
    if (saved.season === 'all' || seasons.indexOf(Number(saved.season)) >= 0) state.season = saved.season === 'all' ? 'all' : Number(saved.season);
    if (['all', 'regular', 'playoff'].indexOf(saved.type) >= 0) state.type = saved.type;
    state.consolation = !!saved.consolation;
  }

  // ---------- controls ----------
  function buildControls() {
    function option(m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }
    var current = data.managers.filter(function (m) { return m.active; });
    var former = data.managers.filter(function (m) { return !m.active; });
    // People who have left the league stay pickable, grouped after everyone else.
    var opts = current.map(option).join('') +
      (former.length ? '<optgroup label="Former managers">' + former.map(option).join('') + '</optgroup>' : '');
    $('managerA').innerHTML = opts;
    $('managerB').innerHTML = opts;
    $('seasonSel').innerHTML = '<option value="all">All seasons</option>' +
      seasons.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');

    $('managerA').addEventListener('change', function (e) { setPair(e.target.value, state.b); });
    $('managerB').addEventListener('change', function (e) { setPair(state.a, e.target.value); });
    $('swapBtn').addEventListener('click', function () { setPair(state.b, state.a); });
    $('seasonSel').addEventListener('change', function (e) {
      state.season = e.target.value === 'all' ? 'all' : Number(e.target.value);
      render();
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="gameType"]'), function (r) {
      r.addEventListener('change', function () { if (r.checked) { state.type = r.value; render(); } });
    });
    $('consolation').addEventListener('change', function (e) { state.consolation = e.target.checked; render(); });
    $('controls').addEventListener('submit', function (e) { e.preventDefault(); });
    $('shareBtn').addEventListener('click', share);
    $('moreBtn').addEventListener('click', function () { showAll = !showAll; renderReceipts(currentSeries()); });
    $('copyClose').addEventListener('click', function () { $('copyFallback').hidden = true; $('shareBtn').focus(); });
  }

  function syncControls() {
    $('managerA').value = state.a;
    $('managerB').value = state.b;
    // The same manager can't be on both sides.
    Array.prototype.forEach.call($('managerA').options, function (o) { o.disabled = o.value === state.b; });
    Array.prototype.forEach.call($('managerB').options, function (o) { o.disabled = o.value === state.a; });
    $('seasonSel').value = String(state.season);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="gameType"]'), function (r) { r.checked = r.value === state.type; });
    $('consolation').checked = state.consolation;
    $('consolation').disabled = state.type === 'regular';
    setAvatar($('pickAvA'), state.a);
    setAvatar($('pickAvB'), state.b);
  }

  function setPair(a, b, scroll) {
    if (!byId[a] || !byId[b]) return;
    if (a === b) b = state.a === a ? state.b : state.a; // never allow a manager against themselves
    if (a === b) return;
    var changed = a !== state.a || b !== state.b;
    state.a = a; state.b = b;
    if (changed) showAll = false;
    render();
    if (scroll) {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('feature').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  // ---------- featured series ----------
  function currentSeries() { return Rivalry.series(scopeGames(), state.a, state.b); }

  function headline(s) {
    var A = name(s.a), B = name(s.b);
    if (!s.meetings) return A + ' and ' + B + ' have never met in ' + scopeText() + '.';
    var st = s.streak;
    var streakBit = '';
    if (st && st.winner && st.count >= 2) streakBit = name(st.winner) + ' has won the last ' + word(st.count) + '.';
    else if (st && st.winner) streakBit = name(st.winner) + ' won the last meeting.';
    else streakBit = 'The last meeting ended in a tie.';

    if (!s.leader) {
      var tied = 'Series tied ' + rec(s.winsA, s.winsB, s.ties) + '.';
      return s.meetings === 1 ? A + ' and ' + B + ' have met once. It ended in a tie.' : tied + ' ' + streakBit;
    }
    var L = name(s.leader);
    var lw = Math.max(s.winsA, s.winsB), ll = Math.min(s.winsA, s.winsB);
    if (s.meetings === 1) return L + ' won the only meeting.';
    if (ll === 0) return L + ' is a perfect ' + rec(lw, 0, s.ties) + ' in this one.';
    if (st && st.winner && st.winner !== s.leader && st.count >= 2) return L + ' owns the record. ' + name(st.winner) + ' owns the last ' + word(st.count) + '.';
    if (st && st.winner === s.leader && st.count >= 2) return L + ' leads the series and has won the last ' + word(st.count) + '.';
    if (lw / s.meetings >= 0.75 && s.meetings >= 4) return L + ' has owned this one, ' + rec(lw, ll, s.ties) + '.';
    return L + ' leads the series ' + rec(lw, ll, s.ties) + '. ' + streakBit;
  }

  function stat(label, value, sub, none) {
    return '<div class="stat"><dt>' + label + '</dt><dd class="' + (none ? 'none' : '') + '">' + value +
      (sub ? '<small>' + sub + '</small>' : '') + '</dd></div>';
  }

  function renderFeature(s) {
    var scope = state.season === 'all' ? 'All-time series' : state.season + ' season series';
    if (state.type === 'regular') scope += ' · Regular season';
    if (state.type === 'playoff') scope += ' · Playoffs';
    if (state.consolation && state.type !== 'regular') scope += ' · Incl. consolation';
    $('fxScope').textContent = scope;

    $('fxNameA').textContent = name(s.a);
    $('fxNameB').textContent = name(s.b);
    $('fxTeamA').textContent = teamName(s.a);
    $('fxTeamB').textContent = teamName(s.b);
    setAvatar($('fxAvA'), s.a);
    setAvatar($('fxAvB'), s.b);
    $('fxWinsA').textContent = s.winsA;
    $('fxWinsB').textContent = s.winsB;
    $('fxMeetings').textContent = s.meetings === 1 ? '1 meeting' : s.meetings + ' meetings' + (s.ties ? ' · ' + s.ties + (s.ties === 1 ? ' tie' : ' ties') : '');
    var total = s.meetings || 1;
    $('barA').style.width = (s.meetings ? s.winsA / total * 100 : 50) + '%';
    $('barT').style.width = (s.ties / total * 100) + '%';
    $('barB').style.width = (s.meetings ? s.winsB / total * 100 : 50) + '%';
    $('fxHeadline').textContent = headline(s);

    var leader = s.meetings
      ? (s.leader ? stat('Series leader', esc(name(s.leader)) + ', ' + Math.max(s.winsA, s.winsB) + ' wins') : stat('Series leader', 'Series tied'))
      : stat('Series leader', 'No meetings yet', '', true);
    var streak = !s.streak ? stat('Current streak', 'No meetings yet', '', true)
      : s.streak.winner ? stat('Current streak', esc(name(s.streak.winner)) + ', W' + s.streak.count)
      : stat('Current streak', 'Tied last time', '', false);

    var p = Rivalry.series(playoffGames(), s.a, s.b);
    var playoff = !p.meetings ? stat('Playoff record', 'No playoff meetings', '', true)
      : p.leader ? stat('Playoff record', esc(name(p.leader)) + ' leads ' + rec(Math.max(p.winsA, p.winsB), Math.min(p.winsA, p.winsB), p.ties), p.meetings + ' playoff ' + (p.meetings === 1 ? 'game' : 'games'))
      : stat('Playoff record', 'Split ' + rec(p.winsA, p.winsB, p.ties), p.meetings + ' playoff games');

    var closest = s.closest
      ? stat('Closest finish', pts(s.closest.margin) + ' pts',
          (s.closest.winner ? esc(name(s.closest.winner)) + ' won' : 'Tie') + ' · ' + esc(when(s.closest.game)))
      : stat('Closest finish', '—', '', true);
    var biggest = s.biggest
      ? stat('Biggest victory', pts(s.biggest.margin) + ' pts', esc(name(s.biggest.winner)) + ' · ' + esc(when(s.biggest.game)))
      : stat('Biggest victory', '—', '', true);
    $('fxStats').innerHTML = leader + streak + playoff + closest + biggest;
  }

  // ---------- spotlights ----------
  var ICONS = {
    closest: '<svg viewBox="0 0 48 48"><path d="M20 28l8-8"/><path d="M22 14l4-4a8 8 0 0 1 11.3 11.3l-4 4"/><path d="M26 34l-4 4a8 8 0 0 1-11.3-11.3l4-4"/><path d="M34 34l5 5M36 30h5M30 36v5" stroke-dasharray="1 0"/></svg>',
    onesided: '<svg viewBox="0 0 48 48"><circle cx="22" cy="26" r="15"/><circle cx="22" cy="26" r="9"/><circle cx="22" cy="26" r="3"/><path d="M22 26L40 8M34 8h6v6"/></svg>',
    grudge: '<svg viewBox="0 0 48 48"><path d="M15 8h18v10a9 9 0 0 1-18 0z"/><path d="M15 11H8v3a7 7 0 0 0 7 7M33 11h7v3a7 7 0 0 1-7 7M24 27v7M16 41h16M19 34h10v7H19z"/></svg>'
  };

  function spotCard(kind, kicker, s, note, rule, extra) {
    var cls = 'spot spot-' + kind;
    if (!s) {
      return '<button type="button" class="' + cls + ' spot-empty" disabled><div class="spot-top"><span class="spot-ico" aria-hidden="true">' + ICONS[kind] +
        '</span><div><p class="spot-kicker">' + kicker + '</p><p class="spot-rec">' + esc(note) + '</p><p class="spot-rule">' + esc(rule) +
        '</p></div></div><span class="spot-cta">Nothing to show yet</span></button>';
    }
    var lead = s.leader || s.a;
    var other = lead === s.a ? s.b : s.a;
    var lw = lead === s.a ? s.winsA : s.winsB, ll = lead === s.a ? s.winsB : s.winsA;
    return '<button type="button" class="' + cls + '" data-a="' + esc(lead) + '" data-b="' + esc(other) + '"' +
      ' aria-label="' + esc(kicker + ': ' + name(lead) + ' versus ' + name(other) + ', ' + rec(lw, ll, s.ties) + (extra || '') + '. View rivalry.') + '">' +
      '<div class="spot-top"><span class="spot-ico" aria-hidden="true">' + ICONS[kind] + '</span><div>' +
      '<p class="spot-kicker">' + kicker + '</p>' +
      '<h3>' + esc(name(lead)) + ' vs ' + esc(name(other)) + '</h3>' +
      '<p class="spot-rec">' + rec(lw, ll, s.ties) + '</p>' +
      '<p class="spot-note">' + esc(note) + '</p>' +
      '<p class="spot-rule">' + esc(rule) + '</p></div></div>' +
      '<span class="spot-cta">View rivalry &rarr;</span></button>';
  }

  function renderSpots(games) {
    var single = state.season !== 'all';
    var sp = Rivalry.spotlights(games, playoffGames(), ids, single);
    var min = sp.minMeetings;
    var scope = single ? 'in ' + state.season : 'all-time';

    var c = sp.closest;
    var cNote = c ? (c.leader ? name(c.leader) + ' edges it by ' + word(Math.abs(c.winsA - c.winsB)) + '.' : cap(word(c.meetings)) + ' games. Still no winner.') : 'No pairing has met ' + min + '+ times ' + scope + '.';
    var o = sp.oneSided;
    var oLoser = o ? name(o.leader === o.a ? o.b : o.a) : '';
    var oNote = o ? oLoser + ' has some catching up to do.' : 'No pairing has met ' + min + '+ times ' + scope + '.';
    var g = sp.grudge;
    var gNote = g ? (g.leader ? word(g.meetings).replace(/^./, function (x) { return x.toUpperCase(); }) + ' playoff meetings. ' + name(g.leader) + ' keeps winning when it counts.' : 'Split ' + g.meetings + ' playoff meetings.') : 'No repeat playoff matchups ' + scope + '.';

    $('spots').innerHTML =
      spotCard('closest', 'Closest rivalry', c, cNote, 'Most even record, min. ' + min + ' meetings, ' + scopeText() + '.') +
      spotCard('onesided', 'Most one-sided', o, oNote, 'Highest win share, min. ' + min + ' meetings, ' + scopeText() + '.') +
      spotCard('grudge', 'Playoff grudge', g, gNote, 'Playoff games only (no consolation), ' + (single ? state.season : 'all seasons') + '. Most repeat meetings.', ' in the playoffs');

    Array.prototype.forEach.call($('spots').querySelectorAll('.spot[data-a]'), function (btn) {
      btn.addEventListener('click', function () { setPair(btn.getAttribute('data-a'), btn.getAttribute('data-b'), true); });
    });
  }

  // ---------- who owns who grid ----------
  function cellInfo(r) {
    if (!r.n) return { cls: 'none', label: '·' };
    if (r.w === r.l) return { cls: 'even', label: rec(r.w, r.l, r.t) };
    // Two shades each way: a clear edge (65%+ of games) gets the bold color.
    var share = Math.max(r.w, r.l) / r.n;
    return { cls: (r.w > r.l ? 'win' : 'loss') + (share >= 0.65 ? ' strong' : ''), label: rec(r.w, r.l, r.t) };
  }

  function describe(a, b, r) {
    if (!r.n) return name(a) + ' and ' + name(b) + ' have not met in ' + scopeText() + '.';
    if (r.w === r.l) return name(a) + ' and ' + name(b) + ' are even at ' + rec(r.w, r.l, r.t) + '.';
    var lead = r.w > r.l ? a : b;
    return name(lead) + ' leads ' + rec(Math.max(r.w, r.l), Math.min(r.w, r.l), r.t) + ' (' + r.n + (r.n === 1 ? ' meeting' : ' meetings') + ').';
  }

  var matrixCache = null;
  function renderGrid(games) {
    matrixCache = Rivalry.matrix(games, ids);
    var head = '<thead><tr><th scope="col"><span class="sr-only">Manager</span></th>' + ids.map(function (id) {
      return '<th scope="col" title="' + esc(name(id)) + '">' + esc(name(id).slice(0, 3)) + '</th>';
    }).join('') + '</tr></thead>';
    var body = '<tbody>' + ids.map(function (a) {
      return '<tr><th scope="row"><span class="row-name">' + avatar(a) + esc(name(a)) + '</span></th>' + ids.map(function (b) {
        if (a === b) return '<td class="self"><span aria-hidden="true">—</span><span class="sr-only">' + esc(name(a)) + ' cannot play themselves</span></td>';
        var r = matrixCache[a][b], info = cellInfo(r);
        var sel = (a === state.a && b === state.b) || (a === state.b && b === state.a);
        return '<td><button type="button" class="cell ' + info.cls + (sel ? ' sel' : '') + '"' +
          ' data-a="' + esc(a) + '" data-b="' + esc(b) + '" aria-pressed="' + sel + '"' +
          ' aria-label="' + esc(name(a) + ' against ' + name(b) + ': ' + (r.n ? rec(r.w, r.l, r.t) : 'no meetings')) + '">' + info.label + '</button></td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';
    $('grid').innerHTML = head + body;
    renderCaption();
  }

  function renderCaption() {
    var p = hoverPair || [state.a, state.b];
    var r = matrixCache[p[0]][p[1]];
    var picked = !hoverPair || (p[0] === state.a && p[1] === state.b);
    $('gridCaption').innerHTML = '<strong>' + esc(name(p[0])) + ' vs ' + esc(name(p[1])) + '</strong><span class="sep">•</span><span>' +
      esc(describe(p[0], p[1], r)) + '</span>' +
      (picked ? '' : '<span class="sep">•</span><button type="button" data-a="' + esc(p[0]) + '" data-b="' + esc(p[1]) + '">View rivalry &rarr;</button>');
    var btn = $('gridCaption').querySelector('button');
    if (btn) btn.addEventListener('click', function () { hoverPair = null; setPair(btn.getAttribute('data-a'), btn.getAttribute('data-b'), true); });
  }

  function wireGrid() {
    var grid = $('grid');
    function fromEvent(e) { return e.target.closest && e.target.closest('.cell'); }
    grid.addEventListener('mouseover', function (e) {
      var c = fromEvent(e);
      if (c) { hoverPair = [c.getAttribute('data-a'), c.getAttribute('data-b')]; renderCaption(); }
    });
    grid.addEventListener('focusin', function (e) {
      var c = fromEvent(e);
      if (c) { hoverPair = [c.getAttribute('data-a'), c.getAttribute('data-b')]; renderCaption(); }
    });
    grid.addEventListener('mouseleave', function () { hoverPair = null; renderCaption(); });
    grid.addEventListener('focusout', function (e) {
      if (!grid.contains(e.relatedTarget)) { hoverPair = null; renderCaption(); }
    });
    grid.addEventListener('click', function (e) {
      var c = fromEvent(e);
      if (!c) return;
      hoverPair = null;
      var a = c.getAttribute('data-a'), b = c.getAttribute('data-b');
      setPair(a, b, false);
      // Keep keyboard focus on the same square after the grid redraws.
      var again = grid.querySelector('.cell[data-a="' + a + '"][data-b="' + b + '"]');
      if (again && e.detail === 0) again.focus();
    });
  }

  // ---------- receipts ----------
  function renderReceipts(s) {
    $('receiptsSub').textContent = name(s.a) + ' vs ' + name(s.b) + ' · ' + (showAll ? 'All meetings' : 'Recent meetings');
    if (!s.meetings) {
      $('receipts').innerHTML = '<li class="rc-empty">No meetings in ' + esc(scopeText()) + '. Try All seasons or All games.</li>';
      $('moreBtn').hidden = true;
      return;
    }
    var list = showAll ? s.games : s.games.slice(0, RECENT_COUNT);
    $('receipts').innerHTML = list.map(function (g) {
      var A = Rivalry.side(g, s.a), win = Rivalry.winnerOf(g);
      var margin = Math.abs(g.scoreA - g.scoreB);
      var chip = g.gameType === 'playoff' ? '<span class="chip po">Playoff</span>'
        : g.gameType === 'consolation' ? '<span class="chip co">Consolation</span>' : '<span class="chip">Regular season</span>';
      var tags = [];
      if (g.round === 'Championship') tags.push('<span class="tag tag-title">Championship</span>');
      if (s.closest && s.closest.game.id === g.id && s.meetings > 1) tags.push('<span class="tag tag-close">Closest finish</span>');
      if (s.biggest && s.biggest.game.id === g.id && s.meetings > 1) tags.push('<span class="tag tag-big">Biggest win</span>');
      function sideHtml(id, score, cls) {
        return '<div class="rc-side' + (win === id ? ' won' : '') + '">' + avatar(id, cls) +
          '<div><span class="nm">' + esc(name(id)) + '</span><b>' + pts(score) + '</b></div></div>';
      }
      return '<li class="rc"><div class="rc-when"><span>' + g.season + ' · ' + esc(gameLabel(g)) + '</span>' + chip + '</div>' +
        '<div class="rc-body">' + sideHtml(s.a, A.mine, 'av-a') + sideHtml(s.b, A.theirs, 'av-b') +
        '<div class="rc-result"><span>' + (win ? esc(name(win)) + ' by ' + pts(margin) : 'Tie game') + '</span>' + tags.join('') + '</div></div></li>';
    }).join('');
    var more = $('moreBtn');
    more.hidden = s.meetings <= RECENT_COUNT;
    more.textContent = showAll ? 'Show recent meetings' : 'View all ' + s.meetings + ' meetings →';
    more.setAttribute('aria-expanded', String(showAll));
  }

  // ---------- share ----------
  function summary() {
    var s = currentSeries();
    var p = Rivalry.series(playoffGames(), s.a, s.b);
    var lines = ['Gooncocks Rivalry Center: ' + name(s.a) + ' vs ' + name(s.b) + ' (' + scopeText() + ')'];
    if (!s.meetings) {
      lines.push('No meetings yet.');
    } else {
      lines.push(headline(s));
      lines.push('Record: ' + name(s.a) + ' ' + rec(s.winsA, s.winsB, s.ties) + ' over ' + s.meetings + (s.meetings === 1 ? ' meeting' : ' meetings') + '.');
      if (s.streak && s.streak.winner) lines.push('Current streak: ' + name(s.streak.winner) + ', W' + s.streak.count + '.');
      lines.push(p.meetings ? 'Playoffs: ' + name(s.a) + ' ' + rec(p.winsA, p.winsB, p.ties) + '.' : 'No playoff meetings.');
      if (s.closest) lines.push('Closest finish: ' + pts(s.closest.margin) + ' pts (' + when(s.closest.game) + ').');
      if (s.biggest) lines.push('Biggest win: ' + name(s.biggest.winner) + ' by ' + pts(s.biggest.margin) + ' (' + when(s.biggest.game) + ').');
    }
    if (data.source !== 'yahoo') lines.push('(Demo data, not real league results.)');
    return lines.join('\n');
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }
  function share() {
    var text = summary();
    function fallback() {
      $('copyText').value = text;
      $('copyFallback').hidden = false;
      $('copyText').focus();
      $('copyText').select();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Rivalry summary copied'); }, fallback);
    } else {
      fallback();
    }
  }

  // ---------- render all ----------
  function render() {
    syncControls();
    var games = scopeGames();
    var s = Rivalry.series(games, state.a, state.b);
    renderFeature(s);
    renderSpots(games);
    renderGrid(games);
    renderReceipts(s);
    save();
  }

  function start(loaded) {
    data = loaded;
    ids = data.managers.filter(function (m) { return m.active; }).map(function (m) { return m.id; });
    if (ids.length < 2) ids = data.managers.map(function (m) { return m.id; });
    byId = {};
    data.managers.forEach(function (m) { byId[m.id] = m; });
    seasons = data.matchups.filter(function (g) { return g.status === 'final'; })
      .map(function (g) { return g.season; })
      .filter(function (s, i, arr) { return arr.indexOf(s) === i; })
      .sort(function (x, y) { return y - x; });
    if (!byId[state.a] || !byId[state.b]) { state.a = ids[0]; state.b = ids[1]; }

    var latest = data.matchups.reduce(function (m, g) { return Math.max(m, g.season); }, 0);
    $('seasonTag').textContent = latest ? latest + ' season' : '';
    var live = data.source === 'yahoo';
    $('sourceBadge').textContent = live ? 'Yahoo league history · ' + seasons[seasons.length - 1] + '–' + seasons[0] : 'Demo data · not from Yahoo';
    $('sourceBadge').classList.toggle('live', live);
    $('footNote').textContent = live ? 'Records from Yahoo Fantasy league history.' : 'Illustrative stats. Yahoo history not loaded.';

    restore();
    buildControls();
    wireGrid();
    render();
  }

  RivalryData.load().then(start).catch(function (err) {
    $('sourceBadge').textContent = 'History unavailable';
    var box = document.createElement('p');
    box.className = 'load-error';
    box.textContent = 'The league history could not be loaded. ' + err.message;
    $('controls').after(box);
    console.error(err);
  });
})();
