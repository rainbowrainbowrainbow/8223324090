-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent tables. No existing identities or notification destinations change.
-- ROLLBACK: Disable telegram_crm_settings.mode; retain identity/audit/operation tables when rolling back code.

CREATE TABLE IF NOT EXISTS telegram_crm_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'read', 'write')),
    bot_username TEXT NOT NULL CHECK (bot_username ~ '^[A-Za-z0-9_]{5,32}$'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_crm_bindings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    proposed_telegram_id BIGINT CHECK (proposed_telegram_id > 0),
    telegram_user_id BIGINT UNIQUE CHECK (telegram_user_id > 0),
    telegram_username TEXT,
    verified_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((telegram_user_id IS NULL) = (verified_at IS NULL))
);

CREATE TABLE IF NOT EXISTS telegram_crm_link_requests (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES telegram_crm_bindings(user_id),
    token_hash TEXT NOT NULL UNIQUE,
    browser_proof_hash TEXT NOT NULL,
    binding_version BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    candidate_telegram_id BIGINT CHECK (candidate_telegram_id > 0),
    candidate_username TEXT,
    claimed_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telegram_crm_link_requests_user_idx
    ON telegram_crm_link_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_crm_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    event_type TEXT NOT NULL,
    binding_version BIGINT NOT NULL,
    operation_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telegram_crm_audit_user_idx
    ON telegram_crm_audit(user_id, created_at DESC);

-- Persist previews and successful receipts. A receipt is never expired into a new write.
CREATE TABLE IF NOT EXISTS telegram_crm_task_operations (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES telegram_crm_bindings(user_id),
    binding_version BIGINT NOT NULL,
    source_update_id TEXT NOT NULL,
    business_context TEXT NOT NULL,
    payload JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'committed', 'cancelled')),
    task_id INTEGER REFERENCES tasks(id),
    receipt JSONB,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    committed_at TIMESTAMPTZ,
    UNIQUE(user_id, binding_version, source_update_id),
    CHECK ((state = 'committed') = (receipt IS NOT NULL AND task_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS telegram_crm_task_operations_task_idx
    ON telegram_crm_task_operations(task_id) WHERE task_id IS NOT NULL;
