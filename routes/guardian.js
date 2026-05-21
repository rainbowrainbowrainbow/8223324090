/**
 * routes/guardian.js — Guardian AI Agent API
 *
 * Endpoints for guardian reports, actions, and management.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const {
    generateDailyReport, runDailyReports, ensureGuardianMemberships,
    getMood, getGuardianState, clearMuteCache,
    setEmergencyStop, getEmergencyStop,
    getChannelSettings, invalidateChannelSettingsCache,
    alertDirectorTelegram
} = require('../services/guardian');
const { publishInTransaction } = require('../services/eventBus');
const { logAdminAction } = require('../services/adminAudit');
const {
    GUARDIAN_DIRECTOR_DM_REQUESTED,
    buildGuardianDeliveryIdempotencyKey
} = require('../services/guardianDelivery');

const { authenticateToken } = require('../middleware/auth');
const {
    buildGuardianActionIdempotencyKey,
    claimGuardianDirectorAction,
    normalizeNullableId,
    recordGuardianDirectorAction
} = require('../services/guardianIdempotency');
const {
    previewGuardianUserModerationRepair,
    repairGuardianUserModerationState
} = require('../services/guardianRepair');

const log = createLogger('GuardianRoute');

// All guardian routes require authentication
router.use(authenticateToken);

const GUARDIAN_ADMIN_ROLES = ['creator', 'director', 'admin'];
const GUARDIAN_OPS_ROLES = ['creator', 'director', 'admin', 'security'];
const GUARDIAN_OWNER_ROLES = ['creator', 'director'];
const GUARDIAN_EMERGENCY_ROLES = ['creator'];
const GUARDIAN_EVENT_PREFIX = 'guardian.';

function getCurrentUserId(req) {
    return req.user?.id || req.user?.userId;
}

function hasExactRole(req, roles) {
    return Boolean(req.user && roles.includes(req.user.role));
}

function requireExactRoles(roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

const requireGuardianAdmin = requireExactRoles(GUARDIAN_ADMIN_ROLES);
const requireGuardianOps = requireExactRoles(GUARDIAN_OPS_ROLES);
const requireGuardianOwner = requireExactRoles(GUARDIAN_OWNER_ROLES);
const requireGuardianEmergency = requireExactRoles(GUARDIAN_EMERGENCY_ROLES);

// Intentionally broader authenticated reads remain for ambient chat UI:
// /reports, /mood, /health, and channel mood feed digest/mood indicators.
// Control-plane writes and sensitive admin logs/configs below use exact-role RBAC.

// Phase 3 functions — optional, may not be available yet
let handleGuardianCommand, calculateChannelHealth, getChannelMoodSummary, getUserMoodProfile, generateWeeklyReport, getActivityHeatmap, getTrustScore, updateTrustScore, checkEscalation;
try {
    ({ handleGuardianCommand, calculateChannelHealth, getChannelMoodSummary, getUserMoodProfile, generateWeeklyReport, getActivityHeatmap, getTrustScore, updateTrustScore, checkEscalation } = require('../services/guardian'));
} catch (e) {
    log.warn('Some guardian phase3 functions not yet available');
}

function clampLimit(value, fallback = 25, max = 100) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function parseJsonValue(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return {}; }
    }
    return value;
}

function summarizeGuardianPayload(payload) {
    const parsed = parseJsonValue(payload);
    const summary = {
        deliveryKey: parsed.deliveryKey || null,
        deliveryType: parsed.deliveryType || null,
        sourceType: parsed.sourceType || null,
        sourceId: parsed.sourceId || null,
        channelId: parsed.channelId || null,
        userId: parsed.userId || null,
        username: parsed.username || null,
        hasContent: Boolean(parsed.content)
    };
    return summary;
}

function mapOutboxRow(row) {
    return {
        id: row.id,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        idempotencyKey: row.idempotency_key,
        status: row.published_at
            ? 'published'
            : (Number(row.publish_attempts || 0) >= 5 ? 'blocked' : (row.last_error ? 'retry_needed' : 'pending')),
        publishAttempts: Number(row.publish_attempts || 0),
        lastError: row.last_error || null,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
        publishedAt: row.published_at,
        payloadSummary: summarizeGuardianPayload(row.payload)
    };
}

function mapEventQueueRow(row) {
    return {
        id: row.id,
        eventType: row.event_type,
        status: row.status,
        convergenceStatus: row.convergence_status || null,
        failureClass: row.failure_class || null,
        attempts: Number(row.attempts || 0),
        maxAttempts: Number(row.max_attempts || 0),
        lastError: row.last_error || null,
        nextRetryAt: row.next_retry_at,
        createdAt: row.created_at,
        processedAt: row.processed_at,
        terminalAt: row.terminal_at || null,
        idempotencyKey: row.idempotency_key,
        payloadSummary: summarizeGuardianPayload(row.payload)
    };
}

function mapDeadLetterRow(row) {
    return {
        id: row.id,
        originalEventId: row.original_event_id,
        eventType: row.event_type,
        status: row.requeued_at ? 'replayed' : 'dead_letter',
        idempotencyKey: row.idempotency_key,
        attempts: Number(row.attempts || 0),
        maxAttempts: Number(row.max_attempts || 0),
        failureClass: row.failure_class || null,
        terminalReason: row.terminal_reason || row.error || null,
        error: row.error || null,
        movedAt: row.moved_at,
        requeuedAt: row.requeued_at || null,
        requeuedEventId: row.requeued_event_id || null,
        payloadSummary: summarizeGuardianPayload(row.payload)
    };
}

function isGuardianEventType(eventType) {
    return typeof eventType === 'string' && eventType.startsWith(GUARDIAN_EVENT_PREFIX);
}

function parsePositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function auditGuardianOps(action, req, target, details) {
    logAdminAction(action, 'guardian_ops', {
        username: req.user?.username,
        target,
        details,
        ip: req.ip,
        requestId: req.headers['x-request-id']
    });
}

/**
 * GET /api/guardian/reports
 * List daily reports (optionally filter by channel)
 */
router.get('/reports', async (req, res) => {
    try {
        const { channelId, limit = 7 } = req.query;
        let query = `
            SELECT gr.*, cc.name AS channel_name, cc.slug AS channel_slug
            FROM guardian_reports gr
            LEFT JOIN chat_channels cc ON cc.id = gr.channel_id
        `;
        const params = [];
        if (channelId) {
            params.push(channelId);
            query += ' WHERE gr.channel_id = $1';
        }
        query += ' ORDER BY gr.report_date DESC, gr.channel_id LIMIT $' + (params.length + 1);
        params.push(parseInt(limit));

        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            reportDate: r.report_date,
            channelId: r.channel_id,
            channelName: r.channel_name,
            channelSlug: r.channel_slug,
            summary: r.summary,
            importantMessages: r.important_messages,
            conflictsDetected: r.conflicts_detected,
            sensitiveMasked: r.sensitive_masked,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /reports error', err);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

/**
 * POST /api/guardian/reports/generate
 * Manually trigger report generation for a channel/date
 */
router.post('/reports/generate', requireGuardianAdmin, async (req, res) => {
    try {
        const { channelId, date } = req.body;
        const dateStr = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });

        if (channelId) {
            const report = await generateDailyReport(channelId, dateStr);
            res.json({ success: true, report });
        } else {
            await runDailyReports();
            res.json({ success: true, message: 'Reports generated for all channels' });
        }
    } catch (err) {
        log.error('POST /reports/generate error', err);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

/**
 * GET /api/guardian/actions
 * List guardian actions (mutes, masks, warns)
 */
router.get('/actions', requireGuardianAdmin, async (req, res) => {
    try {
        const { type, channelId, limit = 50 } = req.query;
        let query = `
            SELECT ga.*, u.username AS target_username, cc.name AS channel_name
            FROM guardian_actions ga
            LEFT JOIN users u ON u.id = ga.target_user_id
            LEFT JOIN chat_channels cc ON cc.id = ga.channel_id
            WHERE 1=1
        `;
        const params = [];

        if (type) {
            params.push(type);
            query += ` AND ga.action_type = $${params.length}`;
        }
        if (channelId) {
            params.push(channelId);
            query += ` AND ga.channel_id = $${params.length}`;
        }

        params.push(parseInt(limit));
        query += ` ORDER BY ga.created_at DESC LIMIT $${params.length}`;

        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            actionType: r.action_type,
            channelId: r.channel_id,
            channelName: r.channel_name,
            targetUserId: r.target_user_id,
            targetUsername: r.target_username,
            messageId: r.message_id,
            details: r.details,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /actions error', err);
        res.status(500).json({ error: 'Failed to fetch actions' });
    }
});

/**
 * GET /api/guardian/mutes/active
 * List currently active mutes
 */
router.get('/mutes/active', async (req, res) => {
    try {
        const params = [];
        let query = `
            SELECT cm.*, u.username, u.name AS display_name, cc.name AS channel_name
            FROM chat_mutes cm
            JOIN users u ON u.id = cm.user_id
            LEFT JOIN chat_channels cc ON cc.id = cm.channel_id
            WHERE cm.muted_until > NOW()
        `;
        if (!hasExactRole(req, GUARDIAN_ADMIN_ROLES)) {
            params.push(getCurrentUserId(req));
            query += ` AND cm.user_id = $${params.length}`;
        }
        query += ' ORDER BY cm.muted_until ASC';

        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            channelId: r.channel_id,
            channelName: r.channel_name,
            userId: r.user_id,
            username: r.username,
            displayName: r.display_name,
            reason: r.reason,
            mutedUntil: r.muted_until,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /mutes/active error', err);
        res.status(500).json({ error: 'Failed to fetch mutes' });
    }
});

/**
 * DELETE /api/guardian/mutes/:id
 * Manually unmute a user
 */
router.delete('/mutes/:id', async (req, res) => {
    try {
        // Get mute info before clearing (need channelId + userId for cache)
        const muteInfo = await pool.query('SELECT channel_id, user_id FROM chat_mutes WHERE id = $1', [req.params.id]);
        if (muteInfo.rows.length === 0) {
            return res.status(404).json({ error: 'Mute not found' });
        }
        const { channel_id, user_id } = muteInfo.rows[0];
        if (!hasExactRole(req, GUARDIAN_ADMIN_ROLES) && String(user_id) !== String(getCurrentUserId(req))) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        await pool.query('UPDATE chat_mutes SET muted_until = NOW() WHERE id = $1', [req.params.id]);
        // Clear in-memory cache so user can send messages immediately
        clearMuteCache(channel_id, user_id);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /mutes error', err);
        res.status(500).json({ error: 'Failed to unmute' });
    }
});

/**
 * GET /api/guardian/stats
 * Guardian statistics summary
 */
router.get('/stats', requireGuardianAdmin, async (req, res) => {
    try {
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
        const [todayActions, totalActions, activeMutes] = await Promise.all([
            pool.query(`
                SELECT action_type, COUNT(*) cnt
                FROM guardian_actions WHERE created_at::date = $1
                GROUP BY action_type
            `, [today]),
            pool.query(`
                SELECT action_type, COUNT(*) cnt
                FROM guardian_actions
                GROUP BY action_type
            `),
            pool.query('SELECT COUNT(*) cnt FROM chat_mutes WHERE muted_until > NOW()')
        ]);

        const todayStats = {};
        todayActions.rows.forEach(r => { todayStats[r.action_type] = parseInt(r.cnt); });

        const totalStats = {};
        totalActions.rows.forEach(r => { totalStats[r.action_type] = parseInt(r.cnt); });
        todayStats.blocked = Math.max(todayStats.block_precheck || 0, todayStats.mute || 0);
        totalStats.blocked = Math.max(totalStats.block_precheck || 0, totalStats.mute || 0);

        res.json({
            today: todayStats,
            total: totalStats,
            activeMutes: parseInt(activeMutes.rows[0].cnt)
        });
    } catch (err) {
        log.error('GET /stats error', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

/**
 * GET /api/guardian/ops/reliability
 * Operator snapshot for Guardian delivery and moderation recovery.
 */
router.get('/ops/reliability', requireGuardianOps, async (req, res) => {
    try {
        const limit = clampLimit(req.query.limit, 25, 100);
        const [
            outboxSummary,
            outboxEvents,
            eventQueueSummary,
            eventQueueEvents,
            deadLetterSummary,
            deadLetterEvents,
            activeMutes,
            recentActions,
            moderationCounters
        ] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE published_at IS NULL AND COALESCE(publish_attempts, 0) = 0 AND last_error IS NULL)::int AS pending,
                    COUNT(*) FILTER (WHERE published_at IS NULL AND (COALESCE(publish_attempts, 0) > 0 OR last_error IS NOT NULL))::int AS retry_needed,
                    COUNT(*) FILTER (WHERE published_at IS NULL AND COALESCE(publish_attempts, 0) >= 5)::int AS blocked,
                    COUNT(*) FILTER (WHERE published_at IS NOT NULL)::int AS published
                FROM outbox_events
                WHERE event_type LIKE 'guardian.%'
            `),
            pool.query(`
                SELECT id, aggregate_type, aggregate_id, event_type, payload, idempotency_key,
                       occurred_at, published_at, publish_attempts, last_error, created_at
                FROM outbox_events
                WHERE event_type LIKE 'guardian.%'
                  AND (published_at IS NULL OR last_error IS NOT NULL OR publish_attempts > 0)
                ORDER BY COALESCE(occurred_at, created_at) DESC
                LIMIT $1
            `, [limit]),
            pool.query(`
                SELECT status, COUNT(*)::int AS count
                FROM event_queue
                WHERE event_type LIKE 'guardian.%'
                GROUP BY status
            `),
            pool.query(`
                SELECT id, event_type, payload, idempotency_key, status, attempts, max_attempts,
                       last_error, created_at, processed_at, next_retry_at,
                       convergence_status, failure_class, terminal_at
                FROM event_queue
                WHERE event_type LIKE 'guardian.%'
                  AND status IN ('pending', 'failed', 'terminal_failed')
                ORDER BY created_at DESC
                LIMIT $1
            `, [limit]),
            pool.query(`
                SELECT COALESCE(failure_class, 'unknown') AS failure_class, COUNT(*)::int AS count
                FROM event_dead_letter
                WHERE event_type LIKE 'guardian.%'
                  AND requeued_at IS NULL
                GROUP BY COALESCE(failure_class, 'unknown')
            `),
            pool.query(`
                SELECT id, original_event_id, event_type, payload, error, idempotency_key,
                       attempts, max_attempts, failure_class, terminal_reason,
                       moved_at, requeued_at, requeued_event_id
                FROM event_dead_letter
                WHERE event_type LIKE 'guardian.%'
                ORDER BY moved_at DESC
                LIMIT $1
            `, [limit]),
            pool.query(`
                SELECT cm.id, cm.channel_id, cc.name AS channel_name, cm.user_id,
                       u.username, u.name AS display_name, cm.reason, cm.muted_until, cm.created_at
                FROM chat_mutes cm
                JOIN users u ON u.id = cm.user_id
                LEFT JOIN chat_channels cc ON cc.id = cm.channel_id
                WHERE cm.muted_until > NOW()
                ORDER BY cm.muted_until ASC
                LIMIT $1
            `, [limit]),
            pool.query(`
                SELECT ga.id, ga.action_type, ga.channel_id, cc.name AS channel_name,
                       ga.target_user_id, u.username AS target_username, ga.message_id,
                       ga.details, ga.created_at
                FROM guardian_actions ga
                LEFT JOIN users u ON u.id = ga.target_user_id
                LEFT JOIN chat_channels cc ON cc.id = ga.channel_id
                ORDER BY ga.created_at DESC
                LIMIT $1
            `, [limit]),
            pool.query(`
                SELECT gmc.id, gmc.counter_type, gmc.user_id, u.username, gmc.window_key,
                       gmc.window_start, gmc.window_end, gmc.count, gmc.alerted_at,
                       gmc.last_channel_id, cc.name AS last_channel_name,
                       gmc.last_source_type, gmc.last_source_id, gmc.updated_at
                FROM guardian_moderation_counters gmc
                LEFT JOIN users u ON u.id = gmc.user_id
                LEFT JOIN chat_channels cc ON cc.id = gmc.last_channel_id
                ORDER BY gmc.updated_at DESC
                LIMIT $1
            `, [limit])
        ]);

        const queueByStatus = {};
        for (const row of eventQueueSummary.rows) {
            queueByStatus[row.status || 'unknown'] = Number(row.count || 0);
        }
        const deadLetterByClass = {};
        for (const row of deadLetterSummary.rows) {
            deadLetterByClass[row.failure_class || 'unknown'] = Number(row.count || 0);
        }

        res.json({
            generatedAt: new Date().toISOString(),
            limit,
            outbox: {
                summary: outboxSummary.rows[0] || { total: 0, pending: 0, retry_needed: 0, blocked: 0, published: 0 },
                events: outboxEvents.rows.map(mapOutboxRow)
            },
            eventQueue: {
                summary: queueByStatus,
                events: eventQueueEvents.rows.map(mapEventQueueRow)
            },
            deadLetter: {
                summary: deadLetterByClass,
                events: deadLetterEvents.rows.map(mapDeadLetterRow)
            },
            moderation: {
                activeMutes: activeMutes.rows.map(r => ({
                    id: r.id,
                    channelId: r.channel_id,
                    channelName: r.channel_name,
                    userId: r.user_id,
                    username: r.username,
                    displayName: r.display_name,
                    reason: r.reason,
                    mutedUntil: r.muted_until,
                    createdAt: r.created_at
                })),
                recentActions: recentActions.rows.map(r => ({
                    id: r.id,
                    actionType: r.action_type,
                    channelId: r.channel_id,
                    channelName: r.channel_name,
                    targetUserId: r.target_user_id,
                    targetUsername: r.target_username,
                    messageId: r.message_id,
                    details: parseJsonValue(r.details),
                    createdAt: r.created_at
                })),
                counters: moderationCounters.rows.map(r => ({
                    id: r.id,
                    counterType: r.counter_type,
                    userId: r.user_id,
                    username: r.username,
                    windowKey: r.window_key,
                    windowStart: r.window_start,
                    windowEnd: r.window_end,
                    count: Number(r.count || 0),
                    alertedAt: r.alerted_at,
                    lastChannelId: r.last_channel_id,
                    lastChannelName: r.last_channel_name,
                    lastSourceType: r.last_source_type,
                    lastSourceId: r.last_source_id,
                    updatedAt: r.updated_at
                }))
            }
        });
    } catch (err) {
        log.error('GET /ops/reliability error', err);
        res.status(500).json({ error: 'Failed to fetch Guardian reliability snapshot' });
    }
});

/**
 * POST /api/guardian/ops/outbox/:id/requeue
 * Reset one unpublished Guardian outbox event for relay retry.
 */
router.post('/ops/outbox/:id/requeue', requireGuardianOps, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const selected = await client.query(
            `SELECT id, event_type, aggregate_type, aggregate_id, idempotency_key,
                    published_at, publish_attempts, last_error
             FROM outbox_events
             WHERE id = $1
             FOR UPDATE`,
            [req.params.id]
        );
        const row = selected.rows[0];
        if (!row) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Outbox event not found' });
        }
        if (!isGuardianEventType(row.event_type)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Only Guardian outbox events can be requeued here' });
        }
        if (row.published_at) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Outbox event is already published' });
        }

        const updated = await client.query(
            `UPDATE outbox_events
             SET publish_attempts = 0,
                 last_error = NULL
             WHERE id = $1
             RETURNING id, event_type, aggregate_type, aggregate_id, idempotency_key,
                       occurred_at, published_at, publish_attempts, last_error, created_at, payload`,
            [row.id]
        );
        await client.query('COMMIT');

        auditGuardianOps('guardian_outbox_requeue', req, `outbox:${row.id}`, {
            eventType: row.event_type,
            idempotencyKey: row.idempotency_key,
            previousAttempts: row.publish_attempts,
            previousError: row.last_error || null
        });

        res.json({ success: true, event: mapOutboxRow(updated.rows[0]) });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('POST /ops/outbox/:id/requeue error', err);
        res.status(500).json({ error: 'Failed to requeue Guardian outbox event' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/guardian/ops/events/:id/requeue
 * Reset one failed Guardian event_queue event for processing retry.
 */
router.post('/ops/events/:id/requeue', requireGuardianOps, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const selected = await client.query(
            `SELECT id, event_type, status, attempts, max_attempts, last_error, idempotency_key,
                    convergence_status, failure_class
             FROM event_queue
             WHERE id = $1
             FOR UPDATE`,
            [req.params.id]
        );
        const row = selected.rows[0];
        if (!row) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Event queue item not found' });
        }
        if (!isGuardianEventType(row.event_type)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Only Guardian event_queue items can be requeued here' });
        }
        if (!['failed', 'terminal_failed'].includes(row.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Only failed or terminal Guardian event_queue items can be requeued' });
        }

        const updated = await client.query(
            `UPDATE event_queue
             SET status = 'pending',
                 attempts = 0,
                 last_error = NULL,
                 next_retry_at = NULL,
                 convergence_status = 'replayed',
                 failure_class = NULL,
                 terminal_at = NULL,
                 last_convergence_at = NOW()
             WHERE id = $1
             RETURNING id, event_type, payload, idempotency_key, status, attempts, max_attempts,
                       last_error, created_at, processed_at, next_retry_at,
                       convergence_status, failure_class, terminal_at`,
            [row.id]
        );
        await client.query('COMMIT');

        auditGuardianOps('guardian_event_requeue', req, `event_queue:${row.id}`, {
            eventType: row.event_type,
            idempotencyKey: row.idempotency_key,
            previousStatus: row.status,
            previousAttempts: row.attempts,
            previousError: row.last_error || null,
            previousFailureClass: row.failure_class || null
        });

        res.json({ success: true, event: mapEventQueueRow(updated.rows[0]) });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('POST /ops/events/:id/requeue error', err);
        res.status(500).json({ error: 'Failed to requeue Guardian event' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/guardian/ops/dead-letter/:id/requeue
 * Replay one Guardian dead-letter event by creating a new pending event_queue row.
 */
router.post('/ops/dead-letter/:id/requeue', requireGuardianOps, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const selected = await client.query(
            `SELECT id, original_event_id, event_type, payload, error, idempotency_key,
                    attempts, max_attempts, failure_class, terminal_reason,
                    moved_at, requeued_at, requeued_event_id
             FROM event_dead_letter
             WHERE id = $1
             FOR UPDATE`,
            [req.params.id]
        );
        const row = selected.rows[0];
        if (!row) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Dead-letter event not found' });
        }
        if (!isGuardianEventType(row.event_type)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Only Guardian dead-letter events can be requeued here' });
        }
        if (row.requeued_at) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Dead-letter event was already replayed' });
        }

        const replayKey = row.idempotency_key
            ? `${row.idempotency_key}:replay:${row.id}`
            : `${row.event_type}:dead-letter:${row.id}`;
        const inserted = await client.query(
            `INSERT INTO event_queue (
                event_type, payload, idempotency_key, status, attempts, max_attempts,
                convergence_status, failure_class, last_error, next_retry_at
             )
             VALUES ($1, $2, $3, 'pending', 0, GREATEST(COALESCE($4, 3), 1),
                     'replayed', NULL, NULL, NULL)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id, event_type, payload, idempotency_key, status, attempts, max_attempts,
                       last_error, created_at, processed_at, next_retry_at,
                       convergence_status, failure_class, terminal_at`,
            [row.event_type, row.payload, replayKey, row.max_attempts || 3]
        );

        if (inserted.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'A replay event already exists for this dead-letter item' });
        }

        await client.query(
            `UPDATE event_dead_letter
             SET requeued_at = NOW(),
                 requeued_event_id = $1
             WHERE id = $2`,
            [inserted.rows[0].id, row.id]
        );
        await client.query('COMMIT');

        auditGuardianOps('guardian_dead_letter_requeue', req, `dead_letter:${row.id}`, {
            eventType: row.event_type,
            idempotencyKey: row.idempotency_key,
            replayKey,
            failureClass: row.failure_class || null,
            previousError: row.error || row.terminal_reason || null
        });

        res.json({
            success: true,
            deadLetterId: row.id,
            event: mapEventQueueRow(inserted.rows[0])
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('POST /ops/dead-letter/:id/requeue error', err);
        res.status(500).json({ error: 'Failed to replay Guardian dead-letter event' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/guardian/ops/reconcile/users/:userId
 * Explain Guardian moderation counter drift for one user without mutating data.
 */
router.get('/ops/reconcile/users/:userId', requireGuardianOps, async (req, res) => {
    try {
        const userId = parsePositiveInt(req.params.userId);
        if (!userId) return res.status(400).json({ error: 'Valid userId is required' });

        const preview = await previewGuardianUserModerationRepair(pool, userId);
        res.json({ success: true, dryRun: true, preview });
    } catch (err) {
        log.error('GET /ops/reconcile/users/:userId error', err);
        res.status(err.statusCode || 500).json({
            error: err.statusCode === 404 ? 'Guardian user not found' : 'Failed to preview Guardian moderation repair'
        });
    }
});

/**
 * POST /api/guardian/ops/reconcile/users/:userId
 * Apply the repairable part of a one-user Guardian moderation counter reconciliation.
 */
router.post('/ops/reconcile/users/:userId', requireGuardianOps, async (req, res) => {
    try {
        const userId = parsePositiveInt(req.params.userId);
        if (!userId) return res.status(400).json({ error: 'Valid userId is required' });
        if (req.body?.apply !== true) {
            const preview = await previewGuardianUserModerationRepair(pool, userId);
            return res.json({ success: true, dryRun: true, preview });
        }

        const result = await repairGuardianUserModerationState(pool, userId);
        auditGuardianOps('guardian_user_moderation_repair', req, `user:${userId}`, {
            issueCount: result.issueCount,
            repairableIssueCount: result.repairableIssueCount,
            appliedCount: result.appliedCount
        });
        res.json({ success: true, dryRun: false, result });
    } catch (err) {
        log.error('POST /ops/reconcile/users/:userId error', err);
        res.status(err.statusCode || 500).json({
            error: err.statusCode === 404 ? 'Guardian user not found' : 'Failed to repair Guardian moderation state'
        });
    }
});

// ==========================================
// GUARDIAN RULES CRUD (Contour 2)
// ==========================================

/**
 * GET /api/guardian/rules
 * List all guardian rules (active by default).
 */
router.get('/rules', requireGuardianAdmin, async (req, res) => {
    try {
        const { active } = req.query;
        let query = 'SELECT * FROM guardian_rules';
        const params = [];
        if (active !== 'all') {
            query += ' WHERE is_active = true';
        }
        query += ' ORDER BY severity DESC, created_at';
        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            ruleType: r.rule_type,
            name: r.name,
            pattern: r.pattern,
            action: r.action,
            severity: r.severity,
            channelScope: r.channel_scope,
            isActive: r.is_active,
            metadata: r.metadata,
            createdBy: r.created_by,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /rules error', err);
        res.status(500).json({ error: 'Не вдалось отримати правила' });
    }
});

/**
 * POST /api/guardian/rules
 * Create a new guardian rule.
 */
router.post('/rules', requireGuardianAdmin, async (req, res) => {
    try {
        const { ruleType, name, pattern, action, severity, channelScope, metadata } = req.body;
        if (!name || !action) {
            return res.status(400).json({ error: 'name та action обовʼязкові' });
        }
        const result = await pool.query(
            `INSERT INTO guardian_rules (rule_type, name, pattern, action, severity, channel_scope, metadata, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [ruleType || 'keyword', name, pattern, action, severity || 'medium',
             channelScope || null, JSON.stringify(metadata || {}), req.user.id]
        );
        const r = result.rows[0];
        res.json({
            id: r.id, ruleType: r.rule_type, name: r.name, pattern: r.pattern,
            action: r.action, severity: r.severity, isActive: r.is_active
        });
    } catch (err) {
        log.error('POST /rules error', err);
        res.status(500).json({ error: 'Не вдалось створити правило' });
    }
});

/**
 * PUT /api/guardian/rules/:id
 * Update a guardian rule.
 */
router.put('/rules/:id', requireGuardianAdmin, async (req, res) => {
    try {
        const { name, pattern, action, severity, channelScope, isActive, metadata } = req.body;
        const result = await pool.query(
            `UPDATE guardian_rules SET
                name = COALESCE($1, name),
                pattern = COALESCE($2, pattern),
                action = COALESCE($3, action),
                severity = COALESCE($4, severity),
                channel_scope = COALESCE($5, channel_scope),
                is_active = COALESCE($6, is_active),
                metadata = COALESCE($7, metadata),
                updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [name, pattern, action, severity, channelScope, isActive,
             metadata ? JSON.stringify(metadata) : null, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Правило не знайдено' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('PUT /rules error', err);
        res.status(500).json({ error: 'Не вдалось оновити правило' });
    }
});

/**
 * DELETE /api/guardian/rules/:id
 * Delete a guardian rule.
 */
router.delete('/rules/:id', requireGuardianAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM guardian_rules WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /rules error', err);
        res.status(500).json({ error: 'Не вдалось видалити правило' });
    }
});

/**
 * POST /api/guardian/action
 * Handle inline action buttons from Guardian DM alerts.
 * Actions: mute_both, warn, watch, unmute
 */
router.post('/action', requireGuardianAdmin, async (req, res) => {
    let client;
    try {
        const { action, channelId, userId, username } = req.body;
        if (!action) {
            return res.status(400).json({ error: 'action обовʼязковий' });
        }

        const adminUser = req.user;
        const actionChannelId = normalizeNullableId(channelId);
        const actionUserId = normalizeNullableId(userId);
        const idempotencyKey = req.body.actionToken || req.body.idempotencyKey || buildGuardianActionIdempotencyKey({
            action,
            channelId: actionChannelId,
            targetUserId: actionUserId
        });
        let response = '';
        let afterCommit = null;
        let directorDelivery = null;

        client = await pool.connect();
        await client.query('BEGIN');

        const claim = await claimGuardianDirectorAction({
            client,
            action,
            channelId: actionChannelId,
            targetUserId: actionUserId,
            idempotencyKey,
            singleUse: Boolean(req.body.actionToken)
        });

        if (claim.duplicate) {
            await client.query('COMMIT');
            return res.json({
                success: true,
                duplicate: true,
                message: claim.response || 'Action already processed'
            });
        }

        switch (action) {
            case 'mute_both': {
                // Mute both parties in the channel (find recent conflict aggressors)
                const recentMutes = await client.query(`
                    SELECT DISTINCT user_id, (details->>'username')::text AS username
                    FROM guardian_actions
                    WHERE channel_id = $1 AND action_type = 'mute'
                    AND created_at > NOW() - INTERVAL '10 minutes'
                    ORDER BY created_at DESC LIMIT 2
                `, [actionChannelId]);
                for (const mute of recentMutes.rows) {
                    await client.query(
                        'INSERT INTO chat_mutes (channel_id, user_id, reason, muted_until) VALUES ($1, $2, $3, NOW() + INTERVAL \'10 minutes\')',
                        [actionChannelId, mute.user_id, 'Директор: мютити обох']
                    );
                }
                response = `🔇 Обох учасників замютовано на 10 хв (${adminUser.username})`;
                break;
            }
            case 'warn': {
                directorDelivery = {
                    content:
                        `⚠️ <b>Попередження від директора</b>\n` +
                        `@${username}, будь ласка, дотримуйтесь правил спілкування.\n` +
                        `Наступне порушення — блокування на довший термін.`,
                    deliveryType: 'guardian_action_warn_followup',
                    sourceType: 'guardian_action'
                };
                response = `⚠️ Попередження відправлено @${username} (${adminUser.username})`;
                break;
            }
            case 'watch': {
                response = `👀 Директор спостерігає за ситуацією (${adminUser.username})`;
                break;
            }
            case 'unmute': {
                if (actionUserId) {
                    await client.query('UPDATE chat_mutes SET muted_until = NOW() WHERE user_id = $1 AND channel_id = $2 AND muted_until > NOW()', [actionUserId, actionChannelId]);
                    afterCommit = () => clearMuteCache(actionChannelId, actionUserId);
                    response = `🔊 @${username || userId} розмютовано (${adminUser.username})`;
                }
                break;
            }
            default:
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Невідома дія: ${action}` });
        }

        // Log the director's action inside the same idempotent transaction.
        await recordGuardianDirectorAction({
            client,
            actionType: claim.actionType,
            channelId: actionChannelId,
            targetUserId: actionUserId,
            response,
            adminId: adminUser.id,
            idempotencyKey
        });

        if (directorDelivery) {
            const deliveryKey = buildGuardianDeliveryIdempotencyKey('action.dm', idempotencyKey);
            await publishInTransaction(
                client,
                GUARDIAN_DIRECTOR_DM_REQUESTED,
                {
                    ...directorDelivery,
                    deliveryKey,
                    sourceId: idempotencyKey,
                    channelId: actionChannelId,
                    userId: actionUserId,
                    username
                },
                'guardian_action',
                deliveryKey,
                deliveryKey
            );
        }

        await client.query('COMMIT');
        if (afterCommit) await afterCommit();

        res.json({ success: true, message: response });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch {}
        }
        log.error('POST /action error', err);
        res.status(500).json({ error: 'Не вдалось виконати дію' });
    } finally {
        if (client) client.release();
    }
});

/**
 * GET /api/guardian/mood
 * Get current guardian mood
 */
router.get('/mood', (req, res) => {
    res.json(getMood());
});

/**
 * GET /api/guardian/state
 * Get full guardian state (mood, health, memory summary)
 */
router.get('/state', requireGuardianAdmin, (req, res) => {
    res.json(getGuardianState());
});

// ==========================================
// CHANNEL HEALTH (Phase 3)
// ==========================================

/**
 * GET /api/guardian/health/:channelId
 * Get channel health score + history
 */
router.get('/health/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;

        // Try service function first
        let health = null;
        if (calculateChannelHealth) {
            try {
                health = await calculateChannelHealth(channelId);
            } catch (e) {
                log.warn('calculateChannelHealth not available, using DB fallback');
            }
        }

        // Fallback: query DB directly
        if (!health) {
            const latest = await pool.query(`
                SELECT score, level, factors, calculated_at
                FROM guardian_channel_health
                WHERE channel_id = $1
                ORDER BY calculated_at DESC LIMIT 1
            `, [channelId]);
            health = latest.rows[0]
                ? { score: latest.rows[0].score, level: latest.rows[0].level, factors: latest.rows[0].factors, trend: 'stable' }
                : { score: 100, level: 'green', factors: {}, trend: 'stable' };
        }

        const history = await pool.query(`
            SELECT score, level, recorded_at
            FROM guardian_health_history
            WHERE channel_id = $1
            ORDER BY recorded_at DESC LIMIT 30
        `, [channelId]);

        res.json({
            score: health.score,
            level: health.level,
            factors: health.factors || {},
            trend: health.trend || 'stable',
            history: history.rows.map(r => ({
                score: r.score,
                level: r.level,
                recordedAt: r.recorded_at
            }))
        });
    } catch (err) {
        log.error('GET /health/:channelId error', err);
        res.status(500).json({ error: 'Failed to fetch channel health' });
    }
});

/**
 * GET /api/guardian/health
 * Get all channels health summary
 */
router.get('/health', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT ON (gch.channel_id)
                gch.channel_id, cc.name AS channel_name, gch.score, gch.level
            FROM guardian_channel_health gch
            LEFT JOIN chat_channels cc ON cc.id = gch.channel_id
            ORDER BY gch.channel_id, gch.calculated_at DESC
        `);
        res.json(result.rows.map(r => ({
            channelId: r.channel_id,
            channelName: r.channel_name,
            score: r.score,
            level: r.level
        })));
    } catch (err) {
        log.error('GET /health error', err);
        res.status(500).json({ error: 'Failed to fetch health summary' });
    }
});

// ==========================================
// MOOD / SENTIMENT (Phase 3)
// ==========================================

/**
 * GET /api/guardian/mood/channel/:channelId
 * Get channel mood/sentiment summary
 */
router.get('/mood/channel/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { period = 'today' } = req.query;

        if (getChannelMoodSummary) {
            try {
                const mood = await getChannelMoodSummary(channelId, period);
                return res.json(mood);
            } catch (e) {
                log.warn('getChannelMoodSummary failed, using DB fallback');
            }
        }

        const interval = period === 'week' ? '7 days' : '1 day';
        const result = await pool.query(`
            SELECT score, sentiment, analyzed_at
            FROM guardian_mood_tracking
            WHERE channel_id = $1 AND analyzed_at > NOW() - $2::interval
            ORDER BY analyzed_at DESC
        `, [channelId, interval]);

        const rows = result.rows;
        const avgScore = rows.length > 0 ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
        const distribution = { positive: 0, neutral: 0, negative: 0 };
        const emotionCount = {};
        rows.forEach(r => {
            if (distribution[r.sentiment] !== undefined) distribution[r.sentiment]++;
        });

        const sentiment = avgScore >= 0.6 ? 'positive' : avgScore >= 0.4 ? 'neutral' : 'negative';
        const trend = rows.length >= 2
            ? (rows[0].score > rows[rows.length - 1].score ? 'improving' : rows[0].score < rows[rows.length - 1].score ? 'declining' : 'stable')
            : 'stable';

        res.json({
            avgScore: Math.round(avgScore * 100) / 100,
            sentiment,
            trend,
            distribution,
            topEmotions: []
        });
    } catch (err) {
        log.error('GET /mood/channel/:channelId error', err);
        res.status(500).json({ error: 'Failed to fetch channel mood' });
    }
});

/**
 * GET /api/guardian/mood/user/:userId
 * Get user mood profile
 */
router.get('/mood/user/:userId', requireGuardianAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        if (getUserMoodProfile) {
            try {
                const profile = await getUserMoodProfile(userId);
                return res.json(profile);
            } catch (e) {
                log.warn('getUserMoodProfile failed, using DB fallback');
            }
        }

        const result = await pool.query(`
            SELECT score, sentiment, analyzed_at
            FROM guardian_mood_tracking
            WHERE user_id = $1
            ORDER BY analyzed_at DESC LIMIT 30
        `, [userId]);

        const rows = result.rows;
        const avgScore = rows.length > 0 ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
        const sentiment = avgScore >= 0.6 ? 'positive' : avgScore >= 0.4 ? 'neutral' : 'negative';
        const trend = rows.length >= 2
            ? (rows[0].score > rows[rows.length - 1].score ? 'improving' : rows[0].score < rows[rows.length - 1].score ? 'declining' : 'stable')
            : 'stable';

        res.json({
            avgScore: Math.round(avgScore * 100) / 100,
            sentiment,
            recentMood: rows.slice(0, 10).map(r => ({
                score: r.score,
                sentiment: r.sentiment,
                analyzedAt: r.analyzed_at
            })),
            trend
        });
    } catch (err) {
        log.error('GET /mood/user/:userId error', err);
        res.status(500).json({ error: 'Failed to fetch user mood' });
    }
});

/**
 * GET /api/guardian/mood/team
 * Get team-wide mood summary
 */
router.get('/mood/team', requireGuardianAdmin, async (req, res) => {
    try {
        const { period = 'today' } = req.query;
        const interval = period === 'week' ? '7 days' : '1 day';

        const [overall, byChannel, byUser] = await Promise.all([
            pool.query(`
                SELECT AVG(score) AS avg_score
                FROM guardian_mood_tracking
                WHERE analyzed_at > NOW() - $1::interval
            `, [interval]),
            pool.query(`
                SELECT gmt.channel_id, cc.name, AVG(gmt.score) AS avg_score
                FROM guardian_mood_tracking gmt
                LEFT JOIN chat_channels cc ON cc.id = gmt.channel_id
                WHERE gmt.analyzed_at > NOW() - $1::interval AND gmt.channel_id IS NOT NULL
                GROUP BY gmt.channel_id, cc.name
                ORDER BY avg_score ASC
            `, [interval]),
            pool.query(`
                SELECT gmt.user_id, u.username, AVG(gmt.score) AS avg_score
                FROM guardian_mood_tracking gmt
                LEFT JOIN users u ON u.id = gmt.user_id
                WHERE gmt.analyzed_at > NOW() - $1::interval AND gmt.user_id IS NOT NULL
                GROUP BY gmt.user_id, u.username
                ORDER BY avg_score ASC
            `, [interval])
        ]);

        const avgScore = overall.rows[0]?.avg_score ? parseFloat(overall.rows[0].avg_score) : 0;
        const sentiment = avgScore >= 0.6 ? 'positive' : avgScore >= 0.4 ? 'neutral' : 'negative';

        res.json({
            avgScore: Math.round(avgScore * 100) / 100,
            sentiment,
            byChannel: byChannel.rows.map(r => ({
                channelId: r.channel_id,
                name: r.name,
                avgScore: Math.round(parseFloat(r.avg_score) * 100) / 100
            })),
            byUser: byUser.rows.map(r => ({
                userId: r.user_id,
                username: r.username,
                avgScore: Math.round(parseFloat(r.avg_score) * 100) / 100
            }))
        });
    } catch (err) {
        log.error('GET /mood/team error', err);
        res.status(500).json({ error: 'Failed to fetch team mood' });
    }
});

// ==========================================
// TRUST SCORES (Phase 3)
// ==========================================

/**
 * GET /api/guardian/trust/:userId
 * Get trust score for a specific user
 */
router.get('/trust/:userId', requireGuardianAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        if (getTrustScore) {
            try {
                const trust = await getTrustScore(userId);
                if (trust) return res.json(trust);
            } catch (e) {
                log.warn('getTrustScore failed, using DB fallback');
            }
        }

        const result = await pool.query(`
            SELECT trust_score, level, positive_actions, negative_actions, last_incident, notes
            FROM guardian_trust_scores
            WHERE user_id = $1
        `, [userId]);

        if (result.rows.length === 0) {
            return res.json({ trustScore: 100, level: 'trusted', positiveActions: 0, negativeActions: 0, lastIncident: null, notes: null });
        }

        const r = result.rows[0];
        res.json({
            trustScore: r.trust_score,
            level: r.level,
            positiveActions: r.positive_actions,
            negativeActions: r.negative_actions,
            lastIncident: r.last_incident,
            notes: r.notes
        });
    } catch (err) {
        log.error('GET /trust/:userId error', err);
        res.status(500).json({ error: 'Failed to fetch trust score' });
    }
});

/**
 * GET /api/guardian/trust
 * Get all users trust scores sorted by score
 */
router.get('/trust', requireGuardianAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT gts.user_id, u.username, gts.trust_score, gts.level, gts.negative_actions
            FROM guardian_trust_scores gts
            LEFT JOIN users u ON u.id = gts.user_id
            ORDER BY gts.trust_score ASC
        `);
        res.json(result.rows.map(r => ({
            userId: r.user_id,
            username: r.username,
            trustScore: r.trust_score,
            level: r.level,
            negativeActions: r.negative_actions
        })));
    } catch (err) {
        log.error('GET /trust error', err);
        res.status(500).json({ error: 'Failed to fetch trust scores' });
    }
});

// ==========================================
// ANALYTICS (Phase 3)
// ==========================================

/**
 * GET /api/guardian/analytics/heatmap/:channelId
 * Get activity heatmap for a channel
 */
router.get('/analytics/heatmap/:channelId', requireGuardianAdmin, async (req, res) => {
    try {
        const { channelId } = req.params;
        const { days = 7 } = req.query;

        if (getActivityHeatmap) {
            try {
                const heatmap = await getActivityHeatmap(channelId, parseInt(days));
                return res.json(heatmap);
            } catch (e) {
                log.warn('getActivityHeatmap failed, using DB fallback');
            }
        }

        const result = await pool.query(`
            SELECT
                EXTRACT(HOUR FROM cm.created_at) AS hour_bucket,
                COUNT(*) AS message_count,
                COUNT(*) FILTER (WHERE ga_conflict.id IS NOT NULL) AS conflict_count,
                COUNT(*) FILTER (WHERE ga_mute.id IS NOT NULL) AS mute_count,
                AVG(gmt.score) AS avg_sentiment
            FROM chat_messages cm
            LEFT JOIN guardian_actions ga_conflict ON ga_conflict.channel_id = cm.channel_id
                AND ga_conflict.action_type = 'conflict' AND ga_conflict.message_id = cm.id
            LEFT JOIN guardian_actions ga_mute ON ga_mute.channel_id = cm.channel_id
                AND ga_mute.action_type = 'mute' AND ga_mute.message_id = cm.id
            LEFT JOIN guardian_mood_tracking gmt ON gmt.channel_id = cm.channel_id
                AND DATE_TRUNC('hour', gmt.analyzed_at) = DATE_TRUNC('hour', cm.created_at)
            WHERE cm.channel_id = $1 AND cm.created_at > NOW() - ($2 || ' days')::interval
            GROUP BY hour_bucket
            ORDER BY hour_bucket
        `, [channelId, parseInt(days)]);

        res.json(result.rows.map(r => ({
            hourBucket: parseInt(r.hour_bucket),
            messageCount: parseInt(r.message_count),
            conflictCount: parseInt(r.conflict_count),
            muteCount: parseInt(r.mute_count),
            avgSentiment: r.avg_sentiment ? Math.round(parseFloat(r.avg_sentiment) * 100) / 100 : null
        })));
    } catch (err) {
        log.error('GET /analytics/heatmap/:channelId error', err);
        res.status(500).json({ error: 'Failed to fetch heatmap' });
    }
});

/**
 * GET /api/guardian/analytics/top-offenders
 * Get top offenders by mute count
 */
router.get('/analytics/top-offenders', requireGuardianAdmin, async (req, res) => {
    try {
        const { period = 'week', limit = 10 } = req.query;
        const interval = period === 'month' ? '30 days' : '7 days';

        const result = await pool.query(`
            SELECT ga.target_user_id AS user_id, u.username,
                   COUNT(*) AS mute_count,
                   MAX(ga.created_at) AS last_incident
            FROM guardian_actions ga
            LEFT JOIN users u ON u.id = ga.target_user_id
            WHERE ga.action_type = 'mute' AND ga.created_at > NOW() - $1::interval
            GROUP BY ga.target_user_id, u.username
            ORDER BY mute_count DESC
            LIMIT $2
        `, [interval, parseInt(limit)]);

        res.json(result.rows.map(r => ({
            userId: r.user_id,
            username: r.username,
            muteCount: parseInt(r.mute_count),
            lastIncident: r.last_incident
        })));
    } catch (err) {
        log.error('GET /analytics/top-offenders error', err);
        res.status(500).json({ error: 'Failed to fetch top offenders' });
    }
});

/**
 * GET /api/guardian/analytics/effectiveness
 * Get guardian effectiveness metrics
 */
router.get('/analytics/effectiveness', requireGuardianAdmin, async (req, res) => {
    try {
        const { period = 'week' } = req.query;
        const interval = period === 'month' ? '30 days' : '7 days';

        const [current, previous] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE action_type IN ('scan', 'mask', 'mute', 'warn')) AS total_scanned,
                    COUNT(*) FILTER (WHERE action_type IN ('mask', 'mute')) AS total_blocked,
                    COUNT(*) FILTER (WHERE action_type = 'false_positive') AS false_positives,
                    AVG(EXTRACT(EPOCH FROM (created_at - COALESCE((details->>'detected_at')::timestamptz, created_at)))) AS avg_response_time
                FROM guardian_actions
                WHERE created_at > NOW() - $1::interval
            `, [interval]),
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE action_type IN ('scan', 'mask', 'mute', 'warn')) AS total_scanned,
                    COUNT(*) FILTER (WHERE action_type IN ('mask', 'mute')) AS total_blocked
                FROM guardian_actions
                WHERE created_at > NOW() - ($1::interval * 2) AND created_at <= NOW() - $1::interval
            `, [interval])
        ]);

        const cur = current.rows[0];
        const prev = previous.rows[0];
        const totalScanned = parseInt(cur.total_scanned) || 0;
        const totalBlocked = parseInt(cur.total_blocked) || 0;
        const blockRate = totalScanned > 0 ? Math.round((totalBlocked / totalScanned) * 10000) / 100 : 0;
        const prevScanned = parseInt(prev.total_scanned) || 0;
        const prevBlocked = parseInt(prev.total_blocked) || 0;

        res.json({
            totalScanned,
            totalBlocked,
            blockRate,
            falsePositives: parseInt(cur.false_positives) || 0,
            avgResponseTime: cur.avg_response_time ? Math.round(parseFloat(cur.avg_response_time) * 100) / 100 : null,
            trendsVsPrevious: {
                scannedChange: totalScanned - prevScanned,
                blockedChange: totalBlocked - prevBlocked
            }
        });
    } catch (err) {
        log.error('GET /analytics/effectiveness error', err);
        res.status(500).json({ error: 'Failed to fetch effectiveness metrics' });
    }
});

/**
 * GET /api/guardian/analytics/overview
 * Get guardian analytics overview
 */
router.get('/analytics/overview', requireGuardianAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM chat_messages) AS total_messages,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'mute') AS total_mutes,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'mask') AS total_masks,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'conflict') AS total_conflicts,
                (SELECT COUNT(DISTINCT channel_id) FROM chat_messages WHERE created_at > NOW() - INTERVAL '24 hours') AS active_channels,
                (SELECT AVG(score) FROM guardian_channel_health WHERE calculated_at > NOW() - INTERVAL '24 hours') AS health_avg,
                (SELECT AVG(score) FROM guardian_mood_tracking WHERE analyzed_at > NOW() - INTERVAL '24 hours') AS mood_avg
        `);

        const r = result.rows[0];
        res.json({
            totalMessages: parseInt(r.total_messages) || 0,
            totalMutes: parseInt(r.total_mutes) || 0,
            totalMasks: parseInt(r.total_masks) || 0,
            totalConflicts: parseInt(r.total_conflicts) || 0,
            activeChannels: parseInt(r.active_channels) || 0,
            healthAvg: r.health_avg ? Math.round(parseFloat(r.health_avg) * 100) / 100 : null,
            moodAvg: r.mood_avg ? Math.round(parseFloat(r.mood_avg) * 100) / 100 : null
        });
    } catch (err) {
        log.error('GET /analytics/overview error', err);
        res.status(500).json({ error: 'Failed to fetch analytics overview' });
    }
});

// ==========================================
// ESCALATION CONFIG (Phase 3)
// ==========================================

/**
 * GET /api/guardian/escalation
 * Get all escalation config levels
 */
router.get('/escalation', requireGuardianAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, level, name, threshold, action, mute_duration_minutes, notify_telegram, is_active
            FROM guardian_escalation_config
            ORDER BY level ASC
        `);
        res.json(result.rows.map(r => ({
            id: r.id,
            level: r.level,
            name: r.name,
            threshold: r.threshold,
            action: r.action,
            muteDurationMinutes: r.mute_duration_minutes,
            notifyTelegram: r.notify_telegram,
            isActive: r.is_active
        })));
    } catch (err) {
        log.error('GET /escalation error', err);
        res.status(500).json({ error: 'Failed to fetch escalation config' });
    }
});

/**
 * PUT /api/guardian/escalation/:id
 * Update an escalation config level
 */
router.put('/escalation/:id', requireGuardianOwner, async (req, res) => {
    try {
        const { threshold, muteDurationMinutes, notifyTelegram, isActive } = req.body;
        const result = await pool.query(`
            UPDATE guardian_escalation_config SET
                threshold = COALESCE($1, threshold),
                mute_duration_minutes = COALESCE($2, mute_duration_minutes),
                notify_telegram = COALESCE($3, notify_telegram),
                is_active = COALESCE($4, is_active),
                updated_at = NOW()
            WHERE id = $5 RETURNING *
        `, [threshold, muteDurationMinutes, notifyTelegram, isActive, req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Escalation config not found' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('PUT /escalation/:id error', err);
        res.status(500).json({ error: 'Failed to update escalation config' });
    }
});

// ==========================================
// WEEKLY REPORTS (Phase 3)
// ==========================================

/**
 * GET /api/guardian/weekly-reports
 * List recent weekly reports
 */
router.get('/weekly-reports', requireGuardianAdmin, async (req, res) => {
    try {
        const { limit = 4 } = req.query;
        const result = await pool.query(`
            SELECT id, week_start, week_end, summary, stats, top_offenders, recommendations, created_at
            FROM guardian_weekly_reports
            ORDER BY week_start DESC
            LIMIT $1
        `, [parseInt(limit)]);

        res.json(result.rows.map(r => ({
            id: r.id,
            weekStart: r.week_start,
            weekEnd: r.week_end,
            summary: r.summary,
            stats: r.stats,
            topOffenders: r.top_offenders,
            recommendations: r.recommendations,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /weekly-reports error', err);
        res.status(500).json({ error: 'Failed to fetch weekly reports' });
    }
});

/**
 * POST /api/guardian/weekly-reports/generate
 * Manually trigger weekly report generation
 */
router.post('/weekly-reports/generate', requireGuardianAdmin, async (req, res) => {
    try {
        if (!generateWeeklyReport) {
            return res.status(501).json({ error: 'generateWeeklyReport not yet available' });
        }
        const report = await generateWeeklyReport();
        res.json({ success: true, report });
    } catch (err) {
        log.error('POST /weekly-reports/generate error', err);
        res.status(500).json({ error: 'Failed to generate weekly report' });
    }
});

// ==========================================
// GUARDIAN COMMAND (Phase 3)
// ==========================================

/**
 * POST /api/guardian/command
 * Execute a guardian command
 */
router.post('/command', async (req, res) => {
    try {
        const { channelId, command } = req.body;
        if (!command) {
            return res.status(400).json({ error: 'command is required' });
        }
        if (!handleGuardianCommand) {
            return res.status(501).json({ error: 'handleGuardianCommand not yet available' });
        }
        const response = await handleGuardianCommand(
            channelId,
            getCurrentUserId(req),
            req.user?.username,
            command,
            hasExactRole(req, GUARDIAN_ADMIN_ROLES)
        );
        res.json({ success: true, response });
    } catch (err) {
        log.error('POST /command error', err);
        res.status(500).json({ error: 'Failed to execute command' });
    }
});

// ==========================================
// ETAP 1: PER-CHANNEL TOGGLE
// ==========================================

/**
 * POST /api/guardian/toggle
 * Enable/disable Guardian per channel.
 * Body: { channelId, guardianEnabled, contour2Enabled }
 * Auth: creator/director only
 */
router.post('/toggle', requireGuardianOwner, async (req, res) => {
    try {
        const { channelId, guardianEnabled, contour2Enabled } = req.body;
        if (!channelId) {
            return res.status(400).json({ error: 'channelId is required' });
        }

        const updates = [];
        const params = [];
        let paramIdx = 1;

        if (guardianEnabled !== undefined) {
            updates.push(`guardian_enabled = $${paramIdx++}`);
            params.push(!!guardianEnabled);
        }
        if (contour2Enabled !== undefined) {
            updates.push(`contour2_enabled = $${paramIdx++}`);
            params.push(!!contour2Enabled);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        params.push(channelId);
        await pool.query(
            `UPDATE chat_channels SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
            params
        );

        // Invalidate cache
        invalidateChannelSettingsCache(channelId);

        // Return updated settings
        const settings = await getChannelSettings(channelId);

        log.info(`Guardian toggle: channel ${channelId} → guardian=${settings.guardian_enabled}, contour2=${settings.contour2_enabled}`);

        res.json({
            success: true,
            channelId,
            guardianEnabled: settings.guardian_enabled,
            contour2Enabled: settings.contour2_enabled
        });
    } catch (err) {
        log.error('POST /toggle error', err);
        res.status(500).json({ error: 'Failed to toggle guardian' });
    }
});

/**
 * GET /api/guardian/toggle/:channelId
 * Get current toggle state for a channel.
 */
router.get('/toggle/:channelId', requireGuardianAdmin, async (req, res) => {
    try {
        const { channelId } = req.params;
        const settings = await getChannelSettings(parseInt(channelId));
        res.json({
            channelId: parseInt(channelId),
            guardianEnabled: settings.guardian_enabled,
            contour2Enabled: settings.contour2_enabled
        });
    } catch (err) {
        log.error('GET /toggle/:channelId error', err);
        res.status(500).json({ error: 'Failed to get guardian settings' });
    }
});

// ==========================================
// ETAP 1: EMERGENCY STOP
// ==========================================

/**
 * POST /api/guardian/emergency-stop
 * Activate or deactivate Guardian Emergency Stop.
 * Body: { stop: true/false }
 * Auth: creator only
 */
router.post('/emergency-stop', requireGuardianEmergency, async (req, res) => {
    try {
        const { stop } = req.body;
        if (stop === undefined) {
            return res.status(400).json({ error: 'stop (true/false) is required' });
        }

        setEmergencyStop(stop);

        const username = req.user?.username || req.body.username || 'unknown';
        const timestamp = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

        if (stop) {
            // Alert director via Telegram
            alertDirectorTelegram(
                `🛑 <b>Guardian EMERGENCY STOP активовано</b>\n` +
                `Ким: ${username}\n` +
                `Час: ${timestamp}\n` +
                `Усі перевірки зупинено.`,
                'emergency-stop'
            );
            log.warn(`Guardian Emergency Stop ACTIVATED by ${username}`);
        } else {
            alertDirectorTelegram(
                `✅ <b>Guardian EMERGENCY STOP знято</b>\n` +
                `Ким: ${username}\n` +
                `Час: ${timestamp}\n` +
                `Перевірки відновлено.`,
                'emergency-stop-off'
            );
            log.info(`Guardian Emergency Stop DEACTIVATED by ${username}`);
        }

        res.json({ success: true, emergencyStop: getEmergencyStop() });
    } catch (err) {
        log.error('POST /emergency-stop error', err);
        res.status(500).json({ error: 'Failed to set emergency stop' });
    }
});

/**
 * GET /api/guardian/emergency-stop
 * Get current Emergency Stop state.
 */
router.get('/emergency-stop', requireGuardianAdmin, async (req, res) => {
    res.json({ emergencyStop: getEmergencyStop() });
});

// ==========================================
// ETAP 1: WHITELIST MANAGEMENT
// ==========================================

/**
 * GET /api/guardian/whitelist
 * List all whitelist phrases.
 */
router.get('/whitelist', requireGuardianAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT gw.*, u.username AS added_by_username FROM guardian_whitelist gw LEFT JOIN users u ON u.id = gw.added_by ORDER BY gw.created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        log.error('GET /whitelist error', err);
        res.status(500).json({ error: 'Failed to fetch whitelist' });
    }
});

/**
 * POST /api/guardian/whitelist
 * Add a phrase to the whitelist.
 * Body: { phrase }
 */
router.post('/whitelist', requireGuardianAdmin, async (req, res) => {
    try {
        const { phrase } = req.body;
        if (!phrase || !phrase.trim()) {
            return res.status(400).json({ error: 'phrase is required' });
        }
        const userId = req.user?.id || null;
        const result = await pool.query(
            'INSERT INTO guardian_whitelist (phrase, added_by) VALUES ($1, $2) ON CONFLICT (phrase) DO NOTHING RETURNING *',
            [phrase.trim().toLowerCase(), userId]
        );

        // Reload whitelist in service
        const { loadDynamicWhitelist } = require('../services/guardian');
        await loadDynamicWhitelist();

        res.json({ success: true, phrase: phrase.trim().toLowerCase(), inserted: result.rowCount > 0 });
    } catch (err) {
        log.error('POST /whitelist error', err);
        res.status(500).json({ error: 'Failed to add whitelist phrase' });
    }
});

/**
 * DELETE /api/guardian/whitelist/:id
 * Remove a phrase from the whitelist.
 */
router.delete('/whitelist/:id', requireGuardianAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM guardian_whitelist WHERE id = $1', [parseInt(id)]);

        const { loadDynamicWhitelist } = require('../services/guardian');
        await loadDynamicWhitelist();

        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /whitelist/:id error', err);
        res.status(500).json({ error: 'Failed to delete whitelist phrase' });
    }
});

module.exports = router;
