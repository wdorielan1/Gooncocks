/*
 * Player pop-up: tap a player's name anywhere and see his game log - each
 * week's opponent, box-score stats (attempts, yards, TDs...) and fantasy
 * points in our scoring - from nfl/gamelog_<season>.json (built by the
 * Lambda's nfl_points action from nflverse stats). Self-contained so any
 * page can use it:
 *
 *   PlayerCard.source(function () { return promise of the game log JSON });  // optional
 *   PlayerCard.link({name, position, nfl_team, manager}, text?)  // a button that opens it
 *   PlayerCard.open({name, position, nfl_team, manager}, opener)
 *
 * manager: who has him in our league, null for a free agent, undefined if
 * the page doesn't know. Everything is put on the page as text, never HTML.
 */
(function () {
  'use strict';
  var TEAMS = { ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns',
    DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers', HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs',
    LAC: 'Chargers', LAR: 'Rams', LV: 'Raiders', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
    NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks', SF: '49ers', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders' };
  var TEAM_FIX = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
  var POS_FIX = { 'D/ST': 'DEF', DST: 'DEF', PK: 'K' };
  var load = function () {
    var d = new Date(), season = d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
    return fetch('/nfl/gamelog_' + season + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; });
  };
  var CSS = [
    '.pc-link{all:unset;cursor:pointer;color:inherit;font:inherit;font-weight:inherit;text-decoration:underline dotted rgba(246,195,67,.7);text-underline-offset:3px;text-decoration-thickness:1.5px;border-radius:2px}',
    '.pc-link:hover{color:#f6c343}',
    '.pc-link:focus-visible{outline:3px solid #f6c343;outline-offset:2px}',
    'html.pc-lock{overflow:hidden}',
    '.pc-modal{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:16px;background:rgba(2,6,13,.82);font:15px/1.45 "Work Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:#f2f4f9}',
    '.pc-modal[hidden]{display:none!important}',
    '.pc-card{position:relative;width:min(760px,100%);max-height:calc(100% - 16px);overflow-y:auto;background:#0b1629;border:2px solid #f6c343;border-radius:4px;padding:18px 18px 14px;box-shadow:0 18px 50px rgba(0,0,0,.55)}',
    '.pc-x{position:absolute;top:4px;right:6px;width:44px;height:44px;border:0;background:none;color:#cfd6e4;font-size:30px;line-height:1;cursor:pointer}',
    '.pc-x:hover{color:#fff}.pc-x:focus-visible{outline:3px solid #f6c343;outline-offset:-4px}',
    '.pc-head{display:flex;gap:12px;align-items:center;padding-right:40px}',
    '.pc-head h2{margin:0;font:400 28px/1.05 Anton,Impact,"Arial Narrow",sans-serif;letter-spacing:.5px;text-transform:uppercase;color:#fff}',
    '.pc-sub{margin:3px 0 0;font-size:13px;color:#9aa6bd}',
    '.pc-pos{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:3px;font-weight:800;font-size:14px;color:#08111f;background:#9aa6bd}',
    '.pc-qb{background:#ff7a8a}.pc-rb{background:#4fd1a5}.pc-wr{background:#6cb2ff}.pc-te{background:#ffb35c}.pc-k{background:#c9a6ff}.pc-def{background:#b8c2d6}',
    '.pc-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0 12px}',
    '.pc-tile{background:#0f1d36;border:1px solid #2a3d63;border-radius:3px;padding:8px 10px;min-width:0}',
    '.pc-tile b{display:block;font-size:20px;line-height:1.1;color:#f6c343}',
    '.pc-tile span{display:block;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#9aa6bd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pc-wrap{overflow-x:auto;border:1px solid #2a3d63;border-radius:3px}',
    '.pc-wrap:focus-visible{outline:3px solid #f6c343;outline-offset:2px}',
    '.pc-log{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.pc-log th,.pc-log td{padding:7px 8px;text-align:right;border-bottom:1px solid #1d2c4a}',
    '.pc-log thead th{position:sticky;top:0;background:#0e1b33;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9aa6bd}',
    '.pc-log thead tr:first-child th{padding-bottom:0;border-bottom:0;color:#f6c343;text-align:center}',
    '.pc-log .pc-grp:not(:empty){border-bottom:1px solid #2a3d63}',
    '.pc-log .pc-sticky{position:sticky;left:0;z-index:1;background:#0b1629;text-align:center}',
    '.pc-log thead .pc-sticky{z-index:2;background:#0e1b33}',
    '.pc-log .pc-opp{text-align:left;color:#cfd6e4}',
    '.pc-log .pc-gs{border-left:1px solid #2a3d63}',
    '.pc-log td.pc-0{color:#6c7a95}',
    '.pc-log .pc-pts{position:relative;min-width:64px;border-left:1px solid #2a3d63;border-right:1px solid #2a3d63}',
    '.pc-log td.pc-pts b{position:relative;color:#fff}',
    '.pc-bar{position:absolute;left:0;top:6px;bottom:6px;background:rgba(246,195,67,.2);border-radius:0 2px 2px 0}',
    '.pc-log tr.pc-best td.pc-pts b{color:#f6c343}',
    '.pc-log tr.pc-off td,.pc-log tr.pc-off th{color:#6c7a95}',
    '.pc-log .pc-note{text-align:left;font-style:italic}',
    '.pc-log tfoot th,.pc-log tfoot td,.pc-log tfoot .pc-sticky{border-bottom:0;background:#0e1b33;font-weight:700;color:#fff}',
    '.pc-log tfoot .pc-opp{color:#9aa6bd;font-weight:600}',
    '.pc-state{margin:16px 0 4px;color:#cfd6e4}',
    '.pc-fine{margin:10px 0 0;font-size:12px;color:#9aa6bd}',
    '.pc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:560px){.pc-modal{padding:0;place-items:end stretch}.pc-card{width:100%;max-height:92%;border-width:2px 0 0;border-radius:10px 10px 0 0;padding:16px 12px 12px}',
    '.pc-head h2{font-size:24px}.pc-tiles{gap:6px}.pc-tile{padding:6px 7px}.pc-tile b{font-size:17px}.pc-tile span{font-size:9.5px;letter-spacing:.4px}.pc-log{font-size:13px}.pc-log th,.pc-log td{padding:6px 6px}}'
  ].join('\n');
  function style() {
    if (document.getElementById('pcStyle')) return;
    var st = document.createElement('style');
    st.id = 'pcStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  var data, pending = null, idx = null, box = null, lastFocus = null, current = null;

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
  function fmt(n) { return n === null || n === undefined || isNaN(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1); }
  function num(n) { return Math.round(n * 10) / 10 + ''; }
  function team(t) { t = String(t || '').toUpperCase(); return TEAM_FIX[t] || t; }
  function pos(p) { p = String(p || '').split(',')[0].trim().toUpperCase(); return POS_FIX[p] || p; }
  function nameKey(n) {
    return String(n || '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
      .replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  }

  function ensure() {
    if (data !== undefined) return Promise.resolve(data);
    if (!pending) {
      pending = Promise.resolve().then(load).then(function (d) { data = d && d.players ? d : null; }, function () { data = null; })
        .then(function () { pending = null; idx = null; return data; });
    }
    return pending;
  }
  // The player's row in the game log: [key, name, pos, team, {wk: [pts, opp, ...]}],
  // matched by name and position (team breaks ties), the way the Lambda does it.
  function find(p) {
    var ps = pos(p.position), t = team(p.nfl_team);
    if (ps === 'DEF') {
      var d = (data.defenses || {})[t];
      return d ? [t, (TEAMS[t] || t) + ' D/ST', 'DEF', t, d] : null;
    }
    if (!idx) {
      idx = {};
      data.players.forEach(function (r) { (idx[r[0] + '|' + r[2]] = idx[r[0] + '|' + r[2]] || []).push(r); (idx[r[0]] = idx[r[0]] || []).push(r); });
    }
    var k = nameKey(p.name), list = idx[k + '|' + ps] || idx[k] || [];
    return list.filter(function (r) { return r[3] === t; })[0] || list[0] || null;
  }

  function build() {
    if (box) return box;
    style();
    box = h('div', { class: 'pc-modal', id: 'playerCard', hidden: true, onclick: function (e) { if (e.target === box) close(); } }, [
      h('div', { class: 'pc-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pcName' }, [
        h('button', { type: 'button', class: 'pc-x', 'aria-label': 'Close', text: '×', onclick: close }),
        h('div', { class: 'pc-body', id: 'pcBody' })])]);
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(box.querySelectorAll('button,a[href],[tabindex]:not([tabindex="-1"])'), function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    document.body.appendChild(box);
    return box;
  }
  function close() {
    if (!box || box.hidden) return;
    box.hidden = true;
    current = null;
    document.documentElement.classList.remove('pc-lock');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function head(p, row) {
    var ps = pos(p.position), t = team((row && row[3]) || p.nfl_team);
    var who = p.manager === undefined ? null : p.manager ? 'On ' + p.manager + '’s team' : 'Free agent';
    return h('div', { class: 'pc-head' }, [
      h('span', { class: 'pc-pos pc-' + ps.toLowerCase(), text: ps }),
      h('div', {}, [h('h2', { id: 'pcName', text: ps === 'DEF' ? (TEAMS[t] || t) + ' D/ST' : p.name }),
        h('p', { class: 'pc-sub', text: [ps !== 'DEF' && TEAMS[t] ? TEAMS[t] + ' (' + t + ')' : t, who].filter(Boolean).join(' · ') })])]);
  }
  function render(p) {
    var body = document.getElementById('pcBody');
    while (body.firstChild) body.removeChild(body.firstChild);
    if (data === undefined) { body.appendChild(head(p, null)); body.appendChild(h('p', { class: 'pc-state', text: 'Loading his games…' })); return; }
    var row = data && find(p);
    body.appendChild(head(p, row));
    if (!data) { body.appendChild(h('p', { class: 'pc-state', text: 'Game logs can’t be loaded right now. Try again in a minute.' })); return; }
    if (!row) { body.appendChild(h('p', { class: 'pc-state', text: 'No game log yet: he hasn’t played an NFL snap this season, or his stats haven’t posted.' })); return; }
    var ps = row[2], weeks = row[4], cols = (data.cols || {})[ps] || [], t = row[3];
    var last = Math.max.apply(null, (data.weeks || []).concat(Object.keys(weeks).map(Number)));
    var sched = (data.schedule || {})[t] || {}, home = (data.home || {})[t] || [];
    var played = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
    var pts = played.map(function (w) { return weeks[w][0]; });
    var sum = pts.reduce(function (a, b) { return a + b; }, 0), l4 = pts.slice(-4);
    var best = played.reduce(function (b, w) { return b === null || weeks[w][0] > weeks[b][0] ? w : b; }, null);
    var avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
    body.appendChild(h('div', { class: 'pc-tiles' }, [
      tile(fmt(avg(pts)), 'Pts / game'), tile(fmt(avg(l4)), 'Last 4'), tile(fmt(sum), 'Total'),
      tile(best ? fmt(weeks[best][0]) : '—', best ? 'Best · Wk ' + best : 'Best week')]));

    // group header row, then column labels
    var groups = [], gtr = [h('th', { colspan: '2', class: 'pc-sticky' }), h('th', { class: 'pc-grp' })];
    cols.forEach(function (c) {
      if (groups.length && groups[groups.length - 1][0] === c[0]) groups[groups.length - 1][1]++;
      else groups.push([c[0], 1]);
    });
    groups.forEach(function (g) { gtr.push(h('th', { colspan: String(g[1]), class: 'pc-grp', scope: 'colgroup', text: g[0] })); });
    var ltr = [h('th', { scope: 'col', class: 'pc-sticky pc-wk', text: 'Wk' }), h('th', { scope: 'col', class: 'pc-opp', text: 'Opp' }),
      h('th', { scope: 'col', class: 'pc-pts', text: 'Pts' })]
      .concat(cols.map(function (c, i) { return h('th', { scope: 'col', class: i && cols[i - 1][0] !== c[0] ? 'pc-gs' : null, text: c[1] }); }));
    var top = Math.max.apply(null, pts.concat([1]));
    var rows = [], totals = cols.map(function () { return 0; });
    var maxIdx = cols.map(function (c) { return c[1] === 'Long'; });
    for (var w = 1; w <= last; w++) {
      var g = weeks[w], opp = sched[w] || (g && g[1]);
      var where = opp ? (home.indexOf(w) >= 0 ? 'vs ' : '@ ') + team(opp) : 'BYE';
      if (!g) {
        rows.push(h('tr', { class: 'pc-off' }, [h('th', { scope: 'row', class: 'pc-sticky pc-wk', text: String(w) }), h('td', { class: 'pc-opp', text: where }),
          h('td', { colspan: String(cols.length + 1), class: 'pc-note', text: opp ? 'Did not play' : 'Bye week' })]));
        continue;
      }
      var vals = g.slice(2);
      vals.forEach(function (v, i) { totals[i] = maxIdx[i] ? Math.max(totals[i], v) : totals[i] + v; });
      rows.push(h('tr', { class: w === best ? 'pc-best' : null }, [h('th', { scope: 'row', class: 'pc-sticky pc-wk', text: String(w) }),
        h('td', { class: 'pc-opp', text: where }),
        h('td', { class: 'pc-pts' }, [h('span', { class: 'pc-bar', style: 'width:' + Math.max(0, Math.round(g[0] / top * 100)) + '%' }), h('b', { text: fmt(g[0]) })])]
        .concat(vals.map(function (v, i) { return h('td', { class: (i && cols[i - 1][0] !== cols[i][0] ? 'pc-gs' : '') + (v ? '' : ' pc-0'), text: num(v) }); }))));
    }
    var foot = h('tr', { class: 'pc-tot' }, [h('th', { scope: 'row', class: 'pc-sticky pc-wk', text: 'Tot' }), h('td', { class: 'pc-opp', text: played.length + (played.length === 1 ? ' game' : ' games') }),
      h('td', { class: 'pc-pts' }, [h('b', { text: fmt(sum) })])]
      .concat(totals.map(function (v, i) { return h('td', { class: i && cols[i - 1][0] !== cols[i][0] ? 'pc-gs' : null, text: num(v) }); })));
    body.appendChild(h('div', { class: 'pc-wrap', tabindex: '0', role: 'region', 'aria-label': 'Game log' }, [
      h('table', { class: 'pc-log' }, [h('caption', { class: 'pc-sr', text: (ps === 'DEF' ? row[1] : p.name) + ' game log, ' + (data.season || '') }),
        h('thead', {}, [h('tr', {}, gtr), h('tr', {}, ltr)]), h('tbody', {}, rows), h('tfoot', {}, [foot])])]));
    body.appendChild(h('p', { class: 'pc-fine', text: 'Pts are fantasy points in our league’s scoring. Stats: nflverse' +
      (data.weeks && data.weeks.length ? ', through week ' + data.weeks[data.weeks.length - 1] : '') + '. This week’s games show up Tuesday.' }));
  }
  function tile(v, label) { return h('div', { class: 'pc-tile' }, [h('b', { text: v }), h('span', { text: label })]); }

  function open(p, opener) {
    build();
    lastFocus = opener || document.activeElement;
    current = p;
    render(p);
    box.hidden = false;
    document.documentElement.classList.add('pc-lock');
    box.querySelector('.pc-x').focus();
    box.querySelector('.pc-card').scrollTop = 0;
    if (data === undefined) ensure().then(function () { if (current === p) render(p); });
  }
  function link(p, text, cls) {
    style();
    var b = h('button', { type: 'button', class: 'pc-link' + (cls ? ' ' + cls : ''), text: text === undefined ? p.name : text,
      title: 'Game log', onclick: function (e) { e.preventDefault(); e.stopPropagation(); open(p, b); } });
    return b;
  }

  window.PlayerCard = {
    source: function (fn) { load = fn; data = undefined; idx = null; },
    open: open, link: link, close: close,
    _find: function (p) { return ensure().then(function () { return data && find(p); }); }
  };
})();
