-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotent; widens only primary director accounts to the standard business-context set after the non-creator lock migration.
-- ROLLBACK: Manually set affected director accounts back to ARRAY['event_genix']::text[] and default_business_context='event_genix' if the director switch policy is reverted.

UPDATE users
   SET business_contexts = ARRAY['event_genix', 'dar', 'maysternya_doli', 'crm']::text[],
       default_business_context = CASE
           WHEN default_business_context = ANY(ARRAY['event_genix', 'dar', 'maysternya_doli', 'crm']::text[])
               THEN default_business_context
           ELSE 'event_genix'
       END
 WHERE role = 'director'
   AND (
       business_contexts IS NULL
       OR NOT business_contexts && ARRAY['dar', 'maysternya_doli', 'crm']::text[]
   );
