-- MIGRATION_KIND: schema
-- SAFETY: Adds missing Guardian phase3 compatibility surfaces using idempotent CREATE/ALTER statements; no existing data is deleted or rewritten.
-- ROLLBACK: Drop guardian_trust_history and remove guardian_escalation_config.updated_at only after confirming no Guardian trust history or escalation audit data is needed.

-- Guardian trust changes need an audit table for duplicate-safe daily awards and manual trust adjustments.
CREATE TABLE IF NOT EXISTS guardian_trust_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_trust_history_user_date
ON guardian_trust_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_trust_history_reason_date
ON guardian_trust_history (reason, created_at DESC);

-- Escalation routes update this timestamp; older phase3 schema only had created_at.
ALTER TABLE guardian_escalation_config
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
