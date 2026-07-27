-- MIGRATION_KIND: schema
-- SAFETY: Additive KPI payroll audit transition. Widens salary_adjustments type constraint for manual KPI bonuses only; existing rows are not rewritten.
-- ROLLBACK: Stop new kpi_bonus writes, export/delete rows with type = 'kpi_bonus' if needed, then restore the previous constraint list.
-- OPERATOR_APPROVAL: required

ALTER TABLE salary_adjustments
    DROP CONSTRAINT IF EXISTS salary_adjustments_type_check;

ALTER TABLE salary_adjustments
    ADD CONSTRAINT salary_adjustments_type_check
    CHECK (type IN ('bonus', 'deduction', 'penalty', 'tip', 'advance', 'zrs', 'kpi_bonus'));

CREATE INDEX IF NOT EXISTS idx_salary_adj_kpi_bonus_month_staff
    ON salary_adjustments(month, staff_id)
    WHERE type = 'kpi_bonus';

COMMENT ON CONSTRAINT salary_adjustments_type_check ON salary_adjustments
    IS 'Manual KPI bonuses use kpi_bonus and remain separate from informational KPI score; legacy advance remains readable as historical ZRS.';
