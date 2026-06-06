-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotent account-access lock. Non-creator accounts are forced to the Park/Event Genix business context only.
-- ROLLBACK: Restore users.business_contexts and users.default_business_context from a pre-deploy backup if multi-business access must be returned.

UPDATE users
   SET business_contexts = ARRAY['event_genix']::text[],
       default_business_context = 'event_genix'
 WHERE COALESCE(role, '') <> 'creator'
   AND (
       COALESCE(business_contexts, '{}'::text[]) IS DISTINCT FROM ARRAY['event_genix']::text[]
       OR COALESCE(default_business_context, '') IS DISTINCT FROM 'event_genix'
   );
