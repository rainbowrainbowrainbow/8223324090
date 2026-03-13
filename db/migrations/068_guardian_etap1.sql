-- Migration 068: Guardian Etap 1 — Whitelist + Edit + Toggle + Emergency Stop
-- Date: 2026-03-13

-- 1. Guardian whitelist table (dynamic phrases that are never toxic)
CREATE TABLE IF NOT EXISTS guardian_whitelist (
  id SERIAL PRIMARY KEY,
  phrase TEXT NOT NULL UNIQUE,
  added_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Columns for censor-edit (edit instead of delete for mild profanity)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS edited_by_guardian BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS guardian_edit_reason TEXT;

-- 3. Per-channel Guardian toggle
ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS guardian_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS contour2_enabled BOOLEAN DEFAULT TRUE;

-- Index for fast whitelist lookups
CREATE INDEX IF NOT EXISTS idx_guardian_whitelist_phrase ON guardian_whitelist (phrase);
