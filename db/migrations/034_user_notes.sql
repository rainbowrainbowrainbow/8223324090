-- Migration 034: User notes (sticky notes)
CREATE TABLE IF NOT EXISTS user_notes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200),
    content TEXT,
    color VARCHAR(20) DEFAULT '#fef3c7',
    pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON user_notes(user_id);

-- Minigame sessions tracking (anti-farm)
CREATE TABLE IF NOT EXISTS minigame_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    game_type VARCHAR(50) DEFAULT 'match3',
    score INTEGER DEFAULT 0,
    coins_earned INTEGER DEFAULT 0,
    played_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_minigame_user ON minigame_sessions(user_id, played_at);
