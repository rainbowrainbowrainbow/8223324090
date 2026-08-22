-- MIGRATION_KIND: schema
-- SAFETY: Replaces only Checkbox external_stage check constraints with a superset required for bounded same-UUID open recovery and exact-shift close recovery. It does not backfill data, enable Checkbox, apply fiscal mapping, or mutate finance/booking records.
-- ROLLBACK: Disable Checkbox integration, drain or export in-flight Checkbox jobs, then replace v337 constraints with the prior v330 allowed-stage constraints after application rollback.
-- OPERATOR_APPROVAL: required

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_payment_outbox_jobs_stage_v330'
          AND conrelid = 'payment_outbox_jobs'::regclass
    ) THEN
        ALTER TABLE payment_outbox_jobs
            DROP CONSTRAINT chk_payment_outbox_jobs_stage_v330;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_payment_outbox_jobs_stage_v337'
          AND conrelid = 'payment_outbox_jobs'::regclass
    ) THEN
        ALTER TABLE payment_outbox_jobs
            ADD CONSTRAINT chk_payment_outbox_jobs_stage_v337
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
        WHERE conname = 'chk_fiscal_operations_stage_v330'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            DROP CONSTRAINT chk_fiscal_operations_stage_v330;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_fiscal_operations_stage_v337'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT chk_fiscal_operations_stage_v337
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

COMMENT ON CONSTRAINT chk_payment_outbox_jobs_stage_v337 ON payment_outbox_jobs IS
    'Allows durable bounded Checkbox shift recovery stages while preserving fail-closed stage validation.';

COMMENT ON CONSTRAINT chk_fiscal_operations_stage_v337 ON fiscal_operations IS
    'Keeps fiscal operation recovery stage aligned with the corresponding durable outbox job.';
