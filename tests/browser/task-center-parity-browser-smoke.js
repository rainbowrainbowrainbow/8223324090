#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { buildCapabilitySnapshot } = require('../../services/accountAccessPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const HEADLESS = process.env.TASK_CENTER_BROWSER_SMOKE_HEADLESS !== 'false';
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
    id: 901,
    username: 'task.center.qa',
    name: 'Task Center QA',
    role: 'creator',
    businessContexts: ['event_genix'],
    business_contexts: ['event_genix'],
    defaultBusinessContext: 'event_genix',
    default_business_context: 'event_genix',
    pageAllowlist: ['/tasks'],
    page_allowlist: ['/tasks'],
    actionAllowlist: [],
    action_allowlist: []
};

const AUTH_PERMISSIONS = (() => {
    const snapshot = buildCapabilitySnapshot(USER);
    return {
        role: USER.role,
        roles: [USER.role],
        pageAllowlist: ['/tasks'],
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

const TASK_PERMISSIONS = {
    success: true,
    role: 'creator',
    permissions: {
        canCreateTasks: false,
        canDeleteTasks: false,
        canAssignAnyone: false,
        canEditOwnTasks: true,
        canEditAllTasks: false,
        taskVisibility: 'own'
    },
    capabilities: {
        create: { allowed: false, reasonCode: 'TASK_CREATE_FORBIDDEN' },
        delete: { allowed: false, reasonCode: 'TASK_DELETE_FORBIDDEN' },
        review: { allowed: false, reasonCode: 'TASK_REVIEW_FORBIDDEN' }
    }
};

const DRAWER_ACTIONS = {
    view: true,
    edit: false,
    save: false,
    complete: false,
    reassign: false,
    reschedule: false,
    manageObservers: false,
    manageSubtasks: false,
    review: false,
    delete: false,
    readHistory: true,
    openSource: true
};

const DRAWER_REASONS = {
    edit: 'TASK_MUTATION_FORBIDDEN',
    save: 'TASK_MUTATION_FORBIDDEN',
    complete: 'TASK_MUTATION_FORBIDDEN',
    reassign: 'TASK_REASSIGN_FORBIDDEN',
    reschedule: 'TASK_RESCHEDULE_FORBIDDEN',
    manageObservers: 'TASK_OBSERVERS_FORBIDDEN',
    manageSubtasks: 'TASK_MUTATION_FORBIDDEN',
    review: 'TASK_REVIEW_FORBIDDEN',
    delete: 'TASK_DELETE_FORBIDDEN'
};

const TASK = {
    id: 42,
    version: 3,
    title: 'QA permission boundary task',
    description: 'Read-only local fixture task',
    expectedResult: 'Parity is verified without mutations',
    status: 'todo',
    workflowState: 'blocked',
    priority: 'urgent',
    taskMode: 'work',
    taskKind: 'action',
    visibility: 'team',
    category: 'admin',
    date: '2026-07-30',
    deadline: '2026-07-30T10:00:00.000Z',
    ownerUserId: USER.id,
    ownerLabel: USER.name,
    owner_name: USER.name,
    assigned_to: USER.name,
    creatorUserId: 902,
    creatorName: 'Fixture Manager',
    businessContext: 'event_genix',
    effortMinutes: 60,
    subtasks: [],
    observers: [],
    dependencies: [],
    sourceType: 'lead',
    sourceId: 'LEAD-QA-42',
    drawer: {
        contract: 'task_drawer_v1',
        actions: DRAWER_ACTIONS,
        actionReasons: DRAWER_REASONS,
        source: {
            type: 'lead',
            label: 'Lead',
            id: 'LEAD-QA-42',
            module: 'sales',
            surface: 'task_center_smoke',
            href: '/sales-funnel?open=LEAD-QA-42'
        },
        completion: { reportRequired: true, reportId: null }
    }
};

function dateRange() {
    const from = new Date();
    const key = date => date.toISOString().slice(0, 10);
    const first = key(from);
    from.setUTCDate(from.getUTCDate() + 1);
    return [first, key(from)];
}

function overviewPayload({ empty = false, partial = false } = {}) {
    const queue = empty ? [] : [{
        task: TASK,
        reasons: [
            { code: 'overdue', label: 'Overdue', riskDays: 1 },
            { code: 'blocked', label: 'Blocked', riskDays: 1 }
        ],
        recommendedAction: 'Open details and resolve the blocker'
    }];
    return {
        success: true,
        counts: {
            overdue: empty ? 0 : 1,
            urgent: empty ? 0 : 1,
            blocked: empty ? 0 : 1,
            unassigned: 0,
            stale: 0,
            due_today: 0
        },
        queue,
        meta: {
            activeTotal: empty ? 0 : 1,
            exceptionTotal: partial ? 3 : queue.length,
            returned: queue.length,
            hasMore: partial,
            partial,
            paginationIndependent: true
        }
    };
}

function teamPayload() {
    const dates = dateRange();
    const day = (date, scheduledTasks = []) => ({
        date,
        capacity: { status: 'unavailable', minutes: null },
        scheduledEffortMinutes: scheduledTasks.length ? 60 : 0,
        overloadMinutes: 0,
        scheduledTasks
    });
    const metrics = {
        active: 1,
        overdue: 1,
        urgent: 1,
        blocked: 1,
        dueSoon: 1,
        noDate: 0,
        knownEffortMinutes: 60,
        unknownEffortTasks: 0,
        scheduledEffortMinutes: 60,
        unscheduledTasks: 1
    };
    return {
        success: true,
        dates,
        owners: [{
            ownerUserId: USER.id,
            ownerLabel: USER.name,
            department: null,
            metrics,
            overloadDays: 0,
            tasks: [{ task: TASK, facts: { effortMinutes: 60 }, exceptions: ['overdue', 'blocked'] }],
            days: [day(dates[0], [{ task: TASK, facts: { effortMinutes: 60 } }]), day(dates[1])]
        }],
        unscheduled: [{ task: TASK, ownerLabel: USER.name, facts: { effortMinutes: 60 } }],
        meta: {
            from: dates[0],
            to: dates[1],
            capacityAvailable: false,
            paginationIndependent: true
        }
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
    if (relative === 'tasks') relative = 'tasks.html';
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
        const method = request.method();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            state.mutations.push(`${method} ${url.pathname}${url.search}`);
            return route.abort('blockedbyclient');
        }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        state.requests.push(`${method} ${url.pathname}${url.search}`);
        if (url.pathname === '/api/auth/verify') return json(route, { user: USER });
        if (url.pathname === '/api/auth/permissions') return json(route, AUTH_PERMISSIONS);
        if (url.pathname === '/api/business/profile') return json(route, { businessProfile: BUSINESS_PROFILE });
        if (url.pathname === '/api/tasks/owners') return json(route, { success: true, users: [{ id: USER.id, name: USER.name, label: USER.name, role: USER.role }] });
        if (url.pathname === '/api/tasks/permissions') return json(route, TASK_PERMISSIONS);
        if (url.pathname === '/api/tasks/preferences') return json(route, {
            success: true,
            preferences: {
                savedTaskViewsRevision: 4,
                savedTaskViews: [{
                    id: 'qa-overview',
                    name: 'QA Overview',
                    state: { mode: 'overview', queue: 'inbox', ownerUserId: '', dateFrom: '', dateTo: '', status: [], priority: ['urgent'], category: '', source: '', search: '' }
                }]
            }
        });
        if (url.pathname === '/api/tasks/decomposition-saved-templates') return json(route, { success: true, templates: [] });
        if (url.pathname === '/api/tasks/overview') {
            if (state.overview === 'loading') await new Promise(resolve => setTimeout(resolve, 500));
            if (state.overview === 'error') return json(route, { success: false, error: 'fixture error' }, 500);
            if (state.overview === 'empty') return json(route, overviewPayload({ empty: true }));
            return json(route, overviewPayload({ partial: state.overview === 'partial' }));
        }
        if (url.pathname === '/api/tasks/team-control') return json(route, teamPayload());
        if (url.pathname === '/api/tasks/42/history') return json(route, { success: true, history: [] });
        if (url.pathname === '/api/tasks/42/observers') return json(route, { success: true, observers: [] });
        if (url.pathname === '/api/tasks/42/subtasks') return json(route, { success: true, subtasks: [] });
        if (url.pathname === '/api/tasks/42') return json(route, { success: true, task: TASK });
        if (url.pathname === '/api/task-templates') return json(route, []);
        if (url.pathname === '/api/dashboard/alerts') return json(route, { alerts: [] });
        if (url.pathname === '/api/tasks') return json(route, {
            success: true,
            tasks: [TASK],
            pagination: { page: 1, limit: 100, total: 1, hasMore: false, nextPage: null }
        });
        return json(route, { success: true });
    });
}

async function waitForMode(page, mode) {
    await page.waitForFunction(expected => {
        const shell = document.getElementById('taskCenterShell');
        const tab = document.querySelector(`.task-center-mode-tab[data-task-mode="${expected}"]`);
        return shell?.dataset.taskMode === expected && tab?.getAttribute('aria-selected') === 'true';
    }, mode);
}

async function openPage(page, baseUrl, query = '') {
    await page.goto(`${baseUrl}/tasks${query}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#taskCenterQueryControls') && !document.querySelector('.page-fatal-error'));
}

async function assertNoHorizontalOverflow(page, label) {
    const result = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        viewport: window.innerWidth
    }));
    assert.ok(result.scrollWidth <= result.clientWidth + 1, `${label}: document has no horizontal overflow (${JSON.stringify(result)})`);
    assert.ok(result.bodyWidth <= result.viewport + 1, `${label}: body has no horizontal overflow (${JSON.stringify(result)})`);
}

async function verifyModesAndUrl(page, baseUrl) {
    await openPage(page, baseUrl, '?mode=overview&queue=inbox&owner=901&from=2026-07-01&to=2026-07-31&status=todo&priority=urgent&category=admin&source=lead&search=fixture');
    await waitForMode(page, 'overview');
    await page.waitForSelector('.task-overview-queue', { timeout: 8000 });
    const canonical = new URL(page.url());
    assert.equal(canonical.searchParams.get('owner'), '901');
    assert.equal(canonical.searchParams.get('priority'), 'urgent');
    assert.equal(canonical.searchParams.get('source'), 'lead');
    assert.equal(canonical.searchParams.get('search'), 'fixture');
    assert.equal(await page.locator('[data-task-saved-view] option').count(), 2, 'saved view control contains server-backed fixture view');
    assert.equal(await page.locator('#taskCreatePermissionNotice').isVisible(), true, 'create permission reason is visible');
    assert.match(await page.locator('#taskCreatePermissionNotice').textContent(), /\S/, 'create permission reason is non-empty');

    for (const mode of ['team', 'planning', 'library', 'overview']) {
        await page.locator(`.task-center-mode-tab[data-task-mode="${mode}"]`).click();
        await waitForMode(page, mode);
        assert.equal(new URL(page.url()).searchParams.get('mode'), mode, `${mode} is reflected in URL`);
        if (mode === 'team') await page.waitForSelector('.task-team-owner-card');
        if (mode === 'planning') await page.waitForSelector('.task-planning-table');
        if (mode === 'library') assert.equal(await page.locator('#templatesSection').isVisible(), true, 'library renders template surface');
        if (mode === 'overview') await page.waitForSelector('.task-overview');
    }

    const firstTab = page.locator('.task-center-mode-tab').first();
    await firstTab.focus();
    await page.keyboard.press('ArrowRight');
    await waitForMode(page, 'team');
    assert.equal(await page.locator('.task-center-mode-tab[data-task-mode="team"]').evaluate(el => el === document.activeElement), true, 'ArrowRight moves focus and selection');
    await page.keyboard.press('End');
    await waitForMode(page, 'library');
    assert.equal(await page.locator('.task-center-mode-tab[data-task-mode="library"]').evaluate(el => el === document.activeElement), true, 'End moves focus and selection');

    const aria = await page.evaluate(() => ({
        tablist: document.querySelector('.task-center-mode-tabs')?.getAttribute('role'),
        tabs: [...document.querySelectorAll('.task-center-mode-tab')].map(tab => ({ role: tab.getAttribute('role'), selected: tab.getAttribute('aria-selected') }))
    }));
    assert.equal(aria.tablist, 'tablist');
    assert.equal(aria.tabs.length, 4);
    assert.equal(aria.tabs.filter(tab => tab.selected === 'true').length, 1);
    assert.ok(aria.tabs.every(tab => tab.role === 'tab'));
}

async function verifyLegacyLinks(page, baseUrl) {
    const mappings = [
        ['?view=today', 'overview'],
        ['?view=team', 'team'],
        ['?view=board', 'planning'],
        ['?view=templates', 'library'],
        ['?view=archive', 'library']
    ];
    for (const [query, mode] of mappings) {
        await openPage(page, baseUrl, query);
        await waitForMode(page, mode);
    }
}

async function verifyDrawer(page, baseUrl) {
    await openPage(page, baseUrl, '?mode=overview&open=42');
    await page.waitForSelector('#taskDetailOverlay');
    assert.equal(new URL(page.url()).searchParams.get('open'), '42');
    assert.equal(await page.locator('#taskDetailOverlay').getAttribute('data-task-version'), '3');
    const disabledControls = await page.locator('#taskDetailOverlay [disabled][aria-disabled="true"]').count();
    assert.ok(disabledControls >= 3, `drawer exposes permission-disabled controls (${disabledControls})`);
    const permissionHint = page.locator('#taskDetailPermissionHint');
    assert.equal(await permissionHint.isVisible(), true, 'drawer permission explanation is visible');
    assert.match(await permissionHint.textContent(), /\S/, 'drawer permission explanation is non-empty');
    assert.equal(await page.locator('.task-detail-source-card').isVisible(), true, 'drawer shows CRM source');
}

async function verifyStates(page, baseUrl, state) {
    state.overview = 'loading';
    const navigation = page.goto(`${baseUrl}/tasks?mode=overview`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.loading-spinner');
    await navigation;
    await page.waitForSelector('.task-overview');

    state.overview = 'empty';
    await openPage(page, baseUrl, '?mode=overview');
    await page.waitForSelector('.task-overview');
    assert.equal(await page.locator('.task-overview-queue').count(), 0, 'empty overview has no exception queue');

    state.overview = 'partial';
    await openPage(page, baseUrl, '?mode=overview');
    await page.waitForSelector('.task-overview-more');

    state.overview = 'error';
    await openPage(page, baseUrl, '?mode=overview');
    await page.waitForSelector('.page-fatal-error[role=alert]');
    assert.equal(await page.locator('.page-fatal-error[role=alert]').isVisible(), true, 'initial overview error renders an accessible fatal state');
    state.overview = 'normal';
}

async function verifyResponsiveThemesAndMotion(page, baseUrl) {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.evaluate(() => localStorage.setItem('pzp_dark_mode', 'true'));
    await openPage(page, baseUrl, '?mode=overview');
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true, 'reduced motion preference reaches page');
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('dark-mode')), true, 'dark mode is applied');

    const viewports = [
        { width: 320, height: 700 },
        { width: 360, height: 760 },
        { width: 390, height: 844 },
        { width: 768, height: 900 },
        { width: 1440, height: 900 }
    ];
    for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(75);
        await assertNoHorizontalOverflow(page, `${viewport.width}x${viewport.height}`);
    }

    await page.evaluate(() => localStorage.setItem('pzp_dark_mode', 'false'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.task-overview');
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('dark-mode')), false, 'light mode is applied');
    await page.locator('.task-center-mode-tab').first().focus();
    const focusStyle = await page.locator('.task-center-mode-tab').first().evaluate(el => {
        const style = getComputedStyle(el);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    assert.notEqual(focusStyle.outlineStyle, 'none', `keyboard focus is visible (${JSON.stringify(focusStyle)})`);
}

async function run() {
    const { chromium } = requirePlaywright();
    const fixture = await createStaticServer();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    const state = { overview: 'normal', requests: [], mutations: [], rootNavigations: [] };
    const pageErrors = [];
    await context.addInitScript(user => {
        localStorage.setItem('pzp_token', 'task-center-read-only-fixture');
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        if (localStorage.getItem('pzp_dark_mode') === null) localStorage.setItem('pzp_dark_mode', 'false');
        localStorage.setItem('pzp_sidebar_collapsed', 'true');
    }, { ...USER, permissions: AUTH_PERMISSIONS });
    await installFixtureRoutes(context, fixture.baseUrl, state);
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
        await verifyModesAndUrl(page, fixture.baseUrl);
        await verifyLegacyLinks(page, fixture.baseUrl);
        await verifyDrawer(page, fixture.baseUrl);
        await verifyStates(page, fixture.baseUrl, state);
        await verifyResponsiveThemesAndMotion(page, fixture.baseUrl);
        assert.ok(state.requests.some(item => item.includes('/api/tasks/overview')), 'overview uses mocked API');
        assert.ok(state.requests.some(item => item.includes('/api/tasks/team-control')), 'team/planning use mocked API');
        assert.deepEqual(state.mutations, [], 'browser issued no task or preference mutations');
        assert.deepEqual(state.rootNavigations, [], 'authenticated Task Center never redirects to the root page');
        assert.deepEqual(pageErrors, [], `browser runtime has no uncaught errors: ${pageErrors.join('; ')}`);
        console.log('Task Center parity browser smoke passed');
    } catch (error) {
        const boardHtml = await page.locator('#boardContent').innerHTML().catch(() => 'board unavailable');
        const accessState = await page.evaluate(() => ({
            path: location.pathname,
            canAccessTasks: typeof canAccessPage === 'function' ? canAccessPage('/tasks') : null,
            currentUserRole: window.AppState?.currentUser?.role || null,
            taskPageDecision: window.AppState?.authPermissions?.capabilities?.['page:/tasks'] || null
        })).catch(() => null);
        console.error('Task Center parity diagnostics: url=' + page.url() + ' overview=' + state.overview);
        console.error('Task Center parity API requests: ' + state.requests.slice(-80).join(' | '));
        console.error('Task Center parity access: ' + JSON.stringify(accessState));
        console.error('Task Center parity board: ' + boardHtml.slice(0, 2000));
        throw error;
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => fixture.server.close(resolve));
    }
}

run().catch(error => {
    console.error(`Task Center parity browser smoke failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});
