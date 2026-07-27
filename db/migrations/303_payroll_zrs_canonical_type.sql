-- MIGRATION_KIND: schema
-- SAFETY: Additive ZRS naming transition only. Existing salary_adjustments/payroll_entries rows are not rewritten; legacy advance remains readable during the transition.
-- ROLLBACK: Stop new zrs writes, export/delete rows with type or line_type = 'zrs' if needed, then restore the previous constraints and drop zrs-specific indexes.
-- OPERATOR_APPROVAL: required

ALTER TABLE salary_adjustments
    DROP CONSTRAINT IF EXISTS salary_adjustments_type_check;

ALTER TABLE salary_adjustments
    ADD CONSTRAINT salary_adjustments_type_check
    CHECK (type IN ('bonus', 'deduction', 'penalty', 'tip', 'advance', 'zrs'));

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_payroll_entries_line_type'
          AND conrelid = 'payroll_entries'::regclass
    ) THEN
        ALTER TABLE payroll_entries DROP CONSTRAINT chk_payroll_entries_line_type;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_payroll_entries_line_type'
          AND conrelid = 'payroll_entries'::regclass
    ) THEN
        ALTER TABLE payroll_entries ADD CONSTRAINT chk_payroll_entries_line_type
            CHECK (line_type IN ('base','bonus','deduction','advance','zrs','percent','manual','adjustment'));
    END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS idx_salary_adj_zrs_month_staff
    ON salary_adjustments(month, staff_id)
    WHERE type = 'zrs';

CREATE INDEX IF NOT EXISTS idx_payroll_entries_zrs_staff_month
    ON payroll_entries(staff_id, period_month)
    WHERE line_type = 'zrs';

COMMENT ON CONSTRAINT salary_adjustments_type_check ON salary_adjustments
    IS 'Canonical ZRS type is zrs; legacy advance is retained only for historical compatibility.';

COMMENT ON CONSTRAINT chk_payroll_entries_line_type ON payroll_entries
    IS 'Canonical ZRS payroll entry line_type is zrs; legacy advance is retained only for historical compatibility.';
