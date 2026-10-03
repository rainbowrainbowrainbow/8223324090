-- MIGRATION_KIND: schema
-- SAFETY: Additive empty append-only exception journal; no staff, rates, attendance or payroll history is backfilled or recalculated. Existing snapshots remain unchanged.
-- ROLLBACK: Revert application code while retaining this journal and all snapshots. Do not drop populated structures or rewrite closed payroll reports.

CREATE TABLE IF NOT EXISTS payroll_day_exceptions (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    profession_key VARCHAR(64) NOT NULL REFERENCES hr_professions(key) ON DELETE RESTRICT,
    work_date DATE NOT NULL,
    purpose VARCHAR(24) NOT NULL CHECK (purpose IN ('base_replacement', 'additional')),
    version INTEGER NOT NULL CHECK (version > 0),
    state VARCHAR(12) NOT NULL CHECK (state IN ('active', 'voided')),
    rate NUMERIC(12,2),
    rate_unit VARCHAR(8),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    created_by VARCHAR(100) NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key VARCHAR(128) NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    request_hash CHAR(64) NOT NULL,
    CHECK ((state = 'active' AND rate IS NOT NULL AND rate_unit IS NOT NULL AND rate > 0 AND rate_unit IN ('hour', 'day'))
        OR (state = 'voided' AND rate IS NULL AND rate_unit IS NULL)),
    UNIQUE (staff_id, profession_key, work_date, purpose, version),
    UNIQUE (staff_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_payroll_day_exceptions_staff_date
    ON payroll_day_exceptions(staff_id, work_date, profession_key, purpose, version DESC);

CREATE OR REPLACE FUNCTION guard_payroll_day_exception_history_v374()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    RAISE EXCEPTION 'Payroll day exceptions are append-only; append a new version to change or void' USING ERRCODE = '23514';
END;
$function$;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payroll_day_exception_history_v374'
        AND tgrelid = 'payroll_day_exceptions'::regclass) THEN
        CREATE TRIGGER trg_payroll_day_exception_history_v374 BEFORE UPDATE OR DELETE
            ON payroll_day_exceptions FOR EACH ROW EXECUTE FUNCTION guard_payroll_day_exception_history_v374();
    END IF;
END;
$migration$;

-- Preserve per-kind exclusion; temporary overrides may overlap permanent terms.
CREATE OR REPLACE FUNCTION enforce_staff_payroll_assignment_v297()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    new_lock_key BIGINT;
    old_lock_key BIGINT;
    assigned_profile_kind VARCHAR(16);
    assigned_profile_owner INTEGER;
BEGIN
    IF NEW.staff_id IS NULL
        OR NEW.profession_key IS NULL
        OR NEW.profile_id IS NULL
        OR NEW.effective_from IS NULL
    THEN
        RETURN NEW;
    END IF;

    new_lock_key := hashtextextended(
        'payroll_assignment:' || NEW.staff_id::text || ':' || NEW.profession_key,
        0
    );

    IF TG_OP = 'UPDATE'
        AND (
            OLD.staff_id IS DISTINCT FROM NEW.staff_id
            OR OLD.profession_key IS DISTINCT FROM NEW.profession_key
        )
    THEN
        old_lock_key := hashtextextended(
            'payroll_assignment:' || OLD.staff_id::text || ':' || OLD.profession_key,
            0
        );
        PERFORM pg_advisory_xact_lock(LEAST(old_lock_key, new_lock_key));
        IF old_lock_key <> new_lock_key THEN
            PERFORM pg_advisory_xact_lock(GREATEST(old_lock_key, new_lock_key));
        END IF;
    ELSE
        PERFORM pg_advisory_xact_lock(new_lock_key);
    END IF;

    SELECT profile_kind, owner_staff_id
    INTO assigned_profile_kind, assigned_profile_owner
    FROM payroll_profiles
    WHERE id = NEW.profile_id
      AND profession_key = NEW.profession_key
    FOR SHARE;

    IF FOUND
        AND assigned_profile_kind = 'personal'
        AND assigned_profile_owner IS DISTINCT FROM NEW.staff_id
    THEN
        RAISE EXCEPTION
            'Personal payroll profile % can only be assigned to staff %',
            NEW.profile_id,
            assigned_profile_owner
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM staff_payroll_profile_assignments existing
        WHERE existing.staff_id = NEW.staff_id
          AND existing.profession_key = NEW.profession_key
          AND existing.assignment_kind = NEW.assignment_kind
          AND existing.id IS DISTINCT FROM NEW.id
          AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
          AND NEW.effective_from <= COALESCE(existing.effective_to, 'infinity'::date)
    ) THEN
        RAISE EXCEPTION
            'Payroll profile assignment periods overlap for staff % and profession %',
            NEW.staff_id,
            NEW.profession_key
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$function$;

