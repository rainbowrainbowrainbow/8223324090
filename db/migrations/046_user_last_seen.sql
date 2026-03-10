-- Add last_seen_at column to users table for presence tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient last_seen queries
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at) WHERE last_seen_at IS NOT NULL;
