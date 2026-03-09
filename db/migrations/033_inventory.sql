-- Migration 033: Shop items, inventory, extended profiles
-- Defensive: clean state
DROP TABLE IF EXISTS user_inventory CASCADE;
DROP TABLE IF EXISTS user_profiles_extended CASCADE;
DROP TABLE IF EXISTS shop_items CASCADE;

CREATE TABLE shop_items (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    image_url TEXT,
    price_coins INTEGER DEFAULT 0,
    rarity VARCHAR(20) DEFAULT 'common',
    is_real BOOLEAN DEFAULT FALSE,
    real_value VARCHAR(50),
    is_available BOOLEAN DEFAULT TRUE,
    equip_slot VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_inventory (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES shop_items(id),
    quantity INTEGER DEFAULT 1,
    is_equipped BOOLEAN DEFAULT FALSE,
    obtained_from VARCHAR(50),
    obtained_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, item_id)
);

CREATE TABLE user_profiles_extended (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    avatar_url TEXT,
    avatar_style VARCHAR(50) DEFAULT 'default',
    hobbies TEXT[],
    bio TEXT,
    equipped_background INTEGER REFERENCES shop_items(id),
    equipped_head INTEGER REFERENCES shop_items(id),
    equipped_body INTEGER REFERENCES shop_items(id),
    equipped_hand INTEGER REFERENCES shop_items(id),
    equipped_frame INTEGER REFERENCES shop_items(id),
    profile_views INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_user ON user_inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_items_category ON shop_items(category);

-- Seed shop items
INSERT INTO shop_items (code, name, description, category, price_coins, rarity, equip_slot, image_url, is_real, real_value) VALUES
-- BACKGROUNDS
('bg_park',        'Парк Закревського',    'Стандартний фон з парком',         'background', 0,    'common',    'background', '/images/items/bg_park.svg',    false, NULL),
('bg_dino',        'Юрський період',       'Фон з динозаврами',               'background', 100,  'common',    'background', '/images/items/bg_dino.svg',    false, NULL),
('bg_neon',        'Неонова вечірка',      'Яскравий неоновий фон',           'background', 200,  'uncommon',  'background', '/images/items/bg_neon.svg',    false, NULL),
('bg_space',       'Космос',              'Зоряне небо з планетами',          'background', 300,  'rare',      'background', '/images/items/bg_space.svg',   false, NULL),
('bg_gold',        'Золото',              'Преміальний золотий фон',          'background', 1000, 'legendary', 'background', '/images/items/bg_gold.svg',    false, NULL),
-- WEAPONS
('wp_sword',       'Іграшковий меч',      'Стандартний меч аніматора',         'weapon',     150,  'common',    'hand',       '/images/items/wp_sword.svg',   false, NULL),
('wp_laser',       'Лазерний меч',        'Неоновий лазерний меч',            'weapon',     400,  'rare',      'hand',       '/images/items/wp_laser.svg',   false, NULL),
('wp_dino_bone',   'Кістка динозавра',    'Справжня (ні) кістка T-Rex',      'weapon',     500,  'epic',      'hand',       '/images/items/wp_bone.svg',    false, NULL),
('wp_trident',     'Тризуб',             'Золотий тризуб',                   'weapon',     800,  'legendary', 'hand',       '/images/items/wp_trident.svg', false, NULL),
-- HATS
('hat_dino',       'Шапка динозавра',     'Голова тиранозавра',               'hat',        100,  'common',    'head',       '/images/items/hat_dino.svg',   false, NULL),
('hat_crown',      'Корона',             'Золота корона',                     'hat',        500,  'epic',      'head',       '/images/items/hat_crown.svg',  false, NULL),
('hat_chef',       'Ковпак шефа',        'Для справжніх кухарів',             'hat',        200,  'uncommon',  'head',       '/images/items/hat_chef.svg',   false, NULL),
-- OUTFITS
('out_animator',   'Костюм аніматора',   'Стандартна уніформа',               'outfit',     0,    'common',    'body',       '/images/items/out_animator.svg', false, NULL),
('out_pirate',     'Піратський костюм',  'Яр-хар!',                          'outfit',     300,  'rare',      'body',       '/images/items/out_pirate.svg',  false, NULL),
('out_space',      'Скафандр',           'Костюм космонавта',                 'outfit',     600,  'epic',      'body',       '/images/items/out_space.svg',   false, NULL),
-- FRAMES
('fr_basic',       'Базова рамка',       'Проста рамка',                      'frame',      0,    'common',    'frame',      '/images/items/fr_basic.svg',   false, NULL),
('fr_gold',        'Золота рамка',       'Преміальна рамка',                  'frame',      400,  'rare',      'frame',      '/images/items/fr_gold.svg',    false, NULL),
('fr_fire',        'Вогняна рамка',      'Палаюча рамка навколо аватара',     'frame',      700,  'epic',      'frame',      '/images/items/fr_fire.svg',    false, NULL),
-- REAL COUPONS
('coupon_coffee',  '☕ Купон на каву',    'Обміняй на справжню каву в парку',  'coupon',     500,  'uncommon',  NULL,         '/images/items/coupon_coffee.svg', true, '80 грн'),
('coupon_pizza',   '🍕 Купон на піцу',   'Піца вартістю 250 грн',             'coupon',     1500, 'rare',      NULL,         '/images/items/coupon_pizza.svg',  true, '250 грн')
ON CONFLICT (code) DO NOTHING;

-- Create extended profiles for existing users
INSERT INTO user_profiles_extended (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
