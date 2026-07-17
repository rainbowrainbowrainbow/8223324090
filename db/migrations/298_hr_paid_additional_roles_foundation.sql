-- MIGRATION_KIND: mixed
-- SAFETY: Additive paid-additional-role foundation only. Existing role rows stay explicitly unpaid, the seeded policy remains draft with no effective date, and no attendance or payroll history is recalculated.
-- ROLLBACK: Disable paid-role writes first, export any new role metadata and compensation snapshots, then drop the additive constraints/columns and hr_compensation_policies table. Do not delete approved or paid payroll history.

CREATE TABLE IF NOT EXISTS hr_compensation_policies (
    policy_version VARCHAR(64) PRIMARY KEY,
    compensation_mode VARCHAR(32) NOT NULL,
    pay_multiplier NUMERIC(10,4) NOT NULL,
    effective_from DATE,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    created_by VARCHAR(100),
    activated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_hr_compensation_policies_mode
        CHECK (compensation_mode IN ('paid_hourly')),
    CONSTRAINT chk_hr_compensation_policies_multiplier
        CHECK (pay_multiplier > 0),
    CONSTRAINT chk_hr_compensation_policies_status
        CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT chk_hr_compensation_policies_activation
        CHECK (
            (status = 'active' AND effective_from IS NOT NULL AND activated_at IS NOT NULL)
            OR status <> 'active'
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_compensation_policies_active_mode
    ON hr_compensation_policies(compensation_mode)
    WHERE status = 'active';

INSERT INTO hr_compensation_policies (
    policy_version,
    compensation_mode,
    pay_multiplier,
    effective_from,
    status,
    created_by
)
VALUES (
    'simultaneous-profession-pay-v1',
    'paid_hourly',
    1.0,
    NULL,
    'draft',
    'migration_298'
)
ON CONFLICT (policy_version) DO NOTHING;

ALTER TABLE hr_shift_segment_roles
    ADD COLUMN IF NOT EXISTS compensation_mode VARCHAR(32) NOT NULL DEFAULT 'unpaid',
    ADD COLUMN IF NOT EXISTS pay_multiplier NUMERIC(10,4),
    ADD COLUMN IF NOT EXISTS policy_version VARCHAR(64);

-- Compatibility backfill is intentionally one-way and non-financial:
-- every legacy role remains unpaid and receives no multiplier or policy.
UPDATE hr_shift_segment_roles
SET compensation_mode = 'unpaid',
    pay_multiplier = NULL,
    policy_version = NULL
WHERE compensation_mode IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_hr_shift_segment_roles_compensation_mode'
    ) THEN
        ALTER TABLE hr_shift_segment_roles
            ADD CONSTRAINT chk_hr_shift_segment_roles_compensation_mode
            CHECK (compensation_mode IN ('unpaid', 'paid_hourly'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_hr_shift_segment_roles_compensation_payload'
    ) THEN
        ALTER TABLE hr_shift_segment_roles
            ADD CONSTRAINT chk_hr_shift_segment_roles_compensation_payload
            CHECK (
                (
                    compensation_mode = 'unpaid'
                    AND pay_multiplier IS NULL
                    AND policy_version IS NULL
                )
                OR (
                    compensation_mode = 'paid_hourly'
                    AND pay_multiplier > 0
                    AND NULLIF(BTRIM(policy_version), '') IS NOT NULL
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_hr_shift_segment_roles_compensation_policy'
    ) THEN
        ALTER TABLE hr_shift_segment_roles
            ADD CONSTRAINT fk_hr_shift_segment_roles_compensation_policy
            FOREIGN KEY (policy_version)
            REFERENCES hr_compensation_policies(policy_version)
            ON UPDATE RESTRICT
            ON DELETE RESTRICT;
    END IF;
END $$;

ALTER TABLE hr_time_records
    ADD COLUMN IF NOT EXISTS compensation_snapshot JSONB;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_hr_time_records_compensation_snapshot_object'
    ) THEN
        ALTER TABLE hr_time_records
            ADD CONSTRAINT chk_hr_time_records_compensation_snapshot_object
            CHECK (
                compensation_snapshot IS NULL
                OR jsonb_typeof(compensation_snapshot) = 'object'
            );
    END IF;
END $$;

COMMENT ON COLUMN hr_shift_segment_roles.compensation_mode IS
    'unpaid keeps legacy informational semantics; paid_hourly is an explicit compensation allocation';
COMMENT ON COLUMN hr_shift_segment_roles.pay_multiplier IS
    'Multiplier captured from the active versioned compensation policy for paid_hourly roles';
COMMENT ON COLUMN hr_shift_segment_roles.policy_version IS
    'Versioned compensation policy that authorized the paid role';
COMMENT ON COLUMN hr_time_records.compensation_snapshot IS
    'Nullable immutable plan/result compensation snapshot; legacy rows remain NULL';
