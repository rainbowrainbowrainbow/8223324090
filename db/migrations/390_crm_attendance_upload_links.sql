-- MIGRATION_KIND: schema
-- SAFETY: Additive private upload-link/submission storage only. No attendance/payroll changes or active links are seeded. Public intake is disabled by default.
-- ROLLBACK: Disable CRM_ATTENDANCE_UPLOAD_LINKS_ENABLED; retain links, receipts and submissions. Any later table removal requires separate destructive approval.

CREATE TABLE IF NOT EXISTS crm_attendance_upload_links (
    id UUID PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    business_context TEXT NOT NULL CHECK (business_context = 'event_genix'),
    document_date DATE NOT NULL,
    session_revocation_cutoff NUMERIC NOT NULL CHECK (session_revocation_cutoff >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_attendance_upload_reviewer
    ON crm_attendance_upload_links(reviewer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_attendance_upload_submissions (
    id UUID PRIMARY KEY,
    link_id UUID NOT NULL REFERENCES crm_attendance_upload_links(id) ON DELETE RESTRICT,
    image_sha256 TEXT NOT NULL CHECK (image_sha256 ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'ready', 'unknown')),
    preview_id UUID REFERENCES crm_attendance_ocr_previews(id) ON DELETE RESTRICT,
    image_bytes BYTEA CHECK (octet_length(image_bytes) BETWEEN 1 AND 4194304),
    image_mime TEXT NOT NULL CHECK (image_mime IN ('image/png','image/jpeg')),
    photo_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(link_id, image_sha256),
    CHECK (status <> 'ready' OR preview_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_attendance_upload_photo_expiry
    ON crm_attendance_upload_submissions(photo_expires_at) WHERE image_bytes IS NOT NULL;
