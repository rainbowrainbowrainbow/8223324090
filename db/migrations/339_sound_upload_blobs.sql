-- MIGRATION_KIND: schema
-- SAFETY: Additive Postgres-backed sound upload blob storage. Existing sound rows and local upload files remain compatible through the same /uploads/sounds public URL path.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Stop new Postgres-backed sound upload writes first, export any needed blobs, then DROP TABLE IF EXISTS sound_upload_blobs after accepting loss of new uploaded/generated sound binaries.

ALTER TABLE sounds DROP CONSTRAINT IF EXISTS sounds_storage_provider_check;
ALTER TABLE sounds ADD CONSTRAINT sounds_storage_provider_check
    CHECK (storage_provider IS NULL OR storage_provider IN ('local', 'postgres', 'supabase', 'external'));

CREATE TABLE IF NOT EXISTS sound_upload_blobs (
    id SERIAL PRIMARY KEY,
    sound_id INTEGER REFERENCES sounds(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT,
    content_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    data BYTEA NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_by_username TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sound_upload_blobs_content_type_check
        CHECK (content_type IN (
            'audio/aac',
            'audio/mp3',
            'audio/mp4',
            'audio/mpeg',
            'audio/ogg',
            'audio/wav',
            'audio/webm',
            'audio/x-m4a',
            'audio/x-wav',
            'application/ogg',
            'application/octet-stream'
        )),
    CONSTRAINT sound_upload_blobs_file_size_check
        CHECK (file_size > 0 AND file_size <= 52428800),
    CONSTRAINT sound_upload_blobs_storage_key_check
        CHECK (storage_key <> '' AND storage_key = btrim(storage_key) AND storage_key !~ '(^/|\\.\\.|\\\\)')
);

CREATE INDEX IF NOT EXISTS idx_sound_upload_blobs_sound
    ON sound_upload_blobs(sound_id)
    WHERE sound_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sound_upload_blobs_created
    ON sound_upload_blobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sound_upload_blobs_created_by
    ON sound_upload_blobs(created_by_username)
    WHERE created_by_username IS NOT NULL;
