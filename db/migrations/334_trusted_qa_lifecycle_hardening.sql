-- MIGRATION_KIND: schema
-- SAFETY: Additive trusted QA lifecycle hardening only. Existing QA runs/entities remain unchanged, raw tokens are not stored, and no production QA run, cleanup, backfill, or customer mutation is executed.
-- DATA_SCOPE: schema-only replay protection, exact constraint metadata, cleanup retry state, and audit support for trusted QA lifecycle.
-- ROLLBACK: Disable trusted QA automation first, export cleanup_pending/blocked runs, then DROP TABLE IF EXISTS trusted_qa_run_token_uses; ALTER TABLE trusted_qa_runs DROP COLUMN IF EXISTS required_operator_user_id, DROP COLUMN IF EXISTS required_user_id, DROP COLUMN IF EXISTS required_customer_id, DROP COLUMN IF EXISTS required_program_id, DROP COLUMN IF EXISTS required_product_id, DROP COLUMN IF EXISTS required_room_resource_id, DROP COLUMN IF EXISTS token_use_count, DROP COLUMN IF EXISTS cleanup_attempts, DROP COLUMN IF EXISTS cleanup_last_attempt_at, DROP COLUMN IF EXISTS next_cleanup_at, DROP COLUMN IF EXISTS cleanup_last_error, DROP COLUMN IF EXISTS cleaned_at, DROP COLUMN IF EXISTS blocked_reason;

ALTER TABLE trusted_qa_runs
    ADD COLUMN IF NOT EXISTS required_operator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS required_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS required_customer_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS required_program_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS required_product_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS required_room_resource_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS token_use_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cleanup_last_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_cleanup_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cleanup_last_error TEXT,
    ADD COLUMN IF NOT EXISTS cleaned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

CREATE TABLE IF NOT EXISTS trusted_qa_run_token_uses (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES trusted_qa_runs(id) ON DELETE CASCADE,
    request_key VARCHAR(160) NOT NULL,
    endpoint VARCHAR(260) NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_trusted_qa_run_token_use_v334
        UNIQUE (run_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_trusted_qa_runs_cleanup_v334
    ON trusted_qa_runs(state, next_cleanup_at, cleanup_attempts)
    WHERE state = 'cleanup_pending';

CREATE INDEX IF NOT EXISTS idx_trusted_qa_run_token_uses_run_v334
    ON trusted_qa_run_token_uses(run_id, consumed_at DESC);

COMMENT ON TABLE trusted_qa_run_token_uses IS
    'Replay protection for server-authorized trusted QA run tokens. Stores request idempotency keys only, never raw tokens.';
