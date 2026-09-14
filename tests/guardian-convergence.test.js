const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach } = require('node:test');

let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    ['../db', '../services/eventBus', '../services/guardianDelivery'].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function makePool() {
    const client = {
        async query(sql, params = []) {
            const text = normalizeSql(sql);
            state.queries.push({ text, params, client: true });

            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                state.transactions.push(text);
                return { rows: [], rowCount: 0 };
            }

            if (text.startsWith('SELECT id, event_type, payload, last_error, idempotency_key')) {
                assert.match(text, /FOR UPDATE SKIP LOCKED/);
                const dead = state.eventQueue.filter(row =>
                    row.status === 'terminal_failed' ||
                    (row.status === 'failed' && row.attempts >= row.max_attempts)
                );
                return { rows: dead, rowCount: dead.length };
            }

            if (text.startsWith('INSERT INTO event_dead_letter')) {
                if (state.failDeadLetterInsert) {
                    throw new Error('dead letter insert failed');
                }
                state.deadLetter.push({
                    original_event_id: params[0],
                    event_type: params[1],
                    payload: params[2],
                    error: params[3],
                    idempotency_key: params[4],
                    attempts: params[5],
                    max_attempts: params[6],
                    failure_class: params[7],
                    terminal_reason: params[8]
                });
                return { rows: [], rowCount: 1 };
            }

            if (text.startsWith('DELETE FROM event_queue WHERE id = $1')) {
                state.eventQueue = state.eventQueue.filter(row => String(row.id) !== String(params[0]));
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected convergence client query: ${text}`);
        },
        release() {
            state.transactions.push('RELEASE');
        }
    };

    return {
        async query(sql, params = []) {
            const text = normalizeSql(sql);
            state.queries.push({ text, params });

            if (text.startsWith('SELECT * FROM event_queue WHERE status =')) {
                const rows = state.eventQueue.filter(row =>
                    row.status === 'failed' &&
                    row.attempts < row.max_attempts
                );
                return { rows, rowCount: rows.length };
            }

            if (text.startsWith('SELECT * FROM rule_definitions')) {
                return { rows: [], rowCount: 0 };
            }

            if (text.startsWith('UPDATE event_queue SET status = \'processed\'')) {
                return { rows: [], rowCount: 1 };
            }

            if (text.startsWith('UPDATE event_queue SET status =')) {
                const row = state.eventQueue.find(event => String(event.id) === String(params[1]));
                if (row) {
                    row.status = 'pending';
                    row.convergence_status = 'retry_scheduled';
                    row.next_retry_at = 'scheduled';
                }
                return { rows: [], rowCount: row ? 1 : 0 };
            }

            throw new Error(`Unexpected convergence query: ${text}`);
        },
        connect() {
            return client;
        }
    };
}

describe('Guardian delivery convergence and dead-letter movement', () => {
    beforeEach(() => {
        state = {
            queries: [],
            eventQueue: [
                {
                    id: 1,
                    event_type: 'booking.created',
                    payload: {},
                    idempotency_key: 'booking:retry',
                    status: 'failed',
                    attempts: 1,
                    max_attempts: 3,
                    last_error: 'temporary rule failure',
                    failure_class: 'rule_processing_failed'
                },
                {
                    id: 2,
                    event_type: 'guardian.telegram_alert.requested',
                    payload: { deliveryKey: 'guardian.mute.telegram:2', content: 'alert' },
                    idempotency_key: 'guardian.mute.telegram:2',
                    status: 'failed',
                    attempts: 3,
                    max_attempts: 3,
                    last_error: 'telegram 500',
                    failure_class: 'transient_provider_failure'
                },
                {
                    id: 3,
                    event_type: 'guardian.telegram_alert.requested',
                    payload: { deliveryKey: 'guardian.mute.telegram:3', content: 'alert' },
                    idempotency_key: 'guardian.mute.telegram:3',
                    status: 'terminal_failed',
                    attempts: 1,
                    max_attempts: 3,
                    last_error: 'missing Telegram configuration',
                    failure_class: 'configuration_missing'
                }
            ],
            deadLetter: [],
            transactions: [],
            failDeadLetterInsert: false
        };

        clearModules();
        installMock('../db', { pool: makePool() });
    });

    afterEach(() => {
        clearModules();
    });

    it('schedules retryable rows and moves terminal or exhausted rows to dead letter with classifications', async () => {
        const { processFailedEvents } = require('../services/eventBus');

        await processFailedEvents();

        assert.equal(state.eventQueue.some(row => row.id === 1 && row.status === 'pending'), true);
        assert.equal(state.deadLetter.length, 2);
        assert.deepEqual(
            state.deadLetter.map(row => [row.original_event_id, row.failure_class, row.terminal_reason]),
            [
                [2, 'transient_provider_failure', 'telegram 500'],
                [3, 'configuration_missing', 'missing Telegram configuration']
            ]
        );
        assert.equal(state.deadLetter[0].idempotency_key, 'guardian.mute.telegram:2');
        assert.deepEqual(state.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
        assert.equal(state.eventQueue.some(row => row.id === 2 || row.id === 3), false);
    });

    it('keeps source event_queue rows when dead-letter insertion fails', async () => {
        state.eventQueue = state.eventQueue.filter(row => row.id !== 1);
        state.failDeadLetterInsert = true;
        const { processFailedEvents } = require('../services/eventBus');

        await processFailedEvents();

        assert.equal(state.deadLetter.length, 0);
        assert.deepEqual(state.eventQueue.map(row => row.id), [2, 3]);
        assert.deepEqual(state.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
    });
});
