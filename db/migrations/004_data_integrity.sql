-- Migration 004: Data Integrity (v10.1.0)
--
-- 1. Unique partial indexes for atomic deduplication (prevent race conditions)
-- 2. Missing performance indexes
-- 3. Optimistic locking version column for tasks

-- Prevent duplicate recurring bookings (same template + date, excluding cancelled)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_recurring_unique
    ON bookings(recurring_template_id, date)
    WHERE recurring_template_id IS NOT NULL AND status != 'cancelled';

-- Prevent duplicate recurring tasks (same template + date)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_template_date_unique
    ON tasks(template_id, date)
    WHERE template_id IS NOT NULL;

-- Prevent duplicate recurring afisha (same template + date)
CREATE UNIQUE INDEX IF NOT EXISTS idx_afisha_template_date_unique
    ON afisha(template_id, date)
    WHERE template_id IS NOT NULL;

-- Missing indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_date ON tasks(assigned_to, date);

-- Optimistic locking: version column for concurrent task updates
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
