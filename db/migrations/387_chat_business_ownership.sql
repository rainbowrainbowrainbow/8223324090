-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable owner; existing shared channels remain unowned and inaccessible to membership businesses.
-- ROLLBACK: Drop idx_chat_channels_business_context, then drop chat_channels.business_context after disabling scoped chat writes.

ALTER TABLE chat_channels
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_chat_channels_business_context
    ON chat_channels (business_context, id)
    WHERE business_context IS NOT NULL;
