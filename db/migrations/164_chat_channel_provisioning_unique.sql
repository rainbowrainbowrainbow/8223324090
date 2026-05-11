-- MIGRATION_KIND: schema
-- SAFETY: Adds partial unique indexes for active booking/room chat channels when existing data is already duplicate-free; if legacy active duplicates exist, the migration skips the index and leaves route-level deterministic slug provisioning to prevent new duplicates.
-- ROLLBACK: DROP INDEX IF EXISTS uniq_chat_channels_booking_active; DROP INDEX IF EXISTS uniq_chat_channels_room_line_active;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uniq_chat_channels_booking_active'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM chat_channels
            WHERE linked_booking_id IS NOT NULL
              AND COALESCE(is_archived, false) = false
            GROUP BY linked_booking_id
            HAVING COUNT(*) > 1
        ) THEN
            RAISE NOTICE 'Skipping uniq_chat_channels_booking_active because active duplicate booking channels already exist';
        ELSE
            EXECUTE 'CREATE UNIQUE INDEX uniq_chat_channels_booking_active ON chat_channels(linked_booking_id) WHERE linked_booking_id IS NOT NULL AND COALESCE(is_archived, false) = false';
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uniq_chat_channels_room_line_active'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM chat_channels
            WHERE line_id IS NOT NULL
              AND type = ''room''
              AND COALESCE(is_archived, false) = false
            GROUP BY line_id
            HAVING COUNT(*) > 1
        ) THEN
            RAISE NOTICE 'Skipping uniq_chat_channels_room_line_active because active duplicate room channels already exist';
        ELSE
            EXECUTE 'CREATE UNIQUE INDEX uniq_chat_channels_room_line_active ON chat_channels(line_id) WHERE line_id IS NOT NULL AND type = ''room'' AND COALESCE(is_archived, false) = false';
        END IF;
    END IF;
END $$;
