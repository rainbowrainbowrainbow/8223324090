-- MIGRATION_KIND: schema
-- SAFETY: Additive Cashier PRO and multi-FOP isolation hardening only. It adds scoped uniqueness/FKs and one-return guards without enabling PRO, preschool, production Checkbox, or rewriting legacy finance/payment data.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Disable EVENTGENIX_CASHIER_PRO_ENABLED and CHECKBOX_INTEGRATION_ENABLED, inspect affected v326 constraints/indexes, then drop them after application rollback if required.

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_registers_id_profile_location_v326
    ON fiscal_registers (id, fiscal_profile_id, fiscal_location_id);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_cashier_bindings_register_profile_location_v326'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            ADD CONSTRAINT fk_fiscal_cashier_bindings_register_profile_location_v326
            FOREIGN KEY (fiscal_register_id, fiscal_profile_id, fiscal_location_id)
            REFERENCES fiscal_registers(id, fiscal_profile_id, fiscal_location_id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_action_approvals_expiry_required_v326'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT chk_fiscal_action_approvals_expiry_required_v326
            CHECK (expires_at IS NOT NULL);
    END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refunds_one_full_return_per_original_v326
    ON payment_refunds (fiscal_profile_id, original_fiscal_receipt_id)
    WHERE original_fiscal_receipt_id IS NOT NULL
      AND refund_type = 'full';

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_operations_one_return_per_refund_v326
    ON fiscal_operations (fiscal_profile_id, payment_refund_id, operation_type)
    WHERE payment_refund_id IS NOT NULL
      AND operation_type = 'return';

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_outbox_one_return_job_per_refund_v326
    ON payment_outbox_jobs (fiscal_profile_id, payment_refund_id, job_type)
    WHERE payment_refund_id IS NOT NULL
      AND job_type = 'receipt_return';

COMMENT ON INDEX uq_payment_refunds_one_full_return_per_original_v326 IS
    'Cashier PRO MVP permits one full return per original fiscal receipt. Original sale receipt remains immutable.';
