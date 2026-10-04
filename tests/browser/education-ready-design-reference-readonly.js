'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require(process.env.EDU_QA_PLAYWRIGHT);const base='https://8223324090-production.up.railway.app';
const out=path.resolve('output/education-ready/06/live-reference');fs.mkdirSync(out,{recursive:true});
const evidence={status:'NOT RUN',policy:'Business writes blocked before login; only known buttons captured, no customer/user/profile content',blockedWrites:[],controls:[],screenshots:[]};let browser;
(async()=>{
    assert.ok(process.env.LIVE_CREATOR_USER&&process.env.LIVE_CREATOR_PASS,'Private credentials unavailable');
    const version=await(await fetch(base+'/api/version')).json();evidence.identity={version:version.version,commitSha:version.commitSha,sourceBranch:version.sourceBranch};
    browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
    await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!/^\/api\/auth\/(login|refresh|verify)$/.test(url.pathname)){evidence.blockedWrites.push({method:req.method(),path:url.pathname});return route.abort();}return route.continue();});
    if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>socket.close());const page=await context.newPage();page.setDefaultTimeout(20000);
    await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#username').fill(process.env.LIVE_CREATOR_USER);await page.locator('#password').fill(process.env.LIVE_CREATOR_PASS);await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
    async function fingerprint(){const value=await page.evaluate(async()=>{const rows=[];for(const endpoint of ['/api/business/profile?businessContext=dar','/api/business/cabinet?businessContext=dar']){const response=await fetch(endpoint,{headers:getAuthHeaders()});rows.push({status:response.status,value:JSON.parse(JSON.stringify(await response.json(),(key,value)=>key==='generatedAt'?undefined:value))});}return rows;});return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
    evidence.beforeFingerprint=await fingerprint();
    for(const theme of ['dark','light']){
        await page.goto(base+'/?businessContext=dar&educationSchedule=groups&open=settings',{waitUntil:'domcontentloaded'});await page.locator('#settingsModal').waitFor({state:'visible',timeout:45000});
        if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme){await page.locator('#settingsModal .modal-close').click();await page.locator('#headerThemeToggle').click();await page.goto(base+'/?businessContext=dar&educationSchedule=groups&open=settings',{waitUntil:'domcontentloaded'});await page.locator('#settingsModal').waitFor({state:'visible',timeout:45000});}
        await page.locator('#settingsSaveTimelineDisplayBtn').scrollIntoViewIfNeeded();
        for(const selector of ['#settingsSaveTimelineDisplayBtn','#settingsAddTimelineResourceBtn']){
            const el=page.locator(selector);await el.waitFor({state:'visible'});evidence.controls.push(await el.evaluate((el,theme)=>{const s=getComputedStyle(el);return{theme,id:el.id,className:el.className,height:el.getBoundingClientRect().height,radius:s.borderRadius,font:s.fontFamily,fontSize:s.fontSize,background:s.backgroundColor,backgroundImage:s.backgroundImage,color:s.color,padding:s.padding};},theme));
            const file=selector.slice(1)+'-'+theme+'.png';await el.screenshot({path:path.join(out,file)});evidence.screenshots.push(file);
        }
    }
    evidence.afterFingerprint=await fingerprint();assert.equal(evidence.afterFingerprint,evidence.beforeFingerprint);evidence.status='READONLY_REFERENCE_COMPLETE';
})().catch(error=>{evidence.status='FAIL_OR_BLOCKED';evidence.errorType=error.name;process.exitCode=1;}).finally(async()=>{await browser?.close();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(evidence,null,2));console.log('Design reference '+evidence.status);});
