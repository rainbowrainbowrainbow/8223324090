'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const { DATABASES, assertLocalTarget, seedDataset } = require('../../scripts/lib/education-ready-dataset');
const { createResults } = require('../helpers/education-ready-results');
assertLocalTarget('fixed');
const base = process.env.TEST_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const phase = process.env.EDU_TEACHERS_PHASE || 'postfix';
const out = path.resolve(process.env.EDU_READY_OUTPUT, `attempt-${new Date().toISOString().replace(/[:.]/g,'-')}`);
fs.mkdirSync(out,{recursive:true});
const results = createResults();
const evidence = {phase,checks:results.results,proofs:{},screenshots:[],pageErrors:[]};
const productFiles=['services/educationGroups.js','services/educationSeriesTeacher.js','routes/education-groups.js','routes/bookings.js','js/education-groups.js','js/booking.js','index.html','css/education-schedule.css','db/migrations/380_education_teacher_memberships.sql'];
evidence.sourceHashes=Object.fromEntries(productFiles.filter(f=>fs.existsSync(f)).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
evidence.harnessHash=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const pool = new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.fixed,ssl:false});
let token, manifest, browser, candidate, newTeacher, foreignTeacher, groupId, lessonId;
let reader;
function flush() {
    let text=JSON.stringify(evidence,null,2);
    for(const secret of [token,process.env.TEST_USER,process.env.TEST_PASS,reader?.token,reader?.username,reader?.password].filter(Boolean)) text=text.split(secret).join('[REDACTED]');
    fs.writeFileSync(path.join(out,'verification.json'),text);
}
async function check(id,action) {await results.check(id,id,action,{dependsOn:id==='fixtures'?[]:['fixtures']});flush();console.log(`${results.results.at(-1).status} ${id}`);}
async function api(route,method='GET',body,status=200) {
    const res=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
    const data=await res.json();assert.equal(res.status,status,`${method} ${route.split('?')[0]} ${data.error||''}`);return data;
}
async function pageFor(action, business='dar', width=1440) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000},hasTouch:width===390,isMobile:width===390,serviceWorkers:'block',timezoneId:'Europe/Kyiv'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>evidence.pageErrors.push(e.message));
    try {
        await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#username').fill(process.env.TEST_USER);await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
        await page.goto(`${base}/?businessContext=${business}&educationSchedule=groups&date=${manifest.anchorDate}`,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.EducationGroups?.state.teacherStatus==='ready'&&window.EducationGroups?.state.listStatus==='ready');
        return await action(page);
    } finally {await context.close();}
}
async function shot(page,name) {await page.screenshot({path:path.join(out,`${name}.png`)});evidence.screenshots.push(`${name}.png`);}
async function manager(page) {
    if ((await page.locator('#educationTeacherManager').getAttribute('open')) === null) await page.locator('#educationTeacherManager summary').click();
    await page.locator('#educationTeacherName').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.getElementById('educationTeacherManagerStatus').textContent.includes('Завантаження'));
}
async function createTeacherUI(page,name) {
    await manager(page);await page.locator('#educationTeacherName').fill(name);
    const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/education/groups/teachers');
    await page.locator('#educationTeacherCreateForm button[type="submit"]').click();const result=await response;
    assert.equal(result.status(),201,JSON.stringify(await result.json()));
    await page.waitForFunction(()=>document.getElementById('educationTeacherManagerStatus').textContent==='Викладача додано.'&&!document.getElementById('educationTeacherCreateForm').hasAttribute('aria-busy'));
    return (await result.json()).teacher.id;
}
async function selectGroup(page,id) {
    await page.locator('#educationGroupsList').selectOption(String(id));
    await page.waitForFunction(id=>String(window.EducationGroups.state.current?.id)===String(id),id);
}
async function saveGroupUI(page) {
    const response=page.waitForResponse(r=>['POST','PUT'].includes(r.request().method())&&/^\/api\/education\/groups(?:\/\d+)?\/?$/.test(new URL(r.url()).pathname));
    await page.locator('#educationGroupForm button[type="submit"]').click();const saved=await response;
    assert.ok([200,201].includes(saved.status()),JSON.stringify(await saved.json()));
    await page.waitForFunction(()=>document.getElementById('educationGroupsStatus').textContent==='Групу збережено.'&&!document.getElementById('educationGroupForm').hasAttribute('aria-busy'));
    return (await saved.json()).group.id;
}
async function openLesson(page,id,date=manifest.anchorDate) {
    await page.goto(`${base}/?businessContext=dar&educationSchedule=today&date=${date}`,{waitUntil:'domcontentloaded'});
    await page.locator(`[data-education-booking-id="${id}"]`).click();await page.locator('#bookingModal').waitFor({state:'visible'});
}
async function editLesson(page,id,date=manifest.anchorDate) {
    await openLesson(page,id,date);await page.locator('#bookingModal .btn-edit-booking').click();
    await page.locator('#educationLessonTeacher').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.getElementById('bookingForm').inert&&!document.getElementById('educationLessonTeacher').disabled);
}
async function saveLessonUI(page,id) {
    const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`/api/bookings/${id}`);
    await page.locator('#bookingSubmitBtn').click();const saved=await response;assert.equal(saved.status(),200,JSON.stringify(await saved.json()));
    await page.locator('#bookingPanel').waitFor({state:'hidden'});return saved.request().postDataJSON();
}
async function lessonRow(id) {return (await pool.query('SELECT id,date::text,time,duration,extra_data FROM bookings WHERE id=$1',[id])).rows[0];}
async function finalChecks() {
    await check('UI-create-unassigned-teacher-and-double-submit',()=>pageFor(async page=>{
        await manager(page);await page.locator('#educationTeacherName').fill('Вікторія Дем’яненко');
        let arrive,release,posts=0;const entered=new Promise(r=>{arrive=r;}),held=new Promise(r=>{release=r;});
        await page.route('**/api/education/groups/teachers',async route=>{
            if(route.request().method()!=='POST')return route.continue();posts++;const response=await route.fetch();arrive();await held;await route.fulfill({response});
        });
        try {
            await page.locator('#educationTeacherCreateForm button[type="submit"]').click();
            await entered;
            assert.equal(await page.locator('#educationTeacherCreateForm button[type="submit"]').isDisabled(),true);
            await page.locator('#educationTeacherCreateForm').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
            const rows=(await pool.query("SELECT s.id,s.name,m.business_context,m.created_by FROM staff s JOIN education_teacher_memberships m ON m.staff_id=s.id WHERE s.name=$1",['Вікторія Дем’яненко'])).rows;
            assert.equal(rows.length,1);assert.equal(rows[0].business_context,'dar');assert.ok(rows[0].created_by);newTeacher=rows[0].id;
            assert.equal((await pool.query('SELECT count(*)::int n FROM education_groups WHERE teacher_id=$1',[newTeacher])).rows[0].n,0);
            evidence.proofs.firstMembership=rows[0];assert.equal(posts,1);
        }finally{release();}
        await page.waitForFunction(()=>document.getElementById('educationTeacherManagerStatus').textContent==='Викладача додано.');
        assert.equal(await page.locator(`#educationGroupTeacher option[value="${newTeacher}"]`).count(),1);
        assert.equal(await page.locator(`#educationGroupTeacher option[value="${candidate}"]`).count(),0,'Global unowned staff must stay hidden');
        const directory=await api('/api/education/groups/teachers?businessContext=dar');
        assert.ok(directory.teachers.every(t=>Object.keys(t).sort().join(',')==='id,is_active,name'));
        assert.ok(directory.teachers.some(t=>Number(t.id)===newTeacher));await shot(page,'new-unassigned-teacher-desktop');
    }));
    await check('first-lesson-reassignment-with-zero-group-references',()=>pageFor(async page=>{
        assert.ok(newTeacher);const id=manifest.ids.bookings['robots-4'],before=await lessonRow(id);
        await editLesson(page,id);await page.locator('#educationLessonTeacher').selectOption(String(newTeacher));await saveLessonUI(page,id);
        const after=await lessonRow(id);assert.equal(String(after.extra_data.educationLesson.teacherId),String(newTeacher));
        assert.equal(after.extra_data.educationLesson.teacherName,'Вікторія Дем’яненко');
        for(const field of ['date','time','duration'])assert.deepEqual(after[field],before[field]);
        assert.equal((await pool.query('SELECT count(*)::int n FROM education_groups WHERE teacher_id=$1',[newTeacher])).rows[0].n,0);
        await openLesson(page,id);assert.match(await page.locator('#bookingDetails').innerText(),/Вікторія Дем’яненко/);
        const detail=(await api(`/api/bookings/detail/${id}?businessContext=dar`)).booking;assert.equal(String(detail.extraData.educationLesson.teacherId),String(newTeacher));
        await shot(page,'first-lesson-teacher-canonical-reload');
    }));
    await check('first-group-and-new-lesson-through-visible-UI',()=>pageFor(async page=>{
        await page.locator('#educationGroupsList').selectOption('');await page.locator('#educationGroupName').fill('Музичні відкриття — звуки навколо нас');
        await page.locator('#educationGroupTeacher').selectOption(String(newTeacher));await page.locator('#educationGroupCapacity').fill('8');groupId=await saveGroupUI(page);
        const group=(await api(`/api/education/groups/${groupId}?businessContext=dar`)).group;assert.equal(group.teacher_id,newTeacher);
        assert.equal((await pool.query('SELECT teacher_id FROM education_groups WHERE id=$1',[groupId])).rows[0].teacher_id,newTeacher);
        await page.goto(`${base}/?businessContext=dar&educationSchedule=groups&date=2030-01-10`,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.EducationGroups?.state.listStatus==='ready');
        await page.locator('[data-education-schedule-tab="schedule"]').click();await page.locator('#timelineViewPanelToggle').click();await page.locator('[data-schedule-view-mode="day"]').click();
        await page.locator('.grid-cell[data-time="15:00"][data-line="edu-cabinet-1"]').first().click();await page.locator('#bookingPanel').waitFor({state:'visible'});
        await page.locator('#customerSearch').fill('Наталія Романюк');await page.locator(`.customer-search-item[data-id="${manifest.ids.parents['parent-0']}"]`).click();
        await page.locator('#educationLessonTitle').fill('Музика дощу та вітру');await page.locator('#educationLessonGroupId').selectOption(String(groupId));
        await page.locator('#educationLessonTeacher').selectOption(String(newTeacher));await page.locator('#educationLessonDuration').fill('45');
        const created=page.waitForResponse(r=>r.request().method()==='POST'&&/^\/api\/bookings(?:\/full)?$/.test(new URL(r.url()).pathname));
        await page.locator('#bookingSubmitBtn').click();const response=await created;assert.equal(response.status(),200,JSON.stringify(await response.json()));
        const rows=(await pool.query("SELECT id,extra_data,duration FROM bookings WHERE program_name='Музика дощу та вітру' AND business_context='dar'")).rows;
        assert.equal(rows.length,1);lessonId=rows[0].id;assert.equal(String(rows[0].extra_data.educationLesson.teacherId),String(newTeacher));assert.equal(rows[0].duration,45);
        await openLesson(page,lessonId,'2030-01-10');assert.match(await page.locator('#bookingDetails').innerText(),/Вікторія Дем’яненко/);await shot(page,'created-lesson-canonical');
    }));
    await check('teacher-failed-write-preserves-draft-and-retry',()=>pageFor(async page=>{
        await manager(page);await page.locator('#educationTeacherName').fill('Остап Олійник');
        await page.route('**/api/education/groups/teachers',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Тимчасова помилка збереження'}}):route.continue());
        await page.locator('#educationTeacherCreateForm button[type="submit"]').click();
        await page.waitForFunction(()=>document.getElementById('educationTeacherManagerStatus').dataset.state==='error');
        assert.equal(await page.locator('#educationTeacherName').inputValue(),'Остап Олійник');assert.equal((await pool.query('SELECT count(*)::int n FROM staff WHERE name=$1',['Остап Олійник'])).rows[0].n,0);
        await page.unroute('**/api/education/groups/teachers');await createTeacherUI(page,'Остап Олійник');
        assert.equal((await pool.query('SELECT count(*)::int n FROM staff WHERE name=$1',['Остап Олійник'])).rows[0].n,1);await shot(page,'teacher-retry-success');
    }));
    await check('foreign-teacher-created-through-secondary-UI',()=>pageFor(async page=>{
        foreignTeacher=await createTeacherUI(page,'Дарина Гончаренко');
        assert.equal((await pool.query('SELECT business_context FROM education_teacher_memberships WHERE staff_id=$1',[foreignTeacher])).rows[0].business_context,'maysternya_doli');
        assert.equal((await pool.query('SELECT count(*)::int n FROM education_groups WHERE teacher_id=$1',[foreignTeacher])).rows[0].n,0);
        await shot(page,'secondary-unassigned-teacher');
    },'maysternya_doli'));
    await check('two-business-picker-isolation-and-direct-ID-rejection',()=>pageFor(async page=>{
        assert.equal(await page.locator(`#educationGroupTeacher option[value="${foreignTeacher}"]`).count(),0);
        await editLesson(page,lessonId,'2030-01-10');assert.equal(await page.locator(`#educationLessonTeacher option[value="${foreignTeacher}"]`).count(),0);
        const own=(await api('/api/education/groups/teachers?businessContext=dar')).teachers;
        const other=(await api('/api/education/groups/teachers?businessContext=maysternya_doli')).teachers;
        assert.ok(!own.some(t=>Number(t.id)===foreignTeacher));assert.ok(!other.some(t=>Number(t.id)===newTeacher));
        const before=await lessonRow(lessonId),count=(await pool.query('SELECT count(*)::int n FROM bookings')).rows[0].n;
        await api(`/api/education/groups/${groupId}?businessContext=dar`,'PUT',{name:'Чужий викладач',capacity:8,teacherId:foreignTeacher},404);
        await api(`/api/education/groups/teachers/${foreignTeacher}?businessContext=dar`,'PUT',{isActive:false},404);
        const representation=(await api(`/api/bookings/detail/${lessonId}?businessContext=dar`)).booking;
        const forged={...representation,date:'2035-01-10',time:'12:00',extraData:{...representation.extraData,educationLesson:{...representation.extraData.educationLesson,teacherId:String(foreignTeacher),teacherName:'Вікторія Дем’яненко'}}};
        await api(`/api/bookings/${lessonId}?businessContext=dar`,'PUT',forged,404);
        await api('/api/bookings?businessContext=dar','POST',forged,404);
        await api('/api/bookings/education-series?businessContext=dar','POST',{booking:{...forged,extraData:{...forged.extraData,educationLesson:{...forged.extraData.educationLesson,seriesSize:2,repeatEvery:'daily'}}}},404);
        assert.deepEqual(await lessonRow(lessonId),before);assert.equal((await pool.query('SELECT count(*)::int n FROM bookings')).rows[0].n,count);
        assert.equal((await pool.query('SELECT teacher_id FROM education_groups WHERE id=$1',[groupId])).rows[0].teacher_id,newTeacher);
        assert.equal((await pool.query('SELECT is_active FROM education_teacher_memberships WHERE staff_id=$1',[foreignTeacher])).rows[0].is_active,true);
        await api('/api/staff?businessContext=dar','GET',undefined,403);
        evidence.proofs.foreignRejected={group:true,teacherUpdate:true,lessonCreate:true,lessonEdit:true,series:true,sqlUnchanged:true};
    }));
    await check('scoped-deactivation-preserves-existing-records',()=>pageFor(async page=>{
        await manager(page);await page.locator(`[data-teacher-active="${newTeacher}"]`).click();
        await page.waitForFunction(()=>document.getElementById('educationTeacherManagerStatus').textContent==='Роботу викладача завершено.');
        assert.equal((await pool.query('SELECT is_active FROM staff WHERE id=$1',[newTeacher])).rows[0].is_active,true);
        assert.equal((await pool.query("SELECT is_active FROM education_teacher_memberships WHERE business_context='dar' AND staff_id=$1",[newTeacher])).rows[0].is_active,false);
        await selectGroup(page,groupId);await page.locator('#educationGroupName').fill('Музичні відкриття — вечірня група');await saveGroupUI(page);
        assert.equal((await api(`/api/education/groups/${groupId}?businessContext=dar`)).group.teacher_id,newTeacher);
        await editLesson(page,lessonId,'2030-01-10');await page.locator('#educationLessonTitle').fill('Музика дощу, вітру й листя');await saveLessonUI(page,lessonId);
        assert.equal(String((await lessonRow(lessonId)).extra_data.educationLesson.teacherId),String(newTeacher));
        const lesson=(await api(`/api/bookings/detail/${lessonId}?businessContext=dar`)).booking;
        await api('/api/bookings?businessContext=dar','POST',{...lesson,date:'2035-02-10'},404);
        await api('/api/education/groups?businessContext=dar','POST',{name:'Новий набір',capacity:4,teacherId:newTeacher},404);
        evidence.proofs.inactive={globalStaffActive:true,existingGroupRetained:true,existingLessonRetained:true,newAssignmentsRejected:true};
    }));
    await check('UI-reactivation-and-mobile-manager',()=>pageFor(async page=>{
        await manager(page);await page.locator(`[data-teacher-active="${newTeacher}"]`).click();
        await page.waitForFunction(()=>document.getElementById('educationTeacherManagerStatus').textContent==='Роботу викладача відновлено.');
        assert.equal((await pool.query("SELECT is_active FROM education_teacher_memberships WHERE business_context='dar' AND staff_id=$1",[newTeacher])).rows[0].is_active,true);
        assert.equal(await page.locator(`#educationGroupTeacher option[value="${newTeacher}"]`).count(),1);
        const bounds=await page.locator('#educationTeacherManager').evaluate(node=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,controls:[...node.querySelectorAll('input,button,summary')].map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height};})}));
        assert.ok(bounds.documentWidth<=bounds.width+1);assert.ok(bounds.controls.every(c=>c.width>=44&&c.height>=44));
        await shot(page,'teacher-manager-mobile-390');
    },'dar',390));
    await check('migration-replay-with-no-automatic-backfill',async()=>{
        const before=(await pool.query('SELECT * FROM education_teacher_memberships ORDER BY business_context,staff_id')).rows;
        await pool.query(fs.readFileSync('db/migrations/380_education_teacher_memberships.sql','utf8'));
        assert.deepEqual((await pool.query('SELECT * FROM education_teacher_memberships ORDER BY business_context,staff_id')).rows,before);
        assert.equal((await pool.query('SELECT count(*)::int n FROM education_teacher_memberships WHERE staff_id=$1',[candidate])).rows[0].n,0);
        evidence.proofs.migration={replayUnchanged:true,unownedStaffNotBackfilled:true};
    });
    await check('shared-teacher-has-independent-business-activity',()=>pageFor(async page=>{
        // Explicit second membership is a fixture prerequisite, not UI write repair.
        await pool.query("INSERT INTO education_teacher_memberships(business_context,staff_id) VALUES ('maysternya_doli',$1)",[newTeacher]);
        await manager(page);await page.locator(`[data-teacher-active="${newTeacher}"]`).click();
        await page.waitForFunction(()=>document.getElementById('educationTeacherManagerStatus').textContent==='Роботу викладача завершено.');
        assert.ok(!(await api('/api/education/groups/teachers?businessContext=dar')).teachers.some(t=>Number(t.id)===newTeacher));
        assert.ok((await api('/api/education/groups/teachers?businessContext=maysternya_doli')).teachers.some(t=>Number(t.id)===newTeacher));
        await page.locator(`[data-teacher-active="${newTeacher}"]`).click();
        await page.waitForFunction(()=>document.getElementById('educationTeacherManagerStatus').textContent==='Роботу викладача відновлено.');
        evidence.proofs.sharedMembership={primaryDeactivationDidNotChangeSecondary:true};
    }));
    await check('legacy-group-without-membership-remains-editable',()=>pageFor(async page=>{
        const teacher=(await pool.query("INSERT INTO staff(name,department,position,is_active) VALUES ('Тетяна Савчук','education','Викладач',true) RETURNING id")).rows[0].id;
        const legacy=(await pool.query("INSERT INTO education_groups(business_context,name,capacity,teacher_id) VALUES ('dar','Історична творча студія',5,$1) RETURNING id",[teacher])).rows[0].id;
        await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.EducationGroups?.state.listStatus==='ready');await selectGroup(page,legacy);
        await page.locator('#educationGroupName').fill('Творча студія — збережена історія');await saveGroupUI(page);
        assert.equal((await api(`/api/education/groups/${legacy}?businessContext=dar`)).group.teacher_id,teacher);
        assert.equal((await pool.query('SELECT count(*)::int n FROM education_teacher_memberships WHERE staff_id=$1',[teacher])).rows[0].n,0);
        await manager(page);await page.locator(`[data-teacher-active="${teacher}"]`).click();
        await page.waitForFunction(()=>document.getElementById('educationTeacherManagerStatus').textContent==='Роботу викладача завершено.');
        assert.ok(!(await api('/api/education/groups/teachers?businessContext=dar')).teachers.some(t=>Number(t.id)===teacher));
        evidence.proofs.legacy={noAutomaticMembership:true,assignmentPreserved:true,explicitInactiveOverridesLegacy:true};
    }));
    await check('read-only-account-cannot-create-or-update-teachers',async()=>{
        reader={username:'edu_reader_'+crypto.randomBytes(12).toString('hex'),password:crypto.randomBytes(24).toString('base64url')};
        await api('/api/users','POST',{username:reader.username,password:reader.password,name:'Спостерігач навчального центру',role:'director',pageAllowlist:['/'],businessContexts:['dar'],defaultBusinessContext:'dar',actionDenylist:['create_booking','edit_booking','delete_booking','manage_settings']});
        const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:reader.username,password:reader.password})});assert.equal(response.status,200);
        const auth=await response.json();reader.token=auth.accessToken||auth.token;
        for(const [method,endpoint,body,status] of [
            ['GET','/api/education/groups/teachers?businessContext=dar',null,200],
            ['GET','/api/education/groups/teachers?businessContext=maysternya_doli',null,403],
            ['POST','/api/education/groups/teachers?businessContext=dar',{name:'Недозволене створення'},403],
            ['PUT',`/api/education/groups/teachers/${newTeacher}?businessContext=dar`,{isActive:false},403]
        ]) {
            const res=await fetch(base+endpoint,{method,headers:{Authorization:`Bearer ${reader.token}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});assert.equal(res.status,status,endpoint);
        }
        assert.equal((await pool.query('SELECT count(*)::int n FROM staff WHERE name=$1',['Недозволене створення'])).rows[0].n,0);
        assert.equal((await pool.query("SELECT is_active FROM education_teacher_memberships WHERE business_context='dar' AND staff_id=$1",[newTeacher])).rows[0].is_active,true);
    });
    await check('invalid-and-non-education-create-leaves-no-staff-rows',async()=>{
        const before=(await pool.query('SELECT count(*)::int n FROM staff')).rows[0].n;
        await api('/api/education/groups/teachers?businessContext=dar','POST',{name:' '},400);
        await api('/api/education/groups/teachers?businessContext=dar','POST',{name:'Спроба довільної прив’язки',staffId:foreignTeacher},400);
        await api('/api/education/groups/teachers?businessContext=event_genix','POST',{name:'Не навчальний бізнес'},409);
        assert.equal((await pool.query('SELECT count(*)::int n FROM staff')).rows[0].n,before);
    });
    await check('controlled-deactivation-prevents-a-stale-new-assignment',async()=>{
        const staff=(await pool.query("INSERT INTO staff(name,department,position,is_active) VALUES ('Марк Дорошенко','education','Викладач',true) RETURNING id")).rows[0].id;
        await pool.query("INSERT INTO education_teacher_memberships(business_context,staff_id) VALUES ('dar',$1)",[staff]);
        const holder=await pool.connect();let pending;
        try {
            await holder.query('BEGIN');await holder.query('SELECT id FROM staff WHERE id=$1 FOR UPDATE',[staff]);
            await holder.query("UPDATE education_teacher_memberships SET is_active=false WHERE business_context='dar' AND staff_id=$1",[staff]);
            pending=api('/api/education/groups?businessContext=dar','POST',{name:'Група конкурентного призначення',capacity:4,teacherId:staff},404);
            let blocked=false;const deadline=Date.now()+12000;
            while(Date.now()<deadline) {
                const rows=await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM staff%FOR SHARE%'");
                if(rows.rows[0].n>0){blocked=true;break;}
                await new Promise(resolve=>setImmediate(resolve));
            }
            assert.equal(blocked,true,'New assignment must wait for the held teacher state');
            await holder.query('COMMIT');await pending;
            assert.equal((await pool.query('SELECT count(*)::int n FROM education_groups WHERE teacher_id=$1',[staff])).rows[0].n,0);
            evidence.proofs.deactivationRace={heldActualSQLLock:true,assignment404:true,partialGroupCount:0};
        }finally{await holder.query('ROLLBACK');holder.release();if(pending)await pending;}
    });
}
(async()=>{
    await check('fixtures',async()=>{
        const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.TEST_USER,password:process.env.TEST_PASS})});
        assert.equal(res.status,200);const auth=await res.json();token=auth.accessToken||auth.token;
        if (phase!=='baseline') {
            assert.equal((await pool.query('SELECT count(*)::int n FROM education_teacher_memberships')).rows[0].n,0,'Migration must not backfill memberships');
            evidence.proofs.emptyMigrationTable=true;
        }
        manifest=(await seedDataset(pool,'fixed')).manifest;
        for(const businessContext of ['dar','maysternya_doli'])await api(`/api/business/cabinet?businessContext=${businessContext}`,'PUT',{businessType:'education',timelineMode:'education',resourceModel:'cabinet'});
        candidate=(await pool.query("INSERT INTO staff(name,department,position,is_active) VALUES ('Наталія Олійник','education','Музика',true) RETURNING id")).rows[0].id;
        evidence.proofs.candidate={id:candidate,name:'Наталія Олійник',groupCount:(await pool.query('SELECT count(*)::int n FROM education_groups WHERE teacher_id=$1',[candidate])).rows[0].n};
        assert.equal(evidence.proofs.candidate.groupCount,0);
    });
    if(!manifest)return;
    browser=await chromium.launch({headless:true});
    if (phase==='baseline') {
    await check('first-group-assignment-through-visible-UI',()=>pageFor(async page=>{
        const options=await page.locator('#educationGroupTeacher option').evaluateAll(nodes=>nodes.map(n=>({id:n.value,name:n.textContent})));
        evidence.proofs.groupPicker={options,createFormCount:await page.locator('#educationTeacherCreateForm').count()};
        await shot(page,'first-teacher-group-picker');
        assert.ok(options.some(o=>o.id===String(candidate)),'New unassigned teacher is unavailable for first assignment');
        assert.equal(await page.locator('#educationTeacherCreateForm').count(),1,'No visible teacher creation workflow');
    }));
    await check('first-lesson-assignment-through-visible-UI',()=>pageFor(async page=>{
        await page.locator('[data-education-schedule-tab="today"]').click();
        await page.locator(`[data-education-booking-id="${manifest.ids.bookings['robots-4']}"]`).click();
        await page.locator('#bookingModal .btn-edit-booking').click();
        await page.locator('#educationLessonTeacher').waitFor({state:'visible'});
        await page.waitForFunction(()=>!document.getElementById('bookingForm').inert&&!document.getElementById('educationLessonTeacher').disabled);
        const options=await page.locator('#educationLessonTeacher option').evaluateAll(nodes=>nodes.map(n=>({id:n.value,name:n.textContent})));
        evidence.proofs.lessonPicker=options;await shot(page,'first-teacher-lesson-picker');
        assert.ok(options.some(o=>o.id===String(candidate)),'New unassigned teacher is unavailable in canonical lesson editor');
    }));
    } else {
        await finalChecks();
    }
    await check('page-errors',()=>assert.deepEqual(evidence.pageErrors,[]));
})().catch(e=>{evidence.fatal=e.message;process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await pool.end();evidence.exitCode=process.exitCode||results.exitCode();process.exitCode=evidence.exitCode;flush();console.log(`Evidence: ${path.relative(process.cwd(),out)}; exit=${evidence.exitCode}`);});
