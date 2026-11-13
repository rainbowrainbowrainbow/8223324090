-- MIGRATION_KIND: schema
-- SAFETY: Adds empty links to the existing finance ledger. Existing transactions and payroll history are untouched.
-- ROLLBACK: Disable freelance settlement and retain movement links and finance guards. Do not roll back to a writer that ignores confirmed history.

CREATE TABLE IF NOT EXISTS hr_freelance_payment_movements (
    id BIGSERIAL PRIMARY KEY,
    segment_id BIGINT NOT NULL REFERENCES hr_freelance_confirmed_blocks(segment_id) ON DELETE RESTRICT,
    finance_transaction_id INTEGER NOT NULL UNIQUE REFERENCES finance_transactions(id) ON DELETE RESTRICT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    reversal_of BIGINT UNIQUE REFERENCES hr_freelance_payment_movements(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    request_hash CHAR(64) NOT NULL,
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_freelance_movements_segment
    ON hr_freelance_payment_movements (segment_id, id);

CREATE OR REPLACE FUNCTION guard_hr_freelance_finance_v394()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF OLD.source = 'hr_freelance' THEN
        RAISE EXCEPTION 'Freelance finance history is immutable; record a reversal'
            USING ERRCODE = '23514', CONSTRAINT = 'hr_freelance_finance_immutable';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'finance_transactions'::regclass
        AND tgname = 'trg_hr_freelance_finance_immutable') THEN
        CREATE TRIGGER trg_hr_freelance_finance_immutable BEFORE UPDATE OR DELETE ON finance_transactions
            FOR EACH ROW EXECUTE FUNCTION guard_hr_freelance_finance_v394();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'hr_freelance_payment_movements'::regclass
        AND tgname = 'trg_hr_freelance_history_immutable') THEN
        CREATE TRIGGER trg_hr_freelance_history_immutable BEFORE UPDATE OR DELETE ON hr_freelance_payment_movements
            FOR EACH ROW EXECUTE FUNCTION guard_hr_freelance_history_v393();
    END IF;
END;
$migration$;
