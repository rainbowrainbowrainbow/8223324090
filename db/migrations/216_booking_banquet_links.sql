-- MIGRATION_KIND: schema
-- SAFETY: Adds a separate nullable relation table for visual banquet links; existing bookings are not rewritten.
-- ROLLBACK: Drop booking_banquet_links after exporting any banquet relation metadata that must be retained.

CREATE TABLE IF NOT EXISTS booking_banquet_links (
    id                  SERIAL PRIMARY KEY,
    business_context    VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    booking_a_id        VARCHAR(50) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    booking_b_id        VARCHAR(50) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    relation_type       VARCHAR(32) NOT NULL DEFAULT 'banquet_activity',
    label               VARCHAR(200),
    created_by_user_id  INTEGER,
    created_by          VARCHAR(100),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    CHECK (booking_a_id <> booking_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_banquet_links_pair
    ON booking_banquet_links(business_context, booking_a_id, booking_b_id, relation_type);

CREATE INDEX IF NOT EXISTS idx_booking_banquet_links_a
    ON booking_banquet_links(booking_a_id);

CREATE INDEX IF NOT EXISTS idx_booking_banquet_links_b
    ON booking_banquet_links(booking_b_id);
