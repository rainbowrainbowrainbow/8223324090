/**
 * Real PostgreSQL coverage for the attendance advisory-lock contract.
 *
 * This suite is intentionally excluded from the fast unit baseline. Run it only through:
 *   npm run test:integration:attendance-lock:isolated
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    lockAttendanceWriteMaintenance,
    lockAttendanceWriteTarget
} = require('../../services/attendanceWriteLock');

const enabled = process.env.RUN_ATTENDANCE_LOCK_INTEGRATION === 'true';
const LOCK_STATE_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 10_000;
const FIXTURE_DATE = '2099-07-15';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_ATTENDANCE_LOCK_INTEGRATION=true');
    assert.equal(
        process.env.REQUIRE_ISOLATED_TEST_TARGET,
        'true',
        'attendance lock integration requires the isolated local test runner'
    );
    assert.equal(
        process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,
        'true',
        'attendance lock integration requires verified disposable database setup'
    );
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');

    // The isolated runner may expose the same disposable URL as DATABASE_URL to the app.
    // This direct test connection is still always sourced from TEST_DATABASE_URL.
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

async function countGrantedAdvisoryLocks(observer, pid) {
    const result = await observer.query(
        `SELECT COUNT(*)::integer AS count
         FROM pg_locks
         WHERE pid = $1
           AND locktype = 'advisory'
           AND granted = true`,
        [pid]
    );
    return Number(result.rows[0]?.count || 0);
}

async function rollbackQuietly(client) {
    if (!client) return;
    try {
        await client.query('ROLLBACK');
    } catch {
        // The isolated runner resets the disposable schema after the suite as a final guard.
    }
}

describe('attendance advisory locks on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;
    let primaryStaffId;
    let secondaryStaffId;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = createPool(testDb);
        const suffix = `${process.pid}-${Date.now()}`;
        const fixtures = await pool.query(
            `INSERT INTO staff (name, department, position, is_active)
             VALUES
                 ($1, 'admin', 'Disposable attendance lock fixture', true),
                 ($2, 'admin', 'Disposable attendance lock fixture', true)
             RETURNING id`,
            [
                `Fictional Lock Primary ${suffix}`,
                `Fictional Lock Secondary ${suffix}`
            ]
        );
        assert.equal(fixtures.rowCount, 2);
        const fixtureIds = fixtures.rows.map(row => Number(row.id)).sort((left, right) => left - right);
        primaryStaffId = fixtureIds[0];
        secondaryStaffId = fixtureIds[1];
    });

    after(async () => {
        if (!pool) return;
        try {
            if (primaryStaffId || secondaryStaffId) {
                await pool.query(
                    'DELETE FROM staff WHERE id = ANY($1::integer[])',
                    [[primaryStaffId, secondaryStaffId].filter(Boolean)]
                );
            }
        } finally {
            await pool.end();
        }
    });

    test('same staff/date waits, then re-reads committed attendance without overwriting it', async () => {
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
            await lockAttendanceWriteTarget(writerA, {
                staffId: primaryStaffId,
                date: FIXTURE_DATE
            });
            await writerA.query(
                `INSERT INTO hr_time_records (
                     business_context,
                     staff_id,
                     record_date,
                     clock_in,
                     status
                 ) VALUES ('event_genix', $1, $2, $3, 'present')`,
                [primaryStaffId, FIXTURE_DATE, `${FIXTURE_DATE}T09:00:00+03:00`]
            );

            await writerB.query('BEGIN');
            writerBLockPromise = lockAttendanceWriteTarget(writerB, {
                staffId: primaryStaffId,
                date: FIXTURE_DATE
            }).then(value => {
                writerBLockSettled = true;
                return value;
            });

            await waitForAdvisoryWait(
                observer,
                writerBPid,
                writerAPid,
                () => writerBLockSettled,
                'same staff/date writer'
            );
            assert.equal(writerBLockSettled, false, 'second writer remains blocked before the first commit');

            await writerA.query('COMMIT');
            await withDeadline(writerBLockPromise, 'same staff/date lock acquisition');

            const current = await writerB.query(
                `SELECT id, clock_in
                 FROM hr_time_records
                 WHERE staff_id = $1 AND record_date = $2
                 FOR UPDATE`,
                [primaryStaffId, FIXTURE_DATE]
            );
            let secondWriterInserted = false;
            if (current.rowCount === 0) {
                secondWriterInserted = true;
                await writerB.query(
                    `INSERT INTO hr_time_records (
                         business_context,
                         staff_id,
                         record_date,
                         clock_in,
                         status
                     ) VALUES ('event_genix', $1, $2, $3, 'present')`,
                    [primaryStaffId, FIXTURE_DATE, `${FIXTURE_DATE}T10:00:00+03:00`]
                );
            }
            await writerB.query('COMMIT');

            assert.equal(secondWriterInserted, false, 'authoritative re-read suppresses the stale second insert');
            const stored = await observer.query(
                `SELECT COUNT(*)::integer AS count, MIN(clock_in) AS clock_in
                 FROM hr_time_records
                 WHERE staff_id = $1 AND record_date = $2`,
                [primaryStaffId, FIXTURE_DATE]
            );
            assert.equal(stored.rows[0].count, 1);
            assert.equal(
                new Date(stored.rows[0].clock_in).toISOString(),
                new Date(`${FIXTURE_DATE}T09:00:00+03:00`).toISOString()
            );
        } finally {
            await rollbackQuietly(writerA);
            await rollbackQuietly(writerB);
            if (writerBLockPromise) await Promise.allSettled([writerBLockPromise]);
            writerA.release();
            writerB.release();
            observer.release();
        }
    });

    test('different staff or date targets acquire independent day locks', async () => {
        const blocker = await pool.connect();
        const differentStaff = await pool.connect();
        const differentDate = await pool.connect();
        const observer = await pool.connect();
        try {
            await blocker.query('BEGIN');
            await lockAttendanceWriteTarget(blocker, {
                staffId: primaryStaffId,
                date: '2099-07-16'
            });

            await Promise.all([differentStaff.query('BEGIN'), differentDate.query('BEGIN')]);
            const [{ rows: [{ pid: staffPid }] }, { rows: [{ pid: datePid }] }] = await Promise.all([
                differentStaff.query('SELECT pg_backend_pid() AS pid'),
                differentDate.query('SELECT pg_backend_pid() AS pid')
            ]);
            await withDeadline(
                Promise.all([
                    lockAttendanceWriteTarget(differentStaff, {
                        staffId: secondaryStaffId,
                        date: '2099-07-16'
                    }),
                    lockAttendanceWriteTarget(differentDate, {
                        staffId: primaryStaffId,
                        date: '2099-07-17'
                    })
                ]),
                'independent attendance lock acquisition'
            );

            assert.equal(await countGrantedAdvisoryLocks(observer, staffPid), 2);
            assert.equal(await countGrantedAdvisoryLocks(observer, datePid), 2);
        } finally {
            await rollbackQuietly(blocker);
            await rollbackQuietly(differentStaff);
            await rollbackQuietly(differentDate);
            blocker.release();
            differentStaff.release();
            differentDate.release();
            observer.release();
        }
    });

    test('exclusive maintenance waits for a writer and prevents later writers from passing it', async () => {
        const activeWriter = await pool.connect();
        const maintenance = await pool.connect();
        const laterWriter = await pool.connect();
        const observer = await pool.connect();
        let maintenanceSettled = false;
        let laterWriterSettled = false;
        let maintenancePromise;
        let laterWriterPromise;
        const acquisitionOrder = [];
        try {
            const [
                { rows: [{ pid: activeWriterPid }] },
                { rows: [{ pid: maintenancePid }] },
                { rows: [{ pid: laterWriterPid }] }
            ] = await Promise.all([
                activeWriter.query('SELECT pg_backend_pid() AS pid'),
                maintenance.query('SELECT pg_backend_pid() AS pid'),
                laterWriter.query('SELECT pg_backend_pid() AS pid')
            ]);

            await activeWriter.query('BEGIN');
            await lockAttendanceWriteTarget(activeWriter, {
                staffId: primaryStaffId,
                date: '2099-07-18'
            });

            await maintenance.query('BEGIN');
            maintenancePromise = lockAttendanceWriteMaintenance(maintenance).then(value => {
                maintenanceSettled = true;
                acquisitionOrder.push('maintenance');
                return value;
            });
            await waitForAdvisoryWait(
                observer,
                maintenancePid,
                activeWriterPid,
                () => maintenanceSettled,
                'exclusive maintenance gate'
            );

            await laterWriter.query('BEGIN');
            laterWriterPromise = lockAttendanceWriteTarget(laterWriter, {
                staffId: secondaryStaffId,
                date: '2099-07-19'
            }).then(value => {
                laterWriterSettled = true;
                acquisitionOrder.push('later-writer');
                return value;
            });
            await waitForAdvisoryWait(
                observer,
                laterWriterPid,
                activeWriterPid,
                () => laterWriterSettled,
                'writer queued behind exclusive maintenance'
            );

            await activeWriter.query('COMMIT');
            await withDeadline(maintenancePromise, 'exclusive maintenance acquisition');
            assert.equal(maintenanceSettled, true);
            assert.equal(laterWriterSettled, false, 'later shared writer cannot pass held exclusive maintenance');
            await waitForAdvisoryWait(
                observer,
                laterWriterPid,
                maintenancePid,
                () => laterWriterSettled,
                'writer blocked by held exclusive maintenance'
            );
            assert.equal(await countGrantedAdvisoryLocks(observer, maintenancePid), 1);

            await maintenance.query('COMMIT');
            await withDeadline(laterWriterPromise, 'later writer acquisition after maintenance');
            assert.deepEqual(acquisitionOrder, ['maintenance', 'later-writer']);
            await laterWriter.query('COMMIT');
        } finally {
            await rollbackQuietly(activeWriter);
            await rollbackQuietly(maintenance);
            await rollbackQuietly(laterWriter);
            if (maintenancePromise || laterWriterPromise) {
                await Promise.allSettled([maintenancePromise, laterWriterPromise].filter(Boolean));
            }
            activeWriter.release();
            maintenance.release();
            laterWriter.release();
            observer.release();
        }
    });
});
