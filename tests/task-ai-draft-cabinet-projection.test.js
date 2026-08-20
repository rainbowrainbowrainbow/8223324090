'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearProjectionModules() {
    [
        '../services/taskCabinetProjection',
        '../services/myDayTaxonomy',
        '../services/taskPolicy',
        '../services/taskBusinessScope',
        '../services/taskCompletionHistory',
        '../services/taskDependencies',
        '../services/myDayTimeTracking',
        '../services/taskActionHistory',
        '../services/taskScheduling'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

test('cabinet projection returns persisted My Day impacts for an AI-created task', async () => {
    clearProjectionModules();
    const classification = {
        direction: null,
        impacts: [
            { id: 101, name: 'Work: CRM', color: '#2563eb', icon: 'crm', isActive: true },
            { id: 104, name: 'Automation / AI', color: '#16a34a', icon: 'ai', isActive: true }
        ]
    };
    const taskRow = {
        id: 501,
        title: 'Fix CRM booking form',
        description: 'Make booking validation clear and safe for managers.',
        status: 'todo',
        priority: 'normal',
        task_mode: 'work',
        task_kind: 'action',
        visibility: 'team',
        workflow_state: 'todo',
        owner_user_id: 7,
        assigned_to: 'Route User',
        created_by_user_id: 7,
        business_context: 'event_genix',
        date: '2026-08-20',
        created_at: '2026-08-20T09:00:00.000Z',
        updated_at: '2026-08-20T09:00:00.000Z'
    };
    const pool = {
        async query(text) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            if (/INSERT INTO task_user_preferences/i.test(sql)) {
                return {
                    rows: [{
                        id: 1,
                        user_id: 7,
                        focus_limit: 3,
                        digest_mode: 'important_only',
                        default_task_mode: 'personal',
                        default_privacy: 'me_only',
                        show_private_in_tasks_page: false,
                        enable_telegram_reminders: true,
                        enable_evening_review: true,
                        task_sound_enabled: true,
                        task_sound_volume: 0.4,
                        task_sound_theme: 'subtle',
                        saved_task_views: [],
                        saved_task_views_revision: 0
                    }]
                };
            }
            if (/SELECT COUNT\(\*\)::int AS open_count/i.test(sql)) return { rows: [{ open_count: 1 }] };
            if (/SELECT bucket, COUNT\(\*\)::int AS total/i.test(sql)) return { rows: [{ bucket: 'today', total: 1 }] };
            if (/remaining_today/i.test(sql)) {
                return {
                    rows: [{
                        parent_done_total: 0,
                        done_total: 0,
                        done_today: 0,
                        parent_done_today: 0,
                        subtask_done_today: 0,
                        subtask_done_total: 0,
                        remaining_today: 1,
                        overdue_carryover: 0,
                        active_my_day: 1
                    }]
                };
            }
            if (/SELECT COUNT\(\*\)::int AS total/i.test(sql)) return { rows: [{ total: 1 }] };
            if (/SELECT t\.\*, u\.name AS owner_name, u\.username AS owner_username FROM tasks t/i.test(sql)) {
                return { rows: [{ ...taskRow, owner_name: 'Route User', owner_username: 'route-user' }] };
            }
            if (/FROM task_subtasks/i.test(sql)) return { rows: [] };
            return { rows: [] };
        }
    };

    installMock('../services/myDayTaxonomy', {
        loadTaskClassifications: async (queryable, userId, taskIds) => {
            assert.equal(queryable, pool);
            assert.equal(userId, 7);
            assert.deepEqual(taskIds, [501]);
            return new Map([[501, classification]]);
        }
    });
    installMock('../services/taskPolicy', {
        buildTaskOwnerMatch: () => 'TRUE',
        canMutateTask: () => true,
        canReassignTask: () => true,
        canRescheduleTask: () => true,
        normalizeUserId: user => Number(user?.id || user?.userId || 0),
        taskOwnerState: task => ({
            ownerUserId: Number(task?.owner_user_id || task?.ownerUserId || 0) || null,
            assignedTo: task?.assigned_to || task?.assignedTo || null,
            ownerName: task?.owner_name || task?.ownerName || null,
            ownerUsername: task?.owner_username || task?.ownerUsername || null
        })
    });
    installMock('../services/taskBusinessScope', {
        appendTaskBusinessScopeSql: () => '',
        taskBusinessScopeMeta: scope => ({ businessContext: scope?.businessContext || 'event_genix' })
    });
    installMock('../services/taskCompletionHistory', {
        normalizeCompletionHistoryLimit: value => Number(value || 36),
        queryTaskCompletionHistoryPage: async () => ({ sourceRows: [], pagination: { hasMore: false, nextCursor: null } })
    });
    installMock('../services/taskDependencies', {
        loadTaskDependencyStates: async () => new Map()
    });
    installMock('../services/myDayTimeTracking', {
        loadTaskTimeTotals: async () => new Map(),
        loadTaskTimeTotalsForDate: async () => new Map()
    });
    installMock('../services/taskActionHistory', {
        listLatestTaskPostponementEvents: async () => new Map()
    });
    installMock('../services/taskScheduling', {
        attachTaskSchedule: task => task,
        canonicalTaskOrderSql: () => 't.id ASC',
        dateOnly: value => String(value || '').slice(0, 10)
    });

    const { buildTaskCabinetProjection } = require('../services/taskCabinetProjection');
    const projection = await buildTaskCabinetProjection({
        pool,
        user: { id: 7, username: 'route-user', role: 'admin' },
        businessScope: { businessContext: 'event_genix' },
        now: new Date('2026-08-20T10:00:00.000Z')
    });

    const task = projection.today.find(item => Number(item.id) === 501);
    assert.ok(task, 'AI-created task must be present in My Day today bucket');
    assert.equal(task.description, 'Make booking validation clear and safe for managers.');
    assert.deepEqual(task.myDay.impacts.map(item => item.id), [101, 104]);
    assert.deepEqual(projection.all[0].myDay.impacts.map(item => item.name), ['Work: CRM', 'Automation / AI']);
    clearProjectionModules();
});
