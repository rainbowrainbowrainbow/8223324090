const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
    HOURLY_BLOCK_THRESHOLD,
    REPEAT_OFFENDER_THRESHOLD,
    recordGuardianMuteModerationStateInTransaction
} = require('../services/guardianModerationState');

function makeClient() {
    const state = {
        events: [],
        counters: [],
        queries: []
    };

    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            state.queries.push({ text, params });

            if (text.startsWith('SELECT pg_advisory_xact_lock')) {
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('INSERT INTO guardian_moderation_events')) {
                const row = {
                    id: state.events.length + 1,
                    counter_type: params[0],
                    user_id: params[1],
                    channel_id: params[2],
                    source_type: params[3],
                    source_id: params[4],
                    username: params[5],
                    occurred_at: params[6]
                };
                const exists = state.events.some(event =>
                    event.counter_type === row.counter_type &&
                    event.source_type === row.source_type &&
                    event.source_id === row.source_id
                );
                if (exists) return { rows: [], rowCount: 0 };
                state.events.push(row);
                return { rows: [{ id: row.id }], rowCount: 1 };
            }
            if (text.startsWith('SELECT id, count, alerted_at, window_start, window_end FROM guardian_moderation_counters')) {
                const row = state.counters.find(counter =>
                    counter.counter_type === params[0] &&
                    String(counter.user_id) === String(params[1]) &&
                    counter.window_key === params[2]
                );
                return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }
            if (text.startsWith('INSERT INTO guardian_moderation_counters')) {
                const row = {
                    id: state.counters.length + 1,
                    counter_type: params[0],
                    user_id: params[1],
                    window_key: params[2],
                    window_start: params[3],
                    window_end: params[4],
                    count: params[5],
                    last_channel_id: params[6],
                    last_username: params[7],
                    last_source_type: params[8],
                    last_source_id: params[9],
                    alerted_at: null
                };
                state.counters.push(row);
                return { rows: [{ id: row.id, count: row.count, alerted_at: row.alerted_at }], rowCount: 1 };
            }
            if (text.startsWith('UPDATE guardian_moderation_counters SET count')) {
                const row = state.counters.find(counter => String(counter.id) === String(params[8]));
                assert.ok(row, 'counter must exist before update');
                row.count = params[0];
                row.window_start = params[1];
                row.window_end = params[2];
                if (params[3]) row.alerted_at = null;
                row.last_channel_id = params[4];
                row.last_username = params[5];
                row.last_source_type = params[6];
                row.last_source_id = params[7];
                return { rows: [{ id: row.id, count: row.count, alerted_at: row.alerted_at }], rowCount: 1 };
            }
            if (text.startsWith('UPDATE guardian_moderation_counters SET alerted_at')) {
                const row = state.counters.find(counter => String(counter.id) === String(params[0]));
                if (!row || row.alerted_at) return { rows: [], rowCount: 0 };
                row.alerted_at = new Date().toISOString();
                return { rows: [{ alerted_at: row.alerted_at }], rowCount: 1 };
            }

            throw new Error(`Unexpected query: ${text}`);
        }
    };

    return { client, state };
}

async function recordMute(client, muteId, occurredAt = new Date('2026-05-12T10:00:00.000Z')) {
    return recordGuardianMuteModerationStateInTransaction(client, {
        muteId,
        userId: 42,
        channelId: 10,
        username: 'repeat-user',
        occurredAt
    });
}

describe('Guardian durable moderation state', () => {
    it('records repeat-offender state durably and alerts once at the threshold', async () => {
        const { client, state } = makeClient();
        let result;

        for (let i = 1; i <= REPEAT_OFFENDER_THRESHOLD; i++) {
            result = await recordMute(client, i);
        }

        assert.equal(result.repeatOffender.count, REPEAT_OFFENDER_THRESHOLD);
        assert.equal(result.repeatOffender.alert, true);
        assert.equal(state.counters.find(row => row.counter_type === 'repeat_offender').alerted_at !== null, true);

        result = await recordMute(client, 99);
        assert.equal(result.repeatOffender.count, REPEAT_OFFENDER_THRESHOLD + 1);
        assert.equal(result.repeatOffender.alert, false);
    });

    it('treats repeated source ids as duplicate input without incrementing counters', async () => {
        const { client, state } = makeClient();

        const first = await recordMute(client, 7);
        const duplicate = await recordMute(client, 7);

        assert.equal(first.repeatOffender.duplicate, false);
        assert.equal(duplicate.repeatOffender.duplicate, true);
        assert.equal(duplicate.hourlyBlocks.duplicate, true);
        assert.equal(state.events.length, 2);
        assert.equal(state.counters.find(row => row.counter_type === 'repeat_offender').count, 1);
        assert.equal(state.counters.find(row => row.counter_type === 'hourly_blocks').count, 1);
    });

    it('preserves hourly-block state across fresh service calls and alerts once per hour window', async () => {
        const { client, state } = makeClient();
        let result;

        for (let i = 1; i <= HOURLY_BLOCK_THRESHOLD; i++) {
            result = await recordMute(client, i, new Date('2026-05-12T10:15:00.000Z'));
        }

        assert.equal(result.hourlyBlocks.count, HOURLY_BLOCK_THRESHOLD);
        assert.equal(result.hourlyBlocks.alert, true);

        result = await recordMute(client, 77, new Date('2026-05-12T10:45:00.000Z'));
        assert.equal(result.hourlyBlocks.count, HOURLY_BLOCK_THRESHOLD + 1);
        assert.equal(result.hourlyBlocks.alert, false);

        const hourly = state.counters.find(row => row.counter_type === 'hourly_blocks');
        assert.equal(hourly.window_key, '2026-05-12T10');
        assert.equal(hourly.alerted_at !== null, true);
    });

    it('resets the repeat-offender rolling window after expiration', async () => {
        const { client, state } = makeClient();

        for (let i = 1; i <= REPEAT_OFFENDER_THRESHOLD; i++) {
            await recordMute(client, i, new Date('2026-05-01T10:00:00.000Z'));
        }

        const result = await recordMute(client, 50, new Date('2026-05-10T10:00:00.000Z'));

        assert.equal(result.repeatOffender.count, 1);
        assert.equal(result.repeatOffender.alert, false);
        assert.equal(state.counters.find(row => row.counter_type === 'repeat_offender').count, 1);
    });
});
