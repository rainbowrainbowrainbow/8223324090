-- MIGRATION_KIND: schema
-- SAFETY: Additive graduation operations automation fields and state only; existing tasks, quotes, bookings, and child rosters are preserved.
-- ROLLBACK: Drop graduation_automation_state, the added graduation_services timeline columns, and task control-mode columns after exporting any operational automation state that must be kept.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS control_mode VARCHAR(32) NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS critical_reason TEXT,
    ADD COLUMN IF NOT EXISTS control_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_control_mode') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_control_mode
            CHECK (control_mode IN ('normal','special_control'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_control_mode_active
    ON tasks(control_mode, source_type, source_id)
    WHERE control_mode = 'special_control'
      AND COALESCE(status, 'todo') NOT IN ('done','archived','cancelled');

ALTER TABLE graduation_services
    ADD COLUMN IF NOT EXISTS timeline_visible BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS operation_kind VARCHAR(48),
    ADD COLUMN IF NOT EXISTS automation_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE graduation_services
SET timeline_visible = true,
    operation_kind = CASE
        WHEN lower(name) LIKE '%диплом%' THEN 'diploma'
        WHEN lower(name) LIKE '%капсула%' THEN 'capsule_time'
        ELSE COALESCE(operation_kind, 'service')
    END,
    automation_flags = COALESCE(automation_flags, '{}'::jsonb)
WHERE timeline_visible IS DISTINCT FROM true
   OR operation_kind IS NULL
   OR automation_flags IS NULL;

CREATE INDEX IF NOT EXISTS idx_graduation_services_timeline
    ON graduation_services(timeline_visible, sort_order)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS graduation_automation_state (
    id BIGSERIAL PRIMARY KEY,
    graduation_quote_id INTEGER NOT NULL REFERENCES graduation_quotes(id) ON DELETE CASCADE,
    booking_id TEXT,
    automation_key VARCHAR(64) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'active',
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    scheduled_for TIMESTAMPTZ,
    artifact_url TEXT,
    not_ready_reason TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_graduation_automation_key CHECK (automation_key IN ('diploma_roster','diploma_print_reminder','capsule_prep')),
    CONSTRAINT chk_graduation_automation_state CHECK (state IN ('active','satisfied','scheduled','sent','blocked','cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_graduation_automation_state_key
    ON graduation_automation_state(graduation_quote_id, automation_key);

CREATE INDEX IF NOT EXISTS idx_graduation_automation_due
    ON graduation_automation_state(automation_key, scheduled_for)
    WHERE state IN ('scheduled','blocked') AND scheduled_for IS NOT NULL;
