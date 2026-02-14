-- Migration 002: Optimistic Locking support
-- Ensures updated_at column exists, backfills NULLs, and creates auto-update trigger

-- 1. Add updated_at column if not exists (idempotent)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- 2. Backfill NULL values with created_at
UPDATE bookings SET updated_at = created_at WHERE updated_at IS NULL;

-- 3. Create trigger function for auto-updating updated_at on every UPDATE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Apply trigger to bookings table
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
