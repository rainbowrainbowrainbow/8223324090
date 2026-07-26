/**
 * Real PostgreSQL coverage for the ZRS/payroll-period advisory-lock contract.
 *
 * This suite is intentionally excluded from the fast unit baseline. Run it through:
 *   npm run test:integration:payroll-profiles:isolated
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { acquirePayrollPeriodMutationLock } = require('../../services/hrPayrollPeriod');

const enabled = process.env.RUN_ZRS_PAYROLL_PERIOD_LOCK_INTEGRATION === 'true';
const LOCK_STATE_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 10_000;

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_ZRS_PAYROLL_PERIOD_LOCK_INTEGRATION=true');
    assert.equal(
        process.env.REQUIRE_ISOLATED_TEST_TARGET,
        'true',
        'ZRS payroll-period lock integration requires the isolated local test runner'
    );
    assert.equal(
        process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,
        'true',
        'ZRS payroll-period lock integration requires verified disposable database setup'
    );
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createPool(testDb) {
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 4,
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
                   AND waiting.granted = false
                   AND held.granted = true
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
        // The isolated runner resets the disposable schema after the suite as a final guard.
    }
}

describe('ZRS payroll-period advisory locks on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = createPool(testDb);
    });

    after(async () => {
        if (pool) await pool.end();
    });

    test('same payroll month waits until the first transaction releases the lock', async () => {
        const writerA = await pool.connect();
        const writerB = await pool.connect();
        const observer = await pool.connect();
        let writerBLockSettled = false;
        let writerBLockPromise;
        try {
            const [{ rows: [{ pid: writerAPid }] }, { rows: [{ pid: writerBPid }] }] = await Promise.all([
                writerA.query('SELECT pg_backend_pid() AS pid'),
                writerB.query('SELECT pg_backend_pid() AS pid')
            ]);

            await writerA.query('BEGIN');
            await acquirePayrollPeriodMutationLock(writerA, '2099-08');

            await writerB.query('BEGIN');
            writerBLockPromise = acquirePayrollPeriodMutationLock(writerB, '2099-08').then(value => {
                writerBLockSettled = true;
                return value;
            });

            await waitForAdvisoryWait(
                observer,
                writerBPid,
                writerAPid,
                () => writerBLockSettled,
                'same payroll month writer'
            );
            assert.equal(writerBLockSettled, false, 'second writer remains blocked before first commit');

            await writerA.query('COMMIT');
            await withDeadline(writerBLockPromise, 'same payroll month lock acquisition');
            assert.equal(writerBLockSettled, true);
        } finally {
            await rollbackQuietly(writerA);
            await rollbackQuietly(writerB);
            writerA.release();
            writerB.release();
            observer.release();
        }
    });

    test('different payroll months do not block each other', async () => {
        const writerA = await pool.connect();
        const writerB = await pool.connect();
        try {
            await writerA.query('BEGIN');
            await acquirePayrollPeriodMutationLock(writerA, '2099-08');

            await writerB.query('BEGIN');
            await withDeadline(
                acquirePayrollPeriodMutationLock(writerB, '2099-09'),
                'different payroll month lock acquisition',
                1_000
            );
        } finally {
            await rollbackQuietly(writerA);
            await rollbackQuietly(writerB);
            writerA.release();
            writerB.release();
        }
    });
});