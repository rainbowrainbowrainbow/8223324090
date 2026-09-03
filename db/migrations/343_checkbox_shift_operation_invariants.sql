-- MIGRATION_KIND: schema
-- SAFETY: Non-destructive fail-closed Checkbox ledger hardening only. It validates existing shift operation links, adds permanent one-open/one-close cardinality indexes, installs immutable semantic link guards, and replaces one narrow check constraint with the exact runtime readiness states. It does not backfill or rewrite fiscal data and does not enable Checkbox.
-- ROLLBACK: Disable Checkbox integration, verify no code depends on the v343 invariants, then drop the v343 triggers/functions/indexes/check constraints and restore the prior readiness shift-state constraint. Existing fiscal ledger rows remain unchanged.
-- OPERATOR_APPROVAL: required

-- Keep the precondition scan and invariant installation race-free. Reads remain
-- available while fiscal shift/operation writers wait for this short migration.
LOCK TABLE fiscal_shifts, fiscal_operations, checkbox_readiness_snapshots IN SHARE ROW EXCLUSIVE MODE;

-- Migration 325 introduced lifecycle_stage with a CREATED default. Any shift that
-- existed before that migration received CREATED regardless of its historical
-- status. Do not silently reinterpret or normalize those fiscal records here:
-- production must reconcile them through a separate audited operator action.
DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM fiscal_shifts
         WHERE NOT (
             (
                 (status = 'closed' AND lifecycle_stage = 'CLOSED')
                 OR (status = 'opening' AND lifecycle_stage IN ('CREATED', 'OPENING'))
                 OR (status = 'open' AND lifecycle_stage = 'OPENED')
                 OR (status = 'closing' AND lifecycle_stage = 'CLOSING')
                 OR (
                     status IN ('unknown', 'failed', 'blocked')
                     AND lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING')
                 )
             )
             AND (
                 lifecycle_stage IN ('CREATED', 'OPENING')
                 OR provider_shift_id IS NOT NULL
             )
         )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'cannot install shift operation invariants: legacy fiscal shift status/lifecycle mismatch requires audited reconciliation';
    END IF;
END;
$migration$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_fiscal_shifts_status_lifecycle_v343'
           AND conrelid = 'fiscal_shifts'::regclass
    ) THEN
        ALTER TABLE fiscal_shifts
            ADD CONSTRAINT chk_fiscal_shifts_status_lifecycle_v343
            CHECK (
                (
                    (status = 'closed' AND lifecycle_stage = 'CLOSED')
                    OR (status = 'opening' AND lifecycle_stage IN ('CREATED', 'OPENING'))
                    OR (status = 'open' AND lifecycle_stage = 'OPENED')
                    OR (status = 'closing' AND lifecycle_stage = 'CLOSING')
                    OR (
                        status IN ('unknown', 'failed', 'blocked')
                        AND lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING')
                    )
                )
                AND (
                    lifecycle_stage IN ('CREATED', 'OPENING')
                    OR provider_shift_id IS NOT NULL
                )
            );
    END IF;
END;
$migration$;

-- Runtime distinguishes a locally stale shift and an externally opened shift from
-- an unknown provider response. Migration 326 predates those fail-closed states,
-- so replace its narrower constraint before readiness snapshots can persist them.
ALTER TABLE checkbox_readiness_snapshots
    DROP CONSTRAINT IF EXISTS chk_checkbox_readiness_shift_state_v324;

ALTER TABLE checkbox_readiness_snapshots
    ADD CONSTRAINT chk_checkbox_readiness_shift_state_v343
    CHECK (
        shift_state IN (
            'closed',
            'opening',
            'open',
            'closing',
            'unknown',
            'local_stale',
            'external_open'
        )
    );

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM fiscal_operations
         WHERE operation_type IN ('shift_open', 'shift_close')
           AND (fiscal_shift_id IS NULL OR fiscal_register_id IS NULL)
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'cannot install shift operation invariants: orphan shift_open/shift_close fiscal operation exists';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM fiscal_operations operation
          LEFT JOIN fiscal_shifts shift
            ON shift.id = operation.fiscal_shift_id
           AND shift.fiscal_profile_id = operation.fiscal_profile_id
           AND shift.fiscal_register_id = operation.fiscal_register_id
         WHERE operation.operation_type IN ('shift_open', 'shift_close')
           AND shift.id IS NULL
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'cannot install shift operation invariants: shift operation profile/register scope mismatch exists';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM fiscal_operations
         WHERE operation_type IN ('shift_open', 'shift_close')
           AND fiscal_shift_id IS NOT NULL
         GROUP BY fiscal_profile_id, fiscal_shift_id, operation_type
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'cannot install shift operation invariants: duplicate shift_open/shift_close fiscal operations exist';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM fiscal_shifts
         WHERE lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING')
         GROUP BY fiscal_profile_id, fiscal_register_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'cannot install shift operation invariants: duplicate unresolved fiscal shift lifecycle exists for register';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM fiscal_shifts shift
          LEFT JOIN fiscal_operations operation
            ON operation.id = shift.open_operation_id
           AND operation.fiscal_profile_id = shift.fiscal_profile_id
           AND operation.fiscal_register_id = shift.fiscal_register_id
           AND operation.fiscal_shift_id = shift.id
           AND operation.operation_type = 'shift_open'
         WHERE shift.open_operation_id IS NOT NULL
           AND operation.id IS NULL
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'cannot install shift operation invariants: invalid fiscal shift open_operation_id exists';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM fiscal_shifts shift
          LEFT JOIN fiscal_operations operation
            ON operation.id = shift.close_operation_id
           AND operation.fiscal_profile_id = shift.fiscal_profile_id
           AND operation.fiscal_register_id = shift.fiscal_register_id
           AND operation.fiscal_shift_id = shift.id
           AND operation.operation_type = 'shift_close'
         WHERE shift.close_operation_id IS NOT NULL
           AND operation.id IS NULL
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'cannot install shift operation invariants: invalid fiscal shift close_operation_id exists';
    END IF;
END;
$migration$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_fiscal_operations_shift_operation_link_v343'
           AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT chk_fiscal_operations_shift_operation_link_v343
            CHECK (
                operation_type NOT IN ('shift_open', 'shift_close')
                OR (fiscal_shift_id IS NOT NULL AND fiscal_register_id IS NOT NULL)
            );
    END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_operations_one_shift_open_per_shift_forever_v343
    ON fiscal_operations (fiscal_profile_id, fiscal_shift_id)
    WHERE operation_type = 'shift_open'
      AND fiscal_shift_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_operations_one_shift_close_per_shift_forever_v343
    ON fiscal_operations (fiscal_profile_id, fiscal_shift_id)
    WHERE operation_type = 'shift_close'
      AND fiscal_shift_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_shifts_one_unresolved_lifecycle_per_register_v343
    ON fiscal_shifts (fiscal_profile_id, fiscal_register_id)
    WHERE lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING');

CREATE OR REPLACE FUNCTION enforce_fiscal_shift_operation_scope_v343()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (OLD.operation_type IN ('shift_open', 'shift_close')
            OR NEW.operation_type IN ('shift_open', 'shift_close'))
       AND (
            NEW.operation_type IS DISTINCT FROM OLD.operation_type
            OR NEW.fiscal_shift_id IS DISTINCT FROM OLD.fiscal_shift_id
            OR NEW.fiscal_profile_id IS DISTINCT FROM OLD.fiscal_profile_id
            OR NEW.fiscal_register_id IS DISTINCT FROM OLD.fiscal_register_id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'shift_open/shift_close operation type and shift scope are immutable';
    END IF;

    IF NEW.operation_type NOT IN ('shift_open', 'shift_close') THEN
        RETURN NEW;
    END IF;

    IF NEW.fiscal_shift_id IS NULL OR NEW.fiscal_register_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'shift_open/shift_close fiscal operation requires an exact fiscal shift and register';
    END IF;

    PERFORM 1
      FROM fiscal_shifts shift
     WHERE shift.id = NEW.fiscal_shift_id
       AND shift.fiscal_profile_id = NEW.fiscal_profile_id
       AND shift.fiscal_register_id = NEW.fiscal_register_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'shift_open/shift_close fiscal operation must match the exact shift profile and register';
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgname = 'trg_fiscal_shift_operation_scope_insert_v343'
           AND tgrelid = 'fiscal_operations'::regclass
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_shift_operation_scope_insert_v343
        BEFORE INSERT
        ON fiscal_operations
        FOR EACH ROW
        EXECUTE FUNCTION enforce_fiscal_shift_operation_scope_v343();
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgname = 'trg_fiscal_shift_operation_scope_update_v343'
           AND tgrelid = 'fiscal_operations'::regclass
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_shift_operation_scope_update_v343
        BEFORE UPDATE OF fiscal_shift_id, fiscal_profile_id, fiscal_register_id, operation_type
        ON fiscal_operations
        FOR EACH ROW
        EXECUTE FUNCTION enforce_fiscal_shift_operation_scope_v343();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_fiscal_shift_operation_link_drift_v343()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.fiscal_profile_id IS DISTINCT FROM OLD.fiscal_profile_id
           OR NEW.fiscal_register_id IS DISTINCT FROM OLD.fiscal_register_id THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'fiscal shift profile and register scope are immutable';
        END IF;

        IF OLD.open_operation_id IS NOT NULL
           AND NEW.open_operation_id IS DISTINCT FROM OLD.open_operation_id THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'fiscal shift open_operation_id is fill-only and cannot be cleared or replaced';
        END IF;

        IF OLD.close_operation_id IS NOT NULL
           AND NEW.close_operation_id IS DISTINCT FROM OLD.close_operation_id THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'fiscal shift close_operation_id is fill-only and cannot be cleared or replaced';
        END IF;
    END IF;

    IF NEW.open_operation_id IS NOT NULL THEN
        PERFORM 1
          FROM fiscal_operations operation
         WHERE operation.id = NEW.open_operation_id
           AND operation.fiscal_profile_id = NEW.fiscal_profile_id
           AND operation.fiscal_register_id = NEW.fiscal_register_id
           AND operation.fiscal_shift_id = NEW.id
           AND operation.operation_type = 'shift_open';

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'fiscal shift open_operation_id must reference its own shift_open operation';
        END IF;
    END IF;

    IF NEW.close_operation_id IS NOT NULL THEN
        PERFORM 1
          FROM fiscal_operations operation
         WHERE operation.id = NEW.close_operation_id
           AND operation.fiscal_profile_id = NEW.fiscal_profile_id
           AND operation.fiscal_register_id = NEW.fiscal_register_id
           AND operation.fiscal_shift_id = NEW.id
           AND operation.operation_type = 'shift_close';

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'fiscal shift close_operation_id must reference its own shift_close operation';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgname = 'trg_fiscal_shift_operation_link_insert_v343'
           AND tgrelid = 'fiscal_shifts'::regclass
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_shift_operation_link_insert_v343
        BEFORE INSERT
        ON fiscal_shifts
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_shift_operation_link_drift_v343();
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgname = 'trg_fiscal_shift_operation_link_drift_v343'
           AND tgrelid = 'fiscal_shifts'::regclass
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_fiscal_shift_operation_link_drift_v343
        BEFORE UPDATE OF fiscal_profile_id, fiscal_register_id, open_operation_id, close_operation_id
        ON fiscal_shifts
        FOR EACH ROW
        EXECUTE FUNCTION prevent_fiscal_shift_operation_link_drift_v343();
    END IF;
END;
$migration$;

COMMENT ON INDEX uq_fiscal_operations_one_shift_open_per_shift_forever_v343 IS
    'A fiscal shift can own at most one durable shift_open operation, regardless of operation status.';

COMMENT ON INDEX uq_fiscal_operations_one_shift_close_per_shift_forever_v343 IS
    'A fiscal shift can own at most one durable shift_close operation, regardless of operation status.';

COMMENT ON INDEX uq_fiscal_shifts_one_unresolved_lifecycle_per_register_v343 IS
    'A register can own at most one durable unresolved shift lifecycle, even when its mutable status is failed, blocked, or unknown.';

COMMENT ON TRIGGER trg_fiscal_shift_operation_link_drift_v343 ON fiscal_shifts IS
    'Open/close operation pointers are fill-only and must reference the matching operation type for this exact profile/register/shift.';

COMMENT ON TRIGGER trg_fiscal_shift_operation_link_insert_v343 ON fiscal_shifts IS
    'Non-null open/close operation pointers are validated on initial shift insertion as well as on later fill-only updates.';
