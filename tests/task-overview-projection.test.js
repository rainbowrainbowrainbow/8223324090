const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const { pool } = require('../db');
const {
    buildTaskOverview,
    classifyTaskExceptions
} = require('../services/taskOverviewProjection');

const ROOT = path.resolve(__dirname, '..');

function task(id, patch = {}) {
    return {
        id,
        title: `Task ${id}`,
        status: 'todo',
        owner_user_id: 7,
        ownerUserId: 7,
        date: '2026-08-02',
        updated_at: '2026-08-01T08:00:00.000Z',
        ...patch
    };
}

test('task overview classifies real exception signals and excludes deferred tasks', () => {
    const now = new Date('2026-07-31T21:30:00.000Z'); // 2026-08-01 in Kyiv
    const overview = buildTaskOverview([
        task(1, { date: '2026-07-29' }),
        task(2, { priority: 'urgent', date: '2026-08-01' }),
        task(3, { owner_user_id: null, ownerUserId: null, ownerLabel: null }),
        task(4, { open_dependency_count: 1 }),
        task(5, { workflow_state: 'waiting', updated_at: '2026-07-27T08:00:00.000Z' }),
        task(6, { date: null, deadline: null }),
        task(7, { updated_at: '2026-07-20T08:00:00.000Z' }),
        task(8, { postponement_count: 2 }),
        task(9, { control_meta: { reportRequired: true } }),
        task(10, { control_meta: { reviewRequired: true } }),
        task(11, { snoozed_until: '2026-08-04T09:00:00.000Z', date: null }),
        task(12, { status: 'done', date: '2026-07-01' })
    ], { now, today: '2026-08-01' });

    assert.deepEqual(overview.counts, {
        overdue: 1,
        urgent: 1,
        due_today: 1,
        unassigned: 1,
        blocked: 1,
        waiting_too_long: 1,
        no_date: 1,
        stale: 1,
        repeatedly_rescheduled: 1,
        report_required: 1,
        review_required: 1
    });
    assert.equal(overview.meta.activeTotal, 11);
    assert.equal(overview.meta.deferredExcluded, 1);
    assert.equal(overview.meta.exceptionTotal, 10);
    assert.deepEqual(overview.queue.slice(0, 4).map(item => item.task.id), [1, 2, 4, 3]);
    assert.equal(overview.queue.find(item => item.task.id === 1).reasons[0].riskDays, 3);
    assert.equal(overview.queue.find(item => item.task.id === 11), undefined);
});

test('task overview calculates Kyiv month-end and stable reason order without an AI score', () => {
    const now = new Date('2026-01-31T22:30:00.000Z'); // 2026-02-01 00:30 Kyiv
    const reasons = classifyTaskExceptions(task(1, {
        date: '2026-01-31',
        priority: 'urgent',
        open_dependency_count: 2
    }), { now });

    assert.deepEqual(reasons.map(item => item.code), ['overdue', 'urgent', 'blocked']);
    assert.equal(reasons[0].riskDays, 1);
    assert.equal(reasons[0].recommendedAction, 'Перепланувати або виконати');
});

function routeHandler(router, routePath) {
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

test('overview endpoint is scoped and pagination-independent', async () => {
    const router = require('../routes/tasks');
    const handler = routeHandler(router, '/overview');
    const originalQuery = pool.query;
    const queries = [];
    pool.query = async (sql, params = []) => {
        queries.push({ sql: String(sql), params });
        return { rows: [task(71, { owner_name: 'QA owner', date: '2026-07-29' })] };
    };
    try {
        const response = responseCapture();
        await handler({
            user: {
                id: 7,
                userId: 7,
                role: 'creator',
                username: 'qa-user',
                name: 'QA User',
                business_contexts: ['event_genix']
            },
            query: {},
            headers: {}
        }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.success, true);
        assert.equal(response.body.meta.paginationIndependent, true);
        assert.equal(response.body.queue[0].task.id, 71);
        assert.ok(response.body.queue[0].task.drawer, 'queue task gets canonical drawer permissions');
        assert.equal(queries.length, 1);
        assert.match(queries[0].sql, /buildTaskVisibilityScope|owner_user_id|visibility/i);
        assert.doesNotMatch(queries[0].sql, /\bLIMIT\b|\bOFFSET\b/i);
    } finally {
        pool.query = originalQuery;
    }
});

test('overview renderer shows count, reason, duration and recommended action', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    const start = source.indexOf('function renderTaskOverview');
    const end = source.indexOf('function renderSimpleTaskView', start);
    assert.ok(start >= 0 && end > start, 'overview renderer exists as an isolated function');
    const dom = new JSDOM('<main id="boardContent"></main>', { runScripts: 'outside-only' });
    const context = dom.getInternalVMContext();
    vm.runInContext(`
        let taskOverviewLoading = false;
        let taskOverviewError = null;
        let taskOverviewProjection = {
            counts: { overdue: 1, urgent: 0, blocked: 1, unassigned: 0, stale: 0, due_today: 0 },
            queue: [{
                task: { id: 41, title: 'Blocked task' },
                reasons: [{ code: 'blocked', label: 'Заблоковано залежністю', riskDays: 4 }],
                recommendedAction: 'Розблокувати залежність'
            }],
            meta: { activeTotal: 125, returned: 1, exceptionTotal: 1, hasMore: false }
        };
        function escapeHtml(value) { return String(value); }
        function renderTaskCard(task) { return '<div class="task-card" data-task-id="' + task.id + '">' + task.title + '</div>'; }
        ${source.slice(start, end)}
        this.renderTaskOverview = renderTaskOverview;
    `, context, { filename: 'js/tasks-page.js' });
    context.renderTaskOverview(dom.window.document.getElementById('boardContent'));
    const text = dom.window.document.getElementById('boardContent').textContent;
    assert.match(text, /1 Прострочено/);
    assert.match(text, /Заблоковано залежністю · 4 дн\./);
    assert.match(text, /Рекомендована дія: Розблокувати залежність/);
    assert.match(text, /125 активних задач/);
    dom.window.close();
});
test('tasks page uses the server overview contract and renders explainable exceptions', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    assert.match(source, /async function apiGetTaskOverview/);
    assert.match(source, /\/tasks\/overview/);
    assert.match(source, /function renderTaskOverview/);
    assert.match(source, /paginationIndependent/);
    assert.match(source, /Рекомендована дія/);
    assert.match(source, /taskOverviewModeActive\(\)/);
});
