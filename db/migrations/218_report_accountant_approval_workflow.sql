-- MIGRATION_KIND: schema
-- SAFETY: Additive report approval workflow columns and indexes only; existing reports and tasks are preserved.
-- ROLLBACK: Drop idx_reports_approval_status, idx_reports_approval_task_id, idx_reports_approval_assignee_user_id, then drop the added reports approval columns after exporting approval history if needed.

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS approval_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approval_assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approval_assignee_name VARCHAR(120),
    ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approval_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approval_reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approval_reviewed_by_username VARCHAR(100),
    ADD COLUMN IF NOT EXISTS approval_comment TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reports_approval_status_check'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT reports_approval_status_check
            CHECK (approval_status IN ('none', 'pending', 'task_created', 'in_review', 'approved', 'rejected'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_approval_status
    ON reports(approval_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_approval_task_id
    ON reports(approval_task_id)
    WHERE approval_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_approval_assignee_user_id
    ON reports(approval_assignee_user_id, approval_status)
    WHERE approval_assignee_user_id IS NOT NULL;
