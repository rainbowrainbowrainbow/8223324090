-- MIGRATION_KIND: schema
-- SAFETY: Additive repair for already-created Hermes job tables. Drops and recreates only CHECK constraints; no rows are updated or deleted.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Recreate these three CHECK constraints from the previous desired release definition or database backup. No data rollback is required because this migration changes constraints only.

ALTER TABLE hermes_jobs
    DROP CONSTRAINT IF EXISTS hermes_jobs_status_check;

ALTER TABLE hermes_jobs
    ADD CONSTRAINT hermes_jobs_status_check
    CHECK (status IN (
        'queued',
        'claimed',
        'in_progress',
        'needs_input',
        'ready_for_review',
        'revision_requested',
        'approved',
        'rejected',
        'failed',
        'cancelled'
    )) NOT VALID;

ALTER TABLE hermes_jobs
    VALIDATE CONSTRAINT hermes_jobs_status_check;

ALTER TABLE hermes_job_events
    DROP CONSTRAINT IF EXISTS hermes_job_events_status_from_check;

ALTER TABLE hermes_job_events
    ADD CONSTRAINT hermes_job_events_status_from_check
    CHECK (status_from IS NULL OR status_from IN (
        'queued',
        'claimed',
        'in_progress',
        'needs_input',
        'ready_for_review',
        'revision_requested',
        'approved',
        'rejected',
        'failed',
        'cancelled'
    )) NOT VALID;

ALTER TABLE hermes_job_events
    VALIDATE CONSTRAINT hermes_job_events_status_from_check;

ALTER TABLE hermes_job_events
    DROP CONSTRAINT IF EXISTS hermes_job_events_status_to_check;

ALTER TABLE hermes_job_events
    ADD CONSTRAINT hermes_job_events_status_to_check
    CHECK (status_to IS NULL OR status_to IN (
        'queued',
        'claimed',
        'in_progress',
        'needs_input',
        'ready_for_review',
        'revision_requested',
        'approved',
        'rejected',
        'failed',
        'cancelled'
    )) NOT VALID;

ALTER TABLE hermes_job_events
    VALIDATE CONSTRAINT hermes_job_events_status_to_check;
