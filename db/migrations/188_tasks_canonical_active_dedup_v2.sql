-- MIGRATION_KIND: data-fix
-- SAFETY: Non-destructively archives active task duplicates using the v2 canonical business signature. No rows are deleted.
-- ROLLBACK: Restore rows with archive_reason='auto_duplicate_v2' manually if needed, then clear duplicate_of_task_id for those rows.

WITH active AS (
    SELECT
        t.id,
        concat_ws('|',
            lower(regexp_replace(trim(COALESCE(t.title, '')), '\s+', ' ', 'g')),
            COALESCE(t.date::text, ''),
            lower(COALESCE(t.category, 'admin')),
            lower(COALESCE(t.subcategory, '')),
            COALESCE(t.owner_user_id::text, ''),
            lower(COALESCE(t.checklist_template_key, '')),
            CASE
                WHEN COALESCE(t.template_id::text, '') <> '' THEN 'template:' || t.template_id::text
                WHEN COALESCE(t.pack_id::text, '') <> '' THEN 'pack:' || t.pack_id::text
                WHEN COALESCE(t.source_entity_type, '') <> '' AND COALESCE(t.source_entity_id::text, '') <> ''
                    THEN 'entity:' || lower(t.source_entity_type) || ':' || t.source_entity_id::text
                WHEN COALESCE(t.afisha_id::text, '') <> '' THEN 'afisha:' || t.afisha_id::text
                WHEN lower(COALESCE(t.source_type, 'manual')) NOT IN ('manual','assistant','assistant_command','command')
                     AND COALESCE(t.source_id::text, '') <> ''
                    THEN lower(COALESCE(t.source_type, 'manual')) || ':' || t.source_id::text
                ELSE ''
            END
        ) AS signature
    FROM tasks t
    WHERE COALESCE(t.status, 'todo') NOT IN ('done','archived','cancelled')
      AND COALESCE(trim(t.title), '') <> ''
),
ranked AS (
    SELECT
        id,
        MIN(id) OVER (PARTITION BY signature) AS canonical_id,
        ROW_NUMBER() OVER (PARTITION BY signature ORDER BY id ASC) AS rn,
        COUNT(*) OVER (PARTITION BY signature) AS group_count
    FROM active
),
victims AS (
    SELECT id, canonical_id
    FROM ranked
    WHERE group_count > 1 AND rn > 1
)
UPDATE tasks t
SET status = 'archived',
    workflow_state = 'archived',
    archived_at = COALESCE(t.archived_at, NOW()),
    archive_reason = 'auto_duplicate_v2',
    duplicate_of_task_id = victims.canonical_id,
    updated_at = NOW()
FROM victims
WHERE t.id = victims.id;
