-- MIGRATION_KIND: schema
-- SAFETY: Additive fail-closed concurrency hardening for Checkbox credential refs and sealed payment item snapshots. It does not enable Checkbox, alter production mappings, or mutate business data.
-- ROLLBACK: Restore the v331/v323 function bodies only after proving there are no concurrent configuration or payment confirmation writers; removing these locks weakens safety.

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

    -- The check spans two tables, so a normal UNIQUE constraint cannot serialize it.
    -- Lock the normalized prefix before scanning so concurrent foo-bar/foo_bar writes
    -- cannot both observe an empty committed state and then resolve the same env keys.
    PERFORM pg_advisory_xact_lock(
        hashtext('checkbox_credential_env_prefix_v344'),
        hashtext(candidate_prefix)
    );

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

CREATE OR REPLACE FUNCTION prevent_payment_order_item_insert_after_seal_v323()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    order_sealed_at TIMESTAMPTZ;
    order_status TEXT;
BEGIN
    -- Serialize item insertion with confirmation/sealing of the same parent order.
    SELECT sealed_at, status
      INTO order_sealed_at, order_status
      FROM payment_orders
     WHERE id = NEW.payment_order_id
       AND fiscal_profile_id = NEW.fiscal_profile_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'payment order for fiscal item snapshot does not exist';
    END IF;

    IF order_sealed_at IS NOT NULL OR order_status <> 'draft' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'payment order item snapshots cannot be inserted after payment order sealing';
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION prevent_checkbox_credential_prefix_collision_v331() IS
'Serializes normalized Checkbox credential environment prefixes across register and cashier mappings before collision checks.';

COMMENT ON FUNCTION prevent_payment_order_item_insert_after_seal_v323() IS
'Locks the parent payment order so item insertion cannot race payment confirmation/sealing.';
