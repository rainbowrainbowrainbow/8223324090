-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable idempotency/report reference metadata for report-bot submissions; existing submissions remain unchanged.
-- ROLLBACK: Drop idx_rbs_idempotency_key plus report_bot_submissions.idempotency_key and report_bot_submissions.report_id if the submit integrity path is reverted.

ALTER TABLE report_bot_submissions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(220);
ALTER TABLE report_bot_submissions ADD COLUMN IF NOT EXISTS report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rbs_idempotency_key
    ON report_bot_submissions(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_rbs_report_id
    ON report_bot_submissions(report_id);
