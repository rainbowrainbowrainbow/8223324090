-- v42.0: Content Matrix — content_templates table
CREATE TABLE IF NOT EXISTS content_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    topic VARCHAR(100),
    body_template TEXT,
    hashtags TEXT[] DEFAULT '{}',
    media_type VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
