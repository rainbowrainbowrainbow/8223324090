-- MIGRATION_KIND: schema
-- SAFETY: Adds explicit logical fiscal-sale routes over existing physical registers, logical business ownership for fiscal item mappings and payment orders, and fail-closed per-route gates. Existing fiscal/provider rows and ledger history are not rewritten; all new route gates default to false.
-- ROLLBACK: Disable global and per-register acceptance first. Retain the additive objects by default; after every deployed application version stops reading them, drop the v351 trigger/function/FKs, payment-order and mapping columns, then fiscal_sale_routes. Do not delete physical registers or ledger rows.
-- DATA_SCOPE: Schema-only. No fiscal profile, register, cashier, mapping, order, provider identity, credential reference, customer, or payment row is inserted or changed.

CREATE TABLE IF NOT EXISTS fiscal_sale_routes (
    route_option_id VARCHAR(64) PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    fiscal_profile_id BIGINT NOT NULL,
    fiscal_location_id BIGINT NOT NULL,
    fiscal_register_id BIGINT NOT NULL,
    mode VARCHAR(16) NOT NULL,
    expected_is_test BOOLEAN NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    feature_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    acceptance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    shared_register_group VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_sale_routes_business_mode_v351 UNIQUE (business_context, mode),
    CONSTRAINT uq_fiscal_sale_routes_order_scope_v351 UNIQUE (
        route_option_id,
        business_context,
        fiscal_profile_id,
        fiscal_register_id
    ),
    CONSTRAINT fk_fiscal_sale_routes_register_v351
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id, fiscal_location_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id, fiscal_location_id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_sale_routes_option_v351
        CHECK (route_option_id ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_sale_routes_business_v351
        CHECK (business_context IN ('event_genix', 'dar')),
    CONSTRAINT chk_fiscal_sale_routes_mode_v351
        CHECK (mode IN ('test', 'production')),
    CONSTRAINT chk_fiscal_sale_routes_mode_identity_v351
        CHECK ((mode = 'test') = expected_is_test),
    CONSTRAINT chk_fiscal_sale_routes_status_v351
        CHECK (status IN ('draft', 'active', 'suspended', 'archived')),
    CONSTRAINT chk_fiscal_sale_routes_feature_v351
        CHECK (feature_enabled = FALSE OR status = 'active'),
    CONSTRAINT chk_fiscal_sale_routes_acceptance_v351
        CHECK (acceptance_enabled = FALSE OR (feature_enabled = TRUE AND status = 'active')),
    CONSTRAINT chk_fiscal_sale_routes_shared_group_v351
        CHECK (
            (mode = 'production' AND shared_register_group IS NULL)
            OR
            (mode = 'test' AND shared_register_group ~ '^[a-z0-9_]+$')
        )
);

CREATE INDEX IF NOT EXISTS idx_fiscal_sale_routes_register_v351
    ON fiscal_sale_routes (fiscal_profile_id, fiscal_register_id, status, route_option_id);

ALTER TABLE fiscal_item_mappings
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64);

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS fiscal_sale_route_option_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_fiscal_item_mappings_business_v351'
           AND conrelid = 'fiscal_item_mappings'::regclass
    ) THEN
        ALTER TABLE fiscal_item_mappings
            ADD CONSTRAINT chk_fiscal_item_mappings_business_v351
            CHECK (business_context IS NULL OR business_context IN ('event_genix', 'dar'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_payment_orders_business_v351'
           AND conrelid = 'payment_orders'::regclass
    ) THEN
        ALTER TABLE payment_orders
            ADD CONSTRAINT chk_payment_orders_business_v351
            CHECK (business_context IS NULL OR business_context IN ('event_genix', 'dar'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_payment_orders_route_pair_v351'
           AND conrelid = 'payment_orders'::regclass
    ) THEN
        ALTER TABLE payment_orders
            ADD CONSTRAINT chk_payment_orders_route_pair_v351
            CHECK (
                (fiscal_sale_route_option_id IS NULL AND business_context IS NULL)
                OR
                (fiscal_sale_route_option_id IS NOT NULL AND business_context IS NOT NULL)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_payment_orders_fiscal_sale_route_v351'
           AND conrelid = 'payment_orders'::regclass
    ) THEN
        ALTER TABLE payment_orders
            ADD CONSTRAINT fk_payment_orders_fiscal_sale_route_v351
            FOREIGN KEY (
                fiscal_sale_route_option_id,
                business_context,
                fiscal_profile_id,
                fiscal_register_id
            )
            REFERENCES fiscal_sale_routes (
                route_option_id,
                business_context,
                fiscal_profile_id,
                fiscal_register_id
            )
            ON DELETE RESTRICT;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_payment_order_fiscal_sale_route_update_v351()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.fiscal_sale_route_option_id IS NOT NULL
       AND (
           NEW.fiscal_sale_route_option_id IS DISTINCT FROM OLD.fiscal_sale_route_option_id
           OR NEW.business_context IS DISTINCT FROM OLD.business_context
           OR NEW.fiscal_profile_id IS DISTINCT FROM OLD.fiscal_profile_id
           OR NEW.fiscal_register_id IS DISTINCT FROM OLD.fiscal_register_id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'payment order fiscal sale route is immutable';
    END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgname = 'trg_payment_order_fiscal_sale_route_update_v351'
           AND tgrelid = 'payment_orders'::regclass
           AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payment_order_fiscal_sale_route_update_v351
        BEFORE UPDATE OF fiscal_sale_route_option_id, business_context, fiscal_profile_id, fiscal_register_id
        ON payment_orders
        FOR EACH ROW
        EXECUTE FUNCTION prevent_payment_order_fiscal_sale_route_update_v351();
    END IF;
END;
$migration$;

COMMENT ON TABLE fiscal_sale_routes IS
    'Logical PARK/DAR sale routes. Multiple test routes may point to one physical Checkbox register while keeping independent business ownership and fail-closed gates.';

COMMENT ON COLUMN fiscal_item_mappings.business_context IS
    'Logical catalog owner. NULL preserves legacy mappings and falls back to crm_profile_key.';

COMMENT ON COLUMN payment_orders.fiscal_sale_route_option_id IS
    'Immutable logical route selected before order creation; provider register identity remains the referenced physical fiscal_register_id.';

COMMENT ON COLUMN payment_orders.business_context IS
    'Immutable logical PARK/DAR owner for route-scoped history and shared test-register recovery.';
