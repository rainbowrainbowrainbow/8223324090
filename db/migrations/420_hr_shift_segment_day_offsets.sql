-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable columns without rewriting existing segment rows.
-- ROLLBACK: Keep the columns and deploy a compatible reader if explicit offsets have been saved.

ALTER TABLE hr_shift_segments
    ADD COLUMN IF NOT EXISTS start_day_offset SMALLINT,
    ADD COLUMN IF NOT EXISTS end_day_offset SMALLINT;
