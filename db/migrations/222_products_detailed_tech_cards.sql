-- MIGRATION_KIND: schema
-- SAFETY: Additive detailed kitchen tech-card metadata on top of existing product_stock_requirements. Existing simple tech_card text and stock requirement rows remain compatible.
-- ROLLBACK: Drop products.tech_card_mode and the added product_stock_requirements metadata columns/constraints/indexes after exporting detailed tech-card rows if rollback is required.
-- OPERATOR_APPROVAL: required

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS tech_card_mode VARCHAR(20) NOT NULL DEFAULT 'simple';

UPDATE products
SET tech_card_mode = 'simple'
WHERE tech_card_mode IS NULL
   OR tech_card_mode NOT IN ('simple', 'detailed');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_tech_card_mode_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_tech_card_mode_check
            CHECK (tech_card_mode IN ('simple', 'detailed'));
    END IF;
END $$;

ALTER TABLE product_stock_requirements
    ALTER COLUMN stock_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS ingredient_label VARCHAR(255),
    ADD COLUMN IF NOT EXISTS unit VARCHAR(30),
    ADD COLUMN IF NOT EXISTS waste_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);

UPDATE product_stock_requirements psr
SET ingredient_label = COALESCE(NULLIF(psr.ingredient_label, ''), ws.name),
    unit = COALESCE(NULLIF(psr.unit, ''), ws.unit),
    waste_percent = COALESCE(psr.waste_percent, 0),
    sort_order = COALESCE(psr.sort_order, 100),
    updated_at = COALESCE(psr.updated_at, NOW())
FROM warehouse_stock ws
WHERE ws.id = psr.stock_id;

UPDATE product_stock_requirements
SET ingredient_label = COALESCE(NULLIF(ingredient_label, ''), 'Невідомий інгредієнт'),
    unit = COALESCE(NULLIF(unit, ''), 'шт'),
    waste_percent = COALESCE(waste_percent, 0),
    sort_order = COALESCE(sort_order, 100),
    updated_at = COALESCE(updated_at, NOW())
WHERE stock_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'product_stock_requirements_quantity_positive'
    ) THEN
        ALTER TABLE product_stock_requirements
            ADD CONSTRAINT product_stock_requirements_quantity_positive
            CHECK (quantity > 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'product_stock_requirements_waste_percent_check'
    ) THEN
        ALTER TABLE product_stock_requirements
            ADD CONSTRAINT product_stock_requirements_waste_percent_check
            CHECK (waste_percent >= 0 AND waste_percent <= 500);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'product_stock_requirements_link_or_label_check'
    ) THEN
        ALTER TABLE product_stock_requirements
            ADD CONSTRAINT product_stock_requirements_link_or_label_check
            CHECK (stock_id IS NOT NULL OR NULLIF(ingredient_label, '') IS NOT NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_psr_product_sort
    ON product_stock_requirements(product_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_psr_stock_active
    ON product_stock_requirements(stock_id)
    WHERE stock_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_tech_card_mode
    ON products(tech_card_mode)
    WHERE COALESCE(domain, 'program') = 'kitchen';
