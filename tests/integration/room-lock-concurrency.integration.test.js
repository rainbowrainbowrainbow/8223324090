/**
 * Non-destructive PostgreSQL coverage for durable room advisory locks.
 *
 * The suite only opens transactions, reads the room catalog and acquires
 * transaction-scoped advisory locks. It never inserts or updates business data.
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { lockBookingConflictResources } = require('../../services/booking');

const enabled = process.env.RUN_ROOM_LOCK_INTEGRATION === 'true';
const allowRemoteCheck = process.env.ALLOW_NONDESTRUCTIVE_ROOM_LOCK_CHECK === 'true';
const LOCK_STATE_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 10_000;
const CONTEXT = 'event_genix';
const DATE = '2099-12-30';

function connectionString() {
    assert.equal(enabled, true, 'set RUN_ROOM_LOCK_INTEGRATION=true');
    assert.equal(
        allowRemoteCheck,
        true,
        'set ALLOW_NONDESTRUCTIVE_ROOM_LOCK_CHECK=true after confirming the target'
    );
    const value = process.env.ROOM_LOCK_TEST_DATABASE_URL
        || process.env.DATABASE_PUBLIC_URL
        || process.env.TEST_DATABASE_URL
        || process.env.DATABASE_URL;
    assert.ok(value, 'a PostgreSQL connection URL is required');
    return value;
}

function createPool(value) {
    const url = new URL(value);
    const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    return new Pool({
        connectionString: value,
        ssl: local ? false : { rejectUnauthorized: false },
        max: 6,
        connectionTimeoutMillis: 10_000
    });
}

function nextTurn() {
    return new Promise(resolve => setImmediate(resolve));
}

async function withDeadline(promise, label, timeoutMs = OPERATION_TIMEOUT_MS) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
                    timeoutMs
                );
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function waitForAdvisoryWait(observer, waiterPid, holderPid, isSettled, label) {
    const deadline = Date.now() + LOCK_STATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (isSettled()) {
            throw new Error(`${label} completed before PostgreSQL reported a blocked advisory lock`);
        }
        const result = await observer.query(
            `SELECT EXISTS (
                 SELECT 1
                   FROM pg_locks waiting
                   JOIN pg_locks held
                     ON held.locktype = waiting.locktype
                    AND held.database IS NOT DISTINCT FROM waiting.database
                    AND held.classid IS NOT DISTINCT FROM waiting.classid
                    AND held.objid IS NOT DISTINCT FROM waiting.objid
                    AND held.objsubid IS NOT DISTINCT FROM waiting.objsubid
                  WHERE waiting.pid = $1
                    AND held.pid = $2
                    AND waiting.locktype = 'advisory'
                    AND waiting.granted = FALSE
                    AND held.granted = TRUE
             ) AS waiting`,
            [waiterPid, holderPid]
        );
        if (result.rows[0]?.waiting === true) return;
        await nextTurn();
    }
    throw new Error(`${label} was not visible in pg_locks within ${LOCK_STATE_TIMEOUT_MS}ms`);
}

async function rollbackQuietly(client) {
    if (!client) return;
    try {
        await client.query('ROLLBACK');
    } catch {
        // A completed transaction does not need cleanup.
    }
}

function roomBooking(resourceId, room) {
    return {
        businessContext: CONTEXT,
        date: DATE,
        room,
        roomResourceId: resourceId
    };
}

describe('durable room advisory locks on PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;

    before(() => {
        pool = createPool(connectionString());
    });

    after(async () => {
        if (pool) await pool.end();
    });

    test('same room resource waits even when the display name changed', async () => {
        const holder = await pool.connect();
        const waiter = await pool.connect();
        const observer = await pool.connect();
        let waiterSettled = false;
        let waiterPromise;
        try {
            const [{ rows: [{ pid: holderPid }] }, { rows: [{ pid: waiterPid }] }] = await Promise.all([
                holder.query('SELECT pg_backend_pid() AS pid'),
                waiter.query('SELECT pg_backend_pid() AS pid')
            ]);
            await holder.query('BEGIN');
            const holderKeys = await lockBookingConflictResources(
                holder,
                [roomBooking('room-lock-same', 'Old Room Name')],
                CONTEXT
            );
            assert.ok(holderKeys.includes(`room-resource:${CONTEXT}:${DATE}:room-lock-same`));

            await waiter.query('BEGIN');
            waiterPromise = lockBookingConflictResources(
                waiter,
                [roomBooking('room-lock-same', 'Renamed Room')],
                CONTEXT
            ).then(value => {
                waiterSettled = true;
                return value;
            });

            await waitForAdvisoryWait(
                observer,
                waiterPid,
                holderPid,
                () => waiterSettled,
                'same durable room id'
            );
            assert.equal(waiterSettled, false);

            await holder.query('COMMIT');
            const waiterKeys = await withDeadline(waiterPromise, 'renamed room lock acquisition');
            assert.ok(waiterKeys.includes(`room-resource:${CONTEXT}:${DATE}:room-lock-same`));
            await waiter.query('ROLLBACK');
        } finally {
            await rollbackQuietly(holder);
            await rollbackQuietly(waiter);
            if (waiterPromise) await Promise.allSettled([waiterPromise]);
            holder.release();
            waiter.release();
            observer.release();
        }
    });

    test('different room resource IDs acquire independent locks', async () => {
        const first = await pool.connect();
        const second = await pool.connect();
        try {
            await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
            const [firstKeys, secondKeys] = await withDeadline(
                Promise.all([
                    lockBookingConflictResources(
                        first,
                        [roomBooking('room-lock-a', 'Room A')],
                        CONTEXT
                    ),
                    lockBookingConflictResources(
                        second,
                        [roomBooking('room-lock-b', 'Room B')],
                        CONTEXT
                    )
                ]),
                'independent room lock acquisition'
            );
            assert.ok(firstKeys.includes(`room-resource:${CONTEXT}:${DATE}:room-lock-a`));
            assert.ok(secondKeys.includes(`room-resource:${CONTEXT}:${DATE}:room-lock-b`));
        } finally {
            await rollbackQuietly(first);
            await rollbackQuietly(second);
            first.release();
            second.release();
        }
    });
});
