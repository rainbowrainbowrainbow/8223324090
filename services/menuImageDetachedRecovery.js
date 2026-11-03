'use strict';

const { transitionMenuImageOperation } = require('./menuImagePaidOperations');

function recoveryError(code) {
    return Object.assign(new Error(code), { code });
}

// Store only CRM-normalized request metadata. Call before contacting KIE: an
// interrupted submit still remains in the paid operation ledger as uncertain.
async function saveRecoveryRequest(pool, { operationId, businessContext, productId, studio }) {
    if (!studio || typeof studio !== 'object' || Array.isArray(studio)
        || !businessContext || !productId || !operationId) throw recoveryError('MENU_RECOVERY_INVALID');
    const result = await pool.query(`INSERT INTO menu_image_paid_recovery (operation_id, request_studio)
        SELECT operation_id, $4::jsonb FROM menu_image_paid_operations
        WHERE operation_id=$1 AND business_context=$2 AND product_id=$3
          AND provider='kie' AND status='reserved'
        ON CONFLICT (operation_id) DO NOTHING RETURNING operation_id`,
    [operationId, businessContext, productId, JSON.stringify(studio)]);
    if (!result.rowCount) throw recoveryError('MENU_RECOVERY_CHANGED');
}

// Polling uses the same operation-level lock as the current draft status path.
// The result is durable separately from products: a newer/manual draft is not
// modified. The provider is never asked to generate here.
async function recoverDetachedMenuImage({ pool, operationId, businessContext, productId, poll, store }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(operationId || ''))
        || !businessContext || !productId || typeof poll !== 'function' || typeof store !== 'function') {
        throw recoveryError('MENU_RECOVERY_INVALID');
    }
    const client = await pool.connect();
    const key = `eventgenix:menu-paid-poll:${operationId}`;
    let locked = false, releaseError;
    try {
        locked = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key])).rows[0]?.locked === true;
        if (!locked) throw recoveryError('MENU_PAID_POLL_BUSY');
        const selected = await client.query(`SELECT o.status, o.provider, o.provider_task_id,
                r.request_studio, r.result_studio
            FROM menu_image_paid_operations o JOIN menu_image_paid_recovery r USING (operation_id)
            WHERE o.operation_id=$1 AND o.business_context=$2 AND o.product_id=$3`,
        [operationId, businessContext, productId]);
        const operation = selected.rows[0];
        if (!operation) throw recoveryError('MENU_RECOVERY_NOT_FOUND');
        if (operation.status === 'succeeded' && operation.result_studio) {
            return { status: 'succeeded', studio: operation.result_studio, providerCalled: false };
        }
        if (operation.status !== 'provider_pending' || operation.provider !== 'kie' || !operation.provider_task_id) {
            throw recoveryError('MENU_RECOVERY_NOT_READY');
        }
        const outcome = await poll(operation.provider_task_id);
        if (outcome?.status === 'generating') return { status: 'provider_pending', providerCalled: true };
        if (outcome?.status === 'failed' && outcome.confirmedTerminalFailure === true) {
            await transitionMenuImageOperation(client, { id: operationId, businessContext, from: 'provider_pending',
                to: 'failed', providerTaskId: operation.provider_task_id });
            return { status: 'failed', providerCalled: true };
        }
        if (outcome?.status !== 'ready') throw recoveryError('MENU_PAID_RESULT_UNCERTAIN');
        const studio = await store(outcome, operation.request_studio);
        if (!studio || typeof studio !== 'object' || Array.isArray(studio) || !studio.imageUrl || studio.status !== 'ready') {
            throw recoveryError('MENU_RECOVERY_STORAGE_FAILED');
        }
        await client.query('BEGIN');
        try {
            const saved = await client.query(`UPDATE menu_image_paid_recovery SET result_studio=$2::jsonb, updated_at=NOW()
                WHERE operation_id=$1 AND result_studio IS NULL RETURNING result_studio`, [operationId, JSON.stringify(studio)]);
            if (!saved.rowCount) throw recoveryError('MENU_RECOVERY_CHANGED');
            await transitionMenuImageOperation(client, { id: operationId, businessContext, from: 'provider_pending',
                to: 'succeeded', providerTaskId: operation.provider_task_id });
            await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
        return { status: 'succeeded', studio, providerCalled: true };
    } finally {
        try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]); }
        catch (error) { releaseError = error; throw error; }
        finally { client.release(releaseError); }
    }
}

module.exports = { saveRecoveryRequest, recoverDetachedMenuImage };
