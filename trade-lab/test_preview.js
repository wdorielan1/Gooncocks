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
    const rows = await page.$$eval('#calcOut tbody tr.p-main', trs => trs.map(t => [...t.children].map(c => c.textContent)));
    const goff = parseFloat(rows[0][5]), hall = parseFloat(rows[1][5]);
    const head = await page.textContent('.v-head'), line = await page.textContent('.verdict p:last-child');
    const pct = Math.abs(goff - hall) / Math.max(goff, hall);
    const expect = pct < 0.10 ? 'Fair trade' : (pct < 0.25 ? 'Leans toward ' : 'Lopsided toward ') + (hall > goff ? 'Will' : 'Sam');
    assert.strictEqual(head, expect);
    assert.ok(line.includes('Will receives ' + hall.toFixed(1)) && line.includes('Sam receives ' + goff.toFixed(1)), line);
    assert.match(await page.textContent('#calcOut'), /Fills a need: Will’s RBs grade D, so getting Breece Hall helps/);
    assert.ok(await page.getAttribute('.donut', 'aria-label'));
    // donut: Will's (blue) slice is his share of the points changing hands; the winner and edge in the middle
    const slice = parseFloat(/var\(--blue\) 0 ([\d.]+)%/.exec(await page.getAttribute('.donut', 'style'))[1]);
    assert.ok(Math.abs(slice - hall / (hall + goff) * 100) < 0.5, slice);
    assert.strictEqual(await page.textContent('.donut-who'), expect === 'Fair trade' ? 'Fair' : expect.split(' ').pop());
    // each player: an injury tag when hurt, every week's points, and the next 4 matchups
    assert.match(rows[1][0], /Breece Hall.*Q · Hamstring/);
    const more = await page.$$eval('#calcOut tr.p-more', trs => trs.map(t => [...t.querySelectorAll('.strip')].map(s => s.querySelector('.strip-lab').textContent + ':' + s.querySelectorAll('li').length)));
    assert.deepStrictEqual(more, [['Weekly:4', 'Next 4:5'], ['Weekly:4', 'Next 4:5']]);  // 4 games + the total
    assert.match(await page.textContent('#calcOut tr.p-more .wk-list'), /^W1[\d.–]+.*W4[\d.]+\*$/);  // week 4 in progress is marked
    // next 4: each game's projection (rating scaled by the matchup, within 30%; 0 on a bye) and their total
    const nx = await page.$$eval('#calcOut tr.p-more', trs => trs.map(t => {
      const strips = t.querySelectorAll('.strip'), lis = [...strips[1].querySelectorAll('li.nx')];
      return { proj: lis.map(l => parseFloat(l.querySelector('.nx-proj').textContent)), bye: lis.map(l => l.classList.contains('bye')),
               total: parseFloat(strips[1].querySelector('.nx-total b').textContent), n: lis.length };
    }));
    [goff, hall].forEach((rating, k) => nx[k].proj.forEach((v, j) => assert.ok(nx[k].bye[j] ? v === 0 : v >= rating * 0.7 - 0.06 && v <= rating * 1.3 + 0.06, JSON.stringify(nx))));
    assert.ok(nx.every(x => Math.abs(x.total - x.proj.reduce((a, b) => a + b, 0)) < 0.25), JSON.stringify(nx));
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
  await check('tools page: points against, one position at a time, easiest first, fits a phone', async () => {
    await tp.waitForSelector('#paTable tbody tr');
    // opens on RBs: no "All" grid, just the position tabs
    assert.deepStrictEqual(await tp.$$eval('#paPos button', bs => bs.map(b => b.textContent)), ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    assert.strictEqual(await tp.getAttribute('#paPos button:has-text("RB")', 'aria-pressed'), 'true');
    const heads = await tp.$$eval('#paTable thead th', ths => ths.map(t => t.textContent));
    assert.deepStrictEqual(heads, ['#', 'Defense', 'Pts / game', 'Wk 4 vs'], heads.join('|'));  // stats hidden by default
    const rows = await tp.$$eval('#paTable tbody tr', trs => trs.map(t => [t.querySelector('.pa-rank').textContent, parseFloat(t.querySelector('.pa-pts').textContent), t.querySelector('.pa-next-opp').textContent]));
    assert.strictEqual(rows.length, 32);
    assert.ok(rows.every((r, i) => r[0] === String(i + 1) && (i === 0 || rows[i - 1][1] >= r[1])), 'ranked, most allowed first');
    assert.ok(rows.every(r => /^([A-Z]{2,3}|BYE)$/.test(r[2])), JSON.stringify(rows.map(r => r[2])));
    assert.ok(await tp.$$eval('#paTable td.pa-pts', tds => tds.every(td => /pa-t[0-4]/.test(td.className))));
    assert.ok(await noOverflow(tp));
    await tp.click('#paTable tbody tr:first-child .pa-pts button');
    await tp.waitForSelector('#detail:not([hidden]) .pa-games');
    assert.match(await tp.textContent('#detailTitle'), / defense vs RBs$/);
    assert.match(await tp.textContent('#detailBody .pa-sub'), /1st most/);
    assert.strictEqual(await tp.$$eval('.pa-games:not(.pa-next) > li', ls => ls.length), 3);  // weeks played
    assert.strictEqual(await tp.$$eval('.pa-next > li', ls => ls.length), 3);  // up next
    assert.match(await tp.textContent('.pa-games:not(.pa-next) > li:first-child'), /^Week 3 vs [A-Z]+.*pts.*RB1.*car/);
    assert.ok(await noOverflow(tp));
    await tp.click('#detailClose');
    // another position, with its stats shown on request
    await tp.click('#paPos button:has-text("QB")');
    await tp.click('#paStats');
    assert.strictEqual(await tp.textContent('#paStats'), 'Hide stats');
    const qHeads = await tp.$$eval('#paTable thead th', ths => ths.map(t => t.textContent));
    assert.ok(qHeads[2] === 'Pts / game' && qHeads.includes('Pass Yds') && !qHeads.includes('Rec TD'), qHeads.join('|'));  // no empty columns
    await tp.click('#paTable tbody tr:first-child .pa-team');
    await tp.waitForSelector('#detail:not([hidden]) .pa-next');
    const nextRows = await tp.$$eval('.pa-next > li', ls => ls.map(l => l.textContent));
    assert.strictEqual(nextRows.length, 3, JSON.stringify(nextRows));
    assert.ok(nextRows.every(t => /^Week \d+( vs [A-Z]+UpcomingLikely: .*QB1|BYE)$/.test(t)), JSON.stringify(nextRows));
    await tp.click('#detailClose');
    await tp.click('#paStats');
    assert.strictEqual(await tp.$$eval('#paTable thead th', ths => ths.length), 4);
    // signed out: the table as is, plus a sign-in prompt; signed in: your players
    await tp.click('#paPos button:has-text("RB")');
    assert.match(await tp.textContent('#paMe'), /Sign in to see where your players land/);
    assert.strictEqual(await tp.$$eval('.pa-mine-chip', e => e.length), 0);
    await tp.click('#paMe button:has-text("Sign in")');
    await tp.waitForSelector('.pa-mine-list li');
    assert.match(await tp.textContent('.pa-mine h4'), /^Your RBs · Week 4$/);
    const mine = await tp.$$eval('.pa-mine-list li', ls => ls.map(l => [parseInt(l.querySelector('.pa-mine-rank').textContent.slice(1)), l.querySelector('b').textContent, l.querySelector('.pa-mine-sub').textContent]));
    assert.ok(mine.length >= 1 && mine.every((m, i) => i === 0 || mine[i - 1][0] <= m[0]), JSON.stringify(mine));  // best matchup first
    // each player's opponent row in the table is marked with his name, at the same rank
    for (const [rank, name, sub] of mine) {
      const opp = sub.split(' vs ')[1];
      const row = await tp.$eval('#paTable tbody tr:nth-child(' + rank + ')', t => [t.querySelector('th b').textContent, t.querySelector('.pa-mine-chip').textContent]);
      assert.ok(row[0] === opp && row[1].includes(name), JSON.stringify([rank, name, sub, row]));
    }
    await tp.click('#paPos button:has-text("QB")');
    assert.match(await tp.textContent('.pa-mine h4'), /^Your QBs/);
    assert.ok(await noOverflow(tp));
    await tp.click('.pa-mine .linkbtn:has-text("Sign out")');
    await tp.waitForSelector('.pa-me-in');
    assert.strictEqual(await tp.$$eval('.pa-mine-chip', e => e.length), 0);
    await tp.click('#paLast4');
    assert.strictEqual(await tp.getAttribute('#paLast4', 'aria-pressed'), 'true');
    assert.match(await tp.textContent('#paNote'), /last 4 games.*nflverse/);
    assert.ok(await noOverflow(tp));
    assert.deepStrictEqual(tp.errors, []);
  });
  await check('tools page: waiver wire report, best available and a team review when signed in', async () => {
    const wp = await browser.newPage({ viewport: { width: 360, height: 780 } });
    wp.errors = [];
    wp.on('pageerror', e => wp.errors.push(e.message));
    await wp.route(/^https?:/, r => r.abort());
    await wp.goto('file://' + toolsFile, { waitUntil: 'domcontentloaded' });
    await wp.click('#toolNav .tool-b[data-tool="ww"]');
    await wp.waitForSelector('#wwTable tbody tr');
    assert.ok(await wp.isHidden('#tool-pa'));
    assert.strictEqual(await wp.getAttribute('#toolNav .tool-b[data-tool="ww"]', 'aria-pressed'), 'true');
    const rows = await wp.$$eval('#wwTable tbody tr', trs => trs.map(t => [t.querySelector('.ww-name').textContent, parseFloat(t.querySelector('.ww-pts').textContent), t.textContent]));
    // tapping a player shows every week's points; tapping again hides them
    await wp.click('#wwTable .ww-name >> nth=0');
    assert.strictEqual(await wp.getAttribute('#wwTable .ww-name >> nth=0', 'aria-expanded'), 'true');
    assert.match(await wp.textContent('#wwTable .ww-weeks-row'), /^W1[\d.–]+W2[\d.–]+W3[\d.–]+$/);
    await wp.click('#wwTable .ww-name >> nth=0');
    assert.strictEqual(await wp.$('#wwTable .ww-weeks-row'), null);
    assert.ok(rows.length >= 3 && rows.every((r, i) => i === 0 || rows[i - 1][1] >= r[1]), JSON.stringify(rows));  // best last 4 first
    assert.ok(rows.some(r => r[0] === 'Tyrone Tracy Jr.' && /Claim/.test(r[2])), 'waiver players are marked; Jr. names match');
    assert.ok(rows.every(r => /(NO|[A-Z]{2,3}) ?#\d+|BYE/.test(r[2])), 'each has a next matchup');
    // this week's projection: last 4 scaled by the matchup (within 30%), sortable
    await wp.click('#wwSort button:has-text("Wk 4 proj")');
    const proj = await wp.$$eval('#wwTable tbody tr', trs => trs.map(t => [parseFloat(t.querySelector('td:nth-of-type(2)').textContent), parseFloat(t.querySelector('.ww-proj').textContent)]));
    assert.ok(proj.every((r, i) => (i === 0 || proj[i - 1][1] >= r[1]) && r[1] >= r[0] * 0.7 - 0.06 && r[1] <= r[0] * 1.3 + 0.06), JSON.stringify(proj));
    assert.match(await wp.textContent('#wwNote'), /Wk 4 proj is our estimate/);
    await wp.click('#wwSort button:has-text("Last 4")');
    await wp.click('#wwPos button:has-text("WR")');
    assert.match(await wp.textContent('#wwTable'), /Jauan Jennings.*Q · Calf/);
    assert.match(await wp.textContent('#wwNote'), /1 player with no NFL stats yet isn’t shown/);
    await wp.click('#wwPos button:has-text("DEF")');
    assert.match(await wp.textContent('#wwTable'), /Denver/);
    // signed out: a sign-in prompt, no review; signed in: ranks and pickups only where weak
    assert.match(await wp.textContent('#wwMe'), /Sign in to see where your lineup is weak/);
    await wp.click('#wwMe button:has-text("Sign in")');
    await wp.waitForSelector('.ww-review .ww-ranks');
    const ranks = await wp.$$eval('.ww-rk', e => e.map(x => [x.textContent, x.className]));
    assert.deepStrictEqual(ranks.map(r => r[0].split(' ')[0]), ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    const weak = await wp.$$eval('.ww-weak', ws => ws.map(w => [w.querySelector('.ww-weak-h').textContent, w.querySelector('.ww-weak-s').textContent,
      [...w.querySelectorAll('.ww-picks > li')].map(li => li.textContent)]));
    assert.ok(weak.length >= 1 && weak.length === ranks.filter(r => /t2/.test(r[1])).length, JSON.stringify([ranks, weak]));
    for (const [head, starter, picks] of weak) {
      assert.match(head, /^(QB|RB|WR|TE|K|DEF) · \d+(st|nd|rd|th) of 6 in the league$/);
      const floor = parseFloat(/, ([\d.]+) pts\/game/.exec(starter)[1]);
      assert.ok(picks.every(t => parseFloat(/ · ([\d.]+) last 4/.exec(t)[1]) >= floor + 1), JSON.stringify([starter, picks]));  // only real upgrades
    }
    assert.match(await wp.textContent('.ww-review'), /TE · 5th of 6.*Jake Ferguson/);
    assert.match(await wp.textContent('.ww-picks li'), /W1[\d.–]+W2[\d.–]+W3[\d.–]+/);  // pickups show their weeks
    // tapping a rank shows who's behind it
    await wp.click('.ww-rk:has-text("TE")');
    assert.strictEqual(await wp.getAttribute('.ww-rk:has-text("TE")', 'aria-expanded'), 'true');
    assert.match(await wp.textContent('#wwRkPanel'), /Your TE · 5th of 6.*Dallas Goedert.*pts\/g.*You: [\d.]+ · League average: [\d.]+ · Best: \w+ [\d.]+ \(/);
    await wp.click('.ww-rk:has-text("WR")');
    assert.match(await wp.textContent('#wwRkPanel'), /Your WRs · 2nd of 6 \(3 starters, added up\)/);
    assert.strictEqual(await wp.$$eval('#wwRkPanel .ww-rkp-list li', l => l.length), 3);
    await wp.click('.ww-rk:has-text("WR")');
    assert.strictEqual(await wp.$('#wwRkPanel'), null);
    assert.ok(await noOverflow(wp));
    await wp.click('.ww-review .linkbtn:has-text("Sign out")');
    await wp.waitForSelector('#wwMe .pa-me-in');
    assert.deepStrictEqual(wp.errors, []);
    await wp.close();
  });
  await check('tools page: injury report, out vs game-time vs coming back, with your team', async () => {
    const ip = await browser.newPage({ viewport: { width: 360, height: 780 } });
    ip.errors = [];
    ip.on('pageerror', e => ip.errors.push(e.message));
    await ip.route(/^https?:/, r => r.abort());
    await ip.goto('file://' + toolsFile + '#injuries', { waitUntil: 'domcontentloaded' });
    await ip.waitForSelector('.ir-sec.back');
    assert.ok(await ip.isHidden('#tool-pa') && await ip.isHidden('#tool-ww'));
    const sec = async () => ip.$$eval('.ir-sec', ss => ss.map(x => [x.querySelector('.ir-h').firstChild.textContent.trim(),
      [...x.querySelectorAll('.ir-row')].map(r => (r.querySelector('.ir-code') || r.querySelector('.ir-chip')).textContent + ' ' + r.querySelector('b').textContent)]));
    let got = await sec();
    assert.deepStrictEqual(got.map(g => g[0]), ['Out', 'Game-time decisions', 'Coming back']);
    assert.ok(got[0][1].every(t => /^(O|IR) /.test(t)) && got[1][1].every(t => /^(D|Q) /.test(t)), JSON.stringify(got));
    assert.ok(/^D /.test(got[1][1][0]), 'doubtful before questionable');
    // game-time decisions show their kickoff (Eastern) in the box; out players don't
    const kicks = await ip.$$eval('.ir-sec.gtd .ir-chip', cs => cs.map(c => [...c.querySelectorAll('.ir-kick')].map(k => k.textContent)));
    assert.ok(kicks.length && kicks.every(k => k.length === 2 && /^(Sun|Mon|Thu)$/.test(k[0]) && /^\d{1,2}:\d\d (AM|PM)$/.test(k[1])), JSON.stringify(kicks));
    assert.strictEqual(await ip.$$eval('.ir-sec.out .ir-kick', e => e.length), 0);
    assert.match(await ip.textContent('.ir-sec.gtd .ir-kickoff'), /^Kickoff (Sun|Mon|Thu) \d{1,2}:\d\d (AM|PM) ET vs [A-Z]{2,3}$/);
    assert.strictEqual(await ip.$$eval('.ir-sec.out .ir-kickoff', e => e.length), 0);
    assert.match(await ip.textContent('.ir-sec.back'), /IR → Q/);
    assert.match(await ip.textContent('.ir-sec.back'), /O → Active/);
    assert.match(await ip.getAttribute('.ir-news', 'href'), /^https:\/\/sports\.yahoo\.com\/nfl\/players\/\d+\/news\/$/);
    // by position: each tab shows its count and only that position
    const tabs = await ip.$$eval('#irPos button', bs => bs.map(b => b.textContent));
    assert.deepStrictEqual(tabs.map(t => t.replace(/\d+$/, '')), ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    await ip.click('#irPos button:has-text("WR")');
    const wrs = await ip.$$eval('.ir-row .ir-pos', e => e.map(x => x.textContent.trim().split(' ')[0]));
    assert.ok(wrs.length && wrs.every(p => p === 'WR'), JSON.stringify(wrs));
    assert.strictEqual(String(wrs.length), /\d+$/.exec(tabs[3])[0]);
    await ip.click('#irPos button:has-text("QB")');
    assert.match(await ip.textContent('.ir-sec.out'), /Nobody’s out at QB\./);
    await ip.click('#irPos button:has-text("All")');
    await ip.click('#irFilter button:has-text("Starters only")');
    assert.ok(!/Javonte Williams/.test(await ip.textContent('#irBody')), 'IR-spot players are not starters');
    assert.strictEqual(await ip.$('#irFilter button:has-text("My team")'), null);
    await ip.click('#irMe button:has-text("Sign in")');
    await ip.waitForSelector('.ir-mine');
    assert.strictEqual(await ip.textContent('.ir-mine'), 'Your team: 1 game-time decision.');
    await ip.click('#irFilter button:has-text("My team")');
    got = await sec();
    assert.deepStrictEqual(got.map(g => g[1].length), [0, 1, 0]);
    assert.match(await ip.textContent('.ir-row.mine'), /★ Will/);
    assert.ok(await noOverflow(ip));
    assert.deepStrictEqual(ip.errors, []);
    await ip.close();
  });
  await check('tools page: transaction report, adds/drops/trades with filters', async () => {
    const xp = await browser.newPage({ viewport: { width: 360, height: 780 } });
    xp.errors = [];
    xp.on('pageerror', e => xp.errors.push(e.message));
    await xp.route(/^https?:/, r => r.abort());
    await xp.goto('file://' + toolsFile + '#transactions', { waitUntil: 'domcontentloaded' });
    await xp.waitForSelector('.tx-card');
    const cards = async () => xp.$$eval('.tx-card', cs => cs.map(c => c.querySelector('.tx-kind').textContent + ' ' + c.querySelector('.tx-head b').textContent));
    assert.deepStrictEqual(await cards(), ['Add/Drop Will', 'Add Gabe', 'Trade Sam ⇄ Chet', 'Add/Drop Chris', 'Drop Patrick', 'Add/Drop Will']);  // newest first
    assert.match(await xp.textContent('.tx-card >> nth=0'), /\+Jake Ferguson TE · DALClaim \$14.*−Tyjae Spears/);
    assert.match(await xp.textContent('.tx-card >> nth=1'), /Ray Davis RB · BUFFree agent/);
    assert.match(await xp.textContent('.tx-card.trade'), /Sam gets\+Zack Moss.*Chet gets\+Jaylen Waddle/);
    assert.match(await xp.textContent('.tx-card >> nth=5'), /Jaylen Warren.*[\d.]+ pts\/g since · \d game/);  // how a pickup has done since
    assert.match(await xp.textContent('.tx-active'), /Most activeWill 2/);
    await xp.click('#txType button:has-text("Trades")');
    assert.deepStrictEqual(await cards(), ['Trade Sam ⇄ Chet']);
    await xp.click('#txType button:has-text("All")');
    await xp.selectOption('#txWho', { label: 'Will' });
    assert.deepStrictEqual(await cards(), ['Add/Drop Will', 'Add/Drop Will']);
    await xp.click('.tx-chip:has-text("Will")');  // tapping again clears it
    assert.strictEqual((await cards()).length, 6);
    assert.ok(await noOverflow(xp));
    assert.deepStrictEqual(xp.errors, []);
    await xp.close();
  });
  if (shots) {
    await phone.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true });
    await phone.click('#manageBtn');
    await phone.screenshot({ path: path.join(shots, 'phone-drawer.png') });
  }

  await browser.close();
  console.log(`\n${passed} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
