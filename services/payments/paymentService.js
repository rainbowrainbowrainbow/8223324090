'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const {
    AdmissionTicketError,
    resolveAdmissionTicketQuote
} = require('../admissionTickets');
const { normalizeKnownBusinessContext } = require('../businessContext');
const { authorizeFiscalAction, FiscalAccessError } = require('./fiscalAccess');
const { toPostgresBigint } = require('./money');
const { ensureOpenShiftForSale } = require('./cashierOperationsService');
const {
    PaymentWorkflowError,
    assertManualConfirmationBody,
    normalizeTender
} = require('./paymentStateMachine');
const { requestPaymentOutboxWakeup } = require('./paymentOutboxWakeup');
const {
    PaymentReadinessError,
    assertFreshPaymentReadiness,
    assertPaymentReadiness
} = require('./paymentReadinessService');
const {
    isCheckboxIntegrationEnabled,
    isCheckboxPaymentAcceptanceEnabled,
    loadCheckboxRuntimeConfig
} = require('../checkbox/config');

const PILOT_CRM_PROFILE_KEY = 'event_genix';
const PILOT_LOCATION_ALIAS = 'park';
const PILOT_REGISTER_ALIAS = 'middle';
const ORDER_SOURCE_TYPE = 'admission_ticket';
const OUTBOX_JOB_TYPE = 'receipt_sell';
const WALK_IN_SOURCE_PREFIX = 'walkin_sale';

function normalizeRequiredFiscalScopeValue(value, code, label) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) {
        throw new PaymentServiceError(code, `${label} is required`, { status: 422 });
    }
    if (!/^[a-z0-9_:-]+$/.test(text)) {
        throw new PaymentServiceError(`${code}_invalid`, `${label} is invalid`, { status: 422 });
    }
    return text;
}

function normalizeRequiredPaymentScope(body = {}) {
    const rawCrmProfileKey = body.crmProfileKey ?? body.crm_profile_key;
    const crmProfileInput = normalizeRequiredFiscalScopeValue(rawCrmProfileKey, 'fiscal_crm_profile_required', 'CRM fiscal profile');
    const crmProfileKey = normalizeKnownBusinessContext(crmProfileInput);
    if (!crmProfileKey) {
        throw new PaymentServiceError('fiscal_crm_profile_invalid', 'CRM fiscal profile is unknown', {
            status: 422,
            details: { crmProfileKey: crmProfileInput }
        });
    }
    return {
        crmProfileKey,
        locationAlias: normalizeRequiredFiscalScopeValue(
            body.locationAlias ?? body.location_alias,
            'fiscal_location_alias_required',
            'Fiscal location alias'
        ),
        registerAlias: normalizeRequiredFiscalScopeValue(
            body.registerAlias ?? body.register_alias,
            'fiscal_register_alias_required',
            'Fiscal register alias'
        )
    };
}

class PaymentServiceError extends Error {
    constructor(code, message, { status = 400, details = null } = {}) {
        super(message || code);
        this.name = 'PaymentServiceError';
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
        throw new PaymentServiceError(
            'fiscal_provider_context_incomplete',
            'Checkbox provider configuration is incomplete',
            { status: 409, details: { missing } }
        );
    }
    return { registerCredentialRef, cashierCredentialRef };
}

function paymentAdvisoryScope(key) {
    return `eventgenix:payments:${String(key || '').trim()}`;
}

async function lockPaymentIdempotency(client, key) {
    await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        ['payment_idempotency', paymentAdvisoryScope(key)]
    );
}

function buildFiscalConfigurationSnapshot({ mapping = {}, binding = {}, runtimeConfig = {} } = {}) {
    const { registerCredentialRef, cashierCredentialRef } = assertCompleteFiscalCredentialRefs(mapping, binding);
    const snapshot = {
        provider: 'checkbox',
        provider_organization_id: mapping.provider_organization_id || null,
        provider_outlet_id: mapping.provider_outlet_id || null,
        provider_register_id: mapping.provider_register_id || null,
        provider_cashier_id: binding.provider_cashier_id || null,
        register_credential_ref: registerCredentialRef,
        cashier_credential_ref: cashierCredentialRef,
        expected_is_test: normalizeBoolean(runtimeConfig.expectedIsTest ?? mapping.register_expected_is_test),
        fiscal_profile_id: mapping.fiscal_profile_id == null ? null : Number(mapping.fiscal_profile_id),
        fiscal_location_id: mapping.fiscal_location_id == null ? null : Number(mapping.fiscal_location_id),
        fiscal_register_id: mapping.fiscal_register_id == null ? null : Number(mapping.fiscal_register_id),
        crm_profile_key: mapping.crm_profile_key || null,
        legal_entity_key: mapping.legal_entity_key || null,
        location_alias: mapping.location_alias || null,
        register_alias: mapping.register_alias || null
    };
    return {
        snapshot,
        hash: fingerprint(snapshot)
    };
}

function requireIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!key) {
        throw new PaymentServiceError('idempotency_key_required', 'Idempotency-Key header is required', { status: 400 });
    }
    if (key.length > 160) {
        throw new PaymentServiceError('idempotency_key_too_long', 'Idempotency-Key is too long', { status: 422 });
    }
    return key;
}

function assertNoClientFiscalOverride(body = {}) {
    for (const field of [
        'fiscalProfileId',
        'fiscal_profile_id',
        'fiscalRegisterId',
        'fiscal_register_id',
        'legalEntityKey',
        'legal_entity_key',
        'fop',
        'price',
        'amount',
        'totalAmountMinor',
        'total_amount_minor',
        'sourceId',
        'source_id'
    ]) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            throw new PaymentServiceError('client_payment_field_forbidden', 'Client cannot override price, fiscal profile, FOP, or register mapping', {
                status: 422,
                details: { field }
            });
        }
    }
}

function uahWholeToMinor(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new PaymentServiceError('admission_ticket_amount_invalid', 'Admission ticket amount must be a whole UAH integer', {
            status: 422,
            details: { field }
        });
    }
    return BigInt(value) * 100n;
}

function quantityToMillis(value, field) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new PaymentServiceError('admission_ticket_quantity_invalid', 'Admission ticket quantity must be a positive integer', {
            status: 422,
            details: { field }
        });
    }
    return BigInt(value) * 1000n;
}

function normalizePaymentOrder(row = {}) {
    if (!row) return null;
    return {
        id: Number(row.id),
        fiscalProfileId: Number(row.fiscal_profile_id),
        fiscalLocationId: row.fiscal_location_id == null ? null : Number(row.fiscal_location_id),
        fiscalRegisterId: Number(row.fiscal_register_id),
        crmProfileKey: row.crm_profile_key || row.source_snapshot?.crm_profile_key || null,
        locationAlias: row.location_alias || row.source_snapshot?.location_alias || null,
        registerAlias: row.register_alias || row.source_snapshot?.register_alias || null,
        sourceType: row.source_type,
        sourceId: row.source_id,
        orderKey: row.order_key,
        status: row.status,
        paymentStatus: row.payment_status,
        fiscalStatus: row.fiscal_status,
        paymentMethod: row.payment_method,
        totalAmountMinor: String(row.total_amount_minor),
        currency: row.currency,
        confirmedAt: row.confirmed_at || null,
        sourceSnapshot: row.source_snapshot || {},
        confirmationSnapshot: row.confirmation_snapshot || {}
    };
}

function sanitizeCardReference(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.replace(/[^\p{L}\p{N}\s._:\/#-]/gu, '').replace(/\s+/g, ' ').slice(0, 160) || null;
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

async function loadPilotFiscalMapping(client, {
    crmProfileKey,
    locationAlias,
    registerAlias
} = {}) {
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
             fr.feature_enabled,
             fr.status AS fiscal_register_status
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
            AND fr.feature_enabled = TRUE
          WHERE fp.crm_profile_key = $1
            AND fp.status = 'active'`,
        [crmProfileKey, locationAlias, registerAlias]
    );
    if (result.rows.length !== 1) {
        throw new PaymentServiceError('fiscal_mapping_ambiguous_or_missing', 'Fiscal profile/register mapping is missing or ambiguous', {
            status: 409,
            details: { crmProfileKey, locationAlias, registerAlias, matches: result.rows.length }
        });
    }
    return result.rows[0];
}

async function findOrderByIdempotency(client, idempotencyKey) {
    const result = await client.query(
        `SELECT *
           FROM payment_orders
          WHERE idempotency_key = $1
          LIMIT 1`,
        [idempotencyKey]
    );
    return result.rows[0] || null;
}

async function assertCheckboxIntegrationReady(client, {
    env = process.env,
    user,
    fiscalProfileId,
    fiscalRegisterId,
    registerStatus,
    registerFeatureEnabled,
    provider,
    providerLicenseRef
} = {}) {
    if (!isCheckboxIntegrationEnabled(env)) {
        throw new PaymentServiceError('checkbox_integration_disabled', 'Checkbox integration is disabled', { status: 503 });
    }
    if (String(provider || '').trim() !== 'checkbox') {
        throw new PaymentServiceError('checkbox_provider_not_supported', 'Fiscal register is not configured for Checkbox', { status: 409 });
    }
    if (String(registerStatus || '').trim() !== 'active' || registerFeatureEnabled !== true) {
        throw new PaymentServiceError('checkbox_register_disabled', 'Checkbox register is not enabled for payment confirmation', { status: 409 });
    }
    const binding = await client.query(
        `SELECT provider_cashier_id, provider_cashier_login_ref
           FROM fiscal_cashier_bindings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND user_id = $3
            AND status = 'active'
          LIMIT 2`,
        [fiscalProfileId, fiscalRegisterId, user?.id || null]
    );
    if (binding.rows.length !== 1) {
        throw new PaymentServiceError('fiscal_binding_ambiguous_or_missing', 'Exact fiscal cashier binding is required before Checkbox payment', {
            status: 403,
            details: { matches: binding.rows.length }
        });
    }
    const credentialRefs = assertCompleteFiscalCredentialRefs(
        { provider_license_ref: providerLicenseRef },
        binding.rows[0]
    );
    try {
        const runtimeConfig = loadCheckboxRuntimeConfig({
            env,
            credentialRef: credentialRefs.cashierCredentialRef,
            licenseRef: credentialRefs.registerCredentialRef
        });
        return {
            binding: binding.rows[0],
            runtimeConfig
        };
    } catch (error) {
        throw new PaymentServiceError(error.code || 'checkbox_runtime_config_unavailable', 'Checkbox runtime configuration is not resolvable', {
            status: 503,
            details: error.details || undefined
        });
    }
}

function publicFiscalQueueStatus(row = {}) {
    const fiscalStatus = String(row.fiscal_status || row.fiscalStatus || '').trim().toLowerCase();
    const outboxStatus = String(row.outbox_status || row.outboxStatus || '').trim().toLowerCase();
    const attempts = Number(row.attempts == null ? 0 : row.attempts);
    const maxAttempts = Number(row.max_attempts == null ? row.maxAttempts == null ? 0 : row.maxAttempts : row.max_attempts);
    if (outboxStatus === 'dead') return 'dead';
    if (outboxStatus === 'failed') return maxAttempts > 0 && attempts >= maxAttempts ? 'failed_terminal' : 'failed_retryable';
    if (outboxStatus === 'queued' && fiscalStatus === 'failed') return 'failed_retryable';
    if (['blocked', 'validation_failed'].includes(fiscalStatus)) return 'failed_terminal';
    return fiscalStatus || 'unknown';
}

function normalizePaymentOutboxJob(row = {}) {
    if (!row) return null;
    return {
        id: Number(row.id),
        jobType: row.job_type,
        status: row.status,
        externalStage: row.external_stage || null,
        attempts: row.attempts == null ? null : Number(row.attempts),
        maxAttempts: row.max_attempts == null ? null : Number(row.max_attempts),
        nextRunAt: row.next_run_at || null,
        lastErrorCode: row.last_error_code || null
    };
}

async function authorizeOrderReplay(client, {
    user,
    order,
    action,
    authorizer,
    expectedFiscalProfileId = null,
    expectedFiscalRegisterId = null,
    requestFingerprint = null
} = {}) {
    if (!order) {
        throw new PaymentServiceError('payment_order_not_found', 'Payment order not found', { status: 404 });
    }
    await authorizer(client, {
        user,
        action,
        fiscalProfileId: order.fiscal_profile_id,
        crmProfileKey: order.crm_profile_key,
        fiscalLocationId: order.fiscal_location_id,
        fiscalRegisterId: order.fiscal_register_id
    });
    if (Number(order.cashier_user_id || 0) !== Number(user?.id || 0)) {
        throw new PaymentServiceError('idempotency_key_scope_conflict', 'Idempotency key belongs to another payment scope', { status: 409 });
    }
    if (expectedFiscalProfileId && Number(order.fiscal_profile_id) !== Number(expectedFiscalProfileId)) {
        throw new PaymentServiceError('idempotency_key_scope_conflict', 'Idempotency key belongs to another fiscal profile', { status: 409 });
    }
    if (expectedFiscalRegisterId && Number(order.fiscal_register_id) !== Number(expectedFiscalRegisterId)) {
        throw new PaymentServiceError('idempotency_key_scope_conflict', 'Idempotency key belongs to another fiscal register', { status: 409 });
    }
    if (requestFingerprint && order.source_snapshot?.request_fingerprint !== requestFingerprint) {
        throw new PaymentServiceError('idempotency_key_conflict', 'Same idempotency key was used with a different payment order body', { status: 409 });
    }
    return true;
}

async function loadFiscalItemMappings(client, { fiscalProfileId, fiscalRegisterId, crmProfileKey, lines }) {
    const codes = [...new Set((lines || []).map(line => String(line.ticketTypeCode || '').trim()).filter(Boolean))];
    if (!codes.length) {
        throw new PaymentServiceError('fiscal_item_mapping_missing', 'Admission ticket fiscal item mapping is missing', { status: 409 });
    }
    const result = await client.query(
        `SELECT *
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND crm_profile_key = $3
            AND source_type = $4
            AND item_type = 'admission_ticket'
            AND item_code = ANY($5::text[])
            AND provider = 'checkbox'
            AND status = 'active'`,
        [fiscalProfileId, fiscalRegisterId, crmProfileKey, ORDER_SOURCE_TYPE, codes]
    );
    const byCode = new Map();
    for (const row of result.rows) {
        const code = String(row.item_code || '').trim();
        if (byCode.has(code)) {
            throw new PaymentServiceError('fiscal_item_mapping_ambiguous', 'Admission ticket fiscal item mapping is ambiguous', {
                status: 409,
                details: { itemCode: code }
            });
        }
        const fiscalItemName = String(row.fiscal_item_name || '').trim();
        const providerTaxId = String(row.provider_tax_id || '').trim();
        const taxMode = String(row.tax_mode || 'taxed').trim();
        const invalidTax = taxMode === 'taxed'
            ? (!providerTaxId || /^admission_tariff:/i.test(providerTaxId))
            : Boolean(providerTaxId);
        if (!fiscalItemName || !['taxed', 'untaxed'].includes(taxMode) || invalidTax) {
            throw new PaymentServiceError('fiscal_item_tax_mapping_missing', 'Admission ticket fiscal tax mapping is incomplete', {
                status: 409,
                details: { itemCode: code }
            });
        }
        byCode.set(code, row);
    }
    const missing = codes.filter(code => !byCode.has(code));
    if (missing.length) {
        throw new PaymentServiceError('fiscal_item_mapping_missing', 'Admission ticket fiscal item mapping is missing', {
            status: 409,
            details: { itemCodes: missing }
        });
    }
    return byCode;
}

async function assertOrderItemsFiscalReady(client, { fiscalProfileId, paymentOrderId }) {
    const result = await client.query(
        `SELECT line_number, item_code, item_name, tax_reference, provider_tax_id, COALESCE(tax_mode, 'taxed') AS tax_mode
           FROM payment_order_items
          WHERE fiscal_profile_id = $1
            AND payment_order_id = $2
          ORDER BY line_number ASC`,
        [fiscalProfileId, paymentOrderId]
    );
    if (!result.rows.length) {
        throw new PaymentServiceError('payment_order_items_missing', 'Payment order has no immutable items', { status: 409 });
    }
    const invalid = result.rows.filter(row => {
        const providerTaxId = String(row.provider_tax_id || '').trim();
        const taxMode = String(row.tax_mode || 'taxed').trim();
        return taxMode === 'taxed'
            ? (!providerTaxId || /^admission_tariff:/i.test(providerTaxId))
            : Boolean(providerTaxId);
    });
    if (invalid.length) {
        throw new PaymentServiceError('payment_order_fiscal_item_not_ready', 'Payment order fiscal item/tax mapping is incomplete', {
            status: 409,
            details: { lines: invalid.map(row => Number(row.line_number)) }
        });
    }
    return result.rows;
}

async function loadOrderSnapshot(client, orderId) {
    const result = await client.query(
        `SELECT po.*,
                fp.crm_profile_key,
                fp.legal_entity_key,
                fp.legal_entity_name,
                fp.provider_organization_id,
                fl.id AS fiscal_location_id,
                fl.location_alias,
                fl.provider_outlet_id,
                fr.register_alias,
                fr.display_name AS register_display_name,
                fr.provider,
                fr.status AS fiscal_register_status,
                fr.feature_enabled,
                fr.provider_license_ref,
                fr.provider_register_id
           FROM payment_orders po
           JOIN fiscal_profiles fp ON fp.id = po.fiscal_profile_id
           JOIN fiscal_registers fr
             ON fr.id = po.fiscal_register_id
            AND fr.fiscal_profile_id = po.fiscal_profile_id
           JOIN fiscal_locations fl
             ON fl.id = fr.fiscal_location_id
            AND fl.fiscal_profile_id = po.fiscal_profile_id
          WHERE po.id = $1
          LIMIT 1`,
        [orderId]
    );
    return result.rows[0] || null;
}

async function findAttemptByIdempotency(client, idempotencyKey) {
    const result = await client.query(
        `SELECT *
           FROM payment_attempts
          WHERE idempotency_key = $1
          LIMIT 1`,
        [idempotencyKey]
    );
    return result.rows[0] || null;
}

async function createAdmissionTicketPaymentOrder({
    dbPool = pool,
    user,
    body = {},
    idempotencyKey,
    quoteResolver = resolveAdmissionTicketQuote,
    authorizer = authorizeFiscalAction,
    requireCheckboxIntegrationReady = false,
    now = new Date()
} = {}) {
    const key = requireIdempotencyKey(idempotencyKey);
    assertNoClientFiscalOverride(body);
    if (requireCheckboxIntegrationReady && !isCheckboxIntegrationEnabled(process.env)) {
        throw new PaymentServiceError('checkbox_integration_disabled', 'Checkbox integration is disabled', { status: 503 });
    }
    if (requireCheckboxIntegrationReady && !isCheckboxPaymentAcceptanceEnabled(process.env)) {
        throw new PaymentServiceError('checkbox_payment_acceptance_disabled', 'Checkbox payment acceptance is disabled while fiscal recovery may continue', { status: 503 });
    }

    const fiscalScope = normalizeRequiredPaymentScope(body);
    const { crmProfileKey, locationAlias, registerAlias } = fiscalScope;
    const { tender, paymentMethod } = normalizeTender(body.tender || body.paymentMethod || body.payment_method);
    const admissionTicketInput = body.admissionTicket || body.admission_ticket || {};
    const requestFingerprint = fingerprint({
        endpoint: 'create_admission_ticket_payment_order',
        crmProfileKey,
        locationAlias,
        registerAlias,
        tender,
        admissionTicketInput
    });

    return withTransaction(dbPool, async client => {
        await lockPaymentIdempotency(client, key);
        const mapping = await loadPilotFiscalMapping(client, fiscalScope);
        await authorizer(client, {
            user,
            action: 'payments.create',
            fiscalProfileId: mapping.fiscal_profile_id,
            crmProfileKey: mapping.crm_profile_key,
            fiscalLocationId: mapping.fiscal_location_id,
            fiscalRegisterId: mapping.fiscal_register_id
        });
        if (requireCheckboxIntegrationReady) {
            await assertCheckboxIntegrationReady(client, {
                user,
                fiscalProfileId: mapping.fiscal_profile_id,
                fiscalLocationId: mapping.fiscal_location_id,
                fiscalRegisterId: mapping.fiscal_register_id,
                registerStatus: mapping.fiscal_register_status,
                registerFeatureEnabled: Boolean(mapping.feature_enabled),
                provider: mapping.provider,
                providerLicenseRef: mapping.provider_license_ref
            });
            await assertPaymentReadiness({
                client,
                user,
                fiscalProfileId: mapping.fiscal_profile_id,
                fiscalRegisterId: mapping.fiscal_register_id,
                crmProfileKey: mapping.crm_profile_key,
                locationAlias: mapping.location_alias,
                registerAlias: mapping.register_alias,
                action: 'payments.create',
                tender
            });
        }

        const existing = await findOrderByIdempotency(client, key);
        if (existing) {
            const existingOrder = await loadOrderSnapshot(client, existing.id);
            await authorizeOrderReplay(client, {
                user,
                order: existingOrder,
                action: 'payments.create',
                authorizer,
                expectedFiscalProfileId: mapping.fiscal_profile_id,
                expectedFiscalRegisterId: mapping.fiscal_register_id,
                requestFingerprint
            });
            return { replayed: true, order: normalizePaymentOrder(existingOrder) };
        }

        const quote = await quoteResolver({
            queryable: client,
            businessContext: mapping.crm_profile_key,
            input: admissionTicketInput,
            now,
            lockTariffTypes: true
        });
        if (!quote || quote.legacy || quote.requiresExplicitConversion || !Array.isArray(quote.ticketLines) || quote.ticketLines.length === 0) {
            throw new PaymentServiceError('admission_snapshot_invalid', 'Admission ticket snapshot is not valid for payment', { status: 409 });
        }

        const totalAmountMinor = uahWholeToMinor(quote.ticketSubtotal, 'ticketSubtotal');
        if (totalAmountMinor <= 0n) {
            throw new PaymentServiceError('admission_snapshot_empty', 'Admission ticket payment amount must be greater than zero', { status: 422 });
        }

        const mappingByItemCode = await loadFiscalItemMappings(client, {
            fiscalProfileId: mapping.fiscal_profile_id,
            fiscalRegisterId: mapping.fiscal_register_id,
            crmProfileKey: mapping.crm_profile_key,
            lines: quote.ticketLines
        });
        const saleUuid = crypto.randomUUID();
        const sourceId = `${WALK_IN_SOURCE_PREFIX}_${saleUuid}`;
        const quoteFingerprint = String(quote.quoteFingerprint || fingerprint({ crmProfileKey, quote })).trim();
        const orderKey = `${ORDER_SOURCE_TYPE}:${mapping.crm_profile_key}:${mapping.location_alias}:${mapping.register_alias}:${sourceId}`;
        const sourceSnapshot = {
            source: ORDER_SOURCE_TYPE,
            source_mode: 'standalone_walk_in',
            sale_uuid: saleUuid,
            request_fingerprint: requestFingerprint,
            quote_fingerprint: quoteFingerprint,
            logical_source_key: orderKey,
            quote,
            crm_profile_key: mapping.crm_profile_key,
            location_alias: mapping.location_alias,
            register_alias: mapping.register_alias,
            fiscal_location_id: Number(mapping.fiscal_location_id),
            legal_entity_key: mapping.legal_entity_key,
            legal_entity_name: mapping.legal_entity_name,
            tender
        };

        const inserted = await client.query(
            `INSERT INTO payment_orders (
                 fiscal_profile_id, fiscal_register_id, cashier_user_id, source_type, source_id,
                 order_key, idempotency_key, status, payment_status, fiscal_status,
                 payment_method, total_amount_minor, currency, source_snapshot, created_by_user_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'unpaid', 'pending', $8, $9, 'UAH', $10::jsonb, $11)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                mapping.fiscal_profile_id,
                mapping.fiscal_register_id,
                user?.id || null,
                ORDER_SOURCE_TYPE,
                sourceId,
                orderKey,
                key,
                paymentMethod,
                toPostgresBigint(totalAmountMinor, { allowZero: false }),
                JSON.stringify(sourceSnapshot),
                user?.id || null
            ]
        );
        if (!inserted.rows.length) {
            const conflict = await findOrderByIdempotency(client, key);
            const existingOrder = conflict ? await loadOrderSnapshot(client, conflict.id) : null;
            await authorizeOrderReplay(client, {
                user,
                order: existingOrder,
                action: 'payments.create',
                authorizer,
                expectedFiscalProfileId: mapping.fiscal_profile_id,
                expectedFiscalRegisterId: mapping.fiscal_register_id,
                requestFingerprint
            });
            return { replayed: true, order: normalizePaymentOrder(existingOrder) };
        }
        const order = inserted.rows[0];

        let lineNumber = 0;
        for (const line of quote.ticketLines) {
            lineNumber += 1;
            const itemMapping = mappingByItemCode.get(String(line.ticketTypeCode || '').trim());
            const unitPriceMinor = uahWholeToMinor(line.unitPriceUah, `ticketLines[${lineNumber}].unitPriceUah`);
            const totalLineMinor = uahWholeToMinor(line.subtotalUah, `ticketLines[${lineNumber}].subtotalUah`);
            const quantityMillis = quantityToMillis(line.quantity, `ticketLines[${lineNumber}].quantity`);
            await client.query(
                `INSERT INTO payment_order_items (
                     fiscal_profile_id, payment_order_id, line_number, item_type, item_code, item_name,
                     unit_price_minor, quantity_millis, total_amount_minor, currency, tax_reference,
                     tax_code, tax_rate_bps, provider_tax_id, tax_mode, item_snapshot
                 )
                 VALUES ($1, $2, $3, 'admission_ticket', $4, $5, $6, $7, $8, 'UAH', $9, $10, $11, $12, $13, $14::jsonb)`,
                [
                    order.fiscal_profile_id,
                    order.id,
                    lineNumber,
                    line.ticketTypeCode,
                    itemMapping.fiscal_item_name,
                    toPostgresBigint(unitPriceMinor),
                    toPostgresBigint(quantityMillis),
                    toPostgresBigint(totalLineMinor),
                    line.tariffVersionId ? `admission_tariff:${line.tariffVersionId}` : null,
                    itemMapping.tax_code == null ? null : Number(itemMapping.tax_code),
                    itemMapping.tax_rate_bps == null ? null : Number(itemMapping.tax_rate_bps),
                    itemMapping.provider_tax_id || null,
                    itemMapping.tax_mode || 'taxed',
                    JSON.stringify({ ...line, fiscal_item_mapping_id: Number(itemMapping.id), fiscal_tax_mode: itemMapping.tax_mode || 'taxed', original_ticket_type_name: line.ticketTypeName })
                ]
            );
        }

        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                 idempotency_key, after_snapshot
             )
             VALUES ($1, $2, 'payment_order_created', 'payment_orders', $3, $4, $5::jsonb)`,
            [order.fiscal_profile_id, user?.id || null, order.id, key, JSON.stringify({ status: order.status, total_amount_minor: String(order.total_amount_minor) })]
        );

        return { replayed: false, order: normalizePaymentOrder(order) };
    });
}

async function confirmPaymentOrder({
    dbPool = pool,
    user,
    orderId,
    body = {},
    idempotencyKey,
    authorizer = authorizeFiscalAction,
    requireCheckboxIntegrationReady = false,
    env = process.env,
    checkboxFetchImpl
} = {}) {
    const key = requireIdempotencyKey(idempotencyKey);
    assertNoClientFiscalOverride(body);

    const numericOrderId = Number(orderId);
    if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
        throw new PaymentServiceError('payment_order_id_invalid', 'Payment order id is invalid', { status: 422 });
    }
    const requestFingerprint = fingerprint({
        endpoint: 'confirm_payment_order',
        orderId: numericOrderId,
        tender: body.tender || body.paymentMethod || body.payment_method,
        confirmedAmountMinor: String(body.confirmedAmountMinor ?? body.confirmed_amount_minor ?? ''),
        terminalShowedSuccess: Boolean(body.terminalShowedSuccess ?? body.terminal_showed_success),
        terminalReference: sanitizeCardReference(body.terminalReference ?? body.terminal_reference)
    });

    const preflight = await withTransaction(dbPool, async client => {
        const existingAttempt = await findAttemptByIdempotency(client, key);
        if (existingAttempt) {
            const existingOrder = await loadOrderSnapshot(client, existingAttempt.payment_order_id);
            await authorizeOrderReplay(client, {
                user,
                order: existingOrder,
                action: 'payments.confirm_received',
                authorizer
            });
            if (existingAttempt.request_snapshot?.fingerprint !== requestFingerprint) {
                throw new PaymentServiceError('idempotency_key_conflict', 'Same idempotency key was used with a different confirmation body', { status: 409 });
            }
            return {
                replayed: true,
                order: normalizePaymentOrder(existingOrder),
                attemptId: Number(existingAttempt.id)
            };
        }
        if (!requireCheckboxIntegrationReady) return { replayed: false, order: null };
        if (!isCheckboxIntegrationEnabled(env)) {
            throw new PaymentServiceError('checkbox_integration_disabled', 'Checkbox integration is disabled', { status: 503 });
        }
        if (!isCheckboxPaymentAcceptanceEnabled(env)) {
            throw new PaymentServiceError('checkbox_payment_acceptance_disabled', 'Checkbox payment acceptance is disabled while fiscal recovery may continue', { status: 503 });
        }
        const order = await loadOrderSnapshot(client, numericOrderId);
        if (!order) {
            throw new PaymentServiceError('payment_order_not_found', 'Payment order not found', { status: 404 });
        }
        await authorizer(client, {
            user,
            action: 'payments.confirm_received',
            fiscalProfileId: order.fiscal_profile_id,
            crmProfileKey: order.crm_profile_key,
            fiscalLocationId: order.fiscal_location_id,
            fiscalRegisterId: order.fiscal_register_id
        });
        await assertCheckboxIntegrationReady(client, {
            env,
            user,
            fiscalProfileId: order.fiscal_profile_id,
            fiscalRegisterId: order.fiscal_register_id,
            registerStatus: order.fiscal_register_status,
            registerFeatureEnabled: Boolean(order.feature_enabled),
            provider: order.provider,
            providerLicenseRef: order.provider_license_ref
        });
        return { replayed: false, order };
    });
    if (preflight.replayed) return preflight;

    const immutableTender = preflight.order?.source_snapshot?.tender
        || (preflight.order?.payment_method === 'card_terminal' ? 'card_terminal_manual' : preflight.order?.payment_method);
    const freshProviderReadiness = requireCheckboxIntegrationReady
        ? await assertFreshPaymentReadiness({
            dbPool,
            user,
            fiscalProfileId: preflight.order.fiscal_profile_id,
            fiscalLocationId: preflight.order.fiscal_location_id,
            fiscalRegisterId: preflight.order.fiscal_register_id,
            paymentOrderId: numericOrderId,
            crmProfileKey: preflight.order.crm_profile_key,
            locationAlias: preflight.order.location_alias,
            registerAlias: preflight.order.register_alias,
            action: 'payments.confirm_received',
            tender: immutableTender,
            env,
            fetchImpl: checkboxFetchImpl
        })
        : null;

    const result = await withTransaction(dbPool, async client => {
        await lockPaymentIdempotency(client, key);
        const existingAttempt = await findAttemptByIdempotency(client, key);
        if (existingAttempt) {
            const existingOrder = await loadOrderSnapshot(client, existingAttempt.payment_order_id);
            await authorizeOrderReplay(client, {
                user,
                order: existingOrder,
                action: 'payments.confirm_received',
                authorizer
            });
            if (existingAttempt.request_snapshot?.fingerprint !== requestFingerprint) {
                throw new PaymentServiceError('idempotency_key_conflict', 'Same idempotency key was used with a different confirmation body', { status: 409 });
            }
            return {
                replayed: true,
                order: normalizePaymentOrder(existingOrder),
                attemptId: Number(existingAttempt.id)
            };
        }

        if (requireCheckboxIntegrationReady && !isCheckboxIntegrationEnabled(env)) {
            throw new PaymentServiceError('checkbox_integration_disabled', 'Checkbox integration is disabled', { status: 503 });
        }
        if (requireCheckboxIntegrationReady && !isCheckboxPaymentAcceptanceEnabled(env)) {
            throw new PaymentServiceError('checkbox_payment_acceptance_disabled', 'Checkbox payment acceptance is disabled while fiscal recovery may continue', { status: 503 });
        }

        // Resolve and authorize the immutable register scope without a row lock first,
        // then serialize every confirmation against Phase-1 shift close before taking
        // the payment-order row lock or writing any payment/fiscal ledger rows.
        const scopedOrder = await loadOrderSnapshot(client, numericOrderId);
        if (!scopedOrder) {
            throw new PaymentServiceError('payment_order_not_found', 'Payment order not found', { status: 404 });
        }
        await authorizer(client, {
            user,
            action: 'payments.confirm_received',
            fiscalProfileId: scopedOrder.fiscal_profile_id,
            crmProfileKey: scopedOrder.crm_profile_key,
            fiscalLocationId: scopedOrder.fiscal_location_id,
            fiscalRegisterId: scopedOrder.fiscal_register_id
        });
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
            scopedOrder.fiscal_profile_id,
            scopedOrder.fiscal_register_id
        ]);
        if (requireCheckboxIntegrationReady && !isCheckboxIntegrationEnabled(env)) {
            throw new PaymentServiceError('checkbox_integration_disabled', 'Checkbox integration is disabled', { status: 503 });
        }
        if (requireCheckboxIntegrationReady && !isCheckboxPaymentAcceptanceEnabled(env)) {
            throw new PaymentServiceError('checkbox_payment_acceptance_disabled', 'Checkbox payment acceptance is disabled while fiscal recovery may continue', { status: 503 });
        }

        const lockResult = await client.query(
            `SELECT po.*,
                    fp.crm_profile_key,
                    fp.legal_entity_key,
                    fp.legal_entity_name,
                    fp.provider_organization_id,
                    fl.id AS fiscal_location_id,
                    fl.location_alias,
                    fl.provider_outlet_id,
                    fr.register_alias,
                    fr.display_name AS register_display_name,
                    fr.provider,
                    fr.status AS fiscal_register_status,
                    fr.feature_enabled,
                    fr.provider_license_ref,
                    fr.provider_register_id,
                    fr.metadata->>'expected_is_test' AS register_expected_is_test,
                    confirmed_binding.provider_cashier_id AS bound_provider_cashier_id,
                    confirmed_binding.provider_cashier_login_ref AS bound_provider_cashier_login_ref
               FROM payment_orders po
               JOIN fiscal_profiles fp ON fp.id = po.fiscal_profile_id
               JOIN fiscal_registers fr
                 ON fr.id = po.fiscal_register_id
                AND fr.fiscal_profile_id = po.fiscal_profile_id
               JOIN fiscal_locations fl
                 ON fl.id = fr.fiscal_location_id
                AND fl.fiscal_profile_id = po.fiscal_profile_id
               JOIN fiscal_cashier_bindings confirmed_binding
                 ON confirmed_binding.fiscal_profile_id = po.fiscal_profile_id
                AND confirmed_binding.fiscal_location_id = fl.id
                AND confirmed_binding.fiscal_register_id = fr.id
                AND confirmed_binding.user_id = $2
                AND confirmed_binding.status = 'active'
              WHERE po.id = $1
              FOR UPDATE OF po`,
            [numericOrderId, user?.id || null]
        );
        if (!lockResult.rows.length) {
            throw new PaymentServiceError('payment_order_not_found', 'Payment order not found', { status: 404 });
        }
        const order = lockResult.rows[0];
        if (Number(order.fiscal_profile_id) !== Number(scopedOrder.fiscal_profile_id)
            || Number(order.fiscal_register_id) !== Number(scopedOrder.fiscal_register_id)) {
            throw new PaymentServiceError('payment_order_scope_changed', 'Payment order fiscal scope changed while acquiring the register lock', { status: 409 });
        }

        await authorizer(client, {
            user,
            action: 'payments.confirm_received',
            fiscalProfileId: order.fiscal_profile_id,
            crmProfileKey: order.crm_profile_key,
            fiscalLocationId: order.fiscal_location_id,
            fiscalRegisterId: order.fiscal_register_id
        });
        let fiscalConfig;
        if (requireCheckboxIntegrationReady) {
            const verifiedRuntime = await assertCheckboxIntegrationReady(client, {
                env,
                user,
                fiscalProfileId: order.fiscal_profile_id,
                fiscalRegisterId: order.fiscal_register_id,
                registerStatus: order.fiscal_register_status,
                registerFeatureEnabled: Boolean(order.feature_enabled),
                provider: order.provider,
                providerLicenseRef: order.provider_license_ref
            });
            fiscalConfig = buildFiscalConfigurationSnapshot({
                mapping: {
                    fiscal_profile_id: order.fiscal_profile_id,
                    fiscal_location_id: order.fiscal_location_id,
                    fiscal_register_id: order.fiscal_register_id,
                    crm_profile_key: order.crm_profile_key,
                    legal_entity_key: order.legal_entity_key,
                    provider_organization_id: order.provider_organization_id,
                    provider_outlet_id: order.provider_outlet_id,
                    provider_register_id: order.provider_register_id,
                    provider_license_ref: order.provider_license_ref,
                    register_expected_is_test: order.register_expected_is_test,
                    location_alias: order.location_alias,
                    register_alias: order.register_alias
                },
                binding: verifiedRuntime.binding,
                runtimeConfig: verifiedRuntime.runtimeConfig
            });
            await assertPaymentReadiness({
                client,
                user,
                fiscalProfileId: order.fiscal_profile_id,
                fiscalLocationId: order.fiscal_location_id,
                fiscalRegisterId: order.fiscal_register_id,
                paymentOrderId: order.id,
                crmProfileKey: order.crm_profile_key,
                locationAlias: order.location_alias,
                registerAlias: order.register_alias,
                action: 'payments.confirm_received',
                tender: immutableTender,
                freshProviderReadiness,
                expectedFiscalConfigurationHash: fiscalConfig.hash,
                env
            });
        } else {
            const fallbackBinding = {
                provider_cashier_id: order.bound_provider_cashier_id,
                provider_cashier_login_ref: order.bound_provider_cashier_login_ref
            };
            const fallbackExpectedIsTest = normalizeBoolean(order.register_expected_is_test);
            fiscalConfig = buildFiscalConfigurationSnapshot({
                mapping: {
                    fiscal_profile_id: order.fiscal_profile_id,
                    fiscal_location_id: order.fiscal_location_id,
                    fiscal_register_id: order.fiscal_register_id,
                    crm_profile_key: order.crm_profile_key,
                    legal_entity_key: order.legal_entity_key,
                    provider_organization_id: order.provider_organization_id,
                    provider_outlet_id: order.provider_outlet_id,
                    provider_register_id: order.provider_register_id,
                    provider_license_ref: order.provider_license_ref,
                    register_expected_is_test: order.register_expected_is_test,
                    location_alias: order.location_alias,
                    register_alias: order.register_alias
                },
                binding: fallbackBinding,
                runtimeConfig: { expectedIsTest: fallbackExpectedIsTest }
            });
        }

        const confirmation = assertManualConfirmationBody({ order, body });
        await assertOrderItemsFiscalReady(client, { fiscalProfileId: order.fiscal_profile_id, paymentOrderId: order.id });
        const terminalReference = sanitizeCardReference(body.terminalReference ?? body.terminal_reference);
        const confirmationSnapshot = {
            tender: confirmation.tender,
            amount_minor: confirmation.amountMinor.toString(),
            received_amount_minor: confirmation.receivedAmountMinor.toString(),
            change_amount_minor: confirmation.changeAmountMinor.toString(),
            terminal_reference: terminalReference,
            terminal_showed_success: confirmation.tender === 'card_terminal_manual' ? true : undefined,
            confirmed_by_user_id: user?.id || null,
            fiscal_configuration_hash: fiscalConfig.hash,
            provider_context: fiscalConfig.snapshot
        };

        const attempt = await client.query(
            `INSERT INTO payment_attempts (
                 fiscal_profile_id, payment_order_id, attempt_type, status, idempotency_key,
                 provider, provider_payment_reference, amount_minor, currency, request_snapshot,
                 result_snapshot, completed_at
             )
             VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7, 'UAH', $8::jsonb, $9::jsonb, NOW())
             RETURNING *`,
            [
                order.fiscal_profile_id,
                order.id,
                confirmation.tender === 'cash' ? 'cash_confirmation' : 'card_terminal_confirmation',
                key,
                confirmation.tender === 'cash' ? 'manual' : 'terminal',
                null,
                toPostgresBigint(confirmation.amountMinor, { allowZero: false }),
                JSON.stringify({ fingerprint: requestFingerprint, tender: confirmation.tender, terminal_reference: terminalReference }),
                JSON.stringify({
                    confirmed: true,
                    received_amount_minor: confirmation.receivedAmountMinor.toString(),
                    change_amount_minor: confirmation.changeAmountMinor.toString(),
                    terminal_reference: terminalReference
                })
            ]
        );

        await client.query(
            `INSERT INTO payment_allocations (
                 fiscal_profile_id, payment_order_id, payment_method, amount_minor, currency,
                 status, allocation_snapshot, recorded_by_user_id
             )
             VALUES ($1, $2, $3, $4, 'UAH', 'recorded', $5::jsonb, $6)`,
            [
                order.fiscal_profile_id,
                order.id,
                order.payment_method,
                toPostgresBigint(confirmation.amountMinor, { allowZero: false }),
                JSON.stringify({
                    attempt_id: Number(attempt.rows[0].id),
                    tender: confirmation.tender,
                    received_amount_minor: confirmation.receivedAmountMinor.toString(),
                    change_amount_minor: confirmation.changeAmountMinor.toString()
                }),
                user?.id || null
            ]
        );

        await client.query(
            `UPDATE payment_orders
                SET status = 'confirmed',
                    payment_status = 'confirmed',
                    confirmation_snapshot = $2::jsonb,
                    sealed_at = COALESCE(sealed_at, NOW()),
                    seal_fingerprint = $3,
                    received_amount_minor = $4,
                    change_amount_minor = $5,
                    terminal_reference = $6,
                    confirmed_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1`,
            [
                order.id,
                JSON.stringify(confirmationSnapshot),
                fiscalConfig.hash,
                toPostgresBigint(confirmation.receivedAmountMinor, { allowZero: false }),
                toPostgresBigint(confirmation.changeAmountMinor, { allowZero: true }),
                terminalReference
            ]
        );

        const recorded = await client.query(
            `UPDATE payment_orders
                SET status = 'payment_recorded',
                    payment_status = 'confirmed',
                    fiscal_status = 'pending',
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [order.id]
        );
        const recordedOrder = recorded.rows[0];

        const shift = await ensureOpenShiftForSale(client, { order, user, fiscalConfig });
        const providerRequestUuid = crypto.randomUUID();
        const fiscalOperation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, payment_order_id, fiscal_shift_id, operation_type, status,
                 idempotency_key, provider, provider_operation_id, amount_minor, currency,
                 request_fingerprint, request_snapshot, initiated_by_user_id,
                 provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
                 register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash,
                 fiscal_location_id, external_stage
             )
             VALUES ($1, $2, $3, $4, 'sale', 'pending', $5, 'checkbox', $6, $7, 'UAH', $8, $9::jsonb, $10,
                     $11, $12, $13, $14, $15, $16, $17, $18, $19, 'auth')
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                order.fiscal_profile_id,
                order.fiscal_register_id,
                order.id,
                shift.id,
                `fiscal_operation:sale:${order.id}`,
                providerRequestUuid,
                toPostgresBigint(confirmation.amountMinor, { allowZero: false }),
                requestFingerprint,
                JSON.stringify({
                    provider_request_uuid: providerRequestUuid,
                    payment_order_id: Number(order.id),
                    fiscal_shift_id: Number(shift.id),
                    source_type: order.source_type,
                    source_id: order.source_id,
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
        if (!fiscalOperation.rows.length) {
            throw new PaymentServiceError('sale_fiscal_operation_already_exists', 'Payment order already has a durable sale fiscal operation', { status: 409 });
        }

        const job = await client.query(
            `INSERT INTO payment_outbox_jobs (
                 fiscal_profile_id, fiscal_operation_id, payment_order_id, job_type,
                 status, idempotency_key, payload, external_stage
             )
             VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, 'auth')
             ON CONFLICT (idempotency_key) DO UPDATE
                 SET next_run_at = LEAST(payment_outbox_jobs.next_run_at, NOW()),
                     updated_at = NOW()
             RETURNING *`,
            [
                order.fiscal_profile_id,
                fiscalOperation.rows[0].id,
                order.id,
                OUTBOX_JOB_TYPE,
                `payment_outbox:receipt_sell:${order.id}`,
                JSON.stringify({
                    provider: 'checkbox',
                    provider_request_uuid: providerRequestUuid,
                    external_stage: 'auth',
                    action: 'lookup_before_retry_on_unknown'
                })
            ]
        );

        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                 idempotency_key, before_snapshot, after_snapshot
             )
             VALUES ($1, $2, 'payment_confirmed_outbox_queued', 'payment_orders', $3, $4, $5::jsonb, $6::jsonb)`,
            [
                order.fiscal_profile_id,
                user?.id || null,
                order.id,
                key,
                JSON.stringify({ status: order.status, payment_status: order.payment_status }),
                JSON.stringify({
                    status: recordedOrder.status,
                    payment_status: recordedOrder.payment_status,
                    fiscal_status: recordedOrder.fiscal_status,
                    fiscal_operation_id: Number(fiscalOperation.rows[0].id),
                    fiscal_shift_id: Number(shift.id),
                    outbox_job_id: Number(job.rows[0].id)
                })
            ]
        );

        return {
            replayed: false,
            order: normalizePaymentOrder(recordedOrder),
            attemptId: Number(attempt.rows[0].id),
            fiscalOperationId: Number(fiscalOperation.rows[0].id),
            outboxJobId: Number(job.rows[0].id),
            providerRequestUuid
        };
    });
    if (!result.replayed && result.outboxJobId) {
        requestPaymentOutboxWakeup({ reason: 'payment_confirmed' });
    }
    return result;
}

async function cancelDraftPaymentOrder({
    dbPool = pool,
    user,
    orderId,
    idempotencyKey,
    authorizer = authorizeFiscalAction
} = {}) {
    const key = requireIdempotencyKey(idempotencyKey);
    const numericOrderId = Number(orderId);
    if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
        throw new PaymentServiceError('payment_order_id_invalid', 'Payment order id is invalid', { status: 422 });
    }

    return withTransaction(dbPool, async client => {
        const lockResult = await client.query(
            `SELECT po.*,
                    fp.crm_profile_key,
                    fp.legal_entity_key,
                    fp.legal_entity_name,
                    fl.id AS fiscal_location_id,
                    fr.register_alias,
                    fr.display_name AS register_display_name,
                    fr.provider,
                    fr.status AS fiscal_register_status,
                    fr.feature_enabled,
                    fr.provider_license_ref,
                    fr.provider_register_id
               FROM payment_orders po
               JOIN fiscal_profiles fp ON fp.id = po.fiscal_profile_id
               JOIN fiscal_registers fr
                 ON fr.id = po.fiscal_register_id
                AND fr.fiscal_profile_id = po.fiscal_profile_id
               JOIN fiscal_locations fl
                 ON fl.id = fr.fiscal_location_id
                AND fl.fiscal_profile_id = po.fiscal_profile_id
              WHERE po.id = $1
              FOR UPDATE`,
            [numericOrderId]
        );
        if (!lockResult.rows.length) {
            throw new PaymentServiceError('payment_order_not_found', 'Payment order not found', { status: 404 });
        }
        const order = lockResult.rows[0];
        await authorizeOrderReplay(client, {
            user,
            order,
            action: 'payments.create',
            authorizer
        });

        if (order.status === 'cancelled' && order.payment_status === 'unpaid') {
            return { replayed: true, order: normalizePaymentOrder(order) };
        }
        if (order.status !== 'draft' || order.payment_status !== 'unpaid') {
            throw new PaymentServiceError('payment_order_cancel_denied', 'Only unpaid draft payment orders can be cancelled', {
                status: 409,
                details: {
                    status: order.status || null,
                    paymentStatus: order.payment_status || null,
                    fiscalStatus: order.fiscal_status || null
                }
            });
        }

        const updated = await client.query(
            `UPDATE payment_orders
                SET status = 'cancelled',
                    payment_status = 'unpaid',
                    fiscal_status = 'not_required',
                    cancelled_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
              RETURNING *`,
            [order.id, order.fiscal_profile_id]
        );

        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                 idempotency_key, before_snapshot, after_snapshot
             )
             VALUES ($1, $2, 'payment_order_cancelled', 'payment_orders', $3, $4, $5::jsonb, $6::jsonb)`,
            [
                order.fiscal_profile_id,
                user?.id || null,
                order.id,
                key,
                JSON.stringify({ status: order.status, payment_status: order.payment_status, fiscal_status: order.fiscal_status }),
                JSON.stringify({ status: 'cancelled', payment_status: 'unpaid', fiscal_status: 'not_required' })
            ]
        );

        return { replayed: false, order: normalizePaymentOrder(updated.rows[0]) };
    });
}


function normalizePaymentOrderDetails(row = {}) {
    const order = normalizePaymentOrder(row);
    if (!order) return null;
    return {
        ...order,
        crmProfileKey: row.crm_profile_key,
        legalEntityKey: row.legal_entity_key,
        legalEntityName: row.legal_entity_name,
        fiscalLocationId: Number(row.fiscal_location_id),
        locationAlias: row.location_alias,
        registerAlias: row.register_alias,
        registerDisplayName: row.register_display_name
    };
}

function normalizePaymentOrderItem(row = {}) {
    return {
        id: Number(row.id),
        lineNumber: Number(row.line_number),
        itemType: row.item_type,
        itemCode: row.item_code,
        itemName: row.item_name,
        unitPriceMinor: String(row.unit_price_minor),
        quantityMillis: String(row.quantity_millis),
        totalAmountMinor: String(row.total_amount_minor),
        currency: row.currency,
        taxReference: row.tax_reference || null,
        taxCode: row.tax_code == null ? null : Number(row.tax_code),
        taxRateBps: row.tax_rate_bps == null ? null : Number(row.tax_rate_bps),
        providerTaxId: row.provider_tax_id || null,
        itemSnapshot: row.item_snapshot || {}
    };
}

function normalizeFiscalOperation(row = {}) {
    if (!row) return null;
    return {
        id: Number(row.id),
        fiscalRegisterId: row.fiscal_register_id == null ? null : Number(row.fiscal_register_id),
        fiscalShiftId: row.fiscal_shift_id == null ? null : Number(row.fiscal_shift_id),
        paymentOrderId: row.payment_order_id == null ? null : Number(row.payment_order_id),
        operationType: row.operation_type,
        status: row.status,
        provider: row.provider,
        providerOperationId: row.provider_operation_id || null,
        providerStatus: row.provider_status || null,
        amountMinor: row.amount_minor == null ? null : String(row.amount_minor),
        currency: row.currency,
        lastErrorCode: row.last_error_code || null,
        lastErrorMessage: row.last_error_message || null,
        sentAt: row.sent_at || null,
        completedAt: row.completed_at || null,
        nextStatusCheckAt: row.next_status_check_at || null
    };
}

function normalizeFiscalReceipt(row = {}) {
    if (!row) return null;
    return {
        id: Number(row.id),
        fiscalOperationId: Number(row.fiscal_operation_id),
        paymentOrderId: row.payment_order_id == null ? null : Number(row.payment_order_id),
        receiptType: row.receipt_type,
        status: row.status,
        provider: row.provider,
        providerReceiptId: row.provider_receipt_id,
        providerFiscalCode: row.provider_fiscal_code || null,
        providerSerial: row.provider_serial || null,
        providerTaxUrl: row.provider_tax_url || null,
        providerPdfUrl: row.provider_pdf_url || null,
        providerQrUrl: row.provider_qr_url || null,
        totalAmountMinor: String(row.total_amount_minor),
        currency: row.currency,
        fiscalizedAt: row.fiscalized_at || null,
        providerSnapshot: row.provider_snapshot || {}
    };
}

function receiptArtifacts(receipts = []) {
    const fiscalized = receipts.find(receipt => receipt.status === 'fiscalized') || receipts[0] || null;
    if (!fiscalized) {
        return { qrUrl: null, taxUrl: null, pdfUrl: null };
    }
    return {
        qrUrl: fiscalized.providerQrUrl || null,
        taxUrl: fiscalized.providerTaxUrl || null,
        pdfUrl: fiscalized.providerPdfUrl || null
    };
}

async function getPaymentOrderDetails({
    dbPool = pool,
    user,
    orderId,
    authorizer = authorizeFiscalAction
} = {}) {
    const numericOrderId = Number(orderId);
    if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
        throw new PaymentServiceError('payment_order_id_invalid', 'Payment order id is invalid', { status: 422 });
    }

    return withTransaction(dbPool, async client => {
        const order = await loadOrderSnapshot(client, numericOrderId);
        if (!order) {
            throw new PaymentServiceError('payment_order_not_found', 'Payment order not found', { status: 404 });
        }

        await authorizer(client, {
            user,
            action: 'payments.view',
            fiscalProfileId: order.fiscal_profile_id,
            crmProfileKey: order.crm_profile_key,
            fiscalLocationId: order.fiscal_location_id,
            fiscalRegisterId: order.fiscal_register_id
        });

        const [itemsResult, operationsResult, receiptsResult, outboxResult] = await Promise.all([
            client.query(
                `SELECT *
                   FROM payment_order_items
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id = $2
                  ORDER BY line_number ASC`,
                [order.fiscal_profile_id, order.id]
            ),
            client.query(
                `SELECT *
                   FROM fiscal_operations
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id = $2
                  ORDER BY created_at DESC, id DESC
                  LIMIT 1`,
                [order.fiscal_profile_id, order.id]
            ),
            client.query(
                `SELECT *
                   FROM fiscal_receipts
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id = $2
                  ORDER BY created_at DESC, id DESC`,
                [order.fiscal_profile_id, order.id]
            ),
            client.query(
                `SELECT id, job_type, status, external_stage, attempts, max_attempts, next_run_at, last_error_code
                   FROM payment_outbox_jobs
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id = $2
                    AND job_type IN ('receipt_sell', 'receipt_status_lookup')
                  ORDER BY created_at DESC, id DESC
                  LIMIT 1`,
                [order.fiscal_profile_id, order.id]
            )
        ]);

        const receipts = receiptsResult.rows.map(normalizeFiscalReceipt);
        const outboxJob = normalizePaymentOutboxJob(outboxResult.rows[0]);
        const publicOrder = normalizePaymentOrderDetails(order);
        publicOrder.rawFiscalStatus = publicOrder.fiscalStatus;
        publicOrder.fiscalQueueStatus = publicFiscalQueueStatus({
            fiscalStatus: publicOrder.fiscalStatus,
            outboxStatus: outboxJob?.status,
            attempts: outboxJob?.attempts,
            maxAttempts: outboxJob?.maxAttempts
        });
        return {
            order: publicOrder,
            items: itemsResult.rows.map(normalizePaymentOrderItem),
            fiscalOperation: normalizeFiscalOperation(operationsResult.rows[0]),
            outboxJob,
            receipts,
            artifacts: receiptArtifacts(receipts)
        };
    });
}

function paymentErrorResponse(error) {
    if (error instanceof PaymentServiceError || error instanceof PaymentWorkflowError || error instanceof AdmissionTicketError || error instanceof FiscalAccessError || error instanceof PaymentReadinessError) {
        return {
            status: error.status || error.statusCode || 400,
            body: {
                success: false,
                error: error.message,
                code: error.code,
                details: error.details || undefined
            }
        };
    }
    return {
        status: 500,
        body: {
            success: false,
            error: 'Internal payment workflow error',
            code: 'payment_workflow_internal_error'
        }
    };
}

module.exports = {
    ORDER_SOURCE_TYPE,
    OUTBOX_JOB_TYPE,
    PILOT_CRM_PROFILE_KEY,
    PILOT_LOCATION_ALIAS,
    PILOT_REGISTER_ALIAS,
    PaymentServiceError,
    assertNoClientFiscalOverride,
    assertCheckboxIntegrationReady,
    cancelDraftPaymentOrder,
    confirmPaymentOrder,
    createAdmissionTicketPaymentOrder,
    getPaymentOrderDetails,
    fingerprint,
    paymentErrorResponse,
    requireIdempotencyKey,
    stableJson
};
