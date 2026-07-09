#!/usr/bin/env node
'use strict';

/**
 * Read-only live/staging browser smoke for the staff schedule page.
 *
 * Read-only guarantee:
 * - Uses POST only for authentication when token auth is not provided.
 * - Never clicks add/fill/copy/import controls and never edits schedule cells.
 * - Fails the run if a staff mutation endpoint is requested by the browser.
 *
 * Usage:
 *   npm run smoke:staff-schedule -- https://example.up.railway.app
 *   LIVE_SMOKE_URL=https://example.up.railway.app LIVE_SMOKE_USER=... LIVE_SMOKE_PASS=... npm run smoke:staff-schedule
 *   LIVE_SMOKE_TOKEN=<jwt> npm run smoke:staff-schedule -- https://example.up.railway.app
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('LIVE_STAFF_SCHEDULE_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const BUSINESS_CONTEXT = readEnv('LIVE_STAFF_SCHEDULE_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const HEADLESS = readEnv('LIVE_STAFF_SCHEDULE_HEADLESS', 'LIVE_SMOKE_HEADLESS') !== 'false';
const TIMEOUT_MS = Number(readEnv('LIVE_STAFF_SCHEDULE_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 30000);
const RUN_ID = `staff-schedule-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'live-staff-schedule-smoke', RUN_ID);

const VIEWPORTS = Object.freeze({
    desktop: Object.freeze({ width: 1440, height: 900 }),
    mobile: Object.freeze({ width: 390, height: 844 })
});

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function fail(message) {
    console.error(`Live staff schedule smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

async function readBody(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

function responseDetail(body) {
    return body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || '';
}

async function fetchJson(base, routePath, options = {}) {
    const res = await fetch(`${base}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(res);
    if (!res.ok) {
        throw new Error(`${routePath} returned ${res.status}${responseDetail(body) ? `: ${responseDetail(body)}` : ''}`);
    }
    return body;
}

function extractToken(body = {}) {
    return body.accessToken
        || body.access_token
        || body.token
        || body.jwt
        || body.data?.accessToken
        || body.data?.access_token
        || body.data?.token
        || '';
}

async function login(base) {
    const token = readEnv('LIVE_STAFF_SCHEDULE_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified, source: 'token' };
    }

    const username = readEnv('LIVE_STAFF_SCHEDULE_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('LIVE_STAFF_SCHEDULE_PASS', 'LIVE_STAFF_SCHEDULE_PASSWORD', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS', 'TEST_PASSWORD');
    if (!username || !password) {
        throw new Error('provide LIVE_SMOKE_TOKEN or LIVE_SMOKE_USER/LIVE_SMOKE_PASS or TEST_USER/TEST_PASS');
    }

    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const accessToken = extractToken(body);
    if (!accessToken) throw new Error('/api/auth/login did not return an access token');
    return {
        token: accessToken,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user || null,
        source: 'login'
    };
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

function staffUrl(base) {
    const url = new URL('/staff', base);
    url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    url.searchParams.set('smoke', RUN_ID);
    return url.toString();
}

async function openAuthenticatedContext(browser, session, viewport) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user, businessContext }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_crm_business_context', businessContext);
        localStorage.setItem('pzp_dark_mode', 'true');
    }, {
        token: session.token,
        refreshToken: session.refreshToken || '',
        refreshExpiresAt: session.refreshExpiresAt || '',
        user: session.user || null,
        businessContext: BUSINESS_CONTEXT
    });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    return { context, page };
}

function isForbiddenStaffMutation(method, pathname) {
    const normalizedMethod = String(method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) return false;
    if (pathname === '/api/auth/login' || pathname === '/api/auth/refresh' || pathname === '/api/auth/logout') return false;
    if (pathname === '/api/staff/schedule/bulk') return true;
    if (pathname === '/api/staff/schedule/copy-week') return true;
    if (pathname === '/api/staff/import-excel') return true;
    if (/^\/api\/staff(?:\/|$)/.test(pathname)) return true;
    if (/^\/api\/users(?:\/|$)/.test(pathname)) return true;
    return false;
}

function attachReadOnlyGuard(page, label) {
    const forbidden = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (isForbiddenStaffMutation(request.method(), url.pathname)) {
            forbidden.push(`${label}: ${request.method()} ${url.pathname}`);
        }
    });
    return forbidden;
}

function assertNoForbiddenStaffWrites(forbidden, label) {
    assert.deepEqual(forbidden, [], `${label}: browser sent forbidden staff mutation request(s)`);
}

function formatInputDate(date) {
    return date.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return formatInputDate(date);
}

function dateRangeDays(from, to) {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

async function waitForStaffSchedule(page, base) {
    await page.goto(staffUrl(base), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(
        document.getElementById('scheduleWrapper')
        && document.getElementById('scheduleHead')
        && document.getElementById('scheduleBody')
        && document.getElementById('scheduleDateFrom')
        && document.getElementById('scheduleDateTo')
        && document.getElementById('exportExcelBtn')
        && document.getElementById('printBtn')
    ));
    await page.waitForFunction(() => document.querySelectorAll('#scheduleHead th').length > 1);
}

async function waitForDayColumns(page, expected) {
    await page.waitForFunction(count => {
        return document.querySelectorAll('#scheduleHead th').length === count + 1;
    }, expected);
}

async function waitForColumnsToMatchInputs(page) {
    await page.waitForFunction(() => {
        const from = document.getElementById('scheduleDateFrom')?.value || '';
        const to = document.getElementById('scheduleDateTo')?.value || '';
        if (!from || !to) return false;
        const start = new Date(`${from}T00:00:00Z`);
        const end = new Date(`${to}T00:00:00Z`);
        const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
        return Number.isFinite(days)
            && days > 0
            && document.querySelectorAll('#scheduleHead th').length === days + 1;
    });
}

async function dayColumnCount(page) {
    return page.evaluate(() => Math.max(0, document.querySelectorAll('#scheduleHead th').length - 1));
}

async function readRangeState(page) {
    return page.evaluate(() => ({
        from: document.getElementById('scheduleDateFrom')?.value || '',
        to: document.getElementById('scheduleDateTo')?.value || '',
        label: document.getElementById('weekLabel')?.textContent?.trim() || '',
        dayCount: Math.max(0, document.querySelectorAll('#scheduleHead th').length - 1)
    }));
}

async function applyPreset(page, preset) {
    await page.locator(`[data-schedule-range-preset="${preset}"]`).click();
    await page.waitForFunction(expected => {
        const button = document.querySelector(`[data-schedule-range-preset="${expected}"]`);
        return button && button.classList.contains('active');
    }, preset);
}

async function assertHeaderSurface(page) {
    assert.equal(await page.locator('.schedule-toolbar').count(), 0, 'legacy .schedule-toolbar is absent');
    await page.locator('.staff-schedule-header-actions #exportExcelBtn').waitFor({ state: 'visible' });
    await page.locator('.staff-schedule-header-actions #printBtn').waitFor({ state: 'visible' });
    await page.locator('#scheduleViewSwitch').waitFor({ state: 'visible' });
    await page.locator('#scheduleDateFrom').waitFor({ state: 'visible' });
    await page.locator('#scheduleDateTo').waitFor({ state: 'visible' });
    await page.locator('#applyScheduleRangeBtn').waitFor({ state: 'visible' });
}

async function assertCompactHeaderActions(page) {
    const legacyActionSelectors = ['#scheduleActionsDropdown', '#scheduleActionsMenuBtn', '#scheduleActionsMenu', '#addStaffBtn', '#fillWeekBtn', '#copyWeekBtn', '#importExcelBtn'];
    for (const selector of legacyActionSelectors) {
        assert.equal(await page.locator(selector).count(), 0, `${selector} is not visible staff schedule UI`);
    }

    const metrics = await page.evaluate(() => {
        const header = document.querySelector('.staff-schedule-header-actions')?.getBoundingClientRect();
        const exportButton = document.getElementById('exportExcelBtn')?.getBoundingClientRect();
        const printButton = document.getElementById('printBtn')?.getBoundingClientRect();
        return {
            header: header ? { width: header.width, height: header.height } : null,
            exportButton: exportButton ? { width: exportButton.width, height: exportButton.height } : null,
            printButton: printButton ? { width: printButton.width, height: printButton.height } : null
        };
    });
    assert.ok(metrics.header?.width > 0, 'compact header actions are measurable');
    assert.ok(metrics.exportButton?.height >= 34, 'export keeps a usable touch target');
    assert.ok(metrics.printButton?.height >= 34, 'print keeps a usable touch target');
    assert.ok(metrics.header.width <= 240, 'export/print action group stays compact');
}

async function assertViewSwitchReadOnlyModes(page) {
    assert.equal(await page.locator('[data-schedule-view="schedule"]').getAttribute('aria-pressed'), 'true', 'schedule view starts active');

    await page.locator('[data-schedule-view="hours"]').click();
    await page.waitForFunction(() => document.querySelector('[data-schedule-view="hours"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#scheduleBody').evaluate(el => el.classList.contains('show-hours')), true, 'hours view marks schedule rows');

    await page.locator('[data-schedule-view="load"]').click();
    await page.locator('#loadViewWrapper').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-schedule-view="load"]').getAttribute('aria-pressed'), 'true', 'load view becomes active');
    assert.equal(await page.locator('#scheduleWrapper').isHidden(), true, 'load view hides the main schedule wrapper');

    await page.locator('[data-schedule-view="accounts"]').click();
    await page.locator('#scheduleWrapper').waitFor({ state: 'visible' });
    await page.locator('#linkStatsBar').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-schedule-view="accounts"]').getAttribute('aria-pressed'), 'true', 'accounts view becomes active');

    await page.locator('[data-schedule-view="schedule"]').click();
    await page.waitForFunction(() => document.querySelector('[data-schedule-view="schedule"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#linkStatsBar').count(), 0, 'schedule view removes account stats');
    assert.equal(await page.locator('#scheduleWrapper').isVisible(), true, 'schedule view restores the main schedule wrapper');
}

async function assertInvalidRangesStayPut(page, from, to) {
    const callsBefore = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter(entry => String(entry.name || '').includes('/api/staff/schedule?')).length);

    await page.locator('#scheduleDateFrom').fill(to);
    await page.locator('#scheduleDateTo').fill(from);
    await page.locator('#applyScheduleRangeBtn').click();
    await page.waitForFunction(expected => document.getElementById('scheduleDateFrom')?.value === expected, from);
    await page.waitForFunction(expected => document.getElementById('scheduleDateTo')?.value === expected, to);
    await waitForDayColumns(page, 15);

    const tooLongTo = addDays(from, 40);
    await page.locator('#scheduleDateFrom').fill(from);
    await page.locator('#scheduleDateTo').fill(tooLongTo);
    await page.locator('#applyScheduleRangeBtn').click();
    await page.waitForFunction(expected => document.getElementById('scheduleDateTo')?.value === expected, to);
    await waitForDayColumns(page, 15);

    const callsAfter = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter(entry => String(entry.name || '').includes('/api/staff/schedule?')).length);
    assert.equal(callsAfter, callsBefore, 'invalid ranges do not refetch schedule data');
}

async function assertSearchPersistence(page) {
    const searchTerm = await page.evaluate(() => {
        const text = Array.from(document.querySelectorAll('#scheduleBody .emp-name, #scheduleBody [data-hr-profile]'))
            .map(el => el.textContent || '')
            .join(' ')
            .trim()
            .split(/\s+/)
            .find(Boolean);
        return text ? text.slice(0, 12) : 'staff-smoke';
    });
    await page.locator('#scheduleStaffSearch').fill(searchTerm);
    await applyPreset(page, 'month');
    await waitForColumnsToMatchInputs(page);
    assert.equal(await page.locator('#scheduleStaffSearch').inputValue(), searchTerm, 'search query survives period preset changes');

    const range = await readRangeState(page);
    const monthDays = dateRangeDays(range.from, range.to);
    assert.equal(range.dayCount, monthDays, 'month preset renders all month day columns');
    assert.ok(monthDays >= 28 && monthDays <= 31, `month preset day count is ${monthDays}`);
    return range;
}

async function assertWideScheduleLayout(page, label, options = {}) {
    const wrapperSelector = options.wrapperSelector || '#scheduleWrapper';
    const expectedDays = options.expectedDays;
    const expectedHeaderCount = options.expectedHeaderCount || expectedDays;
    const minDayWidth = options.minDayWidth || 96;
    const metrics = await page.evaluate(({ wrapperSelector, expectedDays, expectedHeaderCount }) => {
        const wrapper = document.querySelector(wrapperSelector);
        const table = wrapper?.querySelector('.schedule-table');
        const dayHeaderSelector = wrapperSelector === '#loadViewWrapper'
            ? 'thead th:not(:first-child):not(:last-child)'
            : 'thead th:not(:first-child)';
        const dayHeaders = table ? Array.from(table.querySelectorAll(dayHeaderSelector)) : [];
        const firstHeader = table?.querySelector('thead th:first-child');
        const firstBodyCell = table?.querySelector('tbody tr:not(.dept-row):not(.sub-group-row) > td:first-child');
        if (!wrapper || !table || !firstHeader || !firstBodyCell) return null;
        wrapper.scrollLeft = Math.min(260, Math.max(0, wrapper.scrollWidth - wrapper.clientWidth));
        const wrapperBox = wrapper.getBoundingClientRect();
        const tableBox = table.getBoundingClientRect();
        const firstHeaderBox = firstHeader.getBoundingClientRect();
        const firstBodyBox = firstBodyCell.getBoundingClientRect();
        const dayWidths = dayHeaders.map(header => header.getBoundingClientRect().width).filter(Boolean);
        return {
            isLongRange: wrapper.classList.contains('is-long-range'),
            isFullRange: wrapper.classList.contains('is-full-range'),
            dataDays: Number(wrapper.dataset.scheduleDayCount || 0),
            wrapperClientWidth: wrapper.clientWidth,
            wrapperScrollWidth: wrapper.scrollWidth,
            tableWidth: tableBox.width,
            minDayWidth: dayWidths.length ? Math.min(...dayWidths) : 0,
            maxDayWidth: dayWidths.length ? Math.max(...dayWidths) : 0,
            dayHeaderCount: dayHeaders.length,
            expectedDays,
            expectedHeaderCount,
            firstHeaderPosition: getComputedStyle(firstHeader).position,
            firstBodyPosition: getComputedStyle(firstBodyCell).position,
            firstHeaderLeft: firstHeaderBox.left,
            firstBodyLeft: firstBodyBox.left,
            wrapperLeft: wrapperBox.left,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
        };
    }, { wrapperSelector, expectedDays, expectedHeaderCount });
    assert.ok(metrics, `${label}: wide layout metrics are available`);
    assert.equal(metrics.isLongRange, true, `${label}: wrapper enters long-range mode`);
    if (expectedDays >= 28) assert.equal(metrics.isFullRange, true, `${label}: wrapper enters full-range mode`);
    assert.equal(metrics.dataDays, expectedDays, `${label}: wrapper records visible day count`);
    assert.equal(metrics.dayHeaderCount, expectedHeaderCount, `${label}: day header count matches range`);
    assert.ok(metrics.wrapperScrollWidth > metrics.wrapperClientWidth + 20, `${label}: wrapper owns horizontal scrolling`);
    assert.ok(metrics.tableWidth >= metrics.wrapperScrollWidth - 2, `${label}: table width matches wrapper scroll width`);
    assert.ok(metrics.minDayWidth >= minDayWidth, `${label}: date columns remain readable`);
    assert.ok(metrics.maxDayWidth - metrics.minDayWidth <= 2, `${label}: date columns stay aligned`);
    assert.equal(metrics.firstHeaderPosition, 'sticky', `${label}: header first column is sticky`);
    assert.equal(metrics.firstBodyPosition, 'sticky', `${label}: body first column is sticky`);
    assert.ok(Math.abs(metrics.firstHeaderLeft - metrics.wrapperLeft) <= 3, `${label}: sticky header column stays pinned after scroll`);
    assert.ok(Math.abs(metrics.firstBodyLeft - metrics.wrapperLeft) <= 3, `${label}: sticky body column stays pinned after scroll`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, `${label}: page has no global horizontal overflow`);
}

async function assertExportFilename(page, range) {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportExcelBtn').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), `grafik_${range.from}_${range.to}.csv`, 'export filename uses selected period');
    await download.delete().catch(() => {});
}

async function assertPrintStub(page) {
    await page.evaluate(() => {
        window.__staffSchedulePrintCount = 0;
        window.print = () => {
            window.__staffSchedulePrintCount += 1;
        };
    });
    await page.locator('#printBtn').click();
    assert.equal(await page.evaluate(() => window.__staffSchedulePrintCount), 1, 'print button calls window.print exactly once');
}

async function assertMobileLayout(page) {
    const metrics = await page.evaluate(() => {
        const rect = selector => {
            const el = document.querySelector(selector);
            const box = el?.getBoundingClientRect?.();
            if (!box) return null;
            return {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                width: box.width,
                height: box.height
            };
        };
        const command = rect('.staff-schedule-command-bar');
        const range = rect('.staff-schedule-range-row');
        const actions = rect('.staff-schedule-header-actions');
        const search = rect('.staff-schedule-search-row');
        const dept = rect('#deptFilter');
        const wrapper = document.querySelector('#scheduleWrapper');
        return {
            command,
            range,
            actions,
            search,
            dept,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            wrapperClientWidth: wrapper?.clientWidth || 0,
            wrapperScrollWidth: wrapper?.scrollWidth || 0
        };
    });
    assert.ok(metrics.command?.width > 0, 'mobile command bar is visible');
    assert.ok(metrics.range?.width > 0, 'mobile range row is visible');
    assert.ok(metrics.actions?.width > 0, 'mobile header actions are visible');
    assert.ok(metrics.search?.width > 0, 'mobile search row is visible');
    assert.ok(metrics.dept?.width > 0, 'mobile department chips row is visible');
    assert.ok(metrics.range.right <= metrics.command.right + 2, 'mobile range row stays inside command bar');
    assert.ok(metrics.actions.right <= metrics.command.right + 2, 'mobile header actions stay inside command bar');
    assert.ok(metrics.search.right <= metrics.command.right + 2, 'mobile search row stays inside command bar');
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, 'mobile page has no global horizontal overflow');
    assert.ok(metrics.wrapperScrollWidth >= metrics.wrapperClientWidth, 'schedule wrapper owns horizontal table overflow');
}

async function runDesktopFlow(browser, base, session) {
    let context;
    let page;
    let forbidden = [];
    try {
        ({ context, page } = await openAuthenticatedContext(browser, session, VIEWPORTS.desktop));
        forbidden = attachReadOnlyGuard(page, 'desktop');
        await waitForStaffSchedule(page, base);
        await assertHeaderSurface(page);
        await waitForDayColumns(page, 9);
        assert.equal(await dayColumnCount(page), 9, 'default schedule range is 9 days');

        await applyPreset(page, 'first-half');
        await waitForDayColumns(page, 15);
        const firstHalf = await readRangeState(page);
        assert.equal(firstHalf.from.endsWith('-01'), true, '1-15 preset starts on day 1');
        assert.equal(firstHalf.to.endsWith('-15'), true, '1-15 preset ends on day 15');
        assert.equal(firstHalf.dayCount, 15, '1-15 preset renders 15 day columns');
        assert.match(firstHalf.label, /1[\s\S]+15[\s\S]+20\d{2}/, 'period label reflects 1-15 range');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-first-half.png'), fullPage: true });
        await assertCompactHeaderActions(page);
        await assertViewSwitchReadOnlyModes(page);

        await assertInvalidRangesStayPut(page, firstHalf.from, firstHalf.to);
        const monthRange = await assertSearchPersistence(page);
        const monthDays = dateRangeDays(monthRange.from, monthRange.to);
        await page.locator('#scheduleStaffSearch').fill('');
        await waitForColumnsToMatchInputs(page);
        await assertWideScheduleLayout(page, 'desktop month schedule', { expectedDays: monthDays, minDayWidth: 136 });
        await page.locator('[data-schedule-view="load"]').click();
        await page.locator('#loadViewWrapper').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#loadViewHead th').count(), monthDays + 2, 'live load view header uses all month dates plus metric and total columns');
        await assertWideScheduleLayout(page, 'desktop month load view', {
            wrapperSelector: '#loadViewWrapper',
            expectedDays: monthDays,
            minDayWidth: 78
        });
        await page.locator('[data-schedule-view="schedule"]').click();
        await page.waitForFunction(() => document.querySelector('[data-schedule-view="schedule"]')?.getAttribute('aria-pressed') === 'true');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-month-search.png'), fullPage: true });

        await assertExportFilename(page, monthRange);
        await assertPrintStub(page);
        assertNoForbiddenStaffWrites(forbidden, 'desktop');

        return {
            defaultDays: 9,
            firstHalf: `${firstHalf.from}..${firstHalf.to}`,
            month: `${monthRange.from}..${monthRange.to}`,
            exportFilename: `grafik_${monthRange.from}_${monthRange.to}.csv`,
            headerActions: 'export/print'
        };
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
    }
}

async function runMobileFlow(browser, base, session) {
    let context;
    let page;
    let forbidden = [];
    try {
        ({ context, page } = await openAuthenticatedContext(browser, session, VIEWPORTS.mobile));
        forbidden = attachReadOnlyGuard(page, 'mobile');
        await waitForStaffSchedule(page, base);
        await assertHeaderSurface(page);
        await assertCompactHeaderActions(page);
        await applyPreset(page, 'first-half');
        await waitForDayColumns(page, 15);
        await page.locator('#scheduleStaffSearch').fill('staff-smoke');
        assert.equal(await page.locator('#scheduleStaffSearch').inputValue(), 'staff-smoke', 'mobile search input accepts text');
        await assertMobileLayout(page);
        await page.locator('#scheduleStaffSearch').fill('');
        await applyPreset(page, 'month');
        await waitForColumnsToMatchInputs(page);
        const monthRange = await readRangeState(page);
        await assertMobileLayout(page);
        await assertWideScheduleLayout(page, 'mobile month schedule', { expectedDays: monthRange.dayCount, minDayWidth: 120 });
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-month.png'), fullPage: true });
        assertNoForbiddenStaffWrites(forbidden, 'mobile');

        return {
            month: `${monthRange.from}..${monthRange.to}`,
            dayCount: monthRange.dayCount
        };
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
    }
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or LIVE_STAFF_SCHEDULE_URL/LIVE_SMOKE_URL/TEST_URL');
    const base = normalizeBase(TARGET_URL);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node scripts/live-staff-schedule-smoke.js');
    }

    const session = await login(base);
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    try {
        const desktop = await runDesktopFlow(browser, base, session);
        const mobile = await runMobileFlow(browser, base, session);

        console.log(`Live staff schedule smoke OK: ${base}`);
        console.log(`  OK desktop: default=${desktop.defaultDays}d, firstHalf=${desktop.firstHalf}, month=${desktop.month}`);
        console.log(`  OK controls: headerActions=${desktop.headerActions}, viewSwitch=hours/load/accounts/schedule`);
        console.log(`  OK export: ${desktop.exportFilename}`);
        console.log(`  OK print: stubbed window.print`);
        console.log(`  OK mobile: month=${mobile.month}, days=${mobile.dayCount}`);
        console.log(`  OK read-only guard: no staff mutation requests`);
        console.log(`  OK screenshots: ${path.relative(ROOT, OUTPUT_DIR)}`);
    } finally {
        await browser.close().catch(() => {});
    }
}

run().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
