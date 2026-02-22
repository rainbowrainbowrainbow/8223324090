-- Migration 009: Budget planning + Procurement system (v17.0)

-- ============================================================
-- 1. Budget Plans — plan vs fact per category per month
-- ============================================================

CREATE TABLE IF NOT EXISTS budget_plans (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    category_id INTEGER REFERENCES finance_categories(id) ON DELETE CASCADE,
    planned_amount INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(year, month, category_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_plans_year_month ON budget_plans(year, month);

-- ============================================================
-- 2. Procurement Lists — shopping lists by department
-- ============================================================

CREATE TABLE IF NOT EXISTS procurement_lists (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    department VARCHAR(50) NOT NULL DEFAULT 'admin',
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    planned_date VARCHAR(20),
    total_estimated INTEGER DEFAULT 0,
    total_actual INTEGER DEFAULT 0,
    assigned_to INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_lists_status ON procurement_lists(status);
CREATE INDEX IF NOT EXISTS idx_procurement_lists_department ON procurement_lists(department);

-- ============================================================
-- 3. Procurement Items — line items in a procurement list
-- ============================================================

CREATE TABLE IF NOT EXISTS procurement_items (
    id SERIAL PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES procurement_lists(id) ON DELETE CASCADE,
    stock_id INTEGER REFERENCES warehouse_stock(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit VARCHAR(30) DEFAULT 'шт',
    estimated_price INTEGER DEFAULT 0,
    actual_price INTEGER,
    is_purchased BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procurement_items_list ON procurement_items(list_id);
CREATE INDEX IF NOT EXISTS idx_procurement_items_stock ON procurement_items(stock_id);
