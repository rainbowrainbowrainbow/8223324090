/**
 * services/chatService.js — Team messenger business logic (Phase 1 MVP)
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Chat');

// Channel list cache: Map<userId, { data, expiresAt }>
const _channelsCache = new Map();
const CHANNELS_CACHE_TTL = 8000; // 8 seconds

function invalidateChannelsCache(userId) {
    if (userId) {
        _channelsCache.delete(userId);
    } else {
        _channelsCache.clear();
    }
}

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
        isBot: row.is_bot || false,
        contentType: row.content_type || 'text',
        editedAt: row.edited_at || null,
        deletedAt: row.deleted_at || null,
        createdAt: row.created_at,
        username: row.username,
        displayName: row.display_name || row.username,
        metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
        threadRootId: row.thread_root_id || null,
        threadReplyCount: row.thread_reply_count || 0,
        expiresAt: row.expires_at || null
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
    // Check cache
    const cached = _channelsCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.data;
    }

    const result = await pool.query(`
        SELECT c.*, m.last_read_seq, m.muted,
            COALESCE((SELECT MAX(seq) FROM chat_messages WHERE channel_id = c.id), 0) - COALESCE(m.last_read_seq, 0) AS unread_count,
            (SELECT created_at FROM chat_messages WHERE channel_id = c.id ORDER BY seq DESC LIMIT 1) AS last_message_at,
            (SELECT content FROM chat_messages WHERE channel_id = c.id AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1) AS last_message_content,
            (SELECT u.username FROM chat_messages cm2 JOIN users u ON u.id = cm2.user_id WHERE cm2.channel_id = c.id AND cm2.deleted_at IS NULL ORDER BY cm2.seq DESC LIMIT 1) AS last_message_username
        FROM chat_channels c
        JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $1
        ORDER BY last_message_at DESC NULLS LAST, c.name
    `, [userId]);

    // For DM channels, resolve the other user's name (batched — no N+1)
    const channels = result.rows.map(mapChannelRow);
    const dmOtherIds = [];
    for (const ch of channels) {
        const row = result.rows.find(r => r.id === ch.id);
        ch.isDm = row.is_dm || false;
        ch.dmUserIds = row.dm_user_ids || null;
        ch.muted = row.muted || false;
        if (ch.isDm && ch.dmUserIds) {
            const otherId = ch.dmUserIds.find(id => id !== userId);
            if (otherId) {
                ch._dmOtherId = otherId;
                dmOtherIds.push(otherId);
            }
        }
    }

    // Batch-fetch all DM partner users in a single query
    if (dmOtherIds.length > 0) {
        const uRes = await pool.query(
            'SELECT id, username, name FROM users WHERE id = ANY($1)',
            [dmOtherIds]
        );
        const userMap = {};
        for (const u of uRes.rows) userMap[u.id] = u;
        for (const ch of channels) {
            if (ch._dmOtherId && userMap[ch._dmOtherId]) {
                const u = userMap[ch._dmOtherId];
                ch.name = u.name || u.username;
                ch.dmOtherUserId = ch._dmOtherId;
                ch.dmOtherUsername = u.username;
            }
            delete ch._dmOtherId;
        }
    }

    // Cache result
    _channelsCache.set(userId, { data: channels, expiresAt: Date.now() + CHANNELS_CACHE_TTL });
    return channels;
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
async function sendMessage(channelId, userId, { content, replyTo, clientMessageId, metadata }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Deduplication: check client_message_id
        if (clientMessageId) {
            const dup = await client.query(
                'SELECT id FROM chat_messages WHERE client_message_id = $1 AND channel_id = $2',
                [clientMessageId, channelId]
            );
            if (dup.rows.length > 0) {
                await client.query('ROLLBACK');
                const fullMsg = await pool.query(`
                    SELECT cm.*, u.username, u.name AS display_name,
                        rm.content AS reply_content, ru.username AS reply_username
                    FROM chat_messages cm
                    JOIN users u ON u.id = cm.user_id
                    LEFT JOIN chat_messages rm ON rm.id = cm.reply_to
                    LEFT JOIN users ru ON ru.id = rm.user_id
                    WHERE cm.id = $1
                `, [dup.rows[0].id]);
                return { message: mapMessageRow(fullMsg.rows[0]), mentionedUserIds: [] };
            }
        }

        // Get next seq (within transaction, UNIQUE constraint prevents dupes)
        const seqResult = await client.query(
            'SELECT next_chat_seq($1) AS seq', [channelId]
        );
        const seq = seqResult.rows[0].seq;

        // Insert message
        const msgResult = await client.query(`
            INSERT INTO chat_messages (channel_id, user_id, seq, content, reply_to, client_message_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [channelId, userId, seq, content, replyTo || null, clientMessageId || null, metadata ? JSON.stringify(metadata) : null]);
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

        // Invalidate channel cache for all members
        _channelsCache.clear();

        return {
            message: mapMessageRow(fullMsg.rows[0]),
            mentionedUserIds
        };
    } catch (err) {
        await client.query('ROLLBACK');
        // Retry once on unique violation (seq race condition)
        if (err.code === '23505' && err.constraint === 'chat_messages_channel_id_seq_key') {
            log.warn('Seq collision, retrying sendMessage');
            return sendMessage(channelId, userId, { content, replyTo, clientMessageId });
        }
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Send a file message to a channel.
 */
async function sendFileMessage(channelId, userId, content, contentType, metadata) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const seqResult = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
        const seq = seqResult.rows[0].seq;

        const msgResult = await client.query(`
            INSERT INTO chat_messages (channel_id, user_id, seq, content, content_type, metadata)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [channelId, userId, seq, content, contentType, JSON.stringify(metadata)]);
        const msg = msgResult.rows[0];

        // Update sender's last_read_seq
        await client.query(
            'UPDATE chat_channel_members SET last_read_seq = $1 WHERE channel_id = $2 AND user_id = $3',
            [seq, channelId, userId]
        );

        await client.query('COMMIT');

        const fullMsg = await pool.query(`
            SELECT cm.*, u.username, u.name AS display_name
            FROM chat_messages cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.id = $1
        `, [msg.id]);

        return {
            message: mapMessageRow(fullMsg.rows[0]),
            mentionedUserIds: []
        };
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505' && err.constraint === 'chat_messages_channel_id_seq_key') {
            return sendFileMessage(channelId, userId, content, contentType, metadata);
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
 * Get read receipts for a channel — who read up to what seq.
 */
async function getReadReceipts(channelId) {
    const result = await pool.query(
        `SELECT m.user_id, m.last_read_seq, u.username, u.name AS display_name
         FROM chat_channel_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.channel_id = $1 AND m.last_read_seq > 0`,
        [channelId]
    );
    return result.rows.map(r => ({
        userId: r.user_id,
        username: r.username,
        displayName: r.display_name || r.username,
        lastReadSeq: r.last_read_seq
    }));
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
        `SELECT id, username, name AS display_name, role,
                CASE WHEN chat_status_until IS NOT NULL AND chat_status_until < NOW()
                     THEN NULL ELSE chat_status END AS chat_status,
                CASE WHEN chat_status_until IS NOT NULL AND chat_status_until < NOW()
                     THEN NULL ELSE chat_status_emoji END AS chat_status_emoji
         FROM users WHERE is_active = true ORDER BY username`
    );
    return result.rows.map(r => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name || r.username,
        role: r.role,
        chatStatus: r.chat_status || null,
        chatStatusEmoji: r.chat_status_emoji || null
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

/**
 * Create a new channel.
 */
async function createChannel(slug, name, description, createdBy) {
    const result = await pool.query(`
        INSERT INTO chat_channels (slug, name, description, is_default, created_by)
        VALUES ($1, $2, $3, false, $4)
        RETURNING *
    `, [slug, name, description || '', createdBy]);
    const ch = result.rows[0];
    // Auto-join the creator
    await pool.query(
        'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [ch.id, createdBy]
    );
    return mapChannelRow({ ...ch, unread_count: '0' });
}

/**
 * Edit a message (only owner can edit).
 */
async function editMessage(messageId, userId, newContent) {
    const result = await pool.query(`
        UPDATE chat_messages SET content = $1, edited_at = NOW()
        WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
        RETURNING *
    `, [newContent, messageId, userId]);
    if (result.rows.length === 0) return null;
    const msg = result.rows[0];
    const full = await pool.query(`
        SELECT cm.*, u.username, u.name AS display_name,
            rm.content AS reply_content, ru.username AS reply_username
        FROM chat_messages cm
        JOIN users u ON u.id = cm.user_id
        LEFT JOIN chat_messages rm ON rm.id = cm.reply_to
        LEFT JOIN users ru ON ru.id = rm.user_id
        WHERE cm.id = $1
    `, [msg.id]);
    return mapMessageRow(full.rows[0]);
}

/**
 * Soft-delete a message (only owner or admin).
 */
async function deleteMessage(messageId, userId, isAdmin) {
    let result;
    if (isAdmin) {
        result = await pool.query(
            'UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *',
            [messageId]
        );
    } else {
        result = await pool.query(
            'UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *',
            [messageId, userId]
        );
    }
    const deleted = result.rows[0] || null;
    // v38.4.0: Clean up uploaded file on message delete
    if (deleted?.metadata?.file?.url) {
        try {
            const fname = deleted.metadata.file.url.replace('/uploads/chat/', '');
            const fpath = require('path').join(__dirname, '../uploads/chat', fname);
            require('fs').existsSync(fpath) && require('fs').unlinkSync(fpath);
        } catch (e) { /* file may already be gone */ }
    }
    return deleted;
}

/**
 * Pin/unpin a message in a channel.
 */
async function pinMessage(channelId, messageId, userId) {
    await pool.query(`
        INSERT INTO chat_pinned (channel_id, message_id, pinned_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (channel_id, message_id) DO NOTHING
    `, [channelId, messageId, userId]);
}

async function unpinMessage(channelId, messageId) {
    await pool.query(
        'DELETE FROM chat_pinned WHERE channel_id = $1 AND message_id = $2',
        [channelId, messageId]
    );
}

async function getPinnedMessages(channelId) {
    const result = await pool.query(`
        SELECT cm.*, u.username, u.name AS display_name, cp.pinned_at, pu.username AS pinned_by_username
        FROM chat_pinned cp
        JOIN chat_messages cm ON cm.id = cp.message_id
        JOIN users u ON u.id = cm.user_id
        JOIN users pu ON pu.id = cp.pinned_by
        WHERE cp.channel_id = $1 AND cm.deleted_at IS NULL
        ORDER BY cp.pinned_at DESC
    `, [channelId]);
    return result.rows.map(row => ({
        ...mapMessageRow(row),
        pinnedAt: row.pinned_at,
        pinnedByUsername: row.pinned_by_username
    }));
}

/**
 * Toggle mute for a channel member.
 */
async function toggleMute(channelId, userId) {
    const result = await pool.query(
        'UPDATE chat_channel_members SET muted = NOT muted WHERE channel_id = $1 AND user_id = $2 RETURNING muted',
        [channelId, userId]
    );
    return result.rows[0] ? result.rows[0].muted : false;
}

/**
 * Get channel members list.
 */
async function getChannelMembers(channelId) {
    const result = await pool.query(`
        SELECT u.id, u.username, u.name AS display_name, u.role, m.joined_at, m.muted
        FROM chat_channel_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.channel_id = $1 AND u.is_active = true
        ORDER BY u.username
    `, [channelId]);
    return result.rows.map(r => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name || r.username,
        role: r.role,
        joinedAt: r.joined_at,
        muted: r.muted
    }));
}

/**
 * Join a user to a channel.
 */
async function joinChannel(channelId, userId) {
    await pool.query(
        'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [channelId, userId]
    );
}

/**
 * Get or create a DM channel between two users.
 */
async function getOrCreateDM(userId1, userId2) {
    const ids = [Math.min(userId1, userId2), Math.max(userId1, userId2)];
    // Check if DM already exists
    const existing = await pool.query(
        `SELECT * FROM chat_channels WHERE is_dm = true AND dm_user_ids = $1`,
        [ids]
    );
    let ch;
    if (existing.rows.length > 0) {
        ch = existing.rows[0];
    } else {
        // Create DM channel
        const slug = 'dm-' + ids[0] + '-' + ids[1];
        const result = await pool.query(`
            INSERT INTO chat_channels (slug, name, description, is_default, is_dm, dm_user_ids, created_by)
            VALUES ($1, $2, '', false, true, $3, $4)
            RETURNING *
        `, [slug, 'DM', ids, userId1]);
        ch = result.rows[0];
        // Auto-join both users
        await pool.query(
            'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING',
            [ch.id, ids[0], ids[1]]
        );
    }

    // Resolve other user's name for the DM channel
    const otherId = ids[0] === userId1 ? ids[1] : ids[0];
    const uRes = await pool.query('SELECT id, username, name FROM users WHERE id = $1', [otherId]);
    const mapped = mapChannelRow({ ...ch, unread_count: '0' });
    mapped.isDm = true;
    mapped.dmUserIds = ch.dm_user_ids;
    mapped.dmOtherUserId = otherId;
    if (uRes.rows[0]) {
        mapped.name = uRes.rows[0].name || uRes.rows[0].username;
        mapped.dmOtherUsername = uRes.rows[0].username;
    }
    return mapped;
}

/**
 * Add a member to a channel.
 */
async function addMember(channelId, userId) {
    await pool.query(
        'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [channelId, userId]
    );
}

/**
 * Remove a member from a channel.
 */
async function removeMember(channelId, userId) {
    await pool.query(
        'DELETE FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2',
        [channelId, userId]
    );
}

/**
 * Get user profile (linked to users table).
 */
async function getUserProfile(userId) {
    const result = await pool.query(`
        SELECT u.id, u.username, u.name, u.role, u.created_at,
            u.avatar_emoji, u.avatar_color, u.last_seen_at,
            s.department, s.position, s.phone, s.telegram_username
        FROM users u
        LEFT JOIN staff s ON lower(s.name) = lower(u.name) AND s.is_active = true
        WHERE u.id = $1
    `, [userId]);
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
        id: r.id,
        username: r.username,
        displayName: r.name || r.username,
        role: r.role,
        avatarEmoji: r.avatar_emoji || null,
        avatarColor: r.avatar_color || null,
        department: r.department || null,
        position: r.position || null,
        phone: r.phone || null,
        telegram: r.telegram_username || null,
        joinedAt: r.created_at,
        lastSeenAt: r.last_seen_at || null
    };
}

/**
 * Update channel name/description.
 */
async function updateChannel(channelId, { name, description }) {
    const fields = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
    if (fields.length === 0) return null;
    fields.push(`updated_at = NOW()`);
    params.push(channelId);
    const result = await pool.query(
        `UPDATE chat_channels SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
    );
    return result.rows[0] ? mapChannelRow({ ...result.rows[0], unread_count: '0' }) : null;
}

/**
 * Archive a channel (soft delete).
 */
async function archiveChannel(channelId) {
    await pool.query(
        'UPDATE chat_channels SET is_archived = true, updated_at = NOW() WHERE id = $1',
        [channelId]
    );
}

/**
 * Search messages across channels the user has access to.
 */
async function searchMessages(userId, query, channelId, filters = {}) {
    const params = [userId, '%' + query.replace(/[%_]/g, '\\$&') + '%'];
    let extraFilters = '';
    let paramIdx = 3;

    if (channelId) {
        extraFilters += ' AND cm.channel_id = $' + paramIdx;
        params.push(channelId);
        paramIdx++;
    }
    if (filters.fromUser) {
        extraFilters += ' AND u.username = $' + paramIdx;
        params.push(filters.fromUser);
        paramIdx++;
    }
    if (filters.dateFrom) {
        extraFilters += ' AND cm.created_at >= $' + paramIdx;
        params.push(filters.dateFrom);
        paramIdx++;
    }
    if (filters.dateTo) {
        extraFilters += ' AND cm.created_at <= $' + paramIdx;
        params.push(filters.dateTo);
        paramIdx++;
    }
    if (filters.type === 'files') {
        extraFilters += " AND cm.content_type IN ('image', 'file')";
    } else if (filters.type === 'links') {
        extraFilters += " AND cm.content ~ 'https?://'";
    } else if (filters.type === 'mentions') {
        extraFilters += " AND cm.content ~ '@\\w+'";
    }

    const result = await pool.query(`
        SELECT cm.*, u.username, u.name AS display_name, c.name AS channel_name, c.slug AS channel_slug
        FROM chat_messages cm
        JOIN users u ON u.id = cm.user_id
        JOIN chat_channels c ON c.id = cm.channel_id
        JOIN chat_channel_members ccm ON ccm.channel_id = cm.channel_id AND ccm.user_id = $1
        WHERE cm.deleted_at IS NULL AND cm.content ILIKE $2${extraFilters}
        ORDER BY cm.created_at DESC
        LIMIT 50
    `, params);
    return result.rows.map(row => ({
        ...mapMessageRow(row),
        channelName: row.channel_name,
        channelSlug: row.channel_slug
    }));
}

/**
 * Send a system/bot message (no user auth needed).
 */
async function sendBotMessage(channelId, content, { contentType = 'system', metadata = null } = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const seqResult = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
        const seq = seqResult.rows[0].seq;
        // Prefer openclaw user, fallback to first admin
        const botUser = await client.query("SELECT id FROM users WHERE username = 'openclaw' OR role = 'admin' ORDER BY (username = 'openclaw') DESC, id LIMIT 1");
        const botUserId = botUser.rows[0]?.id || 1;
        const result = await client.query(`
            INSERT INTO chat_messages (channel_id, user_id, seq, content, is_bot, content_type, metadata)
            VALUES ($1, $2, $3, $4, true, $5, $6)
            RETURNING *
        `, [channelId, botUserId, seq, content, contentType, metadata ? JSON.stringify(metadata) : null]);
        await client.query('COMMIT');
        const msg = result.rows[0];
        const full = await pool.query(`
            SELECT cm.*, u.username, u.name AS display_name
            FROM chat_messages cm JOIN users u ON u.id = cm.user_id
            WHERE cm.id = $1
        `, [msg.id]);
        return mapMessageRow(full.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ==========================================
// CHAT TASKS
// ==========================================

/**
 * Create a task from chat.
 */
async function createTask({ channelId, messageId, assignedTo, assignedBy, title, deadline }) {
    const result = await pool.query(`
        INSERT INTO chat_tasks (channel_id, message_id, assigned_to, assigned_by, title, deadline)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
    `, [channelId, messageId || null, assignedTo || null, assignedBy, title, deadline || null]);
    return result.rows[0];
}

/**
 * Get tasks for a user.
 */
async function getTasks(userId) {
    const result = await pool.query(`
        SELECT t.*,
            au.username AS assigned_to_username, au.name AS assigned_to_name,
            bu.username AS assigned_by_username, bu.name AS assigned_by_name,
            c.name AS channel_name
        FROM chat_tasks t
        LEFT JOIN users au ON au.id = t.assigned_to
        LEFT JOIN users bu ON bu.id = t.assigned_by
        LEFT JOIN chat_channels c ON c.id = t.channel_id
        WHERE t.assigned_to = $1 OR t.assigned_by = $1
        ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.created_at DESC
    `, [userId]);
    return result.rows;
}

/**
 * Update task status.
 */
async function updateTask(taskId, userId, { status }) {
    const updates = ['status = $2'];
    const params = [taskId, status];
    if (status === 'done') {
        updates.push('completed_at = NOW()');
    }
    const result = await pool.query(
        `UPDATE chat_tasks SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
        params
    );
    return result.rows[0] || null;
}

/**
 * Find channel by linked entity (for CRM integration).
 */
async function findChannelByEntity(entityType, entityId) {
    const result = await pool.query(
        'SELECT * FROM chat_channels WHERE linked_entity_type = $1 AND linked_entity_id = $2 AND is_archived = false',
        [entityType, entityId]
    );
    return result.rows[0] || null;
}

/**
 * Create a booking event channel.
 */
async function createBookingChannel(bookingId, bookingDate, memberIds) {
    const slug = 'event-' + bookingDate + '-' + bookingId;
    const name = '#event-' + bookingDate + '-' + bookingId;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            INSERT INTO chat_channels (slug, name, description, is_default, type, linked_entity_type, linked_entity_id, created_by)
            VALUES ($1, $2, '', false, 'booking', 'booking', $3, $4)
            ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
            RETURNING *
        `, [slug, name, bookingId, memberIds[0] || 1]);
        const ch = result.rows[0];
        for (const uid of memberIds) {
            await client.query(
                'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [ch.id, uid]
            );
        }
        await client.query('COMMIT');
        return mapChannelRow({ ...ch, unread_count: '0' });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    getChannels,
    getChannelMessages,
    sendMessage,
    invalidateChannelsCache,
    markAsRead,
    addReaction,
    removeReaction,
    getUnreadCounts,
    ensureDefaultMemberships,
    getChatUsers,
    getChannelById,
    isMember,
    getMessageById,
    mapMessageRow,
    createChannel,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    getPinnedMessages,
    toggleMute,
    getChannelMembers,
    joinChannel,
    getOrCreateDM,
    addMember,
    removeMember,
    getUserProfile,
    updateChannel,
    archiveChannel,
    searchMessages,
    sendBotMessage,
    createTask,
    getTasks,
    updateTask,
    findChannelByEntity,
    createBookingChannel,
    getReadReceipts,
    sendFileMessage,
    updateActivityStats,
    getChatActivityStats,
    getChatActivityLeaderboard
};

/**
 * Update chat activity stats for a user (called on message send, reaction, etc.)
 */
async function updateActivityStats(userId, field) {
    const validFields = ['messages_sent', 'reactions_given', 'reactions_received', 'replies_sent'];
    if (!validFields.includes(field)) return;

    await pool.query(`
        INSERT INTO chat_activity_stats (user_id, date, ${field})
        VALUES ($1, CURRENT_DATE, 1)
        ON CONFLICT (user_id, date) DO UPDATE SET ${field} = chat_activity_stats.${field} + 1
    `, [userId]);
}

/**
 * Get chat activity stats for a user (last N days)
 */
async function getChatActivityStats(userId, days = 30) {
    const result = await pool.query(`
        SELECT
            COALESCE(SUM(messages_sent), 0) AS total_messages,
            COALESCE(SUM(reactions_given), 0) AS total_reactions_given,
            COALESCE(SUM(reactions_received), 0) AS total_reactions_received,
            COALESCE(SUM(replies_sent), 0) AS total_replies,
            COALESCE(AVG(helpfulness_score), 0) AS avg_helpfulness,
            COUNT(DISTINCT date) AS active_days
        FROM chat_activity_stats
        WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '1 day' * $2
    `, [userId, days]);
    return result.rows[0];
}

/**
 * Get leaderboard of chat activity
 */
async function getChatActivityLeaderboard(days = 30) {
    const result = await pool.query(`
        SELECT
            u.id AS user_id,
            u.username,
            u.name AS display_name,
            COALESCE(SUM(cas.messages_sent), 0) AS total_messages,
            COALESCE(SUM(cas.reactions_given), 0) AS total_reactions_given,
            COALESCE(SUM(cas.reactions_received), 0) AS total_reactions_received,
            COALESCE(SUM(cas.replies_sent), 0) AS total_replies,
            COUNT(DISTINCT cas.date) AS active_days,
            ROUND(
                (COALESCE(SUM(cas.messages_sent), 0) * 1.0 +
                 COALESCE(SUM(cas.reactions_given), 0) * 0.5 +
                 COALESCE(SUM(cas.reactions_received), 0) * 2.0 +
                 COALESCE(SUM(cas.replies_sent), 0) * 1.5) /
                GREATEST(COUNT(DISTINCT cas.date), 1),
                2
            ) AS activity_score
        FROM users u
        LEFT JOIN chat_activity_stats cas ON cas.user_id = u.id AND cas.date >= CURRENT_DATE - INTERVAL '1 day' * $1
        WHERE u.is_bot = false
        GROUP BY u.id, u.username, u.name
        ORDER BY activity_score DESC
        LIMIT 20
    `, [days]);
    return result.rows;
}
