-- MIGRATION_KIND: schema
-- SAFETY: Additive leads.updated_at column with an idempotent backfill from created_at/NOW(); no rows are deleted, merged, or rewritten beyond the missing timestamp value.
-- ROLLBACK: Drop leads.updated_at only after confirming no deployed code or migrations depend on it; do not drop during emergency rollback without explicit DB approval.

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE leads
SET updated_at = COALESCE(created_at::timestamptz, NOW())
WHERE updated_at IS NULL;

ALTER TABLE leads
    ALTER COLUMN updated_at SET DEFAULT NOW();
