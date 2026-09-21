'use strict';

// Public login visual QA. Local mode serves only checked-out assets; live mode blocks writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const pkg = require(path.join(root, 'package.json'));
const live = process.argv.includes('--live');
const base = live ? 'https://8223324090-production.up.railway.app' : 'https://login-fixture.test';
const out = path.join(root, 'output/playwright/login-signal', live ? 'live' : 'local');
fs.mkdirSync(out, { recursive: true });
const entry = process.env.PATH.split(path.delimiter).find(dir => /node_modules[\\/]\.bin$/i.test(dir) && fs.existsSync(path.join(path.dirname(dir), 'playwright')));
assert.ok(entry, 'Run through npm exec --package=playwright');
const { chromium } = require(path.join(path.dirname(entry), 'playwright'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = { live, version: pkg.version, scenarios: [], errors: [], blockedWrites: 0 };
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
      if (url.origin !== base) return route.abort();
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        report.blockedWrites++;
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{"success":false}' });
      }
      if (live) return route.continue();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"success":false}' });
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: file });
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    for (const [width, height] of [[1366, 900], [390, 844], [320, 640]]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.locator('#loginScreen').waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      const egg = page.locator('.login-signal');
      const bubble = page.locator('.login-signal-reply');
      await egg.waitFor();
      assert.match(await page.locator('.tagline').textContent(), new RegExp(pkg.version.replaceAll('.', '\\.')));
      await page.mouse.move(width - 1, height - 1);
      await page.screenshot({ path: path.join(out, `login-${width}-idle.png`) });
      const before = report.blockedWrites;
      await egg.hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.login-signal-reply')).opacity === '1');
      assert.notEqual(await egg.evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
      await page.screenshot({ path: path.join(out, `login-${width}-hover.png`) });
      await page.mouse.move(width - 1, height - 1);
      await page.locator('#username').focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await egg.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      assert.equal(report.blockedWrites, before, 'Easter egg must not submit login');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await egg.evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
      assert.equal(await bubble.evaluate(el => getComputedStyle(el).opacity), '1');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator('#password').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#password').isVisible(), true);
      report.scenarios.push({ width, height, hover: true, keyboard: true, reducedMotion: true, formReachable: true });
    }
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
