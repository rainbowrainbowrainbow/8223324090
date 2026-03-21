-- v32.7: Add hashtags support to reports
ALTER TABLE reports ADD COLUMN IF NOT EXISTS hashtags TEXT DEFAULT '[]';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS hashtag_active BOOLEAN DEFAULT true;
