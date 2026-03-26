-- Migration 077: Finance Improvements v30.6.0
-- Cash register shifts, debt tracking, currency rates

-- 1. Cash register shifts
CREATE TABLE IF NOT EXISTS cash_register_shifts (
  id SERIAL PRIMARY KEY,
  opened_by INTEGER REFERENCES users(id),
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  opening_cash INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id),
  closed_at TIMESTAMP,
  closing_cash INTEGER,
  expected_cash INTEGER,
  cash_difference INTEGER,
  notes TEXT,
  status VARCHAR(10) DEFAULT 'open' CHECK (status IN ('open','closed'))
);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_status ON cash_register_shifts(status);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_opened ON cash_register_shifts(opened_at DESC);

-- 2. Track payment status on bookings for debt management
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_amount INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS debt_notified_at TIMESTAMP;

-- 3. Currency conversion log
CREATE TABLE IF NOT EXISTS currency_conversions (
  id SERIAL PRIMARY KEY,
  from_currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  to_currency VARCHAR(3) NOT NULL DEFAULT 'UAH',
  original_amount NUMERIC(12,2) NOT NULL,
  rate NUMERIC(10,4) NOT NULL,
  converted_amount INTEGER NOT NULL,
  booking_id VARCHAR(50),
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Receipt/check log
CREATE TABLE IF NOT EXISTS receipts (
  id SERIAL PRIMARY KEY,
  booking_id VARCHAR(50),
  transaction_id INTEGER REFERENCES finance_transactions(id),
  amount INTEGER NOT NULL,
  payment_method VARCHAR(30),
  receipt_number VARCHAR(50) NOT NULL,
  qr_data TEXT,
  customer_name VARCHAR(200),
  items JSONB,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_booking ON receipts(booking_id);
CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts(receipt_number);
