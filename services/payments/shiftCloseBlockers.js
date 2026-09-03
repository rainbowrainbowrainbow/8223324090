'use strict';

async function countFiscalShiftCloseBlockers(client, { fiscalProfileId, fiscalRegisterId } = {}) {
    const result = await client.query(
        `WITH blocking_orders AS (
             SELECT po.id
               FROM payment_orders po
              WHERE po.fiscal_profile_id = $1
                AND po.fiscal_register_id = $2
                AND po.payment_status = 'confirmed'
                AND po.fiscal_status <> 'fiscalized'
         ),
         blocking_refunds AS (
             SELECT refund.id
               FROM payment_refunds refund
               JOIN payment_orders po
                 ON po.id = refund.payment_order_id
                AND po.fiscal_profile_id = refund.fiscal_profile_id
              WHERE refund.fiscal_profile_id = $1
                AND COALESCE(refund.fiscal_register_id, po.fiscal_register_id) = $2
                AND NOT (
                    (refund.status = 'cancelled'
                     AND refund.money_refund_status = 'not_started'
                     AND refund.fiscal_refund_status = 'not_started')
                    OR
                    (refund.status = 'fiscal_returned'
                     AND refund.money_refund_status = 'refunded'
                     AND refund.fiscal_refund_status = 'returned')
                )
         ),
         blocking_operations AS (
             SELECT operation.id
               FROM fiscal_operations operation
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND operation.status IN (
                    'pending', 'validating', 'ready_to_send', 'sending',
                    'validation_failed', 'failed', 'unknown', 'blocked'
                )
         ),
         blocking_jobs AS (
             SELECT job.id
               FROM payment_outbox_jobs job
               LEFT JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
               LEFT JOIN payment_orders payment_order
                 ON payment_order.id = job.payment_order_id
                AND payment_order.fiscal_profile_id = job.fiscal_profile_id
               LEFT JOIN payment_refunds refund
                 ON refund.id = job.payment_refund_id
                AND refund.fiscal_profile_id = job.fiscal_profile_id
               LEFT JOIN payment_orders refund_order
                 ON refund_order.id = refund.payment_order_id
                AND refund_order.fiscal_profile_id = refund.fiscal_profile_id
              WHERE job.fiscal_profile_id = $1
                AND job.job_type IN (
                    'receipt_validate', 'receipt_sell', 'receipt_status_lookup',
                    'receipt_return', 'service_receipt', 'shift_open', 'shift_close'
                )
                AND job.status IN ('queued', 'claimed', 'running', 'failed', 'dead')
                AND (
                    operation.fiscal_register_id = $2
                    OR payment_order.fiscal_register_id = $2
                    OR COALESCE(refund.fiscal_register_id, refund_order.fiscal_register_id) = $2
                    OR (
                        operation.id IS NULL
                        AND payment_order.id IS NULL
                        AND refund.id IS NULL
                    )
                )
         )
         SELECT (
             (SELECT COUNT(*) FROM blocking_orders)
             + (SELECT COUNT(*) FROM blocking_refunds)
             + (SELECT COUNT(*) FROM blocking_operations)
             + (SELECT COUNT(*) FROM blocking_jobs)
         )::integer AS blocker_count`,
        [fiscalProfileId, fiscalRegisterId]
    );
    return Number(result.rows[0]?.blocker_count || 0);
}

module.exports = {
    countFiscalShiftCloseBlockers
};
