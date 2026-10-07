-- MIGRATION_KIND: schema
-- SAFETY: Additive empty costing tables. No existing finance, booking, payroll, or customer rows are rewritten. Version and plan rows are immutable.
-- ROLLBACK: Export costing plan snapshots and template versions, disable the costing UI/API, then drop the new tables and guard function if the feature is retired.

CREATE TABLE IF NOT EXISTS costing_templates (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    kind VARCHAR(32) NOT NULL CHECK (kind IN ('lesson', 'session', 'rental', 'service', 'agency_order', 'admission_day')),
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, business_context)
);

CREATE INDEX IF NOT EXISTS idx_costing_templates_business_kind_v375
    ON costing_templates (business_context, kind, name, id);

CREATE TABLE IF NOT EXISTS costing_template_versions (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    template_id BIGINT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    effective_from DATE NOT NULL,
    definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT costing_template_versions_template_context_fk FOREIGN KEY (template_id, business_context)
        REFERENCES costing_templates(id, business_context) ON DELETE RESTRICT,
    UNIQUE (template_id, version_number),
    UNIQUE (id, business_context)
);

CREATE INDEX IF NOT EXISTS idx_costing_template_versions_effective_v375
    ON costing_template_versions (business_context, template_id, effective_from DESC, version_number DESC);

CREATE TABLE IF NOT EXISTS costing_plan_snapshots (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    template_version_id BIGINT NOT NULL,
    client_key UUID NOT NULL,
    execution_kind VARCHAR(32) NOT NULL CHECK (execution_kind IN ('lesson', 'session', 'rental', 'service', 'agency_order', 'admission_day')),
    execution_label VARCHAR(200) NOT NULL,
    execution_date DATE NOT NULL,
    inputs JSONB NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
    result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    revenue_minor BIGINT NOT NULL CHECK (revenue_minor >= 0),
    direct_cost_minor BIGINT NOT NULL CHECK (direct_cost_minor >= 0),
    contribution_minor BIGINT NOT NULL,
    margin_bps INTEGER,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT costing_plan_snapshots_version_context_fk FOREIGN KEY (template_version_id, business_context)
        REFERENCES costing_template_versions(id, business_context) ON DELETE RESTRICT,
    UNIQUE (business_context, client_key)
);

CREATE INDEX IF NOT EXISTS idx_costing_plan_snapshots_business_date_v375
    ON costing_plan_snapshots (business_context, execution_date DESC, id DESC);

CREATE OR REPLACE FUNCTION reject_costing_history_mutation_v375()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Costing versions and plan snapshots are immutable' USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER trg_costing_template_versions_immutable_v375
BEFORE UPDATE OR DELETE ON costing_template_versions
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();

CREATE TRIGGER trg_costing_plan_snapshots_immutable_v375
BEFORE UPDATE OR DELETE ON costing_plan_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();
