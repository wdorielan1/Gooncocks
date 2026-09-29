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
    if (S.paView && S.paView !== 'ALL') return renderPaPosition(S.paView);
    var last4 = !!S.paLast4, sortPos = S.paSort || 'QB';
    $('paSeason').setAttribute('aria-pressed', last4 ? 'false' : 'true'); $('paSeason').classList.toggle('gold', !last4); $('paSeason').classList.toggle('ghost', last4);
    $('paLast4').setAttribute('aria-pressed', last4 ? 'true' : 'false'); $('paLast4').classList.toggle('gold', last4); $('paLast4').classList.toggle('ghost', !last4);
    var rows = Object.keys(S.pa.teams).map(function (code) {
      var t = S.pa.teams[code], wks = Object.keys(t.weeks || {}).map(Number).sort(function (a, b) { return a - b; });
      if (last4) wks = wks.slice(-4);
      var avg = {};
      PA_POS.forEach(function (p) {
        avg[p] = wks.length ? wks.reduce(function (sum, w) { return sum + ((t.weeks[w] || {})[p] || 0); }, 0) / wks.length : (last4 ? null : t[p]);
      });
      return { code: code, avg: avg, games: wks.length || t.games };
    });
    // Shade by rank within each column: the top fifth (most allowed) darkest.
    var rank = {};
    PA_POS.forEach(function (p) {
      rows.slice().sort(function (a, b) { return (b.avg[p] || 0) - (a.avg[p] || 0); }).forEach(function (r, i) { (rank[r.code] = rank[r.code] || {})[p] = i; });
    });
    rows.sort(function (a, b) { return ((b.avg[sortPos] || 0) - (a.avg[sortPos] || 0)) || a.code.localeCompare(b.code); });
    var tbl = clear($('paTable'));
    tbl.className = 'pa';
    tbl.appendChild(h('caption', { class: 'sr-only', text: 'Fantasy points allowed per game by each NFL defense, by position' }));
    tbl.appendChild(h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', text: 'Defense' })].concat(PA_POS.map(function (p) {
      var on = p === sortPos;
      return h('th', { scope: 'col', 'aria-sort': on ? 'descending' : 'none' }, [h('button', { type: 'button', class: 'pa-sort' + (on ? ' on' : ''),
        text: p + (on ? ' ▼' : ''), 'aria-label': 'Sort by points allowed to ' + p, onclick: function () { S.paSort = p; renderTools(); } })]);
    })))]));
    var n = rows.length;
    tbl.appendChild(h('tbody', {}, rows.map(function (r) {
      return h('tr', {}, [h('th', { scope: 'row' }, [h('b', { text: r.code }), h('span', { class: 'pa-name', text: ' ' + (NFL[r.code] || '') })])]
        .concat(PA_POS.map(function (p) {
          var i = rank[r.code][p], tier = Math.min(4, Math.floor(i / n * 5));
          var label = (NFL[r.code] || r.code) + ' allow ' + fmt(r.avg[p]) + ' pts/game to ' + p + ' (' + ordinal(i + 1) + ' most)';
          return h('td', { class: 'pa-t' + (4 - tier) + (p === sortPos ? ' on' : ''), title: label }, [
            h('button', { type: 'button', class: 'pa-cell', text: fmt(r.avg[p]), 'aria-label': label + '. Show who scored it.',
              onclick: function (e) { openPaDetail(r.code, p, e.currentTarget); } })]);
        })));
    })));
    paNote(last4);
  }

  // Position tabs: "All" (every position's points) or one position's full table.
  function renderPaPos() {
    var box = clear($('paPos')), view = S.paView || 'ALL';
    ['ALL'].concat(PA_POS).forEach(function (p) {
      box.appendChild(h('button', { type: 'button', class: 'pa-pos-b' + (p === view ? ' on' : ''), 'aria-pressed': p === view ? 'true' : 'false',
        text: p === 'ALL' ? 'All' : p, onclick: function () { S.paView = p; renderTools(); } }));
    });
  }
  function paWeeks(t) {
    var wks = Object.keys(t.weeks || {}).map(Number).sort(function (a, b) { return a - b; });
    return S.paLast4 ? wks.slice(-4) : wks;
  }
  // One position: every defense ranked by points allowed per game, with the
  // average stats behind it.
  function renderPaPosition(pos) {
    var last4 = !!S.paLast4, cols = (S.pa.cols || {})[pos] || [];
    $('paSeason').setAttribute('aria-pressed', last4 ? 'false' : 'true'); $('paSeason').classList.toggle('gold', !last4); $('paSeason').classList.toggle('ghost', last4);
    $('paLast4').setAttribute('aria-pressed', last4 ? 'true' : 'false'); $('paLast4').classList.toggle('gold', last4); $('paLast4').classList.toggle('ghost', !last4);
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
    var keep = cols.map(function (c, i) { return rows.some(function (r) { return Math.abs(r.avg[i]) >= 0.05; }); });
    var tbl = clear($('paTable')), n = rows.length;
    tbl.className = 'pa pa-full';
    tbl.appendChild(h('caption', { class: 'sr-only', text: 'Points and average stats allowed per game to ' + PA_WHO[pos] + ' by each NFL defense' }));
    tbl.appendChild(h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', class: 'pa-rank', text: '#' }), h('th', { scope: 'col', text: 'Team' }),
      h('th', { scope: 'col', class: 'pa-ptsh', text: 'Pts', 'aria-sort': 'descending' })]
      .concat(cols.filter(function (c, i) { return keep[i]; }).map(function (c) { return h('th', { scope: 'col', class: 'pa-stat', text: c }); })))]));
    tbl.appendChild(h('tbody', {}, rows.map(function (r, i) {
      var tier = Math.min(4, Math.floor(i / n * 5));
      return h('tr', {}, [h('td', { class: 'pa-rank', text: String(i + 1) }),
        h('th', { scope: 'row' }, [h('button', { type: 'button', class: 'pa-team', onclick: function (e) { openPaDetail(r.code, pos, e.currentTarget); } },
          [h('b', { text: r.code }), h('span', { class: 'pa-name', text: ' ' + (NFL[r.code] || '') })])]),
        h('td', { class: 'pa-pts pa-t' + (4 - tier) }, [h('button', { type: 'button', class: 'pa-cell', text: fmt(r.pts),
          'aria-label': (NFL[r.code] || r.code) + ' allow ' + fmt(r.pts) + ' pts/game to ' + pos + '. Show who scored it.',
          onclick: function (e) { openPaDetail(r.code, pos, e.currentTarget); } })])]
        .concat(r.avg.filter(function (v, i) { return keep[i]; }).map(function (v) { return h('td', { class: 'pa-stat', text: fmt(v) }); })));
    })));
    paNote(last4);
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
  $('detailClose').addEventListener('click', closeDetail);
  $('detail').addEventListener('click', function (e) { if (e.target === $('detail')) closeDetail(); });
  $('detail').addEventListener('keydown', function (e) { trapFocus($('detail'), e); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  if (api.preview) $('previewFlag').hidden = false;
  var m = /^#(qb|rb|wr|te|k|def)$/i.exec(location.hash);
  if (m) S.paView = m[1].toUpperCase();
  renderTools();
})();
