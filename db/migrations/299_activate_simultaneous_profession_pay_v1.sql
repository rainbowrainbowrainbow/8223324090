-- MIGRATION_KIND: data-fix
-- SAFETY: Activates only the pre-seeded simultaneous-profession-pay-v1 policy from 2026-07-18. It does not update legacy roles, attendance snapshots, payroll reports, or finance history. Re-running the SQL preserves the same policy values.
-- ROLLBACK: Retire the policy to block new paid-role writes. Keep the additive schema and all existing role, attendance, payroll, and finance history unchanged.
-- OPERATOR_APPROVAL: required
-- DATA_SCOPE: The single hr_compensation_policies row with policy_version = simultaneous-profession-pay-v1; effective for record_date values on or after 2026-07-18.

UPDATE hr_compensation_policies
SET effective_from = DATE '2026-07-18',
    status = 'active',
    activated_by = 'migration_299',
    activated_at = COALESCE(activated_at, NOW()),
    updated_at = NOW()
WHERE policy_version = 'simultaneous-profession-pay-v1'
  AND compensation_mode = 'paid_hourly'
  AND pay_multiplier = 1.0
  AND (
      status = 'draft'
      OR (
          status = 'active'
          AND effective_from = DATE '2026-07-18'
      )
  );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM hr_compensation_policies
        WHERE policy_version = 'simultaneous-profession-pay-v1'
          AND compensation_mode = 'paid_hourly'
          AND pay_multiplier = 1.0
          AND effective_from = DATE '2026-07-18'
          AND status = 'active'
          AND activated_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION
            'simultaneous-profession-pay-v1 activation failed closed: expected draft/active policy with multiplier 1.0';
    END IF;
END $$;
