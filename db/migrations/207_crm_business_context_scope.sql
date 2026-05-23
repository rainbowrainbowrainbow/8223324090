-- MIGRATION_KIND: schema
-- SAFETY: Additive business_context columns and scoped indexes for CRM entities. Existing CRM rows keep the legacy Event Genix context; no rows are deleted or merged.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Drop the added scoped indexes, restore idx_mailing_phone if needed, then drop business_context columns from leads, customers, customer_cards, and mailing_list after exporting any non-event_genix rows.

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE customer_cards
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE mailing_list
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE customer_cards cc
SET business_context = COALESCE(l.business_context, 'event_genix')
FROM leads l
WHERE cc.lead_id = l.id
  AND COALESCE(cc.business_context, 'event_genix') <> COALESCE(l.business_context, 'event_genix');

UPDATE mailing_list ml
SET business_context = COALESCE(l.business_context, 'event_genix')
FROM leads l
WHERE ml.lead_id = l.id
  AND COALESCE(ml.business_context, 'event_genix') <> COALESCE(l.business_context, 'event_genix');

CREATE INDEX IF NOT EXISTS idx_leads_business_status_created
    ON leads(business_context, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_business_pipeline
    ON leads(business_context, pipeline_stage, lead_type);

CREATE INDEX IF NOT EXISTS idx_leads_business_phone
    ON leads(business_context, phone)
    WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_business_updated
    ON customers(business_context, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_business_phone
    ON customers(business_context, phone)
    WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_business_instagram
    ON customers(business_context, instagram)
    WHERE instagram IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_cards_business_lead
    ON customer_cards(business_context, lead_id);

CREATE INDEX IF NOT EXISTS idx_mailing_business_status_created
    ON mailing_list(business_context, status, created_at DESC);

DROP INDEX IF EXISTS idx_mailing_phone;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailing_business_phone
    ON mailing_list(business_context, phone)
    WHERE phone IS NOT NULL;

DROP INDEX IF EXISTS idx_leads_external_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_business_external_id
    ON leads(business_context, source_channel, external_id)
    WHERE external_id IS NOT NULL;
