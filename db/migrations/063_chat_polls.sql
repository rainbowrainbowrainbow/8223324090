-- 063_chat_polls.sql — Chat poll/voting system
-- v25.4.0

CREATE TABLE IF NOT EXISTS chat_polls (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]',
    -- [{text: "Option A", votes: 0}]
    poll_type VARCHAR(20) DEFAULT 'single',
    -- types: single, multiple, quiz
    correct_index INTEGER,
    is_anonymous BOOLEAN DEFAULT false,
    expires_at TIMESTAMPTZ,
    is_closed BOOLEAN DEFAULT false,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_polls_channel ON chat_polls(channel_id);
CREATE INDEX IF NOT EXISTS idx_polls_message ON chat_polls(message_id);

CREATE TABLE IF NOT EXISTS chat_poll_votes (
    id SERIAL PRIMARY KEY,
    poll_id INTEGER NOT NULL REFERENCES chat_polls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    option_index INTEGER NOT NULL,
    voted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(poll_id, user_id, option_index)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON chat_poll_votes(poll_id);
