-- MIGRATION_KIND: schema
-- SAFETY: Additive payroll period audit table. Existing payroll locks, payroll reports, and finance transactions are not rewritten.
-- ROLLBACK: Export payroll_period_events if audit history is needed, then drop the table and related indexes.

CREATE TABLE IF NOT EXISTS payroll_period_events (
    id BIGSERIAL PRIMARY KEY,
    period_month VARCHAR(7) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    actor VARCHAR(100),
    note TEXT,
    amount NUMERIC(12,2),
    items_count INTEGER,
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_period_events_month') THEN
        ALTER TABLE payroll_period_events ADD CONSTRAINT chk_payroll_period_events_month
            CHECK (period_month ~ '^[0-9]{4}-[0-9]{2}$');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_period_events_type') THEN
        ALTER TABLE payroll_period_events ADD CONSTRAINT chk_payroll_period_events_type
            CHECK (event_type IN ('lock','unlock','commit','reverse'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payroll_period_events_month_created
    ON payroll_period_events(period_month, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_payroll_period_events_type_created
    ON payroll_period_events(event_type, created_at DESC);
