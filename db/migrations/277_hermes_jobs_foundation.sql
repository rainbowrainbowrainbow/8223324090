-- MIGRATION_KIND: schema
-- SAFETY: Additive CRM-side Hermes job foundation. Existing tasks, products, menu photo drafts, and integration idempotency records are not modified.
-- ROLLBACK: Export needed Hermes job records, then DROP INDEX IF EXISTS idx_hermes_job_decisions_external_id, idx_hermes_job_decisions_job_id, idx_hermes_job_events_external_id, idx_hermes_job_events_job_id, idx_hermes_job_assets_external_id, idx_hermes_job_assets_job_id, idx_hermes_jobs_created_at_desc, idx_hermes_jobs_source_entity, idx_hermes_jobs_business_type_status; DROP TABLE IF EXISTS hermes_job_decisions, hermes_job_events, hermes_job_assets, hermes_jobs.

CREATE TABLE IF NOT EXISTS hermes_jobs (
    id                   BIGSERIAL PRIMARY KEY,
    business_context     VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    job_type             VARCHAR(40) NOT NULL,
    status               VARCHAR(40) NOT NULL DEFAULT 'queued',
    title                VARCHAR(240) NOT NULL,
    source_entity_type   VARCHAR(80),
    source_entity_id     VARCHAR(120),
    source_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    hermes_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message        TEXT,
    claim_token          VARCHAR(160),
    claimed_by           VARCHAR(160),
    claimed_at           TIMESTAMPTZ,
    due_at               TIMESTAMPTZ,
    created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_snapshot  VARCHAR(160),
    updated_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by_snapshot  VARCHAR(160),
    completed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT hermes_jobs_type_check
        CHECK (job_type IN ('menu_photo_job', 'creative_material_job')),
    CONSTRAINT hermes_jobs_status_check
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
        )),
    CONSTRAINT hermes_jobs_title_check
        CHECK (NULLIF(BTRIM(title), '') IS NOT NULL),
    CONSTRAINT hermes_jobs_source_entity_check
        CHECK (source_entity_id IS NULL OR NULLIF(BTRIM(source_entity_type), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_hermes_jobs_business_type_status
    ON hermes_jobs(business_context, job_type, status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_hermes_jobs_source_entity
    ON hermes_jobs(business_context, source_entity_type, source_entity_id)
    WHERE source_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hermes_jobs_created_at_desc
    ON hermes_jobs(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS hermes_job_assets (
    id                 BIGSERIAL PRIMARY KEY,
    job_id             BIGINT NOT NULL REFERENCES hermes_jobs(id) ON DELETE CASCADE,
    asset_type         VARCHAR(40) NOT NULL DEFAULT 'result',
    role               VARCHAR(80),
    external_asset_id  VARCHAR(160),
    url                TEXT,
    storage_key        TEXT,
    mime_type          VARCHAR(120),
    checksum_sha256    CHAR(64),
    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT hermes_job_assets_type_check
        CHECK (asset_type IN ('source', 'reference', 'result', 'preview', 'final', 'other')),
    CONSTRAINT hermes_job_assets_location_check
        CHECK (NULLIF(BTRIM(COALESCE(url, '')), '') IS NOT NULL OR NULLIF(BTRIM(COALESCE(storage_key, '')), '') IS NOT NULL),
    CONSTRAINT hermes_job_assets_checksum_check
        CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_hermes_job_assets_job_id
    ON hermes_job_assets(job_id, created_at ASC, id ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_job_assets_external_id
    ON hermes_job_assets(job_id, external_asset_id)
    WHERE external_asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hermes_job_events (
    id                 BIGSERIAL PRIMARY KEY,
    job_id             BIGINT NOT NULL REFERENCES hermes_jobs(id) ON DELETE CASCADE,
    event_type         VARCHAR(80) NOT NULL,
    source             VARCHAR(40) NOT NULL DEFAULT 'crm',
    status_from        VARCHAR(40),
    status_to          VARCHAR(40),
    actor_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_snapshot     VARCHAR(160),
    external_event_id  VARCHAR(160),
    summary            TEXT,
    payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT hermes_job_events_source_check
        CHECK (source IN ('crm', 'hermes', 'system')),
    CONSTRAINT hermes_job_events_status_from_check
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
        )),
    CONSTRAINT hermes_job_events_status_to_check
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
        )),
    CONSTRAINT hermes_job_events_type_check
        CHECK (NULLIF(BTRIM(event_type), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_hermes_job_events_job_id
    ON hermes_job_events(job_id, created_at ASC, id ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_job_events_external_id
    ON hermes_job_events(job_id, external_event_id)
    WHERE external_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hermes_job_decisions (
    id                    BIGSERIAL PRIMARY KEY,
    job_id                BIGINT NOT NULL REFERENCES hermes_jobs(id) ON DELETE CASCADE,
    decision              VARCHAR(40) NOT NULL,
    decided_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_by_snapshot   VARCHAR(160),
    notes                 TEXT,
    external_decision_id  VARCHAR(160),
    decision_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT hermes_job_decisions_value_check
        CHECK (decision IN ('approved', 'rejected', 'revision_requested')),
    CONSTRAINT hermes_job_decisions_notes_check
        CHECK (notes IS NULL OR LENGTH(notes) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_hermes_job_decisions_job_id
    ON hermes_job_decisions(job_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_job_decisions_external_id
    ON hermes_job_decisions(job_id, external_decision_id)
    WHERE external_decision_id IS NOT NULL;
