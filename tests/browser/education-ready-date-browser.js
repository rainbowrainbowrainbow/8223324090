'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {chromium}=require(process.env.EDU_QA_PLAYWRIGHT);
const {DATABASES,assertLocalTarget,seedDataset}=require('../../scripts/lib/education-ready-dataset');
const {createResults}=require('../helpers/education-ready-results');
assertLocalTarget('fixed');
const base=process.env.TEST_URL;assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const phase=process.env.EDU_DATE_PHASE||'postfix';
const out=path.resolve(process.env.EDU_READY_OUTPUT,`attempt-${new Date().toISOString().replace(/[:.]/g,'-')}`);fs.mkdirSync(out,{recursive:true});
const results=createResults();
const evidence = { attemptId: process.env.EDU_CLOSE_ATTEMPT_ID, suite: process.env.EDU_CLOSE_SUITE,phase,checks:results.results,proofs:{},screenshots:[],pageErrors:[],sourceHashes:{}};
for(const file of ['index.html','js/booking.js','js/booking-form.js'])evidence.sourceHashes[file]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
evidence.harnessHash=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const pool=new Pool({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 55469), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD, database: process.env.PGDATABASE || DATABASES.fixed, ssl: false });
let browser,token,manifest;
function flush(){let json=JSON.stringify(evidence,null,2);for(const value of [token,process.env.TEST_USER,process.env.TEST_PASS].filter(Boolean))json=json.split(value).join('[REDACTED]');fs.writeFileSync(path.join(out,'verification.json'),json);}
async function check(id,action){await results.check(id,id,action,id==='fixtures'?{}:{dependsOn:['fixtures']});flush();console.log(`${results.results.at(-1).status} ${id}`);}
async function api(route,status=200,method='GET',body){const response=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,`${method} ${route.split('?')[0]} ${data.error||''}`);return data;}
async function row(id){return(await pool.query('SELECT id,date::text,time,duration,program_name,room,room_resource_id,line_id,group_name,kids_count,status,extra_data FROM bookings WHERE id=$1',[id])).rows[0];}
async function shot(page,name){assert.ok(!(await page.locator('body').innerText()).includes(process.env.TEST_USER));await page.screenshot({path:path.join(out,name+'.png')});evidence.screenshots.push(name+'.png');}
async function pageFor(action,mobile=false){const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Kyiv',viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile});await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>evidence.pageErrors.push(error.message));try{await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#username').fill(process.env.TEST_USER);await page.locator('#password').fill(process.env.TEST_PASS);await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await action(page);}catch(error){await shot(page,'failure-'+evidence.checks.length);throw error;}finally{await context.close();}}
async function go(page,view,date){await page.goto(`${base}/?businessContext=dar&educationSchedule=groups&date=${date}`,{waitUntil:'domcontentloaded'});await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await page.waitForFunction(()=>window.CrmBusinessContext?.current?.()==='dar'&&window.EducationGroups?.state.listStatus==='ready');await page.locator(`[data-education-schedule-tab="${view}"]`).click();if(view==='today')await page.waitForFunction(date=>window.EducationScheduleWorkspace?.state.date===date&&!window.EducationScheduleWorkspace.state.loading,date);if(view==='schedule'){if(!await page.locator('[data-schedule-view-mode="day"]').isVisible())await page.locator('#timelineViewPanelToggle').click();await page.locator('[data-schedule-view-mode="day"]').click();}}
async function open(page,id,date,view='today'){await go(page,view,date);await page.locator(view==='today'?`[data-education-booking-id="${id}"]`:`.booking-block[data-booking-id="${id}"]`).first().click();await page.locator('#bookingModal').waitFor({state:'visible'});}
async function edit(page,id){const expected=await row(id);await open(page,id,expected.date);await page.locator('#bookingModal .btn-edit-booking').click();await page.locator('#educationLessonTitle').waitFor({state:'visible'});await page.waitForFunction(expected=>!document.getElementById('bookingForm').inert&&document.getElementById('educationLessonTitle').value===expected.title,{title:expected.extra_data.educationLesson.title});}
async function save(page,id,status=200){const waiting=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`/api/bookings/${id}`);await page.locator('#bookingSubmitBtn').click();const response=await waiting;assert.equal(response.status(),status,JSON.stringify(await response.json()));if(status===200)await page.locator('#bookingPanel').waitFor({state:'hidden'});return response.request().postDataJSON();}
function domain(row){
    const lesson=row.extra_data.educationLesson;
    return {id:row.id,date:row.date,time:row.time,duration:row.duration,title:lesson.title,programName:row.program_name,teacherId:String(lesson.teacherId||''),teacherName:lesson.teacherName,groupId:String(lesson.groupId||''),groupName:row.group_name||lesson.groupName||'',room:row.room,roomResourceId:row.room_resource_id,lineId:row.line_id,kids:row.kids_count,status:row.status,seriesId:lesson.seriesId,seriesIndex:lesson.seriesIndex,seriesSize:lesson.seriesId?lesson.seriesSize:undefined,seriesRootDate:lesson.seriesRootDate,fixtureMarker:row.extra_data.educationReady};
}
function dateOnly(before,after,date){assert.deepEqual(domain(after),{...domain(before),date});}
async function verifyCard(page,id,date){await page.reload({waitUntil:'domcontentloaded'});await open(page,id,date);const text=await page.locator('#bookingDetails').innerText();assert.ok(text.includes(date));const stored=await row(id);assert.ok(text.includes(stored.extra_data.educationLesson.title));assert.ok(text.includes(stored.duration+' хвилин'));assert.equal((await api(`/api/bookings/detail/${id}?businessContext=dar`)).booking.date,date);}
async function finalChecks(){
    const id=manifest.ids.bookings['robots-4'];
    await check('date-only-visible-save-reload-card-API-SQL',()=>pageFor(async page=>{
        const before=await row(id);await edit(page,id);assert.equal(await page.locator('#educationLessonDate').inputValue(),before.date);
        await page.locator('#educationLessonDate').fill('2030-01-31');assert.equal(await page.evaluate(()=>window.BookingForm._dirty),true);
        assert.match(await page.locator('#selectedDateDisplay').innerText(),/2030-01-31/);
        assert.equal(await page.locator('#timelineDate').inputValue(),before.date);
        const payload=await save(page,id);dateOnly(before,await row(id),'2030-01-31');assert.equal(payload.date,'2030-01-31');await verifyCard(page,id,'2030-01-31');await shot(page,'date-only-canonical-reload');
        evidence.proofs.dateOnly={before,after:await row(id),payloadDate:payload.date,timelineStayedOnOldDate:true};
    }));
    await check('canonical-date-only-preserves-all-persisted-columns',()=>pageFor(async page=>{
        // The first visible edit normalized the legacy fixture through the existing canonical form.
        // This independent whole-row comparison now checks every persisted column and JSON value.
        const stored=async()=> (await pool.query("SELECT to_jsonb(b)-'updated_at' record FROM bookings b WHERE id=$1",[id])).rows[0].record;
        const before=await stored();await edit(page,id);await page.locator('#educationLessonDate').fill('2030-02-01');await save(page,id);const after=await stored();assert.deepEqual(after,{...before,date:'2030-02-01'});
        await edit(page,id);await page.locator('#educationLessonDate').fill(before.date);await save(page,id);assert.deepEqual(await stored(),before);
        evidence.proofs.allColumns={allColumnsAndJSONUnchanged:true,excludedAuditColumns:['updated_at'],before,after};
    }));
    await check('old-new-Today-day-week-projections',()=>pageFor(async page=>{
        for(const date of [manifest.anchorDate,'2030-01-31']){
            const expectedVisible=date===manifest.anchorDate?manifest.ids.bookings['arts-4']:id;
            await go(page,'today',date);await page.locator(`[data-education-booking-id="${expectedVisible}"]`).waitFor({state:'visible'});assert.equal(await page.locator(`[data-education-booking-id="${id}"]`).count(),date==='2030-01-31'?1:0);
            await go(page,'schedule',date);await page.locator(`.booking-block[data-booking-id="${expectedVisible}"]`).first().waitFor({state:'visible'});
            assert.equal(await page.locator(`.booking-block[data-booking-id="${id}"]`).count(),date==='2030-01-31'?1:0);
            if(!await page.locator('[data-schedule-view-mode="week"]').isVisible())await page.locator('#timelineViewPanelToggle').click();await page.locator('[data-schedule-view-mode="week"]').click();
            await page.locator(`.mini-booking-block[data-booking-id="${expectedVisible}"]`).first().waitFor({state:'visible'});
            if(date==='2030-01-31'){await page.locator(`.mini-booking-block[data-booking-id="${id}"]`).first().waitFor({state:'visible'});await page.locator(`.mini-booking-block[data-booking-id="${id}"]`).first().click();await page.locator('#bookingModal').waitFor({state:'visible'});assert.ok((await page.locator('#bookingDetails').innerText()).includes(date));}
            else assert.equal(await page.locator(`.mini-booking-block[data-booking-id="${id}"]`).count(),0);
        }
        await shot(page,'new-date-week-card');evidence.proofs.projections={oldAbsent:true,newPresent:true,views:['today','day','week']};
    }));
    await check('month-year-and-Kyiv-DST-civil-date-preservation',()=>pageFor(async page=>{
        const dates=['2030-02-01','2030-12-31','2031-01-01','2030-03-31','2030-10-27'];
        for(const date of dates){const before=await row(id);await edit(page,id);await page.locator('#educationLessonDate').fill(date);await save(page,id);dateOnly(before,await row(id),date);await verifyCard(page,id,date);}
        assert.equal(await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone),'Europe/Kiev');
        evidence.proofs.calendar={dates,timezone:'Europe/Kyiv',civilDatesUnshifted:true};await shot(page,'Kyiv-DST-canonical');
    }));
    await check('teacher-conflict-rollback-and-adjacent-slot',()=>pageFor(async page=>{
        const before=await row(id),target='2030-11-01',conflictId='EDU-DATE-CONFLICT';
        await pool.query(`INSERT INTO bookings SELECT (jsonb_populate_record(NULL::bookings,to_jsonb(b)||jsonb_build_object('id',$2::text,'date',$3::text,'line_id','edu-cabinet-3','room','Творчий простір «Палітра»'))).* FROM bookings b WHERE id=$1`,[id,conflictId,target]);
        const otherBefore=await row(conflictId);assert.equal(otherBefore.extra_data.educationLesson.teacherId,before.extra_data.educationLesson.teacherId);assert.notEqual(otherBefore.line_id,before.line_id);
        await edit(page,id);await page.locator('#educationLessonDate').fill(target);await save(page,id,409);
        assert.deepEqual(await row(id),before);assert.deepEqual(await row(conflictId),otherBefore);assert.equal(await page.locator('#educationLessonDate').inputValue(),target);await shot(page,'conflict-preserves-date-draft');
        // A separate adjacent-slot fixture changes only the blocker, never repairs the lesson's UI step.
        await pool.query("UPDATE bookings SET time='10:30',duration=60 WHERE id=$1",[conflictId]);
        await save(page,id);dateOnly(before,await row(id),target);evidence.proofs.conflict={response409:true,partialChanges:false,otherUnchanged:true,adjacentAccepted:true};
    }));
    await check('invalid-visible-date-emits-zero-writes',()=>pageFor(async page=>{
        const before=await row(id);await edit(page,id);let writes=0;page.on('request',req=>{if(req.method()==='PUT'&&new URL(req.url()).pathname===`/api/bookings/${id}`)writes++;});
        await page.locator('#educationLessonDate').fill('');
        await page.waitForFunction(()=>document.getElementById('educationLessonDate').validity.valueMissing&&document.getElementById('bookingSubmitBtn').getAttribute('aria-disabled')==='true');
        assert.match(await page.locator('#bookingSubmitHint').innerText(),/дат/);
        // Shared CRM Save is aria-disabled but stays clickable to explain missing fields.
        // Keyboard submit follows the shared form validation without force-clicking its aria-disabled action.
        await page.locator('#educationLessonDuration').press('Enter');
        await page.waitForFunction(()=>document.activeElement===document.getElementById('educationLessonDate')&&document.activeElement.validity.valueMissing);
        assert.equal(await page.locator('#educationLessonDate').getAttribute('aria-invalid'),'true');
        assert.ok(await page.locator('#educationLessonDate').evaluate(el=>el.validationMessage));assert.equal(writes,0);assert.deepEqual(await row(id),before);evidence.proofs.invalid={writes,unchanged:true,nativeValidationMessage:true,saveAriaDisabled:true,visibleDateError:true};await shot(page,'invalid-date-visible');
    }));
    await check('slow-real-save-and-double-submit',()=>pageFor(async page=>{
        const before=await row(id);await edit(page,id);await page.locator('#educationLessonDate').fill('2030-11-02');
        await page.waitForFunction(()=>BookingDrawerState.bookingTimePreflight.status==='free');
        assert.match(await page.locator('#selectedDateDisplay').innerText(),/2030-11-02/);
        assert.equal(await page.locator('#bookingTime').inputValue(),before.time);
        const endpoint=`**/api/bookings/${id}?*`;let release;const barrier=new Promise(resolve=>{release=resolve;});let held;const received=new Promise(resolve=>{held=resolve;});let requests=0;
        await page.route(endpoint,async route=>{if(route.request().method()!=='PUT')return route.continue();requests++;const response=await route.fetch();assert.equal(response.status(),200);held();await barrier;await route.fulfill({response});});
        try{const waiting=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`/api/bookings/${id}`);await page.locator('#bookingSubmitBtn').click();await received;assert.equal(await page.locator('#bookingSubmitBtn').isDisabled(),true);await page.locator('#bookingForm').dispatchEvent('submit');assert.equal(requests,1);dateOnly(before,await row(id),'2030-11-02');await shot(page,'slow-save-disabled');release();assert.equal((await waiting).status(),200);await page.locator('#bookingPanel').waitFor({state:'hidden'});assert.equal(requests,1);evidence.proofs.slowSave={realResponseHeld:true,requests,SQLOnce:true,previewUsedNewDate:true};}finally{release();await page.unroute(endpoint);}
    }));
    await check('failed-save-retains-date-and-retry',()=>pageFor(async page=>{
        const before=await row(id);await edit(page,id);await page.locator('#educationLessonDate').fill('2030-11-03');const endpoint=`**/api/bookings/${id}?*`;let failed=false;
        await page.route(endpoint,route=>{if(route.request().method()==='PUT'&&!failed){failed=true;return route.fulfill({status:503,json:{success:false,error:'Тимчасова помилка збереження заняття'}});}return route.continue();});
        try{await save(page,id,503);assert.deepEqual(await row(id),before);assert.equal(await page.locator('#educationLessonDate').inputValue(),'2030-11-03');await shot(page,'date-retry-draft');await save(page,id);dateOnly(before,await row(id),'2030-11-03');evidence.proofs.retry={failed503:true,draftRetained:true,retrySaved:true};}finally{await page.unroute(endpoint);}
    }));
    await check('single-series-member-move-keeps-siblings',()=>pageFor(async page=>{
        const member=manifest.ids.bookings['robots-5'],before=await row(member),series=before.extra_data.educationLesson.seriesId;assert.ok(series);
        const siblingsBefore=(await pool.query("SELECT to_jsonb(b) row FROM bookings b WHERE business_context='dar' AND extra_data->'educationLesson'->>'seriesId'=$1 AND id<>$2 ORDER BY id",[series,member])).rows;assert.equal(siblingsBefore.length,2);
        await edit(page,member);assert.match(await page.locator('#educationLessonDateHint').innerText(),/лише це заняття/);await page.locator('#educationLessonDate').fill('2032-01-03');await save(page,member);dateOnly(before,await row(member),'2032-01-03');
        assert.deepEqual((await pool.query("SELECT to_jsonb(b) row FROM bookings b WHERE business_context='dar' AND extra_data->'educationLesson'->>'seriesId'=$1 AND id<>$2 ORDER BY id",[series,member])).rows,siblingsBefore);evidence.proofs.series={seriesId:series,selectedMemberOnly:true,siblingsUnchanged:2};await verifyCard(page,member,'2032-01-03');await shot(page,'single-series-member-date');
    }));
    await check('mobile-visible-date-save-reload',()=>pageFor(async page=>{
        const before=await row(id);await edit(page,id);const field=page.locator('#educationLessonDate');await field.scrollIntoViewIfNeeded();const bounds=await field.boundingBox();assert.ok(bounds.height>=44);assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);await field.fill('2030-11-04');await shot(page,'mobile-date-editor-390');await save(page,id);dateOnly(before,await row(id),'2030-11-04');await verifyCard(page,id,'2030-11-04');await shot(page,'mobile-date-canonical-390');evidence.proofs.mobile={viewport:[390,844],targetHeight:bounds.height,dateOnly:true};
    },true));
    await check('create-date-overrides-timeline-date',()=>pageFor(async page=>{
        await go(page,'schedule','2030-01-10');await page.locator('.grid-cell[data-time="15:00"][data-line="edu-cabinet-1"]').first().click();await page.locator('#bookingPanel').waitFor({state:'visible'});
        assert.equal(await page.locator('#educationLessonDate').inputValue(),'2030-01-10');await page.locator('#educationLessonDate').fill('2030-01-11');await page.locator('#customerSearch').fill('Наталія Романюк');await page.locator(`.customer-search-item[data-id="${manifest.ids.parents['parent-0']}"]`).click();await page.locator('#educationLessonTitle').fill('Подорож у світ звуків');await page.locator('#educationLessonTeacher').selectOption(String(manifest.ids.teachers[0]));await page.locator('#educationLessonGroupId').selectOption(String(manifest.ids.groups.english));await page.locator('#educationLessonDuration').fill('45');
        const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&/^\/api\/bookings(?:\/full)?$/.test(new URL(r.url()).pathname));await page.locator('#bookingSubmitBtn').click();const response=await waiting;assert.equal(response.status(),200,JSON.stringify(await response.json()));await page.locator('#bookingPanel').waitFor({state:'hidden'});
        const rows=(await pool.query("SELECT id,date::text,duration FROM bookings WHERE business_context='dar' AND program_name=$1",['Подорож у світ звуків'])).rows;assert.equal(rows.length,1);assert.equal(rows[0].date,'2030-01-11');assert.equal(rows[0].duration,45);await verifyCard(page,rows[0].id,rows[0].date);evidence.proofs.create={timelineDate:'2030-01-10',savedDate:'2030-01-11',id:rows[0].id};await shot(page,'create-form-date-canonical');
    }));
}
(async()=>{
await check('fixtures',async()=>{const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.TEST_USER,password:process.env.TEST_PASS})});assert.equal(response.status,200);const auth=await response.json();token=auth.accessToken||auth.token;manifest=(await seedDataset(pool,'fixed')).manifest;for(const business of ['dar','maysternya_doli'])await api('/api/business/cabinet?businessContext='+business,200,'PUT',{businessType:'education',timelineMode:'education',resourceModel:'cabinet'});});
if(!manifest)return;browser=await chromium.launch({headless:true});
if(phase==='baseline')await check('visible-date-only-edit-is-available',()=>pageFor(async page=>{await edit(page,manifest.ids.bookings['robots-4']);await shot(page,'before-missing-date-control');assert.equal(await page.locator('#educationLessonDate').count(),1,'Canonical education editor has no visible date-edit control');assert.equal(await page.locator('#educationLessonDate').isVisible(),true);}));
else await finalChecks();
await check('page-errors',()=>assert.deepEqual(evidence.pageErrors,[]));
})().catch(error=>{evidence.fatal=error.message;process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await pool.end();evidence.exitCode=process.exitCode||results.exitCode();process.exitCode=evidence.exitCode;flush();console.log('Evidence: '+path.relative(process.cwd(),out)+'; exit='+evidence.exitCode);});
