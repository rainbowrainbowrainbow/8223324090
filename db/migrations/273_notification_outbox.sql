-- MIGRATION_KIND: schema
-- SAFETY: Additive CRM-side notification outbox for Hermes task delivery. No existing data is modified and no delivery worker is activated by this migration.
-- ROLLBACK: After confirming no Hermes worker depends on queued notifications, DROP INDEX IF EXISTS idx_notification_outbox_semantic_unique, idx_notification_outbox_event_id, idx_notification_outbox_created_at, idx_notification_outbox_event_type, idx_notification_outbox_owner_user_id, idx_notification_outbox_task_id, idx_notification_outbox_status_available; DROP TABLE IF EXISTS notification_outbox.

CREATE TABLE IF NOT EXISTS notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL,
    task_id BIGINT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error TEXT,
    last_error_code TEXT,
    last_delivery_channel TEXT,
    last_delivery_target TEXT,
    claimed_by TEXT,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_outbox_event_id_check
        CHECK (NULLIF(BTRIM(event_id), '') IS NOT NULL),
    CONSTRAINT notification_outbox_task_id_check
        CHECK (task_id > 0),
    CONSTRAINT notification_outbox_owner_user_id_check
        CHECK (owner_user_id > 0),
    CONSTRAINT notification_outbox_event_type_check
        CHECK (event_type IN (
            'task_created',
            'task_assigned',
            'task_reminder_due',
            'task_overdue',
            'task_updated'
        )),
    CONSTRAINT notification_outbox_payload_hash_check
        CHECK (NULLIF(BTRIM(payload_hash), '') IS NOT NULL),
    CONSTRAINT notification_outbox_status_check
        CHECK (status IN (
            'pending',
            'claimed',
            'sent',
            'failed',
            'dead_letter',
            'skipped'
        )),
    CONSTRAINT notification_outbox_attempts_check
        CHECK (attempts >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_event_id
    ON notification_outbox(event_id);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_available
    ON notification_outbox(status, available_at);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_task_id
    ON notification_outbox(task_id);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_owner_user_id
    ON notification_outbox(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_event_type
    ON notification_outbox(event_type);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_created_at
    ON notification_outbox(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_semantic_unique
    ON notification_outbox(task_id, owner_user_id, event_type, payload_hash);
