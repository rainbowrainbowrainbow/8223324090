'use strict';

const DEFAULT_CURRENCY = 'UAH';
const SCALE = 100n;
const MINOR_UNIT_PATTERN = /^-?\d+$/;
const UAH_DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

function assertUahCurrency(currency = DEFAULT_CURRENCY) {
    if (currency !== DEFAULT_CURRENCY) {
        throw new Error(`Unsupported currency: ${currency}`);
    }
}

function normalizeMinorUnits(value, options = {}) {
    const { allowNegative = false, allowZero = true } = options;
    let amount;

    if (typeof value === 'bigint') {
        amount = value;
    } else if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw new Error('Minor-unit number must be a safe integer');
        }
        amount = BigInt(value);
    } else if (typeof value === 'string') {
        const text = value.trim();
        if (!MINOR_UNIT_PATTERN.test(text)) {
            throw new Error('Minor-unit string must contain only an integer value');
        }
        amount = BigInt(text);
    } else {
        throw new Error('Minor-unit value must be a bigint, safe integer, or integer string');
    }

    if (!allowNegative && amount < 0n) {
        throw new Error('Minor-unit amount cannot be negative');
    }
    if (!allowZero && amount === 0n) {
        throw new Error('Minor-unit amount cannot be zero');
    }
    return amount;
}

function uahDecimalToMinorUnits(value) {
    if (typeof value !== 'string') {
        throw new Error('UAH decimal amount must be provided as a string to avoid floating point drift');
    }

    const text = value.trim();
    const match = text.match(UAH_DECIMAL_PATTERN);
    if (!match) {
        throw new Error('UAH decimal amount must have at most two decimal places');
    }

    const [, sign, whole, cents = ''] = match;
    const wholeMinor = BigInt(whole) * SCALE;
    const centMinor = BigInt(cents.padEnd(2, '0'));
    const amount = wholeMinor + centMinor;
    return sign === '-' ? -amount : amount;
}

function minorUnitsToUahDecimal(value) {
    const amount = normalizeMinorUnits(value, { allowNegative: true });
    const sign = amount < 0n ? '-' : '';
    const absolute = amount < 0n ? -amount : amount;
    const whole = absolute / SCALE;
    const cents = String(absolute % SCALE).padStart(2, '0');
    return `${sign}${whole}.${cents}`;
}

function sumMinorUnits(values, options = {}) {
    if (!Array.isArray(values)) {
        throw new Error('sumMinorUnits expects an array');
    }
    return values.reduce(
        (total, value) => total + normalizeMinorUnits(value, { allowNegative: true }),
        0n
    );
}

function toPostgresBigint(value, options = {}) {
    return normalizeMinorUnits(value, options).toString();
}

module.exports = {
    DEFAULT_CURRENCY,
    assertUahCurrency,
    minorUnitsToUahDecimal,
    normalizeMinorUnits,
    sumMinorUnits,
    toPostgresBigint,
    uahDecimalToMinorUnits
};
