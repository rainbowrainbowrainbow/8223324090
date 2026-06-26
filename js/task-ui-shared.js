/**
 * Shared task UI helpers for Tasks and Profile / My Day surfaces.
 * Keeps priority/status normalization and mutation failure shape in one place.
 */
(function taskUiSharedBootstrap(global) {
    'use strict';

    const TASK_PRIORITY_OPTIONS = Object.freeze([
        { value: 'urgent', label: 'Терміново', hint: 'Піднімає задачу вгору і створює нагадування без руху' },
        { value: 'high', label: 'Високий', hint: 'Вище звичайних задач' },
        { value: 'normal', label: 'Звичайний', hint: 'Стандартний пріоритет' },
        { value: 'low', label: 'Низький', hint: 'Можна виконати пізніше' }
    ]);
    const TASK_PRIORITY_VALUES = Object.freeze(TASK_PRIORITY_OPTIONS.map(item => item.value));
    const TASK_PRIORITY_RANK = Object.freeze({ urgent: 0, high: 1, normal: 2, low: 3 });
    const PRIORITY_ICONS = Object.freeze({ urgent: '🔥', high: '', normal: '', low: '' });

    const STATUS_LABELS = Object.freeze({
        todo: 'До виконання',
        in_progress: 'В роботі',
        done: 'Готово',
        waiting: 'Чекаю',
        scheduled: 'Заплановано',
        archived: 'Архів',
        cancelled: 'Скасовано'
    });
    const TASK_STATUS_VALUES = Object.freeze(Object.keys(STATUS_LABELS));

    function normalizeTaskPriority(priority = 'normal') {
        const value = String(priority || 'normal').trim().toLowerCase();
        if (value === 'critical') return 'urgent';
        if (value === 'medium') return 'normal';
        return TASK_PRIORITY_VALUES.includes(value) ? value : 'normal';
    }

    function taskPriorityLabel(priority = '') {
        const normalized = normalizeTaskPriority(priority);
        return TASK_PRIORITY_OPTIONS.find(item => item.value === normalized)?.label || 'Звичайний';
    }

    function taskPriorityRank(taskOrPriority = 'normal') {
        const priority = typeof taskOrPriority === 'object' && taskOrPriority
            ? taskOrPriority.priority || taskOrPriority.taskPriority || taskOrPriority.priority_level
            : taskOrPriority;
        const normalized = normalizeTaskPriority(priority);
        return TASK_PRIORITY_RANK[normalized] ?? TASK_PRIORITY_RANK.normal;
    }

    function normalizeTaskStatus(status = 'todo') {
        const value = String(status || 'todo').trim().toLowerCase();
        if (value === 'progress') return 'in_progress';
        if (value === 'complete' || value === 'completed') return 'done';
        return TASK_STATUS_VALUES.includes(value) ? value : 'todo';
    }

    function taskStatusLabel(status = 'todo') {
        return STATUS_LABELS[normalizeTaskStatus(status)] || STATUS_LABELS.todo;
    }

    function taskMutationFailure(payload = {}, response = null, fallback = 'Не вдалося оновити задачу') {
        const safePayload = payload instanceof Error
            ? { error: payload.message, offline: true, details: payload.message ? { message: payload.message } : null }
            : (payload || {});
        const formatted = global.CrmApiErrors?.format?.(safePayload, fallback);
        return {
            ...safePayload,
            success: false,
            error: formatted || safePayload.error || safePayload.message || fallback,
            offline: Boolean(safePayload.offline),
            status: response?.status || safePayload.status || null,
            requestId: safePayload.requestId || safePayload.request_id || null
        };
    }

    function taskOfflineFailure(error, fallback = 'Немає звʼязку з сервером. Перевірте інтернет і спробуйте ще раз.') {
        return {
            success: false,
            error: fallback,
            offline: true,
            status: null,
            requestId: null,
            details: error?.message ? { message: error.message } : null
        };
    }

    function normalizeTaskMutationResult(result, fallback = 'Не вдалося оновити задачу') {
        if (result?.success) return result;
        if (result && result.success === false) return taskMutationFailure(result, null, fallback);
        return taskOfflineFailure(null, fallback);
    }

    function applyPriorityClasses(element, priority = 'normal', options = {}) {
        if (!element) return normalizeTaskPriority(priority);
        const normalized = normalizeTaskPriority(priority);
        const priorityClassPrefix = options.priorityClassPrefix || '';
        const selectClassPrefix = options.selectClassPrefix || '';
        if (priorityClassPrefix) {
            TASK_PRIORITY_VALUES.forEach(value => element.classList.remove(`${priorityClassPrefix}${value}`));
            element.classList.add(`${priorityClassPrefix}${normalized}`);
        }
        if (selectClassPrefix) {
            TASK_PRIORITY_VALUES.forEach(value => element.classList.remove(`${selectClassPrefix}${value}`));
            element.classList.add(`${selectClassPrefix}${normalized}`);
        }
        if (options.dataAttribute) {
            element.dataset[options.dataAttribute] = normalized;
        }
        if ('value' in element) {
            element.value = normalized;
        }
        return normalized;
    }

    global.TaskUiShared = Object.freeze({
        TASK_PRIORITY_OPTIONS,
        TASK_PRIORITY_VALUES,
        TASK_PRIORITY_RANK,
        PRIORITY_ICONS,
        TASK_STATUS_VALUES,
        STATUS_LABELS,
        normalizeTaskPriority,
        taskPriorityLabel,
        taskPriorityRank,
        normalizeTaskStatus,
        taskStatusLabel,
        taskMutationFailure,
        taskOfflineFailure,
        normalizeTaskMutationResult,
        applyPriorityClasses
    });
})(window);
