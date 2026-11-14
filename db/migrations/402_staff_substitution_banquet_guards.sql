-- MIGRATION_KIND: schema
-- SAFETY: Adds active substitution guards for existing banquet relationships. No records are changed.
-- ROLLBACK: Retain these guards while banquet substitutions remain active.

CREATE OR REPLACE FUNCTION guard_banquet_substitution_membership_v397()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    booking_ids TEXT[];
BEGIN
    IF OLD.business_context IS DISTINCT FROM 'event_genix' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_TABLE_NAME = 'banquet_group_bookings' THEN
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.booking_id,NEW.group_id,NEW.business_context,NEW.role)
                IS NOT DISTINCT FROM (OLD.booking_id,OLD.group_id,OLD.business_context,OLD.role) THEN RETURN NEW; END IF;
        END IF;
        booking_ids := ARRAY[OLD.booking_id];
    ELSIF TG_TABLE_NAME = 'booking_banquet_links' THEN
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.booking_a_id,NEW.booking_b_id,NEW.business_context,NEW.relation_type)
                IS NOT DISTINCT FROM (OLD.booking_a_id,OLD.booking_b_id,OLD.business_context,OLD.relation_type) THEN RETURN NEW; END IF;
        END IF;
        booking_ids := ARRAY[OLD.booking_a_id,OLD.booking_b_id];
    ELSE
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.id,NEW.business_context,NEW.primary_booking_id,NEW.status,NEW.date,NEW.room,NEW.room_resource_id)
                IS NOT DISTINCT FROM (OLD.id,OLD.business_context,OLD.primary_booking_id,OLD.status,OLD.date,OLD.room,OLD.room_resource_id) THEN RETURN NEW; END IF;
        END IF;
        booking_ids := ARRAY(SELECT booking_id::text FROM banquet_group_bookings
            WHERE group_id=OLD.id AND business_context=OLD.business_context);
    END IF;

    booking_ids := ARRAY(SELECT DISTINCT root_id FROM (
        SELECT unnest(booking_ids) AS root_id
        UNION ALL SELECT linked_to FROM bookings WHERE id=ANY(booking_ids)
            AND COALESCE(business_context,'event_genix')='event_genix' AND NULLIF(linked_to,'') IS NOT NULL
    ) roots ORDER BY root_id);
    PERFORM 1 FROM bookings WHERE id=ANY(booking_ids) ORDER BY id FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix'
        AND source_type='booking' AND state='active' AND source_id=ANY(booking_ids)) THEN
        RAISE EXCEPTION 'Booking has an agreed substitution; use its audited workflow'
            USING ERRCODE='23514', CONSTRAINT='booking_substitution_active_guard';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='banquet_substitution_membership_guard_v397' AND tgrelid='banquet_group_bookings'::regclass) THEN
        CREATE TRIGGER banquet_substitution_membership_guard_v397
            BEFORE DELETE OR UPDATE OF booking_id,group_id,business_context,role ON banquet_group_bookings
            FOR EACH ROW EXECUTE FUNCTION guard_banquet_substitution_membership_v397();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='banquet_substitution_link_guard_v397' AND tgrelid='booking_banquet_links'::regclass) THEN
        CREATE TRIGGER banquet_substitution_link_guard_v397
            BEFORE DELETE OR UPDATE OF booking_a_id,booking_b_id,business_context,relation_type ON booking_banquet_links
            FOR EACH ROW EXECUTE FUNCTION guard_banquet_substitution_membership_v397();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='banquet_substitution_group_guard_v397' AND tgrelid='banquet_groups'::regclass) THEN
        CREATE TRIGGER banquet_substitution_group_guard_v397
            BEFORE DELETE OR UPDATE OF id,business_context,primary_booking_id,status,date,room,room_resource_id ON banquet_groups
            FOR EACH ROW EXECUTE FUNCTION guard_banquet_substitution_membership_v397();
    END IF;
END;
$migration$;
