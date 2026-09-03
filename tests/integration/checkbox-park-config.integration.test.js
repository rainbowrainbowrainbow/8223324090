const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../../db');
const { run } = require('../../scripts/configure-checkbox-park-pilot');
const {
    loadReadinessState,
    updateOperationalIncidentStatus
} = require('../../services/payments/paymentReadinessService');

const SHOULD_RUN = process.env.RUN_CHECKBOX_PARK_CONFIG_INTEGRATION === 'true';
let uniqueCounter = 0;

function unique(prefix) {
    uniqueCounter += 1;
    return `${prefix}_${process.pid}_${Date.now()}_${uniqueCounter}`.toLowerCase();
}

function deferred() {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function targetLockGate(dbPool, { attempted, acquired, release = null }) {
    return {
        async connect() {
            const client = await dbPool.connect();
            return {
                async query(sql, params) {
                    const isTargetLock = String(sql).includes('checkbox_pilot_config_target_lock');
                    if (isTargetLock) attempted?.resolve();
                    const result = await client.query(sql, params);
                    if (isTargetLock) {
                        acquired?.resolve();
                        if (release) await release.promise;
                    }
                    return result;
                },
                release() {
                    client.release();
                }
            };
        }
    };
}

async function seedUser() {
    const result = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, is_active)
         VALUES ($1, 'integration-test-hash', 'Checkbox config test cashier', 'creator', TRUE)
         RETURNING id`,
        [unique('checkbox_config_cashier')]
    );
    return Number(result.rows[0].id);
}

function fiscalConfigUser(userId, actions = ['payments.view', 'fiscal.configure'], role = 'creator') {
    return {
        id: Number(userId),
        username: `checkbox_config_actor_${userId}`,
        name: 'Checkbox config integration actor',
        role,
        action_allowlist: actions,
        actionAllowlist: actions,
        business_contexts: ['event_genix'],
        businessContexts: ['event_genix'],
        default_business_context: 'event_genix',
        defaultBusinessContext: 'event_genix'
    };
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

async function countRows(sql, params = []) {
    const result = await pool.query(sql, params);
    return Number(result.rows[0].count);
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
        '--integration-owner', String(userId),
        '--expected-is-test', 'true',
        '--actor-user-id', String(userId),
        '--reason', 'integration test config change'
    ];
    for (const code of ticketCodes) {
        args.push('--item', `${code}|Fiscal ${code}|taxed|7|1|0`);
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
        'fiscal.incident.manage',
        'fiscal.shift.close',
        'fiscal.shift.open',
        'payments.confirm_received',
        'payments.create',
        'payments.view'
    ].sort());

    const status = await run(['status', '--legal-entity-key', legalEntityKey], { env, dbPool: pool });
    assert.equal(status.status.found, true);
    assert.equal(status.status.featureEnabled, false);
    assert.equal(status.status.activeItemMappings.length, ticketCodes.length);
    const auditAfterApply = await pool.query(
        `SELECT command, before_hash, after_hash, reason, actor_user_id
           FROM fiscal_configuration_audit
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
          ORDER BY id`,
        [applied.fiscalProfileId, applied.fiscalRegisterId]
    );
    assert.equal(auditAfterApply.rowCount, 1);
    assert.equal(auditAfterApply.rows[0].command, 'apply');
    assert.ok(auditAfterApply.rows[0].before_hash);
    assert.ok(auditAfterApply.rows[0].after_hash);
    assert.equal(auditAfterApply.rows[0].reason, 'integration test config change');
    assert.equal(auditAfterApply.rows[0].actor_user_id == null ? false : true, true);

    await assert.rejects(
        () => pool.query('UPDATE fiscal_configuration_audit SET reason = $1 WHERE fiscal_profile_id = $2', ['mutated', applied.fiscalProfileId]),
        error => error.code === '55000'
    );
    await assert.rejects(
        () => pool.query('DELETE FROM fiscal_configuration_audit WHERE fiscal_profile_id = $1', [applied.fiscalProfileId]),
        error => error.code === '55000'
    );

    const taxedReadiness = await loadReadinessState({
        dbPool: pool,
        user: fiscalConfigUser(userId),
        crmProfileKey: 'event_genix',
        registerAlias: 'middle',
        checkboxIntegrationEnabled: false
    });
    assert.equal(taxedReadiness.taxMappingReady, true);
    assert.equal(taxedReadiness.missingTaxItemCodes.length, 0);

    await pool.query(
        `UPDATE fiscal_item_mappings
            SET tax_mode = 'untaxed',
                provider_tax_id = NULL,
                tax_code = NULL,
                tax_rate_bps = NULL
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2`,
        [applied.fiscalProfileId, applied.fiscalRegisterId]
    );
    const untaxedReadiness = await loadReadinessState({
        dbPool: pool,
        user: fiscalConfigUser(userId),
        crmProfileKey: 'event_genix',
        registerAlias: 'middle',
        checkboxIntegrationEnabled: false
    });
    assert.equal(untaxedReadiness.taxMappingReady, true, 'untaxed active admission items must not require a fabricated provider tax id');
    assert.equal(untaxedReadiness.missingTaxItemCodes.length, 0);

    await assert.rejects(
        () => pool.query(
            `UPDATE fiscal_item_mappings
                SET provider_tax_id = '7'
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND item_code = $3`,
            [applied.fiscalProfileId, applied.fiscalRegisterId, ticketCodes[0]]
        ),
        error => error.code === '23514'
    );

    await pool.query(
        `UPDATE fiscal_item_mappings
            SET tax_mode = 'taxed',
                provider_tax_id = '7',
                tax_code = 7,
                tax_rate_bps = 0
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2`,
        [applied.fiscalProfileId, applied.fiscalRegisterId]
    );

    const operation = await pool.query(
        `INSERT INTO fiscal_operations (
             fiscal_profile_id, fiscal_register_id, fiscal_location_id, operation_type, status,
             idempotency_key, provider, provider_operation_id, amount_minor, currency,
             request_fingerprint, request_snapshot,
             provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
             register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash
         )
         VALUES ($1, $2, $3, 'sale', 'pending', $4, 'checkbox', $5, 50000, 'UAH',
                 'fingerprint-test', '{"source":"integration"}'::jsonb,
                 $6, $7, $8, $9, $10, $11, TRUE, 'config-hash-test')
         RETURNING id`,
        [
            applied.fiscalProfileId,
            applied.fiscalRegisterId,
            applied.fiscalLocationId,
            `integration-operation:${legalEntityKey}`,
            `provider-operation:${legalEntityKey}`,
            `${legalEntityKey}_org`,
            `${legalEntityKey}_outlet`,
            `${legalEntityKey}_register`,
            `${legalEntityKey}_cashier`,
            `${legalEntityKey}_register_ref`,
            `${legalEntityKey}_cashier_ref`
        ]
    );
    const operationId = Number(operation.rows[0].id);
    await assert.rejects(
        () => pool.query('UPDATE fiscal_operations SET provider_operation_id = $1 WHERE id = $2', [`provider-operation-mutated:${legalEntityKey}`, operationId]),
        error => error.code === '55000'
    );
    await assert.rejects(
        () => pool.query('UPDATE fiscal_operations SET provider_register_id = $1 WHERE id = $2', [`register-mutated:${legalEntityKey}`, operationId]),
        error => error.code === '55000'
    );
    await assert.rejects(
        () => pool.query('DELETE FROM fiscal_operations WHERE id = $1', [operationId]),
        error => error.code === '55000'
    );

    const receipt = await pool.query(
        `INSERT INTO fiscal_receipts (
             fiscal_profile_id, fiscal_operation_id, receipt_type, status, provider,
             provider_receipt_id, total_amount_minor, currency, provider_snapshot
         )
         VALUES ($1, $2, 'sale', 'pending', 'checkbox', $3, 50000, 'UAH', '{"source":"integration"}'::jsonb)
         RETURNING id`,
        [applied.fiscalProfileId, operationId, `receipt:${legalEntityKey}`]
    );
    const receiptId = Number(receipt.rows[0].id);
    await assert.rejects(
        () => pool.query('UPDATE fiscal_receipts SET total_amount_minor = 40000 WHERE id = $1', [receiptId]),
        error => error.code === '55000'
    );
    await assert.rejects(
        () => pool.query('DELETE FROM fiscal_receipts WHERE id = $1', [receiptId]),
        error => error.code === '55000'
    );

    const incident = await pool.query(
        `INSERT INTO fiscal_operational_incidents (
             fiscal_profile_id, fiscal_register_id, fiscal_operation_id,
             severity, incident_type, status, idempotency_key, details
         )
         VALUES ($1, $2, $3, 'warning', 'checkbox.integration_regression', 'open', $4, '{"source":"integration"}'::jsonb)
         RETURNING id`,
        [
            applied.fiscalProfileId,
            applied.fiscalRegisterId,
            operationId,
            `incident:${legalEntityKey}`
        ]
    );
    const incidentId = Number(incident.rows[0].id);
    await assert.rejects(
        () => updateOperationalIncidentStatus({
            dbPool: pool,
            user: fiscalConfigUser(userId, ['fiscal.audit.view'], 'reception'),
            incidentId,
            status: 'acknowledged',
            reason: 'read-only user must not mutate incident'
        }),
        error => error.code === 'fiscal_capability_denied'
    );
    await pool.query(
        `UPDATE fiscal_cashier_bindings
            SET capability_scope = ARRAY(
                    SELECT DISTINCT value
                      FROM unnest(capability_scope || ARRAY['fiscal.incident.manage']::text[]) AS value
                )
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND user_id = $3`,
        [applied.fiscalProfileId, applied.fiscalRegisterId, userId]
    );
    await pool.query(
        `UPDATE fiscal_registers
            SET metadata = metadata || jsonb_build_object('integration_owner', 999999)
          WHERE id = $1`,
        [applied.fiscalRegisterId]
    );
    await assert.rejects(
        () => updateOperationalIncidentStatus({
            dbPool: pool,
            user: fiscalConfigUser(userId, ['payments.view', 'fiscal.incident.manage']),
            incidentId,
            status: 'acknowledged',
            reason: 'manager without exact ownership must not mutate incident'
        }),
        error => error.code === 'fiscal_incident_owner_denied'
    );
    await pool.query(
        `UPDATE fiscal_registers
            SET metadata = metadata || jsonb_build_object('integration_owner', $2::text)
          WHERE id = $1`,
        [applied.fiscalRegisterId, `checkbox_config_actor_${userId}`]
    );
    await assert.rejects(
        () => updateOperationalIncidentStatus({
            dbPool: pool,
            user: fiscalConfigUser(userId, ['payments.view', 'fiscal.incident.manage']),
            incidentId,
            status: 'acknowledged',
            reason: 'username must not substitute for exact integration owner id'
        }),
        error => error.code === 'fiscal_incident_owner_missing'
    );
    await pool.query(
        `UPDATE fiscal_registers
            SET metadata = metadata || jsonb_build_object('integration_owner', $2::text)
          WHERE id = $1`,
        [applied.fiscalRegisterId, String(userId)]
    );
    const acknowledged = await updateOperationalIncidentStatus({
        dbPool: pool,
        user: fiscalConfigUser(userId, ['payments.view', 'fiscal.incident.manage']),
        incidentId,
        status: 'acknowledged',
        reason: 'integration test acknowledge'
    });
    assert.equal(acknowledged.incident.status, 'acknowledged');
    assert.equal(
        await countRows(
            `SELECT COUNT(*)::integer AS count
               FROM fiscal_audit_events
              WHERE fiscal_profile_id = $1
                AND entity_table = 'fiscal_operational_incidents'
                AND entity_id = $2
                AND event_type = 'fiscal_incident_acknowledged'`,
            [applied.fiscalProfileId, incidentId]
        ),
        1
    );
    await pool.query(
        `UPDATE fiscal_registers
            SET metadata = metadata || jsonb_build_object('integration_owner', $2::text)
          WHERE id = $1`,
        [applied.fiscalRegisterId, String(userId)]
    );

    const enabled = await run(['enable-register', ...args], { env, dbPool: pool });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.featureEnabled, true);
    const disabled = await run(['disable-register', '--legal-entity-key', legalEntityKey, '--actor-user-id', String(userId), '--reason', 'integration test disable'], { env, dbPool: pool });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.featureEnabled, false);

    await pool.query('UPDATE fiscal_registers SET status = $1 WHERE id = $2', ['archived', applied.fiscalRegisterId]);
    await pool.query('UPDATE fiscal_profiles SET status = $1 WHERE id = $2', ['archived', applied.fiscalProfileId]);
});

test('concurrent generic config apply locks an absent target before re-read and refuses silent overwrite', { skip: !SHOULD_RUN }, async () => {
    const userId = await seedUser();
    const ticketCodes = await activeTicketCodes();
    const legalEntityKey = unique('park_fop_config_race');
    const firstArgs = argsFor({ userId, legalEntityKey, ticketCodes });
    const conflictingArgs = firstArgs.flatMap((arg, index, list) => {
        if (arg === '--provider-register-id') return ['--provider-register-id', `${legalEntityKey}_other_register`];
        return index > 0 && list[index - 1] === '--provider-register-id' ? [] : [arg];
    });
    const env = { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };
    const firstAttempted = deferred();
    const firstAcquired = deferred();
    const releaseFirst = deferred();
    const secondAttempted = deferred();
    const secondAcquired = deferred();
    let secondLockAcquired = false;
    secondAcquired.promise.then(() => {
        secondLockAcquired = true;
    });

    try {
        const firstApply = run(['apply', ...firstArgs], {
            env,
            dbPool: targetLockGate(pool, { attempted: firstAttempted, acquired: firstAcquired, release: releaseFirst })
        });
        await firstAcquired.promise;

        const secondApply = run(['apply', ...conflictingArgs], {
            env,
            dbPool: targetLockGate(pool, { attempted: secondAttempted, acquired: secondAcquired })
        }).then(
            value => ({ value, error: null }),
            error => ({ value: null, error })
        );
        await secondAttempted.promise;
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(secondLockAcquired, false, 'second create/apply must wait on the same absent-target lock');

        releaseFirst.resolve();
        const applied = await firstApply;
        const conflicting = await secondApply;
        assert.equal(conflicting.value, null);
        assert.equal(conflicting.error?.code, 'pilot_config_drift_requires_explicit_command');

        const stored = await run(['status', '--legal-entity-key', legalEntityKey], { env, dbPool: pool });
        assert.equal(stored.status.configSnapshot.providerRegisterId, `${legalEntityKey}_register`);
        assert.equal(stored.status.featureEnabled, false);
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_configuration_audit
                  WHERE fiscal_profile_id = $1
                    AND fiscal_register_id = $2`,
                [applied.fiscalProfileId, applied.fiscalRegisterId]
            ),
            1,
            'rejected concurrent plan must not append an audit or overwrite configuration'
        );

        const exactReplay = await run(['apply', ...firstArgs], { env, dbPool: pool });
        assert.equal(exactReplay.noChange, true, 'exact apply remains idempotent after serialized creation');
        assert.equal(exactReplay.fiscalRegisterId, applied.fiscalRegisterId);
    } finally {
        releaseFirst.resolve();
        await pool.query(
            `UPDATE fiscal_registers register
                SET status = 'archived'
               FROM fiscal_profiles profile
              WHERE register.fiscal_profile_id = profile.id
                AND profile.crm_profile_key = 'event_genix'
                AND profile.legal_entity_key = $1`,
            [legalEntityKey]
        ).catch(() => {});
        await pool.query(
            `UPDATE fiscal_profiles
                SET status = 'archived'
              WHERE crm_profile_key = 'event_genix'
                AND legal_entity_key = $1`,
            [legalEntityKey]
        ).catch(() => {});
    }
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
        () => run(['preflight', ...argsFor({ userId, legalEntityKey: unique('park_fop_other'), ticketCodes })], { env, dbPool: pool }),
        error => error.code === 'pilot_config_other_fop_register_conflict'
    );
});

test('credential prefix collision is serialized across concurrent PostgreSQL writers', { skip: !SHOULD_RUN }, async () => {
    const scope = await pool.query(
        `SELECT fr.fiscal_profile_id, fr.fiscal_location_id, fr.id AS fiscal_register_id, fr.crm_profile_key
           FROM fiscal_registers fr
          ORDER BY fr.id DESC
          LIMIT 1`
    );
    assert.equal(scope.rowCount, 1, 'configuration suite must create a fiscal register before the race test');
    const firstUserId = await seedUser();
    const secondUserId = await seedUser();
    const collisionBase = unique('credential-prefix-race');
    const firstRef = `${collisionBase}-shared`;
    const secondRef = `${collisionBase}_shared`;
    const first = await pool.connect();
    const second = await pool.connect();
    const row = scope.rows[0];
    const insertBinding = (client, userId, providerCashierId, credentialRef) => client.query(
        `INSERT INTO fiscal_cashier_bindings (
             fiscal_profile_id, fiscal_location_id, fiscal_register_id, crm_profile_key,
             user_id, provider, provider_cashier_id, provider_cashier_login_ref,
             status, capability_scope
         )
         VALUES ($1, $2, $3, $4, $5, 'checkbox', $6, $7, 'active', ARRAY['payments.view']::text[])`,
        [
            row.fiscal_profile_id,
            row.fiscal_location_id,
            row.fiscal_register_id,
            row.crm_profile_key,
            userId,
            providerCashierId,
            credentialRef
        ]
    );

    try {
        await first.query('BEGIN');
        await second.query('BEGIN');
        await insertBinding(first, firstUserId, `${collisionBase}-cashier-1`, firstRef);
        await second.query("SET LOCAL lock_timeout = '150ms'");
        await assert.rejects(
            () => insertBinding(second, secondUserId, `${collisionBase}-cashier-2`, secondRef),
            error => error.code === '55P03'
        );
        await second.query('ROLLBACK');
        await first.query('COMMIT');

        await second.query('BEGIN');
        await assert.rejects(
            () => insertBinding(second, secondUserId, `${collisionBase}-cashier-2`, secondRef),
            error => error.code === '23505'
        );
        await second.query('ROLLBACK');
    } finally {
        await first.query('ROLLBACK').catch(() => {});
        await second.query('ROLLBACK').catch(() => {});
        first.release();
        second.release();
    }
});

test('payment item insertion serializes with sealing of the same order', { skip: !SHOULD_RUN }, async () => {
    const scope = await pool.query(
        `SELECT fr.fiscal_profile_id, fr.id AS fiscal_register_id
           FROM fiscal_registers fr
          ORDER BY fr.id DESC
          LIMIT 1`
    );
    assert.equal(scope.rowCount, 1, 'configuration suite must create a fiscal register before the sealing race test');
    const cashierUserId = await seedUser();
    const identity = unique('payment-item-seal-race');
    const order = await pool.query(
        `INSERT INTO payment_orders (
             fiscal_profile_id, fiscal_register_id, cashier_user_id,
             source_type, source_id, order_key, idempotency_key,
             status, payment_status, fiscal_status, payment_method,
             total_amount_minor, currency, source_snapshot, created_by_user_id
         )
         VALUES ($1, $2, $3, 'admission_ticket', $4, $5, $6,
                 'draft', 'unpaid', 'pending', 'cash', 1000, 'UAH', '{}'::jsonb, $3)
         RETURNING id, fiscal_profile_id`,
        [scope.rows[0].fiscal_profile_id, scope.rows[0].fiscal_register_id, cashierUserId, identity, identity, identity]
    );
    const first = await pool.connect();
    const second = await pool.connect();
    try {
        await first.query('BEGIN');
        await second.query('BEGIN');
        await first.query(
            `INSERT INTO payment_order_items (
                 fiscal_profile_id, payment_order_id, line_number, item_type, item_code, item_name,
                 unit_price_minor, quantity_millis, total_amount_minor, currency,
                 provider_tax_id, tax_mode, item_snapshot
             )
             VALUES ($1, $2, 1, 'admission_ticket', 'race-item', 'Race item',
                     1000, 1000, 1000, 'UAH', NULL, 'untaxed', '{}'::jsonb)`,
            [order.rows[0].fiscal_profile_id, order.rows[0].id]
        );
        await second.query("SET LOCAL lock_timeout = '150ms'");
        await assert.rejects(
            () => second.query(
                `UPDATE payment_orders
                    SET status = 'confirmed',
                        payment_status = 'confirmed',
                        sealed_at = NOW(),
                        seal_fingerprint = $2
                  WHERE id = $1`,
                [order.rows[0].id, identity]
            ),
            error => error.code === '55P03'
        );
        await second.query('ROLLBACK');
        await first.query('ROLLBACK');
    } finally {
        await first.query('ROLLBACK').catch(() => {});
        await second.query('ROLLBACK').catch(() => {});
        first.release();
        second.release();
    }
});
