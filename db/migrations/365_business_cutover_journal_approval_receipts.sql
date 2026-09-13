-- MIGRATION_KIND: schema
-- SAFETY: Additive receipt metadata for guarded SYS-MB reserved business cutover only. No business, membership, user, token, customer, booking, financial, payroll, or operational data is created or changed.
-- OPERATOR_APPROVAL: required before any future cutover apply writes a journal receipt in production.
-- ROLLBACK: Leave columns in place and ignore them. Dropping requires exporting cutover evidence and confirming no deployed release controller or audit report reads these receipt fields.

ALTER TABLE business_cutover_journal
    ADD COLUMN IF NOT EXISTS approval_ref TEXT,
    ADD COLUMN IF NOT EXISTS source_fingerprint_sha256 CHAR(64),
    ADD COLUMN IF NOT EXISTS receipt_sha256 CHAR(64);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'business_cutover_journal_approval_ref_check'
    ) THEN
        ALTER TABLE business_cutover_journal
            ADD CONSTRAINT business_cutover_journal_approval_ref_check
            CHECK (approval_ref IS NULL OR (length(approval_ref) BETWEEN 12 AND 240 AND approval_ref !~ '[\x00-\x1f\x7f]'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'business_cutover_journal_source_fingerprint_check'
    ) THEN
        ALTER TABLE business_cutover_journal
            ADD CONSTRAINT business_cutover_journal_source_fingerprint_check
            CHECK (source_fingerprint_sha256 IS NULL OR source_fingerprint_sha256 ~ '^[a-f0-9]{64}$');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'business_cutover_journal_receipt_hash_check'
    ) THEN
        ALTER TABLE business_cutover_journal
            ADD CONSTRAINT business_cutover_journal_receipt_hash_check
            CHECK (receipt_sha256 IS NULL OR receipt_sha256 ~ '^[a-f0-9]{64}$');
    END IF;
END $$;
