-- Migration 003: Recurring Bookings
-- Feature #11: Adds recurring booking templates, skip log, and bookings FK

-- Recurring booking templates (stores schedule + booking data)
CREATE TABLE IF NOT EXISTS recurring_templates (
    id SERIAL PRIMARY KEY,

    -- Schedule pattern
    pattern TEXT NOT NULL,                -- 'weekly', 'biweekly', 'monthly', 'custom', 'weekdays', 'weekends'
    days_of_week INTEGER[],               -- [1,3,5] for Mon/Wed/Fri (1=Mon...7=Sun)
    interval_weeks INTEGER DEFAULT 1,     -- 1=weekly, 2=biweekly
    monthly_rule TEXT,                    -- '1st_6', '2nd_7', 'last_5' etc.

    -- Date range
    start_date DATE NOT NULL,
    end_date DATE,                        -- NULL = indefinite

    -- Time + location
    time_start TIME NOT NULL,
    time_end TIME NOT NULL,
    line_id INTEGER,                      -- preferred line (nullable, resolved by name at generation)
    preferred_line_name TEXT,             -- store name, resolve to line_id at generation time
    room TEXT,

    -- Program data (mirrors bookings table fields)
    product_id TEXT,
    product_code TEXT,
    product_label TEXT,
    product_name TEXT,
    category TEXT,
    duration INTEGER,
    price INTEGER,
    hosts INTEGER DEFAULT 1,

    -- Second animator (for 2-host programs)
    second_animator_name TEXT,            -- store name, resolve at generation time
    second_animator_line_id INTEGER,

    -- Optional booking fields
    pinata_filler TEXT,
    costume TEXT,
    kids_count INTEGER,
    group_name TEXT,
    notes TEXT,
    extra_data JSONB,

    -- Metadata
    status TEXT DEFAULT 'preliminary',    -- default status for generated bookings
    is_active BOOLEAN DEFAULT true,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_templates_active ON recurring_templates(is_active);

-- Skip/conflict log for recurring bookings
CREATE TABLE IF NOT EXISTS recurring_booking_skips (
    id SERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES recurring_templates(id) ON DELETE CASCADE,
    date VARCHAR(20) NOT NULL,
    reason VARCHAR(50) NOT NULL,          -- 'line_conflict', 'room_conflict', 'manual_skip', 'animator_unavailable'
    details TEXT,
    notified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(template_id, date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_skips_template ON recurring_booking_skips(template_id);
CREATE INDEX IF NOT EXISTS idx_recurring_skips_date ON recurring_booking_skips(date);

-- Link bookings back to their recurring template
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurring_template_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_bookings_recurring_template_id ON bookings(recurring_template_id);
