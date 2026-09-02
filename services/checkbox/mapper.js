'use strict';

const { CheckboxClientError } = require('./errors');

function asPositiveMinor(value, code = 'checkbox_amount_invalid') {
    try {
        const minor = BigInt(String(value));
        if (minor <= 0n) throw new Error(code);
        if (minor > 99999999999n) throw new Error(code);
        return Number(minor);
    } catch {
        throw new CheckboxClientError(code, 'Checkbox amount must be a positive integer in minor UAH units', { status: 400 });
    }
}

function requiredText(value, code) {
    const text = String(value || '').trim();
    if (!text) throw new CheckboxClientError(code, `${code} is required`, { status: 400 });
    return text;
}

function normalizePaymentLabel(payment = {}) {
    if (payment.type === 'CASHLESS') return { ...payment, label: 'Картка' };
    if (payment.type === 'CASH') return { ...payment, label: 'Готівка' };
    return payment;
}

function mapReceiptGood(item = {}) {
    const name = requiredText(item.name || item.itemName, 'checkbox_good_name_required');
    const code = requiredText(item.code || item.itemCode || name, 'checkbox_good_code_required');
    const price = asPositiveMinor(item.priceMinor || item.unitPriceMinor || item.totalAmountMinor, 'checkbox_good_price_required');
    const quantity = Number(item.quantityMillis || item.quantity || 1000);
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new CheckboxClientError('checkbox_good_quantity_invalid', 'Checkbox quantity must be positive integer millis', { status: 400 });
    }
    const good = { code, name, price };
    const tax = item.tax || item.providerTaxId || item.taxCode;
    const taxIds = tax == null || tax === '' ? [] : (Array.isArray(tax) ? tax : [tax]);
    if (taxIds.some(value => String(value || '').match(/^admission_tariff:/i))) {
        throw new CheckboxClientError('checkbox_internal_tax_reference_forbidden', 'Internal admission tariff reference must not be sent as Checkbox tax', { status: 422, retryable: false });
    }
    if (taxIds.length > 2 || taxIds.some(value => !['string', 'number'].includes(typeof value) || String(value).trim() === '')) {
        throw new CheckboxClientError('checkbox_good_tax_invalid', 'Checkbox good tax must contain at most two provider tax IDs', { status: 422, retryable: false });
    }
    if (taxIds.length) good.tax = taxIds;
    return {
        good,
        quantity,
        is_return: Boolean(item.isReturn || item.is_return)
    };
}

function mapPayment({ tender, amountMinor, receivedAmountMinor = null }) {
    const value = asPositiveMinor(
        tender === 'cash' && receivedAmountMinor != null ? receivedAmountMinor : amountMinor,
        'checkbox_payment_amount_required'
    );
    if (tender === 'card_terminal_manual' || tender === 'card_terminal' || tender === 'cashless') {
        return { type: 'CASHLESS', value, label: 'Картка' };
    }
    return { type: 'CASH', value, label: 'Готівка' };
}

function mapSaleReceipt({ providerRequestUuid, items = [], tender = 'cash', amountMinor, receivedAmountMinor = null, callbackUrl = null, context = {} }) {
    const id = requiredText(providerRequestUuid, 'checkbox_provider_request_uuid_required');
    const goods = items.map(mapReceiptGood);
    if (!goods.length) throw new CheckboxClientError('checkbox_goods_required', 'Checkbox sale requires at least one immutable item', { status: 400 });
    const total = amountMinor || goods.reduce((sum, item) => sum + BigInt(item.good.price) * BigInt(item.quantity) / 1000n, 0n).toString();
    if (tender === 'cash' && receivedAmountMinor != null && BigInt(String(receivedAmountMinor)) < BigInt(String(total))) {
        throw new CheckboxClientError('checkbox_cash_received_less_than_total', 'Cash payment received amount must be at least the order total', { status: 422, retryable: false });
    }
    const payload = {
        id,
        goods,
        payments: [normalizePaymentLabel(mapPayment({ tender, amountMinor: total, receivedAmountMinor }))],
        context: { eventgenix: true, ...context }
    };
    if (callbackUrl) payload.callback_url = callbackUrl;
    return payload;
}

function mapFullReturnReceipt({ providerRequestUuid, originalReceiptId, originalSalePayload, callbackUrl = null, context = {} }) {
    const id = requiredText(providerRequestUuid, 'checkbox_provider_request_uuid_required');
    const related = requiredText(originalReceiptId, 'checkbox_original_receipt_id_required');
    const sale = originalSalePayload || {};
    const goods = (sale.goods || []).map(item => ({ ...item, is_return: true }));
    if (!goods.length) throw new CheckboxClientError('checkbox_return_goods_required', 'Checkbox full return requires original sale goods snapshot', { status: 400 });
    const total = goods.reduce((sum, item) => sum + BigInt(item.good?.price || 0) * BigInt(item.quantity || 1000) / 1000n, 0n).toString();
    const payment = normalizePaymentLabel(sale.payments?.[0] || mapPayment({ tender: 'cash', amountMinor: total }));
    const payload = {
        id,
        related_receipt_id: related,
        goods,
        payments: [normalizePaymentLabel({ ...payment, value: asPositiveMinor(payment.value || total, 'checkbox_return_payment_amount_required') })],
        context: { eventgenix: true, return_type: 'full', ...context }
    };
    if (callbackUrl) payload.callback_url = callbackUrl;
    return payload;
}

function mapServiceReceipt({ providerRequestUuid, operationType, amountMinor, context = {} }) {
    const id = requiredText(providerRequestUuid, 'checkbox_provider_request_uuid_required');
    const value = asPositiveMinor(amountMinor, 'checkbox_service_amount_required');
    const type = String(operationType || '').trim();
    const operation = type === 'service_out' ? 'COLLECTION' : 'REINFORCEMENT';
    return {
        id,
        payment: normalizePaymentLabel({
            type: 'CASH',
            value,
            label: 'Готівка',
            operation_type: operation
        }),
        context: { eventgenix: true, operation_type: type || 'service_in', ...context }
    };
}

module.exports = {
    asPositiveMinor,
    mapFullReturnReceipt,
    mapReceiptGood,
    mapSaleReceipt,
    mapServiceReceipt
};
