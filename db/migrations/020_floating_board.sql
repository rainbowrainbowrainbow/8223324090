-- Migration: 020_floating_board
-- Description: Quick notes for floating command panel
-- Date: 2026-02-26
-- Version: v20.2.0

CREATE TABLE IF NOT EXISTS quick_notes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    text VARCHAR(200) NOT NULL,
    is_shared BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_notes_user_id ON quick_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_quick_notes_shared ON quick_notes(is_shared);
