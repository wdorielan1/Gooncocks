/*
 * Box scores for any Gooncocks game: both lineups, player by player.
 *
 * The Lambda publishes one file per season, boxscores/<season>.json:
 *   { "season": 2023, "games": { "<game id>": { "a": lineup, "b": lineup } } }
 * where a lineup is [[slot, name, position, NFL team, points], ...] in
 * Yahoo's lineup order, and "a" is the history file's managerA. A season's
 * file is only downloaded the first time someone opens one of its games.
 *
 *   BoxScore.open(game)      - a pop-up with the score and both lineups
 *   BoxScore.fill(el, game)  - just the lineups, into an existing element
 *
 * game = { id?, season, week, label?, a: { id, name, team?, score? }, b: {...} }
 * Games are found by id, or by season + week + the two manager ids.
 */
(function () {
  var files = {};
  var ID = /^\d+-w(\d+)-([^-]+)-([^-]+)$/;
  var RESERVE = { IR: 1, 'IR+': 1, NA: 1, COVID: 1 };
  var lastFocus = null;

  function base() { return window.GOONCOCKS_BOXSCORE_BASE || '/boxscores/'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pts(n) { return typeof n === 'number' ? n.toFixed(2) : '–'; }
  function short(name) {
    var parts = String(name || '').split(' ');
    return parts.length > 1 && parts[0].length > 2 ? parts[0].charAt(0) + '. ' + parts.slice(1).join(' ') : name;
  }

  function load(season) {
    if (!files[season]) {
      files[season] = fetch(base() + season + '.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (f) {
          // Index by week + the two managers too, for pages that don't know game ids.
          f.byPair = {};
          Object.keys(f.games || {}).forEach(function (id) {
            var m = ID.exec(id);
            if (m) f.byPair[Number(m[1]) + '|' + [m[2], m[3]].sort().join('|')] = id;
          });
          return f;
        });
      files[season].catch(function () { delete files[season]; });
    }
    return files[season];
  }
  // The file's "a" lineup belongs to the first manager in the game id;
  // flip it when the page shows that manager on the right.
  function find(f, game) {
    var id = game.id && f.games[game.id] ? game.id : f.byPair[Number(game.week) + '|' + [game.a.id, game.b.id].sort().join('|')];
    if (!id) return null;
    var box = f.games[id], m = ID.exec(id);
    return !m || m[2] === game.a.id ? box : { a: box.b, b: box.a };
  }

  // Starters line up slot by slot (QB beside QB); bench and reserve follow.
  function pairUp(a, b) {
    function split(list) {
      var s = [], bench = [];
      (list || []).forEach(function (p) { (p[0] === 'BN' || RESERVE[p[0]] ? bench : s).push(p); });
      return [s, bench];
    }
    var A = split(a), B = split(b), used = [], starters = [];
    A[0].forEach(function (p) {
      var j = -1;
      for (var i = 0; i < B[0].length; i++) if (!used[i] && B[0][i][0] === p[0]) { j = i; break; }
      if (j >= 0) used[j] = true;
      starters.push([p, j >= 0 ? B[0][j] : null, p[0]]);
    });
    B[0].forEach(function (p, i) { if (!used[i]) starters.push([null, p, p[0]]); });
    var bench = [];
    for (var k = 0; k < Math.max(A[1].length, B[1].length); k++) {
      var pa = A[1][k] || null, pb = B[1][k] || null;
      bench.push([pa, pb, pa && pb && pa[0] !== pb[0] ? pa[0] + '/' + pb[0] : (pa || pb)[0]]);
    }
    return { starters: starters, bench: bench, totals: [A, B].map(function (x) {
      return x.map(function (list) { return list.reduce(function (t, p) { return t + (typeof p[4] === 'number' ? p[4] : 0); }, 0); });
    }) };
  }
  // A player's two cells: name then points for the left team, mirrored for the right.
  function cells(p, side, best) {
    var name, num;
    if (!p) {
      name = '<td class="bx-p ' + side + ' bx-none">—</td>';
      num = '<td class="bx-n ' + side + '"></td>';
    } else {
      var sub = [p[2], p[3]].filter(Boolean).join(' · ');
      name = '<td class="bx-p ' + side + '"><span class="bx-fn">' + esc(p[1]) + '</span><span class="bx-sn">' + esc(short(p[1])) + '</span>' +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + '</td>';
      num = '<td class="bx-n ' + side + (best ? ' bx-best' : '') + '">' + pts(p[4]) + '</td>';
    }
    return side === 'a' ? name + num : num + name;
  }
  function rows(list, cls) {
    return list.map(function (r) {
      var va = r[0] && typeof r[0][4] === 'number' ? r[0][4] : null, vb = r[1] && typeof r[1][4] === 'number' ? r[1][4] : null;
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cells(r[0], 'a', va != null && (vb == null || va > vb)) +
        '<td class="bx-s">' + esc(r[2]) + '</td>' + cells(r[1], 'b', vb != null && (va == null || vb > va)) + '</tr>';
    }).join('');
  }
  function lineupHTML(box, game) {
    var L = pairUp(box.a, box.b), t = L.totals;
    var html = '<table class="bx-t"><colgroup><col><col class="bx-cn"><col class="bx-cs"><col class="bx-cn"><col></colgroup><caption class="bx-sr">Lineups: ' + esc(game.a.name) + ' and ' + esc(game.b.name) + '</caption>' +
      '<thead><tr><th colspan="2" class="a">' + esc(game.a.name) + '</th><th class="bx-s">Pos</th><th colspan="2" class="b">' + esc(game.b.name) + '</th></tr></thead><tbody>' +
      rows(L.starters, '') +
      '<tr class="bx-tot"><td class="a">Starters</td><td class="bx-n a">' + pts(t[0][0]) + '</td><td class="bx-s"></td><td class="bx-n b">' + pts(t[1][0]) + '</td><td class="b">Starters</td></tr>';
    if (L.bench.length) {
      html += '<tr class="bx-sub"><td colspan="5">Bench</td></tr>' + rows(L.bench, 'bx-bn') +
        '<tr class="bx-tot"><td class="a">Bench</td><td class="bx-n a">' + pts(t[0][1]) + '</td><td class="bx-s"></td><td class="bx-n b">' + pts(t[1][1]) + '</td><td class="b">Bench</td></tr>';
    }
    html += '</tbody></table>';
    var off = [game.a, game.b].filter(function (s, i) { return typeof s.score === 'number' && Math.abs(s.score - t[i][0]) > 0.05; })
      .map(function (s) { var i = s === game.a ? 0 : 1; return esc(s.name) + '’s starters add up to ' + pts(t[i][0]) + ' (final: ' + pts(s.score) + ')'; });
    if (off.length) html += '<p class="bx-note">' + off.join('; ') + '. Yahoo changed some points after the game went final, and the lineups show its current numbers.</p>';
    return html;
  }

  function fill(el, game) {
    css();
    el.innerHTML = '<p class="bx-msg">Loading lineups…</p>';
    return load(game.season).then(function (f) {
      var box = find(f, game);
      el.innerHTML = box ? lineupHTML(box, game)
        : '<p class="bx-msg">Yahoo doesn’t have the lineups for this game yet' + (Number(game.season) < 2018 ? ' (older seasons can be missing them)' : '') + '.</p>';
    }, function () {
      el.innerHTML = '<p class="bx-msg">' + (location.protocol === 'file:' ? 'Lineups load on the live site.' : 'Lineups for ' + esc(game.season) + ' aren’t available yet.') + '</p>';
    });
  }

  // ---------- the pop-up ----------
  function modal() {
    var m = document.getElementById('bxModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'bxModal';
    m.className = 'bx-modal';
    m.hidden = true;
    m.innerHTML = '<div class="bx-card" role="dialog" aria-modal="true" aria-labelledby="bxTitle"><button type="button" class="bx-x" aria-label="Close">&times;</button><div class="bx-body"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('.bx-x')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) { e.stopPropagation(); close(); } }, true);
    return m;
  }
  function close() {
    var m = document.getElementById('bxModal');
    if (!m || m.hidden) return;
    m.hidden = true;
    document.documentElement.classList.remove('bx-lock');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  function side(s, won) {
    return '<div class="bx-side' + (won ? ' won' : '') + '"><div><b class="bx-nm">' + esc(s.name) + '</b>' + (s.team ? '<small>' + esc(s.team) + '</small>' : '') + '</div>' +
      (typeof s.score === 'number' ? '<span class="bx-sc">' + pts(s.score) + '</span>' : '') + '</div>';
  }
  function open(game) {
    css();
    lastFocus = document.activeElement;
    var m = modal(), a = game.a, b = game.b;
    var aWon = typeof a.score === 'number' && typeof b.score === 'number' && a.score > b.score;
    var bWon = typeof a.score === 'number' && typeof b.score === 'number' && b.score > a.score;
    var first = bWon ? b : a, second = bWon ? a : b;
    var title = typeof a.score === 'number' && a.score === b.score ? esc(a.name) + ' ties ' + esc(b.name) : esc(first.name) + ' over ' + esc(second.name);
    m.querySelector('.bx-body').innerHTML = '<p class="bx-kick">' + esc(game.season + ' · ' + (game.label || 'Week ' + game.week)) + '</p>' +
      '<h2 class="bx-title" id="bxTitle">' + title + '</h2>' +
      '<div class="bx-score">' + side(first, aWon || bWon) + side(second, false) + '</div>' +
      (typeof a.score === 'number' ? '<p class="bx-margin">' + (a.score === b.score ? 'Dead even' : 'Won by ' + pts(Math.abs(a.score - b.score))) + '</p>' : '') +
      '<div class="bx-lineups"></div>';
    m.hidden = false;
    document.documentElement.classList.add('bx-lock');
    m.querySelector('.bx-x').focus();
    return fill(m.querySelector('.bx-lineups'), { id: game.id, season: game.season, week: game.week, a: first, b: second });
  }

  // ---------- styles (injected once, so any page can use this file) ----------
  var styled = false;
  function css() {
    if (styled) return;
    styled = true;
    var s = document.createElement('style');
    s.textContent = [
      '.bx-lock{overflow:hidden}',
      '.bx-modal{position:fixed;inset:0;z-index:80;background:#02060dd9;display:grid;place-items:center;padding:14px}',
      '.bx-modal[hidden]{display:none!important}',
      '.bx-card{position:relative;width:min(680px,100%);max-height:calc(100% - 16px);overflow-y:auto;background:#0a1528;color:#f3f5fa;border:2px solid #f6c343;border-radius:4px;padding:20px;box-shadow:0 30px 80px #000c;font-family:"Work Sans",system-ui,sans-serif}',
      '.bx-x{position:absolute;top:8px;right:10px;width:38px;height:38px;border:0;background:none;color:#cfd6e6;font-size:30px;line-height:1;cursor:pointer}',
      '.bx-x:hover{color:#f6c343}',
      '.bx-kick{margin:0;font:700 13px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:2.4px;text-transform:uppercase;color:#f6c343}',
      '.bx-title{margin:8px 40px 14px 0;font:400 clamp(22px,4vw,32px)/1.05 "Alfa Slab One",Rockwell,Georgia,serif;text-transform:uppercase}',
      '.bx-score{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.bx-side{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid #2b4478;border-radius:3px;background:#0c1831;min-width:0}',
      '.bx-side.won{border-color:#f6c343}',
      '.bx-side>div{min-width:0}',
      '.bx-nm{display:block;font:400 19px/1.05 "Alfa Slab One",Rockwell,Georgia,serif;text-transform:uppercase;overflow-wrap:anywhere}',
      '.bx-side small{display:block;font-size:12px;color:#98a6c2;margin-top:3px}',
      '.bx-sc{font:400 30px/1 Anton,Impact,sans-serif;letter-spacing:.5px}',
      '.bx-side.won .bx-sc{color:#f6c343}',
      '.bx-margin{margin:8px 0 0;text-align:center;font:700 14px/1.2 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#cfd6e6}',
      '.bx-lineups{margin-top:14px}',
      '.bx-msg{margin:0;padding:18px 12px;text-align:center;color:#98a6c2;font-size:14px;border:1px dashed #2b4478;border-radius:3px}',
      '.bx-t{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13.5px}',
      '.bx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
      '.bx-t th{padding:8px 6px;font:700 12px/1.1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:#98a6c2;border-bottom:1px solid #2b4478;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bx-t th.a,.bx-t td.a{text-align:left}.bx-t th.b,.bx-t td.b{text-align:right}',
      '.bx-t td{padding:6px;border-bottom:1px solid #ffffff0f;vertical-align:middle}',
      '.bx-p{overflow:hidden}',
      '.bx-p .bx-fn,.bx-p .bx-sn{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}',
      '.bx-p .bx-sn{display:none}',
      '.bx-p small{display:block;font-size:11px;color:#98a6c2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.bx-none{color:#6c7d9f}',
      '.bx-cn{width:58px}.bx-cs{width:44px}',
      '.bx-t th.bx-s{padding:8px 0;text-align:center}',
      '.bx-n{font:400 17px/1 Anton,Impact,sans-serif;letter-spacing:.3px;font-variant-numeric:tabular-nums}',
      '.bx-n.a{text-align:right}.bx-n.b{text-align:left}',
      '.bx-best{color:#f6c343}',
      '.bx-s{text-align:center;font:700 11px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:1px;color:#9fbaff;background:#1f5bd81a}',
      '.bx-tot td{font:700 13px/1.1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#dfe5f2;border-bottom:1px solid #2b4478;background:#ffffff08}',
      '.bx-tot .bx-n{font:400 18px/1 Anton,Impact,sans-serif;color:#fff}',
      '.bx-sub td{padding:12px 6px 6px;font:700 12px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:2.4px;text-transform:uppercase;color:#f6c343}',
      '.bx-bn td{color:#b6c0d6}.bx-bn .bx-best{color:#e9d08a}',
      '.bx-note{margin:10px 0 0;font-size:12px;color:#98a6c2}',
      '[data-box]{cursor:pointer}',
      '@media (max-width:560px){.bx-card{padding:16px 12px}.bx-t{font-size:12.5px}.bx-p .bx-fn{display:none}.bx-p .bx-sn{display:block}.bx-cn{width:46px}.bx-cs{width:32px}.bx-n{font-size:15px}.bx-t td{padding:6px 4px}.bx-sc{font-size:24px}.bx-nm{font-size:16px}}',
      '@media (max-width:380px){.bx-score{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  window.BoxScore = { open: open, fill: fill, load: load, lineupHTML: lineupHTML, close: close };
})();
