-- MIGRATION_KIND: schema
-- SAFETY: Additive isolated CRM OCR execution/preview metadata only. No staff, schedule, attendance, compensation or payroll data is changed. Execution flags remain disabled.
-- ROLLBACK: Disable new OCR requests, retain/export receipts and previews, then drop the two new tables and guard functions only under a separately reviewed destructive rollback. Do not erase unknown paid outcomes to retry them.

CREATE TABLE IF NOT EXISTS crm_attendance_ocr_executions (
    id UUID PRIMARY KEY,
    business_context TEXT NOT NULL CHECK (business_context = 'event_genix'),
    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    document_date DATE NOT NULL,
    image_sha256 CHAR(64) NOT NULL CHECK (image_sha256 ~ '^[a-f0-9]{64}$'),
    provider TEXT NOT NULL CHECK (provider = 'kie'),
    model TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'reviewed', 'unknown')),
    provider_receipt JSONB CHECK (provider_receipt IS NULL OR jsonb_typeof(provider_receipt) = 'object'),
    review_document JSONB CHECK (review_document IS NULL OR jsonb_typeof(review_document) = 'object'),
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_context, actor_user_id, document_date, image_sha256),
    CHECK ((status = 'reviewed') = (review_document IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS crm_attendance_ocr_previews (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL REFERENCES crm_attendance_ocr_executions(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    preview_rows JSONB NOT NULL CHECK (jsonb_typeof(preview_rows) = 'array'),
    state_snapshot JSONB NOT NULL CHECK (jsonb_typeof(state_snapshot) = 'object'),
    preview_hash CHAR(64) NOT NULL CHECK (preview_hash ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
    applied_at TIMESTAMPTZ,
    apply_result JSONB CHECK (apply_result IS NULL OR jsonb_typeof(apply_result) = 'object'),
    UNIQUE (execution_id, revision),
    CHECK ((applied_at IS NULL) = (apply_result IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_crm_attendance_ocr_outstanding
ON crm_attendance_ocr_executions(status) WHERE status IN ('reserved','unknown');

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_attendance_ocr_applied_once
ON crm_attendance_ocr_previews(execution_id) WHERE applied_at IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_crm_attendance_ocr_execution() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id, NEW.business_context, NEW.actor_user_id, NEW.document_date, NEW.image_sha256,
           NEW.provider, NEW.model, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.business_context, OLD.actor_user_id, OLD.document_date, OLD.image_sha256,
           OLD.provider, OLD.model, OLD.created_at)
       OR (OLD.provider_receipt IS NOT NULL AND NEW.provider_receipt IS DISTINCT FROM OLD.provider_receipt)
       OR (OLD.status <> 'reserved' AND NEW IS DISTINCT FROM OLD) THEN
        RAISE EXCEPTION 'CRM attendance OCR execution is immutable';
    END IF;
    RETURN NEW;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_crm_attendance_ocr_execution' AND tgrelid='crm_attendance_ocr_executions'::regclass) THEN
        CREATE TRIGGER trg_crm_attendance_ocr_execution BEFORE UPDATE ON crm_attendance_ocr_executions
        FOR EACH ROW EXECUTE FUNCTION guard_crm_attendance_ocr_execution();
    END IF;
END $$;

CREATE OR REPLACE FUNCTION guard_crm_attendance_ocr_preview() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id, NEW.execution_id, NEW.revision, NEW.preview_rows, NEW.state_snapshot,
           NEW.preview_hash, NEW.created_at, NEW.expires_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.execution_id, OLD.revision, OLD.preview_rows, OLD.state_snapshot,
           OLD.preview_hash, OLD.created_at, OLD.expires_at)
       OR (OLD.applied_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
        RAISE EXCEPTION 'CRM attendance OCR preview is immutable';
    END IF;
    RETURN NEW;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_crm_attendance_ocr_preview' AND tgrelid='crm_attendance_ocr_previews'::regclass) THEN
        CREATE TRIGGER trg_crm_attendance_ocr_preview BEFORE UPDATE ON crm_attendance_ocr_previews
        FOR EACH ROW EXECUTE FUNCTION guard_crm_attendance_ocr_preview();
    END IF;
END $$;
