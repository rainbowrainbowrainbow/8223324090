#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function requirePlaywright() {
    try {
        return require('playwright');
    } catch {}
    throw new Error('Playwright is not available. Run through: npx --yes --package playwright node scripts/live-trusted-qa-ui-ws-smoke.js');
}

function requiredEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

const base = String(process.env.LIVE_BASE || process.env.LIVE_SMOKE_URL || '').replace(/\/$/, '');
const expectedVersion = requiredEnv('LIVE_EXPECTED_VERSION');
const expectedCommit = requiredEnv('LIVE_EXPECTED_COMMIT');
const username = process.env.LIVE_SMOKE_USER || process.env.TEST_USER;
const password = process.env.LIVE_SMOKE_PASS || process.env.TEST_PASS;
const stateFile = process.env.TRUSTED_QA_STATE_FILE || 'output/task8-trusted-qa-plan-20260815/live-state.json';
if (!base || !username || !password) throw new Error('Required live UI QA environment is missing');

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const selectedDate = String(state.date || '');
const groupId = state.browserBanquet?.groupId;
const primaryId = state.browserBanquet?.primaryId;
const activityId = state.browserBanquet?.activityId;
if (!selectedDate || !groupId || !primaryId || !activityId) {
    throw new Error('Trusted QA browser state file is incomplete');
}

const artifactDir = path.resolve('output/playwright/trusted-qa-ui-ws');
fs.mkdirSync(artifactDir, { recursive: true });

async function jsonRequest(method, pathname, { body, token } = {}) {
    const response = await fetch(`${base}${pathname}`, {
        method,
        headers: {
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
}

async function assertLiveSource(phase) {
    const result = await jsonRequest('GET', '/api/version');
    assert.equal(result.status, 200, `${phase}: /api/version failed`);
    assert.equal(String(result.data.version || ''), expectedVersion, `${phase}: live version drift`);
    assert.equal(String(result.data.commitSha || ''), expectedCommit, `${phase}: live commit drift`);
}

async function login() {
    const result = await jsonRequest('POST', '/api/auth/login', { body: { username, password } });
    if (result.status !== 200 || !(result.data.accessToken || result.data.token)) {
        throw new Error(`Login failed (${result.status})`);
    }
    return {
        token: result.data.accessToken || result.data.token,
        refreshToken: result.data.refreshToken || '',
        refreshExpiresAt: result.data.refreshExpiresAt || '',
        user: result.data.user || null
    };
}

async function bootstrapPage(page) {
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#mainApp:not(.hidden)', { timeout: 30000 });
    await page.waitForFunction(() => typeof window.showBookingDetails === 'function' && typeof window.renderTimeline === 'function');
    await page.evaluate(async dateText => {
        const viewDate = new Date(`${dateText}T00:00:00`);
        window.AppState.selectedDate = viewDate;
        const input = document.getElementById('timelineDate');
        if (input) input.value = dateText;
        window.TimelineView?.set?.('animators');
        window.syncTimelineWebSocketDateSubscriptions?.(viewDate);
        await window.renderTimeline();
    }, selectedDate);
}

async function openDetails(page, id) {
    await page.evaluate(async bookingId => window.showBookingDetails(bookingId), id);
    await page.waitForSelector('#bookingModal:not(.hidden)', { timeout: 20000 });
}

async function cancellationButtonText(page, id) {
    return page.locator(`[data-cancellation-booking-id="${id}"]`).innerText();
}

async function assertNoGenericDelete(page) {
    const text = await page.locator('#bookingModal').innerText();
    assert.equal(/(^|\s)Видалити(\s|$)/.test(text), false, 'booking modal must not show generic delete wording');
}

async function activeBookingIds(page) {
    return page.evaluate(async dateText => {
        const rows = await window.getBookingsForDate(dateText, { force: true });
        return rows.map(row => row.id).sort();
    }, selectedDate);
}

async function waitBanquetEvent(page, expectedOperation) {
    return page.waitForFunction(({ expectedGroupId, expectedDate, expectedOperation }) => {
        const events = window.__trustedQaBanquetEvents || [];
        return events.some(event => {
            const payload = event?.payload || {};
            return payload.groupId === expectedGroupId
                && String(payload.date || '').slice(0, 10) === expectedDate
                && (!expectedOperation || payload.operation === expectedOperation);
        });
    }, { expectedGroupId: groupId, expectedDate: selectedDate, expectedOperation }, { timeout: 15000 });
}

async function main() {
    await assertLiveSource('before_login');
    const playwright = requirePlaywright();
    const session = await login();
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);

    const requests = [];
    try {
        const failClosedPage = await context.newPage();
        await failClosedPage.route(`**/api/bookings/${primaryId}/cancellation-readiness**`, route => route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'forced readiness failure' })
        }));
        await bootstrapPage(failClosedPage);
        await openDetails(failClosedPage, primaryId);
        const failClosedText = await failClosedPage.locator('#bookingModal').innerText();
        assert.match(failClosedText, /Перевірка скасування недоступна/, 'failed readiness must render fail-closed copy');
        assert.equal(await failClosedPage.locator(`[data-cancellation-booking-id="${primaryId}"]`).count(), 0, 'destructive action hidden on readiness failure');
        await failClosedPage.close();

        await assertLiveSource('before_activity_cancel');
        const page1 = await context.newPage();
        const page2 = await context.newPage();
        page1.on('request', request => {
            const url = request.url();
            if (request.method() !== 'GET' && /\/api\/(banquets|bookings)\//.test(url)) {
                requests.push({ method: request.method(), url });
            }
        });
        await bootstrapPage(page1);
        await bootstrapPage(page2);
        await page2.evaluate(() => {
            window.__trustedQaBanquetEvents = [];
            window.addEventListener('ws:banquet', event => {
                window.__trustedQaBanquetEvents.push({
                    eventType: event.detail?.eventType || '',
                    payload: event.detail?.payload || {}
                });
            });
        });

        const beforeActivityIds = await activeBookingIds(page2);
        let activityAlreadyRemoved = false;
        let doubleClickActivityRequests = 0;
        if (beforeActivityIds.includes(activityId)) {
            await openDetails(page1, activityId);
            assert.equal(await cancellationButtonText(page1, activityId), 'Прибрати складову');
            await assertNoGenericDelete(page1);
            const activityButton = page1.locator(`[data-cancellation-booking-id="${activityId}"]`);
            await activityButton.click();
            await activityButton.click({ trial: true }).catch(() => {});
            await page1.waitForSelector('#confirmModal:not(.hidden)', { timeout: 10000 });
            await page1.locator('#confirmYes').click();
            await waitBanquetEvent(page2, 'banquet_activity_cancel');
            const afterActivityIds = await activeBookingIds(page2);
            assert.equal(afterActivityIds.includes(activityId), false, 'second tab no longer sees removed activity as active');
            doubleClickActivityRequests = requests.filter(entry => entry.method === 'DELETE' && entry.url.includes(`/api/banquets/${groupId}/activities/${activityId}`)).length;
            assert.equal(doubleClickActivityRequests, 1, 'double click must send one activity cancellation request');
        } else {
            activityAlreadyRemoved = true;
        }

        await assertLiveSource('before_group_cancel');
        await openDetails(page1, primaryId);
        assert.equal(await cancellationButtonText(page1, primaryId), 'Скасувати весь банкет');
        await assertNoGenericDelete(page1);
        const beforeCancelCount = requests.filter(entry => entry.method === 'POST' && entry.url.includes(`/api/banquets/${groupId}/cancel`)).length;
        await page1.locator(`[data-cancellation-booking-id="${primaryId}"]`).click();
        await page1.waitForSelector('#confirmModal:not(.hidden)', { timeout: 10000 });
        await page1.keyboard.press('Escape');
        await page1.waitForFunction(() => document.getElementById('confirmModal')?.classList.contains('hidden') === true, null, { timeout: 10000 });
        assert.equal(
            requests.filter(entry => entry.method === 'POST' && entry.url.includes(`/api/banquets/${groupId}/cancel`)).length,
            beforeCancelCount,
            'Escape must not submit cancellation'
        );
        await page1.locator(`[data-cancellation-booking-id="${primaryId}"]`).click();
        await page1.waitForSelector('#confirmModal:not(.hidden)', { timeout: 10000 });
        await page1.locator('#confirmYes').click();
        await waitBanquetEvent(page2, 'banquet_group_cancel');
        const afterGroupIds = await activeBookingIds(page2);
        assert.equal(afterGroupIds.includes(primaryId), false, 'second tab no longer sees cancelled primary as active');
        assert.equal(
            requests.filter(entry => entry.method === 'POST' && entry.url.includes(`/api/banquets/${groupId}/cancel`)).length,
            beforeCancelCount + 1,
            'primary cancellation must send one group cancel request'
        );

        const screenshot = path.join(artifactDir, 'trusted-qa-ui-final.png');
        await page1.screenshot({ path: screenshot, fullPage: false });
        console.log(JSON.stringify({
            success: true,
            runDatabaseId: state.runDatabaseId,
            runId: state.runId,
            failClosed: true,
            noGenericDelete: true,
            activityAlreadyRemoved,
            doubleClickActivityRequests,
            escapeSubmitted: false,
            wsEvents: await page2.evaluate(() => window.__trustedQaBanquetEvents || []),
            activeAfterGroup: afterGroupIds,
            screenshot
        }, null, 2));
    } finally {
        await context.close();
        await browser.close();
    }
}

main().catch(error => {
    console.error(JSON.stringify({
        success: false,
        code: error.code || 'TRUSTED_QA_UI_WS_FAILED',
        message: error.message
    }));
    process.exitCode = 1;
});
