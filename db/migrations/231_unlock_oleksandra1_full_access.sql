-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotent per-account access grant for username Oleksandra1; it does not change passwords, delete rows, or rewrite history.
-- OPERATOR_APPROVAL: approved-by-user-request-2026-05-27
-- ROLLBACK: Remove 'creator' from users.extra_roles for username Oleksandra1 and reset business_contexts/default_business_context manually from account settings if needed.
-- DATA_SCOPE: users row where lower(trim(username)) = 'oleksandra1'.

UPDATE users
SET
    extra_roles = ARRAY(
        SELECT DISTINCT role_name
        FROM unnest(COALESCE(extra_roles, ARRAY[]::text[]) || ARRAY['creator']::text[]) AS role_name
        WHERE role_name <> ''
        ORDER BY role_name
    ),
    page_allowlist = ARRAY(
        SELECT DISTINCT page_path
        FROM unnest(COALESCE(page_allowlist, ARRAY[]::text[]) || ARRAY['/maysternya-doli']::text[]) AS page_path
        WHERE page_path <> ''
        ORDER BY page_path
    ),
    business_contexts = ARRAY['event_genix', 'dar', 'maysternya_doli', 'crm']::text[],
    default_business_context = 'event_genix'
WHERE lower(trim(COALESCE(username, ''))) = 'oleksandra1';
