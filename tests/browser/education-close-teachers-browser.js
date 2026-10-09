'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const engine = process.env.EDU_MOBILE_ENGINE || 'chromium';
const browserType = require(process.env.EDU_QA_PLAYWRIGHT)[engine];
const { DATABASES, assertLocalTarget, seedDataset } = require('../../scripts/lib/education-ready-dataset');
const { createResults } = require('../helpers/education-ready-results');
assertLocalTarget('fixed');
const base = process.env.TEST_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const phase = 'postfix';
const out = path.resolve(process.env.EDU_READY_OUTPUT, `attempt-${new Date().toISOString().replace(/[:.]/g,'-')}`);
fs.mkdirSync(out,{recursive:true});
const results = createResults();
const evidence = { attemptId: process.env.EDU_CLOSE_ATTEMPT_ID, suite: process.env.EDU_CLOSE_SUITE,phase,checks:results.results,proofs:{},audits:[],screenshots:[],pageErrors:[]};
const productFiles=['services/educationGroups.js','services/educationSeriesTeacher.js','routes/education-groups.js','routes/bookings.js','js/education-groups.js','js/booking.js','index.html','css/education-schedule.css','db/migrations/380_education_teacher_memberships.sql'];
evidence.sourceHashes=Object.fromEntries(productFiles.filter(f=>fs.existsSync(f)).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
evidence.harnessHash=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const pool = new Pool({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 55469), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD, database: process.env.PGDATABASE || DATABASES.fixed, ssl: false });
let token, manifest, browser, candidate, newTeacher, foreignTeacher, groupId, lessonId;
let reader;
function flush() {
    let text=JSON.stringify(evidence,null,2);
    for(const secret of [token,process.env.TEST_USER,process.env.TEST_PASS,reader?.token,reader?.username,reader?.password].filter(Boolean)) text=text.split(secret).join('[REDACTED]');
    fs.writeFileSync(path.join(out,'verification.json'),text);
}
async function check(id,action) {if(process.env.EDU_CLOSE_SUITE==='hrLink'&&!['fixtures','close01-existing-HR-staff-link-boundary-no-duplicate','page-errors'].includes(id))return;await results.check(id,id,action,{dependsOn:id==='fixtures'?[]:['fixtures']});flush();console.log(`${results.results.at(-1).status} ${id}`);}
async function api(route,method='GET',body,status=200) {
    const res=await fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
    const data=await res.json();assert.equal(res.status,status,`${method} ${route} ${data.error||''}`);return data;
}
async function waitTeacherRuntimeReads(page) {
    await page.waitForLoadState('networkidle');
    const snapshot=await page.waitForFunction(()=>{
        const timer=window.GlobalTaskTimer?.state;
        if(!timer?.hydrated||timer.loading||timer.pendingHydrate)return false;
        return {page:location.pathname+location.search,timer:{hydrated:timer.hydrated,loading:timer.loading,pending:timer.pendingHydrate},educationLoading:window.EducationScheduleWorkspace?.state.loading};
    });
    evidence.runtimeReadSettles ||= [];evidence.runtimeReadSettles.push(await snapshot.jsonValue());await snapshot.dispose();
    await page.waitForLoadState('networkidle');
}
async function pageFor(action, business='dar', width=1440) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000},hasTouch:width===390,isMobile:width===390,serviceWorkers:'block',timezoneId:'Europe/Kyiv'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>evidence.pageErrors.push({name:e.name,message:e.message,stack:e.stack}));page.on('requestfailed',request=>{const url=new URL(request.url());evidence.failedRequests ||= [];evidence.failedRequests.push({path:url.pathname,business:url.searchParams.get('businessContext'),error:request.failure()?.errorText});});
    try {
        await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#username').fill(process.env.TEST_USER);await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await waitTeacherRuntimeReads(page);
        await page.goto(`${base}/?businessContext=${business}&educationSchedule=groups&date=${manifest.anchorDate}`,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.EducationGroups?.state.teacherStatus==='ready'&&window.EducationGroups?.state.listStatus==='ready');
        return await action(page);
    } finally {await context.close();}
}
async function shot(page,name) {await page.screenshot({path:path.join(out,`${name}.png`)});evidence.screenshots.push(`${name}.png`);}
async function measureContrast(page,label){
    evidence.audits.push(await page.evaluate(label=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const pixel=canvas.getContext('2d',{willReadFrequently:true});
        const colorCache=new Map();const rgb=color=>{if(colorCache.has(color))return colorCache.get(color);pixel.clearRect(0,0,1,1);pixel.fillStyle=color;pixel.fillRect(0,0,1,1);const c=pixel.getImageData(0,0,1,1).data,value=[c[0],c[1],c[2],c[3]/255];colorCache.set(color,value);return value;};
        const mix=(fg,bg)=>{const a=fg[3]??1;return fg.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a));};
        const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
        const visible=el=>Boolean(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
        const backgroundCache=new WeakMap();function background(el){if(backgroundCache.has(el))return backgroundCache.get(el);const parent=el.parentElement?background(el.parentElement):{colors:[[255,255,255]],gradient:false},s=getComputedStyle(el);let colors=parent.colors.map(color=>mix(rgb(s.backgroundColor),color)),gradient=parent.gradient;const stops=[...s.backgroundImage.matchAll(/(?:rgba?|hsla?|color|oklab|oklch|lab|lch)\([^)]*\)|\btransparent\b|#[0-9a-f]{3,8}\b/gi)].map(match=>rgb(match[0]));if(stops.length){gradient=true;const samples=[];for(let i=1;i<stops.length;i++)for(let step=0;step<=20;step++)samples.push(stops[i-1].map((v,j)=>v+(stops[i][j]-v)*step/20));colors=colors.flatMap(color=>samples.map(sample=>mix(sample,color)));}colors=[...new Map(colors.map(c=>[c.join(','),c])).values()];const value={colors,gradient};backgroundCache.set(el,value);return value;}
        const roots=[...document.querySelectorAll('#staffEducationAssignment')].filter(visible);
        const controls=[],contrast=[];
        for(const root of roots)for(const el of root.querySelectorAll('*')){
            if(!visible(el)||el.disabled||el.closest('[inert],[aria-hidden="true"]'))continue;
            const ownText=Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
            const placeholder=!el.value&&el.placeholder;
            const textValue=ownText||el.value||placeholder;
            const s=getComputedStyle(el),backgrounds=background(el);
            if(el.tagName==='BUTTON')controls.push({id:el.id,text:el.textContent.trim(),radius:s.borderRadius,font:s.fontFamily,height:el.getBoundingClientRect().height,background:s.backgroundColor,className:el.className});
            if(!textValue)continue;
            const textStyle=placeholder?getComputedStyle(el,'::placeholder'):s;
            const ratio=Math.min(...backgrounds.colors.map(bg=>{const a=luminance(mix(rgb(textStyle.color),bg)),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);})),size=parseFloat(s.fontSize),large=size>=24||(size>=18.66&&Number(s.fontWeight)>=700);
            contrast.push({selector:el.id?'#'+el.id:el.className||el.tagName,text:String(textValue).slice(0,70),placeholder:Boolean(placeholder),ratio:Number(ratio.toFixed(2)),minimum:large?3:4.5,gradient:backgrounds.gradient});
            if(!Number.isFinite(ratio)){const chain=[];for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(style.backgroundImage!=='none')chain.push(style.backgroundImage);}contrast.at(-1).unparsedBackgrounds=chain;}
        }
        return {label,theme:document.documentElement.dataset.theme,controls,contrast,legendVisible:visible(document.querySelector('.legend')),minimapVisible:visible(document.getElementById('minimapContainer')),workspaceWidth:document.getElementById('educationScheduleWorkspace')?.getBoundingClientRect().width};
    },label));
}


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
async function createCloseLesson(page, teacherId, date, time, cabinet, title, options = {}) {
    await page.goto(`${base}/?businessContext=dar&educationSchedule=groups&date=${date}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.EducationGroups?.state.listStatus==='ready');
    await page.locator('[data-education-schedule-tab="schedule"]').click();
    await page.locator('#timelineViewPanelToggle').click();
    await page.locator('[data-schedule-view-mode="day"]').click();
    await page.locator(`.grid-cell[data-time="19:00"][data-line="edu-cabinet-${cabinet}"]`).first().click();
    await page.locator('#bookingPanel').waitFor({state:'visible'});
    await page.locator('#customerSearch').fill('Наталія Романюк');
    await page.locator(`.customer-search-item[data-id="${manifest.ids.parents['parent-0']}"]`).click();
    await page.locator('#educationLessonTitle').fill(title);
    await page.locator('#educationLessonTeacher').selectOption(String(teacherId));
    await page.locator('#educationLessonDuration').fill('45');
    await page.locator('#bookingTime').selectOption(time);
    if(options.groupId)await page.locator('#educationLessonGroupId').selectOption(String(options.groupId));
    if(options.series){
        await page.locator('#educationLessonRepeatEvery').selectOption('weekly');
        await page.locator('#educationLessonSeriesSize').fill('3');
    }
    let injected = false;
    if(options.wrongName)await page.route('**/api/bookings**',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(request.method()!=='POST'||!/^\/api\/bookings(?:\/full|\/education-series)?$/.test(url.pathname))return route.continue();
        const body=request.postDataJSON(),payload=body.booking||body;
        assert.ok(payload.extraData?.educationLesson,'Fault injection must reach actual UI education payload');
        payload.extraData.educationLesson.teacherName='Неправильне вхідне ім’я';injected=true;
        return route.continue({postData:JSON.stringify(body)});
    });
    const response=page.waitForResponse(r=>r.request().method()==='POST'&&/^\/api\/bookings(?:\/full|\/education-series)?$/.test(new URL(r.url()).pathname));
    await page.locator('#bookingSubmitBtn').click();const saved=await response,body=await saved.json();
    if(options.wrongName)assert.equal(injected,true);
    assert.equal(saved.status(),options.status||200,JSON.stringify(body));
    if((options.status||200)!==200)return null;
    await page.locator('#bookingPanel').waitFor({state:'hidden'});
    const rows=(await pool.query('SELECT id,date::text,time,duration,extra_data FROM bookings WHERE program_name=$1 AND business_context=$2 ORDER BY date',[title,'dar'])).rows;
    assert.equal(rows.length,options.series?3:1); assert.equal(rows[0].date,date); assert.equal(rows[0].time,time); assert.ok(rows.every(r=>String(r.extra_data.educationLesson.teacherId)===String(teacherId))); evidence.proofs[title]=rows; return rows;
}
let closeTeacherA,closeTeacherB,closeFirst;
async function closeChecks(){
    await check('close01-two-same-name-teachers-created-visible-UI',()=>pageFor(async page=>{
        closeTeacherA=await createTeacherUI(page,'марія п’ятницька');
        closeTeacherB=await createTeacherUI(page,'марія п’ятницька');
        assert.notEqual(closeTeacherA,closeTeacherB);
        const rows=(await pool.query("SELECT s.id,m.business_context FROM staff s JOIN education_teacher_memberships m ON m.staff_id=s.id WHERE s.name=$1",['марія п’ятницька'])).rows;
        assert.equal(rows.length,2);assert.ok(rows.every(r=>r.business_context==='dar'));
        evidence.proofs.sameNameIds=[closeTeacherA,closeTeacherB];
    }));
    await check('close01-create-linked-group-canonical-name-visible-UI',()=>pageFor(async page=>{
        const rows=await createCloseLesson(page,closeTeacherA,'2036-01-10','15:00',1,'Звуки зимового лісу',{groupId,wrongName:true});
        closeFirst=rows[0].id;
        assert.equal(rows[0].extra_data.educationLesson.teacherName,'марія п’ятницька');
        assert.equal(String(rows[0].extra_data.educationLesson.teacherId),String(closeTeacherA));
        await openLesson(page,closeFirst,'2036-01-10');assert.match(await page.locator('#bookingDetails').innerText(),/марія п’ятницька/);
        const detail=(await api(`/api/bookings/detail/${closeFirst}?businessContext=dar`)).booking;
        assert.equal(detail.extraData.educationLesson.teacherName,'марія п’ятницька');await shot(page,'close01-canonical-name');
    }));
    await check('close01-same-name-distinct-ID-simultaneous-visible-UI',()=>pageFor(async page=>{
        await createCloseLesson(page,closeTeacherA,'2036-01-11','15:00',1,'Звуки знайомої людини');
        const rows=await createCloseLesson(page,closeTeacherB,'2036-01-11','15:00',2,'Звуки зимового міста');
        assert.equal(String(rows[0].extra_data.educationLesson.teacherId),String(closeTeacherB));
        assert.equal(rows[0].extra_data.educationLesson.teacherName,'марія п’ятницька');
        await openLesson(page,rows[0].id,'2036-01-11');assert.match(await page.locator('#bookingDetails').innerText(),/марія п’ятницька/);
        await shot(page,'close01-distinct-teacher-simultaneous');
    }));
    await check('close01-same-ID-overlap-rejected-no-partial-visible-UI',()=>pageFor(async page=>{
        const before=(await pool.query('SELECT count(*)::int n FROM bookings')).rows[0].n;
        await createCloseLesson(page,closeTeacherA,'2036-01-10','15:00',3,'Конфлікт того самого викладача',{status:409});
        assert.equal((await pool.query('SELECT count(*)::int n FROM bookings')).rows[0].n,before);
    }));
    await check('close01-same-ID-adjacent-visible-UI',()=>pageFor(async page=>{
        const rows=await createCloseLesson(page,closeTeacherA,'2036-01-10','15:45',1,'Наступна музична подорож');
        assert.equal(String(rows[0].extra_data.educationLesson.teacherId),String(closeTeacherA));
    }));
    await check('close01-changed-group-preserves-validated-name-visible-UI',()=>pageFor(async page=>{
        const id=manifest.ids.bookings['robots-4'];await editLesson(page,id);
        const before=await lessonRow(id);
        await page.locator('#educationLessonGroupId').selectOption(String(groupId));
        await page.route(`**/api/bookings/${id}*`,route=>{
            if(route.request().method()!=='PUT')return route.continue();
            const body=route.request().postDataJSON();body.extraData.educationLesson.teacherName='Підмінене ім’я';
            return route.continue({postData:JSON.stringify(body)});
        });
        await saveLessonUI(page,id);const after=await lessonRow(id);
        assert.equal(after.extra_data.educationLesson.teacherName,before.extra_data.educationLesson.teacherName);
        assert.equal(after.extra_data.educationLesson.teacherId,before.extra_data.educationLesson.teacherId);
        for(const key of ['date','time','duration'])assert.deepEqual(after[key],before[key]);
        assert.equal(String(after.extra_data.educationLesson.groupId),String(groupId));
    }));
    await check('close01-series-canonical-name-visible-UI',()=>pageFor(async page=>{
        const rows=await createCloseLesson(page,closeTeacherB,'2036-02-10','12:00',2,'Музика різних пір року',{groupId,wrongName:true,series:true});
        assert.ok(rows.every(r=>r.extra_data.educationLesson.teacherName==='марія п’ятницька'));
        assert.ok(rows.every(r=>String(r.extra_data.educationLesson.teacherId)===String(closeTeacherB)));
        evidence.proofs.canonicalSeriesIds=rows.map(r=>r.id);
    }));
    await check('close01-series-final-conflict-atomic-rollback-visible-UI',()=>pageFor(async page=>{
        await createCloseLesson(page,closeTeacherA,'2036-03-15','15:00',1,'Заняття перед запланованою подорожжю');
        const before=(await pool.query('SELECT to_jsonb(b) AS row FROM bookings b ORDER BY id')).rows;
        await createCloseLesson(page,closeTeacherA,'2036-03-01','15:00',2,'Серія з конфліктом останнього заняття',{series:true,status:409});
        assert.deepEqual((await pool.query('SELECT to_jsonb(b) AS row FROM bookings b ORDER BY id')).rows,before);
        evidence.proofs.seriesAtomic={conflictAtOccurrence:3,status:409,allBookingRowsUnchanged:true};
    }));
    await check('close01-existing-HR-staff-link-boundary-no-duplicate',()=>pageFor(async page=>{
        const before=(await pool.query('SELECT count(*)::int n FROM staff')).rows[0].n;
        assert.equal(await page.locator(`#educationGroupTeacher option[value="${candidate}"]`).count(),0);
        await api('/api/hr/staff?businessContext=dar','GET',undefined,403);
        await api('/api/education/groups/teachers?businessContext=dar','POST',{name:'Наталія Олійник',staffId:candidate},400);
        assert.equal((await pool.query('SELECT count(*)::int n FROM staff')).rows[0].n,before);
        assert.equal((await pool.query('SELECT count(*)::int n FROM education_teacher_memberships WHERE staff_id=$1',[candidate])).rows[0].n,0);
        evidence.proofs.hrLinkBoundary={unownedStaffHidden:true,hrEducation403:true,arbitraryLink400:true,noStaffDuplicate:true};
        // Prerequisite only: real synthetic business/organization memberships for the existing HR card workflow.
        const actorId=(await pool.query('SELECT id FROM users WHERE username=$1',[process.env.TEST_USER])).rows[0].id;
        const org=(await pool.query("INSERT INTO organizations(slug,name) VALUES ('edu_hr_owned','Навчальна synthetic організація') RETURNING id")).rows[0].id;
        await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'owner')",[org,actorId]);
        for(const business of require('../../services/businessContext').businessContextCatalog().filter(b=>['event_genix','dar','maysternya_doli'].includes(b.key))) {
            const id=(await pool.query("INSERT INTO businesses(organization_id,context_key,label,short_label,modules,access_mode) VALUES ($1,$2,$3,$3,$4,'membership') RETURNING id",[org,business.key,business.label,JSON.stringify(business.modules)])).rows[0].id;
            await pool.query("INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default) VALUES ($1,$2,$3,$5,$4)",[id,org,actorId,business.key==='event_genix',business.key==='maysternya_doli'?'director':'creator']);
        }
        evidence.proofs.hrSourcePrerequisite={organizationId:org,actorId,syntheticMemberships:['event_genix','dar','maysternya_doli'],ownershipInferred:false};

        await Promise.all([page.waitForURL(url=>url.pathname==='/'&&(url.searchParams.get('businessContext')||'event_genix')==='event_genix'&&!url.searchParams.has('educationSchedule'),{waitUntil:'domcontentloaded'}),page.locator('#sidebarBusinessContextSelect').selectOption('event_genix')]);await page.waitForFunction(()=>window.CrmBusinessContext?.current?.()==='event_genix'&&window.TimelineBusinessContext?.current?.().apiValue==='event_genix'&&!document.getElementById('sidebarBusinessContextSelect')?.disabled&&window.__crmBusinessNavigationPending!==true);await waitTeacherRuntimeReads(page);
        evidence.proofs.hrRequests=[]; page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/hr/staff/'))evidence.proofs.hrRequests.push({path:u.pathname+u.search,context:r.headers()['x-business-context'],scope:r.headers()['x-business-scope']});});
        await waitTeacherRuntimeReads(page);await page.goto(base+'/hr.html?businessContext=event_genix&employee='+candidate,{waitUntil:'domcontentloaded'});
        await page.locator('#staffEditModal').waitFor({state:'visible'});
        await page.waitForFunction(()=>document.getElementById('staffEditModal')?.dataset.cardState !== 'loading').catch(()=>{});
        evidence.proofs.hrCardBeforeAssignment=await page.evaluate(()=>({state:document.getElementById('staffEditModal')?.dataset.cardState,profileError:document.getElementById('staffProfileCardState')?.textContent,panelHidden:document.getElementById('staffEducationAssignment')?.hidden,manager:window.canAccess?.('hr.staff.manage'),staffId:document.getElementById('editStaffId')?.value,userRole:window.AppState?.currentUser?.role,active:window.AppState?.currentUser?.activeBusinessContext,url:location.pathname+location.search,scope:typeof getCrmBusinessScope==='function'?getCrmBusinessScope():null,membership:window.AppState?.currentUser?.businessMembershipAccess}));flush();
        await page.locator('#staffEducationAssignment').waitFor({state:'visible'});
        await page.waitForFunction(()=>!document.getElementById('staffEducationBusiness').disabled);
        await page.locator('#staffEducationBusiness').selectOption('dar');
        await page.locator('#staffEducationConfirm').check();
        // Explicit error-state probe only; the successful retry still reaches actual Express and SQL.
        let postCount=0,entered,release;const barrier=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;});
        const assignmentRoute='**/api/hr/staff/'+candidate+'/education-memberships*';
        await page.route(assignmentRoute,async route=>{
            if(route.request().method()!=='POST')return route.continue();postCount++;
            if(postCount===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'Контрольована тимчасова помилка'})});
            const actual=await route.fetch();entered();await held;await route.fulfill({response:actual});
        });
        const failedResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/hr/staff/'+candidate+'/education-memberships');
        await page.locator('#staffEducationAssign').click();assert.equal((await failedResponse).status(),503);
        await page.waitForFunction(()=>document.getElementById('staffEducationStatus').textContent.includes('Підтвердження збережено'));
        assert.equal(await page.locator('#staffEducationBusiness').inputValue(),'dar');assert.ok(await page.locator('#staffEducationConfirm').isChecked());
        assert.equal((await pool.query('SELECT count(*)::int n FROM education_teacher_memberships WHERE staff_id=$1',[candidate])).rows[0].n,0);
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/hr/staff/'+candidate+'/education-memberships');
        try {
            await page.locator('#staffEducationAssign').click();let deadline;try{await Promise.race([barrier,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('HR response barrier timeout')),15000);})]);}finally{clearTimeout(deadline);}
            assert.ok(await page.locator('#staffEducationAssign').isDisabled());const bounds=await page.locator('#staffEducationAssign').boundingBox();await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);assert.equal(postCount,2);
        }finally{release();}
        assert.equal((await response).status(),201);await page.unroute(assignmentRoute);
        evidence.proofs.hrRetry={classification:'MOCK_ERROR_PLUS_VISIBLE_RETRY_ACTUAL_EXPRESS_SQL',draftPreserved:true,pendingDoubleSubmitBlocked:true,postCount};
        await page.waitForFunction(()=>document.getElementById('staffEducationStatus').textContent.includes('Працівника призначено викладачем'));
        const rows=(await pool.query('SELECT business_context,staff_id,is_active,created_by,updated_by FROM education_teacher_memberships WHERE staff_id=$1',[candidate])).rows;
        assert.equal(rows.length,1);assert.equal(rows[0].business_context,'dar');assert.ok(rows[0].created_by);assert.equal(rows[0].created_by,rows[0].updated_by);
        const retry=await api(`/api/hr/staff/${candidate}/education-memberships?businessContext=event_genix`,'POST',{educationBusinessContext:'dar',confirmAssignment:true});assert.equal(retry.data.alreadyAssigned,true);
        const audit=(await pool.query("SELECT action,details,performed_by FROM hr_audit_log WHERE action='education_teacher_assign' AND staff_id=$1",[candidate])).rows;
        assert.equal(audit.length,1);assert.equal(audit[0].details.businessContext,'dar');assert.ok(audit[0].performed_by);
        assert.equal((await pool.query('SELECT count(*)::int n FROM staff')).rows[0].n,before);
        const targetAuth=await api('/api/auth/verify?businessContext=dar');const u=targetAuth.user||{};evidence.proofs.hrTargetAuth={role:u.role,contexts:u.businessContexts,active:u.activeBusinessContext,membership:u.businessMembershipAccess};flush();
        assert.ok((await api('/api/education/groups/teachers?businessContext=dar')).teachers.some(t=>t.id===candidate));
        assert.ok(!(await api('/api/education/groups/teachers?businessContext=maysternya_doli')).teachers.some(t=>t.id===candidate));
        if(!reader) {
            reader={username:'edu_observer_'+crypto.randomBytes(12).toString('hex'),password:crypto.randomBytes(24).toString('base64url')};
            await api('/api/users','POST',{username:reader.username,password:reader.password,name:'Спостерігач викладачів',role:'director',pageAllowlist:['/'],businessContexts:['dar'],defaultBusinessContext:'dar',actionDenylist:['hr.staff.manage','create_booking','edit_booking','manage_settings']});
            const observerId=(await pool.query('SELECT id FROM users WHERE username=$1',[reader.username])).rows[0].id;
            await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'member')",[org,observerId]);
            const darId=(await pool.query("SELECT id FROM businesses WHERE context_key='dar'")).rows[0].id;
            await pool.query("INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default,action_denylist) VALUES ($1,$2,$3,'director',true,$4)",[darId,org,observerId,['hr.staff.manage','create_booking','edit_booking','manage_settings']]);
            const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:reader.username,password:reader.password})});assert.equal(login.status,200);const auth=await login.json();reader.token=auth.accessToken||auth.token;
        }
        const denied=await fetch(base+`/api/hr/staff/${candidate}/education-memberships?businessContext=event_genix`,{method:'POST',headers:{Authorization:'Bearer '+reader.token,'Content-Type':'application/json'},body:JSON.stringify({educationBusinessContext:'dar',confirmAssignment:true})});assert.equal(denied.status,403);
        await api(`/api/hr/staff/${candidate}/education-memberships?businessContext=dar`,'POST',{educationBusinessContext:'dar',confirmAssignment:true},403);
        await api(`/api/hr/staff/${candidate}/education-memberships?businessContext=event_genix`,'POST',{educationBusinessContext:'dar',confirmAssignment:false},400);
        const inactive=(await pool.query("INSERT INTO staff(name,department,position,is_active) VALUES ('Галина Соколова','education','Музика',false) RETURNING id")).rows[0].id;
        await api(`/api/hr/staff/${inactive}/education-memberships?businessContext=event_genix`,'POST',{educationBusinessContext:'dar',confirmAssignment:true},409);
        assert.equal((await pool.query('SELECT count(*)::int n FROM education_teacher_memberships WHERE staff_id=$1',[inactive])).rows[0].n,0);
        // Independent negative target policy: this actor can manage source HR but cannot create in Dar.
        const observerId=(await pool.query('SELECT id FROM users WHERE username=$1',[reader.username])).rows[0].id;
        if(!(await pool.query('SELECT 1 FROM organization_memberships WHERE user_id=$1',[observerId])).rowCount)await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'member')",[org,observerId]);
        const businessRows=(await pool.query('SELECT id,context_key FROM businesses WHERE organization_id=$1',[org])).rows;
        for(const business of businessRows.filter(b=>['event_genix','dar'].includes(b.context_key)))await pool.query("INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default,action_denylist) VALUES ($1,$2,$3,'director',false,$4) ON CONFLICT (business_id,user_id) DO UPDATE SET role='director',action_denylist=EXCLUDED.action_denylist",[business.id,org,observerId,business.context_key==='dar'?['create_booking']:[]]);
        const targetList=await fetch(base+'/api/hr/staff/'+candidate+'/education-businesses?businessContext=event_genix',{headers:{Authorization:'Bearer '+reader.token}});assert.equal(targetList.status,200);assert.ok(!(await targetList.json()).data.targets.some(t=>t.context==='dar'));
        const membershipBefore=(await pool.query('SELECT * FROM education_teacher_memberships ORDER BY business_context,staff_id')).rows;
        const targetDenied=await fetch(base+'/api/hr/staff/'+candidate+'/education-memberships?businessContext=event_genix',{method:'POST',headers:{Authorization:'Bearer '+reader.token,'Content-Type':'application/json'},body:JSON.stringify({educationBusinessContext:'dar',confirmAssignment:true})});assert.equal(targetDenied.status,403);
        assert.deepEqual((await pool.query('SELECT * FROM education_teacher_memberships ORDER BY business_context,staff_id')).rows,membershipBefore);
        evidence.proofs.hrTargetWriteDenied={sourceHRManageAllowed:true,targetOmitted:true,directID403:true,allMembershipsUnchanged:true};
        const concurrentStaff=(await pool.query("INSERT INTO staff(name,department,position,is_active) VALUES ('Дмитро Вербицький','education','Музика',true) RETURNING id")).rows[0].id;
        const concurrentBefore=(await pool.query('SELECT count(*)::int n FROM staff')).rows[0].n;
        const concurrent=await Promise.all([1,2].map(()=>fetch(base+'/api/hr/staff/'+concurrentStaff+'/education-memberships?businessContext=event_genix',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({educationBusinessContext:'dar',confirmAssignment:true})})));
        assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,201]);assert.equal((await pool.query('SELECT count(*)::int n FROM education_teacher_memberships WHERE staff_id=$1',[concurrentStaff])).rows[0].n,1);assert.equal((await pool.query("SELECT count(*)::int n FROM hr_audit_log WHERE staff_id=$1 AND action='education_teacher_assign'",[concurrentStaff])).rows[0].n,1);assert.equal((await pool.query('SELECT count(*)::int n FROM staff')).rows[0].n,concurrentBefore);
        await pool.query("INSERT INTO education_teacher_memberships(business_context,staff_id,is_active) VALUES ('maysternya_doli',$1,false)",[candidate]);
        const inactiveMembership=(await pool.query("SELECT * FROM education_teacher_memberships WHERE business_context='maysternya_doli' AND staff_id=$1",[candidate])).rows[0];
        await api('/api/hr/staff/'+candidate+'/education-memberships?businessContext=event_genix','POST',{educationBusinessContext:'maysternya_doli',confirmAssignment:true},409);
        assert.deepEqual((await pool.query("SELECT * FROM education_teacher_memberships WHERE business_context='maysternya_doli' AND staff_id=$1",[candidate])).rows[0],inactiveMembership);
        evidence.proofs.hrConcurrencyAndInactive={classification:'HTTP_SQL',twoFirstAssignments:[200,201],membershipCount:1,auditCount:1,noDuplicateStaff:true,inactiveMembership409Unchanged:true};
        evidence.proofs.hrLinkWorkflow={status:'PASS_VISIBLE_UI_API_SQL',staffId:candidate,rows,audit,idempotent:true,noDuplicateStaff:true,unlinkedSecondBusinessHidden:true,educatorDenied:true,inactiveDenied:true};
        assert.equal(await page.locator('#staffEducationRetry').isVisible(),false);
        for(const theme of ['light','dark']) {
            await page.locator('#editCloseTop').click();await page.locator('#staffEditModal').waitFor({state:'hidden'});await page.setViewportSize({width:390,height:844});
            if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.locator('#headerThemeToggle').click();await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
            await page.goto(base+'/hr.html?businessContext=event_genix&employee='+candidate,{waitUntil:'domcontentloaded'});await page.locator('#staffEducationAssignment').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('staffEducationBusiness').disabled);await page.locator('#staffEducationBusiness').selectOption('dar');
            await page.locator('#staffEducationAssignment').scrollIntoViewIfNeeded();await measureContrast(page,'hr-education-phone-'+theme);
            const audit=evidence.audits.at(-1);assert.ok(audit.contrast.length>0);assert.deepEqual(audit.contrast.filter(c=>!Number.isFinite(c.ratio)||c.ratio<c.minimum),[],'New HR education controls contrast');
            assert.equal(await page.locator('#staffEducationAssignment').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await shot(page,'existing-hr-assignment-phone-'+theme);
        }
        await page.setViewportSize({width:1440,height:1000});await shot(page,'existing-hr-staff-explicit-education-assignment');
        await page.locator('#editCloseTop').click();await page.locator('#staffEditModal').waitFor({state:'hidden'});
        await Promise.all([page.waitForURL(url=>url.searchParams.get('businessContext')==='dar',{waitUntil:'domcontentloaded'}),page.locator('#sidebarBusinessContextSelect').selectOption('dar')]);await waitTeacherRuntimeReads(page);
        await page.goto(base+'/?businessContext=dar&educationSchedule=groups&date='+manifest.anchorDate,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.EducationGroups?.state.teacherStatus==='ready');
        await page.locator('#educationGroupsList').selectOption('');await page.locator('#educationGroupName').fill('Музика: перші ритми');await page.locator('#educationGroupTeacher').selectOption(String(candidate));
        const assignedGroup=await saveGroupUI(page);assert.equal((await pool.query('SELECT teacher_id FROM education_groups WHERE id=$1',[assignedGroup])).rows[0].teacher_id,candidate);
    }));

    await check('close-card-nonempty-package-preserved-visible-UI-SQL',()=>pageFor(async page=>{
        const id=manifest.ids.bookings['robots-4'];
        // Independent prerequisite: a supported education booking with genuine financial/package data.
        await pool.query("UPDATE bookings SET price=250,extra_data=jsonb_set(extra_data,'{bookingPackage}',$2::jsonb) WHERE id=$1",[id,JSON.stringify({schemaVersion:1,programBasePrice:250,finalTotal:250,notes:'Погоджені матеріали для майстерні',menuPositions:[],serviceEvents:[]})]);
        const before=(await pool.query('SELECT to_jsonb(b) row FROM bookings b WHERE id=$1',[id])).rows[0].row;
        await openLesson(page,id);const packageRoot=page.locator('#bookingDetails .booking-detail-package');assert.equal(await packageRoot.isVisible(),true);assert.match(await packageRoot.innerText(),/250/);assert.equal(await page.locator('#bookingDetails > .event-card-visual').count(),0);
        assert.deepEqual((await pool.query('SELECT to_jsonb(b) row FROM bookings b WHERE id=$1',[id])).rows[0].row,before);await shot(page,'education-card-supported-financial-data');
    }));

    await check('close01-legacy-no-ID-name-fallback-HTTP-SQL',async()=>{
        const source=(await api(`/api/bookings/detail/${closeFirst}?businessContext=dar`)).booking;
        // SQL prerequisite: historical name-only snapshot. No failed UI action is repaired.
        await pool.query("UPDATE bookings SET extra_data=jsonb_set(extra_data,'{educationLesson,teacherName}',to_jsonb($2::text)) #- '{educationLesson,teacherId}' #- '{education_lesson,teacherId}' #- '{bookingWorkspace,lesson,teacherId}' WHERE id=$1",[closeFirst,'марія п’ятницька']);
        const before=(await pool.query('SELECT count(*)::int n FROM bookings')).rows[0].n;
        await api('/api/bookings?businessContext=dar','POST',{...source,id:undefined,lineId:'edu-cabinet-3',room:'Кабінет 3',extraData:{...source.extraData,educationLesson:{...source.extraData.educationLesson,teacherId:String(closeTeacherB),teacherName:'марія п’ятницька'}}},409);
        assert.equal((await pool.query('SELECT count(*)::int n FROM bookings')).rows[0].n,before);
    });
}

(async()=>{
    await check('fixtures',async()=>{
        const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.TEST_USER,password:process.env.TEST_PASS})});
        assert.equal(res.status,200);const auth=await res.json();token=auth.accessToken||auth.token;
        if (phase!=='baseline') {
            assert.equal((await pool.query('SELECT count(*)::int n FROM education_teacher_memberships')).rows[0].n,0,'Migration must not backfill memberships');
            evidence.proofs.emptyMigrationTable=true; evidence.proofs.databaseLocale=(await pool.query("SELECT datcollate,datctype FROM pg_database WHERE datname=current_database()")).rows[0];
        }
        manifest=(await seedDataset(pool,'fixed')).manifest;
        for(const businessContext of ['dar','maysternya_doli'])await api(`/api/business/cabinet?businessContext=${businessContext}`,'PUT',{businessType:'education',timelineMode:'education',resourceModel:'cabinet'});
        candidate=(await pool.query("INSERT INTO staff(name,department,position,is_active) VALUES ('Наталія Олійник','education','Музика',true) RETURNING id")).rows[0].id;
        evidence.proofs.candidate={id:candidate,name:'Наталія Олійник',groupCount:(await pool.query('SELECT count(*)::int n FROM education_groups WHERE teacher_id=$1',[candidate])).rows[0].n};
        assert.equal(evidence.proofs.candidate.groupCount,0);
    });
    if(!manifest)return;
    browser=await browserType.launch({headless:true});
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
        if(process.env.EDU_CLOSE_ONLY==='true'){ groupId=manifest.ids.groups.english; await closeChecks(); }
        else { await finalChecks(); await closeChecks(); }
    }
    await check('page-errors',()=>assert.deepEqual(evidence.pageErrors,[]));
})().catch(e=>{evidence.fatal=e.message;process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await pool.end();evidence.exitCode=process.exitCode||results.exitCode();process.exitCode=evidence.exitCode;flush();console.log(`Evidence: ${path.relative(process.cwd(),out)}; exit=${evidence.exitCode}`);});




