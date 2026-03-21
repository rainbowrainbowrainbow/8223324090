/**
 * services/notificationDigest.js — Notification digest grouping (v22.18)
 *
 * Groups Telegram notifications by time window instead of sending each instantly.
 * Modes: instant (default), 5min, 15min, 1hour
 */
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('NotificationDigest');

// In-memory buffer for grouped notifications (keyed by chatId)
const _digestBuffer = new Map();
let _flushTimer = null;

const DIGEST_INTERVALS = {
    '5min': 5 * 60 * 1000,
    '15min': 15 * 60 * 1000,
    '1hour': 60 * 60 * 1000
};

/**
 * Get the global digest mode from settings (default: instant)
 */
async function getDigestMode() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'notification_digest_mode'");
        return result.rows[0]?.value || 'instant';
    } catch {
        return 'instant';
    }
}

/**
 * Queue a notification for digest sending.
 * If mode is 'instant', sends immediately.
 * Otherwise, buffers and flushes at the configured interval.
 */
async function queueNotification(text, bookingId, notificationType) {
    const mode = await getDigestMode();

    if (mode === 'instant') {
        return null; // Caller should send directly
    }

    const chatId = await getConfiguredChatId();
    if (!chatId) return null;

    // Store in DB queue for durability
    await pool.query(
        `INSERT INTO notification_queue (chat_id, text, booking_id, notification_type)
         VALUES ($1, $2, $3, $4)`,
        [chatId, text, bookingId || null, notificationType || null]
    );

    // Ensure flush timer is running
    ensureFlushTimer(mode);

    return 'queued';
}

/**
 * Ensure a periodic flush timer is active
 */
function ensureFlushTimer(mode) {
    // Clear existing timer when mode changes
    if (_flushTimer) {
        clearInterval(_flushTimer);
        _flushTimer = null;
    }

    const interval = DIGEST_INTERVALS[mode];
    if (!interval) return;

    _flushTimer = setInterval(async () => {
        try {
            await flushDigest();
        } catch (err) {
            log.error('Digest flush error', err);
        }
    }, interval);

    log.info(`Digest timer started: ${mode} (${interval / 1000}s)`);
}

/**
 * Flush all pending notifications as a single grouped message
 */
async function flushDigest() {
    const chatId = await getConfiguredChatId();
    if (!chatId) return 0;

    // Get unsent notifications
    const result = await pool.query(
        `SELECT id, text, notification_type, created_at
         FROM notification_queue
         WHERE sent_at IS NULL
         ORDER BY created_at ASC
         LIMIT 50`
    );

    if (result.rows.length === 0) return 0;

    const batchId = `digest-${Date.now()}`;
    const count = result.rows.length;

    // Group by type
    const grouped = {};
    for (const row of result.rows) {
        const type = row.notification_type || 'other';
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(row.text);
    }

    // Build digest message
    const TYPE_ICONS = {
        create: '🆕',
        edit: '✏️',
        status_change: '🔄',
        delete: '🗑️',
        other: '📋'
    };

    let digestText = `📬 <b>Дайджест сповіщень</b> (${count} подій)\n\n`;

    for (const [type, texts] of Object.entries(grouped)) {
        const icon = TYPE_ICONS[type] || '📋';
        digestText += `${icon} <b>${type}</b> (${texts.length}):\n`;

        // Show first 3 in detail, summarize rest
        const shown = texts.slice(0, 3);
        const remaining = texts.length - shown.length;

        for (const text of shown) {
            // Extract key info (first line or first 80 chars)
            const summary = text.split('\n')[0].slice(0, 80);
            digestText += `  • ${summary}\n`;
        }

        if (remaining > 0) {
            digestText += `  <i>...та ще ${remaining}</i>\n`;
        }
        digestText += '\n';
    }

    // Send grouped message
    await sendTelegramMessage(chatId, digestText);

    // Mark as sent
    const ids = result.rows.map(r => r.id);
    await pool.query(
        `UPDATE notification_queue SET sent_at = NOW(), batch_id = $1 WHERE id = ANY($2)`,
        [batchId, ids]
    );

    log.info(`Digest sent: ${count} notifications in batch ${batchId}`);
    return count;
}

/**
 * Stop the flush timer (for graceful shutdown)
 */
function stopDigestTimer() {
    if (_flushTimer) {
        clearInterval(_flushTimer);
        _flushTimer = null;
    }
}

module.exports = {
    queueNotification,
    flushDigest,
    getDigestMode,
    stopDigestTimer,
    ensureFlushTimer
};
