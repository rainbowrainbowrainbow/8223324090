-- 030_messenger.sql — Team messenger tables (Phase 1 MVP)

-- 1. Chat channels
CREATE TABLE IF NOT EXISTS chat_channels (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT DEFAULT '',
    is_default BOOLEAN DEFAULT false,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Chat channel members
CREATE TABLE IF NOT EXISTS chat_channel_members (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_seq INTEGER DEFAULT 0,
    muted BOOLEAN DEFAULT false,
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(channel_id, user_id)
);

-- 3. Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    seq INTEGER NOT NULL,
    content TEXT NOT NULL,
    reply_to INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
    edited_at TIMESTAMP,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(channel_id, seq)
);

-- 4. Chat reactions
CREATE TABLE IF NOT EXISTS chat_reactions (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);

-- 5. Chat mentions
CREATE TABLE IF NOT EXISTS chat_mentions (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(message_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_seq ON chat_messages(channel_id, seq);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created ON chat_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_mentions_user_notified ON chat_mentions(user_id, notified);

-- Seed default channels
INSERT INTO chat_channels (slug, name, description, is_default) VALUES
    ('команда', '#команда', 'Загальний чат команди', true),
    ('бронювання', '#бронювання', 'Обговорення бронювань', true),
    ('каса', '#каса', 'Каса та фінанси', true),
    ('технічний', '#технічний', 'Технічні питання', true)
ON CONFLICT (slug) DO NOTHING;

-- Atomic sequence number function
CREATE OR REPLACE FUNCTION next_chat_seq(p_channel_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM chat_messages WHERE channel_id = p_channel_id;
    RETURN v_seq;
END;
$$ LANGUAGE plpgsql;
