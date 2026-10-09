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
const pendingRequests=new Set();let token, manifest, browser, context, page, teacher, group, lesson, previous, parentId, childId, second, date = '2030-01-10';
function flush() { let text = JSON.stringify(evidence,null,2); for (const value of [token,process.env.TEST_USER,process.env.TEST_PASS,second?.password].filter(Boolean)) text=text.split(value).join('[REDACTED]'); fs.writeFileSync(path.join(out,'verification.json'),text); }
async function step(id, action) {
    await results.check(id,id,action,{dependsOn:previous?[previous]:[]}); previous=id;
    if(results.results.at(-1).status==='FAIL'&&page){
        evidence.failureState=await page.evaluate(()=>({date:document.getElementById('educationLessonDate')?.value,hint:document.getElementById('bookingSubmitHint')?.textContent,notifications:window.__finalToastObservations,validation:window.getSmartBookingValidationState?.(),invalidFields:[...document.querySelectorAll('#bookingForm input,#bookingForm select')].filter(el=>!el.disabled&&!el.validity.valid).map(el=>({id:el.id,message:el.validationMessage}))})).catch(()=>null);
        await shot(`failure-${id}`).catch(()=>{});
    }
    flush();console.log(`${results.results.at(-1).status} ${id}`);
}
async function api(route, method='GET', body) { const response=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)}); assert.ok(response.ok,`${method} ${route.split('?')[0]} ${response.status}`); return response.json(); }
async function go(view) { await settle(); await page.waitForLoadState('networkidle'); await page.goto(`${base}/?businessContext=dar&educationSchedule=${view}&date=${date}`,{waitUntil:'domcontentloaded'}); await page.locator('#mainApp').waitFor({state:'visible',timeout:45000}); await page.waitForFunction(view=>window.EducationScheduleWorkspace?.state.activeView===view&&window.isAuthenticatedRuntimeReady?.(),view); await waitRuntimeReads(); await page.waitForLoadState('networkidle'); }
async function waitRuntimeReads(target = page) {
 await target.waitForFunction(() => window.GlobalTaskTimer?.state.hydrated === true
    && !window.GlobalTaskTimer.state.loading && !window.GlobalTaskTimer.state.pendingHydrate);
 evidence.runtimeReadSettles ||= [];
 evidence.runtimeReadSettles.push(await target.evaluate(() => ({
    page: location.pathname + location.search,
    hydrated: window.GlobalTaskTimer.state.hydrated,
    loading: window.GlobalTaskTimer.state.loading,
    pending: window.GlobalTaskTimer.state.pendingHydrate
 })));
}
async function settle() {
 await waitRuntimeReads();
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
        second={username:'edu_close_journey_operator',password:require('node:crypto').randomBytes(24).toString('base64url')};
        await api('/api/users','POST',{...second,name:'Операторка Марія',role:'creator',businessContexts:['dar'],defaultBusinessContext:'dar'});
        browser=await playwright[engine].launch({headless:true}); context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Kyiv',viewport:{width:1440,height:1000}});
        context.on('request',r=>{if(new URL(r.url()).origin===base)pendingRequests.add(r);});context.on('requestfinished',r=>pendingRequests.delete(r));context.on('requestfailed',r=>{pendingRequests.delete(r);evidence.failedRequests ||= [];evidence.failedRequests.push({url:r.url(),method:r.method(),failure:r.failure()?.errorText});});await context.addInitScript(()=>{window.__finalToastObservations=[];document.addEventListener('DOMContentLoaded',()=>new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLElement&&node.matches('#toastContainer .toast'))window.__finalToastObservations.push(node.textContent);}).observe(document.body,{childList:true,subtree:true}));});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        evidence.optionalReadTrace=[];
        await context.exposeBinding('__qaOptionalReadTrace',(_,entry)=>{evidence.optionalReadTrace.push(entry);});
        context.on('request',r=>{const u=new URL(r.url());if(['/api/settings/timeline-visibility','/api/my-day/timer'].includes(u.pathname))evidence.optionalReadTrace.push({event:'native-request',path:u.pathname+u.search,at:new Date().toISOString(),page:r.frame().url()});});
        context.on('requestfailed',r=>{const u=new URL(r.url());if(['/api/settings/timeline-visibility','/api/my-day/timer'].includes(u.pathname))evidence.optionalReadTrace.push({event:'native-requestfailed',path:u.pathname+u.search,error:r.failure()?.errorText,at:new Date().toISOString()});});
        await context.addInitScript(()=>{
            const trace=(event,details)=>{const pending=window.__qaOptionalReadTrace?.({event,details,at:new Date().toISOString(),visibility:document.visibilityState,page:location.pathname+location.search});pending?.catch(()=>{});};
            for(const event of ['beforeunload','pagehide','pageshow','visibilitychange'])window.addEventListener(event,()=>trace(event,null));
            window.addEventListener('error',e=>trace('window-error',e.message));
            window.addEventListener('unhandledrejection',e=>trace('unhandledrejection',String(e.reason?.message||e.reason)));
        });
        page=await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror',e=>evidence.pageErrors.push({name:e.name,message:e.message,stack:e.stack}));
        await page.goto(base,{waitUntil:'domcontentloaded'}); await page.locator('#username').fill(process.env.TEST_USER); await page.locator('#password').fill(process.env.TEST_PASS); await page.locator('#loginForm button[type="submit"]').click(); await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
        await page.waitForURL(url=>url.pathname==='/'&&!url.search);await page.waitForFunction(()=>window.isAuthenticatedRuntimeReady?.());await waitRuntimeReads();await page.waitForLoadState('networkidle');
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
    await step('new-representative-and-new-child-visible-UI',async()=>{
        await settle(); await page.goto(base+'/customers?businessContext=dar',{waitUntil:'domcontentloaded'});
        await page.locator('#addCustomerBtn').waitFor({state:'visible',timeout:45000});
        assert.equal((await pool.query("SELECT count(*)::int n FROM customers WHERE name=$1",['Ганна Лісова'])).rows[0].n,0);
        await page.locator('#addCustomerBtn').click(); await page.locator('#customerEditModal').waitFor({state:'visible'});
        await page.locator('#editName').fill('Ганна Лісова');
        if(!await page.locator('#editChildName0').count())await page.locator('#editAddChildBtn').click();
        await page.locator('#editChildName0').fill('Назар Лісовий'); await page.locator('#editChildBirthday0').fill('2020-05-14');
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/customers');
        await page.locator('#saveCustomerBtn').click(); const saved=await response; assert.ok(saved.ok(),'Visible customer create must succeed');
        await page.locator('#customerEditModal').waitFor({state:'hidden'});
        const parents=(await pool.query("SELECT id,business_context FROM customers WHERE name=$1",['Ганна Лісова'])).rows;
        assert.equal(parents.length,1);assert.equal(parents[0].business_context,'dar');parentId=parents[0].id;
        const children=(await pool.query('SELECT id,name,birthday::text,business_context FROM customer_children WHERE customer_id=$1',[parentId])).rows;
        assert.equal(children.length,1);assert.equal(children[0].name,'Назар Лісовий');assert.equal(children[0].birthday,'2020-05-14');assert.equal(children[0].business_context,'dar');childId=children[0].id;
        assert.ok(!Object.values(manifest.ids.children).map(String).includes(String(childId)),'New child must not be seeded child');
        evidence.createdCustomerChild={parentId,childId,source:'VISIBLE_CUSTOMER_UI',apiRepair:false};
        await page.locator('#customerDetailModal').waitFor({state:'visible'});
        await page.waitForFunction(()=>{const text=document.getElementById('customerDetailContent')?.textContent||'';return text.includes('Ганна Лісова')&&text.includes('Назар Лісовий');});
        assert.match(await page.locator('#customerDetailContent').innerText(),/Ганна Лісова/);
        assert.match(await page.locator('#customerDetailContent').innerText(),/Назар Лісовий/);
        const detail=await api('/api/customers/'+parentId+'?businessContext=dar');
        evidence.childDateOracle={expected:'2020-05-14',sql:(await pool.query('SELECT birthday::text FROM customer_children WHERE id=$1',[childId])).rows[0].birthday,api:detail.children?.find(c=>String(c.id)===String(childId))?.birthday,ui:await page.locator('#customerDetailContent').innerText()};
        await shot('new-customer-new-child');
        await go('groups');await page.locator('#educationGroupsList').selectOption(String(group));
        await page.waitForFunction(id=>String(window.EducationGroups.state.current?.id)===String(id),group);
    });
    await step('find-fictional-child-and-enroll-visible-UI',async()=>{
        await page.locator('#educationChildSearch').fill('Лісов'); await page.locator('#educationChildFind').click(); const child=childId;
        await page.locator(`#educationChildSelect option[value="${child}"]`).waitFor({state:'attached'}); await page.locator('#educationChildSelect').selectOption(String(child)); await page.locator('#educationMemberStart').fill('2026-09-01');
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith(`/${group}/members`)); await page.locator('#educationGroupEnrollForm button[type="submit"]').click(); assert.equal((await response).status(),201);
        await page.waitForFunction(()=>document.getElementById('educationGroupsStatus').textContent==='Дитину зараховано.');
        assert.equal(String((await pool.query('SELECT child_id FROM education_group_members WHERE group_id=$1',[group])).rows[0].child_id),String(child)); await shot('group-with-child');
    });
    await step('create-45-minute-lesson-visible-UI',async()=>{
        await go('schedule'); await page.locator('#timelineViewPanelToggle').click(); await page.locator('[data-schedule-view-mode="day"]').click(); await page.locator('.grid-cell[data-time="15:00"][data-line="edu-cabinet-1"]').first().click(); await page.locator('#bookingPanel').waitFor({state:'visible'});
        await page.locator('#customerSearch').fill('Ганна Лісова'); await page.locator(`.customer-search-item[data-id="${parentId}"]`).click(); await page.locator('#educationLessonTitle').fill('Слухаємо дощ і створюємо ритм'); await page.locator('#educationLessonGroupId').selectOption(String(group)); await page.locator('#educationLessonTeacher').selectOption(String(teacher)); await page.locator('#educationLessonDuration').fill('45');
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
        await card(); await settle(); await page.waitForLoadState('networkidle'); await page.reload({waitUntil:'domcontentloaded'}); await page.locator(`[data-education-booking-id="${lesson}"]`).click(); await page.locator('#bookingModal').waitFor({state:'visible'}); assert.match(await page.locator('#bookingDetails').innerText(),/15:00\s*-\s*15:45/); assert.match(await page.locator('#bookingDetails').innerText(),/Віра Савченко/); assert.equal((await api(`/api/bookings/detail/${lesson}?businessContext=dar`)).booking.duration,45); const cardRoot=page.locator('#bookingDetails');
        assert.equal(await cardRoot.locator('.booking-detail-title').innerText(),'Слухаємо дощ і створюємо ритм');
        for(const label of ['Дата:','Початок:','Тривалість:','Викладач:','Група:','Кабінет:'])assert.equal(await cardRoot.locator('.booking-detail-row .label').filter({hasText:new RegExp('^'+label+'$')}).count(),1,label);
        assert.equal(await cardRoot.locator('.booking-detail-package').count(),0);
        assert.equal(await cardRoot.locator('.booking-detail-row .label').filter({hasText:'Тема:'}).count(),0);
        await shot('created-reloaded-card');
    });
    await step('separate-topic-date-and-cabinet-visible-edits',async()=>{
        await edit(); await page.locator('#educationLessonTitle').fill('Ритми дощу: слухаємо та імпровізуємо'); await saveBooking(); let value=await row(); assert.equal(value.duration,45); assert.equal(value.extra_data.educationLesson.title,'Ритми дощу: слухаємо та імпровізуємо');
        const before=await row(); await edit(); await page.locator('#educationLessonDate').fill('2026-10-02'); await page.locator('#educationLessonDate').press('Tab'); await saveBooking(); date='2026-10-02'; const after=await row(); assert.deepEqual(after,{...before,date});
        await edit(); await page.locator('#roomSelect').selectOption('Творчий простір «Палітра»'); await saveBooking(); value=await row(); assert.equal(value.room,'Творчий простір «Палітра»'); assert.equal(value.duration,45); assert.equal(String(value.extra_data.educationLesson.teacherId),String(teacher)); assert.equal(String(value.extra_data.educationLesson.groupId),String(group)); await card(); await shot('edited-reloaded-card');
    });
    await step('journal-first-mark-through-visible-UI',async()=>{
        await openJournal(); const field=page.locator(`[data-attendance-child-id="${childId}"]`); await field.selectOption('present'); await saveJournal();
        const marks=(await pool.query('SELECT status,marked_by,marked_at FROM education_attendance WHERE booking_id=$1',[lesson])).rows; assert.equal(marks.length,1); assert.equal(marks[0].status,'present'); assert.ok(marks[0].marked_by&&marks[0].marked_at); await shot('journal-present');
    });
    await step('journal-correction-reload-author-time-through-visible-UI',async()=>{
        await page.locator(`[data-attendance-child-id="${childId}"]`).selectOption('absent'); await saveJournal(); await openJournal(); assert.equal(await page.locator('[data-attendance-child-id]').inputValue(),'absent');
        const history=(await pool.query('SELECT h.previous_status,h.new_status,h.changed_by,h.changed_at FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 ORDER BY h.id',[lesson])).rows; assert.equal(history.at(-1).previous_status,'present'); assert.equal(history.at(-1).new_status,'absent'); assert.ok(history.at(-1).changed_by&&history.at(-1).changed_at); evidence.history=history; await shot('journal-correction-history');
    });
    await step('continuous-two-operator-stale-conflict-visible-UI',async()=>{
        const otherContext=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Kyiv',viewport:{width:1440,height:1000}});
        await otherContext.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
        const other=await otherContext.newPage();other.setDefaultTimeout(15000);other.on('pageerror',e=>evidence.pageErrors.push({name:e.name,message:e.message}));
        try {
            await other.goto(base,{waitUntil:'domcontentloaded'});await other.locator('#username').fill(second.username);await other.locator('#password').fill(second.password);await other.locator('#loginForm button[type="submit"]').click();
            await other.locator('#mainApp').waitFor({state:'visible',timeout:45000});await waitRuntimeReads(other);await other.waitForLoadState('networkidle');
            await other.goto(base+'/?businessContext=dar&educationSchedule=attendance&date='+date,{waitUntil:'domcontentloaded'});
            await other.locator('#educationAttendanceDate').fill(date);await other.locator('#educationAttendanceDate').press('Tab');await other.locator('#educationAttendanceLesson').selectOption(lesson);
            await other.locator('[data-attendance-child-id="'+childId+'"]').waitFor({state:'visible'});
            await other.waitForFunction(id=>window.EducationAttendance?.state.journal?.booking.id===id&&!window.EducationAttendance.state.journalLoading,lesson);
            await page.locator('[data-attendance-child-id="'+childId+'"]').selectOption('excused');await saveJournal();
            const durable=async()=>({marks:(await pool.query('SELECT * FROM education_attendance WHERE booking_id=$1 ORDER BY id',[lesson])).rows,history:(await pool.query('SELECT h.* FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 ORDER BY h.id',[lesson])).rows});
            const before=await durable();await other.locator('[data-attendance-child-id="'+childId+'"]').selectOption('present');
            const response=other.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/education/attendance/'+lesson);await other.locator('#educationAttendanceSave').click();assert.equal((await response).status(),409);
            await other.waitForFunction(()=>!window.EducationAttendance.state.saving);assert.deepEqual(await durable(),before);assert.equal(await other.locator('[data-attendance-child-id="'+childId+'"]').inputValue(),'present');assert.match(await other.locator('#educationAttendanceStatus').innerText(),/інший оператор/);
            await other.screenshot({path:path.join(out,'continuous-stale-conflict.png')});evidence.screenshots.push('continuous-stale-conflict.png');
            await other.locator('#educationAttendanceReload').click();await other.getByRole('button',{name:'Відкинути й оновити',exact:true}).click();await other.waitForFunction(()=>!window.EducationAttendance.state.journalLoading&&!window.EducationAttendance.state.loading);
            await other.locator('[data-attendance-child-id="'+childId+'"]').selectOption('absent');const reapplied=other.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/education/attendance/'+lesson);await other.locator('#educationAttendanceSave').click();assert.equal((await reapplied).status(),200);await other.waitForFunction(()=>!window.EducationAttendance.state.saving);
            const after=await durable();assert.equal(after.marks[0].status,'absent');assert.equal(after.history.at(-1).changed_by,second.username);assert.ok(after.history.at(-1).changed_at);
            evidence.continuousConflict={status:409,durableUnchanged:true,draftRetained:true,explicitReapply:true,author:second.username};
        } finally {await otherContext.close();}
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
        await page.locator('#customerSearch').fill('Ганна Лісова');
        await page.locator(`.customer-search-item[data-id="${parentId}"]`).click();
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
    await step('controlled-optional-read-native-navigation',async()=>{
        await settle();
        let arrived,release,heldOnce=false;const entered=new Promise(r=>{arrived=r;}),held=new Promise(r=>{release=r;});
        const routeHandler=async route=>{
            if(heldOnce)return route.continue();heldOnce=true;
            const response=await route.fetch();arrived();await held;
            try{await route.fulfill({response});}catch(error){evidence.controlledNavigation.fulfillAfterNavigation=error.message;}
        };
        evidence.controlledNavigation={heldActualExpressResponse:true,uiActions:[]};
        await page.route('**/api/settings/timeline-visibility?*',routeHandler);
        try {
            await page.locator('[data-education-schedule-tab="schedule"]').click();evidence.controlledNavigation.uiActions.push('visible-schedule-tab');
            let timeout;try{await Promise.race([entered,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Optional settings request barrier not entered')),15000);})]);}finally{clearTimeout(timeout);}
            await page.locator('a[href^="/customers"]:visible').first().click();evidence.controlledNavigation.uiActions.push('visible-customers-link');
            await page.locator('#addCustomerBtn').waitFor({state:'visible',timeout:45000});
            evidence.controlledNavigation.destination=await page.url();
            assert.match(evidence.controlledNavigation.destination,/\/customers/);
        } finally {release();await page.unroute('**/api/settings/timeline-visibility?*',routeHandler);}
        assert.ok(evidence.optionalReadTrace.some(t=>t.event==='beforeunload'),'Actual document unload observed');
        assert.deepEqual(evidence.pageErrors,[]);
        await shot('controlled-optional-read-navigation');
    });
    await step('no-page-errors',()=>assert.deepEqual(evidence.pageErrors,[]));
    await step('new-child-date-visible-API-SQL',async()=>{
        assert.equal(evidence.childDateOracle.sql,evidence.childDateOracle.expected);
        assert.equal(evidence.childDateOracle.api,evidence.childDateOracle.expected,'Customer API must preserve SQL date-only birthday');
        assert.match(evidence.childDateOracle.ui,/14\.05\.2020/,'Visible child birthday must match entered and SQL date');
    });
}
main().catch(error=>{evidence.fatal=error.message;process.exitCode=1;}).finally(async()=>{await context?.close();await browser?.close();await pool.end();evidence.exitCode=results.exitCode();flush();if(evidence.exitCode)process.exitCode=1;});
