/*
 * Tools page (stats.gooncocks.com/tools.html): league tools that aren't
 * about one trade. First tool: Points Against - how many fantasy points
 * each NFL defense gives up to each position, in our league's scoring,
 * from nfl/points_against_<season>.json (built by the Lambda's nfl_points
 * action). Everything is put on the page as text, never HTML.
 */
(function () {
  var api = window.TradeApi, L = window.TradeLogic;
  var HOME = 'stats.gooncocks.com';
  if (!api.preview && /(^|\.)gooncocks\.com$/.test(location.hostname) && location.hostname !== HOME) {
    location.replace('https://' + HOME + location.pathname + location.search + location.hash);
    return;
  }
  var $ = function (id) { return document.getElementById(id); };
  var S = {}, lastFocus = null;

  // ---------- tiny DOM helpers (text only) ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function now() { return Date.now() / 1000; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function season() { var d = new Date(); return d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear(); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function fmt(n) { return n === null || n === undefined || isNaN(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1); }

  // ---------- details window ----------
  function trapFocus(container, e) {
    if (e.key !== 'Tab') return;
    var f = container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
    f = Array.prototype.filter.call(f, function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  function closeDetail() {
    if ($('detail').hidden) return;
    $('detail').hidden = true;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  // ---------- points against ----------
  var NFL = { ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns',
    DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers', HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs',
    LAC: 'Chargers', LAR: 'Rams', LV: 'Raiders', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
    NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks', SF: '49ers', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders' };
  var PA_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  function renderTools() {
    var st = $('paState');
    if (S.pa === undefined) {
      st.className = 'state'; st.textContent = 'Loading…';
      if (!S.paLoad) S.paLoad = api.pointsAgainst(season()).then(function (d) { S.pa = d; S.paLoad = null; renderTools(); });
      return;
    }
    if (!S.pa || !S.pa.teams || !Object.keys(S.pa.teams).length) {
      st.className = 'state'; st.textContent = 'Points Against shows up once this season’s games have been scored.';
      return;
    }
    st.textContent = '';
    renderPaPos();
    renderPaPosition(S.paView || 'RB');
  }

  // Position tabs: one position at a time.
  function renderPaPos() {
    var box = clear($('paPos')), view = S.paView || 'RB';
    PA_POS.forEach(function (p) {
      box.appendChild(h('button', { type: 'button', class: 'pa-pos-b' + (p === view ? ' on' : ''), 'aria-pressed': p === view ? 'true' : 'false',
        text: p, onclick: function () {
          S.paView = p; renderTools();
          try { history.replaceState(null, '', '#' + p.toLowerCase()); } catch (e) { /* file:// or sandboxed */ }
        } }));
    });
  }
  function paWeeks(t) {
    var wks = Object.keys(t.weeks || {}).map(Number).sort(function (a, b) { return a - b; });
    return S.paLast4 ? wks.slice(-4) : wks;
  }
  // The week after the last one scored, if the regular season has one left.
  function paNextWeek() {
    var wks = S.pa.weeks || [], w = (wks.length ? Math.max.apply(null, wks) : 0) + 1;
    return w <= 18 && S.pa.schedule ? w : null;
  }
  // One position: every defense ranked from easiest matchup (most points
  // allowed per game) to toughest, with who it plays next. The average stats
  // behind the points are one tap away.
  function renderPaPosition(pos) {
    var last4 = !!S.paLast4, showStats = !!S.paStats, cols = (S.pa.cols || {})[pos] || [], nextWk = paNextWeek();
    $('paSeason').setAttribute('aria-pressed', last4 ? 'false' : 'true'); $('paSeason').classList.toggle('gold', !last4); $('paSeason').classList.toggle('ghost', last4);
    $('paLast4').setAttribute('aria-pressed', last4 ? 'true' : 'false'); $('paLast4').classList.toggle('gold', last4); $('paLast4').classList.toggle('ghost', !last4);
    $('paStats').setAttribute('aria-pressed', showStats ? 'true' : 'false'); $('paStats').textContent = showStats ? 'Hide stats' : 'Show stats';
    var rows = Object.keys(S.pa.teams).map(function (code) {
      var t = S.pa.teams[code], wks = paWeeks(t), n = wks.length || 1, avg = cols.map(function () { return 0; }), pts = 0;
      wks.forEach(function (w) {
        pts += (t.weeks[w] || {})[pos] || 0;
        (((t.stats || {})[w] || {})[pos] || []).forEach(function (v, i) { avg[i] += v; });
      });
      return { code: code, pts: pts / n, avg: avg.map(function (v) { return v / n; }) };
    }).sort(function (a, b) { return (b.pts - a.pts) || a.code.localeCompare(b.code); });
    // The columns that matter for the position first; then only columns with
    // something in them (no receiving columns for QBs, etc.).
    var FIRST = { RB: ['Rush Att', 'Rush Yds', 'Rush TD', 'Rec', 'Rec Yds', 'Rec TD', 'Tgt'], WR: ['Rec', 'Rec Yds', 'Rec TD', 'Tgt'], TE: ['Rec', 'Rec Yds', 'Rec TD', 'Tgt'] }[pos] || [];
    var order = cols.map(function (c, i) { return i; }).sort(function (a, b) {
      var ia = FIRST.indexOf(cols[a]), ib = FIRST.indexOf(cols[b]);
      return (ia < 0 ? 99 + a : ia) - (ib < 0 ? 99 + b : ib);
    });
    cols = order.map(function (i) { return cols[i]; });
    rows.forEach(function (r) { r.avg = order.map(function (i) { return r.avg[i]; }); });
    var keep = cols.map(function (c, i) { return showStats && rows.some(function (r) { return Math.abs(r.avg[i]) >= 0.05; }); });
    var mine = myMatchups(pos, rows, nextWk), mineAt = {};
    (mine || []).forEach(function (m) { if (m.opp) (mineAt[m.opp] = mineAt[m.opp] || []).push(m.p.name); });
    var tbl = clear($('paTable')), n = rows.length;
    tbl.className = 'pa pa-full' + (showStats ? '' : ' pa-slim');
    tbl.appendChild(h('caption', { class: 'sr-only', text: 'Fantasy points allowed per game to ' + PA_WHO[pos] + ' by each NFL defense, easiest matchup first' }));
    tbl.appendChild(h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', class: 'pa-rank', text: '#' }), h('th', { scope: 'col', text: pos === 'DEF' ? 'Offense' : 'Defense' }),
      h('th', { scope: 'col', class: 'pa-ptsh', text: 'Pts / game', 'aria-sort': 'descending' }),
      nextWk ? h('th', { scope: 'col', class: 'pa-nexth', text: 'Wk ' + nextWk + ' vs' }) : null]
      .concat(cols.filter(function (c, i) { return keep[i]; }).map(function (c) { return h('th', { scope: 'col', class: 'pa-stat', text: c }); })))]));
    tbl.appendChild(h('tbody', {}, rows.map(function (r, i) {
      var tier = Math.min(4, Math.floor(i / n * 5)), opp = nextWk ? (S.pa.schedule[r.code] || {})[nextWk] : null;
      return h('tr', { class: mineAt[r.code] ? 'pa-mine-row' : null }, [h('td', { class: 'pa-rank', text: String(i + 1) }),
        h('th', { scope: 'row' }, [h('button', { type: 'button', class: 'pa-team', onclick: function (e) { openPaDetail(r.code, pos, e.currentTarget); } },
          [h('b', { text: r.code }), h('span', { class: 'pa-name', text: ' ' + (NFL[r.code] || '') })]),
          mineAt[r.code] ? h('span', { class: 'pa-mine-chip', text: '★ ' + mineAt[r.code].join(', ') }) : null]),
        h('td', { class: 'pa-pts pa-t' + (4 - tier) }, [h('button', { type: 'button', class: 'pa-cell', text: fmt(r.pts),
          'aria-label': (NFL[r.code] || r.code) + ' allow ' + fmt(r.pts) + ' pts/game to ' + PA_WHO[pos] + ', ' + ordinal(i + 1) + ' most. Show who scored it.',
          onclick: function (e) { openPaDetail(r.code, pos, e.currentTarget); } })]),
        nextWk ? h('td', { class: 'pa-next-opp' + (opp ? '' : ' bye'), text: opp || 'BYE' }) : null]
        .concat(r.avg.filter(function (v, i) { return keep[i]; }).map(function (v) { return h('td', { class: 'pa-stat', text: fmt(v) }); })));
    })));
    renderMine(pos, mine, rows.length, nextWk);
    paNote(last4);
  }

  // ---------- your players (signed in with Yahoo) ----------
  // The roster comes from the Trade Lab API, which checks with Yahoo which
  // team the signed-in account manages. Signed out, the page is unchanged.
  var TEAM_FIX = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
  function nflCode(t) { t = String(t || '').toUpperCase(); return TEAM_FIX[t] || t; }
  var MY_WHO = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', K: 'kicker', DEF: 'defense' };
  var MATCH = ['Great matchup', 'Good matchup', 'Average', 'Tough', 'Toughest'];
  // Each of my players at this position: who they play next and where that
  // opponent ranks in the table (0 = gives up the most), best first.
  function myMatchups(pos, rows, nextWk) {
    if (!S.mine) return null;
    var rank = {};
    rows.forEach(function (r, i) { rank[r.code] = i; });
    return S.mine.filter(function (p) { return p.position === pos; }).map(function (p) {
      var team = nflCode(p.nfl_team), opp = nextWk ? ((S.pa.schedule || {})[team] || {})[nextWk] || null : null;
      return { p: p, team: team, opp: opp, i: opp && rank[opp] !== undefined ? rank[opp] : null };
    }).sort(function (a, b) { return (a.i === null ? 99 : a.i) - (b.i === null ? 99 : b.i) || a.p.name.localeCompare(b.p.name); });
  }
  function signInControl() {
    if (api.preview) return h('button', { type: 'button', class: 'btn gold small', text: 'Sign in (preview)', onclick: function () { api.signIn(); loadMe(); } });
    return h('a', { class: 'btn gold small', href: api.signInUrl('tools'), text: 'Sign in with Yahoo' });
  }
  function signOut() {
    api.signOut().then(function () { S.me = { signed_in: false }; S.mine = null; S.mineErr = null; renderTools(); },
      function (e) { S.mineErr = e.message; renderTools(); });
  }
  function renderMine(pos, mine, n, nextWk) {
    var box = clear($('paMe'));
    if (S.signinMsg) box.appendChild(h('p', { class: 'banner-msg' + (S.signinMsg[1] ? ' ' + S.signinMsg[1] : ''), text: S.signinMsg[0] }));
    if (!S.me) return;
    if (!S.me.signed_in) {
      box.appendChild(h('div', { class: 'pa-me-in' }, [h('span', { text: 'Sign in to see where your players land this week.' }), signInControl()]));
      return;
    }
    var acct = h('p', { class: 'pa-me-acct' }, (S.me.can_edit ? ['Signed in as ', h('b', { text: S.me.manager || 'your team' })] : ['Signed in · not in our league'])
      .concat([' · ', h('button', { type: 'button', class: 'linkbtn', text: 'Sign out', onclick: signOut })]));
    if (!S.me.can_edit || S.mineErr || !mine) {
      box.appendChild(acct);
      if (S.mineErr) box.appendChild(h('p', { class: 'fine', text: S.mineErr }));
      else if (S.me.can_edit) box.appendChild(h('p', { class: 'fine', text: 'Loading your roster…' }));
      return;
    }
    var card = h('section', { class: 'pa-mine', 'aria-label': 'Your ' + MY_WHO[pos] }, [
      h('div', { class: 'pa-mine-h' }, [h('h4', { text: 'Your ' + MY_WHO[pos] + (nextWk ? ' · Week ' + nextWk : '') }), acct])]);
    if (!mine.length) card.appendChild(h('p', { class: 'fine', text: 'No ' + pos + ' on your roster right now.' }));
    else if (!nextWk) card.appendChild(h('p', { class: 'fine', text: 'No regular-season games left.' }));
    else card.appendChild(h('ol', { class: 'pa-mine-list' }, mine.map(function (m) {
      var slot = m.p.slot === 'BN' ? 'Bench' : m.p.slot === 'IR' ? 'IR' : '';
      if (m.i === null) {
        return h('li', { class: 'bye' }, [h('span', { class: 'pa-mine-rank', text: '—' }),
          h('div', {}, [h('b', { text: m.p.name }), h('span', { class: 'pa-mine-sub', text: m.team + (m.opp ? ' vs ' + m.opp : ' · BYE week') + (slot ? ' · ' + slot : '') })]),
          h('span', { class: 'pa-mine-tag', text: m.opp ? '' : 'Bye' })]);
      }
      var tier = Math.min(4, Math.floor(m.i / n * 5));
      return h('li', {}, [h('span', { class: 'pa-mine-rank pa-t' + (4 - tier), text: '#' + (m.i + 1), 'aria-label': 'Opponent ranked ' + ordinal(m.i + 1) + ' of ' + n }),
        h('div', {}, [h('b', { text: m.p.name }), h('span', { class: 'pa-mine-sub', text: m.team + ' vs ' + m.opp + (slot ? ' · ' + slot : '') })]),
        h('span', { class: 'pa-mine-tag t' + tier, text: MATCH[tier] })]);
    })));
    box.appendChild(card);
  }
  var SIGNIN = {
    ok: null,
    cancelled: ['Sign-in was cancelled. You can keep browsing.', 'warn'],
    expired: ['That sign-in attempt expired. Please sign in again.', 'warn'],
    error: ['Yahoo sign-in didn’t finish. Try again in a minute.', 'warn'],
    'not-in-league': ['That Yahoo account doesn’t manage a team in our league, so there are no players to show.', 'warn']
  };
  function loadMe() {
    api.me().then(function (m) {
      S.me = m; S.mine = null; S.mineErr = null;
      if (S.pa) renderTools();
      if (m.signed_in && m.can_edit) {
        return api.myRoster().then(function (r) { S.mine = r.players || []; }, function (e) { S.mineErr = e.message; });
      }
    }, function () { S.me = null; }).then(function () { if (S.pa) renderTools(); });
  }
  function paNote(last4) {
    var wks = S.pa.weeks || [];
    $('paNote').textContent = S.pa.season + (wks.length ? ' weeks ' + wks[0] + (wks.length > 1 ? '–' + wks[wks.length - 1] : '') : '') +
      (last4 ? ', each team’s last 4 games' : '') + '. Regular season, per game, in our league’s scoring (checked against Yahoo). ' +
      (S.pa.updated ? 'Updated ' + L.ago(S.pa.updated, now()) + '. ' : '') + 'Stats: nflverse.';
  }

  // Who scored the points behind one number: each game, newest first.
  var PA_WHO = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', K: 'kickers', DEF: 'fantasy defenses' };
  function openPaDetail(code, pos, opener) {
    var t = S.pa && S.pa.teams[code];
    if (!t) return;
    var wks = Object.keys(t.weeks || {}).map(Number).sort(function (a, b) { return a - b; });
    if (S.paLast4) wks = wks.slice(-4);
    var total = wks.reduce(function (sum, w) { return sum + ((t.weeks[w] || {})[pos] || 0); }, 0);
    var team = NFL[code] || code, body = clear($('detailBody'));
    var perGame = function (c) { var tt = S.pa.teams[c], ww = paWeeks(tt); return ww.length ? ww.reduce(function (s2, w) { return s2 + ((tt.weeks[w] || {})[pos] || 0); }, 0) / ww.length : 0; };
    var rankN = 1 + Object.keys(S.pa.teams).filter(function (c) { return perGame(c) > perGame(code); }).length;
    body.appendChild(h('h2', { class: 'pname', id: 'detailTitle', text: pos === 'DEF' ? team + ' offense vs defenses' : team + ' defense vs ' + PA_WHO[pos] }));
    body.appendChild(h('p', { class: 'pa-sub', text: fmt(wks.length ? total / wks.length : t[pos]) + ' pts allowed per game' +
      (S.paLast4 ? ' over the last ' + plural(wks.length, 'game') : '') + ', ' + ordinal(rankN) + ' most in the league, in our scoring.' }));
    // The next 3 weeks on their schedule (a missing week is a bye), with who they'd face.
    var sched = (S.pa.schedule || {})[code] || {}, played = Object.keys(t.weeks || {}).map(Number), lastPlayed = Math.max.apply(null, played.concat([0]));
    var next = [];
    for (var w2 = lastPlayed + 1; w2 <= 18 && next.length < 3; w2++) next.push(w2);
    if (next.length && Object.keys(sched).length) {
      body.appendChild(h('h3', { class: 'pa-h3', text: 'Up next' }));
      body.appendChild(h('ol', { class: 'pa-games pa-next' }, next.map(function (w) {
        var opp = sched[w];
        if (!opp) return h('li', { class: 'bye' }, [h('div', { class: 'pa-gh' }, [h('b', { text: 'Week ' + w }), h('span', { class: 'pa-gt', text: 'BYE' })])]);
        var likely = pos === 'DEF' ? [opp + ' D/ST'] : (((S.pa.starters || {})[opp] || {})[pos] || []);
        return h('li', {}, [h('div', { class: 'pa-gh' }, [h('b', { text: 'Week ' + w + ' vs ' + opp }), h('span', { class: 'pa-up', text: 'Upcoming' })]),
          likely.length ? h('p', { class: 'pa-likely', text: (pos === 'DEF' ? 'Facing ' : 'Likely: ') + likely.join(', ') }) : null]);
      })));
      body.appendChild(h('h3', { class: 'pa-h3', text: 'Games played' }));
    }
    var shown = wks.slice().reverse(), all = [];
    shown.forEach(function (w, i) {  // byes between played games
      all.push(w);
      var nxt = shown[i + 1];
      for (var b = w - 1; nxt !== undefined && b > nxt; b--) if (!sched[b]) all.push('bye' + b);
    });
    body.appendChild(h('ol', { class: 'pa-games' }, all.map(function (w) {
      if (typeof w === 'string') return h('li', { class: 'bye' }, [h('div', { class: 'pa-gh' }, [h('b', { text: 'Week ' + w.slice(3) }), h('span', { class: 'pa-gt', text: 'BYE' })])]);
      var who = ((t.who || {})[w] || {})[pos] || [], opp = who.length ? who[0][1] : '';
      return h('li', {}, [
        h('div', { class: 'pa-gh' }, [h('b', { text: 'Week ' + w + (opp ? ' vs ' + opp : '') }), h('span', { class: 'pa-gt', text: fmt((t.weeks[w] || {})[pos] || 0) + ' pts' })]),
        who.length ? h('ul', {}, who.map(function (p) {
          return h('li', {}, [h('div', {}, [h('span', { class: 'pa-pn', text: p[0] }), p[3] ? h('span', { class: 'pa-pl', text: p[3] }) : null]),
            h('b', { class: 'pa-pp', text: fmt(p[2]) })]);
        })) : h('p', { class: 'fine', text: 'No points scored.' })
      ]);
    })));
    body.appendChild(h('p', { class: 'fine', text: 'Stats: nflverse, scored with our league’s Yahoo settings.' }));
    lastFocus = opener || document.activeElement;
    $('detail').hidden = false;
    $('detailClose').focus();
  }


  // ---------- start ----------
  $('paSeason').addEventListener('click', function () { S.paLast4 = false; renderTools(); });
  $('paLast4').addEventListener('click', function () { S.paLast4 = true; renderTools(); });
  $('paStats').addEventListener('click', function () { S.paStats = !S.paStats; renderTools(); });
  $('detailClose').addEventListener('click', closeDetail);
  $('detail').addEventListener('click', function (e) { if (e.target === $('detail')) closeDetail(); });
  $('detail').addEventListener('keydown', function (e) { trapFocus($('detail'), e); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  if (api.preview) $('previewFlag').hidden = false;
  var sm = /[?&]signin=([a-z-]+)/.exec(location.search);
  if (sm) {
    S.signinMsg = SIGNIN[sm[1]] || null;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
  }
  loadMe();
  var m = /^#(qb|rb|wr|te|k|def)$/i.exec(location.hash);
  if (m) S.paView = m[1].toUpperCase();
  renderTools();
})();
