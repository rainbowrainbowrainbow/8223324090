'use strict';

const { executionError, requireExecutionEnabled, withProviderExecution } = require('./crmProviderExecution');

// Deliberately not scheduled or wired to Telegram. An operator must confirm
// cutover and supply an owner-only route adapter before any real delivery.
function createNotificationDelivery(options = {}) {
    const env = options.env || process.env;
    return async function deliver({ eventId, businessContext, confirmed }) {
        requireExecutionEnabled(env, 'CRM_TASK_DELIVERY_ENABLED');
        requireExecutionEnabled(env, 'CRM_TASK_DELIVERY_CUTOVER_CONFIRMED');
        if (confirmed !== true || !businessContext) throw executionError('CRM_DELIVERY_CONTEXT_REQUIRED', 400);
        const cutoff = Date.parse(env.CRM_TASK_DELIVERY_NOT_BEFORE || '');
        const approved = new Set(String(env.CRM_TASK_DELIVERY_APPROVED_EVENT_IDS || '').split(',').filter(Boolean));
        if (!Number.isFinite(cutoff) || !approved.has(eventId)) throw executionError('CRM_DELIVERY_EVENT_NOT_APPROVED', 403);
        if (!options.transport || !options.resolveRecipient) throw executionError('CRM_DELIVERY_ADAPTER_NOT_CONFIGURED', 503);
        const pool = options.pool || require('../db').pool;
        const outbox = options.outbox || require('./notificationOutbox');
        return withProviderExecution(pool, async client => {
            const event = await outbox.findNotificationOutboxEventByEventId(eventId, { pool: client });
            if (!event) throw executionError('CRM_DELIVERY_EVENT_NOT_FOUND', 404);
            const task = await client.query('SELECT business_context FROM tasks WHERE id = $1', [event.task_id]);
            if ((task.rows[0]?.business_context || 'event_genix') !== businessContext || !task.rows.length) {
                throw executionError('CRM_DELIVERY_BUSINESS_FORBIDDEN', 403);
            }
            if (event.status === 'sent') return { status: 'already_sent', sendAttempted: false };
            if (Date.parse(event.created_at) < cutoff || !Number.isFinite(Date.parse(event.created_at))) {
                throw executionError('CRM_DELIVERY_BACKLOG_REQUIRES_REVIEW');
            }
            const recipient = await options.resolveRecipient(event.owner_user_id, { client, businessContext });
            // Telegram user DMs have positive numeric IDs. Groups/channels and
            // routes for another owner are never an automatic fallback.
            if (Number(recipient?.ownerUserId) !== Number(event.owner_user_id)
                || !/^[1-9][0-9]*$/.test(String(recipient?.chatId || ''))) {
                throw executionError('CRM_DELIVERY_PERSONAL_ROUTE_REQUIRED', 422);
            }
            const workerId = 'crm-task-delivery';
            await outbox.claimNotificationOutboxEvent(eventId, { workerId, lockSeconds: 120 }, { pool: client });
            let response;
            try {
                // The adapter must honor the timeout and must not retry an
                // ambiguous network outcome. No raw provider error is persisted.
                response = await options.transport({ event, recipient,
                    idempotencyKey: eventId, signal: AbortSignal.timeout(15000) });
                if (response?.accepted !== true) {
                    if (response?.definitelyNotSent === true) {
                        const failed = await outbox.failNotificationOutboxEvent(eventId, {
                            workerId, errorMessage: 'CRM delivery rejected before send', errorCode: 'CRM_DELIVERY_REJECTED',
                            retryable: response.retryable !== false
                        }, { pool: client });
                        return { status: failed?.event?.status === 'dead_letter' ? 'dead_letter' : 'retry_scheduled', sendAttempted: true };
                    }
                    throw executionError('CRM_DELIVERY_OUTCOME_UNKNOWN');
                }
                await outbox.ackNotificationOutboxEvent(eventId, {
                    workerId, channel: 'telegram', target: String(recipient.chatId)
                }, { pool: client });
                return { status: 'sent', sendAttempted: true };
            } catch {
                // Ambiguous sends/ack failures must not become automatic retries.
                // If DB is unavailable too, leave the claim and require operator
                // reconciliation before any consumer is allowed to reclaim it.
                await client.query(`UPDATE notification_outbox SET status = 'dead_letter',
                    last_error_code = 'CRM_DELIVERY_OUTCOME_UNKNOWN',
                    last_error = 'Delivery requires manual reconciliation', updated_at = NOW()
                    WHERE event_id = $1 AND status = 'claimed' AND claimed_by = $2`, [eventId, workerId]);
                throw executionError('CRM_DELIVERY_OUTCOME_UNKNOWN', 502);
            }
        }, 'crm_task_delivery');
    };
}

module.exports = { createNotificationDelivery };
