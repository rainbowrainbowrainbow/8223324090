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
        const unrelatedRealtimeDate = new Date(Date.now() + (32 * 24 * 60 * 60 * 1000));
        window.__hrTodayUnrelatedRealtimeDate = unrelatedRealtimeDate.toISOString().slice(0, 10);
        const parkWsDates = new Set([window.__hrTodayUnrelatedRealtimeDate]);
        const parkWsEvents = [];
        window.ParkWS = {
            connect() {
                parkWsEvents.push({ type: 'connect' });
            },
            subscribeDate(date) {
                parkWsDates.add(date);
                parkWsEvents.push({ type: 'subscribe', date });
            },
            unsubscribeDate(date) {
                parkWsDates.delete(date);
                parkWsEvents.push({ type: 'unsubscribe', date });
            },
            subscribedDates() {
                return [...parkWsDates].sort();
            },
            events() {
                return structuredClone(parkWsEvents);
            },
            clearEvents() {
                parkWsEvents.length = 0;
            }
        };
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
            } else if (mode === 'late-open') {
                const lateRecord = rows.find(item => item.staff_id === 12).record;
                lateRecord.clock_out = null;
                lateRecord.total_worked_minutes = null;
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
                mode = ['closed', 'late-open'].includes(nextMode) ? nextMode : 'open';
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
            subscribedDates() {
                return window.ParkWS.subscribedDates();
            },
            unrelatedRealtimeDate() {
                return window.__hrTodayUnrelatedRealtimeDate;
            },
            realtimeEvents() {
                return window.ParkWS.events();
            },
            clearRealtimeEvents() {
                window.ParkWS.clearEvents();
            },
            syncRealtimeDate(iso) {
                return syncHrRealtimeDateSubscription(new Date(iso));
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

async function assertRealtimeDateSubscriptions(page) {
    const initial = await page.evaluate(() => ({
        today: hrTodayKyivDate(new Date()),
        dates: window.__hrTodayBrowserSmoke.subscribedDates(),
        unrelatedDate: window.__hrTodayBrowserSmoke.unrelatedRealtimeDate(),
        events: window.__hrTodayBrowserSmoke.realtimeEvents()
    }));
    assert.deepEqual(initial.dates, [initial.today, initial.unrelatedDate].sort(), 'HR adds only its Kyiv date to existing subscriptions');
    const subscribeIndex = initial.events.findIndex(event => event.type === 'subscribe' && event.date === initial.today);
    const connectIndex = initial.events.findIndex(event => event.type === 'connect');
    assert.ok(subscribeIndex >= 0 && connectIndex > subscribeIndex, 'HR subscribes before opening the WebSocket');

    const rollover = await page.evaluate(() => {
        window.__hrTodayBrowserSmoke.clearRealtimeEvents();
        const before = window.__hrTodayBrowserSmoke.syncRealtimeDate('2026-07-16T20:59:59.000Z');
        const after = window.__hrTodayBrowserSmoke.syncRealtimeDate('2026-07-16T21:00:01.000Z');
        return {
            before,
            after,
            dates: window.__hrTodayBrowserSmoke.subscribedDates(),
            events: window.__hrTodayBrowserSmoke.realtimeEvents()
        };
    });
    assert.equal(rollover.before, '2026-07-16', 'Kyiv date remains on the old day before midnight');
    assert.equal(rollover.after, '2026-07-17', 'Kyiv date advances after midnight');
    assert.deepEqual(rollover.dates, ['2026-07-17', initial.unrelatedDate].sort(), 'date rollover replaces only the HR-owned subscription');
    assert.ok(rollover.events.some(event => event.type === 'subscribe' && event.date === '2026-07-16'));
    assert.ok(rollover.events.some(event => event.type === 'subscribe' && event.date === '2026-07-17'));
    assert.ok(rollover.events.some(event => event.type === 'unsubscribe' && event.date === '2026-07-16'));
    assert.equal(rollover.events.some(event => event.type === 'unsubscribe' && event.date === initial.unrelatedDate), false, 'unrelated date subscription is preserved');

    await page.evaluate(() => syncHrRealtimeDateSubscription(new Date()));
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

async function setThemeAndMode(page, theme, mode) {
    await page.evaluate(async ({ nextTheme, nextMode }) => {
        document.documentElement.dataset.theme = nextTheme;
        document.body.classList.toggle('dark-mode', nextTheme === 'dark');
        window.__hrTodayBrowserSmoke.setMode(nextMode);
        await window.__hrTodayBrowserSmoke.refresh();
    }, { nextTheme: theme, nextMode: mode });
}

async function buttonStyle(page, staffId) {
    return page.locator(`#todayList [data-staff-id="${staffId}"] .hr-clock-btn`).evaluate(element => {
        const style = getComputedStyle(element);
        return {
            className: element.className,
            backgroundColor: style.backgroundColor,
            color: style.color,
            cursor: style.cursor,
            opacity: style.opacity,
            disabled: element.disabled
        };
    });
}

async function assertButtonThemeStates(page) {
    await setThemeAndMode(page, 'light', 'open');
    const lightClockIn = await buttonStyle(page, 13);
    const lightOpen = await buttonStyle(page, 11);
    const lightDone = await buttonStyle(page, 12);
    assert.match(lightClockIn.className, /clock-in/);
    assert.match(lightOpen.className, /clock-out/);
    assert.match(lightDone.className, /done/);
    assert.notEqual(lightClockIn.backgroundColor, lightOpen.backgroundColor, 'light clock-in and open states remain distinct');
    assert.notEqual(lightOpen.backgroundColor, lightDone.backgroundColor, 'light open and done states remain distinct');

    await setThemeAndMode(page, 'dark', 'open');
    const darkClockIn = await buttonStyle(page, 13);
    const darkOpen = await buttonStyle(page, 11);
    const darkDone = await buttonStyle(page, 12);
    assert.notEqual(darkClockIn.backgroundColor, darkOpen.backgroundColor, 'dark clock-in and open states are distinct');
    assert.notEqual(darkOpen.backgroundColor, darkDone.backgroundColor, 'dark open and done states are distinct');
    assert.notEqual(darkClockIn.backgroundColor, darkDone.backgroundColor, 'dark clock-in and done states are distinct');

    await setThemeAndMode(page, 'dark', 'late-open');
    const darkLate = await buttonStyle(page, 12);
    assert.match(darkLate.className, /clock-out late/);
    assert.notEqual(darkLate.backgroundColor, darkOpen.backgroundColor, 'dark late state is distinct from regular open state');

    await setThemeAndMode(page, 'dark', 'closed');
    const disabledDone = await buttonStyle(page, 11);
    assert.equal(disabledDone.disabled, true, 'completed state remains disabled');
    assert.equal(disabledDone.cursor, 'default', 'completed state keeps a non-action cursor');
    assert.ok(Number(disabledDone.opacity) < 1, 'disabled dark state has explicit visual treatment');

    await setThemeAndMode(page, 'dark', 'open');
    const openButton = page.locator('#todayList [data-staff-id="11"] .hr-clock-btn');
    const darkOpenBeforeHover = (await buttonStyle(page, 11)).backgroundColor;
    await openButton.hover();
    await page.waitForTimeout(180);
    const darkOpenAfterHover = (await buttonStyle(page, 11)).backgroundColor;
    assert.notEqual(darkOpenAfterHover, darkOpenBeforeHover, 'dark open hover has a visible state');
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
        await assertRealtimeDateSubscriptions(page);
        await assertPollingAndRealtime(page);
        await assertButtonThemeStates(page);
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
