/**
 * services/kleshnya-bridge.js — HTTP Polling Bridge to OpenClaw (v3.0)
 *
 * Polling architecture (no Telegram dependency):
 *  1. User sends message in CRM → saved to DB with is_generating=TRUE
 *  2. OpenClaw polls GET /api/kleshnya/pending-messages every ~30s
 *  3. OpenClaw processes → POST /api/kleshnya/webhook → handleWebhookResponse()
 *  4. CRM saves response + broadcasts via WebSocket
 *
 * Env vars:
 *  KLESHNYA_WEBHOOK_SECRET  — shared secret for webhook + polling auth
 *  MEDIA_CHANNEL_ID         — channel for storing generated media
 */
const { telegramRequest, TELEGRAM_BOT_TOKEN } = require('./telegram');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('KleshnyaBridge');

const KLESHNYA_WEBHOOK_SECRET = process.env.KLESHNYA_WEBHOOK_SECRET;
const MEDIA_CHANNEL_ID = process.env.MEDIA_CHANNEL_ID;
const BRIDGE_ENABLED = !!KLESHNYA_WEBHOOK_SECRET;

if (BRIDGE_ENABLED) {
    log.info('OpenClaw bridge enabled (HTTP polling mode)');
} else {
    log.info('OpenClaw bridge disabled (no KLESHNYA_WEBHOOK_SECRET). Using local AI/skills.');
}

/**
 * Atomically fetch and mark pending messages for OpenClaw.
 * Uses UPDATE ... RETURNING to prevent double-pickup.
 *
 * Messages are "pending" when: role='user', is_generating=TRUE, telegram_message_id IS NULL
 * After pickup: telegram_message_id is set to -1 (marker for "picked up by OpenClaw")
 *
 * @returns {Array} pending messages with session context
 */
async function getPendingMessages() {
    // Atomically mark pending messages as picked up and return them
    const result = await pool.query(
        `UPDATE kleshnya_chat
         SET telegram_message_id = -1
         WHERE id IN (
             SELECT kc.id FROM kleshnya_chat kc
             JOIN chat_sessions cs ON cs.id = kc.session_id
             WHERE kc.role = 'user'
               AND kc.is_generating = TRUE
               AND kc.telegram_message_id IS NULL
             ORDER BY kc.created_at ASC
             LIMIT 20
         )
         RETURNING id, session_id, username, message, created_at`
    );

    if (result.rows.length > 0) {
        log.info(`Pending: ${result.rows.length} message(s) picked up by OpenClaw`);
    }

    return result.rows;
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
 * Still uses Telegram API for media file downloads.
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

/**
 * Fallback for stale pending messages.
 * If OpenClaw hasn't responded within TIMEOUT_SEC, generate a local response.
 * Called from scheduler every 30s.
 */
const STALE_TIMEOUT_SEC = 90;

async function processStaleMessages(generateFn, addMessageFn, getChatHistoryFn, sendWsFn) {
    try {
        // Find messages that have been generating for too long
        const stale = await pool.query(
            `SELECT kc.id, kc.session_id, kc.username, kc.message
             FROM kleshnya_chat kc
             WHERE kc.role = 'user'
               AND kc.is_generating = TRUE
               AND kc.created_at < NOW() - INTERVAL '${STALE_TIMEOUT_SEC} seconds'
             ORDER BY kc.created_at ASC
             LIMIT 5`
        );

        if (stale.rows.length === 0) return;

        log.info(`Fallback: ${stale.rows.length} stale message(s) — switching to local engine`);

        for (const msg of stale.rows) {
            try {
                // Clear generating flag on the user message
                await pool.query(
                    'UPDATE kleshnya_chat SET is_generating = FALSE WHERE id = $1',
                    [msg.id]
                );

                // Generate local response
                const chatHistory = await getChatHistoryFn(msg.username, 20, msg.session_id);
                const result = await generateFn(msg.message, msg.username, chatHistory);

                // Save assistant response
                const saved = await addMessageFn(
                    msg.username, 'assistant', result.message, msg.session_id, result.skill_used
                );

                // Update session
                await pool.query(
                    `UPDATE chat_sessions SET message_count = message_count + 1,
                     last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
                    [result.message.substring(0, 100), msg.session_id]
                );

                // Broadcast via WebSocket
                sendWsFn(msg.username, 'kleshnya:reply', {
                    id: saved.id,
                    role: 'assistant',
                    message: result.message,
                    created_at: saved.created_at,
                    source: result.source || 'skills',
                    session_id: msg.session_id
                });

                log.info(`Fallback: replied to msg ${msg.id} session ${msg.session_id} via local engine`);
            } catch (err) {
                log.error(`Fallback: error processing msg ${msg.id} — ${err.message}`);
                // Still clear the flag so user isn't stuck
                await pool.query(
                    'UPDATE kleshnya_chat SET is_generating = FALSE WHERE id = $1',
                    [msg.id]
                ).catch(() => {});
            }
        }
    } catch (err) {
        log.error(`Fallback scheduler error: ${err.message}`);
    }
}

module.exports = {
    getPendingMessages,
    handleWebhookResponse,
    getTelegramFileUrl,
    processStaleMessages,
    BRIDGE_ENABLED,
    KLESHNYA_WEBHOOK_SECRET,
    MEDIA_CHANNEL_ID
};
