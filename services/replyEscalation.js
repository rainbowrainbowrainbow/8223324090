'use strict';

const { pool: defaultPool } = require('../db');
const { getKyivDateStr } = require('./booking');
const { createLogger } = require('../utils/logger');
const { REPLY_SLA_STATES, deriveReplySlaState } = require('./replySla');
const {
    DEFAULT_TASK_BUSINESS_CONTEXT,
    activeTaskBusinessContext
} = require('./taskBusinessScope');
const { emitTaskAssignedToOwner } = require('./taskNotifications');

const log = createLogger('ReplyEscalation');

const REPLY_ESCALATION_SOURCE_TYPE = 'conversation_reply';
const REPLY_ESCALATION_CREATED_BY = 'reply_auto_escalation';
const ACTIVE_TASK_STATUS_SQL = "COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')";

function isoValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function taskAnchor(row) {
    const id = row?.reply_expected_message_id;
    if (!id) return null;
    return String(id);
}

function taskAssignee(row) {
    return row?.reply_owner || row?.assigned_to || null;
}

function conversationName(row) {
    return row?.customer_name || row?.customer_phone || `Conversation #${row?.conversation_id || 'unknown'}`;
}

function taskDescription(row) {
    return [
        `Reply expectation is overdue for Omni conversation #${row.conversation_id}.`,
        row.channel ? `Channel: ${row.channel}` : null,
        row.customer_phone ? `Customer phone: ${row.customer_phone}` : null,
        row.awaiting_reply_since ? `Waiting since: ${isoValue(row.awaiting_reply_since)}` : null,
        row.reply_sla_at ? `Reply SLA: ${isoValue(row.reply_sla_at)}` : null,
        row.reply_expected_message_id ? `Reply anchor message: ${row.reply_expected_message_id}` : null,
        row.reply_owner_user_id ? `Reply owner user id: ${row.reply_owner_user_id}` : null,
        'This is separate from callback_due and follow_up_due.'
    ].filter(Boolean).join('\n');
}

function normalizeLimit(limit) {
    return Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
}

function rowBusinessContext(row = {}) {
    return activeTaskBusinessContext(row.business_context || row.businessContext || DEFAULT_TASK_BUSINESS_CONTEXT);
}

function optionalBusinessCondition(params, businessContext, alias = '') {
    if (!businessContext) return '';
    params.push(activeTaskBusinessContext(businessContext));
    const column = alias ? `${alias}.business_context` : 'business_context';
    return ` AND COALESCE(${column}, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $${params.length}`;
}

async function logTaskAction(db, taskId, action, newValue) {
    if (!taskId) return;
    try {
        await db.query(
            'INSERT INTO task_logs (task_id, action, old_value, new_value, actor) VALUES ($1,$2,$3,$4,$5)',
            [taskId, action, null, newValue || null, REPLY_ESCALATION_CREATED_BY]
        );
    } catch (err) {
        log.warn(`Reply escalation task log skipped: ${err.message}`);
    }
}

async function closeReplyEscalationForMessage(messageId, options = {}) {
    const sourceId = messageId ? String(messageId) : null;
    if (!sourceId) return [];

    const db = options.pool || defaultPool;
    const reason = options.reason || 'reply_expectation_cleared';
    const params = [REPLY_ESCALATION_SOURCE_TYPE, sourceId];
    const businessCondition = optionalBusinessCondition(params, options.businessContext, '');
    const result = await db.query(
        `UPDATE tasks
            SET status = 'cancelled',
                completed_at = NULL,
                updated_at = NOW()
          WHERE source_type = $1
            AND source_id = $2
            AND ${ACTIVE_TASK_STATUS_SQL}
            ${businessCondition}
          RETURNING *`,
        params
    );

    for (const task of result.rows || []) {
        await logTaskAction(db, task.id, 'cancelled_reply_escalation', reason);
    }

    return result.rows || [];
}

async function updateActiveReplyEscalationTaskForMessage(messageId, updates = {}, options = {}) {
    const sourceId = messageId ? String(messageId) : null;
    if (!sourceId) return [];

    const setSql = [];
    const params = [REPLY_ESCALATION_SOURCE_TYPE, sourceId];
    if (Object.prototype.hasOwnProperty.call(updates, 'assignee')) {
        params.push(updates.assignee || null);
        setSql.push(`assigned_to = $${params.length}`);
        params.push(updates.assignee || null);
        setSql.push(`owner = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'ownerUserId')) {
        params.push(updates.ownerUserId || null);
        setSql.push(`owner_user_id = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'deadline')) {
        params.push(updates.deadline || null);
        setSql.push(`deadline = $${params.length}::timestamp`);
    }
    if (!setSql.length) return [];

    const db = options.pool || defaultPool;
    const reason = options.reason || 'reply_escalation_synced';
    const businessCondition = optionalBusinessCondition(params, options.businessContext, '');
    const result = await db.query(
        `UPDATE tasks
            SET ${setSql.join(', ')},
                updated_at = NOW()
          WHERE source_type = $1
            AND source_id = $2
            AND ${ACTIVE_TASK_STATUS_SQL}
            ${businessCondition}
          RETURNING *`,
        params
    );

    for (const task of result.rows || []) {
        await logTaskAction(db, task.id, 'updated_reply_escalation', reason);
    }

    return result.rows || [];
}

async function closeStaleReplyEscalationTasks(options = {}) {
    const db = options.pool || defaultPool;
    const limit = normalizeLimit(options.limit || 50);
    const result = await db.query(
        `WITH stale AS (
            SELECT t.id
            FROM tasks t
            LEFT JOIN conversation_messages cm
              ON cm.id::text = t.source_id
            LEFT JOIN conversations c
              ON c.reply_expected_message_id = cm.id
             AND c.reply_expected IS TRUE
             AND COALESCE(c.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = COALESCE(t.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}')
            WHERE t.source_type = $1
              AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
              AND (
                   cm.id IS NULL
                OR c.id IS NULL
                OR c.awaiting_reply_since IS NULL
                OR c.reply_sla_at IS NULL
                OR COALESCE(c.status, 'open') IN ('closed', 'spam')
                OR (c.last_inbound_at IS NOT NULL AND c.last_inbound_at > c.awaiting_reply_since)
                OR COALESCE(cm.delivery_status, '') IN ('failed', 'later_failed')
              )
            ORDER BY t.updated_at ASC NULLS FIRST, t.id ASC
            LIMIT $2
        )
        UPDATE tasks t
           SET status = 'cancelled',
               completed_at = NULL,
               updated_at = NOW()
          FROM stale
         WHERE t.id = stale.id
         RETURNING t.*`,
        [REPLY_ESCALATION_SOURCE_TYPE, limit]
    );

    for (const task of result.rows || []) {
        await logTaskAction(db, task.id, 'cancelled_reply_escalation', 'stale_reply_expectation');
    }

    return result.rows || [];
}

async function findOverdueReplyExpectations(options = {}) {
    const db = options.pool || defaultPool;
    const now = isoValue(options.now) || new Date().toISOString();
    const limit = normalizeLimit(options.limit || 20);

    const result = await db.query(
        `SELECT c.id AS conversation_id, c.channel, c.customer_name, c.customer_phone,
                c.customer_id, c.assigned_to, c.reply_expected, c.awaiting_reply_since,
                c.reply_expected_message_id, c.reply_owner, c.reply_owner_user_id, c.reply_sla_at,
                c.last_inbound_at, c.last_outbound_at,
                COALESCE(c.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') AS business_context,
                cm.delivery_status AS reply_expected_delivery_status,
                cm.delivery_error AS reply_expected_delivery_error,
                cust.lead_id
           FROM conversations c
           JOIN conversation_messages cm ON cm.id = c.reply_expected_message_id
           LEFT JOIN customers cust ON cust.id = c.customer_id
            AND COALESCE(cust.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = COALESCE(c.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}')
          WHERE c.reply_expected IS TRUE
            AND c.awaiting_reply_since IS NOT NULL
            AND c.reply_expected_message_id IS NOT NULL
            AND c.reply_sla_at IS NOT NULL
            AND c.reply_sla_at <= $1::timestamp
            AND COALESCE(c.status, 'open') NOT IN ('closed', 'spam')
            AND (c.last_inbound_at IS NULL OR c.last_inbound_at <= c.awaiting_reply_since)
            AND COALESCE(cm.delivery_status, '') NOT IN ('failed', 'later_failed')
          ORDER BY c.reply_sla_at ASC, c.awaiting_reply_since ASC
          LIMIT $2`,
        [now, limit]
    );

    return (result.rows || []).filter(row => (
        deriveReplySlaState(row, { now }) === REPLY_SLA_STATES.OVERDUE
    ));
}

async function createOrReuseReplyEscalationTask(row, options = {}) {
    const db = options.pool || defaultPool;
    const sourceId = taskAnchor(row);
    if (!sourceId) {
        return { task: null, created: false, skipped: true, reason: 'missing_reply_expected_message_id' };
    }

    const now = isoValue(options.now) || new Date().toISOString();
    if (deriveReplySlaState(row, { now }) !== REPLY_SLA_STATES.OVERDUE) {
        return { task: null, created: false, skipped: true, reason: 'not_overdue' };
    }

    const assignee = taskAssignee(row);
    const date = options.today || getKyivDateStr();
    const businessContext = rowBusinessContext(row);
    const title = `Прострочена відповідь: ${conversationName(row)}`;
    const description = taskDescription(row);
    const result = await db.query(
        `WITH inserted AS (
            INSERT INTO tasks (
                business_context, title, description, date, status, priority, assigned_to, owner, owner_user_id, created_by,
                task_type, deadline, source_type, source_id, category, type
            )
            SELECT $1, $2, $3, $4, 'todo', 'high', $5, $6, $7, $8,
                   'human', $9::timestamp, $10, $11, 'admin', 'auto'
            WHERE NOT EXISTS (
                SELECT 1
                FROM tasks
                WHERE source_type = $10
                  AND source_id = $11
                  AND COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $1
            )
            ON CONFLICT (source_id)
                WHERE source_type = 'conversation_reply'
                  AND source_id IS NOT NULL
            DO NOTHING
            RETURNING *, true AS created
        )
        SELECT *, true AS created
        FROM inserted
        UNION ALL
        SELECT t.*, false AS created
        FROM tasks t
        WHERE t.source_type = $10
          AND t.source_id = $11
          AND COALESCE(t.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $1
          AND NOT EXISTS (SELECT 1 FROM inserted)
        ORDER BY created DESC, id DESC
        LIMIT 1`,
        [
            businessContext,
            title,
            description,
            date,
            assignee,
            assignee,
            row.reply_owner_user_id || null,
            REPLY_ESCALATION_CREATED_BY,
            row.reply_sla_at,
            REPLY_ESCALATION_SOURCE_TYPE,
            sourceId
        ]
    );

    const task = result.rows?.[0] || null;
    const created = task?.created === true || task?.created === 't' || task?.created === 1;
    if (created) {
        await logTaskAction(db, task.id, 'created', `reply escalation for message ${sourceId}`);
        emitTaskAssignedToOwner(task, { username: REPLY_ESCALATION_CREATED_BY }, {
            assignmentEvent: 'created',
            source: 'services/replyEscalation'
        });
    }

    return { task, created, skipped: false, reason: created ? 'created' : 'reused' };
}

async function findActiveReplyExpectationByConversation(conversationId, options = {}) {
    const parsedId = Number(conversationId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
        const err = new Error('Valid conversationId is required');
        err.statusCode = 400;
        err.code = 'INVALID_CONVERSATION_ID';
        throw err;
    }

    const db = options.pool || defaultPool;
    const result = await db.query(
        `SELECT c.id AS conversation_id, c.channel, c.customer_name, c.customer_phone,
                c.customer_id, c.assigned_to, c.reply_expected, c.awaiting_reply_since,
                c.reply_expected_message_id, c.reply_owner, c.reply_owner_user_id, c.reply_sla_at,
                c.last_inbound_at, c.last_outbound_at,
                COALESCE(c.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') AS business_context,
                cm.delivery_status AS reply_expected_delivery_status,
                cm.delivery_error AS reply_expected_delivery_error,
                cust.lead_id
           FROM conversations c
           JOIN conversation_messages cm ON cm.id = c.reply_expected_message_id
           LEFT JOIN customers cust ON cust.id = c.customer_id
            AND COALESCE(cust.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = COALESCE(c.business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}')
          WHERE c.id = $1
            AND c.reply_expected IS TRUE
            AND c.awaiting_reply_since IS NOT NULL
            AND c.reply_expected_message_id IS NOT NULL
            AND COALESCE(c.status, 'open') NOT IN ('closed', 'spam')
            AND (c.last_inbound_at IS NULL OR c.last_inbound_at <= c.awaiting_reply_since)
            AND COALESCE(cm.delivery_status, '') NOT IN ('failed', 'later_failed')
          LIMIT 1`,
        [parsedId]
    );

    const row = result.rows?.[0] || null;
    if (!row) {
        const err = new Error('Active reply expectation was not found for this conversation');
        err.statusCode = 404;
        err.code = 'REPLY_EXPECTATION_NOT_ACTIVE';
        throw err;
    }
    return row;
}

async function escalateReplyExpectationForConversation(conversationId, options = {}) {
    const db = options.pool || defaultPool;
    const row = await findActiveReplyExpectationByConversation(conversationId, { pool: db });
    const now = isoValue(options.now) || new Date().toISOString();
    const result = await createOrReuseReplyEscalationTask(row, {
        pool: db,
        now,
        today: options.today
    });

    if (result.skipped) {
        const err = new Error(result.reason === 'not_overdue'
            ? 'Reply expectation is not overdue yet'
            : 'Reply expectation cannot be escalated');
        err.statusCode = result.reason === 'not_overdue' ? 409 : 400;
        err.code = result.reason === 'not_overdue' ? 'REPLY_NOT_OVERDUE' : 'REPLY_ESCALATION_SKIPPED';
        err.reason = result.reason;
        throw err;
    }

    return result;
}

async function runReplyAutoEscalation(options = {}) {
    const db = options.pool || defaultPool;
    const closed = await closeStaleReplyEscalationTasks({
        pool: db,
        limit: options.closeLimit || 50
    });
    const overdue = await findOverdueReplyExpectations({
        pool: db,
        now: options.now,
        limit: options.limit || 20
    });

    const escalations = [];
    for (const row of overdue) {
        escalations.push(await createOrReuseReplyEscalationTask(row, {
            pool: db,
            now: options.now,
            today: options.today
        }));
    }

    return {
        checked: overdue.length,
        created: escalations.filter(item => item.created).length,
        reused: escalations.filter(item => !item.created && !item.skipped).length,
        skipped: escalations.filter(item => item.skipped).length,
        closed: closed.length,
        escalations,
        closedTasks: closed
    };
}

module.exports = {
    REPLY_ESCALATION_SOURCE_TYPE,
    REPLY_ESCALATION_CREATED_BY,
    taskAnchor,
    findOverdueReplyExpectations,
    findActiveReplyExpectationByConversation,
    createOrReuseReplyEscalationTask,
    escalateReplyExpectationForConversation,
    closeReplyEscalationForMessage,
    updateActiveReplyEscalationTaskForMessage,
    closeStaleReplyEscalationTasks,
    runReplyAutoEscalation
};
