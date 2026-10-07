'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const { DATABASES, assertLocalTarget, seedDataset, preflight } = require('../../scripts/lib/education-ready-dataset');
const { createResults } = require('../helpers/education-ready-results');
const mode = process.env.EDU_READY_MODE || 'fixed';
assertLocalTarget(mode);
const base = process.env.TEST_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const out = path.resolve(`output/education-ready/02/${mode}`);
fs.mkdirSync(out, { recursive: true });
const attemptOut = path.join(out, `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(attemptOut, { recursive: true });
const report = createResults();
const evidence = { mode, startedAt: new Date().toISOString(), checks: report.results, screenshots: [], requests: [], pageErrors: [],
    scope: 'Real UI and real Express/PostgreSQL; fixture setup is SQL, no UI repair or mocked product responses' };
const pool = new Pool({ host: process.env.PGHOST, port: Number(process.env.PGPORT), database: DATABASES[mode], user: process.env.PGUSER || 'postgres', ssl: false });
let browser, token, manifest, appPool;
function flush() {
    let text = JSON.stringify(evidence, null, 2);
    for (const value of [process.env.TEST_USER, process.env.TEST_PASS, token].filter(Boolean)) text = text.split(value).join('[REDACTED]');
    fs.writeFileSync(path.join(out, 'verification.json'), text);
    fs.writeFileSync(path.join(attemptOut, 'verification.json'), text);
}
async function check(id, name, action, options) {
    await report.check(id, name, action, options); flush();
    console.log(`${report.results.at(-1).status} ${id}: ${name}`);
}
async function api(route) {
    const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, `GET ${route.split('?')[0]} returned ${response.status}`);
    return response.json();
}
async function goto(page, view, date = manifest.anchorDate, context = 'dar') {
    await page.goto(`${base}/?businessContext=${context}&educationSchedule=${view}&date=${date}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForFunction(({ view, context, date }) => window.CrmBusinessContext?.current?.() === context
        && window.EducationScheduleWorkspace?.state.activeView === view && document.getElementById('timelineDate')?.value === date, { view, context, date });
}
async function shot(page, name) {
    const text = await page.locator('body').innerText();
    if (process.env.TEST_USER && text.includes(process.env.TEST_USER)) {
        evidence.screenshots.push({ name, status: 'NOT CAPTURED', reason: 'Credential identifier visible' }); return;
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, name), fullPage: false });
    fs.copyFileSync(path.join(out, name), path.join(attemptOut, name));
    evidence.screenshots.push({ name, status: 'CAPTURED', syntheticOnly: true });
}
async function main() {
    const auth = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: process.env.TEST_USER, password: process.env.TEST_PASS }) });
    assert.equal(auth.status, 200); const login = await auth.json(); token = login.accessToken || login.token;
    await check('fixtures', 'Owned dataset and independent SQL preflight', async () => {
        const seeded = await seedDataset(pool, mode); manifest = seeded.manifest;
        evidence.preflight = await preflight(pool, manifest); evidence.reused = seeded.reused;
        fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
        if (mode === 'fixed') {
            for (const context of ['dar', 'maysternya_doli']) {
                const response = await fetch(`${base}/api/business/cabinet?businessContext=${context}`, {
                    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet' }) });
                assert.equal(response.status, 200);
            }
        }
    });
    if (!manifest) return;
    await check('idempotency', 'Repeated load retains exact IDs and counts', async () => {
        const repeated = await seedDataset(pool, mode); assert.equal(repeated.reused, true);
        assert.deepEqual(repeated.manifest, manifest);
        assert.deepEqual(await preflight(pool, repeated.manifest), evidence.preflight);
    }, { dependsOn: ['fixtures'] });
    await check('reports-api', 'Historical report matches independent fixture and SQL totals', async () => {
        evidence.apiReports = {};
        for (const expected of [manifest.expectedReports.historical, ...Object.values(manifest.expectedReports.byGroup),
            manifest.expectedReports.secondary, manifest.expectedReports.nonEducation]) {
            const query = new URLSearchParams({ businessContext: expected.context, from: expected.from, to: expected.to });
            if (expected.groupKey) query.set('groupId', manifest.ids.groups[expected.groupKey]);
            const payload = await api(`/api/education/reports?${query}`);
            assert.deepEqual(payload.report.summary, expected.summary);
            assert.equal(payload.report.lessons.length, expected.lessonCount);
            evidence.apiReports[`${expected.context}:${expected.groupKey || 'all'}`] = payload.report.summary;
        }
    }, { dependsOn: ['fixtures'] });
    await check('report-fixed-clock-contract', 'Product report contract uses a fixed Kyiv noon against the independent full-period oracle', async () => {
        // This is an explicitly separate service contract, not a UI or HTTP lifecycle assertion.
        appPool = require('../../db').pool;
        const utcNoon = new Date(`${manifest.anchorDate}T12:00:00Z`);
        const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' }).format(utcNoon));
        const fixedNoon = new Date(utcNoon.getTime() - (localHour - 12) * 3600000);
        const expected = manifest.expectedReports.fixedClockFull;
        const result = await require('../../services/educationAttendance').report('dar', { from: expected.from, to: expected.to, now: fixedNoon });
        assert.deepEqual(result.summary, expected.summary);
        assert.equal(result.lessons.length, expected.lessonCount);
        evidence.fixedClockContract = { level: 'Service contract only', now: fixedNoon.toISOString(), summary: result.summary };
    }, { dependsOn: ['fixtures'] });
    await check('journal-history', 'Frozen roster, all statuses and correction history are real persisted rows', async () => {
        const old = (await api(`/api/education/attendance/${manifest.ids.bookings['english-0']}?businessContext=dar`)).journal;
        const recent = (await api(`/api/education/attendance/${manifest.ids.bookings['english-2']}?businessContext=dar`)).journal;
        assert.equal(old.frozen, true); assert.equal(old.members.length, 6);
        assert.ok(old.members.some(row => Number(row.child_id) === Number(manifest.ids.children['child-0'])));
        assert.ok(!recent.members.some(row => Number(row.child_id) === Number(manifest.ids.children['child-0'])));
        assert.ok(recent.members.some(row => Number(row.child_id) === Number(manifest.ids.children['child-6'])));
        const corrected = old.members.find(row => row.history.length === 2);
        assert.ok(corrected); assert.deepEqual(corrected.history.map(row => [row.previous_status, row.new_status]), [[null, 'absent'], ['absent', 'present']]);
        assert.notEqual(corrected.history[0].changed_by, corrected.history[1].changed_by);
        const unfinished = (await api(`/api/education/attendance/${manifest.ids.bookings['english-1']}?businessContext=dar`)).journal;
        assert.equal(unfinished.frozen, false); assert.ok(unfinished.members.every(row => row.status === null));
        evidence.journalProof = { frozenOldMembers: old.members.length, replacementPresent: true,
            correctionEvents: corrected.history.map(row => ({ previous: row.previous_status, next: row.new_status, actor: row.changed_by })),
            notStartedMembers: unfinished.members.length };
    }, { dependsOn: ['fixtures'] });
    await check('isolation-api', 'Context reads exclude foreign groups, children and lessons', async () => {
        const primary = await api('/api/education/groups?businessContext=dar&includeArchived=true');
        const second = await api('/api/education/groups?businessContext=maysternya_doli&includeArchived=true');
        const control = await api('/api/education/groups?businessContext=event_genix&includeArchived=true');
        assert.equal(primary.groups.length, 6); assert.equal(second.groups.length, 1); assert.equal(control.groups.length, 0);
        for (const [route, foreign] of [[`/api/education/groups/${manifest.ids.groups.secondary}?businessContext=dar`, 'group'],
            [`/api/education/attendance/${manifest.ids.bookings['second-0']}?businessContext=dar`, 'journal']]) {
            const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
            assert.equal(response.status, 404, `${foreign} must be hidden across business boundaries`);
        }
        evidence.isolation = { primaryGroups: 6, secondaryGroups: 1, controlGroups: 0, foreignReadStatus: 404, staffScope: 'Global table; business isolation unsupported by existing staff schema' };
    }, { dependsOn: ['fixtures'] });
    await check('series-api', 'Four real weekly series retain three canonical occurrences each', async () => {
        for (let index = 0; index < 4; index++) {
            const route = `/api/bookings/education-series/ELS-READY-${mode}-${index}?businessContext=dar`;
            const payload = await api(`${route}&includeCancelled=true`);
            assert.equal(payload.bookings.length, 3);
            assert.deepEqual(payload.bookings.map(row => row.extraData.educationLesson.seriesIndex).sort(), [1, 2, 3]);
            const active = await api(route);
            assert.equal(active.bookings.length, manifest.plan.lessons.filter(row => row.series?.id === `ELS-READY-${mode}-${index}` && !row.cancelled).length);
        }
    }, { dependsOn: ['fixtures'] });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => evidence.pageErrors.push({ type: error.name, message: error.message.slice(0, 200) }));
    page.on('response', response => { const url = new URL(response.url());
        if (/^\/api\/(education|staff|bookings)/.test(url.pathname)) evidence.requests.push({ path: url.pathname, status: response.status(), method: response.request().method(),
            context: url.searchParams.get('businessContext') || response.request().headers()['x-business-context'] || null }); });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill(process.env.TEST_USER); await page.locator('#password').fill(process.env.TEST_PASS);
    await page.locator('#loginForm button[type="submit"]').click(); await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    await check('today-ui', 'Four real lessons with readable teacher/group/cabinet data appear in Today', async () => {
        await goto(page, 'today');
        try {
            await page.waitForFunction(() => window.EducationScheduleWorkspace?.state.loading === false
                && document.querySelectorAll('#educationTodayList [data-education-booking-id]').length === 4);
        } catch (error) {
            evidence.todayFailure = await page.evaluate(() => ({ selectedDate: document.getElementById('timelineDate')?.value,
                date: window.EducationScheduleWorkspace?.state.date, loading: window.EducationScheduleWorkspace?.state.loading,
                ids: window.EducationScheduleWorkspace?.state.bookings?.map(row => row.id),
                cards: [...document.querySelectorAll('#educationTodayList [data-education-booking-id]')].map(row => row.dataset.educationBookingId),
                status: document.getElementById('educationTodayStatus')?.textContent }));
            evidence.todayFailure.sql = (await pool.query('SELECT id,date,time,status FROM bookings WHERE business_context=$1 AND date=$2 ORDER BY time', ['dar', manifest.anchorDate])).rows;
            await shot(page, 'today-failed.png');
            throw error;
        }
        const text = await page.locator('#educationTodayList').innerText();
        for (const name of ['Олена Ковальчук', 'Максим Левченко', 'Ірина Бондар', 'Софія Мельник']) assert.ok(text.includes(name));
        assert.doesNotMatch(text, /QA Duration|Teacher Alpha|Original/);
        await shot(page, 'today.png');
    });
    await check('groups-ui', 'Six groups, full membership and historical replacement are visible', async () => {
        await goto(page, 'groups');
        await page.locator(`#educationGroupsList option[value="${manifest.ids.groups.english}"]`).waitFor({ state: 'attached' });
        assert.equal(await page.locator('#educationGroupsList option').count(), 7);
        await page.locator('#educationGroupsList').selectOption(String(manifest.ids.groups.english));
        await page.waitForFunction(() => document.getElementById('educationGroupOccupancy')?.textContent === '6 / 6 дітей сьогодні');
        assert.match(await page.locator('#educationGroupMembers').innerText(), /Марта Романюк/);
        assert.match(await page.locator('#educationGroupMembers').innerText(), /Наталія Романюк/);
        await shot(page, 'full-group.png');
        await page.locator('#educationGroupsList').selectOption(String(manifest.ids.groups.empty));
        await page.waitForFunction(() => document.getElementById('educationGroupOccupancy')?.textContent === '0 / 6 дітей сьогодні');
        await page.locator('#educationGroupsList').selectOption(String(manifest.ids.groups.archive));
        await page.waitForFunction(() => document.getElementById('educationGroupName')?.disabled === true);
        await shot(page, 'archive-group.png');
    });
    await check('journal-ui', 'Real journal renders all statuses, frozen roster and correction actors', async () => {
        const lesson = manifest.plan.lessons.find(row => row.key === 'english-0');
        await goto(page, 'attendance', lesson.date);
        await page.locator('#educationAttendanceDate').fill(lesson.date);
        await page.locator('#educationAttendanceDate').press('Tab');
        const id = manifest.ids.bookings[lesson.key];
        await page.locator(`#educationAttendanceLesson option[value="${id}"]`).waitFor({ state: 'attached' });
        const response = page.waitForResponse(value => value.request().method() === 'GET'
            && new URL(value.url()).pathname === `/api/education/attendance/${id}`);
        await page.locator('#educationAttendanceLesson').selectOption(id);
        assert.equal((await response).status(), 200);
        await page.locator('#educationAttendanceJournal [data-attendance-child-id]').first().waitFor({ state: 'visible' });
        assert.equal(await page.locator('#educationAttendanceJournal [data-attendance-child-id]').count(), 6);
        for (const mark of lesson.marks) assert.equal(await page.locator(`[data-attendance-child-id="${manifest.ids.children[mark.childKey]}"]`).inputValue(), mark.status || '');
        const text = await page.locator('#educationAttendanceJournal').innerText();
        assert.match(text, /Склад журналу зафіксовано/); assert.match(text, /Адміністратор Марія/);
        assert.match(text, /Викладач Олена/); assert.match(text, /Відсутній → Присутній/);
        await shot(page, 'journal-history.png');
    });
    await check('teacher-source-ui', 'Rich SQL data does not turn a broken teacher selector into PASS', async () => {
        const source = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === '/api/staff' && (url.searchParams.get('businessContext') === 'dar'
                || response.request().headers()['x-business-context'] === 'dar');
        });
        await goto(page, 'groups');
        const response = await source; await response.finished();
        evidence.teacherSource = { status: response.status(), context: 'dar', sqlActiveCount: manifest.ids.teachers.length };
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.locator(`#educationGroupsList option[value="${manifest.ids.groups.english}"]`).waitFor({ state: 'attached' });
        const values = await page.locator('#educationGroupTeacher option').evaluateAll(rows => rows.map(row => row.value));
        evidence.teacherOptions = values;
        for (const id of manifest.ids.teachers) assert.ok(values.includes(String(id)), 'Active teacher missing in real UI');
    });
    await check('report-direct-ui', 'Direct report route must display verified results without hidden bypass', async () => {
        await goto(page, 'reports');
        // Initial direct route defaults to the current month; no helper call or forced run.
        try { await page.locator('#educationReportResult .education-report-summary').waitFor({ state: 'visible', timeout: 10000 }); }
        catch { await shot(page, 'report-direct-failed.png'); throw new Error('Real direct report route has no rendered summary'); }
    });
    await check('report-button-ui', 'Visible report action displays the independently known historical totals', async () => {
        const expected = manifest.expectedReports.historical;
        await page.locator('#educationReportFrom').fill(expected.from); await page.locator('#educationReportTo').fill(expected.to);
        await page.locator('#educationReportGroup').selectOption('');
        const response = page.waitForResponse(value => value.request().method() === 'GET' && new URL(value.url()).pathname === '/api/education/reports'
            && new URL(value.url()).searchParams.get('from') === expected.from);
        await page.locator('#educationReportRun').click(); assert.equal((await response).status(), 200);
        await page.waitForFunction(() => document.querySelectorAll('#educationReportResult .education-report-summary strong').length === 8);
        const values = await page.locator('#educationReportResult .education-report-summary strong').allTextContents();
        assert.deepEqual(values.map(Number), Object.values(expected.summary));
        await shot(page, 'historical-report.png');
    });
    await check('page-errors', 'No unhandled browser errors during dataset review', async () => assert.deepEqual(evidence.pageErrors, []));
}
main().catch(error => { evidence.fatal = { type: error.name, message: error.message.slice(0, 200) }; process.exitCode = 1; })
    .finally(async () => { if (browser) await browser.close(); await pool.end(); if (appPool) await appPool.end(); evidence.finishedAt = new Date().toISOString();
        evidence.exitCode = process.exitCode || report.exitCode(); process.exitCode = evidence.exitCode; flush(); });
