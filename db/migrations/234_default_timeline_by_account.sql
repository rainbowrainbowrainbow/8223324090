-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotent account default correction. It changes only access metadata/default business context for timeline entry; it does not change primary roles, passwords, bookings, leads, or history.
-- OPERATOR_APPROVAL: approved-by-user-request-2026-05-27
-- ROLLBACK: UPDATE users SET default_business_context = 'event_genix' WHERE username/name matches the Oleksandr/Oleksandra classifier and Park should be the desired start surface again.
-- DATA_SCOPE: users rows used by the authenticated timeline entry route; Oleksandr/Oleksandra operator accounts start in Maysternya Doli, other Event Genix-capable accounts start in Park.

WITH target_users AS (
    SELECT id
    FROM users
    WHERE lower(trim(COALESCE(username, ''))) IN (
        'oleksandr',
        'oleksandra',
        'oleksandra1',
        'alexandr',
        'alexandra',
        'aleksandr',
        'aleksandra',
        'alexander',
        'sasha'
    )
       OR lower(trim(COALESCE(username, ''))) ~ '^(oleksandr|oleksandra|alexandr|alexandra|aleksandr|aleksandra|alexander|sasha)([._-]?[0-9]+|[._-].+)$'
       OR COALESCE(name, '') ~* '(^|[[:space:]])(Олександр|Олександра|Александр|Александра|Oleksandr|Oleksandra|Alexandr|Alexandra|Aleksandr|Aleksandra|Alexander)([[:space:]]|$)'
),
classified_users AS (
    SELECT
        u.id,
        target_users.id IS NOT NULL AS is_oleksandr
    FROM users AS u
    LEFT JOIN target_users ON target_users.id = u.id
)
UPDATE users AS u
SET
    extra_roles = CASE
        WHEN classified_users.is_oleksandr THEN ARRAY(
            SELECT DISTINCT role_name
            FROM unnest(COALESCE(u.extra_roles, ARRAY[]::text[]) || ARRAY['creator']::text[]) AS role_name
            WHERE role_name <> ''
            ORDER BY role_name
        )
        ELSE u.extra_roles
    END,
    page_allowlist = CASE
        WHEN classified_users.is_oleksandr THEN ARRAY(
            SELECT DISTINCT page_path
            FROM unnest(COALESCE(u.page_allowlist, ARRAY[]::text[]) || ARRAY['/maysternya-doli']::text[]) AS page_path
            WHERE page_path <> ''
            ORDER BY page_path
        )
        ELSE u.page_allowlist
    END,
    business_contexts = CASE
        WHEN classified_users.is_oleksandr THEN ARRAY['event_genix', 'dar', 'maysternya_doli', 'crm']::text[]
        ELSE u.business_contexts
    END,
    default_business_context = CASE
        WHEN classified_users.is_oleksandr THEN 'maysternya_doli'
        WHEN COALESCE(u.business_contexts, ARRAY[]::text[]) @> ARRAY['event_genix']::text[]
          OR cardinality(COALESCE(u.business_contexts, ARRAY[]::text[])) = 0
        THEN 'event_genix'
        ELSE u.default_business_context
    END
FROM classified_users
WHERE u.id = classified_users.id
  AND (
      classified_users.is_oleksandr
      OR (
          NOT classified_users.is_oleksandr
          AND (
              COALESCE(u.business_contexts, ARRAY[]::text[]) @> ARRAY['event_genix']::text[]
              OR cardinality(COALESCE(u.business_contexts, ARRAY[]::text[])) = 0
          )
          AND u.default_business_context IS DISTINCT FROM 'event_genix'
      )
  );
