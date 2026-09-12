-- MIGRATION_KIND: schema
-- SAFETY: Adds scoped Viber Personal Bridge runtime, event, and command ledgers; existing Omni conversations and provider connections are unchanged.
-- ROLLBACK: Stop all personal bridges, retain/export unresolved commands and events, then drop the three omni_viber_personal_bridge_* tables and indexes.

CREATE TABLE IF NOT EXISTS omni_viber_personal_bridge_runtime (
    business_context TEXT NOT NULL,
    bridge_id UUID NOT NULL,
    account_id UUID NOT NULL,
    account_epoch INTEGER NOT NULL CHECK (account_epoch > 0),
    runtime_id UUID,
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_heartbeat_at TIMESTAMPTZ,
    last_receive_at TIMESTAMPTZ,
    last_error_code TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_context, bridge_id),
    UNIQUE (business_context, account_id, account_epoch)
);

CREATE TABLE IF NOT EXISTS omni_viber_personal_bridge_events (
    business_context TEXT NOT NULL,
    bridge_id UUID NOT NULL,
    event_id UUID NOT NULL,
    account_id UUID NOT NULL,
    account_epoch INTEGER NOT NULL CHECK (account_epoch > 0),
    runtime_id UUID NOT NULL,
    sequence BIGINT NOT NULL CHECK (sequence > 0),
    chat_id UUID NOT NULL,
    binding_revision INTEGER NOT NULL CHECK (binding_revision > 0),
    payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('received','processed','ignored','failed')),
    error_code TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    PRIMARY KEY (business_context, bridge_id, event_id),
    UNIQUE (business_context, bridge_id, account_epoch, sequence)
);
CREATE INDEX IF NOT EXISTS idx_omni_viber_personal_events_retry
    ON omni_viber_personal_bridge_events (business_context, bridge_id, status, received_at);

CREATE TABLE IF NOT EXISTS omni_viber_personal_bridge_commands (
    command_id UUID PRIMARY KEY,
    business_context TEXT NOT NULL,
    bridge_id UUID NOT NULL,
    account_id UUID NOT NULL,
    account_epoch INTEGER NOT NULL CHECK (account_epoch > 0),
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id BIGINT NOT NULL UNIQUE REFERENCES conversation_messages(id) ON DELETE CASCADE,
    client_request_id TEXT,
    chat_id UUID NOT NULL,
    binding_revision INTEGER NOT NULL CHECK (binding_revision > 0),
    text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
    payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('queued','leased','dispatch_started','submitted_unconfirmed','unknown','rejected')),
    error_code TEXT,
    lease_runtime_id UUID,
    lease_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_omni_viber_personal_commands_pull
    ON omni_viber_personal_bridge_commands (business_context, bridge_id, status, lease_expires_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omni_viber_personal_commands_request
    ON omni_viber_personal_bridge_commands (business_context, bridge_id, account_epoch, client_request_id)
    WHERE client_request_id IS NOT NULL;
