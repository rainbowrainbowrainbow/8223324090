'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertLocalTarget, seedDataset, preflight } = require('../../scripts/lib/education-ready-dataset');
const { createResults } = require('../helpers/education-ready-results');
assertLocalTarget('fixed');
const base = process.env.TEST_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const engine = process.env.EDU_MOBILE_ENGINE || 'chromium';
const browserType = require(process.env.EDU_QA_PLAYWRIGHT)[engine];
const pool = new Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,ssl:false});
const out = path.resolve(process.env.EDU_READY_OUTPUT);
fs.mkdirSync(out,{recursive:true});
const results = createResults();
const evidence = {attemptId:process.env.EDU_CLOSE_ATTEMPT_ID,suite:process.env.EDU_CLOSE_SUITE,engine,checks:results.results,screenshots:[],pageErrors:[],geometry:[]};
const profiles = [
    ['desktop-1440',1440,1000],['phone-320',320,740],['phone-390',390,844],
    ['phone-landscape',844,390],['tablet-768',768,1024],['tablet-landscape',1024,768],['reflow-200',640,800]
];
let browser, manifest;
function flush(){fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(evidence,null,2));}
async function settleRuntime(page){await page.waitForFunction(()=>window.GlobalTaskTimer?.state.hydrated===true&&!window.GlobalTaskTimer.state.loading&&!window.GlobalTaskTimer.state.pendingHydrate&&!window.EducationScheduleWorkspace?.state.loading);await page.waitForLoadState('networkidle');}
async function check(id,action){await results.check(id,id,action,{dependsOn:id==='fixtures'?[]:['fixtures']});flush();console.log(results.results.at(-1).status+' '+id);}
(async()=>{
    await check('fixtures',async()=>{
        manifest=(await seedDataset(pool,'fixed')).manifest;
        const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.TEST_USER,password:process.env.TEST_PASS})});
        assert.equal(login.status,200); const auth=await login.json();
        const configured=await fetch(base+'/api/business/cabinet?businessContext=dar',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(auth.accessToken||auth.token)},body:JSON.stringify({businessType:'education',timelineMode:'education',resourceModel:'cabinet'})});
        assert.equal(configured.status,200,'Explicit synthetic education mode prerequisite');
        evidence.fixture={manifest,preflight:await preflight(pool,manifest)};
    });
    if(!manifest)return;
    browser=await browserType.launch({headless:true});evidence.browserVersion=browser.version();
    for(const [profile,width,height] of profiles)for(const theme of ['light','dark']){
        const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',timezoneId:'Europe/Kyiv'});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>socket.close());
        const page=await context.newPage();page.setDefaultTimeout(20000);
        page.on('pageerror',error=>evidence.pageErrors.push({name:error.name,message:error.message}));
        try{await check(profile+'-'+theme+'-time-controls-contained',async()=>{
            await page.goto(base,{waitUntil:'domcontentloaded'});
            await page.locator('#username').fill(process.env.TEST_USER);await page.locator('#password').fill(process.env.TEST_PASS);
            await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await settleRuntime(page);
            await page.goto(base+'/?businessContext=dar&educationSchedule=today&date='+manifest.anchorDate,{waitUntil:'domcontentloaded'});
            if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#headerThemeToggle').click();
            await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
            await page.locator('[data-education-booking-id="'+manifest.ids.bookings['robots-4']+'"]').click();
            await page.locator('#bookingModal .btn-edit-booking').click();
            await page.waitForFunction(()=>!document.getElementById('bookingForm').inert&&document.getElementById('educationLessonDuration').value==='45');
            await page.locator('#bookingPanel').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
            await page.locator('.booking-context-card').scrollIntoViewIfNeeded();
            const geometry=await page.locator('.booking-context-card').evaluate(card=>{
                const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
                const time=card.querySelector('.info-item--booking-time');
                return {card:rect(card),time:rect(time),controls:[...time.querySelectorAll('button,select')].map(el=>({id:el.id,...rect(el)})),resource:rect(document.getElementById('selectedLineDisplay')),viewport:innerWidth};
            });
            evidence.geometry.push({profile,theme,...geometry});
            const screenshot=profile+'-'+theme+'-context.png';
            await page.locator('.booking-context-card').screenshot({path:path.join(out,screenshot)});evidence.screenshots.push(screenshot);
            for(const control of geometry.controls){
                assert.ok(control.left>=geometry.time.left-1&&control.right<=geometry.time.right+1,control.id+' overflows its time column');
                assert.ok(control.width>=44&&control.height>=44,control.id+' retains 44px touch target');
                const overlap=Math.min(control.right,geometry.resource.right)-Math.max(control.left,geometry.resource.left)>1&&Math.min(control.bottom,geometry.resource.bottom)-Math.max(control.top,geometry.resource.top)>1;
                assert.equal(overlap,false,control.id+' overlaps cabinet text');
            }
            assert.ok(geometry.card.right<=geometry.viewport+1,'Context card fits viewport');
            const before=await page.locator('#bookingTime').inputValue();
            await page.locator('#bookingTimeStepForward').click();
            await page.waitForFunction(before=>document.getElementById('bookingTime').value!==before,before);
            await page.locator('#bookingTimeStepBack').click();
            await page.waitForFunction(before=>document.getElementById('bookingTime').value===before,before);
            await page.locator('#bookingSubmitBtn').scrollIntoViewIfNeeded();assert.equal(await page.locator('#bookingSubmitBtn').isVisible(),true);
            return {screenshot,geometry,timeRestored:true,saveAccessible:true};
        });await settleRuntime(page);}finally{await context.close();}
    }
    await check('page-errors',()=>assert.deepEqual(evidence.pageErrors,[]));
})().catch(error=>{evidence.fatal=error.message;process.exitCode=1;}).finally(async()=>{
    await browser?.close();await pool.end();evidence.exitCode=process.exitCode||results.exitCode();process.exitCode=evidence.exitCode;flush();
});
