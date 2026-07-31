'use strict';

const crypto = require('node:crypto');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { createAccountOnboarding } = require('../../services/accountOnboarding');

const enabled = process.env.RUN_ACCOUNT_ONBOARDING_INTEGRATION === 'true';
const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const usernamePrefix = `qa.onboarding.${suffix}`;
const staffNamePrefix = `Disposable Account Onboarding ${suffix}`;
const usernames = {
    newStaff: `${usernamePrefix}.new`,
    existingStaff: `${usernamePrefix}.existing`,
    occupiedAttempt: `${usernamePrefix}.occupied`,
    aliasHolder: `${usernamePrefix}.holder`,
    aliasCollision: `${usernamePrefix}.alias`,
    rollback: `${usernamePrefix}.rollback`
};

let pool = null;
let actor = null;

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_ACCOUNT_ONBOARDING_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
}

function onboardingPayload(username, name, staff = {}) {
    return {
        personal: {
            name,
            username,
            phone: '+380000000001'
        },
        staff: {
            mode: staff.mode || 'new',
            ...(staff.id ? { id: staff.id } : {}),
            ...(staff.mode === 'existing' ? {} : {
                department: 'QA',
                position: 'Disposable integration fixture'
            })
        },
        professions: [{ key: 'animator', isPrimary: true }],
        access: { role: 'animator' },
        issueOneTime: true
    };
}

function faultingPool(realPool, predicate) {
    return {
        async connect() {
            const client = await realPool.connect();
            let injected = false;
            return {
                async query(sql, params) {
                    if (!injected && predicate(String(sql))) {
                        injected = true;
                        const error = new Error('forced_account_onboarding_integration_failure');
                        error.code = 'XX000';
                        throw error;
                    }
                    return client.query(sql, params);
                },
                release() {
                    client.release();
                }
            };
        },
        query(sql, params) {
            return realPool.query(sql, params);
        }
    };
}

function tracingPool(realPool, statements) {
    return {
        async connect() {
            const client = await realPool.connect();
            return {
                async query(sql, params) {
                    statements.push(String(sql).replace(/\s+/g, ' ').trim());
                    return client.query(sql, params);
                },
                release() {
                    client.release();
                }
            };
        },
        query(sql, params) {
            return realPool.query(sql, params);
        }
    };
}

function findSensitiveAuditKeys(value, path = '$', found = []) {
    if (!value || typeof value !== 'object') return found;
    if (Array.isArray(value)) {
        value.forEach((item, index) => findSensitiveAuditKeys(item, `${path}[${index}]`, found));
        return found;
    }
    for (const [key, nested] of Object.entries(value)) {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (/(password|credential|token|authorization|cookie|secret)/.test(normalized)) {
            found.push(`${path}.${key}`);
        }
        findSensitiveAuditKeys(nested, `${path}.${key}`, found);
    }
    return found;
}

async function cleanupFixtures() {
    if (!pool) return;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const users = await client.query(
            'SELECT id FROM users WHERE username = ANY($1::text[]) OR username LIKE $2',
            [Object.values(usernames), `${usernamePrefix}%`]
        );
        const staff = await client.query(
            'SELECT id FROM staff WHERE name LIKE $1',
            [`${staffNamePrefix}%`]
        );
        const userIds = users.rows.map(row => Number(row.id)).filter(Number.isInteger);
        const staffIds = staff.rows.map(row => Number(row.id)).filter(Number.isInteger);

        if (userIds.length) {
            await client.query('DELETE FROM chat_channel_members WHERE user_id = ANY($1::int[])', [userIds]);
            await client.query(
                'DELETE FROM account_security_events WHERE target_user_id = ANY($1::int[]) OR actor_user_id = ANY($1::int[])',
                [userIds]
            );
        }
        if (userIds.length || staffIds.length) {
            await client.query(
                `DELETE FROM employee_profiles
                 WHERE ($1::int[] <> '{}'::int[] AND user_id = ANY($1::int[]))
                    OR ($2::int[] <> '{}'::int[] AND staff_id = ANY($2::int[]))`,
                [userIds, staffIds]
            );
        }
        if (staffIds.length) {
            await client.query('DELETE FROM hr_audit_log WHERE staff_id = ANY($1::int[])', [staffIds]);
        }
        if (userIds.length) await client.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
        if (staffIds.length) await client.query('DELETE FROM staff WHERE id = ANY($1::int[])', [staffIds]);
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

describe('transactional account onboarding on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = new Pool({
            connectionString: testDb.url.toString(),
            ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
            max: 4,
            connectionTimeoutMillis: 10_000
        });
        const creator = await pool.query(
            `SELECT id, username, name, role, extra_roles, action_allowlist, action_denylist, is_active
             FROM users
             WHERE role = 'creator' AND COALESCE(is_active, true) = true
             ORDER BY id
             LIMIT 1`
        );
        assert.equal(creator.rows.length, 1, 'isolated startup provides an active creator actor');
        actor = creator.rows[0];

        const profession = await pool.query(
            "SELECT id FROM hr_professions WHERE key = 'animator' AND is_active = true"
        );
        assert.equal(profession.rows.length, 1, 'isolated startup provides the animator profession');
    });

    after(async () => {
        try {
            await cleanupFixtures();
        } finally {
            if (pool) await pool.end();
            pool = null;
        }
    });

    it('atomically creates a new staff profile, account, profession assignment and canonical link', async () => {
        const name = `${staffNamePrefix} New`;
        const payload = onboardingPayload(usernames.newStaff, name);
        payload.conditions = [{
            professionKey: 'animator',
            rateMode: 'explicit',
            hourlyRate: 275,
            shiftPreferences: [
                { dayType: 'weekday', startTime: '09:00', endTime: '18:00' },
                { dayType: 'weekend', startTime: '10:00', endTime: '16:00' }
            ]
        }];
        const result = await createAccountOnboarding({
            payload,
            actor,
            dbPool: pool
        });

        assert.equal(result.loginReady, true);
        assert.equal(result.receipt.staff.created, true);
        assert.equal(result.receipt.staff.linked, true);
        assert.equal(result.receipt.professions.length, 1);
        assert.equal(result.receipt.professions[0].key, 'animator');
        assert.equal(result.receipt.professions[0].isPrimary, true);
        assert.equal(result.receipt.conditions[0].before.rateMode, 'fallback');
        assert.equal(result.receipt.conditions[0].after.rateMode, 'explicit');
        assert.equal(result.receipt.conditions[0].after.explicitRate, 275);
        assert.deepEqual(
            result.receipt.conditions[0].after.shiftPreferences.map(item => [item.dayType, item.startTime, item.endTime, item.isActive]),
            [['weekday', '09:00', '18:00', true], ['weekend', '10:00', '16:00', true]]
        );
        assert.equal(result.credential.username, usernames.newStaff);
        assert.match(result.credential.password, /^[A-Z][A-Za-z]+-[A-Z][A-Za-z]+-\d{2}$/);

        const persisted = await pool.query(
            `SELECT u.id AS user_id, u.username, u.role,
                    s.id AS staff_id, s.name AS staff_name, s.role_type,
                    ep.user_id AS linked_user_id, ep.staff_id AS linked_staff_id,
                    sra.profession_key, sra.is_primary
             FROM users u
             JOIN employee_profiles ep ON ep.user_id = u.id
             JOIN staff s ON s.id = ep.staff_id
             JOIN staff_role_assignments sra ON sra.staff_id = s.id
             WHERE u.username = $1`,
            [usernames.newStaff]
        );
        assert.equal(persisted.rows.length, 1);
        assert.equal(persisted.rows[0].username, usernames.newStaff);
        assert.equal(persisted.rows[0].role, 'animator');
        assert.equal(persisted.rows[0].staff_name, name);
        assert.equal(persisted.rows[0].role_type, 'animator');
        assert.equal(Number(persisted.rows[0].linked_user_id), Number(persisted.rows[0].user_id));
        assert.equal(Number(persisted.rows[0].linked_staff_id), Number(persisted.rows[0].staff_id));
        assert.equal(persisted.rows[0].profession_key, 'animator');
        assert.equal(persisted.rows[0].is_primary, true);

        const conditions = await pool.query(
            `SELECT rate.hourly_rate,
                    jsonb_agg(jsonb_build_array(pref.day_type, pref.start_time::text, pref.end_time::text) ORDER BY pref.day_type) AS preferences
             FROM staff_profession_rates rate
             JOIN staff_shift_preferences pref
               ON pref.staff_id = rate.staff_id AND pref.profession_key = rate.profession_key
             WHERE rate.staff_id = $1 AND rate.profession_key = 'animator'
             GROUP BY rate.hourly_rate`,
            [persisted.rows[0].staff_id]
        );
        assert.equal(Number(conditions.rows[0].hourly_rate), 275);
        assert.deepEqual(conditions.rows[0].preferences, [
            ['weekday', '09:00:00', '18:00:00'],
            ['weekend', '10:00:00', '16:00:00']
        ]);

        const audit = await pool.query(
            `SELECT event_type, details
             FROM account_security_events
             WHERE target_user_id = $1
             ORDER BY id`,
            [persisted.rows[0].user_id]
        );
        const hrAudit = await pool.query(
            `SELECT action, details
             FROM hr_audit_log
             WHERE staff_id = $1 AND action = 'account_onboarding_created'
             ORDER BY id`,
            [persisted.rows[0].staff_id]
        );
        assert.deepEqual(
            audit.rows.map(row => row.event_type),
            ['account_onboarding_staff_linked', 'account_onboarding_created']
        );
        assert.equal(hrAudit.rows.length, 1);
        assert.equal(audit.rows.at(-1).details.conditionChanges[0].before.rateMode, 'fallback');
        assert.equal(audit.rows.at(-1).details.conditionChanges[0].after.explicitRate, 275);
        assert.equal(hrAudit.rows[0].details.conditionChanges[0].after.shiftPreferences[0].startTime, '09:00');
        const auditPayload = { security: audit.rows, hr: hrAudit.rows };
        assert.equal(JSON.stringify(auditPayload).includes(result.credential.password), false);
        assert.deepEqual(findSensitiveAuditKeys(auditPayload), []);
    });

    it('links an existing staff row while preserving its prior profession assignment', async () => {
        const name = `${staffNamePrefix} Existing`;
        const insertedStaff = await pool.query(
            `INSERT INTO staff
                (name, department, position, phone, is_active, role_type,
                 secondary_professions, hourly_rate, rate_unit)
             VALUES ($1, 'QA', 'Existing disposable fixture', '+380000000002', true,
                     'barista', '[]'::jsonb, 0, 'hour')
             RETURNING id`,
            [name]
        );
        const staffId = Number(insertedStaff.rows[0].id);
        await pool.query(
            `INSERT INTO staff_role_assignments
                (staff_id, profession_key, is_primary, status, admission_status,
                 internship_status, hourly_rate, notes, created_by, updated_by)
             VALUES
                ($1, 'barista', true, 'active', 'approved', 'none', 321, $2, 'integration', 'integration'),
                ($1, 'technician', false, 'inactive', 'approved', 'none', NULL, 'historical-inactive-assignment', 'integration', 'integration')`,
            [staffId, 'preserve-existing-assignment']
        );

        const result = await createAccountOnboarding({
            payload: onboardingPayload(usernames.existingStaff, name, { mode: 'existing', id: staffId }),
            actor,
            dbPool: pool
        });
        assert.equal(result.receipt.staff.created, false);
        assert.equal(Number(result.receipt.staff.id), staffId);
        assert.equal(result.receipt.staff.linked, true);

        const assignments = await pool.query(
            `SELECT profession_key, is_primary, status, hourly_rate, notes
             FROM staff_role_assignments
             WHERE staff_id = $1
             ORDER BY profession_key`,
            [staffId]
        );
        assert.deepEqual(assignments.rows.map(row => [row.profession_key, row.is_primary]), [
            ['animator', true],
            ['barista', false],
            ['technician', false]
        ]);
        const preserved = assignments.rows.find(row => row.profession_key === 'barista');
        assert.equal(Number(preserved.hourly_rate), 321);
        assert.equal(preserved.notes, 'preserve-existing-assignment');
        const inactive = assignments.rows.find(row => row.profession_key === 'technician');
        assert.equal(inactive.status, 'inactive');

        const staffState = await pool.query('SELECT secondary_professions FROM staff WHERE id = $1', [staffId]);
        assert.deepEqual(staffState.rows[0].secondary_professions, ['barista']);

        const link = await pool.query(
            `SELECT u.username, ep.staff_id
             FROM users u
             JOIN employee_profiles ep ON ep.user_id = u.id
             WHERE u.username = $1`,
            [usernames.existingStaff]
        );
        assert.equal(link.rows.length, 1);
        assert.equal(Number(link.rows[0].staff_id), staffId);
    });

    it('rejects an already linked staff profile before creating a second account', async () => {
        const linked = await pool.query(
            `SELECT ep.staff_id
             FROM employee_profiles ep
             JOIN users u ON u.id = ep.user_id
             WHERE u.username = $1`,
            [usernames.existingStaff]
        );
        const staffId = Number(linked.rows[0]?.staff_id);
        assert.ok(staffId > 0, 'existing-staff fixture is linked by the preceding test');

        await assert.rejects(
            createAccountOnboarding({
                payload: onboardingPayload(
                    usernames.occupiedAttempt,
                    `${staffNamePrefix} Occupied Attempt`,
                    { mode: 'existing', id: staffId }
                ),
                actor,
                dbPool: pool
            }),
            error => error?.code === 'ACCOUNT_ONBOARDING_STAFF_OCCUPIED' && error?.statusCode === 409
        );
        const orphanUser = await pool.query('SELECT id FROM users WHERE username = $1', [usernames.occupiedAttempt]);
        assert.equal(orphanUser.rows.length, 0);
    });

    it('rejects a username matching an existing login alias and rolls the entire transaction back', async () => {
        const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 4);
        await pool.query(
            `INSERT INTO users (username, password_hash, name, role, login_aliases, is_active)
             VALUES ($1, $2, $3, 'animator', $4::text[], true)`,
            [
                usernames.aliasHolder,
                passwordHash,
                `${staffNamePrefix} Alias Holder`,
                [usernames.aliasCollision.toUpperCase()]
            ]
        );

        const statements = [];
        const dbPool = tracingPool(pool, statements);
        const name = `${staffNamePrefix} Alias Collision`;
        await assert.rejects(
            createAccountOnboarding({
                payload: onboardingPayload(usernames.aliasCollision, name),
                actor,
                dbPool
            }),
            error => error?.code === 'ACCOUNT_USERNAME_OCCUPIED' && error?.statusCode === 409
        );

        assert.deepEqual(
            statements.filter(statement => /^(BEGIN|COMMIT|ROLLBACK)$/.test(statement)),
            ['BEGIN', 'ROLLBACK']
        );
        const [holder, users, staff, profiles, audits] = await Promise.all([
            pool.query('SELECT id FROM users WHERE username = $1', [usernames.aliasHolder]),
            pool.query('SELECT id FROM users WHERE username = $1', [usernames.aliasCollision]),
            pool.query('SELECT id FROM staff WHERE name = $1', [name]),
            pool.query(
                `SELECT ep.id
                 FROM employee_profiles ep
                 LEFT JOIN users u ON u.id = ep.user_id
                 LEFT JOIN staff s ON s.id = ep.staff_id
                 WHERE u.username = $1 OR s.name = $2`,
                [usernames.aliasCollision, name]
            ),
            pool.query(
                'SELECT id FROM account_security_events WHERE target_username = $1',
                [usernames.aliasCollision]
            )
        ]);
        assert.equal(holder.rows.length, 1, 'the existing alias owner remains intact');
        assert.equal(users.rows.length, 0, 'alias collision leaves no user');
        assert.equal(staff.rows.length, 0, 'alias collision leaves no staff');
        assert.equal(profiles.rows.length, 0, 'alias collision leaves no account/staff link');
        assert.equal(audits.rows.length, 0, 'alias collision leaves no committed security audit');
    });

    it('rolls the entire transaction back when a later account write fails', async () => {
        const name = `${staffNamePrefix} Rollback`;
        const dbPool = faultingPool(pool, sql => /INSERT\s+INTO\s+users\s*\(/i.test(sql));
        await assert.rejects(
            createAccountOnboarding({
                payload: onboardingPayload(usernames.rollback, name),
                actor,
                dbPool
            }),
            /forced_account_onboarding_integration_failure/
        );

        const [users, staff, profiles, audits] = await Promise.all([
            pool.query('SELECT id FROM users WHERE username = $1', [usernames.rollback]),
            pool.query('SELECT id FROM staff WHERE name = $1', [name]),
            pool.query(
                `SELECT ep.id
                 FROM employee_profiles ep
                 LEFT JOIN users u ON u.id = ep.user_id
                 LEFT JOIN staff s ON s.id = ep.staff_id
                 WHERE u.username = $1 OR s.name = $2`,
                [usernames.rollback, name]
            ),
            pool.query(
                `SELECT ase.id
                 FROM account_security_events ase
                 WHERE ase.target_username = $1`,
                [usernames.rollback]
            )
        ]);
        assert.equal(users.rows.length, 0, 'failed transaction leaves no user');
        assert.equal(staff.rows.length, 0, 'failed transaction leaves no staff');
        assert.equal(profiles.rows.length, 0, 'failed transaction leaves no account/staff link');
        assert.equal(audits.rows.length, 0, 'failed transaction leaves no committed security audit');
    });
});
