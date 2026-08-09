-- MIGRATION_KIND: schema
-- SAFETY: Additive/version-aware Checkbox pilot configuration audit and fiscal item tax-mode hardening. Existing payment/fiscal operations are not rewritten and production configuration is not activated.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Disable Checkbox integration, export fiscal_configuration_audit rows if needed, restore provider_tax_id NOT NULL only after confirming no untaxed mappings exist, then drop v325 constraints/indexes/table after application rollback.

CREATE TABLE IF NOT EXISTS fiscal_configuration_audit (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    actor_label VARCHAR(160),
    command VARCHAR(64) NOT NULL,
    reason TEXT NOT NULL,
    before_hash VARCHAR(96),
    after_hash VARCHAR(96),
    before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_fiscal_configuration_audit_register_v325
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_configuration_audit_command_v325 CHECK (command ~ '^[a-z0-9_-]+$'),
    CONSTRAINT chk_fiscal_configuration_audit_reason_v325 CHECK (BTRIM(reason) <> ''),
    CONSTRAINT chk_fiscal_configuration_audit_actor_v325 CHECK (actor_user_id IS NOT NULL OR BTRIM(COALESCE(actor_label, '')) <> '')
);

CREATE INDEX IF NOT EXISTS idx_fiscal_configuration_audit_scope_v325
    ON fiscal_configuration_audit (fiscal_profile_id, fiscal_register_id, created_at DESC, id DESC);

ALTER TABLE fiscal_item_mappings
    ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(16) NOT NULL DEFAULT 'taxed';

ALTER TABLE payment_order_items
    ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(16) NOT NULL DEFAULT 'taxed';

ALTER TABLE fiscal_item_mappings
    ALTER COLUMN provider_tax_id DROP NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_item_mappings_provider_tax'
          AND conrelid = 'fiscal_item_mappings'::regclass
    ) THEN
        ALTER TABLE fiscal_item_mappings
            DROP CONSTRAINT chk_fiscal_item_mappings_provider_tax;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_item_mappings_tax_mode_v325'
          AND conrelid = 'fiscal_item_mappings'::regclass
    ) THEN
        ALTER TABLE fiscal_item_mappings
            ADD CONSTRAINT chk_fiscal_item_mappings_tax_mode_v325
            CHECK (tax_mode IN ('taxed', 'untaxed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_payment_order_items_tax_mode_v325'
          AND conrelid = 'payment_order_items'::regclass
    ) THEN
        ALTER TABLE payment_order_items
            ADD CONSTRAINT chk_payment_order_items_tax_mode_v325
            CHECK (tax_mode IN ('taxed', 'untaxed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_item_mappings_provider_tax_v325'
          AND conrelid = 'fiscal_item_mappings'::regclass
    ) THEN
        ALTER TABLE fiscal_item_mappings
            ADD CONSTRAINT chk_fiscal_item_mappings_provider_tax_v325
            CHECK (
                (
                    tax_mode = 'taxed'
                    AND BTRIM(COALESCE(provider_tax_id, '')) <> ''
                    AND provider_tax_id !~* '^admission_tariff:'
                )
                OR (
                    tax_mode = 'untaxed'
                    AND NULLIF(BTRIM(COALESCE(provider_tax_id, '')), '') IS NULL
                )
            );
    END IF;
END $$;

COMMENT ON TABLE fiscal_configuration_audit IS
    'Append-only Checkbox fiscal configuration audit with before/after hashes and sanitized snapshots. Raw secrets, PINs, and tokens must never be stored.';

COMMENT ON COLUMN fiscal_item_mappings.tax_mode IS
    'Explicit fiscal tax mode: taxed requires provider_tax_id; untaxed requires provider_tax_id NULL/empty and maps to Checkbox goods without tax.';

COMMENT ON COLUMN payment_order_items.tax_mode IS
    'Immutable fiscal tax mode snapshot copied from fiscal_item_mappings at order creation.';
