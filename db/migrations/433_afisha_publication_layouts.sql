-- MIGRATION_KIND: schema
-- SAFETY: Creates private immutable artwork revisions and adds nullable queue metadata.
-- ROLLBACK: Revert the app. Keep the revisions and metadata to preserve queued content and delivery history.

CREATE TABLE IF NOT EXISTS afisha_publication_layouts (
    id BIGSERIAL PRIMARY KEY,
    business_context TEXT NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
    content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
    checksum TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS afisha_publication_layouts_period_idx
    ON afisha_publication_layouts (business_context, date_from, date_to, id DESC);

ALTER TABLE afisha_announcement_parts
    ADD COLUMN IF NOT EXISTS layout_id BIGINT REFERENCES afisha_publication_layouts(id),
    ADD COLUMN IF NOT EXISTS publication_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS publisher_id INTEGER,
    ADD COLUMN IF NOT EXISTS is_photo BOOLEAN NOT NULL DEFAULT FALSE;
