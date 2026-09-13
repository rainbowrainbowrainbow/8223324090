-- MIGRATION_KIND: schema
-- SAFETY: Additive terminal-session state for shared Checkbox test terminals. It does not change existing users, roles, fiscal bindings, payment rows, secrets, or production data.
-- ROLLBACK: Disable terminal-session endpoints, expire active sessions, export any required audit evidence, then drop cashier_terminal_sessions and its indexes.

CREATE TABLE IF NOT EXISTS cashier_terminal_sessions (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_location_id BIGINT NOT NULL,
    fiscal_register_id BIGINT NOT NULL,
    business_context VARCHAR(64) NOT NULL,
    route_option_id VARCHAR(80) NOT NULL,
    opened_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    active_cashier_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    active_cashier_binding_id BIGINT,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    session_version INTEGER NOT NULL DEFAULT 1,
    failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
    last_failed_pin_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    locked_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cashier_terminal_sessions_public_id UNIQUE (public_id),
    CONSTRAINT fk_cashier_terminal_sessions_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_cashier_terminal_sessions_location_profile
        FOREIGN KEY (fiscal_location_id, fiscal_profile_id)
        REFERENCES fiscal_locations(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_cashier_terminal_sessions_binding_profile
        FOREIGN KEY (active_cashier_binding_id, fiscal_profile_id)
        REFERENCES fiscal_cashier_bindings(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT chk_cashier_terminal_sessions_status
        CHECK (status IN ('active', 'locked', 'expired', 'revoked')),
    CONSTRAINT chk_cashier_terminal_sessions_route
        CHECK (BTRIM(route_option_id) <> '' AND route_option_id ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_cashier_terminal_sessions_business
        CHECK (BTRIM(business_context) <> '' AND business_context ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS idx_cashier_terminal_sessions_scope_v366
    ON cashier_terminal_sessions (fiscal_profile_id, fiscal_register_id, business_context, route_option_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_cashier_terminal_sessions_opener_v366
    ON cashier_terminal_sessions (opened_by_user_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_cashier_terminal_sessions_active_cashier_v366
    ON cashier_terminal_sessions (active_cashier_user_id, active_cashier_binding_id, status)
    WHERE active_cashier_user_id IS NOT NULL AND active_cashier_binding_id IS NOT NULL;

COMMENT ON TABLE cashier_terminal_sessions IS
    'Server-side shared cashier terminal state. The opener remains a CRM user; active cashier actions are separately PIN-authenticated and audited.';
