-- MIGRATION_KIND: schema
-- SAFETY: Additive context columns for isolated timeline data and additive user access metadata. Existing Event Genix rows keep the default event_genix context.
-- ROLLBACK: Drop idx_bookings_business_date, idx_lines_business_date, the added check/unique constraints, the business_context columns, users.extra_roles, and users.page_allowlist after exporting any maysternya_doli data.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS extra_roles TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS page_allowlist TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE lines_by_date
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE bookings
    ADD CONSTRAINT bookings_business_context_check
    CHECK (business_context IN ('event_genix', 'maysternya_doli'));

ALTER TABLE lines_by_date
    ADD CONSTRAINT lines_by_date_business_context_check
    CHECK (business_context IN ('event_genix', 'maysternya_doli'));

ALTER TABLE lines_by_date
    ADD CONSTRAINT lines_by_date_business_context_date_line_id_key
    UNIQUE (business_context, date, line_id);

CREATE INDEX IF NOT EXISTS idx_bookings_business_date
    ON bookings (business_context, date, status);

CREATE INDEX IF NOT EXISTS idx_lines_business_date
    ON lines_by_date (business_context, date);
