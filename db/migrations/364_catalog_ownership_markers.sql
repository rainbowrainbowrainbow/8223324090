-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent ownership markers for legacy catalog roots, children, public links and catalog image blobs. No catalog ownership, token, price, image, publication, or operational data is changed by this schema migration.
-- OPERATOR_APPROVAL: required before any future data-fix assigns historical catalog owners.
-- ROLLBACK: Drop the added indexes and columns only after exporting catalog ownership evidence and confirming no deployed code reads the markers.

ALTER TABLE catalog_definitions
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_status VARCHAR(32) NOT NULL DEFAULT 'legacy_unassigned',
    ADD COLUMN IF NOT EXISTS publication_visibility VARCHAR(24) NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

ALTER TABLE catalog_subcategories
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

ALTER TABLE catalog_items
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

ALTER TABLE catalog_settings
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

ALTER TABLE catalog_pages
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

ALTER TABLE catalog_automations
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

ALTER TABLE catalog_page_history
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

ALTER TABLE trend_proposals
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

ALTER TABLE catalog_image_blobs
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ownership_status VARCHAR(32) NOT NULL DEFAULT 'legacy_unassigned',
    ADD COLUMN IF NOT EXISTS ownership_decision_ref TEXT,
    ADD COLUMN IF NOT EXISTS ownership_updated_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_definitions_business_context_format') THEN
        ALTER TABLE catalog_definitions ADD CONSTRAINT catalog_definitions_business_context_format
            CHECK (business_context IS NULL OR business_context ~ '^[a-z][a-z0-9_]{2,63}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_definitions_ownership_status_check') THEN
        ALTER TABLE catalog_definitions ADD CONSTRAINT catalog_definitions_ownership_status_check
            CHECK (ownership_status IN ('legacy_unassigned', 'approved', 'conflict', 'shared_blocked'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_definitions_publication_visibility_check') THEN
        ALTER TABLE catalog_definitions ADD CONSTRAINT catalog_definitions_publication_visibility_check
            CHECK (publication_visibility IN ('legacy', 'private', 'public_existing_token', 'public_approved'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_image_blobs_business_context_format') THEN
        ALTER TABLE catalog_image_blobs ADD CONSTRAINT catalog_image_blobs_business_context_format
            CHECK (business_context IS NULL OR business_context ~ '^[a-z][a-z0-9_]{2,63}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_image_blobs_ownership_status_check') THEN
        ALTER TABLE catalog_image_blobs ADD CONSTRAINT catalog_image_blobs_ownership_status_check
            CHECK (ownership_status IN ('legacy_unassigned', 'approved', 'conflict', 'shared_blocked'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_catalog_definitions_business_context
    ON catalog_definitions (business_context, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_catalog_pages_business_context
    ON catalog_pages (business_context, catalog_id, page_number);
CREATE INDEX IF NOT EXISTS idx_catalog_items_business_context
    ON catalog_items (business_context, catalog_id, status);
CREATE INDEX IF NOT EXISTS idx_catalog_image_blobs_business_context
    ON catalog_image_blobs (business_context, updated_at DESC)
    WHERE business_context IS NOT NULL;
