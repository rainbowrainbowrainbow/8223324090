const REPEAT_OFFENDER_COUNTER = 'repeat_offender';
const HOURLY_BLOCKS_COUNTER = 'hourly_blocks';
const REPEAT_OFFENDER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REPEAT_OFFENDER_THRESHOLD = 3;
const HOURLY_BLOCK_THRESHOLD = 5;

function toDate(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function addMs(date, ms) {
    return new Date(date.getTime() + ms);
}

function utcHourStart(date) {
    const d = toDate(date);
    d.setUTCMinutes(0, 0, 0);
    return d;
}

function utcHourKey(date) {
    return utcHourStart(date).toISOString().slice(0, 13);
}

async function lockCounter(client, counterType, userId, windowKey) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `guardian-moderation:${counterType}:${userId}:${windowKey}`
    ]);
}

async function insertEvent(client, input) {
    const result = await client.query(
        `INSERT INTO guardian_moderation_events
            (counter_type, user_id, channel_id, source_type, source_id, username, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (counter_type, source_type, source_id) DO NOTHING
         RETURNING id`,
        [
            input.counterType,
            input.userId,
            input.channelId || null,
            input.sourceType,
            String(input.sourceId),
            input.username || null,
            input.occurredAt
        ]
    );
    return result.rows.length > 0;
}

async function selectCounter(client, counterType, userId, windowKey) {
    const result = await client.query(
        `SELECT id, count, alerted_at, window_start, window_end
         FROM guardian_moderation_counters
         WHERE counter_type = $1 AND user_id = $2 AND window_key = $3
         FOR UPDATE`,
        [counterType, userId, windowKey]
    );
    return result.rows[0] || null;
}

async function insertCounter(client, input, count = 1) {
    const result = await client.query(
        `INSERT INTO guardian_moderation_counters
            (counter_type, user_id, window_key, window_start, window_end, count,
             last_channel_id, last_username, last_source_type, last_source_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, count, alerted_at`,
        [
            input.counterType,
            input.userId,
            input.windowKey,
            input.windowStart,
            input.windowEnd,
            count,
            input.channelId || null,
            input.username || null,
            input.sourceType,
            String(input.sourceId)
        ]
    );
    return result.rows[0];
}

async function updateCounter(client, existing, input, reset) {
    const result = await client.query(
        `UPDATE guardian_moderation_counters
         SET count = $1,
             window_start = $2,
             window_end = $3,
             alerted_at = CASE WHEN $4 THEN NULL ELSE alerted_at END,
             last_channel_id = $5,
             last_username = $6,
             last_source_type = $7,
             last_source_id = $8,
             updated_at = NOW()
         WHERE id = $9
         RETURNING id, count, alerted_at`,
        [
            reset ? 1 : Number(existing.count || 0) + 1,
            reset ? input.windowStart : existing.window_start,
            reset ? input.windowEnd : existing.window_end,
            reset,
            input.channelId || null,
            input.username || null,
            input.sourceType,
            String(input.sourceId),
            existing.id
        ]
    );
    return result.rows[0];
}

async function markAlerted(client, counterId) {
    const result = await client.query(
        `UPDATE guardian_moderation_counters
         SET alerted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND alerted_at IS NULL
         RETURNING alerted_at`,
        [counterId]
    );
    return result.rows.length > 0;
}

async function recordCounterInTransaction(client, input) {
    await lockCounter(client, input.counterType, input.userId, input.windowKey);

    const inserted = await insertEvent(client, input);
    if (!inserted) {
        return {
            counterType: input.counterType,
            duplicate: true,
            count: null,
            alert: false,
            windowKey: input.windowKey
        };
    }

    const existing = await selectCounter(client, input.counterType, input.userId, input.windowKey);
    const existingEnd = existing ? toDate(existing.window_end) : null;
    const reset = Boolean(input.resetWhenExpired && existingEnd && existingEnd <= input.occurredAt);
    const counter = existing
        ? await updateCounter(client, existing, input, reset)
        : await insertCounter(client, input, 1);

    let alert = false;
    if (Number(counter.count) >= input.threshold && !counter.alerted_at) {
        alert = await markAlerted(client, counter.id);
    }

    return {
        counterType: input.counterType,
        duplicate: false,
        count: Number(counter.count),
        threshold: input.threshold,
        alert,
        windowKey: input.windowKey,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd
    };
}

async function recordGuardianMuteModerationStateInTransaction(client, {
    muteId,
    userId,
    channelId,
    username,
    occurredAt = new Date()
}) {
    const occurred = toDate(occurredAt);
    const sourceType = 'guardian_mute';
    const sourceId = String(muteId);
    const repeatWindowStart = occurred;
    const repeatWindowEnd = addMs(occurred, REPEAT_OFFENDER_WINDOW_MS);
    const hourStart = utcHourStart(occurred);
    const hourEnd = addMs(hourStart, 60 * 60 * 1000);

    const repeatOffender = await recordCounterInTransaction(client, {
        counterType: REPEAT_OFFENDER_COUNTER,
        userId,
        channelId,
        username,
        sourceType,
        sourceId,
        occurredAt: occurred,
        threshold: REPEAT_OFFENDER_THRESHOLD,
        windowKey: 'rolling-7d',
        windowStart: repeatWindowStart,
        windowEnd: repeatWindowEnd,
        resetWhenExpired: true
    });

    const hourlyBlocks = await recordCounterInTransaction(client, {
        counterType: HOURLY_BLOCKS_COUNTER,
        userId,
        channelId,
        username,
        sourceType,
        sourceId,
        occurredAt: occurred,
        threshold: HOURLY_BLOCK_THRESHOLD,
        windowKey: utcHourKey(occurred),
        windowStart: hourStart,
        windowEnd: hourEnd,
        resetWhenExpired: false
    });

    return { repeatOffender, hourlyBlocks };
}

module.exports = {
    HOURLY_BLOCKS_COUNTER,
    HOURLY_BLOCK_THRESHOLD,
    REPEAT_OFFENDER_COUNTER,
    REPEAT_OFFENDER_THRESHOLD,
    recordCounterInTransaction,
    recordGuardianMuteModerationStateInTransaction,
    utcHourKey,
    utcHourStart
};
