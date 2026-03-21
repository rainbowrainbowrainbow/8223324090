-- v33.8.0: HR shifts ↔ bookings soft link
ALTER TABLE hr_shifts
    ADD COLUMN IF NOT EXISTS booking_ids JSONB DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_hr_shifts_date_staff ON hr_shifts(shift_date, staff_id);
