'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    operationIdempotencyKey,
    recoverShiftCloseProof
} = require('../services/payments/shiftCloseProofRecoveryService');

const RECOVERY_ID = 'F8-PD-CASHIER-CLOSE-PROOF-IMPORT-SHIFT-5-DRAIN-4-2026-09-12';

function baseState(overrides = {}) {
    return {
        drain: { id: 4, status: 'closed', fiscal_shift_id: 5, resumed_at: null, initiating_route_option_id: 'park_test' },
        shift: {
            id: 5,
            status: 'closed',
            lifecycle_stage: 'CLOSED',
            fiscal_profile_id: 1,
            fiscal_register_id: 1,
            fiscal_location_id: 1,
            business_context: 'event_genix',
            provider_shift_id: 'provider-shift-5',
            open_operation_id: 16,
            close_operation_id: null,
            provider_closed_at: null,
            provider_snapshot: {}
        },
        profile: { provider_organization_id: 'provider-org-1' },
        location: { provider_outlet_id: 'provider-outlet-1' },
        register: {
            provider_register_id: 'provider-register-1',
            provider_license_ref: 'test-register-ref',
            expected_is_test: 'true',
            metadata: { expected_is_test: 'true' }
        },
        binding: {
            id: 1,
            user_id: 4,
            status: 'active',
            capability_scope: ['payments.view', 'fiscal.shift.close'],
            provider_cashier_id: 'provider-cashier-1',
            provider_cashier_login_ref: 'test-cashier-ref'
        },
        routes: [
            {
                route_option_id: 'dar_test',
                business_context: 'dar',
                mode: 'test',
                status: 'active',
                expected_is_test: true,
                fiscal_profile_id: 1,
                fiscal_location_id: 1,
                fiscal_register_id: 1,
                shared_register_group: 'checkbox_single_test_register'
            },
            {
                route_option_id: 'park_test',
                business_context: 'event_genix',
                mode: 'test',
                status: 'active',
                expected_is_test: true,
                fiscal_profile_id: 1,
                fiscal_location_id: 1,
                fiscal_register_id: 1,
                shared_register_group: 'checkbox_single_test_register'
            }
        ],
        operations: [
            {
                id: 16,
                operation_type: 'shift_open',
                status: 'fiscalized',
                provider_status: 'OPENED',
                external_stage: 'shift_lookup',
                idempotency_key: 'open'
            },
            {
                id: 17,
                operation_type: 'sale',
                status: 'fiscalized',
                provider_status: 'DONE',
                external_stage: 'complete',
                idempotency_key: 'sale-1'
            },
            {
                id: 18,
                operation_type: 'sale',
                status: 'fiscalized',
                provider_status: 'DONE',
                external_stage: 'complete',
                idempotency_key: 'sale-2'
            }
        ],
        blockers: { pending_jobs: 0, unknown_operations: 0, unknown_orders: 0 },
        insertedOperations: [],
        audits: [],
        ...overrides
    };
}

function providerProof(overrides = {}) {
    return {
        status: 'CLOSED',
        shiftId: 'provider-shift-5',
        shiftIdMatched: true,
        registerMatched: true,
        cashierMatched: true,
        organizationVerified: true,
        closedAt: '2026-09-11T17:00:54.232Z',
        zReportPresent: true,
        observedAt: '2026-09-12T10:00:00.000Z',
        ...overrides
    };
}

class FakeClient {
    constructor(state) {
        this.state = state;
        this.queries = [];
    }

    async query(sql, params = []) {
        const text = String(sql);
        this.queries.push({ text, params });
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text) || text.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (text.includes('FROM fiscal_register_payment_drains drain')) {
            const { drain, shift, profile, location, register, binding } = this.state;
            return {
                rows: [{
                    drain_id: drain.id,
                    drain_status: drain.status,
                    drain_fiscal_profile_id: shift.fiscal_profile_id,
                    drain_fiscal_register_id: shift.fiscal_register_id,
                    drain_shift_id: drain.fiscal_shift_id,
                    drain_resumed_at: drain.resumed_at,
                    drain_route_option_id: drain.initiating_route_option_id,
                    shift_id: shift.id,
                    shift_status: shift.status,
                    shift_lifecycle_stage: shift.lifecycle_stage,
                    shift_fiscal_profile_id: shift.fiscal_profile_id,
                    shift_fiscal_register_id: shift.fiscal_register_id,
                    shift_fiscal_location_id: shift.fiscal_location_id,
                    shift_business_context: shift.business_context,
                    provider_shift_id: shift.provider_shift_id,
                    open_operation_id: shift.open_operation_id,
                    close_operation_id: shift.close_operation_id,
                    provider_closed_at: shift.provider_closed_at,
                    shift_provider_snapshot: shift.provider_snapshot,
                    provider_organization_id: profile.provider_organization_id,
                    provider_outlet_id: location.provider_outlet_id,
                    provider_register_id: register.provider_register_id,
                    register_credential_ref: register.provider_license_ref,
                    register_expected_is_test: register.expected_is_test,
                    register_metadata: register.metadata,
                    binding_id: binding.id,
                    binding_user_id: binding.user_id,
                    binding_status: binding.status,
                    binding_capability_scope: binding.capability_scope,
                    provider_cashier_id: binding.provider_cashier_id,
                    cashier_credential_ref: binding.provider_cashier_login_ref,
                    open_fiscal_configuration_hash: 'open-config-hash'
                }]
            };
        }
        if (text.includes('FROM fiscal_sale_routes')) return { rows: this.state.routes };
        if (text.includes('WHERE operation.fiscal_shift_id = $1')) return { rows: this.state.operations };
        if (text.includes('WITH blocker_snapshot')) {
            const row = this.state.blockers;
            return { rows: [{ ...row, total_blockers: row.pending_jobs + row.unknown_operations + row.unknown_orders }] };
        }
        if (text.includes('WHERE operation.idempotency_key = $1')) {
            const key = params[0];
            const operation = [...this.state.operations, ...this.state.insertedOperations].find(item => item.idempotency_key === key);
            return {
                rows: operation ? [{
                    id: operation.id,
                    operation_type: operation.operation_type,
                    status: operation.status,
                    provider_status: operation.provider_status,
                    fiscal_shift_id: 5,
                    fiscal_profile_id: 1,
                    fiscal_register_id: 1,
                    close_operation_id: this.state.shift.close_operation_id
                }] : []
            };
        }
        if (text.includes('INSERT INTO fiscal_operations')) {
            const inserted = {
                id: 99,
                fiscal_profile_id: params[0],
                fiscal_register_id: params[1],
                fiscal_shift_id: params[2],
                operation_type: 'shift_close',
                status: 'fiscalized',
                idempotency_key: params[3],
                provider_status: 'CLOSED',
                external_stage: 'shift_close_lookup'
            };
            this.state.insertedOperations.push(inserted);
            return { rows: [inserted] };
        }
        if (text.includes('UPDATE fiscal_shifts')) {
            if (this.state.shift.close_operation_id) return { rows: [] };
            this.state.shift.close_operation_id = params[1];
            this.state.shift.provider_closed_at = params[2] || this.state.shift.provider_closed_at;
            return { rows: [{ ...this.state.shift, close_operation_id: params[1], provider_closed_at: this.state.shift.provider_closed_at }] };
        }
        if (text.includes('INSERT INTO fiscal_audit_events')) {
            this.state.audits.push({ params });
            return { rows: [] };
        }
        throw new Error(`Unexpected SQL: ${text.slice(0, 160)}`);
    }

    release() {}
}

function fakePool(state) {
    const client = new FakeClient(state);
    return {
        client,
        connect: async () => client
    };
}

test('dry-run reproduces CLOSED shift without close_operation_id and prepares import without writes', async () => {
    const state = baseState();
    const pool = fakePool(state);
    const result = await recoverShiftCloseProof({
        dbPool: pool,
        recoveryOperationId: RECOVERY_ID,
        providerLookup: async () => providerProof(),
        execute: false
    });

    assert.equal(result.status, 'ready_to_import');
    assert.equal(result.closeOperationImported, false);
    assert.equal(state.insertedOperations.length, 0);
    assert.equal(state.audits.length, 0);
    assert.equal(state.shift.close_operation_id, null);
    assert.equal(result.providerProof.status, 'CLOSED');
});

test('execute imports one audited close proof and exact idempotent replay creates no duplicate', async () => {
    const state = baseState();
    const pool = fakePool(state);
    const first = await recoverShiftCloseProof({
        dbPool: pool,
        recoveryOperationId: RECOVERY_ID,
        providerLookup: async () => providerProof(),
        execute: true
    });

    assert.equal(first.status, 'imported');
    assert.equal(first.operationId, 99);
    assert.equal(state.shift.close_operation_id, 99);
    assert.equal(state.insertedOperations.length, 1);
    assert.equal(state.audits.length, 1);
    assert.equal(state.insertedOperations[0].idempotency_key, operationIdempotencyKey(RECOVERY_ID));

    const second = await recoverShiftCloseProof({
        dbPool: pool,
        recoveryOperationId: RECOVERY_ID,
        providerLookup: async () => {
            throw new Error('provider lookup should not run on completed replay');
        },
        execute: true
    });
    assert.equal(second.status, 'replayed');
    assert.equal(second.operationId, 99);
    assert.equal(state.insertedOperations.length, 1);
});

test('provider OPENED proof fails closed before DB write', async () => {
    const state = baseState();
    await assert.rejects(
        recoverShiftCloseProof({
            dbPool: fakePool(state),
            recoveryOperationId: RECOVERY_ID,
            providerLookup: async () => providerProof({ status: 'OPENED' }),
            execute: true
        }),
        error => error.code === 'shift_close_proof_recovery_provider_not_closed'
    );
    assert.equal(state.insertedOperations.length, 0);
});

test('provider identity mismatch fails closed before DB write', async () => {
    const state = baseState();
    await assert.rejects(
        recoverShiftCloseProof({
            dbPool: fakePool(state),
            recoveryOperationId: RECOVERY_ID,
            providerLookup: async () => providerProof({ shiftIdMatched: false }),
            execute: true
        }),
        error => error.code === 'shift_close_proof_recovery_provider_shift_mismatch'
    );
    assert.equal(state.insertedOperations.length, 0);
});

test('pending blockers fail closed before provider lookup and DB write', async () => {
    const state = baseState({ blockers: { pending_jobs: 1, unknown_operations: 0, unknown_orders: 0 } });
    await assert.rejects(
        recoverShiftCloseProof({
            dbPool: fakePool(state),
            recoveryOperationId: RECOVERY_ID,
            providerLookup: async () => {
                throw new Error('provider lookup should not run when local blockers exist');
            },
            execute: true
        }),
        error => error.code === 'shift_close_proof_recovery_blockers_present'
    );
    assert.equal(state.insertedOperations.length, 0);
});

test('non-test or broken PARK/DAR route scope fails closed before DB write', async () => {
    const state = baseState({
        routes: baseState().routes.map(route => (
            route.route_option_id === 'dar_test' ? { ...route, expected_is_test: false } : route
        ))
    });
    await assert.rejects(
        recoverShiftCloseProof({
            dbPool: fakePool(state),
            recoveryOperationId: RECOVERY_ID,
            providerLookup: async () => providerProof(),
            execute: true
        }),
        error => error.code === 'shift_close_proof_recovery_route_scope_mismatch'
    );
    assert.equal(state.insertedOperations.length, 0);
});
