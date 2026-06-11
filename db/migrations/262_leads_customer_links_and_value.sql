-- MIGRATION_KIND: schema
-- SAFETY: Additive lead/customer link history and lead potential value columns. Existing customers.lead_id and customer_cards rows are preserved for compatibility.
-- ROLLBACK: DROP INDEX IF EXISTS idx_lead_customer_links_customer; DROP INDEX IF EXISTS idx_lead_customer_links_lead; DROP TABLE IF EXISTS lead_customer_links; ALTER TABLE leads DROP COLUMN IF EXISTS potential_value;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS potential_value INTEGER;

CREATE TABLE IF NOT EXISTS lead_customer_links (
    id SERIAL PRIMARY KEY,
    business_context TEXT NOT NULL DEFAULT 'event_genix',
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    link_type VARCHAR(40) NOT NULL DEFAULT 'customer_card',
    source VARCHAR(60),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_customer_links_unique
    ON lead_customer_links(business_context, lead_id, customer_id, link_type);

CREATE INDEX IF NOT EXISTS idx_lead_customer_links_lead
    ON lead_customer_links(business_context, lead_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_customer_links_customer
    ON lead_customer_links(business_context, customer_id, updated_at DESC);

INSERT INTO lead_customer_links (business_context, lead_id, customer_id, link_type, source, metadata)
SELECT
    COALESCE(c.business_context, l.business_context, 'event_genix'),
    c.lead_id,
    c.id,
    'legacy_customer_lead_id',
    'migration_262',
    jsonb_build_object('source_column', 'customers.lead_id')
FROM customers c
JOIN leads l ON l.id = c.lead_id
WHERE c.lead_id IS NOT NULL
ON CONFLICT (business_context, lead_id, customer_id, link_type) DO NOTHING;

WITH latest_card_budget AS (
    SELECT DISTINCT ON (COALESCE(cc.business_context, l.business_context, 'event_genix'), cc.lead_id)
        COALESCE(cc.business_context, l.business_context, 'event_genix') AS business_context,
        cc.lead_id,
        cc.budget_approx
    FROM customer_cards cc
    JOIN leads l ON l.id = cc.lead_id
    WHERE cc.lead_id IS NOT NULL
      AND cc.budget_approx IS NOT NULL
    ORDER BY COALESCE(cc.business_context, l.business_context, 'event_genix'), cc.lead_id,
             cc.updated_at DESC NULLS LAST, cc.id DESC
)
UPDATE leads l
SET potential_value = latest_card_budget.budget_approx
FROM latest_card_budget
WHERE l.id = latest_card_budget.lead_id
  AND COALESCE(l.business_context, 'event_genix') = latest_card_budget.business_context
  AND l.potential_value IS NULL;
