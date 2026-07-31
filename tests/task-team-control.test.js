const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { pool } = require('../db');
const {
    buildTaskTeamControlProjection
} = require('../services/taskTeamControlProjection');
const {
    MAX_PLANNING_DAYS,
    normalizeTaskPlanningRange
} = require('../services/taskTeamCapacityReadModel');

const ROOT = path.resolve(__dirname, '..');

function task(id, patch = {}) {
    return {
        id,
        title: `Task ${id}`,
        status: 'todo',
        owner_user_id: 7,
        ownerUserId: 7,
        owner_name: 'Owner One',
        ownerLabel: 'Owner One',
        ...patch
    };
}

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

test('team control calculates workload from effort, exposes overload, and never substitutes unavailable capacity with zero', () => {
    const projection = buildTaskTeamControlProjection([
        task(1, {
            scheduled_start_at: '2026-08-01T09:00:00.000Z',
            effort_minutes: 120,
            date: '2026-08-01'
        }),
        task(2, { date: null, deadline: null, effort_minutes: null }),
        task(3, {
            owner_user_id: 8,
            ownerUserId: 8,
            owner_name: 'Owner Two',
            priority: 'urgent',
            date: '2026-08-02',
            open_dependency_count: 1,
            effort_minutes: 45
        })
    ], {
        today: '2026-07-31',
        from: '2026-07-31',
        to: '2026-08-02',
        capacityAvailable: true,
        capacityRows: [{ ownerUserId: 7, date: '2026-08-01', status: 'available', capacityMinutes: 90 }]
    });

    const firstOwner = projection.owners.find(owner => owner.ownerUserId === 7);
    const secondOwner = projection.owners.find(owner => owner.ownerUserId === 8);
    const firstDay = firstOwner.days.find(day => day.date === '2026-08-01');
    const secondDay = secondOwner.days.find(day => day.date === '2026-08-02');

    assert.equal(firstOwner.metrics.active, 2);
    assert.equal(firstOwner.metrics.knownEffortMinutes, 120);
    assert.equal(firstOwner.metrics.unknownEffortTasks, 1);
    assert.equal(firstOwner.metrics.scheduledEffortMinutes, 120);
    assert.equal(firstOwner.metrics.unscheduledTasks, 1);
    assert.equal(firstDay.capacity.minutes, 90);
    assert.equal(firstDay.overloadMinutes, 30);
    assert.equal(secondOwner.metrics.urgent, 1);
    assert.equal(secondOwner.metrics.blocked, 1);
    assert.equal(secondDay.capacity.status, 'unavailable');
    assert.equal(secondDay.capacity.minutes, null);
    assert.equal(secondDay.overloadMinutes, null);
    assert.equal(projection.unscheduled.map(item => item.task.id).includes(2), true);
});

test('planning range is Kyiv-safe, ordered, and capped without changing database data', () => {
    const reversed = normalizeTaskPlanningRange({ from: '2026-01-31', to: '2026-01-01' }, new Date('2026-01-31T21:30:00.000Z'));
    const capped = normalizeTaskPlanningRange({ from: '2026-01-31', to: '2026-04-01' }, new Date('2026-01-31T21:30:00.000Z'));

    assert.deepEqual(reversed, { from: '2026-01-31', to: '2026-01-31' });
    assert.equal(capped.from, '2026-01-31');
    assert.equal(capped.to, '2026-03-02');
    assert.equal(MAX_PLANNING_DAYS, 31);
});

test('team control endpoint stays visibility-scoped, pagination-independent, and returns only aggregate capacity', async () => {
    const router = require('../routes/tasks');
    const handler = routeHandler(router, '/team-control');
    const originalQuery = pool.query;
    const queries = [];
    pool.query = async (sql, params = []) => {
        queries.push({ sql: String(sql), params });
        if (/WITH owner_staff AS/i.test(sql)) {
            return { rows: [{ owner_user_id: 7, date: '2026-08-01', status: 'available', capacity_minutes: 480 }] };
        }
        return { rows: [task(71, { owner_name: 'QA owner', scheduled_start_at: '2026-08-01T09:00:00.000Z', effort_minutes: 60 })] };
    };
    try {
        const response = responseCapture();
        await handler({
            user: { id: 7, userId: 7, role: 'admin', username: 'qa-user', name: 'QA User', business_contexts: ['event_genix'] },
            query: { from: '2026-08-01', to: '2026-08-02' },
            headers: {}
        }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.success, true);
        assert.equal(response.body.meta.paginationIndependent, true);
        assert.equal(response.body.owners[0].tasks[0].task.id, 71);
        assert.ok(response.body.owners[0].tasks[0].task.drawer, 'task actions come from the canonical drawer contract');
        assert.doesNotMatch(queries[0].sql, /\bLIMIT\s+\$|\bOFFSET\s+\$/i, 'task projection itself is not paginated');
        assert.match(queries[0].sql, /owner_user_id|visibility/i);
        assert.equal(queries.some(call => /WITH owner_staff AS/i.test(call.sql)), true);
        const capacitySql = queries.find(call => /WITH owner_staff AS/i.test(call.sql)).sql;
        assert.doesNotMatch(capacitySql, /staff_name|notes|planned_start::text|planned_end::text/i);
    } finally {
        pool.query = originalQuery;
    }
});

test('team and planning UI reuse the task schedule mutation with a rollback path, without calling the HR schedule API from the browser', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    assert.match(source, /async function apiGetTaskTeamControl/);
    assert.match(source, /function renderTaskTeamControl/);
    assert.match(source, /async function scheduleTaskFromTeamControl/);
    assert.match(source, /apiScheduleTask\(taskId,/);
    assert.match(source, /taskTeamControlProjection = previous/);
    assert.match(source, /\['team', 'planning'\]/);
    assert.doesNotMatch(source, /\/api\/staff\/schedule/);
});
