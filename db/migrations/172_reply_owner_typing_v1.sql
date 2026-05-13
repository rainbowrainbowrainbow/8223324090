-- MIGRATION_KIND: schema
-- SAFETY: Adds a nullable typed owner reference for active reply expectations plus a partial index; existing rows keep their display-label owner and are not backfilled.
-- ROLLBACK: Drop idx_conversations_reply_owner_user_waiting and conversations.reply_owner_user_id after accepting loss of typed reply-owner identity for active expectations.

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS reply_owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_reply_owner_user_waiting
    ON conversations(reply_owner_user_id, reply_sla_at ASC)
    WHERE reply_expected IS TRUE
      AND reply_owner_user_id IS NOT NULL;

COMMENT ON COLUMN conversations.reply_owner_user_id IS
    'Canonical CRM user id that owns the current active reply expectation; reply_owner remains the display snapshot label.';
