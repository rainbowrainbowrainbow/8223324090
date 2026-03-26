-- v38.16: Profile improvements — shop items + daily quests seed
-- Ensure ALL columns exist (production DB may not have gamification v2/v3 migrations)
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS rarity VARCHAR(20) DEFAULT 'common';
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS category VARCHAR(30) DEFAULT 'cosmetic';
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS icon VARCHAR(10) DEFAULT '🛒';
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS equip_slot VARCHAR(30);
ALTER TABLE character_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Real food items
INSERT INTO shop_items (item_id, name, description, icon, type, price_coins, category, is_active, is_featured, sort_order, rarity, code) VALUES
(NULL, 'Кава', 'Справжня кава від бариста парку', '☕', 'real', 200, 'real', true, true, 1, 'common', 'real_coffee'),
(NULL, 'Піца', 'Ціла піца з меню парку', '🍕', 'real', 800, 'real', true, true, 2, 'uncommon', 'real_pizza'),
(NULL, 'Морозиво', 'Порція морозива', '🍦', 'real', 150, 'real', true, false, 3, 'common', 'real_icecream'),
(NULL, 'Лимонад', 'Свіжий домашній лимонад', '🍋', 'real', 100, 'real', true, false, 4, 'common', 'real_lemonade'),
(NULL, 'Солодка вата', 'Порція солодкої вати', '🍬', 'real', 250, 'real', true, false, 5, 'common', 'real_cotton_candy'),
(NULL, 'Поп-корн', 'Відерко попкорну', '🍿', 'real', 300, 'real', true, false, 6, 'common', 'real_popcorn')
ON CONFLICT DO NOTHING;

-- Cosmetic items
INSERT INTO character_items (name, description, icon, type, rarity, is_buyable, price_coins, is_active, sort_order) VALUES
('Вогняна аура', 'Палаючий ефект', '🔥', 'effect', 'rare', true, 350, true, 20),
('Зоряний пил', 'Мерехтливі зірочки', '✨', 'effect', 'uncommon', true, 180, true, 21),
('Неонова рамка', 'Яскрава неонова рамка', '💜', 'frame', 'rare', true, 400, true, 22),
('Кепка DJ', 'Стильна кепка', '🧢', 'hat', 'uncommon', true, 200, true, 23),
('Піратська повязка', 'Для справжніх піратів', '🏴‍☠️', 'hat', 'rare', true, 500, true, 24),
('Фон Галактика', 'Космічний фон', '🌌', 'background', 'epic', true, 600, true, 25),
('Фон Джунглі', 'Тропічний фон', '🌴', 'background', 'uncommon', true, 120, true, 26),
('Меч героя', 'Легендарна зброя', '⚔️', 'weapon', 'legendary', true, 1000, true, 27),
('Щит захисника', 'Міцний щит', '🛡️', 'shield', 'rare', true, 350, true, 28)
ON CONFLICT DO NOTHING;

-- Link to shop
INSERT INTO shop_items (item_id, name, description, icon, type, price_coins, category, is_active, sort_order, rarity, code)
SELECT id, name, description, icon, 'digital', price_coins, 'cosmetic', true, sort_order, rarity, 'char_' || id
FROM character_items WHERE is_buyable = true AND id NOT IN (SELECT item_id FROM shop_items WHERE item_id IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Daily quests — ensure table and columns exist
CREATE TABLE IF NOT EXISTS daily_quests (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50),
    title VARCHAR(200),
    description TEXT,
    quest_type VARCHAR(30) DEFAULT 'play_minigame',
    target_value INTEGER DEFAULT 1,
    reward_coins INTEGER DEFAULT 25,
    is_active BOOLEAN DEFAULT true
);
INSERT INTO daily_quests (code, title, description, quest_type, target_value, reward_coins, is_active) VALUES
('login_daily', 'Зайти в CRM', 'Просто зайди в систему', 'login', 1, 10, true),
('complete_task', 'Виконай завдання', 'Заверши одне завдання', 'task_complete', 1, 25, true),
('play_match3', 'Зіграй в Match-3', 'Зіграй одну партію', 'game_play', 1, 15, true),
('score_200', 'Набери 200 очок', 'Набери 200+ в Match-3', 'game_score', 200, 50, true),
('chat_message', 'Напиши в чат', 'Відправ повідомлення', 'chat_send', 1, 10, true),
('view_profile', 'Перегляни профіль', 'Зайди на профіль', 'profile_view', 1, 5, true),
('earn_combo', 'Зроби комбо x2', 'Досягни комбо x2+', 'game_combo', 2, 30, true),
('help_colleague', 'Допоможи колезі', 'Завдання з тегом #допомога', 'task_tag', 1, 40, true)
ON CONFLICT DO NOTHING;
