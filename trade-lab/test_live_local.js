// End-to-end browser test of the LIVE page against the real Trade Lab API
// code (trade_lab.py) with a fake Yahoo and memory storage - real cookies,
// CSRF and Origin checks. Needs Playwright + Chromium:
//   NODE_PATH=$(npm root -g) node trade-lab/test_live_local.js
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 8765, BASE = `http://localhost:${PORT}`;
let passed = 0;
async function check(name, fn) { await fn(); passed += 1; console.log('ok  ' + name); }

(async () => {
  const server = spawn('python3', [path.join(__dirname, 'live_local.py'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(res => server.stdout.once('data', res));
  const browser = await chromium.launch();
  try {
    async function managerPage(who) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addCookies([{ name: 'fake_who', value: who, url: BASE }]);
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', e => page.errors.push(e.message));
      await page.goto(BASE + '/trade-lab.html', { waitUntil: 'domcontentloaded' });
      return page;
    }
    const will = await managerPage('will');

    await check('live page shows no preview label and starts signed out', async () => {
      await will.waitForSelector('#account a');
      await will.waitForSelector('#cards li');
      assert.ok(await will.isHidden('#previewFlag'));
      assert.strictEqual(await will.getAttribute('#account a', 'href'), '/api/trade-lab/login');
      assert.match(await will.textContent('#cards'), /No one has put a player on the block yet/);
    });
    await check('Yahoo sign-in round trip sets a secure session and returns to the page', async () => {
      await will.click('#account a');
      await will.waitForURL(/trade-lab\.html$/);
      await will.waitForSelector('#editor .roster');
      assert.match(await will.textContent('#signinMsg'), /You’re signed in/);
      assert.match(await will.textContent('#account'), /Signed in as Will/);
      const cookies = await will.context().cookies(BASE);
      const s = cookies.find(c => c.name === '__Host-tl_session');
      assert.ok(s && s.httpOnly && s.secure && s.sameSite === 'Lax' && s.path === '/');
      assert.ok(!cookies.some(c => c.name === '__Host-tl_state'));  // single-use state cleared
      assert.strictEqual(await will.evaluate(() => document.cookie.includes('tl_session')), false);
      assert.strictEqual(await will.evaluate(() => { try { return localStorage.length; } catch (e) { return 0; } }), 0);
    });
    await check('saving a listing persists on the server', async () => {
      await will.check('[data-k="pick:470.p.1"]');
      await will.check('[data-k="want:RB"]');
      await will.fill('#tlNote', 'Looking for a <i>starter</i>');
      await will.click('[data-k="save"]');
      await will.waitForSelector('#editor .msg.ok');
      await will.reload({ waitUntil: 'domcontentloaded' });
      await will.waitForSelector('#cards .card.mine');
      assert.match(await will.textContent('#cards .card.mine'), /Amon-Ra St\. Brown/);
      assert.match(await will.textContent('#cards .card.mine .note'), /Looking for a <i>starter<\/i>/);
      // league positions come from Yahoo, without flex/bench slots
      await will.check('[data-k="pick:470.p.2"]');
      assert.deepStrictEqual(await will.$$eval('#editor [data-k^="want:"]', e => e.map(x => x.value)), ['QB', 'WR', 'RB', 'TE', 'K', 'DEF']);
      await will.uncheck('[data-k="pick:470.p.2"]');
    });
    const sam = await managerPage('sam');
    await check('another manager sees the listing but gets no edit controls', async () => {
      await sam.click('#account a');
      await sam.waitForSelector('#editor .roster');
      assert.match(await sam.textContent('#cards'), /Amon-Ra St\. Brown/);
      assert.strictEqual(await sam.$$eval('#cards .card.mine', c => c.length), 0);
      assert.strictEqual(await sam.$$eval('#cards button', b => b.filter(x => x.textContent === 'Edit').length), 0);
    });
    await check('the server refuses forged edits even from a signed-in manager', async () => {
      const r = await sam.evaluate(async () => {
        const csrf = TradeApi.csrf;
        const put = await fetch('/api/trade-lab/listings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ items: [{ player_key: '470.p.1', status: 'available', wants: [], note: 'mine now', version: 1 }] }) });
        const del = await fetch('/api/trade-lab/listings/470.p.1?version=1', { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
        const noCsrf = await fetch('/api/trade-lab/listings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ player_key: '470.p.3', status: 'available', wants: [], note: '', version: 0 }] }) });
        return [put.status, (await put.json()).error, del.status, (await del.json()).error, noCsrf.status];
      });
      assert.deepStrictEqual(r, [403, 'not_on_roster', 403, 'not_yours', 403]);
    });
    await check('outsider account can browse but not list', async () => {
      const out = await managerPage('outsider');
      await out.click('#account a');
      await out.waitForURL(/trade-lab\.html$/);
      await out.waitForSelector('#account .linkbtn');
      assert.match(await out.textContent('#signinMsg'), /doesn’t manage a team in this league/);
      assert.match(await out.textContent('#editor'), /browse but not list/);
      assert.match(await out.textContent('#cards'), /Amon-Ra/);
      await out.context().close();
    });
    await check('Yahoo outage: listings stay up, saving shows a retry message and keeps input', async () => {
      await will.reload({ waitUntil: 'domcontentloaded' });
      await will.waitForSelector('#editor .roster');
      await will.request.get(BASE + '/__clock?advance=300');  // cached rosters are now too old to write with
      await will.request.get(BASE + '/__yahoo?down=1');
      await will.check('[data-k="pick:470.p.2"]');
      await will.fill('#tlNote', 'keep me');
      await will.click('[data-k="save"]');
      await will.waitForSelector('#editor .msg.err');
      assert.match(await will.textContent('#editor .msg.err'), /Yahoo|try again/i);
      assert.strictEqual(await will.inputValue('#tlNote'), 'keep me');
      const n = await will.evaluate(async () => (await (await fetch('/api/trade-lab/listings')).json()).listings.length);
      assert.strictEqual(n, 1);
      await will.request.get(BASE + '/__yahoo?down=0');
      await will.click('[data-k="save"]');
      await will.waitForSelector('#editor .msg.ok');
      assert.match(await will.textContent('#cards'), /keep me/);
    });
    await check('removing and signing out work through the real API', async () => {
      await will.locator('#cards .card.mine', { hasText: 'Amon-Ra' }).getByRole('button', { name: /Edit/ }).click();
      await will.click('[data-k="remove"]');
      await will.click('[data-k="remove"]');
      await will.waitForSelector('#editor .msg.ok');
      assert.match(await will.textContent('#cards'), /Jared Goff/);
      assert.doesNotMatch(await will.textContent('#cards'), /Amon-Ra/);
      await will.click('#account .linkbtn');
      await will.waitForSelector('#account a');
      assert.ok(!(await will.context().cookies(BASE)).some(c => c.name === '__Host-tl_session'));
      assert.deepStrictEqual(will.errors, []);
      assert.deepStrictEqual(sam.errors, []);
    });
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${passed} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
