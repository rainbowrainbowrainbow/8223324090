-- MIGRATION_KIND: schema
-- SAFETY: Add a constrained work mode with a regular default. No production records are explicitly updated and no historical compensation snapshots are rewritten.
-- ROLLBACK: Revert the application before enabling freelance scheduling. Once freelance blocks exist, retain this column and use a compatible application version that preserves their work mode.

ALTER TABLE hr_shift_segments
    ADD COLUMN IF NOT EXISTS work_mode VARCHAR(12) NOT NULL DEFAULT 'regular';

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'hr_shift_segments'::regclass
          AND conname = 'hr_shift_segments_work_mode_check'
    ) THEN
        ALTER TABLE hr_shift_segments
            ADD CONSTRAINT hr_shift_segments_work_mode_check
            CHECK (work_mode IN ('regular', 'freelance'));
    END IF;
END
$migration$;
