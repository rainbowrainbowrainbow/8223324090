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
        const result = await runBulkReplyAction(conversationIds, conversationId =>
            reassignReplyExpectationOwner(conversationId, ownerUserId)
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
        const result = await runBulkReplyAction(conversationIds, conversationId =>
            updateReplyExpectationSla(conversationId, replySlaAt)
        );
        res.json({ ...result, action: 'reply_sla_bulk_move', replySlaAt });
    } catch (err) {
        sendReplyActionError(res, err);
    }
});

router.post('/replies/bulk/clear', async (req, res) => {
    try {
        const conversationIds = parseConversationIds(req.body?.conversationIds || req.body?.conversation_ids);
        const result = await runBulkReplyAction(conversationIds, conversationId =>
            clearReplyExpectation(conversationId)
        );
        res.json({ ...result, action: 'reply_expectation_bulk_clear' });
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
        const result = await reassignReplyExpectationOwner(conversationId, req.body?.ownerUserId ?? req.body?.owner_user_id);
        res.json({ success: true, conversation: result.conversation, owner: result.owner });
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
        const conversation = await updateReplyExpectationSla(conversationId, replySlaAt);
        res.json({ success: true, conversation });
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
        const conversation = await clearReplyExpectation(conversationId);
        res.json({ success: true, conversation });
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
