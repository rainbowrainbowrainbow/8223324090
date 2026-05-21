-- MIGRATION_KIND: schema
-- SAFETY: Additive account security metadata and audit table only; existing users, passwords, sessions, and roles are preserved.
-- ROLLBACK: Drop account_security_events and remove users.password_changed_at/session_revoked_at only after exporting any account security audit records that must be retained.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS session_revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_session_revoked_at
    ON users(session_revoked_at)
    WHERE session_revoked_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_security_events (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_username VARCHAR(100),
    target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_username VARCHAR(100),
    event_type VARCHAR(80) NOT NULL,
    reason VARCHAR(200),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_security_events_target
    ON account_security_events(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_security_events_actor
    ON account_security_events(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_security_events_type
    ON account_security_events(event_type, created_at DESC);
