-- MIGRATION_KIND: schema
-- SAFETY: Additive first-class storage for future AI-created task bundles. Existing tasks, task action history, control_meta bundle markers, tags, directions, dependencies, and production data are not rewritten or deleted.
-- ROLLBACK: Disable AI bundle commits, retain existing task/history audit, then drop task_bundle_tasks before task_bundles in a separately approved rollback migration.

CREATE TABLE IF NOT EXISTS task_bundles (
    id VARCHAR(64) PRIMARY KEY,
    business_context VARCHAR(100) NOT NULL DEFAULT 'event_genix',
    title VARCHAR(180) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'committed',
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    proposal_id VARCHAR(160),
    proposal_hash VARCHAR(128) NOT NULL,
    draft_fingerprint VARCHAR(128) NOT NULL,
    catalog_version VARCHAR(128),
    idempotency_key VARCHAR(160) NOT NULL,
    request_hash VARCHAR(128) NOT NULL,
    task_count SMALLINT NOT NULL,
    accepted_task_mask INTEGER[] NOT NULL DEFAULT '{}'::integer[],
    rejected_task_mask INTEGER[] NOT NULL DEFAULT '{}'::integer[],
    provider VARCHAR(40) NOT NULL DEFAULT 'openai',
    model VARCHAR(80) NOT NULL,
    contract_version VARCHAR(80) NOT NULL,
    prompt_version VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_task_bundles_status_v323
        CHECK (status IN ('committed', 'archived', 'cancelled')),
    CONSTRAINT chk_task_bundles_task_count_v323
        CHECK (task_count BETWEEN 2 AND 6),
    CONSTRAINT uq_task_bundles_idempotency_v323
        UNIQUE (created_by_user_id, business_context, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_task_bundles_creator_context_created_v323
    ON task_bundles (created_by_user_id, business_context, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_bundles_status_created_v323
    ON task_bundles (status, created_at DESC);

CREATE TABLE IF NOT EXISTS task_bundle_tasks (
    bundle_id VARCHAR(64) NOT NULL REFERENCES task_bundles(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    task_index SMALLINT NOT NULL,
    user_edited BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bundle_id, task_id),
    CONSTRAINT uq_task_bundle_tasks_position_v323
        UNIQUE (bundle_id, task_index),
    CONSTRAINT uq_task_bundle_tasks_task_v323
        UNIQUE (task_id),
    CONSTRAINT chk_task_bundle_tasks_index_v323
        CHECK (task_index BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_task_bundle_tasks_task_v323
    ON task_bundle_tasks (task_id);

COMMENT ON TABLE task_bundles IS
    'Canonical first-class grouping for atomically committed AI task bundles. Prompt and provider response text are never stored here.';

COMMENT ON TABLE task_bundle_tasks IS
    'Ordered membership of independent tasks in a task bundle. Dependencies remain reserved for real blockers.';
