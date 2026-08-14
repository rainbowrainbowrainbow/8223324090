-- MIGRATION_KIND: schema
-- SAFETY: Adds NOT VALID active-row checks and deferred constraint triggers only. Existing legacy cancelled/history rows are not rewritten, constraints are not validated here, and no production cleanup/backfill is executed.
-- DATA_SCOPE: schema-only active-row guards; no existing booking or banquet rows are read, rewritten, cancelled, quarantined, or validated.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Disable application writes, export active invalid room inventory, then DROP TRIGGER IF EXISTS trg_banquet_groups_identity_v332 ON banquet_groups; DROP TRIGGER IF EXISTS trg_banquet_group_bookings_identity_v332 ON banquet_group_bookings; DROP TRIGGER IF EXISTS trg_bookings_primary_banquet_identity_v332 ON bookings; DROP FUNCTION IF EXISTS assert_banquet_group_identity_v332(); DROP FUNCTION IF EXISTS assert_booking_primary_group_identity_v332(); DROP FUNCTION IF EXISTS canonical_business_context_v332(TEXT); DROP FUNCTION IF EXISTS active_room_text_invalid_v332(TEXT); ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_bookings_active_room_identity_v332; ALTER TABLE banquet_groups DROP CONSTRAINT IF EXISTS chk_banquet_groups_active_room_identity_v332;

CREATE OR REPLACE FUNCTION active_room_text_invalid_v332(value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(BTRIM(value), '') = ''
        OR BTRIM(value) ~ '^[?�]+$'
$$;

CREATE OR REPLACE FUNCTION canonical_business_context_v332(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE
        WHEN LOWER(COALESCE(NULLIF(BTRIM(value), ''), 'event_genix'))
             IN ('park_zakrevsky', 'park', 'pzp') THEN 'event_genix'
        ELSE LOWER(COALESCE(NULLIF(BTRIM(value), ''), 'event_genix'))
    END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_bookings_active_room_identity_v332'
           AND conrelid = 'bookings'::regclass
    ) THEN
        ALTER TABLE bookings
            ADD CONSTRAINT chk_bookings_active_room_identity_v332
            CHECK (
                NOT (
                    canonical_business_context_v332(business_context) = 'event_genix'
                    AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled'
                    AND (
                        COALESCE(BTRIM(room_resource_id), '') = ''
                        OR active_room_text_invalid_v332(room)
                    )
                )
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_banquet_groups_active_room_identity_v332'
           AND conrelid = 'banquet_groups'::regclass
    ) THEN
        ALTER TABLE banquet_groups
            ADD CONSTRAINT chk_banquet_groups_active_room_identity_v332
            CHECK (
                NOT (
                    canonical_business_context_v332(business_context) = 'event_genix'
                    AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) <> 'cancelled'
                    AND (
                        COALESCE(BTRIM(room_resource_id), '') = ''
                        OR active_room_text_invalid_v332(room)
                    )
                )
            ) NOT VALID;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION assert_banquet_group_identity_v332()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_group_id TEXT;
    group_row banquet_groups%ROWTYPE;
    primary_row bookings%ROWTYPE;
    primary_membership_count INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'banquet_groups' THEN
        target_group_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSIF TG_TABLE_NAME = 'banquet_group_bookings' THEN
        target_group_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.group_id ELSE NEW.group_id END;
    ELSE
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF target_group_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    SELECT * INTO group_row
      FROM banquet_groups
     WHERE id = target_group_id;
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF canonical_business_context_v332(group_row.business_context) <> 'event_genix'
       OR LOWER(COALESCE(NULLIF(BTRIM(group_row.status), ''), 'active')) = 'cancelled' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF COALESCE(BTRIM(group_row.primary_booking_id), '') = '' THEN
        RAISE EXCEPTION 'active banquet group requires primary_booking_id'
            USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*) INTO primary_membership_count
      FROM banquet_group_bookings bgb
     WHERE bgb.group_id = group_row.id
       AND bgb.booking_id = group_row.primary_booking_id
       AND LOWER(COALESCE(NULLIF(BTRIM(bgb.role), ''), '')) = 'primary';
    IF primary_membership_count <> 1 THEN
        RAISE EXCEPTION 'active banquet group requires exactly one primary membership'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO primary_row
      FROM bookings
     WHERE id = group_row.primary_booking_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'active banquet group primary booking is missing'
            USING ERRCODE = '23514';
    END IF;

    IF canonical_business_context_v332(primary_row.business_context) <> canonical_business_context_v332(group_row.business_context) THEN
        RAISE EXCEPTION 'active banquet group and primary booking business context mismatch'
            USING ERRCODE = '23514';
    END IF;

    IF COALESCE(BTRIM(primary_row.room_resource_id), '') = ''
       OR primary_row.room_resource_id IS DISTINCT FROM group_row.room_resource_id THEN
        RAISE EXCEPTION 'active banquet group and primary booking room resource mismatch'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION assert_booking_primary_group_identity_v332()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    group_row banquet_groups%ROWTYPE;
BEGIN
    FOR group_row IN
        SELECT *
          FROM banquet_groups bg
         WHERE bg.primary_booking_id = COALESCE(NEW.id, OLD.id)
           AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) <> 'cancelled'
    LOOP
        IF canonical_business_context_v332(group_row.business_context) = 'event_genix'
           AND (
                COALESCE(BTRIM(NEW.room_resource_id), '') = ''
                OR NEW.room_resource_id IS DISTINCT FROM group_row.room_resource_id
                OR canonical_business_context_v332(NEW.business_context) IS DISTINCT FROM canonical_business_context_v332(group_row.business_context)
           ) THEN
            RAISE EXCEPTION 'active banquet group and primary booking identity mismatch'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_banquet_groups_identity_v332 ON banquet_groups;
CREATE CONSTRAINT TRIGGER trg_banquet_groups_identity_v332
AFTER INSERT OR UPDATE ON banquet_groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION assert_banquet_group_identity_v332();

DROP TRIGGER IF EXISTS trg_banquet_group_bookings_identity_v332 ON banquet_group_bookings;
CREATE CONSTRAINT TRIGGER trg_banquet_group_bookings_identity_v332
AFTER INSERT OR UPDATE OR DELETE ON banquet_group_bookings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION assert_banquet_group_identity_v332();

DROP TRIGGER IF EXISTS trg_bookings_primary_banquet_identity_v332 ON bookings;
CREATE CONSTRAINT TRIGGER trg_bookings_primary_banquet_identity_v332
AFTER UPDATE OF business_context, room_resource_id, status ON bookings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION assert_booking_primary_group_identity_v332();

COMMENT ON CONSTRAINT chk_bookings_active_room_identity_v332 ON bookings IS
    'Future active EventGenix bookings require durable room_resource_id and non-corrupt room text; NOT VALID until approved cleanup reaches zero invalid active rows.';

COMMENT ON CONSTRAINT chk_banquet_groups_active_room_identity_v332 ON banquet_groups IS
    'Future active EventGenix banquet groups require durable room_resource_id and non-corrupt room text; NOT VALID until approved cleanup reaches zero invalid active rows.';
