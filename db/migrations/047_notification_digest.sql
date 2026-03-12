-- v22.18: Notification digest — grouping & per-user preferences

-- User notification preferences
CREATE TABLE IF NOT EXISTS user_notification_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    digest_mode VARCHAR(20) DEFAULT 'instant' CHECK (digest_mode IN ('instant', '5min', '15min', '1hour')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Notification queue for digest batching
CREATE TABLE IF NOT EXISTS notification_queue (
    id SERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    text TEXT NOT NULL,
    booking_id VARCHAR(50),
    notification_type VARCHAR(30),
    created_at TIMESTAMP DEFAULT NOW(),
    sent_at TIMESTAMP,
    batch_id VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_unsent ON notification_queue (created_at) WHERE sent_at IS NULL;
