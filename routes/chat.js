/**
 * routes/chat.js — Team messenger REST API
 */
const router = require('express').Router();
const chat = require('../services/chatService');
const { broadcastToChannel, sendToUser } = require('../services/websocket');
const { createLogger } = require('../utils/logger');

const log = createLogger('ChatAPI');

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

        const { content, replyTo } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ error: 'Message content is required' });
        }
        if (content.length > 4000) {
            return res.status(400).json({ error: 'Message too long (max 4000 chars)' });
        }

        if (!await chat.isMember(channelId, userId)) {
            return res.status(403).json({ error: 'Not a member of this channel' });
        }

        const { message, mentionedUserIds } = await chat.sendMessage(channelId, userId, {
            content: content.trim(),
            replyTo: replyTo || null
        });

        // Broadcast to channel members via WebSocket (fire-and-forget after commit)
        broadcastToChannel(channelId, 'chat:message', {
            channelId,
            message
        }, String(userId));

        // Send mention notifications to specific users
        for (const mentionedId of mentionedUserIds) {
            sendToUser(String(mentionedId), 'chat:mention', {
                channelId,
                messageId: message.id,
                mentionedBy: message.username,
                content: message.content
            });
        }

        res.status(201).json(message);
    } catch (err) {
        log.error('Error sending message', err);
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

        broadcastToChannel(msg.channel_id, 'chat:reaction', {
            channelId: msg.channel_id,
            messageId,
            reactions
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

module.exports = router;
