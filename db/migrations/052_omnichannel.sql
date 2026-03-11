-- 052_omnichannel.sql — OmniClaw: Omnichannel communication tables
-- Channels: telegram, viber, sms, facebook, instagram, binotel

-- Conversations table — one per customer per channel
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('telegram','viber','sms','facebook','instagram','binotel')),
    external_id VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    customer_id INTEGER REFERENCES customers(id),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','closed','pending','spam')),
    assigned_to VARCHAR(100),
    last_message_at TIMESTAMP,
    unread_count INTEGER DEFAULT 0,
    meta JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_channel_ext ON conversations(channel, external_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC);

-- Messages table — all inbound/outbound messages
CREATE TABLE IF NOT EXISTS conversation_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
    sender_name VARCHAR(255),
    content TEXT,
    content_type VARCHAR(20) DEFAULT 'text' CHECK (content_type IN ('text','image','file','audio','video','location','contact','sticker')),
    media_url TEXT,
    external_message_id VARCHAR(255),
    ai_generated BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    meta JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_messages_direction ON conversation_messages(direction);

-- Quick replies — pre-configured response templates
CREATE TABLE IF NOT EXISTS quick_replies (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL UNIQUE,
    content TEXT NOT NULL,
    category VARCHAR(50) DEFAULT 'general',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Auto-update updated_at on conversations
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversation_updated ON conversations;
CREATE TRIGGER trg_conversation_updated
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_timestamp();

-- Default quick replies
INSERT INTO quick_replies (title, content, category, sort_order) VALUES
    ('Вітання', 'Доброго дня! Дякуємо за звернення до Парку Закревського Періоду. Чим можемо допомогти?', 'general', 1),
    ('Графік роботи', 'Ми працюємо щодня з 10:00 до 20:00. Чекаємо на вас!', 'info', 2),
    ('Бронювання', 'Для бронювання свята потрібно: дата, час, кількість дітей та вік. Підкажіть ці деталі?', 'booking', 3),
    ('Ціни', 'Ціни залежать від програми та кількості дітей. Зараз підберемо найкращий варіант для вас!', 'pricing', 4),
    ('Дякуємо', 'Дякуємо за звернення! Якщо будуть питання — пишіть, завжди раді допомогти! 🎉', 'closing', 5)
ON CONFLICT (title) DO NOTHING;
