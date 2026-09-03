-- MIGRATION_KIND: schema
-- SAFETY: Replaces only Checkbox external_stage check constraints with a superset for same-UUID service/return receipt recovery. It does not backfill rows, enable Checkbox, apply fiscal mappings, or call an external provider.
-- ROLLBACK: Disable Cashier PRO, drain/export in-flight service/return receipt jobs, then replace the v345 constraints with the prior v337 allowed-stage constraints after application rollback.
-- OPERATOR_APPROVAL: required

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_payment_outbox_jobs_stage_v337'
           AND conrelid = 'payment_outbox_jobs'::regclass
    ) THEN
        ALTER TABLE payment_outbox_jobs
            DROP CONSTRAINT chk_payment_outbox_jobs_stage_v337;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_payment_outbox_jobs_stage_v345'
           AND conrelid = 'payment_outbox_jobs'::regclass
    ) THEN
        ALTER TABLE payment_outbox_jobs
            ADD CONSTRAINT chk_payment_outbox_jobs_stage_v345
            CHECK (
                external_stage IS NULL
                OR external_stage IN (
                    'auth',
                    'readiness',
                    'shift_request',
                    'shift_request_maybe_submitted',
                    'shift_lookup',
                    'shift_lookup_not_found',
                    'shift_request_retry_same_uuid',
                    'receipt_validation',
                    'sale_submit',
                    'receipt_lookup',
                    'return_submit',
                    'return_lookup',
                    'service_submit',
                    'service_lookup',
                    'complete',
                    'shift_close_request',
                    'shift_close_request_maybe_submitted',
                    'shift_close_lookup',
                    'shift_close_lookup_still_open',
                    'shift_close_retry_exact_shift'
                )
            );
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_fiscal_operations_stage_v337'
           AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            DROP CONSTRAINT chk_fiscal_operations_stage_v337;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_fiscal_operations_stage_v345'
           AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT chk_fiscal_operations_stage_v345
            CHECK (
                external_stage IS NULL
                OR external_stage IN (
                    'auth',
                    'readiness',
                    'shift_request',
                    'shift_request_maybe_submitted',
                    'shift_lookup',
                    'shift_lookup_not_found',
                    'shift_request_retry_same_uuid',
                    'receipt_validation',
                    'sale_submit',
                    'receipt_lookup',
                    'return_submit',
                    'return_lookup',
                    'service_submit',
                    'service_lookup',
                    'complete',
                    'shift_close_request',
                    'shift_close_request_maybe_submitted',
                    'shift_close_lookup',
                    'shift_close_lookup_still_open',
                    'shift_close_retry_exact_shift'
                )
            );
    END IF;
END;
$migration$;

COMMENT ON CONSTRAINT chk_payment_outbox_jobs_stage_v345 ON payment_outbox_jobs IS
    'Allows durable same-UUID service receipt submit/lookup recovery in addition to the prior Checkbox stages.';

COMMENT ON CONSTRAINT chk_fiscal_operations_stage_v345 ON fiscal_operations IS
    'Keeps service receipt recovery stage aligned with the corresponding durable outbox job.';
