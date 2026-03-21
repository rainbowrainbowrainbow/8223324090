-- v33.7.0: Announce mode + important messages
ALTER TABLE chat_channels
    ADD COLUMN IF NOT EXISTS is_announce BOOLEAN DEFAULT false;

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS is_important BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chat_msgs_important
    ON chat_messages(channel_id, is_important)
    WHERE is_important = true;
