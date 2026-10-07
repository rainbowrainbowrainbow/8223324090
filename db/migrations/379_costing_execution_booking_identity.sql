-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable identity on immutable costing snapshots; existing plans remain unlinked and no booking rows are changed or inferred.
-- ROLLBACK: Disable new management links, export any new costing snapshots for review, then drop this costing-only column if the feature is withdrawn.

ALTER TABLE costing_plan_snapshots
    ADD COLUMN IF NOT EXISTS booking_id VARCHAR(50);
