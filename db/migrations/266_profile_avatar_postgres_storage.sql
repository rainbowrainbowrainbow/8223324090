-- MIGRATION_KIND: schema
-- SAFETY: Additive Postgres-backed profile avatar blob storage. Existing user_profiles_ext.avatar_url rows and local files remain compatible.
-- ROLLBACK: Drop profile_avatar_blobs after exporting needed avatars; old avatar_url rows remain but Postgres-backed images would stop resolving.

CREATE TABLE IF NOT EXISTS profile_avatar_blobs (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT,
    content_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    data BYTEA NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_avatar_blobs_username
    ON profile_avatar_blobs(username);

CREATE INDEX IF NOT EXISTS idx_profile_avatar_blobs_created_at_desc
    ON profile_avatar_blobs(created_at DESC);
