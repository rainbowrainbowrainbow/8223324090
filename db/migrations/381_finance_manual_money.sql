-- MIGRATION_KIND: schema
-- SAFETY: Manual account journal with no mutation of existing finance, booking, payment, payroll or fiscal rows. Preserves one-open legacy shift invariant; replaces the business-wide index with separate legacy and per-account guards. FIN-MONEY-02-PROD-QA requires the exact reviewed SQL hash and bounded test-only release manifest before production execution.
-- ROLLBACK: Keep journal evidence and use a compatible application retaining ownership guards and legacy/manual shift separation with new commands disabled. A pre381 binary is unsafe after manual records exist. Do not drop journal tables or restore the old business-wide index. Disposable local test databases may be recreated by the isolated runner.
-- OPERATOR_APPROVAL: required

-- Transaction-local limits: each lock wait is bounded; each DDL statement has its own deadline.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_accounts_id_business_v381
    ON finance_accounts(id, business_context);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_id_business_v381
    ON bookings(id, business_context);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_categories_id_business_v381
    ON finance_categories(id, business_context);

CREATE TABLE IF NOT EXISTS finance_manual_accounts (
    account_id INTEGER PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    opening_minor BIGINT NOT NULL CHECK (opening_minor >= 0),
    cutoff_at TIMESTAMPTZ NOT NULL,
    enrolled_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, business_context),
    FOREIGN KEY (account_id, business_context) REFERENCES finance_accounts(id, business_context) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS finance_manual_booking_scopes (
    booking_id VARCHAR(50) PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    enrolled_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (booking_id, business_context),
    FOREIGN KEY (booking_id, business_context) REFERENCES bookings(id, business_context) ON DELETE RESTRICT
);

ALTER TABLE cash_register_shifts
    ADD COLUMN IF NOT EXISTS account_id INTEGER,
    ADD COLUMN IF NOT EXISTS opening_minor BIGINT,
    ADD COLUMN IF NOT EXISTS closing_minor BIGINT,
    ADD COLUMN IF NOT EXISTS expected_minor BIGINT,
    ADD COLUMN IF NOT EXISTS difference_minor BIGINT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_manual_shift_account_v381' AND conrelid = 'cash_register_shifts'::regclass) THEN
        ALTER TABLE cash_register_shifts ADD CONSTRAINT fk_manual_shift_account_v381
            FOREIGN KEY (account_id, business_context) REFERENCES finance_manual_accounts(account_id, business_context) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_manual_shift_amounts_v381' AND conrelid = 'cash_register_shifts'::regclass) THEN
        ALTER TABLE cash_register_shifts ADD CONSTRAINT chk_manual_shift_amounts_v381 CHECK (
            account_id IS NULL OR (opening_minor IS NOT NULL AND opening_minor >= 0
                AND (status = 'open' OR (closing_minor IS NOT NULL AND closing_minor >= 0
                    AND expected_minor IS NOT NULL AND expected_minor >= 0
                    AND difference_minor IS NOT NULL AND difference_minor = closing_minor - expected_minor)))
        );
    END IF;
END $$;

-- Establish both replacement guards before dropping the former business-only guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_legacy_v381
    ON cash_register_shifts(business_context) WHERE status = 'open' AND account_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_account_v381
    ON cash_register_shifts(business_context, account_id) WHERE status = 'open' AND account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_shifts_id_account_business_v381
    ON cash_register_shifts(id, account_id, business_context);
DROP INDEX IF EXISTS idx_cash_shifts_one_open_per_business;

CREATE TABLE IF NOT EXISTS finance_manual_operations (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    command VARCHAR(32) NOT NULL CHECK (command IN ('enroll', 'open_shift', 'close_shift', 'income', 'expense', 'booking_receipt', 'transfer', 'refund', 'reverse')),
    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(160) NOT NULL CHECK (BTRIM(idempotency_key) <> ''),
    request_fingerprint CHAR(64) NOT NULL,
    amount_minor BIGINT CHECK (amount_minor >= 0),
    category_id INTEGER,
    booking_id VARCHAR(50),
    original_id BIGINT,
    description TEXT,
    reason TEXT,
    effective_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (id, business_context),
    UNIQUE (business_context, actor_user_id, command, idempotency_key),
    FOREIGN KEY (booking_id, business_context) REFERENCES finance_manual_booking_scopes(booking_id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (category_id, business_context) REFERENCES finance_categories(id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (original_id, business_context) REFERENCES finance_manual_operations(id, business_context) ON DELETE RESTRICT,
    CHECK ((command IN ('refund', 'reverse')) = (original_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_manual_operations_business_time_v381
    ON finance_manual_operations(business_context, recorded_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_manual_operations_booking_v381
    ON finance_manual_operations(business_context, booking_id);
CREATE INDEX IF NOT EXISTS idx_manual_operations_original_v381
    ON finance_manual_operations(original_id) WHERE original_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_full_reversal_v381
    ON finance_manual_operations(original_id) WHERE command = 'reverse';

CREATE TABLE IF NOT EXISTS finance_manual_legs (
    id BIGSERIAL PRIMARY KEY,
    operation_id BIGINT NOT NULL,
    account_id INTEGER NOT NULL,
    business_context VARCHAR(64) NOT NULL,
    shift_id INTEGER,
    amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
    UNIQUE (operation_id, account_id),
    FOREIGN KEY (operation_id, business_context) REFERENCES finance_manual_operations(id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (account_id, business_context) REFERENCES finance_manual_accounts(account_id, business_context) ON DELETE RESTRICT,
    FOREIGN KEY (shift_id, account_id, business_context) REFERENCES cash_register_shifts(id, account_id, business_context) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_manual_legs_account_v381 ON finance_manual_legs(business_context, account_id);
CREATE INDEX IF NOT EXISTS idx_manual_legs_shift_v381 ON finance_manual_legs(shift_id) WHERE shift_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_manual_money_evidence_v381() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Only seal an operation's response once, in its writer transaction.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'finance_manual_operations'
        AND to_jsonb(OLD)->'result' = '{}'::jsonb AND to_jsonb(NEW)->'result' <> '{}'::jsonb
        AND (to_jsonb(OLD) - 'result') = (to_jsonb(NEW) - 'result') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Confirmed manual money evidence is immutable; use a linked reversal';
END $$;

DO $$ DECLARE table_name TEXT; BEGIN
    FOREACH table_name IN ARRAY ARRAY['finance_manual_accounts', 'finance_manual_booking_scopes', 'finance_manual_operations', 'finance_manual_legs'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_manual_money_immutable_v381' AND tgrelid = table_name::regclass) THEN
            EXECUTE format('CREATE TRIGGER trg_manual_money_immutable_v381 BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_manual_money_evidence_v381()', table_name);
        END IF;
    END LOOP;
END $$;

COMMENT ON TABLE finance_manual_operations IS 'Local isolated-QA manual movement journal; never a second writer for fiscal, payroll, banquet, certificate or legacy booking projections.';
