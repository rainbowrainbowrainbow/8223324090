-- 054_training_knowledge_base.sql
-- Knowledge base, tests, badges for training page redesign (v25.0.0)

-- Knowledge base articles (structured training content)
CREATE TABLE IF NOT EXISTS knowledge_base (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    summary VARCHAR(500),
    category VARCHAR(100) DEFAULT 'Загальне',
    role VARCHAR(50) NOT NULL DEFAULT 'all', -- animator, admin, manager, all
    difficulty VARCHAR(20) DEFAULT 'beginner', -- beginner, intermediate, advanced
    read_time_minutes INTEGER DEFAULT 5,
    icon VARCHAR(10) DEFAULT '📄',
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_role ON knowledge_base(role);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_active ON knowledge_base(is_active);

-- Track who read what
CREATE TABLE IF NOT EXISTS knowledge_base_progress (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(staff_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_progress_staff ON knowledge_base_progress(staff_id);

-- Tests linked to knowledge base articles
CREATE TABLE IF NOT EXISTS training_tests (
    id SERIAL PRIMARY KEY,
    article_id INTEGER REFERENCES knowledge_base(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    questions JSONB NOT NULL DEFAULT '[]',
    -- questions format: [{question, options: [a,b,c,d], correct: 0, explanation}]
    passing_score INTEGER DEFAULT 70, -- percentage
    time_limit_seconds INTEGER DEFAULT 300,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_tests_article ON training_tests(article_id);

-- Test results
CREATE TABLE IF NOT EXISTS training_test_results (
    id SERIAL PRIMARY KEY,
    test_id INTEGER NOT NULL REFERENCES training_tests(id) ON DELETE CASCADE,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    score INTEGER NOT NULL, -- percentage 0-100
    answers JSONB DEFAULT '[]',
    time_spent_seconds INTEGER,
    passed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_results_staff ON training_test_results(staff_id);
CREATE INDEX IF NOT EXISTS idx_test_results_test ON training_test_results(test_id);

-- Badges / achievements for training
CREATE TABLE IF NOT EXISTS training_badges (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    badge_type VARCHAR(50) NOT NULL,
    -- types: first_read, speed_reader, quiz_master, perfect_score, streak_3, streak_7, all_materials
    badge_name VARCHAR(100) NOT NULL,
    badge_icon VARCHAR(10) DEFAULT '🏆',
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(staff_id, badge_type)
);

CREATE INDEX IF NOT EXISTS idx_training_badges_staff ON training_badges(staff_id);
