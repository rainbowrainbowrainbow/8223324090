-- MIGRATION_KIND: schema
-- SAFETY: Non-destructive constraint widening for multi-business timelines. Existing bookings and line rows are preserved; the migration only replaces the old two-value business_context enum checks with key-format checks.
-- ROLLBACK: Drop bookings_business_context_format_check and lines_by_date_business_context_format_check, then restore the previous enum checks only after exporting or removing rows for contexts outside event_genix/maysternya_doli.
-- OPERATOR_APPROVAL: required

ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS bookings_business_context_check;

ALTER TABLE lines_by_date
    DROP CONSTRAINT IF EXISTS lines_by_date_business_context_check;

ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS bookings_business_context_format_check;

ALTER TABLE lines_by_date
    DROP CONSTRAINT IF EXISTS lines_by_date_business_context_format_check;

ALTER TABLE bookings
    ADD CONSTRAINT bookings_business_context_format_check
    CHECK (
        business_context IS NOT NULL
        AND business_context = lower(business_context)
        AND business_context ~ '^[a-z0-9_:-]{1,64}$'
    );

ALTER TABLE lines_by_date
    ADD CONSTRAINT lines_by_date_business_context_format_check
    CHECK (
        business_context IS NOT NULL
        AND business_context = lower(business_context)
        AND business_context ~ '^[a-z0-9_:-]{1,64}$'
    );
