-- MIGRATION_KIND: schema
-- SAFETY: Adds a nullable linked resume file table for HR applications; existing applications and vacancies are not rewritten.
-- ROLLBACK: Drop job_application_resume_files after exporting any uploaded resume binaries that must be retained.

CREATE TABLE IF NOT EXISTS job_application_resume_files (
    id                  SERIAL PRIMARY KEY,
    application_id      INTEGER NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
    original_name       TEXT NOT NULL,
    mime_type           TEXT,
    file_ext            TEXT,
    file_size           INTEGER NOT NULL DEFAULT 0,
    file_data           BYTEA NOT NULL,
    extracted_text      TEXT,
    extraction_status   TEXT NOT NULL DEFAULT 'stored_only'
                        CHECK (extraction_status IN ('extracted', 'stored_only', 'failed')),
    extraction_note     TEXT,
    uploaded_by         TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_application_resume_files_application
    ON job_application_resume_files(application_id, created_at DESC);
