-- MIGRATION_KIND: schema
-- SAFETY: Adds booking assignment guards and a task alias guard without updating existing rows.
-- ROLLBACK: Keep the guards for agreed bookings until their substitutions have been resolved.

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_substitution_booking_slot_v394
    ON staff_substitutions(business_context,source_id,slot_key)
    WHERE source_type='booking' AND state<>'cancelled';

CREATE OR REPLACE FUNCTION guard_staff_substitution_booking_v394()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    old_id TEXT;
    old_parent TEXT;
    new_parent TEXT;
    root_id TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.date, NEW.time, NEW.duration, NEW.line_id, NEW.linked_to, NEW.room, NEW.room_resource_id,
            NEW.program_id, NEW.program_code, NEW.second_animator, NEW.hosts, NEW.business_context,
            NEW.extra_data->'timelineIdentity', NEW.extra_data->'timeline_identity',
            NEW.extra_data->'bookingWorkspace'->'secondAnimatorLineId',
            NEW.extra_data->'educationLesson', NEW.extra_data->'education_lesson', NEW.extra_data->'bookingWorkspace'->'lesson')
           IS NOT DISTINCT FROM
           (OLD.id, OLD.date, OLD.time, OLD.duration, OLD.line_id, OLD.linked_to, OLD.room, OLD.room_resource_id,
            OLD.program_id, OLD.program_code, OLD.second_animator, OLD.hosts, OLD.business_context,
            OLD.extra_data->'timelineIdentity', OLD.extra_data->'timeline_identity',
            OLD.extra_data->'bookingWorkspace'->'secondAnimatorLineId',
            OLD.extra_data->'educationLesson', OLD.extra_data->'education_lesson', OLD.extra_data->'bookingWorkspace'->'lesson')
           AND LOWER(COALESCE(NEW.status,'')) <> 'cancelled' THEN
            RETURN NEW;
        END IF;
    END IF;

    IF TG_OP <> 'INSERT' THEN
        old_id := OLD.id;
        old_parent := OLD.linked_to;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_parent := NEW.linked_to;
    END IF;
    IF new_parent IS NOT NULL AND new_parent IS DISTINCT FROM old_parent THEN
        PERFORM 1 FROM bookings WHERE id=new_parent FOR NO KEY UPDATE;
    END IF;

    FOR root_id IN SELECT DISTINCT source_id FROM staff_substitutions
        WHERE business_context='event_genix' AND source_type='booking' AND state='active'
          AND source_id IN (old_id, old_parent, new_parent)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM staff_substitutions command
            WHERE command.id::text=current_setting('eventgenix.substitution_command',true)
              AND command.business_context='event_genix' AND command.source_type='booking'
              AND command.source_id=root_id AND command.state='active') THEN
            RAISE EXCEPTION 'Booking has an agreed substitution; use its audited workflow'
                USING ERRCODE='23514', CONSTRAINT='booking_substitution_active_guard';
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_staff_substitution_booking_membership_v394()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    booking_ids TEXT[];
BEGIN
    IF TG_TABLE_NAME = 'banquet_group_bookings' THEN
        booking_ids := ARRAY[NEW.booking_id::text];
    ELSE
        booking_ids := ARRAY[NEW.booking_a_id::text, NEW.booking_b_id::text];
    END IF;
    SELECT ARRAY(SELECT DISTINCT root_id FROM (
        SELECT unnest(booking_ids) AS root_id
        UNION ALL SELECT linked_to FROM bookings WHERE id=ANY(booking_ids) AND linked_to IS NOT NULL
    ) roots ORDER BY root_id) INTO booking_ids;
    PERFORM 1 FROM bookings WHERE id=ANY(booking_ids) ORDER BY id FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM staff_substitutions
        WHERE business_context='event_genix' AND source_type='booking' AND state='active'
          AND source_id=ANY(booking_ids)) THEN
        RAISE EXCEPTION 'Booking has an agreed substitution; use its audited workflow'
            USING ERRCODE='23514', CONSTRAINT='booking_substitution_active_guard';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_staff_substitution_booking_task_v394()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_TABLE_NAME = 'staff_substitutions' THEN
        IF NEW.source_type <> 'task' THEN RETURN NEW; END IF;
        PERFORM 1 FROM tasks WHERE id::text=NEW.source_id FOR NO KEY UPDATE;
        IF NOT EXISTS (SELECT 1 FROM tasks WHERE id::text=NEW.source_id
             AND (source_type='booking' OR source_entity_type='booking')) THEN RETURN NEW; END IF;
    ELSE
        IF (NEW.source_type,NEW.source_id,NEW.source_entity_type,NEW.source_entity_id)
           IS NOT DISTINCT FROM (OLD.source_type,OLD.source_id,OLD.source_entity_type,OLD.source_entity_id)
           OR (NEW.source_type IS DISTINCT FROM 'booking' AND NEW.source_entity_type IS DISTINCT FROM 'booking')
           OR NOT EXISTS (SELECT 1 FROM staff_substitutions WHERE source_type='task' AND source_id=NEW.id::text
               AND state<>'cancelled') THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'Booking work has one agreed substitution source'
        USING ERRCODE='23514', CONSTRAINT='booking_substitution_task_alias_guard';
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='booking_substitution_guard_v394' AND tgrelid='bookings'::regclass) THEN
        CREATE TRIGGER booking_substitution_guard_v394 BEFORE INSERT OR UPDATE OR DELETE ON bookings
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_booking_v394();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='staff_substitution_booking_task_guard_v394' AND tgrelid='staff_substitutions'::regclass) THEN
        CREATE TRIGGER staff_substitution_booking_task_guard_v394 BEFORE INSERT ON staff_substitutions
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_booking_task_v394();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='task_substitution_booking_alias_guard_v394' AND tgrelid='tasks'::regclass) THEN
        CREATE TRIGGER task_substitution_booking_alias_guard_v394 BEFORE UPDATE OF source_type,source_id,source_entity_type,source_entity_id ON tasks
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_booking_task_v394();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='banquet_member_booking_substitution_guard_v394' AND tgrelid='banquet_group_bookings'::regclass) THEN
        CREATE TRIGGER banquet_member_booking_substitution_guard_v394 BEFORE INSERT OR UPDATE OF booking_id,group_id ON banquet_group_bookings
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_booking_membership_v394();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='banquet_link_booking_substitution_guard_v394' AND tgrelid='booking_banquet_links'::regclass) THEN
        CREATE TRIGGER banquet_link_booking_substitution_guard_v394 BEFORE INSERT OR UPDATE OF booking_a_id,booking_b_id ON booking_banquet_links
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_booking_membership_v394();
    END IF;
END;
$migration$;
