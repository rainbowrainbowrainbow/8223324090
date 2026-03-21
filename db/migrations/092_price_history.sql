-- v33.3: Price history table for price versioning
CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    price_code VARCHAR(50) NOT NULL,
    name VARCHAR(200),
    old_value NUMERIC,
    new_value NUMERIC,
    changed_by VARCHAR(50),
    changed_at TIMESTAMP DEFAULT NOW(),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_price_history_code ON price_history(price_code);
