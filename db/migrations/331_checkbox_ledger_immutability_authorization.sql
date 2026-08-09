-- MIGRATION_KIND: schema
-- SAFETY: Additive Checkbox fiscal ledger hardening only. Adds fail-closed immutable guards for fiscal receipt artifacts, provider fiscal identifiers, shift operation scope, credential-ref prefix collisions, and incident lifecycle audit. It does not apply production mapping, store secrets, or mutate legacy finance/booking data.
-- ROLLBACK: Disable Checkbox integration, export fiscal ledger/audit rows if needed, then drop v331 triggers/functions/constraints/indexes after application rollback.
-- OPERATOR_APPROVAL: required

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_fiscal_cashier_bindings_capability_scope_v317'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            DROP CONSTRAINT chk_fiscal_cashier_bindings_capability_scope_v317;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_fiscal_cashier_bindings_capability_scope_v331'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            ADD CONSTRAINT chk_fiscal_cashier_bindings_capability_scope_v331
            CHECK (
                capability_scope <@ ARRAY[
                    'payments.view',
                    'payments.create',
                    'payments.confirm_received',
                    'fiscal.shift.open',
                    'fiscal.shift.close',
                    'fiscal.service_in',
                    'fiscal.service_out.request',
                    'fiscal.service_out.approve',
                    'fiscal.refund',
                    'fiscal.reconcile',
                    'fiscal.audit.view',
                    'fiscal.incident.manage',
                    'fiscal.configure'
                ]::text[]
            );
    END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_operations_id_profile_register_v331
    ON fiscal_operations (id, fiscal_profile_id, fiscal_register_id);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_fiscal_shifts_open_operation_scope_v331'
          AND conrelid = 'fiscal_shifts'::regclass
    ) THEN
        ALTER TABLE fiscal_shifts
            ADD CONSTRAINT fk_fiscal_shifts_open_operation_scope_v331
            FOREIGN KEY (open_operation_id, fiscal_profile_id, fiscal_register_id)
            REFERENCES fiscal_operations(id, fiscal_profile_id, fiscal_register_id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_fiscal_shifts_close_operation_scope_v331'
          AND conrelid = 'fiscal_shifts'::regclass
    ) THEN
        ALTER TABLE fiscal_shifts
            ADD CONSTRAINT fk_fiscal_shifts_close_operation_scope_v331
            FOREIGN KEY (close_operation_id, fiscal_profile_id, fiscal_register_id)
            REFERENCES fiscal_operations(id, fiscal_profile_id, fiscal_register_id)
            ON DELETE RESTRICT;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_fiscal_receipt_provider_artifact_drift_v331()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.provider_fiscal_code IS NOT NULL
       AND NEW.provider_fiscal_code IS DISTINCT FROM OLD.provider_fiscal_code THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'fiscal receipt provider fiscal code is immutable once assigned';
    END IF;

    IF OLD.provider_serial IS NOT NULL
       AND NEW.provider_serial IS DISTINCT FROM OLD.provider_serial THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'fiscal receipt provider serial is immutable once assigned';
    END IF;

    IF OLD.provider_tax_url IS NOT NULL
       AND NEW.provider_tax_url IS DISTINCT FROM OLD.provider_tax_url THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'trusted Checkbox tax URL is fill-only and cannot be overwritten';
    END IF;

    IF OLD.provider_pdf_url IS NOT NULL
       AND NEW.provider_pdf_url IS DISTINCT FROM OLD.provider_pdf_url THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'trusted Checkbox PDF URL is fill-only and cannot be overwritten';
    END IF;

    IF OLD.provider_qr_url IS NOT NULL
       AND NEW.provider_qr_url IS DISTINCT FROM OLD.provider_qr_url THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'trusted Checkbox QR URL is fill-only and cannot be overwritten';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_fiscal_receipt_provider_artifact_drift_v331'
          AND tgrelid = 'fiscal_receipts'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_receipt_provider_artifact_drift_v331
        BEFORE UPDATE
        ON fiscal_receipts
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_receipt_provider_artifact_drift_v331();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_fiscal_shift_provider_identity_drift_v331()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.lifecycle_stage IN ('OPENED', 'CLOSING', 'CLOSED')
       AND OLD.provider_shift_id IS NOT NULL
       AND NEW.provider_shift_id IS DISTINCT FROM OLD.provider_shift_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'fiscal shift provider id is immutable after provider OPENED';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_fiscal_shift_provider_identity_drift_v331'
          AND tgrelid = 'fiscal_shifts'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_shift_provider_identity_drift_v331
        BEFORE UPDATE
        ON fiscal_shifts
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_shift_provider_identity_drift_v331();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION checkbox_credential_env_prefix_v331(ref TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    normalized TEXT;
BEGIN
    normalized := UPPER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(ref, ''), '[^A-Za-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'));
    IF normalized = '' THEN
        RETURN NULL;
    END IF;
    RETURN 'CHECKBOX_' || normalized;
END;
$function$;

CREATE OR REPLACE FUNCTION prevent_checkbox_credential_prefix_collision_v331()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    candidate_ref TEXT;
    candidate_prefix TEXT;
    collision_ref TEXT;
BEGIN
    IF TG_TABLE_NAME = 'fiscal_registers' THEN
        candidate_ref := NEW.provider_license_ref;
    ELSIF TG_TABLE_NAME = 'fiscal_cashier_bindings' THEN
        candidate_ref := NEW.provider_cashier_login_ref;
    ELSE
        RETURN NEW;
    END IF;

    IF NULLIF(BTRIM(COALESCE(candidate_ref, '')), '') IS NULL THEN
        RETURN NEW;
    END IF;

    candidate_prefix := checkbox_credential_env_prefix_v331(candidate_ref);
    IF candidate_prefix IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Checkbox credential ref does not resolve to a safe environment prefix';
    END IF;

    SELECT existing_ref
      INTO collision_ref
      FROM (
            SELECT provider_license_ref AS existing_ref, id, 'fiscal_registers' AS source_table
              FROM fiscal_registers
             WHERE provider_license_ref IS NOT NULL
            UNION ALL
            SELECT provider_cashier_login_ref AS existing_ref, id, 'fiscal_cashier_bindings' AS source_table
              FROM fiscal_cashier_bindings
             WHERE provider_cashier_login_ref IS NOT NULL
           ) refs
     WHERE checkbox_credential_env_prefix_v331(existing_ref) = candidate_prefix
       AND existing_ref IS DISTINCT FROM candidate_ref
       AND NOT (source_table = TG_TABLE_NAME AND id = NEW.id)
     LIMIT 1;

    IF collision_ref IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'Checkbox credential refs resolve to the same CHECKBOX_<REF> environment prefix';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_fiscal_register_credential_prefix_collision_v331'
          AND tgrelid = 'fiscal_registers'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_register_credential_prefix_collision_v331
        BEFORE INSERT OR UPDATE OF provider_license_ref
        ON fiscal_registers
        FOR EACH ROW
        EXECUTE FUNCTION prevent_checkbox_credential_prefix_collision_v331();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_fiscal_cashier_binding_credential_prefix_collision_v331'
          AND tgrelid = 'fiscal_cashier_bindings'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_cashier_binding_credential_prefix_collision_v331
        BEFORE INSERT OR UPDATE OF provider_cashier_login_ref
        ON fiscal_cashier_bindings
        FOR EACH ROW
        EXECUTE FUNCTION prevent_checkbox_credential_prefix_collision_v331();
    END IF;
END;
$migration$;

COMMENT ON TRIGGER trg_fiscal_receipt_provider_artifact_drift_v331 ON fiscal_receipts IS
    'Provider fiscal code, serial, and trusted Checkbox artifact URLs are fill-only immutable fields; repeated observations must be recorded in append-only audit/reconciliation rows.';

COMMENT ON TRIGGER trg_fiscal_shift_provider_identity_drift_v331 ON fiscal_shifts IS
    'Provider shift id cannot silently change after the shift reaches provider OPENED lifecycle.';

COMMENT ON FUNCTION checkbox_credential_env_prefix_v331(TEXT) IS
    'Canonical Checkbox credential ref to CHECKBOX_<REF> environment prefix normalization used to fail closed on foo-bar/foo_bar/foo:bar collisions.';
