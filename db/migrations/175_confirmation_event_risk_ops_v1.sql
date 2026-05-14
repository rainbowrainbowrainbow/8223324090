-- MIGRATION_KIND: schema
-- SAFETY: Additive booking confirmation columns and indexes only; no destructive changes and no fuzzy booking-task backfill.
-- ROLLBACK: Drop idx_bookings_status_date, idx_bookings_confirmed_at, idx_bookings_confirmed_by, and remove the added bookings confirmation columns after accepting loss of confirmation accountability metadata.

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS confirmed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS confirmation_note TEXT NULL,
    ADD COLUMN IF NOT EXISTS confirmation_source TEXT NULL;

COMMENT ON COLUMN bookings.confirmed_at IS
    'Timestamp written by the narrow booking confirmation operation; status remains the booking state field.';

COMMENT ON COLUMN bookings.confirmed_by IS
    'Authenticated user id that confirmed a preliminary booking through the narrow confirmation operation.';

CREATE INDEX IF NOT EXISTS idx_bookings_status_date
    ON bookings(status, date);

CREATE INDEX IF NOT EXISTS idx_bookings_confirmed_at
    ON bookings(confirmed_at);

CREATE INDEX IF NOT EXISTS idx_bookings_confirmed_by
    ON bookings(confirmed_by);

-- Historical prep-task linkage backfill is intentionally not performed here.
-- Existing legacy event/category tasks do not carry an exact booking id/metadata
-- guarantee, and fuzzy title/category inference would create fake readiness truth.
