/*
 * Record Room UI. Loads the history through RecordData, gets every number
 * from Records (records.js), and renders the featured cards, the record
 * book, the spotlight, the challengers, the records nobody wants and the
 * champions' banners from one state.
 * Filters are remembered in this browser (localStorage); the open record
 * (and any non-default filters) is kept in the address, e.g.
 * #high-week or #big-margin?season=2023&type=playoff&std=1.
 */
(function () {
  var STORE_KEY = 'gooncocks-record-room';
  var TYPES = ['regular', 'playoff', 'both'];
  var CATS = ['all', 'scoring', 'wins', 'streaks', 'hardware'];
  var FEATURED = [['high-week', 'gold'], ['big-margin', 'blue'], ['close-win', 'red']];
  var UNWANTED = ['cock-total', 'low-week', 'lose-streak'];
  var $ = function (id) { return document.getElementById(id); };
  var data, ctx, byId, gameById;
  var state = { season: 'all', type: 'regular', cat: 'all', search: '', selected: 'high-week', showAll: false, standard: false, focus: null };
  var results = {};
  var lastOpener = null;

  var ICONS = {
    'high-week': '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.9 2.4-5 .2 1.6 1 2.6 2 3 0-3 .1-5.4.6-8z"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.6 1.4-2.5 2.5-4 1.1 1.5 2.5 2.4 2.5 4A2.5 2.5 0 0 1 12 21z"/>',
    'big-margin': '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    'close-win': '<circle cx="12" cy="13" r="7.5"/><path d="M12 13V9M10 2.5h4M18.5 6.5l1.5-1.5"/>',
    'cock-total': '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M9.5 7.5l5 3M14.5 7.5l-5 3"/>',
    'low-week': '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    'lose-streak': '<path d="M9 15l-2 2a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0"/><path d="M15 9l2-2a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0"/><path d="M8 3v3M3 8h3M16 21v-3M21 16h-3"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>'
  };
  var CAPTIONS = {
    'cock-total': function (e) { return e.value + ' weeks at the very bottom. The league remembers every one.'; },
    'low-week': function (e) { return 'Put up ' + e.mark + ' against ' + name(e.side.opp) + '. The bench would have done better.'; },
    'lose-streak': function (e) { return e.value + ' losses in a row' + (e.ongoing ? ', and still counting.' : '. Thoughts and prayers.'); }
  };

  // ---------- formatting ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function svg(key, cls) { return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[key] + '</svg>'; }
  function name(id) { return byId[id] ? byId[id].name : id; }
  function photoFor(id) {
    return data.photoBaseUrl && byId[id] && byId[id].active
      ? '<img src="' + esc(data.photoBaseUrl + id + '.jpg') + '" alt="" loading="lazy" onerror="this.remove()">' : '';
  }
  function avatar(id, cls) {
    var former = byId[id] && !byId[id].active ? ' former' : '';
    return '<span class="av ' + (cls || '') + former + '" aria-hidden="true">' + esc(name(id).charAt(0).toUpperCase()) + photoFor(id) + '</span>';
  }
  function uniq(list) { var o = []; list.forEach(function (x) { if (o.indexOf(x) < 0) o.push(x); }); return o; }
  function entryNames(e) { return e.holders.map(name).join(' & '); }
  function holderIds(res) { var ids = []; res.holders.forEach(function (e) { ids = ids.concat(e.holders); }); return uniq(ids); }
  function joinNames(ids) {
    var n = ids.map(name);
    return n.length < 3 ? n.join(' & ') : n.slice(0, -1).join(', ') + ' & ' + n[n.length - 1];
  }
  function ranges(years) {
    var out = [], i = 0;
    while (i < years.length) {
      var j = i;
      while (j + 1 < years.length && years[j + 1] === years[j] + 1) j++;
      out.push(j === i ? String(years[i]) : years[i] + '–' + years[j]);
      i = j + 1;
    }
    return out.join(', ');
  }
  function bigMark(e) { return e.pctValue != null ? Records.pctText(e.pctValue) : e.mark; }
  // "When" for a row. Career totals list their seasons instead of "Career".
  function whenText(e) {
    if (e.kind === 'total') {
      var ys = uniq(e.events.map(function (x) { return x.season; }));
      return ys.length <= 3 ? ys.join(', ') : ys[0] + '–' + ys[ys.length - 1] + ' · ' + ys.length + ' seasons';
    }
    return e.when;
  }
  // Scoring eras only matter to records measured in points.
  function pointsRecord(rec) { return rec.cat === 'scoring' || rec.id === 'big-margin' || rec.id === 'close-win'; }
  function eraBadge(e, rec) {
    return pointsRecord(rec) && e.season && e.kind !== 'total' && Records.highSeason(ctx, e.season) ? '<span class="era" title="High-scoring season">' + e.season + ' scoring</span>' : '';
  }
  function filters() { return { season: state.season, type: state.type, standard: state.standard }; }
  function result(id) { return results[id] || (results[id] = Records.compute(data, id, filters())); }
  function rankOf(res, i) {
    var v = res.entries[i].value, first = i;
    while (first > 0 && Math.abs(res.entries[first - 1].value - v) < 5e-4) first--;
    var tied = first < i || (i + 1 < res.entries.length && Math.abs(res.entries[i + 1].value - v) < 5e-4);
    return (tied ? 'T' : '') + (first + 1);
  }

  // Why a record has nothing to show for these filters.
  function emptyText(rec) {
    var f = filters(), s = f.season;
    if ((rec.id === 'titles' || rec.id === 'consec-titles') && !Object.keys(data.standings || {}).length) return 'Unavailable: the history file has no final standings.';
    if (s !== 'all' && !ctx.finished(s) && ['season-points', 'season-avg', 'season-pct', 'titles'].indexOf(rec.id) >= 0) {
      return s + ' is still in progress, and this record counts completed seasons only.';
    }
    if (s !== 'all' && f.standard && Records.highSeason(ctx, s) && rec.applies.type) return s + ' was a high-scoring season, so “Standard scoring only” leaves it out.';
    if (f.type === 'playoff' && rec.applies.type) return s === 'all' ? 'No completed playoff games yet.' : 'No completed playoff games in ' + s + '.';
    return 'No qualifying games for these filters.';
  }

  // ---------- persistence + address ----------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ season: state.season, type: state.type, cat: state.cat, selected: state.selected, showAll: state.showAll, standard: state.standard }));
    } catch (e) { /* storage blocked */ }
  }
  function validSeason(v) { return v === 'all' || ctx.seasons.indexOf(Number(v)) >= 0; }
  function applySaved(o) {
    if (!o || typeof o !== 'object') return;
    if (o.season != null && validSeason(o.season)) state.season = o.season === 'all' ? 'all' : Number(o.season);
    if (TYPES.indexOf(o.type) >= 0) state.type = o.type;
    if (CATS.indexOf(o.cat) >= 0) state.cat = o.cat;
    if (Records.byId[o.selected]) state.selected = o.selected;
    if (typeof o.showAll === 'boolean') state.showAll = o.showAll;
    if (typeof o.standard === 'boolean') state.standard = o.standard;
  }
  function readHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h) return null;
    var parts = h.split('?'), o = {};
    if (!Records.byId[parts[0]]) return null;
    o.selected = parts[0];
    o.season = 'all'; o.type = 'regular'; o.standard = false;
    (parts[1] || '').split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0] === 'season') o.season = p[1];
      if (p[0] === 'type') o.type = p[1];
      if (p[0] === 'std') o.standard = p[1] === '1';
    });
    return o;
  }
  function hashFor() {
    var q = [];
    if (state.season !== 'all') q.push('season=' + state.season);
    if (state.type !== 'regular') q.push('type=' + state.type);
    if (state.standard) q.push('std=1');
    return '#' + state.selected + (q.length ? '?' + q.join('&') : '');
  }
  function writeHash() {
    var h = hashFor();
    if (location.hash !== h) {
      try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
    }
  }

  // ---------- header, hero ----------
  function renderStatic() {
    var years = ctx.seasons, lo = years[0], hi = years[years.length - 1];
    var missing = [];
    for (var y = lo; y <= hi; y++) if (years.indexOf(y) < 0) missing.push(y);
    var span = lo === hi ? String(lo) : lo + '–' + hi;
    $('sourceBadge').textContent = data.source === 'yahoo' ? 'Yahoo league history · ' + span : 'Demo data · not from Yahoo';
    var lastWeek = 0;
    ctx.finals.forEach(function (g) { if (g.season === hi && g.gameType === 'regular') lastWeek = Math.max(lastWeek, g.week); });
    $('seasonTag').textContent = hi + ' season' + (!ctx.finished(hi) && lastWeek ? ' · Week ' + lastWeek : '');
    $('coverage').innerHTML = 'Seasons ' + esc(ranges(years)) +
      '<small>' + (missing.length ? esc(ranges(missing)) + (missing.length > 1 ? ' aren’t' : ' isn’t') + ' in the Yahoo history. ' : '') + 'Records are among available seasons.</small>';
    var sel = $('seasonSel');
    sel.innerHTML = '<option value="all">All seasons</option>' + years.slice().reverse().map(function (s) {
      return '<option value="' + s + '">' + s + (ctx.finished(s) ? '' : ' (in progress)') + '</option>';
    }).join('');
    var high = Object.keys(ctx.eras).filter(function (s) { return ctx.eras[s].high; });
    $('footNote').textContent = (data.source === 'yahoo' ? 'Every record is calculated from the league’s Yahoo history (' + span + '). ' : 'Demo data, not real league results. ') +
      'Only completed games count; consolation games never do. Championships come from each finished season’s final standings. ' +
      'Goon and Cock of the Week are the top and bottom regular-season scores of each completed week; ' + Records.ISSUED_FROM +
      ' is the first season they were actually awarded, so earlier ones are rebuilt from the scores. ' +
      (high.length ? high.join(' and ') + ' averaged about ' + Math.round(Math.min.apply(null, high.map(function (s) { return ctx.eras[s].avg; }))) +
        '+ points per team-week versus a typical ' + Math.round(ctx.medianAvg) + ', so they’re marked as high-scoring seasons; “Standard scoring only” leaves them out of game records.' : '');
  }

  // ---------- featured cards ----------
  function renderFeatured() {
    $('featured').innerHTML = FEATURED.map(function (fc) {
      var rec = Records.byId[fc[0]], res = result(fc[0]), e = res.holders[0];
      var title = esc(rec.short || rec.name);
      if (!e) {
        return '<article class="feat ' + fc[1] + '"><button type="button" class="feat-body" data-rec="' + rec.id + '">' + svg(rec.id, 'feat-ico') +
          '<h3>' + title + '</h3><span class="val">—</span><span class="none">' + esc(emptyText(rec)) + '</span></button></article>';
      }
      var s = e.side, more = res.holders.length > 1 ? ' · tied ×' + res.holders.length : '';
      return '<article class="feat ' + fc[1] + (state.selected === rec.id ? ' sel' : '') + '">' +
        '<button type="button" class="feat-body" data-rec="' + rec.id + '" aria-label="' + esc(rec.name + ': ' + e.mark + ', ' + name(s.id) + ', ' + e.when) + '">' +
        svg(rec.id, 'feat-ico') + '<h3>' + title + '</h3>' +
        '<span class="val">' + esc(e.mark) + '</span>' +
        '<span class="who">' + avatar(s.id, fc[1] === 'gold' ? 'gold' : fc[1] === 'red' ? 'red' : '') +
        '<span class="who-t">' + esc(name(s.id)) + ' ' + (s.result === 'W' ? 'over' : 'vs') + ' ' + esc(name(s.opp)) +
        '<small>' + esc(e.when + more) + eraBadge(e, rec) + '</small></span></span></button>' +
        '<button type="button" class="foot" data-game="' + esc(e.game.id) + '">View the matchup <span class="chev" aria-hidden="true"></span></button></article>';
    }).join('');
  }

  // ---------- record book ----------
  function visibleRecords() {
    var q = state.search.trim().toLowerCase();
    var list = Records.list.filter(function (r) { return state.cat === 'all' || r.cat === state.cat; });
    if (q) {
      return list.filter(function (r) {
        if ((r.name + ' ' + (r.short || '') + ' ' + r.cat).toLowerCase().indexOf(q) >= 0) return true;
        return holderIds(result(r.id)).some(function (id) { return name(id).toLowerCase().indexOf(q) >= 0; });
      });
    }
    return list;
  }
  function renderBook() {
    var all = visibleRecords(), q = state.search.trim();
    var collapsible = state.cat === 'all' && !q;
    var shown = collapsible && !state.showAll ? all.filter(function (r) { return r.core; }) : all;
    var rows = shown.map(function (r) {
      var res = result(r.id), e = res.holders[0], ids = holderIds(res);
      var cells;
      if (!e) {
        cells = '<td colspan="3"><span class="none">' + esc(emptyText(r)) + '</span></td>';
      } else {
        var who = ids.slice(0, 3).map(function (id) { return avatar(id, r.unwanted ? 'red' : ''); }).join('') +
          '<span>' + esc(e.pair && res.holders.length === 1 ? entryNames(e) : joinNames(ids.slice(0, 3)) + (ids.length > 3 ? ' +' + (ids.length - 3) : '')) + '</span>';
        var w = res.holders.length > 1 && r.total ? 'Tied · ' + res.holders.length + ' managers'
          : res.holders.length > 1 ? whenText(e) + ' · tied ×' + res.holders.length : whenText(e);
        cells = '<td><span class="holders">' + who + '</span></td>' +
          '<td><span class="mark' + (r.unwanted ? ' bad' : '') + '">' + esc(e.mark) + '</span></td>' +
          '<td><span class="when">' + esc(w) + '</span>' + eraBadge(e, r) + '</td>';
      }
      return '<tr data-rec="' + r.id + '" tabindex="0"' + (state.selected === r.id ? ' class="sel" aria-selected="true"' : ' aria-selected="false"') + '>' +
        '<td><span class="rname">' + esc(r.name) + '<small>' + (r.unwanted ? 'Nobody wants this one' : esc(r.cat.charAt(0).toUpperCase() + r.cat.slice(1))) + '</small></span></td>' +
        cells + '<td class="c"><span class="chev" aria-hidden="true"></span></td></tr>';
    });
    if (!rows.length) rows.push('<tr class="empty-row"><td colspan="5">No records match “' + esc(q) + '”.</td></tr>');
    $('recordTable').innerHTML = '<thead><tr><th scope="col">Record</th><th scope="col">Holder</th><th scope="col">Mark</th><th scope="col">When</th><th><span class="sr-only">Open</span></th></tr></thead><tbody>' + rows.join('') + '</tbody>';
    var hidden = all.length - shown.length;
    $('moreBtn').hidden = !collapsible || (!hidden && !state.showAll);
    $('moreBtn').textContent = state.showAll ? 'Show fewer records' : 'Show ' + hidden + ' more record' + (hidden === 1 ? '' : 's');
    $('moreBtn').setAttribute('aria-expanded', String(state.showAll));
    document.querySelectorAll('.cats button').forEach(function (b) {
      var on = b.getAttribute('data-cat') === state.cat;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('catSel').value = state.cat;
    $('bookNote').textContent = 'Showing ' + shown.length + ' of ' + Records.list.length + ' records · ' + scopeShort() + '. Ties are shown, never broken.';
  }
  function scopeShort() {
    return (state.season === 'all' ? 'All seasons' : state.season) + ' · ' +
      (state.type === 'regular' ? 'Regular season' : state.type === 'playoff' ? 'Playoffs' : 'Regular season + playoffs') +
      (state.standard ? ' · Standard scoring only' : '');
  }

  // ---------- spotlight ----------
  function gameLi(g, left, right, res) {
    return '<li><button type="button" class="lk" data-game="' + esc(g.id) + '"><span>' + left + '</span><span>' + right +
      (res ? ' <span class="res ' + res + '">' + res + '</span>' : '') + '</span></button></li>';
  }
  function stats(pairs) {
    return '<dl class="stats">' + pairs.map(function (p) { return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>'; }).join('') + '</dl>';
  }
  function detailFor(rec, e) {
    var html = '';
    if (e.kind === 'game') {
      var g = e.game, a = Records.side(g, e.pair ? g.managerA : e.side.id), b = Records.side(g, a.opp);
      html += '<div class="board">' + [a, b].map(function (s) {
        return '<div class="board-row' + (s.result === 'W' ? ' won' : '') + '"><span>' + esc(name(s.id)) + '<small>' + esc(Records.teamOf(ctx, g.season, s.id) || '') + '</small></span><b>' + Records.fmt(s.score) + '</b></div>';
      }).join('') + '</div>';
      var out = a.result === 'T' ? 'Tied game' : (a.result === 'W' ? name(a.id) : name(b.id)) + ' won by ' + Records.fmt(a.margin);
      if (e.pair) out += ' · ' + Records.fmt(g.scoreA + g.scoreB) + ' combined';
      html += '<p class="outcome">' + esc(out) + '</p>';
    } else if (e.kind === 'season') {
      var ln = e.line;
      html += stats([['Games', ln.n], ['Points', Records.fmt(ln.pts)], ['Average', Records.fmt(ln.pts / ln.n)], ['Record', ln.w + '-' + ln.l + (ln.t ? '-' + ln.t : '')]]);
      html += '<ul class="list" aria-label="Games that season">' + ln.games.map(function (x) {
        return gameLi(x.g, esc(Records.gameLabel(x.g) + ' vs ' + name(x.s.opp)), Records.fmt(x.s.score) + '–' + Records.fmt(x.s.oppScore), x.s.result);
      }).join('') + '</ul>';
    } else if (e.kind === 'streak') {
      html += stats([['Length', e.value], ['Started', e.start.season + ' Wk ' + e.start.week], ['Ended', e.ongoing ? 'Still going' : e.end.season + ' Wk ' + e.end.week]]);
      if (e.crossesSeasons) html += '<p class="note">This streak runs across seasons (' + e.start.season + ' → ' + e.end.season + ').</p>';
      html += '<ul class="list" aria-label="Games in the streak">' + e.run.map(function (x) {
        return gameLi(x.g, esc(x.g.season + ' · ' + Records.gameLabel(x.g) + ' vs ' + name(x.s.opp)), Records.fmt(x.s.score) + '–' + Records.fmt(x.s.oppScore), x.s.result);
      }).join('') + '</ul>';
    } else if (e.kind === 'total' && (rec.id === 'titles')) {
      html += '<ul class="list" aria-label="Championships">' + e.events.map(function (x) {
        return '<li><span>' + x.season + ' champion</span><span>' + esc(x.team) + '</span></li>';
      }).join('') + '</ul>';
    } else if (e.kind === 'titlerun') {
      html += '<ul class="list" aria-label="Championships in the run">' + e.events.map(function (x) {
        return '<li><span>' + x.season + ' champion</span><span>' + esc(x.team) + '</span></li>';
      }).join('') + '</ul>';
    } else if (e.kind === 'total' || e.kind === 'awardseason') {
      var issued = e.events.filter(function (x) { return x.issued; }).length;
      var shared = e.events.filter(function (x) { return x.shared; }).length;
      var pairs = [['Awards', e.value], ['Issued', issued], ['Rebuilt', e.value - issued]];
      if (e.kind === 'total') pairs.push(['Seasons', uniq(e.events.map(function (x) { return x.season; })).length]);
      if (shared) pairs.push(['Shared', shared]);
      html += stats(pairs);
      html += '<ul class="list" aria-label="Awards">' + e.events.map(function (x) {
        var i = x.games[x.holders.indexOf(e.holders[0])] || x.games[0];
        return gameLi(i, esc(x.season + ' · Week ' + x.week) + (x.shared ? ' <span class="era">shared</span>' : ''), Records.fmt(x.score) + ' <span class="res">' + (x.issued ? 'issued' : 'rebuilt') + '</span>');
      }).join('') + '</ul>';
      if (e.value - issued) html += '<p class="note">Awards before ' + Records.ISSUED_FROM + ' are rebuilt from the weekly scores; ' + Records.ISSUED_FROM + ' is the first season they were actually awarded.</p>';
    }
    return html;
  }
  function previousText(rec, res) {
    var p = res.previous;
    if (!p) return '';
    if (p.kind === 'na') {
      var next = res.entries.filter(function (x) { return Math.abs(x.value - res.holders[0].value) >= 5e-4; })[0];
      return next ? 'Next closest: <b>' + esc(entryNames(next)) + '</b> with ' + esc(next.mark) + '.' : 'Nobody else is on the board yet.';
    }
    if (p.kind === 'first') return 'Set ' + esc(p.entry.when) + ' and never topped. Nothing in the available history comes before it.';
    return 'Previous record: <b>' + esc(entryNames(p.entry)) + '</b>, ' + esc(p.entry.mark) + ' (' + esc(p.entry.when) + '). ' +
      'Broken ' + esc(p.current.when) + (p.current === res.holders[0] ? '' : ' by ' + esc(entryNames(p.current))) + '.';
  }
  function renderSpotlight() {
    var rec = Records.byId[state.selected], res = result(rec.id);
    var spot = $('spotlight');
    spot.className = 'spot' + (rec.unwanted ? ' bad' : '');
    if (!res.holders.length) {
      spot.innerHTML = '<div class="spot-bar">' + esc(rec.name) + '</div><div class="spot-in"><span class="scope">' + esc(Records.scopeText(rec, filters())) + '</span>' +
        '<p class="none">' + esc(emptyText(rec)) + '</p><p class="spot-def">' + esc(rec.def) + '</p></div>';
      return;
    }
    var focused = state.focus != null && res.top[state.focus] ? res.top[state.focus] : null;
    var e = focused || res.holders[0];
    var isHolder = res.holders.indexOf(e) >= 0;
    var ids = focused ? e.holders : holderIds(res);
    var tie = !focused && res.holders.length > 1;
    var who = ids.slice(0, 3).map(function (id) { return avatar(id, 'lg' + (isHolder && !rec.unwanted ? ' gold' : rec.unwanted ? ' red' : '')); }).join('');
    var html = '<div class="spot-bar">' + esc(rec.name) + '</div><div class="spot-in">';
    if (focused) {
      html += '<div class="viewing"><span>' + (isHolder ? 'Viewing the record' : 'Viewing #' + rankOf(res, res.entries.indexOf(e))) + ' · ' + esc(entryNames(e)) + '</span>' +
        '<button type="button" id="backToRecord">Back to the record</button></div>';
    }
    html += '<span class="scope">' + esc(Records.scopeText(rec, filters())) + '</span>';
    html += '<div class="spot-who">' + who + '<div><h3>' + esc(e.pair || focused ? entryNames(e) : joinNames(ids)) + '</h3>' +
      (tie ? '<span class="tie">Shared record · ' + res.holders.length + (rec.total ? ' managers' : ' times') + '</span>' : isHolder ? '' : '<span class="tie">Challenger</span>') + '</div></div>';
    html += '<div class="spot-val"><b>' + esc(bigMark(e)) + '</b><span>' + esc(e.pctValue != null ? e.line.w + '-' + e.line.l + (e.line.t ? '-' + e.line.t : '') + ' · win %' : rec.unit) + '</span></div>';
    var team = e.team || (e.kind === 'game' && !e.pair ? Records.teamOf(ctx, e.season, e.side.id) : '');
    html += '<div class="spot-when"><span>' + esc(whenText(e)) + '</span>' + (team ? '<span class="dim">' + esc(team) + '</span>' : '') + '</div>';
    if (pointsRecord(rec) && e.season && e.kind !== 'total' && Records.highSeason(ctx, e.season)) {
      html += '<p class="note">' + e.season + ' was a high-scoring season: the league averaged ' + Records.fmt(ctx.eras[e.season].avg) + ' points per team-week versus a typical ' +
        Records.fmt(ctx.medianAvg) + '. Turn on “Standard scoring only” to leave it out.</p>';
    }
    if (tie && !rec.total) html += '<p class="note">Tied ' + res.holders.length + ' times. Showing the first to reach it; pick a row in the challengers to see the others.</p>';
    html += detailFor(rec, e);
    if (!focused || isHolder) html += '<p class="prev">' + previousText(rec, res) + '</p>';
    html += '<p class="spot-def">' + esc(rec.def) + '</p>';
    html += '<div class="spot-actions' + (e.kind === 'game' ? '' : ' one') + '">' +
      (e.kind === 'game' ? '<button type="button" class="btn sec" data-game="' + esc(e.game.id) + '">Open the matchup</button>' : '') +
      '<button type="button" class="btn pri" id="shareBtn">Share this record</button></div>';
    html += '</div>';
    spot.innerHTML = html;
  }

  // ---------- challengers ----------
  function renderChallengers() {
    var rec = Records.byId[state.selected], res = result(rec.id);
    $('challTitle').textContent = rec.dir === 'asc' ? 'The closest challengers (lowest first)' : 'The closest challengers';
    if (!res.top.length) {
      $('challengers').innerHTML = '<tbody><tr class="empty-row"><td colspan="4">' + esc(emptyText(rec)) + '</td></tr></tbody>';
      return;
    }
    $('challengers').innerHTML = '<thead><tr><th scope="col">#</th><th scope="col">Manager</th><th scope="col">' + esc(rec.total ? 'Total' : 'Mark') + '</th><th scope="col">When</th></tr></thead><tbody>' +
      res.top.map(function (e, i) {
        var cls = [];
        if (res.holders.indexOf(e) >= 0) cls.push('rec');
        if (state.focus === i) cls.push('focus');
        return '<tr data-i="' + i + '" tabindex="0"' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' +
          '<td>' + rankOf(res, i) + '</td><td><span class="holders">' + e.holders.map(function (id) { return avatar(id); }).join('') + '<span>' + esc(entryNames(e)) + '</span></span></td>' +
          '<td>' + esc(e.mark) + '</td><td>' + esc(whenText(e)) + eraBadge(e, rec) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  // ---------- records nobody wants ----------
  function renderUnwanted() {
    $('unwanted').innerHTML = UNWANTED.map(function (id) {
      var rec = Records.byId[id], res = result(id), e = res.holders[0];
      var body = e
        ? '<span class="who">' + holderIds(res).slice(0, 3).map(function (h) { return avatar(h, 'red'); }).join('') + esc(joinNames(holderIds(res))) + '</span>' +
          '<span class="val">' + esc(e.mark) + '</span><p>' + esc(res.holders.length > 1 && rec.total ? 'Shared at ' + e.value + '. Misery loves company.' : CAPTIONS[id](e)) +
          (e.kind !== 'total' ? ' <span class="dim-when">' + esc(e.when) + '</span>' : '') + '</p>'
        : '<p>' + esc(emptyText(rec)) + '</p>';
      return '<button type="button" class="uw' + (state.selected === id ? ' sel' : '') + '" data-rec="' + id + '">' + svg(id, 'uw-ico') + '<h3>' + esc(rec.name) + '</h3>' + body + '</button>';
    }).join('');
  }

  // ---------- banners in the rafters ----------
  function renderBanners() {
    var st = data.standings || {}, years = ctx.seasons;
    var all = years.concat(Object.keys(st).map(Number)).filter(function (y, i, a) { return a.indexOf(y) === i; }).sort(function (a, b) { return a - b; });
    if (!all.length) { $('banners').innerHTML = ''; return; }
    var out = [];
    for (var y = all[0]; y <= all[all.length - 1]; y++) {
      var s = st[y], champ = null, ru = null;
      if (s) Object.keys(s.ranks).forEach(function (id) { if (s.ranks[id] === 1) champ = id; if (s.ranks[id] === 2) ru = id; });
      if (all.indexOf(y) < 0) {
        out.push('<li class="banner gap"><div class="flag"><span class="yr">' + y + '</span><span class="nm">Not in the Yahoo history</span></div></li>');
      } else if (!s || !s.finished || !champ) {
        out.push('<li class="banner open"><div class="flag"><span class="yr">' + y + '</span>' + svg('crown', 'crown') + '<span class="nm">To be decided</span><span class="ru">' +
          (ctx.finished(y) ? 'No final standings' : 'Season in progress') + '</span></div></li>');
      } else {
        out.push('<li class="banner"><div class="flag"><span class="yr">' + y + '</span>' + svg('crown', 'crown') +
          '<span class="nm">' + esc(name(champ)) + '</span><span class="tm">' + esc(Records.teamOf(ctx, y, champ)) + '</span>' +
          (ru ? '<span class="ru">Runner-up · ' + esc(name(ru)) + '</span>' : '') + '</div></li>');
      }
    }
    $('banners').innerHTML = out.join('');
  }

  // ---------- matchup modal ----------
  function openGame(id, opener) {
    var g = gameById[id];
    if (!g) return;
    lastOpener = opener || document.activeElement;
    var a = Records.side(g, g.managerA), b = Records.side(g, g.managerB);
    var sides = a.score >= b.score ? [a, b] : [b, a];
    var html = '<p class="m-kicker">' + esc(g.season + ' · ' + Records.gameLabel(g)) + '</p>' +
      '<h2 class="m-title" id="matchTitle">' + esc(name(sides[0].id)) + (sides[0].result === 'T' ? ' ties ' : ' over ') + esc(name(sides[1].id)) + '</h2>';
    html += sides.map(function (s) {
      return '<div class="m-side' + (s.result === 'W' ? ' won' : '') + '">' + avatar(s.id, s.result === 'W' ? 'gold' : '') +
        '<div><h4>' + esc(name(s.id)) + '</h4><small>' + esc(Records.teamOf(ctx, g.season, s.id) || '') + '</small></div><b>' + Records.fmt(s.score) + '</b></div>';
    }).join('');
    var era = ctx.eras[g.season];
    html += '<dl class="m-facts"><div><dt>Margin</dt><dd>' + Records.fmt(a.margin) + '</dd></div><div><dt>Combined</dt><dd>' + Records.fmt(g.scoreA + g.scoreB) + '</dd></div>' +
      '<div><dt>' + g.season + ' average</dt><dd>' + (era ? Records.fmt(era.avg) : '—') + '</dd></div></dl>';
    // Every record this game holds under the current filters.
    var notes = [];
    Records.list.forEach(function (r) {
      var res = result(r.id);
      res.holders.forEach(function (e) {
        if (e.kind === 'game' && e.game.id === g.id && notes.indexOf(r.name) < 0) notes.push(r.name);
      });
    });
    var items = notes.map(function (n) { return '<li>Holds the record: <b>' + esc(n) + '</b></li>'; });
    if (era && era.high) items.push('<li>' + g.season + ' was a high-scoring season, so scores run higher than usual.</li>');
    if (g.gameType === 'playoff') items.push('<li>Playoff game' + (g.round ? ' · ' + esc(g.round) : '') + '.</li>');
    if (items.length) html += '<ul class="m-list">' + items.join('') + '</ul>';
    html += '<h3 class="m-sub">Box score</h3><div id="matchBox"></div>';
    $('matchBody').innerHTML = html;
    if (window.BoxScore) {
      BoxScore.fill($('matchBox'), { id: g.id, season: g.season, week: g.week,
        a: { id: sides[0].id, name: name(sides[0].id), score: sides[0].score }, b: { id: sides[1].id, name: name(sides[1].id), score: sides[1].score } });
    } else {
      $('matchBox').innerHTML = '<p class="fine">Lineups aren’t available on this page.</p>';
    }
    $('matchModal').hidden = false;
    $('matchClose').focus();
  }
  function closeModal() {
    if ($('matchModal').hidden) return;
    $('matchModal').hidden = true;
    if (lastOpener && document.contains(lastOpener)) lastOpener.focus();
  }

  // ---------- share ----------
  function shareText() {
    var rec = Records.byId[state.selected], res = result(rec.id), e = res.holders[0];
    var lines = ['Gooncocks Record Room · ' + rec.name];
    if (!e) lines.push(emptyText(rec));
    else {
      lines.push((e.pair ? entryNames(e) : joinNames(holderIds(res))) + ': ' + e.mark + ' ' + (e.pctValue != null ? '' : rec.unit));
      var w = whenText(e);
      if (e.kind === 'game' && !e.pair) w += ' vs ' + name(e.side.opp) + ' (' + Records.fmt(e.side.oppScore) + ')';
      lines.push(w + (res.holders.length > 1 ? ' · tied ×' + res.holders.length : ''));
      var p = res.previous;
      if (p && p.kind === 'previous') lines.push('Previous record: ' + entryNames(p.entry) + ', ' + p.entry.mark + ' (' + p.entry.when + ')');
    }
    lines.push(Records.scopeText(rec, filters()));
    lines.push(data.source === 'yahoo' ? '(From the league’s Yahoo history.)' : '(Demo data, not real league results.)');
    if (/^https?:/.test(location.protocol)) lines.push(location.href.split('#')[0] + hashFor());
    return lines.map(function (l) { return l.replace(/\s+$/, ''); }).join('\n');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }
  function share() {
    var text = shareText();
    function fallback() {
      $('copyText').value = text;
      $('copyFallback').hidden = false;
      $('copyText').focus();
      $('copyText').select();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Record copied. Go start an argument.'); }, fallback);
    } else fallback();
  }

  // ---------- render + wiring ----------
  function render() {
    results = {};
    $('seasonSel').value = String(state.season);
    document.querySelectorAll('input[name="gtype"]').forEach(function (r) { r.checked = r.value === state.type; });
    $('standardOnly').checked = state.standard;
    $('search').value = state.search;
    renderFeatured();
    renderBook();
    renderSpotlight();
    renderChallengers();
    renderUnwanted();
    save();
    writeHash();
  }
  function renderSelection() {
    renderFeatured(); renderBook(); renderSpotlight(); renderChallengers(); renderUnwanted();
    save(); writeHash();
  }
  function reveal(el) {
    var narrow = window.matchMedia('(max-width: 1060px)').matches;
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var r = el.getBoundingClientRect();
    if (narrow || r.top < 0 || r.top > window.innerHeight - 120) el.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  }
  function select(id, scroll) {
    if (!Records.byId[id]) return;
    state.selected = id;
    state.focus = null;
    var rec = Records.byId[id];
    // Make sure the chosen record is visible in the book.
    if (state.cat !== 'all' && rec.cat !== state.cat) state.cat = 'all';
    if (state.cat === 'all' && !rec.core && !state.search) state.showAll = true;
    renderSelection();
    if (scroll) reveal($('spotlight'));
  }
  function wire() {
    $('seasonSel').addEventListener('change', function (e) { state.season = e.target.value === 'all' ? 'all' : Number(e.target.value); state.focus = null; render(); });
    document.querySelectorAll('input[name="gtype"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) { state.type = r.value; state.focus = null; render(); } });
    });
    $('standardOnly').addEventListener('change', function (e) { state.standard = e.target.checked; state.focus = null; render(); });
    $('catSel').addEventListener('change', function (e) { state.cat = e.target.value; renderBook(); save(); });
    $('controls').addEventListener('submit', function (e) { e.preventDefault(); });
    var cats = $('recordTable').closest('.book').querySelector('.cats');
    cats.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cat]');
      if (!b) return;
      state.cat = b.getAttribute('data-cat'); renderBook(); save();
    });
    cats.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = CATS.indexOf(state.cat) + (e.key === 'ArrowRight' ? 1 : -1);
      state.cat = CATS[(i + CATS.length) % CATS.length]; renderBook(); save();
      cats.querySelector('[data-cat="' + state.cat + '"]').focus();
    });
    $('search').addEventListener('input', function (e) { state.search = e.target.value; renderBook(); });
    $('moreBtn').addEventListener('click', function () { state.showAll = !state.showAll; renderBook(); save(); });
    $('recordTable').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-rec]');
      if (tr) select(tr.getAttribute('data-rec'), true);
    });
    $('recordTable').addEventListener('keydown', function (e) {
      var tr = e.target.closest('tr[data-rec]');
      if (!tr || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      var id = tr.getAttribute('data-rec');
      select(id, false);
      var again = $('recordTable').querySelector('tr[data-rec="' + id + '"]');
      if (again) again.focus();
    });
    $('featured').addEventListener('click', function (e) {
      var g = e.target.closest('[data-game]');
      if (g) { openGame(g.getAttribute('data-game'), g); return; }
      var b = e.target.closest('[data-rec]');
      if (b) select(b.getAttribute('data-rec'), true);
    });
    $('unwanted').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rec]');
      if (b) select(b.getAttribute('data-rec'), true);
    });
    $('spotlight').addEventListener('click', function (e) {
      var g = e.target.closest('[data-game]');
      if (g) { openGame(g.getAttribute('data-game'), g); return; }
      if (e.target.closest('#shareBtn')) share();
      if (e.target.closest('#backToRecord')) { state.focus = null; renderSpotlight(); renderChallengers(); }
    });
    function focusRow(tr) {
      var i = Number(tr.getAttribute('data-i'));
      state.focus = state.focus === i ? null : i;
      renderSpotlight(); renderChallengers();
    }
    $('challengers').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-i]');
      if (tr) { focusRow(tr); reveal($('spotlight')); }
    });
    $('challengers').addEventListener('keydown', function (e) {
      var tr = e.target.closest('tr[data-i]');
      if (!tr || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      var i = tr.getAttribute('data-i');
      focusRow(tr);
      var again = $('challengers').querySelector('tr[data-i="' + i + '"]');
      if (again) again.focus();
    });
    $('matchClose').addEventListener('click', closeModal);
    $('matchModal').addEventListener('click', function (e) { if (e.target === $('matchModal')) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('copyFallback').hidden) { $('copyFallback').hidden = true; return; }
      closeModal();
    });
    $('copyClose').addEventListener('click', function () {
      $('copyFallback').hidden = true;
      var b = $('shareBtn'); if (b) b.focus();
    });
    window.addEventListener('hashchange', function () {
      var o = readHash();
      if (!o || hashFor() === decodeURIComponent(location.hash)) return;
      applySaved(o); state.focus = null; render();
    });
  }

  function start(loaded) {
    data = loaded;
    byId = {};
    data.managers.forEach(function (m) { byId[m.id] = m; });
    gameById = {};
    data.matchups.forEach(function (g) { gameById[g.id] = g; });
    ctx = Records.context(data);
    if (!ctx.seasons.length) throw new Error('The history has no completed games yet.');
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    applySaved(saved);
    applySaved(readHash());
    renderStatic();
    renderBanners();
    wire();
    render();
  }

  function fail(err) {
    console.error(err);
    var box = document.createElement('div');
    box.className = 'load-error';
    box.setAttribute('role', 'alert');
    box.innerHTML = '<b>The Record Room couldn’t load the league history.</b><p class="fine">' + esc(err && err.message ? err.message : err) + '</p>';
    $('featured').replaceWith(box);
  }

  RecordData.load().then(function (d) {
    try { start(d); } catch (err) { fail(err); }
  }, fail);
})();
