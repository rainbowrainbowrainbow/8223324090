'use strict';

const { dateOnly, todayKyivDate } = require('./taskScheduling');
const { normalizeTaskPriority, normalizePostponementCount } = require('./taskPostponementPolicy');
const { taskCompletionReportId, taskControlMeta, taskRequiresCompletionReport } = require('./taskExecution');

const WAITING_STALE_DAYS = 3;
const STALE_DAYS = 7;
const REPEATED_POSTPONEMENT_COUNT = 2;
const QUEUE_LIMIT = 60;

const REASON_DEFINITIONS = Object.freeze({
    overdue: { label: 'Прострочено', recommendedAction: 'Перепланувати або виконати' },
    urgent: { label: 'Термінова', recommendedAction: 'Взяти в роботу зараз' },
    due_today: { label: 'Термін сьогодні', recommendedAction: 'Підтвердити план на сьогодні' },
    unassigned: { label: 'Без відповідального', recommendedAction: 'Призначити відповідального' },
    blocked: { label: 'Заблоковано залежністю', recommendedAction: 'Розблокувати залежність' },
    waiting_too_long: { label: 'Довго очікує', recommendedAction: 'Оновити статус очікування' },
    no_date: { label: 'Без дати', recommendedAction: 'Запланувати дату' },
    stale: { label: 'Без руху', recommendedAction: 'Оновити план або статус' },
    repeatedly_rescheduled: { label: 'Неодноразово перенесено', recommendedAction: 'Погодити реалістичний строк' },
    report_required: { label: 'Потрібен звіт', recommendedAction: 'Додати звіт перед завершенням' },
    review_required: { label: 'Потрібен review', recommendedAction: 'Провести review задачі' }
});

const REASON_PRIORITY = Object.freeze([
    'overdue', 'urgent', 'blocked', 'unassigned', 'waiting_too_long',
    'due_today', 'repeatedly_rescheduled', 'stale', 'report_required',
    'review_required', 'no_date'
]);

function taskDueDate(task = {}) {
    return dateOnly(
        task.scheduledStartAt || task.scheduled_start_at || task.snoozedUntil || task.snoozed_until
        || task.date || task.deadline || task.remindAt || task.remind_at
    );
}

function activeTask(task = {}) {
    return !['done', 'archived', 'cancelled'].includes(String(task.status || 'todo'));
}

function futureSnooze(task = {}, now = new Date()) {
    const raw = task.snoozedUntil || task.snoozed_until;
    const snoozedUntil = raw ? new Date(raw) : null;
    return Boolean(snoozedUntil && !Number.isNaN(snoozedUntil.getTime()) && snoozedUntil > now);
}

function calendarDayDifference(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    const from = new Date(`${fromDate}T12:00:00Z`);
    const to = new Date(`${toDate}T12:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function updatedDate(task = {}) {
    return dateOnly(task.updatedAt || task.updated_at || task.createdAt || task.created_at);
}

function hasOwner(task = {}) {
    return Boolean(task.ownerUserId || task.owner_user_id || task.ownerLabel || task.owner_name || task.assigned_to || task.owner);
}

function needsReview(task = {}) {
    const meta = taskControlMeta(task);
    return meta.reviewRequired === true || meta.requiresReview === true || meta.review_required === true || task.review_required === true;
}

function reason(code, riskDays = null) {
    const definition = REASON_DEFINITIONS[code];
    return {
        code,
        label: definition.label,
        recommendedAction: definition.recommendedAction,
        ...(Number.isFinite(riskDays) ? { riskDays: Math.max(0, riskDays) } : {})
    };
}

function classifyTaskExceptions(task = {}, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const today = options.today || todayKyivDate(now);
    if (!activeTask(task) || futureSnooze(task, now)) return [];

    const dueDate = taskDueDate(task);
    const updated = updatedDate(task);
    const inactivityDays = calendarDayDifference(updated, today);
    const overdueDays = dueDate && dueDate < today ? calendarDayDifference(dueDate, today) : null;
    const waiting = (task.workflowState || task.workflow_state) === 'waiting'
        || (task.taskKind || task.task_kind) === 'waiting';
    const openDependencies = Number(task.openDependencyCount ?? task.open_dependency_count ?? 0);
    const postponements = normalizePostponementCount(task.postponementCount ?? task.postponement_count);
    const reasons = [];

    if (Number.isFinite(overdueDays) && overdueDays > 0) reasons.push(reason('overdue', overdueDays));
    if (normalizeTaskPriority(task.priority) === 'urgent') reasons.push(reason('urgent'));
    if (dueDate === today) reasons.push(reason('due_today'));
    if (!hasOwner(task)) reasons.push(reason('unassigned'));
    if (openDependencies > 0) reasons.push(reason('blocked'));
    if (waiting && Number.isFinite(inactivityDays) && inactivityDays >= WAITING_STALE_DAYS) reasons.push(reason('waiting_too_long', inactivityDays));
    if (!dueDate) reasons.push(reason('no_date'));
    if (!waiting && Number.isFinite(inactivityDays) && inactivityDays >= STALE_DAYS) reasons.push(reason('stale', inactivityDays));
    if (postponements >= REPEATED_POSTPONEMENT_COUNT) reasons.push(reason('repeatedly_rescheduled', postponements));
    if (taskRequiresCompletionReport(task) && !taskCompletionReportId(task)) reasons.push(reason('report_required'));
    if (needsReview(task)) reasons.push(reason('review_required'));

    return reasons.sort((left, right) => REASON_PRIORITY.indexOf(left.code) - REASON_PRIORITY.indexOf(right.code));
}

function reasonRank(reasons = []) {
    return reasons.reduce((rank, item) => Math.min(rank, Math.max(0, REASON_PRIORITY.indexOf(item.code))), REASON_PRIORITY.length);
}

function compareOverviewItems(left, right) {
    const rank = reasonRank(left.reasons) - reasonRank(right.reasons);
    if (rank) return rank;
    const leftRisk = Math.max(0, ...left.reasons.map(item => Number(item.riskDays) || 0));
    const rightRisk = Math.max(0, ...right.reasons.map(item => Number(item.riskDays) || 0));
    if (rightRisk !== leftRisk) return rightRisk - leftRisk;
    const leftUpdated = Date.parse(left.task.updatedAt || left.task.updated_at || left.task.createdAt || left.task.created_at || 0) || 0;
    const rightUpdated = Date.parse(right.task.updatedAt || right.task.updated_at || right.task.createdAt || right.task.created_at || 0) || 0;
    if (leftUpdated !== rightUpdated) return leftUpdated - rightUpdated;
    return Number(left.task.id || 0) - Number(right.task.id || 0);
}

function buildTaskOverview(tasks = [], options = {}) {
    const counts = Object.fromEntries(Object.keys(REASON_DEFINITIONS).map(code => [code, 0]));
    const items = [];
    let activeTotal = 0;
    let deferredExcluded = 0;
    for (const task of tasks) {
        if (!activeTask(task)) continue;
        activeTotal += 1;
        if (futureSnooze(task, options.now)) {
            deferredExcluded += 1;
            continue;
        }
        const reasons = classifyTaskExceptions(task, options);
        reasons.forEach(item => { counts[item.code] += 1; });
        if (reasons.length) items.push({ task, reasons, recommendedAction: reasons[0].recommendedAction });
    }
    const queue = items.sort(compareOverviewItems);
    const limit = Math.max(1, Math.min(Number(options.queueLimit) || QUEUE_LIMIT, QUEUE_LIMIT));
    return {
        counts,
        queue: queue.slice(0, limit),
        meta: {
            activeTotal,
            exceptionTotal: queue.length,
            returned: Math.min(queue.length, limit),
            hasMore: queue.length > limit,
            deferredExcluded,
            queueLimit: limit,
            thresholds: {
                waitingStaleDays: WAITING_STALE_DAYS,
                staleDays: STALE_DAYS,
                repeatedPostponementCount: REPEATED_POSTPONEMENT_COUNT
            }
        }
    };
}

module.exports = {
    QUEUE_LIMIT,
    REASON_DEFINITIONS,
    REPEATED_POSTPONEMENT_COUNT,
    STALE_DAYS,
    WAITING_STALE_DAYS,
    buildTaskOverview,
    classifyTaskExceptions,
    compareOverviewItems,
    taskDueDate
};
