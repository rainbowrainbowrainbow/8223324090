-- MIGRATION_KIND: schema
-- SAFETY: Additive Checkbox payment/fiscal hardening only. Adds immutable sealing metadata, durable provider context snapshots, outbox lease/stage ownership, and stricter one-sale guards. It does not read or rewrite legacy finance_transactions, bookings.paid_amount, receipts, cash_register_shifts, or production business data.
-- ROLLBACK: Disable Checkbox integration, drain/export in-flight payment_outbox_jobs, then drop v323 triggers/functions/indexes/columns after application rollback. Recreate uq_payment_attempts_provider_ref_v316 only if returning to the older global terminal-reference policy.
-- OPERATOR_APPROVAL: required

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS sealed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS seal_fingerprint VARCHAR(128),
    ADD COLUMN IF NOT EXISTS received_amount_minor BIGINT,
    ADD COLUMN IF NOT EXISTS change_amount_minor BIGINT,
    ADD COLUMN IF NOT EXISTS terminal_reference VARCHAR(160);

ALTER TABLE fiscal_operations
    ADD COLUMN IF NOT EXISTS provider_organization_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS provider_outlet_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS provider_register_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS provider_cashier_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS register_credential_ref VARCHAR(160),
    ADD COLUMN IF NOT EXISTS cashier_credential_ref VARCHAR(160),
    ADD COLUMN IF NOT EXISTS expected_is_test BOOLEAN,
    ADD COLUMN IF NOT EXISTS fiscal_configuration_hash VARCHAR(128),
    ADD COLUMN IF NOT EXISTS fiscal_location_id BIGINT,
    ADD COLUMN IF NOT EXISTS external_stage VARCHAR(40);

ALTER TABLE payment_outbox_jobs
    ADD COLUMN IF NOT EXISTS lock_token UUID,
    ADD COLUMN IF NOT EXISTS lock_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS external_stage VARCHAR(40);

ALTER TABLE fiscal_shifts
    ADD COLUMN IF NOT EXISTS lifecycle_stage VARCHAR(32) NOT NULL DEFAULT 'CREATED';

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_orders_seal_amounts_v323'
          AND conrelid = 'payment_orders'::regclass
    ) THEN
        ALTER TABLE payment_orders
            ADD CONSTRAINT chk_payment_orders_seal_amounts_v323
            CHECK (
                (received_amount_minor IS NULL OR received_amount_minor >= total_amount_minor)
                AND (change_amount_minor IS NULL OR change_amount_minor >= 0)
                AND (
                    received_amount_minor IS NULL
                    OR change_amount_minor = received_amount_minor - total_amount_minor
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_outbox_jobs_lock_v323'
          AND conrelid = 'payment_outbox_jobs'::regclass
    ) THEN
        ALTER TABLE payment_outbox_jobs
            ADD CONSTRAINT chk_payment_outbox_jobs_lock_v323
            CHECK (
                (status NOT IN ('claimed', 'running'))
                OR (locked_by IS NOT NULL AND locked_at IS NOT NULL AND lock_token IS NOT NULL)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_outbox_jobs_stage_v323'
          AND conrelid = 'payment_outbox_jobs'::regclass
    ) THEN
        ALTER TABLE payment_outbox_jobs
            ADD CONSTRAINT chk_payment_outbox_jobs_stage_v323
            CHECK (
                external_stage IS NULL
                OR external_stage IN (
                    'auth',
                    'readiness',
                    'shift_request',
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

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_operations_stage_v323'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT chk_fiscal_operations_stage_v323
            CHECK (
                external_stage IS NULL
                OR external_stage IN (
                    'auth',
                    'readiness',
                    'shift_request',
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

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_shifts_lifecycle_stage_v323'
          AND conrelid = 'fiscal_shifts'::regclass
    ) THEN
        ALTER TABLE fiscal_shifts
            ADD CONSTRAINT chk_fiscal_shifts_lifecycle_stage_v323
            CHECK (lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING', 'CLOSED'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_operations_location_profile_v323'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT fk_fiscal_operations_location_profile_v323
            FOREIGN KEY (fiscal_location_id, fiscal_profile_id)
            REFERENCES fiscal_locations(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_operations_one_sale_per_order_forever_v323
    ON fiscal_operations (fiscal_profile_id, payment_order_id)
    WHERE operation_type = 'sale'
      AND payment_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_outbox_one_receipt_sell_per_order_forever_v323
    ON payment_outbox_jobs (fiscal_profile_id, payment_order_id)
    WHERE job_type = 'receipt_sell'
      AND payment_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_outbox_operation_type_forever_v323
    ON payment_outbox_jobs (fiscal_profile_id, fiscal_operation_id, job_type)
    WHERE fiscal_operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_outbox_jobs_claim_v323
    ON payment_outbox_jobs (status, next_run_at, priority, id)
    WHERE status IN ('queued', 'failed');

DROP INDEX IF EXISTS uq_payment_attempts_provider_ref_v316;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_terminal_reference_v323
    ON payment_attempts (fiscal_profile_id, provider, provider_payment_reference)
    WHERE provider_payment_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_payment_order_sealed_update_v323()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.sealed_at IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot
       OR NEW.confirmation_snapshot IS DISTINCT FROM OLD.confirmation_snapshot
       OR NEW.fiscal_profile_id IS DISTINCT FROM OLD.fiscal_profile_id
       OR NEW.fiscal_register_id IS DISTINCT FROM OLD.fiscal_register_id
       OR NEW.cashier_user_id IS DISTINCT FROM OLD.cashier_user_id
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.order_key IS DISTINCT FROM OLD.order_key
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.total_amount_minor IS DISTINCT FROM OLD.total_amount_minor
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
       OR NEW.seal_fingerprint IS DISTINCT FROM OLD.seal_fingerprint
       OR NEW.received_amount_minor IS DISTINCT FROM OLD.received_amount_minor
       OR NEW.change_amount_minor IS DISTINCT FROM OLD.change_amount_minor
       OR NEW.terminal_reference IS DISTINCT FROM OLD.terminal_reference THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'sealed payment order immutable snapshot cannot be changed';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_payment_order_sealed_update_v323'
          AND tgrelid = 'payment_orders'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payment_order_sealed_update_v323
        BEFORE UPDATE
        ON payment_orders
        FOR EACH ROW
        EXECUTE FUNCTION prevent_payment_order_sealed_update_v323();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_payment_order_item_insert_after_seal_v323()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    order_sealed_at TIMESTAMPTZ;
    order_status TEXT;
BEGIN
    SELECT sealed_at, status
      INTO order_sealed_at, order_status
      FROM payment_orders
     WHERE id = NEW.payment_order_id
       AND fiscal_profile_id = NEW.fiscal_profile_id;

    IF order_sealed_at IS NOT NULL OR order_status <> 'draft' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'payment order item snapshots cannot be inserted after payment order sealing';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_payment_order_item_insert_after_seal_v323'
          AND tgrelid = 'payment_order_items'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payment_order_item_insert_after_seal_v323
        BEFORE INSERT
        ON payment_order_items
        FOR EACH ROW
        EXECUTE FUNCTION prevent_payment_order_item_insert_after_seal_v323();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_fiscal_audit_mutation_v323()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'fiscal audit events are append-only';
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_fiscal_audit_append_only_v323'
          AND tgrelid = 'fiscal_audit_events'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_audit_append_only_v323
        BEFORE UPDATE OR DELETE
        ON fiscal_audit_events
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_audit_mutation_v323();
    END IF;
END;
$migration$;

COMMENT ON COLUMN payment_orders.sealed_at IS
    'Set when money is confirmed. After this point source snapshot, items, fiscal mapping, amounts, tender, profile/register, provider context, and idempotency identity are immutable.';

COMMENT ON COLUMN fiscal_operations.fiscal_configuration_hash IS
    'Immutable hash of fiscal provider mapping and credential references captured at operation creation; worker fails closed on drift.';

COMMENT ON COLUMN payment_outbox_jobs.lock_token IS
    'Per-claim lease token used with locked_by/attempts/lock_version so stale workers cannot finalize another lease.';
