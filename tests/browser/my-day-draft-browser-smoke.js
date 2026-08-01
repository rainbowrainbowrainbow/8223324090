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

function cabinetProjection(state = {}) {
    return {
        success: true,
        all: state.createdTask ? [state.createdTask] : [],
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
            const mutation = `${request.method()} ${url.pathname}${url.search}`;
            state.mutations.push(mutation);
            if (!url.pathname.startsWith('/api/')) {
                state.unexpectedMutations.push(mutation);
                return route.abort('blockedbyclient');
            }
            if (request.method() === 'POST' && url.pathname === '/api/tasks/decomposition-suggestions') {
                state.suggestionRequests += 1;
                return json(route, { success: true, suggestions: [] });
            }
            if (request.method() === 'POST' && ['/api/achievements/check', '/api/quests/check-titles'].includes(url.pathname)) {
                return json(route, { success: true });
            }
            if (request.method() === 'POST' && url.pathname === '/api/tasks') {
                let payload = {};
                try {
                    payload = request.postDataJSON() || {};
                } catch (_) {
                    state.unexpectedMutations.push(mutation);
                    return json(route, { success: false, error: 'Fixture payload is invalid' }, 400);
                }
                state.taskCreatePayloads.push(payload);
                if (state.createMode === 'fail') {
                    return json(route, { success: false, error: 'Fixture create failure' }, 503);
                }
                state.createdTask = { id: 991, ...payload };
                return json(route, { success: true, task: state.createdTask });
            }
            state.unexpectedMutations.push(mutation);
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
            return json(route, cabinetProjection(state));
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
    await title.click();
    await title.pressSequentially(draft, { delay: 1 });

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
async function assertFullComposerContract(page, state) {
    const readComposer = () => page.evaluate(() => ({
        title: document.getElementById('cabinetTaskTitle')?.value || '',
        date: document.getElementById('cabinetTaskDate')?.value || '',
        category: document.getElementById('cabinetTaskCategory')?.value || '',
        mode: document.getElementById('cabinetTaskMode')?.value || '',
        kind: document.getElementById('cabinetTaskKind')?.value || '',
        priority: document.getElementById('cabinetTaskPriority')?.value || '',
        visibility: document.getElementById('cabinetTaskVisibility')?.value || '',
        reportRequired: document.getElementById('cabinetTaskReportRequired')?.checked === true,
        allowReschedule: document.getElementById('cabinetTaskAllowReschedule')?.checked === true,
        subtasks: Array.from(document.querySelectorAll('#cabinetSubtaskList [data-cabinet-subtask-title]'), input => input.value)
    }));
    const title = page.locator('#cabinetTaskTitle');
    const toggle = page.locator('[data-cabinet-composer-toggle]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.locator('#cabinetTaskCategory').selectOption('event');
    await page.locator('#cabinetTaskMode').selectOption('personal');
    await page.locator('#cabinetTaskKind').selectOption('action');
    await page.locator('#cabinetTaskPriority').selectOption('high');
    await page.locator('#cabinetTaskVisibility').selectOption('me_only');
    await page.locator('#cabinetTaskReportRequired').check();
    await page.locator('#cabinetTaskAllowReschedule').uncheck();
    await page.locator('.cabinet-subtask-list-toolbar .cabinet-subtask-add').click();
    await page.locator('#cabinetSubtaskList [data-cabinet-subtask-title]').fill('Browser checklist child');
    const expected = await readComposer();

    const assertRetained = async label => {
        const actual = await readComposer();
        for (const key of ['title', 'category', 'mode', 'kind', 'priority', 'visibility', 'reportRequired', 'allowReschedule']) {
            assert.equal(actual[key], expected[key], `${label} keeps ${key}`);
        }
        assert.deepEqual(actual.subtasks, expected.subtasks, `${label} keeps subtasks`);
    };

    for (const preset of ['today', 'tomorrow', 'day_after_tomorrow', 'plus_3_days', 'month_end', 'no_date', 'custom']) {
        await page.locator(`[data-cabinet-due-preset="${preset}"]`).click();
        await assertRetained(`${preset} after full composer input`);
    }

    const customDate = page.locator('#cabinetTaskDate');
    const customProjection = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/tasks/my-cabinet' && url.searchParams.get('focusDate') === '2099-05-31';
    });
    await customDate.fill('2099-05-31');
    await customProjection;
    await assertRetained('custom-date background projection');
    assert.equal(await customDate.inputValue(), '2099-05-31', 'custom date stays after a background projection');

    const isTaskCreate = response => {
        const url = new URL(response.url());
        return response.request().method() === 'POST' && url.pathname === '/api/tasks';
    };
    const failedCreate = page.waitForResponse(isTaskCreate);
    await page.locator('.cabinet-task-create-submit').click();
    assert.equal((await failedCreate).status(), 503, '503 fixture create is delivered to the composer');
    await assertRetained('503 create failure');
    assert.equal(await customDate.inputValue(), '2099-05-31', '503 create failure keeps custom date');

    state.createMode = 'success';
    const successfulCreate = page.waitForResponse(isTaskCreate);
    await page.locator('.cabinet-task-create-submit').click();
    assert.equal((await successfulCreate).status(), 200, 'verified fixture create succeeds');
    await page.waitForFunction(() => document.getElementById('cabinetTaskTitle')?.value === '');

    const payload = state.taskCreatePayloads.at(-1);
    assert.equal(payload.title, expected.title, 'payload title is exact');
    assert.equal(payload.category, 'event', 'payload category is exact');
    assert.equal(payload.task_mode, 'personal', 'payload mode is exact');
    assert.equal(payload.task_kind, 'checklist', 'payload uses checklist for a task with subtasks');
    assert.equal(payload.priority, 'high', 'payload priority is exact');
    assert.equal(payload.visibility, 'me_only', 'payload visibility is exact');
    assert.equal(payload.reportRequired, true, 'payload report requirement is exact');
    assert.equal(payload.allowReschedule, false, 'payload reschedule control is exact');
    assert.equal(payload.date, '2099-05-31', 'payload custom date is exact');
    assert.equal(payload.schedule?.date, '2099-05-31', 'payload schedule date is exact');
    assert.equal(payload.schedule?.durationMinutes, 30, 'payload schedule duration is exact');
    assert.deepEqual(payload.subtasks, [{ title: 'Browser checklist child', sort_order: 0, source_type: 'manual', is_done: false }], 'payload subtasks are exact');

    const reset = await readComposer();
    assert.deepEqual({
        title: reset.title,
        category: reset.category,
        mode: reset.mode,
        kind: reset.kind,
        priority: reset.priority,
        visibility: reset.visibility,
        reportRequired: reset.reportRequired,
        allowReschedule: reset.allowReschedule,
        subtasks: reset.subtasks
    }, {
        title: '',
        category: 'personal',
        mode: 'personal',
        kind: 'action',
        priority: 'normal',
        visibility: 'me_only',
        reportRequired: false,
        allowReschedule: true,
        subtasks: []
    }, 'verified success resets every composer field to defaults');
    assert.equal(reset.date, await page.evaluate(() => window.TaskCreate.todayStr()), 'verified success resets the due date to today');
    assert.equal(await title.inputValue(), '', 'verified success clears title after the projection confirms the row');
}


async function run() {
    const { chromium } = requirePlaywright();
    const fixture = await createStaticServer();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: 1440, height: 900 }
    });
    const state = { requests: [], mutations: [], unexpectedMutations: [], rootNavigations: [], cabinetRequests: 0, suggestionRequests: 0, taskCreatePayloads: [], createMode: 'fail', createdTask: null };
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
        await assertFullComposerContract(page, state);
        assert.ok(state.requests.some(item => item.includes('/api/tasks/my-cabinet')), 'browser uses the My Day projection endpoint');
        assert.equal(state.taskCreatePayloads.length, 2, 'browser exercised exactly one failed and one successful create');
        assert.ok(state.suggestionRequests >= 1, 'browser input uses mocked decomposition suggestions');
        assert.deepEqual(state.unexpectedMutations, [], 'browser issues no unapproved fixture mutation');
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