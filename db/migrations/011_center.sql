-- Migration 011: Center module — price_rules table
-- v18.1.0: Centralized price management for Boss dashboard

CREATE TABLE IF NOT EXISTS price_rules (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    value INT NOT NULL,
    unit VARCHAR(50),
    category VARCHAR(100),
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_price_rules_code ON price_rules(code);
CREATE INDEX IF NOT EXISTS idx_price_rules_category ON price_rules(category);

-- Seed initial prices
INSERT INTO price_rules (code, name, value, unit, category) VALUES
('animation_60', 'Анімація 60 хв', 1500, 'грн', 'Анімація'),
('animation_90', 'Анімація 90 хв', 2000, 'грн', 'Анімація'),
('animation_120', 'Анімація 120 хв', 2500, 'грн', 'Анімація'),
('animation_180', 'Анімація 180 хв', 3200, 'грн', 'Анімація'),
('second_host', 'Другий аніматор', 700, 'грн/год', 'Доплати'),
('visit_transport', 'Виїзд (таксі)', 0, 'за фактом', 'Виїзд'),
('deposit', 'Завдаток', 1000, 'грн', 'Загальне')
ON CONFLICT (code) DO NOTHING;
