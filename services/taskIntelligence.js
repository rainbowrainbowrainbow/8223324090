'use strict';

const { taskOwnerState } = require('./taskPolicy');

const TASK_PRIORITY_BANDS = Object.freeze({
    CRITICAL: 'critical',
    ACTION_TODAY: 'action_today',
    WATCH: 'watch',
    SUGGESTED: 'suggested'
});

const TASK_INTELLIGENCE_MODEL = 'task_operations_local_intelligence_v1';

function dateOnly(value) {
    if (!value) return null;
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dueTimestamp(task = {}) {
    return task.dueAt || task.deadline || task.date || null;
}

function isActiveTask(task = {}) {
    return !['done', 'cancelled', 'archived'].includes(String(task.status || 'todo'));
}

function ownerUserId(task = {}) {
    const parsed = Number(task.owner_user_id || task.ownerUserId || task.meta?.ownerUserId || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function ownerLabel(task = {}) {
    return task.owner_label
        || task.ownerName
        || task.owner_name
        || task.ownerUsername
        || task.owner_username
        || task.meta?.assignedTo
        || task.assigned_to
        || task.owner
        || null;
}

function priorityValue(task = {}) {
    const raw = String(task.priority || 'normal').toLowerCase();
    if (raw === 'medium') return 'normal';
    return ['critical', 'high', 'normal', 'low'].includes(raw) ? raw : 'normal';
}

function daysBetween(a, b) {
    const left = dateOnly(a);
    const right = dateOnly(b);
    if (!left || !right) return null;
    const ms = new Date(`${right}T00:00:00Z`).getTime() - new Date(`${left}T00:00:00Z`).getTime();
    return Math.floor(ms / 86400000);
}

function action(type, label, href = null) {
    return { type, label, href, bucketScoped: true };
}

function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function deriveTaskIntelligence(task = {}, options = {}) {
    const today = options.today || dateOnly(new Date());
    const due = dateOnly(dueTimestamp(task));
    const ownerState = task.ownerState || task.meta?.ownerState || taskOwnerState(task);
    const hasTypedOwner = Boolean(ownerUserId(task));
    const priority = priorityValue(task);
    const isOverdue = isActiveTask(task) && Boolean(due && today && due < today);
    const dueToday = isActiveTask(task) && Boolean(due && today && due === today);
    const lastMovedAt = task.updated_at || task.updatedAt || task.created_at || task.createdAt || null;
    const stagnantDays = daysBetween(lastMovedAt, today);
    const staleInProgress = String(task.status || '') === 'in_progress' && stagnantDays !== null && stagnantDays >= 3;

    let priorityBand = TASK_PRIORITY_BANDS.SUGGESTED;
    const riskTypes = [];
    const why = [];
    let recommendedAction = action('open_task', 'Open task context', task.href || null);
    let confidence = 'medium';

    if (!hasTypedOwner) {
        riskTypes.push(ownerState === 'unassigned' ? 'missing_owner' : 'legacy_unknown_owner');
        why.push(ownerState === 'unassigned'
            ? 'tasks.owner_user_id is empty and no legacy owner label is present.'
            : 'tasks.owner_user_id is empty; legacy owner text exists but is not canonical identity.');
    } else {
        why.push(`Task owner is typed through tasks.owner_user_id=${ownerUserId(task)}.`);
        confidence = 'high';
    }

    if (isOverdue) {
        riskTypes.push('task_overdue');
        why.push(`Task deadline/date is before today (${due}).`);
        priorityBand = TASK_PRIORITY_BANDS.ACTION_TODAY;
        recommendedAction = hasTypedOwner
            ? action('complete_or_reassign', 'Complete or reassign task', task.href || null)
            : action('assign_owner', 'Assign owner before execution', task.href || null);
    } else if (dueToday) {
        riskTypes.push('deadline_today');
        why.push(`Task deadline/date is today (${due}).`);
        priorityBand = TASK_PRIORITY_BANDS.ACTION_TODAY;
        recommendedAction = hasTypedOwner
            ? action('start_or_reschedule', 'Start or reschedule task', task.href || null)
            : action('assign_owner', 'Assign owner', task.href || null);
    } else if (due) {
        riskTypes.push('future_deadline');
        why.push(`Task deadline/date is future-visible (${due}).`);
        priorityBand = TASK_PRIORITY_BANDS.WATCH;
        recommendedAction = action('review_task_plan', 'Review task plan', task.href || null);
    } else {
        riskTypes.push('missing_deadline');
        why.push('No tasks.deadline/tasks.date is present, so urgency stays suggested.');
    }

    if (priority === 'critical' || priority === 'high') {
        riskTypes.push(priority === 'critical' ? 'critical_priority' : 'overdue_high_priority');
        why.push(`Task priority is ${priority}.`);
        if (isOverdue && !hasTypedOwner) priorityBand = TASK_PRIORITY_BANDS.CRITICAL;
        else if (isOverdue) priorityBand = TASK_PRIORITY_BANDS.ACTION_TODAY;
    }

    if (isOverdue && !hasTypedOwner) {
        riskTypes.push('overdue_unassigned');
        priorityBand = TASK_PRIORITY_BANDS.CRITICAL;
        recommendedAction = action('assign_owner', 'Assign owner now', task.href || null);
    }

    if (staleInProgress) {
        riskTypes.push('stale_in_progress');
        why.push(`Task has been in progress/stale for about ${stagnantDays} days based on updated_at/created_at.`);
        if (priorityBand === TASK_PRIORITY_BANDS.SUGGESTED) priorityBand = TASK_PRIORITY_BANDS.WATCH;
        recommendedAction = action('inspect_blockage', 'Inspect blockage', task.href || null);
    }

    return {
        model: TASK_INTELLIGENCE_MODEL,
        globalScore: false,
        priorityBand,
        riskTypes: unique(riskTypes),
        recommendedAction,
        why,
        confidence,
        depth: 'task_local',
        ownerState,
        sourceFields: unique([
            'tasks.owner_user_id',
            'tasks.status',
            'tasks.priority',
            task.deadline || task.dueAt ? 'tasks.deadline' : null,
            task.date ? 'tasks.date' : null,
            staleInProgress ? 'tasks.updated_at' : null
        ])
    };
}

function buildTaskOperationsSummary(tasks = []) {
    const byOwner = new Map();
    let overdue = 0;
    let overdueUnassigned = 0;
    let missingOwner = 0;
    let staleInProgress = 0;

    for (const task of tasks) {
        const intelligence = task.intelligence || deriveTaskIntelligence(task);
        const risks = new Set(intelligence.riskTypes || []);
        if (risks.has('task_overdue')) overdue += 1;
        if (risks.has('overdue_unassigned')) overdueUnassigned += 1;
        if (risks.has('missing_owner') || risks.has('legacy_unknown_owner')) missingOwner += 1;
        if (risks.has('stale_in_progress')) staleInProgress += 1;

        const id = ownerUserId(task);
        if (id && risks.has('task_overdue')) {
            const key = String(id);
            const entry = byOwner.get(key) || {
                ownerUserId: id,
                label: ownerLabel(task) || `User #${id}`,
                overdue: 0
            };
            entry.overdue += 1;
            byOwner.set(key, entry);
        }
    }

    return {
        model: TASK_INTELLIGENCE_MODEL,
        source: 'visible_task_items',
        visibleScopeOnly: true,
        hiddenDataScanned: false,
        overdue,
        overdueUnassigned,
        missingOwner,
        staleInProgress,
        overdueByOwner: Array.from(byOwner.values()).sort((a, b) => b.overdue - a.overdue || a.label.localeCompare(b.label))
    };
}

module.exports = {
    TASK_INTELLIGENCE_MODEL,
    TASK_PRIORITY_BANDS,
    buildTaskOperationsSummary,
    deriveTaskIntelligence
};
