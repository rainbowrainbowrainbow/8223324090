-- v33.15.0: Sound module upgrade — delivery tracking, soft delete, TTS, zones
ALTER TABLE announcements
    ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS last_delivery_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS last_delivery_mode   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS last_delivery_detail TEXT,
    ADD COLUMN IF NOT EXISTS last_delivery_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS zone_id              VARCHAR(50),
    ADD COLUMN IF NOT EXISTS tts_generated        BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tts_generating       BOOLEAN DEFAULT FALSE;

ALTER TABLE music_log
    ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS delivery_mode   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS delivery_detail TEXT,
    ADD COLUMN IF NOT EXISTS triggered_by    VARCHAR(30) DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_announcements_active_cron
    ON announcements(repeat_cron)
    WHERE status = 'active' AND repeat_cron IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_deleted
    ON announcements(deleted_at) WHERE deleted_at IS NULL;
