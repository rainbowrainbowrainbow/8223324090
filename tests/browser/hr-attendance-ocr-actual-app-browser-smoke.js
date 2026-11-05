'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
const {assertSafeTestDatabaseUrl,assertSafeIsolatedTestUrl}=require('../../scripts/test-db-safety');
const base=process.env.TEST_URL,output=process.env.CRM_ATTENDANCE_BROWSER_OUTPUT || path.resolve(__dirname,'../../output/playwright/attendance-ocr-actual-app');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
async function api(route,token,body,context='event_genix'){
 const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'X-Business-Context':context,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
async function login(username,password){const response=await api('/api/auth/login',null,{username,password});assert.equal(response.status,200);return response.body;}
function playwright(){
 if(process.env.PLAYWRIGHT_MODULE_PATH)return require(process.env.PLAYWRIGHT_MODULE_PATH);
 try{return require('playwright');}catch{}
 for(const entry of String(process.env.PATH || '').split(path.delimiter)){
  if(/node_modules[\\/]\.bin[\\/]?$/.test(entry)){
   const modulePath=path.join(path.dirname(entry.replace(/[\\/]$/,'')),'playwright');if(fs.existsSync(modulePath))return require(modulePath);
  }
 }
 throw Error('Playwright unavailable');
}
async function run(){
 assert.equal(process.env.RUN_CRM_ATTENDANCE_ACTUAL_APP,'true');assertSafeIsolatedTestUrl(base);
 const target=assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL,{...process.env,DATABASE_URL:''});assert.equal(target.isLocal,true);
 const db=new Pool({connectionString:target.url.toString(),ssl:false});fs.mkdirSync(output,{recursive:true});
 const {chromium}=playwright();
 const browser=await chromium.launch({headless:true,...(process.env.CRM_AUTOMATION_CHROME_PATH?{executablePath:process.env.CRM_AUTOMATION_CHROME_PATH}:{})});
 let page;
 try{
  const auth=await login(process.env.TEST_USER,process.env.TEST_PASS),token=auth.accessToken || auth.token;
  const staff=(await db.query("INSERT INTO staff(name,display_name,department,position,role_type,hourly_rate,is_active,hr_pool_status,is_freelance) VALUES('Synthetic OCR Browser Employee','Synthetic OCR Browser Employee','Synthetic','Synthetic','wardrobe',100,true,'core',false) RETURNING id")).rows[0];
  assert.equal((await api('/api/hr/attendance/ocr/status')).status,401);
  assert.equal((await api('/api/hr/attendance/ocr/preview',token,{actor:{id:1},documentDate:'2026-11-04'},'dar')).status,403);
  const password='synthetic-'+randomUUID(),hash=await require('bcryptjs').hash(password,4),suffix=randomUUID().slice(0,8);
  for(const role of ['waiter','creator'])await db.query('INSERT INTO users(username,password_hash,role,name) VALUES($1,$2,$3,$4)',[role+suffix,hash,role,'Synthetic OCR '+role]);
  const denied=await login('waiter'+suffix,password),deniedToken=denied.accessToken||denied.token;
  assert.equal((await api('/api/hr/attendance/ocr/status',deniedToken)).status,403);
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.addInitScript(value=>{
   localStorage.setItem('pzp_token',value.accessToken||value.token);localStorage.setItem('pzp_access_token',value.accessToken||value.token);
   localStorage.setItem('pzp_current_user',JSON.stringify(value.user));if(value.refreshToken)localStorage.setItem('pzp_refresh_token',value.refreshToken);
  },auth);
  page=await context.newPage();page.setDefaultTimeout(20000);
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/hr',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#attendanceOcrPanel')?.hidden===false && document.querySelector('#attendanceOcrPanel')?.getAttribute('aria-busy')==='false');
  await page.locator('#attendanceOcrPanel summary').click();
  await page.locator('#attendanceOcrDate').fill('2026-11-04');
  await page.locator('#attendanceOcrFile').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
  await page.locator('#attendanceOcrPaidConfirm').check();
  // Lose the response after the actual app commits recognition; recovery must
  // load its durable result rather than call the provider again.
  await page.route('**/api/hr/attendance/ocr/preview',async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await page.locator('#attendanceOcrPreview').click();
  await page.waitForFunction(()=>document.querySelector('#attendanceOcrStatus').textContent.includes('Результат потребує перевірки'));
  assert.equal(await page.locator('#attendanceOcrPreview').isDisabled(),true);
  await page.locator('#attendanceOcrRecover').click();
  await page.locator('#attendanceOcrReview').waitFor({state:'visible'});
  assert.equal(await page.locator('#attendanceOcrRows input:checked').count(),0);
  assert.equal(await page.locator('#attendanceOcrRows input[data-ordinal="2"]').isDisabled(),true);
  assert.match(await page.locator('#attendanceOcrRows').textContent(),/10:50.*20:15/s);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_time_records WHERE staff_id=$1',[staff.id])).rows[0].n,0);
  const firstId=new URL(page.url()).searchParams.get('attendancePreview');assert.ok(firstId);
  const foreign=await login('creator'+suffix,password);
  assert.equal((await api('/api/hr/attendance/ocr/previews/'+firstId,foreign.accessToken||foreign.token)).status,404);
  const leaked=await api('/api/hr/attendance/ocr/previews/'+firstId,token);assert.equal(leaked.body.state_snapshot,undefined);
  await page.locator('#attendanceOcrPanel').screenshot({path:path.join(output,'desktop-review.png')});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#attendanceOcrReview').waitFor({state:'visible'});
  assert.equal(new URL(page.url()).searchParams.get('attendancePreview'),firstId);
  assert.equal(await page.locator('#attendanceOcrDate').inputValue(),'2026-11-04');
  await page.locator('#attendanceOcrRefresh').click();
  await page.waitForFunction(id=>new URL(location.href).searchParams.get('attendancePreview')!==id,firstId);
  const refreshedId=new URL(page.url()).searchParams.get('attendancePreview');
  await db.query('UPDATE staff SET hourly_rate=120 WHERE id=$1',[staff.id]);
  await page.locator('#attendanceOcrRows input[data-ordinal="1"]').check();await page.locator('#attendanceOcrApplyConfirm').check();
  await page.locator('#attendanceOcrApply').click();
  await page.waitForFunction(()=>document.querySelector('#attendanceOcrStatus').textContent.includes('Дані змінилися'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_time_records WHERE staff_id=$1',[staff.id])).rows[0].n,0);
  await db.query('UPDATE staff SET hourly_rate=100 WHERE id=$1',[staff.id]);
  await page.locator('#attendanceOcrRefresh').click();
  await page.waitForFunction(id=>new URL(location.href).searchParams.get('attendancePreview')!==id,refreshedId);
  assert.equal(await page.locator('#attendanceOcrApplyConfirm').isChecked(),false);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#attendanceOcrPanel').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
  await page.locator('#attendanceOcrRows input[data-ordinal="1"]').focus();await page.keyboard.press('Space');
  await page.locator('#attendanceOcrApplyConfirm').check();
  fs.writeFileSync(path.join(output,'mobile-layout.json'),JSON.stringify(await page.evaluate(()=>{
   const panel=document.querySelector('#attendanceOcrPanel');return {viewport:innerWidth,scrollX,scrollY,documentWidth:document.documentElement.scrollWidth,
    panel:{x:panel.getBoundingClientRect().x,width:panel.getBoundingClientRect().width,scrollLeft:panel.scrollLeft,scrollWidth:panel.scrollWidth},
    ancestors:[...function*(node){while(node){yield node;node=node.parentElement;}}(panel)].map(node=>({tag:node.tagName,id:node.id,scrollLeft:node.scrollLeft,x:node.getBoundingClientRect().x,width:node.getBoundingClientRect().width,scrollWidth:node.scrollWidth}))};
  }),null,2));
  await page.screenshot({path:path.join(output,'mobile-page.png'),fullPage:true});
  await page.locator('#attendanceOcrPanel').screenshot({path:path.join(output,'mobile-review.png')});
  await page.locator('#attendanceOcrApply').click();
  await page.waitForFunction(()=>document.querySelector('#attendanceOcrStatus').textContent.includes('Застосовано рядків: 1'));
  const record=(await db.query("SELECT total_worked_minutes,to_char(clock_in AT TIME ZONE 'Europe/Kyiv','HH24:MI') AS arrival,to_char(clock_out AT TIME ZONE 'Europe/Kyiv','HH24:MI') AS departure FROM hr_time_records WHERE staff_id=$1",[staff.id])).rows[0];
  assert.deepEqual(record,{total_worked_minutes:565,arrival:'10:50',departure:'20:15'});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_checkins WHERE staff_id=$1',[staff.id])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_schedule WHERE staff_id=$1',[staff.id])).rows[0].n,0);
  const counter=JSON.parse(fs.readFileSync(path.join(output,'provider-counter.json')));assert.equal(counter.calls,1);
  await page.locator('#attendanceOcrPanel').screenshot({path:path.join(output,'mobile-applied.png')});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'journey-evidence.json'),JSON.stringify({status:'PASS',actualApp:true,actualPostgres:true,provider:'synthetic',providerCalls:1,paidCalls:0,productionWrites:0,attendancePairs:1,blankRowsApplied:0,staleRejected:true,ownerBoundary:true,permissionBoundary:true,lostResponseRecoveredWithoutNewProvider:true,reloadAndRefreshNoNewProvider:true,keyboardAndMobile:true},null,2));
  console.log('Attendance OCR actual-app browser journey PASS; synthetic provider only.');
 }catch(error){await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
 finally{await browser.close();await db.end();}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
