-- MIGRATION_KIND: schema
-- SAFETY: Additive payroll-settlement foundation only. Existing payroll reports remain legacy_v1, no installment/payment rows are seeded, and no payroll, finance, staff, adjustment, or entry history is rewritten.
-- ROLLBACK: Disable installment writes, export any installment/payment history that must be retained, then drop the v302 triggers/functions/tables/constraints and the payroll_reports.settlement_model column. Keep legacy payroll and finance history unchanged.
-- OPERATOR_APPROVAL: required

ALTER TABLE payroll_reports
    ADD COLUMN IF NOT EXISTS settlement_model VARCHAR(32) NOT NULL DEFAULT 'legacy_v1';

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_payroll_reports_settlement_model_v302'
          AND conrelid = 'payroll_reports'::regclass
    ) THEN
        ALTER TABLE payroll_reports
            ADD CONSTRAINT chk_payroll_reports_settlement_model_v302
            CHECK (settlement_model IN ('legacy_v1', 'installments_v1'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_payroll_reports_installment_legacy_links_v302'
          AND conrelid = 'payroll_reports'::regclass
    ) THEN
        ALTER TABLE payroll_reports
            ADD CONSTRAINT chk_payroll_reports_installment_legacy_links_v302
            CHECK (
                settlement_model = 'legacy_v1'
                OR (
                    finance_transaction_id IS NULL
                    AND reversal_transaction_id IS NULL
                    AND status NOT IN ('paid', 'reversed')
                )
            );
    END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS payroll_installments (
    id BIGSERIAL PRIMARY KEY,
    payroll_report_id BIGINT NOT NULL REFERENCES payroll_reports(id) ON DELETE RESTRICT,
    kind VARCHAR(16) NOT NULL,
    earning_from DATE NOT NULL,
    earning_to DATE NOT NULL,
    scheduled_payment_date DATE NOT NULL,
    calculated_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    locked_amount INTEGER,
    calculation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    workflow_status VARCHAR(20) NOT NULL DEFAULT 'draft',
    allocation_status VARCHAR(16) NOT NULL DEFAULT 'unresolved',
    business_context VARCHAR(64),
    approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_by_username VARCHAR(100),
    approved_by_role VARCHAR(50),
    approved_at TIMESTAMPTZ,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payroll_installments_report_kind_v302
        UNIQUE (payroll_report_id, kind),
    CONSTRAINT chk_payroll_installments_kind_v302
        CHECK (kind IN ('advance', 'final')),
    CONSTRAINT chk_payroll_installments_amounts_v302
        CHECK (
            calculated_amount >= 0
            AND (locked_amount IS NULL OR locked_amount >= 0)
        ),
    CONSTRAINT chk_payroll_installments_snapshot_v302
        CHECK (jsonb_typeof(calculation_snapshot) = 'object'),
    CONSTRAINT chk_payroll_installments_workflow_v302
        CHECK (workflow_status IN ('draft', 'approved', 'cancelled')),
    CONSTRAINT chk_payroll_installments_earning_shape_v302
        CHECK (
            (
                kind = 'advance'
                AND earning_from = date_trunc('month', earning_from)::date
                AND earning_to = date_trunc('month', earning_from)::date + 14
            )
            OR (
                kind = 'final'
                AND earning_from = date_trunc('month', earning_from)::date + 15
                AND earning_to = (date_trunc('month', earning_from) + INTERVAL '1 month - 1 day')::date
            )
        ),
    CONSTRAINT chk_payroll_installments_scheduled_date_v302
        CHECK (scheduled_payment_date >= earning_to),
    CONSTRAINT chk_payroll_installments_allocation_v302
        CHECK (
            (
                allocation_status = 'unresolved'
                AND business_context IS NULL
            )
            OR (
                allocation_status = 'single'
                AND NULLIF(BTRIM(business_context), '') IS NOT NULL
            )
        ),
    CONSTRAINT chk_payroll_installments_approval_v302
        CHECK (
            workflow_status <> 'approved'
            OR (
                locked_amount IS NOT NULL
                AND allocation_status = 'single'
                AND approved_at IS NOT NULL
                AND NULLIF(BTRIM(approved_by_username), '') IS NOT NULL
                AND NULLIF(BTRIM(approved_by_role), '') IS NOT NULL
            )
        )
);

CREATE TABLE IF NOT EXISTS payroll_payment_movements (
    id BIGSERIAL PRIMARY KEY,
    installment_id BIGINT NOT NULL REFERENCES payroll_installments(id) ON DELETE RESTRICT,
    movement_type VARCHAR(16) NOT NULL,
    amount INTEGER NOT NULL,
    actual_payment_date DATE NOT NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_username VARCHAR(100) NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    finance_transaction_id INTEGER NOT NULL REFERENCES finance_transactions(id) ON DELETE RESTRICT,
    reverses_movement_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payroll_payment_movements_id_installment_v302
        UNIQUE (id, installment_id),
    CONSTRAINT uq_payroll_payment_movements_idempotency_v302
        UNIQUE (idempotency_key),
    CONSTRAINT uq_payroll_payment_movements_finance_v302
        UNIQUE (finance_transaction_id),
    CONSTRAINT chk_payroll_payment_movements_type_v302
        CHECK (movement_type IN ('payment', 'reversal')),
    CONSTRAINT chk_payroll_payment_movements_amount_v302
        CHECK (amount > 0),
    CONSTRAINT chk_payroll_payment_movements_actor_v302
        CHECK (
            NULLIF(BTRIM(actor_username), '') IS NOT NULL
            AND NULLIF(BTRIM(actor_role), '') IS NOT NULL
        ),
    CONSTRAINT chk_payroll_payment_movements_reason_v302
        CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
    CONSTRAINT chk_payroll_payment_movements_idempotency_v302
        CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL),
    CONSTRAINT chk_payroll_payment_movements_reversal_shape_v302
        CHECK (
            (movement_type = 'payment' AND reverses_movement_id IS NULL)
            OR (movement_type = 'reversal' AND reverses_movement_id IS NOT NULL)
        )
);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_payroll_payment_movements_reversal_v302'
          AND conrelid = 'payroll_payment_movements'::regclass
    ) THEN
        ALTER TABLE payroll_payment_movements
            ADD CONSTRAINT fk_payroll_payment_movements_reversal_v302
            FOREIGN KEY (reverses_movement_id, installment_id)
            REFERENCES payroll_payment_movements(id, installment_id)
            ON UPDATE RESTRICT
            ON DELETE RESTRICT;
    END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS idx_payroll_installments_due_status_v302
    ON payroll_installments(workflow_status, scheduled_payment_date, id);

CREATE INDEX IF NOT EXISTS idx_payroll_installments_business_due_v302
    ON payroll_installments(business_context, scheduled_payment_date, id)
    WHERE business_context IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_installments_approver_v302
    ON payroll_installments(approved_by_user_id, approved_at DESC)
    WHERE approved_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_payment_movements_installment_v302
    ON payroll_payment_movements(installment_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_payroll_payment_movements_actual_date_v302
    ON payroll_payment_movements(actual_payment_date, id);

CREATE INDEX IF NOT EXISTS idx_payroll_payment_movements_reversal_v302
    ON payroll_payment_movements(reverses_movement_id)
    WHERE reverses_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_payment_movements_actor_v302
    ON payroll_payment_movements(actor_user_id, created_at DESC)
    WHERE actor_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_payroll_installment_report_v302()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    report_month VARCHAR(7);
    report_model VARCHAR(32);
BEGIN
    SELECT period_month, settlement_model
    INTO report_month, report_model
    FROM payroll_reports
    WHERE id = NEW.payroll_report_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'payroll installment report does not exist';
    END IF;

    IF report_model <> 'installments_v1' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'payroll report must use installments_v1 before installments are created';
    END IF;

    IF TO_CHAR(NEW.earning_from, 'YYYY-MM') <> report_month
       OR TO_CHAR(NEW.earning_to, 'YYYY-MM') <> report_month THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'payroll installment earning range must match the payroll report month';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_payroll_report_settlement_model_v302()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.settlement_model = 'installments_v1'
       AND NEW.settlement_model = 'legacy_v1'
       AND EXISTS (
           SELECT 1
           FROM payroll_installments
           WHERE payroll_report_id = OLD.id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'payroll report with installments cannot return to legacy_v1';
    END IF;

    IF (
        NEW.staff_id IS DISTINCT FROM OLD.staff_id
        OR NEW.period_month IS DISTINCT FROM OLD.period_month
    )
       AND EXISTS (
           SELECT 1
           FROM payroll_installments
           WHERE payroll_report_id = OLD.id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'payroll report identity is immutable after installments are created';
    END IF;

    RETURN NEW;

END;
$function$;

CREATE OR REPLACE FUNCTION validate_payroll_installment_approval_v302()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    approval_is_new BOOLEAN := false;
    expected_approver_username VARCHAR(100);
    expected_approver_role VARCHAR(50);
BEGIN
    IF NEW.workflow_status = 'approved' THEN
        IF TG_OP = 'INSERT' THEN
            approval_is_new := true;
        ELSIF OLD.workflow_status IS DISTINCT FROM 'approved' THEN
            approval_is_new := true;
        END IF;
    END IF;

    IF approval_is_new THEN
        IF NEW.approved_by_user_id IS NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'payroll installment approver user is required';
        END IF;

        SELECT username, role
        INTO expected_approver_username, expected_approver_role
        FROM users
        WHERE id = NEW.approved_by_user_id;

        IF NOT FOUND
           OR NEW.approved_by_username IS DISTINCT FROM expected_approver_username
           OR NEW.approved_by_role IS DISTINCT FROM expected_approver_role THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'payroll installment approver snapshot must match the approver user';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_payroll_installment_lifecycle_v302()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE'
       AND pg_trigger_depth() > 1
       AND OLD.approved_by_user_id IS NOT NULL
       AND NEW.approved_by_user_id IS NULL
       AND (TO_JSONB(OLD) - 'approved_by_user_id') = (TO_JSONB(NEW) - 'approved_by_user_id') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND (
           NEW.payroll_report_id IS DISTINCT FROM OLD.payroll_report_id
           OR NEW.kind IS DISTINCT FROM OLD.kind
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'payroll installment report and kind are immutable';
    END IF;

    IF OLD.workflow_status IN ('approved', 'cancelled')
       OR EXISTS (
           SELECT 1
           FROM payroll_payment_movements
           WHERE installment_id = OLD.id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'approved or cancelled payroll installments are immutable';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION validate_payroll_payment_movement_v302()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    installment_status VARCHAR(20);
    installment_locked_amount INTEGER;
    installment_business_context VARCHAR(64);
    report_staff_id INTEGER;
    current_paid_amount BIGINT;
    expected_actor_username VARCHAR(100);
    expected_actor_role VARCHAR(50);
    expected_finance_type VARCHAR(16);
    linked_finance_type finance_transactions.type%TYPE;
    linked_finance_amount finance_transactions.amount%TYPE;
    linked_finance_date finance_transactions.date%TYPE;
    linked_finance_staff_id finance_transactions.staff_id%TYPE;
    linked_finance_business_context finance_transactions.business_context%TYPE;
    linked_finance_source finance_transactions.source%TYPE;
    target_type VARCHAR(16);
    target_amount INTEGER;
    target_payment_date DATE;
    target_reversed_amount BIGINT;
BEGIN
    SELECT pi.workflow_status, pi.locked_amount, pi.business_context, pr.staff_id
    INTO installment_status, installment_locked_amount, installment_business_context, report_staff_id
    FROM payroll_installments pi
    JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
    WHERE pi.id = NEW.installment_id
    FOR UPDATE OF pi;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'payroll payment installment does not exist';
    END IF;

    IF installment_status <> 'approved' OR installment_locked_amount IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'payroll payments require an approved locked installment';
    END IF;

    IF NEW.actor_user_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'payroll payment actor user is required';
    END IF;

    SELECT username, role
    INTO expected_actor_username, expected_actor_role
    FROM users
    WHERE id = NEW.actor_user_id;

    IF NOT FOUND
       OR NEW.actor_username IS DISTINCT FROM expected_actor_username
       OR NEW.actor_role IS DISTINCT FROM expected_actor_role THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'payroll payment actor snapshot must match the actor user';
    END IF;

    SELECT type, amount, date, staff_id, business_context, source
    INTO linked_finance_type, linked_finance_amount, linked_finance_date,
         linked_finance_staff_id, linked_finance_business_context, linked_finance_source
    FROM finance_transactions
    WHERE id = NEW.finance_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'payroll movement finance transaction does not exist';
    END IF;

    expected_finance_type := CASE NEW.movement_type
        WHEN 'payment' THEN 'expense'
        WHEN 'reversal' THEN 'income'
        ELSE NULL
    END;

    IF linked_finance_type IS DISTINCT FROM expected_finance_type
       OR linked_finance_amount IS DISTINCT FROM NEW.amount
       OR linked_finance_date IS DISTINCT FROM TO_CHAR(NEW.actual_payment_date, 'YYYY-MM-DD')
       OR linked_finance_staff_id IS DISTINCT FROM report_staff_id
       OR linked_finance_business_context IS DISTINCT FROM installment_business_context
       OR linked_finance_source IS DISTINCT FROM 'payroll' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'payroll movement must match its finance transaction facts';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM payroll_reports
        WHERE finance_transaction_id = NEW.finance_transaction_id
           OR reversal_transaction_id = NEW.finance_transaction_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'finance transaction is already linked to a legacy payroll report';
    END IF;


    SELECT COALESCE(SUM(
        CASE movement_type
            WHEN 'payment' THEN amount
            WHEN 'reversal' THEN -amount
            ELSE 0
        END
    ), 0)::bigint
    INTO current_paid_amount
    FROM payroll_payment_movements
    WHERE installment_id = NEW.installment_id;

    IF NEW.movement_type = 'payment' THEN
        IF current_paid_amount + NEW.amount > installment_locked_amount THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'payroll payment exceeds the installment outstanding balance';
        END IF;
    END IF;

    IF NEW.movement_type = 'reversal' THEN
        SELECT movement_type, amount, actual_payment_date
        INTO target_type, target_amount, target_payment_date
        FROM payroll_payment_movements
        WHERE id = NEW.reverses_movement_id
          AND installment_id = NEW.installment_id
        FOR UPDATE;

        IF NOT FOUND OR target_type <> 'payment' THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'payroll reversal must reference a payment from the same installment';
        END IF;

        IF NEW.actual_payment_date < target_payment_date THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'payroll reversal date cannot precede the payment date';
        END IF;

        SELECT COALESCE(SUM(amount), 0)::bigint
        INTO target_reversed_amount
        FROM payroll_payment_movements
        WHERE movement_type = 'reversal'
          AND reverses_movement_id = NEW.reverses_movement_id;

        IF target_reversed_amount + NEW.amount > target_amount
           OR current_paid_amount - NEW.amount < 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'payroll reversal exceeds the remaining payment amount';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION prevent_payroll_payment_movement_mutation_v302()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE'
       AND pg_trigger_depth() > 1
       AND OLD.actor_user_id IS NOT NULL
       AND NEW.actor_user_id IS NULL
       AND (TO_JSONB(OLD) - 'actor_user_id') = (TO_JSONB(NEW) - 'actor_user_id') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'payroll payment movements are append-only; create a reversal instead';
END;
$function$;

CREATE OR REPLACE FUNCTION prevent_linked_payroll_finance_update_v302()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM payroll_payment_movements
        WHERE finance_transaction_id = OLD.id
    ) OR EXISTS (
        SELECT 1
        FROM payroll_reports
        WHERE finance_transaction_id = OLD.id
           OR reversal_transaction_id = OLD.id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'finance transactions linked to payroll history are immutable; create a payroll reversal instead';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_payroll_report_legacy_finance_links_v302()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.finance_transaction_id IS NOT NULL
       AND NEW.finance_transaction_id = NEW.reversal_transaction_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'a finance transaction cannot be both a legacy payroll payment and reversal';
    END IF;

    PERFORM id
    FROM finance_transactions
    WHERE id = NEW.finance_transaction_id
       OR id = NEW.reversal_transaction_id
    ORDER BY id
    FOR UPDATE;

    IF EXISTS (
        SELECT 1
        FROM payroll_payment_movements ppm
        WHERE ppm.finance_transaction_id = NEW.finance_transaction_id
           OR ppm.finance_transaction_id = NEW.reversal_transaction_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'finance transaction is already linked to a payroll movement';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM payroll_reports pr
        WHERE pr.id IS DISTINCT FROM NEW.id
          AND (
              pr.finance_transaction_id = NEW.finance_transaction_id
              OR pr.finance_transaction_id = NEW.reversal_transaction_id
              OR pr.reversal_transaction_id = NEW.finance_transaction_id
              OR pr.reversal_transaction_id = NEW.reversal_transaction_id
          )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'finance transaction is already linked to another legacy payroll report';
    END IF;

    RETURN NEW;
END;
$function$;


DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_installment_report_v302'
          AND tgrelid = 'payroll_installments'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_installment_report_v302
        BEFORE INSERT OR UPDATE OF payroll_report_id, earning_from, earning_to
        ON payroll_installments
        FOR EACH ROW
        EXECUTE FUNCTION enforce_payroll_installment_report_v302();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_report_settlement_model_v302'
          AND tgrelid = 'payroll_reports'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_report_settlement_model_v302
        BEFORE UPDATE OF settlement_model, staff_id, period_month
        ON payroll_reports
        FOR EACH ROW
        EXECUTE FUNCTION guard_payroll_report_settlement_model_v302();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_installment_approval_v302'
          AND tgrelid = 'payroll_installments'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_installment_approval_v302
        BEFORE INSERT OR UPDATE OF workflow_status, approved_by_user_id, approved_by_username, approved_by_role
        ON payroll_installments
        FOR EACH ROW
        EXECUTE FUNCTION validate_payroll_installment_approval_v302();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_installment_lifecycle_v302'
          AND tgrelid = 'payroll_installments'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_installment_lifecycle_v302
        BEFORE UPDATE OR DELETE
        ON payroll_installments
        FOR EACH ROW
        EXECUTE FUNCTION guard_payroll_installment_lifecycle_v302();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_payment_movement_validate_v302'
          AND tgrelid = 'payroll_payment_movements'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_payment_movement_validate_v302
        BEFORE INSERT
        ON payroll_payment_movements
        FOR EACH ROW
        EXECUTE FUNCTION validate_payroll_payment_movement_v302();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_payment_movement_immutable_v302'
          AND tgrelid = 'payroll_payment_movements'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_payment_movement_immutable_v302
        BEFORE UPDATE OR DELETE
        ON payroll_payment_movements
        FOR EACH ROW
        EXECUTE FUNCTION prevent_payroll_payment_movement_mutation_v302();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_linked_finance_immutable_v302'
          AND tgrelid = 'finance_transactions'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_linked_finance_immutable_v302
        BEFORE UPDATE
        ON finance_transactions
        FOR EACH ROW
        EXECUTE FUNCTION prevent_linked_payroll_finance_update_v302();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_report_legacy_finance_links_v302'
          AND tgrelid = 'payroll_reports'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_report_legacy_finance_links_v302
        BEFORE INSERT OR UPDATE OF finance_transaction_id, reversal_transaction_id
        ON payroll_reports
        FOR EACH ROW
        EXECUTE FUNCTION guard_payroll_report_legacy_finance_links_v302();
    END IF;

END;
$migration$;

COMMENT ON COLUMN payroll_reports.settlement_model IS
    'Fail-closed settlement owner: legacy_v1 uses payroll_reports finance links; installments_v1 uses payroll_installments and append-only movements.';

COMMENT ON COLUMN payroll_reports.finance_transaction_id IS
    'Legacy salary settlement link. New installments_v1 reports must keep this column NULL.';

COMMENT ON COLUMN payroll_reports.reversal_transaction_id IS
    'Legacy salary reversal link. New installments_v1 reports must keep this column NULL.';

COMMENT ON TABLE payroll_installments IS
    'Advance/final payroll obligations. Payment totals and balances are derived from payroll_payment_movements.';

COMMENT ON TABLE payroll_payment_movements IS
    'Append-only actual payroll payment/reversal ledger linked one-to-one with finance transactions.';
