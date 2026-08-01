const { pool } = require('../db');
const {
    buildTaskVisibilityScope,
    canMutateTask,
    canReassignTask,
    canRescheduleTask,
    isPrivateTaskVisibility,
    privateTaskHandoffNeedsConfirmation,
    normalizeUserId,
    taskOwnerState,
    userDisplayName
} = require('./taskPolicy');
const { getPermissions } = require('../config/roles');
const {
    DEFAULT_TASK_SOURCE_SURFACE,
    TASK_ACTION_TYPES,
    logTaskActionEvent
} = require('./taskActionHistory');
const { subtaskCompletionState } = require('./taskSubtasks');
const { appendTaskBusinessScopeSql } = require('./taskBusinessScope');
const { rescheduleTask: canonicalRescheduleTask } = require('./taskReschedule');
const { postponementAttentionLevel } = require('./taskPostponementPolicy');

const ASSIGNABLE_TASK_ROLES = [
    'creator', 'director', 'vice_director', 'senior_manager', 'manager',
    'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin',
    'security', 'senior_instructor', 'instructor', 'head_chef', 'cook',
    'head_pastry', 'pastry_chef', 'animator', 'reception', 'barista',
    'wardrobe', 'cleaning', 'maintenance', 'dishwasher', 'waiter'
];

function parsePositiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function taskControlMeta(task = {}) {
    return parseJsonObject(task.control_meta || task.controlMeta || {});
}

function taskRequiresCompletionReport(task = {}) {
    const meta = taskControlMeta(task);
    return meta.reportRequired === true
        || meta.requiresReport === true
        || meta.report_required === true
        || task.report_required === true
        || task.requiresReport === true;
}

function taskCompletionReportId(task = {}) {
    const meta = taskControlMeta(task);
    return parsePositiveInt(
        meta.reportId
        || meta.report_id
        || meta.taskReportId
        || meta.task_report_id
        || meta.completionReportId
        || meta.completion_report_id
        || task.reportId
        || task.report_id
    );
}

function reportRequiredError(task = {}) {
    const err = new Error('Для виконання цієї задачі спочатку потрібно додати звіт.');
    err.statusCode = 409;
    err.code = 'TASK_REPORT_REQUIRED';
    err.requiresReport = true;
    err.task = {
        id: task.id,
        title: task.title || null,
        reportRequired: true
    };
    return err;
}

async function getParentSubtaskCompletionState(query, taskId) {
    const result = await query.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_done = true)::int AS done
         FROM task_subtasks
         WHERE task_id = $1`,
        [taskId]
    );
    return subtaskCompletionState(result.rows[0]?.done || 0, result.rows[0]?.total || 0);
}

function subtaskCompletionRequiredError(task, state) {
    const err = new Error(`Закрийте всі підпункти перед виконанням задачі (${state.done}/${state.total}).`);
    err.statusCode = 409;
    err.code = 'SUBTASKS_INCOMPLETE';
    err.task = {
        id: task.id,
        title: task.title || null,
        subtaskCount: state.total,
        subtaskDoneCount: state.done,
        subtaskOpenCount: state.open
    };
    err.meta = { subtaskCompletionRequired: true };
    return err;
}

async function ensureReportExists(query, reportId, businessContext = null) {
    const id = parsePositiveInt(reportId);
    if (!id) return null;
    const params = [id];
    let businessCondition = '';
    if (businessContext) {
        params.push(String(businessContext));
        businessCondition = ` AND COALESCE(business_context, 'event_genix') = $${params.length}`;
    }
    const result = await query.query(`SELECT id FROM reports WHERE id = $1${businessCondition} LIMIT 1`, params);
    if (!result.rows.length) {
        const err = new Error('Звіт не знайдено або його ще не збережено.');
        err.statusCode = 400;
        err.code = 'TASK_REPORT_NOT_FOUND';
        throw err;
    }
    return id;
}

function normalizeTaskRow(row = {}) {
    return {
        ...row,
        ownerUserId: row.owner_user_id || null,
        ownerLabel: row.owner_label || row.owner_name || row.owner_username || row.assigned_to || row.owner || null,
        ownerState: taskOwnerState(row),
        postponementCount: Math.max(0, Number(row.postponement_count ?? row.postponementCount ?? 0) || 0),
        attentionLevel: postponementAttentionLevel(row.postponement_count ?? row.postponementCount),
        originalDueAt: row.original_due_at || row.originalDueAt || null,
        lastPostponedAt: row.last_postponed_at || row.lastPostponedAt || null
    };
}

function taskValue(task = {}) {
    return {
        status: task.status || null,
        ownerUserId: task.owner_user_id || task.ownerUserId || null,
        assignedTo: task.assigned_to || task.assignedTo || null,
        owner: task.owner || null,
        deadline: task.deadline || null,
        date: task.date || null
    };
}

function sourceSurface(value) {
    const raw = String(value || '').trim();
    if ([
        'task_page',
        'task_page_overdue_badge',
        'task_detail',
        'profile_my_cabinet',
        'profile_my_cabinet_overdue_badge',
        'profile_my_cabinet_overdue_to_today_button',
        'profile_my_cabinet_overdue_to_today_drop',
        'profile_my_cabinet_move_to_today_button',
        'profile_my_cabinet_move_to_today_drop',
        'hermes',
        DEFAULT_TASK_SOURCE_SURFACE
    ].includes(raw)) return raw;
    return DEFAULT_TASK_SOURCE_SURFACE;
}

async function withTaskExecutionTransaction(options, work) {
    const query = options.pool || pool;
    if (options.pool || typeof query.connect !== 'function') {
        return work(query);
    }

    const client = await query.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {}
        throw err;
    } finally {
        client.release();
    }
}

function resolveDeadline(body = {}) {
    const direct = body.deadline || body.dueAt || body.due_at;
    if (direct) return direct;

    const rawMinutes = body.snoozeMinutes ?? body.snooze_minutes;
    const rawHours = body.snoozeHours ?? body.snooze_hours;
    const minutes = rawMinutes !== undefined
        ? Number(rawMinutes)
        : (rawHours !== undefined ? Number(rawHours) * 60 : null);

    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60 * 24 * 60) {
        const err = new Error('Valid deadline or snoozeMinutes/snoozeHours is required');
        err.statusCode = 400;
        err.code = 'INVALID_TASK_RESCHEDULE';
        throw err;
    }

    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function forbidden(message, code = 'TASK_ACTION_FORBIDDEN') {
    const err = new Error(message);
    err.statusCode = 403;
    err.code = code;
    return err;
}

function ownerCandidateScopeSql(actor, params) {
    const perms = getPermissions(actor?.role);
    if (perms.canAssignAnyone === true || perms.taskVisibility === 'all') return '';
    const actorId = normalizeUserId(actor);
    if (!actorId) return 'AND 1 = 0';
    params.push(actorId);
    const actorRef = `$${params.length}`;
    if (perms.taskVisibility === 'department') {
        return `AND EXISTS (
            SELECT 1
            FROM employee_profiles ep_target
            JOIN employee_profiles ep_actor ON ep_actor.department = ep_target.department
            WHERE ep_target.user_id = users.id
              AND ep_actor.user_id = ${actorRef}
              AND ep_target.department IS NOT NULL
        )`;
    }
    return `AND users.id = ${actorRef}`;
}

async function listTaskOwnerCandidates(options = {}) {
    const query = options.pool || pool;
    const params = [ASSIGNABLE_TASK_ROLES];
    const scope = ownerCandidateScopeSql(options.actor, params);
    const result = await query.query(
        `SELECT id, username, name, role
         FROM users
         WHERE COALESCE(is_active, true) = true
           AND role = ANY($1::text[])
           ${scope}
         ORDER BY COALESCE(NULLIF(name, ''), username), id
         LIMIT 200`,
        params
    );
    return result.rows.map(row => ({
        id: row.id,
        username: row.username,
        name: row.name || null,
        role: row.role || null,
        label: row.name || row.username || `User #${row.id}`
    }));
}

async function getAssignableTaskOwner(ownerUserId, options = {}) {
    const id = parsePositiveInt(ownerUserId);
    if (!id) {
        const err = new Error('ownerUserId must be a valid user id');
        err.statusCode = 400;
        err.code = 'INVALID_TASK_OWNER';
        throw err;
    }
    const query = options.pool || pool;
    const params = [id, ASSIGNABLE_TASK_ROLES];
    const scope = ownerCandidateScopeSql(options.actor, params);
    const result = await query.query(
        `SELECT id, username, name, role
         FROM users
         WHERE users.id = $1
           AND COALESCE(is_active, true) = true
           AND role = ANY($2::text[])
           ${scope}
         LIMIT 1`,
        params
    );
    if (!result.rows.length) {
        const err = new Error('Task owner is not active or assignable');
        err.statusCode = 400;
        err.code = 'TASK_OWNER_NOT_ASSIGNABLE';
        throw err;
    }
    const row = result.rows[0];
    return {
        id: row.id,
        username: row.username,
        name: row.name || null,
        role: row.role || null,
        label: row.name || row.username || `User #${row.id}`
    };
}

async function getVisibleTask(taskId, user, options = {}) {
    const id = parsePositiveInt(taskId);
    if (!id) {
        const err = new Error('Valid taskId is required');
        err.statusCode = 400;
        err.code = 'INVALID_TASK_ID';
        throw err;
    }
    const params = [id];
    const visibility = buildTaskVisibilityScope(user, params, 't');
    const businessScope = options.businessScope || options.businessContext || null;
    const businessCondition = businessScope ? appendTaskBusinessScopeSql(params, businessScope, 't') : '';
    const query = options.pool || pool;
    const result = await query.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username, u.role AS owner_role
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE t.id = $1
           ${visibility}
           ${businessCondition}
         LIMIT 1`,
        params
    );
    if (!result.rows.length) {
        const err = new Error('Task not found or not visible');
        err.statusCode = 404;
        err.code = 'TASK_NOT_VISIBLE';
        throw err;
    }
    return normalizeTaskRow(result.rows[0]);
}

async function completeTask(taskId, actor, options = {}) {
    return withTaskExecutionTransaction(options, async query => {
        const task = await getVisibleTask(taskId, actor, { pool: query, businessScope: options.businessScope || options.businessContext });
        if (!canMutateTask(actor, task)) {
            throw forbidden('You cannot complete this task');
        }
        const subtaskState = await getParentSubtaskCompletionState(query, task.id);
        if (!subtaskState.canCompleteParent) {
            throw subtaskCompletionRequiredError(task, subtaskState);
        }
        const incomingReportId = parsePositiveInt(options.reportId || options.report_id);
        const existingReportId = taskCompletionReportId(task);
        const requiresReport = taskRequiresCompletionReport(task);
        if (requiresReport && !existingReportId && !incomingReportId) {
            throw reportRequiredError(task);
        }
        const reportId = incomingReportId ? await ensureReportExists(query, incomingReportId, task.business_context) : existingReportId;
        const result = await query.query(
            `UPDATE tasks
             SET status = 'done',
                  workflow_state = 'done',
                  schedule_status = CASE WHEN scheduled_start_at IS NOT NULL THEN 'completed' ELSE schedule_status END,
                  completed_at = NOW(),
                 updated_at = NOW(),
                 escalation_level = 0,
                 control_meta = CASE
                    WHEN $3::int IS NULL THEN COALESCE(control_meta, '{}'::jsonb)
                    ELSE COALESCE(control_meta, '{}'::jsonb) || jsonb_build_object(
                        'reportRequired', true,
                        'reportId', $3::int,
                        'reportSubmittedAt', NOW(),
                        'reportSubmittedBy', $4::text
                    )
                 END,
             version = COALESCE(version, 1) + 1
         WHERE id = $1
           AND COALESCE(version, 1) = $2
           AND COALESCE(business_context, 'event_genix') = $5
           AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')
         RETURNING *`,
            [task.id, task.version || 1, reportId || null, userDisplayName(actor), task.business_context || 'event_genix']
        );
        if (!result.rows.length) {
            const err = new Error('Task is already closed or cannot be completed');
            err.statusCode = 409;
            err.code = 'TASK_NOT_ACTIVE';
            throw err;
        }
        const updated = normalizeTaskRow(result.rows[0]);
        const historyEvent = await logTaskActionEvent({
            taskId: task.id,
            actionType: TASK_ACTION_TYPES.COMPLETED,
            actor,
            sourceSurface: sourceSurface(options.sourceSurface),
            oldValue: taskValue(task),
            newValue: taskValue(updated),
            meta: {
                route: options.route || 'work_queue_task_done',
                ownerStateBefore: task.ownerState,
                actorName: userDisplayName(actor),
                reportRequired: requiresReport,
                reportId: reportId || null
            }
        }, { pool: query });
        return { task: updated, historyEvent };
    });
}

function normalizeTaskStatusForExecution(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (['todo', 'in_progress'].includes(normalized)) return normalized;
    const err = new Error('Status must be todo or in_progress. Use completeTask for done.');
    err.statusCode = 400;
    err.code = 'INVALID_TASK_STATUS';
    throw err;
}

async function updateTaskStatus(taskId, status, actor, options = {}) {
    const targetStatus = normalizeTaskStatusForExecution(status);
    return withTaskExecutionTransaction(options, async query => {
        const task = await getVisibleTask(taskId, actor, { pool: query, businessScope: options.businessScope || options.businessContext });
        if (!canMutateTask(actor, task)) {
            throw forbidden('You cannot update this task status');
        }
        const currentStatus = String(task.status || 'todo').trim().toLowerCase();
        if (['done', 'completed', 'cancelled', 'canceled', 'archived'].includes(currentStatus)) {
            const err = new Error('Task is already closed or cannot be updated');
            err.statusCode = 409;
            err.code = 'TASK_NOT_ACTIVE';
            throw err;
        }
        if (currentStatus === targetStatus) {
            const updated = normalizeTaskRow(task);
            return { task: updated, historyEvent: null, unchanged: true };
        }
        const result = await query.query(
            `UPDATE tasks
             SET status = $2::text,
                 workflow_state = CASE WHEN $2::text = 'in_progress' THEN 'in_progress' ELSE COALESCE(NULLIF(workflow_state, 'done'), 'todo') END,
                 schedule_status = CASE WHEN scheduled_start_at IS NOT NULL AND schedule_status = 'completed' THEN 'scheduled' ELSE schedule_status END,
                 completed_at = NULL,
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $1
               AND COALESCE(version, 1) = $3
               AND COALESCE(business_context, 'event_genix') = $4
               AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')
             RETURNING *`,
            [task.id, targetStatus, task.version || 1, task.business_context || 'event_genix']
        );
        if (!result.rows.length) {
            const err = new Error('Task was changed by another user or is already closed');
            err.statusCode = 409;
            err.code = 'TASK_STALE_WRITE';
            throw err;
        }
        const updated = normalizeTaskRow(result.rows[0]);
        const historyEvent = await logTaskActionEvent({
            taskId: task.id,
            actionType: TASK_ACTION_TYPES.STATUS_CHANGED,
            actor,
            sourceSurface: sourceSurface(options.sourceSurface),
            oldValue: { status: currentStatus },
            newValue: { status: targetStatus },
            meta: {
                route: options.route || 'work_queue_task_status',
                ownerStateBefore: task.ownerState,
                canonicalField: 'tasks.status'
            }
        }, { pool: query });
        return { task: updated, historyEvent, unchanged: false };
    });
}

async function actorRetainsTaskObserverAccess(taskId, actor, options = {}) {
    const actorId = normalizeUserId(actor);
    if (!actorId) return false;
    const query = options.pool || pool;
    const result = await query.query(
        `SELECT 1
         FROM task_observers
         WHERE task_id = $1
           AND user_id = $2
         LIMIT 1`,
        [taskId, actorId]
    );
    return result.rows.length > 0;
}

async function assertPrivateTaskHandoffConfirmed(task, nextOwner, actor, options = {}) {
    if (!isPrivateTaskVisibility(task)) return;
    const actorRetainsObserverAccess = await actorRetainsTaskObserverAccess(task.id, actor, options);
    if (!privateTaskHandoffNeedsConfirmation(task, actor, nextOwner?.id, actorRetainsObserverAccess)) return;
    if (options.confirmPrivateHandoff === true) return;

    const err = new Error('This private task will be transferred and you will lose access. Confirm the handoff to continue.');
    err.statusCode = 409;
    err.code = 'TASK_PRIVATE_HANDOFF_CONFIRM_REQUIRED';
    err.meta = {
        privateHandoff: {
            confirmationRequired: true,
            actorWillLoseAccess: true,
            visibility: String(task.visibility || '').trim().toLowerCase(),
            nextOwner: {
                id: nextOwner?.id || null,
                label: nextOwner?.label || nextOwner?.name || nextOwner?.username || null
            }
        }
    };
    throw err;
}

async function reassignTaskOwner(taskId, ownerUserId, actor, options = {}) {
    return withTaskExecutionTransaction(options, async query => {
        const task = await getVisibleTask(taskId, actor, { pool: query, businessScope: options.businessScope || options.businessContext });
        if (!canReassignTask(actor, task)) {
            throw forbidden('You cannot reassign this task');
        }
        const owner = await getAssignableTaskOwner(ownerUserId, { pool: query, actor });
        if (Number(task.owner_user_id || 0) === Number(owner.id)) {
            const err = new Error('Task already has this owner');
            err.statusCode = 409;
            err.code = 'TASK_OWNER_UNCHANGED';
            throw err;
        }
        await assertPrivateTaskHandoffConfirmed(task, owner, actor, { pool: query, confirmPrivateHandoff: options.confirmPrivateHandoff === true });
        const result = await query.query(
            `UPDATE tasks
             SET owner_user_id = $2,
                 assigned_to = $3,
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $1
               AND COALESCE(version, 1) = $4
               AND COALESCE(business_context, 'event_genix') = $5
             RETURNING *`,
            [task.id, owner.id, owner.label, task.version || 1, task.business_context || 'event_genix']
        );
        if (!result.rows.length) {
            const err = new Error('Task was changed by another user');
            err.statusCode = 409;
            err.code = 'TASK_STALE_WRITE';
            throw err;
        }
        const updated = normalizeTaskRow({ ...result.rows[0], owner_name: owner.name, owner_username: owner.username });
        const historyEvent = await logTaskActionEvent({
            taskId: task.id,
            actionType: TASK_ACTION_TYPES.OWNER_REASSIGNED,
            actor,
            sourceSurface: sourceSurface(options.sourceSurface),
            oldValue: {
                ownerUserId: task.owner_user_id || null,
                assignedTo: task.assigned_to || null,
                owner: task.owner || null
            },
            newValue: {
                ownerUserId: owner.id,
                assignedTo: owner.label,
                owner: updated.owner || null
            },
            meta: {
                route: options.route || 'work_queue_task_owner',
                ownerStateBefore: task.ownerState,
                canonicalField: 'tasks.owner_user_id'
            }
        }, { pool: query });
        return { task: updated, owner, historyEvent };
    });
}

module.exports = {
    ASSIGNABLE_TASK_ROLES,
    assertPrivateTaskHandoffConfirmed,
    completeTask,
    getAssignableTaskOwner,
    getVisibleTask,
    listTaskOwnerCandidates,
    taskCompletionReportId,
    taskControlMeta,
    taskRequiresCompletionReport,
    reassignTaskOwner,
    resolveDeadline,
    rescheduleTask: canonicalRescheduleTask,
    updateTaskStatus
};
