-- MIGRATION_KIND: schema
-- SAFETY: Expands the staff.rate_unit enum-like check to support monthly HR rates. Existing staff rows keep their current values.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Export monthly staff rates if used, update staff.rate_unit from month to hour or day, then recreate chk_staff_rate_unit without month.

ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS rate_unit VARCHAR(10) DEFAULT 'hour';

UPDATE staff
   SET rate_unit = 'hour'
 WHERE rate_unit IS NULL
    OR rate_unit NOT IN ('hour', 'day', 'month');

ALTER TABLE staff
    ALTER COLUMN rate_unit SET DEFAULT 'hour',
    ALTER COLUMN rate_unit SET NOT NULL;

ALTER TABLE staff
    DROP CONSTRAINT IF EXISTS chk_staff_rate_unit;

ALTER TABLE staff
    ADD CONSTRAINT chk_staff_rate_unit CHECK (rate_unit IN ('hour', 'day', 'month'));
