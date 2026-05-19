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
    return {
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
           AND lower(COALESCE(t.source_type, 'manual')) = $6
           AND COALESCE(t.source_id::text, '') = $7
           AND COALESCE(t.template_id::text, '') = $8
           AND lower(COALESCE(t.source_entity_type, '')) = $9
           AND COALESCE(t.source_entity_id::text, '') = $10
           AND COALESCE(t.pack_id::text, '') = $11
           AND lower(COALESCE(t.checklist_template_key, '')) = $12
           AND COALESCE(t.afisha_id::text, '') = $13
         ORDER BY t.id ASC
         LIMIT 1`,
        [
            signature.title,
            signature.day,
            signature.category,
            signature.subcategory,
            signature.ownerUserId,
            signature.sourceType,
            signature.sourceId,
            signature.templateId,
            signature.sourceEntityType,
            signature.sourceEntityId,
            signature.packId,
            signature.checklistTemplateKey,
            signature.afishaId
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
        lower(COALESCE(${alias}.source_type, 'manual')),
        COALESCE(${alias}.source_id::text, ''),
        COALESCE(${alias}.template_id::text, ''),
        lower(COALESCE(${alias}.source_entity_type, '')),
        COALESCE(${alias}.source_entity_id::text, ''),
        COALESCE(${alias}.pack_id::text, ''),
        lower(COALESCE(${alias}.checklist_template_key, '')),
        COALESCE(${alias}.afisha_id::text, '')
    )`;
}

module.exports = {
    ACTIVE_TASK_STATUS_SQL,
    TaskDuplicateError,
    canForceTaskDuplicate,
    duplicateSignatureSql,
    findActiveDuplicateTask,
    normalizeTaskDuplicatePayload,
    normalizeTaskTitle
};
