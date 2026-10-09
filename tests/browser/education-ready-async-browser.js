'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const viewport = process.env.EDU_READY_PHONE === 'true' ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const { DATABASES, assertLocalTarget, seedDataset, buildPlan, expectedReport } = require('../../scripts/lib/education-ready-dataset');
const { createResults, FixtureBlocked } = require('../helpers/education-ready-results');
assertLocalTarget('fixed');
assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
const base = process.env.TEST_URL; assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const out = path.resolve(process.env.EDU_READY_OUTPUT || 'output/education-ready/05', `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const results = createResults();
const evidence = { attemptId: process.env.EDU_CLOSE_ATTEMPT_ID, suite: process.env.EDU_CLOSE_SUITE, phase: process.env.EDU_ASYNC_PHASE || 'postfix', viewport, coverage: 'FULL', checks: results.results, proofs: {}, screenshots: [], pageErrors: [],
    reportClock: process.env.EDU_READY_REPORT_NOW, boundary: 'Actual UI/Express/disposable PG; no API repair; held real responses' };
const pool = new Pool({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 55469), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD, database: process.env.PGDATABASE || DATABASES.fixed, ssl: false });
let browser, token, manifest, plan, second;
function flush() {
    let data = JSON.stringify(evidence, null, 2);
    for (const secret of [token, process.env.TEST_USER, process.env.TEST_PASS, second?.password].filter(Boolean)) data = data.split(secret).join('[REDACTED]');
    fs.writeFileSync(path.join(out, 'verification.json'), data);
}
async function check(id, action) {
    await results.check(id, id, action, id === 'fixtures' ? {} : { dependsOn: ['fixtures'] }); flush(); console.log(`${results.results.at(-1).status} ${id}`);
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function bounded(promise, label) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} not observed`)), 15000); })]); }
    finally { clearTimeout(timer); }
}
async function api(method, route, body, status = 200, auth = token) {
    const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${auth || ''}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal:AbortSignal.timeout(20000) });
    const data = await response.json(); assert.equal(response.status, status, `${method} ${route.split('?')[0]}: ${data.error || ''}`); return data;
}
async function pageFor(action, credentials) {
    const pages = [];
    async function create(credentials = { username: process.env.TEST_USER, password: process.env.TEST_PASS }) {
        const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport, hasTouch: process.env.EDU_READY_PHONE === 'true', isMobile: process.env.EDU_READY_PHONE === 'true' });
        await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        const page = await context.newPage(); page.setDefaultTimeout(12000); pages.push(page);
        page.on('pageerror', error => evidence.pageErrors.push(error.message));
        await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('#username').fill(credentials.username); await page.locator('#password').fill(credentials.password);
        await page.locator('#loginForm button[type="submit"]').click(); await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 }); return page;
    }
    try { await action(await create(credentials), create); }
    catch (error) {
        const page = pages[0];
        if (page) {
            evidence.lastFailure = await page.evaluate(() => ({ date: document.getElementById('timelineDate')?.value, today: window.EducationScheduleWorkspace?.state,
                attendance: document.getElementById('educationAttendanceStatus')?.textContent, report: document.getElementById('educationReportStatus')?.textContent })).catch(diagnosticError=>({originalError:error.message,diagnosticError:diagnosticError.message,url:page.url()}));
            await shot(page, `failure-${evidence.checks.length}`).catch(diagnosticError=>{evidence.failureScreenshotError=diagnosticError.message;});
        }
        throw error;
    } finally { for (const page of pages) await page.context().close(); }
}
async function shot(page, name) {
    const replacements = await page.evaluate(secret => {
        const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), changed=[];let node;
        while((node=walker.nextNode()))if(secret&&node.nodeValue.includes(secret)){changed.push({node,value:node.nodeValue});node.nodeValue=node.nodeValue.split(secret).join('[REDACTED]');}
        window.__educationScreenshotRedactions=changed;return changed.length;
    },process.env.TEST_USER);
    try { await page.screenshot({ path: path.join(out, `${name}.png`) }); evidence.screenshots.push(`${name}.png`); }
    finally { if(replacements)await page.evaluate(()=>{for(const item of window.__educationScreenshotRedactions||[])if(item.node.isConnected)item.node.nodeValue=item.value;delete window.__educationScreenshotRedactions;}); }
}
async function go(page, view, date = manifest.anchorDate, business = 'dar') {
    await page.goto(`${base}/?businessContext=${business}&educationSchedule=${view}&date=${date}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForFunction(({ business, view }) => window.CrmBusinessContext?.current?.() === business
        && window.TimelineBusinessContext?.presentation?.().mode === 'education' && window.EducationScheduleWorkspace?.state.activeView === view, { business, view });
}
async function openJournal(page, id, date = '2026-10-02') {
    await go(page, 'attendance', date);
    await page.locator('#educationAttendanceDate').fill(date); await page.locator('#educationAttendanceDate').press('Tab');
    await page.locator(`#educationAttendanceLesson option[value="${id}"]`).waitFor({ state: 'attached' });
    await page.locator('#educationAttendanceLesson').selectOption(id);
    await page.locator('[data-attendance-child-id]').first().waitFor({ state: 'visible' });
    await page.waitForFunction(id => String(window.EducationAttendance.state.journal?.booking.id) === id, id);
}
async function saveJournal(page, id) {
    const saved = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/education/attendance/${id}`);
    await page.locator('#educationAttendanceSave').click(); const response = await saved; assert.equal(response.status(), 200); await response.finished();
    await page.waitForFunction(() => !document.getElementById('educationAttendanceSave').disabled); return response.json();
}
async function journalReady(page) {
    await page.waitForFunction(() => window.EducationAttendance?.state.journal && !window.EducationAttendance.state.journalLoading && !window.EducationAttendance.state.loading && !window.EducationAttendance.state.saving);
}
async function reportReady(page) {
    await page.waitForFunction(() => window.EducationAttendance?.state && !window.EducationAttendance.state.reportLoading && document.querySelector('.education-report-summary'));
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    await page.locator('.education-report-summary').waitFor({ state: 'visible' });
}
async function switchBusiness(page, business) {
    const view=await page.evaluate(()=>window.EducationScheduleWorkspace.state.activeView);
    const date=await page.locator('#educationAttendanceDate').inputValue();
    await page.locator('#sidebarBusinessContextSelect').selectOption(business);
    await page.waitForFunction(business => window.CrmBusinessContext?.current?.() === business && window.TimelineBusinessContext?.current?.().apiValue===business && window.EducationAttendance?.state.business===business
        && document.getElementById('sidebarBusinessContextSelect')?.disabled===false && window.TimelineBusinessContext?.presentation?.().mode==='education', business);
    await page.locator('#mainApp').waitFor({state:'visible'});
    const tab=page.locator(`[data-education-schedule-tab="${view}"]`);
    if(await tab.getAttribute('aria-pressed')!=='true')await tab.click();
    if(view==='attendance'){
        await page.locator('#educationAttendanceDate').fill(date);await page.locator('#educationAttendanceDate').press('Tab');
        await page.waitForFunction(()=>!window.EducationAttendance.state.loading);
    }
}
async function holdOne(page, pattern, error = false) {
    const arrived = deferred(), release = deferred(), delivered = deferred(); let held = false;
    await page.route(pattern, async route => {
        if (held) return route.continue(); held = true;
        const response = await route.fetch(); arrived.resolve(); await release.promise;
        try { await route.fulfill(error ? { status:503, contentType:'application/json', body:JSON.stringify({error:'Controlled unavailable response'}) } : { response }); }
        finally { delivered.resolve(); }
    });
    return { arrived: () => bounded(arrived.promise,'Held real response'), release: async () => { release.resolve(); await bounded(delivered.promise,'Released response'); }, unblock: () => release.resolve() };
}
async function independentReport(from, to, groupKey = null) {
    const spec = expectedReport(plan, 'dar', from, to, groupKey, '2026-10-03', 720);
    const rows = (await pool.query(`SELECT b.id,b.date::text,b.time,b.duration,b.status,b.extra_data->'educationLesson'->>'groupId' group_id,
        a.status mark_status,a.id attendance_id FROM bookings b LEFT JOIN education_attendance a ON a.booking_id=b.id AND a.business_context=b.business_context
        WHERE b.business_context='dar' AND b.date BETWEEN $1 AND $2 AND b.extra_data->'educationLesson'->>'groupId' IS NOT NULL
        AND ($3::text IS NULL OR b.extra_data->'educationLesson'->>'groupId'=$3)`, [from,to,groupKey ? String(manifest.ids.groups[groupKey]) : null])).rows;
    const expected = { held: 0, cancelled: 0, scheduled: 0, journalsNotStarted: 0, present: 0, absent: 0, excused: 0, unmarked: 0 };
    const seen = new Set();
    for (const row of rows) {
        const [h,m] = row.time.split(':').map(Number);
        const phase = row.status === 'cancelled' ? 'cancelled' : row.date < '2026-10-03' || row.date === '2026-10-03' && h*60+m+row.duration <= 720 ? 'held' : 'scheduled';
        if (!seen.has(row.id)) { seen.add(row.id); expected[phase]++; if (phase === 'held' && !row.attendance_id) expected.journalsNotStarted++; }
        if (phase === 'held' && row.attendance_id) expected[row.mark_status || 'unmarked']++;
    }
    assert.deepEqual(expected, spec.summary, 'Fixture specification and independent raw SQL must agree'); return expected;
}
async function main() {
    await check('fixtures', async () => {
        const auth = await api('POST', '/api/auth/login', { username: process.env.TEST_USER, password: process.env.TEST_PASS }, 200, ''); token = auth.accessToken || auth.token;
        manifest = (await seedDataset(pool, 'fixed')).manifest; plan = buildPlan('fixed');
        for (const business of ['dar','maysternya_doli']) await api('PUT', `/api/business/cabinet?businessContext=${business}`, { businessType:'education', timelineMode:'education', resourceModel:'cabinet' });
        second = { username: 'edu_ready_operator_two', password: crypto.randomBytes(24).toString('base64url') };
        await api('POST', '/api/users', { ...second, name:'Операторка Марія', role:'creator', businessContexts:['dar'], defaultBusinessContext:'dar' });
        evidence.anchorDate = manifest.anchorDate;
        assert.equal((await pool.query('SELECT count(*)::int n FROM bookings WHERE business_context=$1',['dar'])).rows[0].n,36);
        const member = (await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[manifest.ids.bookings['english-3'],manifest.ids.children['child-1']])).rows[0];
        if (!member || member.status !== 'present') throw new FixtureBlocked('Required frozen journal child1/present is missing');
    });
    if (!manifest) return;
    browser = await chromium.launch({ headless: true });
    await check('F03-two-operators-refresh', () => pageFor(async (page, create) => {
        const id = manifest.ids.bookings['english-3']; const child = manifest.ids.children['child-1'];
        await openJournal(page,id); const field = page.locator(`[data-attendance-child-id="${child}"]`); assert.equal(await field.inputValue(),'present');
        const operator = await create(second); await openJournal(operator,id); await operator.locator(`[data-attendance-child-id="${child}"]`).selectOption('absent');
        const corrected = await saveJournal(operator,id);
        const durable = (await pool.query('SELECT status,marked_by,marked_at FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[id,child])).rows[0];
        assert.equal(durable.status,'absent'); assert.equal(durable.marked_by,second.username); assert.ok(durable.marked_at);
        plan.lessons.find(lesson=>lesson.key==='english-3').marks.find(mark=>mark.childKey==='child-1').status='absent';
        await page.locator('#educationAttendanceReload').click();
        await page.waitForFunction(()=>!window.EducationAttendance.state.loading);
        try { await page.waitForFunction(child=>document.querySelector(`[data-attendance-child-id="${child}"]`)?.value==='absent',child); } catch {}
        const history = (await pool.query('SELECT h.previous_status,h.new_status,h.changed_by,h.changed_at FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 AND a.child_id=$2 ORDER BY h.id',[id,child])).rows;
        evidence.proofs.F03={durable, api:corrected.journal.members.find(member=>Number(member.child_id)===Number(child)), ui:await field.inputValue(), history}; flush();
        await shot(page,'F03-journal-refresh'); assert.equal(await field.inputValue(),'absent');
        const rendered=await page.locator('#educationAttendanceJournal').innerText(); assert.ok(rendered.includes(second.username));
        assert.equal(history.at(-1).previous_status,'present'); assert.equal(history.at(-1).new_status,'absent');
    }));
    await check('F04-direct-report-reload', () => pageFor(async page => {
        const received=[]; page.on('response',async response=>{if(new URL(response.url()).pathname==='/api/education/reports'&&response.status()===200) received.push(await response.json());});
        const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/education/reports'); await go(page,'reports'); await (await response).finished();
        try { await page.locator('.education-report-summary').waitFor({state:'visible'}); } catch {}
        const from=await page.locator('#educationReportFrom').inputValue(),to=await page.locator('#educationReportTo').inputValue();
        const expected=await independentReport(from,to); const control=await api('GET',`/api/education/reports?businessContext=dar&from=${from}&to=${to}`); assert.deepEqual(control.report.summary,expected);
        const direct=await page.locator('.education-report-summary strong').allTextContents(); await shot(page,'F04-report-direct');
        const reloaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/education/reports'); await page.reload({waitUntil:'domcontentloaded'}); await(await reloaded).finished();
        try { await page.locator('.education-report-summary').waitFor({state:'visible'}); } catch {}
        const reload=await page.locator('.education-report-summary strong').allTextContents();
        evidence.proofs.F04={from,to,expected,api:control.report.summary,direct,reload,successfulResponses:received.length}; flush();
        assert.deepEqual(direct,Object.values(expected).map(String)); assert.deepEqual(reload,Object.values(expected).map(String));
    }));
    await check('minimap-native-stale-read-visible-date-navigation', () => pageFor(async page => {
        await go(page, 'schedule', '2026-10-01');
        await page.waitForFunction(() => document.getElementById('minimapContainer')?.dataset.date === '2026-10-01');
        // Force a real minimap read past the cache so its native request token
        // crosses the visible date change. No fabricated response or write repair.
        await page.evaluate(() => {
            const nativeRead = window.getLinesForDate;
            window.__minimapNativeFailures = [];
            window.getLinesForDate = function(date, options = {}) {
                const minimap = new Error().stack.includes('renderMinimapAsync');
                return nativeRead(date, minimap ? { ...options, force: true } : options).catch(error => {
                    if (minimap) window.__minimapNativeFailures.push({ code: error.code, name: error.name });
                    throw error;
                });
            };
        });
        const entered = deferred(), release = deferred(), delivered = deferred(), routeErrors = [];
        const pattern = url => url.pathname === '/api/lines/2026-10-02' && url.searchParams.has('_fresh');
        await page.route(pattern, async route => {
            try {
                const response = await route.fetch();
                assert.equal(response.status(), 200, 'Held real lines read');
                entered.resolve(); await release.promise; await route.fulfill({ response });
            } catch (error) { routeErrors.push(error.message); entered.resolve(); }
            finally { delivered.resolve(); }
        });
        try {
            await page.locator('#nextDay').click(); await bounded(entered.promise, 'Minimap A real lines response');
            assert.deepEqual(routeErrors, []);
            const newest = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bookings/2026-10-03');
            await page.locator('#nextDay').click(); const response = await newest; assert.equal(response.status(), 200); await response.finished();
            release.resolve(); await bounded(delivered.promise, 'Stale lines delivered');
            await page.waitForFunction(() => window.__minimapNativeFailures.some(error => error.code === 'timeline_stale_request')
                && document.getElementById('minimapContainer')?.dataset.date === '2026-10-03'
                && document.getElementById('minimapContainer')?.dataset.state === 'ready');
            const state = await page.evaluate(() => ({ date: document.getElementById('timelineDate').value,
                minimap: { ...document.getElementById('minimapContainer').dataset }, failures: window.__minimapNativeFailures,
                ids: [...new Set([...document.querySelectorAll('.booking-block[data-booking-id]')].map(el => el.dataset.bookingId))].sort() }));
            const sql = (await pool.query("SELECT id FROM bookings WHERE business_context='dar' AND date='2026-10-03' AND status <> 'cancelled' ORDER BY id")).rows.map(row => row.id).sort();
            assert.equal(state.date, '2026-10-03'); assert.equal(state.minimap.business, 'dar'); assert.deepEqual(state.ids, sql); assert.deepEqual(routeErrors, []);
            evidence.proofs.minimap = { ...state, sql, barrier: 'Real HTTP200 lines response released after visible nextDay; native stale token observed', classification: 'VISIBLE_UI_READ_NAVIGATION_API_SQL_WITH_CACHE_BYPASS_BARRIER' };
            await shot(page, 'minimap-native-stale-navigation');
        } finally { release.resolve(); await bounded(delivered.promise, 'Minimap route cleanup'); await page.unroute(pattern); }
    }));
    await check('F06-today-date-race', () => pageFor(async page => {
        const arrived=deferred(),release=deferred(),deliveries=[];
        await page.route('**/api/bookings/2026-10-02?*',async route=>{
            const done=deferred();deliveries.push(done.promise); const response=await route.fetch();arrived.resolve();await release.promise;
            try {await route.fulfill({response});}finally{done.resolve();}
        });
        try {
            await go(page,'today','2026-10-02');await bounded(arrived.promise,'Date A real response');
            await page.waitForFunction(()=>window.EducationScheduleWorkspace.state.loading);
            const b=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/bookings/2026-10-03');await page.locator('#nextDay').click();const response=await b;assert.equal(response.status(),200);await response.finished();
            await page.waitForFunction(()=>document.getElementById('timelineDate').value==='2026-10-03');release.resolve();await Promise.all(deliveries);
            try {await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading&&document.querySelectorAll('[data-education-booking-id]').length===4);}catch{}
            const final=await page.evaluate(()=>({date:window.EducationScheduleWorkspace.state.date,loading:window.EducationScheduleWorkspace.state.loading,cards:[...document.querySelectorAll('[data-education-booking-id]')].map(el=>el.dataset.educationBookingId)}));
            const sql=(await pool.query("SELECT id FROM bookings WHERE business_context='dar' AND date='2026-10-03' ORDER BY id")).rows.map(row=>row.id);
            evidence.proofs.F06={final,sql,api:(await response.json()).map(row=>row.id)};flush();await shot(page,'F06-today-date-race');
            assert.equal(final.date,'2026-10-03');assert.equal(final.loading,false);assert.deepEqual(final.cards.sort(),sql.sort());
        }finally{release.resolve();}
    }));
    if (evidence.phase !== 'baseline') {
    await check('journal-drafts-navigation-refresh', () => pageFor(async page => {
        const id=manifest.ids.bookings['english-3'], child=manifest.ids.children['child-1'];
        await openJournal(page,id); await journalReady(page);
        const field=page.locator(`[data-attendance-child-id="${child}"]`); assert.equal(await field.inputValue(),'absent');
        await field.selectOption('excused');
        await page.locator('#educationAttendanceReload').click();
        await page.locator('.confirm-overlay .confirm-cancel').click(); await page.locator('.confirm-overlay').waitFor({state:'hidden'});
        assert.equal(await field.inputValue(),'excused');
        assert.equal((await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[id,child])).rows[0].status,'absent');
        await page.locator('[data-education-schedule-tab="reports"]').click(); await reportReady(page);
        await page.locator('[data-education-schedule-tab="attendance"]').click(); await journalReady(page); assert.equal(await field.inputValue(),'excused');
        await page.reload({waitUntil:'domcontentloaded'}); await journalReady(page); assert.equal(await field.inputValue(),'excused');
        assert.match(await page.locator('#educationAttendanceStatus').innerText(),/незбережені/);
        await switchBusiness(page,'maysternya_doli'); await page.waitForFunction(()=>!window.EducationAttendance.state.loading);
        assert.equal(await page.locator(`[data-attendance-child-id="${child}"]`).count(),0);
        await switchBusiness(page,'dar'); await page.waitForFunction(()=>!window.EducationAttendance.state.loading);
        await page.locator('#educationAttendanceLesson').selectOption(id); await journalReady(page); assert.equal(await field.inputValue(),'excused');
        await page.locator('#educationAttendanceDate').fill('2026-10-01'); await page.locator('#educationAttendanceDate').press('Tab'); await page.waitForFunction(()=>!window.EducationAttendance.state.loading);
        await page.locator('#educationAttendanceDate').fill('2026-10-02'); await page.locator('#educationAttendanceDate').press('Tab');
        await page.locator(`#educationAttendanceLesson option[value="${id}"]`).waitFor({state:'attached'}); await page.locator('#educationAttendanceLesson').selectOption(id); await journalReady(page);
        assert.equal(await field.inputValue(),'excused');
        const read=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/education/attendance/${id}`);
        await page.locator('#educationAttendanceReload').click(); await page.locator('.confirm-overlay .confirm-ok').click(); await(await read).finished(); await journalReady(page);
        assert.equal(await field.inputValue(),'absent');
        evidence.proofs.draft={cancelKept:true,reloadRestored:true,dateRestored:true,businessIsolated:true,discardReloaded:true}; await shot(page,'journal-draft-discard');
    }));
    await check('journal-status-clear-repeat-save-retry', () => pageFor(async page => {
        const id=manifest.ids.bookings['english-3'],child=manifest.ids.children['child-1']; await openJournal(page,id); await journalReady(page);
        const field=page.locator(`[data-attendance-child-id="${child}"]`), changes=[];
        for(const value of ['present','absent','excused','']) {
            await field.selectOption(value); const saved=await saveJournal(page,id); await journalReady(page);
            const row=(await pool.query('SELECT id,status,marked_by,marked_at FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[id,child])).rows[0];
            assert.equal(row.status,value||null);assert.ok(row.marked_by);
            if(value)assert.ok(row.marked_at);else assert.equal(row.marked_at,null);
            const history=(await pool.query('SELECT h.new_status,h.changed_by,h.changed_at FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 AND a.child_id=$2 ORDER BY h.id DESC LIMIT 1',[id,child])).rows[0];
            assert.equal(history.new_status,value||null);assert.ok(history.changed_by&&history.changed_at);changes.push(saved.changes);
            plan.lessons.find(lesson=>lesson.key==='english-3').marks.find(mark=>mark.childKey==='child-1').status=value||null;
        }
        const n=Number((await pool.query('SELECT count(*) n FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1',[id])).rows[0].n);
        const repeat=await saveJournal(page,id);assert.equal(repeat.changes,0);
        assert.equal(Number((await pool.query('SELECT count(*) n FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1',[id])).rows[0].n),n);
        await field.selectOption('absent');
        let failed=false; await page.route(`**/api/education/attendance/${id}`,route=>{
            if(route.request().method()==='PUT'&&!failed){failed=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Controlled save failure'})});}return route.continue();
        });
        const rejected=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname.endsWith(id)); await page.locator('#educationAttendanceSave').click();assert.equal((await rejected).status(),503);
        await page.waitForFunction(()=>!window.EducationAttendance.state.saving);assert.equal(await field.inputValue(),'absent');assert.match(await page.locator('#educationAttendanceStatus').innerText(),/Не вдалося зберегти/);
        assert.equal((await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[id,child])).rows[0].status,null);
        const held=await holdOne(page,`**/api/education/attendance/${id}`);let puts=0;page.on('request',r=>{if(r.method()==='PUT'&&new URL(r.url()).pathname.endsWith(id))puts++;});
        try {
            await page.locator('#educationAttendanceSave').click();await held.arrived();
            assert.equal(await page.locator('#educationAttendanceSave').isDisabled(),true);assert.equal(await field.isDisabled(),true);
            await held.release();await journalReady(page);assert.equal(puts,1);assert.equal(await field.inputValue(),'absent');
            assert.equal((await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[id,child])).rows[0].status,'absent');
            plan.lessons.find(lesson=>lesson.key==='english-3').marks.find(mark=>mark.childKey==='child-1').status='absent';
        }finally{held.unblock();}
        evidence.proofs.statuses={values:['present','absent','excused',null],changes,repeatChanges:0,historyCount:n,retryPuts:puts};
    },second));
    await check('reports-independent-periods-groups-navigation', () => pageFor(async page => {
        await go(page,'reports');await reportReady(page);
        const cases=[['2026-07-01','2026-11-30',null],['2026-10-03','2026-10-03',null],['2026-09-01','2026-10-02','english'],['2026-09-01','2026-11-30','robots'],['2026-09-01','2026-11-30','empty'],['2026-08-01','2026-10-03','archive'],['2026-01-01','2026-01-02',null]];
        const checked=[];
        for(const [from,to,group] of cases){
            await page.locator('#educationReportFrom').fill(from);await page.locator('#educationReportFrom').press('Tab');
            await page.locator('#educationReportTo').fill(to);await page.locator('#educationReportTo').press('Tab');
            await page.locator('#educationReportGroup').selectOption(group?String(manifest.ids.groups[group]):'');
            const reply=page.waitForResponse(r=>{ const url=new URL(r.url()); return url.pathname==='/api/education/reports'
                && url.searchParams.get('businessContext')==='dar' && url.searchParams.get('from')===from && url.searchParams.get('to')===to
                && (url.searchParams.get('groupId')||'')===(group?String(manifest.ids.groups[group]):''); });await page.locator('#educationReportRun').click();const response=await reply;await response.finished();await reportReady(page);
            const expected=await independentReport(from,to,group), actual=(await response.json()).report.summary;
            assert.equal(response.status(),200);
            await page.waitForFunction(values=>!window.EducationAttendance.state.reportLoading && [...document.querySelectorAll('.education-report-summary strong')].map(el=>el.textContent).join('|')===values.join('|'),Object.values(expected).map(String));
            assert.deepEqual(actual,expected);assert.deepEqual(await page.locator('.education-report-summary strong').allTextContents(),Object.values(expected).map(String));checked.push({from,to,group,expected});
            if(group==='english'){
                await page.reload({waitUntil:'domcontentloaded'});await reportReady(page);
                assert.equal(await page.locator('#educationReportGroup').inputValue(),String(manifest.ids.groups.english));
                assert.deepEqual(await page.locator('.education-report-summary strong').allTextContents(),Object.values(expected).map(String));
            }
        }
        const emptyUrl=page.url();await go(page,'today');await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading);
        await page.goBack({waitUntil:'domcontentloaded'});await reportReady(page);assert.equal(page.url(),emptyUrl);
        assert.deepEqual(await page.locator('.education-report-summary strong').allTextContents(),Array(8).fill('0'));
        await page.goForward({waitUntil:'domcontentloaded'});
        await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
        await page.locator('#educationTodayPanel').waitFor({state:'visible'});
        await page.waitForFunction(()=>window.EducationScheduleWorkspace.state.activeView==='today'&&!window.EducationScheduleWorkspace.state.loading&&document.querySelectorAll('[data-education-booking-id]').length===4);
        evidence.proofs.reportMatrix=checked;await shot(page,'navigation-forward-today');
    }));
    for(const lateError of [false,true]) await check(`reports-A-B-A-late-${lateError?'error':'success'}`,()=>pageFor(async page=>{
        await go(page,'reports');await reportReady(page);
        const held=await holdOne(page,'**/api/education/reports?*',lateError);
        try{
            await page.locator('#educationReportRun').click();await held.arrived();
            await page.locator('#educationReportFrom').fill('2026-10-01');await page.locator('#educationReportFrom').press('Tab');await reportReady(page);
            await page.locator('#educationReportFrom').fill('2026-09-03');await page.locator('#educationReportFrom').press('Tab');await reportReady(page);
            const expected=await independentReport('2026-09-03','2026-10-03');await held.release();
            await page.waitForFunction(()=>!window.EducationAttendance.state.reportLoading);
            assert.deepEqual(await page.locator('.education-report-summary strong').allTextContents(),Object.values(expected).map(String));
            assert.doesNotMatch(await page.locator('#educationReportStatus').innerText(),/Не вдалося|Завантажуємо/);
            await switchBusiness(page,'maysternya_doli');await reportReady(page);
            const foreignCount=(await pool.query("SELECT count(*)::int n FROM bookings WHERE business_context='maysternya_doli' AND date BETWEEN '2026-09-03' AND '2026-10-03'")).rows[0].n;
            assert.equal(await page.locator('.education-report-table tbody tr').count(),foreignCount);
            await switchBusiness(page,'dar');await reportReady(page);assert.deepEqual(await page.locator('.education-report-summary strong').allTextContents(),Object.values(expected).map(String));
        }finally{held.unblock();}
    }));
    await check('report-error-validation-retry',()=>pageFor(async page=>{
        await go(page,'reports');await reportReady(page);
        let fail=true;await page.route('**/api/education/reports?*',route=>{if(fail){fail=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Controlled report failure'})});}return route.continue();});
        await page.locator('#educationReportRun').click();await page.waitForFunction(()=>!window.EducationAttendance.state.reportLoading&&document.getElementById('educationReportStatus').textContent.includes('Не вдалося'));
        assert.equal(await page.locator('.education-report-summary').count(),0);await page.locator('#educationReportRun').click();await reportReady(page);
        await page.locator('#educationReportFrom').fill('2026-12-01');await page.locator('#educationReportFrom').press('Tab');assert.match(await page.locator('#educationReportStatus').innerText(),/коректний період/);
        await page.locator('#educationReportFrom').fill('2026-09-03');await page.locator('#educationReportFrom').press('Tab');await reportReady(page);
    }));
    await check('today-filters-reset-business',()=>pageFor(async page=>{
        await go(page,'today');await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading&&document.querySelectorAll('[data-education-booking-id]').length===4);
        const controls=['educationScheduleTeacherFilter','educationScheduleCabinetFilter','educationScheduleGroupFilter'];
        for(const control of controls){const select=page.locator(`#${control}`);const value=await select.locator('option').nth(1).getAttribute('value');await select.selectOption(value);assert.ok((await page.locator('[data-education-booking-id]').count())<4);await select.selectOption('');assert.equal(await page.locator('[data-education-booking-id]').count(),4);}
        await switchBusiness(page,'maysternya_doli');await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading&&window.EducationScheduleWorkspace.state.bookings.every(b=>b.businessContext==='maysternya_doli'||b.business_context==='maysternya_doli'));
        const foreign=await page.locator('[data-education-booking-id]').evaluateAll(cards=>cards.map(card=>card.dataset.educationBookingId));assert.ok(foreign.every(id=>!Object.values(manifest.ids.bookings).includes(id)));
        await switchBusiness(page,'dar');await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading&&document.querySelectorAll('[data-education-booking-id]').length===4);
    }));
    await check('journal-refresh-error-keeps-draft',()=>pageFor(async page=>{
        const id=manifest.ids.bookings['english-3'],child=manifest.ids.children['child-1'];await openJournal(page,id);await journalReady(page);
        const field=page.locator(`[data-attendance-child-id="${child}"]`);await field.selectOption('excused');
        let fail=true;await page.route(`**/api/education/attendance/${id}?*`,route=>{if(fail){fail=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Controlled journal refresh failure'})});}return route.continue();});
        await page.locator('#educationAttendanceReload').click();await page.locator('.confirm-overlay .confirm-ok').click();
        await page.waitForFunction(()=>!window.EducationAttendance.state.journalLoading&&document.getElementById('educationAttendanceStatus').textContent.includes('Не вдалося'));
        assert.equal(await field.inputValue(),'excused');assert.equal(await page.locator('#educationAttendanceSave').isDisabled(),false);
        await page.reload({waitUntil:'domcontentloaded'});await journalReady(page);assert.equal(await field.inputValue(),'excused');
    }));
    for(const lateError of [false,true])await check(`today-A-B-A-late-${lateError?'error':'success'}`,()=>pageFor(async page=>{
        await go(page,'today');await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading&&document.querySelectorAll('[data-education-booking-id]').length===4);
        const rows=[], first=deferred(), newest=deferred();let stage='old';
        await page.route('**/api/bookings/2026-10-02?*',async route=>{
            const entry={route,response:await route.fetch(),stage,release:deferred(),done:deferred()};rows.push(entry);first.resolve();if(stage==='new')newest.resolve();
            await entry.release.promise;
            try{await route.fulfill(entry.stage==='old'&&lateError?{status:503,contentType:'application/json',body:JSON.stringify({error:'Controlled old date failure'})}:{response:entry.response});}finally{entry.done.resolve();}
        });
        try{
            await page.locator('#prevDay').click();await bounded(first.promise,'First date A response');
            await page.locator('#nextDay').click();await page.waitForFunction(()=>window.EducationScheduleWorkspace.state.date==='2026-10-03'&&!window.EducationScheduleWorkspace.state.loading);
            stage='new';await page.locator('#prevDay').click();await bounded(newest.promise,'Latest date A response');
            for(const row of rows.filter(row=>row.stage==='new'))row.release.resolve();
            await page.waitForFunction(()=>window.EducationScheduleWorkspace.state.date==='2026-10-02'&&!window.EducationScheduleWorkspace.state.loading&&document.querySelectorAll('[data-education-booking-id]').length===4);
            for(const row of rows)row.release.resolve();await bounded(Promise.all(rows.map(row=>row.done.promise)),'All date responses released');
            assert.equal(await page.locator('[data-education-retry]').count(),0);
            const actual=await page.locator('[data-education-booking-id]').evaluateAll(cards=>cards.map(card=>card.dataset.educationBookingId).sort());
            const expected=(await pool.query("SELECT id FROM bookings WHERE business_context='dar' AND date='2026-10-02' ORDER BY id")).rows.map(row=>row.id);assert.deepEqual(actual,expected);
            evidence.proofs[`todayABA${lateError?'Error':'Success'}`]={actual,expected,heldOld:rows.filter(row=>row.stage==='old').length,heldCurrent:rows.filter(row=>row.stage==='new').length};
        }finally{for(const row of rows)row.release.resolve();}
    }));
    await check('today-current-error-retry-empty',()=>pageFor(async page=>{
        let fail=true;await page.route('**/api/bookings/2026-10-01?*',route=>fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Controlled current date failure'})}):route.continue());
        await go(page,'today','2026-10-01');await page.locator('[data-education-retry]').waitFor({state:'visible'});assert.equal(await page.locator('[data-education-booking-id]').count(),0);
        fail=false;await page.locator('[data-education-retry]').click();await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading&&!window.EducationScheduleWorkspace.state.error);
        assert.match(await page.locator('#educationTodayList').innerText(),/немає|не знайдено/i);
    }));
    await check('draft-restores-with-stale-revision',()=>pageFor(async(page,create)=>{
        const id=manifest.ids.bookings['english-3'],edited=manifest.ids.children['child-1'],other=manifest.ids.children['child-3'];
        await openJournal(page,id);await journalReady(page);await page.locator(`[data-attendance-child-id="${edited}"]`).selectOption('excused');
        const operator=await create(second);await openJournal(operator,id);await journalReady(operator);
        await operator.locator(`[data-attendance-child-id="${other}"]`).selectOption('absent');await saveJournal(operator,id);
        assert.equal((await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[id,other])).rows[0].status,'absent');
        await page.reload({waitUntil:'domcontentloaded'});await journalReady(page);
        assert.equal(await page.locator(`[data-attendance-child-id="${edited}"]`).inputValue(),'excused');
        assert.equal(await page.locator(`[data-attendance-child-id="${other}"]`).inputValue(),'absent');
        assert.equal((await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[id,edited])).rows[0].status,'absent');
        assert.equal(await page.locator('#educationAttendanceSave').isDisabled(),true);
        assert.match(await page.locator('#educationAttendanceStatus').innerText(),/застаріла/);
        evidence.proofs.draftConflict={unsavedEditedChild:'excused',durableEditedChild:'absent',freshOtherChild:'absent',saveDisabled:true};
    }));
    }
    await check('page-errors',async()=>assert.deepEqual(evidence.pageErrors,[]));
}
const watchdog=setTimeout(()=>{evidence.fatal='Suite deadline exceeded';evidence.exitCode=1;flush();process.exit(1);},480000);
main().catch(error=>{evidence.fatal=error.message;process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);await browser?.close();await pool.end();evidence.exitCode=evidence.fatal?1:results.exitCode();flush();if(evidence.exitCode)process.exitCode=1;});
