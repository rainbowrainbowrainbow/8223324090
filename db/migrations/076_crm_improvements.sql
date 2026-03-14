-- Migration 076: CRM Improvements v30.4.0
-- Customer tags, communication log, NPS tracking, phone index

-- 1. Customer tags
CREATE TABLE IF NOT EXISTS customer_tags (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  tag VARCHAR(50) NOT NULL,
  color VARCHAR(7) DEFAULT '#6B7280',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_tags_unique ON customer_tags(customer_id, tag);
CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON customer_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag ON customer_tags(tag);

-- 2. Communication log
CREATE TABLE IF NOT EXISTS communication_log (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  direction VARCHAR(10),
  summary TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comm_log_customer ON communication_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_comm_log_created ON communication_log(created_at);

-- 3. NPS tracking on bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS nps_sent_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS nps_score INTEGER;

-- 4. Phone index for duplicate detection and auto-linking
CREATE INDEX IF NOT EXISTS idx_customers_phone_lower ON customers(LOWER(phone)) WHERE phone IS NOT NULL AND phone != '';
