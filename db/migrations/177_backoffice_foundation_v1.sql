-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable/backward-compatible HR foundation columns and indexes only; existing staff, shifts, applications, warehouse, and pricing data are not rewritten.
-- ROLLBACK: Drop the added staff/job_applications/hr_shifts columns and related indexes/constraint after migrating any new values out of production.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS hr_pool_status VARCHAR(20) DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS blacklist_reason TEXT,
  ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'staff_hr_pool_status_check'
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_hr_pool_status_check
      CHECK (hr_pool_status IN ('core', 'reserve', 'blacklisted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_hr_pool_status
  ON staff(hr_pool_status)
  WHERE hr_pool_status IS NOT NULL;

ALTER TABLE hr_shifts
  ADD COLUMN IF NOT EXISTS original_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replacement_reason TEXT,
  ADD COLUMN IF NOT EXISTS replaced_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_hr_shifts_original_staff
  ON hr_shifts(original_staff_id)
  WHERE original_staff_id IS NOT NULL;

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS availability TEXT,
  ADD COLUMN IF NOT EXISTS experience TEXT,
  ADD COLUMN IF NOT EXISTS interview_notes TEXT,
  ADD COLUMN IF NOT EXISTS raw_application_text TEXT,
  ADD COLUMN IF NOT EXISTS parsed_payload JSONB;
