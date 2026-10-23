-- MIGRATION_KIND: schema
-- SAFETY: Additive table only. Existing 15-minute Іменинники events and legacy birthday records retain their rows; no operational rows are rewritten.
-- ROLLBACK: Roll back the application code and retain this table so manual slot choices can be recovered.

CREATE TABLE IF NOT EXISTS afisha_birthday_slots (
    afisha_id INTEGER NOT NULL REFERENCES afisha(id) ON DELETE CASCADE,
    slot_key VARCHAR(10) NOT NULL CHECK (slot_key IN ('first', 'second', 'single')),
    time VARCHAR(5) NOT NULL CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    mode VARCHAR(6) NOT NULL CHECK (mode IN ('auto', 'manual')),
    updated_by VARCHAR(200),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (afisha_id, slot_key)
);
