-- MIGRATION_KIND: schema
-- SAFETY: Additive idempotent health metadata only; no credentials or message bodies.
-- ROLLBACK: Revert application code; retain these optional tables for diagnostics.
CREATE TABLE IF NOT EXISTS omni_channel_health (
    business_context TEXT NOT NULL,
    channel TEXT NOT NULL,
    checked_at TIMESTAMPTZ,
    check_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_inbound_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error_code TEXT,
    failed_events BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (business_context, channel)
);
CREATE TABLE IF NOT EXISTS omni_channel_errors (
    id BIGSERIAL PRIMARY KEY,
    business_context TEXT NOT NULL,
    channel TEXT NOT NULL,
    error_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_omni_channel_errors_context_time
    ON omni_channel_errors (business_context, channel, created_at DESC);
