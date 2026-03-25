-- v38.4.0: Security & Reliability Hardening
-- Based on deep technical audit: JWT refresh tokens, transactional outbox, pg_stat_statements

-- 1. Refresh tokens table (JWT rotation + blacklisting)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    device_info VARCHAR(200),
    ip_address VARCHAR(45),
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    replaced_by INTEGER REFERENCES refresh_tokens(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

-- 2. Transactional outbox for reliable event delivery
CREATE TABLE IF NOT EXISTS outbox_events (
    id BIGSERIAL PRIMARY KEY,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    idempotency_key VARCHAR(200) UNIQUE,
    occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
    published_at TIMESTAMP,
    publish_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
    ON outbox_events (occurred_at)
    WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
    ON outbox_events (aggregate_type, aggregate_id);

-- 3. Enable pg_stat_statements if available
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
        BEGIN
            CREATE EXTENSION pg_stat_statements;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_stat_statements not available: %', SQLERRM;
        END;
    END IF;
END $$;

-- 4. Note: cleanup of expired refresh tokens handled by scheduler job (cleanupRefreshTokens)
