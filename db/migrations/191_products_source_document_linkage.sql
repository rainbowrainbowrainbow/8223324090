-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable document-linkage columns on products plus an idempotent CHECK constraint. Existing product rows remain unchanged.
-- ROLLBACK: Drop products_source_document_kind_check and the added source_document_* columns after exporting any manually linked document metadata if needed.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS source_document_url TEXT,
    ADD COLUMN IF NOT EXISTS source_document_title TEXT,
    ADD COLUMN IF NOT EXISTS source_document_kind VARCHAR(30),
    ADD COLUMN IF NOT EXISTS source_document_verified_manual BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS source_card_matches_document BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS source_document_linked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_document_linked_by TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_source_document_kind_check'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_source_document_kind_check
            CHECK (
                source_document_kind IS NULL
                OR source_document_kind IN ('google_doc', 'pdf', 'link')
            );
    END IF;
END $$;
