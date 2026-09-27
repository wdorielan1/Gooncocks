// Unit tests for trade-lab/js/logic.js.  Run: node trade-lab/test_logic.js
const assert = require('assert');
require('./js/logic.js');
const L = globalThis.TradeLogic;

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log('ok  ' + name); }

const T = { will: 't.1', sam: 't.2', chet: 't.3', gabe: 't.4' };
function li(team, manager, name, position, status, wants, updated) {
  return { player_key: 'p.' + name, team_key: team, manager, name, position, status, wants, note: '', updated_at: updated };
}
const listings = [
  li(T.will, 'Will', 'Amon-Ra St. Brown', 'WR', 'available', ['RB'], 500),
  li(T.sam, 'Sam', 'Breece Hall', 'RB', 'available', ['WR'], 400),
  li(T.chet, 'Chet', 'Brock Purdy', 'QB', 'listening', ['RB', 'WR'], 300),
  li(T.chet, 'Chet', 'Tee Higgins', 'WR', 'available', ['TE'], 200),
  li(T.gabe, 'Gabe', 'Travis Etienne', 'RB', 'listening', [], 100),
];

check('filters by search on player or manager, case-insensitive', () => {
  assert.deepStrictEqual(L.filterListings(listings, { search: 'breece' }).map(l => l.name), ['Breece Hall']);
  assert.strictEqual(L.filterListings(listings, { search: 'CHET' }).length, 2);
});
check('filters by position, manager and availability together', () => {
  assert.deepStrictEqual(L.filterListings(listings, { position: 'WR', team: 'all', status: 'available' }).map(l => l.name),
    ['Amon-Ra St. Brown', 'Tee Higgins']);
  assert.deepStrictEqual(L.filterListings(listings, { team: T.chet, status: 'listening' }).map(l => l.name), ['Brock Purdy']);
});
check('sorts by recently updated by default, or by name', () => {
  assert.strictEqual(L.filterListings(listings, {})[0].name, 'Amon-Ra St. Brown');
  assert.deepStrictEqual(L.filterListings(listings, { sort: 'name' }).map(l => l.name)[1], 'Breece Hall');
});
check('who needs what merges each manager\'s wants and skips managers with none', () => {
  const n = L.needs(listings, [{ team_key: T.will }, { team_key: T.sam }, { team_key: T.chet }, { team_key: T.gabe }]);
  assert.deepStrictEqual(n.map(x => [x.manager, x.wants]), [['Will', ['RB']], ['Sam', ['WR']], ['Chet', ['RB', 'WR', 'TE']]]);
});
check('matchmaker puts mutual matches first and only uses listed players', () => {
  const r = L.matchmaker(listings, T.will);
  assert.deepStrictEqual(r.wants, ['RB']);
  assert.deepStrictEqual(r.matches.map(m => [m.manager, m.mutual]), [['Sam', true], ['Gabe', false]]);
  assert.ok(r.matches[0].text.includes('Breece Hall (RB)'));
  assert.ok(r.matches[0].text.includes('Amon-Ra St. Brown (WR)'));
  assert.ok(r.matches[1].text.includes('haven’t said what they want back') || r.matches[1].text.includes('They haven’t said'));
  // Chet wants RB/WR but has no RB listed, so he's not a match for Will.
  assert.ok(!r.matches.some(m => m.manager === 'Chet'));
});
check('matchmaker with no listings or no wants returns no matches', () => {
  assert.deepStrictEqual(L.matchmaker(listings, 't.none').matches, []);
  assert.deepStrictEqual(L.matchmaker(listings, T.gabe).matches, []);
});
check('matchmaker never counts unlisted players', () => {
  const r = L.matchmaker(listings.filter(l => l.name !== 'Breece Hall'), T.will);
  assert.ok(!r.matches.some(m => m.manager === 'Sam'));
});

const box = { games: {
  '2026-w01-a-b': { a: [['WR', 'Amon-Ra St. Brown', 'WR', '', 18], ['QB', 'Jared Goff', 'QB', '', 20]], b: [['RB', 'Breece Hall', 'RB', '', 10]] },
  '2026-w02-a-c': { a: [['WR', 'Amon-Ra St. Brown', 'WR', '', 24], ['BN', 'Jared Goff', 'QB', '', 30]], b: [] },
  '2026-w03-a-b': { a: [['WR', 'Amon-Ra St. Brown', 'WR', '', 6]], b: [['RB', 'Breece Hall', 'RB', '', null]] },
} };
check('player stats come from recorded weekly scores only', () => {
  const w = L.playerWeeks(box);
  const s = L.playerStats(w, { name: 'Amon-Ra St. Brown', position: 'WR' }, 2);
  assert.deepStrictEqual([s.games, s.total, s.ppg, s.recent, s.first, s.last], [3, 48, 16, 15, 1, 3]);
  const h = L.playerStats(w, { name: 'Breece Hall', position: 'RB' }, 3);
  assert.deepStrictEqual([h.games, h.total], [1, 10]);  // a missing score isn't a zero
  const none = L.playerStats(w, { name: 'Nobody', position: 'TE' });
  assert.deepStrictEqual([none.games, none.ppg, none.recent], [0, null, null]);
});
check('side totals skip players with no scored weeks and count them', () => {
  const w = L.playerWeeks(box);
  const t = L.sideTotals([L.playerStats(w, { name: 'Jared Goff', position: 'QB' }), L.playerStats(w, { name: 'Nobody', position: 'K' })]);
  assert.deepStrictEqual([t.total, t.ppg, t.missing, t.games], [50, 25, 1, 2]);
});
check('relative times', () => {
  assert.strictEqual(L.ago(1000, 1030), 'just now');
  assert.strictEqual(L.ago(1000, 1000 + 35 * 60), '35 min ago');
  assert.strictEqual(L.ago(1000, 1000 + 3 * 3600), '3 hr ago');
  assert.strictEqual(L.ago(1000, 1000 + 86400), 'yesterday');
  assert.strictEqual(L.ago(0, 5), 'never');
});

// ---------- ratings, scouting, partners, fairness ----------
function pl(key, name, pos, slot) { return { player_key: key, name, position: pos, positions: [pos], slot: slot || '' }; }
function weeksFor(map) {  // {name|POS: [pts...]} -> playerWeeks-style lookup
  const out = {};
  Object.keys(map).forEach(k => { const [n, pos] = k.split('|'), key = n.toLowerCase() + '|' + pos; out[key] = {}; map[k].forEach((v, i) => { out[key][i + 1] = v; }); });
  return out;
}
check('rating blends this season with last season as 2 extra weeks', () => {
  const cur = weeksFor({ 'Ace|WR': [30, 30] }), prev = weeksFor({ 'Ace|WR': [10, 10, 10, 10] });
  const r = L.playerRating(cur, prev, { name: 'Ace', position: 'WR' });
  assert.strictEqual(r.value, (60 + 2 * 10) / 4);
  assert.strictEqual(r.basis, 'blend');
  assert.strictEqual(L.playerRating(cur, {}, { name: 'Ace', position: 'WR' }).value, 30);
  assert.strictEqual(L.playerRating({}, prev, { name: 'Ace', position: 'WR' }).basis, 'last');
  assert.strictEqual(L.playerRating({}, {}, { name: 'Nobody', position: 'K' }).value, null);
});
check('slots come from the latest box score lineup, without bench or IR', () => {
  const b = { games: { '2026-w01-a-b': { a: [['QB'], ['RB'], ['BN'], ['IR']] }, '2026-w02-a-b': { a: [['QB'], ['WR'], ['W/R/T'], ['BN']] } } };
  assert.deepStrictEqual(L.slotsFromBox(b), ['QB', 'WR', 'W/R/T']);
  assert.strictEqual(L.slotsFromBox(null).length, 10);
});
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'W/R/T', 'K', 'DEF'];
const vals = { q1: 20, q2: 14, r1: 18, r2: 12, r3: 11, w1: 16, w2: 15, w3: 9, t1: 8, k1: 9, d1: 7, x1: 40 };
const rate = p => ({ value: vals[p.player_key] === undefined ? null : vals[p.player_key], games: 3 });
check('team report fills slots best-first, flex from leftovers, IR never starts', () => {
  const roster = [pl('q1', 'Q1', 'QB'), pl('q2', 'Q2', 'QB'), pl('r1', 'R1', 'RB'), pl('r2', 'R2', 'RB'), pl('r3', 'R3', 'RB'),
                  pl('w1', 'W1', 'WR'), pl('w2', 'W2', 'WR'), pl('w3', 'W3', 'WR'), pl('t1', 'T1', 'TE'), pl('k1', 'K1', 'K'),
                  pl('d1', 'D1', 'DEF'), pl('x1', 'Hurt', 'WR', 'IR')];
  const r = L.teamReport(roster, SLOTS, rate);
  assert.strictEqual(r.groups.QB.points, 20);
  assert.strictEqual(r.groups.RB.points, 30);
  assert.strictEqual(r.groups.WR.points, 31);
  assert.strictEqual(r.groups.FLEX.points, 11);  // R3 beats W3 for the flex
  assert.deepStrictEqual(r.bench.map(x => x.player.player_key).sort(), ['q2', 'w3']);
  assert.deepStrictEqual(r.out.map(x => x.player.player_key), ['x1']);
});
check('an empty slot counts zero and is flagged', () => {
  const r = L.teamReport([pl('q1', 'Q1', 'QB')], SLOTS, rate);
  assert.strictEqual(r.groups.TE.points, 0);
  assert.strictEqual(r.groups.TE.missing, 1);
});
// Two teams mirror each other: A is deep at RB and thin at WR, B the reverse.
const vals2 = Object.assign({}, vals, { ar1: 22, ar2: 20, ar3: 17, aw1: 8, aw2: 7, br1: 7, br2: 6, bw1: 22, bw2: 20, bw3: 17,
  cr1: 13, cr2: 12, cw1: 13, cw2: 12, aq: 18, bq: 18, cq: 18, at: 8, bt: 8, ct: 8 });
const rate2 = p => ({ value: vals2[p.player_key] === undefined ? null : vals2[p.player_key], games: 3 });
const teamsX = [
  { team_key: 'A', manager: 'Ann', players: [pl('aq', 'AQ', 'QB'), pl('ar1', 'AR1', 'RB'), pl('ar2', 'AR2', 'RB'), pl('ar3', 'AR3', 'RB'), pl('aw1', 'AW1', 'WR'), pl('aw2', 'AW2', 'WR'), pl('at', 'AT', 'TE')] },
  { team_key: 'B', manager: 'Bo', players: [pl('bq', 'BQ', 'QB'), pl('br1', 'BR1', 'RB'), pl('br2', 'BR2', 'RB'), pl('bw1', 'BW1', 'WR'), pl('bw2', 'BW2', 'WR'), pl('bw3', 'BW3', 'WR'), pl('bt', 'BT', 'TE')] },
  { team_key: 'C', manager: 'Cy', players: [pl('cq', 'CQ', 'QB'), pl('cr1', 'CR1', 'RB'), pl('cr2', 'CR2', 'RB'), pl('cw1', 'CW1', 'WR'), pl('cw2', 'CW2', 'WR'), pl('ct', 'CT', 'TE')] },
];
const SL = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'];
check('scouting labels strengths and weaknesses against the league average', () => {
  const sc = L.scouting(teamsX, SL, rate2);
  const a = sc.teams.find(t => t.team_key === 'A'), b = sc.teams.find(t => t.team_key === 'B');
  assert.deepStrictEqual(sc.groups, ['QB', 'RB', 'WR', 'TE']);
  assert.strictEqual(a.cells.RB.label, 'strong'); assert.strictEqual(a.cells.WR.label, 'weak');
  assert.strictEqual(b.cells.RB.label, 'weak'); assert.strictEqual(b.cells.WR.label, 'strong');
  assert.strictEqual(a.cells.QB.label, 'average');
  assert.strictEqual(a.cells.RB.rank, 1);
  assert.deepStrictEqual(a.strengths, ['RB']); assert.deepStrictEqual(a.weaknesses, ['WR']);
});
check('trade fits find the two-way partner first and never call unlisted players available', () => {
  const sc = L.scouting(teamsX, SL, rate2);
  const listings = [{ player_key: 'bw3', team_key: 'B', position: 'WR' }];
  const r = L.tradeFits(sc, 'A', listings);
  assert.strictEqual(r.fits[0].manager, 'Bo');
  assert.ok(r.fits[0].mutual);
  assert.deepStrictEqual(r.fits[0].gets.map(x => x.group), ['WR']);
  assert.deepStrictEqual(r.fits[0].gives.map(x => x.group), ['RB']);
  assert.strictEqual(r.fits[0].theyOffer[0].player.player_key, 'bw3');   // the listed one comes first
  assert.ok(r.fits[0].theyOffer[0].listed);
  assert.ok(r.fits[0].theyOffer.slice(1).every(x => !x.listed));
  assert.ok(r.fits[0].youOffer.some(x => x.player.player_key === 'ar3' && x.role === 'bench'));
  assert.deepStrictEqual(L.tradeFits(sc, 'nobody', []).fits, []);
});
check('fairness verdict: fair within 10%, leans to 25%, lopsided beyond', () => {
  const f = L.fairness([{ value: 20, games: 3 }], [{ value: 21, games: 3 }]);
  assert.strictEqual(f.verdict, 'fair'); assert.strictEqual(f.favors, null);
  const g = L.fairness([{ value: 20, games: 3 }], [{ value: 16, games: 3 }]);
  assert.strictEqual(g.verdict, 'leans'); assert.strictEqual(g.favors, 'B');  // B receives A's 20
  const h = L.fairness([{ value: 10, games: 3 }], [{ value: 18, games: 3 }, { value: 4, games: 1 }]);
  assert.strictEqual(h.verdict, 'lopsided'); assert.strictEqual(h.favors, 'A');
  assert.ok(h.uneven); assert.strictEqual(h.thin, 1);
  assert.strictEqual(L.fairness([{ value: null }], [{ value: 5, games: 3 }]).missing, 1);
});

console.log(`\n${passed} checks passed`);
