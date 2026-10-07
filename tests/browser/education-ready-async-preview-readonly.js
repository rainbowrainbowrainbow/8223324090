'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {Pool}=require('pg');
const {chromium}=require(process.env.EDU_QA_PLAYWRIGHT);
const {DATABASES,OWNER_KEY,preflight}=require('../../scripts/lib/education-ready-dataset');
const base='http://127.0.0.1:3012',out=path.resolve('output/education-ready/05/preview-readonly');fs.mkdirSync(out,{recursive:true});
const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.demo,ssl:false});
const evidence={status:'NOT RUN',blockedWrites:[],screenshots:[],pageErrors:[],scope:'Retained synthetic preview; all business writes blocked before login'};let browser;
async function proof(){const manifest=JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1',[OWNER_KEY])).rows[0].value);return{manifest,preflight:await preflight(pool,manifest)};}
(async()=>{
    assert.ok(process.env.LIVE_CREATOR_USER&&process.env.LIVE_CREATOR_PASS,'Private credentials unavailable');
    const before=await proof();browser=await chromium.launch({headless:true});
    const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Kyiv',viewport:{width:1440,height:1000}});
    await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();
        if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!/^\/api\/auth\/(login|refresh|verify)$/.test(url.pathname)){evidence.blockedWrites.push({method:req.method(),path:url.pathname});return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Read-only preview boundary'})});}return route.continue();});
    if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>socket.close());
    const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>evidence.pageErrors.push(error.name));
    await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#username').fill(process.env.LIVE_CREATOR_USER);await page.locator('#password').fill(process.env.LIVE_CREATOR_PASS);
    await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
    async function shots(view){for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(()=>document.fonts.ready);
        assert.ok(!(await page.locator('body').innerText()).includes(process.env.LIVE_CREATOR_USER));const file=`${view}-${width}.png`;await page.screenshot({path:path.join(out,file)});evidence.screenshots.push(file);}}
    await page.goto(`${base}/?businessContext=dar&educationSchedule=today&date=${before.manifest.anchorDate}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.EducationScheduleWorkspace?.state.loading===false&&document.querySelectorAll('[data-education-booking-id]').length===4);evidence.todayCards=4;await shots('today');
    const date=before.manifest.plan.lessons.find(l=>l.key==='english-3').date,id=before.manifest.ids.bookings['english-3'];
    await page.goto(`${base}/?businessContext=dar&educationSchedule=attendance&educationAttendanceDate=${date}&date=${before.manifest.anchorDate}`,{waitUntil:'domcontentloaded'});
    await page.locator(`#educationAttendanceLesson option[value="${id}"]`).waitFor({state:'attached'});await page.locator('#educationAttendanceLesson').selectOption(id);
    await page.waitForFunction(()=>window.EducationAttendance?.state.journal&&!window.EducationAttendance.state.journalLoading&&!window.EducationAttendance.state.loading);
    const reply=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/education/attendance/${id}`);await page.locator('#educationAttendanceReload').click();const refreshed=await reply;assert.equal(refreshed.status(),200);await refreshed.finished();
    await page.waitForFunction(()=>!window.EducationAttendance.state.journalLoading&&!window.EducationAttendance.state.loading);evidence.journalMembers=await page.locator('[data-attendance-child-id]').count();assert.equal(evidence.journalMembers,6);await shots('journal');
    for(const reload of [false,true]){
        const report=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/education/reports'&&r.status()===200);
        if(reload)await page.reload({waitUntil:'domcontentloaded'});else await page.goto(`${base}/?businessContext=dar&educationSchedule=reports&date=${before.manifest.anchorDate}`,{waitUntil:'domcontentloaded'});
        const response=await report;await response.finished();await page.waitForFunction(()=>!window.EducationAttendance?.state.reportLoading&&document.querySelector('.education-report-summary'));
        const summary=(await response.json()).report.summary;assert.deepEqual(await page.locator('.education-report-summary strong').allTextContents(),Object.values(summary).map(String));evidence[reload?'reportReload':'reportDirect']=summary;
    }
    await shots('report');await context.close();const after=await proof();assert.deepEqual(after,before);assert.deepEqual(evidence.pageErrors,[]);
    evidence.preflight=after.preflight;evidence.retainedDatasetUnchanged=true;evidence.status='PASS';
})().catch(error=>{evidence.status='FAIL';evidence.error=error.message;process.exitCode=1;}).finally(async()=>{await browser?.close();await pool.end();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(evidence,null,2));console.log(`Async retained preview ${evidence.status}; business writes blocked`);});
