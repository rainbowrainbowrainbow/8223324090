const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scheduling = require('../services/taskScheduling');
const {
    applyCanonicalRescheduleMutation,
    classifyTaskActor,
    evaluateTaskPostponement
} = require('../services/taskReschedule');
const { TASK_ACTION_TYPES } = require('../services/taskActionHistory');
const { canRescheduleTask } = require('../services/taskPolicy');
const {
    derivePostponementPriority,
    postponementAttentionLevel
} = require('../services/taskPostponementPolicy');

test('task scheduling policy exposes four fixed global slots and default duration', () => {
    const policy = scheduling.getSchedulePolicy();
    assert.equal(policy.defaultDurationMinutes, 30);
    assert.deepEqual(policy.slots.map(slot => slot.key), ['morning', 'midday', 'afternoon', 'evening']);
    assert.equal(policy.decisions.fullSlotBehavior, 'proposal_requires_confirmation');
});

test('normalizes slot schedule requests with default and custom duration', () => {
    const defaulted = scheduling.normalizeScheduleRequest({
        schedule: { date: '2026-05-21', slot: 'morning' }
    });
    assert.equal(defaulted.date, '2026-05-21');
    assert.equal(defaulted.slot, 'morning');
    assert.equal(defaulted.durationMinutes, 30);

    const custom = scheduling.normalizeScheduleRequest({
        schedule: { date: '2026-05-21', slot: 'evening', durationMinutes: 75 }
    });
    assert.equal(custom.slot, 'evening');
    assert.equal(custom.durationMinutes, 75);
});

test('builds Kyiv slot windows with ordered start and end instants', () => {
    const window = scheduling.scheduleWindowForSlot('2026-05-21', 'morning');
    assert.ok(window.start instanceof Date);
    assert.ok(window.end instanceof Date);
    assert.ok(window.end.getTime() > window.start.getTime());
});

test('dateOnly keeps date-only values fixed and converts timestamps by Kyiv day', () => {
    assert.equal(scheduling.dateOnly('2026-05-31'), '2026-05-31');
    assert.equal(scheduling.dateOnly('2026-05-30T21:30:00.000Z'), '2026-05-31');
});

test('canonical schedule metadata marks date-only tasks before exact-time tasks', () => {
    const dateOnly = scheduling.scheduleSortMeta({ date: '2026-05-21', created_at: '2026-05-20T10:00:00Z' }, new Date('2026-05-20T10:00:00Z'));
    const timed = scheduling.scheduleSortMeta({ scheduled_start_at: '2026-05-21T09:00:00Z', created_at: '2026-05-20T10:00:00Z' }, new Date('2026-05-20T10:00:00Z'));
    assert.equal(dateOnly.hasExactTime, false);
    assert.equal(timed.hasExactTime, true);
    assert.equal(dateOnly.order[0], 0);
    assert.equal(timed.order[0], 1);
});

test('schedule history action taxonomy includes durable scheduling events', () => {
    assert.equal(TASK_ACTION_TYPES.SCHEDULED, 'task_scheduled');
    assert.equal(TASK_ACTION_TYPES.SCHEDULE_MOVED, 'task_schedule_moved');
    assert.equal(TASK_ACTION_TYPES.SCHEDULE_PROPOSAL_CREATED, 'task_schedule_proposal_created');
    assert.equal(TASK_ACTION_TYPES.SLOT_MISSED, 'task_slot_missed');
    assert.equal(TASK_ACTION_TYPES.DISCIPLINE_PENALTY_APPLIED, 'task_discipline_penalty_applied');
    assert.equal(TASK_ACTION_TYPES.PRIORITY_CHANGED, 'task_priority_changed');
    assert.equal(TASK_ACTION_TYPES.SNOOZED, 'task_snoozed');
    assert.equal(TASK_ACTION_TYPES.URGENT_COMMITMENT_SET, 'task_urgent_commitment_set');
    assert.equal(TASK_ACTION_TYPES.SUBTASK_COMPLETED, 'task_subtask_completed');
});

test('rescheduling policy honors explicit canReschedule control metadata', () => {
    const actor = { id: 10, role: 'admin', username: 'admin' };
    assert.equal(canRescheduleTask(actor, { id: 1, owner_user_id: 10, control_meta: {} }), true);
    assert.equal(canRescheduleTask(actor, { id: 2, owner_user_id: 10, control_meta: { canReschedule: false } }), false);
    assert.equal(canRescheduleTask(actor, { id: 3, owner_user_id: 10, control_meta: JSON.stringify({ allowReschedule: false }) }), false);
});

test('deadline reschedule uses the canonical atomic mutation service', () => {
    const execution = fs.readFileSync(path.join(__dirname, '..', 'services', 'taskExecution.js'), 'utf8');
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'taskReschedule.js'), 'utf8');
    assert.match(execution, /rescheduleTask:\s*canonicalRescheduleTask/);
    assert.match(source, /FOR UPDATE OF t/);
    assert.match(source, /postponement_count =/);
    assert.match(source, /original_due_at = CASE/);
    assert.match(source, /last_postponed_at = CASE/);
    assert.match(source, /logTaskActionEvent/);
    assert.match(source, /patch\.snoozed_until = null/);
    assert.match(source, /patch\.remind_at = null/);
});

test('task ownership debt uses typed owner for rewards, penalties, and durable status history', () => {
    const gamification = fs.readFileSync(path.join(__dirname, '..', 'services', 'gamification.js'), 'utf8');
    const scheduler = fs.readFileSync(path.join(__dirname, '..', 'services', 'scheduler.js'), 'utf8');
    const authRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    const tasksRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tasks.js'), 'utf8');

    assert.match(gamification, /function taskOwnerJoinSql/);
    assert.match(gamification, /owner_user_id/);
    assert.doesNotMatch(gamification, /WHERE assigned_to = \$1 AND status = 'done'/);
    assert.match(scheduler, /u\.username AS owner_username/);
    assert.match(scheduler, /const canonicalOwner = task\.owner_username/);
    assert.match(authRoute, /TASK_ACTION_TYPES\.STATUS_CHANGED/);
    assert.match(authRoute, /auth_tasks_quick_status/);
    assert.match(tasksRoute, /function logDirectTaskUpdateHistory/);
    assert.match(tasksRoute, /TASK_ACTION_TYPES\.OWNER_REASSIGNED/);
});

test('task postponement migration is governed, additive, idempotent, and has no historical backfill', () => {
    const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '307_task_postponement_metadata.sql'), 'utf8');
    const migrationSql = migration
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*--.*$/gm, ' ');

    assert.match(migration, /-- MIGRATION_KIND:\s*schema/i);
    assert.match(migration, /-- SAFETY:/i);
    assert.match(migration, /-- ROLLBACK:/i);
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS postponement_count INTEGER NOT NULL DEFAULT 0/i);
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS original_due_at TIMESTAMPTZ NULL/i);
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS last_postponed_at TIMESTAMPTZ NULL/i);
    assert.doesNotMatch(migrationSql, /\bUPDATE\s+tasks\b/i);
    assert.doesNotMatch(migrationSql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(migrationSql, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
    assert.doesNotMatch(migrationSql, /\battention_level\b/i);
    assert.doesNotMatch(migrationSql, /\bcontrol_meta\b/i);
    assert.doesNotMatch(migrationSql, /ALTER TABLE\s+task_action_history/i);
});

test('task payload normalizers expose durable postponement metadata with computed attention level', () => {
    const { normalizeTaskPayload } = require('../services/taskCabinetProjection');
    const normalized = normalizeTaskPayload({
        id: 42,
        status: 'todo',
        postponement_count: '2',
        original_due_at: '2026-07-27T15:00:00.000Z',
        last_postponed_at: '2026-07-29T10:30:00.000Z'
    });
    const scheduled = scheduling.attachTaskSchedule({ id: 43, status: 'todo' });

    assert.equal(normalized.postponementCount, 2);
    assert.equal(normalized.originalDueAt, '2026-07-27T15:00:00.000Z');
    assert.equal(normalized.lastPostponedAt, '2026-07-29T10:30:00.000Z');
    assert.equal(normalized.attentionLevel, 2);
    assert.equal(scheduled.postponementCount, 0);
    assert.equal(scheduled.attentionLevel, 0);
    assert.equal(scheduled.originalDueAt, null);
    assert.equal(scheduled.lastPostponedAt, null);

    for (const relativePath of [
        'routes/tasks.js',
        'services/taskCabinetProjection.js',
        'services/taskExecution.js',
        'services/taskScheduling.js'
    ]) {
        const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
        assert.match(
            source,
            /postponementCount:\s*Math\.max\(0, Number\(row\.postponement_count|const postponementCount = normalizePostponementCount\(row\.postponement_count/
        );
        assert.match(source, /originalDueAt:\s*(?:isoValue\()?row\.original_due_at/);
        assert.match(source, /lastPostponedAt:\s*(?:isoValue\()?row\.last_postponed_at/);
        assert.match(source, /attentionLevel:\s*postponementAttentionLevel/);
        assert.doesNotMatch(source, /attentionLevel:\s*row\.attention_level/);
    }
});

test('postponement priority policy uses 1 / 2 / 3+ levels without downgrading', () => {
    assert.deepEqual(derivePostponementPriority(0, 'low'), {
        count: 0,
        attentionLevel: 0,
        minimumPriority: null,
        priorityBefore: 'low',
        priorityAfter: 'low',
        priorityEscalated: false
    });
    assert.equal(derivePostponementPriority(1, 'normal').priorityAfter, 'high');
    assert.equal(derivePostponementPriority(2, 'high').priorityAfter, 'urgent');
    assert.equal(derivePostponementPriority(3, 'urgent').priorityAfter, 'urgent');
    assert.equal(derivePostponementPriority(1, 'urgent').priorityAfter, 'urgent');
    assert.equal(postponementAttentionLevel(9), 3);
});

test('postponement decision follows overdue, later-date, missed-slot, and exclusion rules', () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    const overdue = {
        id: 1,
        status: 'todo',
        workflow_state: 'todo',
        deadline: '2026-07-28T10:00:00.000Z',
        postponement_count: 0
    };

    const today = evaluateTaskPostponement(overdue, {
        ...overdue,
        deadline: '2026-07-29T16:00:00.000Z'
    }, { now });
    const tomorrow = evaluateTaskPostponement(overdue, {
        ...overdue,
        deadline: '2026-07-30T10:00:00.000Z'
    }, { now });
    assert.equal(today.countsAsPostponement, true);
    assert.equal(tomorrow.countsAsPostponement, true);
    assert.equal(today.postponementCountAfter, 1);
    assert.equal(today.attentionLevelAfter, 1);
    assert.equal(today.priorityAfter, 'high');
    assert.equal(today.priorityEscalated, true);

    const future = evaluateTaskPostponement({
        ...overdue,
        deadline: '2026-07-30T10:00:00.000Z'
    }, {
        ...overdue,
        deadline: '2026-07-31T10:00:00.000Z'
    }, { now });
    assert.equal(future.countsAsPostponement, false);
    assert.equal(future.priorityEscalated, false);

    const earlier = evaluateTaskPostponement(overdue, {
        ...overdue,
        deadline: '2026-07-27T10:00:00.000Z'
    }, { now });
    assert.equal(earlier.countsAsPostponement, false);

    const snooze = evaluateTaskPostponement(overdue, {
        ...overdue,
        deadline: '2026-07-30T10:00:00.000Z'
    }, { now, mutationKind: 'snooze' });
    assert.equal(snooze.countsAsPostponement, false);

    const waiting = evaluateTaskPostponement({ ...overdue, workflow_state: 'waiting' }, {
        ...overdue,
        workflow_state: 'waiting',
        deadline: '2026-07-30T10:00:00.000Z'
    }, { now });
    assert.equal(waiting.countsAsPostponement, false);

    const missed = evaluateTaskPostponement({
        ...overdue,
        schedule_status: 'missed',
        scheduled_end_at: '2026-07-30T10:00:00.000Z'
    }, {
        ...overdue,
        schedule_status: 'scheduled',
        scheduled_end_at: '2026-07-31T10:00:00.000Z'
    }, { now });
    assert.equal(missed.overdue, false);
    assert.equal(missed.missed, true);
    assert.equal(missed.countsAsPostponement, true);
});

function postponementQuery(initialTask) {
    let task = { ...initialTask };
    const events = [];
    let updateCalls = 0;
    return {
        get task() { return task; },
        events,
        get updateCalls() { return updateCalls; },
        async query(text, params = []) {
            if (/FROM task_action_history/i.test(text) && /idempotencyKey/i.test(text)) {
                const event = events.find(item => item.meta_json?.idempotencyKey === params[1]);
                return { rows: event ? [event] : [], rowCount: event ? 1 : 0 };
            }
            if (/^\s*UPDATE tasks SET/i.test(text)) {
                updateCalls += 1;
                const paramFor = field => {
                    const match = text.match(new RegExp(`${field} = \\$([0-9]+)`));
                    return match ? params[Number(match[1]) - 1] : task[field];
                };
                task = {
                    ...task,
                    deadline: paramFor('deadline'),
                    date: paramFor('date'),
                    postponement_count: paramFor('postponement_count'),
                    priority: paramFor('priority'),
                    original_due_at: params[Number(text.match(/original_due_at = CASE WHEN \$([0-9]+)/)[1]) - 1] || task.original_due_at || null,
                    last_postponed_at: params[Number(text.match(/last_postponed_at = CASE WHEN \$([0-9]+)/)[1]) - 1] || task.last_postponed_at || null,
                    version: Number(task.version || 1) + 1
                };
                return { rows: [{ ...task }], rowCount: 1 };
            }
            if (/INSERT INTO task_action_history/i.test(text)) {
                const row = {
                    id: events.length + 1,
                    task_id: params[0],
                    action_type: params[1],
                    actor_user_id: params[2],
                    actor_name_snapshot: params[3],
                    source_surface: params[4],
                    old_value_json: JSON.parse(params[5]),
                    new_value_json: JSON.parse(params[6]),
                    meta_json: JSON.parse(params[7]),
                    summary: params[8],
                    created_at: '2026-07-29T12:00:00.000Z'
                };
                events.push(row);
                return { rows: [row], rowCount: 1 };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };
}

test('canonical mutation increments once per idempotency key and records manual/bot actor type', async () => {
    const initial = {
        id: 41,
        status: 'todo',
        workflow_state: 'todo',
        deadline: '2026-07-28T10:00:00.000Z',
        date: '2026-07-28',
        postponement_count: 0,
        priority: 'normal',
        version: 1,
        business_context: 'event_genix'
    };
    const manualQuery = postponementQuery(initial);
    const manual = await applyCanonicalRescheduleMutation(manualQuery, initial, {
        deadline: '2026-07-29T16:00:00.000Z', date: '2026-07-29'
    }, { id: 7, name: 'Owner' }, {
        now: new Date('2026-07-29T12:00:00.000Z'),
        sourceSurface: 'profile_my_cabinet',
        reason: 'move_to_today'
    });
    assert.equal(manual.task.postponementCount, 1);
    assert.equal(manual.task.priority, 'high');
    assert.equal(manual.task.attentionLevel, 1);
    assert.equal(manual.historyEvent.meta.actorType, 'manual');
    assert.equal(manual.historyEvent.meta.countsAsPostponement, true);
    assert.equal(manual.historyEvent.meta.priorityBefore, 'normal');
    assert.equal(manual.historyEvent.meta.priorityAfter, 'high');
    assert.equal(manual.historyEvent.meta.priorityEscalated, true);

    const botQuery = postponementQuery(initial);
    const options = {
        now: new Date('2026-07-29T12:00:00.000Z'),
        sourceSurface: 'hermes',
        actorType: 'bot',
        idempotencyKey: 'hermes:reschedule:41:1',
        reason: 'bot_reschedule'
    };
    const first = await applyCanonicalRescheduleMutation(botQuery, initial, {
        deadline: '2026-07-30T10:00:00.000Z', date: '2026-07-30'
    }, { id: 9, name: 'Hermes' }, options);
    const retry = await applyCanonicalRescheduleMutation(botQuery, botQuery.task, {
        deadline: '2026-07-30T10:00:00.000Z', date: '2026-07-30'
    }, { id: 9, name: 'Hermes' }, options);
    assert.equal(first.task.postponementCount, 1);
    assert.equal(first.task.priority, 'high');
    assert.equal(first.historyEvent.meta.actorType, 'bot');
    assert.equal(retry.idempotent, true);
    assert.equal(retry.task.postponementCount, 1);
    assert.equal(botQuery.updateCalls, 1);
});

test('second counted postponement atomically escalates high priority to urgent', async () => {
    const initial = {
        id: 51,
        status: 'todo',
        workflow_state: 'todo',
        deadline: '2026-07-28T10:00:00.000Z',
        date: '2026-07-28',
        postponement_count: 1,
        priority: 'high',
        version: 1,
        business_context: 'event_genix'
    };
    const query = postponementQuery(initial);
    const result = await applyCanonicalRescheduleMutation(query, initial, {
        deadline: '2026-07-30T10:00:00.000Z', date: '2026-07-30'
    }, { id: 7, name: 'Owner' }, {
        now: new Date('2026-07-29T12:00:00.000Z'),
        sourceSurface: 'profile_my_cabinet',
        reason: 'second_postponement'
    });

    assert.equal(result.task.postponementCount, 2);
    assert.equal(result.task.priority, 'urgent');
    assert.equal(result.task.attentionLevel, 2);
    assert.equal(result.historyEvent.meta.attentionLevelBefore, 1);
    assert.equal(result.historyEvent.meta.attentionLevelAfter, 2);
    assert.equal(result.historyEvent.meta.minimumPriority, 'urgent');
});

test('production reschedule writers are routed through the canonical service', () => {
    const execution = fs.readFileSync(path.join(__dirname, '..', 'services', 'taskExecution.js'), 'utf8');
    const schedulingSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'taskScheduling.js'), 'utf8');
    const watchdog = fs.readFileSync(path.join(__dirname, '..', 'services', 'taskWatchdog.js'), 'utf8');
    const tasksRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tasks.js'), 'utf8');
    const hermesRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'hermes.js'), 'utf8');
    assert.match(execution, /rescheduleTask:\s*canonicalRescheduleTask/);
    assert.match(schedulingSource, /applyCanonicalRescheduleMutation/);
    assert.match(watchdog, /rescheduleTask\(/);
    assert.doesNotMatch(watchdog, /UPDATE tasks SET deadline=/);
    assert.doesNotMatch(tasksRoute, /setClauses\.push\(`deadline=/);
    assert.match(hermesRoute, /idempotencyKey:\s*req\.hermesMutation\?\.idempotencyKey/);
    assert.equal(classifyTaskActor({ id: 1 }, 'profile_my_cabinet'), 'manual');
    assert.equal(classifyTaskActor({ id: 2 }, 'hermes'), 'bot');
    assert.equal(classifyTaskActor({}, 'task_watchdog'), 'system');
});
