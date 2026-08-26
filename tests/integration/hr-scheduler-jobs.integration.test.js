'use strict';

const { after, before, beforeEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    checkHrAutoClose,
    checkHrNoShow,
    __resetHrSchedulerStateForTests
} = require('../../services/hr');
const { recordAttendanceClockOut, recordAttendanceStatus } = require('../../services/hrAttendance');
const { lockAttendanceWriteTarget } = require('../../services/attendanceWriteLock');

const enabled = process.env.RUN_HR_SCHEDULER_JOBS_INTEGRATION === 'true';
const LOCK_STATE_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 10_000;

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_HR_SCHEDULER_JOBS_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
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
        max: 8,
        connectionTimeoutMillis: 10_000
    });
}

function schedulerOptions(pool, date, time, overrides = {}) {
    return {
        db: pool,
        getKyivDateStr: () => date,
        getKyivTimeStr: () => time,
        getKyivDate: () => ({
            getHours: () => Number(time.slice(0, 2)),
            getMinutes: () => Number(time.slice(3, 5))
        }),
        getConfiguredChatId: async () => null,
        sendTelegramMessage: async () => ({ ok: true }),
        ...overrides
    };
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
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`${label} was not visible in pg_locks within ${LOCK_STATE_TIMEOUT_MS}ms`);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function createStaff(pool, label, roleType = 'wardrobe') {
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const result = await pool.query(
        `INSERT INTO staff (name, department, position, role_type, is_active)
         VALUES ($1, 'admin', $2, $3, true)
         RETURNING id`,
        [`Fictional Scheduler ${label} ${suffix}`, `Disposable ${label}`, roleType]
    );
    return Number(result.rows[0].id);
}

async function createShift(pool, staffId, date, start = '09:00', end = '18:00', profession = 'wardrobe') {
    const shiftResult = await pool.query(
        `INSERT INTO hr_shifts (
            staff_id, shift_date, planned_start, planned_end,
            break_minutes, shift_type, profession_key, created_by
         )
         VALUES ($1, $2::date, $3::time, $4::time, 0, 'regular', $5, 'isolated_scheduler_test')
         RETURNING id`,
        [staffId, date, start, end, profession]
    );
    const shiftId = Number(shiftResult.rows[0].id);
    await pool.query(
        `INSERT INTO hr_shift_segments (
            hr_shift_id, profession_key, planned_start, planned_end,
            break_minutes, sort_order, created_by, updated_by
         )
         VALUES ($1, $2, $3::time, $4::time, 0, 0, 'isolated_scheduler_test', 'isolated_scheduler_test')`,
        [shiftId, profession, start, end]
    );
    return shiftId;
}

async function settingValue(pool, key) {
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', [`last_hr_${key}`]);
    return result.rows[0]?.value || null;
}

async function countAudit(pool, action, staffId) {
    const result = await pool.query(
        `SELECT COUNT(*)::integer AS count
           FROM hr_audit_log
          WHERE action = $1
            AND staff_id = $2`,
        [action, staffId]
    );
    return Number(result.rows[0].count || 0);
}

describe('HR scheduler jobs on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;

    before(async () => {
        pool = createPool(requireIsolatedDatabase());
    });

    beforeEach(() => {
        __resetHrSchedulerStateForTests();
    });

    after(async () => {
        await pool?.end();
    });

    test('checkHrAutoClose records an empty successful daily tick without touching attendance rows', async () => {
        const date = '2099-08-21';
        const result = await checkHrAutoClose(schedulerOptions(pool, date, '23:55'));
        assert.equal(result.processed, 0);
        assert.equal(result.closed, 0);
        assert.equal(result.errors, 0);
        assert.equal(result.markerSaved, true);
        assert.equal(await settingValue(pool, 'auto_close'), date);
    });

    test('checkHrAutoClose closes eligible records once through the canonical attendance writer', async () => {
        const date = '2099-08-22';
        const staffId = await createStaff(pool, 'auto-close-success');
        await createShift(pool, staffId, date, '09:00', '18:00');
        await pool.query(
            `INSERT INTO hr_time_records (
                business_context, staff_id, record_date, clock_in, planned_start, planned_end, status
             )
             VALUES ('event_genix', $1, $2::date, $3::timestamptz, '09:00', '18:00', 'present')`,
            [staffId, date, `${date}T06:00:00.000Z`]
        );

        const first = await checkHrAutoClose(schedulerOptions(pool, date, '23:55'));
        const second = await checkHrAutoClose(schedulerOptions(pool, date, '23:55'));
        const stored = await pool.query(
            `SELECT status, auto_closed, clock_out IS NOT NULL AS has_clock_out,
                    jsonb_typeof(compensation_snapshot) AS snapshot_type
               FROM hr_time_records
              WHERE staff_id = $1 AND record_date = $2::date`,
            [staffId, date]
        );

        assert.equal(first.closed, 1);
        assert.equal(first.errors, 0);
        assert.deepEqual(second, { skipped: true, reason: 'memory_dedup', date });
        assert.equal(stored.rows[0].status, 'auto_closed');
        assert.equal(stored.rows[0].auto_closed, true);
        assert.equal(stored.rows[0].has_clock_out, true);
        assert.equal(stored.rows[0].snapshot_type, 'object');
        assert.equal(await countAudit(pool, 'auto_close', staffId), 1);
        assert.equal(await countAudit(pool, 'compensation_snapshot_created', staffId), 1);
    });

    test('checkHrAutoClose exposes row-lock blocking and overlap skip behavior', async () => {
        const date = '2099-08-23';
        const staffId = await createStaff(pool, 'auto-close-lock');
        await createShift(pool, staffId, date);
        await pool.query(
            `INSERT INTO hr_time_records (
                business_context, staff_id, record_date, clock_in, planned_start, planned_end, status
             )
             VALUES ('event_genix', $1, $2::date, $3::timestamptz, '09:00', '18:00', 'present')`,
            [staffId, date, `${date}T06:00:00.000Z`]
        );

        const enteredWriter = deferred();
        const releaseWriter = deferred();
        let holderPid = null;
        const firstRun = checkHrAutoClose(schedulerOptions(pool, date, '23:55', {
            recordAttendanceClockOut: async (client, input) => {
                const pidResult = await client.query('SELECT pg_backend_pid() AS pid');
                holderPid = Number(pidResult.rows[0].pid);
                enteredWriter.resolve();
                await releaseWriter.promise;
                return recordAttendanceClockOut(client, input);
            }
        }));
        await enteredWriter.promise;
        const overlap = await checkHrAutoClose(schedulerOptions(pool, date, '23:55'));
        assert.deepEqual(overlap, { skipped: true, reason: 'already_running' });

        const waiter = await pool.connect();
        const observer = await pool.connect();
        let waiterSettled = false;
        let waiterLockPromise;
        try {
            const waiterPidResult = await waiter.query('SELECT pg_backend_pid() AS pid');
            const waiterPid = Number(waiterPidResult.rows[0].pid);
            await waiter.query('BEGIN');
            waiterLockPromise = lockAttendanceWriteTarget(waiter, { staffId, date }).then(value => {
                waiterSettled = true;
                return value;
            });
            await waitForAdvisoryWait(observer, waiterPid, holderPid, () => waiterSettled, 'HR auto-close row lock');
            assert.equal(waiterSettled, false);
            releaseWriter.resolve();
            await withDeadline(firstRun, 'auto-close first run');
            await withDeadline(waiterLockPromise, 'auto-close waiter lock acquisition');
            await waiter.query('ROLLBACK');
        } finally {
            releaseWriter.resolve();
            await waiter.query('ROLLBACK').catch(() => {});
            await Promise.allSettled([waiterLockPromise]);
            waiter.release();
            observer.release();
        }
    });

    test('checkHrAutoClose does not mark the daily tick successful after service failure', async () => {
        const date = '2099-08-24';
        const staffId = await createStaff(pool, 'auto-close-failure');
        await createShift(pool, staffId, date);
        await pool.query(
            `INSERT INTO hr_time_records (
                business_context, staff_id, record_date, clock_in, planned_start, planned_end, status
             )
             VALUES ('event_genix', $1, $2::date, $3::timestamptz, '09:00', '18:00', 'present')`,
            [staffId, date, `${date}T06:00:00.000Z`]
        );

        let thrown;
        await assert.rejects(async () => {
            await checkHrAutoClose(schedulerOptions(pool, date, '23:55', {
                recordAttendanceClockOut: async () => {
                    throw new Error('planned auto-close writer failure');
                }
            }));
        }, err => {
            thrown = err;
            return /checkHrAutoClose failed for 1 record/.test(err.message);
        });
        const stored = await pool.query(
            `SELECT clock_out, auto_closed
               FROM hr_time_records
              WHERE staff_id = $1 AND record_date = $2::date`,
            [staffId, date]
        );

        assert.equal(thrown.result.errors, 1);
        assert.equal(thrown.result.markerSaved, false);
        assert.notEqual(await settingValue(pool, 'auto_close'), date);
        assert.equal(stored.rows[0].clock_out, null);
        assert.equal(stored.rows[0].auto_closed, false);
        assert.equal(await countAudit(pool, 'auto_close', staffId), 0);
    });

    test('checkHrNoShow records an empty successful daily tick without creating terminal rows', async () => {
        const date = '2099-08-25';
        const result = await checkHrNoShow(schedulerOptions(pool, date, '13:00'));
        assert.equal(result.processed, 0);
        assert.equal(result.marked, 0);
        assert.equal(result.errors, 0);
        assert.equal(result.markerSaved, true);
        assert.equal(await settingValue(pool, 'no_show'), date);
    });

    test('checkHrNoShow creates one terminal snapshot and skips duplicate ticks', async () => {
        const date = '2099-08-26';
        const staffId = await createStaff(pool, 'no-show-success');
        await createShift(pool, staffId, date, '09:30', '18:00');

        const first = await checkHrNoShow(schedulerOptions(pool, date, '13:00'));
        const second = await checkHrNoShow(schedulerOptions(pool, date, '13:00'));
        const stored = await pool.query(
            `SELECT status, clock_in, total_worked_minutes, jsonb_typeof(compensation_snapshot) AS snapshot_type
               FROM hr_time_records
              WHERE staff_id = $1 AND record_date = $2::date`,
            [staffId, date]
        );

        assert.equal(first.marked, 1);
        assert.equal(first.errors, 0);
        assert.deepEqual(second, { skipped: true, reason: 'memory_dedup', date });
        assert.equal(stored.rows.length, 1);
        assert.equal(stored.rows[0].status, 'no_show');
        assert.equal(stored.rows[0].clock_in, null);
        assert.equal(stored.rows[0].total_worked_minutes, 0);
        assert.equal(stored.rows[0].snapshot_type, 'object');
        assert.equal(await countAudit(pool, 'no_show', staffId), 1);
        assert.equal(await countAudit(pool, 'compensation_snapshot_created', staffId), 1);
    });

    test('checkHrNoShow exposes row-lock blocking and overlap skip behavior', async () => {
        const date = '2099-08-27';
        const staffId = await createStaff(pool, 'no-show-lock');
        await createShift(pool, staffId, date, '09:30', '18:00');

        const enteredWriter = deferred();
        const releaseWriter = deferred();
        let holderPid = null;
        const firstRun = checkHrNoShow(schedulerOptions(pool, date, '13:00', {
            recordAttendanceStatus: async (client, input) => {
                const pidResult = await client.query('SELECT pg_backend_pid() AS pid');
                holderPid = Number(pidResult.rows[0].pid);
                enteredWriter.resolve();
                await releaseWriter.promise;
                return recordAttendanceStatus(client, input);
            }
        }));
        await enteredWriter.promise;
        const overlap = await checkHrNoShow(schedulerOptions(pool, date, '13:00'));
        assert.deepEqual(overlap, { skipped: true, reason: 'already_running' });

        const waiter = await pool.connect();
        const observer = await pool.connect();
        let waiterSettled = false;
        let waiterLockPromise;
        try {
            const waiterPidResult = await waiter.query('SELECT pg_backend_pid() AS pid');
            const waiterPid = Number(waiterPidResult.rows[0].pid);
            await waiter.query('BEGIN');
            waiterLockPromise = lockAttendanceWriteTarget(waiter, { staffId, date }).then(value => {
                waiterSettled = true;
                return value;
            });
            await waitForAdvisoryWait(observer, waiterPid, holderPid, () => waiterSettled, 'HR no-show row lock');
            assert.equal(waiterSettled, false);
            releaseWriter.resolve();
            await withDeadline(firstRun, 'no-show first run');
            await withDeadline(waiterLockPromise, 'no-show waiter lock acquisition');
            await waiter.query('ROLLBACK');
        } finally {
            releaseWriter.resolve();
            await waiter.query('ROLLBACK').catch(() => {});
            await Promise.allSettled([waiterLockPromise]);
            waiter.release();
            observer.release();
        }
    });

    test('checkHrNoShow does not mark the daily tick successful after service failure', async () => {
        const date = '2099-08-28';
        const staffId = await createStaff(pool, 'no-show-failure');
        await createShift(pool, staffId, date, '09:30', '18:00');

        let thrown;
        await assert.rejects(async () => {
            await checkHrNoShow(schedulerOptions(pool, date, '13:00', {
                recordAttendanceStatus: async () => {
                    throw new Error('planned no-show writer failure');
                }
            }));
        }, err => {
            thrown = err;
            return /checkHrNoShow failed for 1 record/.test(err.message);
        });
        const stored = await pool.query(
            `SELECT COUNT(*)::integer AS count
               FROM hr_time_records
              WHERE staff_id = $1 AND record_date = $2::date`,
            [staffId, date]
        );

        assert.equal(thrown.result.errors, 1);
        assert.equal(thrown.result.markerSaved, false);
        assert.notEqual(await settingValue(pool, 'no_show'), date);
        assert.equal(stored.rows[0].count, 0);
        assert.equal(await countAudit(pool, 'no_show', staffId), 0);
    });
});
