-- 064_training_courses.sql — Curriculum builder / course system
-- v25.4.0

CREATE TABLE IF NOT EXISTS training_courses (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(10) DEFAULT '📚',
    instructor_id INTEGER,
    target_roles TEXT[] DEFAULT '{}',
    lectures_count INTEGER DEFAULT 0,
    estimated_hours DECIMAL(4,1) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_course_lectures (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    article_id INTEGER,
    resource_urls JSONB DEFAULT '[]',
    -- [{url, title, type: "video"|"article"|"tool"}]
    duration_minutes INTEGER DEFAULT 60,
    is_published BOOLEAN DEFAULT false,
    scheduled_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_course_lectures_course ON training_course_lectures(course_id);

CREATE TABLE IF NOT EXISTS training_course_enrollment (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
    staff_id INTEGER NOT NULL,
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    current_lecture INTEGER DEFAULT 0,
    completed_at TIMESTAMPTZ,
    UNIQUE(course_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollment_staff ON training_course_enrollment(staff_id);
