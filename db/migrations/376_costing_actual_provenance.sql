-- MIGRATION_KIND: schema
-- SAFETY: Additive empty actual/group tables. No existing finance, booking, payroll, or customer rows are changed. All evidence and completion changes append history.
-- ROLLBACK: Export costing actual/group history, disable the costing UI/API, then retire these new tables and their guard triggers after review.

ALTER TABLE costing_plan_snapshots
    ADD CONSTRAINT costing_plan_snapshots_id_context_v376 UNIQUE (id, business_context);

CREATE TABLE IF NOT EXISTS costing_execution_groups (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('course', 'session', 'day')),
    label VARCHAR(200) NOT NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, business_context)
);

CREATE TABLE IF NOT EXISTS costing_group_members (
    group_id BIGINT NOT NULL,
    plan_id BIGINT NOT NULL UNIQUE,
    business_context VARCHAR(64) NOT NULL,
    include_plan_revenue BOOLEAN NOT NULL,
    include_plan_direct_cost BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, plan_id),
    FOREIGN KEY (group_id, business_context) REFERENCES costing_execution_groups(id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (plan_id, business_context) REFERENCES costing_plan_snapshots(id, business_context) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS costing_actual_sources (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    plan_id BIGINT,
    group_id BIGINT,
    source_system VARCHAR(40) NOT NULL,
    external_id VARCHAR(120) NOT NULL,
    economic_role VARCHAR(80) NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('revenue', 'direct_cost')),
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((plan_id IS NOT NULL) <> (group_id IS NOT NULL)),
    FOREIGN KEY (plan_id, business_context) REFERENCES costing_plan_snapshots(id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (group_id, business_context) REFERENCES costing_execution_groups(id, business_context) ON DELETE RESTRICT,
    UNIQUE (id, business_context),
    UNIQUE (business_context, source_system, external_id)
);

CREATE INDEX IF NOT EXISTS idx_costing_actual_sources_target_v376
    ON costing_actual_sources (business_context, plan_id, group_id);

CREATE TABLE IF NOT EXISTS costing_actual_entries (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    source_id BIGINT NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    entry_type VARCHAR(12) NOT NULL CHECK (entry_type IN ('record', 'reversal')),
    amount_minor BIGINT NOT NULL,
    evidence_state VARCHAR(12) NOT NULL CHECK (evidence_state IN ('estimate', 'confirmed')),
    semantic VARCHAR(20) NOT NULL CHECK (semantic IN ('charge', 'refund', 'adjustment', 'cost')),
    reason VARCHAR(300),
    reverses_entry_id BIGINT UNIQUE REFERENCES costing_actual_entries(id) ON DELETE RESTRICT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (source_id, business_context) REFERENCES costing_actual_sources(id, business_context) ON DELETE RESTRICT,
    CHECK ((entry_type = 'reversal') = (reverses_entry_id IS NOT NULL)),
    UNIQUE (source_id, revision_number, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_costing_actual_entries_source_v376
    ON costing_actual_entries (source_id, revision_number DESC, id DESC);

CREATE TABLE IF NOT EXISTS costing_actual_completions (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    plan_id BIGINT,
    group_id BIGINT,
    category VARCHAR(20) NOT NULL CHECK (category IN ('revenue', 'direct_cost')),
    is_complete BOOLEAN NOT NULL,
    evidence_entry_id BIGINT NOT NULL DEFAULT 0 CHECK (evidence_entry_id >= 0),
    reason VARCHAR(300) NOT NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((plan_id IS NOT NULL) <> (group_id IS NOT NULL)),
    FOREIGN KEY (plan_id, business_context) REFERENCES costing_plan_snapshots(id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (group_id, business_context) REFERENCES costing_execution_groups(id, business_context) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_costing_actual_completions_target_v376
    ON costing_actual_completions (business_context, plan_id, group_id, category, id DESC);

CREATE TRIGGER trg_costing_execution_groups_immutable_v376
BEFORE UPDATE OR DELETE ON costing_execution_groups
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();

CREATE TRIGGER trg_costing_group_members_immutable_v376
BEFORE UPDATE OR DELETE ON costing_group_members
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();

CREATE TRIGGER trg_costing_actual_sources_immutable_v376
BEFORE UPDATE OR DELETE ON costing_actual_sources
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();

CREATE TRIGGER trg_costing_actual_entries_immutable_v376
BEFORE UPDATE OR DELETE ON costing_actual_entries
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();

CREATE TRIGGER trg_costing_actual_completions_immutable_v376
BEFORE UPDATE OR DELETE ON costing_actual_completions
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();
