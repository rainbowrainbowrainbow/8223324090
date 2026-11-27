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

const FIXTURE_PAGE_LIMIT = 32;

function fixtureBucketPage(state, bucket, offset = 0, limit = FIXTURE_PAGE_LIMIT) {
    const matching = (state.seedTasks || []).filter(task => task.bucket === bucket);
    const tasks = matching.slice(offset, offset + limit);
    const nextOffset = offset + tasks.length;
    const hasMore = nextOffset < matching.length;
    const bucketPage = {
        total: matching.length,
        returned: tasks.length,
        offset,
        limit,
        hasMore,
        nextCursor: hasMore ? { offset: nextOffset, limit } : null
    };
    return { tasks, meta: { bucketPage } };
}

function cabinetProjection(state = {}) {
    const seedTasks = state.seedTasks || [];
    const today = fixtureBucketPage(state, 'today');
    const overdue = fixtureBucketPage(state, 'overdue');
    const future = fixtureBucketPage(state, 'future');
    return {
        success: true,
        all: [...seedTasks, ...(state.createdTask ? [state.createdTask] : [])],
        activeMyDay: [],
        today: today.tasks,
        overdue: overdue.tasks,
        waiting: [],
        deferred: [],
        private: [],
        completedHistory: [],
        planning: { all: [...today.tasks, ...overdue.tasks, ...future.tasks], today: today.tasks, overdue: overdue.tasks, future: future.tasks },
        meta: { buckets: { planning: { today: today.meta.bucketPage, overdue: overdue.meta.bucketPage, future: future.meta.bucketPage } } },
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
            const bucket = url.searchParams.get('bucket');
            if (bucket) {
                const offset = Number(url.searchParams.get('offset'));
                const limit = Number(url.searchParams.get('limit'));
                return json(route, { success: true, ...fixtureBucketPage(state, bucket, offset, limit) });
            }
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
    const originalDate = await date.inputValue();
    const draft = 'Browser regression draft — do not create';
    const titleHeight = await title.evaluate(element => element.offsetHeight);
    await title.fill('A long example task title '.repeat(9));
    assert.ok(await title.evaluate(element => element.offsetHeight) > titleHeight, 'long titles grow on a phone');
    await page.getByRole('button', { name: 'Додати задачу', exact: true }).click();
    assert.equal(await title.getAttribute('aria-invalid'), 'true', 'submission marks the overlong title invalid');
    await title.fill(draft);
    assert.equal(await title.getAttribute('aria-invalid'), 'false', 'correcting the title clears the error while typing');
    await title.clear();
    await title.click();
    await title.pressSequentially(draft, { delay: 1 });

    await date.fill('');
    assert.equal(await title.inputValue(), draft, 'clearing the date keeps the typed task draft');
    assert.equal(await date.inputValue(), '', 'the date was cleared');
    await date.fill(originalDate);
    assert.equal(await title.inputValue(), draft, 'restoring today keeps the typed task draft');
    assert.equal(await date.inputValue(), originalDate, 'today is restored in the date input');

    const beforeDateChange = state.cabinetRequests;
    await date.fill('2099-05-31');
    assert.equal(await title.inputValue(), draft, 'changing the custom date keeps the typed task draft');
    assert.equal(await date.inputValue(), '2099-05-31', 'custom date remains selected');
    assert.equal(state.cabinetRequests, beforeDateChange, 'the composer date does not reload the board');
}

async function assertComposerListenersStayBoundOnce(page, state) {
    const session = await page.context().newCDPSession(page);
    const input = await session.send('Runtime.evaluate', {
        expression: "document.getElementById('cabinetTaskTitle')",
        objectGroup: 'my-day-listener-check'
    });
    const countInputListeners = async () => {
        const result = await session.send('DOMDebugger.getEventListeners', { objectId: input.result.objectId });
        return result.listeners.filter(listener => listener.type === 'input').length;
    };
    const initialCount = await countInputListeners();
    const initialCabinetRequests = state.cabinetRequests;
    assert.equal(initialCount, 1, 'composer title starts with one input handler');
    for (let index = 0; index < 20; index += 1) {
        await page.locator('#cabinetTaskDate').fill(index % 2 ? '' : '2099-05-31');
    }
    assert.equal(await countInputListeners(), 1, 'partial date refreshes do not multiply composer input handlers');
    assert.equal(state.cabinetRequests, initialCabinetRequests, 'date toggles do not multiply projection requests');
    await session.detach();
}

async function assertLargeListsStayAccessible(page, state) {
    const dates = await page.evaluate(() => ({
        today: window.TaskCreate.todayStr(),
        overdue: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
        future: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    }));
    state.seedTasks = Object.entries(dates).flatMap(([bucket, date], periodIndex) => Array.from({ length: 80 }, (_, index) => ({
        id: 20000 + 80 * periodIndex + index,
        title: `Synthetic task ${index}`,
        status: 'todo',
        priority: 'normal',
        visibility: 'me_only',
        task_mode: 'personal',
        deadline: `${date}T10:00:00Z`,
        bucket
    })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    const periods = page.locator('[data-park-period]');
    await periods.last().waitFor();
    assert.deepEqual(await periods.evaluateAll(columns => columns.map(column => column.dataset.parkPeriod)), ['today', 'overdue', 'future']);
    const originalViewport = page.viewportSize();
    const undated = page.locator('[data-park-period="today"] > [data-park-task-group="today"] + .park-undated');
    for (const width of [1440, originalViewport.width]) {
        await page.setViewportSize({ ...originalViewport, width });
        const summary = undated.locator('summary');
        await summary.waitFor();
        await summary.press('Enter');
        assert.equal(await undated.locator('[data-park-task-group="noDate"]').isVisible(), true);
        await summary.press('Enter');
    }
    assert.equal(await page.locator('[data-park-my-day-view], [data-cabinet-my-day-view-mode]').count(), 0);
    await page.locator('.park-composer > summary').press('Enter');
    const title = page.locator('#cabinetTaskTitle');
    const draft = 'Keep this draft while loading more tasks';
    await title.fill(draft);
    const composer = await title.evaluateHandle(element => element.closest('#cabinetTaskComposer'));
    for (const bucket of ['today', 'overdue', 'future']) {
        const group = page.locator(`[data-park-task-group="${bucket}"]`);
        const more = group.locator(`[data-cabinet-bucket-more="${bucket}"]`);
        const cards = group.locator('.park-task-card');
        await group.getByText('Показано 32 із 80', { exact: true }).waitFor();
        assert.equal(await cards.count(), 32);
        assert.equal(await cards.first().getByText('Особиста', { exact: true }).isVisible(), true);
        for (const count of [64, 80]) {
            await more.click();
            await group.getByText(`Показано ${count} із 80`, { exact: true }).waitFor();
            assert.equal(await cards.count(), count);
            assert.equal(await title.inputValue(), draft, 'loading more tasks preserves the draft');
            assert.ok(await title.evaluate((element, original) => element.closest('#cabinetTaskComposer') === original, composer),
                'loading more tasks preserves the composer node');
        }
        assert.equal(await more.count(), 0);
    }
    await composer.dispose();
}

async function assertFullComposerContract(page, state) {
    const readComposer = () => page.evaluate(() => ({
        title: document.getElementById('cabinetTaskTitle')?.value || '',
        description: document.getElementById('cabinetTaskDetails')?.value || '',
        date: document.getElementById('cabinetTaskDate')?.value || '',
        category: document.getElementById('cabinetTaskCategory')?.value || '',
        mode: document.getElementById('cabinetTaskMode')?.value || '',
        priority: document.getElementById('cabinetTaskPriority')?.value || '',
        visibility: document.getElementById('cabinetTaskVisibility')?.value || '',
        allowReschedule: document.getElementById('cabinetTaskAllowReschedule')?.checked === true
    }));
    const title = page.locator('#cabinetTaskTitle');
    const options = page.locator('#cabinetTaskComposer .park-composer-options');
    await options.locator('summary').press('Enter');
    assert.equal(await options.evaluate(element => element.open), true);
    await title.fill('Browser full composer create');
    await page.locator('#cabinetTaskDetails').fill('Browser composer description');
    await page.locator('#cabinetTaskCategory').selectOption('event');
    await page.locator('#cabinetTaskMode').selectOption('personal');
    await page.locator('#cabinetTaskPriority').selectOption('high');
    await page.locator('#cabinetTaskVisibility').selectOption('me_only');
    await page.locator('#cabinetTaskAllowReschedule').uncheck();
    assert.equal(await page.getByRole('button', { name: 'Заповнити з AI', exact: true }).count(), 0);
    assert.equal(await page.locator('#cabinetTaskKind').inputValue(), 'action');
    assert.equal(await page.locator('#cabinetDecompositionMode, #cabinetSubtaskList, #cabinetTaskReportRequired').count(), 0);
    const expected = await readComposer();

    const assertRetained = async label => {
        const actual = await readComposer();
        for (const key of ['title', 'description', 'category', 'mode', 'priority', 'visibility', 'allowReschedule']) {
            assert.equal(actual[key], expected[key], `${label} keeps ${key}`);
        }
    };

    const previousDate = await page.locator('#cabinetTaskDate').inputValue();
    await page.locator('#cabinetTaskDate').fill('');
    await assertRetained('clearing the date');
    await page.locator('#cabinetTaskDate').fill(previousDate);
    await assertRetained('restoring today');

    const customDate = page.locator('#cabinetTaskDate');
    await customDate.fill('2099-06-01');
    await assertRetained('changing the custom date');
    assert.equal(await customDate.inputValue(), '2099-06-01');

    const isTaskCreate = response => {
        const url = new URL(response.url());
        return response.request().method() === 'POST' && url.pathname === '/api/tasks';
    };
    const submitComposer = async () => {
        const submitState = await page.locator('#cabinetTaskComposer').evaluate(form => ({
            valid: form.checkValidity(),
            onsubmit: form.getAttribute('onsubmit') || '',
            createHandlerType: typeof window.createCabinetTask,
            title: document.getElementById('cabinetTaskTitle')?.value || '',
            invalid: Array.from(form.elements || [])
                .filter(element => typeof element.checkValidity === 'function' && !element.checkValidity())
                .map(element => ({
                    id: element.id || '',
                    name: element.getAttribute('name') || '',
                    value: element.value || '',
                    message: element.validationMessage || ''
                }))
        }));
        assert.equal(submitState.valid, true, `composer form is valid before submit: ${JSON.stringify(submitState)}`);
        assert.match(submitState.onsubmit, /createCabinetTask/, 'composer form keeps create submit handler');
        assert.equal(submitState.createHandlerType, 'function', 'createCabinetTask is globally callable');
        assert.ok(submitState.title, 'composer title is set before submit');
        await page.getByRole('button', { name: 'Додати задачу', exact: true }).click();
    };
    const [failedCreate] = await Promise.all([
        page.waitForResponse(isTaskCreate),
        submitComposer()
    ]);
    assert.equal(failedCreate.status(), 503, '503 fixture create is delivered to the composer');
    await assertRetained('503 create failure');
    assert.equal(await customDate.inputValue(), '2099-06-01', '503 create failure keeps custom date');

    state.createMode = 'success';
    const [successfulCreate] = await Promise.all([
        page.waitForResponse(isTaskCreate),
        submitComposer()
    ]);
    assert.equal(successfulCreate.status(), 200, 'verified fixture create succeeds');
    await page.waitForFunction(() => document.getElementById('cabinetTaskTitle')?.value === '');
    await page.waitForFunction(() => {
        const form = document.getElementById('cabinetTaskComposer');
        return form
            && document.getElementById('cabinetTaskCategory')?.value === 'admin'
            && document.getElementById('cabinetTaskMode')?.value === 'work'
            && document.getElementById('cabinetTaskAllowReschedule')?.checked === true
            && !form.querySelector('#cabinetTaskReportRequired, [data-cabinet-subtask-title]');
    });

    const payload = state.taskCreatePayloads.at(-1);
    assert.equal(payload.title, expected.title, 'payload title is exact');
    assert.equal(payload.description, expected.description, 'payload description is exact');
    assert.equal(payload.category, 'event', 'payload category is exact');
    assert.equal(payload.task_mode, 'personal', 'payload mode is exact');
    assert.equal(payload.task_kind, 'action', 'new My Day tasks use the canonical action kind');
    assert.equal(payload.priority, 'high', 'payload priority is exact');
    assert.equal(payload.visibility, 'me_only', 'payload visibility is exact');
    assert.equal(Object.hasOwn(payload, 'reportRequired'), false, 'payload omits the retired report requirement');
    assert.equal(payload.allowReschedule, false, 'payload reschedule control is exact');
    assert.equal(payload.date, '2099-06-01', 'payload custom date is exact');
    assert.equal(Object.hasOwn(payload, 'schedule'), false, 'a date without a time stays date-only');
    assert.equal(Object.hasOwn(payload, 'deadline'), false, 'a date without a time has no implicit deadline hour');
    assert.equal(Object.hasOwn(payload, 'subtasks'), false, 'payload omits the retired checklist');

    const reset = await readComposer();
    assert.deepEqual({
        title: reset.title,
        description: reset.description,
        category: reset.category,
        mode: reset.mode,
        priority: reset.priority,
        visibility: reset.visibility,
        allowReschedule: reset.allowReschedule
    }, {
        title: '',
        description: '',
        category: 'admin',
        mode: 'work',
        priority: 'normal',
        visibility: 'team',
        allowReschedule: true
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
        viewport: { width: 390, height: 844 }
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
        await page.locator('.park-composer > summary').press('Enter');
        await page.waitForSelector('#cabinetTaskTitle');
        await assertComposerListenersStayBoundOnce(page, state);
        await assertDraftSurvivesDueChanges(page, state);
        await assertFullComposerContract(page, state);
        await assertLargeListsStayAccessible(page, state);
        assert.ok(state.requests.some(item => item.includes('/api/tasks/my-cabinet')), 'browser uses the My Day projection endpoint');
        assert.equal(state.taskCreatePayloads.length, 2, 'browser exercised exactly one failed and one successful create');
        assert.equal(state.suggestionRequests, 0, 'typing a task does not request decomposition suggestions');
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
