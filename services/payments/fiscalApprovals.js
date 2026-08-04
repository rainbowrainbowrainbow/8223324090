'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const PIN_SECRET_ENV_KEYS = Object.freeze([
    'EVENTGENIX_FISCAL_APPROVAL_TEST_PIN',
    'PAYMENT_APPROVAL_TEST_PIN',
    'FISCAL_APPROVAL_TEST_PIN'
]);

const PIN_HASH_ROUNDS = 10;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;
const APPROVAL_TTL_MS = 5 * 60 * 1000;

const ACTION_TYPE_BY_CAPABILITY = Object.freeze({
    'fiscal.service_in': 'service_in',
    'fiscal.service_out.request': 'service_out',
    'fiscal.service_out.approve': 'service_out',
    'fiscal.refund': 'refund',
    'fiscal.reconcile': 'reconciliation_difference',
    'fiscal.shift.close': 'shift_close'
});

class FiscalApprovalError extends Error {
    constructor(code, message, details = {}) {
        super(message || code);
        this.name = 'FiscalApprovalError';
        this.code = code;
        this.status = code === 'action_pin_locked' ? 423 : 403;
        this.details = details;
    }
}

function nowDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return new Date();
    return date;
}

function normalizePositiveId(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    return numeric;
}

function canonicalApprovalActionType(actionType) {
    return ACTION_TYPE_BY_CAPABILITY[actionType] || String(actionType || '').trim();
}

function sanitizePin(value) {
    const text = String(value || '').trim();
    if (!/^\d{4,12}$/.test(text)) {
        throw new FiscalApprovalError('invalid_action_pin_format', 'Action PIN must be 4-12 digits');
    }
    return text;
}

function isProductionLikeEnv(env = process.env) {
    const values = [
        env.NODE_ENV,
        env.RAILWAY_ENVIRONMENT,
        env.RAILWAY_ENVIRONMENT_NAME,
        env.EVENTGENIX_ENV,
        env.APP_ENV
    ].filter(Boolean).map(value => String(value).toLowerCase());
    return values.some(value => value === 'production' || value === 'prod');
}

function assertTestPinModeSafe(env = process.env) {
    if (!isProductionLikeEnv(env)) return true;
    const enabledKey = PIN_SECRET_ENV_KEYS.find(key => Boolean(env[key]));
    if (enabledKey) {
        throw new FiscalApprovalError('test_pin_mode_forbidden_in_production', 'Fiscal approval test PIN mode is disabled in production-like environments', { envKey: enabledKey });
    }
    return true;
}

function createEphemeralActionPin() {
    return String(crypto.randomInt(1000, 1000000)).padStart(6, '0');
}

function resolveTaskTestPin(env = process.env) {
    assertTestPinModeSafe(env);
    const configured = PIN_SECRET_ENV_KEYS.map(key => env[key]).find(Boolean);
    return configured ? sanitizePin(configured) : createEphemeralActionPin();
}

async function createActionPinHash(pin) {
    const normalized = sanitizePin(pin);
    return bcrypt.hash(normalized, PIN_HASH_ROUNDS);
}

async function verifyActionPin(pin, pinHash) {
    const normalized = sanitizePin(pin);
    if (!pinHash || typeof pinHash !== 'string') return false;
    return bcrypt.compare(normalized, pinHash);
}

function stripSensitiveApprovalFields(value) {
    if (!value || typeof value !== 'object') return value;
    const result = Array.isArray(value) ? [] : {};
    for (const [key, child] of Object.entries(value)) {
        if (/pin|password|secret|token/i.test(key)) continue;
        result[key] = stripSensitiveApprovalFields(child);
    }
    return result;
}

async function evaluatePinChallenge({
    binding,
    providedPin,
    now = new Date(),
    verifyHash = verifyActionPin,
    maxAttempts = PIN_MAX_ATTEMPTS,
    lockoutMs = PIN_LOCKOUT_MS
}) {
    const at = nowDate(now);
    const bindingId = normalizePositiveId(binding?.id);
    const currentFailures = Math.max(0, Number(binding?.pin_failed_attempts ?? binding?.pinFailedAttempts ?? 0) || 0);
    const lockedUntilRaw = binding?.pin_locked_until ?? binding?.pinLockedUntil;
    const lockedUntil = lockedUntilRaw ? nowDate(lockedUntilRaw) : null;

    if (!bindingId) {
        throw new FiscalApprovalError('action_pin_binding_required', 'Action PIN requires an explicit fiscal cashier binding');
    }
    if (lockedUntil && lockedUntil > at) {
        throw new FiscalApprovalError('action_pin_locked', 'Action PIN is temporarily locked');
    }
    if (!binding.action_pin_hash && !binding.actionPinHash) {
        throw new FiscalApprovalError('action_pin_not_configured', 'Action PIN hash is not configured for this fiscal binding');
    }

    const ok = await verifyHash(providedPin, binding.action_pin_hash || binding.actionPinHash);
    if (!ok) {
        const nextFailures = currentFailures + 1;
        const nextLockedUntil = nextFailures >= maxAttempts ? new Date(at.getTime() + lockoutMs) : null;
        return {
            ok: false,
            code: nextLockedUntil ? 'action_pin_locked' : 'action_pin_invalid',
            bindingPatch: {
                pin_failed_attempts: nextFailures,
                pin_last_failed_at: at,
                pin_locked_until: nextLockedUntil
            },
            auditEvent: {
                event_type: 'fiscal_action_pin_failed',
                entity_table: 'fiscal_cashier_bindings',
                entity_id: bindingId,
                metadata: {
                    failedAttempts: nextFailures,
                    locked: Boolean(nextLockedUntil)
                }
            }
        };
    }

    return {
        ok: true,
        bindingPatch: {
            pin_failed_attempts: 0,
            pin_locked_until: null,
            pin_last_verified_at: at
        },
        auditEvent: {
            event_type: 'fiscal_action_pin_verified',
            entity_table: 'fiscal_cashier_bindings',
            entity_id: bindingId,
            metadata: { verified: true }
        }
    };
}

function assertDistinctApprover({ actionType, operation, actorUserId }) {
    const canonical = canonicalApprovalActionType(actionType);
    if (canonical !== 'service_out') return true;
    const initiatorId = normalizePositiveId(operation?.initiated_by_user_id ?? operation?.initiatedByUserId ?? operation?.requested_by_user_id ?? operation?.requestedByUserId);
    const approverId = normalizePositiveId(actorUserId);
    if (initiatorId && approverId && initiatorId === approverId) {
        throw new FiscalApprovalError('service_out_distinct_approver_required', 'Service-out initiator cannot approve the same operation');
    }
    return true;
}

function createApprovalRecord({
    actorUserId,
    requestedByUserId = null,
    fiscalProfileId,
    fiscalRegisterId,
    operationId,
    actionType,
    now = new Date(),
    ttlMs = APPROVAL_TTL_MS,
    context = {}
}) {
    const at = nowDate(now);
    const canonical = canonicalApprovalActionType(actionType);
    const profileId = normalizePositiveId(fiscalProfileId);
    const registerId = normalizePositiveId(fiscalRegisterId);
    const approverId = normalizePositiveId(actorUserId);
    const targetOperationId = normalizePositiveId(operationId);
    if (!profileId || !registerId || !approverId || !targetOperationId || !canonical) {
        throw new FiscalApprovalError('approval_scope_required', 'Approval requires profile, register, approver, operation, and action type');
    }

    return {
        fiscal_profile_id: profileId,
        fiscal_register_id: registerId,
        fiscal_operation_id: targetOperationId,
        action_type: canonical,
        target_table: 'fiscal_operations',
        target_id: targetOperationId,
        status: 'approved',
        requested_by_user_id: normalizePositiveId(requestedByUserId),
        approved_by_user_id: approverId,
        approval_hash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
        approval_context: stripSensitiveApprovalFields(context) || {},
        approved_at: at,
        expires_at: new Date(at.getTime() + ttlMs),
        consumed_at: null
    };
}

async function approveFiscalAction({
    actor,
    binding,
    operation,
    actionType,
    providedPin,
    now = new Date(),
    verifyHash = verifyActionPin,
    context = {}
}) {
    const actorUserId = normalizePositiveId(actor?.id ?? actor?.user_id);
    assertDistinctApprover({ actionType, operation, actorUserId });
    const pinResult = await evaluatePinChallenge({ binding, providedPin, now, verifyHash });
    if (!pinResult.ok) return pinResult;

    const approval = createApprovalRecord({
        actorUserId,
        requestedByUserId: operation?.initiated_by_user_id ?? operation?.initiatedByUserId ?? operation?.requested_by_user_id,
        fiscalProfileId: operation?.fiscal_profile_id ?? operation?.fiscalProfileId ?? binding?.fiscal_profile_id,
        fiscalRegisterId: operation?.fiscal_register_id ?? operation?.fiscalRegisterId ?? binding?.fiscal_register_id,
        operationId: operation?.id,
        actionType,
        now,
        context
    });

    return {
        ok: true,
        bindingPatch: pinResult.bindingPatch,
        approval,
        auditEvent: {
            event_type: 'fiscal_action_approved',
            entity_table: 'fiscal_operations',
            entity_id: approval.fiscal_operation_id,
            metadata: stripSensitiveApprovalFields({ actionType: approval.action_type, approvalId: approval.id || null })
        }
    };
}

function assertApprovalUsable(approval, { fiscalProfileId, fiscalRegisterId, operationId = null, actionType, actorUserId = null, now = new Date() }) {
    if (!approval || typeof approval !== 'object') {
        throw new FiscalApprovalError('approval_required', 'Server-side fiscal approval is required');
    }
    const at = nowDate(now);
    const canonical = canonicalApprovalActionType(actionType);
    if (approval.consumed_at || approval.consumedAt) {
        throw new FiscalApprovalError('approval_already_consumed', 'Fiscal approval was already consumed');
    }
    if (approval.status !== 'approved') {
        throw new FiscalApprovalError('approval_not_active', 'Fiscal approval is not active');
    }
    if (approval.expires_at && nowDate(approval.expires_at) <= at) {
        throw new FiscalApprovalError('approval_expired', 'Fiscal approval has expired');
    }
    if (normalizePositiveId(approval.fiscal_profile_id ?? approval.fiscalProfileId) !== normalizePositiveId(fiscalProfileId)) {
        throw new FiscalApprovalError('approval_wrong_profile', 'Fiscal approval belongs to another profile');
    }
    if (normalizePositiveId(approval.fiscal_register_id ?? approval.fiscalRegisterId) !== normalizePositiveId(fiscalRegisterId)) {
        throw new FiscalApprovalError('approval_wrong_register', 'Fiscal approval belongs to another register');
    }
    if (operationId && normalizePositiveId(approval.fiscal_operation_id ?? approval.fiscalOperationId ?? approval.target_id) !== normalizePositiveId(operationId)) {
        throw new FiscalApprovalError('approval_wrong_operation', 'Fiscal approval belongs to another operation');
    }
    if (canonical && canonicalApprovalActionType(approval.action_type ?? approval.actionType) !== canonical) {
        throw new FiscalApprovalError('approval_wrong_action', 'Fiscal approval belongs to another action');
    }
    if (actorUserId && normalizePositiveId(approval.approved_by_user_id ?? approval.approvedByUserId) !== normalizePositiveId(actorUserId)) {
        throw new FiscalApprovalError('approval_wrong_user', 'Fiscal approval belongs to another user');
    }
    return true;
}

function consumeFiscalApproval(approval, { operationId, actionType, now = new Date() }) {
    assertApprovalUsable(approval, {
        fiscalProfileId: approval?.fiscal_profile_id ?? approval?.fiscalProfileId,
        fiscalRegisterId: approval?.fiscal_register_id ?? approval?.fiscalRegisterId,
        operationId,
        actionType,
        now
    });
    return {
        ...approval,
        status: 'consumed',
        consumed_at: nowDate(now)
    };
}

module.exports = {
    PIN_SECRET_ENV_KEYS,
    PIN_MAX_ATTEMPTS,
    PIN_LOCKOUT_MS,
    APPROVAL_TTL_MS,
    ACTION_TYPE_BY_CAPABILITY,
    FiscalApprovalError,
    sanitizePin,
    isProductionLikeEnv,
    assertTestPinModeSafe,
    createEphemeralActionPin,
    resolveTaskTestPin,
    createActionPinHash,
    verifyActionPin,
    stripSensitiveApprovalFields,
    evaluatePinChallenge,
    assertDistinctApprover,
    createApprovalRecord,
    approveFiscalAction,
    assertApprovalUsable,
    consumeFiscalApproval,
    canonicalApprovalActionType
};

