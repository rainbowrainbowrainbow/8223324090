-- MIGRATION_KIND: mixed
-- SAFETY: Adds an additive per-user default business context and grants Maysternya Doli access to Oleksandr-like accounts without deleting existing access or history.
-- OPERATOR_APPROVAL: approved-by-user-request-2026-05-27
-- ROLLBACK: ALTER TABLE users DROP COLUMN IF EXISTS default_business_context;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS default_business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE users
   SET default_business_context = CASE
        WHEN COALESCE(business_contexts, ARRAY[]::text[]) @> ARRAY['event_genix']::text[] THEN 'event_genix'
        ELSE COALESCE((business_contexts)[1], 'event_genix')
       END
 WHERE default_business_context IS NULL
    OR trim(default_business_context) = '';

UPDATE users
   SET business_contexts = ARRAY(
            SELECT key
              FROM unnest(ARRAY['event_genix', 'dar', 'maysternya_doli', 'crm']::text[]) AS key
             WHERE key = ANY(COALESCE(business_contexts, ARRAY[]::text[]) || ARRAY['maysternya_doli']::text[])
       ),
       default_business_context = 'maysternya_doli'
 WHERE lower(COALESCE(username, '')) IN ('oleksandr', 'alexandr', 'aleksandr', 'alexander', 'sasha')
    OR lower(COALESCE(username, '')) LIKE 'oleksandr.%'
    OR lower(COALESCE(username, '')) LIKE 'alexandr.%'
    OR lower(COALESCE(username, '')) LIKE 'aleksandr.%'
    OR lower(COALESCE(username, '')) LIKE 'alexander.%'
    OR lower(COALESCE(name, '')) LIKE 'олександр%'
    OR lower(COALESCE(name, '')) LIKE 'александр%';

CREATE INDEX IF NOT EXISTS idx_users_default_business_context
    ON users(default_business_context);
