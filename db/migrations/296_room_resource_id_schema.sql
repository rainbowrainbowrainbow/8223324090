-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable room_resource_id columns, non-empty checks, and partial indexes only. Existing room text values and booking data are not rewritten.
-- ROLLBACK: ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_room_resource_id_not_blank; ALTER TABLE banquet_groups DROP CONSTRAINT IF EXISTS banquet_groups_room_resource_id_not_blank; ALTER TABLE booking_templates DROP CONSTRAINT IF EXISTS booking_templates_room_resource_id_not_blank; ALTER TABLE recurring_templates DROP CONSTRAINT IF EXISTS recurring_templates_room_resource_id_not_blank; DROP INDEX IF EXISTS idx_bookings_room_resource_active_v296; DROP INDEX IF EXISTS idx_banquet_groups_room_resource_active_v296; DROP INDEX IF EXISTS idx_booking_templates_room_resource_v296; DROP INDEX IF EXISTS idx_recurring_templates_room_resource_active_v296; ALTER TABLE bookings DROP COLUMN IF EXISTS room_resource_id; ALTER TABLE banquet_groups DROP COLUMN IF EXISTS room_resource_id; ALTER TABLE booking_templates DROP COLUMN IF EXISTS room_resource_id; ALTER TABLE recurring_templates DROP COLUMN IF EXISTS room_resource_id;

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS room_resource_id VARCHAR(100);

ALTER TABLE banquet_groups
    ADD COLUMN IF NOT EXISTS room_resource_id VARCHAR(100);

ALTER TABLE booking_templates
    ADD COLUMN IF NOT EXISTS room_resource_id VARCHAR(100);

ALTER TABLE recurring_templates
    ADD COLUMN IF NOT EXISTS room_resource_id VARCHAR(100);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_room_resource_id_not_blank'
    ) THEN
        ALTER TABLE bookings
            ADD CONSTRAINT bookings_room_resource_id_not_blank
            CHECK (room_resource_id IS NULL OR BTRIM(room_resource_id) <> '');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'banquet_groups_room_resource_id_not_blank'
    ) THEN
        ALTER TABLE banquet_groups
            ADD CONSTRAINT banquet_groups_room_resource_id_not_blank
            CHECK (room_resource_id IS NULL OR BTRIM(room_resource_id) <> '');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_templates_room_resource_id_not_blank'
    ) THEN
        ALTER TABLE booking_templates
            ADD CONSTRAINT booking_templates_room_resource_id_not_blank
            CHECK (room_resource_id IS NULL OR BTRIM(room_resource_id) <> '');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'recurring_templates_room_resource_id_not_blank'
    ) THEN
        ALTER TABLE recurring_templates
            ADD CONSTRAINT recurring_templates_room_resource_id_not_blank
            CHECK (room_resource_id IS NULL OR BTRIM(room_resource_id) <> '');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_room_resource_active_v296
    ON bookings (business_context, date, room_resource_id)
    WHERE room_resource_id IS NOT NULL
      AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_banquet_groups_room_resource_active_v296
    ON banquet_groups (business_context, date, room_resource_id)
    WHERE room_resource_id IS NOT NULL
      AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_booking_templates_room_resource_v296
    ON booking_templates (room_resource_id)
    WHERE room_resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_templates_room_resource_active_v296
    ON recurring_templates (room_resource_id, is_active)
    WHERE room_resource_id IS NOT NULL;

COMMENT ON COLUMN bookings.room_resource_id IS
    'Nullable durable room identity. bookings.room remains the display/legacy snapshot until room ID migration is complete.';

COMMENT ON COLUMN banquet_groups.room_resource_id IS
    'Nullable durable room identity for the banquet group snapshot. banquet_groups.room remains the display/legacy snapshot.';

COMMENT ON COLUMN booking_templates.room_resource_id IS
    'Nullable durable room identity for template-created bookings. Validated by backend because templates do not currently carry business_context.';

COMMENT ON COLUMN recurring_templates.room_resource_id IS
    'Nullable durable room identity for generated bookings. Validated by backend because recurring templates do not currently carry business_context.';

COMMENT ON INDEX idx_bookings_room_resource_active_v296 IS
    'Room conflict/availability lookup for active bookings by business context, date, and durable room id.';

COMMENT ON INDEX idx_banquet_groups_room_resource_active_v296 IS
    'Room repair/audit lookup for active banquet groups by business context, date, and durable room id.';
