-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable Guardian delivery convergence metadata; existing event queue and dead-letter rows remain compatible.
-- ROLLBACK: Drop the added convergence columns and Guardian-specific indexes if this delivery convergence slice is reverted.

ALTER TABLE event_queue
    ADD COLUMN IF NOT EXISTS convergence_status VARCHAR(40),
    ADD COLUMN IF NOT EXISTS failure_class VARCHAR(60),
    ADD COLUMN IF NOT EXISTS terminal_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_convergence_at TIMESTAMPTZ;

ALTER TABLE event_dead_letter
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100),
    ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failure_class VARCHAR(60),
    ADD COLUMN IF NOT EXISTS terminal_reason TEXT,
    ADD COLUMN IF NOT EXISTS requeued_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS requeued_event_id INTEGER REFERENCES event_queue(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_queue_guardian_convergence
    ON event_queue(event_type, status, failure_class)
    WHERE event_type LIKE 'guardian.%';

CREATE INDEX IF NOT EXISTS idx_event_dead_letter_guardian
    ON event_dead_letter(event_type, moved_at DESC)
    WHERE event_type LIKE 'guardian.%';

CREATE INDEX IF NOT EXISTS idx_event_dead_letter_guardian_requeue
    ON event_dead_letter(requeued_at)
    WHERE event_type LIKE 'guardian.%' AND requeued_at IS NULL;
