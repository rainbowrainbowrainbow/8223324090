-- Migration 017: Loyalty program + Discount/Promo system (v19.7)

-- Loyalty tiers for customers
CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    min_bookings INTEGER NOT NULL DEFAULT 0,
    min_spent INTEGER NOT NULL DEFAULT 0,
    discount_percent INTEGER NOT NULL DEFAULT 0,
    color VARCHAR(20) DEFAULT '#6B7280',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default loyalty tiers
INSERT INTO loyalty_tiers (name, min_bookings, min_spent, discount_percent, color, sort_order) VALUES
    ('Новий', 0, 0, 0, '#6B7280', 0),
    ('Постійний', 3, 3000, 5, '#3B82F6', 1),
    ('VIP', 10, 15000, 10, '#8B5CF6', 2),
    ('Premium', 20, 40000, 15, '#F59E0B', 3)
ON CONFLICT DO NOTHING;

-- Add loyalty_tier_id to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_tier_id INTEGER REFERENCES loyalty_tiers(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday_discount_used DATE;

-- Discount codes (promo codes)
CREATE TABLE IF NOT EXISTS discount_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'percent',  -- 'percent' or 'fixed'
    value INTEGER NOT NULL,                         -- percent (5-100) or fixed amount in UAH
    min_order INTEGER DEFAULT 0,                    -- minimum order amount to apply
    max_uses INTEGER DEFAULT NULL,                  -- NULL = unlimited
    used_count INTEGER DEFAULT 0,
    valid_from DATE,
    valid_until DATE,
    is_active BOOLEAN DEFAULT true,
    category VARCHAR(50),                           -- restrict to specific program category
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_active ON discount_codes(is_active, valid_until);

-- Discount usage log
CREATE TABLE IF NOT EXISTS discount_usage (
    id SERIAL PRIMARY KEY,
    discount_code_id INTEGER REFERENCES discount_codes(id),
    booking_id VARCHAR(50),
    customer_id INTEGER REFERENCES customers(id),
    original_price INTEGER NOT NULL,
    discount_amount INTEGER NOT NULL,
    final_price INTEGER NOT NULL,
    used_at TIMESTAMP DEFAULT NOW()
);

-- Discount proposals (special offers)
CREATE TABLE IF NOT EXISTS discount_proposals (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    discount_code_id INTEGER REFERENCES discount_codes(id),
    target_segment VARCHAR(50),     -- 'all', 'new', 'loyal', 'at_risk', 'birthday'
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    banner_color VARCHAR(20) DEFAULT '#10B981',
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add discount tracking to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_code_id INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_amount INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS original_price INTEGER;
