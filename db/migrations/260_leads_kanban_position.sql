-- MIGRATION_KIND: schema
-- SAFETY: Adds a nullable Kanban position to leads for durable in-column ordering. Existing lead rows keep their current created_at ordering until moved.
-- ROLLBACK: DROP INDEX IF EXISTS idx_leads_business_stage_kanban_position; ALTER TABLE leads DROP COLUMN IF EXISTS kanban_position;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS kanban_position NUMERIC;

CREATE INDEX IF NOT EXISTS idx_leads_business_stage_kanban_position
    ON leads (business_context, pipeline_stage, kanban_position, created_at DESC);
