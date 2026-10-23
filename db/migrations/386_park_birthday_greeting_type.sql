-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotent, transactional conversion of only the two verified Park greeting templates and at most 40 matching future occurrences. Empty new Afisha databases are a no-op; strict identity checks abort on nonempty database drift; every changed ID is logged in history.
-- ROLLBACK: Use history action afisha_greeting_type_386 to restore type=event for the exact recorded template/event IDs, after stopping new generation; retain the additive slot table and revert the application release.
-- DATA_SCOPE: Park Afisha templates #6 (14:00) and #7 (18:00), plus at most 40 existing occurrences dated 2026-10-23 or later, with title Іменинники and duration 15 minutes.
-- OPERATOR_APPROVAL: EG-BIRTHDAY-TYPE-CONVERSION

DO $$
DECLARE
    valid_templates integer;
    invalid_events integer;
    pending_events integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM afisha_templates) AND NOT EXISTS (SELECT 1 FROM afisha) THEN
        RETURN;
    END IF;

    SELECT COUNT(*) INTO valid_templates
      FROM afisha_templates
     WHERE (id = 6 AND time = '14:00' OR id = 7 AND time = '18:00')
       AND title = 'Іменинники' AND duration = 15
       AND recurrence_pattern = 'daily' AND is_active = true
       AND type IN ('event', 'greeting');
    IF valid_templates <> 2 THEN
        RAISE EXCEPTION 'Park greeting templates #6/#7 differ from the approved inventory';
    END IF;

    SELECT COUNT(*) INTO invalid_events
      FROM afisha
     WHERE template_id IN (6, 7) AND date >= '2026-10-23'
       AND (title IS DISTINCT FROM 'Іменинники' OR duration IS DISTINCT FROM 15
            OR type IS NULL OR type NOT IN ('event', 'greeting')
            OR (template_id = 6 AND COALESCE(original_time, time) <> '14:00')
            OR (template_id = 7 AND COALESCE(original_time, time) <> '18:00'));
    IF invalid_events <> 0 THEN
        RAISE EXCEPTION 'Park greeting occurrences differ from the approved inventory';
    END IF;

    SELECT COUNT(*) INTO pending_events
      FROM afisha
     WHERE template_id IN (6, 7) AND date >= '2026-10-23' AND type = 'event';
    IF pending_events > 40 THEN
        RAISE EXCEPTION 'Park greeting conversion exceeds the approved 40-event limit: %', pending_events;
    END IF;
END $$;

WITH changed AS (
    UPDATE afisha_templates SET type = 'greeting'
     WHERE id IN (6, 7) AND type = 'event'
     RETURNING id
)
INSERT INTO history (business_context, action, username, data)
SELECT 'event_genix', 'afisha_greeting_type_386', 'migration-386',
       jsonb_build_object('business_context', 'event_genix', 'entity', 'template',
                          'id', id, 'old_type', 'event', 'new_type', 'greeting')
  FROM changed;

WITH changed AS (
    UPDATE afisha SET type = 'greeting'
     WHERE template_id IN (6, 7) AND date >= '2026-10-23' AND type = 'event'
     RETURNING id, date, template_id
)
INSERT INTO history (business_context, action, username, data)
SELECT 'event_genix', 'afisha_greeting_type_386', 'migration-386',
       jsonb_build_object('business_context', 'event_genix', 'entity', 'event',
                          'id', id, 'date', date, 'template_id', template_id,
                          'old_type', 'event', 'new_type', 'greeting')
  FROM changed;
