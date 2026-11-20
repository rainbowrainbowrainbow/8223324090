-- MIGRATION_KIND: schema
-- SAFETY: Widen the commission basis allowlist without rewriting stored bases or backfilling employee data. The replacement check also accepts every legacy key.
-- ROLLBACK: Retain the widened allowlist during rollback. Use a compatible forward release after writing any of the new keys.
-- OPERATOR_APPROVAL: required

ALTER TABLE hr_payroll_component_inputs
    DROP CONSTRAINT IF EXISTS hr_payroll_component_inputs_basis_key_check,
    ADD CONSTRAINT hr_payroll_component_inputs_basis_key_check
        CHECK (basis_key IN ('own_orders', 'own_banquets', 'other_manager_banquets',
                            'own_bookings', 'other_bookings', 'manual'));
