-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable fields idempotently. Existing staff names are preserved without backfill.
-- ROLLBACK: Redeploy the previous application and retain the columns to preserve captured names.

ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS given_name TEXT,
    ADD COLUMN IF NOT EXISTS family_name TEXT;
