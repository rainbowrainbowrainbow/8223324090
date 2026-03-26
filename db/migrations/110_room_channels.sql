-- v33.9.0: Room channels — link chat channels to rooms/lines
ALTER TABLE chat_channels
    ADD COLUMN IF NOT EXISTS line_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_chat_channels_line ON chat_channels(line_id)
    WHERE line_id IS NOT NULL;
