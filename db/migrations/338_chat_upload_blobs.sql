-- MIGRATION_KIND: schema
-- SAFETY: Additive Postgres-backed chat upload blob storage. Existing chat message metadata and local upload files remain compatible through the same /uploads/chat public URL path.
-- ROLLBACK: Stop new Postgres-backed chat upload writes first, export any needed blobs, then DROP TABLE IF EXISTS chat_upload_blobs after accepting loss of new uploaded chat binaries.

CREATE TABLE IF NOT EXISTS chat_upload_blobs (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT,
    content_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    data BYTEA NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chat_upload_blobs_content_type_check
        CHECK (content_type IN (
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/octet-stream',
            'text/plain',
            'application/zip',
            'application/x-zip-compressed',
            'audio/mpeg',
            'audio/mp3',
            'video/mp4',
            'application/mp4',
            'audio/mp4',
            'audio/ogg',
            'video/ogg',
            'application/ogg',
            'audio/wav',
            'audio/x-wav',
            'audio/x-m4a',
            'audio/webm',
            'video/webm'
        )),
    CONSTRAINT chat_upload_blobs_file_size_check
        CHECK (file_size > 0 AND file_size <= 10485760),
    CONSTRAINT chat_upload_blobs_storage_key_check
        CHECK (storage_key <> '' AND storage_key = btrim(storage_key) AND storage_key !~ '(^/|\\.\\.|\\\\)')
);

CREATE INDEX IF NOT EXISTS idx_chat_upload_blobs_channel_created
    ON chat_upload_blobs(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_upload_blobs_message
    ON chat_upload_blobs(message_id)
    WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_upload_blobs_created_by
    ON chat_upload_blobs(created_by_user_id)
    WHERE created_by_user_id IS NOT NULL;
