'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const engine = process.env.EDU_MOBILE_ENGINE || 'chromium';
const browserType = require(process.env.EDU_QA_PLAYWRIGHT)[engine];
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
        const loginPage = await context.newPage(); loginPage.setDefaultTimeout(45000);
        evidence.bootstrapDiagnostics ||= { pageErrors: [], failedRequests: [] };
        loginPage.on('pageerror', error => evidence.bootstrapDiagnostics.pageErrors.push({message:error.message,stack:error.stack,page:loginPage.url()}));
        loginPage.on('requestfailed', request => evidence.bootstrapDiagnostics.failedRequests.push({path:new URL(request.url()).pathname,failure:request.failure()?.errorText}));
        await loginPage.goto(base, { waitUntil: 'domcontentloaded' });
        await loginPage.locator('#username').fill(credentials.username); await loginPage.locator('#password').fill(credentials.password);
        await loginPage.locator('#loginForm button[type="submit"]').click();
        await loginPage.locator('#mainApp').waitFor({ state: 'visible' });
        await loginPage.waitForFunction(()=>Boolean(window.isAuthenticatedRuntimeReady?.() && document.getElementById('timelineDate')?.value));
        await loginPage.waitForLoadState('networkidle'); await loginPage.close();
        // Start education checks in a fresh page sharing the real UI-authenticated session.
        // Login redirect cancellations remain separately recorded, never represented as education or production success.
        const page = await context.newPage(); page.setDefaultTimeout(12000); pages.push(page);
        page.on('pageerror', error => { evidence.pageErrors.push(error.message); (evidence.pageErrorDetails ||= []).push({message:error.message,stack:error.stack,page:page.url()}); });
        page.on('requestfailed', request => (evidence.failedRequests ||= []).push({path:new URL(request.url()).pathname,method:request.method(),failure:request.failure()?.errorText,page:page.url()}));
        return page;
    }
    try { await action(await create(credentials), create); }
    catch (error) {
        const page = pages[0];
        if (page) {
            evidence.lastFailure = await page.evaluate(() => ({ date: document.getElementById('timelineDate')?.value, today: window.EducationScheduleWorkspace?.state,
                attendance: document.getElementById('educationAttendanceStatus')?.textContent, report: document.getElementById('educationReportStatus')?.textContent }));
            await shot(page, `failure-${evidence.checks.length}`);
        }
        throw error;
    } finally { for (const page of pages) { await page.waitForLoadState('networkidle'); await page.context().close(); } }
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
    await page.waitForLoadState('networkidle');
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
    await page.waitForFunction(() => window.EducationAttendance.state.journal && !window.EducationAttendance.state.journalLoading && !window.EducationAttendance.state.loading && !window.EducationAttendance.state.saving);
}
async function reportReady(page) {
    await page.waitForFunction(() => !window.EducationAttendance.state.reportLoading && document.querySelector('.education-report-summary'));
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    await page.locator('.education-report-summary').waitFor({ state: 'visible' });
}
async function putUI(page,id) {
    const pending=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/education/attendance/'+id);
    await page.locator('#educationAttendanceSave').click();
    const response=await pending;const data=await response.json();
    await page.waitForFunction(()=>!window.EducationAttendance.state.saving);
    return {http:response.status(),data};
}
async function durable(id) {
    return {rows:(await pool.query('SELECT * FROM education_attendance WHERE booking_id=$1 ORDER BY id',[id])).rows,
        history:(await pool.query('SELECT h.* FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 ORDER BY h.id',[id])).rows};
}
async function main() {
    await check('fixtures',async()=>{
        const auth=await api('POST','/api/auth/login',{username:process.env.TEST_USER,password:process.env.TEST_PASS},200,'');token=auth.accessToken||auth.token;
        manifest=(await seedDataset(pool,'fixed')).manifest;plan=buildPlan('fixed');
        for(const business of ['dar','maysternya_doli'])await api('PUT','/api/business/cabinet?businessContext='+business,{businessType:'education',timelineMode:'education',resourceModel:'cabinet'});
        second={username:'edu_close_operator_two',password:crypto.randomBytes(24).toString('base64url')};
        await api('POST','/api/users',{...second,name:'Операторка Марія',role:'creator',businessContexts:['dar'],defaultBusinessContext:'dar'});
        evidence.sourceHashes=Object.fromEntries(['services/educationAttendance.js','routes/education-attendance.js','js/education-attendance.js',__filename].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
    });
    if(!manifest)return;
    browser=await browserType.launch({headless:true});
    await check('stale-two-visible-operators-atomic-409',()=>pageFor(async(page,create)=>{
        const id=manifest.ids.bookings['english-3'],child1=manifest.ids.children['child-1'],child2=manifest.ids.children['child-3'];
        await openJournal(page,id);await journalReady(page);
        const operator=await create(second);await openJournal(operator,id);await journalReady(operator);
        const first=page.locator('[data-attendance-child-id="'+child1+'"]'),other=operator.locator('[data-attendance-child-id="'+child2+'"]');
        const new1=(await first.inputValue())==='absent'?'present':'absent',new2=(await other.inputValue())==='excused'?'present':'excused';
        await first.selectOption(new1);const savedA=await putUI(page,id);assert.equal(savedA.http,200);
        const afterA=await durable(id);await other.selectOption(new2);
        const savedB=await putUI(operator,id);const afterB=await durable(id);
        evidence.proofs.stale={savedA:savedA.data,savedB:savedB.data,statusB:savedB.http,afterA,afterB,draft:await other.inputValue(),message:await operator.locator('#educationAttendanceStatus').innerText()};
        await shot(operator,'two-operators-stale-draft');flush();
        assert.equal(savedB.http,409,'Stale full form must be rejected, not overwrite child1');
        assert.equal(savedB.data.code,'EDUCATION_JOURNAL_STALE');
        assert.deepEqual(afterB,afterA,'409 must change no row/history');
        assert.equal(await other.inputValue(),new2,'Draft stays visible');
        assert.match(await operator.locator('#educationAttendanceStatus').innerText(),/інший оператор/);
        assert.equal(await operator.locator('#educationAttendanceStatus').evaluate(el=>document.activeElement===el),true);
        assert.equal(await operator.locator('#educationAttendanceStatus').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
        await operator.locator('#educationAttendanceReload').click();
        await operator.getByRole('button',{name:'Залишити відмітки',exact:true}).click();
        assert.equal(await other.inputValue(),new2);
        await shot(operator,'stale-draft-keep');
        await operator.locator('#educationAttendanceReload').click();
        await operator.getByRole('button',{name:'Відкинути й оновити',exact:true}).click();
        await operator.waitForFunction(()=>!window.EducationAttendance.state.journalLoading&&!window.EducationAttendance.state.loading);
        assert.equal(await operator.locator('[data-attendance-child-id="'+child1+'"]').inputValue(),new1);
        await other.selectOption(new2);assert.equal((await putUI(operator,id)).http,200);
        const final=await durable(id);assert.equal(final.rows.find(r=>Number(r.child_id)===Number(child1)).status,new1);
        assert.equal(final.rows.find(r=>Number(r.child_id)===Number(child2)).status,new2);
        assert.equal(final.history.at(-1).changed_by,second.username);assert.ok(final.history.at(-1).changed_at);
        evidence.proofs.explicitReapply=final;await shot(operator,'explicit-refresh-reapply');
    }));
    await check('journal-and-report-legacy-metadata',()=>pageFor(async(page)=>{
        const cases=[['robots-1','education_lesson'],['arts-1','bookingWorkspace']];
        for(const [key,format] of cases) {
            const id=manifest.ids.bookings[key];assert.ok(id,'Fixture '+key);
            const row=(await pool.query('SELECT date::text,extra_data FROM bookings WHERE id=$1',[id])).rows[0];
            const extra={...row.extra_data},lesson=extra.educationLesson;delete extra.educationLesson;
            if(format==='bookingWorkspace')extra.bookingWorkspace={...extra.bookingWorkspace,lesson};else extra[format]=lesson;
            await pool.query('UPDATE bookings SET extra_data=$2 WHERE id=$1',[id,extra]);
            await openJournal(page,id,row.date);await journalReady(page);
            const journal=(await api('GET','/api/education/attendance/'+id+'?businessContext=dar')).journal;
            const report=(await api('GET','/api/education/reports?businessContext=dar&from='+row.date+'&to='+row.date+'&groupId='+lesson.groupId)).report;
            const expected=expectedReport(plan,'dar',row.date,row.date,key.split('-')[0],'2026-10-03',720);
            assert.deepEqual(report.summary,expected.summary);
            evidence.proofs[format]={id,journal,report,expected};
            await go(page,'reports',row.date);
            await page.locator('#educationReportFrom').fill(row.date);await page.locator('#educationReportTo').fill(row.date);
            await page.locator('#educationReportGroup').selectOption(String(lesson.groupId));
            await page.locator('#educationReportRun').click();await reportReady(page);
            await shot(page,'report-'+format);flush();
            assert.ok(report.lessons.some(r=>r.bookingId===id),'Journal-supported legacy lesson missing from report');
            assert.ok((await page.locator('#educationReportResult').innerText()).includes(lesson.title));
        }
    }));
    await check('reload-preserves-old-draft-revision-without-implicit-merge',()=>pageFor(async(page,create)=>{
        const id=manifest.ids.bookings['english-3'],child1=manifest.ids.children['child-1'],child2=manifest.ids.children['child-3'];
        await openJournal(page,id);await journalReady(page);
        const revision=await page.evaluate(()=>window.EducationAttendance.state.journal.revision);
        const field=page.locator('[data-attendance-child-id="'+child1+'"]'),desired=(await field.inputValue())==='excused'?'present':'excused';
        await field.selectOption(desired);
        const operator=await create(second);await openJournal(operator,id);await journalReady(operator);
        const other=operator.locator('[data-attendance-child-id="'+child2+'"]');await other.selectOption((await other.inputValue())==='absent'?'present':'absent');
        assert.equal((await putUI(operator,id)).http,200);const before=await durable(id);
        await page.reload({waitUntil:'domcontentloaded'});await journalReady(page);
        assert.equal(await field.inputValue(),desired);
        const state=await page.evaluate(()=>({revision:window.EducationAttendance.state.journal.revision,draftRevision:window.EducationAttendance.state.draftRevision,stale:window.EducationAttendance.state.stale}));
        assert.notEqual(state.revision,revision);assert.equal(state.draftRevision,revision);assert.equal(state.stale,true);
        assert.equal(await page.locator('#educationAttendanceSave').isDisabled(),true);
        assert.match(await page.locator('#educationAttendanceStatus').innerText(),/застаріла/);
        assert.deepEqual(await durable(id),before);evidence.proofs.reloadStale=state;await shot(page,'reload-stale-draft');
    }));
    await check('lost-success-response-retry409-keeps-draft-and-no-duplicate-history',()=>pageFor(async(page)=>{
        const id=manifest.ids.bookings['arts-3'];await openJournal(page,id);await journalReady(page);
        const field=page.locator('[data-attendance-child-id]').first(),child=Number(await field.getAttribute('data-attendance-child-id'));
        const desired=(await field.inputValue())==='absent'?'excused':'absent';await field.selectOption(desired);
        let lost=false;
        await page.route('**/api/education/attendance/'+id,async route=>{
            if(route.request().method()==='PUT'&&!lost) {
                lost=true;const committed=await route.fetch();assert.equal(committed.status(),200);
                return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Controlled lost success response'})});
            }
            return route.continue();
        });
        const failed=await putUI(page,id);assert.equal(failed.http,503);assert.equal(await field.inputValue(),desired);
        const committed=await durable(id);assert.equal(committed.rows.find(r=>Number(r.child_id)===child).status,desired);
        const retry=await putUI(page,id);assert.equal(retry.http,409);assert.equal(retry.data.code,'EDUCATION_JOURNAL_STALE');
        assert.deepEqual(await durable(id),committed);assert.equal(await field.inputValue(),desired);
        assert.equal(await page.locator('#educationAttendanceSave').isDisabled(),true);
        evidence.proofs.lostResponse={committed,retry:retry.data,draft:desired};await shot(page,'lost-response-retry-stale');
        await page.locator('#educationAttendanceReload').click();
        await page.getByRole('button',{name:'Відкинути й оновити',exact:true}).click();await journalReady(page);
        assert.equal(await field.inputValue(),desired);assert.equal((await putUI(page,id)).data.changes,0);
        assert.deepEqual(await durable(id),committed);
    }));

    await check('page-errors',async()=>assert.deepEqual(evidence.pageErrors,[]));
}
const watchdog=setTimeout(()=>{evidence.fatal='Suite deadline exceeded';evidence.exitCode=1;flush();process.exit(1);},480000);
main().catch(error=>{evidence.fatal=error.message;process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);await browser?.close();await pool.end();evidence.exitCode=evidence.fatal?1:results.exitCode();flush();if(evidence.exitCode)process.exitCode=1;});
