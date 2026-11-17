-- MIGRATION_KIND: schema
-- SAFETY: Adds a nullable attendance column. Existing rows retain unknown break timestamps.
-- ROLLBACK: Retain the column and its facts when rolling back the application.

ALTER TABLE hr_time_records
    ADD COLUMN IF NOT EXISTS break_intervals JSONB;
