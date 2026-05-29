-- MIGRATION_KIND: schema
-- SAFETY: Additive business_context columns and indexes for reports surfaces. Existing rows keep the legacy event_genix scope through DEFAULT/backfill-compatible COALESCE behavior.
-- ROLLBACK: Drop the added indexes and business_context columns from reports, report_templates, and report_table_drafts after exporting any cross-business reports created after this migration.

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';

ALTER TABLE report_templates
    ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';

ALTER TABLE report_table_drafts
    ADD COLUMN IF NOT EXISTS business_context TEXT NOT NULL DEFAULT 'event_genix';

CREATE INDEX IF NOT EXISTS idx_reports_business_context_created
    ON reports(business_context, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_business_context_status
    ON reports(business_context, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_business_context_hashtags
    ON reports(business_context)
    WHERE hashtags IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_templates_business_active_scope
    ON report_templates(business_context, is_active, scope, category);

CREATE INDEX IF NOT EXISTS idx_report_table_drafts_business_owner_status
    ON report_table_drafts(business_context, created_by_username, status, updated_at DESC);
