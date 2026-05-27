-- MIGRATION_KIND: schema
-- SAFETY: Additive JSONB metadata for menu allergens and AI review state. Existing products, simple tech_card text, and detailed warehouse-linked rows remain compatible.
-- ROLLBACK: Export products.allergens, products.ai_card_draft, and products.ai_card_approved_blocks if needed, then drop the added columns and indexes.
-- OPERATOR_APPROVAL: required

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS allergens JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS ai_card_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS ai_card_approved_blocks JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS ai_card_reviewed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS ai_card_reviewed_by VARCHAR(100);

UPDATE products
SET allergens = '[]'::jsonb
WHERE allergens IS NULL
   OR jsonb_typeof(allergens) <> 'array';

UPDATE products
SET ai_card_draft = '{}'::jsonb
WHERE ai_card_draft IS NULL
   OR jsonb_typeof(ai_card_draft) <> 'object';

UPDATE products
SET ai_card_approved_blocks = '{}'::jsonb
WHERE ai_card_approved_blocks IS NULL
   OR jsonb_typeof(ai_card_approved_blocks) <> 'object';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_allergens_json_array_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_allergens_json_array_check
            CHECK (jsonb_typeof(allergens) = 'array');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_ai_card_draft_json_object_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_ai_card_draft_json_object_check
            CHECK (jsonb_typeof(ai_card_draft) = 'object');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_ai_card_approved_blocks_json_object_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_ai_card_approved_blocks_json_object_check
            CHECK (jsonb_typeof(ai_card_approved_blocks) = 'object');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_allergens_gin
    ON products USING GIN (allergens)
    WHERE COALESCE(domain, 'program') = 'kitchen'
      AND kitchen_type = 'menu';

CREATE INDEX IF NOT EXISTS idx_products_ai_card_reviewed
    ON products(ai_card_reviewed_at DESC)
    WHERE ai_card_reviewed_at IS NOT NULL;
