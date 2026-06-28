const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let state;
const realSetImmediate = global.setImmediate;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/eventBus',
        '../utils/logger'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function createGate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

function makeOutboxRow(overrides = {}) {
    return {
        id: overrides.id ?? 1,
        event_type: overrides.event_type || 'booking.created',
        payload: overrides.payload || { booking_id: 'BK-2026-0001' },
        idempotency_key: overrides.idempotency_key || `booking:${overrides.id ?? 1}`,
        aggregate_type: overrides.aggregate_type || 'booking',
        aggregate_id: overrides.aggregate_id || `BK-2026-${String(overrides.id ?? 1).padStart(4, '0')}`,
        occurred_at: overrides.occurred_at || `2026-06-28T12:0${overrides.id ?? 1}:00.000Z`,
        published_at: overrides.published_at ?? null,
        publish_attempts: overrides.publish_attempts ?? 0,
        last_error: overrides.last_error ?? null
    };
}

function resetState() {
    const firstInsertGate = createGate();
    state = {
        outbox: [],
        eventQueue: [],
        lockedBy: new Map(),
        clientSeq: 0,
        nextEventId: 1000,
        operations: [],
        clientQueries: [],
        successUpdates: [],
        failureUpdates: [],
        immediateCallbacks: [],
        loggerErrors: [],
        loggerInfo: [],
        failInsertKeys: new Set(),
        failCommit: false,
        blockFirstInsert: false,
        firstInsertBlocked: false,
        firstInsertStarted: null,
        resolveFirstInsertStarted: null,
        firstInsertGate
    };
    state.firstInsertStarted = new Promise(resolve => {
        state.resolveFirstInsertStarted = resolve;
    });
}

function installSetImmediateCapture() {
    global.setImmediate = fn => {
        state.operations.push({ type: 'setImmediate' });
        state.immediateCallbacks.push(fn);
        return state.immediateCallbacks.length;
    };
}

function releaseLocks(clientId) {
    for (const [rowId, lockedBy] of [...state.lockedBy.entries()]) {
        if (lockedBy === clientId) {
            state.lockedBy.delete(rowId);
        }
    }
}

function createFakeClient(clientId) {
    return {
        async query(sql, params = []) {
            const text = compact(sql);
            state.clientQueries.push({ clientId, text, params });

            if (text === 'BEGIN') {
                state.operations.push({ type: 'BEGIN', clientId });
                return { rows: [], rowCount: 0 };
            }

            if (text === 'COMMIT') {
                state.operations.push({ type: 'COMMIT', clientId });
                if (state.failCommit) {
                    throw new Error('commit failed');
                }
                releaseLocks(clientId);
                return { rows: [], rowCount: 0 };
            }

            if (text === 'ROLLBACK') {
                state.operations.push({ type: 'ROLLBACK', clientId });
                releaseLocks(clientId);
                return { rows: [], rowCount: 0 };
            }

            if (/^SELECT id, event_type, payload, idempotency_key, aggregate_type, aggregate_id FROM outbox_events/i.test(text)) {
                assert.match(text, /published_at IS NULL/i);
                assert.match(text, /publish_attempts < 5/i);
                assert.match(text, /FOR UPDATE SKIP LOCKED/i);

                const rows = state.outbox
                    .filter(row => row.published_at == null)
                    .filter(row => Number(row.publish_attempts || 0) < 5)
                    .filter(row => !state.lockedBy.has(row.id))
                    .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
                    .slice(0, 20);

                for (const row of rows) {
                    state.lockedBy.set(row.id, clientId);
                }

                state.operations.push({ type: 'selectOutbox', clientId, rowIds: rows.map(row => row.id) });
                return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
            }

            if (/^INSERT INTO event_queue \(event_type, payload, idempotency_key\)/i.test(text)) {
                if (state.blockFirstInsert && !state.firstInsertBlocked) {
                    state.firstInsertBlocked = true;
                    state.resolveFirstInsertStarted();
                    await state.firstInsertGate.promise;
                }

                const [eventType, payload, idempotencyKey] = params;
                state.operations.push({ type: 'insertEventQueue', clientId, idempotencyKey });

                if (state.failInsertKeys.has(idempotencyKey)) {
                    throw new Error(`dispatch failed for ${idempotencyKey}`);
                }

                const existing = state.eventQueue.find(event => event.idempotency_key === idempotencyKey);
                if (existing) {
                    return { rows: [], rowCount: 0 };
                }

                const event = {
                    id: ++state.nextEventId,
                    event_type: eventType,
                    payload,
                    idempotency_key: idempotencyKey
                };
                state.eventQueue.push(event);
                return { rows: [{ id: event.id }], rowCount: 1 };
            }

            if (/^UPDATE outbox_events SET published_at = NOW\(\) WHERE id = \$1/i.test(text)) {
                const row = state.outbox.find(item => String(item.id) === String(params[0]));
                if (row) {
                    row.published_at = 'published';
                    state.successUpdates.push({ clientId, id: row.id });
                    return { rows: [], rowCount: 1 };
                }
                return { rows: [], rowCount: 0 };
            }

            if (/^UPDATE outbox_events SET publish_attempts = publish_attempts \+ 1, last_error = \$1 WHERE id = \$2/i.test(text)) {
                const row = state.outbox.find(item => String(item.id) === String(params[1]));
                if (row) {
                    row.publish_attempts = Number(row.publish_attempts || 0) + 1;
                    row.last_error = params[0];
                    state.failureUpdates.push({ clientId, id: row.id, error: params[0] });
                    return { rows: [], rowCount: 1 };
                }
                return { rows: [], rowCount: 0 };
            }

            throw new Error(`Unexpected fake outbox query: ${text}`);
        },

        release() {
            state.operations.push({ type: 'release', clientId });
            releaseLocks(clientId);
        }
    };
}

function createFakePool() {
    return {
        async query() {
            throw new Error('processOutbox tests must use pool.connect, not pool.query');
        },
        connect() {
            return createFakeClient(++state.clientSeq);
        }
    };
}

function loadEventBus() {
    clearModules();
    installMock('../db', { pool: createFakePool() });
    installMock('../utils/logger', {
        createLogger: () => ({
            debug: () => {},
            info: (...args) => state.loggerInfo.push(args),
            warn: () => {},
            error: (...args) => state.loggerErrors.push(args)
        })
    });
    return require('../services/eventBus');
}

describe('event bus outbox relay hardening', () => {
    beforeEach(() => {
        resetState();
        installSetImmediateCapture();
    });

    afterEach(() => {
        global.setImmediate = realSetImmediate;
        clearModules();
    });

    it('exits cleanly when there are no pending outbox rows', async () => {
        const { processOutbox } = loadEventBus();

        const published = await processOutbox();

        assert.equal(published, 0);
        assert.equal(state.eventQueue.length, 0);
        assert.equal(state.successUpdates.length, 0);
        assert.equal(state.failureUpdates.length, 0);
        assert.equal(state.immediateCallbacks.length, 0);
        assert.deepEqual(state.operations.map(op => op.type), ['BEGIN', 'selectOutbox', 'COMMIT', 'release']);
    });

    it('publishes one pending outbox row and schedules rule processing only after commit', async () => {
        state.outbox.push(makeOutboxRow({ id: 1, idempotency_key: 'booking:1' }));
        const { processOutbox } = loadEventBus();

        const published = await processOutbox();

        assert.equal(published, 1);
        assert.equal(state.eventQueue.length, 1);
        assert.equal(state.eventQueue[0].event_type, 'booking.created');
        assert.deepEqual(state.eventQueue[0].payload, { booking_id: 'BK-2026-0001' });
        assert.equal(state.successUpdates.length, 1);
        assert.equal(state.successUpdates[0].id, 1);
        assert.equal(state.outbox[0].published_at, 'published');
        assert.equal(state.failureUpdates.length, 0);
        assert.equal(state.immediateCallbacks.length, 1);

        const commitIndex = state.operations.findIndex(op => op.type === 'COMMIT');
        const immediateIndex = state.operations.findIndex(op => op.type === 'setImmediate');
        assert.ok(commitIndex >= 0);
        assert.ok(immediateIndex > commitIndex);
    });

    it('records retry metadata when event queue insert fails and continues the transaction', async () => {
        state.outbox.push(makeOutboxRow({ id: 1, idempotency_key: 'booking:fail' }));
        state.failInsertKeys.add('booking:fail');
        const { processOutbox } = loadEventBus();

        const published = await processOutbox();

        assert.equal(published, 0);
        assert.equal(state.eventQueue.length, 0);
        assert.equal(state.successUpdates.length, 0);
        assert.equal(state.failureUpdates.length, 1);
        assert.equal(state.failureUpdates[0].id, 1);
        assert.match(state.failureUpdates[0].error, /dispatch failed/);
        assert.equal(state.outbox[0].publish_attempts, 1);
        assert.equal(state.immediateCallbacks.length, 0);
        assert.ok(state.operations.some(op => op.type === 'COMMIT'));
    });

    it('handles multiple rows and does not let one failed row block later rows', async () => {
        state.outbox.push(
            makeOutboxRow({ id: 1, idempotency_key: 'booking:fail', occurred_at: '2026-06-28T12:01:00.000Z' }),
            makeOutboxRow({ id: 2, idempotency_key: 'booking:ok', occurred_at: '2026-06-28T12:02:00.000Z' })
        );
        state.failInsertKeys.add('booking:fail');
        const { processOutbox } = loadEventBus();

        const published = await processOutbox();

        assert.equal(published, 1);
        assert.equal(state.eventQueue.length, 1);
        assert.equal(state.eventQueue[0].idempotency_key, 'booking:ok');
        assert.deepEqual(state.successUpdates.map(update => update.id), [2]);
        assert.deepEqual(state.failureUpdates.map(update => update.id), [1]);
        assert.equal(state.immediateCallbacks.length, 1);
    });

    it('prevents duplicate dispatch while another relay transaction holds the row lock', async () => {
        state.outbox.push(makeOutboxRow({ id: 1, idempotency_key: 'booking:locked' }));
        state.blockFirstInsert = true;
        const { processOutbox } = loadEventBus();

        const first = processOutbox();
        await state.firstInsertStarted;

        const secondPublished = await processOutbox();

        assert.equal(secondPublished, 0);
        assert.equal(state.eventQueue.length, 0);
        assert.deepEqual(
            state.operations
                .filter(op => op.type === 'selectOutbox')
                .map(op => op.rowIds),
            [[1], []]
        );

        state.firstInsertGate.release();
        const firstPublished = await first;

        assert.equal(firstPublished, 1);
        assert.equal(state.eventQueue.length, 1);
        assert.equal(state.eventQueue[0].idempotency_key, 'booking:locked');
        assert.equal(state.successUpdates.length, 1);
        assert.equal(state.immediateCallbacks.length, 1);
    });

    it('does not dispatch already locked or already published outbox rows', async () => {
        state.outbox.push(
            makeOutboxRow({ id: 1, idempotency_key: 'booking:locked' }),
            makeOutboxRow({ id: 2, idempotency_key: 'booking:published', published_at: '2026-06-28T12:00:00.000Z' })
        );
        state.lockedBy.set(1, 99);
        const { processOutbox } = loadEventBus();

        const published = await processOutbox();

        assert.equal(published, 0);
        assert.equal(state.eventQueue.length, 0);
        assert.equal(state.successUpdates.length, 0);
        assert.equal(state.failureUpdates.length, 0);
        assert.equal(state.immediateCallbacks.length, 0);
    });

    it('skips rows that reached the publish retry limit', async () => {
        state.outbox.push(makeOutboxRow({ id: 1, idempotency_key: 'booking:blocked', publish_attempts: 5 }));
        const { processOutbox } = loadEventBus();

        const published = await processOutbox();

        assert.equal(published, 0);
        assert.equal(state.eventQueue.length, 0);
        assert.equal(state.successUpdates.length, 0);
        assert.equal(state.failureUpdates.length, 0);
        assert.equal(state.immediateCallbacks.length, 0);
    });

    it('marks duplicate event_queue keys as published without re-running rule side effects', async () => {
        state.outbox.push(makeOutboxRow({ id: 1, idempotency_key: 'booking:duplicate' }));
        state.eventQueue.push({
            id: 77,
            event_type: 'booking.created',
            payload: { booking_id: 'existing' },
            idempotency_key: 'booking:duplicate'
        });
        const { processOutbox } = loadEventBus();

        const published = await processOutbox();

        assert.equal(published, 1);
        assert.equal(state.eventQueue.length, 1);
        assert.equal(state.successUpdates.length, 1);
        assert.equal(state.outbox[0].published_at, 'published');
        assert.equal(state.immediateCallbacks.length, 0);
    });

    it('does not schedule rule processing when the relay transaction cannot commit', async () => {
        state.outbox.push(makeOutboxRow({ id: 1, idempotency_key: 'booking:commit-fail' }));
        state.failCommit = true;
        const { processOutbox } = loadEventBus();

        const published = await processOutbox();

        assert.equal(published, 0);
        assert.equal(state.immediateCallbacks.length, 0);
        assert.ok(state.operations.some(op => op.type === 'ROLLBACK'));
        assert.ok(state.loggerErrors.some(args => String(args[0]).includes('processOutbox error')));
    });
});
