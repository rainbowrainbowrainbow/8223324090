-- v32.1: Subscription tracking for CRM payment reminders
CREATE TABLE IF NOT EXISTS subscription (
    id SERIAL PRIMARY KEY,
    plan_name VARCHAR(100) DEFAULT 'Базовий',
    amount INTEGER DEFAULT 2000,
    next_payment_date DATE,
    billing_period VARCHAR(20) DEFAULT 'monthly',
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default row if empty
INSERT INTO subscription (id, plan_name, amount, next_payment_date, billing_period)
SELECT 1, 'Базовий', 2000, CURRENT_DATE + INTERVAL '30 days', 'monthly'
WHERE NOT EXISTS (SELECT 1 FROM subscription LIMIT 1);
