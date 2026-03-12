-- 061_task_review.sql — Task review/scoring system
-- v25.4.0

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_score INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_comment TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_by INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
