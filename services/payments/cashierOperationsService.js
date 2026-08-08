'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { canUseAction } = require('../../middleware/auth');
const { publishInTransaction } = require('../eventBus');
const {
    FiscalAccessError,
    authorizeFiscalAction,
    loadFiscalCashierBinding
} = require('./fiscalAccess');
const {
    FiscalApprovalError,
    approveFiscalAction
} = require('./fiscalApprovals');
const { toPostgresBigint } = require('./money');
const {
    isCashierProEnabled,
    isCheckboxIntegrationEnabled,
    loadCheckboxRuntimeConfig
} = require('../checkbox/config');

const OPEN_SHIFT_STATUSES = Object.freeze(['opening', 'open']);
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
    return toPostgresBigint(value, { allowZero: true });
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
        `SELECT fs.*, fr.fiscal_location_id, fr.register_alias, fp.crm_profile_key
           FROM fiscal_shifts fs
           JOIN fiscal_registers fr
             ON fr.id = fs.fiscal_register_id
            AND fr.fiscal_profile_id = fs.fiscal_profile_id
           JOIN fiscal_profiles fp
             ON fp.id = fs.fiscal_profile_id
          WHERE fs.fiscal_profile_id = $1
            AND fs.fiscal_register_id = $2
            AND fs.status = ANY($3::text[])
          ORDER BY fs.opened_at DESC NULLS LAST, fs.id DESC
          FOR UPDATE`,
        [fiscalProfileId, fiscalRegisterId, OPEN_SHIFT_STATUSES]
    );
    if (result.rows.length > 1) {
        throw new CashierOperationsError('ambiguous_open_shift', 'More than one open shift found for register', { status: 409 });
    }
    return result.rows[0] || null;
}

async function assertOpenShift(client, { fiscalProfileId, fiscalRegisterId }) {
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

async function ensureOpenShiftForSale(client, { order, user }) {
    const fiscalProfileId = normalizePositiveId(order?.fiscal_profile_id, 'fiscal_profile_required');
    const fiscalRegisterId = normalizePositiveId(order?.fiscal_register_id, 'fiscal_register_required');
    const fiscalLocationId = normalizePositiveId(order?.fiscal_location_id, 'fiscal_location_required');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [fiscalProfileId, fiscalRegisterId]);

    const existing = await loadOpenShift(client, { fiscalProfileId, fiscalRegisterId });
    if (existing) return existing;

    await authorizeFiscalAction(client, {
        user,
        action: 'fiscal.shift.open',
        fiscalProfileId,
        crmProfileKey: order.crm_profile_key,
        fiscalLocationId,
        fiscalRegisterId
    });

    const providerRequestUuid = crypto.randomUUID();
    const shift = await client.query(
        `INSERT INTO fiscal_shifts (
             fiscal_profile_id, fiscal_register_id, provider, status,
             opened_by_user_id, provider_snapshot
         )
         VALUES ($1, $2, 'checkbox', 'opening', $3, $4::jsonb)
         RETURNING *`,
        [
            fiscalProfileId,
            fiscalRegisterId,
            user?.id || null,
            JSON.stringify({ auto_opened_before_sale: true, fiscal_location_id: fiscalLocationId, lifecycle_stage: 'CREATED' })
        ]
    );
    const openOperation = await client.query(
        `INSERT INTO fiscal_operations (
             fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
             idempotency_key, provider, provider_operation_id, currency, request_snapshot, initiated_by_user_id
         )
         VALUES ($1, $2, $3, 'shift_open', 'pending', $4, 'checkbox', $5, 'UAH', $6::jsonb, $7)
         RETURNING *`,
        [
            fiscalProfileId,
            fiscalRegisterId,
            shift.rows[0].id,
            `fiscal_operation:shift_open:${shift.rows[0].id}`,
            providerRequestUuid,
            JSON.stringify({ provider_request_uuid: providerRequestUuid, auto_opened_before_sale: true, external_stage: 'shift_request' }),
            user?.id || null
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
        payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, fiscal_shift_id: Number(shift.rows[0].id), fiscal_register_id: fiscalRegisterId, external_stage: 'shift_request' }
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

async function loadPilotRegisterState({ user, crmProfileKey = 'event_genix', registerAlias = 'middle' }) {
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
                 fr.feature_enabled
               FROM fiscal_profiles fp
               JOIN fiscal_locations fl
                 ON fl.fiscal_profile_id = fp.id
                AND fl.crm_profile_key = fp.crm_profile_key
                AND fl.status = 'active'
               JOIN fiscal_registers fr
                ON fr.fiscal_profile_id = fp.id
                AND fr.fiscal_location_id = fl.id
                AND fr.crm_profile_key = fp.crm_profile_key
                AND fr.register_alias = $2
                AND fr.status = 'active'
              WHERE fp.crm_profile_key = $1
                AND fp.status = 'active'`,
            [String(crmProfileKey || '').trim(), String(registerAlias || '').trim()]
        );
        if (mapping.rows.length !== 1) {
            return {
                checkboxIntegrationEnabled,
                cashierProEnabled,
                mappingExists: false,
                registerFeatureEnabled: false,
                runtimeConfigResolvable: false,
                readinessCode: mapping.rows.length > 1 ? 'mapping_ambiguous' : 'mapping_missing',
                checklist: null
            };
        }
        const row = mapping.rows[0];
        await authorizeFiscalAction(client, {
            user,
            action: 'payments.view',
            fiscalProfileId: row.fiscal_profile_id,
            crmProfileKey: row.crm_profile_key,
            fiscalLocationId: row.fiscal_location_id,
            fiscalRegisterId: row.fiscal_register_id
        });
        const binding = await loadFiscalCashierBinding(client, {
            userId: user?.id,
            fiscalProfileId: row.fiscal_profile_id,
            fiscalRegisterId: row.fiscal_register_id
        });
        let runtimeConfigResolvable = false;
        let runtimeConfigErrorCode = null;
        if (checkboxIntegrationEnabled && row.feature_enabled) {
            try {
                loadCheckboxRuntimeConfig({
                    env: process.env,
                    credentialRef: binding.provider_cashier_login_ref || row.provider_license_ref,
                    licenseRef: row.provider_license_ref
                });
                runtimeConfigResolvable = true;
            } catch (error) {
                runtimeConfigErrorCode = error.code || 'checkbox_runtime_config_unavailable';
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
                AND status IN ('opening', 'open', 'closing')
              ORDER BY opened_at DESC NULLS LAST, id DESC
              LIMIT 1`,
            [row.fiscal_profile_id, row.fiscal_register_id]
        );
        const shift = shiftResult.rows[0] || null;
        const checklist = cashierProEnabled && shift ? await buildCloseChecklist(client, shift) : null;
        return {
            checkboxIntegrationEnabled,
            cashierProEnabled,
            mappingExists: true,
            registerFeatureEnabled: Boolean(row.feature_enabled),
            runtimeConfigResolvable,
            readinessCode,
            fiscalProfileId: Number(row.fiscal_profile_id),
            crmProfileKey: row.crm_profile_key,
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
                openedAt: shift.opened_at || null,
                closedAt: shift.closed_at || null,
                providerShiftId: shift.provider_shift_id || null,
                providerSnapshot: shift.provider_snapshot || {}
            } : null,
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
        const providerRequestUuid = crypto.randomUUID();
        const operation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
                 approval_required, server_approval_status, idempotency_key, provider, provider_operation_id, amount_minor, currency,
                 request_snapshot, initiated_by_user_id
             )
             VALUES ($1, $2, $3, 'service_in', 'pending', FALSE, 'not_required', $4, 'checkbox', $5, $6, 'UAH', $7::jsonb, $8)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                fiscalProfileId,
                fiscalRegisterId,
                shift.id,
                `fiscal_operation:service_in:${key}`,
                providerRequestUuid,
                toPostgresBigint(minor, { allowZero: false }),
                JSON.stringify({ reason: body.reason || null, provider_request_uuid: providerRequestUuid }),
                user?.id || null
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
            payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, operation_type: 'service_in' }
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
        const operation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
                 approval_required, server_approval_status, idempotency_key, provider, amount_minor, currency, request_snapshot, initiated_by_user_id
             )
             VALUES ($1, $2, $3, 'service_out', 'blocked', TRUE, 'required', $4, 'checkbox', $5, 'UAH', $6::jsonb, $7)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                fiscalProfileId,
                fiscalRegisterId,
                shift.id,
                `fiscal_operation:service_out:${key}`,
                toPostgresBigint(minor, { allowZero: false }),
                JSON.stringify({ reason }),
                user?.id || null
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
        return { replayed: false, operationId: Number(operation.rows[0].id), fiscalShiftId: Number(shift.id) };
    });
}

async function approveServiceOut({ user, operationId, body = {}, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new CashierOperationsError('idempotency_key_required', 'Idempotency-Key is required');
    const targetOperationId = normalizePositiveId(operationId, 'fiscal_operation_required');
    if (!canUseAction(user, 'fiscal.service_out.approve')) {
        throw new FiscalAccessError('fiscal_capability_denied', 'User lacks the required payment/fiscal capability');
    }

    return withTransaction(async client => {
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
            fiscalRegisterId: operation.fiscal_register_id
        });
        const approvalResult = await approveFiscalAction({
            actor: user,
            binding,
            operation,
            actionType: 'fiscal.service_out.approve',
            providedPin: body.pin || body.actionPin || body.action_pin,
            context: { operation_id: targetOperationId, idempotency_key: key }
        });
        await persistApprovalPinResult(client, { fiscalProfileId: operation.fiscal_profile_id, actorUserId: user?.id, binding, result: approvalResult });
        if (!approvalResult.ok) {
            throw new FiscalApprovalError(approvalResult.code, approvalResult.code);
        }
        const approval = await insertApproval(client, approvalResult.approval);
        const providerRequestUuid = crypto.randomUUID();
        await client.query(
            `UPDATE fiscal_operations
                SET status = 'pending',
                    provider_operation_id = $2,
                    approval_id = $4,
                    approved_by_user_id = $5,
                    server_approval_status = 'approved',
                    request_snapshot = request_snapshot || $3::jsonb,
                    updated_at = NOW()
              WHERE id = $1`,
            [operation.id, providerRequestUuid, JSON.stringify({ approved_by_user_id: user?.id || null, approval_id: Number(approval.id), provider_request_uuid: providerRequestUuid }), approval.id, user?.id || null]
        );
        await insertOutboxJob(client, {
            fiscalProfileId: operation.fiscal_profile_id,
            fiscalOperationId: operation.id,
            jobType: 'service_receipt',
            idempotencyKey: `payment_outbox:service_out:${operation.id}`,
            payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, operation_type: 'service_out' }
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

async function loadShiftForUserAction(client, { user, shiftId, action }) {
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
        await loadFiscalCashierBinding(client, {
            userId: user?.id,
            fiscalProfileId: shift.fiscal_profile_id,
            fiscalRegisterId: shift.fiscal_register_id
        });
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

    return withTransaction(async client => {
        const shift = await loadShiftForUserAction(client, { user, shiftId, action: 'fiscal.reconcile' });
        const checklist = await buildCloseChecklist(client, shift);
        const { actualCash, actualTerminal, difference } = computeDifference({ checklist, body });
        let approval = null;
        let approvalOperation = null;
        const reason = difference !== 0n ? requireReason(body.reason, 'reconciliation_difference_reason_required') : (body.reason || null);
        if (difference !== 0n) {
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
            const binding = await loadFiscalCashierBinding(client, {
                userId: user?.id,
                fiscalProfileId: shift.fiscal_profile_id,
                fiscalRegisterId: shift.fiscal_register_id
            });
            const approvalResult = await approveFiscalAction({
                actor: user,
                binding,
                operation: approvalOperation,
                actionType: 'fiscal.reconcile',
                providedPin: body.pin || body.actionPin || body.action_pin,
                context: { fiscal_shift_id: Number(shift.id), idempotency_key: key, difference_minor: difference.toString() }
            });
            await persistApprovalPinResult(client, { fiscalProfileId: shift.fiscal_profile_id, actorUserId: user?.id, binding, result: approvalResult });
            if (!approvalResult.ok) {
                throw new FiscalApprovalError(approvalResult.code, approvalResult.code);
            }
            approval = await insertApproval(client, approvalResult.approval);
            await client.query(
                `UPDATE fiscal_operations
                    SET status = 'not_required',
                        approval_id = $2,
                        approved_by_user_id = $3,
                        server_approval_status = 'approved',
                        updated_at = NOW()
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
            await publishInTransaction(
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
}

async function closeShift({ user, shiftId, body = {}, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new CashierOperationsError('idempotency_key_required', 'Idempotency-Key is required');
    return withTransaction(async client => {
        const shift = await loadShiftForUserAction(client, { user, shiftId, action: 'fiscal.shift.close' });
        if (shift.status !== 'open') {
            throw new CashierOperationsError('shift_not_open', 'Only open shift can be closed', { status: 409 });
        }
        const checklist = await buildCloseChecklist(client, shift);
        if (checklist.pendingUnknownOperations.length) {
            await publishInTransaction(
                client,
                'shift.close_blocked',
                { fiscalProfileId: Number(shift.fiscal_profile_id), fiscalShiftId: Number(shift.id), blockers: checklist.pendingUnknownOperations },
                'fiscal_shift',
                String(shift.id),
                `shift.close_blocked:${shift.id}:${key}`
            );
            throw new CashierOperationsError('shift_close_blocked_pending_unknown', 'Pending or unknown fiscal operations block shift close', { status: 409, details: { checklist } });
        }
        const { actualCash, actualTerminal, difference } = computeDifference({ checklist, body });
        const reason = difference !== 0n ? requireReason(body.reason, 'shift_close_difference_reason_required') : (body.reason || null);
        const providerRequestUuid = crypto.randomUUID();
        const operation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
                 approval_required, server_approval_status, idempotency_key, provider, provider_operation_id,
                 currency, request_snapshot, initiated_by_user_id
             )
             VALUES ($1, $2, $3, 'shift_close', $4, $5, $6, $7, 'checkbox', $8, 'UAH', $9::jsonb, $10)
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
                JSON.stringify({ close_checklist: checklist, cash_actual_minor: actualCash.toString(), terminal_report_total_minor: actualTerminal.toString(), difference_minor: difference.toString(), reason }),
                user?.id || null
            ]
        );
        const closeOperation = operation.rows[0];
        if (!closeOperation) {
            throw new CashierOperationsError('shift_close_already_requested', 'Shift close was already requested for this idempotency key', { status: 409 });
        }
        let approval = null;
        if (difference !== 0n) {
            const binding = await loadFiscalCashierBinding(client, {
                userId: user?.id,
                fiscalProfileId: shift.fiscal_profile_id,
                fiscalRegisterId: shift.fiscal_register_id
            });
            const approvalResult = await approveFiscalAction({
                actor: user,
                binding,
                operation: closeOperation,
                actionType: 'fiscal.shift.close',
                providedPin: body.pin || body.actionPin || body.action_pin,
                context: { fiscal_shift_id: Number(shift.id), idempotency_key: key, difference_minor: difference.toString() }
            });
            await persistApprovalPinResult(client, { fiscalProfileId: shift.fiscal_profile_id, actorUserId: user?.id, binding, result: approvalResult });
            if (!approvalResult.ok) {
                throw new FiscalApprovalError(approvalResult.code, approvalResult.code);
            }
            approval = await insertApproval(client, approvalResult.approval);
            await client.query(
                `UPDATE fiscal_operations
                    SET status = 'pending',
                        approval_id = $2,
                        approved_by_user_id = $3,
                        server_approval_status = 'approved',
                        updated_at = NOW()
                  WHERE id = $1`,
                [closeOperation.id, approval.id, user?.id || null]
            );
        }
        await client.query(
            `UPDATE fiscal_shifts
                SET status = 'closing',
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
            payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, fiscal_shift_id: Number(shift.id) }
        });
        return { fiscalShiftId: Number(shift.id), fiscalOperationId: Number(closeOperation.id), status: 'closing', providerRequestUuid, checklist, differenceMinor: difference.toString() };
    });
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

    return withTransaction(async client => {
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
        const refundBinding = await loadFiscalCashierBinding(client, {
            userId: user?.id,
            fiscalProfileId: order.fiscal_profile_id,
            fiscalRegisterId: order.fiscal_register_id
        });
        const shift = await assertOpenShift(client, {
            fiscalProfileId: order.fiscal_profile_id,
            fiscalRegisterId: order.fiscal_register_id
        });
        const providerRequestUuid = crypto.randomUUID();
        const moneyStatus = order.payment_method === 'card_terminal'
            ? (body.terminalRefundConfirmed ? 'refunded' : 'pending')
            : 'refunded';
        const fiscalStatus = 'pending';
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
                order.payment_method === 'card_terminal' ? 'card_terminal' : 'cash',
                moneyStatus,
                fiscalStatus,
                reason,
                order.total_amount_minor,
                `payment_refund:full:${key}`,
                user?.id || null,
                body.terminalRefundReference || body.terminal_refund_reference || null,
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
                 approval_required, server_approval_status, idempotency_key, provider, provider_operation_id, amount_minor, currency, request_snapshot, initiated_by_user_id
             )
             VALUES ($1, $2, $3, $4, $5, 'return', 'blocked', TRUE, 'required', $6, 'checkbox', $7, $8, 'UAH', $9::jsonb, $10)
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
                JSON.stringify({ reason, original_fiscal_receipt_id: Number(order.original_fiscal_receipt_id), provider_request_uuid: providerRequestUuid }),
                user?.id || null
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
        await persistApprovalPinResult(client, { fiscalProfileId: order.fiscal_profile_id, actorUserId: user?.id, binding: refundBinding, result: approvalResult });
        if (!approvalResult.ok) {
            throw new FiscalApprovalError(approvalResult.code, approvalResult.code);
        }
        const approval = await insertApproval(client, approvalResult.approval);
        await client.query(
            `UPDATE fiscal_operations
                SET status = 'pending',
                    approval_id = $2,
                    approved_by_user_id = $3,
                    server_approval_status = 'approved',
                    updated_at = NOW()
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
            payload: { provider: 'checkbox', provider_request_uuid: providerRequestUuid, original_fiscal_receipt_id: Number(order.original_fiscal_receipt_id) }
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
            checkboxZDocumentUrl: shift.provider_snapshot?.z_report_url || shift.provider_snapshot?.document_url || null,
            checklist,
            lastReconciliation: lastReconciliation.rows[0] || null
        };
    });
}

function cashierOperationsErrorResponse(error) {
    if (error instanceof CashierOperationsError || error instanceof FiscalAccessError || error instanceof FiscalApprovalError) {
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
    ensureOpenShiftForSale,
    loadPilotRegisterState,
    createServiceIn,
    createServiceOutRequest,
    approveServiceOut,
    createReconciliationRevision,
    closeShift,
    autoCloseShift,
    createFullRefund,
    getOperationalReport,
    cashierOperationsErrorResponse
};
