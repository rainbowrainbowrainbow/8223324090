-- MIGRATION_KIND: schema
-- SAFETY: Additive integration idempotency key store for external mutation retries. No existing data is modified.
-- ROLLBACK: Export required retry records, then DROP INDEX IF EXISTS idx_integration_idempotency_expires_at, idx_integration_idempotency_unique_key; DROP TABLE IF EXISTS integration_idempotency_keys if no in-flight integration retries depend on stored responses.

CREATE TABLE IF NOT EXISTS integration_idempotency_keys (
    id               BIGSERIAL PRIMARY KEY,
    integration_id   VARCHAR(120) NOT NULL,
    idempotency_key  VARCHAR(255) NOT NULL,
    request_hash     CHAR(64) NOT NULL,
    response_status  INTEGER,
    response_body    JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
    CONSTRAINT integration_idempotency_integration_id_check
        CHECK (NULLIF(BTRIM(integration_id), '') IS NOT NULL),
    CONSTRAINT integration_idempotency_key_check
        CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL),
    CONSTRAINT integration_idempotency_request_hash_check
        CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT integration_idempotency_response_status_check
        CHECK (response_status IS NULL OR (response_status >= 100 AND response_status <= 599)),
    CONSTRAINT integration_idempotency_expires_after_created_check
        CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_idempotency_unique_key
    ON integration_idempotency_keys(integration_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_integration_idempotency_expires_at
    ON integration_idempotency_keys(expires_at);
