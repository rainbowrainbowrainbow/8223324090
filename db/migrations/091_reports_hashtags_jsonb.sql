-- v32.7.1: Convert hashtags from TEXT to JSONB for proper containment queries
ALTER TABLE reports ALTER COLUMN hashtags DROP DEFAULT;
ALTER TABLE reports ALTER COLUMN hashtags TYPE JSONB USING hashtags::jsonb;
ALTER TABLE reports ALTER COLUMN hashtags SET DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_reports_hashtags ON reports USING GIN (hashtags);
