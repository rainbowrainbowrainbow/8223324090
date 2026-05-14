const { pool: defaultPool } = require('../db');

const REPLY_ACTION_TYPES = Object.freeze({
    EXPECTATION_CLEARED: 'reply_expectation_cleared',
    SLA_SNOOZED: 'reply_sla_snoozed',
    OWNER_REASSIGNED: 'reply_owner_reassigned',
    ESCALATED: 'reply_escalated',
    ESCALATION_CLOSED: 'reply_escalation_closed',
});

const DEFAULT_SOURCE_SURFACE = 'manager_queue_execution_v6';
const MAX_HISTORY_LIMIT = 50;

function parsePositiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeActor(actor = {}) {
    const userId = parsePositiveInt(actor.id || actor.userId || actor.user_id);
    const name = String(actor.name || actor.username || actor.email || '').trim();
    return {
        userId,
        nameSnapshot: name || null,
    };
}

function toJsonParam(value) {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}

function parseJsonValue(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

function normalizeLimit(limit) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed <= 0) return 10;
    return Math.min(parsed, MAX_HISTORY_LIMIT);
}

function summaryForAction(actionType) {
    switch (actionType) {
        case REPLY_ACTION_TYPES.EXPECTATION_CLEARED:
            return 'Reply expectation cleared';
        case REPLY_ACTION_TYPES.SLA_SNOOZED:
            return 'Reply SLA moved';
        case REPLY_ACTION_TYPES.OWNER_REASSIGNED:
            return 'Reply owner reassigned';
        case REPLY_ACTION_TYPES.ESCALATED:
            return 'Reply escalation created or reused';
        case REPLY_ACTION_TYPES.ESCALATION_CLOSED:
            return 'Reply escalation closed';
        default:
            return 'Reply execution action recorded';
    }
}

function mapSnapshotRow(row = {}) {
    if (!row || !row.conversation_id) return null;
    return {
        conversationId: row.conversation_id,
        replyExpected: row.reply_expected === true || row.reply_expected === 't',
        awaitingReplySince: row.awaiting_reply_since || null,
        replyExpectedMessageId: row.reply_expected_message_id || null,
        replyOwner: row.reply_owner || null,
        replyOwnerUserId: row.reply_owner_user_id || null,
        replySlaAt: row.reply_sla_at || null,
        replyEscalationTaskId: row.reply_escalation_task_id || null,
        replyEscalationStatus: row.reply_escalation_status || null,
        lastInboundAt: row.last_inbound_at || null,
        updatedAt: row.updated_at || null,
    };
}

async function getReplyActionSnapshot(conversationId, options = {}) {
    const conversationRef = parsePositiveInt(conversationId);
    if (!conversationRef) {
        const err = new Error('Valid conversationId is required');
        err.statusCode = 400;
        err.code = 'INVALID_CONVERSATION_ID';
        throw err;
    }

    const db = options.pool || defaultPool;
    const result = await db.query(
        `SELECT c.id AS conversation_id,
                c.reply_expected,
                c.awaiting_reply_since,
                c.reply_expected_message_id,
                c.reply_owner,
                c.reply_owner_user_id,
                c.reply_sla_at,
                c.last_inbound_at,
                c.updated_at,
                rt.id AS reply_escalation_task_id,
                rt.status AS reply_escalation_status
           FROM conversations c
           LEFT JOIN tasks rt
             ON rt.source_type = 'conversation_reply'
            AND rt.source_id = c.reply_expected_message_id::text
            AND COALESCE(rt.status, 'todo') NOT IN ('done','cancelled','archived')
          WHERE c.id = $1
          LIMIT 1`,
        [conversationRef]
    );

    return mapSnapshotRow(result.rows?.[0] || null);
}

function formatReplyActionEvent(row = {}) {
    const oldValue = parseJsonValue(row.old_value_json);
    const newValue = parseJsonValue(row.new_value_json);
    const meta = parseJsonValue(row.meta_json);
    return {
        id: row.id,
        conversationId: row.conversation_id,
        replyExpectedMessageId: row.reply_expected_message_id || null,
        actionType: row.action_type,
        createdAt: row.created_at,
        actor: {
            userId: row.actor_user_id || null,
            name: row.actor_name_snapshot || null,
        },
        sourceSurface: row.source_surface || null,
        summary: row.summary || summaryForAction(row.action_type),
        oldValue,
        newValue,
        meta,
    };
}

async function logReplyActionEvent(event = {}, options = {}) {
    const conversationRef = parsePositiveInt(event.conversationId);
    if (!conversationRef) {
        const err = new Error('Valid conversationId is required for reply action history');
        err.statusCode = 400;
        err.code = 'INVALID_CONVERSATION_ID';
        throw err;
    }

    if (!event.actionType || !Object.values(REPLY_ACTION_TYPES).includes(event.actionType)) {
        const err = new Error('Valid reply action type is required');
        err.statusCode = 400;
        err.code = 'INVALID_REPLY_ACTION_TYPE';
        throw err;
    }

    const actor = normalizeActor(event.actor || {});
    const db = options.pool || event.pool || defaultPool;
    const result = await db.query(
        `INSERT INTO reply_action_history (
            conversation_id,
            reply_expected_message_id,
            action_type,
            actor_user_id,
            actor_name_snapshot,
            source_surface,
            old_value_json,
            new_value_json,
            meta_json,
            summary
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
        RETURNING id, conversation_id, reply_expected_message_id, action_type,
                  actor_user_id, actor_name_snapshot, source_surface,
                  old_value_json, new_value_json, meta_json, summary, created_at`,
        [
            conversationRef,
            parsePositiveInt(event.replyExpectedMessageId),
            event.actionType,
            actor.userId,
            actor.nameSnapshot,
            event.sourceSurface || DEFAULT_SOURCE_SURFACE,
            toJsonParam(event.oldValue),
            toJsonParam(event.newValue),
            toJsonParam(event.meta),
            event.summary || summaryForAction(event.actionType),
        ]
    );

    return formatReplyActionEvent(result.rows?.[0] || {});
}

async function listReplyActionHistory(conversationId, options = {}) {
    const conversationRef = parsePositiveInt(conversationId);
    if (!conversationRef) {
        const err = new Error('Valid conversationId is required');
        err.statusCode = 400;
        err.code = 'INVALID_CONVERSATION_ID';
        throw err;
    }

    const limit = normalizeLimit(options.limit);
    const db = options.pool || defaultPool;
    const result = await db.query(
        `SELECT id, conversation_id, reply_expected_message_id, action_type,
                actor_user_id, actor_name_snapshot, source_surface,
                old_value_json, new_value_json, meta_json, summary, created_at
           FROM reply_action_history
          WHERE conversation_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2`,
        [conversationRef, limit]
    );

    return (result.rows || []).map(formatReplyActionEvent);
}

module.exports = {
    DEFAULT_SOURCE_SURFACE,
    REPLY_ACTION_TYPES,
    getReplyActionSnapshot,
    listReplyActionHistory,
    logReplyActionEvent,
    summaryForAction,
};
