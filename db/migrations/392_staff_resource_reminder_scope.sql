-- MIGRATION_KIND: schema
-- SAFETY: Add an optional business key for future assignments; existing records are untouched.
-- ROLLBACK: Revert the reminder reader and writer. Retain the nullable column for rollback compatibility.

ALTER TABLE staff_resource_assignments
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64);
