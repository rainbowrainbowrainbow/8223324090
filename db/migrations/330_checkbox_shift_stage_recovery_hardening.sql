-- MIGRATION_KIND: schema
-- SAFETY: Additive Checkbox outbox stage hardening only. Extends allowed external_stage values for durable shift recovery and does not apply production mapping, run fiscal mutations, or alter legacy finance tables.
-- ROLLBACK: Disable Checkbox integration, drain/export in-flight Checkbox jobs, then drop v330 constraints and restore v323 stage constraints after application rollback.
-- OPERATOR_APPROVAL: required

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_outbox_jobs_stage_v323'
          AND conrelid = 'payment_outbox_jobs'::regclass
    ) THEN
        ALTER TABLE payment_outbox_jobs
            DROP CONSTRAINT chk_payment_outbox_jobs_stage_v323;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_outbox_jobs_stage_v330'
          AND conrelid = 'payment_outbox_jobs'::regclass
    ) THEN
        ALTER TABLE payment_outbox_jobs
            ADD CONSTRAINT chk_payment_outbox_jobs_stage_v330
            CHECK (
                external_stage IS NULL
                OR external_stage IN (
                    'auth',
                    'readiness',
                    'shift_request',
                    'shift_request_maybe_submitted',
                    'shift_lookup',
                    'receipt_validation',
                    'sale_submit',
                    'receipt_lookup',
                    'complete',
                    'shift_close_request',
                    'shift_close_lookup'
                )
            );
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_operations_stage_v323'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            DROP CONSTRAINT chk_fiscal_operations_stage_v323;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_operations_stage_v330'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT chk_fiscal_operations_stage_v330
            CHECK (
                external_stage IS NULL
                OR external_stage IN (
                    'auth',
                    'readiness',
                    'shift_request',
                    'shift_request_maybe_submitted',
                    'shift_lookup',
                    'receipt_validation',
                    'sale_submit',
                    'receipt_lookup',
                    'complete',
                    'shift_close_request',
                    'shift_close_lookup'
                )
            );
    END IF;
END;
$migration$;

ALTER TABLE fiscal_operational_incidents
    ADD COLUMN IF NOT EXISTS recurrence_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN fiscal_operational_incidents.recurrence_count IS
    'Number of times a resolved incident reopened with the same idempotency key.';

COMMENT ON COLUMN fiscal_operational_incidents.last_seen_at IS
    'Last time the same operational incident key was observed.';
