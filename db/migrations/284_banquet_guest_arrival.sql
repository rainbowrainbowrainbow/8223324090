-- MIGRATION_KIND: schema
-- SAFETY: Adds one nullable banquet-group field and an idempotent format constraint; existing groups and bookings are not rewritten.
-- ROLLBACK: Previous application code safely ignores the additive column. After exporting any written arrival values, drop the constraint and column explicitly if a full schema rollback is required.

ALTER TABLE banquet_groups
    ADD COLUMN IF NOT EXISTS guest_arrival_time VARCHAR(5);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'banquet_groups_guest_arrival_time_check'
           AND conrelid = 'banquet_groups'::regclass
    ) THEN
        ALTER TABLE banquet_groups
            ADD CONSTRAINT banquet_groups_guest_arrival_time_check
            CHECK (
                guest_arrival_time IS NULL
                OR guest_arrival_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            );
    END IF;
END
$$;

COMMENT ON COLUMN banquet_groups.guest_arrival_time IS
    'Canonical guest arrival time for the banquet group in HH:mm format.';
