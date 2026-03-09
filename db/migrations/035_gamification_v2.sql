-- Migration 035: Gamification v2 — Room, Effects, Quests, Titles, Daily Login
-- Resets coins to 500 for all, adds rooms, daily quests, titles system

-- ===== BLOCK 1: Reset coins to 500 =====
UPDATE game_wallets SET coins = 500, total_earned = 500, total_spent = 0;
DELETE FROM coin_transactions;
INSERT INTO coin_transactions (user_id, amount, type, description)
SELECT user_id, 500, 'starter_bonus', 'Стартовий бонус v2' FROM game_wallets;

-- New users also get 500
ALTER TABLE game_wallets ALTER COLUMN coins SET DEFAULT 500;

-- Daily login columns
ALTER TABLE game_wallets ADD COLUMN IF NOT EXISTS login_streak INTEGER DEFAULT 0;
ALTER TABLE game_wallets ADD COLUMN IF NOT EXISTS last_login_reward DATE;

-- ===== BLOCK 2: Avatar effects (new shop items) =====
INSERT INTO shop_items (code, name, description, category, price_coins, rarity, equip_slot, image_url, is_real, real_value) VALUES
('fx_sparkle',   'Іскри',         'Золоті іскри навколо аватара',           'effect', 150,  'uncommon',  'effect', '/images/items/fx_sparkle.svg',   false, NULL),
('fx_fire',      'Полум''я',      'Червоно-помаранчева аура знизу',         'effect', 300,  'rare',      'effect', '/images/items/fx_fire.svg',      false, NULL),
('fx_ice',       'Крига',         'Блакитні частинки зверху вниз',          'effect', 300,  'rare',      'effect', '/images/items/fx_ice.svg',       false, NULL),
('fx_rainbow',   'Веселка',       'Веселковий gradient навколо',            'effect', 500,  'epic',      'effect', '/images/items/fx_rainbow.svg',   false, NULL),
('fx_lightning', 'Блискавка',     'Жовті спалахи навколо аватара',          'effect', 600,  'epic',      'effect', '/images/items/fx_lightning.svg', false, NULL),
('fx_shadow',    'Тіньова аура',  'Темно-фіолетовий пульс з тінями',       'effect', 1000, 'legendary', 'effect', '/images/items/fx_shadow.svg',   false, NULL)
ON CONFLICT (code) DO NOTHING;

-- Add effect slot to user_profiles_extended
ALTER TABLE user_profiles_extended ADD COLUMN IF NOT EXISTS equipped_effect INTEGER REFERENCES shop_items(id);

-- ===== BLOCK 3: Visual Room =====
CREATE TABLE IF NOT EXISTS user_rooms (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    wallpaper_item_id INTEGER REFERENCES shop_items(id),
    floor_item_id INTEGER REFERENCES shop_items(id),
    layout JSONB DEFAULT '{}',
    mood VARCHAR(20) DEFAULT 'happy',
    visitor_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_visits (
    id SERIAL PRIMARY KEY,
    room_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    visitor_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    visited_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_user ON user_rooms(user_id);
CREATE INDEX IF NOT EXISTS idx_room_visits_room ON room_visits(room_user_id);
CREATE INDEX IF NOT EXISTS idx_room_visits_time ON room_visits(visited_at);

-- Room items: wallpapers
INSERT INTO shop_items (code, name, description, category, price_coins, rarity, equip_slot, image_url, is_real, real_value) VALUES
('wall_default',  'Базові шпалери',      'Стандартні стіни кімнати',        'wallpaper', 0,   'common',    'wallpaper', '/images/items/wall_default.svg', false, NULL),
('wall_jungle',   'Джунглі',             'Тропічні ліани і папороті',       'wallpaper', 200, 'uncommon',  'wallpaper', '/images/items/wall_jungle.svg',  false, NULL),
('wall_space',    'Космічна станція',    'Зоряне вікно і панелі',           'wallpaper', 400, 'rare',      'wallpaper', '/images/items/wall_space.svg',   false, NULL),
('wall_castle',   'Замок',               'Кам''яні стіни і факели',         'wallpaper', 800, 'epic',      'wallpaper', '/images/items/wall_castle.svg',  false, NULL)
ON CONFLICT (code) DO NOTHING;

-- Room items: floors
INSERT INTO shop_items (code, name, description, category, price_coins, rarity, equip_slot, image_url, is_real, real_value) VALUES
('floor_wood',    'Дерев''яна підлога',  'Класичний паркет',                'floor',     0,   'common',    'floor', '/images/items/floor_wood.svg',    false, NULL),
('floor_marble',  'Мармурова підлога',   'Білий мармур з прожилками',       'floor',     300, 'rare',      'floor', '/images/items/floor_marble.svg',  false, NULL),
('floor_lava',    'Лава',                'Палаюча лава під ногами',         'floor',     600, 'epic',      'floor', '/images/items/floor_lava.svg',    false, NULL)
ON CONFLICT (code) DO NOTHING;

-- Room items: furniture
INSERT INTO shop_items (code, name, description, category, price_coins, rarity, equip_slot, image_url, is_real, real_value) VALUES
('furn_desk',        'Робочий стіл',       'Стіл з монітором',              'furniture', 100, 'common',    'furniture', '/images/items/furn_desk.svg',       false, NULL),
('furn_plant',       'Кімнатна рослина',   'Затишний вазон з пальмою',      'furniture', 50,  'common',    'furniture', '/images/items/furn_plant.svg',      false, NULL),
('furn_trophy',      'Кубок',              'Золотий кубок переможця',       'furniture', 300, 'rare',      'furniture', '/images/items/furn_trophy.svg',     false, NULL),
('furn_arcade',      'Ігровий автомат',    'Ретро-аркада з динозаврами',    'furniture', 500, 'epic',      'furniture', '/images/items/furn_arcade.svg',     false, NULL),
('furn_dino_statue', 'Статуя динозавра',   'Міні T-Rex на п''єдесталі',     'furniture', 700, 'epic',      'furniture', '/images/items/furn_dino_statue.svg', false, NULL)
ON CONFLICT (code) DO NOTHING;

-- ===== BLOCK 4: Daily Quests =====
CREATE TABLE IF NOT EXISTS daily_quests (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    target_value INTEGER NOT NULL DEFAULT 1,
    reward_coins INTEGER NOT NULL DEFAULT 20,
    quest_type VARCHAR(30) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_daily_quests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    quest_id INTEGER REFERENCES daily_quests(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    progress INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    claimed BOOLEAN DEFAULT FALSE,
    UNIQUE(user_id, quest_id, date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_quests_user_date ON user_daily_quests(user_id, date);

-- Seed quests
INSERT INTO daily_quests (code, title, description, target_value, reward_coins, quest_type) VALUES
('complete_3_tasks',    'Виконай 3 задачі',       'Закрий 3 задачі за день',         3, 30, 'complete_tasks'),
('create_booking',      'Створи бронювання',       'Створи одне нове бронювання',     1, 25, 'create_booking'),
('play_minigame',       'Зіграй в міні-гру',      'Зіграй одну партію 3-в-ряд',     1, 15, 'play_minigame'),
('visit_2_rooms',       'Відвідай 2 кімнати',      'Зайди в кімнати двох колег',     2, 20, 'visit_room'),
('send_5_messages',     'Надішли 5 повідомлень',   'Напиши 5 повідомлень в чат',     5, 15, 'send_message'),
('early_checkin',       'Зайди до 9:00',           'Увійди в систему до 9 ранку',    1, 25, 'early_login'),
('mark_shift',          'Відмітися на зміні',      'Почни або заверши робочу зміну', 1, 20, 'mark_shift'),
('complete_all_quests', 'Виконай всі 3 квести',    'Заверши всі денні квести',       3, 50, 'meta_quest')
ON CONFLICT (code) DO NOTHING;

-- ===== BLOCK 5: Titles / Ranks =====
CREATE TABLE IF NOT EXISTS title_definitions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    condition_type VARCHAR(50) NOT NULL,
    condition_value INTEGER DEFAULT 0,
    rarity VARCHAR(20) DEFAULT 'common',
    icon VARCHAR(10) DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_titles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title_code VARCHAR(50) NOT NULL,
    earned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, title_code)
);

ALTER TABLE user_profiles_extended ADD COLUMN IF NOT EXISTS active_title VARCHAR(50) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles(user_id);

-- Seed titles
INSERT INTO title_definitions (code, name, description, condition_type, condition_value, rarity, icon) VALUES
('newbie',     'Новачок',             'Ласкаво просимо!',               'registration',    0,    'common',    '🐣'),
('worker',     'Працівник',           'Виконай 10 задач',               'tasks_completed', 10,   'common',    '🔧'),
('master',     'Майстер',             'Виконай 50 задач',               'tasks_completed', 50,   'uncommon',  '⚒️'),
('legend',     'Легенда',             'Виконай 200 задач',              'tasks_completed', 200,  'epic',       '🏛️'),
('collector',  'Колекціонер',         'Зібери 10 предметів',            'items_owned',     10,   'uncommon',  '🎒'),
('rich',       'Багатій',             'Заробити 5000 монет загалом',    'total_earned',    5000, 'rare',       '💰'),
('gamer',      'Гравець',             'Зіграй 20 ігор',                'games_played',    20,   'uncommon',  '🎮'),
('social',     'Соціальний метелик',  'Надішли 100 повідомлень',        'messages_sent',   100,  'rare',       '🦋'),
('decorator',  'Декоратор',           'Обстав кімнату (3+ предмети)',   'room_items',      3,    'uncommon',  '🎨'),
('early',      'Ранній птах',         '30 чекінів до 9:00',            'early_checkins',  30,   'rare',       '🐦'),
('veteran',    'Ветеран',             '90 днів у системі',              'days_active',     90,   'epic',       '🎖️'),
('champion',   'Чемпіон',            'Зайняти #1 у лідерборді',        'leaderboard_top', 1,    'legendary', '🏆')
ON CONFLICT (code) DO NOTHING;

-- Give everyone the "Newbie" title
INSERT INTO user_titles (user_id, title_code)
SELECT id, 'newbie' FROM users
ON CONFLICT (user_id, title_code) DO NOTHING;

-- Auto-create rooms for existing users
INSERT INTO user_rooms (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
