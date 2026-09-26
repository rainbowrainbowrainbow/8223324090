-- MIGRATION_KIND: schema
-- SAFETY: Additive partial lookup index for existing trusted QA manifests. No certificate or customer rows are changed; repeat application is safe.
-- ROLLBACK: Stop certificate QA issuance first, retain manifest history, then DROP INDEX IF EXISTS idx_trusted_qa_certificate_lookup_v371 if a revert is required.

CREATE INDEX IF NOT EXISTS idx_trusted_qa_certificate_lookup_v371
    ON trusted_qa_run_entities (entity_id)
    WHERE entity_type = 'certificate';
