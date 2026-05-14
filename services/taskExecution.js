const { pool } = require('../db');
const {
    buildTaskVisibilityScope,
    canMutateTask,
    canReassignTask,
    canRescheduleTask,
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

function normalizeTaskRow(row = {}) {
    return {
        ...row,
        ownerUserId: row.owner_user_id || null,
        ownerLabel: row.owner_label || row.owner_name || row.owner_username || row.assigned_to || row.owner || null,
        ownerState: taskOwnerState(row)
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
    if (raw === 'task_page') return raw;
    if (raw === 'task_detail') return raw;
    if (raw === DEFAULT_TASK_SOURCE_SURFACE) return raw;
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
    const query = options.pool || pool;
    const result = await query.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username, u.role AS owner_role
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE t.id = $1
           ${visibility}
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
        const task = await getVisibleTask(taskId, actor, { pool: query });
        if (!canMutateTask(actor, task)) {
            throw forbidden('You cannot complete this task');
        }
        const result = await query.query(
            `UPDATE tasks
             SET status = 'done',
                 completed_at = NOW(),
                 updated_at = NOW(),
                 escalation_level = 0,
             version = COALESCE(version, 1) + 1
         WHERE id = $1
           AND COALESCE(version, 1) = $2
           AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')
         RETURNING *`,
            [task.id, task.version || 1]
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
                actorName: userDisplayName(actor)
            }
        }, { pool: query });
        return { task: updated, historyEvent };
    });
}

async function reassignTaskOwner(taskId, ownerUserId, actor, options = {}) {
    return withTaskExecutionTransaction(options, async query => {
        const task = await getVisibleTask(taskId, actor, { pool: query });
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
        const result = await query.query(
            `UPDATE tasks
             SET owner_user_id = $2,
                 assigned_to = $3,
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $1
               AND COALESCE(version, 1) = $4
             RETURNING *`,
            [task.id, owner.id, owner.label, task.version || 1]
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

async function rescheduleTask(taskId, deadline, actor, options = {}) {
    return withTaskExecutionTransaction(options, async query => {
        const task = await getVisibleTask(taskId, actor, { pool: query });
        if (!canRescheduleTask(actor, task)) {
            throw forbidden('You cannot reschedule this task');
        }
        const result = await query.query(
            `UPDATE tasks
             SET deadline = $2,
                 updated_at = NOW(),
             version = COALESCE(version, 1) + 1
         WHERE id = $1
           AND COALESCE(version, 1) = $3
           AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')
         RETURNING *`,
            [task.id, deadline || null, task.version || 1]
        );
        if (!result.rows.length) {
            const err = new Error('Task is already closed or cannot be rescheduled');
            err.statusCode = 409;
            err.code = 'TASK_NOT_ACTIVE';
            throw err;
        }
        const updated = normalizeTaskRow(result.rows[0]);
        const historyEvent = await logTaskActionEvent({
            taskId: task.id,
            actionType: TASK_ACTION_TYPES.RESCHEDULED,
            actor,
            sourceSurface: sourceSurface(options.sourceSurface),
            oldValue: {
                deadline: task.deadline || null,
                date: task.date || null
            },
            newValue: {
                deadline: updated.deadline || null,
                date: updated.date || null
            },
            meta: {
                route: options.route || 'work_queue_task_reschedule',
                ownerStateBefore: task.ownerState,
                canonicalField: 'tasks.deadline'
            }
        }, { pool: query });
        return { task: updated, historyEvent };
    });
}

module.exports = {
    ASSIGNABLE_TASK_ROLES,
    completeTask,
    getAssignableTaskOwner,
    getVisibleTask,
    listTaskOwnerCandidates,
    reassignTaskOwner,
    resolveDeadline,
    rescheduleTask
};
