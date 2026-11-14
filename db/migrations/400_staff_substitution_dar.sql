-- MIGRATION_KIND: schema
-- SAFETY: Adds DAR teacher terms, occurrence uniqueness, and a booking guard without updating existing rows.
-- ROLLBACK: Revert application callers and retain audit evidence. Keep the guard until active DAR substitutions are resolved.

CREATE TABLE IF NOT EXISTS dar_teacher_substitution_rates (
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    pay_unit TEXT NOT NULL CHECK (pay_unit IN ('hour','fixed')),
    effective_from DATE NOT NULL,
    rate_minor INTEGER NOT NULL CHECK (rate_minor > 0),
    reason TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (staff_id,pay_unit,effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_substitution_dar_lesson_v395
    ON staff_substitutions(source_id) WHERE business_context='dar' AND source_type='education_lesson' AND state <> 'cancelled';

CREATE OR REPLACE FUNCTION guard_staff_substitution_dar_lesson_v395()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF OLD.business_context='dar' THEN
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.id,NEW.business_context,NEW.linked_to,NEW.date,NEW.time,NEW.duration,NEW.extra_data->>'education_series_id',
                NEW.extra_data->'educationLesson',NEW.extra_data->'education_lesson',NEW.extra_data->'bookingWorkspace'->'lesson')
                IS NOT DISTINCT FROM
               (OLD.id,OLD.business_context,OLD.linked_to,OLD.date,OLD.time,OLD.duration,OLD.extra_data->>'education_series_id',
                OLD.extra_data->'educationLesson',OLD.extra_data->'education_lesson',OLD.extra_data->'bookingWorkspace'->'lesson')
               AND LOWER(BTRIM(COALESCE(NEW.status,''))) <> 'cancelled' THEN
                RETURN NEW;
            END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='dar' AND source_type='education_lesson'
            AND source_id=OLD.id AND state='active'
            AND id::text IS DISTINCT FROM current_setting('eventgenix.substitution_command',true)) THEN
            RAISE EXCEPTION 'Lesson has an agreed substitution; use its audited workflow'
                USING ERRCODE='23514', CONSTRAINT='booking_substitution_active_guard';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='booking_substitution_dar_guard_v395' AND tgrelid='bookings'::regclass) THEN
        CREATE TRIGGER booking_substitution_dar_guard_v395 BEFORE UPDATE OR DELETE ON bookings
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_dar_lesson_v395();
    END IF;
END;
$migration$;
