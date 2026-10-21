-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent nullable fields; existing afisha rows remain unchanged.
-- ROLLBACK: Roll back application code and retain the nullable columns and their data.

ALTER TABLE afisha ADD COLUMN IF NOT EXISTS promotion_id INTEGER REFERENCES timeline_promotions(id);
ALTER TABLE afisha ADD COLUMN IF NOT EXISTS second_line_id VARCHAR(100);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'afisha_distinct_lines') THEN
        ALTER TABLE afisha ADD CONSTRAINT afisha_distinct_lines
            CHECK (second_line_id IS NULL OR (line_id IS NOT NULL AND second_line_id <> line_id));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_afisha_promotion_id ON afisha(promotion_id) WHERE promotion_id IS NOT NULL;
