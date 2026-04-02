-- v42.0: Content Matrix — social_accounts table
CREATE TABLE IF NOT EXISTS social_accounts (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(50) NOT NULL UNIQUE,
    account_name VARCHAR(255),
    account_id VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    is_connected BOOLEAN DEFAULT false,
    connected_at TIMESTAMP WITH TIME ZONE,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO social_accounts (platform, account_name) VALUES
    ('instagram', 'Парк Закревського'),
    ('telegram', 'Парк Закревського'),
    ('tiktok', 'Парк Закревського'),
    ('facebook', 'Парк Закревського'),
    ('threads', 'Парк Закревського'),
    ('viber', 'Парк Закревського')
ON CONFLICT (platform) DO NOTHING;
