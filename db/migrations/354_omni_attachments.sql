-- MIGRATION_KIND: schema
-- SAFETY: Additive scoped attachment blobs and expiring per-file grants; no existing data mutation.
-- ROLLBACK: Revert application code and retain attachment tables to preserve customer files.
CREATE TABLE IF NOT EXISTS omni_attachments (
    id UUID PRIMARY KEY,
    business_context TEXT NOT NULL,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id),
    message_id BIGINT REFERENCES conversation_messages(id),
    source_index INTEGER NOT NULL DEFAULT 0 CHECK (source_index BETWEEN 0 AND 19),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    checksum TEXT NOT NULL,
    content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (octet_length(content) = size_bytes)
);
CREATE INDEX IF NOT EXISTS idx_omni_attachments_scope ON omni_attachments(business_context, conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_attachments_message ON omni_attachments(message_id, source_index) WHERE message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS omni_attachment_grants (
    token_hash TEXT PRIMARY KEY,
    attachment_id UUID NOT NULL REFERENCES omni_attachments(id),
    expires_at TIMESTAMPTZ NOT NULL
);
