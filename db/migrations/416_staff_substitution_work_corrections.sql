-- MIGRATION_KIND: schema
-- SAFETY: Adds an immutable Park work-correction ledger and indexes. Existing payroll and attendance rows are untouched.
-- ROLLBACK: Disable new postings and preserve projection for entries already recorded.

CREATE TABLE IF NOT EXISTS staff_substitution_work_corrections (
    id BIGSERIAL PRIMARY KEY,
    substitution_id BIGINT NOT NULL UNIQUE REFERENCES staff_substitutions(id),
    source_report_id BIGINT NOT NULL REFERENCES payroll_reports(id),
    source_staff_id INTEGER NOT NULL REFERENCES staff(id),
    corrected_staff_id INTEGER NOT NULL REFERENCES staff(id),
    source_attendance_id INTEGER NOT NULL,
    corrected_attendance_id INTEGER NOT NULL,
    allocation_index INTEGER NOT NULL CHECK (allocation_index >= 0),
    evidence_json JSONB NOT NULL,
    work_date DATE NOT NULL,
    posting_month VARCHAR(7) NOT NULL CHECK (posting_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    reverse_minor BIGINT NOT NULL CHECK (reverse_minor BETWEEN 0 AND 9999999999),
    credit_minor BIGINT NOT NULL CHECK (credit_minor BETWEEN 0 AND 9999999999),
    actor VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    request_key VARCHAR(128) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (actor, request_key),
    UNIQUE (corrected_attendance_id, allocation_index),
    CHECK (posting_month > to_char(work_date, 'YYYY-MM'))
);

CREATE INDEX IF NOT EXISTS idx_staff_substitution_work_correction_month
    ON staff_substitution_work_corrections(posting_month);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname='staff_substitution_work_correction_immutable_v416'
          AND tgrelid='staff_substitution_work_corrections'::regclass
    ) THEN
        CREATE TRIGGER staff_substitution_work_correction_immutable_v416 BEFORE UPDATE OR DELETE
            ON staff_substitution_work_corrections FOR EACH ROW EXECUTE FUNCTION protect_staff_substitution_history_v392();
    END IF;
END;
$migration$;
