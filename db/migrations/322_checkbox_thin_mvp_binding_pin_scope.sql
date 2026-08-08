-- MIGRATION_KIND: schema
-- SAFETY: Additive constraint replacement only. It keeps fiscal cashier bindings scoped by CRM profile/location, but allows thin MVP non-approval bindings without action PIN secrets. No production data, payment data, booking data, or raw secrets are changed.
-- ROLLBACK: Disable Checkbox integration, ensure all active fiscal cashier bindings have action_pin_hash values, then restore the stricter v317 check constraint.
-- OPERATOR_APPROVAL: required

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_fiscal_cashier_bindings_scope_v317'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            DROP CONSTRAINT chk_fiscal_cashier_bindings_scope_v317;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_fiscal_cashier_bindings_scope_v322'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            ADD CONSTRAINT chk_fiscal_cashier_bindings_scope_v322
            CHECK (
                status <> 'active'
                OR (
                    crm_profile_key IS NOT NULL
                    AND fiscal_location_id IS NOT NULL
                    AND pin_failed_attempts >= 0
                    AND (
                        NOT (
                            capability_scope && ARRAY[
                                'fiscal.service_out.approve',
                                'fiscal.refund',
                                'fiscal.reconcile',
                                'fiscal.configure'
                            ]::text[]
                        )
                        OR (
                            action_pin_hash IS NOT NULL
                            AND BTRIM(action_pin_hash) <> ''
                        )
                    )
                )
            );
    END IF;
END;
$migration$;

COMMENT ON CONSTRAINT chk_fiscal_cashier_bindings_scope_v322 ON fiscal_cashier_bindings IS
    'Thin payment MVP bindings require CRM profile and location scope. Action PIN hash is required only for approval/PRO capabilities, never for simple payment create/confirm/open-shift scope.';
