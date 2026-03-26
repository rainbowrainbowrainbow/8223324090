-- v33.5: Multi-catalog system (pinyata, cake, menu, costume)
-- Dynamic catalog definitions instead of hardcode

CREATE TABLE IF NOT EXISTS catalog_definitions (
    id           VARCHAR(50) PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    emoji        VARCHAR(10) DEFAULT '🗂️',
    description  TEXT,
    ai_style     TEXT,
    has_subcategories BOOLEAN DEFAULT false,
    has_sizes    BOOLEAN DEFAULT false,
    sort_order   INTEGER DEFAULT 0,
    is_active    BOOLEAN DEFAULT true,
    created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_subcategories (
    id          SERIAL PRIMARY KEY,
    catalog_id  VARCHAR(50) NOT NULL REFERENCES catalog_definitions(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalog_items (
    id            SERIAL PRIMARY KEY,
    catalog_id    VARCHAR(50) NOT NULL REFERENCES catalog_definitions(id),
    subcategory   VARCHAR(100),
    name          VARCHAR(200) NOT NULL,
    description   TEXT,
    price         NUMERIC,
    image_url     TEXT,
    extra_data    JSONB DEFAULT '{}',
    status        VARCHAR(20) DEFAULT 'active',
    created_by    VARCHAR(50),
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_catalog ON catalog_items(catalog_id, status);
CREATE INDEX IF NOT EXISTS idx_catalog_items_sub    ON catalog_items(catalog_id, subcategory);

CREATE TABLE IF NOT EXISTS catalog_settings (
    catalog_id       VARCHAR(50) PRIMARY KEY REFERENCES catalog_definitions(id),
    auto_enabled     BOOLEAN DEFAULT false,
    trend_frequency  VARCHAR(20) DEFAULT 'weekly',
    trend_region     VARCHAR(50) DEFAULT 'Київ',
    last_trend_check TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trend_proposals (
    id                SERIAL PRIMARY KEY,
    catalog_id        VARCHAR(50) NOT NULL,
    trend_name        VARCHAR(200),
    proposal          TEXT,
    suggested_price   NUMERIC,
    image_prompt      TEXT,
    status            VARCHAR(20) DEFAULT 'pending',
    generated_item_id INTEGER,
    created_at        TIMESTAMP DEFAULT NOW(),
    resolved_at       TIMESTAMP,
    resolved_by       VARCHAR(50)
);

-- Seed: catalog definitions
INSERT INTO catalog_definitions (id, name, emoji, ai_style, has_subcategories, has_sizes, sort_order) VALUES
(
    'pinyata', 'Піньяти', '🎉',
    'colorful cartoon pinata toy illustration, flat 2D style, white background, vibrant colors, cute playful kids party design, no text',
    false, true, 1
),
(
    'cake', 'Торти', '🎂',
    'elegant beautiful birthday cake illustration, professional bakery style, white background, detailed decorations, appetizing, no text',
    true, false, 2
),
(
    'menu', 'Меню', '🍕',
    'professional food photography style illustration, restaurant menu, white background, appetizing colorful food, no text on image',
    true, false, 3
),
(
    'costume', 'Костюми', '🦸',
    'cute cartoon character costume illustration, full body view, colorful, white background, kids party style, no text',
    false, false, 4
)
ON CONFLICT (id) DO NOTHING;

-- Seed: subcategories for Menu
INSERT INTO catalog_subcategories (catalog_id, name, sort_order) VALUES
('menu', 'Піца', 1),
('menu', 'Бургери', 2),
('menu', 'Салати', 3),
('menu', 'Дитяче меню', 4),
('menu', 'Картопля фрі', 5),
('menu', 'Напої', 6)
ON CONFLICT DO NOTHING;

-- Seed: subcategories for Cakes
INSERT INTO catalog_subcategories (catalog_id, name, sort_order) VALUES
('cake', 'Бісквітні', 1),
('cake', 'Кремові', 2),
('cake', 'Дитячі', 3),
('cake', 'Мусові', 4)
ON CONFLICT DO NOTHING;

-- Seed: settings for all catalogs
INSERT INTO catalog_settings (catalog_id)
SELECT id FROM catalog_definitions
ON CONFLICT (catalog_id) DO NOTHING;
