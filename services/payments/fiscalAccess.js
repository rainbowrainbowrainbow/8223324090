'use strict';

const { canUseAction } = require('../../middleware/auth');
const { canAccessBusinessContext, normalizeBusinessContext } = require('../businessContext');
const { assertApprovalUsable } = require('./fiscalApprovals');

const PAYMENT_FISCAL_CAPABILITIES = Object.freeze([
    'payments.view',
    'payments.create',
    'payments.confirm_received',
    'fiscal.shift.open',
    'fiscal.shift.close',
    'fiscal.service_in',
    'fiscal.service_out.request',
    'fiscal.service_out.approve',
    'fiscal.refund',
    'fiscal.reconcile',
    'fiscal.audit.view',
    'fiscal.configure'
]);

const APPROVAL_REQUIRED_ACTIONS = Object.freeze(new Set([
    'fiscal.service_out.approve',
    'fiscal.refund',
    'fiscal.reconcile'
]));

class FiscalAccessError extends Error {
    constructor(code, message, details = {}) {
        super(message || code);
        this.name = 'FiscalAccessError';
        this.code = code;
        this.status = code === 'fiscal_authentication_required' ? 401 : 403;
        this.details = details;
    }
}

function normalizePositiveId(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    return numeric;
}

function normalizeProfileKey(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(text)) return '';
    return text;
}

function valueFrom(row, camelKey, snakeKey = camelKey) {
    return row?.[camelKey] ?? row?.[snakeKey];
}

function assertKnownFiscalAction(action) {
    if (!PAYMENT_FISCAL_CAPABILITIES.includes(action)) {
        throw new FiscalAccessError('unknown_fiscal_action', 'Unknown payment/fiscal capability', { action });
    }
}

function assertFiscalBindingScope({ user, binding, fiscalProfileId, crmProfileKey, fiscalLocationId, fiscalRegisterId }) {
    if (!user?.id) {
        throw new FiscalAccessError('fiscal_authentication_required', 'Authenticated user is required');
    }
    if (!binding || typeof binding !== 'object') {
        throw new FiscalAccessError('fiscal_binding_required', 'Explicit fiscal cashier binding is required');
    }

    const requestedProfileId = normalizePositiveId(fiscalProfileId);
    const requestedLocationId = normalizePositiveId(fiscalLocationId);
    const requestedRegisterId = normalizePositiveId(fiscalRegisterId);
    const requestedProfileKey = normalizeProfileKey(crmProfileKey);
    if (!requestedProfileId || !requestedProfileKey || !requestedLocationId || !requestedRegisterId) {
        throw new FiscalAccessError('fiscal_scope_required', 'Fiscal profile, CRM profile, location, and register must be explicit');
    }

    const bindingUserId = normalizePositiveId(valueFrom(binding, 'userId', 'user_id'));
    const bindingProfileId = normalizePositiveId(valueFrom(binding, 'fiscalProfileId', 'fiscal_profile_id'));
    const bindingLocationId = normalizePositiveId(valueFrom(binding, 'fiscalLocationId', 'fiscal_location_id'));
    const bindingRegisterId = normalizePositiveId(valueFrom(binding, 'fiscalRegisterId', 'fiscal_register_id'));
    const registerLocationId = normalizePositiveId(valueFrom(binding, 'registerFiscalLocationId', 'register_fiscal_location_id'));
    const bindingProfileKey = normalizeProfileKey(valueFrom(binding, 'crmProfileKey', 'crm_profile_key'));
    const status = String(valueFrom(binding, 'status') || '').trim().toLowerCase();

    if (status !== 'active') {
        throw new FiscalAccessError('fiscal_binding_inactive', 'Fiscal cashier binding is not active');
    }
    if (bindingUserId !== normalizePositiveId(user.id)) {
        throw new FiscalAccessError('fiscal_binding_wrong_user', 'Fiscal cashier binding does not belong to the user');
    }
    if (bindingProfileId !== requestedProfileId || bindingProfileKey !== requestedProfileKey) {
        throw new FiscalAccessError('fiscal_binding_wrong_profile', 'Fiscal cashier binding does not match the requested CRM/fiscal profile');
    }
    if (bindingRegisterId !== requestedRegisterId) {
        throw new FiscalAccessError('fiscal_binding_wrong_register', 'Fiscal cashier binding does not match the requested register');
    }
    if (bindingLocationId !== requestedLocationId) {
        throw new FiscalAccessError('fiscal_binding_wrong_location', 'Fiscal cashier binding does not match the requested fiscal location');
    }
    if (registerLocationId && registerLocationId !== requestedLocationId) {
        throw new FiscalAccessError('fiscal_register_wrong_location', 'Fiscal register does not belong to the requested fiscal location');
    }
    if (!canAccessBusinessContext(user, normalizeBusinessContext(requestedProfileKey))) {
        throw new FiscalAccessError('fiscal_business_context_denied', 'User cannot access the requested CRM profile');
    }

    return true;
}

function authorizeFiscalActionContext({
    user,
    action,
    binding,
    fiscalProfileId,
    crmProfileKey,
    fiscalLocationId,
    fiscalRegisterId,
    approval,
    now = new Date()
}) {
    assertKnownFiscalAction(action);
    if (!canUseAction(user, action)) {
        throw new FiscalAccessError('fiscal_capability_denied', 'User lacks the required payment/fiscal capability', { action });
    }

    assertFiscalBindingScope({ user, binding, fiscalProfileId, crmProfileKey, fiscalLocationId, fiscalRegisterId });

    if (APPROVAL_REQUIRED_ACTIONS.has(action)) {
        assertApprovalUsable(approval, {
            fiscalProfileId,
            fiscalRegisterId,
            actionType: action,
            actorUserId: user.id,
            now
        });
    }

    return {
        ok: true,
        userId: normalizePositiveId(user.id),
        action,
        fiscalProfileId: normalizePositiveId(fiscalProfileId),
        crmProfileKey: normalizeProfileKey(crmProfileKey),
        fiscalLocationId: normalizePositiveId(fiscalLocationId),
        fiscalRegisterId: normalizePositiveId(fiscalRegisterId),
        approvalRequired: APPROVAL_REQUIRED_ACTIONS.has(action)
    };
}

async function loadFiscalCashierBinding(client, { userId, fiscalProfileId, fiscalRegisterId }) {
    const normalizedUserId = normalizePositiveId(userId);
    const normalizedProfileId = normalizePositiveId(fiscalProfileId);
    const normalizedRegisterId = normalizePositiveId(fiscalRegisterId);
    if (!client?.query || !normalizedUserId || !normalizedProfileId || !normalizedRegisterId) {
        throw new FiscalAccessError('fiscal_binding_lookup_scope_required', 'Binding lookup requires user, fiscal profile, and register');
    }

    const result = await client.query(
        `SELECT
             b.*,
             fp.crm_profile_key,
             fr.fiscal_location_id AS register_fiscal_location_id,
             fl.location_alias
           FROM fiscal_cashier_bindings b
           JOIN fiscal_profiles fp
             ON fp.id = b.fiscal_profile_id
           JOIN fiscal_registers fr
             ON fr.id = b.fiscal_register_id
            AND fr.fiscal_profile_id = b.fiscal_profile_id
           JOIN fiscal_locations fl
             ON fl.id = b.fiscal_location_id
            AND fl.fiscal_profile_id = b.fiscal_profile_id
          WHERE b.user_id = $1
            AND b.fiscal_profile_id = $2
            AND b.fiscal_register_id = $3
            AND b.status = 'active'`,
        [normalizedUserId, normalizedProfileId, normalizedRegisterId]
    );

    if (!result.rows.length) {
        throw new FiscalAccessError('fiscal_binding_not_found', 'No active fiscal cashier binding found');
    }
    if (result.rows.length !== 1) {
        throw new FiscalAccessError('fiscal_binding_ambiguous', 'Ambiguous fiscal cashier binding found');
    }
    return result.rows[0];
}

async function authorizeFiscalAction(client, options) {
    const binding = options.binding || await loadFiscalCashierBinding(client, {
        userId: options.user?.id,
        fiscalProfileId: options.fiscalProfileId,
        fiscalRegisterId: options.fiscalRegisterId
    });
    return authorizeFiscalActionContext({ ...options, binding });
}

module.exports = {
    PAYMENT_FISCAL_CAPABILITIES,
    APPROVAL_REQUIRED_ACTIONS,
    FiscalAccessError,
    assertFiscalBindingScope,
    authorizeFiscalActionContext,
    loadFiscalCashierBinding,
    authorizeFiscalAction,
    normalizePositiveId,
    normalizeProfileKey
};
