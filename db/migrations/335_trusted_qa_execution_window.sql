-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable exact execution-window constraints to trusted QA runs only. Existing runs remain valid; no QA run, booking, customer, cleanup, or backfill is created or mutated.
-- DATA_SCOPE: schema-only trusted QA line/date/time authorization metadata.
-- ROLLBACK: Disable trusted QA creation first, then ALTER TABLE trusted_qa_runs DROP COLUMN IF EXISTS required_line_id, DROP COLUMN IF EXISTS allowed_date, DROP COLUMN IF EXISTS allowed_start_time, DROP COLUMN IF EXISTS allowed_end_time.

ALTER TABLE trusted_qa_runs
    ADD COLUMN IF NOT EXISTS required_line_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS allowed_date DATE,
    ADD COLUMN IF NOT EXISTS allowed_start_time TIME,
    ADD COLUMN IF NOT EXISTS allowed_end_time TIME;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_trusted_qa_runs_execution_window_v335'
    ) THEN
        ALTER TABLE trusted_qa_runs
            ADD CONSTRAINT chk_trusted_qa_runs_execution_window_v335
            CHECK (
                (allowed_date IS NULL AND allowed_start_time IS NULL AND allowed_end_time IS NULL)
                OR (
                    allowed_date IS NOT NULL
                    AND allowed_start_time IS NOT NULL
                    AND allowed_end_time IS NOT NULL
                    AND allowed_start_time < allowed_end_time
                )
            );
    END IF;
END $$;

COMMENT ON COLUMN trusted_qa_runs.required_line_id IS
    'Exact roster-backed timeline line approved for this trusted QA run.';

COMMENT ON COLUMN trusted_qa_runs.allowed_date IS
    'Exact business date approved for trusted QA booking creation.';

COMMENT ON COLUMN trusted_qa_runs.allowed_start_time IS
    'Inclusive start of the approved trusted QA creation window.';

COMMENT ON COLUMN trusted_qa_runs.allowed_end_time IS
    'Inclusive booking-end boundary of the approved trusted QA creation window.';
