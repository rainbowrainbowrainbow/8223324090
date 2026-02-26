-- v19.2: Customer retention tracking
CREATE TABLE IF NOT EXISTS customer_retention_log (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    days_since_visit INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retention_customer ON customer_retention_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_retention_date ON customer_retention_log(created_at);
