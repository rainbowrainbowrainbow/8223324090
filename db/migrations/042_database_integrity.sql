-- 042_database_integrity.sql — FK constraints, missing indexes, schema fixes
-- v22.10.0

-- ============================================
-- 1. FOREIGN KEY CONSTRAINTS for gamification tables
-- ============================================
DO $$ BEGIN
    -- boss_rounds → users
    ALTER TABLE boss_rounds ADD CONSTRAINT fk_boss_rounds_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE game_streaks ADD CONSTRAINT fk_game_streaks_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE game_wallets ADD CONSTRAINT fk_game_wallets_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE quiz_sessions ADD CONSTRAINT fk_quiz_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE minigame_sessions ADD CONSTRAINT fk_minigame_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE user_rooms ADD CONSTRAINT fk_user_rooms_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE room_visits ADD CONSTRAINT fk_room_visits_room_user
        FOREIGN KEY (room_user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE room_visits ADD CONSTRAINT fk_room_visits_visitor
        FOREIGN KEY (visitor_user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE user_daily_quests ADD CONSTRAINT fk_user_daily_quests_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE user_daily_quests ADD CONSTRAINT fk_user_daily_quests_quest
        FOREIGN KEY (quest_id) REFERENCES daily_quests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'coin_transactions' AND column_name = 'user_id') THEN
        ALTER TABLE coin_transactions ADD CONSTRAINT fk_coin_transactions_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE quick_notes ADD CONSTRAINT fk_quick_notes_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE dashboard_configs ADD CONSTRAINT fk_dashboard_configs_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- 2. MISSING INDEXES on commonly queried columns
-- ============================================
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_id ON coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_type ON coin_transactions(type);
CREATE INDEX IF NOT EXISTS idx_user_daily_quests_user ON user_daily_quests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_daily_quests_date ON user_daily_quests(date);
CREATE INDEX IF NOT EXISTS idx_room_visits_visitor ON room_visits(visitor_user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_completed ON quiz_sessions(completed);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_username ON shop_purchases(username);

-- ============================================
-- 3. ACHIEVEMENTS TABLE (missing from prior migrations)
-- ============================================
CREATE TABLE IF NOT EXISTS achievements (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(10) DEFAULT '🏆',
    category VARCHAR(30) DEFAULT 'general',
    type VARCHAR(30) DEFAULT 'one_time',
    rarity VARCHAR(20) DEFAULT 'common',
    reward_coins INTEGER DEFAULT 0,
    condition JSONB DEFAULT '{}',
    is_secret BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_achievements_active ON achievements(is_active);
CREATE INDEX IF NOT EXISTS idx_achievements_category ON achievements(category);

-- Ensure user_achievements has needed columns
DO $$ BEGIN
    ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS achievement_id INTEGER;
    ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS user_id INTEGER;
    ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
    ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false;
    ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
    ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS times_completed INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Index on user_id + achievement_id (must be after columns are added above)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_achievements_user_achievement ON user_achievements(user_id, achievement_id);

-- ============================================
-- 4. SEED INITIAL ACHIEVEMENTS
-- ============================================
INSERT INTO achievements (code, name, description, icon, category, type, rarity, reward_coins, condition) VALUES
    ('first_login', 'Перший вхід', 'Увійти в систему вперше', '🎉', 'general', 'one_time', 'common', 10, '{"type":"login","count":1}'),
    ('streak_3', 'Тризуб', 'Досягти 3-денного стріку', '🔥', 'streaks', 'one_time', 'common', 15, '{"type":"streak","count":3}'),
    ('streak_7', 'Тижнева звичка', 'Досягти 7-денного стріку', '🌟', 'streaks', 'one_time', 'uncommon', 40, '{"type":"streak","count":7}'),
    ('streak_14', 'Двотижневий марафон', 'Досягти 14-денного стріку', '💎', 'streaks', 'one_time', 'rare', 100, '{"type":"streak","count":14}'),
    ('streak_30', 'Залізна воля', 'Досягти 30-денного стріку', '👑', 'streaks', 'one_time', 'legendary', 300, '{"type":"streak","count":30}'),
    ('quiz_perfect', 'Всезнайко', 'Відповісти правильно на всі питання вікторини', '🧠', 'quiz', 'repeatable', 'uncommon', 25, '{"type":"quiz_perfect","count":1}'),
    ('quiz_10', 'Ерудит', 'Зіграти 10 вікторин', '📚', 'quiz', 'one_time', 'common', 20, '{"type":"quiz_play","count":10}'),
    ('minigame_100', 'Ігроман', 'Набрати 100+ очок в міні-грі', '🎮', 'minigame', 'one_time', 'common', 15, '{"type":"minigame_score","count":100}'),
    ('minigame_300', 'Про-геймер', 'Набрати 300+ очок в міні-грі', '🕹️', 'minigame', 'one_time', 'rare', 50, '{"type":"minigame_score","count":300}'),
    ('boss_win', 'Переможець боса', 'Перемогти в бос-раунді', '⚔️', 'minigame', 'one_time', 'uncommon', 30, '{"type":"boss_win","count":1}'),
    ('coins_100', 'Перша сотня', 'Заробити 100 монет загалом', '💰', 'economy', 'one_time', 'common', 10, '{"type":"total_earned","count":100}'),
    ('coins_1000', 'Тисячник', 'Заробити 1000 монет загалом', '💰', 'economy', 'one_time', 'uncommon', 50, '{"type":"total_earned","count":1000}'),
    ('room_decorate', 'Дизайнер', 'Прикрасити свою кімнату', '🏠', 'room', 'one_time', 'common', 10, '{"type":"room_decorate","count":1}'),
    ('room_visitors_10', 'Популярна кімната', 'Отримати 10 відвідувачів', '👥', 'room', 'one_time', 'uncommon', 25, '{"type":"room_visitors","count":10}'),
    ('combo_5', 'Комбо-майстер', 'Зробити комбо x2.5 в міні-грі', '🔥', 'minigame', 'one_time', 'rare', 30, '{"type":"combo","count":5}')
ON CONFLICT (code) DO NOTHING;
