const crypto = require('node:crypto');
const { pool: defaultPool } = require('../db');
const { createLogger } = require('../utils/logger');
const { broadcastToChannel: defaultBroadcastToChannel } = require('./websocket');
const { provisionGuardianDirectorDm: defaultProvisionGuardianDirectorDm } = require('./guardianDmProvisioning');

const log = createLogger('GuardianDelivery');

const GUARDIAN_DIRECTOR_DM_REQUESTED = 'guardian.director_dm.requested';
const GUARDIAN_TELEGRAM_ALERT_REQUESTED = 'guardian.telegram_alert.requested';
const GUARDIAN_DELIVERY_EVENT_TYPES = new Set([
    GUARDIAN_DIRECTOR_DM_REQUESTED,
    GUARDIAN_TELEGRAM_ALERT_REQUESTED
]);

function parsePayload(payload) {
    if (!payload) return {};
    if (typeof payload === 'string') return JSON.parse(payload);
    return payload;
}

function shortHash(value) {
    return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

function buildGuardianDeliveryIdempotencyKey(kind, sourceKey) {
    const raw = `guardian.${kind}:${sourceKey ?? 'none'}`;
    const normalized = raw.replace(/[^a-zA-Z0-9_.:-]/g, '-');
    return normalized.length <= 96 ? normalized : `guardian.${kind}:${shortHash(normalized)}`;
}

function withStableActionTokens(actions, deliveryKey) {
    return (actions || []).map((action, index) => ({
        ...action,
        actionToken: action.actionToken || `guardian-action:${shortHash(deliveryKey)}:${index}`
    }));
}

async function getDirectorUserId(dbPool) {
    const result = await dbPool.query(
        "SELECT id FROM users WHERE role = 'admin' AND is_active = true ORDER BY id LIMIT 1"
    );
    return result.rows[0]?.id || null;
}

async function getGuardianUserId(dbPool) {
    const existing = await dbPool.query(
        "SELECT id FROM users WHERE username = $1",
        ['guardian']
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;

    const inserted = await dbPool.query(
        "INSERT INTO users (username, password_hash, name, role) VALUES ($1, '$2b$10$placeholder', 'Guardian', 'bot') ON CONFLICT (username) DO UPDATE SET name = 'Guardian' RETURNING id",
        ['guardian']
    );
    return inserted.rows[0]?.id || null;
}

async function deliverDirectorDm(payload, event, deps = {}) {
    const dbPool = deps.pool || defaultPool;
    const provisionGuardianDirectorDm = deps.provisionGuardianDirectorDm || defaultProvisionGuardianDirectorDm;
    const broadcastToChannel = deps.broadcastToChannel || defaultBroadcastToChannel;
    const deliveryKey = event.idempotency_key || payload.deliveryKey;

    if (!deliveryKey) {
        throw new Error('Guardian director DM delivery requires a delivery key');
    }

    const existing = await dbPool.query(
        `SELECT id
         FROM chat_messages
         WHERE metadata->>'deliveryKey' = $1
         LIMIT 1`,
        [deliveryKey]
    );
    if (existing.rows.length > 0) {
        log.info(`Guardian director DM duplicate skipped: ${deliveryKey}`);
        return { delivered: false, duplicate: true, messageId: existing.rows[0].id };
    }

    const directorId = await getDirectorUserId(dbPool);
    if (!directorId) {
        throw new Error('Guardian director DM delivery cannot find director user');
    }

    const guardianId = await getGuardianUserId(dbPool);
    if (!guardianId) {
        throw new Error('Guardian director DM delivery cannot find guardian user');
    }

    const { channelId } = await provisionGuardianDirectorDm({ pool: dbPool, guardianId, directorId });
    const actionMetadata = withStableActionTokens(payload.actions || [], deliveryKey);
    const metadataObject = {
        source: 'guardian',
        deliveryKey,
        deliveryType: payload.deliveryType || 'director_dm',
        sourceType: payload.sourceType || null,
        sourceId: payload.sourceId || null,
        actions: actionMetadata
    };

    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const duplicate = await client.query(
            `SELECT id
             FROM chat_messages
             WHERE metadata->>'deliveryKey' = $1
             LIMIT 1
             FOR UPDATE`,
            [deliveryKey]
        );
        if (duplicate.rows.length > 0) {
            await client.query('COMMIT');
            return { delivered: false, duplicate: true, messageId: duplicate.rows[0].id };
        }

        const seqResult = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
        const seq = seqResult.rows[0].seq;
        const result = await client.query(
            `INSERT INTO chat_messages (channel_id, user_id, seq, content, is_bot, content_type, metadata)
             VALUES ($1, $2, $3, $4, true, 'bot', $5)
             RETURNING *`,
            [channelId, guardianId, seq, payload.content, JSON.stringify(metadataObject)]
        );
        await client.query('COMMIT');

        const msg = result.rows[0];
        broadcastToChannel(channelId, 'chat:message', {
            channelId,
            message: {
                id: msg.id,
                channelId: msg.channel_id,
                userId: msg.user_id,
                seq: msg.seq,
                content: msg.content,
                isBot: true,
                contentType: 'bot',
                metadata: metadataObject,
                createdAt: msg.created_at,
                username: 'guardian',
                displayName: 'Guardian'
            }
        });

        log.info(`Guardian director DM delivered: ${deliveryKey}`);
        return { delivered: true, duplicate: false, messageId: msg.id };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}

async function deliverTelegramAlert(payload, event, deps = {}) {
    const fetchImpl = deps.fetchImpl || globalThis.fetch;
    const telegramBotToken = deps.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN;
    const bossTelegramId = deps.bossTelegramId ?? process.env.BOSS_TELEGRAM_ID ?? process.env.TELEGRAM_CHAT_ID;
    const deliveryKey = event.idempotency_key || payload.deliveryKey;

    if (!telegramBotToken || !bossTelegramId) {
        log.warn(`Guardian Telegram delivery skipped, Telegram env is not configured: ${deliveryKey || 'unknown'}`);
        return { delivered: false, skipped: true };
    }

    const response = await fetchImpl(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: bossTelegramId,
            text: payload.content,
            parse_mode: payload.parseMode || 'HTML'
        })
    });

    if (!response || response.ok === false) {
        let detail = '';
        try {
            detail = typeof response?.text === 'function' ? await response.text() : '';
        } catch {}
        throw new Error(`Guardian Telegram delivery failed (${response?.status || 'no-status'}): ${detail}`.slice(0, 500));
    }

    log.info(`Guardian Telegram delivered: ${deliveryKey || payload.alertType || 'unknown'}`);
    return { delivered: true };
}

async function processGuardianDeliveryEvent(event, deps = {}) {
    if (!GUARDIAN_DELIVERY_EVENT_TYPES.has(event.event_type)) return false;

    const payload = parsePayload(event.payload);
    if (event.event_type === GUARDIAN_DIRECTOR_DM_REQUESTED) {
        await deliverDirectorDm(payload, event, deps);
        return true;
    }
    if (event.event_type === GUARDIAN_TELEGRAM_ALERT_REQUESTED) {
        await deliverTelegramAlert(payload, event, deps);
        return true;
    }
    return false;
}

module.exports = {
    GUARDIAN_DELIVERY_EVENT_TYPES,
    GUARDIAN_DIRECTOR_DM_REQUESTED,
    GUARDIAN_TELEGRAM_ALERT_REQUESTED,
    buildGuardianDeliveryIdempotencyKey,
    deliverDirectorDm,
    deliverTelegramAlert,
    processGuardianDeliveryEvent,
    withStableActionTokens
};
