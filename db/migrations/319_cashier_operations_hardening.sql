-- MIGRATION_KIND: schema
-- SAFETY: Additive cashier operations hardening only. Adds refund status split and append-only reconciliation revisions without rewriting existing fiscal/payment rows or enabling production Checkbox.
-- ROLLBACK: Disable cashier operations routes/feature flags, export new fiscal_reconciliation_revisions if needed, then drop the v319 table/columns after application rollback.

ALTER TABLE payment_refunds
    ADD COLUMN IF NOT EXISTS fiscal_register_id BIGINT,
    ADD COLUMN IF NOT EXISTS fiscal_shift_id BIGINT,
    ADD COLUMN IF NOT EXISTS fiscal_operation_id BIGINT,
    ADD COLUMN IF NOT EXISTS refund_type VARCHAR(32) NOT NULL DEFAULT 'full',
    ADD COLUMN IF NOT EXISTS money_refund_status VARCHAR(40) NOT NULL DEFAULT 'not_started',
    ADD COLUMN IF NOT EXISTS fiscal_refund_status VARCHAR(40) NOT NULL DEFAULT 'not_started',
    ADD COLUMN IF NOT EXISTS terminal_refund_reference VARCHAR(160),
    ADD COLUMN IF NOT EXISTS terminal_refund_confirmed_at TIMESTAMPTZ;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_refunds_money_status_v319'
          AND conrelid = 'payment_refunds'::regclass
    ) THEN
        ALTER TABLE payment_refunds
            ADD CONSTRAINT chk_payment_refunds_money_status_v319
            CHECK (money_refund_status IN ('not_started', 'pending', 'refunded', 'failed', 'unknown'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_refunds_fiscal_status_v319'
          AND conrelid = 'payment_refunds'::regclass
    ) THEN
        ALTER TABLE payment_refunds
            ADD CONSTRAINT chk_payment_refunds_fiscal_status_v319
            CHECK (fiscal_refund_status IN ('not_started', 'pending', 'returned', 'failed', 'unknown'));
    END IF;


    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_refunds_type_v319'
          AND conrelid = 'payment_refunds'::regclass
    ) THEN
        ALTER TABLE payment_refunds
            ADD CONSTRAINT chk_payment_refunds_type_v319
            CHECK (refund_type = 'full');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_payment_refunds_register_profile_v319'
          AND conrelid = 'payment_refunds'::regclass
    ) THEN
        ALTER TABLE payment_refunds
            ADD CONSTRAINT fk_payment_refunds_register_profile_v319
            FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
            REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_payment_refunds_shift_profile_v319'
          AND conrelid = 'payment_refunds'::regclass
    ) THEN
        ALTER TABLE payment_refunds
            ADD CONSTRAINT fk_payment_refunds_shift_profile_v319
            FOREIGN KEY (fiscal_shift_id, fiscal_profile_id)
            REFERENCES fiscal_shifts(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_payment_refunds_operation_profile_v319'
          AND conrelid = 'payment_refunds'::regclass
    ) THEN
        ALTER TABLE payment_refunds
            ADD CONSTRAINT fk_payment_refunds_operation_profile_v319
            FOREIGN KEY (fiscal_operation_id, fiscal_profile_id)
            REFERENCES fiscal_operations(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS fiscal_reconciliation_revisions (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT NOT NULL,
    fiscal_shift_id BIGINT NOT NULL,
    fiscal_reconciliation_id BIGINT,
    revision_number INTEGER NOT NULL,
    expected_cash_minor BIGINT NOT NULL DEFAULT 0,
    actual_cash_minor BIGINT NOT NULL DEFAULT 0,
    expected_terminal_minor BIGINT NOT NULL DEFAULT 0,
    actual_terminal_minor BIGINT NOT NULL DEFAULT 0,
    difference_minor BIGINT NOT NULL DEFAULT 0,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    reason TEXT,
    approved_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    revision_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_reconciliation_revisions_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_fiscal_reconciliation_revisions_shift_revision UNIQUE (fiscal_profile_id, fiscal_shift_id, revision_number),
    CONSTRAINT fk_fiscal_reconciliation_revisions_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_reconciliation_revisions_shift_profile
        FOREIGN KEY (fiscal_shift_id, fiscal_profile_id)
        REFERENCES fiscal_shifts(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_reconciliation_revisions_reconciliation_profile
        FOREIGN KEY (fiscal_reconciliation_id, fiscal_profile_id)
        REFERENCES fiscal_reconciliations(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_reconciliation_revisions_number CHECK (revision_number > 0),
    CONSTRAINT chk_fiscal_reconciliation_revisions_currency CHECK (currency = 'UAH'),
    CONSTRAINT chk_fiscal_reconciliation_revisions_reason CHECK (difference_minor = 0 OR (reason IS NOT NULL AND BTRIM(reason) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_fiscal_reconciliation_revisions_shift_v319
    ON fiscal_reconciliation_revisions (fiscal_profile_id, fiscal_shift_id, revision_number DESC);
