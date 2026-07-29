-- MIGRATION_KIND: schema
-- SAFETY: Additive task metadata only. Columns use IF NOT EXISTS, existing tasks receive postponement_count = 0 from the column default, and no historical rows are inferred or rewritten.
-- ROLLBACK: Stop application reads and writes for postponement metadata, then drop tasks.last_postponed_at, tasks.original_due_at, and tasks.postponement_count after accepting loss of recorded postponement state.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS postponement_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS original_due_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_postponed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN tasks.postponement_count IS
    'Canonical count of qualifying overdue or missed-slot postponements recorded after migration 307.';

COMMENT ON COLUMN tasks.original_due_at IS
    'Canonical due timestamp captured immediately before the first qualifying postponement; never historically backfilled.';

COMMENT ON COLUMN tasks.last_postponed_at IS
    'Timestamp of the most recent qualifying postponement; actor, source, reason, and due transition belong in task_action_history.meta_json.';
