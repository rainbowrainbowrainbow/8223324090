-- 006_warehouse_and_users.sql
-- Warehouse stock management + new admin users (Anna, Artem)

-- ==========================================
-- WAREHOUSE TABLES
-- ==========================================

CREATE TABLE IF NOT EXISTS warehouse_stock (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'consumable',
    quantity INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 0,
    unit VARCHAR(30) NOT NULL DEFAULT 'шт',
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS warehouse_history (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER NOT NULL REFERENCES warehouse_stock(id) ON DELETE CASCADE,
    change INTEGER NOT NULL,
    reason VARCHAR(255),
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_history_stock_id ON warehouse_history(stock_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_category ON warehouse_stock(category);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_active ON warehouse_stock(is_active);
