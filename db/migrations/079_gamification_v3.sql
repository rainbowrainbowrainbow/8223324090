-- Migration 079: Gamification v3 — Leaderboard, Seasons, Teams, Challenges, Referrals, Redemptions
-- Author: [claude-code]

-- Monthly leaderboard snapshots
CREATE TABLE IF NOT EXISTS monthly_leaderboard (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'overall',
    score INT NOT NULL DEFAULT 0,
    rank INT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(username, year, month, category)
);

-- Seasonal quests
CREATE TABLE IF NOT EXISTS seasonal_quests (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    icon VARCHAR(10) DEFAULT '🏔️',
    season VARCHAR(20) NOT NULL,
    quest_type VARCHAR(50) NOT NULL,
    target_value INT NOT NULL,
    reward_coins INT NOT NULL DEFAULT 0,
    reward_xp INT NOT NULL DEFAULT 0,
    reward_item_id INT,
    reward_title VARCHAR(100),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_seasonal_quests (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    quest_id INT REFERENCES seasonal_quests(id) ON DELETE CASCADE,
    progress INT DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    claimed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP,
    claimed_at TIMESTAMP,
    UNIQUE(username, quest_id)
);

-- Teams
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(10) DEFAULT '⚡',
    color VARCHAR(7) DEFAULT '#6366f1',
    captain_username VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_id INT REFERENCES teams(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(username)
);

-- Team challenges
CREATE TABLE IF NOT EXISTS team_challenges (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    icon VARCHAR(10) DEFAULT '🏆',
    challenge_type VARCHAR(50) NOT NULL,
    target_value INT NOT NULL,
    reward_coins_per_member INT DEFAULT 0,
    reward_xp_per_member INT DEFAULT 0,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_challenge_progress (
    id SERIAL PRIMARY KEY,
    challenge_id INT REFERENCES team_challenges(id) ON DELETE CASCADE,
    team_id INT REFERENCES teams(id) ON DELETE CASCADE,
    score INT DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP,
    UNIQUE(challenge_id, team_id)
);

-- Bonus redemptions (real-world rewards from shop)
CREATE TABLE IF NOT EXISTS bonus_redemptions (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    shop_item_id INT,
    coins_paid INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(100)
);

-- Referral system
CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_username VARCHAR(100) NOT NULL,
    referred_username VARCHAR(100),
    referral_code VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    reward_coins INT DEFAULT 500,
    referrer_rewarded BOOLEAN DEFAULT false,
    referred_rewarded BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    activated_at TIMESTAMP,
    UNIQUE(referral_code)
);

-- Add referral_code to user profiles
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_profiles_ext' AND column_name = 'referral_code'
    ) THEN
        ALTER TABLE user_profiles_ext ADD COLUMN referral_code VARCHAR(20) UNIQUE;
    END IF;
END $$;

-- Note: shop_items.category column already exists from migration 040

-- Seed: Level thresholds (ensure they exist)
INSERT INTO level_thresholds (level, xp_required, title) VALUES
    (1, 0, 'Новачок'),
    (2, 100, 'Учень'),
    (3, 300, 'Помічник'),
    (4, 600, 'Аніматор'),
    (5, 1000, 'Досвідчений'),
    (6, 1500, 'Майстер'),
    (7, 2500, 'Експерт'),
    (8, 4000, 'Наставник'),
    (9, 6000, 'Легенда'),
    (10, 10000, 'Зірка Парку')
ON CONFLICT DO NOTHING;

-- Seed: Spring 2026 seasonal quests
INSERT INTO seasonal_quests (code, title, description, icon, season, quest_type, target_value, reward_coins, reward_xp, reward_title, start_date, end_date) VALUES
    ('spring2026_bookings', 'Весняне пробудження', 'Створи 25 бронювань цієї весни', '🌸', 'spring', 'booking_count', 25, 500, 100, 'Весняний Герой', '2026-03-01', '2026-05-31'),
    ('spring2026_tasks', 'Квітковий рекорд', 'Виконай 30 задач за весну', '🌷', 'spring', 'task_count', 30, 400, 80, NULL, '2026-03-01', '2026-05-31'),
    ('spring2026_streak', 'Весняний марафон', 'Підтримуй streak 14 днів поспіль', '🏃', 'spring', 'streak', 14, 300, 60, NULL, '2026-03-01', '2026-05-31'),
    ('spring2026_login', 'Щоденна рутина', 'Залогінься 20 днів за весну', '📅', 'spring', 'login_days', 20, 200, 50, NULL, '2026-03-01', '2026-05-31')
ON CONFLICT (code) DO NOTHING;

-- Seed: Demo teams
INSERT INTO teams (name, icon, color) VALUES
    ('Дракони 🐉', '🐉', '#ef4444'),
    ('Феніксы 🔥', '🔥', '#f59e0b'),
    ('Єдинороги 🦄', '🦄', '#8b5cf6'),
    ('Тигри 🐯', '🐯', '#10b981')
ON CONFLICT DO NOTHING;

-- Seed: Demo team challenge
INSERT INTO team_challenges (title, description, icon, challenge_type, target_value, reward_coins_per_member, reward_xp_per_member, start_date, end_date) VALUES
    ('Весняний Кубок', 'Яка команда створить більше бронювань за березень?', '🏆', 'bookings', 50, 200, 50, '2026-03-01', '2026-03-31')
ON CONFLICT DO NOTHING;

-- Seed: Real bonus shop items (use only columns guaranteed to exist)
DO $$
BEGIN
    -- Check if icon column exists in shop_items
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shop_items' AND column_name = 'icon') THEN
        INSERT INTO shop_items (name, description, icon, price_coins, type, category, is_active) VALUES
            ('Додатковий вихідний', 'Один додатковий вихідний день на твій вибір', '🏖️', 5000, 'real', 'real', true),
            ('Обід за рахунок парку', 'Безкоштовний обід у кафе парку', '🍕', 1500, 'real', 'real', true),
            ('Сертифікат ATB 200₴', 'Подарунковий сертифікат на 200 гривень', '🎁', 3000, 'real', 'real', true),
            ('Вибір зміни на тиждень', 'Обирай свою зміну протягом тижня', '📋', 2000, 'real', 'real', true),
            ('Знижка 10% на ДН', 'Знижка на святкування дня народження в парку', '🎂', 500, 'coupon', 'coupon', true),
            ('Безкоштовний напій', 'Один напій у кафе парку безкоштовно', '☕', 300, 'coupon', 'coupon', true)
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO shop_items (name, description, price_coins, type, category, is_active) VALUES
            ('Додатковий вихідний', 'Один додатковий вихідний день на твій вибір', 5000, 'real', 'real', true),
            ('Обід за рахунок парку', 'Безкоштовний обід у кафе парку', 1500, 'real', 'real', true),
            ('Сертифікат ATB 200₴', 'Подарунковий сертифікат на 200 гривень', 3000, 'real', 'real', true),
            ('Вибір зміни на тиждень', 'Обирай свою зміну протягом тижня', 2000, 'real', 'real', true),
            ('Знижка 10% на ДН', 'Знижка на святкування дня народження в парку', 500, 'coupon', 'coupon', true),
            ('Безкоштовний напій', 'Один напій у кафе парку безкоштовно', 300, 'coupon', 'coupon', true)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- Seed: New achievements for gamification v3 (is_active defaults to true)
INSERT INTO achievement_catalog (key, name, description, icon, category, condition_type, condition_value, reward_type, reward_value, rarity) VALUES
    ('recruiter_5', 'Рекрутер', 'Приведи 5 друзів за реферальним кодом', '🤝', 'social', 'referral_count', 5, 'coins', 1000, 'rare'),
    ('recruiter_10', 'HR-Менеджер', 'Приведи 10 друзів за реферальним кодом', '👔', 'social', 'referral_count', 10, 'coins', 2500, 'epic'),
    ('team_winner', 'Переможець', 'Будь у команді-переможці челенджу', '🏆', 'team', 'manual', 1, 'coins', 500, 'rare'),
    ('season_master', 'Сезонний Майстер', 'Виконай всі квести сезону', '🌟', 'season', 'manual', 1, 'coins', 1500, 'legendary'),
    ('streak_60', 'Полум''яний', 'Підтримуй streak 60 днів', '🔥', 'streak', 'streak', 60, 'coins', 500, 'epic'),
    ('streak_100', 'Невгасимий', 'Підтримуй streak 100 днів', '💎', 'streak', 'streak', 100, 'coins', 1000, 'legendary'),
    ('top1_monthly', 'Чемпіон місяця', 'Посядь 1 місце в місячному рейтингу', '🥇', 'leaderboard', 'manual', 1, 'coins', 1000, 'epic'),
    ('shopaholic', 'Шопоголік', 'Купи 10 предметів у магазині', '🛍️', 'shop', 'manual', 10, 'coins', 300, 'uncommon')
ON CONFLICT (key) DO NOTHING;
