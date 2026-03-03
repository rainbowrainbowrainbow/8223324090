-- v20.9.12-v20.9.15: Leads page fields, banquet booking fields, staff extension

-- 26.1: Additional leads columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS instagram VARCHAR(100);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_id VARCHAR(50) REFERENCES bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_booking_id ON leads(booking_id);

-- 26.2: Banquet booking fields
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS banquet_menu TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS banquet_guests INT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS banquet_tables INT;

-- 26.3: Staff extension fields
ALTER TABLE staff ADD COLUMN IF NOT EXISTS contract_type VARCHAR(20) DEFAULT 'parttime';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS skills TEXT[];
