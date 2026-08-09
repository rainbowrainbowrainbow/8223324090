-- MIGRATION_KIND: schema
-- SAFETY: Additive Checkbox DB hardening only. Adds fail-closed immutable guards for fiscal operation provider context, fiscal receipt identity/amount, and append-only configuration audit. It does not apply production mapping, mutate business data, or store secrets.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Disable Checkbox integration, export in-flight fiscal operation/receipt/audit rows if needed, then drop v329 triggers/functions/constraints after application rollback.

CREATE OR REPLACE FUNCTION prevent_fiscal_operation_identity_drift_v329()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.provider_operation_id IS NOT NULL
       AND NEW.provider_operation_id IS DISTINCT FROM OLD.provider_operation_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'fiscal operation provider UUID is immutable once assigned';
    END IF;

    IF OLD.provider_operation_id IS NOT NULL
       OR OLD.fiscal_configuration_hash IS NOT NULL
       OR OLD.status IN ('pending', 'validating', 'ready_to_send', 'sending', 'fiscalized', 'failed', 'unknown', 'blocked') THEN
        IF NEW.fiscal_profile_id IS DISTINCT FROM OLD.fiscal_profile_id
           OR NEW.fiscal_register_id IS DISTINCT FROM OLD.fiscal_register_id
           OR NEW.fiscal_location_id IS DISTINCT FROM OLD.fiscal_location_id
           OR NEW.payment_order_id IS DISTINCT FROM OLD.payment_order_id
           OR NEW.payment_refund_id IS DISTINCT FROM OLD.payment_refund_id
           OR NEW.fiscal_shift_id IS DISTINCT FROM OLD.fiscal_shift_id
           OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
           OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
           OR NEW.provider IS DISTINCT FROM OLD.provider
           OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
           OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
           OR NEW.request_snapshot IS DISTINCT FROM OLD.request_snapshot
           OR NEW.provider_organization_id IS DISTINCT FROM OLD.provider_organization_id
           OR NEW.provider_outlet_id IS DISTINCT FROM OLD.provider_outlet_id
           OR NEW.provider_register_id IS DISTINCT FROM OLD.provider_register_id
           OR NEW.provider_cashier_id IS DISTINCT FROM OLD.provider_cashier_id
           OR NEW.register_credential_ref IS DISTINCT FROM OLD.register_credential_ref
           OR NEW.cashier_credential_ref IS DISTINCT FROM OLD.cashier_credential_ref
           OR NEW.expected_is_test IS DISTINCT FROM OLD.expected_is_test
           OR NEW.fiscal_configuration_hash IS DISTINCT FROM OLD.fiscal_configuration_hash THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'fiscal operation immutable provider context cannot be changed';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_fiscal_operation_identity_drift_v329'
          AND tgrelid = 'fiscal_operations'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_operation_identity_drift_v329
        BEFORE UPDATE
        ON fiscal_operations
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_operation_identity_drift_v329();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_fiscal_operation_delete_v329()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'fiscal operations are immutable ledger rows and cannot be deleted';
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_fiscal_operation_delete_v329'
          AND tgrelid = 'fiscal_operations'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_operation_delete_v329
        BEFORE DELETE
        ON fiscal_operations
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_operation_delete_v329();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_fiscal_receipt_identity_drift_v329()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.fiscal_profile_id IS DISTINCT FROM OLD.fiscal_profile_id
       OR NEW.fiscal_operation_id IS DISTINCT FROM OLD.fiscal_operation_id
       OR NEW.payment_order_id IS DISTINCT FROM OLD.payment_order_id
       OR NEW.payment_refund_id IS DISTINCT FROM OLD.payment_refund_id
       OR NEW.receipt_type IS DISTINCT FROM OLD.receipt_type
       OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_receipt_id IS DISTINCT FROM OLD.provider_receipt_id
       OR NEW.total_amount_minor IS DISTINCT FROM OLD.total_amount_minor
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'fiscal receipt identity, type, and amount are immutable';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_fiscal_receipt_identity_drift_v329'
          AND tgrelid = 'fiscal_receipts'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_receipt_identity_drift_v329
        BEFORE UPDATE
        ON fiscal_receipts
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_receipt_identity_drift_v329();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_fiscal_receipt_delete_v329()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'fiscal receipts are immutable ledger rows and cannot be deleted';
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_fiscal_receipt_delete_v329'
          AND tgrelid = 'fiscal_receipts'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_receipt_delete_v329
        BEFORE DELETE
        ON fiscal_receipts
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_receipt_delete_v329();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_fiscal_configuration_audit_mutation_v329()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'fiscal configuration audit is append-only';
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_fiscal_configuration_audit_append_only_v329'
          AND tgrelid = 'fiscal_configuration_audit'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_configuration_audit_append_only_v329
        BEFORE UPDATE OR DELETE
        ON fiscal_configuration_audit
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_configuration_audit_mutation_v329();
    END IF;
END;
$migration$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_configuration_audit_actor_user_v329'
          AND conrelid = 'fiscal_configuration_audit'::regclass
    ) THEN
        ALTER TABLE fiscal_configuration_audit
            ADD CONSTRAINT chk_fiscal_configuration_audit_actor_user_v329
            CHECK (actor_user_id IS NOT NULL)
            NOT VALID;
    END IF;
END;
$migration$;

COMMENT ON TRIGGER trg_fiscal_operation_identity_drift_v329 ON fiscal_operations IS
    'Prevents silent drift of provider UUID, FOP/register/cashier context, immutable payment linkage, amount, and fiscal configuration hash after a fiscal operation is pending/submitted.';

COMMENT ON TRIGGER trg_fiscal_operation_delete_v329 ON fiscal_operations IS
    'Fiscal operation ledger rows are append-only and cannot be deleted.';

COMMENT ON TRIGGER trg_fiscal_receipt_identity_drift_v329 ON fiscal_receipts IS
    'Prevents silent drift of receipt identity, type, payment/refund linkage, provider receipt id, amount, and currency.';

COMMENT ON TRIGGER trg_fiscal_receipt_delete_v329 ON fiscal_receipts IS
    'Fiscal receipt ledger rows are append-only and cannot be deleted.';

COMMENT ON TRIGGER trg_fiscal_configuration_audit_append_only_v329 ON fiscal_configuration_audit IS
    'Configuration audit history is append-only. Configuration changes must create new revisions.';
