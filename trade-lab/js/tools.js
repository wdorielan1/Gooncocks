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
  // A player's name that opens his game log (js/playercard.js).
  function pl(p, text, cls) { return window.PlayerCard ? PlayerCard.link(p, text, cls) : document.createTextNode(text === undefined ? p.name : text); }
  if (window.PlayerCard) PlayerCard.source(function (s) { return api.gameLog(s); });

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
  // Points Against data (also used for the Waiver Wire Report's matchups).
  function ensurePa() {
    if (S.pa === undefined && !S.paLoad) {
      S.paLoad = api.pointsAgainst(season()).then(function (d) { S.pa = d; S.paLoad = null; renderTools(); },
        function () { S.pa = null; S.paLoad = null; renderTools(); });
    }
    return S.pa !== undefined;
  }
  var TOOLS = { pa: 'tool-pa', ww: 'tool-ww', ld: 'tool-ld', tx: 'tool-tx', ir: 'tool-ir' };
  function renderToolNav() {
    var tool = S.tool || 'pa';
    Array.prototype.forEach.call(document.querySelectorAll('#toolNav .tool-b'), function (b) {
      var on = b.getAttribute('data-tool') === tool;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Object.keys(TOOLS).forEach(function (t) { $(TOOLS[t]).hidden = t !== tool; });
  }
  function renderTools() {
    renderToolNav();
    if (S.tool === 'ww') return renderWW();
    if (S.tool === 'ir') return renderIR();
    if (S.tool === 'tx') return renderTX();
    if (S.tool === 'ld') return renderLD();
    var st = $('paState');
    if (!ensurePa()) {
      st.className = 'state'; st.textContent = 'Loading…';
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
      renderTools();
      if (m.signed_in && m.can_edit) {
        return api.myRoster().then(function (r) { S.mine = r.players || []; }, function (e) { S.mineErr = e.message; });
      }
    }, function () { S.me = null; }).then(renderTools);
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
          return h('li', {}, [h('div', {}, [h('span', { class: 'pa-pn' }, [pos === 'DEF' ? p[0] : pl({ name: p[0], position: pos, nfl_team: p[1] })]), p[3] ? h('span', { class: 'pa-pl', text: p[3] }) : null]),
            h('b', { class: 'pa-pp', text: fmt(p[2]) })]);
        })) : h('p', { class: 'fine', text: 'No points scored.' })
      ]);
    })));
    body.appendChild(h('p', { class: 'fine', text: 'Stats: nflverse, scored with our league’s Yahoo settings.' }));
    lastFocus = opener || document.activeElement;
    $('detail').hidden = false;
    $('detailClose').focus();
  }



  // ---------- waiver wire report ----------
  // Free agents and waiver players come from the Trade Lab API (read from
  // Yahoo). Their points come from nflverse's weekly stats in our scoring
  // (nfl/players_<season>.json), matched by name the way the Lambda does it.
  function nameKey(n) {
    return String(n || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
      .replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  }
  function nflIndex() {
    if (S.nflIdx) return S.nflIdx;
    var idx = {};
    ((S.nflp || {}).players || []).forEach(function (p) {
      (idx[p[0] + '|' + p[2]] = idx[p[0] + '|' + p[2]] || []).push(p);
      (idx[p[0]] = idx[p[0]] || []).push(p);
    });
    return (S.nflIdx = idx);
  }
  // A player's weekly points {week: pts}, or null if nflverse has none.
  function weeksFor(p) {
    var team = nflCode(p.nfl_team);
    if (p.position === 'DEF') return ((S.nflp || {}).defenses || {})[team] || null;
    var idx = nflIndex(), k = nameKey(p.name), list = idx[k + '|' + p.position] || idx[k] || [];
    if (!list.length) return null;
    return (list.filter(function (x) { return x[3] === team; })[0] || list[0])[4];
  }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  // Points per game over the season and the last 4 games he played.
  function form(p) {
    var w = weeksFor(p);
    if (!w) return null;
    var pts = Object.keys(w).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return w[k]; });
    return pts.length ? { games: pts.length, season: avg(pts), last4: avg(pts.slice(-4)) } : null;
  }
  // Every week's points this season for one player: big weeks green, duds
  // red (against his own average), "–" when he didn't score (bye, injured,
  // or no stats).
  function weekChips(p, f) {
    var w = weeksFor(p), weeks = (S.nflp && S.nflp.weeks) || [], last = weeks.length ? Math.max.apply(null, weeks) : 0;
    if (!w || !last) return null;
    var cells = [];
    for (var wk = 1; wk <= last; wk++) {
      var pts = w[wk], has = typeof pts === 'number';
      var tone = !has || !f || !f.season ? '' : pts >= f.season * 1.25 ? ' hi' : pts <= f.season * 0.6 ? ' lo' : '';
      cells.push(h('li', { class: 'wk' + tone, title: 'Week ' + wk + ': ' + (has ? fmt(pts) + ' pts' : 'no score') }, [
        h('span', { class: 'wk-n', text: 'W' + wk }), h('span', { class: 'wk-v', text: has ? fmt(pts) : '–' })]));
    }
    return h('ol', { class: 'wk-list ww-weeks', 'aria-label': p.name + ', points by week' }, cells);
  }
  // Points each defense allows per game to a position, the league average,
  // and each defense's rank from 0 (0 = allows the most).
  function paAllowed(pos) {
    if (!S.pa || !S.pa.teams) return { ppg: {}, rank: {}, mean: 0 };
    S.paAllow = S.paAllow || {};
    if (S.paAllow[pos]) return S.paAllow[pos];
    var rows = Object.keys(S.pa.teams).map(function (code) {
      var t = S.pa.teams[code], wks = Object.keys(t.weeks || {});
      return [code, wks.length ? avg(wks.map(function (w) { return (t.weeks[w] || {})[pos] || 0; })) : 0];
    }).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); }), out = { ppg: {}, rank: {}, mean: avg(rows.map(function (r) { return r[1]; })) };
    rows.forEach(function (r, i) { out.ppg[r[0]] = r[1]; out.rank[r[0]] = i; });
    return (S.paAllow[pos] = out);
  }
  function paRank(pos) { return paAllowed(pos).rank; }
  // Next week's opponent and how easy that matchup is: {opp, i, n} or {bye}.
  function nextMatchup(p) {
    var wk = S.pa && paNextWeek();
    if (!wk) return null;
    var team = nflCode(p.nfl_team), opp = ((S.pa.schedule || {})[team] || {})[wk];
    if (!opp) return { bye: true, wk: wk };
    var r = paRank(p.position);
    return { opp: opp, wk: wk, i: r[opp], n: Object.keys(r).length };
  }
  // Our estimate for next week: his last-4 average, scaled by how many
  // points his opponent allows to his position compared with the league
  // average (kept within 30% either way). 0 on a bye; null if unknown.
  function projection(p, f, m) {
    if (!f || !m) return null;
    if (m.bye) return 0;
    var a = paAllowed(p.position), opp = a.ppg[m.opp];
    if (opp === undefined || !a.mean) return f.last4;
    return f.last4 * Math.max(0.7, Math.min(1.3, opp / a.mean));
  }
  function matchupChip(m) {
    if (!m) return h('span', { class: 'fine', text: '—' });
    if (m.bye) return h('span', { class: 'ww-bye', text: 'BYE' });
    var tier = m.i === undefined ? 2 : Math.min(4, Math.floor(m.i / m.n * 5));
    return h('span', { class: 'ww-match' }, [h('span', { text: m.opp + ' ' }),
      m.i === undefined ? null : h('span', { class: 'ww-rank pa-t' + (4 - tier), text: '#' + (m.i + 1), title: ordinal(m.i + 1) + ' easiest matchup of ' + m.n })]);
  }
  function tags(p) {
    var out = [];
    if (p.waivers) out.push(h('span', { class: 'ww-tag w', text: 'Claim', title: 'On waivers: put in a claim; he goes to the best waiver priority when waivers clear' }));
    if (p.injury) out.push(h('span', { class: 'ww-tag inj' + (/^(O|IR|PUP|NFI|SUSP|D)/.test(p.injury.code) ? ' out' : ''),
      text: p.injury.code + (p.injury.note ? ' · ' + p.injury.note : ''), title: p.injury.label }));
    return out;
  }
  function ensureWW() {
    if (S.avail === undefined && !S.availLoad) {
      S.availLoad = api.available().then(function (d) { S.avail = d; }, function (e) { S.avail = null; S.availErr = e.message; })
        .then(function () { S.availLoad = null; renderTools(); });
    }
    ensureNflp();
    ensurePa();
    if (S.me && S.me.can_edit && S.lg === undefined && !S.lgLoad) {
      S.lgLoad = api.rosters().then(function (d) { S.lg = d; }, function (e) { S.lg = null; S.lgErr = e.message; })
        .then(function () { S.lgLoad = null; renderTools(); });
    }
    return S.avail !== undefined && S.nflp !== undefined && S.pa !== undefined;
  }
  function ensureNflp() {
    if (S.nflp === undefined && !S.nflpLoad) {
      S.nflpLoad = api.nflPlayers(season()).then(function (d) { S.nflp = d; S.nflIdx = null; }, function () { S.nflp = null; })
        .then(function () { S.nflpLoad = null; renderTools(); });
    }
    return S.nflp !== undefined;
  }
  var WW_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  var DEFAULT_SLOTS = ['QB', 'WR', 'WR', 'WR', 'RB', 'RB', 'TE', 'W/R/T', 'K', 'DEF'];
  function renderWW() {
    var st = $('wwState');
    if (!ensureWW()) {
      st.className = 'state'; st.textContent = 'Loading…';
      renderReview();
      return;
    }
    st.textContent = '';
    if (!S.avail) { st.className = 'state'; st.textContent = S.availErr || 'Available players can’t be read from Yahoo right now.'; }
    else if (!S.nflp) { st.className = 'state'; st.textContent = 'The Waiver Wire Report shows up once this season’s games have been scored.'; }
    renderReview();
    var pos = S.wwPos || 'RB', box = clear($('wwPos'));
    WW_POS.forEach(function (p) {
      box.appendChild(h('button', { type: 'button', class: 'pa-pos-b' + (p === pos ? ' on' : ''), 'aria-pressed': p === pos ? 'true' : 'false',
        text: p, onclick: function () { S.wwPos = p; renderTools(); } }));
    });
    var tbl = clear($('wwTable'));
    $('wwNote').textContent = '';
    if (!S.avail || !S.nflp) return;
    var wk = S.pa && paNextWeek(), byProj = !!(wk && S.wwSortProj);
    var all = S.avail.players.filter(function (p) { return p.position === pos; }).map(function (p) {
      var f = form(p), m = f && wk ? nextMatchup(p) : null;
      return { p: p, f: f, m: m, proj: projection(p, f, m) };
    });
    var rows = all.filter(function (r) { return r.f; }).sort(function (a, b) {
      return (byProj ? (b.proj || 0) - (a.proj || 0) : 0) || b.f.last4 - a.f.last4 || b.f.season - a.f.season;
    }).slice(0, 25);
    var sbox = clear($('wwSort'));
    if (wk) {
      sbox.appendChild(h('span', { class: 'ww-sortlab', text: 'Sort by' }));
      [[false, 'Last 4'], [true, 'Wk ' + wk + ' proj']].forEach(function (o) {
        sbox.appendChild(h('button', { type: 'button', class: 'pa-pos-b ww-sort' + (o[0] === byProj ? ' on' : ''), 'aria-pressed': o[0] === byProj ? 'true' : 'false',
          text: o[1], onclick: function () { S.wwSortProj = o[0]; renderTools(); } }));
      });
    }
    tbl.appendChild(h('caption', { class: 'sr-only', text: 'Best available ' + PA_WHO[pos] + ', by points per game over their last 4 games' }));
    tbl.appendChild(h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', class: 'pa-rank', text: '#' }), h('th', { scope: 'col', text: 'Player' }),
      h('th', { scope: 'col', class: byProj ? 'pa-nexth' : 'pa-ptsh', text: 'Last 4', 'aria-sort': byProj ? null : 'descending' }),
      h('th', { scope: 'col', class: 'pa-nexth ww-col-season', text: 'Season' }),
      wk ? h('th', { scope: 'col', class: byProj ? 'pa-ptsh' : 'pa-nexth', text: 'Wk ' + wk + ' proj', 'aria-sort': byProj ? 'descending' : null }) : null,
      wk ? h('th', { scope: 'col', class: 'pa-nexth', text: 'Wk ' + wk + ' vs' }) : null])]));
    var body = [];
    rows.forEach(function (r, i) {
      body.push(h('tr', {}, [h('td', { class: 'pa-rank', text: String(i + 1) }),
        h('th', { scope: 'row' }, [pl(Object.assign({ manager: null }, r.p), undefined, 'ww-name'),
          h('span', { class: 'ww-sub' }, [h('span', { text: nflCode(r.p.nfl_team) + ' · ' + plural(r.f.games, 'game') })].concat(tags(r.p)))]),
        h('td', { class: byProj ? 'ww-season' : 'ww-pts', text: fmt(r.f.last4) }), h('td', { class: 'ww-season ww-col-season', text: fmt(r.f.season) }),
        wk ? h('td', { class: 'ww-proj' + (byProj ? ' on' : ''), text: r.m && r.m.bye ? '0.0' : fmt(r.proj) }) : null,
        wk ? h('td', { class: 'ww-next' }, [matchupChip(r.m)]) : null]));
    });
    tbl.appendChild(h('tbody', {}, body.length ? body : [h('tr', {}, [h('td', { colspan: '6', class: 'fine', text: 'No available ' + PA_WHO[pos] + ' with stats this season.' })])]));
    var hidden = all.length - all.filter(function (r) { return r.f; }).length, ws = S.nflp.weeks || [];
    $('wwNote').textContent = 'Tap a player for his game log. Free agents and waivers from Yahoo, ' + (S.avail.stale ? 'last read ' : 'checked ') + L.ago(S.avail.checked_at, now()) +
      (S.avail.stale ? ' (Yahoo isn’t answering right now)' : '') + '. Points per game in our scoring from nflverse' +
      (ws.length ? ', weeks ' + ws[0] + (ws.length > 1 ? '–' + ws[ws.length - 1] : '') : '') + '. ' +
      (wk ? 'Wk ' + wk + ' proj is our estimate: last-4 average adjusted for how many points his opponent gives up to his position. ' : '') +
      (hidden ? plural(hidden, 'player') + ' with no NFL stats yet ' + (hidden === 1 ? 'isn’t' : 'aren’t') + ' shown.' : '');
  }

  // Team review: each team's best lineup by last-4 form, compared spot by
  // spot. Only where you're in the bottom third of the league does it
  // suggest pickups, and only ones who've outscored your starter there.
  var OUT_SLOTS = { IR: 1, 'IR+': 1, NA: 1 };
  function lineupStrength(players, need) {
    var byPos = {};
    Object.keys(need).forEach(function (pos) {
      var best = players.filter(function (p) { return p.position === pos && !OUT_SLOTS[p.slot]; })
        .map(function (p) { var f = form(p); return { p: p, v: f ? f.last4 : 0 }; })
        .sort(function (a, b) { return b.v - a.v; }).slice(0, need[pos]);
      byPos[pos] = { sum: best.reduce(function (x, b) { return x + b.v; }, 0), starters: best };
    });
    return byPos;
  }
  function review() {
    var slots = (S.lg.slots && S.lg.slots.length ? S.lg.slots : DEFAULT_SLOTS), need = {};
    slots.forEach(function (sl) { if (WW_POS.indexOf(sl) >= 0) need[sl] = (need[sl] || 0) + 1; });
    var teams = (S.lg.teams || []).map(function (t) { return { key: t.team_key, manager: t.manager, s: lineupStrength(t.players || [], need) }; });
    var mine = teams.filter(function (t) { return t.key === S.me.team_key; })[0];
    if (!mine) return null;
    var n = teams.length, cut = n - Math.ceil(n / 3);
    return WW_POS.filter(function (pos) { return need[pos]; }).map(function (pos) {
      var rank = 1 + teams.filter(function (t) { return t.s[pos].sum > mine.s[pos].sum + 1e-9; }).length;
      var weakest = mine.s[pos].starters[mine.s[pos].starters.length - 1] || null, picks = [];
      if (rank > cut && S.avail) {
        var floor = (weakest ? weakest.v : 0) + 1, minGames = (S.nflp.weeks || []).length > 1 ? 2 : 1;
        picks = S.avail.players.filter(function (p) { return p.position === pos; }).map(function (p) { return { p: p, f: form(p) }; })
          .filter(function (r) { return r.f && r.f.games >= minGames && r.f.last4 >= floor; })
          .map(function (r) { r.m = S.pa && paNextWeek() ? nextMatchup(r.p) : null; return r; })
          .sort(function (a, b) { return b.f.last4 - a.f.last4; }).slice(0, 3);
      }
      var best = teams.slice().sort(function (a, b) { return b.s[pos].sum - a.s[pos].sum; })[0];
      return { pos: pos, rank: rank, n: n, weak: rank > cut, tier: rank <= Math.ceil(n / 3) ? 0 : rank > cut ? 2 : 1,
               weakest: weakest, many: need[pos] > 1, picks: picks, starters: mine.s[pos].starters, sum: mine.s[pos].sum,
               avg: teams.reduce(function (x, t) { return x + t.s[pos].sum; }, 0) / n, best: best, mineBest: best.key === mine.key };
    });
  }
  // Who's behind one rank chip: your starters there, the league average for
  // that spot, and the best team at it.
  function rankPanel(r) {
    var per = r.many ? ' (' + r.starters.length + ' starters, added up)' : '';
    return h('div', { class: 'ww-rkpanel', id: 'wwRkPanel' }, [
      h('p', { class: 'ww-rkp-h' }, [h('b', { text: 'Your ' + (r.many ? PA_WHO[r.pos] : r.pos) }), ' · ' + ordinal(r.rank) + ' of ' + r.n + per]),
      r.starters.length ? h('ol', { class: 'ww-rkp-list' }, r.starters.map(function (x) {
        var inj = x.p.injury;
        return h('li', {}, [h('span', {}, [h('b', { text: x.p.name }), h('span', { class: 'ww-sub' }, [h('span', { text: nflCode(x.p.nfl_team) + (x.p.slot === 'BN' ? ' · on your bench' : '') })]
            .concat(inj ? [h('span', { class: 'ww-tag inj' + (/^(O|IR|PUP|NFI|SUSP|D)/.test(inj.code) ? ' out' : ''), text: inj.code + (inj.note ? ' · ' + inj.note : '') })] : []))]),
          h('span', { class: 'ww-rkp-pts' }, [h('b', { text: fmt(x.v) }), ' pts/g'])]);
      })) : h('p', { class: 'fine', text: 'You don’t have a ' + r.pos + ' with points yet.' }),
      h('p', { class: 'ww-rkp-cmp', text: 'You: ' + fmt(r.sum) + ' · League average: ' + fmt(r.avg) +
        (r.mineBest ? ' · You’re the best in the league here.' : ' · Best: ' + (r.best.manager || 'another team') + ' ' + fmt(r.best.s[r.pos].sum) +
          ' (' + r.best.s[r.pos].starters.map(function (x) { return x.p.name; }).join(', ') + ')') }),
      h('p', { class: 'fine', text: 'Points per game over each player’s last 4 games, in our scoring. Your best lineup, so a bench player shows if he’s outscoring your starter.' })
    ]);
  }
  function renderReview() {
    var box = clear($('wwMe'));
    if (S.signinMsg) box.appendChild(h('p', { class: 'banner-msg' + (S.signinMsg[1] ? ' ' + S.signinMsg[1] : ''), text: S.signinMsg[0] }));
    if (!S.me) return;
    if (!S.me.signed_in) {
      box.appendChild(h('div', { class: 'pa-me-in' }, [h('span', { text: 'Sign in to see where your lineup is weak and who on the wire could help.' }), signInControl()]));
      return;
    }
    var acct = h('p', { class: 'pa-me-acct' }, (S.me.can_edit ? ['Signed in as ', h('b', { text: S.me.manager || 'your team' })] : ['Signed in · not in our league'])
      .concat([' · ', h('button', { type: 'button', class: 'linkbtn', text: 'Sign out', onclick: signOut })]));
    if (!S.me.can_edit) { box.appendChild(acct); return; }
    if (S.lg === null || !S.avail || !S.nflp) {
      box.appendChild(acct);
      if (S.lg === null) box.appendChild(h('p', { class: 'fine', text: S.lgErr || 'Rosters can’t be read from Yahoo right now.' }));
      return;
    }
    if (S.lg === undefined) { box.appendChild(acct); box.appendChild(h('p', { class: 'fine', text: 'Checking your team…' })); return; }
    var rows = review();
    var card = h('section', { class: 'pa-mine ww-review', 'aria-label': 'Your team review' }, [
      h('div', { class: 'pa-mine-h' }, [h('h4', { text: 'Your team review' }), acct])]);
    if (!rows) { card.appendChild(h('p', { class: 'fine', text: 'Your team isn’t in Yahoo’s roster list right now. Try again in a minute.' })); box.appendChild(card); return; }
    card.appendChild(h('p', { class: 'ww-explain', text: 'Your best lineup (by the last 4 games) against the rest of the league, spot by spot. Tap one to see who:' }));
    card.appendChild(h('div', { class: 'ww-ranks', role: 'group', 'aria-label': 'Your rank at each spot. Tap one to see your players there.' }, rows.map(function (r) {
      var open = S.wwOpen === r.pos;
      return h('button', { type: 'button', class: 'ww-rk t' + r.tier + (open ? ' on' : ''), 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'wwRkPanel',
        text: r.pos + ' ' + ordinal(r.rank), title: ordinal(r.rank) + ' of ' + r.n + ' at ' + r.pos + '. Tap to see who.',
        onclick: function () { S.wwOpen = open ? null : r.pos; renderTools(); } });
    })));
    var openRow = rows.filter(function (r) { return r.pos === S.wwOpen; })[0];
    if (openRow) card.appendChild(rankPanel(openRow));
    var weak = rows.filter(function (r) { return r.weak; });
    if (!weak.length) {
      card.appendChild(h('p', { class: 'ww-ok', text: 'Your lineup is in the top two-thirds of the league at every spot. No moves needed.' }));
    }
    weak.forEach(function (r) {
      var w = r.weakest;
      card.appendChild(h('div', { class: 'ww-weak' }, [
        h('p', { class: 'ww-weak-h' }, [h('b', { text: r.pos }), ' · ' + ordinal(r.rank) + ' of ' + r.n + ' in the league']),
        h('p', { class: 'ww-weak-s' }, w && w.v ? [(r.many ? 'Your weakest starter: ' : 'Your starter: '), pl(w.p), ', ' + fmt(w.v) + ' pts/game (last 4)']
          : ['You don’t have a ' + r.pos + ' scoring right now.']),
        r.picks.length ? h('ol', { class: 'ww-picks' }, r.picks.map(function (k) {
          return h('li', {}, [h('div', {}, [h('b', {}, [pl(Object.assign({ manager: null }, k.p))]), h('span', { class: 'ww-sub' },
            [h('span', { text: nflCode(k.p.nfl_team) + ' · ' + fmt(k.f.last4) + ' last 4' + (k.m ? ' · ' + (k.m.bye ? 'bye' : fmt(projection(k.p, k.f, k.m)) + ' proj') : '') })]
            .concat(tags(k.p))), weekChips(k.p, k.f)]), matchupChip(k.m)]);
        })) : h('p', { class: 'fine', text: 'Nobody on the wire has outscored ' + (w ? w.p.name : 'that spot') + ' lately. Hold.' })
      ]));
    });
    box.appendChild(card);
  }




  // ---------- fantasy leaders (live week + past weeks) ----------
  // leaders/live.json, saved by the Sunday/Monday live runs from Yahoo, and
  // leaders/week-N.json, saved when week N is published (final numbers):
  // {season, week, updated, positions: {pos: [[name, team, points, manager|null]]}}.
  function renderLD() {
    var st = $('ldState');
    if (S.ld === undefined) {
      if (!S.ldLoad) S.ldLoad = api.leaders().then(function (d) { S.ld = d; }, function () { S.ld = null; })
        .then(function () { S.ldLoad = null; renderTools(); });
      st.className = 'state'; st.textContent = 'Loading…';
      return;
    }
    st.textContent = '';
    var list = clear($('ldList')), box = clear($('ldPos')), weeks = clear($('ldWeeks'));
    $('ldWhen').textContent = '';
    var live = S.ld && S.ld.positions ? S.ld : null, wk = S.ldWk || null;
    var top = live ? live.week : 0;
    for (var w = top; w >= 1; w--) {
      (function (w) {
        var on = wk ? w === wk : w === top;
        weeks.appendChild(h('button', { type: 'button', class: 'pa-pos-b' + (on ? ' on' : '') + (w === top ? ' ld-live' : ''), 'aria-pressed': on ? 'true' : 'false',
          text: (w === top ? 'Live · Wk ' : 'Wk ') + w, onclick: function () { S.ldWk = w === top ? null : w; renderTools(); } }));
      })(w);
    }
    var d = live;
    if (wk) {
      S.ldPast = S.ldPast || {};
      if (S.ldPast[wk] === undefined) {
        if (!S.ldPastLoad) S.ldPastLoad = api.leadersWeek(wk).then(function (x) { S.ldPast[wk] = x; }, function () { S.ldPast[wk] = null; })
          .then(function () { S.ldPastLoad = null; renderTools(); });
        st.className = 'state'; st.textContent = 'Loading…';
        return;
      }
      d = S.ldPast[wk];
      if (!d || !d.positions) { st.className = 'state'; st.textContent = 'Week ' + wk + '’s leaders aren’t saved yet. They’re saved when the week’s recap is published.'; return; }
      $('ldWhen').textContent = 'Week ' + d.week + ' · final';
    } else if (!live) { st.className = 'state'; st.textContent = 'This week’s leaders show up after the early games on Sunday.'; return; }
    else $('ldWhen').textContent = 'Week ' + live.week + ' · live · as of ' + new Date(live.updated * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    var pos = S.ldPos || 'QB';
    WW_POS.forEach(function (p) {
      box.appendChild(h('button', { type: 'button', class: 'pa-pos-b' + (p === pos ? ' on' : ''), 'aria-pressed': p === pos ? 'true' : 'false',
        text: p, onclick: function () { S.ldPos = p; renderTools(); } }));
    });
    var rows = d.positions[pos] || [];
    if (!rows.length) { list.appendChild(h('li', { class: 'fine', text: wk ? 'No ' + PA_WHO[pos] + ' scored that week.' : 'No ' + PA_WHO[pos] + ' have scored yet this week.' })); return; }
    rows.forEach(function (r, i) {
      var mine = S.me && S.me.manager && r[3] === S.me.manager;
      list.appendChild(h('li', { class: 'ld-row' + (mine ? ' mine' : '') }, [
        h('span', { class: 'ld-rk', text: String(i + 1) }),
        h('span', { class: 'ld-nm' }, [h('b', {}, [pl({ name: r[0], position: pos, nfl_team: r[1], manager: r[3] || null }, pos === 'DEF' ? (NFL[r[1]] || r[1]) + ' D/ST' : r[0])]),
          h('small', {}, [r[1] + ' · ', r[3] ? h('span', { text: (mine ? '★ ' : '') + r[3] }) : h('span', { class: 'ld-fa', text: 'FA' })])]),
        h('span', { class: 'ld-pts', text: fmt(r[2]) })]));
    });
  }

  // ---------- transaction report ----------
  // The league's adds, drops and trades from the Trade Lab API (read from
  // Yahoo). For players picked up or traded for, "since" is how he's scored
  // per game in our scoring in the weeks after the move.
  function kickoffAt(team, wk) {
    var k = (((S.pa || {}).kickoffs || {})[nflCode(team)] || {})[wk];
    var m = k && /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d))?$/.exec(k);
    return m ? etToUtc(+m[1], +m[2], +m[3], m[4] ? +m[4] : 13, m[5] ? +m[5] : 0) : null;
  }
  function sinceMove(p, at) {
    if (!S.nflp || !S.pa || !S.pa.kickoffs) return null;
    var w = weeksFor(p);
    if (!w) return null;
    var first = null;
    for (var wk = 1; wk <= 18 && first === null; wk++) { var k = kickoffAt(p.nfl_team, wk); if (k !== null && k > at) first = wk; }
    if (first === null) return null;
    var pts = Object.keys(w).map(Number).filter(function (k) { return k >= first; }).map(function (k) { return w[k]; });
    return { games: pts.length, ppg: pts.length ? avg(pts) : null };
  }
  function txTime(at) {
    var d = new Date(at * 1000);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function txDay(at) {
    return new Date(at * 1000).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function txPlayer(p, sign, at, extra) {
    var since = sign === '+' ? sinceMove(p, at) : null;
    return h('li', { class: 'tx-p ' + (sign === '+' ? 'add' : sign === '−' ? 'drop' : 'trade') }, [
      h('span', { class: 'tx-sign', text: sign, 'aria-hidden': 'true' }),
      h('span', { class: 'tx-pmain' }, [h('b', {}, [pl(p)]), h('span', { class: 'ir-pos', text: ' ' + p.position + (p.nfl_team ? ' · ' + nflCode(p.nfl_team) : '') }),
        extra ? h('span', { class: 'ww-tag ' + extra[1], text: extra[0] }) : null]),
      since ? h('span', { class: 'tx-since', title: 'Points per game in our scoring since this move' },
        since.games ? [h('b', { text: fmt(since.ppg) }), ' pts/g since · ' + plural(since.games, 'game')] : ['No games since yet']) : null
    ]);
  }
  // FAAB habits: each manager's winning waiver bids this season. Yahoo only
  // shows the bid that won a claim, never the ones that lost.
  function faabOf(t) {
    if (t.type === 'trade' || t.faab === null || t.faab === undefined || t.faab === '' || isNaN(Number(t.faab))) return null;
    if (!t.players.some(function (p) { return p.action === 'add' && p.from === 'waivers'; })) return null;
    return Number(t.faab);
  }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function money(n) { return '$' + (Math.round(n * 10) / 10).toString().replace(/\.0$/, ''); }
  function renderFaab(all, managers, sel) {
    var box = clear($('txFaab')), by = {};
    all.forEach(function (t) {
      var bid = faabOf(t), k = bid === null ? null : (t.teams[0] || {}).team_key;
      if (k) (by[k] = by[k] || []).push({ bid: bid, at: t.at });
    });
    var keys = Object.keys(by);
    if (!keys.length) return;
    keys.sort(function (a, b) { return median(by[b].map(function (x) { return x.bid; })) - median(by[a].map(function (x) { return x.bid; })) || by[b].length - by[a].length; });
    var none = Object.keys(managers).filter(function (k) { return !by[k]; }).map(function (k) { return managers[k]; }).sort();
    var rows = keys.map(function (k) {
      var bids = by[k].map(function (x) { return x.bid; }), sum = bids.reduce(function (a, b) { return a + b; }, 0);
      var last = by[k].slice().sort(function (a, b) { return b.at - a.at; })[0];
      var mine = S.me && S.me.team_key === k;
      return h('tr', { class: (k === sel ? 'on' : '') + (mine ? ' mine' : '') }, [
        h('th', { scope: 'row' }, [h('button', { type: 'button', class: 'fb-who', title: 'Show only ' + (managers[k] || 'this manager') + '’s moves',
          onclick: function () { S.txWho = k === sel ? '' : k; renderTools(); } }, [(mine ? '★ ' : '') + (managers[k] || 'A manager')])]),
        h('td', { class: 'fb-usual', text: money(median(bids)) }),
        h('td', { class: 'fb-avg', text: money(sum / bids.length) }),
        h('td', { text: money(Math.max.apply(null, bids)) }),
        h('td', { text: String(bids.length) }),
        h('td', { text: money(sum) }),
        h('td', { class: 'fb-last', text: money(last.bid) })]);
    });
    box.appendChild(h('section', { class: 'fb', 'aria-labelledby': 'fbTitle' }, [
      h('div', { class: 'fb-head' }, [h('h4', { id: 'fbTitle', text: 'FAAB habits' }),
        h('p', { text: 'What each manager usually bids on a waiver claim, from every claim they’ve won this season.' })]),
      h('div', { class: 'fb-wrap' }, [h('table', { class: 'fb-t' }, [
        h('caption', { class: 'sr-only', text: 'Winning FAAB bids by manager this season' }),
        h('thead', {}, [h('tr', {}, ['Manager', 'Usual bid', 'Average', 'Biggest', 'Claims', 'Spent', 'Last bid'].map(function (c, i) {
          return h('th', { scope: 'col', class: ['', 'fb-usual', 'fb-avg', '', '', '', 'fb-last'][i] || null, text: c }); }))]),
        h('tbody', {}, rows)])]),
      h('p', { class: 'fine fb-note', text: 'Usual bid is the middle of their winning bids, so one big splurge doesn’t skew it. ' +
        'Yahoo only shows the bid that won a claim, not losing bids, so someone who bids often but loses looks quieter than they are.' +
        (none.length ? ' No winning claims yet: ' + none.join(', ') + '.' : '') })]));
  }
  function txCard(t) {
    var mine = S.me && S.me.team_key && t.teams.some(function (m) { return m.team_key === S.me.team_key; });
    var who = function (k) { var m = t.teams.filter(function (x) { return x.team_key === k; })[0]; return (m && m.manager) || 'A manager'; };
    if (t.type === 'trade') {
      var sides = t.teams.map(function (m) {
        return h('div', { class: 'tx-side' }, [h('p', { class: 'tx-gets', text: (m.manager || 'A manager') + ' gets' }),
          h('ul', { class: 'tx-list' }, t.players.filter(function (p) { return p.to_team === m.team_key; }).map(function (p) { return txPlayer(p, '+', t.at); }))]);
      });
      return h('li', { class: 'tx-card trade' + (mine ? ' mine' : '') }, [
        h('div', { class: 'tx-head' }, [h('span', { class: 'tx-kind trade', text: 'Trade' }),
          h('b', { text: t.teams.map(function (m) { return m.manager || 'A manager'; }).join(' ⇄ ') }), h('span', { class: 'tx-time', text: txTime(t.at) })]),
        h('div', { class: 'tx-sides' }, sides)]);
    }
    var adds = t.players.filter(function (p) { return p.action === 'add'; }), drops = t.players.filter(function (p) { return p.action === 'drop'; });
    var manager = who((adds[0] || {}).to_team || (drops[0] || {}).from_team || (t.teams[0] || {}).team_key);
    var how = function (p) { return p.from === 'waivers' ? ['Claim' + (t.faab !== null && t.faab !== undefined && t.faab !== '' ? ' $' + t.faab : ''), 'w'] : ['Free agent', 'fa']; };
    return h('li', { class: 'tx-card' + (mine ? ' mine' : '') }, [
      h('div', { class: 'tx-head' }, [h('span', { class: 'tx-kind ' + (adds.length ? 'add' : 'drop'), text: adds.length && drops.length ? 'Add/Drop' : adds.length ? 'Add' : 'Drop' }),
        h('b', { text: (mine ? '★ ' : '') + manager }), h('span', { class: 'tx-time', text: txTime(t.at) })]),
      h('ul', { class: 'tx-list' }, adds.map(function (p) { return txPlayer(p, '+', t.at, how(p)); })
        .concat(drops.map(function (p) { return txPlayer(p, '−', t.at); })))]);
  }
  function renderTX() {
    var st = $('txState');
    ensurePa(); ensureNflp();  // for "since" points
    if (S.txd === undefined) {
      if (!S.txLoad) S.txLoad = api.transactions().then(function (d) { S.txd = d; }, function (e) { S.txd = null; S.txErr = e.message; })
        .then(function () { S.txLoad = null; renderTools(); });
      st.className = 'state'; st.textContent = 'Loading…';
      return;
    }
    st.textContent = '';
    var body = clear($('txBody')), act = clear($('txActive')), tbox = clear($('txType'));
    $('txNote').textContent = '';
    if (!S.txd) { st.className = 'state'; st.textContent = S.txErr || 'Transactions can’t be read from Yahoo right now.'; return; }
    var all = S.txd.transactions || [];
    // manager menu: everyone who's made a move
    var managers = {};
    all.forEach(function (t) { t.teams.forEach(function (m) { if (m.team_key) managers[m.team_key] = m.manager || 'A manager'; }); });
    var sel = $('txWho'), cur = S.txWho || '';
    clear(sel);
    sel.appendChild(h('option', { value: '', text: 'Everyone' }));
    Object.keys(managers).sort(function (a, b) { return managers[a].localeCompare(managers[b]); }).forEach(function (k) {
      sel.appendChild(h('option', { value: k, text: managers[k] + (S.me && S.me.team_key === k ? ' (you)' : '') }));
    });
    sel.value = managers[cur] ? cur : '';
    sel.onchange = function () { S.txWho = sel.value; renderTools(); };
    renderFaab(all, managers, sel.value);
    var type = S.txType || 'all';
    [['all', 'All'], ['add', 'Adds'], ['drop', 'Drops'], ['trade', 'Trades']].forEach(function (o) {
      tbox.appendChild(h('button', { type: 'button', class: 'pa-pos-b' + (o[0] === type ? ' on' : ''), 'aria-pressed': o[0] === type ? 'true' : 'false',
        text: o[1], onclick: function () { S.txType = o[0]; renderTools(); } }));
    });
    // most active, all season
    var count = {};
    all.forEach(function (t) { t.teams.forEach(function (m) { if (m.team_key) count[m.team_key] = (count[m.team_key] || 0) + 1; }); });
    var order = Object.keys(count).sort(function (a, b) { return count[b] - count[a] || managers[a].localeCompare(managers[b]); });
    if (order.length) {
      act.appendChild(h('div', { class: 'tx-active' }, [h('span', { class: 'strip-lab', text: 'Most active' })].concat(order.map(function (k) {
        return h('button', { type: 'button', class: 'tx-chip' + (k === sel.value ? ' on' : ''), onclick: function () { S.txWho = k === sel.value ? '' : k; renderTools(); } },
          [managers[k] + ' ', h('b', { text: String(count[k]) })]);
      }))));
    }
    var shown = all.filter(function (t) {
      if (sel.value && !t.teams.some(function (m) { return m.team_key === sel.value; })) return false;
      if (type === 'trade') return t.type === 'trade';
      if (type === 'add' || type === 'drop') return t.type !== 'trade' && t.players.some(function (p) { return p.action === type; });
      return true;
    });
    if (!shown.length) { body.appendChild(h('p', { class: 'fine', text: all.length ? 'No moves match.' : 'No moves yet this season.' })); }
    var lastDay = null, list = null;
    shown.forEach(function (t) {
      var d = txDay(t.at);
      if (d !== lastDay) {
        lastDay = d;
        body.appendChild(h('h4', { class: 'tx-day', text: d }));
        list = body.appendChild(h('ol', { class: 'tx-feed' }));
      }
      list.appendChild(txCard(t));
    });
    $('txNote').textContent = 'From Yahoo, ' + (S.txd.stale ? 'last read ' : 'checked ') + L.ago(S.txd.checked_at, now()) +
      (S.txd.stale ? ' (Yahoo isn’t answering right now)' : '') + '. Times are in your time zone. “Since” uses nflverse stats in our scoring.';
  }

  // ---------- injury report ----------
  // Every injured player on a league roster, from the Trade Lab API (which
  // reads Yahoo and remembers each player's last status, for "coming back").
  var BENCH = { BN: 'Bench', IR: 'IR spot', 'IR+': 'IR spot', NA: 'NA spot' };
  function slotText(p) { return BENCH[p.slot] || (p.slot ? 'Starting' : ''); }
  function isOut(code) { return code && code !== 'Q' && code !== 'D'; }
  function newsLink(p) {
    var id = /\.p\.(\d+)$/.exec(p.player_key || '');
    return id ? h('a', { class: 'ir-news', href: 'https://sports.yahoo.com/nfl/players/' + id[1] + '/news/', target: '_blank', rel: 'noopener',
      text: 'News', 'aria-label': 'Yahoo news on ' + p.name }) : null;
  }
  // A team's next kickoff (nflverse lists them in Eastern time), as
  // {day: "Sun", time: "1:00 PM", opp} - or {bye} if its next week is off.
  function etToUtc(y, m, d, hh, mm) {
    // Eastern daylight time runs from the 2nd Sunday of March to the 1st Sunday of November.
    function nthSunday(month, n) { var first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + (7 - first) % 7 + (n - 1) * 7; }
    var dst = (m > 3 || (m === 3 && d >= nthSunday(2, 2))) && (m < 11 || (m === 11 && d < nthSunday(10, 1)));
    return Date.UTC(y, m - 1, d, hh, mm) / 1000 + (dst ? 4 : 5) * 3600;
  }
  function nextKickoff(team) {
    var ks = ((S.pa || {}).kickoffs || {})[nflCode(team)], sched = ((S.pa || {}).schedule || {})[nflCode(team)] || {};
    if (!ks) return null;
    var t = now(), wks = Object.keys(ks).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < wks.length; i++) {
      var m = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d))?$/.exec(ks[wks[i]]);
      if (!m) continue;
      var hh = m[4] ? +m[4] : 13, mm = m[5] ? +m[5] : 0, at = etToUtc(+m[1], +m[2], +m[3], hh, mm);
      if (at + 4 * 3600 < t) continue;  // over (games run about 3 hours)
      if (i > 0 && wks[i] - wks[i - 1] > 1 && at - t > 8 * 86400) return { bye: true };
      var day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
      return { day: day, time: m[4] ? (hh % 12 || 12) + ':' + m[5] + (hh < 12 ? ' AM' : ' PM') : '', opp: sched[wks[i]] || '' };
    }
    return null;
  }
  function irRow(p, back) {
    var mine = S.me && S.me.team_key && p.team_key === S.me.team_key, inj = p.injury;
    var gtd = !back && !isOut(inj.code), k = gtd ? nextKickoff(p.nfl_team) : null;
    var chip = back ? h('span', { class: 'ir-chip back', text: '↑', 'aria-hidden': 'true' })
      : h('span', { class: 'ir-chip ' + (gtd ? 'gtd' : 'out') + (k ? ' kick' : ''), title: k && !k.bye ? 'Kickoff ' + k.day + (k.time ? ' ' + k.time + ' ET' : '') : null }, [h('span', { class: 'ir-code', text: inj.code })].concat(
          !k ? [] : k.bye ? [h('span', { class: 'ir-kick', text: 'BYE' })]
          : [h('span', { class: 'ir-kick', text: k.day }), k.time ? h('span', { class: 'ir-kick', text: k.time.replace(' ', '\u00a0') }) : null]));
    var status = back ? p.was + ' → ' + (inj ? inj.code : 'Active') + (p.changed ? ' · ' + L.ago(p.changed, now()) : '')
      : (inj.label || inj.code) + (inj.note ? ' · ' + inj.note : '') + (p.since ? ' · listed ' + L.ago(p.since, now()) : '') +
        (k && k.bye ? ' · bye this week' : '');
    return h('li', { class: 'ir-row' + (mine ? ' mine' : '') }, [chip,
      h('div', { class: 'ir-main' }, [
        h('p', {}, [h('b', {}, [pl(Object.assign({}, p, { manager: p.manager || undefined }))]), h('span', { class: 'ir-pos', text: ' ' + p.position + ' · ' + nflCode(p.nfl_team) })]),
        h('p', { class: 'ir-status', text: status }),
        k && !k.bye ? h('p', { class: 'ir-kickoff', text: 'Kickoff ' + k.day + (k.time ? ' ' + k.time + ' ET' : '') + (k.opp ? ' vs ' + k.opp : '') }) : null,
        h('p', { class: 'ir-who' }, [(mine ? '★ ' : '') + (p.manager || 'A manager') + (slotText(p) ? ' · ' + slotText(p) : ''), newsLink(p) ? ' · ' : null, newsLink(p)])])]);
  }
  function renderIR() {
    var st = $('irState');
    ensurePa();  // kickoff times for game-time decisions
    if (S.inj === undefined) {
      if (!S.injLoad) S.injLoad = api.injuries().then(function (d) { S.inj = d; }, function (e) { S.inj = null; S.injErr = e.message; })
        .then(function () { S.injLoad = null; renderTools(); });
      st.className = 'state'; st.textContent = 'Loading…';
      renderIRMe();
      return;
    }
    st.textContent = '';
    renderIRMe();
    var body = clear($('irBody')), fbox = clear($('irFilter'));
    $('irNote').textContent = '';
    if (!S.inj) { st.className = 'state'; st.textContent = S.injErr || 'Injuries can’t be read from Yahoo right now.'; return; }
    var canMine = S.me && S.me.can_edit, filt = S.irFilter === 'mine' && !canMine ? 'all' : (S.irFilter || 'all');
    [['all', 'All teams'], ['start', 'Starters only']].concat(canMine ? [['mine', 'My team']] : []).forEach(function (o) {
      fbox.appendChild(h('button', { type: 'button', class: 'pa-pos-b' + (o[0] === filt ? ' on' : ''), 'aria-pressed': o[0] === filt ? 'true' : 'false',
        text: o[1], onclick: function () { S.irFilter = o[0]; renderTools(); } }));
    });
    var pos = S.irPos || 'ALL', pbox = clear($('irPos'));
    function keepTeam(p) {
      if (filt === 'mine') return p.team_key === S.me.team_key;
      if (filt === 'start') return slotText(p) === 'Starting';
      return true;
    }
    function keep(p) { return keepTeam(p) && (pos === 'ALL' || p.position === pos); }
    ['ALL'].concat(WW_POS).forEach(function (p) {
      var n = S.inj.injured.concat(S.inj.back || []).filter(function (x) { return keepTeam(x) && (p === 'ALL' || x.position === p); }).length;
      pbox.appendChild(h('button', { type: 'button', class: 'pa-pos-b' + (p === pos ? ' on' : ''), 'aria-pressed': p === pos ? 'true' : 'false',
        'aria-label': (p === 'ALL' ? 'All positions' : p) + ', ' + n + ' listed', onclick: function () { S.irPos = p; renderTools(); } },
        [p === 'ALL' ? 'All' : p, h('span', { class: 'ir-pc', text: String(n) })]));
    });
    function order(a, b) {
      var mine = (b.team_key === (S.me || {}).team_key) - (a.team_key === (S.me || {}).team_key);
      return mine || (slotText(b) === 'Starting') - (slotText(a) === 'Starting') || a.name.localeCompare(b.name);
    }
    var list = S.inj.injured.filter(keep);
    var sections = [
      ['Out', 'out', list.filter(function (p) { return isOut(p.injury.code); }).sort(order), false,
       'Nobody’s out' + (pos === 'ALL' ? '.' : ' at ' + pos + '.')],
      ['Game-time decisions', 'gtd', list.filter(function (p) { return !isOut(p.injury.code); })
        .sort(function (a, b) { return (a.injury.code === 'D' ? 0 : 1) - (b.injury.code === 'D' ? 0 : 1) || order(a, b); }), false,
       'No doubtful or questionable ' + (pos === 'ALL' ? 'players.' : PA_WHO[pos] + '.')],
      ['Coming back', 'back', (S.inj.back || []).filter(keep), true,
       'Nobody’s moved off Out or IR in the last two weeks.']
    ];
    sections.forEach(function (sec) {
      body.appendChild(h('section', { class: 'ir-sec ' + sec[1], 'aria-label': sec[0] }, [
        h('h4', { class: 'ir-h' }, [sec[0] + ' ', h('span', { class: 'ir-count', text: String(sec[2].length) })]),
        sec[2].length ? h('ol', { class: 'ir-list' }, sec[2].map(function (p) { return irRow(p, sec[3]); }))
          : h('p', { class: 'fine', text: sec[4] })]));
    });
    $('irNote').textContent = 'Statuses from Yahoo, ' + (S.inj.stale ? 'last read ' : 'checked ') + (S.inj.checked_at ? L.ago(S.inj.checked_at, now()) : 'just now') +
      (S.inj.stale ? ' (Yahoo isn’t answering right now)' : '') + '. “Coming back” is anyone who went from Out or IR to questionable or active.';
  }
  function renderIRMe() {
    var box = clear($('irMe'));
    if (S.signinMsg) box.appendChild(h('p', { class: 'banner-msg' + (S.signinMsg[1] ? ' ' + S.signinMsg[1] : ''), text: S.signinMsg[0] }));
    if (!S.me) return;
    if (!S.me.signed_in) {
      box.appendChild(h('div', { class: 'pa-me-in' }, [h('span', { text: 'Sign in to see your own players marked and a My team filter.' }), signInControl()]));
      return;
    }
    var acct = h('p', { class: 'pa-me-acct' }, (S.me.can_edit ? ['Signed in as ', h('b', { text: S.me.manager || 'your team' })] : ['Signed in · not in our league'])
      .concat([' · ', h('button', { type: 'button', class: 'linkbtn', text: 'Sign out', onclick: signOut })]));
    box.appendChild(acct);
    if (!S.me.can_edit || !S.inj) return;
    var mine = S.inj.injured.filter(function (p) { return p.team_key === S.me.team_key; });
    var out = mine.filter(function (p) { return isOut(p.injury.code); }).length, gtd = mine.length - out;
    box.appendChild(h('p', { class: 'ir-mine' + (mine.length ? '' : ' ok'), text: mine.length
      ? 'Your team: ' + [out ? out + ' out' : '', gtd ? gtd + ' game-time decision' + (gtd > 1 ? 's' : '') : ''].filter(Boolean).join(', ') + '.'
      : 'Your team is healthy.' }));
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
  Array.prototype.forEach.call(document.querySelectorAll('#toolNav .tool-b'), function (b) {
    b.addEventListener('click', function () {
      S.tool = b.getAttribute('data-tool'); renderTools();
      try { history.replaceState(null, '', { ww: '#waivers', ir: '#injuries', tx: '#transactions', ld: '#leaders' }[S.tool] || location.pathname); } catch (e) { /* ignore */ }
    });
  });
  var m = /^#(qb|rb|wr|te|k|def)$/i.exec(location.hash);
  if (m) S.paView = m[1].toUpperCase();
  if (/^#waivers$/i.test(location.hash)) S.tool = 'ww';
  if (/^#injuries$/i.test(location.hash)) S.tool = 'ir';
  if (/^#transactions$/i.test(location.hash)) S.tool = 'tx';
  if (/^#leaders$/i.test(location.hash)) S.tool = 'ld';
  renderTools();
})();
