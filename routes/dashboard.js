/**
 * routes/dashboard.js — Dashboard API (v24.3.0)
 * User dashboard config, widget data, /today aggregate, weather/currency cache
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken, canUseAction, ROLE_LEVEL } = require('../middleware/auth');
const { getDefaultWidgets, canAccessDashboardWidget } = require('../config/roles');
const { createLogger } = require('../utils/logger');
const { getKyivDateStr } = require('../services/booking');
const { buildTaskVisibilityScope, normalizeUserId, taskOwnerState, userNameTokens } = require('../services/taskPolicy');
const { normalizeSubtaskSummary } = require('../services/taskSubtasks');
const { buildTaskOperationsSummary, deriveTaskIntelligence } = require('../services/taskIntelligence');
const { getOnlineUserIds } = require('../services/websocket');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const { buildWorkQueue } = require('../services/workQueue');
const { getOmniAccountAlertsAsync } = require('../services/omni-accounts');
const { TASK_ACTION_TYPES } = require('../services/taskActionHistory');
const {
    taskKpiActiveWorkSql,
    taskKpiCanonicalOverdueSql,
    taskKpiCompletedSql,
    taskKpiEligibleSql,
    taskKpiMachineSignalSql,
    taskKpiWorkloadDateSql
} = require('../services/taskPerformancePolicy');
const {
    resolveBusinessScope,
    requireBusinessScope,
    pushBusinessScopeCondition
} = require('../services/businessContext');
const { installRevenueResponseShaper } = require('../services/revenueAccessPolicy');
const { legacyBusinessSurfaceAccess } = require('../services/legacyBusinessSurface');

const log = createLogger('Dashboard');
const SALES_LEAD_TYPE_FILTER = "COALESCE(lead_type, 'quality') = 'quality'";
const CLOSED_LEAD_STAGES = ['completed', 'closed', 'lost'];

function safeBookingStartMinutesSql(alias = 'b') {
    return `
    CASE
        WHEN LEFT(BTRIM(COALESCE(${alias}.time::text, '')), 5) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        THEN EXTRACT(HOUR FROM LEFT(BTRIM(${alias}.time::text), 5)::time)::int * 60
           + EXTRACT(MINUTE FROM LEFT(BTRIM(${alias}.time::text), 5)::time)::int
        ELSE NULL
    END
`;
}

const SAFE_BOOKING_START_MINUTES_SQL = safeBookingStartMinutesSql('b');
const BOOKING_LINE_UNASSIGNED_SQL = "(NULLIF(BTRIM(COALESCE(b.line_id::text, '')), '') IS NULL OR BTRIM(b.line_id::text) = '0')";
const URGENT_TASK_MOVEMENT_ACTION_TYPES = [
    TASK_ACTION_TYPES.COMPLETED,
    TASK_ACTION_TYPES.STATUS_CHANGED,
    TASK_ACTION_TYPES.RESCHEDULED,
    TASK_ACTION_TYPES.SCHEDULED,
    TASK_ACTION_TYPES.SCHEDULE_MOVED,
    TASK_ACTION_TYPES.SCHEDULE_MANUAL_OVERRIDE,
    TASK_ACTION_TYPES.SCHEDULE_PROPOSAL_CREATED,
    TASK_ACTION_TYPES.SNOOZED,
    TASK_ACTION_TYPES.URGENT_COMMITMENT_SET,
    TASK_ACTION_TYPES.PRIORITY_CHANGED,
    TASK_ACTION_TYPES.SUBTASK_COMPLETED
];

// All routes require authentication
router.use(authenticateToken);

function shapeDashboardRevenue(req, res, next) {
    return installRevenueResponseShaper(
        req,
        res,
        next,
        canUseAction(req.user, 'view_revenue'),
        { redactText: true }
    );
}

const REVENUE_ONLY_DASHBOARD_WIDGETS = new Set([
    'finance_today',
    'reports_today',
    'director_pnl'
]);

function requireDashboardWidgetRevenue(req, res, next) {
    if (!REVENUE_ONLY_DASHBOARD_WIDGETS.has(req.params.type)) return next();
    if (canUseAction(req.user, 'view_revenue')) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
}

function allowDashboardPublicCatalogResponse(req, res, next) {
    if (req.params.type === 'catalogs') res.locals.revenueResponseMode = 'public-catalog';
    return next();
}

function dashboardBusinessScope(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    return scope;
}

function appendDashboardBusinessScope(params, scope, alias = 't') {
    return `AND ${pushBusinessScopeCondition(params, scope, alias)}`;
}

function dashboardBusinessScopeMeta(scope = {}) {
    const selectedContexts = Array.isArray(scope.selectedContexts) && scope.selectedContexts.length
        ? scope.selectedContexts
        : [scope.activeContext || 'event_genix'];
    return {
        mode: scope.mode || 'single',
        activeContext: scope.activeContext || selectedContexts[0] || 'event_genix',
        selectedContexts,
        readOnly: scope.readOnly === true,
        canWrite: scope.canWrite !== false
    };
}

function buildOwnTaskFilter(user, params, alias = 't') {
    const userId = normalizeUserId(user);
    const typed = userId ? `${alias}.owner_user_id = $${params.push(userId)}` : 'FALSE';
    const tokenRefs = userNameTokens(user).map(token => `$${params.push(token)}`);
    const legacy = tokenRefs.length
        ? `(${alias}.owner_user_id IS NULL AND (${alias}.assigned_to IN (${tokenRefs.join(',')}) OR ${alias}.owner IN (${tokenRefs.join(',')})))`
        : 'FALSE';
    return `AND (${typed} OR ${legacy})`;
}

const TASK_WIDGET_SUBTASK_SELECT = `
                           COALESCE(subtask_rows.subtasks, '[]'::json) AS subtasks,
                           COALESCE(st.total, 0)::int AS subtask_count,
                           COALESCE(st.done, 0)::int AS subtask_done_count`;

const TASK_WIDGET_SUBTASK_JOINS = `
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
                    ) subtask_rows ON subtask_rows.task_id = t.id`;

function taskWidgetPayload(rows = []) {
    return rows.map(row => {
        const ownerLabel = row.owner_name || row.owner_username || row.assigned_to || row.owner || null;
        const ownerState = taskOwnerState(row);
        const subtaskSummary = normalizeSubtaskSummary(row);
        return {
            ...row,
            ownerLabel,
            ownerState,
            ownerUserId: row.owner_user_id || null,
            subtasks: subtaskSummary.subtasks,
            subtask_count: subtaskSummary.subtaskCount,
            subtask_done_count: subtaskSummary.subtaskDoneCount,
            subtaskCount: subtaskSummary.subtaskCount,
            subtaskDoneCount: subtaskSummary.subtaskDoneCount,
            subtaskProgress: subtaskSummary.subtaskProgress,
            subtaskProgressPercent: subtaskSummary.subtaskProgressPercent,
            intelligence: deriveTaskIntelligence({ ...row, owner_label: ownerLabel, ownerState })
        };
    });
}


function dashboardActiveBookingStatusSql(alias = 'b') {
    const column = alias ? `${alias}.status` : 'status';
    return `LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), 'confirmed')) != 'cancelled'`;
}

function normalizeDashboardTime(value) {
    const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)/);
    if (!match) return null;
    return `${match[1]}:${match[2]}`;
}

function dashboardBookingStatusLabel(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'confirmed') return 'Підтверджено';
    if (value === 'preliminary') return 'Попередньо';
    if (value === 'completed') return 'Завершено';
    return value ? status : 'Статус не вказаний';
}

function dashboardEventSummaryHref(id, businessScope) {
    const params = new URLSearchParams({
        id: String(id),
        businessContext: businessScope?.activeContext || 'event_genix',
        return: '/dashboard'
    });
    return `/booking-summary.html?${params.toString()}`;
}

function normalizeNearestEventPayload(row = null, preparationTasks = [], options = {}) {
    const today = options.today || getKyivDateStr();
    const date = options.date || today;
    const nowTime = options.nowTime || dashboardKyivClock().nowTime;
    if (!row) {
        return {
            event: null,
            preparation: null,
            date,
            nowTime,
            meta: {
                state: 'empty',
                timeZone: 'Europe/Kyiv',
                source: 'bookings',
                visibleScopeOnly: true,
                scopeSource: options.bookingScopeSource || null,
                dateScope: options.dateScope || 'none',
                searchedDates: Array.isArray(options.searchedDates) ? options.searchedDates : [today],
                lookaheadDays: Number.isFinite(Number(options.lookaheadDays)) ? Number(options.lookaheadDays) : 0
            }
        };
    }

    const tasks = taskWidgetPayload(preparationTasks).map(row => dashboardFocusTask(row, today));
    const openTasks = tasks.filter(task => !isTaskerClosed(task));
    const doneTasks = tasks.filter(task => TASKER_DONE_STATUSES.has(normalizeTaskStatus(task.status)));
    const overdueTasks = tasks.filter(task => task.isOverdue);
    const status = String(row.status || '').trim().toLowerCase();
    const confirmed = status === 'confirmed' || Boolean(row.confirmed_at);
    const responsibleLabel = row.responsible_name
        || row.responsible_profile_name
        || row.responsible_user_name
        || row.responsible_username
        || null;
    const time = normalizeDashboardTime(row.start_time || row.time);
    const eventDate = String(row.date || date).slice(0, 10);
    const dateScope = options.dateScope || (eventDate === today ? 'today' : 'date');

    return {
        event: {
            id: row.id,
            date: eventDate,
            dateScope,
            time,
            startTime: time,
            startsAt: row.starts_at || null,
            clientName: row.client_name || row.label || null,
            program: row.program || row.program_name || row.program_code || null,
            programName: row.program || row.program_name || null,
            programCode: row.program_code || null,
            room: row.room || null,
            responsibleLabel,
            status: row.status || null,
            canonicalHref: dashboardEventSummaryHref(row.id, options.businessScope)
        },
        confirmation: {
            status: row.status || null,
            label: dashboardBookingStatusLabel(row.status),
            confirmed,
            confirmedAt: row.confirmed_at || null,
            source: 'bookings.status'
        },
        preparation: {
            tasks,
            totalCount: Number(preparationTasks[0]?.preparation_total ?? tasks.length),
            openCount: Number(preparationTasks[0]?.preparation_open ?? openTasks.length),
            doneCount: Number(preparationTasks[0]?.preparation_done ?? doneTasks.length),
            overdueCount: Number(preparationTasks[0]?.preparation_overdue ?? overdueTasks.length),
            source: 'tasks.source_type=booking AND tasks.source_id=bookings.id',
            noTasksMeans: 'unknown'
        },
        date: eventDate,
        nowTime,
        meta: {
            state: 'ready',
            timeZone: 'Europe/Kyiv',
            source: 'bookings',
            visibleScopeOnly: true,
            scopeSource: options.bookingScopeSource || null,
            preparationVisibilitySource: options.preparationScopeSource || null,
            dateScope,
            searchedDates: Array.isArray(options.searchedDates) ? options.searchedDates : [today],
            lookaheadDays: Number.isFinite(Number(options.lookaheadDays)) ? Number(options.lookaheadDays) : 0
        }
    };
}

function dashboardKyivClock(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).map(part => [part.type, part.value]));
    return { today: `${parts.year}-${parts.month}-${parts.day}`, nowTime: `${parts.hour}:${parts.minute}:${parts.second}` };
}

function dashboardKyivDateOffset(days = 0, now = new Date()) {
    return addDays(dashboardKyivClock(now instanceof Date ? now : new Date(now)).today, Number(days) || 0);
}

function dashboardWeekStart(today) {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    return addDays(today, -((weekday + 6) % 7));
}

function dashboardSourceMeta(businessScope) {
    return { sourceStates: {}, warnings: [], partial: false, businessScope: dashboardBusinessScopeMeta(businessScope) };
}

async function dashboardSource(meta, source, sql, params = []) {
    try {
        const result = await pool.query(sql, params);
        meta.sourceStates[source] = 'ready';
        return result;
    } catch (err) {
        log.warn(`Dashboard source unavailable: ${source}`, { code: err.code || 'source_error' });
        meta.sourceStates[source] = 'error';
        meta.warnings.push({ source, code: 'source_unavailable', message: 'Не вдалося отримати дані джерела' });
        meta.partial = true;
        return { rows: [], unavailable: true };
    }
}

function dashboardNumber(result, field) {
    if (result?.unavailable) return null;
    const value = result?.rows?.[0]?.[field];
    return value == null ? 0 : Number(value);
}

function dashboardUnavailableSource(meta, source, access) {
    meta.sourceStates[source] = 'unavailable';
    meta.warnings.push({ source, code: access.code, message: access.message });
    meta.partial = true;
    return { rows: [], unavailable: true };
}

async function dashboardRoomConflicts(user, businessScope, today, meta) {
    const params = [today];
    const firstVisibility = getVisibleBookingScope(user, params, 'b1');
    const secondVisibility = getVisibleBookingScope(user, params, 'b2');
    const firstScope = businessScope ? appendDashboardBusinessScope(params, businessScope, 'b1') : '';
    const secondScope = businessScope ? appendDashboardBusinessScope(params, businessScope, 'b2') : '';
    return dashboardSource(meta, 'roomConflicts', `
        SELECT b1.id AS booking1, b2.id AS booking2, b1.room, b1.time AS time1, b2.time AS time2,
               COUNT(*) OVER()::int AS total_count
        FROM bookings b1
        JOIN bookings b2 ON b1.room = b2.room AND b1.date = b2.date AND b1.id < b2.id
        WHERE b1.date = $1 AND b1.status != 'cancelled' AND b2.status != 'cancelled'
          AND NULLIF(BTRIM(b1.room), '') IS NOT NULL
          AND NULLIF(BTRIM(COALESCE(b1.linked_to, '')), '') IS NULL
          AND NULLIF(BTRIM(COALESCE(b2.linked_to, '')), '') IS NULL
          ${firstVisibility.sql} ${secondVisibility.sql} ${firstScope} ${secondScope}
          AND (${safeBookingStartMinutesSql('b1')}) < (${safeBookingStartMinutesSql('b2')}) + GREATEST(COALESCE(b2.duration, 120), 1)
          AND (${safeBookingStartMinutesSql('b2')}) < (${safeBookingStartMinutesSql('b1')}) + GREATEST(COALESCE(b1.duration, 120), 1)
        ORDER BY b1.time, b1.id, b2.id LIMIT 5
    `, params);
}

function dashboardTaskEffectiveDueSql(alias = 't') {
    return `COALESCE(${alias}.scheduled_end_at, ${alias}.scheduled_start_at, ${alias}.snoozed_until,
            CASE WHEN LEFT(COALESCE(${alias}.date, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
                THEN (LEFT(${alias}.date, 10)::date + TIME '23:59:59') AT TIME ZONE 'Europe/Kyiv' END,
            ${alias}.deadline, ${alias}.remind_at)`;
}

function dashboardTaskTimingSelect(alias = 't') {
    return `${alias}.date, ${alias}.scheduled_start_at, ${alias}.scheduled_end_at, ${alias}.snoozed_until,
        ${taskKpiWorkloadDateSql(alias)}::text AS effective_date,
        ${dashboardTaskEffectiveDueSql(alias)} AS effective_due_at,
        ${taskKpiCanonicalOverdueSql(alias)} AS is_overdue`;
}

function dashboardActionableTaskSql(alias = 't') {
    return `${taskKpiActiveWorkSql(alias)} AND NOT (${alias}.snoozed_until IS NOT NULL AND ${alias}.snoozed_until > NOW())`;
}

function dashboardFocusAvailableSql(alias = 't') {
    return `${dashboardActionableTaskSql(alias)} AND (COALESCE(${alias}.focus_rank, 0) > 0
        OR ${alias}.scheduled_start_at IS NULL OR ${alias}.scheduled_start_at <= NOW())`;
}

function dashboardFocusTask(row, today) {
    const effectiveDate = row.effective_date || null;
    const isOverdue = row.is_overdue === true;
    // A moved working date takes precedence over the original deadline.
    const effectiveDueAt = row.effective_due_at || row.scheduled_end_at || row.scheduled_start_at || row.snoozed_until
        || (!row.date ? row.deadline : null) || null;
    return { ...row, isSelectedFocus: Number(row.focus_rank || 0) > 0, effectiveDate, effectiveDueAt,
        isOverdue, dueState: isOverdue ? 'overdue' : !effectiveDate ? 'unscheduled' : effectiveDate === today ? 'today' : effectiveDate > today ? 'upcoming' : 'review' };
}

async function loadNearestEventWidgetData(user, businessScope, options = {}) {
    const now = options.now || new Date();
    const { today, nowTime } = dashboardKyivClock(now);
    const tomorrow = dashboardKyivDateOffset(1, now);
    const searchedDates = [today, tomorrow].filter((date, index, list) => date && list.indexOf(date) === index);

    async function findNearestBookingForDate(date, minTime = null) {
        const eventParams = [date];
        const timeFilter = minTime ? `AND LEFT(BTRIM(b.time::text), 5)::time >= $${eventParams.length + 1}::time` : '';
        if (minTime) eventParams.push(minTime);
        const bookingVisibility = getVisibleBookingScope(user, eventParams, 'b');
        const bookingBusinessCondition = appendDashboardBusinessScope(eventParams, businessScope, 'b');
        const eventResult = await pool.query(`
            SELECT b.id, b.date, b.label AS client_name, b.program_name AS program,
                   b.program_name, b.program_code, b.time AS start_time, b.room, b.status,
                   (b.date::date + LEFT(BTRIM(b.time::text), 5)::time) AT TIME ZONE 'Europe/Kyiv' AS starts_at,
                   b.line_id, b.confirmed_at, b.confirmed_by, b.confirmation_source,
                   s.name AS responsible_name,
                   ep.full_name AS responsible_profile_name,
                   u.name AS responsible_user_name,
                   u.username AS responsible_username
            FROM bookings b
            LEFT JOIN staff s ON s.id::text = NULLIF(BTRIM(b.line_id::text), '')
            LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
            LEFT JOIN users u ON u.id = ep.user_id
            WHERE b.date = $1
              AND ${dashboardActiveBookingStatusSql('b')}
              AND NULLIF(BTRIM(b.time::text), '') IS NOT NULL
              AND LEFT(BTRIM(b.time::text), 5) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              ${timeFilter}
              ${bookingVisibility.sql}
              ${bookingBusinessCondition}
            ORDER BY LEFT(BTRIM(b.time::text), 5)::time ASC, b.id ASC
            LIMIT 1
        `, eventParams);
        return {
            event: eventResult.rows[0] || null,
            bookingScopeSource: bookingVisibility.scopeSource
        };
    }

    const todaySearch = await findNearestBookingForDate(today, nowTime);
    const tomorrowSearch = todaySearch.event ? null : await findNearestBookingForDate(tomorrow);
    const event = todaySearch.event || tomorrowSearch?.event || null;
    const selectedDate = event ? String(event.date || today).slice(0, 10) : today;
    const dateScope = event && selectedDate === tomorrow ? 'tomorrow' : (event ? 'today' : 'none');
    const bookingScopeSource = (event && selectedDate === tomorrow)
        ? tomorrowSearch?.bookingScopeSource
        : todaySearch.bookingScopeSource;

    if (!event) {
        return normalizeNearestEventPayload(null, [], {
            today,
            nowTime,
            date: today,
            dateScope,
            tomorrow,
            searchedDates,
            lookaheadDays: 1,
            bookingScopeSource
        });
    }

    const taskParams = [String(event.id)];
    const taskVisibility = buildTaskVisibilityScope(user, taskParams, 't');
    const taskBusinessCondition = appendDashboardBusinessScope(taskParams, businessScope, 't');
    const preparationMeta = dashboardSourceMeta(businessScope);
    preparationMeta.sourceStates.bookings = 'ready';
    const taskResult = await dashboardSource(preparationMeta, 'preparation', `
        SELECT t.id, t.title, t.status, t.priority, t.deadline, t.category,
               t.owner_user_id, t.assigned_to, t.owner, t.updated_at, t.created_at,
               t.task_mode, t.task_kind, t.visibility, t.workflow_state, t.focus_rank,
               ${dashboardTaskTimingSelect('t')},
               u.name AS owner_name, u.username AS owner_username,
               ${TASK_WIDGET_SUBTASK_SELECT},
               COUNT(*) OVER ()::int AS preparation_total,
               COUNT(*) FILTER (WHERE LOWER(COALESCE(t.status, 'todo')) NOT IN ('done','completed','complete')) OVER ()::int AS preparation_open,
               COUNT(*) FILTER (WHERE LOWER(COALESCE(t.status, 'todo')) IN ('done','completed','complete')) OVER ()::int AS preparation_done,
               COUNT(*) FILTER (WHERE ${taskKpiCanonicalOverdueSql('t')}) OVER ()::int AS preparation_overdue
        FROM tasks t
        LEFT JOIN users u ON u.id = t.owner_user_id
        ${TASK_WIDGET_SUBTASK_JOINS}
        WHERE t.source_type = 'booking'
          AND t.source_id = $1
          AND LOWER(COALESCE(t.status, 'todo')) NOT IN ('cancelled','canceled','archived') AND t.archived_at IS NULL
          ${taskVisibility}
          ${taskBusinessCondition}
        ORDER BY
          CASE WHEN COALESCE(t.status, 'todo') IN ('done','completed','complete') THEN 1 ELSE 0 END,
          ${taskKpiWorkloadDateSql('t')} ASC NULLS LAST,
          CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          t.updated_at DESC
        LIMIT 6
    `, taskParams);

    const payload = normalizeNearestEventPayload(event, taskResult.rows, {
        today,
        nowTime,
        date: selectedDate,
        dateScope,
        tomorrow,
        searchedDates,
        lookaheadDays: 1,
        businessScope,
        bookingScopeSource,
        preparationScopeSource: taskVisibility ? 'taskPolicy' : null
    });
    payload.meta = { ...payload.meta, ...preparationMeta };
    if (taskResult.unavailable) payload.preparation = null;
    return payload;
}

async function buildUrgentTaskAlerts(user, businessScope, limit = 5) {
    const params = [];
    const visibility = buildTaskVisibilityScope(user, params, 't');
    const businessCondition = appendDashboardBusinessScope(params, businessScope, 't');
    const movementParam = params.push(URGENT_TASK_MOVEMENT_ACTION_TYPES);
    const limitParam = params.push(Math.max(1, Math.min(parseInt(limit, 10) || 5, 20)));
    const result = await pool.query(
        `SELECT t.id, t.title, t.deadline, t.priority, t.status, t.owner_user_id,
                t.assigned_to, t.owner, t.updated_at, t.created_at, t.snoozed_until,
                t.next_notification_at, t.escalate_after,
                u.name AS owner_name, u.username AS owner_username
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE t.priority = 'urgent'
           AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
           AND (t.snoozed_until IS NULL OR t.snoozed_until <= NOW())
           AND COALESCE(
                t.next_notification_at,
                t.escalate_after,
                t.updated_at + INTERVAL '90 minutes',
                t.created_at + INTERVAL '90 minutes'
           ) <= NOW()
           AND NOT EXISTS (
                SELECT 1
                FROM task_action_history tah
                WHERE tah.task_id = t.id
                  AND tah.action_type = ANY($${movementParam}::text[])
                  AND tah.created_at >= COALESCE(
                        t.next_notification_at,
                        t.escalate_after,
                        t.updated_at + INTERVAL '90 minutes',
                        t.created_at + INTERVAL '90 minutes'
                  )
           )
           ${visibility}
           ${businessCondition}
         ORDER BY COALESCE(t.next_notification_at, t.escalate_after, t.updated_at, t.created_at) ASC, t.id ASC
         LIMIT $${limitParam}`,
        params
    );
    return result.rows.map(row => {
        const task = taskWidgetPayload([row])[0] || row;
        return {
            id: `urgent_task_${row.id}`,
            type: 'urgent_task',
            level: 'critical',
            icon: '🔥',
            title: `Термінова без руху: "${(row.title || '').slice(0, 48)}"`,
            message: 'Потрібен час виконання або перенесення, щоб задача не висіла без руху.',
            link: `/tasks?open=${row.id}`,
            taskId: row.id,
            owner: task.ownerLabel || null,
            ownerState: task.ownerState || 'unassigned',
            intelligence: task.intelligence || null,
            action: {
                label: 'Вказати час',
                commitment: true,
                commitmentQuestion: `Коли візьмете термінову задачу "${row.title || row.id}" в роботу?`
            }
        };
    });
}

const TASKER_DONE_STATUSES = new Set(['done', 'completed', 'complete']);
const TASKER_CLOSED_STATUSES = new Set(['done', 'completed', 'complete', 'cancelled', 'archived']);

function normalizeTaskStatus(value) {
    return String(value || 'todo').trim().toLowerCase();
}

function isTaskerClosed(row = {}) {
    return TASKER_CLOSED_STATUSES.has(normalizeTaskStatus(row.status));
}

function isTaskerOverdue(row = {}) {
    if (typeof row.is_overdue === 'boolean') return row.is_overdue;
    if (typeof row.isOverdue === 'boolean') return row.isOverdue;
    if (!row.deadline || isTaskerClosed(row)) return false;
    const deadline = new Date(row.deadline);
    return !Number.isNaN(deadline.getTime()) && deadline.getTime() < Date.now();
}

function dateOnlyKyiv(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function isTaskerDoneToday(row = {}) {
    if (!TASKER_DONE_STATUSES.has(normalizeTaskStatus(row.status))) return false;
    const completedAt = row.completed_at || row.updated_at;
    if (!completedAt) return false;
    return dateOnlyKyiv(completedAt) === getKyivDateStr();
}

function taskerSubtaskStats(row = {}) {
    const summary = normalizeSubtaskSummary(row);
    const doneToday = summary.subtasks.filter(item => {
        if (!(item.isDone || item.is_done)) return false;
        return dateOnlyKyiv(item.completedAt || item.completed_at) === getKyivDateStr();
    }).length;
    return {
        total: summary.subtaskCount || 0,
        done: summary.subtaskDoneCount || 0,
        doneToday
    };
}

function matchesTaskerUserIdentity(row = {}, user, fields = []) {
    const userId = normalizeUserId(user);
    if (userId && fields.some(field => Number(row[field] || 0) === userId)) return true;
    const tokens = new Set(userNameTokens(user).map(token => String(token || '').trim().toLowerCase()).filter(Boolean));
    if (!tokens.size) return false;
    return fields.some(field => {
        const value = String(row[field] || '').trim().toLowerCase();
        return value && tokens.has(value);
    });
}

function taskerStats(tasks = []) {
    const subtaskStats = tasks.reduce((acc, task) => {
        const stats = taskerSubtaskStats(task);
        acc.total += stats.total;
        acc.done += stats.done;
        acc.doneToday += stats.doneToday;
        return acc;
    }, { total: 0, done: 0, doneToday: 0 });
    const total = tasks.length + subtaskStats.total;
    const done = tasks.filter(task => TASKER_DONE_STATUSES.has(normalizeTaskStatus(task.status))).length + subtaskStats.done;
    const active = tasks.filter(task => !isTaskerClosed(task)).length;
    const todo = tasks.filter(task => normalizeTaskStatus(task.status) === 'todo').length;
    const inProgress = tasks.filter(task => normalizeTaskStatus(task.status) === 'in_progress').length;
    const doneToday = tasks.filter(isTaskerDoneToday).length + subtaskStats.doneToday;
    const overdue = tasks.filter(isTaskerOverdue).length;
    return {
        total,
        active,
        todo,
        inProgress,
        done,
        doneToday,
        overdue,
        completionRate: total ? Math.round((done / total) * 100) : 0
    };
}

function normalizeTaskerStatsRow(row = {}) {
    const total = Number(row.total || 0);
    const done = Number(row.done || 0);
    return {
        total,
        active: Number(row.active || 0),
        todo: Number(row.todo || 0),
        inProgress: Number(row.in_progress || row.inProgress || 0),
        done,
        doneToday: Number(row.done_today || row.doneToday || 0),
        parentDone: Number(row.parent_done || row.parentDone || 0),
        subtaskDone: Number(row.subtask_done || row.subtaskDone || 0),
        parentDoneToday: Number(row.parent_done_today || row.parentDoneToday || 0),
        subtaskDoneToday: Number(row.subtask_done_today || row.subtaskDoneToday || 0),
        completedMetricContract: row.completed_metric_contract || 'completed_units = completed_parent_tasks + completed_subtasks',
        overdue: Number(row.overdue || 0),
        completionRate: total ? Math.round((done / total) * 100) : 0
    };
}

function buildPersonalTaskerPayload(rows = [], user, statsOverride = null) {
    const payloadTasks = taskWidgetPayload(rows).map((task, index) => ({
        ...dashboardFocusTask(task, getKyivDateStr()),
        creatorLabel: rows[index]?.creator_name || rows[index]?.creator_username || rows[index]?.created_by || null,
        createdByUserId: rows[index]?.created_by_user_id || null,
        isOverdue: isTaskerOverdue(rows[index] || task),
        completedAt: rows[index]?.completed_at || null
    }));
    const byId = new Map(payloadTasks.map(task => [String(task.id), task]));
    const assignedRows = rows.filter(row => matchesTaskerUserIdentity(row, user, ['owner_user_id', 'assigned_to', 'owner']));
    const createdRows = rows.filter(row => matchesTaskerUserIdentity(row, user, ['created_by_user_id', 'created_by', 'creator_username', 'creator_name']));
    const assigned = assignedRows.map(row => byId.get(String(row.id))).filter(Boolean);
    const created = createdRows.map(row => byId.get(String(row.id))).filter(Boolean);
    const allStats = statsOverride || taskerStats(rows);
    return {
        scope: 'creator',
        currentUser: {
            id: normalizeUserId(user),
            username: user?.username || null,
            name: user?.name || user?.username || null
        },
        views: {
            assigned_to_me: { label: 'Мені', tasks: assigned, stats: taskerStats(assignedRows) },
            created_by_me: { label: 'Поставив', tasks: created, stats: taskerStats(createdRows) },
            all_tasks: { label: 'Всі', tasks: payloadTasks, stats: allStats }
        },
        stats: allStats,
        achievements: [
            { key: 'done_today', label: 'Готово сьогодні', value: allStats.doneToday, tone: allStats.doneToday > 0 ? 'success' : 'quiet' },
            { key: 'overdue_guard', label: allStats.overdue === 0 ? 'Без прострочки' : 'Прострочено', value: allStats.overdue, tone: allStats.overdue === 0 ? 'success' : 'warning' },
            { key: 'completion_rate', label: 'Закриття', value: `${allStats.completionRate}%`, tone: allStats.completionRate >= 70 ? 'success' : 'info' }
        ],
        meta: {
            creatorOnly: true,
            views: ['assigned_to_me', 'created_by_me', 'all_tasks'],
            dataSource: 'tasks + task visibility policy'
        }
    };
}

function addDays(dateStr, days) {
    const [year, month, day] = String(dateStr).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
}

function countFrom(result) {
    return parseInt(result?.rows?.[0]?.count || 0, 10) || 0;
}

function normalizeDashboardConfigRevision(value) {
    if (value == null) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    const text = String(value || '').trim();
    return text || null;
}

function requestedDashboardConfigBaseRevision(body = {}) {
    return normalizeDashboardConfigRevision(
        body.baseRevision
        ?? body.base_revision
        ?? body.configRevision
        ?? body.config_revision
        ?? body.serverRevision
        ?? body.server_revision
        ?? body.revision
        ?? body.updatedAt
        ?? body.updated_at
    );
}

function dashboardConfigConflictPayload(currentRaw, role, reason = 'stale_revision') {
    const currentRevision = normalizeDashboardConfigRevision(currentRaw?.server_revision || currentRaw?.serverRevision || currentRaw?.updated_at);
    return {
        success: false,
        conflict: true,
        conflictType: 'dashboard_config_revision',
        reason,
        currentRevision,
        currentConfig: currentRaw ? normalizeDashboardConfig(currentRaw, role) : null,
        error: 'Dashboard config was changed in another tab. Reload or restore your local draft before saving.'
    };
}

const BOARD_SCHEMA_VERSION = 1;
const BOARD_MAX_ITEMS = 120;
const BOARD_MAX_DRAWINGS = 500;
const BOARD_ALLOWED_TYPES = new Set(['widget', 'note', 'text', 'shape', 'frame', 'space']);
const BOARD_ALLOWED_WIDGET_DEPTHS = new Set(['live-compact', 'headline-only', 'snapshot-static']);
const BOARD_WIDGET_DEPTH_ALIASES = {
    'live-expanded': 'live-compact',
    'snapshot-card': 'snapshot-static'
};
const BOARD_ALLOWED_TOOLS = new Set(['select', 'hand', 'brush', 'highlighter', 'eraser', 'connector', 'note', 'text', 'frame', 'space', 'widget', 'line', 'arrow', 'rect', 'square', 'circle', 'round-rect', 'ellipse', 'diamond']);
const BOARD_DRAW_TOOLS = new Set(['brush', 'highlighter']);
const BOARD_ALLOWED_SHAPES = new Set(['line', 'arrow', 'rect', 'square', 'circle', 'round-rect', 'ellipse', 'diamond']);
const BOARD_ALLOWED_CONNECTOR_STYLES = new Set(['line', 'arrow', 'curve']);
const BOARD_ALLOWED_RELATION_TYPES = new Set(['idea', 'depends', 'blocks', 'feeds', 'inspires']);
const BOARD_CONTENT_TONES = new Set(['idea', 'production', 'approved', 'blocked', 'story']);
const DASHBOARD_WORKSPACE_MODE = 'workspace';
const BOARD_SNAP_MODES = new Set(['strict', 'soft', 'freeform']);
const DASHBOARD_CONFIG_PERSISTENCE = Object.freeze({
    source: 'postgres',
    table: 'dashboard_configs',
    endpoint: '/api/dashboard/config',
    boardStatePath: 'layout.boardState'
});
const DASHBOARD_CONFIG_REVISION_SQL = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const DASHBOARD_CONFIG_SELECT_SQL = `SELECT layout, widgets, theme, updated_at, ${DASHBOARD_CONFIG_REVISION_SQL} AS server_revision FROM ${DASHBOARD_CONFIG_PERSISTENCE.table} WHERE user_id = $1`;
const DASHBOARD_CONFIG_INSERT_SQL = `
            INSERT INTO ${DASHBOARD_CONFIG_PERSISTENCE.table} (user_id, layout, widgets, theme, updated_at)
            VALUES ($1, $2, $3, $4, clock_timestamp())
            ON CONFLICT (user_id) DO NOTHING
            RETURNING layout, widgets, theme, updated_at, ${DASHBOARD_CONFIG_REVISION_SQL} AS server_revision
        `;
const DASHBOARD_CONFIG_UPSERT_SQL = `
            UPDATE ${DASHBOARD_CONFIG_PERSISTENCE.table}
            SET layout = $2, widgets = $3, theme = $4, updated_at = clock_timestamp()
            WHERE user_id = $1 AND ${DASHBOARD_CONFIG_REVISION_SQL} = $5
            RETURNING layout, widgets, theme, updated_at, ${DASHBOARD_CONFIG_REVISION_SQL} AS server_revision
        `;

function parseJsonObject(value, fallback = {}) {
    if (!value) return { ...fallback };
    if (typeof value === 'object' && !Array.isArray(value)) return { ...fallback, ...value };
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return { ...fallback, ...parsed };
            }
        } catch {}
    }
    return { ...fallback };
}

function safeNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function normalizeBoardTool(value) {
    return BOARD_ALLOWED_TOOLS.has(value) ? value : 'select';
}

function normalizeBoardWidgetDepth(value) {
    const depth = String(value || '').trim();
    if (BOARD_ALLOWED_WIDGET_DEPTHS.has(depth)) return depth;
    return BOARD_WIDGET_DEPTH_ALIASES[depth] || 'live-compact';
}

function normalizeBoardShape(value) {
    return BOARD_ALLOWED_SHAPES.has(value) ? value : 'rect';
}

function normalizeBoardTone(value) {
    const tone = String(value || '').trim();
    return BOARD_CONTENT_TONES.has(tone) ? tone : '';
}

function isBoardEquilateralShape(shape) {
    return shape === 'circle' || shape === 'square';
}

function normalizeBoardShapeDimensions(shape, width, height) {
    if (!isBoardEquilateralShape(shape)) return { w: width, h: height };
    const size = safeNumber(Math.max(Number(width || 0), Number(height || 0)), 150, 80, 900);
    return { w: size, h: size };
}

function normalizeBoardConnectorStyle(value) {
    return BOARD_ALLOWED_CONNECTOR_STYLES.has(value) ? value : 'arrow';
}

function normalizeBoardRelationType(value) {
    return BOARD_ALLOWED_RELATION_TYPES.has(value) ? value : 'idea';
}

function normalizeBoardSnapMode(value) {
    return BOARD_SNAP_MODES.has(value) ? value : 'freeform';
}

function sanitizeBoardStroke(stroke, index = 0) {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points) || stroke.points.length < 2) return null;
    const tool = normalizeBoardTool(stroke.tool);
    if (!BOARD_DRAW_TOOLS.has(tool)) return null;
    const points = stroke.points
        .slice(0, 2000)
        .map(point => {
            if (!Array.isArray(point) || point.length < 2) return null;
            return [
                safeNumber(point[0], 0, -10000, 10000),
                safeNumber(point[1], 0, -10000, 10000)
            ];
        })
        .filter(Boolean);
    if (points.length < 2) return null;
    return {
        id: String(stroke.id || `stroke-${Date.now()}-${index}`).slice(0, 90),
        tool,
        color: String(stroke.color || (tool === 'highlighter' ? '#f59e0b' : '#10b981')).slice(0, 32),
        width: safeNumber(stroke.width, tool === 'highlighter' ? 12 : 2, 1, 24),
        opacity: safeNumber(stroke.opacity, tool === 'highlighter' ? 0.34 : 0.9, 0.05, 1),
        points
    };
}

function sanitizeBoardConnector(connector, index = 0) {
    if (!connector || typeof connector !== 'object') return null;
    const from = parseJsonObject(connector.from, {});
    const to = parseJsonObject(connector.to, {});
    const fromItemId = String(from.itemId || '').slice(0, 90);
    const toItemId = String(to.itemId || '').slice(0, 90);
    if (!fromItemId || !toItemId || fromItemId === toItemId) return null;
    return {
        id: String(connector.id || `conn-${Date.now()}-${index}`).slice(0, 90),
        from: {
            itemId: fromItemId,
            anchor: ['top', 'right', 'bottom', 'left'].includes(from.anchor) ? from.anchor : 'right'
        },
        to: {
            itemId: toItemId,
            anchor: ['top', 'right', 'bottom', 'left'].includes(to.anchor) ? to.anchor : 'left'
        },
        style: normalizeBoardConnectorStyle(connector.style),
        relationType: normalizeBoardRelationType(connector.relationType),
        color: String(connector.color || '#94a3b8').slice(0, 32),
        width: safeNumber(connector.width, 2, 1, 8),
        label: String(connector.label || '').slice(0, 80)
    };
}

function defaultBoardMeta(overrides = {}) {
    return {
        version: BOARD_SCHEMA_VERSION,
        enabled: true,
        lastSavedAt: null,
        dirty: false,
        privacy: 'private',
        collaboration: 'personal',
        ...overrides,
        version: BOARD_SCHEMA_VERSION,
        dirty: false,
        privacy: 'private',
        collaboration: 'personal'
    };
}

function defaultBoardState(overrides = {}) {
    return {
        schemaVersion: BOARD_SCHEMA_VERSION,
        viewport: { x: 0, y: 0, zoom: 1 },
        items: [],
        drawings: [],
        connectors: [],
        activeTool: 'select',
        preferences: {
            snapToGrid: false,
            snapMode: 'freeform',
            showGrid: true,
            showGuides: true,
            showPlanner: true,
            showMiniMap: false,
            maxLiveWidgets: 18,
            strokeColor: '#10b981',
            fillColor: 'rgba(16, 185, 129, 0.10)',
            strokeWidth: 2,
            connectorStyle: 'arrow',
            relationType: 'idea'
        },
        ...overrides
    };
}

function sanitizeBoardItem(item, role) {
    if (!item || typeof item !== 'object') return null;
    const rawType = String(item.type || item.kind || '').trim();
    const inferredType = rawType || (item.noteText || item.content || item.body || item.label ? 'note' : '');
    const type = BOARD_ALLOWED_TYPES.has(inferredType) ? inferredType : null;
    if (!type) return null;
    const id = String(item.id || '').trim().slice(0, 80);
    if (!id) return null;
    const safe = {
        id,
        type,
        x: safeNumber(item.x, 40, -10000, 10000),
        y: safeNumber(item.y, 40, -10000, 10000),
        w: safeNumber(item.w, type === 'widget' ? 320 : 220, 80, 1200),
        h: safeNumber(item.h, type === 'widget' ? 220 : 120, 60, 900),
        z: safeNumber(item.z, 1, 0, 9999),
        locked: item.locked === true,
        hidden: item.hidden === true
    };

    if (type === 'widget') {
        const widgetType = String(item.widgetType || item.widget || '').trim();
        if (!widgetType || canAccessDashboardWidget(role, widgetType, ROLE_LEVEL) === false) return null;
        safe.widgetType = widgetType;
        safe.depth = normalizeBoardWidgetDepth(item.depth);
        safe.title = String(item.title || '').slice(0, 120);
    } else {
        const legacyText = item.text ?? item.content ?? item.body ?? item.noteText ?? item.label ?? '';
        safe.text = String(legacyText || '').slice(0, 5000);
        safe.title = String(item.title || item.label || '').slice(0, 120);
        safe.color = String(item.color || '').slice(0, 40);
        safe.tone = normalizeBoardTone(item.tone);
        safe.shape = normalizeBoardShape(item.shape || 'rect');
        if (type === 'shape') {
            const dimensions = normalizeBoardShapeDimensions(safe.shape, safe.w, safe.h);
            safe.w = dimensions.w;
            safe.h = dimensions.h;
        }
        if (type === 'space') {
            safe.zoneId = String(item.zoneId || '').slice(0, 80);
            safe.zoneKind = String(item.zoneKind || 'reserved').slice(0, 40);
        }
    }

    return safe;
}

function sanitizeBoardState(input, role) {
    const source = parseJsonObject(input, {});
    const viewportSource = parseJsonObject(source.viewport, {});
    const preferencesSource = parseJsonObject(source.preferences, {});
    const items = Array.isArray(source.items)
        ? source.items.slice(0, BOARD_MAX_ITEMS).map(item => sanitizeBoardItem(item, role)).filter(Boolean)
        : [];
    const drawings = Array.isArray(source.drawings)
        ? source.drawings.slice(0, BOARD_MAX_DRAWINGS).map(sanitizeBoardStroke).filter(Boolean)
        : [];
    const itemIds = new Set(items.map(item => item.id));
    const connectors = Array.isArray(source.connectors)
        ? source.connectors.slice(0, 300).map(sanitizeBoardConnector).filter(Boolean)
            .filter(connector => itemIds.has(connector.from.itemId) && itemIds.has(connector.to.itemId))
        : [];

    return defaultBoardState({
        schemaVersion: BOARD_SCHEMA_VERSION,
        viewport: {
            x: safeNumber(viewportSource.x, 0, -10000, 10000),
            y: safeNumber(viewportSource.y, 0, -10000, 10000),
            zoom: safeNumber(viewportSource.zoom, 1, 0.25, 2)
        },
        items,
        drawings,
        connectors,
        activeTool: normalizeBoardTool(source.activeTool),
        preferences: {
            snapToGrid: normalizeBoardSnapMode(preferencesSource.snapToGrid === false ? 'freeform' : preferencesSource.snapMode || (preferencesSource.snapToGrid === true ? 'soft' : 'freeform')) !== 'freeform' && preferencesSource.snapToGrid !== false,
            snapMode: normalizeBoardSnapMode(preferencesSource.snapToGrid === false ? 'freeform' : preferencesSource.snapMode || (preferencesSource.snapToGrid === true ? 'soft' : 'freeform')),
            showGrid: preferencesSource.showGrid !== false,
            showGuides: preferencesSource.showGuides !== false,
            showPlanner: preferencesSource.showPlanner !== false,
            showMiniMap: preferencesSource.showMiniMap === true,
            maxLiveWidgets: safeNumber(preferencesSource.maxLiveWidgets, 18, 1, 24),
            strokeColor: String(preferencesSource.strokeColor || '#10b981').slice(0, 32),
            fillColor: String(preferencesSource.fillColor || 'rgba(16, 185, 129, 0.10)').slice(0, 64),
            strokeWidth: safeNumber(preferencesSource.strokeWidth, 2, 1, 12),
            connectorStyle: normalizeBoardConnectorStyle(preferencesSource.connectorStyle),
            relationType: normalizeBoardRelationType(preferencesSource.relationType)
        }
    });
}

function normalizeDashboardMode() {
    return DASHBOARD_WORKSPACE_MODE;
}

function normalizeDashboardLayoutPreferences(input) {
    const layout = { ...parseJsonObject(input, {}) };
    const validWidgetKey = key => typeof key === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(key);
    if (Object.prototype.hasOwnProperty.call(layout, 'widgetSizes')) {
        const sizes = parseJsonObject(layout.widgetSizes, {});
        const aliases = { standard: 'standard', compact: 'standard', side: 'standard', wide: 'wide', full: 'full' };
        layout.widgetSizes = Object.fromEntries(Object.entries(sizes)
            .filter(([key, size]) => validWidgetKey(key) && typeof size === 'string' && Object.prototype.hasOwnProperty.call(aliases, size))
            .map(([key, size]) => [key, aliases[size]]));
    }
    if (Object.prototype.hasOwnProperty.call(layout, 'mobileOrder')) {
        layout.mobileOrder = [...new Set((Array.isArray(layout.mobileOrder) ? layout.mobileOrder : []).filter(validWidgetKey))];
    }
    return layout;
}

function normalizeDashboardConfig(raw, role) {
    const layout = normalizeDashboardLayoutPreferences(raw?.layout);
    const mode = normalizeDashboardMode(raw?.mode || layout.mode);
    const boardMeta = defaultBoardMeta(parseJsonObject(raw?.boardMeta || layout.boardMeta, {}));
    const boardState = sanitizeBoardState(raw?.boardState || layout.boardState, role);
    const serverRevision = normalizeDashboardConfigRevision(raw?.server_revision || raw?.serverRevision || raw?.updated_at || raw?.updatedAt);
    return {
        layout: {
            ...layout,
            mode,
            boardMeta,
            boardState
        },
        widgets: Array.isArray(raw?.widgets)
            ? raw.widgets.filter(type => canAccessDashboardWidget(role, type, ROLE_LEVEL) !== false)
            : [],
        theme: raw?.theme || 'default',
        mode,
        boardMeta,
        boardState,
        serverRevision
    };
}

function buildPersistedDashboardConfig(existingRaw, body, role) {
    const existing = normalizeDashboardConfig(existingRaw || {}, role);
    const incomingLayout = body && Object.prototype.hasOwnProperty.call(body, 'layout')
        ? parseJsonObject(body.layout, {})
        : {};
    const mode = normalizeDashboardMode(body?.mode || incomingLayout.mode || existing.mode);
    const boardMeta = defaultBoardMeta({
        ...existing.boardMeta,
        ...parseJsonObject(incomingLayout.boardMeta, {}),
        ...parseJsonObject(body?.boardMeta, {}),
        lastSavedAt: body?.boardMeta?.lastSavedAt || incomingLayout.boardMeta?.lastSavedAt || new Date().toISOString()
    });
    const boardState = body && (Object.prototype.hasOwnProperty.call(body, 'boardState') || incomingLayout.boardState)
        ? sanitizeBoardState(body.boardState || incomingLayout.boardState, role)
        : existing.boardState;
    const widgets = Array.isArray(body?.widgets)
        ? body.widgets.filter(type => canAccessDashboardWidget(role, type, ROLE_LEVEL) !== false)
        : existing.widgets;
    const layout = normalizeDashboardLayoutPreferences({
        ...existing.layout,
        ...incomingLayout,
        mode,
        boardMeta,
        boardState
    });

    return {
        layout,
        widgets,
        theme: body?.theme || existing.theme || 'default',
        mode,
        boardMeta,
        boardState
    };
}

async function buildEventRiskSummary(user, businessScope = null) {
    const today = getKyivDateStr();
    const meta = dashboardSourceMeta(businessScope);
    const tomorrow = addDays(today, 1);
    const prepParams = [];
    const prepVisibility = buildTaskVisibilityScope(user, prepParams, 't');
    const prepBusinessCondition = businessScope ? appendDashboardBusinessScope(prepParams, businessScope, 't') : '';
    const prepBookingVisibility = getVisibleBookingScope(user, prepParams, 'b');
    const prepBookingVisibilityBusiness = businessScope ? appendDashboardBusinessScope(prepParams, businessScope, 'b') : '';
    const todayParams = [today];
    const todayBookingVisibility = getVisibleBookingScope(user, todayParams, 'b');
    const todayBookingVisibilityBusiness = businessScope ? appendDashboardBusinessScope(todayParams, businessScope, 'b') : '';
    const tomorrowParams = [tomorrow];
    const tomorrowBookingVisibility = getVisibleBookingScope(user, tomorrowParams, 'b');
    const tomorrowBookingVisibilityBusiness = businessScope ? appendDashboardBusinessScope(tomorrowParams, businessScope, 'b') : '';
    const lateParams = [today];
    const lateBookingVisibility = getVisibleBookingScope(user, lateParams, 'b');
    const lateBookingVisibilityBusiness = businessScope ? appendDashboardBusinessScope(lateParams, businessScope, 'b') : '';
    const resourceParams = [today];
    const resourceBookingVisibility = getVisibleBookingScope(user, resourceParams, 'b');
    const resourceBookingVisibilityBusiness = businessScope ? appendDashboardBusinessScope(resourceParams, businessScope, 'b') : '';

    const [todayUnconfirmed, tomorrowUnconfirmed, latePreliminary, bookingLinkedOverduePrep, resourceWarnings, conflicts] = await Promise.all([
        dashboardSource(meta, 'todayUnconfirmed', `
            SELECT COUNT(*) AS count
            FROM bookings b
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND b.status = 'preliminary'
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
              ${todayBookingVisibility.sql} ${todayBookingVisibilityBusiness}
        `, todayParams),
        dashboardSource(meta, 'tomorrowUnconfirmed', `
            SELECT COUNT(*) AS count
            FROM bookings b
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND b.status = 'preliminary'
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
              ${tomorrowBookingVisibility.sql} ${tomorrowBookingVisibilityBusiness}
        `, tomorrowParams),
        dashboardSource(meta, 'latePreliminary', `
            SELECT COUNT(*) AS count
            FROM bookings b
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND b.status = 'preliminary'
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
              AND (${SAFE_BOOKING_START_MINUTES_SQL})
                  - EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int * 60
                  - EXTRACT(MINUTE FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int
                  BETWEEN 0 AND 120
              ${lateBookingVisibility.sql} ${lateBookingVisibilityBusiness}
        `, lateParams),
        dashboardSource(meta, 'bookingLinkedOverduePrep', `
            SELECT COUNT(*) AS count
            FROM tasks t
            JOIN bookings b ON t.source_type = 'booking' AND t.source_id = b.id::text
            WHERE ${taskKpiCanonicalOverdueSql('t')}
              AND COALESCE(b.status, 'confirmed') <> 'cancelled'
              ${prepVisibility}
              ${prepBusinessCondition}
              ${prepBookingVisibility.sql} ${prepBookingVisibilityBusiness}
        `, prepParams),
        dashboardSource(meta, 'resourceWarnings', `
            SELECT COUNT(*) AS count
            FROM bookings b
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND COALESCE(b.status, 'confirmed') <> 'cancelled'
              AND ${BOOKING_LINE_UNASSIGNED_SQL}
              ${resourceBookingVisibility.sql} ${resourceBookingVisibilityBusiness}
        `, resourceParams),
        dashboardRoomConflicts(user, businessScope, today, meta)
    ]);

    const summary = {
        todayUnconfirmed: dashboardNumber(todayUnconfirmed, 'count'),
        tomorrowUnconfirmed: dashboardNumber(tomorrowUnconfirmed, 'count'),
        latePreliminary: dashboardNumber(latePreliminary, 'count'),
        bookingLinkedOverduePrep: dashboardNumber(bookingLinkedOverduePrep, 'count'),
        resourceWarnings: dashboardNumber(resourceWarnings, 'count'),
        roomConflicts: conflicts.unavailable ? null : Number(conflicts.rows[0]?.total_count || 0)
    };

    return {
        eventRiskSummary: summary,
        cards: [
            { key: 'today_unconfirmed', label: 'Непідтверджені сьогодні', count: summary.todayUnconfirmed, kind: 'needs_confirmation', href: `/?date=${today}&businessContext=${encodeURIComponent(businessScope?.activeContext || 'event_genix')}`, why: 'Попередні бронювання сьогодні' },
            { key: 'tomorrow_unconfirmed', label: 'Непідтверджені завтра', count: summary.tomorrowUnconfirmed, kind: 'needs_confirmation', href: `/?date=${tomorrow}&businessContext=${encodeURIComponent(businessScope?.activeContext || 'event_genix')}`, why: 'Попередні бронювання завтра' },
            { key: 'late_preliminary', label: 'Попередні бронювання скоро стартують', count: summary.latePreliminary, kind: 'late_preliminary', href: `/?date=${today}&businessContext=${encodeURIComponent(businessScope?.activeContext || 'event_genix')}`, why: 'Попередні бронювання з початком протягом двох годин' },
            { key: 'booking_linked_overdue_prep', label: 'Прострочена підготовка бронювань', count: summary.bookingLinkedOverduePrep, kind: 'booking_linked_overdue_prep', href: `/tasks?source_type=booking&overdue=1&businessContext=${encodeURIComponent(businessScope?.activeContext || 'event_genix')}`, why: 'Канонічно прострочені задачі, пов’язані з доступним бронюванням' },
            { key: 'resource_warnings', label: 'Ресурси не призначені сьогодні', count: summary.resourceWarnings, kind: 'resource_warning', href: '/dashboard#widget-exceptions', why: 'Бронювання сьогодні без призначеного виконавця' },
            { key: 'room_conflicts', label: 'Конфлікти кімнат сьогодні', count: summary.roomConflicts, kind: 'room_conflict', href: `/?date=${today}&businessContext=${encodeURIComponent(businessScope?.activeContext || 'event_genix')}`, why: 'Перетин часу двох доступних бронювань однієї кімнати' }
        ],
        meta: {
            ...meta,
            globalScore: false,
            visibleScopeOnly: true,
            bookingVisibilityBoundary: 'canonical object-level booking visibility scope',
            bookingVisibilityScopeSource: todayBookingVisibility.scopeSource,
            bookingVisibilityClassification: todayBookingVisibility.classification,
            bookingVisibilityReason: todayBookingVisibility.reason,
            denialSemantics: 'hidden bookings are absent from dashboard event-risk counts',
            missingDurableScopes: ['team', 'line', 'location'],
            prepSource: 'tasks.source_type=booking AND tasks.source_id=bookings.id',
            eventSoonSemantics: 'Подія, що скоро почнеться, є сигналом для перевірки часу, а не оцінкою готовності бронювання'
        }
    };
}

// GET /api/dashboard/config — user's dashboard configuration
router.get('/config', async (req, res) => {
    try {
        const result = await pool.query(
            DASHBOARD_CONFIG_SELECT_SQL,
            [req.user.id]
        );

        if (result.rows.length > 0) {
            return res.json({ success: true, config: normalizeDashboardConfig(result.rows[0], req.user.role) });
        }

        // Return defaults based on role
        const defaultWidgets = getDefaultWidgets(req.user.role);
        const defaultConfig = normalizeDashboardConfig({
            layout: {},
            widgets: defaultWidgets,
            theme: 'default',
            mode: DASHBOARD_WORKSPACE_MODE
        }, req.user.role);
        res.json({
            success: true,
            config: defaultConfig,
            isDefault: true
        });
    } catch (err) {
        log.error('Failed to get dashboard config', err);
        res.status(500).json({ error: 'Failed to load dashboard config' });
    }
});

// PUT /api/dashboard/config — save user's dashboard configuration
router.put('/config', async (req, res) => {
    try {
        const existingResult = await pool.query(
            DASHBOARD_CONFIG_SELECT_SQL,
            [req.user.id]
        );
        const existingRaw = existingResult.rows[0] || null;
        const baseRevision = requestedDashboardConfigBaseRevision(req.body || {});
        if (existingRaw) {
            const currentRevision = normalizeDashboardConfigRevision(existingRaw.server_revision || existingRaw.updated_at);
            if (!baseRevision || baseRevision !== currentRevision) {
                return res.status(409).json(dashboardConfigConflictPayload(existingRaw, req.user.role, baseRevision ? 'stale_revision' : 'missing_revision'));
            }
        } else if (baseRevision) {
            return res.status(409).json(dashboardConfigConflictPayload(null, req.user.role, 'missing_server_config'));
        }
        const sourceRaw = existingRaw || {
            layout: {},
            widgets: getDefaultWidgets(req.user.role),
            theme: 'default'
        };
        const nextConfig = buildPersistedDashboardConfig(sourceRaw, req.body || {}, req.user.role);
        const params = [req.user.id, JSON.stringify(nextConfig.layout), JSON.stringify(nextConfig.widgets), nextConfig.theme || 'default'];
        const saveResult = existingRaw
            ? await pool.query(DASHBOARD_CONFIG_UPSERT_SQL, [...params, baseRevision])
            : await pool.query(DASHBOARD_CONFIG_INSERT_SQL, params);
        if (saveResult.rows.length < 1) {
            const currentResult = await pool.query(DASHBOARD_CONFIG_SELECT_SQL, [req.user.id]);
            return res.status(409).json(dashboardConfigConflictPayload(currentResult.rows[0] || null, req.user.role, 'concurrent_write'));
        }

        res.json({ success: true, config: normalizeDashboardConfig(saveResult.rows[0], req.user.role) });
    } catch (err) {
        log.error('Failed to save dashboard config', err);
        res.status(500).json({ error: 'Failed to save dashboard config' });
    }
});

// GET /api/dashboard/widgets/:type — widget-specific data
router.get('/widgets/:type', requireDashboardWidgetRevenue, allowDashboardPublicCatalogResponse, shapeDashboardRevenue, async (req, res) => {
    try {
        const { type } = req.params;
        const widgetAccess = canAccessDashboardWidget(req.user.role, type, ROLE_LEVEL);
        if (widgetAccess === false) {
            return res.status(403).json({ error: 'Insufficient widget permissions' });
        }
        const businessScope = dashboardBusinessScope(req, res);
        if (!businessScope) return;

        let data = {};

        switch (type) {
            case 'tasks': {
                const params = [];
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const ownFilter = buildOwnTaskFilter(req.user, params, 't');
                const taskBusinessCondition = appendDashboardBusinessScope(params, businessScope, 't');
                const result = await pool.query(`
                    SELECT t.id, t.title, t.status, t.priority, t.deadline, t.category,
                           t.owner_user_id, t.assigned_to, t.owner, t.updated_at, t.created_at,
                           t.task_mode, t.task_kind, t.visibility, t.workflow_state, t.focus_rank,
                           ${dashboardTaskTimingSelect('t')},
                           u.name AS owner_name, u.username AS owner_username,
                           ${TASK_WIDGET_SUBTASK_SELECT}
                    FROM tasks t
                    LEFT JOIN users u ON u.id = t.owner_user_id
                    ${TASK_WIDGET_SUBTASK_JOINS}
                    WHERE ${dashboardActionableTaskSql('t')}
                    ${visibility}
                    ${ownFilter}
                    ${taskBusinessCondition}
                    ORDER BY
                        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                        ${taskKpiWorkloadDateSql('t')} ASC NULLS LAST
                    LIMIT 10
                `, params);
                const tasks = taskWidgetPayload(result.rows).map(row => dashboardFocusTask(row, getKyivDateStr()));
                data = { tasks, intelligence: buildTaskOperationsSummary(tasks) };
                break;
            }

            case 'personal_tasker': {
                if (req.user.role !== 'creator') {
                    return res.status(403).json({ error: 'Creator tasker is available only for creator role' });
                }
                const params = [];
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const taskBusinessCondition = appendDashboardBusinessScope(params, businessScope, 't');
                const result = await pool.query(`
                    SELECT t.id, t.title, t.status, t.priority, t.deadline, t.category,
                           t.owner_user_id, t.assigned_to, t.owner, t.updated_at, t.created_at,
                           t.created_by, t.created_by_user_id, t.completed_at,
                           t.task_mode, t.task_kind, t.visibility, t.workflow_state, t.focus_rank,
                           ${dashboardTaskTimingSelect('t')},
                           u.name AS owner_name, u.username AS owner_username,
                           cu.name AS creator_name, cu.username AS creator_username,
                           ${TASK_WIDGET_SUBTASK_SELECT}
                    FROM tasks t
                    LEFT JOIN users u ON u.id = t.owner_user_id
                    LEFT JOIN users cu ON cu.id = t.created_by_user_id
                    ${TASK_WIDGET_SUBTASK_JOINS}
                    WHERE t.archived_at IS NULL AND LOWER(COALESCE(t.status, 'todo')) NOT IN ('archived','cancelled','canceled')
                      AND NOT (t.snoozed_until IS NOT NULL AND t.snoozed_until > NOW())
                    ${visibility}
                    ${taskBusinessCondition}
                    ORDER BY
                        CASE WHEN ${taskKpiCanonicalOverdueSql('t')} THEN 0 ELSE 1 END,
                        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                        CASE WHEN COALESCE(t.status, 'todo') IN ('done','cancelled') THEN 1 ELSE 0 END,
                        ${taskKpiWorkloadDateSql('t')} ASC NULLS LAST,
                        t.updated_at DESC
                    LIMIT 180
                `, params);
                const statsParams = [];
                const statsVisibility = buildTaskVisibilityScope(req.user, statsParams, 't');
                statsParams.push(getKyivDateStr());
                const statsTodayRef = `$${statsParams.length}`;
                const statsBusinessCondition = appendDashboardBusinessScope(statsParams, businessScope, 't');
                const statsResult = await pool.query(`
                    SELECT
                        (
                            COUNT(*) FILTER (WHERE ${taskKpiEligibleSql('t')})
                            + COALESCE(SUM(COALESCE(st.total, 0)) FILTER (WHERE ${taskKpiEligibleSql('t')}), 0)
                        )::int AS total,
                        COUNT(*) FILTER (WHERE ${taskKpiActiveWorkSql('t')} AND ${taskKpiEligibleSql('t')})::int AS active,
                        COUNT(*) FILTER (WHERE ${taskKpiActiveWorkSql('t')} AND ${taskKpiEligibleSql('t')} AND COALESCE(t.status, 'todo') = 'todo')::int AS todo,
                        COUNT(*) FILTER (WHERE ${taskKpiActiveWorkSql('t')} AND ${taskKpiEligibleSql('t')} AND COALESCE(t.status, 'todo') = 'in_progress')::int AS in_progress,
                        (
                            COUNT(*) FILTER (WHERE ${taskKpiEligibleSql('t')} AND ${taskKpiCompletedSql('t')})
                            + COALESCE(SUM(COALESCE(st.done, 0)) FILTER (WHERE ${taskKpiEligibleSql('t')}), 0)
                        )::int AS done,
                        (
                            COUNT(*) FILTER (
                                WHERE ${taskKpiEligibleSql('t')}
                                  AND ${taskKpiCompletedSql('t')}
                                  AND t.completed_at IS NOT NULL
                                  AND DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv') = ${statsTodayRef}::date
                            )
                            + COALESCE(SUM(COALESCE(st.done_today, 0)) FILTER (WHERE ${taskKpiEligibleSql('t')}), 0)
                        )::int AS done_today,
                        COUNT(*) FILTER (WHERE ${taskKpiEligibleSql('t')} AND ${taskKpiCompletedSql('t')})::int AS parent_done,
                        COUNT(*) FILTER (
                            WHERE ${taskKpiEligibleSql('t')}
                              AND ${taskKpiCompletedSql('t')}
                              AND t.completed_at IS NOT NULL
                              AND DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv') = ${statsTodayRef}::date
                        )::int AS parent_done_today,
                        COALESCE(SUM(COALESCE(st.done, 0)) FILTER (WHERE ${taskKpiEligibleSql('t')}), 0)::int AS subtask_done,
                        COALESCE(SUM(COALESCE(st.done_today, 0)) FILTER (WHERE ${taskKpiEligibleSql('t')}), 0)::int AS subtask_done_today,
                        'completed_units = completed_parent_tasks + completed_subtasks' AS completed_metric_contract,
                        COUNT(*) FILTER (WHERE ${taskKpiCanonicalOverdueSql('t', `${statsTodayRef}::date`)})::int AS overdue
                    FROM tasks t
                    LEFT JOIN (
                        SELECT task_id,
                               COUNT(*)::int AS total,
                               COUNT(*) FILTER (WHERE is_done = true)::int AS done,
                               COUNT(*) FILTER (
                                   WHERE is_done = true
                                     AND completed_at IS NOT NULL
                                     AND DATE(completed_at AT TIME ZONE 'Europe/Kyiv') = ${statsTodayRef}::date
                               )::int AS done_today
                        FROM task_subtasks
                        GROUP BY task_id
                    ) st ON st.task_id = t.id
                    WHERE t.archived_at IS NULL AND LOWER(COALESCE(t.status, 'todo')) NOT IN ('archived','cancelled','canceled')
                      AND NOT (t.snoozed_until IS NOT NULL AND t.snoozed_until > NOW())
                    ${statsVisibility}
                    ${statsBusinessCondition}
                `, statsParams);
                data = buildPersonalTaskerPayload(result.rows, req.user, normalizeTaskerStatsRow(statsResult.rows[0] || {}));
                break;
            }

            case 'my_focus': {
                const today = getKyivDateStr();
                const params = [];
                const ownFilter = buildOwnTaskFilter(req.user, params, 't');
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const taskBusinessCondition = appendDashboardBusinessScope(params, businessScope, 't');
                const result = await pool.query(`
                    WITH candidates AS (
                        SELECT t.id, t.title, t.status, t.priority, t.deadline, t.category,
                               t.owner_user_id, t.assigned_to, t.owner, t.updated_at, t.created_at,
                               t.task_mode, t.task_kind, t.visibility, t.workflow_state, t.focus_rank,
                               ${dashboardTaskTimingSelect('t')},
                               u.name AS owner_name, u.username AS owner_username,
                               ${TASK_WIDGET_SUBTASK_SELECT},
                               ROW_NUMBER() OVER (
                                   PARTITION BY (COALESCE(t.focus_rank, 0) > 0)
                                   ORDER BY
                                       CASE WHEN (${dashboardTaskEffectiveDueSql('t')} BETWEEN NOW() AND NOW() + INTERVAL '2 hours')
                                                 OR (t.priority IN ('critical', 'urgent', 'high') AND ${taskKpiWorkloadDateSql('t')} = (NOW() AT TIME ZONE 'Europe/Kyiv')::date) THEN 0
                                            WHEN COALESCE(t.focus_rank, 0) > 0 THEN 1
                                            WHEN ${taskKpiWorkloadDateSql('t')} < (NOW() AT TIME ZONE 'Europe/Kyiv')::date THEN 3 ELSE 2 END,
                                       NULLIF(t.focus_rank, 0) ASC NULLS LAST,
                                       ${dashboardTaskEffectiveDueSql('t')} ASC NULLS LAST,
                                       t.updated_at DESC, t.id
                               ) AS preview_rank
                        FROM tasks t
                        LEFT JOIN users u ON u.id = t.owner_user_id
                        ${TASK_WIDGET_SUBTASK_JOINS}
                        WHERE ${dashboardFocusAvailableSql('t')}
                        ${ownFilter} ${visibility} ${taskBusinessCondition}
                    )
                    SELECT * FROM candidates WHERE preview_rank <= 3
                    ORDER BY CASE WHEN COALESCE(focus_rank, 0) > 0 THEN 0 ELSE 1 END, preview_rank
                `, params);
                const countParams = [];
                const countOwn = buildOwnTaskFilter(req.user, countParams, 't');
                const countVisibility = buildTaskVisibilityScope(req.user, countParams, 't');
                countParams.push(today);
                const countTodayRef = `$${countParams.length}`;
                const countBusinessCondition = appendDashboardBusinessScope(countParams, businessScope, 't');
                const counts = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE ${taskKpiCanonicalOverdueSql('t', `${countTodayRef}::date`)})::int AS overdue_count,
                        COUNT(*) FILTER (WHERE COALESCE(t.workflow_state, 'todo') = 'waiting' OR COALESCE(t.task_kind, 'action') = 'waiting')::int AS waiting_count,
                        COUNT(*) FILTER (WHERE COALESCE(t.focus_rank, 0) > 0)::int AS selected_count,
                        COUNT(*) FILTER (WHERE COALESCE(t.focus_rank, 0) <= 0)::int AS recommended_count,
                        COUNT(*)::int AS actionable_count
                    FROM tasks t
                    WHERE ${dashboardFocusAvailableSql('t')} ${countOwn} ${countVisibility} ${countBusinessCondition}
                `, countParams);
                const candidates = taskWidgetPayload(result.rows).map(row => dashboardFocusTask(row, today));
                const selectedTasks = candidates.filter(row => row.isSelectedFocus);
                const recommendedTasks = candidates.filter(row => !row.isSelectedFocus);
                data = {
                    tasks: [...selectedTasks, ...recommendedTasks].slice(0, 3),
                    selectedTasks, recommendedTasks,
                    selectedCount: Number(counts.rows[0]?.selected_count || 0),
                    recommendedCount: Number(counts.rows[0]?.recommended_count || 0),
                    actionableCount: Number(counts.rows[0]?.actionable_count || 0),
                    overdueCount: Number(counts.rows[0]?.overdue_count || 0),
                    waitingCount: Number(counts.rows[0]?.waiting_count || 0),
                    meta: { ...dashboardSourceMeta(businessScope), sourceStates: { tasks: 'ready' },
                        metricContracts: { selectedCount: 'active visible own tasks with focus_rank > 0, excluding currently snoozed tasks',
                            overdueCount: 'canonical task KPI overdue policy; effective working date, not original deadline',
                            recommendations: 'visible own actionable tasks, not user-selected focus' } }
                };
                break;
            }

            case 'bookings_today': {
                const today = getKyivDateStr();
                const params = [today];
                const bookingVisibility = getVisibleBookingScope(req.user, params, 'b');
                const bookingBusinessCondition = appendDashboardBusinessScope(params, businessScope, 'b');
                const result = await pool.query(`
                    SELECT b.id, b.label as client_name, b.program_name as program,
                           b.time as start_time, b.room, b.status, b.category,
                           b.kids_count as children_count,
                           b.banquet_guests, b.banquet_adults, b.banquet_tables, b.banquet_menu
                    FROM bookings b
                    WHERE b.date = $1 AND b.status != 'cancelled'
                    ${bookingVisibility.sql} ${bookingBusinessCondition}
                    ORDER BY b.time ASC
                `, params);
                data = { bookings: result.rows, date: today, meta: { visibleScopeOnly: true, scopeSource: bookingVisibility.scopeSource } };
                break;
            }

            case 'nearest_event': {
                data = await loadNearestEventWidgetData(req.user, businessScope);
                break;
            }

            case 'my_schedule': {
                const today = getKyivDateStr();
                const params = [req.user.id, today];
                const scheduleScope = appendDashboardBusinessScope(params, businessScope, 'ss');
                const result = await pool.query(`
                    SELECT ss.date, ss.status, ss.shift_start as start_time, ss.shift_end as end_time, ss.note,
                           COALESCE((
                               SELECT jsonb_agg(jsonb_build_object(
                                   'id', hss.id,
                                   'segmentId', hss.id,
                                   'professionKey', hss.profession_key,
                                   'start', LEFT(hss.planned_start::text, 5),
                                   'end', LEFT(hss.planned_end::text, 5),
                                   'breakMinutes', hss.break_minutes,
                                   'additionalRoles', COALESCE((
                                       SELECT jsonb_agg(jsonb_build_object(
                                           'professionKey', hssr.profession_key,
                                           'compensationMode', hssr.compensation_mode,
                                           'payMultiplier', hssr.pay_multiplier,
                                           'policyVersion', hssr.policy_version,
                                           'countsAsPhysicalTime', false
                                       ) ORDER BY hssr.profession_key)
                                       FROM hr_shift_segment_roles hssr
                                       WHERE hssr.segment_id = hss.id
                                   ), '[]'::jsonb),
                                   'additionalProfessionKeys', COALESCE((
                                       SELECT jsonb_agg(hssr.profession_key ORDER BY hssr.profession_key)
                                       FROM hr_shift_segment_roles hssr
                                       WHERE hssr.segment_id = hss.id
                                   ), '[]'::jsonb),
                                   'countsAsPhysicalTime', true,
                                   'physicalTimeSource', 'segment'
                               ) ORDER BY hss.sort_order, hss.planned_start, hss.id)
                               FROM hr_shifts hs
                               JOIN hr_shift_segments hss ON hss.hr_shift_id = hs.id
                               WHERE hs.staff_id = ss.staff_id AND hs.shift_date = ss.date::date
                           ), '[]'::jsonb) AS segments
                    FROM staff_schedule ss
                    JOIN employee_profiles ep ON ep.staff_id = ss.staff_id
                    WHERE ep.user_id = $1 AND ss.date::date >= $2::date ${scheduleScope}
                    ORDER BY ss.date ASC
                    LIMIT 7
                `, params);
                data = { shifts: result.rows };
                break;
            }

            case 'team_online': {
                const rawLimit = parseInt(req.query.limit, 10);
                const limit = Math.max(5, Math.min(Number.isInteger(rawLimit) ? rawLimit : 30, 80));
                const scope = String(req.query.scope || 'online').toLowerCase();
                const includeHistory = ['history', 'all', 'shift', 'last_seen'].includes(scope);
                const onlineUserIds = (typeof getOnlineUserIds === 'function' ? getOnlineUserIds() : [])
                    .map(id => parseInt(id, 10))
                    .filter(id => Number.isInteger(id) && id > 0);
                const onlineSet = new Set(onlineUserIds.map(String));
                if (!includeHistory && onlineUserIds.length === 0) {
                    data = {
                        online: [],
                        users: [],
                        meta: {
                            scope: 'online',
                            onlineSource: 'websocket_online_users',
                            lastSeenSource: 'hidden_until_history_enabled',
                            onlineCount: 0,
                            recentlyActiveCount: 0,
                            returned: 0,
                            limit,
                            refreshable: true
                        }
                    };
                    break;
                }
                const result = await pool.query(`
                    SELECT u.id, u.username, u.name, u.role,
                           u.last_seen_at AS user_last_seen_at,
                           ep.last_activity_at AS profile_last_activity_at,
                           COALESCE(u.last_seen_at, ep.last_activity_at) AS last_seen
                    FROM users u
                    LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_active = true
                    WHERE COALESCE(u.is_active, true) = true
                    AND u.role NOT IN ('bot', 'viewer')
                    AND lower(COALESCE(u.username, '')) NOT LIKE 'openclaw%'
                    AND lower(COALESCE(u.username, '')) NOT LIKE 'open_claw%'
                    AND lower(COALESCE(u.username, '')) NOT LIKE 'open-claw%'
                    AND lower(COALESCE(u.name, '')) NOT LIKE 'openclaw%'
                    AND lower(COALESCE(u.name, '')) NOT LIKE 'open claw%'
                    AND ($3::boolean = true OR u.id = ANY($1::int[]))
                    ORDER BY
                        CASE WHEN u.id = ANY($1::int[]) THEN 0 ELSE 1 END,
                        COALESCE(u.last_seen_at, ep.last_activity_at) DESC NULLS LAST,
                        COALESCE(NULLIF(u.name, ''), u.username) ASC,
                        u.id ASC
                    LIMIT $2
                `, [onlineUserIds, limit, includeHistory]);
                const now = Date.now();
                const users = result.rows.map(row => {
                    const lastSeenDate = row.last_seen ? new Date(row.last_seen) : null;
                    const diffMs = lastSeenDate && !Number.isNaN(lastSeenDate.getTime()) ? now - lastSeenDate.getTime() : null;
                    const recentlyActive = diffMs !== null && diffMs >= 0 && diffMs <= 5 * 60 * 1000;
                    const isOnline = onlineSet.has(String(row.id));
                    return {
                        id: row.id,
                        username: row.username || null,
                        name: row.name || row.username || `User #${row.id}`,
                        role: row.role || null,
                        isOnline,
                        recentlyActive,
                        status: isOnline ? 'online' : (recentlyActive ? 'recently_active' : 'offline'),
                        lastSeen: row.last_seen || null,
                        lastSeenAt: row.last_seen || null,
                        userLastSeenAt: row.user_last_seen_at || null,
                        profileLastActivityAt: row.profile_last_activity_at || null
                    };
                });
                data = {
                    online: users,
                    users,
                    meta: {
                        scope: includeHistory ? 'history' : 'online',
                        onlineSource: 'websocket_online_users',
                        lastSeenSource: 'users.last_seen_at_or_employee_profiles.last_activity_at',
                        onlineCount: users.filter(user => user.isOnline).length,
                        recentlyActiveCount: users.filter(user => !user.isOnline && user.recentlyActive).length,
                        returned: users.length,
                        limit,
                        refreshable: true
                    }
                };
                break;
            }

            case 'quick_stats': {
                const today = getKyivDateStr();
                const activeTaskParams = [];
                const activeTaskVisibility = buildTaskVisibilityScope(req.user, activeTaskParams, 't');
                const activeTaskBusinessCondition = appendDashboardBusinessScope(activeTaskParams, businessScope, 't');
                const overdueTaskParams = [];
                const overdueTaskVisibility = buildTaskVisibilityScope(req.user, overdueTaskParams, 't');
                overdueTaskParams.push(today);
                const overdueTodayRef = `$${overdueTaskParams.length}`;
                const overdueTaskBusinessCondition = appendDashboardBusinessScope(overdueTaskParams, businessScope, 't');
                const bookingCountParams = [today];
                const bookingCountVisibility = getVisibleBookingScope(req.user, bookingCountParams, 'b');
                const bookingCountBusinessCondition = appendDashboardBusinessScope(bookingCountParams, businessScope, 'b');
                const revenueParams = [today];
                const revenueVisibility = getVisibleBookingScope(req.user, revenueParams, 'b');
                const revenueBusinessCondition = appendDashboardBusinessScope(revenueParams, businessScope, 'b');
                const unconfirmedParams = [today];
                const unconfirmedVisibility = getVisibleBookingScope(req.user, unconfirmedParams, 'b');
                const unconfirmedBusinessCondition = appendDashboardBusinessScope(unconfirmedParams, businessScope, 'b');
                const lowStockParams = [];
                const lowStockBusinessCondition = appendDashboardBusinessScope(lowStockParams, businessScope, 'ws');
                const coldLeadParams = [CLOSED_LEAD_STAGES];
                const coldLeadBusinessCondition = appendDashboardBusinessScope(coldLeadParams, businessScope, 'l');
                const [bookings, tasks, revenue, overdueQS, unconfirmedQS, lowStockQS, coldLeadsQS] = await Promise.all([
                    pool.query(`SELECT COUNT(*) as count FROM bookings b WHERE b.date = $1 AND b.status != 'cancelled' ${bookingCountVisibility.sql} ${bookingCountBusinessCondition}`, bookingCountParams),
                    pool.query(`SELECT COUNT(*) as count FROM tasks t WHERE t.status = 'in_progress' ${activeTaskVisibility} ${activeTaskBusinessCondition}`, activeTaskParams),
                    pool.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM bookings b WHERE b.date = $1 AND b.status = 'confirmed' ${revenueVisibility.sql} ${revenueBusinessCondition}`, revenueParams),
                    pool.query(`SELECT COUNT(*) as count FROM tasks t WHERE ${taskKpiCanonicalOverdueSql('t', `${overdueTodayRef}::date`)} ${overdueTaskVisibility} ${overdueTaskBusinessCondition}`, overdueTaskParams),
                    pool.query(`SELECT COUNT(*) as count FROM bookings b WHERE b.date = $1 AND b.status = 'preliminary' ${unconfirmedVisibility.sql} ${unconfirmedBusinessCondition}`, unconfirmedParams),
                    pool.query(`SELECT COUNT(*) as count FROM warehouse_stock ws WHERE ws.quantity <= ws.min_quantity AND ws.is_active = true ${lowStockBusinessCondition}`, lowStockParams),
                    pool.query(`SELECT COUNT(*) as count FROM leads l WHERE COALESCE(l.pipeline_stage, 'new') <> ALL($1::text[]) AND ${SALES_LEAD_TYPE_FILTER} AND COALESCE(l.last_contact_at, l.created_at) < NOW() - INTERVAL '48 hours' ${coldLeadBusinessCondition}`, coldLeadParams)
                ]);
                const ov = parseInt(overdueQS.rows[0].count);
                const uc = parseInt(unconfirmedQS.rows[0].count);
                const ls = parseInt(lowStockQS.rows[0].count);
                const cl = parseInt(coldLeadsQS.rows[0].count);
                data = {
                    bookingsToday: parseInt(bookings.rows[0].count),
                    activeTasks: parseInt(tasks.rows[0].count),
                    revenueToday: parseFloat(revenue.rows[0].total),
                    needsAttention: ov + uc + ls + cl,
                    overdueTasks: ov,
                    unconfirmedBookings: uc,
                    lowStockItems: ls,
                    coldLeads: cl,
                    meta: {
                        businessScope: dashboardBusinessScopeMeta(businessScope),
                        period: {
                            key: 'today',
                            date: today,
                            timezone: 'Europe/Kyiv'
                        },
                        metricContracts: {
                            bookingsToday: 'visible non-cancelled bookings for the selected Kyiv date',
                            activeTasks: "visible tasks with status='in_progress'",
                            revenueToday: "SUM(bookings.price) for visible confirmed bookings on the selected Kyiv date; not payments or profit",
                            overdueTasks: 'visible tasks matching the canonical task KPI overdue policy',
                            coldLeads: 'visible quality leads outside closed/lost stages where last contact or creation is older than 48 hours',
                            needsAttention: 'sum of separate warning counters; not a score'
                        },
                        scopedCounters: ['bookingsToday', 'activeTasks', 'revenueToday', 'overdueTasks', 'unconfirmedBookings', 'lowStockItems', 'coldLeads'],
                        globalCounters: []
                    }
                };
                break;
            }

            case 'alerts': {
                const alertToday = getKyivDateStr();
                const overdueParams = [];
                const overdueVisibility = buildTaskVisibilityScope(req.user, overdueParams, 't');
                const overdueBusinessCondition = appendDashboardBusinessScope(overdueParams, businessScope, 't');
                const unconfirmedParams = [alertToday];
                const unconfirmedVisibility = getVisibleBookingScope(req.user, unconfirmedParams, 'b');
                const unconfirmedBusinessCondition = appendDashboardBusinessScope(unconfirmedParams, businessScope, 'b');
                const lowStockParams = [];
                const lowStockBusinessCondition = appendDashboardBusinessScope(lowStockParams, businessScope, 'ws');
                const coldLeadParams = [];
                const coldLeadBusinessCondition = appendDashboardBusinessScope(coldLeadParams, businessScope, 'l');
                const shiftParams = [alertToday];
                const shiftVisibility = getVisibleBookingScope(req.user, shiftParams, 'b');
                const openShiftBusinessCondition = appendDashboardBusinessScope(shiftParams, businessScope, 'cs');
                const shiftBookingBusinessCondition = appendDashboardBusinessScope(shiftParams, businessScope, 'b');
                const [urgentAlerts, overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
                    buildUrgentTaskAlerts(req.user, businessScope, 5),
                    pool.query(`SELECT t.id, t.title, t.deadline FROM tasks t
                                WHERE t.deadline < NOW()
                                  AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
                                  ${overdueVisibility}
                                  ${overdueBusinessCondition}
                                ORDER BY t.deadline ASC LIMIT 5`, overdueParams),
                    pool.query(`SELECT b.id, b.label, b.time FROM bookings b
                                WHERE b.date = $1 AND b.status = 'preliminary'
                                  ${unconfirmedVisibility.sql}
                                  ${unconfirmedBusinessCondition}
                                ORDER BY b.time LIMIT 5`, unconfirmedParams),
                    pool.query(`SELECT ws.name, ws.quantity, ws.min_quantity, ws.unit FROM warehouse_stock ws
                                WHERE ws.quantity <= ws.min_quantity AND ws.is_active = true ${lowStockBusinessCondition} LIMIT 3`, lowStockParams),
                    pool.query(`SELECT COUNT(*) as c FROM leads l
                                WHERE COALESCE(l.pipeline_stage, 'new') = 'new'
                                  AND ${SALES_LEAD_TYPE_FILTER}
                                  AND l.created_at < NOW() - INTERVAL '48 hours'
                                  ${coldLeadBusinessCondition}`, coldLeadParams),
                    pool.query(`SELECT
                                  (SELECT COUNT(*) FROM cash_register_shifts cs WHERE cs.status = 'open' ${openShiftBusinessCondition}) AS open_shifts,
                                  (SELECT COUNT(*) FROM bookings b WHERE b.date = $1 AND b.status = 'confirmed' ${shiftVisibility.sql} ${shiftBookingBusinessCondition}) AS today_bk`,
                                shiftParams)
                ]);
                const alerts = [];
                alerts.push(...urgentAlerts);
                overdue.rows.forEach(t => {
                    alerts.push({ id: `overdue_${t.id}`, type: 'warning', level: 'warning', icon: '⚠️',
                        title: `Прострочена: "${(t.title || '').slice(0, 40)}"`, link: '/tasks',
                        action: { label: '📋 Задача', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
                    });
                });
                unconfirmed.rows.forEach(b => {
                    alerts.push({ id: `unconfirmed_${b.id}`, type: 'info', level: 'info', icon: '📋',
                        title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`, link: '/',
                        action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
                    });
                });
                lowStock.rows.forEach((s, i) => {
                    alerts.push({ id: `stock_${i}`, type: 'warning', level: 'warning', icon: '📦',
                        title: `Мало: ${s.name} (${s.quantity} ${s.unit})`, link: '/warehouse',
                        action: { label: '📋 Замовити', prompt: `На складі мало: ${s.name} (${s.quantity}/${s.min_quantity}). Замовити.` }
                    });
                });
                const coldCount = parseInt(coldLeads.rows[0].c);
                if (coldCount > 0) {
                    alerts.push({ id: 'cold_leads', type: 'warning', level: 'warning', icon: '🥶',
                        title: `${coldCount} лідів без відповіді >48год`, link: '/sales-funnel',
                        action: { label: '📋 Обдзвін', prompt: `${coldCount} лідів без відповіді. Задача менеджеру.` }
                    });
                }
                const { open_shifts, today_bk } = shiftCheck.rows[0];
                if (parseInt(open_shifts) === 0 && parseInt(today_bk) > 0) {
                    alerts.push({ id: 'no_shift', type: 'critical', level: 'critical', icon: '🔴',
                        title: `Каса не відкрита! (${today_bk} броні)`, link: '/finance',
                        action: { label: '💰 Відкрити', prompt: 'Каса не відкрита. Нагадати.' }
                    });
                }
                alerts.push(...await getOmniAccountAlertsAsync());
                data = {
                    alerts,
                    count: alerts.length,
                    meta: {
                        businessScope: dashboardBusinessScopeMeta(businessScope),
                        scopedSignals: ['urgent_tasks', 'overdue_tasks', 'unconfirmed_bookings', 'low_stock', 'cold_leads', 'cash_shift'],
                        globalSignals: ['omni_account_alerts']
                    }
                };
                break;
            }

            case 'event_risk_summary': {
                data = await buildEventRiskSummary(req.user, businessScope);
                break;
            }

            case 'leads_new': {
                const leadParams = [];
                const leadBusinessCondition = appendDashboardBusinessScope(leadParams, businessScope, 'l');
                const result = await pool.query(`
                    SELECT l.id, l.client_name AS name, l.phone, l.source, l.status, l.created_at, COUNT(*) OVER()::int AS total_count
                    FROM leads l
                    WHERE COALESCE(l.pipeline_stage, 'new') = 'new'
                      AND ${SALES_LEAD_TYPE_FILTER}
                      ${leadBusinessCondition}
                    ORDER BY l.created_at DESC
                    LIMIT 8
                `, leadParams);
                data = {
                    leads: result.rows,
                    total: Number(result.rows[0]?.total_count || 0),
                    label: 'Ліди на етапі «Нові»',
                    href: `/sales-funnel?stage=new&businessContext=${encodeURIComponent(businessScope.activeContext)}`,
                    meta: {
                        businessScope: dashboardBusinessScopeMeta(businessScope),
                        scopedCounters: ['leads']
                    }
                };
                break;
            }

            case 'funnel': {
                const queue = await buildWorkQueue({
                    pool,
                    user: req.user,
                    limit: 1,
                    replyScope: 'all',
                    replySla: 'all',
                    replyOwner: 'all',
                    replyEscalation: 'all',
                    businessScope
                });
                const warnings = Array.isArray(queue?.meta?.warnings) ? queue.meta.warnings : [];
                const funnelWarnings = warnings.filter(warning => String(warning?.source || '') === 'leads_funnel_summary');
                data = {
                    meta: {
                        funnelInsights: queue?.meta?.funnelInsights || {},
                        warnings,
                        partial: funnelWarnings.length > 0 || warnings.some(warning => warning?.source === 'lead_followups'),
                        sourceStates: { funnel: funnelWarnings.length ? 'error' : 'ready', followUps: warnings.some(warning => warning?.source === 'lead_followups') ? 'error' : 'ready' },
                        // WorkQueue limits each SQL source independently; this is the earliest complete callback bucket, not a global preview.
                        followUps: queue?.buckets?.find(bucket => bucket.key === 'callback_due')?.items
                            || (queue?.items || []).filter(item => item.bucket === 'callback_due'),
                        sourceErrors: funnelWarnings
                    }
                };
                break;
            }

            case 'finance_today': {
                const finToday = getKyivDateStr();
                const meta = dashboardSourceMeta(businessScope);
                const revenueParams = [finToday];
                const revenueVisibility = getVisibleBookingScope(req.user, revenueParams, 'b');
                const revenueBusinessCondition = appendDashboardBusinessScope(revenueParams, businessScope, 'b');
                const bookingCountParams = [finToday];
                const bookingCountVisibility = getVisibleBookingScope(req.user, bookingCountParams, 'b');
                const bookingCountBusinessCondition = appendDashboardBusinessScope(bookingCountParams, businessScope, 'b');
                const expenseParams = [finToday];
                const expenseBusinessCondition = appendDashboardBusinessScope(expenseParams, businessScope, 'ft');
                const [revenue, expenses, bookingCount] = await Promise.all([
                    dashboardSource(meta, 'bookingValue', `SELECT COALESCE(SUM(b.price), 0) as total FROM bookings b WHERE b.date = $1 AND b.status = 'confirmed' ${revenueVisibility.sql} ${revenueBusinessCondition}`, revenueParams),
                    dashboardSource(meta, 'expenses', `SELECT COALESCE(SUM(ft.amount), 0) as total FROM finance_transactions ft WHERE ft.date = $1 AND ft.type = 'expense' ${expenseBusinessCondition}`, expenseParams),
                    dashboardSource(meta, 'bookings', `SELECT COUNT(*) as count FROM bookings b WHERE b.date = $1 AND b.status != 'cancelled' ${bookingCountVisibility.sql} ${bookingCountBusinessCondition}`, bookingCountParams)
                ]);
                data = { bookingValue: dashboardNumber(revenue, 'total'), revenue: dashboardNumber(revenue, 'total'),
                    expenses: dashboardNumber(expenses, 'total'), bookings: dashboardNumber(bookingCount, 'count'), profit: null,
                    date: finToday, meta: { ...meta, metricContracts: { revenue: 'compatibility alias for bookingValue: SUM confirmed bookings.price, not payments or profit',
                        expenses: 'SUM recorded expense transactions for selected date and business', profit: 'not calculated from booking prices' } } };
                break;
            }

            case 'announcements': {
                const result = await pool.query(`
                    SELECT id, title, text_content as content, priority, created_at, created_by as author_name
                    FROM announcements
                    WHERE status = 'active'
                    ORDER BY priority DESC, created_at DESC
                    LIMIT 5
                `);
                data = { announcements: result.rows };
                break;
            }

            case 'weather': {
                data = await getCachedData('weather', 1800, fetchWeather);
                break;
            }

            case 'currency': {
                data = await getCachedData('currency', 3600, fetchCurrency);
                break;
            }

            case 'reports_today': {
                const repToday = getKyivDateStr();
                const meta = dashboardSourceMeta(businessScope);
                const params = [repToday];
                const businessCondition = appendDashboardBusinessScope(params, businessScope, 'r');
                const [repIncome, repExpense, repNew] = await Promise.all([
                    dashboardSource(meta, 'income', `SELECT COALESCE(SUM(r.amount), 0) as total FROM reports r WHERE (r.created_at AT TIME ZONE 'Europe/Kyiv')::date = $1::date AND r.type = 'income' ${businessCondition}`, params),
                    dashboardSource(meta, 'expense', `SELECT COALESCE(SUM(r.amount), 0) as total FROM reports r WHERE (r.created_at AT TIME ZONE 'Europe/Kyiv')::date = $1::date AND r.type = 'expense' ${businessCondition}`, params),
                    dashboardSource(meta, 'newCount', `SELECT COUNT(*) as count FROM reports r WHERE (r.created_at AT TIME ZONE 'Europe/Kyiv')::date = $1::date AND r.status = 'new' ${businessCondition}`, params)
                ]);
                data = { income: dashboardNumber(repIncome, 'total'), expense: dashboardNumber(repExpense, 'total'),
                    newCount: dashboardNumber(repNew, 'count'), date: repToday, meta };
                break;
            }

            case 'exceptions': {
                const excToday = getKyivDateStr();
                const meta = dashboardSourceMeta(businessScope);
                const cleaningParams = [];
                const cleaningVisibility = getVisibleBookingScope(req.user, cleaningParams, 'b');
                const cleaningScope = appendDashboardBusinessScope(cleaningParams, businessScope, 'b');
                const exceptionPrepParams = [];
                const exceptionPrepVisibility = buildTaskVisibilityScope(req.user, exceptionPrepParams, 't');
                const exceptionPrepBusinessCondition = appendDashboardBusinessScope(exceptionPrepParams, businessScope, 't');
                const exceptionPrepBookingVisibility = getVisibleBookingScope(req.user, exceptionPrepParams, 'b');
                const exceptionPrepBookingVisibilityBusiness = appendDashboardBusinessScope(exceptionPrepParams, businessScope, 'b');
                const noAnimatorParams = [excToday];
                const noAnimatorVisibility = getVisibleBookingScope(req.user, noAnimatorParams, 'b');
                const noAnimatorVisibilityBusiness = appendDashboardBusinessScope(noAnimatorParams, businessScope, 'b');
                const lateUnconfirmedParams = [excToday];
                const lateUnconfirmedVisibility = getVisibleBookingScope(req.user, lateUnconfirmedParams, 'b');
                const lateUnconfirmedVisibilityBusiness = appendDashboardBusinessScope(lateUnconfirmedParams, businessScope, 'b');
                const detractorParams = [];
                const detractorBookingVisibility = getVisibleBookingScope(req.user, detractorParams, 'b');
                const detractorBookingVisibilityBusiness = appendDashboardBusinessScope(detractorParams, businessScope, 'b');
                const [conflictsQ, noAnimatorQ, overduePrep, detractors, cleaningSLA, unconfirmedLate] = await Promise.all([
                    dashboardRoomConflicts(req.user, businessScope, excToday, meta),
                    // Bookings without assigned animator
                    dashboardSource(meta, 'noAnimator', `
                        SELECT b.id, b.label, b.time, b.program_name, b.room, COUNT(*) OVER()::int AS total_count
                        FROM bookings b
                        WHERE b.date = $1 AND b.status != 'cancelled'
                          AND ${BOOKING_LINE_UNASSIGNED_SQL}
                          ${noAnimatorVisibility.sql} ${noAnimatorVisibilityBusiness}
                        ORDER BY b.time LIMIT 5
                    `, noAnimatorParams),
                    // Overdue booking-linked prep tasks only; category-only event tasks are not per-booking readiness truth.
                    dashboardSource(meta, 'overduePrep', `
                        SELECT t.id, t.title, t.deadline, t.source_id AS booking_id, COUNT(*) OVER()::int AS total_count
                        FROM tasks t
                        JOIN bookings b ON t.source_type = 'booking' AND t.source_id = b.id::text
                        WHERE ${taskKpiCanonicalOverdueSql('t')}
                          AND COALESCE(b.status, 'confirmed') <> 'cancelled'
                          ${exceptionPrepVisibility}
                          ${exceptionPrepBusinessCondition}
                          ${exceptionPrepBookingVisibility.sql} ${exceptionPrepBookingVisibilityBusiness}
                        ORDER BY t.deadline ASC LIMIT 5
                    `, exceptionPrepParams),
                    // Recent NPS detractors (rating 1-2, last 7 days, no follow-up)
                    dashboardSource(meta, 'detractors', `
                        SELECT er.id, er.booking_id, er.rating, er.comment, er.customer_name, er.created_at, COUNT(*) OVER()::int AS total_count
                        FROM event_reviews er
                        JOIN bookings b ON b.id = er.booking_id
                        WHERE er.rating <= 2 AND er.created_at > NOW() - INTERVAL '7 days'
                          AND (er.follow_up_status IS NULL OR er.follow_up_status = 'none')
                          ${detractorBookingVisibility.sql} ${detractorBookingVisibilityBusiness}
                        ORDER BY er.created_at DESC LIMIT 5
                    `, detractorParams),
                    // Cleaning SLA breaches
                    dashboardSource(meta, 'cleaningSLA', `
                        SELECT ct.id, ct.booking_id, ct.room, ct.scheduled_at, ct.sla_minutes, COUNT(*) OVER()::int AS total_count FROM cleaning_tasks ct
                        JOIN bookings b ON b.id = ct.booking_id
                        WHERE ct.status = 'pending' AND COALESCE(b.status, 'confirmed') <> 'cancelled'
                          AND ct.scheduled_at < NOW() - (ct.sla_minutes || ' minutes')::interval
                          ${cleaningVisibility.sql} ${cleaningScope}
                        ORDER BY ct.scheduled_at ASC LIMIT 5
                    `, cleaningParams),
                    // Unconfirmed bookings close to start (< 2 hours)
                    dashboardSource(meta, 'unconfirmedLate', `
                        SELECT b.id, b.label, b.time, b.room, COUNT(*) OVER()::int AS total_count FROM bookings b
                        WHERE b.date = $1 AND b.status = 'preliminary'
                          ${lateUnconfirmedVisibility.sql} ${lateUnconfirmedVisibilityBusiness}
                          AND (${SAFE_BOOKING_START_MINUTES_SQL})
                              - EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int * 60
                              - EXTRACT(MINUTE FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int
                              BETWEEN 0 AND 120
                        ORDER BY b.time LIMIT 5
                    `, lateUnconfirmedParams)
                ]);

                const exceptions = [];

                conflictsQ.rows.forEach(c => {
                    exceptions.push({
                        id: `conflict_${c.booking1}_${c.booking2}`, type: 'conflict', level: 'critical', icon: '💥',
                        title: `Конфлікт кімнати ${c.room}: ${(c.time1 || '').slice(0,5)} vs ${(c.time2 || '').slice(0,5)}`,
                        link: dashboardEventSummaryHref(c.booking1, businessScope), bookingIds: [c.booking1, c.booking2], date: excToday, action: { label: 'Вирішити', prompt: `Конфлікт: бронювання ${c.booking1} і ${c.booking2} в кімнаті ${c.room}` }
                    });
                });
                noAnimatorQ.rows.forEach(b => {
                    exceptions.push({
                        id: `no_animator_${b.id}`, type: 'no_animator', level: 'warning', icon: '🎭',
                        title: `Без аніматора: ${(b.time || '').slice(0,5)} ${b.label || b.program_name}`,
                        link: dashboardEventSummaryHref(b.id, businessScope), date: excToday, action: { label: 'Призначити', prompt: `Бронювання ${b.id} без аніматора` }
                    });
                });
                overduePrep.rows.forEach(t => {
                    exceptions.push({
                        id: `prep_overdue_${t.id}`, type: 'prep_overdue', level: 'warning', icon: '⏰',
                        title: `Прострочена підготовка: ${(t.title || '').slice(0,40)}`,
                        link: `/tasks?taskId=${encodeURIComponent(t.id)}&businessContext=${encodeURIComponent(businessScope.activeContext)}`, action: { label: 'Виконати', prompt: `Задача підготовки ${t.id} прострочена` }
                    });
                });
                detractors.rows.forEach(r => {
                    exceptions.push({
                        id: `detractor_${r.id}`, type: 'detractor', level: 'warning', icon: '😞',
                        title: `Незадоволений: ${r.customer_name || 'Клієнт'} (${r.rating}/5)`,
                        link: '/customers', action: { label: 'Зателефонувати', prompt: `Клієнт ${r.customer_name} поставив ${r.rating}/5. Коментар: ${r.comment}` }
                    });
                });
                cleaningSLA.rows.forEach(c => {
                    exceptions.push({
                        id: `cleaning_sla_${c.id}`, type: 'cleaning_sla', level: 'info', icon: '🧹',
                        title: `Прибирання прострочено: ${c.room}`,
                        link: dashboardEventSummaryHref(c.booking_id, businessScope), action: { label: 'Перевірити', prompt: `Прибирання кімнати ${c.room} перевищило SLA ${c.sla_minutes} хв` }
                    });
                });
                unconfirmedLate.rows.forEach(b => {
                    exceptions.push({
                        id: `late_unconfirmed_${b.id}`, type: 'late_unconfirmed', level: 'critical', icon: '🔴',
                        title: `Не підтверджено за <2год: ${(b.time || '').slice(0,5)} ${b.label || ''}`,
                        link: dashboardEventSummaryHref(b.id, businessScope), date: excToday, action: { label: 'Підтвердити', prompt: `Бронювання ${b.id} не підтверджене, початок менш ніж за 2 години!` }
                    });
                });

                data = {
                    exceptions,
                    count: meta.partial ? null : [conflictsQ, noAnimatorQ, overduePrep, detractors, cleaningSLA, unconfirmedLate].reduce((total, result) => total + Number(result.rows[0]?.total_count || 0), 0),
                    meta: { ...meta, cleaningSource: 'booking-linked cleaning tasks with visible active booking' },
                    categories: {
                        conflicts: conflictsQ.unavailable ? null : Number(conflictsQ.rows[0]?.total_count || 0),
                        noAnimator: noAnimatorQ.unavailable ? null : Number(noAnimatorQ.rows[0]?.total_count || 0),
                        overduePrep: overduePrep.unavailable ? null : Number(overduePrep.rows[0]?.total_count || 0),
                        detractors: detractors.unavailable ? null : Number(detractors.rows[0]?.total_count || 0),
                        cleaningSLA: cleaningSLA.unavailable ? null : Number(cleaningSLA.rows[0]?.total_count || 0),
                        unconfirmedLate: unconfirmedLate.unavailable ? null : Number(unconfirmedLate.rows[0]?.total_count || 0)
                    }
                };
                break;
            }

            case 'catalogs': {
                const { available, code, message } = legacyBusinessSurfaceAccess(req, 'catalogs');
                const legacyCatalogs = { available, code, message };
                if (!available) {
                    data = { definitions: [], recentItems: [], legacyCatalogs };
                    break;
                }
                const [catDefs, catItems] = await Promise.all([
                    pool.query("SELECT cd.id, cd.name, cd.emoji, COUNT(ci.id)::int AS count FROM catalog_definitions cd LEFT JOIN catalog_items ci ON ci.catalog_id = cd.id AND ci.status = 'active' WHERE cd.is_active = true GROUP BY cd.id, cd.name, cd.emoji, cd.sort_order ORDER BY cd.sort_order"),
                    pool.query("SELECT ci.id, ci.name, ci.price, ci.image_url, ci.catalog_id, cd.name AS catalog_name, cd.emoji AS catalog_emoji FROM catalog_items ci JOIN catalog_definitions cd ON cd.id = ci.catalog_id WHERE ci.status = 'active' ORDER BY ci.created_at DESC LIMIT 5"),
                ]);
                data = { definitions: catDefs.rows, recentItems: catItems.rows, legacyCatalogs };
                break;
            }

            case 'account_stats': {
                const meta = dashboardSourceMeta(businessScope);
                const staffAccess = legacyBusinessSurfaceAccess(req, 'staff');
                if (!staffAccess.available) {
                    dashboardUnavailableSource(meta, 'staffAccounts', staffAccess);
                    data = { total_staff: null, with_account: null, without_account: null, freelance_slots: null, meta };
                    break;
                }
                const stats = await dashboardSource(meta, 'staffAccounts', `
                    SELECT
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false)) as total_staff,
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false) AND ep.user_id IS NOT NULL) as with_account,
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false) AND ep.user_id IS NULL) as without_account,
                        COUNT(*) FILTER (WHERE s.is_active AND COALESCE(s.is_freelance, false)) as freelance_slots
                    FROM staff s
                    LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                `);
                data = { total_staff: dashboardNumber(stats, 'total_staff'), with_account: dashboardNumber(stats, 'with_account'),
                    without_account: dashboardNumber(stats, 'without_account'), freelance_slots: dashboardNumber(stats, 'freelance_slots'), meta };
                break;
            }

            // v39.10: Staff on shift today
            case 'staff_today': {
                const today = getKyivDateStr();
                const yesterdayDate = new Date(`${today}T12:00:00Z`);
                yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
                const yesterday = yesterdayDate.toISOString().slice(0, 10);
                const shiftParams = [today, yesterday];
                const shiftScope = appendDashboardBusinessScope(shiftParams, businessScope, 'ss');
                const absenceParams = [today];
                const absenceScope = appendDashboardBusinessScope(absenceParams, businessScope, 'ss');
                const result = await pool.query(`
                    SELECT DISTINCT ON (s.id) s.id, s.name, s.department, s.position, s.color,
                           ss.shift_start, ss.shift_end, ss.status,
                           COALESCE((
                               SELECT jsonb_agg(jsonb_build_object(
                                   'id', hss.id,
                                   'segmentId', hss.id,
                                   'professionKey', hss.profession_key,
                                   'start', LEFT(hss.planned_start::text, 5),
                                   'end', LEFT(hss.planned_end::text, 5)
                               ) ORDER BY hss.sort_order, hss.planned_start, hss.id)
                               FROM hr_shifts hs_all
                               JOIN hr_shift_segments hss ON hss.hr_shift_id = hs_all.id
                               WHERE hs_all.staff_id = ss.staff_id AND hs_all.shift_date = ss.date::date
                           ), '[]'::jsonb) AS segments,
                           CASE WHEN u.last_seen_at > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online
                    FROM staff_schedule ss
                    JOIN staff s ON s.id = ss.staff_id
                    LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                    LEFT JOIN users u ON u.id = ep.user_id
                    WHERE ss.date::date IN ($1::date, $2::date) AND s.is_active = true AND ss.status IN ('working', 'remote') ${shiftScope}
                      AND EXISTS (
                          SELECT 1
                          FROM hr_shifts hs_now
                          JOIN hr_shift_segments hss_now ON hss_now.hr_shift_id = hs_now.id
                          WHERE hs_now.staff_id = ss.staff_id
                            AND hs_now.shift_date = ss.date::date
                            AND (
                                (ss.date::date = $1::date
                                 AND hss_now.planned_end > hss_now.planned_start
                                 AND (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Kyiv')::time >= hss_now.planned_start
                                 AND (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Kyiv')::time < hss_now.planned_end)
                                OR
                                (ss.date::date = $1::date
                                 AND hss_now.planned_end <= hss_now.planned_start
                                 AND (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Kyiv')::time >= hss_now.planned_start)
                                OR
                                (ss.date::date = $2::date
                                 AND hss_now.planned_end <= hss_now.planned_start
                                 AND (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Kyiv')::time < hss_now.planned_end)
                            )
                      )
                    ORDER BY s.id, ss.shift_start, s.department, s.name
                `, shiftParams);
                const absent = await pool.query(`
                    SELECT s.name, ss.status FROM staff_schedule ss
                    JOIN staff s ON s.id = ss.staff_id
                    WHERE ss.date = $1 AND s.is_active = true AND ss.status IN ('sick', 'vacation') ${absenceScope}
                    ORDER BY s.name
                `, absenceParams);
                data = { onShift: result.rows, absent: absent.rows, date: today };
                break;
            }

            // v39.10: Bookings this week (7 days)
            case 'week_bookings': {
                const today = getKyivDateStr();
                const to = addDays(today, 6);
                const params = [today, to];
                const bookingVisibility = getVisibleBookingScope(req.user, params, 'b');
                const bookingBusinessCondition = appendDashboardBusinessScope(params, businessScope, 'b');
                const result = await pool.query(`
                    SELECT b.date, COUNT(*)::int AS count,
                           COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
                           COUNT(*) FILTER (WHERE b.status = 'preliminary')::int AS pending,
                           COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS revenue
                    FROM bookings b
                    WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                      AND b.linked_to IS NULL AND b.status != 'cancelled'
                      ${bookingVisibility.sql} ${bookingBusinessCondition}
                    GROUP BY b.date ORDER BY b.date
                `, params);
                data = { days: result.rows, from: today, to, meta: { visibleScopeOnly: true, scopeSource: bookingVisibility.scopeSource } };
                break;
            }

            // v39.10: Team tasks (for managers — all team's tasks)
            case 'team_tasks': {
                const params = [];
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const taskBusinessCondition = appendDashboardBusinessScope(params, businessScope, 't');
                const result = await pool.query(`
                    SELECT t.id, t.title, t.assigned_to, t.owner, t.owner_user_id,
                           u.name AS owner_name, u.username AS owner_username,
                           t.status, t.priority, t.deadline, t.updated_at, t.created_at,
                           ${dashboardTaskTimingSelect('t')},
                           ${TASK_WIDGET_SUBTASK_SELECT}
                    FROM tasks t
                    LEFT JOIN users u ON u.id = t.owner_user_id
                    ${TASK_WIDGET_SUBTASK_JOINS}
                    WHERE ${dashboardActionableTaskSql('t')}
                    ${visibility}
                    ${taskBusinessCondition}
                    ORDER BY
                        CASE WHEN ${taskKpiCanonicalOverdueSql('t')} THEN 0 ELSE 1 END,
                        CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                        t.deadline ASC NULLS LAST
                    LIMIT 15
                `, params);
                const statsParams = [];
                const statsVisibility = buildTaskVisibilityScope(req.user, statsParams, 't');
                const statsBusinessCondition = appendDashboardBusinessScope(statsParams, businessScope, 't');
                const stats = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE t.status = 'todo')::int AS todo,
                        COUNT(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
                        COUNT(*) FILTER (WHERE ${taskKpiCanonicalOverdueSql('t')})::int AS overdue
                    FROM tasks t
                    WHERE ${dashboardActionableTaskSql('t')} ${statsVisibility} ${statsBusinessCondition}
                `, statsParams);
                const tasks = taskWidgetPayload(result.rows).map(row => dashboardFocusTask(row, getKyivDateStr()));
                data = { tasks, stats: stats.rows[0], intelligence: buildTaskOperationsSummary(tasks) };
                break;
            }

            // v39.10: HR widget — absences, leaves, birthdays, contracts
            case 'hr_overview': {
                const today = getKyivDateStr();
                const weekStr = addDays(today, 7);
                const meta = dashboardSourceMeta(businessScope);
                const staffAccess = legacyBusinessSurfaceAccess(req, 'staff');
                const absenceParams = [today];
                const absenceScope = appendDashboardBusinessScope(absenceParams, businessScope, 'ss');
                const [absences, pendingLeaves, birthdays, expiring] = await Promise.all([
                    dashboardSource(meta, 'absent', `SELECT s.name, ss.status FROM staff_schedule ss JOIN staff s ON s.id = ss.staff_id
                        WHERE ss.date = $1 AND ss.status IN ('sick','vacation') AND s.is_active = true ${absenceScope} ORDER BY s.name`, absenceParams),
                    staffAccess.available ? dashboardSource(meta, 'pendingLeaves', `SELECT lr.id, s.name, lr.type, lr.date_from, lr.date_to FROM leave_requests lr
                        JOIN staff s ON s.id = lr.staff_id WHERE lr.status = 'pending' ORDER BY lr.created_at DESC LIMIT 5`) : dashboardUnavailableSource(meta, 'pendingLeaves', staffAccess),
                    staffAccess.available ? dashboardSource(meta, 'birthdays', `SELECT name, birth_date FROM staff WHERE is_active = true AND birth_date IS NOT NULL
                        AND to_char(birth_date::date, 'MM-DD') IN (
                            SELECT to_char(day, 'MM-DD') FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS day
                        ) ORDER BY to_char(birth_date::date, 'MM-DD'), name`, [today, weekStr]) : dashboardUnavailableSource(meta, 'birthdays', staffAccess),
                    Promise.resolve({ rows: [] })
                ]);
                data = {
                    absent: absences.rows,
                    pendingLeaves: pendingLeaves.rows,
                    birthdays: birthdays.rows,
                    contractsExpiring: expiring.rows, meta: { ...meta, contractsExpiryAvailable: false }
                };
                break;
            }

            // v39.10: Director P&L widget
            case 'director_pnl': {
                const today = getKyivDateStr();
                const ws = dashboardWeekStart(today);
                const monthStart = today.slice(0, 7) + '-01';
                const meta = dashboardSourceMeta(businessScope);
                async function period(from, key) {
                    const params = [from, today];
                    const visibility = getVisibleBookingScope(req.user, params, 'b');
                    const businessCondition = appendDashboardBusinessScope(params, businessScope, 'b');
                    const expenseParams = [from, today];
                    const expenseBusinessCondition = appendDashboardBusinessScope(expenseParams, businessScope, 'ft');
                    const [bookings, expenses] = await Promise.all([
                        dashboardSource(meta, `${key}BookingValue`, `SELECT COALESCE(SUM(b.price),0) AS total FROM bookings b WHERE b.date::date BETWEEN $1::date AND $2::date AND b.status = 'confirmed' AND b.linked_to IS NULL ${visibility.sql} ${businessCondition}`, params),
                        dashboardSource(meta, `${key}Expenses`, `SELECT COALESCE(SUM(ft.amount),0) AS total FROM finance_transactions ft WHERE ft.date::date BETWEEN $1::date AND $2::date AND ft.type = 'expense' ${expenseBusinessCondition}`, expenseParams)
                    ]);
                    return { from, to: today, bookingValue: dashboardNumber(bookings, 'total'), revenue: dashboardNumber(bookings, 'total'),
                        expenses: dashboardNumber(expenses, 'total'), profit: null };
                }
                const [week, month] = await Promise.all([period(ws, 'week'), period(monthStart, 'month')]);
                data = { week, month, staffCount: null, dailyStaffCost: null,
                    meta: { ...meta, metricContracts: { revenue: 'compatibility alias for confirmed parent booking prices; not payments',
                        expenses: 'recorded expense transactions', profit: 'not calculated; booking prices do not establish accounting profit' } } };
                break;
            }

            // v39.10: Art director content pipeline
            case 'content_pipeline': {
                const { available, code, message } = legacyBusinessSurfaceAccess(req, 'catalogs');
                const legacyCatalogs = { available, code, message };
                const artAccess = legacyBusinessSurfaceAccess(req, 'art');
                const meta = dashboardSourceMeta(businessScope);
                const designTaskParams = [];
                const designVisibility = buildTaskVisibilityScope(req.user, designTaskParams, 'tasks');
                const designTaskBusinessCondition = appendDashboardBusinessScope(designTaskParams, businessScope, 'tasks');
                const [inReview, approved, tasks, catalogs] = await Promise.all([
                    artAccess.available ? dashboardSource(meta, 'inReview', `SELECT id, title, status FROM art_director_content WHERE status = 'in_review' ORDER BY created_at DESC LIMIT 5`) : dashboardUnavailableSource(meta, 'inReview', artAccess),
                    artAccess.available ? dashboardSource(meta, 'approvedThisWeek', `SELECT COUNT(*)::int AS c FROM art_director_content WHERE status = 'approved' AND created_at > NOW() - INTERVAL '7 days'`) : dashboardUnavailableSource(meta, 'approvedThisWeek', artAccess),
                    dashboardSource(meta, 'designTasks', `SELECT id, title, priority FROM tasks WHERE category = 'improvement' AND ${dashboardActionableTaskSql('tasks')} ${designVisibility} ${designTaskBusinessCondition} ORDER BY priority DESC, deadline ASC LIMIT 3`, designTaskParams),
                    available ? dashboardSource(meta, 'catalogs', `SELECT id, name, emoji, status FROM catalog_definitions WHERE is_active = true ORDER BY name`)
                        : dashboardUnavailableSource(meta, 'catalogs', legacyCatalogs)
                ]);
                data = {
                    inReview: inReview.rows,
                    approvedThisWeek: dashboardNumber(approved, 'c'),
                    designTasks: tasks.rows,
                    catalogs: catalogs.rows,
                    legacyCatalogs, meta
                };
                break;
            }

            // v40.5: Task health widget
            case 'task_health': {
                const params = [];
                const visibility = buildTaskVisibilityScope(req.user, params, 't');
                const taskBusinessCondition = appendDashboardBusinessScope(params, businessScope, 't');
                const stats = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE ${taskKpiMachineSignalSql('t')} AND t.health_score > 70 AND ${taskKpiActiveWorkSql('t')})::int AS healthy,
                        COUNT(*) FILTER (WHERE ${taskKpiMachineSignalSql('t')} AND t.health_score BETWEEN 41 AND 70 AND ${taskKpiActiveWorkSql('t')})::int AS warning,
                        COUNT(*) FILTER (WHERE ${taskKpiMachineSignalSql('t')} AND t.health_score BETWEEN 1 AND 40 AND ${taskKpiActiveWorkSql('t')})::int AS critical,
                        COUNT(*) FILTER (WHERE ${taskKpiMachineSignalSql('t')} AND t.status = 'archived')::int AS archived,
                        COALESCE(AVG(t.health_score) FILTER (WHERE ${taskKpiMachineSignalSql('t')} AND ${taskKpiActiveWorkSql('t')}), 0)::int AS avg_score,
                        'automation_hygiene' AS metric_scope
                    FROM tasks t
                    WHERE 1=1 ${visibility} ${taskBusinessCondition}
                `, params);
                data = stats.rows[0];
                break;
            }

            // v39.10: Vice director operations overview
            case 'operations': {
                const today = getKyivDateStr();
                const meta = dashboardSourceMeta(businessScope);
                const activityParams = [today];
                const activityScope = appendDashboardBusinessScope(activityParams, businessScope, 'ss');
                const procurementAccess = legacyBusinessSurfaceAccess(req, 'contractors_procurement');
                const reviewParams = [];
                const reviewVisibility = getVisibleBookingScope(req.user, reviewParams, 'b');
                const reviewScope = appendDashboardBusinessScope(reviewParams, businessScope, 'b');
                const complaintParams = [];
                const complaintBusinessCondition = appendDashboardBusinessScope(complaintParams, businessScope, 'l');
                const [procurement, complaints, quality, staffGaps] = await Promise.all([
                    procurementAccess.available ? dashboardSource(meta, 'procurement', `SELECT id, name, status FROM procurement_lists WHERE status IN ('draft','ordered') ORDER BY created_at DESC LIMIT 3`) : dashboardUnavailableSource(meta, 'procurement', procurementAccess),
                    dashboardSource(meta, 'complaintsWeek', `SELECT COUNT(*)::int AS c FROM leads l WHERE l.status = 'new' AND l.source = 'complaint' AND l.created_at > NOW() - INTERVAL '7 days' ${complaintBusinessCondition}`, complaintParams),
                    dashboardSource(meta, 'quality', `SELECT AVG(er.rating)::numeric(3,1) AS avg_rating, COUNT(*)::int AS count FROM event_reviews er JOIN bookings b ON b.id = er.booking_id WHERE er.created_at > NOW() - INTERVAL '30 days' ${reviewVisibility.sql} ${reviewScope}`, reviewParams),
                    dashboardSource(meta, 'staffActivity', `SELECT COUNT(*)::int AS gaps FROM staff_schedule ss
                        JOIN staff s ON s.id = ss.staff_id
                        JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                        JOIN users u ON u.id = ep.user_id
                        WHERE ss.date = $1 AND ss.status = 'working' AND s.is_active = true ${activityScope}
                        AND (u.last_seen_at IS NULL OR u.last_seen_at < NOW() - INTERVAL '30 minutes')`, activityParams)
                ]);
                data = {
                    procurement: procurement.rows,
                    complaintsWeek: dashboardNumber(complaints, 'c'),
                    quality: quality.unavailable ? { avg_rating: null, count: null } : { avg_rating: Number(quality.rows[0]?.count || 0) > 0 ? Number(quality.rows[0].avg_rating) : null, count: Number(quality.rows[0]?.count || 0) },
                    staffNotCheckedIn: dashboardNumber(staffGaps, 'gaps'),
                    staffInactiveInCrm: dashboardNumber(staffGaps, 'gaps'),
                    meta: { ...meta, metricContracts: { staffInactiveInCrm: 'scheduled working staff with no CRM activity in 30 minutes; not attendance', quality: 'booking-linked review ratings in last 30 days; null when no ratings' } }
                };
                break;
            }

            default:
                return res.status(400).json({ error: 'Unknown widget type' });
        }

        res.json({ success: true, data });
    } catch (err) {
        log.error(`Widget data error (${req.params.type})`, err);
        res.status(500).json({ error: 'Failed to load widget data' });
    }
});

// GET /api/dashboard/roles — role definitions for test panel
router.get('/roles', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT role_key, name_uk, department, level FROM role_definitions WHERE is_active = true ORDER BY level DESC'
        );
        res.json({ success: true, roles: result.rows });
    } catch (err) {
        log.error('Failed to get roles', err);
        res.status(500).json({ error: 'Failed to load roles' });
    }
});

// GET /api/dashboard/today — aggregate "today" data for quick overview
router.get('/today', shapeDashboardRevenue, async (req, res) => {
    try {
        const businessScope = dashboardBusinessScope(req, res);
        if (!businessScope) return;
        const today = getKyivDateStr();
        const taskParams = [];
        const taskVisibility = buildTaskVisibilityScope(req.user, taskParams, 't');
        const ownTaskFilter = buildOwnTaskFilter(req.user, taskParams, 't');
        const taskBusinessCondition = appendDashboardBusinessScope(taskParams, businessScope, 't');
        const bookingCountParams = [today];
        const bookingCountVisibility = getVisibleBookingScope(req.user, bookingCountParams, 'b');
        const bookingCountBusinessCondition = appendDashboardBusinessScope(bookingCountParams, businessScope, 'b');
        const revenueParams = [today];
        const revenueVisibility = getVisibleBookingScope(req.user, revenueParams, 'b');
        const revenueBusinessCondition = appendDashboardBusinessScope(revenueParams, businessScope, 'b');
        const newLeadParams = [];
        const newLeadBusinessCondition = appendDashboardBusinessScope(newLeadParams, businessScope, 'l');

        const [bookings, tasks, revenue, teamOnline, newLeads] = await Promise.all([
            pool.query(`SELECT COUNT(*) as count FROM bookings b WHERE b.date = $1 AND b.status != 'cancelled' ${bookingCountVisibility.sql} ${bookingCountBusinessCondition}`, bookingCountParams),
            pool.query(`SELECT COUNT(*) as count
                        FROM tasks t
                        WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'cancelled', 'archived')
                        ${taskVisibility}
                        ${ownTaskFilter}
                        ${taskBusinessCondition}`, taskParams),
            pool.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM bookings b WHERE b.date = $1 AND b.status = 'confirmed' ${revenueVisibility.sql} ${revenueBusinessCondition}`, revenueParams),
            pool.query("SELECT COUNT(*) as count FROM users u LEFT JOIN employee_profiles ep ON ep.user_id = u.id WHERE u.is_active = true AND ep.last_activity_at > NOW() - INTERVAL '5 minutes'"),
            pool.query(`SELECT COUNT(*) as count FROM leads l WHERE COALESCE(l.pipeline_stage, 'new') = 'new' AND ${SALES_LEAD_TYPE_FILTER} ${newLeadBusinessCondition}`, newLeadParams),
        ]);

        res.json({
            success: true,
            data: {
                date: today,
                bookingsToday: parseInt(bookings.rows[0].count),
                myActiveTasks: parseInt(tasks.rows[0].count),
                revenueToday: parseFloat(revenue.rows[0].total),
                teamOnline: parseInt(teamOnline.rows[0].count),
                newLeads: parseInt(newLeads.rows[0].count),
                meta: {
                    businessScope: dashboardBusinessScopeMeta(businessScope),
                    scopedCounters: ['bookingsToday', 'myActiveTasks', 'revenueToday', 'newLeads'],
                    globalCounters: ['teamOnline']
                }
            }
        });
    } catch (err) {
        log.error('Dashboard /today error', err);
        res.status(500).json({ error: 'Failed to load today data' });
    }
});

// --- Cache helpers ---
async function getCachedData(key, ttlSeconds, fetchFn) {
    try {
        const cached = await pool.query(
            'SELECT data FROM dashboard_cache WHERE cache_key = $1 AND expires_at > NOW()',
            [key]
        );
        if (cached.rows.length > 0) {
            return cached.rows[0].data;
        }

        const freshData = await fetchFn();
        await pool.query(`
            INSERT INTO dashboard_cache (cache_key, data, expires_at)
            VALUES ($1, $2, NOW() + make_interval(secs => $3))
            ON CONFLICT (cache_key)
            DO UPDATE SET data = $2, expires_at = NOW() + make_interval(secs => $3)
        `, [key, JSON.stringify(freshData), ttlSeconds]);

        return freshData;
    } catch (err) {
        log.error(`Cache error for ${key}`, err);
        return {};
    }
}

async function fetchWeather() {
    try {
        // Kyiv weather via Open-Meteo (free, no API key)
        const resp = await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current=temperature_2m,weather_code,wind_speed_10m&timezone=Europe/Kyiv');
        if (!resp.ok) return { error: 'Weather API unavailable' };
        const data = await resp.json();
        const current = data.current || {};
        return {
            temperature: current.temperature_2m,
            weatherCode: current.weather_code ?? current.weathercode,
            windSpeed: current.wind_speed_10m ?? current.windspeed_10m,
            city: 'Київ',
            updatedAt: current.time || null
        };
    } catch {
        return { error: 'Weather fetch failed' };
    }
}

async function fetchCurrency() {
    try {
        // NBU currency rates
        const resp = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
        if (!resp.ok) return { error: 'Currency API unavailable' };
        const data = await resp.json();
        const rows = Array.isArray(data) ? data : [];
        const wanted = ['USD', 'EUR', 'GBP', 'PLN', 'CZK'];
        const rates = wanted.reduce((acc, code) => {
            const row = rows.find(c => c.cc === code);
            if (row && Number.isFinite(Number(row.rate))) acc[code] = Number(row.rate);
            return acc;
        }, {});
        return {
            usd: rates.USD || null,
            eur: rates.EUR || null,
            rates,
            base: 'UAH',
            date: rows.find(c => c.cc === 'USD')?.exchangedate || null
        };
    } catch {
        return { error: 'Currency fetch failed' };
    }
}

// GET /api/dashboard/alerts — standalone endpoint for alert bell
router.get('/alerts', async (req, res) => {
    try {
        const businessScope = dashboardBusinessScope(req, res);
        if (!businessScope) return;
        const today = getKyivDateStr();
        const overdueParams = [];
        const overdueVisibility = buildTaskVisibilityScope(req.user, overdueParams, 't');
        const overdueBusinessCondition = appendDashboardBusinessScope(overdueParams, businessScope, 't');
        const unconfirmedParams = [today];
        const unconfirmedVisibility = getVisibleBookingScope(req.user, unconfirmedParams, 'b');
        const unconfirmedBusinessCondition = appendDashboardBusinessScope(unconfirmedParams, businessScope, 'b');
        const lowStockParams = [];
        const lowStockBusinessCondition = appendDashboardBusinessScope(lowStockParams, businessScope, 'ws');
        const coldLeadParams = [];
        const coldLeadBusinessCondition = appendDashboardBusinessScope(coldLeadParams, businessScope, 'l');
        const shiftParams = [today];
        const shiftVisibility = getVisibleBookingScope(req.user, shiftParams, 'b');
        const openShiftBusinessCondition = appendDashboardBusinessScope(shiftParams, businessScope, 'cs');
        const shiftBookingBusinessCondition = appendDashboardBusinessScope(shiftParams, businessScope, 'b');
        const [urgentAlerts, overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
            buildUrgentTaskAlerts(req.user, businessScope, 5),
            pool.query(`SELECT t.id, t.title, t.deadline, t.priority, t.status, t.owner_user_id,
                               t.assigned_to, t.owner, t.updated_at, t.created_at,
                               u.name AS owner_name, u.username AS owner_username
                        FROM tasks t
                        LEFT JOIN users u ON u.id = t.owner_user_id
                        WHERE t.deadline < NOW()
                          AND COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
                          ${overdueVisibility}
                          ${overdueBusinessCondition}
                        ORDER BY t.deadline ASC
                        LIMIT 5`, overdueParams),
            pool.query(`SELECT b.id, b.label, b.time FROM bookings b WHERE b.date = $1 AND b.status = 'preliminary' ${unconfirmedVisibility.sql} ${unconfirmedBusinessCondition} ORDER BY b.time LIMIT 5`, unconfirmedParams),
            pool.query(`SELECT ws.name, ws.quantity, ws.min_quantity, ws.unit FROM warehouse_stock ws WHERE ws.quantity <= ws.min_quantity AND ws.is_active = true ${lowStockBusinessCondition} LIMIT 3`, lowStockParams),
            pool.query(`SELECT COUNT(*) as c FROM leads l WHERE COALESCE(l.pipeline_stage, 'new') = 'new' AND ${SALES_LEAD_TYPE_FILTER} AND l.created_at < NOW() - INTERVAL '48 hours' ${coldLeadBusinessCondition}`, coldLeadParams),
            pool.query(`SELECT (SELECT COUNT(*) FROM cash_register_shifts cs WHERE cs.status='open' ${openShiftBusinessCondition}) AS open_shifts,
                               (SELECT COUNT(*) FROM bookings b WHERE b.date=$1 AND b.status='confirmed' ${shiftVisibility.sql} ${shiftBookingBusinessCondition}) AS today_bk`, shiftParams)
        ]);
        const alerts = [];
        alerts.push(...urgentAlerts);
        overdue.rows.forEach(t => {
            const task = taskWidgetPayload([t])[0] || t;
            alerts.push({ id: `overdue_${t.id}`, level: 'warning', icon: '⚠️',
                title: `Прострочена: "${(t.title || '').slice(0, 40)}"`,
                link: `/tasks?open=${t.id}`, taskId: t.id,
                owner: task.ownerLabel || null,
                ownerState: task.ownerState || 'unassigned',
                intelligence: task.intelligence || null,
                action: { label: '📋 Відкрити задачу', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
            });
        });
        unconfirmed.rows.forEach(b => {
            alerts.push({ id: `unconfirmed_${b.id}`, level: 'info', icon: '📋',
                title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`,
                link: `/?date=${today}&highlight=${b.id}`, bookingId: b.id,
                action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
            });
        });
        lowStock.rows.forEach((s, i) => {
            alerts.push({ id: `stock_${s.name}_${s.quantity}`, level: 'warning', icon: '📦',
                title: `Мало: ${s.name} (${s.quantity} ${s.unit})`,
                link: '/warehouse#procurement', stockItem: s.name,
                action: { label: '📋 Замовити', prompt: `Замовити ${s.name} (залишок: ${s.quantity}/${s.min_quantity} ${s.unit})`, assignRole: 'manager' }
            });
        });
        const cl = parseInt(coldLeads.rows[0].c);
        if (cl > 0) {
            alerts.push({ id: 'cold_leads', level: 'warning', icon: '🥶',
                title: `${cl} лідів без відповіді >48год`, link: '/sales-funnel',
                action: { label: '📋 Обдзвін', prompt: `${cl} лідів без відповіді >48год. Обдзвонити.`, assignRole: 'manager' }
            });
        }
        const os = parseInt(shiftCheck.rows[0].open_shifts);
        const tb = parseInt(shiftCheck.rows[0].today_bk);
        if (os === 0 && tb > 0) {
            alerts.push({ id: 'no_shift', level: 'critical', icon: '🔴',
                title: `Каса не відкрита! (${tb} броні)`, link: '/finance',
                action: { label: '💰 Відкрити касу', prompt: 'Каса не відкрита — відкрити.', assignRole: 'admin' }
            });
        }
        alerts.push(...await getOmniAccountAlertsAsync());
        res.json({
            success: true,
            alerts,
            count: alerts.length,
            meta: {
                businessScope: dashboardBusinessScopeMeta(businessScope),
                scopedSignals: ['urgent_tasks', 'overdue_tasks', 'unconfirmed_bookings', 'low_stock', 'cold_leads', 'cash_shift'],
                globalSignals: ['omni_account_alerts']
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// v39.7.0 — WebSocket alert push: broadcast alerts to all connected users periodically
let _alertBroadcastTimer = null;
let _alertBroadcastInitialTimer = null;
let _alertBroadcastIntervalMs = null;
let _lastAlertHash = '';

async function broadcastAlerts() {
    try {
        const { broadcast } = require('../services/websocket');
        const today = getKyivDateStr();
        const [overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
            // Task alerts are object-visible, so the global websocket broadcast must not leak task titles.
            Promise.resolve({ rows: [] }),
            // Booking alerts are object-visible; global websocket broadcast cannot apply per-user booking scope.
            Promise.resolve({ rows: [] }),
            // Stock alerts are business-scoped in /api/dashboard/alerts; the global websocket broadcast cannot apply per-user business scope.
            Promise.resolve({ rows: [] }),
            // Lead alerts are business-scoped in /api/dashboard/alerts; the global broadcast must not mix business contexts.
            Promise.resolve({ rows: [{ c: 0 }] }),
            // Cash alerts are business-scoped in /api/dashboard/alerts; avoid broadcasting cross-business finance state globally.
            Promise.resolve({ rows: [{ open_shifts: 0, today_bk: 0 }] })
        ]);
        const alerts = [];
        overdue.rows.forEach(t => {
            alerts.push({ id: `overdue_${t.id}`, level: 'warning', icon: '⚠️',
                title: `Прострочена: "${(t.title || '').slice(0, 40)}"`,
                link: `/tasks?open=${t.id}`, taskId: t.id,
                action: { label: '📋 Відкрити задачу', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
            });
        });
        unconfirmed.rows.forEach(b => {
            alerts.push({ id: `unconfirmed_${b.id}`, level: 'info', icon: '📋',
                title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`,
                link: `/?date=${today}&highlight=${b.id}`, bookingId: b.id,
                action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
            });
        });
        lowStock.rows.forEach(s => {
            alerts.push({ id: `stock_${s.name}_${s.quantity}`, level: 'warning', icon: '📦',
                title: `Мало: ${s.name} (${s.quantity} ${s.unit})`,
                link: '/warehouse#procurement', stockItem: s.name,
                action: { label: '📋 Замовити', prompt: `Замовити ${s.name} (залишок: ${s.quantity}/${s.min_quantity} ${s.unit})`, assignRole: 'manager' }
            });
        });
        const cl = parseInt(coldLeads.rows[0].c);
        if (cl > 0) {
            alerts.push({ id: 'cold_leads', level: 'warning', icon: '🥶',
                title: `${cl} лідів без відповіді >48год`, link: '/sales-funnel',
                action: { label: '📋 Обдзвін', prompt: `${cl} лідів без відповіді >48год. Обдзвонити.`, assignRole: 'manager' }
            });
        }
        const os = parseInt(shiftCheck.rows[0].open_shifts);
        const tb = parseInt(shiftCheck.rows[0].today_bk);
        if (os === 0 && tb > 0) {
            alerts.push({ id: 'no_shift', level: 'critical', icon: '🔴',
                title: `Каса не відкрита! (${tb} броні)`, link: '/finance',
                action: { label: '💰 Відкрити касу', prompt: 'Каса не відкрита — відкрити.', assignRole: 'admin' }
            });
        }

        // Only broadcast if alerts changed
        const hash = JSON.stringify(alerts.map(a => a.id).sort());
        if (hash !== _lastAlertHash) {
            broadcast('alert:updated', { alerts, count: alerts.length });
            _lastAlertHash = hash;
        }
    } catch (err) {
        log.warn('Alert broadcast error:', err.message);
    }
}

function startAlertBroadcaster(intervalMs = 60000) {
    if (_alertBroadcastTimer) {
        return {
            started: false,
            skipped: true,
            reason: 'already_started',
            intervalMs: _alertBroadcastIntervalMs
        };
    }

    _alertBroadcastIntervalMs = intervalMs;
    _alertBroadcastTimer = setInterval(broadcastAlerts, intervalMs);
    // Initial broadcast after 5s delay
    _alertBroadcastInitialTimer = setTimeout(broadcastAlerts, 5000);
    return { started: true, intervalMs };
}

function stopAlertBroadcaster() {
    if (_alertBroadcastTimer) clearInterval(_alertBroadcastTimer);
    if (_alertBroadcastInitialTimer) clearTimeout(_alertBroadcastInitialTimer);
    _alertBroadcastTimer = null;
    _alertBroadcastInitialTimer = null;
    _alertBroadcastIntervalMs = null;
}

function resetAlertBroadcasterForTest() {
    stopAlertBroadcaster();
    if (triggerAlertBroadcast._timer) clearTimeout(triggerAlertBroadcast._timer);
    triggerAlertBroadcast._timer = null;
    _lastAlertHash = '';
}

function alertBroadcasterState() {
    return {
        started: Boolean(_alertBroadcastTimer),
        hasInitialTimer: Boolean(_alertBroadcastInitialTimer),
        intervalMs: _alertBroadcastIntervalMs,
        lastAlertHash: _lastAlertHash
    };
}

function triggerAlertBroadcast() {
    // Debounce: wait 2s to batch rapid changes
    if (triggerAlertBroadcast._timer) clearTimeout(triggerAlertBroadcast._timer);
    triggerAlertBroadcast._timer = setTimeout(broadcastAlerts, 2000);
}

module.exports = router;
module.exports.startAlertBroadcaster = startAlertBroadcaster;
module.exports.triggerAlertBroadcast = triggerAlertBroadcast;
module.exports.__boardTest = {
    alertBroadcasterState,
    buildPersistedDashboardConfig,
    buildEventRiskSummary,
    broadcastAlerts,
    dashboardActiveBookingStatusSql,
    dashboardKyivClock,
    dashboardKyivDateOffset,
    dashboardWeekStart,
    dashboardFocusTask,
    loadNearestEventWidgetData,
    normalizeNearestEventPayload,
    normalizeDashboardConfig,
    persistenceContract: DASHBOARD_CONFIG_PERSISTENCE,
    resetAlertBroadcasterForTest,
    sanitizeBoardState,
    stopAlertBroadcaster
};
