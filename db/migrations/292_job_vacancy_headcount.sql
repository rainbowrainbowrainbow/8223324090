-- MIGRATION_KIND: schema
-- SAFETY: Adds one nullable positive headcount target. Existing vacancies remain in the manual close workflow because NULL preserves the previous behavior.
-- ROLLBACK: Stop headcount-aware vacancy writes, then drop chk_job_vacancies_target_hires_v292 and job_vacancies.target_hires. Derived hired counts require no rollback.

ALTER TABLE job_vacancies
    ADD COLUMN IF NOT EXISTS target_hires INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_job_vacancies_target_hires_v292'
          AND conrelid = 'job_vacancies'::regclass
    ) THEN
        ALTER TABLE job_vacancies
            ADD CONSTRAINT chk_job_vacancies_target_hires_v292
            CHECK (target_hires IS NULL OR target_hires > 0);
    END IF;
END $$;

COMMENT ON COLUMN job_vacancies.target_hires IS
    'Optional planned number of durable hires. NULL keeps explicit manual vacancy closure; a positive value closes the vacancy when linked hired applications reach the target.';

