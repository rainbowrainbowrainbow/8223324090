'use strict';

const {
    buildTaskOwnerMatch,
    normalizeUserId
} = require('./taskPolicy');
const { dateOnly: taskKyivDateOnly } = require('./taskScheduling');
const { normalizeTaskPayload } = require('./taskContract');
const { loadTaskClassifications } = require('./myDayTaxonomy');
const { loadTaskDependencyStates } = require('./taskDependencies');
const {
    loadTaskTimeTotals,
    loadTaskTimeTotalsForDate
} = require('./myDayTimeTracking');
const {
    normalizePostponementCount
} = require('./taskPostponementPolicy');
const { listLatestTaskPostponementEvents } = require('./taskActionHistory');
const { appendTaskBusinessScopeSql } = require('./taskBusinessScope');

const DEFAULT_COMPLETION_HISTORY_LIMIT = 36;
const MAX_COMPLETION_HISTORY_LIMIT = 100;
const COMPLETION_HISTORY_CURSOR_VERSION = 1;

function completedTaskOrderExpression(alias = 't') {
    return `COALESCE(${alias}.completed_at, ${alias}.updated_at, ${alias}.created_at)`;
}

function taskDateOnly(value) {
    return taskKyivDateOnly(value);
}

function todayKyivDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function normalizeCompletionHistoryLimit(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return DEFAULT_COMPLETION_HISTORY_LIMIT;
    return Math.min(numeric, MAX_COMPLETION_HISTORY_LIMIT);
}

function completionHistoryCursorError() {
    const err = new Error('Invalid completion history cursor');
    err.statusCode = 400;
    err.code = 'TASK_COMPLETION_HISTORY_CURSOR_INVALID';
    return err;
}

function encodeCompletionHistoryCursor(row = {}) {
    const id = Number(row.id || row.task_id || row.taskId);
    const rawTimestamp = row.completed_at || row.updated_at || row.created_at;
    const timestamp = rawTimestamp ? new Date(rawTimestamp) : null;
    if (!Number.isInteger(id) || id <= 0 || !timestamp || Number.isNaN(timestamp.getTime())) return null;
    return Buffer.from(JSON.stringify({
        v: COMPLETION_HISTORY_CURSOR_VERSION,
        ts: timestamp.toISOString(),
        id
    })).toString('base64url');
}

function decodeCompletionHistoryCursor(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let payload;
    try {
        payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
        throw completionHistoryCursorError();
    }
    const timestamp = payload?.ts ? new Date(payload.ts) : null;
    const id = Number(payload?.id);
    if (
        payload?.v !== COMPLETION_HISTORY_CURSOR_VERSION ||
        !timestamp ||
        Number.isNaN(timestamp.getTime()) ||
        timestamp.toISOString() !== payload.ts ||
        !Number.isInteger(id) ||
        id <= 0
    ) {
        throw completionHistoryCursorError();
    }
    return { timestamp: timestamp.toISOString(), id };
}

function taskCabinetRowSelectSql() {
    return `SELECT t.*, u.name AS owner_name, u.username AS owner_username
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id`;
}

async function loadCompletionHistorySubtasksByTaskId(queryable, taskIds = []) {
    const ids = [...new Set((Array.isArray(taskIds) ? taskIds : [])
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return new Map();
    const result = await queryable.query(
        `SELECT task_id,
                COUNT(*)::int AS subtask_count,
                COUNT(*) FILTER (WHERE is_done = true)::int AS subtask_done_count,
                json_agg(json_build_object(
                    'id', id,
                    'task_id', task_id,
                    'title', title,
                    'is_done', is_done,
                    'sort_order', sort_order,
                    'source_type', COALESCE(source_type, 'manual'),
                    'created_at', created_at,
                    'completed_at', completed_at,
                    'updated_at', updated_at
                ) ORDER BY sort_order ASC, id ASC) AS subtasks
         FROM task_subtasks
         WHERE task_id = ANY($1::int[])
         GROUP BY task_id`,
        [ids]
    );
    return new Map((result.rows || []).map(row => [Number(row.task_id), row]));
}

function attachCompletionHistorySubtasks(rows = [], subtasksByTaskId = new Map()) {
    return (Array.isArray(rows) ? rows : []).map(row => {
        const taskId = Number(row.id || row.task_id || row.taskId);
        const subtasks = subtasksByTaskId.get(taskId);
        if (!subtasks) {
            return {
                ...row,
                subtasks: [],
                subtask_count: 0,
                subtask_done_count: 0
            };
        }
        return {
            ...row,
            subtasks: subtasks.subtasks || [],
            subtask_count: Number(subtasks.subtask_count || 0),
            subtask_done_count: Number(subtasks.subtask_done_count || 0)
        };
    });
}

function taskCompletionHistoryScope(user, businessScope) {
    const params = [];
    const ownerMatch = buildTaskOwnerMatch(user, params, 't');
    const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
    return { params, ownerMatch, businessCondition };
}

async function queryTaskCompletionHistoryPage(queryable, options = {}) {
    const user = options.user || {};
    const userId = normalizeUserId(user);
    if (!userId) {
        const err = new Error('Unauthenticated');
        err.statusCode = 401;
        err.code = 'TASK_COMPLETION_HISTORY_UNAUTHENTICATED';
        throw err;
    }
    const limit = normalizeCompletionHistoryLimit(options.limit);
    const cursor = decodeCompletionHistoryCursor(options.cursor);
    const scope = taskCompletionHistoryScope(user, options.businessScope);
    const orderExpression = completedTaskOrderExpression('t');
    const pageParams = [...scope.params];
    let cursorCondition = '';
    if (cursor) {
        const cursorTimestampParam = pageParams.length + 1;
        pageParams.push(cursor.timestamp);
        const cursorIdParam = pageParams.length + 1;
        pageParams.push(cursor.id);
        cursorCondition = `AND (
            ${orderExpression} < $${cursorTimestampParam}::timestamp
            OR (${orderExpression} = $${cursorTimestampParam}::timestamp AND t.id < $${cursorIdParam})
        )`;
    }
    const limitParam = pageParams.length + 1;
    pageParams.push(limit + 1);
    const result = await queryable.query(
        `${taskCabinetRowSelectSql()}
         WHERE ${scope.ownerMatch}
           ${scope.businessCondition}
           AND COALESCE(t.status, 'todo') = 'done'
           ${cursorCondition}
         ORDER BY ${orderExpression} DESC, t.id DESC
         LIMIT $${limitParam}`,
        pageParams
    );
    const fetchedRows = Array.isArray(result.rows) ? result.rows : [];
    const sourceRowsRaw = fetchedRows.slice(0, limit);
    const includeSubtasks = options.includeSubtasks !== false;
    const subtasksByTaskId = includeSubtasks
        ? await loadCompletionHistorySubtasksByTaskId(queryable, sourceRowsRaw.map(row => row.id || row.task_id || row.taskId))
        : new Map();
    const sourceRows = includeSubtasks
        ? attachCompletionHistorySubtasks(sourceRowsRaw, subtasksByTaskId)
        : sourceRowsRaw;
    const countResult = await queryable.query(
        `SELECT COUNT(*)::int AS completed_parent_total
         FROM tasks t
         WHERE ${scope.ownerMatch}
           ${scope.businessCondition}
           AND COALESCE(t.status, 'todo') = 'done'`,
        scope.params
    );
    const completedParentTotal = Number(countResult.rows?.[0]?.completed_parent_total || 0);
    const hasMore = fetchedRows.length > limit;
    return {
        sourceRows,
        pagination: {
            type: 'cursor',
            limit,
            returned: sourceRows.length,
            hasMore,
            nextCursor: hasMore ? encodeCompletionHistoryCursor(sourceRows[sourceRows.length - 1]) : null
        },
        totals: { completedParentTotal }
    };
}

async function normalizeTaskCabinetRows(queryable, options = {}) {
    const rows = Array.isArray(options.rows) ? options.rows : [];
    const user = options.user || {};
    const userId = normalizeUserId(user);
    if (!rows.length) return [];
    if (!userId) {
        const err = new Error('Unauthenticated');
        err.statusCode = 401;
        err.code = 'TASK_CABINET_NORMALIZER_UNAUTHENTICATED';
        throw err;
    }
    const today = options.today;
    const taskIds = [...new Set(rows
        .map(row => Number(row.id || row.task_id || row.taskId))
        .filter(id => Number.isInteger(id) && id > 0))];
    const classificationsByTaskId = await loadTaskClassifications(queryable, userId, taskIds);
    const dependencyStatesByTaskId = await loadTaskDependencyStates(queryable, taskIds);
    const timeTotalsByTaskId = await loadTaskTimeTotals(queryable, userId, taskIds);
    const timeTotalsTodayByTaskId = today
        ? await loadTaskTimeTotalsForDate(queryable, userId, taskIds, today)
        : new Map();
    const explanationTaskIds = [...new Set(rows
        .filter(row => normalizePostponementCount(row.postponement_count ?? row.postponementCount) > 0)
        .map(row => Number(row.id || row.task_id || row.taskId))
        .filter(id => Number.isInteger(id) && id > 0))];
    const postponementEventsByTaskId = await listLatestTaskPostponementEvents(explanationTaskIds, {
        pool: queryable
    });
    return rows.map(row => {
        const taskId = Number(row.id || row.task_id || row.taskId);
        const dependencyState = dependencyStatesByTaskId.get(taskId);
        const completedSubtasksToday = Number(row.completed_subtask_count_today || row.completedSubtasksToday || 0);
        const completedParentToday = String(row.status || row.workflowState || row.workflow_state || '').toLowerCase() === 'done'
            && row.completed_at
            && today
            && taskDateOnly(row.completed_at) === today;
        const completedTodayKind = completedParentToday
            ? (completedSubtasksToday > 0 ? 'task_and_subtasks' : 'task')
            : (completedSubtasksToday > 0 ? 'subtasks' : 'none');
        const task = normalizeTaskPayload({
            ...row,
            dependency_count: dependencyState?.dependencyCount || 0,
            open_dependency_count: dependencyState?.openDependencyCount || 0,
            blocked_by_titles: dependencyState?.blockedByTitles || null,
            dependencies: dependencyState?.dependencies || []
        }, { postponementEvent: postponementEventsByTaskId.get(taskId) || null, user });
        return {
            ...task,
            actualSeconds: timeTotalsByTaskId.get(taskId) || 0,
            actualSecondsToday: timeTotalsTodayByTaskId.get(taskId) || 0,
            completedSubtasksToday,
            completedParentToday: Boolean(completedParentToday),
            completedTodayKind,
            latestSubtaskCompletedAt: row.latest_subtask_completed_at || row.latestSubtaskCompletedAt || null,
            myDay: classificationsByTaskId.get(taskId) || { direction: null, impacts: [] }
        };
    });
}

async function listTaskCompletionHistory(queryable, options = {}) {
    const today = options.today || todayKyivDate(options.now instanceof Date ? options.now : new Date());
    const page = await queryTaskCompletionHistoryPage(queryable, options);
    const items = await normalizeTaskCabinetRows(queryable, {
        rows: page.sourceRows,
        user: options.user,
        today
    });
    return {
        success: true,
        period: 'history',
        items,
        pagination: page.pagination,
        totals: page.totals
    };
}

module.exports = {
    DEFAULT_COMPLETION_HISTORY_LIMIT,
    MAX_COMPLETION_HISTORY_LIMIT,
    completedTaskOrderExpression,
    decodeCompletionHistoryCursor,
    encodeCompletionHistoryCursor,
    listTaskCompletionHistory,
    normalizeCompletionHistoryLimit,
    normalizeTaskCabinetRows,
    queryTaskCompletionHistoryPage,
    taskCabinetRowSelectSql
};
