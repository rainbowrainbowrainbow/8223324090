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
const STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY = 'pzp_staff_schedule_expanded_groups';

const VIEWPORTS = Object.freeze({
    desktop: Object.freeze({ width: 1440, height: 900 }),
    mobile: Object.freeze({ width: 390, height: 844 }),
    narrowMobile: Object.freeze({ width: 360, height: 800 })
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
        if (!sessionStorage.getItem('staff_schedule_smoke_storage_ready')) {
            localStorage.removeItem('pzp_staff_schedule_expanded_groups');
            sessionStorage.setItem('staff_schedule_smoke_storage_ready', 'true');
        }
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
    await page.locator('#scheduleDateFrom').waitFor({ state: 'visible' });
    await page.locator('#scheduleDateTo').waitFor({ state: 'visible' });
    await page.locator('#applyScheduleRangeBtn').waitFor({ state: 'visible' });
    const { presetState, expectedLabels } = await page.locator('[data-schedule-range-preset]').evaluateAll(buttons => {
        const from = document.getElementById('scheduleDateFrom')?.value || '';
        const base = from ? new Date(`${from}T00:00:00`) : new Date();
        const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        return {
            expectedLabels: [`1-${Math.min(15, lastDay)}`, `${Math.min(16, lastDay)}-${lastDay}`, 'Весь місяць'],
            presetState: buttons.map(button => ({
                preset: button.getAttribute('data-schedule-range-preset'),
                label: button.textContent.trim(),
                title: button.getAttribute('title') || '',
                ariaLabel: button.getAttribute('aria-label') || ''
            }))
        };
    });
    assert.deepEqual(presetState.map(item => item.label), expectedLabels, 'period preset labels expose concrete current-month dates');
    assert.equal(presetState.some(item => item.label.includes('половина') || item.label.includes('кінець')), false, 'period preset labels do not use vague half-month copy');
    assert.equal(presetState.find(item => item.preset === 'second-half')?.ariaLabel, `Показати ${expectedLabels[1]} число місяця`, 'second-half preset keeps an accessible date-range label');
    assert.match(presetState.find(item => item.preset === 'second-half')?.title || '', /16/, 'second-half preset title explains the date range');
    const summaryState = await page.locator('#scheduleSummary').evaluate(summary => ({
        hidden: summary.hidden,
        text: summary.textContent.trim(),
        chipCount: summary.querySelectorAll('.summary-chip').length
    }));
    assert.equal(summaryState.hidden, true, 'schedule summary is hidden in the schedule section');
    assert.equal(summaryState.text, '', 'schedule summary does not render extra status text');
    assert.equal(summaryState.chipCount, 0, 'schedule summary status chips are removed');
}

async function assertNoDuplicateDepartmentSubGroups(page) {
    const duplicates = await page.locator('#scheduleBody').evaluate(tbody => {
        const normalizeRowLabel = (row, iconSelector, countSelector) => {
            const clone = row.cloneNode(true);
            clone.querySelectorAll(`${iconSelector},${countSelector},.schedule-group-caret`).forEach(node => node.remove());
            const explicitLabel = clone.querySelector('.schedule-group-label');
            if (explicitLabel) return explicitLabel.textContent.trim().replace(/\s+/g, ' ').toLowerCase();
            return clone.textContent.trim().replace(/\s+/g, ' ').toLowerCase();
        };
        const result = [];
        let currentDepartment = '';
        for (const row of Array.from(tbody.querySelectorAll('tr'))) {
            if (row.classList.contains('dept-row')) {
                currentDepartment = normalizeRowLabel(row, '.dept-icon', '.dept-count');
            } else if (row.classList.contains('sub-group-row')) {
                const subgroup = normalizeRowLabel(row, '.sub-group-icon', '.sub-group-count');
                if (currentDepartment && subgroup && currentDepartment === subgroup) result.push(subgroup);
            }
        }
        return result;
    });
    assert.deepEqual(duplicates, [], 'schedule table does not render duplicate department/subgroup labels');
}

async function assertDepartmentFiltersRenderOnlyActiveGroup(page) {
    await page.locator('#scheduleStaffSearch').fill('');
    const filters = await page.locator('#deptFilter .dept-chip:not([data-dept="all"])').evaluateAll(buttons => buttons
        .map(button => ({
            key: button.getAttribute('data-dept') || '',
            label: button.querySelector('.dept-chip-label')?.textContent?.trim() || button.textContent.trim(),
            count: Number(button.querySelector('.dept-chip-count')?.textContent?.trim() || 0)
        }))
        .filter(item => item.key && item.count > 0));
    assert.ok(filters.length > 0, 'department filter chips with staff are rendered');

    for (const filter of filters) {
        await page.evaluate(key => {
            document.querySelector(`#deptFilter .dept-chip[data-dept="${CSS.escape(key)}"]`)?.click();
        }, filter.key);
        await page.waitForFunction(key => {
            return document.querySelector(`#deptFilter .dept-chip[data-dept="${CSS.escape(key)}"]`)?.getAttribute('aria-pressed') === 'true';
        }, filter.key);

        const state = await page.locator('#scheduleBody').evaluate(tbody => ({
            departments: Array.from(tbody.querySelectorAll('tr.dept-row')).map(row => row.getAttribute('data-dept') || ''),
            hasEmptyState: Boolean(tbody.querySelector('.schedule-health-empty-row'))
        }));
        assert.equal(state.hasEmptyState, false, `${filter.label}: active department filter has visible schedule groups`);
        assert.ok(state.departments.length > 0, `${filter.label}: active department filter renders a group header`);
        assert.deepEqual(
            Array.from(new Set(state.departments)),
            [filter.key],
            `${filter.label}: active department filter renders only its own schedule group`
        );
    }

    await page.evaluate(() => document.querySelector('#deptFilter .dept-chip[data-dept="all"]')?.click());
    await page.waitForFunction(() => document.querySelector('#deptFilter .dept-chip[data-dept="all"]')?.getAttribute('aria-pressed') === 'true');
}

async function scheduleEmployeeRowCount(page) {
    return page.locator('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').count();
}

async function assertScheduleGroupsCollapsedByDefault(page) {
    const toggles = page.locator('[data-schedule-group-toggle]');
    const count = await toggles.count();
    assert.ok(count > 0, 'schedule group toggles are rendered');
    assert.deepEqual(await toggles.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-expanded'))), Array(count).fill('false'), 'schedule groups are collapsed by default');
    assert.equal(await scheduleEmployeeRowCount(page), 0, 'collapsed schedule groups hide employee rows by default');

    const firstToggle = toggles.first();
    await firstToggle.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'true');
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'Enter expands a schedule group');

    await page.locator('[data-schedule-group-toggle]').first().press('Space');
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await scheduleEmployeeRowCount(page), 0, 'Space collapses a schedule group');

    await firstToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'true');
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'click expands a schedule group');
    await firstToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await scheduleEmployeeRowCount(page), 0, 'repeated click collapses a schedule group');
}

async function assertScheduleGroupExpansionPersists(page) {
    const firstToggle = page.locator('[data-schedule-group-toggle]').first();
    const groupKey = await firstToggle.getAttribute('data-schedule-group-toggle');
    assert.ok(groupKey, 'first schedule group exposes a stable state key');

    await firstToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'true');
    await page.waitForFunction(({ storageKey, groupKey }) => {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
            return Array.isArray(saved) && saved.includes(groupKey);
        } catch {
            return false;
        }
    }, { storageKey: STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY, groupKey });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.StaffSchedulePage?.isInitialized?.()), null, { timeout: TIMEOUT_MS });
    await page.waitForFunction(groupKey => {
        return Array.from(document.querySelectorAll('[data-schedule-group-toggle]'))
            .some(button => button.dataset.scheduleGroupToggle === groupKey && button.getAttribute('aria-expanded') === 'true');
    }, groupKey, { timeout: TIMEOUT_MS });
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'expanded schedule group persists after reload');

    await page.evaluate(storageKey => localStorage.removeItem(storageKey), STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.StaffSchedulePage?.isInitialized?.()), null, { timeout: TIMEOUT_MS });
    await page.waitForFunction(() => {
        const toggles = Array.from(document.querySelectorAll('[data-schedule-group-toggle]'));
        return toggles.length > 0 && toggles.every(button => button.getAttribute('aria-expanded') === 'false');
    }, null, { timeout: TIMEOUT_MS });
}

async function assertScheduleSearchAutoExpandsGroups(page) {
    const searchTerm = await page.locator('[data-schedule-group-toggle]').first().getAttribute('data-schedule-group-toggle') || 'staff';
    await page.locator('#scheduleStaffSearch').fill(searchTerm);
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length > 0);
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'active search reveals matching rows even when groups are collapsed');
    assert.ok((await page.locator('[data-schedule-group-toggle][aria-expanded="true"]').count()) > 0, 'active search marks matching groups expanded for accessibility');
    await page.locator('#scheduleStaffSearch').fill('');
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length === 0);
}

async function expandAllScheduleGroups(page) {
    for (let i = 0; i < 30; i += 1) {
        const collapsed = page.locator('[data-schedule-group-toggle][aria-expanded="false"]');
        if (!(await collapsed.count())) break;
        await collapsed.first().click();
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-schedule-group-toggle][aria-expanded="false"]').length === 0);
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length > 0);
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

async function assertScheduleExtraViewsRemoved(page) {
    assert.equal(await page.locator('#scheduleViewSwitch').count(), 0, 'visible schedule view switch is removed');
    assert.equal(await page.locator('[data-schedule-view]').count(), 0, 'schedule diagnostic view buttons are removed');
    assert.equal(await page.locator('.staff-schedule-command-metrics').count(), 0, 'schedule header metric chips are removed');
    assert.equal(await page.locator('#scheduleSummary .summary-chip').count(), 0, 'schedule summary status chips are removed');
    assert.equal(await page.locator('#scheduleBody').evaluate(el => el.classList.contains('show-hours')), false, 'removed hours view cannot mark schedule rows');
    assert.equal(await page.locator('#loadViewWrapper').isHidden(), true, 'removed load view stays hidden');
    assert.equal(await page.locator('#linkStatsBar').count(), 0, 'removed accounts view does not render account stats');
    assert.equal(await page.locator('#scheduleWrapper').isVisible(), true, 'main schedule wrapper remains visible');
}

async function assertInvalidRangesStayPut(page, from, to) {
    const expectedDays = dateRangeDays(from, to);
    const callsBefore = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter(entry => String(entry.name || '').includes('/api/staff/schedule?')).length);

    await page.locator('#scheduleDateFrom').fill(to);
    await page.locator('#scheduleDateTo').fill(from);
    await page.locator('#applyScheduleRangeBtn').click();
    await page.waitForFunction(expected => document.getElementById('scheduleDateFrom')?.value === expected, from);
    await page.waitForFunction(expected => document.getElementById('scheduleDateTo')?.value === expected, to);
    await waitForDayColumns(page, expectedDays);

    const tooLongTo = addDays(from, 40);
    await page.locator('#scheduleDateFrom').fill(from);
    await page.locator('#scheduleDateTo').fill(tooLongTo);
    await page.locator('#applyScheduleRangeBtn').click();
    await page.waitForFunction(expected => document.getElementById('scheduleDateTo')?.value === expected, to);
    await waitForDayColumns(page, expectedDays);

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

async function assertFittedScheduleLayout(page, label, options = {}) {
    const expectedDays = options.expectedDays;
    const metrics = await page.evaluate(expectedDays => {
        const wrapper = document.querySelector('#scheduleWrapper');
        const table = wrapper?.querySelector('.schedule-table');
        const dayHeaders = table ? Array.from(table.querySelectorAll('thead th:not(:first-child)')) : [];
        const dayWidths = dayHeaders.map(header => header.getBoundingClientRect().width).filter(Boolean);
        if (!wrapper || !table) return null;
        return {
            isLongRange: wrapper.classList.contains('is-long-range'),
            isFullRange: wrapper.classList.contains('is-full-range'),
            dataDays: Number(wrapper.dataset.scheduleDayCount || 0),
            wrapperClientWidth: wrapper.clientWidth,
            wrapperScrollWidth: wrapper.scrollWidth,
            tableWidth: table.getBoundingClientRect().width,
            minDayWidth: dayWidths.length ? Math.min(...dayWidths) : 0,
            maxDayWidth: dayWidths.length ? Math.max(...dayWidths) : 0,
            dayHeaderCount: dayHeaders.length,
            expectedDays,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
        };
    }, expectedDays);
    assert.ok(metrics, `${label}: fitted layout metrics are available`);
    assert.equal(metrics.isLongRange, false, `${label}: wrapper does not enter long-range mode`);
    assert.equal(metrics.isFullRange, false, `${label}: wrapper does not enter full-range mode`);
    assert.equal(metrics.dataDays, expectedDays, `${label}: wrapper records visible day count`);
    assert.equal(metrics.dayHeaderCount, expectedDays, `${label}: day header count matches range`);
    assert.ok(metrics.wrapperScrollWidth <= metrics.wrapperClientWidth + 4, `${label}: wrapper does not need horizontal scrolling`);
    assert.ok(metrics.tableWidth <= metrics.wrapperClientWidth + 4, `${label}: table fits the wrapper`);
    assert.ok(metrics.minDayWidth > 0, `${label}: date columns are measurable`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, `${label}: page has no global horizontal overflow`);
}

async function assertExportFilename(page, range) {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportExcelBtn').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), `grafik_${range.from}_${range.to}.xls`, 'export filename uses selected period');
    await download.delete().catch(() => {});
}

async function assertPrintStub(page) {
    await page.evaluate(() => {
        window.__staffSchedulePrintCount = 0;
        window.__staffSchedulePrintHtml = '';
        window.open = () => ({
            document: {
                open() {},
                write(html) {
                    window.__staffSchedulePrintHtml += String(html || '');
                },
                close() {}
            },
            focus() {},
            print() {
                window.__staffSchedulePrintCount += 1;
            },
            close() {},
            setTimeout(callback) {
                callback();
            }
        });
    });
    await page.locator('#printBtn').click();
    await page.waitForFunction(() => window.__staffSchedulePrintCount === 1);
    const printedHtml = await page.evaluate(() => window.__staffSchedulePrintHtml);
    assert.ok(printedHtml.includes('schedule-export-table'), 'print button writes the Excel schedule table');
    assert.ok(printedHtml.includes('Графік роботи'), 'print table includes the schedule title');
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
        await assertNoDuplicateDepartmentSubGroups(page);
        await assertDepartmentFiltersRenderOnlyActiveGroup(page);
        await assertScheduleGroupsCollapsedByDefault(page);
        await assertScheduleGroupExpansionPersists(page);
        await assertScheduleSearchAutoExpandsGroups(page);
        await expandAllScheduleGroups(page);
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
        await assertScheduleExtraViewsRemoved(page);

        await applyPreset(page, 'second-half');
        await waitForColumnsToMatchInputs(page);
        const secondHalf = await readRangeState(page);
        const secondHalfDays = dateRangeDays(secondHalf.from, secondHalf.to);
        assert.equal(secondHalf.from.endsWith('-16'), true, '16-last-day preset starts on day 16');
        assert.ok(secondHalfDays >= 13 && secondHalfDays <= 16, `16-last-day preset day count is ${secondHalfDays}`);
        assert.equal(secondHalf.dayCount, secondHalfDays, '16-last-day preset renders every day column');
        assert.match(secondHalf.label, /16[\s\S]+20\d{2}/, 'period label reflects 16-last-day range');
        await assertFittedScheduleLayout(page, 'desktop second-half schedule', { expectedDays: secondHalfDays });
        await assertScheduleExtraViewsRemoved(page);
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-second-half.png'), fullPage: true });

        await assertInvalidRangesStayPut(page, secondHalf.from, secondHalf.to);

        const monthRange = await assertSearchPersistence(page);
        const monthDays = dateRangeDays(monthRange.from, monthRange.to);
        await page.locator('#scheduleStaffSearch').fill('');
        await waitForColumnsToMatchInputs(page);
        await assertWideScheduleLayout(page, 'desktop month schedule', { expectedDays: monthDays, minDayWidth: 136 });
        await assertScheduleExtraViewsRemoved(page);
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-month-search.png'), fullPage: true });

        await assertExportFilename(page, monthRange);
        await assertPrintStub(page);
        assertNoForbiddenStaffWrites(forbidden, 'desktop');

        return {
            defaultDays: 9,
            firstHalf: `${firstHalf.from}..${firstHalf.to}`,
            secondHalf: `${secondHalf.from}..${secondHalf.to}`,
            month: `${monthRange.from}..${monthRange.to}`,
            exportFilename: `grafik_${monthRange.from}_${monthRange.to}.xls`,
            headerActions: 'export/print',
            filteredGroups: 'active-department-only'
        };
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
    }
}

async function runMobileFlow(browser, base, session, viewport = VIEWPORTS.mobile, label = 'mobile') {
    let context;
    let page;
    let forbidden = [];
    try {
        ({ context, page } = await openAuthenticatedContext(browser, session, viewport));
        forbidden = attachReadOnlyGuard(page, label);
        await waitForStaffSchedule(page, base);
        await assertHeaderSurface(page);
        await waitForDayColumns(page, 9);
        await assertNoDuplicateDepartmentSubGroups(page);
        await assertScheduleGroupsCollapsedByDefault(page);
        await assertScheduleSearchAutoExpandsGroups(page);
        await expandAllScheduleGroups(page);
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
        await assertWideScheduleLayout(page, `${label} month schedule`, { expectedDays: monthRange.dayCount, minDayWidth: 120 });
        await page.screenshot({ path: path.join(OUTPUT_DIR, `${label}-month.png`), fullPage: true });
        assertNoForbiddenStaffWrites(forbidden, label);

        return {
            viewport: `${viewport.width}x${viewport.height}`,
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
        const mobile = await runMobileFlow(browser, base, session, VIEWPORTS.mobile, 'mobile-390');
        const narrowMobile = await runMobileFlow(browser, base, session, VIEWPORTS.narrowMobile, 'mobile-360');

        console.log(`Live staff schedule smoke OK: ${base}`);
        console.log(`  OK desktop: default=${desktop.defaultDays}d, firstHalf=${desktop.firstHalf}, secondHalf=${desktop.secondHalf}, month=${desktop.month}`);
        console.log(`  OK controls: headerActions=${desktop.headerActions}, extraViews=removed`);
        console.log(`  OK filters: ${desktop.filteredGroups}`);
        console.log(`  OK export: ${desktop.exportFilename}`);
        console.log(`  OK print: Excel schedule table`);
        console.log(`  OK mobile: ${mobile.viewport} month=${mobile.month}, days=${mobile.dayCount}`);
        console.log(`  OK narrow mobile: ${narrowMobile.viewport} month=${narrowMobile.month}, days=${narrowMobile.dayCount}`);
        console.log(`  OK read-only guard: no staff mutation requests`);
        console.log(`  OK screenshots: ${path.relative(ROOT, OUTPUT_DIR)}`);
    } finally {
        await browser.close().catch(() => {});
    }
}

run().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
