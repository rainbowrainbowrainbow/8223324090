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
        broadcasts: [],
        dbQueries: 0,
        failBroadcast: false,
        logs: []
    };
    loadedDashboard = null;
}

function installDashboardMocks() {
    installMock('../db', {
        pool: {
            query: async () => {
                state.dbQueries += 1;
                throw new Error('Unexpected DB access in dashboard alert broadcaster test');
            }
        }
    });
    installMock('../middleware/auth', {
        authenticateToken: (req, res, next) => next(),
        ROLE_LEVEL: { animator: 1, manager: 5, admin: 10, creator: 99 }
    });
    installMock('../config/roles', {
        getDefaultWidgets: () => [],
        canAccessDashboardWidget: () => true
    });
    installMock('../utils/logger', {
        createLogger: name => ({
            info: (...args) => state.logs.push({ level: 'info', name, args }),
            warn: (...args) => state.logs.push({ level: 'warn', name, args }),
            error: (...args) => state.logs.push({ level: 'error', name, args })
        })
    });
    installMock('../services/booking', {
        getKyivDateStr: () => '2026-06-28'
    });
    installMock('../services/taskPolicy', {
        buildTaskVisibilityScope: () => '',
        normalizeUserId: user => user?.id || null,
        taskOwnerState: () => ({}),
        userNameTokens: () => []
    });
    installMock('../services/taskSubtasks', {
        normalizeSubtaskSummary: () => ({ subtasks: [], subtaskCount: 0, subtaskDoneCount: 0 })
    });
    installMock('../services/taskIntelligence', {
        buildTaskOperationsSummary: () => ({}),
        deriveTaskIntelligence: () => ({})
    });
    installMock('../services/websocket', {
        getOnlineUserIds: () => [],
        broadcast: (eventType, payload) => {
            if (state.failBroadcast) throw new Error('planned broadcast failure');
            state.broadcasts.push({ eventType, payload });
        }
    });
    installMock('../services/bookingVisibility', {
        getVisibleBookingScope: () => ({ sql: '', params: [] })
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
        pushBusinessScopeCondition: (params, scope, alias = 't') => `COALESCE(${alias}.business_context, 'event_genix') = 'event_genix'`
    });
}

function loadDashboard() {
    clearModules();
    installDashboardMocks();
    loadedDashboard = require('../routes/dashboard');
    loadedDashboard.__boardTest.resetAlertBroadcasterForTest();
    return loadedDashboard;
}

describe('dashboard alert broadcaster raw starter hardening', () => {
    beforeEach(resetState);

    afterEach(() => {
        loadedDashboard?.__boardTest?.resetAlertBroadcasterForTest?.();
        clearModules();
    });

    it('starts one broadcaster interval and skips duplicate starter calls in one process', () => {
        const dashboard = loadDashboard();

        const first = dashboard.startAlertBroadcaster(999999);
        const second = dashboard.startAlertBroadcaster(123456);

        assert.deepEqual(first, { started: true, intervalMs: 999999 });
        assert.deepEqual(second, {
            started: false,
            skipped: true,
            reason: 'already_started',
            intervalMs: 999999
        });
        assert.deepEqual(dashboard.__boardTest.alertBroadcasterState(), {
            started: true,
            hasInitialTimer: true,
            intervalMs: 999999,
            lastAlertHash: ''
        });
    });

    it('broadcasts the sanitized alert update payload once when alert state changes', async () => {
        const dashboard = loadDashboard();

        await dashboard.__boardTest.broadcastAlerts();
        await dashboard.__boardTest.broadcastAlerts();

        assert.equal(state.dbQueries, 0);
        assert.equal(state.broadcasts.length, 1);
        assert.equal(state.broadcasts[0].eventType, 'alert:updated');
        assert.deepEqual(state.broadcasts[0].payload, { alerts: [], count: 0 });
        assert.equal(dashboard.__boardTest.alertBroadcasterState().lastAlertHash, '[]');
    });

    it('logs broadcaster tick errors without throwing or marking the failed hash as delivered', async () => {
        const dashboard = loadDashboard();
        state.failBroadcast = true;

        await dashboard.__boardTest.broadcastAlerts();

        assert.equal(state.broadcasts.length, 0);
        assert.equal(dashboard.__boardTest.alertBroadcasterState().lastAlertHash, '');
        assert.ok(state.logs.some(entry => entry.level === 'warn' && entry.args[0] === 'Alert broadcast error:'));

        state.failBroadcast = false;
        await dashboard.__boardTest.broadcastAlerts();
        assert.equal(state.broadcasts.length, 1);
        assert.equal(dashboard.__boardTest.alertBroadcasterState().lastAlertHash, '[]');
    });

    it('stops and resets broadcaster timers for deterministic tests', () => {
        const dashboard = loadDashboard();

        dashboard.startAlertBroadcaster(999999);
        assert.equal(dashboard.__boardTest.alertBroadcasterState().started, true);

        dashboard.__boardTest.resetAlertBroadcasterForTest();

        assert.deepEqual(dashboard.__boardTest.alertBroadcasterState(), {
            started: false,
            hasInitialTimer: false,
            intervalMs: null,
            lastAlertHash: ''
        });
    });

    it('keeps server starter timing unchanged', () => {
        const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

        assert.match(server, /const \{ startAlertBroadcaster \} = require\('\.\/routes\/dashboard'\);/);
        assert.match(server, /startAlertBroadcaster\(60000\);/);
        assert.match(server, /Alert broadcaster started \(60s interval\)/);
    });
});
