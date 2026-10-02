'use strict';

const MAX_FINANCE_AMOUNT = 2147483647; // finance_transactions.amount is PostgreSQL INTEGER.

function normalizeFinanceTransactionAmount(value) {
    const input = typeof value === 'string' ? value.trim() : value;
    const validType = typeof input === 'number'
        || (typeof input === 'string' && /^\d+$/.test(input));
    const amount = validType ? Number(input) : NaN;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_FINANCE_AMOUNT) {
        const error = new Error('amount must be a positive integer within the supported range');
        error.status = 400;
        error.code = 'finance_amount_invalid';
        throw error;
    }
    return amount;
}

module.exports = { MAX_FINANCE_AMOUNT, normalizeFinanceTransactionAmount };
