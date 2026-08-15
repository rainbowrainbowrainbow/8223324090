'use strict';

const {
    buildTaskOwnerMatch,
    canMutateTask,
    canReassignTask,
    canRescheduleTask,
    normalizeUserId
} = require('./taskPolicy');
const { getPermissions } = require('../config/roles');
const {
    attachTaskSchedule,
    canonicalTaskOrderSql,
    dateOnly: taskKyivDateOnly
} = require('./taskScheduling');
const { normalizeTaskPayload: normalizeTaskContractPayload } = require('./taskContract');
const {
    taskCompletionReportId,
    taskControlMeta,
    taskRequiresCompletionReport
} = require('./taskExecution');
const {
    normalizeSubtaskRow,
    subtaskProgress
} = require('./taskSubtasks');
const { deriveTaskIntelligence } = require('./taskIntelligence');
const {
    buildPostponementExplanation,
    postponementAttentionLevel
} = require('./taskPostponementPolicy');
const {
    appendTaskBusinessScopeSql,
    taskBusinessScopeMeta
} = require('./taskBusinessScope');
const {
    normalizeCompletionHistoryLimit,
    queryTaskCompletionHistoryPage
} = require('./taskCompletionHistory');

const DEFAULT_TASK_CABINET_PLANNING_ROW_LIMIT = 260;
const MAX_TASK_CABINET_PLANNING_ROW_LIMIT = 500;
const DEFAULT_TASK_CABINET_BUCKET_PAGE_LIMIT = 80;
const MAX_TASK_CABINET_BUCKET_PAGE_LIMIT = 200;
const DEFAULT_TASK_CABINET_COMPLETED_TODAY_LIMIT = 120;
const TASK_CABINET_PLANNING_BUCKETS = Object.freeze([
    'overdue',
    'today',
    'tomorrow',
    'dayAfterTomorrow',
    'plusThreeDays',
    'monthEnd',
    'noDate'
]);
const TASK_CABINET_PAGE_BUCKETS = Object.freeze([
    ...TASK_CABINET_PLANNING_BUCKETS,
    'completedToday',
    'completedHistory'
]);

function workflowFromStatus(status = 'todo') {
    if (status === 'done') return 'done';
    if (status === 'archived') return 'archived';
    if (status === 'in_progress') return 'in_progress';
    return 'todo';
}

function taskPriorityOrderSql(alias = 't') {
    return `CASE ${alias}.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 2 END`;
}

function taskDateOnly(value) {
    return taskKyivDateOnly(value);
}

function taskWorkloadDate(task = {}) {
    return taskDateOnly(
        task.scheduledStartAt ||
        task.scheduled_start_at ||
        task.schedule?.startAt ||
        task.snoozedUntil ||
        task.snoozed_until ||
        task.date ||
        task.deadline ||
        task.remindAt ||
        task.remind_at
    );
}

function taskWorkloadDateSql(alias = 't') {
    return `COALESCE(
        (${alias}.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.snoozed_until AT TIME ZONE 'Europe/Kyiv')::date,
        CASE WHEN LEFT(COALESCE(${alias}.date, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN LEFT(${alias}.date, 10)::date END,
        (${alias}.deadline AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.remind_at AT TIME ZONE 'Europe/Kyiv')::date
    )`;
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

function addDays(dateText, days) {
    const d = new Date(`${dateText}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function monthEndDate(dateText) {
    const d = new Date(`${dateText}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
}

function normalizeTaskCabinetFocusDate(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    const text = String(raw || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const parsed = new Date(`${text}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10) === text ? text : '';
}

function normalizeTaskCabinetPlanningLimit(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return DEFAULT_TASK_CABINET_PLANNING_ROW_LIMIT;
    return Math.min(numeric, MAX_TASK_CABINET_PLANNING_ROW_LIMIT);
}

function normalizeTaskCabinetBucketLimit(value, fallback = DEFAULT_TASK_CABINET_BUCKET_PAGE_LIMIT) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return fallback;
    return Math.min(numeric, MAX_TASK_CABINET_BUCKET_PAGE_LIMIT);
}

function normalizeTaskCabinetBucketOffset(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return 0;
    return Math.min(numeric, 5000);
}

function normalizeTaskCabinetBucket(value) {
    const text = String(Array.isArray(value) ? value[0] : value || '').trim();
    if (!text) return '';
    return TASK_CABINET_PAGE_BUCKETS.includes(text) ? text : '';
}

function projectionRowTaskId(row = {}) {
    const id = Number(row.id || row.task_id || row.taskId);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

function uniqueTaskIdsFromRows(rows = []) {
    return [...new Set((Array.isArray(rows) ? rows : [])
        .map(projectionRowTaskId)
        .filter(id => Number.isInteger(id) && id > 0))];
}

function taskCabinetPageCursor(bucket, offset, returned, total, limit) {
    const nextOffset = Number(offset || 0) + Number(returned || 0);
    if (!Number.isInteger(total) || nextOffset >= total) return null;
    return {
        bucket,
        offset: nextOffset,
        limit
    };
}

function taskCabinetBucketPageMeta(bucket, { total = 0, returned = 0, offset = 0, limit = DEFAULT_TASK_CABINET_BUCKET_PAGE_LIMIT } = {}) {
    const normalizedTotal = Math.max(0, Number(total || 0));
    const normalizedReturned = Math.max(0, Number(returned || 0));
    const normalizedOffset = Math.max(0, Number(offset || 0));
    const normalizedLimit = normalizeTaskCabinetBucketLimit(limit);
    const hasMore = normalizedOffset + normalizedReturned < normalizedTotal;
    return {
        bucket,
        total: normalizedTotal,
        returned: normalizedReturned,
        offset: normalizedOffset,
        limit: normalizedLimit,
        hasMore,
        isPartial: hasMore || normalizedOffset > 0,
        nextCursor: taskCabinetPageCursor(bucket, normalizedOffset, normalizedReturned, normalizedTotal, normalizedLimit)
    };
}

function taskSnoozedUntilDate(task = {}) {
    const raw = task.snoozedUntil || task.snoozed_until || '';
    const parsed = raw ? new Date(raw) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function isTaskDeferred(task = {}, now = new Date()) {
    const snoozedUntil = taskSnoozedUntilDate(task);
    return Boolean(snoozedUntil && snoozedUntil > now);
}

function taskProjectionUniqueKey(task = {}, fallback = '') {
    return task.id || task.taskId || task.task_id || fallback;
}

function buildTaskCabinetPlanningProjection(rows = [], calendar = {}, now = new Date()) {
    const planning = {
        all: [],
        overdue: [],
        today: [],
        tomorrow: [],
        dayAfterTomorrow: [],
        plusThreeDays: [],
        monthEnd: [],
        noDate: []
    };
    const seen = new Set();
    rows.forEach((task, index) => {
        if (isTaskDeferred(task, now)) return;
        const key = taskProjectionUniqueKey(task, `planning:${index}`);
        if (seen.has(key)) return;
        seen.add(key);
        planning.all.push(task);
        const dueDate = taskWorkloadDate(task);
        if (!dueDate) {
            planning.noDate.push(task);
            return;
        }
        if (calendar.today && dueDate < calendar.today) planning.overdue.push(task);
        if (dueDate === calendar.today) planning.today.push(task);
        if (dueDate === calendar.tomorrow) planning.tomorrow.push(task);
        if (dueDate === calendar.dayAfterTomorrow) planning.dayAfterTomorrow.push(task);
        if (dueDate === calendar.plusThreeDays) planning.plusThreeDays.push(task);
        if (dueDate === calendar.monthEnd) planning.monthEnd.push(task);
    });
    return planning;
}

const normalizeTaskPayload = normalizeTaskContractPayload;

function defaultTaskPreferences(userId) {
    return {
        id: null,
        user_id: userId,
        focus_limit: 3,
        digest_mode: 'important_only',
        default_task_mode: 'personal',
        default_privacy: 'me_only',
        show_private_in_tasks_page: false,
        enable_telegram_reminders: true,
        enable_evening_review: true,
        task_sound_enabled: true,
        task_sound_volume: 0.4,
        task_sound_theme: 'subtle',
        saved_task_views: [],
        saved_task_views_revision: 0,
        created_at: null,
        updated_at: null
    };
}

async function ensureTaskPreferences(queryable, userId) {
    const result = await queryable.query(
        `INSERT INTO task_user_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = task_user_preferences.updated_at
         RETURNING *`,
        [userId]
    );
    return result.rows[0] || defaultTaskPreferences(userId);
}

async function readTaskPreferences(queryable, userId) {
    const result = await queryable.query(
        `SELECT *
         FROM task_user_preferences
         WHERE user_id = $1
         LIMIT 1`,
        [userId]
    );
    return result.rows[0] || defaultTaskPreferences(userId);
}

async function taskPreferencesForProjection(queryable, userId, options = {}) {
    return options.ensurePreferences === false
        ? readTaskPreferences(queryable, userId)
        : ensureTaskPreferences(queryable, userId);
}

async function loadSubtaskProjectionByTaskId(queryable, taskIds = [], today) {
    const ids = [...new Set((Array.isArray(taskIds) ? taskIds : [])
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return new Map();
    const result = await queryable.query(
        `SELECT task_id,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_done = true)::int AS done,
                COUNT(*) FILTER (
                    WHERE is_done = true
                      AND completed_at IS NOT NULL
                      AND DATE(completed_at AT TIME ZONE 'Europe/Kyiv') = $2::date
                )::int AS done_today,
                MAX(completed_at) FILTER (
                    WHERE is_done = true
                      AND completed_at IS NOT NULL
                      AND DATE(completed_at AT TIME ZONE 'Europe/Kyiv') = $2::date
                ) AS latest_completed_at,
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
        [ids, today]
    );
    return new Map((result.rows || []).map(row => [Number(row.task_id), {
        subtask_count: Number(row.total || 0),
        subtask_done_count: Number(row.done || 0),
        completed_subtask_count_today: Number(row.done_today || 0),
        latest_subtask_completed_at: row.latest_completed_at || null,
        subtasks: Array.isArray(row.subtasks) ? row.subtasks : []
    }]));
}

function attachSubtaskProjection(rows = [], subtaskProjectionByTaskId = new Map()) {
    return (Array.isArray(rows) ? rows : []).map(row => {
        const taskId = projectionRowTaskId(row);
        const subtasks = subtaskProjectionByTaskId.get(taskId) || {};
        return {
            ...row,
            subtasks: subtasks.subtasks || [],
            subtask_count: subtasks.subtask_count || 0,
            subtask_done_count: subtasks.subtask_done_count || 0,
            completed_subtask_count_today: subtasks.completed_subtask_count_today || 0,
            latest_subtask_completed_at: subtasks.latest_subtask_completed_at || null
        };
    });
}

async function normalizeTaskCabinetRows(queryable, user, userId, rows = [], today) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const ids = uniqueTaskIdsFromRows(sourceRows);
    const myDayClassificationsByTaskId = await loadTaskClassifications(queryable, userId, ids);
    const dependencyStatesByTaskId = await loadTaskDependencyStates(queryable, ids);
    const taskTimeTotalsByTaskId = await loadTaskTimeTotals(queryable, userId, ids);
    const taskTimeTotalsTodayByTaskId = await loadTaskTimeTotalsForDate(queryable, userId, ids, today);
    const explanationTaskIds = [...new Set(sourceRows
        .filter(row => normalizePostponementCount(row.postponement_count ?? row.postponementCount) > 0)
        .map(projectionRowTaskId)
        .filter(id => Number.isInteger(id) && id > 0))];
    const postponementEventsByTaskId = await listLatestTaskPostponementEvents(explanationTaskIds, {
        pool: queryable
    });
    return sourceRows.map(row => {
        const taskId = projectionRowTaskId(row);
        const dependencyState = dependencyStatesByTaskId.get(taskId);
        const completedSubtasksToday = Number(row.completed_subtask_count_today || row.completedSubtasksToday || 0);
        const completedParentToday = String(row.status || row.workflowState || row.workflow_state || '').toLowerCase() === 'done'
            && row.completed_at
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
            actualSeconds: taskTimeTotalsByTaskId.get(taskId) || 0,
            actualSecondsToday: taskTimeTotalsTodayByTaskId.get(taskId) || 0,
            completedSubtasksToday,
            completedParentToday,
            completedTodayKind,
            latestSubtaskCompletedAt: row.latest_subtask_completed_at || row.latestSubtaskCompletedAt || null,
            myDay: myDayClassificationsByTaskId.get(taskId) || { direction: null, impacts: [] }
        };
    });
}

function mapNormalizedRowsById(rows = []) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
        const id = projectionRowTaskId(row);
        if (id && !map.has(id)) map.set(id, row);
    });
    return map;
}

function rowsFromMap(sourceRows = [], normalizedByTaskId = new Map()) {
    return (Array.isArray(sourceRows) ? sourceRows : [])
        .map(row => normalizedByTaskId.get(projectionRowTaskId(row)))
        .filter(Boolean);
}

function taskCabinetPlanningBucketCondition(bucket, dateSql, todayParam, planningEndParam) {
    switch (bucket) {
        case 'overdue':
            return `${dateSql} < $${todayParam}::date`;
        case 'today':
            return `${dateSql} = $${todayParam}::date`;
        case 'tomorrow':
            return `${dateSql} = ($${todayParam}::date + INTERVAL '1 day')::date`;
        case 'dayAfterTomorrow':
            return `${dateSql} = ($${todayParam}::date + INTERVAL '2 days')::date`;
        case 'plusThreeDays':
            return `${dateSql} = ($${todayParam}::date + INTERVAL '3 days')::date`;
        case 'monthEnd':
            return `${dateSql} = $${planningEndParam}::date`;
        case 'noDate':
            return `${dateSql} IS NULL`;
        default:
            return '';
    }
}

async function buildTaskCabinetBucketPage(options = {}) {
    const queryable = options.pool;
    if (!queryable || typeof queryable.query !== 'function') {
        const err = new Error('Task cabinet projection requires a queryable pool');
        err.statusCode = 500;
        err.code = 'TASK_CABINET_POOL_REQUIRED';
        throw err;
    }

    const user = options.user || {};
    const userId = normalizeUserId(user);
    if (!userId) {
        const err = new Error('Unauthenticated');
        err.statusCode = 401;
        err.code = 'TASK_CABINET_UNAUTHENTICATED';
        throw err;
    }

    const bucket = normalizeTaskCabinetBucket(options.bucket);
    if (!bucket) {
        const err = new Error('Unsupported My Cabinet bucket');
        err.statusCode = 400;
        err.code = 'TASK_CABINET_BUCKET_UNSUPPORTED';
        throw err;
    }

    const businessScope = options.businessScope;
    const now = options.now instanceof Date ? options.now : new Date();
    const today = todayKyivDate(now);
    const tomorrow = addDays(today, 1);
    const dayAfterTomorrow = addDays(today, 2);
    const plusThreeDays = addDays(today, 3);
    const monthEnd = monthEndDate(today);
    const planningEnd = monthEnd > plusThreeDays ? monthEnd : plusThreeDays;
    const limit = normalizeTaskCabinetBucketLimit(options.bucketLimit);
    const offset = normalizeTaskCabinetBucketOffset(options.bucketOffset);
    const params = [];
    const ownMatch = buildTaskOwnerMatch(user, params, 't');
    const ownBusinessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
    params.push(today);
    const todayParam = params.length;
    params.push(planningEnd);
    const planningEndParam = params.length;
    params.push(monthEnd);
    const monthEndParam = params.length;
    const dateSql = taskWorkloadDateSql('t');
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    params.push(limit + 1, offset);

    let whereSql;
    let orderSql;
    if (TASK_CABINET_PLANNING_BUCKETS.includes(bucket)) {
        const planningBucketCondition = bucket === 'monthEnd'
            ? `${dateSql} = $${monthEndParam}::date`
            : taskCabinetPlanningBucketCondition(bucket, dateSql, todayParam, planningEndParam);
        whereSql = `COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
            AND ${planningBucketCondition}`;
        orderSql = `${dateSql} ASC NULLS LAST,
             ${taskPriorityOrderSql('t')},
             CASE WHEN EXISTS (SELECT 1 FROM task_subtasks task_subtask_order WHERE task_subtask_order.task_id = t.id) THEN 0 ELSE 1 END,
             CASE WHEN COALESCE(t.focus_rank, 0) > 0 THEN 0 ELSE 1 END,
             COALESCE(t.focus_rank, 99),
             ${canonicalTaskOrderSql('t')},
             t.created_at DESC,
             t.id DESC`;
    } else if (bucket === 'completedHistory') {
        whereSql = `COALESCE(t.status, 'todo') = 'done'`;
        orderSql = `COALESCE(t.completed_at, t.updated_at, t.created_at) DESC, t.id DESC`;
    } else {
        whereSql = `COALESCE(t.status, 'todo') NOT IN ('cancelled','archived')
            AND (
                (
                    COALESCE(t.status, 'todo') = 'done'
                    AND t.completed_at IS NOT NULL
                    AND DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv') = $${todayParam}::date
                )
                OR EXISTS (
                    SELECT 1
                    FROM task_subtasks today_subtask_exists
                    WHERE today_subtask_exists.task_id = t.id
                      AND today_subtask_exists.is_done = true
                      AND today_subtask_exists.completed_at IS NOT NULL
                      AND DATE(today_subtask_exists.completed_at AT TIME ZONE 'Europe/Kyiv') = $${todayParam}::date
                )
            )`;
        orderSql = `GREATEST(
             COALESCE(t.completed_at, t.updated_at, t.created_at),
             COALESCE((
                SELECT MAX(today_subtask_latest.completed_at)
                FROM task_subtasks today_subtask_latest
                WHERE today_subtask_latest.task_id = t.id
                  AND today_subtask_latest.is_done = true
                  AND today_subtask_latest.completed_at IS NOT NULL
                  AND DATE(today_subtask_latest.completed_at AT TIME ZONE 'Europe/Kyiv') = $${todayParam}::date
             ), t.updated_at, t.created_at)
         ) DESC, t.id DESC`;
    }
    const commonPageParamGuard = `$${todayParam}::date IS NOT NULL
        AND $${planningEndParam}::date IS NOT NULL
        AND $${monthEndParam}::date IS NOT NULL`;
    whereSql = `(${whereSql})
        AND ${commonPageParamGuard}`;

    const countParams = params.slice(0, -2);
    const countResult = await queryable.query(
        `SELECT COUNT(*)::int AS total
         FROM tasks t
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND ${whereSql}`,
        countParams
    );
    const result = await queryable.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND ${whereSql}
         ORDER BY ${orderSql}
         LIMIT $${limitParam}
         OFFSET $${offsetParam}`,
        params
    );
    const rawRows = Array.isArray(result.rows) ? result.rows : [];
    const sourceRowsRaw = rawRows.slice(0, limit);
    const ids = uniqueTaskIdsFromRows(sourceRowsRaw);
    const subtaskProjectionByTaskId = await loadSubtaskProjectionByTaskId(queryable, ids, today);
    const sourceRows = attachSubtaskProjection(sourceRowsRaw, subtaskProjectionByTaskId);
    const tasks = await normalizeTaskCabinetRows(queryable, user, userId, sourceRows, today);
    const total = Number(countResult.rows?.[0]?.total || tasks.length);
    return {
        success: true,
        bucket,
        tasks,
        items: tasks,
        meta: {
            canonicalOwnerField: 'tasks.owner_user_id',
            projection: 'my_cabinet_bucket',
            calendar: {
                timezone: 'Europe/Kyiv',
                today,
                tomorrow,
                dayAfterTomorrow,
                plusThreeDays,
                monthEnd,
                planningEnd
            },
            bucketPage: taskCabinetBucketPageMeta(bucket, {
                total,
                returned: tasks.length,
                offset,
                limit
            }),
            privacyRule: 'private/me_only tasks are owner-only',
            businessScope: taskBusinessScopeMeta(businessScope)
        }
    };
}

async function buildTaskCabinetProjection(options = {}) {
    const queryable = options.pool;
    if (!queryable || typeof queryable.query !== 'function') {
        const err = new Error('Task cabinet projection requires a queryable pool');
        err.statusCode = 500;
        err.code = 'TASK_CABINET_POOL_REQUIRED';
        throw err;
    }

    const user = options.user || {};
    const userId = normalizeUserId(user);
    if (!userId) {
        const err = new Error('Unauthenticated');
        err.statusCode = 401;
        err.code = 'TASK_CABINET_UNAUTHENTICATED';
        throw err;
    }

    const businessScope = options.businessScope;
    const ownParams = [];
    const ownMatch = buildTaskOwnerMatch(user, ownParams, 't');
    const ownBusinessCondition = appendTaskBusinessScopeSql(ownParams, businessScope, 't');
    const now = options.now instanceof Date ? options.now : new Date();
    const today = todayKyivDate(now);
    const tomorrow = addDays(today, 1);
    const dayAfterTomorrow = addDays(today, 2);
    const plusThreeDays = addDays(today, 3);
    const monthEnd = monthEndDate(today);
    const planningEnd = monthEnd > plusThreeDays ? monthEnd : plusThreeDays;
    const focusDate = normalizeTaskCabinetFocusDate(options.focusDate);
    const planningRowLimit = normalizeTaskCabinetPlanningLimit(options.planningRowLimit);
    const planningFetchLimit = planningRowLimit + 1;
    const nextWeek = addDays(today, 7);
    const completedHistoryLimit = normalizeCompletionHistoryLimit(options.completedHistoryLimit);

    const result = await queryable.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
          ORDER BY
             ${taskPriorityOrderSql('t')},
             CASE WHEN EXISTS (SELECT 1 FROM task_subtasks task_subtask_order WHERE task_subtask_order.task_id = t.id) THEN 0 ELSE 1 END,
             CASE WHEN COALESCE(t.focus_rank, 0) > 0 THEN 0 ELSE 1 END,
             COALESCE(t.focus_rank, 99),
             ${canonicalTaskOrderSql('t')},
             COALESCE(t.snoozed_until, t.deadline, t.remind_at, t.date::timestamp, t.created_at) ASC,
             t.created_at DESC,
             t.id DESC
         LIMIT 160`,
        ownParams
    );
    const activeSourceRowsRaw = Array.isArray(result.rows) ? result.rows : [];

    const openCountResult = await queryable.query(
        `SELECT COUNT(*)::int AS open_count
         FROM tasks t
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')`,
        ownParams
    );
    const openTaskCount = Number(openCountResult.rows[0]?.open_count || activeSourceRowsRaw.length);
    const calendar = {
        timezone: 'Europe/Kyiv',
        today,
        tomorrow,
        dayAfterTomorrow,
        plusThreeDays,
        monthEnd,
        planningEnd,
        focusDate: focusDate || null,
        planningWindow: 'overdue_undated_through_planning_end'
    };
    const planningParams = [...ownParams, today, planningEnd];
    const planningStartParam = ownParams.length + 1;
    const planningEndParam = ownParams.length + 2;
    const planningFocusParam = focusDate ? planningParams.length + 1 : null;
    if (focusDate) planningParams.push(focusDate);
    const planningLimitParam = planningParams.length + 1;
    planningParams.push(planningFetchLimit);
    const planningDateSql = taskWorkloadDateSql('t');
    const planningFocusDateSql = focusDate
        ? `OR ${planningDateSql} = $${planningFocusParam}::date`
        : '';
    const planningResult = await queryable.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
           AND (
                ${planningDateSql} IS NULL
                OR ${planningDateSql} < $${planningStartParam}::date
                OR ${planningDateSql} BETWEEN $${planningStartParam}::date AND $${planningEndParam}::date
                ${planningFocusDateSql}
           )
         ORDER BY
             CASE
                 WHEN ${planningDateSql} IS NULL THEN 4
                 WHEN ${planningDateSql} < $${planningStartParam}::date THEN 0
                 WHEN ${planningDateSql} = $${planningStartParam}::date THEN 1
                 ELSE 2
             END,
             ${planningDateSql} ASC NULLS LAST,
             ${taskPriorityOrderSql('t')},
             CASE WHEN EXISTS (SELECT 1 FROM task_subtasks task_subtask_order WHERE task_subtask_order.task_id = t.id) THEN 0 ELSE 1 END,
             CASE WHEN COALESCE(t.focus_rank, 0) > 0 THEN 0 ELSE 1 END,
             COALESCE(t.focus_rank, 99),
             ${canonicalTaskOrderSql('t')},
             t.created_at DESC,
             t.id DESC
         LIMIT $${planningLimitParam}`,
        planningParams
    );
    const planningResultRows = Array.isArray(planningResult.rows) ? planningResult.rows : [];
    const planningIsPartial = planningResultRows.length > planningRowLimit;
    const planningSourceRowsRaw = planningResultRows.slice(0, planningRowLimit);

    const completedHistoryPage = await queryTaskCompletionHistoryPage(queryable, {
        user,
        businessScope,
        limit: completedHistoryLimit
    });
    const completedHistorySourceRowsRaw = Array.isArray(completedHistoryPage.sourceRows)
        ? completedHistoryPage.sourceRows
        : [];
    const completedTodayRowLimit = normalizeTaskCabinetBucketLimit(
        options.completedTodayLimit,
        DEFAULT_TASK_CABINET_COMPLETED_TODAY_LIMIT
    );
    const completedTodayFetchLimit = completedTodayRowLimit + 1;
    const completedTodayParams = [...ownParams, today, completedTodayFetchLimit];
    const completedTodayLimitParam = completedTodayParams.length;
    const completedTodayDatePlaceholder = completedTodayParams.length - 1;
    const completedTodayResult = await queryable.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND COALESCE(t.status, 'todo') NOT IN ('cancelled','archived')
           AND (
                (
                    COALESCE(t.status, 'todo') = 'done'
                    AND t.completed_at IS NOT NULL
                    AND DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv') = $${completedTodayDatePlaceholder}::date
                )
                OR EXISTS (
                    SELECT 1
                    FROM task_subtasks today_subtask_exists
                    WHERE today_subtask_exists.task_id = t.id
                      AND today_subtask_exists.is_done = true
                      AND today_subtask_exists.completed_at IS NOT NULL
                      AND DATE(today_subtask_exists.completed_at AT TIME ZONE 'Europe/Kyiv') = $${completedTodayDatePlaceholder}::date
                )
           )
         ORDER BY GREATEST(
             COALESCE(t.completed_at, t.updated_at, t.created_at),
             COALESCE((
                SELECT MAX(today_subtask_latest.completed_at)
                FROM task_subtasks today_subtask_latest
                WHERE today_subtask_latest.task_id = t.id
                  AND today_subtask_latest.is_done = true
                  AND today_subtask_latest.completed_at IS NOT NULL
                  AND DATE(today_subtask_latest.completed_at AT TIME ZONE 'Europe/Kyiv') = $${completedTodayDatePlaceholder}::date
             ), t.updated_at, t.created_at)
         ) DESC, t.id DESC
         LIMIT $${completedTodayLimitParam}`,
        completedTodayParams
    );
    const completedTodayResultRows = Array.isArray(completedTodayResult.rows)
        ? completedTodayResult.rows
        : [];
    const completedTodayIsPartial = completedTodayResultRows.length > completedTodayRowLimit;
    const completedTodaySourceRowsRaw = completedTodayResultRows.slice(0, completedTodayRowLimit);
    const completedTodayCountResult = await queryable.query(
        `SELECT COUNT(*)::int AS total
         FROM tasks t
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND COALESCE(t.status, 'todo') NOT IN ('cancelled','archived')
           AND (
                (
                    COALESCE(t.status, 'todo') = 'done'
                    AND t.completed_at IS NOT NULL
                    AND DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv') = $${completedTodayDatePlaceholder}::date
                )
                OR EXISTS (
                    SELECT 1
                    FROM task_subtasks today_subtask_exists
                    WHERE today_subtask_exists.task_id = t.id
                      AND today_subtask_exists.is_done = true
                      AND today_subtask_exists.completed_at IS NOT NULL
                      AND DATE(today_subtask_exists.completed_at AT TIME ZONE 'Europe/Kyiv') = $${completedTodayDatePlaceholder}::date
                )
           )`,
        completedTodayParams.slice(0, -1)
    );
    const completedTodayTotal = Number(completedTodayCountResult.rows?.[0]?.total || completedTodaySourceRowsRaw.length);
    const allSourceRowsRaw = [
        ...activeSourceRowsRaw,
        ...planningSourceRowsRaw,
        ...completedHistorySourceRowsRaw,
        ...completedTodaySourceRowsRaw
    ];
    const myDayTaskIds = uniqueTaskIdsFromRows(allSourceRowsRaw);
    const subtaskProjectionByTaskId = await loadSubtaskProjectionByTaskId(queryable, myDayTaskIds, today);
    const allSourceRows = attachSubtaskProjection(allSourceRowsRaw, subtaskProjectionByTaskId);
    const normalizedAllRows = await normalizeTaskCabinetRows(queryable, user, userId, allSourceRows, today);
    const normalizedByTaskId = mapNormalizedRowsById(normalizedAllRows);
    const activeSourceRows = attachSubtaskProjection(activeSourceRowsRaw, subtaskProjectionByTaskId);
    const planningSourceRows = attachSubtaskProjection(planningSourceRowsRaw, subtaskProjectionByTaskId);
    const completedHistorySourceRows = attachSubtaskProjection(completedHistorySourceRowsRaw, subtaskProjectionByTaskId);
    const completedTodaySourceRows = attachSubtaskProjection(completedTodaySourceRowsRaw, subtaskProjectionByTaskId);
    const rows = rowsFromMap(activeSourceRows, normalizedByTaskId);
    const planningRows = rowsFromMap(planningSourceRows, normalizedByTaskId);
    const planning = buildTaskCabinetPlanningProjection(planningRows, calendar, now);
    const planningVisibleCounts = Object.fromEntries(
        Object.entries(planning).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
    );
    const planningCountParams = [...ownParams, today, planningEnd, monthEnd];
    const planningCountStartParam = ownParams.length + 1;
    const planningCountEndParam = ownParams.length + 2;
    const planningCountMonthEndParam = ownParams.length + 3;
    const planningCountFocusParam = focusDate ? planningCountParams.length + 1 : null;
    if (focusDate) planningCountParams.push(focusDate);
    const planningCountFocusDateSql = focusDate
        ? `OR ${planningDateSql} = $${planningCountFocusParam}::date`
        : '';
    const planningCountResult = await queryable.query(
        `SELECT bucket, COUNT(*)::int AS total
         FROM (
             SELECT CASE
                 WHEN ${planningDateSql} IS NULL THEN 'noDate'
                 WHEN ${planningDateSql} < $${planningCountStartParam}::date THEN 'overdue'
                 WHEN ${planningDateSql} = $${planningCountStartParam}::date THEN 'today'
                 WHEN ${planningDateSql} = ($${planningCountStartParam}::date + INTERVAL '1 day')::date THEN 'tomorrow'
                 WHEN ${planningDateSql} = ($${planningCountStartParam}::date + INTERVAL '2 days')::date THEN 'dayAfterTomorrow'
                 WHEN ${planningDateSql} = ($${planningCountStartParam}::date + INTERVAL '3 days')::date THEN 'plusThreeDays'
                 WHEN ${planningDateSql} = $${planningCountMonthEndParam}::date THEN 'monthEnd'
                 ELSE 'later'
             END AS bucket
             FROM tasks t
             WHERE ${ownMatch}
               ${ownBusinessCondition}
               AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
               AND (
                    ${planningDateSql} IS NULL
                    OR ${planningDateSql} < $${planningCountStartParam}::date
                    OR ${planningDateSql} BETWEEN $${planningCountStartParam}::date AND $${planningCountEndParam}::date
                    ${planningCountFocusDateSql}
               )
         ) counted
         GROUP BY bucket`,
        planningCountParams
    );
    const planningTotals = Object.fromEntries(
        TASK_CABINET_PLANNING_BUCKETS.map(bucket => [bucket, 0])
    );
    (planningCountResult.rows || []).forEach(row => {
        if (Object.hasOwn(planningTotals, row.bucket)) planningTotals[row.bucket] = Number(row.total || 0);
    });
    const planningBucketMeta = Object.fromEntries(TASK_CABINET_PLANNING_BUCKETS.map(bucket => {
        const returned = planningVisibleCounts[bucket] || 0;
        return [bucket, taskCabinetBucketPageMeta(bucket, {
            total: planningTotals[bucket] ?? returned,
            returned,
            offset: 0,
            limit: planningRowLimit
        })];
    }));
    const planningMeta = {
        rowLimit: planningRowLimit,
        returnedRows: planningRows.length,
        fetchedRows: planningResultRows.length,
        isPartial: planningIsPartial,
        hasMore: planningIsPartial,
        overflowRowsSampled: planningIsPartial ? planningResultRows.length - planningRows.length : 0,
        totals: planningTotals,
        visibleCounts: planningVisibleCounts,
        buckets: planningBucketMeta,
        order: 'overdue_today_later_no_date'
    };
    const completedHistory = rowsFromMap(completedHistorySourceRows, normalizedByTaskId);
    const completedTodayTasks = rowsFromMap(completedTodaySourceRows, normalizedByTaskId);
    const completedTodayMeta = taskCabinetBucketPageMeta('completedToday', {
        total: completedTodayTotal,
        returned: completedTodayTasks.length,
        offset: 0,
        limit: completedTodayRowLimit
    });

    const buckets = {
        focus: [],
        today: [],
        next: [],
        deferred: [],
        waiting: [],
        private: [],
        overdue: [],
        inbox: []
    };
    rows.forEach(task => {
        const dueDate = taskWorkloadDate(task);
        const workflow = task.workflowState || 'todo';
        const visibility = task.visibility || 'team';
        const mode = task.taskMode || 'work';
        if (Number(task.focusRank || 0) > 0) buckets.focus.push(task);
        if (workflow === 'waiting' || task.taskKind === 'waiting') buckets.waiting.push(task);
        if (visibility === 'private' || mode === 'private') buckets.private.push(task);
        if (workflow === 'inbox') buckets.inbox.push(task);
        if (isTaskDeferred(task, now)) {
            buckets.deferred.push(task);
            return;
        }
        if (dueDate && dueDate < today) buckets.overdue.push(task);
        if (dueDate === today || !dueDate) buckets.today.push(task);
        if (dueDate && dueDate >= tomorrow && dueDate <= nextWeek) buckets.next.push(task);
    });

    const quickParams = [];
    const quickOwnerMatch = buildTaskOwnerMatch(user, quickParams, 't');
    const quickBusinessCondition = appendTaskBusinessScopeSql(quickParams, businessScope, 't');
    quickParams.push(today);
    const quickDateSql = taskWorkloadDateSql('t');
    const quickResult = await queryable.query(
        `SELECT
                COUNT(*) FILTER (WHERE COALESCE(t.status, 'todo') = 'done')::int AS parent_done_total,
                (
                    COUNT(*) FILTER (WHERE COALESCE(t.status, 'todo') = 'done')
                    + COALESCE(SUM(COALESCE(st.done, 0)), 0)
                )::int AS done_total,
                (
                    COUNT(*) FILTER (
                        WHERE COALESCE(t.status, 'todo') = 'done'
                          AND t.completed_at IS NOT NULL
                          AND DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv') = $${quickParams.length}::date
                    )
                    + COALESCE(SUM(COALESCE(st.done_today, 0)), 0)
                )::int AS done_today,
                COUNT(*) FILTER (
                    WHERE COALESCE(t.status, 'todo') = 'done'
                      AND t.completed_at IS NOT NULL
                      AND DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv') = $${quickParams.length}::date
                )::int AS parent_done_today,
                COALESCE(SUM(COALESCE(st.done_today, 0)), 0)::int AS subtask_done_today,
                COALESCE(SUM(COALESCE(st.done, 0)), 0)::int AS subtask_done_total,
                COUNT(*) FILTER (
                    WHERE COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
                      AND (${quickDateSql} = $${quickParams.length}::date OR ${quickDateSql} IS NULL)
                )::int AS remaining_today,
                COUNT(*) FILTER (
                    WHERE COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
                      AND ${quickDateSql} < $${quickParams.length}::date
                )::int AS overdue_carryover,
                COUNT(*) FILTER (
                    WHERE COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
                      AND (${quickDateSql} <= $${quickParams.length}::date OR ${quickDateSql} IS NULL)
                )::int AS active_my_day
         FROM tasks t
         LEFT JOIN (
            SELECT task_id,
                   COUNT(*) FILTER (WHERE is_done = true)::int AS done,
                   COUNT(*) FILTER (
                       WHERE is_done = true
                         AND completed_at IS NOT NULL
                         AND DATE(completed_at AT TIME ZONE 'Europe/Kyiv') = $${quickParams.length}::date
                   )::int AS done_today
            FROM task_subtasks
            GROUP BY task_id
         ) st ON st.task_id = t.id
         WHERE ${quickOwnerMatch}
           ${quickBusinessCondition}`,
        quickParams
    );
    const quickStats = quickResult.rows[0] || {};
    const remainingToday = Number(quickStats.remaining_today || 0);
    const overdueCarryover = Number(quickStats.overdue_carryover || 0);
    const activeMyDay = Number(quickStats.active_my_day || 0) || remainingToday + overdueCarryover || buckets.today.length + buckets.overdue.length;
    const completedParentTotal = Number(quickStats.parent_done_total || 0);
    const completedSubtasksTotal = Number(quickStats.subtask_done_total || 0);
    const completedUnitsTotal = Number(quickStats.done_total || (completedParentTotal + completedSubtasksTotal) || 0);
    const completedParentToday = Number(quickStats.parent_done_today || 0);
    const completedSubtasksToday = Number(quickStats.subtask_done_today || 0);
    const completedUnitsToday = Number(quickStats.done_today || (completedParentToday + completedSubtasksToday) || 0);
    const prefs = await taskPreferencesForProjection(queryable, userId, {
        ensurePreferences: options.ensurePreferences !== false
    });

    return {
        success: true,
        focus: buckets.focus.slice(0, prefs.focus_limit || 3),
        today: buckets.today,
        next: buckets.next,
        deferred: buckets.deferred,
        waiting: buckets.waiting,
        private: buckets.private,
        overdue: buckets.overdue,
        inbox: buckets.inbox,
        completedTodayTasks,
        completedHistory,
        all: rows,
        planning,
        preferences: prefs,
        stats: {
            todayDone: completedUnitsToday,
            todayPlanned: remainingToday || buckets.today.length,
            todayWorkloadCount: remainingToday || buckets.today.length,
            overdueCarryover,
            overdueCarryoverCount: overdueCarryover,
            activeMyDay,
            activeMyDayCount: activeMyDay,
            openTaskCount,
            activeOpenCount: openTaskCount,
            taskQuick: {
                completed: completedUnitsToday,
                completedToday: completedUnitsToday,
                completedTotal: completedUnitsTotal,
                completedUnitsTotal,
                completedParentTotal,
                completedSubtasksTotal,
                completedUnitsToday,
                completedParentToday,
                completedSubtasksToday,
                completedHistoryShown: completedHistory.length,
                completedHistoryOverflow: Math.max(0, completedParentTotal - completedHistory.length),
                remaining: activeMyDay,
                todayRemaining: remainingToday || buckets.today.length,
                overdueCarryover,
                activeMyDay,
                open: openTaskCount,
                openTotal: openTaskCount,
                sidebarOpenWorkload: openTaskCount,
                sidebarScope: 'all_open_owned_tasks_in_business_scope',
                scope: 'completed_units_today_and_active_my_day_or_undated',
                completedMetricContract: 'completed_units = completed_parent_tasks + completed_subtasks',
                completedHistoryContract: 'completed_history_contains_parent_tasks_only',
                completedTodayTasksContract: 'task_completed_today_or_task_with_subtasks_completed_today'
            },
            waitingCount: buckets.waiting.length,
            deferredCount: buckets.deferred.length,
            overdueCount: buckets.overdue.length,
            privateCount: buckets.private.length,
            inboxCount: buckets.inbox.length,
            focusCount: buckets.focus.length
        },
        meta: {
            canonicalOwnerField: 'tasks.owner_user_id',
            projection: 'my_cabinet',
            calendar,
            buckets: {
                planning: planningBucketMeta,
                completedToday: completedTodayMeta,
                completedHistory: taskCabinetBucketPageMeta('completedHistory', {
                    total: completedParentTotal,
                    returned: completedHistory.length,
                    offset: 0,
                    limit: completedHistoryLimit
                })
            },
            postponementExplanationContract: 'postponement_explanation_v1',
            planning: planningMeta,
            completedHistory: {
                ...completedHistoryPage.pagination,
                source: 'parent_tasks_keyset_history',
                order: 'COALESCE(completed_at, updated_at, created_at) DESC, id DESC'
            },
            privacyRule: 'private/me_only tasks are owner-only',
            businessScope: taskBusinessScopeMeta(businessScope)
        }
    };
}

module.exports = {
    buildTaskCabinetBucketPage,
    buildTaskCabinetProjection,
    defaultTaskPreferences,
    ensureTaskPreferences,
    normalizeTaskCabinetBucket,
    normalizeTaskCabinetFocusDate,
    normalizeTaskCabinetBucketLimit,
    normalizeTaskCabinetBucketOffset,
    normalizeTaskPayload,
    readTaskPreferences
};
