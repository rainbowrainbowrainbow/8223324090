-- MIGRATION_KIND: schema
-- SAFETY: Additive tables and indexes only; existing HR data and permissions are unchanged.
-- ROLLBACK: Drop hr_attendance_document_jobs first, then hr_attendance_document_automations.

CREATE TABLE IF NOT EXISTS hr_attendance_document_automations (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    document_type VARCHAR(32) NOT NULL CHECK (document_type IN ('arrival_inout', 'month_grid')),
    category_ids TEXT[] NOT NULL,
    schedule_kind VARCHAR(32) NOT NULL CHECK (schedule_kind IN ('weekly', 'first_day_month')),
    weekdays SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::SMALLINT[],
    local_time TIME NOT NULL DEFAULT '08:00',
    copies SMALLINT NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 10),
    settings_json JSONB NOT NULL DEFAULT '{}'::JSONB,
    selection_hash CHAR(64) NOT NULL CHECK (selection_hash ~ '^[0-9a-f]{64}$'),
    template_version VARCHAR(32) NOT NULL DEFAULT 'v27',
    artifact_ttl_hours INTEGER NOT NULL DEFAULT 168 CHECK (artifact_ttl_hours BETWEEN 1 AND 720),
    catch_up_minutes INTEGER NOT NULL DEFAULT 120 CHECK (catch_up_minutes BETWEEN 1 AND 360),
    printer_target_key VARCHAR(80) NOT NULL DEFAULT 'queue_only',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_enqueued_local_date DATE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(120),
    updated_by_name VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (cardinality(category_ids) > 0),
    CHECK (cardinality(weekdays) > 0),
    CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]),
    CHECK (
        (document_type = 'arrival_inout' AND schedule_kind = 'weekly')
        OR (document_type = 'month_grid' AND schedule_kind = 'first_day_month')
    )
);

CREATE TABLE IF NOT EXISTS hr_attendance_document_jobs (
    id BIGSERIAL PRIMARY KEY,
    automation_id BIGINT NOT NULL REFERENCES hr_attendance_document_automations(id) ON DELETE CASCADE,
    trigger_kind VARCHAR(24) NOT NULL CHECK (trigger_kind IN ('scheduled', 'manual')),
    local_date DATE NOT NULL,
    document_type VARCHAR(32) NOT NULL CHECK (document_type IN ('arrival_inout', 'month_grid')),
    selection_hash CHAR(64) NOT NULL CHECK (selection_hash ~ '^[0-9a-f]{64}$'),
    idempotency_key CHAR(64) NOT NULL UNIQUE CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
    status VARCHAR(32) NOT NULL DEFAULT 'building' CHECK (status IN (
        'building', 'queued', 'claimed', 'printing', 'completed',
        'failed', 'cancelled', 'unknown_outcome', 'expired'
    )),
    settings_snapshot JSONB NOT NULL,
    roster_snapshot JSONB,
    template_version VARCHAR(32) NOT NULL DEFAULT 'v27',
    pdf_data BYTEA,
    pdf_sha256 CHAR(64),
    pdf_byte_length INTEGER,
    filename VARCHAR(180),
    copies SMALLINT NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 10),
    printer_target_key VARCHAR(80) NOT NULL DEFAULT 'queue_only',
    claim_token UUID,
    claimed_by VARCHAR(120),
    locked_until TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    requeue_count INTEGER NOT NULL DEFAULT 0,
    print_deadline_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    queued_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    error_code VARCHAR(80),
    error_message VARCHAR(500),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((pdf_data IS NULL AND pdf_byte_length IS NULL) OR octet_length(pdf_data) = pdf_byte_length)
);

CREATE INDEX IF NOT EXISTS idx_hr_attendance_document_automations_due
    ON hr_attendance_document_automations (enabled, local_time, id);

CREATE INDEX IF NOT EXISTS idx_hr_attendance_document_jobs_status
    ON hr_attendance_document_jobs (status, locked_until, created_at);

CREATE INDEX IF NOT EXISTS idx_hr_attendance_document_jobs_automation_date
    ON hr_attendance_document_jobs (automation_id, local_date DESC, created_at DESC);
