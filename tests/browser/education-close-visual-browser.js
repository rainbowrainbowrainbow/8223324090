'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Pool}=require('pg');const {chromium}=require(process.env.EDU_QA_PLAYWRIGHT);
const {DATABASES,OWNER_KEY,preflight,seedDataset,assertLocalTarget}=require('../../scripts/lib/education-ready-dataset');
const phase=process.env.EDU_VISUAL_PHASE||'before',base=process.env.TEST_URL||'http://127.0.0.1:3012';
assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
const username=process.env.TEST_USER||process.env.LIVE_CREATOR_USER,password=process.env.TEST_PASS||process.env.LIVE_CREATOR_PASS;
assert.ok(['before','after'].includes(phase));
const stage=['07','08'].includes(process.env.EDU_READY_STAGE)?process.env.EDU_READY_STAGE:'06';
const out=path.resolve(process.env.EDU_READY_RUN_ROOT || `output/education-ready/${stage}`,`${phase}-visual-${new Date().toISOString().replace(/[:.]/g,'-')}`);fs.mkdirSync(out,{recursive:true});
const evidence={phase,status:'NOT RUN',screenshots:[],audits:[],blockedWrites:[],pageErrors:[]};
const crypto=require('node:crypto');
const sourceFiles=['index.html','timeline-settings.html','css/education-schedule.css','js/booking.js','js/education-groups.js','js/education-attendance.js','js/education-schedule.js','js/settings.js','js/timeline-context.js','js/timeline-settings-page.js'];
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const pool=new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:process.env.TEST_URL?DATABASES.fixed:DATABASES.demo,ssl:false});let browser,diagnosticPage;
async function proof(){const manifest=JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1',[OWNER_KEY])).rows[0].value);return{manifest,preflight:await preflight(pool,manifest)};}
async function audit(page,label){
    evidence.audits.push(await page.evaluate(label=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const pixel=canvas.getContext('2d',{willReadFrequently:true});
        const colorCache=new Map();const rgb=color=>{if(colorCache.has(color))return colorCache.get(color);pixel.clearRect(0,0,1,1);pixel.fillStyle=color;pixel.fillRect(0,0,1,1);const c=pixel.getImageData(0,0,1,1).data,value=[c[0],c[1],c[2],c[3]/255];colorCache.set(color,value);return value;};
        const mix=(fg,bg)=>{const a=fg[3]??1;return fg.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a));};
        const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
        const visible=el=>Boolean(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
        const backgroundCache=new WeakMap();function background(el){if(backgroundCache.has(el))return backgroundCache.get(el);const parent=el.parentElement?background(el.parentElement):{colors:[[255,255,255]],gradient:false},s=getComputedStyle(el);let colors=parent.colors.map(color=>mix(rgb(s.backgroundColor),color)),gradient=parent.gradient;const stops=[...s.backgroundImage.matchAll(/(?:rgba?|hsla?|color|oklab|oklch|lab|lch)\([^)]*\)|\btransparent\b|#[0-9a-f]{3,8}\b/gi)].map(match=>rgb(match[0]));if(stops.length){gradient=true;const samples=[];for(let i=1;i<stops.length;i++)for(let step=0;step<=20;step++)samples.push(stops[i-1].map((v,j)=>v+(stops[i][j]-v)*step/20));colors=colors.flatMap(color=>samples.map(sample=>mix(sample,color)));}colors=[...new Map(colors.map(c=>[c.join(','),c])).values()];const value={colors,gradient};backgroundCache.set(el,value);return value;}
        const roots=[...document.querySelectorAll('#educationScheduleWorkspace,#bookingPanel:not(.hidden),#bookingModal:not(.hidden),#educationSeriesModal:not(.hidden),#settingsTimelineDisplaySection,.timeline-settings-shell,.timeline-settings-hero')].filter(visible);
        const controls=[],contrast=[];
        for(const root of roots)for(const el of root.querySelectorAll('*')){
            if(!visible(el)||el.disabled||el.closest('[inert],[aria-hidden="true"]'))continue;
            const ownText=Array.from(el.childNodes).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
            const placeholder=!el.value&&el.placeholder;
            const textValue=ownText||el.value||placeholder;
            const s=getComputedStyle(el),backgrounds=background(el);
            if(el.tagName==='BUTTON')controls.push({id:el.id,text:el.textContent.trim(),radius:s.borderRadius,font:s.fontFamily,height:el.getBoundingClientRect().height,background:s.backgroundColor,className:el.className});
            if(!textValue)continue;
            const textStyle=placeholder?getComputedStyle(el,'::placeholder'):s;
            const ratio=Math.min(...backgrounds.colors.map(bg=>{const a=luminance(mix(rgb(textStyle.color),bg)),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);})),size=parseFloat(s.fontSize),large=size>=24||(size>=18.66&&Number(s.fontWeight)>=700);
            contrast.push({selector:el.id?'#'+el.id:el.className||el.tagName,text:String(textValue).slice(0,70),placeholder:Boolean(placeholder),ratio:Number(ratio.toFixed(2)),minimum:large?3:4.5,gradient:backgrounds.gradient});
            if(!Number.isFinite(ratio)){const chain=[];for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(style.backgroundImage!=='none')chain.push(style.backgroundImage);}contrast.at(-1).unparsedBackgrounds=chain;}
        }
        return {label,theme:document.documentElement.dataset.theme,controls,contrast,legendVisible:visible(document.querySelector('.legend')),minimapVisible:visible(document.getElementById('minimapContainer')),workspaceWidth:document.getElementById('educationScheduleWorkspace')?.getBoundingClientRect().width};
    },label));
}
async function shot(page,name,onCaptured){
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(secret=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;window.__visualRedactions=[];while((node=walker.nextNode()))if(secret&&node.nodeValue.includes(secret)){window.__visualRedactions.push([node,node.nodeValue]);node.nodeValue=node.nodeValue.split(secret).join('[REDACTED]');}},username);
    try{await page.screenshot({path:path.join(out,name+'.png')});evidence.screenshots.push(name+'.png');onCaptured?.();await audit(page,name);}
    finally{await page.evaluate(()=>{for(const [node,value]of window.__visualRedactions||[])if(node.isConnected)node.nodeValue=value;delete window.__visualRedactions;});}
    fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(evidence,null,2));console.log('Captured '+name);
}
(async()=>{
    assert.ok(username&&password,'Private preview credentials unavailable');
    if(process.env.TEST_URL){
        assertLocalTarget('fixed');await seedDataset(pool,'fixed');
        const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
        assert.equal(login.status,200);const auth=await login.json(),token=auth.accessToken||auth.token;
        for(const businessContext of ['dar','maysternya_doli']){
            const response=await fetch(base+`/api/business/cabinet?businessContext=${businessContext}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({businessType:'education',timelineMode:'education',resourceModel:'cabinet'})});
            assert.equal(response.status,200,'Disposable education context prerequisite');
        }
        evidence.fixturePreparation='SQL seed and local API business profile before any UI scenario; no failed UI step is repaired';
    }
    const before=await proof(),m=before.manifest;evidence.sourceHashes=hashes();browser=await chromium.launch({headless:true});
    const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Kyiv',viewport:{width:1440,height:1000}});
    await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();
        if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!/^\/api\/auth\/(login|refresh|verify)$/.test(url.pathname)){evidence.blockedWrites.push({method:req.method(),path:url.pathname});return route.fulfill({status:503,json:{error:'Не вдалося зберегти. Спробуйте ще раз.'}});}return route.continue();});
    if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>socket.close());
    const page=await context.newPage();diagnosticPage=page;page.setDefaultTimeout(20000);page.on('pageerror',error=>evidence.pageErrors.push(error.name));page.on('dialog',dialog=>dialog.accept());
    evidence.failedReads=[];evidence.routeErrors=[];evidence.cancelledReadRoutes=0;page.on('response',response=>{const url=new URL(response.url());if(response.request().method()==='GET'&&response.status()>=400&&url.pathname.startsWith('/api/'))evidence.failedReads.push({path:url.pathname,status:response.status()});});
    await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#username').fill(username);await page.locator('#password').fill(password);await page.locator('#loginForm button[type="submit"]').click();await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});
    async function go(view,date=m.anchorDate,extra=''){await page.goto(`${base}/?businessContext=dar&educationSchedule=${view}&date=${date}${extra}`,{waitUntil:'domcontentloaded'});await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await page.waitForFunction(view=>window.EducationScheduleWorkspace?.state.activeView===view,view);}
    async function theme(value){if(await page.evaluate(()=>document.documentElement.dataset.theme)!==value)await page.locator('#headerThemeToggle').click();await page.waitForFunction(value=>document.documentElement.dataset.theme===value&&document.body.classList.contains('dark-mode')===(value==='dark'),value);await page.evaluate(async()=>{getComputedStyle(document.body).backgroundColor;await Promise.allSettled(document.getAnimations().filter(a=>a instanceof CSSTransition).map(a=>a.finished));});}
    if(process.env.EDU_VISUAL_STATIC_REFERENCE==='settings'){
        assert.equal(phase,'before');const {execFileSync}=require('node:child_process');
        const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
        assert.equal(revision,'56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e');
        evidence.staticReference={revision,kind:'Reconstructed pre06 settings/series static source over actual local Express API',files:['timeline-settings.html','js/timeline-settings-page.js','js/booking.js','css/education-schedule.css']};
        for(const file of evidence.staticReference.files){const body=execFileSync('git',['show',`${revision}:${file}`],{encoding:'utf8',windowsHide:true});const wanted='/'+file;
            await context.route(url=>url.pathname===wanted||(file==='timeline-settings.html'&&url.pathname==='/timeline-settings'),route=>route.fulfill({status:200,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript',body}));}
        for(const mode of ['light','dark']){await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#mainApp').waitFor({state:'visible'});await theme(mode);await page.goto(base+'/timeline-settings?businessContext=dar',{waitUntil:'domcontentloaded'});await page.locator('[data-timeline-settings-block]').first().waitFor({state:'visible'});await page.locator('#timelineSettingsInspector h3').waitFor({state:'visible'});await shot(page,'settings-blocks-reconstructed-'+mode);
            for(const tab of ['visual','presets','system']){await page.locator(`[data-timeline-settings-tab="${tab}"]`).click();await page.locator(`[data-timeline-settings-panel="${tab}"].active`).waitFor({state:'visible'});await shot(page,'settings-'+tab+'-reconstructed-'+mode);}
            await go('today',m.plan.lessons.find(l=>l.key==='english-5').date);await page.locator(`[data-education-booking-id="${m.ids.bookings['english-5']}"]`).click();await page.locator('#bookingModal').waitFor({state:'visible'});await page.locator('#bookingModal').getByRole('button',{name:'Відкрити серію'}).click();await page.locator('.education-series-row').first().waitFor({state:'visible'});await shot(page,'series-reconstructed-'+mode);}
    }
    for(const mode of process.env.EDU_VISUAL_STATIC_REFERENCE==='settings'||process.env.EDU_VISUAL_THEME==='park'?[]:process.env.EDU_VISUAL_THEME?[process.env.EDU_VISUAL_THEME]:['dark','light']){
        await go('today');await theme(mode);await page.waitForFunction(()=>!window.EducationScheduleWorkspace.state.loading&&document.querySelectorAll('[data-education-booking-id]').length===4);await shot(page,'today-'+mode);
        if(phase==='after'){
            const pattern='**/api/bookings/2030-01-29*';let release,arrive;const gate=new Promise(r=>release=r),entered=new Promise(r=>arrive=r);
            await page.route(pattern,async route=>{try{const response=await route.fetch();arrive();await gate;await route.fulfill({response});}catch(error){if(route.request().failure())evidence.cancelledReadRoutes++;else evidence.routeErrors.push(error.name);}});
            try{await go('today','2030-01-29');await entered;await page.waitForFunction(()=>window.EducationScheduleWorkspace.state.loading);await shot(page,'today-loading-'+mode,release);}finally{release();}
            await page.locator('.education-today-empty:not(button)').waitFor({state:'visible'});await page.unrouteAll({behavior:'wait'});
            assert.deepEqual(evidence.routeErrors,[],'Unexplained intercepted read failure');
            const errorPattern='**/api/bookings/2030-01-30*';await page.route(errorPattern,route=>route.fulfill({status:503,json:{error:'Controlled read failure'}}));
            await go('today','2030-01-30');await page.locator('[data-education-retry]').waitFor({state:'visible'});await shot(page,'today-error-'+mode);await page.unrouteAll({behavior:'wait'});await page.locator('[data-education-retry]').click();await page.locator('.education-today-empty:not(button)').waitFor({state:'visible'});
            evidence.controlledReadFault='/api/bookings/2030-01-30';await go('today');await page.waitForFunction(()=>document.querySelectorAll('[data-education-booking-id]').length===4);
        }
        for(const group of ['english','arts','empty','archive']){await page.locator('[data-education-schedule-tab="groups"]').click();await page.locator(`#educationGroupsList option[value="${m.ids.groups[group]}"]`).waitFor({state:'attached'});await page.locator('#educationGroupsList').selectOption(String(m.ids.groups[group]));await page.waitForFunction(id=>String(window.EducationGroups.state.current?.id)===String(id),m.ids.groups[group]);await shot(page,'group-'+group+'-'+mode);
            if(phase==='after'&&group==='english'){await page.locator('#educationGroupCapacity').press('Tab');assert.equal(await page.locator('#educationGroupForm button[type="submit"]').evaluate(el=>el.matches(':focus-visible')),true);await shot(page,'group-keyboard-focus-'+mode);await page.locator('#educationGroupArchive').hover();await shot(page,'group-archive-hover-'+mode);}}
        await page.locator('#educationGroupsList').selectOption('');await page.locator('#educationGroupName').fill('Суботня майстерня — відкриваємо світ');await shot(page,'group-new-'+mode);
        if(phase==='after'){
            let release,arrive;const gate=new Promise(r=>release=r),entered=new Promise(r=>arrive=r),writePattern=url=>url.pathname==='/api/education/groups/';
            await page.route(writePattern,async route=>{if(route.request().method()!=='POST')return route.fallback();evidence.blockedWrites.push({method:'POST',path:'/api/education/groups/',reason:'Blocked pending-save visual state'});arrive();await gate;await route.fulfill({status:503,json:{error:'Не вдалося зберегти. Спробуйте ще раз.'}});});
            try{await page.locator('#educationGroupForm button[type="submit"]').click();await entered;assert.equal(await page.locator('#educationGroupForm button[type="submit"]').isDisabled(),true);await shot(page,'group-saving-disabled-'+mode,release);}finally{release();}
            await page.waitForFunction(()=>document.getElementById('educationGroupsStatus').textContent.includes('Не вдалося'));await page.unrouteAll({behavior:'wait'});
        }else{await page.locator('#educationGroupForm button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('educationGroupsStatus').textContent.includes('Не вдалося'));}
        assert.equal(await page.locator('#educationGroupName').inputValue(),'Суботня майстерня — відкриваємо світ');await shot(page,'group-error-draft-'+mode);
        await go('attendance',m.anchorDate,`&educationAttendanceDate=${m.plan.lessons.find(l=>l.key==='english-3').date}&educationJournal=${m.ids.bookings['english-3']}`);
        await page.waitForFunction(()=>window.EducationAttendance?.state.journal&&!window.EducationAttendance.state.journalLoading&&!window.EducationAttendance.state.loading);await shot(page,'journal-'+mode);await page.locator('#educationAttendanceSave').scrollIntoViewIfNeeded();await shot(page,'journal-actions-'+mode);
        await go('reports',m.anchorDate,'&educationReportFrom=2026-08-04&educationReportTo=2026-10-02');await page.locator('.education-report-summary').waitFor({state:'visible'});await page.waitForFunction(()=>!window.EducationAttendance.state.reportLoading);await shot(page,'reports-'+mode);
        await go('schedule');await page.locator(`.booking-block[data-booking-id="${m.ids.bookings['robots-4']}"]`).first().waitFor({state:'visible'});await shot(page,'schedule-day-'+mode);await page.locator('#timelineViewPanelToggle').click();await page.locator('[data-schedule-view-mode="week"]').click();await page.locator('.multi-day-container').waitFor({state:'visible'});await page.locator('.mini-booking-block').first().waitFor({state:'visible'});await shot(page,'schedule-week-'+mode);await page.locator('[data-schedule-view-mode="day"]').click();await page.locator('.booking-block').first().waitFor({state:'visible'});
        await go('today');await page.locator(`[data-education-booking-id="${m.ids.bookings['robots-4']}"]`).click();await page.locator('#bookingModal').waitFor({state:'visible'});await shot(page,'canonical-card-'+mode);
        await page.locator('#bookingModal .btn-edit-booking').click();await page.waitForFunction(()=>document.getElementById('educationLessonDuration').value==='45'&&!document.getElementById('bookingForm').inert);await page.locator('#educationLessonTitle').scrollIntoViewIfNeeded();await shot(page,'lesson-edit-'+mode);await page.locator('#bookingSubmitBtn').scrollIntoViewIfNeeded();await shot(page,'lesson-edit-actions-'+mode);
        await go('today',m.plan.lessons.find(l=>l.key==='english-5').date);await page.locator(`[data-education-booking-id="${m.ids.bookings['english-5']}"]`).click();await page.locator('#bookingModal').waitFor({state:'visible'});await page.locator('#bookingModal').getByRole('button',{name:'Відкрити серію'}).click();await page.locator('.education-series-row').first().waitFor({state:'visible'});await shot(page,'series-'+mode);
        await go('schedule','2030-01-10');await page.locator('.grid-cell[data-time="15:00"][data-line="edu-cabinet-1"]').first().click();await page.locator('#educationLessonTitle').waitFor({state:'visible'});await page.locator('#educationLessonTitle').fill('Світло і тінь — досліджуємо разом');await page.locator('#educationLessonTitle').scrollIntoViewIfNeeded();await shot(page,'lesson-create-'+mode);
        await go('today',m.anchorDate,'&open=settings');await page.locator('#settingsModal').waitFor({state:'visible',timeout:45000});await page.locator('#settingsTimelineDisplaySection').scrollIntoViewIfNeeded();await shot(page,'education-settings-'+mode);await page.locator('#settingsSaveTimelineDisplayBtn').scrollIntoViewIfNeeded();await shot(page,'education-settings-actions-'+mode);
        await page.goto(base+'/timeline-settings?businessContext=dar',{waitUntil:'domcontentloaded'});await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await page.locator('[data-timeline-settings-block]').first().waitFor({state:'visible'});await page.locator('#timelineSettingsInspector h3').waitFor({state:'visible'});await shot(page,'education-settings-page-'+mode);
        for(const tab of ['visual','presets','system']){await page.locator(`[data-timeline-settings-tab="${tab}"]`).click();await page.locator(`[data-timeline-settings-panel="${tab}"].active`).waitFor({state:'visible'});await shot(page,'education-settings-'+tab+'-'+mode);}
        await go('today','2030-01-09');await page.locator('.education-today-empty').waitFor({state:'visible'});await shot(page,'today-empty-'+mode);
    }
    await page.goto(base+'/?businessContext=event_genix&date=2026-10-03',{waitUntil:'domcontentloaded'});await page.locator('#mainApp').waitFor({state:'visible',timeout:45000});await page.waitForFunction(()=>window.TimelineBusinessContext?.presentation?.().mode==='park');
    await theme('dark');evidence.parkStyles=await page.locator('.legend').evaluate(el=>({display:getComputedStyle(el).display,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));await shot(page,'park-reference');
    if(phase==='after'){
        const baseline=JSON.parse(fs.readFileSync('output/education-ready/close03/before/before-visual-2026-10-04T17-52-46-757Z/verification.json'));
        await page.waitForFunction(expected=>{const s=getComputedStyle(document.querySelector('.legend'));return s.color===expected.color&&s.backgroundColor===expected.background;},baseline.parkStyles);evidence.parkStyles=await page.locator('.legend').evaluate(el=>({display:getComputedStyle(el).display,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));assert.deepEqual(evidence.parkStyles,baseline.parkStyles,'Park legend style drift');
        for(const item of evidence.audits.filter(a=>/^(today|group|journal|reports)/.test(a.label)))assert.equal(item.legendVisible||item.minimapVisible,false,'Non-schedule timeline chrome visible');
        for(const item of evidence.audits.filter(a=>a.label.startsWith('schedule')))assert.equal(item.legendVisible,true,'Schedule legend missing');
        await go('groups');await page.setViewportSize({width:390,height:844});await page.locator('#educationGroupsList').selectOption(String(m.ids.groups.empty));await page.waitForFunction(()=>window.EducationGroups.state.detailStatus==='ready');await page.locator('#educationGroupForm button[type="submit"]').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#educationGroupForm button[type="submit"]').isVisible(),true);await shot(page,'groups-390-observation');
        evidence.smallViewport='Real group selection and scroll at390px; whole-app accessibility/overflow acceptance deferred to07';
    }
    await page.unrouteAll({behavior:'wait'});const after=await proof();assert.deepEqual(after,before);assert.deepEqual(hashes(),evidence.sourceHashes,'Product source changed during capture');evidence.retainedDatasetUnchanged=true;evidence.preflight=after.preflight;assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.routeErrors,[],'Late intercepted read failure');
    if(phase==='after')assert.deepEqual(evidence.failedReads.filter(r=>/^\/api\/(education|bookings)/.test(r.path)&&r.path!==evidence.controlledReadFault),[],'Unexpected critical education GET failure');
    evidence.contrastFailures=evidence.audits.flatMap(a=>a.contrast.filter(c=>c.ratio==null||c.ratio<c.minimum).map(c=>({screen:a.label,...c})));
    evidence.unstyledButtons=evidence.audits.flatMap(a=>a.controls.filter(c=>parseFloat(c.radius)<6||c.height<32).map(c=>({screen:a.label,...c})));
    evidence.status=phase==='before'?'BASELINE_RECORDED':(evidence.contrastFailures.length||evidence.unstyledButtons.length?'FAIL':'PASS');
    if(evidence.status==='FAIL')process.exitCode=1;
})().catch(async error=>{evidence.status='FAIL_OR_BLOCKED';evidence.error=error.message;process.exitCode=1;evidence.diagnostic=await diagnosticPage?.evaluate(()=>({url:location.pathname+location.search,date:document.getElementById('timelineDate')?.value,desiredDate:window.EducationScheduleWorkspace?.state.date,view:window.EducationScheduleWorkspace?.state.activeView,loading:window.EducationScheduleWorkspace?.state.loading,error:Boolean(window.EducationScheduleWorkspace?.state.error),cards:document.querySelectorAll('[data-education-booking-id]').length,business:window.CrmBusinessContext?.current?.(),theme:document.documentElement.dataset.theme})).catch(()=>null);}).finally(async()=>{await browser?.close();await pool.end();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(evidence,null,2));console.log('Visual preview '+evidence.status+' '+path.basename(out));});
