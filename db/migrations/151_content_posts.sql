-- v42.0: Content Matrix — content_posts table
CREATE TABLE IF NOT EXISTS content_posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    media_urls TEXT[] DEFAULT '{}',
    platforms TEXT[] DEFAULT '{}',
    topic VARCHAR(100),
    business_card_id INTEGER,
    hashtags TEXT[] DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'draft',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE,
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    week_number INTEGER,
    year INTEGER,
    day_of_week INTEGER,
    platform_post_ids JSONB DEFAULT '{}',
    platform_urls JSONB DEFAULT '{}',
    ai_generated BOOLEAN DEFAULT false,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_posts_week ON content_posts(year, week_number);
CREATE INDEX IF NOT EXISTS idx_content_posts_status ON content_posts(status);
CREATE INDEX IF NOT EXISTS idx_content_posts_scheduled ON content_posts(scheduled_at);
