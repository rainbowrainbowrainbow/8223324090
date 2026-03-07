/**
 * services/chatService.js — Team messenger business logic (Phase 1 MVP)
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Chat');

// snake_case → camelCase for API responses
function mapMessageRow(row) {
    return {
        id: row.id,
        channelId: row.channel_id,
        userId: row.user_id,
        seq: row.seq,
        content: row.content,
        replyTo: row.reply_to || null,
        replyContent: row.reply_content || null,
        replyUsername: row.reply_username || null,
        editedAt: row.edited_at || null,
        deletedAt: row.deleted_at || null,
        createdAt: row.created_at,
        username: row.username,
        displayName: row.display_name || row.username
    };
}

function mapChannelRow(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        isDefault: row.is_default,
        unreadCount: parseInt(row.unread_count || '0', 10),
        lastMessageAt: row.last_message_at || null,
        lastMessageContent: row.last_message_content || null,
        lastMessageUsername: row.last_message_username || null
    };
}

/**
 * Get all channels the user is a member of, with unread counts.
 */
async function getChannels(userId) {
    const result = await pool.query(`
        SELECT c.*, m.last_read_seq,
            COALESCE((SELECT MAX(seq) FROM chat_messages WHERE channel_id = c.id), 0) - COALESCE(m.last_read_seq, 0) AS unread_count,
            (SELECT created_at FROM chat_messages WHERE channel_id = c.id ORDER BY seq DESC LIMIT 1) AS last_message_at,
            (SELECT content FROM chat_messages WHERE channel_id = c.id AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1) AS last_message_content,
            (SELECT u.username FROM chat_messages cm2 JOIN users u ON u.id = cm2.user_id WHERE cm2.channel_id = c.id AND cm2.deleted_at IS NULL ORDER BY cm2.seq DESC LIMIT 1) AS last_message_username
        FROM chat_channels c
        JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $1
        ORDER BY last_message_at DESC NULLS LAST, c.name
    `, [userId]);
    return result.rows.map(mapChannelRow);
}

/**
 * Get paginated messages for a channel.
 */
async function getChannelMessages(channelId, userId, { before, limit = 50 } = {}) {
    const params = [channelId, Math.min(limit, 100)];
    let whereClause = 'cm.channel_id = $1';
    if (before) {
        whereClause += ' AND cm.seq < $3';
        params.push(before);
    }

    const result = await pool.query(`
        SELECT cm.*, u.username, u.name AS display_name,
            rm.content AS reply_content, ru.username AS reply_username
        FROM chat_messages cm
        JOIN users u ON u.id = cm.user_id
        LEFT JOIN chat_messages rm ON rm.id = cm.reply_to
        LEFT JOIN users ru ON ru.id = rm.user_id
        WHERE ${whereClause}
        ORDER BY cm.seq DESC
        LIMIT $2
    `, params);

    // Also fetch reactions for these messages
    const messageIds = result.rows.map(r => r.id);
    let reactionsMap = {};
    if (messageIds.length > 0) {
        const reactionsResult = await pool.query(`
            SELECT cr.message_id, cr.emoji, cr.user_id, u.username
            FROM chat_reactions cr
            JOIN users u ON u.id = cr.user_id
            WHERE cr.message_id = ANY($1)
        `, [messageIds]);
        for (const r of reactionsResult.rows) {
            if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
            reactionsMap[r.message_id].push({ emoji: r.emoji, userId: r.user_id, username: r.username });
        }
    }

    const messages = result.rows.map(row => ({
        ...mapMessageRow(row),
        reactions: reactionsMap[row.id] || []
    }));

    return messages.reverse(); // Return oldest-first for display
}

/**
 * Send a message in a channel. Uses transaction for seq atomicity.
 */
async function sendMessage(channelId, userId, { content, replyTo }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get next seq (within transaction, UNIQUE constraint prevents dupes)
        const seqResult = await client.query(
            'SELECT next_chat_seq($1) AS seq', [channelId]
        );
        const seq = seqResult.rows[0].seq;

        // Insert message
        const msgResult = await client.query(`
            INSERT INTO chat_messages (channel_id, user_id, seq, content, reply_to)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [channelId, userId, seq, content, replyTo || null]);
        const msg = msgResult.rows[0];

        // Parse @mentions
        const mentionMatches = content.match(/\B@(\w+)/g);
        const mentionedUserIds = [];
        if (mentionMatches) {
            const usernames = mentionMatches.map(m => m.slice(1));
            const usersResult = await client.query(
                'SELECT id, username FROM users WHERE username = ANY($1)',
                [usernames]
            );
            for (const u of usersResult.rows) {
                if (u.id !== userId) { // Don't mention yourself
                    await client.query(
                        'INSERT INTO chat_mentions (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [msg.id, u.id]
                    );
                    mentionedUserIds.push(u.id);
                }
            }
        }

        // Update sender's last_read_seq
        await client.query(
            'UPDATE chat_channel_members SET last_read_seq = $1 WHERE channel_id = $2 AND user_id = $3',
            [seq, channelId, userId]
        );

        await client.query('COMMIT');

        // Fetch full message with user info for broadcast
        const fullMsg = await pool.query(`
            SELECT cm.*, u.username, u.name AS display_name,
                rm.content AS reply_content, ru.username AS reply_username
            FROM chat_messages cm
            JOIN users u ON u.id = cm.user_id
            LEFT JOIN chat_messages rm ON rm.id = cm.reply_to
            LEFT JOIN users ru ON ru.id = rm.user_id
            WHERE cm.id = $1
        `, [msg.id]);

        return {
            message: mapMessageRow(fullMsg.rows[0]),
            mentionedUserIds
        };
    } catch (err) {
        await client.query('ROLLBACK');
        // Retry once on unique violation (seq race condition)
        if (err.code === '23505' && err.constraint === 'chat_messages_channel_id_seq_key') {
            log.warn('Seq collision, retrying sendMessage');
            return sendMessage(channelId, userId, { content, replyTo });
        }
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Mark channel as read up to a sequence number.
 */
async function markAsRead(channelId, userId, seq) {
    await pool.query(
        'UPDATE chat_channel_members SET last_read_seq = GREATEST(last_read_seq, $1) WHERE channel_id = $2 AND user_id = $3',
        [seq, channelId, userId]
    );
}

/**
 * Add a reaction to a message.
 */
async function addReaction(messageId, userId, emoji) {
    await pool.query(
        'INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [messageId, userId, emoji]
    );
    return getMessageReactions(messageId);
}

/**
 * Remove a reaction from a message.
 */
async function removeReaction(messageId, userId, emoji) {
    await pool.query(
        'DELETE FROM chat_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
        [messageId, userId, emoji]
    );
    return getMessageReactions(messageId);
}

/**
 * Get all reactions for a message (grouped).
 */
async function getMessageReactions(messageId) {
    const result = await pool.query(`
        SELECT cr.emoji, cr.user_id, u.username
        FROM chat_reactions cr
        JOIN users u ON u.id = cr.user_id
        WHERE cr.message_id = $1
    `, [messageId]);
    return result.rows.map(r => ({ emoji: r.emoji, userId: r.user_id, username: r.username }));
}

/**
 * Get unread counts across all channels for a user.
 */
async function getUnreadCounts(userId) {
    const result = await pool.query(`
        SELECT m.channel_id,
            GREATEST(COALESCE((SELECT MAX(seq) FROM chat_messages WHERE channel_id = m.channel_id), 0) - COALESCE(m.last_read_seq, 0), 0) AS unread_count
        FROM chat_channel_members m
        WHERE m.user_id = $1
    `, [userId]);
    const counts = {};
    let total = 0;
    for (const r of result.rows) {
        const count = parseInt(r.unread_count, 10);
        counts[r.channel_id] = count;
        total += count;
    }
    return { channels: counts, total };
}

/**
 * Auto-join user to all default channels.
 */
async function ensureDefaultMemberships(userId) {
    await pool.query(`
        INSERT INTO chat_channel_members (channel_id, user_id)
        SELECT c.id, $1 FROM chat_channels c WHERE c.is_default = true
        ON CONFLICT (channel_id, user_id) DO NOTHING
    `, [userId]);
}

/**
 * Get users list for @mention autocomplete.
 */
async function getChatUsers() {
    const result = await pool.query(
        "SELECT id, username, name AS display_name, role FROM users WHERE is_active = true ORDER BY username"
    );
    return result.rows.map(r => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name || r.username,
        role: r.role
    }));
}

/**
 * Get channel info by id (for validation).
 */
async function getChannelById(channelId) {
    const result = await pool.query('SELECT * FROM chat_channels WHERE id = $1', [channelId]);
    return result.rows[0] || null;
}

/**
 * Check if user is member of a channel.
 */
async function isMember(channelId, userId) {
    const result = await pool.query(
        'SELECT 1 FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2',
        [channelId, userId]
    );
    return result.rows.length > 0;
}

/**
 * Get message by id (for reactions validation).
 */
async function getMessageById(messageId) {
    const result = await pool.query('SELECT * FROM chat_messages WHERE id = $1', [messageId]);
    return result.rows[0] || null;
}

module.exports = {
    getChannels,
    getChannelMessages,
    sendMessage,
    markAsRead,
    addReaction,
    removeReaction,
    getUnreadCounts,
    ensureDefaultMemberships,
    getChatUsers,
    getChannelById,
    isMember,
    getMessageById,
    mapMessageRow
};
