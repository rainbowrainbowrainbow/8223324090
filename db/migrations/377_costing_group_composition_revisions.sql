-- MIGRATION_KIND: schema
-- SAFETY: Fresh-install-only additive schema. Lock and reject pre-existing costing groups or members before creating revision tables; no group data is copied or changed. Existing-group upgrades require a separate reviewed backfill.
-- ROLLBACK: Disable composition revision reads and retain the additive tables for a reviewed forward recovery; do not rewrite group rows.

-- The migration runner wraps this file in one transaction. SHARE locks block
-- concurrent inserts until the empty-source check and DDL commit or roll back.
LOCK TABLE costing_execution_groups, costing_group_members IN SHARE MODE;

DO $fresh_only$
BEGIN
    IF EXISTS (SELECT 1 FROM costing_execution_groups LIMIT 1)
        OR EXISTS (SELECT 1 FROM costing_group_members LIMIT 1) THEN
        RAISE EXCEPTION 'COSTING_FRESH_ONLY_NONEMPTY_GROUPS: reviewed history backfill required';
    END IF;
END;
$fresh_only$;

CREATE TABLE IF NOT EXISTS costing_group_revisions (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    business_context VARCHAR(64) NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    reason VARCHAR(300) NOT NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (group_id, business_context) REFERENCES costing_execution_groups(id, business_context) ON DELETE RESTRICT,
    UNIQUE (group_id, revision_number),
    UNIQUE (id, business_context)
);

CREATE TABLE IF NOT EXISTS costing_group_revision_members (
    revision_id BIGINT NOT NULL,
    plan_id BIGINT NOT NULL,
    business_context VARCHAR(64) NOT NULL,
    include_plan_revenue BOOLEAN NOT NULL,
    include_plan_direct_cost BOOLEAN NOT NULL,
    PRIMARY KEY (revision_id, plan_id),
    CHECK (include_plan_revenue OR include_plan_direct_cost),
    FOREIGN KEY (revision_id, business_context) REFERENCES costing_group_revisions(id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (plan_id, business_context) REFERENCES costing_plan_snapshots(id, business_context) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_costing_group_revisions_latest_v377
    ON costing_group_revisions (group_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_costing_group_revision_members_plan_v377
    ON costing_group_revision_members (business_context, plan_id);

CREATE TRIGGER trg_costing_group_revisions_immutable_v377
BEFORE UPDATE OR DELETE ON costing_group_revisions
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();

CREATE TRIGGER trg_costing_group_revision_members_immutable_v377
BEFORE UPDATE OR DELETE ON costing_group_revision_members
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();
