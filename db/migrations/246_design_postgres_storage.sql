-- MIGRATION_KIND: schema
-- SAFETY: Additive Postgres-backed design file storage. Existing local files and design rows are preserved and continue to work through the legacy fallback path.
-- ROLLBACK: Drop design_file_blobs plus the added designs.storage_* columns after confirming no new Postgres-backed design uploads must be preserved.

ALTER TABLE designs
    ADD COLUMN IF NOT EXISTS storage_provider TEXT,
    ADD COLUMN IF NOT EXISTS storage_key TEXT,
    ADD COLUMN IF NOT EXISTS storage_migrated_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'designs_storage_provider_check'
    ) THEN
        ALTER TABLE designs
            ADD CONSTRAINT designs_storage_provider_check
            CHECK (storage_provider IS NULL OR storage_provider IN ('local', 'postgres', 'external'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS design_file_blobs (
    id SERIAL PRIMARY KEY,
    design_id INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL UNIQUE,
    data BYTEA NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_design_file_blobs_design_storage_key
    ON design_file_blobs(design_id, storage_key);

CREATE INDEX IF NOT EXISTS idx_designs_storage_provider
    ON designs(storage_provider);

CREATE INDEX IF NOT EXISTS idx_designs_storage_key
    ON designs(storage_key)
    WHERE storage_key IS NOT NULL;
