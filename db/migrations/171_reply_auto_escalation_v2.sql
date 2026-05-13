-- MIGRATION_KIND: schema
-- SAFETY: Adds a partial unique index only for reply auto-escalation task anchors, so scheduler reruns cannot create duplicate tasks for the same reply expectation. No existing task rows are modified.
-- ROLLBACK: Drop idx_tasks_conversation_reply_source_unique to remove the uniqueness guard; existing reply escalation tasks can remain as historical tasks or be manually archived.

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_conversation_reply_source_unique
    ON tasks(source_id)
    WHERE source_type = 'conversation_reply'
      AND source_id IS NOT NULL;
