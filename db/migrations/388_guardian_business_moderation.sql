-- MIGRATION_KIND: schema
-- SAFETY: Additive business-owned moderation log. Existing Guardian records and notification routes remain unchanged.
-- ROLLBACK: Disable scoped chat writes, then drop guardian_business_actions after exporting any scoped moderation audit records.

CREATE TABLE IF NOT EXISTS guardian_business_actions (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL REFERENCES businesses(context_key),
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    action_type VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    source VARCHAR(16) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    muted_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_business_actions_context_created
    ON guardian_business_actions (business_context, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_business_actions_active_mute
    ON guardian_business_actions (channel_id, user_id, muted_until DESC)
    WHERE muted_until IS NOT NULL;
