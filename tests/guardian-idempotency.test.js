const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
    buildGuardianActionIdempotencyKey,
    claimGuardianDirectorAction,
    claimGuardianMute,
    recordGuardianDirectorAction
} = require('../services/guardianIdempotency');

function makePool({ failActionInsert = false } = {}) {
    const state = {
        mutes: [],
        actions: [],
        outbox: [],
        moderationEvents: [],
        moderationCounters: [],
        queries: [],
        committed: 0,
        rolledBack: 0
    };

    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            state.queries.push({ text, params });

            if (text === 'BEGIN') return { rows: [], rowCount: 0 };
            if (text === 'COMMIT') {
                state.committed += 1;
                return { rows: [], rowCount: 0 };
            }
            if (text === 'ROLLBACK') {
                state.rolledBack += 1;
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('SELECT pg_advisory_xact_lock')) {
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('SELECT id, muted_until FROM chat_mutes')) {
                const row = state.mutes.find(mute =>
                    String(mute.channel_id) === String(params[0]) &&
                    String(mute.user_id) === String(params[1]) &&
                    new Date(mute.muted_until).getTime() > Date.now()
                );
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            if (text.startsWith('INSERT INTO chat_mutes')) {
                const row = {
                    id: state.mutes.length + 1,
                    channel_id: params[0],
                    user_id: params[1],
                    reason: params[2],
                    muted_until: params[3]
                };
                state.mutes.push(row);
                return { rows: [{ id: row.id, muted_until: row.muted_until }], rowCount: 1 };
            }
            if (text.startsWith('INSERT INTO guardian_actions')) {
                if (failActionInsert) throw new Error('simulated action insert failure');
                let details = params[params.length - 1];
                if (typeof details === 'string') details = JSON.parse(details);
                const row = {
                    id: state.actions.length + 1,
                    action_type: params[0],
                    channel_id: params[1],
                    target_user_id: params[2],
                    message_id: params.length === 5 ? params[3] : null,
                    details
                };
                state.actions.push(row);
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('INSERT INTO outbox_events')) {
                const row = {
                    aggregate_type: params[0],
                    aggregate_id: params[1],
                    event_type: params[2],
                    payload: typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
                    idempotency_key: params[4]
                };
                if (!state.outbox.some(event => event.idempotency_key === row.idempotency_key)) {
                    state.outbox.push(row);
                    return { rows: [row], rowCount: 1 };
                }
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('INSERT INTO guardian_moderation_events')) {
                const row = {
                    id: state.moderationEvents.length + 1,
                    counter_type: params[0],
                    user_id: params[1],
                    channel_id: params[2],
                    source_type: params[3],
                    source_id: params[4],
                    username: params[5],
                    occurred_at: params[6]
                };
                const exists = state.moderationEvents.some(event =>
                    event.counter_type === row.counter_type &&
                    event.source_type === row.source_type &&
                    event.source_id === row.source_id
                );
                if (exists) return { rows: [], rowCount: 0 };
                state.moderationEvents.push(row);
                return { rows: [{ id: row.id }], rowCount: 1 };
            }
            if (text.startsWith('SELECT id, count, alerted_at, window_start, window_end FROM guardian_moderation_counters')) {
                const row = state.moderationCounters.find(counter =>
                    counter.counter_type === params[0] &&
                    String(counter.user_id) === String(params[1]) &&
                    counter.window_key === params[2]
                );
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            if (text.startsWith('INSERT INTO guardian_moderation_counters')) {
                const row = {
                    id: state.moderationCounters.length + 1,
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
                state.moderationCounters.push(row);
                return { rows: [{ id: row.id, count: row.count, alerted_at: row.alerted_at }], rowCount: 1 };
            }
            if (text.startsWith('UPDATE guardian_moderation_counters SET count')) {
                const row = state.moderationCounters.find(counter => String(counter.id) === String(params[8]));
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
                const row = state.moderationCounters.find(counter => String(counter.id) === String(params[0]));
                if (!row || row.alerted_at) return { rows: [], rowCount: 0 };
                row.alerted_at = new Date().toISOString();
                return { rows: [{ alerted_at: row.alerted_at }], rowCount: 1 };
            }
            if (text.startsWith('SELECT id, details FROM guardian_actions')) {
                const [actionType, channelId, targetUserId, idempotencyKey] = params;
                const row = state.actions.find(action =>
                    action.action_type === actionType &&
                    String(action.channel_id ?? '') === String(channelId ?? '') &&
                    String(action.target_user_id ?? '') === String(targetUserId ?? '') &&
                    action.details?.idempotencyKey === idempotencyKey
                );
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            return { rows: [], rowCount: 0 };
        },
        release() {}
    };

    return {
        state,
        pool: {
            async connect() {
                return client;
            }
        },
        client
    };
}

describe('Guardian mute/action idempotency helpers', () => {
    it('claims one active mute and returns duplicate for repeated mute calls', async () => {
        const { pool, state } = makePool();
        const mutedUntil = new Date(Date.now() + 60000);

        const first = await claimGuardianMute({
            pool,
            channelId: 10,
            userId: 2,
            reason: 'toxic',
            mutedUntil,
            details: { username: 'animator' },
            deliveryEvents: [{
                eventType: 'guardian.director_dm.requested',
                aggregateType: 'guardian_mute',
                aggregateId: ({ muteId }) => String(muteId),
                idempotencyKey: ({ muteId }) => `guardian.mute.dm:${muteId}`,
                payload: ({ muteId }) => ({ sourceId: String(muteId), content: 'mute alert' })
            }]
        });
        const second = await claimGuardianMute({
            pool,
            channelId: 10,
            userId: 2,
            reason: 'toxic again',
            mutedUntil: new Date(Date.now() + 120000),
            details: { username: 'animator' }
        });

        assert.equal(first.muted, true);
        assert.equal(second.duplicate, true);
        assert.equal(state.mutes.length, 1);
        assert.equal(state.actions.filter(action => action.action_type === 'mute').length, 1);
        assert.equal(state.outbox.length, 1);
        assert.equal(state.outbox[0].event_type, 'guardian.director_dm.requested');
        assert.equal(state.outbox[0].idempotency_key, 'guardian.mute.dm:1');
        assert.equal(state.moderationEvents.length, 2);
        assert.equal(state.moderationCounters.length, 2);
        assert.equal(state.queries.some(query => query.text.includes('pg_advisory_xact_lock')), true);
    });

    it('rolls back mute creation if action logging fails', async () => {
        const { pool, state } = makePool({ failActionInsert: true });

        await assert.rejects(() => claimGuardianMute({
            pool,
            channelId: 10,
            userId: 2,
            reason: 'toxic',
            mutedUntil: new Date(Date.now() + 60000)
        }), /simulated action insert failure/);

        assert.equal(state.rolledBack, 1);
    });

    it('builds deterministic director action keys and claims stale taps once', async () => {
        const { client, state } = makePool();
        const idempotencyKey = buildGuardianActionIdempotencyKey({
            action: 'warn',
            channelId: 10,
            targetUserId: 2
        });

        let claim = await claimGuardianDirectorAction({
            client,
            action: 'warn',
            channelId: 10,
            targetUserId: 2,
            idempotencyKey
        });
        assert.equal(claim.duplicate, false);

        await recordGuardianDirectorAction({
            client,
            actionType: claim.actionType,
            channelId: 10,
            targetUserId: 2,
            response: 'warned',
            adminId: 1,
            idempotencyKey
        });

        claim = await claimGuardianDirectorAction({
            client,
            action: 'warn',
            channelId: 10,
            targetUserId: 2,
            idempotencyKey
        });

        assert.equal(claim.duplicate, true);
        assert.equal(claim.response, 'warned');
        assert.equal(state.actions.length, 1);
    });

    it('uses permanent consumed-token lookup for single-use action controls', async () => {
        const { client, state } = makePool();
        const idempotencyKey = 'guardian-action:alert-123:0';

        const claim = await claimGuardianDirectorAction({
            client,
            action: 'watch',
            channelId: 10,
            targetUserId: 2,
            idempotencyKey,
            singleUse: true
        });

        assert.equal(claim.duplicate, false);
        const lookup = state.queries.find(query => query.text.startsWith('SELECT id, details FROM guardian_actions'));
        assert.ok(lookup);
        assert.equal(lookup.text.includes("INTERVAL '10 minutes'"), false);
    });
});
