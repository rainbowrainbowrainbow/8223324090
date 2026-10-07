'use strict';

// Real responses may be held at barriers; product response bodies are never mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const { initializeTimelineResources } = require('../../services/timelineResources');
const { FixtureBlocked, createResults } = require('../helpers/education-ready-results');
assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
const base = process.env.TEST_URL;
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const out = path.resolve('output/education-ready/2026-10-03');
fs.mkdirSync(out, { recursive: true });
const attemptId = new Date().toISOString().replace(/[:.]/g, '-');
const attemptOut = path.join(out, `attempt-${attemptId}`);
fs.mkdirSync(attemptOut, { recursive: true });
const report = createResults();
const evidence = { environment: 'Actual HTML/JS -> Express -> disposable PostgreSQL',
    fixturePolicy: 'Independent API/SQL preconditions only; no fallback after failed UI steps',
    attemptId, checks: report.results, proofs: {}, screenshots: [], requests: [], pageErrors: [] };
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
let browser, token;
const fixtures = {};
const days = { lesson: '2027-08-17', journal: '2026-09-28', a: '2027-10-14', b: '2027-10-15' };
function flush() {
    let json = JSON.stringify(evidence, null, 2);
    for (const secret of [process.env.TEST_USER, process.env.TEST_PASS, token].filter(Boolean)) json = json.split(secret).join('[REDACTED]');
    fs.writeFileSync(path.join(out, 'baseline.json'), json);
    fs.writeFileSync(path.join(attemptOut, 'baseline.json'), json);
}
async function check(id, name, action, options) {
    await report.check(id, name, action, options);
    console.log(`${report.results.at(-1).status} ${id}: ${name}`);
    flush();
}
async function api(method, route, body) {
    const response = await fetch(base + route, { method,
        headers: { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function fixtureApi(method, route, body, expected) {
    const result = await api(method, route, body);
    if (result.status !== expected) {
        const detail = route.startsWith('/api/bookings') ? String(result.body.error || result.body.code || '').slice(0, 300) : '';
        throw new FixtureBlocked(`Precondition ${method} ${route.split('?')[0]} expected ${expected}, got ${result.status}: ${detail}`);
    }
    return result.body;
}
async function group(name, teacherId = null) {
    return (await fixtureApi('POST', '/api/education/groups?businessContext=dar', { name, teacherId, capacity: 6 }, 201)).group;
}
async function lesson(date, title, groupRecord, time = '12:00') {
    return (await fixtureApi('POST', '/api/bookings?businessContext=dar', {
        date, time, duration: 45, lineId: 'edu-cabinet-1', room: 'Кабінет 1', label: 'Заняття',
        programName: title, category: 'education', customerId: fixtures.parentId, kidsCount: 2, skipNotification: true,
        extraData: { educationLesson: { mode: 'education_lesson', title,
            groupId: groupRecord.id, groupName: groupRecord.name,
            teacherId: String(fixtures.teacherId), teacherName: 'Олена Ковальчук' } }
    }, 200)).booking;
}
async function setup() {
    const auth = await fixtureApi('POST', '/api/auth/login', { username: process.env.TEST_USER, password: process.env.TEST_PASS }, 200);
    token = auth.accessToken || auth.token;
    await fixtureApi('PUT', '/api/business/cabinet?businessContext=dar', {
        businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet'
    }, 200);
    await initializeTimelineResources(pool, 'dar', { types: ['cabinet'] });
    fixtures.teacherId = (await pool.query("INSERT INTO staff(name,department,position,is_active) VALUES ('Олена Ковальчук','education','teacher',true) RETURNING id")).rows[0].id;
    fixtures.parentId = (await pool.query("INSERT INTO customers(business_context,name,source) VALUES ('dar','Наталія Романюк','education_test') RETURNING id")).rows[0].id;
    fixtures.childIds = (await pool.query("INSERT INTO customer_children(business_context,customer_id,name,source_kind) VALUES ('dar',$1,'Марта Романюк','education_test'),('dar',$1,'Данило Романюк','education_test') RETURNING id", [fixtures.parentId])).rows.map(row => Number(row.id));
    fixtures.a = await group('Творча майстерня');
    fixtures.b = await group('Юні винахідники');
    fixtures.teacherGroup = await group('Англійська: Перші слова', fixtures.teacherId);
    for (const childId of fixtures.childIds) await fixtureApi('POST', `/api/education/groups/${fixtures.teacherGroup.id}/members?businessContext=dar`, { childId, startDate: '2026-01-01' }, 201);
    fixtures.duration = await lesson(days.lesson, 'Знайомимося англійською', fixtures.teacherGroup);
    // Historical journal fixture: booking creation intentionally rejects past dates.
    // Move only this runner-owned synthetic row before starting attendance assertions.
    fixtures.journal = await lesson('2027-08-18', 'Лічба та геометричні фігури', fixtures.teacherGroup);
    await pool.query('UPDATE bookings SET date=$1 WHERE id=$2', [days.journal, fixtures.journal.id]);
    fixtures.dateA = await lesson(days.a, 'Осінній колаж', fixtures.teacherGroup);
    fixtures.dateB = await lesson(days.b, 'Будуємо світлофор', fixtures.teacherGroup);
    await fixtureApi('PUT', `/api/education/attendance/${fixtures.journal.id}?businessContext=dar`, { marks: fixtures.childIds.map((childId, index) => ({ childId, status: index ? 'excused' : 'present' })) }, 200);
    const roster = await pool.query('SELECT child_id,status FROM education_attendance WHERE booking_id=$1 ORDER BY child_id', [fixtures.journal.id]);
    assert.deepEqual(roster.rows.map(row => row.status).sort(), ['excused', 'present']);
    const rows = await pool.query('SELECT id,duration FROM bookings WHERE id=ANY($1::text[])', [[fixtures.duration.id, fixtures.journal.id, fixtures.dateA.id, fixtures.dateB.id]]);
    assert.equal(rows.rows.length, 4); assert.ok(rows.rows.every(row => row.duration === 45));
    evidence.fixtures = { teacherId: fixtures.teacherId, groups: [fixtures.a.id, fixtures.b.id, fixtures.teacherGroup.id],
        children: fixtures.childIds, lessons: rows.rows, dates: days, verifiedSqlRoster: roster.rows,
        richDemoDataset: 'NOT RUN: EDU-READY-02' };
}
async function newPage() {
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => evidence.pageErrors.push({ type: error.name, message: error.message.slice(0, 300) }));
    page.on('response', response => {
        const pathname = new URL(response.url()).pathname;
        if (/^\/api\/(education|staff|bookings)/.test(pathname)) evidence.requests.push({ path: pathname, method: response.request().method(), status: response.status() });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill(process.env.TEST_USER);
    await page.locator('#password').fill(process.env.TEST_PASS);
    await page.locator('#loginForm button[type="submit"]').click();
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    return page;
}
async function withPage(action) {
    const page = await newPage();
    try { return await action(page); } finally { await page.context().close(); }
}
async function go(page, view, date = days.lesson) {
    await page.goto(`${base}/?businessContext=dar&educationSchedule=${view}&date=${date}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForFunction(({ view, date }) => window.CrmBusinessContext?.current?.() === 'dar'
        && window.EducationScheduleWorkspace?.state.activeView === view && document.getElementById('timelineDate')?.value === date, { view, date });
}
async function selectGroup(page, id) {
    await page.locator(`#educationGroupsList option[value="${id}"]`).waitFor({ state: 'attached' });
    const response = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/education/groups/${id}`);
    await page.locator('#educationGroupsList').selectOption(String(id));
    assert.equal((await response).status(), 200);
    await page.waitForFunction(id => Number(window.EducationGroups?.state.current?.id) === Number(id), id);
}
async function shot(page, file) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(attemptOut, file), fullPage: false });
    evidence.screenshots.push(`attempt-${attemptId}/${file}`);
}
function barrier() {
    let release, arrived;
    const released = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { arrived = resolve; });
    return { entered, released, release, arrived };
}
async function deadline(promise, name) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Barrier timed out: ${name}`)), 10000); })]); }
    finally { clearTimeout(timer); }
}
async function settledDom(page) {
    // Browser task + paint barriers drain completed response handlers, without a time-based sleep.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function readLesson(id) {
    const value = await fixtureApi('GET', `/api/bookings/detail/${id}?businessContext=dar`, undefined, 200);
    const row = (await pool.query('SELECT duration,program_name,extra_data FROM bookings WHERE id=$1', [id])).rows[0];
    return { api: { duration: value.booking.duration, title: value.booking.extraData.educationLesson.title }, sql: row };
}
async function main() {
    await check('fixtures', 'Independent fixture preflight', async () => {
        try { await setup(); }
        catch (error) { throw error instanceof FixtureBlocked ? error : new FixtureBlocked(`Fixture preflight failed: ${error.message}`); }
    });
    if (report.results[0].status !== 'PASS') {
        for (const id of ['F01', 'F02-source', 'F02-retention', 'F03', 'F04', 'F05', 'F06', 'UI-group', 'UI-enroll', 'UI-lesson', 'UI-reload', 'UI-edit', 'UI-attendance', 'UI-report', 'page-errors'])
            await check(id, id, () => {}, { dependsOn: ['fixtures'] });
        return;
    }
    browser = await chromium.launch({ headless: true });
    await check('F01', 'Pending group B must never save into group A', () => withPage(async page => {
        await go(page, 'groups'); await selectGroup(page, fixtures.a.id);
        const gate = barrier();
        await page.route(`**/api/education/groups/${fixtures.b.id}?*`, async route => {
            const response = await route.fetch(); gate.arrived(response.status());
            await gate.released; await route.fulfill({ response });
        });
        try {
            await page.locator('#educationGroupsList').selectOption(String(fixtures.b.id));
            assert.equal(await deadline(gate.entered, 'B details'), 200);
            const original = { a: fixtures.a.name, b: fixtures.b.name };
            const name = page.locator('#educationGroupName');
            const submit = page.locator('#educationGroupForm button[type="submit"]');
            evidence.proofs.F01 = { selected: await page.locator('#educationGroupsList').inputValue(),
                saveEnabled: await submit.isEnabled(), nameEnabled: await name.isEnabled() };
            if (await submit.isEnabled() && await name.isEnabled()) {
                await name.fill('Назва для вибраної групи');
                const saved = page.waitForResponse(r => r.request().method() === 'PUT' && /^\/api\/education\/groups\/\d+$/.test(new URL(r.url()).pathname));
                await submit.click(); const response = await saved;
                evidence.proofs.F01.write = { path: new URL(response.url()).pathname, status: response.status() };
                // Save can wait for a list/detail reload while B is held; SQL already proves the target.
            }
            const rows = (await pool.query('SELECT id,name FROM education_groups WHERE id=ANY($1::int[]) ORDER BY id', [[fixtures.a.id, fixtures.b.id]])).rows;
            evidence.proofs.F01.sql = rows;
            evidence.proofs.F01.apiA = (await fixtureApi('GET', `/api/education/groups/${fixtures.a.id}?businessContext=dar`, undefined, 200)).group.name;
            evidence.proofs.F01.apiB = (await fixtureApi('GET', `/api/education/groups/${fixtures.b.id}?businessContext=dar`, undefined, 200)).group.name;
            await shot(page, 'F01-group-selection.png');
            assert.equal(rows.find(row => row.id === fixtures.a.id).name, original.a, 'A must remain unchanged while B is selected');
            assert.equal(rows.find(row => row.id === fixtures.b.id).name, original.b, 'Pending details must not silently save stale fields');
            assert.equal(evidence.proofs.F01.apiA, original.a); assert.equal(evidence.proofs.F01.apiB, original.b);
        } finally { gate.release(); }
    }));
    await check('F02-source', 'Authorized education teacher is available through visible UI', () => withPage(async page => {
        const staff = page.waitForResponse(r => {
            const url = new URL(r.url());
            return /^\/api\/(staff|education\/teachers)$/.test(url.pathname)
                && (url.searchParams.get('businessContext') === 'dar' || r.request().headers()['x-business-context'] === 'dar');
        });
        await go(page, 'groups'); const response = await staff; await response.finished(); await settledDom(page);
        evidence.proofs.F02source = { status: response.status(), options: await page.locator('#educationGroupTeacher option').count(),
            teacherSql: (await pool.query('SELECT id,name,is_active FROM staff WHERE id=$1', [fixtures.teacherId])).rows };
        const available = await page.locator(`#educationGroupTeacher option[value="${fixtures.teacherId}"]`).count();
        assert.equal(available, 1, 'Existing active teacher fixture must be selectable; missing loader data is a product failure');
    }));
    await check('F02-retention', 'Group rename preserves assigned teacher after real loader failure', () => withPage(async page => {
        await go(page, 'groups'); await selectGroup(page, fixtures.teacherGroup.id);
        const before = (await pool.query('SELECT teacher_id FROM education_groups WHERE id=$1', [fixtures.teacherGroup.id])).rows[0];
        assert.equal(before.teacher_id, fixtures.teacherId);
        await page.locator('#educationGroupName').fill('Англійська: Перші слова — вечірня');
        const response = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/education/groups/${fixtures.teacherGroup.id}`);
        await page.locator('#educationGroupForm button[type="submit"]').click(); assert.equal((await response).status(), 200);
        const after = (await pool.query('SELECT teacher_id FROM education_groups WHERE id=$1', [fixtures.teacherGroup.id])).rows[0];
        const detail = await fixtureApi('GET', `/api/education/groups/${fixtures.teacherGroup.id}?businessContext=dar`, undefined, 200);
        evidence.proofs.F02retention = { before, after, apiTeacher: detail.group.teacher_id };
        await shot(page, 'F02-teacher-retention.png');
        assert.equal(after.teacher_id, before.teacher_id, 'SQL teacher must survive a name-only edit');
        assert.equal(detail.group.teacher_id, before.teacher_id);
    }));
    await check('F03', 'Journal Refresh displays a separately persisted correction', () => withPage(async page => {
        await go(page, 'attendance', days.journal);
        await page.locator('#educationAttendanceDate').fill(days.journal);
        await page.locator('#educationAttendanceDate').press('Tab');
        await page.locator(`#educationAttendanceLesson option[value="${fixtures.journal.id}"]`).waitFor({ state: 'attached' });
        const opened = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/education/attendance/${fixtures.journal.id}`);
        await page.locator('#educationAttendanceLesson').selectOption(fixtures.journal.id); assert.equal((await opened).status(), 200);
        const mark = page.locator(`[data-attendance-child-id="${fixtures.childIds[0]}"]`);
        await mark.waitFor({ state: 'visible' }); assert.equal(await mark.inputValue(), 'present');
        const corrected = await fixtureApi('PUT', `/api/education/attendance/${fixtures.journal.id}?businessContext=dar`, { marks: [{ childId: fixtures.childIds[0], status: 'absent' }] }, 200);
        const sql = (await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1 AND child_id=$2', [fixtures.journal.id, fixtures.childIds[0]])).rows[0].status;
        assert.equal(sql, 'absent');
        await page.locator('#educationAttendanceReload').click();
        await page.waitForFunction(() => !window.EducationAttendance.state.loading && /занять з групою/.test(document.getElementById('educationAttendanceStatus').textContent));
        await settledDom(page);
        evidence.proofs.F03 = { sql, api: corrected.journal.members.find(member => Number(member.child_id) === fixtures.childIds[0]).status, ui: await mark.inputValue() };
        await shot(page, 'F03-journal-refresh.png');
        assert.equal(await mark.inputValue(), 'absent', 'Refresh must show the durable concurrent correction');
    }));
    await check('F04', 'Direct report/reload renders independent totals from successful API', () => withPage(async page => {
        const expected = { held: 1, cancelled: 0, scheduled: 0, journalsNotStarted: 0, present: 0, absent: 1, excused: 1, unmarked: 0 };
        // F03 performs its correction before asserting UI. Derive the fixture marks from SQL,
        // not from report output, if a preceding fixture operation failed.
        const marks = (await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1', [fixtures.journal.id])).rows;
        expected.present = marks.filter(row => row.status === 'present').length;
        expected.absent = marks.filter(row => row.status === 'absent').length;
        const control = await fixtureApi('GET', `/api/education/reports?businessContext=dar&from=${days.journal}&to=${days.journal}`, undefined, 200);
        assert.deepEqual(control.report.summary, expected);
        const response = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/education/reports');
        await go(page, 'reports', days.journal); const loaded = await response; assert.equal(loaded.status(), 200);
        const received = await loaded.json(); await loaded.finished();
        // Wait for actual context invalidation and successful response handling, not a guessed sleep.
        await page.waitForFunction(() => window.CrmBusinessContext.current() === 'dar' && window.EducationScheduleWorkspace.state.activeView === 'reports');
        await settledDom(page);
        try { await page.locator('.education-report-summary').waitFor({ state: 'visible' }); }
        catch { /* Preserve the missing UI in proof, then assert both direct and reload results. */ }
        evidence.proofs.F04 = { apiStatus: loaded.status(), apiSummary: received.report.summary,
            sqlMarks: marks, uiCounts: await page.locator('.education-report-summary strong').allTextContents(),
            uiStatus: await page.locator('#educationReportStatus').textContent() };
        await shot(page, 'F04-report-direct.png');
        const reloadResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/education/reports');
        await page.reload({ waitUntil: 'domcontentloaded' }); const reloaded = await reloadResponse; await reloaded.finished(); await settledDom(page);
        try { await page.locator('.education-report-summary').waitFor({ state: 'visible' }); }
        catch { /* Missing expected summary is asserted below and remains FAIL. */ }
        evidence.proofs.F04.reload = { status: reloaded.status(), apiSummary: (await reloaded.json()).report.summary,
            uiCounts: await page.locator('.education-report-summary strong').allTextContents() };
        assert.deepEqual(evidence.proofs.F04.uiCounts, Object.values(received.report.summary).map(String), 'Successful direct report response must render all totals');
        assert.deepEqual(evidence.proofs.F04.reload.uiCounts, Object.values(evidence.proofs.F04.reload.apiSummary).map(String), 'Successful reload must render all totals');
        return { independentPeriod: expected, reload: true };
    }));
    await check('F05', 'Visible canonical rename preserves a 45-minute lesson in API and SQL', () => withPage(async page => {
        const before = await readLesson(fixtures.duration.id); assert.equal(before.api.duration, 45); assert.equal(before.sql.duration, 45);
        await go(page, 'today'); const card = page.locator(`[data-education-booking-id="${fixtures.duration.id}"]`);
        await card.waitFor({ state: 'visible' }); await card.click(); await page.locator('#bookingModal').waitFor({ state: 'visible' });
        const detail = await page.locator('#bookingDetails').textContent(); assert.match(detail, /12:00\s*-\s*12:45/);
        await page.locator('#bookingModal .btn-edit-booking').click(); await page.locator('#educationLessonTitle').waitFor({ state: 'visible' });
        evidence.proofs.F05 = { before, durationVisible: await page.locator('#customDuration').isVisible(), durationInput: await page.locator('#customDuration').inputValue() };
        await shot(page, 'F05-duration-edit.png');
        await page.locator('#educationLessonTitle').fill('Знайомимося англійською — знайомство з друзями');
        const response = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/bookings/${fixtures.duration.id}`);
        await page.locator('#bookingSubmitBtn').click(); const saved = await response; assert.equal(saved.status(), 200);
        evidence.proofs.F05.after = await readLesson(fixtures.duration.id);
        evidence.proofs.F05.request = { duration: saved.request().postDataJSON().duration, status: saved.status() };
        assert.equal(evidence.proofs.F05.after.api.title, 'Знайомимося англійською — знайомство з друзями');
        assert.equal(evidence.proofs.F05.after.api.duration, 45, 'Title-only edit must preserve API duration');
        assert.equal(evidence.proofs.F05.after.sql.duration, 45, 'Title-only edit must preserve SQL duration');
    }));
    await check('F06', 'Today A pending -> B completes with B card and no loading', () => withPage(async page => {
        const gate = barrier(); const held = [];
        const deliveries = [];
        await page.route(`**/api/bookings/${days.a}?*`, async route => {
            const done = barrier(); deliveries.push(done.entered);
            const response = await route.fetch(); held.push({ status: response.status() }); gate.arrived();
            await gate.released;
            try { await route.fulfill({ response }); } finally { done.arrived(); }
        });
        try {
            await go(page, 'today', days.a); await deadline(gate.entered, 'Today A');
            await page.waitForFunction(() => window.EducationScheduleWorkspace.state.loading);
            const loadedB = page.waitForResponse(r => new URL(r.url()).pathname === `/api/bookings/${days.b}`);
            await page.locator('#nextDay').click(); const response = await loadedB; assert.equal(response.status(), 200); await response.finished();
            await page.waitForFunction(date => document.getElementById('timelineDate').value === date, days.b);
            await settledDom(page); gate.release();
            await Promise.all(deliveries);
            await settledDom(page);
            try {
                await page.waitForFunction(({ date, id }) => window.EducationScheduleWorkspace.state.date === date
                    && !window.EducationScheduleWorkspace.state.loading
                    && document.querySelector(`[data-education-booking-id="${id}"]`), { date: days.b, id: fixtures.dateB.id }, { timeout: 10000 });
            } catch { /* Capture final state and independently assert date/loading/card below. */ }
            const final = await page.evaluate(() => ({ date: window.EducationScheduleWorkspace.state.date,
                loading: window.EducationScheduleWorkspace.state.loading,
                cards: [...document.querySelectorAll('[data-education-booking-id]')].map(el => el.dataset.educationBookingId),
                status: document.getElementById('educationTodayStatus').textContent }));
            const sql = (await pool.query('SELECT id,date::text FROM bookings WHERE id=$1', [fixtures.dateB.id])).rows[0];
            const body = await response.json(); assert.ok(body.some(row => row.id === fixtures.dateB.id));
            evidence.proofs.F06 = { held, final, sql, apiBContainsLesson: true };
            await shot(page, 'F06-today-date-race.png');
            assert.equal(final.date, days.b); assert.equal(final.loading, false, 'Latest selected date must finish loading');
            assert.ok(final.cards.includes(fixtures.dateB.id), 'Today must show B verified in API and SQL');
        } finally { gate.release(); }
    }));
    // One contiguous UI flow. A missing UI teacher stops it; no API fallback repairs the flow.
    const flowPage = await newPage();
    try {
        await check('UI-group', 'Lifecycle: create group with teacher through form', async () => {
            await go(flowPage, 'groups');
            await flowPage.locator('#educationGroupName').fill('Майстерня відкриттів');
            await flowPage.locator('#educationGroupCapacity').fill('4');
            assert.equal(await flowPage.locator(`#educationGroupTeacher option[value="${fixtures.teacherId}"]`).count(), 1, 'Lifecycle cannot proceed without the visible teacher option');
            await flowPage.locator('#educationGroupTeacher').selectOption(String(fixtures.teacherId));
            const saved = flowPage.waitForResponse(r => r.request().method() === 'POST' && /^\/api\/education\/groups\/?$/.test(new URL(r.url()).pathname));
            await flowPage.locator('#educationGroupForm button[type="submit"]').click(); assert.equal((await saved).status(), 201);
            const rows = (await pool.query("SELECT id,teacher_id FROM education_groups WHERE business_context='dar' AND name='Майстерня відкриттів'")).rows;
            assert.equal(rows.length, 1); assert.equal(rows[0].teacher_id, fixtures.teacherId); fixtures.flowGroupId = rows[0].id;
        });
        await check('UI-enroll', 'Lifecycle: search and enroll child through form', async () => {
            await selectGroup(flowPage, fixtures.flowGroupId);
            await flowPage.locator('#educationChildSearch').fill('Марта'); await flowPage.locator('#educationChildFind').click();
            await flowPage.locator(`#educationChildSelect option[value="${fixtures.childIds[0]}"]`).waitFor({ state: 'attached' });
            await flowPage.locator('#educationChildSelect').selectOption(String(fixtures.childIds[0]));
            await flowPage.locator('#educationMemberStart').fill('2026-01-01');
            const saved = flowPage.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/education/groups/${fixtures.flowGroupId}/members`);
            await flowPage.locator('#educationGroupEnrollForm button[type="submit"]').click(); assert.equal((await saved).status(), 201);
            const rows = await pool.query('SELECT child_id FROM education_group_members WHERE group_id=$1', [fixtures.flowGroupId]);
            assert.deepEqual(rows.rows.map(row => Number(row.child_id)), [fixtures.childIds[0]]);
        }, { dependsOn: ['UI-group'] });
        await check('UI-lesson', 'Lifecycle: create chosen 45-minute lesson through form', async () => {
            await flowPage.locator('[data-education-schedule-tab="schedule"]').click();
            await flowPage.locator('#timelineViewPanelToggle').click(); await flowPage.locator('[data-schedule-view-mode="day"]').click();
            await flowPage.locator('.grid-cell[data-time="15:00"][data-line="edu-cabinet-1"]').first().click();
            await flowPage.locator('#bookingPanel').waitFor({ state: 'visible' });
            await flowPage.locator('#customerSearch').fill('Наталія Романюк');
            await flowPage.locator(`.customer-search-item[data-id="${fixtures.parentId}"]`).click();
            await flowPage.locator('#educationLessonTitle').fill('Відкриваємо світ кольорів');
            await flowPage.locator('#educationLessonGroupId').selectOption(String(fixtures.flowGroupId));
            assert.equal(await flowPage.locator('#customDuration').isVisible(), true, 'Chosen duration requires a visible control');
            await flowPage.locator('#customDuration').fill('45');
            await flowPage.locator('#educationLessonTeacher').selectOption(String(fixtures.teacherId));
            const saved = flowPage.waitForResponse(r => r.request().method() === 'POST' && /^\/api\/bookings(?:\/full)?$/.test(new URL(r.url()).pathname));
            await flowPage.locator('#bookingSubmitBtn').click(); assert.equal((await saved).status(), 200);
            const rows = (await pool.query("SELECT id,duration FROM bookings WHERE program_name='Відкриваємо світ кольорів' AND business_context='dar'")).rows;
            assert.equal(rows.length, 1); assert.equal(rows[0].duration, 45); fixtures.flowLessonId = rows[0].id;
            assert.equal((await readLesson(fixtures.flowLessonId)).api.duration, 45);
        }, { dependsOn: ['UI-enroll'] });
        await check('UI-reload', 'Lifecycle: reload and canonical card preserve created lesson', async () => {
            await flowPage.reload({ waitUntil: 'domcontentloaded' });
            await flowPage.locator('[data-education-schedule-tab="today"]').click();
            const card = flowPage.locator(`[data-education-booking-id="${fixtures.flowLessonId}"]`); await card.waitFor({ state: 'visible' }); await card.click();
            await flowPage.locator('#bookingModal').waitFor({ state: 'visible' });
            assert.match(await flowPage.locator('#bookingDetails').textContent(), /Відкриваємо світ кольорів/);
            assert.equal((await readLesson(fixtures.flowLessonId)).sql.duration, 45);
        }, { dependsOn: ['UI-lesson'] });
        await check('UI-edit', 'Lifecycle: visible rename preserves duration and teacher', async () => {
            const before = await readLesson(fixtures.flowLessonId);
            await flowPage.locator('#bookingModal .btn-edit-booking').click();
            await flowPage.locator('#educationLessonTitle').fill('Відкриваємо світ кольорів — акварель');
            const response = flowPage.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/bookings/${fixtures.flowLessonId}`);
            await flowPage.locator('#bookingSubmitBtn').click(); assert.equal((await response).status(), 200);
            const after = await readLesson(fixtures.flowLessonId);
            assert.equal(after.api.title, 'Відкриваємо світ кольорів — акварель');
            assert.equal(after.api.duration, before.api.duration); assert.equal(after.sql.duration, before.sql.duration);
            assert.equal(after.sql.extra_data.educationLesson.teacherId, before.sql.extra_data.educationLesson.teacherId);
        }, { dependsOn: ['UI-reload'] });
        await check('UI-attendance', 'Lifecycle: canonical journal link and UI mark persist', async () => {
            await flowPage.locator('[data-education-schedule-tab="today"]').click();
            await flowPage.locator(`[data-education-booking-id="${fixtures.flowLessonId}"]`).click();
            await flowPage.locator('#bookingModal').waitFor({ state: 'visible' });
            await flowPage.locator(`[data-education-attendance-booking="${fixtures.flowLessonId}"]`).click();
            const mark = flowPage.locator(`[data-attendance-child-id="${fixtures.childIds[0]}"]`);
            await mark.waitFor({ state: 'visible' }); await mark.selectOption('present');
            const response = flowPage.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/education/attendance/${fixtures.flowLessonId}`);
            await flowPage.locator('#educationAttendanceSave').click(); assert.equal((await response).status(), 200);
            const persisted = await fixtureApi('GET', `/api/education/attendance/${fixtures.flowLessonId}?businessContext=dar`, undefined, 200);
            assert.equal(persisted.journal.members.find(member => Number(member.child_id) === fixtures.childIds[0]).status, 'present');
            assert.equal((await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1 AND child_id=$2', [fixtures.flowLessonId, fixtures.childIds[0]])).rows[0].status, 'present');
        }, { dependsOn: ['UI-edit'] });
        await check('UI-report', 'Lifecycle: future lesson report has independent expected totals', async () => {
            await flowPage.locator('[data-education-schedule-tab="reports"]').click();
            await flowPage.locator('#educationReportFrom').fill(days.lesson); await flowPage.locator('#educationReportFrom').press('Tab');
            await flowPage.locator('#educationReportTo').fill(days.lesson); await flowPage.locator('#educationReportTo').press('Tab');
            await flowPage.locator('#educationReportGroup').selectOption(String(fixtures.flowGroupId));
            const response = flowPage.waitForResponse(r => new URL(r.url()).pathname === '/api/education/reports'
                && new URL(r.url()).searchParams.get('groupId') === String(fixtures.flowGroupId));
            await flowPage.locator('#educationReportRun').click(); const received = await response; assert.equal(received.status(), 200);
            const expected = { held: 0, cancelled: 0, scheduled: 1, journalsNotStarted: 0, present: 0, absent: 0, excused: 0, unmarked: 0 };
            assert.deepEqual((await received.json()).report.summary, expected);
            await flowPage.waitForFunction(() => document.querySelectorAll('.education-report-summary strong').length === 8);
            assert.deepEqual(await flowPage.locator('.education-report-summary strong').allTextContents(), Object.values(expected).map(String));
        }, { dependsOn: ['UI-attendance'] });
    } finally { await flowPage.context().close(); }
    await check('page-errors', 'No unhandled browser exceptions', () => assert.deepEqual(evidence.pageErrors, []));
}
main().catch(error => {
    evidence.fatal = { status: error instanceof FixtureBlocked ? 'BLOCKED_FIXTURE' : 'FAIL', message: error.message };
    process.exitCode = 1;
}).finally(async () => {
    await browser?.close(); await pool.end(); flush();
    if (evidence.fatal || report.exitCode()) process.exitCode = 1;
});
