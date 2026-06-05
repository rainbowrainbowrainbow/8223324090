-- MIGRATION_KIND: schema
-- SAFETY: Additive HR role-assignment foundation. Creates a normalized role/status table and backfills it from existing staff role_type, secondary_professions, and profession rates without deleting or rewriting the legacy fields.
-- ROLLBACK: Export staff_role_assignments if its history must be preserved, then drop staff_role_assignments and related indexes. Legacy staff role_type, secondary_professions, and staff_profession_rates remain intact.

CREATE TABLE IF NOT EXISTS staff_role_assignments (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    profession_key VARCHAR(64) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    admission_status VARCHAR(32) NOT NULL DEFAULT 'pending',
    internship_status VARCHAR(32) NOT NULL DEFAULT 'none',
    hourly_rate NUMERIC(10,2),
    payroll_scheme_id BIGINT REFERENCES payroll_schemes(id) ON DELETE SET NULL,
    notes TEXT,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_staff_role_assignments_staff_profession UNIQUE (staff_id, profession_key)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_role_assignments_status') THEN
        ALTER TABLE staff_role_assignments ADD CONSTRAINT chk_staff_role_assignments_status
            CHECK (status IN ('active','inactive','suspended'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_role_assignments_admission') THEN
        ALTER TABLE staff_role_assignments ADD CONSTRAINT chk_staff_role_assignments_admission
            CHECK (admission_status IN ('pending','approved','blocked'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_role_assignments_internship') THEN
        ALTER TABLE staff_role_assignments ADD CONSTRAINT chk_staff_role_assignments_internship
            CHECK (internship_status IN ('none','in_progress','completed'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_role_assignments_primary
    ON staff_role_assignments(staff_id)
    WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_staff_role_assignments_staff_status
    ON staff_role_assignments(staff_id, status, is_primary DESC);

CREATE INDEX IF NOT EXISTS idx_staff_role_assignments_profession
    ON staff_role_assignments(profession_key, status);

CREATE INDEX IF NOT EXISTS idx_staff_role_assignments_payroll_scheme
    ON staff_role_assignments(payroll_scheme_id)
    WHERE payroll_scheme_id IS NOT NULL;

INSERT INTO staff_role_assignments
    (staff_id, profession_key, is_primary, status, admission_status, internship_status, hourly_rate, created_by, updated_by)
SELECT
    s.id,
    lower(regexp_replace(trim(s.role_type), '[^a-zA-Z0-9_:-]+', '_', 'g')),
    true,
    CASE WHEN COALESCE(s.is_active, true) THEN 'active' ELSE 'inactive' END,
    'approved',
    CASE WHEN lower(trim(s.role_type)) = 'intern' THEN 'in_progress' ELSE 'none' END,
    NULLIF(s.hourly_rate, 0),
    'migration_252',
    'migration_252'
FROM staff s
WHERE NULLIF(trim(COALESCE(s.role_type, '')), '') IS NOT NULL
ON CONFLICT (staff_id, profession_key) DO UPDATE SET
    is_primary = CASE WHEN staff_role_assignments.is_primary THEN true ELSE EXCLUDED.is_primary END,
    hourly_rate = COALESCE(staff_role_assignments.hourly_rate, EXCLUDED.hourly_rate),
    updated_at = NOW(),
    updated_by = EXCLUDED.updated_by;

INSERT INTO staff_role_assignments
    (staff_id, profession_key, is_primary, status, admission_status, internship_status, hourly_rate, created_by, updated_by)
SELECT
    s.id,
    lower(regexp_replace(trim(p.profession_key), '[^a-zA-Z0-9_:-]+', '_', 'g')),
    false,
    CASE WHEN COALESCE(s.is_active, true) THEN 'active' ELSE 'inactive' END,
    'pending',
    CASE WHEN lower(trim(p.profession_key)) = 'intern' THEN 'in_progress' ELSE 'none' END,
    NULL,
    'migration_252',
    'migration_252'
FROM staff s
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.secondary_professions, '[]'::jsonb)) AS p(profession_key)
WHERE NULLIF(trim(COALESCE(p.profession_key, '')), '') IS NOT NULL
ON CONFLICT (staff_id, profession_key) DO NOTHING;

UPDATE staff_role_assignments sra
SET hourly_rate = spr.hourly_rate,
    updated_at = NOW(),
    updated_by = 'migration_252'
FROM staff_profession_rates spr
WHERE spr.staff_id = sra.staff_id
  AND spr.profession_key = sra.profession_key
  AND spr.hourly_rate IS NOT NULL
  AND spr.hourly_rate > 0
  AND sra.hourly_rate IS NULL;
