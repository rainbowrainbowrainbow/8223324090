-- v38.17: Seed gamification data for leaderboard, wallets, XP, streaks
-- So the leaderboard and profile don't look empty

INSERT INTO game_wallets (user_id, coins, total_earned, total_spent)
SELECT id,
    CASE role
        WHEN 'creator' THEN 2800 WHEN 'director' THEN 1500
        WHEN 'manager' THEN 800 WHEN 'animator' THEN 450
        WHEN 'admin' THEN 600 ELSE 200
    END,
    CASE role
        WHEN 'creator' THEN 5000 WHEN 'director' THEN 3000
        WHEN 'manager' THEN 1500 WHEN 'animator' THEN 900
        WHEN 'admin' THEN 1200 ELSE 400
    END, 0
FROM users WHERE id NOT IN (SELECT user_id FROM game_wallets)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_profiles_ext (username, level, xp)
SELECT username,
    CASE role
        WHEN 'creator' THEN 6 WHEN 'director' THEN 4
        WHEN 'manager' THEN 3 WHEN 'animator' THEN 2
        WHEN 'admin' THEN 3 ELSE 1
    END,
    CASE role
        WHEN 'creator' THEN 1885 WHEN 'director' THEN 950
        WHEN 'manager' THEN 520 WHEN 'animator' THEN 280
        WHEN 'admin' THEN 400 ELSE 50
    END
FROM users WHERE username NOT IN (SELECT username FROM user_profiles_ext)
ON CONFLICT (username) DO NOTHING;

INSERT INTO game_streaks (user_id, streak_type, current_count, best_count, last_date)
SELECT id, 'login',
    CASE role
        WHEN 'creator' THEN 12 WHEN 'director' THEN 8
        WHEN 'manager' THEN 5 WHEN 'animator' THEN 3
        WHEN 'admin' THEN 4 ELSE 1
    END,
    CASE role
        WHEN 'creator' THEN 30 WHEN 'director' THEN 15
        WHEN 'manager' THEN 10 WHEN 'animator' THEN 7
        WHEN 'admin' THEN 8 ELSE 3
    END, CURRENT_DATE
FROM users WHERE id NOT IN (SELECT user_id FROM game_streaks WHERE streak_type = 'login')
ON CONFLICT DO NOTHING;
