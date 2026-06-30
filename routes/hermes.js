/**
 * routes/hermes.js — minimal Hermes worker API for notification_outbox.
 * Clean-branch compatibility route: exposes only notification_outbox endpoints.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const {
    ackNotificationOutboxEvent,
    claimNotificationOutboxEvent,
    failNotificationOutboxEvent,
    findNotificationOutboxEventByEventId,
    getNotificationOutboxStats,
    listNotificationOutboxDebugEvents,
    listNotificationOutboxEvents,
    toNotificationOutboxApiEvent
} = require('../services/notificationOutbox');

const log = createLogger('Hermes');
const SUPPORTED_ACTIONS = [
    'notification_outbox.read',
    'notification_outbox.detail',
    'notification_outbox.claim',
    'notification_outbox.ack',
    'notification_outbox.fail',
    'notification_outbox.stats',
    'notification_outbox.debug'
];

function extractBearer(req) {
    const value = String(req.headers.authorization || '');
    const match = value.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function hermesAuth(req, res, next) {
    const configured = String(
        process.env.HERMES_API_KEY ||
        process.env.HERMES_SHARED_SECRET ||
        process.env.HERMES_TOKEN ||
        ''
    ).trim();

    if (!configured && process.env.NODE_ENV !== 'test') {
        return res.status(503).json({
            success: false,
            code: 'HERMES_API_KEY_NOT_CONFIGURED',
            error: 'Hermes API key is not configured'
        });
    }

    if (configured) {
        const supplied = String(req.get('x-hermes-api-key') || extractBearer(req) || '').trim();
        if (supplied !== configured) {
            return res.status(401).json({
                success: false,
                code: 'HERMES_UNAUTHORIZED',
                error: 'Hermes API key is invalid or missing'
            });
        }
    }

    return next();
}

function sendHermesError(res, err, fallbackCode = 'HERMES_INTERNAL_ERROR', fallbackMessage = 'Hermes notification_outbox error') {
    const status = Number(err?.statusCode || err?.status || 500);
    const code = err?.code || fallbackCode;
    const message = err?.message || fallbackMessage;
    if (status >= 500) log.error(fallbackMessage, err);
    return res.status(status).json({ success: false, code, error: message, meta: err?.meta || undefined });
}

router.use(hermesAuth);

router.get('/capabilities', (req, res) => {
    res.json({ success: true, integration: 'hermes', actions: SUPPORTED_ACTIONS });
});

router.get('/notification-outbox', async (req, res) => {
    try {
        const result = await listNotificationOutboxEvents({
            status: req.query.status,
            limit: req.query.limit,
            cursor: req.query.cursor,
            ownerUserId: req.query.ownerUserId || req.query.owner_user_id,
            eventType: req.query.eventType || req.query.event_type
        }, { pool });
        res.json({
            success: true,
            events: result.events.map(toNotificationOutboxApiEvent).filter(Boolean),
            pagination: result.pagination
        });
    } catch (err) {
        sendHermesError(res, err, 'OUTBOX_LIST_FAILED', 'Failed to list notification_outbox events');
    }
});

router.get('/notification-outbox/stats', async (req, res) => {
    try {
        const result = await getNotificationOutboxStats({ pool });
        res.json({ success: true, ...result });
    } catch (err) {
        sendHermesError(res, err, 'OUTBOX_STATS_FAILED', 'Failed to read notification_outbox stats');
    }
});

router.get('/notification-outbox/debug', async (req, res) => {
    try {
        const result = await listNotificationOutboxDebugEvents({
            status: req.query.status,
            limit: req.query.limit
        }, { pool });
        res.json({ success: true, ...result });
    } catch (err) {
        sendHermesError(res, err, 'OUTBOX_DEBUG_FAILED', 'Failed to read notification_outbox debug data');
    }
});

router.get('/notification-outbox/:eventId', async (req, res) => {
    try {
        const event = await findNotificationOutboxEventByEventId(req.params.eventId, { pool });
        if (!event) return res.status(404).json({ success: false, code: 'OUTBOX_EVENT_NOT_FOUND', error: 'notification_outbox event was not found' });
        res.json({ success: true, event: toNotificationOutboxApiEvent(event) });
    } catch (err) {
        sendHermesError(res, err, 'OUTBOX_DETAIL_FAILED', 'Failed to read notification_outbox event');
    }
});

router.post('/notification-outbox/:eventId/claim', async (req, res) => {
    try {
        const result = await claimNotificationOutboxEvent(req.params.eventId, req.body || {}, { pool });
        res.json({ success: true, ...result, event: toNotificationOutboxApiEvent(result.event) });
    } catch (err) {
        sendHermesError(res, err, 'OUTBOX_CLAIM_FAILED', 'Failed to claim notification_outbox event');
    }
});

router.post('/notification-outbox/:eventId/ack', async (req, res) => {
    try {
        const result = await ackNotificationOutboxEvent(req.params.eventId, req.body || {}, { pool });
        res.json({ success: true, ...result, event: toNotificationOutboxApiEvent(result.event) });
    } catch (err) {
        sendHermesError(res, err, 'OUTBOX_ACK_FAILED', 'Failed to ack notification_outbox event');
    }
});

router.post('/notification-outbox/:eventId/fail', async (req, res) => {
    try {
        const result = await failNotificationOutboxEvent(req.params.eventId, req.body || {}, { pool });
        res.json({ success: true, ...result, event: toNotificationOutboxApiEvent(result.event) });
    } catch (err) {
        sendHermesError(res, err, 'OUTBOX_FAIL_FAILED', 'Failed to fail notification_outbox event');
    }
});

module.exports = router;
