/**
 * routes/chat.js — Team messenger REST API
 */
const router = require('express').Router();
const crypto = require('crypto');
const multer = require('multer');
const chat = require('../services/chatService');
const { broadcastToChannel, sendToUser } = require('../services/websocket');
const {
    prepareChatUploadBlob,
    validateChatUploadFile
} = require('../services/chatUploadStorage');
const { processMessage: processBotMessage } = require('../services/chat-bot');
const guardian = require('../services/guardian');
const linkPreview = require('../services/linkPreview');
const { createLogger } = require('../utils/logger');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const dashboardAssistant = require('../services/dashboardAssistant');
const { callUnifiedChatCompletion } = require('../services/ai-config');
const { emitTaskCreatedNotificationOutboxEvent } = require('../services/notificationOutbox');

const { authenticateToken, requireRole, ROLE_HIERARCHY } = require('../middleware/auth');

const log = createLogger('ChatAPI');

const CHAT_ACCESS_ROLES = ROLE_HIERARCHY.filter(role => role !== 'waiter');

// All chat routes require authentication and /chat page-level access.
router.use(authenticateToken);
router.use(requireRole(...CHAT_ACCESS_ROLES));

// Chat message rate limiter: max 1 msg per 500ms per user, 60 msgs/min per channel
const _chatRateLimits = new Map(); // userId → { lastSent, channelCounts: Map<channelId, {count, resetAt}> }

function _checkChatRateLimit(userId, channelId) {
    const now = Date.now();
    if (!_chatRateLimits.has(userId)) {
        _chatRateLimits.set(userId, { lastSent: 0, channelCounts: new Map() });
    }
    const userLimit = _chatRateLimits.get(userId);

    // Per-user throttle: 500ms between messages
    if (now - userLimit.lastSent < 500) {
        return 'Зачекайте перед наступним повідомленням';
    }

    // Per-channel limit: 60 messages per minute
    let chLimit = userLimit.channelCounts.get(channelId);
    if (!chLimit || now > chLimit.resetAt) {
        chLimit = { count: 0, resetAt: now + 60000 };
        userLimit.channelCounts.set(channelId, chLimit);
    }
    if (chLimit.count >= 60) {
        return 'Ліміт повідомлень у каналі (60/хв). Зачекайте.';
    }

    userLimit.lastSent = now;
    chLimit.count++;
    return null;
}

// Cleanup rate limit maps every 5 minutes
const _chatRateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of _chatRateLimits) {
        if (now - data.lastSent > 120000) {
            _chatRateLimits.delete(userId);
        }
    }
}, 300000);
if (_chatRateLimitCleanup.unref) _chatRateLimitCleanup.unref();

// Auto-generate VAPID keys if not set
let _vapidReady = false;
try {
    const webpush = require('web-push');
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        const vapidKeys = webpush.generateVAPIDKeys();
        process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
        process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
        log.info('VAPID keys auto-generated (set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY env vars for persistence)');
    }
    webpush.setVapidDetails(
        'mailto:' + (process.env.VAPID_EMAIL || 'admin@eventgenix.com'),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    _vapidReady = true;
} catch (err) {
    log.warn('web-push init failed:', err.message);
}

// Push notification helper (fire-and-forget)
async function sendPushToChannel(channelId, senderUserId, title, body) {
    if (!_vapidReady) return;
    try {
        const webpush = require('web-push');

        const pool = require('../db').pool;
        // Get push subscriptions for channel members (excluding sender)
        const subs = await pool.query(`
            SELECT ps.endpoint, ps.p256dh, ps.auth, ps.user_id
            FROM push_subscriptions ps
            JOIN chat_channel_members ccm ON ccm.user_id = ps.user_id
            WHERE ccm.channel_id = $1 AND ps.user_id != $2
        `, [channelId, senderUserId]);

        const payload = JSON.stringify({
            title: title,
            body: body.length > 100 ? body.slice(0, 100) + '…' : body,
            tag: 'chat-' + channelId,
            url: '/chat.html',
            channelId: channelId
        });

        for (const sub of subs.rows) {
            webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
            }, payload).catch(() => {
                // Remove stale subscriptions
                pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]).catch(() => {});
            });
        }
    } catch (err) {
        // web-push not installed or VAPID not configured — skip silently
        if (err.code !== 'MODULE_NOT_FOUND') {
            log.error('Push notification error', err);
        }
    }
}

// File upload config
const chatUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        try {
            validateChatUploadFile(file);
            cb(null, true);
        } catch (err) {
            return cb(err);
        }
    }
});

function handleChatUpload(req, res, next) {
    chatUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 400);
        res.status(status).json({ error: err.message || 'Unsupported file upload' });
    });
}

function getCurrentUserId(req) {
    return req.user.id || req.user.userId;
}

function parseId(value) {
    const id = parseInt(value, 10);
    return Number.isNaN(id) ? null : id;
}

function buildChatReminderSourceId(messageId, userId, remindAtIso) {
    const digest = crypto
        .createHash('sha1')
        .update(`${messageId}:${userId}:${remindAtIso}`)
        .digest('hex')
        .slice(0, 32);
    return `chat-rem:${digest}`;
}

async function createChatReminderTask({ pool, message, user, remindAtIso }) {
    const userId = user.id || user.userId;
    const sourceId = buildChatReminderSourceId(message.id, userId, remindAtIso);
    const titleText = String(message.content || '').slice(0, 80);
    const title = `⏰ Нагадування: "${titleText}"`;
    const description = `Нагадування з чату (канал #${message.channel_id}, msg #${message.id})`;
    const controlPolicy = JSON.stringify({
        reminder_minutes: [60, 30, 10],
        escalation_after_minutes: 120
    });
    const createdBy = user.username || user.name || String(userId);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
            ['chat_reminder', sourceId]
        );

        const existing = await client.query(`
            SELECT id
            FROM tasks
            WHERE source_type = 'chat_reminder'
              AND source_id = $1
              AND COALESCE(status, 'todo') NOT IN ('done', 'archived', 'cancelled')
            ORDER BY id DESC
            LIMIT 1
        `, [sourceId]);

        if (existing.rows.length > 0) {
            await client.query('COMMIT');
            return { taskId: existing.rows[0].id, sourceId, duplicate: true };
        }

        const taskRes = await client.query(`
            INSERT INTO tasks (
                title, description, deadline, priority, status, assigned_to, owner, owner_user_id,
                created_by, created_by_user_id, category, task_type, dependency_ids, control_policy,
                source_type, source_id, type, task_mode, task_kind, visibility, workflow_state,
                remind_at, source_module
            )
            VALUES (
                $1, $2, $3, 'normal', 'todo', $4, $4, $5,
                $4, $5, 'admin', 'human', ARRAY[]::INTEGER[], $6::jsonb,
                'chat_reminder', $7, 'manual', 'personal', 'reminder', 'private', 'inbox',
                $3, 'chat'
            )
            RETURNING *
        `, [title, description, remindAtIso, createdBy, userId, controlPolicy, sourceId]);

        const task = taskRes.rows[0];
        const taskId = task.id;
        await emitTaskCreatedNotificationOutboxEvent(task, { pool: client });
        await client.query(`
            INSERT INTO task_logs (task_id, action, old_value, new_value, actor)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            taskId,
            'created_from_chat_reminder',
            null,
            JSON.stringify({ message_id: message.id, channel_id: message.channel_id, remind_at: remindAtIso, source_id: sourceId }),
            createdBy
        ]);

        await client.query('COMMIT');
        return { taskId, sourceId, duplicate: false };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function requireChannelMemberOrRespond(channelId, userId, res) {
    if (!await chat.isMember(channelId, userId)) {
        res.status(403).json({ error: 'Not a member of this channel' });
        return false;
    }
    return true;
}

async function requireChannelMember(req, res, next) {
    try {
        const channelId = parseId(req.params.id);
        if (!channelId) return res.status(400).json({ error: 'Invalid channel ID' });

        const userId = getCurrentUserId(req);
        if (!await requireChannelMemberOrRespond(channelId, userId, res)) return;

        req.chatChannelId = channelId;
        next();
    } catch (err) {
        log.error('Chat membership guard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function getMessageForChannelMember(messageId, userId, res) {
    if (!messageId) {
        res.status(400).json({ error: 'Invalid message ID' });
        return null;
    }
    const msg = await chat.getMessageById(messageId);
    if (!msg) {
        res.status(404).json({ error: 'Message not found' });
        return null;
    }
    if (!await requireChannelMemberOrRespond(msg.channel_id, userId, res)) return null;
    return msg;
}

async function getPollForChannelMember(pollId, userId, res) {
    if (!pollId) {
        res.status(400).json({ error: 'Invalid poll ID' });
        return null;
    }
    const pool = require('../db').pool;
    const pollResult = await pool.query('SELECT * FROM chat_polls WHERE id = $1', [pollId]);
    if (pollResult.rows.length === 0) {
        res.status(404).json({ error: 'Опитування не знайдено' });
        return null;
    }
    const poll = pollResult.rows[0];
    if (!await requireChannelMemberOrRespond(poll.channel_id, userId, res)) return null;
    return { poll, pool };
}

function getPollOptions(poll) {
    return typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;
}

function buildProvisioningSlug(prefix, value) {
    const raw = String(value || '').trim();
    const digest = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-') || digest;
    const maxBaseLength = Math.max(1, 50 - prefix.length - digest.length - 2);
    return `${prefix}-${normalized.slice(0, maxBaseLength)}-${digest}`;
}

function readInsertedFlag(row) {
    return row?.inserted === true || row?.inserted === 't' || row?.inserted === 'true';
}

async function provisionBookingChatChannel({ pool, bookingId, userId, actor }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query(`
            SELECT *
            FROM chat_channels
            WHERE linked_booking_id = $1
              AND COALESCE(is_archived, false) = false
            ORDER BY id ASC
            LIMIT 1
            FOR UPDATE
        `, [bookingId]);
        if (existing.rows.length > 0) {
            await client.query('COMMIT');
            return { channel: existing.rows[0], isNew: false, existingByLink: true };
        }

        const bookingParams = [bookingId];
        const bookingScope = getVisibleBookingScope(actor, bookingParams, 'b');
        const booking = await client.query(
            `SELECT b.id, b.date, b.program_name, b.label
             FROM bookings b
             WHERE b.id = $1
             ${bookingScope.sql}`,
            bookingParams
        );
        if (!booking.rowCount) {
            await client.query('ROLLBACK');
            return { notFound: true };
        }

        const b = booking.rows[0];
        const slug = buildProvisioningSlug('bk', bookingId);
        const name = `🎉 ${b.date} ${b.program_name || bookingId}`;
        const description = `Координація: ${b.label || bookingId}`;
        const inserted = await client.query(`
            INSERT INTO chat_channels (slug, name, description, type, linked_booking_id, created_by)
            VALUES ($1, $2, $3, 'booking', $4, $5)
            ON CONFLICT (slug) DO UPDATE SET
                linked_booking_id = COALESCE(chat_channels.linked_booking_id, EXCLUDED.linked_booking_id),
                type = CASE
                    WHEN chat_channels.type IS NULL OR chat_channels.type = 'general' THEN EXCLUDED.type
                    ELSE chat_channels.type
                END,
                updated_at = NOW()
            RETURNING *, (xmax = 0) AS inserted
        `, [slug, name, description, bookingId, userId]);
        const channel = inserted.rows[0];
        await client.query(
            'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT (channel_id, user_id) DO NOTHING',
            [channel.id, userId]
        );

        await client.query('COMMIT');
        return { channel, isNew: readInsertedFlag(channel), existingByLink: false };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function provisionRoomChatChannel({ pool, lineId, userId }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query(`
            SELECT *
            FROM chat_channels
            WHERE line_id = $1
              AND type = 'room'
              AND COALESCE(is_archived, false) = false
            ORDER BY id ASC
            LIMIT 1
            FOR UPDATE
        `, [lineId]);
        if (existing.rows.length > 0) {
            await client.query('COMMIT');
            return { channel: existing.rows[0], isNew: false, existingByLine: true };
        }

        const slug = buildProvisioningSlug('room', lineId);
        const inserted = await client.query(`
            INSERT INTO chat_channels (slug, name, type, line_id, description, created_by)
            VALUES ($1, $2, 'room', $3, $4, $5)
            ON CONFLICT (slug) DO UPDATE SET
                line_id = COALESCE(chat_channels.line_id, EXCLUDED.line_id),
                type = CASE
                    WHEN chat_channels.type IS NULL OR chat_channels.type = 'general' THEN EXCLUDED.type
                    ELSE chat_channels.type
                END,
                updated_at = NOW()
            RETURNING *, (xmax = 0) AS inserted
        `, [slug, `🏠 ${lineId}`, lineId, `Хронологія кімнати ${lineId}`, userId]);
        const channel = inserted.rows[0];
        await client.query(
            'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT (channel_id, user_id) DO NOTHING',
            [channel.id, userId]
        );

        await client.query('COMMIT');
        return { channel, isNew: readInsertedFlag(channel), existingByLine: false };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// GET /api/chat/channels — list user's channels + unread counts
router.get('/channels', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        await chat.ensureDefaultMemberships(userId);
        const channels = await chat.getChannels(userId);
        res.json(channels);
    } catch (err) {
        log.error('Error fetching channels', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/channels/:id/messages — paginated messages
router.get('/channels/:id/messages', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

        if (!await chat.isMember(channelId, userId)) {
            return res.status(403).json({ error: 'Not a member of this channel' });
        }

        const before = req.query.before ? parseInt(req.query.before, 10) : undefined;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

        const messages = await chat.getChannelMessages(channelId, userId, { before, limit });
        res.json(messages);
    } catch (err) {
        log.error('Error fetching messages', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/channels/:id/messages — send message
router.post('/channels/:id/messages', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

        const { content, replyTo, clientMessageId, metadata } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ error: 'Message content is required' });
        }
        if (content.length > 4000) {
            return res.status(400).json({ error: 'Message too long (max 4000 chars)' });
        }

        // Rate limiting
        const rateLimitMsg = _checkChatRateLimit(userId, channelId);
        if (rateLimitMsg) {
            return res.status(429).json({ error: rateLimitMsg });
        }

        if (!await chat.isMember(channelId, userId)) {
            return res.status(403).json({ error: 'Not a member of this channel' });
        }

        // v33.7.0: Announce mode — only admins can write
        const pool = require('../db').pool;
        const chAnnounce = await pool.query('SELECT is_announce FROM chat_channels WHERE id = $1', [channelId]);
        if (chAnnounce.rows[0]?.is_announce === true) {
            const canWrite = ['admin', 'director', 'senior_manager'].includes(req.user.role);
            if (!canWrite) {
                return res.status(403).json({ error: '📢 Цей канал тільки для оголошень. Тільки адміністратори можуть писати.' });
            }
        }

        // Guardian: pre-check BEFORE saving (mute + keyword + LLM profanity)
        const username = req.user.username || req.user.name || 'unknown';
        const preCheck = await guardian.preCheckMessage({
            channelId,
            userId,
            username,
            content: content.trim()
        });
        if (preCheck.blocked) {
            const guardianMessage = preCheck.publicMessage || preCheck.message;
            return res.status(403).json({ error: guardianMessage || '🛡️ Повідомлення заблоковано.' });
        }

        const { message, mentionedUserIds } = await chat.sendMessage(channelId, userId, {
            content: content.trim(),
            replyTo: replyTo || null,
            clientMessageId: clientMessageId || null,
            metadata: metadata || null
        });

        // Track activity stats (fire-and-forget)
        chat.updateActivityStats(userId, 'messages_sent').catch(() => {});
        if (replyTo) chat.updateActivityStats(userId, 'replies_sent').catch(() => {});

        // Broadcast to channel members via WebSocket (fire-and-forget after commit)
        broadcastToChannel(channelId, 'chat:message', {
            channelId,
            message
        }, String(userId));

        // v33.7.0: BK preview — fire-and-forget
        const _bkMatch = content.match(/\bBK-\d{4}-\d{4,}\b/i);
        if (_bkMatch) {
            const _bkId = _bkMatch[0].toUpperCase();
            const _msgId = message.id;
            setImmediate(async () => {
                try {
                    const bkParams = [_bkId];
                    const bkScope = getVisibleBookingScope(req.user, bkParams, 'b');
                    const bkData = await pool.query(
                        `SELECT b.id, b.date, b.time, b.program_name, b.label, b.status, b.price
                         FROM bookings b
                         WHERE b.id = $1
                         ${bkScope.sql}`,
                        bkParams
                    );
                    if (!bkData.rowCount) return;
                    const b = bkData.rows[0];
                    const preview = {
                        id: b.id, date: b.date, time: String(b.time).slice(0, 5),
                        programName: b.program_name, label: b.label, status: b.status, price: b.price
                    };
                    await pool.query(
                        `UPDATE chat_messages SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
                        [JSON.stringify({ bookingPreview: preview }), _msgId]
                    );
                    broadcastToChannel(channelId, 'chat:booking-preview', {
                        channelId, messageId: _msgId, bookingPreview: preview
                    });
                } catch (e) { /* silent */ }
            });
        }

        // Send mention notifications to specific users
        for (const mentionedId of mentionedUserIds) {
            sendToUser(String(mentionedId), 'chat:mention', {
                channelId,
                messageId: message.id,
                mentionedBy: message.username,
                content: message.content
            });
        }

        // Push notifications for offline users (fire-and-forget)
        sendPushToChannel(channelId, userId, message.displayName || message.username, message.content);

        // Bot processing (fire-and-forget — don't block response)
        processBotMessage(message).catch(err => {
            log.error('Bot processing error', err);
        });

        // Guardian background processing (mask sensitive data, detect conflicts)
        guardian.processMessage(message).catch(err => {
            log.error('Guardian processing error', err);
        });

        // Link preview processing (fire-and-forget — sends WS update when ready)
        linkPreview.processMessageLinks(message.id, content).then(ogData => {
            if (ogData) {
                broadcastToChannel(channelId, 'chat:link-preview', {
                    channelId,
                    messageId: message.id,
                    linkPreview: ogData
                });
            }
        }).catch(err => {
            log.debug('Link preview error: ' + err.message);
        });

        res.status(201).json(message);
    } catch (err) {
        log.error('Error sending message', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/channels/:id/upload — upload file to channel
router.post('/channels/:id/upload', requireChannelMember, handleChatUpload, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const channelId = req.chatChannelId;
        if (isNaN(channelId) || !req.file) {
            return res.status(400).json({ error: 'Invalid channel ID or missing file' });
        }

        const file = req.file;
        const stored = prepareChatUploadBlob(file, { channelId });
        const fileUrl = stored.publicUrl;
        const contentType = stored.kind;
        const isImage = contentType === 'image';
        const caption = req.body.caption || '';

        const metadata = {
            file: {
                url: fileUrl,
                name: file.originalname,
                size: file.size,
                mimeType: stored.contentType || file.mimetype,
                type: contentType,
                duration: parseInt(req.body.duration) || 0,
                storageProvider: stored.provider,
                storageBucket: stored.bucket,
                storageKey: stored.key,
                storagePath: stored.path,
                storageUrl: stored.publicUrl
            },
            duration: parseInt(req.body.duration) || 0
        };

        // Send as message with file metadata
        const content = caption || (isImage ? '📷 Фото' : '📎 ' + file.originalname);
        const sendFile = typeof chat.sendFileMessageWithUpload === 'function'
            ? chat.sendFileMessageWithUpload.bind(chat)
            : chat.sendFileMessage.bind(chat);
        const result = await sendFile(channelId, userId, content, contentType, metadata, { file, storage: stored });
        const { message, mentionedUserIds } = result;

        broadcastToChannel(channelId, 'chat:message', { channelId, message }, String(userId));

        for (const mentionedId of mentionedUserIds) {
            sendToUser(String(mentionedId), 'chat:mention', {
                channelId, messageId: message.id,
                mentionedBy: message.username, content: message.content
            });
        }

        res.status(201).json(message);
    } catch (err) {
        log.error('Error uploading file', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/chat/channels/:id/read — mark channel as read
router.put('/channels/:id/read', requireChannelMember, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const channelId = req.chatChannelId;
        const { seq } = req.body;
        if (isNaN(channelId) || !seq) {
            return res.status(400).json({ error: 'Invalid channel ID or seq' });
        }

        await chat.markAsRead(channelId, userId, seq);

        // Broadcast read receipt
        broadcastToChannel(channelId, 'chat:read', {
            channelId,
            userId,
            seq
        }, String(userId));

        res.json({ success: true });
    } catch (err) {
        log.error('Error marking as read', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/channels/:id/read-receipts — get who read what
router.get('/channels/:id/read-receipts', requireChannelMember, async (req, res) => {
    try {
        const channelId = req.chatChannelId;
        if (isNaN(channelId)) {
            return res.status(400).json({ error: 'Invalid channel ID' });
        }
        const receipts = await chat.getReadReceipts(channelId);
        res.json(receipts);
    } catch (err) {
        log.error('Error getting read receipts', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/messages/:id/reactions — add reaction
router.post('/messages/:id/reactions', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const messageId = parseInt(req.params.id, 10);
        const { emoji } = req.body;
        if (isNaN(messageId) || !emoji) {
            return res.status(400).json({ error: 'Invalid message ID or emoji' });
        }

        const msg = await getMessageForChannelMember(messageId, userId, res);
        if (!msg) return;

        const reactions = await chat.addReaction(messageId, userId, emoji);

        // Track reaction stats (fire-and-forget)
        chat.updateActivityStats(userId, 'reactions_given').catch(() => {});
        if (msg.user_id !== userId) {
            chat.updateActivityStats(msg.user_id, 'reactions_received').catch(() => {});
        }

        broadcastToChannel(msg.channel_id, 'chat:reaction', {
            channelId: msg.channel_id,
            messageId,
            reactions,
            emoji
        });

        res.json({ reactions });
    } catch (err) {
        log.error('Error adding reaction', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/chat/messages/:id/reactions/:emoji — remove reaction
router.delete('/messages/:id/reactions/:emoji', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const messageId = parseInt(req.params.id, 10);
        const emoji = decodeURIComponent(req.params.emoji);
        if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

        const msg = await getMessageForChannelMember(messageId, userId, res);
        if (!msg) return;

        const reactions = await chat.removeReaction(messageId, userId, emoji);

        broadcastToChannel(msg.channel_id, 'chat:reaction', {
            channelId: msg.channel_id,
            messageId,
            reactions
        });

        res.json({ reactions });
    } catch (err) {
        log.error('Error removing reaction', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/unread — global unread counts
router.get('/unread', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        await chat.ensureDefaultMemberships(userId);
        const counts = await chat.getUnreadCounts(userId);
        res.json(counts);
    } catch (err) {
        log.error('Error fetching unread counts', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/users — user list for @mention autocomplete
router.get('/users', async (req, res) => {
    try {
        const users = await chat.getChatUsers();
        res.json(users);
    } catch (err) {
        log.error('Error fetching chat users', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/channels — create new channel
router.post('/channels', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { name, description } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Channel name is required' });
        }
        const slug = name.trim().toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '-').replace(/-+/g, '-');
        const channel = await chat.createChannel(slug, '#' + name.trim(), description || '', userId);
        res.status(201).json(channel);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Канал з такою назвою вже існує' });
        }
        log.error('Error creating channel', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/assistant/transcript - import current CRM assistant dialog into Chat
router.post('/assistant/transcript', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { conversationId, sessionId, pageTitle, page, returnUrl, messages } = req.body || {};
        if (!Array.isArray(messages)) {
            return res.status(400).json({ error: 'Assistant transcript messages are required' });
        }
        if (messages.length > 120) {
            return res.status(400).json({ error: 'Assistant transcript is too long' });
        }
        const result = await chat.importAssistantTranscript(userId, {
            conversationId,
            sessionId,
            pageTitle,
            page,
            returnUrl,
            messages
        });
        res.json({
            success: true,
            channel: result.channel,
            imported: result.imported,
            skipped: result.skipped,
            messages: result.messages
        });
    } catch (err) {
        log.error('Error importing assistant transcript', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/assistant/reply - continue the canonical CRM assistant dialog inside Chat
router.post('/assistant/reply', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const body = req.body || {};
        const channelId = parseInt(body.channelId, 10);
        const content = String(body.content || body.message || '').trim().slice(0, 1800);
        if (!Number.isFinite(channelId) || channelId <= 0 || !content) {
            return res.status(400).json({ error: 'Assistant channel and message are required' });
        }

        const assistantChannel = await chat.getOrCreateAssistantChannel(userId);
        if (Number(assistantChannel.id) !== channelId || !await chat.isMember(channelId, userId)) {
            return res.status(403).json({ error: 'This channel is not your assistant dialog' });
        }

        const recentMessages = await chat.getChannelMessages(channelId, userId, { limit: 18 });
        const chatHistory = recentMessages
            .filter(message => message && !message.deletedAt && String(message.content || '').trim())
            .map(message => ({
                role: message.isBot || message.username === 'openclaw' ? 'assistant' : 'user',
                text: String(message.content || '').slice(0, 700),
                at: message.createdAt || null
            }))
            .slice(-16);

        const conversationId = String(body.conversationId || `assistant-chat-${userId}`).slice(0, 120);
        const sessionId = String(body.sessionId || body.assistantSessionId || '').slice(0, 120);
        const pageTitle = String(body.pageTitle || 'CRM Chat: Помічник').slice(0, 160);
        const page = String(body.page || 'chat').slice(0, 80);
        const returnUrl = String(body.returnUrl || '/chat').slice(0, 240);
        const reply = await dashboardAssistant.getDashboardAssistantReply({
            userMessage: content,
            intent: content,
            userId,
            username: req.user.username || '',
            name: req.user.name || req.user.displayName || '',
            role: req.user.role || '',
            displayRole: req.user.displayRole || '',
            page,
            title: pageTitle,
            view: 'assistant_chat',
            sourceSurface: 'crm_chat_assistant_channel',
            conversationId,
            chatHistory,
            contextSummary: {
                source: 'CRM Chat #Помічник',
                pageTitle,
                returnUrl,
                instruction: 'Продовжуй той самий діалог Помічника у чаті. Відповідай коротко і по суті.'
            },
            fallbackReason: chatHistory.length ? '' : 'assistant_chat_history_limited'
        });

        const replyText = String(reply.summary || reply.text || reply.subtitle || '').trim();
        if (!replyText) {
            return res.status(502).json({ error: 'assistant_empty_reply' });
        }

        const imported = await chat.importAssistantTranscript(userId, {
            conversationId,
            sessionId,
            pageTitle,
            page,
            returnUrl,
            messages: [{
                id: `chat-reply-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
                role: 'assistant',
                text: replyText,
                at: new Date().toISOString(),
                sessionId
            }]
        });

        res.json({
            success: true,
            channel: imported.channel,
            reply,
            message: imported.messages[imported.messages.length - 1] || null
        });
    } catch (err) {
        log.error('Error continuing assistant chat dialog', err);
        const status = err.status && err.status < 500 ? err.status : 500;
        res.status(status).json({ error: err.code || 'assistant_chat_reply_failed' });
    }
});

// PUT /api/chat/messages/:id — edit message
router.put('/messages/:id', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const messageId = parseInt(req.params.id, 10);
        const { content } = req.body;
        if (isNaN(messageId) || !content || !content.trim()) {
            return res.status(400).json({ error: 'Invalid message ID or content' });
        }
        if (content.length > 4000) {
            return res.status(400).json({ error: 'Message too long (max 4000 chars)' });
        }
        const msg = await chat.editMessage(messageId, userId, content.trim());
        if (!msg) return res.status(403).json({ error: 'Cannot edit this message' });

        broadcastToChannel(msg.channelId, 'chat:edit', {
            channelId: msg.channelId,
            message: msg
        });

        res.json(msg);
    } catch (err) {
        log.error('Error editing message', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/chat/messages/:id — soft-delete message
router.delete('/messages/:id', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const messageId = parseInt(req.params.id, 10);
        if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

        const isAdmin = req.user.role === 'admin';
        const deleted = await chat.deleteMessage(messageId, userId, isAdmin);
        if (!deleted) return res.status(403).json({ error: 'Cannot delete this message' });

        broadcastToChannel(deleted.channel_id, 'chat:delete', {
            channelId: deleted.channel_id,
            messageId: deleted.id
        });

        res.json({ success: true });
    } catch (err) {
        log.error('Error deleting message', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/channels/:id/pinned — get pinned messages
router.get('/channels/:id/pinned', requireChannelMember, async (req, res) => {
    try {
        const channelId = req.chatChannelId;
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
        const pinned = await chat.getPinnedMessages(channelId);
        res.json(pinned);
    } catch (err) {
        log.error('Error fetching pinned messages', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/channels/:id/pinned — pin a message
router.post('/channels/:id/pinned', requireChannelMember, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const channelId = req.chatChannelId;
        const { messageId } = req.body;
        if (isNaN(channelId) || !messageId) {
            return res.status(400).json({ error: 'Invalid channel or message ID' });
        }
        const msg = await getMessageForChannelMember(parseInt(messageId, 10), userId, res);
        if (!msg) return;
        if (msg.channel_id !== channelId) {
            return res.status(400).json({ error: 'Message does not belong to this channel' });
        }
        await chat.pinMessage(channelId, messageId, userId);

        broadcastToChannel(channelId, 'chat:pin', { channelId, messageId, pinned: true });

        res.json({ success: true });
    } catch (err) {
        log.error('Error pinning message', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/chat/channels/:id/pinned/:messageId — unpin a message
router.delete('/channels/:id/pinned/:messageId', requireChannelMember, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const channelId = req.chatChannelId;
        const messageId = parseInt(req.params.messageId, 10);
        if (isNaN(channelId) || isNaN(messageId)) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }
        const msg = await getMessageForChannelMember(messageId, userId, res);
        if (!msg) return;
        if (msg.channel_id !== channelId) {
            return res.status(400).json({ error: 'Message does not belong to this channel' });
        }
        await chat.unpinMessage(channelId, messageId);

        broadcastToChannel(channelId, 'chat:pin', { channelId, messageId, pinned: false });

        res.json({ success: true });
    } catch (err) {
        log.error('Error unpinning message', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/chat/channels/:id/mute — toggle mute
router.put('/channels/:id/mute', requireChannelMember, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const channelId = req.chatChannelId;
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
        const muted = await chat.toggleMute(channelId, userId);
        res.json({ muted });
    } catch (err) {
        log.error('Error toggling mute', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/channels/:id/members — channel members
router.get('/channels/:id/members', requireChannelMember, async (req, res) => {
    try {
        const channelId = req.chatChannelId;
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
        const members = await chat.getChannelMembers(channelId);
        res.json(members);
    } catch (err) {
        log.error('Error fetching members', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/channels/:id/join — join channel
router.post('/channels/:id/join', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
        await chat.joinChannel(channelId, userId);
        res.json({ success: true });
    } catch (err) {
        log.error('Error joining channel', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/dm — get or create DM with another user
router.post('/dm', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { targetUserId } = req.body;
        if (!targetUserId || targetUserId === userId) {
            return res.status(400).json({ error: 'Invalid target user' });
        }
        const channel = await chat.getOrCreateDM(userId, parseInt(targetUserId, 10));
        res.json(channel);
    } catch (err) {
        log.error('Error creating DM', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/channels/:id/members — add member to channel
router.post('/channels/:id/members', requireChannelMember, async (req, res) => {
    try {
        const channelId = req.chatChannelId;
        let targetUserId = req.body.userId;
        // Support adding by username (e.g., guardian invite)
        if (!targetUserId && req.body.username) {
            const userLookup = await require('../db').pool.query('SELECT id FROM users WHERE username = $1', [req.body.username]);
            if (userLookup.rows.length > 0) targetUserId = userLookup.rows[0].id;
        }
        if (isNaN(channelId) || !targetUserId) {
            return res.status(400).json({ error: 'Invalid channel or user ID' });
        }
        await chat.addMember(channelId, parseInt(targetUserId, 10));

        broadcastToChannel(channelId, 'chat:member-added', {
            channelId,
            userId: targetUserId
        });

        // Notify the invited user directly (they're not subscribed to the channel yet)
        sendToUser(String(targetUserId), 'chat:channel-invite', {
            channelId
        });

        res.json({ success: true });
    } catch (err) {
        log.error('Error adding member', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/chat/channels/:id/members/:userId — remove member from channel
router.delete('/channels/:id/members/:userId', requireChannelMember, async (req, res) => {
    try {
        const channelId = req.chatChannelId;
        const targetUserId = parseInt(req.params.userId, 10);
        if (isNaN(channelId) || isNaN(targetUserId)) {
            return res.status(400).json({ error: 'Invalid IDs' });
        }
        await chat.removeMember(channelId, targetUserId);
        res.json({ success: true });
    } catch (err) {
        log.error('Error removing member', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/users/:id/profile — get user profile
router.get('/users/:id/profile', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
        const profile = await chat.getUserProfile(userId);
        if (!profile) return res.status(404).json({ error: 'User not found' });
        res.json(profile);
    } catch (err) {
        log.error('Error fetching user profile', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/chat/users/me/avatar — update own avatar
router.patch('/users/me/avatar', async (req, res) => {
    try {
        const { avatarEmoji, avatarColor } = req.body;
        const userId = req.user.id;
        await pool.query(
            'UPDATE users SET avatar_emoji = $1, avatar_color = $2 WHERE id = $3',
            [avatarEmoji || null, avatarColor || null, userId]
        );
        res.json({ success: true, avatarEmoji, avatarColor });
    } catch (err) {
        log.error('Error updating avatar', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/chat/channels/:id — update channel name/description
router.patch('/channels/:id', requireChannelMember, async (req, res) => {
    try {
        const channelId = req.chatChannelId;
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
        const { name, description, isArchived } = req.body;
        // Archive via dedicated method if requested
        if (isArchived === true) {
            await chat.archiveChannel(channelId);
            return res.json({ success: true });
        }
        const updated = await chat.updateChannel(channelId, { name, description });
        if (!updated) return res.status(404).json({ error: 'Channel not found' });
        res.json(updated);
    } catch (err) {
        log.error('Error updating channel', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/chat/channels/:id — archive channel
router.delete('/channels/:id', requireChannelMember, async (req, res) => {
    try {
        const channelId = req.chatChannelId;
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
        await chat.archiveChannel(channelId);
        res.json({ success: true });
    } catch (err) {
        log.error('Error archiving channel', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/search — search messages (enhanced with filters)
router.get('/search', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const q = req.query.q;
        if (!q || q.trim().length < 2) {
            return res.status(400).json({ error: 'Query must be at least 2 characters' });
        }
        const filters = {
            channelId: req.query.channel_id ? parseInt(req.query.channel_id, 10) : null,
            fromUser: req.query.from_user || null,
            dateFrom: req.query.date_from || null,
            dateTo: req.query.date_to || null,
            type: req.query.type || null // 'files', 'links', 'mentions'
        };
        const results = await chat.searchMessages(userId, q.trim(), filters.channelId, filters);
        res.json(results);
    } catch (err) {
        log.error('Error searching messages', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/tasks — get user's tasks
router.get('/tasks', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const tasks = await chat.getTasks(userId);
        res.json(tasks);
    } catch (err) {
        log.error('Error fetching tasks', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/tasks — create task from chat
router.post('/tasks', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { channelId, messageId, assignedTo, title, deadline } = req.body;
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Task title is required' });
        }
        const parsedChannelId = channelId ? parseId(channelId) : null;
        const parsedMessageId = messageId ? parseId(messageId) : null;
        const parsedAssignedTo = assignedTo ? parseId(assignedTo) : null;
        if (channelId && !parsedChannelId) return res.status(400).json({ error: 'Invalid channel ID' });
        if (messageId && !parsedMessageId) return res.status(400).json({ error: 'Invalid message ID' });
        if (assignedTo && !parsedAssignedTo) return res.status(400).json({ error: 'Invalid assignee ID' });
        if (channelId) {
            if (!await requireChannelMemberOrRespond(parsedChannelId, userId, res)) return;
            if (messageId) {
                const msg = await getMessageForChannelMember(parsedMessageId, userId, res);
                if (!msg) return;
                if (msg.channel_id !== parsedChannelId) {
                    return res.status(400).json({ error: 'Message does not belong to this channel' });
                }
            }
        } else if (messageId) {
            const msg = await getMessageForChannelMember(parsedMessageId, userId, res);
            if (!msg) return;
        }
        const taskResult = await chat.createTask({
            channelId: parsedChannelId,
            messageId: parsedMessageId,
            assignedTo: parsedAssignedTo,
            assignedBy: userId,
            title: title.trim(),
            deadline: deadline || null
        });
        const hasCreateMeta = taskResult && Object.prototype.hasOwnProperty.call(taskResult, 'task');
        const task = hasCreateMeta ? taskResult.task : taskResult;
        const created = hasCreateMeta ? taskResult.created !== false : true;

        // Broadcast task to channel
        if (parsedChannelId && created) {
            broadcastToChannel(parsedChannelId, 'chat:task', { channelId: parsedChannelId, task });
        }

        res.status(created ? 201 : 200).json(created ? task : { ...task, duplicate: true });
    } catch (err) {
        log.error('Error creating task', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/chat/tasks/:id — update task status
router.patch('/tasks/:id', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const taskId = parseInt(req.params.id, 10);
        if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task ID' });
        const { status } = req.body;
        if (!['open', 'in_progress', 'done'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const task = await chat.updateTask(taskId, userId, { status, role: req.user.role });
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json(task);
    } catch (err) {
        log.error('Error updating task', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// THREADS
// ==========================================

// GET /api/chat/messages/:id/thread — get thread messages
router.get('/messages/:id/thread', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const messageId = parseInt(req.params.id, 10);
        if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

        const rootMessage = await getMessageForChannelMember(messageId, userId, res);
        if (!rootMessage) return;

        const pool = require('../db').pool;
        const result = await pool.query(`
            SELECT cm.*, u.username, u.name AS display_name
            FROM chat_messages cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.thread_root_id = $1 AND cm.deleted_at IS NULL
            ORDER BY cm.seq ASC
            LIMIT 200
        `, [messageId]);

        res.json(result.rows.map(r => chat.mapMessageRow(r)));
    } catch (err) {
        log.error('Error loading thread', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/messages/:id/thread — reply in thread
router.post('/messages/:id/thread', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const rootMessageId = parseInt(req.params.id, 10);
        const { content } = req.body;
        if (isNaN(rootMessageId) || !content || !content.trim()) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const pool = require('../db').pool;
        const rootMsg = await getMessageForChannelMember(rootMessageId, userId, res);
        if (!rootMsg) return;
        const channelId = rootMsg.channel_id;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const seqResult = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
            const seq = seqResult.rows[0].seq;

            const msgResult = await client.query(`
                INSERT INTO chat_messages (channel_id, user_id, seq, content, thread_root_id, reply_to)
                VALUES ($1, $2, $3, $4, $5, $5)
                RETURNING *
            `, [channelId, userId, seq, content.trim(), rootMessageId]);

            // Update reply count on root message
            await client.query(
                'UPDATE chat_messages SET thread_reply_count = COALESCE(thread_reply_count, 0) + 1 WHERE id = $1',
                [rootMessageId]
            );

            await client.query(
                'UPDATE chat_channel_members SET last_read_seq = $1 WHERE channel_id = $2 AND user_id = $3',
                [seq, channelId, userId]
            );

            await client.query('COMMIT');

            const fullMsg = await pool.query(`
                SELECT cm.*, u.username, u.name AS display_name
                FROM chat_messages cm JOIN users u ON u.id = cm.user_id WHERE cm.id = $1
            `, [msgResult.rows[0].id]);

            const message = chat.mapMessageRow(fullMsg.rows[0]);

            // Broadcast thread reply
            broadcastToChannel(channelId, 'chat:thread-reply', {
                channelId,
                rootMessageId,
                message
            });

            res.status(201).json(message);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        log.error('Error sending thread reply', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// BOOKMARKS
// ==========================================

// POST /api/chat/bookmarks — save message bookmark
router.post('/bookmarks', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { messageId, category, note } = req.body;
        if (!messageId) return res.status(400).json({ error: 'Missing messageId' });
        const msg = await getMessageForChannelMember(parseId(messageId), userId, res);
        if (!msg) return;

        const pool = require('../db').pool;
        await pool.query(
            `INSERT INTO chat_bookmarks (user_id, message_id, category, note)
             VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, message_id) DO UPDATE SET category = $3, note = $4`,
            [userId, messageId, category || 'general', note || null]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Error saving bookmark', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/bookmarks — list user bookmarks
router.get('/bookmarks', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const category = req.query.category || null;
        const pool = require('../db').pool;

        let query = `
            SELECT b.*, cm.content, cm.created_at AS message_date, cm.channel_id,
                   u.username, u.name AS display_name, cc.name AS channel_name
            FROM chat_bookmarks b
            JOIN chat_messages cm ON cm.id = b.message_id
            JOIN users u ON u.id = cm.user_id
            JOIN chat_channels cc ON cc.id = cm.channel_id
            JOIN chat_channel_members ccm ON ccm.channel_id = cm.channel_id AND ccm.user_id = b.user_id
            WHERE b.user_id = $1`;
        const params = [userId];

        if (category) {
            query += ' AND b.category = $2';
            params.push(category);
        }
        query += ' ORDER BY b.created_at DESC LIMIT 100';

        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            messageId: r.message_id,
            content: r.content,
            messageDate: r.message_date,
            channelId: r.channel_id,
            channelName: r.channel_name,
            username: r.username,
            displayName: r.display_name || r.username,
            category: r.category,
            note: r.note,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('Error loading bookmarks', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/chat/bookmarks/:id — remove bookmark
router.delete('/bookmarks/:id', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const pool = require('../db').pool;
        await pool.query('DELETE FROM chat_bookmarks WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        res.json({ success: true });
    } catch (err) {
        log.error('Error removing bookmark', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// SELF-DESTRUCT MESSAGES
// ==========================================

// POST /api/chat/channels/:id/ephemeral — send message that auto-deletes
router.post('/channels/:id/ephemeral', requireChannelMember, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const channelId = req.chatChannelId;
        const { content, expiresInMinutes } = req.body;
        if (isNaN(channelId) || !content || !expiresInMinutes) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        const expiresAt = new Date(Date.now() + expiresInMinutes * 60000).toISOString();

        const pool = require('../db').pool;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const seqResult = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
            const seq = seqResult.rows[0].seq;
            const result = await client.query(`
                INSERT INTO chat_messages (channel_id, user_id, seq, content, expires_at, metadata)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [channelId, userId, seq, content, expiresAt,
                JSON.stringify({ ephemeral: true, expiresInMinutes })]);

            await client.query(
                'UPDATE chat_channel_members SET last_read_seq = $1 WHERE channel_id = $2 AND user_id = $3',
                [seq, channelId, userId]
            );
            await client.query('COMMIT');

            const fullMsg = await pool.query(`
                SELECT cm.*, u.username, u.name AS display_name
                FROM chat_messages cm JOIN users u ON u.id = cm.user_id WHERE cm.id = $1
            `, [result.rows[0].id]);
            const message = chat.mapMessageRow(fullMsg.rows[0]);

            broadcastToChannel(channelId, 'chat:message', { channelId, message }, String(userId));
            res.status(201).json(message);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        log.error('Error sending ephemeral message', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// SCHEDULED MESSAGES
// ==========================================

// POST /api/chat/channels/:id/schedule — schedule a message
router.post('/channels/:id/schedule', requireChannelMember, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const channelId = req.chatChannelId;
        const { content, scheduledAt } = req.body;
        if (isNaN(channelId) || !content || !scheduledAt) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        const pool = require('../db').pool;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const seqResult = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
            const seq = seqResult.rows[0].seq;
            const result = await client.query(`
                INSERT INTO chat_messages (channel_id, user_id, seq, content, is_scheduled, scheduled_at)
                VALUES ($1, $2, $3, $4, true, $5)
                RETURNING *
            `, [channelId, userId, seq, content, scheduledAt]);
            await client.query('COMMIT');

            res.status(201).json({
                id: result.rows[0].id,
                content,
                scheduledAt,
                channelId
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        log.error('Error scheduling message', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/scheduled — list user's scheduled messages
router.get('/scheduled', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const pool = require('../db').pool;
        const result = await pool.query(`
            SELECT cm.*, cc.name AS channel_name
            FROM chat_messages cm
            JOIN chat_channels cc ON cc.id = cm.channel_id
            WHERE cm.user_id = $1 AND cm.is_scheduled = true AND cm.scheduled_at > NOW()
            ORDER BY cm.scheduled_at
        `, [userId]);
        res.json(result.rows.map(r => ({
            id: r.id, content: r.content, channelId: r.channel_id,
            channelName: r.channel_name, scheduledAt: r.scheduled_at
        })));
    } catch (err) {
        log.error('Error listing scheduled', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// TRANSLATE
// ==========================================

// POST /api/chat/translate — translate message text
router.post('/translate', async (req, res) => {
    try {
        const { text, targetLang } = req.body;
        if (!text) return res.status(400).json({ error: 'Missing text' });

        const lang = targetLang || 'en';
        const result = await callUnifiedChatCompletion({
            scope: 'chat_ai',
            title: 'Event Genix Chat Translate',
            systemPrompt: `Translate the user text to ${lang === 'uk' ? 'Ukrainian' : 'English'}. Return only the translation, without explanations.`,
            userMessage: text,
            maxTokens: 500
        });

        if (!result.ok || !result.text) {
            return res.json({ translated: text, note: result.reason || 'AI provider unavailable' });
        }

        res.json({ translated: result.text, provider: result.provider, model: result.model });
    } catch (err) {
        log.error('Error translating', err);
        res.json({ translated: req.body.text });
    }
});

// ==========================================
// STICKERS
// ==========================================

// GET /api/chat/stickers — list all sticker packs with stickers
router.get('/stickers', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const packs = await pool.query('SELECT * FROM chat_sticker_packs ORDER BY is_default DESC, name');
        const stickers = await pool.query('SELECT * FROM chat_stickers ORDER BY pack_id, sort_order');

        const result = packs.rows.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            coverUrl: p.cover_url,
            isDefault: p.is_default,
            stickers: stickers.rows
                .filter(s => s.pack_id === p.id)
                .map(s => ({ id: s.id, emoji: s.emoji, url: s.url, altText: s.alt_text }))
        }));

        // If no packs, return built-in dino stickers
        if (result.length === 0) {
            result.push({
                id: 0, name: 'Дино Парк 🦕', description: 'Стікери парку', isDefault: true,
                stickers: [
                    { id: 1, emoji: '🦕', url: '', altText: 'Дружній діно' },
                    { id: 2, emoji: '🦖', url: '', altText: 'Хижий діно' },
                    { id: 3, emoji: '🥚', url: '', altText: 'Яйце діно' },
                    { id: 4, emoji: '🌋', url: '', altText: 'Вулкан' },
                    { id: 5, emoji: '🦴', url: '', altText: 'Кістка' },
                    { id: 6, emoji: '🌴', url: '', altText: 'Пальма' },
                    { id: 7, emoji: '🦎', url: '', altText: 'Ящірка' },
                    { id: 8, emoji: '🐊', url: '', altText: 'Крокодил' },
                    { id: 9, emoji: '🎉', url: '', altText: 'Свято' },
                    { id: 10, emoji: '🎂', url: '', altText: 'Торт' },
                    { id: 11, emoji: '🎈', url: '', altText: 'Кулька' },
                    { id: 12, emoji: '🎪', url: '', altText: 'Цирк' },
                    { id: 13, emoji: '🏰', url: '', altText: 'Замок' },
                    { id: 14, emoji: '🎠', url: '', altText: 'Карусель' },
                    { id: 15, emoji: '🧸', url: '', altText: 'Ведмедик' },
                    { id: 16, emoji: '🦁', url: '', altText: 'Лев' }
                ]
            });
        }
        res.json(result);
    } catch (err) {
        log.error('Error loading stickers', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GIF SEARCH
// ==========================================

// GET /api/chat/gifs — search GIFs via Tenor
router.get('/gifs', async (req, res) => {
    try {
        const query = req.query.q || 'trending';
        const tenorKey = process.env.TENOR_API_KEY;
        if (!tenorKey) {
            // Fallback: built-in dino/park themed emoji "GIFs"
            const builtinGifs = [
                { id: 'b1', title: 'Дино танцює', preview: '', url: '', emoji: '🦕💃' },
                { id: 'b2', title: 'Вечірка', preview: '', url: '', emoji: '🎉🥳🎊' },
                { id: 'b3', title: 'Вогонь', preview: '', url: '', emoji: '🔥🔥🔥' },
                { id: 'b4', title: 'Серце', preview: '', url: '', emoji: '❤️‍🔥' },
                { id: 'b5', title: 'Сміх', preview: '', url: '', emoji: '😂🤣' },
                { id: 'b6', title: 'Хижак', preview: '', url: '', emoji: '🦖🔥' },
                { id: 'b7', title: 'Круто', preview: '', url: '', emoji: '😎👍' },
                { id: 'b8', title: 'Плач', preview: '', url: '', emoji: '😭💔' },
                { id: 'b9', title: 'Шок', preview: '', url: '', emoji: '😱🤯' },
                { id: 'b10', title: 'Аплодисменти', preview: '', url: '', emoji: '👏👏👏' },
                { id: 'b11', title: 'Дино парк', preview: '', url: '', emoji: '🦕🌴🌋' },
                { id: 'b12', title: 'Торт', preview: '', url: '', emoji: '🎂🎈🎁' },
                { id: 'b13', title: 'Рок', preview: '', url: '', emoji: '🤘🎸🎵' },
                { id: 'b14', title: 'Спорт', preview: '', url: '', emoji: '⚽🏆🥇' },
                { id: 'b15', title: 'Привіт', preview: '', url: '', emoji: '👋😊' },
                { id: 'b16', title: 'Бай', preview: '', url: '', emoji: '👋😢' },
                { id: 'b17', title: 'Їжа', preview: '', url: '', emoji: '🍕🍔🌮' },
                { id: 'b18', title: 'Кіно', preview: '', url: '', emoji: '🎬🍿' },
                { id: 'b19', title: 'Сон', preview: '', url: '', emoji: '😴💤' },
                { id: 'b20', title: 'Космос', preview: '', url: '', emoji: '🚀🌌⭐' },
            ];
            const q = query.toLowerCase();
            const filtered = q === 'trending' ? builtinGifs :
                builtinGifs.filter(g => g.title.toLowerCase().includes(q) || g.emoji.includes(q));
            return res.json(filtered.length > 0 ? filtered : builtinGifs);
        }

        const https = require('https');
        const apiUrl = query === 'trending'
            ? `https://tenor.googleapis.com/v2/featured?key=${tenorKey}&limit=20&media_filter=tinygif,gif`
            : `https://tenor.googleapis.com/v2/search?key=${tenorKey}&q=${encodeURIComponent(query)}&limit=20&media_filter=tinygif,gif`;

        const data = await new Promise((resolve, reject) => {
            https.get(apiUrl, { timeout: 5000 }, (resp) => {
                let body = '';
                resp.on('data', chunk => body += chunk);
                resp.on('end', () => {
                    try { resolve(JSON.parse(body)); }
                    catch (e) { reject(e); }
                });
            }).on('error', reject);
        });

        const results = (data.results || []).map(r => ({
            id: r.id,
            title: r.title || '',
            preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || '',
            url: r.media_formats?.gif?.url || r.media_formats?.tinygif?.url || ''
        }));

        res.json(results);
    } catch (err) {
        log.debug('GIF search error: ' + err.message);
        res.json([]);
    }
});

// ==========================================
// QUICK REPLY TEMPLATES
// ==========================================

// GET /api/chat/templates — list user's templates
router.get('/templates', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const pool = require('../db').pool;
        const result = await pool.query(
            'SELECT * FROM chat_templates WHERE user_id = $1 ORDER BY shortcut', [userId]
        );
        res.json(result.rows.map(r => ({
            id: r.id, shortcut: r.shortcut, content: r.content, category: r.category
        })));
    } catch (err) {
        log.error('Error loading templates', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/templates — create template
router.post('/templates', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { shortcut, content, category } = req.body;
        if (!shortcut || !content) return res.status(400).json({ error: 'Missing shortcut or content' });

        const pool = require('../db').pool;
        const result = await pool.query(
            `INSERT INTO chat_templates (user_id, shortcut, content, category)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, shortcut) DO UPDATE SET content = $3, category = $4
             RETURNING *`,
            [userId, shortcut.toLowerCase().replace(/^\//, ''), content, category || 'general']
        );
        res.json({ id: result.rows[0].id, shortcut: result.rows[0].shortcut, content: result.rows[0].content, category: result.rows[0].category });
    } catch (err) {
        log.error('Error creating template', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/chat/templates/:id — delete template
router.delete('/templates/:id', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const pool = require('../db').pool;
        await pool.query('DELETE FROM chat_templates WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        res.json({ success: true });
    } catch (err) {
        log.error('Error deleting template', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// CHAT ACTIVITY STATS & PREMIUM COEFFICIENT
// ==========================================

// GET /api/chat/stats/me — my activity stats
router.get('/stats/me', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const days = parseInt(req.query.days || '30', 10);
        const stats = await chat.getChatActivityStats(userId, days);

        // Calculate premium coefficient (0.0 - 1.0 bonus)
        // Based on: messages, reactions received (helpfulness), active days, replies
        const totalMessages = parseInt(stats.total_messages || 0);
        const reactionsReceived = parseInt(stats.total_reactions_received || 0);
        const activeDays = parseInt(stats.active_days || 0);
        const totalReplies = parseInt(stats.total_replies || 0);

        // Normalized scores (each 0-25 points, total max 100)
        var msgScore = Math.min(totalMessages / 100, 1) * 25;        // 100 msgs = max
        var reactionScore = Math.min(reactionsReceived / 50, 1) * 25; // 50 reactions = max
        var dayScore = Math.min(activeDays / days, 1) * 25;           // every day = max
        var replyScore = Math.min(totalReplies / 30, 1) * 25;         // 30 replies = max

        var premiumCoefficient = Math.round((msgScore + reactionScore + dayScore + replyScore)) / 100;

        res.json({
            ...stats,
            days,
            premiumCoefficient: Math.min(premiumCoefficient, 1.0),
            breakdown: {
                messages: Math.round(msgScore),
                helpfulness: Math.round(reactionScore),
                consistency: Math.round(dayScore),
                responsiveness: Math.round(replyScore)
            }
        });
    } catch (err) {
        log.error('Error getting chat stats', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/stats/leaderboard — team leaderboard
router.get('/stats/leaderboard', async (req, res) => {
    try {
        const days = parseInt(req.query.days || '30', 10);
        const leaderboard = await chat.getChatActivityLeaderboard(days);
        res.json(leaderboard);
    } catch (err) {
        log.error('Error getting chat leaderboard', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// PRESENCE & LAST SEEN
// ==========================================

// GET /api/chat/channels/:id/messages/after/:seq — gap-fill after reconnect
router.get('/channels/:id/messages/after/:seq', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
        const afterSeq = parseInt(req.params.seq, 10);
        if (isNaN(channelId) || isNaN(afterSeq)) return res.status(400).json({ error: 'Invalid params' });

        if (!await chat.isMember(channelId, userId)) {
            return res.status(403).json({ error: 'Not a member' });
        }

        const result = await require('../db').pool.query(`
            SELECT cm.*, u.username, u.name AS display_name,
                rm.content AS reply_content, ru.username AS reply_username
            FROM chat_messages cm
            JOIN users u ON u.id = cm.user_id
            LEFT JOIN chat_messages rm ON rm.id = cm.reply_to
            LEFT JOIN users ru ON ru.id = rm.user_id
            WHERE cm.channel_id = $1 AND cm.seq > $2
            ORDER BY cm.seq ASC
            LIMIT 200
        `, [channelId, afterSeq]);

        const messages = result.rows.map(row => chat.mapMessageRow(row));
        res.json(messages);
    } catch (err) {
        log.error('Error fetching gap-fill messages', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/online — list online user IDs
router.get('/online', async (req, res) => {
    try {
        const { getOnlineUserIds } = require('../services/websocket');
        res.json({ onlineUserIds: getOnlineUserIds() });
    } catch (err) {
        res.json({ onlineUserIds: [] });
    }
});

// GET /api/chat/users/:id/last-seen — get last seen time
router.get('/users/:id/last-seen', async (req, res) => {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });

        const { getOnlineUserIds, getLastSeen } = require('../services/websocket');
        const onlineIds = getOnlineUserIds();

        if (onlineIds.includes(String(targetId))) {
            return res.json({ online: true, lastSeen: null });
        }

        // Check in-memory first, then DB
        const inMemory = getLastSeen(String(targetId));
        if (inMemory) {
            return res.json({ online: false, lastSeen: inMemory.toISOString() });
        }

        const pool = require('../db').pool;
        const result = await pool.query('SELECT last_seen_at FROM users WHERE id = $1', [targetId]);
        const lastSeen = result.rows[0]?.last_seen_at || null;
        res.json({ online: false, lastSeen: lastSeen });
    } catch (err) {
        log.error('Error getting last seen', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// PUSH NOTIFICATION SUBSCRIPTIONS
// ==========================================

// POST /api/chat/push/subscribe — save push subscription
router.post('/push/subscribe', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { endpoint, keys } = req.body;
        if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
            return res.status(400).json({ error: 'Invalid subscription' });
        }
        const pool = require('../db').pool;
        await pool.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4
        `, [userId, endpoint, keys.p256dh, keys.auth]);
        res.json({ success: true });
    } catch (err) {
        log.error('Error saving push subscription', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/chat/push/unsubscribe — remove push subscription
router.delete('/push/unsubscribe', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { endpoint } = req.body;
        const pool = require('../db').pool;
        await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
        res.json({ success: true });
    } catch (err) {
        log.error('Error removing push subscription', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/push/vapid-key — return public VAPID key
router.get('/push/vapid-key', async (req, res) => {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
    res.json({ publicKey: vapidPublicKey });
});

// ============================================================
// CHAT POLLS / VOTING (v25.4.0)
// ============================================================

// POST /api/chat/channels/:id/poll — create poll in channel
router.post('/channels/:id/poll', requireChannelMember, async (req, res) => {
    try {
        const channelId = req.chatChannelId;
        const userId = getCurrentUserId(req);
        const { question, options, pollType, isAnonymous, expiresInMinutes } = req.body;

        if (!question || !Array.isArray(options) || options.length < 2 || options.length > 10) {
            return res.status(400).json({ error: 'Потрібно питання та 2-10 варіантів' });
        }

        const pollOptions = options.map(o => ({ text: typeof o === 'string' ? o : o.text, votes: 0 }));
        const expiresAt = expiresInMinutes ? new Date(Date.now() + expiresInMinutes * 60000) : null;

        const pool = require('../db').pool;
        const client = await pool.connect();
        let message;
        let poll;
        try {
            await client.query('BEGIN');
            const msgResult = await client.query(
                `INSERT INTO chat_messages (channel_id, user_id, content, type)
                 VALUES ($1, $2, $3, 'poll') RETURNING *`,
                [channelId, userId, question]
            );
            message = msgResult.rows[0];

            const pollResult = await client.query(
                `INSERT INTO chat_polls (channel_id, message_id, question, options, poll_type, is_anonymous, expires_at, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [channelId, message.id, question, JSON.stringify(pollOptions),
                 pollType || 'single', isAnonymous || false, expiresAt, userId]
            );
            poll = pollResult.rows[0];
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        // Broadcast via WebSocket
        try {
            broadcastToChannel(channelId, 'chat:message', {
                channelId,
                message: { ...chat.mapMessageRow(message), poll }
            }, String(userId));
        } catch (e) { /* ws not ready */ }

        res.json({ success: true, poll, message });
    } catch (err) {
        log.error('Create poll error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/polls/:pollId/vote — vote on a poll
router.post('/polls/:pollId/vote', async (req, res) => {
    try {
        const pollId = parseId(req.params.pollId);
        const userId = getCurrentUserId(req);
        const { optionIndex } = req.body;
        const parsedOptionIndex = Number(optionIndex);
        if (!Number.isInteger(parsedOptionIndex)) {
            return res.status(400).json({ error: 'Invalid option index' });
        }

        const loaded = await getPollForChannelMember(pollId, userId, res);
        if (!loaded) return;
        const { pool } = loaded;

        const client = await pool.connect();
        let updatedOptions;
        let channelId;
        try {
            await client.query('BEGIN');
            const pollResult = await client.query('SELECT * FROM chat_polls WHERE id = $1 FOR UPDATE', [pollId]);
            if (pollResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Опитування не знайдено' });
            }
            const poll = pollResult.rows[0];
            channelId = poll.channel_id;

            // Check poll is open under the row lock so close/expiry races cannot split writes.
            if (poll.is_closed) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Опитування закрито' });
            }
            if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Час опитування вичерпано' });
            }

            const options = getPollOptions(poll);
            if (parsedOptionIndex < 0 || parsedOptionIndex >= options.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Невірний варіант' });
            }

            if (poll.poll_type === 'single') {
                await client.query('DELETE FROM chat_poll_votes WHERE poll_id = $1 AND user_id = $2', [pollId, userId]);
            }

            await client.query(
                `INSERT INTO chat_poll_votes (poll_id, user_id, option_index)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (poll_id, user_id, option_index) DO NOTHING`,
                [pollId, userId, parsedOptionIndex]
            );

            const voteCounts = await client.query(
                `SELECT option_index, COUNT(*) AS cnt FROM chat_poll_votes WHERE poll_id = $1 GROUP BY option_index`,
                [pollId]
            );
            updatedOptions = options.map((opt, i) => {
                const vc = voteCounts.rows.find(r => Number(r.option_index) === i);
                return { ...opt, votes: vc ? parseInt(vc.cnt, 10) : 0 };
            });
            await client.query('UPDATE chat_polls SET options = $1 WHERE id = $2', [JSON.stringify(updatedOptions), pollId]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        // Broadcast vote update
        try {
            broadcastToChannel(channelId, 'chat:poll-update', {
                channelId,
                pollId,
                options: updatedOptions
            });
        } catch (e) { /* ws not ready */ }

        res.json({ success: true, options: updatedOptions });
    } catch (err) {
        log.error('Poll vote error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/polls/:pollId/close — close a poll
router.post('/polls/:pollId/close', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const pollId = parseId(req.params.pollId);
        const loaded = await getPollForChannelMember(pollId, userId, res);
        if (!loaded) return;
        const { pool } = loaded;
        const result = await pool.query(
            `UPDATE chat_polls SET is_closed = true WHERE id = $1 AND created_by = $2 RETURNING *`,
            [pollId, userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Опитування не знайдено' });

        try {
            broadcastToChannel(result.rows[0].channel_id, 'chat:poll-closed', {
                channelId: result.rows[0].channel_id,
                pollId
            });
        } catch (e) { /* ok */ }

        res.json({ success: true, poll: result.rows[0] });
    } catch (err) {
        log.error('Close poll error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/polls/:pollId/results — poll results with percentages
router.get('/polls/:pollId/results', async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const pollId = parseId(req.params.pollId);
        const loaded = await getPollForChannelMember(pollId, userId, res);
        if (!loaded) return;
        const { poll, pool } = loaded;
        const totalVotes = await pool.query(
            'SELECT COUNT(DISTINCT user_id) AS total FROM chat_poll_votes WHERE poll_id = $1',
            [pollId]
        );
        const total = parseInt(totalVotes.rows[0].total);

        const options = poll.options.map(opt => ({
            ...opt,
            percentage: total > 0 ? Math.round((opt.votes / total) * 100) : 0
        }));

        // Get voters if not anonymous
        let voters = [];
        if (!poll.is_anonymous) {
            const voterResult = await pool.query(
                `SELECT v.option_index, u.name, u.id AS user_id FROM chat_poll_votes v
                 JOIN users u ON u.id = v.user_id WHERE v.poll_id = $1`,
                [pollId]
            );
            voters = voterResult.rows;
        }

        res.json({ poll: { ...poll, options }, totalVoters: total, voters });
    } catch (err) {
        log.error('Poll results error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v32.1: Помічник bridge — proxy to OpenClaw (HostHatch)
router.post('/kleshnya', async (req, res) => {
    const { message, context } = req.body;
    const user = req.user;

    try {
        const KLESHNYA_BRIDGE_URL = process.env.KLESHNYA_BRIDGE_URL;
        const KLESHNYA_BRIDGE_TOKEN = process.env.KLESHNYA_BRIDGE_TOKEN;

        if (!KLESHNYA_BRIDGE_URL) {
            return res.json({
                success: true,
                reply: '🤖 Помічник тимчасово недоступний. Пиши в Telegram @EventHelper_One_Bot'
            });
        }

        const response = await fetch(KLESHNYA_BRIDGE_URL + '/api/bridge/crm', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KLESHNYA_BRIDGE_TOKEN}`
            },
            body: JSON.stringify({
                message,
                userId: user.id,
                userName: user.name,
                userRole: user.role,
                context: context || {},
                parkId: process.env.PARK_ID || 'park-zakrevskogo'
            }),
            signal: AbortSignal.timeout(15000)
        });

        const data = await response.json();
        return res.json({ success: true, reply: data.reply || 'Немає відповіді' });
    } catch (err) {
        log.error('[Kleshnya Bridge Error]', err.message);
        return res.json({
            success: true,
            reply: '🤖 Помічник зараз зайнятий. Спробуй ще раз або пиши в Telegram.'
        });
    }
});

// ==========================================
// v33.7.0: CRM SLASH COMMANDS
// ==========================================

// POST /api/chat/slash — CRM slash commands (/вільно, /броні, /задачі, /склад)
router.post('/slash', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const { command, args } = req.body;
        if (!command) return res.status(400).json({ error: 'command required' });
        const cmd = command.toLowerCase().trim().replace(/^\/+/, '');

        function parseArgsDate(arg) {
            if (!arg || ['сьогодні', 'today', 'зараз'].includes(arg.toLowerCase()))
                return new Date().toISOString().slice(0, 10);
            const dm = arg.match(/^(\d{1,2})\.(\d{1,2})$/);
            if (dm) return `${new Date().getFullYear()}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
            const dmy = arg.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
            if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
            return arg;
        }

        let reply = null;
        switch (cmd) {
            case 'вільно':
            case 'free': {
                const date = parseArgsDate(args);
                const params = [date];
                const visibility = getVisibleBookingScope(req.user, params, 'b');
                const bk = await pool.query(
                    `SELECT SUBSTRING(b.time, 1, 5) AS t
                     FROM bookings b
                     WHERE b.date = $1 AND b.status != 'cancelled'
                     ${visibility.sql}
                     ORDER BY b.time`,
                    params
                );
                const busy = bk.rows.map(r => r.t);
                const slots = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];
                const free = slots.filter(s => !busy.includes(s));
                reply = free.length
                    ? `📅 Вільно ${date}:\n${free.join(' · ')}`
                    : `📅 ${date}: всі слоти зайняті (${busy.length} бронювань)`;
                break;
            }
            case 'броні':
            case 'bookings': {
                const date = parseArgsDate(args);
                const params = [date];
                const visibility = getVisibleBookingScope(req.user, params, 'b');
                const rows = await pool.query(
                    `SELECT SUBSTRING(b.time,1,5) AS t, b.program_name, b.label
                     FROM bookings b
                     WHERE b.date = $1 AND b.status != 'cancelled'
                     ${visibility.sql}
                     ORDER BY b.time LIMIT 20`,
                    params
                );
                reply = rows.rowCount
                    ? `📋 Бронювання ${date} (${rows.rowCount}):\n` + rows.rows.map(r => `${r.t} — ${r.program_name} | ${r.label}`).join('\n')
                    : `📋 ${date}: бронювань немає`;
                break;
            }
            case 'задачі':
            case 'tasks': {
                const rows = await pool.query(
                    `SELECT title, priority, deadline FROM tasks
                     WHERE (assigned_to = $1 OR created_by = $1) AND status IN ('todo', 'in_progress')
                     ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, deadline NULLS LAST
                     LIMIT 5`,
                    [req.user.username]
                );
                reply = rows.rowCount
                    ? `✅ Задачі (${rows.rowCount}):\n` + rows.rows.map(t =>
                        `• ${t.title.slice(0, 50)}` + (t.deadline ? ` 📅${String(t.deadline).slice(5, 10)}` : '')
                    ).join('\n')
                    : '✅ Немає активних задач!';
                break;
            }
            case 'склад': {
                const search = args ? `%${args}%` : '%';
                const rows = await pool.query(
                    `SELECT name, quantity, min_quantity, unit FROM warehouse_stock
                     WHERE name ILIKE $1 AND is_active = true ORDER BY name LIMIT 5`,
                    [search]
                );
                reply = rows.rowCount
                    ? `📦 Склад:\n` + rows.rows.map(s =>
                        `${s.quantity <= s.min_quantity ? '⚠️' : '✅'} ${s.name}: ${s.quantity} ${s.unit}` +
                        (s.quantity <= s.min_quantity ? ` (мін: ${s.min_quantity})` : '')
                    ).join('\n')
                    : '📦 Нічого не знайдено на складі';
                break;
            }
            default:
                return res.status(404).json({ error: `Невідома команда: /${command}` });
        }
        res.json({ success: true, reply, command: cmd, args: args || '' });
    } catch (err) {
        log.error('[Slash] Error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ==========================================
// v33.7.0: BOOKING-LINKED CHAT CHANNELS
// ==========================================

// POST /api/chat/booking-channel
router.post('/booking-channel', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const { bookingId } = req.body;
        if (!bookingId || typeof bookingId !== 'string') return res.status(400).json({ error: 'bookingId required' });

        const userId = req.user.id || req.user.userId;
        const result = await provisionBookingChatChannel({ pool, bookingId, userId, actor: req.user });
        if (result.notFound) return res.status(404).json({ error: 'Booking not found' });
        if (result.existingByLink && !await requireChannelMemberOrRespond(result.channel.id, userId, res)) return;

        res.json({ success: true, channel: result.channel, isNew: result.isNew });
    } catch (err) {
        log.error('[BookingChannel] Error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/chat/booking-channel/:bookingId
router.get('/booking-channel/:bookingId', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const r = await pool.query(
            'SELECT * FROM chat_channels WHERE linked_booking_id = $1',
            [req.params.bookingId]
        );
        const channel = r.rows[0] || null;
        if (channel && !await requireChannelMemberOrRespond(channel.id, getCurrentUserId(req), res)) return;
        res.json({ success: true, channel });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ==========================================
// v33.7.0: USER STATUS
// ==========================================

// PATCH /api/chat/users/me/status
router.patch('/users/me/status', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const { status, emoji, until } = req.body;
        const userId = req.user.id || req.user.userId;
        const untilVal = until && new Date(until) > new Date() ? until : null;

        await pool.query(
            `UPDATE users SET chat_status = $1, chat_status_emoji = $2, chat_status_until = $3 WHERE id = $4`,
            [status || null, emoji || null, untilVal, userId]
        );

        try {
            const { broadcast } = require('../services/websocket');
            broadcast('user:status', { userId: String(userId), status: status || null, emoji: emoji || null });
        } catch (e) { /* silent */ }

        res.json({ success: true });
    } catch (err) {
        log.error('[UserStatus] Error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ==========================================
// v33.7.0: MESSAGE REMINDERS
// ==========================================

// POST /api/chat/messages/:id/remind — MUST be BEFORE GET /messages/:id/thread
router.post('/messages/:id/remind', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const messageId = parseInt(req.params.id, 10);
        if (isNaN(messageId)) return res.status(400).json({ error: 'Невірний ID повідомлення' });

        const { remindAt } = req.body;
        if (!remindAt) return res.status(400).json({ error: 'Потрібен час нагадування' });
        const remindDate = new Date(remindAt);
        if (isNaN(remindDate.getTime()) || remindDate <= new Date()) {
            return res.status(400).json({ error: 'Час нагадування має бути в майбутньому' });
        }
        const remindAtIso = remindDate.toISOString();

        const msgRes = await pool.query(
            'SELECT id, channel_id, content FROM chat_messages WHERE id = $1', [messageId]
        );
        if (!msgRes.rowCount) return res.status(404).json({ error: 'Повідомлення не знайдено' });
        const m = msgRes.rows[0];
        const userId = getCurrentUserId(req);
        if (!await requireChannelMemberOrRespond(m.channel_id, userId, res)) return;

        const result = await createChatReminderTask({
            pool,
            message: m,
            user: req.user,
            remindAtIso
        });

        log.info(`[Remind] Task #${result.taskId} ${result.duplicate ? 'reused' : 'created'} for msg #${messageId} at ${remindAtIso}`);
        res.json({ success: true, taskId: result.taskId, remindAt: remindAtIso, duplicate: result.duplicate, sourceId: result.sourceId });
    } catch (err) {
        log.error('[Remind] Error', err);
        res.status(500).json({ success: false, error: 'Внутрішня помилка сервера' });
    }
});

// ==========================================
// v33.7.0: ANNOUNCE MODE + IMPORTANT MESSAGES
// ==========================================

// PATCH /api/chat/messages/:id/important — toggle important
router.patch('/messages/:id/important', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const messageId = parseInt(req.params.id, 10);
        if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

        if (!['admin', 'director'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Тільки адміністратори можуть позначати важливі' });
        }

        const { important } = req.body;
        const msg = await getMessageForChannelMember(messageId, getCurrentUserId(req), res);
        if (!msg) return;
        const r = await pool.query(
            `UPDATE chat_messages SET is_important = $1 WHERE id = $2 RETURNING channel_id`,
            [important === true, messageId]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Message not found' });

        broadcastToChannel(r.rows[0].channel_id, 'chat:important', {
            channelId: r.rows[0].channel_id,
            messageId,
            important: important === true
        });

        res.json({ success: true });
    } catch (err) {
        log.error('[Important] Error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ==========================================
// v33.9.0: ROOM CHANNELS
// ==========================================

// POST /api/chat/room-channels/init — create channels for all rooms
router.post('/room-channels/init', async (req, res) => {
    try {
        const pool = require('../db').pool;
        if (!['admin', 'director', 'creator'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Admin only' });
        }
        const roomParams = [];
        const roomScope = getVisibleBookingScope(req.user, roomParams, 'b');
        const rooms = await pool.query(
            `SELECT DISTINCT b.line_id FROM bookings b
             WHERE b.line_id IS NOT NULL AND b.line_id != ''
             ${roomScope.sql}
             ORDER BY b.line_id`,
            roomParams
        );
        const created = [];
        for (const room of rooms.rows) {
            const userId = req.user.id || req.user.userId;
            const result = await provisionRoomChatChannel({ pool, lineId: room.line_id, userId });
            created.push({ lineId: room.line_id, channelId: result.channel.id, isNew: result.isNew });
        }
        res.json({ success: true, channels: created });
    } catch (err) {
        log.error('[RoomChannels] Init error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/chat/room-channels/:lineId/history — full room chronology
router.get('/room-channels/:lineId/history', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const { lineId } = req.params;
        const limit = Math.min(parseInt(req.query.limit || '50'), 200);

        const chanRow = await pool.query('SELECT id FROM chat_channels WHERE line_id = $1 LIMIT 1', [lineId]);
        if (chanRow.rowCount && !await requireChannelMemberOrRespond(chanRow.rows[0].id, getCurrentUserId(req), res)) return;

        // Bookings in this room
        const bookingParams = [lineId, limit];
        const bookingScope = getVisibleBookingScope(req.user, bookingParams, 'b');
        const bookings = await pool.query(
            `SELECT 'booking' AS source_type, id AS source_id,
                    date || 'T' || SUBSTRING(time,1,5) AS event_time,
                    program_name || ' | ' || COALESCE(group_name, label, '') AS content,
                    status, kids_count, created_by
             FROM bookings b WHERE b.line_id = $1
             ${bookingScope.sql}
             ORDER BY b.date DESC, b.time DESC LIMIT $2`,
            bookingParams
        );

        // Chat messages in room channel
        let chatMsgs = { rows: [] };
        if (chanRow.rowCount) {
            chatMsgs = await pool.query(
                `SELECT 'chat' AS source_type, cm.id::text AS source_id,
                        cm.created_at AS event_time, cm.content, u.name AS author
                 FROM chat_messages cm JOIN users u ON u.id = cm.user_id
                 WHERE cm.channel_id = $1 AND cm.deleted_at IS NULL
                 ORDER BY cm.created_at DESC LIMIT $2`,
                [chanRow.rows[0].id, limit]
            );
        }

        const all = [...bookings.rows, ...chatMsgs.rows]
            .sort((a, b) => new Date(b.event_time) - new Date(a.event_time))
            .slice(0, limit);

        res.json({ success: true, history: all, lineId });
    } catch (err) {
        log.error('[RoomChannels] History error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ==========================================
// v33.9.0: CHAT PREFERENCES
// ==========================================

// GET /api/chat/preferences
router.get('/preferences', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const userId = req.user.id || req.user.userId;
        let prefs = await pool.query('SELECT * FROM chat_user_preferences WHERE user_id = $1', [userId]);
        if (!prefs.rowCount) {
            prefs = await pool.query('INSERT INTO chat_user_preferences (user_id) VALUES ($1) RETURNING *', [userId]);
        }
        res.json({ success: true, preferences: prefs.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// PATCH /api/chat/preferences
router.patch('/preferences', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const userId = req.user.id || req.user.userId;
        const { accentColor, messageFont, chatSignature, moodEmoji, notificationSound, channelSounds, wallpaper } = req.body;
        const sets = ['updated_at = NOW()'], vals = [];
        let idx = 1;
        if (accentColor !== undefined)       { sets.push(`accent_color = $${idx++}`); vals.push(accentColor); }
        if (messageFont !== undefined)       { sets.push(`message_font = $${idx++}`); vals.push(messageFont); }
        if (chatSignature !== undefined)     { sets.push(`chat_signature = $${idx++}`); vals.push((chatSignature || '').slice(0, 80) || null); }
        if (moodEmoji !== undefined)         { sets.push(`mood_emoji = $${idx++}`); sets.push('mood_date = CURRENT_DATE'); vals.push(moodEmoji || null); }
        if (notificationSound !== undefined) { sets.push(`notification_sound = $${idx++}`); vals.push(notificationSound); }
        if (channelSounds !== undefined)     { sets.push(`channel_sounds = $${idx++}`); vals.push(JSON.stringify(channelSounds)); }
        if (wallpaper !== undefined)         { sets.push(`wallpaper = $${idx++}`); vals.push(wallpaper); }
        vals.push(userId);
        await pool.query('INSERT INTO chat_user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
        await pool.query(`UPDATE chat_user_preferences SET ${sets.join(', ')} WHERE user_id = $${idx}`, vals);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ==========================================
// v33.9.0: SUPER REACTION
// ==========================================

router.post('/messages/:id/super-reaction', async (req, res) => {
    try {
        const pool = require('../db').pool;
        const { emoji } = req.body;
        if (!emoji) return res.status(400).json({ error: 'emoji required' });
        const userId = getCurrentUserId(req);
        const username = req.user.username;
        const COST = 5;

        const messageId = parseInt(req.params.id, 10);
        if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });
        const superMsgRes = await pool.query('SELECT channel_id FROM chat_messages WHERE id = $1', [messageId]);
        if (!superMsgRes.rowCount) return res.status(404).json({ error: 'Message not found' });
        if (!await requireChannelMemberOrRespond(superMsgRes.rows[0].channel_id, userId, res)) return;

        const gamification = require('../services/gamification');
        try {
            await gamification.spendCoins(username, COST, 'super_reaction', `Супер-реакція ${emoji}`);
        } catch (e) {
            return res.status(402).json({ error: `Недостатньо монет (потрібно ${COST})` });
        }

        const msgRes = superMsgRes;

        await pool.query(
            `INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
            [messageId, userId, emoji]
        );

        broadcastToChannel(msgRes.rows[0].channel_id, 'chat:super-reaction', {
            channelId: msgRes.rows[0].channel_id,
            messageId,
            emoji, username, fromUserId: String(userId)
        });

        res.json({ success: true, coinsSpent: COST });
    } catch (err) {
        log.error('[SuperReaction] Error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
