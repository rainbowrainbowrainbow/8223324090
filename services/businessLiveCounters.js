'use strict';

const { getKyivDateStr } = require('./booking');
const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext,
    normalizeBusinessContextList,
    pushBusinessScopeCondition
} = require('./businessContext');
const { buildTaskVisibilityScope } = require('./taskPolicy');
const { getVisibleBookingScope } = require('./bookingVisibility');
const { TASK_ACTION_TYPES } = require('./taskActionHistory');

const QUALITY_LEAD_FILTER = "COALESCE(l.lead_type, 'quality') = 'quality'";
const NEW_LEAD_FILTER = "COALESCE(l.pipeline_stage, 'new') = 'new'";
const ACTIVE_TASK_FILTER = "COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')";

const URGENT_TASK_MOVEMENT_ACTION_TYPES = Object.freeze([
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
]);

function toCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function emptyCounters() {
    return {
        leads: { new: 0, hot: 0 },
        tasks: { active: 0, overdue: 0 },
        alerts: { active: 0 }
    };
}

function cloneEmptyCounters() {
    return JSON.parse(JSON.stringify(emptyCounters()));
}

function selectedBusinessContexts(scope = {}) {
    return normalizeBusinessContextList(
        scope.selectedContexts?.length ? scope.selectedContexts : [scope.activeContext || DEFAULT_BUSINESS_CONTEXT],
        [DEFAULT_BUSINESS_CONTEXT]
    );
}

function businessScopeMeta(scope = {}) {
    const selectedContexts = selectedBusinessContexts(scope);
    return {
        mode: scope.mode || 'single',
        activeContext: normalizeBusinessContext(scope.activeContext || selectedContexts[0]),
        selectedContexts,
        readOnly: scope.readOnly === true,
        canWrite: scope.canWrite !== false
    };
}

function initByBusiness(contexts) {
    return contexts.reduce((acc, context) => {
        acc[context] = cloneEmptyCounters();
        return acc;
    }, {});
}

function rowBusinessContext(row = {}) {
    return normalizeBusinessContext(row.business_context || row.businessContext || DEFAULT_BUSINESS_CONTEXT);
}

function applyRows(byBusiness, rows, applyRow) {
    for (const row of rows || []) {
        const context = rowBusinessContext(row);
        if (!byBusiness[context]) continue;
        applyRow(byBusiness[context], row);
    }
}

function sumCounters(byBusiness = {}) {
    const total = cloneEmptyCounters();
    for (const counters of Object.values(byBusiness)) {
        total.leads.new += toCount(counters.leads?.new);
        total.leads.hot += toCount(counters.leads?.hot);
        total.tasks.active += toCount(counters.tasks?.active);
        total.tasks.overdue += toCount(counters.tasks?.overdue);
        total.alerts.active += toCount(counters.alerts?.active);
    }
    return total;
}

async function loadLeadCounters(pool, scope) {
    const params = [];
    const businessCondition = pushBusinessScopeCondition(params, scope, 'l');
    return pool.query(
        `SELECT COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                COUNT(*) FILTER (
                    WHERE ${NEW_LEAD_FILTER}
                      AND ${QUALITY_LEAD_FILTER}
                )::int AS new_count,
                COUNT(*) FILTER (
                    WHERE ${NEW_LEAD_FILTER}
                      AND ${QUALITY_LEAD_FILTER}
                      AND l.created_at < NOW() - INTERVAL '24 hours'
                )::int AS hot_count
         FROM leads l
         WHERE ${businessCondition}
         GROUP BY COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}')`,
        params
    );
}

async function loadTaskCounters(pool, user, scope) {
    const params = [];
    const visibility = buildTaskVisibilityScope(user, params, 't');
    const businessCondition = pushBusinessScopeCondition(params, scope, 't');
    return pool.query(
        `SELECT COALESCE(t.business_context, '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                COUNT(*) FILTER (
                    WHERE ${ACTIVE_TASK_FILTER}
                )::int AS active_count,
                COUNT(*) FILTER (
                    WHERE ${ACTIVE_TASK_FILTER}
                      AND t.deadline < NOW()
                )::int AS overdue_count
         FROM tasks t
         WHERE ${businessCondition}
           ${visibility}
         GROUP BY COALESCE(t.business_context, '${DEFAULT_BUSINESS_CONTEXT}')`,
        params
    );
}

async function loadUrgentTaskAlertCounters(pool, user, scope) {
    const params = [];
    const visibility = buildTaskVisibilityScope(user, params, 't');
    const movementParam = params.push(URGENT_TASK_MOVEMENT_ACTION_TYPES);
    const businessCondition = pushBusinessScopeCondition(params, scope, 't');
    return pool.query(
        `SELECT COALESCE(t.business_context, '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                COUNT(*)::int AS urgent_count
         FROM tasks t
         WHERE t.priority = 'urgent'
           AND ${ACTIVE_TASK_FILTER}
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
           AND ${businessCondition}
           ${visibility}
         GROUP BY COALESCE(t.business_context, '${DEFAULT_BUSINESS_CONTEXT}')`,
        params
    );
}

async function loadUnconfirmedBookingAlertCounters(pool, user, scope, today = getKyivDateStr()) {
    const params = [today];
    const visibility = getVisibleBookingScope(user, params, 'b');
    const businessCondition = pushBusinessScopeCondition(params, scope, 'b');
    return pool.query(
        `SELECT COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                COUNT(*)::int AS unconfirmed_count
         FROM bookings b
         WHERE b.date = $1
           AND b.status = 'preliminary'
           ${visibility.sql}
           AND ${businessCondition}
         GROUP BY COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}')`,
        params
    );
}

async function loadLowStockAlertCounters(pool, scope) {
    const params = [];
    const businessCondition = pushBusinessScopeCondition(params, scope, 'ws');
    return pool.query(
        `SELECT COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                COUNT(*)::int AS low_stock_count
         FROM warehouse_stock ws
         WHERE ws.quantity <= ws.min_quantity
           AND ws.is_active = true
           AND ${businessCondition}
         GROUP BY COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}')`,
        params
    );
}

async function loadOpenCashShiftCounters(pool, scope) {
    const params = [];
    const businessCondition = pushBusinessScopeCondition(params, scope, 'cs');
    return pool.query(
        `SELECT COALESCE(cs.business_context, '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                COUNT(*)::int AS open_shift_count
         FROM cash_register_shifts cs
         WHERE cs.status = 'open'
           AND ${businessCondition}
         GROUP BY COALESCE(cs.business_context, '${DEFAULT_BUSINESS_CONTEXT}')`,
        params
    );
}

async function loadTodayConfirmedBookingCounters(pool, user, scope, today = getKyivDateStr()) {
    const params = [today];
    const visibility = getVisibleBookingScope(user, params, 'b');
    const businessCondition = pushBusinessScopeCondition(params, scope, 'b');
    return pool.query(
        `SELECT COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                COUNT(*)::int AS today_booking_count
         FROM bookings b
         WHERE b.date = $1
           AND b.status = 'confirmed'
           ${visibility.sql}
           AND ${businessCondition}
         GROUP BY COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}')`,
        params
    );
}

async function loadColdLeadAlertCounters(pool, scope) {
    const params = [];
    const businessCondition = pushBusinessScopeCondition(params, scope, 'l');
    return pool.query(
        `SELECT COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                COUNT(*)::int AS cold_count
         FROM leads l
         WHERE ${NEW_LEAD_FILTER}
           AND ${QUALITY_LEAD_FILTER}
           AND l.created_at < NOW() - INTERVAL '48 hours'
           AND ${businessCondition}
         GROUP BY COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}')`,
        params
    );
}

function countMap(rows, columnName) {
    const map = new Map();
    for (const row of rows || []) {
        map.set(rowBusinessContext(row), toCount(row[columnName]));
    }
    return map;
}

async function buildBusinessLiveCounters(pool, user, scope) {
    const scopeMeta = businessScopeMeta(scope);
    const byBusiness = initByBusiness(scopeMeta.selectedContexts);
    const today = getKyivDateStr();

    const [
        leadCounters,
        taskCounters,
        urgentTaskAlerts,
        unconfirmedBookingAlerts,
        lowStockAlerts,
        openCashShifts,
        todayConfirmedBookings,
        coldLeadAlerts
    ] = await Promise.all([
        loadLeadCounters(pool, scope),
        loadTaskCounters(pool, user, scope),
        loadUrgentTaskAlertCounters(pool, user, scope),
        loadUnconfirmedBookingAlertCounters(pool, user, scope, today),
        loadLowStockAlertCounters(pool, scope),
        loadOpenCashShiftCounters(pool, scope),
        loadTodayConfirmedBookingCounters(pool, user, scope, today),
        loadColdLeadAlertCounters(pool, scope)
    ]);

    applyRows(byBusiness, leadCounters.rows, (counters, row) => {
        counters.leads.new = toCount(row.new_count);
        counters.leads.hot = toCount(row.hot_count);
    });

    applyRows(byBusiness, taskCounters.rows, (counters, row) => {
        counters.tasks.active = toCount(row.active_count);
        counters.tasks.overdue = toCount(row.overdue_count);
        counters.alerts.active += toCount(row.overdue_count);
    });

    applyRows(byBusiness, urgentTaskAlerts.rows, (counters, row) => {
        counters.alerts.active += toCount(row.urgent_count);
    });

    applyRows(byBusiness, unconfirmedBookingAlerts.rows, (counters, row) => {
        counters.alerts.active += toCount(row.unconfirmed_count);
    });

    applyRows(byBusiness, lowStockAlerts.rows, (counters, row) => {
        counters.alerts.active += toCount(row.low_stock_count);
    });

    applyRows(byBusiness, coldLeadAlerts.rows, (counters, row) => {
        counters.alerts.active += toCount(row.cold_count) > 0 ? 1 : 0;
    });

    const openShiftCounts = countMap(openCashShifts.rows, 'open_shift_count');
    const todayBookingCounts = countMap(todayConfirmedBookings.rows, 'today_booking_count');
    for (const context of scopeMeta.selectedContexts) {
        if (toCount(todayBookingCounts.get(context)) > 0 && toCount(openShiftCounts.get(context)) === 0) {
            byBusiness[context].alerts.active += 1;
        }
    }

    return {
        success: true,
        scope: scopeMeta,
        counters: {
            total: sumCounters(byBusiness),
            byBusiness
        }
    };
}

module.exports = {
    URGENT_TASK_MOVEMENT_ACTION_TYPES,
    buildBusinessLiveCounters,
    businessScopeMeta,
    selectedBusinessContexts
};
