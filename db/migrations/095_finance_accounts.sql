-- v33.5: Finance accounts for report bot integration
CREATE TABLE IF NOT EXISTS finance_accounts (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    emoji        VARCHAR(10) DEFAULT '💳',
    description  TEXT,
    type         VARCHAR(20) DEFAULT 'cash',
    is_active    BOOLEAN DEFAULT true,
    sort_order   INTEGER DEFAULT 0,
    created_by   VARCHAR(50),
    created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_accounts_active ON finance_accounts(is_active);

-- Seed base accounts
INSERT INTO finance_accounts (name, emoji, type, sort_order) VALUES
('Каса (готівка)', '💵', 'cash', 1),
('Privat (безготівка)', '💳', 'card', 2),
('Mono (безготівка)', '🖤', 'card', 3),
('Інший рахунок', '🏦', 'bank', 4)
ON CONFLICT DO NOTHING;

-- Add account columns to finance_transactions
ALTER TABLE finance_transactions
    ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES finance_accounts(id),
    ADD COLUMN IF NOT EXISTS account_name VARCHAR(100);

-- Add account columns to reports (bot submissions go here)
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS account_id INTEGER,
    ADD COLUMN IF NOT EXISTS account_name VARCHAR(100);
