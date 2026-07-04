-- MIGRATION_KIND: schema
-- SAFETY: Additive Postgres-backed catalog image blob storage. Existing products.icon_url values and local upload files remain compatible through the same public URL path.
-- ROLLBACK: Drop catalog_image_blobs after exporting needed images; existing products.icon_url rows remain but Postgres-backed catalog images would stop resolving.

CREATE TABLE IF NOT EXISTS catalog_image_blobs (
    filename TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data BYTEA NOT NULL,
    size_bytes INTEGER NOT NULL,
    source_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT catalog_image_blobs_content_type_check
        CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT catalog_image_blobs_filename_check
        CHECK (filename <> '' AND filename = btrim(filename) AND filename !~ '[\\/]')
);

CREATE INDEX IF NOT EXISTS idx_catalog_image_blobs_updated_at_desc
    ON catalog_image_blobs(updated_at DESC);

