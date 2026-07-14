-- MIGRATION_KIND: data-fix
-- SAFETY: Links only hired applications with no durable staff link when one and only one staff row has the same normalized phone and already owns the vacancy profession. Names are never used; ambiguous and unmatched rows remain untouched.
-- ROLLBACK: Review hr_audit_log action job_application_legacy_link_backfilled_v291 before clearing links. Do not unlink rows after onboarding or other product activity has started from the durable association.
-- DATA_SCOPE: job_applications.status = 'hired' with staff_id IS NULL; unique normalized phone matches of at least seven digits; profession must already be assigned through role_type, secondary_professions, or staff_role_assignments.

WITH eligible_matches AS (
    SELECT
        a.id AS application_id,
        MIN(s.id) AS staff_id,
        v.role_type AS profession_key
    FROM job_applications a
    JOIN job_vacancies v ON v.id = a.vacancy_id
    JOIN hr_professions hp ON hp.key = v.role_type
    JOIN staff s
      ON LENGTH(regexp_replace(COALESCE(a.phone, ''), '\D', '', 'g')) >= 7
     AND regexp_replace(COALESCE(s.phone, ''), '\D', '', 'g') = regexp_replace(a.phone, '\D', '', 'g')
     AND (
          s.role_type = v.role_type
          OR COALESCE(s.secondary_professions, '[]'::jsonb) ? v.role_type
          OR EXISTS (
              SELECT 1
              FROM staff_role_assignments sra
              WHERE sra.staff_id = s.id
                AND sra.profession_key = v.role_type
                AND COALESCE(sra.status, 'active') <> 'inactive'
          )
     )
    WHERE a.status = 'hired'
      AND a.staff_id IS NULL
    GROUP BY a.id, v.role_type
    HAVING COUNT(DISTINCT s.id) = 1
), linked AS (
    UPDATE job_applications a
       SET staff_id = match.staff_id,
           profession_key = match.profession_key,
           hired_at = COALESCE(a.hired_at, a.updated_at, a.created_at, NOW()),
           hired_by = COALESCE(NULLIF(BTRIM(a.hired_by), ''), NULLIF(BTRIM(a.added_by), ''), 'legacy_backfill_v291'),
           updated_at = NOW()
      FROM eligible_matches match
     WHERE a.id = match.application_id
       AND a.staff_id IS NULL
    RETURNING a.id, a.vacancy_id, a.staff_id, a.profession_key
)
INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
SELECT
    'job_application_legacy_link_backfilled_v291',
    linked.staff_id,
    'migration_291',
    jsonb_build_object(
        'application_id', linked.id,
        'vacancy_id', linked.vacancy_id,
        'profession_key', linked.profession_key,
        'match_key', 'unique_normalized_phone_and_assigned_profession'
    ),
    NULL
FROM linked;

