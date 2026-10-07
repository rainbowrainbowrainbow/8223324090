'use strict';
// Read-only DOM hit testing against the retained synthetic preview.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const pw=require(process.env.EDU_QA_PLAYWRIGHT);
const assert=require('node:assert/strict'),{Pool}=require('pg');const {DATABASES,assertLocalTarget,seedDataset}=require('../../scripts/lib/education-ready-dataset');assertLocalTarget('fixed');assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,'true');const base=process.env.TEST_URL;assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);const root=path.resolve(process.env.EDU_READY_OUTPUT,'attempt-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(root,{recursive:true});
const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.fixed,ssl:false});let m;
const result={classification:'READ_ONLY_OCCLUSION_DIAGNOSTIC',startedAt:new Date().toISOString(),blockedWrites:[],observations:[],errors:[]};
(async()=>{
 m=(await seedDataset(pool,'fixed')).manifest;
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.TEST_USER,password:process.env.TEST_PASS})});
 assert.equal(login.status,200);const auth=await login.json(),token=auth.accessToken||auth.token;assert.ok(token);
 const config=await fetch(base+'/api/business/cabinet?businessContext=dar',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({businessType:'education',timelineMode:'education',resourceModel:'cabinet'})});assert.equal(config.status,200);
 for(const engine of ['chromium','webkit']){
 const browser=await pw[engine].launch({headless:true});
 try {for(const width of [390,844,1024]){
  const context=await browser.newContext({viewport:{width,height:width===844?390:width===390?844:768},timezoneId:'Europe/Kyiv',serviceWorkers:'block'});
  try {
   await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==base)return route.abort();if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!/^\/api\/auth\/(login|refresh|verify)$/.test(u.pathname)){result.blockedWrites.push({engine,width,method:r.method(),path:u.pathname});return route.abort('blockedbyclient');}return route.continue();});
   if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>socket.close());
   const page=await context.newPage();page.setDefaultTimeout(20000);
   await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#username').fill(process.env.TEST_USER);await page.locator('#password').fill(process.env.TEST_PASS);await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await page.waitForURL(url=>url.pathname==='/'&&!url.search);await page.waitForFunction(()=>window.isAuthenticatedRuntimeReady?.());await page.waitForLoadState('networkidle');
   await page.goto(`${base}/?businessContext=dar&educationSchedule=today&date=${m.anchorDate}`,{waitUntil:'domcontentloaded'});await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await page.waitForLoadState('networkidle');await page.locator(`[data-education-booking-id="${m.ids.bookings['robots-4']}"]`).click();await page.locator('#bookingModal').waitFor({state:'visible'});await page.locator('#bookingModal .btn-edit-booking').click();await page.locator('#bookingPanel').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('bookingForm').inert&&document.getElementById('educationLessonDuration').value==='45');
   const controls=[];const activations=[];await page.evaluate(()=>{window.__editorEvents=[];document.addEventListener('click',e=>{if(['educationLessonDate','bookingSubmitBtn'].includes(e.target.id))window.__editorEvents.push({id:e.target.id,trusted:e.isTrusted});},true);});
   for(const selector of ['#educationLessonDate','#educationLessonDuration','#bookingSubmitBtn']){
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(secret=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(secret&&node.nodeValue.includes(secret))node.nodeValue=node.nodeValue.split(secret).join('[REDACTED]');},process.env.TEST_USER);await page.screenshot({path:path.join(root,engine+'-'+width+'-'+selector.slice(1)+'.png')});controls.push(await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);const samples=[r.left+8,x,r.right-8].map(sx=>{const h=document.elementFromPoint(sx,y);return{x:sx,y,unobscured:h===el||el.contains(h),hit:{id:h?.id,className:h?.className}};});return {samples,id:el.id,rect:r.toJSON(),center:{x,y},hit:{tag:hit?.tagName,id:hit?.id,className:hit?.className},unobscured:samples.every(s=>s.unobscured)};}));
   }
      for(const selector of ['#educationLessonDate','#bookingSubmitBtn']){
    await page.locator(selector).scrollIntoViewIfNeeded();
    for(const side of ['left','center','right']){
     const box=await page.locator(selector).boundingBox();const x=side==='left'?box.x+8:side==='right'?box.x+box.width-8:box.x+box.width/2;
     const count=await page.evaluate(()=>window.__editorEvents.length);const write=selector==='#bookingSubmitBtn'?page.waitForRequest(r=>r.method()==='PUT'&&new URL(r.url()).pathname==='/api/bookings/'+m.ids.bookings['robots-4']):null;
     await page.mouse.click(x,box.y+box.height/2);
     await page.waitForFunction(n=>window.__editorEvents.length>n,count);
     if(selector==='#educationLessonDate'){if(await page.locator(selector).evaluate(el=>document.activeElement!==el))throw new Error('Date field not focusable at '+side);await page.keyboard.press('Tab');}
     else {await write;await page.waitForFunction(()=>!document.getElementById('bookingSubmitBtn').disabled);}
     const event=await page.evaluate(()=>window.__editorEvents.at(-1));if(event.id!==selector.slice(1)||!event.trusted)throw new Error('Native edge activation missing');
     activations.push({selector,side,event});
    }
   }
   const layers=await page.evaluate(()=>['bookingPanel','sidebarNav'].map(id=>{const el=document.getElementById(id)|| (id==='sidebarNav'?document.querySelector('.sidebar-nav'):null);return{id,exists:!!el,zIndex:el&&getComputedStyle(el).zIndex,rect:el?.getBoundingClientRect().toJSON()};}));
   await page.evaluate(secret=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(secret&&node.nodeValue.includes(secret))node.nodeValue=node.nodeValue.split(secret).join('[REDACTED]');},process.env.TEST_USER);const screenshot=`${engine}-${width}-editor.png`;await page.screenshot({path:path.join(root,screenshot)});
   result.observations.push({engine,width,business:'dar',role:'creator',controls,activations,layers,screenshot,status:controls.every(x=>x.unobscured)?'PASS':'FAIL'});
  }finally{await context.close();}
 }}finally{await browser.close();}
}})().catch(error=>{result.errors.push({type:error.name,message:error.message});process.exitCode=1;}).finally(async()=>{await pool.end();result.finishedAt=new Date().toISOString();result.status=result.errors.length||result.observations.length!==6||result.observations.some(x=>x.status==='FAIL')?'FAIL':'PASS';result.exitCode=result.status==='PASS'?0:1;result.scriptHash=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(result,null,2));console.log(result.status+' observations='+result.observations.length);process.exitCode=result.exitCode;});
