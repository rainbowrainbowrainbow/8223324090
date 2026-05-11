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
            details: { username: 'animator' }
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
