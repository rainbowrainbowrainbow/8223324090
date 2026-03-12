-- 065_meeting_notes.sql — Meeting notes with auto-task creation
-- v25.4.0

CREATE TABLE IF NOT EXISTS meeting_notes (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    content TEXT,
    meeting_date DATE NOT NULL,
    duration_minutes INTEGER,
    participants INTEGER[] DEFAULT '{}',
    created_by INTEGER NOT NULL,
    channel_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_date ON meeting_notes(meeting_date DESC);

CREATE TABLE IF NOT EXISTS meeting_action_items (
    id SERIAL PRIMARY KEY,
    meeting_id INTEGER NOT NULL REFERENCES meeting_notes(id) ON DELETE CASCADE,
    task_id INTEGER,
    description TEXT NOT NULL,
    assigned_to INTEGER,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_action_items_meeting ON meeting_action_items(meeting_id);
