'use strict';

const crypto = require('node:crypto');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { createAccountOnboarding, resolveAccountBusinessAccess } = require('../../services/accountOnboarding');
const { loadMembershipAccess } = require('../../services/businessMembership');
const { syncLinkedStaffAccountDeactivation } = require('../../services/staffLifecycle');
const { lockOrganizationOwnership } = require('../../services/organizationOwnership');
const { authRequest, request } = require('../helpers');

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
    rollback: `${usernamePrefix}.rollback`,
    lookupFailure: `${usernamePrefix}.lookup`
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
            if (predicate(String(sql))) {
                const error = new Error('forced_account_onboarding_integration_failure');
                error.code = 'XX000';
                throw error;
            }
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
            statements.push(String(sql).replace(/\s+/g, ' ').trim());
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

    it('projects real registry and membership states without writing access or trusting legacy contexts', async t => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const fixtureKey = 'qa_read_' + crypto.randomBytes(8).toString('hex');
            const organization = await client.query(
                'INSERT INTO organizations (slug, name) VALUES ($1, $2), ($3, $4) RETURNING id',
                [fixtureKey, 'Disposable readiness organization', fixtureKey + '_other', 'Disposable foreign organization']
            );
            const [organizationId, foreignOrganizationId] = organization.rows.map(row => Number(row.id));
            const businesses = await client.query(
                `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode)
                 VALUES ($1, $3, 'Readiness target', 'Target', 'membership'),
                        ($1, $4, 'Different business', 'Other', 'membership'),
                        ($2, $5, 'Foreign business', 'Foreign', 'membership') RETURNING id`,
                [organizationId, foreignOrganizationId, fixtureKey, fixtureKey + '_other', fixtureKey + '_foreign']
            );
            const [businessId, otherBusinessId, foreignBusinessId] = businesses.rows.map(row => Number(row.id));
            const users = await client.query(
                `INSERT INTO users (username, password_hash, name, role, is_active, business_contexts, default_business_context)
                 VALUES ($1, 'unusable-test-hash', 'Readiness fixture', 'animator', true, ARRAY[$3], $3),
                        ($2, 'unusable-test-hash', 'Other readiness fixture', 'animator', true, ARRAY[$3], $3)
                 RETURNING id`,
                [fixtureKey, fixtureKey + '_other', fixtureKey]
            );
            const [userId, otherUserId] = users.rows.map(row => Number(row.id));
            await client.query(
                'INSERT INTO organization_memberships (organization_id, user_id) VALUES ($1, $3), ($2, $3)',
                [organizationId, foreignOrganizationId, userId]
            );
            await client.query(
                `INSERT INTO business_memberships (business_id, organization_id, user_id, role)
                 VALUES ($1, $2, $3, 'animator'), ($4, $5, $3, 'animator')`,
                [businessId, organizationId, userId, foreignBusinessId, foreignOrganizationId]
            );
            const cases = [
                ['active selected business with multiple organizations', 'active', null, [], true],
                ['missing business membership despite legacy profile contexts', 'pending_membership',
                    'DELETE FROM business_memberships WHERE business_id = $1 AND user_id = $2', [businessId, userId], false],
                ['missing organization membership', 'pending_membership',
                    'DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2', [organizationId, userId], false],
                ['revoked business membership', 'pending_membership',
                    'UPDATE business_memberships SET is_active = false WHERE business_id = $1 AND user_id = $2', [businessId, userId], false],
                ['revoked organization membership', 'pending_membership',
                    'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2', [organizationId, userId], false],
                ['different business membership is not target access', 'pending_membership',
                    'UPDATE business_memberships SET business_id = $1 WHERE business_id = $2 AND user_id = $3', [otherBusinessId, businessId, userId], false],
                ['another account membership is not target access', 'pending_membership',
                    'UPDATE business_memberships SET user_id = $1 WHERE business_id = $2 AND user_id = $3', [otherUserId, businessId, userId], false],
                ['membership organization disagrees with registry', 'unknown',
                    'UPDATE businesses SET organization_id = $1 WHERE id = $2', [foreignOrganizationId, businessId], null],
                ['inactive business', 'unknown',
                    "UPDATE businesses SET status = 'inactive' WHERE id = $1", [businessId], false],
                ['inactive organization', 'unknown',
                    "UPDATE organizations SET status = 'inactive' WHERE id = $1", [organizationId], false],
                ['inactive account', 'unknown',
                    'UPDATE users SET is_active = false WHERE id = $1', [userId], null],
                ['compatibility business is not membership proof', 'unknown',
                    "UPDATE businesses SET access_mode = 'compatibility' WHERE id = $1", [businessId], null],
                ['business creator without platform creator', 'unknown',
                    "UPDATE business_memberships SET role = 'creator' WHERE business_id = $1 AND user_id = $2", [businessId, userId], false],
                ['valid platform creator', 'active',
                    "UPDATE users SET role = 'creator' WHERE id = $1", [userId], true]
            ];
            for (const [name, expectedState, mutation, params, canonicalReady] of cases) {
                await t.test(name, async () => {
                    await client.query('SAVEPOINT readiness_case');
                    try {
                        if (mutation) await client.query(mutation, params);
                        if (name === 'valid platform creator') {
                            await client.query("UPDATE business_memberships SET role = 'creator' WHERE business_id = $1 AND user_id = $2", [businessId, userId]);
                        }
                        const statements = [];
                        const result = await resolveAccountBusinessAccess({
                            query(sql, values) {
                                statements.push(String(sql));
                                return client.query(sql, values);
                            }
                        }, userId, fixtureKey);
                        assert.deepEqual(result, { businessAccessReady: expectedState === 'active', accessState: expectedState });
                        assert.equal(statements.length, 1, 'status uses one database snapshot');
                        assert.ok(statements.every(sql => /^\s*SELECT\b/i.test(sql)), 'status issues only reads');
                        if (canonicalReady !== null) {
                            const account = await client.query('SELECT id, role FROM users WHERE id = $1', [userId]);
                            const access = await loadMembershipAccess(client, account.rows[0], fixtureKey);
                            assert.equal(access.membershipEnabled && !access.invalid && Boolean(access.activeMembership), canonicalReady);
                            assert.equal(result.businessAccessReady, canonicalReady, 'projection follows the canonical membership decision');
                        }
                    } finally {
                        await client.query('ROLLBACK TO SAVEPOINT readiness_case');
                        await client.query('RELEASE SAVEPOINT readiness_case');
                    }
                });
            }
            assert.deepEqual(await resolveAccountBusinessAccess(client, userId, fixtureKey + '_missing'), {
                businessAccessReady: false, accessState: 'unknown'
            });
            assert.deepEqual(await resolveAccountBusinessAccess(client, 0, fixtureKey), {
                businessAccessReady: false, accessState: 'unknown'
            });
        } finally {
            try { await client.query('ROLLBACK'); } finally { client.release(); }
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
        const statements = [];
        const dbPool = tracingPool(pool, statements);
        const result = await createAccountOnboarding({
            payload,
            actor,
            dbPool
        });

        assert.equal(result.loginReady, true);
        assert.equal(typeof result.businessAccessReady, 'boolean');
        assert.ok(['active', 'pending_membership', 'unknown'].includes(result.accessState));
        assert.equal(result.receipt.access.businessAccessReady, result.businessAccessReady);
        assert.equal(result.receipt.access.accessState, result.accessState);
        assert.equal(statements.some(statement => /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(organization_memberships|business_memberships)/i.test(statement)), false);
        const businessReadIndex = statements.findIndex(statement => /FROM users u LEFT JOIN businesses b/.test(statement));
        assert.ok(businessReadIndex > statements.indexOf('COMMIT'), 'readiness is checked after account COMMIT');
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

        const memberships = await pool.query(
            `SELECT
                (SELECT COUNT(*)::int FROM organization_memberships WHERE user_id = $1) AS organization_count,
                (SELECT COUNT(*)::int FROM business_memberships WHERE user_id = $1) AS business_count`,
            [persisted.rows[0].user_id]
        );
        assert.equal(memberships.rows[0].organization_count, 0);
        assert.equal(memberships.rows[0].business_count, 0);
        const registry = await pool.query(
            `SELECT b.status AS business_status, b.access_mode, o.status AS organization_status
             FROM businesses b
             JOIN organizations o ON o.id = b.organization_id
             WHERE b.context_key = $1`,
            [result.receipt.access.defaultBusinessContext]
        );
        const targetIsMembershipBusiness = registry.rows[0]?.business_status === 'active'
            && registry.rows[0]?.organization_status === 'active'
            && registry.rows[0]?.access_mode === 'membership';
        assert.equal(result.accessState, targetIsMembershipBusiness ? 'pending_membership' : 'unknown');

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

    it('preserves the committed credential when the post-commit registry lookup fails', async () => {
        const result = await createAccountOnboarding({
            payload: onboardingPayload(usernames.lookupFailure, `${staffNamePrefix} Lookup Failure`),
            actor,
            dbPool: faultingPool(pool, sql => /FROM\s+users\s+u\s+LEFT\s+JOIN\s+businesses\s+b\s+ON\s+b\.context_key\s*=\s*\$2/i.test(sql))
        });
        assert.equal(result.loginReady, true);
        assert.equal(result.businessAccessReady, false);
        assert.equal(result.accessState, 'unknown');
        assert.ok(result.credential.password);
        assert.ok(result.receipt.warnings.some(item => item.code === 'BUSINESS_ACCESS_STATUS_UNKNOWN'));
        const persisted = await pool.query('SELECT id FROM users WHERE username = $1', [usernames.lookupFailure]);
        assert.equal(persisted.rows.length, 1);
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
        const statements = [];
        const dbPool = tracingPool(faultingPool(pool, sql => /INSERT\s+INTO\s+users\s*\(/i.test(sql)), statements);
        await assert.rejects(
            createAccountOnboarding({
                payload: onboardingPayload(usernames.rollback, name),
                actor,
                dbPool
            }),
            /forced_account_onboarding_integration_failure/
        );
        assert.ok(statements.includes('ROLLBACK'));
        assert.equal(statements.includes('COMMIT'), false);
        assert.equal(statements.some(sql => /FROM users u LEFT JOIN businesses b/.test(sql)), false, 'rollback skips post-commit readiness');
        assert.equal(statements.some(sql => /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(organization_memberships|business_memberships)/i.test(sql)), false);

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

    it('offboarding atomically disables the linked account and rejects its existing and new sessions', async () => {
        const fixture = await createAccountOnboarding({
            payload: onboardingPayload(`${usernamePrefix}.off`, `${staffNamePrefix} Offboarding`),
            actor,
            dbPool: pool
        });
        const userId = Number(fixture.user.id);
        const staffId = Number(fixture.staff.id);
        const login = await request('POST', '/api/auth/login', fixture.credential);
        assert.equal(login.status, 200, 'fixture credentials can log in before dismissal');
        assert.ok(login.data.accessToken && login.data.refreshToken, 'login issues both session tokens');

        const dismissed = await authRequest('POST', `/api/hr/staff/${staffId}/offboarding`, {
            effective_date: new Date().toISOString().slice(0, 10),
            reason: 'Disposable offboarding regression',
            target_pool_status: 'reserve',
            account_action: 'review'
        });
        assert.equal(dismissed.status, 200, `offboarding: ${dismissed.data?.error || dismissed.data?.code || ''}`);
        assert.equal(dismissed.data.disabled_accounts, 1);
        assert.equal(dismissed.data.data.account_action, 'disable', 'legacy review cannot retain account access');

        const persisted = await pool.query(
            `SELECT u.is_active AS account_active, u.session_revoked_at,
                    ep.is_active AS profile_active, s.is_active AS staff_active,
                    s.termination_date
             FROM users u
             JOIN employee_profiles ep ON ep.user_id = u.id
             JOIN staff s ON s.id = ep.staff_id
             WHERE u.id = $1 AND s.id = $2`,
            [userId, staffId]
        );
        assert.equal(persisted.rows.length, 1);
        const state = persisted.rows[0];
        assert.equal(state.account_active, false);
        assert.equal(state.profile_active, false);
        assert.equal(state.staff_active, false);
        assert.ok(state.session_revoked_at);
        assert.ok(state.termination_date);
        const tokens = await pool.query('SELECT revoked_at FROM refresh_tokens WHERE user_id = $1', [userId]);
        assert.ok(tokens.rows.length > 0);
        assert.ok(tokens.rows.every(row => row.revoked_at), 'every existing refresh session is revoked');
        const audit = await pool.query(
            `SELECT details FROM account_security_events
             WHERE target_user_id = $1 AND event_type = 'account_deactivated'`,
            [userId]
        );
        assert.equal(audit.rows.length, 1);
        assert.equal(Number(audit.rows[0].details.staffId), staffId);
        assert.equal(audit.rows[0].details.sessionsRevoked, true);
        assert.equal(audit.rows[0].details.source, 'hr_staff_offboarding');
        assert.equal(Number(audit.rows[0].details.offboardingEventId), Number(dismissed.data.data.id));
        assert.deepEqual(findSensitiveAuditKeys(audit.rows), []);

        const notice = 'Ваш акаунт деактивовано. Зверніться до адміністратора.';
        const verified = await request('GET', '/api/auth/verify', undefined, login.data.accessToken);
        assert.equal(verified.status, 401);
        assert.equal(verified.data.code, 'auth_user_deactivated');
        assert.equal(verified.data.error, notice);
        const refreshed = await request('POST', '/api/auth/refresh', { refreshToken: login.data.refreshToken });
        assert.equal(refreshed.status, 401);
        assert.equal(refreshed.data.code, 'refresh_user_inactive');
        assert.equal(refreshed.data.error, notice);
        const relogin = await request('POST', '/api/auth/login', fixture.credential);
        assert.equal(relogin.status, 401);
        assert.equal(relogin.data.code, 'auth_user_deactivated');
        assert.equal(relogin.data.error, notice);
        const incorrect = await request('POST', '/api/auth/login', {
            username: fixture.credential.username,
            password: crypto.randomBytes(24).toString('base64url')
        });
        assert.equal(incorrect.status, 401);
        assert.equal(incorrect.data.code, undefined, 'incorrect password cannot reveal disabled-account status');

        const accounts = await authRequest('GET', '/api/users');
        assert.equal(accounts.status, 200);
        const account = accounts.data.find(row => Number(row.id) === userId);
        assert.ok(account, 'disabled linked account remains available to the staff-card account lookup');
        assert.equal(Number(account.staff_id), staffId);
        assert.equal(account.is_active, false);
        assert.equal(account.profile_active, false);
    });

    it('rolls staff, profile, account and token changes back on a real PostgreSQL security-audit failure', async () => {
        const fixture = await createAccountOnboarding({
            payload: onboardingPayload(`${usernamePrefix}.offrb`, `${staffNamePrefix} Offboarding Rollback`),
            actor,
            dbPool: pool
        });
        const userId = Number(fixture.user.id);
        const staffId = Number(fixture.staff.id);
        const tokenHash = crypto.randomBytes(32).toString('hex');
        await pool.query(
            `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
            [userId, tokenHash]
        );
        const readState = async () => (await pool.query(
            `SELECT u.is_active AS account_active, u.session_revoked_at,
                    ep.is_active AS profile_active, s.is_active AS staff_active,
                    rt.revoked_at,
                    (SELECT COUNT(*)::int FROM account_security_events ase
                     WHERE ase.target_user_id = u.id AND ase.event_type = 'account_deactivated') AS deactivation_audits
             FROM users u
             JOIN employee_profiles ep ON ep.user_id = u.id
             JOIN staff s ON s.id = ep.staff_id
             JOIN refresh_tokens rt ON rt.user_id = u.id AND rt.token_hash = $2
             WHERE u.id = $1`,
            [userId, tokenHash]
        )).rows;
        const before = await readState();
        assert.equal(before.length, 1);
        assert.equal(before[0].account_active, true);
        assert.equal(before[0].revoked_at, null);
        const missingActorId = -2147483648;
        assert.equal((await pool.query('SELECT id FROM users WHERE id = $1', [missingActorId])).rowCount, 0);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await lockOrganizationOwnership(client);
            await client.query('UPDATE staff SET is_active = false WHERE id = $1', [staffId]);
            // The real audit INSERT fails its actor foreign key after all lifecycle writes.
            await assert.rejects(syncLinkedStaffAccountDeactivation(client, staffId, {
                actor: { ...actor, id: missingActorId },
                requireAllAccountsDisabled: true,
                canDisableAccount: account => Number(account.id) === userId,
                reason: 'disposable_offboarding_rollback',
                source: 'postgres_regression'
            }), error => error.code === '23503' && error.table === 'account_security_events');
            await client.query('ROLLBACK');
        } finally {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
        }
        assert.deepEqual(await readState(), before, 'failed audit must leave no committed deactivation or session revocation');
    });
});
