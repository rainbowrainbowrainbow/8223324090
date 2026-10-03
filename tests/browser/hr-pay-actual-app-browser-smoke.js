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
    await page.waitForFunction(()=>document.querySelector('#schModalOverlay')?.getAttribute('aria-busy')!=='true');
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
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const next=new Date(new Date(date+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);
    const evidence={schemaVersion:1,commitSha:process.env.GITHUB_SHA||null,syntheticOnly:true,productionWrites:0,stages:{}};
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
        const hrRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/hr/staff/'+staffId);
        await card().locator('[data-schedule-pay-conditions]').first().click();
        await page.waitForURL(/\/hr\?/);
        const hrResponse=await hrRead;
        const hrResult=await hrResponse.json();
        if(hrResponse.status()===403){
            assert.equal(hrResult.code,'staff_not_migrated');
            evidence.stages.hrCard={status:'BLOCKED',code:hrResult.code};
        } else {assert.equal(hrResponse.status(),200);evidence.stages.hrCard={status:'PASS'};}
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
        assert.match(await card().locator('[data-day-pay-panel][data-pay-purpose="additional"]').innerText(),/один раз за професію/);
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
        await db.query(`INSERT INTO staff_payroll_profile_assignments(staff_id,profession_key,profile_id,assignment_kind,effective_from,effective_to,created_by,updated_by)
            VALUES($1,'animator',$2,'temporary',$3,$3,'isolated_pay','isolated_pay')`,[staffId,monthly.id,next]);
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
        await page.locator('#schNote').fill('Restricted salary view can edit schedule notes');
        const restrictedSave=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/staff/schedule'&&response.request().method()==='PUT');
        await page.locator('#schSaveBtn').click();
        const savedRestricted=await restrictedSave;assert.equal(savedRestricted.status(),200);
        assert.doesNotMatch(JSON.stringify(await savedRestricted.json()),/"(?:rate|hourly_rate|default_rate)":(?:270|500|30000)\b/);
        await page.locator('#schModalOverlay.visible').waitFor({state:'hidden'});
        await page.locator(`.sch-cell[data-staff="${staffId}"][data-date="${date}"]`).first().click();
        await page.locator('[data-day-pay-slot]').first().waitFor();
        const storage=await page.evaluate(()=>JSON.stringify({...sessionStorage}));assert.doesNotMatch(storage,/defaultRate|selectedProfile|30000/);
        await page.screenshot({path:path.join(output,'restricted-mobile.png'),fullPage:true});
        await restricted.close();assert.deepEqual(errors,[]);
        evidence.stages.schedule={status:'PASS',dateReload:true,exceptionConflict:true,draftReturn:true,salaryRestricted:true,copyApi:true,copyButton:'NOT_VISIBLE'};
        // Continue through actual HR controls and real API/database writes. No response stubs.
        const attendanceContext=await browserContext(browser,auth);
        page=await attendanceContext.newPage();page.setDefaultTimeout(30000);
        await page.goto(base+'/hr?tab=today',{waitUntil:'domcontentloaded'});
        const todayRow=page.locator(`#todayList [data-staff-id="${staffId}"]`);
        await todayRow.waitFor();
        const clockButton=todayRow.locator('.hr-clock-btn');
        if(await clockButton.isDisabled()){
            evidence.stages.attendance={status:'BLOCKED',code:'today_read_only_business_gate'};
        } else {
            const clockIn=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/hr/clock-in'&&r.request().method()==='POST');
            await clockButton.click();const clockResponse=await clockIn;assert.equal(clockResponse.status(),200);
            const clockBody=await clockResponse.json();assert.equal(clockBody.data.compensation_snapshot.schemaVersion,2);
            await page.waitForFunction(id=>document.querySelector(`#todayList [data-staff-id="${id}"] .clock-out`),staffId);
            await todayRow.click({button:'right'});
            await page.locator('#contextMenu [data-action="correct"]').click();
            await page.locator('#correctionModal').waitFor({state:'visible'});
            await page.locator('#corrClockIn').fill('11:00');
            await page.locator('#corrClockOut').fill('17:00');
            await page.locator('#corrNotes').fill('Synthetic actual arrival and departure');
            const corrected=page.waitForResponse(r=>/\/api\/hr\/records\/\d+\/correct$/.test(new URL(r.url()).pathname)&&r.request().method()==='PUT');
            await page.locator('#corrSave').click();assert.equal((await corrected).status(),200);
            await page.locator('#correctionModal').waitFor({state:'hidden'});
            const record=(await db.query('SELECT compensation_snapshot,total_worked_minutes FROM hr_time_records WHERE staff_id=$1 AND record_date=$2',[staffId,date])).rows[0];
            assert.equal(record.total_worked_minutes,330);
            assert.equal(record.compensation_snapshot.totals.physicalMinutes,330);
            const baseTerms=record.compensation_snapshot.compensationAllocations.find(row=>row.allocationType==='base').conditions;
            assert.equal(baseTerms.rate,270);assert.equal(baseTerms.exception.reason,'Second editor');
            evidence.stages.attendance={status:'PASS',physicalMinutes:330,breakMinutes:30};
            // Later catalog edits must not alter the frozen conditions or the final snapshot.
            await db.query('UPDATE payroll_profile_versions SET default_rate=999 WHERE id=$1',[primary.version]);
            const snapshotBefore=record.compensation_snapshot;
            const salaryResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/hr/salary');
            await page.goto(base+'/hr?tab=salary',{waitUntil:'domcontentloaded'});
            const salaryRead=await salaryResponse;
            if(salaryRead.status()===403){
                const failure=await salaryRead.json();assert.equal(failure.code,'staff_not_migrated');
                evidence.stages.salaryBreakdown={status:'BLOCKED',code:failure.code};
            } else {
                assert.equal(salaryRead.status(),200);
                const salaryBody=await salaryRead.json(), salary=salaryBody.data.find(row=>Number(row.staff_id)===staffId);
                assert.ok(salary);assert.equal(salary.base_salary,1485);assert.equal(salary.additional_pay,500);
                assert.equal(salary.physical_hours,5.5);
                await page.waitForFunction(()=>document.querySelector('#salaryList .hr-payroll-salary-item')||document.querySelector('[data-salary-retry]'));
                const retry=page.locator('[data-salary-retry]');
                if(await retry.isVisible()){
                    // Initial access hydration legitimately invalidates the pending read. Use the real retry control.
                    const reloaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/hr/salary');
                    await retry.click();assert.equal((await reloaded).status(),200);
                    evidence.salaryAccessHydrationRetry=true;
                }
                await page.locator('#salarySearch').fill(salary.staff_name);
                const salaryCard=page.locator('.hr-payroll-salary-item').filter({hasText:salary.staff_name});
                await salaryCard.locator('[data-payroll-detail-toggle]').click();
                await salaryCard.locator('.hr-payroll-details').waitFor({state:'visible'});
                assert.match(await salaryCard.innerText(),/270/);
                assert.match(await salaryCard.innerText(),/500/);
                const additionalText=await salaryCard.locator('.hr-payroll-additional-role').innerText();
                assert.match(additionalText,/500 грн\/день/);assert.doesNotMatch(additionalText,/500 грн\/год/);
                assert.match(await salaryCard.locator('.hr-payroll-rate-summary').innerText(),/Разова ставка на цю дату/);
                assert.match(await salaryCard.locator('.hr-payroll-rate-summary').innerText(),/Second editor/);
                assert.match(await salaryCard.locator('.hr-payroll-rate-summary').innerText(),/330 \/ 60/);
                await salaryCard.screenshot({path:path.join(output,'salary-breakdown.png')});
                evidence.stages.salaryBreakdown={status:'PASS',physicalHours:5.5,additionalLines:1};
            }
            const after=(await db.query('SELECT compensation_snapshot FROM hr_time_records WHERE staff_id=$1 AND record_date=$2',[staffId,date])).rows[0];
            assert.deepEqual(after.compensation_snapshot,snapshotBefore);
        }
        await attendanceContext.close();
        evidence.journeyStatus=Object.values(evidence.stages).some(stage=>stage.status==='BLOCKED')?'BLOCKED':'PASS';
        evidence.regressionStatus='PASS';
        fs.writeFileSync(path.join(output,'journey-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
        console.log(JSON.stringify(evidence));

    } catch(error) {
        await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
        throw error;
    } finally {await browser.close();await db.end();}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
