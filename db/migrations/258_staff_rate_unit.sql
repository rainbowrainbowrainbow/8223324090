-- MIGRATION_KIND: schema
-- SAFETY: Additive staff payroll metadata. Existing rates keep the default hourly unit, and no payroll rows are rewritten.
-- ROLLBACK: Export staff.rate_unit if needed, then ALTER TABLE staff DROP COLUMN rate_unit and drop chk_staff_rate_unit.

ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS rate_unit VARCHAR(10) DEFAULT 'hour';

UPDATE staff
   SET rate_unit = 'hour'
 WHERE rate_unit IS NULL
    OR rate_unit NOT IN ('hour', 'day');

ALTER TABLE staff
    ALTER COLUMN rate_unit SET DEFAULT 'hour',
    ALTER COLUMN rate_unit SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_staff_rate_unit'
    ) THEN
        ALTER TABLE staff
            ADD CONSTRAINT chk_staff_rate_unit CHECK (rate_unit IN ('hour', 'day'));
    END IF;
END $$;
