-- Chat enhancements: bookmarks, threads, scheduled messages, stickers, chat stats

-- Bookmarks (saved messages per user)
CREATE TABLE IF NOT EXISTS chat_bookmarks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    category VARCHAR(50) DEFAULT 'general',
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_bookmarks_user ON chat_bookmarks(user_id, created_at DESC);

-- Thread support: add thread_root_id to messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thread_root_id INTEGER REFERENCES chat_messages(id);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thread_reply_count INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_root_id) WHERE thread_root_id IS NOT NULL;

-- Scheduled messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_chat_messages_scheduled ON chat_messages(scheduled_at) WHERE is_scheduled = TRUE;

-- Self-destructing messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_chat_messages_expires ON chat_messages(expires_at) WHERE expires_at IS NOT NULL;

-- Sticker packs
CREATE TABLE IF NOT EXISTS chat_sticker_packs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    author VARCHAR(100),
    cover_url TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_stickers (
    id SERIAL PRIMARY KEY,
    pack_id INTEGER NOT NULL REFERENCES chat_sticker_packs(id) ON DELETE CASCADE,
    emoji VARCHAR(10),
    url TEXT NOT NULL,
    alt_text VARCHAR(100),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_stickers_pack ON chat_stickers(pack_id, sort_order);

-- Quick reply templates
CREATE TABLE IF NOT EXISTS chat_templates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shortcut VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(50) DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, shortcut)
);

-- Chat activity stats (for premium coefficient)
CREATE TABLE IF NOT EXISTS chat_activity_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    messages_sent INTEGER DEFAULT 0,
    reactions_given INTEGER DEFAULT 0,
    reactions_received INTEGER DEFAULT 0,
    replies_sent INTEGER DEFAULT 0,
    avg_response_time_sec INTEGER,
    helpfulness_score NUMERIC(3,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_chat_activity_user_date ON chat_activity_stats(user_id, date DESC);

-- Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, endpoint)
);
