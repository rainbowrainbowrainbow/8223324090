-- MIGRATION_KIND: mixed
-- SAFETY: Additive append-only composition history for costing groups. Revision 1 copies only existing costing_group_members; no existing rows are updated or deleted. Re-running the seed is idempotent.
-- ROLLBACK: Disable group composition revisions, export the new history tables, and restore from a reviewed database backup; do not rewrite old group rows.
-- DATA_SCOPE: Existing rows in costing_execution_groups and costing_group_members introduced by migration 376 only.

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

INSERT INTO costing_group_revisions (group_id, business_context, revision_number, reason, created_by, created_at)
SELECT id, business_context, 1, 'Initial composition from costing_group_members', created_by, created_at
FROM costing_execution_groups
ON CONFLICT (group_id, revision_number) DO NOTHING;

INSERT INTO costing_group_revision_members
    (revision_id, plan_id, business_context, include_plan_revenue, include_plan_direct_cost)
SELECT r.id, m.plan_id, m.business_context, m.include_plan_revenue, m.include_plan_direct_cost
FROM costing_group_revisions r
JOIN costing_group_members m ON m.group_id=r.group_id AND m.business_context=r.business_context
WHERE r.revision_number=1
ON CONFLICT (revision_id, plan_id) DO NOTHING;

CREATE TRIGGER trg_costing_group_revisions_immutable_v377
BEFORE UPDATE OR DELETE ON costing_group_revisions
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();

CREATE TRIGGER trg_costing_group_revision_members_immutable_v377
BEFORE UPDATE OR DELETE ON costing_group_revision_members
FOR EACH ROW EXECUTE FUNCTION reject_costing_history_mutation_v375();
