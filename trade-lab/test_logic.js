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

console.log(`\n${passed} checks passed`);
