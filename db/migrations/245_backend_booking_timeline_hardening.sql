-- MIGRATION_KIND: schema
-- SAFETY: Additive history scoping and index changes. Existing history rows keep the Event Genix default unless a known business context is recoverable from JSON data. No rows are deleted.
-- ROLLBACK: Drop the new indexes and history.business_context column if rollback is required; action widening can safely remain wider, or be narrowed only after checking for values longer than 20 characters.

ALTER TABLE history
    ALTER COLUMN action TYPE VARCHAR(64);

ALTER TABLE history
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE history
   SET business_context = CASE
        WHEN data->>'business_context' IN ('event_genix', 'dar', 'maysternya_doli', 'crm') THEN data->>'business_context'
        WHEN data->>'businessContext' IN ('event_genix', 'dar', 'maysternya_doli', 'crm') THEN data->>'businessContext'
        WHEN data->'timelineIdentity'->>'businessContext' IN ('event_genix', 'dar', 'maysternya_doli', 'crm') THEN data->'timelineIdentity'->>'businessContext'
        WHEN data->'timeline_identity'->>'business_context' IN ('event_genix', 'dar', 'maysternya_doli', 'crm') THEN data->'timeline_identity'->>'business_context'
        ELSE COALESCE(NULLIF(business_context, ''), 'event_genix')
    END
 WHERE business_context IS NULL
    OR business_context = ''
    OR (
        business_context = 'event_genix'
        AND (
            data ? 'business_context'
            OR data ? 'businessContext'
            OR data ? 'timelineIdentity'
            OR data ? 'timeline_identity'
        )
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'history_business_context_format_chk'
    ) THEN
        ALTER TABLE history
            ADD CONSTRAINT history_business_context_format_chk
            CHECK (business_context ~ '^[a-z][a-z0-9_]{1,63}$');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_history_business_created_at
    ON history (business_context, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_history_business_action
    ON history (business_context, action);

CREATE INDEX IF NOT EXISTS idx_bookings_context_date_line_status_v245
    ON bookings ((COALESCE(business_context, 'event_genix')), date, line_id, status);

CREATE INDEX IF NOT EXISTS idx_bookings_context_date_room_status_v245
    ON bookings ((COALESCE(business_context, 'event_genix')), date, room, status)
    WHERE room IS NOT NULL;
