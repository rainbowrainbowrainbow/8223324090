-- MIGRATION_KIND: schema
-- SAFETY: Additive empty costing-domain attestation and reconciliation tables. Existing finance, payment, payroll, booking, and historical costing rows are unchanged.
-- ROLLBACK: Disable the management P&L route, export these immutable events for review, then retire only these new tables if the feature is withdrawn.

CREATE TABLE IF NOT EXISTS costing_performance_events (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    plan_id BIGINT NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    state VARCHAR(16) NOT NULL CHECK (state IN ('performed', 'voided')),
    performed_on DATE,
    evidence_type VARCHAR(16) NOT NULL CHECK (evidence_type IN ('operator', 'attendance')),
    evidence_id VARCHAR(50),
    reason VARCHAR(300) NOT NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((state = 'performed') = (performed_on IS NOT NULL)),
    CHECK ((evidence_type = 'attendance') = (evidence_id IS NOT NULL)),
    FOREIGN KEY (plan_id, business_context) REFERENCES costing_plan_snapshots(id, business_context) ON DELETE RESTRICT,
    UNIQUE (plan_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_costing_performance_latest_v378
    ON costing_performance_events (business_context, plan_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS costing_management_links (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    plan_id BIGINT NOT NULL,
    source_id BIGINT NOT NULL,
    entry_id BIGINT NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    kind VARCHAR(24) NOT NULL CHECK (kind IN ('earned_revenue', 'direct_cost', 'piecework', 'hourly', 'revenue_correction', 'unresolved')),
    amount_minor BIGINT NOT NULL,
    effect_on DATE NOT NULL,
    finance_transaction_id INTEGER,
    payment_order_id BIGINT,
    payment_refund_id BIGINT,
    original_link_id BIGINT REFERENCES costing_management_links(id) ON DELETE RESTRICT,
    payroll_installment_id BIGINT,
    hr_time_record_id INTEGER,
    confirmed_minutes INTEGER CHECK (confirmed_minutes > 0),
    hourly_rate_minor BIGINT CHECK (hourly_rate_minor >= 0),
    reason VARCHAR(300) NOT NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (plan_id, business_context) REFERENCES costing_plan_snapshots(id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (source_id, business_context) REFERENCES costing_actual_sources(id, business_context) ON DELETE RESTRICT,
    UNIQUE (source_id, revision_number),
    CHECK (kind <> 'earned_revenue' OR (amount_minor > 0 AND finance_transaction_id IS NOT NULL)),
    CHECK (kind <> 'direct_cost' OR (amount_minor >= 0 AND finance_transaction_id IS NOT NULL)),
    CHECK (kind NOT IN ('piecework', 'hourly') OR
        (amount_minor >= 0 AND finance_transaction_id IS NOT NULL AND payroll_installment_id IS NOT NULL)),
    CHECK (kind <> 'hourly' OR (hr_time_record_id IS NOT NULL AND confirmed_minutes IS NOT NULL AND hourly_rate_minor IS NOT NULL)),
    CHECK (kind <> 'revenue_correction' OR (amount_minor < 0 AND original_link_id IS NOT NULL)),
    CHECK (kind <> 'unresolved' OR finance_transaction_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_costing_management_links_business_date_v378
    ON costing_management_links (business_context, effect_on, id);
CREATE INDEX IF NOT EXISTS idx_costing_management_links_source_v378
    ON costing_management_links (source_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_costing_management_links_finance_v378
    ON costing_management_links (business_context, finance_transaction_id)
    WHERE finance_transaction_id IS NOT NULL;

CREATE TRIGGER trg_costing_performance_events_immutable_v378
BEFORE UPDATE OR DELETE ON costing_performance_events
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();

CREATE TRIGGER trg_costing_management_links_immutable_v378
BEFORE UPDATE OR DELETE ON costing_management_links
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();
