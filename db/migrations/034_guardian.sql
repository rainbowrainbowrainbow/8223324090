-- Guardian AI agent: moderation, reports, sensitive data masking

-- Guardian user (bot account)
INSERT INTO users (username, password_hash, name, role)
VALUES ('guardian', '$2b$10$placeholder_hash_never_login', 'Guardian 🛡️', 'bot')
ON CONFLICT (username) DO NOTHING;

-- Mute tracking table
CREATE TABLE IF NOT EXISTS chat_mutes (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    muted_by VARCHAR(50) DEFAULT 'guardian',
    reason TEXT,
    muted_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_mutes_active ON chat_mutes (channel_id, user_id, muted_until);

-- Guardian daily reports
CREATE TABLE IF NOT EXISTS guardian_reports (
    id SERIAL PRIMARY KEY,
    report_date DATE NOT NULL,
    channel_id INTEGER REFERENCES chat_channels(id),
    summary TEXT NOT NULL,
    important_messages JSONB DEFAULT '[]',
    conflicts_detected INTEGER DEFAULT 0,
    sensitive_masked INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_reports_date_channel
ON guardian_reports (report_date, channel_id);

-- Guardian action log
CREATE TABLE IF NOT EXISTS guardian_actions (
    id SERIAL PRIMARY KEY,
    action_type VARCHAR(30) NOT NULL, -- 'mute', 'mask', 'warn', 'report'
    channel_id INTEGER REFERENCES chat_channels(id),
    target_user_id INTEGER REFERENCES users(id),
    message_id INTEGER REFERENCES chat_messages(id),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_actions_type ON guardian_actions (action_type, created_at DESC);
