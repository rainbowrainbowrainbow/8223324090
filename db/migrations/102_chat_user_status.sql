-- v33.7.0: Chat user status
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS chat_status       VARCHAR(100),
    ADD COLUMN IF NOT EXISTS chat_status_emoji  VARCHAR(10),
    ADD COLUMN IF NOT EXISTS chat_status_until  TIMESTAMP;
