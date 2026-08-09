'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    minorUnitsToUahDecimal,
    normalizeMinorUnits,
    sumMinorUnits,
    toPostgresBigint,
    uahDecimalToMinorUnits
} = require('../services/payments/money');
const {
    allowedNextStates,
    assertTransition,
    canTransition
} = require('../services/payments/stateTransitions');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
    ROOT,
    'db',
    'migrations',
    '316_payment_fiscal_ledger_foundation.sql'
);
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const migration329 = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '329_checkbox_immutability_and_config_actor_guards.sql'), 'utf8');
const migrationSql = migration
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ');

test('migration 316 is governed, additive, and independent from legacy payment sources', () => {
    assert.match(migration, /-- MIGRATION_KIND:\s*schema/i);
    assert.match(migration, /-- SAFETY:/i);
    assert.match(migration, /-- ROLLBACK:/i);

    assert.doesNotMatch(migrationSql, /\bUPDATE\s+[a-z_][a-z0-9_]*\s+SET\b/i);
    assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(migrationSql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migrationSql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(migrationSql, /\bfinance_transactions\b/i);
    assert.doesNotMatch(migrationSql, /\bbookings\b/i);
    assert.doesNotMatch(migrationSql, /\bpaid_amount\b/i);
    assert.doesNotMatch(migrationSql, /\bcash_register_shifts\b/i);
    assert.doesNotMatch(migrationSql, /\breceipts\s*\(/i);
});

test('migration 316 creates the complete fiscal/payment ledger table set', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS fiscal_profiles\b/);

    for (const table of [
        'fiscal_locations',
        'fiscal_registers',
        'fiscal_cashier_bindings',
        'payment_orders',
        'payment_order_items',
        'payment_allocations',
        'payment_attempts',
        'fiscal_operations',
        'fiscal_receipts',
        'fiscal_shifts',
        'fiscal_action_approvals',
        'fiscal_reconciliations',
        'payment_refunds',
        'provider_webhook_events',
        'payment_outbox_jobs',
        'fiscal_audit_events'
    ]) {
        assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
        assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}[\\s\\S]*fiscal_profile_id`, 'i'));
    }
});

test('migration 316 scopes child rows through fiscal_profile_id and blocks cross-profile links', () => {
    for (const constraint of [
        'fk_fiscal_registers_location_profile',
        'fk_fiscal_cashier_bindings_register_profile',
        'fk_payment_orders_register_profile',
        'fk_payment_order_items_order_profile',
        'fk_payment_allocations_order_profile',
        'fk_payment_attempts_order_profile',
        'fk_fiscal_operations_order_profile',
        'fk_fiscal_operations_refund_profile',
        'fk_fiscal_operations_shift_profile',
        'fk_fiscal_receipts_operation_profile',
        'fk_fiscal_receipts_order_profile',
        'fk_fiscal_receipts_refund_profile',
        'fk_payment_refunds_order_profile',
        'fk_payment_refunds_original_receipt_profile_v316',
        'fk_payment_outbox_jobs_operation_profile'
    ]) {
        assert.match(migration, new RegExp(`CONSTRAINT ${constraint}[\\s\\S]*fiscal_profile_id`, 'i'));
    }

    assert.match(migration, /FOREIGN KEY \(payment_order_id, fiscal_profile_id\)/);
    assert.match(migration, /FOREIGN KEY \(fiscal_register_id, fiscal_profile_id\)/);
});

test('migration 316 stores UAH money in BIGINT minor units and keeps item snapshots immutable', () => {
    for (const column of [
        'total_amount_minor BIGINT NOT NULL',
        'unit_price_minor BIGINT NOT NULL',
        'amount_minor BIGINT NOT NULL',
        'expected_cash_minor BIGINT NOT NULL',
        'actual_cash_minor BIGINT NOT NULL',
        'difference_minor BIGINT NOT NULL'
    ]) {
        assert.match(migration, new RegExp(column.replace(/\s+/g, '\\s+'), 'i'));
    }
    assert.doesNotMatch(migrationSql, /\bamount_(?:uah|value)\s+NUMERIC\b/i);
    assert.match(migration, /currency CHAR\(3\) NOT NULL DEFAULT 'UAH'/);
    assert.match(migration, /CHECK \(currency = 'UAH'\)/);
    assert.match(migration, /item_name VARCHAR\(240\) NOT NULL/);
    assert.match(migration, /item_code VARCHAR\(96\)/);
    assert.match(migration, /tax_reference VARCHAR\(128\)/);
    assert.match(migration, /tax_code INTEGER/);
    assert.match(migration, /prevent_payment_order_item_mutation_v316/);
    assert.match(migration, /payment order item snapshots are immutable/);
});

test('migration 316 stores provider identifiers and idempotency without raw secrets', () => {
    for (const token of [
        'uq_payment_orders_idempotency',
        'uq_payment_attempts_idempotency',
        'uq_fiscal_operations_idempotency',
        'uq_payment_refunds_idempotency',
        'uq_payment_outbox_jobs_idempotency',
        'uq_fiscal_operations_provider_operation_v316',
        'uq_fiscal_receipts_provider_receipt',
        'uq_provider_webhook_events_provider_event_v316'
    ]) {
        assert.match(migration, new RegExp(token));
    }

    assert.doesNotMatch(migrationSql, /\b(api_key|access_token|refresh_token|provider_pin|pin_code|password|secret)\b/i);
    assert.match(migration, /webhook_signature_valid BOOLEAN NOT NULL DEFAULT FALSE/);
    assert.match(migration, /payload_sha256 VARCHAR\(128\) NOT NULL/);
    assert.match(migration, /sanitized_payload JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
});

test('migration 329 adds DB-level immutability and append-only configuration guards', () => {
    assert.match(migration329, /-- MIGRATION_KIND:\s*schema/i);
    assert.match(migration329, /prevent_fiscal_operation_identity_drift_v329/);
    assert.match(migration329, /trg_fiscal_operation_identity_drift_v329/);
    assert.match(migration329, /trg_fiscal_operation_delete_v329/);
    assert.match(migration329, /ON fiscal_operations[\s\S]*FOR EACH ROW[\s\S]*EXECUTE FUNCTION prevent_fiscal_operation_delete_v329/);
    assert.match(migration329, /provider_operation_id IS NOT NULL[\s\S]*NEW\.provider_operation_id IS DISTINCT FROM OLD\.provider_operation_id/);
    for (const protectedColumn of [
        'provider_organization_id',
        'provider_outlet_id',
        'provider_register_id',
        'provider_cashier_id',
        'register_credential_ref',
        'cashier_credential_ref',
        'expected_is_test',
        'fiscal_configuration_hash',
        'amount_minor',
        'fiscal_register_id',
        'fiscal_location_id'
    ]) {
        assert.match(migration329, new RegExp(`NEW\\.${protectedColumn} IS DISTINCT FROM OLD\\.${protectedColumn}`), `${protectedColumn} must be immutable`);
    }
    assert.match(migration329, /prevent_fiscal_receipt_identity_drift_v329/);
    assert.match(migration329, /trg_fiscal_receipt_delete_v329/);
    assert.match(migration329, /ON fiscal_receipts[\s\S]*FOR EACH ROW[\s\S]*EXECUTE FUNCTION prevent_fiscal_receipt_delete_v329/);
    for (const receiptColumn of [
        'fiscal_operation_id',
        'payment_order_id',
        'payment_refund_id',
        'receipt_type',
        'provider_receipt_id',
        'total_amount_minor',
        'currency'
    ]) {
        assert.match(migration329, new RegExp(`NEW\\.${receiptColumn} IS DISTINCT FROM OLD\\.${receiptColumn}`), `${receiptColumn} must be immutable`);
    }
    assert.match(migration329, /prevent_fiscal_configuration_audit_mutation_v329/);
    assert.match(migration329, /BEFORE UPDATE OR DELETE[\s\S]*ON fiscal_configuration_audit/);
    assert.match(migration329, /chk_fiscal_configuration_audit_actor_user_v329/);
    assert.match(migration329, /CHECK \(actor_user_id IS NOT NULL\)/);
    assert.doesNotMatch(migration329, /\b(password|secret|token|pin|access_key|license_key)\b/i);
});

test('money conversion rejects floating point inputs and round-trips UAH minor units', () => {
    assert.equal(uahDecimalToMinorUnits('0.01'), 1n);
    assert.equal(uahDecimalToMinorUnits('42'), 4200n);
    assert.equal(uahDecimalToMinorUnits('123.40'), 12340n);
    assert.equal(minorUnitsToUahDecimal(12340n), '123.40');
    assert.equal(toPostgresBigint(12340n), '12340');
    assert.equal(sumMinorUnits(['100', 25n, -5n]), 120n);

    assert.throws(() => uahDecimalToMinorUnits(12.34), /string/);
    assert.throws(() => uahDecimalToMinorUnits('12.345'), /at most two decimal/);
    assert.throws(() => normalizeMinorUnits(1.5), /safe integer/);
});

test('state transition helpers fail closed for invalid payment, fiscal, shift, and refund transitions', () => {
    assert.deepEqual(allowedNextStates('paymentOrder', 'draft'), ['confirmed', 'cancelled']);
    assert.equal(canTransition('paymentOrder', 'draft', 'confirmed'), true);
    assert.equal(assertTransition('paymentOrder', 'payment_recorded', 'refund_pending'), 'refund_pending');
    assert.throws(() => assertTransition('paymentOrder', 'draft', 'fiscalized'), /Invalid paymentOrder transition/);
    assert.throws(() => assertTransition('paymentOrder', 'refunded', 'payment_recorded'), /State is terminal/);

    assert.equal(canTransition('fiscalOperation', 'sending', 'fiscalized'), true);
    assert.equal(canTransition('fiscalOperation', 'unknown', 'pending'), true);
    assert.throws(() => assertTransition('fiscalOperation', 'pending', 'fiscalized'), /Invalid fiscalOperation transition/);

    assert.equal(canTransition('fiscalShift', 'closed', 'opening'), true);
    assert.throws(() => assertTransition('fiscalShift', 'closed', 'open'), /Invalid fiscalShift transition/);

    assert.equal(canTransition('paymentRefund', 'money_refunded', 'fiscal_return_pending'), true);
    assert.throws(() => assertTransition('paymentRefund', 'requested', 'fiscal_returned'), /Invalid paymentRefund transition/);
    assert.throws(() => allowedNextStates('missingMachine', 'draft'), /Unknown state machine/);
});
