-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable Design Board business-context ownership fields and scoped indexes only. Existing legacy rows are left unassigned until an operator-approved mapping/backfill is provided.
-- ROLLBACK: Drop the scoped Design Board indexes/constraints and columns only after exporting or explicitly remapping any non-null business_context rows that must be preserved.

ALTER TABLE designs
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE design_collections
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'designs_business_context_format_check'
    ) THEN
        ALTER TABLE designs
            ADD CONSTRAINT designs_business_context_format_check
            CHECK (business_context IS NULL OR business_context ~ '^[a-z][a-z0-9_]{2,63}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_collections_business_context_format_check'
    ) THEN
        ALTER TABLE design_collections
            ADD CONSTRAINT design_collections_business_context_format_check
            CHECK (business_context IS NULL OR business_context ~ '^[a-z][a-z0-9_]{2,63}$');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_designs_business_context_created_at
    ON designs(business_context, created_at DESC)
    WHERE business_context IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_designs_business_context_collection
    ON designs(business_context, collection_id)
    WHERE business_context IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_design_collections_business_context_sort
    ON design_collections(business_context, sort_order, name)
    WHERE business_context IS NOT NULL;
