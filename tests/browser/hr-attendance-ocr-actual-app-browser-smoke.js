'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

function loadPlaywright() {
    if (process.env.PLAYWRIGHT_MODULE_PATH) return require(process.env.PLAYWRIGHT_MODULE_PATH);
    for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
        if (/node_modules[\\/]\.bin[\\/]?$/.test(entry)) return require(path.join(entry, '..', 'playwright'));
    }
    return require('playwright');
}

async function run() {
    assert.equal(process.env.RUN_CRM_ATTENDANCE_ACTUAL_APP, 'true');
    const base = process.env.TEST_URL;
    assertSafeIsolatedTestUrl(base);

    const login = await fetch(new URL('/api/auth/login', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: process.env.TEST_USER, password: process.env.TEST_PASS })
    });
    assert.equal(login.status, 200);
    const auth = await login.json();
    const token = auth.accessToken || auth.token;
    assert.ok(token);

    const headers = { Authorization: 'Bearer ' + token, 'X-Business-Context': 'event_genix' };
    for (const [method, route] of [
        ['GET', '/api/attendance-upload/status'],
        ['POST', '/api/attendance-upload/photo'],
        ['POST', '/api/attendance-upload/recover']
    ]) {
        const guest = await fetch(new URL(route, base), { method });
        const signedIn = await fetch(new URL(route, base), { method, headers });
        for (const response of [guest, signedIn]) {
            assert.equal(response.status, 410, route);
            assert.equal(response.headers.get('cache-control'), 'no-store');
        }
        const payload = await guest.json();
        assert.equal(payload.success, false);
        assert.deepEqual(await signedIn.json(), payload);
    }

    for (const [method, route] of [
        ['HEAD', '/api/attendance-upload/status'],
        ['GET', '/api/attendance-upload/status/'],
        ['GET', '/api/attendance-upload/photo'],
        ['POST', '/api/attendance-upload/recover/extra']
    ]) {
        const guest = await fetch(new URL(route, base), { method });
        assert.equal(guest.status, 401, method + ' ' + route);
        const signedIn = await fetch(new URL(route, base), { method, headers });
        assert.equal(signedIn.status, 410, method + ' ' + route);
    }

    const today = await fetch(new URL('/api/hr/today', base), { headers });
    assert.equal(today.status, 200, 'canonical HR attendance remains available');
    for (const [method, route] of [
        ['GET', '/api/hr/attendance/ocr/status'],
        ['POST', '/api/hr/attendance/ocr/preview'],
        ['POST', '/api/hr/attendance/ocr/apply'],
        ['POST', '/api/hr/attendance/ocr/upload-links'],
        ['POST', '/api/hr/attendance-documents/pdf'],
        ['POST', '/api/hr/attendance-document-automations/1/run'],
        ['POST', '/api/hr/attendance-document-jobs/1/requeue']
    ]) {
        const response = await fetch(new URL(route, base), { method, headers });
        assert.ok([403, 404, 410].includes(response.status), method + ' ' + route + ' returned ' + response.status);
    }

    const { chromium } = loadPlaywright();
    const executablePath = process.env.CRM_AUTOMATION_CHROME_PATH;
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const requests = [];
        page.on('request', request => requests.push(new URL(request.url()).pathname));
        await page.goto(new URL('/attendance-upload.html#uploadKey=synthetic-retired-link', base).href);
        await page.getByRole('heading', { name: 'Завантаження листів відвідуваності більше недоступне' }).waitFor();
        assert.equal(await page.locator('form, input[type=file], script[src]').count(), 0);
        assert.equal(requests.some(route => route.startsWith('/api/attendance-upload')), false);
    } finally {
        await browser.close();
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
