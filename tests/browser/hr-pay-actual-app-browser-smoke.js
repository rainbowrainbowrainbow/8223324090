'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeIsolatedTestUrl, assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const base = process.env.TEST_URL;
const output = path.resolve(__dirname,'../../output/playwright/hr-pay-actual-app');
function playwright() {
    try { return require('playwright'); } catch {}
    for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
        if (/node_modules[\\/]\.bin[\\/]?$/.test(entry)) {
            const pkg=path.join(path.dirname(entry.replace(/[\\/]$/,'')),'playwright');
            if (fs.existsSync(pkg)) return require(pkg);
        }
    }
    throw Error('Playwright unavailable');
}
async function request(route,token,body,method='GET') {
    const response=await fetch(new URL(route,base),{method,headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
}
async function login(username,password) {
    const result=await request('/api/auth/login',null,{username,password},'POST');
    assert.equal(result.status,200); return result.body;
}
async function browserContext(browser,auth,viewport={width:1440,height:1000}) {
    const context=await browser.newContext({viewport,serviceWorkers:'block'});
    await context.addInitScript(auth=>{
        localStorage.setItem('pzp_token',auth.accessToken||auth.token);
        localStorage.setItem('pzp_access_token',auth.accessToken||auth.token);
        localStorage.setItem('pzp_current_user',JSON.stringify(auth.user));
        if(auth.refreshToken)localStorage.setItem('pzp_refresh_token',auth.refreshToken);
        localStorage.setItem('pzp_staff_schedule_expanded_groups',JSON.stringify(['animators','reception']));
    },auth);
    return context;
}
async function openPage(page,date,next) {
    await page.goto(base+'/staff',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.StaffSchedulePage?.isInitialized());
    await page.locator('#scheduleDateFrom').fill(date);
    await page.locator('#scheduleDateTo').fill(next);
    await page.locator('#applyScheduleRangeBtn').click();
    await page.locator('#deptFilter [data-dept="animators"]').click();
    const toggle=page.locator('[data-schedule-group-toggle="animators"]');
    await toggle.waitFor(); if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
}
async function openCell(page,id,date) {
    await page.locator(`.sch-cell[data-staff="${id}"][data-date="${date}"]`).first().click();
    await page.locator('#schModalOverlay.visible').waitFor();
    await page.locator('[data-day-pay-panel][data-pay-purpose="base_replacement"] .sch-day-pay-current').first().waitFor();
}
async function closeCell(page) {
    await page.locator('#schCancelBtn').click();
    const confirm=page.locator('.confirm-overlay[data-confirm-kind="confirm"]');
    if(await confirm.isVisible().catch(()=>false))await confirm.locator('.confirm-ok').click();
    await page.locator('#schModalOverlay.visible').waitFor({state:'hidden'});
}
async function savePay(page,panel,status=200) {
    const response=page.waitForResponse(r=>r.url().includes('/payroll-day-exception')&&r.request().method()==='PUT');
    await panel.locator('[data-day-pay-save]').click();
    assert.equal((await response).status(),status);
    if(status===200)await panel.locator('[data-day-pay-field="choice"]').waitFor();
}
async function run() {
    assert.equal(process.env.RUN_HR_PAY_ACTUAL_APP_BROWSER,'true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET,'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,'true');
    assertSafeIsolatedTestUrl(base);
    const target=assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL,{...process.env,DATABASE_URL:''});
    const db=new Pool({connectionString:target.url.toString(),ssl:target.isLocal?false:{rejectUnauthorized:false}});
    fs.mkdirSync(output,{recursive:true});
    const auth=await login(process.env.TEST_USER,process.env.TEST_PASS),token=auth.accessToken||auth.token;
    const stamp=crypto.randomBytes(5).toString('hex');
    const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),next=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
    const {chromium}=playwright(),browser=await chromium.launch({headless:true});
    let page;
    try {
        const staffId=Number((await db.query(`INSERT INTO staff(name,department,position,role_type,secondary_professions,hourly_rate,rate_unit,is_active)
            VALUES($1,'animators','QA','animator','["reception"]',100,'hour',true) RETURNING id`,['Synthetic pay '+stamp])).rows[0].id);
        await db.query(`INSERT INTO staff_role_assignments(staff_id,profession_key,is_primary,status,admission_status,internship_status,created_by,updated_by)
            VALUES($1,'animator',true,'active','approved','none','isolated_pay','isolated_pay'),($1,'reception',false,'active','approved','none','isolated_pay','isolated_pay')`,[staffId]);
        async function profile(title,profession,unit,rate) {
            const id=Number((await db.query(`INSERT INTO payroll_profiles(title,profession_key,profile_kind,owner_staff_id,status,created_by)
                VALUES($1,$2,'personal',$3,'active','isolated_pay') RETURNING id`,[title,profession,staffId])).rows[0].id);
            const version=Number((await db.query(`INSERT INTO payroll_profile_versions(profile_id,version_number,rate_unit,default_rate,effective_from,created_by)
                VALUES($1,1,$2,$3,'2020-01-01','isolated_pay') RETURNING id`,[id,unit,rate])).rows[0].id);
            return {id,version};
        }
        const primary=await profile('QA base','animator','hour',100),alternative=await profile('QA alternative','animator','hour',240);
        const extra=await profile('QA daily extra','reception','day',500),monthly=await profile('QA monthly','animator','month',30000);
        await db.query(`INSERT INTO staff_payroll_profile_assignments(staff_id,profession_key,profile_id,assignment_kind,effective_from,created_by,updated_by)
            VALUES($1,'animator',$2,'explicit','2020-01-01','isolated_pay','isolated_pay'),($1,'reception',$3,'explicit','2020-01-01','isolated_pay','isolated_pay')`,[staffId,primary.id,extra.id]);
        await db.query("UPDATE hr_compensation_policies SET status='active',effective_from='2020-01-01' WHERE policy_version='simultaneous-profession-pay-v1'");
        const context=await browserContext(browser,auth);
        page=await context.newPage(); page.setDefaultTimeout(30000);
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await openPage(page,date,next);await openCell(page,staffId,date);
        const card=()=>page.locator('#schSegmentsList .sch-segment-card').first();
        const panel=()=>card().locator('[data-day-pay-panel][data-pay-purpose="base_replacement"]');
        await card().locator('[data-segment-field="start"]').fill('10:00');
        await card().locator('[data-segment-field="end"]').fill('18:00');
        await card().locator('[data-segment-field="break"]').fill('30');
        await page.locator('#schNote').fill('Keep this shift draft');
        assert.match(await panel().innerText(),/450 хв[\s\S]*750 грн/);
        await card().locator('[data-schedule-pay-conditions]').first().click();
        await page.waitForURL(/\/hr\?/);
        await page.locator('#staffScheduleReturnLink').waitFor();
        const draft=await page.evaluate(()=>sessionStorage.getItem('pzp_schedule_hr_draft_v1'));
        assert.doesNotMatch(draft,/selectedProfile|defaultRate|profileVersionId|dayPay/);
        await page.locator('#staffScheduleReturnLink').click();
        await page.locator('#schModalOverlay.visible').waitFor();
        await panel().locator('[data-day-pay-field="choice"]').waitFor();
        assert.equal(await card().locator('[data-segment-field="start"]').inputValue(),'10:00');
        assert.equal(await card().locator('[data-segment-field="break"]').inputValue(),'30');
        assert.equal(await page.locator('#schNote').inputValue(),'Keep this shift draft');
        await panel().locator('[data-day-pay-field="choice"]').selectOption(`profile:${alternative.id}:${alternative.version}`);
        await panel().locator('[data-day-pay-field="reason"]').fill('Synthetic alternative profile');
        await savePay(page,panel());
        await page.waitForFunction(()=>document.querySelector('.sch-day-pay-current')?.textContent.includes('QA alternative'));
        assert.equal(await card().locator('[data-segment-field="start"]').inputValue(),'10:00');
        let journal=(await db.query('SELECT * FROM payroll_day_exceptions WHERE staff_id=$1 AND work_date=$2 ORDER BY version DESC',[staffId,date])).rows;
        assert.equal(journal.length,1);assert.equal(journal[0].selected_profile_snapshot.profileId,alternative.id);
        assert.equal(Number((await db.query('SELECT default_rate FROM payroll_profile_versions WHERE id=$1',[primary.version])).rows[0].default_rate),100);
        await panel().locator('[data-day-pay-field="choice"]').selectOption('custom');
        await panel().locator('[data-day-pay-field="rate"]').fill('260');
        await panel().locator('[data-day-pay-field="reason"]').fill('Synthetic custom day');
        await savePay(page,panel());
        await page.waitForFunction(()=>document.querySelector('.sch-day-pay-current')?.textContent.includes('260'));
        assert.match(await panel().innerText(),/1.?950 грн/);
        await page.screenshot({path:path.join(output,'hourly-desktop.png'),fullPage:true});
        await card().locator('[data-segment-field="end"]').fill('');
        assert.doesNotMatch(await panel().locator('[data-day-pay-preview]').innerText(),/≈/);
        await card().locator('[data-segment-field="end"]').fill('18:00');
        await card().locator('[data-segment-field="paid-profession"]').selectOption('reception');
        await page.waitForFunction(()=>document.querySelector('[data-pay-purpose="additional"] .sch-day-pay-current')?.textContent.includes('500'));
        assert.match(await card().locator('[data-pay-purpose="additional"]').innerText(),/один раз за професію/);
        const saveShift=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/staff/schedule'&&r.request().method()==='PUT');
        await page.locator('#schSaveBtn').click();assert.equal((await saveShift).status(),200);
        await page.locator('#schModalOverlay.visible').waitFor({state:'hidden'});
        const monday=new Date(date+'T12:00:00Z');monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
        const nextMonday=new Date(monday);nextMonday.setUTCDate(nextMonday.getUTCDate()+7);
        const copiedDate=new Date(date+'T12:00:00Z');copiedDate.setUTCDate(copiedDate.getUTCDate()+7);
        const copiedDay=copiedDate.toISOString().slice(0,10);
        const copied=await request('/api/staff/schedule/copy-week',token,{fromMonday:monday.toISOString().slice(0,10),toMonday:nextMonday.toISOString().slice(0,10),staffIds:[staffId]},'POST');
        assert.equal(copied.status,200);assert.equal(copied.body.success,true);
        assert.equal((await db.query('SELECT id FROM payroll_day_exceptions WHERE staff_id=$1 AND work_date=$2',[staffId,copiedDay])).rows.length,0);
        const copiedPay=(await request('/api/hr/staff/'+staffId+'/payroll-conditions?professionKey=animator&date='+copiedDay,token)).body.data;
        assert.equal(copiedPay.conditions.rate,100);assert.equal(copiedPay.conditions.exception,null);
        await openCell(page,staffId,date);assert.match(await panel().innerText(),/260 грн/);
        // Keep a stale modal while a second authorized editor changes the same journal revision.
        const applied=(await request(`/api/hr/staff/${staffId}/payroll-conditions?professionKey=animator&date=${date}`,token)).body.data;
        const changed=await request(`/api/hr/staff/${staffId}/payroll-day-exception`,token,{professionKey:'animator',workDate:date,purpose:'base_replacement',expectedVersion:applied.exceptionVersion,rate:270,rateUnit:'hour',reason:'Second editor',idempotencyKey:crypto.randomUUID()},'PUT');
        assert.equal(changed.status,200);
        await panel().locator('[data-day-pay-field="choice"]').selectOption('custom');
        await panel().locator('[data-day-pay-field="rate"]').fill('280');
        await panel().locator('[data-day-pay-field="reason"]').fill('Stale editor');
        await savePay(page,panel(),409);assert.match(await panel().innerText(),/Умови вже змінено/);
        assert.equal(await card().locator('[data-segment-field="start"]').inputValue(),'10:00');
        await panel().locator('[data-day-pay-cancel]').click();
        await closeCell(page);await openCell(page,staffId,next);
        assert.match(await panel().innerText(),/100 грн/);assert.doesNotMatch(await panel().innerText(),/Разова ставка на цю дату/);
        await closeCell(page);
        // Monthly terms are supplied through the same real API; daily top-up remains a separate purpose.
        await db.query("UPDATE staff_payroll_profile_assignments SET profile_id=$2 WHERE staff_id=$1 AND profession_key='animator'",[staffId,monthly.id]);
        await page.setViewportSize({width:390,height:844});await openCell(page,staffId,next);
        // Monthly base stays read-only; the top-up has its own choice and purpose.
        assert.match(await panel().innerText(),/30.?000 грн\/місяць/);
        const topup=card().locator('[data-day-pay-panel][data-pay-purpose="additional"][data-pay-profession="animator"]');
        await topup.locator('[data-day-pay-field="choice"]').selectOption('custom');
        await topup.locator('[data-day-pay-field="rateUnit"]').selectOption('day');
        await topup.locator('[data-day-pay-field="rate"]').fill('400');
        await topup.locator('[data-day-pay-field="reason"]').fill('Daily top-up above monthly base');
        await savePay(page,topup);
        await page.waitForFunction(()=>document.querySelector('[data-pay-purpose="additional"] .sch-day-pay-current')?.textContent.includes('400'));
        await page.screenshot({path:path.join(output,'monthly-mobile.png'),fullPage:true});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await closeCell(page);await context.close();
        // Existing role plus explicit salary deny: API is 403 and UI never requests or stores amounts.
        const username='pay_reader_'+stamp,password=crypto.randomBytes(24).toString('base64url')+'!';
        const created=await request('/api/users',token,{username,password,name:'Synthetic salary restricted',role:'hr',staffId},'POST');
        assert.equal(created.status,200);
        const readerId=created.body.user.id;
        const denied=await request('/api/users/'+readerId+'/access',token,{role:'hr',extraRoles:[],actionDenylist:['hr.payroll.view'],actionAllowlist:[],pageAllowlist:[],pageDenylist:[],businessContexts:['event_genix'],defaultBusinessContext:'event_genix'},'PATCH');
        assert.equal(denied.status,200);
        const reader=await login(username,password),readerToken=reader.accessToken||reader.token;
        const blocked=await request(`/api/hr/staff/${staffId}/payroll-conditions?professionKey=animator&date=${date}`,readerToken);
        assert.equal(blocked.status,403);assert.doesNotMatch(JSON.stringify(blocked.body),/defaultRate|selectedProfile|30000|270/);
        assert.equal((await request(`/api/hr/staff/${staffId}/payroll-day-exception`,readerToken,{},'PUT')).status,403);
        const restricted=await browserContext(browser,reader,{width:390,height:844});page=await restricted.newPage();
        const salaryReads=[];page.on('request',r=>{if(r.url().includes('/payroll-conditions'))salaryReads.push(r.url());});
        await openPage(page,date,next);
        await page.locator(`.sch-cell[data-staff="${staffId}"][data-date="${date}"]`).first().click();
        await page.locator('[data-day-pay-slot]').first().waitFor();
        assert.deepEqual(salaryReads,[]);assert.match(await page.locator('[data-day-pay-slot]').first().innerText(),/Немає доступу/);
        assert.equal(await page.locator('[data-day-pay-field]').count(),0);
        const storage=await page.evaluate(()=>JSON.stringify({...sessionStorage}));assert.doesNotMatch(storage,/defaultRate|selectedProfile|30000/);
        await page.screenshot({path:path.join(output,'restricted-mobile.png'),fullPage:true});
        await restricted.close();assert.deepEqual(errors,[]);
        console.log('HR pay actual-app browser to API to PostgreSQL passed');
    } catch(error) {
        await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
        throw error;
    } finally {await browser.close();await db.end();}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
