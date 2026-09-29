// Browser tests for the Trade Lab page, run against the design preview
// (sample data, pretend server). Needs Playwright + Chromium:
//   NODE_PATH=$(npm root -g) node trade-lab/test_preview.js [screenshot-dir]
// This checks the page's behavior only; real Yahoo sign-in and storage are
// covered by test_trade_lab.py against fakes and still need a live check.
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const shots = process.argv[2];
const file = path.join(os.tmpdir(), 'trade-lab-preview-test.html');
execFileSync('python3', [path.join(__dirname, 'build.py'), '--preview', file]);
const toolsFile = path.join(os.tmpdir(), 'tools-preview-test.html');
execFileSync('python3', [path.join(__dirname, 'build.py'), '--tools', '--preview', toolsFile]);

let passed = 0;
async function check(name, fn) { await fn(); passed += 1; console.log('ok  ' + name); }

async function open(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, r => r.abort());  // no fonts or anything else from the network
  // One sample player gets a broken photo so the fallback is exercised.
  await page.addInitScript(() => {
    let s;
    Object.defineProperty(window, 'TRADE_LAB_SAMPLE', { configurable: true, get: () => s,
      set: v => { v.listings[1].headshot = 'file:///no/such/photo.webp'; s = v; } });
  });
  await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cards .card');
  page.errors = errors;
  return page;
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const cardNames = page => page.$$eval('#cards .card .pname', els => els.map(e => e.textContent));

(async () => {
  const browser = await chromium.launch();
  const page = await open(browser, 1280, 900);

  await check('preview is clearly labeled as sample data', async () => {
    assert.ok(await page.isVisible('#previewFlag'));
    assert.match(await page.textContent('#previewFlag'), /sample listings, not the league/);
    assert.match(await page.textContent('#checked'), /^Sample data/);
    assert.strictEqual(await page.title(), 'Trade Lab Preview');
  });
  await check('trading block lists every listing, newest first', async () => {
    assert.strictEqual((await cardNames(page)).length, 7);
    assert.strictEqual((await cardNames(page))[0], 'Amon-Ra St. Brown');
    assert.strictEqual(await page.textContent('#count'), '7 players');
  });
  await check('notes render as plain text, never HTML', async () => {
    const note = await page.$$eval('#cards .note', els => els.map(e => [e.textContent, e.children.length]));
    assert.ok(note.some(([t, kids]) => t.startsWith('<b>not bold</b>') && kids === 0));
    assert.strictEqual(await page.$$eval('#cards b', els => els.filter(e => e.textContent === 'not bold').length), 0);
  });
  await check('missing and broken photos fall back to a silhouette', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#cards .shot .ghost').length === 7);
    assert.strictEqual(await page.$$eval('#cards .shot img', els => els.length), 0);
  });
  await check('search and filters narrow the block', async () => {
    await page.fill('#q', 'chet');
    assert.deepStrictEqual((await cardNames(page)).sort(), ['Brock Purdy', 'Tee Higgins']);
    await page.fill('#q', '');
    await page.selectOption('#fPos', 'RB');
    await page.selectOption('#fStatus', 'listening');
    assert.deepStrictEqual(await cardNames(page), ['Travis Etienne']);
    assert.strictEqual(await page.textContent('#count'), '1 of 7 players');
    await page.selectOption('#fPos', 'TE');
    assert.match(await page.textContent('#listState'), /No listings match/);
    await page.selectOption('#fPos', 'all'); await page.selectOption('#fStatus', 'all');
    await page.selectOption('#fSort', 'name');
    assert.strictEqual((await cardNames(page))[0], 'Amon-Ra St. Brown');
    assert.strictEqual((await cardNames(page))[1], 'Breece Hall');
    await page.selectOption('#fSort', 'recent');
  });
  await check('signed out: browse only, no edit controls, sign-in offered', async () => {
    assert.strictEqual(await page.$$eval('#cards button', b => b.filter(x => x.textContent === 'Edit').length), 0);
    assert.strictEqual(await page.$$eval('#cards .card.mine', c => c.length), 0);
    assert.match(await page.textContent('#editor'), /sign in with the Yahoo account/);
  });
  await check('listing details open in a dialog, Esc closes and focus returns', async () => {
    const btn = page.locator('#cards .card', { hasText: 'Mark Andrews' }).getByRole('button', { name: /View listing/ });
    await btn.click();
    assert.ok(await page.isVisible('#detail'));
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'detailClose');
    assert.match(await page.textContent('#detailBody'), /<b>not bold<\/b>/);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.getElementById('detail').contains(document.activeElement)));
    await page.keyboard.press('Escape');
    assert.ok(await page.isHidden('#detail'));
    assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /View listing: Mark Andrews/);
  });
  await check('signing in marks only your own listings as editable', async () => {
    await page.click('#account button');
    await page.waitForSelector('#editor .roster');
    assert.match(await page.textContent('#account'), /Signed in as Will/);
    const mine = await page.$$eval('#cards .card.mine', c => c.map(x => [x.querySelector('.pname').textContent, !!x.querySelector('.mine-tag'),
      [...x.querySelectorAll('button')].some(b => b.textContent === 'Edit')]));
    assert.deepStrictEqual(mine, [['Amon-Ra St. Brown', true, true]]);
    assert.strictEqual(await page.$$eval('#cards .card:not(.mine) button', b => b.filter(x => x.textContent === 'Edit').length), 0);
  });
  await check('editor makes clear the edit applies to several players', async () => {
    assert.match(await page.textContent('#editor .form'), /Nothing selected/);
    await page.check('[data-k="pick:470.p.2"]');
    assert.match(await page.textContent('#editor h3'), /Editing 1 player/);
    await page.check('[data-k="pick:470.p.7"]');
    assert.match(await page.textContent('#editor h3'), /Editing 2 players together/);
    assert.match(await page.textContent('#editor .form'), /These settings apply to all 2: Jared Goff, Jalen Hurts \(2 new\)/);
    assert.strictEqual(await page.textContent('[data-k="save"]'), 'Save 2 listings');
  });
  await check('note is capped at 200 characters with a live counter', async () => {
    await page.fill('#tlNote', 'x'.repeat(250));
    assert.strictEqual((await page.inputValue('#tlNote')).length, 200);
    assert.strictEqual(await page.textContent('#noteCount'), '200 / 200');
  });
  await check('a failed save keeps everything you entered', async () => {
    await page.check('#editor input[value="listening"]');
    await page.check('[data-k="want:WR"]');
    await page.fill('#tlNote', 'QB depth for a WR2');
    await page.evaluate(() => {
      const real = TradeApi.save;
      TradeApi.save = function () { TradeApi.save = real; return Promise.reject(Object.assign(new Error('Yahoo isn’t answering right now.'), { status: 503 })); };
    });
    await page.click('[data-k="save"]');
    await page.waitForSelector('#editor .msg.err');
    assert.match(await page.textContent('#editor .msg.err'), /Yahoo isn’t answering.*Your changes are still here/);
    assert.strictEqual(await page.inputValue('#tlNote'), 'QB depth for a WR2');
    assert.ok(await page.isChecked('#editor input[value="listening"]'));
    assert.ok(await page.isChecked('[data-k="want:WR"]'));
    assert.ok(await page.isChecked('[data-k="pick:470.p.7"]'));
  });
  await check('saving lists the players and shows success', async () => {
    await page.click('[data-k="save"]');
    await page.waitForSelector('#editor .msg.ok');
    assert.match(await page.textContent('#editor .msg.ok'), /Saved 2 listings/);
    assert.strictEqual((await cardNames(page)).length, 9);
    const goff = page.locator('#cards .card', { hasText: 'Jared Goff' });
    assert.match(await goff.getAttribute('class'), /mine/);
    assert.match(await goff.textContent(), /Listening to offers/);
    assert.match(await goff.textContent(), /QB depth for a WR2/);
    assert.match(await page.textContent('#editor .roster'), /Listening/);
    assert.match(await page.textContent('#needs'), /Will/);
  });
  await check('a version conflict keeps your edits and loads the latest', async () => {
    await page.locator('#cards .card', { hasText: 'Jared Goff' }).getByRole('button', { name: /Edit/ }).click();
    assert.ok(await page.isChecked('#editor input[value="listening"]'));  // prefilled from the listing
    await page.fill('#tlNote', 'my newer note');
    await page.evaluate(() => {
      const real = TradeApi.save;
      TradeApi.save = function (items) {
        TradeApi.save = real;
        const cur = Object.assign({}, TradeApi.s.listings.find(l => l.player_key === items[0].player_key), { note: 'changed elsewhere', version: 7 });
        return Promise.resolve({ _status: 409, listings: [], results: [{ player_key: items[0].player_key, ok: false, error: 'conflict', current: cur }] });
      };
    });
    await page.click('[data-k="save"]');
    await page.waitForSelector('#editor .msg.err');
    assert.match(await page.textContent('#editor .msg.err'), /changed somewhere else/);
    assert.strictEqual(await page.inputValue('#tlNote'), 'my newer note');
    assert.match(await page.locator('#cards .card', { hasText: 'Jared Goff' }).textContent(), /changed elsewhere/);
  });
  await check('removing a listing asks to confirm, then removes it', async () => {
    await page.click('[data-k="clearsel"]');
    await page.locator('#cards .card', { hasText: 'Amon-Ra' }).getByRole('button', { name: /Edit/ }).click();
    assert.strictEqual(await page.textContent('[data-k="remove"]'), 'Remove from block');
    await page.click('[data-k="remove"]');
    assert.strictEqual(await page.textContent('[data-k="remove"]'), 'Confirm remove');
    assert.strictEqual((await cardNames(page)).filter(n => n === 'Amon-Ra St. Brown').length, 1);
    await page.click('[data-k="remove"]');
    await page.waitForSelector('#editor .msg.ok');
    assert.ok(!(await cardNames(page)).includes('Amon-Ra St. Brown'));
  });
  await check('tabs work with arrow keys', async () => {
    await page.focus('#tab-block');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await page.getAttribute('#tab-scout', 'aria-selected'), 'true');
    assert.ok(await page.isVisible('#panel-scout'));
    assert.ok(await page.isHidden('#panel-block'));
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'tab-scout');
    await page.keyboard.press('End');
    assert.ok(await page.isVisible('#panel-calc'));
    await page.keyboard.press('ArrowRight');
    assert.ok(await page.isVisible('#panel-block'));
  });
  await check('listing cards show each player’s rating once scores load', async () => {
    await page.waitForSelector('#cards .rate');
    const rates = await page.$$eval('#cards .card', cs => cs.map(c => (c.querySelector('.rate') || {}).textContent || ''));
    assert.ok(rates.every(r => /^\d+\.\d pts\/wk$/.test(r)), rates.join(','));
  });
  await check('scouting report: every position vs the league average, in words as well as color', async () => {
    await page.click('#tab-scout');
    await page.waitForSelector('#scoutReport table.scout');
    assert.strictEqual(await page.inputValue('#sTeam'), '470.l.960265.t.1');  // your team first
    const GRADE = /^(A\+|A|A−|B\+|B|C|C−|D\+|D|D−|F)$/;
    const rows = await page.$$eval('.scout tbody tr', trs => trs.map(t => [t.querySelector('th').textContent, t.querySelector('.grade').textContent, t.querySelector('.dv-txt').textContent]));
    assert.deepStrictEqual(rows.map(r => r[0]), ['QB', 'RB', 'WR', 'TE', 'Flex', 'K', 'DEF']);
    assert.ok(rows.every(r => GRADE.test(r[1])), JSON.stringify(rows));
    assert.ok(rows.every(r => /^(\d+\.\d pts\/wk (better|worse) than average|about average)$/.test(r[2])), JSON.stringify(rows));
    assert.ok(!rows.some(r => /^[+−]/.test(r[2])));  // no bare +/- numbers
    assert.match(await page.textContent('.scout-sum'), /^Your team: A.* at WR.* Your weak spots are RB \(D\)/);
    const grid = await page.$$eval('#scoutGrid tbody tr', trs => trs.map(t => [...t.querySelectorAll('td')].map(td => td.textContent)));
    assert.strictEqual(grid.length, 6);
    assert.ok(grid.every(r => r.length === 7 && r.every(c => GRADE.test(c))), JSON.stringify(grid));
    assert.ok(await page.$$eval('#scoutGrid td', tds => tds.every(td => /pts\/wk, .*(than average|about average)/.test(td.title))));  // hover detail
    await page.locator('#scoutGrid tbody th button', { hasText: 'Sam' }).click();
    assert.strictEqual(await page.inputValue('#sTeam'), '470.l.960265.t.2');
    assert.match(await page.textContent('.scout-sum'), /^Sam: A.* at RB/);
    assert.match(await page.textContent('#scoutNote'), /No projections/);
    const key = await page.textContent('#panel-scout .key');
    assert.ok(['Grade', 'A is well above average', 'C is about average', 'F is well below', 'Pts/wk', 'Rank', 'trade bait'].every(w => key.includes(w)), key);
    assert.ok(await page.$$eval('.scout td.num .avg', els => els.length === 7 && els.every(e => /^avg \d+\.\d$/.test(e.textContent))));
  });
  await check('matchmaker: partners from real rosters, two-way fits first, only listed players marked listed', async () => {
    await page.click('#scoutReport .scout-act button');  // Find trade partners, for Sam
    assert.ok(await page.isVisible('#panel-match'));
    assert.strictEqual(await page.inputValue('#mTeam'), '470.l.960265.t.2');
    await page.selectOption('#mTeam', '470.l.960265.t.1');
    const fits = await page.$$eval('#matches .match', els => els.map(e => ({ who: e.querySelector('h3').textContent, two: e.classList.contains('mutual'),
      listed: [...e.querySelectorAll('.chip.listed')].map(c => c.textContent),
      why: [...e.querySelectorAll('.why li')].map(li => li.textContent), offers: [...e.querySelectorAll('.offer')].map(o => o.textContent) })));
    assert.ok(fits.length >= 2);
    const firstOne = fits.findIndex(f => !f.two);
    assert.ok(firstOne === -1 || fits.slice(firstOne).every(f => !f.two));
    assert.strictEqual(fits[0].who, 'Sam');
    const why = fits[0].why;
    assert.match(why[0], /^You need an RB\. Sam has plenty: the (best|\d+(st|nd|rd|th)-best) RBs in the league/);
    assert.ok(why.some(t => /^Sam needs a WR\. You have plenty: the (best|\d+(st|nd|rd|th)-best) WRs in the league, while Sam’s are the league’s weakest\.$/.test(t)), JSON.stringify(why));
    assert.ok(why.some(t => /^Sam could also use a QB\. You have a spare one on the bench\.$/.test(t)), JSON.stringify(why));
    assert.match(fits[0].offers[0], /^Sam could offer.*Breece Hall \d+\.\d pts\/wk · On the block/);
    assert.match(fits[0].offers[1], /^You could offer.*Jared Goff \d+\.\d pts\/wk · (On the block|Bench)/);
    const txt = await page.textContent('#matches');
    assert.ok(!txt.includes(';') && !(await page.$('#matches .grade')), 'no semicolons or grade boxes');
    const listedNames = await page.evaluate(() => TradeApi.s.listings.map(l => l.name));
    fits.forEach(f => f.listed.forEach(c => assert.ok(listedNames.some(n => c.includes(n)), c)));
    assert.ok(fits[0].listed.some(c => c.includes('Breece Hall') && c.includes('On the block')));
    assert.match(await page.textContent('#matchNote'), /Only players marked “On the block” have been listed/);
  });
  await check('compare from the matchmaker opens the calculator with both sides picked', async () => {
    await page.locator('#matches .match').first().getByRole('button', { name: 'Compare in calculator' }).click();
    assert.ok(await page.isVisible('#panel-calc'));
    assert.strictEqual(await page.inputValue('#cTeamA'), '470.l.960265.t.1');
    assert.strictEqual(await page.inputValue('#cTeamB'), '470.l.960265.t.2');
    assert.strictEqual(await page.$$eval('#picksA input:checked', x => x.length), 1);
    assert.strictEqual(await page.$$eval('#picksB input:checked', x => x.length), 1);
    await page.waitForSelector('#calcOut .verdict');
  });
  await check('trade calculator gives a verdict from ratings, with the numbers behind it', async () => {
    for (const side of ['A', 'B']) for (const box of await page.$$('#picks' + side + ' input:checked')) await box.uncheck();
    assert.match(await page.textContent('#calcOut'), /Pick at least one player on each side/);
    await page.locator('#picksA label', { hasText: 'Jared Goff' }).locator('input').check();
    await page.locator('#picksB label', { hasText: 'Breece Hall' }).locator('input').check();
    assert.strictEqual(await page.textContent('#givesA'), 'Will gives');
    const rows = await page.$$eval('#calcOut tbody tr', trs => trs.map(t => [...t.children].map(c => c.textContent)));
    const goff = parseFloat(rows[0][5]), hall = parseFloat(rows[2][5]);
    const head = await page.textContent('.v-head'), line = await page.textContent('.verdict p:last-child');
    const pct = Math.abs(goff - hall) / Math.max(goff, hall);
    const expect = pct < 0.10 ? 'Fair trade' : (pct < 0.25 ? 'Leans toward ' : 'Lopsided toward ') + (hall > goff ? 'Will' : 'Sam');
    assert.strictEqual(head, expect);
    assert.ok(line.includes('Will receives ' + hall.toFixed(1)) && line.includes('Sam receives ' + goff.toFixed(1)), line);
    assert.match(await page.textContent('#calcOut'), /Fills a need: Will’s RBs grade D, so getting Breece Hall helps/);
    assert.ok(await page.getAttribute('.gauge', 'aria-label'));
    // two different teams only
    await page.selectOption('#cTeamB', '470.l.960265.t.1');
    assert.match(await page.textContent('#calcOut'), /Pick at least one player on each side|Pick two different teams/);
  });
  await check('compare on a listing card opens that player in the calculator', async () => {
    await page.click('#tab-block');
    await page.locator('#cards .card', { hasText: 'Brock Purdy' }).getByRole('button', { name: /Compare/ }).click();
    assert.ok(await page.isVisible('#panel-calc'));
    assert.strictEqual(await page.inputValue('#cTeamB'), '470.l.960265.t.3');
    assert.strictEqual(await page.inputValue('#cTeamA'), '470.l.960265.t.1');
    assert.deepStrictEqual(await page.$$eval('#picksB input:checked', x => x.map(i => i.closest('label').textContent)), [await page.$$eval('#picksB input:checked', x => x[0].closest('label').textContent)]);
    assert.match(await page.$eval('#picksB input:checked', x => x.closest('label').textContent), /Brock Purdy/);
  });
  await check('desktop has no sideways scroll and no script errors', async () => {
    for (const t of ['block', 'scout', 'match', 'calc']) { await page.click('#tab-' + t); await page.waitForTimeout(300); assert.ok(await noOverflow(page), t); }
    assert.deepStrictEqual(page.errors, []);
  });
  if (shots) {
    await page.click('#tab-block');
    await page.screenshot({ path: path.join(shots, 'desktop.png'), fullPage: true });
  }

  const phone = await open(browser, 360, 780);
  await check('360px: every tab fits without sideways scroll', async () => {
    for (const t of ['scout', 'match', 'calc', 'block']) { await phone.click('#tab-' + t); await phone.waitForTimeout(600); assert.ok(await noOverflow(phone), t); }
    assert.ok(await phone.isHidden('#editorPanel'));
    assert.ok(await phone.isVisible('#manageBtn'));
  });
  await check('360px: Manage My Block opens an accessible drawer', async () => {
    await phone.click('#manageBtn');
    assert.ok(await phone.isVisible('#editorPanel'));
    assert.strictEqual(await phone.getAttribute('#editorPanel', 'role'), 'dialog');
    assert.strictEqual(await phone.getAttribute('#manageBtn', 'aria-expanded'), 'true');
    assert.ok(await phone.evaluate(() => document.getElementById('editorPanel').contains(document.activeElement)));
    const box = await phone.$eval('#editorPanel', e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; });
    assert.ok(box[0] >= 0 && box[1] <= 360);
    await phone.keyboard.press('Escape');
    assert.ok(await phone.isHidden('#editorPanel'));
    assert.strictEqual(await phone.evaluate(() => document.activeElement.id), 'manageBtn');
  });
  await check('360px: sign in, edit from a card in the drawer, save', async () => {
    await phone.click('#account button');
    await phone.waitForSelector('#cards .card.mine');
    await phone.locator('#cards .card.mine').getByRole('button', { name: /Edit/ }).click();
    assert.ok(await phone.isVisible('#editorPanel'));
    await phone.waitForSelector('#editor .roster');
    assert.ok(await noOverflow(phone));
    await phone.fill('#tlNote', 'Phone edit');
    await phone.click('[data-k="save"]');
    await phone.waitForSelector('#editor .msg.ok');
    await phone.click('#drawerClose');
    assert.ok(await phone.isHidden('#editorPanel'));
    assert.match(await phone.locator('#cards .card.mine').textContent(), /Phone edit/);
    assert.ok(await noOverflow(phone));
    assert.deepStrictEqual(phone.errors, []);
  });
  const tp = await browser.newPage({ viewport: { width: 360, height: 780 } });
  tp.errors = [];
  tp.on('pageerror', e => tp.errors.push(e.message));
  await tp.route(/^https?:/, r => r.abort());
  await tp.goto('file://' + toolsFile, { waitUntil: 'domcontentloaded' });
  await check('tools page: its own page, Trade Lab has no Tools tab', async () => {
    assert.strictEqual(await tp.textContent('#heroTitle'), 'Tools');
    assert.strictEqual(await tp.textContent('.nav a.on'), 'Tools');
    assert.ok(await tp.isVisible('#toolNav .tool-b.on'));
    assert.strictEqual(await phone.$('#tab-tools'), null);
    assert.ok(await phone.isVisible('.nav a[href$="tools.html"]'));
  });
  await check('tools page: points against, sortable, season or last 4 weeks, fits a phone', async () => {
    await tp.waitForSelector('#paTable tbody tr');
    const rows = await tp.$$eval('#paTable tbody tr', trs => trs.map(t => [t.querySelector('th b').textContent, ...[...t.querySelectorAll('td')].map(td => parseFloat(td.textContent))]));
    assert.strictEqual(rows.length, 32);
    assert.ok(rows.every((r, i) => i === 0 || rows[i - 1][1] >= r[1]), 'sorted by QB, most allowed first');
    await tp.click('#paTable th button:has-text("RB")');
    const rb = await tp.$$eval('#paTable tbody tr td:nth-of-type(2)', tds => tds.map(td => parseFloat(td.textContent)));
    assert.ok(rb.every((v, i) => i === 0 || rb[i - 1] >= v), 'sorted by RB');
    assert.strictEqual(await tp.getAttribute('#paTable th[aria-sort="descending"] button', 'aria-label'), 'Sort by points allowed to RB');
    assert.ok(await tp.$$eval('#paTable td', tds => tds.every(td => /^pa-t[0-4]/.test(td.className) && / most\)$/.test(td.title))));
    await tp.click('#paTable tbody tr:first-child td:nth-of-type(2) button');  // RB column, top team
    await tp.waitForSelector('#detail:not([hidden]) .pa-games');
    assert.match(await tp.textContent('#detailTitle'), / defense vs RBs$/);
    assert.strictEqual(await tp.$$eval('.pa-games:not(.pa-next) > li', ls => ls.length), 3);  // weeks played
    assert.strictEqual(await tp.$$eval('.pa-next > li', ls => ls.length), 3);  // up next
    assert.match(await tp.textContent('.pa-games:not(.pa-next) > li:first-child'), /^Week 3 vs [A-Z]+.*pts.*RB1.*car/);
    assert.ok(await noOverflow(tp));
    await tp.click('#detailClose');
    // one position: full table with average stats, and a team's next 3 games
    await tp.click('#paPos button:has-text("QB")');
    await tp.waitForSelector('#paTable.pa-full tbody tr');
    assert.strictEqual(await tp.$$eval('#paTable.pa-full tbody tr', r => r.length), 32);
    const heads = await tp.$$eval('#paTable.pa-full thead th', ths => ths.map(t => t.textContent));
    assert.ok(heads[2] === 'Pts' && heads.includes('Pass Yds') && !heads.includes('Rec TD'), heads.join('|'));  // Pts first; no empty columns
    await tp.click('#paTable.pa-full tbody tr:first-child .pa-team');
    await tp.waitForSelector('#detail:not([hidden]) .pa-next');
    assert.match(await tp.textContent('#detailBody .pa-sub'), /1st most/);
    const nextRows = await tp.$$eval('.pa-next > li', ls => ls.map(l => l.textContent));
    assert.strictEqual(nextRows.length, 3, JSON.stringify(nextRows));
    assert.ok(nextRows.every(t => /^Week \d+( vs [A-Z]+UpcomingLikely: .*QB1|BYE)$/.test(t)), JSON.stringify(nextRows));
    await tp.click('#detailClose');
    await tp.click('#paPos button:has-text("All")');
    await tp.click('#paLast4');
    assert.strictEqual(await tp.getAttribute('#paLast4', 'aria-pressed'), 'true');
    assert.match(await tp.textContent('#paNote'), /last 4 games.*nflverse/);
    assert.ok(await noOverflow(tp));
    assert.deepStrictEqual(tp.errors, []);
  });
  if (shots) {
    await phone.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true });
    await phone.click('#manageBtn');
    await phone.screenshot({ path: path.join(shots, 'phone-drawer.png') });
  }

  await browser.close();
  console.log(`\n${passed} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
