-- MIGRATION_KIND: schema
-- SAFETY: Replaces the cancellation guard without rewriting plans, time records, or historical rows.
-- ROLLBACK: Restore the guard function body from migration 424 in a compatible follow-up migration.


CREATE OR REPLACE FUNCTION guard_hr_freelance_confirmed_segment_v393()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    original_staff_id INTEGER;
    original_shift_date DATE;
    block_start TIMESTAMPTZ;
    block_end TIMESTAMPTZ;
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

        block_start := (original_shift_date + OLD.planned_start
            + COALESCE(OLD.start_day_offset, 0) * INTERVAL '1 day') AT TIME ZONE 'Europe/Kyiv';
        block_end := (original_shift_date + OLD.planned_end
            + COALESCE(OLD.end_day_offset, CASE WHEN OLD.planned_end < OLD.planned_start THEN 1 ELSE 0 END)
                * INTERVAL '1 day') AT TIME ZONE 'Europe/Kyiv';

        -- An open day-level clock-in cannot identify this particular future block.
        IF block_start <= clock_timestamp() OR EXISTS (
            SELECT 1 FROM hr_time_records
            WHERE staff_id = original_staff_id AND record_date = original_shift_date
              AND business_context = 'event_genix' AND status IS DISTINCT FROM 'arrival_cancelled'
              AND clock_in < block_end AND clock_out > block_start AND clock_out > clock_in
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
