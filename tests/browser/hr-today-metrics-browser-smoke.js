#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'hr-today-metrics-browser-smoke');
const HEADLESS = process.env.HR_TODAY_BROWSER_SMOKE_HEADLESS !== 'false';

function fail(message) {
    console.error(`HR Today metrics browser smoke failed: ${message}`);
    process.exit(1);
}

function readRepo(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function extractDivMarkup(source, id) {
    const marker = `<div id="${id}"`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`Unable to find #${id} in production markup`);

    const divTag = /<\/?div\b[^>]*>/gi;
    divTag.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = divTag.exec(source))) {
        if (/^<div\b/i.test(match[0])) depth += 1;
        else depth -= 1;
        if (depth === 0) return source.slice(start, divTag.lastIndex);
    }
    throw new Error(`Unable to extract #${id} from production markup`);
}

const HR_HTML = readRepo('hr.html');
const TODAY_MARKUP = extractDivMarkup(HR_HTML, 'tab-today');
const HR_ATTENDANCE_STATE_CODE = readRepo('js', 'hr-attendance-state.js');
const HR_CODE = readRepo('js', 'hr-page.js');
const CSS_BUNDLE = [
    readRepo('css', 'base.css'),
    readRepo('css', 'hr-page.css'),
    readRepo('css', 'pages-hr-foundation.css'),
    readRepo('css', 'pages-hr-staff.css')
].join('\n');

async function installHarness(page) {
    await page.setContent(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>${CSS_BUNDLE}</style></head><body data-page-group="hr"></body></html>`);
    await page.evaluate(() => {
        window.AppState = { currentUser: { id: 1, role: 'creator', name: 'QA Creator' } };
        window.__hrTodayWindowIdentity = `hr-today-${Date.now()}-${Math.random()}`;
        window.__nativeSetInterval = window.setInterval.bind(window);
        window.setInterval = (callback, delay, ...args) => window.__nativeSetInterval(
            callback,
            Number(delay) === 30000 ? 80 : delay,
            ...args
        );
        window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(options = {}) {
            this.dataset.scrollBehavior = String(options.behavior || 'auto');
            this.dataset.scrollBlock = String(options.block || '');
        };
        window.__originalAddEventListener = document.addEventListener.bind(document);
        document.addEventListener = (type, listener, options) => {
            if (type === 'DOMContentLoaded') return undefined;
            return window.__originalAddEventListener(type, listener, options);
        };
    });
    await page.addScriptTag({ content: HR_ATTENDANCE_STATE_CODE });
    await page.addScriptTag({ content: HR_CODE });
    await page.evaluate(async markup => {
        document.addEventListener = window.__originalAddEventListener;
        document.body.innerHTML = [
            '<nav id="hrNav"><button type="button" class="hr-tab active" data-tab="today">Сьогодні</button></nav>',
            markup
        ].join('');

        const openItems = [
            {
                staff_id: 11,
                staff_name: 'Open Alpha',
                position: 'Manager',
                role_type: 'manager',
                department: 'admin',
                record: { status: 'present', clock_in: '2026-07-16T06:00:00.000Z', clock_out: null, planned_start: '09:00', planned_end: '18:00' }
            },
            {
                staff_id: 12,
                staff_name: 'Late Closed Beta',
                position: 'Barista',
                role_type: 'barista',
                department: 'cafe',
                record: { status: 'late', clock_in: '2026-07-16T06:12:00.000Z', clock_out: '2026-07-16T15:00:00.000Z', late_minutes: 12, planned_start: '09:00', planned_end: '18:00', total_worked_minutes: 468 }
            },
            {
                staff_id: 13,
                staff_name: 'Absent Gamma',
                position: 'Animator',
                role_type: 'animator',
                department: 'animators',
                record: null,
                shift: { planned_start: '09:00', planned_end: '18:00' }
            },
            {
                staff_id: 14,
                staff_name: 'Sick Delta',
                position: 'Cook',
                role_type: 'cook',
                department: 'kitchen',
                record: { status: 'sick', clock_in: null, clock_out: null }
            },
            {
                staff_id: 15,
                staff_name: 'Vacation Epsilon',
                position: 'Waiter',
                role_type: 'waiter',
                department: 'cafe',
                record: { status: 'vacation', clock_in: null, clock_out: null }
            },
            {
                staff_id: 16,
                staff_name: 'Early Leave Zeta',
                position: 'Manager',
                role_type: 'manager',
                department: 'admin',
                record: { status: 'early_leave', clock_in: '2026-07-16T06:00:00.000Z', clock_out: '2026-07-16T13:00:00.000Z', early_leave_minutes: 120, total_worked_minutes: 420 }
            },
            {
                staff_id: 17,
                staff_name: 'Auto Closed Eta',
                position: 'Technician',
                role_type: 'technician',
                department: 'technical',
                record: { status: 'auto_closed', clock_in: '2026-07-16T06:00:00.000Z', clock_out: '2026-07-16T15:00:00.000Z', total_worked_minutes: 540 }
            }
        ];
        let mode = 'open';
        const requests = [];
        const displayGroups = [
            { key: 'admin', label: 'Administration', order: 0 },
            { key: 'animators', label: 'Animators', order: 1 },
            { key: 'kitchen', label: 'Kitchen', order: 2 },
            { key: 'technical', label: 'Technical', order: 3 }
        ];

        function currentItems() {
            const rows = structuredClone(openItems);
            if (mode === 'closed') {
                const openRecord = rows.find(item => item.staff_id === 11).record;
                openRecord.clock_out = '2026-07-16T15:00:00.000Z';
                openRecord.total_worked_minutes = 480;
            }
            return rows;
        }

        window.hrFetch = async (requestPath, options = {}) => {
            const method = String(options.method || 'GET').toUpperCase();
            requests.push({ path: String(requestPath), method });
            if (requestPath !== '/today') return { success: true, data: [] };
            const rows = currentItems();
            return {
                success: true,
                data: rows,
                summary: summarizeTodayItems(rows),
                displayGroups
            };
        };

        todayFilters = { query: '', department: 'all' };
        todayActiveMetric = null;
        await loadToday();
        initHrRealtime();

        window.__hrTodayBrowserSmoke = {
            identity: window.__hrTodayWindowIdentity,
            setMode(nextMode) {
                mode = nextMode === 'closed' ? 'closed' : 'open';
            },
            async refresh() {
                await loadToday();
            },
            startPolling() {
                window.startPolling();
            },
            stopPolling() {
                if (pollTimer) clearInterval(pollTimer);
                pollTimer = null;
            },
            dispatchAttendanceUpdate() {
                window.dispatchEvent(new CustomEvent('ws:hr-attendance'));
            },
            requestCount() {
                return requests.filter(request => request.path === '/today').length;
            },
            mutationCount() {
                return requests.filter(request => request.method !== 'GET').length;
            }
        };
    }, TODAY_MARKUP);
}

async function metricPeople(page, metric) {
    return page.locator(`#todayMetricPeoplePanel [data-today-metric-staff-id]`).evaluateAll(buttons => (
        buttons.map(button => button.dataset.todayMetricStaffId)
    ));
}

async function assertMetricLists(page) {
    const scenarios = [
        { metric: 'shift', countId: 'todayOnShiftMetric', ids: ['11'], context: /09:00/ },
        { metric: 'late', countId: 'todayLateMetric', ids: ['12'], context: /\+12/ },
        { metric: 'absent', countId: 'todayAbsentMetric', ids: ['13'], context: /09:00.*18:00/s },
        { metric: 'leave', countId: 'todayLeaveMetric', ids: ['14', '15'], context: /Sick Delta.*Vacation Epsilon/s }
    ];

    for (const scenario of scenarios) {
        const chip = page.locator(`[data-today-metric="${scenario.metric}"]`);
        await chip.click();
        const people = await metricPeople(page, scenario.metric);
        assert.equal(await page.locator('#todayMetricPeoplePanel').isVisible(), true, `${scenario.metric}: panel opens`);
        assert.equal(await chip.getAttribute('aria-expanded'), 'true', `${scenario.metric}: expanded state`);
        assert.equal(Number(await page.locator(`#${scenario.countId}`).textContent()), people.length, `${scenario.metric}: count matches list`);
        assert.deepEqual(people, scenario.ids, `${scenario.metric}: matching people`);
        assert.match(await page.locator('#todayMetricPeoplePanel').textContent(), scenario.context, `${scenario.metric}: useful context`);
        await chip.click();
        assert.equal(await page.locator('#todayMetricPeoplePanel').isHidden(), true, `${scenario.metric}: repeated click closes`);
    }

    assert.equal(await page.locator('[data-today-metric="shift"]').getAttribute('aria-label'), 'На зміні: 1. Показати список людей');
}

async function assertKeyboardAndFocus(page) {
    const absentChip = page.locator('[data-today-metric="absent"]');
    await absentChip.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#todayMetricPeoplePanel').isVisible(), true, 'Enter opens a metric list');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#todayMetricPeoplePanel').isHidden(), true, 'Escape closes a metric list');
    assert.equal(await absentChip.evaluate(element => document.activeElement === element), true, 'Escape restores opener focus');

    const lateChip = page.locator('[data-today-metric="late"]');
    await lateChip.click();
    await page.locator('.hr-today-metric-panel-close').click();
    assert.equal(await page.locator('#todayMetricPeoplePanel').isHidden(), true, 'close button hides a metric list');
    assert.equal(await lateChip.evaluate(element => document.activeElement === element), true, 'close button restores opener focus');

    await page.locator('[data-today-metric="shift"]').click();
    await page.locator('[data-today-metric-staff-id="11"]').click();
    const row = page.locator('#todayList [data-staff-id="11"]');
    assert.equal(await page.locator('#todayMetricPeoplePanel').isHidden(), true, 'person click closes list');
    assert.equal(await row.evaluate(element => document.activeElement === element), true, 'person click focuses the Today row');
    assert.equal(await row.evaluate(element => element.classList.contains('hr-staff-row--metric-focus')), true, 'person row is highlighted');
    assert.equal(await row.getAttribute('data-scroll-behavior'), 'smooth', 'default motion uses smooth row scroll');
    assert.equal(await page.locator('.hr-tab.active').getAttribute('data-tab'), 'today', 'person click keeps Today active');
}

async function assertCurrentFilters(page) {
    await page.locator('#todaySearch').fill('Open Alpha');
    assert.equal(await page.locator('#todayOnShiftMetric').textContent(), '1');
    assert.equal(await page.locator('#todayLateMetric').textContent(), '0');
    assert.equal(await page.locator('#todayAbsentMetric').textContent(), '0');
    assert.equal(await page.locator('#todayLeaveMetric').textContent(), '0');
    await page.locator('[data-today-metric="shift"]').click();
    assert.deepEqual(await metricPeople(page, 'shift'), ['11'], 'metric list follows the active search filter');
    await page.locator('[data-today-metric="shift"]').click();
    await page.locator('#todaySearch').fill('');
    assert.equal(await page.locator('#todayLateMetric').textContent(), '1');
}

async function assertPollingAndRealtime(page) {
    const identity = await page.evaluate(() => window.__hrTodayBrowserSmoke.identity);
    const requestsBeforePolling = await page.evaluate(() => window.__hrTodayBrowserSmoke.requestCount());
    assert.match(await page.locator('#todayList [data-staff-id="11"] .hr-clock-btn').getAttribute('onclick'), /'out'/, 'open row exposes clock-out action');

    await page.evaluate(() => {
        window.__hrTodayBrowserSmoke.setMode('closed');
        window.__hrTodayBrowserSmoke.startPolling();
    });
    await page.waitForFunction(() => (
        document.getElementById('todayOnShiftMetric')?.textContent === '0'
        && window.__hrTodayBrowserSmoke.requestCount() > 1
    ));
    await page.evaluate(() => window.__hrTodayBrowserSmoke.stopPolling());
    assert.ok(await page.evaluate(() => window.__hrTodayBrowserSmoke.requestCount()) > requestsBeforePolling, 'polling refreshes Today data');
    assert.equal(await page.locator('#todayList [data-staff-id="11"]').count(), 1, 'polling updates the existing view without navigation');
    assert.match(await page.locator('#todayList [data-staff-id="11"] .hr-clock-btn').getAttribute('onclick'), /'in'/, 'closed row no longer exposes clock-out action');
    await page.locator('[data-today-metric="shift"]').click();
    assert.deepEqual(await metricPeople(page, 'shift'), [], 'closed shift is removed from the drill-down');
    await page.locator('[data-today-metric="shift"]').click();
    assert.equal(await page.evaluate(expected => window.__hrTodayWindowIdentity === expected, identity), true, 'polling does not reload the page');

    const requestsBeforeRealtimeOpen = await page.evaluate(() => window.__hrTodayBrowserSmoke.requestCount());
    await page.evaluate(() => {
        window.__hrTodayBrowserSmoke.setMode('open');
        window.__hrTodayBrowserSmoke.dispatchAttendanceUpdate();
    });
    await page.waitForFunction(before => (
        document.getElementById('todayOnShiftMetric')?.textContent === '1'
        && window.__hrTodayBrowserSmoke.requestCount() > before
    ), requestsBeforeRealtimeOpen);

    const requestsBeforeRealtimeClose = await page.evaluate(() => window.__hrTodayBrowserSmoke.requestCount());
    await page.evaluate(() => {
        window.__hrTodayBrowserSmoke.setMode('closed');
        window.__hrTodayBrowserSmoke.dispatchAttendanceUpdate();
    });
    await page.waitForFunction(before => (
        document.getElementById('todayOnShiftMetric')?.textContent === '0'
        && window.__hrTodayBrowserSmoke.requestCount() > before
    ), requestsBeforeRealtimeClose);
    assert.equal(await page.evaluate(() => window.__hrTodayBrowserSmoke.mutationCount()), 0, 'browser smoke remains read-only');
}

async function assertMobileThemeAndReducedMotion(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.evaluate(async () => {
        document.documentElement.dataset.theme = 'dark';
        document.body.classList.add('dark-mode');
        window.__hrTodayBrowserSmoke.setMode('open');
        await window.__hrTodayBrowserSmoke.refresh();
    });
    await page.locator('[data-today-metric="shift"]').click();
    const darkPanelBackground = await page.locator('#todayMetricPeoplePanel').evaluate(element => getComputedStyle(element).backgroundColor);
    assert.notEqual(darkPanelBackground, 'rgba(0, 0, 0, 0)', 'dark theme keeps an explicit panel surface');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile Today view has no horizontal overflow');
    await page.locator('[data-today-metric-staff-id="11"]').click();
    assert.equal(await page.locator('#todayList [data-staff-id="11"]').getAttribute('data-scroll-behavior'), 'auto', 'reduced motion disables smooth row scroll');
}

async function run() {
    const playwright = requirePlaywright();
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15000);
    try {
        await installHarness(page);
        assert.equal(await page.locator('#todayOnShiftMetric').textContent(), '1');
        assert.equal(await page.locator('#todayLateMetric').textContent(), '1');
        assert.equal(await page.locator('#todayAbsentMetric').textContent(), '1');
        assert.equal(await page.locator('#todayLeaveMetric').textContent(), '2');
        await assertMetricLists(page);
        await assertKeyboardAndFocus(page);
        await assertCurrentFilters(page);
        await assertPollingAndRealtime(page);
        await assertMobileThemeAndReducedMotion(page);
        console.log('HR Today metrics browser smoke passed');
    } catch (err) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'failure.png'), fullPage: true }).catch(() => {});
        throw err;
    } finally {
        await browser.close().catch(() => {});
    }
}

run().catch(err => fail(err?.stack || err?.message || String(err)));
