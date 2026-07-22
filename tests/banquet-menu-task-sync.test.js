'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
    MENU_ACTUAL_TASK_SOURCE_MODULE,
    MENU_ACTUAL_TASK_SOURCE_TYPE,
    MENU_ACTUAL_TASK_TITLE,
    bookingActualMenuTaskDeadline,
    syncBanquetActualMenuTask
} = require('../services/banquetMenuTaskSync');

function isActive(task) {
    return !['done', 'archived', 'cancelled'].includes(String(task.status || 'todo').toLowerCase());
}

class FakeTaskDb {
    constructor() {
        this.tasks = [];
        this.users = [{ id: 7, username: 'olena', name: 'Олена', is_active: true }];
        this.queries = [];
        this.nextTaskId = 100;
    }

    async query(sql, params = []) {
        this.queries.push({ sql, params });
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();

        if (normalizedSql.startsWith('SELECT * FROM tasks')) {
            const [businessContext, sourceType, sourceId, sourceModule] = params;
            return {
                rows: this.tasks
                    .filter(task => (task.business_context || 'event_genix') === businessContext)
                    .filter(task => task.source_type === sourceType)
                    .filter(task => String(task.source_id) === String(sourceId))
                    .filter(task => task.source_module === sourceModule)
                    .sort((a, b) => (isActive(a) === isActive(b) ? a.id - b.id : (isActive(a) ? -1 : 1)))
            };
        }

        if (normalizedSql.startsWith('SELECT t.* FROM tasks t')) {
            const [title, day, category, subcategory, ownerUserId, checklistTemplateKey, sourceAnchor, businessContext] = params;
            const duplicate = this.tasks.find(task => isActive(task)
                && String(task.title || '').trim().toLowerCase() === title
                && String(task.date || '') === day
                && String(task.category || 'admin').trim().toLowerCase() === category
                && String(task.subcategory || '').trim().toLowerCase() === subcategory
                && String(task.owner_user_id || '') === ownerUserId
                && String(task.checklist_template_key || '').trim().toLowerCase() === checklistTemplateKey
                && `${String(task.source_type || 'manual').toLowerCase()}:${String(task.source_id || '')}` === sourceAnchor
                && (task.business_context || 'event_genix') === businessContext);
            return { rows: duplicate ? [duplicate] : [] };
        }

        if (normalizedSql.startsWith('SELECT id, username, name FROM users WHERE id = $1')) {
            const user = this.users.find(item => item.id === Number(params[0]) && item.is_active !== false);
            return { rows: user ? [user] : [] };
        }

        if (normalizedSql.startsWith('SELECT id, username, name FROM users')) {
            const lookup = String(params[0] || '').toLowerCase();
            const user = this.users.find(item => item.is_active !== false
                && (String(item.username || '').toLowerCase() === lookup || String(item.name || '').toLowerCase() === lookup));
            return { rows: user ? [user] : [] };
        }

        if (normalizedSql.startsWith('INSERT INTO tasks')) {
            const task = {
                id: this.nextTaskId++,
                business_context: params[0],
                title: params[1],
                description: params[2],
                date: params[3],
                priority: params[4],
                assigned_to: params[5],
                owner: params[6],
                owner_user_id: params[7],
                created_by: params[8],
                task_type: params[9],
                deadline: params[10],
                source_type: params[15],
                source_id: params[16],
                category: params[17],
                task_mode: params[30],
                task_kind: params[31],
                visibility: params[32],
                workflow_state: params[33],
                related_entity_type: params[40],
                related_entity_id: params[41],
                source_module: params[42],
                control_meta: JSON.parse(params[44] || '{}'),
                created_by_user_id: params[45],
                status: 'todo'
            };
            this.tasks.push(task);
            return { rows: [task] };
        }

        if (normalizedSql.startsWith('INSERT INTO task_logs')) {
            return { rows: [{ id: 1 }] };
        }

        if (normalizedSql.startsWith('UPDATE tasks SET title = $2')) {
            const [id, title, description, date, deadline, assignedTo, owner, relatedEntityId, sourceModule, controlMetaJson] = params;
            const task = this.tasks.find(item => item.id === Number(id));
            assert.ok(task, `task ${id} exists for update`);
            Object.assign(task, {
                title,
                description,
                date,
                deadline,
                priority: 'high',
                category: 'booking',
                task_mode: 'work',
                task_kind: 'action',
                visibility: 'team',
                workflow_state: task.workflow_state === 'inbox' ? 'todo' : (task.workflow_state || 'todo'),
                schedule_status: deadline ? 'scheduled' : (task.schedule_status || 'unscheduled'),
                assigned_to: assignedTo || task.assigned_to,
                owner: owner || task.owner,
                related_entity_type: 'booking',
                related_entity_id: relatedEntityId,
                source_module: sourceModule,
                control_meta: { ...(task.control_meta || {}), ...JSON.parse(controlMetaJson || '{}') }
            });
            return { rows: [task] };
        }

        if (normalizedSql.startsWith('UPDATE tasks SET status = $2')) {
            const [ids, status, workflowState, scheduleStatus, archiveReason, controlMetaJson] = params;
            const updated = [];
            for (const id of ids) {
                const task = this.tasks.find(item => item.id === Number(id));
                if (!task) continue;
                Object.assign(task, {
                    status,
                    workflow_state: workflowState,
                    schedule_status: scheduleStatus,
                    completed_at: status === 'done' ? (task.completed_at || 'now') : task.completed_at,
                    archived_at: status !== 'done' ? (task.archived_at || 'now') : task.archived_at,
                    archive_reason: status !== 'done' ? archiveReason : task.archive_reason,
                    control_meta: { ...(task.control_meta || {}), ...JSON.parse(controlMetaJson || '{}') }
                });
                updated.push(task);
            }
            return { rows: updated };
        }

        throw new Error(`Unexpected SQL in fake task DB: ${normalizedSql}`);
    }
}

function actualBooking(overrides = {}) {
    return {
        id: overrides.id || 501,
        business_context: 'event_genix',
        date: overrides.date || '2026-08-15',
        time: overrides.time || '18:30',
        duration: overrides.duration ?? 180,
        room: 'Зал 1',
        created_by: overrides.created_by || 'olena',
        status: overrides.status || 'confirmed',
        extra_data: {
            bookingPackage: {
                positionsSubtotal: overrides.positionsSubtotal ?? 1900,
                menuChargedSubtotal: overrides.menuChargedSubtotal ?? 2500,
                menuWorkflow: {
                    mode: 'actual',
                    status: overrides.workflowStatus || 'awaiting_actual',
                    minimumSnapshot: { minimumAmount: 2500 },
                    finalizedBy: overrides.finalizedBy,
                    finalizedAt: overrides.finalizedAt
                }
            }
        }
    };
}

test('actual awaiting menu sync creates exactly one linked active task and skips immediate notifications', async () => {
    const db = new FakeTaskDb();
    const booking = actualBooking();

    const result = await syncBanquetActualMenuTask(db, booking, { businessContext: 'event_genix', actor: { username: 'olena', id: 7 } });

    assert.equal(result.action, 'created');
    assert.equal(db.tasks.length, 1);
    const [task] = db.tasks;
    assert.equal(task.title, MENU_ACTUAL_TASK_TITLE);
    assert.equal(task.source_type, MENU_ACTUAL_TASK_SOURCE_TYPE);
    assert.equal(task.source_id, String(booking.id));
    assert.equal(task.source_module, MENU_ACTUAL_TASK_SOURCE_MODULE);
    assert.equal(task.related_entity_type, 'booking');
    assert.equal(task.related_entity_id, String(booking.id));
    assert.equal(task.owner_user_id, 7);
    assert.equal(task.deadline, bookingActualMenuTaskDeadline(booking));
    assert.equal(task.schedule_status, 'scheduled');
    assert.match(task.description, /Різниця до мінімуму|Minimum snapshot/);
    assert.equal(db.queries.some(entry => /notification_outbox|telegram/i.test(entry.sql)), false);
});

test('actual awaiting menu sync is idempotent, closes duplicates, and reschedules on booking time change', async () => {
    const db = new FakeTaskDb();
    const booking = actualBooking();
    await syncBanquetActualMenuTask(db, booking, { businessContext: 'event_genix', actor: { username: 'olena' } });
    const firstDeadline = db.tasks[0].deadline;

    const second = await syncBanquetActualMenuTask(db, booking, { businessContext: 'event_genix', actor: { username: 'olena' } });
    assert.equal(second.action, 'updated');
    assert.equal(db.tasks.filter(isActive).length, 1);

    db.tasks.push({ ...db.tasks[0], id: 999, status: 'todo', workflow_state: 'todo' });
    const changed = actualBooking({ time: '19:15', duration: 210 });
    const third = await syncBanquetActualMenuTask(db, changed, { businessContext: 'event_genix', actor: { username: 'olena' } });

    assert.equal(third.action, 'updated');
    assert.equal(third.duplicateClosedCount, 1);
    assert.equal(db.tasks.filter(isActive).length, 1);
    assert.notEqual(db.tasks[0].deadline, firstDeadline);
    assert.equal(db.tasks[0].deadline, bookingActualMenuTaskDeadline(changed));
    assert.equal(db.tasks.find(task => task.id === 999).status, 'cancelled');
});

test('finalization completes active actual menu task and cancellation resolves it', async () => {
    const finalizedDb = new FakeTaskDb();
    await syncBanquetActualMenuTask(finalizedDb, actualBooking(), { businessContext: 'event_genix', actor: { username: 'olena' } });
    const finalized = await syncBanquetActualMenuTask(finalizedDb, actualBooking({ workflowStatus: 'finalized', finalizedBy: { username: 'olena' }, finalizedAt: '2026-08-15T20:00:00Z' }), { businessContext: 'event_genix', actor: { username: 'olena' } });
    assert.equal(finalized.action, 'completed');
    assert.equal(finalizedDb.tasks[0].status, 'done');
    assert.equal(finalizedDb.tasks[0].schedule_status, 'completed');

    const cancelledDb = new FakeTaskDb();
    await syncBanquetActualMenuTask(cancelledDb, actualBooking(), { businessContext: 'event_genix', actor: { username: 'olena' } });
    const cancelled = await syncBanquetActualMenuTask(cancelledDb, actualBooking({ status: 'cancelled' }), { businessContext: 'event_genix', actor: { username: 'olena' }, cancel: true });
    assert.equal(cancelled.action, 'cancelled');
    assert.equal(cancelledDb.tasks[0].status, 'cancelled');
    assert.equal(cancelledDb.tasks[0].schedule_status, 'cancelled');
});

test('actual menu task hook stays explicit and does not use generic booking automation condition matching', () => {
    const root = path.join(__dirname, '..');
    const routeCode = fs.readFileSync(path.join(root, 'routes', 'bookings.js'), 'utf8');
    const syncCode = fs.readFileSync(path.join(root, 'services', 'banquetMenuTaskSync.js'), 'utf8');

    assert.match(routeCode, /syncBanquetActualMenuTask/);
    assert.doesNotMatch(syncCode, /bookingAutomation\.matchesCondition/);
    assert.match(syncCode, /skipNotifications:\s*true/);
    assert.match(syncCode, /skipHermesOutbox:\s*true/);
    assert.match(syncCode, /source_module:\s*MENU_ACTUAL_TASK_SOURCE_MODULE/);
});