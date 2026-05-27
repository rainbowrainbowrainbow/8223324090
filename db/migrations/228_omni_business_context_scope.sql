-- MIGRATION_KIND: schema
-- SAFETY: Adds additive business_context scope to Omni conversations, quick replies, and provider connections. Existing rows stay in the default Event Genix context; no conversations, messages, or credentials are deleted.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Export non-event_genix Omni rows, drop the scoped indexes/constraints, restore the previous global uniqueness constraints, then drop the added business_context columns if the multi-business Omni scope is reverted.

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE quick_replies
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE omni_provider_connections
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE conversations
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR business_context = '';

UPDATE quick_replies
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR business_context = '';

UPDATE omni_provider_connections
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR business_context = '';

ALTER TABLE conversations
    ALTER COLUMN business_context SET DEFAULT 'event_genix',
    ALTER COLUMN business_context SET NOT NULL;

ALTER TABLE quick_replies
    ALTER COLUMN business_context SET DEFAULT 'event_genix',
    ALTER COLUMN business_context SET NOT NULL;

ALTER TABLE omni_provider_connections
    ALTER COLUMN business_context SET DEFAULT 'event_genix',
    ALTER COLUMN business_context SET NOT NULL;

DROP INDEX IF EXISTS idx_conversations_channel_ext;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_business_channel_ext
    ON conversations(business_context, channel, external_id);

CREATE INDEX IF NOT EXISTS idx_conversations_business_status
    ON conversations(business_context, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_business_last_msg
    ON conversations(business_context, last_message_at DESC);

ALTER TABLE omni_provider_connections
    DROP CONSTRAINT IF EXISTS omni_provider_connections_pkey;

ALTER TABLE omni_provider_connections
    ADD CONSTRAINT omni_provider_connections_pkey
    PRIMARY KEY (business_context, channel);

CREATE INDEX IF NOT EXISTS idx_omni_provider_connections_business_status
    ON omni_provider_connections(business_context, status);

CREATE INDEX IF NOT EXISTS idx_omni_provider_connections_business_updated_at
    ON omni_provider_connections(business_context, updated_at DESC);

ALTER TABLE quick_replies
    DROP CONSTRAINT IF EXISTS quick_replies_title_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_replies_business_title
    ON quick_replies(business_context, lower(trim(title)));

CREATE INDEX IF NOT EXISTS idx_quick_replies_business_sort
    ON quick_replies(business_context, sort_order, created_at);
