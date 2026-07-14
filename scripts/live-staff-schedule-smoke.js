#!/usr/bin/env node
'use strict';

/**
 * Read-only live/staging browser smoke for the staff schedule page.
 *
 * Read-only guarantee:
 * - Uses POST only for authentication when token auth is not provided.
 * - Never clicks add/fill/copy/import controls and never edits schedule cells.
 * - Fails the run if a staff mutation endpoint is requested by the browser.
 * - Never writes staff names, IDs, credentials, or tokens to stdout/stderr.
 *
 * Usage:
 *   npm run smoke:staff-schedule -- https://example.up.railway.app
 *   LIVE_STAFF_SCHEDULE_URL=https://example.up.railway.app LIVE_STAFF_SCHEDULE_USER=... LIVE_STAFF_SCHEDULE_PASS=... npm run smoke:staff-schedule
 *   LIVE_STAFF_SCHEDULE_TOKEN=<jwt> npm run smoke:staff-schedule -- https://example.up.railway.app
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
        fail('invalid target URL');
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
    const context = await browser.newContext({
        viewport,
        acceptDownloads: true,
        serviceWorkers: 'block'
    });
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

function redactedStaffMutationRouteClass(pathname) {
    if (pathname === '/api/staff/schedule/bulk') return 'staff-schedule-bulk';
    if (pathname === '/api/staff/schedule/copy-week') return 'staff-schedule-copy';
    if (pathname === '/api/staff/import-excel') return 'staff-import';
    if (/^\/api\/users(?:\/|$)/.test(pathname)) return 'user-management';
    return 'staff-resource';
}

function attachReadOnlyGuard(page, label) {
    const forbidden = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (isForbiddenStaffMutation(request.method(), url.pathname)) {
            forbidden.push(`${label}: ${request.method()} ${redactedStaffMutationRouteClass(url.pathname)}`);
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
    try {
        await page.waitForFunction(() => {
            const region = document.getElementById('scheduleDataRegion');
            return region?.dataset.hasCommittedRange === 'true'
                && ['ready', 'empty'].includes(region?.dataset.scheduleState || '');
        });
    } catch (error) {
        const diagnostics = await page.evaluate(() => {
            const region = document.getElementById('scheduleDataRegion');
            return {
                region: Boolean(region),
                committed: region?.dataset.hasCommittedRange === 'true',
                state: region?.dataset.scheduleState || 'missing'
            };
        });
        throw new Error(
            `atomic range state unavailable (region=${diagnostics.region}, committed=${diagnostics.committed}, state=${diagnostics.state})`,
            { cause: error }
        );
    }
}

async function captureStableScheduleScreenshot(page, filename, selector = '#scheduleWrapper') {
    await page.waitForFunction(() => {
        const region = document.getElementById('scheduleDataRegion');
        return ['ready', 'empty'].includes(region?.dataset.scheduleState || '')
            && region?.getAttribute('aria-busy') !== 'true';
    });
    await page.evaluate(async () => {
        await document.fonts?.ready;
        document.activeElement?.blur?.();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.mouse.move(1, 1);
    const screenshotStyle = await page.addStyleTag({
        content: '.toast-container, #mainApp > .header { visibility: hidden !important; }'
    });
    try {
        const target = page.locator(selector);
        await target.scrollIntoViewIfNeeded();
        await target.screenshot({
            path: path.join(OUTPUT_DIR, filename),
            animations: 'disabled',
            caret: 'hide'
        });
    } finally {
        await screenshotStyle.evaluate(element => element.remove()).catch(() => {});
    }
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

async function captureDepartmentScheduleSurfaces(page) {
    const departmentKeys = await page.locator('#deptFilter .dept-chip:not([data-dept="all"])').evaluateAll(chips => chips
        .filter(chip => Number(chip.querySelector('.dept-chip-count')?.textContent?.trim() || 0) > 0)
        .map(chip => chip.getAttribute('data-dept') || '')
        .filter(Boolean));

    for (const key of departmentKeys) {
        await activateDepartmentFilter(page, key);
        const toggle = page.locator(`[data-schedule-group-toggle="${key}"]`);
        if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        await captureStableScheduleScreenshot(page, `desktop-department-${key.replace(/[^a-z0-9_-]/gi, '-')}.png`);
    }
    await activateDepartmentFilter(page, 'all');
    await expandAllScheduleGroups(page);
}

async function scheduleEmployeeRowCount(page) {
    return page.locator('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').count();
}

function staffIdsAreUnique(ids) {
    return ids.every(id => Number.isSafeInteger(id) && id > 0)
        && new Set(ids).size === ids.length;
}

function staffIdSetsMatch(left, right) {
    if (left.length !== right.length) return false;
    const expected = new Set(left);
    return right.every(id => expected.has(id));
}

function staffPlacementsAreUnique(placements) {
    const keys = placements.map(item => `${item.department}:${item.id}`);
    return placements.every(item => Number.isSafeInteger(item.id) && item.id > 0 && item.department)
        && new Set(keys).size === keys.length;
}

function staffPlacementSetsMatch(left, right) {
    if (left.length !== right.length) return false;
    const expected = new Set(left.map(item => `${item.department}:${item.id}`));
    return right.every(item => expected.has(`${item.department}:${item.id}`));
}

async function readScheduleStaffSetState(page) {
    return page.locator('#scheduleBody').evaluate(tbody => {
        const placements = Array.from(tbody.querySelectorAll('[data-schedule-staff-row]'))
            .map(row => ({
                id: Number(row.getAttribute('data-schedule-staff-row')),
                department: row.getAttribute('data-schedule-department') || ''
            }));
        const ids = placements.map(item => item.id);
        const departments = Array.from(tbody.querySelectorAll('tr.dept-row'))
            .map(row => row.getAttribute('data-dept') || '')
            .filter(Boolean);
        return {
            ids,
            uniqueIds: Array.from(new Set(ids)),
            placements,
            rowCount: ids.length,
            departments,
            hasEmptyState: Boolean(tbody.querySelector('.schedule-health-empty-row')),
            groupStaffCount: Array.from(tbody.querySelectorAll('tr.dept-row .dept-count'))
                .reduce((total, element) => total + Number(element.textContent?.trim() || 0), 0)
        };
    });
}

async function activateDepartmentFilter(page, department) {
    await page.evaluate(key => {
        document.querySelector(`#deptFilter .dept-chip[data-dept="${CSS.escape(key)}"]`)?.click();
    }, department);
    await page.waitForFunction(key => {
        return document.querySelector(`#deptFilter .dept-chip[data-dept="${CSS.escape(key)}"]`)
            ?.getAttribute('aria-pressed') === 'true';
    }, department);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function fillPrivateScheduleSearch(page, privateValue) {
    await page.evaluate(value => {
        const input = document.getElementById('scheduleStaffSearch');
        if (!input) throw new Error('schedule search input is unavailable');
        input.value = String(value || '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, privateValue);
}

function scheduleExportStaffIdsFromHtml(html) {
    return Array.from(
        String(html || '').matchAll(/\bdata-schedule-export-staff-id="(\d+)"/g),
        match => Number(match[1])
    );
}

function scheduleExportStaffPlacementsFromHtml(html) {
    return Array.from(
        String(html || '').matchAll(/\bdata-schedule-export-staff-id="(\d+)"\s+data-schedule-export-department="([^"]+)"/g),
        match => ({ id: Number(match[1]), department: match[2] })
    );
}

async function captureScheduleWorkbookHtml(page) {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportExcelBtn').click();
    const download = await downloadPromise;
    try {
        const downloadPath = await download.path();
        assert.equal(Boolean(downloadPath), true, 'workbook download has a readable temporary path');
        return fs.readFileSync(downloadPath, 'utf8').replace(/^\uFEFF/, '');
    } finally {
        await download.delete().catch(() => {});
    }
}

async function assertWorkbookStaffSetParity(page, expectedIds, label) {
    const html = await captureScheduleWorkbookHtml(page);
    const exportedIds = scheduleExportStaffIdsFromHtml(html);
    const exportRowAttributeCount = (html.match(/\bdata-schedule-export-staff-id=/g) || []).length;

    assert.equal(html.includes('schedule-export-table'), true, `${label}: generated workbook contains the schedule table`);
    assert.equal(exportRowAttributeCount, exportedIds.length, `${label}: every workbook staff row has a numeric ID`);
    assert.equal(staffIdsAreUnique(exportedIds), true, `${label}: workbook staff IDs are unique`);
    assert.equal(staffIdSetsMatch(expectedIds, exportedIds), true, `${label}: workbook staff set exactly matches the visible table`);
}

async function assertWorkbookStaffPlacementParity(page, expectedPlacements, label) {
    const html = await captureScheduleWorkbookHtml(page);
    const exportedPlacements = scheduleExportStaffPlacementsFromHtml(html);

    assert.equal(html.includes('schedule-export-table'), true, `${label}: generated workbook contains the schedule table`);
    assert.equal(staffPlacementsAreUnique(exportedPlacements), true, `${label}: workbook placements are unique within each professional section`);
    assert.equal(
        staffPlacementSetsMatch(expectedPlacements, exportedPlacements),
        true,
        `${label}: workbook placements exactly match the visible table`
    );
}

async function assertCommercialStaffSetContracts(page) {
    await page.locator('#scheduleStaffSearch').fill('');
    await activateDepartmentFilter(page, 'all');
    await expandAllScheduleGroups(page);

    const allChipCount = Number(await page.locator('#deptFilter .dept-chip[data-dept="all"] .dept-chip-count').textContent());
    const allState = await readScheduleStaffSetState(page);
    assert.equal(allState.hasEmptyState, false, 'all filter has schedule staff rows');
    assert.equal(staffIdsAreUnique(allState.ids), true, 'all filter renders each physical staff member exactly once');
    assert.equal(allState.uniqueIds.length, allChipCount, 'all chip count matches the unique people total');
    assert.equal(allState.rowCount, allState.uniqueIds.length, 'all rows equal the unique people set');
    assert.equal(allState.groupStaffCount, allState.rowCount, 'all top-level group counts match the table');
    await assertWorkbookStaffPlacementParity(page, allState.placements, 'all canonical export');

    const refreshSnapshot = await page.evaluate(() => ({
        from: document.getElementById('scheduleDateFrom')?.value || '',
        to: document.getElementById('scheduleDateTo')?.value || '',
        search: document.getElementById('scheduleStaffSearch')?.value || '',
        activeDept: document.querySelector('#deptFilter .dept-chip[aria-pressed="true"]')?.dataset.dept || '',
        navigationCount: performance.getEntriesByType('navigation').length
    }));
    await page.evaluate(async () => {
        if (typeof window.StaffSchedulePage?.refresh !== 'function') throw new Error('StaffSchedulePage.refresh is unavailable');
        await window.StaffSchedulePage.refresh();
    });
    await page.waitForFunction(() => (
        document.querySelectorAll('[data-schedule-group-toggle]').length > 0
        && Array.from(document.querySelectorAll('[data-schedule-group-toggle]'))
            .every(button => button.getAttribute('aria-expanded') === 'true')
    ));
    const refreshedAllState = await readScheduleStaffSetState(page);
    assert.equal(staffPlacementSetsMatch(allState.placements, refreshedAllState.placements), true, 'read-only refresh preserves all canonical placements');
    assert.equal(refreshedAllState.uniqueIds.length, allChipCount, 'read-only refresh preserves the unique people total');
    assert.deepEqual(await page.evaluate(() => ({
        from: document.getElementById('scheduleDateFrom')?.value || '',
        to: document.getElementById('scheduleDateTo')?.value || '',
        search: document.getElementById('scheduleStaffSearch')?.value || '',
        activeDept: document.querySelector('#deptFilter .dept-chip[aria-pressed="true"]')?.dataset.dept || '',
        navigationCount: performance.getEntriesByType('navigation').length
    })), refreshSnapshot, 'read-only refresh preserves range, filter, search, and navigation state');

    const sharedSectionStates = {};
    for (const department of ['animators', 'reception']) {
        await activateDepartmentFilter(page, department);
        await expandAllScheduleGroups(page);
        const state = await readScheduleStaffSetState(page);
        sharedSectionStates[department] = state;
    }
    const sharedStaffIds = sharedSectionStates.animators.ids
        .filter(id => sharedSectionStates.reception.ids.includes(id));
    assert.equal(staffIdsAreUnique(sharedStaffIds), true, 'shared animator/reception staff IDs stay unique');
    for (const sharedStaffId of sharedStaffIds) {
        for (const department of ['animators', 'reception']) {
            assert.equal(
                sharedSectionStates[department].placements.filter(item => item.id === sharedStaffId && item.department === department).length,
                1,
                'shared multi-profession staff member appears once in the active professional section'
            );
        }
    }
    await activateDepartmentFilter(page, 'all');
    await expandAllScheduleGroups(page);

    const filters = await page.locator('#deptFilter .dept-chip:not([data-dept="all"])').evaluateAll(buttons => buttons
        .map(button => ({
            key: button.getAttribute('data-dept') || '',
            count: Number(button.querySelector('.dept-chip-count')?.textContent?.trim() || 0)
        }))
        .filter(item => item.key && item.count > 0));
    assert.equal(filters.length > 0, true, 'at least one populated department is available for live parity checks');

    for (const filter of filters) {
        await activateDepartmentFilter(page, filter.key);
        await expandAllScheduleGroups(page);
        const state = await readScheduleStaffSetState(page);
        assert.equal(state.hasEmptyState, false, 'populated department filter has schedule staff rows');
        assert.equal(staffIdsAreUnique(state.ids), true, 'active department renders every numeric staff ID once');
        assert.equal(state.rowCount, filter.count, 'department chip count matches the active table staff count');
        assert.equal(state.groupStaffCount, state.rowCount, 'department top-level group count matches the table');
        assert.equal(
            state.departments.length > 0 && state.departments.every(department => department === filter.key),
            true,
            'active-department-only: table renders no foreign top-level group'
        );
    }

    const exportDepartment = filters[0];
    await activateDepartmentFilter(page, exportDepartment.key);
    await expandAllScheduleGroups(page);
    const departmentState = await readScheduleStaffSetState(page);
    await assertWorkbookStaffSetParity(page, departmentState.ids, 'active department export');

    const privateSearchTerm = String(await page.locator('#scheduleBody [data-schedule-staff-row] .emp-name-text').first().textContent() || '').trim();
    assert.equal(Boolean(privateSearchTerm), true, 'a private in-memory search probe is available');
    await fillPrivateScheduleSearch(page, privateSearchTerm);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const searchState = await readScheduleStaffSetState(page);
    assert.equal(searchState.ids.length > 0, true, 'department search keeps at least one matching staff row');
    assert.equal(staffIdsAreUnique(searchState.ids), true, 'department search renders every numeric staff ID once');
    assert.equal(searchState.ids.every(id => departmentState.ids.includes(id)), true, 'department search remains a subset of the active department');
    assert.equal(searchState.groupStaffCount, searchState.rowCount, 'department search group count matches the table');
    await assertWorkbookStaffSetParity(page, searchState.ids, 'active department and search export');

    await page.locator('#scheduleStaffSearch').fill('');
    await activateDepartmentFilter(page, 'all');

    return {
        allCount: allState.uniqueIds.length,
        placementCount: allState.rowCount,
        departmentCount: filters.length,
        searchedCount: searchState.rowCount,
        sharedMembershipCount: sharedStaffIds.length
    };
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
    await fillPrivateScheduleSearch(page, searchTerm);
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
    await fillPrivateScheduleSearch(page, searchTerm);
    await applyPreset(page, 'month');
    await waitForColumnsToMatchInputs(page);
    assert.equal(
        await page.locator('#scheduleStaffSearch').inputValue() === searchTerm,
        true,
        'private search query survives period preset changes'
    );

    const range = await readRangeState(page);
    const monthDays = dateRangeDays(range.from, range.to);
    assert.equal(range.dayCount, monthDays, 'month preset renders all month day columns');
    assert.ok(monthDays >= 28 && monthDays <= 31, `month preset day count is ${monthDays}`);
    return range;
}

async function assertDarkTheme(page, label) {
    const theme = await page.evaluate(() => ({
        rootTheme: document.documentElement.getAttribute('data-theme') || '',
        bodyDark: document.body.classList.contains('dark-mode'),
        colorScheme: getComputedStyle(document.documentElement).colorScheme || ''
    }));
    assert.equal(theme.rootTheme, 'dark', `${label}: root uses the dark theme`);
    assert.equal(theme.bodyDark, true, `${label}: body uses the dark theme class`);
    assert.equal(theme.colorScheme.includes('dark'), true, `${label}: browser controls use a dark color scheme`);
}

async function assertLoadingControlsDuringPreset(page, preset) {
    let heldRequest = false;
    let releaseRequest;
    let markIntercepted;
    let markCompleted;
    const release = new Promise(resolve => { releaseRequest = resolve; });
    const intercepted = new Promise(resolve => { markIntercepted = resolve; });
    const completed = new Promise(resolve => { markCompleted = resolve; });
    const routePattern = '**/api/staff/schedule?**';
    const routeHandler = async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!heldRequest && request.method() === 'GET' && url.pathname === '/api/staff/schedule') {
            heldRequest = true;
            markIntercepted();
            try {
                await release;
                await route.continue();
            } finally {
                markCompleted();
            }
            return;
        }
        await route.continue();
    };

    await page.route(routePattern, routeHandler);
    let flowError = null;
    try {
        await page.locator(`[data-schedule-range-preset="${preset}"]`).click();
        let interceptTimer;
        try {
            await Promise.race([
                intercepted,
                new Promise((_, reject) => {
                    interceptTimer = setTimeout(
                        () => reject(new Error('schedule loading probe did not intercept a read request')),
                        TIMEOUT_MS
                    );
                })
            ]);
        } finally {
            clearTimeout(interceptTimer);
        }
        await page.waitForFunction(() => document.getElementById('scheduleDataRegion')?.dataset.scheduleState === 'loading');
        const loadingState = await page.evaluate(() => {
            const region = document.getElementById('scheduleDataRegion');
            const wrapper = document.getElementById('scheduleWrapper');
            const exportButton = document.getElementById('exportExcelBtn');
            const printButton = document.getElementById('printBtn');
            return {
                state: region?.dataset.scheduleState || '',
                ariaBusy: region?.getAttribute('aria-busy') || '',
                tableLocked: Boolean(
                    wrapper?.inert
                    || region?.inert
                    || wrapper?.getAttribute('aria-disabled') === 'true'
                    || region?.getAttribute('aria-disabled') === 'true'
                ),
                exportDisabled: Boolean(exportButton?.disabled),
                exportAriaDisabled: exportButton?.getAttribute('aria-disabled') || '',
                printDisabled: Boolean(printButton?.disabled),
                printAriaDisabled: printButton?.getAttribute('aria-disabled') || ''
            };
        });
        assert.equal(loadingState.state, 'loading', 'range navigation exposes an explicit loading state');
        assert.equal(loadingState.ariaBusy, 'true', 'range loading exposes aria-busy');
        assert.equal(loadingState.tableLocked, true, 'range loading locks the schedule table');
        assert.equal(loadingState.exportDisabled, true, 'range loading disables export');
        assert.equal(loadingState.exportAriaDisabled, 'true', 'range loading exposes export aria-disabled');
        assert.equal(loadingState.printDisabled, true, 'range loading disables print');
        assert.equal(loadingState.printAriaDisabled, 'true', 'range loading exposes print aria-disabled');
    } catch (error) {
        flowError = error;
    } finally {
        releaseRequest();
        if (heldRequest) await completed;
        await page.unroute(routePattern, routeHandler);
    }
    if (flowError) throw flowError;

    await page.waitForFunction(expected => {
        const region = document.getElementById('scheduleDataRegion');
        const button = document.querySelector(`[data-schedule-range-preset="${CSS.escape(expected)}"]`);
        return region?.dataset.hasCommittedRange === 'true'
            && ['ready', 'empty'].includes(region?.dataset.scheduleState || '')
            && region?.getAttribute('aria-busy') === 'false'
            && button?.classList.contains('active');
    }, preset);
    const readyState = await page.evaluate(() => ({
        exportDisabled: Boolean(document.getElementById('exportExcelBtn')?.disabled),
        printDisabled: Boolean(document.getElementById('printBtn')?.disabled)
    }));
    assert.equal(readyState.exportDisabled, false, 'confirmed range re-enables export');
    assert.equal(readyState.printDisabled, false, 'confirmed range re-enables print');
}

async function assertWideScheduleLayout(page, label, options = {}) {
    const wrapperSelector = options.wrapperSelector || '#scheduleWrapper';
    const expectedDays = options.expectedDays;
    const expectedHeaderCount = options.expectedHeaderCount || expectedDays;
    const minDayWidth = options.minDayWidth || 96;
    const shouldFit = Boolean(options.shouldFit);
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
        wrapper.scrollLeft = 0;
        const wrapperBox = wrapper.getBoundingClientRect();
        const tableBox = table.getBoundingClientRect();
        const firstHeaderBox = firstHeader.getBoundingClientRect();
        const firstBodyBox = firstBodyCell.getBoundingClientRect();
        const dayWidths = dayHeaders.map(header => header.getBoundingClientRect().width).filter(Boolean);
        const fullyVisibleDayCount = dayHeaders.filter(header => {
            const box = header.getBoundingClientRect();
            return box.left >= wrapperBox.left - 1 && box.right <= wrapperBox.right + 1;
        }).length;
        wrapper.scrollLeft = Math.min(260, Math.max(0, wrapper.scrollWidth - wrapper.clientWidth));
        const firstHeaderStyle = getComputedStyle(firstHeader);
        const backgroundAlpha = (() => {
            const value = String(firstHeaderStyle.backgroundColor || '').trim().toLowerCase();
            if (!value || value === 'transparent') return 0;
            const rgba = value.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
            return rgba ? Number(rgba[1]) : 1;
        })();
        return {
            isLongRange: wrapper.classList.contains('is-long-range'),
            isFullRange: wrapper.classList.contains('is-full-range'),
            dataDays: Number(wrapper.dataset.scheduleDayCount || 0),
            wrapperClientWidth: wrapper.clientWidth,
            wrapperScrollWidth: wrapper.scrollWidth,
            tableWidth: tableBox.width,
            minDayWidth: dayWidths.length ? Math.min(...dayWidths) : 0,
            maxDayWidth: dayWidths.length ? Math.max(...dayWidths) : 0,
            fullyVisibleDayCount,
            dayHeaderCount: dayHeaders.length,
            expectedDays,
            expectedHeaderCount,
            firstHeaderPosition: getComputedStyle(firstHeader).position,
            firstHeaderBackgroundAlpha: backgroundAlpha,
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
    if (shouldFit) {
        assert.ok(metrics.wrapperScrollWidth <= metrics.wrapperClientWidth + 4, `${label}: all month columns fit without horizontal scrolling`);
        assert.equal(metrics.fullyVisibleDayCount, expectedHeaderCount, `${label}: every month day is visible at once`);
    } else {
        assert.ok(metrics.wrapperScrollWidth > metrics.wrapperClientWidth + 20, `${label}: wrapper owns horizontal scrolling`);
    }
    assert.ok(metrics.tableWidth >= metrics.wrapperScrollWidth - 2, `${label}: table width matches wrapper scroll width`);
    assert.ok(metrics.minDayWidth >= minDayWidth, `${label}: date columns remain readable`);
    assert.ok(metrics.maxDayWidth - metrics.minDayWidth <= 2, `${label}: date columns stay aligned`);
    assert.equal(metrics.firstHeaderPosition, 'sticky', `${label}: header first column is sticky`);
    assert.ok(metrics.firstHeaderBackgroundAlpha >= 0.99, `${label}: sticky header has an opaque fallback surface`);
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
        await assertDarkTheme(page, 'desktop 1440');
        await assertHeaderSurface(page);
        await waitForDayColumns(page, 9);
        await assertNoDuplicateDepartmentSubGroups(page);
        await assertDepartmentFiltersRenderOnlyActiveGroup(page);
        await assertScheduleGroupsCollapsedByDefault(page);
        await assertScheduleGroupExpansionPersists(page);
        await assertScheduleSearchAutoExpandsGroups(page);
        await expandAllScheduleGroups(page);
        await captureDepartmentScheduleSurfaces(page);
        const commercialContracts = await assertCommercialStaffSetContracts(page);
        assert.equal(await dayColumnCount(page), 9, 'default schedule range is 9 days');

        await assertLoadingControlsDuringPreset(page, 'first-half');
        await waitForDayColumns(page, 15);
        const firstHalf = await readRangeState(page);
        assert.equal(firstHalf.from.endsWith('-01'), true, '1-15 preset starts on day 1');
        assert.equal(firstHalf.to.endsWith('-15'), true, '1-15 preset ends on day 15');
        assert.equal(firstHalf.dayCount, 15, '1-15 preset renders 15 day columns');
        assert.match(firstHalf.label, /1[\s\S]+15[\s\S]+20\d{2}/, 'period label reflects 1-15 range');
        await captureStableScheduleScreenshot(page, 'desktop-first-half.png');
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
        await captureStableScheduleScreenshot(page, 'desktop-second-half.png');

        await assertInvalidRangesStayPut(page, secondHalf.from, secondHalf.to);

        const monthRange = await assertSearchPersistence(page);
        const monthDays = dateRangeDays(monthRange.from, monthRange.to);
        await page.locator('#scheduleStaffSearch').fill('');
        await waitForColumnsToMatchInputs(page);
        await assertWideScheduleLayout(page, 'desktop month schedule', { expectedDays: monthDays, minDayWidth: 28, shouldFit: true });
        await assertScheduleExtraViewsRemoved(page);
        await captureStableScheduleScreenshot(page, 'desktop-month-search.png');

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
            filteredGroups: 'active-department-only',
            commercialContracts
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
        await assertDarkTheme(page, label);
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
        await assertWideScheduleLayout(page, `${label} month schedule`, { expectedDays: monthRange.dayCount, minDayWidth: 40 });
        await captureStableScheduleScreenshot(page, `${label}-month.png`);
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
        console.log(`  OK staff-set contracts: people=${desktop.commercialContracts.allCount}, placements=${desktop.commercialContracts.placementCount}, sharedMatches=${desktop.commercialContracts.sharedMembershipCount}, departments=${desktop.commercialContracts.departmentCount}, searched=${desktop.commercialContracts.searchedCount}`);
        console.log(`  OK export: ${desktop.exportFilename}`);
        console.log(`  OK print: Excel schedule table`);
        console.log(`  OK dark theme: 1440/390/360`);
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
