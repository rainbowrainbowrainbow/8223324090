-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable profile/vacancy configuration and empty scoped rule, qualification and commission-input tables. No rates, assignments, payroll history, staff data or company defaults are seeded or rewritten.
-- ROLLBACK: Keep stored rules, qualification history and commission evidence. Recover with a compatible forward release; export these records before any separately approved removal. Legacy NULL rules preserve previous semantics.

ALTER TABLE payroll_profile_versions ADD COLUMN IF NOT EXISTS pay_rules JSONB;
ALTER TABLE payroll_profiles ADD COLUMN IF NOT EXISTS template_origin JSONB;
ALTER TABLE job_vacancies ADD COLUMN IF NOT EXISTS compensation_template JSONB;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_version_rules_v423'
                   AND conrelid = 'payroll_profile_versions'::regclass) THEN
        ALTER TABLE payroll_profile_versions ADD CONSTRAINT chk_payroll_version_rules_v423
            CHECK (pay_rules IS NULL OR (jsonb_typeof(pay_rules) = 'object' AND (pay_rules ->> 'schemaVersion') IS NOT DISTINCT FROM '1'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_vacancy_compensation_template_v423'
                   AND conrelid = 'job_vacancies'::regclass) THEN
        ALTER TABLE job_vacancies ADD CONSTRAINT chk_vacancy_compensation_template_v423
            CHECK (compensation_template IS NULL OR jsonb_typeof(compensation_template) = 'object');
    END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS hr_payroll_rule_defaults (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL CHECK (BTRIM(business_context) <> ''),
    profession_key VARCHAR(64) NOT NULL REFERENCES hr_professions(key) ON DELETE RESTRICT,
    effective_from DATE NOT NULL,
    template JSONB NOT NULL CHECK (jsonb_typeof(template) = 'object'),
    reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
    created_by VARCHAR(100) NOT NULL CHECK (BTRIM(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_context, profession_key, effective_from)
);

CREATE TABLE IF NOT EXISTS hr_qualification_levels (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL CHECK (BTRIM(business_context) <> ''),
    profession_key VARCHAR(64) NOT NULL REFERENCES hr_professions(key) ON DELETE RESTRICT,
    level_key VARCHAR(64) NOT NULL CHECK (level_key ~ '^[a-z][a-z0-9_]*$'),
    title VARCHAR(120) NOT NULL CHECK (BTRIM(title) <> ''),
    rank INTEGER NOT NULL CHECK (rank >= 0),
    profile_id BIGINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_context, profession_key, level_key),
    UNIQUE (id, business_context, profession_key),
    FOREIGN KEY (profile_id, profession_key) REFERENCES payroll_profiles(id, profession_key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hr_staff_qualification_events (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    business_context VARCHAR(64) NOT NULL,
    profession_key VARCHAR(64) NOT NULL,
    level_id BIGINT NOT NULL,
    effective_from DATE NOT NULL,
    reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (staff_id, business_context, profession_key, effective_from),
    FOREIGN KEY (level_id, business_context, profession_key)
        REFERENCES hr_qualification_levels(id, business_context, profession_key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS hr_payroll_component_inputs (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    business_context VARCHAR(64) NOT NULL CHECK (BTRIM(business_context) <> ''),
    period_month VARCHAR(7) NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    basis_key VARCHAR(32) NOT NULL CHECK (basis_key IN ('own_bookings', 'other_bookings', 'manual')),
    version INTEGER NOT NULL CHECK (version > 0),
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    confirmed BOOLEAN NOT NULL DEFAULT false,
    reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
    created_by VARCHAR(100) NOT NULL CHECK (BTRIM(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (staff_id, business_context, period_month, basis_key, version)
);

CREATE INDEX IF NOT EXISTS idx_hr_qualification_history_v423
    ON hr_staff_qualification_events (staff_id, business_context, profession_key, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_hr_component_inputs_period_v423
    ON hr_payroll_component_inputs (business_context, period_month, staff_id);
