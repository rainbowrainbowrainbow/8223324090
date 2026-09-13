const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let state;
let loadedDashboard;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../config/roles',
        '../utils/logger',
        '../services/booking',
        '../services/taskPolicy',
        '../services/taskSubtasks',
        '../services/taskIntelligence',
        '../services/websocket',
        '../services/bookingVisibility',
        '../services/workQueue',
        '../services/omni-accounts',
        '../services/taskActionHistory',
        '../services/businessContext',
        '../routes/dashboard'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function resetState() {
    state = {
        queries: [],
        eventRows: [],
        taskRows: [],
        failQuery: null,
        nowTime: '14:30',
        today: '2026-09-13'
    };
    loadedDashboard = null;
}

function installDashboardMocks() {
    installMock('../db', {
        pool: {
            query: async (sql, params = []) => {
                state.queries.push({ sql, params: [...params] });
                if (state.failQuery === state.queries.length || state.failQuery === 'all') {
                    throw new Error('planned dashboard source failure');
                }
                if (state.queries.length === 1) return { rows: state.eventRows };
                if (state.queries.length === 2) return { rows: state.taskRows };
                return { rows: [] };
            }
        }
    });
    installMock('../middleware/auth', {
        authenticateToken: (req, res, next) => next(),
        ROLE_LEVEL: { animator: 1, admin: 10, manager: 20, creator: 99 }
    });
    installMock('../config/roles', {
        getDefaultWidgets: () => ['nearest_event'],
        canAccessDashboardWidget: () => true
    });
    installMock('../utils/logger', {
        createLogger: () => ({ info() {}, warn() {}, error() {} })
    });
    installMock('../services/booking', {
        getKyivDateStr: () => state.today,
        getKyivTimeStr: () => state.nowTime
    });
    installMock('../services/taskPolicy', {
        buildTaskVisibilityScope: (user, params, alias = 't') => {
            params.push(user.id);
            return `AND ${alias}.visible_to_user_id = $${params.length}`;
        },
        normalizeUserId: user => user?.id || null,
        taskOwnerState: () => ({ state: 'assigned' }),
        userNameTokens: user => [user?.name, user?.username].filter(Boolean)
    });
    installMock('../services/taskSubtasks', {
        normalizeSubtaskSummary: row => {
            const subtasks = Array.isArray(row.subtasks) ? row.subtasks : [];
            const done = subtasks.filter(item => item.is_done || item.isDone).length;
            return {
                subtasks,
                subtaskCount: Number(row.subtask_count ?? subtasks.length),
                subtaskDoneCount: Number(row.subtask_done_count ?? done),
                subtaskProgress: null,
                subtaskProgressPercent: null
            };
        }
    });
    installMock('../services/taskIntelligence', {
        buildTaskOperationsSummary: () => ({}),
        deriveTaskIntelligence: () => ({})
    });
    installMock('../services/websocket', {
        getOnlineUserIds: () => [],
        broadcast: () => {}
    });
    installMock('../services/bookingVisibility', {
        getVisibleBookingScope: (user, params, alias = 'b') => {
            params.push(user.id);
            return {
                sql: `AND ${alias}.visible_to_user_id = $${params.length}`,
                scopeSource: 'mock-booking-visibility'
            };
        }
    });
    installMock('../services/workQueue', {
        buildWorkQueue: async () => ({ items: [] })
    });
    installMock('../services/omni-accounts', {
        getOmniAccountAlertsAsync: async () => []
    });
    installMock('../services/taskActionHistory', {
        TASK_ACTION_TYPES: {
            COMPLETED: 'completed',
            STATUS_CHANGED: 'status_changed',
            RESCHEDULED: 'rescheduled',
            SCHEDULED: 'scheduled',
            SCHEDULE_MOVED: 'schedule_moved',
            SCHEDULE_MANUAL_OVERRIDE: 'schedule_manual_override',
            SCHEDULE_PROPOSAL_CREATED: 'schedule_proposal_created',
            SNOOZED: 'snoozed',
            URGENT_COMMITMENT_SET: 'urgent_commitment_set',
            PRIORITY_CHANGED: 'priority_changed',
            SUBTASK_COMPLETED: 'subtask_completed'
        }
    });
    installMock('../services/businessContext', {
        resolveBusinessScope: () => ({ activeContext: 'event_genix', selectedContexts: ['event_genix'] }),
        requireBusinessScope: () => true,
        pushBusinessScopeCondition: (params, scope, alias = 't') => {
            params.push(scope?.activeContext || 'event_genix');
            return `COALESCE(${alias}.business_context, 'event_genix') = $${params.length}`;
        }
    });
}

function loadDashboard() {
    clearModules();
    installDashboardMocks();
    loadedDashboard = require('../routes/dashboard');
    loadedDashboard.__boardTest.resetAlertBroadcasterForTest();
    return loadedDashboard;
}

describe('dashboard nearest event widget', () => {
    beforeEach(resetState);

    afterEach(() => {
        loadedDashboard?.__boardTest?.resetAlertBroadcasterForTest?.();
        clearModules();
    });

    it('selects the nearest visible future booking by Kyiv time and keeps confirmation separate from preparation', async () => {
        const dashboard = loadDashboard();
        state.eventRows = [{
            id: 42,
            date: '2026-09-13',
            start_time: '15:00:00',
            client_name: 'День народження Софії',
            program: 'Laser party',
            room: 'Зала 2',
            status: 'preliminary',
            responsible_name: 'Марина'
        }];
        state.taskRows = [
            { id: 7, title: 'Перевірити реквізит', status: 'todo', priority: 'high', owner_name: 'Ігор', subtasks: [] },
            { id: 8, title: 'Підготувати сценарій', status: 'done', priority: 'medium', owner_name: 'Марина', subtasks: [] }
        ];

        const payload = await dashboard.__boardTest.loadNearestEventWidgetData(
            { id: 5, role: 'admin', name: 'Admin' },
            { activeContext: 'event_genix' },
            { now: new Date('2026-09-13T11:30:01Z') }
        );

        assert.equal(payload.event.id, 42);
        assert.equal(payload.event.time, '15:00');
        assert.equal(payload.event.canonicalHref, '/booking-summary.html?id=42&businessContext=event_genix&return=%2Fdashboard');
        assert.equal(payload.event.responsibleLabel, 'Марина');
        assert.deepEqual(payload.confirmation, {
            status: 'preliminary',
            label: 'Попередньо',
            confirmed: false,
            confirmedAt: null,
            source: 'bookings.status'
        });
        assert.equal(payload.preparation.totalCount, 2);
        assert.equal(payload.preparation.openCount, 1);
        assert.equal(payload.preparation.doneCount, 1);
        assert.equal(payload.preparation.source, 'tasks.source_type=booking AND tasks.source_id=bookings.id');
        assert.equal(Object.hasOwn(payload, 'readinessScore'), false);

        const eventQuery = state.queries[0];
        assert.match(eventQuery.sql, /LEFT\(BTRIM\(b\.time::text\), 5\)::time >= \$2::time/);
        assert.match(eventQuery.sql, /ORDER BY LEFT\(BTRIM\(b\.time::text\), 5\)::time ASC, b\.id ASC\s+LIMIT 1/);
        assert.match(eventQuery.sql, /LOWER\(COALESCE\(NULLIF\(BTRIM\(b\.status\), ''\), 'confirmed'\)\) != 'cancelled'/);
        assert.match(eventQuery.sql, /b\.visible_to_user_id = \$3/);
        assert.deepEqual(eventQuery.params, ['2026-09-13', '14:30:01', 5, 'event_genix']);

        const taskQuery = state.queries[1];
        assert.match(taskQuery.sql, /t\.source_type = 'booking'/);
        assert.match(taskQuery.sql, /t\.source_id = \$1/);
        assert.match(taskQuery.sql, /COALESCE\(t\.status, 'todo'\) NOT IN \('cancelled','archived'\)/);
        assert.match(taskQuery.sql, /COUNT\(\*\) OVER \(\)::int AS preparation_total/);
        assert.deepEqual(taskQuery.params, ['42', 5, 'event_genix']);
    });

    it('returns an honest empty state without querying tasks when there is no future visible event today', async () => {
        const dashboard = loadDashboard();
        state.eventRows = [];

        const payload = await dashboard.__boardTest.loadNearestEventWidgetData(
            { id: 9, role: 'animator', name: 'Animator' },
            { activeContext: 'event_genix' }
        );

        assert.equal(payload.event, null);
        assert.equal(payload.preparation, null);
        assert.equal(payload.meta.state, 'empty');
        assert.equal(payload.meta.scopeSource, 'mock-booking-visibility');
        assert.equal(state.queries.length, 1);
    });

    it('keeps missing responsible and missing preparation tasks explicit instead of marking the event ready', async () => {
        const dashboard = loadDashboard();
        state.eventRows = [{
            id: 77,
            date: '2026-09-13',
            start_time: '14:30',
            program: null,
            room: null,
            status: 'confirmed'
        }];
        state.taskRows = [];

        const payload = await dashboard.__boardTest.loadNearestEventWidgetData(
            { id: 11, role: 'admin', name: 'Admin' },
            { activeContext: 'event_genix' }
        );

        assert.equal(payload.event.time, '14:30');
        assert.equal(payload.event.program, null);
        assert.equal(payload.event.room, null);
        assert.equal(payload.event.responsibleLabel, null);
        assert.equal(payload.confirmation.confirmed, true);
        assert.equal(payload.preparation.totalCount, 0);
        assert.equal(payload.preparation.noTasksMeans, 'unknown');
        assert.equal(Object.hasOwn(payload.preparation, 'ready'), false);
    });

    it('propagates source errors so the widget can show retry/error state', async () => {
        const dashboard = loadDashboard();
        state.failQuery = 1;

        await assert.rejects(
            () => dashboard.__boardTest.loadNearestEventWidgetData(
                { id: 5, role: 'admin', name: 'Admin' },
                { activeContext: 'event_genix' }
            ),
            /planned dashboard source failure/
        );
    });

    it('counts all visible preparation tasks while bounding only the task preview', async () => {
        const dashboard = loadDashboard();
        state.eventRows = [{ id: 'QA-7', date: state.today, time: '18:00', status: 'confirmed' }];
        state.taskRows = Array.from({ length: 6 }, (_, i) => ({
            id: i + 1, title: `Preparation ${i + 1}`, status: 'todo',
            preparation_total: 18, preparation_open: 12, preparation_done: 6, preparation_overdue: 8
        }));
        const data = await dashboard.__boardTest.loadNearestEventWidgetData({ id: 9 }, { activeContext: 'other_business' });
        assert.equal(data.preparation.tasks.length, 6);
        assert.equal(data.preparation.totalCount, 18);
        assert.equal(data.preparation.openCount, 12);
        assert.equal(data.preparation.doneCount, 6);
        assert.equal(data.preparation.overdueCount, 8);
        assert.match(data.event.canonicalHref, /id=QA-7&businessContext=other_business/);
        assert.match(state.queries[1].sql, /LIMIT 6/);
    });

    it('guards event-risk preliminary time parsing against invalid live booking times', async () => {
        const dashboard = loadDashboard();
        state.eventRows = [{ count: '2' }];
        state.taskRows = [{ count: '1' }];

        const payload = await dashboard.__boardTest.buildEventRiskSummary(
            { id: 5, role: 'admin', name: 'Admin' },
            { activeContext: 'event_genix' }
        );

        assert.equal(payload.eventRiskSummary.todayUnconfirmed, 2);
        assert.equal(payload.eventRiskSummary.tomorrowUnconfirmed, 1);
        assert.equal(state.queries.length, 5);
        const latePreliminaryQuery = state.queries[2].sql;
        assert.match(latePreliminaryQuery, /CASE\s+WHEN LEFT\(BTRIM\(COALESCE\(b\.time::text, ''\)\), 5\) ~/);
        assert.match(latePreliminaryQuery, /ELSE NULL/);
        assert.doesNotMatch(latePreliminaryQuery, /SUBSTRING\(b\.time FROM 1 FOR 2\)::int/);

        const dashboardRouteSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'dashboard.js'), 'utf8');
        assert.doesNotMatch(dashboardRouteSource, /SUBSTRING\(b\.time FROM 1 FOR 2\)::int/);
        assert.doesNotMatch(dashboardRouteSource, /SUBSTRING\(b\.time FROM 4 FOR 2\)::int/);
    });

    it('uses a single Kyiv clock at midnight, minute boundaries and both DST transitions', () => {
        const { dashboardKyivClock } = loadDashboard().__boardTest;
        const cases = [
            ['2026-09-13T20:59:59Z', '2026-09-13', '23:59:59'],
            ['2026-09-13T21:00:00Z', '2026-09-14', '00:00:00'],
            ['2026-09-13T11:30:01Z', '2026-09-13', '14:30:01'],
            ['2026-03-29T00:59:59Z', '2026-03-29', '02:59:59'],
            ['2026-03-29T01:00:00Z', '2026-03-29', '04:00:00'],
            ['2026-10-25T00:59:59Z', '2026-10-25', '03:59:59'],
            ['2026-10-25T01:00:00Z', '2026-10-25', '03:00:00']
        ];
        for (const [now, today, nowTime] of cases) assert.deepEqual(dashboardKyivClock(new Date(now)), { today, nowTime });
    });
});
