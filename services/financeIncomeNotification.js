'use strict';

const { loadLegacyBusinessSurfaceAccess } = require('./legacyBusinessSurface');

function blocked() {
    return Object.assign(new Error('Income notification requires migrated business-owned rules and destinations.'),
        { code: 'finance_notifications_not_migrated' });
}

function unavailable() {
    return Object.assign(new Error('Income notification ownership could not be verified.'),
        { code: 'finance_notification_scope_unavailable' });
}

// This is containment of the existing global rule namespace, not a tenant job
// migration. Validate the stored source on every attempt before reading rules.
async function assertFinanceIncomeNotificationScope(db, input) {
    let payload = input;
    if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { throw blocked(); }
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw blocked();
    const { transactionId, businessContext } = payload;
    if (!['string', 'number'].includes(typeof transactionId)
        || !/^[1-9][0-9]*$/.test(String(transactionId)) || !Number.isSafeInteger(Number(transactionId))
        || typeof businessContext !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(businessContext)) throw blocked();

    let result;
    try {
        result = await db.query("SELECT id, business_context FROM finance_transactions WHERE id = $1 AND type = 'income'", [transactionId]);
    } catch { throw unavailable(); }
    if (result.rows.length !== 1 || result.rows[0].business_context !== businessContext) throw blocked();
    const access = await loadLegacyBusinessSurfaceAccess(db, businessContext, 'finance_notifications');
    if (!access.available) throw access.status === 503 ? unavailable() : blocked();
}

module.exports = { assertFinanceIncomeNotificationScope };
