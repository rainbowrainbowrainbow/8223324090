#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.STAFF_SCHEDULE_BROWSER_SMOKE_HEADLESS !== 'false';
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'staff-schedule-custom-range-smoke');

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
            data: [],
            displayGroups: DISPLAY_GROUPS
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
    const context = await browser.newContext({ viewport });
    await context.addInitScript(user => {
        localStorage.setItem('pzp_token', 'staff-schedule-smoke-token');
        localStorage.setItem('pzp_access_token', 'staff-schedule-smoke-token');
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'false');
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
        const wrapper = document.querySelector('#scheduleWrapper');
        return {
            command,
            range,
            search,
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
    assert.ok(metrics.wrapperScrollWidth >= metrics.wrapperClientWidth, `${label}: schedule wrapper owns horizontal width`);
}

async function runDesktopFlow(browser, base) {
    const { context, page } = await openStaffPage(browser, base, { width: 1440, height: 900 });
    try {
        await waitForDayColumns(page, 9);

        await applyPreset(page, 'first-half');
        const firstHalfFrom = await page.locator('#scheduleDateFrom').inputValue();
        const firstHalfTo = await page.locator('#scheduleDateTo').inputValue();
        assert.equal(firstHalfFrom.endsWith('-01'), true, 'first-half starts on day 1');
        assert.equal(firstHalfTo.endsWith('-15'), true, 'first-half ends on day 15');
        await waitForDayColumns(page, 15);
        assert.match(await page.locator('#weekLabel').innerText(), /1 .+15 .+20\d{2}/, 'visible label reflects 1-15 range');
        assert.equal(await page.locator('#copyWeekBtn').getAttribute('aria-disabled'), 'true', 'copy-week is disabled for custom first-half range');

        const scheduleCallsAfterFirstHalf = apiCalls.scheduleRanges.length;
        await page.locator('#scheduleDateFrom').fill(firstHalfTo);
        await page.locator('#scheduleDateTo').fill(firstHalfFrom);
        await page.locator('#applyScheduleRangeBtn').click();
        await page.waitForFunction(expected => document.querySelector('#scheduleDateFrom')?.value === expected, firstHalfFrom, { timeout: 20000 });
        assert.equal(apiCalls.scheduleRanges.length, scheduleCallsAfterFirstHalf, 'invalid reversed range does not refetch schedule');
        await waitForDayColumns(page, 15);

        const tooLongEnd = new Date(`${firstHalfFrom}T00:00:00`);
        tooLongEnd.setDate(tooLongEnd.getDate() + 40);
        await page.locator('#scheduleDateFrom').fill(firstHalfFrom);
        await page.locator('#scheduleDateTo').fill(formatInputDate(tooLongEnd));
        await page.locator('#applyScheduleRangeBtn').click();
        await page.waitForFunction(expected => document.querySelector('#scheduleDateTo')?.value === expected, firstHalfTo, { timeout: 20000 });
        assert.equal(apiCalls.scheduleRanges.length, scheduleCallsAfterFirstHalf, 'range over 31 days does not refetch schedule');
        await waitForDayColumns(page, 15);

        await page.locator('#toggleHoursBtn').click();
        await page.waitForFunction(() => document.querySelector('.emp-hours')?.textContent?.trim(), null, { timeout: 20000 });
        assert.deepEqual(apiCalls.hoursRanges.at(-1), { from: firstHalfFrom, to: firstHalfTo }, 'hours endpoint uses selected first-half range');

        await page.locator('#scheduleStaffSearch').fill('Женя');
        await applyPreset(page, 'month');
        assert.equal(await page.locator('#scheduleStaffSearch').inputValue(), 'Женя', 'search query survives preset changes');
        const monthFrom = await page.locator('#scheduleDateFrom').inputValue();
        const monthTo = await page.locator('#scheduleDateTo').inputValue();
        const monthDays = dateRangeDays(monthFrom, monthTo);
        await waitForDayColumns(page, monthDays);
        assert.ok(monthDays >= 28 && monthDays <= 31, 'month preset renders a real month length');
        await assertNoControlOverlap(page, 'desktop month');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-month.png'), fullPage: true });

        await page.locator('#copyWeekBtn').click({ force: true });
        await page.waitForSelector('.confirm-overlay[data-confirm-kind="confirm"]', { timeout: 20000 });
        const copyMessage = await page.locator('.confirm-message').innerText();
        assert.match(copyMessage, /Копія тижня недоступна для довільного періоду/, 'copy-week explains custom range block');
        assert.equal(apiCalls.copyWeekBodies.length, 0, 'custom range copy-week does not call backend');
        await page.locator('.confirm-ok').click();

        await applyPreset(page, 'first-half');
        await page.locator('#fillWeekBtn').click();
        await page.waitForSelector('#fillWeekOverlay.visible', { timeout: 20000 });
        assert.equal(await page.locator('#fillWeekTitle').innerText(), 'Заповнити період', 'fill modal title reflects custom period');
        assert.match(await page.locator('#fillWeekPeriodHint').innerText(), /видимий період/, 'fill modal explains visible period behavior');
        await page.locator('#fillStaffSelect').selectOption('101');
        await page.locator('#fillDaysRow input[type="checkbox"]').evaluateAll(inputs => {
            for (const input of inputs) {
                input.checked = false;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await page.locator('#fillDaysRow input[value="3"]').check();
        await page.locator('#fillSaveBtn').click();
        await page.waitForSelector('.confirm-overlay[data-confirm-kind="confirm"]', { timeout: 20000 });
        const fillConfirmMessage = await page.locator('.confirm-message').innerText();
        assert.match(fillConfirmMessage, /Заповнити \d+ записів за період/, 'large custom fill shows confirmation');
        await page.locator('.confirm-ok').click();
        await waitForCondition(() => apiCalls.bulkBodies.length > 0, 'bulk fill mock API was not called');

        const bulkBody = apiCalls.bulkBodies.at(-1);
        assert.ok(bulkBody && Array.isArray(bulkBody.entries), 'bulk fill posts entries to mock API');
        assert.ok(bulkBody.entries.length > 0, 'bulk fill has at least one entry');
        assert.equal(bulkBody.entries.every(entry => Number(entry.staffId) === 101), true, 'bulk fill targets selected staff only');
        assert.equal(bulkBody.entries.every(entry => entry.date >= firstHalfFrom && entry.date <= firstHalfTo), true, 'bulk fill stays inside 1-15 range');
        assert.equal(bulkBody.entries.every(entry => isWeekday(entry.date, 3)), true, 'bulk fill keeps selected weekday filter');

        await page.locator('#todayWeekBtn').click();
        await page.waitForFunction(() => document.querySelector('#copyWeekBtn')?.getAttribute('aria-disabled') === 'false', null, { timeout: 20000 });
        await waitForDayColumns(page, 9);
    } finally {
        await context.close();
    }
}

async function runMobileFlow(browser, base) {
    const { context, page } = await openStaffPage(browser, base, { width: 390, height: 844 });
    try {
        await applyPreset(page, 'first-half');
        await waitForDayColumns(page, 15);
        await assertNoControlOverlap(page, 'mobile first-half');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-first-half.png'), fullPage: true });
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
        await runMobileFlow(browser, base);
        console.log('Staff schedule custom range browser smoke passed');
        console.log(`Screenshots: ${path.relative(ROOT, OUTPUT_DIR)}`);
    } catch (err) {
        fail(err.stack || err.message || String(err));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})();
