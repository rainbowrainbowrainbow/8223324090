-- Migration 051: Guardian Phase 3 — Health Scores, Mood Tracking, Analytics, Commands, Trust
-- Date: 2026-03-11

-- Channel health scores — real-time health tracking per channel
CREATE TABLE IF NOT EXISTS guardian_channel_health (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 100 CHECK (score >= 0 AND score <= 100),
    level VARCHAR(10) NOT NULL DEFAULT 'green' CHECK (level IN ('green', 'yellow', 'red')),
    factors JSONB NOT NULL DEFAULT '{}',
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id)
);

-- Channel health history — track score changes over time
CREATE TABLE IF NOT EXISTS guardian_health_history (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    level VARCHAR(10) NOT NULL,
    factors JSONB NOT NULL DEFAULT '{}',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_health_history_channel_date ON guardian_health_history(channel_id, recorded_at DESC);

-- Team mood tracking — sentiment per message for analytics
CREATE TABLE IF NOT EXISTS guardian_mood_tracking (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
    sentiment VARCHAR(20) NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative', 'toxic')),
    score NUMERIC(3,2) NOT NULL DEFAULT 0.00 CHECK (score >= -1.00 AND score <= 1.00),
    emotions JSONB DEFAULT '[]',
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mood_tracking_channel_date ON guardian_mood_tracking(channel_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mood_tracking_user ON guardian_mood_tracking(user_id, analyzed_at DESC);

-- Guardian command log — track all /g commands usage
CREATE TABLE IF NOT EXISTS guardian_commands_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER REFERENCES chat_channels(id) ON DELETE SET NULL,
    command VARCHAR(50) NOT NULL,
    args TEXT,
    result TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commands_log_date ON guardian_commands_log(executed_at DESC);

-- Weekly reports — separate from daily reports
CREATE TABLE IF NOT EXISTS guardian_weekly_reports (
    id SERIAL PRIMARY KEY,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    summary TEXT NOT NULL,
    stats JSONB NOT NULL DEFAULT '{}',
    channel_breakdown JSONB NOT NULL DEFAULT '{}',
    top_offenders JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',
    sent_to_telegram BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(week_start)
);

-- User trust scores — adaptive trust system
CREATE TABLE IF NOT EXISTS guardian_trust_scores (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trust_score INTEGER NOT NULL DEFAULT 50 CHECK (trust_score >= 0 AND trust_score <= 100),
    level VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (level IN ('trusted', 'normal', 'watched', 'restricted')),
    positive_actions INTEGER NOT NULL DEFAULT 0,
    negative_actions INTEGER NOT NULL DEFAULT 0,
    last_incident TIMESTAMPTZ,
    last_positive TIMESTAMPTZ,
    notes JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Escalation config — configurable escalation thresholds
CREATE TABLE IF NOT EXISTS guardian_escalation_config (
    id SERIAL PRIMARY KEY,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 5),
    name VARCHAR(50) NOT NULL,
    threshold INTEGER NOT NULL DEFAULT 3,
    action VARCHAR(50) NOT NULL,
    mute_duration_minutes INTEGER DEFAULT 1,
    notify_telegram BOOLEAN NOT NULL DEFAULT false,
    notify_director_dm BOOLEAN NOT NULL DEFAULT true,
    cooldown_minutes INTEGER NOT NULL DEFAULT 60,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default escalation levels
INSERT INTO guardian_escalation_config (level, name, threshold, action, mute_duration_minutes, notify_telegram, notify_director_dm)
VALUES
    (1, 'Попередження', 1, 'warn', 0, false, false),
    (2, 'Короткий мут', 2, 'mute', 1, false, true),
    (3, 'Тривалий мут', 3, 'mute', 10, false, true),
    (4, 'Алерт директору', 4, 'mute_alert', 30, true, true),
    (5, 'Бан на день', 5, 'ban', 1440, true, true)
ON CONFLICT DO NOTHING;

-- Activity heatmap data — hourly message counts for analytics
CREATE TABLE IF NOT EXISTS guardian_activity_heatmap (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    hour_bucket TIMESTAMPTZ NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    conflict_count INTEGER NOT NULL DEFAULT 0,
    mute_count INTEGER NOT NULL DEFAULT 0,
    avg_sentiment NUMERIC(3,2) DEFAULT 0.00,
    UNIQUE(channel_id, hour_bucket)
);
CREATE INDEX IF NOT EXISTS idx_heatmap_channel_hour ON guardian_activity_heatmap(channel_id, hour_bucket DESC);
