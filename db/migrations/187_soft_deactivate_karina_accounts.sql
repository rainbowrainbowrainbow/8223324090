-- MIGRATION_KIND: data-fix
-- SAFETY: Soft-deactivates matching Karina Kramarenko CRM accounts and active employee profiles. No rows are deleted.
-- ROLLBACK: Re-enable the intended accounts manually with users.is_active=true and restore employee_profiles.is_active=true for the matching user_id values.

WITH karina_users AS (
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN employee_profiles ep ON ep.user_id = u.id
    WHERE
        lower(COALESCE(u.role, '')) <> 'creator'
        AND (
            lower(trim(COALESCE(u.username, ''))) IN (
                'karina',
                'karina.kramarenko',
                'karyna',
                'karyna.kramarenko'
            )
            OR lower(trim(COALESCE(ep.telegram_username, ''))) IN (
                'karina',
                '@karina',
                'karina.kramarenko',
                '@karina.kramarenko'
            )
            OR lower(trim(COALESCE(u.name, ''))) IN (
                U&'\043A\0430\0440\0438\043D\0430\0020\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E',
                U&'\043A\0430\0440\0456\043D\0430\0020\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E',
                'karina kramarenko',
                'karyna kramarenko'
            )
            OR lower(trim(COALESCE(ep.full_name, ''))) IN (
                U&'\043A\0430\0440\0438\043D\0430\0020\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E',
                U&'\043A\0430\0440\0456\043D\0430\0020\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E',
                'karina kramarenko',
                'karyna kramarenko'
            )
            OR (
                (
                    lower(COALESCE(u.name, '')) LIKE U&'%\043A\0430\0440\0438\043D%'
                    OR lower(COALESCE(u.name, '')) LIKE U&'%\043A\0430\0440\0456\043D%'
                    OR lower(COALESCE(ep.full_name, '')) LIKE U&'%\043A\0430\0440\0438\043D%'
                    OR lower(COALESCE(ep.full_name, '')) LIKE U&'%\043A\0430\0440\0456\043D%'
                    OR lower(COALESCE(u.username, '')) LIKE 'karina%'
                    OR lower(COALESCE(u.username, '')) LIKE 'karyna%'
                )
                AND (
                    lower(COALESCE(u.name, '')) LIKE U&'%\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E%'
                    OR lower(COALESCE(ep.full_name, '')) LIKE U&'%\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E%'
                    OR lower(COALESCE(u.name, '')) LIKE '%kramarenko%'
                    OR lower(COALESCE(ep.full_name, '')) LIKE '%kramarenko%'
                    OR lower(COALESCE(u.username, '')) LIKE '%kramarenko%'
                )
            )
        )
)
UPDATE employee_profiles ep
SET is_active = false
WHERE ep.user_id IN (SELECT id FROM karina_users);

WITH karina_users AS (
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN employee_profiles ep ON ep.user_id = u.id
    WHERE
        lower(COALESCE(u.role, '')) <> 'creator'
        AND (
            lower(trim(COALESCE(u.username, ''))) IN (
                'karina',
                'karina.kramarenko',
                'karyna',
                'karyna.kramarenko'
            )
            OR lower(trim(COALESCE(ep.telegram_username, ''))) IN (
                'karina',
                '@karina',
                'karina.kramarenko',
                '@karina.kramarenko'
            )
            OR lower(trim(COALESCE(u.name, ''))) IN (
                U&'\043A\0430\0440\0438\043D\0430\0020\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E',
                U&'\043A\0430\0440\0456\043D\0430\0020\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E',
                'karina kramarenko',
                'karyna kramarenko'
            )
            OR lower(trim(COALESCE(ep.full_name, ''))) IN (
                U&'\043A\0430\0440\0438\043D\0430\0020\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E',
                U&'\043A\0430\0440\0456\043D\0430\0020\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E',
                'karina kramarenko',
                'karyna kramarenko'
            )
            OR (
                (
                    lower(COALESCE(u.name, '')) LIKE U&'%\043A\0430\0440\0438\043D%'
                    OR lower(COALESCE(u.name, '')) LIKE U&'%\043A\0430\0440\0456\043D%'
                    OR lower(COALESCE(ep.full_name, '')) LIKE U&'%\043A\0430\0440\0438\043D%'
                    OR lower(COALESCE(ep.full_name, '')) LIKE U&'%\043A\0430\0440\0456\043D%'
                    OR lower(COALESCE(u.username, '')) LIKE 'karina%'
                    OR lower(COALESCE(u.username, '')) LIKE 'karyna%'
                )
                AND (
                    lower(COALESCE(u.name, '')) LIKE U&'%\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E%'
                    OR lower(COALESCE(ep.full_name, '')) LIKE U&'%\043A\0440\0430\043C\0430\0440\0435\043D\043A\043E%'
                    OR lower(COALESCE(u.name, '')) LIKE '%kramarenko%'
                    OR lower(COALESCE(ep.full_name, '')) LIKE '%kramarenko%'
                    OR lower(COALESCE(u.username, '')) LIKE '%kramarenko%'
                )
            )
        )
)
UPDATE users u
SET is_active = false
WHERE u.id IN (SELECT id FROM karina_users);
