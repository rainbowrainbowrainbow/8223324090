-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotent per-account access grant for Oleksandr/Oleksandra Maysternya accounts; it does not change primary roles, passwords, bookings, leads, or history.
-- OPERATOR_APPROVAL: approved-by-user-request-2026-05-27
-- ROLLBACK: Remove 'creator' from users.extra_roles for the targeted Oleksandr/Oleksandra accounts manually if this migration was the only source of that extra role.
-- DATA_SCOPE: users rows whose username or display name matches the Oleksandr/Oleksandra Maysternya operator classifier, including Oleksandra1.

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
)
UPDATE users AS u
SET
    extra_roles = ARRAY(
        SELECT DISTINCT role_name
        FROM unnest(COALESCE(u.extra_roles, ARRAY[]::text[]) || ARRAY['creator']::text[]) AS role_name
        WHERE role_name <> ''
        ORDER BY role_name
    ),
    page_allowlist = ARRAY(
        SELECT DISTINCT page_path
        FROM unnest(COALESCE(u.page_allowlist, ARRAY[]::text[]) || ARRAY['/maysternya-doli']::text[]) AS page_path
        WHERE page_path <> ''
        ORDER BY page_path
    ),
    business_contexts = ARRAY['event_genix', 'dar', 'maysternya_doli', 'crm']::text[]
FROM target_users
WHERE u.id = target_users.id;
