-- 035_user_avatars.sql — User emoji avatars and avatar colors
-- Allows users to set custom emoji as their chat avatar

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_emoji VARCHAR(10) DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT NULL;

-- Guardian toxic keywords dynamic list (for LLM learning)
CREATE TABLE IF NOT EXISTS guardian_toxic_words (
    id SERIAL PRIMARY KEY,
    word VARCHAR(100) NOT NULL UNIQUE,
    added_by VARCHAR(50) DEFAULT 'system',
    source VARCHAR(30) DEFAULT 'manual',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_toxic_words_word ON guardian_toxic_words (word);
