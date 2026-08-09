-- MIGRATION_KIND: schema
-- SAFETY: Additive Checkbox readiness/incident tables and indexes only. Existing payment, fiscal, booking, and legacy finance data is not rewritten.
-- ROLLBACK: Disable CHECKBOX_INTEGRATION_ENABLED and EVENTGENIX_CASHIER_PRO_ENABLED, export readiness/incident rows if needed, then drop v324 tables/indexes after application rollback.

CREATE TABLE IF NOT EXISTS checkbox_readiness_snapshots (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT NOT NULL,
    fiscal_location_id BIGINT,
    crm_profile_key VARCHAR(64) NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    register_credential_ref VARCHAR(160),
    cashier_credential_ref VARCHAR(160),
    fiscal_configuration_hash VARCHAR(96),
    readiness_code VARCHAR(80) NOT NULL,
    integration_ready BOOLEAN NOT NULL DEFAULT FALSE,
    local_mapping_ready BOOLEAN NOT NULL DEFAULT FALSE,
    runtime_secrets_resolvable BOOLEAN NOT NULL DEFAULT FALSE,
    provider_identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
    register_active BOOLEAN NOT NULL DEFAULT FALSE,
    cashier_ready BOOLEAN NOT NULL DEFAULT FALSE,
    signature_certificate_ready BOOLEAN NOT NULL DEFAULT FALSE,
    tax_mapping_ready BOOLEAN NOT NULL DEFAULT FALSE,
    provider_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
    stale_readiness BOOLEAN NOT NULL DEFAULT TRUE,
    shift_state VARCHAR(32) NOT NULL DEFAULT 'unknown',
    provider_organization_id VARCHAR(128),
    provider_outlet_id VARCHAR(128),
    provider_register_id VARCHAR(128),
    provider_cashier_id VARCHAR(128),
    provider_shift_id VARCHAR(128),
    expected_is_test BOOLEAN,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    latency_ms INTEGER,
    result_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_checkbox_readiness_register_profile_v324
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_checkbox_readiness_location_profile_v324
        FOREIGN KEY (fiscal_location_id, fiscal_profile_id)
        REFERENCES fiscal_locations(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_checkbox_readiness_provider_v324 CHECK (provider = 'checkbox'),
    CONSTRAINT chk_checkbox_readiness_crm_profile_v324 CHECK (crm_profile_key ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_checkbox_readiness_shift_state_v324 CHECK (shift_state IN ('closed', 'opening', 'open', 'closing', 'unknown')),
    CONSTRAINT chk_checkbox_readiness_latency_v324 CHECK (latency_ms IS NULL OR latency_ms >= 0),
    CONSTRAINT chk_checkbox_readiness_expiry_v324 CHECK (expires_at > checked_at)
);

CREATE INDEX IF NOT EXISTS idx_checkbox_readiness_scope_latest_v324
    ON checkbox_readiness_snapshots (
        fiscal_profile_id,
        fiscal_register_id,
        register_credential_ref,
        cashier_credential_ref,
        fiscal_configuration_hash,
        checked_at DESC,
        id DESC
    );

CREATE INDEX IF NOT EXISTS idx_checkbox_readiness_expiry_v324
    ON checkbox_readiness_snapshots (expires_at, integration_ready, provider_unavailable);

CREATE TABLE IF NOT EXISTS fiscal_operational_incidents (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT,
    fiscal_operation_id BIGINT,
    payment_order_id BIGINT,
    severity VARCHAR(16) NOT NULL DEFAULT 'warning',
    incident_type VARCHAR(80) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'open',
    idempotency_key VARCHAR(220) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT uq_fiscal_operational_incidents_key_v324 UNIQUE (idempotency_key),
    CONSTRAINT fk_fiscal_operational_incidents_register_v324
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_operational_incidents_operation_v324
        FOREIGN KEY (fiscal_operation_id, fiscal_profile_id)
        REFERENCES fiscal_operations(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_operational_incidents_order_v324
        FOREIGN KEY (payment_order_id, fiscal_profile_id)
        REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_operational_incidents_severity_v324 CHECK (severity IN ('info', 'warning', 'critical')),
    CONSTRAINT chk_fiscal_operational_incidents_status_v324 CHECK (status IN ('open', 'acknowledged', 'resolved')),
    CONSTRAINT chk_fiscal_operational_incidents_type_v324 CHECK (incident_type ~ '^[a-z0-9_.:-]+$')
);

CREATE INDEX IF NOT EXISTS idx_fiscal_operational_incidents_open_v324
    ON fiscal_operational_incidents (fiscal_profile_id, fiscal_register_id, status, created_at DESC)
    WHERE status <> 'resolved';

COMMENT ON TABLE checkbox_readiness_snapshots IS
    'Sanitized scoped Checkbox readiness probes with TTL. Raw secrets, tokens, PINs, and provider credentials must never be stored here.';

COMMENT ON TABLE fiscal_operational_incidents IS
    'Structured operational incidents for payment/fiscal queue, readiness, and shift health. Hermes/alert failures must not alter payment or fiscal state.';
