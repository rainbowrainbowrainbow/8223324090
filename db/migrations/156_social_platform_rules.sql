-- v42.2: Social Platform Rules — formatting rules per social network
CREATE TABLE IF NOT EXISTS social_platform_rules (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(50) UNIQUE NOT NULL,
    max_text_length INTEGER,
    media_required BOOLEAN DEFAULT false,
    hashtag_limit INTEGER,
    tone TEXT,
    formatting_rules TEXT,
    image_ratio VARCHAR(20),
    video_max_seconds INTEGER,
    default_hashtags TEXT[] DEFAULT '{}',
    hashtag_placement VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO social_platform_rules (platform, max_text_length, media_required, hashtag_limit, tone, formatting_rules, image_ratio, hashtag_placement, default_hashtags, video_max_seconds) VALUES
    ('instagram', 2200, true, 30, 'Весело, яскраво, з емоджі 🎉', 'Абзаци через пустий рядок. Хештеги в кінці. CTA в останньому абзаці.', '1:1', 'end', ARRAY['#паркзакревського', '#дитячірозваги', '#київ', '#дітям', '#розваги'], 90),
    ('telegram', 4096, false, 10, 'Інформативно, дружньо, з емоджі', 'Markdown: **bold**, _italic_. Без хештегів або мінімум.', NULL, 'none', ARRAY[]::TEXT[], NULL),
    ('tiktok', 300, true, 5, 'Тренди, динаміка, young-friendly 🔥', 'Короткий текст. Trending хештеги. Відео обовязково.', '9:16', 'end', ARRAY['#fyp', '#foryou', '#дітям'], 180),
    ('facebook', 5000, false, 10, 'Сімейний, теплий тон', 'Довші тексти OK. Фото бажано. Лінки в тексті.', NULL, 'end', ARRAY['#ПаркЗакревського', '#Київ'], NULL),
    ('threads', 500, false, 5, 'Casual, conversational', 'Короткий текст, як tweet. Без лінків.', NULL, 'inline', ARRAY[]::TEXT[], NULL),
    ('viber', 1000, false, 0, 'Прямий, інформативний', 'Без хештегів. Кнопки "Детальніше". Фото бажано.', NULL, 'none', ARRAY[]::TEXT[], NULL)
ON CONFLICT (platform) DO NOTHING;
