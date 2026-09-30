/*
 * Trade Lab page: Trading Block, your block editor, Matchmaker, and the
 * Trade Calculator. All data comes through window.TradeApi; everything a
 * manager typed is put on the page as text (textContent), never as HTML.
 * Hiding a button here is only a convenience - the server re-checks who
 * you are and what's on your roster on every change.
 */
(function () {
  var api = window.TradeApi, L = window.TradeLogic;
  // Sign-in cookies belong to stats.gooncocks.com, so the live page only
  // runs there; other gooncocks.com addresses are sent to it.
  var HOME = 'stats.gooncocks.com';
  if (!api.preview && /(^|\.)gooncocks\.com$/.test(location.hostname) && location.hostname !== HOME) {
    location.replace('https://' + HOME + location.pathname + location.search + location.hash);
    return;
  }
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    me: null, meError: null,
    data: null, dataError: null,
    mine: null, mineError: null, mineLoading: false,
    selected: [], draft: null, dirty: false, busy: null, msg: null, confirmRemove: false,
    league: null, leagueLoad: null, leagueError: null, matchTeam: null, calcReady: false, calcPreset: null,
    picks: { A: [], B: [] }
  };

  // ---------- tiny DOM helper (text only) ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'value') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function svg(markup, cls) {  // static icons only, never data
    var box = document.createElement('span');
    box.innerHTML = markup;
    var el = box.firstChild;
    if (cls) el.setAttribute('class', cls);
    return el;
  }
  var GHOST = '<svg viewBox="0 0 64 80" aria-hidden="true" style="fill:currentColor;stroke:none"><circle cx="32" cy="24" r="14"/><path d="M4 80c0-18 12-30 28-30s28 12 28 30z"/></svg>';

  function now() { return Date.now() / 1000; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function posBadge(p) { return h('span', { class: 'pos ' + String(p).replace(/[^A-Za-z]/g, ''), text: p }); }
  function shot(player) {
    var box = h('div', { class: 'shot' });
    function ghost() { clear(box).appendChild(svg(GHOST, 'ghost')); }
    if (player.headshot) {
      var img = h('img', { src: player.headshot, alt: '', width: '88', height: '88', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', ghost);
      box.appendChild(img);
    } else ghost();
    return box;
  }
  function toast(text) {
    var t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function listingsAll() { return (S.data && S.data.listings) || []; }
  function myKey() { return S.me && S.me.signed_in && S.me.can_edit ? S.me.team_key : null; }
  function teams() {
    var out = ((S.data && S.data.teams) || []).slice(), seen = {};
    out.forEach(function (t) { seen[t.team_key] = 1; });
    listingsAll().forEach(function (l) {  // Yahoo down: still let people filter by who's listed
      if (!seen[l.team_key]) { seen[l.team_key] = 1; out.push({ team_key: l.team_key, manager: l.manager }); }
    });
    return out;
  }
  function managerName(key) {
    var t = teams().filter(function (x) { return x.team_key === key; })[0];
    return t ? t.manager : '';
  }

  // ---------- tabs ----------
  var TABS = ['block', 'scout', 'match', 'calc'];
  function showTab(name, focus) {
    TABS.forEach(function (t) {
      var on = t === name, b = $('tab-' + t);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
      if (on && focus) b.focus();
    });
    if (name === 'scout') renderScout();
    if (name === 'match') renderMatch();
    if (name === 'calc') loadCalc();
  }
  function initTabs() {
    TABS.forEach(function (t, i) {
      var b = $('tab-' + t);
      b.addEventListener('click', function () { showTab(t); });
      b.addEventListener('keydown', function (e) {
        var j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
        if (j === undefined) return;
        e.preventDefault();
        showTab(TABS[(j + TABS.length) % TABS.length], true);
      });
    });
    document.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        showTab(b.getAttribute('data-go'));
        $('panel-' + b.getAttribute('data-go')).scrollIntoView({ block: 'start' });
        $('tab-' + b.getAttribute('data-go')).focus();
      });
    });
  }

  // ---------- account + sign-in messages ----------
  var SIGNIN = {
    ok: ['You’re signed in. You can manage your trading block now.', ''],
    cancelled: ['Sign-in was cancelled. You can keep browsing.', 'warn'],
    expired: ['That sign-in attempt expired. Please sign in again.', 'warn'],
    error: ['Yahoo sign-in didn’t finish, so nothing changed. Try again in a minute.', 'warn'],
    'not-in-league': ['That Yahoo account doesn’t manage a team in this league. You can browse, but you can’t list players.', 'warn']
  };
  function showSigninMessage() {
    var m = /[?&]signin=([a-z-]+)/.exec(location.search), msg = m && SIGNIN[m[1]];
    if (!msg) return;
    var el = $('signinMsg'), why = /[?&]reason=([a-z_]{1,40})/.exec(location.search);
    el.textContent = msg[0] + (why ? ' (Yahoo said: ' + why[1] + ')' : ''); el.className = 'banner-msg' + (msg[1] ? ' ' + msg[1] : ''); el.hidden = false;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
  }
  function signInControl(cls) {
    if (api.preview) {
      return h('button', { type: 'button', class: 'btn gold small ' + (cls || ''), text: 'Sign in (preview)', onclick: function () {
        api.signIn(); loadMe(true);
      } });
    }
    return h('a', { class: 'btn gold small ' + (cls || ''), href: api.signInUrl(), text: 'Sign in with Yahoo' });
  }
  function renderAccount() {
    var el = clear($('account'));
    if (!S.me) return;
    if (!S.me.signed_in) { el.appendChild(signInControl()); return; }
    el.appendChild(h('span', { class: 'who' }, S.me.can_edit ? ['Signed in as ', h('b', { text: S.me.manager || 'your team' })]
      : ['Signed in · not in this league']));
    el.appendChild(h('button', { type: 'button', class: 'linkbtn', text: 'Sign out', onclick: signOut }));
  }
  function signOut() {
    api.signOut().then(function () {
      S.me = { signed_in: false }; S.mine = null; resetEditor();
      renderAccount(); renderEditor(); renderBlock(); if (S.data) renderNeeds(); toast('Signed out.');
    }, function (e) { toast(e.message); });
  }
  function loadMe(fromPreviewSignIn) {
    S.meError = null;
    renderEditor();
    return api.me().then(function (m) {
      S.me = m;
      renderAccount(); renderBlock(); if (S.data) renderNeedsEdit();
      if (m.signed_in && m.can_edit) loadMine(); else renderEditor();
      if (fromPreviewSignIn) toast('Signed in as ' + m.manager + ' (preview).');
      if (!$('panel-match').hidden) renderMatch();
    }, function (e) { S.meError = e.message; renderEditor(); });
  }

  // ---------- trading block ----------
  function filters() {
    return { search: $('q').value, position: $('fPos').value, team: $('fTeam').value, status: $('fStatus').value, sort: $('fSort').value };
  }
  function fillSelect(sel, first, options) {
    var keep = sel.value;
    clear(sel).appendChild(h('option', { value: 'all', text: first }));
    options.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
    sel.value = options.some(function (o) { return o[0] === keep; }) ? keep : 'all';
  }
  function loadListings() {
    S.dataError = null;
    var st = $('listState');
    st.className = 'state'; st.textContent = 'Loading the trading block…';
    return api.listings().then(function (d) {
      S.data = d;
      $('previewFlag').hidden = !api.preview;
      fillSelect($('fPos'), 'All positions', (d.positions || []).map(function (p) { return [p, p]; }));
      fillSelect($('fTeam'), 'All managers', teams().map(function (t) { return [t.team_key, t.manager]; }));
      renderChecked(); renderBlock(); renderNeeds();
      loadLeague().then(function () { renderBlock(); }, function () { /* the other tabs show the error */ });
      if (!$('panel-match').hidden) renderMatch();
    }, function (e) {
      S.dataError = e.message;
      clear(st).className = 'state err';
      st.appendChild(document.createTextNode('Couldn’t load the trading block. ' + e.message + ' '));
      st.appendChild(h('button', { type: 'button', class: 'linkbtn', text: 'Try again', onclick: loadListings }));
    });
  }
  function renderChecked() {
    var d = S.data, el = $('checked');
    if (!d) return;
    var t = d.rosters_checked_at;
    el.textContent = (api.preview ? 'Sample data · ' : '') +
      (d.rosters_stale ? 'Couldn’t reach Yahoo just now, so rosters were last checked ' + L.ago(t, now()) + '. Listings are shown as saved.'
        : t ? 'Rosters checked with Yahoo ' + L.ago(t, now()) + '.' : '');
    el.classList.toggle('warn', !!d.rosters_stale);
  }
  function renderBlock() {
    if (!S.data) return;
    var all = listingsAll(), shown = L.filterListings(all, filters()), ul = clear($('cards')), mine = myKey();
    $('count').textContent = shown.length === all.length ? plural(all.length, 'player') : shown.length + ' of ' + plural(all.length, 'player');
    var st = $('listState');
    st.className = 'state';
    st.textContent = all.length && !shown.length ? 'No listings match those filters.' : '';
    if (!all.length) {
      ul.appendChild(h('li', { class: 'empty', text: 'No one has put a player on the block yet.' +
        (mine ? ' Be the first: pick players in Your Trading Block.' : ' Managers can sign in with Yahoo to list players.') }));
      return;
    }
    shown.forEach(function (l) { ul.appendChild(card(l, l.team_key === mine)); });
  }
  function card(l, own) {
    var wants = l.wants.length ? l.wants.map(posBadge) : [h('span', { class: 'nfl', text: 'Open to offers' })];
    return h('li', { class: 'card' + (own ? ' mine' : ''), 'data-player': l.player_key }, [
      shot(l),
      h('div', { class: 'col-name' }, [
        h('h3', { class: 'pname', text: l.name }),
        h('div', { class: 'pmeta' }, [posBadge(l.position), l.nfl_team ? h('span', { class: 'nfl', text: l.nfl_team }) : null,
          ratingTag(l), own ? h('span', { class: 'mine-tag', text: 'Your Listing' }) : null])
      ]),
      h('div', { class: 'col-info' }, [
        h('div', { class: 'col' }, [h('small', { text: 'Manager' }), h('b', { text: l.manager })]),
        h('div', { class: 'col' }, [h('small', { text: 'Status' }), h('span', { class: 'pill ' + l.status, text: L.STATUS_LABEL[l.status] })]),
        h('div', { class: 'col' }, [h('small', { text: 'Wants' }), h('div', { class: 'pmeta', style: 'margin:0' }, wants)]),
        h('div', { class: 'col col-note' + (l.note ? '' : ' none') }, [h('small', { text: 'Note' }), h('p', { class: 'note', text: l.note || '—' })])
      ]),
      h('div', { class: 'card-act' }, [
        h('span', { class: 'upd', text: 'Updated ' + L.ago(l.updated_at, now()) }),
        h('div', { class: 'row' }, [
          own ? h('button', { type: 'button', class: 'btn gold small', text: 'Edit', 'aria-label': 'Edit your listing: ' + l.name,
            onclick: function (e) { editPlayers([l.player_key], e.currentTarget); } })
            : h('button', { type: 'button', class: 'btn ghost small', text: 'Compare', 'aria-label': 'Compare ' + l.name + ' in the trade calculator',
              onclick: function () { openCalc(myKey(), [], l.team_key, [l.player_key]); } }),
          h('button', { type: 'button', class: 'btn ghost small', text: 'View listing', 'aria-label': 'View listing: ' + l.name,
            onclick: function (e) { openDetail(l.player_key, e.currentTarget); } })
        ])
      ])
    ]);
  }
  // "12.4 pts/wk" once rosters and scores have loaded (see the Scouting Report).
  function ratingTag(p) {
    if (!S.league) return null;
    var r = S.league.rate(p);
    return r.value === null ? null : h('span', { class: 'rate', title: 'Rating: points per week (see Scouting for how it’s worked out)', text: fmt(r.value) + ' pts/wk' });
  }
  function teamNeeds() { return (S.data && S.data.needs) || []; }
  function renderNeeds() {
    var t = clear($('needs')), rows = L.needs(listingsAll(), teams(), teamNeeds());
    t.appendChild(h('caption', { class: 'sr-only', text: 'Positions each manager is looking for' }));
    if (!rows.length) {
      t.appendChild(h('tbody', {}, [h('tr', {}, [h('td', { class: 'fine', text: 'No one has said what they’re looking for yet.' })])]));
    } else {
      t.appendChild(h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', text: 'Manager' }), h('th', { scope: 'col', text: 'Looking for' })])]));
      t.appendChild(h('tbody', {}, rows.map(function (n) {
        return h('tr', {}, [
          h('td', {}, [h('span', { class: 'av', 'aria-hidden': 'true', text: (n.manager || '?').charAt(0).toUpperCase() }), n.manager]),
          h('td', {}, [h('span', { class: 'pmeta', style: 'margin:0' }, n.wants.map(posBadge)),
            n.note ? h('span', { class: 'need-note', text: '“' + n.note + '”' }) : null])
        ]);
      })));
    }
    renderNeedsEdit();
  }

  // Tell the league what you're looking for, without listing anyone.
  function myNeeds() { var k = myKey(); return teamNeeds().filter(function (n) { return n.team_key === k; })[0] || null; }
  function renderNeedsEdit() {
    var box = clear($('needsEdit')), mine = myNeeds();
    if (!S.needsOpen) {
      box.appendChild(h('button', { type: 'button', class: 'btn gold', 'data-k': 'needs-open',
        text: mine ? 'Edit what you need' : 'What are you looking for?',
        onclick: function () { S.needsOpen = true; S.needsDraft = null; renderNeedsEdit(); var f = $('needsEdit').querySelector('input'); if (f) f.focus(); } }));
      box.appendChild(h('p', { class: 'fine needs-hint', text: 'Tell the league what positions you need. You don’t have to put anyone on the block.' }));
      return;
    }
    var form = h('div', { class: 'form' });
    box.appendChild(form);
    if (!S.me || !S.me.signed_in) {
      form.appendChild(h('p', { text: 'Sign in with the Yahoo account that runs your team to tell the league what you need.' }));
      form.appendChild(signInControl());
      form.appendChild(h('button', { type: 'button', class: 'linkbtn', text: 'Cancel', onclick: function () { S.needsOpen = false; renderNeedsEdit(); } }));
      return;
    }
    if (!myKey()) {
      form.appendChild(h('p', { class: 'msg err', text: 'This Yahoo account doesn’t manage a team in our league.' }));
      return;
    }
    var d = S.needsDraft = S.needsDraft || { wants: mine ? mine.wants.slice() : [], note: mine ? mine.note : '' };
    var positions = (S.data && S.data.positions) || [], dis = !!S.needsBusy;
    form.appendChild(h('h3', { text: 'What are you looking for?' }));
    form.appendChild(h('fieldset', {}, [h('legend', { text: 'Positions' }), h('div', { class: 'choices' }, positions.map(function (p) {
      return h('label', {}, [h('input', { type: 'checkbox', value: p, checked: d.wants.indexOf(p) >= 0, disabled: dis,
        onchange: function (e) {
          var i = d.wants.indexOf(p);
          if (e.target.checked && i < 0) d.wants.push(p);
          if (!e.target.checked && i >= 0) d.wants.splice(i, 1);
          d.wants.sort(function (a, b) { return positions.indexOf(a) - positions.indexOf(b); });
        } }), p]);
    }))]));
    form.appendChild(h('label', {}, [h('span', { class: 'fine', text: 'Anything else? (optional)' }),
      h('input', { type: 'text', class: 'need-text', maxlength: '200', value: d.note, disabled: dis, placeholder: 'e.g. Need a RB2, will pay for one',
        oninput: function (e) { d.note = e.target.value; } })]));
    if (S.needsMsg) form.appendChild(h('p', { class: 'msg err', role: 'alert', text: S.needsMsg }));
    form.appendChild(h('div', { class: 'form-actions' }, [
      h('button', { type: 'button', class: 'btn gold', disabled: dis, text: S.needsBusy ? 'Saving…' : 'Save', onclick: function () { saveNeeds(d.wants, d.note.trim()); } }),
      h('button', { type: 'button', class: 'btn ghost', disabled: dis, text: 'Cancel', onclick: function () { S.needsOpen = false; S.needsMsg = null; renderNeedsEdit(); } })
    ]));
    if (mine) form.appendChild(h('button', { type: 'button', class: 'linkbtn', disabled: dis, text: 'Clear what I’m looking for', onclick: function () { saveNeeds([], ''); } }));
  }
  function saveNeeds(wants, note) {
    S.needsBusy = true; S.needsMsg = null; renderNeedsEdit();
    api.saveNeeds(wants, note).then(function (res) {
      S.needsBusy = false; S.needsOpen = false;
      var k = myKey();
      S.data.needs = teamNeeds().filter(function (n) { return n.team_key !== k; }).concat(res.needs ? [res.needs] : []);
      renderNeeds();
      if (!$('panel-match').hidden) renderMatch();
      toast(res.needs ? 'Saved. The league can see what you’re looking for.' : 'Cleared.');
    }, function (e) {
      S.needsBusy = false;
      if (e.status === 401) { S.me = { signed_in: false }; renderAccount(); }
      S.needsMsg = e.message; renderNeedsEdit();
    });
  }

  // ---------- listing detail ----------
  var lastFocus = null;
  function trapFocus(container, e) {
    if (e.key !== 'Tab') return;
    var f = container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
    f = Array.prototype.filter.call(f, function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  function openDetail(playerKey, opener) {
    var l = listingsAll().filter(function (x) { return x.player_key === playerKey; })[0];
    if (!l) return;
    var own = l.team_key === myKey(), body = clear($('detailBody'));
    var created = new Date(l.created_at * 1000), updated = new Date(l.updated_at * 1000);
    body.appendChild(h('div', { class: 'detail-head' + (own ? ' mine' : '') }, [
      shot(l),
      h('div', { style: 'padding:10px 10px 10px 0' }, [
        h('h2', { class: 'pname', id: 'detailTitle', text: l.name }),
        h('div', { class: 'pmeta' }, [posBadge(l.position), l.nfl_team ? h('span', { class: 'nfl', text: l.nfl_team }) : null,
          own ? h('span', { class: 'mine-tag', text: 'Your Listing' }) : null])
      ])
    ]));
    body.appendChild(h('div', { class: 'status-row' }, [injuryTag(l.player_key), newsLink(l.player_key)]));
    var stats = statsPanel(l);
    if (stats) body.appendChild(stats);
    body.appendChild(h('dl', { class: 'dl' }, [
      h('dt', { text: 'Manager' }), h('dd', { text: l.manager }),
      h('dt', { text: 'Status' }), h('dd', {}, [h('span', { class: 'pill ' + l.status, text: L.STATUS_LABEL[l.status] })]),
      h('dt', { text: 'Looking for' }), h('dd', {}, l.wants.length ? [h('span', { class: 'pmeta', style: 'margin:0' }, l.wants.map(posBadge))] : ['Open to offers']),
      h('dt', { text: 'Note' }), h('dd', { text: l.note || 'No note.' }),
      h('dt', { text: 'Listed' }), h('dd', { text: created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }),
      h('dt', { text: 'Updated' }), h('dd', { text: L.ago(l.updated_at, now()) + ' · ' + updated.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
    ]));
    body.appendChild(h('p', { class: 'fine', text: own ? 'This is your listing. Edit it from Your Trading Block.'
      : 'Interested? Message ' + l.manager + ' in the league chat. Trade Lab never proposes or makes trades.' }));
    body.appendChild(h('div', { class: 'form-actions', style: 'margin-top:14px' }, [own
      ? h('button', { type: 'button', class: 'btn gold', text: 'Edit listing', onclick: function () { closeDetail(); editPlayers([l.player_key], opener); } })
      : h('button', { type: 'button', class: 'btn gold', text: 'Compare in calculator', onclick: function () { closeDetail(); openCalc(myKey(), [], l.team_key, [l.player_key]); } })
    ]));
    lastFocus = opener || document.activeElement;
    $('detail').hidden = false;
    $('detailClose').focus();
  }
  // Yahoo's injury status for a rostered player, e.g. "Questionable · Hamstring".
  function injuryTag(playerKey) {
    var rp = rosterPlayer(playerKey), inj = rp && rp.injury;
    if (!inj) return null;
    var mild = inj.code === 'Q' || inj.code === 'D';
    return h('p', { class: 'inj ' + (mild ? 'mild' : 'out') }, [h('b', { text: inj.label }), inj.note ? ' · ' + inj.note : '']);
  }

  // A link to the player's news page on Yahoo (where its short notes live),
  // flagged when Yahoo says there's a recent note.
  function newsLink(playerKey) {
    var id = String(playerKey).split('.p.')[1];
    if (!id || !/^\d+$/.test(id)) return null;
    var nw = rosterPlayer(playerKey), n = nw && nw.news;
    var fresh = n && (n.recent || (n.at && now() - n.at < 3 * 86400));
    return h('p', { class: 'news' }, [
      fresh ? h('span', { class: 'news-new', text: 'New note' + (n.at ? ' · ' + L.ago(n.at, now()) : '') }) : null,
      h('a', { href: 'https://sports.yahoo.com/nfl/players/' + id + '/news/', target: '_blank', rel: 'noopener', text: 'Latest news on Yahoo →' })
    ]);
  }
  function rosterPlayer(playerKey) {
    var found = null;
    ((S.league && S.league.rosters && S.league.rosters.teams) || []).forEach(function (t) {
      (t.players || []).forEach(function (p) { if (p.player_key === playerKey) found = p; });
    });
    return found;
  }

  // Weekly fantasy points (league scoring) for a listed player: one bar per
  // week with its actual points. Missing weeks are a dash, not 0.
  function statsPanel(p) {
    var lg = S.league;
    if (!lg) return null;
    var line = L.weekLine(lg.cw, p);
    var last = Math.max.apply(null, lg.weeksPlayed.concat(lg.live ? [lg.live.week] : []).concat([0]));
    if (!last) return null;
    var top = Math.max.apply(null, Object.keys(line.weeks).map(function (k) { return line.weeks[k]; }).concat([1]));
    var cols = [];
    for (var wk = 1; wk <= last; wk++) {
      var pts = line.weeks[wk], has = typeof pts === 'number', isLive = lg.live && lg.live.week === wk;
      cols.push(h('li', { class: 'st-row' + (isLive ? ' live' : ''), title: 'Week ' + wk + ': ' + (has ? fmt(pts) + ' pts' + (isLive ? ' so far' : '') : 'no score') }, [
        h('span', { class: 'st-wk', text: 'Wk ' + wk }),
        h('span', { class: 'st-track' }, [has ? h('span', { class: 'st-bar', style: 'width:' + Math.max(2, Math.round(Math.max(0, pts) / top * 100)) + '%' }) : null]),
        h('span', { class: 'st-val', text: has ? fmt(pts) + (isLive ? '*' : '') : '–' })
      ]));
    }
    return h('section', { class: 'stats', 'aria-label': 'Weekly fantasy points' }, [
      h('h3', { text: lg.yr + ' fantasy points by week' }),
      h('ol', { class: 'st-chart', 'aria-label': 'Points by week' }, cols),
      h('p', { class: 'fine', text: 'League scoring. “–” means no score that week (bye, injured, or not on a league roster).' +
        (lg.live ? ' * Week ' + lg.live.week + ' (striped) is so far.' : '') })
    ]);
  }
  function closeDetail() {
    if ($('detail').hidden) return;
    $('detail').hidden = true;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  // ---------- editor ----------
  function resetEditor() { S.selected = []; S.draft = null; S.dirty = false; S.busy = null; S.msg = null; S.confirmRemove = false; }
  function myListings() { return (S.mine && S.mine.listings) || []; }
  function listingOf(key) { return myListings().filter(function (l) { return l.player_key === key; })[0]; }
  function defaultDraft() {
    // Prefill from the selection when every selected listing agrees.
    var ls = S.selected.map(listingOf);
    if (ls.length && ls.every(Boolean)) {
      var f = ls[0], same = ls.every(function (l) { return l.status === f.status && l.note === f.note && l.wants.join() === f.wants.join(); });
      if (same) return { status: f.status, wants: f.wants.slice(), note: f.note };
    }
    return { status: 'available', wants: [], note: '' };
  }
  function loadMine() {
    S.mineLoading = true; S.mineError = null;
    renderEditor();
    return api.myRoster().then(function (r) {
      S.mine = r; S.mineLoading = false;
      S.selected = S.selected.filter(function (k) { return r.players.some(function (p) { return p.player_key === k; }); });
      renderEditor();
    }, function (e) {
      S.mineLoading = false; S.mineError = e.message;
      if (e.status === 401) { S.me = { signed_in: false }; renderAccount(); }
      renderEditor();
    });
  }
  function editPlayers(keys, opener) {
    if (!myKey()) return;
    if (!S.dirty || S.selected.join() !== keys.join()) { S.selected = keys.slice(); S.dirty = false; S.draft = defaultDraft(); }
    S.msg = null; S.confirmRemove = false;
    openDrawer(opener);
    renderEditor();
    var first = document.querySelector('#editor [data-k="status"]:checked') || document.querySelector('#editor [data-k^="pick:"]');
    if (first) first.focus();
  }
  function toggle(key, on) {
    var i = S.selected.indexOf(key);
    if (on && i < 0) S.selected.push(key);
    if (!on && i >= 0) S.selected.splice(i, 1);
    if (!S.dirty) S.draft = defaultDraft();
    S.msg = null; S.confirmRemove = false;
    renderEditor();
  }

  function renderEditor() {
    var box = $('editor'), focusKey = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
    clear(box);
    box.setAttribute('aria-busy', S.busy || S.mineLoading ? 'true' : 'false');
    var mk = myKey();
    if (!S.me) {
      box.appendChild(S.meError
        ? h('div', {}, [h('p', { class: 'msg err', role: 'alert', text: 'Couldn’t check your sign-in. ' + S.meError }),
          h('button', { type: 'button', class: 'btn', 'data-k': 'retry', text: 'Try again', onclick: function () { loadMe(); } })])
        : h('p', { text: 'Checking sign-in…' }));
    } else if (!S.me.signed_in) {
      box.appendChild(h('p', { text: 'Anyone can browse the block. To list players from your team, sign in with the Yahoo account that manages it.' }));
      box.appendChild(signInControl());
      box.appendChild(h('p', { class: 'fine', text: 'Trade Lab asks Yahoo only for read access to Fantasy Sports, to confirm which team you manage and who’s on it. It can’t make trades or change lineups.' }));
    } else if (!mk) {
      box.appendChild(h('p', { class: 'msg err', text: 'This Yahoo account doesn’t manage a team in our league, so you can browse but not list players.' }));
      box.appendChild(h('p', { class: 'fine', text: 'Signed in with a different account? Sign out and sign in with the one that runs your team.' }));
    } else if (S.mineLoading && !S.mine) {
      box.appendChild(h('p', { text: 'Loading your Yahoo roster…' }));
    } else if (S.mineError && !S.mine) {
      box.appendChild(h('p', { class: 'msg err', role: 'alert', text: S.mineError }));
      box.appendChild(h('button', { type: 'button', class: 'btn', 'data-k': 'retry', text: 'Try again', onclick: loadMine }));
    } else {
      renderRoster(box);
    }
    if (focusKey) {
      var el = box.querySelector('[data-k="' + focusKey.replace(/"/g, '') + '"]');
      if (el) el.focus();
    }
  }

  function renderRoster(box) {
    var r = S.mine, listed = myListings();
    box.appendChild(h('p', { text: listed.length ? 'You have ' + plural(listed.length, 'player') + ' on the block. Check players to list them or change their listing; checked players are edited together.'
      : 'Check one or more players to put them on the block. Checked players are edited together.' }));
    box.appendChild(h('p', { class: 'fine' + (r.roster_stale ? ' warn' : ''), text: r.roster_stale
      ? 'Couldn’t recheck your roster with Yahoo just now (last checked ' + L.ago(r.roster_checked_at, now()) + '). Saving needs a fresh check, so it may not work until Yahoo is back.'
      : 'Roster checked with Yahoo ' + L.ago(r.roster_checked_at, now()) + '.' }));
    if (!r.players.length) { box.appendChild(h('p', { class: 'empty', text: 'Yahoo shows no players on your roster.' })); return; }
    var order = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
    var players = r.players.slice().sort(function (a, b) { return ((order[a.position] + 1 || 9) - (order[b.position] + 1 || 9)) || a.name.localeCompare(b.name); });
    box.appendChild(h('ul', { class: 'roster', 'aria-label': 'Your roster' }, players.map(function (p) {
      var l = listingOf(p.player_key), on = S.selected.indexOf(p.player_key) >= 0;
      return h('li', { class: l ? 'listed' : '' }, [h('label', {}, [
        h('input', { type: 'checkbox', checked: on, 'data-k': 'pick:' + p.player_key, disabled: !!S.busy,
          onchange: function (e) { toggle(p.player_key, e.target.checked); } }),
        posBadge(p.position),
        h('span', { class: 'nm', text: p.name }),
        l ? h('span', { class: 'st', text: l.status === 'listening' ? 'Listening' : 'Available' }) : null
      ])]);
    })));
    box.appendChild(renderForm());
  }

  function renderForm() {
    var sel = S.selected, n = sel.length, form = h('div', { class: 'form' });
    if (S.msg) form.appendChild(h('p', { class: 'msg ' + S.msg.kind, role: S.msg.kind === 'err' ? 'alert' : 'status', text: S.msg.text }));
    if (!n) {
      form.appendChild(h('p', { class: 'fine', text: 'Nothing selected. Check players above to list them, or to edit or remove a listing.' }));
      return form;
    }
    if (!S.draft) S.draft = defaultDraft();
    var d = S.draft, names = sel.map(function (k) { return (S.mine.players.filter(function (p) { return p.player_key === k; })[0] || {}).name || k; });
    var listedSel = sel.filter(listingOf), newSel = n - listedSel.length;
    form.appendChild(h('h3', { text: n === 1 ? 'Editing 1 player' : 'Editing ' + n + ' players together' }));
    form.appendChild(h('p', { class: 'fine', style: 'margin:0', text: (n === 1 ? 'Applies to ' : 'These settings apply to all ' + n + ': ') + names.join(', ') +
      (n > 1 ? ' (' + [listedSel.length ? listedSel.length + ' already listed' : '', newSel ? newSel + ' new' : ''].filter(Boolean).join(', ') + ')' : listedSel.length ? ' (already listed)' : ' (new listing)') + '.' }));
    if (n > 1 && listedSel.length && !S.dirty && d.status === 'available' && !d.wants.length && !d.note) {
      form.appendChild(h('p', { class: 'fine', style: 'margin:0', text: 'These listings have different settings, so saving replaces them all with what you set here.' }));
    }
    var dis = !!S.busy;
    form.appendChild(h('fieldset', {}, [h('legend', { text: 'Status' }), h('div', { class: 'choices' }, ['available', 'listening'].map(function (s) {
      return h('label', {}, [h('input', { type: 'radio', name: 'tl-status', value: s, checked: d.status === s, disabled: dis, 'data-k': 'status',
        onchange: function () { d.status = s; S.dirty = true; } }), L.STATUS_LABEL[s]]);
    }))]));
    var positions = (S.mine.positions && S.mine.positions.length ? S.mine.positions : (S.data && S.data.positions) || []);
    form.appendChild(h('fieldset', {}, [h('legend', { text: 'Looking for (optional)' }), h('div', { class: 'choices' }, positions.map(function (p) {
      return h('label', {}, [h('input', { type: 'checkbox', value: p, checked: d.wants.indexOf(p) >= 0, disabled: dis, 'data-k': 'want:' + p,
        onchange: function (e) {
          var i = d.wants.indexOf(p);
          if (e.target.checked && i < 0) d.wants.push(p);
          if (!e.target.checked && i >= 0) d.wants.splice(i, 1);
          d.wants.sort(function (a, b) { return positions.indexOf(a) - positions.indexOf(b); });
          S.dirty = true;
        } }), p]);
    }))]));
    var counter = h('p', { class: 'counter', id: 'noteCount', 'aria-live': 'polite' });
    function count() {
      var len = d.note.length;
      counter.textContent = len + ' / 200';
      counter.classList.toggle('over', len > 200);
    }
    var ta = h('textarea', { id: 'tlNote', maxlength: '200', 'aria-describedby': 'noteCount', disabled: dis, 'data-k': 'note',
      placeholder: 'e.g. Want a starting RB back.', oninput: function (e) { d.note = e.target.value; S.dirty = true; count(); } });
    ta.value = d.note;
    count();
    form.appendChild(h('div', {}, [h('label', { for: 'tlNote', style: 'font-size:13px;font-weight:600;display:block;margin-bottom:6px',
      text: n === 1 ? 'Note (optional)' : 'Note for all ' + n + ' (optional)' }), ta, counter]));

    var saveText = S.busy === 'saving' ? 'Saving…' : n === 1 ? (listedSel.length ? 'Save changes' : 'List player') : 'Save ' + n + ' listings';
    var actions = h('div', { class: 'form-actions' }, [h('button', { type: 'button', class: 'btn gold', 'data-k': 'save', disabled: dis, text: saveText, onclick: save })]);
    if (listedSel.length) {
      var rmText = S.busy === 'removing' ? 'Removing…' : S.confirmRemove ? 'Confirm remove' : listedSel.length === 1 ? 'Remove from block' : 'Remove ' + listedSel.length;
      actions.appendChild(h('button', { type: 'button', class: 'btn danger', 'data-k': 'remove', disabled: dis, text: rmText, onclick: remove }));
    }
    form.appendChild(actions);
    if (S.confirmRemove) {
      form.appendChild(h('p', { class: 'fine', style: 'margin:0', text: 'Remove ' + listedSel.map(function (k) { return listingOf(k).name; }).join(', ') +
        ' from the block? Press Confirm remove, or ' }, [h('button', { type: 'button', class: 'linkbtn', 'data-k': 'cancelrm', text: 'keep ' + (listedSel.length === 1 ? 'it' : 'them'),
        onclick: function () { S.confirmRemove = false; renderEditor(); } })]));
    }
    form.appendChild(h('button', { type: 'button', class: 'linkbtn', style: 'justify-self:start', 'data-k': 'clearsel', disabled: dis, text: 'Clear selection',
      onclick: function () { resetEditor(); renderEditor(); } }));
    return form;
  }

  function mergeListings(saved, removedKeys) {
    var drop = {};
    (removedKeys || []).forEach(function (k) { drop[k] = 1; });
    saved.forEach(function (l) { drop[l.player_key] = 1; });
    function merge(list) { return list.filter(function (l) { return !drop[l.player_key]; }).concat(saved); }
    if (S.data) S.data.listings = merge(S.data.listings);
    if (S.mine) S.mine.listings = merge(S.mine.listings);
    renderBlock(); renderNeeds();
    if (!$('panel-match').hidden) renderMatch();
  }
  function handleWriteError(e) {
    S.busy = null;
    S.msg = { kind: 'err', text: (e.message || 'Something went wrong.') + ' Your changes are still here.' };
    if (e.status === 401) { S.me = { signed_in: false }; renderAccount(); S.msg.text = 'Your sign-in expired. Sign in again to save.'; }
    renderEditor();
  }
  function save() {
    var d = S.draft;
    if (d.note.length > 200) { S.msg = { kind: 'err', text: 'Keep the note to 200 characters.' }; renderEditor(); return; }
    var items = S.selected.map(function (k) {
      var l = listingOf(k);
      return { player_key: k, status: d.status, wants: d.wants.slice(), note: d.note, version: l ? l.version : 0 };
    });
    S.busy = 'saving'; S.msg = null; S.confirmRemove = false;
    renderEditor();
    api.save(items).then(function (res) {
      S.busy = null;
      var conflicts = (res.results || []).filter(function (r) { return !r.ok; });
      var gone = conflicts.filter(function (r) { return !r.current; }).map(function (r) { return r.player_key; });
      mergeListings((res.listings || []).concat(conflicts.filter(function (r) { return r.current; }).map(function (r) { return r.current; })), gone);
      if (!conflicts.length) {
        var n = res.listings.length;
        resetEditor();
        S.msg = { kind: 'ok', text: 'Saved ' + plural(n, 'listing') + '. ' + (n === 1 ? 'It’s' : 'They’re') + ' on the block now.' };
        toast('Saved ' + plural(n, 'listing') + '.');
      } else {
        var names = conflicts.map(function (r) { return (r.current && r.current.name) || r.player_key; });
        S.selected = conflicts.map(function (r) { return r.player_key; });
        S.msg = { kind: 'err', text: (res.listings.length ? 'Saved ' + plural(res.listings.length, 'listing') + ', but ' : '') + names.join(', ') +
          ' changed somewhere else since you opened it. The latest version is loaded and your edits are still in the form: press Save again to use yours.' };
      }
      renderEditor();
    }, handleWriteError);
  }
  function remove() {
    var keys = S.selected.filter(listingOf);
    if (!S.confirmRemove) { S.confirmRemove = true; renderEditor(); return; }
    S.busy = 'removing'; S.msg = null;
    renderEditor();
    var removed = [], i = 0;
    function next() {
      if (i >= keys.length) {
        S.busy = null; S.confirmRemove = false;
        mergeListings([], removed);
        S.selected = []; S.dirty = false; S.draft = null;
        S.msg = { kind: 'ok', text: 'Removed ' + plural(removed.length, 'listing') + ' from the block.' };
        toast(S.msg.text);
        renderEditor();
        return null;
      }
      var k = keys[i++], l = listingOf(k);
      return api.remove(k, l.version).then(function (res) {
        if (res && res._status === 409) {
          mergeListings([], removed);
          S.busy = null; S.confirmRemove = false;
          S.msg = { kind: 'err', text: l.name + ' changed somewhere else, so it wasn’t removed. Reloading your block…' };
          renderEditor(); loadMine();
          return null;
        }
        removed.push(k);
        return next();
      }, function (e) {
        if (e.status === 404) { removed.push(k); return next(); }  // already gone
        mergeListings([], removed);
        S.confirmRemove = false;
        handleWriteError(e);
        return null;
      });
    }
    next();
  }

  // ---------- mobile drawer ----------
  var drawerOpener = null;
  function isDrawer() { return window.matchMedia('(max-width: 900px)').matches; }
  function openDrawer(opener) {
    if (!isDrawer()) { $('editorPanel').scrollIntoView({ block: 'nearest' }); return; }
    drawerOpener = opener || $('manageBtn');
    $('editorPanel').classList.add('open');
    $('editorPanel').setAttribute('role', 'dialog');
    $('editorPanel').setAttribute('aria-modal', 'true');
    $('scrim').hidden = false;
    $('manageBtn').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    $('editorPanel').focus();
  }
  function closeDrawer() {
    if (!$('editorPanel').classList.contains('open')) return;
    $('editorPanel').classList.remove('open');
    $('editorPanel').removeAttribute('role');
    $('editorPanel').removeAttribute('aria-modal');
    $('scrim').hidden = true;
    $('manageBtn').setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    var back = drawerOpener && document.contains(drawerOpener) ? drawerOpener : $('manageBtn');
    back.focus();
  }

  // ---------- league data: rosters + scores, shared by Scouting, Matchmaker and the Calculator ----------
  function season() { var d = new Date(); return d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear(); }
  var GROUP_NAME = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'Flex', K: 'K', DEF: 'DEF' };
  function loadLeague() {
    if (S.leagueLoad) return S.leagueLoad;
    var yr = season();
    S.leagueLoad = Promise.all([api.rosters(), api.boxscores(yr), api.boxscores(yr - 1), api.liveWeek(),
                                api.pointsAgainst(yr).then(null, function () { return null; })]).then(function (res) {
      var ro = res[0], cur = res[1] || { games: {} }, prev = res[2] || { games: {} }, live = res[3], pa = res[4];
      // The in-progress week counts until the final box scores include it.
      if (!live || live.season !== yr || weeksIn(cur).indexOf(live.week) >= 0) live = null;
      var cw = L.playerWeeks(cur, live), pw = L.playerWeeks(prev), cache = {};
      function rate(p) {
        var k = p.name + '|' + p.position;
        return cache[k] || (cache[k] = L.playerRating(cw, pw, p));
      }
      var slots = (ro.slots && ro.slots.length) ? ro.slots : L.slotsFromBox(Object.keys(cur.games).length ? cur : prev);
      S.league = { rosters: ro, slots: slots, cur: cur, prev: prev, yr: yr, rate: rate, live: live, cw: cw, pw: pw, pa: pa,
                   weeksPlayed: weeksIn(cur), scout: L.scouting(ro.teams, slots, rate) };
      S.leagueError = null;
      return S.league;
    }, function (e) {
      S.leagueLoad = null;
      S.leagueError = e.status === 503 ? 'Rosters aren’t available from Yahoo right now.' : 'Couldn’t load rosters and scores. ' + e.message;
      throw e;
    });
    return S.leagueLoad;
  }
  function weeksIn(box) {
    var w = [];
    Object.keys((box && box.games) || {}).forEach(function (id) { var m = /-w(\d+)-/.exec(id); if (m && w.indexOf(+m[1]) < 0) w.push(+m[1]); });
    return w.sort(function (a, b) { return a - b; });
  }
  function withLeague(stateEl, render) {
    var st = $(stateEl);
    if (S.league) { st.textContent = ''; return render(S.league); }
    st.className = 'state'; st.textContent = 'Loading rosters and scores…';
    loadLeague().then(function (lg) { st.textContent = ''; render(lg); }, function () {
      clear(st).className = 'state err';
      st.appendChild(document.createTextNode(S.leagueError + ' '));
      st.appendChild(h('button', { type: 'button', class: 'linkbtn', text: 'Try again', onclick: function () { withLeague(stateEl, render); } }));
    });
  }
  function signed(n) { return (n >= 0 ? '+' : '−') + fmt(Math.abs(n)); }
  function gradeText(g) { return String(g).replace('-', '−'); }
  // "21.1 pts/wk better than average" / "about average"
  function vsAvg(diff) {
    return Math.abs(diff) < 0.5 ? 'about average' : fmt(Math.abs(diff)) + ' pts/wk ' + (diff > 0 ? 'better' : 'worse') + ' than average';
  }
  var PLURAL = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', FLEX: 'flex', K: 'kicker', DEF: 'defense' };
  function gradeTag(c, big) { return h('span', { class: 'grade ' + c.label + (big ? ' big' : ''), text: gradeText(c.grade) }); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function liveTime(ts) {
    return new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function methodNote(lg) {
    var w = lg.weeksPlayed;
    return 'Ratings are points per week in Yahoo league scoring from this site’s box scores' +
      (w.length ? ' (' + lg.yr + ' weeks ' + w[0] + (w.length > 1 ? '–' + w[w.length - 1] : '') + ')' : ' (no ' + lg.yr + ' weeks yet)') +
      (lg.live ? ', plus week ' + lg.live.week + ' so far (games through ' + liveTime(lg.live.updated) + '; players who haven’t played yet this week count once they do)' : '') +
      ', with last season’s average counting as ' + L.PRIOR_WEEKS + ' extra weeks. Each team is scored by its best lineup from its current Yahoo roster; injured-reserve players don’t count. No projections.' +
      (lg.pa ? ' “Next 4” ranks come from Points Against: #1 is the defense that gives up the most to that position (green = easy, red = tough).' : '');
  }
  function teamSelect(sel, keep) {
    var ts = S.league.rosters.teams;
    if (!ts.some(function (t) { return t.team_key === keep; })) keep = ts.some(function (t) { return t.team_key === myKey(); }) ? myKey() : (ts[0] || {}).team_key;
    clear(sel);
    ts.forEach(function (t) { sel.appendChild(h('option', { value: t.team_key, text: t.manager + (t.team_key === myKey() ? ' (you)' : '') })); });
    sel.value = keep;
    return keep;
  }
  function you(teamKey, name) { return teamKey === myKey() ? 'You' : name; }

  // ---------- scouting ----------
  function renderScout() {
    withLeague('scoutState', function (lg) {
      var key = teamSelect($('sTeam'), $('sTeam').value), sc = lg.scout;
      var t = sc.teams.filter(function (x) { return x.team_key === key; })[0];
      var box = clear($('scoutReport'));
      if (!t) return;
      var who = you(key, t.manager);
      function list(gs) { return gs.map(function (g) { return gradeText(t.cells[g].grade) + ' at ' + GROUP_NAME[g]; }).join(', '); }
      function weak(gs) { return gs.map(function (g) { return GROUP_NAME[g] + ' (' + gradeText(t.cells[g].grade) + ')'; }).join(' and '); }
      box.appendChild(h('p', { class: 'scout-sum' }, [
        h('b', { text: who === 'You' ? 'Your team' : t.manager }), ': ',
        t.strengths.length ? list(t.strengths) + '. ' : 'No position grades in the A range. ',
        t.weaknesses.length ? (who === 'You' ? 'Your' : 'The') + ' weak spot' + (t.weaknesses.length > 1 ? 's are ' : ' is ') + weak(t.weaknesses) + '.' : 'No weak spots (nothing below a D+).'
      ]));
      var maxAbs = Math.max.apply(null, sc.groups.map(function (g) { return Math.max.apply(null, sc.teams.map(function (x) { return Math.abs(x.cells[g].diff); })); }).concat([1]));
      box.appendChild(h('table', { class: 'scout' }, [
        h('caption', { class: 'sr-only', text: (who === 'You' ? 'Your' : t.manager + '’s') + ' starting lineup by position, points per week compared with the league average' }),
        h('thead', {}, [h('tr', {}, ['Position', 'Grade', 'Pts/wk', 'Compared with the average team', 'Rank', 'Starters'].map(function (x) { return h('th', { scope: 'col', text: x }); }))]),
        h('tbody', {}, sc.groups.map(function (g) {
          var c = t.cells[g], grp = t.report.groups[g], pct = Math.min(50, Math.abs(c.diff) / maxAbs * 50);
          return h('tr', { class: 'lbl-' + c.label }, [
            h('th', { scope: 'row' }, [posBadge(GROUP_NAME[g])]),
            h('td', {}, [gradeTag(c, true)]),
            h('td', { class: 'num' }, [fmt(c.points), h('small', { class: 'avg', text: 'avg ' + fmt(sc.avg[g]) })]),
            h('td', { class: 'dv-cell' }, [
              h('span', { class: 'dv', title: GROUP_NAME[g] + ': ' + vsAvg(c.diff) + ' (league average ' + fmt(sc.avg[g]) + ')' }, [
                h('span', { class: 'dv-bar ' + (c.diff >= 0 ? 'up' : 'down'), style: (c.diff >= 0 ? 'left:50%;' : 'right:50%;') + 'width:' + pct.toFixed(1) + '%' })
              ]),
              h('span', { class: 'dv-txt', text: vsAvg(c.diff) })
            ]),
            h('td', { text: ordinal(c.rank) + ' of ' + sc.count }),
            h('td', { class: 'starters' }, grp.starters.length ? grp.starters.map(function (x) {
              return h('span', { class: 'st-p' }, [x.player.name + ' ', h('small', { text: x.rating.value === null ? 'no scores' : fmt(x.rating.value) + ' pts/wk' })]);
            }) : [h('small', { text: 'Nobody to start' })])
          ]);
        }))
      ]));
      box.appendChild(h('p', { class: 'fine starters-m', text: 'Starters: ' + sc.groups.map(function (g) {
        return GROUP_NAME[g] + ' ' + (t.report.groups[g].starters.map(function (x) { return x.player.name; }).join(', ') || '—');
      }).join(' · ') + '.' }));
      var bench = t.report.bench.filter(function (x) { return x.rating.value !== null; }).slice(0, 6);
      if (bench.length) box.appendChild(h('p', { class: 'fine' }, ['Best bench depth: ' + bench.map(function (x) { return x.player.name + ' (' + x.player.position + ', ' + fmt(x.rating.value) + ')'; }).join(', ') + '.']));
      if (t.report.out.length) box.appendChild(h('p', { class: 'fine', text: 'On injured reserve (not counted): ' + t.report.out.map(function (x) { return x.player.name; }).join(', ') + '.' }));
      box.appendChild(h('div', { class: 'scout-act' }, [
        h('button', { type: 'button', class: 'btn gold small', text: 'Find trade partners', onclick: function () { $('mTeam').value = key; S.matchTeam = key; showTab('match'); } })
      ]));

      // league grid: every team at every position
      var grid = clear($('scoutGrid'));
      grid.appendChild(h('caption', { class: 'sr-only', text: 'Every team’s grade at each position, compared with the average team' }));
      grid.appendChild(h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', text: 'Manager' })].concat(sc.groups.map(function (g) { return h('th', { scope: 'col', text: GROUP_NAME[g] }); })))]));
      grid.appendChild(h('tbody', {}, sc.teams.slice().sort(function (a, b) { return b.report.total - a.report.total; }).map(function (x) {
        return h('tr', { class: x.team_key === key ? 'on' : '' }, [
          h('th', { scope: 'row' }, [h('button', { type: 'button', class: 'linkbtn', text: x.manager + (x.team_key === myKey() ? ' (you)' : ''),
            onclick: function () { $('sTeam').value = x.team_key; renderScout(); $('scoutReport').scrollIntoView({ block: 'nearest' }); } })])
        ].concat(sc.groups.map(function (g) {
          var c = x.cells[g], lvl = Math.min(3, Math.ceil(Math.abs(c.diff) / (maxAbs / 3 || 1)));
          return h('td', { class: 'hm ' + c.label + (c.label === 'average' ? '' : ' l' + lvl),
            title: x.manager + ' at ' + GROUP_NAME[g] + ': ' + gradeText(c.grade) + ' · ' + fmt(c.points) + ' pts/wk, ' + vsAvg(c.diff) + ' (' + fmt(sc.avg[g]) + '), ' + ordinal(c.rank) + ' of ' + sc.count },
            [h('span', { class: 'hm-g', text: gradeText(c.grade) })]);
        })));
      })));
      $('scoutNote').textContent = methodNote(lg) + ' Grades: A+ is 30% or more above the average team, A 20%, A− 12%, B+ 7%, B 3%, C within 3%, and the same steps below average down to F (30% or more below). A small gap of under 1.5 points never grades A or D.';
    });
  }

  // ---------- matchmaker ----------
  var NOUN = { QB: 'QB', RB: 'RBs', WR: 'WRs', TE: 'TE' }, ARTICLE = { QB: 'a', RB: 'an', WR: 'a', TE: 'a' };
  function bestPhrase(rank) { return rank === 1 ? 'the best' : 'the ' + ordinal(rank) + '-best'; }
  // "You need an RB. Sam has plenty: the 2nd-best RBs in the league."
  // needer/haver are names, or null for "you"; needT/haveT their scouting rows.
  function needLine(g, i, needer, haver, haveT, needT, offers) {
    var count = S.league.scout.count, rank = haveT.cells[g].rank, nr = needT.cells[g].rank;
    var lead = (i === 0 ? (needer ? needer + ' needs ' : 'You need ') : (needer ? needer + ' could also use ' : 'You could also use ')) + ARTICLE[g] + ' ' + g + '.';
    var spare = offers.some(function (o) { return o.group === g && o.role === 'bench'; });
    var body;
    if ((g === 'QB' || g === 'TE') && spare) body = (haver ? haver + ' has' : 'You have') + ' a spare one on the bench.';
    else if (rank <= 3) body = (haver ? haver + ' has' : 'You have') + ' plenty: ' + bestPhrase(rank) + ' ' + NOUN[g] + ' in the league' +
      (nr === count ? ', while ' + (needer ? needer + '’s' : 'yours') + (g === 'QB' || g === 'TE' ? ' is' : ' are') + ' the league’s weakest.' : '.');
    else body = (haver ? haver + '’s' : 'Your') + ' ' + NOUN[g] + (g === 'QB' || g === 'TE' ? ' is' : ' are') + ' above average.';
    return h('li', {}, [h('b', { text: lead }), ' ' + body]);
  }
  function renderMatch() {
    withLeague('matchState', function (lg) {
      var key = teamSelect($('mTeam'), S.matchTeam || $('mTeam').value), list = clear($('matches'));
      S.matchTeam = key;
      var r = L.tradeFits(lg.scout, key, listingsAll()), me = r.team;
      var who = you(key, me ? me.manager : '');
      var st = $('matchState');
      if (!me) return;
      if (!me.weaknesses.filter(function (g) { return ['QB', 'RB', 'WR', 'TE'].indexOf(g) >= 0; }).length && !me.strengths.length) {
        st.textContent = (who === 'You' ? 'Your team is' : me.manager + '’s team is') + ' close to the league average everywhere, so there’s no clear trade fit right now.';
      } else if (!r.fits.length) {
        st.textContent = 'No team lines up yet: nobody is strong where ' + (who === 'You' ? 'you’re' : me.manager + ' is') + ' weak, or weak where ' + (who === 'You' ? 'you’re' : 'they’re') + ' strong.';
      }
      r.fits.forEach(function (f) {
        var them = lg.scout.teams.filter(function (t) { return t.team_key === f.team_key; })[0];
        var isYou = who === 'You';
        var bullets = f.gets.map(function (x, i) { return needLine(x.group, i, isYou ? null : who, f.manager, them, me, f.theyOffer); })
          .concat(f.gives.map(function (x, i) { return needLine(x.group, i, f.manager, isYou ? null : who, me, them, f.youOffer); }));
        function chips(listx, label) {
          if (!listx.length) return null;
          return h('div', { class: 'offer' }, [h('small', { text: label })].concat(listx.slice(0, 4).map(function (o) {
            return h('span', { class: 'chip' + (o.listed ? ' listed' : '') }, [posBadge(o.player.position), ' ' + o.player.name + ' ',
              h('small', { text: (o.rating.value === null ? 'no scores' : fmt(o.rating.value) + ' pts/wk') + ' · ' + (o.listed ? 'On the block' : o.role === 'bench' ? 'Bench' : 'Starter') })]);
          })));
        }
        var giveKey = (f.youOffer[0] || {}).player, getKey = (f.theyOffer[0] || {}).player;
        list.appendChild(h('li', { class: 'match' + (f.mutual ? ' mutual' : '') }, [
          h('div', { class: 'match-head' }, [h('h3', { text: f.manager }),
            h('span', { class: 'badge' + (f.mutual ? '' : ' one'), text: f.mutual ? 'Two-way fit' : 'One-way fit' })]),
          h('ul', { class: 'why' }, bullets),
          chips(f.theyOffer, f.manager + ' could offer'),
          chips(f.youOffer, (isYou ? 'You' : who) + ' could offer'),
          h('div', { class: 'links' }, [
            h('button', { type: 'button', class: 'btn ghost small', text: 'Compare in calculator', onclick: function () {
              openCalc(key, giveKey ? [giveKey.player_key] : [], f.team_key, getKey ? [getKey.player_key] : []);
            } })
          ])
        ]));
      });
      $('matchNote').textContent = 'Only players marked “On the block” have been listed; everyone else is a suggestion to ask about. ' + methodNote(lg);
      // Matches from what managers typed on their listings.
      var old = L.matchmaker(listingsAll(), key, teamNeeds()), lm = clear($('listMatches'));
      $('listMatchWrap').hidden = !old.matches.length;
      old.matches.forEach(function (m) {
        var text = who === 'You' ? m.text : m.text.replace(/^You’re looking for/, who + ' is looking for').replace(/which you have listed/, 'which ' + who + ' has listed').replace(/you haven’t listed/, who + ' hasn’t listed');
        lm.appendChild(h('li', { class: 'match' + (m.mutual ? ' mutual' : '') }, [
          h('div', { class: 'match-head' }, [h('h3', { text: m.manager }), h('span', { class: 'badge' + (m.mutual ? '' : ' one'), text: m.mutual ? 'Mutual match' : 'One-way' })]),
          h('p', { text: text }),
          h('div', { class: 'links' }, m.get.concat(m.give).map(function (l) {
            return h('button', { type: 'button', class: 'linkbtn', text: 'View ' + l.name, onclick: function (e) { openDetail(l.player_key, e.currentTarget); } });
          }))
        ]));
      });
    });
  }

  // ---------- trade calculator ----------
  function loadCalc() {
    withLeague('calcState', function () {
      if (!S.calcReady) setupCalcTeams();
      renderCalc();
    });
  }
  function setupCalcTeams() {
    var ts = S.league.rosters.teams, a = $('cTeamA'), b = $('cTeamB');
    [a, b].forEach(function (s) { clear(s); ts.forEach(function (t) { s.appendChild(h('option', { value: t.team_key, text: t.manager })); }); });
    var mine = myKey(), first = ts.some(function (t) { return t.team_key === mine; }) ? mine : (ts[0] || {}).team_key;
    a.value = first;
    b.value = (ts.filter(function (t) { return t.team_key !== first; })[0] || {}).team_key || first;
    a.onchange = function () { S.picks.A = []; renderCalc(); };
    b.onchange = function () { S.picks.B = []; renderCalc(); };
    S.calcReady = true;
  }
  // Open the calculator with teams and players already picked.
  function openCalc(teamA, picksA, teamB, picksB) {
    S.calcPreset = { a: teamA, pa: picksA, b: teamB, pb: picksB };
    showTab('calc');
    $('panel-calc').scrollIntoView({ block: 'start' });
  }
  function applyPreset() {
    var p = S.calcPreset;
    if (!p) return;
    S.calcPreset = null;
    if (p.a) $('cTeamA').value = p.a;
    if (p.b) $('cTeamB').value = p.b;
    if ($('cTeamA').value === $('cTeamB').value) {  // e.g. signed out: any other team on side A
      var other = S.league.rosters.teams.filter(function (t) { return t.team_key !== $('cTeamB').value; })[0];
      if (other) $('cTeamA').value = other.team_key;
    }
    S.picks.A = (p.pa || []).slice(); S.picks.B = (p.pb || []).slice();
  }
  function rosterOf(teamKey) { var t = S.league.rosters.teams.filter(function (x) { return x.team_key === teamKey; })[0]; return t ? t.players : []; }
  function renderPicks(side) {
    var box = clear($('picks' + side)), teamKey = $('cTeam' + side).value, players = rosterOf(teamKey), picks = S.picks[side];
    if (!players.length) { box.appendChild(h('p', { class: 'fine', text: 'No players on this roster.' })); return; }
    players.slice().sort(function (a, b) { return (S.league.rate(b).value || 0) - (S.league.rate(a).value || 0); }).forEach(function (p) {
      var r = S.league.rate(p);
      box.appendChild(h('label', {}, [
        h('input', { type: 'checkbox', checked: picks.indexOf(p.player_key) >= 0, 'data-k': side + ':' + p.player_key, onchange: function (e) {
          var i = picks.indexOf(p.player_key);
          if (e.target.checked && i < 0) picks.push(p.player_key);
          if (!e.target.checked && i >= 0) picks.splice(i, 1);
          renderCalcOut();
        } }),
        posBadge(p.position), h('span', { class: 'nm', text: p.name }),
        h('span', { class: 'nfl', text: r.value === null ? 'no scores' : fmt(r.value) + ' pts/wk' })
      ]));
    });
  }
  function renderCalc() {
    applyPreset();
    renderPicks('A'); renderPicks('B'); renderCalcOut();
  }
  function fmt(n) { return n === null || n === undefined || isNaN(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1); }
  // Every week's points this season, colored against the player's own
  // rating: big weeks green, duds red.
  function weekStrip(p, r) {
    var lg = S.league, line = L.weekLine(lg.cw, p);
    var last = Math.max.apply(null, lg.weeksPlayed.concat(lg.live ? [lg.live.week] : []).concat([0]));
    if (!last) return null;
    var cells = [];
    for (var wk = 1; wk <= last; wk++) {
      var pts = line.weeks[wk], has = typeof pts === 'number', live = lg.live && lg.live.week === wk;
      var tone = !has || !r.value ? '' : pts >= r.value * 1.25 ? ' hi' : pts <= r.value * 0.6 ? ' lo' : '';
      cells.push(h('li', { class: 'wk' + tone + (live ? ' live' : ''), title: 'Week ' + wk + ': ' + (has ? fmt(pts) + ' pts' + (live ? ' so far' : '') : 'no score') }, [
        h('span', { class: 'wk-n', text: 'W' + wk }), h('span', { class: 'wk-v', text: has ? fmt(pts) + (live ? '*' : '') : '–' })]));
    }
    return h('div', { class: 'strip' }, [h('span', { class: 'strip-lab', text: 'Weekly' }), h('ol', { class: 'wk-list' }, cells)]);
  }
  // The next 4 weeks' opponents, each with how easy that matchup is for his
  // position (Points Against: #1 gives up the most).
  var TEAM_FIX = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
  function paRanks(pos) {
    var pa = S.league.pa;
    S.league.paRank = S.league.paRank || {};
    if (S.league.paRank[pos]) return S.league.paRank[pos];
    var rows = Object.keys(pa.teams).map(function (c) {
      var t = pa.teams[c], w = Object.keys(t.weeks || {});
      return [c, w.length ? w.reduce(function (x, k) { return x + ((t.weeks[k] || {})[pos] || 0); }, 0) / w.length : 0];
    }).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); }), out = {};
    rows.forEach(function (r, i) { out[r[0]] = i; });
    return (S.league.paRank[pos] = out);
  }
  function nextFour(p) {
    var pa = S.league.pa;
    if (!pa || !pa.schedule || !pa.teams) return null;
    var team = String(p.nfl_team || '').toUpperCase(); team = TEAM_FIX[team] || team;
    var sched = pa.schedule[team];
    if (!sched) return null;
    var start = Math.max.apply(null, (pa.weeks || []).concat([0])) + 1, ranks = paRanks(p.position), n = Object.keys(ranks).length, chips = [];
    for (var wk = start; wk < start + 4 && wk <= 18; wk++) {
      var opp = sched[wk];
      if (!opp) { chips.push(h('li', { class: 'nx bye' }, [h('span', { class: 'wk-n', text: 'W' + wk }), h('span', { text: 'BYE' })])); continue; }
      var i = ranks[opp], tier = i === undefined ? 2 : Math.min(4, Math.floor(i / n * 5));
      chips.push(h('li', { class: 'nx', title: 'Week ' + wk + ' vs ' + opp + (i === undefined ? '' : ': ' + ordinal(i + 1) + ' easiest matchup for ' + p.position + 's') }, [
        h('span', { class: 'wk-n', text: 'W' + wk }), h('span', { text: opp + ' ' }), i === undefined ? null : h('span', { class: 'nx-rk pa-t' + (4 - tier), text: '#' + (i + 1) })]));
    }
    return chips.length ? h('div', { class: 'strip' }, [h('span', { class: 'strip-lab', text: 'Next 4' }), h('ol', { class: 'wk-list' }, chips)]) : null;
  }
  function renderCalcOut() {
    var lg = S.league, out = clear($('calcOut'));
    $('calcSource').textContent = methodNote(lg);
    var sides = ['A', 'B'].map(function (s) {
      var key = $('cTeam' + s).value, players = rosterOf(key);
      var picked = S.picks[s].map(function (k) { return players.filter(function (p) { return p.player_key === k; })[0]; }).filter(Boolean);
      return { side: s, key: key, manager: managerOfRoster(key), players: picked, ratings: picked.map(function (p) { return lg.rate(p); }) };
    });
    ['A', 'B'].forEach(function (s, i) { $('gives' + s).textContent = sides[i].manager ? sides[i].manager + ' gives' : ''; });
    if (!sides[0].players.length || !sides[1].players.length) {
      out.appendChild(h('p', { class: 'state', text: 'Pick at least one player on each side to see how fair the trade is.' }));
      return;
    }
    if (sides[0].key === sides[1].key) {
      out.appendChild(h('p', { class: 'state', text: 'Pick two different teams to compare a trade.' }));
      return;
    }
    var f = L.fairness(sides[0].ratings, sides[1].ratings), A = sides[0], B = sides[1];
    var winner = f.favors === 'A' ? A.manager : f.favors === 'B' ? B.manager : null;
    var head = f.verdict === 'fair' ? 'Fair trade' : (f.verdict === 'leans' ? 'Leans toward ' : 'Lopsided toward ') + winner;
    // Donut: each side's slice is the points per week it receives.
    var tot = (f.aReceives || 0) + (f.bReceives || 0), share = tot ? (f.aReceives || 0) / tot * 100 : 50;
    out.appendChild(h('div', { class: 'verdict ' + f.verdict }, [
      h('p', { class: 'v-head', text: head }),
      h('div', { class: 'donut-row' }, [
        h('div', { class: 'donut', role: 'img', style: 'background:conic-gradient(var(--blue) 0 ' + share.toFixed(1) + '%, var(--gold) ' + share.toFixed(1) + '% 100%)',
          'aria-label': head + '. ' + A.manager + ' receives ' + fmt(f.aReceives) + ' points per week, ' + B.manager + ' receives ' + fmt(f.bReceives) + '.' }, [
          h('div', { class: 'donut-hole' }, winner && f.verdict !== 'fair'
            ? [h('b', { class: 'donut-who', text: winner }), h('span', { class: 'donut-pct', text: '+' + Math.round(f.pct * 100) + '%' })]
            : [h('b', { class: 'donut-who', text: 'Fair' }), h('span', { class: 'donut-pct', text: 'within 10%' })])
        ]),
        h('ul', { class: 'donut-key' }, [
          h('li', { class: 'a' }, [h('span', { class: 'sw' }), h('span', {}, [h('b', { text: A.manager }), ' gets ' + fmt(f.aReceives) + ' pts/wk'])]),
          h('li', { class: 'b' }, [h('span', { class: 'sw' }), h('span', {}, [h('b', { text: B.manager }), ' gets ' + fmt(f.bReceives) + ' pts/wk'])])
        ])
      ]),
      h('p', { text: A.manager + ' receives ' + fmt(f.aReceives) + ' pts/wk and ' + B.manager + ' receives ' + fmt(f.bReceives) + ' pts/wk' +
        (f.verdict === 'fair' ? ' — within 10%, so it’s even.' : ' — a ' + fmt(Math.abs(f.diff)) + ' pt/wk (' + Math.round(f.pct * 100) + '%) edge to ' + winner + '.') })
    ]));
    // How each side's needs are met, from the Scouting Report.
    var notes = [];
    [[A, B], [B, A]].forEach(function (pair) {
      var recv = pair[0], giver = pair[1], rep = lg.scout.teams.filter(function (t) { return t.team_key === recv.key; })[0];
      giver.players.forEach(function (p) {
        if (rep && rep.cells[p.position] && rep.cells[p.position].label === 'weak') notes.push('Fills a need: ' + recv.manager + '’s ' + PLURAL[p.position] + ' grade ' + gradeText(rep.cells[p.position].grade) + ', so getting ' + p.name + ' helps.');
      });
      recv.players.forEach(function (p) {
        if (!rep) return;
        var starter = Object.keys(rep.report.groups).some(function (g) { return rep.report.groups[g].starters.some(function (x) { return x.player.player_key === p.player_key; }); });
        if (starter && rep.cells[p.position] && rep.cells[p.position].label !== 'strong') notes.push('Watch out: ' + recv.manager + ' gives up a starting ' + p.position + ' (' + p.name + '), and ' + recv.manager + '’s ' + PLURAL[p.position] + ' only grade ' + gradeText(rep.cells[p.position].grade) + '.');
      });
    });
    if (f.uneven) notes.push('Uneven trade (' + A.players.length + ' for ' + B.players.length + '): the side getting more players gets more total points, but only starters score, so check who would actually start.');
    if (f.missing) notes.push(plural(f.missing, 'player has', 'players have') + ' no scores this season or last, so they count as zero.');
    if (f.thin) notes.push('Small sample: ' + plural(f.thin, 'player has', 'players have') + ' fewer than 3 weeks this season, so last season carries more weight.');
    notes.forEach(function (t) { out.appendChild(h('p', { class: 'fine', text: t })); });

    var rows = [];
    sides.forEach(function (sd) {
      sd.players.forEach(function (p, i) {
        var r = sd.ratings[i];
        var inj = p.injury;
        rows.push(h('tr', { class: 'side-' + sd.side.toLowerCase() + ' p-main' }, [
          h('td', {}, [p.name + ' ', h('span', { class: 'nfl', text: p.position + (p.nfl_team ? ' · ' + p.nfl_team : '') }),
            inj ? h('span', { class: 'ww-tag inj' + (inj.code === 'Q' || inj.code === 'D' ? '' : ' out'), title: inj.label, text: inj.code + (inj.note ? ' · ' + inj.note : '') }) : null]),
          h('td', { text: String(r.games) }), h('td', { class: 'num', text: fmt(r.ppg) }), h('td', { class: 'num', text: fmt(r.recent) }),
          h('td', { class: 'num', text: fmt(r.lastPpg) }), h('td', { class: 'num strong', text: fmt(r.value) })
        ]));
        rows.push(h('tr', { class: 'side-' + sd.side.toLowerCase() + ' p-more' }, [h('td', { colspan: '6' }, [weekStrip(p, r), nextFour(p)])]));
      });
      var tot = sd.ratings.reduce(function (t, r) { return t + (r.value || 0); }, 0);
      rows.push(h('tr', { class: 'total side-' + sd.side.toLowerCase() }, [
        h('td', { text: sd.manager + ' gives' }), h('td'), h('td'), h('td'), h('td'), h('td', { class: 'num', text: fmt(tot) })
      ]));
    });
    out.appendChild(h('div', { class: 'cmp-wrap' }, [h('table', { class: 'cmp' }, [
      h('caption', { class: 'sr-only', text: 'Each player’s scoring and rating' }),
      h('thead', {}, [h('tr', {}, ['Player', 'Weeks', 'Per week', 'Last 3', 'Last season', 'Rating'].map(function (t) { return h('th', { scope: 'col', text: t }); }))]),
      h('tbody', {}, rows)
    ])]));
  }
  function managerOfRoster(teamKey) { var t = S.league.rosters.teams.filter(function (x) { return x.team_key === teamKey; })[0]; return t ? t.manager : ''; }

  // ---------- wire up ----------
  function init() {
    initTabs();
    showSigninMessage();
    ['q', 'fPos', 'fTeam', 'fStatus', 'fSort'].forEach(function (id) { $(id).addEventListener(id === 'q' ? 'input' : 'change', renderBlock); });
    $('filters').addEventListener('submit', function (e) { e.preventDefault(); });
    $('mTeam').addEventListener('change', function () { S.matchTeam = $('mTeam').value; renderMatch(); });
    $('sTeam').addEventListener('change', renderScout);
    $('manageBtn').addEventListener('click', function (e) { openDrawer(e.currentTarget); });
    $('drawerClose').addEventListener('click', closeDrawer);
    $('scrim').addEventListener('click', closeDrawer);
    $('detailClose').addEventListener('click', closeDetail);
    $('detail').addEventListener('click', function (e) { if (e.target === $('detail')) closeDetail(); });
    $('detail').addEventListener('keydown', function (e) { trapFocus($('detail'), e); });
    $('editorPanel').addEventListener('keydown', function (e) { if ($('editorPanel').classList.contains('open')) trapFocus($('editorPanel'), e); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('detail').hidden) closeDetail(); else closeDrawer();
    });
    window.addEventListener('resize', function () { if (!isDrawer()) closeDrawer(); });
    setInterval(renderChecked, 60000);
    var hash = location.hash.replace('#', '');
    if (hash === 'scouting') showTab('scout'); else if (hash === 'matchmaker') showTab('match'); else if (hash === 'calculator') showTab('calc');
    loadListings();
    loadMe();
  }
  init();
})();
