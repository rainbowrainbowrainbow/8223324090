-- Contour 2: Guardian flexible rules + Agent activity tracking

-- 1. Guardian rules table (replaces hardcoded patterns)
CREATE TABLE IF NOT EXISTS guardian_rules (
    id SERIAL PRIMARY KEY,
    rule_type VARCHAR(30) NOT NULL DEFAULT 'keyword',  -- 'keyword', 'regex', 'pattern', 'rate_limit'
    name VARCHAR(100) NOT NULL,
    pattern TEXT,
    action VARCHAR(30) NOT NULL DEFAULT 'flag',        -- 'flag', 'mask', 'mute', 'warn', 'notify'
    severity VARCHAR(10) DEFAULT 'medium',             -- 'low', 'medium', 'high', 'critical'
    channel_scope INTEGER[],                           -- NULL = all channels
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_rules_active ON guardian_rules (is_active, rule_type);

-- 2. Agent activities table
CREATE TABLE IF NOT EXISTS agent_activities (
    id SERIAL PRIMARY KEY,
    agent_tag VARCHAR(20) NOT NULL,                    -- 'claude-code', 'kleshnya', 'anthropic', 'human'
    action_type VARCHAR(50) NOT NULL,                  -- 'commit', 'pr', 'deploy', 'session', 'fix', 'feature'
    summary TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    session_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_activities_tag ON agent_activities (agent_tag);
CREATE INDEX IF NOT EXISTS idx_agent_activities_created ON agent_activities (created_at DESC);

-- 3. Agent summaries table
CREATE TABLE IF NOT EXISTS agent_summaries (
    id SERIAL PRIMARY KEY,
    agent_tag VARCHAR(20),                             -- NULL = all agents combined
    period VARCHAR(20) NOT NULL,                       -- 'session', 'daily', 'weekly'
    summary TEXT NOT NULL,
    stats JSONB DEFAULT '{}',
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_summaries_period ON agent_summaries (period, created_at DESC);

-- 4. Add severity to guardian_memory if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guardian_memory') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guardian_memory' AND column_name = 'severity') THEN
            ALTER TABLE guardian_memory ADD COLUMN severity VARCHAR(10) DEFAULT 'normal';
            CREATE INDEX IF NOT EXISTS idx_guardian_memory_severity ON guardian_memory (severity);
        END IF;
    END IF;
END $$;

-- 5. Seed default guardian rules (migrate from hardcoded sensitive patterns)
INSERT INTO guardian_rules (rule_type, name, pattern, action, severity, metadata) VALUES
    ('regex', 'Номер картки', '\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{1,7})\b', 'mask', 'critical', '{"replace": "$1 **** **** ****", "type": "card"}'),
    ('regex', 'Телефон UA', '(\+?3?8?0)\s?(\d{2})\s?(\d{3})\s?(\d{2})\s?(\d{2})', 'mask', 'critical', '{"replace": "+380 ** *** ** $5", "type": "phone"}'),
    ('regex', 'Email', '\b([a-zA-Z0-9._%+-]{1,2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b', 'mask', 'high', '{"replace": "$1***@$2", "type": "email"}'),
    ('regex', 'IBAN', '\b(UA)\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b', 'mask', 'critical', '{"replace": "UA** **** **** **** ****", "type": "iban"}'),
    ('regex', 'Паспорт', '\b[А-ЯІЇЄҐA-Z]{2}\s?\d{6}\b', 'mask', 'critical', '{"replace": "** ******", "type": "passport"}'),
    ('pattern', 'Російська мова', 'russian_language', 'flag', 'medium', '{"description": "Detect Russian language in messages"}'),
    ('keyword', 'Спам повторів', 'rate_limit_duplicate', 'mute', 'medium', '{"max_duplicates": 3, "window_seconds": 60}')
ON CONFLICT DO NOTHING;
