'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const base = 'https://8223324090-production.up.railway.app';
const out = path.resolve(process.env.EDU_READY_LIVE_OUTPUT || 'output/education-ready/2026-10-03/live-readonly.json');
const result = { policy: 'All business writes intercepted before login; auth login/refresh/verify only; no PII screenshots or response bodies',
    startedAt: new Date().toISOString(), requests: [], blockedWrites: [], snapshots: [], pageErrors: [] };
let browser, stage = 'before-login';
const pending = new Set();
async function main() {
    const version = await fetch(base + '/api/version');
    const identity = await version.json();
    result.identity = { version: identity.version, commitSha: identity.commitSha, sourceBranch: identity.sourceBranch };
    const username = process.env.LIVE_CREATOR_USER || process.env.LIVE_SMOKE_USER;
    const password = process.env.LIVE_CREATOR_PASS || process.env.LIVE_SMOKE_PASS;
    if (!username || !password) { result.status = 'BLOCKED_CREDENTIALS'; process.exitCode = 1; return; }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== base) return route.abort('blockedbyclient');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !/^\/api\/auth\/(login|refresh|verify)$/.test(url.pathname)) {
            result.blockedWrites.push({ stage, method: request.method(), path: url.pathname });
            return route.abort('blockedbyclient');
        }
        return route.continue();
    });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => result.pageErrors.push({ stage, type: error.name }));
    page.on('response', response => {
        const request = response.request(), url = new URL(response.url());
        if (!/^\/api\/(education|staff|auth\/login|business\/cabinet|business\/profile)/.test(url.pathname)) return;
        result.requests.push({ stage, method: request.method(), path: url.pathname, status: response.status(), business: url.searchParams.get('businessContext') });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill(username); await page.locator('#password').fill(password);
    stage = 'login'; await page.locator('#loginForm button[type="submit"]').click();
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    async function fingerprint() {
        const stable = await page.evaluate(async () => {
            const records = [];
            for (const route of ['/api/business/cabinet?businessContext=dar', '/api/business/profile?businessContext=dar']) {
                const response = await fetch(route, { headers: getAuthHeaders() });
                records.push({ status: response.status, value: JSON.parse(JSON.stringify(await response.json(), (key, value) => key === 'generatedAt' ? undefined : value)) });
            }
            return records;
        });
        return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
    }
    result.beforeFingerprint = await fingerprint();
    async function snapshot(label) {
        result.snapshots.push(await page.evaluate(label => ({ label,
            role: typeof AppState !== 'undefined' ? AppState.currentUser?.role : null,
            business: window.CrmBusinessContext?.current?.(), activeView: window.EducationScheduleWorkspace?.state.activeView,
            teacherOptions: document.getElementById('educationGroupTeacher')?.options.length || 0,
            reportRendered: Boolean(document.querySelector('.education-report-summary')),
            reportStatusPresent: Boolean(document.getElementById('educationReportStatus')?.textContent),
            reportDatesSet: Boolean(document.getElementById('educationReportFrom')?.value && document.getElementById('educationReportTo')?.value)
        }), label));
    }
    stage = 'dar-groups';
    await page.goto(base + '/?businessContext=dar&educationSchedule=groups', { waitUntil: 'domcontentloaded' });
    await page.locator('#educationGroupsPanel').waitFor({ state: 'visible' });
    // Read-only explicit probes resolve with real responses and persist metadata only.
    result.probes = await page.evaluate(async () => {
        const records = [];
        for (const route of ['/api/staff?active=true', '/api/education/groups?businessContext=dar&includeArchived=true']) {
            const response = await fetch(route, { headers: getAuthHeaders() }); const body = await response.json();
            records.push({ path: route.split('?')[0], status: response.status,
                code: /^[a-zA-Z0-9_:-]{1,100}$/.test(body.code || '') ? body.code : null,
                count: Array.isArray(body) ? body.length : Array.isArray(body.groups) ? body.groups.length : null });
        }
        return records;
    });
    await snapshot(stage);
    stage = 'dar-reports-direct';
    let responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/education/reports');
    await page.goto(base + '/?businessContext=dar&educationSchedule=reports', { waitUntil: 'domcontentloaded' });
    let response = await responsePromise; await response.finished();
    await page.locator('#educationReportsPanel').waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await snapshot(stage);
    stage = 'dar-reports-reload';
    responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/education/reports');
    await page.reload({ waitUntil: 'domcontentloaded' }); response = await responsePromise; await response.finished();
    await page.locator('#educationReportsPanel').waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await snapshot(stage);
    result.afterFingerprint = await fingerprint(); result.profileAndCabinetUnchanged = result.beforeFingerprint === result.afterFingerprint;
    result.status = result.profileAndCabinetUnchanged && !result.pageErrors.length ? 'READONLY_OBSERVATION_COMPLETE' : 'FAIL';
    if (result.status === 'FAIL') process.exitCode = 1;
}
main().catch(error => { result.status = 'BLOCKED_ENV'; result.errorType = error.name; process.exitCode = 1; }).finally(async () => {
    await Promise.allSettled([...pending]); await browser?.close(); fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`Education live read-only: ${result.status}`);
});
