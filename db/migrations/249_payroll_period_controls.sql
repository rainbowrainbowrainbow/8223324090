-- MIGRATION_KIND: schema
-- SAFETY: Additive payroll period controls and report metadata. Existing payroll and finance rows are preserved; only the payroll report status check is widened to support voided/reversed states.
-- ROLLBACK: Export payroll_period_locks and payroll_reports metadata if needed, then drop payroll_period_locks, added payroll_reports columns, related indexes, and restore the previous payroll_reports status check.
-- OPERATOR_APPROVAL: required

CREATE TABLE IF NOT EXISTS payroll_period_locks (
    id BIGSERIAL PRIMARY KEY,
    period_month VARCHAR(7) NOT NULL UNIQUE,
    is_locked BOOLEAN NOT NULL DEFAULT false,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(100),
    unlocked_at TIMESTAMPTZ,
    unlocked_by VARCHAR(100),
    note TEXT,
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payroll_reports
    ADD COLUMN IF NOT EXISTS finance_transaction_id INTEGER REFERENCES finance_transactions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reversal_transaction_id INTEGER REFERENCES finance_transactions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS committed_by VARCHAR(100),
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_by VARCHAR(100),
    ADD COLUMN IF NOT EXISTS void_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_period_locks_month') THEN
        ALTER TABLE payroll_period_locks ADD CONSTRAINT chk_payroll_period_locks_month
            CHECK (period_month ~ '^[0-9]{4}-[0-9]{2}$');
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_reports_status') THEN
        ALTER TABLE payroll_reports DROP CONSTRAINT chk_payroll_reports_status;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_reports_status') THEN
        ALTER TABLE payroll_reports ADD CONSTRAINT chk_payroll_reports_status
            CHECK (status IN ('draft','reviewed','approved','paid','voided','reversed'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payroll_period_locks_month_locked
    ON payroll_period_locks(period_month, is_locked);

CREATE INDEX IF NOT EXISTS idx_payroll_reports_month_status_void
    ON payroll_reports(period_month, status, voided_at);

CREATE INDEX IF NOT EXISTS idx_payroll_reports_finance_transaction
    ON payroll_reports(finance_transaction_id)
    WHERE finance_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_transactions_salary_method_date
    ON finance_transactions(payment_method, date, staff_id)
    WHERE payment_method IN ('salary', 'salary_reversal');
