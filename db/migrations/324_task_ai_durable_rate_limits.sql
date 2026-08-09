-- MIGRATION_KIND: schema
-- SAFETY: Additive metadata-only rate-limit buckets for task AI. No task text, prompts, provider responses, secrets, or existing production rows are copied or changed.
-- ROLLBACK: Disable task AI preview traffic, then drop task_ai_rate_limit_buckets in a separately approved rollback migration; manual task creation remains available.

CREATE TABLE IF NOT EXISTS task_ai_rate_limit_buckets (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_context VARCHAR(100) NOT NULL DEFAULT 'event_genix',
    action VARCHAR(40) NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    window_started_at TIMESTAMPTZ NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, business_context, action),
    CONSTRAINT chk_task_ai_rate_limit_count_v324
        CHECK (request_count >= 0),
    CONSTRAINT chk_task_ai_rate_limit_window_v324
        CHECK (reset_at > window_started_at),
    CONSTRAINT chk_task_ai_rate_limit_action_v324
        CHECK (BTRIM(action) <> '')
);

CREATE INDEX IF NOT EXISTS idx_task_ai_rate_limit_reset_v324
    ON task_ai_rate_limit_buckets (reset_at);

COMMENT ON TABLE task_ai_rate_limit_buckets IS
    'Durable per-user/business/action request counters for task AI across multiple application replicas; contains no task content or secrets.';
