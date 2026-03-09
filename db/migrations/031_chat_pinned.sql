-- 031: Chat pinned messages table
CREATE TABLE IF NOT EXISTS chat_pinned (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    pinned_by INTEGER NOT NULL REFERENCES users(id),
    pinned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_pinned_channel ON chat_pinned(channel_id);
