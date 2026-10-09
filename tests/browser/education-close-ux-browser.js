'use strict';
// Actual-app read-only layout/a11y checks. Business writes are blocked before login.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const playwright = require(process.env.EDU_QA_PLAYWRIGHT);
const { DATABASES, OWNER_KEY, preflight, seedDataset, assertLocalTarget } = require('../../scripts/lib/education-ready-dataset');
const base = process.env.TEST_URL || 'http://127.0.0.1:3012';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const engine = process.env.EDU_MOBILE_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const phase = process.env.EDU_MOBILE_PHASE || 'after';
const out = path.resolve(process.env.EDU_READY_RUN_ROOT || `output/education-ready/${process.env.EDU_READY_STAGE === '08' ? '08' : '07'}`, `${phase}-${engine}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const evidence = { attemptId: process.env.EDU_CLOSE_ATTEMPT_ID, suite: process.env.EDU_CLOSE_SUITE, audits: [], scope: 'Presentation/emulation checks; canonical card assertions are in teachers/journey; no release GO', engine, phase, status: 'NOT_RUN', checks: [], screens: [], blockedWrites: [], pageErrors: [], failedReads: [], failedRequests: [], sourceHashes: {},
    harnessHash: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex') };
const files = [__filename, 'index.html', 'css/education-schedule.css', 'js/booking.js', 'js/education-attendance.js', 'js/education-schedule.js', 'js/timeline-settings-page.js'];
const hashes = () => Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const pool = new Pool({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 55469), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD, database: process.env.PGDATABASE || DATABASES.fixed, ssl: false });
const username = process.env.TEST_USER || process.env.LIVE_CREATOR_USER;
const password = process.env.TEST_PASS || process.env.LIVE_CREATOR_PASS;
const profiles = [
    { name: 'desktop-1440', width: 1440, height: 1000, touch: false },
    { name: 'phone-320', width: 320, height: 740, touch: true },
    { name: 'iphone-390', width: 390, height: 844, touch: true },
    { name: 'phone-landscape', width: 844, height: 390, touch: true },
    { name: 'tablet-768', width: 768, height: 1024, touch: true },
    { name: 'tablet-landscape', width: 1024, height: 768, touch: true },
    { name: 'reflow-200', width: 640, height: 800, touch: false }
].filter(p => !process.env.EDU_MOBILE_PROFILE || p.name === process.env.EDU_MOBILE_PROFILE);
evidence.profiles = profiles;
evidence.completedProfiles = [];
evidence.visibilityReads = [];
let browser, context, page;
async function proof() {
    const manifest = JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1', [OWNER_KEY])).rows[0].value);
    return { manifest, preflight: await preflight(pool, manifest) };
}
async function check(name, action) {
    try { const details = await action(); evidence.checks.push({ name, status: 'PASS', details }); }
    catch (error) { evidence.checks.push({ name, status: 'FAIL', error: error.message }); }
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(evidence, null, 2));
}
async function measureContrast(page,label){
    evidence.audits.push(await page.evaluate(label=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const pixel=canvas.getContext('2d',{willReadFrequently:true});
        const colorCache=new Map();const rgb=color=>{if(colorCache.has(color))return colorCache.get(color);pixel.clearRect(0,0,1,1);pixel.fillStyle=color;pixel.fillRect(0,0,1,1);const c=pixel.getImageData(0,0,1,1).data,value=[c[0],c[1],c[2],c[3]/255];colorCache.set(color,value);return value;};
        const mix=(fg,bg)=>{const a=fg[3]??1;return fg.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a));};
        const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
        const visible=el=>Boolean(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
        const backgroundCache=new WeakMap();function background(el){if(backgroundCache.has(el))return backgroundCache.get(el);const parent=el.parentElement?background(el.parentElement):{colors:[[255,255,255]],gradient:false},s=getComputedStyle(el);let colors=parent.colors.map(color=>mix(rgb(s.backgroundColor),color)),gradient=parent.gradient;const stops=[...s.backgroundImage.matchAll(/(?:rgba?|hsla?|color|oklab|oklch|lab|lch)\([^)]*\)|\btransparent\b|#[0-9a-f]{3,8}\b/gi)].map(match=>rgb(match[0]));if(stops.length){gradient=true;const samples=[];for(let i=1;i<stops.length;i++)for(let step=0;step<=20;step++)samples.push(stops[i-1].map((v,j)=>v+(stops[i][j]-v)*step/20));colors=colors.flatMap(color=>samples.map(sample=>mix(sample,color)));}colors=[...new Map(colors.map(c=>[c.join(','),c])).values()];const value={colors,gradient};backgroundCache.set(el,value);return value;}
        const roots=[...document.querySelectorAll('#educationScheduleWorkspace,#bookingPanel:not(.hidden),#bookingModal:not(.hidden),#educationSeriesModal:not(.hidden),#settingsTimelineDisplaySection,.timeline-settings-shell,.timeline-settings-hero,body.timeline-mode-education .line-header')].filter(visible);
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

async function capture(name, rootSelector) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async selector => {
        document.querySelector(selector)?.getBoundingClientRect();
        await Promise.allSettled(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished));
    }, rootSelector);
    // Redact only private account text; synthetic names remain visible.
    await page.evaluate(secret => { window.__mobileRedactions = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode())) if (secret && node.nodeValue.includes(secret)) {
            window.__mobileRedactions.push([node, node.nodeValue]); node.nodeValue = node.nodeValue.split(secret).join('[REDACTED]');
        }
    }, username);
    let audit;
    try {
        await page.screenshot({ path: path.join(out, name + '.png') });
        audit = await page.evaluate(rootSelector => {
            const visible = el => {
                const closedDetails = el.closest('details:not([open])');
                return Boolean(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]')
                    && (!closedDetails || closedDetails === el || closedDetails.querySelector('summary')?.contains(el)));
            };
            const roots = [...document.querySelectorAll(rootSelector)].filter(visible);
            const key = el => el.id ? '#' + el.id : el.className || el.tagName;
            const overflow = [], controls = [], missingNames = [], tinyTextInputs = [], inputBoundaries = [];
            const canvas = document.createElement('canvas'), pixel = canvas.getContext('2d');
            const rgb = color => { pixel.clearRect(0, 0, 1, 1); pixel.fillStyle = color; pixel.fillRect(0, 0, 1, 1); return [...pixel.getImageData(0, 0, 1, 1).data].slice(0, 3); };
            const luminance = c => c.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
            const named = el => Boolean(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.labels?.length || el.textContent.trim() || el.getAttribute('title'));
            for (const root of roots) for (const el of [root, ...root.querySelectorAll('*')]) {
                if (!visible(el)) continue;
                const rect = el.getBoundingClientRect();
                // Intentional table/timeline scrolling must be contained by a fitting region.
                const scrollAncestor = el.parentElement?.closest('.education-report-table-wrap,.timeline-container,.multi-day-container,.education-schedule-tabs');
                if (!scrollAncestor && (rect.left < -1 || rect.right > innerWidth + 1)) overflow.push({ selector: key(el), left: Math.round(rect.left), right: Math.round(rect.right) });
                if (el.matches('button,a[href],input:not([type="hidden"]),select,textarea,summary,[role="button"]') && !el.disabled) {
                    const hit = el.matches('input[type="checkbox"],input[type="radio"]') && el.labels?.[0] ? el.labels[0].getBoundingClientRect() : rect;
                    controls.push({ selector: key(el), width: +hit.width.toFixed(1), height: +hit.height.toFixed(1), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 65) });
                    if (!named(el)) missingNames.push(key(el));
                    if (el.matches('input:not([type="checkbox"]):not([type="radio"]),select,textarea') && parseFloat(getComputedStyle(el).fontSize) < 16) tinyTextInputs.push(key(el));
                    if (el.matches('input:not([type="checkbox"]):not([type="radio"]),select,textarea')) {
                        const style = getComputedStyle(el), a = luminance(rgb(style.borderTopColor)), b = luminance(rgb(style.backgroundColor));
                        inputBoundaries.push({ selector: key(el), ratio: +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2) });
                    }
                }
            }
            const unexpectedFonts = roots.flatMap(root => [...root.querySelectorAll('.education-schedule-tab,.education-lesson-card')].filter(visible)
                .map(el => ({ selector: key(el), family: getComputedStyle(el).fontFamily })))
                .filter(row => /Times New Roman|^serif$/i.test(row.family));
            return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow, controls, missingNames, tinyTextInputs, inputBoundaries, unexpectedFonts,
                touch: matchMedia('(pointer: coarse)').matches, viewportMeta: document.querySelector('meta[name="viewport"]')?.content,
                dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).map(el => ({ id: el.id, modal: el.getAttribute('aria-modal'), name: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') })) };
        }, rootSelector);
    } finally { await page.evaluate(() => { for (const [node, value] of window.__mobileRedactions || []) if (node.isConnected) node.nodeValue = value; delete window.__mobileRedactions; }); }
    evidence.screens.push({ name, file: name + '.png', audit });
    await measureContrast(page, name);
    const contrast = evidence.audits.at(-1).contrast;
    await check(name + ':text-contrast', () => assert.deepEqual(contrast.filter(row => row.ratio == null || row.ratio < row.minimum), [], 'Text contrast below measured WCAG threshold'));
    await check(name + ':layout', () => { assert.ok(audit.documentWidth <= audit.width + 1, `Document overflow ${audit.documentWidth}/${audit.width}`); assert.deepEqual(audit.overflow, [], 'Visible content outside viewport'); });
    await check(name + ':names', () => assert.deepEqual(audit.missingNames, [], 'Unnamed controls'));
    await check(name + ':crm-font', () => assert.deepEqual(audit.unexpectedFonts, [], 'Education navigation/cards must use the CRM font'));
    await check(name + ':touch-targets', () => assert.deepEqual(audit.controls.filter(c => c.width < (audit.touch ? 44 : 24) || c.height < (audit.touch ? 44 : 24)), [], 'Controls need44px touch /24px mouse targets'));
    await check(name + ':input-text', () => assert.deepEqual(audit.touch ? audit.tinyTextInputs : [], [], 'Touch text inputs need16px to avoid iOS focus zoom'));
    await check(name + ':input-boundaries', () => assert.deepEqual(audit.inputBoundaries.filter(c => c.ratio < 3), [], 'Input boundaries need contrast3:1 against their surface'));
    console.log(name + ' captured');
}
async function parkScreenshot(name) {
    await page.evaluate(secret => { const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let node; while((node=walker.nextNode())) if(secret&&node.nodeValue.includes(secret)) node.nodeValue=node.nodeValue.split(secret).join('[REDACTED]'); }, username);
    await page.screenshot({path:path.join(out,name+'.png')});
    evidence.screens.push({name,file:name+'.png',scope:'Park behavior smoke; no education-only44px/contrast threshold imposed on unchanged legacy surface'});
}
async function trap(selector, name) {
    await check(name, async () => {
        await page.waitForFunction(selector => document.querySelector(selector).contains(document.activeElement), selector);
        const first = await page.evaluate(() => document.activeElement.id || document.activeElement.outerHTML.slice(0, 160));
        let wrapped = false;
        for (let i = 0; i < 80; i++) {
            await page.keyboard.press('Tab');
            assert.equal(await page.locator(selector).evaluate(el => el.contains(document.activeElement)), true, 'Tab escaped dialog');
            if ((await page.evaluate(() => document.activeElement.id || document.activeElement.outerHTML.slice(0, 160))) === first) { wrapped = true; break; }
        }
        assert.equal(wrapped, true, 'Forward focus cycle did not wrap');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator(selector).evaluate(el => el.contains(document.activeElement)), true, 'Reverse Tab escaped dialog');
        await page.waitForFunction(() => document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2, null, { timeout: 3000 }).catch(() => {});
        const focus = await page.evaluate(() => { const el = document.activeElement, style = getComputedStyle(el); const rules = [];
            function visit(list) { for (const rule of list) { if (rule.selectorText && /outline/.test(rule.style.cssText)) {
                try { if (el.matches(rule.selectorText)) rules.push({ selector: rule.selectorText, outline: rule.style.getPropertyValue('outline'), priority: rule.style.getPropertyPriority('outline') }); } catch (_) {}
            } if (rule.cssRules) visit(rule.cssRules); } }
            for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch (_) {} }
            return { selector: el.id || el.className, visible: el.matches(':focus-visible'), width: style.outlineWidth, color: style.outlineColor, transition: style.transition, rules: rules.slice(-8) }; });
        assert.ok(focus.visible && parseFloat(focus.width) >= 2, 'Keyboard focus is not visibly outlined: ' + JSON.stringify(focus));
    });
}
(async () => {
    assert.ok(username && password, 'BLOCKED_FIXTURE: private credentials unavailable');
    if (process.env.TEST_URL) {
        assertLocalTarget('fixed'); await seedDataset(pool, 'fixed');
        const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        assert.equal(login.status, 200); const auth = await login.json();
        const response = await fetch(base + '/api/business/cabinet?businessContext=dar', { method: 'PUT', headers: { Authorization: `Bearer ${auth.accessToken || auth.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet' }) });
        assert.equal(response.status, 200, 'Disposable business prerequisite');
        const manual = await fetch(base+'/api/lines/2026-10-03/manual?businessContext=event_genix&timelineView=animators', {method:'POST',headers:{Authorization:'Bearer '+(auth.accessToken||auth.token),'Content-Type':'application/json'},body:JSON.stringify({requestId:'81a31461-1e2a-4270-9a5b-852bfb6a9321'})});
        assert.equal(manual.status,201,'BLOCKED_FIXTURE: owned Park manual line prerequisite');
        const manualLine = (await manual.json()).line;
        const manifest = JSON.parse((await pool.query('SELECT value FROM settings WHERE key=$1',[OWNER_KEY])).rows[0].value);
        await pool.query("UPDATE bookings SET line_id=$1 WHERE id=$2 AND business_context='event_genix'",[manualLine.id,manifest.ids.controlBooking]);
        evidence.fixturePreparation = 'Owned fixed seed, education profile and valid Park manual line/control association prepared before ALL UI steps in a fresh disposable attempt; no failed UI repair';
        evidence.parkFixtureLine = manualLine.id;
    }
    const before = await proof(), m = before.manifest;
    evidence.sourceHashes = hashes();
    browser = await playwright[engine].launch({ headless: true });
    evidence.browserVersion = browser.version();
    for (const profile of profiles) {
        const deviceName = profile.name.startsWith('tablet') ? (engine === 'webkit' ? 'iPad Pro 11' : 'Galaxy Tab S4') : (engine === 'webkit' ? 'iPhone 13' : 'Pixel 5');
        const userAgent = profile.touch ? playwright.devices[deviceName].userAgent : undefined;
        context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch,
            deviceScaleFactor: profile.touch ? 2 : 1, userAgent, locale: 'uk-UA', timezoneId: 'Europe/Kyiv', serviceWorkers: 'block', reducedMotion: 'reduce' });
        await context.route('**/*', route => { const request = route.request(), url = new URL(request.url());
            if (url.origin !== base) return route.abort();
            if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !/^\/api\/auth\/(login|refresh|verify)$/.test(url.pathname)) {
                evidence.blockedWrites.push({ method: request.method(), path: url.pathname });
                return route.fulfill({ status: 503, json: { error: 'Не вдалося зберегти. Спробуйте ще раз.' } });
            }
            return route.continue();
        });
        if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
        // UI login is a fixture prerequisite. Exercise the section in a fresh
        // page sharing that real session, without racing the login redirect.
        const loginPage = await context.newPage(); loginPage.setDefaultTimeout(45000);
        await loginPage.goto(`${base}/?businessContext=dar&educationSchedule=today&date=${m.anchorDate}`, { waitUntil: 'domcontentloaded' });
        await loginPage.locator('#username').fill(username); await loginPage.locator('#password').fill(password);
        await loginPage.locator('#loginForm button[type="submit"]').click();
        await loginPage.waitForURL(url => url.pathname === '/' && !url.search);
        await loginPage.waitForFunction(() => Boolean(document.getElementById('timelineDate')?.value && window.isAuthenticatedRuntimeReady?.()));
        await loginPage.waitForLoadState('networkidle');
        await loginPage.close();
        page = await context.newPage(); page.setDefaultTimeout(15000);
        page.on('pageerror', error => {
            let message = error.message, stack = error.stack || '';
            for (const value of [username, password].filter(Boolean)) { message = message.split(value).join('[REDACTED]'); stack = stack.split(value).join('[REDACTED]'); }
            evidence.pageErrors.push({ profile: profile.name, type: error.name, message, stack, page: new URL(page.url()).pathname });
        });
        page.on('response', response => { const url = new URL(response.url()); if (response.request().method() === 'GET' && response.status() >= 400 && /^\/api\/(education|bookings)/.test(url.pathname)) evidence.failedReads.push({ path: url.pathname, status: response.status() }); });
        page.on('requestfailed', request => { const url = new URL(request.url()); if (url.origin === base) evidence.failedRequests.push({ profile: profile.name, path: url.pathname, failure: request.failure()?.errorText, document: new URL(page.url()).pathname }); });
        const visibilityTrace = (event, request, detail = {}) => {
            const url = new URL(request.url());
            if (url.pathname !== '/api/settings/timeline-visibility') return;
            evidence.visibilityReads.push({ event, profile: profile.name, at: new Date().toISOString(),
                business: url.searchParams.get('businessContext'), view: url.searchParams.get('timelineView'),
                document: new URL(page.url()).pathname + new URL(page.url()).search, ...detail });
        };
        page.on('request', request => visibilityTrace('request', request));
        page.on('response', response => visibilityTrace('response', response.request(), { status: response.status() }));
        page.on('requestfinished', request => visibilityTrace('finished', request));
        page.on('requestfailed', request => visibilityTrace('failed', request, { failure: request.failure()?.errorText }));
        page.on('dialog', dialog => dialog.accept());
        await page.goto(`${base}/?businessContext=dar&educationSchedule=today&date=${m.anchorDate}`, { waitUntil: 'domcontentloaded' });
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
        await page.waitForFunction(date => document.getElementById('timelineDate')?.value === date && window.isAuthenticatedRuntimeReady?.()
            && document.querySelectorAll('[data-education-booking-id]').length === 4 && !window.EducationScheduleWorkspace.state.loading, m.anchorDate, { timeout: 45000 });
        const theme = profile.name === 'iphone-390' || profile.name === 'tablet-landscape' ? 'dark' : 'light';
        if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.locator('#headerThemeToggle').click();
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && document.body.classList.contains('dark-mode') === (theme === 'dark'), theme);
        const label = screen => profile.name + '-' + theme + '-' + screen;
        const activate = locator => profile.touch ? locator.tap() : locator.click();
        async function go(view, date = m.anchorDate, extra = '') {
            // Drain real reads before navigation: WebKit reports unload cancellations
            // as page errors, which must not masquerade as a product failure.
            await page.waitForLoadState('networkidle');
            await page.goto(`${base}/?businessContext=dar&educationSchedule=${view}&date=${date}${extra}`, { waitUntil: 'domcontentloaded' });
            await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
            await page.waitForFunction(view => window.EducationScheduleWorkspace?.state.activeView === view, view);
        }
        const shell = '#educationScheduleWorkspace,.schedule-command-center';
        await go('today'); await page.waitForFunction(() => document.querySelectorAll('[data-education-booking-id]').length === 4 && !window.EducationScheduleWorkspace.state.loading);
        await capture(label('today'), shell);
        await check(label('compact-five-tabs'), async () => {
            const tabs = page.locator('.education-schedule-tabs');
            assert.equal(await tabs.locator('button').count(), 5);
            if (profile.width <= 1100) assert.ok((await tabs.boundingBox()).height <= 76, 'Navigation consumes more than one compact row');
            const buttons = tabs.locator('button');
            for (let i=0;i<5;i++) {
                await buttons.nth(i).press('Enter');
                await page.waitForFunction(index => document.querySelectorAll('[data-education-schedule-tab]')[index].getAttribute('aria-pressed') === 'true', i);
                await page.waitForFunction(index => { const tabs=document.querySelector('.education-schedule-tabs'), button=tabs.querySelectorAll('button')[index], t=tabs.getBoundingClientRect(), b=button.getBoundingClientRect(); return b.left>=t.left-1 && b.right<=t.right+1; }, i).catch(async error => { throw Error('Tab index '+i+' outside strip: '+JSON.stringify(await tabs.evaluate(el => ({left:el.scrollLeft,width:el.clientWidth,buttons:[...el.querySelectorAll("button")].map(b=>({name:b.textContent.trim(),left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right}))})))+'; '+error.message); });
                const focus = await buttons.nth(i).evaluate(el => ({ focused:el===document.activeElement,outline:parseFloat(getComputedStyle(el).outlineWidth) }));
                assert.equal(focus.focused,true); assert.ok(focus.outline>=2);
            }
            await buttons.first().press('Enter');
        });
        await activate(page.locator('[data-education-schedule-tab="groups"]')); await page.locator(`#educationGroupsList option[value="${m.ids.groups.arts}"]`).waitFor({ state: 'attached' });
        await page.locator('#educationGroupsList').selectOption(String(m.ids.groups.arts)); await page.waitForFunction(() => window.EducationGroups.state.detailStatus === 'ready');
        await capture(label('groups'), shell); await page.locator('#educationGroupEnrollForm').scrollIntoViewIfNeeded(); await capture(label('enroll'), shell);
        if (process.env.EDU_READY_STAGE === '08') {
            await activate(page.locator('#educationTeacherManager summary'));
            await page.locator('#educationTeacherName').waitFor({ state: 'visible' });
            await capture(label('teacher-manager'), '#educationTeacherManager');
        }
        if (profile.name === 'iphone-390') {
            await page.locator('#educationGroupsList').selectOption('');
            await page.locator('#educationGroupName').fill('Недільна майстерня: відкриваємо світ разом');
            await activate(page.locator('#educationGroupForm button[type="submit"]'));
            await page.waitForFunction(() => document.getElementById('educationGroupsStatus').dataset.state === 'error');
            await check(label('save-error-keeps-draft'), async () => assert.equal(await page.locator('#educationGroupName').inputValue(), 'Недільна майстерня: відкриваємо світ разом'));
            await capture(label('save-error'), shell);
        }
        await go('attendance', m.anchorDate, `&educationAttendanceDate=${m.plan.lessons.find(l => l.key === 'english-3').date}&educationJournal=${m.ids.bookings['english-3']}`);
        await page.waitForFunction(() => window.EducationAttendance?.state.journal && !window.EducationAttendance.state.journalLoading && !window.EducationAttendance.state.loading);
        await capture(label('journal'), shell); await page.locator('#educationAttendanceSave').scrollIntoViewIfNeeded(); await capture(label('journal-save'), shell);
        await go('reports', m.anchorDate, '&educationReportFrom=2026-08-04&educationReportTo=2026-10-02'); await page.locator('.education-report-summary').waitFor({ state: 'visible' });
        await capture(label('reports'), shell);
        await check(label('report-keyboard-scroll'), async () => { const region = page.locator('.education-report-table-wrap'); assert.equal(await region.getAttribute('tabindex'), '0'); await region.press('ArrowRight'); await page.waitForFunction(() => { const el = document.querySelector('.education-report-table-wrap'); return el.scrollWidth <= el.clientWidth || el.scrollLeft > 0; }); });
        await go('schedule'); await page.locator('.booking-block').first().waitFor({ state: 'visible' });
        await check(label('schedule-unclipped-lesson'),async()=>{
            // Wait for the real reveal/height animation to reach usable terminal geometry.
            // No injected resync, CSS override or API repair; persistent clipping times out and FAILs.
            await page.waitForFunction(()=>{
                const box=document.querySelector('.timeline-container')?.getBoundingClientRect();
                const viewport=document.getElementById('timelineScroll')?.getBoundingClientRect();
                const lesson=document.querySelector('.booking-block')?.getBoundingClientRect();
                return box?.height>=120&&viewport&&lesson&&Math.min(viewport.bottom,lesson.bottom)-Math.max(viewport.top,lesson.top)>=lesson.height-1;
            },null,{timeout:10000});
            const geometry=await page.evaluate(()=>{
                const box=document.querySelector('.timeline-container').getBoundingClientRect();
                const viewport=document.getElementById('timelineScroll').getBoundingClientRect();
                const lesson=document.querySelector('.booking-block').getBoundingClientRect();
                return {height:box.height,visibleLessonHeight:Math.max(0,Math.min(viewport.bottom,lesson.bottom)-Math.max(viewport.top,lesson.top)),lessonHeight:lesson.height};
            });
            assert.ok(geometry.visibleLessonHeight>=geometry.lessonHeight-1,'Lesson clipped by its scroll viewport');
            const horizontal = await page.locator('.timeline-line--education:has(.booking-block)').evaluateAll(lines => lines.flatMap(line => {
                const grid = line.querySelector('.line-grid').getBoundingClientRect();
                const header = line.querySelector('.line-header').getBoundingClientRect();
                return [...line.querySelectorAll('.booking-block')].map(block => {
                    const rect = block.getBoundingClientRect();
                    return { id: block.dataset.bookingId, left: rect.left, right: rect.right, gridLeft: grid.left, gridRight: grid.right, headerRight: header.right };
                });
            }));
            assert.ok(horizontal.length > 0, 'No lesson geometry measured');
            for (const rect of horizontal) {
                assert.ok(rect.left >= rect.gridLeft - 1, 'Lesson before grid covers cabinet: ' + JSON.stringify(rect));
                assert.ok(rect.right <= rect.gridRight + 1, 'Lesson extends beyond axis: ' + JSON.stringify(rect));
                assert.ok(rect.left >= rect.headerRight - 1, 'Lesson overlaps cabinet label: ' + JSON.stringify(rect));
            }
            geometry.horizontal = horizontal;
            return geometry;
        });
        await check(label('schedule-readable-core-lines'),async()=>{
            const samples=await page.locator('.booking-block.education-lesson').evaluateAll(blocks=>blocks.flatMap(block=>{
                const outer=block.getBoundingClientRect();
                return ['.title','.booking-block-time'].map(selector=>{
                    const node=block.querySelector(selector),rect=node?.getBoundingClientRect(),style=node&&getComputedStyle(node);
                    const font=Number.parseFloat(style?.fontSize),line=Number.parseFloat(style?.lineHeight)||font*1.2;
                    return {id:block.dataset.bookingId,selector,text:node?.textContent?.trim(),line,requiredHeight:style?.display==='inline'?font:line,actualHeight:rect?.height||0,
                        visibleHeight:rect?Math.max(0,Math.min(rect.bottom,outer.bottom)-Math.max(rect.top,outer.top)):0};
                });
            }));
            assert.ok(samples.length>0,'No education title/time line measured');
            const clipped=samples.filter(row=>!row.text||!Number.isFinite(row.requiredHeight)||row.actualHeight<row.requiredHeight-1||row.visibleHeight<row.requiredHeight-1);
            assert.deepEqual(clipped,[],'Education topic/time line clipped: '+JSON.stringify(clipped));return samples;
        });
        await check(label('schedule-cabinet-short-word-reflow'),async()=>{
            const samples=await page.evaluate(()=>[...document.querySelectorAll('.timeline-line--education .line-name')].flatMap(label=>{
                const walker=document.createTreeWalker(label,NodeFilter.SHOW_TEXT),rows=[];let node;
                while((node=walker.nextNode()))for(const match of node.nodeValue.matchAll(/[А-ЯІЇЄҐа-яіїєґ’ʼ']{6,12}/gu)){
                    const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
                    rows.push({word:match[0],line:label.closest('[data-line-id]')?.dataset.lineId,tops:[...new Set([...range.getClientRects()].filter(rect=>rect.width>0).map(rect=>Math.round(rect.top)))]});
                }return rows;
            }));
            assert.ok(samples.length>0,'No cabinet word geometry measured');
            assert.deepEqual(samples.filter(row=>row.tops.length!==1),[],'Short cabinet words split inside letters');return samples;
        }); await capture(label('schedule'), shell + ',.timeline-container');
        await activate(page.locator('#timelineViewPanelToggle')); await activate(page.locator('[data-schedule-view-mode="week"]')); await page.locator('.mini-booking-block').first().waitFor({ state: 'visible' });
        await check(label('week-topic-keyboard-canonical'), async()=>{
            const expected=(await pool.query("SELECT extra_data->'educationLesson'->>'title' topic,time,duration FROM bookings WHERE id=$1 AND business_context='dar'",[m.ids.bookings['robots-4']])).rows[0];
            assert.equal(expected.topic,'Датчик світла');
            const early=page.locator('.mini-booking-block[data-booking-id="'+m.ids.bookings['english-4']+'"]').first();
            const geometry=await early.evaluate(el=>{const r=el.getBoundingClientRect(),g=el.closest('.mini-line-grid').getBoundingClientRect();return {left:r.left-gridLeft(g),width:r.width};function gridLeft(rect){return rect.left;}});
            assert.ok(geometry.left>=0&&geometry.width>0,'Early education lesson overlaps cabinet header');
            const lesson=page.locator('.mini-booking-block[data-booking-id="'+m.ids.bookings['robots-4']+'"]').first();
            assert.equal(await lesson.locator('.mini-education-topic').innerText(),expected.topic);
            assert.equal(await lesson.getAttribute('role'),'button');assert.equal(await lesson.getAttribute('tabindex'),'0');
            const name=await lesson.getAttribute('aria-label');assert.ok(name.includes(expected.topic)&&name.includes(expected.time)&&name.includes(expected.duration+' хв'));
            await lesson.focus();await lesson.press('Enter');await page.locator('#bookingModal').waitFor({state:'visible'});
            assert.equal(await page.locator('.booking-detail-title').innerText(),expected.topic);
            await page.waitForFunction(()=>document.getElementById('bookingModal')?.contains(document.activeElement));await page.keyboard.press('Escape');await page.locator('#bookingModal').waitFor({state:'hidden'});
            assert.equal(await lesson.evaluate(el=>el===document.activeElement),true);
            await lesson.press('Space');await page.locator('#bookingModal').waitFor({state:'visible'});assert.equal(await page.locator('.booking-detail-title').innerText(),expected.topic);await page.waitForFunction(()=>document.getElementById('bookingModal')?.contains(document.activeElement));await page.keyboard.press('Escape');await page.locator('#bookingModal').waitFor({state:'hidden'});
        });
        await capture(label('week'), shell + ',.timeline-container');
        await go('today'); const card = page.locator(`[data-education-booking-id="${m.ids.bookings['robots-4']}"]`); await activate(card); await page.locator('#bookingModal').waitFor({ state: 'visible' });
        await capture(label('card'), '#bookingModal');
        await check(label('education-image-omitted'), async () => assert.equal(await page.locator('#bookingDetails > .event-card-visual').isVisible(), false));
        await check(label('canonical-core-without-duplicates'),async()=>{assert.equal(await page.locator('#bookingDetails .booking-detail-title').count(),1);assert.equal(await page.locator('#bookingDetails > .booking-lesson-detail').count(),1);assert.equal(await page.locator('#bookingDetails > .booking-package-detail').count(),0);}); await trap('#bookingModal', label('card-keyboard-trap'));
        await page.keyboard.press('Escape'); await page.locator('#bookingModal').waitFor({ state: 'hidden' });
        await check(label('card-focus-return'), async () => assert.equal(await card.evaluate(el => el === document.activeElement), true));
        await activate(card); await activate(page.locator('#bookingModal .btn-edit-booking'));
        await page.waitForFunction(() => document.getElementById('educationLessonDuration').value === '45' && !document.getElementById('bookingForm').inert);
        if (process.env.EDU_READY_STAGE === '08') {
            await page.locator('#educationLessonDate').scrollIntoViewIfNeeded();
            await check(label('visible-date-hydrated'), async () => {
                assert.equal(await page.locator('#educationLessonDate').inputValue(), m.anchorDate);
                assert.equal(await page.locator('#educationLessonDate').isVisible(), true);
            });
            await capture(label('date-edit'), '#bookingPanel');
        }
        await page.locator('#educationLessonTitle').scrollIntoViewIfNeeded(); await capture(label('edit'), '#bookingPanel');
        await trap('#bookingPanel', label('edit-keyboard-trap'));
        await page.locator('#bookingSubmitBtn').scrollIntoViewIfNeeded(); await capture(label('edit-save'), '#bookingPanel');
        await check(label('education-form-wording'), async () => {
            assert.equal(await page.locator('#bookingPanel .panel-header h3').textContent(), 'Редагувати заняття');
            const summary = await page.locator('#bookingPackageSummary').innerText();
            assert.ok(summary.includes('Тема') && summary.includes('45 хвилин'));
            assert.equal(/Програма\s*не вибрано|Разом\s*0\s*₴/.test(summary), false);
            assert.equal(await page.locator('#programDetails').isVisible(), false, 'No selected catalog program; empty summary should be omitted');
            assert.equal(await page.locator('#bookingSubmitHint').innerText(), 'Заняття можна зберегти.');
            assert.equal(await page.locator('#bookingPanel button').filter({hasText:/^Промо$/}).count(),0);
        });
        await check(label('edit-dirty-escape-keeps-draft'), async () => {
            await page.locator('#educationLessonTitle').fill('Дитяча майстерня — наш незбережений план');
            await page.keyboard.press('Escape');
            await page.locator('.confirm-overlay').waitFor({ state: 'visible' });
            await activate(page.locator('.confirm-overlay .confirm-cancel'));
            await page.waitForFunction(() => !document.querySelector('.confirm-overlay') && document.getElementById('bookingPanel').contains(document.activeElement));
            assert.equal(await page.locator('#educationLessonTitle').inputValue(), 'Дитяча майстерня — наш незбережений план');
        });
        await go('today', m.plan.lessons.find(l => l.key === 'english-5').date); await activate(page.locator(`[data-education-booking-id="${m.ids.bookings['english-5']}"]`));
        const seriesTrigger = page.locator('#bookingModal').getByRole('button', { name: 'Відкрити серію' });
        await activate(seriesTrigger); await page.locator('.education-series-row').first().waitFor({ state: 'visible' });
        await capture(label('series'), '#educationSeriesModal'); await trap('#educationSeriesModal', label('series-keyboard-trap'));
        await page.keyboard.press('Escape'); await page.locator('#educationSeriesModal').waitFor({ state: 'hidden' });
        await check(label('series-focus-return'), async () => assert.equal(await seriesTrigger.evaluate(el => el === document.activeElement), true));
        await go('today', m.anchorDate, '&open=settings'); await page.locator('#settingsModal').waitFor({ state: 'visible', timeout: 45000 });
        await page.locator('#settingsTimelineDisplaySection').scrollIntoViewIfNeeded(); await capture(label('settings-modal'), '#settingsTimelineDisplaySection');
        await page.waitForLoadState('networkidle');
        await page.goto(base + '/timeline-settings?businessContext=dar', { waitUntil: 'domcontentloaded' }); await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 }); await page.locator('[data-timeline-settings-block]').first().waitFor({ state: 'visible', timeout: 45000 }); await page.locator('#timelineSettingsInspector h3').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.body.dataset.educationSettings === 'true');
        await capture(label('settings-page'), '.timeline-settings-page');
        for (const tab of ['visual', 'presets', 'system']) {
            await activate(page.locator(`[data-timeline-settings-tab="${tab}"]`));
            await page.locator(`[data-timeline-settings-panel="${tab}"].active`).waitFor({ state: 'visible' });
            await capture(label('settings-' + tab), '.timeline-settings-page');
        }
        if (profile.name === 'iphone-390') {
            await go('today', '2030-01-29'); await page.locator('.education-today-empty:not(button)').waitFor({ state: 'visible' }); await capture(label('empty'), shell);
            await page.route('**/api/bookings/2030-01-30*', route => route.fulfill({ status: 503, json: { error: 'Controlled mobile read failure' } }));
            await go('today', '2030-01-30'); await page.locator('[data-education-retry]').waitFor({ state: 'visible' }); await capture(label('error'), shell);
            await page.unrouteAll({ behavior: 'wait' });
            await activate(page.locator('[data-education-retry]')); await page.locator('.education-today-empty:not(button)').waitFor({ state: 'visible' });
        }
        await page.waitForLoadState('networkidle');
        await page.unrouteAll({ behavior: 'wait' }); if (profile.name === 'desktop-1440') {
            await page.goto(base+'/?businessContext=event_genix&timelineView=animators&date='+m.anchorDate,{waitUntil:'domcontentloaded'});
            await page.locator('#mainApp').waitFor({state:'visible'});
            await page.waitForFunction(()=>window.TimelineBusinessContext?.presentation?.().mode==='park');
            await page.locator('.booking-block[data-booking-id="'+m.ids.controlBooking+'"]').first().click();
            await page.locator('#bookingModal').waitFor({state:'visible'});
            await check('park-canonical-card',async()=>{ assert.equal(await page.locator('.booking-lesson-detail').count(),0); assert.equal(await page.locator('#bookingDetails > .event-card-visual').isVisible(),true); });
            await parkScreenshot('park-card-'+engine);
            await page.locator('#bookingModal .btn-edit-booking').click();
            await page.waitForFunction(()=>document.querySelector('#bookingPanel .panel-header h3')?.textContent==='Редагувати бронювання');
            await page.waitForLoadState('networkidle');
            await page.locator('#bookingPackageSummary .booking-summary-total').waitFor({state:'visible'});
            evidence.parkEditPresentation=await page.evaluate(()=>({activityVisible:Boolean(document.getElementById('programDetails')?.getClientRects().length),educationVisible:Boolean(document.getElementById('educationLessonSection')?.getClientRects().length),timeLabel:document.getElementById('bookingTime')?.getAttribute('aria-label'),priceVisible:Boolean(document.querySelector('#bookingPackageSummary .booking-summary-total')?.getClientRects().length)}));
            await check('park-form-price-activities',async()=>{
                assert.equal(await page.locator('#bookingPanel .panel-header h3').innerText(),'Редагувати бронювання');
                assert.equal(await page.locator('#programDetails').isVisible(),true,'Park activity panel is visible');
                assert.equal(await page.locator('#programDetails .program-details-title').innerText(),'Обрані активності');
                assert.equal(await page.locator('#educationLessonSection').isVisible(),false,'Education controls remain hidden in Park');
                assert.equal(await page.locator('#bookingTime').getAttribute('aria-label'),'Старт активності');
                assert.equal(await page.locator('#bookingPackageSummary .booking-summary-total').isVisible(),true,'Park price total is visible');
            });
            await page.locator('#bookingSubmitBtn').scrollIntoViewIfNeeded(); await parkScreenshot('park-edit-'+engine);
        }
        await context.close();
        evidence.completedProfiles.push(profile.name);
    }
    assert.deepEqual(await proof(), before, 'Read-only test mutated retained dataset');
    evidence.datasetUnchanged = true; evidence.preflight = before.preflight;
    assert.deepEqual(hashes(), evidence.sourceHashes, 'Product edited during run');
    await check('critical-reads', () => assert.deepEqual(evidence.failedReads.filter(r => r.path !== '/api/bookings/2030-01-30' || r.status !== 503), []));
    await check('page-errors', () => assert.deepEqual(evidence.pageErrors, []));
    evidence.status = evidence.checks.some(c => c.status !== 'PASS') ? 'FAIL' : 'PASS';
    if (evidence.status !== 'PASS') process.exitCode = 1;
})().catch(async error => { evidence.status = /BLOCKED_FIXTURE/.test(error.message) ? 'BLOCKED_FIXTURE' : 'FAIL'; evidence.error = error.message;
    evidence.errorStack = error.stack;
    evidence.diagnostic = await page?.evaluate(() => ({ date: document.getElementById('timelineDate')?.value, view: window.EducationScheduleWorkspace?.state.activeView,
        loading: window.EducationScheduleWorkspace?.state.loading, cards: document.querySelectorAll('[data-education-booking-id]').length, theme: document.documentElement.dataset.theme,
        bodyDark: document.body.classList.contains('dark-mode'), url: location.pathname + location.search })).catch(() => null);
    process.exitCode = 1; })
    .finally(async () => { await context?.close().catch(() => {}); await browser?.close(); await pool.end(); evidence.exitCode = process.exitCode || 0;
        fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(evidence, null, 2)); console.log(`${engine} mobile ${evidence.status}: ${out}`); });
