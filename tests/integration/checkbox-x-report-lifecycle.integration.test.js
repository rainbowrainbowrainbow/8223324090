/**
 * Fresh PostgreSQL proof for durable Checkbox X-report lifecycle storage.
 *
 * Run only through:
 *   npm run test:integration:checkbox-x-report:isolated
 */
'use strict';

const crypto = require('node:crypto');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

const enabled = process.env.RUN_CHECKBOX_X_REPORT_LIFECYCLE_INTEGRATION === 'true';

let pool;

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_CHECKBOX_X_REPORT_LIFECYCLE_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL);
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

async function queryScalar(client, sql, params = []) {
    const result = await client.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : null;
}

async function assertRejectedWithCode(promise, code) {
    await assert.rejects(promise, error => error && error.code === code);
}

async function createFiscalFixture(client) {
    const suffix = crypto.randomBytes(8).toString('hex');
    const user = await client.query(
        `INSERT INTO users (
             username, password_hash, role, name, is_active,
             action_allowlist, business_contexts, default_business_context
         )
         VALUES ($1, 'synthetic-fixture-not-a-secret', 'reception', 'X Report Fixture', TRUE,
                 ARRAY['payments.view','fiscal.shift.open','fiscal.shift.close'],
                 ARRAY['event_genix'], 'event_genix')
         RETURNING id`,
        [`x-report-fixture-${suffix}`]
    );
    const profile = await client.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name,
             provider, provider_organization_id, status
         )
         VALUES ($1, $2, 'X Report Fixture Legal', 'checkbox', $3, 'active')
         RETURNING id`,
        [`x_report_${suffix.replaceAll('-', '_')}`, `x_report_legal_${suffix.replaceAll('-', '_')}`, `org-${suffix}`]
    );
    const location = await client.query(
        `INSERT INTO fiscal_locations (
             fiscal_profile_id, crm_profile_key, location_alias,
             display_name, provider_outlet_id, status
         )
         VALUES ($1, $2, 'fixture_location', 'Fixture Location', $3, 'active')
         RETURNING id`,
        [profile.rows[0].id, `x_report_${suffix.replaceAll('-', '_')}`, `outlet-${suffix}`]
    );
    const register = await client.query(
        `INSERT INTO fiscal_registers (
             fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
             display_name, provider, provider_register_id, provider_license_ref,
             status, feature_enabled, acceptance_enabled, metadata
         )
         VALUES ($1, $2, $3, 'fixture_register', 'Fixture Register',
                 'checkbox', $4, $5, 'active', TRUE, TRUE, $6::jsonb)
         RETURNING id`,
        [
            profile.rows[0].id,
            location.rows[0].id,
            `x_report_${suffix.replaceAll('-', '_')}`,
            `reg-${suffix}`,
            `license-ref-${suffix}`,
            JSON.stringify({ expected_is_test: true })
        ]
    );
    const binding = await client.query(
        `INSERT INTO fiscal_cashier_bindings (
             fiscal_profile_id, fiscal_location_id, fiscal_register_id, user_id,
             provider, provider_cashier_id, provider_cashier_login_ref,
             status, crm_profile_key, capability_scope
         )
         VALUES ($1, $2, $3, $4, 'checkbox', $5, $6, 'active', $7,
                 ARRAY['payments.view','fiscal.shift.open','fiscal.shift.close'])
         RETURNING id`,
        [
            profile.rows[0].id,
            location.rows[0].id,
            register.rows[0].id,
            user.rows[0].id,
            `cashier-${suffix}`,
            `cashier-ref-${suffix}`,
            `x_report_${suffix.replaceAll('-', '_')}`
        ]
    );
    const shift = await client.query(
        `INSERT INTO fiscal_shifts (
             fiscal_profile_id, fiscal_register_id, provider, provider_shift_id,
             status, lifecycle_stage, opened_by_user_id, opened_at,
             provider_opened_at, provider_snapshot, business_context
         )
         VALUES ($1, $2, 'checkbox', $3, 'open', 'OPENED', $4, NOW(), NOW(), $5::jsonb, 'event_genix')
         RETURNING id`,
        [
            profile.rows[0].id,
            register.rows[0].id,
            `shift-${suffix}`,
            user.rows[0].id,
            JSON.stringify({ fixture: 'x-report-lifecycle' })
        ]
    );
    const openOperation = await client.query(
        `INSERT INTO fiscal_operations (
             fiscal_profile_id, fiscal_register_id, fiscal_shift_id, fiscal_location_id,
             operation_type, status, idempotency_key, provider, provider_operation_id,
             provider_status, currency, request_snapshot, response_snapshot,
             initiated_by_user_id, provider_organization_id, provider_outlet_id,
             provider_register_id, provider_cashier_id, register_credential_ref,
             cashier_credential_ref, expected_is_test, fiscal_configuration_hash, external_stage,
             sent_at, completed_at
         )
         VALUES ($1, $2, $3, $4, 'shift_open', 'fiscalized', $5, 'checkbox', $6,
                 'OPENED', 'UAH', $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13,
                 $14, $15, TRUE, $16, 'auth', NOW(), NOW())
         RETURNING id`,
        [
            profile.rows[0].id,
            register.rows[0].id,
            shift.rows[0].id,
            location.rows[0].id,
            `x-report-open:${shift.rows[0].id}:${suffix}`,
            `open-op-${suffix}`,
            JSON.stringify({ provider_request_uuid: crypto.randomUUID() }),
            JSON.stringify({ status: 'OPENED' }),
            user.rows[0].id,
            `org-${suffix}`,
            `outlet-${suffix}`,
            `reg-${suffix}`,
            `cashier-${suffix}`,
            `license-ref-${suffix}`,
            `cashier-ref-${suffix}`,
            crypto.createHash('sha256').update(`x-report-${suffix}`).digest('hex')
        ]
    );
    await client.query(
        `UPDATE fiscal_shifts
            SET open_operation_id = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [shift.rows[0].id, openOperation.rows[0].id]
    );

    return {
        suffix,
        userId: Number(user.rows[0].id),
        fiscalProfileId: Number(profile.rows[0].id),
        fiscalLocationId: Number(location.rows[0].id),
        fiscalRegisterId: Number(register.rows[0].id),
        fiscalShiftId: Number(shift.rows[0].id),
        cashierBindingId: Number(binding.rows[0].id),
        providerOrganizationId: `org-${suffix}`,
        providerOutletId: `outlet-${suffix}`,
        providerRegisterId: `reg-${suffix}`,
        providerCashierId: `cashier-${suffix}`,
        registerCredentialRef: `license-ref-${suffix}`,
        cashierCredentialRef: `cashier-ref-${suffix}`
    };
}

async function insertXReportRequest(client, fixture, overrides = {}) {
    const idempotencyKey = overrides.idempotencyKey || `x-report:${fixture.fiscalShiftId}:${crypto.randomUUID()}`;
    const result = await client.query(
        `INSERT INTO fiscal_x_report_requests (
             fiscal_profile_id, fiscal_location_id, fiscal_register_id,
             fiscal_shift_id, fiscal_cashier_binding_id, requested_by_user_id,
             provider, status, idempotency_key, provider_request_uuid,
             provider_report_id, provider_shift_id, provider_register_id,
             provider_cashier_id, provider_organization_id, register_credential_ref,
             cashier_credential_ref, expected_is_test, request_snapshot,
             provider_snapshot, external_stage, attempted_at, submitted_at,
             completed_at, next_reconcile_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'checkbox', $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, TRUE, $17::jsonb, $18::jsonb, $19, $20, $21, $22, $23)
         RETURNING *`,
        [
            fixture.fiscalProfileId,
            fixture.fiscalLocationId,
            fixture.fiscalRegisterId,
            fixture.fiscalShiftId,
            fixture.cashierBindingId,
            fixture.userId,
            overrides.status || 'pending',
            idempotencyKey,
            overrides.providerRequestUuid || crypto.randomUUID(),
            overrides.providerReportId || null,
            `shift-${fixture.suffix}`,
            fixture.providerRegisterId,
            fixture.providerCashierId,
            fixture.providerOrganizationId,
            fixture.registerCredentialRef,
            fixture.cashierCredentialRef,
            JSON.stringify(overrides.requestSnapshot || { fixture: 'x-report-lifecycle' }),
            JSON.stringify(overrides.providerSnapshot || {}),
            overrides.externalStage || 'created',
            overrides.attemptedAt || null,
            overrides.submittedAt || null,
            overrides.completedAt || null,
            overrides.nextReconcileAt || null
        ]
    );
    return result.rows[0];
}

before(() => {
    const testDb = requireIsolatedDatabase();
    pool = new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 3
    });
});

after(async () => {
    await pool?.end();
});

test('migration installs durable X-report lifecycle storage and constraints', async () => {
    const migrationApplied = await queryScalar(
        pool,
        `SELECT EXISTS (
             SELECT 1 FROM schema_migrations WHERE version = '358_checkbox_x_report_lifecycle'
         )`
    );
    assert.equal(migrationApplied, true);

    const tableExists = await queryScalar(pool, `SELECT to_regclass('public.fiscal_x_report_requests') IS NOT NULL`);
    assert.equal(tableExists, true);

    const fixture = await createFiscalFixture(pool);
    const request = await insertXReportRequest(pool, fixture, {
        idempotencyKey: `x-report:${fixture.fiscalShiftId}:stable`
    });
    assert.equal(request.status, 'pending');

    await assertRejectedWithCode(
        insertXReportRequest(pool, fixture, {
            idempotencyKey: `x-report:${fixture.fiscalShiftId}:stable`
        }),
        '23505'
    );

    await assertRejectedWithCode(
        insertXReportRequest(pool, fixture, {
            status: 'succeeded',
            completedAt: new Date().toISOString()
        }),
        '23514'
    );

    await pool.query(
        `UPDATE fiscal_x_report_requests
            SET status = 'unknown',
                external_stage = 'provider_response_lost',
                last_error_code = 'provider_response_unknown',
                last_error_message = 'Synthetic lost response',
                next_reconcile_at = NOW()
          WHERE id = $1`,
        [request.id]
    );

    const restartPool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
        max: 1
    });
    try {
        const persisted = await restartPool.query(
            `SELECT status, external_stage, last_error_code
               FROM fiscal_x_report_requests
              WHERE fiscal_profile_id = $1
                AND idempotency_key = $2`,
            [fixture.fiscalProfileId, `x-report:${fixture.fiscalShiftId}:stable`]
        );
        assert.equal(persisted.rowCount, 1);
        assert.equal(persisted.rows[0].status, 'unknown');
        assert.equal(persisted.rows[0].external_stage, 'provider_response_lost');
        assert.equal(persisted.rows[0].last_error_code, 'provider_response_unknown');
    } finally {
        await restartPool.end();
    }

    await pool.query(
        `UPDATE fiscal_x_report_requests
            SET status = 'succeeded',
                external_stage = 'report_confirmed',
                provider_report_id = $2,
                provider_snapshot = $3::jsonb,
                completed_at = NOW(),
                next_reconcile_at = NULL
          WHERE id = $1`,
        [
            request.id,
            `report-${fixture.suffix}`,
            JSON.stringify({ id: `report-${fixture.suffix}`, serial: 1 })
        ]
    );

    const succeeded = await pool.query(
        `SELECT status, provider_report_id, completed_at IS NOT NULL AS completed
           FROM fiscal_x_report_requests
          WHERE id = $1`,
        [request.id]
    );
    assert.equal(succeeded.rows[0].status, 'succeeded');
    assert.equal(succeeded.rows[0].provider_report_id, `report-${fixture.suffix}`);
    assert.equal(succeeded.rows[0].completed, true);

    await assertRejectedWithCode(
        insertXReportRequest(pool, fixture, {
            providerReportId: `report-${fixture.suffix}`
        }),
        '23505'
    );

    await assertRejectedWithCode(
        insertXReportRequest(pool, {
            ...fixture,
            fiscalRegisterId: fixture.fiscalRegisterId + 999999
        }),
        '23503'
    );
});
