-- MIGRATION_KIND: schema
-- SAFETY: Additive personal time-entry ledger only. No task, user, or historical data is changed or backfilled.
-- ROLLBACK: After application rollback, DROP TABLE IF EXISTS my_day_time_entries.

CREATE TABLE IF NOT EXISTS my_day_time_entries (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    source VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_my_day_time_entries_source CHECK (source IN ('timer', 'manual')),
    CONSTRAINT chk_my_day_time_entries_positive_interval CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_my_day_time_entries_one_active_per_user
    ON my_day_time_entries (user_id)
    WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_my_day_time_entries_user_started_at
    ON my_day_time_entries (user_id, started_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_my_day_time_entries_task_started_at
    ON my_day_time_entries (task_id, started_at DESC, id DESC);
