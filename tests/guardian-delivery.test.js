const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
    GUARDIAN_DIRECTOR_DM_REQUESTED,
    GUARDIAN_TELEGRAM_ALERT_REQUESTED,
    buildGuardianDeliveryIdempotencyKey,
    processGuardianDeliveryEvent
} = require('../services/guardianDelivery');

function makeDirectorPool({ existingDeliveryKey = null, failInsert = false } = {}) {
    const state = {
        messages: [],
        queries: [],
        tx: [],
        broadcasts: []
    };

    if (existingDeliveryKey) {
        state.messages.push({
            id: 99,
            channel_id: 200,
            user_id: 11,
            seq: 1,
            content: 'existing',
            metadata: { deliveryKey: existingDeliveryKey },
            created_at: new Date().toISOString()
        });
    }

    function findDelivery(params) {
        return state.messages.find(message => message.metadata?.deliveryKey === params[0]);
    }

    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            state.queries.push({ text, params });

            if (text === 'BEGIN') {
                state.tx.push('BEGIN');
                return { rows: [], rowCount: 0 };
            }
            if (text === 'COMMIT') {
                state.tx.push('COMMIT');
                return { rows: [], rowCount: 0 };
            }
            if (text === 'ROLLBACK') {
                state.tx.push('ROLLBACK');
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('SELECT id FROM chat_messages WHERE metadata')) {
                const existing = findDelivery(params);
                return { rows: existing ? [{ id: existing.id }] : [], rowCount: existing ? 1 : 0 };
            }
            if (text.startsWith('SELECT next_chat_seq')) {
                return { rows: [{ seq: state.messages.length + 1 }], rowCount: 1 };
            }
            if (text.startsWith('INSERT INTO chat_messages')) {
                if (failInsert) throw new Error('simulated chat message insert failure');
                const metadata = typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4];
                const row = {
                    id: state.messages.length + 1,
                    channel_id: params[0],
                    user_id: params[1],
                    seq: params[2],
                    content: params[3],
                    is_bot: true,
                    content_type: 'bot',
                    metadata,
                    created_at: new Date().toISOString()
                };
                state.messages.push(row);
                return { rows: [row], rowCount: 1 };
            }
            throw new Error(`Unexpected client query: ${text}`);
        },
        release() {}
    };

    return {
        state,
        pool: {
            async query(sql, params = []) {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                state.queries.push({ text, params });

                if (text.startsWith('SELECT id FROM chat_messages WHERE metadata')) {
                    const existing = findDelivery(params);
                    return { rows: existing ? [{ id: existing.id }] : [], rowCount: existing ? 1 : 0 };
                }
                if (text.startsWith("SELECT id FROM users WHERE role = 'admin'")) {
                    return { rows: [{ id: 22 }], rowCount: 1 };
                }
                if (text.startsWith('SELECT id FROM users WHERE username')) {
                    return { rows: [{ id: 11 }], rowCount: 1 };
                }
                throw new Error(`Unexpected pool query: ${text}`);
            },
            async connect() {
                return client;
            }
        }
    };
}

describe('Guardian outbox-backed delivery', () => {
    it('delivers director DM requests once with stable action tokens', async () => {
        const { pool, state } = makeDirectorPool();
        const event = {
            id: 1,
            event_type: GUARDIAN_DIRECTOR_DM_REQUESTED,
            idempotency_key: 'guardian.mute.dm:77',
            payload: {
                deliveryKey: 'guardian.mute.dm:77',
                deliveryType: 'guardian_mute_director_dm',
                sourceType: 'guardian_mute',
                sourceId: '77',
                content: 'mute alert',
                actions: [{ action: 'watch', label: 'Watch', channelId: 10, userId: 2 }]
            }
        };

        const handled = await processGuardianDeliveryEvent(event, {
            pool,
            provisionGuardianDirectorDm: async () => ({ channelId: 200 }),
            broadcastToChannel: (...args) => state.broadcasts.push(args)
        });

        assert.equal(handled, true);
        assert.equal(state.messages.length, 1);
        assert.equal(state.messages[0].metadata.deliveryKey, 'guardian.mute.dm:77');
        assert.match(state.messages[0].metadata.actions[0].actionToken, /^guardian-action:/);
        assert.equal(state.broadcasts.length, 1);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
    });

    it('suppresses duplicate director DM processing by delivery key', async () => {
        const { pool, state } = makeDirectorPool({ existingDeliveryKey: 'guardian.mute.dm:77' });
        const event = {
            id: 1,
            event_type: GUARDIAN_DIRECTOR_DM_REQUESTED,
            idempotency_key: 'guardian.mute.dm:77',
            payload: {
                deliveryKey: 'guardian.mute.dm:77',
                content: 'mute alert',
                actions: []
            }
        };

        const handled = await processGuardianDeliveryEvent(event, {
            pool,
            provisionGuardianDirectorDm: async () => {
                throw new Error('provision should not run for duplicate delivery');
            },
            broadcastToChannel: (...args) => state.broadcasts.push(args)
        });

        assert.equal(handled, true);
        assert.equal(state.messages.length, 1);
        assert.equal(state.broadcasts.length, 0);
        assert.deepEqual(state.tx, []);
    });

    it('throws delivery errors so event_queue retry can own failure visibility', async () => {
        const { pool, state } = makeDirectorPool({ failInsert: true });
        const event = {
            id: 1,
            event_type: GUARDIAN_DIRECTOR_DM_REQUESTED,
            idempotency_key: 'guardian.mute.dm:77',
            payload: { deliveryKey: 'guardian.mute.dm:77', content: 'mute alert', actions: [] }
        };

        await assert.rejects(
            () => processGuardianDeliveryEvent(event, {
                pool,
                provisionGuardianDirectorDm: async () => ({ channelId: 200 }),
                broadcastToChannel: (...args) => state.broadcasts.push(args)
            }),
            /simulated chat message insert failure/
        );

        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.broadcasts.length, 0);
    });

    it('sends Telegram delivery requests through injectable provider calls', async () => {
        const requests = [];
        const event = {
            id: 2,
            event_type: GUARDIAN_TELEGRAM_ALERT_REQUESTED,
            idempotency_key: 'guardian.mute.telegram:77',
            payload: { deliveryKey: 'guardian.mute.telegram:77', content: '<b>alert</b>' }
        };

        const handled = await processGuardianDeliveryEvent(event, {
            telegramBotToken: 'test-token',
            bossTelegramId: '12345',
            fetchImpl: async (url, options) => {
                requests.push({ url, body: JSON.parse(options.body) });
                return { ok: true, status: 200, text: async () => '' };
            }
        });

        assert.equal(handled, true);
        assert.equal(requests.length, 1);
        assert.match(requests[0].url, /test-token\/sendMessage$/);
        assert.equal(requests[0].body.chat_id, '12345');
        assert.equal(requests[0].body.text, '<b>alert</b>');
    });

    it('keeps delivery keys within event_queue idempotency width', () => {
        const key = buildGuardianDeliveryIdempotencyKey('action.dm', 'x'.repeat(400));
        assert.ok(key.length <= 100);
        assert.match(key, /^guardian\.action\.dm:/);
    });
});
