-- 062_training_homework.sql — Training assignments & homework
-- v25.4.0

CREATE TABLE IF NOT EXISTS training_assignments (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(30) DEFAULT 'homework',
    -- types: homework, watch, read, create, practice
    resource_url TEXT,
    assigned_to INTEGER[] DEFAULT '{}',
    -- array of staff_ids (empty = everyone)
    assigned_by INTEGER NOT NULL,
    due_date TIMESTAMPTZ,
    points INTEGER DEFAULT 10,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assignments_active ON training_assignments(is_active);

CREATE TABLE IF NOT EXISTS training_submissions (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES training_assignments(id) ON DELETE CASCADE,
    staff_id INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    -- statuses: pending, submitted, approved, rejected, overdue
    submission_text TEXT,
    submitted_at TIMESTAMPTZ,
    reviewed_by INTEGER,
    review_comment TEXT,
    score INTEGER,
    reviewed_at TIMESTAMPTZ,
    UNIQUE(assignment_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_submissions_staff ON training_submissions(staff_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON training_submissions(status);
