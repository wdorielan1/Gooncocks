/*
 * Trade Lab page: Trading Block, your block editor, Matchmaker, and the
 * Trade Calculator. All data comes through window.TradeApi; everything a
 * manager typed is put on the page as text (textContent), never as HTML.
 * Hiding a button here is only a convenience - the server re-checks who
 * you are and what's on your roster on every change.
 */
(function () {
  var api = window.TradeApi, L = window.TradeLogic;
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    me: null, meError: null,
    data: null, dataError: null,
    mine: null, mineError: null, mineLoading: false,
    selected: [], draft: null, dirty: false, busy: null, msg: null, confirmRemove: false,
    rosters: null, rostersError: null, box: null, boxSeason: null, weeks: null,
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
  var TABS = ['block', 'match', 'calc'];
  function showTab(name, focus) {
    TABS.forEach(function (t) {
      var on = t === name, b = $('tab-' + t);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
      if (on && focus) b.focus();
    });
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
    var el = $('signinMsg');
    el.textContent = msg[0]; el.className = 'banner-msg' + (msg[1] ? ' ' + msg[1] : ''); el.hidden = false;
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
      renderAccount(); renderEditor(); renderBlock(); toast('Signed out.');
    }, function (e) { toast(e.message); });
  }
  function loadMe(fromPreviewSignIn) {
    S.meError = null;
    renderEditor();
    return api.me().then(function (m) {
      S.me = m;
      renderAccount(); renderBlock();
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
          own ? h('span', { class: 'mine-tag', text: 'Your Listing' }) : null])
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
            onclick: function (e) { editPlayers([l.player_key], e.currentTarget); } }) : null,
          h('button', { type: 'button', class: 'btn ghost small', text: 'View listing', 'aria-label': 'View listing: ' + l.name,
            onclick: function (e) { openDetail(l.player_key, e.currentTarget); } })
        ])
      ])
    ]);
  }
  function renderNeeds() {
    var t = clear($('needs')), rows = L.needs(listingsAll(), teams());
    t.appendChild(h('caption', { class: 'sr-only', text: 'Positions each manager is looking for' }));
    if (!rows.length) {
      t.appendChild(h('tbody', {}, [h('tr', {}, [h('td', { class: 'fine', text: 'No one has said what they’re looking for yet.' })])]));
      return;
    }
    t.appendChild(h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', text: 'Manager' }), h('th', { scope: 'col', text: 'Looking for' })])]));
    t.appendChild(h('tbody', {}, rows.map(function (n) {
      return h('tr', {}, [
        h('td', {}, [h('span', { class: 'av', 'aria-hidden': 'true', text: (n.manager || '?').charAt(0).toUpperCase() }), n.manager]),
        h('td', {}, [h('span', { class: 'pmeta', style: 'margin:0' }, n.wants.map(posBadge))])
      ]);
    })));
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
    if (own) body.appendChild(h('div', { class: 'form-actions', style: 'margin-top:14px' }, [
      h('button', { type: 'button', class: 'btn gold', text: 'Edit listing', onclick: function () { closeDetail(); editPlayers([l.player_key], opener); } })
    ]));
    lastFocus = opener || document.activeElement;
    $('detail').hidden = false;
    $('detailClose').focus();
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

  // ---------- matchmaker ----------
  function renderMatch() {
    var sel = $('mTeam'), list = clear($('matches')), st = $('matchState');
    st.className = 'state';
    if (!S.data) { st.textContent = S.dataError ? 'Couldn’t load listings. ' + S.dataError : 'Loading listings…'; return; }
    var ts = teams(), keep = sel.value || myKey() || '';
    if (!ts.some(function (t) { return t.team_key === keep; })) {
      var withListings = ts.filter(function (t) { return listingsAll().some(function (l) { return l.team_key === t.team_key && l.wants.length; }); })[0];
      keep = (withListings || ts[0] || {}).team_key || '';
    }
    clear(sel);
    ts.forEach(function (t) { sel.appendChild(h('option', { value: t.team_key, text: t.manager + (t.team_key === myKey() ? ' (you)' : '') })); });
    sel.value = keep;
    var who = keep === myKey() ? 'You' : managerName(keep) || 'This manager';
    var r = L.matchmaker(listingsAll(), keep);
    if (!r.listed) {
      st.textContent = who + (who === 'You' ? ' haven’t' : ' hasn’t') + ' listed anyone yet. Matches come from the positions a manager says they’re looking for on their listings' +
        (who === 'You' ? ', so list a player and pick what you want back.' : '.');
      return;
    }
    if (!r.wants.length) {
      st.textContent = who + (who === 'You' ? ' haven’t' : ' hasn’t') + ' said what positions ' + (who === 'You' ? 'you’re' : 'they’re') + ' looking for, so there’s nothing to match on yet.';
      return;
    }
    if (!r.matches.length) {
      st.textContent = 'No one has listed a ' + r.wants.join(' or ') + ' yet. Check back as the block fills up.';
      return;
    }
    var text = function (s) { return who === 'You' ? s : s.replace(/^You’re looking for/, who + ' is looking for').replace(/which you have listed/, 'which ' + who + ' has listed').replace(/you haven’t listed/, who + ' hasn’t listed'); };
    r.matches.forEach(function (m) {
      list.appendChild(h('li', { class: 'match' + (m.mutual ? ' mutual' : '') }, [
        h('div', { class: 'match-head' }, [h('h3', { text: m.manager }),
          h('span', { class: 'badge' + (m.mutual ? '' : ' one'), text: m.mutual ? 'Mutual match' : 'One-way' })]),
        h('p', { text: text(m.text) }),
        h('div', { class: 'links' }, m.get.concat(m.give).map(function (l) {
          return h('button', { type: 'button', class: 'linkbtn', text: 'View ' + l.name, onclick: function (e) { openDetail(l.player_key, e.currentTarget); } });
        }))
      ]));
    });
  }

  // ---------- trade calculator ----------
  function season() { var d = new Date(); return d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear(); }
  function loadCalc() {
    var st = $('calcState');
    if (S.rosters && S.weeks) return renderCalc();
    st.className = 'state'; st.textContent = 'Loading rosters and this season’s scores…';
    var yr = season();
    var box = S.box ? Promise.resolve(S.box) : api.boxscores(yr).then(function (b) {
      if (b && b.games && Object.keys(b.games).length) { S.boxSeason = yr; return b; }
      return api.boxscores(yr - 1).then(function (p) { S.boxSeason = yr - 1; return p; });
    });
    Promise.all([S.rosters ? Promise.resolve(S.rosters) : api.rosters(), box]).then(function (res) {
      S.rosters = res[0]; S.box = res[1] || { games: {} };
      S.weeks = L.playerWeeks(S.box);
      setupCalcTeams(); renderCalc();
    }, function (e) {
      clear(st).className = 'state err';
      st.appendChild(document.createTextNode((e.status === 503 ? 'Rosters aren’t available from Yahoo right now.' : 'Couldn’t load the calculator. ' + e.message) + ' '));
      st.appendChild(h('button', { type: 'button', class: 'linkbtn', text: 'Try again', onclick: loadCalc }));
    });
  }
  function setupCalcTeams() {
    var ts = S.rosters.teams, a = $('cTeamA'), b = $('cTeamB');
    [a, b].forEach(function (s) { clear(s); ts.forEach(function (t) { s.appendChild(h('option', { value: t.team_key, text: t.manager })); }); });
    var mine = myKey(), first = ts.some(function (t) { return t.team_key === mine; }) ? mine : (ts[0] || {}).team_key;
    a.value = first;
    b.value = (ts.filter(function (t) { return t.team_key !== first; })[0] || {}).team_key || first;
    a.onchange = function () { S.picks.A = []; renderCalc(); };
    b.onchange = function () { S.picks.B = []; renderCalc(); };
  }
  function rosterOf(teamKey) { var t = S.rosters.teams.filter(function (x) { return x.team_key === teamKey; })[0]; return t ? t.players : []; }
  function renderPicks(side) {
    var box = clear($('picks' + side)), teamKey = $('cTeam' + side).value, players = rosterOf(teamKey), picks = S.picks[side];
    if (!players.length) { box.appendChild(h('p', { class: 'fine', text: 'No players on this roster.' })); return; }
    players.forEach(function (p) {
      box.appendChild(h('label', {}, [
        h('input', { type: 'checkbox', checked: picks.indexOf(p.player_key) >= 0, 'data-k': side + ':' + p.player_key, onchange: function (e) {
          var i = picks.indexOf(p.player_key);
          if (e.target.checked && i < 0) picks.push(p.player_key);
          if (!e.target.checked && i >= 0) picks.splice(i, 1);
          renderCalcOut();
        } }),
        posBadge(p.position), h('span', { class: 'nm', text: p.name }), p.nfl_team ? h('span', { class: 'nfl', text: p.nfl_team }) : null
      ]));
    });
  }
  function renderCalc() {
    $('calcState').textContent = '';
    renderPicks('A'); renderPicks('B'); renderCalcOut();
  }
  function fmt(n) { return n === null || n === undefined ? '—' : (Math.round(n * 10) / 10).toFixed(1); }
  function renderCalcOut() {
    var out = clear($('calcOut')), weeks = [];
    Object.keys(S.box.games || {}).forEach(function (id) { var m = /-w(\d+)-/.exec(id); if (m && weeks.indexOf(+m[1]) < 0) weeks.push(+m[1]); });
    weeks.sort(function (a, b) { return a - b; });
    $('calcSource').textContent = weeks.length
      ? 'Source: ' + S.boxSeason + ' Yahoo league scoring from this site’s weekly box scores, weeks ' + weeks[0] + (weeks.length > 1 ? '–' + weeks[weeks.length - 1] : '') +
        '. A player only has scores for weeks they were on a league roster.'
      : 'No scored weeks are available yet, so there’s nothing to compare.';
    var sides = ['A', 'B'].map(function (s) {
      var players = rosterOf($('cTeam' + s).value);
      var picked = S.picks[s].map(function (k) { return players.filter(function (p) { return p.player_key === k; })[0]; }).filter(Boolean);
      var stats = picked.map(function (p) { return L.playerStats(S.weeks, p, 3); });
      return { side: s, manager: managerOfRoster($('cTeam' + s).value), players: picked, stats: stats, tot: L.sideTotals(stats) };
    });
    if (!sides[0].players.length || !sides[1].players.length) {
      out.appendChild(h('p', { class: 'state', text: 'Pick at least one player on each side to compare what they’ve scored.' }));
      return;
    }
    var rows = [];
    sides.forEach(function (sd) {
      sd.players.forEach(function (p, i) {
        var st = sd.stats[i];
        rows.push(h('tr', { class: 'side-' + sd.side.toLowerCase() }, [
          h('td', {}, [p.name + ' ', h('span', { class: 'nfl', text: p.position + (p.nfl_team ? ' · ' + p.nfl_team : '') })]),
          h('td', { text: st.games ? String(st.games) : '0' }), h('td', { class: 'num', text: st.games ? fmt(st.total) : '—' }),
          h('td', { class: 'num', text: fmt(st.ppg) }), h('td', { class: 'num', text: fmt(st.recent) })
        ]));
      });
      rows.push(h('tr', { class: 'total side-' + sd.side.toLowerCase() }, [
        h('td', { text: 'Side ' + sd.side + ' (' + sd.manager + ') combined' }), h('td', { text: String(sd.tot.games) }),
        h('td', { class: 'num', text: fmt(sd.tot.total) }), h('td', { class: 'num', text: fmt(sd.tot.ppg) }), h('td', { class: 'num', text: fmt(sd.tot.recent) })
      ]));
    });
    out.appendChild(h('table', { class: 'cmp' }, [
      h('caption', { class: 'sr-only', text: 'Points scored by the players on each side' }),
      h('thead', {}, [h('tr', {}, ['Player', 'Weeks', 'Total', 'Per week', 'Last 3 avg'].map(function (t) { return h('th', { scope: 'col', text: t }); }))]),
      h('tbody', {}, rows)
    ]));
    var a = sides[0].tot, b = sides[1].tot, notes = [];
    if (a.games && b.games) {
      var diff = a.ppg - b.ppg;
      notes.push(Math.abs(diff) < 0.05 ? 'Both sides have averaged the same combined points per week.'
        : 'Side ' + (diff > 0 ? 'A' : 'B') + '’s players have averaged ' + fmt(Math.abs(diff)) + ' more combined points per week so far.');
    }
    sides.forEach(function (sd) {
      if (sd.tot.missing) notes.push('Side ' + sd.side + ': ' + plural(sd.tot.missing, 'player has', 'players have') + ' no scored weeks on a league roster yet, so ' + (sd.tot.missing === 1 ? 'isn’t' : 'aren’t') + ' in the totals.');
    });
    var small = sides.some(function (sd) { return sd.stats.some(function (s) { return s.games && s.games < 3; }); });
    if (small) notes.push('Small sample: some players have fewer than 3 scored weeks.');
    notes.forEach(function (t) { out.appendChild(h('p', { class: 'fine', text: t })); });
  }
  function managerOfRoster(teamKey) { var t = S.rosters.teams.filter(function (x) { return x.team_key === teamKey; })[0]; return t ? t.manager : ''; }

  // ---------- wire up ----------
  function init() {
    initTabs();
    showSigninMessage();
    ['q', 'fPos', 'fTeam', 'fStatus', 'fSort'].forEach(function (id) { $(id).addEventListener(id === 'q' ? 'input' : 'change', renderBlock); });
    $('filters').addEventListener('submit', function (e) { e.preventDefault(); });
    $('mTeam').addEventListener('change', renderMatch);
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
    if (hash === 'matchmaker') showTab('match'); else if (hash === 'calculator') showTab('calc');
    loadListings();
    loadMe();
  }
  init();
})();
