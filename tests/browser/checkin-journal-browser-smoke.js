#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'checkin.html'), 'utf8');
const outputDir = path.join(root, 'output', 'playwright', 'checkin-journal-browser-smoke');

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
            const packageDir = path.join(path.dirname(entry), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

async function run() {
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let rosterMode = 'success';
    let journalMode = 'success';
    const requests = [];
    try {
        await page.addInitScript(() => {
            window.API_BASE = '/api';
            window.apiVerifyToken = async () => ({ id: 1, role: 'director' });
            window.hydrateActionPermissions = async () => ({ allowed: true });
            window.canAccessPage = () => true;
            window.getStoredAuthToken = () => 'synthetic-token';
            window.getAuthHeaders = () => ({});
            window.requestAnimationFrame = () => 0;
            window.faceapi = { nets: {
                tinyFaceDetector: { loadFromUri: async () => {} },
                faceLandmark68TinyNet: { loadFromUri: async () => {} },
                faceRecognitionNet: { loadFromUri: async () => {} }
            } };
        });
        await page.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            requests.push({ method: request.method(), path: url.pathname });
            if (url.pathname === '/checkin') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
            if (url.pathname === '/api/staff/checkins') {
                const status = journalMode === 'server' ? 500 : 200;
                return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 500
                    ? { success: false, error: 'Synthetic journal error' }
                    : { success: true, date: '2026-09-27', data: [{ date: '2026-09-27',
                        check_in_time: '2026-09-27T06:12:00.000Z', check_out_time: null, status: 'checked_in',
                        staff_name: 'Synthetic Park Worker' }] }) });
            }
            if (url.pathname === '/api/staff/face-descriptors') return route.fulfill({ status: 403,
                contentType: 'application/json', body: JSON.stringify({ success: false, code: 'staff_not_migrated' }) });
            if (url.pathname === '/api/staff') {
                const status = rosterMode === 'forbidden' ? 403 : 200;
                const body = rosterMode === 'malformed' ? { success: true, data: { invalid: true } }
                    : status === 403 ? { success: false, code: 'staff_not_migrated' }
                        : { success: true, data: [{ id: 9701, name: 'Synthetic Park Worker',
                            position: 'Animator', is_active: true }], departments: ['animators'], displayGroups: [] };
                return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
            }
            if (url.pathname.startsWith('/js/') || url.hostname === 'cdn.jsdelivr.net') {
                return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
            }
            return route.fulfill({ status: 404, body: '' });
        });
        await page.goto('https://fixture.local/checkin');
        await page.locator('#statusMsg').getByText(/Розпізнавання облич недоступне/).waitFor();
        assert.match(await page.locator('#logEntries').innerText(), /Synthetic Park Worker/);
        await page.getByRole('button', { name: /Зареєструвати обличчя/ }).click();
        await page.locator('#staffSelect option[value="9701"]').waitFor({ state: 'attached' });
        assert.equal(await page.locator('#staffSelect').isDisabled(), false);

        rosterMode = 'forbidden';
        await page.getByRole('button', { name: /Зареєструвати обличчя/ }).click();
        await page.locator('#registerStaffState').getByText(/Немає доступу/).waitFor();
        assert.match(await page.locator('#registerStaffState').innerText(), /Немає доступу/);
        assert.equal(await page.locator('#staffSelect').isDisabled(), true);

        rosterMode = 'malformed';
        await page.locator('#registerStaffState button').click();
        await page.locator('#registerStaffState').getByText(/Не вдалося завантажити/).waitFor();
        assert.match(await page.locator('#registerStaffState').innerText(), /Не вдалося завантажити/);
        assert.equal(await page.locator('#staffSelect').isDisabled(), true);

        rosterMode = 'success';
        await page.locator('#registerStaffState button').click();
        await page.waitForFunction(() => !document.getElementById('staffSelect').disabled
            && Boolean(document.querySelector('#staffSelect option[value="9701"]')));
        assert.equal(await page.locator('#staffSelect').isDisabled(), false);

        journalMode = 'server';
        await page.locator('#retryCheckinInitBtn').click();
        await page.locator('#logEntries[role="alert"] button').waitFor();
        assert.doesNotMatch(await page.locator('#logEntries').innerText(), /Ще ніхто/);
        journalMode = 'success';
        await page.locator('#logEntries button').click();
        await page.locator('#logEntries .le-name').getByText('Synthetic Park Worker').waitFor();
        await page.locator('#statusMsg').getByText(/Журнал оновлено/).waitFor();
        await page.waitForFunction(() => !document.getElementById('statusActions').hidden);

        assert.equal(requests.some(item => item.method === 'POST'), false, 'page load and picker must not write');
        fs.mkdirSync(outputDir, { recursive: true });
        await page.screenshot({ path: path.join(outputDir, 'desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
        await page.screenshot({ path: path.join(outputDir, 'mobile.png'), fullPage: true });
        console.log('Check-in picker and journal browser smoke passed');
    } finally {
        await browser.close();
    }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
