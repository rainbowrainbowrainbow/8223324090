-- 041_gin_indexes.sql — GIN indexes for JSONB columns
-- v22.10.0

-- User rooms layout (JSONB furniture positions)
CREATE INDEX IF NOT EXISTS idx_user_rooms_layout ON user_rooms USING GIN (layout);

-- Quiz questions answers (JSONB answer options)
CREATE INDEX IF NOT EXISTS idx_quiz_questions_answers ON quiz_questions USING GIN (answers);

-- Quiz sessions answers (JSONB answer history)
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_answers ON quiz_sessions USING GIN (answers);
