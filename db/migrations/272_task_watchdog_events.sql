-- MIGRATION_KIND: schema
-- SAFETY: Additive Task Watchdog event ledger for future approved local DB persistence. No existing data is modified and this file must not be applied without owner DB-schema approval.
-- ROLLBACK: After exporting any required watchdog audit rows, DROP INDEX IF EXISTS idx_task_watchdog_events_owner_created, idx_task_watchdog_events_task_owner; DROP TABLE IF EXISTS task_watchdog_events; only after scheduler/callback senders are disabled.

CREATE TABLE IF NOT EXISTS task_watchdog_events (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    task_id BIGINT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    actor_user_id INTEGER,
    action_type TEXT NOT NULL,
    notification_mode TEXT NOT NULL DEFAULT 'plan',
    dry_run BOOLEAN NOT NULL DEFAULT TRUE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_watchdog_events_task_owner
    ON task_watchdog_events(task_id, owner_user_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_watchdog_events_owner_created
    ON task_watchdog_events(owner_user_id, created_at DESC);
