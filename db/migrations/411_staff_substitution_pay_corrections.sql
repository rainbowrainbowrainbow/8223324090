-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent correction ledger. Existing agreements, attendance and payroll snapshots are untouched.
-- ROLLBACK: Disable correction posting while preserving the ledger and payroll projection for posted deltas.

CREATE TABLE IF NOT EXISTS staff_substitution_pay_corrections (
    id BIGSERIAL PRIMARY KEY,
    substitution_id BIGINT NOT NULL REFERENCES staff_substitutions(id),
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    payee VARCHAR(16) NOT NULL CHECK (payee IN ('replacement', 'original')),
    work_date DATE NOT NULL,
    posting_month VARCHAR(7) NOT NULL CHECK (posting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    before_minor BIGINT NOT NULL CHECK (before_minor BETWEEN -9007199254740991 AND 9007199254740991),
    after_minor BIGINT NOT NULL CHECK (after_minor BETWEEN -9999999999 AND 9999999999),
    delta_minor BIGINT GENERATED ALWAYS AS (after_minor - before_minor) STORED,
    actor VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    request_key VARCHAR(128) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (actor, request_key),
    CHECK (posting_month >= to_char(work_date, 'YYYY-MM')),
    CHECK (before_minor <> after_minor),
    CHECK (after_minor - before_minor BETWEEN -9007199254740991 AND 9007199254740991),
    CHECK (payee <> 'replacement' OR (before_minor >= 0 AND after_minor >= 0))
);

CREATE INDEX IF NOT EXISTS idx_staff_substitution_pay_correction_history
    ON staff_substitution_pay_corrections(substitution_id, id);
CREATE INDEX IF NOT EXISTS idx_staff_substitution_pay_correction_posting
    ON staff_substitution_pay_corrections(posting_month, staff_id, id);

CREATE OR REPLACE FUNCTION guard_staff_substitution_pay_correction_v411()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM staff_substitutions s
        WHERE s.id = NEW.substitution_id AND s.business_context = 'event_genix'
          AND s.state = 'completed' AND s.work_date = NEW.work_date
          AND (
              (NEW.payee = 'replacement' AND s.staff_id = NEW.staff_id)
              OR (NEW.payee = 'original' AND s.original_staff_id = NEW.staff_id
                  AND s.completion_json #>> '{originalPay,amountMinor}' IS NOT NULL)
          )
    ) THEN
        RAISE EXCEPTION 'Correction requires a completed Park substitution and its frozen payee' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'staff_substitution_pay_correction_guard_v411'
          AND tgrelid = 'staff_substitution_pay_corrections'::regclass
    ) THEN
        CREATE TRIGGER staff_substitution_pay_correction_guard_v411 BEFORE INSERT
            ON staff_substitution_pay_corrections
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_pay_correction_v411();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'staff_substitution_pay_correction_immutable_v411'
          AND tgrelid = 'staff_substitution_pay_corrections'::regclass
    ) THEN
        CREATE TRIGGER staff_substitution_pay_correction_immutable_v411 BEFORE UPDATE OR DELETE
            ON staff_substitution_pay_corrections
            FOR EACH ROW EXECUTE FUNCTION protect_staff_substitution_history_v392();
    END IF;
END;
$migration$;
