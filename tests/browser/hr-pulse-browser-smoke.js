#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || process.env.HR_PULSE_BROWSER_SMOKE_URL
    || process.env.TEST_URL
    || process.env.LIVE_SMOKE_URL;
const HEADLESS = process.env.HR_PULSE_BROWSER_SMOKE_HEADLESS !== 'false';
const ALLOW_NON_LOCAL = process.env.HR_PULSE_BROWSER_SMOKE_ALLOW_PRODUCTION === 'true'
    || process.env.LIVE_SMOKE_ALLOW_PRODUCTION === 'true';
const REQUIRE_ROWS = process.env.HR_PULSE_BROWSER_SMOKE_REQUIRE_ROWS !== 'false';

const EXPECTED_PULSE_TEXTS = [
    'Сьогодні Хто на зміні',
    'Графік Заплановані зміни',
    'Звіти Аналітика по людям'
];
const BADGE_SELECTOR = '[data-pulse-badge], .hr-pulse-card-badge, .staff-pulse-tab-badge';
const SCHEDULE_ROW_SELECTOR = '#scheduleBody tr';

function fail(message) {
    console.error(`HR Pulse browser smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

function isLocalBase(base) {
    const host = new URL(base).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const nodeModulesDir = path.dirname(normalized);
            const packageDir = path.join(nodeModulesDir, 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function authHeader(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readBody(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

async function fetchJson(base, route, options = {}) {
    const res = await fetch(`${base}${route}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeader(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(res);
    if (!res.ok) {
        const detail = body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || `HTTP ${res.status}`;
        throw new Error(`${route} returned ${res.status}: ${detail}`);
    }
    return body;
}

async function login(base) {
    const envToken = process.env.HR_PULSE_BROWSER_SMOKE_TOKEN || process.env.LIVE_SMOKE_TOKEN;
    if (envToken) {
        const verified = await fetchJson(base, '/api/auth/verify', { token: envToken });
        return { token: envToken, refreshToken: '', refreshExpiresAt: '', user: verified.user || verified };
    }

    const username = process.env.HR_PULSE_BROWSER_SMOKE_USER || process.env.LIVE_SMOKE_USER || process.env.TEST_USER;
    const password = process.env.HR_PULSE_BROWSER_SMOKE_PASS || process.env.LIVE_SMOKE_PASS || process.env.TEST_PASS;
    if (!username || !password) {
        fail('set HR_PULSE_BROWSER_SMOKE_TOKEN or HR_PULSE_BROWSER_SMOKE_USER/HR_PULSE_BROWSER_SMOKE_PASS');
    }

    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const token = body.accessToken || body.token;
    if (!token) throw new Error('/api/auth/login did not return access token');
    return {
        token,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user || null
    };
}

async function openAuthenticatedPage(browser, base, session) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', refreshExpiresAt);
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    return { context, page };
}

function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

async function pulseCardTexts(page) {
    return (await page.locator('.hr-pulse-card').allTextContents()).map(normalizeText);
}

async function assertPulseNavClean(page, label) {
    await page.waitForSelector('.hr-pulse-card', { timeout: 20000 });
    const cards = page.locator('.hr-pulse-card');
    assert.equal(await cards.count(), 3, `${label}: three HR Pulse cards are rendered`);
    assert.deepEqual(await pulseCardTexts(page), EXPECTED_PULSE_TEXTS, `${label}: HR Pulse labels stay badge-free`);
    assert.equal(await page.locator(`.hr-pulse-card ${BADGE_SELECTOR}`).count(), 0, `${label}: HR Pulse cards have no badge elements`);
    assert.equal(await page.locator(BADGE_SELECTOR).count(), 0, `${label}: page has no legacy pulse badge elements`);
}

async function assertHrShell(page, hash, label) {
    const url = new URL(page.url());
    assert.equal(url.pathname, '/hr', `${label}: stays inside HR route`);
    assert.equal(url.hash, hash, `${label}: keeps expected hash`);
}

async function assertNoScheduleIframe(page, label) {
    assert.equal(await page.locator('iframe, #hrScheduleEmbedFrame').count(), 0, `${label}: no schedule iframe/embed frame exists`);
}

async function assertStaffScheduleInitialized(page, label) {
    await page.waitForFunction(() => Boolean(
        window.StaffSchedulePage
        && typeof window.StaffSchedulePage.isInitialized === 'function'
        && window.StaffSchedulePage.isInitialized()
    ), null, { timeout: 20000 });
    assert.equal(await page.locator('#scheduleBody').count(), 1, `${label}: schedule table body exists`);

    if (REQUIRE_ROWS) {
        await page.waitForFunction(selector => document.querySelectorAll(selector).length > 0, SCHEDULE_ROW_SELECTOR, { timeout: 20000 });
        const rowCount = await page.locator(SCHEDULE_ROW_SELECTOR).count();
        assert.ok(rowCount > 0, `${label}: schedule renders at least one row`);
    }
}

async function runHrPulseFlow(page, base) {
    await page.goto(`${base}/hr#today`, { waitUntil: 'domcontentloaded' });
    await assertHrShell(page, '#today', 'today tab');
    await assertPulseNavClean(page, 'today tab');
    await assertNoScheduleIframe(page, 'today tab');

    await page.locator('.hr-pulse-card').filter({ hasText: 'Графік' }).first().click();
    await assertHrShell(page, '#schedule', 'schedule click');
    await assertPulseNavClean(page, 'schedule click');
    await assertNoScheduleIframe(page, 'schedule click');
    await assertStaffScheduleInitialized(page, 'HR schedule tab');

    await page.locator('.hr-pulse-card').filter({ hasText: 'Звіти' }).first().click();
    await assertHrShell(page, '#reports', 'reports click');
    await assertPulseNavClean(page, 'reports click');
    await assertNoScheduleIframe(page, 'reports click');
}

async function runStandaloneStaffFlow(page, base) {
    await page.goto(`${base}/staff`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    assert.equal(url.pathname, '/staff', 'standalone staff route stays on /staff');
    assert.equal(await page.locator('[data-staff-schedule-shell="standalone"]').count(), 1, 'standalone staff schedule shell exists');
    await assertStaffScheduleInitialized(page, 'standalone staff schedule');
    assert.equal(await page.locator(BADGE_SELECTOR).count(), 0, 'standalone staff page has no legacy pulse badge elements');
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or HR_PULSE_BROWSER_SMOKE_URL/TEST_URL');
    const base = normalizeBase(TARGET_URL);
    if (!isLocalBase(base) && !ALLOW_NON_LOCAL) {
        fail(`refusing non-local browser smoke for ${base}; set HR_PULSE_BROWSER_SMOKE_ALLOW_PRODUCTION=true for an explicitly approved read-only run`);
    }

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node tests/browser/hr-pulse-browser-smoke.js <url>');
    }

    const session = await login(base);
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    let context;
    let page;

    try {
        ({ context, page } = await openAuthenticatedPage(browser, base, session));
        await runHrPulseFlow(page, base);
        await runStandaloneStaffFlow(page, base);
        console.log(`HR Pulse browser smoke passed: ${base}`);
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

run().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
