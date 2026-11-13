-- MIGRATION_KIND: schema
-- SAFETY: Adds a nullable business owner and index. Existing vacancies remain unchanged until the separately approved data fix.
-- ROLLBACK: Revert the hiring access release while retaining this column and its ownership evidence.

ALTER TABLE job_vacancies ADD COLUMN IF NOT EXISTS business_context TEXT;
CREATE INDEX IF NOT EXISTS idx_job_vacancies_business_status
    ON job_vacancies (business_context, status);
