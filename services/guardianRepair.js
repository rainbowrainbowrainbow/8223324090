const {
    HOURLY_BLOCKS_COUNTER,
    HOURLY_BLOCK_THRESHOLD,
    REPEAT_OFFENDER_COUNTER,
    REPEAT_OFFENDER_THRESHOLD,
    utcHourKey,
    utcHourStart
} = require('./guardianModerationState');

const REPAIR_COUNTER_TYPES = [REPEAT_OFFENDER_COUNTER, HOURLY_BLOCKS_COUNTER];
const LOOKBACK_DAYS = 8;
const REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function toDate(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function datesEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return toDate(a).getTime() === toDate(b).getTime();
}

function normalizeCount(value) {
    return Number(value || 0);
}

function counterKey(row) {
    return `${row.counter_type || row.counterType}:${row.window_key || row.windowKey}`;
}

function buildExpectedRepeatCounter(events, now) {
    const ordered = events
        .filter(event => event.counter_type === REPEAT_OFFENDER_COUNTER)
        .sort((a, b) => toDate(a.occurred_at) - toDate(b.occurred_at));
    if (ordered.length === 0) return null;

    let windowStart = toDate(ordered[0].occurred_at);
    let windowEnd = new Date(windowStart.getTime() + REPEAT_WINDOW_MS);
    let count = 0;
    let lastEvent = null;

    for (const event of ordered) {
        const occurred = toDate(event.occurred_at);
        if (occurred >= windowEnd) {
            windowStart = occurred;
            windowEnd = new Date(windowStart.getTime() + REPEAT_WINDOW_MS);
            count = 0;
        }
        count++;
        lastEvent = event;
    }

    if (windowEnd <= now) {
        return null;
    }

    return {
        counter_type: REPEAT_OFFENDER_COUNTER,
        user_id: lastEvent.user_id,
        window_key: 'rolling-7d',
        window_start: windowStart,
        window_end: windowEnd,
        count,
        threshold: REPEAT_OFFENDER_THRESHOLD,
        last_channel_id: lastEvent.channel_id || null,
        last_username: lastEvent.username || null,
        last_source_type: lastEvent.source_type,
        last_source_id: String(lastEvent.source_id)
    };
}

function buildExpectedHourlyCounters(events) {
    const groups = new Map();
    for (const event of events.filter(row => row.counter_type === HOURLY_BLOCKS_COUNTER)) {
        const occurred = toDate(event.occurred_at);
        const key = utcHourKey(occurred);
        const current = groups.get(key) || {
            counter_type: HOURLY_BLOCKS_COUNTER,
            user_id: event.user_id,
            window_key: key,
            window_start: utcHourStart(occurred),
            window_end: new Date(utcHourStart(occurred).getTime() + HOUR_MS),
            count: 0,
            threshold: HOURLY_BLOCK_THRESHOLD,
            last_channel_id: null,
            last_username: null,
            last_source_type: null,
            last_source_id: null,
            lastOccurredAt: null
        };
        current.count++;
        if (!current.lastOccurredAt || occurred >= current.lastOccurredAt) {
            current.last_channel_id = event.channel_id || null;
            current.last_username = event.username || null;
            current.last_source_type = event.source_type;
            current.last_source_id = String(event.source_id);
            current.lastOccurredAt = occurred;
        }
        groups.set(key, current);
    }

    return [...groups.values()].map(({ lastOccurredAt, ...row }) => row);
}

function buildExpectedCounters(events, now = new Date()) {
    const expected = [];
    const repeat = buildExpectedRepeatCounter(events, now);
    if (repeat) expected.push(repeat);
    expected.push(...buildExpectedHourlyCounters(events));
    return expected;
}

function counterMatches(existing, expected) {
    return normalizeCount(existing.count) === normalizeCount(expected.count)
        && datesEqual(existing.window_start, expected.window_start)
        && datesEqual(existing.window_end, expected.window_end)
        && String(existing.last_channel_id || '') === String(expected.last_channel_id || '')
        && String(existing.last_username || '') === String(expected.last_username || '')
        && String(existing.last_source_type || '') === String(expected.last_source_type || '')
        && String(existing.last_source_id || '') === String(expected.last_source_id || '');
}

function describeExpectedCounter(row) {
    return {
        counterType: row.counter_type,
        windowKey: row.window_key,
        expectedCount: row.count,
        threshold: row.threshold,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        lastChannelId: row.last_channel_id,
        lastUsername: row.last_username,
        lastSourceType: row.last_source_type,
        lastSourceId: row.last_source_id
    };
}

function compareCounters(existingRows, expectedRows, now = new Date()) {
    const issues = [];
    const existingByKey = new Map(existingRows.map(row => [counterKey(row), row]));
    const expectedByKey = new Map(expectedRows.map(row => [counterKey(row), row]));

    for (const expected of expectedRows) {
        const key = counterKey(expected);
        const existing = existingByKey.get(key);
        if (!existing) {
            issues.push({
                type: 'missing_counter',
                repairable: true,
                counterType: expected.counter_type,
                windowKey: expected.window_key,
                explanation: 'A durable moderation event exists but the derived counter row is missing.',
                expected: describeExpectedCounter(expected),
                actual: null
            });
            continue;
        }
        if (!counterMatches(existing, expected)) {
            issues.push({
                type: 'counter_mismatch',
                repairable: true,
                counterType: expected.counter_type,
                windowKey: expected.window_key,
                explanation: 'The derived counter row does not match the event-source facts for this user/window.',
                expected: describeExpectedCounter(expected),
                actual: {
                    count: normalizeCount(existing.count),
                    windowStart: existing.window_start,
                    windowEnd: existing.window_end,
                    lastChannelId: existing.last_channel_id,
                    lastUsername: existing.last_username,
                    lastSourceType: existing.last_source_type,
                    lastSourceId: existing.last_source_id,
                    alertedAt: existing.alerted_at || null
                }
            });
        }
    }

    for (const existing of existingRows) {
        const key = counterKey(existing);
        if (expectedByKey.has(key)) continue;
        const windowEnd = existing.window_end ? toDate(existing.window_end) : null;
        issues.push({
            type: existing.counter_type === REPEAT_OFFENDER_COUNTER ? 'stale_repeat_counter' : 'orphan_counter',
            repairable: false,
            counterType: existing.counter_type,
            windowKey: existing.window_key,
            explanation: windowEnd && windowEnd <= now
                ? 'The counter window is expired or has no matching recent moderation event; this preview reports it but does not delete historical state.'
                : 'A counter row exists without a matching recent moderation event; this preview reports it but does not delete historical state.',
            actual: {
                count: normalizeCount(existing.count),
                windowStart: existing.window_start,
                windowEnd: existing.window_end,
                lastSourceType: existing.last_source_type,
                lastSourceId: existing.last_source_id
            }
        });
    }

    return issues;
}

async function loadUserModerationState(db, userId) {
    const userResult = await db.query(
        'SELECT id, username, name FROM users WHERE id = $1 LIMIT 1',
        [userId]
    );
    const user = userResult.rows[0] || null;
    if (!user) {
        const error = new Error('Guardian user not found');
        error.statusCode = 404;
        throw error;
    }

    const counters = await db.query(
        `SELECT id, counter_type, user_id, window_key, window_start, window_end, count,
                last_channel_id, last_username, last_source_type, last_source_id,
                alerted_at, updated_at
         FROM guardian_moderation_counters
         WHERE user_id = $1 AND counter_type = ANY($2::text[])
         ORDER BY counter_type, window_start DESC`,
        [userId, REPAIR_COUNTER_TYPES]
    );
    const events = await db.query(
        `SELECT id, counter_type, user_id, channel_id, source_type, source_id, username, occurred_at
         FROM guardian_moderation_events
         WHERE user_id = $1
           AND counter_type = ANY($2::text[])
           AND occurred_at >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'
         ORDER BY occurred_at ASC, id ASC`,
        [userId, REPAIR_COUNTER_TYPES]
    );

    return { user, counters: counters.rows, events: events.rows };
}

async function previewGuardianUserModerationRepair(db, userId, options = {}) {
    const now = toDate(options.now);
    const { user, counters, events } = await loadUserModerationState(db, userId);
    const expectedCounters = buildExpectedCounters(events, now);
    const issues = compareCounters(counters, expectedCounters, now);
    return {
        user: {
            id: user.id,
            username: user.username || null,
            name: user.name || null
        },
        lookbackDays: LOOKBACK_DAYS,
        eventCount: events.length,
        counterCount: counters.length,
        expectedCounterCount: expectedCounters.length,
        issueCount: issues.length,
        repairableIssueCount: issues.filter(issue => issue.repairable).length,
        clean: issues.length === 0,
        issues,
        expectedCounters: expectedCounters.map(describeExpectedCounter)
    };
}

async function upsertCounter(client, userId, expected) {
    const result = await client.query(
        `INSERT INTO guardian_moderation_counters
            (counter_type, user_id, window_key, window_start, window_end, count,
             last_channel_id, last_username, last_source_type, last_source_id, alerted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NOW())
         ON CONFLICT (counter_type, user_id, window_key) DO UPDATE SET
             window_start = EXCLUDED.window_start,
             window_end = EXCLUDED.window_end,
             count = EXCLUDED.count,
             last_channel_id = EXCLUDED.last_channel_id,
             last_username = EXCLUDED.last_username,
             last_source_type = EXCLUDED.last_source_type,
             last_source_id = EXCLUDED.last_source_id,
             alerted_at = CASE
                 WHEN EXCLUDED.count >= $11 THEN guardian_moderation_counters.alerted_at
                 ELSE NULL
             END,
             updated_at = NOW()
         RETURNING id, counter_type, user_id, window_key, count, alerted_at, updated_at`,
        [
            expected.counter_type,
            userId,
            expected.window_key,
            expected.window_start,
            expected.window_end,
            expected.count,
            expected.last_channel_id,
            expected.last_username,
            expected.last_source_type,
            expected.last_source_id,
            expected.threshold
        ]
    );
    return result.rows[0];
}

async function repairGuardianUserModerationState(dbPool, userId, options = {}) {
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const preview = await previewGuardianUserModerationRepair(client, userId, options);
        const repairableKeys = new Set(
            preview.issues
                .filter(issue => issue.repairable)
                .map(issue => `${issue.counterType}:${issue.windowKey}`)
        );

        const applied = [];
        for (const expected of buildExpectedCounters(
            (await loadUserModerationState(client, userId)).events,
            toDate(options.now)
        )) {
            if (!repairableKeys.has(counterKey(expected))) continue;
            applied.push(await upsertCounter(client, userId, expected));
        }

        await client.query('COMMIT');
        return {
            ...preview,
            dryRun: false,
            appliedCount: applied.length,
            applied: applied.map(row => ({
                id: row.id,
                counterType: row.counter_type,
                windowKey: row.window_key,
                count: normalizeCount(row.count),
                alertedAt: row.alerted_at || null,
                updatedAt: row.updated_at
            }))
        };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    buildExpectedCounters,
    compareCounters,
    previewGuardianUserModerationRepair,
    repairGuardianUserModerationState
};
