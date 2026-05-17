-- MIGRATION_KIND: schema
-- SAFETY: Additive payroll scheme, entry, and report snapshot tables only; no existing salary, staff, finance, or HR rows are rewritten.
-- ROLLBACK: Drop payroll_reports, payroll_entries, payroll_schemes, and related indexes/constraints after exporting any payroll snapshots that must be preserved.

CREATE TABLE IF NOT EXISTS payroll_schemes (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    scheme_type VARCHAR(32) NOT NULL,
    title VARCHAR(160),
    is_active BOOLEAN NOT NULL DEFAULT true,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    effective_from DATE,
    effective_to DATE,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_entries (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    scheme_id BIGINT REFERENCES payroll_schemes(id) ON DELETE SET NULL,
    period_month VARCHAR(7) NOT NULL,
    line_type VARCHAR(32) NOT NULL,
    label VARCHAR(160),
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity NUMERIC(12,2),
    rate NUMERIC(12,2),
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_reports (
    id BIGSERIAL PRIMARY KEY,
    period_month VARCHAR(7) NOT NULL,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    scheme_id BIGINT REFERENCES payroll_schemes(id) ON DELETE SET NULL,
    gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    deductions_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    advances_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_at TIMESTAMPTZ,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_payroll_reports_period_staff UNIQUE (period_month, staff_id)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_schemes_type') THEN
        ALTER TABLE payroll_schemes ADD CONSTRAINT chk_payroll_schemes_type
            CHECK (scheme_type IN ('per_shift','hourly','monthly_fixed','percent','hybrid','manual'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_schemes_effective_range') THEN
        ALTER TABLE payroll_schemes ADD CONSTRAINT chk_payroll_schemes_effective_range
            CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_entries_month') THEN
        ALTER TABLE payroll_entries ADD CONSTRAINT chk_payroll_entries_month
            CHECK (period_month ~ '^[0-9]{4}-[0-9]{2}$');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_entries_line_type') THEN
        ALTER TABLE payroll_entries ADD CONSTRAINT chk_payroll_entries_line_type
            CHECK (line_type IN ('base','bonus','deduction','advance','percent','manual','adjustment'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_reports_month') THEN
        ALTER TABLE payroll_reports ADD CONSTRAINT chk_payroll_reports_month
            CHECK (period_month ~ '^[0-9]{4}-[0-9]{2}$');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_reports_status') THEN
        ALTER TABLE payroll_reports ADD CONSTRAINT chk_payroll_reports_status
            CHECK (status IN ('draft','reviewed','approved','paid'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_schemes_active_staff
    ON payroll_schemes(staff_id)
    WHERE is_active = true AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_schemes_staff_active
    ON payroll_schemes(staff_id, is_active, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_staff_month
    ON payroll_entries(staff_id, period_month);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_scheme
    ON payroll_entries(scheme_id)
    WHERE scheme_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_reports_month_status
    ON payroll_reports(period_month, status);

CREATE INDEX IF NOT EXISTS idx_payroll_reports_staff_month
    ON payroll_reports(staff_id, period_month);
