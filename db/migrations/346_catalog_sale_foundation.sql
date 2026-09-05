-- MIGRATION_KIND: schema
-- SAFETY: Additive local catalog-sale metadata and discount rules only; no production execution is authorized by this file.
-- ROLLBACK: Disable catalog-sale first and retain the additive objects by default; drop them only after confirming no deployed code or stored discount rules/sale metadata depend on them.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS sale_config JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_config_object_v346') THEN
        ALTER TABLE products ADD CONSTRAINT products_sale_config_object_v346
            CHECK (jsonb_typeof(sale_config) = 'object');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales_discount_rules (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    rate_bps INTEGER NOT NULL,
    eligibility_mode VARCHAR(40) NOT NULL DEFAULT 'explicit',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sales_discount_rules_business_code_v346 UNIQUE (business_context, code),
    CONSTRAINT chk_sales_discount_rules_context_v346 CHECK (business_context ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_sales_discount_rules_code_v346 CHECK (code ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_sales_discount_rules_rate_v346 CHECK (rate_bps BETWEEN 1 AND 9999),
    CONSTRAINT chk_sales_discount_rules_mode_v346 CHECK (eligibility_mode IN ('explicit', 'second_club_direction')),
    CONSTRAINT chk_sales_discount_rules_metadata_v346 CHECK (jsonb_typeof(metadata) = 'object')
);
