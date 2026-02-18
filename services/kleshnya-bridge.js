/**
 * services/kleshnya-bridge.js — Telegram Bridge to OpenClaw (v2.0)
 *
 * Sends CRM chat messages to the real Kleshnya (@EventHelper_One_Bot)
 * via Telegram API, and handles webhook responses from OpenClaw.
 *
 * Flow:
 *  1. User sends message in CRM → sendToOpenClaw() → Telegram message
 *  2. OpenClaw processes → POST /api/kleshnya/webhook → handleWebhookResponse()
 *  3. CRM saves response + broadcasts via WebSocket
 *
 * Env vars:
 *  KLESHNYA_BRIDGE_CHAT_ID  — Telegram chat where OpenClaw receives messages
 *  KLESHNYA_WEBHOOK_SECRET  — shared secret for webhook validation
 *  MEDIA_CHANNEL_ID         — channel for storing generated media
 */
const { telegramRequest, TELEGRAM_BOT_TOKEN } = require('./telegram');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('KleshnyaBridge');

const KLESHNYA_BRIDGE_CHAT_ID = process.env.KLESHNYA_BRIDGE_CHAT_ID;
const KLESHNYA_WEBHOOK_SECRET = process.env.KLESHNYA_WEBHOOK_SECRET;
const MEDIA_CHANNEL_ID = process.env.MEDIA_CHANNEL_ID;
const BRIDGE_ENABLED = !!(KLESHNYA_BRIDGE_CHAT_ID && TELEGRAM_BOT_TOKEN);

if (BRIDGE_ENABLED) {
    log.info(`OpenClaw bridge enabled → chat_id: ${KLESHNYA_BRIDGE_CHAT_ID}`);
} else {
    log.info('OpenClaw bridge disabled (no KLESHNYA_BRIDGE_CHAT_ID). Using local AI/skills.');
}

if (!KLESHNYA_WEBHOOK_SECRET) {
    log.warn('KLESHNYA_WEBHOOK_SECRET not set — webhook endpoint will reject all requests');
}

/**
 * Send a user message to OpenClaw via Telegram Bot API.
 * Uses the standardized [CRM_CHAT] prefix format.
 *
 * @param {number} sessionId - Chat session ID
 * @param {string} username - CRM username
 * @param {number} messageId - kleshnya_chat message ID
 * @param {string} text - User message text
 * @returns {number|null} Telegram message_id or null on failure
 */
async function sendToOpenClaw(sessionId, username, messageId, text) {
    if (!BRIDGE_ENABLED) return null;

    const formatted = `[CRM_CHAT session:${sessionId} user:${username} msg_id:${messageId}]\n${text}`;

    try {
        const result = await telegramRequest('sendMessage', {
            chat_id: KLESHNYA_BRIDGE_CHAT_ID,
            text: formatted,
            disable_notification: false
        });

        if (result && result.ok && result.result) {
            const tgMsgId = result.result.message_id;
            await pool.query(
                'UPDATE kleshnya_chat SET telegram_message_id = $1 WHERE id = $2',
                [tgMsgId, messageId]
            );
            log.info(`Bridge: sent msg_id=${messageId} session=${sessionId} → tg_msg=${tgMsgId}`);
            return tgMsgId;
        }

        log.warn('Bridge: sendMessage returned error', result);
        return null;
    } catch (err) {
        log.error(`Bridge: send failed — ${err.message}`);
        return null;
    }
}

/**
 * Handle webhook response from OpenClaw.
 * Saves the response to DB and returns a WebSocket event object.
 *
 * @param {object} body - Webhook request body
 * @returns {object|null} WebSocket event to broadcast, or null
 */
async function handleWebhookResponse(body) {
    const { event, session_id, message, media } = body;

    // Find session to get username
    const sessionRes = await pool.query(
        'SELECT username FROM chat_sessions WHERE id = $1',
        [session_id]
    );
    if (sessionRes.rows.length === 0) {
        log.warn(`Webhook: session ${session_id} not found`);
        return null;
    }
    const username = sessionRes.rows[0].username;

    if (event === 'message_reply' && message) {
        // Save assistant text response
        const saved = await pool.query(
            `INSERT INTO kleshnya_chat (username, role, message, session_id, skill_used)
             VALUES ($1, 'assistant', $2, $3, 'openclaw') RETURNING id, created_at`,
            [username, message, session_id]
        );

        // Update session metadata
        await pool.query(
            `UPDATE chat_sessions SET message_count = message_count + 1,
             last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [message.substring(0, 100), session_id]
        );

        // Clear generating flags
        await pool.query(
            'UPDATE kleshnya_chat SET is_generating = FALSE WHERE session_id = $1 AND is_generating = TRUE',
            [session_id]
        );

        log.info(`Webhook: text reply saved for session ${session_id} user=${username}`);

        return {
            type: 'kleshnya:reply',
            sessionId: session_id,
            username,
            message: {
                id: saved.rows[0].id,
                role: 'assistant',
                message,
                created_at: saved.rows[0].created_at,
                source: 'openclaw'
            }
        };
    }

    if (event === 'generation_complete' && media) {
        const mediaText = media.caption || message || 'Медіа готове';
        const mediaType = media.type || 'image';

        // Save media message
        const saved = await pool.query(
            `INSERT INTO kleshnya_chat
             (username, role, message, session_id, media_type, media_file_id, media_caption, skill_used)
             VALUES ($1, 'assistant', $2, $3, $4, $5, $6, 'openclaw')
             RETURNING id, created_at`,
            [username, mediaText, session_id, mediaType, media.telegram_file_id, media.caption]
        );

        // Save to media library
        if (media.telegram_file_id) {
            await pool.query(
                `INSERT INTO kleshnya_media
                 (session_id, message_id, type, telegram_file_id, channel_message_id, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [session_id, saved.rows[0].id, mediaType,
                 media.telegram_file_id, media.channel_message_id, username]
            );
        }

        // Update session
        await pool.query(
            `UPDATE chat_sessions SET message_count = message_count + 1,
             last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [mediaText.substring(0, 100), session_id]
        );

        // Clear generating flags
        await pool.query(
            'UPDATE kleshnya_chat SET is_generating = FALSE WHERE session_id = $1 AND is_generating = TRUE',
            [session_id]
        );

        log.info(`Webhook: media (${mediaType}) saved for session ${session_id}`);

        return {
            type: 'kleshnya:media',
            sessionId: session_id,
            username,
            message: {
                id: saved.rows[0].id,
                role: 'assistant',
                message: mediaText,
                media: {
                    type: mediaType,
                    file_id: media.telegram_file_id,
                    channel_message_id: media.channel_message_id
                },
                created_at: saved.rows[0].created_at,
                source: 'openclaw'
            }
        };
    }

    log.warn(`Webhook: unknown event "${event}"`);
    return null;
}

/**
 * Get a Telegram file URL for a given file_id.
 * Uses Bot API getFile → constructs download URL.
 *
 * @param {string} fileId - Telegram file_id
 * @returns {string|null} Download URL
 */
async function getTelegramFileUrl(fileId) {
    if (!fileId || !TELEGRAM_BOT_TOKEN) return null;

    try {
        const result = await telegramRequest('getFile', { file_id: fileId });
        if (result && result.ok && result.result && result.result.file_path) {
            return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${result.result.file_path}`;
        }
    } catch (err) {
        log.error(`getFile error for ${fileId}: ${err.message}`);
    }
    return null;
}

module.exports = {
    sendToOpenClaw,
    handleWebhookResponse,
    getTelegramFileUrl,
    BRIDGE_ENABLED,
    KLESHNYA_WEBHOOK_SECRET,
    KLESHNYA_BRIDGE_CHAT_ID,
    MEDIA_CHANNEL_ID
};
