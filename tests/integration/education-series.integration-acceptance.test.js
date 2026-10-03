'use strict';
const { before, after, test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { initializeTimelineResources } = require('../../services/timelineResources');
function requirePlaywright() {
  if (process.env.EDU_QA_PLAYWRIGHT) return require(process.env.EDU_QA_PLAYWRIGHT);
  try { return require('playwright'); } catch {}
  for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const normalized = entry.replace(/[\\/]+$/, '');
    if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
    const packageDir = path.join(path.dirname(normalized), 'playwright');
    if (fs.existsSync(packageDir)) return require(packageDir);
  }
  throw new Error('Playwright is unavailable; run through npm run test:integration:education-series:isolated');
}
const enabled = process.env.RUN_EDUCATION_SERIES_INTEGRATION === 'true';
let pool, token, groupId, childIds, teacherIds, lessonId, readerToken, readerCredentials;
async function request(method, pathname, body, auth = token) {
  const r = await fetch(process.env.TEST_URL + pathname, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => ({}));
  if (r.status >= 400) console.log(JSON.stringify({ method, path: pathname, status: r.status, error: data.error }));
  return { status: r.status, data };
}
function lesson(date, time = '09:00', cabinet = 1, teacher = teacherIds?.[0]) {
  return { date, time, duration: 45, lineId: `edu-cabinet-${cabinet}`, room: `Кабінет ${cabinet}`, label: 'Заняття', category: 'education', kidsCount: 3, skipNotification: true,
    extraData: { educationLesson: { mode: 'education_lesson', title: `QA Lesson ${date} ${time}`, groupId, teacherId: String(teacher), teacherName: `QA Teacher ${teacher}` } } };
}
const booking = b => request('POST', '/api/bookings?businessContext=dar', b);
describe('EDU-QA-01 extended real PostgreSQL and actual-app browser', { skip: !enabled, concurrency: 1 }, () => {
  before(async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    fs.mkdirSync(path.join('output', 'edu-qa-01'), { recursive: true });
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
    pool = new Pool({ connectionString: target.url.toString(), ssl: false });
    await pool.query(`INSERT INTO settings (key,value) VALUES ('timeline_display:dar', $1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ mode: 'education' })]);
    await initializeTimelineResources(pool, 'dar', { types: ['cabinet'] });
    const login = await request('POST', '/api/auth/login', { username: process.env.TEST_USER, password: process.env.TEST_PASS }, '');
    assert.equal(login.status, 200, 'synthetic login'); token = login.data.accessToken || login.data.token;
    const cabinet = await request('PUT','/api/business/cabinet?businessContext=dar',{businessType:'education',timelineMode:'education',resourceModel:'cabinet'});
    assert.equal(cabinet.status,200,'disposable business profile education setup');
    assert.equal(cabinet.data.cabinet.timeline.resourceModel,'cabinet','fixture matches the live cabinet model');
    teacherIds = (await pool.query(`INSERT INTO staff (name,department,position,is_active) VALUES ('QA Teacher A','education','teacher',true),('QA Teacher B','education','teacher',true) RETURNING id`)).rows.map(r => r.id);
    const parent = (await pool.query(`INSERT INTO customers (business_context,name,source) VALUES ('dar','QA synthetic parent','education_test') RETURNING id`)).rows[0].id;
    childIds = (await pool.query(`INSERT INTO customer_children (business_context,customer_id,name,source_kind) VALUES ('dar',$1,'QA Child A','education_test'),('dar',$1,'QA Child B','education_test'),('dar',$1,'QA Child C','education_test') RETURNING id`, [parent])).rows.map(r => Number(r.id));
    const group = await request('POST','/api/education/groups?businessContext=dar',{name:'QA main group', capacity:4, teacherId:teacherIds[0]});
    assert.equal(group.status,201); groupId = Number(group.data.group.id);
    for (const childId of childIds) assert.equal((await request('POST',`/api/education/groups/${groupId}/members?businessContext=dar`,{childId,startDate:'2026-01-01'})).status,201);
  });
  after(async () => { await pool?.end(); });
  test('group edits, empty journal, full capacity and foreign lesson IDs', async () => {
    const edited = await request('PUT',`/api/education/groups/${groupId}?businessContext=dar`,{name:'QA main group edited',capacity:4,teacherId:teacherIds[1]});
    assert.equal(edited.status,200); assert.equal(edited.data.group.teacher_id,teacherIds[1]);
    const empty = await request('POST','/api/education/groups?businessContext=dar',{name:'QA empty group',capacity:2});
    const b = lesson('2026-12-02'); b.extraData.educationLesson.groupId=empty.data.group.id;
    const created = await booking(b); assert.equal(created.status,200);
    const endpoint = `/api/education/attendance/${created.data.booking.id}?businessContext=dar`;
    assert.equal((await request('GET',endpoint)).data.journal.members.length,0);
    assert.equal((await request('PUT',endpoint,{marks:[]})).status,409);
    const over = lesson('2026-12-03'); over.kidsCount=9;
    assert.equal((await booking(over)).status,409,'cabinet 1 capacity 8');
    const foreign = await request('GET',`/api/education/attendance/${created.data.booking.id}?businessContext=event_genix`);
    assert.ok([403,404].includes(foreign.status));
  });
  test('same-slot requests serialize; adjacent lessons remain valid', async () => {
    const b = lesson('2026-12-05');
    const results = await Promise.all([booking(b),booking(b)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM bookings WHERE business_context='dar' AND date=$1 AND time='09:00'`,[b.date])).rows[0].n,1);
    assert.equal((await booking(lesson(b.date,'09:45'))).status,200);
  });
  test('one teacher across concurrent different cabinets has one winner', async () => {
    const trials=[];
    for (let i=0;i<6;i++) {
      const date=`2027-02-${String(10+i).padStart(2,'0')}`;
      const results=await Promise.all([booking(lesson(date,'09:00',1)),booking(lesson(date,'09:00',2))]);
      const rows=(await pool.query(`SELECT count(*)::int n FROM bookings WHERE business_context='dar' AND date=$1 AND time='09:00'`,[date])).rows[0].n;
      trials.push({date,statuses:results.map(r=>r.status).sort(),rows});
    }
    const sequentialDate='2027-02-20';
    const first=await booking(lesson(sequentialDate,'09:00',1));
    const second=await booking(lesson(sequentialDate,'09:00',2));
    const evidence={trials,sequential:[first.status,second.status]};
    fs.writeFileSync('output/edu-qa-01/teacher-concurrency.json',JSON.stringify(evidence,null,2));
    assert.deepEqual(evidence.sequential,[200,409],'sequential conflict control');
    assert.ok(trials.every(r=>r.statuses.join(',')==='200,409'&&r.rows===1),'concurrent teacher conflicts: '+JSON.stringify(trials));
  });
  test('series retain wall clock across month/year and both Kyiv DST boundaries', async () => {
    for (const [date,repeatEvery,expected] of [
      ['2026-12-31','daily',['2026-12-31','2027-01-01','2027-01-02']],
      ['2027-03-21','weekly',['2027-03-21','2027-03-28','2027-04-04']],
      ['2026-10-18','weekly',['2026-10-18','2026-10-25','2026-11-01']],
      ['2026-12-25','biweekly',['2026-12-25','2027-01-08','2027-01-22']]
    ]) {
      const b=lesson(date,'14:15',3); Object.assign(b.extraData.educationLesson,{seriesSize:3,repeatEvery});
      const created=await request('POST','/api/bookings/education-series?businessContext=dar',{booking:b});
      assert.equal(created.status,200); assert.deepEqual(created.data.bookings.map(b=>b.date),expected);
      assert.ok(created.data.bookings.every(b=>b.time==='14:15'));
    }
  });
  test('all marks, author/time, opposite concurrent corrections and manually calculated report', async () => {
    const created=await booking(lesson('2026-12-10','11:00',2)); assert.equal(created.status,200); lessonId=created.data.booking.id;
    const ep=`/api/education/attendance/${lessonId}?businessContext=dar`;
    const marks=childIds.map((childId,i)=>({childId,status:['present','absent','excused'][i]}));
    const saved=await request('PUT',ep,{marks}); assert.equal(saved.status,200); assert.equal(saved.data.changes,3);
    assert.equal((await request('PUT',ep,{marks})).data.changes,0);
    const race=await Promise.all(['absent','excused'].map(status=>request('PUT',ep,{marks:[{childId:childIds[0],status}]})));
    assert.ok(race.every(r=>r.status===200));
    const journal=(await request('GET',ep)).data.journal;
    const a=journal.members.find(m=>Number(m.child_id)===childIds[0]);
    assert.equal(a.history.length,3); assert.ok(a.history.every(h=>h.changed_by && h.changed_at));
    const dbHistory=await pool.query(`SELECT previous_status,new_status FROM education_attendance_history WHERE attendance_id=$1 ORDER BY id`,[a.id]);
    for(let i=1;i<dbHistory.rows.length;i++) assert.equal(dbHistory.rows[i].previous_status,dbHistory.rows[i-1].new_status);
    await request('PUT',ep,{marks:[{childId:childIds[0],status:'present'}]});
    // Disposable-only clock fixture: keep the frozen journal's date consistent.
    await pool.query(`UPDATE bookings SET date='2026-09-28' WHERE id=$1`,[lessonId]);
    await pool.query(`UPDATE education_attendance SET lesson_date='2026-09-28' WHERE booking_id=$1`,[lessonId]);
    const report=(await request('GET',`/api/education/reports?businessContext=dar&groupId=${groupId}&from=2026-09-28&to=2026-09-28`)).data.report;
    assert.deepEqual(report.summary,{held:1,cancelled:0,scheduled:0,journalsNotStarted:0,present:1,absent:1,excused:1,unmarked:0});
    assert.equal((await request('PUT',ep,{marks:[{childId:childIds[1],status:null}]})).status,200);
    const cleared=(await request('GET',ep)).data.journal.members.find(m=>Number(m.child_id)===childIds[1]);
    assert.equal(cleared.status,null); assert.equal(cleared.history.length,2);
  });
  test('reader cannot manage settings or mutate education through direct API', async () => {
    const username=`eduqa_reader_${Date.now()}`,password=crypto.randomBytes(24).toString('base64url');
    const created=await request('POST','/api/users',{username,password,name:'QA Education Reader',role:'director',pageAllowlist:['/','/timeline-settings'],businessContexts:['dar'],defaultBusinessContext:'dar',actionDenylist:['manage_settings','create_booking','edit_booking','delete_booking']});
    assert.equal(created.status,200,`disposable reader creation: ${created.data.error || ''}`);
    const login=await request('POST','/api/auth/login',{username,password},''); assert.equal(login.status,200); readerToken=login.data.accessToken||login.data.token; readerCredentials={username,password};
    for(const [method,url,body] of [
      ['PUT','/api/business/cabinet?businessContext=dar',{businessType:'simple'}],
      ['POST','/api/education/groups?businessContext=dar',{name:'QA denied',capacity:2}],
      ['PUT',`/api/education/attendance/${lessonId}?businessContext=dar`,{marks:[]}],
      ['GET','/api/education/groups?businessContext=event_genix',undefined]
    ]) assert.equal((await request(method,url,body,readerToken)).status,403,`${method} ${url}`);
    for(const url of ['/api/education/groups?businessContext=dar',`/api/education/reports?businessContext=dar&from=2026-09-28&to=2026-09-28`]) assert.equal((await request('GET',url,undefined,readerToken)).status,200,url);
  });
  test('two independent group POST requests follow the existing API contract', async () => {
    const body={name:'QA repeat same group',capacity:3};
    const results=await Promise.all([request('POST','/api/education/groups?businessContext=dar',body),request('POST','/api/education/groups?businessContext=dar',body)]);
    assert.ok(results.every(r=>r.status===201));
    const rows=await pool.query(`SELECT count(*)::int n FROM education_groups WHERE business_context='dar' AND name=$1`,[body.name]);
    assert.equal(rows.rows[0].n,2,'two independent POST requests create two groups under the current API contract');
  });
  test('actual-app UI groups/attendance/report and mobile/light/dark, errors preserve draft', async () => {
    const { chromium }=requirePlaywright();
    const browser=await chromium.launch({headless:true}); const evidence={checks:[],errors:[],failed:[]};
    const check=(name,pass,detail)=>{evidence.checks.push({name,status:pass?'PASS':'FAIL',detail}); fs.writeFileSync('output/edu-qa-01/synthetic-browser.json',JSON.stringify(evidence,null,2));};
    try {
      const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
      await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(process.env.TEST_URL).origin?route.continue():route.abort());
      const page=await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000); page.on('pageerror',e=>evidence.errors.push(e.message));
      page.on('response',r=>{if(r.status()>=400 && new URL(r.url()).pathname.startsWith('/api/education')) evidence.failed.push({path:new URL(r.url()).pathname,status:r.status()});});
      await page.goto(process.env.TEST_URL+'/',{waitUntil:'domcontentloaded'});
      await page.locator('#username').fill(process.env.TEST_USER); await page.locator('#password').fill(process.env.TEST_PASS); await page.locator('#loginForm button[type="submit"]').click();
      await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
      await page.goto(process.env.TEST_URL+'/?businessContext=dar&educationSchedule=groups',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2000);
      check('direct groups route',await page.locator('#educationGroupsPanel').isVisible(),new URL(page.url()).search);
      await page.locator('[data-education-schedule-tab="groups"]').click(); await page.waitForTimeout(500);
      await page.locator('#educationGroupName').fill('QA UI synthetic group'); await page.locator('#educationGroupCapacity').fill('3');
      await page.locator('#educationGroupForm button[type="submit"]').click();
      await page.waitForFunction(()=>document.getElementById('educationGroupsStatus').textContent.includes('збережено'));
      const uiGroupId=await page.locator('#educationGroupsList').inputValue(); check('group created through UI',Number(uiGroupId)>0);
      await page.locator('#educationChildSearch').fill('QA Child A'); await page.locator('#educationChildFind').click();
      await page.waitForFunction(()=>document.getElementById('educationChildSelect').options.length>1);
      await page.locator('#educationChildSelect').selectOption(String(childIds[0])); await page.locator('#educationMemberStart').fill('2026-01-01');
      await page.locator('#educationGroupEnrollForm button[type="submit"]').click(); await page.waitForTimeout(600);
      check('child enrolled through UI',(await request('GET',`/api/education/groups/${uiGroupId}?businessContext=dar`)).data.group.members.length===1);
      const b=lesson('2026-12-15','12:00',1,teacherIds[1]); b.extraData.educationLesson.groupId=Number(uiGroupId);
      const created=await booking(b); assert.equal(created.status,200); const id=created.data.booking.id;
      await page.goto(process.env.TEST_URL+`/?businessContext=dar&date=${b.date}`,{waitUntil:'domcontentloaded'});
      await page.locator('[data-education-schedule-tab="today"]').click();
      await page.locator(`[data-education-booking-id="${id}"]`).waitFor({state:'visible',timeout:20000});
      const card=page.locator(`[data-education-booking-id="${id}"]`);
      check('Today lesson time and group match API',(await card.textContent()).includes('12:00') && (await card.textContent()).includes('QA UI synthetic group'));
      await card.click(); await page.locator('#bookingModal').waitFor({state:'visible'});
      const detail=await page.locator('#bookingDetails').textContent();
      check('canonical lesson details match API',detail.includes(b.extraData.educationLesson.title) && detail.includes('12:00') && detail.includes('45') && detail.includes('QA UI synthetic group') && detail.includes('Кабінет 1'),{title:true,time:detail.includes('12:00'),duration:detail.includes('45'),group:detail.includes('QA UI synthetic group'),cabinet:detail.includes('Кабінет 1')});
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      check('canonical modal Escape closes',!await page.locator('#bookingModal').isVisible());
      if(await page.locator('#bookingModal').isVisible()) await page.locator('#bookingModal .modal-close').click();
      await page.locator('[data-education-schedule-tab="schedule"]').click();
      check('day grid includes canonical lesson',await page.locator(`.booking-block[data-booking-id="${id}"]`).count()>0);
      try {
        await page.locator(`.booking-block[data-booking-id="${id}"]`).first().click({timeout:5000});
        await page.locator('#bookingModal').waitFor({state:'visible',timeout:5000});
        check('day grid click opens canonical details',(await page.locator('#bookingDetails').textContent()).includes(b.extraData.educationLesson.title));
        await page.locator('#bookingModal .modal-close').click();
        await page.locator('#timelineViewPanelToggle').click();
        await page.locator('[data-schedule-view-mode="week"]').click();
        await page.waitForTimeout(1000);
        check('week mode selected',await page.locator('[data-schedule-view-mode="week"]').getAttribute('aria-pressed')==='true');
        const weekCard=page.locator(`[data-booking-id="${id}"]`).filter({visible:true}).first();
        await weekCard.click({timeout:5000});
        await page.locator('#bookingModal').waitFor({state:'visible',timeout:5000});
        check('week grid click opens canonical details',(await page.locator('#bookingDetails').textContent()).includes(b.extraData.educationLesson.title));
        await page.locator('#bookingModal .modal-close').click();
      } catch(e) { check('grid/week interaction completes',false,e.name); }
      if(await page.locator('#bookingModal').isVisible()) await page.locator('#bookingModal .modal-close').click();
      if(!await page.locator('[data-schedule-view-mode="day"]').isVisible()) await page.locator('#timelineViewPanelToggle').click();
      await page.locator('[data-schedule-view-mode="day"]').click();
      await page.locator('[data-education-schedule-tab="today"]').click();
      await page.locator('#educationScheduleGroupFilter').selectOption(String(uiGroupId));
      check('Today group filter keeps matching lesson',await card.isVisible());
      await page.locator('#educationScheduleGroupFilter').selectOption(String(groupId));
      check('Today group filter removes nonmatching lesson',await card.count()===0);
      await page.locator('#educationScheduleGroupFilter').selectOption('');
      await page.locator('#educationScheduleTeacherFilter').selectOption(String(teacherIds[1]));
      check('Today teacher filter keeps matching lesson',await card.isVisible());
      await page.locator('#educationScheduleTeacherFilter').selectOption('');
      await page.locator('#educationScheduleCabinetFilter').selectOption('Кабінет 1');
      check('Today cabinet filter keeps matching lesson',await card.isVisible());
      await page.locator('#educationScheduleCabinetFilter').selectOption('');
      await page.locator('[data-education-schedule-tab="attendance"]').click();
      await page.locator('#educationAttendanceDate').fill(b.date); await page.locator('#educationAttendanceDate').dispatchEvent('change');
      await page.waitForFunction(id=>[...document.getElementById('educationAttendanceLesson').options].some(o=>o.value===id),id);
      await page.locator('#educationAttendanceLesson').selectOption(id); await page.waitForSelector('[data-attendance-child-id]');
      await page.locator(`[data-attendance-child-id="${childIds[0]}"]`).selectOption('present'); await page.locator('#educationAttendanceSave').click();
      await page.waitForFunction(()=>document.getElementById('educationAttendanceStatus').textContent.includes('змінено'));
      check('journal saved through UI',(await request('GET',`/api/education/attendance/${id}?businessContext=dar`)).data.journal.members[0].status==='present');
      await page.locator('[data-education-schedule-tab="reports"]').click(); await page.locator('#educationReportFrom').fill('2026-09-28'); await page.locator('#educationReportTo').fill('2026-09-28'); await page.locator('#educationReportGroup').selectOption(String(groupId)); await page.locator('#educationReportRun').click(); await page.waitForTimeout(600);
      check('report API totals in UI',(await page.locator('#educationReportResult').textContent()).includes('Проведено: 1'));
      for(const [width,height] of [[1440,1000],[390,844]]) {
        await page.setViewportSize({width,height});
        for(const theme of ['light','dark']) {
          await page.evaluate(theme=>{document.documentElement.setAttribute('data-theme',theme);document.body.setAttribute('data-theme',theme);document.body.classList.toggle('dark-mode',theme==='dark');},theme);
          for(const tab of ['today','schedule','groups','attendance','reports']) {
            await page.locator(`[data-education-schedule-tab="${tab}"]`).click(); await page.waitForTimeout(100);
            check(`${width} ${theme} ${tab} width`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth})));
          }
        }
      }
      await page.setViewportSize({width:1440,height:1000}); await page.locator('[data-education-schedule-tab="groups"]').click(); await page.locator('#educationGroupsList').selectOption('');
      await page.locator('#educationGroupName').fill('QA retained draft');
      evidence.formBeforeErrors=await page.evaluate(()=>({currentGroup:window.EducationGroups.state.current?.id,valid:document.getElementById('educationGroupForm').checkValidity(),invalid:[...document.getElementById('educationGroupForm').elements].filter(e=>e.willValidate&&!e.validity.valid).map(e=>({id:e.id,message:e.validationMessage})),status:document.getElementById('educationGroupsStatus').textContent}));
      // Fault injection at the browser fetch boundary; count every injected response.
      await page.evaluate(()=>{window.__eduQaNativeFetch=window.fetch;window.__eduQaFault={status:0,delay:0,count:0};window.fetch=async function(input,init){const fault=window.__eduQaFault;const method=init?.method||'GET';if(['POST','PUT'].includes(method)&&new URL(String(input),location.origin).pathname.startsWith('/api/education/groups')){fault.count++;if(fault.status)return new Response(JSON.stringify({error:`QA ${fault.status}`}),{status:fault.status,headers:{'Content-Type':'application/json'}});if(fault.delay)await new Promise(resolve=>setTimeout(resolve,fault.delay));}return window.__eduQaNativeFetch.call(window,input,init);};});
      for(const status of [403,409,500]) {
        await page.evaluate(status=>{window.__eduQaFault.status=status;window.__eduQaFault.count=0;},status);
        await page.locator('#educationGroupForm button[type="submit"]').click();
        await page.waitForFunction(status=>document.getElementById('educationGroupsStatus').textContent===`QA ${status}`,status);
        const intercepted=await page.evaluate(()=>window.__eduQaFault.count);
        check(`group form retains draft on ${status}`,intercepted===1 && await page.locator('#educationGroupName').inputValue()==='QA retained draft',{intercepted});
      }
      await page.evaluate(()=>{window.fetch=window.__eduQaNativeFetch;});
      await page.locator('#educationGroupForm button[type="submit"]').click(); await page.waitForTimeout(500); check('group retry succeeds',await page.locator('#educationGroupsStatus').textContent()==='Групу збережено.');
      await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(1200); check('selected groups tab survives reload',await page.locator('#educationGroupsPanel').isVisible(),new URL(page.url()).search);
      // Capture only synthetic education panel, never credentials or the identity rail.
      await page.locator('[data-education-schedule-tab="groups"]').click(); await page.locator('#educationScheduleWorkspace').screenshot({path:'output/edu-qa-01/synthetic-groups-desktop.png'});
      await page.setViewportSize({width:390,height:844}); await page.locator('#educationScheduleWorkspace').screenshot({path:'output/edu-qa-01/synthetic-groups-mobile.png'});
      await page.keyboard.press('Tab'); check('keyboard reaches a control',await page.evaluate(()=>document.activeElement!==document.body));
      await page.setViewportSize({width:1440,height:1000});
      await page.locator('#educationGroupsList').selectOption(''); await page.locator('#educationGroupName').fill('QA actual double click');
      await page.evaluate(()=>{window.__eduQaSubmitCount=0;const nativeFetch=window.fetch;window.fetch=async function(input,init){if(init?.method==='POST'&&new URL(String(input),location.origin).pathname.startsWith('/api/education/groups')){window.__eduQaSubmitCount++;await new Promise(resolve=>setTimeout(resolve,500));}return nativeFetch.call(window,input,init);};});
      await page.locator('#educationGroupForm button[type="submit"]').dblclick(); await page.waitForTimeout(1800);
      const submitCount=await page.evaluate(()=>window.__eduQaSubmitCount);
      const duplicates=(await pool.query(`SELECT count(*)::int n FROM education_groups WHERE business_context='dar' AND name='QA actual double click'`)).rows[0].n;
      check('double click under slow network creates one group',duplicates===1,{submitCount,rows:duplicates});
    } finally { await browser.close(); fs.writeFileSync('output/edu-qa-01/synthetic-browser.json',JSON.stringify(evidence,null,2)); }
    assert.equal(evidence.errors.length,0,'actual-app uncaught errors');
    assert.equal(evidence.checks.filter(c=>c.status==='FAIL').length,0,'see sanitized synthetic-browser.json for actual-app failures');
  });
  test('actual-app group child lesson create edit and cancel through the booking form', async () => {
    const { chromium } = requirePlaywright();
    const parent = await pool.query("SELECT id FROM customers WHERE business_context='dar' AND name='QA synthetic parent' ORDER BY id DESC LIMIT 1");
    assert.equal(parent.rows.length, 1);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(process.env.TEST_URL).origin ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(process.env.TEST_URL + '/', { waitUntil: 'domcontentloaded' });
      await page.locator('#username').fill(process.env.TEST_USER);
      await page.locator('#password').fill(process.env.TEST_PASS);
      await page.locator('#loginForm button[type="submit"]').click();
      await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
      await page.goto(process.env.TEST_URL + '/?businessContext=dar&date=2027-06-15&educationSchedule=schedule', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.CrmBusinessContext?.profileFor?.('dar')?.timeline?.mode === 'education');
      const slot = page.locator('.grid-cell[data-time="12:00"][data-line="edu-cabinet-1"]').first();
      await slot.waitFor({ state: 'visible', timeout: 20000 });
      await slot.click();
      await page.locator('#bookingPanel').waitFor({ state: 'visible', timeout: 20000 });
      await page.evaluate(async customerId => {
        await selectCustomerFromSearch({ id: customerId, name: 'QA synthetic parent', source: 'education_test' });
      }, parent.rows[0].id);
      assert.equal(await page.evaluate(() => isEducationTimelineBookingMode()), true);
      await page.locator('#educationLessonTitle').fill('QA UI lifecycle lesson');
      await page.locator('#educationLessonGroupId').selectOption(String(groupId));
      const validation = await page.evaluate(() => { updateBookingSubmitState(); return window.BookingForm.validate(); });
      assert.equal(validation.valid, true, JSON.stringify(validation));
      const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/bookings(?:\/full|\/education-series)?$/.test(new URL(response.url()).pathname), { timeout: 20000 });
      await page.locator('#bookingSubmitBtn').click();
      assert.equal((await createdResponse).status(), 200, 'UI create request succeeds');
      const found = await pool.query("SELECT id FROM bookings WHERE business_context='dar' AND date='2027-06-15' AND program_name='QA UI lifecycle lesson' ORDER BY id DESC LIMIT 1");
      assert.equal(found.rows.length, 1, 'UI created one durable lesson');
      const id = String(found.rows[0].id);
      const detail = await request('GET', `/api/bookings/detail/${id}?businessContext=dar`);
      assert.equal(detail.status, 200);
      assert.equal(Number(detail.data.booking.extraData.educationLesson.groupId), Number(groupId));
      await page.goto(process.env.TEST_URL + '/?businessContext=dar&date=2027-06-15&educationSchedule=schedule', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.CrmBusinessContext?.profileFor?.('dar')?.timeline?.mode === 'education');
      await page.locator('.grid-cell[data-time="12:00"][data-line="edu-cabinet-1"]').first().waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForFunction(async bookingId => {
        if (timelineDateKey(AppState.selectedDate) !== '2027-06-15') return false;
        try {
          return (await getBookingsForDate(AppState.selectedDate)).some(booking => String(booking.id) === String(bookingId));
        } catch (error) {
          if (isTimelineStaleRequestError(error)) return false;
          throw error;
        }
      }, id, { timeout: 20000 });
      assert.equal(await page.evaluate(() => timelineDateKey(AppState.selectedDate)), '2027-06-15', 'edit stays on the selected lesson date');
      await page.evaluate(bookingId => editBooking(bookingId), id);
      await page.locator('#educationLessonTitle').waitFor({ state: 'visible', timeout: 20000 });
      await page.locator('#educationLessonTitle').fill('QA UI lifecycle lesson edited');
      const editedResponse = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.includes(`/api/bookings/${id}`), { timeout: 20000 });
      await page.locator('#bookingSubmitBtn').click();
      assert.equal((await editedResponse).status(), 200, 'UI edit request succeeds');
      const edited = await request('GET', `/api/bookings/detail/${id}?businessContext=dar`);
      assert.equal(edited.data.booking.extraData.educationLesson.title, 'QA UI lifecycle lesson edited');
      await page.evaluate(bookingId => { void deleteBooking(bookingId); }, id);
      await page.locator('#confirmModal').waitFor({ state: 'visible', timeout: 20000 });
      const cancelledResponse = page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname.includes(`/api/bookings/${id}`), { timeout: 20000 });
      await page.locator('#confirmYes').click();
      assert.equal((await cancelledResponse).status(), 200, 'UI cancel request succeeds');
      const cancelled = await pool.query('SELECT status FROM bookings WHERE id=$1', [id]);
      assert.equal(cancelled.rows[0].status, 'cancelled');
    } finally {
      await browser.close();
    }
  });
  test('Creator can stage settings while a reader cannot save via UI or API', async () => {
    const before = await request('GET', '/api/business/cabinet?businessContext=dar');
    assert.equal(before.status, 200);
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
      for (const actor of [
        { username: process.env.TEST_USER, password: process.env.TEST_PASS, canManage: true },
        { ...readerCredentials, canManage: false }
      ]) {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(process.env.TEST_URL).origin ? route.continue() : route.abort());
        const page = await context.newPage();
        await page.goto(process.env.TEST_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(actor.username);
        await page.locator('#password').fill(actor.password);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
        const documentResponse = await page.goto(process.env.TEST_URL + '/timeline-settings?businessContext=dar', { waitUntil: 'domcontentloaded' });
        if (!actor.canManage && documentResponse.status() === 403) {
          await context.close();
          continue;
        }
        assert.equal(documentResponse.status(), 200);
        await page.locator('[data-timeline-settings-tab="system"]').click();
        const mode = page.locator('[data-timeline-settings-display="mode"]');
        await mode.waitFor({ state: 'visible', timeout: 20000 });
        const current = await mode.inputValue();
        await mode.selectOption(current === 'education' ? 'simple' : 'education');
        assert.equal(await page.locator('#timelineSettingsSaveBtn').isDisabled(), !actor.canManage,
          `save affordance for ${actor.canManage ? 'Creator' : 'reader'}`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
    const after = await request('GET', '/api/business/cabinet?businessContext=dar');
    assert.equal(after.status, 200);
    assert.deepEqual(after.data.cabinet, before.data.cabinet, 'UI staging did not save the profile');
    assert.equal((await request('PUT', '/api/business/cabinet?businessContext=dar', { businessType: 'simple' }, readerToken)).status, 403);
  });

  test('Park booking uses the canonical detail modal and Escape focus return', async () => {
    const date = '2027-07-14';
    const availability = await request('GET', `/api/rooms/free/${date}/16:30/45?businessContext=event_genix`);
    assert.equal(availability.status, 200);
    const room = availability.data.rooms?.find(item => item.free && item.resourceId);
    assert.ok(room, 'an active free Park room exists');
    const lineId = 'qa-park-animator';
    await pool.query(`INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet)
      VALUES ('event_genix', $1, $2, 'QA Park Animator', '#14B8A6', false)
      ON CONFLICT (business_context, date, line_id) DO NOTHING`, [date, lineId]);
    const title = 'QA Park canonical detail';
    const created = await request('POST', '/api/bookings?businessContext=event_genix&timelineView=rooms', {
      date, time: '16:30', duration: 45, lineId, room: room.name, roomResourceId: room.resourceId,
      label: title, programName: title, category: 'animation', status: 'confirmed', skipNotification: true
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const id = String(created.data.booking.id);
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(process.env.TEST_URL).origin ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(process.env.TEST_URL + '/', { waitUntil: 'domcontentloaded' });
      await page.locator('#username').fill(process.env.TEST_USER);
      await page.locator('#password').fill(process.env.TEST_PASS);
      await page.locator('#loginForm button[type="submit"]').click();
      await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
      await page.goto(process.env.TEST_URL + `/?businessContext=event_genix&date=${date}&timelineView=rooms`, { waitUntil: 'domcontentloaded' });
      const card = page.locator(`[data-booking-id="${id}"]`).filter({ visible: true }).first();
      await card.waitFor({ state: 'visible', timeout: 20000 });
      await card.click();
      await page.locator('#bookingModal').waitFor({ state: 'visible' });
      assert.match(await page.locator('#bookingDetails').textContent(), /QA Park canonical detail/);
      await page.keyboard.press('Escape');
      await page.locator('#bookingModal').waitFor({ state: 'hidden' });
      assert.equal(await card.evaluate(node => document.activeElement === node), true, 'Park focus returns to card');
      assert.equal(await page.locator('#sidebarDesignExtras a[href*="educationSchedule"]').count(), 0, 'Park has no education entry');
    } finally {
      await browser.close();
    }
  });
});
