-- MIGRATION_KIND: schema
-- SAFETY: Additive payroll capability change only. Widens payroll scheme and entry CHECK constraints for piece-rate payroll; existing rows are not rewritten.
-- ROLLBACK: Stop new piece payroll writes, export/reclassify rows with scheme_type or line_type = 'piece' if any exist, then restore the previous constraint lists.
-- OPERATOR_APPROVAL: required

ALTER TABLE payroll_schemes
    DROP CONSTRAINT IF EXISTS chk_payroll_schemes_type;

ALTER TABLE payroll_schemes
    ADD CONSTRAINT chk_payroll_schemes_type
    CHECK (scheme_type IN ('per_shift','hourly','monthly_fixed','percent','hybrid','manual','piece'));

ALTER TABLE payroll_entries
    DROP CONSTRAINT IF EXISTS chk_payroll_entries_line_type;

ALTER TABLE payroll_entries
    ADD CONSTRAINT chk_payroll_entries_line_type
    CHECK (line_type IN ('base','bonus','deduction','advance','zrs','percent','manual','adjustment','piece'));

COMMENT ON CONSTRAINT chk_payroll_schemes_type ON payroll_schemes
    IS 'Payroll scheme types supported by the canonical payroll calculator, including explicit piece-rate quantity * rate.';

COMMENT ON CONSTRAINT chk_payroll_entries_line_type ON payroll_entries
    IS 'Payroll entry line types accepted by monthly payroll snapshots; piece is generated only from explicit payroll metrics or immutable snapshots.';
