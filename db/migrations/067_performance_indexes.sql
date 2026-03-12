-- 067: Performance indexes for hot queries (Phase C: OPT-001)

-- Booking conflict detection: date + room + status
CREATE INDEX IF NOT EXISTS idx_bookings_date_room_status
ON bookings (date, room, status);

-- Lead duplicate check: phone + status
CREATE INDEX IF NOT EXISTS idx_leads_phone_status
ON leads (phone, status);

-- Employee online status: last_activity_at
CREATE INDEX IF NOT EXISTS idx_employee_profiles_last_activity
ON employee_profiles (last_activity_at)
WHERE last_activity_at IS NOT NULL;

-- Customers created_at for analytics range queries
CREATE INDEX IF NOT EXISTS idx_customers_created_at
ON customers (created_at);

-- Finance transactions composite for range + type aggregations
CREATE INDEX IF NOT EXISTS idx_finance_transactions_date_type
ON finance_transactions (date, type);
