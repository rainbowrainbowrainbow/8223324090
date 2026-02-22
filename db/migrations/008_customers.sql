-- 008_customers.sql
-- CRM: Customer database for booking system

-- ============================================
-- 1. Таблиця клієнтів
-- ============================================
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(30),
    instagram VARCHAR(100),
    child_name VARCHAR(200),
    child_birthday DATE,
    source VARCHAR(50),
    notes TEXT,
    total_bookings INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    first_visit DATE,
    last_visit DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_instagram ON customers(instagram);

-- ============================================
-- 2. Зв'язок бронювань з клієнтами
-- ============================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
