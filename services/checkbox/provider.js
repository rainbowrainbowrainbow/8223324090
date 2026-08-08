'use strict';

const crypto = require('node:crypto');
const { CheckboxClient } = require('./client');
const { CheckboxClientError, redactCheckboxDiagnostics } = require('./errors');
const {
    isCheckboxIntegrationEnabled,
    loadCheckboxRuntimeConfig,
    normalizeCredentialRef
} = require('./config');

const SUCCESS_RECEIPT_STATUSES = new Set(['DONE']);
const PENDING_RECEIPT_STATUSES = new Set(['CREATED']);
const FAILED_RECEIPT_STATUSES = new Set(['ERROR', 'CANCELLATION', 'CANCELLED']);
const OPEN_SHIFT_STATUS = 'OPENED';
const TOKEN_CACHE = new Map();

class CheckboxProviderConfigError extends CheckboxClientError {
    constructor(code, message, options = {}) {
        super(code, message, { status: 503, retryable: false, ...options });
        this.name = 'CheckboxProviderConfigError';
        this.configuration = true;
    }
}

function upperStatus(value) {
    return String(value || '').trim().toUpperCase();
}

function textOrNull(value) {
    const text = String(value ?? '').trim();
    return text || null;
}

function requireText(value, code) {
    const text = textOrNull(value);
    if (!text) throw new CheckboxClientError(code, `${code} is required`, { status: 400, retryable: false });
    return text;
}

function safeJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function minorString(value, code) {
    try {
        const amount = BigInt(String(value ?? '').trim());
        if (amount < 0n) throw new Error(code);
        return amount.toString();
    } catch {
        throw new CheckboxClientError(code, `${code} must be an integer minor amount`, { status: 422, retryable: false });
    }
}

function positiveMinorString(value, code) {
    const amount = minorString(value, code);
    if (BigInt(amount) <= 0n) {
        throw new CheckboxClientError(code, `${code} must be positive`, { status: 422, retryable: false });
    }
    return amount;
}

function assertSameText(actual, expected, code, field) {
    const expectedText = textOrNull(expected);
    if (!expectedText) return;
    const actualText = textOrNull(actual);
    if (!actualText || actualText !== expectedText) {
        throw new CheckboxClientError(code, `Checkbox ${field} does not match expected EventGenix context`, {
            status: 409,
            retryable: false,
            details: { field, expected: expectedText, actual: actualText || null }
        });
    }
}

function blockedValue(value) {
    if (value === true) return true;
    const text = String(value || '').trim().toLowerCase();
    return Boolean(text && !['false', '0', 'no', 'none', 'null'].includes(text));
}

function dbItemToCheckboxItem(item = {}) {
    const providerTaxId = String(item.provider_tax_id || '').trim();
    if (!providerTaxId) {
        throw new CheckboxClientError('checkbox_provider_tax_id_missing', 'Provider tax id is required before Checkbox sale', {
            status: 422,
            retryable: false,
            details: { lineNumber: item.line_number || null }
        });
    }
    return {
        name: item.item_name,
        code: item.item_code || item.sku || item.item_name,
        priceMinor: item.unit_price_minor,
        quantityMillis: item.quantity_milli || item.quantity_millis || 1000,
        tax: [providerTaxId]
    };
}

function receiptIdFromOperation(input = {}) {
    return requireText(input.providerOperationId || input.provider_operation_id || input.providerRequestUuid, 'checkbox_provider_operation_id_required');
}

function paymentTender(paymentOrder = {}) {
    return paymentOrder.payment_method || paymentOrder.paymentMethod || 'cash';
}

function paymentAmountMinor(paymentOrder = {}, fiscalOperation = {}) {
    return positiveMinorString(
        paymentOrder.total_amount_minor || paymentOrder.totalAmountMinor || fiscalOperation.fiscal_operation_amount_minor || fiscalOperation.amount_minor,
        'checkbox_payment_total_required'
    );
}

function confirmationSnapshot(paymentOrder = {}) {
    return safeJsonObject(paymentOrder.confirmation_snapshot || paymentOrder.confirmationSnapshot);
}

function cashReceivedMinor(paymentOrder = {}) {
    const snapshot = confirmationSnapshot(paymentOrder);
    return snapshot.received_amount_minor ?? snapshot.receivedAmountMinor ?? null;
}

function expectedContextFromInput(input = {}, providerDefaults = {}) {
    const fiscalOperation = safeJsonObject(input.fiscalOperation);
    const paymentOrder = safeJsonObject(input.paymentOrder);
    const tender = paymentTender(paymentOrder);
    let amountMinor = '0';
    try {
        amountMinor = paymentAmountMinor(paymentOrder, fiscalOperation);
    } catch (error) {
        if (!providerDefaults.allowMissingPayment) throw error;
    }
    const received = tender === 'cash' ? cashReceivedMinor(paymentOrder) : null;
    const receivedAmountMinor = received == null ? null : positiveMinorString(received, 'checkbox_cash_received_required');
    if (receivedAmountMinor != null && BigInt(receivedAmountMinor) < BigInt(amountMinor)) {
        throw new CheckboxClientError('checkbox_cash_received_less_than_total', 'Cash received amount is less than immutable order total', { status: 422, retryable: false });
    }
    return {
        providerOperationId: receiptIdFromOperation(input),
        fiscalProfileId: textOrNull(fiscalOperation.fiscal_profile_id || paymentOrder.fiscal_profile_id),
        fiscalOperationId: textOrNull(fiscalOperation.fiscal_operation_id || fiscalOperation.id),
        paymentOrderId: textOrNull(paymentOrder.payment_order_id || paymentOrder.id),
        tender,
        amountMinor,
        receivedAmountMinor,
        changeAmountMinor: receivedAmountMinor == null ? null : (BigInt(receivedAmountMinor) - BigInt(amountMinor)).toString(),
        expectedRegisterId: textOrNull(input.providerRegisterId || fiscalOperation.provider_register_id || paymentOrder.provider_register_id),
        expectedCashierId: textOrNull(input.providerCashierId || fiscalOperation.provider_cashier_id || paymentOrder.provider_cashier_id),
        expectedOrganizationId: textOrNull(input.providerOrganizationId || fiscalOperation.provider_organization_id || paymentOrder.provider_organization_id),
        expectedIsTest: providerDefaults.expectedIsTest,
        expectedShiftId: textOrNull(input.providerShiftId || fiscalOperation.provider_shift_id || paymentOrder.provider_shift_id)
    };
}

function extractCashierReadiness(profile = {}) {
    return {
        cashierId: textOrNull(profile.id),
        organizationId: textOrNull(profile.organization?.id || profile.organization_id),
        blocked: blockedValue(profile.blocked),
        isTest: typeof profile.is_test === 'boolean' ? profile.is_test : null,
        certificateEnd: textOrNull(profile.certificate_end)
    };
}

function validateCashierReadiness(profile = {}, expected = {}) {
    const readiness = extractCashierReadiness(profile);
    assertSameText(readiness.cashierId, expected.expectedCashierId, 'checkbox_cashier_identity_mismatch', 'cashier_id');
    assertSameText(readiness.organizationId, expected.expectedOrganizationId, 'checkbox_organization_identity_mismatch', 'organization_id');
    if (readiness.blocked) {
        throw new CheckboxClientError('checkbox_cashier_blocked', 'Checkbox cashier is blocked', { status: 409, retryable: false });
    }
    if (expected.expectedIsTest != null && readiness.isTest !== Boolean(expected.expectedIsTest)) {
        throw new CheckboxClientError('checkbox_cashier_test_mode_mismatch', 'Checkbox cashier test mode does not match expected runtime mode', {
            status: 409,
            retryable: false,
            details: { expected: Boolean(expected.expectedIsTest), actual: readiness.isTest }
        });
    }
    if (readiness.certificateEnd) {
        const certificateEnd = Date.parse(readiness.certificateEnd);
        if (Number.isFinite(certificateEnd) && certificateEnd <= Date.now()) {
            throw new CheckboxClientError('checkbox_cashier_certificate_expired', 'Checkbox cashier certificate is expired', { status: 409, retryable: false });
        }
    }
    return readiness;
}

function extractShiftIdentity(shift = {}) {
    return {
        id: textOrNull(shift.id || shift.shift_id),
        status: upperStatus(shift.status),
        registerId: textOrNull(shift.cash_register_id || shift.cash_register?.id),
        cashierId: textOrNull(shift.cashier_id || shift.cashier?.id)
    };
}

function normalizeShiftResponse(shift = {}, expected = {}, { requireOpened = false } = {}) {
    const identity = extractShiftIdentity(shift);
    if (!identity.id || !identity.status) {
        throw new CheckboxClientError('checkbox_shift_response_malformed', 'Checkbox shift response is missing id or status', {
            status: 502,
            retryable: true,
            unknown: true
        });
    }
    if (requireOpened && identity.status !== OPEN_SHIFT_STATUS) {
        throw new CheckboxClientError('checkbox_shift_not_opened', 'Checkbox shift is not OPENED yet', {
            status: 202,
            retryable: true,
            unknown: true,
            details: { providerStatus: identity.status }
        });
    }
    assertSameText(identity.registerId, expected.expectedRegisterId, 'checkbox_shift_register_mismatch', 'shift.cash_register_id');
    assertSameText(identity.cashierId, expected.expectedCashierId, 'checkbox_shift_cashier_mismatch', 'shift.cashier_id');
    return { ...identity, raw: redactCheckboxDiagnostics(shift) };
}

function trustedCheckboxOrigin(baseUrl) {
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol === 'https:' && isTrustedCheckboxHost(parsed.hostname)) {
            return parsed.origin;
        }
    } catch {
        return null;
    }
    return null;
}

function isTrustedCheckboxHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'api.checkbox.in.ua'
        || host === 'api.checkbox.ua'
        || host.endsWith('.checkbox.in.ua')
        || host.endsWith('.checkbox.ua');
}

function safeCheckboxArtifactUrl(baseUrl, value) {
    const candidate = textOrNull(value);
    if (!candidate) return null;
    try {
        const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(candidate);
        const origin = trustedCheckboxOrigin(baseUrl);
        if (!isAbsolute && !origin) return null;
        const parsed = new URL(candidate, origin || undefined);
        if (parsed.protocol !== 'https:') return null;
        if (!isTrustedCheckboxHost(parsed.hostname)) return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

function receiptArtifactUrl(client, receiptId, format) {
    return safeCheckboxArtifactUrl(client.baseUrl, `/api/v1/receipts/${encodeURIComponent(receiptId)}/${format}`);
}

function extractReceiptIdentity(receipt = {}) {
    const payments = Array.isArray(receipt.payments) ? receipt.payments : [];
    return {
        id: textOrNull(receipt.id || receipt.receipt_id),
        status: upperStatus(receipt.status),
        type: upperStatus(receipt.type || receipt.receipt_type),
        totalSumMinor: textOrNull(receipt.total_sum ?? receipt.totalSum ?? receipt.totalAmountMinor ?? receipt.total_amount_minor),
        totalPaymentMinor: textOrNull(receipt.total_payment ?? receipt.totalPayment),
        totalRestMinor: textOrNull(receipt.total_rest ?? receipt.totalRest),
        cashierId: textOrNull(receipt.cashier_id || receipt.cashier?.id || receipt.shift?.cashier?.id),
        registerId: textOrNull(receipt.cash_register_id || receipt.cash_register?.id || receipt.shift?.cash_register?.id),
        shiftId: textOrNull(receipt.shift_id || receipt.shift?.id),
        payments,
        context: safeJsonObject(receipt.context)
    };
}

function expectedPaymentType(tender) {
    return tender === 'card_terminal_manual' || tender === 'card_terminal' || tender === 'cashless' ? 'CASHLESS' : 'CASH';
}

function validateReceiptPayment(identity, expected) {
    const expectedType = expectedPaymentType(expected.tender);
    const payment = identity.payments.find(item => upperStatus(item?.type) === expectedType)
        || (identity.payments.length === 1 ? identity.payments[0] : null);
    if (!payment) {
        throw new CheckboxClientError('checkbox_receipt_payment_missing', 'Checkbox receipt does not contain the expected payment tender', { status: 409, retryable: false });
    }
    assertSameText(upperStatus(payment.type), expectedType, 'checkbox_receipt_payment_type_mismatch', 'payment.type');
    const paymentValue = minorString(payment.value, 'checkbox_receipt_payment_value_invalid');
    if (expectedType === 'CASH') {
        const received = expected.receivedAmountMinor || expected.amountMinor;
        assertSameText(paymentValue, received, 'checkbox_receipt_cash_received_mismatch', 'payment.value');
        assertSameText(identity.totalPaymentMinor, received, 'checkbox_receipt_total_payment_mismatch', 'receipt.total_payment');
        assertSameText(identity.totalRestMinor, expected.changeAmountMinor || '0', 'checkbox_receipt_cash_change_mismatch', 'receipt.total_rest');
    } else {
        assertSameText(paymentValue, expected.amountMinor, 'checkbox_receipt_payment_amount_mismatch', 'payment.value');
        assertSameText(identity.totalPaymentMinor, expected.amountMinor, 'checkbox_receipt_total_payment_mismatch', 'receipt.total_payment');
        assertSameText(identity.totalRestMinor, '0', 'checkbox_receipt_card_rest_mismatch', 'receipt.total_rest');
    }
}

function validateReceiptIdentity(receipt = {}, expected = {}) {
    const identity = extractReceiptIdentity(receipt);
    const id = requireText(identity.id, 'checkbox_receipt_id_missing');
    assertSameText(id, expected.providerOperationId, 'checkbox_receipt_uuid_mismatch', 'receipt.id');

    if (PENDING_RECEIPT_STATUSES.has(identity.status)) {
        throw new CheckboxClientError('checkbox_receipt_pending', 'Checkbox receipt is not fiscalized yet', {
            status: 202,
            retryable: true,
            unknown: true,
            details: { receiptId: id, providerStatus: identity.status }
        });
    }
    if (FAILED_RECEIPT_STATUSES.has(identity.status)) {
        throw new CheckboxClientError('checkbox_receipt_failed', 'Checkbox receipt reached a terminal failure status', {
            status: 422,
            retryable: false,
            details: { receiptId: id, providerStatus: identity.status }
        });
    }
    if (!SUCCESS_RECEIPT_STATUSES.has(identity.status)) {
        throw new CheckboxClientError('checkbox_receipt_status_unknown', 'Checkbox receipt status is missing or unsupported', {
            status: 502,
            retryable: true,
            unknown: true,
            details: { receiptId: id, providerStatus: identity.status || null }
        });
    }
    assertSameText(identity.type, 'SELL', 'checkbox_receipt_type_mismatch', 'receipt.type');
    assertSameText(minorString(identity.totalSumMinor, 'checkbox_receipt_total_sum_invalid'), expected.amountMinor, 'checkbox_receipt_total_sum_mismatch', 'receipt.total_sum');
    assertSameText(identity.registerId, expected.expectedRegisterId, 'checkbox_receipt_register_mismatch', 'receipt.cash_register_id');
    assertSameText(identity.cashierId, expected.expectedCashierId, 'checkbox_receipt_cashier_mismatch', 'receipt.cashier_id');
    assertSameText(identity.shiftId, expected.expectedShiftId, 'checkbox_receipt_shift_mismatch', 'receipt.shift_id');
    if (!identity.context || identity.context.eventgenix !== true) {
        throw new CheckboxClientError('checkbox_receipt_context_missing', 'Checkbox receipt did not echo EventGenix context', { status: 409, retryable: false });
    }
    assertSameText(String(identity.context.fiscal_operation_id ?? ''), expected.fiscalOperationId, 'checkbox_receipt_context_operation_mismatch', 'context.fiscal_operation_id');
    assertSameText(String(identity.context.payment_order_id ?? ''), expected.paymentOrderId, 'checkbox_receipt_context_payment_order_mismatch', 'context.payment_order_id');
    assertSameText(String(identity.context.fiscal_profile_id ?? ''), expected.fiscalProfileId, 'checkbox_receipt_context_profile_mismatch', 'context.fiscal_profile_id');
    validateReceiptPayment(identity, expected);
    return identity;
}

function normalizeReceiptArtifacts(receipt = {}, client, expected = {}) {
    const identity = validateReceiptIdentity(receipt, expected);
    const id = identity.id;
    return {
        id,
        receiptId: id,
        providerReceiptId: id,
        fiscalCode: receipt.fiscal_code || receipt.fiscalCode || null,
        serial: receipt.serial == null ? null : String(receipt.serial),
        taxUrl: safeCheckboxArtifactUrl(client.baseUrl, receipt.tax_url || receipt.taxUrl),
        pdfUrl: receiptArtifactUrl(client, id, 'pdf'),
        qrUrl: receiptArtifactUrl(client, id, 'qrcode'),
        status: identity.status,
        receiptType: identity.type,
        totalAmountMinor: identity.totalSumMinor,
        totalPaymentMinor: identity.totalPaymentMinor,
        totalRestMinor: identity.totalRestMinor,
        paymentType: expectedPaymentType(expected.tender),
        providerRegisterId: identity.registerId,
        providerCashierId: identity.cashierId,
        providerShiftId: identity.shiftId,
        providerOrganizationId: expected.expectedOrganizationId || null,
        verified: true,
        fiscalizedAt: receipt.fiscal_date || receipt.delivered_at || null,
        raw: redactCheckboxDiagnostics(receipt)
    };
}

function validateSaleResponse(response) {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw new CheckboxClientError('checkbox_receipt_validation_malformed', 'Checkbox receipt validation response is malformed', {
            status: 502,
            retryable: true,
            unknown: true
        });
    }
    const explicitFalse = response.valid === false || response.is_valid === false || response.ok === false || response.success === false;
    const hasErrors = Array.isArray(response.errors) && response.errors.length > 0;
    if (explicitFalse || hasErrors) {
        throw new CheckboxClientError('checkbox_receipt_validation_failed', 'Checkbox receipt validation failed', {
            status: 422,
            retryable: false,
            details: redactCheckboxDiagnostics(response)
        });
    }
    return response;
}

class CheckboxRuntimeProvider {
    constructor({ client, login, password, credentialRef = null, licenseRef = null, expectedIsTest = null, tokenCache = TOKEN_CACHE, tokenTtlMs = 10 * 60 * 1000 } = {}) {
        if (!client) throw new CheckboxProviderConfigError('checkbox_client_required', 'Checkbox client is required');
        this.client = client;
        this.login = login;
        this.password = password;
        this.credentialRef = credentialRef;
        this.licenseRef = licenseRef;
        this.expectedIsTest = expectedIsTest;
        this.tokenCache = tokenCache;
        this.tokenTtlMs = Math.max(60 * 1000, Math.min(Number(tokenTtlMs || 10 * 60 * 1000), 60 * 60 * 1000));
        this.authenticated = false;
        this.readyChecked = false;
    }

    tokenCacheKey() {
        return [this.client.baseUrl, this.credentialRef || 'default', this.licenseRef || 'default'].join('|');
    }

    clearCachedToken() {
        this.authenticated = false;
        this.readyChecked = false;
        this.client.setAccessToken(null);
        this.tokenCache.delete(this.tokenCacheKey());
    }

    async authenticate({ force = false } = {}) {
        const cacheKey = this.tokenCacheKey();
        const cached = !force ? this.tokenCache.get(cacheKey) : null;
        if (cached?.token && cached.expiresAt > Date.now()) {
            this.client.setAccessToken(cached.token);
            this.authenticated = true;
            return { reused: true };
        }
        const response = await this.client.signIn({ login: this.login, password: this.password });
        const token = this.client.accessToken;
        this.tokenCache.set(cacheKey, { token, expiresAt: Date.now() + this.tokenTtlMs });
        this.authenticated = true;
        this.readyChecked = false;
        return response;
    }

    async ensureCashierReady(expected = {}) {
        if (this.readyChecked) return;
        const profile = await this.client.getCashierProfile();
        validateCashierReadiness(profile, { ...expected, expectedIsTest: expected.expectedIsTest ?? this.expectedIsTest });
        this.readyChecked = true;
    }

    async withAuth(expected, run) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (!this.authenticated) await this.authenticate();
            try {
                await this.ensureCashierReady(expected);
                return await run();
            } catch (error) {
                if (attempt === 0 && error instanceof CheckboxClientError && error.status === 401) {
                    this.clearCachedToken();
                    await this.authenticate({ force: true });
                    continue;
                }
                throw error;
            }
        }
        throw new CheckboxClientError('checkbox_auth_retry_exhausted', 'Checkbox authentication retry was exhausted', { status: 401, retryable: true, unknown: true });
    }

    async ensureShiftOpened(input = {}, { allowOpenRequest = false } = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        return this.withAuth(expected, async () => {
            let current = null;
            try {
                current = normalizeShiftResponse(await this.client.getCurrentShift(), expected);
            } catch (error) {
                if (error instanceof CheckboxClientError && (error.status === 401 || error.status === 409 || error.status >= 500 || error.retryable === false)) throw error;
            }
            if (current?.status === OPEN_SHIFT_STATUS) {
                return normalizeShiftResponse(current.raw, expected, { requireOpened: true });
            }
            if (!allowOpenRequest) {
                throw new CheckboxClientError('checkbox_shift_not_opened', 'Checkbox shift is not OPENED yet', {
                    status: 202,
                    retryable: true,
                    unknown: true,
                    details: { providerStatus: current?.status || null }
                });
            }
            const opened = normalizeShiftResponse(await this.client.openShift({ providerRequestUuid: crypto.randomUUID() }), expected);
            if (opened.status !== OPEN_SHIFT_STATUS) {
                const refreshed = normalizeShiftResponse(await this.client.getCurrentShift(), expected, { requireOpened: true });
                return refreshed;
            }
            return normalizeShiftResponse(opened.raw, expected, { requireOpened: true });
        });
    }

    async lookupReceipt(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        return this.withAuth(expected, async () => {
            try {
                const receipt = await this.client.lookupReceipt({ receiptId: expected.providerOperationId });
                return { found: true, receipt: normalizeReceiptArtifacts(receipt, this.client, expected) };
            } catch (error) {
                if (error instanceof CheckboxClientError && error.status === 404) return { found: false };
                throw error;
            }
        });
    }

    async validateSale(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest });
        return this.withAuth(expected, async () => {
            const shift = await this.ensureShiftOpened(input);
            const response = await this.client.validateSale(this.toSalePayload(input, { providerShiftId: shift.id }));
            return validateSaleResponse(response);
        });
    }

    async createSaleReceipt(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest });
        return this.withAuth(expected, async () => {
            const shift = await this.ensureShiftOpened(input);
            const receipt = await this.client.createSaleReceipt(this.toSalePayload(input, { providerShiftId: shift.id }));
            return normalizeReceiptArtifacts(receipt, this.client, { ...expected, expectedShiftId: shift.id });
        });
    }

    async submitSaleReceipt(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest });
        return this.withAuth(expected, async () => {
            const receipt = await this.client.createSaleReceipt(this.toSalePayload(input, { providerShiftId: expected.expectedShiftId }));
            return normalizeReceiptArtifacts(receipt, this.client, expected);
        });
    }

    async openShift(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        return this.withAuth(expected, async () => {
            const response = await this.client.openShift({
                providerRequestUuid: input.providerOperationId || input.providerRequestUuid || input.fiscalOperation?.provider_operation_id
            });
            const shift = normalizeShiftResponse(response, expected);
            if (shift.status === OPEN_SHIFT_STATUS) return normalizeShiftResponse(response, expected, { requireOpened: true });
            return normalizeShiftResponse(await this.client.getCurrentShift(), expected, { requireOpened: true });
        });
    }

    async closeShift(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        return this.withAuth(expected, async () => {
            const response = await this.client.closeShift({
                providerRequestUuid: input.providerOperationId || input.providerRequestUuid || input.fiscalOperation?.provider_operation_id || null
            });
            return normalizeShiftResponse(response, expected);
        });
    }

    toSalePayload(input = {}, overrides = {}) {
        const fiscalOperation = safeJsonObject(input.fiscalOperation);
        const paymentOrder = safeJsonObject(input.paymentOrder);
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest });
        const context = {
            eventgenix: true,
            fiscal_profile_id: Number(fiscalOperation.fiscal_profile_id || paymentOrder.fiscal_profile_id || 0),
            fiscal_operation_id: Number(fiscalOperation.fiscal_operation_id || fiscalOperation.id || 0),
            payment_order_id: Number(paymentOrder.payment_order_id || paymentOrder.id || 0)
        };
        if (overrides.providerShiftId) context.checkbox_shift_id = overrides.providerShiftId;
        return {
            providerRequestUuid: expected.providerOperationId,
            tender: expected.tender,
            amountMinor: expected.amountMinor,
            receivedAmountMinor: expected.receivedAmountMinor,
            items: (input.items || []).map(dbItemToCheckboxItem),
            context
        };
    }
}

function createProviderFromConfig(config = {}, { fetchImpl, tokenCache } = {}) {
    const client = new CheckboxClient({
        baseUrl: config.baseUrl,
        clientName: config.clientName,
        clientVersion: config.clientVersion,
        licenseKey: config.licenseKey,
        accessKey: config.accessKey,
        deviceId: config.deviceId,
        timeoutMs: config.timeoutMs,
        fetchImpl
    });
    return new CheckboxRuntimeProvider({
        client,
        login: config.login,
        password: config.password,
        credentialRef: config.credentialRef,
        licenseRef: config.licenseRef,
        expectedIsTest: config.expectedIsTest,
        tokenCache
    });
}

function refsFromContext(context = {}) {
    const job = context.job || context;
    const licenseRef = normalizeCredentialRef(job.provider_license_ref || job.checkbox_license_ref || job.register_credential_ref);
    const credentialRef = normalizeCredentialRef(job.provider_cashier_login_ref || job.checkbox_cashier_ref || licenseRef);
    return { credentialRef, licenseRef };
}

function runtimeContextKey({ fiscalProfileId, fiscalRegisterId }) {
    const profileId = Number(fiscalProfileId);
    const registerId = Number(fiscalRegisterId);
    if (!Number.isSafeInteger(profileId) || profileId <= 0 || !Number.isSafeInteger(registerId) || registerId <= 0) return '';
    return `${profileId}:${registerId}`;
}

function createCheckboxProviderFactory({ env = process.env, fetchImpl, tokenCache } = {}) {
    return {
        isEnabled() {
            return isCheckboxIntegrationEnabled(env);
        },
        canResolveRefs({ credentialRef, licenseRef } = {}) {
            if (!this.isEnabled()) return false;
            try {
                loadCheckboxRuntimeConfig({ env, credentialRef, licenseRef });
                return true;
            } catch {
                return false;
            }
        },
        createForContext(context = {}) {
            if (!this.isEnabled()) {
                throw new CheckboxProviderConfigError('checkbox_integration_disabled', 'Checkbox integration is disabled');
            }
            const refs = refsFromContext(context);
            const config = loadCheckboxRuntimeConfig({ env, ...refs });
            return createProviderFromConfig(config, { fetchImpl, tokenCache });
        },
        async getEligibleRuntimeContexts(dbPool) {
            if (!this.isEnabled()) return [];
            const client = await dbPool.connect();
            try {
                const result = await client.query(
                    `SELECT DISTINCT
                            job.fiscal_profile_id,
                            COALESCE(po.fiscal_register_id, fo.fiscal_register_id) AS fiscal_register_id,
                            fr.provider_license_ref,
                            fcb.provider_cashier_login_ref
                       FROM payment_outbox_jobs job
                       JOIN fiscal_operations fo
                         ON fo.id = job.fiscal_operation_id
                        AND fo.fiscal_profile_id = job.fiscal_profile_id
                        AND fo.provider = 'checkbox'
                       LEFT JOIN payment_orders po
                         ON po.id = job.payment_order_id
                        AND po.fiscal_profile_id = job.fiscal_profile_id
                       JOIN fiscal_registers fr
                         ON fr.id = COALESCE(po.fiscal_register_id, fo.fiscal_register_id)
                        AND fr.fiscal_profile_id = job.fiscal_profile_id
                        AND fr.provider = 'checkbox'
                        AND fr.status = 'active'
                        AND fr.feature_enabled = TRUE
                       LEFT JOIN fiscal_cashier_bindings fcb
                         ON fcb.fiscal_profile_id = job.fiscal_profile_id
                        AND fcb.fiscal_register_id = fr.id
                        AND fcb.user_id = COALESCE(po.cashier_user_id, fo.initiated_by_user_id)
                        AND fcb.status = 'active'
                      WHERE job.status IN ('queued', 'failed', 'claimed', 'running')
                        AND COALESCE(job.payload->>'provider', fo.provider, fr.provider) = 'checkbox'`
                );
                const contexts = new Map();
                for (const row of result.rows) {
                    if (this.canResolveRefs({
                        credentialRef: row.provider_cashier_login_ref || row.provider_license_ref,
                        licenseRef: row.provider_license_ref
                    })) {
                        const key = runtimeContextKey({
                            fiscalProfileId: row.fiscal_profile_id,
                            fiscalRegisterId: row.fiscal_register_id
                        });
                        if (key) contexts.set(key, {
                            fiscalProfileId: Number(row.fiscal_profile_id),
                            fiscalRegisterId: Number(row.fiscal_register_id)
                        });
                    }
                }
                return [...contexts.values()];
            } finally {
                client.release();
            }
        },
        async getEligibleFiscalProfileIds(dbPool) {
            const contexts = await this.getEligibleRuntimeContexts(dbPool);
            return [...new Set(contexts.map(context => context.fiscalProfileId))];
        }
    };
}

module.exports = {
    FAILED_RECEIPT_STATUSES,
    OPEN_SHIFT_STATUS,
    PENDING_RECEIPT_STATUSES,
    SUCCESS_RECEIPT_STATUSES,
    CheckboxProviderConfigError,
    CheckboxRuntimeProvider,
    createCheckboxProviderFactory,
    createProviderFromConfig,
    dbItemToCheckboxItem,
    expectedContextFromInput,
    extractCashierReadiness,
    extractReceiptIdentity,
    extractShiftIdentity,
    normalizeReceiptArtifacts,
    normalizeShiftResponse,
    refsFromContext,
    runtimeContextKey,
    safeCheckboxArtifactUrl,
    validateCashierReadiness,
    validateReceiptIdentity,
    validateSaleResponse
};
