-- MIGRATION_KIND: schema
-- SAFETY: additive, backfills account business-context access without deleting user data
-- ROLLBACK: DROP INDEX IF EXISTS idx_users_business_contexts_gin; ALTER TABLE users DROP COLUMN IF EXISTS business_contexts;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS business_contexts TEXT[] NOT NULL DEFAULT ARRAY['event_genix']::text[];

UPDATE users
SET business_contexts = ARRAY['event_genix', 'dar', 'maysternya_doli', 'crm']::text[]
WHERE role IN ('creator', 'director', 'vice_director', 'senior_manager')
  AND (
      business_contexts IS NULL
      OR cardinality(business_contexts) = 0
      OR business_contexts = ARRAY['event_genix']::text[]
  );

UPDATE users
SET business_contexts = ARRAY(
    SELECT DISTINCT value
    FROM unnest(
        business_contexts
        || CASE
            WHEN page_allowlist @> ARRAY['/maysternya-doli']::text[]
            THEN ARRAY['maysternya_doli']::text[]
            ELSE ARRAY[]::text[]
        END
    ) AS value
    WHERE value IN ('event_genix', 'dar', 'maysternya_doli', 'crm')
)
WHERE role NOT IN ('creator', 'director', 'vice_director', 'senior_manager');

CREATE INDEX IF NOT EXISTS idx_users_business_contexts_gin ON users USING GIN (business_contexts);
