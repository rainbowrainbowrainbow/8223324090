-- MIGRATION_KIND: schema
-- SAFETY: Additive program-icon generation metadata on products plus a small product-owned AI settings table. Existing emoji/manual icon flows remain unchanged.
-- ROLLBACK: Export icon generation metadata/settings if needed, then drop the added products columns, indexes, constraints, and product_ai_settings table.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS icon_url TEXT,
    ADD COLUMN IF NOT EXISTS icon_generation_status VARCHAR(20) NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS icon_prompt_source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS icon_llm_prompt_output TEXT,
    ADD COLUMN IF NOT EXISTS icon_final_image_prompt TEXT,
    ADD COLUMN IF NOT EXISTS icon_provider VARCHAR(40),
    ADD COLUMN IF NOT EXISTS icon_model VARCHAR(120),
    ADD COLUMN IF NOT EXISTS icon_last_error TEXT,
    ADD COLUMN IF NOT EXISTS icon_generated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS icon_job_id VARCHAR(160);

UPDATE products
SET icon_generation_status = 'idle'
WHERE icon_generation_status IS NULL OR icon_generation_status = '';

UPDATE products
SET icon_prompt_source_snapshot = '{}'::jsonb
WHERE icon_prompt_source_snapshot IS NULL
   OR jsonb_typeof(icon_prompt_source_snapshot) <> 'object';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_icon_generation_status_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_icon_generation_status_check
            CHECK (icon_generation_status IN ('idle', 'pending', 'succeeded', 'failed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_icon_prompt_source_snapshot_object_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_icon_prompt_source_snapshot_object_check
            CHECK (jsonb_typeof(icon_prompt_source_snapshot) = 'object');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_icon_generation_status
    ON products(icon_generation_status)
    WHERE COALESCE(domain, 'program') = 'program';

CREATE INDEX IF NOT EXISTS idx_products_icon_job_id
    ON products(icon_job_id)
    WHERE icon_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS product_ai_settings (
    key VARCHAR(80) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by VARCHAR(100)
);

INSERT INTO product_ai_settings (key, value, updated_by)
VALUES (
    'program_icon_generation',
    jsonb_build_object(
        'systemInstructions', 'Create concise still-image prompts for small CRM program icons. Keep the output suitable for one cheap 1:1 image generation request.',
        'userTemplate', 'Program: {{name}}. Code: {{code}}. Category: {{category}}. Duration: {{duration}} minutes. Hosts: {{hosts}}. Age: {{ageRange}}. Children: {{kidsCapacity}}. Notes: {{description}}.',
        'styleRules', 'Modern dark SaaS UI, rounded square icon, circular inner badge, soft neon glow, one clear central playful performance object or character silhouette. No text, no letters, no numbers, no watermark. Readable at 64x64 px.',
        'fallbackTemplate', 'Create a clean custom CRM icon for a children''s entertainment program named {{name}} in category {{category}}. Use a dark navy/purple rounded square, circular inner badge, soft neon glow, semi-3D vector illustration, one central object or character silhouette, no text, no letters, no numbers, readable at 64x64 px.'
    ),
    'migration_240'
)
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_ai_settings_value_object_check'
    ) THEN
        ALTER TABLE product_ai_settings
            ADD CONSTRAINT product_ai_settings_value_object_check
            CHECK (jsonb_typeof(value) = 'object');
    END IF;
END $$;
