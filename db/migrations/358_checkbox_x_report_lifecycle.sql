-- MIGRATION_KIND: schema
-- SAFETY: Additive durable X-report request table; no existing data changes.
-- ROLLBACK: Leave table in place and keep X-report UI disabled, or drop only after confirming no pending requests.
CREATE TABLE IF NOT EXISTS fiscal_x_report_requests (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL,
    fiscal_location_id BIGINT NOT NULL,
    fiscal_register_id BIGINT NOT NULL,
    fiscal_shift_id BIGINT NOT NULL,
    fiscal_cashier_binding_id BIGINT NOT NULL,
    requested_by_user_id INTEGER NOT NULL REFERENCES users(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox'
        CHECK (provider = 'checkbox'),
    status VARCHAR(24) NOT NULL
        CHECK (status IN ('pending', 'submitting', 'unknown', 'succeeded', 'failed', 'cancelled')),
    idempotency_key VARCHAR(255) NOT NULL,
    provider_request_uuid UUID NOT NULL,
    provider_report_id VARCHAR(128),
    provider_shift_id VARCHAR(128) NOT NULL,
    provider_register_id VARCHAR(128) NOT NULL,
    provider_cashier_id VARCHAR(128) NOT NULL,
    provider_organization_id VARCHAR(128) NOT NULL,
    register_credential_ref VARCHAR(160) NOT NULL,
    cashier_credential_ref VARCHAR(160) NOT NULL,
    expected_is_test BOOLEAN NOT NULL,
    request_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error_code VARCHAR(120),
    last_error_message TEXT,
    external_stage VARCHAR(64) NOT NULL DEFAULT 'created',
    attempted_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_reconcile_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_x_report_register_exact
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id, fiscal_location_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id, fiscal_location_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_x_report_shift_exact
        FOREIGN KEY (fiscal_shift_id, fiscal_profile_id, fiscal_register_id)
        REFERENCES fiscal_shifts(id, fiscal_profile_id, fiscal_register_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_x_report_cashier_binding
        FOREIGN KEY (fiscal_cashier_binding_id, fiscal_profile_id, fiscal_register_id, requested_by_user_id)
        REFERENCES fiscal_cashier_bindings(id, fiscal_profile_id, fiscal_register_id, user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_x_report_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_x_report_profile_idempotency UNIQUE (fiscal_profile_id, idempotency_key),
    CONSTRAINT chk_x_report_terminal_timestamps CHECK (
        (status = 'succeeded' AND completed_at IS NOT NULL AND provider_report_id IS NOT NULL)
        OR (status <> 'succeeded')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_x_report_provider_report_id
    ON fiscal_x_report_requests (provider, provider_report_id)
    WHERE provider_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_x_report_shift_created
    ON fiscal_x_report_requests (fiscal_profile_id, fiscal_shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_x_report_reconcile
    ON fiscal_x_report_requests (status, next_reconcile_at)
    WHERE status IN ('submitting', 'unknown');

CREATE OR REPLACE FUNCTION touch_x_report_updated_at_v358()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_touch_x_report_updated_at_v358'
       AND tgrelid = 'fiscal_x_report_requests'::regclass
) THEN
CREATE TRIGGER trg_touch_x_report_updated_at_v358
    BEFORE UPDATE ON fiscal_x_report_requests
    FOR EACH ROW
    EXECUTE FUNCTION touch_x_report_updated_at_v358();
END IF;
END;
$migration$;

COMMENT ON TABLE fiscal_x_report_requests IS
    'Durable Checkbox X-report lifecycle. A row is created before provider POST; unknown outcomes are reconciled by report lookup/search, not blind replay.';
