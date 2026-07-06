-- MIGRATION_KIND: mixed
-- SAFETY: Additive table for staff-level default shift preferences. Backfill inserts only preference rows for current staff professions and never updates staff_schedule or hr_shifts.
-- DATA_SCOPE: Current staff rows whose primary or secondary profession is animator, instructor, trampoline_instructor, or senior_instructor.
-- ROLLBACK: Export staff_shift_preferences if needed, then DROP TABLE staff_shift_preferences. Existing actual schedule rows remain unchanged.

CREATE TABLE IF NOT EXISTS staff_shift_preferences (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    profession_key VARCHAR(64) NOT NULL,
    day_type VARCHAR(16) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_staff_shift_preferences_staff_profession_day UNIQUE (staff_id, profession_key, day_type),
    CONSTRAINT chk_staff_shift_preferences_day_type CHECK (day_type IN ('weekday', 'weekend')),
    CONSTRAINT chk_staff_shift_preferences_distinct_time CHECK (start_time <> end_time)
);

CREATE INDEX IF NOT EXISTS idx_staff_shift_preferences_staff_active
    ON staff_shift_preferences(staff_id, is_active);

CREATE INDEX IF NOT EXISTS idx_staff_shift_preferences_profession_day
    ON staff_shift_preferences(profession_key, day_type)
    WHERE is_active = true;

WITH staff_professions AS (
    SELECT DISTINCT
        s.id AS staff_id,
        lower(regexp_replace(trim(p.profession_key), '[^a-zA-Z0-9_:-]+', '_', 'g')) AS profession_key
    FROM staff s
    CROSS JOIN LATERAL (
        SELECT NULLIF(trim(COALESCE(s.role_type, '')), '') AS profession_key
        UNION ALL
        SELECT NULLIF(trim(secondary.value), '') AS profession_key
        FROM jsonb_array_elements_text(COALESCE(s.secondary_professions, '[]'::jsonb)) AS secondary(value)
    ) p
    WHERE NULLIF(trim(COALESCE(p.profession_key, '')), '') IS NOT NULL
),
default_preferences AS (
    SELECT *
    FROM (VALUES
        ('animator', 'weekday', '12:00'::time, '20:00'::time),
        ('animator', 'weekend', '10:00'::time, '20:00'::time),
        ('instructor', 'weekday', '11:00'::time, '20:00'::time),
        ('instructor', 'weekend', '09:00'::time, '20:00'::time),
        ('trampoline_instructor', 'weekday', '11:00'::time, '20:00'::time),
        ('trampoline_instructor', 'weekend', '09:00'::time, '20:00'::time),
        ('senior_instructor', 'weekday', '11:00'::time, '20:00'::time),
        ('senior_instructor', 'weekend', '09:00'::time, '20:00'::time)
    ) AS defaults(profession_key, day_type, start_time, end_time)
)
INSERT INTO staff_shift_preferences
    (staff_id, profession_key, day_type, start_time, end_time, is_active, created_by, updated_by)
SELECT
    sp.staff_id,
    sp.profession_key,
    dp.day_type,
    dp.start_time,
    dp.end_time,
    true,
    'migration_279',
    'migration_279'
FROM staff_professions sp
JOIN default_preferences dp ON dp.profession_key = sp.profession_key
ON CONFLICT (staff_id, profession_key, day_type) DO NOTHING;
