'use strict';

const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');

function normalizeHistoryAction(action) {
    const value = String(action || '').trim();
    if (!value || value.length > 64) return null;
    return value;
}

function historyActorFromRequest(req) {
    return req?.user?.username || req?.user?.name || `user:${req?.user?.id || 'unknown'}`;
}

function normalizeHistoryData(data, businessContext) {
    const base = data && typeof data === 'object' && !Array.isArray(data)
        ? { ...data }
        : { value: data ?? null };
    base.business_context = businessContext;
    return base;
}

async function insertHistory(queryable, { businessContext, action, username, data }) {
    const scopedContext = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
    const normalizedAction = normalizeHistoryAction(action);
    if (!normalizedAction) {
        const error = new Error('Invalid history action');
        error.code = 'INVALID_HISTORY_ACTION';
        throw error;
    }

    await queryable.query(
        'INSERT INTO history (business_context, action, username, data) VALUES ($1, $2, $3, $4)',
        [
            scopedContext,
            normalizedAction,
            username || 'system',
            JSON.stringify(normalizeHistoryData(data, scopedContext))
        ]
    );
}

module.exports = {
    historyActorFromRequest,
    insertHistory,
    normalizeHistoryAction,
    normalizeHistoryData
};
