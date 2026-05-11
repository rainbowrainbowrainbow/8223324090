const { publishInTransaction } = require('./eventBus');
const { recordGuardianMuteModerationStateInTransaction } = require('./guardianModerationState');

function normalizeNullableId(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
}

function buildGuardianActionIdempotencyKey({ action, channelId, targetUserId }) {
    const channelPart = normalizeNullableId(channelId) ?? 'none';
    const userPart = normalizeNullableId(targetUserId) ?? 'none';
    return `guardian-action:${action}:channel:${channelPart}:user:${userPart}`;
}

async function lockGuardianScope(client, scope) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(scope)]);
}

async function claimGuardianMute({ pool, channelId, userId, reason, mutedUntil, details = {}, deliveryEvents = [] }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await lockGuardianScope(client, `guardian-mute:${channelId}:${userId}`);

        const existing = await client.query(
            `SELECT id, muted_until
             FROM chat_mutes
             WHERE channel_id = $1
               AND user_id = $2
               AND muted_until > NOW()
             ORDER BY muted_until DESC
             LIMIT 1
             FOR UPDATE`,
            [channelId, userId]
        );

        if (existing.rows.length > 0) {
            await client.query('COMMIT');
            return {
                muted: false,
                duplicate: true,
                muteId: existing.rows[0].id,
                mutedUntil: existing.rows[0].muted_until
            };
        }

        const muteResult = await client.query(
            `INSERT INTO chat_mutes (channel_id, user_id, reason, muted_until)
             VALUES ($1, $2, $3, $4)
             RETURNING id, muted_until`,
            [channelId, userId, reason, mutedUntil]
        );

        await client.query(
            `INSERT INTO guardian_actions (action_type, channel_id, target_user_id, message_id, details)
             VALUES ($1, $2, $3, $4, $5)`,
            ['mute', channelId, userId, null, JSON.stringify(details)]
        );

        const muteId = muteResult.rows[0]?.id;
        const moderationState = await recordGuardianMuteModerationStateInTransaction(client, {
            muteId,
            userId,
            channelId,
            username: details.username,
            occurredAt: new Date()
        });

        for (const deliveryEvent of deliveryEvents) {
            const context = {
                muteId,
                channelId,
                userId,
                mutedUntil: muteResult.rows[0]?.muted_until || mutedUntil,
                moderationState
            };
            const payload = typeof deliveryEvent.payload === 'function'
                ? deliveryEvent.payload(context)
                : deliveryEvent.payload;
            if (!payload) continue;
            const idempotencyKey = typeof deliveryEvent.idempotencyKey === 'function'
                ? deliveryEvent.idempotencyKey(context)
                : deliveryEvent.idempotencyKey;
            if (!idempotencyKey) continue;
            const aggregateId = typeof deliveryEvent.aggregateId === 'function'
                ? deliveryEvent.aggregateId(context)
                : (deliveryEvent.aggregateId || String(muteId || `${channelId}:${userId}`));

            await publishInTransaction(
                client,
                deliveryEvent.eventType,
                payload,
                deliveryEvent.aggregateType || 'guardian_mute',
                aggregateId,
                idempotencyKey
            );
        }

        await client.query('COMMIT');
        return {
            muted: true,
            duplicate: false,
            muteId: muteResult.rows[0]?.id,
            mutedUntil: muteResult.rows[0]?.muted_until || mutedUntil
        };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}

async function claimGuardianDirectorAction({ client, action, channelId, targetUserId, idempotencyKey, singleUse = false }) {
    const actionType = `director_${action}`;
    await lockGuardianScope(client, idempotencyKey);
    const recencyClause = singleUse ? '' : "AND created_at > NOW() - INTERVAL '10 minutes'";

    const existing = await client.query(
        `SELECT id, details
         FROM guardian_actions
         WHERE action_type = $1
           AND channel_id IS NOT DISTINCT FROM $2
           AND target_user_id IS NOT DISTINCT FROM $3
           AND details->>'idempotencyKey' = $4
           ${recencyClause}
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [actionType, normalizeNullableId(channelId), normalizeNullableId(targetUserId), idempotencyKey]
    );

    if (existing.rows.length > 0) {
        const details = existing.rows[0].details || {};
        return {
            duplicate: true,
            actionType,
            response: details.response,
            actionId: existing.rows[0].id
        };
    }

    return { duplicate: false, actionType };
}

async function recordGuardianDirectorAction({
    client,
    actionType,
    channelId,
    targetUserId,
    response,
    adminId,
    idempotencyKey
}) {
    await client.query(
        `INSERT INTO guardian_actions (action_type, channel_id, target_user_id, details)
         VALUES ($1, $2, $3, $4)`,
        [
            actionType,
            normalizeNullableId(channelId),
            normalizeNullableId(targetUserId),
            JSON.stringify({ response, adminId, idempotencyKey })
        ]
    );
}

module.exports = {
    buildGuardianActionIdempotencyKey,
    claimGuardianDirectorAction,
    claimGuardianMute,
    normalizeNullableId,
    recordGuardianDirectorAction
};
