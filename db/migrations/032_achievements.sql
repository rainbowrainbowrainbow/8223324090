-- Migration 032: Achievements system
-- Defensive: clean state
DROP TABLE IF EXISTS user_achievements CASCADE;
DROP TABLE IF EXISTS achievements CASCADE;

CREATE TABLE achievements (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    icon VARCHAR(10),
    category VARCHAR(50) NOT NULL,
    type VARCHAR(20) DEFAULT 'one_time',
    reward_coins INTEGER DEFAULT 50,
    reward_item_id INTEGER,
    condition JSONB,
    rarity VARCHAR(20) DEFAULT 'common',
    is_secret BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_achievements (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    achievement_id INTEGER REFERENCES achievements(id),
    progress INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    times_completed INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_completed ON user_achievements(user_id, completed);

-- Seed achievements
INSERT INTO achievements (code, name, description, icon, category, type, reward_coins, rarity, condition, is_secret) VALUES
-- WORK
('first_task',        'Перший крок',           'Виконай першу задачу',                    '👣', 'work',     'one_time',    50,  'common',    '{"type":"tasks_completed","count":1}', false),
('task_master_10',    'Працівник місяця',      'Виконай 10 задач',                        '🏆', 'work',     'progressive', 100, 'uncommon',  '{"type":"tasks_completed","count":10}', false),
('task_master_100',   'Легенда продуктивності','Виконай 100 задач',                       '👑', 'work',     'progressive', 500, 'epic',      '{"type":"tasks_completed","count":100}', false),
('speed_demon',       'Швидкий як блискавка',  'Закрий задачу за 5 хвилин',               '⚡', 'work',     'one_time',    75,  'uncommon',  '{"type":"task_speed","max_minutes":5}', false),
('perfect_week',      'Ідеальний тиждень',     '7 днів без прострочених задач',            '✨', 'work',     'one_time',    200, 'rare',      '{"type":"perfect_days","count":7}', false),
('early_bird',        'Ранній птах',           'Відмітився на зміні до 7:30',             '🐦', 'work',     'repeatable',  20,  'common',    '{"type":"early_checkin","before":"07:30"}', false),
('night_owl',         'Нічна зміна',           'Написав в чат після 23:00',               '🦉', 'work',     'one_time',    30,  'common',    '{"type":"late_message","after":"23:00"}', false),
-- SOCIAL
('first_gift',        'Щедра душа',           'Подаруй монети іншому',                    '🎁', 'social',   'one_time',    50,  'common',    '{"type":"gift_sent","count":1}', false),
('team_player',       'Командний гравець',     'Допоможи 5 колегам за тиждень',           '🤝', 'social',   'progressive', 150, 'uncommon',  '{"type":"helped_colleagues","count":5}', false),
('chat_star',         'Зірка чату',            'Отримай 10 реакцій в чаті',               '⭐', 'social',   'progressive', 100, 'uncommon',  '{"type":"reactions_received","count":10}', false),
-- RARE
('bug_hunter',        'Мисливець за багами',   'Знайди баг в системі',                     '🐛', 'rare',     'one_time',    300, 'rare',      '{"type":"manual_award"}', false),
('quiz_champion',     'Чемпіон квізів',        'Дай 5 правильних відповідей поспіль',      '🧠', 'rare',     'one_time',    250, 'rare',      '{"type":"quiz_streak","count":5}', false),
('lucky_one',         'Щасливчик',             'Виграй рідкісний ітем',                    '🍀', 'rare',     'one_time',    100, 'epic',      '{"type":"rare_drop"}', false),
-- SECRET
('konami',            '???',                   'Знайди секрет...',                         '🔮', 'secret',   'one_time',    500, 'legendary', '{"type":"easter_egg","code":"konami"}', true),
('late_gamer',        'Ніч в парку',           'Грай в міні-гру після 2:00',              '🌙', 'secret',   'one_time',    100, 'rare',      '{"type":"minigame_late","after":"02:00"}', true),
-- SEASONAL
('nye_worker',        'Новорічний герой',      'Працював на Новий рік',                    '🎄', 'seasonal', 'one_time',    300, 'epic',      '{"type":"worked_holiday","date":"01-01"}', false),
('summer_record',     'Літній рекорд',         'Рекорд бронювань у липні',                 '☀️', 'seasonal', 'one_time',    200, 'rare',      '{"type":"monthly_record","month":7}', false)
ON CONFLICT (code) DO NOTHING;
