'use strict';

const { loadParkWorkParticipants } = require('./parkWorkModuleAccess');
const { loadReadableParkChatChannelIds } = require('./parkChatAccess');

async function claimDueScheduledChatMessages(db, now, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid scheduled claim limit');
    for (let attempt = 0; attempt < 3; attempt++) {
        try { return await claimOnce(db, now, limit); }
        catch (error) {
            if (attempt === 2 || error.code !== '23505' || error.constraint !== 'chat_messages_channel_id_seq_key') throw error;
        }
    }
}

async function claimOnce(db, now, limit) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const participants = await loadParkWorkParticipants(client, 'chat');
        const senders = await client.query(`SELECT DISTINCT user_id FROM chat_messages
            WHERE is_scheduled IS TRUE AND scheduled_at <= $1 AND deleted_at IS NULL
              AND user_id = ANY($2::integer[])`, [now, [...participants.keys()]]);
        const permitted = [];
        for (const row of senders.rows) {
            const actor = participants.get(Number(row.user_id));
            if (!actor) continue;
            const channels = await loadReadableParkChatChannelIds(client, actor);
            if (channels.size) permitted.push({ user_id: Number(row.user_id), channel_ids: [...channels] });
        }
        const result = await client.query(`WITH due AS (
            SELECT cm.id FROM chat_messages cm
            JOIN jsonb_to_recordset($3::jsonb) permitted(user_id integer, channel_ids integer[])
              ON permitted.user_id = cm.user_id AND cm.channel_id = ANY(permitted.channel_ids)
            WHERE cm.is_scheduled IS TRUE AND cm.scheduled_at <= $1 AND cm.deleted_at IS NULL
              AND (cm.expires_at IS NULL OR cm.expires_at > $1)
            ORDER BY cm.scheduled_at ASC, cm.id ASC LIMIT $2
            FOR UPDATE OF cm SKIP LOCKED
        ) UPDATE chat_messages cm SET is_scheduled = false, seq = next_chat_seq(cm.channel_id)
          FROM due WHERE cm.id = due.id RETURNING cm.*`, [now, limit, JSON.stringify(permitted)]);
        await client.query('COMMIT');
        return result.rows;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

module.exports = { claimDueScheduledChatMessages };
