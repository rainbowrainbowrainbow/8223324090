'use strict';

const { randomUUID } = require('node:crypto');

const ACTIVE_STATUSES = "('reserved', 'provider_pending', 'unknown')";
// A single deployment-wide policy avoids one caller raising the shared budget.
const MAX_OUTSTANDING = 2;
function operationError(code, statusCode = 409) {
    return Object.assign(new Error(code), { code, statusCode });
}

// Use a single short transaction for budget check and reservation. Never hold a
// transaction while waiting for a provider. Unknown outcomes count indefinitely.
async function reserveMenuImageOperation(pool, { businessContext, productId, provider, actor }) {
    if (!businessContext || !productId || !actor || !['openai', 'kie'].includes(provider)) {
        throw operationError('MENU_PAID_OPERATION_INVALID', 400);
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('eventgenix:menu-paid-operation-budget:v1'))");
        const existing = await client.query(
            `SELECT operation_id, status, provider, provider_task_id FROM menu_image_paid_operations
             WHERE business_context = $1 AND product_id = $2 AND status IN ${ACTIVE_STATUSES}`,
            [businessContext, productId]
        );
        if (existing.rowCount) throw operationError('MENU_PAID_OPERATION_REQUIRES_REVIEW');
        const count = await client.query(
            `SELECT count(*)::integer AS count FROM menu_image_paid_operations WHERE status IN ${ACTIVE_STATUSES}`
        );
        if (count.rows[0].count >= MAX_OUTSTANDING) throw operationError('MENU_PAID_OPERATION_BUDGET_FULL', 429);
        const id = randomUUID();
        await client.query(
            `INSERT INTO menu_image_paid_operations
                (operation_id, business_context, product_id, provider, status, created_by)
             VALUES ($1, $2, $3, $4, 'reserved', $5)`,
            [id, businessContext, productId, provider, actor]
        );
        await client.query('COMMIT');
        return id;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}

// Only a matching current state may advance. A caller must classify outcomes
// conservatively; these primitives never infer success/failure from elapsed time.
async function transitionMenuImageOperation(queryable, { id, businessContext, from, to, providerTaskId = null }) {
    const allowed = new Set(['reserved:provider_pending', 'reserved:unknown', 'reserved:succeeded',
        'reserved:failed', 'provider_pending:unknown', 'provider_pending:succeeded',
        'provider_pending:failed', 'unknown:provider_pending']);
    if (!id || !businessContext || !allowed.has(`${from}:${to}`)
        || (providerTaskId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(providerTaskId))) {
        throw operationError('MENU_PAID_OPERATION_INVALID', 400);
    }
    const result = await queryable.query(
        `UPDATE menu_image_paid_operations SET status = $4,
            provider_task_id = COALESCE($5, provider_task_id), updated_at = NOW()
         WHERE operation_id = $1 AND business_context = $2 AND status = $3
           AND ($5::text IS NULL OR provider_task_id IS NULL OR provider_task_id = $5)
         RETURNING operation_id, status, provider_task_id`,
        [id, businessContext, from, to, providerTaskId]
    );
    if (!result.rowCount) throw operationError('MENU_PAID_OPERATION_CHANGED');
    return result.rows[0];
}

module.exports = { reserveMenuImageOperation, transitionMenuImageOperation };
