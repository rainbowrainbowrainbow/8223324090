'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const playwright = require(process.env.EDU_QA_PLAYWRIGHT);
const engine = process.env.EDU_MOBILE_ENGINE || 'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const { DATABASES, assertLocalTarget, seedDataset } = require('../../scripts/lib/education-ready-dataset');
const { createResults } = require('../helpers/education-ready-results');
assertLocalTarget('fixed');
assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
const base = process.env.TEST_URL; assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const out = path.resolve(process.env.EDU_READY_OUTPUT, `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const pool = new Pool({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 55469), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD, database: process.env.PGDATABASE || DATABASES.fixed, ssl: false });
const results = createResults(), evidence = { attemptId: process.env.EDU_CLOSE_ATTEMPT_ID, suite: process.env.EDU_CLOSE_SUITE, classification:'ONE_CONTINUOUS_VISIBLE_UI_JOURNEY', engine, checks:results.results, steps:[], screenshots:[], pageErrors:[] };
const pendingRequests=new Set();let token, manifest, browser, context, page, teacher, group, lesson, previous, date = '2030-01-10';
function flush() { let text = JSON.stringify(evidence,null,2); for (const value of [token,process.env.TEST_USER,process.env.TEST_PASS].filter(Boolean)) text=text.split(value).join('[REDACTED]'); fs.writeFileSync(path.join(out,'verification.json'),text); }
async function step(id, action) {
    await results.check(id,id,action,{dependsOn:previous?[previous]:[]}); previous=id;
    if(results.results.at(-1).status==='FAIL'&&page){
        evidence.failureState=await page.evaluate(()=>({date:document.getElementById('educationLessonDate')?.value,hint:document.getElementById('bookingSubmitHint')?.textContent,notifications:window.__finalToastObservations,validation:window.getSmartBookingValidationState?.(),invalidFields:[...document.querySelectorAll('#bookingForm input,#bookingForm select')].filter(el=>!el.disabled&&!el.validity.valid).map(el=>({id:el.id,message:el.validationMessage}))})).catch(()=>null);
        await shot(`failure-${id}`).catch(()=>{});
    }
    flush();console.log(`${results.results.at(-1).status} ${id}`);
}
async function api(route, method='GET', body) { const response=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)}); assert.ok(response.ok,`${method} ${route.split('?')[0]} ${response.status}`); return response.json(); }
async function go(view) { await settle(); await page.waitForLoadState('networkidle'); await page.goto(`${base}/?businessContext=dar&educationSchedule=${view}&date=${date}`,{waitUntil:'domcontentloaded'}); await page.locator('#mainApp').waitFor({state:'visible',timeout:45000}); await page.waitForFunction(view=>window.EducationScheduleWorkspace?.state.activeView===view&&window.isAuthenticatedRuntimeReady?.(),view); await page.waitForLoadState('networkidle'); }
async function settle() {
 await page.waitForFunction(()=>!window.EducationScheduleWorkspace?.state.loading&&!window.EducationAttendance?.state.journalLoading&&!window.EducationAttendance?.state.reportLoading
    && (typeof bookingTimePreflightState!=='function'||bookingTimePreflightState().status!=='checking'));
 await new Promise((resolve,reject)=>{if(!pendingRequests.size)return resolve();const deadline=setTimeout(()=>{context.off('requestfinished',finish);context.off('requestfailed',finish);reject(new Error('Requests did not settle before navigation'));},15000);function finish(){if(pendingRequests.size)return;clearTimeout(deadline);context.off('requestfinished',finish);context.off('requestfailed',finish);resolve();}context.on('requestfinished',finish);context.on('requestfailed',finish);finish();});
}
async function row() { return (await pool.query('SELECT id,date::text,time,duration,room,status,extra_data,business_context FROM bookings WHERE id=$1',[lesson])).rows[0]; }
async function shot(name) { await page.screenshot({path:path.join(out,`${name}.png`)}); evidence.screenshots.push(`${name}.png`); }
async function card() { await go('today'); await page.locator(`[data-education-booking-id="${lesson}"]`).click(); await page.locator('#bookingModal').waitFor({state:'visible'}); }
async function edit() { await card(); await page.locator('#bookingModal .btn-edit-booking').click(); await page.locator('#bookingPanel').waitFor({state:'visible'}); await page.waitForFunction(()=>!document.getElementById('bookingForm').inert&&document.getElementById('educationLessonDuration').value==='45'); }
async function saveBooking() { const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`/api/bookings/${lesson}`); const [,saved]=await Promise.all([page.locator('#bookingSubmitBtn').click(),response]); assert.equal(saved.status(),200); await page.locator('#bookingPanel').waitFor({state:'hidden'}); }
async function openJournal() { await go('attendance'); await page.locator('#educationAttendanceDate').fill(date); await page.locator('#educationAttendanceDate').press('Tab'); await page.locator(`#educationAttendanceLesson option[value="${lesson}"]`).waitFor({state:'attached'}); await page.locator('#educationAttendanceLesson').selectOption(lesson); await page.waitForFunction(id=>window.EducationAttendance?.state.journal?.booking.id===id&&!window.EducationAttendance.state.journalLoading,lesson); }
async function saveJournal() { const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`/api/education/attendance/${lesson}`); await page.locator('#educationAttendanceSave').click(); assert.equal((await response).status(),200); await page.waitForFunction(()=>!window.EducationAttendance.state.saving); }
async function main() {
    await step('owned-fixture-and-real-login',async()=>{
        manifest=(await seedDataset(pool,'fixed')).manifest;
        const auth=await (await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.TEST_USER,password:process.env.TEST_PASS})})).json(); token=auth.accessToken||auth.token; assert.ok(token);
        await api('/api/business/cabinet?businessContext=dar','PUT',{businessType:'education',timelineMode:'education',resourceModel:'cabinet'});
        browser=await playwright[engine].launch({headless:true}); context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Kyiv',viewport:{width:1440,height:1000}});
        context.on('request',r=>{if(new URL(r.url()).origin===base)pendingRequests.add(r);});context.on('requestfinished',r=>pendingRequests.delete(r));context.on('requestfailed',r=>{pendingRequests.delete(r);evidence.failedRequests ||= [];evidence.failedRequests.push({url:r.url(),method:r.method(),failure:r.failure()?.errorText});});await context.addInitScript(()=>{window.__finalToastObservations=[];document.addEventListener('DOMContentLoaded',()=>new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLElement&&node.matches('#toastContainer .toast'))window.__finalToastObservations.push(node.textContent);}).observe(document.body,{childList:true,subtree:true}));});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        page=await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror',e=>evidence.pageErrors.push({name:e.name,message:e.message,stack:e.stack}));
        await page.goto(base,{waitUntil:'domcontentloaded'}); await page.locator('#username').fill(process.env.TEST_USER); await page.locator('#password').fill(process.env.TEST_PASS); await page.locator('#loginForm button[type="submit"]').click(); await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
        await page.waitForURL(url=>url.pathname==='/'&&!url.search);await page.waitForFunction(()=>window.isAuthenticatedRuntimeReady?.());await page.waitForLoadState('networkidle');
    });
    await step('new-teacher-first-membership-visible-UI',async()=>{
        await go('groups'); await page.waitForFunction(()=>window.EducationGroups?.state.teacherStatus==='ready');
        await page.locator('#educationTeacherManager summary').click(); await page.locator('#educationTeacherName').fill('Віра Савченко');
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/education/groups/teachers'); await page.locator('#educationTeacherCreateForm button[type="submit"]').click(); const saved=await response; assert.equal(saved.status(),201); teacher=(await saved.json()).teacher.id;
        const membership=(await pool.query('SELECT business_context,is_active FROM education_teacher_memberships WHERE staff_id=$1',[teacher])).rows; assert.deepEqual(membership,[{business_context:'dar',is_active:true}]);
        assert.equal((await pool.query('SELECT count(*)::int n FROM education_groups WHERE teacher_id=$1',[teacher])).rows[0].n,0);
        await page.locator(`#educationGroupTeacher option[value="${teacher}"]`).waitFor({state:'attached'}); await shot('teacher-first-assignment');
    });
    await step('new-group-with-new-teacher-visible-UI',async()=>{
        await page.locator('#educationGroupsList').selectOption(''); await page.locator('#educationGroupName').fill('Музична студія — ритми осіннього дощу'); await page.locator('#educationGroupTeacher').selectOption(String(teacher)); await page.locator('#educationGroupCapacity').fill('8');
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&/^\/api\/education\/groups\/?$/.test(new URL(r.url()).pathname)); await page.locator('#educationGroupForm button[type="submit"]').click(); const saved=await response; assert.equal(saved.status(),201); group=(await saved.json()).group.id;
        assert.equal((await pool.query('SELECT teacher_id FROM education_groups WHERE id=$1',[group])).rows[0].teacher_id,teacher);
        await page.waitForFunction(id=>String(window.EducationGroups.state.current?.id)===String(id),group);
    });
    await step('find-fictional-child-and-enroll-visible-UI',async()=>{
        await page.locator('#educationChildSearch').fill('Романюк'); await page.locator('#educationChildFind').click(); const child=manifest.ids.children['child-1'];
        await page.locator(`#educationChildSelect option[value="${child}"]`).waitFor({state:'attached'}); await page.locator('#educationChildSelect').selectOption(String(child)); await page.locator('#educationMemberStart').fill('2026-09-01');
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith(`/${group}/members`)); await page.locator('#educationGroupEnrollForm button[type="submit"]').click(); assert.equal((await response).status(),201);
        await page.waitForFunction(()=>document.getElementById('educationGroupsStatus').textContent==='Дитину зараховано.');
        assert.equal(String((await pool.query('SELECT child_id FROM education_group_members WHERE group_id=$1',[group])).rows[0].child_id),String(child)); await shot('group-with-child');
    });
    await step('create-45-minute-lesson-visible-UI',async()=>{
        await go('schedule'); await page.locator('#timelineViewPanelToggle').click(); await page.locator('[data-schedule-view-mode="day"]').click(); await page.locator('.grid-cell[data-time="15:00"][data-line="edu-cabinet-1"]').first().click(); await page.locator('#bookingPanel').waitFor({state:'visible'});
        await page.locator('#customerSearch').fill('Наталія Романюк'); await page.locator(`.customer-search-item[data-id="${manifest.ids.parents['parent-0']}"]`).click(); await page.locator('#educationLessonTitle').fill('Слухаємо дощ і створюємо ритм'); await page.locator('#educationLessonGroupId').selectOption(String(group)); await page.locator('#educationLessonTeacher').selectOption(String(teacher)); await page.locator('#educationLessonDuration').fill('45');
        evidence.beforeCreate=await page.evaluate(()=>({date:document.getElementById('educationLessonDate').value,time:document.getElementById('bookingTime').value,title:document.getElementById('educationLessonTitle').value,validation:window.getSmartBookingValidationState?.()}));
        await page.evaluate(()=>{
            const button=document.getElementById('bookingSubmitBtn');
            window.__createActivation={events:[],samePressedNode:null};let pressedNode;
            for(const type of ['mousedown','mouseup','click','submit'])document.addEventListener(type,event=>{
                if(event.target!==button&&event.target!==button.form)return;
                if(type==='mousedown')pressedNode=button.firstChild;
                if(type==='mouseup')window.__createActivation.samePressedNode=button.firstChild===pressedNode;
                window.__createActivation.events.push({type,trusted:event.isTrusted});
            },true);
        });
        const creates=[];const observeCreate=request=>{if(request.method()==='POST'&&/^\/api\/bookings(?:\/full)?$/.test(new URL(request.url()).pathname))creates.push(request);};page.on('request',observeCreate);
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&/^\/api\/bookings(?:\/full)?$/.test(new URL(r.url()).pathname)); await page.locator('#bookingSubmitBtn').click(); assert.equal((await response).status(),200);
        await page.locator('#bookingPanel').waitFor({state:'hidden'});page.off('request',observeCreate);
        evidence.createActivation=await page.evaluate(()=>window.__createActivation);evidence.createPostCount=creates.length;
        assert.equal(evidence.createPostCount,1);assert.equal(evidence.createActivation.samePressedNode,true);
        for(const type of ['click','submit'])assert.equal(evidence.createActivation.events.filter(event=>event.type===type&&event.trusted).length,1);
        const rows=(await pool.query("SELECT id FROM bookings WHERE program_name=$1 AND business_context='dar'",['Слухаємо дощ і створюємо ритм'])).rows; assert.equal(rows.length,1); lesson=rows[0].id;
        const value=await row(); assert.equal(value.duration,45); assert.equal(String(value.extra_data.educationLesson.groupId),String(group)); assert.equal(String(value.extra_data.educationLesson.teacherId),String(teacher)); evidence.created=value;
    });
    await step('reload-canonical-card-and-independent-detail',async()=>{
        await card(); await settle(); await page.waitForLoadState('networkidle'); await page.reload({waitUntil:'domcontentloaded'}); await page.locator(`[data-education-booking-id="${lesson}"]`).click(); await page.locator('#bookingModal').waitFor({state:'visible'}); assert.match(await page.locator('#bookingDetails').innerText(),/15:00\s*-\s*15:45/); assert.match(await page.locator('#bookingDetails').innerText(),/Віра Савченко/); assert.equal((await api(`/api/bookings/detail/${lesson}?businessContext=dar`)).booking.duration,45); await shot('created-reloaded-card');
    });
    await step('separate-topic-date-and-cabinet-visible-edits',async()=>{
        await edit(); await page.locator('#educationLessonTitle').fill('Ритми дощу: слухаємо та імпровізуємо'); await saveBooking(); let value=await row(); assert.equal(value.duration,45); assert.equal(value.extra_data.educationLesson.title,'Ритми дощу: слухаємо та імпровізуємо');
        const before=await row(); await edit(); await page.locator('#educationLessonDate').fill('2026-10-02'); await page.locator('#educationLessonDate').press('Tab'); await saveBooking(); date='2026-10-02'; const after=await row(); assert.deepEqual(after,{...before,date});
        await edit(); await page.locator('#roomSelect').selectOption('Творчий простір «Палітра»'); await saveBooking(); value=await row(); assert.equal(value.room,'Творчий простір «Палітра»'); assert.equal(value.duration,45); assert.equal(String(value.extra_data.educationLesson.teacherId),String(teacher)); assert.equal(String(value.extra_data.educationLesson.groupId),String(group)); await card(); await shot('edited-reloaded-card');
    });
    await step('journal-first-mark-through-visible-UI',async()=>{
        await openJournal(); const field=page.locator(`[data-attendance-child-id="${manifest.ids.children['child-1']}"]`); await field.selectOption('present'); await saveJournal();
        const marks=(await pool.query('SELECT status,marked_by,marked_at FROM education_attendance WHERE booking_id=$1',[lesson])).rows; assert.equal(marks.length,1); assert.equal(marks[0].status,'present'); assert.ok(marks[0].marked_by&&marks[0].marked_at); await shot('journal-present');
    });
    await step('journal-correction-reload-author-time-through-visible-UI',async()=>{
        await page.locator(`[data-attendance-child-id="${manifest.ids.children['child-1']}"]`).selectOption('absent'); await saveJournal(); await openJournal(); assert.equal(await page.locator('[data-attendance-child-id]').inputValue(),'absent');
        const history=(await pool.query('SELECT h.previous_status,h.new_status,h.changed_by,h.changed_at FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 ORDER BY h.id',[lesson])).rows; assert.equal(history.at(-1).previous_status,'present'); assert.equal(history.at(-1).new_status,'absent'); assert.ok(history.at(-1).changed_by&&history.at(-1).changed_at); evidence.history=history; await shot('journal-correction-history');
    });
    await step('group-report-independent-constant-oracle',async()=>{
        await settle(); await page.waitForLoadState('networkidle');
        await page.goto(`${base}/?businessContext=dar&educationSchedule=reports&date=${date}&educationReportFrom=${date}&educationReportTo=${date}&educationReportGroup=${group}`,{waitUntil:'domcontentloaded'});
        await page.locator('.education-report-summary').waitFor({state:'visible'}); await page.locator('#educationReportGroup').selectOption(String(group)); await page.locator('#educationReportRun').click(); await page.waitForFunction(()=>!window.EducationAttendance.state.reportLoading&&document.querySelector('.education-report-summary'));
        const expected={held:1,cancelled:0,scheduled:0,journalsNotStarted:0,present:0,absent:1,excused:0,unmarked:0}; const report=await api(`/api/education/reports?businessContext=dar&from=${date}&to=${date}&groupId=${group}`); assert.deepEqual(report.report.summary,expected); assert.deepEqual((await page.locator('.education-report-summary strong').allTextContents()).map(Number),Object.values(expected)); evidence.reportOracle=expected; await shot('report-one-held-one-absent');
    });
    await step('cancel-visible-UI-retains-other-fields',async()=>{
        const before=await row(); await card(); const response=page.waitForResponse(r=>r.request().method()!=='GET'&&new URL(r.url()).pathname.includes(lesson)); await page.locator(`[data-cancellation-booking-id="${lesson}"]`).click(); await page.locator('#confirmYes').click(); assert.ok((await response).ok()); await page.waitForFunction(()=>document.getElementById('bookingModal').classList.contains('hidden')); const after=await row(); assert.deepEqual(after,{...before,status:'cancelled'}); evidence.cancelled=after; await shot('cancelled-today');
    });
    await step('visible-series-create-crosses-year',async()=>{
        date='2030-12-27'; await go('schedule');
        await page.locator('#timelineViewPanelToggle').click();
        await page.locator('[data-schedule-view-mode="day"]').click();
        await page.locator('.grid-cell[data-time="15:00"][data-line="edu-cabinet-1"]').first().click();
        await page.locator('#bookingPanel').waitFor({state:'visible'});
        await page.locator('#customerSearch').fill('Наталія Романюк');
        await page.locator(`.customer-search-item[data-id="${manifest.ids.parents['parent-0']}"]`).click();
        await page.locator('#educationLessonTitle').fill('Зимова музична подорож');
        await page.locator('#educationLessonGroupId').selectOption(String(group));
        await page.locator('#educationLessonTeacher').selectOption(String(teacher));
        await page.locator('#educationLessonSeriesSize').fill('3');
        await page.locator('#educationLessonRepeatEvery').selectOption('weekly');
        await page.locator('#educationLessonDuration').fill('45');
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/bookings/education-series');
        await page.locator('#bookingSubmitBtn').click(); assert.equal((await response).status(),200);
        await page.locator('#bookingPanel').waitFor({state:'hidden'});
        const rows=(await pool.query("SELECT id,date::text,duration,status,extra_data FROM bookings WHERE program_name=$1 AND business_context='dar' ORDER BY date",['Зимова музична подорож'])).rows;
        assert.equal(rows.length,3); assert.deepEqual(rows.map(r=>r.date),['2030-12-27','2031-01-03','2031-01-10']);
        for(const r of rows){assert.equal(r.duration,45);assert.equal(String(r.extra_data.educationLesson.teacherId),String(teacher));assert.equal(String(r.extra_data.educationLesson.groupId),String(group));}
        evidence.seriesBefore=rows; lesson=rows[0].id; await card();
        await page.getByRole('button',{name:'Відкрити серію',exact:true}).click();
        await page.locator('#educationSeriesModal .education-series-row').nth(2).waitFor({state:'visible'});
        await shot('series-three-lessons-cross-year');
    });
    await step('visible-series-cancel-preserves-records',async()=>{
        const seriesId=evidence.seriesBefore[0].extra_data.educationLesson.seriesId;
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/api/bookings/education-series/${seriesId}/cancel`);
        await page.getByRole('button',{name:'Скасувати всю серію',exact:true}).click();
        await page.locator('#confirmYes').click(); assert.equal((await response).status(),200);
        await page.locator('#educationSeriesModal').waitFor({state:'hidden'});
        const after=(await pool.query('SELECT id,date::text,duration,status,extra_data FROM bookings WHERE id=ANY($1::text[]) ORDER BY date',[evidence.seriesBefore.map(r=>r.id)])).rows;
        assert.deepEqual(after,evidence.seriesBefore.map(r=>({...r,status:'cancelled'}))); evidence.seriesAfter=after;
        await settle(); await go('today'); await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading);
        for(const r of after){
            assert.equal(await page.locator(`[data-education-booking-id="${r.id}"]`).count(),0);
        }
        const series=await api(`/api/bookings/education-series/${seriesId}?businessContext=dar&includeCancelled=true`);
        assert.equal(series.bookings.length,3);
        assert.deepEqual(series.bookings.map(r=>r.id).sort(),after.map(r=>r.id).sort());
        assert.ok(series.bookings.every(r=>r.status==='cancelled'));
        await shot('series-cancelled-reloaded');
    });
    await step('no-page-errors',()=>assert.deepEqual(evidence.pageErrors,[]));
}
main().catch(error=>{evidence.fatal=error.message;process.exitCode=1;}).finally(async()=>{await context?.close();await browser?.close();await pool.end();evidence.exitCode=results.exitCode();flush();if(evidence.exitCode)process.exitCode=1;});
