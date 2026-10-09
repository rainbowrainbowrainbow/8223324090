'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { ROOT, OUT, DB, hash, inventory } = require('../../scripts/lib/education-close-device');
const { preflight } = require('../../scripts/lib/education-ready-dataset');
const preview = JSON.parse(fs.readFileSync(path.join(OUT, 'preview.json')));
assert.equal(preview.database, DB); assert.equal(preview.status, 'ACTIVE'); assert.equal(preview.lanHost, null);
const base = 'http://127.0.0.1:3015';
const evidence = { classification: 'DESKTOP_LOOPBACK_PREFLIGHT_NOT_PHYSICAL', attemptId: preview.attemptId, ...inventory(ROOT), checks: [], pageErrors: [], screenshots: [] };
const dataset = JSON.parse(fs.readFileSync(path.join(OUT, 'dataset.json')));
const pool = new Pool({ host: '127.0.0.1', port: 55469, user: 'postgres', database: DB, ssl: false });
let browser;
async function check(id, action) { try { const detail = await action(); evidence.checks.push({ id, status: 'PASS', detail }); } catch (error) { evidence.checks.push({ id, status: 'FAIL', error: error.message }); process.exitCode = 1; } }
(async () => {
    await check('independent-owned-SQL-fixture', () => preflight(pool, dataset));
    await check('anonymous-education-denied', async () => assert.equal((await fetch(base + '/api/education/groups?businessContext=dar')).status, 401));
    const playwright = require(process.env.EDU_QA_PLAYWRIGHT); browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => evidence.pageErrors.push(error.name));
    await check('unchanged-visible-login-five-tabs', async () => {
        await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('#username').fill(process.env.LIVE_CREATOR_USER);
        await page.locator('#password').fill(process.env.LIVE_CREATOR_PASS); await page.locator('#loginForm button[type="submit"]').click();
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
        await page.goto(preview.url, { waitUntil: 'domcontentloaded' });
        for (const view of ['today', 'schedule', 'groups', 'attendance', 'reports']) {
            const reportResponse = view === 'reports' ? page.waitForResponse(response => new URL(response.url()).pathname === '/api/education/reports' && response.request().method() === 'GET') : null;
            await page.locator(`[data-education-schedule-tab="${view}"]`).click();
            await page.waitForFunction(view => window.EducationScheduleWorkspace?.state.activeView === view && !window.EducationScheduleWorkspace?.state.loading, view);
            if (view === 'today') await page.locator(`[data-education-booking-id="${dataset.ids.bookings['robots-4']}"]`).waitFor({ state: 'visible' });
            if (view === 'schedule') await page.locator('.timeline-container').waitFor({ state: 'visible' });
            if (view === 'groups') await page.locator(`#educationGroupsList option[value="${dataset.ids.groups.robots}"]`).waitFor({ state: 'attached' });
            if (view === 'groups') await page.waitForFunction(() => window.EducationGroups?.state.teacherStatus === 'ready' && window.EducationGroups?.state.listStatus === 'ready');
            if (view === 'attendance') await page.waitForFunction(() => !window.EducationAttendance?.state.loading && document.getElementById('educationAttendanceLesson').options.length === 5);
            if (view === 'reports') {
                assert.equal((await reportResponse).status(), 200);
                await page.locator('.education-report-summary').waitFor({ state: 'visible' });
                await page.waitForFunction(() => !window.EducationAttendance?.state.reportLoading);
            }
            assert.equal(await page.locator(`[data-education-schedule-tab="${view}"]`).getAttribute('aria-pressed'), 'true');
            await page.mouse.move(1430, 990);
            await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.querySelectorAll('.education-schedule-tab')].flatMap(node => node.getAnimations()).filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
            const file = 'technical-' + view + '.png'; await page.screenshot({ path: path.join(OUT, file) });
            evidence.screenshots.push({ path: file, sha256: hash(path.join(OUT, file)) });
        }
        assert.deepEqual(evidence.pageErrors, []); return { visibleViews: 5, actualPhysicalDevice: false };
    });
    await context.close();
})().catch(error => { evidence.checks.push({ id: 'preflight-fatal', status: 'FAIL', error: error.name }); process.exitCode = 1; }).finally(async () => {
    if (browser) await browser.close(); await pool.end(); evidence.exitCode = process.exitCode || 0;
    fs.writeFileSync(path.join(OUT, 'technical-verification.json'), JSON.stringify(evidence, null, 2));
    console.log(evidence.checks.map(row => row.status + ' ' + row.id + (row.error ? ' ' + row.error : '')).join('\n'));
});
