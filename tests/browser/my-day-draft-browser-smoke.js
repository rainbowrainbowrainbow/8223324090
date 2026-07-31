#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { buildCapabilitySnapshot } = require('../../services/accountAccessPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const HEADLESS = process.env.MY_DAY_DRAFT_BROWSER_SMOKE_HEADLESS !== 'false';
const MIME = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
};

const USER = {
    id: 904,
    username: 'my.day.draft.qa',
    name: 'My Day Draft QA',
    role: 'admin',
    businessContexts: ['event_genix'],
    business_contexts: ['event_genix'],
    defaultBusinessContext: 'event_genix',
    default_business_context: 'event_genix',
    pageAllowlist: ['/profile'],
    page_allowlist: ['/profile']
};

const AUTH_PERMISSIONS = (() => {
    const snapshot = buildCapabilitySnapshot(USER);
    return {
        role: USER.role,
        roles: [USER.role],
        pageAllowlist: ['/profile'],
        actionAllowlist: [],
        actionDenylist: [],
        pages: snapshot.pages,
        actions: snapshot.actions,
        capabilities: snapshot.decisions,
        capabilityCatalog: snapshot.catalog
    };
})();

const BUSINESS_PROFILE = {
    activeBusinessId: 'event_genix',
    activeBusinessContext: 'event_genix',
    scope: { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'], readOnly: false },
    businesses: [{
        key: 'event_genix',
        id: 'event_genix',
        businessContext: 'event_genix',
        modules: { enabled: { tasks: true } }
    }]
};

function cabinetProjection() {
    return {
        success: true,
        all: [],
        activeMyDay: [],
        today: [],
        overdue: [],
        waiting: [],
        deferred: [],
        private: [],
        completedHistory: [],
        planning: {},
        preferences: {},
        stats: { active: 0, today: 0, overdue: 0, completedToday: 0 }
    };
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function staticFilePath(requestUrl) {
    const url = new URL(requestUrl, 'http://fixture');
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (relative === 'profile') relative = 'profile.html';
    const file = path.resolve(ROOT, relative);
    return file.startsWith(`${ROOT}${path.sep}`) ? file : null;
}

function createStaticServer() {
    const server = http.createServer((req, res) => {
        const file = staticFilePath(req.url || '/');
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(file ? 404 : 403);
            res.end();
            return;
        }
        res.writeHead(200, {
            'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-store'
        });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            baseUrl: `http://127.0.0.1:${server.address().port}`
        }));
    });
}

function json(route, payload, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(payload)
    });
}

async function installFixtureRoutes(context, baseUrl, state) {
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== baseUrl) return route.abort('blockedbyclient');
        if (url.pathname === '/' && request.isNavigationRequest()) {
            state.rootNavigations.push(request.url());
            return route.abort('blockedbyclient');
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
            state.mutations.push(`${request.method()} ${url.pathname}${url.search}`);
            return route.abort('blockedbyclient');
        }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        state.requests.push(`${request.method()} ${url.pathname}${url.search}`);
        if (url.pathname === '/api/auth/verify') return json(route, { user: USER });
        if (url.pathname === '/api/auth/permissions') return json(route, AUTH_PERMISSIONS);
        if (url.pathname === '/api/business/profile') return json(route, { businessProfile: BUSINESS_PROFILE });
        if (url.pathname === '/api/auth/profile') return json(route, {
            user: USER,
            profilePreferences: { cockpitWidgets: [] },
            stats: {},
            activity: []
        });
        if (url.pathname === '/api/business/live-counters') return json(route, {
            counters: {
                total: { alerts: { active: 0 }, leads: { hot: 0, new: 0 } },
                byBusiness: { event_genix: { alerts: { active: 0 }, leads: { hot: 0, new: 0 } } }
            }
        });
        if (url.pathname === '/api/tasks/my-cabinet') {
            state.cabinetRequests += 1;
            if (url.searchParams.get('focusDate')) await new Promise(resolve => setTimeout(resolve, 120));
            return json(route, cabinetProjection());
        }
        if (url.pathname === '/api/tasks/owners') return json(route, { success: true, users: [] });
        if (url.pathname === '/api/tasks/permissions') return json(route, { success: true, permissions: {} });
        if (url.pathname === '/api/tasks/decomposition-saved-templates') return json(route, { success: true, templates: [] });
        if (url.pathname === '/api/dashboard/alerts') return json(route, { alerts: [] });
        return json(route, { success: true });
    });
}

async function assertDraftSurvivesDueChanges(page, state) {
    const title = page.locator('#cabinetTaskTitle');
    const date = page.locator('#cabinetTaskDate');
    const draft = 'Browser regression draft — do not create';
    await title.evaluate((input, value) => { input.value = value; }, draft);

    for (const preset of ['today', 'tomorrow', 'day_after_tomorrow', 'plus_3_days', 'month_end', 'no_date', 'custom']) {
        await page.locator(`[data-cabinet-due-preset="${preset}"]`).click();
        assert.equal(await title.inputValue(), draft, `${preset} keeps the typed task draft`);
        assert.equal(await page.locator(`[data-cabinet-due-preset="${preset}"]`).getAttribute('aria-pressed'), 'true', `${preset} is selected`);
    }

    const beforeCustomRefresh = state.cabinetRequests;
    const focusedProjection = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/tasks/my-cabinet' && url.searchParams.get('focusDate') === '2099-05-31';
    });
    await date.fill('2099-05-31');
    await focusedProjection;
    await page.waitForTimeout(180);
    assert.equal(await title.inputValue(), draft, 'custom date refresh keeps the typed task draft');
    assert.equal(await date.inputValue(), '2099-05-31', 'custom date remains selected');
    assert.ok(state.cabinetRequests > beforeCustomRefresh, 'custom date runs a background projection GET');
}

async function run() {
    const { chromium } = requirePlaywright();
    const fixture = await createStaticServer();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: 1440, height: 900 }
    });
    const state = { requests: [], mutations: [], rootNavigations: [], cabinetRequests: 0 };
    const pageErrors = [];
    await context.addInitScript(({ user, permissions }) => {
        localStorage.setItem('pzp_token', 'my-day-draft-read-only-fixture');
        localStorage.setItem('pzp_access_token', 'my-day-draft-read-only-fixture');
        localStorage.setItem('pzp_current_user', JSON.stringify({ ...user, permissions }));
        localStorage.setItem('pzp_crm_business_context', 'event_genix');
        localStorage.setItem('pzp_dark_mode', 'false');
        localStorage.setItem('pzp_sidebar_collapsed', 'true');
    }, { user: USER, permissions: AUTH_PERMISSIONS });
    await installFixtureRoutes(context, fixture.baseUrl, state);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
        await page.goto(`${fixture.baseUrl}/profile?tab=myday`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.cabinet-shell.cabinet-command-center');
        await page.waitForSelector('#cabinetTaskTitle');
        await assertDraftSurvivesDueChanges(page, state);
        assert.ok(state.requests.some(item => item.includes('/api/tasks/my-cabinet')), 'browser uses the My Day projection endpoint');
        assert.deepEqual(state.mutations.filter(item => item.includes('/api/tasks')), [], 'browser issued no task mutation');
        assert.deepEqual(state.rootNavigations, [], 'authenticated profile fixture did not redirect to root');
        assert.deepEqual(pageErrors, [], `browser runtime has no uncaught errors: ${pageErrors.join('; ')}`);
        console.log('My Day draft browser smoke passed');
    } catch (error) {
        const body = await page.locator('body').innerText().catch(() => 'body unavailable');
        console.error('My Day draft browser smoke diagnostics: url=' + page.url());
        console.error('My Day draft API requests: ' + state.requests.slice(-80).join(' | '));
        console.error('My Day draft DOM: ' + body.slice(0, 2500));
        throw error;
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => fixture.server.close(resolve));
    }
}

run().catch(error => {
    console.error(`My Day draft browser smoke failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});