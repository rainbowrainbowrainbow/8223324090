-- Lead Capture Integration v23.4.0
-- Auto-capture leads from Telegram, Facebook, Instagram, Viber, TikTok, Turbo, BnD

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS external_id    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS raw_payload    JSONB,
  ADD COLUMN IF NOT EXISTS source_channel VARCHAR(50);

-- Dedup: one external ID per source channel = one lead
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external_id
  ON leads(source_channel, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_source_channel ON leads(source_channel);

-- Backfill existing source → source_channel
UPDATE leads
  SET source_channel = source
  WHERE source IS NOT NULL AND source_channel IS NULL;
