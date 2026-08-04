-- MIGRATION_KIND: schema
-- SAFETY: Additive workflow constraints only. Adds idempotency fingerprint helpers and one-sale-per-payment-order guards without rewriting legacy finance, booking, receipt, or cash register data.
-- ROLLBACK: Disable the payment/fiscal feature flag, drain or export new payment_outbox_jobs/fiscal_operations rows if needed, then drop the v318 indexes after application rollback.

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_operations_one_sale_per_order_v318
    ON fiscal_operations (fiscal_profile_id, payment_order_id)
    WHERE operation_type = 'sale'
      AND payment_order_id IS NOT NULL
      AND status <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_outbox_one_receipt_sell_per_order_v318
    ON payment_outbox_jobs (fiscal_profile_id, payment_order_id)
    WHERE job_type = 'receipt_sell'
      AND payment_order_id IS NOT NULL
      AND status <> 'dead';

COMMENT ON INDEX uq_fiscal_operations_one_sale_per_order_v318 IS
    'A confirmed MVP payment order may create exactly one non-cancelled sale fiscal operation.';

COMMENT ON INDEX uq_payment_outbox_one_receipt_sell_per_order_v318 IS
    'A confirmed MVP payment order may queue exactly one durable receipt_sell outbox job.';
