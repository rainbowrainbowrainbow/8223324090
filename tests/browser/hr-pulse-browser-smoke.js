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
const THEME_MODE = String(process.env.HR_PULSE_BROWSER_SMOKE_THEME || 'light').toLowerCase();

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

if (!['light', 'dark'].includes(THEME_MODE)) {
    fail('HR_PULSE_BROWSER_SMOKE_THEME must be "light" or "dark"');
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
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user, themeMode }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', refreshExpiresAt);
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', themeMode === 'dark' ? 'true' : 'false');
    }, { ...session, themeMode: THEME_MODE });
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
    const scheduleEmbed = '#hrScheduleEmbedFrame, iframe[src*="/staff?embed=1"], iframe[data-src*="/staff?embed=1"]';
    assert.equal(await page.locator(scheduleEmbed).count(), 0, `${label}: no schedule iframe/embed frame exists`);
}

async function assertThemeMode(page, label) {
    await page.waitForFunction(themeMode => {
        const isDark = document.body.classList.contains('dark-mode')
            || document.documentElement.dataset.theme === 'dark';
        return themeMode === 'dark' ? isDark : !isDark;
    }, THEME_MODE, { timeout: 20000 });

    if (THEME_MODE !== 'light') return;

    const pulseTokens = await page.locator('.hr-nav--pulse, .staff-pulse-nav').first().evaluate(el => {
        const styles = getComputedStyle(el);
        return {
            shell: styles.getPropertyValue('--pulse-switcher-shell-bg').trim(),
            card: styles.getPropertyValue('--pulse-switcher-card-bg').trim(),
            color: styles.getPropertyValue('--pulse-switcher-card-color').trim()
        };
    });
    const darkTokenPattern = /15,\s*23,\s*42/;
    assert.equal(darkTokenPattern.test(pulseTokens.shell), false, `${label}: light pulse shell token is not dark`);
    assert.equal(darkTokenPattern.test(pulseTokens.card), false, `${label}: light pulse card token is not dark`);
    assert.equal(pulseTokens.color, '#0F172A', `${label}: light pulse card text token is dark readable text`);
}

async function assertLightScheduleCommandBar(page, label) {
    if (THEME_MODE !== 'light') return;
    const bar = page.locator('.staff-schedule-command-bar').first();
    await bar.waitFor({ timeout: 20000 });
    const styles = await bar.evaluate(el => {
        const computed = getComputedStyle(el);
        return `${computed.backgroundImage} ${computed.backgroundColor}`;
    });
    assert.equal(/15,\s*23,\s*42/.test(styles), false, `${label}: light schedule command bar is not dark`);
    assert.ok(/255,\s*255,\s*255/.test(styles), `${label}: light schedule command bar keeps a white surface`);
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

async function readHrPrintGeometry(page, dialog) {
    return dialog.evaluate(element => {
        const rect = node => {
            if (!node) return null;
            const value = node.getBoundingClientRect();
            return {
                top: value.top,
                right: value.right,
                bottom: value.bottom,
                left: value.left,
                width: value.width,
                height: value.height
            };
        };
        const body = element.querySelector('.hr-print-documents-body');
        const form = element.querySelector('.hr-print-documents-form');
        const categoryList = element.querySelector('.hr-print-profession-list');
        const preview = element.querySelector('.hr-print-preview-panel');
        const frame = element.querySelector('.hr-print-preview-frame:not(.hidden)');
        const actions = element.querySelector('.hr-print-documents-actions');
        return {
            viewportWidth: document.documentElement.clientWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            dialog: rect(element),
            body: rect(body),
            form: rect(form),
            categoryList: rect(categoryList),
            preview: rect(preview),
            frame: rect(frame),
            actions: rect(actions),
            bodyClientWidth: body?.clientWidth || 0,
            bodyScrollWidth: body?.scrollWidth || 0,
            bodyScrollTop: body?.scrollTop || 0,
            categoryClientWidth: categoryList?.clientWidth || 0,
            categoryScrollWidth: categoryList?.scrollWidth || 0,
            modalWhiteSpace: getComputedStyle(element).whiteSpace,
            bodyWhiteSpace: body ? getComputedStyle(body).whiteSpace : ''
        };
    });
}

function assertHrPrintGeometry(geometry, label, { previewReady = false, stacked = false } = {}) {
    assert.ok(geometry.dialog.width <= geometry.viewportWidth + 1, `${label}: print dialog fits viewport`);
    assert.ok(geometry.pageScrollWidth <= geometry.viewportWidth + 1, `${label}: page has no horizontal overflow`);
    assert.ok(geometry.bodyScrollWidth <= geometry.bodyClientWidth + 1, `${label}: modal body has no horizontal overflow`);
    assert.ok(geometry.categoryScrollWidth <= geometry.categoryClientWidth + 1, `${label}: categories stay inside their card`);
    assert.equal(geometry.modalWhiteSpace, 'normal', `${label}: modal content can wrap`);
    assert.equal(geometry.bodyWhiteSpace, 'normal', `${label}: modal body content can wrap`);
    if (!previewReady || !geometry.frame) return;
    assert.ok(geometry.frame.right <= geometry.preview.right + 1, `${label}: preview frame stays inside panel horizontally`);
    assert.ok(geometry.frame.bottom <= geometry.preview.bottom + 1, `${label}: preview frame stays inside panel vertically`);
    if (stacked) {
        assert.ok(geometry.preview.top < geometry.body.bottom, `${label}: generated preview is scrolled into the visible modal body`);
        assert.ok(geometry.preview.bottom > geometry.body.top, `${label}: generated preview intersects the visible modal body`);
    } else {
        assert.ok(geometry.preview.bottom <= geometry.body.bottom + 1, `${label}: preview panel stays above modal footer`);
        assert.ok(geometry.frame.bottom <= geometry.actions.top + 1, `${label}: preview frame is not hidden below footer`);
    }
}

async function captureHrPrintFallbackOpen(page) {
    return page.evaluate(() => {
        const originalOpen = window.open;
        let call = null;
        window.open = (...args) => {
            call = args;
            return null;
        };
        document.getElementById('hrPrintOpenButton')?.click();
        window.open = originalOpen;
        return call;
    });
}

async function assertHrPrintDocuments(page) {
    const openButton = page.getByRole('button', { name: 'Документи для друку' });
    await openButton.waitFor({ timeout: 20000 });
    await openButton.click();
    const dialog = page.getByRole('dialog', { name: 'Документи для друку' });
    await dialog.waitFor({ timeout: 20000 });
    assert.equal(await dialog.locator('[data-hr-print-category]').count(), 18, 'print modal exposes canonical v27 categories');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'hrPrintDocumentsClose', 'print modal receives initial focus');
    await dialog.getByRole('heading', { name: '6. Автоматичне формування' }).waitFor();
    await page.waitForFunction(() => !document.getElementById('hrPrintAutomationList')?.textContent?.includes('Завантажуємо'));
    assert.equal(await dialog.locator('#hrPrintAutomationSave').isEnabled(), true, 'manager can configure CRM PDF automation');

    for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1024, height: 768 },
        { width: 998, height: 553 }
    ]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(100);
        const geometry = await readHrPrintGeometry(page, dialog);
        assertHrPrintGeometry(geometry, `${viewport.width}x${viewport.height}`, { stacked: viewport.width <= 980 });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Tab keeps focus inside print modal');

    const search = dialog.getByRole('searchbox', { name: 'Пошук категорій' });
    await search.fill('офі');
    assert.equal(await dialog.getByRole('checkbox', { name: 'Офіціанти' }).count(), 1, 'profession search finds waiters');
    assert.equal(await dialog.getByRole('checkbox', { name: 'Батутисти' }).count(), 0, 'profession search stays category-local');
    await search.fill('');

    await dialog.getByText('Місячний табель-відмічалка', { exact: true }).click();
    assert.equal(await dialog.locator('#hrPrintDocumentMonth').isVisible(), true, 'monthly template exposes month input');
    assert.equal(await dialog.locator('#hrPrintDailyMode').isVisible(), false, 'monthly template hides daily attendance mode');
    assert.equal(await dialog.locator('#hrPrintAutomationWeekdays').isVisible(), false, 'monthly automation uses first-day rule instead of weekdays');
    await dialog.getByText('Лист приходу / уходу', { exact: true }).click();
    assert.equal(await dialog.locator('#hrPrintDailyMode').inputValue(), 'manual_blank', 'browser smoke never requests production actual attendance');
    assert.equal(await dialog.locator('#hrPrintAutomationWeekdays').isVisible(), true, 'daily automation exposes weekdays');

    await dialog.locator('#hrPrintCustomTitle').fill('Browser smoke title');
    assert.equal(await dialog.locator('#hrPrintPresetWarning').isVisible(), true, 'custom title marks preset as changed');
    await dialog.getByRole('button', { name: 'Скинути до еталону v27' }).click();
    assert.equal(await dialog.locator('#hrPrintPresetWarning').isVisible(), false, 'reset restores v27 preset');

    let pdfRequestCount = 0;
    const countPdfRequest = request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/hr/attendance-documents/pdf') pdfRequestCount += 1;
    };
    page.on('request', countPdfRequest);
    const responsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/hr/attendance-documents/pdf'
    ), { timeout: 30000 });
    await dialog.getByRole('button', { name: 'Сформувати preview' }).focus();
    await page.keyboard.press('Enter');
    const response = await responsePromise;
    assert.equal(response.status(), 200, 'manual print preview endpoint succeeds');
    assert.match(response.headers()['content-type'] || '', /application\/pdf/i, 'manual print preview returns PDF');
    const payload = response.request().postDataJSON();
    assert.equal(payload.dailyMode, 'manual_blank', 'browser smoke sends manual blank mode only');
    assert.equal(payload.categoryIds.length, 18, 'browser smoke sends all canonical categories');
    assert.equal(Object.hasOwn(payload, 'employees'), false, 'browser payload never sends employee PII');
    try {
        await page.waitForFunction(() => (
            !document.getElementById('hrPrintDownloadButton')?.disabled
            && !document.getElementById('hrPrintPrintButton')?.disabled
            && !document.getElementById('hrPrintOpenButton')?.disabled
        ), null, { timeout: 25000 });
    } catch (error) {
        const previewState = await dialog.evaluate(element => {
            const frame = element.querySelector('#hrPrintPreviewFrame');
            let frameLocation = '';
            let frameReadyState = '';
            try {
                frameLocation = frame?.contentWindow?.location?.href || '';
                frameReadyState = frame?.contentDocument?.readyState || '';
            } catch {
                frameLocation = 'inaccessible';
            }
            return {
                pdfViewerEnabled: navigator.pdfViewerEnabled,
                frameSrc: frame?.getAttribute('src') || '',
                frameLocation,
                frameReadyState,
                badge: element.querySelector('#hrPrintPreviewBadge')?.textContent || '',
                state: element.querySelector('#hrPrintPreviewState')?.textContent || '',
                status: element.querySelector('#hrPrintDocumentsStatus')?.textContent || ''
            };
        });
        throw new Error(`print preview did not reach ready state: ${JSON.stringify(previewState)}`, { cause: error });
    }
    assert.equal(await dialog.getByRole('button', { name: 'Завантажити PDF' }).isEnabled(), true, 'download enables after preview');
    assert.equal(await dialog.getByRole('button', { name: 'Друкувати' }).isEnabled(), true, 'print enables after preview');
    assert.equal(await dialog.getByRole('button', { name: 'Відкрити PDF в окремій вкладці' }).isEnabled(), true, 'fallback opens only after preview');
    const pdfViewerEnabled = await page.evaluate(() => navigator.pdfViewerEnabled !== false);
    if (pdfViewerEnabled) {
        assert.equal(await dialog.locator('#hrPrintPreviewFrame:not(.hidden)').count(), 1, 'inline-capable browser renders the PDF frame');
    } else {
        assert.equal(await dialog.locator('#hrPrintPreviewFrame:not(.hidden)').count(), 0, 'browser without a PDF viewer keeps the frame hidden');
        assert.match(await dialog.locator('#hrPrintPreviewState').textContent(), /Відкрийте документ в окремій вкладці/, 'no-viewer browser explains the fallback');
    }
    const fallbackOpen = await captureHrPrintFallbackOpen(page);
    const firstPreviewUrl = fallbackOpen?.[0] || '';
    assert.match(firstPreviewUrl || '', /^blob:/, 'manual preview uses a blob URL');
    assertHrPrintGeometry(await readHrPrintGeometry(page, dialog), '1440x900 ready preview', { previewReady: true });
    assert.equal(fallbackOpen?.[0], firstPreviewUrl, 'fallback opens the current preview URL');
    assert.equal(fallbackOpen?.[1], '_blank', 'fallback opens PDF in a new tab');
    assert.equal(pdfRequestCount, 1, 'preview uses one server snapshot request');

    const secondResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/hr/attendance-documents/pdf'
    ), { timeout: 30000 });
    await dialog.getByRole('button', { name: 'Сформувати preview' }).click();
    assert.equal((await secondResponsePromise).status(), 200, 'repeated manual preview succeeds');
    await page.waitForFunction(() => !document.getElementById('hrPrintDownloadButton')?.disabled, null, { timeout: 20000 });
    const secondPreviewUrl = (await captureHrPrintFallbackOpen(page))?.[0] || '';
    assert.notEqual(secondPreviewUrl, firstPreviewUrl, 'repeated preview replaces the old blob URL');
    const oldPreviewStillReadable = await page.evaluate(async objectUrl => {
        try {
            const result = await fetch(objectUrl);
            return result.ok;
        } catch {
            return false;
        }
    }, firstPreviewUrl);
    assert.equal(oldPreviewStillReadable, false, 'repeated preview revokes the old blob URL');
    assert.equal(pdfRequestCount, 2, 'repeated preview uses exactly one additional server snapshot request');

    const queuedPreview = dialog.locator('[data-hr-print-operation="preview-job"]:visible').first();
    if (await queuedPreview.count()) {
        const queuedResponsePromise = page.waitForResponse(response => (
            response.request().method() === 'GET'
            && /\/api\/hr\/attendance-document-jobs\/\d+\/pdf$/.test(new URL(response.url()).pathname)
        ), { timeout: 30000 });
        const previousUrl = (await captureHrPrintFallbackOpen(page))?.[0] || '';
        await queuedPreview.click();
        assert.equal((await queuedResponsePromise).status(), 200, 'queued immutable preview succeeds');
        await page.waitForFunction(() => !document.getElementById('hrPrintDownloadButton')?.disabled, null, { timeout: 20000 });
        const queuedUrl = (await captureHrPrintFallbackOpen(page))?.[0] || '';
        assert.match(queuedUrl, /^blob:/, 'queued preview exposes the shared fallback URL');
        assert.notEqual(queuedUrl, previousUrl, 'queued preview replaces the previous blob URL');
        assert.equal(await dialog.getByRole('button', { name: 'Друкувати' }).isEnabled(), true, 'queued preview uses the shared ready state');
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/hr/attendance-documents/pdf'
    ), { timeout: 30000 });
    await dialog.getByRole('button', { name: 'Сформувати preview' }).click();
    assert.equal((await mobileResponsePromise).status(), 200, 'mobile manual preview succeeds');
    await page.waitForFunction(() => {
        const body = document.querySelector('.hr-print-documents-body');
        const preview = document.querySelector('.hr-print-preview-panel');
        const bodyRect = body?.getBoundingClientRect();
        const previewRect = preview?.getBoundingClientRect();
        return body?.scrollTop > 0
            && previewRect?.top < bodyRect?.bottom
            && previewRect?.bottom > bodyRect?.top
            && !document.getElementById('hrPrintDownloadButton')?.disabled;
    }, null, { timeout: 20000 });
    const mobileGeometry = await readHrPrintGeometry(page, dialog);
    assert.ok(mobileGeometry.dialog.width <= mobileGeometry.viewportWidth + 1, 'mobile print dialog fits viewport');
    assertHrPrintGeometry(mobileGeometry, '390x844 ready preview', { previewReady: true, stacked: true });

    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(100);
    assertHrPrintGeometry(await readHrPrintGeometry(page, dialog), '320x568 ready preview', { previewReady: true, stacked: true });

    const pageErrors = [];
    const collectPageError = error => pageErrors.push(error.message || String(error));
    page.on('pageerror', collectPageError);
    let releaseDelayedRequest;
    let markRequestPaused;
    const requestPaused = new Promise(resolve => { markRequestPaused = resolve; });
    const delayedRequestRelease = new Promise(resolve => { releaseDelayedRequest = resolve; });
    const delayedRoute = async route => {
        markRequestPaused();
        await delayedRequestRelease;
        await route.continue();
    };
    await page.route('**/api/hr/attendance-documents/pdf', delayedRoute);
    const closedResponsePromise = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/hr/attendance-documents/pdf'
    ), { timeout: 30000 });
    await dialog.getByRole('button', { name: 'Сформувати preview' }).click();
    await requestPaused;
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false, 'Escape closes print modal during generation');
    releaseDelayedRequest();
    assert.equal((await closedResponsePromise).status(), 200, 'in-flight preview response can finish after modal close');
    await page.waitForTimeout(250);
    await page.unroute('**/api/hr/attendance-documents/pdf', delayedRoute);
    page.off('pageerror', collectPageError);
    assert.deepEqual(pageErrors, [], 'closing during preview does not raise browser errors');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'btnHrPrintDocuments', 'print modal restores opener focus');
    page.off('request', countPdfRequest);
    await page.setViewportSize({ width: 1440, height: 900 });
}

async function runHrPulseFlow(page, base) {
    await page.goto(`${base}/hr#today`, { waitUntil: 'domcontentloaded' });
    await assertThemeMode(page, 'today tab');
    await assertHrShell(page, '#today', 'today tab');
    await assertPulseNavClean(page, 'today tab');
    await assertNoScheduleIframe(page, 'today tab');
    await assertHrPrintDocuments(page);

    await page.locator('.hr-pulse-card').filter({ hasText: 'Графік' }).first().click();
    await assertHrShell(page, '#schedule', 'schedule click');
    await assertPulseNavClean(page, 'schedule click');
    await assertNoScheduleIframe(page, 'schedule click');
    await assertStaffScheduleInitialized(page, 'HR schedule tab');
    await assertLightScheduleCommandBar(page, 'HR schedule tab');

    await page.locator('.hr-pulse-card').filter({ hasText: 'Звіти' }).first().click();
    await assertHrShell(page, '#reports', 'reports click');
    await assertPulseNavClean(page, 'reports click');
    await assertNoScheduleIframe(page, 'reports click');
}

async function runStandaloneStaffFlow(page, base) {
    await page.goto(`${base}/staff`, { waitUntil: 'domcontentloaded' });
    await assertThemeMode(page, 'standalone staff');
    const url = new URL(page.url());
    assert.equal(url.pathname, '/staff', 'standalone staff route stays on /staff');
    assert.equal(await page.locator('[data-staff-schedule-shell="standalone"]').count(), 1, 'standalone staff schedule shell exists');
    await assertStaffScheduleInitialized(page, 'standalone staff schedule');
    await assertLightScheduleCommandBar(page, 'standalone staff schedule');
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
