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
    assert.strictEqual(await page.getAttribute('#tab-match', 'aria-selected'), 'true');
    assert.ok(await page.isVisible('#panel-match'));
    assert.ok(await page.isHidden('#panel-block'));
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'tab-match');
    await page.keyboard.press('End');
    assert.ok(await page.isVisible('#panel-calc'));
    await page.keyboard.press('ArrowRight');
    assert.ok(await page.isVisible('#panel-block'));
  });
  await check('matchmaker shows mutual matches first, from listings only', async () => {
    await page.click('#tab-match');
    assert.strictEqual(await page.inputValue('#mTeam'), '470.l.960265.t.1');
    const m = await page.$$eval('#matches .match', els => els.map(e => [e.querySelector('h3').textContent, e.classList.contains('mutual')]));
    // Will now wants WR (Goff and Hurts). Chet listed Tee Higgins (WR) and wants RB/WR; Will has no RB/WR listed now.
    assert.ok(m.length > 0);
    const firstOneWay = m.findIndex(x => !x[1]);
    assert.ok(firstOneWay === -1 || m.slice(firstOneWay).every(x => !x[1]));
    await page.selectOption('#mTeam', '470.l.960265.t.2');
    const sam = await page.$$eval('#matches .match', els => els.map(e => e.textContent));
    assert.ok(sam.every(t => !t.includes('You’re looking for')));
  });
  await check('trade calculator compares recorded scores, no projections', async () => {
    await page.click('#tab-calc');
    await page.waitForSelector('#picksA label');
    assert.match(await page.textContent('#calcOut'), /Pick at least one player on each side/);
    assert.match(await page.textContent('#calcSource'), /weeks 1–3/);
    await page.locator('#picksA label', { hasText: 'Jared Goff' }).locator('input').check();
    await page.locator('#picksB label', { hasText: 'Breece Hall' }).locator('input').check();
    const rows = await page.$$eval('#calcOut tbody tr', trs => trs.map(t => [...t.children].map(c => c.textContent)));
    assert.deepStrictEqual(rows[0].slice(1), ['3', '87.9', '29.3', '29.3']);
    assert.deepStrictEqual(rows[2].slice(1), ['3', '63.1', '21.0', '21.0']);
    assert.match(await page.textContent('#calcOut'), /Side A’s players have averaged 8\.3 more/);
    // A player with no recorded weeks is shown as such, not as zero.
    await page.locator('#picksB label', { hasText: 'Matthew Stafford' }).locator('input').check();
    const staff = await page.$$eval('#calcOut tbody tr', trs => trs.map(t => [...t.children].map(c => c.textContent)).find(r => r[0].startsWith('Matthew')));
    assert.deepStrictEqual(staff.slice(1), ['0', '—', '—', '—']);
    assert.match(await page.textContent('#calcOut'), /Side B: 1 player has no scored weeks/);
    assert.ok(!/projection/i.test(await page.textContent('#calcOut')));
  });
  await check('desktop has no sideways scroll and no script errors', async () => {
    for (const t of ['block', 'match', 'calc']) { await page.click('#tab-' + t); assert.ok(await noOverflow(page), t); }
    assert.deepStrictEqual(page.errors, []);
  });
  if (shots) {
    await page.click('#tab-block');
    await page.screenshot({ path: path.join(shots, 'desktop.png'), fullPage: true });
  }

  const phone = await open(browser, 360, 780);
  await check('360px: every tab fits without sideways scroll', async () => {
    for (const t of ['match', 'calc', 'block']) { await phone.click('#tab-' + t); assert.ok(await noOverflow(phone), t); }
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
  if (shots) {
    await phone.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true });
    await phone.click('#manageBtn');
    await phone.screenshot({ path: path.join(shots, 'phone-drawer.png') });
  }

  await browser.close();
  console.log(`\n${passed} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
