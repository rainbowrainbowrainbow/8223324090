#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'output/playwright/hr-followup');
const ORIGIN = 'http://hr-followup.test';
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
            if (!/node_modules[\\/]\.bin[\\/]?$/.test(entry)) continue;
            const candidate = path.join(path.dirname(entry), 'playwright');
            if (fs.existsSync(candidate)) return require(candidate);
        }
        throw error;
    }
}

// Keep the shipped DOM and styles; bootstrap only the HR surfaces under test.
// All browser requests are fulfilled below, including local assets. No app server is used.
const HTML = read('hr.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, tag => {
        const file = tag.match(/href="(css\/[^?" ]+)/)?.[1];
        return file ? tag : '';
    });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());

function report(stale = false) {
    return { success: true, data: [{
        staff_id: 41, staff_name: stale ? 'Stale Profile Person' : 'Synthetic Alpha', role_type: 'animator',
        days_scheduled: 2, days_worked: 1, planned_worked_count: 1, unplanned_worked_count: 0,
        late_count: 1, total_worked_hours: 8, total_overtime_minutes: 0,
        task_kpi: { tasks_assigned: 2, tasks_done: 1, tasks_overdue: 0 },
        attendance_details: {
            scheduled: [{ date: '2026-10-01', planned_start: '09:00', planned_end: '17:00' },
                { date: '2026-10-02', planned_start: '09:00', planned_end: '17:00' }],
            planned_worked: [{ date: '2026-10-01', clock_in: '2026-10-01T06:07:00Z' }],
            late: [{ date: '2026-10-01', late_minutes: 7 }]
        }
    }, {
        staff_id: 42, staff_name: 'Synthetic Zulu', role_type: 'cook',
        days_scheduled: 1, days_worked: 0, planned_worked_count: 0,
        days_absent: 1, total_worked_hours: 0,
        task_kpi: { tasks_assigned: 0, tasks_done: 0, tasks_overdue: 0 },
        attendance_details: { scheduled: [{ date: '2026-10-02', planned_start: '10:00', planned_end: '18:00' }],
            absent: [{ date: '2026-10-02' }] }
    }] };
}

const PROFESSIONS = [{ id: 1, key: 'animator', title: 'Аніматор', is_active: true,
    people: [{ id: 41, isActive: true, assignmentStatus: 'active', admissionStatus: 'approved' }] }];
const todayPayload = () => ({ success: true, date: today(), data: [{
    staff_id: 41, staff_name: 'Synthetic Alpha', role_type: 'animator', is_active: true,
    shift: { shift_type: 'working', primary_profession_key: 'animator', planned_start: '09:00', planned_end: '17:00' },
    record: null
}] });

async function install(page, { membership = true, pending = false } = {}) {
    page.setDefaultTimeout(10000);
    const state = { calls: [], unexpected: [], errors: [], holdMonthly: pending, held: null,
        denyAdjuncts: false, screenshots: [] };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== ORIGIN) {
            state.unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
            return route.abort();
        }
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.startsWith('/api/')) {
            state.calls.push({ path: url.pathname, method: request.method(), headers: request.headers() });
            if (request.method() !== 'GET') {
                state.unexpected.push(`Mutation: ${request.method()} ${url.pathname}`);
                return json({ success: false, error: 'No writes in this fixture' }, 405);
            }
            if (url.pathname === '/api/hr/report/monthly') {
                if (state.holdMonthly) { state.holdMonthly = false; state.held = route; return; }
                return json(report());
            }
            if (url.pathname === '/api/hr/role-assignments/report') {
                return state.denyAdjuncts ? json({ success: false, code: 'fixture_denied', error: 'Synthetic role report 403' }, 403)
                    : json({ success: true, summary: { staff_count: 1, role_count: 1 }, data: [{
                        staff_name: 'Synthetic Alpha', profession_title: 'Аніматор', is_primary: true,
                        status: 'active', admission_status: 'approved', internship_status: 'completed'
                    }] });
            }
            if (url.pathname === '/api/staff/link-status') {
                return state.denyAdjuncts ? json({ success: false, code: 'fixture_denied', error: 'Synthetic staff links 403' }, 403)
                    : json({ success: true, data: [{ id: 41, user_id: 141, username: 'synthetic.alpha' }] });
            }
            if (url.pathname === '/api/hr/today') return json(todayPayload());
            if (url.pathname === '/api/hr/professions') return json({ success: true, data: PROFESSIONS });
            if (url.pathname === '/api/hr/staff/41') return json({ success: true, data: {
                id: 41, name: 'Synthetic Alpha', role_type: 'animator', secondary_professions: [], skills: [], is_active: true
            } });
            if (['/api/hr/company-structure', '/api/users'].includes(url.pathname)) return json({ success: true, data: [] });
            state.unexpected.push(`${request.method()} ${url.pathname}`);
            return json({ success: false, error: `Unexpected fixture request: ${url.pathname}` }, 500);
        }
        if (url.pathname === '/hr') return route.fulfill({ contentType: 'text/html', body: HTML });
        const file = path.resolve(ROOT, `.${url.pathname}`);
        if (file.startsWith(`${ROOT}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const contentType = file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
            return route.fulfill({ contentType, body: fs.readFileSync(file) });
        }
        state.unexpected.push(`Asset: ${url.pathname}`);
        return route.abort();
    });
    await page.goto(`${ORIGIN}/hr?businessContext=event_genix#reports`);
    await page.evaluate(() => {
        window.CONFIG = { STORAGE: { CURRENT_USER: 'synthetic_hr_user' } };
        window.AppState = { currentUser: { id: 71, role: 'director', name: 'Synthetic Director',
            activeBusinessContext: 'event_genix', accessContext: { status: 'ready' },
            businessContextPolicy: { allowed: ['event_genix'], defaultContext: 'event_genix', forced: 'event_genix' } } };
        localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(AppState.currentUser));
        localStorage.setItem('pzp_access_token', 'synthetic-browser-fixture');
        window.canAccess = () => true;
        window.canUseAction = () => true;
        window.resolveCapability = () => ({ allowed: true });
        window.getPermissionLifecycle = () => ({ status: 'ready' });
        const listen = document.addEventListener.bind(document);
        document.addEventListener = (name, listener, options) => name === 'DOMContentLoaded' ? undefined : listen(name, listener, options);
        window.__restoreDocumentListener = () => { document.addEventListener = listen; };
    });
    for (const script of ['js/api.js', 'js/ui.js', 'js/hr-pulse-switcher.js', 'js/hr-attendance-state.js', 'js/hr-page.js', 'js/hr-today-print.js']) {
        await page.addScriptTag({ content: read(script) });
    }
    await page.evaluate(({ membership, pending }) => {
        window.__restoreDocumentListener();
        captureApiAuthSessionSnapshot(AppState.currentUser);
        window.__applyProfile = (status, mode, emit = true) => applyCrmBusinessProfile({
            membershipMode: mode, activeBusinessId: 'event_genix', accessContext: { status },
            businesses: [{ key: 'event_genix', title: 'Synthetic Park' }]
        }, { emit, syncScope: false });
        window.__applyProfile(pending ? 'loading' : 'ready', membership ? 'membership' : 'compatibility', false);
        document.getElementById('mainApp').classList.remove('hidden');
        document.body.classList.add('shell-ready');
        document.querySelectorAll('.hr-tab-content').forEach(tab => tab.classList.toggle('active', tab.id === 'tab-reports'));
        renderHrNav('reports');
        syncHrNavActive('reports');
        window.__selectTab = name => {
            document.querySelectorAll('.hr-tab-content').forEach(tab => tab.classList.toggle('active', tab.id === `tab-${name}`));
            renderHrNav(name);
            syncHrNavActive(name);
        };
    }, { membership, pending });
    return state;
}

async function screenshot(page, state, name) {
    const file = path.join(OUTPUT, `${name}.png`);
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelectorAll('.hr-report-table-wrap').forEach(element => { element.scrollLeft = 0; });
    });
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    state.screenshots.push(file);
}

async function assertLayout(page, selector) {
    const box = await page.locator(selector).boundingBox();
    const width = page.viewportSize().width;
    assert.ok(box && box.width > 100 && box.x >= -1 && box.x + box.width <= width + 1, `${selector} fits the viewport`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page has no horizontal overflow');
}

async function runMembership(browser, width) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const state = await install(page, { membership: true, pending: true });
    try {
        await page.evaluate(() => { window.__firstReportLoad = loadReports(); });
        await page.waitForFunction(() => document.getElementById('reportBody').textContent.includes('Завантаження'));
        const requestDeadline = Date.now() + 5000;
        while (!state.held && Date.now() < requestDeadline) await new Promise(resolve => setTimeout(resolve, 5));
        assert.ok(state.held, 'the initial monthly HTTP request reached the fixture');
        await page.evaluate(() => window.__applyProfile('ready', 'membership'));
        await page.waitForFunction(() => reportState.loadState === 'ready');
        await state.held.fulfill({ contentType: 'application/json', body: JSON.stringify(report(true)) });
        state.held = null;
        await page.evaluate(() => window.__firstReportLoad);
        assert.equal(state.calls.filter(call => call.path === '/api/hr/report/monthly').length, 2, 'profile hydration automatically replaces the pending request');
        assert.equal(await page.locator('[data-report-retry]').count(), 0, 'no Retry action needed');
        assert.doesNotMatch(await page.locator('#reportBody').textContent(), /Stale Profile/);
        assert.match(await page.locator('#roleReportSummary [role="status"]').textContent(), /недоступний/);
        assert.equal(state.calls.filter(call => call.path === '/api/hr/role-assignments/report').length, 0);
        await page.locator('#reportSearch').fill('Synthetic Alpha');
        assert.equal(await page.locator('#reportBody tr').count(), 1);
        assert.match(await page.locator('#reportBody').textContent(), /Synthetic Alpha/);
        await page.locator('[data-report-detail="late"][data-staff-id="41"]').click();
        await page.locator('#reportDetailsOverlay').waitFor({ state: 'visible' });
        assert.match(await page.locator('#reportDetailsBody').textContent(), /2026-10-01/);
        await assertLayout(page, '#reportDetailsOverlay');
        await assertLayout(page, '.hr-report-details');
        await screenshot(page, state, `membership-details-${width}`);
        await page.locator('#reportDetailsClose').click();
        await page.locator('#reportSearch').fill('');
        await page.locator('[data-report-sort="staff_name"]').click();
        assert.match(await page.locator('#reportBody tr').first().textContent(), /Synthetic Zulu/);
        await assertLayout(page, '#tab-reports');
        await screenshot(page, state, `membership-reports-${width}`);

        await page.evaluate(async () => { window.__selectTab('today'); await loadToday(); });
        assert.match(await page.locator('#todayStaffLinksStatus[role="status"]').textContent(), /недоступний/);
        assert.equal(state.calls.filter(call => call.path === '/api/staff/link-status').length, 0);
        assert.match(await page.locator('#todayList').textContent(), /Synthetic Alpha/);
        assert.match(await page.locator('.hr-today-row-action--profile').getAttribute('aria-label'), /HR картку/);
        await assertLayout(page, '#tab-today');
        await screenshot(page, state, `membership-today-${width}`);
        await page.locator('.hr-today-row-action--profile').click();
        await page.waitForFunction(() => document.getElementById('staffEditModal').dataset.cardState === 'ready');
        assert.equal(await page.locator('#editStaffName').inputValue(), 'Synthetic Alpha');
        await page.evaluate(() => closeHrEditableModal('staffEditModal', true));
        await page.locator('#btnHrTodayPrint').click();
        await page.waitForFunction(() => document.getElementById('hrTodayPrintStatus').dataset.state === 'ready');
        await page.waitForFunction(() => !document.getElementById('hrTodayPrintGo').disabled);
        assert.match(await page.frameLocator('#hrTodayPrintFrame').locator('body').textContent(), /Synthetic Alpha/);
        assert.equal(await page.frameLocator('#hrTodayPrintFrame').locator('.empty-row').count(), 5);
        assert.doesNotMatch(await page.frameLocator('#hrTodayPrintFrame').locator('body').textContent(), /грн|зарплата/i);
        await screenshot(page, state, `membership-print-${width}`);
        await page.locator('#hrTodayPrintClose').click();
        assert.equal(state.calls.filter(call => ['/api/staff/link-status', '/api/hr/role-assignments/report'].includes(call.path)).length, 0);
        assert.deepEqual(state.unexpected, []);
        assert.deepEqual(state.errors, []);
        return { scenario: 'membership', width, calls: state.calls.map(({ method, path }) => ({ method, path })), screenshots: state.screenshots };
    } catch (error) {
        await screenshot(page, state, `failed-membership-${width}`);
        console.error(JSON.stringify({ errors: state.errors, unexpected: state.unexpected }));
        throw error;
    } finally { await page.close(); }
}

async function runCompatibility(browser, width) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const state = await install(page, { membership: false });
    try {
        await page.evaluate(() => loadReports());
        assert.match(await page.locator('#roleReportBody').textContent(), /Synthetic Alpha/);
        await page.evaluate(async () => { window.__selectTab('today'); await loadToday(); });
        assert.match(await page.locator('.hr-today-row-action--profile').getAttribute('aria-label'), /робочий профіль/);
        assert.equal(await page.locator('#todayStaffLinksStatus:visible').count(), 0);
        for (const url of ['/api/staff/link-status', '/api/hr/role-assignments/report']) {
            const calls = state.calls.filter(call => call.path === url);
            assert.equal(calls.length, 1, `${url} remains supported in compatibility mode`);
            assert.equal(calls[0].headers['x-business-context'], 'event_genix');
        }
        state.denyAdjuncts = true;
        await page.evaluate(async () => { clearStaffLinksCache(); await loadToday(); });
        assert.match(await page.locator('#todayStaffLinksStatus[role="alert"]').textContent(), /Synthetic staff links 403/);
        assert.match(await page.locator('#todayList').textContent(), /Synthetic Alpha/);
        assert.match(await page.locator('.hr-today-row-action--profile').getAttribute('aria-label'), /HR картку/);
        await screenshot(page, state, `compatibility-today-denied-${width}`);
        await page.evaluate(async () => { window.__selectTab('reports'); await loadReports(); });
        assert.match(await page.locator('#roleReportSummary [role="alert"]').textContent(), /Synthetic role report 403/);
        assert.match(await page.locator('#reportBody').textContent(), /Synthetic Alpha/);
        await screenshot(page, state, `compatibility-report-denied-${width}`);
        assert.deepEqual(state.unexpected, []);
        assert.deepEqual(state.errors, []);
        return { scenario: 'compatibility', width, calls: state.calls.map(({ method, path }) => ({ method, path })), screenshots: state.screenshots };
    } catch (error) {
        await screenshot(page, state, `failed-compatibility-${width}`);
        console.error(JSON.stringify({ errors: state.errors, unexpected: state.unexpected }));
        throw error;
    } finally { await page.close(); }
}

(async () => {
    fs.mkdirSync(OUTPUT, { recursive: true });
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: process.env.HR_FOLLOWUP_HEADLESS !== 'false' });
    const results = [];
    try {
        for (const width of [1440, 390]) {
            results.push(await runMembership(browser, width));
            results.push(await runCompatibility(browser, width));
        }
        fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ status: 'passed', results }, null, 2));
        console.log(`HR follow-up browser smoke passed: ${results.length} scenarios; screenshots: ${OUTPUT}`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
