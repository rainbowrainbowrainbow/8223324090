'use strict';

const {
    buildTaskOwnerMatch,
    normalizeUserId
} = require('./taskPolicy');
const {
    attachTaskSchedule,
    canonicalTaskOrderSql,
    dateOnly: taskKyivDateOnly
} = require('./taskScheduling');
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
    appendTaskBusinessScopeSql,
    taskBusinessScopeMeta
} = require('./taskBusinessScope');

const DEFAULT_TASK_CABINET_PLANNING_ROW_LIMIT = 260;
const MAX_TASK_CABINET_PLANNING_ROW_LIMIT = 500;

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

function normalizeTaskPayload(row) {
    const scheduledRow = attachTaskSchedule(row);
    const ownerLabel = row.owner_name || row.owner_username || row.assigned_to || row.owner || null;
    const ownerState = row.owner_user_id ? 'typed' : (row.assigned_to || row.owner ? 'legacy_unknown_owner' : 'unassigned');
    const status = row.status || 'todo';
    const taskMode = row.task_mode || 'work';
    const taskKind = row.task_kind || 'action';
    const visibility = row.visibility || (taskMode === 'private' ? 'private' : 'team');
    const workflowState = row.workflow_state || workflowFromStatus(status);
    const controlMeta = taskControlMeta(row);
    const explicitRescheduleFalse = value => value === false || value === 'false' || value === '0' || value === 0 || value === 'off' || value === 'no';
    const canReschedule = !explicitRescheduleFalse(controlMeta.canReschedule)
        && !explicitRescheduleFalse(controlMeta.allowReschedule)
        && !explicitRescheduleFalse(controlMeta.rescheduleAllowed);
    const reportId = taskCompletionReportId(row);
    const reportRequired = taskRequiresCompletionReport(row);
    const subtaskCount = Number(row.subtask_count || 0);
    const subtaskDoneCount = Number(row.subtask_done_count || 0);
    const progress = subtaskProgress(subtaskDoneCount, subtaskCount);
    const subtasks = Array.isArray(row.subtasks) ? row.subtasks.map(normalizeSubtaskRow) : [];
    return {
        ...scheduledRow,
        ownerLabel,
        ownerState,
        ownerUserId: row.owner_user_id || null,
        taskMode,
        taskKind,
        visibility,
        observerCount: Number(row.observer_count || 0),
        viewerIsObserver: row.viewer_is_observer === true,
        viewerObserverAccessLevel: row.viewer_observer_access_level || null,
        observers: Array.isArray(row.observers) ? row.observers : [],
        observerUserIds: Array.isArray(row.observers) ? row.observers.map(item => item.userId || item.user_id).filter(Boolean) : [],
        materialAccess: row.viewer_is_observer === true ? 'observer_full_read' : 'policy_default',
        workflowState,
        focusRank: row.focus_rank || 0,
        remindAt: row.remind_at || null,
        snoozedUntil: row.snoozed_until || null,
        postponementCount: Math.max(0, Number(row.postponement_count ?? row.postponementCount ?? 0) || 0),
        originalDueAt: row.original_due_at || row.originalDueAt || null,
        lastPostponedAt: row.last_postponed_at || row.lastPostponedAt || null,
        nextNotificationAt: row.next_notification_at || null,
        completedAt: row.completed_at || null,
        archivedAt: row.archived_at || null,
        archiveReason: row.archive_reason || null,
        duplicateOfTaskId: row.duplicate_of_task_id || null,
        eveningReviewDate: row.evening_review_date || null,
        relatedEntityType: row.related_entity_type || null,
        relatedEntityId: row.related_entity_id || null,
        sourceModule: row.source_module || null,
        effortMinutes: row.effort_minutes || null,
        subcategory: row.subcategory || null,
        checklistTemplateKey: row.checklist_template_key || null,
        sourceEntityType: row.source_entity_type || null,
        sourceEntityId: row.source_entity_id || null,
        packId: row.pack_id || null,
        packStatus: row.pack_status || null,
        ownerRole: row.owner_role || null,
        slaMinutes: row.sla_minutes || null,
        escalateAfter: row.escalate_after || null,
        controlMode: row.control_mode || 'normal',
        criticalReason: row.critical_reason || null,
        controlMeta,
        canReschedule,
        allowReschedule: canReschedule,
        reportRequired,
        requiresReport: reportRequired,
        reportId,
        subtaskCount,
        subtaskDoneCount,
        subtaskProgress: progress,
        subtaskProgressPercent: progress,
        subtasks,
        dependencyCount: Number(row.dependency_count || 0),
        openDependencyCount: Number(row.open_dependency_count || 0),
        blockedByTitles: row.blocked_by_titles || null,
        isBlocked: Number(row.open_dependency_count || 0) > 0,
        intelligence: deriveTaskIntelligence({
            ...row,
            owner_label: ownerLabel,
            ownerState
        })
    };
}

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
    const completedHistoryLimit = Number.isInteger(options.completedHistoryLimit) && options.completedHistoryLimit > 0
        ? options.completedHistoryLimit
        : 36;

    const result = await queryable.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username,
                COALESCE(subtask_rows.subtasks, '[]'::json) AS subtasks,
                COALESCE(st.total, 0)::int AS subtask_count,
                COALESCE(st.done, 0)::int AS subtask_done_count
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         LEFT JOIN (
            SELECT task_id,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE is_done = true)::int AS done
            FROM task_subtasks
            GROUP BY task_id
         ) st ON st.task_id = t.id
         LEFT JOIN (
            SELECT task_id,
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
            GROUP BY task_id
         ) subtask_rows ON subtask_rows.task_id = t.id
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
          ORDER BY
             ${taskPriorityOrderSql('t')},
             CASE WHEN COALESCE(st.total, 0) > 0 THEN 0 ELSE 1 END,
             CASE WHEN COALESCE(t.focus_rank, 0) > 0 THEN 0 ELSE 1 END,
             COALESCE(t.focus_rank, 99),
             ${canonicalTaskOrderSql('t')},
             COALESCE(t.snoozed_until, t.deadline, t.remind_at, t.date::timestamp, t.created_at) ASC,
             t.created_at DESC,
             t.id DESC
         LIMIT 160`,
        ownParams
    );
    const rows = result.rows.map(normalizeTaskPayload);

    const openCountResult = await queryable.query(
        `SELECT COUNT(*)::int AS open_count
         FROM tasks t
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')`,
        ownParams
    );
    const openTaskCount = Number(openCountResult.rows[0]?.open_count || rows.length);
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
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username,
                COALESCE(subtask_rows.subtasks, '[]'::json) AS subtasks,
                COALESCE(st.total, 0)::int AS subtask_count,
                COALESCE(st.done, 0)::int AS subtask_done_count
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         LEFT JOIN (
            SELECT task_id,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE is_done = true)::int AS done
            FROM task_subtasks
            GROUP BY task_id
         ) st ON st.task_id = t.id
         LEFT JOIN (
            SELECT task_id,
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
            GROUP BY task_id
         ) subtask_rows ON subtask_rows.task_id = t.id
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
             CASE WHEN COALESCE(st.total, 0) > 0 THEN 0 ELSE 1 END,
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
    const planningRows = planningResultRows
        .slice(0, planningRowLimit)
        .map(normalizeTaskPayload);
    const planning = buildTaskCabinetPlanningProjection(planningRows, calendar, now);
    const planningVisibleCounts = Object.fromEntries(
        Object.entries(planning).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
    );
    const planningMeta = {
        rowLimit: planningRowLimit,
        returnedRows: planningRows.length,
        fetchedRows: planningResultRows.length,
        isPartial: planningIsPartial,
        hasMore: planningIsPartial,
        overflowRowsSampled: planningIsPartial ? planningResultRows.length - planningRows.length : 0,
        visibleCounts: planningVisibleCounts,
        order: 'overdue_today_later_no_date'
    };

    const completedHistoryParams = [...ownParams, completedHistoryLimit];
    const completedHistoryResult = await queryable.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username,
                COALESCE(subtask_rows.subtasks, '[]'::json) AS subtasks,
                COALESCE(st.total, 0)::int AS subtask_count,
                COALESCE(st.done, 0)::int AS subtask_done_count
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         LEFT JOIN (
            SELECT task_id,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE is_done = true)::int AS done
            FROM task_subtasks
            GROUP BY task_id
         ) st ON st.task_id = t.id
         LEFT JOIN (
            SELECT task_id,
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
            GROUP BY task_id
         ) subtask_rows ON subtask_rows.task_id = t.id
         WHERE ${ownMatch}
           ${ownBusinessCondition}
           AND COALESCE(t.status, 'todo') = 'done'
         ORDER BY COALESCE(t.completed_at, t.updated_at, t.created_at) DESC, t.id DESC
         LIMIT $${completedHistoryParams.length}`,
        completedHistoryParams
    );
    const completedHistory = completedHistoryResult.rows.map(normalizeTaskPayload);

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
        completedHistory,
        all: rows,
        planning,
        preferences: prefs,
        stats: {
            todayDone: quickStats.done_today || 0,
            todayPlanned: remainingToday || buckets.today.length,
            todayWorkloadCount: remainingToday || buckets.today.length,
            overdueCarryover,
            overdueCarryoverCount: overdueCarryover,
            activeMyDay,
            activeMyDayCount: activeMyDay,
            openTaskCount,
            activeOpenCount: openTaskCount,
            taskQuick: {
                completed: quickStats.done_today || 0,
                completedToday: quickStats.done_today || 0,
                completedTotal: quickStats.done_total || 0,
                completedParentToday: quickStats.parent_done_today || 0,
                completedSubtasksToday: quickStats.subtask_done_today || 0,
                completedSubtasksTotal: quickStats.subtask_done_total || 0,
                completedHistoryShown: completedHistory.length,
                completedHistoryOverflow: Math.max(0, Number(quickStats.done_total || 0) - completedHistory.length),
                remaining: activeMyDay,
                todayRemaining: remainingToday || buckets.today.length,
                overdueCarryover,
                activeMyDay,
                open: openTaskCount,
                openTotal: openTaskCount,
                sidebarOpenWorkload: openTaskCount,
                sidebarScope: 'all_open_owned_tasks_in_business_scope',
                scope: 'completed_units_today_and_active_my_day_or_undated',
                completedMetricContract: 'completed_units = completed_parent_tasks + completed_subtasks'
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
            planning: planningMeta,
            privacyRule: 'private/me_only tasks are owner-only',
            businessScope: taskBusinessScopeMeta(businessScope)
        }
    };
}

module.exports = {
    buildTaskCabinetProjection,
    defaultTaskPreferences,
    ensureTaskPreferences,
    normalizeTaskCabinetFocusDate,
    normalizeTaskPayload,
    readTaskPreferences
};
