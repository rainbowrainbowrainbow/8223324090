'use strict';

const TAXONOMY = Object.freeze({
    directions: { table: 'my_day_directions', defaults: { color: '#6366F1', icon: '•' } },
    impacts: { table: 'my_day_impacts', defaults: { color: '#0EA5E9', icon: '•' } }
});
const MAX_IMPACTS_PER_TASK = 3;

function myDayError(message, statusCode, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function positiveInteger(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw myDayError('Некоректний ідентифікатор.', 400, 'MY_DAY_VALIDATION_ERROR');
    return parsed;
}

function optionalId(value) {
    return value === null || value === undefined || value === '' ? null : positiveInteger(value);
}

function taxonomy(kind) {
    const definition = TAXONOMY[kind];
    if (!definition) throw new Error('Unsupported My Day taxonomy: ' + kind);
    return definition;
}

function normalizeName(value) {
    const name = String(value || '').trim();
    if (!name || name.length > 100) throw myDayError('Вкажіть назву до 100 символів.', 400, 'MY_DAY_VALIDATION_ERROR');
    return name;
}

function normalizeColor(value, fallback) {
    const color = String(value || fallback || '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw myDayError('Колір має бути у форматі #RRGGBB.', 400, 'MY_DAY_VALIDATION_ERROR');
    return color.toUpperCase();
}

function normalizeIcon(value, fallback) {
    const icon = String(value || fallback || '').trim();
    if (!icon || [...icon].length > 32) throw myDayError('Іконка має містити від 1 до 32 символів.', 400, 'MY_DAY_VALIDATION_ERROR');
    return icon;
}

function normalizeSortOrder(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000000) throw myDayError('Некоректний порядок елемента.', 400, 'MY_DAY_VALIDATION_ERROR');
    return parsed;
}

function normalizeImpactIds(value) {
    if (!Array.isArray(value)) throw myDayError('Впливи мають бути масивом.', 400, 'MY_DAY_VALIDATION_ERROR');
    const ids = value.map(positiveInteger);
    if (new Set(ids).size !== ids.length) throw myDayError('Впливи не можуть повторюватися.', 400, 'MY_DAY_VALIDATION_ERROR');
    if (ids.length > MAX_IMPACTS_PER_TASK) throw myDayError('До задачі можна додати максимум три впливи.', 409, 'MY_DAY_IMPACT_LIMIT_EXCEEDED');
    return ids;
}

function serializeTaxonomy(row = {}) {
    return {
        id: Number(row.id),
        name: row.name,
        color: row.color,
        icon: row.icon,
        sortOrder: Number(row.sort_order || 0),
        isActive: row.is_active !== false,
        archivedAt: row.archived_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function normalizeJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function serializeClassification(row = {}) {
    return {
        direction: row.direction_id ? {
            id: Number(row.direction_id),
            name: row.direction_name,
            color: row.direction_color,
            icon: row.direction_icon,
            isActive: row.direction_is_active !== false
        } : null,
        impacts: normalizeJsonArray(row.impacts).map(impact => ({
            id: Number(impact.id),
            name: impact.name,
            color: impact.color,
            icon: impact.icon,
            isActive: impact.isActive !== false && impact.is_active !== false
        }))
    };
}

async function listTaxonomy(queryable, userId, kind, options = {}) {
    const { table } = taxonomy(kind);
    const result = await queryable.query(
        `SELECT id, name, color, icon, sort_order, is_active, archived_at, created_at, updated_at
         FROM ${table}
         WHERE user_id = $1 ${options.includeArchived === true ? '' : 'AND is_active = true'}
         ORDER BY is_active DESC, sort_order ASC, id ASC`,
        [positiveInteger(userId)]
    );
    return (result.rows || []).map(serializeTaxonomy);
}

async function createTaxonomy(queryable, userId, kind, payload = {}) {
    const { table, defaults } = taxonomy(kind);
    const name = normalizeName(payload.name);
    const color = normalizeColor(payload.color, defaults.color);
    const icon = normalizeIcon(payload.icon, defaults.icon);
    const sortOrder = normalizeSortOrder(payload.sortOrder ?? payload.sort_order);
    try {
        const result = await queryable.query(
            `INSERT INTO ${table} (user_id, name, color, icon, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, color, icon, sort_order, is_active, archived_at, created_at, updated_at`,
            [positiveInteger(userId), name, color, icon, sortOrder]
        );
        return serializeTaxonomy(result.rows[0]);
    } catch (error) {
        if (error?.code === '23505') throw myDayError('Така назва вже є у вашому каталозі.', 400, 'MY_DAY_VALIDATION_ERROR');
        throw error;
    }
}

async function updateTaxonomy(queryable, userId, kind, id, payload = {}) {
    const { table, defaults } = taxonomy(kind);
    const taxonomyId = positiveInteger(id);
    const ownerId = positiveInteger(userId);
    const existing = await queryable.query(
        `SELECT id, name, color, icon, sort_order, is_active FROM ${table}
         WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [taxonomyId, ownerId]
    );
    const current = existing.rows?.[0];
    if (!current) throw myDayError('Елемент My Day не знайдено.', 404, 'MY_DAY_TAXONOMY_NOT_FOUND');
    const name = Object.hasOwn(payload, 'name') ? normalizeName(payload.name) : current.name;
    const color = Object.hasOwn(payload, 'color') ? normalizeColor(payload.color, defaults.color) : current.color;
    const icon = Object.hasOwn(payload, 'icon') ? normalizeIcon(payload.icon, defaults.icon) : current.icon;
    const sortOrder = Object.hasOwn(payload, 'sortOrder') || Object.hasOwn(payload, 'sort_order')
        ? normalizeSortOrder(payload.sortOrder ?? payload.sort_order) : Number(current.sort_order || 0);
    const requestedActive = payload.isActive ?? payload.is_active;
    if (requestedActive !== undefined && typeof requestedActive !== 'boolean') throw myDayError('Статус архівації має бути boolean.', 400, 'MY_DAY_VALIDATION_ERROR');
    const isActive = requestedActive === undefined ? current.is_active !== false : requestedActive;
    try {
        const result = await queryable.query(
            `UPDATE ${table}
             SET name = $3, color = $4, icon = $5, sort_order = $6, is_active = $7,
                 archived_at = CASE WHEN $7 THEN NULL ELSE COALESCE(archived_at, NOW()) END,
                 updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING id, name, color, icon, sort_order, is_active, archived_at, created_at, updated_at`,
            [taxonomyId, ownerId, name, color, icon, sortOrder, isActive]
        );
        return serializeTaxonomy(result.rows[0]);
    } catch (error) {
        if (error?.code === '23505') throw myDayError('Така назва вже є у вашому каталозі.', 400, 'MY_DAY_VALIDATION_ERROR');
        throw error;
    }
}

async function resolveActiveIds(queryable, userId, kind, ids) {
    if (!ids.length) return;
    const { table } = taxonomy(kind);
    const result = await queryable.query(
        `SELECT id, is_active FROM ${table}
         WHERE user_id = $1 AND id = ANY($2::bigint[]) FOR KEY SHARE`,
        [positiveInteger(userId), ids]
    );
    const rows = result.rows || [];
    if (rows.length !== ids.length) throw myDayError('Елемент My Day не знайдено.', 404, 'MY_DAY_TAXONOMY_NOT_FOUND');
    if (rows.some(row => row.is_active === false)) throw myDayError('Архівований елемент не можна вибрати.', 409, 'MY_DAY_TAXONOMY_ARCHIVED');
}

async function readTaskClassification(queryable, userId, taskId) {
    const result = await queryable.query(
        `SELECT m.direction_id, d.name AS direction_name, d.color AS direction_color,
                d.icon AS direction_icon, d.is_active AS direction_is_active,
                COALESCE(json_agg(json_build_object(
                    'id', i.id, 'name', i.name, 'color', i.color, 'icon', i.icon, 'isActive', i.is_active
                ) ORDER BY i.sort_order ASC, i.id ASC) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS impacts
         FROM my_day_task_metadata m
         LEFT JOIN my_day_directions d ON d.id = m.direction_id
         LEFT JOIN my_day_task_impacts ti ON ti.user_id = m.user_id AND ti.task_id = m.task_id
         LEFT JOIN my_day_impacts i ON i.id = ti.impact_id
         WHERE m.user_id = $1 AND m.task_id = $2
         GROUP BY m.direction_id, d.name, d.color, d.icon, d.is_active`,
        [positiveInteger(userId), positiveInteger(taskId)]
    );
    return serializeClassification(result.rows?.[0] || {});
}

async function replaceTaskClassification(queryable, input = {}) {
    const userId = positiveInteger(input.userId);
    const taskId = positiveInteger(input.taskId);
    const directionId = optionalId(input.directionId);
    const impactIds = normalizeImpactIds(input.impactIds ?? []);
    if (directionId) await resolveActiveIds(queryable, userId, 'directions', [directionId]);
    await resolveActiveIds(queryable, userId, 'impacts', impactIds);
    await queryable.query(
        `INSERT INTO my_day_task_metadata (user_id, task_id, direction_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, task_id)
         DO UPDATE SET direction_id = EXCLUDED.direction_id, updated_at = NOW()`,
        [userId, taskId, directionId]
    );
    await queryable.query('DELETE FROM my_day_task_impacts WHERE user_id = $1 AND task_id = $2', [userId, taskId]);
    if (impactIds.length) {
        await queryable.query(
            `INSERT INTO my_day_task_impacts (user_id, task_id, impact_id)
             SELECT $1, $2, unnest($3::bigint[])
             ON CONFLICT (user_id, task_id, impact_id) DO NOTHING`,
            [userId, taskId, impactIds]
        );
    }
    return readTaskClassification(queryable, userId, taskId);
}

async function loadTaskClassifications(queryable, userId, taskIds = []) {
    const ids = [...new Set(taskIds.map(Number).filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return new Map();
    const result = await queryable.query(
        `SELECT m.task_id, m.direction_id, d.name AS direction_name, d.color AS direction_color,
                d.icon AS direction_icon, d.is_active AS direction_is_active,
                COALESCE(json_agg(json_build_object(
                    'id', i.id, 'name', i.name, 'color', i.color, 'icon', i.icon, 'isActive', i.is_active
                ) ORDER BY i.sort_order ASC, i.id ASC) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS impacts
         FROM my_day_task_metadata m
         LEFT JOIN my_day_directions d ON d.id = m.direction_id
         LEFT JOIN my_day_task_impacts ti ON ti.user_id = m.user_id AND ti.task_id = m.task_id
         LEFT JOIN my_day_impacts i ON i.id = ti.impact_id
         WHERE m.user_id = $1 AND m.task_id = ANY($2::int[])
         GROUP BY m.task_id, m.direction_id, d.name, d.color, d.icon, d.is_active`,
        [positiveInteger(userId), ids]
    );
    return new Map((result.rows || []).map(row => [Number(row.task_id), serializeClassification(row)]));
}

module.exports = {
    MAX_IMPACTS_PER_TASK,
    createTaxonomy,
    listTaxonomy,
    loadTaskClassifications,
    myDayError,
    normalizeImpactIds,
    normalizeName,
    readTaskClassification,
    replaceTaskClassification,
    serializeClassification,
    updateTaxonomy
};
