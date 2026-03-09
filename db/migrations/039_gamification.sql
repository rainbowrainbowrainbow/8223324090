-- 039_gamification.sql — Gamification MVP (v22.2.0)
-- Achievement catalog, game coins, inventory, shop, extended profiles, characters

-- Extended user profiles (hobbies, bio, avatar)
CREATE TABLE IF NOT EXISTS user_profiles_ext (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    bio TEXT DEFAULT '',
    hobbies TEXT[] DEFAULT '{}',
    avatar_url TEXT,
    avatar_style VARCHAR(30) DEFAULT 'photo',
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    title VARCHAR(100) DEFAULT 'Новачок',
    profile_bg VARCHAR(50) DEFAULT 'default',
    profile_frame VARCHAR(50) DEFAULT 'none',
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_ext_username ON user_profiles_ext(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_ext_level ON user_profiles_ext(level DESC);

-- Achievement catalog (master list of all achievements)
CREATE TABLE IF NOT EXISTS achievement_catalog (
    id SERIAL PRIMARY KEY,
    key VARCHAR(60) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    icon VARCHAR(10) DEFAULT '🏆',
    type VARCHAR(20) NOT NULL DEFAULT 'one_time',
    -- types: one_time, repeatable, rare, secret, hobby, seasonal
    category VARCHAR(30) DEFAULT 'work',
    -- categories: work, social, fun, secret, seasonal
    condition_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    -- condition_types: task_count, booking_count, streak, manual, login_count, quiz
    condition_value INTEGER DEFAULT 1,
    reward_type VARCHAR(20) DEFAULT 'coins',
    -- reward_types: coins, xp, item, title, badge
    reward_value INTEGER DEFAULT 10,
    reward_item_id INTEGER,
    rarity VARCHAR(20) DEFAULT 'common',
    -- rarities: common, uncommon, rare, epic, legendary
    is_secret BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_achievement_catalog_type ON achievement_catalog(type);
CREATE INDEX IF NOT EXISTS idx_achievement_catalog_active ON achievement_catalog(is_active);

-- Upgrade existing user_achievements to link to catalog
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS achievement_id INTEGER;
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS max_progress INTEGER DEFAULT 1;
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS coins_awarded INTEGER DEFAULT 0;
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS xp_awarded INTEGER DEFAULT 0;

-- Game currency (coins — separate from existing points)
CREATE TABLE IF NOT EXISTS game_currency (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    coins INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_currency_username ON game_currency(username);
CREATE INDEX IF NOT EXISTS idx_game_currency_coins ON game_currency(coins DESC);

-- Coin transactions history
CREATE TABLE IF NOT EXISTS coin_transactions (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    amount INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL,
    -- types: earn, spend, gift_in, gift_out, admin
    reason VARCHAR(200),
    source_type VARCHAR(30),
    -- source_types: task, achievement, shop, gift, quiz, admin
    source_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_username ON coin_transactions(username);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_created ON coin_transactions(created_at DESC);

-- Item catalog (all equippable items for characters)
CREATE TABLE IF NOT EXISTS character_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT DEFAULT '',
    icon VARCHAR(10) DEFAULT '🎁',
    type VARCHAR(30) NOT NULL,
    -- types: background, frame, hat, weapon, shield, outfit, effect, badge
    image_url TEXT,
    rarity VARCHAR(20) DEFAULT 'common',
    -- rarities: common, uncommon, rare, epic, legendary
    is_buyable BOOLEAN DEFAULT false,
    price_coins INTEGER DEFAULT 0,
    is_achievement_reward BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_character_items_type ON character_items(type);
CREATE INDEX IF NOT EXISTS idx_character_items_rarity ON character_items(rarity);

-- User inventory (owned items)
CREATE TABLE IF NOT EXISTS user_inventory (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    item_id INTEGER NOT NULL REFERENCES character_items(id),
    acquired_via VARCHAR(30) DEFAULT 'shop',
    -- acquired_via: shop, achievement, gift, admin, event
    acquired_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(username, item_id)
);
CREATE INDEX IF NOT EXISTS idx_user_inventory_username ON user_inventory(username);

-- User equipped items (what's currently worn)
CREATE TABLE IF NOT EXISTS user_equipped (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    slot VARCHAR(30) NOT NULL,
    -- slots: background, frame, hat, weapon, shield, outfit, effect, badge
    item_id INTEGER NOT NULL REFERENCES character_items(id),
    equipped_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(username, slot)
);
CREATE INDEX IF NOT EXISTS idx_user_equipped_username ON user_equipped(username);

-- Shop catalog (items available for purchase)
CREATE TABLE IF NOT EXISTS shop_items (
    id SERIAL PRIMARY KEY,
    item_id INTEGER REFERENCES character_items(id),
    name VARCHAR(100) NOT NULL,
    description TEXT DEFAULT '',
    icon VARCHAR(10) DEFAULT '🛒',
    type VARCHAR(20) NOT NULL DEFAULT 'digital',
    -- types: digital, real, coupon
    price_coins INTEGER NOT NULL DEFAULT 0,
    price_display VARCHAR(50),
    -- for real items: "250 ₴" (psychological price)
    stock INTEGER DEFAULT -1,
    -- -1 = unlimited
    is_featured BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_items_active ON shop_items(is_active);
CREATE INDEX IF NOT EXISTS idx_shop_items_type ON shop_items(type);

-- Purchase history
CREATE TABLE IF NOT EXISTS shop_purchases (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    shop_item_id INTEGER NOT NULL REFERENCES shop_items(id),
    coins_paid INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'completed',
    -- statuses: completed, pending_pickup, redeemed, cancelled
    redeemed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_username ON shop_purchases(username);

-- Seed: default achievement catalog
INSERT INTO achievement_catalog (key, name, description, icon, type, category, condition_type, condition_value, reward_type, reward_value, rarity) VALUES
    ('first_booking', 'Перше бронювання', 'Створити перше бронювання в системі', '🎯', 'one_time', 'work', 'booking_count', 1, 'coins', 20, 'common'),
    ('first_task', 'Перше завдання', 'Виконати перше завдання', '✅', 'one_time', 'work', 'task_count', 1, 'coins', 15, 'common'),
    ('task_master_10', '10 завдань', 'Виконати 10 завдань', '⚡', 'one_time', 'work', 'task_count', 10, 'coins', 50, 'uncommon'),
    ('task_master_50', '50 завдань', 'Виконати 50 завдань', '💪', 'one_time', 'work', 'task_count', 50, 'coins', 150, 'rare'),
    ('task_master_100', 'Сотня', 'Виконати 100 завдань', '🔥', 'one_time', 'work', 'task_count', 100, 'coins', 500, 'epic'),
    ('streak_3', 'Три дні поспіль', '3-денний стрік активності', '📅', 'one_time', 'work', 'streak', 3, 'coins', 30, 'common'),
    ('streak_7', 'Тижнева серія', '7-денний стрік активності', '🗓️', 'one_time', 'work', 'streak', 7, 'coins', 75, 'uncommon'),
    ('streak_30', 'Місячний марафон', '30-денний стрік активності', '🏅', 'one_time', 'work', 'streak', 30, 'coins', 300, 'epic'),
    ('speed_demon', 'Швидкісний демон', 'Виконати завдання менш ніж за 10 хвилин', '⏱️', 'repeatable', 'work', 'manual', 1, 'coins', 10, 'uncommon'),
    ('night_owl', 'Нічна зміна', 'Написати в чат після 23:00', '🦉', 'one_time', 'fun', 'manual', 1, 'coins', 5, 'common'),
    ('bug_hunter', 'Детектив', 'Знайти баг в системі', '🔍', 'repeatable', 'fun', 'manual', 1, 'coins', 25, 'rare'),
    ('initiative', 'Ініціатива', 'Створити задачу самостійно', '💡', 'repeatable', 'work', 'manual', 1, 'coins', 15, 'uncommon'),
    ('mentor', 'Наставник', 'Навчити нового співробітника', '🎓', 'one_time', 'social', 'manual', 1, 'coins', 100, 'rare'),
    ('zero_complaints', 'Бездоганний тиждень', '0 скарг від клієнтів за тиждень', '⭐', 'repeatable', 'work', 'manual', 1, 'coins', 40, 'uncommon'),
    ('positive_review', 'Зірка відгуків', 'Отримати позитивний відгук від клієнта', '🌟', 'repeatable', 'work', 'manual', 1, 'coins', 20, 'common'),
    ('booking_record', 'Рекордсмен', 'Рекорд по кількості бронювань за день', '🏆', 'one_time', 'work', 'manual', 1, 'coins', 200, 'legendary'),
    ('early_bird', 'Рання пташка', 'Закрити всі задачі до 12:00', '🐦', 'repeatable', 'work', 'manual', 1, 'coins', 15, 'common'),
    ('team_player', 'Командний гравець', 'Допомогти 5 колегам за тиждень', '🤝', 'repeatable', 'social', 'manual', 1, 'coins', 30, 'uncommon'),
    ('secret_easter_egg', 'Пасхалка!', 'Знайти секретну пасхалку в системі', '🥚', 'one_time', 'secret', 'manual', 1, 'coins', 50, 'legendary'),
    ('forgot_task', 'Заблукав', 'Забути закрити задачу 3+ дні', '🧭', 'one_time', 'fun', 'manual', 1, 'coins', 1, 'common')
ON CONFLICT (key) DO NOTHING;

-- Seed: default character items
INSERT INTO character_items (name, description, icon, type, rarity, is_buyable, price_coins) VALUES
    ('Класичний фон', 'Стандартний фон профілю', '🎨', 'background', 'common', false, 0),
    ('Нічне небо', 'Темний фон із зірками', '🌌', 'background', 'uncommon', true, 50),
    ('Захід сонця', 'Теплий градієнт заходу', '🌅', 'background', 'uncommon', true, 50),
    ('Космос', 'Галактичний фон', '🌠', 'background', 'rare', true, 150),
    ('Золота рамка', 'Золота рамка для аватара', '✨', 'frame', 'rare', true, 100),
    ('Діамантова рамка', 'Блискуча діамантова рамка', '💎', 'frame', 'epic', true, 300),
    ('Корона', 'Королівська корона', '👑', 'hat', 'legendary', true, 500),
    ('Капелюх чарівника', 'Магічний капелюх', '🎩', 'hat', 'rare', true, 120),
    ('Меч світла', 'Легендарна зброя', '⚔️', 'weapon', 'epic', true, 250),
    ('Щит хоробрості', 'Захисний щит', '🛡️', 'shield', 'rare', true, 150),
    ('Вогняний ефект', 'Вогняна аура навколо персонажа', '🔥', 'effect', 'epic', true, 200),
    ('Зоряний ефект', 'Зірки навколо персонажа', '✨', 'effect', 'uncommon', true, 80),
    ('Бейдж VIP', 'VIP статус', '🏷️', 'badge', 'legendary', false, 0)
ON CONFLICT DO NOTHING;

-- Seed: shop items (digital + future real items)
INSERT INTO shop_items (item_id, name, description, icon, type, price_coins, price_display, is_featured) VALUES
    (2, 'Нічне небо', 'Темний фон із зірками для профілю', '🌌', 'digital', 50, NULL, false),
    (3, 'Захід сонця', 'Теплий градієнт заходу', '🌅', 'digital', 50, NULL, false),
    (4, 'Космос', 'Галактичний фон для профілю', '🌠', 'digital', 150, NULL, true),
    (5, 'Золота рамка', 'Золота рамка для аватара', '✨', 'digital', 100, NULL, false),
    (6, 'Діамантова рамка', 'Блискуча діамантова рамка', '💎', 'digital', 300, NULL, true),
    (7, 'Корона', 'Королівська корона для персонажа', '👑', 'digital', 500, NULL, true),
    (8, 'Капелюх чарівника', 'Магічний капелюх', '🎩', 'digital', 120, NULL, false),
    (9, 'Меч світла', 'Легендарна зброя для персонажа', '⚔️', 'digital', 250, NULL, true),
    (10, 'Щит хоробрості', 'Захисний щит', '🛡️', 'digital', 150, NULL, false),
    (11, 'Вогняний ефект', 'Вогняна аура навколо персонажа', '🔥', 'digital', 200, NULL, false),
    (12, 'Зоряний ефект', 'Зірки навколо персонажа', '✨', 'digital', 80, NULL, false),
    (NULL, '☕ Кава', 'Купон на справжню каву в офісі', '☕', 'real', 100, '65 ₴', true),
    (NULL, '🍕 Піца', 'Купон на справжню піцу', '🍕', 'real', 250, '250 ₴', true)
ON CONFLICT DO NOTHING;

-- Level thresholds (XP needed per level)
CREATE TABLE IF NOT EXISTS level_thresholds (
    level INTEGER PRIMARY KEY,
    xp_required INTEGER NOT NULL,
    title VARCHAR(100) NOT NULL
);
INSERT INTO level_thresholds (level, xp_required, title) VALUES
    (1, 0, 'Новачок'),
    (2, 100, 'Стажер'),
    (3, 300, 'Помічник'),
    (4, 600, 'Працівник'),
    (5, 1000, 'Спеціаліст'),
    (6, 1500, 'Експерт'),
    (7, 2500, 'Майстер'),
    (8, 4000, 'Ветеран'),
    (9, 6000, 'Легенда'),
    (10, 10000, 'Герой парку')
ON CONFLICT (level) DO NOTHING;
