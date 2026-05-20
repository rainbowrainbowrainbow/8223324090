-- MIGRATION_KIND: schema
-- SAFETY: Idempotent ADD COLUMN/CREATE TABLE/CREATE INDEX statements for smart task scheduling metadata and discipline events.
-- ROLLBACK: Drop task_discipline_events, the added idx_tasks_schedule_* indexes, and the added tasks.schedule_* columns only after exporting schedule history if needed.
-- OPERATOR_APPROVAL: required

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS schedule_slot VARCHAR(32);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS schedule_mode VARCHAR(32) DEFAULT 'legacy';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS schedule_status VARCHAR(32) DEFAULT 'unscheduled';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS schedule_meta JSONB DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS schedule_proposal JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS missed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS missed_processed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS schedule_discipline_delta INTEGER DEFAULT 0;

ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_schedule_slot_check;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_schedule_slot_check
    CHECK (schedule_slot IS NULL OR schedule_slot IN ('morning','midday','afternoon','evening','manual'));

ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_schedule_mode_check;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_schedule_mode_check
    CHECK (schedule_mode IS NULL OR schedule_mode IN ('slot','manual','proposal','legacy'));

ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_schedule_status_check;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_schedule_status_check
    CHECK (schedule_status IS NULL OR schedule_status IN ('unscheduled','scheduled','proposal','missed','completed','cancelled'));

CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_start_at
    ON tasks(scheduled_start_at);

CREATE INDEX IF NOT EXISTS idx_tasks_schedule_owner_window
    ON tasks(owner_user_id, scheduled_start_at, scheduled_end_at)
    WHERE scheduled_start_at IS NOT NULL AND scheduled_end_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_schedule_status
    ON tasks(schedule_status);

CREATE TABLE IF NOT EXISTS task_discipline_events (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    creator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    score_delta INTEGER NOT NULL DEFAULT 0,
    event_key VARCHAR(160) NOT NULL UNIQUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_discipline_events_task_created_at
    ON task_discipline_events(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_discipline_events_owner_created_at
    ON task_discipline_events(owner_user_id, created_at DESC);
