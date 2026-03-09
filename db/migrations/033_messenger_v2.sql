-- Migration 033: Messenger v2 — missing columns from spec + chat_tasks table
-- Adds type, linked_entity, is_archived, is_bot, content_type, metadata, role, client_message_id

-- 1. chat_channels: type, linked entity, archived
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'general';
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS linked_entity_type VARCHAR(50) DEFAULT NULL;
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS linked_entity_id INTEGER DEFAULT NULL;
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- 2. chat_messages: is_bot, content_type, metadata, client_message_id
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT false;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) DEFAULT 'text';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(64) DEFAULT NULL;

-- 3. chat_channel_members: role
ALTER TABLE chat_channel_members ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member';

-- 4. chat_tasks table
CREATE TABLE IF NOT EXISTS chat_tasks (
    id SERIAL PRIMARY KEY,
    message_id INTEGER REFERENCES chat_messages(id),
    channel_id INTEGER REFERENCES chat_channels(id),
    assigned_to INTEGER REFERENCES users(id),
    assigned_by INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'open',
    deadline TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_chat_channels_linked ON chat_channels(linked_entity_type, linked_entity_id);
CREATE INDEX IF NOT EXISTS idx_chat_channels_type ON chat_channels(type);
CREATE INDEX IF NOT EXISTS idx_chat_messages_client_id ON chat_messages(client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_tasks_assigned ON chat_tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_chat_tasks_channel ON chat_tasks(channel_id);
