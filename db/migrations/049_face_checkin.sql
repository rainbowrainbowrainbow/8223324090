-- v22.18: Face Recognition Check-in MVP (#24)

-- Staff face descriptors (128-float vector stored as JSON array)
CREATE TABLE IF NOT EXISTS staff_face_descriptors (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    descriptor JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(staff_id)
);

-- Check-in/check-out records
CREATE TABLE IF NOT EXISTS staff_checkins (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in TIMESTAMP,
    check_out TIMESTAMP,
    method VARCHAR(20) DEFAULT 'face',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(staff_id, date)
);

CREATE INDEX IF NOT EXISTS idx_staff_checkins_date ON staff_checkins (date);
