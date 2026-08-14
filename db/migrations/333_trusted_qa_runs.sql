-- MIGRATION_KIND: schema
-- SAFETY: Adds trusted QA run registry and exact entity manifest tables only. Stores token hashes, not raw tokens. Does not start QA runs, suppress live side effects by itself, or mutate existing production data.
-- DATA_SCOPE: schema-only trusted QA registry and manifest tables; no existing production rows are read or mutated.
-- ROLLBACK: Disable QA smoke automation first, export active cleanup_pending runs, then DROP TABLE IF EXISTS trusted_qa_run_entities; DROP TABLE IF EXISTS trusted_qa_runs.

CREATE TABLE IF NOT EXISTS trusted_qa_runs (
    id BIGSERIAL PRIMARY KEY,
    run_id VARCHAR(100) NOT NULL UNIQUE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    source VARCHAR(100) NOT NULL,
    business_context VARCHAR(100) NOT NULL DEFAULT 'event_genix',
    operator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    test_customer_marker VARCHAR(200) NOT NULL,
    allowed_endpoints JSONB NOT NULL DEFAULT '[]'::jsonb,
    max_entity_count INTEGER NOT NULL DEFAULT 25,
    state VARCHAR(32) NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_trusted_qa_runs_state_v333
        CHECK (state IN ('active', 'cleanup_pending', 'cleaned', 'blocked')),
    CONSTRAINT chk_trusted_qa_runs_entity_count_v333
        CHECK (max_entity_count > 0 AND max_entity_count <= 500)
);

CREATE TABLE IF NOT EXISTS trusted_qa_run_entities (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES trusted_qa_runs(id) ON DELETE CASCADE,
    entity_type VARCHAR(80) NOT NULL,
    entity_id VARCHAR(120) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    cleanup_state VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_trusted_qa_run_entities_cleanup_state_v333
        CHECK (cleanup_state IN ('active', 'cleanup_pending', 'cleaned', 'blocked')),
    CONSTRAINT uq_trusted_qa_run_entity_v333
        UNIQUE (run_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_trusted_qa_runs_state_expires_v333
    ON trusted_qa_runs(state, expires_at);

CREATE INDEX IF NOT EXISTS idx_trusted_qa_run_entities_manifest_v333
    ON trusted_qa_run_entities(run_id, entity_type, cleanup_state);

COMMENT ON TABLE trusted_qa_runs IS
    'Server-authorized production QA run registry. Raw one-time tokens must never be stored, only token_hash.';

COMMENT ON TABLE trusted_qa_run_entities IS
    'Exact entity manifest for trusted QA runs; cleanup operates by registered IDs, not by client markers.';
