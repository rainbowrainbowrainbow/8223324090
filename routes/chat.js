/**
 * routes/chat.js — Team messenger REST API
 */
const router = require('express').Router();
const chat = require('../services/chatService');
const { broadcastToChannel, sendToUser } = require('../services/websocket');
const { processMessage: processBotMessage } = require('../services/chat-bot');
const guardian = require('../services/guardian');
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

        const { content, replyTo, clientMessageId } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ error: 'Message content is required' });
        }
        if (content.length > 4000) {
            return res.status(400).json({ error: 'Message too long (max 4000 chars)' });
        }

        if (!await chat.isMember(channelId, userId)) {
            return res.status(403).json({ error: 'Not a member of this channel' });
        }

        // Guardian: check if user is muted
        if (guardian.isUserMuted(channelId, userId)) {
            return res.status(403).json({ error: '🛡️ Ви заблоковані в цьому чаті. Зачекайте 15 хвилин.' });
        }

        const { message, mentionedUserIds } = await chat.sendMessage(channelId, userId, {
            content: content.trim(),
            replyTo: replyTo || null,
            clientMessageId: clientMessageId || null
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

        // Bot processing (fire-and-forget — don't block response)
        processBotMessage(message).catch(err => {
            log.error('Bot processing error', err);
        });

        // Guardian processing (fire-and-forget — mask sensitive data, detect conflicts)
        guardian.processMessage(message).catch(err => {
            log.error('Guardian processing error', err);
        });

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
        const { userId: targetUserId } = req.body;
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
        const { name, description } = req.body;
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

// GET /api/chat/search — search messages
router.get('/search', async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const q = req.query.q;
        if (!q || q.trim().length < 2) {
            return res.status(400).json({ error: 'Query must be at least 2 characters' });
        }
        const channelId = req.query.channel_id ? parseInt(req.query.channel_id, 10) : null;
        const results = await chat.searchMessages(userId, q.trim(), channelId);
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

module.exports = router;
