-- 040_gamification_v2.sql — Gamification V2: Quiz, Multi-Streaks, Boss Rounds, Room
-- v22.10.0

-- ============================================
-- 0. ENSURE PREREQUISITE TABLES EXIST
-- ============================================
-- minigame_sessions (may not exist in fresh DBs)
CREATE TABLE IF NOT EXISTS minigame_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    coins_earned INTEGER NOT NULL DEFAULT 0,
    played_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_minigame_sessions_user ON minigame_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_minigame_sessions_date ON minigame_sessions(played_at);

-- game_wallets (may not exist in fresh DBs)
CREATE TABLE IF NOT EXISTS game_wallets (
    user_id INTEGER PRIMARY KEY,
    coins INTEGER NOT NULL DEFAULT 0,
    total_earned INTEGER NOT NULL DEFAULT 0,
    total_spent INTEGER NOT NULL DEFAULT 0,
    login_streak INTEGER DEFAULT 0,
    last_login_reward DATE,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- coin_transactions user_id column (migration already uses username, add user_id if missing)
ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS reference_id INTEGER;

-- daily_quests (may not exist)
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

-- user_daily_quests
CREATE TABLE IF NOT EXISTS user_daily_quests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    quest_id INTEGER NOT NULL,
    date DATE NOT NULL,
    progress INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    claimed BOOLEAN DEFAULT false,
    UNIQUE(user_id, quest_id, date)
);

-- ============================================
-- 1. QUIZ SYSTEM — Knowledge base questions
-- ============================================
CREATE TABLE IF NOT EXISTS quiz_questions (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    answers JSONB NOT NULL DEFAULT '[]',
    -- answers: [{text: "...", correct: true/false}, ...]
    correct_index INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(30) NOT NULL DEFAULT 'park',
    -- categories: park, programs, safety, fun, history
    difficulty VARCHAR(20) NOT NULL DEFAULT 'normal',
    -- difficulties: easy, normal, hard
    reward_coins INTEGER NOT NULL DEFAULT 10,
    explanation TEXT,
    -- shown after answering (educational)
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_category ON quiz_questions(category);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_active ON quiz_questions(is_active);

CREATE TABLE IF NOT EXISTS quiz_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    questions_count INTEGER NOT NULL DEFAULT 5,
    correct_count INTEGER NOT NULL DEFAULT 0,
    coins_earned INTEGER NOT NULL DEFAULT 0,
    answers JSONB DEFAULT '[]',
    -- [{question_id, answered_index, correct, time_ms}]
    completed BOOLEAN DEFAULT false,
    played_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_date ON quiz_sessions(played_at);

-- ============================================
-- 2. MULTI-TYPE STREAKS
-- ============================================
CREATE TABLE IF NOT EXISTS game_streaks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    streak_type VARCHAR(30) NOT NULL,
    -- types: minigame, task, booking, quiz, login
    current_count INTEGER NOT NULL DEFAULT 0,
    best_count INTEGER NOT NULL DEFAULT 0,
    last_date DATE,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, streak_type)
);
CREATE INDEX IF NOT EXISTS idx_game_streaks_user ON game_streaks(user_id);
CREATE INDEX IF NOT EXISTS idx_game_streaks_type ON game_streaks(streak_type);

-- ============================================
-- 3. BOSS ROUNDS (weekly special game mode)
-- ============================================
CREATE TABLE IF NOT EXISTS boss_rounds (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    week_start DATE NOT NULL,
    -- Monday of the week
    score INTEGER NOT NULL DEFAULT 0,
    target_score INTEGER NOT NULL DEFAULT 300,
    coins_earned INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    played_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_boss_rounds_user ON boss_rounds(user_id);
CREATE INDEX IF NOT EXISTS idx_boss_rounds_week ON boss_rounds(week_start);

-- ============================================
-- 4. ROOM ENHANCEMENTS
-- ============================================
-- Add category and equip_slot to shop_items if missing
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS category VARCHAR(30) DEFAULT 'cosmetic';
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS equip_slot VARCHAR(30);
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS rarity VARCHAR(20) DEFAULT 'common';
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS code VARCHAR(50);

-- User rooms table
CREATE TABLE IF NOT EXISTS user_rooms (
    user_id INTEGER PRIMARY KEY,
    wallpaper_item_id INTEGER,
    floor_item_id INTEGER,
    layout JSONB DEFAULT '{}',
    mood VARCHAR(20) DEFAULT 'happy',
    visitor_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Room visits tracking
CREATE TABLE IF NOT EXISTS room_visits (
    id SERIAL PRIMARY KEY,
    room_user_id INTEGER NOT NULL,
    visitor_user_id INTEGER NOT NULL,
    visited_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_room_visits_room ON room_visits(room_user_id);
CREATE INDEX IF NOT EXISTS idx_room_visits_date ON room_visits(visited_at);

-- ============================================
-- 5. SEED QUIZ QUESTIONS — Park Knowledge Base
-- ============================================
INSERT INTO quiz_questions (question, answers, correct_index, category, difficulty, reward_coins, explanation) VALUES
    ('Скільки анімаційних програм пропонує наш парк?',
     '[{"text":"3"},{"text":"5"},{"text":"8"},{"text":"12"}]',
     2, 'programs', 'normal', 10,
     'Наш парк пропонує 8 різних анімаційних програм для різних вікових категорій'),

    ('Яка мінімальна кількість дітей для бронювання групової програми?',
     '[{"text":"3"},{"text":"5"},{"text":"8"},{"text":"10"}]',
     2, 'programs', 'normal', 10,
     'Для групової програми потрібно мінімум 8 дітей'),

    ('Як називається наш талісман парку?',
     '[{"text":"Рекс"},{"text":"Діно"},{"text":"Трі"},{"text":"Стего"}]',
     1, 'park', 'easy', 8,
     'Наш талісман — дінозавр Діно!'),

    ('Скільки хвилин триває стандартна анімаційна програма?',
     '[{"text":"30 хв"},{"text":"45 хв"},{"text":"60 хв"},{"text":"90 хв"}]',
     2, 'programs', 'easy', 8,
     'Стандартна анімаційна програма триває 60 хвилин'),

    ('Що входить у VIP-пакет бронювання?',
     '[{"text":"Тільки аніматор"},{"text":"Аніматор + торт"},{"text":"Аніматор + декор + торт + фото"},{"text":"Тільки декор"}]',
     2, 'programs', 'hard', 15,
     'VIP-пакет включає аніматора, декор, торт та фотозйомку'),

    ('Яка максимальна місткість великого залу?',
     '[{"text":"15 дітей"},{"text":"25 дітей"},{"text":"35 дітей"},{"text":"50 дітей"}]',
     2, 'park', 'normal', 10,
     'Великий зал вміщує до 35 дітей'),

    ('О котрій годині відкривається парк у вихідні?',
     '[{"text":"8:00"},{"text":"9:00"},{"text":"10:00"},{"text":"11:00"}]',
     2, 'park', 'easy', 8,
     'У вихідні парк відкривається о 10:00'),

    ('Який формат номера бронювання використовується?',
     '[{"text":"#1234"},{"text":"BK-2024-0001"},{"text":"ORD-1234"},{"text":"B1234"}]',
     1, 'park', 'hard', 15,
     'Формат номера: BK-YYYY-NNNN (рік + порядковий номер)'),

    ('Скільки днів діє подарунковий сертифікат?',
     '[{"text":"14 днів"},{"text":"30 днів"},{"text":"45 днів"},{"text":"90 днів"}]',
     2, 'park', 'normal', 10,
     'Стандартний термін дії сертифіката — 45 днів'),

    ('Яке головне правило безпеки для дітей на атракціонах?',
     '[{"text":"Бігати якнайшвидше"},{"text":"Тримати дорослого за руку"},{"text":"Слухати інструкції аніматора"},{"text":"Знімати взуття"}]',
     2, 'safety', 'easy', 8,
     'Головне правило — завжди слухати інструкції аніматора!'),

    ('Що робити, якщо дитині стало погано під час програми?',
     '[{"text":"Продовжити гру"},{"text":"Зателефонувати батькам"},{"text":"Негайно повідомити аніматора та адміна"},{"text":"Дати воду і почекати"}]',
     2, 'safety', 'normal', 10,
     'При погіршенні самопочуття дитини потрібно негайно повідомити аніматора та адміністратора'),

    ('Скільки зон для гри є в парку?',
     '[{"text":"2"},{"text":"3"},{"text":"4"},{"text":"5"}]',
     2, 'park', 'normal', 10,
     'У парку є 4 зони для гри: активна, творча, сенсорна та тиха'),

    ('Яку валюту використовує система бронювання?',
     '[{"text":"USD"},{"text":"EUR"},{"text":"UAH"},{"text":"PLN"}]',
     2, 'park', 'easy', 8,
     'Система працює з українською гривнею (UAH, ₴)'),

    ('Хто може скасувати бронювання?',
     '[{"text":"Тільки клієнт"},{"text":"Тільки адмін"},{"text":"Адмін або менеджер"},{"text":"Будь-хто"}]',
     2, 'park', 'hard', 15,
     'Скасувати бронювання може адміністратор або менеджер'),

    ('Як часто оновлюється афіша парку?',
     '[{"text":"Щодня"},{"text":"Щотижня"},{"text":"Щомісяця"},{"text":"Щокварталу"}]',
     1, 'park', 'normal', 10,
     'Афіша оновлюється щотижня з новими програмами та акціями')
ON CONFLICT DO NOTHING;
