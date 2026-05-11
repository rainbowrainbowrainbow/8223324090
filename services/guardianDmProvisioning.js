const GUARDIAN_DIRECTOR_DM_SLUG = 'dm-guardian-director';

function readInsertedFlag(row) {
    return row?.inserted === true || row?.inserted === 't' || row?.inserted === 'true';
}

function normalizeDmUserIds(guardianId, directorId) {
    return [Number(guardianId), Number(directorId)].sort((a, b) => a - b);
}

async function ensureGuardianDmShape(client, channel, guardianId, directorId) {
    if (!channel) return null;
    if (channel.is_dm === true && Array.isArray(channel.dm_user_ids)) return channel;

    const updated = await client.query(`
        UPDATE chat_channels
        SET is_dm = true,
            dm_user_ids = COALESCE(dm_user_ids, $2),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [channel.id, normalizeDmUserIds(guardianId, directorId)]);

    return updated.rows[0] || channel;
}

async function provisionGuardianDirectorDm({ pool, guardianId, directorId }) {
    if (!pool || typeof pool.connect !== 'function') {
        throw new Error('pool with connect() is required');
    }
    if (!guardianId || !directorId) {
        throw new Error('guardianId and directorId are required');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const bySlug = await client.query(`
            SELECT *
            FROM chat_channels
            WHERE slug = $1
              AND COALESCE(is_archived, false) = false
            ORDER BY id ASC
            LIMIT 1
            FOR UPDATE
        `, [GUARDIAN_DIRECTOR_DM_SLUG]);

        let channel = await ensureGuardianDmShape(client, bySlug.rows[0] || null, guardianId, directorId);
        let isNew = false;
        let existingBySlug = !!channel;
        let existingByMembers = false;

        if (!channel) {
            const byMembers = await client.query(`
                SELECT c.*
                FROM chat_channels c
                JOIN chat_channel_members m1 ON m1.channel_id = c.id AND m1.user_id = $1
                JOIN chat_channel_members m2 ON m2.channel_id = c.id AND m2.user_id = $2
                WHERE c.is_dm = true
                  AND COALESCE(c.is_archived, false) = false
                ORDER BY c.id ASC
                LIMIT 1
                FOR UPDATE
            `, [guardianId, directorId]);

            channel = byMembers.rows[0] || null;
            existingByMembers = !!channel;
        }

        if (!channel) {
            const dmUserIds = normalizeDmUserIds(guardianId, directorId);
            const inserted = await client.query(`
                INSERT INTO chat_channels (name, slug, description, is_default, is_dm, dm_user_ids, created_by)
                VALUES ($1, $2, $3, false, true, $4, $5)
                ON CONFLICT (slug) DO UPDATE SET
                    name = COALESCE(NULLIF(chat_channels.name, ''), EXCLUDED.name),
                    description = COALESCE(NULLIF(chat_channels.description, ''), EXCLUDED.description),
                    is_dm = true,
                    dm_user_ids = COALESCE(chat_channels.dm_user_ids, EXCLUDED.dm_user_ids),
                    updated_at = NOW()
                RETURNING *, (xmax = 0) AS inserted
            `, ['Guardian -> Director', GUARDIAN_DIRECTOR_DM_SLUG, 'Guardian director alerts', dmUserIds, guardianId]);

            channel = inserted.rows[0];
            isNew = readInsertedFlag(channel);
        }

        await client.query(
            'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT (channel_id, user_id) DO NOTHING',
            [channel.id, guardianId, directorId]
        );

        await client.query('COMMIT');
        return {
            channel,
            channelId: channel.id,
            isNew,
            existingBySlug,
            existingByMembers
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    GUARDIAN_DIRECTOR_DM_SLUG,
    provisionGuardianDirectorDm
};
