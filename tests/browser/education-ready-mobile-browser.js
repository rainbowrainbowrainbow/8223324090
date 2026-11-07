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
const phase = process.env.EDU_MOBILE_PHASE || 'baseline';
const out = path.resolve(process.env.EDU_READY_RUN_ROOT || `output/education-ready/${process.env.EDU_READY_STAGE === '08' ? '08' : '07'}`, `${phase}-${engine}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const evidence = { engine, phase, status: 'NOT_RUN', checks: [], screens: [], blockedWrites: [], pageErrors: [], failedReads: [], failedRequests: [], sourceHashes: {},
    harnessHash: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex') };
const files = ['index.html', 'css/education-schedule.css', 'js/booking.js', 'js/education-attendance.js', 'js/education-schedule.js', 'js/timeline-settings-page.js'];
const hashes = () => Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const pool = new Pool({ host: '127.0.0.1', port: 55469, user: 'postgres', database: process.env.TEST_URL ? DATABASES.fixed : DATABASES.demo, ssl: false });
const username = process.env.TEST_USER || process.env.LIVE_CREATOR_USER;
const password = process.env.TEST_PASS || process.env.LIVE_CREATOR_PASS;
const profiles = [
    { name: 'phone-320', width: 320, height: 740, touch: true },
    { name: 'iphone-390', width: 390, height: 844, touch: true },
    { name: 'phone-landscape', width: 844, height: 390, touch: true },
    { name: 'tablet-768', width: 768, height: 1024, touch: true },
    { name: 'tablet-landscape', width: 1024, height: 768, touch: true },
    { name: 'reflow-200', width: 640, height: 800, touch: false }
].filter(p => !process.env.EDU_MOBILE_PROFILE || p.name === process.env.EDU_MOBILE_PROFILE);
evidence.profiles = profiles;
evidence.completedProfiles = [];
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
                const scrollAncestor = el.parentElement?.closest('.education-report-table-wrap,.timeline-container,.multi-day-container');
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
                viewportMeta: document.querySelector('meta[name="viewport"]')?.content,
                dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).map(el => ({ id: el.id, modal: el.getAttribute('aria-modal'), name: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') })) };
        }, rootSelector);
    } finally { await page.evaluate(() => { for (const [node, value] of window.__mobileRedactions || []) if (node.isConnected) node.nodeValue = value; delete window.__mobileRedactions; }); }
    evidence.screens.push({ name, file: name + '.png', audit });
    await check(name + ':layout', () => { assert.ok(audit.documentWidth <= audit.width + 1, `Document overflow ${audit.documentWidth}/${audit.width}`); assert.deepEqual(audit.overflow, [], 'Visible content outside viewport'); });
    await check(name + ':names', () => assert.deepEqual(audit.missingNames, [], 'Unnamed controls'));
    await check(name + ':crm-font', () => assert.deepEqual(audit.unexpectedFonts, [], 'Education navigation/cards must use the CRM font'));
    await check(name + ':touch-targets', () => assert.deepEqual(audit.controls.filter(c => c.width < 44 || c.height < 44), [], 'Required controls need 44px touch targets'));
    await check(name + ':input-text', () => assert.deepEqual(audit.tinyTextInputs, [], 'Text inputs need 16px to avoid iOS focus zoom'));
    await check(name + ':input-boundaries', () => assert.deepEqual(audit.inputBoundaries.filter(c => c.ratio < 3), [], 'Input boundaries need contrast3:1 against their surface'));
    console.log(name + ' captured');
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
        evidence.fixturePreparation = 'Owned SQL seed and local profile prerequisite before UI; no API repair';
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
        await go('schedule'); await page.locator('.booking-block').first().waitFor({ state: 'visible' }); await capture(label('schedule'), shell + ',.timeline-container');
        await activate(page.locator('#timelineViewPanelToggle')); await activate(page.locator('[data-schedule-view-mode="week"]')); await page.locator('.mini-booking-block').first().waitFor({ state: 'visible' });
        await capture(label('week'), shell + ',.timeline-container');
        await go('today'); const card = page.locator(`[data-education-booking-id="${m.ids.bookings['robots-4']}"]`); await activate(card); await page.locator('#bookingModal').waitFor({ state: 'visible' });
        await capture(label('card'), '#bookingModal'); await trap('#bookingModal', label('card-keyboard-trap'));
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
        await page.unrouteAll({ behavior: 'wait' }); await context.close();
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
