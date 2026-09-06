'use strict';
const { TestDrainError, lockFiscalRegister, assertRegisterAccepting } = require('./testDrainGate');

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { canUseAction } = require('../../middleware/auth');
const { publishInTransaction } = require('../eventBus');
const {
    FiscalAccessError,
    assertFiscalCashierBindingCapability,
    authorizeFiscalAction,
    authorizeFiscalActorAction,
    loadFiscalCashierBinding,
    normalizeCapabilityScope
} = require('./fiscalAccess');
const {
    FiscalApprovalError,
    approveFiscalAction,
    consumeFiscalApprovalInTransaction,
    createActionPinHash
} = require('./fiscalApprovals');
const { toPostgresBigint } = require('./money');
const {
    isCashierProEnabled,
    isCheckboxIntegrationEnabled,
    loadCheckboxRuntimeConfig
} = require('../checkbox/config');
const { safeCheckboxArtifactUrl } = require('../checkbox/provider');
const { countFiscalShiftCloseBlockers } = require('./shiftCloseBlockers');
const { buildFiscalConfigurationSnapshot } = require('./paymentReadinessService');

const OPEN_SHIFT_STATUSES = Object.freeze(['opening', 'open']);
const UNRESOLVED_SHIFT_LIFECYCLE_STAGES = Object.freeze(['CREATED', 'OPENING', 'OPENED', 'CLOSING']);
const CLOSE_BLOCKER_STATUSES = Object.freeze(['pending', 'unknown', 'validating', 'ready_to_send', 'sending', 'failed', 'blocked']);
const AUTO_CLOSE_FLAG = 'EVENTGENIX_FISCAL_AUTO_CLOSE_ENABLED';

class CashierOperationsError extends Error {
    constructor(code, message, { status = 400, details = {} } = {}) {
        super(message || code);
        this.name = 'CashierOperationsError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function normalizePositiveId(value, code = 'invalid_id') {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new CashierOperationsError(code, 'A positive integer id is required');
    }
    return numeric;
}

function amountMinor(value, code = 'invalid_amount') {
    const minor = toPostgresBigint(value, { allowZero: false });
    if (minor <= 0n) {
        throw new CashierOperationsError(code, 'Amount must be positive');
    }
    return minor;
}

function nullableAmountMinor(value) {
    if (value === undefined || value === null || value === '') return null;
    return BigInt(toPostgresBigint(value, { allowZero: true }));
}

function normalizeBoolean(value) {
    if (value === true || value === false) return value;
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
    return null;
}

function assertCompleteFiscalCredentialRefs(mapping = {}, binding = {}) {
    const registerCredentialRef = String(mapping?.provider_license_ref ?? '').trim() || null;
    const cashierCredentialRef = String(binding?.provider_cashier_login_ref ?? '').trim() || null;
    const missing = [];
    if (!registerCredentialRef) missing.push('register_credential_ref');
    if (!cashierCredentialRef) missing.push('cashier_credential_ref');
    if (missing.length) {
        throw new CashierOperationsError(
            'fiscal_provider_context_incomplete',
            'Checkbox provider configuration is incomplete',
            { status: 409, details: { missing } }
        );
    }
    return { registerCredentialRef, cashierCredentialRef };
}

function requireReason(value, code = 'reason_required') {
    const text = String(value || '').trim();
    if (!text) throw new CashierOperationsError(code, 'Reason is required');
    return text.slice(0, 1000);
}

function assertFinalConfirmation(body, expectedText, code = 'final_confirmation_required') {
    const value = String(body?.finalConfirmation || body?.final_confirmation || '').trim();
    if (value !== expectedText) {
        throw new CashierOperationsError(code, 'Final confirmation text does not match');
    }
}

function assertBindingAllowsAction(binding, action) {
    const scope = normalizeCapabilityScope(binding?.capability_scope ?? binding?.capabilityScope);
    if (!scope.includes(action)) {
        throw new FiscalAccessError('fiscal_binding_capability_denied', 'Fiscal cashier binding does not allow the requested capability', { action });
    }
}

function integrationOwnerMatchesUser(metadata = {}, user = {}) {
    const ownerUserId = Number(metadata?.integration_owner);
    const userId = Number(user?.id);
    return Number.isSafeInteger(ownerUserId)
        && ownerUserId > 0
        && Number.isSafeInteger(userId)
        && userId === ownerUserId;
}

function resolvePhase1CloseAvailability({
    user,
    binding,
    registerMetadata = {},
    shift = null,
    blockerCount = 0,
    checkboxIntegrationEnabled = false,
    registerFeatureEnabled = false,
    runtimeConfigResolvable = false
} = {}) {
    const ownerConfigured = Number.isSafeInteger(Number(registerMetadata?.integration_owner))
        && Number(registerMetadata.integration_owner) > 0;
    const ownerMatches = integrationOwnerMatchesUser(registerMetadata, user);
    const canonicalCapability = canUseAction(user, 'fiscal.shift.close');
    const bindingCapability = normalizeCapabilityScope(binding?.capability_scope ?? binding?.capabilityScope)
        .includes('fiscal.shift.close');
    const visible = ownerMatches && canonicalCapability;
    let reasonCode = 'ready';
    if (!ownerConfigured) reasonCode = 'integration_owner_missing';
    else if (!ownerMatches) reasonCode = 'integration_owner_only';
    else if (!canonicalCapability) reasonCode = 'capability_denied';
    else if (!bindingCapability) reasonCode = 'binding_capability_denied';
    else if (!checkboxIntegrationEnabled) reasonCode = 'global_integration_disabled';
    else if (!registerFeatureEnabled) reasonCode = 'register_disabled';
    else if (!runtimeConfigResolvable) reasonCode = 'credentials_missing';
    else if (!shift) reasonCode = 'no_open_shift';
    else if (shift.status === 'opening' || ['CREATED', 'OPENING'].includes(shift.lifecycle_stage)) reasonCode = 'shift_opening';
    else if (shift.status === 'closing' || shift.lifecycle_stage === 'CLOSING') reasonCode = 'shift_closing';
    else if (shift.status !== 'open' || shift.lifecycle_stage !== 'OPENED' || !shift.provider_shift_id) reasonCode = 'shift_not_provider_open';
    else if (Number(blockerCount || 0) > 0) reasonCode = 'unresolved_operations';
    const shiftId = Number.isSafeInteger(Number(shift?.id)) && Number(shift.id) > 0 ? Number(shift.id) : null;
    const lifecycleStatus = String(shift?.lifecycle_stage || shift?.status || '').trim().toUpperCase();
    return {
        visible,
        allowed: visible && reasonCode === 'ready',
        reasonCode,
        shiftId,
        status: ['CREATED', 'OPENING', 'OPENED', 'CLOSING', 'CLOSED'].includes(lifecycleStatus)
            ? lifecycleStatus
            : null
    };
}

function applyPhase1CloseReadiness(phase1Close = {}, readiness = {}) {
    const state = {
        visible: phase1Close.visible === true,
        allowed: phase1Close.allowed === true,
        reasonCode: String(phase1Close.reasonCode || 'not_available'),
        shiftId: Number.isSafeInteger(Number(phase1Close.shiftId)) && Number(phase1Close.shiftId) > 0
            ? Number(phase1Close.shiftId)
            : null,
        status: ['CREATED', 'OPENING', 'OPENED', 'CLOSING', 'CLOSED'].includes(String(phase1Close.status || '').trim().toUpperCase())
            ? String(phase1Close.status).trim().toUpperCase()
            : null
    };
    if (!state.visible || !state.allowed) return state;
    if (readiness.checkboxIntegrationEnabled !== true) {
        return { ...state, allowed: false, reasonCode: 'global_integration_disabled' };
    }
    if (readiness.paymentAcceptanceEnabled === true && phase1Close.testDrainActive !== true) {
        return { ...state, allowed: false, reasonCode: 'phase1_close_requires_payment_drain' };
    }
    if (readiness.providerReady !== true) {
        const code = String(readiness.readinessCode || '').trim();
        const allowedCodes = new Set([
            'provider_unavailable',
            'readiness_missing',
            'readiness_stale',
            'checkbox_cashier_identity_mismatch',
            'checkbox_organization_identity_mismatch',
            'checkbox_register_identity_mismatch',
            'checkbox_signature_unavailable',
            'checkbox_certificate_unavailable',
            'shift_opening',
            'shift_closing',
            'local_shift_requires_reconciliation'
        ]);
        return { ...state, allowed: false, reasonCode: allowedCodes.has(code) ? code : 'provider_not_ready' };
    }
    if (readiness.shiftState !== 'open') {
        return { ...state, allowed: false, reasonCode: 'provider_shift_not_open' };
    }
    return state;
}

async function withTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function loadOpenShift(client, { fiscalProfileId, fiscalRegisterId }) {
    const result = await client.query(
        `SELECT fs.*, fr.fiscal_location_id, fr.register_alias, fp.crm_profile_key,
                open_operation.status AS open_operation_status,
                open_operation.provider_cashier_id AS open_provider_cashier_id,
                open_operation.cashier_credential_ref AS open_cashier_credential_ref,
                open_operation.request_snapshot AS open_operation_request_snapshot,
                open_job.status AS open_job_status
           FROM fiscal_shifts fs
           JOIN fiscal_registers fr
             ON fr.id = fs.fiscal_register_id
            AND fr.fiscal_profile_id = fs.fiscal_profile_id
           JOIN fiscal_profiles fp
             ON fp.id = fs.fiscal_profile_id
           LEFT JOIN fiscal_operations open_operation
             ON open_operation.id = fs.open_operation_id
            AND open_operation.fiscal_profile_id = fs.fiscal_profile_id
            AND open_operation.fiscal_register_id = fs.fiscal_register_id
            AND open_operation.fiscal_shift_id = fs.id
            AND open_operation.operation_type = 'shift_open'
           LEFT JOIN LATERAL (
                SELECT job.status
                  FROM payment_outbox_jobs job
                 WHERE job.fiscal_profile_id = fs.fiscal_profile_id
                   AND job.fiscal_operation_id = open_operation.id
                   AND job.job_type = 'shift_open'
                 ORDER BY job.id DESC
                 LIMIT 1
           ) open_job ON TRUE
          WHERE fs.fiscal_profile_id = $1
            AND fs.fiscal_register_id = $2
            AND (
                fs.status = ANY($3::text[])
                OR fs.lifecycle_stage = ANY($4::text[])
            )
          ORDER BY fs.opened_at DESC NULLS LAST, fs.id DESC
          FOR UPDATE OF fs`,
        [fiscalProfileId, fiscalRegisterId, OPEN_SHIFT_STATUSES, UNRESOLVED_SHIFT_LIFECYCLE_STAGES]
    );
    if (result.rows.length > 1) {
        throw new CashierOperationsError('ambiguous_open_shift', 'More than one open shift found for register', { status: 409 });
    }
    return result.rows[0] || null;
}

async function assertOpenShift(client, { fiscalProfileId, fiscalRegisterId }) {
    await assertRegisterAccepting(client, fiscalProfileId, fiscalRegisterId);
    const shift = await loadOpenShift(client, { fiscalProfileId, fiscalRegisterId });
    if (!shift) {
        throw new CashierOperationsError('shift_not_open', 'Fiscal shift must be open for this operation', { status: 409 });
    }
    return shift;
}

async function insertAudit(client, {
    fiscalProfileId,
    actorUserId,
    eventType,
    entityTable,
    entityId,
    idempotencyKey,
    beforeSnapshot = {},
    afterSnapshot = {}
}) {
    await client.query(
        `INSERT INTO fiscal_audit_events (
             fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
             idempotency_key, before_snapshot, after_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [
            fiscalProfileId,
            actorUserId || null,
            eventType,
            entityTable,
            String(entityId),
            idempotencyKey,
            JSON.stringify(beforeSnapshot || {}),
            JSON.stringify(afterSnapshot || {})
        ]
    );
}

async function insertOutboxJob(client, {
    fiscalProfileId,
    fiscalOperationId,
    paymentOrderId = null,
    jobType,
    idempotencyKey,
    priority = 100,
    payload = {}
}) {
    const result = await client.query(
        `INSERT INTO payment_outbox_jobs (
             fiscal_profile_id, fiscal_operation_id, payment_order_id, job_type,
             status, idempotency_key, priority, payload
         )
         VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [fiscalProfileId, fiscalOperationId, paymentOrderId, jobType, idempotencyKey, priority, JSON.stringify(payload || {})]
    );
    return result.rows[0] || null;
}

async function loadImmutableProviderConfiguration(client, {
    user,
    fiscalProfileId,
    fiscalLocationId,
    fiscalRegisterId,
    crmProfileKey,
    env = process.env
}) {
    if (!isCheckboxIntegrationEnabled(env)) {
        throw new CashierOperationsError(
            'checkbox_integration_disabled',
            'Checkbox integration is disabled',
            { status: 503 }
        );
    }
    const result = await client.query(
        `SELECT
             fp.id AS fiscal_profile_id,
             fp.crm_profile_key,
             fp.legal_entity_key,
             fp.provider_organization_id,
             fl.id AS fiscal_location_id,
             fl.provider_outlet_id,
             fr.id AS fiscal_register_id,
             fr.register_alias,
             fr.provider,
             fr.provider_register_id,
             fr.provider_license_ref,
             fr.feature_enabled,
             COALESCE(fr.metadata->>'expected_is_test', fr.metadata->>'expectedIsTest') AS register_expected_is_test,
             binding.provider_cashier_id,
             binding.provider_cashier_login_ref
           FROM fiscal_profiles fp
           JOIN fiscal_locations fl
             ON fl.fiscal_profile_id = fp.id
            AND fl.crm_profile_key = fp.crm_profile_key
            AND fl.status = 'active'
           JOIN fiscal_registers fr
             ON fr.fiscal_profile_id = fp.id
            AND fr.fiscal_location_id = fl.id
            AND fr.crm_profile_key = fp.crm_profile_key
            AND fr.status = 'active'
           JOIN fiscal_cashier_bindings binding
             ON binding.fiscal_profile_id = fp.id
            AND binding.fiscal_location_id = fl.id
            AND binding.fiscal_register_id = fr.id
            AND binding.user_id = $5
            AND binding.status = 'active'
          WHERE fp.id = $1
            AND fl.id = $2
            AND fr.id = $3
            AND fp.crm_profile_key = $4
            AND fp.status = 'active'
          FOR SHARE OF fp, fl, fr, binding`,
        [
            normalizePositiveId(fiscalProfileId, 'fiscal_profile_required'),
            normalizePositiveId(fiscalLocationId, 'fiscal_location_required'),
            normalizePositiveId(fiscalRegisterId, 'fiscal_register_required'),
            String(crmProfileKey || '').trim(),
            normalizePositiveId(user?.id, 'cashier_user_required')
        ]
    );
    if (result.rows.length !== 1) {
        throw new CashierOperationsError(
            result.rows.length ? 'fiscal_provider_context_ambiguous' : 'fiscal_provider_context_missing',
            'Exact Checkbox provider configuration is unavailable for this fiscal operation',
            { status: 409 }
        );
    }
    const mapping = result.rows[0];
    if (mapping.provider !== 'checkbox' || mapping.feature_enabled !== true) {
        throw new CashierOperationsError(
            mapping.provider !== 'checkbox' ? 'fiscal_provider_not_checkbox' : 'fiscal_register_disabled',
            'The exact Checkbox register is not enabled',
            { status: 409 }
        );
    }
    const missing = [
        ['provider_organization_id', mapping.provider_organization_id],
        ['provider_register_id', mapping.provider_register_id],
        ['provider_cashier_id', mapping.provider_cashier_id],
        ['register_credential_ref', mapping.provider_license_ref],
        ['cashier_credential_ref', mapping.provider_cashier_login_ref]
    ].filter(([, value]) => !String(value || '').trim()).map(([field]) => field);
    const mappingExpectedIsTest = normalizeBoolean(mapping.register_expected_is_test);
    if (mappingExpectedIsTest == null) missing.push('expected_is_test');
    if (missing.length) {
        throw new CashierOperationsError(
            'fiscal_provider_context_incomplete',
            'Checkbox provider configuration is incomplete',
            { status: 409, details: { missing } }
        );
    }
    let runtimeConfig;
    try {
        runtimeConfig = loadCheckboxRuntimeConfig({
            env,
            credentialRef: mapping.provider_cashier_login_ref,
            licenseRef: mapping.provider_license_ref,
            expectedIsTest: mappingExpectedIsTest
        });
    } catch (error) {
        throw new CashierOperationsError(
            'checkbox_runtime_config_unavailable',
            'Checkbox runtime credentials are unavailable',
            { status: 503, details: { code: String(error?.code || 'checkbox_runtime_config_unavailable') } }
        );
    }
    if (runtimeConfig.expectedIsTest !== mappingExpectedIsTest) {
        throw new CashierOperationsError(
            'checkbox_expected_is_test_mismatch',
            'Checkbox runtime and register test-mode expectations do not match',
            { status: 409 }
        );
    }
    const fiscalConfig = buildFiscalConfigurationSnapshot({
        mapping,
        binding: mapping,
        runtimeConfig
    });
    return { mapping, fiscalConfig };
}

async function ensureOpenShiftForSale(client, { order, user, fiscalConfig = null }) {
    await assertRegisterAccepting(client, order.fiscal_profile_id, order.fiscal_register_id);
    const fiscalProfileId = normalizePositiveId(order?.fiscal_profile_id, 'fiscal_profile_required');
    const fiscalRegisterId = normalizePositiveId(order?.fiscal_register_id, 'fiscal_register_required');
    const fiscalLocationId = normalizePositiveId(order?.fiscal_location_id, 'fiscal_location_required');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [fiscalProfileId, fiscalRegisterId]);

    const expectedIsTest = normalizeBoolean(
        fiscalConfig?.snapshot?.expected_is_test
        ?? order?.register_expected_is_test
    );
    const durableRouteOptionId = String(order?.fiscal_sale_route_option_id || '').trim().toLowerCase();
    const durableBusinessContext = String(order?.business_context || '').trim().toLowerCase();
    const snapshotRouteOptionId = String(order?.source_snapshot?.route_option_id || '').trim().toLowerCase();
    const snapshotBusinessContext = String(
        order?.source_snapshot?.business_context
        || order?.source_snapshot?.crm_profile_key
        || ''
    ).trim().toLowerCase();
    let sourceBusinessContext = durableBusinessContext
        || snapshotBusinessContext
        || String(order?.crm_profile_key || '').trim().toLowerCase();
    let sharedTestRegister = expectedIsTest === true
        && order?.source_snapshot?.shared_test_register === true;
    if (durableRouteOptionId) {
        if (!durableBusinessContext
            || (snapshotRouteOptionId && snapshotRouteOptionId !== durableRouteOptionId)
            || (snapshotBusinessContext && snapshotBusinessContext !== durableBusinessContext)) {
            throw new CashierOperationsError(
                'fiscal_sale_route_snapshot_mismatch',
                'Durable fiscal sale route does not match the order snapshot',
                { status: 409 }
            );
        }
        const routeResult = await client.query(
            `SELECT mode, expected_is_test, status, feature_enabled, acceptance_enabled, shared_register_group
               FROM fiscal_sale_routes
              WHERE route_option_id = $1
                AND business_context = $2
                AND fiscal_profile_id = $3
                AND fiscal_register_id = $4
              LIMIT 2`,
            [durableRouteOptionId, durableBusinessContext, fiscalProfileId, fiscalRegisterId]
        );
        if (routeResult.rows.length !== 1) {
            throw new CashierOperationsError(
                'fiscal_sale_route_scope_invalid',
                'Durable fiscal sale route is missing or ambiguous',
                { status: 409 }
            );
        }
        const durableRoute = routeResult.rows[0];
        const routeExpectedIsTest = normalizeBoolean(durableRoute.expected_is_test);
        if (durableRoute.status !== 'active'
            || durableRoute.feature_enabled !== true
            || durableRoute.acceptance_enabled !== true
            || routeExpectedIsTest == null
            || routeExpectedIsTest !== expectedIsTest) {
            throw new CashierOperationsError(
                'fiscal_sale_route_not_ready',
                'Durable fiscal sale route is not ready for mutation',
                { status: 409 }
            );
        }
        sourceBusinessContext = durableBusinessContext;
        sharedTestRegister = durableRoute.mode === 'test'
            && routeExpectedIsTest === true
            && Boolean(String(durableRoute.shared_register_group || '').trim());
        if (order?.source_snapshot?.shared_test_register != null
            && order.source_snapshot.shared_test_register !== sharedTestRegister) {
            throw new CashierOperationsError(
                'fiscal_sale_route_snapshot_mismatch',
                'Shared-register mode does not match the durable fiscal sale route',
                { status: 409 }
            );
        }
    }
    if (sharedTestRegister && !/^[a-z0-9_]+$/.test(sourceBusinessContext)) {
        throw new CashierOperationsError(
            'shared_test_business_context_missing',
            'Shared test register requires an immutable business context',
            { status: 409 }
        );
    }

    const binding = await loadFiscalCashierBinding(client, {
        userId: order.cashier_user_id || user?.id,
        fiscalProfileId,
        fiscalRegisterId,
        bindingId: order.selected_fiscal_cashier_binding_id || null
    });
    if (Number(binding.fiscal_location_id) !== fiscalLocationId
        || Number(binding.register_fiscal_location_id) !== fiscalLocationId) {
        throw new CashierOperationsError(
            'cashier_binding_scope_invalid',
            'Selected cashier is not active for this register location',
            { status: 409 }
        );
    }
    assertFiscalCashierBindingCapability(binding, 'fiscal.shift.open');

    const existing = await loadOpenShift(client, { fiscalProfileId, fiscalRegisterId });
    if (existing) {
        if (sharedTestRegister && String(existing.business_context || '').trim().toLowerCase() !== sourceBusinessContext) {
            throw new CashierOperationsError(
                'shared_test_register_owned_by_other_business',
                'Shared test register is already owned by another business context',
                { status: 409 }
            );
        }
        const openSnapshot = existing.open_operation_request_snapshot || {};
        const openBindingId = Number(openSnapshot.cashier_binding_id);
        const expectedCredentialRef = String(binding.provider_cashier_login_ref || '').trim();
        const openCredentialRef = String(existing.open_cashier_credential_ref || '').trim();
        const expectedProviderCashierId = String(binding.provider_cashier_id || '').trim();
        const openProviderCashierId = String(existing.open_provider_cashier_id || '').trim();
        const bindingIdMismatch = Number.isSafeInteger(openBindingId)
            && openBindingId > 0
            && openBindingId !== Number(binding.id);
        const providerCashierMismatch = (expectedProviderCashierId || openProviderCashierId)
            && expectedProviderCashierId !== openProviderCashierId;
        if (!openCredentialRef
            || openCredentialRef !== expectedCredentialRef
            || providerCashierMismatch
            || bindingIdMismatch) {
            throw new CashierOperationsError(
                'open_shift_cashier_binding_mismatch',
                'Open fiscal shift belongs to a different cashier binding',
                { status: 409 }
            );
        }
        const lifecycleStage = String(existing.lifecycle_stage || '').trim().toUpperCase();
        const shiftStatus = String(existing.status || '').trim().toLowerCase();
        const openJobStatus = String(existing.open_job_status || '').trim().toLowerCase();
        if (lifecycleStage === 'OPENED' && shiftStatus === 'open' && existing.provider_shift_id) {
            return existing;
        }
        if (['CREATED', 'OPENING'].includes(lifecycleStage)
            && ['queued', 'claimed', 'running'].includes(openJobStatus)) {
            return existing;
        }
        throw new CashierOperationsError(
            lifecycleStage === 'CLOSING' ? 'shift_closing' : 'shift_open_recovery_required',
            lifecycleStage === 'CLOSING'
                ? 'Fiscal shift is closing; a new sale cannot start'
                : 'The durable shift-open workflow requires recovery before a new sale can start',
            {
                status: 409,
                details: {
                    fiscalShiftId: Number(existing.id),
                    lifecycleStage: lifecycleStage || null,
                    shiftStatus: shiftStatus || null
                }
            }
        );
    }

    if (sharedTestRegister) {
        const blockers = await client.query(
            `SELECT
                 (SELECT COUNT(*)::int
                    FROM payment_outbox_jobs job
                    LEFT JOIN payment_orders po
                      ON po.id = job.payment_order_id
                     AND po.fiscal_profile_id = job.fiscal_profile_id
                    LEFT JOIN fiscal_operations operation
                      ON operation.id = job.fiscal_operation_id
                     AND operation.fiscal_profile_id = job.fiscal_profile_id
                   WHERE COALESCE(po.fiscal_register_id, operation.fiscal_register_id) = $1
                     AND job.status IN ('queued', 'claimed', 'running', 'failed', 'dead')) AS pending_jobs,
                 (SELECT COUNT(*)::int FROM fiscal_operations
                   WHERE fiscal_register_id = $1 AND status = 'unknown') AS unknown_operations,
                 (SELECT COUNT(*)::int FROM payment_orders
                   WHERE fiscal_register_id = $1
                     AND (payment_status = 'unknown' OR fiscal_status = 'unknown')) AS unknown_orders`,
            [fiscalRegisterId]
        );
        const state = blockers.rows[0] || {};
        if (Number(state.pending_jobs || 0) > 0
            || Number(state.unknown_operations || 0) > 0
            || Number(state.unknown_orders || 0) > 0) {
            throw new CashierOperationsError(
                'shared_test_register_recovery_incomplete',
                'Shared test register cannot switch context while recovery is incomplete',
                { status: 409 }
            );
        }
    }

    const routeScoped = Boolean(
        order?.fiscal_sale_route_option_id
        || order?.source_snapshot?.route_option_id
    );
    if (routeScoped) {
        await authorizeFiscalActorAction(client, {
            user,
            action: 'fiscal.shift.open',
            crmProfileKey: sourceBusinessContext
        });
    } else {
        await authorizeFiscalAction(client, {
            user,
            action: 'fiscal.shift.open',
            fiscalProfileId,
            crmProfileKey: order.crm_profile_key,
            fiscalLocationId,
            fiscalRegisterId
        });
    }

    const credentialRefs = assertCompleteFiscalCredentialRefs(
        { provider_license_ref: order.provider_license_ref },
        binding
    );
    const fiscalSnapshot = fiscalConfig?.snapshot || {};
    const providerContext = {
        provider_organization_id: order.provider_organization_id || null,
        provider_outlet_id: order.provider_outlet_id || null,
        provider_register_id: order.provider_register_id || null,
        provider_cashier_id: binding.provider_cashier_id || null,
        register_credential_ref: credentialRefs.registerCredentialRef,
        cashier_credential_ref: credentialRefs.cashierCredentialRef,
        expected_is_test: normalizeBoolean(fiscalSnapshot.expected_is_test ?? order.register_expected_is_test),
        fiscal_profile_id: fiscalProfileId,
        fiscal_location_id: fiscalLocationId,
        fiscal_register_id: fiscalRegisterId
    };
    const configurationHash = crypto.createHash('sha256')
        .update(JSON.stringify(Object.keys(providerContext).sort().reduce((acc, key) => {
            acc[key] = providerContext[key];
            return acc;
        }, {})))
        .digest('hex');

    const providerRequestUuid = crypto.randomUUID();
    const shift = await client.query(
        `INSERT INTO fiscal_shifts (
             fiscal_profile_id, fiscal_register_id, provider, status,
             opened_by_user_id, lifecycle_stage, business_context, provider_snapshot
         )
         VALUES ($1, $2, 'checkbox', 'opening', $3, 'CREATED', $4, $5::jsonb)
         RETURNING *`,
        [
            fiscalProfileId,
            fiscalRegisterId,
            user?.id || null,
            sourceBusinessContext || order.crm_profile_key,
            JSON.stringify({ auto_opened_before_sale: true, fiscal_location_id: fiscalLocationId, lifecycle_stage: 'CREATED' })
        ]
    );
    const openOperation = await client.query(
        `INSERT INTO fiscal_operations (
             fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
             idempotency_key, provider, provider_operation_id, currency, request_snapshot, initiated_by_user_id,
             provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
             register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash, fiscal_location_id, external_stage
         )
         VALUES ($1, $2, $3, 'shift_open', 'pending', $4, 'checkbox', $5, 'UAH', $6::jsonb, $7,
                 $8, $9, $10, $11, $12, $13, $14, $15, $16, 'auth')
         RETURNING *`,
        [
            fiscalProfileId,
            fiscalRegisterId,
            shift.rows[0].id,
            `fiscal_operation:shift_open:${shift.rows[0].id}`,
            providerRequestUuid,
            JSON.stringify({
                provider_request_uuid: providerRequestUuid,
                auto_opened_before_sale: true,
                cashier_binding_id: Number(binding.id),
                external_stage: 'auth',
                fiscal_configuration_hash: configurationHash,
                provider_context: providerContext
            }),
            user?.id || null,
            providerContext.provider_organization_id,
            providerContext.provider_outlet_id,
            providerContext.provider_register_id,
            providerContext.provider_cashier_id,
            providerContext.register_credential_ref,
            providerContext.cashier_credential_ref,
            providerContext.expected_is_test,
            configurationHash,
            fiscalLocationId
        ]
    );
    await client.query(
        `UPDATE fiscal_shifts
            SET open_operation_id = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [shift.rows[0].id, openOperation.rows[0].id]
    );

    await insertOutboxJob(client, {
        fiscalProfileId,
        fiscalOperationId: openOperation.rows[0].id,
        jobType: 'shift_open',
        idempotencyKey: `payment_outbox:shift_open:${shift.rows[0].id}`,
        priority: 10,
        payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, fiscal_shift_id: Number(shift.rows[0].id), fiscal_register_id: fiscalRegisterId, external_stage: 'auth' }
    });
    await insertAudit(client, {
        fiscalProfileId,
        actorUserId: user?.id,
        eventType: 'fiscal_shift_auto_opened_before_sale',
        entityTable: 'fiscal_shifts',
        entityId: shift.rows[0].id,
        idempotencyKey: `fiscal_shift_auto_opened_before_sale:${shift.rows[0].id}`,
        afterSnapshot: { fiscal_register_id: fiscalRegisterId, fiscal_operation_id: Number(openOperation.rows[0].id), provider_request_uuid: providerRequestUuid }
    });

    return { ...shift.rows[0], fiscal_location_id: fiscalLocationId, crm_profile_key: order.crm_profile_key };
}

async function countPhase1CloseBlockers(client, { fiscalProfileId, fiscalRegisterId } = {}) {
    return countFiscalShiftCloseBlockers(client, { fiscalProfileId, fiscalRegisterId });
}

async function loadPilotRegisterState({
    user,
    crmProfileKey,
    locationAlias,
    registerAlias,
    authorizationCrmProfileKey = null,
    routeOptionId = null,
    cashierBindingId = null
}) {
    return withTransaction(async client => {
        const checkboxIntegrationEnabled = isCheckboxIntegrationEnabled(process.env);
        const cashierProEnabled = isCashierProEnabled(process.env);
        const mapping = await client.query(
            `SELECT
                 fp.id AS fiscal_profile_id,
                 fp.crm_profile_key,
                 fp.legal_entity_key,
                 fp.legal_entity_name,
                 fl.id AS fiscal_location_id,
                 fl.location_alias,
                 fr.id AS fiscal_register_id,
                 fr.register_alias,
                 fr.display_name AS register_display_name,
                 fr.provider,
                 fr.provider_license_ref,
                 fr.status AS fiscal_register_status,
                 fr.feature_enabled,
                 fr.acceptance_enabled,
                 COALESCE(fr.metadata->>'expected_is_test', fr.metadata->>'expectedIsTest') AS register_expected_is_test,
                 fr.metadata AS register_metadata
               FROM fiscal_profiles fp
               JOIN fiscal_locations fl
                 ON fl.fiscal_profile_id = fp.id
                AND fl.crm_profile_key = fp.crm_profile_key
                AND fl.location_alias = $2
                AND fl.status = 'active'
               JOIN fiscal_registers fr
                ON fr.fiscal_profile_id = fp.id
                AND fr.fiscal_location_id = fl.id
                AND fr.crm_profile_key = fp.crm_profile_key
                AND fr.register_alias = $3
                AND fr.status = 'active'
              WHERE fp.crm_profile_key = $1
                AND fp.status = 'active'`,
            [String(crmProfileKey || '').trim(), String(locationAlias || '').trim(), String(registerAlias || '').trim()]
        );
        if (mapping.rows.length !== 1) {
            return {
                checkboxIntegrationEnabled,
                cashierProEnabled,
                mappingExists: false,
                registerFeatureEnabled: false,
                runtimeConfigResolvable: false,
                readinessCode: mapping.rows.length > 1 ? 'mapping_ambiguous' : 'mapping_missing',
                phase1Close: {
                    visible: false,
                    allowed: false,
                    reasonCode: mapping.rows.length > 1 ? 'mapping_ambiguous' : 'mapping_missing',
                    shiftId: null,
                    status: null
                },
                checklist: null
            };
        }
        const row = mapping.rows[0];
        const routedBusinessContext = String(authorizationCrmProfileKey || '').trim().toLowerCase() || null;
        let binding = null;
        if (routedBusinessContext) {
            await authorizeFiscalActorAction(client, {
                user,
                action: 'payments.view',
                crmProfileKey: routedBusinessContext
            });
            const selectedBindingId = cashierBindingId == null ? null : Number(cashierBindingId);
            if (selectedBindingId != null) {
                if (!Number.isSafeInteger(selectedBindingId) || selectedBindingId <= 0) {
                    throw new CashierOperationsError('cashier_binding_id_invalid', 'Cashier binding option is invalid', { status: 422 });
                }
                const selected = await client.query(
                    `SELECT *
                       FROM fiscal_cashier_bindings
                      WHERE id = $1
                        AND fiscal_profile_id = $2
                        AND fiscal_register_id = $3
                        AND provider = 'checkbox'
                        AND status = 'active'
                        AND NULLIF(BTRIM(provider_cashier_login_ref), '') IS NOT NULL
                      LIMIT 2`,
                    [selectedBindingId, row.fiscal_profile_id, row.fiscal_register_id]
                );
                if (selected.rows.length !== 1) {
                    throw new CashierOperationsError('cashier_binding_scope_invalid', 'Selected cashier is not active for this register', { status: 409 });
                }
                binding = selected.rows[0];
                assertFiscalCashierBindingCapability(binding, 'payments.view');
            }
        } else {
            await authorizeFiscalAction(client, {
                user,
                action: 'payments.view',
                fiscalProfileId: row.fiscal_profile_id,
                crmProfileKey: row.crm_profile_key,
                fiscalLocationId: row.fiscal_location_id,
                fiscalRegisterId: row.fiscal_register_id
            });
            binding = await loadFiscalCashierBinding(client, {
                userId: user?.id,
                fiscalProfileId: row.fiscal_profile_id,
                fiscalRegisterId: row.fiscal_register_id
            });
        }
        let runtimeConfigResolvable = false;
        let runtimeConfigErrorCode = null;
        if (checkboxIntegrationEnabled && row.feature_enabled) {
            const registerCredentialRef = String(row.provider_license_ref ?? '').trim();
            const cashierCredentialRef = String(binding?.provider_cashier_login_ref ?? '').trim();
            if (!registerCredentialRef || !cashierCredentialRef) {
                runtimeConfigErrorCode = binding ? 'fiscal_provider_context_incomplete' : 'binding_missing';
            } else {
                try {
                    loadCheckboxRuntimeConfig({
                        env: process.env,
                        credentialRef: cashierCredentialRef,
                        licenseRef: registerCredentialRef,
                        expectedIsTest: row.register_expected_is_test
                    });
                    runtimeConfigResolvable = true;
                } catch (error) {
                    runtimeConfigErrorCode = error.code || 'checkbox_runtime_config_unavailable';
                }
            }
        }
        let readinessCode = 'ready';
        if (!checkboxIntegrationEnabled) readinessCode = 'global_integration_disabled';
        else if (!row.feature_enabled) readinessCode = 'register_disabled';
        else if (!runtimeConfigResolvable) readinessCode = runtimeConfigErrorCode || 'credentials_missing';
        const shiftResult = await client.query(
            `SELECT *
               FROM fiscal_shifts
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND status IN ('opening', 'open', 'closing', 'closed')
              ORDER BY CASE WHEN status IN ('opening', 'open', 'closing') THEN 0 ELSE 1 END,
                       COALESCE(closed_at, opened_at, created_at) DESC NULLS LAST,
                       id DESC
              LIMIT 1`,
            [row.fiscal_profile_id, row.fiscal_register_id]
        );
        const shift = shiftResult.rows[0] || null;
        let phase1CloseBinding = binding;
        let phase1CloseRuntimeConfigResolvable = runtimeConfigResolvable;
        if (shift?.open_operation_id) {
            const openerBinding = await client.query(
                `SELECT candidate.*
                   FROM fiscal_operations open_operation
                   JOIN fiscal_cashier_bindings candidate
                     ON candidate.fiscal_profile_id = open_operation.fiscal_profile_id
                    AND candidate.fiscal_register_id = open_operation.fiscal_register_id
                    AND candidate.fiscal_location_id = open_operation.fiscal_location_id
                    AND candidate.provider = open_operation.provider
                    AND candidate.provider_cashier_id IS NOT DISTINCT FROM open_operation.provider_cashier_id
                    AND candidate.provider_cashier_login_ref = open_operation.cashier_credential_ref
                    AND candidate.status = 'active'
                  WHERE open_operation.id = $1
                    AND open_operation.fiscal_shift_id = $2
                    AND open_operation.fiscal_profile_id = $3
                    AND open_operation.fiscal_register_id = $4
                    AND open_operation.operation_type = 'shift_open'
                    AND open_operation.provider = 'checkbox'
                    AND NULLIF(BTRIM(open_operation.cashier_credential_ref), '') IS NOT NULL
                  LIMIT 2`,
                [shift.open_operation_id, shift.id, row.fiscal_profile_id, row.fiscal_register_id]
            );
            phase1CloseBinding = openerBinding.rows.length === 1 ? openerBinding.rows[0] : null;
            phase1CloseRuntimeConfigResolvable = false;
            if (checkboxIntegrationEnabled && row.feature_enabled && phase1CloseBinding) {
                const registerCredentialRef = String(row.provider_license_ref ?? '').trim();
                const cashierCredentialRef = String(phase1CloseBinding.provider_cashier_login_ref ?? '').trim();
                if (registerCredentialRef && cashierCredentialRef) {
                    try {
                        loadCheckboxRuntimeConfig({
                            env: process.env,
                            credentialRef: cashierCredentialRef,
                            licenseRef: registerCredentialRef,
                            expectedIsTest: row.register_expected_is_test
                        });
                        phase1CloseRuntimeConfigResolvable = true;
                    } catch (_) {
                        phase1CloseRuntimeConfigResolvable = false;
                    }
                }
            }
        }
        const proShiftActive = shift && ['opening', 'open', 'closing'].includes(String(shift.status || '').toLowerCase());
        const checklist = cashierProEnabled && proShiftActive ? await buildCloseChecklist(client, shift) : null;
        const closeBlockerCount = shift ? await countPhase1CloseBlockers(client, {
            fiscalProfileId: row.fiscal_profile_id,
            fiscalRegisterId: row.fiscal_register_id
        }) : 0;
        const phase1Close = resolvePhase1CloseAvailability({
            user,
            binding: phase1CloseBinding,
            registerMetadata: row.register_metadata,
            shift,
            blockerCount: closeBlockerCount,
            checkboxIntegrationEnabled,
            registerFeatureEnabled: Boolean(row.feature_enabled),
            runtimeConfigResolvable: phase1CloseRuntimeConfigResolvable
        });
        const sharedTestDay = await require('./sharedTestDayService').loadSharedTestDayState(client, {
            user, shift, routeOptionId, profileId: row.fiscal_profile_id, registerId: row.fiscal_register_id
        });
        phase1Close.testDrainActive = sharedTestDay.visible && sharedTestDay.localDrainBlocked;
        return {
            sharedTestDay,
            checkboxIntegrationEnabled,
            cashierProEnabled,
            mappingExists: true,
            registerFeatureEnabled: Boolean(row.feature_enabled),
            runtimeConfigResolvable,
            readinessCode,
            fiscalProfileId: Number(row.fiscal_profile_id),
            crmProfileKey: routedBusinessContext || row.crm_profile_key,
            legalEntityKey: row.legal_entity_key,
            legalEntityName: row.legal_entity_name,
            fiscalLocationId: Number(row.fiscal_location_id),
            locationAlias: row.location_alias,
            fiscalRegisterId: Number(row.fiscal_register_id),
            registerAlias: row.register_alias,
            registerDisplayName: row.register_display_name,
            provider: row.provider,
            featureEnabled: Boolean(row.feature_enabled),
            shift: shift ? {
                id: Number(shift.id),
                status: shift.status,
                lifecycleStage: shift.lifecycle_stage || null,
                openedAt: shift.opened_at || null,
                closedAt: shift.closed_at || null
            } : null,
            phase1Close,
            checklist
        };
    });
}
async function createServiceIn({ user, body = {}, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new CashierOperationsError('idempotency_key_required', 'Idempotency-Key is required');
    assertFinalConfirmation(body, 'Готівку внесено — створити службове внесення');
    const fiscalProfileId = normalizePositiveId(body.fiscalProfileId || body.fiscal_profile_id, 'fiscal_profile_required');
    const fiscalRegisterId = normalizePositiveId(body.fiscalRegisterId || body.fiscal_register_id, 'fiscal_register_required');
    const fiscalLocationId = normalizePositiveId(body.fiscalLocationId || body.fiscal_location_id, 'fiscal_location_required');
    const crmProfileKey = String(body.crmProfileKey || body.crm_profile_key || '').trim();
    const minor = amountMinor(body.amountMinor ?? body.amount_minor, 'service_in_amount_required');

    return withTransaction(async client => {
        await authorizeFiscalAction(client, {
            user,
            action: 'fiscal.service_in',
            fiscalProfileId,
            crmProfileKey,
            fiscalLocationId,
            fiscalRegisterId
        });
        const shift = await assertOpenShift(client, { fiscalProfileId, fiscalRegisterId });
        const { fiscalConfig } = await loadImmutableProviderConfiguration(client, {
            user,
            fiscalProfileId,
            fiscalLocationId,
            fiscalRegisterId,
            crmProfileKey
        });
        const providerRequestUuid = crypto.randomUUID();
        const operation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
                 approval_required, server_approval_status, idempotency_key, provider, provider_operation_id, amount_minor, currency,
                 request_snapshot, initiated_by_user_id,
                 provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
                 register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash,
                 fiscal_location_id, external_stage
             )
             VALUES ($1, $2, $3, 'service_in', 'pending', FALSE, 'not_required', $4, 'checkbox', $5, $6, 'UAH', $7::jsonb, $8,
                     $9, $10, $11, $12, $13, $14, $15, $16, $17, 'auth')
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                fiscalProfileId,
                fiscalRegisterId,
                shift.id,
                `fiscal_operation:service_in:${key}`,
                providerRequestUuid,
                toPostgresBigint(minor, { allowZero: false }),
                JSON.stringify({
                    reason: body.reason || null,
                    provider_request_uuid: providerRequestUuid,
                    external_stage: 'auth',
                    fiscal_configuration_hash: fiscalConfig.hash,
                    provider_context: fiscalConfig.snapshot
                }),
                user?.id || null,
                fiscalConfig.snapshot.provider_organization_id,
                fiscalConfig.snapshot.provider_outlet_id,
                fiscalConfig.snapshot.provider_register_id,
                fiscalConfig.snapshot.provider_cashier_id,
                fiscalConfig.snapshot.register_credential_ref,
                fiscalConfig.snapshot.cashier_credential_ref,
                fiscalConfig.snapshot.expected_is_test,
                fiscalConfig.hash,
                fiscalConfig.snapshot.fiscal_location_id
            ]
        );
        if (!operation.rows.length) {
            return { replayed: true };
        }
        await insertOutboxJob(client, {
            fiscalProfileId,
            fiscalOperationId: operation.rows[0].id,
            jobType: 'service_receipt',
            idempotencyKey: `payment_outbox:service_in:${operation.rows[0].id}`,
            payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, operation_type: 'service_in', external_stage: 'auth' }
        });
        await insertAudit(client, {
            fiscalProfileId,
            actorUserId: user?.id,
            eventType: 'fiscal_service_in_requested',
            entityTable: 'fiscal_operations',
            entityId: operation.rows[0].id,
            idempotencyKey: `fiscal_service_in_requested:${operation.rows[0].id}`,
            afterSnapshot: { amount_minor: minor.toString(), fiscal_shift_id: Number(shift.id) }
        });
        return { replayed: false, operationId: Number(operation.rows[0].id), fiscalShiftId: Number(shift.id), providerRequestUuid };
    });
}

async function createServiceOutRequest({ user, body = {}, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new CashierOperationsError('idempotency_key_required', 'Idempotency-Key is required');
    const reason = requireReason(body.reason, 'service_out_reason_required');
    const fiscalProfileId = normalizePositiveId(body.fiscalProfileId || body.fiscal_profile_id, 'fiscal_profile_required');
    const fiscalRegisterId = normalizePositiveId(body.fiscalRegisterId || body.fiscal_register_id, 'fiscal_register_required');
    const fiscalLocationId = normalizePositiveId(body.fiscalLocationId || body.fiscal_location_id, 'fiscal_location_required');
    const crmProfileKey = String(body.crmProfileKey || body.crm_profile_key || '').trim();
    const minor = amountMinor(body.amountMinor ?? body.amount_minor, 'service_out_amount_required');

    return withTransaction(async client => {
        await authorizeFiscalAction(client, {
            user,
            action: 'fiscal.service_out.request',
            fiscalProfileId,
            crmProfileKey,
            fiscalLocationId,
            fiscalRegisterId
        });
        const shift = await assertOpenShift(client, { fiscalProfileId, fiscalRegisterId });
        const { fiscalConfig } = await loadImmutableProviderConfiguration(client, {
            user,
            fiscalProfileId,
            fiscalLocationId,
            fiscalRegisterId,
            crmProfileKey
        });
        const providerRequestUuid = crypto.randomUUID();
        const operation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
                 approval_required, server_approval_status, idempotency_key, provider, provider_operation_id, amount_minor, currency,
                 request_snapshot, initiated_by_user_id,
                 provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
                 register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash,
                 fiscal_location_id, external_stage
             )
             VALUES ($1, $2, $3, 'service_out', 'blocked', TRUE, 'required', $4, 'checkbox', $5, $6, 'UAH', $7::jsonb, $8,
                     $9, $10, $11, $12, $13, $14, $15, $16, $17, 'auth')
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                fiscalProfileId,
                fiscalRegisterId,
                shift.id,
                `fiscal_operation:service_out:${key}`,
                providerRequestUuid,
                toPostgresBigint(minor, { allowZero: false }),
                JSON.stringify({
                    reason,
                    provider_request_uuid: providerRequestUuid,
                    external_stage: 'auth',
                    fiscal_configuration_hash: fiscalConfig.hash,
                    provider_context: fiscalConfig.snapshot
                }),
                user?.id || null,
                fiscalConfig.snapshot.provider_organization_id,
                fiscalConfig.snapshot.provider_outlet_id,
                fiscalConfig.snapshot.provider_register_id,
                fiscalConfig.snapshot.provider_cashier_id,
                fiscalConfig.snapshot.register_credential_ref,
                fiscalConfig.snapshot.cashier_credential_ref,
                fiscalConfig.snapshot.expected_is_test,
                fiscalConfig.hash,
                fiscalConfig.snapshot.fiscal_location_id
            ]
        );
        if (!operation.rows.length) {
            return { replayed: true };
        }
        await insertAudit(client, {
            fiscalProfileId,
            actorUserId: user?.id,
            eventType: 'fiscal_service_out_requested',
            entityTable: 'fiscal_operations',
            entityId: operation.rows[0].id,
            idempotencyKey: `fiscal_service_out_requested:${operation.rows[0].id}`,
            afterSnapshot: { amount_minor: minor.toString(), fiscal_shift_id: Number(shift.id), reason }
        });
        return { replayed: false, operationId: Number(operation.rows[0].id), fiscalShiftId: Number(shift.id), providerRequestUuid };
    });
}

async function approveServiceOut({ user, operationId, body = {}, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new CashierOperationsError('idempotency_key_required', 'Idempotency-Key is required');
    const targetOperationId = normalizePositiveId(operationId, 'fiscal_operation_required');
    if (!canUseAction(user, 'fiscal.service_out.approve')) {
        throw new FiscalAccessError('fiscal_capability_denied', 'User lacks the required payment/fiscal capability');
    }

    const transactionResult = await withTransaction(async client => {
        const locked = await client.query(
            `SELECT fo.*, fr.fiscal_location_id, fp.crm_profile_key
               FROM fiscal_operations fo
               JOIN fiscal_registers fr
                 ON fr.id = fo.fiscal_register_id
                AND fr.fiscal_profile_id = fo.fiscal_profile_id
               JOIN fiscal_profiles fp
                 ON fp.id = fo.fiscal_profile_id
              WHERE fo.id = $1
              FOR UPDATE`,
            [targetOperationId]
        );
        const operation = locked.rows[0];
        if (!operation || operation.operation_type !== 'service_out') {
            throw new CashierOperationsError('service_out_not_found', 'Service-out operation not found', { status: 404 });
        }
        if (operation.status !== 'blocked') {
            throw new CashierOperationsError('service_out_not_pending_approval', 'Service-out is not pending approval', { status: 409 });
        }
        const binding = await loadFiscalCashierBinding(client, {
            userId: user?.id,
            fiscalProfileId: operation.fiscal_profile_id,
            fiscalRegisterId: operation.fiscal_register_id,
            forUpdate: true
        });
        assertBindingAllowsAction(binding, 'fiscal.service_out.approve');
        const approvalResult = await approveFiscalAction({
            actor: user,
            binding,
            operation,
            actionType: 'fiscal.service_out.approve',
            providedPin: body.pin || body.actionPin || body.action_pin,
            context: { operation_id: targetOperationId, idempotency_key: key }
        });
        if (!approvalResult.ok) {
            await persistApprovalPinResult(client, {
                fiscalProfileId: operation.fiscal_profile_id,
                actorUserId: user?.id,
                binding,
                result: approvalResult
            });
            return { pinFailureCode: approvalResult.code };
        }
        await persistApprovalPinResult(client, { fiscalProfileId: operation.fiscal_profile_id, actorUserId: user?.id, binding, result: approvalResult });
        const approval = await insertAndConsumeApproval(client, {
            approvalResult,
            operation,
            actionType: 'fiscal.service_out.approve',
            actorUserId: user?.id
        });
        const providerRequestUuid = String(operation.provider_operation_id || '').trim();
        if (!providerRequestUuid || !operation.fiscal_configuration_hash) {
            throw new CashierOperationsError('service_out_provider_snapshot_missing', 'Service-out immutable provider snapshot is missing', { status: 409 });
        }
        const approved = await client.query(
            `UPDATE fiscal_operations
                SET status = 'pending',
                    approval_id = $2,
                    approved_by_user_id = $3,
                    server_approval_status = 'consumed'
              WHERE id = $1
                AND status = 'blocked'
                AND server_approval_status = 'required'
                AND approval_id IS NULL
                AND provider_operation_id = $4
                AND fiscal_configuration_hash IS NOT NULL
              RETURNING id`,
            [operation.id, approval.id, user?.id || null, providerRequestUuid]
        );
        if (!approved.rows.length) {
            throw new CashierOperationsError('service_out_approval_conflict', 'Service-out approval state changed concurrently', { status: 409 });
        }
        await insertOutboxJob(client, {
            fiscalProfileId: operation.fiscal_profile_id,
            fiscalOperationId: operation.id,
            jobType: 'service_receipt',
            idempotencyKey: `payment_outbox:service_out:${operation.id}`,
            payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, operation_type: 'service_out', external_stage: 'auth' }
        });
        await insertAudit(client, {
            fiscalProfileId: operation.fiscal_profile_id,
            actorUserId: user?.id,
            eventType: 'fiscal_service_out_approved',
            entityTable: 'fiscal_operations',
            entityId: operation.id,
            idempotencyKey: `fiscal_service_out_approved:${operation.id}:${approval.id}`,
            beforeSnapshot: { status: operation.status },
            afterSnapshot: { status: 'pending', approval_id: Number(approval.id) }
        });
        return { operationId: Number(operation.id), approvalId: Number(approval.id), providerRequestUuid };
    });
    if (transactionResult.pinFailureCode) {
        throw new FiscalApprovalError(transactionResult.pinFailureCode, transactionResult.pinFailureCode);
    }
    return transactionResult;
}


async function persistApprovalPinResult(client, { fiscalProfileId, actorUserId, binding, result }) {
    if (!result?.bindingPatch || !binding?.id) return;
    const patch = result.bindingPatch;
    await client.query(
        `UPDATE fiscal_cashier_bindings
            SET pin_failed_attempts = COALESCE($2, pin_failed_attempts),
                pin_last_failed_at = COALESCE($3, pin_last_failed_at),
                pin_locked_until = $4,
                pin_last_verified_at = COALESCE($5, pin_last_verified_at)
          WHERE id = $1`,
        [binding.id, patch.pin_failed_attempts ?? null, patch.pin_last_failed_at ?? null, patch.pin_locked_until ?? null, patch.pin_last_verified_at ?? null]
    );
    if (result.auditEvent) {
        await insertAudit(client, {
            fiscalProfileId,
            actorUserId,
            eventType: result.auditEvent.event_type,
            entityTable: result.auditEvent.entity_table,
            entityId: result.auditEvent.entity_id,
            idempotencyKey: `${result.auditEvent.event_type}:${result.auditEvent.entity_id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            afterSnapshot: result.auditEvent.metadata || {}
        });
    }
}

async function safePublishFiscalEvent(
    client,
    eventType,
    payload,
    aggregateType,
    aggregateId,
    idempotencyKey,
    publish = publishInTransaction
) {
    const savepoint = 'cashier_operations_event_publish';
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
        await publish(client, eventType, payload, aggregateType, aggregateId, idempotencyKey);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (_) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        // EventBus/Hermes failures must not roll back fiscal decisions or audit evidence.
    }
}

function sanitizeOperatorReference(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.replace(/[^\p{L}\p{N}\s._:\/#-]/gu, '').replace(/\s+/g, ' ').slice(0, 160) || null;
}

async function insertApproval(client, approval) {
    const result = await client.query(
        `INSERT INTO fiscal_action_approvals (
             fiscal_profile_id, fiscal_register_id, fiscal_operation_id, action_type,
             target_table, target_id, status, requested_by_user_id, approved_by_user_id,
             approval_hash, approval_context, approved_at, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
         RETURNING *`,
        [
            approval.fiscal_profile_id,
            approval.fiscal_register_id,
            approval.fiscal_operation_id,
            approval.action_type,
            approval.target_table,
            approval.target_id,
            approval.status,
            approval.requested_by_user_id,
            approval.approved_by_user_id,
            approval.approval_hash,
            JSON.stringify(approval.approval_context || {}),
            approval.approved_at,
            approval.expires_at
        ]
    );
    return result.rows[0];
}

async function insertAndConsumeApproval(client, { approvalResult, operation, actionType, actorUserId }) {
    const approval = await insertApproval(client, approvalResult.approval);
    const consumed = await consumeFiscalApprovalInTransaction(client, approval, {
        operationId: operation.id,
        actionType,
        actorUserId
    });
    await insertAudit(client, {
        fiscalProfileId: operation.fiscal_profile_id,
        actorUserId,
        eventType: 'fiscal_action_approval_consumed',
        entityTable: 'fiscal_action_approvals',
        entityId: approval.id,
        idempotencyKey: `fiscal_action_approval_consumed:${approval.id}`,
        afterSnapshot: {
            fiscal_operation_id: Number(operation.id),
            action_type: consumed.action_type,
            consumed: true
        }
    });
    return consumed;
}

async function loadShiftForUserAction(client, { user, shiftId, action }) {
    if (action !== 'fiscal.audit.view') {
        const scoped = (await client.query('SELECT fiscal_profile_id, fiscal_register_id FROM fiscal_shifts WHERE id=$1',
            [normalizePositiveId(shiftId, 'fiscal_shift_required')])).rows[0];
        if (!scoped) throw new CashierOperationsError('shift_not_found', 'Fiscal shift not found', { status: 404 });
        await lockFiscalRegister(client, scoped.fiscal_profile_id, scoped.fiscal_register_id);
    }
    const result = await client.query(
        `SELECT fs.*, fr.fiscal_location_id, fr.register_alias, fp.crm_profile_key
           FROM fiscal_shifts fs
           JOIN fiscal_registers fr
             ON fr.id = fs.fiscal_register_id
            AND fr.fiscal_profile_id = fs.fiscal_profile_id
           JOIN fiscal_profiles fp
             ON fp.id = fs.fiscal_profile_id
          WHERE fs.id = $1
          FOR UPDATE`,
        [normalizePositiveId(shiftId, 'fiscal_shift_required')]
    );
    const shift = result.rows[0];
    if (!shift) throw new CashierOperationsError('shift_not_found', 'Fiscal shift not found', { status: 404 });
    if (action === 'fiscal.reconcile') {
        if (!canUseAction(user, action)) {
            throw new FiscalAccessError('fiscal_capability_denied', 'User lacks the required payment/fiscal capability', { action });
        }
        const binding = await loadFiscalCashierBinding(client, {
            userId: user?.id,
            fiscalProfileId: shift.fiscal_profile_id,
            fiscalRegisterId: shift.fiscal_register_id
        });
        assertBindingAllowsAction(binding, action);
    } else {
        await authorizeFiscalAction(client, {
            user,
            action,
            fiscalProfileId: shift.fiscal_profile_id,
            crmProfileKey: shift.crm_profile_key,
            fiscalLocationId: shift.fiscal_location_id,
            fiscalRegisterId: shift.fiscal_register_id
        });
    }
    return shift;
}

async function buildCloseChecklist(client, shift) {
    const blockers = await client.query(
        `SELECT id, operation_type, status
           FROM fiscal_operations
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND fiscal_shift_id = $3
            AND status = ANY($4::text[])
          ORDER BY id`,
        [shift.fiscal_profile_id, shift.fiscal_register_id, shift.id, CLOSE_BLOCKER_STATUSES]
    );
    const totals = await client.query(
        `SELECT
             COALESCE(SUM(CASE WHEN pa.payment_method = 'cash' THEN pa.amount_minor ELSE 0 END), 0)::bigint AS cash_expected_minor,
             COALESCE(SUM(CASE WHEN pa.payment_method = 'card_terminal' THEN pa.amount_minor ELSE 0 END), 0)::bigint AS terminal_expected_minor
           FROM payment_allocations pa
           JOIN payment_orders po
             ON po.id = pa.payment_order_id
            AND po.fiscal_profile_id = pa.fiscal_profile_id
           JOIN fiscal_operations fo
             ON fo.payment_order_id = po.id
            AND fo.fiscal_profile_id = po.fiscal_profile_id
            AND fo.operation_type = 'sale'
          WHERE pa.fiscal_profile_id = $1
            AND fo.fiscal_register_id = $2
            AND fo.fiscal_shift_id = $3
            AND pa.status = 'recorded'`,
        [shift.fiscal_profile_id, shift.fiscal_register_id, shift.id]
    );
    const service = await client.query(
        `SELECT
             COALESCE(SUM(CASE WHEN operation_type = 'service_in' AND status IN ('pending','fiscalized') THEN amount_minor ELSE 0 END), 0)::bigint AS service_in_minor,
             COALESCE(SUM(CASE WHEN operation_type = 'service_out' AND status IN ('pending','fiscalized') THEN amount_minor ELSE 0 END), 0)::bigint AS service_out_minor
           FROM fiscal_operations
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND fiscal_shift_id = $3`,
        [shift.fiscal_profile_id, shift.fiscal_register_id, shift.id]
    );
    const refunds = await client.query(
        `SELECT
             COALESCE(SUM(CASE WHEN refund_method = 'cash' THEN amount_minor ELSE 0 END), 0)::bigint AS cash_refunds_minor,
             COALESCE(SUM(CASE WHEN refund_method = 'card_terminal' THEN amount_minor ELSE 0 END), 0)::bigint AS terminal_refunds_minor
           FROM payment_refunds
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND fiscal_shift_id = $3
            AND money_refund_status IN ('pending','refunded','unknown')`,
        [shift.fiscal_profile_id, shift.fiscal_register_id, shift.id]
    );
    const saleCash = BigInt(totals.rows[0]?.cash_expected_minor || 0);
    const saleTerminal = BigInt(totals.rows[0]?.terminal_expected_minor || 0);
    const serviceIn = BigInt(service.rows[0]?.service_in_minor || 0);
    const serviceOut = BigInt(service.rows[0]?.service_out_minor || 0);
    const cashRefunds = BigInt(refunds.rows[0]?.cash_refunds_minor || 0);
    const terminalRefunds = BigInt(refunds.rows[0]?.terminal_refunds_minor || 0);
    return {
        pendingUnknownOperations: blockers.rows.map(row => ({ id: Number(row.id), type: row.operation_type, status: row.status })),
        cashExpectedMinor: String(saleCash + serviceIn - serviceOut - cashRefunds),
        terminalExpectedMinor: String(saleTerminal - terminalRefunds),
        salesCashMinor: String(saleCash),
        salesTerminalMinor: String(saleTerminal),
        serviceInMinor: serviceIn.toString(),
        serviceOutMinor: serviceOut.toString(),
        cashRefundsMinor: cashRefunds.toString(),
        terminalRefundsMinor: terminalRefunds.toString()
    };
}

function computeDifference({ checklist, body }) {
    const actualCash = nullableAmountMinor(body.cashActualMinor ?? body.cash_actual_minor);
    const actualTerminal = nullableAmountMinor(body.terminalReportTotalMinor ?? body.terminal_report_total_minor);
    if (actualCash === null || actualTerminal === null) {
        throw new CashierOperationsError('close_actual_totals_required', 'Cash actual and terminal report totals are required');
    }
    const expected = BigInt(checklist.cashExpectedMinor) + BigInt(checklist.terminalExpectedMinor);
    const actual = actualCash + actualTerminal;
    return { actualCash, actualTerminal, difference: actual - expected };
}

async function createReconciliationRevision({ user, shiftId, body = {}, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new CashierOperationsError('idempotency_key_required', 'Idempotency-Key is required');

    const transactionResult = await withTransaction(async client => {
        const shift = await loadShiftForUserAction(client, { user, shiftId, action: 'fiscal.reconcile' });
        await assertRegisterAccepting(client, shift.fiscal_profile_id, shift.fiscal_register_id);
        const checklist = await buildCloseChecklist(client, shift);
        const { actualCash, actualTerminal, difference } = computeDifference({ checklist, body });
        let approval = null;
        let approvalOperation = null;
        const reason = difference !== 0n ? requireReason(body.reason, 'reconciliation_difference_reason_required') : (body.reason || null);
        if (difference !== 0n) {
            const binding = await loadFiscalCashierBinding(client, {
                userId: user?.id,
                fiscalProfileId: shift.fiscal_profile_id,
                fiscalRegisterId: shift.fiscal_register_id,
                forUpdate: true
            });
            assertBindingAllowsAction(binding, 'fiscal.reconcile');
            await client.query('SAVEPOINT fiscal_reconciliation_before_approval');
            const operationResult = await client.query(
                `INSERT INTO fiscal_operations (
                     fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
                     approval_required, server_approval_status, idempotency_key, provider, currency,
                     request_snapshot, initiated_by_user_id
                 )
                 VALUES ($1, $2, $3, 'status_lookup', 'blocked', TRUE, 'required', $4, 'checkbox', 'UAH', $5::jsonb, $6)
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING *`,
                [
                    shift.fiscal_profile_id,
                    shift.fiscal_register_id,
                    shift.id,
                    `fiscal_operation:reconciliation_difference:${shift.id}:${key}`,
                    JSON.stringify({ difference_minor: difference.toString(), reason }),
                    user?.id || null
                ]
            );
            approvalOperation = operationResult.rows[0];
            if (!approvalOperation) {
                throw new CashierOperationsError('reconciliation_difference_already_requested', 'Reconciliation difference approval was already requested for this idempotency key', { status: 409 });
            }
            const approvalResult = await approveFiscalAction({
                actor: user,
                binding,
                operation: approvalOperation,
                actionType: 'fiscal.reconcile',
                providedPin: body.pin || body.actionPin || body.action_pin,
                context: { fiscal_shift_id: Number(shift.id), idempotency_key: key, difference_minor: difference.toString() }
            });
            if (!approvalResult.ok) {
                await client.query('ROLLBACK TO SAVEPOINT fiscal_reconciliation_before_approval');
                await persistApprovalPinResult(client, {
                    fiscalProfileId: shift.fiscal_profile_id,
                    actorUserId: user?.id,
                    binding,
                    result: approvalResult
                });
                return { pinFailureCode: approvalResult.code };
            }
            await persistApprovalPinResult(client, { fiscalProfileId: shift.fiscal_profile_id, actorUserId: user?.id, binding, result: approvalResult });
            approval = await insertAndConsumeApproval(client, {
                approvalResult,
                operation: approvalOperation,
                actionType: 'fiscal.reconcile',
                actorUserId: user?.id
            });
            await client.query(
                `UPDATE fiscal_operations
                    SET status = 'not_required',
                        approval_id = $2,
                        approved_by_user_id = $3,
                        server_approval_status = 'consumed'
                  WHERE id = $1`,
                [approvalOperation.id, approval.id, user?.id || null]
            );
        }
        const nextRevision = await client.query(
            `SELECT COALESCE(MAX(revision_number), 0) + 1 AS revision_number
               FROM fiscal_reconciliation_revisions
              WHERE fiscal_profile_id = $1
                AND fiscal_shift_id = $2`,
            [shift.fiscal_profile_id, shift.id]
        );
        const row = await client.query(
            `INSERT INTO fiscal_reconciliation_revisions (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, revision_number,
                 expected_cash_minor, actual_cash_minor, expected_terminal_minor, actual_terminal_minor,
                 difference_minor, currency, reason, approved_by_user_id, created_by_user_id, revision_snapshot
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'UAH', $10, $11, $12, $13::jsonb)
             RETURNING *`,
            [
                shift.fiscal_profile_id,
                shift.fiscal_register_id,
                shift.id,
                nextRevision.rows[0].revision_number,
                checklist.cashExpectedMinor,
                actualCash.toString(),
                checklist.terminalExpectedMinor,
                actualTerminal.toString(),
                difference.toString(),
                reason,
                approval ? user?.id || null : null,
                user?.id || null,
                JSON.stringify({ checklist, approval_operation_id: approvalOperation ? Number(approvalOperation.id) : null, approval_id: approval ? Number(approval.id) : null })
            ]
        );
        if (difference !== 0n) {
            await safePublishFiscalEvent(
                client,
                'reconciliation.difference',
                { fiscalProfileId: Number(shift.fiscal_profile_id), fiscalShiftId: Number(shift.id), differenceMinor: difference.toString() },
                'fiscal_shift',
                String(shift.id),
                `reconciliation.difference:${row.rows[0].id}`
            );
        }
        return { revisionId: Number(row.rows[0].id), fiscalShiftId: Number(shift.id), differenceMinor: difference.toString(), checklist };
    });
    if (transactionResult.pinFailureCode) {
        throw new FiscalApprovalError(transactionResult.pinFailureCode, transactionResult.pinFailureCode);
    }
    return transactionResult;
}

async function closeShift({ user, shiftId, body = {}, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new CashierOperationsError('idempotency_key_required', 'Idempotency-Key is required');
    const result = await withTransaction(async client => {
        const shift = await loadShiftForUserAction(client, { user, shiftId, action: 'fiscal.shift.close' });
        if (shift.status !== 'open') {
            throw new CashierOperationsError('shift_not_open', 'Only open shift can be closed', { status: 409 });
        }
        const checklist = await buildCloseChecklist(client, shift);
        const registerBlockerCount = await countPhase1CloseBlockers(client, {
            fiscalProfileId: shift.fiscal_profile_id,
            fiscalRegisterId: shift.fiscal_register_id
        });
        if (registerBlockerCount > 0) {
            const blockedIdempotencyKey = `shift.close_blocked:${shift.id}:${key}`;
            await safePublishFiscalEvent(
                client,
                'shift.close_blocked',
                {
                    fiscalProfileId: Number(shift.fiscal_profile_id),
                    fiscalRegisterId: Number(shift.fiscal_register_id),
                    fiscalShiftId: Number(shift.id),
                    blockerCount: registerBlockerCount,
                    blockers: checklist.pendingUnknownOperations,
                    phase: 'cashier_pro_shift_close'
                },
                'fiscal_shift',
                String(shift.id),
                blockedIdempotencyKey
            );
            const existingAudit = await client.query(
                `SELECT 1
                   FROM fiscal_audit_events
                  WHERE event_type = 'shift_close_blocked'
                    AND idempotency_key = $1
                  LIMIT 1`,
                [blockedIdempotencyKey]
            );
            if (!existingAudit.rows.length) {
                await insertAudit(client, {
                    fiscalProfileId: shift.fiscal_profile_id,
                    actorUserId: user?.id,
                    eventType: 'shift_close_blocked',
                    entityTable: 'fiscal_shifts',
                    entityId: shift.id,
                    idempotencyKey: blockedIdempotencyKey,
                    afterSnapshot: {
                        blocker_count: registerBlockerCount,
                        phase: 'cashier_pro_shift_close'
                    }
                });
            }
            return { blocked: true, checklist, blockerCount: registerBlockerCount };
        }
        const { actualCash, actualTerminal, difference } = computeDifference({ checklist, body });
        const reason = difference !== 0n ? requireReason(body.reason, 'shift_close_difference_reason_required') : (body.reason || null);
        let binding = null;
        if (difference !== 0n) {
            binding = await loadFiscalCashierBinding(client, {
                userId: user?.id,
                fiscalProfileId: shift.fiscal_profile_id,
                fiscalRegisterId: shift.fiscal_register_id,
                forUpdate: true
            });
            assertBindingAllowsAction(binding, 'fiscal.shift.close');
        }
        const { fiscalConfig } = await loadImmutableProviderConfiguration(client, {
            user,
            fiscalProfileId: shift.fiscal_profile_id,
            fiscalLocationId: shift.fiscal_location_id,
            fiscalRegisterId: shift.fiscal_register_id,
            crmProfileKey: shift.crm_profile_key
        });
        const providerRequestUuid = crypto.randomUUID();
        if (difference !== 0n) {
            await client.query('SAVEPOINT fiscal_shift_close_before_approval');
        }
        const operation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
                 approval_required, server_approval_status, idempotency_key, provider, provider_operation_id,
                 currency, request_snapshot, initiated_by_user_id,
                 provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
                 register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash,
                 fiscal_location_id, external_stage
             )
             VALUES ($1, $2, $3, 'shift_close', $4, $5, $6, $7, 'checkbox', $8, 'UAH', $9::jsonb, $10,
                     $11, $12, $13, $14, $15, $16, $17, $18, $19, 'auth')
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                shift.fiscal_profile_id,
                shift.fiscal_register_id,
                shift.id,
                difference !== 0n ? 'blocked' : 'pending',
                difference !== 0n,
                difference !== 0n ? 'required' : 'not_required',
                `fiscal_operation:shift_close:${shift.id}:${key}`,
                providerRequestUuid,
                JSON.stringify({
                    close_checklist: checklist,
                    cash_actual_minor: actualCash.toString(),
                    terminal_report_total_minor: actualTerminal.toString(),
                    difference_minor: difference.toString(),
                    reason,
                    provider_request_uuid: providerRequestUuid,
                    provider_shift_id: shift.provider_shift_id,
                    external_stage: 'auth',
                    fiscal_configuration_hash: fiscalConfig.hash,
                    provider_context: fiscalConfig.snapshot
                }),
                user?.id || null,
                fiscalConfig.snapshot.provider_organization_id,
                fiscalConfig.snapshot.provider_outlet_id,
                fiscalConfig.snapshot.provider_register_id,
                fiscalConfig.snapshot.provider_cashier_id,
                fiscalConfig.snapshot.register_credential_ref,
                fiscalConfig.snapshot.cashier_credential_ref,
                fiscalConfig.snapshot.expected_is_test,
                fiscalConfig.hash,
                fiscalConfig.snapshot.fiscal_location_id
            ]
        );
        const closeOperation = operation.rows[0];
        if (!closeOperation) {
            throw new CashierOperationsError('shift_close_already_requested', 'Shift close was already requested for this idempotency key', { status: 409 });
        }
        let approval = null;
        if (difference !== 0n) {
            const approvalResult = await approveFiscalAction({
                actor: user,
                binding,
                operation: closeOperation,
                actionType: 'fiscal.shift.close',
                providedPin: body.pin || body.actionPin || body.action_pin,
                context: { fiscal_shift_id: Number(shift.id), idempotency_key: key, difference_minor: difference.toString() }
            });
            if (!approvalResult.ok) {
                await client.query('ROLLBACK TO SAVEPOINT fiscal_shift_close_before_approval');
                await persistApprovalPinResult(client, {
                    fiscalProfileId: shift.fiscal_profile_id,
                    actorUserId: user?.id,
                    binding,
                    result: approvalResult
                });
                return { pinFailureCode: approvalResult.code };
            }
            await persistApprovalPinResult(client, { fiscalProfileId: shift.fiscal_profile_id, actorUserId: user?.id, binding, result: approvalResult });
            approval = await insertAndConsumeApproval(client, {
                approvalResult,
                operation: closeOperation,
                actionType: 'fiscal.shift.close',
                actorUserId: user?.id
            });
            await client.query(
                `UPDATE fiscal_operations
                    SET status = 'pending',
                        approval_id = $2,
                        approved_by_user_id = $3,
                        server_approval_status = 'consumed'
                  WHERE id = $1`,
                [closeOperation.id, approval.id, user?.id || null]
            );
        }
        await client.query(
            `UPDATE fiscal_shifts
                SET status = 'closing',
                    lifecycle_stage = 'CLOSING',
                    closed_by_user_id = $2,
                    close_operation_id = $3,
                    provider_snapshot = provider_snapshot || $4::jsonb,
                    updated_at = NOW()
              WHERE id = $1`,
            [
                shift.id,
                user?.id || null,
                closeOperation.id,
                JSON.stringify({ close_checklist: checklist, cash_actual_minor: actualCash.toString(), terminal_report_total_minor: actualTerminal.toString(), difference_minor: difference.toString(), reason, approval_id: approval ? Number(approval.id) : null })
            ]
        );
        await insertOutboxJob(client, {
            fiscalProfileId: shift.fiscal_profile_id,
            fiscalOperationId: closeOperation.id,
            jobType: 'shift_close',
            idempotencyKey: `payment_outbox:shift_close:${closeOperation.id}`,
            payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, fiscal_shift_id: Number(shift.id), external_stage: 'auth' }
        });
        return { fiscalShiftId: Number(shift.id), fiscalOperationId: Number(closeOperation.id), status: 'closing', providerRequestUuid, checklist, differenceMinor: difference.toString() };
    });
    if (result?.pinFailureCode) {
        throw new FiscalApprovalError(result.pinFailureCode, result.pinFailureCode);
    }
    if (result?.blocked) {
        throw new CashierOperationsError('shift_close_blocked_pending_unknown', 'Pending or unknown fiscal operations block shift close', {
            status: 409,
            details: { checklist: result.checklist, blockerCount: result.blockerCount }
        });
    }
    return result;
}

async function autoCloseShift({ user, shiftId, body = {}, idempotencyKey, env = process.env }) {
    if (String(env[AUTO_CLOSE_FLAG] || '').toLowerCase() !== 'true') {
        throw new CashierOperationsError('auto_close_disabled', 'Fiscal auto-close is disabled by feature flag', { status: 403 });
    }
    return closeShift({ user, shiftId, body, idempotencyKey });
}

async function createFullRefund({ user, orderId, body = {}, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new CashierOperationsError('idempotency_key_required', 'Idempotency-Key is required');
    const reason = requireReason(body.reason, 'refund_reason_required');

    const transactionResult = await withTransaction(async client => {
        const scoped = (await client.query('SELECT fiscal_profile_id, fiscal_register_id FROM payment_orders WHERE id=$1',
            [normalizePositiveId(orderId, 'payment_order_required')])).rows[0];
        if (!scoped) throw new CashierOperationsError('paid_order_receipt_not_found', 'Paid fiscalized order not found', { status: 404 });
        await lockFiscalRegister(client, scoped.fiscal_profile_id, scoped.fiscal_register_id);
        const orderResult = await client.query(
            `SELECT po.*, fr.id AS original_fiscal_receipt_id, fr.provider_receipt_id,
                    freg.fiscal_location_id, fp.crm_profile_key
               FROM payment_orders po
               JOIN fiscal_receipts fr
                 ON fr.payment_order_id = po.id
                AND fr.fiscal_profile_id = po.fiscal_profile_id
                AND fr.receipt_type = 'sale'
               JOIN fiscal_registers freg
                 ON freg.id = po.fiscal_register_id
                AND freg.fiscal_profile_id = po.fiscal_profile_id
               JOIN fiscal_profiles fp
                 ON fp.id = po.fiscal_profile_id
              WHERE po.id = $1
              FOR UPDATE OF po`,
            [normalizePositiveId(orderId, 'payment_order_required')]
        );
        const order = orderResult.rows[0];
        if (!order) throw new CashierOperationsError('paid_order_receipt_not_found', 'Paid fiscalized order not found', { status: 404 });
        if (!canUseAction(user, 'fiscal.refund')) {
            throw new FiscalAccessError('fiscal_capability_denied', 'User lacks the required payment/fiscal capability', { action: 'fiscal.refund' });
        }
        const shift = await assertOpenShift(client, {
            fiscalProfileId: order.fiscal_profile_id,
            fiscalRegisterId: order.fiscal_register_id
        });
        const refundBinding = await loadFiscalCashierBinding(client, {
            userId: user?.id,
            fiscalProfileId: order.fiscal_profile_id,
            fiscalRegisterId: order.fiscal_register_id,
            forUpdate: true
        });
        assertBindingAllowsAction(refundBinding, 'fiscal.refund');
        const { fiscalConfig } = await loadImmutableProviderConfiguration(client, {
            user,
            fiscalProfileId: order.fiscal_profile_id,
            fiscalLocationId: order.fiscal_location_id,
            fiscalRegisterId: order.fiscal_register_id,
            crmProfileKey: order.crm_profile_key
        });
        const providerRequestUuid = crypto.randomUUID();
        const refundMethod = order.payment_method === 'card_terminal' || order.payment_method === 'card_terminal_manual'
            ? 'card_terminal'
            : 'cash';
        if (refundMethod === 'card_terminal' && body.terminalRefundConfirmed !== true) {
            throw new CashierOperationsError('terminal_refund_confirmation_required', 'Card terminal refund must be confirmed before fiscal return', { status: 409 });
        }
        const terminalRefundReference = sanitizeOperatorReference(body.terminalRefundReference || body.terminal_refund_reference);
        const moneyStatus = 'refunded';
        const fiscalStatus = 'pending';
        await client.query('SAVEPOINT fiscal_refund_before_mutation');
        const refund = await client.query(
            `INSERT INTO payment_refunds (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, payment_order_id, fiscal_operation_id,
                 original_fiscal_receipt_id, refund_type, status, refund_method, money_refund_status, fiscal_refund_status,
                 reason, amount_minor, currency, idempotency_key, requested_by_user_id,
                 terminal_refund_reference, terminal_refund_confirmed_at, refund_snapshot
             )
             VALUES ($1, $2, $3, $4, NULL, $5, 'full', 'fiscal_return_pending', $6, $7, $8, $9, $10, 'UAH', $11, $12, $13, $14, $15::jsonb)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                order.fiscal_profile_id,
                order.fiscal_register_id,
                shift.id,
                order.id,
                order.original_fiscal_receipt_id,
                refundMethod,
                moneyStatus,
                fiscalStatus,
                reason,
                order.total_amount_minor,
                `payment_refund:full:${key}`,
                user?.id || null,
                terminalRefundReference,
                moneyStatus === 'refunded' && order.payment_method === 'card_terminal' ? new Date() : null,
                JSON.stringify({
                    original_provider_receipt_id: order.provider_receipt_id,
                    provider_request_uuid: providerRequestUuid,
                    card_terminal_refund_confirmed: Boolean(body.terminalRefundConfirmed)
                })
            ]
        );
        if (!refund.rows.length) {
            return { replayed: true };
        }
        const operation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, payment_order_id, payment_refund_id, fiscal_shift_id, operation_type, status,
                 approval_required, server_approval_status, idempotency_key, provider, provider_operation_id, amount_minor, currency,
                 request_snapshot, initiated_by_user_id,
                 provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
                 register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash,
                 fiscal_location_id, external_stage
             )
             VALUES ($1, $2, $3, $4, $5, 'return', 'blocked', TRUE, 'required', $6, 'checkbox', $7, $8, 'UAH', $9::jsonb, $10,
                     $11, $12, $13, $14, $15, $16, $17, $18, $19, 'auth')
             RETURNING *`,
            [
                order.fiscal_profile_id,
                order.fiscal_register_id,
                order.id,
                refund.rows[0].id,
                shift.id,
                `fiscal_operation:return:${refund.rows[0].id}`,
                providerRequestUuid,
                order.total_amount_minor,
                JSON.stringify({
                    reason,
                    original_fiscal_receipt_id: Number(order.original_fiscal_receipt_id),
                    original_provider_receipt_id: order.provider_receipt_id,
                    provider_request_uuid: providerRequestUuid,
                    external_stage: 'auth',
                    fiscal_configuration_hash: fiscalConfig.hash,
                    provider_context: fiscalConfig.snapshot
                }),
                user?.id || null,
                fiscalConfig.snapshot.provider_organization_id,
                fiscalConfig.snapshot.provider_outlet_id,
                fiscalConfig.snapshot.provider_register_id,
                fiscalConfig.snapshot.provider_cashier_id,
                fiscalConfig.snapshot.register_credential_ref,
                fiscalConfig.snapshot.cashier_credential_ref,
                fiscalConfig.snapshot.expected_is_test,
                fiscalConfig.hash,
                fiscalConfig.snapshot.fiscal_location_id
            ]
        );
        const approvalResult = await approveFiscalAction({
            actor: user,
            binding: refundBinding,
            operation: operation.rows[0],
            actionType: 'fiscal.refund',
            providedPin: body.pin || body.actionPin || body.action_pin,
            context: { refund_id: Number(refund.rows[0].id), idempotency_key: key }
        });
        if (!approvalResult.ok) {
            await client.query('ROLLBACK TO SAVEPOINT fiscal_refund_before_mutation');
            await persistApprovalPinResult(client, {
                fiscalProfileId: order.fiscal_profile_id,
                actorUserId: user?.id,
                binding: refundBinding,
                result: approvalResult
            });
            return { pinFailureCode: approvalResult.code };
        }
        await persistApprovalPinResult(client, { fiscalProfileId: order.fiscal_profile_id, actorUserId: user?.id, binding: refundBinding, result: approvalResult });
        const approval = await insertAndConsumeApproval(client, {
            approvalResult,
            operation: operation.rows[0],
            actionType: 'fiscal.refund',
            actorUserId: user?.id
        });
        await client.query(
            `UPDATE fiscal_operations
                SET status = 'pending',
                    approval_id = $2,
                    approved_by_user_id = $3,
                    server_approval_status = 'consumed'
              WHERE id = $1`,
            [operation.rows[0].id, approval.id, user?.id || null]
        );
        await client.query(
            `UPDATE payment_refunds
                SET fiscal_operation_id = $2,
                    approved_by_user_id = $3,
                    approved_at = NOW()
              WHERE id = $1`,
            [refund.rows[0].id, operation.rows[0].id, user?.id || null]
        );
        await insertOutboxJob(client, {
            fiscalProfileId: order.fiscal_profile_id,
            fiscalOperationId: operation.rows[0].id,
            paymentOrderId: order.id,
            jobType: 'receipt_return',
            idempotencyKey: `payment_outbox:receipt_return:${refund.rows[0].id}`,
            payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, original_fiscal_receipt_id: Number(order.original_fiscal_receipt_id), external_stage: 'auth' }
        });
        return {
            replayed: false,
            refundId: Number(refund.rows[0].id),
            fiscalOperationId: Number(operation.rows[0].id),
            moneyRefundStatus: moneyStatus,
            fiscalRefundStatus: fiscalStatus,
            providerRequestUuid
        };
    });
    if (transactionResult.pinFailureCode) {
        throw new FiscalApprovalError(transactionResult.pinFailureCode, transactionResult.pinFailureCode);
    }
    return transactionResult;
}

async function enrollFiscalActionPin({ user, bindingId, body = {} }) {
    if (!canUseAction(user, 'fiscal.configure')) {
        throw new FiscalAccessError('fiscal_capability_denied', 'User lacks the required payment/fiscal capability', { action: 'fiscal.configure' });
    }
    const normalizedBindingId = normalizePositiveId(bindingId, 'fiscal_binding_required');
    const rawPin = body.actionPin || body.action_pin || body.pin;
    if (rawPin === undefined || rawPin === null || String(rawPin).trim() === '') {
        throw new FiscalApprovalError('action_pin_required', 'Action PIN is required');
    }
    return withTransaction(async client => {
        const result = await client.query(
            `SELECT b.*, fp.crm_profile_key, fr.register_alias
               FROM fiscal_cashier_bindings b
               JOIN fiscal_profiles fp
                 ON fp.id = b.fiscal_profile_id
               JOIN fiscal_registers fr
                 ON fr.id = b.fiscal_register_id
                AND fr.fiscal_profile_id = b.fiscal_profile_id
              WHERE b.id = $1
              FOR UPDATE OF b`,
            [normalizedBindingId]
        );
        const binding = result.rows[0];
        if (!binding) {
            throw new CashierOperationsError('fiscal_binding_not_found', 'Fiscal cashier binding not found', { status: 404 });
        }
        if (Number(binding.user_id) === Number(user?.id)) {
            throw new FiscalApprovalError('action_pin_self_enrollment_denied', 'Fiscal action PIN must be enrolled by a different authorized actor');
        }
        const hash = await createActionPinHash(rawPin);
        await client.query(
            `UPDATE fiscal_cashier_bindings
                SET action_pin_hash = $2,
                    action_pin_set_at = NOW(),
                    action_pin_updated_by_user_id = $3,
                    pin_failed_attempts = 0,
                    pin_last_failed_at = NULL,
                    pin_locked_until = NULL,
                    pin_last_verified_at = NULL
              WHERE id = $1`,
            [binding.id, hash, user?.id || null]
        );
        await insertAudit(client, {
            fiscalProfileId: binding.fiscal_profile_id,
            actorUserId: user?.id,
            eventType: 'fiscal_action_pin_enrolled',
            entityTable: 'fiscal_cashier_bindings',
            entityId: binding.id,
            idempotencyKey: `fiscal_action_pin_enrolled:${binding.id}:${Date.now()}`,
            afterSnapshot: {
                binding_id: Number(binding.id),
                target_user_id: Number(binding.user_id),
                crm_profile_key: binding.crm_profile_key,
                register_alias: binding.register_alias
            }
        });
        return {
            bindingId: Number(binding.id),
            targetUserId: Number(binding.user_id),
            fiscalProfileId: Number(binding.fiscal_profile_id),
            fiscalRegisterId: Number(binding.fiscal_register_id),
            pinEnrolled: true
        };
    });
}

async function getOperationalReport({ user, shiftId }) {
    return withTransaction(async client => {
        const shift = await loadShiftForUserAction(client, { user, shiftId, action: 'fiscal.audit.view' });
        const checklist = await buildCloseChecklist(client, shift);
        const lastReconciliation = await client.query(
            `SELECT *
               FROM fiscal_reconciliation_revisions
              WHERE fiscal_profile_id = $1
                AND fiscal_shift_id = $2
              ORDER BY revision_number DESC
              LIMIT 1`,
            [shift.fiscal_profile_id, shift.id]
        );
        return {
            fiscalShiftId: Number(shift.id),
            internalReportLabel: 'Internal operational report',
            officialZReport: false,
            checkboxZDocumentUrl: safeCheckboxArtifactUrl('https://api.checkbox.ua', shift.provider_snapshot?.z_report_url || shift.provider_snapshot?.document_url || null),
            checklist,
            lastReconciliation: lastReconciliation.rows[0] || null
        };
    });
}

function cashierOperationsErrorResponse(error) {
    if (error instanceof TestDrainError || error instanceof CashierOperationsError || error instanceof FiscalAccessError || error instanceof FiscalApprovalError) {
        return {
            status: error.status || 400,
            body: { success: false, error: error.code, message: error.message, details: error.details || {} }
        };
    }
    return { status: 500, body: { success: false, error: 'cashier_operations_failed', message: 'Cashier operation failed' } };
}

module.exports = {
    AUTO_CLOSE_FLAG,
    CashierOperationsError,
    applyPhase1CloseReadiness,
    ensureOpenShiftForSale,
    integrationOwnerMatchesUser,
    loadPilotRegisterState,
    resolvePhase1CloseAvailability,
    createServiceIn,
    createServiceOutRequest,
    approveServiceOut,
    createReconciliationRevision,
    closeShift,
    autoCloseShift,
    createFullRefund,
    enrollFiscalActionPin,
    getOperationalReport,
    cashierOperationsErrorResponse
};
