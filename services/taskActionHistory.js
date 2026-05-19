const { pool } = require('../db');

const DEFAULT_TASK_SOURCE_SURFACE = 'manager_queue_task_execution_v2';

const TASK_ACTION_TYPES = Object.freeze({
    COMPLETED: 'task_completed',
    OWNER_REASSIGNED: 'task_owner_reassigned',
    RESCHEDULED: 'task_rescheduled',
    OBSERVERS_UPDATED: 'task_observers_updated'
});

function actorSnapshot(actor = {}) {
    const userId = Number(actor?.id || actor?.userId || 0);
    const name = String(actor?.name || actor?.username || '').trim();
    return {
        actorUserId: Number.isInteger(userId) && userId > 0 ? userId : null,
        actorNameSnapshot: name || null
    };
}

function jsonOrNull(value) {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}

function summaryForAction(actionType) {
    switch (actionType) {
        case TASK_ACTION_TYPES.COMPLETED:
            return 'Task completed';
        case TASK_ACTION_TYPES.OWNER_REASSIGNED:
            return 'Task owner reassigned';
        case TASK_ACTION_TYPES.RESCHEDULED:
            return 'Task rescheduled';
        case TASK_ACTION_TYPES.OBSERVERS_UPDATED:
            return 'Task observers updated';
        default:
            return 'Task execution action';
    }
}

function normalizeHistoryRow(row = {}) {
    return {
        id: row.id,
        taskId: row.task_id,
        actionType: row.action_type,
        actor: {
            userId: row.actor_user_id || null,
            name: row.actor_name_snapshot || null
        },
        sourceSurface: row.source_surface || null,
        oldValue: row.old_value_json || null,
        newValue: row.new_value_json || null,
        meta: row.meta_json || null,
        summary: row.summary || summaryForAction(row.action_type),
        createdAt: row.created_at ? (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)) : null
    };
}

async function logTaskActionEvent(event = {}, options = {}) {
    const taskId = Number(event.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
        throw new Error('taskId is required for task action history');
    }
    const actionType = String(event.actionType || '').trim();
    if (!Object.values(TASK_ACTION_TYPES).includes(actionType)) {
        throw new Error(`Unsupported task action type: ${actionType || 'missing'}`);
    }
    const actor = actorSnapshot(event.actor);
    const query = options.pool || pool;
    const result = await query.query(
        `INSERT INTO task_action_history (
            task_id, action_type, actor_user_id, actor_name_snapshot, source_surface,
            old_value_json, new_value_json, meta_json, summary
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)
         RETURNING *`,
        [
            taskId,
            actionType,
            actor.actorUserId,
            actor.actorNameSnapshot,
            event.sourceSurface || DEFAULT_TASK_SOURCE_SURFACE,
            jsonOrNull(event.oldValue),
            jsonOrNull(event.newValue),
            jsonOrNull(event.meta),
            event.summary || summaryForAction(actionType)
        ]
    );
    return normalizeHistoryRow(result.rows[0]);
}

async function listTaskActionHistory(taskId, options = {}) {
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Valid taskId is required');
    }
    const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
    const query = options.pool || pool;
    const result = await query.query(
        `SELECT *
         FROM task_action_history
         WHERE task_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [id, limit]
    );
    return result.rows.map(normalizeHistoryRow);
}

module.exports = {
    DEFAULT_TASK_SOURCE_SURFACE,
    TASK_ACTION_TYPES,
    listTaskActionHistory,
    logTaskActionEvent,
    summaryForAction
};
