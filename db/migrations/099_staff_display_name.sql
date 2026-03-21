-- v33.5: Staff display_name for shift counting via text-match
ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);

COMMENT ON COLUMN staff.display_name IS 'Як аніматора вписують в bookings.hosts — для text-match підрахунку змін';

CREATE INDEX IF NOT EXISTS idx_staff_display_name ON staff(display_name)
    WHERE display_name IS NOT NULL;
