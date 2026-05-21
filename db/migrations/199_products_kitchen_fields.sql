-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable kitchen product columns and idempotent checks/indexes. Existing program rows remain active and default to domain='program'.
-- ROLLBACK: Drop products_kitchen_* checks/indexes and the added kitchen columns after exporting any kitchen metadata if rollback is required.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS domain VARCHAR(30) DEFAULT 'program',
    ADD COLUMN IF NOT EXISTS kitchen_type VARCHAR(30),
    ADD COLUMN IF NOT EXISTS short_description TEXT,
    ADD COLUMN IF NOT EXISTS promo_description TEXT,
    ADD COLUMN IF NOT EXISTS ingredients TEXT,
    ADD COLUMN IF NOT EXISTS tech_card TEXT,
    ADD COLUMN IF NOT EXISTS cake_decoration TEXT;

UPDATE products
SET domain = 'program'
WHERE domain IS NULL;

UPDATE products
SET domain = 'kitchen',
    kitchen_type = 'cake'
WHERE lower(COALESCE(category, '')) IN ('cake', 'cakes', 'торт', 'торти')
  AND (
    COALESCE(domain, 'program') <> 'kitchen'
    OR kitchen_type IS NULL
  );

UPDATE products
SET domain = 'kitchen',
    kitchen_type = 'menu'
WHERE lower(COALESCE(category, '')) IN ('menu', 'меню')
  AND (
    COALESCE(domain, 'program') <> 'kitchen'
    OR kitchen_type IS NULL
  );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_domain_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_domain_check
            CHECK (domain IN ('program', 'kitchen'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_kitchen_type_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_kitchen_type_check
            CHECK (
                kitchen_type IS NULL
                OR kitchen_type IN ('cake', 'menu')
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_domain ON products(domain);
CREATE INDEX IF NOT EXISTS idx_products_kitchen_type ON products(kitchen_type);
