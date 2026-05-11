-- MIGRATION_KIND: schema
-- SAFETY: Adds idempotent Guardian moderation event/counter tables for restart-safe repeat-offender and hourly-block tracking. Existing Guardian actions remain unchanged.
-- ROLLBACK: Drop guardian_moderation_counters and guardian_moderation_events if the durable moderation-state path is reverted.

CREATE TABLE IF NOT EXISTS guardian_moderation_events (
    id BIGSERIAL PRIMARY KEY,
    counter_type VARCHAR(40) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER REFERENCES chat_channels(id) ON DELETE SET NULL,
    source_type VARCHAR(60) NOT NULL,
    source_id VARCHAR(120) NOT NULL,
    username VARCHAR(120),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_moderation_events_source
ON guardian_moderation_events (counter_type, source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_guardian_moderation_events_user_time
ON guardian_moderation_events (user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS guardian_moderation_counters (
    id BIGSERIAL PRIMARY KEY,
    counter_type VARCHAR(40) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    window_key VARCHAR(80) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    last_channel_id INTEGER REFERENCES chat_channels(id) ON DELETE SET NULL,
    last_username VARCHAR(120),
    last_source_type VARCHAR(60),
    last_source_id VARCHAR(120),
    alerted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (counter_type, user_id, window_key)
);

CREATE INDEX IF NOT EXISTS idx_guardian_moderation_counters_window
ON guardian_moderation_counters (counter_type, window_end DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_moderation_counters_user
ON guardian_moderation_counters (user_id, counter_type, updated_at DESC);
