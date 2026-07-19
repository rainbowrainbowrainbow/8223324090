const {
    normalizeTaskCategory,
    normalizeTaskSubcategory
} = require('./taskTaxonomy');
const {
    normalizeSubtaskSourceType,
    normalizeSubtasksInput
} = require('./taskSubtasks');
const { buildTaskOwnerMatch, normalizeUserId } = require('./taskPolicy');

const TEMPLATE_SOURCE_TYPES = ['manual', 'template', 'ai', 'template_ai', 'mixed'];
const DEFAULT_TEMPLATE_LIMIT = 40;

function compactText(value, max = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function optionalInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeTemplateSourceType(value, fallback = 'manual') {
    const raw = String(value || '').trim().toLowerCase();
    return TEMPLATE_SOURCE_TYPES.includes(raw) ? raw : fallback;
}

function canonicalText(value) {
    return compactText(value, 240)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(value) {
    return canonicalText(value)
        .split(' ')
        .map(token => token.trim())
        .filter(token => token.length >= 3);
}

function tokenOverlapScore(left, right) {
    const leftTokens = new Set(tokenize(left));
    const rightTokens = new Set(tokenize(right));
    if (!leftTokens.size || !rightTokens.size) return 0;
    let overlap = 0;
    leftTokens.forEach(token => {
        if (rightTokens.has(token)) overlap += 1;
    });
    return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function normalizeTemplateItems(value = [], options = {}) {
    return normalizeSubtasksInput(value, { sourceType: options.sourceType || 'template' })
        .map((item, index) => ({
            title: compactText(item.title, 500),
            sort_order: index,
            source_type: normalizeSubtaskSourceType(item.source_type || item.sourceType || options.sourceType || 'template', 'template')
        }))
        .filter(item => item.title);
}

function deriveTemplateSourceType(items = [], explicit) {
    const explicitSource = normalizeTemplateSourceType(explicit, '');
    if (explicitSource) return explicitSource;
    const sources = new Set(items.map(item => normalizeSubtaskSourceType(item.source_type || item.sourceType, 'manual')));
    if (sources.has('ai') && sources.has('template')) return 'template_ai';
    if (sources.has('ai')) return 'ai';
    if (sources.has('template')) return 'template';
    if (sources.has('system')) return 'mixed';
    return 'manual';
}

function normalizeTemplatePayload(payload = {}) {
    const items = normalizeTemplateItems(payload.items || payload.subtasks || payload.taskSubtasks || payload.task_subtasks);
    return {
        name: compactText(payload.name || payload.title, 160),
        description: compactText(payload.description, 1000) || null,
        category: normalizeTaskCategory(payload.category, 'admin'),
        subcategory: normalizeTaskSubcategory(normalizeTaskCategory(payload.category, 'admin'), payload.subcategory),
        scope: 'personal',
        source_type: deriveTemplateSourceType(items, payload.sourceType || payload.source_type),
        items
    };
}

function parseItems(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function mapTemplateRow(row = {}) {
    const items = normalizeTemplateItems(parseItems(row.items), { sourceType: 'template' })
        .map((item, index) => ({
            ...item,
            id: optionalInteger(item.id),
            sort_order: index,
            sortOrder: index,
            sourceType: item.source_type
        }));
    return {
        id: optionalInteger(row.id),
        name: row.name || '',
        title: row.name || '',
        description: row.description || '',
        category: row.category || 'admin',
        subcategory: row.subcategory || null,
        scope: row.scope || 'personal',
        source_type: normalizeTemplateSourceType(row.source_type || row.sourceType, 'manual'),
        sourceType: normalizeTemplateSourceType(row.source_type || row.sourceType, 'manual'),
        usage_count: Number.parseInt(row.usage_count ?? row.usageCount ?? 0, 10) || 0,
        usageCount: Number.parseInt(row.usage_count ?? row.usageCount ?? 0, 10) || 0,
        lastUsedAt: row.last_used_at || row.lastUsedAt || null,
        isActive: row.is_active !== false && row.isActive !== false,
        createdAt: row.created_at || row.createdAt || null,
        updatedAt: row.updated_at || row.updatedAt || null,
        items,
        subtasks: items.map((item, index) => ({
            title: item.title,
            sort_order: index,
            sortOrder: index,
            source_type: 'template',
            sourceType: 'template'
        }))
    };
}

async function withTransaction(db, callback) {
    const existingClient = db && typeof db.query === 'function' && typeof db.release === 'function';
    const client = !existingClient && typeof db.connect === 'function' ? await db.connect() : null;
    const query = client || db;
    try {
        if (client) await query.query('BEGIN');
        const result = await callback(query);
        if (client) await query.query('COMMIT');
        return result;
    } catch (err) {
        if (client) {
            try { await query.query('ROLLBACK'); } catch {}
        }
        throw err;
    } finally {
        if (client) client.release();
    }
}

function requireUserId(user) {
    const userId = normalizeUserId(user);
    if (!userId) {
        const err = new Error('Unauthenticated');
        err.statusCode = 401;
        throw err;
    }
    return userId;
}

async function listSavedDecompositionTemplates(db, user, filters = {}) {
    const userId = requireUserId(user);
    const limit = Math.max(1, Math.min(100, Number.parseInt(filters.limit, 10) || DEFAULT_TEMPLATE_LIMIT));
    const params = [userId];
    const where = ['t.owner_user_id = $1', 't.is_active = true'];
    if (filters.category) {
        params.push(normalizeTaskCategory(filters.category, 'admin'));
        where.push(`(t.category = $${params.length} OR t.category IS NULL)`);
    }
    params.push(limit);
    const result = await db.query(
        `SELECT t.*,
                COALESCE(json_agg(json_build_object(
                    'id', i.id,
                    'title', i.title,
                    'sort_order', i.sort_order,
                    'source_type', i.source_type
                ) ORDER BY i.sort_order ASC, i.id ASC) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
         FROM task_decomposition_templates t
         LEFT JOIN task_decomposition_template_items i ON i.template_id = t.id
         WHERE ${where.join(' AND ')}
         GROUP BY t.id
         ORDER BY COALESCE(t.usage_count, 0) DESC, COALESCE(t.last_used_at, t.updated_at, t.created_at) DESC, t.id DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows.map(mapTemplateRow);
}

async function loadSavedDecompositionTemplate(db, user, templateId) {
    const userId = requireUserId(user);
    const id = optionalInteger(templateId);
    if (!id) {
        const err = new Error('Invalid template id');
        err.statusCode = 400;
        throw err;
    }
    const result = await db.query(
        `SELECT t.*,
                COALESCE(json_agg(json_build_object(
                    'id', i.id,
                    'title', i.title,
                    'sort_order', i.sort_order,
                    'source_type', i.source_type
                ) ORDER BY i.sort_order ASC, i.id ASC) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
         FROM task_decomposition_templates t
         LEFT JOIN task_decomposition_template_items i ON i.template_id = t.id
         WHERE t.id = $1 AND t.owner_user_id = $2 AND t.is_active = true
         GROUP BY t.id
         LIMIT 1`,
        [id, userId]
    );
    if (!result.rows.length) {
        const err = new Error('Template not found');
        err.statusCode = 404;
        throw err;
    }
    return mapTemplateRow(result.rows[0]);
}

async function insertTemplateItems(query, templateId, items) {
    if (!items.length) return;
    const values = [];
    const placeholders = items.map((item, index) => {
        const offset = index * 4;
        values.push(templateId, item.title, index, item.source_type);
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    });
    await query.query(
        `INSERT INTO task_decomposition_template_items (template_id, title, sort_order, source_type)
         VALUES ${placeholders.join(', ')}`,
        values
    );
}

async function createSavedDecompositionTemplate(db, user, payload = {}) {
    const userId = requireUserId(user);
    const normalized = normalizeTemplatePayload(payload);
    if (!normalized.name) {
        const err = new Error('name required');
        err.statusCode = 400;
        throw err;
    }
    if (!normalized.items.length) {
        const err = new Error('template items required');
        err.statusCode = 400;
        throw err;
    }
    return withTransaction(db, async query => {
        const result = await query.query(
            `INSERT INTO task_decomposition_templates
             (owner_user_id, name, description, category, subcategory, scope, source_type)
             VALUES ($1, $2, $3, $4, $5, 'personal', $6)
             RETURNING *`,
            [userId, normalized.name, normalized.description, normalized.category, normalized.subcategory, normalized.source_type]
        );
        await insertTemplateItems(query, result.rows[0].id, normalized.items);
        return loadSavedDecompositionTemplate(query, user, result.rows[0].id);
    });
}

async function updateSavedDecompositionTemplate(db, user, templateId, payload = {}) {
    const userId = requireUserId(user);
    const id = optionalInteger(templateId);
    if (!id) {
        const err = new Error('Invalid template id');
        err.statusCode = 400;
        throw err;
    }
    const normalized = normalizeTemplatePayload(payload);
    if (!normalized.name) {
        const err = new Error('name required');
        err.statusCode = 400;
        throw err;
    }
    return withTransaction(db, async query => {
        const updated = await query.query(
            `UPDATE task_decomposition_templates
             SET name = $1,
                 description = $2,
                 category = $3,
                 subcategory = $4,
                 source_type = $5,
                 updated_at = now()
             WHERE id = $6 AND owner_user_id = $7 AND is_active = true
             RETURNING id`,
            [normalized.name, normalized.description, normalized.category, normalized.subcategory, normalized.source_type, id, userId]
        );
        if (!updated.rows.length) {
            const err = new Error('Template not found');
            err.statusCode = 404;
            throw err;
        }
        if (Array.isArray(payload.items) || Array.isArray(payload.subtasks) || Array.isArray(payload.taskSubtasks) || Array.isArray(payload.task_subtasks)) {
            if (!normalized.items.length) {
                const err = new Error('template items required');
                err.statusCode = 400;
                throw err;
            }
            await query.query('DELETE FROM task_decomposition_template_items WHERE template_id = $1', [id]);
            await insertTemplateItems(query, id, normalized.items);
        }
        return loadSavedDecompositionTemplate(query, user, id);
    });
}

async function deleteSavedDecompositionTemplate(db, user, templateId) {
    const userId = requireUserId(user);
    const id = optionalInteger(templateId);
    if (!id) {
        const err = new Error('Invalid template id');
        err.statusCode = 400;
        throw err;
    }
    const result = await db.query(
        `UPDATE task_decomposition_templates
         SET is_active = false,
             updated_at = now()
         WHERE id = $1 AND owner_user_id = $2 AND is_active = true
         RETURNING id`,
        [id, userId]
    );
    if (!result.rows.length) {
        const err = new Error('Template not found');
        err.statusCode = 404;
        throw err;
    }
    return { success: true, id };
}

async function applySavedDecompositionTemplate(db, user, templateId) {
    return withTransaction(db, async query => {
        const template = await loadSavedDecompositionTemplate(query, user, templateId);
        await query.query(
            `UPDATE task_decomposition_templates
             SET usage_count = COALESCE(usage_count, 0) + 1,
                 last_used_at = now(),
                 updated_at = now()
             WHERE id = $1`,
            [template.id]
        );
        return {
            ...template,
            subtasks: template.items.map((item, index) => ({
                title: item.title,
                sort_order: index,
                sortOrder: index,
                source_type: 'template',
                sourceType: 'template'
            }))
        };
    });
}

function scoreSavedTemplate(template = {}, context = {}) {
    const title = compactText(context.title, 240);
    const category = normalizeTaskCategory(context.category, '');
    const subcategory = context.subcategory ? normalizeTaskSubcategory(category || 'admin', context.subcategory) : null;
    let score = 0;
    score += Math.round(tokenOverlapScore(title, template.name) * 50);
    score += Math.round(tokenOverlapScore(title, template.description) * 15);
    if (category && template.category === category) score += 18;
    if (subcategory && template.subcategory === subcategory) score += 8;
    score += Math.min(12, Number.parseInt(template.usage_count ?? template.usageCount ?? 0, 10) || 0);
    if (template.lastUsedAt || template.last_used_at) score += 4;
    return score;
}

function rankSavedTemplates(templates = [], context = {}) {
    return templates
        .map(template => ({ template, score: scoreSavedTemplate(template, context) }))
        .filter(item => item.score > 0 || Number(item.template.usageCount || item.template.usage_count || 0) > 0)
        .sort((a, b) => b.score - a.score || Number(b.template.usageCount || 0) - Number(a.template.usageCount || 0))
        .slice(0, 3)
        .map(item => ({
            type: 'saved_template',
            confidence: Math.max(35, Math.min(92, 42 + item.score)),
            reason: item.template.category ? `category:${item.template.category}` : 'saved_template',
            template: item.template,
            title: item.template.name,
            subtasks: item.template.subtasks || []
        }));
}

function normalizeHistoryRows(rows = []) {
    return rows.map(row => ({
        ...row,
        items: normalizeTemplateItems(parseItems(row.items || row.subtasks), { sourceType: 'system' })
    })).filter(row => row.items.length >= 2);
}

function buildHistorySuggestion(rows = [], context = {}) {
    const normalized = normalizeHistoryRows(rows);
    if (!normalized.length) return null;
    const title = compactText(context.title, 240);
    const category = normalizeTaskCategory(context.category, '');
    const rankedRows = normalized
        .map(row => {
            let score = Math.round(tokenOverlapScore(title, row.title) * 55);
            if (category && row.category === category) score += 18;
            if (row.status === 'done') score += 8;
            score += Math.min(8, Number.parseInt(row.usage_count ?? 0, 10) || 0);
            return { row, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
    if (!rankedRows.length) return null;

    const itemScores = new Map();
    rankedRows.slice(0, 8).forEach(({ row, score }) => {
        row.items.forEach((item, index) => {
            const key = canonicalText(item.title);
            if (!key) return;
            const current = itemScores.get(key) || { title: item.title, score: 0, firstIndex: index };
            current.score += Math.max(1, score);
            current.firstIndex = Math.min(current.firstIndex, index);
            itemScores.set(key, current);
        });
    });
    const subtasks = [...itemScores.values()]
        .sort((a, b) => b.score - a.score || a.firstIndex - b.firstIndex)
        .slice(0, 8)
        .map((item, index) => ({
            title: item.title,
            sort_order: index,
            sortOrder: index,
            source_type: 'system',
            sourceType: 'system'
        }));
    if (subtasks.length < 2) return null;
    const topScore = rankedRows[0].score;
    return {
        type: 'history',
        confidence: Math.max(32, Math.min(86, 36 + topScore)),
        reason: 'similar_completed_or_saved_tasks',
        title: 'Схожа структура з історії',
        subtasks
    };
}

async function getDecompositionSuggestions(db, user, context = {}) {
    requireUserId(user);
    const title = compactText(context.title, 240);
    const category = normalizeTaskCategory(context.category, '');
    if (title.length < 3 && !category) {
        return {
            suggestions: [],
            meta: { signal: 'insufficient_context' }
        };
    }

    const [templates, historyRows] = await Promise.all([
        listSavedDecompositionTemplates(db, user, { limit: 30 }).catch(() => []),
        listHistoryDecompositions(db, user, { ...context, title, category }).catch(() => [])
    ]);
    const suggestions = [
        ...rankSavedTemplates(templates, { ...context, title, category }),
        buildHistorySuggestion(historyRows, { ...context, title, category })
    ].filter(Boolean)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 4);
    return {
        suggestions,
        meta: {
            signal: suggestions.length ? 'ranked' : 'no_reusable_signal',
            savedTemplateCount: templates.length,
            historySampleCount: historyRows.length
        }
    };
}

async function listHistoryDecompositions(db, user, context = {}) {
    const params = [];
    const ownerMatch = buildTaskOwnerMatch(user, params, 't');
    const category = normalizeTaskCategory(context.category, '');
    const where = [ownerMatch, 'COALESCE(t.status, \'todo\') NOT IN (\'cancelled\',\'archived\')'];
    if (category) {
        params.push(category);
        where.push(`(t.category = $${params.length} OR t.category IS NULL)`);
    }
    const result = await db.query(
        `SELECT t.id, t.title, t.category, t.subcategory, t.status, t.completed_at, t.created_at,
                COALESCE(json_agg(json_build_object(
                    'title', s.title,
                    'sort_order', s.sort_order,
                    'source_type', s.source_type
                ) ORDER BY s.sort_order ASC, s.id ASC) FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS items
         FROM tasks t
         JOIN task_subtasks s ON s.task_id = t.id
         WHERE ${where.join(' AND ')}
         GROUP BY t.id
         HAVING COUNT(s.id) >= 2
         ORDER BY CASE WHEN t.status = 'done' THEN 0 ELSE 1 END,
                  COALESCE(t.completed_at, t.updated_at, t.created_at) DESC
         LIMIT 40`,
        params
    );
    return result.rows;
}

module.exports = {
    applySavedDecompositionTemplate,
    buildHistorySuggestion,
    createSavedDecompositionTemplate,
    deleteSavedDecompositionTemplate,
    deriveTemplateSourceType,
    getDecompositionSuggestions,
    listHistoryDecompositions,
    listSavedDecompositionTemplates,
    loadSavedDecompositionTemplate,
    mapTemplateRow,
    normalizeTemplateItems,
    normalizeTemplatePayload,
    rankSavedTemplates,
    scoreSavedTemplate,
    updateSavedDecompositionTemplate
};
