-- v22.18: Auto-ordering when stock is low (#26)

-- Auto-order rules (which items trigger auto-ordering)
CREATE TABLE IF NOT EXISTS auto_order_rules (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER NOT NULL REFERENCES warehouse_stock(id) ON DELETE CASCADE,
    contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
    reorder_quantity INTEGER NOT NULL DEFAULT 10,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(stock_id)
);

-- Auto-order requests (pending approval)
CREATE TABLE IF NOT EXISTS auto_order_requests (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER NOT NULL REFERENCES warehouse_stock(id) ON DELETE CASCADE,
    contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL,
    current_stock INTEGER NOT NULL,
    min_stock INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'ordered')),
    approved_by VARCHAR(100),
    telegram_message_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_order_requests_status ON auto_order_requests (status);
