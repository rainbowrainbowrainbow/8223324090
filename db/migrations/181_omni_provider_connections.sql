-- MIGRATION_KIND: schema
-- SAFETY: Adds an additive canonical provider connection table for Omni/admin channel setup. Existing env-based provider configuration and conversation rows are not modified or backfilled.
-- ROLLBACK: Drop idx_omni_provider_connections_status, idx_omni_provider_connections_updated_at, and omni_provider_connections after confirming no manually saved provider credentials or audit metadata are needed.

CREATE TABLE IF NOT EXISTS omni_provider_connections (
    channel VARCHAR(40) PRIMARY KEY,
    provider_kind VARCHAR(40) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'disconnected',
    credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
    account_display_name TEXT,
    masked_identifier TEXT,
    send_enabled BOOLEAN NOT NULL DEFAULT false,
    receive_enabled BOOLEAN NOT NULL DEFAULT false,
    warning TEXT,
    last_checked_at TIMESTAMP,
    last_changed_at TIMESTAMP DEFAULT NOW(),
    changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    changed_by TEXT,
    last_test_at TIMESTAMP,
    last_test_status VARCHAR(40),
    last_test_message TEXT,
    disconnected_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'omni_provider_connections_status_check'
    ) THEN
        ALTER TABLE omni_provider_connections
            ADD CONSTRAINT omni_provider_connections_status_check
            CHECK (status IN (
                'connected',
                'disconnected',
                'limited',
                'token_expired',
                'misconfigured',
                'webhook_missing',
                'history_only',
                'provider_unreachable'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_omni_provider_connections_status
    ON omni_provider_connections(status);

CREATE INDEX IF NOT EXISTS idx_omni_provider_connections_updated_at
    ON omni_provider_connections(updated_at DESC);
