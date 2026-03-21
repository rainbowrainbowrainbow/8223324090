-- v33.8.0: Certificate ↔ booking link
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS certificate_id INTEGER REFERENCES certificates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_certificate ON bookings(certificate_id)
    WHERE certificate_id IS NOT NULL;
