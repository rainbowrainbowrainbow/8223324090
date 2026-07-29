'use strict';

const { pool: defaultPool } = require('../db');
const {
    buildTaskVisibilityScope,
    canRescheduleTask,
    normalizeUserId,
    taskOwnerState,
    userDisplayName
} = require('./taskPolicy');
const {
    DEFAULT_TASK_SOURCE_SURFACE,
    TASK_ACTION_TYPES,
    logTaskActionEvent
} = require('./taskActionHistory');
const { appendTaskBusinessScopeSql } = require('./taskBusinessScope');

const CLOSED_TASK_STATUSES = new Set([
    'done', 'completed', 'cancelled', 'canceled', 'archived', 'resolved', 'closed'
]);
const EXCLUDED_POSTPONEMENT_STATES = new Set(['waiting', 'blocked']);
const JSON_FIELDS = new Set(['schedule_meta', 'schedule_proposal', 'control_meta']);
const FIELD_CASTS = Object.freeze({
    deadline: 'timestamp',
    scheduled_start_at: 'timestamptz',
    scheduled_end_at: 'timestamptz',
    schedule_meta: 'jsonb',
    schedule_proposal: 'jsonb',
    snoozed_until: 'timestamptz',
    remind_at: 'timestamptz',
    escalate_after: 'timestamptz',
    next_notification_at: 'timestamptz',
    missed_at: 'timestamptz',
    missed_processed_at: 'timestamptz',
    control_meta: 'jsonb'
});
const MUTABLE_FIELDS = new Set([
    'date', 'deadline', 'time_window_start', 'time_window_end', 'effort_minutes',
    'scheduled_start_at', 'scheduled_end_at', 'schedule_slot', 'schedule_mode',
    'schedule_status', 'schedule_meta', 'schedule_proposal', 'snoozed_until',
    'remind_at', 'escalate_after', 'next_notification_at', 'missed_at',
    'missed_processed_at', 'workflow_state', 'status', 'control_meta'
]);
const ALLOWED_SOURCE_SURFACES = new Set([
    DEFAULT_TASK_SOURCE_SURFACE,
    'manager_queue_task_execution_v2',
    'task_detail',
    'task_page',
    'task_page_overdue_badge',
    'profile_my_cabinet',
    'profile_my_cabinet_overdue_badge',
    'profile_my_cabinet_overdue_to_today_button',
    'profile_my_cabinet_overdue_to_today_drop',
    'profile_my_cabinet_move_to_today_button',
    'profile_my_cabinet_move_to_today_drop',
    'alerts_panel',
    'hermes',
    'task_watchdog',
    'services.scheduler'
]);

function parsePositiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function taskField(task = {}, snakeName, camelName) {
    return task[snakeName] !== undefined ? task[snakeName] : task[camelName];
}

function isoValue(value) {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function kyivDateOnly(value) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(parsed);
}

function kyivDateEndIso(value) {
    const date = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const noonUtc = new Date(`${date}T12:00:00.000Z`);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        timeZoneName: 'longOffset',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(noonUtc);
    const offset = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT+02:00';
    const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
    const offsetMinutes = match
        ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
        : 120;
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMinutes * 60 * 1000).toISOString();
}

function canonicalTaskDue(task = {}) {
    const scheduleStatus = String(taskField(task, 'schedule_status', 'scheduleStatus') || '').toLowerCase();
    const scheduledEndAt = isoValue(taskField(task, 'scheduled_end_at', 'scheduledEndAt'));
    const deadline = isoValue(task.deadline);
    if (scheduledEndAt && ['scheduled', 'missed', 'completed'].includes(scheduleStatus)) {
        return { value: scheduledEndAt, source: 'scheduled_end_at', instant: scheduledEndAt };
    }
    if (deadline) return { value: deadline, source: 'deadline', instant: deadline };
    const date = String(task.date || '').slice(0, 10);
    const dateInstant = kyivDateEndIso(date);
    if (dateInstant) return { value: date, source: 'date', instant: dateInstant };
    return { value: null, source: null, instant: null };
}

function normalizePostponementCount(value) {
    return Math.max(0, Number(value || 0) || 0);
}

function normalizeSourceSurface(value) {
    const source = String(value || '').trim();
    return ALLOWED_SOURCE_SURFACES.has(source) ? source : DEFAULT_TASK_SOURCE_SURFACE;
}

function classifyTaskActor(actor = {}, sourceSurface = '', explicitType = null) {
    if (['manual', 'bot', 'system'].includes(explicitType)) return explicitType;
    const source = String(sourceSurface || '').toLowerCase();
    if (source === 'hermes' || String(actor.task_type || actor.taskType || '').toLowerCase() === 'bot') return 'bot';
    if (source.includes('watchdog') || source === 'services.scheduler') return 'system';
    return normalizeUserId(actor) ? 'manual' : 'system';
}

function evaluateTaskPostponement(task = {}, nextTask = {}, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const oldDue = canonicalTaskDue(task);
    const newDue = canonicalTaskDue(nextTask);
    const status = String(task.status || 'todo').trim().toLowerCase();
    const workflowState = String(taskField(task, 'workflow_state', 'workflowState') || '').trim().toLowerCase();
    const active = !CLOSED_TASK_STATUSES.has(status);
    const blocked = EXCLUDED_POSTPONEMENT_STATES.has(status)
        || EXCLUDED_POSTPONEMENT_STATES.has(workflowState)
        || task.is_blocked === true
        || task.isBlocked === true
        || Number(task.open_dependency_count || task.openDependencyCount || 0) > 0;
    const missed = String(taskField(task, 'schedule_status', 'scheduleStatus') || '').toLowerCase() === 'missed';
    const overdue = Boolean(oldDue.instant) && new Date(oldDue.instant).getTime() < now.getTime();
    const movedLater = Boolean(oldDue.instant && newDue.instant)
        && new Date(newDue.instant).getTime() > new Date(oldDue.instant).getTime();
    const mutationKind = String(options.mutationKind || 'reschedule').trim().toLowerCase();
    const excludedMutation = ['snooze', 'technical_correction'].includes(mutationKind);
    const countsAsPostponement = active && !blocked && !excludedMutation && (overdue || missed) && movedLater;
    const postponementCountBefore = normalizePostponementCount(taskField(task, 'postponement_count', 'postponementCount'));
    return {
        oldDue,
        newDue,
        active,
        blocked,
        overdue,
        missed,
        movedLater,
        mutationKind,
        countsAsPostponement,
        postponementCountBefore,
        postponementCountAfter: postponementCountBefore + (countsAsPostponement ? 1 : 0)
    };
}

function normalizeTaskRow(row = {}) {
    return {
        ...row,
        ownerUserId: row.owner_user_id || row.ownerUserId || null,
        ownerLabel: row.owner_label || row.owner_name || row.owner_username || row.assigned_to || row.owner || null,
        ownerState: taskOwnerState(row),
        postponementCount: normalizePostponementCount(row.postponement_count ?? row.postponementCount),
        originalDueAt: row.original_due_at || row.originalDueAt || null,
        lastPostponedAt: row.last_postponed_at || row.lastPostponedAt || null
    };
}

function normalizePatch(patch = {}) {
    const result = {};
    for (const [field, value] of Object.entries(patch || {})) {
        if (!MUTABLE_FIELDS.has(field)) continue;
        result[field] = JSON_FIELDS.has(field) && value !== null ? JSON.stringify(value) : value;
    }
    return result;
}

function withTransaction(options, work) {
    const query = options.pool || defaultPool;
    if (typeof query.connect !== 'function' || typeof query.release === 'function') return work(query);
    return query.connect().then(async client => {
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try { await client.query('ROLLBACK'); } catch {}
            throw err;
        } finally {
            client.release();
        }
    });
}

async function loadVisibleTaskForReschedule(query, taskId, actor, options = {}) {
    const id = parsePositiveInt(taskId);
    if (!id) {
        const err = new Error('Valid taskId is required');
        err.statusCode = 400;
        err.code = 'INVALID_TASK_ID';
        throw err;
    }
    const params = [id];
    const visibility = buildTaskVisibilityScope(actor, params, 't');
    const businessScope = options.businessScope || options.businessContext || null;
    const businessCondition = businessScope ? appendTaskBusinessScopeSql(params, businessScope, 't') : '';
    const result = await query.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username, u.role AS owner_role
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE t.id = $1
           ${visibility}
           ${businessCondition}
         LIMIT 1
         FOR UPDATE OF t`,
        params
    );
    if (!result.rows.length) {
        const err = new Error('Task not found or not visible');
        err.statusCode = 404;
        err.code = 'TASK_NOT_VISIBLE';
        throw err;
    }
    return result.rows[0];
}

async function findIdempotentEvent(query, taskId, idempotencyKey) {
    if (!idempotencyKey) return null;
    const result = await query.query(
        `SELECT * FROM task_action_history
         WHERE task_id = $1 AND meta_json->>'idempotencyKey' = $2
         ORDER BY id DESC LIMIT 1`,
        [taskId, idempotencyKey]
    );
    return result.rows[0] || null;
}

async function applyCanonicalRescheduleMutation(query, task, patch, actor = {}, options = {}) {
    const idempotencyKey = String(options.idempotencyKey || '').trim() || null;
    const sourceSurface = normalizeSourceSurface(options.sourceSurface);
    const actorType = classifyTaskActor(actor, sourceSurface, options.actorType);
    if (actorType !== 'manual' && options.requireIdempotency !== false && !idempotencyKey) {
        const err = new Error('Automatic task reschedules require an idempotency key');
        err.statusCode = 400;
        err.code = 'TASK_RESCHEDULE_IDEMPOTENCY_KEY_REQUIRED';
        throw err;
    }
    const existingEvent = options.idempotencyHandledExternally === true
        ? null
        : await findIdempotentEvent(query, task.id, idempotencyKey);
    if (existingEvent) {
        return { task: normalizeTaskRow(task), historyEvent: existingEvent, idempotent: true, unchanged: true };
    }
    const normalizedPatch = normalizePatch(patch);
    if (!Object.keys(normalizedPatch).length) {
        const err = new Error('A canonical task due or schedule change is required');
        err.statusCode = 400;
        err.code = 'INVALID_TASK_RESCHEDULE';
        throw err;
    }
    const decision = evaluateTaskPostponement(task, { ...task, ...patch }, options);
    const values = [task.id];
    const setters = [];
    for (const [field, value] of Object.entries(normalizedPatch)) {
        values.push(value);
        const cast = FIELD_CASTS[field] ? `::${FIELD_CASTS[field]}` : '';
        setters.push(`${field} = $${values.length}${cast}`);
    }
    values.push(decision.postponementCountAfter);
    setters.push(`postponement_count = $${values.length}::integer`);
    values.push(decision.countsAsPostponement ? decision.oldDue.instant : null);
    setters.push(`original_due_at = CASE WHEN $${values.length}::timestamptz IS NULL THEN original_due_at ELSE COALESCE(original_due_at, $${values.length}::timestamptz) END`);
    const changedAt = options.now instanceof Date ? options.now.toISOString() : new Date(options.now || Date.now()).toISOString();
    values.push(decision.countsAsPostponement ? changedAt : null);
    setters.push(`last_postponed_at = CASE WHEN $${values.length}::timestamptz IS NULL THEN last_postponed_at ELSE $${values.length}::timestamptz END`);
    setters.push('updated_at = NOW()');
    setters.push('version = COALESCE(version, 1) + 1');
    values.push(task.version || 1);
    const versionRef = `$${values.length}`;
    values.push(task.business_context || 'event_genix');
    const businessRef = `$${values.length}`;
    const result = await query.query(
        `UPDATE tasks SET ${setters.join(', ')}
         WHERE id = $1
           AND COALESCE(version, 1) = ${versionRef}
           AND COALESCE(business_context, 'event_genix') = ${businessRef}
           AND COALESCE(status, 'todo') NOT IN ('done','completed','cancelled','canceled','archived','resolved','closed')
         RETURNING *`,
        values
    );
    if (!result.rows.length) {
        const err = new Error('Task was changed by another writer or is no longer active');
        err.statusCode = 409;
        err.code = 'TASK_STALE_WRITE';
        throw err;
    }
    const updated = normalizeTaskRow(result.rows[0]);
    const deadlineMismatch = Object.prototype.hasOwnProperty.call(patch, 'deadline')
        && isoValue(updated.deadline) !== isoValue(patch.deadline);
    const dateMismatch = Object.prototype.hasOwnProperty.call(patch, 'date')
        && String(updated.date || '').slice(0, 10) !== String(patch.date || '').slice(0, 10);
    const expectedWatchdogLabels = patch.control_meta?.watchdog?.labels;
    const updatedControlMeta = updated.control_meta && typeof updated.control_meta === 'object' ? updated.control_meta : {};
    const watchdogLabelsMismatch = Array.isArray(expectedWatchdogLabels)
        && !expectedWatchdogLabels.every(label => (updatedControlMeta.watchdog?.labels || []).includes(label));
    if (deadlineMismatch || dateMismatch || watchdogLabelsMismatch) {
        const err = new Error('Canonical task reschedule readback does not match requested due state');
        err.statusCode = 409;
        err.code = 'READBACK_MISMATCH';
        throw err;
    }
    const historyEvent = await logTaskActionEvent({
        taskId: task.id,
        actionType: options.actionType || TASK_ACTION_TYPES.RESCHEDULED,
        actor,
        sourceSurface,
        oldValue: options.oldValue || { deadline: task.deadline || null, date: task.date || null },
        newValue: options.newValue || { deadline: updated.deadline || null, date: updated.date || null },
        summary: options.summary,
        meta: {
            ...(options.meta || {}),
            route: options.route || 'canonical_task_reschedule',
            actor: { userId: normalizeUserId(actor), name: userDisplayName(actor) },
            actorType,
            sourceSurface,
            reason: options.reason || null,
            idempotencyKey,
            mutationKind: decision.mutationKind,
            oldDue: decision.oldDue,
            newDue: decision.newDue,
            overdueBefore: decision.overdue,
            missedSlotBefore: decision.missed,
            countsAsPostponement: decision.countsAsPostponement,
            postponementCountBefore: decision.postponementCountBefore,
            postponementCountAfter: decision.postponementCountAfter
        }
    }, { pool: query });
    return { task: updated, historyEvent, postponement: decision, idempotent: false, unchanged: false };
}

function deadlinePatch(task, deadline, options = {}) {
    const explicit = deadline && typeof deadline === 'object' && !(deadline instanceof Date) ? deadline : null;
    const nextDeadline = explicit ? (explicit.deadline ?? task.deadline ?? null) : deadline;
    const patch = explicit ? {
        ...(Object.prototype.hasOwnProperty.call(explicit, 'date') ? { date: explicit.date || null } : {}),
        ...(Object.prototype.hasOwnProperty.call(explicit, 'deadline') ? { deadline: explicit.deadline || null } : {})
    } : {
        deadline: nextDeadline || null,
        date: nextDeadline ? kyivDateOnly(nextDeadline) : task.date || null
    };
    if (nextDeadline && task.scheduled_start_at) {
        const oldStart = new Date(task.scheduled_start_at);
        const oldEnd = task.scheduled_end_at ? new Date(task.scheduled_end_at) : null;
        const newStart = new Date(nextDeadline);
        patch.scheduled_start_at = newStart.toISOString();
        patch.scheduled_end_at = oldEnd && !Number.isNaN(oldEnd.getTime()) && !Number.isNaN(oldStart.getTime())
            ? new Date(newStart.getTime() + Math.max(0, oldEnd.getTime() - oldStart.getTime())).toISOString()
            : task.scheduled_end_at || null;
        patch.schedule_status = 'scheduled';
    }
    patch.status = String(task.status || '').toLowerCase() === 'overdue' ? 'todo' : task.status;
    patch.workflow_state = String(task.workflow_state || '').toLowerCase() === 'overdue' ? 'todo' : task.workflow_state;
    patch.snoozed_until = null;
    patch.remind_at = null;
    if (String(task.priority || '').toLowerCase() === 'urgent') {
        patch.escalate_after = nextDeadline || task.escalate_after || null;
        patch.next_notification_at = nextDeadline || task.next_notification_at || new Date(Date.now() + 90 * 60 * 1000).toISOString();
    }
    if (options.controlMetaPatch) {
        const base = task.control_meta && typeof task.control_meta === 'object' ? task.control_meta : {};
        const watchdog = options.controlMetaPatch.watchdog || {};
        patch.control_meta = {
            ...base,
            ...options.controlMetaPatch,
            ...(Object.keys(watchdog).length ? { watchdog: { ...(base.watchdog || {}), ...watchdog } } : {})
        };
    }
    return patch;
}

async function rescheduleTask(taskId, deadline, actor = {}, options = {}) {
    return withTransaction(options, async query => {
        const task = await loadVisibleTaskForReschedule(query, taskId, actor, options);
        if (!canRescheduleTask(actor, task)) {
            const err = new Error('You cannot reschedule this task');
            err.statusCode = 403;
            err.code = 'TASK_ACTION_FORBIDDEN';
            throw err;
        }
        if (options.expectedOwnerUserId && Number(task.owner_user_id || 0) !== Number(options.expectedOwnerUserId)) {
            const err = new Error('Task owner changed before reschedule');
            err.statusCode = 409;
            err.code = 'TASK_OWNER_STALE_WRITE';
            throw err;
        }
        return applyCanonicalRescheduleMutation(query, task, deadlinePatch(task, deadline, options), actor, {
            ...options,
            meta: {
                ...(options.meta || {}),
                ownerStateBefore: taskOwnerState(task),
                canonicalFields: ['tasks.deadline', 'tasks.date']
            }
        });
    });
}

module.exports = {
    applyCanonicalRescheduleMutation,
    canonicalTaskDue,
    classifyTaskActor,
    evaluateTaskPostponement,
    kyivDateOnly,
    loadVisibleTaskForReschedule,
    normalizeSourceSurface,
    rescheduleTask,
    withTransaction
};
