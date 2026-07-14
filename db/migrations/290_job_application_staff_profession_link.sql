-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable durable hiring links only. Existing applications, including legacy hired rows, are not backfilled or rewritten.
-- ROLLBACK: Export linked application records first, stop the scoped hire flow, then drop the indexes, foreign keys, and added columns. Do not roll back while production relies on application-to-staff provenance.

ALTER TABLE job_applications
    ADD COLUMN IF NOT EXISTS staff_id INTEGER,
    ADD COLUMN IF NOT EXISTS profession_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS onboarding_progress_id INTEGER,
    ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hired_by VARCHAR(120);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_job_applications_staff_v290'
          AND conrelid = 'job_applications'::regclass
    ) THEN
        ALTER TABLE job_applications
            ADD CONSTRAINT fk_job_applications_staff_v290
            FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_job_applications_profession_v290'
          AND conrelid = 'job_applications'::regclass
    ) THEN
        ALTER TABLE job_applications
            ADD CONSTRAINT fk_job_applications_profession_v290
            FOREIGN KEY (profession_key) REFERENCES hr_professions(key) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_job_applications_onboarding_v290'
          AND conrelid = 'job_applications'::regclass
    ) THEN
        ALTER TABLE job_applications
            ADD CONSTRAINT fk_job_applications_onboarding_v290
            FOREIGN KEY (onboarding_progress_id) REFERENCES onboarding_progress(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_job_applications_hire_link_v290'
          AND conrelid = 'job_applications'::regclass
    ) THEN
        ALTER TABLE job_applications
            ADD CONSTRAINT chk_job_applications_hire_link_v290
            CHECK (
                (staff_id IS NULL AND profession_key IS NULL AND onboarding_progress_id IS NULL)
                OR (staff_id IS NOT NULL AND profession_key IS NOT NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_applications_staff_profession_v290
    ON job_applications(staff_id, profession_key)
    WHERE staff_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_onboarding_progress_v290
    ON job_applications(onboarding_progress_id)
    WHERE onboarding_progress_id IS NOT NULL;

COMMENT ON COLUMN job_applications.staff_id IS
    'Durable staff record selected or created by the explicit application hire flow.';
COMMENT ON COLUMN job_applications.profession_key IS
    'Vacancy profession granted by this application; independent from mutable staff_role_assignments.id.';
COMMENT ON COLUMN job_applications.onboarding_progress_id IS
    'Optional profession-scoped onboarding process started during hire.';
