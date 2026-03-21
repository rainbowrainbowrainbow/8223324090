-- v33.8.0: Achievement catalog seed (10 achievements for animators)
INSERT INTO achievement_catalog
    (key, name, description, icon, condition_type, condition_value, reward_type, reward_value, is_active)
VALUES
    ('first_booking',    'Перше свято',              'Ваше перше бронювання',                   '🌟', 'booking_count',  1,   'coins', 10,  true),
    ('five_bookings',    'П''ять свят',               '5 проведених свят',                        '🎉', 'booking_count',  5,   'coins', 25,  true),
    ('ten_bookings',     'Десяток свят',              '10 проведених свят',                       '🏆', 'booking_count',  10,  'coins', 50,  true),
    ('twenty_bookings',  'Двадцять свят',             '20 проведених свят',                       '💫', 'booking_count',  20,  'coins', 100, true),
    ('fifty_bookings',   'Майстер свят',              '50 проведених свят — ти легенда!',         '👑', 'booking_count',  50,  'coins', 250, true),
    ('hundred_bookings', 'Динозавр вечірок',          '100 свят — неймовірно!',                   '🦕', 'booking_count',  100, 'coins', 500, true),
    ('week_streak',      'Тиждень без пропусків',     '7 днів поспіль активності',                '🔥', 'streak',         7,   'coins', 50,  true),
    ('month_streak',     'Місяць без пропусків',      '30 днів поспіль',                           '⚡', 'streak',         30,  'coins', 200, true),
    ('ten_tasks',        'Задачний',                  '10 виконаних задач',                        '✅', 'task_count',     10,  'coins', 20,  true),
    ('fifty_tasks',      'Машина продуктивності',     '50 виконаних задач',                       '⚙️', 'task_count',     50,  'coins', 100, true)
ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name, description = EXCLUDED.description,
    condition_value = EXCLUDED.condition_value, reward_value = EXCLUDED.reward_value;
