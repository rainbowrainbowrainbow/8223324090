const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..');
const tasksSource = fs.readFileSync(path.join(repoRoot, 'js', 'tasks-page.js'), 'utf8');

function routeHandler(router, routePath = '/') {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods.get);
    assert.ok(layer, `GET ${routePath} handler exists`);
    return layer.route.stack.at(-1).handle;
}

function responseCapture() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function request(query = {}) {
    return {
        query,
        body: {},
        headers: {},
        user: {
            id: 7,
            userId: 7,
            username: 'qa-user',
            name: 'QA User',
            role: 'creator',
            business_contexts: ['event_genix']
        }
    };
}

test('Dashboard preparation drilldown keeps canonical overdue, booking visibility and business scope before pagination', async () => {
    const { pool } = require('../db');
    const { taskKpiCanonicalOverdueSql } = require('../services/taskPerformancePolicy');
    const { buildTaskVisibilityScope } = require('../services/taskPolicy');
    const { getVisibleBookingScope } = require('../services/bookingVisibility');
    const { taskBusinessScopeFromRequest, pushTaskBusinessScopeCondition } = require('../services/taskBusinessScope');
    const handler = routeHandler(require('../routes/tasks'));
    const originalQuery = pool.query;
    try {
        for (const role of ['creator', 'animator']) {
            const req = request({ pagination: '1', view: 'board', source_type: 'booking', overdue: '1', include_duplicates: '1', businessContext: 'event_genix', page: '2', limit: '1' });
            req.user.role = role;
            req.user.staff_id = 13;
            const sqlCalls = [];
            pool.query = async (sql, params = []) => {
                sqlCalls.push({ sql: String(sql), params: [...params] });
                if (/SELECT COUNT\(\*\)::int AS total FROM tasks t/i.test(sql)) return { rows: [{ total: 2 }] };
                return { rows: [{ id: 502, title: 'Preparation', status: 'todo', source_type: 'booking', source_id: 'qa-booking', visibility: 'private' }] };
            };
            const res = responseCapture();
            await handler(req, res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.pagination.total, 2);
            assert.deepEqual(res.body.tasks.map(task => task.id), [502]);
            const expectedParams = [];
            const scope = taskBusinessScopeFromRequest(req);
            const taskBusiness = pushTaskBusinessScopeCondition(expectedParams, scope, 't');
            const taskVisibility = buildTaskVisibilityScope(req.user, expectedParams, 't');
            const bookingVisibility = getVisibleBookingScope(req.user, expectedParams, 'b');
            const bookingBusiness = pushTaskBusinessScopeCondition(expectedParams, scope, 'b');
            for (const call of sqlCalls) {
                assert.ok(call.sql.includes(taskKpiCanonicalOverdueSql('t')), `${role}: canonical overdue policy is reused`);
                assert.ok(call.sql.includes(taskBusiness));
                assert.ok(call.sql.includes(taskVisibility.trim().replace(/^AND\s+/, '')));
                assert.ok(call.sql.includes(bookingBusiness));
                if (bookingVisibility.sql) assert.ok(call.sql.includes(bookingVisibility.sql));
                assert.match(call.sql, /t\.source_type = 'booking' AND t\.source_id = b\.id::text/);
                assert.match(call.sql, /COALESCE\(b\.status, 'confirmed'\) <> 'cancelled'/);
                assert.doesNotMatch(call.sql, /canonical_dup/, 'explicit existing duplicate opt-in keeps aggregate parity');
                assert.deepEqual(call.params.slice(0, expectedParams.length), expectedParams);
            }
            assert.deepEqual(sqlCalls.at(-1).params.slice(-2), [1, 1]);
            assert.ok(sqlCalls.at(-1).sql.indexOf("t.source_type = 'booking'") < sqlCalls.at(-1).sql.lastIndexOf('LIMIT'));
        }

        pool.query = async () => { throw new Error('isolated test source unavailable'); };
        const failed = responseCapture();
        await handler(request({ pagination: '1', view: 'board', source_type: 'booking', overdue: '1' }), failed);
        assert.equal(failed.statusCode, 500);
        assert.notEqual(failed.body.success, true, 'a source error is not an empty successful drilldown');
    } finally {
        pool.query = originalQuery;
    }
});

test('Dashboard personal overdue drilldown keeps the exact owner scope and canonical overdue policy', async () => {
    const { pool } = require('../db');
    const { taskKpiCanonicalOverdueSql } = require('../services/taskPerformancePolicy');
    const { buildTaskOwnerMatch, buildTaskVisibilityScope } = require('../services/taskPolicy');
    const { taskBusinessScopeFromRequest, pushTaskBusinessScopeCondition } = require('../services/taskBusinessScope');
    const handler = routeHandler(require('../routes/tasks'));
    const originalQuery = pool.query;
    const req = request({ pagination: '1', view: 'board', dashboardFilter: 'my-overdue', include_duplicates: '1', businessContext: 'event_genix' });
    const expectedParams = [];
    const business = pushTaskBusinessScopeCondition(expectedParams, taskBusinessScopeFromRequest(req), 't');
    const visibility = buildTaskVisibilityScope(req.user, expectedParams, 't');
    const owner = buildTaskOwnerMatch(req.user, expectedParams, 't');
    try {
        const sqlCalls = [];
        pool.query = async (sql, params = []) => {
            sqlCalls.push({ sql: String(sql), params: [...params] });
            return { rows: /SELECT COUNT\(\*\)::int/.test(sql) ? [{ total: 0 }] : [] };
        };
        const res = responseCapture();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.pagination.total, 0);
        assert.deepEqual(res.body.tasks, []);
        for (const { sql, params } of sqlCalls) {
            for (const predicate of [business, visibility.trim().replace(/^AND\s+/, ''), owner, taskKpiCanonicalOverdueSql('t')]) assert.ok(sql.includes(predicate));
            assert.match(sql, /COALESCE\(t.focus_rank, 0\) > 0 OR t.scheduled_start_at IS NULL OR t.scheduled_start_at <= NOW\(\)/);
            assert.doesNotMatch(sql, /FROM bookings b/, 'personal overdue is not restricted to booking tasks');
            assert.deepEqual(params.slice(0, expectedParams.length), expectedParams);
        }
    } finally { pool.query = originalQuery; }
});

function taskPage(tasks, { page = 1, limit = 100, total = tasks.length, hasMore = false } = {}) {
    return { success: true, tasks, pagination: { page, limit, total, nextPage: page + 1, hasMore } };
}

for (const scenario of [
    { name: 'booking preparation', query: 'source_type=booking&overdue=1', flag: 'bookingOverdue', filter: { source_type: 'booking', overdue: '1' } },
    { name: 'personal overdue', query: 'dashboardFilter=my-overdue', flag: 'personalOverdue', filter: { dashboardFilter: 'my-overdue' } }
]) test(`Dashboard ${scenario.name} URL loads the exact paginated list, preserves reload state and clears the filter`, async () => {
    const dom = new JSDOM('<section id="taskCenterShell"></section><main id="boardContent"></main>', {
        runScripts: 'outside-only',
        url: `https://crm.test/tasks?${scenario.query}&businessContext=event_genix`
    });
    const context = dom.getInternalVMContext();
    const requests = [];
    let overviewLoads = 0;
    Object.assign(context, {
        API_BASE: '/api',
        _assigneeList: [],
        getAuthHeaders: () => ({}),
        handleAuthError: () => false,
        taskApiFetch: async url => {
            requests.push(new URL(url, dom.window.location.href));
            return { ok: true, json: async () => taskPage([{ id: 502, title: 'Preparation' }], { total: 1 }) };
        },
        loadTaskOverview: async () => { overviewLoads++; },
        loadTaskTeamControl: async () => assert.fail('Dashboard drilldown must not use team projection'),
        updateCounts() {}, updateTaskExplainability() {}, renderMaysternyaTaskOpsBar() {}, renderOperationsSummary() {},
        syncTaskSurfaceVisibility() {}, setBoardView() {}, syncTaskCenterShell() {}, renderCategoryFilters() {}, renderSubcategoryFilters() {},
        taskOverviewModeActive: () => true,
        taskTeamControlModeActive: () => false,
        renderTaskOverview: () => assert.fail('Dashboard drilldown must not render overview projection'),
        getTopLevelTaskCategoryOrder: () => [],
        getCategoryConfig: () => ({ label: '' }),
        escapeHtml: value => String(value),
        filterByCategory: rows => rows,
        sortTasksForDisplay: rows => rows,
        renderTaskCard: task => `<article data-task-id="${task.id}">${task.title}</article>`,
        showNotification: () => assert.fail('Unexpected load error')
    });
    const slice = (start, end) => {
        const from = tasksSource.indexOf(start);
        const to = tasksSource.indexOf(end, from);
        assert.ok(from >= 0 && to > from, start);
        return tasksSource.slice(from, to);
    };
    vm.runInContext(`
        ${slice('const TASK_CENTER_MODE_CONFIG', 'let userPermissions')}
        ${slice('function taskCenterOwnerOptions', 'async function persistTaskSavedViews')}
        ${slice('async function apiGetTasksPage', 'async function apiGetTaskOverview')}
        ${slice('async function loadAllTasks', 'async function apiCreateOperationPack')}
        ${slice('function renderBoard()', 'function renderTaskOverview')}
        this.__drilldown = {
            read: taskCenterQueryStateFromUrl,
            url: taskCenterUrlForState,
            state: () => taskCenterQueryState,
            apply: state => applyTaskCenterQueryState(state, { syncShell: false }),
            load: loadAllTasks,
            controls: renderTaskCenterQueryControls
        };
    `, context);
    const hooks = context.__drilldown;
    hooks.apply(hooks.read());
    assert.equal(hooks.state()[scenario.flag], true);
    await hooks.load();
    assert.equal(requests.length, 1);
    assert.equal(overviewLoads, 0);
    assert.equal(requests[0].pathname, '/api/tasks');
    for (const [key, value] of Object.entries({ view: 'board', ...scenario.filter, include_duplicates: '1', pagination: '1' })) {
        assert.equal(requests[0].searchParams.get(key), value, key);
    }
    assert.ok(dom.window.document.querySelector('article[data-task-id="502"]'));
    const reloadedUrl = hooks.url();
    assert.equal(reloadedUrl.searchParams.get('businessContext'), 'event_genix');
    assert.equal(hooks.read(reloadedUrl.searchParams)[scenario.flag], true);
    hooks.controls();
    assert.equal(dom.window.document.querySelector('[data-task-save-view]').disabled, true, 'unsupported saved-view state is not silently stripped');
    dom.window.document.querySelector('[data-task-clear-dashboard-overdue]').click();
    assert.equal(hooks.state()[scenario.flag], false);
    assert.equal(overviewLoads, 1);
    assert.equal(new URL(dom.window.location.href).searchParams.has('source_type'), false);
    assert.equal(new URL(dom.window.location.href).searchParams.has('overdue'), false);
    assert.equal(new URL(dom.window.location.href).searchParams.has('dashboardFilter'), false);
    assert.equal(new URL(dom.window.location.href).searchParams.get('businessContext'), 'event_genix');
    assert.equal(dom.window.document.querySelector('[data-task-save-view]').disabled, false);
    dom.window.close();
});
