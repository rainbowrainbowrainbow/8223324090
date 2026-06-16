-- MIGRATION_KIND: schema
-- SAFETY: Adds one nullable banquet attendee count field; existing bookings are not rewritten.
-- ROLLBACK: Export any needed values, then ALTER TABLE bookings DROP COLUMN IF EXISTS banquet_adults;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS banquet_adults INTEGER;
