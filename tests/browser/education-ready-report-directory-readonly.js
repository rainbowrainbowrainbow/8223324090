'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {Pool}=require('pg');const {chromium}=require(process.env.EDU_QA_PLAYWRIGHT);
const {DATABASES,OWNER_KEY,preflight}=require('../../scripts/lib/education-ready-dataset');
const phase=process.env.EDU_DIRECTORY_PHASE||'postfix',base='http://127.0.0.1:3012',file=path.resolve(`output/education-ready/05/directory-${phase}.json`);
const result={phase,status:'NOT RUN',blockedWrites:[],pageErrors:[],policy:'Retained synthetic preview; business writes blocked before login; held real directory responses'};
const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.demo,ssl:false});let browser,release;const deliveries=[];
async function proof(){const manifest=JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1',[OWNER_KEY])).rows[0].value);return{manifest,preflight:await preflight(pool,manifest)};}
(async()=>{
    const before=await proof();assert.ok(process.env.LIVE_CREATOR_USER&&process.env.LIVE_CREATOR_PASS);browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Kyiv'});
    await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!/^\/api\/auth\/(login|refresh|verify)$/.test(url.pathname)){result.blockedWrites.push({method:req.method(),path:url.pathname});return route.abort();}return route.continue();});
    if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>socket.close());
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>result.pageErrors.push(error.name));
    await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#username').fill(process.env.LIVE_CREATOR_USER);await page.locator('#password').fill(process.env.LIVE_CREATOR_PASS);await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
    let arrived;const first=new Promise(done=>{arrived=done;}),gate=new Promise(done=>{release=done;});let holding=true;
    await page.route('**/api/education/groups?*',async route=>{
        if(!holding)return route.continue();const response=await route.fetch();const delivery=(async()=>{arrived();await gate;try{await route.fulfill({response});}catch{result.abortedHeldResponses=(result.abortedHeldResponses||0)+1;}})();deliveries.push(delivery);await delivery;
    });
    await page.goto(`${base}/?businessContext=dar&educationSchedule=reports&educationReportGroup=${before.manifest.ids.groups.english}&date=${before.manifest.anchorDate}`,{waitUntil:'domcontentloaded'});await first;
    await page.waitForFunction(()=>window.EducationScheduleWorkspace?.state.activeView==='reports'&&window.TimelineBusinessContext?.presentation?.().mode==='education');
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    result.pending=await page.evaluate(()=>({loading:window.EducationAttendance.state.reportLoading,status:document.getElementById('educationReportStatus').textContent,summary:Boolean(document.querySelector('.education-report-summary'))}));
    const started=Date.now();assert.equal(result.pending.loading,true,'A held directory read must have a visible loading state');assert.match(result.pending.status,/Завантажуємо/);
    await page.waitForFunction(()=>!window.EducationAttendance.state.reportLoading&&document.getElementById('educationReportStatus').textContent.includes('Не вдалося'),null,{timeout:25000});
    result.boundedErrorMs=Date.now()-started;assert.ok(result.boundedErrorMs<25000);result.terminal=await page.locator('#educationReportStatus').innerText();
    holding=false;release();await Promise.all(deliveries);const report=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/education/reports'&&r.status()===200);await page.reload({waitUntil:'domcontentloaded'});const response=await report;await response.finished();
    await page.waitForFunction(()=>!window.EducationAttendance.state.reportLoading&&document.querySelector('.education-report-summary'));
    const expected=(await response.json()).report.summary;assert.deepEqual(await page.locator('.education-report-summary strong').allTextContents(),Object.values(expected).map(String));assert.equal(await page.locator('#educationReportGroup').inputValue(),String(before.manifest.ids.groups.english));result.retrySummary=expected;
    assert.deepEqual(await proof(),before);result.retainedDatasetUnchanged=true;assert.deepEqual(result.pageErrors,[]);result.status='PASS';
})().catch(error=>{result.status='FAIL';result.error=error.message;process.exitCode=1;}).finally(async()=>{release?.();await browser?.close();await Promise.allSettled(deliveries);await pool.end();fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(`Read-only directory ${phase}: ${result.status}`);});
