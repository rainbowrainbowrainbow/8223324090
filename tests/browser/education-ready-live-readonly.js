'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const base = 'https://8223324090-production.up.railway.app';
const out = path.resolve(process.env.EDU_READY_LIVE_OUTPUT || 'output/education-ready/2026-10-03/live-readonly.json');
const result = { policy: 'All business writes intercepted before login; auth login/refresh/verify only; no PII screenshots or response bodies',
    startedAt: new Date().toISOString(), requests: [], blockedWrites: [], snapshots: [], pageErrors: [], diagnostics: [], consoleFailures: [], blockedFixtures: [], failedChecks: [] };
const observerHash=()=>crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
result.observerHarnessHash=observerHash();result.attemptId='live-'+result.startedAt.replace(/[:.]/g,'-');
let browser, stage = 'before-login';
const pending = new Set();
async function main() {
    const version = await fetch(base + '/api/version');
    const identity = await version.json();
    result.identity = { version: identity.version, commitSha: identity.commitSha, sourceBranch: identity.sourceBranch };
    const username = process.env.LIVE_CREATOR_USER || process.env.LIVE_SMOKE_USER;
    const password = process.env.LIVE_CREATOR_PASS || process.env.LIVE_SMOKE_PASS;
    if (!username || !password) { result.status = 'BLOCKED_CREDENTIALS'; process.exitCode = 1; return; }
    browser = await chromium.launch({ headless: true });
    result.browserVersion=browser.version();
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== base) return route.abort('blockedbyclient');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !/^\/api\/auth\/(login|refresh|verify)$/.test(url.pathname)) {
            result.blockedWrites.push({ stage, method: request.method(), path: url.pathname });
            return route.abort('blockedbyclient');
        }
        return route.continue();
    });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const classify=(kind,item,text='')=>{
        const held=result.blockedWrites.some(row=>row.path===item.path&&row.stage===stage);
        let classification='UNCLASSIFIED_FAILURE',cause='Needs investigation',impact='Cannot certify affected surface';
        if(held){classification='POLICY_WRITE_HOLD';cause='Business write blocked by this read-only harness';impact='No production failure or synchronization PASS inferred';}
        else if(['http','console'].includes(kind)&&item.path==='/api/staff'&&item.status===403&&stage==='dar-groups'){classification='EXPECTED_ACCESS_DENIAL';cause='Explicit legacy staff probe denied in education';impact='Education picker uses scoped teacher endpoint';}
        else if(kind==='request'&&item.error==='net::ERR_ABORTED'){classification='NAVIGATION_ABORT';cause='Read-only navigation cancelled pending request';impact='Terminal surface asserted separately';}
        else if(['request','console'].includes(kind)&&item.external){classification='POLICY_OUTBOUND_HOLD';cause='Cross-origin request blocked by harness';impact='Not production failure or sync proof';}
        else if(kind==='console'&&/websocket|reconnect|socket/i.test(text)){classification='POLICY_SOCKET_HOLD';cause='Read-only harness closes sockets';impact='No live synchronization claim';}
        result.diagnostics.push({stage,kind,...item,role:result.role||'unknown',business:stage.startsWith('park')?'event_genix':stage.startsWith('dar-')?'dar':'unknown',classification,cause,impact});
    };
    page.on('pageerror', error => { result.pageErrors.push({stage,type:error.name});classify('pageerror',{type:error.name}); });
    page.on('console',message=>{if(message.type()!=='error')return;const value=message.text();const location=message.location().url;let url;try{url=new URL(location);}catch{}const item={type:'error',path:url?.pathname,external:Boolean(url&&url.origin!==base),status:/\b403\b/.test(value)?403:undefined,messageHash:crypto.createHash('sha256').update(value).digest('hex')};result.consoleFailures.push({stage,...item});classify('console',item,value);});
    page.on('requestfailed',request=>{const url=new URL(request.url());classify('request',{method:request.method(),path:url.pathname,error:request.failure()?.errorText,external:url.origin!==base});});
    page.on('response', response => {
        const request = response.request(), url = new URL(response.url());
        if (!url.pathname.startsWith('/api/')) return;
        if(response.status()>=400)classify('http',{method:request.method(),path:url.pathname,status:response.status()});
        result.requests.push({ stage, method: request.method(), path: url.pathname, status: response.status(), business: url.searchParams.get('businessContext') });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill(username); await page.locator('#password').fill(password);
    stage = 'login'; await page.locator('#loginForm button[type="submit"]').click();
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    async function fingerprint() {
        const stable = await page.evaluate(async () => {
            const records = [];
            for (const route of ['/api/business/cabinet?businessContext=dar', '/api/business/profile?businessContext=dar']) {
                const response = await fetch(route, { headers: getAuthHeaders() });
                records.push({ status: response.status, value: JSON.parse(JSON.stringify(await response.json(), (key, value) => key === 'generatedAt' ? undefined : value)) });
            }
            return records;
        });
        return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
    }
    result.role=await page.evaluate(()=>typeof AppState!=='undefined'?AppState.currentUser?.role:null);
    result.beforeFingerprint = await fingerprint();
    async function snapshot(label) {
        result.snapshots.push(await page.evaluate(label => ({ label,
            role: typeof AppState !== 'undefined' ? AppState.currentUser?.role : null,
            business: window.CrmBusinessContext?.current?.(), activeView: window.EducationScheduleWorkspace?.state.activeView,
            teacherOptions: document.getElementById('educationGroupTeacher')?.options.length || 0,
            reportRendered: Boolean(document.querySelector('.education-report-summary')),
            reportStatusPresent: Boolean(document.getElementById('educationReportStatus')?.textContent),
            reportDatesSet: Boolean(document.getElementById('educationReportFrom')?.value && document.getElementById('educationReportTo')?.value)
        }), label));
    }
    stage = 'dar-groups';
    await page.goto(base + '/?businessContext=dar&educationSchedule=groups', { waitUntil: 'domcontentloaded' });
    await page.locator('#educationGroupsPanel').waitFor({ state: 'visible' });
    // Read-only explicit probes resolve with real responses and persist metadata only.
    result.probes = await page.evaluate(async () => {
        const records = [];
        for (const route of ['/api/staff?active=true', '/api/education/groups?businessContext=dar&includeArchived=true']) {
            const response = await fetch(route, { headers: getAuthHeaders() }); const body = await response.json();
            records.push({ path: route.split('?')[0], status: response.status,
                code: /^[a-zA-Z0-9_:-]{1,100}$/.test(body.code || '') ? body.code : null,
                count: Array.isArray(body) ? body.length : Array.isArray(body.groups) ? body.groups.length : null });
        }
        return records;
    });
    await snapshot(stage);
    stage = 'dar-reports-direct';
    let responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/education/reports');
    await page.goto(base + '/?businessContext=dar&educationSchedule=reports', { waitUntil: 'domcontentloaded' });
    let response = await responsePromise; await response.finished();
    await page.locator('#educationReportsPanel').waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await snapshot(stage);
    stage = 'dar-reports-reload';
    responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/education/reports');
    await page.reload({ waitUntil: 'domcontentloaded' }); response = await responsePromise; await response.finished();
    await page.locator('#educationReportsPanel').waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await snapshot(stage);
    for(const view of ['today','attendance','schedule']){
        stage='dar-'+view;await page.goto(base+'/?businessContext=dar&educationSchedule='+view,{waitUntil:'domcontentloaded'});
        await page.locator('[data-education-schedule-tab="'+view+'"]').waitFor({state:'visible'});
        await page.waitForFunction(view=>window.EducationScheduleWorkspace?.state.activeView===view&&!window.EducationScheduleWorkspace.state.loading,view);
        await snapshot(stage);
        const controls=await page.locator('#educationScheduleWorkspace button').evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length).map(el=>({id:el.id,className:el.className,radius:getComputedStyle(el).borderRadius,height:el.getBoundingClientRect().height,font:getComputedStyle(el).fontFamily})));
        assert.ok(controls.length>0,'Empty controls are not a design check');result.snapshots.at(-1).visibleControls=controls;
        assert.ok(controls.every(row=>row.className&&row.height>=24&&parseFloat(row.radius)>0),'Unstyled or zero-size controls');
        if(view==='schedule'){
            try {
                await page.locator('.timeline-container').waitFor({state:'visible'});
                await page.waitForFunction(()=>document.querySelector('.timeline-container')?.getBoundingClientRect().height>=120,null,{timeout:10000});
            } catch(error){result.failedChecks.push({id:'live-visible-schedule',status:'FAIL',reason:'Required schedule surface did not become visible with usable height',type:error.name});}
            result.scheduleSurface=await page.locator('.timeline-container').evaluate(el=>({visible:el.getClientRects().length>0,height:el.getBoundingClientRect().height})).catch(()=>({visible:false,height:0}));
            const cards=page.locator('.booking-block[data-booking-id]').filter({visible:true});
            if(!await cards.count())result.blockedFixtures.push({id:'live-canonical-card',status:'BLOCKED_FIXTURE',reason:'No visible lesson on observed live date; no production seed allowed'});
            else {
                try{await cards.first().click();await page.locator('#bookingModal').waitFor({state:'visible'});assert.ok((await page.locator('#bookingDetails').innerText()).trim().length>0);result.canonicalCardVisible=true;await page.locator('#bookingModal .modal-close').click();}
                catch(error){result.failedChecks.push({id:'live-canonical-card',status:'FAIL',reason:'Existing visible card could not open',type:error.name});}
            }
        }
    }
    stage='park-schedule';await page.goto(base+'/?businessContext=event_genix',{waitUntil:'domcontentloaded'});await page.locator('#mainApp').waitFor({state:'visible'});await page.locator('.timeline-container').waitFor({state:'visible'});await page.waitForFunction(()=>window.TimelineBusinessContext?.current()?.apiValue==='event_genix');result.parkSurfaceVisible=true;
    result.afterFingerprint = await fingerprint(); result.profileAndCabinetUnchanged = result.beforeFingerprint === result.afterFingerprint;
    const unresolved=result.diagnostics.filter(row=>row.classification==='UNCLASSIFIED_FAILURE');
    result.status = !result.profileAndCabinetUnchanged||result.pageErrors.length||unresolved.length||result.failedChecks.length ? 'FAIL' : result.blockedFixtures.length ? 'BLOCKED_FIXTURE' : 'READONLY_OBSERVATION_COMPLETE';
    if (result.status !== 'READONLY_OBSERVATION_COMPLETE') process.exitCode = 1;
}
main().catch(error => { result.status = 'FAIL_OR_BLOCKED_ENV'; result.errorType = error.name; result.failureStage=stage; process.exitCode = 1; }).finally(async () => {
    await Promise.allSettled([...pending]); await browser?.close(); fs.mkdirSync(path.dirname(out), { recursive: true });
    result.observerUnchanged=observerHash()===result.observerHarnessHash;if(!result.observerUnchanged){result.status='FAIL_STALE_OBSERVER';process.exitCode=1;}
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`Education live read-only: ${result.status}`);
});
