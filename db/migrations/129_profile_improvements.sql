-- v38.16: Profile improvements — shop items + daily quests seed
-- Ensure columns exist
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Real food items
INSERT INTO shop_items (item_id, name, description, icon, type, price_coins, category, is_active, is_featured, sort_order, rarity, code) VALUES
(NULL, 'Кава', 'Справжня кава від бариста парку. Замов і забери на рецепції!', '☕', 'real', 200, 'real', true, true, 1, 'common', 'real_coffee'),
(NULL, 'Піца', 'Ціла піца з меню парку. Замов на свій перерву!', '🍕', 'real', 800, 'real', true, true, 2, 'uncommon', 'real_pizza'),
(NULL, 'Морозиво', 'Порція морозива — ідеальний перекус між змінами', '🍦', 'real', 150, 'real', true, false, 3, 'common', 'real_icecream'),
(NULL, 'Лимонад', 'Свіжий домашній лимонад', '🍋', 'real', 100, 'real', true, false, 4, 'common', 'real_lemonade'),
(NULL, 'Солодка вата', 'Порція солодкої вати з автомату', '🍬', 'real', 250, 'real', true, false, 5, 'common', 'real_cotton_candy'),
(NULL, 'Поп-корн', 'Відерко попкорну — дивись кіно на перерві', '🍿', 'real', 300, 'real', true, false, 6, 'common', 'real_popcorn')
ON CONFLICT DO NOTHING;

-- Fun cosmetic items
ALTER TABLE character_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

INSERT INTO character_items (name, description, icon, type, rarity, is_buyable, price_coins, is_active, sort_order) VALUES
('Вогняна аура', 'Палаючий ефект навколо аватара', '🔥', 'effect', 'rare', true, 350, true, 20),
('Зоряний пил', 'Мерехтливі зірочки навколо профілю', '✨', 'effect', 'uncommon', true, 180, true, 21),
('Неонова рамка', 'Яскрава неонова рамка для аватара', '💜', 'frame', 'rare', true, 400, true, 22),
('Кепка DJ', 'Стильна кепка для справжнього DJ', '🧢', 'hat', 'uncommon', true, 200, true, 23),
('Піратська повязка', 'Арр! Для справжніх піратів парку', '🏴‍☠️', 'hat', 'rare', true, 500, true, 24),
('Фон Галактика', 'Космічний фон з зірками', '🌌', 'background', 'epic', true, 600, true, 25),
('Фон Джунглі', 'Тропічний фон з пальмами', '🌴', 'background', 'uncommon', true, 120, true, 26),
('Меч героя', 'Легендарна зброя для справжнього воїна', '⚔️', 'weapon', 'legendary', true, 1000, true, 27),
('Щит захисника', 'Міцний щит для захисту від босів', '🛡️', 'shield', 'rare', true, 350, true, 28)
ON CONFLICT DO NOTHING;

-- Link character_items to shop
INSERT INTO shop_items (item_id, name, description, icon, type, price_coins, category, is_active, sort_order, rarity, code)
SELECT id, name, description, icon, 'digital', price_coins, 'cosmetic', true, sort_order, rarity, 'char_' || id
FROM character_items WHERE is_buyable = true AND id NOT IN (SELECT item_id FROM shop_items WHERE item_id IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Daily quests
INSERT INTO daily_quests (code, title, description, quest_type, target_value, reward_coins, is_active) VALUES
('login_daily', 'Зайти в CRM', 'Просто зайди в систему сьогодні', 'login', 1, 10, true),
('complete_task', 'Виконай завдання', 'Заверши одне завдання з дошки', 'task_complete', 1, 25, true),
('play_match3', 'Зіграй в Match-3', 'Зіграй одну партію в міні-гру', 'game_play', 1, 15, true),
('score_200', 'Набери 200 очок', 'Набери 200+ очок в Match-3', 'game_score', 200, 50, true),
('chat_message', 'Напиши в чат', 'Відправ повідомлення в командний чат', 'chat_send', 1, 10, true),
('view_profile', 'Перегляни профіль', 'Зайди на сторінку свого профілю', 'profile_view', 1, 5, true),
('earn_combo', 'Зроби комбо x2', 'Досягни комбо x2 або вище в Match-3', 'game_combo', 2, 30, true),
('help_colleague', 'Допоможи колезі', 'Виконай завдання з тегом #допомога', 'task_tag', 1, 40, true)
ON CONFLICT DO NOTHING;
