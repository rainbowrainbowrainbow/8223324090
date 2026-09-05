-- MIGRATION_KIND: schema
-- SAFETY: Adds a nullable, immutable reference from new payment orders to the exact fiscal cashier binding selected at order creation. Existing orders remain valid with NULL and no binding, user, register, payment or provider data is rewritten.
-- ROLLBACK: Disable catalog-sale writes first; retain the additive column by default, or drop the v349 trigger, function, foreign key, index and column only after confirming no deployed application version reads it.

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS selected_fiscal_cashier_binding_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_cashier_bindings_exact_order_scope_v349
    ON fiscal_cashier_bindings (id, fiscal_profile_id, fiscal_register_id, user_id);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'fk_payment_orders_selected_cashier_binding_v349'
           AND conrelid = 'payment_orders'::regclass
    ) THEN
        ALTER TABLE payment_orders
            ADD CONSTRAINT fk_payment_orders_selected_cashier_binding_v349
            FOREIGN KEY (
                selected_fiscal_cashier_binding_id,
                fiscal_profile_id,
                fiscal_register_id,
                cashier_user_id
            )
            REFERENCES fiscal_cashier_bindings (
                id,
                fiscal_profile_id,
                fiscal_register_id,
                user_id
            )
            ON DELETE RESTRICT;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_payment_order_selected_cashier_binding_update_v349()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.selected_fiscal_cashier_binding_id IS NOT NULL
       AND (
           NEW.selected_fiscal_cashier_binding_id IS DISTINCT FROM OLD.selected_fiscal_cashier_binding_id
           OR NEW.fiscal_profile_id IS DISTINCT FROM OLD.fiscal_profile_id
           OR NEW.fiscal_register_id IS DISTINCT FROM OLD.fiscal_register_id
           OR NEW.cashier_user_id IS DISTINCT FROM OLD.cashier_user_id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'selected fiscal cashier binding is immutable';
    END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgname = 'trg_payment_order_selected_cashier_binding_update_v349'
           AND tgrelid = 'payment_orders'::regclass
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payment_order_selected_cashier_binding_update_v349
        BEFORE UPDATE OF selected_fiscal_cashier_binding_id, fiscal_profile_id, fiscal_register_id, cashier_user_id
        ON payment_orders
        FOR EACH ROW
        EXECUTE FUNCTION prevent_payment_order_selected_cashier_binding_update_v349();
    END IF;
END;
$migration$;

COMMENT ON COLUMN payment_orders.selected_fiscal_cashier_binding_id IS
    'Exact fiscal cashier binding selected for provider fiscalization; actor identity remains created_by_user_id.';
