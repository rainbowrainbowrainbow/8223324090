-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable metadata columns for durable sound storage; existing sound rows and playback URLs are unchanged.
-- ROLLBACK: Drop the added storage_* columns and idx_sounds_storage_provider if the pilot is reverted.

ALTER TABLE sounds ADD COLUMN IF NOT EXISTS storage_provider TEXT;
ALTER TABLE sounds ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
ALTER TABLE sounds ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE sounds ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE sounds ADD COLUMN IF NOT EXISTS storage_migrated_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sounds_storage_provider_check'
          AND conrelid = 'sounds'::regclass
    ) THEN
        ALTER TABLE sounds ADD CONSTRAINT sounds_storage_provider_check
            CHECK (storage_provider IS NULL OR storage_provider IN ('local', 'supabase', 'external'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sounds_storage_provider ON sounds(storage_provider);
