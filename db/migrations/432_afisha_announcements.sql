-- MIGRATION_KIND: schema
-- SAFETY: Adds only announcement recipients and delivery parts. No data backfill or active recipients.
-- ROLLBACK: Disable the announcement worker and revert the application. Leave both tables in place to retain delivery history.

CREATE TABLE IF NOT EXISTS afisha_announcement_recipients (
    id BIGSERIAL PRIMARY KEY,
    business_context TEXT NOT NULL,
    destination_key TEXT NOT NULL,
    config JSONB NOT NULL,
    webhook_ciphertext TEXT,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1,
    UNIQUE (business_context, destination_key)
);

CREATE TABLE IF NOT EXISTS afisha_announcement_parts (
    id BIGSERIAL PRIMARY KEY,
    recipient_id BIGINT NOT NULL REFERENCES afisha_announcement_recipients(id),
    business_context TEXT NOT NULL,
    destination_key TEXT NOT NULL,
    slot_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('daily', 'monthly', 'publication')),
    part_number INTEGER NOT NULL CHECK (part_number > 0),
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'sent', 'retry', 'failed', 'uncertain', 'skipped')),
    attempt INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    lease UUID,
    lease_expires_at TIMESTAMPTZ,
    message_id TEXT,
    code TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_context, destination_key, slot_key, part_number)
);

CREATE INDEX IF NOT EXISTS afisha_announcement_parts_due_idx
    ON afisha_announcement_parts (available_at, id) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS afisha_announcement_parts_lease_idx
    ON afisha_announcement_parts (lease_expires_at) WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS afisha_announcement_parts_history_idx
    ON afisha_announcement_parts (recipient_id, id DESC);
