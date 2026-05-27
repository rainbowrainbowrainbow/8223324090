-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotent per-account default context correction. It updates only users.default_business_context and grants Maysternya Doli access to Oleksandr-like accounts; it does not delete users, roles, bookings, or history.
-- OPERATOR_APPROVAL: approved-by-user-request-2026-05-27
-- ROLLBACK: Reset affected users manually from account settings, or UPDATE users SET default_business_context = 'event_genix' WHERE default_business_context = 'maysternya_doli' AND username/name matches the Oleksandr classifier below.
-- DATA_SCOPE: users rows used by the CRM business switcher and timeline entry redirect.

WITH classified_users AS (
    SELECT
        id,
        (
            lower(COALESCE(username, '')) IN ('oleksandr', 'oleksandra', 'alexandr', 'alexandra', 'aleksandr', 'aleksandra', 'alexander')
            OR lower(COALESCE(username, '')) LIKE 'oleksandr.%'
            OR lower(COALESCE(username, '')) LIKE 'oleksandr_%'
            OR lower(COALESCE(username, '')) LIKE 'alexandr.%'
            OR lower(COALESCE(username, '')) LIKE 'alexandr_%'
            OR lower(COALESCE(username, '')) LIKE 'aleksandr.%'
            OR lower(COALESCE(username, '')) LIKE 'aleksandr_%'
            OR lower(COALESCE(username, '')) LIKE 'alexander.%'
            OR lower(COALESCE(username, '')) LIKE 'alexander_%'
            OR COALESCE(name, '') ~* '(^|[[:space:]])(Олександр|Олександра|Александр|Александра|Oleksandr|Oleksandra|Alexandr|Alexandra|Aleksandr|Aleksandra|Alexander)([[:space:]]|$)'
        ) AS is_oleksandr
    FROM users
)
UPDATE users AS u
SET
    business_contexts = CASE
        WHEN classified_users.is_oleksandr THEN ARRAY(
            SELECT key
            FROM unnest(ARRAY['event_genix', 'dar', 'maysternya_doli', 'crm']::text[]) AS key
            WHERE key = ANY(COALESCE(u.business_contexts, ARRAY[]::text[]) || ARRAY['maysternya_doli']::text[])
        )
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
      (classified_users.is_oleksandr AND (u.default_business_context IS DISTINCT FROM 'maysternya_doli'
           OR NOT (COALESCE(u.business_contexts, ARRAY[]::text[]) @> ARRAY['maysternya_doli']::text[])))
      OR (NOT classified_users.is_oleksandr
          AND (COALESCE(u.business_contexts, ARRAY[]::text[]) @> ARRAY['event_genix']::text[]
               OR cardinality(COALESCE(u.business_contexts, ARRAY[]::text[])) = 0)
          AND u.default_business_context IS DISTINCT FROM 'event_genix')
  );
