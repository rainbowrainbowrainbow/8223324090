/**
 * Real PostgreSQL coverage for migration 297 payroll-profile constraints.
 *
 * This suite is excluded from the fast baseline. Run it only through:
 *   npm run test:integration:payroll-profiles:isolated
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    archivePayrollProfile,
    createPayrollProfile,
    createPayrollProfileClone,
    createPayrollProfileVersion,
    saveStaffPayrollProfileAssignments,
    syncPayrollProfileFromBase
} = require('../../services/hrPayrollProfiles');

const enabled = process.env.RUN_PAYROLL_PROFILES_INTEGRATION === 'true';
const LOCK_WAIT_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 10_000;

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_PAYROLL_PROFILES_INTEGRATION=true');
    assert.equal(
        process.env.REQUIRE_ISOLATED_TEST_TARGET,
        'true',
        'payroll profile integration requires the isolated local test runner'
    );
    assert.equal(
        process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,
        'true',
        'payroll profile integration requires verified disposable database setup'
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
        max: 8,
        connectionTimeoutMillis: 10_000
    });
}

async function expectPgError(promise, expectedCodes, message) {
    let caught = null;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.ok(caught, message);
    assert.ok(
        expectedCodes.includes(caught.code),
        `${message}: expected PostgreSQL code ${expectedCodes.join(' or ')}, received ${caught.code || 'none'} (${caught.message})`
    );
    return caught;
}

async function rollbackQuietly(client) {
    if (!client) return;
    try {
        await client.query('ROLLBACK');
    } catch {
        // The isolated runner resets the disposable schema after this suite.
    }
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

async function waitForAdvisoryWait(observer, waiterPid, holderPid, isSettled) {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        assert.equal(isSettled(), false, 'overlapping assignment completed before waiting on the advisory lock');
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
    throw new Error('overlapping assignment was not visible as an advisory-lock waiter');
}

async function waitForDatabaseLock(observer, waiterPid, isSettled) {
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        assert.equal(isSettled(), false, 'profile owner update completed before waiting on the assignment row lock');
        const result = await observer.query(
            `SELECT wait_event_type, wait_event
             FROM pg_stat_activity
             WHERE pid = $1`,
            [waiterPid]
        );
        if (result.rows[0]?.wait_event_type === 'Lock') return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error('profile owner update was not visible as a PostgreSQL lock waiter');
}

describe('payroll profile migration 297 on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;
    let professionKey;
    let foreignProfessionKey;
    let serviceProfessionKey;
    let ownerStaffId;
    let otherStaffId;
    let baseProfileId;
    let baseVersionId;
    let personalProfileId;
    let personalVersionId;
    let monthProfileId;
    let monthVersionId;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = createPool(testDb);
        const suffix = `${process.pid}_${Date.now()}`;
        professionKey = `payroll_test_${suffix}`.slice(0, 64);
        foreignProfessionKey = `payroll_foreign_${suffix}`.slice(0, 64);
        serviceProfessionKey = `payroll_service_${suffix}`.slice(0, 64);

        await pool.query(
            `INSERT INTO hr_professions (key, title, department)
             VALUES ($1, 'Payroll Profile Test', 'QA'),
                    ($2, 'Payroll Foreign Profession', 'QA'),
                    ($3, 'Payroll Service Profession', 'QA')`,
            [professionKey, foreignProfessionKey, serviceProfessionKey]
        );

        const staff = await pool.query(
            `INSERT INTO staff (name, department, position, is_active)
             VALUES ($1, 'qa', 'Payroll profile owner', true),
                    ($2, 'qa', 'Payroll profile non-owner', true)
             RETURNING id`,
            [
                `Payroll Owner ${suffix}`,
                `Payroll Other ${suffix}`
            ]
        );
        [ownerStaffId, otherStaffId] = staff.rows.map(row => Number(row.id));

        await pool.query(
            `INSERT INTO staff_role_assignments
                (staff_id, profession_key, is_primary, status, admission_status, internship_status, created_by, updated_by)
             VALUES
                ($1, $2, true, 'active', 'approved', 'none', 'integration_test', 'integration_test'),
                ($3, $2, true, 'active', 'approved', 'none', 'integration_test', 'integration_test')`,
            [ownerStaffId, serviceProfessionKey, otherStaffId]
        );

        const baseProfile = await pool.query(
            `INSERT INTO payroll_profiles
                (title, profession_key, profile_kind, is_default_for_profession, status, created_by)
             VALUES
                ('Shared Instructor', $1, 'shared', true, 'active', 'integration_test')
             RETURNING id`,
            [professionKey]
        );
        baseProfileId = Number(baseProfile.rows[0].id);

        const baseVersion = await pool.query(
            `INSERT INTO payroll_profile_versions
                (profile_id, version_number, rate_unit, default_rate, effective_from, effective_to, change_reason, created_by)
             VALUES
                ($1, 1, 'hour', 100.00, DATE '2199-01-01', DATE '2199-12-31', 'Initial shared rate', 'integration_test')
             RETURNING id`,
            [baseProfileId]
        );
        baseVersionId = Number(baseVersion.rows[0].id);

        await pool.query(
            `INSERT INTO payroll_profile_day_rates
                (profile_version_id, rate_unit, iso_weekday, rate, created_by)
             VALUES ($1, 'hour', 6, 150.00, 'integration_test')`,
            [baseVersionId]
        );

        const personalProfile = await pool.query(
            `INSERT INTO payroll_profiles
                (title, profession_key, profile_kind, owner_staff_id, source_profile_id, source_version_id, status, created_by)
             VALUES
                ('Instructor Personal', $1, 'personal', $2, $3, $4, 'active', 'integration_test')
             RETURNING id`,
            [professionKey, ownerStaffId, baseProfileId, baseVersionId]
        );
        personalProfileId = Number(personalProfile.rows[0].id);

        const personalVersion = await pool.query(
            `INSERT INTO payroll_profile_versions
                (profile_id, version_number, rate_unit, default_rate, effective_from, effective_to, change_reason, created_by)
             VALUES
                ($1, 1, 'hour', 125.00, DATE '2199-01-01', DATE '2199-12-31', 'Personal agreement', 'integration_test')
             RETURNING id`,
            [personalProfileId]
        );
        personalVersionId = Number(personalVersion.rows[0].id);

        const monthProfile = await pool.query(
            `INSERT INTO payroll_profiles
                (title, profession_key, profile_kind, is_default_for_profession, status, created_by)
             VALUES
                ('Monthly Instructor', $1, 'shared', false, 'active', 'integration_test')
             RETURNING id`,
            [professionKey]
        );
        monthProfileId = Number(monthProfile.rows[0].id);

        const monthVersion = await pool.query(
            `INSERT INTO payroll_profile_versions
                (profile_id, version_number, rate_unit, default_rate, effective_from, effective_to, created_by)
             VALUES
                ($1, 1, 'month', 30000.00, DATE '2199-01-01', NULL, 'integration_test')
             RETURNING id`,
            [monthProfileId]
        );
        monthVersionId = Number(monthVersion.rows[0].id);
    });

    after(async () => {
        if (!pool) return;
        try {
            await pool.query('BEGIN');
            await pool.query(
                `DELETE FROM staff_payroll_profile_assignments
                 WHERE profession_key IN ($1, $2, $3)`,
                [professionKey, foreignProfessionKey, serviceProfessionKey]
            );
            await pool.query(
                `UPDATE payroll_profiles
                 SET source_profile_id = NULL,
                     source_version_id = NULL
                 WHERE profession_key IN ($1, $2, $3)`,
                [professionKey, foreignProfessionKey, serviceProfessionKey]
            );
            await pool.query(
                `DELETE FROM payroll_profile_day_rates
                 WHERE profile_version_id IN (
                     SELECT version.id
                     FROM payroll_profile_versions version
                     JOIN payroll_profiles profile ON profile.id = version.profile_id
                     WHERE profile.profession_key IN ($1, $2, $3)
                 )`,
                [professionKey, foreignProfessionKey, serviceProfessionKey]
            );
            await pool.query(
                `DELETE FROM payroll_profile_versions
                 WHERE profile_id IN (
                     SELECT id
                     FROM payroll_profiles
                     WHERE profession_key IN ($1, $2, $3)
                 )`,
                [professionKey, foreignProfessionKey, serviceProfessionKey]
            );
            await pool.query(
                `DELETE FROM payroll_profiles
                 WHERE profession_key IN ($1, $2, $3)`,
                [professionKey, foreignProfessionKey, serviceProfessionKey]
            );
            await pool.query(
                'DELETE FROM staff_role_assignments WHERE staff_id = ANY($1::integer[])',
                [[ownerStaffId, otherStaffId]]
            );
            await pool.query(
                'UPDATE hr_audit_log SET staff_id = NULL WHERE staff_id = ANY($1::integer[])',
                [[ownerStaffId, otherStaffId]]
            );
            await pool.query(
                'DELETE FROM staff WHERE id = ANY($1::integer[])',
                [[ownerStaffId, otherStaffId]]
            );
            await pool.query(
                'DELETE FROM hr_professions WHERE key IN ($1, $2, $3)',
                [professionKey, foreignProfessionKey, serviceProfessionKey]
            );
            await pool.query('COMMIT');
        } catch (error) {
            await pool.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            await pool.end();
        }
    });

    test('creates a profession default, personal clone, historical version, weekday exception, and temporary assignment', async () => {
        const secondVersion = await pool.query(
            `INSERT INTO payroll_profile_versions
                (profile_id, version_number, rate_unit, default_rate, effective_from, effective_to, change_reason, created_by)
             VALUES
                ($1, 2, 'hour', 110.00, DATE '2200-01-01', NULL, 'New-year rate', 'integration_test')
             RETURNING id`,
            [baseProfileId]
        );
        assert.ok(Number(secondVersion.rows[0].id) > 0);

        const assignment = await pool.query(
            `INSERT INTO staff_payroll_profile_assignments
                (staff_id, profession_key, profile_id, assignment_kind, effective_from, effective_to, created_by)
             VALUES
                ($1, $2, $3, 'temporary', DATE '2199-06-01', DATE '2199-06-30', 'integration_test')
             RETURNING id`,
            [ownerStaffId, professionKey, personalProfileId]
        );
        assert.ok(Number(assignment.rows[0].id) > 0);

        const snapshot = await pool.query(
            `SELECT profile.profile_kind,
                    profile.owner_staff_id,
                    profile.source_profile_id,
                    profile.source_version_id,
                    version.default_rate::text AS default_rate,
                    day_rate.rate::text AS saturday_rate
             FROM payroll_profiles profile
             JOIN payroll_profile_versions version ON version.profile_id = profile.id
             LEFT JOIN payroll_profile_day_rates day_rate
               ON day_rate.profile_version_id = $2
              AND day_rate.iso_weekday = 6
             WHERE profile.id = $1
               AND version.id = $3`,
            [personalProfileId, baseVersionId, personalVersionId]
        );
        assert.equal(snapshot.rows[0].profile_kind, 'personal');
        assert.equal(Number(snapshot.rows[0].owner_staff_id), ownerStaffId);
        assert.equal(Number(snapshot.rows[0].source_profile_id), baseProfileId);
        assert.equal(Number(snapshot.rows[0].source_version_id), baseVersionId);
        assert.equal(snapshot.rows[0].default_rate, '125.00');
        assert.equal(snapshot.rows[0].saturday_rate, '150.00');
    });

    test('backend service manages clone lifecycle, selected sync, assignment audit, and archive guard', async () => {
        const actor = { username: 'integration_test', ipAddress: '127.0.0.1' };
        const base = await createPayrollProfile({
            title: 'Service Instructor Base',
            professionKey: serviceProfessionKey,
            isDefaultForProfession: true,
            version: {
                rateUnit: 'hour',
                defaultRate: 100,
                effectiveFrom: '2300-01-01',
                changeReason: 'Initial service base',
                dayRates: [{ isoWeekday: 6, rate: 150 }]
            }
        }, actor, { db: pool });
        assert.equal(base.isDefaultForProfession, true);
        assert.equal(base.latestVersion.defaultRate, 100);

        const clone = await createPayrollProfileClone(base.id, {
            ownerStaffId,
            title: 'Service Instructor Base · Owner',
            effectiveFrom: '2300-01-01',
            reason: 'Personal agreement'
        }, actor, { db: pool });
        assert.equal(clone.profile.profileKind, 'personal');
        assert.equal(clone.profile.sourceProfileId, base.id);
        assert.equal(clone.profile.sourceVersionId, base.latestVersion.id);

        const personalVersion = await createPayrollProfileVersion(clone.profile.id, {
            rateUnit: 'hour',
            defaultRate: 125,
            effectiveFrom: '2300-02-01',
            changeReason: 'Personal rate agreement',
            dayRates: [{ isoWeekday: 6, rate: 175 }]
        }, actor, { db: pool });
        assert.equal(personalVersion.version.versionNumber, 2);
        assert.equal(personalVersion.profile.latestVersion.defaultRate, 125);

        const baseVersion = await createPayrollProfileVersion(base.id, {
            rateUnit: 'hour',
            defaultRate: 140,
            effectiveFrom: '2300-03-01',
            changeReason: 'Base weekend update',
            dayRates: [
                { isoWeekday: 6, rate: 190 },
                { isoWeekday: 7, rate: 200 }
            ]
        }, actor, { db: pool });

        const preview = await syncPayrollProfileFromBase(clone.profile.id, {
            sourceVersionId: baseVersion.version.id
        }, actor, { db: pool });
        assert.equal(preview.applied, false);
        assert.ok(preview.diff.fields.some(field => field.field === 'default_rate'));
        assert.ok(preview.diff.fields.some(field => field.field === 'day_rates.7'));

        const synced = await syncPayrollProfileFromBase(clone.profile.id, {
            sourceVersionId: baseVersion.version.id,
            apply: true,
            selectedChanges: ['default_rate', 'day_rates.7'],
            effectiveFrom: '2300-04-01',
            changeReason: 'Apply selected base changes'
        }, actor, { db: pool });
        assert.equal(synced.applied, true);
        assert.equal(synced.version.defaultRate, 140);
        assert.deepEqual(synced.version.dayRates.map(rate => [rate.isoWeekday, rate.rate]), [
            [6, 175],
            [7, 200]
        ]);

        const assignments = await saveStaffPayrollProfileAssignments(ownerStaffId, {
            reason: 'Temporary personal payroll assignment',
            assignments: [{
                professionKey: serviceProfessionKey,
                profileId: clone.profile.id,
                assignmentKind: 'temporary',
                effectiveFrom: '2300-05-01',
                effectiveTo: '2300-05-31'
            }]
        }, actor, { db: pool });
        const savedAssignment = assignments.assignments.find(row => row.professionKey === serviceProfessionKey);
        assert.ok(savedAssignment);
        assert.equal(savedAssignment.assignmentKind, 'temporary');

        await assert.rejects(
            archivePayrollProfile(clone.profile.id, {
                reason: 'Attempt archive while assigned',
                today: '2300-05-15'
            }, actor, { db: pool }),
            /active or future assignments/
        );
    });

    test('allows only one active default profile for a profession', async () => {
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_profiles
                    (title, profession_key, profile_kind, is_default_for_profession, status)
                 VALUES ('Duplicate Default', $1, 'shared', true, 'active')`,
                [professionKey]
            ),
            ['23505'],
            'second active profession default must be rejected'
        );
    });

    test('rejects overlapping versions while allowing the adjacent historical version', async () => {
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_profile_versions
                    (profile_id, version_number, rate_unit, default_rate, effective_from, effective_to)
                 VALUES ($1, 99, 'hour', 115.00, DATE '2199-12-31', DATE '2200-02-01')`,
                [baseProfileId]
            ),
            ['23P01'],
            'overlapping inclusive version range must be rejected'
        );
    });

    test('month version rejects weekday overrides', async () => {
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_profile_day_rates
                    (profile_version_id, rate_unit, iso_weekday, rate)
                 VALUES ($1, 'hour', 7, 35000.00)`,
                [monthVersionId]
            ),
            ['23503'],
            'month version must not accept an hour/day weekday override'
        );
    });

    test('enforces source-version ownership, profession matching, and personal ownership', async () => {
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_profiles
                    (title, profession_key, profile_kind, owner_staff_id, source_profile_id, source_version_id, status)
                 VALUES ('Invalid Clone', $1, 'personal', $2, $3, $4, 'draft')`,
                [professionKey, otherStaffId, baseProfileId, personalVersionId]
            ),
            ['23503'],
            'clone source version must belong to its source profile'
        );

        await expectPgError(
            pool.query(
                `INSERT INTO staff_payroll_profile_assignments
                    (staff_id, profession_key, profile_id, assignment_kind, effective_from)
                 VALUES ($1, $2, $3, 'explicit', DATE '2199-01-01')`,
                [otherStaffId, foreignProfessionKey, baseProfileId]
            ),
            ['23503'],
            'assignment profession must match the profile profession'
        );

        const personalOwnerError = await expectPgError(
            pool.query(
                `INSERT INTO staff_payroll_profile_assignments
                    (staff_id, profession_key, profile_id, assignment_kind, effective_from)
                 VALUES ($1, $2, $3, 'explicit', DATE '2199-01-01')`,
                [otherStaffId, professionKey, personalProfileId]
            ),
            ['23514'],
            'personal profile must reject a non-owner assignment'
        );
        assert.match(personalOwnerError.message, /Personal payroll profile/);
    });

    test('serializes concurrent overlapping assignments and rejects the second writer', async () => {
        const writerA = await pool.connect();
        const writerB = await pool.connect();
        const observer = await pool.connect();
        let writerBSettled = false;
        let writerBError = null;
        try {
            const [{ rows: [{ pid: writerAPid }] }, { rows: [{ pid: writerBPid }] }] = await Promise.all([
                writerA.query('SELECT pg_backend_pid() AS pid'),
                writerB.query('SELECT pg_backend_pid() AS pid')
            ]);
            await writerA.query('BEGIN');
            await writerB.query('BEGIN');
            await writerA.query(
                `INSERT INTO staff_payroll_profile_assignments
                    (staff_id, profession_key, profile_id, assignment_kind, effective_from, effective_to)
                 VALUES ($1, $2, $3, 'explicit', DATE '2199-01-01', DATE '2199-12-31')`,
                [otherStaffId, professionKey, baseProfileId]
            );

            const writerBInsert = writerB.query(
                `INSERT INTO staff_payroll_profile_assignments
                    (staff_id, profession_key, profile_id, assignment_kind, effective_from, effective_to)
                 VALUES ($1, $2, $3, 'temporary', DATE '2199-06-01', DATE '2199-07-01')`,
                [otherStaffId, professionKey, baseProfileId]
            ).then(
                () => {
                    writerBSettled = true;
                },
                error => {
                    writerBSettled = true;
                    writerBError = error;
                }
            );

            await waitForAdvisoryWait(
                observer,
                Number(writerBPid),
                Number(writerAPid),
                () => writerBSettled
            );
            await writerA.query('COMMIT');
            await withDeadline(writerBInsert, 'overlapping assignment rejection');
            assert.equal(writerBError?.code, '23P01');
            await rollbackQuietly(writerB);
        } finally {
            await rollbackQuietly(writerA);
            await rollbackQuietly(writerB);
            writerA.release();
            writerB.release();
            observer.release();
        }
    });

    test('profile owner conversion waits for an in-flight assignment and then preserves personal ownership', async () => {
        const convertibleProfile = await pool.query(
            `INSERT INTO payroll_profiles
                (title, profession_key, profile_kind, is_default_for_profession, status)
             VALUES ('Convertible Shared Profile', $1, 'shared', false, 'active')
             RETURNING id`,
            [professionKey]
        );
        const convertibleProfileId = Number(convertibleProfile.rows[0].id);
        const writerA = await pool.connect();
        const writerB = await pool.connect();
        const observer = await pool.connect();
        let writerBSettled = false;
        let writerBError = null;
        try {
            const { rows: [{ pid: writerBPid }] } = await writerB.query(
                'SELECT pg_backend_pid() AS pid'
            );
            await writerA.query('BEGIN');
            await writerB.query('BEGIN');
            await writerA.query(
                `INSERT INTO staff_payroll_profile_assignments
                    (staff_id, profession_key, profile_id, assignment_kind, effective_from, effective_to)
                 VALUES ($1, $2, $3, 'explicit', DATE '2201-01-01', DATE '2201-12-31')`,
                [ownerStaffId, professionKey, convertibleProfileId]
            );

            const ownerUpdate = writerB.query(
                `UPDATE payroll_profiles
                 SET profile_kind = 'personal',
                     owner_staff_id = $1
                 WHERE id = $2`,
                [otherStaffId, convertibleProfileId]
            ).then(
                () => {
                    writerBSettled = true;
                },
                error => {
                    writerBSettled = true;
                    writerBError = error;
                }
            );

            await waitForDatabaseLock(observer, Number(writerBPid), () => writerBSettled);
            await writerA.query('COMMIT');
            await withDeadline(ownerUpdate, 'personal owner race rejection');
            assert.equal(writerBError?.code, '23514');
            assert.match(writerBError?.message || '', /another staff member/);
            await rollbackQuietly(writerB);

            const savedProfile = await pool.query(
                `SELECT profile_kind, owner_staff_id
                 FROM payroll_profiles
                 WHERE id = $1`,
                [convertibleProfileId]
            );
            assert.equal(savedProfile.rows[0].profile_kind, 'shared');
            assert.equal(savedProfile.rows[0].owner_staff_id, null);
        } finally {
            await rollbackQuietly(writerA);
            await rollbackQuietly(writerB);
            writerA.release();
            writerB.release();
            observer.release();
        }
    });
});
