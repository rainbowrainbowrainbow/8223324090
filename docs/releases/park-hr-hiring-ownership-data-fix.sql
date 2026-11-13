-- MIGRATION_KIND: data-fix
-- SAFETY: Operator-run after schema deployment. Locks the hiring inventory for
-- validation and updates only the six reviewed rows that still have no owner.
-- DATA_SCOPE: Production job_vacancies IDs 1-6, verified by the 2026-11-13
-- read-only inventory and confirmed by the owner as Park (event_genix).
-- OPERATOR_APPROVAL: RED-PARK-HR-HIRING-OWNERSHIP
-- ROLLBACK: Retain the column. A separately approved data rollback must verify
-- the same six rows and any new dependencies before clearing their owner.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE job_vacancies, job_applications, job_application_resume_files IN SHARE ROW EXCLUSIVE MODE;

DO $ownership$
DECLARE
    approved_ids CONSTANT integer[] := ARRAY[1, 2, 3, 4, 5, 6];
    unassigned_ids integer[];
BEGIN
    SELECT array_agg(id ORDER BY id) INTO unassigned_ids
    FROM job_vacancies
    WHERE business_context IS NULL;

    IF unassigned_ids IS NULL AND
        (SELECT count(*) FROM job_vacancies WHERE id = ANY(approved_ids) AND business_context = 'event_genix')
        = cardinality(approved_ids) THEN
        RAISE NOTICE 'Approved Park ownership is already present on six vacancies.';
        RETURN;
    END IF;

    IF unassigned_ids IS DISTINCT FROM approved_ids
        OR EXISTS (SELECT 1 FROM job_applications)
        OR EXISTS (SELECT 1 FROM job_application_resume_files) THEN
        RAISE EXCEPTION 'Hiring inventory differs from the approved ownership audit.';
    END IF;

    UPDATE job_vacancies SET business_context = 'event_genix'
    WHERE id = ANY(approved_ids) AND business_context IS NULL;
END;
$ownership$;

COMMIT;
