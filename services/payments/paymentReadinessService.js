'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { authorizeFiscalAction, loadFiscalCashierBinding, FiscalAccessError } = require('./fiscalAccess');
const {
    isCheckboxIntegrationEnabled,
    isCheckboxPaymentAcceptanceEnabled,
    loadCheckboxRuntimeConfig
} = require('../checkbox/config');
const {
    CheckboxClientError,
    redactCheckboxDiagnostics
} = require('../checkbox/errors');
const {
    OPEN_SHIFT_STATUS,
    createProviderFromConfig,
    getCurrentShiftWithAbsenceProof,
    normalizeShiftResponse
} = require('../checkbox/provider');
const { requestPaymentOutboxWakeup } = require('./paymentOutboxWakeup');

const PILOT_CRM_PROFILE_KEY = 'event_genix';
const PILOT_REGISTER_ALIAS = 'middle';
const READINESS_TTL_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 8 * 1000;
const READINESS_PROBE_IN_FLIGHT = new Map();
const UNRESOLVED_FISCAL_STATUSES = Object.freeze(['pending', 'unknown', 'failed', 'validating', 'ready_to_send', 'sending', 'blocked']);
const TERMINAL_FAILURE_FISCAL_STATUSES = new Set(['blocked', 'validation_failed']);

class PaymentReadinessError extends Error {
    constructor(code, message, { status = 400, details = null } = {}) {
        super(message || code);
        this.name = 'PaymentReadinessError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
        this.details = details;
    }
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function fingerprint(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    const text = String(value || '').trim().toLowerCase();
    if (!text) return null;
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return null;
}

function normalizeReadinessTender(value) {
    const tender = String(value || '').trim().toLowerCase();
    if (!tender) return null;
    if (tender === 'cash') return 'cash';
    if (['card_terminal', 'card_terminal_manual'].includes(tender)) return 'card_terminal_manual';
    throw new PaymentReadinessError('payment_tender_unsupported', 'Unsupported tender for Checkbox readiness', {
        status: 422,
        details: { tender }
    });
}

function resolveUnreportedPaymentPermissionPolicy({ env = process.env, expectedIsTest = null } = {}) {
    const requested = normalizeBoolean(env?.CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS) === true;
    return {
        requested,
        allowed: requested && expectedIsTest === true
    };
}

function paymentPermissionSnapshotDetails(result = {}, requiredTender = null) {
    const permissions = result?.permissions && typeof result.permissions === 'object'
        ? result.permissions
        : {};
    const unreported = Array.isArray(permissions.unreported)
        ? permissions.unreported.map(value => String(value || '').trim()).filter(Boolean)
        : [];
    const permissionKey = normalizeReadinessTender(requiredTender) === 'cash'
        ? 'cash_payment'
        : normalizeReadinessTender(requiredTender) === 'card_terminal_manual'
            ? 'card_payment'
            : null;
    const relevantUnreported = permissionKey
        ? unreported.filter(value => value === permissionKey)
        : unreported;
    return {
        warning: relevantUnreported.length ? String(permissions.warning || 'permission_unreported') : null,
        unreported: relevantUnreported
    };
}

function nowIso(now = new Date()) {
    return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function millisBetween(start, end) {
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

function readinessExpiresAt(now = new Date(), ttlMs = READINESS_TTL_MS) {
    return new Date(new Date(now).getTime() + Math.max(5_000, Math.min(Number(ttlMs || READINESS_TTL_MS), 5 * 60 * 1000)));
}

function publicError(error) {
    const code = String(error?.code || error?.name || 'checkbox_readiness_error').slice(0, 80);
    const status = Number(error?.status || error?.statusCode || 503);
    const sanitized = redactCheckboxDiagnostics({
        message: String(error?.message || code),
        details: error?.details == null ? null : error.details
    });
    return {
        code,
        status,
        retryable: error?.retryable === true,
        unknown: error?.unknown === true,
        message: String(sanitized.message || code).slice(0, 500),
        details: sanitized.details
    };
}

function publicFiscalQueueStatus(row = {}) {
    const fiscalStatus = String(row.fiscal_status || row.fiscalStatus || '').trim().toLowerCase();
    const outboxStatus = String(row.outbox_status || row.outboxStatus || '').trim().toLowerCase();
    const attempts = Number(row.attempts == null ? 0 : row.attempts);
    const maxAttempts = Number(row.max_attempts == null ? row.maxAttempts == null ? 0 : row.maxAttempts : row.max_attempts);
    if (outboxStatus === 'dead') return 'dead';
    if (outboxStatus === 'failed') {
        return maxAttempts > 0 && attempts >= maxAttempts ? 'failed_terminal' : 'failed_retryable';
    }
    if (outboxStatus === 'queued' && fiscalStatus === 'failed') return 'failed_retryable';
    if (TERMINAL_FAILURE_FISCAL_STATUSES.has(fiscalStatus)) return 'failed_terminal';
    return fiscalStatus || 'unknown';
}

function normalizeUnresolvedPagination({ page = 1, pageSize = 50 } = {}) {
    const normalizePositiveInteger = (value, { field, defaultValue, max = Number.MAX_SAFE_INTEGER }) => {
        if (value == null || String(value).trim() === '') return defaultValue;
        const text = String(value).trim();
        if (!/^[1-9]\d*$/.test(text)) {
            throw new PaymentReadinessError(`unresolved_${field}_invalid`, `${field} must be a positive integer`, { status: 422 });
        }
        const parsed = Number(text);
        if (!Number.isSafeInteger(parsed) || parsed > max) {
            throw new PaymentReadinessError(`unresolved_${field}_invalid`, `${field} is outside the supported range`, {
                status: 422,
                details: { max }
            });
        }
        return parsed;
    };
    return {
        page: normalizePositiveInteger(page, { field: 'page', defaultValue: 1, max: 1_000_000 }),
        pageSize: normalizePositiveInteger(pageSize, { field: 'page_size', defaultValue: 50, max: 100 })
    };
}

function buildFiscalConfigurationSnapshot({ mapping = {}, binding = {}, runtimeConfig = {} } = {}) {
    const snapshot = {
        provider: 'checkbox',
        provider_organization_id: mapping.provider_organization_id || null,
        provider_outlet_id: mapping.provider_outlet_id || null,
        provider_register_id: mapping.provider_register_id || null,
        provider_cashier_id: binding.provider_cashier_id || null,
        register_credential_ref: mapping.provider_license_ref || null,
        cashier_credential_ref: binding.provider_cashier_login_ref || mapping.provider_license_ref || null,
        expected_is_test: runtimeConfig.expectedIsTest,
        fiscal_profile_id: mapping.fiscal_profile_id == null ? null : Number(mapping.fiscal_profile_id),
        fiscal_location_id: mapping.fiscal_location_id == null ? null : Number(mapping.fiscal_location_id),
        fiscal_register_id: mapping.fiscal_register_id == null ? null : Number(mapping.fiscal_register_id),
        crm_profile_key: mapping.crm_profile_key || null,
        legal_entity_key: mapping.legal_entity_key || null,
        register_alias: mapping.register_alias || null
    };
    return { snapshot, hash: fingerprint(snapshot) };
}

function missingLocalFiscalContext(mapping = {}, binding = {}, runtimeConfig = null) {
    const missing = [];
    if (!String(mapping.provider_organization_id || '').trim()) missing.push('provider_organization_id');
    // Checkbox's official cashier/register readiness schemas do not expose outlet_id.
    // Organization + register + cashier + is_test are the provider identity boundary.
    if (!String(mapping.provider_register_id || '').trim()) missing.push('provider_register_id');
    if (!String(binding.provider_cashier_id || '').trim()) missing.push('provider_cashier_id');
    if (!String(mapping.provider_license_ref || '').trim()) missing.push('register_credential_ref');
    if (!String(binding.provider_cashier_login_ref || mapping.provider_license_ref || '').trim()) missing.push('cashier_credential_ref');
    if (normalizeBoolean(mapping.register_expected_is_test) == null) missing.push('expected_is_test_mapping');
    if (runtimeConfig && runtimeConfig.expectedIsTest == null) missing.push('expected_is_test_env');
    return missing;
}

function assertIntegrationOwner(mapping = {}, user = {}) {
    const owner = String(mapping.register_metadata?.integration_owner || '').trim();
    if (!owner) {
        throw new PaymentReadinessError('fiscal_incident_owner_missing', 'Fiscal register integration owner is not configured', { status: 403 });
    }
    const candidates = [
        user?.id == null ? '' : String(user.id),
        user?.username,
        user?.name
    ].map(value => String(value || '').trim()).filter(Boolean);
    if (!candidates.includes(owner)) {
        throw new PaymentReadinessError('fiscal_incident_owner_denied', 'Only the exact fiscal integration owner can manage incidents', { status: 403 });
    }
    return true;
}

function assertPhase1CloseIntegrationOwner(mapping = {}, user = {}) {
    const ownerUserId = Number(mapping.register_metadata?.integration_owner);
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
        throw new PaymentReadinessError('phase1_close_owner_missing', 'Fiscal register integration owner is not configured as an exact user id', { status: 403 });
    }
    if (ownerUserId !== Number(user?.id)) {
        throw new PaymentReadinessError('phase1_close_owner_denied', 'Only the exact fiscal integration owner can close the Phase-1 shift', { status: 403 });
    }
    return true;
}

async function withTransaction(dbPool, run) {
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function loadPilotMapping(client, {
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    lockConfiguration = false
} = {}) {
    const lockClause = lockConfiguration ? ' FOR UPDATE OF fp, fl, fr' : '';
    const result = await client.query(
        `SELECT
             fp.id AS fiscal_profile_id,
             fp.crm_profile_key,
             fp.legal_entity_key,
             fp.legal_entity_name,
             fp.provider_organization_id,
             fp.status AS fiscal_profile_status,
             fl.id AS fiscal_location_id,
             fl.location_alias,
             fl.provider_outlet_id,
             fr.id AS fiscal_register_id,
             fr.register_alias,
             fr.display_name AS register_display_name,
             fr.provider,
             fr.provider_register_id,
             fr.provider_license_ref,
             fr.metadata AS register_metadata,
             fr.metadata->>'expected_is_test' AS register_expected_is_test,
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
            AND fp.status = 'active'${lockClause}`,
        [String(crmProfileKey || '').trim(), String(registerAlias || '').trim()]
    );
    if (result.rows.length !== 1) {
        return { mapping: null, matches: result.rows.length };
    }
    return { mapping: result.rows[0], matches: 1 };
}

async function loadTaxMappingReadiness(client, mapping) {
    if (!mapping) return { ready: false, activeCodes: [], mappedCodes: [], missingCodes: [] };
    const active = await client.query(
        `SELECT code
           FROM admission_ticket_types
          WHERE business_context = $1
            AND is_active = TRUE
          ORDER BY code`,
        [mapping.crm_profile_key]
    );
    const activeCodes = active.rows.map(row => String(row.code || '').trim()).filter(Boolean);
    if (!activeCodes.length) return { ready: false, activeCodes, mappedCodes: [], missingCodes: [] };
    const mapped = await client.query(
        `SELECT item_code, provider_tax_id, tax_mode
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND crm_profile_key = $3
            AND source_type = 'admission_ticket'
            AND item_type = 'admission_ticket'
            AND item_code = ANY($4::text[])
            AND provider = 'checkbox'
            AND status = 'active'
            AND BTRIM(fiscal_item_name) <> ''
            AND (
                (
                    tax_mode = 'taxed'
                    AND BTRIM(COALESCE(provider_tax_id, '')) <> ''
                    AND provider_tax_id !~* '^admission_tariff:'
                )
                OR (
                    tax_mode = 'untaxed'
                    AND NULLIF(BTRIM(COALESCE(provider_tax_id, '')), '') IS NULL
                )
            )`,
        [mapping.fiscal_profile_id, mapping.fiscal_register_id, mapping.crm_profile_key, activeCodes]
    );
    const mappedCodes = [...new Set(mapped.rows.map(row => String(row.item_code || '').trim()).filter(Boolean))];
    const providerTaxIds = [...new Set(mapped.rows
        .filter(row => String(row.tax_mode || 'taxed').trim().toLowerCase() === 'taxed')
        .map(row => String(row.provider_tax_id || '').trim())
        .filter(Boolean))];
    const missingCodes = activeCodes.filter(code => !mappedCodes.includes(code));
    return { ready: missingCodes.length === 0, activeCodes, mappedCodes, missingCodes, providerTaxIds };
}

function normalizePaymentTaxRows(rows = []) {
    if (!Array.isArray(rows) || !rows.length) {
        throw new PaymentReadinessError('payment_order_items_missing', 'Payment order has no immutable fiscal items', { status: 409 });
    }
    return rows.map(row => {
        const lineNumber = Number(row.line_number);
        const itemCode = String(row.item_code || '').trim();
        const taxMode = String(row.tax_mode || 'taxed').trim().toLowerCase();
        const providerTaxId = String(row.provider_tax_id || '').trim() || null;
        const valid = Number.isSafeInteger(lineNumber)
            && lineNumber > 0
            && Boolean(itemCode)
            && (taxMode === 'untaxed'
                ? providerTaxId == null
                : taxMode === 'taxed' && Boolean(providerTaxId) && !/^admission_tariff:/i.test(providerTaxId));
        if (!valid) {
            throw new PaymentReadinessError('payment_order_fiscal_item_not_ready', 'Immutable payment item tax mapping is incomplete', {
                status: 409,
                details: { lineNumber: Number.isSafeInteger(lineNumber) ? lineNumber : null }
            });
        }
        return {
            lineNumber,
            itemCode,
            taxMode,
            providerTaxId
        };
    }).sort((a, b) => a.lineNumber - b.lineNumber);
}

function paymentTaxContext(rows = []) {
    const items = normalizePaymentTaxRows(rows);
    return {
        items,
        providerTaxIds: [...new Set(items.map(item => item.providerTaxId).filter(Boolean))].sort(),
        fingerprint: fingerprint(items)
    };
}

async function loadPaymentOrderTaxContext(client, {
    paymentOrderId,
    fiscalProfileId,
    fiscalRegisterId,
    crmProfileKey,
    lockConfiguration = false
} = {}) {
    const immutable = await client.query(
        `SELECT line_number, item_code, provider_tax_id, COALESCE(tax_mode, 'taxed') AS tax_mode
           FROM payment_order_items
          WHERE fiscal_profile_id = $1
            AND payment_order_id = $2
          ORDER BY line_number ASC`,
        [fiscalProfileId, paymentOrderId]
    );
    const immutableContext = paymentTaxContext(immutable.rows);
    const itemCodes = [...new Set(immutableContext.items.map(item => item.itemCode))];
    const lockClause = lockConfiguration ? ' FOR UPDATE' : '';
    const current = await client.query(
        `SELECT item_code, provider_tax_id, COALESCE(tax_mode, 'taxed') AS tax_mode
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND crm_profile_key = $3
            AND source_type = 'admission_ticket'
            AND item_type = 'admission_ticket'
            AND provider = 'checkbox'
            AND status = 'active'
            AND item_code = ANY($4::text[])${lockClause}`,
        [fiscalProfileId, fiscalRegisterId, crmProfileKey, itemCodes]
    );
    const currentByCode = new Map();
    for (const row of current.rows) {
        const itemCode = String(row.item_code || '').trim();
        if (!itemCode || currentByCode.has(itemCode)) {
            throw new PaymentReadinessError('payment_fiscal_tax_mapping_changed', 'Active fiscal tax mapping is missing or ambiguous for this payment', {
                status: 409
            });
        }
        currentByCode.set(itemCode, row);
    }
    const projected = immutableContext.items.map(item => {
        const currentRow = currentByCode.get(item.itemCode);
        return {
            line_number: item.lineNumber,
            item_code: item.itemCode,
            tax_mode: currentRow?.tax_mode,
            provider_tax_id: currentRow?.provider_tax_id
        };
    });
    let currentContext;
    try {
        currentContext = paymentTaxContext(projected);
    } catch (error) {
        if (error instanceof PaymentReadinessError) {
            throw new PaymentReadinessError('payment_fiscal_tax_mapping_changed', 'Active fiscal tax mapping no longer matches this payment', {
                status: 409
            });
        }
        throw error;
    }
    if (currentContext.fingerprint !== immutableContext.fingerprint) {
        throw new PaymentReadinessError('payment_fiscal_tax_mapping_changed', 'Active fiscal tax mapping changed after payment order creation', {
            status: 409
        });
    }
    return immutableContext;
}

async function loadLatestLocalShift(client, mapping, { lockConfiguration = false } = {}) {
    if (!mapping) return null;
    const lockClause = lockConfiguration ? ' FOR UPDATE' : '';
    const result = await client.query(
        `SELECT *
           FROM fiscal_shifts
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND status IN ('opening', 'open', 'closing')
           ORDER BY opened_at DESC NULLS LAST, id DESC
           LIMIT 1${lockClause}`,
        [mapping.fiscal_profile_id, mapping.fiscal_register_id]
    );
    return result.rows[0] || null;
}

function localShiftState(shift) {
    if (!shift) return 'closed';
    if (shift.status === 'open' && shift.lifecycle_stage === 'OPENED') return 'open';
    if (shift.status === 'opening' || shift.lifecycle_stage === 'OPENING' || shift.lifecycle_stage === 'CREATED') return 'opening';
    if (shift.status === 'closing' || shift.lifecycle_stage === 'CLOSING') return 'closing';
    return String(shift.status || 'unknown').trim() || 'unknown';
}

async function loadScope(client, {
    user = null,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    action = 'payments.view',
    requireUserAuthorization = true,
    lockConfiguration = false
} = {}) {
    const { mapping, matches } = await loadPilotMapping(client, { crmProfileKey, registerAlias, lockConfiguration });
    if (!mapping) return { mapping: null, binding: null, matches, tax: { ready: false, missingCodes: [] }, shift: null, runtimeConfig: null, configHash: null };
    let binding = null;
    if (requireUserAuthorization) {
        await authorizeFiscalAction(client, {
            user,
            action,
            fiscalProfileId: mapping.fiscal_profile_id,
            crmProfileKey: mapping.crm_profile_key,
            fiscalLocationId: mapping.fiscal_location_id,
            fiscalRegisterId: mapping.fiscal_register_id
        });
        binding = await loadFiscalCashierBinding(client, {
            userId: user?.id,
            fiscalProfileId: mapping.fiscal_profile_id,
            fiscalRegisterId: mapping.fiscal_register_id
        });
        if (lockConfiguration) {
            const lockedBinding = await client.query(
                `SELECT id
                   FROM fiscal_cashier_bindings
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND fiscal_register_id = $3
                    AND status = 'active'
                  FOR UPDATE`,
                [binding.id, mapping.fiscal_profile_id, mapping.fiscal_register_id]
            );
            if (lockedBinding.rows.length !== 1) {
                throw new PaymentReadinessError('binding_changed_during_readiness', 'Fiscal cashier binding changed during payment readiness', {
                    status: 409
                });
            }
        }
    }
    const tax = await loadTaxMappingReadiness(client, mapping);
    const shift = await loadLatestLocalShift(client, mapping, { lockConfiguration });
    return { mapping, binding, matches, tax, shift, runtimeConfig: null, configHash: null };
}

async function loadScopeForBinding(client, bindingRow) {
    const { mapping } = await loadPilotMapping(client, {
        crmProfileKey: bindingRow.crm_profile_key || PILOT_CRM_PROFILE_KEY,
        registerAlias: bindingRow.register_alias || PILOT_REGISTER_ALIAS
    });
    if (!mapping) return null;
    const tax = await loadTaxMappingReadiness(client, mapping);
    const shift = await loadLatestLocalShift(client, mapping);
    return { mapping, binding: bindingRow, matches: 1, tax, shift };
}

function baseReadiness({
    checkboxIntegrationEnabled,
    paymentAcceptanceEnabled = true,
    mapping,
    matches = 0,
    binding,
    tax,
    shift,
    runtimeConfig = null,
    runtimeConfigError = null,
    now = new Date()
} = {}) {
    const missingContext = mapping && binding ? missingLocalFiscalContext(mapping, binding, runtimeConfig) : [];
    const localMappingReady = Boolean(mapping && matches === 1 && binding && missingContext.length === 0);
    const registerActive = Boolean(mapping && mapping.fiscal_register_status === 'active' && mapping.feature_enabled === true);
    const runtimeSecretsResolvable = Boolean(runtimeConfig);
    const taxMappingReady = Boolean(tax?.ready);
    const shiftState = localShiftState(shift);
    let readinessCode = 'ready';
    if (!checkboxIntegrationEnabled) readinessCode = 'global_integration_disabled';
    else if (!mapping || matches !== 1) readinessCode = matches > 1 ? 'mapping_ambiguous' : 'mapping_missing';
    else if (!binding) readinessCode = 'binding_missing';
    else if (missingContext.length) readinessCode = 'fiscal_context_incomplete';
    else if (!registerActive) readinessCode = 'register_disabled';
    else if (!taxMappingReady) readinessCode = 'tax_mapping_missing';
    else if (!runtimeSecretsResolvable) readinessCode = runtimeConfigError?.code || 'credentials_missing';
    else if (shiftState === 'opening') readinessCode = 'shift_opening';
    else if (shiftState === 'closing') readinessCode = 'shift_closing';
    else if (!paymentAcceptanceEnabled) readinessCode = 'payment_acceptance_disabled';
    return {
        checkboxIntegrationEnabled: Boolean(checkboxIntegrationEnabled),
        paymentAcceptanceEnabled: Boolean(paymentAcceptanceEnabled),
        localMappingReady,
        runtimeSecretsResolvable,
        providerIdentityVerified: false,
        registerActive,
        cashierReady: false,
        signatureCertificateReady: false,
        taxMappingReady,
        providerUnavailable: false,
        staleReadiness: true,
        shiftState,
        readinessCode,
        providerReady: false,
        integrationReady: false,
        checkedAt: nowIso(now),
        expiresAt: readinessExpiresAt(now).toISOString(),
        missingTaxItemCodes: tax?.missingCodes || [],
        missingFiscalContext: missingContext
    };
}

function assertRuntimeConfigMatchesMapping(mapping = {}, runtimeConfig = {}) {
    const mappingExpected = normalizeBoolean(mapping.register_expected_is_test);
    if (mappingExpected != null && mappingExpected !== runtimeConfig.expectedIsTest) {
        throw new PaymentReadinessError('checkbox_expected_is_test_mismatch', 'Checkbox expected is_test does not match register mapping metadata', {
            status: 503,
            details: { expectedFromMapping: mappingExpected, expectedFromRuntime: runtimeConfig.expectedIsTest }
        });
    }
    if (runtimeConfig.expectedIsTest == null) {
        throw new PaymentReadinessError('checkbox_expected_is_test_required', 'Checkbox expected is_test must be explicitly configured', { status: 503 });
    }
}

function deriveIntegrationReady(state = {}) {
    return Boolean(
        state.checkboxIntegrationEnabled
        && state.localMappingReady
        && state.runtimeSecretsResolvable
        && state.providerIdentityVerified
        && state.registerActive
        && state.cashierReady
        && state.signatureCertificateReady
        && state.taxMappingReady
        && !state.providerUnavailable
        && !state.staleReadiness
        && ['closed', 'open'].includes(state.shiftState)
    );
}

function canProbeProviderReadiness(state = {}) {
    return ['ready', 'payment_acceptance_disabled'].includes(String(state.readinessCode || ''));
}

function applyPaymentAcceptanceGate(state = {}, { providerReady = deriveIntegrationReady(state) } = {}) {
    const paymentAcceptanceEnabled = state.paymentAcceptanceEnabled === true;
    const normalizedProviderReady = providerReady === true;
    return {
        ...state,
        paymentAcceptanceEnabled,
        providerReady: normalizedProviderReady,
        readinessCode: normalizedProviderReady && !paymentAcceptanceEnabled
            ? 'payment_acceptance_disabled'
            : state.readinessCode,
        integrationReady: normalizedProviderReady && paymentAcceptanceEnabled
    };
}

function finalizeFreshReadiness(state = {}) {
    return applyPaymentAcceptanceGate(state, {
        providerReady: deriveIntegrationReady(state)
    });
}

function sanitizePersistedReadinessDetails(result = {}) {
    const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    const permissionDetails = paymentPermissionSnapshotDetails(source);
    const requiredTender = ['cash', 'card_terminal_manual'].includes(source.requiredTender)
        ? source.requiredTender
        : null;
    return {
        ...(source.error ? {
            error: {
                code: String(source.error.code || 'checkbox_readiness_error').slice(0, 80),
                status: Number(source.error.status || 503),
                retryable: source.error.retryable === true,
                unknown: source.error.unknown === true
            }
        } : {}),
        ...(source.cashier ? {
            cashier: {
                identityVerified: source.cashier.identityVerified === true,
                organizationVerified: source.cashier.organizationVerified === true,
                blocked: source.cashier.blocked === true,
                isTest: typeof source.cashier.isTest === 'boolean' ? source.cashier.isTest : null,
                certificateReady: source.cashier.certificateReady === true,
                testSignature: source.cashier.testSignature === true
            }
        } : {}),
        ...(source.register ? {
            register: {
                identityVerified: source.register.identityVerified === true,
                organizationVerified: source.register.organizationVerified === true,
                isTest: typeof source.register.isTest === 'boolean' ? source.register.isTest : null,
                online: source.register.online === true,
                documentsStateAvailable: source.register.documentsStateAvailable === true
            }
        } : {}),
        ...(source.permissions ? {
            permissions: {
                sales: ['allowed', 'denied', 'unreported'].includes(source.permissions.sales) ? source.permissions.sales : null,
                cash: ['allowed', 'denied', 'unreported'].includes(source.permissions.cash) ? source.permissions.cash : null,
                card: ['allowed', 'denied', 'unreported'].includes(source.permissions.card) ? source.permissions.card : null,
                warning: permissionDetails.warning,
                unreported: permissionDetails.unreported
            }
        } : {}),
        requiredTender,
        unreportedPaymentPermissionOverrideRequested: source.unreportedPaymentPermissionOverrideRequested === true,
        unreportedPaymentPermissionOverrideApplied: source.unreportedPaymentPermissionOverrideApplied === true,
        ...(source.signature ? {
            signature: {
                online: source.signature.online === true,
                type: String(source.signature.type || '').trim().toUpperCase() || null,
                shiftOpenPossible: source.signature.shiftOpenPossible === true
            }
        } : {}),
        ...(source.taxes ? {
            taxes: {
                expectedCount: Number(source.taxes.expectedCount || 0),
                availableCount: Number(source.taxes.availableCount || 0),
                exactPaymentTaxSnapshot: source.taxes.exactPaymentTaxSnapshot === true
            }
        } : {}),
        ...(source.shift ? {
            shift: {
                state: String(source.shift.state || 'unknown').slice(0, 40),
                status: source.shift.status == null ? null : String(source.shift.status).slice(0, 40),
                localShiftMatched: source.shift.localShiftMatched === true,
                providerShiftPresent: source.shift.providerShiftPresent === true
            }
        } : {})
    };
}

function serializeReadinessSnapshot(row = {}) {
    if (!row) return null;
    const result = sanitizePersistedReadinessDetails(row.result_snapshot || {});
    const permissionDetails = paymentPermissionSnapshotDetails(result);
    return {
        id: Number(row.id),
        readinessCode: row.readiness_code,
        integrationReady: Boolean(row.integration_ready),
        localMappingReady: Boolean(row.local_mapping_ready),
        runtimeSecretsResolvable: Boolean(row.runtime_secrets_resolvable),
        providerIdentityVerified: Boolean(row.provider_identity_verified),
        registerActive: Boolean(row.register_active),
        cashierReady: Boolean(row.cashier_ready),
        signatureCertificateReady: Boolean(row.signature_certificate_ready),
        taxMappingReady: Boolean(row.tax_mapping_ready),
        providerUnavailable: Boolean(row.provider_unavailable),
        staleReadiness: Boolean(row.stale_readiness) || new Date(row.expires_at).getTime() <= Date.now(),
        shiftState: row.shift_state,
        checkedAt: row.checked_at || null,
        expiresAt: row.expires_at || null,
        latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
        providerShiftPresent: Boolean(row.provider_shift_id),
        expectedIsTest: typeof row.expected_is_test === 'boolean' ? row.expected_is_test : null,
        paymentPermissionWarning: permissionDetails.warning,
        unreportedPaymentPermissions: permissionDetails.unreported,
        result
    };
}

async function loadLatestReadinessSnapshot(client, scope) {
    if (!scope?.mapping) return null;
    const hash = String(scope.configHash || '').trim();
    const result = await client.query(
        `SELECT *
           FROM checkbox_readiness_snapshots
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND COALESCE(register_credential_ref, '') = COALESCE($3, '')
            AND COALESCE(cashier_credential_ref, '') = COALESCE($4, '')
            AND ($5::text IS NULL OR fiscal_configuration_hash = $5)
          ORDER BY checked_at DESC, id DESC
          LIMIT 1`,
        [
            scope.mapping.fiscal_profile_id,
            scope.mapping.fiscal_register_id,
            scope.mapping.provider_license_ref || null,
            scope.binding?.provider_cashier_login_ref || scope.mapping.provider_license_ref || null,
            hash || null
        ]
    );
    return result.rows[0] || null;
}

async function insertReadinessSnapshot(client, scope, state, details = {}) {
    const mapping = scope.mapping;
    if (!mapping) return null;
    const expiresAt = state.expiresAt || readinessExpiresAt().toISOString();
    const row = await client.query(
        `INSERT INTO checkbox_readiness_snapshots (
             fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
             register_credential_ref, cashier_credential_ref, fiscal_configuration_hash,
             readiness_code, integration_ready, local_mapping_ready, runtime_secrets_resolvable,
             provider_identity_verified, register_active, cashier_ready, signature_certificate_ready,
             tax_mapping_ready, provider_unavailable, stale_readiness, shift_state,
             provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
             provider_shift_id, expected_is_test, checked_at, expires_at, latency_ms, result_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), $26::timestamptz, $27, $28::jsonb)
         RETURNING *`,
        [
            mapping.fiscal_profile_id,
            mapping.fiscal_register_id,
            mapping.fiscal_location_id,
            mapping.crm_profile_key,
            mapping.provider_license_ref || null,
            scope.binding?.provider_cashier_login_ref || mapping.provider_license_ref || null,
            scope.configHash || null,
            state.readinessCode,
            state.integrationReady === true,
            state.localMappingReady === true,
            state.runtimeSecretsResolvable === true,
            state.providerIdentityVerified === true,
            state.registerActive === true,
            state.cashierReady === true,
            state.signatureCertificateReady === true,
            state.taxMappingReady === true,
            state.providerUnavailable === true,
            state.staleReadiness === true,
            state.shiftState || 'unknown',
            mapping.provider_organization_id || null,
            mapping.provider_outlet_id || null,
            mapping.provider_register_id || null,
            scope.binding?.provider_cashier_id || null,
            state.providerShiftId || null,
            normalizeBoolean(scope.runtimeConfig?.expectedIsTest),
            expiresAt,
            state.latencyMs == null ? null : Number(state.latencyMs),
            JSON.stringify(sanitizePersistedReadinessDetails(details))
        ]
    );
    return row.rows[0];
}

async function prepareReadinessScope({
    dbPool = pool,
    user = null,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    action = 'payments.view',
    requireUserAuthorization = true,
    paymentOrderId = null,
    lockConfiguration = false,
    env = process.env,
    now = new Date()
} = {}) {
    return withTransaction(dbPool, async client => {
        const checkboxIntegrationEnabled = isCheckboxIntegrationEnabled(env);
        const paymentAcceptanceEnabled = isCheckboxPaymentAcceptanceEnabled(env);
        const scope = await loadScope(client, {
            user,
            crmProfileKey,
            registerAlias,
            action,
            requireUserAuthorization,
            lockConfiguration
        });
        let runtimeConfig = null;
        let runtimeConfigError = null;
        if (scope.mapping && checkboxIntegrationEnabled && scope.mapping.feature_enabled === true && scope.binding) {
            try {
                runtimeConfig = loadCheckboxRuntimeConfig({
                    env,
                    credentialRef: scope.binding.provider_cashier_login_ref || scope.mapping.provider_license_ref,
                    licenseRef: scope.mapping.provider_license_ref
                });
                assertRuntimeConfigMatchesMapping(scope.mapping, runtimeConfig);
            } catch (error) {
                runtimeConfigError = publicError(error);
            }
        }
        scope.runtimeConfig = runtimeConfig;
        scope.configHash = runtimeConfig ? buildFiscalConfigurationSnapshot({ mapping: scope.mapping, binding: scope.binding, runtimeConfig }).hash : null;
        scope.paymentTaxContext = scope.mapping && paymentOrderId
            ? await loadPaymentOrderTaxContext(client, {
                paymentOrderId,
                fiscalProfileId: scope.mapping.fiscal_profile_id,
                fiscalRegisterId: scope.mapping.fiscal_register_id,
                crmProfileKey: scope.mapping.crm_profile_key,
                lockConfiguration
            })
            : null;
        const local = baseReadiness({
            checkboxIntegrationEnabled,
            paymentAcceptanceEnabled,
            mapping: scope.mapping,
            matches: scope.matches,
            binding: scope.binding,
            tax: scope.tax,
            shift: scope.shift,
            runtimeConfig,
            runtimeConfigError,
            now
        });
        return { scope, local };
    });
}

async function syncPortalClosedShift(client, scope, providerShiftState) {
    const shift = scope.shift;
    if (!shift || !['open', 'opening', 'closing'].includes(String(shift.status || ''))) return null;
    if (!['closed'].includes(providerShiftState)) return null;
    const result = await client.query(
        `UPDATE fiscal_shifts
            SET status = 'closed',
                lifecycle_stage = 'CLOSED',
                closed_at = COALESCE(closed_at, NOW()),
                provider_closed_at = COALESCE(provider_closed_at, NOW()),
                provider_snapshot = provider_snapshot || $3::jsonb,
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2
            AND status IN ('open', 'opening', 'closing')
          RETURNING *`,
        [
            shift.id,
            shift.fiscal_profile_id,
            JSON.stringify({ synced_from_provider_readiness: true, provider_shift_state: providerShiftState })
        ]
    );
    return result.rows[0] || null;
}

function resolveProviderShiftReadiness({ providerShift = null, localShift = null } = {}) {
    if (!providerShift) {
        const localState = localShiftState(localShift);
        if (['open', 'opening', 'closing'].includes(localState)) {
            return {
                shiftState: 'local_stale',
                readinessCode: 'local_shift_requires_reconciliation',
                providerShiftId: null,
                localShiftMatched: false
            };
        }
        return { shiftState: 'closed', readinessCode: 'ready', providerShiftId: null, localShiftMatched: true };
    }
    const providerStatus = String(providerShift.status || '').trim().toUpperCase();
    const providerShiftId = String(providerShift.id || '').trim() || null;
    if (providerStatus === OPEN_SHIFT_STATUS) {
        const localProviderShiftId = String(localShift?.provider_shift_id || '').trim() || null;
        const localShiftMatched = Boolean(providerShiftId && localProviderShiftId && providerShiftId === localProviderShiftId);
        return {
            shiftState: localShiftMatched ? 'open' : 'external_open',
            readinessCode: localShiftMatched ? 'ready' : 'external_shift_requires_sync',
            providerShiftId,
            localShiftMatched
        };
    }
    if (['OPENING', 'CREATED'].includes(providerStatus)) {
        return { shiftState: 'opening', readinessCode: 'shift_opening', providerShiftId, localShiftMatched: false };
    }
    if (providerStatus === 'CLOSING') {
        return { shiftState: 'closing', readinessCode: 'shift_closing', providerShiftId, localShiftMatched: false };
    }
    if (providerStatus === 'CLOSED') {
        const localState = localShiftState(localShift);
        const localProviderShiftId = String(localShift?.provider_shift_id || '').trim() || null;
        const localActive = ['open', 'opening', 'closing'].includes(localState);
        const localShiftMatched = Boolean(providerShiftId && localProviderShiftId && providerShiftId === localProviderShiftId);
        if (localActive && !localShiftMatched) {
            return {
                shiftState: 'local_stale',
                readinessCode: 'local_shift_requires_reconciliation',
                providerShiftId,
                localShiftMatched: false
            };
        }
        return { shiftState: 'closed', readinessCode: 'ready', providerShiftId, localShiftMatched: !localActive || localShiftMatched };
    }
    const closed = resolveProviderShiftReadiness({ providerShift: null, localShift });
    return { ...closed, providerShiftId };
}

function freshShiftContextMatches(localShift, freshProviderReadiness = {}) {
    const freshShiftState = String(freshProviderReadiness.shiftState || '').trim();
    if (freshShiftState === 'open') {
        const providerShiftId = String(freshProviderReadiness.providerShiftId || '').trim();
        return Boolean(
            providerShiftId
            && localShiftState(localShift) === 'open'
            && String(localShift?.provider_shift_id || '').trim() === providerShiftId
        );
    }
    if (freshShiftState === 'closed') {
        return localShiftState(localShift) === 'closed';
    }
    return false;
}

function sanitizedProviderReadinessDetails({
    providerReadiness = {},
    permissionDetails = {},
    normalizedTender = null,
    unreportedPermissionPolicy = {},
    shiftResolution = {},
    paymentTaxContext = null
} = {}) {
    const permissions = providerReadiness.permissions || {};
    return {
        cashier: {
            identityVerified: true,
            organizationVerified: true,
            blocked: providerReadiness.cashier?.blocked === true,
            isTest: providerReadiness.cashier?.isTest ?? null,
            certificateReady: providerReadiness.certificate?.ready === true,
            testSignature: providerReadiness.certificate?.testSignature === true
        },
        register: {
            identityVerified: true,
            organizationVerified: true,
            isTest: providerReadiness.register?.isTest ?? null,
            online: providerReadiness.register?.offlineMode !== true && providerReadiness.register?.stayOffline !== true,
            documentsStateAvailable: Boolean(providerReadiness.register?.documentsState)
        },
        permissions: {
            sales: permissions.sales === true ? 'allowed' : permissions.sales === false ? 'denied' : 'unreported',
            cash: permissions.cashPayment === true ? 'allowed' : permissions.cashPayment === false ? 'denied' : 'unreported',
            card: permissions.cardPayment === true ? 'allowed' : permissions.cardPayment === false ? 'denied' : 'unreported',
            warning: permissionDetails.warning || null,
            unreported: permissionDetails.unreported || []
        },
        requiredTender: normalizedTender,
        unreportedPaymentPermissionOverrideRequested: unreportedPermissionPolicy.requested === true,
        unreportedPaymentPermissionOverrideApplied: unreportedPermissionPolicy.allowed === true,
        signature: {
            online: providerReadiness.signature?.online === true,
            type: String(providerReadiness.signature?.type || '').trim().toUpperCase() || null,
            shiftOpenPossible: providerReadiness.signature?.shiftOpenPossibility === true
        },
        taxes: {
            expectedCount: paymentTaxContext
                ? paymentTaxContext.providerTaxIds.length
                : Array.isArray(providerReadiness.taxes?.expected) ? providerReadiness.taxes.expected.length : 0,
            availableCount: Number(providerReadiness.taxes?.availableCount || 0),
            exactPaymentTaxSnapshot: Boolean(paymentTaxContext)
        },
        shift: {
            state: shiftResolution.shiftState || 'unknown',
            status: shiftResolution.providerStatus || null,
            localShiftMatched: shiftResolution.localShiftMatched === true,
            providerShiftPresent: Boolean(shiftResolution.providerShiftId)
        }
    };
}

async function probeProvider(scope, {
    fetchImpl,
    now = new Date(),
    timeoutMs = PROBE_TIMEOUT_MS,
    env = process.env,
    requiredTender = null
} = {}) {
    const normalizedTender = normalizeReadinessTender(requiredTender);
    const expected = {
        expectedCashierId: scope.binding?.provider_cashier_id || null,
        expectedOrganizationId: scope.mapping?.provider_organization_id || null,
        expectedRegisterId: scope.mapping?.provider_register_id || null,
        expectedIsTest: scope.runtimeConfig?.expectedIsTest
    };
    const unreportedPermissionPolicy = resolveUnreportedPaymentPermissionPolicy({
        env,
        expectedIsTest: expected.expectedIsTest
    });
    const provider = createProviderFromConfig(
        { ...scope.runtimeConfig, timeoutMs: Math.max(1000, Math.min(Number(timeoutMs || PROBE_TIMEOUT_MS), 30_000)) },
        { fetchImpl }
    );
    const startedAt = new Date(now).getTime();
    const providerReadiness = await provider.verifyReadiness(expected, {
        expectedTaxIds: scope.paymentTaxContext?.providerTaxIds || scope.tax?.providerTaxIds || [],
        requiredTender: normalizedTender,
        allowUnreportedPaymentPermissions: unreportedPermissionPolicy.allowed
    });
    let shiftResolution = resolveProviderShiftReadiness({ providerShift: null, localShift: scope.shift });
    const currentShiftObservation = await getCurrentShiftWithAbsenceProof(
        provider.client,
        expected,
        providerReadiness.register
    );
    const current = currentShiftObservation.absent
        ? null
        : normalizeShiftResponse(currentShiftObservation.payload, expected, { requireCashier: false });
    if (current?.status === OPEN_SHIFT_STATUS) {
        // The sparse current-shift response cannot prove cashier ownership. A missing
        // detailed shift is therefore an identity failure, never evidence that no shift exists.
        const shift = normalizeShiftResponse(
            await provider.client.getShiftById({ shiftId: current.id }),
            expected,
            { requireOpened: true, requireCashier: true }
        );
        shiftResolution = {
            ...resolveProviderShiftReadiness({ providerShift: shift, localShift: scope.shift }),
            providerStatus: shift.status
        };
    } else if (current) {
        shiftResolution = {
            ...resolveProviderShiftReadiness({ providerShift: current, localShift: scope.shift }),
            providerStatus: current.status
        };
    } else {
        const localShiftId = String(scope.shift?.provider_shift_id || '').trim();
        const localState = localShiftState(scope.shift);
        if (localShiftId && ['open', 'opening', 'closing'].includes(localState)) {
            try {
                const historical = normalizeShiftResponse(
                    await provider.client.getShiftById({ shiftId: localShiftId }),
                    { ...expected, expectedShiftId: localShiftId },
                    { requireCashier: true }
                );
                if (historical.status === OPEN_SHIFT_STATUS) {
                    shiftResolution = {
                        shiftState: 'local_stale',
                        readinessCode: 'local_shift_requires_reconciliation',
                        providerShiftId: localShiftId,
                        localShiftMatched: false,
                        providerStatus: historical.status
                    };
                } else {
                    shiftResolution = {
                        ...resolveProviderShiftReadiness({ providerShift: historical, localShift: scope.shift }),
                        providerStatus: historical.status
                    };
                }
            } catch (error) {
                if (!(error instanceof CheckboxClientError && error.status === 404)) throw error;
                shiftResolution = resolveProviderShiftReadiness({ providerShift: null, localShift: scope.shift });
            }
        } else {
            shiftResolution = resolveProviderShiftReadiness({ providerShift: null, localShift: scope.shift });
        }
    }
    const latencyMs = millisBetween(startedAt, Date.now());
    const permissionDetails = paymentPermissionSnapshotDetails({ permissions: providerReadiness.permissions }, normalizedTender);
    const shiftState = shiftResolution.shiftState;
    const providerShiftId = shiftResolution.providerShiftId;
    const state = {
        checkboxIntegrationEnabled: true,
        localMappingReady: true,
        runtimeSecretsResolvable: true,
        providerIdentityVerified: true,
        registerActive: true,
        cashierReady: true,
        signatureCertificateReady: true,
        taxMappingReady: scope.paymentTaxContext ? true : scope.tax?.ready === true,
        providerUnavailable: false,
        staleReadiness: false,
        shiftState,
        readinessCode: shiftResolution.readinessCode,
        providerShiftId,
        checkedAt: nowIso(now),
        expiresAt: readinessExpiresAt(now).toISOString(),
        latencyMs,
        paymentPermissionWarning: permissionDetails.warning,
        unreportedPaymentPermissions: permissionDetails.unreported,
        requiredTender: normalizedTender
    };
    state.integrationReady = deriveIntegrationReady(state);
    return {
        state,
        details: sanitizedProviderReadinessDetails({
            providerReadiness,
            permissionDetails,
            normalizedTender,
            unreportedPermissionPolicy,
            shiftResolution,
            paymentTaxContext: scope.paymentTaxContext
        })
    };
}

async function loadReadinessState({
    dbPool = pool,
    user,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    action = 'payments.view',
    env = process.env
} = {}) {
    return withTransaction(dbPool, async client => {
        const checkboxIntegrationEnabled = isCheckboxIntegrationEnabled(env);
        const paymentAcceptanceEnabled = isCheckboxPaymentAcceptanceEnabled(env);
        const scope = await loadScope(client, { user, crmProfileKey, registerAlias, action, requireUserAuthorization: true });
        let runtimeConfig = null;
        let runtimeConfigError = null;
        if (scope.mapping && checkboxIntegrationEnabled && scope.mapping.feature_enabled === true && scope.binding) {
            try {
                runtimeConfig = loadCheckboxRuntimeConfig({
                    env,
                    credentialRef: scope.binding.provider_cashier_login_ref || scope.mapping.provider_license_ref,
                    licenseRef: scope.mapping.provider_license_ref
                });
                assertRuntimeConfigMatchesMapping(scope.mapping, runtimeConfig);
            } catch (error) {
                runtimeConfigError = publicError(error);
            }
        }
        scope.runtimeConfig = runtimeConfig;
        scope.configHash = runtimeConfig ? buildFiscalConfigurationSnapshot({ mapping: scope.mapping, binding: scope.binding, runtimeConfig }).hash : null;
        const local = baseReadiness({
            checkboxIntegrationEnabled,
            paymentAcceptanceEnabled,
            mapping: scope.mapping,
            matches: scope.matches,
            binding: scope.binding,
            tax: scope.tax,
            shift: scope.shift,
            runtimeConfig,
            runtimeConfigError
        });
        if (!scope.mapping || !runtimeConfig || !canProbeProviderReadiness(local)) {
            return {
                ...local,
                fiscalProfileId: scope.mapping ? Number(scope.mapping.fiscal_profile_id) : null,
                fiscalRegisterId: scope.mapping ? Number(scope.mapping.fiscal_register_id) : null,
                readinessSnapshot: null
            };
        }
        const latest = await loadLatestReadinessSnapshot(client, scope);
        const serialized = serializeReadinessSnapshot(latest);
        if (!serialized) {
            return { ...local, readinessCode: 'readiness_missing', readinessSnapshot: null };
        }
        const staleReadiness = serialized.staleReadiness === true;
        const testModeMismatch = serialized.expectedIsTest !== runtimeConfig.expectedIsTest;
        const permissionPolicy = resolveUnreportedPaymentPermissionPolicy({
            env,
            expectedIsTest: runtimeConfig.expectedIsTest
        });
        const permissionDetails = paymentPermissionSnapshotDetails(serialized.result);
        const unreportedPermissionBlocked = permissionDetails.unreported.length > 0 && !permissionPolicy.allowed;
        const merged = {
            ...local,
            ...serialized,
            checkboxIntegrationEnabled,
            paymentAcceptanceEnabled,
            localMappingReady: local.localMappingReady,
            runtimeSecretsResolvable: local.runtimeSecretsResolvable,
            registerActive: local.registerActive,
            taxMappingReady: local.taxMappingReady,
            staleReadiness,
            readinessCode: testModeMismatch
                ? 'checkbox_expected_is_test_mismatch'
                : staleReadiness
                    ? 'readiness_stale'
                    : unreportedPermissionBlocked
                        ? 'checkbox_payment_permission_unreported'
                        : serialized.readinessCode,
            paymentPermissionWarning: permissionDetails.warning,
            unreportedPaymentPermissions: permissionDetails.unreported,
            integrationReady: false,
            fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
            fiscalRegisterId: Number(scope.mapping.fiscal_register_id),
            readinessSnapshot: serialized
        };
        return applyPaymentAcceptanceGate(merged, {
            providerReady: !testModeMismatch && !unreportedPermissionBlocked && deriveIntegrationReady(merged)
        });
    });
}

async function probeCheckboxReadiness({
    dbPool = pool,
    user = null,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    action = 'payments.view',
    env = process.env,
    fetchImpl,
    now = new Date(),
    force = false
} = {}) {
    const { scope, local } = await prepareReadinessScope({
        dbPool,
        user,
        crmProfileKey,
        registerAlias,
        action,
        requireUserAuthorization: Boolean(user),
        env,
        now
    });
    if (!scope.mapping || !scope.runtimeConfig || !canProbeProviderReadiness(local)) {
        return withTransaction(dbPool, async client => {
            const inserted = scope.mapping ? await insertReadinessSnapshot(client, scope, local, { reason: local.readinessCode }) : null;
            return { ...local, readinessSnapshot: serializeReadinessSnapshot(inserted) };
        });
    }
    const latest = await withTransaction(dbPool, async client => loadLatestReadinessSnapshot(client, scope));
    const serializedLatest = serializeReadinessSnapshot(latest);
    if (!force && serializedLatest && serializedLatest.staleReadiness !== true) {
        const permissionPolicy = resolveUnreportedPaymentPermissionPolicy({
            env,
            expectedIsTest: scope.runtimeConfig.expectedIsTest
        });
        const permissionDetails = paymentPermissionSnapshotDetails(serializedLatest.result);
        const unreportedPermissionBlocked = permissionDetails.unreported.length > 0 && !permissionPolicy.allowed;
        return applyPaymentAcceptanceGate({
            ...local,
            ...serializedLatest,
            checkboxIntegrationEnabled: local.checkboxIntegrationEnabled,
            paymentAcceptanceEnabled: local.paymentAcceptanceEnabled,
            localMappingReady: local.localMappingReady,
            runtimeSecretsResolvable: local.runtimeSecretsResolvable,
            registerActive: local.registerActive,
            taxMappingReady: local.taxMappingReady,
            readinessCode: unreportedPermissionBlocked ? 'checkbox_payment_permission_unreported' : serializedLatest.readinessCode,
            paymentPermissionWarning: permissionDetails.warning,
            unreportedPaymentPermissions: permissionDetails.unreported,
            readinessSnapshot: serializedLatest,
            cached: true
        }, {
            providerReady: !unreportedPermissionBlocked && deriveIntegrationReady({ ...local, ...serializedLatest })
        });
    }
    const singleFlightKey = [
        scope.mapping.fiscal_profile_id,
        scope.mapping.fiscal_register_id,
        scope.configHash || 'no-config'
    ].join(':');
    if (READINESS_PROBE_IN_FLIGHT.has(singleFlightKey)) {
        return READINESS_PROBE_IN_FLIGHT.get(singleFlightKey);
    }
    const runProbe = (async () => {
    let result;
    try {
        result = await probeProvider(scope, { fetchImpl, now, env });
    } catch (error) {
        const info = publicError(error);
        const providerUnavailable = info.retryable === true || info.unknown === true || info.status >= 500 || /timeout|network|fetch|aborted/i.test(info.message);
        result = {
            state: {
                ...local,
                readinessCode: providerUnavailable ? 'provider_unavailable' : info.code,
                providerUnavailable,
                staleReadiness: false,
                integrationReady: false,
                latencyMs: null
            },
            details: { error: info }
        };
    }
    return withTransaction(dbPool, async client => {
        const contextualState = {
            ...result.state,
            fiscalProfileId: Number(scope.mapping?.fiscal_profile_id || 0) || null,
            fiscalRegisterId: Number(scope.mapping?.fiscal_register_id || 0) || null,
            fiscalConfigurationHash: scope.configHash || null,
            fiscalTaxFingerprint: scope.paymentTaxContext?.fingerprint || null,
            expectedIsTest: scope.runtimeConfig?.expectedIsTest ?? null,
            requiredTender: null
        };
        await syncPortalClosedShift(client, scope, contextualState.shiftState);
        const inserted = await insertReadinessSnapshot(client, scope, contextualState, result.details);
        if (contextualState.integrationReady === true) {
            await resolveOperationalIncidents(client, {
                fiscalProfileId: scope.mapping?.fiscal_profile_id,
                fiscalRegisterId: scope.mapping?.fiscal_register_id,
                incidentTypes: ['checkbox.readiness_probe_failed', 'checkbox.provider_unavailable'],
                reason: 'readiness_probe_recovered'
            });
        } else if (result.state.providerUnavailable === true || result.state.readinessCode === 'provider_unavailable') {
            await upsertOperationalIncident(client, {
                fiscalProfileId: scope.mapping?.fiscal_profile_id,
                fiscalRegisterId: scope.mapping?.fiscal_register_id,
                severity: 'warning',
                incidentType: 'checkbox.provider_unavailable',
                idempotencyKey: `checkbox.provider_unavailable:${scope.mapping?.fiscal_profile_id}:${scope.mapping?.fiscal_register_id}`,
                details: { readiness_code: result.state.readinessCode, sanitized: true }
            });
        }
        return applyPaymentAcceptanceGate({
            ...contextualState,
            paymentAcceptanceEnabled: local.paymentAcceptanceEnabled,
            readinessSnapshot: serializeReadinessSnapshot(inserted)
        });
    });
    })();
    READINESS_PROBE_IN_FLIGHT.set(singleFlightKey, runProbe);
    try {
        return await runProbe;
    } finally {
        READINESS_PROBE_IN_FLIGHT.delete(singleFlightKey);
    }
}

function readinessFailureStatus(readinessCode) {
    return [
        'global_integration_disabled',
        'credentials_missing',
        'provider_unavailable',
        'readiness_stale',
        'readiness_missing',
        'checkbox_expected_is_test_mismatch'
    ].includes(readinessCode) ? 503 : 409;
}

function throwPaymentReadinessError(state = {}) {
    const contextReasons = Array.isArray(state.contextMismatchReasons)
        ? state.contextMismatchReasons.map(value => String(value || '').trim()).filter(Boolean)
        : [];
    const message = state.readinessCode === 'readiness_context_changed' && contextReasons.length
        ? `Checkbox readiness context changed: ${contextReasons.join(', ')}`
        : 'Checkbox is not ready for payment confirmation';
    throw new PaymentReadinessError(state.readinessCode || 'checkbox_not_ready', message, {
        status: readinessFailureStatus(state.readinessCode),
        details: {
            readinessCode: state.readinessCode,
            shiftState: state.shiftState,
            staleReadiness: state.staleReadiness,
            providerUnavailable: state.providerUnavailable,
            contextMismatchReasons: contextReasons
        }
    });
}

async function assertFreshPaymentReadiness({
    dbPool = pool,
    user,
    fiscalProfileId,
    fiscalRegisterId,
    paymentOrderId,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    action = 'payments.confirm_received',
    tender,
    env = process.env,
    fetchImpl,
    now = new Date()
} = {}) {
    const requiredTender = normalizeReadinessTender(tender);
    if (!requiredTender) {
        throw new PaymentReadinessError('payment_tender_required', 'Tender is required for payment readiness', { status: 422 });
    }
    const { scope, local } = await prepareReadinessScope({
        dbPool,
        user,
        crmProfileKey,
        registerAlias: PILOT_REGISTER_ALIAS,
        action,
        requireUserAuthorization: true,
        paymentOrderId,
        env,
        now
    });
    if (fiscalProfileId && Number(scope.mapping?.fiscal_profile_id || 0) !== Number(fiscalProfileId)) {
        throw new PaymentReadinessError('readiness_wrong_fiscal_profile', 'Checkbox readiness is not scoped to the payment fiscal profile', { status: 409 });
    }
    if (fiscalRegisterId && Number(scope.mapping?.fiscal_register_id || 0) !== Number(fiscalRegisterId)) {
        throw new PaymentReadinessError('readiness_wrong_fiscal_register', 'Checkbox readiness is not scoped to the payment fiscal register', { status: 409 });
    }
    if (!scope.mapping || !scope.runtimeConfig || !canProbeProviderReadiness(local)) {
        throwPaymentReadinessError(local);
    }

    let providerResult;
    try {
        providerResult = await probeProvider(scope, { fetchImpl, now, env, requiredTender });
    } catch (error) {
        const info = publicError(error);
        const providerUnavailable = info.retryable === true
            || info.unknown === true
            || info.status >= 500
            || /timeout|network|fetch|aborted/i.test(info.message);
        throwPaymentReadinessError({
            ...local,
            readinessCode: providerUnavailable ? 'provider_unavailable' : info.code,
            providerUnavailable,
            staleReadiness: false
        });
    }
    const state = {
        ...local,
        ...providerResult.state,
        fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
        fiscalRegisterId: Number(scope.mapping.fiscal_register_id),
        fiscalConfigurationHash: scope.configHash,
        fiscalTaxFingerprint: scope.paymentTaxContext?.fingerprint || null,
        expectedIsTest: scope.runtimeConfig.expectedIsTest,
        requiredTender,
        details: providerResult.details
    };
    const readyState = finalizeFreshReadiness(state);
    if (!readyState.integrationReady) throwPaymentReadinessError(readyState);
    return readyState;
}

async function assertPaymentReadiness({
    dbPool = pool,
    client = null,
    user,
    fiscalProfileId,
    fiscalRegisterId,
    paymentOrderId = null,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    action = 'payments.confirm_received',
    env = process.env,
    tender = null,
    freshProviderReadiness = null,
    expectedFiscalConfigurationHash = null,
    requirePaymentAcceptance = true
} = {}) {
    const run = async queryable => {
        const requiredTender = normalizeReadinessTender(tender);
        const checkboxIntegrationEnabled = isCheckboxIntegrationEnabled(env);
        const paymentAcceptanceEnabled = isCheckboxPaymentAcceptanceEnabled(env);
        const readinessPaymentAcceptanceEnabled = requirePaymentAcceptance ? paymentAcceptanceEnabled : true;
        const lockConfiguration = Boolean(client && freshProviderReadiness);
        const scope = await loadScope(queryable, {
            user,
            crmProfileKey,
            registerAlias: PILOT_REGISTER_ALIAS,
            action,
            requireUserAuthorization: true,
            lockConfiguration
        });
        let runtimeConfig = null;
        let runtimeConfigError = null;
        if (scope.mapping && checkboxIntegrationEnabled && scope.mapping.feature_enabled === true && scope.binding) {
            try {
                runtimeConfig = loadCheckboxRuntimeConfig({
                    env,
                    credentialRef: scope.binding.provider_cashier_login_ref || scope.mapping.provider_license_ref,
                    licenseRef: scope.mapping.provider_license_ref
                });
                assertRuntimeConfigMatchesMapping(scope.mapping, runtimeConfig);
            } catch (error) {
                runtimeConfigError = publicError(error);
            }
        }
        scope.runtimeConfig = runtimeConfig;
        scope.configHash = runtimeConfig ? buildFiscalConfigurationSnapshot({ mapping: scope.mapping, binding: scope.binding, runtimeConfig }).hash : null;
        scope.paymentTaxContext = scope.mapping && paymentOrderId
            ? await loadPaymentOrderTaxContext(queryable, {
                paymentOrderId,
                fiscalProfileId: scope.mapping.fiscal_profile_id,
                fiscalRegisterId: scope.mapping.fiscal_register_id,
                crmProfileKey: scope.mapping.crm_profile_key,
                lockConfiguration
            })
            : null;
        const local = baseReadiness({
            checkboxIntegrationEnabled,
            paymentAcceptanceEnabled: readinessPaymentAcceptanceEnabled,
            mapping: scope.mapping,
            matches: scope.matches,
            binding: scope.binding,
            tax: scope.tax,
            shift: scope.shift,
            runtimeConfig,
            runtimeConfigError
        });
        let state = local;
        if (scope.mapping) {
            state = {
                ...state,
                fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
                fiscalRegisterId: Number(scope.mapping.fiscal_register_id)
            };
        }
        if (scope.mapping && runtimeConfig && local.readinessCode === 'ready' && freshProviderReadiness) {
            const permissionPolicy = resolveUnreportedPaymentPermissionPolicy({
                env,
                expectedIsTest: runtimeConfig.expectedIsTest
            });
            const permissionDetails = paymentPermissionSnapshotDetails(
                { permissions: freshProviderReadiness.details?.permissions },
                requiredTender
            );
            const staleReadiness = freshProviderReadiness.staleReadiness === true
                || !freshProviderReadiness.expiresAt
                || Date.parse(freshProviderReadiness.expiresAt) <= Date.now();
            const contextMismatchReasons = [];
            if (Number(freshProviderReadiness.fiscalProfileId || 0) !== Number(scope.mapping.fiscal_profile_id)) contextMismatchReasons.push('fiscal_profile');
            if (Number(freshProviderReadiness.fiscalRegisterId || 0) !== Number(scope.mapping.fiscal_register_id)) contextMismatchReasons.push('fiscal_register');
            if (String(freshProviderReadiness.fiscalConfigurationHash || '') !== String(scope.configHash || '')) contextMismatchReasons.push('fiscal_configuration');
            if (expectedFiscalConfigurationHash != null
                && String(expectedFiscalConfigurationHash) !== String(scope.configHash || '')) contextMismatchReasons.push('expected_fiscal_configuration');
            if (String(freshProviderReadiness.fiscalTaxFingerprint || '') !== String(scope.paymentTaxContext?.fingerprint || '')) contextMismatchReasons.push('fiscal_tax');
            if (!freshShiftContextMatches(scope.shift, freshProviderReadiness)) contextMismatchReasons.push('shift');
            if (freshProviderReadiness.expectedIsTest !== runtimeConfig.expectedIsTest) contextMismatchReasons.push('is_test');
            if (normalizeReadinessTender(freshProviderReadiness.requiredTender) !== requiredTender) contextMismatchReasons.push('tender');
            const contextMismatch = contextMismatchReasons.length > 0;
            const providerProbeReady = freshProviderReadiness.providerReady === true;
            const unreportedPermissionBlocked = permissionDetails.unreported.length > 0 && !permissionPolicy.allowed;
            state = {
                ...local,
                ...freshProviderReadiness,
                checkboxIntegrationEnabled,
                paymentAcceptanceEnabled,
                localMappingReady: local.localMappingReady,
                runtimeSecretsResolvable: local.runtimeSecretsResolvable,
                registerActive: local.registerActive,
                taxMappingReady: local.taxMappingReady,
                staleReadiness,
                readinessCode: !providerProbeReady
                    ? freshProviderReadiness.readinessCode
                    : contextMismatch
                    ? 'readiness_context_changed'
                    : staleReadiness
                        ? 'readiness_stale'
                        : unreportedPermissionBlocked
                            ? 'checkbox_payment_permission_unreported'
                            : freshProviderReadiness.readinessCode,
                paymentPermissionWarning: permissionDetails.warning,
                unreportedPaymentPermissions: permissionDetails.unreported,
                contextMismatchReasons,
                integrationReady: false,
                fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
                fiscalRegisterId: Number(scope.mapping.fiscal_register_id)
            };
            state.integrationReady = !providerProbeReady || contextMismatch || staleReadiness || unreportedPermissionBlocked
                ? false
                : deriveIntegrationReady(state);
        } else if (scope.mapping && runtimeConfig && local.readinessCode === 'ready') {
            const latest = await loadLatestReadinessSnapshot(queryable, scope);
            const serialized = serializeReadinessSnapshot(latest);
            if (!serialized) {
                state = { ...local, readinessCode: 'readiness_missing', integrationReady: false };
            } else {
                const staleReadiness = serialized.staleReadiness === true;
                if (serialized.expectedIsTest !== runtimeConfig.expectedIsTest) {
                    state = {
                        ...local,
                        readinessCode: 'checkbox_expected_is_test_mismatch',
                        integrationReady: false,
                        staleReadiness,
                        fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
                        fiscalRegisterId: Number(scope.mapping.fiscal_register_id)
                    };
                } else {
                    const permissionPolicy = resolveUnreportedPaymentPermissionPolicy({
                        env,
                        expectedIsTest: runtimeConfig.expectedIsTest
                    });
                    const permissionDetails = paymentPermissionSnapshotDetails(serialized.result, requiredTender);
                    const unreportedPermissionBlocked = permissionDetails.unreported.length > 0 && !permissionPolicy.allowed;
                    state = {
                        ...local,
                        ...serialized,
                        checkboxIntegrationEnabled,
                        localMappingReady: local.localMappingReady,
                        runtimeSecretsResolvable: local.runtimeSecretsResolvable,
                        registerActive: local.registerActive,
                        taxMappingReady: local.taxMappingReady,
                        staleReadiness,
                        readinessCode: staleReadiness
                            ? 'readiness_stale'
                            : unreportedPermissionBlocked
                                ? 'checkbox_payment_permission_unreported'
                                : serialized.readinessCode,
                        paymentPermissionWarning: permissionDetails.warning,
                        unreportedPaymentPermissions: permissionDetails.unreported,
                        integrationReady: false,
                        fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
                        fiscalRegisterId: Number(scope.mapping.fiscal_register_id)
                    };
                    state.integrationReady = unreportedPermissionBlocked ? false : deriveIntegrationReady(state);
                }
            }
        }
        if (fiscalProfileId && Number(state.fiscalProfileId || 0) !== Number(fiscalProfileId)) {
            throw new PaymentReadinessError('readiness_wrong_fiscal_profile', 'Checkbox readiness is not scoped to the payment fiscal profile', { status: 409 });
        }
        if (fiscalRegisterId && Number(state.fiscalRegisterId || 0) !== Number(fiscalRegisterId)) {
            throw new PaymentReadinessError('readiness_wrong_fiscal_register', 'Checkbox readiness is not scoped to the payment fiscal register', { status: 409 });
        }
        const providerReady = state.integrationReady === true;
        if (!providerReady) throwPaymentReadinessError(state);
        if (!requirePaymentAcceptance) {
            return {
                ...state,
                paymentAcceptanceEnabled,
                providerReady,
                integrationReady: providerReady && paymentAcceptanceEnabled
            };
        }
        return state;
    };
    if (client) return run(client);
    return withTransaction(dbPool, run);
}

async function listUnresolvedPaymentOrders({
    dbPool = pool,
    user,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    page = 1,
    pageSize = 50
} = {}) {
    const pagination = normalizeUnresolvedPagination({ page, pageSize });
    const offset = (pagination.page - 1) * pagination.pageSize;
    return withTransaction(dbPool, async client => {
        const scope = await loadScope(client, { user, crmProfileKey, registerAlias, action: 'payments.view', requireUserAuthorization: true });
        if (!scope.mapping) {
            throw new PaymentReadinessError('mapping_missing', 'Fiscal profile/register mapping is missing', { status: 409 });
        }
        const currentUserId = Number(user?.id || 0);
        const counts = await client.query(
            `WITH latest_job AS (
                 SELECT DISTINCT ON (payment_order_id)
                        payment_order_id,
                        status
                   FROM payment_outbox_jobs
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id IS NOT NULL
                    AND job_type IN ('receipt_sell', 'receipt_status_lookup')
                  ORDER BY payment_order_id, created_at DESC, id DESC
             ), unresolved_orders AS (
                 SELECT po.id, po.cashier_user_id
                   FROM payment_orders po
                   LEFT JOIN fiscal_operations fo
                     ON fo.payment_order_id = po.id
                    AND fo.fiscal_profile_id = po.fiscal_profile_id
                    AND fo.operation_type = 'sale'
                   LEFT JOIN latest_job job ON job.payment_order_id = po.id
                  WHERE po.fiscal_profile_id = $1
                    AND po.fiscal_register_id = $2
                    AND po.payment_status = 'confirmed'
                    AND (
                        po.fiscal_status = ANY($3::text[])
                        OR job.status IN ('failed', 'dead', 'claimed', 'running')
                        OR fo.status IN ('pending', 'unknown', 'failed')
                    )
             )
             SELECT COUNT(*)::integer AS register_count,
                    COUNT(*) FILTER (WHERE cashier_user_id = $4)::integer AS my_count
               FROM unresolved_orders`,
            [scope.mapping.fiscal_profile_id, scope.mapping.fiscal_register_id, UNRESOLVED_FISCAL_STATUSES, currentUserId]
        );
        const result = await client.query(
            `WITH latest_job AS (
                 SELECT DISTINCT ON (payment_order_id)
                        payment_order_id,
                        id,
                        job_type,
                        status,
                        attempts,
                        max_attempts,
                        last_error_code,
                        next_run_at
                   FROM payment_outbox_jobs
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id IS NOT NULL
                    AND job_type IN ('receipt_sell', 'receipt_status_lookup')
                  ORDER BY payment_order_id, created_at DESC, id DESC
             )
             SELECT
                 po.id,
                 po.order_key,
                 po.cashier_user_id,
                 po.payment_status,
                 po.fiscal_status,
                 po.total_amount_minor,
                 po.currency,
                 po.created_at,
                 po.confirmed_at,
                 fo.id AS fiscal_operation_id,
                 fo.provider_operation_id,
                 fo.status AS fiscal_operation_status,
                 job.id AS outbox_job_id,
                 job.job_type,
                 job.status AS outbox_status,
                 job.attempts,
                 job.max_attempts,
                 job.last_error_code,
                 job.next_run_at
               FROM payment_orders po
               LEFT JOIN fiscal_operations fo
                 ON fo.payment_order_id = po.id
               AND fo.fiscal_profile_id = po.fiscal_profile_id
                AND fo.operation_type = 'sale'
               LEFT JOIN latest_job job ON job.payment_order_id = po.id
              WHERE po.fiscal_profile_id = $1
                AND po.fiscal_register_id = $2
                AND po.payment_status = 'confirmed'
                AND (
                    po.fiscal_status = ANY($3::text[])
                    OR job.status IN ('failed', 'dead', 'claimed', 'running')
                    OR fo.status IN ('pending', 'unknown', 'failed')
                )
              ORDER BY po.confirmed_at DESC NULLS LAST, po.id DESC
              LIMIT $4 OFFSET $5`,
            [
                scope.mapping.fiscal_profile_id,
                scope.mapping.fiscal_register_id,
                UNRESOLVED_FISCAL_STATUSES,
                pagination.pageSize,
                offset
            ]
        );
        const registerCount = Number(counts.rows[0]?.register_count || 0);
        const myCount = Number(counts.rows[0]?.my_count || 0);
        return {
            fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
            fiscalLocationId: Number(scope.mapping.fiscal_location_id),
            fiscalRegisterId: Number(scope.mapping.fiscal_register_id),
            registerWide: true,
            page: pagination.page,
            pageSize: pagination.pageSize,
            myCount,
            registerCount,
            hasMore: offset + result.rows.length < registerCount,
            orders: result.rows.map(row => ({
                id: Number(row.id),
                orderKey: row.order_key,
                isMine: Number(row.cashier_user_id || 0) === currentUserId,
                cashierIdentity: row.cashier_user_id == null ? null : `user:${Number(row.cashier_user_id)}`,
                paymentStatus: row.payment_status,
                fiscalStatus: publicFiscalQueueStatus(row),
                rawFiscalStatus: row.fiscal_status,
                totalAmountMinor: String(row.total_amount_minor),
                currency: row.currency,
                confirmedAt: row.confirmed_at || null,
                fiscalOperationId: row.fiscal_operation_id == null ? null : Number(row.fiscal_operation_id),
                providerOperationId: row.provider_operation_id || null,
                outboxJobId: row.outbox_job_id == null ? null : Number(row.outbox_job_id),
                outboxStatus: row.outbox_status || null,
                attempts: row.attempts == null ? null : Number(row.attempts),
                maxAttempts: row.max_attempts == null ? null : Number(row.max_attempts),
                lastErrorCode: row.last_error_code || null,
                nextRunAt: row.next_run_at || null,
                incidentReason: row.last_error_code || null
            }))
        };
    });
}

async function loadCheckboxSalesReport({
    dbPool = pool,
    user,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    dateFrom = null,
    dateTo = null,
    shiftId = null,
    cashierUserId = null,
    page = 1,
    pageSize = 50
} = {}) {
    const normalizedPage = Math.max(1, Math.min(Number(page) || 1, 10000));
    const normalizedPageSize = Math.max(1, Math.min(Number(pageSize) || 50, 100));
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const normalizedDateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(dateFrom || '')) ? String(dateFrom) : null;
    const normalizedDateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(dateTo || '')) ? String(dateTo) : null;
    const normalizedShiftId = shiftId == null || shiftId === ''
        ? null
        : Number(shiftId);
    if (normalizedShiftId != null && (!Number.isSafeInteger(normalizedShiftId) || normalizedShiftId <= 0)) {
        throw new PaymentReadinessError('shift_id_invalid', 'Fiscal shift id is invalid', { status: 422 });
    }
    const normalizedCashierUserId = String(cashierUserId || '').trim().toLowerCase() === 'mine'
        ? Number(user?.id || 0)
        : (cashierUserId == null || cashierUserId === '' ? null : Number(cashierUserId));
    if (normalizedCashierUserId != null && (!Number.isSafeInteger(normalizedCashierUserId) || normalizedCashierUserId <= 0)) {
        throw new PaymentReadinessError('cashier_user_id_invalid', 'Cashier user id filter is invalid', { status: 422 });
    }
    return withTransaction(dbPool, async client => {
        const scope = await loadScope(client, { user, crmProfileKey, registerAlias, action: 'payments.view', requireUserAuthorization: true });
        if (!scope.mapping) {
            throw new PaymentReadinessError('mapping_missing', 'Fiscal profile/register mapping is missing', { status: 409 });
        }
        const params = [
            scope.mapping.fiscal_profile_id,
            scope.mapping.fiscal_register_id,
            normalizedDateFrom,
            normalizedDateTo,
            normalizedShiftId,
            normalizedCashierUserId
        ];
        const rowsResult = await client.query(
            `WITH latest_job AS (
                 SELECT DISTINCT ON (payment_order_id)
                        payment_order_id,
                        status AS outbox_status,
                        attempts,
                        max_attempts,
                        last_error_code,
                        next_run_at
                   FROM payment_outbox_jobs
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id IS NOT NULL
                    AND job_type IN ('receipt_sell', 'receipt_status_lookup')
                  ORDER BY payment_order_id, created_at DESC, id DESC
             ),
             latest_receipt AS (
                 SELECT DISTINCT ON (payment_order_id)
                        payment_order_id,
                        status AS receipt_status,
                        provider_receipt_id,
                        provider_tax_url,
                        provider_pdf_url,
                        provider_qr_url,
                        fiscalized_at
                   FROM fiscal_receipts
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id IS NOT NULL
                    AND receipt_type = 'sale'
                  ORDER BY payment_order_id, created_at DESC, id DESC
             )
             SELECT
                 po.id,
                 po.order_key,
                 po.payment_status,
                 po.fiscal_status,
                 po.payment_method,
                 po.total_amount_minor,
                 po.currency,
                 po.confirmed_at,
                 job.outbox_status,
                 job.attempts,
                 job.max_attempts,
                 job.last_error_code,
                 job.next_run_at,
                 receipt.provider_receipt_id,
                 receipt.provider_tax_url,
                 receipt.provider_pdf_url,
                 receipt.provider_qr_url,
                 receipt.fiscalized_at
               FROM payment_orders po
               LEFT JOIN latest_job job ON job.payment_order_id = po.id
               LEFT JOIN latest_receipt receipt ON receipt.payment_order_id = po.id
               LEFT JOIN fiscal_operations fo
                 ON fo.payment_order_id = po.id
                AND fo.fiscal_profile_id = po.fiscal_profile_id
                AND fo.operation_type = 'sale'
              WHERE po.fiscal_profile_id = $1
                AND po.fiscal_register_id = $2
                AND po.payment_status = 'confirmed'
                AND ($3::date IS NULL OR (po.confirmed_at AT TIME ZONE 'Europe/Kyiv')::date >= $3::date)
                AND ($4::date IS NULL OR (po.confirmed_at AT TIME ZONE 'Europe/Kyiv')::date <= $4::date)
                AND ($5::bigint IS NULL OR fo.fiscal_shift_id = $5::bigint)
                AND ($6::bigint IS NULL OR po.cashier_user_id = $6::bigint)
              ORDER BY po.confirmed_at DESC NULLS LAST, po.id DESC
              LIMIT $7 OFFSET $8`,
            [...params, normalizedPageSize, offset]
        );
        const rows = rowsResult.rows.map(row => ({
            id: Number(row.id),
            orderKey: row.order_key,
            paymentStatus: row.payment_status,
            fiscalStatus: publicFiscalQueueStatus(row),
            rawFiscalStatus: row.fiscal_status,
            paymentMethod: row.payment_method,
            totalAmountMinor: String(row.total_amount_minor),
            currency: row.currency,
            confirmedAt: row.confirmed_at || null,
            outboxStatus: row.outbox_status || null,
            attempts: row.attempts == null ? null : Number(row.attempts),
            maxAttempts: row.max_attempts == null ? null : Number(row.max_attempts),
            lastErrorCode: row.last_error_code || null,
            nextRunAt: row.next_run_at || null,
            providerReceiptId: row.provider_receipt_id || null,
            providerTaxUrl: row.provider_tax_url || null,
            providerPdfUrl: row.provider_pdf_url || null,
            providerQrUrl: row.provider_qr_url || null,
            fiscalizedAt: row.fiscalized_at || null
        }));
        const totalsResult = await client.query(
            `WITH latest_job AS (
                 SELECT DISTINCT ON (payment_order_id)
                        payment_order_id,
                        status AS outbox_status
                   FROM payment_outbox_jobs
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id IS NOT NULL
                    AND job_type IN ('receipt_sell', 'receipt_status_lookup')
                  ORDER BY payment_order_id, created_at DESC, id DESC
             ),
             filtered AS (
                 SELECT po.id,
                        po.fiscal_status,
                        po.payment_method,
                        po.total_amount_minor,
                        job.outbox_status
                   FROM payment_orders po
                   LEFT JOIN latest_job job ON job.payment_order_id = po.id
                   LEFT JOIN fiscal_operations fo
                     ON fo.payment_order_id = po.id
                    AND fo.fiscal_profile_id = po.fiscal_profile_id
                    AND fo.operation_type = 'sale'
                  WHERE po.fiscal_profile_id = $1
                    AND po.fiscal_register_id = $2
                    AND po.payment_status = 'confirmed'
                    AND ($3::date IS NULL OR (po.confirmed_at AT TIME ZONE 'Europe/Kyiv')::date >= $3::date)
                    AND ($4::date IS NULL OR (po.confirmed_at AT TIME ZONE 'Europe/Kyiv')::date <= $4::date)
                    AND ($5::bigint IS NULL OR fo.fiscal_shift_id = $5::bigint)
                    AND ($6::bigint IS NULL OR po.cashier_user_id = $6::bigint)
             ),
             status_counts AS (
                 SELECT jsonb_object_agg(public_status, status_count) AS status_counts
                   FROM (
                     SELECT CASE
                               WHEN outbox_status = 'dead' THEN 'dead'
                               WHEN fiscal_status = 'failed' OR outbox_status IN ('failed', 'claimed', 'running') THEN 'failed_retryable'
                               ELSE fiscal_status
                            END AS public_status,
                            COUNT(*) AS status_count
                       FROM filtered
                      GROUP BY public_status
                   ) grouped
             ),
             totals AS (
                 SELECT
                     COUNT(*) AS total_count,
                     COALESCE(SUM(total_amount_minor), 0)::text AS payment_total_minor,
                     COALESCE(SUM(total_amount_minor) FILTER (WHERE payment_method = 'cash'), 0)::text AS cash_total_minor,
                     COALESCE(SUM(total_amount_minor) FILTER (WHERE payment_method = 'card_terminal'), 0)::text AS card_terminal_total_minor
                   FROM filtered
             )
             SELECT totals.total_count,
                    totals.payment_total_minor,
                    totals.cash_total_minor,
                    totals.card_terminal_total_minor,
                    COALESCE(status_counts.status_counts, '{}'::jsonb) AS status_counts
               FROM totals
               CROSS JOIN status_counts`,
            params
        );
        const totalsRow = totalsResult.rows[0] || {};
        return {
            fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
            fiscalRegisterId: Number(scope.mapping.fiscal_register_id),
            internalReport: true,
            officialZReport: false,
            page: normalizedPage,
            pageSize: normalizedPageSize,
            totalCount: Number(totalsRow.total_count || 0),
            filters: {
                dateFrom: normalizedDateFrom,
                dateTo: normalizedDateTo,
                shiftId: normalizedShiftId,
                cashierUserId: normalizedCashierUserId
            },
            totals: {
                paymentTotalMinor: String(totalsRow.payment_total_minor || '0'),
                cashTotalMinor: String(totalsRow.cash_total_minor || '0'),
                cardTerminalTotalMinor: String(totalsRow.card_terminal_total_minor || '0'),
                statusCounts: totalsRow.status_counts || {}
            },
            orders: rows
        };
    });
}

async function loadOperationalHealth({
    dbPool = pool,
    user,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    env = process.env
} = {}) {
    return withTransaction(dbPool, async client => {
        const scope = await loadScope(client, { user, crmProfileKey, registerAlias, action: 'fiscal.audit.view', requireUserAuthorization: true });
        if (!scope.mapping) {
            throw new PaymentReadinessError('mapping_missing', 'Fiscal profile/register mapping is missing', { status: 409 });
        }
        const latest = await loadLatestReadinessSnapshot(client, scope);
        const readiness = serializeReadinessSnapshot(latest);
        const queue = await client.query(
            `SELECT
                 COUNT(*) FILTER (WHERE job.status IN ('queued', 'failed', 'claimed', 'running')) AS queue_depth,
                 MIN(job.created_at) FILTER (WHERE job.status IN ('queued', 'failed', 'claimed', 'running')) AS oldest_pending_at,
                 COUNT(*) FILTER (WHERE fo.status = 'unknown' OR po.fiscal_status = 'unknown') AS unknown_count,
                 COUNT(*) FILTER (WHERE job.status = 'dead') AS dead_count
               FROM payment_outbox_jobs job
               LEFT JOIN fiscal_operations fo
                 ON fo.id = job.fiscal_operation_id
                AND fo.fiscal_profile_id = job.fiscal_profile_id
               LEFT JOIN payment_orders po
                 ON po.id = job.payment_order_id
                AND po.fiscal_profile_id = job.fiscal_profile_id
              WHERE job.fiscal_profile_id = $1
                AND COALESCE(po.fiscal_register_id, fo.fiscal_register_id) = $2`,
            [scope.mapping.fiscal_profile_id, scope.mapping.fiscal_register_id]
        );
        const shift = scope.shift;
        return {
            fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
            fiscalRegisterId: Number(scope.mapping.fiscal_register_id),
            checkboxIntegrationEnabled: isCheckboxIntegrationEnabled(env),
            readinessCode: readiness?.readinessCode || 'readiness_missing',
            staleReadiness: !readiness || readiness.staleReadiness === true,
            queueDepth: Number(queue.rows[0]?.queue_depth || 0),
            oldestPendingAt: queue.rows[0]?.oldest_pending_at || null,
            unknownCount: Number(queue.rows[0]?.unknown_count || 0),
            deadCount: Number(queue.rows[0]?.dead_count || 0),
            shiftOpenDurationSeconds: shift?.opened_at && shift.status === 'open'
                ? Math.floor((Date.now() - new Date(shift.opened_at).getTime()) / 1000)
                : null
        };
    });
}

async function listOperationalIncidents({
    dbPool = pool,
    user,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS,
    status = 'open'
} = {}) {
    return withTransaction(dbPool, async client => {
        const scope = await loadScope(client, { user, crmProfileKey, registerAlias, action: 'fiscal.audit.view', requireUserAuthorization: true });
        if (!scope.mapping) {
            throw new PaymentReadinessError('mapping_missing', 'Fiscal profile/register mapping is missing', { status: 409 });
        }
        const normalizedStatus = String(status || 'open').trim().toLowerCase();
        const result = await client.query(
            `SELECT id, fiscal_operation_id, payment_order_id, severity, incident_type,
                    status, details, created_at, resolved_at
               FROM fiscal_operational_incidents
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND ($3::text = 'all' OR status = $3::text)
              ORDER BY created_at DESC, id DESC
              LIMIT 100`,
            [scope.mapping.fiscal_profile_id, scope.mapping.fiscal_register_id, ['open', 'acknowledged', 'resolved', 'all'].includes(normalizedStatus) ? normalizedStatus : 'open']
        );
        return {
            fiscalProfileId: Number(scope.mapping.fiscal_profile_id),
            fiscalRegisterId: Number(scope.mapping.fiscal_register_id),
            incidents: result.rows.map(row => ({
                id: Number(row.id),
                fiscalOperationId: row.fiscal_operation_id == null ? null : Number(row.fiscal_operation_id),
                paymentOrderId: row.payment_order_id == null ? null : Number(row.payment_order_id),
                severity: row.severity,
                incidentType: row.incident_type,
                status: row.status,
                details: row.details || {},
                createdAt: row.created_at || null,
                resolvedAt: row.resolved_at || null
            }))
        };
    });
}

async function upsertOperationalIncident(client, {
    fiscalProfileId,
    fiscalRegisterId = null,
    fiscalOperationId = null,
    paymentOrderId = null,
    severity = 'warning',
    incidentType,
    idempotencyKey,
    details = {}
} = {}) {
    if (!fiscalProfileId || !incidentType || !idempotencyKey) return null;
    const result = await client.query(
        `INSERT INTO fiscal_operational_incidents (
             fiscal_profile_id, fiscal_register_id, fiscal_operation_id, payment_order_id,
             severity, incident_type, status, idempotency_key, details
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8::jsonb)
         ON CONFLICT (idempotency_key) DO UPDATE
             SET status = CASE
                     WHEN fiscal_operational_incidents.status = 'resolved' THEN 'open'
                     ELSE fiscal_operational_incidents.status
                 END,
                 severity = EXCLUDED.severity,
                 details = fiscal_operational_incidents.details || EXCLUDED.details,
                 recurrence_count = CASE
                     WHEN fiscal_operational_incidents.status = 'resolved'
                     THEN fiscal_operational_incidents.recurrence_count + 1
                     ELSE fiscal_operational_incidents.recurrence_count
                 END,
                 last_seen_at = NOW(),
                 resolved_at = CASE
                     WHEN fiscal_operational_incidents.status = 'resolved' THEN NULL
                     ELSE fiscal_operational_incidents.resolved_at
                 END
         RETURNING id, status`,
        [
            fiscalProfileId,
            fiscalRegisterId,
            fiscalOperationId,
            paymentOrderId,
            severity,
            incidentType,
            idempotencyKey,
            JSON.stringify(details)
        ]
    );
    return result.rows[0] || null;
}

async function resolveOperationalIncidents(client, {
    fiscalProfileId,
    fiscalRegisterId,
    incidentTypes = [],
    reason = 'auto_resolved'
} = {}) {
    const types = (incidentTypes || []).map(type => String(type || '').trim()).filter(Boolean);
    if (!fiscalProfileId || !fiscalRegisterId || !types.length) return 0;
    const result = await client.query(
        `UPDATE fiscal_operational_incidents
            SET status = 'resolved',
                resolved_at = COALESCE(resolved_at, NOW()),
                details = details || jsonb_build_object('auto_resolved_at', to_jsonb(NOW()), 'auto_resolved_reason', $4::text)
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND incident_type = ANY($3::text[])
            AND status <> 'resolved'`,
        [fiscalProfileId, fiscalRegisterId, types, reason]
    );
    return result.rowCount || 0;
}

async function updateOperationalIncidentStatus({
    dbPool = pool,
    user,
    incidentId,
    status,
    reason = null,
    crmProfileKey = PILOT_CRM_PROFILE_KEY,
    registerAlias = PILOT_REGISTER_ALIAS
} = {}) {
    const id = Number(incidentId);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new PaymentReadinessError('incident_id_invalid', 'Operational incident id is invalid', { status: 422 });
    }
    const nextStatus = String(status || '').trim().toLowerCase();
    if (!['acknowledged', 'resolved'].includes(nextStatus)) {
        throw new PaymentReadinessError('incident_status_invalid', 'Operational incident status is invalid', { status: 422 });
    }
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) {
        throw new PaymentReadinessError('incident_reason_required', 'Incident lifecycle changes require a reason', { status: 422 });
    }
    return withTransaction(dbPool, async client => {
        const scope = await loadScope(client, { user, crmProfileKey, registerAlias, action: 'fiscal.incident.manage', requireUserAuthorization: true });
        if (!scope.mapping) {
            throw new PaymentReadinessError('mapping_missing', 'Fiscal profile/register mapping is missing', { status: 409 });
        }
        assertIntegrationOwner(scope.mapping, user);
        const result = await client.query(
            `UPDATE fiscal_operational_incidents
                SET status = $4::text,
                    resolved_at = CASE WHEN $4::text = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
                    details = details || jsonb_build_object(
                        $4::text || '_by_user_id', to_jsonb($5::bigint),
                        $4::text || '_at', to_jsonb(NOW()),
                        $4::text || '_reason', to_jsonb($6::text)
                    )
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND fiscal_register_id = $3
                AND status <> 'resolved'
              RETURNING id, status, resolved_at, details`,
            [
                id,
                scope.mapping.fiscal_profile_id,
                scope.mapping.fiscal_register_id,
                nextStatus,
                user?.id || null,
                normalizedReason.slice(0, 500)
            ]
        );
        if (!result.rows.length) {
            throw new PaymentReadinessError('incident_not_found_or_closed', 'Operational incident is not open in this fiscal scope', { status: 404 });
        }
        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                 idempotency_key, after_snapshot, metadata
             )
             VALUES ($1, $2, $3, 'fiscal_operational_incidents', $4, $5, $6::jsonb, $7::jsonb)`,
            [
                scope.mapping.fiscal_profile_id,
                user?.id || null,
                `fiscal_incident_${nextStatus}`,
                id,
                `fiscal_incident_${nextStatus}:${id}:${user?.id || 'unknown'}:${Date.now()}`,
                JSON.stringify({
                    status: result.rows[0].status,
                    resolved_at: result.rows[0].resolved_at || null
                }),
                JSON.stringify({
                    reason: normalizedReason.slice(0, 500),
                    fiscal_register_id: Number(scope.mapping.fiscal_register_id),
                    integration_owner: scope.mapping.register_metadata?.integration_owner || null
                })
            ]
        );
        return {
            incident: {
                id: Number(result.rows[0].id),
                status: result.rows[0].status,
                resolvedAt: result.rows[0].resolved_at || null,
                details: result.rows[0].details || {}
            }
        };
    });
}

async function countCloseBlockers(client, shift) {
    const result = await client.query(
        `WITH latest_job AS (
             SELECT DISTINCT ON (payment_order_id)
                    payment_order_id,
                    status
               FROM payment_outbox_jobs
              WHERE fiscal_profile_id = $1
                AND payment_order_id IS NOT NULL
                AND job_type IN ('receipt_sell', 'receipt_status_lookup')
              ORDER BY payment_order_id, created_at DESC, id DESC
         )
         SELECT COUNT(*) AS blocker_count
           FROM payment_orders po
           LEFT JOIN fiscal_operations fo
             ON fo.payment_order_id = po.id
            AND fo.fiscal_profile_id = po.fiscal_profile_id
            AND fo.operation_type = 'sale'
           LEFT JOIN latest_job job ON job.payment_order_id = po.id
          WHERE po.fiscal_profile_id = $1
            AND po.fiscal_register_id = $2
            AND po.payment_status = 'confirmed'
            AND (
                po.fiscal_status IN ('pending', 'unknown', 'failed', 'validating', 'ready_to_send', 'sending', 'blocked')
                OR fo.status IN ('pending', 'unknown', 'failed')
                OR job.status IN ('failed', 'dead', 'claimed', 'running')
            )`,
        [shift.fiscal_profile_id, shift.fiscal_register_id]
    );
    return Number(result.rows[0]?.blocker_count || 0);
}

async function loadAndAuthorizePhase1CloseShift(client, {
    user,
    shiftId,
    lock = false,
    requireProviderOpen = true
} = {}) {
    const lockClause = lock ? ' FOR UPDATE' : '';
    const shiftResult = await client.query(
        `SELECT fs.*,
                fp.crm_profile_key,
                fp.legal_entity_key,
                fp.provider_organization_id,
                fr.fiscal_location_id,
                fr.register_alias,
                fr.provider_register_id,
                fr.provider_license_ref,
                fr.provider,
                fr.feature_enabled,
                fr.status AS fiscal_register_status,
                fr.metadata AS register_metadata,
                fl.provider_outlet_id
           FROM fiscal_shifts fs
           JOIN fiscal_profiles fp
             ON fp.id = fs.fiscal_profile_id
           JOIN fiscal_registers fr
             ON fr.id = fs.fiscal_register_id
            AND fr.fiscal_profile_id = fs.fiscal_profile_id
           JOIN fiscal_locations fl
             ON fl.id = fr.fiscal_location_id
            AND fl.fiscal_profile_id = fr.fiscal_profile_id
          WHERE fs.id = $1${lockClause}`,
        [shiftId]
    );
    if (!shiftResult.rows.length) {
        throw new PaymentReadinessError('shift_not_found', 'Fiscal shift not found', { status: 404 });
    }
    const shift = shiftResult.rows[0];
    assertPhase1CloseIntegrationOwner(shift, user);
    await authorizeFiscalAction(client, {
        user,
        action: 'fiscal.shift.close',
        fiscalProfileId: shift.fiscal_profile_id,
        crmProfileKey: shift.crm_profile_key,
        fiscalLocationId: shift.fiscal_location_id,
        fiscalRegisterId: shift.fiscal_register_id
    });
    if (shift.crm_profile_key !== PILOT_CRM_PROFILE_KEY || shift.register_alias !== PILOT_REGISTER_ALIAS) {
        throw new PaymentReadinessError('phase1_shift_scope_not_supported', 'Phase-1 close supports only the park middle register', {
            status: 403
        });
    }
    if (requireProviderOpen && (shift.status !== 'open' || shift.lifecycle_stage !== 'OPENED' || !shift.provider_shift_id)) {
        throw new PaymentReadinessError('shift_not_provider_open', 'Only a provider OPENED shift can be closed by the Phase-1 flow', { status: 409 });
    }
    return shift;
}

function phase1CloseOperationIdempotencyKey(idempotencyKey) {
    const digest = crypto.createHash('sha256').update(String(idempotencyKey || '').trim()).digest('hex');
    return `fiscal_operation:phase1_close:${digest}`;
}

async function loadPhase1CloseReplay(client, {
    operationIdempotencyKey,
    shift
} = {}) {
    const result = await client.query(
        `SELECT fo.*,
                fs.status AS current_shift_status,
                fs.lifecycle_stage AS current_shift_lifecycle_stage,
                job.id AS outbox_job_id,
                job.status AS outbox_job_status,
                job.job_type AS outbox_job_type,
                job.payload AS outbox_job_payload,
                job.job_count AS outbox_job_count
           FROM fiscal_operations fo
           JOIN fiscal_shifts fs
             ON fs.id = fo.fiscal_shift_id
            AND fs.fiscal_profile_id = fo.fiscal_profile_id
            AND fs.fiscal_register_id = fo.fiscal_register_id
           LEFT JOIN LATERAL (
                SELECT payment_outbox_jobs.*,
                       COUNT(*) OVER () AS job_count
                  FROM payment_outbox_jobs
                 WHERE payment_outbox_jobs.fiscal_operation_id = fo.id
                   AND payment_outbox_jobs.fiscal_profile_id = fo.fiscal_profile_id
                 ORDER BY payment_outbox_jobs.id DESC
                 LIMIT 1
           ) job ON TRUE
          WHERE fo.idempotency_key = $1`,
        [operationIdempotencyKey]
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const requestSnapshot = row.request_snapshot && typeof row.request_snapshot === 'object' ? row.request_snapshot : {};
    const payload = row.outbox_job_payload && typeof row.outbox_job_payload === 'object' ? row.outbox_job_payload : {};
    const expectedProviderUuid = String(row.provider_operation_id || '').trim();
    const exactScope = row.operation_type === 'shift_close'
        && requestSnapshot.phase === 'thin_mvp_shift_close'
        && Number(row.fiscal_shift_id) === Number(shift.id)
        && Number(row.fiscal_profile_id) === Number(shift.fiscal_profile_id)
        && Number(row.fiscal_register_id) === Number(shift.fiscal_register_id);
    if (!exactScope) {
        throw new PaymentReadinessError('phase1_close_idempotency_conflict', 'Idempotency-Key is already bound to another Phase-1 close request', { status: 409 });
    }
    const exactJob = Number(row.outbox_job_count) === 1
        && Number(row.outbox_job_id) > 0
        && row.outbox_job_type === 'shift_close'
        && String(payload.provider_request_uuid || '').trim() === expectedProviderUuid;
    if (!expectedProviderUuid || !exactJob) {
        throw new PaymentReadinessError('phase1_close_replay_incomplete', 'Existing Phase-1 close request has an incomplete immutable outbox identity', { status: 409 });
    }
    return {
        replayed: true,
        fiscalShiftId: Number(row.fiscal_shift_id),
        fiscalOperationId: Number(row.id),
        outboxJobId: Number(row.outbox_job_id),
        status: row.current_shift_status,
        providerRequestUuid: expectedProviderUuid
    };
}

async function requestPhase1ShiftClose({
    dbPool = pool,
    user,
    shiftId,
    idempotencyKey,
    body = {},
    env = process.env,
    fetchImpl
} = {}) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new PaymentReadinessError('idempotency_key_required', 'Idempotency-Key is required', { status: 400 });
    const hasMutableBody = Array.isArray(body)
        ? body.length > 0
        : body && typeof body === 'object'
            ? Object.keys(body).length > 0
            : body != null && String(body).trim() !== '';
    if (hasMutableBody) {
        throw new PaymentReadinessError('phase1_close_body_unsupported', 'Phase-1 close does not accept mutable request fields', { status: 422 });
    }
    const numericShiftId = Number(shiftId);
    if (!Number.isSafeInteger(numericShiftId) || numericShiftId <= 0) {
        throw new PaymentReadinessError('shift_id_invalid', 'Fiscal shift id is invalid', { status: 422 });
    }
    const operationIdempotencyKey = phase1CloseOperationIdempotencyKey(key);
    const preflight = await withTransaction(dbPool, async client => {
        const shift = await loadAndAuthorizePhase1CloseShift(client, {
            user,
            shiftId: numericShiftId,
            lock: false,
            requireProviderOpen: false
        });
        const replay = await loadPhase1CloseReplay(client, { operationIdempotencyKey, shift });
        if (replay) return { shift, replay };
        if (shift.status !== 'open' || shift.lifecycle_stage !== 'OPENED' || !shift.provider_shift_id) {
            throw new PaymentReadinessError('shift_not_provider_open', 'Only a provider OPENED shift can be closed by the Phase-1 flow', { status: 409 });
        }
        return { shift, replay: null };
    });
    if (preflight.replay) return preflight.replay;
    const preauthorizedShift = preflight.shift;
    // A Phase-1 close is a recovery action, not a new payment acceptance.
    // Refresh provider identity/shift state before opening the short DB transaction
    // so a stale cached readiness snapshot cannot strand an already-paid shift.
    const freshProviderReadiness = await probeCheckboxReadiness({
        dbPool,
        user,
        crmProfileKey: preauthorizedShift.crm_profile_key,
        registerAlias: preauthorizedShift.register_alias,
        action: 'fiscal.shift.close',
        env,
        fetchImpl,
        force: true
    });
    const result = await withTransaction(dbPool, async client => {
        const shift = await loadAndAuthorizePhase1CloseShift(client, {
            user,
            shiftId: numericShiftId,
            lock: true,
            requireProviderOpen: false
        });
        const replay = await loadPhase1CloseReplay(client, { operationIdempotencyKey, shift });
        if (replay) return replay;
        if (shift.status !== 'open' || shift.lifecycle_stage !== 'OPENED' || !shift.provider_shift_id) {
            throw new PaymentReadinessError('shift_not_provider_open', 'Only a provider OPENED shift can be closed by the Phase-1 flow', { status: 409 });
        }
        const blockers = await countCloseBlockers(client, shift);
        if (blockers > 0) {
            throw new PaymentReadinessError('shift_close_blocked_unresolved', 'Unresolved payment/fiscal operations block shift close', {
                status: 409,
                details: { blockerCount: blockers }
            });
        }
        await assertPaymentReadiness({
            client,
            user,
            fiscalProfileId: shift.fiscal_profile_id,
            fiscalRegisterId: shift.fiscal_register_id,
            crmProfileKey: shift.crm_profile_key,
            action: 'fiscal.shift.close',
            requirePaymentAcceptance: false,
            freshProviderReadiness,
            env
        });
        const binding = await loadFiscalCashierBinding(client, {
            userId: user?.id,
            fiscalProfileId: shift.fiscal_profile_id,
            fiscalRegisterId: shift.fiscal_register_id
        });
        const runtimeConfig = loadCheckboxRuntimeConfig({
            env,
            credentialRef: binding.provider_cashier_login_ref || shift.provider_license_ref,
            licenseRef: shift.provider_license_ref
        });
        const fiscalConfig = buildFiscalConfigurationSnapshot({ mapping: shift, binding, runtimeConfig });
        const providerRequestUuid = crypto.randomUUID();
        const operation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id, operation_type, status,
                 approval_required, server_approval_status, idempotency_key, provider, provider_operation_id,
                 currency, request_snapshot, initiated_by_user_id,
                 provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
                 register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash,
                     fiscal_location_id, external_stage
             )
             VALUES ($1, $2, $3, 'shift_close', 'pending', FALSE, 'not_required', $4, 'checkbox', $5,
                     'UAH', $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'auth')
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                shift.fiscal_profile_id,
                shift.fiscal_register_id,
                shift.id,
                operationIdempotencyKey,
                providerRequestUuid,
                JSON.stringify({
                    phase: 'thin_mvp_shift_close',
                    provider_request_uuid: providerRequestUuid,
                    provider_shift_id: shift.provider_shift_id,
                    fiscal_configuration_hash: fiscalConfig.hash,
                    provider_context: fiscalConfig.snapshot,
                    external_stage: 'auth'
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
            const replayAfterConflict = await loadPhase1CloseReplay(client, { operationIdempotencyKey, shift });
            if (replayAfterConflict) return replayAfterConflict;
            throw new PaymentReadinessError('phase1_close_idempotency_conflict', 'Idempotency-Key conflict could not be resolved safely', { status: 409 });
        }
        await client.query(
            `UPDATE fiscal_shifts
                SET status = 'closing',
                    lifecycle_stage = 'CLOSING',
                    close_operation_id = $2,
                    closed_by_user_id = $3,
                    provider_snapshot = provider_snapshot || $4::jsonb,
                    updated_at = NOW()
              WHERE id = $1`,
            [
                shift.id,
                closeOperation.id,
                user?.id || null,
                JSON.stringify({ phase: 'thin_mvp_shift_close', provider_shift_id: shift.provider_shift_id })
            ]
        );
        const job = await client.query(
            `INSERT INTO payment_outbox_jobs (
                 fiscal_profile_id, fiscal_operation_id, payment_order_id, job_type,
                 status, idempotency_key, payload, external_stage
             )
             VALUES ($1, $2, NULL, 'shift_close', 'queued', $3, $4::jsonb, 'auth')
             ON CONFLICT (idempotency_key) DO UPDATE
                 SET next_run_at = LEAST(payment_outbox_jobs.next_run_at, NOW()),
                     updated_at = NOW()
             RETURNING *`,
            [
                shift.fiscal_profile_id,
                closeOperation.id,
                `payment_outbox:phase1_shift_close:${closeOperation.id}`,
                JSON.stringify({ provider: 'checkbox', provider_request_uuid: providerRequestUuid, fiscal_shift_id: Number(shift.id), phase: 'thin_mvp_shift_close', external_stage: 'auth' })
            ]
        );
        return {
            replayed: false,
            fiscalShiftId: Number(shift.id),
            fiscalOperationId: Number(closeOperation.id),
            outboxJobId: Number(job.rows[0].id),
            status: 'closing',
            providerRequestUuid
        };
    });
    if (!result.replayed) {
        requestPaymentOutboxWakeup({ batchSize: 1, reason: 'phase1_shift_close_requested' });
    }
    return result;
}

async function runCheckboxReadinessProbeScheduler({ dbPool = pool, env = process.env, fetchImpl } = {}) {
    if (!isCheckboxIntegrationEnabled(env)) return { ok: true, skipped: true, reason: 'checkbox_integration_disabled', probed: 0 };
    const client = await dbPool.connect();
    try {
        const result = await client.query(
            `SELECT DISTINCT
                    fp.crm_profile_key,
                    fr.register_alias,
                    fcb.*
               FROM fiscal_cashier_bindings fcb
               JOIN fiscal_profiles fp
                 ON fp.id = fcb.fiscal_profile_id
                AND fp.status = 'active'
               JOIN fiscal_registers fr
                 ON fr.id = fcb.fiscal_register_id
                AND fr.fiscal_profile_id = fcb.fiscal_profile_id
                AND fr.status = 'active'
                AND fr.feature_enabled = TRUE
                AND fr.provider = 'checkbox'
              WHERE fcb.status = 'active'
              ORDER BY fp.crm_profile_key, fr.register_alias, fcb.id
              LIMIT 20`
        );
        let probed = 0;
        let failed = 0;
        for (const row of result.rows) {
            try {
                const prepared = await withTransaction(dbPool, async tx => {
                    const scope = await loadScopeForBinding(tx, row);
                    if (!scope) return null;
                    const runtimeConfig = loadCheckboxRuntimeConfig({
                        env,
                        credentialRef: row.provider_cashier_login_ref || scope.mapping.provider_license_ref,
                        licenseRef: scope.mapping.provider_license_ref
                    });
                    assertRuntimeConfigMatchesMapping(scope.mapping, runtimeConfig);
                    scope.runtimeConfig = runtimeConfig;
                    scope.configHash = buildFiscalConfigurationSnapshot({ mapping: scope.mapping, binding: scope.binding, runtimeConfig }).hash;
                    const local = baseReadiness({
                        checkboxIntegrationEnabled: true,
                        paymentAcceptanceEnabled: true,
                        mapping: scope.mapping,
                        matches: 1,
                        binding: scope.binding,
                        tax: scope.tax,
                        shift: scope.shift,
                        runtimeConfig
                    });
                    return { scope, local };
                });
                if (!prepared) continue;
                let resultState;
                if (!canProbeProviderReadiness(prepared.local)) {
                    resultState = { state: prepared.local, details: { reason: prepared.local.readinessCode } };
                } else {
                        resultState = await probeProvider(prepared.scope, { fetchImpl, env });
                }
                await withTransaction(dbPool, async tx => {
                    await syncPortalClosedShift(tx, prepared.scope, resultState.state.shiftState);
                    await insertReadinessSnapshot(tx, prepared.scope, resultState.state, resultState.details);
                    if (resultState.state.integrationReady === true) {
                        await resolveOperationalIncidents(tx, {
                            fiscalProfileId: prepared.scope.mapping?.fiscal_profile_id,
                            fiscalRegisterId: prepared.scope.mapping?.fiscal_register_id,
                            incidentTypes: ['checkbox.readiness_probe_failed', 'checkbox.provider_unavailable'],
                            reason: 'scheduler_probe_recovered'
                        });
                    }
                });
                probed += 1;
            } catch (error) {
                failed += 1;
                await withTransaction(dbPool, async tx => {
                    await upsertOperationalIncident(tx, {
                        fiscalProfileId: row.fiscal_profile_id,
                        fiscalRegisterId: row.fiscal_register_id,
                        severity: 'warning',
                        incidentType: 'checkbox.readiness_probe_failed',
                        idempotencyKey: `checkbox.readiness_probe_failed:${row.fiscal_profile_id}:${row.fiscal_register_id}`,
                        details: {
                            code: publicError(error).code,
                            message: publicError(error).message,
                            crm_profile_key: row.crm_profile_key,
                            register_alias: row.register_alias,
                            sanitized: true
                        }
                    });
                });
            }
        }
        if (failed > 0) {
            throw new PaymentReadinessError('checkbox_readiness_probe_degraded', 'Checkbox readiness scheduler completed with failed probes', {
                status: 503,
                details: { probed, failed }
            });
        }
        return { ok: true, probed, failed };
    } finally {
        client.release();
    }
}

function readinessErrorResponse(error) {
    if (error instanceof PaymentReadinessError || error instanceof FiscalAccessError || error instanceof CheckboxClientError) {
        const safe = publicError(error);
        return {
            status: safe.status || 400,
            body: {
                success: false,
                error: safe.message,
                code: safe.code,
                details: safe.details == null ? undefined : safe.details
            }
        };
    }
    return {
        status: 500,
        body: {
            success: false,
            error: 'Internal Checkbox readiness error',
            code: 'checkbox_readiness_internal_error'
        }
    };
}

module.exports = {
    PaymentReadinessError,
    assertFreshPaymentReadiness,
    assertPaymentReadiness,
    buildFiscalConfigurationSnapshot,
    loadOperationalHealth,
    loadCheckboxSalesReport,
    loadReadinessState,
    listOperationalIncidents,
    listUnresolvedPaymentOrders,
    normalizeUnresolvedPagination,
    loadPaymentOrderTaxContext,
    paymentTaxContext,
    probeCheckboxReadiness,
    readinessErrorResponse,
    applyPaymentAcceptanceGate,
    finalizeFreshReadiness,
    canProbeProviderReadiness,
    resolveUnreportedPaymentPermissionPolicy,
    resolveProviderShiftReadiness,
    freshShiftContextMatches,
    sanitizePersistedReadinessDetails,
    requestPhase1ShiftClose,
    runCheckboxReadinessProbeScheduler,
    updateOperationalIncidentStatus
};
