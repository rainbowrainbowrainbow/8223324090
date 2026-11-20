-- MIGRATION_KIND: schema
-- SAFETY: Create an empty append-only store for explicit decisions bound to the exact terms and company. No existing data is modified.
-- ROLLBACK: Keep decisions for audit and restore the previous review gates with a compatible release.

CREATE TABLE IF NOT EXISTS hr_payroll_monthly_reviews (
    business_context VARCHAR(64) NOT NULL,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    profession_key VARCHAR(64) NOT NULL REFERENCES hr_professions(key) ON DELETE RESTRICT,
    period_month VARCHAR(7) NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    fingerprint CHAR(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    review JSONB NOT NULL CHECK (jsonb_typeof(review) = 'object'),
    reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
    created_by VARCHAR(100) NOT NULL CHECK (BTRIM(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_context, staff_id, period_month, fingerprint)
);
