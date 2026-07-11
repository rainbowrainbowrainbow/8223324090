#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.STAFF_SCHEDULE_BROWSER_SMOKE_HEADLESS !== 'false';
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'staff-schedule-custom-range-smoke');
const STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY = 'pzp_staff_schedule_expanded_groups';

const SMOKE_USER = {
    id: 1,
    name: 'Schedule QA',
    username: 'schedule.qa',
    role: 'creator'
};

const DISPLAY_GROUPS = [
    { key: 'animators', label: 'Аніматори', is_active: true, sort_order: 1 },
    { key: 'reception', label: 'Рецепшен', is_active: true, sort_order: 2 },
    { key: 'admin', label: 'Адміністрація', is_active: true, sort_order: 3 }
];

const STAFF_ROWS = [
    {
        id: 101,
        name: 'Пасенко Женя',
        display_name: 'Пасенко Женя',
        position: 'Аніматор',
        department: 'animators',
        role_type: 'animator',
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: true,
        has_face_descriptor: true
    },
    {
        id: 102,
        name: 'Коваль Оля',
        display_name: 'Коваль Оля',
        position: 'Рецепція',
        department: 'reception',
        role_type: 'reception',
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: false,
        has_face_descriptor: false
    },
    {
        id: 103,
        name: 'Іваненко Марко',
        display_name: 'Іваненко Марко',
        position: 'Адміністратор',
        department: 'admin',
        role_type: 'admin',
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: true,
        has_face_descriptor: false
    }
];

const PROFESSIONS = [
    { key: 'animator', title: 'Аніматор', department: 'animators', is_active: true },
    { key: 'reception', title: 'Рецепція', department: 'reception', is_active: true },
    { key: 'admin', title: 'Адміністратор', department: 'admin', is_active: true }
];

const SCHEDULE_FIXTURE_ENTRIES = [
    {
        id: 9104,
        staff_id: 101,
        date: '2026-07-06',
        shift_start: '10:00:00',
        shift_end: '12:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9105,
        staff_id: 101,
        date: '2026-07-07',
        shift_start: '10:00:00',
        shift_end: '14:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9106,
        staff_id: 101,
        date: '2026-07-08',
        shift_start: '10:00:00',
        shift_end: '16:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9101,
        staff_id: 101,
        date: '2026-07-09',
        shift_start: '12:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9102,
        staff_id: 101,
        date: '2026-07-11',
        shift_start: '10:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9103,
        staff_id: 101,
        date: '2026-07-13',
        shift_start: '10:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9116,
        staff_id: 101,
        date: '2026-07-16',
        shift_start: '11:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9124,
        staff_id: 101,
        date: '2026-07-24',
        shift_start: '12:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9131,
        staff_id: 101,
        date: '2026-07-31',
        shift_start: '10:00:00',
        shift_end: '18:00:00',
        status: 'working',
        profession_key: 'animator'
    }
];

const apiCalls = {
    scheduleRanges: [],
    hoursRanges: [],
    bulkBodies: [],
    copyWeekBodies: []
};

function fail(message) {
    console.error(`Staff schedule custom range browser smoke failed: ${message}`);
    process.exit(1);
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

function contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.js') return 'application/javascript; charset=utf-8';
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.ico') return 'image/x-icon';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.json') return 'application/json; charset=utf-8';
    return 'application/octet-stream';
}

function staticFilePath(requestUrl) {
    const url = new URL(requestUrl, 'http://local');
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (relativePath === 'staff') relativePath = 'staff.html';
    const absolutePath = path.resolve(ROOT, relativePath);
    const rootPrefix = `${ROOT}${path.sep}`;
    if (absolutePath !== ROOT && !absolutePath.startsWith(rootPrefix)) return null;
    return absolutePath;
}

function sendJson(res, body, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(body));
}

function collectJson(req) {
    return new Promise(resolve => {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                resolve({});
            }
        });
    });
}

function scheduleFixtureEntriesForRange(from, to) {
    if (!from || !to) return [];
    return SCHEDULE_FIXTURE_ENTRIES.filter(entry => entry.date >= from && entry.date <= to);
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/auth/verify') {
        sendJson(res, { success: true, user: SMOKE_USER });
        return true;
    }
    if (url.pathname === '/api/hr/professions') {
        sendJson(res, { success: true, data: PROFESSIONS });
        return true;
    }
    if (url.pathname === '/api/staff') {
        sendJson(res, {
            success: true,
            data: STAFF_ROWS,
            departments: {
                animators: 'Аніматори',
                reception: 'Рецепшен',
                admin: 'Адміністрація'
            },
            displayGroups: DISPLAY_GROUPS
        });
        return true;
    }
    if (url.pathname === '/api/staff/schedule') {
        apiCalls.scheduleRanges.push({
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to')
        });
        sendJson(res, {
            success: true,
            data: scheduleFixtureEntriesForRange(url.searchParams.get('from'), url.searchParams.get('to')),
            displayGroups: DISPLAY_GROUPS
        });
        return true;
    }
    const shiftPreferenceMatch = url.pathname.match(/^\/api\/staff\/(\d+)\/shift-preferences$/);
    if (shiftPreferenceMatch) {
        const staffId = Number(shiftPreferenceMatch[1]);
        const staff = STAFF_ROWS.find(row => Number(row.id) === staffId);
        const professionKey = staff?.role_type || 'animator';
        sendJson(res, {
            success: true,
            data: [
                { staff_id: staffId, profession_key: professionKey, day_type: 'weekday', start_time: '12:00:00', end_time: '20:00:00', is_active: true },
                { staff_id: staffId, profession_key: professionKey, day_type: 'weekend', start_time: '10:00:00', end_time: '20:00:00', is_active: true }
            ]
        });
        return true;
    }
    if (url.pathname === '/api/staff/attendance') {
        sendJson(res, {
            success: true,
            data: [],
            summary: {}
        });
        return true;
    }
    if (url.pathname === '/api/staff/link-status') {
        sendJson(res, {
            success: true,
            data: STAFF_ROWS.map((staff, index) => ({
                ...staff,
                user_id: index === 1 ? null : 200 + staff.id,
                username: index === 1 ? null : `staff.${staff.id}`,
                user_role: staff.role_type
            })),
            stats: {
                total: STAFF_ROWS.length,
                linked: 2,
                unlinked: 1,
                freelance: 0
            }
        });
        return true;
    }
    if (url.pathname === '/api/staff/schedule/hours') {
        apiCalls.hoursRanges.push({
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to')
        });
        sendJson(res, {
            success: true,
            data: {
                101: { totalHours: 24, workingDays: 3 },
                102: { totalHours: 16, workingDays: 2 },
                103: { totalHours: 8, workingDays: 1 }
            }
        });
        return true;
    }
    if (url.pathname === '/api/staff/schedule/bulk') {
        const body = await collectJson(req);
        apiCalls.bulkBodies.push(body);
        sendJson(res, {
            success: true,
            count: Array.isArray(body.entries) ? body.entries.length : 0
        });
        return true;
    }
    if (url.pathname === '/api/staff/schedule/copy-week') {
        const body = await collectJson(req);
        apiCalls.copyWeekBodies.push(body);
        sendJson(res, {
            success: true,
            dryRun: Boolean(body.dryRun),
            count: 7,
            staffCount: STAFF_ROWS.length,
            conflicts: 0
        });
        return true;
    }
    if (url.pathname.startsWith('/api/')) {
        sendJson(res, { success: true, data: [] });
        return true;
    }
    return false;
}

function createServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', 'http://local');
        if (await handleApi(req, res, url)) return;

        const filePath = staticFilePath(req.url || '/');
        if (!filePath) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, body) => {
            if (err) {
                res.writeHead(err.code === 'ENOENT' ? 404 : 500);
                res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType(filePath) });
            res.end(body);
        });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({ server, base: `http://127.0.0.1:${address.port}` });
        });
    });
}

function dateRangeDays(from, to) {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function formatInputDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isWeekday(date, weekday) {
    return new Date(`${date}T00:00:00`).getDay() === weekday;
}

function rangeDates(from, to) {
    const dates = [];
    const current = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (current <= end) {
        dates.push(formatInputDate(current));
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

function waitForCondition(predicate, message, timeoutMs = 20000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) {
                resolve();
                return;
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error(message));
                return;
            }
            setTimeout(tick, 50);
        };
        tick();
    });
}

async function waitForDayColumns(page, dayCount) {
    await page.waitForFunction(count => {
        return document.querySelectorAll('#scheduleHead th').length === count + 1;
    }, dayCount, { timeout: 20000 });
}

async function openStaffPage(browser, base, viewport) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(user => {
        localStorage.setItem('pzp_token', 'staff-schedule-smoke-token');
        localStorage.setItem('pzp_access_token', 'staff-schedule-smoke-token');
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'false');
        if (!sessionStorage.getItem('staff_schedule_smoke_storage_ready')) {
            localStorage.removeItem('pzp_staff_schedule_expanded_groups');
            sessionStorage.setItem('staff_schedule_smoke_storage_ready', 'true');
        }
    }, SMOKE_USER);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', err => {
        throw err;
    });
    await page.goto(`${base}/staff`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(
        window.StaffSchedulePage
        && typeof window.StaffSchedulePage.isInitialized === 'function'
        && window.StaffSchedulePage.isInitialized()
    ), null, { timeout: 20000 });
    await page.waitForSelector('#scheduleBody tr', { timeout: 20000 });
    return { context, page };
}

async function applyPreset(page, preset) {
    await page.locator(`[data-schedule-range-preset="${preset}"]`).click();
    await page.waitForFunction(expected => {
        const active = document.querySelector(`[data-schedule-range-preset="${expected}"]`);
        return active && active.classList.contains('active');
    }, preset, { timeout: 20000 });
}

async function applyManualRange(page, from, to) {
    await page.locator('#scheduleDateFrom').fill(from);
    await page.locator('#scheduleDateTo').fill(to);
    await page.locator('#applyScheduleRangeBtn').click();
    await page.waitForFunction(expected => document.getElementById('scheduleDateFrom')?.value === expected.from
        && document.getElementById('scheduleDateTo')?.value === expected.to, { from, to }, { timeout: 20000 });
    await waitForDayColumns(page, dateRangeDays(from, to));
}

async function assertPeriodPresetLabelsAndSummary(page) {
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
    await page.waitForFunction(() => Boolean(window.StaffSchedulePage?.isInitialized?.()), null, { timeout: 20000 });
    await page.waitForFunction(groupKey => {
        return Array.from(document.querySelectorAll('[data-schedule-group-toggle]'))
            .some(button => button.dataset.scheduleGroupToggle === groupKey && button.getAttribute('aria-expanded') === 'true');
    }, groupKey, { timeout: 20000 });
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'expanded schedule group persists after reload');

    await page.evaluate(storageKey => localStorage.removeItem(storageKey), STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.StaffSchedulePage?.isInitialized?.()), null, { timeout: 20000 });
    await page.waitForFunction(() => {
        const toggles = Array.from(document.querySelectorAll('[data-schedule-group-toggle]'));
        return toggles.length > 0 && toggles.every(button => button.getAttribute('aria-expanded') === 'false');
    }, null, { timeout: 20000 });
}

async function assertScheduleSearchAutoExpandsGroups(page) {
    const searchTerm = await page.locator('[data-schedule-group-toggle]').first().getAttribute('data-schedule-group-toggle') || 'animator';
    await page.locator('#scheduleStaffSearch').fill(searchTerm);
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length > 0);
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'active search reveals matching rows even when groups are collapsed');
    assert.ok((await page.locator('[data-schedule-group-toggle][aria-expanded="true"]').count()) > 0, 'active search marks matching groups expanded for accessibility');
    await page.locator('#scheduleStaffSearch').fill('');
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length === 0);
}

async function expandAllScheduleGroups(page) {
    for (let i = 0; i < 20; i += 1) {
        const collapsed = page.locator('[data-schedule-group-toggle][aria-expanded="false"]');
        if (!(await collapsed.count())) break;
        await collapsed.first().click();
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-schedule-group-toggle][aria-expanded="false"]').length === 0);
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length > 0);
}

async function assertScheduleShiftPreferenceQuickLabels(page) {
    await page.locator('.sch-cell[data-staff="101"]').first().click();
    await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
    await page.locator('#schShiftPreferencePanel .sch-shift-preference-option').nth(1).waitFor({ state: 'visible' });
    const labels = await page.locator('#schShiftPreferencePanel .sch-shift-preference-option strong')
        .evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
    assert.deepEqual(labels, ['ПН-ПТ', 'СБ-НД'], 'schedule modal quick shift options use explicit weekday/weekend range labels');
    assert.equal(labels.includes('Будні') || labels.includes('Вихідні'), false, 'schedule modal quick shift options avoid ambiguous day-type labels');
    await page.locator('#schCancelBtn').click();
    await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
}

async function assertShiftLoadClassesDoNotPaintScheduleCells(page) {
    const datesByBucket = {
        quarter: '2026-07-06',
        half: '2026-07-07',
        threeQuarter: '2026-07-08',
        weekdayFull: '2026-07-09',
        weekendFull: '2026-07-11',
        long: '2026-07-13'
    };
    for (const date of Object.values(datesByBucket)) {
        await page.locator(`.sch-cell[data-staff="101"][data-date="${date}"]`).waitFor({ state: 'visible' });
    }
    const metrics = await page.evaluate(dates => {
        const inspect = date => {
            const cell = document.querySelector(`.sch-cell[data-staff="101"][data-date="${date}"]`);
            if (!cell) return null;
            const after = getComputedStyle(cell, '::after');
            const cellStyle = getComputedStyle(cell);
            const time = cell.querySelector('.sch-time');
            return {
                className: cell.className,
                shiftLoad: cell.getAttribute('data-shift-load'),
                afterDisplay: after.display,
                afterContent: after.content,
                afterWidth: after.width,
                afterHeight: after.height,
                backgroundImage: cellStyle.backgroundImage,
                boxShadow: cellStyle.boxShadow,
                timeColor: time ? getComputedStyle(time).color : ''
            };
        };
        return {
            quarter: inspect(dates.quarter),
            half: inspect(dates.half),
            threeQuarter: inspect(dates.threeQuarter),
            weekdayFull: inspect(dates.weekdayFull),
            weekendFull: inspect(dates.weekendFull),
            long: inspect(dates.long)
        };
    }, datesByBucket);

    for (const [bucket, metric] of Object.entries(metrics)) {
        assert.ok(metric, `${bucket} fixture cell is rendered`);
    }

    assert.equal(metrics.quarter.shiftLoad, 'quarter', 'weekday 10:00-12:00 keeps quarter load metadata');
    assert.equal(metrics.half.shiftLoad, 'half', 'weekday 10:00-14:00 keeps half load metadata');
    assert.equal(metrics.threeQuarter.shiftLoad, 'three-quarter', 'weekday 10:00-16:00 keeps three-quarter load metadata');
    assert.equal(metrics.weekdayFull.shiftLoad, 'full', 'weekday 12:00-20:00 stays a full shift');
    assert.equal(metrics.weekendFull.shiftLoad, 'full', 'weekend 10:00-20:00 is treated as a full shift');
    assert.equal(metrics.weekendFull.className.includes('shift-load-long'), false, 'weekend 10:00-20:00 does not get the long-shift marker class');
    assert.equal(metrics.weekendFull.className.includes('shift-load-full'), true, 'weekend 10:00-20:00 keeps the full-shift class');
    assert.equal(metrics.long.shiftLoad, 'long', 'weekday 10:00-20:00 keeps long-shift load metadata');
    assert.equal(metrics.long.className.includes('shift-load-long'), true, 'weekday long shift keeps durable load metadata');

    const referenceTimeColor = metrics.weekdayFull.timeColor;
    for (const [bucket, metric] of Object.entries(metrics)) {
        assert.equal(metric.afterDisplay, 'none', `${bucket} load marker pseudo-element stays hidden`);
        assert.equal(metric.afterContent === 'none' || metric.afterContent === 'normal', true, `${bucket} load marker pseudo-element has no generated content`);
        assert.equal(metric.backgroundImage, 'none', `${bucket} cell has no shift-load gradient background`);
        assert.equal(/0px -5px 0px/.test(metric.boxShadow), false, `${bucket} cell does not paint the bottom load stripe`);
        assert.equal(metric.timeColor, referenceTimeColor, `${bucket} time text uses the normal schedule color`);
    }
}

async function assertWideScheduleLayout(page, label, options = {}) {
    const wrapperSelector = options.wrapperSelector || '#scheduleWrapper';
    const expectedDays = options.expectedDays;
    const expectedDataDays = options.expectedDataDays || expectedDays;
    const expectedHeaderCount = options.expectedHeaderCount || expectedDays;
    const minDayWidth = options.minDayWidth || 96;
    const metrics = await page.evaluate(({ wrapperSelector, expectedDataDays, expectedHeaderCount }) => {
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
            cssMinWidth: getComputedStyle(wrapper).getPropertyValue('--schedule-table-min-width').trim(),
            wrapperClientWidth: wrapper.clientWidth,
            wrapperScrollWidth: wrapper.scrollWidth,
            tableWidth: tableBox.width,
            minDayWidth: dayWidths.length ? Math.min(...dayWidths) : 0,
            maxDayWidth: dayWidths.length ? Math.max(...dayWidths) : 0,
            firstHeaderPosition: getComputedStyle(firstHeader).position,
            firstBodyPosition: getComputedStyle(firstBodyCell).position,
            firstHeaderLeft: firstHeaderBox.left,
            firstBodyLeft: firstBodyBox.left,
            wrapperLeft: wrapperBox.left,
            dayHeaderCount: dayHeaders.length,
            expectedDataDays,
            expectedHeaderCount,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
        };
    }, { wrapperSelector, expectedDataDays, expectedHeaderCount });
    assert.ok(metrics, `${label}: wide layout metrics are available`);
    assert.equal(metrics.isLongRange, true, `${label}: wrapper enters long-range mode`);
    if (expectedDataDays >= 28) assert.equal(metrics.isFullRange, true, `${label}: wrapper enters full-range mode`);
    assert.equal(metrics.dataDays, expectedDataDays, `${label}: wrapper records visible day count`);
    assert.equal(metrics.dayHeaderCount, expectedHeaderCount, `${label}: day header count matches range`);
    assert.ok(metrics.wrapperScrollWidth > metrics.wrapperClientWidth + 20, `${label}: wrapper owns horizontal scrolling`);
    assert.ok(metrics.tableWidth >= metrics.wrapperScrollWidth - 2, `${label}: table width matches wrapper scroll width`);
    assert.ok(metrics.minDayWidth >= minDayWidth, `${label}: day columns remain readable`);
    assert.ok(metrics.maxDayWidth - metrics.minDayWidth <= 2, `${label}: day columns stay aligned`);
    assert.equal(metrics.firstHeaderPosition, 'sticky', `${label}: header first column is sticky`);
    assert.equal(metrics.firstBodyPosition, 'sticky', `${label}: body first column is sticky`);
    assert.ok(Math.abs(metrics.firstHeaderLeft - metrics.wrapperLeft) <= 3, `${label}: sticky header column stays pinned after scroll`);
    assert.ok(Math.abs(metrics.firstBodyLeft - metrics.wrapperLeft) <= 3, `${label}: sticky body column stays pinned after scroll`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, `${label}: page has no global horizontal overflow`);
}

async function assertHalfMonthScheduleLayout(page, label, expectedDays) {
    const metrics = await page.evaluate(expectedDays => {
        const wrapper = document.querySelector('#scheduleWrapper');
        const table = wrapper?.querySelector('.schedule-table');
        if (!wrapper || !table) return null;
        const dayHeaders = Array.from(table.querySelectorAll('thead th:not(:first-child)'));
        return {
            isLongRange: wrapper.classList.contains('is-long-range'),
            isFullRange: wrapper.classList.contains('is-full-range'),
            dataDays: Number(wrapper.dataset.scheduleDayCount || 0),
            dayHeaderCount: dayHeaders.length,
            wrapperClientWidth: wrapper.clientWidth,
            wrapperScrollWidth: wrapper.scrollWidth,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            expectedDays
        };
    }, expectedDays);
    assert.ok(metrics, `${label}: half-month layout metrics are available`);
    assert.equal(metrics.isLongRange, false, `${label}: 16-day half-month stays in fitted schedule mode`);
    assert.equal(metrics.isFullRange, false, `${label}: half-month does not use full-month density`);
    assert.equal(metrics.dataDays, expectedDays, `${label}: wrapper records the half-month day count`);
    assert.equal(metrics.dayHeaderCount, expectedDays, `${label}: all half-month headers render`);
    assert.ok(metrics.wrapperScrollWidth <= metrics.wrapperClientWidth + 2, `${label}: half-month fits without schedule-table horizontal scrolling`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, `${label}: page has no global horizontal overflow`);
}

async function assertNoControlOverlap(page, label) {
    const metrics = await page.evaluate(() => {
        const rect = selector => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const box = el.getBoundingClientRect();
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
        const search = rect('.staff-schedule-search-row');
        const dateFrom = rect('#scheduleDateFrom');
        const dateTo = rect('#scheduleDateTo');
        const exportButton = rect('#exportExcelBtn');
        const printButton = rect('#printBtn');
        const wrapper = document.querySelector('#scheduleWrapper');
        return {
            command,
            range,
            search,
            dateFrom,
            dateTo,
            exportButton,
            printButton,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            wrapperClientWidth: wrapper?.clientWidth || 0,
            wrapperScrollWidth: wrapper?.scrollWidth || 0
        };
    });
    assert.ok(metrics.command?.width > 0, `${label}: command bar is measurable`);
    assert.ok(metrics.range?.width > 0, `${label}: range controls are measurable`);
    assert.ok(metrics.search?.width > 0, `${label}: search row is measurable`);
    assert.ok(metrics.range.right <= metrics.command.right + 2, `${label}: range controls stay inside command bar`);
    assert.ok(metrics.search.right <= metrics.command.right + 2, `${label}: search row stays inside command bar`);
    assert.ok(metrics.search.top >= metrics.range.top - 2, `${label}: search does not float above range controls`);
    assert.ok(metrics.dateFrom?.right <= metrics.dateTo?.left + 1, `${label}: date inputs do not overlap`);
    assert.ok(metrics.exportButton?.right <= metrics.command.right + 2, `${label}: export stays inside command bar`);
    assert.ok(metrics.printButton?.right <= metrics.command.right + 2, `${label}: print stays inside command bar`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, `${label}: page has no global horizontal overflow`);
    assert.ok(metrics.wrapperScrollWidth >= metrics.wrapperClientWidth, `${label}: schedule wrapper owns horizontal width`);
}

async function assertDepartmentChipsFit(page, label) {
    const metrics = await page.evaluate(() => Array.from(document.querySelectorAll('#deptFilter .dept-chip')).map(chip => {
        const label = chip.querySelector('.dept-chip-label');
        const count = chip.querySelector('.dept-chip-count');
        const chipBox = chip.getBoundingClientRect();
        const labelBox = label?.getBoundingClientRect();
        const countBox = count?.getBoundingClientRect();
        const labelStyle = label ? getComputedStyle(label) : null;
        return {
            text: label?.textContent?.trim() || '',
            chipWidth: chipBox.width,
            labelWidth: labelBox?.width || 0,
            labelRight: labelBox?.right || 0,
            countLeft: countBox?.left || 0,
            countRight: countBox?.right || 0,
            chipRight: chipBox.right,
            labelOverflow: labelStyle?.overflow || '',
            labelTextOverflow: labelStyle?.textOverflow || '',
            labelWhiteSpace: labelStyle?.whiteSpace || ''
        };
    }));
    assert.ok(metrics.length > 0, `${label}: department chips are rendered`);
    for (const chip of metrics) {
        assert.ok(chip.chipWidth > 0, `${label}: ${chip.text} chip is measurable`);
        assert.equal(chip.labelOverflow, 'hidden', `${label}: ${chip.text} label clips inside the chip`);
        assert.equal(chip.labelTextOverflow, 'ellipsis', `${label}: ${chip.text} label uses ellipsis`);
        assert.equal(chip.labelWhiteSpace, 'nowrap', `${label}: ${chip.text} label stays on one line`);
        assert.ok(chip.labelRight <= chip.countLeft + 1, `${label}: ${chip.text} label does not overlap the count`);
        assert.ok(chip.countRight <= chip.chipRight + 1, `${label}: ${chip.text} count stays inside the chip`);
    }
}

async function runDesktopFlow(browser, base) {
    const { context, page } = await openStaffPage(browser, base, { width: 1440, height: 900 });
    try {
        await waitForDayColumns(page, 9);
        await assertPeriodPresetLabelsAndSummary(page);
        await assertNoDuplicateDepartmentSubGroups(page);
        await assertScheduleGroupsCollapsedByDefault(page);
        await assertScheduleGroupExpansionPersists(page);
        await assertScheduleSearchAutoExpandsGroups(page);
        await expandAllScheduleGroups(page);
        await assertScheduleShiftPreferenceQuickLabels(page);

        await applyPreset(page, 'first-half');
        const firstHalfFrom = await page.locator('#scheduleDateFrom').inputValue();
        const firstHalfTo = await page.locator('#scheduleDateTo').inputValue();
        assert.equal(firstHalfFrom.endsWith('-01'), true, 'first-half starts on day 1');
        assert.equal(firstHalfTo.endsWith('-15'), true, 'first-half ends on day 15');
        await waitForDayColumns(page, 15);
        assert.match(await page.locator('#weekLabel').innerText(), /1 .+15 .+20\d{2}/, 'visible label reflects 1-15 range');
        assert.equal(await page.locator('.staff-schedule-command-bar .schedule-toolbar').count(), 0, 'legacy visible toolbar is removed from schedule shell');
        await page.locator('.staff-schedule-header-actions #exportExcelBtn').waitFor({ state: 'visible' });
        await page.locator('.staff-schedule-header-actions #printBtn').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#scheduleViewSwitch').count(), 0, 'visible view switch is removed from schedule shell');
        assert.equal(await page.locator('[data-schedule-view]').count(), 0, 'schedule diagnostic view buttons are removed from the visible shell');
        assert.equal(await page.locator('.staff-schedule-command-metrics').count(), 0, 'schedule header metric chips are removed from the visible shell');
        assert.equal(await page.locator('#scheduleSummary .summary-chip').count(), 0, 'schedule summary status chips are removed from the visible shell');
        await assertDepartmentChipsFit(page, 'desktop first-half');
        const actionMetrics = await page.evaluate(() => {
            const header = document.querySelector('.staff-schedule-header-actions')?.getBoundingClientRect();
            const exportButton = document.getElementById('exportExcelBtn')?.getBoundingClientRect();
            const printButton = document.getElementById('printBtn')?.getBoundingClientRect();
            return {
                headerWidth: header?.width || 0,
                exportHeight: exportButton?.height || 0,
                printHeight: printButton?.height || 0
            };
        });
        assert.ok(actionMetrics.headerWidth > 0 && actionMetrics.headerWidth <= 240, 'export/print header action group stays compact');
        assert.ok(actionMetrics.exportHeight >= 34, 'export keeps a usable touch target');
        assert.ok(actionMetrics.printHeight >= 34, 'print keeps a usable touch target');

        for (const removedId of ['scheduleActionsDropdown', 'scheduleActionsMenuBtn', 'scheduleActionsMenu', 'addStaffBtn', 'fillWeekBtn', 'copyWeekBtn', 'importExcelBtn', 'bulkCreateBtn']) {
            assert.equal(await page.locator(`#${removedId}`).count(), 0, `${removedId} is not visible shell UI`);
        }
        assert.equal(apiCalls.copyWeekBodies.length, 0, 'hidden copy-week UI does not call backend copy route');
        assert.equal(apiCalls.bulkBodies.length, 0, 'hidden fill UI does not run bulk fill');

        const hoursCallsBefore = apiCalls.hoursRanges.length;
        assert.equal(apiCalls.hoursRanges.length, hoursCallsBefore, 'removed hours view does not fetch hours');
        assert.equal(await page.locator('#scheduleBody').evaluate(el => el.classList.contains('show-hours')), false, 'removed hours view cannot mark schedule rows');
        assert.equal(await page.locator('#loadViewWrapper').isHidden(), true, 'removed load view keeps diagnostics hidden');
        assert.equal(await page.locator('#linkStatsBar').count(), 0, 'removed accounts view keeps account stats hidden');

        const downloadPromise = page.waitForEvent('download');
        await page.locator('#exportExcelBtn').click();
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), `grafik_${firstHalfFrom}_${firstHalfTo}.csv`, 'export filename uses selected first-half range');
        await page.evaluate(() => {
            window.__staffSchedulePrintCount = 0;
            window.print = () => {
                window.__staffSchedulePrintCount += 1;
            };
        });
        await page.locator('#printBtn').click();
        assert.equal(await page.evaluate(() => window.__staffSchedulePrintCount), 1, 'print button calls print flow from header');

        const scheduleCallsAfterFirstHalf = apiCalls.scheduleRanges.length;
        await page.locator('#scheduleDateFrom').fill(firstHalfTo);
        await page.locator('#scheduleDateTo').fill(firstHalfFrom);
        await page.locator('#applyScheduleRangeBtn').click();
        await page.waitForFunction(expected => document.querySelector('#scheduleDateFrom')?.value === expected, firstHalfFrom, { timeout: 20000 });
        assert.equal(apiCalls.scheduleRanges.length, scheduleCallsAfterFirstHalf, 'invalid reversed range does not refetch schedule');
        await waitForDayColumns(page, 15);

        await applyPreset(page, 'second-half');
        const secondHalfFrom = await page.locator('#scheduleDateFrom').inputValue();
        const secondHalfTo = await page.locator('#scheduleDateTo').inputValue();
        const secondHalfDays = dateRangeDays(secondHalfFrom, secondHalfTo);
        assert.equal(secondHalfFrom, '2026-07-16', 'second-half starts on day 16 of the selected month');
        assert.equal(secondHalfTo, '2026-07-31', 'second-half ends on the actual last day of a 31-day month');
        assert.equal(secondHalfDays, 16, 'second-half can render a 16-day range for 31-day months');
        await waitForDayColumns(page, secondHalfDays);
        assert.match(await page.locator('#weekLabel').innerText(), /16 .+31 .+20\d{2}/, 'visible label reflects 16-end-of-month range');
        await assertHalfMonthScheduleLayout(page, 'desktop second-half', secondHalfDays);
        assert.match(await page.locator('#scheduleBody .sch-cell[data-staff="101"][data-date="2026-07-31"]').innerText(), /10:00/, 'second-half renders schedule data through the last day');

        const scheduleCallsAfterSecondHalf = apiCalls.scheduleRanges.length;
        const tooLongEnd = new Date(`${firstHalfFrom}T00:00:00`);
        tooLongEnd.setDate(tooLongEnd.getDate() + 40);
        await page.locator('#scheduleDateFrom').fill(firstHalfFrom);
        await page.locator('#scheduleDateTo').fill(formatInputDate(tooLongEnd));
        await page.locator('#applyScheduleRangeBtn').click();
        await page.waitForFunction(expected => document.querySelector('#scheduleDateTo')?.value === expected, secondHalfTo, { timeout: 20000 });
        assert.equal(apiCalls.scheduleRanges.length, scheduleCallsAfterSecondHalf, 'range over 31 days does not refetch schedule');
        await waitForDayColumns(page, secondHalfDays);

        const manualLongRanges = [
            ['2026-02-01', '2026-02-28', 28],
            ['2026-04-01', '2026-04-30', 30],
            ['2026-07-01', '2026-07-31', 31]
        ];
        for (const [from, to, expectedDays] of manualLongRanges) {
            await applyManualRange(page, from, to);
            await assertWideScheduleLayout(page, `desktop manual ${expectedDays}d`, { expectedDays, minDayWidth: 136 });
            if (from === '2026-07-01') await assertShiftLoadClassesDoNotPaintScheduleCells(page);
        }

        // Hours toggle is no longer part of the visible command surface.
        await page.locator('#scheduleStaffSearch').fill('Женя');
        await applyPreset(page, 'month');
        assert.equal(await page.locator('#scheduleStaffSearch').inputValue(), 'Женя', 'search query survives preset changes');
        const monthFrom = await page.locator('#scheduleDateFrom').inputValue();
        const monthTo = await page.locator('#scheduleDateTo').inputValue();
        const monthDays = dateRangeDays(monthFrom, monthTo);
        await waitForDayColumns(page, monthDays);
        assert.ok(monthDays >= 28 && monthDays <= 31, 'month preset renders a real month length');
        await assertNoControlOverlap(page, 'desktop month');
        await page.locator('#scheduleStaffSearch').fill('');
        await waitForDayColumns(page, monthDays);
        await assertWideScheduleLayout(page, 'desktop month schedule', { expectedDays: monthDays, minDayWidth: 136 });
        await assertDepartmentChipsFit(page, 'desktop month');
        assert.equal(await page.locator('#loadViewWrapper').isHidden(), true, 'month schedule keeps removed load view hidden');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-month.png'), fullPage: true });

        await page.locator('#todayWeekBtn').click();
        await waitForDayColumns(page, 9);
    } finally {
        await context.close();
    }
}

async function runMobileFlow(browser, base, viewport = { width: 390, height: 844 }, label = 'mobile') {
    const { context, page } = await openStaffPage(browser, base, viewport);
    try {
        await waitForDayColumns(page, 9);
        await assertPeriodPresetLabelsAndSummary(page);
        await assertNoDuplicateDepartmentSubGroups(page);
        await assertScheduleGroupsCollapsedByDefault(page);
        await assertScheduleSearchAutoExpandsGroups(page);
        await expandAllScheduleGroups(page);
        await applyPreset(page, 'first-half');
        await waitForDayColumns(page, 15);
        await assertNoControlOverlap(page, 'mobile first-half');
        await assertDepartmentChipsFit(page, 'mobile first-half');
        await applyPreset(page, 'month');
        const monthFrom = await page.locator('#scheduleDateFrom').inputValue();
        const monthTo = await page.locator('#scheduleDateTo').inputValue();
        const monthDays = dateRangeDays(monthFrom, monthTo);
        await waitForDayColumns(page, monthDays);
        await assertNoControlOverlap(page, 'mobile month');
        await assertDepartmentChipsFit(page, 'mobile month');
        await assertWideScheduleLayout(page, 'mobile month schedule', { expectedDays: monthDays, minDayWidth: 120 });
        await page.screenshot({ path: path.join(OUTPUT_DIR, `${label}-month.png`), fullPage: true });
    } finally {
        await context.close();
    }
}

(async () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const { chromium } = requirePlaywright();
    const { server, base } = await createServer();
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        await runDesktopFlow(browser, base);
        await runMobileFlow(browser, base, { width: 390, height: 844 }, 'mobile-390');
        await runMobileFlow(browser, base, { width: 360, height: 800 }, 'mobile-360');
        console.log('Staff schedule custom range browser smoke passed');
        console.log(`Screenshots: ${path.relative(ROOT, OUTPUT_DIR)}`);
    } catch (err) {
        fail(err.stack || err.message || String(err));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})();
