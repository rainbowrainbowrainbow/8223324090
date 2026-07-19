'use strict';

const { after, afterEach, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const lifecycle = require('../../scripts/with-temporary-attendance-audit-role');

const enabled = process.env.RUN_ATTENDANCE_ROLE_LIFECYCLE_INTEGRATION === 'true';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_ATTENDANCE_ROLE_LIFECYCLE_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function poolConfig(testDb, applicationName) {
    return {
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        application_name: applicationName,
        max: 4,
        connectionTimeoutMillis: 10_000
    };
}

async function countGeneratedRoles(pool) {
    const result = await pool.query(
        `SELECT COUNT(*)::int AS count
           FROM pg_roles
          WHERE rolname LIKE $1`,
        [`${lifecycle.ROLE_PREFIX}%`]
    );
    return Number(result.rows[0]?.count || 0);
}

async function countExactRole(pool, roleName) {
    const result = await pool.query(
        `SELECT COUNT(*)::int AS count
           FROM pg_roles
          WHERE rolname = $1`,
        [roleName]
    );
    return Number(result.rows[0]?.count || 0);
}

describe('temporary attendance audit role lifecycle on isolated PostgreSQL', {
    skip: !enabled,
    concurrency: 1
}, () => {
    let testDb;
    let adminUrl;
    let adminPool;

    before(async () => {
        testDb = requireIsolatedDatabase();
        adminUrl = testDb.url.toString();
        adminPool = new Pool(poolConfig(testDb, 'attendance_role_lifecycle_test_admin'));

        // The isolated runner intentionally grants ALL on public to PUBLIC while
        // rebuilding the schema. Remove inherited access so the lifecycle test
        // proves the helper's explicit least-privilege grants.
        await adminPool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
        await adminPool.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC');
    });

    afterEach(async () => {
        assert.equal(await countGeneratedRoles(adminPool), 0, 'temporary audit roles must never survive a test');
    });

    after(async () => {
        await adminPool?.end();
    });

    test('creates, verifies, uses and drops the temporary role', async () => {
        let createdRole = '';
        const completed = await lifecycle.withTemporaryAuditRole({
            adminUrl,
            ttlMinutes: 5
        }, async context => {
            createdRole = context.roleName;
            assert.equal(await countExactRole(adminPool, createdRole), 1);
            assert.ok(new Date(context.expiresAt).getTime() > Date.now());

            const report = await lifecycle.verifyTemporaryRole(context.connectionString);
            assert.equal(report.defaultTransactionReadOnly, 'on');
            assert.equal(report.extraSelectableTables, 0);
            assert.equal(report.tables.length, lifecycle.REQUIRED_TABLES.length);

            const rolePool = new Pool({
                connectionString: context.connectionString,
                ssl: false,
                max: 1
            });
            try {
                const query = await rolePool.query(
                    `SELECT COUNT(*)::int AS count
                       FROM hr_time_records`
                );
                assert.ok(Number.isInteger(Number(query.rows[0].count)));
                const privileges = await rolePool.query(
                    `SELECT has_table_privilege(current_user, 'public.hr_time_records', 'SELECT') AS can_select,
                            has_table_privilege(current_user, 'public.hr_time_records', 'UPDATE') AS can_update`
                );
                assert.equal(privileges.rows[0].can_select, true);
                assert.equal(privileges.rows[0].can_update, false);
            } finally {
                await rolePool.end();
            }
            return 'audit-complete';
        });

        assert.equal(completed.result, 'audit-complete');
        assert.equal(completed.lifecycle.roleName, createdRole);
        assert.equal(completed.lifecycle.cleanupConfirmed, true);
        assert.equal(await countExactRole(adminPool, createdRole), 0);
    });

    test('audit command failure still drops the role and grants', async () => {
        let failedRole = '';
        await assert.rejects(
            lifecycle.withTemporaryAuditRole({ adminUrl }, async context => {
                failedRole = context.roleName;
                await lifecycle.runAuditChild(['--unsupported-fixture-flag'], context.connectionString);
            }),
            /Attendance anomaly audit failed/
        );
        assert.equal(await countExactRole(adminPool, failedRole), 0);
    });

    test('runs the real aggregate audit with only the approved seven-table role scope', async () => {
        let auditRole = '';
        const completed = await lifecycle.withTemporaryAuditRole({ adminUrl }, async context => {
            auditRole = context.roleName;
            await lifecycle.runAuditChild([
                '--from', '2099-01-01',
                '--to', '2099-01-01',
                '--business-context', 'event_genix',
                '--format', 'json'
            ], context.connectionString);
            return 'aggregate-audit-complete';
        });

        assert.equal(completed.result, 'aggregate-audit-complete');
        assert.equal(await countExactRole(adminPool, auditRole), 0);
    });

    test('an interrupted role connection is terminated before cleanup', async () => {
        let interruptedRole = '';
        let checkedOutClient;
        let rolePool;
        await assert.rejects(
            lifecycle.withTemporaryAuditRole({ adminUrl }, async context => {
                interruptedRole = context.roleName;
                rolePool = new Pool({
                    connectionString: context.connectionString,
                    ssl: false,
                    max: 1
                });
                rolePool.on('error', () => {});
                checkedOutClient = await rolePool.connect();
                checkedOutClient.on('error', () => {});
                await checkedOutClient.query('SELECT 1');
                throw new Error('simulated interrupted audit connection');
            }),
            /simulated interrupted audit connection/
        );
        checkedOutClient?.release(true);
        await rolePool?.end();
        assert.equal(await countExactRole(adminPool, interruptedRole), 0);
    });

    test('recovery is exact, repeatable and does not touch unrelated roles', async () => {
        const unrelatedRole = `eg_attendance_unrelated_${process.pid}_${Date.now()}`;
        await adminPool.query(`CREATE ROLE "${unrelatedRole}" NOLOGIN`);
        try {
            let generatedRole = '';
            await lifecycle.withTemporaryAuditRole({ adminUrl }, async context => {
                generatedRole = context.roleName;
                assert.equal(await countExactRole(adminPool, unrelatedRole), 1);
            });

            const firstRecovery = await lifecycle.recoverRole(adminUrl, generatedRole);
            const secondRecovery = await lifecycle.recoverRole(adminUrl, generatedRole);
            assert.equal(firstRecovery.alreadyAbsent, true);
            assert.equal(secondRecovery.alreadyAbsent, true);
            assert.equal(firstRecovery.remainingRoles, 0);
            assert.equal(secondRecovery.remainingRoles, 0);
            assert.equal(await countExactRole(adminPool, unrelatedRole), 1);
        } finally {
            await adminPool.query(`DROP ROLE IF EXISTS "${unrelatedRole}"`);
        }
    });

    test('recovery refuses a role outside the generated namespace', async () => {
        await assert.rejects(
            lifecycle.recoverRole(adminUrl, 'postgres'),
            /must exactly match/
        );
        assert.equal(await countExactRole(adminPool, 'postgres'), 1);
    });
});
