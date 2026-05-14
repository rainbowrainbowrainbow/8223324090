-- MIGRATION_KIND: schema
-- SAFETY: Adds an additive reply-only execution audit table and indexes. Existing conversations, tasks, and messages are not modified or backfilled.
-- ROLLBACK: Drop idx_reply_action_history_actor_created_at, idx_reply_action_history_action_type_created_at, idx_reply_action_history_conversation_created_at, and reply_action_history after dependent code is removed.

CREATE TABLE IF NOT EXISTS reply_action_history (
    id BIGSERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    reply_expected_message_id INTEGER NULL REFERENCES conversation_messages(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    actor_name_snapshot TEXT NULL,
    source_surface TEXT NULL,
    old_value_json JSONB NULL,
    new_value_json JSONB NULL,
    meta_json JSONB NULL,
    summary TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_action_history_conversation_created_at
    ON reply_action_history(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reply_action_history_action_type_created_at
    ON reply_action_history(action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reply_action_history_actor_created_at
    ON reply_action_history(actor_user_id, created_at DESC)
    WHERE actor_user_id IS NOT NULL;

COMMENT ON TABLE reply_action_history IS
    'Durable reply-first manager execution audit trail for waiting-reply actions.';
COMMENT ON COLUMN reply_action_history.reply_expected_message_id IS
    'Outbound conversation_messages row that anchored the reply expectation when the action happened, nullable after clears or legacy rows.';
COMMENT ON COLUMN reply_action_history.source_surface IS
    'Manager surface that initiated the durable reply execution action, e.g. manager_queue_execution_v6 or reply_operations_console_v2.';
