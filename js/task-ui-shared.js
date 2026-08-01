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

    const PRIVATE_HANDOFF_CONFIRM_CODE = 'TASK_PRIVATE_HANDOFF_CONFIRM_REQUIRED';

    function privateTaskHandoffFromResult(result = {}) {
        const handoff = result?.meta?.privateHandoff;
        if (result?.code !== PRIVATE_HANDOFF_CONFIRM_CODE
            || handoff?.confirmationRequired !== true
            || handoff?.actorWillLoseAccess !== true) {
            return null;
        }
        return handoff;
    }

    function privateTaskHandoffMessage(handoff = {}) {
        const nextOwner = String(handoff.nextOwner?.label || handoff.nextOwner?.name || handoff.nextOwner?.username || '')
            .trim() || '\u043d\u043e\u0432\u043e\u043c\u0443 \u0432\u0438\u043a\u043e\u043d\u0430\u0432\u0446\u044e';
        const privacyLabel = handoff.visibility === 'me_only'
            ? '\u043e\u0441\u043e\u0431\u0438\u0441\u0442\u0430'
            : '\u043f\u0440\u0438\u0432\u0430\u0442\u043d\u0430';
        return `\u0426\u044f ${privacyLabel} \u0437\u0430\u0434\u0430\u0447\u0430 \u0431\u0443\u0434\u0435 \u043f\u0435\u0440\u0435\u0434\u0430\u043d\u0430 ${nextOwner}. \u041f\u0456\u0441\u043b\u044f \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043d\u044f \u0432\u0438 \u0432\u0442\u0440\u0430\u0442\u0438\u0442\u0435 \u0434\u043e \u043d\u0435\u0457 \u0434\u043e\u0441\u0442\u0443\u043f.`;
    }

    async function executePrivateTaskHandoff(request, options = {}) {
        if (typeof request !== 'function') {
            return { success: false, error: 'Private handoff request is unavailable.' };
        }
        const firstResult = await request(false);
        const handoff = privateTaskHandoffFromResult(firstResult);
        if (!handoff) return firstResult;

        const confirm = options.confirm || global.confirmModal;
        if (typeof confirm !== 'function') {
            return { ...firstResult, confirmationUnavailable: true };
        }
        const confirmed = await confirm(privateTaskHandoffMessage(handoff), {
            type: 'warning',
            icon: '\ud83d\udd12',
            okText: '\u041f\u0435\u0440\u0435\u0434\u0430\u0442\u0438 \u0456 \u0432\u0442\u0440\u0430\u0442\u0438\u0442\u0438 \u0434\u043e\u0441\u0442\u0443\u043f',
            cancelText: '\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438'
        });
        if (!confirmed) return { ...firstResult, cancelled: true };
        return request(true);
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

    const TASK_WORKFLOW_VALUES = Object.freeze(['inbox', 'todo', 'in_progress', 'waiting', 'scheduled', 'done', 'archived']);

    function taskText(value) {
        if (value === undefined || value === null) return '';
        if (typeof value === 'object') return String(value.label || value.name || value.username || value.title || '').trim();
        return String(value).trim();
    }

    function taskToken(value, fallback = '') {
        const token = taskText(value).toLowerCase();
        return token || fallback;
    }

    function taskOwnerUserId(task = {}) {
        const value = Number(task.ownerUserId ?? task.owner_user_id ?? 0);
        return Number.isInteger(value) && value > 0 ? value : null;
    }

    function taskOwnerLabel(task = {}) {
        return taskText(
            task.ownerLabel ?? task.owner_label ?? task.ownerName ?? task.owner_name
            ?? task.ownerUsername ?? task.owner_username ?? task.assignedTo ?? task.assigned_to ?? task.owner
        ) || null;
    }

    function taskOwnerState(task = {}) {
        const explicit = taskToken(task.ownerState ?? task.owner_state);
        if (explicit === 'typed' || explicit === 'legacy_unknown_owner' || explicit === 'unassigned') return explicit;
        if (taskOwnerUserId(task)) return 'typed';
        return taskOwnerLabel(task) ? 'legacy_unknown_owner' : 'unassigned';
    }

    function taskMode(task = {}) {
        return taskToken(task.taskMode ?? task.task_mode ?? task.mode, 'work');
    }

    function taskKind(task = {}) {
        return taskToken(task.taskKind ?? task.task_kind ?? task.kind, 'action');
    }

    function taskVisibility(task = {}) {
        return taskToken(task.visibility, taskMode(task) === 'private' ? 'private' : 'team');
    }

    function taskStatus(task = {}) {
        return normalizeTaskStatus(task.status ?? task.taskStatus ?? task.task_status ?? 'todo');
    }

    function taskWorkflow(task = {}) {
        const explicit = taskToken(task.workflowState ?? task.workflow_state ?? task.workflow);
        if (TASK_WORKFLOW_VALUES.includes(explicit)) return explicit;
        const status = taskStatus(task);
        if (status === 'done') return 'done';
        if (status === 'archived') return 'archived';
        if (status === 'in_progress') return 'in_progress';
        return 'todo';
    }

    function taskScheduledStart(task = {}) {
        return task.scheduledStartAt || task.scheduled_start_at || task.schedule?.scheduledStartAt || task.schedule?.startAt || null;
    }

    function taskScheduledEnd(task = {}) {
        return task.scheduledEndAt || task.scheduled_end_at || task.schedule?.scheduledEndAt || task.schedule?.endAt || null;
    }

    function taskSnoozedUntil(task = {}) {
        return task.snoozedUntil || task.snoozed_until || null;
    }

    function taskDueValue(task = {}) {
        return taskScheduledStart(task)
            || taskSnoozedUntil(task)
            || task.date
            || task.deadline
            || task.remindAt
            || task.remind_at
            || null;
    }

    function taskDateKey(value) {
        const key = taskText(value).slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
    }

    function taskDueDate(task = {}) {
        return taskDateKey(taskDueValue(task));
    }

    function taskScheduleStatus(task = {}) {
        return taskToken(task.scheduleStatus ?? task.schedule_status ?? task.schedule?.status, taskScheduledStart(task) ? 'scheduled' : 'unscheduled');
    }

    function taskScheduleSlot(task = {}) {
        return taskText(task.scheduleSlot ?? task.schedule_slot ?? task.schedule?.slot) || null;
    }

    function taskIsActive(task = {}) {
        return !['done', 'archived', 'cancelled'].includes(taskStatus(task));
    }

    function taskIsDeferred(task = {}, now = new Date()) {
        const value = taskSnoozedUntil(task);
        const until = value ? new Date(value) : null;
        return Boolean(until && !Number.isNaN(until.getTime()) && until > now);
    }

    function taskIsWaiting(task = {}) {
        return taskWorkflow(task) === 'waiting' || taskKind(task) === 'waiting' || taskStatus(task) === 'waiting' || task.waiting === true;
    }

    function taskIsPrivate(task = {}) {
        return taskVisibility(task) === 'private' || taskMode(task) === 'private';
    }

    function taskContext(task = {}) {
        return {
            source: {
                type: task.sourceType ?? task.source_type ?? null,
                id: task.sourceId ?? task.source_id ?? null,
                module: task.sourceModule ?? task.source_module ?? null,
                surface: task.sourceSurface ?? task.source_surface ?? null
            },
            businessContext: task.businessContext ?? task.business_context ?? null,
            relatedEntity: {
                type: task.relatedEntityType ?? task.related_entity_type ?? task.sourceEntityType ?? task.source_entity_type ?? null,
                id: task.relatedEntityId ?? task.related_entity_id ?? task.sourceEntityId ?? task.source_entity_id ?? null
            },
            subtasks: {
                count: Number(task.subtaskCount ?? task.subtask_count ?? 0),
                doneCount: Number(task.subtaskDoneCount ?? task.subtask_done_count ?? 0),
                items: Array.isArray(task.subtasks) ? task.subtasks : []
            },
            dependencies: {
                count: Number(task.dependencyCount ?? task.dependency_count ?? 0),
                openCount: Number(task.openDependencyCount ?? task.open_dependency_count ?? 0)
            },
            report: {
                required: task.reportRequired === true || task.requiresReport === true || task.report_required === true,
                id: task.reportId ?? task.report_id ?? null
            },
            observers: {
                count: Number(task.observerCount ?? task.observer_count ?? 0),
                userIds: Array.isArray(task.observerUserIds) ? task.observerUserIds : [],
                items: Array.isArray(task.observers) ? task.observers : []
            }
        };
    }

    function normalizeTask(task = {}) {
        const source = task && typeof task === 'object' ? task : {};
        return {
            ...source,
            ownerUserId: taskOwnerUserId(source),
            ownerLabel: taskOwnerLabel(source),
            ownerState: taskOwnerState(source),
            status: taskStatus(source),
            workflowState: taskWorkflow(source),
            taskMode: taskMode(source),
            taskKind: taskKind(source),
            visibility: taskVisibility(source),
            scheduledStartAt: taskScheduledStart(source),
            scheduledEndAt: taskScheduledEnd(source),
            snoozedUntil: taskSnoozedUntil(source),
            dueAt: taskDueValue(source),
            dueDate: taskDueDate(source),
            taskContext: taskContext(source)
        };
    }
    const TASK_MUTATION_CHANNEL = 'eventgenix:task-mutations:v1';
    const TASK_MUTATION_ACTIONS = Object.freeze(['create', 'update', 'complete', 'reschedule', 'reassign', 'archive']);
    const taskMutationOriginId = global.crypto?.randomUUID?.()
        || `task-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let taskMutationChannel = null;

    function normalizeTaskMutationAction(value = 'update') {
        const normalized = String(value || '').trim().toLowerCase().replace(/^task_/, '');
        if (normalized === 'status' || normalized === 'done') return 'complete';
        if (normalized === 'snooze') return 'reschedule';
        return TASK_MUTATION_ACTIONS.includes(normalized) ? normalized : 'update';
    }

    function dispatchTaskMutation(detail = {}) {
        if (typeof global.dispatchEvent !== 'function' || typeof global.CustomEvent !== 'function') return;
        global.dispatchEvent(new global.CustomEvent('crm:tasks-updated', { detail }));
    }

    function getTaskMutationChannel() {
        if (taskMutationChannel || typeof global.BroadcastChannel !== 'function') return taskMutationChannel;
        taskMutationChannel = new global.BroadcastChannel(TASK_MUTATION_CHANNEL);
        taskMutationChannel.onmessage = event => {
            const detail = event?.data || {};
            if (detail.contract !== 'task_mutation_v1' || detail.originId === taskMutationOriginId) return;
            dispatchTaskMutation({ ...detail, crossTab: true });
        };
        return taskMutationChannel;
    }

    function emitTaskMutation(detail = {}) {
        const taskId = Number(detail.taskId ?? detail.task_id);
        const event = {
            ...detail,
            contract: 'task_mutation_v1',
            action: normalizeTaskMutationAction(detail.action),
            taskId: Number.isInteger(taskId) && taskId > 0 ? taskId : null,
            source: String(detail.source || 'task_ui').trim() || 'task_ui',
            originId: taskMutationOriginId,
            eventId: global.crypto?.randomUUID?.() || `task-event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            emittedAt: new Date().toISOString()
        };
        dispatchTaskMutation(event);
        getTaskMutationChannel()?.postMessage(event);
        return event;
    }

    const TaskMutationSync = Object.freeze({
        channelName: TASK_MUTATION_CHANNEL,
        emit: emitTaskMutation,
        originId: () => taskMutationOriginId,
        normalizeAction: normalizeTaskMutationAction,
        connect: getTaskMutationChannel
    });
    global.TaskUiShared = Object.freeze({
        TASK_PRIORITY_OPTIONS,
        TASK_WORKFLOW_VALUES,
        normalizeTask,
        taskContext,
        taskOwnerUserId,
        taskOwnerLabel,
        taskOwnerState,
        taskMode,
        taskKind,
        taskVisibility,
        taskStatus,
        taskWorkflow,
        taskScheduledStart,
        taskScheduledEnd,
        taskSnoozedUntil,
        taskDueValue,
        taskDueDate,
        taskDateKey,
        taskScheduleStatus,
        taskScheduleSlot,
        taskIsActive,
        taskIsDeferred,
        taskIsWaiting,
        taskIsPrivate,
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
        PRIVATE_HANDOFF_CONFIRM_CODE,
        privateTaskHandoffFromResult,
        executePrivateTaskHandoff,
        applyPriorityClasses,
        TaskMutationSync
    });
})(window);
