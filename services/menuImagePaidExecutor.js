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
        result = await start();
        if (provider === 'kie') {
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(result?.taskId || ''))) {
                throw new Error('Provider task identity unavailable');
            }
            await transitionMenuImageOperation(pool, { id, businessContext, from: 'reserved',
                to: 'provider_pending', providerTaskId: result.taskId });
            return { operationId: id, status: 'provider_pending', taskId: result.taskId };
        }
        await saveDraft(result, id);
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

module.exports = { executeMenuImagePaid };
