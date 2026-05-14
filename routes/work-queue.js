/**
 * routes/work-queue.js — manager operational queue
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { buildWorkQueue } = require('../services/workQueue');
const {
    listReplyOwnerCandidates,
    reassignReplyExpectationOwner,
    clearReplyExpectation,
    updateReplyExpectationSla
} = require('../services/omni-hub');
const { escalateReplyExpectationForConversation } = require('../services/replyEscalation');
const {
    DEFAULT_SOURCE_SURFACE,
    REPLY_ACTION_TYPES,
    getReplyActionSnapshot,
    listReplyActionHistory,
    logReplyActionEvent
} = require('../services/replyActionHistory');
const { createLogger } = require('../utils/logger');

const log = createLogger('WorkQueue');

router.use(authenticateToken);
router.use(requireRole('manager'));

function parsePositiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseConversationIds(value) {
    const raw = Array.isArray(value) ? value : [];
    const ids = [];
    const seen = new Set();

    for (const item of raw) {
        const id = parsePositiveInt(item);
        if (!id || seen.has(id)) continue;
        ids.push(id);
        seen.add(id);
    }

    if (!ids.length || ids.length > 50) {
        const err = new Error('conversationIds must contain 1-50 valid ids');
        err.statusCode = 400;
        err.code = 'INVALID_CONVERSATION_IDS';
        throw err;
    }

    return ids;
}

function sendReplyActionError(res, err) {
    const status = err?.statusCode || 500;
    if (status >= 500) {
        log.error('Reply backlog action error', err);
    }
    res.status(status).json({
        success: false,
        error: err?.message || 'Не вдалося оновити reply backlog',
        code: err?.code || 'REPLY_BACKLOG_ACTION_FAILED'
    });
}

function resolveReplySlaAt(body = {}) {
    const direct = body.replySlaAt || body.reply_sla_at;
    if (direct) return direct;

    const rawMinutes = body.snoozeMinutes ?? body.snooze_minutes;
    const rawHours = body.snoozeHours ?? body.snooze_hours;
    const minutes = rawMinutes !== undefined
        ? Number(rawMinutes)
        : (rawHours !== undefined ? Number(rawHours) * 60 : null);

    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60 * 24 * 30) {
        const err = new Error('Valid replySlaAt or snoozeMinutes/snoozeHours is required');
        err.statusCode = 400;
        err.code = 'INVALID_REPLY_SLA_MOVE';
        throw err;
    }

    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function resolveSourceSurface(body = {}) {
    const value = String(body.sourceSurface || body.source_surface || '').trim();
    if (value === 'reply_operations_console_v2') return value;
    if (value === DEFAULT_SOURCE_SURFACE) return value;
    return DEFAULT_SOURCE_SURFACE;
}

function snapshotReplyValue(snapshot = {}) {
    return {
        replyExpected: snapshot.replyExpected === true,
        awaitingReplySince: snapshot.awaitingReplySince || null,
        replyExpectedMessageId: snapshot.replyExpectedMessageId || null,
        replyOwnerUserId: snapshot.replyOwnerUserId || null,
        replyOwner: snapshot.replyOwner || null,
        replySlaAt: snapshot.replySlaAt || null,
        replyEscalationTaskId: snapshot.replyEscalationTaskId || null,
        replyEscalationStatus: snapshot.replyEscalationStatus || null
    };
}

function conversationReplyValue(conversation = {}) {
    return {
        replyExpected: conversation.replyExpected === true,
        awaitingReplySince: conversation.awaitingReplySince || null,
        replyExpectedMessageId: conversation.replyExpectedMessageId || null,
        replyOwnerUserId: conversation.replyOwnerUserId || null,
        replyOwner: conversation.replyOwner || null,
        replySlaAt: conversation.replySlaAt || null
    };
}

async function performReplyOwnerReassign(conversationId, ownerUserId, actor, options = {}) {
    const before = await getReplyActionSnapshot(conversationId);
    const result = await reassignReplyExpectationOwner(conversationId, ownerUserId);
    const historyEvent = await logReplyActionEvent({
        conversationId,
        replyExpectedMessageId: before?.replyExpectedMessageId || result.conversation?.replyExpectedMessageId,
        actionType: REPLY_ACTION_TYPES.OWNER_REASSIGNED,
        actor,
        sourceSurface: options.sourceSurface,
        oldValue: {
            replyOwnerUserId: before?.replyOwnerUserId || null,
            replyOwner: before?.replyOwner || null
        },
        newValue: {
            replyOwnerUserId: result.conversation?.replyOwnerUserId || null,
            replyOwner: result.conversation?.replyOwner || null
        },
        meta: {
            route: options.route || 'work_queue_reply_owner',
            bulk: options.bulk === true,
            replyExpectedBefore: before?.replyExpected === true,
            escalationTaskId: before?.replyEscalationTaskId || null
        }
    });
    return { ...result, historyEvent };
}

async function performReplySlaMove(conversationId, replySlaAt, actor, options = {}) {
    const before = await getReplyActionSnapshot(conversationId);
    const conversation = await updateReplyExpectationSla(conversationId, replySlaAt);
    const historyEvent = await logReplyActionEvent({
        conversationId,
        replyExpectedMessageId: before?.replyExpectedMessageId || conversation?.replyExpectedMessageId,
        actionType: REPLY_ACTION_TYPES.SLA_SNOOZED,
        actor,
        sourceSurface: options.sourceSurface,
        oldValue: {
            replySlaAt: before?.replySlaAt || null
        },
        newValue: {
            replySlaAt: conversation?.replySlaAt || replySlaAt
        },
        meta: {
            route: options.route || 'work_queue_reply_sla',
            bulk: options.bulk === true,
            replyExpectedBefore: before?.replyExpected === true,
            escalationTaskId: before?.replyEscalationTaskId || null
        }
    });
    return { conversation, historyEvent };
}

async function performReplyClear(conversationId, actor, options = {}) {
    const before = await getReplyActionSnapshot(conversationId);
    const conversation = await clearReplyExpectation(conversationId);
    const historyEvents = [];
    const cleared = await logReplyActionEvent({
        conversationId,
        replyExpectedMessageId: before?.replyExpectedMessageId || null,
        actionType: REPLY_ACTION_TYPES.EXPECTATION_CLEARED,
        actor,
        sourceSurface: options.sourceSurface,
        oldValue: snapshotReplyValue(before),
        newValue: conversationReplyValue(conversation),
        meta: {
            route: options.route || 'work_queue_reply_clear',
            bulk: options.bulk === true,
            closedEscalationTaskId: before?.replyEscalationTaskId || null
        }
    });
    historyEvents.push(cleared);

    if (before?.replyEscalationTaskId) {
        const closed = await logReplyActionEvent({
            conversationId,
            replyExpectedMessageId: before.replyExpectedMessageId || null,
            actionType: REPLY_ACTION_TYPES.ESCALATION_CLOSED,
            actor,
            sourceSurface: options.sourceSurface,
            oldValue: {
                replyEscalationTaskId: before.replyEscalationTaskId,
                status: before.replyEscalationStatus || 'todo'
            },
            newValue: {
                replyEscalationTaskId: before.replyEscalationTaskId,
                status: 'cancelled'
            },
            meta: {
                route: options.route || 'work_queue_reply_clear',
                bulk: options.bulk === true,
                reason: 'reply_expectation_cleared'
            }
        });
        historyEvents.push(closed);
    }

    return { conversation, historyEvent: cleared, historyEvents };
}

async function performReplyEscalate(conversationId, actor, options = {}) {
    const before = await getReplyActionSnapshot(conversationId);
    const result = await escalateReplyExpectationForConversation(conversationId);
    const historyEvent = await logReplyActionEvent({
        conversationId,
        replyExpectedMessageId: before?.replyExpectedMessageId || result.task?.source_id,
        actionType: REPLY_ACTION_TYPES.ESCALATED,
        actor,
        sourceSurface: options.sourceSurface,
        oldValue: {
            replyEscalationTaskId: before?.replyEscalationTaskId || null
        },
        newValue: {
            replyEscalationTaskId: result.task?.id || null,
            taskStatus: result.task?.status || null
        },
        meta: {
            route: options.route || 'work_queue_reply_escalate',
            bulk: options.bulk === true,
            created: result.created === true,
            reused: result.created !== true,
            reason: result.reason || null,
            sourceType: result.task?.source_type || 'conversation_reply',
            sourceId: result.task?.source_id || null
        }
    });
    return { ...result, historyEvent };
}

async function runBulkReplyAction(conversationIds, handler) {
    const applied = [];
    const failed = [];

    for (const conversationId of conversationIds) {
        try {
            const result = await handler(conversationId);
            applied.push({ conversationId, result });
        } catch (err) {
            failed.push({
                conversationId,
                error: err?.message || 'Reply backlog action failed',
                code: err?.code || 'REPLY_BACKLOG_ACTION_FAILED',
                statusCode: err?.statusCode || 500
            });
        }
    }

    return {
        success: failed.length === 0,
        partial: applied.length > 0 && failed.length > 0,
        counts: {
            requested: conversationIds.length,
            applied: applied.length,
            failed: failed.length
        },
        applied,
        failed
    };
}

router.get('/reply-owners', async (req, res) => {
    try {
        const users = await listReplyOwnerCandidates();
        res.json({
            success: true,
            users,
            meta: {
                canonicalValue: 'users.id',
                displayField: 'name_or_username',
                inactiveUsers: 'excluded',
                labelFiltering: false
            }
        });
    } catch (err) {
        log.error('GET /work-queue/reply-owners error', err);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити відповідальних' });
    }
});

router.post('/replies/bulk/owner', async (req, res) => {
    try {
        const conversationIds = parseConversationIds(req.body?.conversationIds || req.body?.conversation_ids);
        const ownerUserId = req.body?.ownerUserId ?? req.body?.owner_user_id;
        const sourceSurface = resolveSourceSurface(req.body || {});
        const result = await runBulkReplyAction(conversationIds, conversationId =>
            performReplyOwnerReassign(conversationId, ownerUserId, req.user, {
                sourceSurface,
                bulk: true,
                route: 'work_queue_reply_bulk_owner'
            })
        );
        res.json({ ...result, action: 'reply_owner_bulk_reassign' });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.post('/replies/bulk/sla', async (req, res) => {
    try {
        const conversationIds = parseConversationIds(req.body?.conversationIds || req.body?.conversation_ids);
        const replySlaAt = resolveReplySlaAt(req.body || {});
        const sourceSurface = resolveSourceSurface(req.body || {});
        const result = await runBulkReplyAction(conversationIds, conversationId =>
            performReplySlaMove(conversationId, replySlaAt, req.user, {
                sourceSurface,
                bulk: true,
                route: 'work_queue_reply_bulk_sla'
            })
        );
        res.json({ ...result, action: 'reply_sla_bulk_move', replySlaAt });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.post('/replies/bulk/clear', async (req, res) => {
    try {
        const conversationIds = parseConversationIds(req.body?.conversationIds || req.body?.conversation_ids);
        const sourceSurface = resolveSourceSurface(req.body || {});
        const result = await runBulkReplyAction(conversationIds, conversationId =>
            performReplyClear(conversationId, req.user, {
                sourceSurface,
                bulk: true,
                route: 'work_queue_reply_bulk_clear'
            })
        );
        res.json({ ...result, action: 'reply_expectation_bulk_clear' });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.get('/replies/:conversationId/history', async (req, res) => {
    try {
        const conversationId = parsePositiveInt(req.params.conversationId);
        if (!conversationId) {
            return res.status(400).json({ success: false, error: 'Valid conversationId is required', code: 'INVALID_CONVERSATION_ID' });
        }
        const rawLimit = Number(req.query.limit);
        const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;
        const events = await listReplyActionHistory(conversationId, { limit });
        res.json({
            success: true,
            conversationId,
            events,
            meta: {
                source: 'reply_action_history',
                newestFirst: true,
                limit
            }
        });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.patch('/replies/:conversationId/owner', async (req, res) => {
    try {
        const conversationId = parsePositiveInt(req.params.conversationId);
        if (!conversationId) {
            return res.status(400).json({ success: false, error: 'Valid conversationId is required', code: 'INVALID_CONVERSATION_ID' });
        }
        const sourceSurface = resolveSourceSurface(req.body || {});
        const result = await performReplyOwnerReassign(
            conversationId,
            req.body?.ownerUserId ?? req.body?.owner_user_id,
            req.user,
            { sourceSurface }
        );
        res.json({ success: true, conversation: result.conversation, owner: result.owner, historyEvent: result.historyEvent });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.patch('/replies/:conversationId/sla', async (req, res) => {
    try {
        const conversationId = parsePositiveInt(req.params.conversationId);
        if (!conversationId) {
            return res.status(400).json({ success: false, error: 'Valid conversationId is required', code: 'INVALID_CONVERSATION_ID' });
        }
        const replySlaAt = resolveReplySlaAt(req.body || {});
        const sourceSurface = resolveSourceSurface(req.body || {});
        const result = await performReplySlaMove(conversationId, replySlaAt, req.user, { sourceSurface });
        res.json({ success: true, conversation: result.conversation, historyEvent: result.historyEvent });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.post('/replies/:conversationId/clear', async (req, res) => {
    try {
        const conversationId = parsePositiveInt(req.params.conversationId);
        if (!conversationId) {
            return res.status(400).json({ success: false, error: 'Valid conversationId is required', code: 'INVALID_CONVERSATION_ID' });
        }
        const sourceSurface = resolveSourceSurface(req.body || {});
        const result = await performReplyClear(conversationId, req.user, { sourceSurface });
        res.json({
            success: true,
            conversation: result.conversation,
            historyEvent: result.historyEvent,
            historyEvents: result.historyEvents
        });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.post('/replies/:conversationId/escalate', async (req, res) => {
    try {
        const conversationId = parsePositiveInt(req.params.conversationId);
        if (!conversationId) {
            return res.status(400).json({ success: false, error: 'Valid conversationId is required', code: 'INVALID_CONVERSATION_ID' });
        }
        const sourceSurface = resolveSourceSurface(req.body || {});
        const result = await performReplyEscalate(conversationId, req.user, { sourceSurface });
        res.json({
            success: true,
            action: 'reply_escalate_overdue',
            task: result.task,
            created: result.created,
            reused: !result.created,
            reason: result.reason,
            historyEvent: result.historyEvent
        });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.get('/', async (req, res) => {
    try {
        const queue = await buildWorkQueue({
            pool,
            user: req.user,
            limit: req.query.limit,
            replyScope: req.query.replyScope || req.query.reply_scope,
            replySla: req.query.replySla || req.query.reply_sla,
            replyOwner: req.query.replyOwner || req.query.reply_owner,
            replyEscalation: req.query.replyEscalation || req.query.reply_escalation
        });
        res.json({ success: true, queue });
    } catch (err) {
        log.error('GET /work-queue error', err);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити робочу чергу' });
    }
});

module.exports = router;
