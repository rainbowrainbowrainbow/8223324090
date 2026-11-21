-- MIGRATION_KIND: schema
-- SAFETY: Optional link between two existing records. No backfill or recalculation. Existing settlements remain independent.
-- ROLLBACK: Revert application code while keeping the nullable column and links so existing associations remain auditable.

ALTER TABLE staff_substitutions
    ADD COLUMN IF NOT EXISTS freelance_segment_id BIGINT REFERENCES hr_shift_segments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_staff_substitutions_freelance_link
    ON staff_substitutions(freelance_segment_id) WHERE freelance_segment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_substitutions_live_freelance_link
    ON staff_substitutions(freelance_segment_id)
    WHERE freelance_segment_id IS NOT NULL AND state <> 'cancelled';
