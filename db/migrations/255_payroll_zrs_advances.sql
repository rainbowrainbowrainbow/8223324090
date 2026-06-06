-- MIGRATION_KIND: schema
-- SAFETY: Widens the salary_adjustments type constraint so HR can record ZRS salary advances; existing rows are not rewritten.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Export/delete salary_adjustments rows with type = 'advance', drop idx_salary_adj_advance_month_staff, then restore the previous check list.

ALTER TABLE salary_adjustments
    DROP CONSTRAINT IF EXISTS salary_adjustments_type_check;

ALTER TABLE salary_adjustments
    ADD CONSTRAINT salary_adjustments_type_check
    CHECK (type IN ('bonus', 'deduction', 'penalty', 'tip', 'advance'));

CREATE INDEX IF NOT EXISTS idx_salary_adj_advance_month_staff
    ON salary_adjustments(month, staff_id)
    WHERE type = 'advance';

COMMENT ON CONSTRAINT salary_adjustments_type_check ON salary_adjustments
    IS 'Allows HR salary bonuses, deductions, depremium penalties, tips, and ZRS salary advances.';
