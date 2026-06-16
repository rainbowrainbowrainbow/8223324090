-- MIGRATION_KIND: schema
-- SAFETY: Adds separate banquet group tables and indexes only; existing bookings and booking_banquet_links are not rewritten.
-- ROLLBACK: Export any needed banquet group metadata, then DROP TABLE IF EXISTS banquet_group_bookings; DROP TABLE IF EXISTS banquet_groups;

CREATE TABLE IF NOT EXISTS banquet_groups (
    id                  VARCHAR(50) PRIMARY KEY,
    business_context    VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    primary_booking_id  VARCHAR(50) REFERENCES bookings(id) ON DELETE SET NULL,
    customer_id         INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    date                VARCHAR(20) NOT NULL,
    room                VARCHAR(100),
    group_name          VARCHAR(200),
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
    source              VARCHAR(64) DEFAULT 'manual',
    meta                JSONB DEFAULT '{}'::jsonb,
    created_by_user_id  INTEGER,
    created_by          VARCHAR(100),
    updated_by          VARCHAR(100),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT banquet_groups_status_check
        CHECK (status IN ('active', 'closed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS banquet_group_bookings (
    id                  SERIAL PRIMARY KEY,
    group_id            VARCHAR(50) NOT NULL REFERENCES banquet_groups(id) ON DELETE CASCADE,
    business_context    VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    booking_id          VARCHAR(50) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    role                VARCHAR(32) NOT NULL DEFAULT 'manual',
    sort_order          INTEGER DEFAULT 100,
    created_by_user_id  INTEGER,
    created_by          VARCHAR(100),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT banquet_group_bookings_role_check
        CHECK (role IN ('primary', 'kitchen', 'activity', 'service', 'manual')),
    CONSTRAINT banquet_group_bookings_booking_unique
        UNIQUE (booking_id),
    CONSTRAINT banquet_group_bookings_group_booking_unique
        UNIQUE (group_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_banquet_groups_business_date
    ON banquet_groups(business_context, date);

CREATE INDEX IF NOT EXISTS idx_banquet_groups_primary_booking
    ON banquet_groups(primary_booking_id);

CREATE INDEX IF NOT EXISTS idx_banquet_group_bookings_group
    ON banquet_group_bookings(group_id);

CREATE INDEX IF NOT EXISTS idx_banquet_group_bookings_booking
    ON banquet_group_bookings(booking_id);
