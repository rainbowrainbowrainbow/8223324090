-- MIGRATION_KIND: mixed
-- SAFETY: Additive table for per-lead event preference data plus idempotent backfill from existing leads.event_date, leads.children_count, and controlled guest-note rows. Existing leads rows and notes are not modified.
-- ROLLBACK: Export lead_event_preferences if needed, then DROP TRIGGER IF EXISTS trg_lead_event_preferences_updated_at ON lead_event_preferences; DROP INDEX IF EXISTS idx_lead_event_preferences_unique_lead, idx_lead_event_preferences_lead, idx_lead_event_preferences_business_context, idx_lead_event_preferences_preferred_date; DROP TABLE IF EXISTS lead_event_preferences.
-- DATA_SCOPE: Existing leads rows with event_date, children_count, or notes beginning with the controlled lead guest summary prefix only; no destructive data changes.

CREATE TABLE IF NOT EXISTS lead_event_preferences (
    id                BIGSERIAL PRIMARY KEY,
    lead_id           INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    business_context  VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    preferred_date    DATE,
    children_count    INTEGER NOT NULL DEFAULT 0,
    adults_count      INTEGER NOT NULL DEFAULT 0,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT lead_event_preferences_children_count_check
        CHECK (children_count >= 0),
    CONSTRAINT lead_event_preferences_adults_count_check
        CHECK (adults_count >= 0),
    CONSTRAINT lead_event_preferences_has_data_check
        CHECK (
            preferred_date IS NOT NULL
            OR children_count > 0
            OR adults_count > 0
            OR NULLIF(BTRIM(COALESCE(notes, '')), '') IS NOT NULL
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_event_preferences_unique_lead
    ON lead_event_preferences (business_context, lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_event_preferences_lead
    ON lead_event_preferences (lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_event_preferences_business_context
    ON lead_event_preferences (business_context);

CREATE INDEX IF NOT EXISTS idx_lead_event_preferences_preferred_date
    ON lead_event_preferences (business_context, preferred_date)
    WHERE preferred_date IS NOT NULL;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_lead_event_preferences_updated_at'
          AND tgrelid = 'lead_event_preferences'::regclass
    ) THEN
        CREATE TRIGGER trg_lead_event_preferences_updated_at
            BEFORE UPDATE ON lead_event_preferences
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

WITH legacy_guest_rows AS (
    SELECT
        l.id AS lead_id,
        COALESCE(l.business_context, 'event_genix') AS business_context,
        l.event_date AS preferred_date,
        GREATEST(COALESCE(l.children_count, 0), 0)::INTEGER AS children_count,
        regexp_match(
            COALESCE(l.notes, ''),
            U&'!0434!043E!0440!043E!0441!043B!0438!0445\s*[-:]\s*([0-9]+)' UESCAPE '!',
            'i'
        ) AS adults_match
    FROM leads l
    WHERE l.event_date IS NOT NULL
       OR l.children_count IS NOT NULL
       OR COALESCE(l.notes, '') ILIKE U&'%!0413!043E!0441!0442!0456 !043D!0430 !0431!0430!0436!0430!043D!0443 !0434!0430!0442!0443:%' UESCAPE '!'
),
legacy_guest_preferences AS (
    SELECT
        lead_id,
        business_context,
        preferred_date,
        children_count,
        CASE
            WHEN adults_match IS NOT NULL THEN GREATEST(((adults_match)[1])::INTEGER, 0)
            ELSE 0
        END AS adults_count
    FROM legacy_guest_rows
)
INSERT INTO lead_event_preferences (
    lead_id,
    business_context,
    preferred_date,
    children_count,
    adults_count,
    notes
)
SELECT
    lead_id,
    business_context,
    preferred_date,
    children_count,
    adults_count,
    NULL
FROM legacy_guest_preferences
WHERE preferred_date IS NOT NULL
   OR children_count > 0
   OR adults_count > 0
ON CONFLICT (business_context, lead_id) DO UPDATE
SET preferred_date = COALESCE(EXCLUDED.preferred_date, lead_event_preferences.preferred_date),
    children_count = GREATEST(EXCLUDED.children_count, lead_event_preferences.children_count),
    adults_count = GREATEST(EXCLUDED.adults_count, lead_event_preferences.adults_count),
    updated_at = NOW();
