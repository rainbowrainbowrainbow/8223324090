'use strict';

const {
    canManageTaskObservers,
    canMutateTask,
    canReassignTask,
    canRescheduleTask,
    taskRouteCapabilityDecision
} = require('./taskPolicy');

const SOURCE_LABELS = Object.freeze({
    booking: 'Бронювання',
    lead: 'Лід',
    customer: 'Клієнт',
    event: 'Подія',
    order: 'Замовлення',
    hr: 'HR',
    finance: 'Фінанси',
    automation: 'Автоматизація',
    manual: 'Створено вручну'
});

function sourceTypeOf(task = {}) {
    return String(task.sourceType || task.source_type || task.sourceEntityType || task.source_entity_type || '').trim().toLowerCase();
}

function sourceIdOf(task = {}) {
    const value = task.sourceId ?? task.source_id ?? task.sourceEntityId ?? task.source_entity_id ?? null;
    return value === null || value === undefined || value === '' ? null : String(value);
}

function safeSourceHref(type, id) {
    if (!id) return null;
    const encoded = encodeURIComponent(id);
    if (type === 'booking') return `/?open=${encoded}`;
    if (type === 'lead') return `/sales-funnel?open=${encoded}`;
    if (type === 'customer') return `/customers?open=${encoded}`;
    if (type === 'event') return `/afisha?open=${encoded}`;
    return null;
}

function taskSourceSummary(task = {}) {
    const type = sourceTypeOf(task);
    const id = sourceIdOf(task);
    const module = String(task.sourceModule || task.source_module || '').trim() || null;
    const surface = String(task.sourceSurface || task.source_surface || '').trim() || null;
    if (!type && !id && !module && !surface) return null;
    return {
        type: type || 'manual',
        label: SOURCE_LABELS[type] || module || type || 'Джерело задачі',
        id,
        module,
        surface,
        href: safeSourceHref(type, id)
    };
}

function isTerminalTask(task = {}) {
    return ['done', 'archived', 'cancelled'].includes(String(task.status || '').trim());
}

function taskDrawerActionContract(task = {}, user = {}) {
    const canEdit = canMutateTask(user, task);
    const terminal = isTerminalTask(task);
    const review = taskRouteCapabilityDecision(user, 'review');
    const remove = taskRouteCapabilityDecision(user, 'delete');
    const actions = {
        view: true,
        edit: canEdit,
        save: canEdit,
        complete: canEdit && !terminal,
        reassign: canReassignTask(user, task),
        reschedule: canRescheduleTask(user, task),
        manageObservers: canManageTaskObservers(user, task),
        manageSubtasks: canEdit,
        review: review.allowed && String(task.status || '').trim() === 'done',
        delete: remove.allowed,
        readHistory: true,
        openSource: Boolean(taskSourceSummary(task)?.href)
    };
    return {
        actions,
        reasons: {
            edit: canEdit ? null : 'TASK_MUTATION_FORBIDDEN',
            save: canEdit ? null : 'TASK_MUTATION_FORBIDDEN',
            complete: canEdit ? (terminal ? 'TASK_ALREADY_TERMINAL' : null) : 'TASK_MUTATION_FORBIDDEN',
            reassign: actions.reassign ? null : 'TASK_REASSIGN_FORBIDDEN',
            reschedule: actions.reschedule ? null : 'TASK_RESCHEDULE_FORBIDDEN',
            manageObservers: actions.manageObservers ? null : 'TASK_OBSERVERS_FORBIDDEN',
            manageSubtasks: canEdit ? null : 'TASK_MUTATION_FORBIDDEN',
            review: review.allowed ? (actions.review ? null : 'TASK_REVIEW_REQUIRES_DONE') : review.reasonCode,
            delete: remove.reasonCode
        }
    };
}

function taskDrawerActions(task = {}, user = {}) {
    return taskDrawerActionContract(task, user).actions;
}

function taskControlMeta(task = {}) {
    const value = task.controlMeta || task.control_meta || {};
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function withTaskDrawerContract(task = {}, user = {}) {
    const source = taskSourceSummary(task);
    const controlMeta = taskControlMeta(task);
    const actionContract = taskDrawerActionContract(task, user);
    return {
        ...task,
        drawer: {
            contract: 'task_drawer_v1',
            actions: actionContract.actions,
            actionReasons: actionContract.reasons,
            source,
            completion: {
                reportRequired: task.reportRequired === true || task.requiresReport === true || controlMeta.reportRequired === true || controlMeta.requiresReport === true,
                reportId: task.reportId || task.report_id || controlMeta.reportId || controlMeta.report_id || null
            }
        }
    };
}

module.exports = {
    SOURCE_LABELS,
    safeSourceHref,
    taskControlMeta,
    taskDrawerActionContract,
    taskDrawerActions,
    taskSourceSummary,
    withTaskDrawerContract
};
