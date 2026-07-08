-- MIGRATION_KIND: schema
-- SAFETY: Additive customer_children dietary fields only. Existing note data is not moved, rewritten, or deleted; the existing has-data CHECK is recreated to include the new optional fields.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Export customer_children.dietary_tags and customer_children.dietary_note first, then drop idx_customer_children_dietary_tags_gin, dietary CHECK constraints, dietary columns, and recreate the previous customer_children_has_data_check.
-- DATA_SCOPE: No destructive data changes, no production data cleanup, and no backfill from free-text child notes.

ALTER TABLE customer_children
    ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS dietary_note TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customer_children_dietary_tags_count_check'
    ) THEN
        ALTER TABLE customer_children
            ADD CONSTRAINT customer_children_dietary_tags_count_check
            CHECK (cardinality(dietary_tags) <= 20) NOT VALID;
    END IF;
END $$;

ALTER TABLE customer_children
    VALIDATE CONSTRAINT customer_children_dietary_tags_count_check;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customer_children_dietary_tags_no_empty_check'
    ) THEN
        ALTER TABLE customer_children
            ADD CONSTRAINT customer_children_dietary_tags_no_empty_check
            CHECK (array_position(dietary_tags, '') IS NULL) NOT VALID;
    END IF;
END $$;

ALTER TABLE customer_children
    VALIDATE CONSTRAINT customer_children_dietary_tags_no_empty_check;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'customer_children_dietary_note_length_check'
    ) THEN
        ALTER TABLE customer_children
            ADD CONSTRAINT customer_children_dietary_note_length_check
            CHECK (dietary_note IS NULL OR length(btrim(dietary_note)) <= 1000) NOT VALID;
    END IF;
END $$;

ALTER TABLE customer_children
    VALIDATE CONSTRAINT customer_children_dietary_note_length_check;

ALTER TABLE customer_children
    DROP CONSTRAINT IF EXISTS customer_children_has_data_check;

ALTER TABLE customer_children
    ADD CONSTRAINT customer_children_has_data_check
    CHECK (
        NULLIF(BTRIM(COALESCE(name, '')), '') IS NOT NULL
        OR birthday IS NOT NULL
        OR age_snapshot IS NOT NULL
        OR NULLIF(BTRIM(COALESCE(note, '')), '') IS NOT NULL
        OR cardinality(dietary_tags) > 0
        OR NULLIF(BTRIM(COALESCE(dietary_note, '')), '') IS NOT NULL
    ) NOT VALID;

ALTER TABLE customer_children
    VALIDATE CONSTRAINT customer_children_has_data_check;

CREATE INDEX IF NOT EXISTS idx_customer_children_dietary_tags_gin
    ON customer_children USING GIN (dietary_tags)
    WHERE cardinality(dietary_tags) > 0;
