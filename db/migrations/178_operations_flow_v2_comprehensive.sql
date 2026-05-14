-- MIGRATION_KIND: schema
-- SAFETY: Adds additive JSONB operational context columns only; existing customers, leads, tasks, bookings, and communication records are not rewritten or merged.
-- ROLLBACK: Drop customers.social_identities and leads.celebrants plus their indexes/constraints after exporting any newly captured values.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS social_identities JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_social_identities_array_check'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_social_identities_array_check
      CHECK (jsonb_typeof(social_identities) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_social_identities_gin
  ON customers USING GIN (social_identities jsonb_path_ops);

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS celebrants JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_celebrants_array_check'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_celebrants_array_check
      CHECK (jsonb_typeof(celebrants) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_celebrants_gin
  ON leads USING GIN (celebrants jsonb_path_ops);
