-- MIGRATION_KIND: schema
-- SAFETY: Creates the event-scoped Afisha materials table with an ON DELETE CASCADE link to afisha events. No existing data is changed.
-- ROLLBACK: DROP TABLE IF EXISTS afisha_event_materials;

CREATE TABLE IF NOT EXISTS afisha_event_materials (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES afisha(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL DEFAULT 'note',
    title VARCHAR(180) NOT NULL,
    description TEXT,
    url TEXT,
    original_name TEXT,
    mime_type TEXT,
    file_size INTEGER,
    file_data BYTEA,
    uploaded_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_afisha_event_materials_event_id
    ON afisha_event_materials(event_id);
