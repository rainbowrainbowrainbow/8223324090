const VALID_SUBTASK_SOURCE_TYPES = ['manual', 'template', 'ai', 'system'];

function isTruthy(value) {
    return value === true || value === 'true' || value === '1' || value === 1 || value === 'on';
}

function optionalInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeSubtaskSourceType(value, fallback = 'manual') {
    const raw = String(value || '').trim().toLowerCase();
    return VALID_SUBTASK_SOURCE_TYPES.includes(raw) ? raw : fallback;
}

function hasSubtaskPayload(body = {}) {
    return Object.prototype.hasOwnProperty.call(body, 'subtasks')
        || Object.prototype.hasOwnProperty.call(body, 'taskSubtasks')
        || Object.prototype.hasOwnProperty.call(body, 'task_subtasks');
}

function subtaskPayloadFromBody(body = {}) {
    if (Array.isArray(body.subtasks)) return body.subtasks;
    if (Array.isArray(body.taskSubtasks)) return body.taskSubtasks;
    if (Array.isArray(body.task_subtasks)) return body.task_subtasks;
    return [];
}

function normalizeSubtaskInput(item, index = 0, options = {}) {
    const raw = item && typeof item === 'object' ? item : { title: item };
    const title = String(raw.title || raw.name || '').trim();
    if (!title) return null;
    const sortInput = raw.sort_order ?? raw.sortOrder;
    const sortOrder = Number.isInteger(Number.parseInt(sortInput, 10))
        ? Number.parseInt(sortInput, 10)
        : index;
    const doneInput = raw.is_done !== undefined ? raw.is_done
        : (raw.isDone !== undefined ? raw.isDone : raw.done);
    const sourceInput = raw.source_type ?? raw.sourceType ?? options.sourceType;
    return {
        id: optionalInteger(raw.id || raw.subtaskId || raw.subtask_id),
        title: title.slice(0, 500),
        is_done: isTruthy(doneInput),
        sort_order: sortOrder,
        source_type: normalizeSubtaskSourceType(sourceInput, options.sourceType || 'manual')
    };
}

function normalizeSubtasksInput(value, options = {}) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item, index) => normalizeSubtaskInput(item, index, options))
        .filter(Boolean)
        .map((item, index) => ({ ...item, sort_order: index }));
}

function normalizeSubtaskReorderIds(value = {}) {
    const source = Array.isArray(value)
        ? value
        : (Array.isArray(value.subtaskIds)
            ? value.subtaskIds
            : (Array.isArray(value.subtasks)
                ? value.subtasks
                : (Array.isArray(value.order) ? value.order : [])));
    return source
        .map(item => optionalInteger(item?.id || item?.subtaskId || item?.subtask_id || item))
        .filter(Boolean);
}

function createSubtaskOrderError(message, statusCode = 400) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function subtaskProgress(doneCount, totalCount) {
    const done = Math.max(0, Number.parseInt(doneCount, 10) || 0);
    const total = Math.max(0, Number.parseInt(totalCount, 10) || 0);
    if (total <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function subtaskCompletionState(doneCount, totalCount) {
    const total = Math.max(0, Number.parseInt(totalCount, 10) || 0);
    const done = Math.max(0, Math.min(total, Number.parseInt(doneCount, 10) || 0));
    const open = Math.max(0, total - done);
    return {
        total,
        done,
        open,
        canCompleteParent: total === 0 || open === 0,
        progress: subtaskProgress(done, total)
    };
}

function normalizeSubtaskRow(row = {}) {
    const isDone = row.is_done === true || row.isDone === true;
    const sortOrder = Number.parseInt(row.sort_order ?? row.sortOrder ?? 0, 10) || 0;
    return {
        ...row,
        id: optionalInteger(row.id),
        task_id: optionalInteger(row.task_id || row.taskId),
        taskId: optionalInteger(row.task_id || row.taskId),
        title: row.title || '',
        is_done: isDone,
        isDone,
        sort_order: sortOrder,
        sortOrder,
        source_type: normalizeSubtaskSourceType(row.source_type || row.sourceType),
        sourceType: normalizeSubtaskSourceType(row.source_type || row.sourceType),
        createdAt: row.created_at || row.createdAt || null,
        completedAt: row.completed_at || row.completedAt || null,
        updatedAt: row.updated_at || row.updatedAt || null
    };
}

function sortSubtaskRows(rows = []) {
    return rows
        .map(normalizeSubtaskRow)
        .sort((a, b) => (a.sortOrder - b.sortOrder) || ((a.id || 0) - (b.id || 0)));
}

function normalizeSubtaskRows(value) {
    let rows = value;
    if (typeof value === 'string') {
        try {
            rows = JSON.parse(value);
        } catch {
            rows = [];
        }
    }
    return sortSubtaskRows(Array.isArray(rows) ? rows : []);
}

function normalizeSubtaskSummary(row = {}) {
    const subtasks = normalizeSubtaskRows(row.subtasks);
    const totalRaw = row.subtask_count ?? row.subtaskCount;
    const doneRaw = row.subtask_done_count ?? row.subtaskDoneCount;
    const parsedTotal = Number.parseInt(totalRaw, 10);
    const total = Math.max(0, Number.isFinite(parsedTotal) ? parsedTotal : (subtasks.length || 0));
    const doneFromRows = subtasks.filter(item => item.isDone || item.is_done).length;
    const parsedDone = Number.parseInt(doneRaw, 10);
    const done = Math.max(0, Math.min(total, Number.isFinite(parsedDone) ? parsedDone : (doneFromRows || 0)));
    const progress = subtaskProgress(done, total);
    return {
        subtasks,
        subtaskCount: total,
        subtaskDoneCount: done,
        subtaskProgress: progress,
        subtaskProgressPercent: progress || 0
    };
}

async function listTaskSubtasks(db, taskId) {
    const result = await db.query(
        `SELECT *
         FROM task_subtasks
         WHERE task_id = $1
         ORDER BY sort_order ASC, id ASC`,
        [taskId]
    );
    return sortSubtaskRows(result.rows);
}

async function reorderTaskSubtasks(db, taskId, orderInput) {
    const normalizedTaskId = optionalInteger(taskId);
    const orderedIds = normalizeSubtaskReorderIds(orderInput);
    if (!normalizedTaskId) throw createSubtaskOrderError('Invalid task id', 400);
    if (orderedIds.length < 2) throw createSubtaskOrderError('At least two subtasks are required for reorder', 400);
    if (new Set(orderedIds).size !== orderedIds.length) {
        throw createSubtaskOrderError('Duplicate subtask ids are not allowed', 400);
    }

    const client = typeof db.connect === 'function' ? await db.connect() : null;
    const query = client || db;
    try {
        if (client) await query.query('BEGIN');
        const existingResult = await query.query(
            `SELECT *
             FROM task_subtasks
             WHERE task_id = $1
             ORDER BY sort_order ASC, id ASC
             FOR UPDATE`,
            [normalizedTaskId]
        );
        const existingRows = sortSubtaskRows(existingResult.rows);
        if (existingRows.length !== orderedIds.length) {
            throw createSubtaskOrderError('Subtask order must include every subtask for this task', 400);
        }
        const existingIds = new Set(existingRows.map(item => Number(item.id)));
        const hasOnlyKnownIds = orderedIds.every(id => existingIds.has(Number(id)));
        if (!hasOnlyKnownIds) {
            throw createSubtaskOrderError('Subtask order contains unknown subtask ids', 400);
        }

        for (let index = 0; index < orderedIds.length; index += 1) {
            await query.query(
                `UPDATE task_subtasks
                 SET sort_order = $1,
                     updated_at = NOW()
                 WHERE task_id = $2 AND id = $3`,
                [index, normalizedTaskId, orderedIds[index]]
            );
        }
        await query.query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [normalizedTaskId]);
        const rows = await listTaskSubtasks(query, normalizedTaskId);
        if (client) await query.query('COMMIT');
        return rows;
    } catch (err) {
        if (client) {
            try { await query.query('ROLLBACK'); } catch {}
        }
        throw err;
    } finally {
        if (client) client.release();
    }
}

async function createTaskSubtasks(db, taskId, subtasks, options = {}) {
    const items = normalizeSubtasksInput(subtasks, options);
    if (!items.length) return [];
    const values = [];
    const placeholders = items.map((item, index) => {
        const offset = index * 5;
        values.push(taskId, item.title, item.is_done, item.sort_order, item.source_type);
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, CASE WHEN $${offset + 3} = true THEN NOW() ELSE NULL END)`;
    });
    const result = await db.query(
        `INSERT INTO task_subtasks (task_id, title, is_done, sort_order, source_type, completed_at)
         VALUES ${placeholders.join(', ')}
         RETURNING *`,
        values
    );
    return sortSubtaskRows(result.rows);
}

async function replaceTaskSubtasks(db, taskId, subtasks, options = {}) {
    const items = normalizeSubtasksInput(subtasks, options);
    const client = typeof db.connect === 'function' ? await db.connect() : null;
    const query = client || db;
    try {
        if (client) await query.query('BEGIN');
        const existing = await query.query('SELECT id FROM task_subtasks WHERE task_id = $1', [taskId]);
        const existingIds = new Set(existing.rows.map(row => Number(row.id)));
        const incomingIds = items
            .map(item => item.id)
            .filter(id => id && existingIds.has(Number(id)));

        if (incomingIds.length) {
            await query.query(
                'DELETE FROM task_subtasks WHERE task_id = $1 AND NOT (id = ANY($2::int[]))',
                [taskId, incomingIds]
            );
        } else {
            await query.query('DELETE FROM task_subtasks WHERE task_id = $1', [taskId]);
        }

        const rows = [];
        for (const item of items) {
            let updated = null;
            if (item.id && existingIds.has(Number(item.id))) {
                const result = await query.query(
                    `UPDATE task_subtasks
                     SET title = $1,
                         is_done = $2,
                         sort_order = $3,
                         source_type = $4,
                         completed_at = CASE WHEN $2 = true THEN COALESCE(completed_at, NOW()) ELSE NULL END,
                         updated_at = NOW()
                     WHERE task_id = $5 AND id = $6
                     RETURNING *`,
                    [item.title, item.is_done, item.sort_order, item.source_type, taskId, item.id]
                );
                updated = result.rows[0] || null;
            }
            if (!updated) {
                const result = await query.query(
                    `INSERT INTO task_subtasks (task_id, title, is_done, sort_order, source_type, completed_at)
                     VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 = true THEN NOW() ELSE NULL END)
                     RETURNING *`,
                    [taskId, item.title, item.is_done, item.sort_order, item.source_type]
                );
                updated = result.rows[0];
            }
            rows.push(updated);
        }

        await query.query(
            `UPDATE tasks
             SET task_kind = CASE WHEN $2::int > 0 AND task_kind = 'action' THEN 'checklist' ELSE task_kind END,
                 updated_at = NOW()
             WHERE id = $1`,
            [taskId, items.length]
        );

        if (client) await query.query('COMMIT');
        return sortSubtaskRows(rows);
    } catch (err) {
        if (client) {
            try { await query.query('ROLLBACK'); } catch {}
        }
        throw err;
    } finally {
        if (client) client.release();
    }
}

module.exports = {
    VALID_SUBTASK_SOURCE_TYPES,
    createTaskSubtasks,
    hasSubtaskPayload,
    listTaskSubtasks,
    normalizeSubtaskInput,
    normalizeSubtaskReorderIds,
    normalizeSubtaskRow,
    normalizeSubtaskRows,
    normalizeSubtaskSummary,
    normalizeSubtaskSourceType,
    normalizeSubtasksInput,
    reorderTaskSubtasks,
    replaceTaskSubtasks,
    subtaskPayloadFromBody,
    subtaskCompletionState,
    subtaskProgress
};
