-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable/default-safe conversation-level reply expectation fields and supporting partial indexes; no historical rows are backfilled.
-- ROLLBACK: Drop the reply expectation indexes and columns from conversations after clearing or accepting loss of any active reply expectation state.

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS reply_expected BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS awaiting_reply_since TIMESTAMP,
    ADD COLUMN IF NOT EXISTS reply_expected_message_id INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reply_owner VARCHAR(100),
    ADD COLUMN IF NOT EXISTS reply_sla_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_conversations_reply_waiting
    ON conversations(awaiting_reply_since DESC)
    WHERE reply_expected IS TRUE
      AND awaiting_reply_since IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_reply_message
    ON conversations(reply_expected_message_id)
    WHERE reply_expected_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_reply_sla
    ON conversations(reply_sla_at ASC)
    WHERE reply_expected IS TRUE
      AND reply_sla_at IS NOT NULL;

COMMENT ON COLUMN conversations.reply_expected IS
    'Explicit business intent that CRM is waiting for a client reply in this conversation.';
COMMENT ON COLUMN conversations.awaiting_reply_since IS
    'Timestamp from which the current explicit reply expectation became active.';
COMMENT ON COLUMN conversations.reply_expected_message_id IS
    'Outbound conversation_messages row that created the current reply expectation.';
COMMENT ON COLUMN conversations.reply_owner IS
    'Manager/operator label that owns the current reply expectation in v1.';
COMMENT ON COLUMN conversations.reply_sla_at IS
    'Optional timestamp when the current reply expectation should escalate.';
