'use strict';

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
const CLOSED_SHIFT_STATUS = 'CLOSED';
const OPENING_SHIFT_STATUSES = new Set(['CREATED', 'OPENING']);
const CLOSING_SHIFT_STATUSES = new Set(['CLOSING', 'CLOSING_REQUESTED']);
const TOKEN_CACHE = new Map();
const READINESS_CHECK_STATUSES = new Set(['ready', 'blocked', 'unavailable', 'not_applicable']);

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
    const taxMode = String(item.tax_mode || item.taxMode || item.item_snapshot?.fiscal_tax_mode || 'taxed').trim().toLowerCase();
    const providerTaxId = String(item.provider_tax_id || '').trim();
    if (taxMode === 'untaxed') {
        if (providerTaxId) {
            throw new CheckboxClientError('checkbox_untaxed_provider_tax_forbidden', 'Untaxed fiscal item must not include provider tax id', {
                status: 422,
                retryable: false,
                details: { lineNumber: item.line_number || null }
            });
        }
    } else if (!providerTaxId) {
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
        tax: taxMode === 'untaxed' ? undefined : [providerTaxId]
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
    if (expected.expectedIsTest == null) {
        throw new CheckboxClientError('checkbox_expected_is_test_required', 'Checkbox expected test mode must be explicit before provider readiness or fiscal operations', {
            status: 503,
            retryable: false
        });
    }
    if (readiness.isTest !== Boolean(expected.expectedIsTest)) {
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

function validateCashierPermissions(profile = {}, { requireCash = true, requireCard = true } = {}) {
    const permissions = profile.permissions;
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
        throw new CheckboxClientError('checkbox_cashier_permissions_missing', 'Checkbox cashier permissions are missing', { status: 409, retryable: false });
    }
    const required = ['sales'];
    if (requireCash) required.push('cash_payment');
    if (requireCard) required.push('card_payment');
    const denied = required.filter(key => permissions[key] !== true);
    if (denied.length) {
        throw new CheckboxClientError('checkbox_cashier_permissions_missing', 'Checkbox cashier does not have required payment permissions', {
            status: 409,
            retryable: false,
            details: { missing: denied }
        });
    }
    return {
        sales: permissions.sales === true,
        cashPayment: permissions.cash_payment === true,
        cardPayment: permissions.card_payment === true
    };
}

function readinessCheck({ code, label, status, ready = null, recommendation = null, details = null }) {
    const normalizedStatus = READINESS_CHECK_STATUSES.has(status) ? status : 'blocked';
    return {
        code,
        label,
        status: normalizedStatus,
        ready: ready == null ? normalizedStatus === 'ready' : Boolean(ready),
        recommendation,
        details: redactCheckboxDiagnostics(details || {})
    };
}

function readinessRecommendation(code) {
    switch (code) {
        case 'auth':
            return 'Перевірити credential mode: password або PIN, а також правильність локальних Checkbox credentials.';
        case 'cashier_identity':
            return 'Перевірити, що в локальному mapping вказаний саме тестовий касир Checkbox.';
        case 'organization_identity':
            return 'Перевірити, що Checkbox organization відповідає тестовому ФОП/акаунту.';
        case 'register_identity':
            return 'Перевірити, що вказана саме очікувана тестова каса middle, а не інша каса.';
        case 'is_test':
            return 'Перевірити тестову касу: cashier/register мають бути is_test=true для test-mode QA.';
        case 'register_online':
            return 'Перевірити стан каси в Checkbox: вона не має бути offline/stay_offline.';
        case 'signature':
            return 'Перевірити підпис касира в Checkbox: підпис має бути онлайн і дозволяти відкриття зміни.';
        case 'certificate':
            return 'Перевірити сертифікат/КЕП касира в Checkbox.';
        case 'sales_permission':
            return 'Увімкнути permission продажів для тестового касира Checkbox.';
        case 'cash_permission':
            return 'Увімкнути cash payment для тестового касира Checkbox.';
        case 'card_permission':
            return 'Увімкнути card/cashless payment для тестового касира Checkbox.';
        case 'provider_taxes':
            return 'Перевірити provider tax IDs або режим untaxed у fiscal item mapping.';
        case 'current_shift':
            return 'Перевірити поточну зміну Checkbox у тестовій касі; це read-only статус, зміна не відкривається автоматично.';
        default:
            return 'Перевірити налаштування Checkbox test-mode integration.';
    }
}

function errorCheck(code, label, error) {
    const status = error instanceof CheckboxClientError && error.retryable ? 'unavailable' : 'blocked';
    return readinessCheck({
        code,
        label,
        status,
        ready: false,
        recommendation: readinessRecommendation(code),
        details: {
            errorCode: error?.code || error?.name || 'checkbox_readiness_check_failed',
            message: error?.message || 'Checkbox readiness check failed',
            details: error?.details || null
        }
    });
}

function permissionValue(profile, key) {
    const permissions = profile?.permissions;
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return null;
    return permissions[key] === true ? true : permissions[key] === false ? false : null;
}

function permissionCheck(profile, key, code, label) {
    const value = permissionValue(profile, key);
    return readinessCheck({
        code,
        label,
        status: value === true ? 'ready' : 'blocked',
        ready: value === true,
        recommendation: value === true ? null : readinessRecommendation(code),
        details: { permission: key, value }
    });
}

async function captureReadinessStep(checks, code, label, fn) {
    try {
        const result = await fn();
        checks.push(readinessCheck({ code, label, status: 'ready', details: result }));
        return result;
    } catch (error) {
        checks.push(errorCheck(code, label, error));
        return null;
    }
}

function validateSignatureStatus(signature = {}) {
    if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
        throw new CheckboxClientError('checkbox_signature_status_malformed', 'Checkbox signature status response is malformed', { status: 502, retryable: true, unknown: true });
    }
    if (signature.online !== true) {
        throw new CheckboxClientError('checkbox_signature_offline', 'Checkbox signature is not online', {
            status: 409,
            retryable: false,
            details: { online: signature.online ?? null }
        });
    }
    if (signature.shift_open_possibility !== true) {
        throw new CheckboxClientError('checkbox_signature_shift_open_not_allowed', 'Checkbox signature cannot open shifts', {
            status: 409,
            retryable: false,
            details: { shiftOpenPossibility: signature.shift_open_possibility ?? null }
        });
    }
    if (!textOrNull(signature.type)) {
        throw new CheckboxClientError('checkbox_signature_type_missing', 'Checkbox signature type is missing', { status: 409, retryable: false });
    }
    return {
        online: true,
        type: textOrNull(signature.type),
        shiftOpenPossibility: true
    };
}

function validateCashRegisterInfo(info = {}, expected = {}) {
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
        throw new CheckboxClientError('checkbox_cash_register_info_malformed', 'Checkbox cash register info response is malformed', { status: 502, retryable: true, unknown: true });
    }
    const registerId = textOrNull(info.id);
    const organizationId = textOrNull(info.organization_id);
    const documentsState = info.documents_state && typeof info.documents_state === 'object' && !Array.isArray(info.documents_state)
        ? info.documents_state
        : null;
    if (!registerId || !organizationId || typeof info.is_test !== 'boolean' || typeof info.offline_mode !== 'boolean' || typeof info.stay_offline !== 'boolean' || !documentsState) {
        throw new CheckboxClientError('checkbox_cash_register_info_malformed', 'Checkbox cash register info response does not match official CashRegisterDeviceModel', {
            status: 502,
            retryable: true,
            unknown: true,
            details: redactCheckboxDiagnostics({
                hasId: Boolean(registerId),
                hasOrganizationId: Boolean(organizationId),
                isTestType: typeof info.is_test,
                offlineModeType: typeof info.offline_mode,
                stayOfflineType: typeof info.stay_offline,
                hasDocumentsState: Boolean(documentsState)
            })
        });
    }
    assertSameText(registerId, expected.expectedRegisterId, 'checkbox_register_identity_mismatch', 'cash_register.id');
    assertSameText(organizationId, expected.expectedOrganizationId, 'checkbox_register_organization_mismatch', 'cash_register.organization_id');
    if (expected.expectedIsTest == null) {
        throw new CheckboxClientError('checkbox_expected_is_test_required', 'Checkbox expected test mode must be explicit before provider readiness', {
            status: 503,
            retryable: false
        });
    }
    if (info.is_test !== Boolean(expected.expectedIsTest)) {
        throw new CheckboxClientError('checkbox_register_test_mode_mismatch', 'Checkbox cash register test mode does not match expected runtime mode', {
            status: 409,
            retryable: false,
            details: { expected: Boolean(expected.expectedIsTest), actual: info.is_test }
        });
    }
    if (info.offline_mode === true || info.stay_offline === true) {
        throw new CheckboxClientError('checkbox_register_offline', 'Checkbox cash register is offline', {
            status: 409,
            retryable: false,
            details: { offlineMode: info.offline_mode ?? null, stayOffline: info.stay_offline ?? null }
        });
    }
    return {
        registerId,
        organizationId,
        isTest: info.is_test,
        fiscalNumber: textOrNull(info.fiscal_number),
        offlineMode: info.offline_mode === true,
        stayOffline: info.stay_offline === true,
        documentsState: redactCheckboxDiagnostics(documentsState)
    };
}

function validateProviderTaxes(taxes = [], expectedTaxIds = []) {
    if (!Array.isArray(taxes)) {
        throw new CheckboxClientError('checkbox_tax_response_malformed', 'Checkbox cashier tax response must be an array', { status: 502, retryable: true, unknown: true });
    }
    const expected = [...new Set((expectedTaxIds || []).map(textOrNull).filter(Boolean))];
    if (!expected.length) {
        return { expected: [], availableCount: taxes.length };
    }
    const available = new Set();
    for (const tax of taxes) {
        const id = textOrNull(tax?.id);
        const code = textOrNull(tax?.code);
        if (id) available.add(id);
        if (code) available.add(code);
    }
    const missing = expected.filter(id => !available.has(id));
    if (missing.length) {
        throw new CheckboxClientError('checkbox_provider_tax_ids_unavailable', 'Checkbox cashier does not expose required provider tax IDs', {
            status: 409,
            retryable: false,
            details: { missing }
        });
    }
    return { expected, availableCount: available.size };
}

function extractShiftIdentity(shift = {}) {
    return {
        id: textOrNull(shift.id || shift.shift_id),
        status: upperStatus(shift.status),
        registerId: textOrNull(shift.cash_register_id || shift.cash_register?.id),
        cashierId: textOrNull(shift.cashier_id || shift.cashier?.id)
    };
}

function normalizeShiftResponse(shift = {}, expected = {}, { requireOpened = false, requireCashier = true } = {}) {
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
    assertSameText(identity.id, expected.expectedShiftId, 'checkbox_shift_id_mismatch', 'shift.id');
    assertSameText(identity.registerId, expected.expectedRegisterId, 'checkbox_shift_register_mismatch', 'shift.cash_register_id');
    if (requireCashier) {
        assertSameText(identity.cashierId, expected.expectedCashierId, 'checkbox_shift_cashier_mismatch', 'shift.cashier_id');
    }
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
        || host === 'api.checkbox.ua';
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

function expectedReceiptTypeFromInput(input = {}) {
    const fiscalOperation = safeJsonObject(input.fiscalOperation);
    const operationType = String(fiscalOperation.operation_type || input.operationType || '').trim();
    if (operationType === 'return') return 'RETURN';
    if (operationType === 'service_in') return 'SERVICE_IN';
    if (operationType === 'service_out') return 'SERVICE_OUT';
    return 'SELL';
}

function validateReceiptPayment(identity, expected) {
    if (String(expected.expectedReceiptType || 'SELL').startsWith('SERVICE_')) return;
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
    assertSameText(identity.type, expected.expectedReceiptType || 'SELL', 'checkbox_receipt_type_mismatch', 'receipt.type');
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
    const booleans = [];
    const collectBooleans = value => {
        if (typeof value === 'boolean') {
            booleans.push(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(collectBooleans);
            return;
        }
        if (value && typeof value === 'object') {
            Object.values(value).forEach(collectBooleans);
        }
    };
    collectBooleans(response);
    if (!booleans.length) {
        throw new CheckboxClientError('checkbox_receipt_validation_malformed', 'Checkbox receipt validation response does not contain boolean validation results', {
            status: 502,
            retryable: true,
            unknown: true,
            details: redactCheckboxDiagnostics(response)
        });
    }
    const explicitFalse = booleans.some(value => value === false);
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
    constructor({ client, authMode = 'password', login, password, pinCode, credentialRef = null, licenseRef = null, expectedIsTest = null, tokenCache = TOKEN_CACHE, tokenTtlMs = 10 * 60 * 1000 } = {}) {
        if (!client) throw new CheckboxProviderConfigError('checkbox_client_required', 'Checkbox client is required');
        this.client = client;
        this.login = login;
        this.password = password;
        this.pinCode = pinCode;
        this.authMode = authMode;
        this.credentialRef = credentialRef;
        this.licenseRef = licenseRef;
        this.expectedIsTest = expectedIsTest;
        this.tokenCache = tokenCache;
        this.tokenTtlMs = Math.max(60 * 1000, Math.min(Number(tokenTtlMs || 10 * 60 * 1000), 60 * 60 * 1000));
        this.authenticated = false;
        this.readyChecked = false;
    }

    tokenCacheKey() {
        return [this.client.baseUrl, this.credentialRef || 'default', this.licenseRef || 'default', this.authMode].join('|');
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
        const response = this.authMode === 'pin'
            ? await this.client.signInWithPinCode({ pinCode: this.pinCode })
            : await this.client.signIn({ login: this.login, password: this.password });
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

    async verifyReadiness(expected = {}, { expectedTaxIds = [] } = {}) {
        const run = async () => {
            const strictExpected = { ...expected, expectedIsTest: expected.expectedIsTest ?? this.expectedIsTest };
            const profile = await this.client.getCashierProfile();
            const cashier = validateCashierReadiness(profile, strictExpected);
            const permissions = validateCashierPermissions(profile);
            const register = validateCashRegisterInfo(await this.client.getCashRegisterInfo(), strictExpected);
            const signature = validateSignatureStatus(await this.client.checkSignature());
            const taxes = validateProviderTaxes(await this.client.getCashierTaxes(), expectedTaxIds);
            return {
                cashier,
                permissions,
                register,
                signature,
                taxes,
                raw: {
                    cashier: redactCheckboxDiagnostics(profile),
                    register,
                    signature,
                    taxes
                }
            };
        };
        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (!this.authenticated) await this.authenticate({ force: attempt > 0 });
            try {
                const readiness = await run();
                this.readyChecked = true;
                return readiness;
            } catch (error) {
                if (attempt === 0 && error instanceof CheckboxClientError && error.status === 401) {
                    this.clearCachedToken();
                    await this.authenticate({ force: true });
                    continue;
                }
                throw error;
            }
        }
        throw new CheckboxClientError('checkbox_auth_retry_exhausted', 'Checkbox readiness authentication retry was exhausted', { status: 401, retryable: true, unknown: true });
    }

    async collectReadinessDiagnostics(expected = {}, { expectedTaxIds = [] } = {}) {
        const strictExpected = { ...expected, expectedIsTest: expected.expectedIsTest ?? this.expectedIsTest };
        const checks = [];
        let authOk = false;
        let profile = null;
        let registerInfo = null;
        let signature = null;
        let taxes = null;
        let currentShift = null;

        try {
            await this.authenticate({ force: false });
            authOk = true;
            checks.push(readinessCheck({
                code: 'auth',
                label: 'Авторизація Checkbox',
                status: 'ready',
                details: { authMode: this.authMode, credentialRef: this.credentialRef || null }
            }));
        } catch (error) {
            checks.push(errorCheck('auth', 'Авторизація Checkbox', error));
        }

        if (authOk) {
            try {
                profile = await this.client.getCashierProfile();
                const cashier = validateCashierReadiness(profile, { expectedCashierId: strictExpected.expectedCashierId, expectedIsTest: strictExpected.expectedIsTest });
                checks.push(readinessCheck({
                    code: 'cashier_identity',
                    label: 'Касир Checkbox',
                    status: 'ready',
                    details: cashier
                }));
            } catch (error) {
                checks.push(errorCheck('cashier_identity', 'Касир Checkbox', error));
                profile = null;
            }
            if (profile) {
                const cashier = extractCashierReadiness(profile);
                checks.push(readinessCheck({
                    code: 'organization_identity',
                    label: 'ФОП / organization Checkbox',
                    status: (() => {
                        try {
                            assertSameText(cashier.organizationId, strictExpected.expectedOrganizationId, 'checkbox_organization_identity_mismatch', 'organization_id');
                            return 'ready';
                        } catch {
                            return 'blocked';
                        }
                    })(),
                    ready: textOrNull(strictExpected.expectedOrganizationId) ? cashier.organizationId === textOrNull(strictExpected.expectedOrganizationId) : Boolean(cashier.organizationId),
                    recommendation: textOrNull(strictExpected.expectedOrganizationId) && cashier.organizationId !== textOrNull(strictExpected.expectedOrganizationId) ? readinessRecommendation('organization_identity') : null,
                    details: { organizationIdConfigured: Boolean(strictExpected.expectedOrganizationId), organizationIdSeen: Boolean(cashier.organizationId) }
                }));
                checks.push(readinessCheck({
                    code: 'is_test',
                    label: 'Test-mode identity',
                    status: cashier.isTest === Boolean(strictExpected.expectedIsTest) ? 'ready' : 'blocked',
                    ready: cashier.isTest === Boolean(strictExpected.expectedIsTest),
                    recommendation: cashier.isTest === Boolean(strictExpected.expectedIsTest) ? null : readinessRecommendation('is_test'),
                    details: { expectedIsTest: strictExpected.expectedIsTest, cashierIsTest: cashier.isTest }
                }));
                checks.push(permissionCheck(profile, 'sales', 'sales_permission', 'Право продажів'));
                checks.push(permissionCheck(profile, 'cash_payment', 'cash_permission', 'Право оплати готівкою'));
                checks.push(permissionCheck(profile, 'card_payment', 'card_permission', 'Право оплати карткою'));
                checks.push(readinessCheck({
                    code: 'certificate',
                    label: 'Сертифікат касира',
                    status: cashier.certificateEnd ? 'ready' : 'blocked',
                    ready: Boolean(cashier.certificateEnd),
                    recommendation: cashier.certificateEnd ? null : readinessRecommendation('certificate'),
                    details: { certificateEndConfigured: Boolean(cashier.certificateEnd) }
                }));
            } else {
                for (const [code, label] of [
                    ['organization_identity', 'ФОП / organization Checkbox'],
                    ['is_test', 'Test-mode identity'],
                    ['sales_permission', 'Право продажів'],
                    ['cash_permission', 'Право оплати готівкою'],
                    ['card_permission', 'Право оплати карткою'],
                    ['certificate', 'Сертифікат касира']
                ]) {
                    checks.push(readinessCheck({ code, label, status: 'unavailable', ready: false, recommendation: readinessRecommendation(code) }));
                }
            }

            signature = await captureReadinessStep(checks, 'signature', 'Підпис Checkbox', async () => {
                const value = await this.client.checkSignature();
                return validateSignatureStatus(value);
            });
            taxes = await captureReadinessStep(checks, 'provider_taxes', 'Податкові групи Checkbox', async () => {
                const value = await this.client.getCashierTaxes();
                return validateProviderTaxes(value, expectedTaxIds);
            });
            try {
                const value = await this.client.getCurrentShift();
                currentShift = normalizeShiftResponse(value, strictExpected, { requireCashier: false });
                const shiftStatus = upperStatus(currentShift.status);
                checks.push(readinessCheck({
                    code: 'current_shift',
                    label: 'Поточна зміна Checkbox',
                    status: OPENING_SHIFT_STATUSES.has(shiftStatus) || CLOSING_SHIFT_STATUSES.has(shiftStatus) ? 'blocked' : 'ready',
                    ready: !(OPENING_SHIFT_STATUSES.has(shiftStatus) || CLOSING_SHIFT_STATUSES.has(shiftStatus)),
                    recommendation: OPENING_SHIFT_STATUSES.has(shiftStatus) || CLOSING_SHIFT_STATUSES.has(shiftStatus) ? readinessRecommendation('current_shift') : null,
                    details: currentShift
                }));
            } catch (error) {
                if (error instanceof CheckboxClientError && (error.status === 404 || error.status === 422)) {
                    checks.push(readinessCheck({
                        code: 'current_shift',
                        label: 'Поточна зміна Checkbox',
                        status: 'not_applicable',
                        ready: true,
                        details: { shiftStatus: 'none' }
                    }));
                } else {
                    checks.push(errorCheck('current_shift', 'Поточна зміна Checkbox', error));
                }
            }
        } else {
            for (const [code, label] of [
                ['cashier_identity', 'Касир Checkbox'],
                ['organization_identity', 'ФОП / organization Checkbox'],
                ['is_test', 'Test-mode identity'],
                ['signature', 'Підпис Checkbox'],
                ['certificate', 'Сертифікат касира'],
                ['sales_permission', 'Право продажів'],
                ['cash_permission', 'Право оплати готівкою'],
                ['card_permission', 'Право оплати карткою'],
                ['provider_taxes', 'Податкові групи Checkbox'],
                ['current_shift', 'Поточна зміна Checkbox']
            ]) {
                checks.push(readinessCheck({ code, label, status: 'unavailable', ready: false, recommendation: readinessRecommendation(code) }));
            }
        }

        try {
            const value = await this.client.getCashRegisterInfo();
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                throw new CheckboxClientError('checkbox_cash_register_info_malformed', 'Checkbox cash register info response is malformed', { status: 502, retryable: true, unknown: true });
            }
            const registerId = textOrNull(value.id);
            const organizationId = textOrNull(value.organization_id);
            const documentsState = value.documents_state && typeof value.documents_state === 'object' && !Array.isArray(value.documents_state)
                ? value.documents_state
                : null;
            if (!registerId || !organizationId || typeof value.is_test !== 'boolean' || typeof value.offline_mode !== 'boolean' || typeof value.stay_offline !== 'boolean' || !documentsState) {
                throw new CheckboxClientError('checkbox_cash_register_info_malformed', 'Checkbox cash register info response does not match official CashRegisterDeviceModel', {
                    status: 502,
                    retryable: true,
                    unknown: true,
                    details: redactCheckboxDiagnostics({
                        hasId: Boolean(registerId),
                        hasOrganizationId: Boolean(organizationId),
                        isTestType: typeof value.is_test,
                        offlineModeType: typeof value.offline_mode,
                        stayOfflineType: typeof value.stay_offline,
                        hasDocumentsState: Boolean(documentsState)
                    })
                });
            }
            const identityOk = (!textOrNull(strictExpected.expectedRegisterId) || registerId === textOrNull(strictExpected.expectedRegisterId))
                && (!textOrNull(strictExpected.expectedOrganizationId) || organizationId === textOrNull(strictExpected.expectedOrganizationId));
            registerInfo = {
                registerId,
                organizationId,
                isTest: value.is_test,
                fiscalNumber: textOrNull(value.fiscal_number),
                offlineMode: value.offline_mode === true,
                stayOffline: value.stay_offline === true,
                documentsState: redactCheckboxDiagnostics(documentsState)
            };
            checks.push(readinessCheck({
                code: 'register_identity',
                label: 'Каса Checkbox',
                status: identityOk ? 'ready' : 'blocked',
                ready: identityOk,
                recommendation: identityOk ? null : readinessRecommendation('register_identity'),
                details: {
                    registerIdConfigured: Boolean(strictExpected.expectedRegisterId),
                    organizationIdConfigured: Boolean(strictExpected.expectedOrganizationId),
                    registerIdSeen: Boolean(registerId),
                    organizationIdSeen: Boolean(organizationId)
                }
            }));
            const existingIsTest = checks.find(check => check.code === 'is_test');
            if (existingIsTest && existingIsTest.status === 'ready' && registerInfo.isTest !== Boolean(strictExpected.expectedIsTest)) {
                existingIsTest.status = 'blocked';
                existingIsTest.ready = false;
                existingIsTest.recommendation = readinessRecommendation('is_test');
                existingIsTest.details = { ...existingIsTest.details, registerIsTest: registerInfo.isTest };
            }
            checks.push(readinessCheck({
                code: 'register_online',
                label: 'Онлайн-стан каси',
                status: registerInfo.offlineMode || registerInfo.stayOffline ? 'blocked' : 'ready',
                ready: !(registerInfo.offlineMode || registerInfo.stayOffline),
                recommendation: registerInfo.offlineMode || registerInfo.stayOffline ? readinessRecommendation('register_online') : null,
                details: {
                    offlineMode: registerInfo.offlineMode,
                    stayOffline: registerInfo.stayOffline,
                    documentsState: registerInfo.documentsState || null
                }
            }));
        } catch (error) {
            checks.push(errorCheck('register_identity', 'Каса Checkbox', error));
            checks.push(readinessCheck({
                code: 'register_online',
                label: 'Онлайн-стан каси',
                status: 'unavailable',
                ready: false,
                recommendation: readinessRecommendation('register_online')
            }));
        }

        const ready = checks.every(check => check.status === 'ready' || check.status === 'not_applicable');
        return {
            ready,
            status: ready ? 'ready' : 'blocked',
            mutations: false,
            authMode: this.authMode,
            checks,
            summary: {
                readyCount: checks.filter(check => check.status === 'ready').length,
                blockedCount: checks.filter(check => check.status === 'blocked').length,
                unavailableCount: checks.filter(check => check.status === 'unavailable').length,
                notApplicableCount: checks.filter(check => check.status === 'not_applicable').length
            },
            raw: redactCheckboxDiagnostics({
                cashier: profile,
                register: registerInfo,
                signature,
                taxes,
                currentShift
            })
        };
    }

    async prepareMutation(input = {}, { expectedTaxIds = [] } = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        return this.verifyReadiness(expected, { expectedTaxIds });
    }

    async loadDetailedShift(current, expected) {
        if (!this.client.getShiftById) {
            return normalizeShiftResponse(current.raw || current, expected, { requireOpened: true, requireCashier: true });
        }
        try {
            return normalizeShiftResponse(await this.client.getShiftById({ shiftId: current.id }), expected, { requireOpened: true, requireCashier: true });
        } catch (error) {
            if (error instanceof CheckboxClientError && (error.status === 404 || error.code === 'checkbox_shift_response_malformed')) {
                return normalizeShiftResponse(current.raw || current, expected, { requireOpened: true, requireCashier: true });
            }
            throw error;
        }
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
        const fiscalOperation = safeJsonObject(input.fiscalOperation);
        if (!expected.expectedShiftId && fiscalOperation.operation_type === 'shift_open') {
            expected.expectedShiftId = expected.providerOperationId;
        }
        return this.withAuth(expected, async () => {
            let current = null;
            try {
                current = normalizeShiftResponse(await this.client.getCurrentShift(), expected, { requireCashier: false });
            } catch (error) {
                if (error instanceof CheckboxClientError && (error.status === 401 || error.status === 409 || error.status >= 500 || error.retryable === false)) throw error;
            }
            if (current?.status === OPEN_SHIFT_STATUS) {
                if (!expected.expectedShiftId) {
                    throw new CheckboxClientError('checkbox_shift_explicit_sync_required', 'Open Checkbox shift cannot be adopted without explicit audited sync', {
                        status: 409,
                        retryable: false,
                        unknown: false,
                        details: { providerShiftId: current.id }
                    });
                }
                return this.loadDetailedShift(current, expected);
            }
            if (!allowOpenRequest) {
                throw new CheckboxClientError('checkbox_shift_not_opened', 'Checkbox shift is not OPENED yet', {
                    status: 202,
                    retryable: true,
                    unknown: true,
                    details: { providerStatus: current?.status || null }
                });
            }
            const opened = normalizeShiftResponse(await this.client.openShift({ providerRequestUuid: expected.providerOperationId }), expected, { requireCashier: false });
            if (opened.status !== OPEN_SHIFT_STATUS) {
                return opened;
            }
            return this.loadDetailedShift(opened, expected);
        });
    }

    async lookupShift(input = {}, { requireOpened = false } = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        const fiscalOperation = safeJsonObject(input.fiscalOperation);
        const shiftId = expected.expectedShiftId || fiscalOperation.provider_shift_id || expected.providerOperationId;
        if (!shiftId) {
            throw new CheckboxClientError('checkbox_shift_id_required', 'Checkbox shift lookup requires a durable provider shift UUID', {
                status: 422,
                retryable: false
            });
        }
        expected.expectedShiftId = shiftId;
        return this.withAuth(expected, async () => {
            const shift = normalizeShiftResponse(await this.client.getShiftById({ shiftId }), expected, { requireOpened, requireCashier: false });
            if (shift.status === OPEN_SHIFT_STATUS) return this.loadDetailedShift(shift, expected);
            return shift;
        });
    }

    async lookupReceipt(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        expected.expectedReceiptType = expectedReceiptTypeFromInput(input);
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
        expected.expectedReceiptType = 'SELL';
        return this.withAuth(expected, async () => {
            const shift = await this.ensureShiftOpened(input);
            const receipt = await this.client.createSaleReceipt(this.toSalePayload(input, { providerShiftId: shift.id }));
            return normalizeReceiptArtifacts(receipt, this.client, { ...expected, expectedShiftId: shift.id });
        });
    }

    async submitSaleReceipt(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest });
        expected.expectedReceiptType = 'SELL';
        return this.withAuth(expected, async () => {
            const receipt = await this.client.createSaleReceipt(this.toSalePayload(input, { providerShiftId: expected.expectedShiftId }));
            return normalizeReceiptArtifacts(receipt, this.client, expected);
        });
    }

    async createReturnReceipt(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest });
        expected.expectedReceiptType = 'RETURN';
        return this.withAuth(expected, async () => {
            const shift = await this.ensureShiftOpened(input);
            const payload = this.toReturnPayload(input, { providerShiftId: shift.id });
            const receipt = await this.client.createReturnReceipt(payload);
            return normalizeReceiptArtifacts(receipt, this.client, { ...expected, expectedShiftId: shift.id });
        });
    }

    async createServiceReceipt(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        expected.expectedReceiptType = expectedReceiptTypeFromInput(input);
        return this.withAuth(expected, async () => {
            const shift = await this.ensureShiftOpened(input);
            const payload = this.toServicePayload(input, { providerShiftId: shift.id });
            const receipt = await this.client.createServiceReceipt(payload);
            return normalizeReceiptArtifacts(receipt, this.client, { ...expected, expectedShiftId: shift.id });
        });
    }

    async openShift(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        const shiftExpected = { ...expected, expectedShiftId: expected.expectedShiftId || expected.providerOperationId };
        return this.withAuth(expected, async () => {
            const response = await this.client.openShift({
                providerRequestUuid: input.providerOperationId || input.providerRequestUuid || input.fiscalOperation?.provider_operation_id
            });
            const shift = normalizeShiftResponse(response, shiftExpected, { requireCashier: false });
            if (shift.status === OPEN_SHIFT_STATUS) return normalizeShiftResponse(response, shiftExpected, { requireOpened: true });
            if (OPENING_SHIFT_STATUSES.has(shift.status)) return shift;
            throw new CheckboxClientError('checkbox_shift_open_unexpected_status', 'Checkbox shift open returned an unexpected status', {
                status: 502,
                retryable: true,
                unknown: true,
                details: { providerStatus: shift.status }
            });
        });
    }

    async getCurrentShiftStatus(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        return this.withAuth(expected, async () => {
            try {
                const current = normalizeShiftResponse(await this.client.getCurrentShift(), expected, { requireCashier: false });
                if (current.status === OPEN_SHIFT_STATUS) return this.loadDetailedShift(current, expected);
                if (current.status === CLOSED_SHIFT_STATUS || CLOSING_SHIFT_STATUSES.has(current.status) || OPENING_SHIFT_STATUSES.has(current.status)) return current;
                return current;
            } catch (error) {
                if (error instanceof CheckboxClientError && error.status === 404) {
                    return { id: expected.expectedShiftId || null, status: CLOSED_SHIFT_STATUS, registerId: expected.expectedRegisterId || null, cashierId: expected.expectedCashierId || null, raw: {} };
                }
                throw error;
            }
        });
    }

    async closeShift(input = {}) {
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        return this.withAuth(expected, async () => {
            const response = await this.client.closeShift();
            return normalizeShiftResponse(response, expected, { requireCashier: false });
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

    toReturnPayload(input = {}, overrides = {}) {
        const fiscalOperation = safeJsonObject(input.fiscalOperation);
        const paymentOrder = safeJsonObject(input.paymentOrder);
        const snapshot = safeJsonObject(fiscalOperation.fiscal_request_snapshot || fiscalOperation.request_snapshot);
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest });
        const originalReceiptId = snapshot.original_provider_receipt_id
            || snapshot.original_receipt_id
            || snapshot.originalProviderReceiptId
            || input.originalReceiptId
            || input.original_receipt_id;
        const context = {
            eventgenix: true,
            fiscal_profile_id: Number(fiscalOperation.fiscal_profile_id || paymentOrder.fiscal_profile_id || 0),
            fiscal_operation_id: Number(fiscalOperation.fiscal_operation_id || fiscalOperation.id || 0),
            payment_order_id: Number(paymentOrder.payment_order_id || paymentOrder.id || 0),
            payment_refund_id: Number(fiscalOperation.payment_refund_id || paymentOrder.payment_refund_id || 0),
            checkbox_shift_id: overrides.providerShiftId || expected.expectedShiftId || null
        };
        const goods = (input.items || []).map(dbItemToCheckboxItem);
        return {
            providerRequestUuid: expected.providerOperationId,
            originalReceiptId,
            originalSalePayload: {
                goods,
                payments: [{
                    type: expectedPaymentType(expected.tender),
                    value: expected.amountMinor,
                    label: expectedPaymentType(expected.tender) === 'CASH' ? 'Готівка' : 'Картка'
                }]
            },
            context
        };
    }

    toServicePayload(input = {}, overrides = {}) {
        const fiscalOperation = safeJsonObject(input.fiscalOperation);
        const expected = expectedContextFromInput(input, { expectedIsTest: this.expectedIsTest, allowMissingPayment: true });
        const operationType = String(fiscalOperation.operation_type || input.operationType || 'service_in').trim();
        return {
            providerRequestUuid: expected.providerOperationId,
            operationType,
            amountMinor: positiveMinorString(fiscalOperation.fiscal_operation_amount_minor || fiscalOperation.amount_minor, 'checkbox_service_amount_required'),
            context: {
                eventgenix: true,
                fiscal_profile_id: Number(fiscalOperation.fiscal_profile_id || 0),
                fiscal_operation_id: Number(fiscalOperation.fiscal_operation_id || fiscalOperation.id || 0),
                operation_type: operationType,
                checkbox_shift_id: overrides.providerShiftId || expected.expectedShiftId || null
            }
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
        pinCode: config.pinCode,
        authMode: config.authMode || 'password',
        credentialRef: config.credentialRef,
        licenseRef: config.licenseRef,
        expectedIsTest: config.expectedIsTest,
        tokenCache
    });
}

function refsFromContext(context = {}) {
    const job = context.job || context;
    const licenseRef = normalizeCredentialRef(job.register_credential_ref || job.provider_license_ref || job.checkbox_license_ref);
    const credentialRef = normalizeCredentialRef(job.cashier_credential_ref || job.provider_cashier_login_ref || job.current_provider_cashier_login_ref || job.checkbox_cashier_ref || licenseRef);
    return { credentialRef, licenseRef };
}

function runtimeContextKey({ fiscalProfileId, fiscalRegisterId }) {
    const profileId = Number(fiscalProfileId);
    const registerId = Number(fiscalRegisterId);
    if (!Number.isSafeInteger(profileId) || profileId <= 0 || !Number.isSafeInteger(registerId) || registerId <= 0) return '';
    return `${profileId}:${registerId}`;
}

function createCheckboxProviderFactory({ env = process.env, fetchImpl, tokenCache, allowLocalMockHost = false } = {}) {
    return {
        isEnabled() {
            return isCheckboxIntegrationEnabled(env);
        },
        canResolveRefs({ credentialRef, licenseRef } = {}) {
            if (!this.isEnabled()) return false;
            try {
                loadCheckboxRuntimeConfig({ env, credentialRef, licenseRef, allowLocalMockHost });
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
            const config = loadCheckboxRuntimeConfig({ env, ...refs, allowLocalMockHost });
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
