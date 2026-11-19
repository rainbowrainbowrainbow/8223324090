-- MIGRATION_KIND: schema
-- OPERATOR_APPROVAL: required
-- SAFETY: Adds cancellation history fields and write guards. Existing schedule and financial records are left as stored.
-- ROLLBACK: Retain the cancellation fields, detached segment rows and guards. Restore with a compatible release that understands cancellation history.

ALTER TABLE hr_shift_segments
    ALTER COLUMN hr_shift_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS cancelled_shift_id INTEGER,
    ADD COLUMN IF NOT EXISTS cancelled_staff_id INTEGER,
    ADD COLUMN IF NOT EXISTS cancelled_shift_date DATE,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'hr_shift_segments'::regclass AND conname = 'hr_shift_segment_cancellation_shape'
    ) THEN
        ALTER TABLE hr_shift_segments ADD CONSTRAINT hr_shift_segment_cancellation_shape CHECK (
            (hr_shift_id IS NOT NULL AND cancelled_shift_id IS NULL AND cancelled_staff_id IS NULL
                AND cancelled_shift_date IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL)
            OR
            (hr_shift_id IS NULL AND work_mode = 'freelance' AND cancelled_shift_id IS NOT NULL
                AND cancelled_staff_id IS NOT NULL AND cancelled_shift_date IS NOT NULL
                AND cancelled_at IS NOT NULL AND NULLIF(btrim(cancelled_by), '') IS NOT NULL)
        );
    END IF;
END;
$migration$;

-- Cancelled rows retain the original segment ID so immutable terms stay linked.
CREATE OR REPLACE FUNCTION guard_hr_freelance_confirmed_segment_v393()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    original_staff_id INTEGER;
    original_shift_date DATE;
BEGIN
    IF OLD.hr_shift_id IS NULL THEN
        RAISE EXCEPTION 'Cancelled freelance history cannot be rewritten'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_cancelled_segment_immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    IF NEW.hr_shift_id IS NULL AND EXISTS (
        SELECT 1 FROM hr_freelance_attendance_confirmations WHERE hr_shift_id = OLD.hr_shift_id
    ) THEN
        RAISE EXCEPTION 'Confirmed freelance work cannot be cancelled'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_cancellation_confirmed';
    END IF;

    IF EXISTS (SELECT 1 FROM hr_freelance_confirmed_blocks WHERE segment_id = OLD.id)
        AND ROW(OLD.hr_shift_id, OLD.work_mode, OLD.profession_key,
                OLD.planned_start, OLD.planned_end, OLD.break_minutes)
            IS DISTINCT FROM
            ROW(NEW.hr_shift_id, NEW.work_mode, NEW.profession_key,
                NEW.planned_start, NEW.planned_end, NEW.break_minutes)
    THEN
        RAISE EXCEPTION 'Confirmed freelance shift blocks cannot be rewritten'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_confirmed_segment_immutable';
    END IF;

    IF NEW.hr_shift_id IS NULL THEN
        SELECT staff_id, shift_date INTO STRICT original_staff_id, original_shift_date
        FROM hr_shifts WHERE id = OLD.hr_shift_id FOR UPDATE;

        IF OLD.work_mode <> 'freelance'
            OR ROW(NEW.cancelled_shift_id, NEW.cancelled_staff_id, NEW.cancelled_shift_date)
                IS DISTINCT FROM ROW(OLD.hr_shift_id, original_staff_id, original_shift_date)
            OR ROW(NEW.id, NEW.work_mode, NEW.profession_key, NEW.planned_start, NEW.planned_end,
                   NEW.start_day_offset, NEW.end_day_offset, NEW.break_minutes, NEW.notes, NEW.sort_order)
                IS DISTINCT FROM
               ROW(OLD.id, OLD.work_mode, OLD.profession_key, OLD.planned_start, OLD.planned_end,
                   OLD.start_day_offset, OLD.end_day_offset, OLD.break_minutes, OLD.notes, OLD.sort_order)
        THEN
            RAISE EXCEPTION 'Freelance cancellation must retain the original segment'
                USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_cancellation_identity';
        END IF;

        IF original_shift_date + OLD.planned_start + COALESCE(OLD.start_day_offset, 0) * INTERVAL '1 day'
                <= (clock_timestamp() AT TIME ZONE 'Europe/Kyiv')
            OR EXISTS (
                SELECT 1 FROM hr_time_records
                WHERE staff_id = original_staff_id AND record_date = original_shift_date
                  AND business_context = 'event_genix' AND clock_in IS NOT NULL
                  AND status IS DISTINCT FROM 'arrival_cancelled'
            )
        THEN
            RAISE EXCEPTION 'A started or past freelance block cannot be cancelled'
                USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_cancellation_after_start';
        END IF;
        RETURN NEW;
    END IF;

    IF ROW(OLD.profession_key, OLD.hr_shift_id, OLD.work_mode)
        IS DISTINCT FROM ROW(NEW.profession_key, NEW.hr_shift_id, NEW.work_mode)
        AND EXISTS (SELECT 1 FROM hr_freelance_segment_terms WHERE segment_id = OLD.id)
    THEN
        RAISE EXCEPTION 'Agreed terms belong to the original freelance segment'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_terms_profession_immutable';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_hr_freelance_cancellation_history
    BEFORE DELETE ON hr_shift_segments FOR EACH ROW WHEN (OLD.hr_shift_id IS NULL)
    EXECUTE FUNCTION guard_hr_freelance_confirmed_segment_v393();
