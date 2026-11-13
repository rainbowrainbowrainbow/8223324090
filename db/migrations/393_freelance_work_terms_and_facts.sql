-- MIGRATION_KIND: schema
-- SAFETY: Adds empty version journals and fact tables. Existing attendance, compensation snapshots and financial records are untouched.
-- ROLLBACK: Keep the new history tables. Revert application code only before enabling freelance work, or use a compatible build that preserves confirmed work.

CREATE TABLE IF NOT EXISTS hr_freelance_rate_versions (
    id BIGSERIAL PRIMARY KEY,
    profession_key VARCHAR(64) NOT NULL REFERENCES hr_professions(key) ON DELETE RESTRICT,
    staff_id INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    rate_unit VARCHAR(8) NOT NULL CHECK (rate_unit IN ('hour', 'fixed')),
    rate NUMERIC(12,2) NOT NULL CHECK (rate > 0),
    effective_from DATE NOT NULL,
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_freelance_rate_versions_lookup
    ON hr_freelance_rate_versions (profession_key, staff_id, effective_from DESC, id DESC);

CREATE TABLE IF NOT EXISTS hr_freelance_segment_terms (
    id BIGSERIAL PRIMARY KEY,
    segment_id BIGINT NOT NULL REFERENCES hr_shift_segments(id) ON DELETE RESTRICT,
    source_version_id BIGINT REFERENCES hr_freelance_rate_versions(id) ON DELETE RESTRICT,
    rate_unit VARCHAR(8) NOT NULL CHECK (rate_unit IN ('hour', 'fixed')),
    rate NUMERIC(12,2) NOT NULL CHECK (rate > 0),
    reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (segment_id, id)
);
CREATE INDEX IF NOT EXISTS idx_hr_freelance_segment_terms_latest
    ON hr_freelance_segment_terms (segment_id, id DESC);

CREATE TABLE IF NOT EXISTS hr_freelance_attendance_confirmations (
    attendance_id INTEGER PRIMARY KEY REFERENCES hr_time_records(id) ON DELETE RESTRICT,
    hr_shift_id INTEGER NOT NULL UNIQUE REFERENCES hr_shifts(id) ON DELETE RESTRICT,
    fact_snapshot JSONB NOT NULL,
    confirmed_by TEXT NOT NULL CHECK (btrim(confirmed_by) <> ''),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr_freelance_confirmed_blocks (
    segment_id BIGINT PRIMARY KEY REFERENCES hr_shift_segments(id) ON DELETE RESTRICT,
    attendance_id INTEGER NOT NULL REFERENCES hr_freelance_attendance_confirmations(attendance_id) ON DELETE RESTRICT,
    work_mode VARCHAR(12) NOT NULL CHECK (work_mode IN ('regular', 'freelance')),
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
    terms_id BIGINT,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    FOREIGN KEY (segment_id, terms_id) REFERENCES hr_freelance_segment_terms(segment_id, id) ON DELETE RESTRICT,
    CHECK (
        (work_mode = 'regular' AND terms_id IS NULL AND amount = 0)
        OR (work_mode = 'freelance' AND minutes = 0 AND terms_id IS NULL AND amount = 0)
        OR (work_mode = 'freelance' AND minutes > 0 AND terms_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_hr_freelance_confirmed_blocks_attendance
    ON hr_freelance_confirmed_blocks (attendance_id);

CREATE OR REPLACE FUNCTION guard_hr_freelance_history_v393()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Confirmed freelance history is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_history_immutable';
END;
$function$;
DO $migration$
DECLARE
    relation_name TEXT;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'hr_freelance_rate_versions', 'hr_freelance_segment_terms',
        'hr_freelance_attendance_confirmations', 'hr_freelance_confirmed_blocks'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgrelid = relation_name::regclass
                AND tgname = 'trg_hr_freelance_history_immutable'
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER trg_hr_freelance_history_immutable BEFORE UPDATE OR DELETE ON %I
                 FOR EACH ROW EXECUTE FUNCTION guard_hr_freelance_history_v393()', relation_name);
        END IF;
    END LOOP;
END;
$migration$;

CREATE OR REPLACE FUNCTION guard_hr_freelance_confirmed_segment_v393()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
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
    IF ROW(OLD.profession_key, OLD.hr_shift_id) IS DISTINCT FROM ROW(NEW.profession_key, NEW.hr_shift_id) AND EXISTS (
        SELECT 1 FROM hr_freelance_segment_terms WHERE segment_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'Agreed terms belong to the original profession'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_terms_profession_immutable';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_hr_freelance_confirmation_inputs_v393()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_TABLE_NAME = 'hr_shifts' THEN
        IF ROW(OLD.staff_id, OLD.shift_date) IS DISTINCT FROM ROW(NEW.staff_id, NEW.shift_date)
            AND EXISTS (
                SELECT 1 FROM hr_shift_segments segment
                JOIN hr_freelance_segment_terms terms ON terms.segment_id = segment.id
                WHERE segment.hr_shift_id = OLD.id
            )
            OR (
                ROW(OLD.staff_id, OLD.shift_date, OLD.shift_type, OLD.profession_key)
                    IS DISTINCT FROM ROW(NEW.staff_id, NEW.shift_date, NEW.shift_type, NEW.profession_key)
                AND EXISTS (SELECT 1 FROM hr_freelance_attendance_confirmations WHERE hr_shift_id = OLD.id)
            )
        THEN
            RAISE EXCEPTION 'Confirmed freelance shift identity cannot be rewritten'
                USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_confirmed_shift_immutable';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM hr_freelance_attendance_confirmations WHERE attendance_id = OLD.id)
        AND ROW(OLD.staff_id, OLD.record_date, OLD.business_context, OLD.clock_in, OLD.clock_out,
                OLD.status, OLD.total_worked_minutes, OLD.compensation_snapshot)
            IS DISTINCT FROM
            ROW(NEW.staff_id, NEW.record_date, NEW.business_context, NEW.clock_in, NEW.clock_out,
                NEW.status, NEW.total_worked_minutes, NEW.compensation_snapshot)
    THEN
        RAISE EXCEPTION 'Confirmed freelance attendance cannot be rewritten'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_confirmed_attendance_immutable';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_hr_freelance_confirmed_plan_insert_v393()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM hr_freelance_attendance_confirmations WHERE hr_shift_id = NEW.hr_shift_id) THEN
        RAISE EXCEPTION 'Confirmed freelance shift cannot acquire additional blocks'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_confirmed_shift_immutable';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_hr_freelance_confirmed_roles_v393()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF (TG_OP <> 'DELETE' AND EXISTS (
        SELECT 1 FROM hr_freelance_confirmed_blocks WHERE segment_id = NEW.segment_id
    )) OR (TG_OP <> 'INSERT' AND EXISTS (
        SELECT 1 FROM hr_freelance_confirmed_blocks WHERE segment_id = OLD.segment_id
    )) THEN
        RAISE EXCEPTION 'Confirmed freelance shift roles cannot be rewritten'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_confirmed_roles_immutable';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'hr_shift_segments'::regclass
        AND tgname = 'trg_hr_freelance_confirmed_plan_insert') THEN
        CREATE TRIGGER trg_hr_freelance_confirmed_plan_insert BEFORE INSERT ON hr_shift_segments
            FOR EACH ROW EXECUTE FUNCTION guard_hr_freelance_confirmed_plan_insert_v393();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'hr_shift_segment_roles'::regclass
        AND tgname = 'trg_hr_freelance_confirmed_roles') THEN
        CREATE TRIGGER trg_hr_freelance_confirmed_roles BEFORE INSERT OR UPDATE OR DELETE ON hr_shift_segment_roles
            FOR EACH ROW EXECUTE FUNCTION guard_hr_freelance_confirmed_roles_v393();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'hr_shift_segments'::regclass
        AND tgname = 'trg_hr_freelance_confirmed_segment') THEN
        CREATE TRIGGER trg_hr_freelance_confirmed_segment BEFORE UPDATE ON hr_shift_segments
            FOR EACH ROW EXECUTE FUNCTION guard_hr_freelance_confirmed_segment_v393();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'hr_shifts'::regclass
        AND tgname = 'trg_hr_freelance_confirmed_shift') THEN
        CREATE TRIGGER trg_hr_freelance_confirmed_shift BEFORE UPDATE ON hr_shifts
            FOR EACH ROW EXECUTE FUNCTION guard_hr_freelance_confirmation_inputs_v393();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'hr_time_records'::regclass
        AND tgname = 'trg_hr_freelance_confirmed_attendance') THEN
        CREATE TRIGGER trg_hr_freelance_confirmed_attendance BEFORE UPDATE ON hr_time_records
            FOR EACH ROW EXECUTE FUNCTION guard_hr_freelance_confirmation_inputs_v393();
    END IF;
END;
$migration$;
