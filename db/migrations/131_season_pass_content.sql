-- v38.18: Seed spring season pass content
-- Season quests for the current spring season

INSERT INTO seasonal_quests (code, title, description, icon, season, quest_type, target_value, reward_coins, reward_xp, reward_title, start_date, end_date)
VALUES
    ('spring_bookings_10', 'Весняний бум', 'Створи 10 бронювань цього сезону', '🌸', 'spring', 'booking_count', 10, 500, 200, NULL, '2026-03-01', '2026-05-31'),
    ('spring_tasks_20', 'Трудівник весни', 'Заверши 20 завдань за сезон', '🌿', 'spring', 'task_count', 20, 300, 150, NULL, '2026-03-01', '2026-05-31'),
    ('spring_streak_14', 'Весняний марафон', 'Набери streak 14 днів поспіль', '🔥', 'spring', 'streak_days', 14, 400, 250, 'Невтомний', '2026-03-01', '2026-05-31'),
    ('spring_xp_1000', 'XP Збирач', 'Набери 1000 XP за сезон', '⚡', 'spring', 'xp_earned', 1000, 600, 300, NULL, '2026-03-01', '2026-05-31'),
    ('spring_games_5', 'Ігроман', 'Зіграй 5 мініігор за сезон', '🎮', 'spring', 'minigame_count', 5, 200, 100, NULL, '2026-03-01', '2026-05-31'),
    ('spring_master', 'Майстер весни', 'Виконай всі 5 сезонних квестів', '🏆', 'spring', 'season_complete', 5, 1000, 500, 'Майстер Весни 2026', '2026-03-01', '2026-05-31')
ON CONFLICT (code) DO NOTHING;
