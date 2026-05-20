/*
 * services/taskDuplicatePolicy.js — canonical active-task duplicate policy
 *
 * Keeps task writers from creating several active copies of the same
 * operational item. Cleanup is intentionally non-destructive.
 */

class TaskDuplicateError extends Error {
    constructor(task, message = 'Active duplicate task exists') {
        super(message);
        this.name = 'TaskDuplicateError';
        this.code = 'TASK_DUPLICATE_ACTIVE';
        this.statusCode = 409;
        this.task = task || null;
    }
}

const ACTIVE_TASK_STATUS_SQL = "COALESCE(t.status, 'todo') NOT IN ('done','archived','cancelled')";

function normalizeTaskTitle(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeTaskDate(value) {
    if (!value) return '';
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function normalizeTaskDuplicatePayload(data = {}) {
    const sourceType = data.source_type ?? data.sourceType ?? 'manual';
    const signature = {
        title: normalizeTaskTitle(data.title),
        day: normalizeTaskDate(data.date || data.deadline || data.remind_at || data.remindAt),
        category: String(data.category || 'admin').trim().toLowerCase(),
        subcategory: String(data.subcategory || '').trim().toLowerCase(),
        ownerUserId: String(data.owner_user_id ?? data.ownerUserId ?? ''),
        sourceType: String(sourceType || 'manual').trim().toLowerCase(),
        sourceId: String(data.source_id ?? data.sourceId ?? ''),
        templateId: String(data.template_id ?? data.templateId ?? ''),
        sourceEntityType: String(data.source_entity_type ?? data.sourceEntityType ?? '').trim().toLowerCase(),
        sourceEntityId: String(data.source_entity_id ?? data.sourceEntityId ?? ''),
        packId: String(data.pack_id ?? data.packId ?? ''),
        checklistTemplateKey: String(data.checklist_template_key ?? data.checklistTemplateKey ?? '').trim().toLowerCase(),
        afishaId: String(data.afisha_id ?? data.afishaId ?? '')
    };
    signature.sourceAnchor = taskDuplicateSourceAnchor(signature);
    return signature;
}

function taskDuplicateSourceAnchor(signature = {}) {
    if (signature.templateId) return `template:${signature.templateId}`;
    if (signature.packId) return `pack:${signature.packId}`;
    if (signature.sourceEntityType && signature.sourceEntityId) return `entity:${signature.sourceEntityType}:${signature.sourceEntityId}`;
    if (signature.afishaId) return `afisha:${signature.afishaId}`;
    const sourceType = String(signature.sourceType || 'manual').trim().toLowerCase();
    if (!['manual', 'assistant', 'assistant_command', 'command'].includes(sourceType) && signature.sourceId) {
        return `${sourceType}:${signature.sourceId}`;
    }
    return '';
}

function duplicateSourceAnchorSql(alias = 't') {
    return `CASE
        WHEN COALESCE(${alias}.template_id::text, '') <> '' THEN 'template:' || ${alias}.template_id::text
        WHEN COALESCE(${alias}.pack_id::text, '') <> '' THEN 'pack:' || ${alias}.pack_id::text
        WHEN COALESCE(${alias}.source_entity_type, '') <> '' AND COALESCE(${alias}.source_entity_id::text, '') <> ''
            THEN 'entity:' || lower(${alias}.source_entity_type) || ':' || ${alias}.source_entity_id::text
        WHEN COALESCE(${alias}.afisha_id::text, '') <> '' THEN 'afisha:' || ${alias}.afisha_id::text
        WHEN lower(COALESCE(${alias}.source_type, 'manual')) NOT IN ('manual','assistant','assistant_command','command')
             AND COALESCE(${alias}.source_id::text, '') <> ''
            THEN lower(COALESCE(${alias}.source_type, 'manual')) || ':' || ${alias}.source_id::text
        ELSE ''
    END`;
}

async function findActiveDuplicateTask(db, data = {}) {
    const signature = normalizeTaskDuplicatePayload(data);
    if (!signature.title) return null;

    const result = await db.query(
        `SELECT t.*
         FROM tasks t
         WHERE ${ACTIVE_TASK_STATUS_SQL}
           AND lower(regexp_replace(trim(COALESCE(t.title, '')), '\\s+', ' ', 'g')) = $1
           AND COALESCE(t.date::text, '') = $2
           AND lower(COALESCE(t.category, 'admin')) = $3
           AND lower(COALESCE(t.subcategory, '')) = $4
           AND COALESCE(t.owner_user_id::text, '') = $5
           AND lower(COALESCE(t.checklist_template_key, '')) = $6
           AND ${duplicateSourceAnchorSql('t')} = $7
         ORDER BY t.id ASC
         LIMIT 1`,
        [
            signature.title,
            signature.day,
            signature.category,
            signature.subcategory,
            signature.ownerUserId,
            signature.checklistTemplateKey,
            signature.sourceAnchor
        ]
    );
    return result.rows[0] || null;
}

function canForceTaskDuplicate(user = {}) {
    return ['creator', 'director', 'vice_director', 'senior_manager', 'manager'].includes(user.role);
}

function duplicateSignatureSql(alias = 't') {
    return `concat_ws('|',
        lower(regexp_replace(trim(COALESCE(${alias}.title, '')), '\\s+', ' ', 'g')),
        COALESCE(${alias}.date::text, ''),
        lower(COALESCE(${alias}.category, 'admin')),
        lower(COALESCE(${alias}.subcategory, '')),
        COALESCE(${alias}.owner_user_id::text, ''),
        lower(COALESCE(${alias}.checklist_template_key, '')),
        ${duplicateSourceAnchorSql(alias)}
    )`;
}

function activeDuplicateCanonicalFilterSql(alias = 't') {
    const duplicateAlias = 'task_duplicate_canonical';
    return `(
        COALESCE(${alias}.status, 'todo') IN ('done','archived','cancelled')
        OR NOT EXISTS (
            SELECT 1
            FROM tasks ${duplicateAlias}
            WHERE ${duplicateAlias}.id < ${alias}.id
              AND ${ACTIVE_TASK_STATUS_SQL.replaceAll('t.', `${duplicateAlias}.`)}
              AND ${duplicateSignatureSql(duplicateAlias)} = ${duplicateSignatureSql(alias)}
        )
    )`;
}

module.exports = {
    ACTIVE_TASK_STATUS_SQL,
    TaskDuplicateError,
    activeDuplicateCanonicalFilterSql,
    canForceTaskDuplicate,
    duplicateSourceAnchorSql,
    duplicateSignatureSql,
    findActiveDuplicateTask,
    normalizeTaskDuplicatePayload,
    normalizeTaskTitle
};
