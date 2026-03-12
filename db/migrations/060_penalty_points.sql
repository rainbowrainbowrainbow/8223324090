-- 060_penalty_points.sql — Staff penalty points system
-- v25.4.0

CREATE TABLE IF NOT EXISTS staff_penalties (
    id SERIAL PRIMARY KEY,
    staff_username VARCHAR(50) NOT NULL,
    points INTEGER NOT NULL DEFAULT 1,
    reason TEXT NOT NULL,
    category VARCHAR(30) DEFAULT 'discipline',
    -- categories: discipline, initiative, quality, attendance, safety
    issued_by VARCHAR(50) NOT NULL,
    meeting_date DATE,
    reversed BOOLEAN DEFAULT false,
    reversed_by VARCHAR(50),
    reversed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_penalties_username ON staff_penalties(staff_username);
CREATE INDEX IF NOT EXISTS idx_penalties_date ON staff_penalties(created_at DESC);
