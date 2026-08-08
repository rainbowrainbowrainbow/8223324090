-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable-free defaulted My Day metadata column and validation constraint only. Existing rows receive the empty-array default and no production data is backfilled or reclassified.
-- ROLLBACK: ALTER TABLE my_day_task_metadata DROP CONSTRAINT IF EXISTS chk_my_day_task_metadata_tags; ALTER TABLE my_day_task_metadata DROP COLUMN IF EXISTS tags; DROP FUNCTION IF EXISTS my_day_valid_task_tags(TEXT[]);

CREATE OR REPLACE FUNCTION my_day_valid_task_tags(tag_values TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT tag_values IS NOT NULL
       AND cardinality(tag_values) <= 5
       AND NOT EXISTS (
           SELECT 1
           FROM unnest(tag_values) AS tag(value)
           WHERE value IS NULL
              OR btrim(value) = ''
              OR char_length(value) > 32
       );
$$;

ALTER TABLE my_day_task_metadata
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_my_day_task_metadata_tags'
          AND conrelid = 'my_day_task_metadata'::regclass
    ) THEN
        ALTER TABLE my_day_task_metadata
            ADD CONSTRAINT chk_my_day_task_metadata_tags
            CHECK (my_day_valid_task_tags(tags));
    END IF;
END;
$$;
