-- v33.8.0: Customer ↔ lead link
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_lead ON customers(lead_id) WHERE lead_id IS NOT NULL;
