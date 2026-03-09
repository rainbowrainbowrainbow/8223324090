-- Migration 032: Direct messages support + channel member add by admin
-- Adds is_dm flag and dm_user_ids to chat_channels for private conversations

ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS is_dm BOOLEAN DEFAULT false;
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS dm_user_ids INTEGER[] DEFAULT NULL;
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_channels_dm ON chat_channels(is_dm) WHERE is_dm = true;
