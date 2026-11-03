'use strict';

const { reserveMenuImageOperation, transitionMenuImageOperation } = require('./menuImagePaidOperations');

// This executor is not yet wired to the menu routes. A reservation is committed
// before any provider call, so a crash never makes an uncertain call retryable.
// For OpenAI, saveDraft must durably save the result before the slot is released.
// KIE returns a durable task ID and retains its slot until a later status check.
async function executeMenuImagePaid({ pool, businessContext, productId, provider, actor, start, saveDraft }) {
    if (typeof start !== 'function' || (provider === 'openai' && typeof saveDraft !== 'function')) {
        throw Object.assign(new Error('Invalid menu execution callbacks'), { code: 'MENU_PAID_OPERATION_INVALID' });
    }
    const id = await reserveMenuImageOperation(pool, { businessContext, productId, provider, actor });
    let result;
    try {
        result = await start(id);
        if (provider === 'kie') {
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(result?.taskId || ''))) {
                throw new Error('Provider task identity unavailable');
            }
            await transitionMenuImageOperation(pool, { id, businessContext, from: 'reserved',
                to: 'provider_pending', providerTaskId: result.taskId });
            return { operationId: id, status: 'provider_pending', taskId: result.taskId };
        }
        if (await saveDraft(result, id) !== true) throw new Error('Draft persistence was not confirmed');
        await transitionMenuImageOperation(pool, { id, businessContext, from: 'reserved', to: 'succeeded' });
        return { operationId: id, status: 'succeeded', result };
    } catch {
        // If persistence itself is unavailable, leave the committed reservation
        // in place; do not mask uncertainty with a retryable provider error.
        try { await transitionMenuImageOperation(pool, { id, businessContext, from: 'reserved', to: 'unknown' }); }
        catch { /* reserved or provider_pending remains a durable blocker */ }
        throw Object.assign(new Error('Provider outcome requires review'), {
            code: 'MENU_PAID_OUTCOME_REQUIRES_REVIEW', operationId: id, retryable: false
        });
    }
}

// Only status reads are allowed here. The operation lock prevents simultaneous
// callers from importing the same result while leaving other jobs unblocked.
async function pollMenuImagePaid({ pool, operationId, businessContext, productId, poll, saveDraft }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(operationId || ''))
        || !businessContext || !productId || typeof poll !== 'function' || typeof saveDraft !== 'function') {
        throw Object.assign(new Error('Invalid menu operation'), { code: 'MENU_PAID_OPERATION_INVALID' });
    }
    const client = await pool.connect();
    const lockKey = `eventgenix:menu-paid-poll:${operationId}`;
    let locked = false;
    let releaseError;
    try {
        const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
        locked = result.rows[0]?.locked === true;
        if (!locked) throw Object.assign(new Error('Operation status check is in progress'), { code: 'MENU_PAID_POLL_BUSY' });
        const selected = await client.query(
            `SELECT status, provider, provider_task_id FROM menu_image_paid_operations
             WHERE operation_id=$1 AND business_context=$2 AND product_id=$3`,
            [operationId, businessContext, productId]
        );
        const operation = selected.rows[0];
        if (!operation) throw Object.assign(new Error('Operation not found'), { code: 'MENU_PAID_OPERATION_NOT_FOUND' });
        if (operation.status !== 'provider_pending' || operation.provider !== 'kie' || !operation.provider_task_id) {
            return { operationId, status: operation.status, providerCalled: false };
        }
        const outcome = await poll(operation.provider_task_id);
        if (outcome?.status === 'generating') return { operationId, status: 'provider_pending', providerCalled: true };
        if (outcome?.status === 'failed' && outcome.confirmedTerminalFailure === true) {
            await transitionMenuImageOperation(client, { id: operationId, businessContext, from: 'provider_pending',
                to: 'failed', providerTaskId: operation.provider_task_id });
            return { operationId, status: 'failed', providerCalled: true };
        }
        if (outcome?.status !== 'ready') {
            throw Object.assign(new Error('Provider result requires review'), { code: 'MENU_PAID_RESULT_UNCERTAIN' });
        }
        // Only explicit confirmation may release an already-paid operation.
        if (await saveDraft(outcome, operationId) !== true) throw new Error('Draft persistence was not confirmed');
        await transitionMenuImageOperation(client, { id: operationId, businessContext, from: 'provider_pending',
            to: 'succeeded', providerTaskId: operation.provider_task_id });
        return { operationId, status: 'succeeded', providerCalled: true };
    } finally {
        try {
            if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
        } catch (error) { releaseError = error; throw error; }
        finally { client.release(releaseError); }
    }
}

module.exports = { executeMenuImagePaid, pollMenuImagePaid };
