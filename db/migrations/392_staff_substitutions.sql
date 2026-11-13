-- MIGRATION_KIND: schema
-- SAFETY: Additive substitution ledger; no existing staff, attendance or payroll rows are changed.
-- ROLLBACK: Revert application callers; retain these tables and their immutable history. No automatic data rollback.

CREATE TABLE IF NOT EXISTS staff_substitutions (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    original_staff_id INTEGER REFERENCES staff(id),
    work_date DATE NOT NULL,
    source_type VARCHAR(32) NOT NULL,
    source_id VARCHAR(100) NOT NULL,
    slot_key VARCHAR(80) NOT NULL,
    state VARCHAR(16) NOT NULL CHECK (state IN ('active', 'completed', 'cancelled')),
    version INTEGER NOT NULL CHECK (version > 0),
    input_json JSONB NOT NULL CHECK (jsonb_typeof(input_json) = 'object'),
    quote_json JSONB NOT NULL CHECK (jsonb_typeof(quote_json) = 'object'),
    completion_json JSONB,
    source_snapshot JSONB NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (original_staff_id IS NULL OR original_staff_id <> staff_id),
    CHECK ((state = 'completed') = (completion_json IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_substitution_source_claim
    ON staff_substitutions(business_context, source_type, source_id, slot_key, work_date)
    WHERE state <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_staff_substitution_worker_date
    ON staff_substitutions(staff_id, work_date) WHERE state <> 'cancelled';

CREATE TABLE IF NOT EXISTS staff_substitution_events (
    id BIGSERIAL PRIMARY KEY,
    substitution_id BIGINT NOT NULL REFERENCES staff_substitutions(id),
    version INTEGER NOT NULL CHECK (version > 0),
    action VARCHAR(16) NOT NULL CHECK (action IN ('create', 'revise', 'complete', 'cancel')),
    actor VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    before_json JSONB,
    after_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (substitution_id, version)
);

CREATE TABLE IF NOT EXISTS staff_substitution_requests (
    business_context VARCHAR(64) NOT NULL,
    actor VARCHAR(100) NOT NULL,
    request_key VARCHAR(128) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    substitution_id BIGINT NOT NULL REFERENCES staff_substitutions(id),
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_context, actor, request_key)
);

CREATE TABLE IF NOT EXISTS staff_substitution_base_claims (
    substitution_id BIGINT NOT NULL REFERENCES staff_substitutions(id),
    attendance_id INTEGER NOT NULL REFERENCES hr_time_records(id),
    allocation_key VARCHAR(160) NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    evidence_json JSONB NOT NULL,
    PRIMARY KEY (attendance_id, allocation_key),
    UNIQUE (substitution_id, attendance_id, allocation_key)
);

CREATE OR REPLACE FUNCTION protect_staff_substitution_history_v392()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Substitution history is append-only' USING ERRCODE = '23514';
END;
$function$;
CREATE OR REPLACE FUNCTION guard_staff_substitution_revision_v392()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Cancel a substitution through an append-only revision' USING ERRCODE='23514';
    END IF;
    IF OLD.state<>'active' OR NEW.version<>OLD.version+1
        OR (NEW.business_context,NEW.staff_id,NEW.original_staff_id,NEW.work_date,NEW.source_type,NEW.source_id,NEW.slot_key,NEW.created_by,NEW.created_at)
           IS DISTINCT FROM (OLD.business_context,OLD.staff_id,OLD.original_staff_id,OLD.work_date,OLD.source_type,OLD.source_id,OLD.slot_key,OLD.created_by,OLD.created_at) THEN
        RAISE EXCEPTION 'Substitution evidence is frozen or revision is stale' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$function$;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='staff_substitution_revision_v392') THEN
        CREATE TRIGGER staff_substitution_revision_v392 BEFORE UPDATE OR DELETE ON staff_substitutions
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_revision_v392();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'staff_substitution_event_immutable_v392') THEN
        CREATE TRIGGER staff_substitution_event_immutable_v392 BEFORE UPDATE OR DELETE
            ON staff_substitution_events FOR EACH ROW EXECUTE FUNCTION protect_staff_substitution_history_v392();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'staff_substitution_request_immutable_v392') THEN
        CREATE TRIGGER staff_substitution_request_immutable_v392 BEFORE UPDATE OR DELETE
            ON staff_substitution_requests FOR EACH ROW EXECUTE FUNCTION protect_staff_substitution_history_v392();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'staff_substitution_base_claim_immutable_v392') THEN
        CREATE TRIGGER staff_substitution_base_claim_immutable_v392 BEFORE UPDATE OR DELETE
            ON staff_substitution_base_claims FOR EACH ROW EXECUTE FUNCTION protect_staff_substitution_history_v392();
    END IF;
END;
$migration$;

-- Existing source writers must not bypass an agreed substitution assignment.
CREATE OR REPLACE FUNCTION guard_staff_substitution_source_v392()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    source_kind TEXT;
    changed BOOLEAN;
    claim_id BIGINT;
    claim_slot TEXT;
BEGIN
    source_kind := CASE TG_TABLE_NAME WHEN 'hr_shifts' THEN 'hr_shift' WHEN 'tasks' THEN 'task'
        WHEN 'afisha' THEN 'afisha' WHEN 'leads' THEN 'lead' WHEN 'procurement_lists' THEN 'procurement' END;
    IF source_kind IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
    changed := TG_OP = 'DELETE';
    IF TG_OP = 'UPDATE' THEN
        IF source_kind = 'hr_shift' THEN
            changed := (to_jsonb(NEW)->'staff_id',to_jsonb(NEW)->'shift_date',to_jsonb(NEW)->'planned_start',to_jsonb(NEW)->'planned_end',to_jsonb(NEW)->'break_minutes')
                IS DISTINCT FROM (to_jsonb(OLD)->'staff_id',to_jsonb(OLD)->'shift_date',to_jsonb(OLD)->'planned_start',to_jsonb(OLD)->'planned_end',to_jsonb(OLD)->'break_minutes');
            changed := changed OR (to_jsonb(NEW)->'profession_key',to_jsonb(NEW)->'shift_type')
                IS DISTINCT FROM (to_jsonb(OLD)->'profession_key',to_jsonb(OLD)->'shift_type');
        ELSIF source_kind = 'task' THEN
            changed := (to_jsonb(NEW)->'owner_user_id',to_jsonb(NEW)->'business_context',to_jsonb(NEW)->'date',to_jsonb(NEW)->'scheduled_start_at',to_jsonb(NEW)->'scheduled_end_at')
                IS DISTINCT FROM (to_jsonb(OLD)->'owner_user_id',to_jsonb(OLD)->'business_context',to_jsonb(OLD)->'date',to_jsonb(OLD)->'scheduled_start_at',to_jsonb(OLD)->'scheduled_end_at');
            changed := changed OR (NEW.status IN ('cancelled','archived') AND NEW.status IS DISTINCT FROM OLD.status);
        ELSIF source_kind = 'afisha' THEN
            changed := (to_jsonb(NEW)->'line_id',to_jsonb(NEW)->'second_line_id',to_jsonb(NEW)->'date',to_jsonb(NEW)->'time',to_jsonb(NEW)->'duration')
                IS DISTINCT FROM (to_jsonb(OLD)->'line_id',to_jsonb(OLD)->'second_line_id',to_jsonb(OLD)->'date',to_jsonb(OLD)->'time',to_jsonb(OLD)->'duration');
        ELSE
            changed := (to_jsonb(NEW)->'assigned_to',to_jsonb(NEW)->'planned_date',to_jsonb(NEW)->'business_context')
                IS DISTINCT FROM (to_jsonb(OLD)->'assigned_to',to_jsonb(OLD)->'planned_date',to_jsonb(OLD)->'business_context');
        END IF;
    END IF;
    IF changed THEN
        FOR claim_id,claim_slot IN SELECT id,slot_key FROM staff_substitutions WHERE source_type=source_kind AND source_id=OLD.id::text AND state<>'cancelled'
        LOOP
            IF source_kind='afisha' AND TG_OP='UPDATE'
                AND (to_jsonb(NEW)->'date',to_jsonb(NEW)->'time',to_jsonb(NEW)->'duration') IS NOT DISTINCT FROM (to_jsonb(OLD)->'date',to_jsonb(OLD)->'time',to_jsonb(OLD)->'duration') THEN
                IF claim_slot='primary' AND NEW.line_id IS NOT DISTINCT FROM OLD.line_id THEN CONTINUE; END IF;
                IF claim_slot='second' AND NEW.second_line_id IS NOT DISTINCT FROM OLD.second_line_id THEN CONTINUE; END IF;
            END IF;
            IF COALESCE(current_setting('eventgenix.substitution_command',true),'') <> claim_id::text THEN
                RAISE EXCEPTION 'Source has an agreed substitution; use its audited workflow' USING ERRCODE='23514';
            END IF;
        END LOOP;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='hr_shift_substitution_guard_v392') THEN
        CREATE TRIGGER hr_shift_substitution_guard_v392 BEFORE UPDATE OR DELETE ON hr_shifts
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_source_v392();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='task_substitution_guard_v392') THEN
        CREATE TRIGGER task_substitution_guard_v392 BEFORE UPDATE OR DELETE ON tasks
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_source_v392();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='afisha_substitution_guard_v392') THEN
        CREATE TRIGGER afisha_substitution_guard_v392 BEFORE UPDATE OR DELETE ON afisha
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_source_v392();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='lead_substitution_guard_v392') THEN
        CREATE TRIGGER lead_substitution_guard_v392 BEFORE UPDATE OR DELETE ON leads
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_source_v392();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='procurement_substitution_guard_v392') THEN
        CREATE TRIGGER procurement_substitution_guard_v392 BEFORE UPDATE OR DELETE ON procurement_lists
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_source_v392();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION guard_staff_substitution_segment_v392()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE claim_id BIGINT;
BEGIN
    FOR claim_id IN SELECT id FROM staff_substitutions
        WHERE source_type='hr_shift' AND state<>'cancelled'
        AND (source_id=CASE WHEN TG_OP<>'DELETE' THEN NEW.hr_shift_id::text END
            OR source_id=CASE WHEN TG_OP<>'INSERT' THEN OLD.hr_shift_id::text END)
    LOOP
        IF COALESCE(current_setting('eventgenix.substitution_command',true),'')<>claim_id::text THEN
            RAISE EXCEPTION 'Shift segments have an agreed substitution; use its audited workflow' USING ERRCODE='23514';
        END IF;
    END LOOP;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='hr_segment_substitution_guard_v392') THEN
        CREATE TRIGGER hr_segment_substitution_guard_v392 BEFORE INSERT OR UPDATE OR DELETE ON hr_shift_segments
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_segment_v392();
    END IF;
END;
$migration$;
