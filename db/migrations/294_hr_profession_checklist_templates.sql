-- MIGRATION_KIND: mixed
-- SAFETY: Adds normalized profession checklist items and nullable references. Existing JSON templates and progress history are preserved; only unambiguous title matches are linked to stable keys, while unresolved legacy item_N rows remain intact and are reported.
-- OPERATOR_APPROVAL: confirmed by the user for Task 5 before implementation.
-- DATA_SCOPE: All current hr_professions.checklist arrays, profession-seeded training lectures, and hr_staff_profession_checklist_progress rows that still use positional item_N keys.
-- ROLLBACK: Export the normalized tables and progress references first. Restore progress.checklist_key from legacy_checklist_key where needed, unlink checklist_item_id columns, then drop the new indexes, columns, report table, and item table. Restore profession-seeded training lectures from the pre-migration backup if their mirror must be reverted.

CREATE TABLE IF NOT EXISTS hr_profession_checklist_items (
    id BIGSERIAL PRIMARY KEY,
    profession_id INTEGER NOT NULL REFERENCES hr_professions(id) ON DELETE RESTRICT,
    item_key VARCHAR(128) NOT NULL,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT true,
    legacy_position INTEGER,
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hr_profession_checklist_item_key UNIQUE (profession_id, item_key),
    CONSTRAINT chk_hr_profession_checklist_item_key_nonblank CHECK (BTRIM(item_key) <> ''),
    CONSTRAINT chk_hr_profession_checklist_item_title_nonblank CHECK (BTRIM(title) <> ''),
    CONSTRAINT chk_hr_profession_checklist_item_sort_order CHECK (sort_order >= 0),
    CONSTRAINT chk_hr_profession_checklist_item_legacy_position CHECK (legacy_position IS NULL OR legacy_position > 0)
);

CREATE INDEX IF NOT EXISTS idx_hr_profession_checklist_items_profession_order
    ON hr_profession_checklist_items(profession_id, is_active DESC, sort_order, id);

ALTER TABLE hr_staff_profession_checklist_progress
    ADD COLUMN IF NOT EXISTS checklist_item_id BIGINT REFERENCES hr_profession_checklist_items(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS legacy_checklist_key VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_hr_staff_profession_progress_item
    ON hr_staff_profession_checklist_progress(checklist_item_id)
    WHERE checklist_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hr_profession_checklist_migration_issues (
    id BIGSERIAL PRIMARY KEY,
    progress_id INTEGER NOT NULL REFERENCES hr_staff_profession_checklist_progress(id) ON DELETE CASCADE,
    profession_key VARCHAR(64) NOT NULL,
    legacy_checklist_key VARCHAR(128) NOT NULL,
    legacy_title TEXT,
    reason VARCHAR(80) NOT NULL,
    candidate_item_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(100),
    resolution_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hr_profession_checklist_migration_issue_progress UNIQUE (progress_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_profession_checklist_migration_issues_open
    ON hr_profession_checklist_migration_issues(profession_key, created_at)
    WHERE resolved_at IS NULL;

ALTER TABLE training_course_lectures
    ADD COLUMN IF NOT EXISTS checklist_item_id BIGINT REFERENCES hr_profession_checklist_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_training_course_lectures_checklist_item
    ON training_course_lectures(checklist_item_id)
    WHERE checklist_item_id IS NOT NULL;

INSERT INTO hr_profession_checklist_items (
    profession_id,
    item_key,
    title,
    sort_order,
    is_active,
    legacy_position,
    created_by,
    updated_by
)
SELECT
    profession.id,
    'chk_' || SUBSTRING(MD5(profession.key || ':' || item.ordinality::text || ':' || item.value) FROM 1 FOR 24),
    BTRIM(item.value),
    item.ordinality::integer * 10,
    true,
    item.ordinality::integer,
    'migration_294',
    'migration_294'
FROM hr_professions profession
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
        WHEN jsonb_typeof(profession.checklist) = 'array' THEN profession.checklist
        ELSE '[]'::jsonb
    END
) WITH ORDINALITY AS item(value, ordinality)
WHERE BTRIM(item.value) <> ''
ON CONFLICT (profession_id, item_key) DO NOTHING;

UPDATE hr_staff_profession_checklist_progress
SET legacy_checklist_key = checklist_key
WHERE checklist_item_id IS NULL
  AND legacy_checklist_key IS NULL
  AND checklist_key ~ '^item_[1-9][0-9]*$';

UPDATE hr_staff_profession_checklist_progress progress
SET checklist_item_id = item.id
FROM hr_professions profession
JOIN hr_profession_checklist_items item ON item.profession_id = profession.id
WHERE progress.checklist_item_id IS NULL
  AND progress.profession_key = profession.key
  AND progress.checklist_key = item.item_key;

WITH title_candidates AS (
    SELECT
        progress.id AS progress_id,
        progress.staff_id,
        item.id AS item_id,
        item.item_key,
        COUNT(*) OVER (PARTITION BY progress.id) AS progress_match_count
    FROM hr_staff_profession_checklist_progress progress
    JOIN hr_professions profession ON profession.key = progress.profession_key
    JOIN hr_profession_checklist_items item ON item.profession_id = profession.id
    WHERE progress.checklist_item_id IS NULL
      AND progress.checklist_key ~ '^item_[1-9][0-9]*$'
      AND LOWER(BTRIM(item.title)) = LOWER(BTRIM(progress.title))
), unique_title_candidates AS (
    SELECT
        candidate.*,
        COUNT(*) OVER (PARTITION BY candidate.staff_id, candidate.item_id) AS target_match_count
    FROM title_candidates candidate
    WHERE candidate.progress_match_count = 1
), safe_candidates AS (
    SELECT candidate.*
    FROM unique_title_candidates candidate
    WHERE candidate.target_match_count = 1
      AND NOT EXISTS (
          SELECT 1
          FROM hr_staff_profession_checklist_progress existing
          WHERE existing.staff_id = candidate.staff_id
            AND existing.checklist_item_id = candidate.item_id
            AND existing.id <> candidate.progress_id
      )
)
UPDATE hr_staff_profession_checklist_progress progress
SET checklist_item_id = candidate.item_id,
    checklist_key = candidate.item_key,
    updated_at = progress.updated_at
FROM safe_candidates candidate
WHERE progress.id = candidate.progress_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_staff_profession_progress_staff_item
    ON hr_staff_profession_checklist_progress(staff_id, checklist_item_id)
    WHERE checklist_item_id IS NOT NULL;

INSERT INTO hr_profession_checklist_migration_issues (
    progress_id,
    profession_key,
    legacy_checklist_key,
    legacy_title,
    reason,
    candidate_item_keys
)
SELECT
    progress.id,
    progress.profession_key,
    COALESCE(progress.legacy_checklist_key, progress.checklist_key),
    progress.title,
    'legacy_key_not_unambiguously_reconciled',
    COALESCE((
        SELECT jsonb_agg(item.item_key ORDER BY item.sort_order, item.id)
        FROM hr_professions profession
        JOIN hr_profession_checklist_items item ON item.profession_id = profession.id
        WHERE profession.key = progress.profession_key
          AND LOWER(BTRIM(item.title)) = LOWER(BTRIM(progress.title))
    ), '[]'::jsonb)
FROM hr_staff_profession_checklist_progress progress
WHERE progress.checklist_item_id IS NULL
  AND progress.checklist_key ~ '^item_[1-9][0-9]*$'
ON CONFLICT (progress_id) DO NOTHING;

INSERT INTO training_courses (
    title,
    description,
    icon,
    target_roles,
    lectures_count,
    estimated_hours,
    profession_key,
    source,
    is_active
)
SELECT
    'Базове навчання: ' || profession.title,
    COALESCE(NULLIF(profession.short_info, ''), 'Керований чекліст готовності для професії "' || profession.title || '".'),
    '📚',
    ARRAY[profession.key],
    COUNT(item.id) FILTER (WHERE item.is_active)::integer,
    CASE
        WHEN COUNT(item.id) FILTER (WHERE item.is_active) > 0
            THEN GREATEST(1.0, COUNT(item.id) FILTER (WHERE item.is_active) * 0.5)
        ELSE 0
    END,
    profession.key,
    'hr_profession_seed',
    profession.is_active AND COUNT(item.id) FILTER (WHERE item.is_active) > 0
FROM hr_professions profession
JOIN hr_profession_checklist_items item ON item.profession_id = profession.id
GROUP BY profession.id
HAVING NOT EXISTS (
    SELECT 1
    FROM training_courses existing
    WHERE existing.source = 'hr_profession_seed'
      AND existing.profession_key = profession.key
);

WITH lecture_candidates AS (
    SELECT
        lecture.id AS lecture_id,
        item.id AS item_id,
        item.item_key,
        COUNT(*) OVER (PARTITION BY lecture.id) AS lecture_match_count
    FROM training_course_lectures lecture
    JOIN training_courses course
      ON course.id = lecture.course_id
     AND course.source = 'hr_profession_seed'
    JOIN hr_professions profession ON profession.key = course.profession_key
    JOIN hr_profession_checklist_items item ON item.profession_id = profession.id
    WHERE lecture.checklist_item_id IS NULL
      AND LOWER(BTRIM(COALESCE(lecture.checklist_item, lecture.title))) = LOWER(BTRIM(item.title))
), unique_lecture_candidates AS (
    SELECT
        candidate.*,
        COUNT(*) OVER (PARTITION BY candidate.item_id) AS target_match_count
    FROM lecture_candidates candidate
    WHERE candidate.lecture_match_count = 1
)
UPDATE training_course_lectures lecture
SET checklist_item_id = candidate.item_id,
    checklist_key = candidate.item_key
FROM unique_lecture_candidates candidate
WHERE lecture.id = candidate.lecture_id
  AND candidate.target_match_count = 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_training_course_lectures_checklist_item
    ON training_course_lectures(checklist_item_id)
    WHERE checklist_item_id IS NOT NULL;

INSERT INTO training_course_lectures (
    course_id,
    title,
    description,
    sort_order,
    duration_minutes,
    is_published,
    profession_key,
    checklist_key,
    checklist_item,
    checklist_item_id
)
SELECT
    course.id,
    LEFT(item.title, 255),
    'Практичний пункт керованого чекліста професії.',
    item.sort_order,
    30,
    item.is_active AND profession.is_active,
    profession.key,
    item.item_key,
    item.title,
    item.id
FROM hr_profession_checklist_items item
JOIN hr_professions profession ON profession.id = item.profession_id
JOIN training_courses course
  ON course.source = 'hr_profession_seed'
 AND course.profession_key = profession.key
WHERE NOT EXISTS (
    SELECT 1
    FROM training_course_lectures existing
    WHERE existing.checklist_item_id = item.id
);

UPDATE training_course_lectures lecture
SET title = LEFT(item.title, 255),
    sort_order = item.sort_order,
    is_published = item.is_active AND profession.is_active,
    profession_key = profession.key,
    checklist_key = item.item_key,
    checklist_item = item.title
FROM hr_profession_checklist_items item
JOIN hr_professions profession ON profession.id = item.profession_id
WHERE lecture.checklist_item_id = item.id;

UPDATE training_course_lectures lecture
SET is_published = false
FROM training_courses course
WHERE course.id = lecture.course_id
  AND course.source = 'hr_profession_seed'
  AND lecture.profession_key IS NOT NULL
  AND lecture.checklist_item_id IS NULL;

WITH item_counts AS (
    SELECT
        profession.id AS profession_id,
        COUNT(item.id) FILTER (WHERE item.is_active)::integer AS active_count
    FROM hr_professions profession
    LEFT JOIN hr_profession_checklist_items item ON item.profession_id = profession.id
    GROUP BY profession.id
)
UPDATE training_courses course
SET title = 'Базове навчання: ' || profession.title,
    description = COALESCE(NULLIF(profession.short_info, ''), 'Керований чекліст готовності для професії "' || profession.title || '".'),
    target_roles = ARRAY[profession.key],
    lectures_count = item_counts.active_count,
    estimated_hours = CASE
        WHEN item_counts.active_count > 0 THEN GREATEST(1.0, item_counts.active_count * 0.5)
        ELSE 0
    END,
    is_active = profession.is_active AND item_counts.active_count > 0
FROM hr_professions profession
JOIN item_counts ON item_counts.profession_id = profession.id
WHERE course.source = 'hr_profession_seed'
  AND course.profession_key = profession.key;

COMMENT ON TABLE hr_profession_checklist_items IS
    'Canonical profession checklist template. hr_professions.checklist is a compatibility mirror only.';

COMMENT ON TABLE hr_profession_checklist_migration_issues IS
    'Unresolved legacy item_N progress retained for manual reconciliation; no completion history is discarded.';
