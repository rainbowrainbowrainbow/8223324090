-- MIGRATION_KIND: schema
-- SAFETY: Refuses to harden while any banquet group has no valid persisted HH:mm arrival, then adds only a NOT NULL constraint; migration 284 and deterministic backfill 285 must already be deployed.
-- ROLLBACK: Drop only the NOT NULL constraint with ALTER TABLE banquet_groups ALTER COLUMN guest_arrival_time DROP NOT NULL; keep the column and persisted values.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM banquet_groups
         WHERE guest_arrival_time IS NULL
            OR guest_arrival_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ) THEN
        RAISE EXCEPTION
            'Migration 286 requires every banquet group to have a valid persisted guest_arrival_time';
    END IF;
END
$$;

ALTER TABLE banquet_groups
    ALTER COLUMN guest_arrival_time SET NOT NULL;

COMMENT ON COLUMN banquet_groups.guest_arrival_time IS
    'Required canonical guest arrival time for the banquet group in HH:mm format.';
