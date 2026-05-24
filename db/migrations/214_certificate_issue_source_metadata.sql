-- MIGRATION_KIND: mixed
-- SAFETY: Adds nullable/defaulted certificate metadata columns idempotently and backfills only rows explicitly marked by the app's existing batch notes.
-- ROLLBACK: Drop idx_certificates_issue_source, idx_certificates_batch_group_id and columns issue_source/batch_group_id if the release is reverted.
-- DATA_SCOPE: Existing certificates whose notes start with 'Пакетна генерація' were created by the current batch endpoint and can be safely marked as batch-issued.

ALTER TABLE certificates
    ADD COLUMN IF NOT EXISTS issue_source VARCHAR(20) NOT NULL DEFAULT 'single';

ALTER TABLE certificates
    ADD COLUMN IF NOT EXISTS batch_group_id VARCHAR(80);

DO $$
BEGIN
    ALTER TABLE certificates
        ADD CONSTRAINT certificates_issue_source_check
        CHECK (issue_source IN ('single', 'batch', 'legacy'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

UPDATE certificates
SET issue_source = 'batch'
WHERE issue_source = 'single'
  AND notes ILIKE 'Пакетна генерація%';

CREATE INDEX IF NOT EXISTS idx_certificates_issue_source
    ON certificates(issue_source);

CREATE INDEX IF NOT EXISTS idx_certificates_batch_group_id
    ON certificates(batch_group_id)
    WHERE batch_group_id IS NOT NULL;
