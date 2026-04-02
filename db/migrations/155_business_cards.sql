-- v42.2: Business Cards — structured service documents for content generation
CREATE TABLE IF NOT EXISTS business_cards (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'service',
    short_description TEXT,
    full_description TEXT,
    target_audience TEXT,
    key_features TEXT[] DEFAULT '{}',
    price_info TEXT,
    price_details JSONB DEFAULT '{}',
    photo_urls TEXT[] DEFAULT '{}',
    video_urls TEXT[] DEFAULT '{}',
    instagram_refs TEXT[] DEFAULT '{}',
    hashtags_instagram TEXT[] DEFAULT '{}',
    hashtags_tiktok TEXT[] DEFAULT '{}',
    hashtags_facebook TEXT[] DEFAULT '{}',
    tone_of_voice TEXT,
    content_rules TEXT,
    call_to_action TEXT,
    do_not TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_cards_slug ON business_cards(slug);
CREATE INDEX IF NOT EXISTS idx_business_cards_category ON business_cards(category);
