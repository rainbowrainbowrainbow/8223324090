'use strict';

const { isDeepStrictEqual } = require('node:util');

const FINANCIAL_KEY_TOKENS = new Set([
    'amount',
    'budget',
    'commission',
    'cost',
    'debt',
    'discount',
    'expense',
    'fee',
    'finance',
    'financial',
    'income',
    'margin',
    'money',
    'monetary',
    'price',
    'profit',
    'refund',
    'revenue',
    'spent',
    'subtotal',
    'tax',
    'turnover'
]);

const FINANCIAL_EXACT_KEYS = new Set([
    'averagecheck',
    'actualtotal',
    'avgcheck',
    'balancedue',
    'cashflow',
    'coefficient',
    'deposittotal',
    'estimatedtotal',
    'finaltotal',
    'grandtotal',
    'gross',
    'kickbackrate',
    'ltv',
    'markup',
    'monetary',
    'mscore',
    'mkexternalrate',
    'net',
    'nexttotal',
    'ordertotal',
    'paymentmethod',
    'pnl',
    'previoustotal',
    'recommendeddepositamount',
    'requiredmenuminimum',
    'rfmscore',
    'rfmsegment',
    'rowtotal',
    'spent1',
    'spent2',
    'totalactual',
    'totalall',
    'totaldue',
    'totalestimated',
    'totalperchild',
    'totalspent'
]);

const BANQUET_FINANCIAL_EXACT_KEYS = new Set([
    'accountingnote',
    'accountingstatus',
    'deposit',
    'depositstatus',
    'duedate',
    'financetransactionid',
    'managernote',
    'managerstatus',
    'payment',
    'paymentmethod',
    'paymentstatus',
    'transactionid',
    'transactionreference',
    'accounting',
    'balance',
    'billing',
    'discounts',
    'invoice',
    'paid',
    'paidamount',
    'paymentdetails',
    'paymentreference',
    'payments',
    'transaction',
    'total',
    'totals'
]);

const BANQUET_FINANCIAL_KEY_PREFIXES = ['accounting', 'deposit', 'payment', 'transaction'];


const MONEY_TEXT_PATTERN = /(?:\d(?:[\d\s.,]*\d)?\s*(?:грн|uah|usd|eur|[₴$€])|[₴$€]\s*\d(?:[\d\s.,]*\d)?)/giu;

function keyParts(key) {
    return String(key || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function normalizedKey(key) {
    return keyParts(key).join('');
}

function isFinancialFieldKey(key) {
    const normalized = normalizedKey(key);
    if (!normalized || normalized === 'deposit') return false;
    if (FINANCIAL_EXACT_KEYS.has(normalized)) return true;
    return keyParts(key).some(part => FINANCIAL_KEY_TOKENS.has(part));
}

function redactMoneyText(value) {
    return String(value).replace(MONEY_TEXT_PATTERN, '[сума прихована]');
}

function parseJsonContainerString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    const looksLikeContainer = (trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (!looksLikeContainer) return null;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function redactRevenueFieldsWithOptions(value, options = {}) {
    const redactText = options.redactText !== false;
    if (typeof value === 'string') {
        const parsedContainer = parseJsonContainerString(value);
        if (parsedContainer) {
            const redactedContainer = redactRevenueFieldsWithOptions(parsedContainer, options);
            if (isDeepStrictEqual(parsedContainer, redactedContainer)) {
                return value;
            }
            const serialized = JSON.stringify(redactedContainer);
            return redactText ? redactMoneyText(serialized) : serialized;
        }
        return redactText ? redactMoneyText(value) : value;
    }
    if (Array.isArray(value)) return value.map(item => redactRevenueFieldsWithOptions(item, options));
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date || Buffer.isBuffer(value)) return value;

    const redacted = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (normalizedKey(key) === 'deposit'
            && (nestedValue === null || typeof nestedValue !== 'object')) {
            continue;
        }
        if (normalizedKey(key) === 'averagecheck' && nestedValue && typeof nestedValue === 'object') {
            const safeAverage = redactRevenueFieldsWithOptions(nestedValue, options);
            if (safeAverage && typeof safeAverage === 'object') {
                delete safeAverage.perChild;
                delete safeAverage.total;
            }
            redacted[key] = safeAverage;
            continue;
        }
        if (isFinancialFieldKey(key)) continue;
        redacted[key] = redactRevenueFieldsWithOptions(nestedValue, options);
    }
    return redacted;
}

function redactRevenueFields(value) {
    return redactRevenueFieldsWithOptions(value, { redactText: true });
}

function redactRevenueFieldKeys(value) {
    return redactRevenueFieldsWithOptions(value, { redactText: false });
}

function parseOptionalRevenueAmount(source = {}, key = 'amount') {
    if (!Object.prototype.hasOwnProperty.call(source || {}, key)) return null;
    const rawValue = source?.[key];
    if (rawValue === null || rawValue === undefined) return null;
    if (typeof rawValue === 'string' && rawValue.trim() === '') return null;
    const amount = Number.parseFloat(rawValue);
    return Number.isFinite(amount) ? amount : null;
}

function shapeRevenuePayload(payload, allowed) {
    return allowed ? payload : redactRevenueFields(payload);
}

function shapeBanquetSummaryForRevenueAccess(summary, allowed) {
    if (allowed) return summary;
    const redacted = redactRevenueFields(summary);
    delete redacted.totals;
    delete redacted.finance;

    if (redacted.deposit && typeof redacted.deposit === 'object') {
        delete redacted.deposit.note;
    }

    redacted.modeContract = {
        ...(summary?.modeContract || {}),
        sections: {
            ...(summary?.modeContract?.sections || {}),
            finance: false
        },
        showPrices: false
    };
    return redacted;
}

function redactBanquetFinancialFields(value) {
    if (typeof value === 'string') {
        const parsedContainer = parseJsonContainerString(value);
        if (!parsedContainer) return value;
        const redactedContainer = redactBanquetFinancialFields(parsedContainer);
        return isDeepStrictEqual(parsedContainer, redactedContainer)
            ? value
            : JSON.stringify(redactedContainer);
    }
    if (Array.isArray(value)) return value.map(redactBanquetFinancialFields);
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date || Buffer.isBuffer(value)) return value;

    const redacted = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        const normalized = normalizedKey(key);
        if (BANQUET_FINANCIAL_EXACT_KEYS.has(normalized) || BANQUET_FINANCIAL_KEY_PREFIXES.some(prefix => normalized.startsWith(prefix))) continue;
        redacted[key] = redactBanquetFinancialFields(nestedValue);
    }
    return redacted;
}

function shapeBanquetGroupForRevenueAccess(snapshot, allowed) {
    if (allowed) return snapshot;
    return redactBanquetFinancialFields(redactRevenueFields(snapshot));
}


function installRevenueResponseShaper(req, res, next, canViewRevenue, options = {}) {
    if (canViewRevenue) return next();
    const sendJson = res.json.bind(res);
    const redact = options.redactText === true
        ? redactRevenueFields
        : redactRevenueFieldKeys;
    res.json = payload => sendJson(
        res.locals?.revenueResponseMode === 'public-catalog' ? payload : redact(payload)
    );
    return next();
}

module.exports = {
    isFinancialFieldKey,
    redactMoneyText,
    redactRevenueFields,
    redactRevenueFieldKeys,
    parseOptionalRevenueAmount,
    shapeRevenuePayload,
    shapeBanquetSummaryForRevenueAccess,
    shapeBanquetGroupForRevenueAccess,
    installRevenueResponseShaper
};
