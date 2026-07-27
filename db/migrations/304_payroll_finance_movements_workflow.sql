-- MIGRATION_KIND: schema
-- SAFETY: Additive finance metadata and guards for payroll-linked payment movements. Existing finance/payroll data is not rewritten; NOT VALID constraints avoid destructive historical validation while enforcing new writes.
-- ROLLBACK: Disable payroll payment confirmation in the app, export any payroll-linked finance rows that need investigation, then drop the v304 constraints/indexes/trigger/function and recognition_date column if the feature is reverted.
-- OPERATOR_APPROVAL: required

ALTER TABLE finance_transactions
    ADD COLUMN IF NOT EXISTS recognition_date DATE;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_finance_transactions_payroll_source_required_v304'
          AND conrelid = 'finance_transactions'::regclass
    ) THEN
        ALTER TABLE finance_transactions
            ADD CONSTRAINT chk_finance_transactions_payroll_source_required_v304
            CHECK (
                COALESCE(source, 'manual') <> 'payroll'
                OR (
                    type IN ('income', 'expense')
                    AND category_id IS NOT NULL
                    AND account_id IS NOT NULL
                    AND NULLIF(BTRIM(COALESCE(business_context, '')), '') IS NOT NULL
                    AND NULLIF(BTRIM(COALESCE(payment_method, '')), '') IS NOT NULL
                    AND payment_method NOT IN ('salary', 'salary_reversal')
                    AND recognition_date IS NOT NULL
                )
            ) NOT VALID;
    END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS idx_finance_transactions_recognition_date_v304
    ON finance_transactions(recognition_date, id)
    WHERE recognition_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_transactions_payroll_source_v304
    ON finance_transactions(business_context, recognition_date, date, id)
    WHERE source = 'payroll';

CREATE OR REPLACE FUNCTION validate_payroll_movement_recognition_month_v304()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    finance_recognition_date DATE;
    earning_month VARCHAR(7);
BEGIN
    SELECT ft.recognition_date, pr.period_month
    INTO finance_recognition_date, earning_month
    FROM finance_transactions ft
    JOIN payroll_installments pi ON pi.id = NEW.installment_id
    JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
    WHERE ft.id = NEW.finance_transaction_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'payroll movement recognition source does not exist';
    END IF;

    IF finance_recognition_date IS NULL
       OR TO_CHAR(finance_recognition_date, 'YYYY-MM') IS DISTINCT FROM earning_month THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'payroll finance recognition month must match the payroll earning month';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_movement_recognition_month_v304'
          AND tgrelid = 'payroll_payment_movements'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_movement_recognition_month_v304
        BEFORE INSERT OR UPDATE OF finance_transaction_id, installment_id
        ON payroll_payment_movements
        FOR EACH ROW
        EXECUTE FUNCTION validate_payroll_movement_recognition_month_v304();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_linked_payroll_finance_delete_v304()
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

    RETURN OLD;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_payroll_linked_finance_delete_v304'
          AND tgrelid = 'finance_transactions'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payroll_linked_finance_delete_v304
        BEFORE DELETE
        ON finance_transactions
        FOR EACH ROW
        EXECUTE FUNCTION prevent_linked_payroll_finance_delete_v304();
    END IF;
END;
$migration$;

COMMENT ON COLUMN finance_transactions.recognition_date IS
    'Accounting/P&L recognition date. Payroll payments use the earning month here while cash flow keeps finance_transactions.date as actual payment date.';
