-- MIGRATION_KIND: mixed
-- SAFETY: Additive HR training readiness links. Adds nullable profession markers to schedule tables, a checklist-progress table, and idempotent seed courses from existing hr_professions.checklist rows with fallback test checklist items for empty professions.
-- ROLLBACK: Drop hr_staff_profession_checklist_progress, remove profession_key/source columns from training course and schedule tables if needed, and delete training_courses where source = 'hr_profession_seed'.

ALTER TABLE staff_schedule
    ADD COLUMN IF NOT EXISTS profession_key VARCHAR(64);

ALTER TABLE hr_shifts
    ADD COLUMN IF NOT EXISTS profession_key VARCHAR(64);

ALTER TABLE training_courses
    ADD COLUMN IF NOT EXISTS profession_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS source VARCHAR(60) NOT NULL DEFAULT 'manual';

ALTER TABLE training_course_lectures
    ADD COLUMN IF NOT EXISTS profession_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS checklist_key VARCHAR(128),
    ADD COLUMN IF NOT EXISTS checklist_item TEXT;

CREATE TABLE IF NOT EXISTS hr_staff_profession_checklist_progress (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    profession_key VARCHAR(64) NOT NULL,
    checklist_key VARCHAR(128) NOT NULL,
    title TEXT NOT NULL,
    completed_at TIMESTAMPTZ,
    completed_by VARCHAR(80),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(staff_id, profession_key, checklist_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_schedule_profession_key
    ON staff_schedule(profession_key);

CREATE INDEX IF NOT EXISTS idx_hr_shifts_profession_key
    ON hr_shifts(profession_key);

CREATE INDEX IF NOT EXISTS idx_training_courses_profession_key
    ON training_courses(profession_key);

CREATE INDEX IF NOT EXISTS idx_training_courses_source
    ON training_courses(source);

CREATE INDEX IF NOT EXISTS idx_training_course_lectures_profession_key
    ON training_course_lectures(profession_key);

CREATE INDEX IF NOT EXISTS idx_hr_staff_profession_progress_staff
    ON hr_staff_profession_checklist_progress(staff_id, profession_key);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_courses_hr_profession_seed
    ON training_courses(profession_key)
    WHERE source = 'hr_profession_seed' AND profession_key IS NOT NULL;

UPDATE staff_schedule ss
SET profession_key = s.role_type
FROM staff s
WHERE s.id = ss.staff_id
  AND ss.profession_key IS NULL
  AND ss.status IN ('working', 'remote')
  AND NULLIF(s.role_type, '') IS NOT NULL;

UPDATE hr_shifts hs
SET profession_key = s.role_type
FROM staff s
WHERE s.id = hs.staff_id
  AND hs.profession_key IS NULL
  AND NULLIF(s.role_type, '') IS NOT NULL;

WITH seed_professions AS (
    SELECT
        p.*,
        CASE
            WHEN COALESCE(jsonb_array_length(p.checklist), 0) > 0 THEN p.checklist
            ELSE jsonb_build_array(
                'Ознайомитися з роллю "' || p.title || '" і стандартами зміни',
                'Пройти інструктаж безпеки та правил взаємодії з гостями',
                'Відпрацювати пробну зміну з наставником',
                'Підтвердити готовність до самостійної зміни'
            )
        END AS readiness_checklist
    FROM hr_professions p
)
UPDATE training_courses c
SET
    title = 'Базове навчання: ' || p.title,
    description = COALESCE(NULLIF(p.short_info, ''), 'Базовий чек-лист готовності для професії "' || p.title || '".'),
    icon = COALESCE(c.icon, '📚'),
    target_roles = ARRAY[p.key],
    estimated_hours = GREATEST(1.0, jsonb_array_length(p.readiness_checklist) * 0.5),
    profession_key = p.key,
    source = 'hr_profession_seed'
FROM seed_professions p
WHERE c.source = 'hr_profession_seed'
  AND c.profession_key = p.key;

INSERT INTO training_courses (title, description, icon, target_roles, lectures_count, estimated_hours, profession_key, source, is_active)
SELECT
    'Базове навчання: ' || p.title,
    COALESCE(NULLIF(p.short_info, ''), 'Базовий чек-лист готовності для професії "' || p.title || '".'),
    '📚',
    ARRAY[p.key],
    jsonb_array_length(p.readiness_checklist),
    GREATEST(1.0, jsonb_array_length(p.readiness_checklist) * 0.5),
    p.key,
    'hr_profession_seed',
    p.is_active
FROM (
    SELECT
        hp.*,
        CASE
            WHEN COALESCE(jsonb_array_length(hp.checklist), 0) > 0 THEN hp.checklist
            ELSE jsonb_build_array(
                'Ознайомитися з роллю "' || hp.title || '" і стандартами зміни',
                'Пройти інструктаж безпеки та правил взаємодії з гостями',
                'Відпрацювати пробну зміну з наставником',
                'Підтвердити готовність до самостійної зміни'
            )
        END AS readiness_checklist
    FROM hr_professions hp
) p
WHERE p.is_active = true
  AND NOT EXISTS (
      SELECT 1
      FROM training_courses existing
      WHERE existing.source = 'hr_profession_seed'
        AND existing.profession_key = p.key
  );

WITH checklist_items AS (
    SELECT
        c.id AS course_id,
        p.key AS profession_key,
        item.value AS checklist_item,
        item.ordinality::integer AS sort_order,
        'item_' || item.ordinality::text AS checklist_key
    FROM hr_professions p
    JOIN training_courses c
      ON c.source = 'hr_profession_seed'
     AND c.profession_key = p.key
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
            WHEN COALESCE(jsonb_array_length(p.checklist), 0) > 0 THEN p.checklist
            ELSE jsonb_build_array(
                'Ознайомитися з роллю "' || p.title || '" і стандартами зміни',
                'Пройти інструктаж безпеки та правил взаємодії з гостями',
                'Відпрацювати пробну зміну з наставником',
                'Підтвердити готовність до самостійної зміни'
            )
        END
    ) WITH ORDINALITY AS item(value, ordinality)
    WHERE p.is_active = true
)
INSERT INTO training_course_lectures (
    course_id,
    title,
    description,
    sort_order,
    duration_minutes,
    is_published,
    profession_key,
    checklist_key,
    checklist_item
)
SELECT
    item.course_id,
    item.checklist_item,
    'Практичний чек-пункт професії. HR закриває його після перевірки навички на зміні або навчанні.',
    item.sort_order - 1,
    30,
    true,
    item.profession_key,
    item.checklist_key,
    item.checklist_item
FROM checklist_items item
WHERE NOT EXISTS (
    SELECT 1
    FROM training_course_lectures existing
    WHERE existing.course_id = item.course_id
      AND existing.profession_key = item.profession_key
      AND existing.checklist_key = item.checklist_key
);

UPDATE training_courses c
SET lectures_count = lecture_counts.total
FROM (
    SELECT course_id, COUNT(*)::integer AS total
    FROM training_course_lectures
    WHERE profession_key IS NOT NULL
    GROUP BY course_id
) lecture_counts
WHERE c.id = lecture_counts.course_id
  AND c.source = 'hr_profession_seed';
