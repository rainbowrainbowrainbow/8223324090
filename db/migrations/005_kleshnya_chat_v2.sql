-- Migration 005: Kleshnya Chat v2.0 — Sessions, Media Bridge, Reactions
-- chat_sessions + kleshnya_chat ALTER + kleshnya_media

-- 1. Chat sessions (ChatGPT-style conversation grouping)
CREATE TABLE IF NOT EXISTS chat_sessions (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    title VARCHAR(100) DEFAULT 'Новий чат',
    emoji VARCHAR(10) DEFAULT '💬',
    is_pinned BOOLEAN DEFAULT FALSE,
    message_count INTEGER DEFAULT 0,
    last_message TEXT,
    last_message_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_username ON chat_sessions(username, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_pinned ON chat_sessions(username, is_pinned DESC, updated_at DESC);

-- 2. Extend kleshnya_chat with session/media/bridge fields
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE;
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS media_type VARCHAR(20);
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS media_file_id TEXT;
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS media_caption TEXT;
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS media_duration INTEGER;
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS skill_used VARCHAR(50);
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS is_generating BOOLEAN DEFAULT FALSE;
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS reaction VARCHAR(10);
ALTER TABLE kleshnya_chat ADD COLUMN IF NOT EXISTS telegram_message_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_kleshnya_chat_session ON kleshnya_chat(session_id, created_at);

-- 3. Media library table
CREATE TABLE IF NOT EXISTS kleshnya_media (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES chat_sessions(id) ON DELETE SET NULL,
    message_id INTEGER REFERENCES kleshnya_chat(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL,
    telegram_file_id TEXT,
    channel_message_id INTEGER,
    file_size INTEGER,
    duration INTEGER,
    width INTEGER,
    height INTEGER,
    prompt TEXT,
    model VARCHAR(50),
    skill VARCHAR(50),
    cost_credits NUMERIC(10,4),
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kleshnya_media_session ON kleshnya_media(session_id);
CREATE INDEX IF NOT EXISTS idx_kleshnya_media_type ON kleshnya_media(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kleshnya_media_created_by ON kleshnya_media(created_by, created_at DESC);
