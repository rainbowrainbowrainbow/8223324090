-- MIGRATION_KIND: schema
-- SAFETY: Additive payment/fiscal ledger foundation only. It creates new profile-scoped tables, constraints, indexes, and immutable-snapshot guards without reading from or rewriting legacy payment, booking, receipt, or cash-register tables.
-- ROLLBACK: Disable the payment/fiscal feature flag, export any new payment/fiscal ledger rows if needed, then drop the v316 triggers/functions and new v316 tables in reverse dependency order after application rollback.

CREATE TABLE IF NOT EXISTS fiscal_profiles (
    id BIGSERIAL PRIMARY KEY,
    crm_profile_key VARCHAR(64) NOT NULL,
    legal_entity_key VARCHAR(96) NOT NULL,
    legal_entity_name VARCHAR(200) NOT NULL,
    tax_identifier VARCHAR(64),
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    provider_organization_id VARCHAR(128),
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_profiles_crm_legal_entity UNIQUE (crm_profile_key, legal_entity_key),
    CONSTRAINT uq_fiscal_profiles_id_profile UNIQUE (id, crm_profile_key),
    CONSTRAINT chk_fiscal_profiles_crm_profile_key CHECK (crm_profile_key ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_profiles_legal_entity_key CHECK (legal_entity_key ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_profiles_legal_entity_name CHECK (BTRIM(legal_entity_name) <> ''),
    CONSTRAINT chk_fiscal_profiles_provider CHECK (provider IN ('checkbox')),
    CONSTRAINT chk_fiscal_profiles_currency CHECK (currency = 'UAH'),
    CONSTRAINT chk_fiscal_profiles_status CHECK (status IN ('draft', 'active', 'suspended', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_profiles_active_crm_v316
    ON fiscal_profiles (crm_profile_key)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS fiscal_locations (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    crm_profile_key VARCHAR(64) NOT NULL,
    location_alias VARCHAR(64) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    provider_outlet_id VARCHAR(128),
    address_snapshot TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_locations_profile_alias UNIQUE (fiscal_profile_id, location_alias),
    CONSTRAINT uq_fiscal_locations_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT fk_fiscal_locations_profile_context
        FOREIGN KEY (fiscal_profile_id, crm_profile_key)
        REFERENCES fiscal_profiles(id, crm_profile_key) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_locations_alias CHECK (location_alias ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_locations_display_name CHECK (BTRIM(display_name) <> ''),
    CONSTRAINT chk_fiscal_locations_status CHECK (status IN ('draft', 'active', 'suspended', 'archived'))
);

CREATE TABLE IF NOT EXISTS fiscal_registers (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_location_id BIGINT NOT NULL,
    crm_profile_key VARCHAR(64) NOT NULL,
    register_alias VARCHAR(64) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    provider_register_id VARCHAR(128),
    provider_license_ref VARCHAR(160),
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    feature_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_registers_profile_alias UNIQUE (fiscal_profile_id, register_alias),
    CONSTRAINT uq_fiscal_registers_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT fk_fiscal_registers_profile_context
        FOREIGN KEY (fiscal_profile_id, crm_profile_key)
        REFERENCES fiscal_profiles(id, crm_profile_key) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_registers_location_profile
        FOREIGN KEY (fiscal_location_id, fiscal_profile_id)
        REFERENCES fiscal_locations(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_registers_alias CHECK (register_alias ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_registers_display_name CHECK (BTRIM(display_name) <> ''),
    CONSTRAINT chk_fiscal_registers_provider CHECK (provider IN ('checkbox')),
    CONSTRAINT chk_fiscal_registers_status CHECK (status IN ('draft', 'active', 'suspended', 'archived')),
    CONSTRAINT chk_fiscal_registers_feature_requires_active CHECK (feature_enabled = FALSE OR status = 'active')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_registers_provider_register_v316
    ON fiscal_registers (provider, provider_register_id)
    WHERE provider_register_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fiscal_cashier_bindings (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    provider_cashier_id VARCHAR(128),
    provider_cashier_login_ref VARCHAR(160),
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_cashier_bindings_user_register UNIQUE (fiscal_profile_id, fiscal_register_id, user_id),
    CONSTRAINT uq_fiscal_cashier_bindings_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT fk_fiscal_cashier_bindings_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_cashier_bindings_provider CHECK (provider IN ('checkbox')),
    CONSTRAINT chk_fiscal_cashier_bindings_status CHECK (status IN ('draft', 'active', 'suspended', 'archived'))
);

CREATE TABLE IF NOT EXISTS payment_orders (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT NOT NULL,
    cashier_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    source_type VARCHAR(40) NOT NULL,
    source_id VARCHAR(120) NOT NULL,
    order_key VARCHAR(160) NOT NULL,
    idempotency_key VARCHAR(160) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'draft',
    payment_status VARCHAR(40) NOT NULL DEFAULT 'unpaid',
    fiscal_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    payment_method VARCHAR(32) NOT NULL,
    total_amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    confirmation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_orders_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_payment_orders_idempotency UNIQUE (idempotency_key),
    CONSTRAINT uq_payment_orders_profile_order_key UNIQUE (fiscal_profile_id, order_key),
    CONSTRAINT fk_payment_orders_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_payment_orders_source_type CHECK (source_type ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_payment_orders_source_id CHECK (BTRIM(source_id) <> ''),
    CONSTRAINT chk_payment_orders_order_key CHECK (BTRIM(order_key) <> ''),
    CONSTRAINT chk_payment_orders_idempotency CHECK (BTRIM(idempotency_key) <> ''),
    CONSTRAINT chk_payment_orders_status CHECK (status IN (
        'draft', 'confirmed', 'payment_recorded', 'cancelled',
        'cancelled_before_fiscalization', 'refund_pending', 'refunded',
        'refund_failed', 'refund_cancelled'
    )),
    CONSTRAINT chk_payment_orders_payment_status CHECK (payment_status IN (
        'unpaid', 'pending', 'confirmed', 'recorded', 'refunded', 'failed', 'unknown'
    )),
    CONSTRAINT chk_payment_orders_fiscal_status CHECK (fiscal_status IN (
        'not_required', 'pending', 'validating', 'ready_to_send', 'sending',
        'fiscalized', 'validation_failed', 'failed', 'unknown', 'blocked'
    )),
    CONSTRAINT chk_payment_orders_method CHECK (payment_method IN ('cash', 'card_terminal')),
    CONSTRAINT chk_payment_orders_amount CHECK (total_amount_minor > 0),
    CONSTRAINT chk_payment_orders_currency CHECK (currency = 'UAH')
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_profile_status_v316
    ON payment_orders (fiscal_profile_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_payment_orders_profile_source_v316
    ON payment_orders (fiscal_profile_id, source_type, source_id, id);

CREATE TABLE IF NOT EXISTS payment_order_items (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    payment_order_id BIGINT NOT NULL,
    line_number INTEGER NOT NULL,
    item_type VARCHAR(40) NOT NULL,
    item_code VARCHAR(96),
    item_name VARCHAR(240) NOT NULL,
    unit_price_minor BIGINT NOT NULL,
    quantity_millis BIGINT NOT NULL DEFAULT 1000,
    total_amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    tax_reference VARCHAR(128),
    tax_code INTEGER,
    tax_rate_bps INTEGER,
    provider_tax_id VARCHAR(128),
    item_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_order_items_order_line UNIQUE (payment_order_id, line_number),
    CONSTRAINT uq_payment_order_items_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT fk_payment_order_items_order_profile
        FOREIGN KEY (payment_order_id, fiscal_profile_id)
        REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_payment_order_items_line CHECK (line_number > 0),
    CONSTRAINT chk_payment_order_items_type CHECK (item_type ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_payment_order_items_name CHECK (BTRIM(item_name) <> ''),
    CONSTRAINT chk_payment_order_items_amounts CHECK (
        unit_price_minor >= 0
        AND quantity_millis > 0
        AND total_amount_minor >= 0
    ),
    CONSTRAINT chk_payment_order_items_currency CHECK (currency = 'UAH'),
    CONSTRAINT chk_payment_order_items_tax_rate CHECK (tax_rate_bps IS NULL OR tax_rate_bps BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_payment_order_items_profile_order_v316
    ON payment_order_items (fiscal_profile_id, payment_order_id, line_number);

CREATE TABLE IF NOT EXISTS payment_allocations (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    payment_order_id BIGINT NOT NULL,
    payment_method VARCHAR(32) NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    status VARCHAR(32) NOT NULL DEFAULT 'recorded',
    allocation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_allocations_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_payment_allocations_one_per_order UNIQUE (payment_order_id),
    CONSTRAINT fk_payment_allocations_order_profile
        FOREIGN KEY (payment_order_id, fiscal_profile_id)
        REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_payment_allocations_method CHECK (payment_method IN ('cash', 'card_terminal')),
    CONSTRAINT chk_payment_allocations_amount CHECK (amount_minor > 0),
    CONSTRAINT chk_payment_allocations_currency CHECK (currency = 'UAH'),
    CONSTRAINT chk_payment_allocations_status CHECK (status IN ('recorded', 'voided', 'refunded'))
);

CREATE TABLE IF NOT EXISTS payment_attempts (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    payment_order_id BIGINT NOT NULL,
    attempt_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(160) NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'manual',
    provider_payment_reference VARCHAR(160),
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    request_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_payment_attempts_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_payment_attempts_idempotency UNIQUE (idempotency_key),
    CONSTRAINT fk_payment_attempts_order_profile
        FOREIGN KEY (payment_order_id, fiscal_profile_id)
        REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_payment_attempts_type CHECK (attempt_type IN ('cash_confirmation', 'card_terminal_confirmation')),
    CONSTRAINT chk_payment_attempts_status CHECK (status IN ('pending', 'confirmed', 'failed', 'cancelled', 'unknown')),
    CONSTRAINT chk_payment_attempts_provider CHECK (provider IN ('manual', 'terminal')),
    CONSTRAINT chk_payment_attempts_amount CHECK (amount_minor > 0),
    CONSTRAINT chk_payment_attempts_currency CHECK (currency = 'UAH')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_provider_ref_v316
    ON payment_attempts (provider, provider_payment_reference)
    WHERE provider_payment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS fiscal_shifts (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    provider_shift_id VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'unknown',
    opened_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    closed_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    provider_opened_at TIMESTAMPTZ,
    provider_closed_at TIMESTAMPTZ,
    open_operation_id BIGINT,
    close_operation_id BIGINT,
    provider_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_shifts_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT fk_fiscal_shifts_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_shifts_provider CHECK (provider IN ('checkbox')),
    CONSTRAINT chk_fiscal_shifts_status CHECK (status IN ('unknown', 'opening', 'open', 'closing', 'closed', 'failed', 'blocked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_shifts_provider_shift_v316
    ON fiscal_shifts (provider, provider_shift_id)
    WHERE provider_shift_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_shifts_one_open_register_v316
    ON fiscal_shifts (fiscal_profile_id, fiscal_register_id)
    WHERE status IN ('opening', 'open', 'closing');

CREATE TABLE IF NOT EXISTS payment_refunds (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    payment_order_id BIGINT NOT NULL,
    original_fiscal_receipt_id BIGINT,
    fiscal_return_receipt_id BIGINT,
    idempotency_key VARCHAR(160) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'requested',
    refund_method VARCHAR(32) NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    reason TEXT NOT NULL,
    requested_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    approved_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    refund_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_payment_refunds_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_payment_refunds_idempotency UNIQUE (idempotency_key),
    CONSTRAINT fk_payment_refunds_order_profile
        FOREIGN KEY (payment_order_id, fiscal_profile_id)
        REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_payment_refunds_status CHECK (status IN (
        'requested', 'approved', 'money_refund_pending', 'money_refunded',
        'fiscal_return_pending', 'fiscal_returned', 'money_refund_failed',
        'money_refund_unknown', 'fiscal_return_failed', 'fiscal_return_unknown',
        'cancelled'
    )),
    CONSTRAINT chk_payment_refunds_method CHECK (refund_method IN ('cash', 'card_terminal')),
    CONSTRAINT chk_payment_refunds_amount CHECK (amount_minor > 0),
    CONSTRAINT chk_payment_refunds_currency CHECK (currency = 'UAH'),
    CONSTRAINT chk_payment_refunds_reason CHECK (BTRIM(reason) <> '')
);

CREATE TABLE IF NOT EXISTS fiscal_operations (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT,
    payment_order_id BIGINT,
    payment_refund_id BIGINT,
    fiscal_shift_id BIGINT,
    operation_type VARCHAR(40) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(160) NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    provider_operation_id VARCHAR(160),
    provider_status VARCHAR(80),
    amount_minor BIGINT,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    request_fingerprint VARCHAR(128),
    request_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error_code VARCHAR(80),
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_status_check_at TIMESTAMPTZ,
    CONSTRAINT uq_fiscal_operations_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_fiscal_operations_idempotency UNIQUE (idempotency_key),
    CONSTRAINT fk_fiscal_operations_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_operations_order_profile
        FOREIGN KEY (payment_order_id, fiscal_profile_id)
        REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_operations_refund_profile
        FOREIGN KEY (payment_refund_id, fiscal_profile_id)
        REFERENCES payment_refunds(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_operations_shift_profile
        FOREIGN KEY (fiscal_shift_id, fiscal_profile_id)
        REFERENCES fiscal_shifts(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_operations_type CHECK (operation_type IN (
        'sale', 'return', 'service_in', 'service_out',
        'shift_open', 'shift_close', 'status_lookup'
    )),
    CONSTRAINT chk_fiscal_operations_status CHECK (status IN (
        'not_required', 'pending', 'validating', 'ready_to_send', 'sending',
        'fiscalized', 'validation_failed', 'failed', 'unknown', 'blocked',
        'cancelled'
    )),
    CONSTRAINT chk_fiscal_operations_provider CHECK (provider IN ('checkbox')),
    CONSTRAINT chk_fiscal_operations_amount CHECK (amount_minor IS NULL OR amount_minor >= 0),
    CONSTRAINT chk_fiscal_operations_currency CHECK (currency = 'UAH')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_operations_provider_operation_v316
    ON fiscal_operations (provider, provider_operation_id)
    WHERE provider_operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_operations_profile_status_v316
    ON fiscal_operations (fiscal_profile_id, status, created_at DESC, id);

CREATE TABLE IF NOT EXISTS fiscal_receipts (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_operation_id BIGINT NOT NULL,
    payment_order_id BIGINT,
    payment_refund_id BIGINT,
    receipt_type VARCHAR(32) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'pending',
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    provider_receipt_id VARCHAR(160) NOT NULL,
    provider_fiscal_code VARCHAR(160),
    provider_serial VARCHAR(160),
    provider_tax_url TEXT,
    provider_pdf_url TEXT,
    provider_qr_url TEXT,
    total_amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    fiscalized_at TIMESTAMPTZ,
    provider_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_receipts_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_fiscal_receipts_provider_receipt UNIQUE (provider, provider_receipt_id),
    CONSTRAINT fk_fiscal_receipts_operation_profile
        FOREIGN KEY (fiscal_operation_id, fiscal_profile_id)
        REFERENCES fiscal_operations(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_receipts_order_profile
        FOREIGN KEY (payment_order_id, fiscal_profile_id)
        REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_receipts_refund_profile
        FOREIGN KEY (payment_refund_id, fiscal_profile_id)
        REFERENCES payment_refunds(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_receipts_type CHECK (receipt_type IN ('sale', 'return', 'service_in', 'service_out')),
    CONSTRAINT chk_fiscal_receipts_status CHECK (status IN ('pending', 'fiscalized', 'failed', 'unknown', 'voided')),
    CONSTRAINT chk_fiscal_receipts_provider CHECK (provider IN ('checkbox')),
    CONSTRAINT chk_fiscal_receipts_amount CHECK (total_amount_minor >= 0),
    CONSTRAINT chk_fiscal_receipts_currency CHECK (currency = 'UAH')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_receipts_provider_fiscal_code_v316
    ON fiscal_receipts (provider, provider_fiscal_code)
    WHERE provider_fiscal_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_profile_order_v316
    ON fiscal_receipts (fiscal_profile_id, payment_order_id, created_at DESC)
    WHERE payment_order_id IS NOT NULL;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_payment_refunds_original_receipt_profile_v316'
          AND conrelid = 'payment_refunds'::regclass
    ) THEN
        ALTER TABLE payment_refunds
            ADD CONSTRAINT fk_payment_refunds_original_receipt_profile_v316
            FOREIGN KEY (original_fiscal_receipt_id, fiscal_profile_id)
            REFERENCES fiscal_receipts(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_payment_refunds_return_receipt_profile_v316'
          AND conrelid = 'payment_refunds'::regclass
    ) THEN
        ALTER TABLE payment_refunds
            ADD CONSTRAINT fk_payment_refunds_return_receipt_profile_v316
            FOREIGN KEY (fiscal_return_receipt_id, fiscal_profile_id)
            REFERENCES fiscal_receipts(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS fiscal_action_approvals (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT,
    action_type VARCHAR(40) NOT NULL,
    target_table VARCHAR(80) NOT NULL,
    target_id BIGINT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'approved',
    requested_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    approved_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approval_hash VARCHAR(160),
    approval_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT uq_fiscal_action_approvals_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT fk_fiscal_action_approvals_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_action_approvals_type CHECK (action_type IN (
        'service_in', 'service_out', 'refund', 'reconciliation_difference', 'shift_close'
    )),
    CONSTRAINT chk_fiscal_action_approvals_target CHECK (target_table ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_action_approvals_status CHECK (status IN ('approved', 'consumed', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_fiscal_action_approvals_target_v316
    ON fiscal_action_approvals (fiscal_profile_id, target_table, target_id, status);

CREATE TABLE IF NOT EXISTS fiscal_reconciliations (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT NOT NULL,
    fiscal_shift_id BIGINT,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    expected_cash_minor BIGINT NOT NULL DEFAULT 0,
    actual_cash_minor BIGINT NOT NULL DEFAULT 0,
    difference_minor BIGINT NOT NULL DEFAULT 0,
    currency CHAR(3) NOT NULL DEFAULT 'UAH',
    reason TEXT,
    approved_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    reconciliation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    CONSTRAINT uq_fiscal_reconciliations_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_fiscal_reconciliations_shift UNIQUE (fiscal_profile_id, fiscal_shift_id),
    CONSTRAINT fk_fiscal_reconciliations_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_reconciliations_shift_profile
        FOREIGN KEY (fiscal_shift_id, fiscal_profile_id)
        REFERENCES fiscal_shifts(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_reconciliations_status CHECK (status IN ('draft', 'balanced', 'difference_pending', 'approved', 'closed', 'blocked')),
    CONSTRAINT chk_fiscal_reconciliations_currency CHECK (currency = 'UAH')
);

CREATE TABLE IF NOT EXISTS provider_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    provider_event_id VARCHAR(160),
    delivery_id VARCHAR(160),
    event_type VARCHAR(80) NOT NULL,
    related_provider_operation_id VARCHAR(160),
    related_provider_receipt_id VARCHAR(160),
    webhook_signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
    payload_sha256 VARCHAR(128) NOT NULL,
    sanitized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'received',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT uq_provider_webhook_events_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_provider_webhook_events_payload UNIQUE (provider, payload_sha256),
    CONSTRAINT chk_provider_webhook_events_provider CHECK (provider IN ('checkbox')),
    CONSTRAINT chk_provider_webhook_events_type CHECK (BTRIM(event_type) <> ''),
    CONSTRAINT chk_provider_webhook_events_status CHECK (status IN ('received', 'processed', 'ignored', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_webhook_events_provider_event_v316
    ON provider_webhook_events (provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_webhook_events_delivery_v316
    ON provider_webhook_events (provider, delivery_id)
    WHERE delivery_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_outbox_jobs (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_operation_id BIGINT,
    payment_order_id BIGINT,
    payment_refund_id BIGINT,
    job_type VARCHAR(40) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    idempotency_key VARCHAR(160) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(120),
    last_error_code VARCHAR(80),
    last_error_message TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_outbox_jobs_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_payment_outbox_jobs_idempotency UNIQUE (idempotency_key),
    CONSTRAINT fk_payment_outbox_jobs_operation_profile
        FOREIGN KEY (fiscal_operation_id, fiscal_profile_id)
        REFERENCES fiscal_operations(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_payment_outbox_jobs_order_profile
        FOREIGN KEY (payment_order_id, fiscal_profile_id)
        REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_payment_outbox_jobs_refund_profile
        FOREIGN KEY (payment_refund_id, fiscal_profile_id)
        REFERENCES payment_refunds(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_payment_outbox_jobs_type CHECK (job_type IN (
        'receipt_validate', 'receipt_sell', 'receipt_status_lookup',
        'receipt_return', 'service_receipt', 'shift_open', 'shift_close',
        'webhook_process'
    )),
    CONSTRAINT chk_payment_outbox_jobs_status CHECK (status IN ('queued', 'claimed', 'running', 'succeeded', 'failed', 'dead')),
    CONSTRAINT chk_payment_outbox_jobs_attempts CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts)
);

CREATE INDEX IF NOT EXISTS idx_payment_outbox_jobs_claim_v316
    ON payment_outbox_jobs (status, next_run_at, priority, id)
    WHERE status IN ('queued', 'failed');

CREATE TABLE IF NOT EXISTS fiscal_audit_events (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    event_type VARCHAR(80) NOT NULL,
    entity_table VARCHAR(80) NOT NULL,
    entity_id BIGINT,
    request_id VARCHAR(120),
    idempotency_key VARCHAR(160),
    before_snapshot JSONB,
    after_snapshot JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_audit_events_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT chk_fiscal_audit_events_type CHECK (BTRIM(event_type) <> ''),
    CONSTRAINT chk_fiscal_audit_events_entity CHECK (entity_table ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS idx_fiscal_audit_events_entity_v316
    ON fiscal_audit_events (fiscal_profile_id, entity_table, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_payment_order_identity_update_v316()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.fiscal_profile_id IS DISTINCT FROM OLD.fiscal_profile_id
       OR NEW.fiscal_register_id IS DISTINCT FROM OLD.fiscal_register_id
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.order_key IS DISTINCT FROM OLD.order_key
       OR NEW.total_amount_minor IS DISTINCT FROM OLD.total_amount_minor
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'payment order fiscal identity and amount snapshot are immutable';
    END IF;

    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_payment_order_identity_update_v316'
          AND tgrelid = 'payment_orders'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payment_order_identity_update_v316
        BEFORE UPDATE OF fiscal_profile_id, fiscal_register_id, source_type, source_id,
            order_key, total_amount_minor, currency, payment_method, updated_at
        ON payment_orders
        FOR EACH ROW
        EXECUTE FUNCTION prevent_payment_order_identity_update_v316();
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION prevent_payment_order_item_mutation_v316()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'payment order item snapshots are immutable';
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_payment_order_item_mutation_v316'
          AND tgrelid = 'payment_order_items'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_payment_order_item_mutation_v316
        BEFORE UPDATE OR DELETE
        ON payment_order_items
        FOR EACH ROW
        EXECUTE FUNCTION prevent_payment_order_item_mutation_v316();
    END IF;
END;
$migration$;

COMMENT ON TABLE fiscal_profiles IS
    'Fiscal profile scoped to one CRM profile and one legal entity/FOP. Secrets are not stored here.';

COMMENT ON TABLE payment_orders IS
    'Additive payment ledger source of truth for confirmed payment and fiscal workflows. Legacy financial tables are not source-of-truth for this ledger.';

COMMENT ON TABLE payment_order_items IS
    'Immutable payment item snapshots with integer minor-unit amounts and tax references.';

COMMENT ON TABLE fiscal_operations IS
    'Provider operation ledger for Checkbox fiscal work with durable idempotency and provider operation IDs.';

COMMENT ON TABLE fiscal_receipts IS
    'Fiscal receipt records received from Checkbox. Internal EventGenix RCP receipts are not fiscal receipts.';

COMMENT ON TABLE provider_webhook_events IS
    'Deduplicated Checkbox webhook event audit with sanitized payloads and signature verification result.';
