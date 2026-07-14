-- MIGRATION_KIND: schema
-- SAFETY: Additive Hermes schedule-import metadata table, indexes, constraints, and preview immutability trigger. Existing schedules, Hermes jobs, and business data are not read or modified.
-- ROLLBACK: Export any required import audit records, then DROP TRIGGER IF EXISTS trg_hermes_schedule_imports_preview_immutable ON hermes_schedule_imports; DROP FUNCTION IF EXISTS guard_hermes_schedule_import_preview_immutable(); DROP INDEX IF EXISTS idx_hermes_schedule_imports_dedupe, idx_hermes_schedule_imports_status_expires, idx_hermes_schedule_imports_public_id; DROP TABLE IF EXISTS hermes_schedule_imports.

CREATE TABLE IF NOT EXISTS hermes_schedule_imports (
    id                       BIGSERIAL PRIMARY KEY,
    public_id                VARCHAR(80) NOT NULL,
    business_context         VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    status                   VARCHAR(32) NOT NULL DEFAULT 'draft',
    source                   VARCHAR(48) NOT NULL,
    source_reference         JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_dedupe_key        CHAR(64),
    document_date            DATE,
    extracted_rows           JSONB NOT NULL DEFAULT '[]'::jsonb,
    preview_rows             JSONB NOT NULL DEFAULT '[]'::jsonb,
    current_state_snapshot   JSONB NOT NULL DEFAULT '[]'::jsonb,
    preview_hash             CHAR(64),
    expires_at               TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_by_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    applied_by_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    apply_result             JSONB,
    error_message            TEXT,
    applied_at               TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT hermes_schedule_imports_public_id_check
        CHECK (public_id ~ '^hsi_[a-z0-9-]{16,72}$'),
    CONSTRAINT hermes_schedule_imports_business_context_check
        CHECK (NULLIF(BTRIM(business_context), '') IS NOT NULL),
    CONSTRAINT hermes_schedule_imports_status_check
        CHECK (status IN (
            'draft',
            'needs_review',
            'ready',
            'applied',
            'cancelled',
            'expired',
            'failed'
        )),
    CONSTRAINT hermes_schedule_imports_source_check
        CHECK (NULLIF(BTRIM(source), '') IS NOT NULL),
    CONSTRAINT hermes_schedule_imports_source_reference_object_check
        CHECK (jsonb_typeof(source_reference) = 'object'),
    CONSTRAINT hermes_schedule_imports_source_reference_sensitive_check
        CHECK (NOT (source_reference ?| ARRAY[
            'photo_binary', 'photoBinary', 'telegram_bot_token', 'telegramBotToken',
            'api_key', 'apiKey', 'cookies', 'raw_headers', 'rawHeaders', 'headers'
        ])),
    CONSTRAINT hermes_schedule_imports_dedupe_key_check
        CHECK (source_dedupe_key IS NULL OR source_dedupe_key ~ '^[a-f0-9]{64}$'),
    CONSTRAINT hermes_schedule_imports_extracted_rows_check
        CHECK (jsonb_typeof(extracted_rows) = 'array'),
    CONSTRAINT hermes_schedule_imports_preview_rows_check
        CHECK (jsonb_typeof(preview_rows) = 'array'),
    CONSTRAINT hermes_schedule_imports_current_state_snapshot_check
        CHECK (jsonb_typeof(current_state_snapshot) = 'array'),
    CONSTRAINT hermes_schedule_imports_preview_hash_check
        CHECK (preview_hash IS NULL OR preview_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT hermes_schedule_imports_ready_preview_check
        CHECK (status NOT IN ('ready', 'applied') OR preview_hash IS NOT NULL),
    CONSTRAINT hermes_schedule_imports_applied_fields_check
        CHECK (
            (status = 'applied' AND applied_at IS NOT NULL AND apply_result IS NOT NULL)
            OR status <> 'applied'
        ),
    CONSTRAINT hermes_schedule_imports_expiry_check
        CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_schedule_imports_public_id
    ON hermes_schedule_imports(public_id);

CREATE INDEX IF NOT EXISTS idx_hermes_schedule_imports_status_expires
    ON hermes_schedule_imports(status, expires_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_schedule_imports_dedupe
    ON hermes_schedule_imports(business_context, source_dedupe_key)
    WHERE source_dedupe_key IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_hermes_schedule_import_preview_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.public_id IS DISTINCT FROM OLD.public_id
       OR NEW.business_context IS DISTINCT FROM OLD.business_context
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
       OR NEW.source_dedupe_key IS DISTINCT FROM OLD.source_dedupe_key THEN
        RAISE EXCEPTION 'Hermes schedule import source identity is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF NOT (
        (OLD.status = 'draft' AND NEW.status IN ('draft', 'needs_review', 'ready', 'cancelled', 'expired', 'failed'))
        OR (OLD.status = 'needs_review' AND NEW.status IN ('needs_review', 'ready', 'cancelled', 'expired', 'failed'))
        OR (OLD.status = 'ready' AND NEW.status IN ('ready', 'applied', 'cancelled', 'expired', 'failed'))
        OR (OLD.status IN ('applied', 'cancelled', 'expired', 'failed') AND NEW.status = OLD.status)
    ) THEN
        RAISE EXCEPTION 'Invalid Hermes schedule import status transition: % -> %', OLD.status, NEW.status
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status NOT IN ('draft', 'needs_review')
       AND (
            NEW.document_date IS DISTINCT FROM OLD.document_date
            OR NEW.extracted_rows IS DISTINCT FROM OLD.extracted_rows
            OR NEW.preview_rows IS DISTINCT FROM OLD.preview_rows
            OR NEW.current_state_snapshot IS DISTINCT FROM OLD.current_state_snapshot
            OR NEW.preview_hash IS DISTINCT FROM OLD.preview_hash
       ) THEN
        RAISE EXCEPTION 'Hermes schedule import preview is immutable after ready'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'applied'
       AND (
            NEW.applied_by_user_id IS DISTINCT FROM OLD.applied_by_user_id
            OR NEW.apply_result IS DISTINCT FROM OLD.apply_result
            OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
       ) THEN
        RAISE EXCEPTION 'Hermes schedule import apply result is immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_hermes_schedule_imports_preview_immutable'
          AND tgrelid = 'hermes_schedule_imports'::regclass
          AND NOT tgisinternal
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_hermes_schedule_imports_preview_immutable
                 BEFORE UPDATE ON hermes_schedule_imports
                 FOR EACH ROW
                 EXECUTE FUNCTION guard_hermes_schedule_import_preview_immutable()';
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_hermes_schedule_imports_updated_at'
          AND tgrelid = 'hermes_schedule_imports'::regclass
          AND NOT tgisinternal
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_hermes_schedule_imports_updated_at
                 BEFORE UPDATE ON hermes_schedule_imports
                 FOR EACH ROW
                 EXECUTE FUNCTION update_updated_at_column()';
    END IF;
END;
$$;
