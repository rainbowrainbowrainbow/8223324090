-- MIGRATION_KIND: schema
-- SAFETY: Adds Telegram-origin warehouse photo intake queue tables and indexes. Existing warehouse stock/history data is not modified.
-- ROLLBACK: DROP TABLE IF EXISTS warehouse_photo_intake_photos; DROP TABLE IF EXISTS warehouse_photo_intakes;

CREATE TABLE IF NOT EXISTS warehouse_photo_intakes (
    id SERIAL PRIMARY KEY,
    source VARCHAR(24) NOT NULL DEFAULT 'telegram',
    telegram_chat_id TEXT,
    telegram_user_id TEXT,
    telegram_username TEXT,
    telegram_message_id TEXT,
    telegram_media_group_id TEXT,
    telegram_thread_id TEXT,
    dedupe_key TEXT NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'needs_review',
    draft JSONB NOT NULL DEFAULT '{}'::jsonb,
    match_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence NUMERIC(5,4) DEFAULT 0,
    vision_provider VARCHAR(40),
    vision_model VARCHAR(120),
    failure_reason TEXT,
    operator_notes TEXT,
    confirmed_stock_id INTEGER REFERENCES warehouse_stock(id) ON DELETE SET NULL,
    confirmed_history_id INTEGER REFERENCES warehouse_history(id) ON DELETE SET NULL,
    confirmed_movement_id INTEGER REFERENCES warehouse_stock_movements(id) ON DELETE SET NULL,
    confirmed_by TEXT,
    confirmed_at TIMESTAMP,
    cancelled_by TEXT,
    cancelled_at TIMESTAMP,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_photo_intake_photos (
    id SERIAL PRIMARY KEY,
    intake_id INTEGER NOT NULL REFERENCES warehouse_photo_intakes(id) ON DELETE CASCADE,
    telegram_file_id TEXT NOT NULL,
    telegram_file_unique_id TEXT,
    telegram_file_size INTEGER,
    width INTEGER,
    height INTEGER,
    mime_type TEXT,
    telegram_file_path TEXT,
    public_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (intake_id, telegram_file_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_photo_intakes_status_created
    ON warehouse_photo_intakes(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_photo_intakes_confirmed_stock
    ON warehouse_photo_intakes(confirmed_stock_id)
    WHERE confirmed_stock_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_photo_intake_photos_intake
    ON warehouse_photo_intake_photos(intake_id);
