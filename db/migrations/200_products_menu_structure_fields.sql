-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable/defaulted menu product fields. Existing products and kitchen records keep their current values.
-- ROLLBACK: Drop idx_products_menu_section, idx_products_availability_status, products_availability_status_check and the added columns after exporting menu metadata if rollback is required.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS menu_section VARCHAR(120),
    ADD COLUMN IF NOT EXISTS serving_unit VARCHAR(60),
    ADD COLUMN IF NOT EXISTS weight_value VARCHAR(120),
    ADD COLUMN IF NOT EXISTS price_variant_note TEXT,
    ADD COLUMN IF NOT EXISTS availability_status VARCHAR(30) DEFAULT 'active';

UPDATE products
SET availability_status = CASE
    WHEN COALESCE(is_active, true) = false THEN 'hidden'
    ELSE 'active'
END
WHERE availability_status IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_availability_status_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_availability_status_check
            CHECK (availability_status IN ('active', 'draft', 'seasonal', 'sold_out', 'hidden'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_menu_section
    ON products(menu_section)
    WHERE COALESCE(domain, 'program') = 'kitchen' AND kitchen_type = 'menu';

CREATE INDEX IF NOT EXISTS idx_products_availability_status
    ON products(availability_status);
