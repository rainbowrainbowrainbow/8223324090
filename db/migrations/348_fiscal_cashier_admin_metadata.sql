-- MIGRATION_KIND: schema
-- SAFETY: Adds non-secret cashier display metadata only. Credential values remain environment-only and no permissions are changed.
-- ROLLBACK: Retain the additive metadata columns by default; remove them only after confirming no deployed application version reads them and no operator metadata must be preserved.

ALTER TABLE fiscal_cashier_bindings
    ADD COLUMN IF NOT EXISTS cashier_name VARCHAR(160),
    ADD COLUMN IF NOT EXISTS cashier_login VARCHAR(160);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_cashier_name_shape_v348') THEN
        ALTER TABLE fiscal_cashier_bindings ADD CONSTRAINT fiscal_cashier_name_shape_v348
            CHECK (cashier_name IS NULL OR (cashier_name = BTRIM(cashier_name) AND CHAR_LENGTH(cashier_name) BETWEEN 2 AND 160));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_cashier_login_shape_v348') THEN
        ALTER TABLE fiscal_cashier_bindings ADD CONSTRAINT fiscal_cashier_login_shape_v348
            CHECK (cashier_login IS NULL OR (cashier_login = BTRIM(cashier_login) AND CHAR_LENGTH(cashier_login) BETWEEN 2 AND 160));
    END IF;
END $$;
