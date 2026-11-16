-- MIGRATION_KIND: schema
-- SAFETY: Adds a boolean with a false default. Existing return dates and statuses retain their meaning.
-- ROLLBACK: Redeploy the previous application and retain the column to preserve recorded return terms.

ALTER TABLE staff_resource_assignments
    ADD COLUMN IF NOT EXISTS return_on_employment_end BOOLEAN NOT NULL DEFAULT FALSE;
