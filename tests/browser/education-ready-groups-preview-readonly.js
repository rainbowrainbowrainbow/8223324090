'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const { DATABASES, OWNER_KEY, preflight } = require('../../scripts/lib/education-ready-dataset');
const base = 'http://127.0.0.1:3012';
const out = path.resolve('output/education-ready/03/preview-readonly'); fs.mkdirSync(out, { recursive: true });
const evidence = { boundary: 'Retained synthetic preview; all non-auth writes blocked at request interception', status: 'NOT RUN', blockedWrites: [], screenshots: [] };
const pool = new Pool({ host: '127.0.0.1', port: 55469, database: DATABASES.demo, user: 'postgres', ssl: false });
let browser;
async function proof() {
    const manifest = JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value);
    return { hash: manifest.hash, anchorDate: manifest.anchorDate, preflight: await preflight(pool, manifest) };
}
(async () => {
    assert.ok(process.env.LIVE_CREATOR_USER && process.env.LIVE_CREATOR_PASS, 'Private credentials unavailable');
    const before = await proof();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== base) return route.abort();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'].includes(url.pathname)) {
            evidence.blockedWrites.push({ path: url.pathname, method: req.method() });
            return route.fulfill({ status: 403, json: { error: 'Read-only preview verification boundary' } });
        }
        return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill(process.env.LIVE_CREATOR_USER); await page.locator('#password').fill(process.env.LIVE_CREATOR_PASS);
    await page.locator('#loginForm button[type="submit"]').click(); await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    await page.goto(`${base}/?businessContext=dar&educationSchedule=groups&date=${before.anchorDate}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.EducationGroups?.state.teacherStatus === 'ready' && window.EducationGroups.state.groups.length === 6);
    const names = await page.locator('#educationGroupTeacher option').allTextContents();
    assert.deepEqual(names.slice(1).sort(), ['Олена Ковальчук', 'Максим Левченко', 'Ірина Бондар', 'Софія Мельник'].sort());
    const manifest = JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value);
    await page.locator('#educationGroupsList').selectOption(String(manifest.ids.groups.english));
    await page.waitForFunction(id => String(window.EducationGroups.state.current?.id) === String(id), manifest.ids.groups.english);
    assert.equal(await page.locator('#educationGroupTeacher').inputValue(), String(manifest.ids.teachers[0]));
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(() => document.fonts.ready);
        assert.ok(!(await page.locator('body').innerText()).includes(process.env.LIVE_CREATOR_USER));
        const file = `groups-${width}.png`; await page.screenshot({ path: path.join(out, file) }); evidence.screenshots.push(file);
    }
    await context.close(); const after = await proof(); assert.deepEqual(after, before);
    evidence.status = 'PASS'; evidence.teacherCount = names.length - 1; evidence.retainedDatasetUnchanged = true; evidence.preflight = after.preflight;
})().catch(error => { evidence.status = 'FAIL'; evidence.error = error.message; process.exitCode = 1; })
    .finally(async () => { if (browser) await browser.close(); await pool.end(); fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(evidence, null, 2)); console.log(`Read-only preview ${evidence.status}; business writes blocked before sending`); });
