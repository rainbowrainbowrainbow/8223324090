const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../../db');
const { run } = require('../../scripts/configure-checkbox-park-pilot');

const SHOULD_RUN = process.env.RUN_CHECKBOX_PARK_CONFIG_INTEGRATION === 'true';

function unique(prefix) {
    return `${prefix}_${process.pid}_${Date.now()}`.toLowerCase();
}

async function seedUser() {
    const result = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, is_active)
         VALUES ($1, 'integration-test-hash', 'Checkbox config test cashier', 'admin', TRUE)
         RETURNING id`,
        [unique('checkbox_config_cashier')]
    );
    return Number(result.rows[0].id);
}

async function activeTicketCodes() {
    const result = await pool.query(
        `SELECT code
           FROM admission_ticket_types
          WHERE business_context = 'event_genix'
            AND is_active = TRUE
          ORDER BY code`
    );
    assert.ok(result.rows.length > 0, 'fresh DB must have active EventGenix admission ticket codes');
    return result.rows.map(row => row.code);
}

function argsFor({ userId, legalEntityKey, ticketCodes, overrides = {} }) {
    const args = [
        '--legal-entity-key', legalEntityKey,
        '--legal-entity-name', `${legalEntityKey} FOP`,
        '--tax-identifier', `${legalEntityKey}_tax`,
        '--provider-organization-id', `${legalEntityKey}_org`,
        '--location-name', 'Park',
        '--provider-outlet-id', `${legalEntityKey}_outlet`,
        '--register-name', 'Middle register',
        '--provider-register-id', `${legalEntityKey}_register`,
        '--provider-license-ref', `${legalEntityKey}_register_ref`,
        '--cashier-user-id', String(userId),
        '--provider-cashier-id', `${legalEntityKey}_cashier`,
        '--cashier-login-ref', `${legalEntityKey}_cashier_ref`,
        '--integration-owner', `${legalEntityKey}_owner`
    ];
    for (const code of ticketCodes) {
        args.push('--item', `${code}|Fiscal ${code}|7|1|0`);
    }
    for (const [key, value] of Object.entries(overrides)) {
        args.push(key, value);
    }
    return args;
}

test('park config CLI applies repeatable disabled mapping on real PostgreSQL constraints', { skip: !SHOULD_RUN }, async () => {
    const userId = await seedUser();
    const ticketCodes = await activeTicketCodes();
    const legalEntityKey = unique('park_fop_config');
    const args = argsFor({ userId, legalEntityKey, ticketCodes });
    const env = { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };

    const preflight = await run(['preflight', ...args], { env, dbPool: pool });
    assert.equal(preflight.ok, true);

    const applied = await run(['apply', ...args], { env, dbPool: pool });
    assert.equal(applied.applied, true);
    assert.equal(applied.featureEnabled, false);

    const second = await run(['apply', ...args], { env, dbPool: pool });
    assert.equal(second.applied, true);
    assert.equal(second.fiscalRegisterId, applied.fiscalRegisterId);

    const binding = await pool.query(
        `SELECT crm_profile_key, fiscal_location_id, provider_cashier_id, provider_cashier_login_ref,
                action_pin_hash, capability_scope
           FROM fiscal_cashier_bindings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND user_id = $3`,
        [applied.fiscalProfileId, applied.fiscalRegisterId, userId]
    );
    assert.equal(binding.rowCount, 1);
    assert.equal(binding.rows[0].crm_profile_key, 'event_genix');
    assert.ok(Number(binding.rows[0].fiscal_location_id) > 0);
    assert.equal(binding.rows[0].provider_cashier_id, `${legalEntityKey}_cashier`);
    assert.equal(binding.rows[0].provider_cashier_login_ref, `${legalEntityKey}_cashier_ref`);
    assert.equal(binding.rows[0].action_pin_hash, null, 'thin MVP binding must not require action PIN');
    assert.deepEqual(binding.rows[0].capability_scope.sort(), [
        'fiscal.shift.open',
        'payments.confirm_received',
        'payments.create',
        'payments.view'
    ].sort());

    const status = await run(['status', '--legal-entity-key', legalEntityKey], { env, dbPool: pool });
    assert.equal(status.status.found, true);
    assert.equal(status.status.featureEnabled, false);
    assert.equal(status.status.activeItemMappings.length, ticketCodes.length);

    const enabled = await run(['enable-register', ...args], { env, dbPool: pool });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.featureEnabled, true);
    const disabled = await run(['disable-register', '--legal-entity-key', legalEntityKey], { env, dbPool: pool });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.featureEnabled, false);

    await pool.query('UPDATE fiscal_registers SET status = $1 WHERE id = $2', ['archived', applied.fiscalRegisterId]);
    await pool.query('UPDATE fiscal_profiles SET status = $1 WHERE id = $2', ['archived', applied.fiscalProfileId]);
});

test('park config preflight rejects wrong user, missing mapping, and second FOP for middle register', { skip: !SHOULD_RUN }, async () => {
    const userId = await seedUser();
    const ticketCodes = await activeTicketCodes();
    const legalEntityKey = unique('park_fop_conflict');
    const args = argsFor({ userId, legalEntityKey, ticketCodes });
    const env = { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };

    const missingUser = await run(['preflight', ...argsFor({ userId: 99999999, legalEntityKey: unique('park_fop_missing_user'), ticketCodes })], { env, dbPool: pool });
    assert.equal(missingUser.ok, false);
    assert.equal(missingUser.preflight.checks.find(check => check.code === 'users_exist').ok, false);

    const incomplete = await run(['preflight', ...argsFor({ userId, legalEntityKey: unique('park_fop_missing_mapping'), ticketCodes: ticketCodes.slice(0, -1) })], { env, dbPool: pool });
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.preflight.checks.find(check => check.code === 'item_mappings_complete').ok, false);

    await run(['apply', ...args], { env, dbPool: pool });
    await assert.rejects(
        () => run(['apply', ...argsFor({ userId, legalEntityKey: unique('park_fop_other'), ticketCodes })], { env, dbPool: pool }),
        error => error.code === 'pilot_config_other_fop_register_conflict'
    );
});
