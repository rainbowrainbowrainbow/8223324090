'use strict';

const { withProviderExecution, transaction, executionError } = require('./crmProviderExecution');

// An explicit, audited human decision only. It does not request another image.
// Known KIE task IDs must be resolved through status polling, not this path.
async function reconcileMenuImagePaid({ pool, env = process.env, operationId, businessContext, productId,
    actor, reviewNote, providerReviewed, acceptsPossibleCharge }) {
    if (env.CRM_MENU_RECONCILIATION_ENABLED !== 'true') throw executionError('MENU_PAID_RECONCILIATION_DISABLED', 503);
    const note = typeof reviewNote === 'string' ? reviewNote.trim() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(operationId || ''))
        || !businessContext || !productId || !actor || note.length < 20 || note.length > 500
        || /[\u0000-\u001f\u007f]/.test(note) || providerReviewed !== true || acceptsPossibleCharge !== true) {
        throw executionError('MENU_PAID_REVIEW_CONFIRMATION_REQUIRED', 400);
    }
    return withProviderExecution(pool, client => transaction(client, async () => {
        const result = await client.query(`SELECT status, provider_task_id,
                created_at <= NOW() - INTERVAL '10 minutes' AS old_enough
            FROM menu_image_paid_operations
            WHERE operation_id=$1 AND business_context=$2 AND product_id=$3 FOR UPDATE`,
        [operationId, businessContext, productId]);
        const row = result.rows[0];
        if (!row) throw executionError('MENU_PAID_OPERATION_NOT_FOUND', 404);
        if (!['reserved', 'unknown'].includes(row.status) || row.provider_task_id || !row.old_enough) {
            throw executionError('MENU_PAID_RECONCILIATION_NOT_READY');
        }
        await client.query(`INSERT INTO menu_image_paid_operation_reviews
            (operation_id, reviewed_by, review_note, previous_status) VALUES ($1, $2, $3, $4)`,
        [operationId, actor, note, row.status]);
        await client.query(`UPDATE menu_image_paid_operations SET status='reviewed_unknown', updated_at=NOW()
            WHERE operation_id=$1 AND business_context=$2 AND product_id=$3`, [operationId, businessContext, productId]);
        // A manual replacement or a newer draft is never touched.
        const updated = await client.query(`UPDATE products SET ai_card_draft = jsonb_set(
                jsonb_set(ai_card_draft, '{imageStudio,status}', '"failed"'::jsonb),
                '{imageStudio,outcomeUncertain}', 'false'::jsonb), updated_at=NOW(), updated_by=$4
            WHERE id=$1 AND COALESCE(business_context, 'event_genix')=$2
              AND ai_card_draft #>> '{imageStudio,operationId}'=$3
              AND ai_card_draft #>> '{imageStudio,status}'='generating'`,
        [productId, businessContext, operationId, actor]);
        return { operationId, status: 'reviewed_unknown', draftUpdated: updated.rowCount > 0 };
    }));
}

module.exports = { reconcileMenuImagePaid };
