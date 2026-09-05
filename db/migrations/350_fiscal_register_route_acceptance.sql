-- MIGRATION_KIND: schema
-- SAFETY: Adds fail-closed per-register payment acceptance and optional shift business ownership. Both additions are nullable/additive for existing history, and every register remains non-accepting until explicitly enabled by a separately authorized configuration change.
-- ROLLBACK: Disable global Checkbox payment acceptance first. Retain the additive columns by default; drop the v350 constraint and columns only after every deployed application version no longer reads them.
-- DATA_SCOPE: Schema-only columns and constraints; no existing fiscal register, shift, payment, customer, or provider row is rewritten.

ALTER TABLE fiscal_registers
    ADD COLUMN IF NOT EXISTS acceptance_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE fiscal_shifts
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_fiscal_register_acceptance_requires_feature_v350'
           AND conrelid = 'fiscal_registers'::regclass
    ) THEN
        ALTER TABLE fiscal_registers
            ADD CONSTRAINT chk_fiscal_register_acceptance_requires_feature_v350
            CHECK (acceptance_enabled = FALSE OR (feature_enabled = TRUE AND status = 'active'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_fiscal_shift_business_context_v350'
           AND conrelid = 'fiscal_shifts'::regclass
    ) THEN
        ALTER TABLE fiscal_shifts
            ADD CONSTRAINT chk_fiscal_shift_business_context_v350
            CHECK (business_context IS NULL OR business_context ~ '^[a-z0-9_]+$');
    END IF;
END;
$migration$;

COMMENT ON COLUMN fiscal_registers.acceptance_enabled IS
    'Fail-closed per-register gate for new payment/fiscal mutations. It is independent from configuration readiness (feature_enabled) and the global Checkbox kill switch.';

COMMENT ON COLUMN fiscal_shifts.business_context IS
    'Business context that owns an active shared test-register shift; NULL preserves legacy shift history.';
