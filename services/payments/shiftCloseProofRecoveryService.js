'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { CheckboxClientError } = require('../checkbox/errors');
const { loadCheckboxRuntimeConfig } = require('../checkbox/config');
const { createProviderFromConfig, normalizeShiftResponse } = require('../checkbox/provider');

const DEFAULT_TARGET = Object.freeze({
    drainId: 4,
    shiftId: 5,
    fiscalProfileId: 1,
    fiscalLocationId: 1,
    fiscalRegisterId: 1,
    cashierBindingId: 1,
    actorUserId: 4,
    sharedRegisterGroup: 'checkbox_single_test_register'
});

const EXPECTED_ROUTES = Object.freeze([
    Object.freeze({ routeOptionId: 'park_test', businessContext: 'event_genix' }),
    Object.freeze({ routeOptionId: 'dar_test', businessContext: 'dar' })
]);

class ShiftCloseProofRecoveryError extends Error {
    constructor(code, message, { status = 409, details = null } = {}) {
        super(message || code);
        this.name = 'ShiftCloseProofRecoveryError';
        this.code = code;
        this.status = status;
        if (details) this.details = details;
    }
}

function positiveInt(value, label) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new ShiftCloseProofRecoveryError('shift_close_proof_recovery_target_invalid', `${label} must be a positive integer`, { status: 422 });
    }
    return parsed;
}

function normalizeTarget(target = {}) {
    const merged = { ...DEFAULT_TARGET, ...target };
    return {
        drainId: positiveInt(merged.drainId, 'drainId'),
        shiftId: positiveInt(merged.shiftId, 'shiftId'),
        fiscalProfileId: positiveInt(merged.fiscalProfileId, 'fiscalProfileId'),
        fiscalLocationId: positiveInt(merged.fiscalLocationId, 'fiscalLocationId'),
        fiscalRegisterId: positiveInt(merged.fiscalRegisterId, 'fiscalRegisterId'),
        cashierBindingId: positiveInt(merged.cashierBindingId, 'cashierBindingId'),
        actorUserId: positiveInt(merged.actorUserId, 'actorUserId'),
        sharedRegisterGroup: String(merged.sharedRegisterGroup || '').trim()
    };
}

function recoveryOperationId(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(text)) {
        throw new ShiftCloseProofRecoveryError(
            'shift_close_proof_recovery_operation_id_invalid',
            'Recovery operation id is required and must be a stable safe token',
            { status: 422 }
        );
    }
    return text;
}

function operationIdempotencyKey(operationId) {
    return `fiscal_operation:shift_close_proof_import:${crypto.createHash('sha256').update(operationId).digest('hex')}`;
}

function fingerprint(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function safeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeCapabilityScope(value) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
        } catch {
            return value.split(',').map(item => item.trim()).filter(Boolean);
        }
    }
    return [];
}

function sanitizedTarget(target) {
    return {
        drainId: target.drainId,
        shiftId: target.shiftId,
        fiscalProfileId: target.fiscalProfileId,
        fiscalLocationId: target.fiscalLocationId,
        fiscalRegisterId: target.fiscalRegisterId,
        cashierBindingId: target.cashierBindingId,
        actorUserId: target.actorUserId
    };
}

function providerProofSnapshot(proof = {}) {
    return {
        source: 'provider_exact_shift_read',
        status: String(proof.status || '').trim().toUpperCase(),
        shiftIdMatched: proof.shiftIdMatched === true,
        registerMatched: proof.registerMatched === true,
        cashierMatched: proof.cashierMatched === true,
        organizationVerified: proof.organizationVerified === true,
        closedAt: proof.closedAt || null,
        zReportPresent: proof.zReportPresent === true,
        observedAt: proof.observedAt || new Date().toISOString()
    };
}

function assertStatus(condition, code, message, details = null) {
    if (!condition) {
        throw new ShiftCloseProofRecoveryError(code, message, { details });
    }
}

async function withClient(dbPool, work) {
    const client = await dbPool.connect();
    try {
        return await work(client);
    } finally {
        if (typeof client.release === 'function') client.release();
    }
}

async function transaction(client, mode, work) {
    await client.query(mode === 'readonly' ? 'BEGIN READ ONLY' : 'BEGIN');
    try {
        const result = await work();
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function loadScope(client, target, { lock = false, idempotencyKey } = {}) {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [target.fiscalProfileId, target.fiscalRegisterId]);
    const lockClause = lock ? ' FOR UPDATE OF drain, shift, binding' : '';
    const scopeResult = await client.query(
        `SELECT
            drain.id AS drain_id,
            drain.status AS drain_status,
            drain.fiscal_profile_id AS drain_fiscal_profile_id,
            drain.fiscal_register_id AS drain_fiscal_register_id,
            drain.fiscal_shift_id AS drain_shift_id,
            drain.resumed_at AS drain_resumed_at,
            drain.initiating_route_option_id AS drain_route_option_id,
            shift.id AS shift_id,
            shift.status AS shift_status,
            shift.lifecycle_stage AS shift_lifecycle_stage,
            shift.fiscal_profile_id AS shift_fiscal_profile_id,
            shift.fiscal_register_id AS shift_fiscal_register_id,
            register.fiscal_location_id AS shift_fiscal_location_id,
            shift.business_context AS shift_business_context,
            shift.provider_shift_id,
            shift.open_operation_id,
            shift.close_operation_id,
            shift.provider_closed_at,
            shift.provider_snapshot AS shift_provider_snapshot,
            profile.provider_organization_id,
            location.provider_outlet_id,
            register.provider_register_id,
            register.provider_license_ref AS register_credential_ref,
            COALESCE(register.metadata->>'expected_is_test', register.metadata->>'expectedIsTest') AS register_expected_is_test,
            register.metadata AS register_metadata,
            binding.id AS binding_id,
            binding.user_id AS binding_user_id,
            binding.status AS binding_status,
            binding.capability_scope AS binding_capability_scope,
            binding.provider_cashier_id,
            binding.provider_cashier_login_ref AS cashier_credential_ref,
            open_operation.fiscal_configuration_hash AS open_fiscal_configuration_hash
         FROM fiscal_register_payment_drains drain
         JOIN fiscal_shifts shift
           ON shift.id = drain.fiscal_shift_id
          AND shift.fiscal_profile_id = drain.fiscal_profile_id
          AND shift.fiscal_register_id = drain.fiscal_register_id
         JOIN fiscal_profiles profile
           ON profile.id = shift.fiscal_profile_id
         JOIN fiscal_registers register
           ON register.id = shift.fiscal_register_id
          AND register.fiscal_profile_id = shift.fiscal_profile_id
         JOIN fiscal_locations location
           ON location.id = register.fiscal_location_id
          AND location.fiscal_profile_id = register.fiscal_profile_id
         JOIN fiscal_cashier_bindings binding
           ON binding.id = $6
          AND binding.fiscal_profile_id = shift.fiscal_profile_id
          AND binding.fiscal_location_id = register.fiscal_location_id
          AND binding.fiscal_register_id = shift.fiscal_register_id
         LEFT JOIN fiscal_operations open_operation
           ON open_operation.id = shift.open_operation_id
          AND open_operation.fiscal_profile_id = shift.fiscal_profile_id
          AND open_operation.fiscal_register_id = shift.fiscal_register_id
          AND open_operation.fiscal_shift_id = shift.id
          AND open_operation.operation_type = 'shift_open'
        WHERE drain.id = $1
          AND shift.id = $2
          AND shift.fiscal_profile_id = $3
          AND register.fiscal_location_id = $4
          AND shift.fiscal_register_id = $5${lockClause}`,
        [
            target.drainId,
            target.shiftId,
            target.fiscalProfileId,
            target.fiscalLocationId,
            target.fiscalRegisterId,
            target.cashierBindingId
        ]
    );
    const row = scopeResult.rows[0] || null;
    assertStatus(row, 'shift_close_proof_recovery_scope_not_found', 'Exact drain/shift/register/binding scope was not found');
    const routes = (await client.query(
        `SELECT route_option_id, business_context, mode, status, expected_is_test,
                fiscal_profile_id, fiscal_location_id, fiscal_register_id, shared_register_group
           FROM fiscal_sale_routes
          WHERE fiscal_profile_id = $1
            AND fiscal_location_id = $2
            AND fiscal_register_id = $3
            AND route_option_id = ANY($4::text[])
          ORDER BY route_option_id`,
        [target.fiscalProfileId, target.fiscalLocationId, target.fiscalRegisterId, EXPECTED_ROUTES.map(route => route.routeOptionId)]
    )).rows;
    const operations = (await client.query(
        `SELECT id, operation_type, status, provider_status, external_stage, idempotency_key
           FROM fiscal_operations operation
          WHERE operation.fiscal_shift_id = $1
            AND operation.fiscal_profile_id = $2
            AND operation.fiscal_register_id = $3
          ORDER BY id`,
        [target.shiftId, target.fiscalProfileId, target.fiscalRegisterId]
    )).rows;
    const blockerRow = (await client.query(
        `WITH blocker_snapshot AS (
             SELECT
                (SELECT COUNT(*)::int
                   FROM payment_outbox_jobs job
                  WHERE job.fiscal_profile_id = $1
                    AND job.status IN ('queued', 'claimed', 'running', 'failed', 'dead')) AS pending_jobs,
                (SELECT COUNT(*)::int
                   FROM fiscal_operations operation
                  WHERE operation.fiscal_profile_id = $1
                    AND operation.fiscal_register_id = $2
                    AND operation.status IN ('pending', 'validating', 'ready_to_send', 'sending', 'validation_failed', 'failed', 'unknown', 'blocked')) AS unknown_operations,
                (SELECT COUNT(*)::int
                   FROM payment_orders payment_order
                  WHERE payment_order.fiscal_profile_id = $1
                    AND payment_order.fiscal_register_id = $2
                    AND payment_order.payment_status = 'confirmed'
                    AND payment_order.fiscal_status <> 'fiscalized') AS unknown_orders
         )
         SELECT pending_jobs, unknown_operations, unknown_orders,
                (pending_jobs + unknown_operations + unknown_orders)::int AS total_blockers
           FROM blocker_snapshot`,
        [target.fiscalProfileId, target.fiscalRegisterId]
    )).rows[0] || { pending_jobs: 0, unknown_operations: 0, unknown_orders: 0, total_blockers: 0 };
    const replay = (await client.query(
        `SELECT operation.id, operation.operation_type, operation.status, operation.provider_status,
                operation.fiscal_shift_id, operation.fiscal_profile_id, operation.fiscal_register_id,
                shift.close_operation_id
           FROM fiscal_operations operation
           LEFT JOIN fiscal_shifts shift
             ON shift.id = operation.fiscal_shift_id
            AND shift.fiscal_profile_id = operation.fiscal_profile_id
            AND shift.fiscal_register_id = operation.fiscal_register_id
          WHERE operation.idempotency_key = $1`,
        [idempotencyKey]
    )).rows[0] || null;

    return {
        target,
        row,
        routes,
        operations,
        blockers: {
            pendingJobs: Number(blockerRow.pending_jobs || 0),
            unknownOperations: Number(blockerRow.unknown_operations || 0),
            unknownOrders: Number(blockerRow.unknown_orders || 0),
            total: Number(blockerRow.total_blockers || 0)
        },
        replay
    };
}

function validateScope(scope, { allowReplay = true } = {}) {
    const { row, target, routes, operations, blockers, replay } = scope;
    const replayIsComplete = replay
        && Number(replay.fiscal_shift_id) === target.shiftId
        && Number(replay.fiscal_profile_id) === target.fiscalProfileId
        && Number(replay.fiscal_register_id) === target.fiscalRegisterId
        && replay.operation_type === 'shift_close'
        && replay.status === 'fiscalized'
        && replay.provider_status === 'CLOSED'
        && Number(replay.close_operation_id) === Number(replay.id);
    if (replay) {
        assertStatus(allowReplay && replayIsComplete, 'shift_close_proof_recovery_idempotency_conflict', 'Recovery idempotency key is not an exact completed replay');
        return { replayed: true, operationId: Number(replay.id) };
    }

    assertStatus(row.drain_status === 'closed', 'shift_close_proof_recovery_drain_not_closed', 'Drain must be closed before proof import');
    assertStatus(!row.drain_resumed_at, 'shift_close_proof_recovery_drain_already_resumed', 'Drain is already resumed');
    assertStatus(Number(row.drain_shift_id) === target.shiftId, 'shift_close_proof_recovery_drain_shift_mismatch', 'Drain is not tied to the exact shift');
    assertStatus(Number(row.shift_fiscal_profile_id) === target.fiscalProfileId
        && Number(row.shift_fiscal_register_id) === target.fiscalRegisterId
        && Number(row.shift_fiscal_location_id) === target.fiscalLocationId, 'shift_close_proof_recovery_shift_scope_mismatch', 'Shift scope does not match target');
    assertStatus(row.shift_status === 'closed' && row.shift_lifecycle_stage === 'CLOSED', 'shift_close_proof_recovery_shift_not_local_closed', 'Shift must be local CLOSED');
    assertStatus(!row.close_operation_id, 'shift_close_proof_recovery_close_operation_exists', 'Shift already has a close operation');
    assertStatus(Boolean(String(row.provider_shift_id || '').trim()), 'shift_close_proof_recovery_provider_shift_missing', 'Shift provider id is required');
    assertStatus(Number(row.binding_id) === target.cashierBindingId && Number(row.binding_user_id) === target.actorUserId, 'shift_close_proof_recovery_binding_mismatch', 'Cashier binding does not match target actor');
    assertStatus(row.binding_status === 'active', 'shift_close_proof_recovery_binding_inactive', 'Cashier binding is not active');
    assertStatus(safeCapabilityScope(row.binding_capability_scope).includes('fiscal.shift.close'), 'shift_close_proof_recovery_binding_capability_missing', 'Cashier binding cannot close shifts');
    assertStatus(Boolean(row.provider_organization_id && row.provider_register_id && row.provider_cashier_id
        && row.register_credential_ref && row.cashier_credential_ref), 'shift_close_proof_recovery_provider_identity_incomplete', 'Provider identity or secure refs are incomplete');
    assertStatus(['true', '1'].includes(String(row.register_expected_is_test || '').trim().toLowerCase()), 'shift_close_proof_recovery_not_test_register', 'Recovery target must be expected_is_test=true');

    const routeMap = new Map(routes.map(route => [route.route_option_id, route]));
    assertStatus(routes.length === EXPECTED_ROUTES.length, 'shift_close_proof_recovery_routes_missing', 'Expected PARK/DAR test routes are missing');
    for (const expected of EXPECTED_ROUTES) {
        const route = routeMap.get(expected.routeOptionId);
        assertStatus(route && route.business_context === expected.businessContext
            && route.mode === 'test'
            && route.status === 'active'
            && route.expected_is_test === true
            && Number(route.fiscal_profile_id) === target.fiscalProfileId
            && Number(route.fiscal_location_id) === target.fiscalLocationId
            && Number(route.fiscal_register_id) === target.fiscalRegisterId
            && route.shared_register_group === target.sharedRegisterGroup,
        'shift_close_proof_recovery_route_scope_mismatch',
        'PARK/DAR shared test route scope does not match target');
    }

    assertStatus(!operations.some(operation => operation.operation_type === 'shift_close'), 'shift_close_proof_recovery_duplicate_shift_close', 'Shift already has a shift_close operation');
    assertStatus(operations.every(operation => operation.status === 'fiscalized' || operation.status === 'not_required' || operation.status === 'cancelled'),
        'shift_close_proof_recovery_operation_unresolved',
        'Shift has unresolved operations');
    assertStatus(blockers.total === 0, 'shift_close_proof_recovery_blockers_present', 'Register has pending/unknown blockers', blockers);
    return { replayed: false };
}

function assertProviderClosedProof(scope, proof) {
    const row = scope.row;
    const snapshot = providerProofSnapshot(proof);
    assertStatus(snapshot.status === 'CLOSED', 'shift_close_proof_recovery_provider_not_closed', 'Provider shift is not CLOSED', { status: snapshot.status });
    assertStatus(snapshot.shiftIdMatched === true, 'shift_close_proof_recovery_provider_shift_mismatch', 'Provider shift identity mismatch');
    assertStatus(snapshot.registerMatched === true, 'shift_close_proof_recovery_provider_register_mismatch', 'Provider register identity mismatch');
    assertStatus(snapshot.cashierMatched === true, 'shift_close_proof_recovery_provider_cashier_mismatch', 'Provider cashier identity mismatch');
    assertStatus(snapshot.organizationVerified === true, 'shift_close_proof_recovery_provider_organization_unverified', 'Provider organization identity was not verified');
    assertStatus(String(proof.shiftId || row.provider_shift_id) === String(row.provider_shift_id), 'shift_close_proof_recovery_provider_shift_mismatch', 'Provider shift id does not match local shift');
    return snapshot;
}

async function readProviderClosedProof(scope, { env = process.env, fetchImpl } = {}) {
    const row = scope.row;
    const config = loadCheckboxRuntimeConfig({
        env,
        credentialRef: row.cashier_credential_ref,
        licenseRef: row.register_credential_ref,
        expectedIsTest: true
    });
    const provider = createProviderFromConfig(config, { fetchImpl });
    const expected = {
        expectedOrganizationId: row.provider_organization_id,
        expectedRegisterId: row.provider_register_id,
        expectedCashierId: row.provider_cashier_id,
        expectedShiftId: row.provider_shift_id,
        expectedIsTest: true
    };
    await provider.verifyReadiness(expected, { requireSalesPermission: false });
    const detailed = normalizeShiftResponse(await provider.client.getShiftById({ shiftId: row.provider_shift_id }), expected, { requireCashier: true });
    return {
        status: detailed.status,
        shiftId: detailed.id,
        shiftIdMatched: true,
        registerMatched: true,
        cashierMatched: true,
        organizationVerified: true,
        closedAt: detailed.closedAt || null,
        zReportPresent: Boolean(detailed.zReport),
        observedAt: new Date().toISOString()
    };
}

function publicResult(state, extra = {}) {
    return {
        status: state,
        target: sanitizedTarget(extra.target || DEFAULT_TARGET),
        replayed: extra.replayed === true,
        operationId: extra.operationId ? Number(extra.operationId) : null,
        closeOperationImported: extra.closeOperationImported === true,
        providerProof: extra.providerProof ? providerProofSnapshot(extra.providerProof) : null,
        blockers: extra.blockers || null
    };
}

async function insertCloseProof(client, scope, { idempotencyKey, operationId, providerProof }) {
    const row = scope.row;
    const proof = providerProofSnapshot(providerProof);
    const requestSnapshot = {
        phase: 'shift_close_proof_import',
        recovery_operation_id: operationId,
        target: sanitizedTarget(scope.target),
        provider_proof: proof
    };
    const responseSnapshot = {
        provider_proof: proof
    };
    const requestFingerprint = fingerprint({ operationId, target: sanitizedTarget(scope.target), providerProof: proof });
    const inserted = (await client.query(
        `INSERT INTO fiscal_operations (
            fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
            idempotency_key, provider, provider_operation_id, provider_status, amount_minor,
            currency, request_fingerprint, request_snapshot, response_snapshot, completed_at,
            provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
            register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash,
            fiscal_location_id, external_stage
         )
         VALUES (
            $1, $2, $3, 'shift_close', 'fiscalized',
            $4, 'checkbox', NULL, 'CLOSED', NULL,
            'UAH', $5, $6::jsonb, $7::jsonb, COALESCE($8::timestamptz, NOW()),
            $9, $10, $11, $12,
            $13, $14, TRUE, $15,
            $16, 'shift_close_lookup'
         )
         RETURNING *`,
        [
            scope.target.fiscalProfileId,
            scope.target.fiscalRegisterId,
            scope.target.shiftId,
            idempotencyKey,
            requestFingerprint,
            JSON.stringify(requestSnapshot),
            JSON.stringify(responseSnapshot),
            proof.closedAt,
            row.provider_organization_id,
            row.provider_outlet_id,
            row.provider_register_id,
            row.provider_cashier_id,
            row.register_credential_ref,
            row.cashier_credential_ref,
            row.open_fiscal_configuration_hash || null,
            scope.target.fiscalLocationId
        ]
    )).rows[0];
    assertStatus(inserted, 'shift_close_proof_recovery_insert_failed', 'Close proof operation was not inserted');
    const beforeShift = {
        id: Number(row.shift_id),
        status: row.shift_status,
        lifecycleStage: row.shift_lifecycle_stage,
        closeOperationId: row.close_operation_id ? Number(row.close_operation_id) : null,
        providerClosedAtPresent: Boolean(row.provider_closed_at)
    };
    const update = (await client.query(
        `UPDATE fiscal_shifts
            SET close_operation_id = $2,
                provider_closed_at = COALESCE(provider_closed_at, $3::timestamptz),
                provider_snapshot = COALESCE(provider_snapshot, '{}'::jsonb) || $4::jsonb,
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $5
            AND fiscal_register_id = $6
            AND close_operation_id IS NULL
            AND status = 'closed'
            AND lifecycle_stage = 'CLOSED'
            AND provider_shift_id = $7
          RETURNING *`,
        [
            scope.target.shiftId,
            inserted.id,
            proof.closedAt,
            JSON.stringify({ shift_close_proof_import: proof }),
            scope.target.fiscalProfileId,
            scope.target.fiscalRegisterId,
            row.provider_shift_id
        ]
    )).rows[0];
    assertStatus(update, 'shift_close_proof_recovery_shift_update_failed', 'Exact shift close proof link could not be updated');
    await client.query(
        `INSERT INTO fiscal_audit_events (
            fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
            idempotency_key, before_snapshot, after_snapshot, metadata
         )
         VALUES ($1, $2, 'shift_close_proof_imported', 'fiscal_shifts', $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
        [
            scope.target.fiscalProfileId,
            scope.target.actorUserId,
            scope.target.shiftId,
            `shift_close_proof_imported:${operationId}`,
            JSON.stringify(beforeShift),
            JSON.stringify({
                id: Number(update.id),
                closeOperationId: Number(update.close_operation_id),
                providerClosedAtPresent: Boolean(update.provider_closed_at)
            }),
            JSON.stringify({ target: sanitizedTarget(scope.target), providerProof: proof })
        ]
    );
    return inserted;
}

async function recoverShiftCloseProof({
    dbPool = pool,
    target = DEFAULT_TARGET,
    recoveryOperationId: rawRecoveryOperationId,
    actorUserId,
    execute = false,
    providerLookup = readProviderClosedProof,
    env = process.env,
    fetchImpl
} = {}) {
    const normalizedTarget = normalizeTarget({ ...target, actorUserId: actorUserId || target.actorUserId || DEFAULT_TARGET.actorUserId });
    const operationId = recoveryOperationId(rawRecoveryOperationId);
    const idempotencyKey = operationIdempotencyKey(operationId);

    return withClient(dbPool, async client => {
        const preflight = await transaction(client, 'readonly', async () => {
            const scope = await loadScope(client, normalizedTarget, { lock: false, idempotencyKey });
            const validation = validateScope(scope);
            return { scope, validation };
        });
        if (preflight.validation.replayed) {
            return publicResult('replayed', {
                target: normalizedTarget,
                replayed: true,
                operationId: preflight.validation.operationId,
                closeOperationImported: true,
                blockers: preflight.scope.blockers
            });
        }

        let providerProof;
        try {
            providerProof = await providerLookup(preflight.scope, { env, fetchImpl });
        } catch (error) {
            if (error instanceof ShiftCloseProofRecoveryError) throw error;
            if (error instanceof CheckboxClientError) {
                throw new ShiftCloseProofRecoveryError(error.code || 'shift_close_proof_recovery_provider_lookup_failed', error.message, {
                    status: error.status || 503,
                    details: { retryable: error.retryable === true, unknown: error.unknown === true }
                });
            }
            throw new ShiftCloseProofRecoveryError('shift_close_proof_recovery_provider_lookup_failed', error?.message || 'Provider lookup failed', { status: 503 });
        }
        const sanitizedProof = assertProviderClosedProof(preflight.scope, providerProof);
        if (!execute) {
            return publicResult('ready_to_import', {
                target: normalizedTarget,
                providerProof: sanitizedProof,
                blockers: preflight.scope.blockers
            });
        }

        return transaction(client, 'write', async () => {
            const lockedScope = await loadScope(client, normalizedTarget, { lock: true, idempotencyKey });
            const validation = validateScope(lockedScope);
            if (validation.replayed) {
                return publicResult('replayed', {
                    target: normalizedTarget,
                    replayed: true,
                    operationId: validation.operationId,
                    closeOperationImported: true,
                    providerProof: sanitizedProof,
                    blockers: lockedScope.blockers
                });
            }
            assertProviderClosedProof(lockedScope, providerProof);
            const operation = await insertCloseProof(client, lockedScope, { idempotencyKey, operationId, providerProof });
            return publicResult('imported', {
                target: normalizedTarget,
                operationId: operation.id,
                closeOperationImported: true,
                providerProof: sanitizedProof,
                blockers: lockedScope.blockers
            });
        });
    });
}

module.exports = {
    DEFAULT_TARGET,
    EXPECTED_ROUTES,
    ShiftCloseProofRecoveryError,
    operationIdempotencyKey,
    recoverShiftCloseProof,
    __test: {
        assertProviderClosedProof,
        normalizeTarget,
        providerProofSnapshot,
        recoveryOperationId,
        validateScope
    }
};
