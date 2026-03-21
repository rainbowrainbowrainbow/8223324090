/**
 * routes/chat.js — Team messenger REST API
 */
const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const chat = require('../services/chatService');
const { broadcastToChannel, sendToUser } = require('../services/websocket');
const { processMessage: processBotMessage } = require('../services/chat-bot');
const guardian = require('../services/guardian');
const linkPreview = require('../services/linkPreview');
const { createLogger } = require('../utils/logger');

const log = createLogger('ChatAPI');

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
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of _chatRateLimits) {
        if (now - data.lastSent > 120000) {
            _chatRateLimits.delete(userId);
        }
    }
}, 300000);

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
const chatStorage = multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads', 'chat'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
        cb(null, name);
    }
});
const chatUpload = multer({
    storage: chatStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|gif|webp|svg|pdf|doc|docx|xls|xlsx|txt|zip|mp3|mp4|ogg|wav|webm)$/i;
        if (allowed.test(path.extname(file.originalname))) {
            cb(null, true);
        } else {
            cb(new Error('Непідтримуваний формат файлу'));
        }
    }
});

// GET /api/chat/channels — list user's channels + unread counts
router.get('/channels', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
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
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;

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
            return res.status(403).json({ error: preCheck.message || '🛡️ Повідомлення заблоковано.' });
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
                    const bkData = await pool.query(
                        'SELECT id, date, time, program_name, label, status, price FROM bookings WHERE id = $1',
                        [_bkId]
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
router.post('/channels/:id/upload', chatUpload.single('file'), async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
        if (isNaN(channelId) || !req.file) {
            return res.status(400).json({ error: 'Invalid channel ID or missing file' });
        }

        const file = req.file;
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.originalname);
        const isAudio = /\.(webm|ogg|mp3|wav|m4a)$/i.test(file.originalname);
        const fileUrl = '/uploads/chat/' + file.filename;
        const contentType = isImage ? 'image' : (isAudio ? 'voice' : 'file');
        const caption = req.body.caption || '';

        const metadata = {
            file: {
                url: fileUrl,
                name: file.originalname,
                size: file.size,
                mimeType: file.mimetype,
                type: contentType,
                duration: parseInt(req.body.duration) || 0
            },
            duration: parseInt(req.body.duration) || 0
        };

        // Send as message with file metadata
        const content = caption || (isImage ? '📷 Фото' : '📎 ' + file.originalname);
        const { message, mentionedUserIds } = await chat.sendFileMessage(channelId, userId, content, contentType, metadata);

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
router.put('/channels/:id/read', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
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
router.get('/channels/:id/read-receipts', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
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
        const userId = req.user.id || req.user.userId;
        const messageId = parseInt(req.params.id, 10);
        const { emoji } = req.body;
        if (isNaN(messageId) || !emoji) {
            return res.status(400).json({ error: 'Invalid message ID or emoji' });
        }

        const msg = await chat.getMessageById(messageId);
        if (!msg) return res.status(404).json({ error: 'Message not found' });

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
        const userId = req.user.id || req.user.userId;
        const messageId = parseInt(req.params.id, 10);
        const emoji = decodeURIComponent(req.params.emoji);
        if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

        const msg = await chat.getMessageById(messageId);
        if (!msg) return res.status(404).json({ error: 'Message not found' });

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
router.get('/channels/:id/pinned', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
        const pinned = await chat.getPinnedMessages(channelId);
        res.json(pinned);
    } catch (err) {
        log.error('Error fetching pinned messages', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/channels/:id/pinned — pin a message
router.post('/channels/:id/pinned', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
        const { messageId } = req.body;
        if (isNaN(channelId) || !messageId) {
            return res.status(400).json({ error: 'Invalid channel or message ID' });
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
router.delete('/channels/:id/pinned/:messageId', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
        const messageId = parseInt(req.params.messageId, 10);
        if (isNaN(channelId) || isNaN(messageId)) {
            return res.status(400).json({ error: 'Invalid IDs' });
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
router.put('/channels/:id/mute', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
        const muted = await chat.toggleMute(channelId, userId);
        res.json({ muted });
    } catch (err) {
        log.error('Error toggling mute', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/chat/channels/:id/members — channel members
router.get('/channels/:id/members', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
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
router.post('/channels/:id/members', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
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
router.delete('/channels/:id/members/:userId', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
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
router.patch('/channels/:id', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
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
router.delete('/channels/:id', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
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
        const userId = req.user.id || req.user.userId;
        const { channelId, messageId, assignedTo, title, deadline } = req.body;
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Task title is required' });
        }
        const task = await chat.createTask({
            channelId: channelId || null,
            messageId: messageId || null,
            assignedTo: assignedTo || null,
            assignedBy: userId,
            title: title.trim(),
            deadline: deadline || null
        });

        // Broadcast task to channel
        if (channelId) {
            broadcastToChannel(channelId, 'chat:task', { channelId, task });
        }

        res.status(201).json(task);
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
        const task = await chat.updateTask(taskId, userId, { status });
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
        const messageId = parseInt(req.params.id, 10);
        if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

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
        const userId = req.user.id || req.user.userId;
        const rootMessageId = parseInt(req.params.id, 10);
        const { content } = req.body;
        if (isNaN(rootMessageId) || !content || !content.trim()) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const pool = require('../db').pool;

        // Get the root message's channel
        const rootMsg = await pool.query('SELECT channel_id FROM chat_messages WHERE id = $1', [rootMessageId]);
        if (rootMsg.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        const channelId = rootMsg.rows[0].channel_id;

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
        const userId = req.user.id || req.user.userId;
        const { messageId, category, note } = req.body;
        if (!messageId) return res.status(400).json({ error: 'Missing messageId' });

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
router.post('/channels/:id/ephemeral', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
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
router.post('/channels/:id/schedule', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const channelId = parseInt(req.params.id, 10);
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
        const apiKey = process.env.ANTHROPIC_API_KEY;

        if (!apiKey) {
            return res.json({ translated: text, note: 'API ключ не налаштовано' });
        }

        const https = require('https');
        const body = JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [{
                role: 'user',
                content: `Translate the following text to ${lang === 'uk' ? 'Ukrainian' : 'English'}. Return ONLY the translation, no explanations:\n\n${text}`
            }]
        });

        const translated = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                timeout: 10000
            };
            const req2 = https.request(options, (resp) => {
                let data = '';
                resp.on('data', chunk => data += chunk);
                resp.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.content?.[0]?.text || text);
                    } catch (e) { resolve(text); }
                });
            });
            req2.on('error', () => resolve(text));
            req2.write(body);
            req2.end();
        });

        res.json({ translated });
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
router.post('/channels/:id/poll', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id);
        const userId = req.user.id || req.user.userId;
        const { question, options, pollType, isAnonymous, expiresInMinutes } = req.body;

        if (!question || !Array.isArray(options) || options.length < 2 || options.length > 10) {
            return res.status(400).json({ error: 'Потрібно питання та 2-10 варіантів' });
        }

        const pool = require('../db').pool;

        // Create poll message
        const msgResult = await pool.query(
            `INSERT INTO chat_messages (channel_id, user_id, content, type)
             VALUES ($1, $2, $3, 'poll') RETURNING *`,
            [channelId, userId, question]
        );
        const message = msgResult.rows[0];

        const pollOptions = options.map(o => ({ text: typeof o === 'string' ? o : o.text, votes: 0 }));
        const expiresAt = expiresInMinutes ? new Date(Date.now() + expiresInMinutes * 60000) : null;

        const pollResult = await pool.query(
            `INSERT INTO chat_polls (channel_id, message_id, question, options, poll_type, is_anonymous, expires_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [channelId, message.id, question, JSON.stringify(pollOptions),
             pollType || 'single', isAnonymous || false, expiresAt, userId]
        );

        // Broadcast via WebSocket
        try {
            broadcastToChannel(channelId, {
                type: 'new_message',
                message: { ...message, poll: pollResult.rows[0] }
            });
        } catch (e) { /* ws not ready */ }

        res.json({ success: true, poll: pollResult.rows[0], message });
    } catch (err) {
        log.error('Create poll error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/chat/polls/:pollId/vote — vote on a poll
router.post('/polls/:pollId/vote', async (req, res) => {
    try {
        const pollId = parseInt(req.params.pollId);
        const userId = req.user.id || req.user.userId;
        const { optionIndex } = req.body;

        const pool = require('../db').pool;

        // Check poll exists and is open
        const pollResult = await pool.query('SELECT * FROM chat_polls WHERE id = $1', [pollId]);
        if (pollResult.rows.length === 0) return res.status(404).json({ error: 'Опитування не знайдено' });

        const poll = pollResult.rows[0];
        if (poll.is_closed) return res.status(400).json({ error: 'Опитування закрито' });
        if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Час опитування вичерпано' });
        }

        const options = poll.options;
        if (optionIndex < 0 || optionIndex >= options.length) {
            return res.status(400).json({ error: 'Невірний варіант' });
        }

        // For single-choice, remove previous votes
        if (poll.poll_type === 'single') {
            await pool.query('DELETE FROM chat_poll_votes WHERE poll_id = $1 AND user_id = $2', [pollId, userId]);
        }

        await pool.query(
            `INSERT INTO chat_poll_votes (poll_id, user_id, option_index)
             VALUES ($1, $2, $3)
             ON CONFLICT (poll_id, user_id, option_index) DO NOTHING`,
            [pollId, userId, optionIndex]
        );

        // Update vote counts in options JSONB
        const voteCounts = await pool.query(
            `SELECT option_index, COUNT(*) AS cnt FROM chat_poll_votes WHERE poll_id = $1 GROUP BY option_index`,
            [pollId]
        );
        const updatedOptions = options.map((opt, i) => {
            const vc = voteCounts.rows.find(r => r.option_index === i);
            return { ...opt, votes: vc ? parseInt(vc.cnt) : 0 };
        });
        await pool.query('UPDATE chat_polls SET options = $1 WHERE id = $2', [JSON.stringify(updatedOptions), pollId]);

        // Broadcast vote update
        try {
            broadcastToChannel(poll.channel_id, {
                type: 'poll_update',
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
        const pool = require('../db').pool;
        const result = await pool.query(
            `UPDATE chat_polls SET is_closed = true WHERE id = $1 AND created_by = $2 RETURNING *`,
            [req.params.pollId, req.user.id || req.user.userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Опитування не знайдено' });

        try {
            broadcastToChannel(result.rows[0].channel_id, {
                type: 'poll_closed',
                pollId: parseInt(req.params.pollId)
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
        const pool = require('../db').pool;
        const pollResult = await pool.query('SELECT * FROM chat_polls WHERE id = $1', [req.params.pollId]);
        if (pollResult.rows.length === 0) return res.status(404).json({ error: 'Опитування не знайдено' });

        const poll = pollResult.rows[0];
        const totalVotes = await pool.query(
            'SELECT COUNT(DISTINCT user_id) AS total FROM chat_poll_votes WHERE poll_id = $1',
            [req.params.pollId]
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
                [req.params.pollId]
            );
            voters = voterResult.rows;
        }

        res.json({ poll: { ...poll, options }, totalVoters: total, voters });
    } catch (err) {
        log.error('Poll results error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v32.1: Kleshnya bridge — proxy to OpenClaw (HostHatch)
router.post('/kleshnya', async (req, res) => {
    const { message, context } = req.body;
    const user = req.user;

    try {
        const KLESHNYA_BRIDGE_URL = process.env.KLESHNYA_BRIDGE_URL;
        const KLESHNYA_BRIDGE_TOKEN = process.env.KLESHNYA_BRIDGE_TOKEN;

        if (!KLESHNYA_BRIDGE_URL) {
            return res.json({
                success: true,
                reply: '🦞 Клешня тимчасово недоступна. Пиши в Telegram @EventHelper_One_Bot'
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
            reply: '🦞 Клешня зараз зайнята. Спробуй ще раз або пиши в Telegram.'
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
        const cmd = command.toLowerCase().trim();

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
                const bk = await pool.query(
                    `SELECT SUBSTRING(time, 1, 5) AS t FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time`,
                    [date]
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
                const rows = await pool.query(
                    `SELECT SUBSTRING(time,1,5) AS t, program_name, label FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time LIMIT 20`,
                    [date]
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
        res.status(500).json({ success: false, error: err.message });
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

        const existing = await pool.query(
            'SELECT * FROM chat_channels WHERE linked_booking_id = $1', [bookingId]
        );
        if (existing.rowCount) return res.json({ success: true, channel: existing.rows[0], isNew: false });

        const bk = await pool.query(
            'SELECT id, date, program_name, label FROM bookings WHERE id = $1', [bookingId]
        );
        if (!bk.rowCount) return res.status(404).json({ error: 'Booking not found' });
        const b = bk.rows[0];

        const slugBase = 'bk-' + bookingId.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const slug = slugBase + '-' + Date.now().toString(36);
        const name = `🎉 ${b.date} ${b.program_name}`;
        const userId = req.user.id || req.user.userId;

        const r = await pool.query(
            `INSERT INTO chat_channels (slug, name, description, type, linked_booking_id, created_by)
             VALUES ($1, $2, $3, 'booking', $4, $5) RETURNING *`,
            [slug, name, `Координація: ${b.label}`, bookingId, req.user.username]
        );
        const channel = r.rows[0];

        await pool.query(
            'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [channel.id, userId]
        );

        res.json({ success: true, channel, isNew: true });
    } catch (err) {
        log.error('[BookingChannel] Error', err);
        res.status(500).json({ success: false, error: err.message });
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
        res.json({ success: true, channel: r.rows[0] || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
        res.status(500).json({ success: false, error: err.message });
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
        if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

        const { remindAt } = req.body;
        if (!remindAt) return res.status(400).json({ error: 'remindAt required' });
        const remindDate = new Date(remindAt);
        if (isNaN(remindDate.getTime()) || remindDate <= new Date()) {
            return res.status(400).json({ error: 'remindAt must be a future datetime' });
        }

        const msgRes = await pool.query(
            'SELECT id, channel_id, content FROM chat_messages WHERE id = $1', [messageId]
        );
        if (!msgRes.rowCount) return res.status(404).json({ error: 'Message not found' });
        const m = msgRes.rows[0];

        // Create task via kleshnya service
        let taskId = null;
        try {
            const kleshnya = require('../services/kleshnya');
            const task = await kleshnya.createTask({
                title: `⏰ Нагадування: "${m.content.slice(0, 80)}"`,
                description: `Нагадування з чату (канал #${m.channel_id}, msg #${m.id})`,
                deadline: remindAt,
                priority: 'normal',
                source_type: 'chat_reminder',
                category: 'admin',
                created_by: req.user.username
            });
            taskId = task.id;
        } catch (e) {
            // Fallback: insert task directly
            const taskRes = await pool.query(
                `INSERT INTO tasks (title, description, deadline, priority, status, created_by, category)
                 VALUES ($1, $2, $3, 'normal', 'todo', $4, 'admin') RETURNING id`,
                [
                    `⏰ Нагадування: "${m.content.slice(0, 80)}"`,
                    `Нагадування з чату (канал #${m.channel_id}, msg #${m.id})`,
                    remindAt,
                    req.user.username
                ]
            );
            taskId = taskRes.rows[0].id;
        }

        log.info(`[Remind] Task #${taskId} created for msg #${messageId} at ${remindAt}`);
        res.json({ success: true, taskId, remindAt });
    } catch (err) {
        log.error('[Remind] Error', err);
        res.status(500).json({ success: false, error: err.message });
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
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
