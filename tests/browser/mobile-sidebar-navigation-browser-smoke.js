'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCapabilitySnapshot } = require('../../services/accountAccessPolicy');
const { createStaticServer, routeMockedApi, businessProfilePayload, SMOKE_USER, requirePlaywright } = require('./timeline-room-summary-browser-smoke');

async function runMobileSidebarNavigation({ browser, baseUrl, output }) {
    fs.mkdirSync(output, { recursive: true });
    const results = [];
    const full = process.env.MOBILE_NAVIGATION_FULL === 'true';

    async function fixture(role = 'creator', standalone = true, serviceWorkers = 'block') {
        const user = { ...SMOKE_USER, id: 9901, username: `mobile.fixture.${role}`, name: 'Mobile navigation fixture', role, roles: [role],
            pageAllowlist: ['/hr', '/staff'], pageDenylist: ['/finance'],
            actionAllowlist: ['hr.today.view', 'hr.schedule.view', 'hr.schedule.manage', 'hr.staff.view'] };
        const context = await browser.newContext({ ...requirePlaywright().devices['Pixel 7'],
            viewport: { width: role === 'admin' ? 360 : role === 'director' ? 412 : 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers });
        await context.addInitScript(({ user, standalone }) => {
            localStorage.setItem('pzp_token', 'synthetic-mobile-fixture');
            localStorage.setItem('pzp_access_token', 'synthetic-mobile-fixture');
            localStorage.setItem('pzp_current_user', JSON.stringify(user));
            localStorage.setItem('pzp_crm_business_context', 'event_genix');
            localStorage.setItem('pzp_crm_business_context_user', String(user.id));
            if (standalone) {
                const native = window.matchMedia.bind(window);
                window.matchMedia = query => {
                    const result = native(query);
                    if (query.includes('display-mode: standalone')) Object.defineProperty(result, 'matches', { value: true });
                    return result;
                };
            }
            window.__mobilePageshows = [];
            window.addEventListener('pageshow', event => window.__mobilePageshows.push({ persisted: event.persisted, trusted: event.isTrusted }));
        }, { user, standalone });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [], writes = [];
        page.on('pageerror', error => errors.push(error.message));
        context.on('request', request => {
            if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + new URL(request.url()).pathname);
        });
        await page.routeWebSocket('**/*', socket => socket.onMessage(raw => {
            if (String(raw).includes('ping')) socket.send(JSON.stringify({ type: 'pong' }));
        }));
        // Context routes also cover network requests issued by the real SW.
        await routeMockedApi(context);
        // The shared static fixture serves filenames; production Express also
        // serves these canonical clean URLs. Use the actual page markup.
        await context.route(url => url.pathname === '/staff', route => route.fulfill({
            contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(__dirname, '../../staff.html'), 'utf8')
        }));
        await context.route(/\/api\/auth\/verify(?:\?|$)/, route => route.fulfill({ json: { user } }));
        const snapshot = buildCapabilitySnapshot(user);
        await context.route(/\/api\/auth\/permissions(?:\?|$)/, route => route.fulfill({ json: {
            role, roles: [role], pages: snapshot.pages, actions: snapshot.actions, capabilities: snapshot.decisions,
            capabilityCatalog: snapshot.catalog, pageAllowlist: user.pageAllowlist, pageDenylist: user.pageDenylist,
            actionAllowlist: user.actionAllowlist, actionDenylist: []
        } }));
        await context.route(/\/api\/(?:business\/profile|auth\/business-profile)(?:\?|$)/, route => {
            const payload = businessProfilePayload();
            payload.businessProfile.businesses[0].modules = { enabled: Object.fromEntries(['dashboard', 'timeline', 'tasks', 'customers', 'leads', 'hr', 'staff', 'programs', 'settings', 'omni'].map(key => [key, true])) };
            return route.fulfill({ json: { ...payload, user } });
        });
        await context.route('**/api/timeline/promotions**', route => route.fulfill({ json: { promotions: [] } }));
        async function ready() {
            await page.waitForFunction(() => document.body.classList.contains('shell-ready')
                && document.getElementById('sidebarToggle')?.dataset.sidebarToggleBound === 'true'
                && window.__crmBusinessNavigationPending !== true);
        }
        await page.goto(baseUrl + '/?timelineView=rooms&date=2026-11-06', { waitUntil: 'networkidle' });
        await ready();
        async function menu(open) {
            if (open) await page.locator('#sidebarToggle').tap();
            else await page.locator('#sidebarOverlay').tap({ position: { x: page.viewportSize().width - 8, y: 300 } });
            await page.waitForFunction(expected => document.getElementById('sidebarNav').classList.contains('open') === expected, open);
            if (open) await page.waitForFunction(() => Math.abs(document.getElementById('sidebarNav').getBoundingClientRect().left) < 1);
            assert.equal(await page.locator('#sidebarToggle').getAttribute('aria-expanded'), String(open));
            assert.equal(await page.locator('body').evaluate(el => el.classList.contains('sidebar-mobile-open')), open);
        }
        return { context, page, ready, menu, errors, writes };
    }

    const roles = full ? ['creator', 'director', 'admin', 'animator'] : ['creator', 'admin'];
    for (const role of roles) for (const standalone of full ? [false, true] : [role === 'admin']) {
        const f = await fixture(role, standalone);
        const label = `${role}-${standalone ? 'standalone' : 'browser'}`;
        try {
            for (let index = 0; index < 2; index++) { await f.menu(true); await f.menu(false); }
            await f.page.evaluate(() => {
                const toggle = document.getElementById('sidebarToggle');
                toggle.addEventListener('pointerup', () => {
                    const end = performance.now() + 550;
                    while (performance.now() < end) { /* Model a busy phone before its native click. */ }
                }, { once: true });
            });
            await f.menu(true);
            await f.page.screenshot({ path: path.join(output, `${label}-menu.png`) });
            await f.page.keyboard.press('Escape');
            await f.page.waitForFunction(() => !document.getElementById('sidebarNav').classList.contains('open'));
            await f.menu(true);
            await f.page.locator('.sidebar-design-extra-link[href="/staff"]').first().tap();
            await f.page.waitForURL(url => url.pathname === '/staff');
            await f.ready();
            await f.menu(true); await f.menu(false);
            await f.page.goBack({ waitUntil: 'domcontentloaded' }); await f.ready();
            const nativeBfcacheObserved = await f.page.evaluate(() => window.__mobilePageshows.some(event => event.persisted && event.trusted));
            await f.page.evaluate(() => {
                document.body.classList.add('page-exiting'); document.body.setAttribute('aria-busy', 'true');
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            });
            assert.equal(await f.page.locator('body').evaluate(el => el.classList.contains('page-exiting')), false);
            await f.menu(true); await f.menu(false);
            assert.deepEqual(f.errors, []); assert.deepEqual(f.writes, []);
            results.push({ label, status: 'passed', nativeBfcacheObserved, syntheticPersistedRecovery: true, navigationWrites: 0 });
            console.log(`Mobile navigation passed: ${label}`);
        } catch (error) { await f.page.screenshot({ path: path.join(output, `${label}-failure.png`) }).catch(() => {}); throw error; }
        finally { await f.context.close(); }
    }

    for (const fault of ['no-content', 'abort']) {
        const f = await fixture(); let requests = 0;
        let navigationRequested;
        const requested = new Promise(resolve => { navigationRequested = resolve; });
        try {
            await f.page.route(/\/customers(?:\?|$)/, route => {
                requests++;
                navigationRequested();
                return fault === 'abort' ? route.abort('aborted') : route.fulfill({ status: 204 });
            });
            await f.menu(true);
            const link = f.page.locator('.sidebar-links a.nav-link[href^="/customers"]').first();
            if (!await link.isVisible()) {
                const key = await link.evaluate(el => el.closest('.sidebar-group').dataset.groupKey);
                await f.page.locator(`.sidebar-group[data-group-key="${key}"] .sidebar-group-header`).tap();
            }
            await link.tap({ noWaitAfter: true });
            await requested;
            await f.page.waitForFunction(() => !document.body.classList.contains('page-exiting'), null, { timeout: 5000 });
            assert.equal(new URL(f.page.url()).pathname, '/');
            assert.equal(requests, 1, 'Recovery must not issue a second navigation/request');
            const recovered = await f.page.evaluate(() => ({ busy: document.body.getAttribute('aria-busy'),
                visibility: getComputedStyle(document.getElementById('mainApp')).visibility }));
            assert.equal(recovered.busy, null);
            assert.equal(recovered.visibility, 'visible');
            // Chromium can retain a pending navigation signal after HTTP 204.
            // Exercise actual touch input without locator navigation auto-waits.
            const button = await f.page.evaluate(() => {
                const rect = document.getElementById('sidebarToggle').getBoundingClientRect();
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            });
            await f.page.touchscreen.tap(button.x, button.y);
            await f.page.waitForFunction(() => document.getElementById('sidebarNav').classList.contains('open'));
            await f.page.touchscreen.tap(f.page.viewportSize().width - 8, 300);
            await f.page.waitForFunction(() => !document.getElementById('sidebarNav').classList.contains('open'));
            await f.page.screenshot({ path: path.join(output, `${fault}-recovered.png`) });
            assert.deepEqual(f.writes, []); assert.deepEqual(f.errors, []);
            results.push({ label: fault, status: 'passed', requests, navigationWrites: 0 });
            console.log(`Mobile navigation passed: ${fault}`);
        } finally { await f.context.close(); }
    }
    {
        const f = await fixture('creator', true, 'allow');
        try {
            await f.page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
            await f.page.reload({ waitUntil: 'networkidle' }); await f.ready();
            assert.equal(await f.page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
            await f.menu(true); await f.menu(false);
            const cachedApiPaths = await f.page.evaluate(async () => {
                const paths = [];
                for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) {
                    if (new URL(request.url).pathname.startsWith('/api/')) paths.push(new URL(request.url).pathname);
                }
                return paths;
            });
            assert.deepEqual(cachedApiPaths, [], 'Service worker must not persist API/permission data');
            assert.deepEqual(f.errors, []); assert.deepEqual(f.writes, []);
            results.push({ label: 'standalone-service-worker-reload', status: 'passed', serviceWorkerControlled: true, cachedApiPaths });
            console.log('Mobile navigation passed: standalone-service-worker-reload');
        } finally { await f.context.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ engine: 'Chromium Android emulation', full, physicalPhone: false, results }, null, 2));
    console.log(`Mobile sidebar navigation: ${results.length} cases passed.`);
    return results;
}

if (require.main === module) (async () => {
    const { server, baseUrl } = await createStaticServer();
    let browser;
    try {
        browser = await requirePlaywright().chromium.launch({ headless: true,
            ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {}) });
        await runMobileSidebarNavigation({ browser, baseUrl,
            output: process.env.MOBILE_NAVIGATION_OUTPUT || path.join(__dirname, '../../output/playwright/mobile-sidebar-navigation') });
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { runMobileSidebarNavigation };
