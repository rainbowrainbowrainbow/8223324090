'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { createServer, openStaffPage, permissionsFor } = require('./staff-schedule-custom-range-browser-smoke');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = process.env.CRM_AUTOMATION_BROWSER_OUTPUT;
if (!output || !path.isAbsolute(output)) throw new Error('Set CRM_AUTOMATION_BROWSER_OUTPUT to an absolute local output folder');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const user = { id: 1, name: 'Schedule QA', username: 'schedule.qa', role: 'creator' };
const results = [];
const started = Date.now();

async function waitForFixture(predicate) {
    const deadline = Date.now() + 10000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Synthetic provider was not requested');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

async function screenshot(page, name, locator) {
    const target = locator ? page.locator(locator) : page;
    await target.screenshot({ path: path.join(output, `${name}.png`), ...(locator
        ? { style: '.hermes-studio-page .header, .toast-container { visibility: hidden !important; }' } : { fullPage: true }) });
}

async function localOnly(context, base) {
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
}

async function studio(browser, base, viewport, mobile) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await localOnly(context, base);
    await context.addInitScript(user => {
        localStorage.setItem('pzp_token', 'synthetic-ui-token');
        localStorage.setItem('pzp_access_token', 'synthetic-ui-token');
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'false');
    }, user);
    let calls = 0, decisions = 0, mode = 'success', release;
    let job = { id: 1, title: 'Синтетична афіша', status: 'queued', businessContext: 'event_genix',
        sourcePayload: { brief: 'Синє коло', requirements: 'Синє коло', materialTypes: ['poster'], formats: ['square'] }, assets: [], history: [] };
    await context.route('**/synthetic-creative.png', route => route.fulfill({ contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#e8f4ff"/><circle cx="256" cy="220" r="120" fill="#2563eb"/><text x="256" y="430" text-anchor="middle" font-size="32" font-family="sans-serif" fill="#172554">Synthetic QA draft</text></svg>' }));
    await context.route('**/api/hermes-studio/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET') return route.fulfill({ json: { success: true, items: [job], meta: { canDecide: true } } });
        const body = request.postDataJSON();
        if (url.pathname.endsWith('/execute')) {
            calls++;
            assert.equal(body.confirmed, true);
            if (mode === 'disabled') return route.fulfill({ status: 503, json: { success: false, code: 'CRM_EXECUTION_DISABLED' } });
            if (mode === 'model') return route.fulfill({ status: 503, json: { success: false, code: 'CRM_CREATIVE_MODEL_NOT_READY' } });
            if (mode === 'unknown') return route.abort('failed');
            if (mode === 'kie-pending') {
                job = { ...job, status: 'in_progress', claimedBy: 'crm-creative-kie',
                    resultPayload: { executor: 'crm', provider: 'kie', model: 'gpt-image-2-5-flare-text-to-image', providerTaskId: 'synthetic_kie_task' } };
                return route.fulfill({ json: { success: true, pending: true, job } });
            }
            if (mode === 'kie-ready') {
                job = { ...job, status: 'ready_for_review', assets: [{ assetType: 'preview', role: 'preview', mimeType: 'image/png', url: '/synthetic-creative.png' }] };
                return route.fulfill({ json: { success: true, pending: false, providerCalled: false, job } });
            }
            await new Promise(resolve => { release = resolve; });
            job = { ...job, status: 'ready_for_review', assets: [{ assetType: 'preview', role: 'preview', mimeType: 'image/png', url: '/synthetic-creative.png' }] };
            return route.fulfill({ json: { success: true, job } });
        }
        if (url.pathname.endsWith('/decision')) {
            decisions++;
            job = { ...job, status: body.decision, history: [{ summary: 'Погоджено оператором', eventType: 'decision', createdAt: new Date().toISOString() }] };
            return route.fulfill({ json: { success: true, job } });
        }
        throw new Error('Unexpected Studio mutation');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(`${base}/hermes-studio.html`);
        const execute = page.locator('#hermesStudioExecuteBtn');
        await execute.waitFor({ state: 'visible' });
        await execute.click();
        await page.locator('.confirm-cancel').click();
        assert.equal(calls, 0);
        await execute.click();
        await page.locator('.confirm-ok').click();
        await page.waitForFunction(() => document.querySelector('#hermesStudioExecutionStatus').textContent.includes('Генеруємо'));
        await waitForFixture(() => release);
        assert.equal(await execute.isDisabled(), true);
        await execute.evaluate(element => { element.click(); element.click(); });
        assert.equal(calls, 1);
        release();
        await page.waitForFunction(() => document.querySelector('#hermesStudioSelectedStatus').textContent === 'ready for review');
        assert.equal(decisions, 0, 'Generation must not automatically approve');
        await screenshot(page, mobile ? 'studio-mobile-review' : 'studio-desktop-review', '.hermes-studio-detail');
        assert.ok(await page.locator('.hermes-studio-detail img').count());
        await page.locator('[data-hermes-decision="approved"]').click();
        await page.waitForFunction(() => document.querySelector('#hermesStudioSelectedStatus').textContent === 'approved');
        assert.equal(decisions, 1);
        if (!mobile) {
            mode = 'disabled'; job = { ...job, id: 2, status: 'queued' };
            await page.locator('#hermesStudioRefreshBtn').click();
            await execute.click(); await page.locator('.confirm-ok').click();
            await page.waitForFunction(() => document.querySelector('#hermesStudioExecutionStatus').textContent.includes('ще не активована'));
            mode = 'model';
            await execute.click(); await page.locator('.confirm-ok').click();
            await page.waitForFunction(() => document.querySelector('#hermesStudioExecutionStatus').textContent.includes('Модель генерації ще не налаштована'));
            await screenshot(page, 'studio-model-guard', '.hermes-studio-detail');
            mode = 'unknown';
            await execute.click(); await page.locator('.confirm-ok').click();
            await page.waitForFunction(() => document.querySelector('#hermesStudioExecutionStatus').textContent.includes('потребує перевірки'));
            assert.equal(await execute.isDisabled(), true);
            assert.equal(calls, 4);
        }
        mode = 'kie-pending'; job = { ...job, id: 3, status: 'queued', claimedBy: null, resultPayload: null, assets: [] };
        await page.locator('#hermesStudioRefreshBtn').click();
        await execute.click(); await page.locator('.confirm-ok').click();
        await page.waitForFunction(() => document.querySelector('#hermesStudioExecutionStatus').textContent.includes('ще готується'));
        assert.equal(await execute.textContent(), 'Перевірити результат');
        await screenshot(page, mobile ? 'studio-kie-mobile-pending' : 'studio-kie-desktop-pending', '.hermes-studio-detail');
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#hermesStudioExecuteBtn').textContent === 'Перевірити результат');
        mode = 'kie-ready';
        await execute.click(); // Saved-task checks do not ask for another paid generation confirmation.
        await page.waitForFunction(() => document.querySelector('#hermesStudioSelectedStatus').textContent === 'ready for review');
        assert.equal(await page.locator('.confirm-ok').count(), 0);
        assert.equal(decisions, 1, 'Fetching the KIE result must not auto-approve');
        assert.deepEqual(errors, []);
        results.push({ scenario: `studio-${mobile ? 'mobile' : 'desktop'}`, passed: true, calls, decisions });
    } finally { if (release) release(); await context.close(); }
}

async function schedule(browser, base, viewport, mobile, hr = false, dark = false) {
    let previews = 0, applies = 0, refreshes = 0, mode = 'success', release;
    const preview = { success: true, importId: 'hsi_synthetic0123456789', status: 'needs_review', rows: [
        { rowId: 'row-one', employeeName: 'Синтетичний працівник', date: '2026-11-02', action: 'create', proposedState: { status: 'dayoff' } },
        { rowId: 'row-two', employeeName: 'Інший працівник', date: '2026-11-02', action: 'invalid', issues: [{ message: 'Низька впевненість — перевірте вручну' }] },
        { rowId: 'row-three', employeeName: 'Синтетичний працівник', date: '2026-11-03', action: 'conflict',
            expectedCurrentState: { status: 'working', startTime: '09:00', endTime: '17:00' }, proposedState: { status: 'vacation' } }
    ] };
    const { context, page } = await openStaffPage(browser, base, viewport, { serviceWorkers: 'block', darkMode: dark,
        ...(hr ? { path: '/hr.html', search: '?tab=schedule' } : {}),
        preparePage: async page => {
            await localOnly(page.context(), base);
            page.on('request', request => { if (new URL(request.url()).pathname === '/api/staff/schedule') refreshes++; });
            await page.route('**/api/staff/schedule/ocr-*', async route => {
                if (route.request().url().endsWith('ocr-preview')) {
                    previews++;
                    assert.match(route.request().headers()['content-type'], /^multipart\/form-data; boundary=/);
                    assert.match(route.request().postDataBuffer().toString(), /name="confirmed"\r\n\r\ntrue/);
                    if (mode === 'unknown') return route.abort('failed');
                    if (mode === 'disabled') return route.fulfill({ status: 503, json: { code: 'CRM_EXECUTION_DISABLED', success: false } });
                    if (mode === 'stale') return route.fulfill({ json: preview });
                    await new Promise(resolve => { release = resolve; });
                    return route.fulfill({ json: preview });
                }
                applies++;
                assert.deepEqual(route.request().postDataJSON(), { previewId: preview.importId,
                    selectedRowIds: ['row-one', 'row-three'], conflictConfirmed: ['row-three'], confirmed: true });
                return route.fulfill(mode === 'stale'
                    ? { status: 409, json: { success: false, code: 'HERMES_SCHEDULE_APPLY_STATE_CHANGED' } }
                    : { json: { success: true } });
            });
        } });
    try {
        const panel = page.locator('#scheduleOcrPanel');
        await panel.locator('summary').click();
        const submit = page.locator('#scheduleOcrPreviewBtn');
        await page.locator('#scheduleOcrFile').setInputFiles({ name: 'schedule.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
        await page.locator('#scheduleOcrPaidConfirm').check();
        await submit.click();
        assert.equal(previews, 0);
        await page.locator('#scheduleOcrFile').setInputFiles({ name: 'schedule.png', mimeType: 'image/png', buffer: png });
        await submit.click();
        await waitForFixture(() => release);
        assert.equal(await submit.isDisabled(), true);
        await submit.evaluate(element => element.click());
        release();
        await page.locator('#scheduleOcrReview').waitFor({ state: 'visible' });
        assert.equal(previews, 1);
        assert.equal(applies, 0);
        assert.equal(await page.locator('[data-ocr-row="1"]').isDisabled(), true);
        await page.locator('[data-ocr-row="0"]').check();
        await page.locator('[data-ocr-row="2"]').check();
        await page.locator('#scheduleOcrApplyConfirm').check();
        assert.equal(await page.locator('#scheduleOcrApplyBtn').isDisabled(), true);
        await page.locator('[data-ocr-conflict="2"]').check();
        await screenshot(page, hr ? dark ? 'ocr-hr-mobile-dark-review' : 'ocr-hr-review' : mobile ? 'ocr-mobile-review' : 'ocr-desktop-review', '#scheduleOcrPanel');
        assert.notEqual(await panel.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
        const before = refreshes;
        await page.locator('#scheduleOcrApplyBtn').click();
        await page.waitForFunction(() => document.querySelector('#scheduleOcrStatus').textContent.includes('застосовано'));
        await page.waitForFunction(() => document.querySelector('#scheduleOcrPanel').getAttribute('aria-busy') === 'false');
        assert.equal(applies, 1);
        assert.ok(refreshes > before, 'Apply must reload the visible schedule from the server');
        assert.equal(await page.locator('#scheduleOcrApplyBtn').isDisabled(), true);
        if (!mobile && !hr) {
            mode = 'stale';
            await page.locator('#scheduleOcrDate').fill('2026-11-05');
            await submit.click();
            await page.locator('#scheduleOcrReview').waitFor({ state: 'visible' });
            await page.locator('[data-ocr-row="0"]').check();
            await page.locator('[data-ocr-row="2"]').check();
            await page.locator('[data-ocr-conflict="2"]').check();
            await page.locator('#scheduleOcrApplyConfirm').check();
            await page.locator('#scheduleOcrApplyBtn').click();
            await page.waitForFunction(() => document.querySelector('#scheduleOcrStatus').textContent.includes('Перегляд застарів'));
            assert.equal(await page.locator('#scheduleOcrApplyBtn').isDisabled(), true);
        }
        if (mobile && !hr) {
            mode = 'disabled';
            await page.locator('#scheduleOcrDate').fill('2026-11-04');
            await submit.click();
            await page.waitForFunction(() => document.querySelector('#scheduleOcrStatus').textContent.includes('ще не активоване'));
            mode = 'unknown'; await submit.click();
            await page.waitForFunction(() => document.querySelector('#scheduleOcrStatus').textContent.includes('потребує перевірки'));
            assert.equal(await submit.isDisabled(), true);
            assert.equal(previews, 3);
        }
        assert.ok(await panel.evaluate(element => element.getBoundingClientRect().width <= window.innerWidth));
        results.push({ scenario: hr ? dark ? 'ocr-hr-mobile-dark' : 'ocr-hr-host' : `ocr-${mobile ? 'mobile' : 'desktop'}`, passed: true, previews, applies, refreshes });
    } finally { if (release) release(); await context.close(); }
}

async function readOnly(browser, base) {
    const deniedUser = { ...user, action_denylist: ['hr.schedule.manage'] };
    const { context, page } = await openStaffPage(browser, base, { width: 390, height: 844 }, {
        serviceWorkers: 'block', preparePage: async page => {
            await localOnly(page.context(), base);
            await page.route('**/api/auth/permissions', route => route.fulfill({ json: permissionsFor(deniedUser) }));
        }
    });
    try {
        assert.equal(await page.locator('#scheduleOcrPanel').isVisible(), false);
        results.push({ scenario: 'ocr-read-only', passed: true });
    } finally { await context.close(); }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const { server, base } = await createServer();
    const websocket = new WebSocketServer({ server });
    websocket.on('connection', client => client.on('message', data => {
        const message = JSON.parse(String(data));
        if (message.type === 'auth') client.send(JSON.stringify({ type: 'auth:success',
            payload: { userId: user.id, username: user.username, connectedClients: 1 } }));
    }));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CRM_AUTOMATION_CHROME_PATH });
    try {
        const hrOnly = process.argv.includes('--hr-only');
        const studioOnly = process.argv.includes('--studio-only');
        if (!hrOnly) {
            for (const [viewport, mobile] of [[{ width: 1440, height: 1000 }, false], [{ width: 390, height: 844 }, true]]) {
                await studio(browser, base, viewport, mobile);
                if (!studioOnly) await schedule(browser, base, viewport, mobile);
            }
            if (!studioOnly) await readOnly(browser, base);
        }
        if (!studioOnly) {
            await schedule(browser, base, { width: 1440, height: 1000 }, false, true);
            await schedule(browser, base, { width: 390, height: 844 }, true, true, true);
        }
        fs.writeFileSync(path.join(output, hrOnly ? 'results-hr.json' : 'results.json'), JSON.stringify({ durationMs: Date.now() - started, results }, null, 2));
        console.log(JSON.stringify(results));
    } finally {
        await browser.close();
        for (const client of websocket.clients) client.terminate();
        await new Promise(resolve => websocket.close(resolve));
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
