-- v33.9.0: Chat user preferences (wallpaper, sounds, mood, signature)
CREATE TABLE IF NOT EXISTS chat_user_preferences (
    user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    accent_color     VARCHAR(7),
    message_font     VARCHAR(30) DEFAULT 'default',
    chat_signature   VARCHAR(80),
    mood_emoji       VARCHAR(10),
    mood_date        DATE,
    notification_sound VARCHAR(30) DEFAULT 'default',
    channel_sounds   JSONB DEFAULT '{}',
    wallpaper        VARCHAR(50) DEFAULT 'default',
    updated_at       TIMESTAMP DEFAULT NOW()
);

-- Seed sticker pack for the park
INSERT INTO chat_sticker_packs (name, description, is_default)
VALUES ('Парк Закревського', 'Фірмові стікери парку', true)
ON CONFLICT DO NOTHING;
