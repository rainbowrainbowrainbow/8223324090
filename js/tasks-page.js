/**
 * tasks-page.js — Task Board v10.0 (Tasker + Kleshnya)
 * Views: Today, Week, My Tasks, Kanban, Templates
 * Features: task_type (human/bot), owner, deadline, escalation
 */

// ==========================================
// CONSTANTS
// ==========================================

const TASK_CATEGORY_TREE = {
    event: { icon: '', label: 'Івенти', color: '#E65100' },
    purchase: { icon: '', label: 'Закупівлі', color: '#2E7D32' },
    orders: {
        icon: '', label: 'Замовлення', color: '#DC2626',
        children: {
            kitchen: { label: 'Кухня', color: '#EA580C' },
            confectionery: { label: 'Кондитерка', color: '#C026D3' },
            cakes: { label: 'Торти', color: '#A21CAF', parent: 'confectionery' },
            cake_decor: { label: 'Прикраси', color: '#7C3AED', parent: 'confectionery' }
        }
    },
    admin: { icon: '', label: 'Адмін', color: '#1565C0' },
    trampoline: { icon: '', label: 'Батути', color: '#7B1FA2' },
    personal: { icon: '', label: 'Особисті', color: '#455A64' },
    improvement: { icon: '', label: 'Покращення', color: '#0891B2' },
    checklist: {
        icon: '', label: 'Чек-листи', color: '#C026D3',
        children: {
            hall_prep: { label: 'Підготовка залу', color: '#7C3AED' },
            kitchen: { label: 'Кухня', color: '#EA580C' },
            cakes: { label: 'Торт', color: '#A21CAF' },
            cake_decor: { label: 'Прикраси', color: '#6D28D9' },
            purchase: { label: 'Закупка', color: '#2E7D32' }
        }
    },
    operational: { icon: '', label: 'Операційні', color: '#16A34A' },
    maintenance: { icon: '', label: 'Технічні', color: '#64748B' }
};
const CAT_LABELS = TASK_CATEGORY_TREE;
const TOP_LEVEL_ORDER = ['event', 'purchase', 'orders', 'admin', 'trampoline', 'personal', 'improvement', 'checklist'];
const SUBCATEGORY_RAILS = {
    orders: [
        { id: 'all', label: 'Всі замовлення' },
        { id: 'kitchen', label: 'Кухня' },
        { id: 'confectionery', label: 'Кондитерка' },
        { id: 'cakes', label: 'Торти' },
        { id: 'cake_decor', label: 'Прикраси' }
    ],
    checklist: [
        { id: 'all', label: 'Всі чек-листи' },
        { id: 'hall_prep', label: 'Підготовка залу' },
        { id: 'kitchen', label: 'Кухня' },
        { id: 'cakes', label: 'Торт' },
        { id: 'cake_decor', label: 'Прикраси' },
        { id: 'purchase', label: 'Закупка' }
    ]
};
const CHECKLIST_TEMPLATE_BY_SUBCATEGORY = {
    hall_prep: 'hall_prep_base',
    kitchen: 'kitchen_base',
    cakes: 'cake_base',
    cake_decor: 'cake_decor_base',
    purchase: 'purchase_base'
};
const OPERATION_PRESETS = {
    hall_prep_basic: 'Підготовка залу',
    kitchen_basic: 'Кухня',
    cake_basic: 'Торт',
    cake_with_decor: 'Торт + прикраси',
    purchase_basic: 'Закупка'
};
const PACK_STATUS_LABELS = {
    draft: 'Чернетка',
    confirmed: 'Підтверджено',
    in_production: 'У виробництві',
    ready: 'Готово',
    issued: 'Видано',
    cancelled: 'Скасовано'
};
const WORKFLOW_LABELS = {
    inbox: 'Інбокс',
    todo: 'До виконання',
    in_progress: 'В роботі',
    waiting: 'Чекаю',
    scheduled: 'Заплановано',
    done: 'Виконано',
    archived: 'Архів'
};

const STATUS_CYCLE = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
const STATUS_ICONS = { todo: '', in_progress: '', done: '' };
const STATUS_LABELS = window.TaskUiShared?.STATUS_LABELS || { todo: 'До виконання', in_progress: 'В роботі', done: 'Готово' };
const KANBAN_STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITY_ICONS = window.TaskUiShared?.PRIORITY_ICONS || { urgent: '🔥', high: '', normal: '', low: '' };
const TASK_PRIORITY_OPTIONS = window.TaskUiShared?.TASK_PRIORITY_OPTIONS || [
    { value: 'urgent', label: 'Терміново' },
    { value: 'high', label: 'Високий' },
    { value: 'normal', label: 'Звичайний' },
    { value: 'low', label: 'Низький' }
];
const TASK_PRIORITY_VALUES = window.TaskUiShared?.TASK_PRIORITY_VALUES || TASK_PRIORITY_OPTIONS.map(item => item.value);

function normalizeTaskPriorityValue(value = 'normal') {
    if (window.TaskUiShared?.normalizeTaskPriority) {
        return window.TaskUiShared.normalizeTaskPriority(value);
    }
    const normalized = String(value || 'normal').toLowerCase().trim();
    if (normalized === 'critical') return 'urgent';
    if (normalized === 'medium') return 'normal';
    return TASK_PRIORITY_VALUES.includes(normalized) ? normalized : 'normal';
}

function setTaskPrioritySelectVisual(select, priority = 'normal') {
    if (!select) return normalizeTaskPriorityValue(priority);
    if (window.TaskUiShared?.applyPriorityClasses) {
        return window.TaskUiShared.applyPriorityClasses(select, priority, {
            selectClassPrefix: 'task-priority-select--'
        });
    }
    const normalized = normalizeTaskPriorityValue(priority);
    TASK_PRIORITY_VALUES.forEach(value => select.classList.remove(`task-priority-select--${value}`));
    select.classList.add(`task-priority-select--${normalized}`);
    select.value = normalized;
    return normalized;
}

function setTaskPrioritySelectBusy(select, busy) {
    if (!select) return;
    select.disabled = Boolean(busy);
    select.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function taskMutationFailure(payload = {}, response = null, fallback = 'Не вдалося оновити задачу') {
    if (window.TaskUiShared?.taskMutationFailure) {
        return window.TaskUiShared.taskMutationFailure(payload, response, fallback);
    }
    return {
        success: false,
        error: window.CrmApiErrors?.format?.(payload, fallback) || payload.error || payload.message || fallback,
        offline: Boolean(payload.offline),
        status: response?.status || payload.status || null,
        requestId: payload.requestId || payload.request_id || null
    };
}

function taskMutationOfflineFailure(error, fallback = 'Немає звʼязку з сервером. Перевірте інтернет і спробуйте ще раз.') {
    if (window.TaskUiShared?.taskOfflineFailure) {
        return window.TaskUiShared.taskOfflineFailure(error, fallback);
    }
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
    if (window.TaskUiShared?.normalizeTaskMutationResult) {
        return window.TaskUiShared.normalizeTaskMutationResult(result, fallback);
    }
    if (result?.success) return result;
    if (result && result.success === false) return taskMutationFailure(result, null, fallback);
    return taskMutationOfflineFailure(null, fallback);
}

function applyTaskPriorityVisualState(taskId, priority = 'normal') {
    const id = Number(taskId || 0);
    const normalized = normalizeTaskPriorityValue(priority);
    if (!id) return normalized;
    document.querySelectorAll(`.task-card[data-task-id="${id}"]`).forEach(card => {
        if (window.TaskUiShared?.applyPriorityClasses) {
            window.TaskUiShared.applyPriorityClasses(card, normalized, {
                priorityClassPrefix: 'priority-',
                dataAttribute: 'priority'
            });
            window.TaskUiShared.applyPriorityClasses(card.querySelector('[data-task-priority-select]'), normalized, {
                selectClassPrefix: 'task-priority-select--'
            });
        } else {
            TASK_PRIORITY_VALUES.forEach(value => card.classList.remove(`priority-${value}`));
            card.classList.add(`priority-${normalized}`);
            card.dataset.priority = normalized;
            setTaskPrioritySelectVisual(card.querySelector('[data-task-priority-select]'), normalized);
        }
    });
    return normalized;
}

const TASK_SOUND_THEME_OPTIONS = [
    { value: 'subtle', label: 'Мʼякий' },
    { value: 'classic', label: 'Класичний' },
    { value: 'rock', label: 'Рок' }
];
const PATTERN_LABELS = { daily: 'Щоденно', weekdays: 'Будні', weekly: 'Щотижня (пн)', custom: 'Обрані дні' };
const TASK_SCHEDULE_SLOTS = [
    { key: 'morning', icon: '🌅', label: 'Ранок' },
    { key: 'midday', icon: '☀️', label: 'День' },
    { key: 'afternoon', icon: '🌤️', label: 'Після обіду' },
    { key: 'evening', icon: '🌙', label: 'Вечір' }
];
const MAYSTERNYA_TASK_BUSINESS_CONTEXT = 'maysternya_doli';
const MAYSTERNYA_TASK_CATEGORY_ORDER = ['operational', 'admin', 'personal', 'improvement', 'maintenance'];
const MAYSTERNYA_TASK_PRESETS = Object.freeze({
    callback: {
        label: 'Передзвонити',
        title: 'Передзвонити клієнту Майстерні',
        priority: 'high',
        deadlineTime: '10:00',
        filterTerms: ['передзвон', 'дзвінок', 'callback', 'call']
    },
    write: {
        label: 'Написати',
        title: 'Написати клієнту Майстерні',
        priority: 'high',
        deadlineTime: '16:00',
        filterTerms: ['написати', 'повідомлення', 'whatsapp', 'telegram', 'write']
    },
    payment: {
        label: 'Оплата',
        title: 'Нагадати оплату консультації',
        priority: 'normal',
        deadlineTime: '11:00',
        filterTerms: ['оплат', 'платіж', 'payment']
    },
    post_session: {
        label: 'Після сесії',
        title: 'Follow-up після сесії Майстерні',
        priority: 'normal',
        deadlineTime: '12:00',
        filterTerms: ['після сесії', 'після консультації', 'post_session', 'post session']
    }
});
const MAYSTERNYA_TASK_PRESET_ORDER = ['callback', 'write', 'payment', 'post_session'];
const TASK_KIND_LABELS = {
    action: 'Дія',
    reminder: 'Нагадування',
    followup: 'Дотиск',
    deep_work: 'Глибока робота',
    checklist: 'Чеклист',
    routine: 'Рутина',
    waiting: 'Чекаю',
    idea: 'Ідея',
    decision: 'Рішення'
};

const TASK_CENTER_MODE_CONFIG = Object.freeze({
    overview: Object.freeze({ label: 'Огляд', defaultView: 'inbox', description: 'Вхідні, сьогодні та винятки' }),
    team: Object.freeze({ label: 'Команда', defaultView: 'team', description: 'Відповідальні та очікування' }),
    planning: Object.freeze({ label: 'Планування', defaultView: 'next', description: 'Наступні дні, відкладення та канбан' }),
    library: Object.freeze({ label: 'Бібліотека', defaultView: 'templates', description: 'Шаблони, рутини та архів' })
});
const TASK_CENTER_MODE_VALUES = Object.freeze(Object.keys(TASK_CENTER_MODE_CONFIG));
const TASK_CENTER_LEGACY_VIEW_MAP = Object.freeze({
    inbox: Object.freeze({ mode: 'overview', filter: 'inbox' }),
    today: Object.freeze({ mode: 'overview', filter: 'today' }),
    my: Object.freeze({ mode: 'overview', filter: 'my' }),
    done_today: Object.freeze({ mode: 'overview', filter: 'done_today' }),
    waiting: Object.freeze({ mode: 'team', filter: 'waiting' }),
    team: Object.freeze({ mode: 'team', filter: 'team' }),
    next: Object.freeze({ mode: 'planning', filter: 'next' }),
    week: Object.freeze({ mode: 'planning', filter: 'week' }),
    deferred: Object.freeze({ mode: 'planning', filter: 'deferred' }),
    board: Object.freeze({ mode: 'planning', filter: 'board' }),
    routines: Object.freeze({ mode: 'library', filter: 'routines' }),
    templates: Object.freeze({ mode: 'library', filter: 'templates' }),
    archive: Object.freeze({ mode: 'library', filter: 'archive' })
});
const TASK_CENTER_LEGACY_VIEWS = Object.freeze(Object.keys(TASK_CENTER_LEGACY_VIEW_MAP));

function normalizeTaskCenterMode(value = 'overview') {
    const mode = String(value || '').trim().toLowerCase();
    return TASK_CENTER_MODE_VALUES.includes(mode) ? mode : 'overview';
}

function taskCenterModeForView(view = 'inbox') {
    return TASK_CENTER_LEGACY_VIEW_MAP[String(view || '').trim()]?.mode || 'overview';
}

function resolveTaskCenterRoute(params = new URLSearchParams()) {
    const requestedMode = String(params.get('mode') || '').trim().toLowerCase();
    const requestedView = String(params.get('view') || '').trim().toLowerCase();
    const explicitMode = TASK_CENTER_MODE_VALUES.includes(requestedMode) ? requestedMode : '';
    const legacy = TASK_CENTER_LEGACY_VIEW_MAP[requestedView] || null;
    const mode = explicitMode || legacy?.mode || 'overview';
    const view = legacy && (!explicitMode || legacy.mode === mode)
        ? requestedView
        : TASK_CENTER_MODE_CONFIG[mode].defaultView;
    return Object.freeze({ mode, view, legacy: Boolean(legacy && !explicitMode) });
}

function taskCenterModeUrl(mode = currentTaskMode) {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', normalizeTaskCenterMode(mode));
    url.searchParams.delete('view');
    return url;
}
let currentView = 'inbox';
let currentTaskMode = 'overview';
let currentCategory = 'all';
let currentSubcategory = 'all';
let currentScopeFilter = 'all';
let assistantTaskFilter = '';
let allTasks = [];
let taskLoadSeq = 0;
let taskPagination = { page: 0, limit: 100, total: 0, hasMore: false, loadingMore: false, view: 'inbox' };
let taskOverviewProjection = null;
let taskOverviewLoading = false;
let taskOverviewError = null;
let taskTeamControlProjection = null;
let taskTeamControlLoading = false;
let taskTeamControlError = null;
let taskTeamControlFilters = { from: '', to: '', ownerUserId: '', department: '', status: '' };
const TASK_CENTER_URL_STATUSES = Object.freeze(['todo', 'in_progress', 'waiting', 'scheduled', 'done', 'archived', 'cancelled']);
const TASK_CENTER_URL_PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);
const TASK_CENTER_URL_SOURCES = Object.freeze(['manual', 'booking', 'lead', 'customer', 'event', 'order', 'hr', 'finance', 'automation']);
let taskCenterQueryState = { mode: 'overview', queue: 'inbox', ownerUserId: '', dateFrom: '', dateTo: '', status: [], priority: [], category: '', source: '', search: '' };
let taskSavedViews = [];
let taskSavedViewsRevision = 0;
let taskCenterSavedViewSaving = false;
let taskCenterSearchTimer = null;

function taskCenterDateParam(value = '') {
    const date = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function taskCenterListParam(value, allowed = []) {
    const values = String(value || '').split(',').map(item => item.trim()).filter(item => allowed.includes(item));
    return [...new Set(values)];
}

function normalizeTaskCenterQueryState(input = {}) {
    const mode = normalizeTaskCenterMode(input.mode || currentTaskMode || 'overview');
    const requestedQueue = String(input.queue || input.view || '').trim();
    const queue = TASK_CENTER_LEGACY_VIEWS.includes(requestedQueue)
        ? requestedQueue
        : TASK_CENTER_MODE_CONFIG[mode].defaultView;
    const ownerUserId = /^\d+$/.test(String(input.ownerUserId ?? input.owner ?? ''))
        ? String(Number(input.ownerUserId ?? input.owner))
        : '';
    const dateFrom = taskCenterDateParam(input.dateFrom ?? input.from);
    const dateTo = taskCenterDateParam(input.dateTo ?? input.to);
    return {
        mode,
        queue,
        ownerUserId,
        dateFrom,
        dateTo: dateFrom && dateTo && dateTo < dateFrom ? dateFrom : dateTo,
        status: taskCenterListParam(input.status, TASK_CENTER_URL_STATUSES),
        priority: taskCenterListParam(input.priority, TASK_CENTER_URL_PRIORITIES),
        category: String(input.category || '').trim().toLowerCase().slice(0, 48),
        source: TASK_CENTER_URL_SOURCES.includes(String(input.source || '').trim().toLowerCase())
            ? String(input.source).trim().toLowerCase()
            : '',
        search: String(input.search ?? input.q ?? '').trim().slice(0, 120)
    };
}

function taskCenterQueryStateFromUrl(params = new URLSearchParams(window.location.search)) {
    const route = resolveTaskCenterRoute(params);
    return normalizeTaskCenterQueryState({
        mode: route.mode,
        queue: params.get('queue') || route.view,
        ownerUserId: params.get('owner'),
        dateFrom: params.get('from'),
        dateTo: params.get('to'),
        status: params.get('status'),
        priority: params.get('priority'),
        category: params.get('category'),
        source: params.get('source'),
        search: params.get('search') || params.get('q')
    });
}

function taskCenterUrlForState(state = taskCenterQueryState) {
    const normalized = normalizeTaskCenterQueryState(state);
    const url = new URL(window.location.href);
    ['view', 'queue', 'owner', 'from', 'to', 'status', 'priority', 'category', 'source', 'search', 'q'].forEach(key => url.searchParams.delete(key));
    url.searchParams.set('mode', normalized.mode);
    url.searchParams.set('queue', normalized.queue);
    if (normalized.ownerUserId) url.searchParams.set('owner', normalized.ownerUserId);
    if (normalized.dateFrom) url.searchParams.set('from', normalized.dateFrom);
    if (normalized.dateTo) url.searchParams.set('to', normalized.dateTo);
    if (normalized.status.length) url.searchParams.set('status', normalized.status.join(','));
    if (normalized.priority.length) url.searchParams.set('priority', normalized.priority.join(','));
    if (normalized.category) url.searchParams.set('category', normalized.category);
    if (normalized.source) url.searchParams.set('source', normalized.source);
    if (normalized.search) url.searchParams.set('search', normalized.search);
    return url;
}

function syncTaskCenterUrl({ replace = false } = {}) {
    if (typeof window === 'undefined' || !window.history) return;
    const url = taskCenterUrlForState(taskCenterQueryState);
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ taskCenterQueryState }, '', url);
}

function applyTaskCenterQueryState(state = {}, { syncShell = true } = {}) {
    taskCenterQueryState = normalizeTaskCenterQueryState(state);
    currentTaskMode = taskCenterQueryState.mode;
    currentView = taskCenterQueryState.queue;
    currentCategory = taskCenterQueryState.category || 'all';
    currentSubcategory = 'all';
    taskTeamControlFilters = {
        ...taskTeamControlFilters,
        from: taskCenterQueryState.dateFrom,
        to: taskCenterQueryState.dateTo,
        ownerUserId: taskCenterQueryState.ownerUserId,
        status: taskCenterQueryState.status[0] || ''
    };
    if (syncShell) {
        setBoardView(currentView, currentTaskMode);
        syncTaskCenterShell();
        renderCategoryFilters();
        renderSubcategoryFilters();
        renderTaskCenterQueryControls();
    }
}

function updateTaskCenterQueryState(patch = {}, options = {}) {
    applyTaskCenterQueryState({ ...taskCenterQueryState, ...patch });
    syncTaskCenterUrl({ replace: options.replace === true });
    if (options.reload !== false) void loadAllTasks();
}
let userPermissions = null; // v20.9.16: loaded from /api/tasks/permissions
let taskCapabilities = {};

function taskCapabilityDecision(capability, fallbackAllowed = false) {
    const decision = taskCapabilities?.[capability];
    if (typeof decision?.allowed === 'boolean') return decision;
    return {
        allowed: fallbackAllowed === true,
        reasonCode: fallbackAllowed === true ? null : 'TASK_ACTION_FORBIDDEN'
    };
}

function taskCapabilityAllowed(capability, fallbackAllowed = false) {
    return taskCapabilityDecision(capability, fallbackAllowed).allowed === true;
}

function taskPermissionReasonLabel(reasonCode) {
    const labels = {
        TASK_ACTION_FORBIDDEN: '\u0414\u0456\u044f \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0434\u043b\u044f \u0432\u0430\u0448\u043e\u0457 \u0440\u043e\u043b\u0456.',
        TASK_CREATE_FORBIDDEN: '\u0421\u0442\u0432\u043e\u0440\u0435\u043d\u043d\u044f \u0437\u0430\u0434\u0430\u0447 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0435 \u0434\u043b\u044f \u0432\u0430\u0448\u043e\u0457 \u0440\u043e\u043b\u0456.',
        TASK_DELETE_FORBIDDEN: '\u0412\u0438\u0434\u0430\u043b\u0435\u043d\u043d\u044f \u0437\u0430\u0434\u0430\u0447 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0435 \u0434\u043b\u044f \u0432\u0430\u0448\u043e\u0457 \u0440\u043e\u043b\u0456.',
        TASK_REVIEW_FORBIDDEN: '\u041e\u0446\u0456\u043d\u044e\u0432\u0430\u043d\u043d\u044f \u0437\u0430\u0434\u0430\u0447\u0456 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0435 \u0434\u043b\u044f \u0432\u0430\u0448\u043e\u0457 \u0440\u043e\u043b\u0456.',
        TASK_REVIEW_REQUIRES_DONE: '\u041e\u0446\u0456\u043d\u0438\u0442\u0438 \u043c\u043e\u0436\u043d\u0430 \u043b\u0438\u0448\u0435 \u0432\u0438\u043a\u043e\u043d\u0430\u043d\u0443 \u0437\u0430\u0434\u0430\u0447\u0443.',
        TASK_MUTATION_FORBIDDEN: '\u0417\u043c\u0456\u043d\u044e\u0432\u0430\u0442\u0438 \u0446\u044e \u0437\u0430\u0434\u0430\u0447\u0443 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e.',
        TASK_REASSIGN_FORBIDDEN: '\u0417\u043c\u0456\u043d\u0430 \u0432\u0438\u043a\u043e\u043d\u0430\u0432\u0446\u044f \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430.',
        TASK_RESCHEDULE_FORBIDDEN: '\u041f\u0435\u0440\u0435\u043f\u043b\u0430\u043d\u0443\u0432\u0430\u043d\u043d\u044f \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0435 \u0434\u043b\u044f \u0446\u0456\u0454\u0457 \u0437\u0430\u0434\u0430\u0447\u0456.',
        TASK_ALREADY_TERMINAL: '\u0417\u0430\u0434\u0430\u0447\u0430 \u0432\u0436\u0435 \u0432 \u0442\u0435\u0440\u043c\u0456\u043d\u0430\u043b\u044c\u043d\u043e\u043c\u0443 \u0441\u0442\u0430\u043d\u0456.',
        TASK_OBSERVERS_FORBIDDEN: '\u041a\u0435\u0440\u0443\u0432\u0430\u0442\u0438 \u0441\u043f\u043e\u0441\u0442\u0435\u0440\u0456\u0433\u0430\u0447\u0430\u043c\u0438 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e.'
    };
    return labels[reasonCode] || labels.TASK_ACTION_FORBIDDEN;
}

function taskCapabilityReason(capability, fallbackAllowed = false) {
    return taskPermissionReasonLabel(taskCapabilityDecision(capability, fallbackAllowed).reasonCode);
}

let pageCurrentUser = null;
let currentTaskBusinessContext = 'event_genix';
let currentMaysternyaTaskFilter = 'all';
let captureIntent = {};
let taskAssigneeMode = 'self';
let lastCreatedTaskId = null;
let quickTaskBatchItems = [];
let quickTaskBatchNextId = 1;
let showCompletedInSlices = localStorage.getItem('eg_tasks_show_completed') === 'true';
let quickScheduleSlot = 'morning';
let taskDuePreset = 'today';
let kanbanDragState = null;
let lastKanbanDragEndedAt = 0;
let kanbanSavingTaskIds = new Set();
let taskSavedDecompositionTemplates = [];
let taskDecompositionSuggestions = [];
let taskSuggestionTimer = null;
let lastTaskSuggestionKey = '';
let taskSoundPreferences = { enabled: true, volume: 0.4, theme: 'subtle' };
const expandedTaskSubtaskIds = new Set();
const collapsedTaskSubtaskIds = new Set();
const taskCardSubtaskCache = new Map();
const loadingTaskSubtaskIds = new Set();

function notifyTaskWidgetsChanged(detail = {}) {
    const payload = { source: 'tasks_page', ...detail };
    if (window.TaskUiShared?.TaskMutationSync?.emit) return window.TaskUiShared.TaskMutationSync.emit(payload);
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return null;
    window.dispatchEvent(new CustomEvent('crm:tasks-updated', { detail: payload }));
    return payload;
}

function normalizeTaskSoundPreferences(input = {}) {
    const volume = Math.max(0, Math.min(1, Number(input.task_sound_volume ?? input.taskSoundVolume ?? input.volume ?? 0.4) || 0));
    const theme = String(input.task_sound_theme ?? input.taskSoundTheme ?? input.theme ?? 'subtle').trim();
    return {
        enabled: input.task_sound_enabled !== undefined ? Boolean(input.task_sound_enabled)
            : input.taskSoundEnabled !== undefined ? Boolean(input.taskSoundEnabled)
                : input.enabled !== undefined ? Boolean(input.enabled)
                    : true,
        volume,
        theme: TASK_SOUND_THEME_OPTIONS.some(item => item.value === theme) ? theme : 'subtle'
    };
}

function applyTaskSoundPreferences(preferences = {}) {
    taskSoundPreferences = normalizeTaskSoundPreferences(preferences);
    window.SoundEngine?.configureTask?.(taskSoundPreferences);
    renderTaskSoundControls();
}

function renderTaskSoundControls() {
    const host = document.getElementById('taskSoundControls');
    if (!host) return;
    const prefs = normalizeTaskSoundPreferences(taskSoundPreferences);
    host.innerHTML = `
        <label class="task-sound-toggle">
            <input type="checkbox" data-task-sound-toggle ${prefs.enabled ? 'checked' : ''}>
            <span>Звук задач</span>
        </label>
        <label class="task-sound-field">
            <span>Гучність</span>
            <input type="range" min="0" max="1" step="0.05" value="${prefs.volume}" data-task-sound-volume>
        </label>
        <label class="task-sound-field">
            <span>Тема</span>
            <select data-task-sound-theme>
                ${TASK_SOUND_THEME_OPTIONS.map(theme => `<option value="${theme.value}" ${theme.value === prefs.theme ? 'selected' : ''}>${escapeHtml(theme.label)}</option>`).join('')}
            </select>
        </label>
        <button type="button" data-task-sound-test>Тест</button>
    `;
}

async function saveTaskSoundPreferences(patch = {}) {
    taskSoundPreferences = normalizeTaskSoundPreferences({ ...taskSoundPreferences, ...patch });
    window.SoundEngine?.configureTask?.(taskSoundPreferences);
    renderTaskSoundControls();
    const result = await apiPatchTaskPreferences({
        task_sound_enabled: taskSoundPreferences.enabled,
        task_sound_volume: taskSoundPreferences.volume,
        task_sound_theme: taskSoundPreferences.theme
    });
    if (result?.preferences) {
        taskSoundPreferences = normalizeTaskSoundPreferences(result.preferences);
        window.SoundEngine?.configureTask?.(taskSoundPreferences);
        renderTaskSoundControls();
    } else if (result && result.success === false) {
        showNotification(result.error || 'Не вдалося зберегти звук задач', 'error');
    }
}

function setupTaskSoundControls() {
    const host = document.getElementById('taskSoundControls');
    if (!host || host.dataset.bound === 'true') return;
    host.dataset.bound = 'true';
    host.addEventListener('change', event => {
        if (event.target.matches('[data-task-sound-toggle]')) {
            saveTaskSoundPreferences({ enabled: event.target.checked });
        }
        if (event.target.matches('[data-task-sound-theme]')) {
            saveTaskSoundPreferences({ theme: event.target.value });
        }
    });
    host.addEventListener('input', event => {
        if (event.target.matches('[data-task-sound-volume]')) {
            taskSoundPreferences = normalizeTaskSoundPreferences({ ...taskSoundPreferences, volume: event.target.value });
            window.SoundEngine?.configureTask?.(taskSoundPreferences);
        }
    });
    host.addEventListener('change', event => {
        if (event.target.matches('[data-task-sound-volume]')) {
            saveTaskSoundPreferences({ volume: event.target.value });
        }
    });
    host.addEventListener('click', event => {
        const button = event.target.closest('[data-task-sound-test]');
        if (!button) return;
        event.preventDefault();
        window.SoundEngine?.playTask?.('task-complete');
    });
}

// ==========================================
// UTILITIES
// ==========================================


function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function taskBusinessContext() {
    return window.CrmBusinessContext?.normalize?.(currentTaskBusinessContext)
        || currentTaskBusinessContext
        || 'event_genix';
}

function taskBusinessScope() {
    return window.CrmBusinessContext?.scope?.() || {
        mode: 'single',
        activeContext: taskBusinessContext(),
        selectedContexts: [taskBusinessContext()],
        readOnly: false,
        canWrite: true
    };
}

function isMaysternyaTaskContext() {
    const scope = taskBusinessScope();
    return scope.mode === 'single' && taskBusinessContext() === MAYSTERNYA_TASK_BUSINESS_CONTEXT;
}

function taskBusinessReadOnlyMessage(actionLabel = 'змінювати задачі') {
    return window.CrmBusinessContext?.readOnlyMessage?.(taskBusinessScope(), actionLabel)
        || 'Оберіть один бізнес, щоб змінювати задачі.';
}

function guardTaskWrite(actionLabel = 'змінювати задачі') {
    if (window.CrmBusinessContext?.guardWrite) {
        return window.CrmBusinessContext.guardWrite(actionLabel, taskBusinessScope());
    }
    const readOnly = taskBusinessScope().readOnly === true || taskBusinessScope().canWrite === false;
    if (!readOnly) return true;
    if (typeof showNotification === 'function') showNotification(taskBusinessReadOnlyMessage(actionLabel), 'warning');
    return false;
}

function taskApiUrl(url) {
    const text = String(url || '');
    if (!/\/api\/(?:tasks|task-templates|banquet-deposits)\b/.test(text)) return url;
    return window.CrmBusinessContext?.apiUrl
        ? window.CrmBusinessContext.apiUrl(url, taskBusinessContext())
        : url;
}

function taskPayload(payload = {}) {
    return window.CrmBusinessContext?.payload
        ? window.CrmBusinessContext.payload(payload, taskBusinessContext())
        : { ...(payload || {}), businessContext: taskBusinessContext() };
}

function taskScopedJsonBody(body) {
    if (body === undefined || body === null) return body;
    if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
    if (typeof body === 'string') {
        const text = body.trim();
        if (!text) return body;
        try {
            return JSON.stringify(taskPayload(JSON.parse(text)));
        } catch {
            return body;
        }
    }
    if (typeof body === 'object') return JSON.stringify(taskPayload(body));
    return body;
}

function taskBlockedApiResponse(actionLabel = 'змінювати задачі') {
    return {
        ok: false,
        status: 403,
        json: async () => ({
            success: false,
            code: 'business_scope_read_only',
            error: taskBusinessReadOnlyMessage(actionLabel)
        })
    };
}

function taskApiFetch(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !guardTaskWrite('змінювати задачі')) {
        return Promise.resolve(taskBlockedApiResponse());
    }
    const request = { ...options };
    if (request.body !== undefined && method !== 'GET') request.body = taskScopedJsonBody(request.body);
    return fetch(taskApiUrl(url), request);
}

function taskApiFetchWithAuth(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !guardTaskWrite('змінювати задачі')) {
        return Promise.resolve(taskBlockedApiResponse());
    }
    const request = { ...options };
    if (request.body !== undefined && method !== 'GET') request.body = taskScopedJsonBody(request.body);
    const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
    return fetchWithAuth(taskApiUrl(url), request);
}

function getCategoryConfig(category) {
    const config = TASK_CATEGORY_TREE[category] || TASK_CATEGORY_TREE.admin;
    if (!isMaysternyaTaskContext()) return config;
    const maysternyaLabels = {
        operational: 'Follow-up',
        event: 'Сесії',
        orders: 'Запити',
        trampoline: 'Ресурси',
        checklist: 'Чек-листи',
        admin: 'Адмін',
        personal: 'Особисті',
        improvement: 'Покращення',
        maintenance: 'Технічні'
    };
    return maysternyaLabels[category] ? { ...config, label: maysternyaLabels[category] } : config;
}

function getSubcategoryConfig(category, subcategory) {
    return TASK_CATEGORY_TREE[category]?.children?.[subcategory] || null;
}

function supportsSubcategory(category) {
    return category === 'orders' || category === 'checklist';
}

function getSubcategoryItems(category) {
    return SUBCATEGORY_RAILS[category] || [];
}

function getTaxonomyLabel(category, subcategory) {
    const catInfo = getCategoryConfig(category);
    const subInfo = getSubcategoryConfig(category, subcategory);
    return subInfo ? `${catInfo.label} / ${subInfo.label}` : catInfo.label;
}

function getTopLevelTaskCategoryOrder() {
    if (!isMaysternyaTaskContext()) return TOP_LEVEL_ORDER;
    return MAYSTERNYA_TASK_CATEGORY_ORDER;
}

function renderCategoryOptions(selected = 'admin') {
    const optionCats = Array.from(new Set([...getTopLevelTaskCategoryOrder(), 'operational', 'maintenance', selected].filter(Boolean)));
    return optionCats.map(cat => {
        const info = getCategoryConfig(cat);
        return `<option value="${cat}" ${selected === cat ? 'selected' : ''}>${escapeHtml(info.label)}</option>`;
    }).join('');
}

function setTextWithDefault(selector, enabled, nextText) {
    const el = document.querySelector(selector);
    if (!el) return;
    if (el.dataset.defaultText === undefined) el.dataset.defaultText = el.textContent || '';
    el.textContent = enabled ? nextText : el.dataset.defaultText;
}

function ensureSelectOption(select, value, label) {
    if (!select || !value) return null;
    let option = Array.from(select.options || []).find(item => item.value === value);
    if (!option) {
        option = document.createElement('option');
        option.value = value;
        select.appendChild(option);
    }
    if (option.dataset.defaultText === undefined) option.dataset.defaultText = option.textContent || label;
    option.textContent = label;
    return option;
}

function syncSelectOptionText(selectId, value, enabled, nextText) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const option = Array.from(select.options || []).find(item => item.value === value);
    if (!option) return;
    if (option.dataset.defaultText === undefined) option.dataset.defaultText = option.textContent || '';
    option.textContent = enabled ? nextText : option.dataset.defaultText;
}

function getTaskKindLabel(kind) {
    if (isMaysternyaTaskContext() && kind === 'followup') return 'Follow-up';
    return TASK_KIND_LABELS[kind] || kind;
}

function maysternyaTaskSearchText(task = {}) {
    return [
        task.title,
        task.description,
        task.source_type || task.sourceType,
        task.source_module || task.sourceModule,
        task.source_entity_type || task.sourceEntityType,
        task.source_surface || task.sourceSurface
    ].filter(Boolean).join(' ').toLowerCase();
}

function isMaysternyaFollowUpTask(task = {}) {
    const source = String(task.source_type || task.sourceType || '').toLowerCase();
    const module = String(task.source_module || task.sourceModule || '').toLowerCase();
    return taskKind(task) === 'followup'
        || (task.category || '') === 'operational'
        || source.includes('maysternya')
        || module.includes('maysternya')
        || (source.includes('lead') && module.includes('tasks'));
}

function matchesMaysternyaTaskFilter(task = {}) {
    if (!isMaysternyaTaskContext() || currentMaysternyaTaskFilter === 'all') return true;
    if (currentMaysternyaTaskFilter === 'followup') return isMaysternyaFollowUpTask(task);
    const preset = MAYSTERNYA_TASK_PRESETS[currentMaysternyaTaskFilter];
    if (!preset) return true;
    const text = maysternyaTaskSearchText(task);
    return isMaysternyaFollowUpTask(task) && preset.filterTerms.some(term => text.includes(term));
}

function countMaysternyaPresetTasks(key) {
    return allTasks.filter(task => {
        if (!isActiveTask(task)) return false;
        if (key === 'all') return true;
        if (key === 'followup') return isMaysternyaFollowUpTask(task);
        const preset = MAYSTERNYA_TASK_PRESETS[key];
        if (!preset) return false;
        const text = maysternyaTaskSearchText(task);
        return isMaysternyaFollowUpTask(task) && preset.filterTerms.some(term => text.includes(term));
    }).length;
}

function renderMaysternyaTaskOpsBar() {
    const host = document.getElementById('maysternyaTaskOpsBar');
    if (!host) return;
    const enabled = isMaysternyaTaskContext();
    host.hidden = !enabled;
    if (!enabled) {
        host.innerHTML = '';
        return;
    }
    const filterButtons = [
        { key: 'all', label: 'Усі' },
        { key: 'followup', label: 'Follow-up' },
        ...MAYSTERNYA_TASK_PRESET_ORDER.map(key => ({ key, label: MAYSTERNYA_TASK_PRESETS[key].label }))
    ].map(item => {
        const active = currentMaysternyaTaskFilter === item.key;
        const count = countMaysternyaPresetTasks(item.key);
        return `<button type="button" class="maysternya-task-chip ${active ? 'active' : ''}" data-maysternya-task-filter="${escapeHtml(item.key)}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(item.label)} <span>${count}</span></button>`;
    }).join('');
    const presetButtons = MAYSTERNYA_TASK_PRESET_ORDER.map(key => {
        const preset = MAYSTERNYA_TASK_PRESETS[key];
        return `<button type="button" class="maysternya-task-preset" data-maysternya-task-preset="${escapeHtml(key)}">+ ${escapeHtml(preset.label)}</button>`;
    }).join('');
    host.innerHTML = `
        <div class="maysternya-task-filter-row" role="group" aria-label="Зріз follow-up Майстерні">${filterButtons}</div>
        <div class="maysternya-task-preset-row" role="group" aria-label="Швидкі follow-up задачі Майстерні">${presetButtons}</div>
    `;
}

function setupMaysternyaTaskOpsBar() {
    const host = document.getElementById('maysternyaTaskOpsBar');
    if (!host || host.dataset.bound === 'true') return;
    host.dataset.bound = 'true';
    host.addEventListener('click', event => {
        const filter = event.target.closest('[data-maysternya-task-filter]');
        if (filter) {
            setMaysternyaTaskFilter(filter.dataset.maysternyaTaskFilter || 'all');
            return;
        }
        const preset = event.target.closest('[data-maysternya-task-preset]');
        if (preset) applyMaysternyaTaskPreset(preset.dataset.maysternyaTaskPreset || '');
    });
}

function setMaysternyaTaskFilter(filter = 'all') {
    const next = filter === 'followup' || filter === 'all' || MAYSTERNYA_TASK_PRESETS[filter] ? filter : 'all';
    currentMaysternyaTaskFilter = next;
    renderMaysternyaTaskOpsBar();
    renderBoard();
}

function applyMaysternyaTaskPreset(key) {
    const preset = MAYSTERNYA_TASK_PRESETS[key];
    if (!preset) return;
    const title = document.getElementById('taskTitle');
    const category = document.getElementById('taskCategory');
    const priority = document.getElementById('taskPriority');
    const kind = document.getElementById('taskKind');
    const mode = document.getElementById('taskMode');
    const visibility = document.getElementById('taskVisibility');
    const deadline = document.getElementById('taskDeadlineTime');
    if (title) title.value = preset.title;
    if (category) category.value = 'operational';
    if (priority) priority.value = preset.priority;
    if (kind) kind.value = 'followup';
    if (mode) mode.value = 'work';
    if (visibility) visibility.value = 'team';
    if (deadline) deadline.value = preset.deadlineTime;
    captureIntent = {};
    setTaskDuePreset('today', { expand: false });
    currentCategory = 'operational';
    currentSubcategory = 'all';
    currentMaysternyaTaskFilter = key;
    renderCategoryFilters();
    renderSubcategoryFilters();
    renderMaysternyaTaskOpsBar();
    syncTaskSurfaceVisibility();
    renderBoard();
    toggleTaskComposerDetails(true);
    title?.focus();
}

function syncMaysternyaTaskUi() {
    const enabled = isMaysternyaTaskContext();
    document.body?.classList.toggle('tasks-business-maysternya', enabled);
    setTextWithDefault('.tasks-filter-summary strong', enabled, 'Задачі Майстерні');
    setTextWithDefault('.tasks-filter-summary span', enabled, 'follow-up, оплата і післясесійні дії');
    setTextWithDefault('.task-composer-kicker', enabled, 'Швидко додати follow-up');
    setTextWithDefault('#addTaskBtn', enabled, 'Створити follow-up');
    setTextWithDefault('[data-summary-view="my"] span', enabled, 'Мої follow-up');
    setTextWithDefault('[data-summary-view="waiting"] span', enabled, 'Очікують');
    const categorySelect = document.getElementById('taskCategory');
    ensureSelectOption(categorySelect, 'operational', enabled ? 'Follow-up' : 'Операційні');
    ensureSelectOption(categorySelect, 'maintenance', 'Технічні');
    syncSelectOptionText('taskCategory', 'event', enabled, 'Сесії');
    syncSelectOptionText('taskCategory', 'orders', enabled, 'Запити');
    syncSelectOptionText('taskCategory', 'trampoline', enabled, 'Ресурси');
    syncSelectOptionText('taskKind', 'followup', enabled, 'Follow-up');
    if (enabled && categorySelect && !document.getElementById('taskTitle')?.value.trim() && categorySelect.value === 'admin') {
        categorySelect.value = 'operational';
    }
    if (!enabled) currentMaysternyaTaskFilter = 'all';
    renderMaysternyaTaskOpsBar();
}

function initTaskBusinessContext(user) {
    const api = window.CrmBusinessContext;
    currentTaskBusinessContext = api?.initPage?.({
        pageId: 'system',
        user,
        beforeChange: async () => closeTaskDetailOverlay(false),
        onChange: async ({ current }) => {
            currentTaskBusinessContext = current;
            currentMaysternyaTaskFilter = 'all';
            currentCategory = 'all';
            currentSubcategory = 'all';
            syncMaysternyaTaskUi();
            renderCategoryFilters();
            renderSubcategoryFilters();
            syncTaskScopeFilters();
            await loadAllTasks({ fatal: false });
        }
    }) || 'event_genix';
    syncMaysternyaTaskUi();
}

function renderSubcategoryOptions(category, selected = '') {
    if (!supportsSubcategory(category)) return '<option value="">Без підкатегорії</option>';
    const options = getSubcategoryItems(category)
        .filter(item => item.id !== 'all')
        .map(item => `<option value="${item.id}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`);
    return '<option value="">Без підкатегорії</option>' + options.join('');
}

function selectedSubcategoryFor(category, selectId) {
    if (!supportsSubcategory(category)) return null;
    return document.getElementById(selectId)?.value || null;
}

function syncSubcategorySelect(categoryId, subcategoryId) {
    const category = document.getElementById(categoryId)?.value || 'admin';
    const sub = document.getElementById(subcategoryId);
    if (!sub) return;
    const previous = sub.value;
    sub.innerHTML = renderSubcategoryOptions(category, previous);
    const show = supportsSubcategory(category);
    sub.classList.toggle('hidden', !show);
    sub.style.display = show ? '' : 'none';
    const group = sub.closest('.task-composer-group');
    if (group) group.hidden = !show;
    if (!show) sub.value = '';
}

function normalizeChecklistTemplateKey(category, subcategory) {
    if (category !== 'checklist') return null;
    return CHECKLIST_TEMPLATE_BY_SUBCATEGORY[subcategory] || null;
}

function taskSubtaskProgress(doneCount, totalCount) {
    if (window.TaskCreate?.subtaskProgress) return window.TaskCreate.subtaskProgress(doneCount, totalCount);
    const total = Math.max(0, parseInt(totalCount, 10) || 0);
    if (!total) return null;
    const done = Math.max(0, parseInt(doneCount, 10) || 0);
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function taskSubtaskSummary(task = {}) {
    const total = Number(task.subtask_count || task.subtaskCount || 0);
    const done = Number(task.subtask_done_count || task.subtaskDoneCount || 0);
    return {
        total,
        done,
        progress: taskSubtaskProgress(done, total)
    };
}

function taskHasSubtasks(task = {}) {
    return taskSubtaskSummary(task).total > 0;
}

function taskCompletionBlockedBySubtasks(task = {}) {
    const summary = taskSubtaskSummary(task);
    return summary.total > 0 && summary.done < summary.total;
}

function getPackStatusLabel(status) {
    return PACK_STATUS_LABELS[status] || status || '';
}

function getWorkflowLabel(status) {
    return WORKFLOW_LABELS[status] || status || '';
}

function getTodayStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getDateOffsetStr(days = 0) {
    const d = new Date();
    d.setDate(d.getDate() + Number(days || 0));
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function deadlineForDate(dateText) {
    return dateText ? `${dateText}T18:00:00` : null;
}

function getWeekRange() {
    const now = new Date();
    const day = now.getDay() || 7; // Mon=1, Sun=7
    const mon = new Date(now);
    mon.setDate(now.getDate() - day + 1);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmtLocal = (dt) => {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    };
    return {
        from: fmtLocal(mon),
        to: fmtLocal(sun)
    };
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const days = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    return `${d}.${m} ${days[dt.getDay()]}`;
}

function scheduleSlotConfig(slotKey) {
    return TASK_SCHEDULE_SLOTS.find(slot => slot.key === slotKey) || null;
}

function taskScheduleStart(task = {}) {
    return window.TaskUiShared?.taskScheduledStart?.(task)
        || task.scheduledStartAt || task.scheduled_start_at || task.schedule?.startAt || null;
}

function taskScheduleEnd(task = {}) {
    return window.TaskUiShared?.taskScheduledEnd?.(task)
        || task.scheduledEndAt || task.scheduled_end_at || task.schedule?.endAt || null;
}

function taskScheduleStatus(task = {}) {
    return window.TaskUiShared?.taskScheduleStatus?.(task)
        || task.scheduleStatus || task.schedule_status || task.schedule?.status || (taskScheduleStart(task) ? 'scheduled' : 'unscheduled');
}

function taskScheduleSlot(task = {}) {
    return window.TaskUiShared?.taskScheduleSlot?.(task)
        || task.scheduleSlot || task.schedule_slot || task.schedule?.slot || null;
}

function taskScheduleDate(task = {}) {
    const raw = taskScheduleStart(task) || task.date || task.deadline || '';
    return String(raw || '').slice(0, 10);
}

function formatScheduleRange(task = {}) {
    const start = taskScheduleStart(task);
    const status = taskScheduleStatus(task);
    const slot = scheduleSlotConfig(taskScheduleSlot(task));
    if (status === 'proposal') return `${slot?.icon || '📌'} ${slot?.label || 'Пропозиція'} · потребує підтвердження`;
    if (status === 'missed') return `${slot?.icon || '⚠️'} слот пропущено`;
    if (!start) return '';
    const date = new Date(start);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
    const time = date.toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
    return `${slot?.icon || '🕒'} ${day} ${time}`;
}

function renderScheduleBadge(task = {}) {
    const label = formatScheduleRange(task);
    if (!label) return '';
    const status = taskScheduleStatus(task);
    const tone = status === 'proposal' ? ' is-proposal' : (status === 'missed' ? ' is-missed' : '');
    return `<span class="task-card-schedule${tone}" title="Smart schedule">${escapeHtml(label)}</span>`;
}

function schedulePayloadFor(date, slot, durationMinutes) {
    return {
        schedule: {
            date: date || getTodayStr(),
            slot: slot || quickScheduleSlot || 'morning',
            durationMinutes: Math.max(5, parseInt(durationMinutes, 10) || 30)
        },
        sourceSurface: 'task_page'
    };
}

function renderCardScheduleActions(taskId) {
    return `<span class="task-card-slot-actions" aria-label="Швидко перенести">${TASK_SCHEDULE_SLOTS.map(slot => (
        `<button type="button" title="${escapeHtml(slot.label)}" data-task-action="schedule" data-task-id="${taskId}" data-schedule-slot-action="${slot.key}">${slot.icon}</button>`
    )).join('')}</span>`;
}

function getTaskDeepLinkId() {
    const params = new URLSearchParams(window.location.search);
    const taskId = parseInt(params.get('open') || params.get('highlight'), 10);
    return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

function getTasksCurrentUser() {
    if (typeof AppState !== 'undefined' && AppState.currentUser) return AppState.currentUser;
    return pageCurrentUser;
}

function currentUserId() {
    const user = getTasksCurrentUser();
    const parsed = Number(user?.id || user?.userId || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function currentUserTaskOwnerOption() {
    const id = currentUserId();
    const user = getTasksCurrentUser();
    if (!id) return null;
    return {
        id,
        username: user?.username || null,
        name: user?.name || null,
        role: user?.role || null,
        label: user?.name || user?.username || `User #${id}`
    };
}

function taskOwnerUserId(task = {}) {
    if (window.TaskUiShared?.taskOwnerUserId) return window.TaskUiShared.taskOwnerUserId(task);
    const parsed = Number(task.ownerUserId || task.owner_user_id || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isTaskOwnedByCurrentUser(task = {}) {
    const ownerId = taskOwnerUserId(task);
    if (ownerId) return ownerId === currentUserId();
    return false;
}

function taskTextValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
        return value.label || value.name || value.username || value.title || value.actionId || value.id || '';
    }
    return String(value).trim();
}

function taskIdentityValue(value) {
    return taskTextValue(value).toLowerCase().trim();
}

function currentUserIdentityValues() {
    const user = getTasksCurrentUser() || {};
    return new Set([
        user.username,
        user.name,
        user.displayName,
        user.id,
        user.userId
    ].map(taskIdentityValue).filter(Boolean));
}

function getTaskCreatedByLabel(task = {}) {
    return taskTextValue(task.createdBy || task.created_by || task.createdByName || task.created_by_name);
}

function taskCreatedByUserId(task = {}) {
    const parsed = Number(task.createdByUserId || task.created_by_user_id || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isTaskCreatedByCurrentUser(task = {}) {
    const creatorId = taskCreatedByUserId(task);
    if (creatorId) return creatorId === currentUserId();
    const createdBy = taskIdentityValue(getTaskCreatedByLabel(task));
    return !!createdBy && currentUserIdentityValues().has(createdBy);
}

function isTaskDelegatedByCurrentUser(task = {}) {
    return isTaskCreatedByCurrentUser(task) && !isTaskOwnedByCurrentUser(task) && !!getTaskOwnerLabel(task);
}

function isTaskInMyWorkspace(task = {}) {
    return isTaskOwnedByCurrentUser(task) || isTaskCreatedByCurrentUser(task);
}

function isSelfCreatedPersonalTask(task = {}) {
    return isTaskOwnedByCurrentUser(task)
        && isTaskCreatedByCurrentUser(task)
        && taskMode(task) === 'personal';
}

function taskWorkspaceDisplayRank(task = {}) {
    if (isSelfCreatedPersonalTask(task)) return 0;
    if (isTaskOwnedByCurrentUser(task) && !isTaskCreatedByCurrentUser(task)) return 1;
    if (isTaskDelegatedByCurrentUser(task)) return 2;
    if (isTaskOwnedByCurrentUser(task) && isTaskCreatedByCurrentUser(task)) return 3;
    return 4;
}

function getTaskOwnerLabel(task = {}) {
    if (window.TaskUiShared?.taskOwnerLabel) return window.TaskUiShared.taskOwnerLabel(task) || '';
    return taskTextValue(task.ownerLabel || task.owner_label || task.assigned_to || task.owner);
}

function getTaskOwnerState(task = {}) {
    if (window.TaskUiShared?.taskOwnerState) return window.TaskUiShared.taskOwnerState(task);
    return task.ownerState || task.owner_state || (taskOwnerUserId(task) ? 'typed' : (getTaskOwnerLabel(task) ? 'legacy_unknown_owner' : 'unassigned'));
}

function getTaskOwnerStateLabel(task = {}) {
    const state = getTaskOwnerState(task);
    if (state === 'typed') return 'assigned';
    if (state === 'legacy_unknown_owner') return 'legacy-unknown';
    return 'unassigned';
}

function getTaskAssignmentView(task = {}) {
    const ownerLabel = getTaskOwnerLabel(task);
    const createdBy = getTaskCreatedByLabel(task);
    const ownedByMe = isTaskOwnedByCurrentUser(task);
    const createdByMe = isTaskCreatedByCurrentUser(task);
    const hasTypedOwner = !!taskOwnerUserId(task);
    if (isSelfCreatedPersonalTask(task)) {
        return {
            tone: 'self-personal',
            label: 'Моя особиста',
            title: 'Особиста задача, створена вами для себе; показується зверху в змішаних списках'
        };
    }
    if (ownedByMe && createdByMe) {
        return {
            tone: 'self',
            label: 'Собі',
            title: 'Ви створили цю задачу для себе'
        };
    }
    if (createdByMe && ownerLabel) {
        return {
            tone: 'delegated',
            label: `Я поставив: ${ownerLabel}`,
            title: 'Задача створена вами для іншої людини'
        };
    }
    if (ownedByMe) {
        return {
            tone: 'incoming',
            label: createdBy ? `Мені від ${createdBy}` : 'Мені',
            title: 'Задача призначена вам'
        };
    }
    if (ownerLabel) {
        return {
            tone: hasTypedOwner ? 'assigned' : 'legacy',
            label: `Для: ${ownerLabel}`,
            title: hasTypedOwner ? 'Призначена відповідальному' : 'Старий текстовий відповідальний без typed owner'
        };
    }
    return {
        tone: 'none',
        label: 'Без відповідального',
        title: 'У задачі немає відповідального'
    };
}

function formatTaskIntelLabel(value) {
    const raw = taskTextValue(value);
    if (!raw) return '';
    const normalized = raw.toLowerCase();
    const labels = {
        action_today: 'на сьогодні',
        action_overdue: 'прострочено',
        action_waiting: 'очікує',
        suggested: 'підказка',
        high: 'високий ризик',
        medium: 'середній ризик',
        low: 'низький ризик'
    };
    return labels[normalized] || raw.replace(/_/g, ' ');
}

function renderTaskIntelligence(task = {}) {
    const intel = task.intelligence || {};
    const pieces = [];
    const priorityBand = formatTaskIntelLabel(intel.priorityBand);
    const recommendedAction = formatTaskIntelLabel(intel.recommendedAction);
    if (priorityBand) pieces.push(`<span class="task-intel-badge task-intel-${escapeHtml(taskTextValue(intel.priorityBand))}">${escapeHtml(priorityBand)}</span>`);
    if (recommendedAction) pieces.push(`<span class="task-intel-badge">${escapeHtml(recommendedAction)}</span>`);
    return pieces.join('');
}

function formatDateTimeInput(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function taskCreatedTime(task = {}) {
    const raw = task.created_at || task.createdAt || task.created || '';
    const parsed = raw ? Date.parse(raw) : NaN;
    if (!Number.isNaN(parsed)) return parsed;
    const id = Number(task.id || 0);
    return Number.isFinite(id) ? id : 0;
}

function compareTasksForDisplay(a = {}, b = {}) {
    const aDone = a.status === 'done';
    const bDone = b.status === 'done';
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (aDone && bDone) {
        const completedDiff = new Date(taskCompletedAt(b) || b.updated_at || b.created_at || 0) - new Date(taskCompletedAt(a) || a.updated_at || a.created_at || 0);
        if (completedDiff) return completedDiff;
    }
    if (!aDone && !bDone) {
        const decompositionDiff = Number(taskHasSubtasks(b)) - Number(taskHasSubtasks(a));
        if (decompositionDiff) return decompositionDiff;
    }
    const rankDiff = taskWorkspaceDisplayRank(a) - taskWorkspaceDisplayRank(b);
    if (rankDiff) return rankDiff;
    const aIsNew = lastCreatedTaskId && String(a.id) === String(lastCreatedTaskId);
    const bIsNew = lastCreatedTaskId && String(b.id) === String(lastCreatedTaskId);
    if (aIsNew !== bIsNew) return aIsNew ? -1 : 1;
    const aOrder = a.scheduleSort?.order;
    const bOrder = b.scheduleSort?.order;
    if (Array.isArray(aOrder) && Array.isArray(bOrder)) {
        for (let i = 0; i < Math.max(aOrder.length, bOrder.length); i += 1) {
            const av = aOrder[i] ?? '';
            const bv = bOrder[i] ?? '';
            if (av < bv) return -1;
            if (av > bv) return 1;
        }
    }
    const createdDiff = taskCreatedTime(b) - taskCreatedTime(a);
    if (createdDiff) return createdDiff;
    return String(a.title || '').localeCompare(String(b.title || ''), 'uk');
}

function sortTasksForDisplay(tasks = []) {
    return [...tasks].sort(compareTasksForDisplay);
}

function setTaskCenterToolsOpen(isOpen) {
    const controls = document.getElementById('taskCenterLegacyControls');
    const toggle = document.getElementById('taskCenterToolsToggle');
    if (controls) controls.hidden = !isOpen;
    if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function syncTaskCenterShell() {
    const mode = normalizeTaskCenterMode(currentTaskMode);
    const shell = document.getElementById('taskCenterShell');
    const description = document.getElementById('taskCenterModeDescription');
    const context = document.getElementById('taskCenterBusinessContext');
    if (shell) shell.dataset.taskMode = mode;
    if (description) description.textContent = TASK_CENTER_MODE_CONFIG[mode].description;
    if (context) {
        const businessContext = taskBusinessContext();
        context.textContent = businessContext
            ? `Контекст: ${businessContext}. Робочі задачі, команда та планування в одному місці.`
            : 'Мої робочі задачі, команда та планування в одному місці.';
    }
    document.querySelectorAll('.task-center-mode-tab[data-task-mode]').forEach(tab => {
        const active = tab.dataset.taskMode === mode;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

function setBoardView(view = 'inbox', mode = taskCenterModeForView(view)) {
    currentView = TASK_CENTER_LEGACY_VIEWS.includes(view) ? view : 'inbox';
    currentTaskMode = normalizeTaskCenterMode(mode);
    document.querySelectorAll('.board-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === currentView));
    syncTaskCenterShell();
}

function activateTaskMode(mode = 'overview') {
    const nextMode = normalizeTaskCenterMode(mode);
    assistantTaskFilter = '';
    setTaskCenterToolsOpen(false);
    activateTaskView(TASK_CENTER_MODE_CONFIG[nextMode].defaultView, { mode: nextMode });
}
function setupTaskCenterShell() {
    document.querySelectorAll('.task-center-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => activateTaskMode(tab.dataset.taskMode || 'overview'));
        tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const tabs = Array.from(document.querySelectorAll('.task-center-mode-tab'));
            const index = tabs.indexOf(tab);
            const targetIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            const target = tabs[targetIndex];
            target?.focus();
            if (target) activateTaskMode(target.dataset.taskMode || 'overview');
        });
    });
    document.getElementById('taskCenterToolsToggle')?.addEventListener('click', () => {
        const controls = document.getElementById('taskCenterLegacyControls');
        setTaskCenterToolsOpen(Boolean(controls?.hidden));
    });
    document.querySelectorAll('.task-center-metric[data-summary-view]').forEach(card => {
        card.addEventListener('click', () => activateTaskView(card.dataset.summaryView || 'my'));
    });
    syncTaskCenterShell();
}
function taskCenterOwnerOptions() {
    return [`<option value="">\u0423\u0441\u0456 \u0432\u0438\u043a\u043e\u043d\u0430\u0432\u0446\u0456</option>`, ...(_assigneeList || []).map(owner => {
        const id = Number(owner?.id || owner?.userId || 0);
        if (!Number.isInteger(id) || id <= 0) return '';
        const label = owner.name || owner.username || `User #${id}`;
        return `<option value="${id}" ${String(id) === taskCenterQueryState.ownerUserId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })].join('');
}

function taskCenterSelectOptions(values, selected, emptyLabel) {
    return [`<option value="">${escapeHtml(emptyLabel)}</option>`, ...values.map(value =>
        `<option value="${value}" ${selected.includes(value) ? 'selected' : ''}>${escapeHtml(value)}</option>`
    )].join('');
}

function renderTaskCenterQueryControls() {
    const shell = document.getElementById('taskCenterShell');
    if (!shell) return;
    let host = document.getElementById('taskCenterQueryControls');
    if (!host) {
        host = document.createElement('section');
        host.id = 'taskCenterQueryControls';
        host.className = 'task-center-query-controls';
        host.setAttribute('aria-label', '\u0424\u0456\u043b\u044c\u0442\u0440\u0438 \u0442\u0430 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u0456 \u0432\u0438\u0433\u043b\u044f\u0434\u0438 \u0437\u0430\u0434\u0430\u0447');
        shell.appendChild(host);
    }
    const state = taskCenterQueryState;
    const categoryOptions = [`<option value="">\u0423\u0441\u0456 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0456\u0457</option>`, ...getTopLevelTaskCategoryOrder().map(category =>
        `<option value="${escapeHtml(category)}" ${state.category === category ? 'selected' : ''}>${escapeHtml(getCategoryConfig(category).label)}</option>`
    )].join('');
    const savedOptions = [`<option value="">\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u0456 \u0432\u0438\u0433\u043b\u044f\u0434\u0438</option>`, ...taskSavedViews.map(view =>
        `<option value="${escapeHtml(view.id)}">${escapeHtml(view.name)}</option>`
    )].join('');
    host.innerHTML = `<div class="task-center-query-row">
        <label><span>\u041f\u043e\u0448\u0443\u043a</span><input type="search" data-task-center-query="search" value="${escapeHtml(state.search)}" placeholder="\u041d\u0430\u0437\u0432\u0430, ID, \u0432\u0438\u043a\u043e\u043d\u0430\u0432\u0435\u0446\u044c \u0430\u0431\u043e CRM-\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442"></label>
        <label><span>\u0412\u0438\u043a\u043e\u043d\u0430\u0432\u0435\u0446\u044c</span><select data-task-center-query="ownerUserId">${taskCenterOwnerOptions()}</select></label>
        <label><span>\u0412\u0456\u0434</span><input type="date" data-task-center-query="dateFrom" value="${state.dateFrom}"></label>
        <label><span>\u0414\u043e</span><input type="date" data-task-center-query="dateTo" value="${state.dateTo}"></label>
        <label><span>\u0421\u0442\u0430\u0442\u0443\u0441</span><select data-task-center-query="status">${taskCenterSelectOptions(TASK_CENTER_URL_STATUSES, state.status, '\u0423\u0441\u0456')}</select></label>
        <label><span>\u041f\u0440\u0456\u043e\u0440\u0438\u0442\u0435\u0442</span><select data-task-center-query="priority">${taskCenterSelectOptions(TASK_CENTER_URL_PRIORITIES, state.priority, '\u0423\u0441\u0456')}</select></label>
        <label><span>\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0456\u044f</span><select data-task-center-query="category">${categoryOptions}</select></label>
        <label><span>\u0414\u0436\u0435\u0440\u0435\u043b\u043e</span><select data-task-center-query="source">${taskCenterSelectOptions(TASK_CENTER_URL_SOURCES, state.source ? [state.source] : [], '\u0423\u0441\u0456')}</select></label>
    </div><div class="task-center-saved-views-row">
        <select data-task-saved-view>${savedOptions}</select>
        <button type="button" class="btn-secondary" data-task-save-view ${taskCenterSavedViewSaving ? 'disabled aria-busy="true"' : ''}>\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0432\u0438\u0433\u043b\u044f\u0434</button>
        <button type="button" class="btn-secondary" data-task-delete-saved-view disabled>\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438</button>
    </div>`;
    if (host.dataset.bound === 'true') return;
    host.dataset.bound = 'true';
    host.addEventListener('input', event => {
        if (event.target?.dataset?.taskCenterQuery !== 'search') return;
        window.clearTimeout(taskCenterSearchTimer);
        taskCenterSearchTimer = window.setTimeout(() => updateTaskCenterQueryState({ search: event.target.value || '' }, { replace: true }), 250);
    });
    host.addEventListener('change', event => {
        const field = event.target?.dataset?.taskCenterQuery;
        if (field) {
            const value = event.target.value || '';
            updateTaskCenterQueryState((field === 'status' || field === 'priority') ? { [field]: value ? [value] : [] } : { [field]: value });
            return;
        }
        const view = taskSavedViews.find(item => item.id === event.target?.value);
        if (event.target?.dataset?.taskSavedView && view?.state) updateTaskCenterQueryState(view.state);
        const remove = host.querySelector('[data-task-delete-saved-view]');
        if (remove) { remove.disabled = !view; remove.dataset.taskSavedViewId = view?.id || ''; }
    });
    host.addEventListener('click', event => {
        if (event.target.closest('[data-task-save-view]')) void saveCurrentTaskCenterView();
        const remove = event.target.closest('[data-task-delete-saved-view]');
        if (remove?.dataset.taskSavedViewId) void deleteTaskCenterSavedView(remove.dataset.taskSavedViewId);
    });
}

async function persistTaskSavedViews(nextViews) {
    if (taskCenterSavedViewSaving) return null;
    taskCenterSavedViewSaving = true;
    renderTaskCenterQueryControls();
    try {
        const result = await apiPatchTaskPreferences({ savedTaskViews: nextViews, savedTaskViewsRevision: taskSavedViewsRevision });
        if (!result?.success) {
            if (result?.code === 'TASK_SAVED_VIEWS_CONFLICT' && result.preferences) {
                taskSavedViews = result.preferences.savedTaskViews || [];
                taskSavedViewsRevision = Number(result.preferences.savedTaskViewsRevision || 0);
            }
            showNotification(result?.error || '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0432\u0438\u0433\u043b\u044f\u0434.', 'error');
            return null;
        }
        taskSavedViews = result.preferences?.savedTaskViews || [];
        taskSavedViewsRevision = Number(result.preferences?.savedTaskViewsRevision || 0);
        return result;
    } finally {
        taskCenterSavedViewSaving = false;
        renderTaskCenterQueryControls();
    }
}

async function saveCurrentTaskCenterView() {
    if (taskCenterSavedViewSaving) return;
    if (typeof formModal !== 'function') {
        showNotification('\u0424\u043e\u0440\u043c\u0430 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043d\u044f \u0432\u0438\u0433\u043b\u044f\u0434\u0443 \u0442\u0438\u043c\u0447\u0430\u0441\u043e\u0432\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430.', 'error');
        return;
    }
    const values = await formModal('\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0432\u0438\u0433\u043b\u044f\u0434 \u0437\u0430\u0434\u0430\u0447', [
        {
            key: 'name',
            label: '\u041d\u0430\u0437\u0432\u0430 \u0432\u0438\u0433\u043b\u044f\u0434\u0443',
            type: 'text',
            required: true,
            placeholder: '\u041d\u0430\u043f\u0440\u0438\u043a\u043b\u0430\u0434: \u041c\u043e\u0457 \u043f\u0440\u043e\u0441\u0442\u0440\u043e\u0447\u0435\u043d\u0456'
        }
    ], {
        okText: '\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438',
        cancelText: '\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438'
    });
    const name = String(values?.name || '').trim();
    const id = window.crypto?.randomUUID?.();
    if (!name || !id) return;
    if (await persistTaskSavedViews([...taskSavedViews, { id, name, state: taskCenterQueryState }])) {
        showNotification('\u0412\u0438\u0433\u043b\u044f\u0434 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e.', 'success');
    }
}
async function deleteTaskCenterSavedView(viewId) {
    const view = taskSavedViews.find(item => item.id === viewId);
    if (!view || !await confirmModal(`\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438 \u0432\u0438\u0433\u043b\u044f\u0434 \"${view.name}\"?`, { type: 'danger', okText: '\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438', cancelText: '\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438' })) return;
    if (await persistTaskSavedViews(taskSavedViews.filter(item => item.id !== viewId))) showNotification('\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u0438\u0439 \u0432\u0438\u0433\u043b\u044f\u0434 \u0432\u0438\u0434\u0430\u043b\u0435\u043d\u043e.', 'success');
}
function syncTaskScopeFilters() {
    document.querySelectorAll('[data-scope]').forEach(chip => {
        const active = chip.dataset.scope === currentScopeFilter;
        chip.classList.toggle('active', active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function setTaskScopeFilter(scope = 'all') {
    currentScopeFilter = ['all', 'work', 'personal', 'private', 'waiting', 'idea'].includes(scope) ? scope : 'all';
    syncTaskScopeFilters();
    renderBoard();
}

function shouldShowOperationPackBar(view = currentView) {
    if (view === 'templates' || !taskCapabilityAllowed('create', userPermissions?.canCreateTasks !== false)) return false;
    return currentCategory === 'orders' || currentCategory === 'checklist';
}

function syncTaskSurfaceVisibility(view = currentView) {
    const isTemplates = view === 'templates';
    const catFilters = document.getElementById('catFilters');
    const quickAdd = document.getElementById('quickAdd');
    const operationPackBar = document.getElementById('operationPackBar');
    const operationsSummary = document.getElementById('operationsSummary');
    const boardContent = document.getElementById('boardContent');
    const templatesSection = document.getElementById('templatesSection');
    const subcatFilters = document.getElementById('subcatFilters');
    const scopeFilters = document.getElementById('taskScopeFilters');
    const canCreate = taskCapabilityAllowed('create', userPermissions?.canCreateTasks !== false);
    if (catFilters) catFilters.hidden = isTemplates;
    if (subcatFilters) subcatFilters.hidden = isTemplates;
    if (scopeFilters) scopeFilters.hidden = isTemplates;
    if (quickAdd) quickAdd.hidden = isTemplates || !canCreate;
    if (operationPackBar) operationPackBar.hidden = !shouldShowOperationPackBar(view);
    if (operationsSummary) operationsSummary.hidden = isTemplates || !supportsSubcategory(currentCategory);
    if (boardContent) boardContent.hidden = isTemplates;
    if (templatesSection) {
        templatesSection.hidden = !isTemplates;
        templatesSection.style.display = '';
    }
}

function applyTaskViewShell(view = currentView) {
    syncTaskSurfaceVisibility(view);
}

function activateTaskView(view = 'inbox', { mode = taskCenterModeForView(view), skipUrl = false } = {}) {
    const nextView = TASK_CENTER_LEGACY_VIEWS.includes(view) ? view : 'inbox';
    assistantTaskFilter = '';
    setBoardView(nextView, mode);
    taskCenterQueryState = normalizeTaskCenterQueryState({ ...taskCenterQueryState, mode: currentTaskMode, queue: nextView });
    if (!skipUrl) syncTaskCenterUrl();
    renderTaskCenterQueryControls();
    applyTaskViewShell(nextView);
    updateTaskExplainability();
    if (nextView === 'templates') void loadTemplates();
    else void loadAllTasks();
}
function keepNewTaskVisible(task = {}, fallback = {}) {
    const comparableTask = { ...fallback, ...task };
    const category = task.category || fallback.category || 'admin';
    const subcategory = task.subcategory || fallback.subcategory || null;
    const workflow = task.workflowState || task.workflow_state || fallback.workflow_state || 'inbox';
    const kind = task.taskKind || task.task_kind || fallback.task_kind || 'action';
    const due = (task.deadline || task.remindAt || task.remind_at || task.date || fallback.deadline || fallback.date || '').slice(0, 10);
    const week = getWeekRange();
    const isWaiting = workflow === 'waiting' || kind === 'waiting';
    const isNext = due && due > getTodayStr() && due <= week.to;
    let filtersChanged = false;
    if (currentCategory !== 'all' && currentCategory !== category) {
        currentCategory = 'all';
        currentSubcategory = 'all';
        filtersChanged = true;
    } else if (currentSubcategory !== 'all' && currentSubcategory !== (subcategory || '')) {
        currentSubcategory = 'all';
        filtersChanged = true;
    }
    if ((currentView === 'waiting' && !isWaiting) || (currentView === 'next' && !isNext) || ['routines', 'archive'].includes(currentView)) setBoardView('inbox');
    if (currentScopeFilter !== 'all' && !taskMatchesScopeFilter(comparableTask, currentScopeFilter)) {
        currentScopeFilter = 'all';
        syncTaskScopeFilters();
    }
    if (filtersChanged) {
        renderCategoryFilters();
        renderSubcategoryFilters();
    }
}

function openTaskDeepLink() {
    const taskId = getTaskDeepLinkId();
    if (taskId) openTaskDetail(taskId);
}

function showTaskCreateSuccessToast(createdTasks = [], drafts = [], postCreateWarningCount = 0) {
    const firstTaskId = createdTasks.find(task => task?.id || task?.taskId || task?.task_id)?.id
        || createdTasks.find(task => task?.id || task?.taskId || task?.task_id)?.taskId
        || createdTasks.find(task => task?.id || task?.taskId || task?.task_id)?.task_id;
    const payload = window.TaskCreate?.buildCreateNotification
        ? window.TaskCreate.buildCreateNotification(createdTasks, drafts, { postCreateWarningCount })
        : {
            title: createdTasks.length > 1 ? 'Задачі успішно створено' : 'Задачу успішно створено',
            message: createdTasks.length > 1 ? `Створено ${createdTasks.length} задач.` : 'Задачу додано в основний список',
            details: postCreateWarningCount > 0 ? [`Додаткові кроки синхронізуються: ${postCreateWarningCount}`] : [],
            durationMs: 8000,
            fadeDurationMs: 850,
            pauseOnInteract: true,
            closeButton: true
        };
    if (firstTaskId) {
        payload.actions = [{
            label: 'Відкрити',
            onClick: () => openTaskDetail(firstTaskId)
        }];
    }
    showNotification(payload, 'success');
}

function setupTaskFilterToggle() {
    const shell = document.getElementById('tasksFilterShell');
    const toggle = document.getElementById('tasksFilterToggle');
    if (!shell || !toggle || toggle.dataset.taskFilterToggleBound === 'true') return;
    toggle.dataset.taskFilterToggleBound = 'true';
    const sync = expanded => {
        shell.classList.toggle('is-secondary-collapsed', !expanded);
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggle.textContent = expanded ? 'Згорнути фільтри' : 'Фільтри';
    };
    sync(!shell.classList.contains('is-secondary-collapsed'));
    toggle.addEventListener('click', () => {
        sync(shell.classList.contains('is-secondary-collapsed'));
    });
}

function bootStep(label, extra) {
    if (extra !== undefined) console.info(`[tasks:boot] ${label}`, extra);
    else console.info(`[tasks:boot] ${label}`);
}

function renderTasksFatalError(err) {
    if (typeof renderStandaloneFatalError === 'function') {
        renderStandaloneFatalError({
            moduleName: 'tasks',
            containerId: 'boardContent',
            title: 'Не вдалося відкрити модуль задач',
            message: 'Сторінка завантажилась, але один із кроків ініціалізації впав.',
            error: err
        });
        return;
    }
    const board = document.getElementById('boardContent');
    if (board) {
        board.innerHTML = `
            <div class="page-fatal-error" role="alert">
                <h3>Не вдалося відкрити модуль задач</h3>
                <p>Сторінка завантажилась, але один із кроків ініціалізації впав.</p>
                <pre>${escapeHtml(err?.message || 'Unknown error')}</pre>
            </div>
        `;
    }
}

// ==========================================
// PAGE INIT
// ==========================================

async function initPage() {
    if (typeof initDarkMode === 'function') initDarkMode();
    bootStep('auth:start');

    let user;
    try {
        user = await apiVerifyToken();
    } catch (err) {
        bootStep('auth:runtime-failed', { message: err?.message || String(err) });
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        if (typeof handleStandaloneInitError === 'function') {
            handleStandaloneInitError('tasks', err, renderTasksFatalError);
        } else {
            console.error('[tasks:init] auth runtime failure', err);
            renderTasksFatalError(err);
        }
        return;
    }
    if (!user) { window.location.href = '/'; return; }

    bootStep('auth:ok', { role: user.role, username: user.username });
    try {
        pageCurrentUser = user;
        if (typeof AppState !== 'undefined') AppState.currentUser = user;
        const userEl = document.getElementById('currentUser');
        if (userEl) userEl.textContent = user.name;
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
        bootStep('shell:ready');
        initTaskBusinessContext(user);
        bootStep('business-context:ready', { businessContext: taskBusinessContext() });
        const params = new URLSearchParams(window.location.search);
        const requestedView = String(params.get('view') || '').trim().toLowerCase();
        const requestedMode = String(params.get('mode') || '').trim().toLowerCase();
        applyTaskCenterQueryState(taskCenterQueryStateFromUrl(params), { syncShell: false });
        assistantTaskFilter = normalizeAssistantTaskFilter(params.get('assistantFilter'));
        if (requestedView === 'focus') {
            currentView = 'today';
            applyTaskCenterQueryState({ ...taskCenterQueryState, mode: 'overview', queue: 'today' }, { syncShell: false });
        }
        if (assistantTaskFilter === 'overdue' && !requestedView && !requestedMode) {
            applyTaskCenterQueryState({ ...taskCenterQueryState, mode: 'team', queue: 'team' }, { syncShell: false });
        }        await _loadAssigneeDropdown();
        bootStep('owners:loaded', { count: _assigneeList.length });
        setupTaskComposer();
        setupTaskCenterShell();
        setupTaskGovernanceMenu();
        setupTaskSoundControls();
        renderTaskCenterQueryControls();
        setupTaskActionDelegation();
        setupTaskFilterToggle();
        setupMaysternyaTaskOpsBar();

        if (typeof bindLogoutButton === 'function') bindLogoutButton();

        // Board tab switching
        document.querySelectorAll('.board-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                activateTaskView(tab.dataset.view || 'inbox');
            });
        });
        document.getElementById('tasksSummaryStrip')?.addEventListener('click', (e) => {
            const card = e.target.closest('[data-summary-view]');
            if (!card) return;
            activateTaskView(card.dataset.summaryView || 'my');
        });

        renderCategoryFilters();
        renderSubcategoryFilters();
        syncTaskScopeFilters();
        document.getElementById('taskScopeFilters')?.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-scope]');
            if (!chip) return;
            setTaskScopeFilter(chip.dataset.scope || 'all');
        });
        document.getElementById('catFilters')?.addEventListener('click', (e) => {
            const chip = e.target.closest('.cat-chip');
            if (!chip) return;
            updateTaskCenterQueryState({ category: (chip.dataset.cat || 'all') === 'all' ? '' : (chip.dataset.cat || '') });
            syncTaskSurfaceVisibility();        });
        document.getElementById('subcatFilters')?.addEventListener('click', (e) => {
            const chip = e.target.closest('.subcat-chip');
            if (!chip) return;
            currentSubcategory = chip.dataset.subcat || 'all';
            renderSubcategoryFilters();
            renderBoard();
        });
        document.addEventListener('click', (e) => {
            const clear = e.target.closest('[data-explain-clear="tasks"]');
            if (!clear) return;
            e.preventDefault();
            resetTaskFilters();
        });

        // Quick add task
        document.getElementById('addTaskBtn')?.addEventListener('click', addTask);
        document.getElementById('taskCategory')?.addEventListener('change', () => {
            syncSubcategorySelect('taskCategory', 'taskSubcategory');
            syncTaskSurfaceVisibility();
            refreshTaskSavedTemplates();
            scheduleTaskDecompositionSuggestions();
        });
        document.getElementById('taskSubcategory')?.addEventListener('change', scheduleTaskDecompositionSuggestions);
        document.getElementById('taskTitle')?.addEventListener('input', scheduleTaskDecompositionSuggestions);
        document.getElementById('taskTitle')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addTask();
        });
        document.querySelectorAll('[data-capture-chip]').forEach(btn => {
            btn.addEventListener('click', () => applyCaptureChip(btn.dataset.captureChip));
        });
        bindTaskComposerSubtasks();

        // Templates
        document.getElementById('addTemplateBtn')?.addEventListener('click', addTemplate);
        document.getElementById('tplCategory')?.addEventListener('change', () => syncSubcategorySelect('tplCategory', 'tplSubcategory'));
        document.getElementById('tplPattern')?.addEventListener('change', (e) => {
            document.getElementById('tplDays').style.display = e.target.value === 'custom' ? '' : 'none';
        });
        document.getElementById('createOperationPackBtn')?.addEventListener('click', createOperationPack);
        syncSubcategorySelect('taskCategory', 'taskSubcategory');
        syncSubcategorySelect('tplCategory', 'tplSubcategory');
        await refreshTaskSavedTemplates();

        // v20.9.16: Load permissions and apply UI restrictions
        const permsResult = await apiGetTaskPermissions();
        if (permsResult && permsResult.permissions) {
            userPermissions = { ...permsResult.permissions, capabilities: permsResult.capabilities || {} };
            taskCapabilities = permsResult.capabilities || {};
            applyPermissionsUI(userPermissions);
        }
        const preferencesResult = await apiGetTaskPreferences();
        if (preferencesResult?.preferences) {
            applyTaskSoundPreferences(preferencesResult.preferences);
            taskSavedViews = preferencesResult.preferences.savedTaskViews || [];
            taskSavedViewsRevision = Number(preferencesResult.preferences.savedTaskViewsRevision || 0);
        } else renderTaskSoundControls();
        renderTaskCenterQueryControls();
        setBoardView(currentView, currentTaskMode);
        applyTaskViewShell(currentView);
        bootStep('permissions:loaded', { hasPermissions: Boolean(userPermissions) });

        await loadAllTasks({ fatal: true });
        if (currentView === 'templates') await loadTemplates();
        bootStep('tasks:loaded', { count: Array.isArray(allTasks) ? allTasks.length : 0 });
        openTaskDeepLink();
        bootStep('render:done');
    } catch (err) {
        bootStep('runtime:failed', { message: err?.message || String(err) });
        if (typeof handleStandaloneInitError === 'function') {
            handleStandaloneInitError('tasks', err, renderTasksFatalError);
        } else {
            console.error('[tasks:init] runtime failure', err);
            renderTasksFatalError(err);
        }
    }
}

// v20.9.16: Hide/show UI elements based on role permissions
function applyPermissionsUI(perms) {
    const canCreate = taskCapabilityAllowed('create', perms?.canCreateTasks !== false);
    const quickAdd = document.getElementById('quickAdd');
    let notice = document.getElementById('taskCreatePermissionNotice');
    if (!notice && quickAdd) {
        notice = document.createElement('p');
        notice.id = 'taskCreatePermissionNotice';
        notice.className = 'task-permission-notice';
        notice.setAttribute('role', 'status');
        quickAdd.insertAdjacentElement('afterend', notice);
    }
    if (notice) {
        notice.hidden = canCreate;
        notice.textContent = canCreate ? '' : taskCapabilityReason('create', false);
    }
    const operationPackBar = document.getElementById('operationPackBar');
    if (operationPackBar) operationPackBar.hidden = !canCreate;
    const templatesTab = document.querySelector('[data-view="templates"]');
    if (templatesTab) templatesTab.style.display = canCreate ? '' : 'none';
    syncTaskSurfaceVisibility();
}

// ==========================================
// API WRAPPERS
// ==========================================

async function apiGetTasks(filters = {}) {
    try {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
        const qs = params.toString() ? `?${params}` : '';
        const response = await taskApiFetch(`${API_BASE}/tasks${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getTasks error:', err);
        return [];
    }
}

async function apiCreateTask(data) {
    if (window.TaskCreate?.createTask) {
        return await window.TaskCreate.createTask(taskPayload(data), {
            onDuplicate: (err) => showNotification(err.message || 'Активний дубль не створено', 'warning')
        });
    }
    try {
        const response = await taskApiFetchWithAuth(`${API_BASE}/tasks`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (!response) return null;
        if (handleAuthError(response)) return null;
        if (response.status === 409) {
            const err = await response.json();
            showNotification(err.message || 'Активний дубль не створено', 'warning');
            return { success: false, duplicate: true, ...err };
        }
        if (!response.ok) throw new Error('create task API error');
        return await response.json();
    } catch (err) { console.error('API createTask error:', err); return null; }
}

// v33.3: Bulk task actions
async function apiBulkTasks(ids, action, extra = {}) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/bulk`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ ids, action, ...extra })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API bulkTasks error:', err); return null; }
}

async function apiPatchTaskStatus(id, status) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${id}/status`, {
            method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ status })
        });
        if (handleAuthError(response)) return taskMutationFailure({}, response, 'Сесію завершено. Увійдіть знову.');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return taskMutationFailure(payload, response, `status update failed (${response.status})`);
        }
        return payload?.success === false
            ? taskMutationFailure(payload, response, 'status update failed')
            : { success: true, ...payload };
    } catch (err) {
        console.error('API patchTaskStatus error:', err);
        return taskMutationOfflineFailure(err, 'Не вдалося змінити статус задачі. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiGetTasksPage({ view = currentView, page = 1, limit = 100, signal } = {}) {
    const params = new URLSearchParams({
        pagination: '1',
        view: String(view || 'inbox'),
        page: String(Math.max(1, Number(page) || 1)),
        limit: String(Math.max(1, Math.min(500, Number(limit) || 100)))
    });
    const state = taskCenterQueryState;
    if (state.ownerUserId) params.set('owner_user_id', state.ownerUserId);
    if (state.dateFrom) params.set('date_from', state.dateFrom);
    if (state.dateTo) params.set('date_to', state.dateTo);
    if (state.status.length) params.set('status', state.status.join(','));
    if (state.priority.length) params.set('priority', state.priority.join(','));
    if (state.category) params.set('category', state.category);
    if (state.source) params.set('source', state.source);
    if (state.search) params.set('search', state.search);
    const response = await taskApiFetch(`${API_BASE}/tasks?${params}`, { headers: getAuthHeaders(false), signal });
    if (handleAuthError(response)) throw new Error('Unauthorized');
    if (!response?.ok) throw new Error(`Tasks API error: ${response?.status || 'offline'}`);
    const payload = await response.json();
    if (!payload?.success || !Array.isArray(payload.tasks) || !payload.pagination) {
        throw new Error('/api/tasks pagination contract is invalid');
    }
    return payload;
}
async function apiGetTaskOverview() {
    const response = await taskApiFetch(`${API_BASE}/tasks/overview`, { headers: getAuthHeaders(false) });
    if (handleAuthError(response)) throw new Error('Unauthorized');
    if (!response?.ok) throw new Error(`Task overview API error: ${response?.status || 'offline'}`);
    const payload = await response.json();
    if (!payload?.success || !payload.counts || !Array.isArray(payload.queue) || !payload.meta?.paginationIndependent) {
        throw new Error('/api/tasks/overview contract is invalid');
    }
    return payload;
}
async function apiGetTaskTeamControl(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim() !== '') params.set(key, String(value));
    });
    const response = await taskApiFetch(`${API_BASE}/tasks/team-control?${params}`, { headers: getAuthHeaders(false) });
    if (handleAuthError(response)) throw new Error('Unauthorized');
    if (!response?.ok) throw new Error(`Task team control API error: ${response?.status || 'offline'}`);
    const payload = await response.json();
    if (!payload?.success || !Array.isArray(payload.owners) || !Array.isArray(payload.dates) || !payload.meta?.paginationIndependent) {
        throw new Error('/api/tasks/team-control contract is invalid');
    }
    return payload;
}
async function apiPatchTaskPriority(id, priority) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${id}/priority`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ priority, sourceSurface: 'tasks_page' })
        });
        if (handleAuthError(response)) return taskMutationFailure({}, response, 'Сесію завершено. Увійдіть знову.');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return taskMutationFailure(payload, response, `priority update failed (${response.status})`);
        }
        return payload?.success === false
            ? taskMutationFailure(payload, response, 'priority update failed')
            : { success: true, ...payload };
    } catch (err) {
        console.error('API patchTaskPriority error:', err);
        return taskMutationOfflineFailure(err, 'Не вдалося змінити пріоритет задачі. Перевірте зʼєднання і спробуйте ще раз.');
    }
}

async function apiGetTaskDedupReport() {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/dedup-report`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API getTaskDedupReport error:', err); return null; }
}

async function apiCleanupTaskDuplicates(dryRun = false) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/dedup-cleanup`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ dryRun })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API cleanupTaskDuplicates error:', err); return null; }
}

async function apiSnoozeTask(id, minutes = 60) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${id}/snooze`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ minutes })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API snoozeTask error:', err); return null; }
}

async function apiDeleteTask(id) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${id}`, {
            method: 'DELETE', headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API deleteTask error:', err); return null; }
}

async function apiGetTemplates() {
    try {
        const response = await taskApiFetch(`${API_BASE}/task-templates`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        return await response.json();
    } catch (err) { console.error('API getTemplates error:', err); return []; }
}

async function apiCreateTemplate(data) {
    try {
        const response = await taskApiFetch(`${API_BASE}/task-templates`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API createTemplate error:', err); return null; }
}

async function apiDeleteTemplate(id) {
    try {
        const response = await taskApiFetch(`${API_BASE}/task-templates/${id}`, {
            method: 'DELETE', headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API deleteTemplate error:', err); return null; }
}

// v20.9.16: Permissions API
async function apiGetTaskPermissions() {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/permissions`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) { console.error('API getTaskPermissions error:', err); return null; }
}

async function apiGetTaskPreferences() {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/preferences`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) { console.error('API getTaskPreferences error:', err); return null; }
}

async function apiPatchTaskPreferences(data = {}) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/preferences`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API patchTaskPreferences error:', err); return null; }
}

async function apiGetTaskOwners() {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/owners`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) return [];
        const data = await response.json();
        return data.users || [];
    } catch (err) { console.error('API getTaskOwners error:', err); return []; }
}

async function apiGetTaskHistory(taskId) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/history?limit=10`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, history: [] };
        if (!response.ok) throw new Error('history API error');
        return await response.json();
    } catch (err) { console.error('API getTaskHistory error:', err); return { success: false, history: [], error: err.message }; }
}

async function apiGetTaskObservers(taskId) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/observers`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, observers: [] };
        if (!response.ok) throw new Error('observers API error');
        return await response.json();
    } catch (err) { console.error('API getTaskObservers error:', err); return { success: false, observers: [], error: err.message }; }
}

async function apiSaveTaskObservers(taskId, observerUserIds) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/observers`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ observerUserIds })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API saveTaskObservers error:', err); return null; }
}

async function apiCompleteTask(taskId, options = {}) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/complete`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ sourceSurface: options.sourceSurface || 'task_page', reportId: options.reportId || undefined })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API completeTask error:', err); return null; }
}

async function apiGetBanquetDeposit(depositId) {
    try {
        const response = await taskApiFetch(`${API_BASE}/banquet-deposits/${encodeURIComponent(depositId)}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false, error: 'auth' };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { success: false, error: body.error || body.message || 'Не вдалося завантажити завдаток', code: body.code || null };
        }
        return body;
    } catch (err) {
        console.error('API getBanquetDeposit error:', err);
        return { success: false, error: err.message };
    }
}

async function apiConfirmBanquetDeposit(depositId, payload) {
    try {
        const response = await taskApiFetch(`${API_BASE}/banquet-deposits/${encodeURIComponent(depositId)}/confirm`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload || {})
        });
        if (handleAuthError(response)) return { success: false, error: 'auth' };
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                success: false,
                error: body.error || body.message || 'Не вдалося підтвердити завдаток',
                code: body.code || null,
                field: body.field || body.details?.field || null
            };
        }
        return body;
    } catch (err) {
        console.error('API confirmBanquetDeposit error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetTaskSubtasks(taskId) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/subtasks`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API getTaskSubtasks error:', err);
        return null;
    }
}

async function apiPatchTaskSubtask(taskId, subtaskId, data) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(data || {})
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API patchTaskSubtask error:', err);
        return null;
    }
}

async function apiReassignTask(taskId, ownerUserId) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/reassign`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ ownerUserId, sourceSurface: 'task_page' })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API reassignTask error:', err); return null; }
}

async function apiRescheduleTask(taskId, deadline) {
    try {
        const payload = deadline && typeof deadline === 'object'
            ? { ...deadline, sourceSurface: deadline.sourceSurface || 'task_page' }
            : { deadline, sourceSurface: 'task_page' };
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/reschedule`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API rescheduleTask error:', err); return null; }
}

async function apiScheduleTask(taskId, payload) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/${taskId}/schedule`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ ...payload, sourceSurface: payload?.sourceSurface || 'task_page' })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API scheduleTask error:', err); return null; }
}

// ==========================================
// LOAD & RENDER
// ==========================================

function renderCategoryFilters() {
    const host = document.getElementById('catFilters');
    if (!host) return;
    const items = ['all', ...getTopLevelTaskCategoryOrder()];
    host.innerHTML = items.map(cat => {
        const active = currentCategory === cat;
        const label = cat === 'all' ? 'Всі' : getCategoryConfig(cat).label;
        return `<button type="button" class="cat-chip ${active ? 'active' : ''}" data-cat="${cat}">${escapeHtml(label)}</button>`;
    }).join('');
}

function renderSubcategoryFilters() {
    const host = document.getElementById('subcatFilters');
    if (!host) return;
    if (!supportsSubcategory(currentCategory)) {
        host.classList.add('hidden');
        host.hidden = true;
        host.innerHTML = '';
        return;
    }
    const items = getSubcategoryItems(currentCategory);
    host.classList.remove('hidden');
    host.hidden = false;
    host.innerHTML = items.map(item => `
        <button type="button" class="subcat-chip ${currentSubcategory === item.id ? 'active' : ''}" data-subcat="${item.id}">
            ${escapeHtml(item.label)}
        </button>
    `).join('');
}

function taskOverviewModeActive() {
    return typeof currentTaskMode !== 'undefined' && currentTaskMode === 'overview';
}

async function loadTaskOverview(options = {}) {
    const { fatal = false } = options;
    const loadSeq = ++taskLoadSeq;
    const board = document.getElementById('boardContent');
    taskOverviewLoading = true;
    taskOverviewError = null;
    if (board) renderBoard();
    try {
        const payload = await apiGetTaskOverview();
        if (loadSeq !== taskLoadSeq) return;
        taskOverviewProjection = payload;
        allTasks = payload.queue.map(item => item.task).filter(Boolean);
        taskPagination = { page: 1, limit: allTasks.length, total: Number(payload.meta?.exceptionTotal || 0), hasMore: Boolean(payload.meta?.hasMore), loadingMore: false, view: 'overview' };
        taskOverviewLoading = false;
        updateCounts();
        renderBoard();
    } catch (err) {
        if (loadSeq !== taskLoadSeq) return;
        console.error('loadTaskOverview error:', err);
        taskOverviewLoading = false;
        taskOverviewError = err;
        if (fatal) throw err;
        renderBoard();
    }
}
function taskTeamControlModeActive() {
    return typeof currentTaskMode !== 'undefined' && ['team', 'planning'].includes(currentTaskMode);
}

function normalizeTaskTeamControlFilters() {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(taskTeamControlFilters.from || '') ? taskTeamControlFilters.from : getTodayStr();
    const defaultToDate = new Date(`${from}T12:00:00Z`);
    defaultToDate.setUTCDate(defaultToDate.getUTCDate() + 6);
    const defaultTo = defaultToDate.toISOString().slice(0, 10);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(taskTeamControlFilters.to || '') ? taskTeamControlFilters.to : defaultTo;
    return { ...taskTeamControlFilters, from, to: to < from ? from : to };
}

async function loadTaskTeamControl(options = {}) {
    const { fatal = false } = options;
    const loadSeq = ++taskLoadSeq;
    taskTeamControlLoading = true;
    taskTeamControlError = null;
    renderBoard();
    try {
        const filters = normalizeTaskTeamControlFilters();
        const payload = await apiGetTaskTeamControl(filters);
        if (loadSeq !== taskLoadSeq) return;
        taskTeamControlFilters = { ...taskTeamControlFilters, from: payload.meta?.from || filters.from, to: payload.meta?.to || filters.to };
        taskTeamControlProjection = payload;
        allTasks = payload.owners.flatMap(owner => owner.tasks || []).map(item => item.task).filter(Boolean);
        taskPagination = { page: 1, limit: allTasks.length, total: allTasks.length, hasMore: false, loadingMore: false, view: currentTaskMode };
        taskTeamControlLoading = false;
        updateCounts();
        renderBoard();
    } catch (err) {
        if (loadSeq !== taskLoadSeq) return;
        console.error('loadTaskTeamControl error:', err);
        taskTeamControlLoading = false;
        taskTeamControlError = err;
        if (fatal) throw err;
        renderBoard();
    }
}
async function loadAllTasks(options = {}) {
    const { fatal = false, append = false } = options;
    if (!append && typeof currentTaskMode !== 'undefined' && currentTaskMode === 'overview') return loadTaskOverview({ fatal });
    if (!append && typeof currentTaskMode !== 'undefined' && ['team', 'planning'].includes(currentTaskMode)) return loadTaskTeamControl({ fatal });
    if (!append) {
        window.__taskCenterRequestAbortController?.abort();
        window.__taskCenterRequestAbortController = typeof AbortController === 'function' ? new AbortController() : null;
    }
    const requestSignal = window.__taskCenterRequestAbortController?.signal;
    const loadSeq = ++taskLoadSeq;
    const board = document.getElementById('boardContent');
    if (board && !append) board.innerHTML = '<div class="loading-spinner">Завантаження задач…</div>';
    if (append) {
        taskPagination = { ...taskPagination, loadingMore: true };
        renderBoard();
    }
    try {
        const targetPage = append ? Math.max(1, Number(taskPagination.nextPage) || Number(taskPagination.page || 0) + 1) : 1;
        const payload = await apiGetTasksPage({ view: currentView, page: targetPage, limit: taskPagination.limit || 100, signal: requestSignal });
        if (loadSeq !== taskLoadSeq) return;
        const incoming = payload.tasks;
        allTasks = append
            ? [...allTasks, ...incoming.filter(task => !allTasks.some(current => Number(current.id) === Number(task.id)))]
            : incoming;
        taskPagination = { ...payload.pagination, loadingMore: false, view: currentView };
        updateCounts();
        renderBoard();
    } catch (err) {
        if (loadSeq !== taskLoadSeq) return;
        console.error('loadAllTasks error:', err);
        if (fatal) throw err;
        showNotification('Помилка завантаження задач', 'error');
        taskPagination = { ...taskPagination, loadingMore: false };
        if (board) board.innerHTML = '<div class="empty-state">Не вдалося завантажити задачі. <button type="button" class="btn-secondary" data-task-retry>Повторити</button></div>';
    }
}

function renderTaskPagination(container) {
    if (!container || currentView === 'templates') return;
    const { total = 0, hasMore = false, loadingMore = false } = taskPagination || {};
    if (!hasMore && total <= allTasks.length) return;
    const label = loadingMore ? 'Завантаження…' : `Завантажити ще (${allTasks.length} з ${total})`;
    container.insertAdjacentHTML('beforeend', `
        <div class="task-pagination" aria-live="polite">
            <button type="button" class="btn-secondary" data-task-load-more ${loadingMore ? 'disabled aria-disabled="true"' : ''}>${label}</button>
        </div>`);
}

async function apiCreateOperationPack(data) {
    try {
        const response = await taskApiFetch(`${API_BASE}/tasks/operation-pack`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API createOperationPack error:', err);
        return null;
    }
}

function filterByTaxonomy(tasks) {
    let filtered = tasks;
    if (currentCategory !== 'all') {
        if (currentCategory === 'checklist') {
            filtered = filtered.filter(t => (t.category || 'admin') === 'checklist' || taskKind(t) === 'checklist');
        } else {
            filtered = filtered.filter(t => (t.category || 'admin') === currentCategory);
        }
    }
    if (supportsSubcategory(currentCategory) && currentSubcategory !== 'all') {
        if (currentCategory === 'orders' && currentSubcategory === 'confectionery') {
            filtered = filtered.filter(t => ['confectionery', 'cakes', 'cake_decor'].includes(t.subcategory));
        } else {
            filtered = filtered.filter(t => (t.subcategory || null) === currentSubcategory);
        }
    }
    return filtered;
}

function filterByCategory(tasks) {
    return applyTaskScopeFilter(filterByTaxonomy(tasks)).filter(matchesMaysternyaTaskFilter);
}

function normalizeAssistantTaskFilter(value) {
    return String(value || '').trim().toLowerCase() === 'overdue' ? 'overdue' : '';
}

function isOverdueTask(task = {}) {
    if (!isActiveTask(task)) return false;
    const raw = taskScheduleEnd(task) || taskScheduleStart(task) || task.deadline || task.remindAt || task.remind_at || task.date || '';
    if (!raw) return false;
    const dueDate = taskDueDate(task);
    const today = getTodayStr();
    if (dueDate && dueDate < today) return true;
    if (dueDate && dueDate > today) return false;
    const parsed = new Date(raw);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
}

function applyAssistantTaskFilter(tasks = []) {
    if (assistantTaskFilter === 'overdue') return tasks.filter(isOverdueTask);
    return tasks;
}

function getCategoryLabel(cat = currentCategory) {
    if (cat === 'all') return 'Всі категорії';
    return getCategoryConfig(cat)?.label || cat;
}

function getSubcategoryLabel(cat = currentCategory, subcat = currentSubcategory) {
    if (!supportsSubcategory(cat) || subcat === 'all') return '';
    return getSubcategoryConfig(cat, subcat)?.label || subcat;
}

function getViewLabel(view = currentView) {
    const labels = {
        inbox: 'Інбокс',
        today: 'Сьогодні',
        next: 'Наступні',
        deferred: 'Відкладено',
        waiting: 'Чекаю',
        team: 'Командні',
        week: 'Тиждень',
        my: 'Мої',
        board: 'Канбан',
        routines: 'Рутини',
        done_today: 'Виконано сьогодні',
        archive: 'Архів',
        templates: 'Шаблони'
    };
    return labels[view] || view;
}

function taskMode(t = {}) { return window.TaskUiShared?.taskMode?.(t) || t.taskMode || t.task_mode || 'work'; }
function taskKind(t = {}) { return window.TaskUiShared?.taskKind?.(t) || t.taskKind || t.task_kind || 'action'; }
function taskVisibility(t = {}) { return window.TaskUiShared?.taskVisibility?.(t) || t.visibility || (taskMode(t) === 'private' ? 'private' : 'team'); }
function taskWorkflow(t = {}) { return window.TaskUiShared?.taskWorkflow?.(t) || t.workflowState || t.workflow_state || (t.status === 'done' ? 'done' : 'todo'); }
function taskDueDate(t = {}) { return window.TaskUiShared?.taskDueDate?.(t) || (taskScheduleStart(t) || t.snoozedUntil || t.snoozed_until || t.date || t.deadline || t.remindAt || t.remind_at || '').slice(0, 10); }
function isActiveTask(t) { return window.TaskUiShared?.taskIsActive?.(t) ?? !['done', 'archived', 'cancelled'].includes(t.status); }
function taskSnoozedUntil(t = {}) { return window.TaskUiShared?.taskSnoozedUntil?.(t) || t.snoozedUntil || t.snoozed_until || ''; }
function isDeferredTask(t = {}) {
    if (window.TaskUiShared?.taskIsDeferred) return window.TaskUiShared.taskIsDeferred(t);
    const raw = taskSnoozedUntil(t);
    if (!raw) return false;
    const date = new Date(raw);
    return !Number.isNaN(date.getTime()) && date > new Date();
}
function isWaitingTask(t) { return window.TaskUiShared?.taskIsWaiting?.(t) ?? (taskWorkflow(t) === 'waiting' || taskKind(t) === 'waiting'); }
function isPrivateTask(t) { return window.TaskUiShared?.taskIsPrivate?.(t) ?? (taskVisibility(t) === 'private' || taskMode(t) === 'private'); }
function isTeamTask(t) { return taskVisibility(t) === 'team' && taskMode(t) === 'work'; }
function isInboxTask(t) { return isActiveTask(t) && !isDeferredTask(t) && (taskWorkflow(t) === 'inbox' || (!t.date && !t.deadline && !taskScheduleStart(t))); }
function isRoutineTask(t) { return taskKind(t) === 'routine' || t.type === 'recurring'; }
function isIdeaTask(t) { return taskKind(t) === 'idea'; }
function taskCompletedAt(t = {}) { return t.completedAt || t.completed_at || null; }
function formatTaskCompletedTime(t = {}) {
    const raw = taskCompletedAt(t);
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
}
function isCompletedToday(t = {}) {
    const raw = taskCompletedAt(t);
    if (t.status !== 'done' || !raw) return false;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return false;
    const kyivDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
    return kyivDate === getTodayStr();
}
function sortCompletedNewestFirst(a, b) {
    return new Date(taskCompletedAt(b) || b.updated_at || b.created_at || 0) - new Date(taskCompletedAt(a) || a.updated_at || a.created_at || 0);
}
function composeSliceTasks(activeTasks = [], completedTasks = []) {
    const active = [...activeTasks];
    if (!showCompletedInSlices) return active;
    const completedIds = new Set(active.map(t => t.id));
    const completed = completedTasks
        .filter(t => t.status === 'done' && !completedIds.has(t.id))
        .sort(sortCompletedNewestFirst);
    return [...active, ...completed];
}

function taskModeBadge(t) {
    const mode = taskMode(t);
    const label = { work: 'Робоча', personal: 'Особиста', private: 'Приватна', system: 'Системна' }[mode] || mode;
    return `<span class="task-os-badge mode-${escapeHtml(mode)}">${escapeHtml(label)}</span>`;
}

function taskKindBadge(t) {
    const kind = taskKind(t);
    const label = {
        action: 'Дія',
        reminder: 'Нагадування',
        followup: 'Дотиск',
        deep_work: 'Глибока робота',
        checklist: 'Чеклист',
        routine: 'Рутина',
        waiting: 'Чекаю',
        idea: 'Ідея',
        decision: 'Рішення'
    }[kind] || kind;
    const displayLabel = getTaskKindLabel(kind) || label;
    return `<span class="task-os-badge kind-${escapeHtml(kind)}">${escapeHtml(displayLabel)}</span>`;
}

function renderTaskPriorityControl(task = {}) {
    const current = normalizeTaskPriorityValue(task.priority);
    return `<select class="task-priority-select task-priority-select--${escapeHtml(current)}" data-task-priority-select data-task-id="${task.id}" aria-label="Пріоритет задачі">
        ${TASK_PRIORITY_OPTIONS.map(item => `<option value="${item.value}" ${item.value === current ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
    </select>`;
}

function renderTaskDeferredBadge(task = {}) {
    const raw = taskSnoozedUntil(task);
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    const label = date.toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    return `<span class="task-deferred-badge">Відкладено до ${escapeHtml(label)}</span>`;
}

function getVisibilityNote() {
    const visibility = userPermissions?.taskVisibility;
    const notes = [];
    if (visibility === 'own') notes.push('Показано тільки задачі, призначені вам');
    if (visibility === 'department') notes.push('Показано ваші задачі та задачі відділу');
    if (!taskCapabilityAllowed('create', userPermissions?.canCreateTasks !== false)) notes.push(taskCapabilityReason('create', false));
    return notes.join('; ');
}

function taskEmptyState(view, unfilteredCount = 0, columnLabel = '') {
    const hasCategory = currentCategory !== 'all';
    const hasSubcategory = supportsSubcategory(currentCategory) && currentSubcategory !== 'all';
    const category = hasSubcategory ? `${getCategoryLabel()} / ${getSubcategoryLabel()}` : getCategoryLabel();
    let title = columnLabel ? `Порожньо: ${columnLabel}` : 'Немає задач';
    let message = `У зрізі "${getViewLabel(view)}" немає задач.`;
    let clearAction = '';

    if (hasCategory && unfilteredCount > 0) {
        title = `Немає задач у категорії "${category}"`;
        message = `У зрізі "${getViewLabel(view)}" є задачі, але поточна категорія їх приховала.`;
        clearAction = 'tasks';
    } else if (hasCategory) {
        message = `У зрізі "${getViewLabel(view)}" зараз немає задач; активна категорія: "${category}".`;
        clearAction = 'tasks';
    }

    const visibilityNote = getVisibilityNote();
    if (visibilityNote) message += ` ${visibilityNote}.`;

    if (window.Explainability) {
        return Explainability.renderEmptyState({
            icon: '☑',
            title,
            message,
            clearAction,
            clearLabel: 'Показати всі задачі'
        });
    }

    return `<div class="empty-state">${escapeHtml(title)}<br><small>${escapeHtml(message)}</small></div>`;
}

function updateTaskExplainability() {
    const filters = [];
    const visibilityNote = getVisibilityNote();
    const canReset = currentCategory !== 'all' || currentSubcategory !== 'all' || currentView !== 'inbox' || currentScopeFilter !== 'all';
    if (currentView !== 'today') filters.push({ label: 'Вигляд', value: getViewLabel() });
    if (currentScopeFilter !== 'all') filters.push({ label: 'Тип', value: getTaskScopeLabel() });
    if (currentCategory !== 'all') filters.push({ label: 'Категорія', value: getCategoryLabel() });
    if (supportsSubcategory(currentCategory) && currentSubcategory !== 'all') filters.push({ label: 'Підкатегорія', value: getSubcategoryLabel() });

    const html = window.Explainability
        ? Explainability.renderFilterSummary(filters, {
            label: 'Зріз задач',
            note: visibilityNote,
            clearAction: canReset ? 'tasks' : '',
            clearLabel: 'Скинути зріз'
        })
        : '';
    if (window.Explainability) Explainability.setRegion('taskExplainability', html);
}

function resetTaskFilters() {
    currentCategory = 'all';
    currentSubcategory = 'all';
    currentScopeFilter = 'all';
    setBoardView('inbox', 'overview');
    renderCategoryFilters();
    renderSubcategoryFilters();
    syncTaskScopeFilters();
    syncTaskSurfaceVisibility();
    renderBoard();
}

function setupTaskGovernanceMenu() {
    const toggle = document.getElementById('tasksGovernanceToggle');
    const panel = document.getElementById('tasksGovernancePanel');
    const completedToggle = document.getElementById('toggleCompletedInSlices');
    if (!toggle || !panel) return;

    const syncCompletedToggle = () => {
        if (!completedToggle) return;
        completedToggle.classList.toggle('active', showCompletedInSlices);
        completedToggle.setAttribute('aria-pressed', showCompletedInSlices ? 'true' : 'false');
        completedToggle.textContent = showCompletedInSlices ? 'Виконані показані' : 'Показувати виконані';
    };
    syncCompletedToggle();

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = !panel.classList.contains('hidden');
        panel.classList.toggle('hidden', isOpen);
        toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });

    completedToggle?.addEventListener('click', () => {
        showCompletedInSlices = !showCompletedInSlices;
        localStorage.setItem('eg_tasks_show_completed', showCompletedInSlices ? 'true' : 'false');
        syncCompletedToggle();
        renderBoard();
    });

    panel.querySelectorAll('[data-task-governance-view]').forEach(button => {
        button.addEventListener('click', () => {
            activateTaskView(button.dataset.taskGovernanceView);
            panel.classList.add('hidden');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });

    panel.querySelectorAll('[data-task-governance-bulk]').forEach(button => {
        button.addEventListener('click', async () => {
            const action = button.dataset.taskGovernanceBulk;
            if (!getSelectedTaskIds().length) {
                showNotification('Спершу виберіть задачі чекбоксами', 'warning');
                return;
            }
            await bulkAction(action);
        });
    });

    document.getElementById('taskDedupReportBtn')?.addEventListener('click', async () => {
        const result = await apiGetTaskDedupReport();
        if (!result?.success) {
            showNotification('Не вдалося перевірити дублікати', 'error');
            return;
        }
        const groups = result.groups || [];
        const duplicateTotal = groups.reduce((sum, group) => sum + Number(group.duplicate_count || group.duplicateCount || 0), 0);
        showNotification(groups.length ? `Знайдено ${duplicateTotal} активних дублів у ${groups.length} групах. Звичайний список показує основні рядки.` : 'Активних дублів не знайдено', groups.length ? 'warning' : 'success');
    });

    document.getElementById('taskDedupCleanupBtn')?.addEventListener('click', async () => {
        const dryRun = await apiCleanupTaskDuplicates(true);
        const victims = Number(dryRun?.victims || 0);
        if (!victims) {
            showNotification('Очищення не потрібне: активних дублів немає', 'success');
            return;
        }
        if (!await confirmModal(`Архівувати ${victims} активних дублів без видалення історії?`, { type: 'warning', okText: 'Архівувати' })) return;
        const result = await apiCleanupTaskDuplicates();
        if (!result?.success) {
            showNotification('Очищення дублів не виконано', 'error');
            return;
        }
        showNotification(`Архівовано дублів: ${result.archived || 0}`, 'success');
        await loadAllTasks();
    });

    document.addEventListener('click', (event) => {
        if (panel.classList.contains('hidden')) return;
        if (panel.contains(event.target) || toggle.contains(event.target)) return;
        panel.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
    });
}

function updateCounts() {
    const today = getTodayStr();
    const week = getWeekRange();

    const active = filterByCategory(allTasks.filter(isActiveTask));
    const activeNotDeferred = active.filter(t => !isDeferredTask(t));
    const deferredTasks = active.filter(isDeferredTask);
    const doneToday = filterByCategory(allTasks.filter(isCompletedToday));
    const todayTasks = activeNotDeferred.filter(t => {
        const due = taskDueDate(t);
        return due === today || !due;
    });
    const weekTasks = activeNotDeferred.filter(t => {
        const due = taskDueDate(t);
        return due >= week.from && due <= week.to;
    });
    const myTasks = active.filter(isTaskInMyWorkspace);
    const nextTasks = activeNotDeferred.filter(t => {
        const due = taskDueDate(t);
        return due && due > today && due <= week.to;
    });
    const setCount = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setCount('countInbox', active.filter(isInboxTask).length);
    setCount('countToday', todayTasks.length);
    setCount('countWeek', weekTasks.length);
    setCount('countNext', nextTasks.length);
    setCount('countDeferred', deferredTasks.length);
    setCount('countWaiting', active.filter(isWaitingTask).length);
    setCount('countTeam', active.filter(isTeamTask).length);
    setCount('countMy', myTasks.length);
    setCount('countDoneToday', doneToday.length);
    setCount('summaryMy', myTasks.length);
    setCount('summaryToday', todayTasks.length);
    setCount('summaryWaiting', active.filter(isWaitingTask).length);
    setCount('summaryDoneToday', doneToday.length);
    setCount('taskCenterMetricMy', myTasks.length);
    setCount('taskCenterMetricToday', todayTasks.length);
    setCount('taskCenterMetricWaiting', active.filter(isWaitingTask).length);
    setCount('taskCenterMetricTeam', active.filter(isTeamTask).length);

    // A paged view knows its complete server-side total even before every page is
    // loaded; keep the active navigation counter truthful instead of reflecting a
    // partial client array.
    const total = Number(taskPagination?.total);
    if (!Number.isFinite(total) || taskPagination?.view !== currentView) return;
    const activeCountTargets = {
        inbox: ['countInbox'],
        today: ['countToday', 'summaryToday', 'taskCenterMetricToday'],
        next: ['countNext'],
        deferred: ['countDeferred'],
        waiting: ['countWaiting', 'summaryWaiting', 'taskCenterMetricWaiting'],
        team: ['countTeam', 'taskCenterMetricTeam'],
        week: ['countWeek'],
        my: ['countMy', 'summaryMy', 'taskCenterMetricMy'],
        done_today: ['countDoneToday', 'summaryDoneToday']
    };
    (activeCountTargets[currentView] || []).forEach(id => setCount(id, total));
}

function getTasksAssistantViewBase(view = currentView) {
    const today = getTodayStr();
    const week = getWeekRange();
    const active = allTasks.filter(isActiveTask);
    const activeNotDeferred = active.filter(t => !isDeferredTask(t));
    switch (view) {
        case 'today':
            return activeNotDeferred.filter(t => {
                const due = taskDueDate(t);
                return due === today || !due;
            });
        case 'next':
            return activeNotDeferred.filter(t => {
                const due = taskDueDate(t);
                return due && due > today && due <= week.to;
            });
        case 'deferred':
            return active.filter(isDeferredTask);
        case 'waiting':
            return active.filter(isWaitingTask);
        case 'team':
            return active.filter(isTeamTask);
        case 'week':
            return activeNotDeferred.filter(t => {
                const due = taskDueDate(t);
                return due >= week.from && due <= week.to;
            });
        case 'my':
            return active.filter(isTaskInMyWorkspace);
        case 'board':
            return allTasks.filter(t => t.status !== 'archived' && t.status !== 'cancelled');
        case 'routines':
            return active.filter(isRoutineTask);
        case 'done_today':
            return allTasks.filter(isCompletedToday);
        case 'archive':
            return allTasks.filter(t => t.status === 'archived');
        case 'inbox':
        default:
            return active.filter(isInboxTask);
    }
}

function getTasksAssistantCounts() {
    const today = getTodayStr();
    const week = getWeekRange();
    const inTwoDays = new Date();
    inTwoDays.setDate(inTwoDays.getDate() + 2);
    const nearDeadlineLimit = inTwoDays.toISOString().slice(0, 10);
    const active = filterByCategory(allTasks.filter(isActiveTask));
    const activeNotDeferred = active.filter(t => !isDeferredTask(t));
    const deferredTasks = active.filter(isDeferredTask);
    const doneToday = filterByCategory(allTasks.filter(isCompletedToday));
    const currentViewBase = filterByCategory(getTasksAssistantViewBase(currentView));
    const currentViewFiltered = applyAssistantTaskFilter(currentViewBase);
    const nextTasks = activeNotDeferred.filter(t => {
        const due = taskDueDate(t);
        return due && due > today && due <= week.to;
    });
    const todayTasks = activeNotDeferred.filter(t => {
        const due = taskDueDate(t);
        return due === today || !due;
    });
    return {
        loaded: allTasks.length,
        active: active.length,
        inbox: active.filter(isInboxTask).length,
        today: todayTasks.length,
        week: activeNotDeferred.filter(t => {
            const due = taskDueDate(t);
            return due >= week.from && due <= week.to;
        }).length,
        next: nextTasks.length,
        deferred: deferredTasks.length,
        waiting: active.filter(isWaitingTask).length,
        team: active.filter(isTeamTask).length,
        my: active.filter(isTaskInMyWorkspace).length,
        doneToday: doneToday.length,
        archive: filterByCategory(allTasks.filter(t => t.status === 'archived')).length,
        currentView: currentViewBase.length,
        currentVisible: currentViewFiltered.length,
        assistantFilteredOut: Math.max(0, currentViewBase.length - currentViewFiltered.length),
        overdue: active.filter(isOverdueTask).length,
        nearDeadline: activeNotDeferred.filter(t => {
            const due = taskDueDate(t);
            return due && due >= today && due <= nearDeadlineLimit;
        }).length,
        missingOwner: active.filter(t => !taskOwnerUserId(t) && !getTaskOwnerLabel(t)).length
    };
}

function taskCreatedAtValue(task = {}) {
    return task.createdAt || task.created_at || task.updatedAt || task.updated_at || '';
}

function sortTasksNewestFirst(tasks = []) {
    return tasks.slice().sort((a, b) => {
        const bTime = new Date(taskCreatedAtValue(b) || 0).getTime();
        const aTime = new Date(taskCreatedAtValue(a) || 0).getTime();
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });
}

function mapAssistantTaskItem(task = {}) {
    const assignment = getTaskAssignmentView(task);
    return {
        id: task.id,
        title: taskTextValue(task.title),
        status: task.status || '',
        workflowState: taskWorkflow(task),
        category: task.category || 'admin',
        subcategory: task.subcategory || '',
        date: task.date || '',
        deadline: task.deadline || task.remindAt || task.remind_at || '',
        scheduledStartAt: taskScheduleStart(task) || '',
        scheduleSlot: taskScheduleSlot(task) || '',
        scheduleStatus: taskScheduleStatus(task),
        ownerUserId: taskOwnerUserId(task),
        ownerLabel: getTaskOwnerLabel(task),
        createdBy: getTaskCreatedByLabel(task),
        createdAt: taskCreatedAtValue(task),
        assignmentLabel: assignment.label,
        isMine: isTaskOwnedByCurrentUser(task),
        isSelfCreatedPersonal: isSelfCreatedPersonalTask(task),
        isDelegatedByMe: isTaskDelegatedByCurrentUser(task),
        isOverdue: isOverdueTask(task)
    };
}

function getTasksAssistantSnapshot() {
    const currentViewBase = filterByCategory(getTasksAssistantViewBase(currentView));
    const currentViewTasks = sortTasksForDisplay(applyAssistantTaskFilter(currentViewBase));
    const activeScopedTasks = filterByCategory(allTasks.filter(isActiveTask));
    const recentTasks = sortTasksNewestFirst(activeScopedTasks).slice(0, 8);
    const myTasks = sortTasksForDisplay(activeScopedTasks.filter(isTaskOwnedByCurrentUser)).slice(0, 8);
    const delegatedByMeTasks = sortTasksNewestFirst(activeScopedTasks.filter(isTaskDelegatedByCurrentUser)).slice(0, 8);
    return {
        source: 'TasksPage.getAssistantSnapshot',
        loaded: Array.isArray(allTasks),
        currentView,
        currentViewLabel: getViewLabel(currentView),
        currentCategory,
        currentCategoryLabel: getCategoryLabel(currentCategory),
        currentSubcategory,
        currentSubcategoryLabel: getSubcategoryLabel(currentCategory, currentSubcategory),
        assistantFilter: assistantTaskFilter || '',
        counts: getTasksAssistantCounts(),
        topTasks: currentViewTasks.slice(0, 8).map(mapAssistantTaskItem),
        recentTasks: recentTasks.map(mapAssistantTaskItem),
        myTasks: myTasks.map(mapAssistantTaskItem),
        delegatedByMeTasks: delegatedByMeTasks.map(mapAssistantTaskItem)
    };
}

function renderOperationsSummary() {
    const host = document.getElementById('operationsSummary');
    if (!host) return;
    if (!supportsSubcategory(currentCategory)) {
        host.classList.add('hidden');
        host.innerHTML = '';
        return;
    }
    const visible = filterByTaxonomy(allTasks).filter(t => (t.category === 'orders' || t.category === 'checklist' || t.packId || t.pack_id) && isActiveTask(t));
    const packMap = new Map();
    let blocked = 0;
    let overdue = 0;
    const now = new Date();
    visible.forEach(task => {
        const packId = task.packId || task.pack_id || `task-${task.id}`;
        if (!packMap.has(packId)) {
            packMap.set(packId, {
                status: task.packStatus || task.pack_status || 'draft',
                readyToday: false
            });
        }
        if (Number(task.openDependencyCount || task.open_dependency_count || 0) > 0) blocked++;
        if (task.deadline && new Date(task.deadline) < now) overdue++;
        const due = taskDueDate(task);
        if ((task.packStatus || task.pack_status) === 'ready' && (!due || due <= getTodayStr())) {
            packMap.get(packId).readyToday = true;
        }
    });
    const stats = { draft: 0, inProduction: 0, ready: 0, blocked, overdue };
    packMap.forEach(pack => {
        if (pack.status === 'draft') stats.draft++;
        if (pack.status === 'in_production') stats.inProduction++;
        if (pack.status === 'ready' || pack.readyToday) stats.ready++;
    });
    host.classList.remove('hidden');
    host.hidden = false;
    host.innerHTML = `
        <div class="operations-summary-item"><span>${stats.draft}</span><small>Чернетки</small></div>
        <div class="operations-summary-item"><span>${stats.inProduction}</span><small>У виробництві</small></div>
        <div class="operations-summary-item"><span>${stats.ready}</span><small>Готові сьогодні</small></div>
        <div class="operations-summary-item ${stats.blocked ? 'is-hot' : ''}"><span>${stats.blocked}</span><small>Заблоковано</small></div>
        <div class="operations-summary-item ${stats.overdue ? 'is-hot' : ''}"><span>${stats.overdue}</span><small>Протерміновано</small></div>
    `;
}

function renderBoard() {
    const container = document.getElementById('boardContent');
    syncTaskSurfaceVisibility();
    updateCounts();
    updateTaskExplainability();
    renderMaysternyaTaskOpsBar();
    renderOperationsSummary();
    if (taskOverviewModeActive()) {
        renderTaskOverview(container);
        return;
    }
    if (taskTeamControlModeActive()) {
        renderTaskTeamControl(container);
        return;
    }

    switch (currentView) {
        case 'inbox': renderSimpleTaskView(container, 'inbox', t => isInboxTask(t), 'Інбокс чистий. Нові задачі без контексту зʼявлятимуться тут.', t => taskWorkflow(t) === 'inbox' || (!t.date && !t.deadline)); break;
        case 'today': renderTodayView(container); break;
        case 'next': renderSimpleTaskView(container, 'next', t => {
            const today = getTodayStr();
            const week = getWeekRange();
            const due = taskDueDate(t);
            return isActiveTask(t) && !isDeferredTask(t) && due && due > today && due <= week.to;
        }, 'На найближчі дні нічого не заплановано.', t => {
            const today = getTodayStr();
            const week = getWeekRange();
            const due = taskDueDate(t) || (taskCompletedAt(t) || '').slice(0, 10);
            return due && due > today && due <= week.to;
        }); break;
        case 'deferred': renderSimpleTaskView(container, 'deferred', t => isActiveTask(t) && isDeferredTask(t), 'Відкладених задач немає.', isDeferredTask); break;
        case 'waiting': renderSimpleTaskView(container, 'waiting', t => isActiveTask(t) && isWaitingTask(t), 'Немає задач у стані “чекаю”.', isWaitingTask); break;
        case 'team': renderSimpleTaskView(container, 'team', t => isActiveTask(t) && isTeamTask(t), 'Командних задач у цьому зрізі немає.', isTeamTask); break;
        case 'week': renderWeekView(container); break;
        case 'my': renderMyView(container); break;
        case 'board': renderKanbanView(container); break;
        case 'routines': renderSimpleTaskView(container, 'routines', t => isActiveTask(t) && isRoutineTask(t), 'Рутини поки не налаштовані.', isRoutineTask); break;
        case 'done_today': renderDoneTodayView(container); break;
        case 'archive': renderArchiveView(container); break;
        default: renderSimpleTaskView(container, 'inbox', t => isInboxTask(t), 'Інбокс чистий.');
    }
    renderTaskPagination(container);
}

function renderTaskOverview(container) {
    if (!container) return;
    if (taskOverviewLoading) {
        container.innerHTML = '<div class="loading-spinner">Завантаження операційного огляду…</div>';
        return;
    }
    if (taskOverviewError || !taskOverviewProjection) {
        container.innerHTML = '<div class="empty-state">Не вдалося завантажити операційний огляд. <button type="button" class="btn-secondary" data-task-retry>Повторити</button></div>';
        return;
    }
    const counts = taskOverviewProjection.counts || {};
    const queue = Array.isArray(taskOverviewProjection.queue) ? taskOverviewProjection.queue : [];
    const countItems = [
        ['overdue', 'Прострочено'], ['urgent', 'Термінові'], ['blocked', 'Заблоковано'],
        ['unassigned', 'Без відповідального'], ['stale', 'Без руху'], ['due_today', 'Термін сьогодні']
    ].filter(([code]) => Number(counts[code] || 0) > 0);
    const countHtml = countItems.length
        ? `<div class="task-overview-counts" aria-label="Причини, що потребують рішення">${countItems.map(([code, label]) => `<span class="task-overview-count" data-exception="${code}"><strong>${Number(counts[code] || 0)}</strong> ${escapeHtml(label)}</span>`).join('')}</div>`
        : '';
    const meta = taskOverviewProjection.meta || {};
    if (!queue.length) {
        container.innerHTML = `<section class="task-overview" aria-live="polite"><header class="task-overview-header"><div><p class="task-overview-eyebrow">Операційний огляд</p><h2>Винятків, що потребують рішення, немає</h2><p>Перевірено ${Number(meta.activeTotal || 0)} активних задач у доступному контексті.</p></div></header>${countHtml}</section>`;
        return;
    }
    const queueHtml = queue.map(item => {
        const reasons = Array.isArray(item.reasons) ? item.reasons : [];
        const reasonHtml = reasons.map(entry => {
            const duration = Number.isFinite(Number(entry.riskDays)) && Number(entry.riskDays) > 0
                ? ` · ${Number(entry.riskDays)} дн.`
                : '';
            return `<span class="task-overview-reason" data-exception="${escapeHtml(entry.code)}">${escapeHtml(entry.label)}${duration}</span>`;
        }).join('');
        const task = item.task || {};
        const taskId = Number(task.id || 0);
        const due = task.schedule?.date || task.scheduledDate || task.date || task.deadline || 'Без дати';
        const owner = task.ownerLabel || task.owner_name || task.assigned_to || task.owner || 'Не призначено';
        return `<article class="task-overview-item"><div class="task-overview-item-head"><div class="task-overview-reasons">${reasonHtml}</div><span class="task-overview-action">Рекомендована дія: ${escapeHtml(item.recommendedAction || '')}</span></div><div class="task-card task-work-row" data-task-open="true" data-task-id="${taskId}" tabindex="0" role="button" aria-label="Відкрити задачу: ${escapeHtml(task.title || 'Без назви')}"><div class="task-card-title">${escapeHtml(task.title || 'Без назви')}</div><div class="task-card-meta"><span>${escapeHtml(owner)}</span><span>${escapeHtml(String(due).slice(0, 10))}</span></div><div class="task-card-actions task-row-actions"><button type="button" class="task-row-primary" data-task-action="open-detail" data-task-id="${taskId}">Відкрити деталі</button></div></div></article>`;
    }).join('');
    const more = meta.hasMore ? `<p class="task-overview-more">Показано ${Number(meta.returned || queue.length)} з ${Number(meta.exceptionTotal || queue.length)} задач. Звузьте контекст або відкрийте деталі потрібної задачі.</p>` : '';
    container.innerHTML = `<section class="task-overview" aria-live="polite"><header class="task-overview-header"><div><p class="task-overview-eyebrow">Операційний огляд</p><h2>Черга винятків</h2><p>Причина та рекомендована дія показані для кожної задачі. Перевірено ${Number(meta.activeTotal || 0)} активних задач без залежності від pagination.</p></div></header>${countHtml}<div class="task-overview-queue">${queueHtml}</div>${more}</section>`;
}
function taskTeamControlMetric(label, value, tone = '') {
    return `<span class="task-team-metric ${tone ? `is-${tone}` : ''}"><strong>${Number(value || 0)}</strong>${escapeHtml(label)}</span>`;
}

function taskTeamControlFiltersHtml(projection) {
    const meta = projection.meta || {};
    const owners = (projection.owners || []).filter(owner => owner.ownerUserId);
    const departments = [...new Set(owners.map(owner => owner.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
    const filters = normalizeTaskTeamControlFilters();
    const ownerOptions = owners.map(owner => `<option value="${owner.ownerUserId}" ${String(filters.ownerUserId) === String(owner.ownerUserId) ? 'selected' : ''}>${escapeHtml(owner.ownerLabel)}</option>`).join('');
    const departmentOptions = departments.map(department => `<option value="${escapeHtml(department)}" ${filters.department === department ? 'selected' : ''}>${escapeHtml(department)}</option>`).join('');
    return `<div class="task-team-filters" role="group" aria-label="Фільтри командного контролю">
        <label>Від <input type="date" value="${escapeHtml(filters.from)}" data-task-team-filter="from"></label>
        <label>До <input type="date" value="${escapeHtml(filters.to)}" data-task-team-filter="to"></label>
        <label>Відповідальний <select data-task-team-filter="ownerUserId"><option value="">Усі</option>${ownerOptions}</select></label>
        ${meta.capacityAvailable ? `<label>Відділ <select data-task-team-filter="department"><option value="">Усі</option>${departmentOptions}</select></label>` : ''}
        <label>Статус <select data-task-team-filter="status"><option value="">Активні</option><option value="todo" ${filters.status === 'todo' ? 'selected' : ''}>До виконання</option><option value="in_progress" ${filters.status === 'in_progress' ? 'selected' : ''}>У роботі</option><option value="waiting" ${filters.status === 'waiting' ? 'selected' : ''}>Чекаю</option></select></label>
        <span class="task-team-context">Контекст: ${escapeHtml(taskBusinessContext())}</span>
    </div>`;
}

function renderTaskTeamControl(container) {
    if (!container) return;
    if (taskTeamControlLoading) {
        container.innerHTML = '<div class="loading-spinner">Завантаження командного контролю…</div>';
        return;
    }
    if (taskTeamControlError || !taskTeamControlProjection) {
        container.innerHTML = '<div class="empty-state">Не вдалося завантажити командний контроль. <button type="button" class="btn-secondary" data-task-retry>Повторити</button></div>';
        return;
    }
    const projection = taskTeamControlProjection;
    const meta = projection.meta || {};
    const heading = currentTaskMode === 'planning' ? 'Планування навантаження' : 'Контроль команди';
    const capacityNote = meta.capacityAvailable
        ? 'Capacity розрахована з доступного HR-графіка.'
        : 'Capacity unavailable: ваш доступ не включає HR-графік; нулі не підставляються.';
    const filters = taskTeamControlFiltersHtml(projection);
    if (currentTaskMode === 'planning') {
        const header = projection.dates.map(date => `<th scope="col">${escapeHtml(formatDateShort(date))}</th>`).join('');
        const rows = projection.owners.map(owner => {
            const cells = owner.days.map(day => {
                const capacity = day.capacity?.status === 'available'
                    ? `${day.capacity.minutes} хв`
                    : 'capacity unavailable';
                const overload = Number(day.overloadMinutes || 0) > 0 ? `<b>+${day.overloadMinutes} хв</b>` : '';
                const scheduled = day.scheduledTasks.length
                    ? day.scheduledTasks.map(item => `<button type="button" data-task-action="open-detail" data-task-id="${item.task.id}">${escapeHtml(item.task.title || 'Без назви')}</button>`).join('')
                    : '<span>—</span>';
                return `<td class="${Number(day.overloadMinutes || 0) > 0 ? 'is-overload' : ''}"><small>${escapeHtml(capacity)}</small><strong>${day.scheduledEffortMinutes} хв</strong>${overload}<div class="task-planning-day-tasks">${scheduled}</div></td>`;
            }).join('');
            return `<tr><th scope="row"><strong>${escapeHtml(owner.ownerLabel)}</strong><small>${owner.metrics.knownEffortMinutes} хв відомого effort · ${owner.metrics.unknownEffortTasks} без оцінки</small></th>${cells}</tr>`;
        }).join('');
        const unscheduled = (projection.unscheduled || []).slice(0, 50).map(item => {
            const task = item.task || {};
            const canSchedule = task.drawer?.actions?.reschedule !== false;
            return `<article class="task-planning-unscheduled" data-team-plan-task="${task.id}"><div><strong>${escapeHtml(task.title || 'Без назви')}</strong><small>${escapeHtml(item.ownerLabel || 'Не призначено')} · ${item.facts?.effortMinutes ?? 'без effort'} хв</small></div><label><span>Дата</span><input type="date" value="${escapeHtml(meta.from || getTodayStr())}" data-task-team-plan-date="${task.id}"></label><label><span>Слот</span><select data-task-team-plan-slot="${task.id}"><option value="morning">Ранок</option><option value="midday">День</option><option value="afternoon">Після обіду</option><option value="evening">Вечір</option></select></label><button type="button" class="btn-secondary" data-task-team-schedule="${task.id}" ${canSchedule ? '' : 'disabled'}>Запланувати</button><button type="button" class="btn-secondary" data-task-action="open-detail" data-task-id="${task.id}">Деталі</button></article>`;
        }).join('') || '<div class="empty-state">Усі доступні задачі вже мають слот або немає доступних задач.</div>';
        container.innerHTML = `<section class="task-team-control" aria-live="polite"><header><p class="task-overview-eyebrow">Центр задач</p><h2>${heading}</h2><p>${escapeHtml(capacityNote)}</p></header>${filters}<div class="task-planning-table-wrap"><table class="task-planning-table"><thead><tr><th>Відповідальний</th>${header}</tr></thead><tbody>${rows}</tbody></table></div><section class="task-planning-unscheduled-list"><h3>Без слоту</h3>${unscheduled}</section></section>`;
        return;
    }
    const cards = projection.owners.map(owner => {
        const m = owner.metrics;
        const capacity = meta.capacityAvailable
            ? `${owner.overloadDays ? `Перевантажено днів: ${owner.overloadDays}` : 'Перевантаження не виявлено'}`
            : 'capacity unavailable';
        return `<article class="task-team-owner-card"><header><div><h3>${escapeHtml(owner.ownerLabel)}</h3><p>${escapeHtml(owner.department || 'Відділ недоступний')}</p></div><button type="button" class="btn-secondary" data-task-team-owner-open="${owner.ownerUserId || ''}" ${owner.ownerUserId ? '' : 'disabled'}>Показати задачі</button></header><div class="task-team-metrics">${taskTeamControlMetric('активні', m.active)}${taskTeamControlMetric('прострочені', m.overdue, 'danger')}${taskTeamControlMetric('термінові', m.urgent, 'danger')}${taskTeamControlMetric('заблоковані', m.blocked, 'danger')}${taskTeamControlMetric('до 3 днів', m.dueSoon)}${taskTeamControlMetric('без дати', m.noDate)}${taskTeamControlMetric('хв effort', m.knownEffortMinutes)}${taskTeamControlMetric('без оцінки', m.unknownEffortTasks)}</div><p class="task-team-capacity">${escapeHtml(capacity)} · у слотах: ${m.scheduledEffortMinutes} хв · без слоту: ${m.unscheduledTasks}</p></article>`;
    }).join('') || '<div class="empty-state">У доступному контексті немає активних командних задач.</div>';
    container.innerHTML = `<section class="task-team-control" aria-live="polite"><header><p class="task-overview-eyebrow">Центр задач</p><h2>${heading}</h2><p>${escapeHtml(capacityNote)}</p></header>${filters}<div class="task-team-owner-grid">${cards}</div></section>`;
}

async function scheduleTaskFromTeamControl(button) {
    const taskId = Number(button.dataset.taskTeamSchedule || 0);
    if (!taskId || !guardTaskWrite('планувати задачі')) return;
    const date = document.querySelector(`[data-task-team-plan-date="${taskId}"]`)?.value || getTodayStr();
    const slot = document.querySelector(`[data-task-team-plan-slot="${taskId}"]`)?.value || 'morning';
    const item = taskTeamControlProjection?.unscheduled?.find(entry => Number(entry.task?.id) === taskId);
    const durationMinutes = Number(item?.facts?.effortMinutes) || 30;
    const previous = taskTeamControlProjection;
    taskTeamControlProjection = {
        ...previous,
        unscheduled: (previous?.unscheduled || []).filter(entry => Number(entry.task?.id) !== taskId)
    };
    button.disabled = true;
    renderBoard();
    const result = await apiScheduleTask(taskId, { schedule: { date, slot, durationMinutes }, sourceSurface: 'task_page' });
    if (!result?.success) {
        taskTeamControlProjection = previous;
        renderBoard();
        showNotification(result?.error || 'Не вдалося запланувати задачу; зміни відкочено', 'error');
        return;
    }
    showNotification((result.proposals || []).length ? 'Слот зайнятий: збережено пропозицію часу' : 'Задачу заплановано', (result.proposals || []).length ? 'info' : 'success');
    await loadTaskTeamControl();
}
function renderSimpleTaskView(container, view, predicate, emptyText, completedPredicate = predicate) {
    const activeBase = allTasks.filter(predicate);
    const completedBase = showCompletedInSlices ? allTasks.filter(t => t.status === 'done' && completedPredicate(t)) : [];
    const baseTasks = composeSliceTasks(activeBase, completedBase);
    const tasks = sortTasksForDisplay(applyAssistantTaskFilter(filterByCategory(baseTasks)));
    if (!tasks.length) {
        container.innerHTML = taskEmptyState(view, baseTasks.length) || `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
        return;
    }
    container.innerHTML = tasks.map(t => renderTaskCard(t)).join('');
}

// ==========================================
// VIEW: TODAY
// ==========================================

function renderTodayView(container) {
    const today = getTodayStr();
    const activeBase = allTasks.filter(t => {
        if (!isActiveTask(t) || isDeferredTask(t)) return false;
        const due = taskDueDate(t);
        return due === today || !due;
    });
    const completedBase = allTasks.filter(t => t.status === 'done' && (t.date === today || isCompletedToday(t)));
    const baseTasks = composeSliceTasks(activeBase, completedBase);
    let tasks = baseTasks;
    tasks = filterByCategory(tasks);
    tasks = applyAssistantTaskFilter(tasks);

    if (tasks.length === 0) {
        container.innerHTML = taskEmptyState('today', baseTasks.length);
        return;
    }

    // Group by category
    const groups = {};
    for (const t of tasks) {
        const cat = t.category || 'admin';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(t);
    }

    let html = '';
    const categoryOrder = getTopLevelTaskCategoryOrder();
    const orderedCats = [...categoryOrder, 'operational', 'maintenance', ...Object.keys(groups).filter(cat => !categoryOrder.includes(cat) && !['operational', 'maintenance'].includes(cat))];
    for (const cat of orderedCats) {
        if (!groups[cat]) continue;
        const info = getCategoryConfig(cat);
        html += `<div class="group-header">${info.icon} ${info.label} <span style="font-size:12px;color:var(--gray-400)">(${groups[cat].length})</span></div>`;
        html += sortTasksForDisplay(groups[cat]).map(t => renderTaskCard(t)).join('');
    }
    container.innerHTML = html;
}

// ==========================================
// VIEW: WEEK
// ==========================================

function renderWeekView(container) {
    const week = getWeekRange();
    const activeBase = allTasks.filter(t => {
        if (!isActiveTask(t) || isDeferredTask(t)) return false;
        const due = taskDueDate(t);
        return due >= week.from && due <= week.to;
    });
    const completedBase = allTasks.filter(t => {
        if (t.status !== 'done') return false;
        const due = taskDueDate(t) || (taskCompletedAt(t) || '').slice(0, 10);
        return due >= week.from && due <= week.to;
    });
    const baseTasks = composeSliceTasks(activeBase, completedBase);
    let tasks = baseTasks;
    tasks = filterByCategory(tasks);
    tasks = applyAssistantTaskFilter(tasks);

    if (tasks.length === 0) {
        container.innerHTML = taskEmptyState('week', baseTasks.length);
        return;
    }

    // Group by date
    const groups = {};
    for (const t of tasks) {
        const d = t.date || 'no-date';
        if (!groups[d]) groups[d] = [];
        groups[d].push(t);
    }

    let html = '';
    const sortedDates = Object.keys(groups).sort();
    for (const date of sortedDates) {
        const label = date === 'no-date' ? 'Без дати' : formatDateShort(date);
        const isToday = date === getTodayStr();
        html += `<div class="group-header">${isToday ? '<strong>' : ''}${label}${isToday ? '</strong>' : ''} <span style="font-size:12px;color:var(--gray-400)">(${groups[date].length})</span></div>`;
        html += sortTasksForDisplay(groups[date]).map(t => renderTaskCard(t)).join('');
    }
    container.innerHTML = html;
}

// ==========================================
// VIEW: MY TASKS
// ==========================================

function renderMyView(container) {
    const activeBase = allTasks.filter(t => isTaskInMyWorkspace(t) && isActiveTask(t));
    const completedBase = allTasks.filter(t => t.status === 'done' && isTaskInMyWorkspace(t));
    const baseTasks = composeSliceTasks(activeBase, completedBase);
    let tasks = baseTasks;
    tasks = filterByCategory(tasks);
    tasks = applyAssistantTaskFilter(tasks);

    if (tasks.length === 0) {
        container.innerHTML = taskEmptyState('my', baseTasks.length);
        return;
    }

    const owned = tasks.filter(isTaskOwnedByCurrentUser).length;
    const delegated = tasks.filter(isTaskDelegatedByCurrentUser).length;
    const selfPersonal = tasks.filter(isSelfCreatedPersonalTask).length;
    const summary = `
        <div class="task-my-scope-summary" aria-label="Моя зона задач">
            <span class="task-my-scope-pin"><b>${selfPersonal}</b> особисті зверху</span>
            <span><b>${owned}</b> мені</span>
            <span><b>${delegated}</b> я поставив команді</span>
        </div>`;
    container.innerHTML = summary + sortTasksForDisplay(tasks).map(t => renderTaskCard(t)).join('');
}

function renderDoneTodayView(container) {
    const baseTasks = allTasks.filter(isCompletedToday);
    let tasks = filterByCategory(baseTasks).sort(sortCompletedNewestFirst);
    tasks = applyAssistantTaskFilter(tasks);
    if (!tasks.length) {
        container.innerHTML = taskEmptyState('done_today', baseTasks.length) || '<div class="empty-state">Сьогодні ще нічого не завершено.</div>';
        return;
    }
    const html = `
        <div class="done-today-board-note">
            <b>${tasks.length}</b> виконано сьогодні · новіші першими · історія лишається в системі
        </div>
        ${tasks.map(t => renderTaskCard(t)).join('')}
    `;
    container.innerHTML = html;
}

// ==========================================
// VIEW: KANBAN
// ==========================================

function renderKanbanColumn(status, label, tasks, baseCount) {
    const cards = tasks.length
        ? tasks.map(t => renderTaskCard(t)).join('')
        : taskEmptyState('board', baseCount, label);
    return `
            <div class="kanban-col" data-kanban-status="${escapeHtml(status)}" aria-label="${escapeHtml(label)}">
                <div class="kanban-col-header">
                    ${escapeHtml(label)} <span class="kanban-col-count">${tasks.length}</span>
                </div>
                <div class="kanban-drop-zone" data-kanban-status="${escapeHtml(status)}">
                    ${cards}
                </div>
            </div>`;
}

function renderKanbanView(container) {
    const baseTasks = allTasks.filter(t => t.status !== 'archived' && t.status !== 'cancelled');
    let tasks = applyAssistantTaskFilter(filterByCategory(baseTasks));

    const todo = sortTasksForDisplay(tasks.filter(t => t.status === 'todo'));
    const inProgress = sortTasksForDisplay(tasks.filter(t => t.status === 'in_progress'));
    const done = sortTasksForDisplay(tasks.filter(t => t.status === 'done'));

    container.innerHTML = `
        <div class="kanban">
            ${renderKanbanColumn('todo', 'До виконання', todo, baseTasks.filter(t => t.status === 'todo').length)}
            ${renderKanbanColumn('in_progress', 'В роботі', inProgress, baseTasks.filter(t => t.status === 'in_progress').length)}
            ${renderKanbanColumn('done', 'Готово', done, baseTasks.filter(t => t.status === 'done').length)}
        </div>`;
}

// ==========================================
// VIEW: ARCHIVE (v40.5)
// ==========================================
function renderArchiveView(container) {
    const baseArchived = allTasks.filter(t => t.status === 'archived');
    const archived = filterByCategory(baseArchived);
    if (!archived.length) {
        container.innerHTML = taskEmptyState('archive', baseArchived.length);
        return;
    }
    container.innerHTML = `<div style="margin-bottom:12px;color:var(--gray-500);font-size:13px">📦 Архівованих задач: ${archived.length}</div>` +
        archived.slice(0, 50).map(t => {
            const reason = t.archive_reason === 'auto_expired' ? 'Прострочена' : ['auto_duplicate', 'auto_duplicate_v2'].includes(t.archive_reason) ? 'Дублікат' : t.archive_reason || 'Архів';
            return `<div class="task-card status-done" style="opacity:0.7" data-task-id="${t.id}">
                <div class="task-card-title">${escapeHtml(t.title)}</div>
                <div class="task-card-meta">
                    <span>📦 ${reason}</span>
                    ${t.date ? `<span>${formatDateShort(t.date)}</span>` : ''}
                    ${t.archived_at ? `<span>Архів: ${new Date(t.archived_at).toLocaleDateString('uk-UA')}</span>` : ''}
                </div>
                <div class="task-card-actions">
                    <button class="btn-status" data-task-action="restore" data-task-id="${t.id}" style="background:var(--primary);color:#fff">🔄 Відновити</button>
                </div>
            </div>`;
        }).join('');
}

async function restoreTask(taskId) {
    const result = await apiPatchTaskStatus(taskId, 'todo');
    const mutation = normalizeTaskMutationResult(result, 'Не вдалося відновити задачу');
    if (mutation.success) {
        // Clear archive fields
        await taskApiFetchWithAuth(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'todo', health_score: 50 })
        }).catch(() => {});
        if (typeof showNotification === 'function') showNotification('Задачу відновлено', 'success');
        await loadAllTasks();
    } else if (typeof showNotification === 'function') {
        showNotification(mutation.error, 'error');
    }
}

// ==========================================
// HEALTH BADGE (v40.5)
// ==========================================
function getHealthBadge(score) {
    if (score === undefined || score === null) return '';
    if (score > 70) return '';
    if (score > 40) return '<span style="color:#f97316;font-size:10px;margin-left:4px" title="Потребує уваги">⚠️</span>';
    if (score > 0) return '<span style="color:#ef4444;font-size:10px;margin-left:4px" title="Критично">🔴</span>';
    return '<span style="color:#6b7280;font-size:10px;margin-left:4px" title="Архівована">📦</span>';
}

// ==========================================
// TASK CARD
// ==========================================

function renderTaskSubtaskProgress(t) {
    const summary = taskSubtaskSummary(t);
    if (!summary.total) return '';
    const label = `${summary.done}/${summary.total} підзадач · ${summary.progress}%`;
    return `<div class="task-subtask-progress" title="${escapeHtml(label)}">
        <div class="task-subtask-progress-fill" style="width:${summary.progress}%"></div>
    </div>
    <span class="task-subtask-progress-label">${escapeHtml(label)}</span>`;
}

function normalizeTaskCardSubtask(item = {}) {
    const id = item.id || item.subtaskId || item.subtask_id || '';
    return {
        id,
        title: item.title || '',
        isDone: item.is_done === true || item.isDone === true
    };
}

function cachedTaskSubtasks(taskId, task = {}) {
    if (taskCardSubtaskCache.has(Number(taskId))) return taskCardSubtaskCache.get(Number(taskId));
    if (Array.isArray(task.subtasks)) return task.subtasks.map(normalizeTaskCardSubtask);
    return null;
}

function isTaskSubtasksExpanded(taskId, task = {}) {
    const id = Number(taskId);
    if (!id) return false;
    if (collapsedTaskSubtaskIds.has(id)) return false;
    if (expandedTaskSubtaskIds.has(id)) return true;
    return Array.isArray(cachedTaskSubtasks(id, task));
}

function taskSubtaskCompletionTitle(task = {}) {
    const summary = taskSubtaskSummary(task);
    if (!summary.total) return '';
    return summary.done >= summary.total
        ? 'Усі підпункти закриті. Задачу можна виконати.'
        : `Спочатку закрийте всі підпункти: ${summary.done}/${summary.total}.`;
}

function renderTaskCardSubtasksPanel(task = {}) {
    const summary = taskSubtaskSummary(task);
    if (!summary.total) return '';
    const taskId = Number(task.id || 0);
    const expanded = isTaskSubtasksExpanded(taskId, task);
    const subtasks = cachedTaskSubtasks(taskId, task);
    let body = '<div class="task-card-subtasks-empty">Розгорніть, щоб виконувати підпункти прямо тут.</div>';
    if (expanded && loadingTaskSubtaskIds.has(taskId)) {
        body = '<div class="task-card-subtasks-empty">Завантажую підпункти...</div>';
    } else if (expanded && Array.isArray(subtasks)) {
        body = subtasks.length
            ? subtasks.map(item => {
                const subtask = normalizeTaskCardSubtask(item);
                return `<label class="task-card-subtask-item ${subtask.isDone ? 'is-done' : ''}">
                    <input type="checkbox" data-task-subtask-done data-task-id="${taskId}" data-subtask-id="${escapeHtml(subtask.id)}" ${subtask.isDone ? 'checked' : ''}>
                    <span>${escapeHtml(subtask.title || 'Підпункт без назви')}</span>
                </label>`;
            }).join('')
            : '<div class="task-card-subtasks-empty">Підпункти не знайдені.</div>';
    }
    return `<div class="task-card-subtasks-panel" data-task-subtasks-panel="${taskId}" ${expanded ? '' : 'hidden'}>
        <div class="task-card-subtasks-head">
            <span>Підпункти можна закривати у будь-якому порядку</span>
            <b>${summary.done}/${summary.total}</b>
        </div>
        <div class="task-card-subtasks-list">${body}</div>
    </div>`;
}

function taskControlMeta(task = {}) {
    const value = task.controlMeta || task.control_meta || {};
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function taskAllowsReschedule(task = {}) {
    const meta = taskControlMeta(task);
    const explicitFalse = value => value === false || value === 'false' || value === '0' || value === 0 || value === 'off' || value === 'no';
    return !explicitFalse(task.canReschedule)
        && !explicitFalse(task.allowReschedule)
        && !explicitFalse(meta.canReschedule)
        && !explicitFalse(meta.allowReschedule)
        && !explicitFalse(meta.rescheduleAllowed);
}

function renderTaskRescheduleMenu(taskId) {
    const id = Number(taskId || 0);
    if (!id) return '';
    const options = [
        ['tomorrow', 'Завтра'],
        ['day_after', 'Післязавтра'],
        ['custom', 'Обрати дату']
    ];
    return `<div class="task-reschedule-menu" role="menu" hidden>
        ${options.map(([option, label]) => `<button type="button" role="menuitem" data-task-action="reschedule-overdue" data-task-id="${id}" data-reschedule-option="${option}">${escapeHtml(label)}</button>`).join('')}
    </div>`;
}

function renderTaskDeadlineBadge(task = {}) {
    if (!task.deadline) return '';
    const dl = new Date(task.deadline);
    if (Number.isNaN(dl.getTime())) return '';
    const now = new Date();
    const diffMin = (dl - now) / (1000 * 60);
    let dlClass = 'deadline-ok';
    if (diffMin < 0) dlClass = 'deadline-overdue';
    else if (diffMin < 60) dlClass = 'deadline-soon';
    const taskId = Number(task.id || 0);
    const canReschedule = taskAllowsReschedule(task);
    if (diffMin < 0 && taskId) {
        const dlDate = dl.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric' });
        return `<span class="task-overdue-wrap">
            <button type="button" class="task-card-deadline ${dlClass} task-overdue-trigger" data-task-action="reschedule-overdue-menu" data-task-id="${taskId}" aria-haspopup="menu" aria-expanded="false" ${canReschedule ? '' : 'disabled'} title="${canReschedule ? 'Перенести прострочену задачу' : 'Перенесення вимкнено для цієї задачі'}">Прострочено · ${escapeHtml(dlDate)}</button>
            ${canReschedule ? renderTaskRescheduleMenu(taskId) : ''}
        </span>`;
    }
    const dlTime = dl.toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
    const dlDate = dl.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
    return `<span class="task-card-deadline ${dlClass}">${dlDate} ${dlTime}</span>`;
}

function renderTaskRowMoreAction(taskId = 0) {
    const id = Number(taskId || 0);
    if (!id) return '';
    return `<button type="button" class="task-row-more" data-task-action="more" data-task-id="${id}" aria-haspopup="dialog" aria-label="Більше дій">...</button>`;
}

function taskHasFixedSchedule(task = {}) {
    return Boolean(taskScheduleStart(task) || task.scheduledStartAt || task.scheduled_start_at || task.schedule?.startAt);
}

async function apiPutTaskPartial(taskId, patch = {}) {
    const id = Number(taskId || 0);
    if (!id) return { success: false, error: 'Invalid task id' };
    const task = allTasks.find(item => Number(item.id) === id) || {};
    const body = {
        title: task.title || 'Без назви',
        ...(task.version !== undefined ? { version: task.version } : {}),
        ...patch
    };
    const response = await taskApiFetchWithAuth(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
    }).catch(() => null);
    if (!response) return { success: false, error: 'Task update failed' };
    if (handleAuthError(response)) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: payload.error || payload.message || `Task update failed (${response.status})` };
    return payload;
}

function taskRowMoveTargets(task = {}) {
    const taskId = Number(task.id || 0);
    const canReschedule = taskAllowsReschedule(task) && taskId > 0;
    const hasFixedSchedule = taskHasFixedSchedule(task);
    const today = getTodayStr();
    const taskDate = taskScheduleDate(task);
    return [
        { id: 'today', label: 'Сьогодні', detail: 'перенести в поточний день', enabled: canReschedule && taskDate !== today },
        { id: 'tomorrow', label: 'Завтра', detail: 'перепланувати дедлайн', enabled: canReschedule },
        { id: 'snooze_hour', label: 'Відкласти... +1 год', detail: 'через наявний snooze', enabled: canReschedule },
        { id: 'snooze_custom', label: 'Відкласти... інша дата', detail: 'обрати дату вручну', enabled: canReschedule },
        { id: 'no_date', label: 'Без дати', detail: hasFixedSchedule ? 'недоступно для задачі зі слотом' : 'прибрати дату і дедлайн', enabled: canReschedule && !hasFixedSchedule },
        { id: 'waiting', label: 'Чекаю', detail: 'перевести в очікування', enabled: !isWaitingTask(task) },
        { id: 'open', label: 'Відкрити деталі', detail: 'повна форма задачі', enabled: true }
    ];
}

function renderTaskRowMenuItems(task = {}) {
    const taskId = Number(task.id || 0);
    const moveItems = taskRowMoveTargets(task).map(target => ({
        label: target.label,
        detail: target.detail,
        disabled: target.enabled === false,
        tone: target.id === 'today' ? 'primary' : '',
        attrs: {
            'data-task-action': target.id === 'open' ? 'open-detail' : 'move-target',
            'data-task-move-target': target.id,
            'data-task-id': taskId
        }
    }));
    const scheduleItems = TASK_SCHEDULE_SLOTS.map(slot => ({
        label: `Запланувати: ${slot.label}`,
        detail: 'швидкий слот дня',
        attrs: {
            'data-task-action': 'schedule',
            'data-task-id': taskId,
            'data-schedule-slot-action': slot.key
        }
    }));
    const priorityItems = TASK_PRIORITY_OPTIONS.map(item => ({
        label: `Пріоритет: ${item.label}`,
        detail: 'оновити без відкриття деталей',
        attrs: {
            'data-task-action': 'priority-menu',
            'data-task-id': taskId,
            'data-priority': item.value
        }
    }));
    const deleteDecision = taskCapabilityDecision('delete', userPermissions?.canDeleteTasks === true);
    const destructiveItems = [{
        label: '\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438 \u0437\u0430\u0434\u0430\u0447\u0443',
        detail: deleteDecision.allowed ? '\u043d\u0435\u0437\u0432\u043e\u0440\u043e\u0442\u043d\u0430 \u0434\u0456\u044f' : taskPermissionReasonLabel(deleteDecision.reasonCode),
        tone: 'danger',
        disabled: !deleteDecision.allowed,
        attrs: { 'data-task-action': 'delete', 'data-task-id': taskId }
    }];
    return window.TaskUI?.renderMenuItems([
        ...moveItems,
        ...scheduleItems,
        ...priorityItems,
        ...destructiveItems
    ]) || '';
}

function openTaskRowActionMenu(button) {
    const taskId = Number(button?.dataset?.taskId || 0);
    const task = allTasks.find(item => Number(item.id) === taskId) || {};
    if (!taskId || !window.TaskUI?.openActionMenu) {
        if (taskId) openTaskDetail(taskId);
        return;
    }
    const root = window.TaskUI.openActionMenu(button, renderTaskRowMenuItems(task), { title: 'Дії задачі' });
    root?.querySelectorAll('[data-task-action]').forEach(actionButton => {
        actionButton.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            window.TaskUI?.closeActionMenu?.();
            await handleTaskActionButton(actionButton);
        });
    });
}

function renderTaskCard(task) {
    const priority = normalizeTaskPriorityValue(task.priority);
    const t = { ...task, priority };
    const cat = t.category || 'admin';
    const catInfo = getCategoryConfig(cat);
    const subInfo = getSubcategoryConfig(cat, t.subcategory);
    const taxoLabel = subInfo ? `${catInfo.label} / ${subInfo.label}` : catInfo.label;
    const nextStatus = STATUS_CYCLE[t.status] || 'todo';
    const nextLabel = STATUS_LABELS[nextStatus];
    const priorityIcon = PRIORITY_ICONS[t.priority] || '';

    const btnClass = nextStatus === 'done' ? 'btn-done' :
                     nextStatus === 'in_progress' ? 'btn-progress' : '';

    // v10.0: Task type badge
    const taskType = t.task_type || 'human';
    const typeBadge = `<span class="badge-type badge-${taskType}">${taskType === 'bot' ? 'Бот' : 'Людина'}</span>`;
    const reminderBadge = (t.remindAt || t.remind_at || t.snoozedUntil || t.snoozed_until)
        ? '<span class="task-os-badge reminder">Нагадування</span>'
        : '';
    const subtaskCount = Number(t.subtask_count || t.subtaskCount || 0);
    const subtaskDone = Number(t.subtask_done_count || t.subtaskDoneCount || 0);
    const hasSubtasks = subtaskCount > 0;
    const subtaskExpanded = isTaskSubtasksExpanded(Number(t.id || 0), t);
    const completionBlockedBySubtasks = nextStatus === 'done' && hasSubtasks && subtaskDone < subtaskCount;
    const subtaskBadge = hasSubtasks
        ? `<button type="button" class="task-os-badge checklist task-card-subtasks-toggle" data-task-action="subtasks-toggle" data-task-id="${t.id}" aria-expanded="${subtaskExpanded ? 'true' : 'false'}" title="${escapeHtml(taskSubtaskCompletionTitle(t))}">Пункти ${subtaskDone}/${subtaskCount}</button>`
        : '';
    const packStatus = t.packStatus || t.pack_status || '';
    const packBadge = packStatus ? `<span class="task-os-badge pack-status">${escapeHtml(getPackStatusLabel(packStatus))}</span>` : '';
    const blockedCount = Number(t.openDependencyCount || t.open_dependency_count || 0);
    const blockedTitles = t.blockedByTitles || t.blocked_by_titles || '';
    const blockedBadge = blockedCount ? `<span class="task-os-badge blocked" title="Чекає завершення: ${escapeHtml(blockedTitles)}">Блокерів: ${blockedCount}</span>` : '';
    const ownerRole = t.ownerRole || t.owner_role || '';
    const ownerRoleBadge = ownerRole ? `<span class="task-os-badge owner-role">${escapeHtml(ownerRole)}</span>` : '';
    const controlMode = t.controlMode || t.control_mode || 'normal';
    const criticalReason = t.criticalReason || t.critical_reason || '';
    const controlBadge = controlMode === 'special_control'
        ? `<span class="task-os-badge special-control" title="${escapeHtml(criticalReason || 'Особливий контроль')}">Особливий контроль</span>`
        : '';

    // v10.0: Deadline display
    const deadlineHtml = renderTaskDeadlineBadge(t);

    // v10.0: Escalation indicator
    const escLevel = t.escalation_level || 0;
    const escHtml = escLevel > 0 ? `<span class="escalation-dot escalation-${escLevel}" title="Ескалація: рівень ${escLevel}"></span>` : '';

    const assignment = getTaskAssignmentView(t);
    const ownerHtml = `<span class="task-assignment-badge task-assignment-${escapeHtml(assignment.tone)}" title="${escapeHtml(assignment.title)}"><span class="task-assignment-dot" aria-hidden="true"></span>${escapeHtml(assignment.label)}</span>`;
    const selfPersonal = isSelfCreatedPersonalTask(t);
    const selfPersonalAttrs = selfPersonal ? ' data-self-personal="true"' : '';
    const intelHtml = renderTaskIntelligence(t);
    const completedTime = formatTaskCompletedTime(t);
    const completedHtml = t.status === 'done'
        ? `<span class="task-completed-badge">Виконано${completedTime ? ` · ${escapeHtml(completedTime)}` : ''}</span>`
        : '';
    const deferred = isDeferredTask(t);
    const deferredHtml = renderTaskDeferredBadge(t);
    const isKanbanCard = currentView === 'board' && KANBAN_STATUSES.includes(t.status);
    const isKanbanSaving = kanbanSavingTaskIds.has(Number(t.id));
    const kanbanAttrs = isKanbanCard
        ? ` draggable="true" data-kanban-card="true" data-status="${escapeHtml(t.status)}" aria-grabbed="false"`
        : ` data-status="${escapeHtml(t.status || '')}"`;

    return `
    <div class="task-card ${isKanbanCard ? '' : 'task-work-row'} cat-${cat} priority-${t.priority} ${t.status === 'done' ? 'status-done' : ''} ${blockedCount ? 'is-blocked' : ''} ${selfPersonal ? 'is-self-personal' : ''} ${isKanbanSaving ? 'is-kanban-saving' : ''}" data-task-open="true" role="button" tabindex="0" data-task-id="${t.id}" data-priority="${escapeHtml(t.priority || 'normal')}" data-subcategory="${escapeHtml(t.subcategory || '')}" data-pack-id="${escapeHtml(t.packId || t.pack_id || '')}"${selfPersonalAttrs}${kanbanAttrs}>
        <label class="task-checkbox-wrap">
            <input type="checkbox" class="task-bulk-cb" data-id="${t.id}" aria-label="Вибрати задачу">
        </label>
        <div class="task-card-title">${escHtml}${priorityIcon ? priorityIcon + ' ' : ''}${escapeHtml(t.title)}${getHealthBadge(t.health_score)}</div>
        <div class="task-card-meta">
            ${typeBadge}
            ${taskModeBadge(t)}
            ${taskKindBadge(t)}
            ${reminderBadge}
            ${subtaskBadge}
            ${packBadge}
            ${blockedBadge}
            ${ownerRoleBadge}
            ${controlBadge}
            <span>${catInfo.icon} ${escapeHtml(taxoLabel)}</span>
            ${t.date ? `<span>${formatDateShort(t.date)}</span>` : ''}
            ${renderScheduleBadge(t)}
            ${deadlineHtml}
            ${deferredHtml}
            ${ownerHtml}
            ${completedHtml}
            ${intelHtml}
            ${t.type === 'recurring' ? '<span class="badge badge-normal">Повтор</span>' : ''}
            ${t.type === 'afisha' ? '<span class="badge badge-normal">Афіша</span>' : ''}
        </div>
        ${renderTaskSubtaskProgress(t)}
        ${renderTaskCardSubtasksPanel(t)}
        <div class="task-card-actions task-row-actions">
            <button class="task-row-primary ${btnClass}" data-task-action="status" data-task-id="${t.id}" data-next-status="${nextStatus}" ${completionBlockedBySubtasks ? `disabled aria-disabled="true" title="${escapeHtml(taskSubtaskCompletionTitle(t))}"` : ''}>${STATUS_ICONS[nextStatus]} ${nextLabel}</button>
            ${renderTaskRowMoreAction(t.id)}
        </div>
    </div>`;
}

// ==========================================
// TASK ACTIONS
// ==========================================

function updateTaskSubtaskSummary(taskId, subtasks = []) {
    const id = Number(taskId);
    const total = subtasks.length;
    const done = subtasks.filter(item => normalizeTaskCardSubtask(item).isDone).length;
    allTasks = allTasks.map(task => {
        if (Number(task.id) !== id) return task;
        return {
            ...task,
            subtask_count: total,
            subtaskCount: total,
            subtask_done_count: done,
            subtaskDoneCount: done,
            subtasks: subtasks.map(normalizeTaskCardSubtask)
        };
    });
}

async function loadTaskCardSubtasks(taskId) {
    const id = Number(taskId);
    if (!id) return [];
    if (taskCardSubtaskCache.has(id)) return taskCardSubtaskCache.get(id);
    loadingTaskSubtaskIds.add(id);
    renderBoard();
    const result = await apiGetTaskSubtasks(id);
    loadingTaskSubtaskIds.delete(id);
    if (!result?.success || !Array.isArray(result.subtasks)) {
        showNotification(result?.error || 'Не вдалося завантажити підпункти задачі', 'error');
        renderBoard();
        return [];
    }
    const subtasks = result.subtasks.map(normalizeTaskCardSubtask);
    taskCardSubtaskCache.set(id, subtasks);
    updateTaskSubtaskSummary(id, subtasks);
    renderBoard();
    return subtasks;
}

async function toggleTaskCardSubtasks(taskId) {
    const id = Number(taskId);
    if (!id) return;
    const task = allTasks.find(item => Number(item.id) === id) || {};
    if (isTaskSubtasksExpanded(id, task)) {
        expandedTaskSubtaskIds.delete(id);
        collapsedTaskSubtaskIds.add(id);
        renderBoard();
        return;
    }
    collapsedTaskSubtaskIds.delete(id);
    expandedTaskSubtaskIds.add(id);
    if (!taskCardSubtaskCache.has(id) && !Array.isArray(task.subtasks)) {
        await loadTaskCardSubtasks(id);
        return;
    }
    renderBoard();
}

async function updateTaskCardSubtaskDone(input) {
    const taskId = Number(input?.dataset?.taskId || 0);
    const subtaskId = Number(input?.dataset?.subtaskId || 0);
    if (!taskId || !subtaskId) return;
    const nextDone = input.checked === true;
    const previousDone = !nextDone;
    input.disabled = true;
    const result = await apiPatchTaskSubtask(taskId, subtaskId, { is_done: nextDone });
    if (!result?.success || !result.subtask) {
        input.checked = previousDone;
        input.disabled = false;
        showNotification(result?.error || 'Не вдалося оновити підпункт', 'error');
        return;
    }
    const task = allTasks.find(item => Number(item.id) === taskId) || {};
    const cached = taskCardSubtaskCache.get(taskId) || cachedTaskSubtasks(taskId, task) || [];
    const updated = cached.map(item => Number(item.id) === subtaskId
        ? normalizeTaskCardSubtask(result.subtask)
        : normalizeTaskCardSubtask(item));
    taskCardSubtaskCache.set(taskId, updated);
    updateTaskSubtaskSummary(taskId, updated);
    const summary = taskSubtaskSummary(allTasks.find(task => Number(task.id) === taskId) || {});
    if (summary.total && summary.done >= summary.total) {
        showNotification('Усі підпункти закриті. Тепер можна виконати задачу.', 'success');
    }
    renderBoard();
}

let _assigneeList = [];
function _ensureCurrentUserInAssignees() {
    const self = currentUserTaskOwnerOption();
    if (!self) return null;
    const exists = _assigneeList.some(user => String(user.id) === String(self.id));
    if (!exists) _assigneeList.unshift(self);
    return self;
}

function _renderAssigneeSelect() {
    const sel = document.getElementById('taskAssignedTo');
    if (!sel) return;
    _ensureCurrentUserInAssignees();
    sel.innerHTML = '<option value="">Оберіть людину</option>' +
        _assigneeList.map(s => `<option value="${s.id}">${escapeHtml(s.label || s.name || s.username || ('User #' + s.id))}${s.role ? ' (' + escapeHtml(s.role) + ')' : ''}</option>`).join('');
}

function setTaskAssigneeMode(mode = 'self') {
    taskAssigneeMode = mode === 'team' ? 'team' : 'self';
    const quickAdd = document.getElementById('quickAdd');
    const select = document.getElementById('taskAssignedTo');
    if (quickAdd) quickAdd.dataset.assigneeMode = taskAssigneeMode;
    document.querySelectorAll('[data-task-assignee-mode]').forEach(btn => {
        const active = btn.dataset.taskAssigneeMode === taskAssigneeMode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (!select) return;
    if (taskAssigneeMode === 'self') {
        const self = _ensureCurrentUserInAssignees();
        if (self) select.value = String(self.id);
        select.hidden = true;
        select.disabled = true;
        select.setAttribute('aria-hidden', 'true');
        select.tabIndex = -1;
    } else {
        select.hidden = false;
        select.disabled = false;
        select.setAttribute('aria-hidden', 'false');
        select.removeAttribute('tabindex');
        if (select.value && String(select.value) === String(currentUserId() || '')) select.value = '';
    }
}

function dateForDuePreset(preset = taskDuePreset) {
    return dateForDuePresetValue(preset, document.getElementById('taskScheduleDate')?.value || '');
}

function dateForDuePresetValue(preset = 'today', manualDate = '') {
    if (preset === 'tomorrow') {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (preset === 'no_date') return '';
    return manualDate || getTodayStr();
}

function taskBatchDueOptions(selected = 'today') {
    const options = [
        ['today', 'Сьогодні'],
        ['tomorrow', 'Завтра'],
        ['no_date', 'Без дати'],
        ['custom', 'Інша дата']
    ];
    return options.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function taskPriorityOptions(selected = 'normal') {
    const options = [
        ['urgent', 'Терміново'],
        ['normal', 'Звичайний'],
        ['high', 'Високий'],
        ['low', 'Низький']
    ];
    return options.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function renderTaskComposerSubtasks() {
    const list = document.getElementById('taskSubtasksList');
    if (!list) return;
    Array.from(list.querySelectorAll('[data-task-subtask-row]')).forEach((row, index) => {
        const order = row.querySelector('[data-task-subtask-order]');
        if (order) order.textContent = String(index + 1);
    });
}

function taskComposerSubtaskRow(value = '', sourceType = 'manual') {
    const escaped = escapeHtml(value);
    const source = escapeHtml(sourceType || 'manual');
    return `<div class="task-subtask-row" data-task-subtask-row data-subtask-source="${source}">
        <span class="task-subtask-order" data-task-subtask-order></span>
        <input type="text" data-task-subtask-title value="${escaped}" placeholder="Назва підзадачі" aria-label="Назва підзадачі">
        <button type="button" class="task-subtask-remove" data-task-subtask-remove aria-label="Видалити підзадачу">×</button>
    </div>`;
}

function addTaskComposerSubtask(value = '', sourceType = 'manual') {
    const list = document.getElementById('taskSubtasksList');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', taskComposerSubtaskRow(value, sourceType));
    renderTaskComposerSubtasks();
    setTaskDecompositionMode(sourceType === 'manual' ? 'manual' : (sourceType === 'template' ? 'template' : 'ai'), { keepStatus: true });
    toggleTaskComposerDetails(true);
    const inputs = list.querySelectorAll('[data-task-subtask-title]');
    inputs[inputs.length - 1]?.focus();
}

function readTaskComposerSubtasks() {
    return Array.from(document.querySelectorAll('#taskSubtasksList [data-task-subtask-row]'))
        .map((row, index) => ({
            title: row.querySelector('[data-task-subtask-title]')?.value || '',
            sort_order: index,
            source_type: row.dataset.subtaskSource || 'manual'
        }))
        .filter(item => String(item.title || '').trim());
}

function resetTaskComposerSubtasks() {
    const list = document.getElementById('taskSubtasksList');
    if (list) list.innerHTML = '';
    setTaskSubtaskDraftStatus('');
    document.getElementById('taskSubtaskAcceptDraftBtn')?.setAttribute('hidden', '');
    setTaskDecompositionMode('none', { keepRows: true, keepStatus: true });
}

function setTaskSubtaskDraftStatus(message = '', type = '') {
    const node = document.getElementById('taskSubtaskDraftStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `task-subtask-status ${type || ''}`.trim();
}

function setTaskDecompositionMode(mode = 'manual', options = {}) {
    const normalized = ['none', 'manual', 'template', 'ai', 'template_ai'].includes(mode) ? mode : 'manual';
    const select = document.getElementById('taskDecompositionMode');
    if (select) select.value = normalized;
    const template = document.getElementById('taskDecompositionTemplate');
    if (template) template.disabled = !['template', 'template_ai'].includes(normalized);
    const draftBtn = document.getElementById('taskSubtaskDraftBtn');
    if (draftBtn) {
        draftBtn.disabled = ['none', 'manual'].includes(normalized);
        draftBtn.textContent = normalized === 'template' ? 'Шаблон' : 'AI';
    }
    if (normalized === 'none') document.getElementById('taskSubtaskAcceptDraftBtn')?.setAttribute('hidden', '');
    if (normalized === 'none' && !options.keepRows) {
        const list = document.getElementById('taskSubtasksList');
        if (list) list.innerHTML = '';
    }
    if (!options.keepStatus) setTaskSubtaskDraftStatus('');
}

function replaceTaskComposerSubtasks(items = [], options = {}) {
    const list = document.getElementById('taskSubtasksList');
    if (!list) return;
    list.innerHTML = '';
    items.forEach(item => {
        list.insertAdjacentHTML('beforeend', taskComposerSubtaskRow(
            item.title || item.name || '',
            item.source_type || item.sourceType || options.sourceType || 'ai'
        ));
    });
    renderTaskComposerSubtasks();
    toggleTaskComposerDetails(true);
}

function renderTaskSavedTemplateOptions() {
    const select = document.getElementById('taskSavedDecompositionTemplate');
    if (!select) return;
    const current = select.value;
    const options = ['<option value="">Мої шаблони</option>'];
    taskSavedDecompositionTemplates.forEach(template => {
        const count = Array.isArray(template.items) ? template.items.length : (Array.isArray(template.subtasks) ? template.subtasks.length : 0);
        const label = `${template.name || template.title || 'Шаблон'}${count ? ` (${count})` : ''}`;
        options.push(`<option value="${escapeHtml(template.id)}">${escapeHtml(label)}</option>`);
    });
    select.innerHTML = options.join('');
    if (current && taskSavedDecompositionTemplates.some(template => String(template.id) === String(current))) {
        select.value = current;
    }
}

async function refreshTaskSavedTemplates() {
    if (!window.TaskCreate?.requestSavedDecompositionTemplates) return;
    taskSavedDecompositionTemplates = await window.TaskCreate.requestSavedDecompositionTemplates({ limit: 50 });
    renderTaskSavedTemplateOptions();
}

async function applySelectedTaskSavedTemplate() {
    const templateId = document.getElementById('taskSavedDecompositionTemplate')?.value || '';
    if (!templateId) {
        setTaskSubtaskDraftStatus('Оберіть збережений шаблон.', 'warning');
        return;
    }
    const result = await window.TaskCreate?.applySavedDecompositionTemplate?.(templateId);
    if (!result?.success) {
        setTaskSubtaskDraftStatus(result?.error || 'Не вдалося застосувати шаблон.', 'error');
        return;
    }
    replaceTaskComposerSubtasks(result.subtasks || [], { sourceType: 'template' });
    setTaskDecompositionMode('template', { keepRows: true, keepStatus: true });
    setTaskSubtaskDraftStatus('Шаблон додано як чернетку. Список можна змінити перед збереженням.', 'success');
    await refreshTaskSavedTemplates();
}

async function saveTaskSubtasksAsTemplate() {
    const subtasks = readTaskComposerSubtasks();
    if (subtasks.length < 2) {
        setTaskSubtaskDraftStatus('Для шаблону потрібно мінімум дві підзадачі.', 'warning');
        return;
    }
    const title = document.getElementById('taskTitle')?.value.trim() || '';
    let values = null;
    if (typeof formModal === 'function') {
        values = await formModal('Зберегти шаблон підзадач', [
            {
                key: 'name',
                label: 'Назва шаблону',
                type: 'text',
                required: true,
                defaultValue: title ? `${title} · підзадачі` : 'Новий шаблон підзадач'
            },
            {
                key: 'description',
                label: 'Опис',
                type: 'textarea',
                defaultValue: ''
            }
        ], {
            okText: 'Зберегти',
            cancelText: 'Скасувати',
            type: 'info'
        });
    } else {
        const name = null;
        values = name ? { name, description: '' } : null;
    }
    if (!values?.name) return;
    const category = document.getElementById('taskCategory')?.value || 'admin';
    const result = await window.TaskCreate?.saveDecompositionTemplate?.({
        name: values.name,
        description: values.description || '',
        category,
        subcategory: selectedSubcategoryFor(category, 'taskSubcategory'),
        subtasks
    });
    if (!result?.success) {
        setTaskSubtaskDraftStatus(result?.error || 'Не вдалося зберегти шаблон.', 'error');
        return;
    }
    await refreshTaskSavedTemplates();
    const select = document.getElementById('taskSavedDecompositionTemplate');
    if (select && result.template?.id) select.value = String(result.template.id);
    setTaskSubtaskDraftStatus('Шаблон підзадач збережено.', 'success');
}

async function updateSelectedTaskSavedTemplate() {
    const templateId = document.getElementById('taskSavedDecompositionTemplate')?.value || '';
    if (!templateId) {
        setTaskSubtaskDraftStatus('Оберіть шаблон для оновлення.', 'warning');
        return;
    }
    const subtasks = readTaskComposerSubtasks();
    if (subtasks.length < 2) {
        setTaskSubtaskDraftStatus('Для шаблону потрібно мінімум дві підзадачі.', 'warning');
        return;
    }
    const current = taskSavedDecompositionTemplates.find(template => String(template.id) === String(templateId)) || {};
    let values = null;
    if (typeof formModal === 'function') {
        values = await formModal('Оновити шаблон підзадач', [
            {
                key: 'name',
                label: 'Назва шаблону',
                type: 'text',
                required: true,
                defaultValue: current.name || current.title || 'Шаблон підзадач'
            },
            {
                key: 'description',
                label: 'Опис',
                type: 'textarea',
                defaultValue: current.description || ''
            }
        ], {
            okText: 'Оновити',
            cancelText: 'Скасувати',
            type: 'info'
        });
    } else {
        const name = null;
        values = name ? { name, description: current.description || '' } : null;
    }
    if (!values?.name) return;
    const category = document.getElementById('taskCategory')?.value || current.category || 'admin';
    const result = await window.TaskCreate?.updateDecompositionTemplate?.(templateId, {
        name: values.name,
        description: values.description || '',
        category,
        subcategory: selectedSubcategoryFor(category, 'taskSubcategory'),
        subtasks
    });
    if (!result?.success) {
        setTaskSubtaskDraftStatus(result?.error || 'Не вдалося оновити шаблон.', 'error');
        return;
    }
    await refreshTaskSavedTemplates();
    const select = document.getElementById('taskSavedDecompositionTemplate');
    if (select) select.value = String(templateId);
    setTaskSubtaskDraftStatus('Шаблон підзадач оновлено.', 'success');
}

async function deleteSelectedTaskSavedTemplate() {
    const templateId = document.getElementById('taskSavedDecompositionTemplate')?.value || '';
    if (!templateId) {
        setTaskSubtaskDraftStatus('Оберіть шаблон для видалення.', 'warning');
        return;
    }
    if (typeof confirmModal === 'function') {
        const confirmed = await confirmModal('Видалити цей шаблон підзадач?', { type: 'danger', okText: 'Видалити' });
        if (!confirmed) return;
    } else {
        setTaskSubtaskDraftStatus('Видалення шаблону тимчасово недоступне без CRM confirm modal.', 'warning');
        return;
    }
    const result = await window.TaskCreate?.deleteDecompositionTemplate?.(templateId);
    if (!result?.success) {
        setTaskSubtaskDraftStatus(result?.error || 'Не вдалося видалити шаблон.', 'error');
        return;
    }
    await refreshTaskSavedTemplates();
    setTaskSubtaskDraftStatus('Шаблон видалено.', 'success');
}

function renderTaskDecompositionSuggestions() {
    const host = document.getElementById('taskDecompositionSuggestions');
    if (!host) return;
    if (!taskDecompositionSuggestions.length) {
        host.hidden = true;
        host.innerHTML = '';
        return;
    }
    host.hidden = false;
    host.innerHTML = taskDecompositionSuggestions.map((suggestion, index) => {
        const count = Array.isArray(suggestion.subtasks) ? suggestion.subtasks.length : 0;
        const label = suggestion.type === 'saved_template'
            ? `Шаблон: ${suggestion.title || suggestion.template?.name || ''}`
            : (suggestion.title || 'Схожа структура');
        return `<button type="button" class="task-suggestion-chip" data-task-suggestion-index="${index}">
            ${escapeHtml(label)} · ${count}
        </button>`;
    }).join('');
}

async function refreshTaskDecompositionSuggestions() {
    if (!window.TaskCreate?.requestDecompositionSuggestions) return;
    const draft = readTaskComposerDraft();
    const key = [draft.title, draft.category, draft.subcategory].join('|');
    if (key === lastTaskSuggestionKey) return;
    lastTaskSuggestionKey = key;
    if (!draft.title || draft.title.length < 3) {
        taskDecompositionSuggestions = [];
        renderTaskDecompositionSuggestions();
        return;
    }
    const result = await window.TaskCreate.requestDecompositionSuggestions({
        title: draft.title,
        category: draft.category,
        subcategory: draft.subcategory,
        taskKind: draft.kind,
        taskMode: draft.mode
    });
    taskDecompositionSuggestions = result?.success ? (result.suggestions || []) : [];
    renderTaskDecompositionSuggestions();
}

function scheduleTaskDecompositionSuggestions() {
    clearTimeout(taskSuggestionTimer);
    taskSuggestionTimer = setTimeout(refreshTaskDecompositionSuggestions, 450);
}

function applyTaskSuggestion(index) {
    const suggestion = taskDecompositionSuggestions[index];
    if (!suggestion) return;
    const sourceType = suggestion.type === 'saved_template' ? 'template' : 'system';
    replaceTaskComposerSubtasks(suggestion.subtasks || suggestion.template?.subtasks || [], { sourceType });
    setTaskDecompositionMode(suggestion.type === 'saved_template' ? 'template' : 'manual', { keepRows: true, keepStatus: true });
    setTaskSubtaskDraftStatus('Підказку додано як чернетку. Список можна змінити перед збереженням.', 'success');
}

async function generateTaskComposerSubtasks() {
    const mode = document.getElementById('taskDecompositionMode')?.value || 'ai';
    const title = document.getElementById('taskTitle')?.value.trim() || '';
    if (!title) {
        setTaskSubtaskDraftStatus('Додайте назву задачі перед генерацією підзадач.', 'warning');
        document.getElementById('taskTitle')?.focus();
        return;
    }
    if (mode === 'none' || mode === 'manual') {
        setTaskSubtaskDraftStatus('Оберіть AI або шаблонний режим декомпозиції.', 'warning');
        return;
    }
    const draftBtn = document.getElementById('taskSubtaskDraftBtn');
    const acceptBtn = document.getElementById('taskSubtaskAcceptDraftBtn');
    const previousText = draftBtn?.textContent || '';
    if (draftBtn) {
        draftBtn.disabled = true;
        draftBtn.textContent = '...';
    }
    if (acceptBtn) acceptBtn.hidden = true;
    setTaskSubtaskDraftStatus(mode === 'template' ? 'Готую шаблонну чернетку...' : 'AI готує чернетку. Нічого ще не збережено...', '');
    const draft = readTaskComposerDraft();
    const result = await window.TaskCreate?.requestDecompositionDraft?.({
        ...draft,
        mode,
        decompositionMode: mode,
        templateKey: document.getElementById('taskDecompositionTemplate')?.value || '',
        sourceModule: 'tasks',
        sourceType: 'manual'
    });
    if (draftBtn) {
        draftBtn.disabled = false;
        draftBtn.textContent = previousText || (mode === 'template' ? 'Шаблон' : 'AI');
    }
    if (!result?.success) {
        setTaskSubtaskDraftStatus(result?.error || 'Не вдалося підготувати чернетку. Додайте підзадачі вручну.', 'error');
        return;
    }
    const rows = Array.isArray(result.subtasks) ? result.subtasks : [];
    replaceTaskComposerSubtasks(rows, {
        sourceType: result.source === 'template' || result.source === 'template_fallback' ? 'template' : 'ai'
    });
    if (acceptBtn) acceptBtn.hidden = false;
    const sourceLabel = result.source === 'template_fallback'
        ? 'AI недоступний, використано шаблон.'
        : (result.source === 'template' ? 'Шаблонну чернетку додано.' : 'AI чернетку додано.');
    setTaskSubtaskDraftStatus(`${sourceLabel} Перевірте список перед збереженням задачі.`, 'success');
}

function bindTaskComposerSubtasks() {
    document.getElementById('taskSubtaskAddBtn')?.addEventListener('click', () => addTaskComposerSubtask());
    document.getElementById('taskDecompositionMode')?.addEventListener('change', event => setTaskDecompositionMode(event.target.value));
    document.getElementById('taskSubtaskDraftBtn')?.addEventListener('click', generateTaskComposerSubtasks);
    document.getElementById('taskApplySavedTemplateBtn')?.addEventListener('click', applySelectedTaskSavedTemplate);
    document.getElementById('taskSaveSubtasksTemplateBtn')?.addEventListener('click', saveTaskSubtasksAsTemplate);
    document.getElementById('taskUpdateSavedTemplateBtn')?.addEventListener('click', updateSelectedTaskSavedTemplate);
    document.getElementById('taskDeleteSavedTemplateBtn')?.addEventListener('click', deleteSelectedTaskSavedTemplate);
    document.getElementById('taskDecompositionSuggestions')?.addEventListener('click', event => {
        const chip = event.target.closest('[data-task-suggestion-index]');
        if (!chip) return;
        applyTaskSuggestion(Number(chip.dataset.taskSuggestionIndex));
    });
    document.getElementById('taskSubtaskAcceptDraftBtn')?.addEventListener('click', () => {
        setTaskSubtaskDraftStatus('Чернетку прийнято. Остаточно вона збережеться разом із задачею.', 'success');
        document.getElementById('taskSubtaskAcceptDraftBtn')?.setAttribute('hidden', '');
    });
    setTaskDecompositionMode(document.getElementById('taskDecompositionMode')?.value || 'none', { keepRows: true, keepStatus: true });
    const list = document.getElementById('taskSubtasksList');
    if (!list) return;
    list.addEventListener('click', (event) => {
        const remove = event.target.closest('[data-task-subtask-remove]');
        if (!remove) return;
        remove.closest('[data-task-subtask-row]')?.remove();
        renderTaskComposerSubtasks();
    });
}

function readTaskComposerDraft() {
    const category = document.getElementById('taskCategory')?.value || 'admin';
    const scheduleDate = document.getElementById('taskScheduleDate')?.value || getTodayStr();
    const mode = document.getElementById('taskMode')?.value || (captureIntent.private ? 'private' : (captureIntent.personal ? 'personal' : 'work'));
    return {
        title: document.getElementById('taskTitle')?.value.trim() || '',
        category,
        subcategory: selectedSubcategoryFor(category, 'taskSubcategory'),
        priority: document.getElementById('taskPriority')?.value || 'normal',
        taskType: document.getElementById('taskType')?.value || 'human',
        deadlineTime: document.getElementById('taskDeadlineTime')?.value || '',
        ownerUserId: resolveQuickAddOwnerUserId(),
        assigneeMode: taskAssigneeMode,
        mode,
        kind: document.getElementById('taskKind')?.value || (captureIntent.waiting ? 'waiting' : 'action'),
        visibility: defaultVisibilityForTaskMode(mode, document.getElementById('taskVisibility')?.value || 'team'),
        duePreset: taskDuePreset,
        scheduleDate,
        dueDate: dateForDuePresetValue(taskDuePreset, scheduleDate),
        durationMinutes: Math.max(5, parseInt(document.getElementById('taskScheduleDuration')?.value, 10) || 30),
        scheduleSlot: quickScheduleSlot,
        subtasks: readTaskComposerSubtasks(),
        allowReschedule: document.getElementById('taskAllowReschedule')?.checked !== false,
        captureIntent: { ...captureIntent }
    };
}

function cloneTaskBatchSettings(source = {}) {
    return {
        category: source.category || 'admin',
        subcategory: source.subcategory || null,
        taskType: source.taskType || 'human',
        ownerUserId: source.ownerUserId || null,
        assigneeMode: source.assigneeMode || taskAssigneeMode || 'self',
        mode: source.mode || 'work',
        kind: source.kind || 'action',
        visibility: source.visibility || 'team',
        scheduleSlot: source.scheduleSlot || quickScheduleSlot || 'morning',
        allowReschedule: source.allowReschedule !== false,
        captureIntent: { ...(source.captureIntent || {}) }
    };
}

function createQuickTaskBatchItem(source = readTaskComposerDraft()) {
    const settings = cloneTaskBatchSettings(source);
    return {
        id: quickTaskBatchNextId++,
        title: '',
        priority: source.priority || 'normal',
        duePreset: source.duePreset || taskDuePreset || 'today',
        scheduleDate: source.scheduleDate || source.dueDate || getTodayStr(),
        deadlineTime: source.deadlineTime || '',
        durationMinutes: Math.max(5, parseInt(source.durationMinutes, 10) || 30),
        ...settings
    };
}

function taskBatchSourceDraft() {
    return quickTaskBatchItems.length ? quickTaskBatchItems[quickTaskBatchItems.length - 1] : readTaskComposerDraft();
}

function taskBatchOwnerLabel(item = {}) {
    if (item.assigneeMode === 'self' || String(item.ownerUserId || '') === String(currentUserId() || '')) return 'Собі';
    const owner = _assigneeList.find(user => String(user.id) === String(item.ownerUserId || ''));
    return owner?.label || owner?.name || owner?.username || (item.ownerUserId ? `User #${item.ownerUserId}` : 'Команді');
}

function taskBatchSummary(item = {}) {
    const dueDate = dateForDuePresetValue(item.duePreset, item.scheduleDate);
    const dateLabel = item.duePreset === 'no_date' ? 'без дати' : (dueDate || 'дата не задана');
    return `${taskBatchOwnerLabel(item)} · ${getTaxonomyLabel(item.category, item.subcategory)} · ${dateLabel}`;
}

function renderQuickTaskBatchItems() {
    const panel = document.getElementById('taskBatchPanel');
    const list = document.getElementById('taskBatchList');
    if (!panel || !list) return;
    panel.hidden = quickTaskBatchItems.length === 0;
    list.innerHTML = quickTaskBatchItems.map((item, index) => `
        <section class="task-batch-card" data-task-batch-card="${item.id}">
            <div class="task-batch-card-head">
                <div class="task-batch-card-title">
                    <strong>Задача ${index + 2}</strong>
                    <span title="${escapeHtml(taskBatchSummary(item))}">${escapeHtml(taskBatchSummary(item))}</span>
                </div>
                <button type="button" class="task-batch-remove" data-task-batch-remove="${item.id}">Прибрати</button>
            </div>
            <div class="task-batch-fields">
                <label for="taskBatchTitle-${item.id}">Назва
                    <input type="text" id="taskBatchTitle-${item.id}" data-task-batch-id="${item.id}" data-task-batch-field="title" value="${escapeHtml(item.title)}" placeholder="Що треба зробити?">
                </label>
                <label for="taskBatchPriority-${item.id}">Пріоритет
                    <select id="taskBatchPriority-${item.id}" data-task-batch-id="${item.id}" data-task-batch-field="priority">${taskPriorityOptions(item.priority)}</select>
                </label>
                <label for="taskBatchDuePreset-${item.id}">Коли
                    <select id="taskBatchDuePreset-${item.id}" data-task-batch-id="${item.id}" data-task-batch-field="duePreset">${taskBatchDueOptions(item.duePreset)}</select>
                </label>
                <label for="taskBatchDate-${item.id}">Дата
                    <input type="date" id="taskBatchDate-${item.id}" data-task-batch-id="${item.id}" data-task-batch-field="scheduleDate" value="${escapeHtml(item.scheduleDate || '')}">
                </label>
                <label for="taskBatchTime-${item.id}">Час
                    <input type="time" id="taskBatchTime-${item.id}" data-task-batch-id="${item.id}" data-task-batch-field="deadlineTime" value="${escapeHtml(item.deadlineTime || '')}">
                </label>
                <label for="taskBatchDuration-${item.id}">Хв
                    <input type="number" id="taskBatchDuration-${item.id}" data-task-batch-id="${item.id}" data-task-batch-field="durationMinutes" min="5" max="480" step="5" value="${escapeHtml(String(item.durationMinutes || 30))}">
                </label>
            </div>
        </section>
    `).join('');
}

function updateQuickTaskBatchItem(id, field, value) {
    const item = quickTaskBatchItems.find(row => String(row.id) === String(id));
    if (!item) return;
    if (field === 'durationMinutes') item[field] = Math.max(5, parseInt(value, 10) || 30);
    else item[field] = value;
    if (field === 'duePreset' && (value === 'today' || value === 'tomorrow')) {
        item.scheduleDate = dateForDuePresetValue(value, item.scheduleDate);
    }
}

function bindTaskBatchListEvents() {
    const list = document.getElementById('taskBatchList');
    if (!list) return;
    list.addEventListener('input', (event) => {
        const control = event.target.closest('[data-task-batch-field]');
        if (!control) return;
        updateQuickTaskBatchItem(control.dataset.taskBatchId, control.dataset.taskBatchField, control.value);
    });
    list.addEventListener('change', (event) => {
        const control = event.target.closest('[data-task-batch-field]');
        if (!control) return;
        updateQuickTaskBatchItem(control.dataset.taskBatchId, control.dataset.taskBatchField, control.value);
        if (control.dataset.taskBatchField === 'duePreset') renderQuickTaskBatchItems();
    });
    list.addEventListener('click', (event) => {
        const remove = event.target.closest('[data-task-batch-remove]');
        if (!remove) return;
        quickTaskBatchItems = quickTaskBatchItems.filter(item => String(item.id) !== String(remove.dataset.taskBatchRemove));
        renderQuickTaskBatchItems();
    });
}

function addQuickTaskBatchItem() {
    const item = createQuickTaskBatchItem(taskBatchSourceDraft());
    quickTaskBatchItems.push(item);
    renderQuickTaskBatchItems();
    toggleTaskComposerDetails(true);
    setTimeout(() => document.getElementById(`taskBatchTitle-${item.id}`)?.focus(), 0);
}

function taskDraftFromBatchItem(item = {}) {
    return {
        ...cloneTaskBatchSettings(item),
        title: String(item.title || '').trim(),
        priority: item.priority || 'normal',
        duePreset: item.duePreset || 'today',
        scheduleDate: item.scheduleDate || getTodayStr(),
        dueDate: dateForDuePresetValue(item.duePreset || 'today', item.scheduleDate || ''),
        deadlineTime: item.deadlineTime || '',
        durationMinutes: Math.max(5, parseInt(item.durationMinutes, 10) || 30)
    };
}

function buildTaskCreatePayload(draft = {}) {
    if (window.TaskCreate?.buildPayload) {
        return window.TaskCreate.buildPayload(draft, {
            sourceModule: 'tasks',
            scheduleSlot: draft.scheduleSlot || quickScheduleSlot,
            getChecklistTemplateKey: normalizeChecklistTemplateKey
        });
    }
    const category = draft.category || 'admin';
    const subcategory = draft.subcategory || null;
    const dueDate = dateForDuePresetValue(draft.duePreset || 'today', draft.scheduleDate || draft.dueDate || '');
    const durationMinutes = Math.max(5, parseInt(draft.durationMinutes, 10) || 30);
    const data = {
        title: String(draft.title || '').trim(),
        priority: draft.priority || 'normal',
        category,
        task_type: draft.taskType || 'human',
        task_mode: draft.mode || 'work',
        task_kind: draft.kind || 'action',
        visibility: defaultVisibilityForTaskMode(draft.mode || 'work', draft.visibility || 'team'),
        workflow_state: draft.captureIntent?.waiting ? 'waiting' : 'inbox',
        subcategory,
        checklist_template_key: normalizeChecklistTemplateKey(category, subcategory),
        source_type: 'manual',
        source_module: 'tasks',
        allowReschedule: draft.allowReschedule !== false,
        controlMeta: {
            canReschedule: draft.allowReschedule !== false,
            allowReschedule: draft.allowReschedule !== false
        }
    };
    if (draft.ownerUserId) data.ownerUserId = draft.ownerUserId;
    if (dueDate) {
        data.date = dueDate;
        data.schedule = {
            date: dueDate,
            slot: draft.scheduleSlot || quickScheduleSlot,
            durationMinutes
        };
        data.effort_minutes = durationMinutes;
    }
    if (draft.deadlineTime && dueDate) {
        data.deadline = `${dueDate}T${draft.deadlineTime}:00`;
        data.schedule = {
            date: dueDate,
            scheduledStartAt: `${dueDate}T${draft.deadlineTime}`,
            durationMinutes
        };
        data.effort_minutes = durationMinutes;
    }
    const subtasks = Array.isArray(draft.subtasks) ? draft.subtasks.filter(item => String(item.title || '').trim()) : [];
    if (subtasks.length) {
        data.subtasks = subtasks.map((item, index) => ({ ...item, sort_order: index, source_type: item.source_type || 'manual' }));
        if (data.task_kind === 'action') data.task_kind = 'checklist';
    }
    return data;
}

function focusInvalidTaskDraft(index, itemId) {
    if (index === 0) {
        document.getElementById('taskTitle')?.focus();
        return;
    }
    document.getElementById(`taskBatchTitle-${itemId}`)?.focus();
}

function resetTaskComposerAfterCreate() {
    const title = document.getElementById('taskTitle');
    if (title) title.value = '';
    if (document.getElementById('taskDeadlineTime')) document.getElementById('taskDeadlineTime').value = '';
    if (document.getElementById('taskScheduleDuration')) document.getElementById('taskScheduleDuration').value = '30';
    if (document.getElementById('taskScheduleDate')) document.getElementById('taskScheduleDate').value = getTodayStr();
    if (document.getElementById('taskAllowReschedule')) document.getElementById('taskAllowReschedule').checked = true;
    quickTaskBatchItems = [];
    renderQuickTaskBatchItems();
    resetTaskComposerSubtasks();
    taskDecompositionSuggestions = [];
    lastTaskSuggestionKey = '';
    renderTaskDecompositionSuggestions();
    captureIntent = {};
    document.querySelectorAll('[data-capture-chip]').forEach(btn => btn.classList.remove('active'));
    setTaskDuePreset('today', { expand: false });
    setTaskAssigneeMode('self');
    toggleTaskComposerDetails(false);
}

function setTaskDuePreset(preset = 'today', options = {}) {
    taskDuePreset = ['today', 'tomorrow', 'no_date', 'custom'].includes(preset) ? preset : 'today';
    document.querySelectorAll('[data-due-preset]').forEach(btn => {
        const active = btn.dataset.duePreset === taskDuePreset;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const dateInput = document.getElementById('taskScheduleDate');
    if (dateInput && taskDuePreset === 'today') dateInput.value = getTodayStr();
    if (dateInput && taskDuePreset === 'tomorrow') dateInput.value = dateForDuePreset('tomorrow');
    if (taskDuePreset === 'custom' && options.expand !== false) {
        toggleTaskComposerDetails(true);
        dateInput?.focus();
    }
}

function toggleTaskComposerDetails(force) {
    const details = document.getElementById('taskComposerDetails');
    const toggle = document.getElementById('taskDetailsToggle');
    if (!details || !toggle) return;
    const open = typeof force === 'boolean' ? force : details.hidden;
    details.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Сховати' : 'Ще';
}

function setupTaskComposer() {
    _renderAssigneeSelect();
    setTaskAssigneeMode('self');
    const dateInput = document.getElementById('taskScheduleDate');
    if (dateInput && !dateInput.value) dateInput.value = getTodayStr();
    setTaskDuePreset('today', { expand: false });
    document.querySelectorAll('[data-task-assignee-mode]').forEach(btn => {
        btn.addEventListener('click', () => setTaskAssigneeMode(btn.dataset.taskAssigneeMode));
    });
    document.querySelectorAll('[data-due-preset]').forEach(btn => {
        btn.addEventListener('click', () => setTaskDuePreset(btn.dataset.duePreset));
    });
    dateInput?.addEventListener('change', () => setTaskDuePreset('custom', { expand: false }));
    document.querySelectorAll('[data-schedule-slot]').forEach(btn => {
        btn.addEventListener('click', () => {
            quickScheduleSlot = btn.dataset.scheduleSlot || 'morning';
            document.querySelectorAll('[data-schedule-slot]').forEach(slotBtn => {
                const active = slotBtn.dataset.scheduleSlot === quickScheduleSlot;
                slotBtn.classList.toggle('active', active);
                slotBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        });
    });
    document.getElementById('addTaskRowBtn')?.addEventListener('click', addQuickTaskBatchItem);
    bindTaskBatchListEvents();
    renderQuickTaskBatchItems();
    document.getElementById('taskDetailsToggle')?.addEventListener('click', () => toggleTaskComposerDetails());
}

function getTaskScopeLabel(scope = currentScopeFilter) {
    const labels = {
        all: 'Всі мої',
        work: 'Робочі',
        personal: 'Особисті',
        private: 'Приватні',
        waiting: 'Чекаю',
        idea: 'Ідеї'
    };
    return labels[scope] || labels.all;
}

function taskMatchesScopeFilter(task = {}, scope = currentScopeFilter) {
    switch (scope) {
        case 'work':
            return taskMode(task) === 'work';
        case 'personal':
            return taskMode(task) === 'personal' || (task.category || '') === 'personal';
        case 'private':
            return isPrivateTask(task);
        case 'waiting':
            return isWaitingTask(task);
        case 'idea':
            return isIdeaTask(task);
        case 'all':
        default:
            return true;
    }
}

function applyTaskScopeFilter(tasks = []) {
    if (currentScopeFilter === 'all') return tasks;
    return tasks.filter(task => taskMatchesScopeFilter(task));
}

function resolveQuickAddOwnerUserId() {
    if (taskAssigneeMode === 'self') return currentUserId();
    const selected = document.getElementById('taskAssignedTo')?.value || '';
    return selected || null;
}

async function _loadAssigneeDropdown() {
    try {
        _assigneeList = (await apiGetTaskOwners()).sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'uk'));
        _renderAssigneeSelect();
    } catch {}
}

function applyCaptureChip(chip) {
    captureIntent[chip] = !captureIntent[chip];
    document.querySelectorAll('[data-capture-chip]').forEach(btn => {
        btn.classList.toggle('active', !!captureIntent[btn.dataset.captureChip]);
    });
    const mode = document.getElementById('taskMode');
    const kind = document.getElementById('taskKind');
    const visibility = document.getElementById('taskVisibility');
    if (chip === 'personal' && mode) {
        mode.value = 'personal';
        if (visibility) visibility.value = 'me_only';
    }
    if (chip === 'private' && mode) {
        mode.value = 'private';
        if (visibility) visibility.value = 'private';
    }
    if (chip === 'waiting' && kind) kind.value = 'waiting';
    if (chip === 'idea' && kind) kind.value = 'idea';
    const dateInput = document.getElementById('taskScheduleDate');
    if (dateInput && (chip === 'today' || chip === 'tomorrow')) dateInput.value = dateFromCaptureIntent();
}

function defaultVisibilityForTaskMode(mode, explicitVisibility) {
    if (explicitVisibility === 'private' || explicitVisibility === 'me_only') return explicitVisibility;
    if (mode === 'private') return 'private';
    if (mode === 'personal') return 'me_only';
    return 'team';
}

function dateFromCaptureIntent() {
    if (captureIntent.tomorrow) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return getTodayStr();
}

async function addTask() {
    if (!taskCapabilityAllowed('create', userPermissions?.canCreateTasks !== false)) {
        showNotification(taskCapabilityReason('create', false), 'error');
        return;
    }
    const mainDraft = readTaskComposerDraft();
    const batchDrafts = quickTaskBatchItems.map(taskDraftFromBatchItem);
    const drafts = [mainDraft, ...batchDrafts];
    const invalidIndex = drafts.findIndex(draft => !String(draft.title || '').trim());
    if (invalidIndex >= 0) {
        const invalidItem = invalidIndex > 0 ? quickTaskBatchItems[invalidIndex - 1] : null;
        showNotification(`Заповніть назву задачі #${invalidIndex + 1}`, 'error');
        focusInvalidTaskDraft(invalidIndex, invalidItem?.id);
        return;
    }

    const createdTasks = [];
    let postCreateWarningCount = 0;
    for (let i = 0; i < drafts.length; i += 1) {
        const data = buildTaskCreatePayload(drafts[i]);
        const result = await apiCreateTask(data);
        if (!result || !result.success) {
            if (!createdTasks.length && result?.duplicate) return;
            if (createdTasks.length) {
                showNotification(`Створено ${createdTasks.length} з ${drafts.length} задач. Задача #${i + 1} не збережена.`, 'warning');
                await loadAllTasks();
            } else {
                showNotification('Помилка додавання задачі', 'error');
            }
            return;
        }
        if (Array.isArray(result.postCreateWarnings)) postCreateWarningCount += result.postCreateWarnings.length;
        createdTasks.push(result.task);
        lastCreatedTaskId = result.task?.id || lastCreatedTaskId;
        keepNewTaskVisible(result.task, data);
    }

    resetTaskComposerAfterCreate();
    showTaskCreateSuccessToast(createdTasks, drafts, postCreateWarningCount);
    createdTasks.forEach(task => notifyTaskWidgetsChanged({ action: 'create', taskId: task?.id }));
    await loadAllTasks();
}

async function createOperationPack() {
    const preset = document.getElementById('operationPreset')?.value || 'kitchen_basic';
    const titleInput = document.getElementById('operationPackTitle');
    const sourceType = document.getElementById('operationSourceType')?.value || '';
    const sourceId = document.getElementById('operationSourceId')?.value.trim() || '';
    const title = titleInput?.value.trim() || OPERATION_PRESETS[preset] || 'Операційний пакет';
    const data = {
        preset,
        title,
        source_entity_type: sourceType || null,
        source_entity_id: sourceId || null,
        pack_status: 'draft'
    };
    const result = await apiCreateOperationPack(data);
    if (result?.success) {
        if (titleInput) titleInput.value = '';
        showNotification(`Операційний пакет створено: ${result.tasks?.length || 0}`, 'success');
        currentCategory = 'checklist';
        currentSubcategory = 'all';
        renderCategoryFilters();
        renderSubcategoryFilters();
        await loadAllTasks();
        return;
    }
    showNotification(result?.error || 'Не вдалося створити операційний пакет', 'error');
}
window.createOperationPack = createOperationPack;

function setTaskActionBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

async function runTaskAction(button, action) {
    if (!button || button.disabled) return;
    setTaskActionBusy(button, true);
    try {
        await action();
    } finally {
        if (button.isConnected) setTaskActionBusy(button, false);
    }
}

function closeTaskRescheduleMenus(exceptWrap = null) {
    document.querySelectorAll('.task-overdue-wrap.is-open').forEach(wrap => {
        if (exceptWrap && wrap === exceptWrap) return;
        wrap.classList.remove('is-open');
        wrap.querySelectorAll('.task-overdue-trigger[aria-expanded="true"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
        wrap.querySelectorAll('.task-reschedule-menu').forEach(menu => { menu.hidden = true; });
    });
}

function toggleTaskRescheduleMenu(button) {
    const wrap = button.closest('.task-overdue-wrap');
    const menu = wrap?.querySelector('.task-reschedule-menu');
    if (!wrap || !menu) return;
    const willOpen = menu.hidden;
    closeTaskRescheduleMenus(wrap);
    wrap.classList.toggle('is-open', willOpen);
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

async function rescheduleOverdueTask(taskId, option = 'tomorrow') {
    const id = Number(taskId || 0);
    if (!id) return;
    let dateText = '';
    if (option === 'day_after') {
        dateText = getDateOffsetStr(2);
    } else if (option === 'custom') {
        dateText = typeof promptModal === 'function'
            ? await promptModal('Нова дата для задачі:', { inputType: 'date', defaultValue: getDateOffsetStr(1) })
            : null;
    } else {
        dateText = getDateOffsetStr(1);
    }
    if (!dateText) return;
    const result = await apiRescheduleTask(id, {
        deadline: deadlineForDate(dateText),
        sourceSurface: 'task_page_overdue_badge'
    });
    if (result?.success) {
        closeTaskRescheduleMenus();
        showNotification(`Задачу перенесено на ${dateText}`, 'success');
        await loadAllTasks();
        return;
    }
    showNotification(result?.error || 'Не вдалося перенести задачу', 'error');
}

async function moveDeferredTaskToToday(taskId) {
    const id = Number(taskId || 0);
    if (!id) return;
    const result = await apiRescheduleTask(id, {
        deadline: deadlineForDate(getTodayStr()),
        sourceSurface: 'task_page_deferred_return'
    });
    if (result?.success) {
        showNotification('Задачу повернено на сьогодні', 'success');
        await loadAllTasks();
        return;
    }
    showNotification(result?.error || 'Не вдалося повернути задачу', 'error');
}

async function executeTaskMoveTarget(taskId, target) {
    const id = Number(taskId || 0);
    if (!id) return;
    if (target === 'today') {
        await moveDeferredTaskToToday(id);
        return;
    }
    if (target === 'tomorrow') {
        await rescheduleOverdueTask(id, 'tomorrow');
        return;
    }
    if (target === 'snooze_hour') {
        await snoozeTaskQuick(id, 60);
        return;
    }
    if (target === 'snooze_custom') {
        await rescheduleOverdueTask(id, 'custom');
        return;
    }
    if (target === 'waiting') {
        await markTaskWaiting(id);
        return;
    }
    if (target === 'no_date') {
        const result = await apiPutTaskPartial(id, {
            date: null,
            deadline: null,
            remind_at: null,
            snoozed_until: null,
            workflow_state: 'inbox'
        });
        if (result?.success) {
            notifyTaskWidgetsChanged({ action: 'task_no_date', taskId: id });
            showNotification('Дату задачі прибрано', 'success');
            await loadAllTasks();
            return;
        }
        showNotification(result?.error || 'Не вдалося прибрати дату задачі', 'error');
    }
}

async function handleTaskActionButton(button) {
    const taskId = Number(button.dataset.taskId || 0);
    const action = button.dataset.taskAction || '';
    if (!taskId || !action) return;
    if (action === 'more') {
        openTaskRowActionMenu(button);
        return;
    }
    if (action === 'open-detail') {
        openTaskDetail(taskId);
        return;
    }
    if (action === 'reschedule-overdue-menu') {
        toggleTaskRescheduleMenu(button);
        return;
    }
    await runTaskAction(button, async () => {
        if (action === 'subtasks-toggle') await toggleTaskCardSubtasks(taskId);
        if (action === 'status') await cycleStatus(taskId, button.dataset.nextStatus || 'done');
        if (action === 'move-target') await executeTaskMoveTarget(taskId, button.dataset.taskMoveTarget || '');
        if (action === 'waiting') await markTaskWaiting(taskId);
        if (action === 'schedule') await quickScheduleTask(taskId, button.dataset.scheduleSlotAction || quickScheduleSlot);
        if (action === 'snooze') await snoozeTaskQuick(taskId, Number(button.dataset.minutes || 60));
        if (action === 'move-today') await moveDeferredTaskToToday(taskId);
        if (action === 'reschedule-overdue') await rescheduleOverdueTask(taskId, button.dataset.rescheduleOption || 'tomorrow');
        if (action === 'priority-menu') {
            const priority = normalizeTaskPriorityValue(button.dataset.priority);
            const result = await apiPatchTaskPriority(taskId, priority);
            const mutation = normalizeTaskMutationResult(result, 'Не вдалося змінити пріоритет');
            if (mutation.success) {
                allTasks = allTasks.map(item => Number(item.id) === taskId ? { ...item, ...(result.task || {}), priority } : item);
                applyTaskPriorityVisualState(taskId, priority);
                notifyTaskWidgetsChanged({ action: 'task_priority', taskId, priority });
                showNotification('Пріоритет оновлено', 'success');
                await loadAllTasks();
            } else {
                showNotification(mutation.error, 'error');
            }
        }
        if (action === 'delete') await deleteTask(taskId);
        if (action === 'restore') await restoreTask(taskId);
    });
}

function clearKanbanDropTargets(board = document.getElementById('boardContent')) {
    if (!board) return;
    board.querySelectorAll('.kanban-col.is-drop-target, .kanban-col.is-drop-invalid').forEach(col => {
        col.classList.remove('is-drop-target', 'is-drop-invalid');
    });
}

function getKanbanDropColumn(target, board) {
    const col = target?.closest?.('.kanban-col[data-kanban-status], .kanban-drop-zone[data-kanban-status]');
    if (!col || !board?.contains(col)) return null;
    return col.closest('.kanban-col[data-kanban-status]') || col;
}

function setKanbanDraggingCard(card, dragging) {
    if (!card) return;
    card.classList.toggle('is-dragging', Boolean(dragging));
    card.setAttribute('aria-grabbed', dragging ? 'true' : 'false');
    document.body.classList.toggle('tasks-kanban-dragging', Boolean(dragging));
}

function workflowForKanbanStatus(status) {
    if (status === 'done') return 'done';
    if (status === 'in_progress') return 'in_progress';
    return 'todo';
}

function taskSnapshotForRollback(task) {
    return task ? { ...task } : null;
}

function applyKanbanTaskStatus(taskId, status, persistedTask = null) {
    allTasks = allTasks.map(task => {
        if (Number(task.id) !== Number(taskId)) return task;
        const workflow = workflowForKanbanStatus(status);
        const base = persistedTask ? { ...task, ...persistedTask } : { ...task };
        return {
            ...base,
            status,
            workflow_state: workflow,
            workflowState: workflow,
            completed_at: status === 'done' ? (base.completed_at || base.completedAt || new Date().toISOString()) : null,
            completedAt: status === 'done' ? (base.completedAt || base.completed_at || new Date().toISOString()) : null
        };
    });
}

function restoreKanbanTaskSnapshot(snapshot) {
    if (!snapshot) return;
    allTasks = allTasks.map(task => Number(task.id) === Number(snapshot.id) ? snapshot : task);
}

async function moveTaskBetweenKanbanColumns(taskId, targetStatus) {
    if (!KANBAN_STATUSES.includes(targetStatus)) return;
    const task = allTasks.find(t => Number(t.id) === Number(taskId));
    if (!task) return;
    const sourceStatus = task.status || 'todo';
    if (sourceStatus === targetStatus) {
        showNotification('Задача вже в цій колонці', 'info');
        return;
    }

    const rollbackSnapshot = taskSnapshotForRollback(task);
    kanbanSavingTaskIds.add(Number(taskId));
    applyKanbanTaskStatus(taskId, targetStatus);
    renderBoard();

    const result = await apiPatchTaskStatus(taskId, targetStatus);
    kanbanSavingTaskIds.delete(Number(taskId));
    const mutation = normalizeTaskMutationResult(result, 'Не вдалося зберегти переміщення. Задачу повернуто назад.');

    if (mutation.success) {
        if (result.task) applyKanbanTaskStatus(taskId, result.task.status || targetStatus, result.task);
        showNotification(`Задачу переміщено: ${STATUS_LABELS[targetStatus] || targetStatus}`, 'success');
        await loadAllTasks();
        return;
    }

    restoreKanbanTaskSnapshot(rollbackSnapshot);
    renderBoard();
    showNotification(mutation.error || 'Не вдалося зберегти переміщення. Задачу повернуто назад.', 'error');
}

function setupTaskKanbanDragAndDrop(board) {
    if (!board || board.dataset.taskKanbanDndBound === 'true') return;
    board.dataset.taskKanbanDndBound = 'true';

    board.addEventListener('dragstart', (event) => {
        if (currentView !== 'board') return;
        if (event.target.closest('button, a, input, select, textarea, label, [data-task-action]')) {
            event.preventDefault();
            return;
        }
        const card = event.target.closest('.task-card[data-kanban-card="true"]');
        if (!card || !board.contains(card)) return;
        const taskId = Number(card.dataset.taskId || 0);
        const sourceStatus = card.dataset.status || '';
        if (!taskId || !KANBAN_STATUSES.includes(sourceStatus)) {
            event.preventDefault();
            return;
        }
        kanbanDragState = { taskId, sourceStatus };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(taskId));
        event.dataTransfer.setData('application/x-eventgenix-task', JSON.stringify(kanbanDragState));
        setKanbanDraggingCard(card, true);
    });

    board.addEventListener('dragover', (event) => {
        if (currentView !== 'board' || !kanbanDragState) return;
        const col = getKanbanDropColumn(event.target, board);
        if (!col) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        clearKanbanDropTargets(board);
        const targetStatus = col.dataset.kanbanStatus || '';
        col.classList.add(KANBAN_STATUSES.includes(targetStatus) ? 'is-drop-target' : 'is-drop-invalid');
    });

    board.addEventListener('dragleave', (event) => {
        const col = getKanbanDropColumn(event.target, board);
        if (!col || col.contains(event.relatedTarget)) return;
        col.classList.remove('is-drop-target', 'is-drop-invalid');
    });

    board.addEventListener('drop', async (event) => {
        if (currentView !== 'board' || !kanbanDragState) return;
        const col = getKanbanDropColumn(event.target, board);
        if (!col) return;
        event.preventDefault();
        const targetStatus = col.dataset.kanbanStatus || '';
        const taskId = Number(event.dataTransfer.getData('text/plain') || kanbanDragState.taskId || 0);
        clearKanbanDropTargets(board);
        lastKanbanDragEndedAt = Date.now();
        kanbanDragState = null;
        document.body.classList.remove('tasks-kanban-dragging');
        await moveTaskBetweenKanbanColumns(taskId, targetStatus);
    });

    board.addEventListener('dragend', (event) => {
        const card = event.target.closest('.task-card[data-kanban-card="true"]');
        setKanbanDraggingCard(card, false);
        clearKanbanDropTargets(board);
        kanbanDragState = null;
        lastKanbanDragEndedAt = Date.now();
    });
}

function setupTaskActionDelegation() {
    const board = document.getElementById('boardContent');
    if (!board || board.dataset.taskActionDelegationBound === 'true') return;
    board.dataset.taskActionDelegationBound = 'true';
    setupTaskKanbanDragAndDrop(board);
    if (!document.body.dataset.taskRescheduleMenuBound) {
        document.body.dataset.taskRescheduleMenuBound = 'true';
        document.addEventListener('click', event => {
            if (!event.target.closest('.task-overdue-wrap')) closeTaskRescheduleMenus();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeTaskRescheduleMenus();
        });
    }

    board.addEventListener('click', async (event) => {
        if (Date.now() - lastKanbanDragEndedAt < 300) {
            event.preventDefault();
            return;
        }
        const scheduleButton = event.target.closest('[data-task-team-schedule]');
        if (scheduleButton && board.contains(scheduleButton)) {
            event.preventDefault();
            await scheduleTaskFromTeamControl(scheduleButton);
            return;
        }
        const ownerButton = event.target.closest('[data-task-team-owner-open]');
        if (ownerButton && board.contains(ownerButton)) {
            taskTeamControlFilters.ownerUserId = ownerButton.dataset.taskTeamOwnerOpen || '';
            activateTaskView('team', { mode: 'team' });
            return;
        }        const retryButton = event.target.closest('[data-task-retry]');
        if (retryButton && board.contains(retryButton)) {
            event.preventDefault();
            await loadAllTasks();
            return;
        }
        const loadMoreButton = event.target.closest('[data-task-load-more]');
        if (loadMoreButton && board.contains(loadMoreButton)) {
            event.preventDefault();
            if (!taskPagination.loadingMore && taskPagination.hasMore) await loadAllTasks({ append: true });
            return;
        }
        const actionButton = event.target.closest('[data-task-action]');
        if (actionButton && board.contains(actionButton)) {
            event.preventDefault();
            event.stopPropagation();
            await handleTaskActionButton(actionButton);
            return;
        }
        if (event.target.closest('button, a, input, select, textarea, label')) return;
        const card = event.target.closest('[data-task-open="true"]');
        if (!card || !board.contains(card)) return;
        const taskId = Number(card.dataset.taskId || 0);
        if (taskId) openTaskDetail(taskId);
    });

    board.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        if (event.target.closest('button, a, input, select, textarea')) return;
        const card = event.target.closest('[data-task-open="true"]');
        if (!card || !board.contains(card)) return;
        event.preventDefault();
        const taskId = Number(card.dataset.taskId || 0);
        if (taskId) openTaskDetail(taskId);
    });

    board.addEventListener('change', async (event) => {
        const teamFilter = event.target.closest('[data-task-team-filter]');
        if (teamFilter && board.contains(teamFilter)) {
            taskTeamControlFilters[teamFilter.dataset.taskTeamFilter] = teamFilter.value || '';
            await loadTaskTeamControl();
            return;
        }
        if (event.target.matches('[data-task-priority-select]')) {
            event.stopPropagation();
            await updateTaskPriorityQuick(event.target);
            return;
        }
        if (event.target.matches('[data-task-subtask-done]')) {
            event.stopPropagation();
            await updateTaskCardSubtaskDone(event.target);
            return;
        }
        if (!event.target.matches('.task-bulk-cb')) return;
        updateBulkSelection();
    });
}

async function cycleStatus(taskId, newStatus) {
    const currentTask = allTasks.find(t => Number(t.id) === Number(taskId)) || {};
    if (newStatus === 'done' && isBanquetDepositTask(currentTask)) {
        openBanquetDepositTaskForCompletion(taskId);
        return;
    }
    if (newStatus === 'done' && taskCompletionBlockedBySubtasks(currentTask)) {
        expandedTaskSubtaskIds.add(Number(taskId));
        if (!taskCardSubtaskCache.has(Number(taskId))) await loadTaskCardSubtasks(taskId);
        else renderBoard();
        showNotification(taskSubtaskCompletionTitle(currentTask), 'warning');
        return;
    }
    let result = newStatus === 'done'
        ? await apiCompleteTask(taskId)
        : await apiPatchTaskStatus(taskId, newStatus);
    if (newStatus === 'done' && window.TaskReportGate?.responseNeedsReport?.(result)) {
        const task = allTasks.find(t => Number(t.id) === Number(taskId)) || {};
        const reportId = await window.TaskReportGate.openReportModal(task, { sourceSurface: 'task_page', taskId });
        if (!reportId) {
            showNotification('Звіт потрібен перед виконанням задачі', 'warning');
            return;
        }
        result = await apiCompleteTask(taskId, { reportId });
    }
    const mutation = normalizeTaskMutationResult(result, 'Помилка зміни статусу');
    if (mutation.success) {
        if (newStatus === 'done') window.SoundEngine?.playTask?.('task-complete');
        notifyTaskWidgetsChanged({ action: 'task_status', taskId, status: newStatus });
        await loadAllTasks();
    } else {
        showNotification(mutation.error || 'Помилка зміни статусу', 'error');
    }
}

async function updateTaskPriorityQuick(select) {
    const taskId = Number(select.dataset.taskId || 0);
    const priority = normalizeTaskPriorityValue(select.value);
    const task = allTasks.find(t => Number(t.id) === taskId);
    const previous = normalizeTaskPriorityValue(task?.priority);
    setTaskPrioritySelectBusy(select, true);
    const result = await apiPatchTaskPriority(taskId, priority);
    setTaskPrioritySelectBusy(select, false);
    const mutation = normalizeTaskMutationResult(result, 'Не вдалося змінити пріоритет');
    if (mutation.success) {
        allTasks = allTasks.map(item => Number(item.id) === taskId ? { ...item, ...(result.task || {}), priority } : item);
        applyTaskPriorityVisualState(taskId, priority);
        showNotification('Пріоритет оновлено', 'success');
        notifyTaskWidgetsChanged({ action: 'task_priority', taskId, priority });
        renderBoard();
        return;
    }
    applyTaskPriorityVisualState(taskId, previous);
    setTaskPrioritySelectVisual(select, previous);
    showNotification(mutation.error || 'Не вдалося змінити пріоритет', 'error');
}

async function snoozeTaskQuick(event, taskId, minutes) {
    if (event && typeof event === 'object') {
        event.preventDefault?.();
        event.stopPropagation?.();
    } else {
        minutes = taskId;
        taskId = event;
    }
    const result = await apiSnoozeTask(taskId, minutes);
    if (result?.success) {
        await loadAllTasks();
        if (typeof showNotification === 'function') showNotification('Задачу відкладено', 'success');
    }
}

async function quickScheduleTask(event, taskId, slot) {
    if (event && typeof event === 'object') {
        event.preventDefault?.();
        event.stopPropagation?.();
    } else {
        slot = taskId;
        taskId = event;
    }
    const task = allTasks.find(t => Number(t.id) === Number(taskId)) || {};
    const date = taskScheduleDate(task) || getTodayStr();
    const duration = task.effortMinutes || task.effort_minutes || 30;
    const result = await apiScheduleTask(taskId, schedulePayloadFor(date, slot, duration));
    if (result?.success) {
        const proposal = (result.proposals || []).length || result.task?.scheduleStatus === 'proposal';
        showNotification(proposal ? 'Слот зайнятий: збережено пропозицію часу' : 'Задачу заплановано', proposal ? 'info' : 'success');
        await loadAllTasks();
        return;
    }
    showNotification(result?.error || 'Не вдалося запланувати задачу', 'error');
}
window.quickScheduleTask = quickScheduleTask;

async function markTaskWaiting(event, taskId) {
    if (event && typeof event === 'object') {
        event.preventDefault?.();
        event.stopPropagation?.();
    } else {
        taskId = event;
    }
    const task = allTasks.find(t => Number(t.id) === Number(taskId));
    if (!task) return;
    const response = await taskApiFetchWithAuth(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: task.title,
            version: task.version,
            workflow_state: 'waiting',
            task_kind: taskKind(task) === 'action' ? 'waiting' : taskKind(task)
        })
    }).catch(() => null);
    if (response && !handleAuthError(response) && response.ok) {
        await loadAllTasks();
        if (typeof showNotification === 'function') showNotification('Перенесено у “Чекаю”', 'success');
    }
}

async function deleteTask(eventOrTaskId, maybeTaskId) {
    let taskId = eventOrTaskId;
    if (eventOrTaskId && typeof eventOrTaskId === 'object') {
        eventOrTaskId.preventDefault?.();
        eventOrTaskId.stopPropagation?.();
        taskId = maybeTaskId;
    }
    if (!taskCapabilityAllowed('delete', userPermissions?.canDeleteTasks === true)) {
        showNotification(taskCapabilityReason('delete', false), 'error');
        return;
    }
    clearBulkSelection();
    if (!await confirmModal('Видалити цю задачу?', { type: 'danger', okText: 'Видалити' })) return;
    const result = await apiDeleteTask(taskId);
    if (result && result.success) {
        allTasks = allTasks.filter(t => t.id !== taskId);
        updateCounts();
        renderBoard();
        showNotification('Задачу видалено', 'success');
    } else {
        showNotification('Помилка видалення', 'error');
    }
}

// ==========================================
// TEMPLATES
// ==========================================

async function loadTemplates() {
    const templates = await apiGetTemplates();
    renderTemplates(templates);
}

function renderTemplates(templates) {
    const grid = document.getElementById('templatesList');

    if (templates.length === 0) {
        grid.innerHTML = '<div class="empty-state">Немає шаблонів. Додайте перший!</div>';
        return;
    }

    grid.innerHTML = templates.map(t => {
        const pattern = PATTERN_LABELS[t.recurrencePattern] || t.recurrencePattern;
        const days = t.recurrenceDays ? ` (${escapeHtml(t.recurrenceDays)})` : '';
        const cat = getCategoryConfig(t.category || 'admin');
        const taxoLabel = getTaxonomyLabel(t.category || 'admin', t.subcategory);

        return `
        <div class="task-card cat-${t.category || 'admin'}">
            <div class="task-card-title">${escapeHtml(t.title)}</div>
            <div class="task-card-meta">
                <span>${escapeHtml(taxoLabel)}</span>
                ${t.defaultTaskKind === 'checklist' ? '<span class="task-os-badge checklist">Чеклист</span>' : ''}
                <span>${pattern}${days}</span>
                ${t.assignedTo ? `<span>${escapeHtml(t.assignedTo)}</span>` : ''}
                <span class="badge ${t.isActive ? 'badge-done' : 'badge-normal'}">${t.isActive ? 'Активний' : 'Пауза'}</span>
            </div>
            <div class="task-card-actions">
                <button class="btn-delete" onclick="deleteTemplate(${t.id})">✕ Видалити</button>
            </div>
        </div>`;
    }).join('');
}

async function addTemplate() {
    const title = document.getElementById('tplTitle')?.value.trim();
    if (!title) {
        showNotification('Введіть назву шаблону', 'error');
        return;
    }

    const recurrencePattern = document.getElementById('tplPattern')?.value;
    const recurrenceDays = document.getElementById('tplDays')?.value.trim() || null;
    const priority = document.getElementById('tplPriority')?.value;
    const assignedTo = document.getElementById('tplAssignedTo')?.value.trim() || null;
    const category = document.getElementById('tplCategory')?.value || 'admin';
    const subcategory = selectedSubcategoryFor(category, 'tplSubcategory');

    if (recurrencePattern === 'custom' && !recurrenceDays) {
        showNotification('Вкажіть дні для кастомного розкладу', 'error');
        return;
    }

    const result = await apiCreateTemplate({
        title,
        recurrencePattern,
        recurrenceDays,
        priority,
        assignedTo,
        category,
        subcategory,
        defaultTaskKind: category === 'checklist' ? 'checklist' : 'action',
        checklistTemplateKey: normalizeChecklistTemplateKey(category, subcategory)
    });
    if (result && result.success) {
        document.getElementById('tplTitle').value = '';
        document.getElementById('tplDays').value = '';
        showNotification('Шаблон додано', 'success');
        await loadTemplates();
    } else {
        showNotification('Помилка додавання', 'error');
    }
}

async function deleteTemplate(templateId) {
    if (!await confirmModal('Видалити цей шаблон?', { type: 'danger', okText: 'Видалити' })) return;
    const result = await apiDeleteTemplate(templateId);
    if (result && result.success) {
        showNotification('Шаблон видалено', 'success');
        await loadTemplates();
    } else {
        showNotification('Помилка видалення', 'error');
    }
}

// ==========================================
// v33.4: BULK SELECTION
// ==========================================

function getSelectedTaskIds() {
    return Array.from(document.querySelectorAll('.task-bulk-cb:checked')).map(cb => parseInt(cb.dataset.id));
}

function updateBulkSelection() {
    const ids = getSelectedTaskIds();
    const toolbar = document.getElementById('bulkToolbar');
    if (!toolbar) return;
    if (ids.length > 0) {
        toolbar.style.display = 'flex';
        document.getElementById('bulkCount').textContent = ids.length + ' обрано';
    } else {
        toolbar.style.display = 'none';
    }
}
window.updateBulkSelection = updateBulkSelection;

async function bulkAction(action) {
    const ids = getSelectedTaskIds();
    if (!ids.length) return;
    const labels = { done: 'Виконати', archive: 'Архівувати', restore: 'Відновити' };
    if (!await confirmModal(`${labels[action] || action} ${ids.length} задач?`, { type: 'danger' })) return;
    const result = await apiBulkTasks(ids, action);
    if (result && result.success) {
        showNotification(`${labels[action] || action}: ${result.affected || ids.length} задач`, 'success');
        clearBulkSelection();
        await loadAllTasks();
    } else {
        showNotification('Помилка bulk операції', 'error');
    }
}
window.bulkAction = bulkAction;

function clearBulkSelection() {
    document.querySelectorAll('.task-bulk-cb:checked').forEach(cb => { cb.checked = false; });
    updateBulkSelection();
}
window.clearBulkSelection = clearBulkSelection;

// ==========================================
// START
// ==========================================

// Open task detail modal (from alerts deep-link or card click)
let _taskDetailInitialState = null;

function isBanquetDepositTask(task = {}) {
    const meta = taskControlMeta(task);
    const sourceType = String(task.source_type || task.sourceType || '').toLowerCase();
    const sourceEntityType = String(task.source_entity_type || task.sourceEntityType || '').toLowerCase();
    return sourceType === 'banquet_deposit'
        || sourceEntityType === 'banquet_deposit'
        || Boolean(meta.depositId || meta.deposit_id);
}

function banquetDepositTaskId(task = {}) {
    const meta = taskControlMeta(task);
    const value = meta.depositId
        || meta.deposit_id
        || (String(task.source_type || task.sourceType || '').toLowerCase() === 'banquet_deposit' ? (task.source_id || task.sourceId) : null)
        || (String(task.source_entity_type || task.sourceEntityType || '').toLowerCase() === 'banquet_deposit' ? (task.source_entity_id || task.sourceEntityId) : null);
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function depositDisplayText(value, fallback = '—') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function depositDateValue(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return '';
    return new Date(parsed).toISOString().slice(0, 10);
}

function depositAmountValue(value) {
    if (value === null || value === undefined || value === '') return '';
    const amount = Number(value);
    return Number.isFinite(amount) ? String(Math.round(amount)) : String(value);
}

function depositStatusLabel(status) {
    const labels = {
        missing: 'Немає запису',
        manager_reported: 'Очікує перевірки',
        needs_booking_link: 'Потрібна привʼязка запису',
        accountant_verified: 'Підтверджено бухгалтером',
        corrected: 'Скориговано',
        cancelled: 'Скасовано'
    };
    return labels[status] || status || 'Невідомо';
}

function renderDepositContextRow(label, value) {
    return `<div><span style="font-size:11px;font-weight:800;color:var(--gray-500);text-transform:uppercase">${escapeHtml(label)}</span><div style="font-size:13px;color:var(--gray-800);font-weight:700;word-break:break-word">${escapeHtml(depositDisplayText(value))}</div></div>`;
}

function depositProjectionForTask(task = {}, projection = null) {
    const meta = taskControlMeta(task);
    const deposit = projection?.deposit || {};
    const display = projection?.display || {};
    const confirmation = deposit.sourcePayload?.accountantConfirmation || deposit.meta?.accountantConfirmation || {};
    const receivedDate = confirmation.receivedDate || (deposit.verifiedAt ? depositDateValue(deposit.verifiedAt) : '');
    return {
        depositId: banquetDepositTaskId(task) || deposit.id || meta.depositId || null,
        status: projection?.status || deposit.status || meta.status || 'missing',
        clientName: display.clientName || deposit.clientNameSnapshot || meta.clientName || '',
        receivedDate,
        eventDate: display.eventDate || deposit.eventDate || meta.eventDate || '',
        banquetNumber: display.banquetNumber || deposit.banquetNumberSnapshot || meta.banquetNumber || '',
        amount: display.amount ?? deposit.amount ?? '',
        paymentMethod: display.paymentMethod || deposit.paymentMethod || '',
        leadId: projection?.leadId || deposit.leadId || meta.leadId || '',
        bookingId: projection?.bookingId || deposit.primaryBookingId || meta.bookingId || '',
        banquetGroupId: projection?.banquetGroupId || deposit.banquetGroupId || meta.banquetGroupId || '',
        needsBookingLink: projection?.needsBookingLink === true || display.needsBookingLink === true || deposit.status === 'needs_booking_link',
        loadError: projection?.success === false ? (projection.error || 'Не вдалося завантажити завдаток') : ''
    };
}

function renderBanquetDepositTaskPanel(task = {}, projection = null, styles = {}) {
    if (!isBanquetDepositTask(task)) return '';
    const data = depositProjectionForTask(task, projection);
    const depositId = data.depositId || '';
    const verified = ['accountant_verified', 'corrected'].includes(data.status);
    const loadError = data.loadError;
    const _lbl = styles.label || 'style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:3px"';
    const _inp = styles.input || 'style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box"';
    return `<div id="_tdDepositPanel" data-banquet-deposit-panel data-deposit-id="${escapeHtml(depositId)}" data-deposit-status="${escapeHtml(data.status)}" style="border:1px solid rgba(14,165,233,0.28);border-radius:12px;padding:12px;background:rgba(14,165,233,0.07)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px">
            <div>
                <strong style="font-size:13px">Підтвердження завдатку</strong>
                <div id="_tdDepositState" style="font-size:12px;color:var(--gray-600);margin-top:3px">${escapeHtml(depositStatusLabel(data.status))}${verified ? ' · підтверджено' : ''}</div>
            </div>
            <span style="font-size:11px;font-weight:800;color:#0369a1;background:rgba(14,165,233,0.12);border:1px solid rgba(14,165,233,0.24);border-radius:999px;padding:4px 8px">#${escapeHtml(depositId || '—')}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:10px">
            ${renderDepositContextRow('Клієнт', data.clientName)}
            ${renderDepositContextRow('Лід', data.leadId ? `#${data.leadId}` : '')}
            ${renderDepositContextRow('Запис', data.bookingId)}
            ${renderDepositContextRow('Банкет', data.banquetGroupId || data.banquetNumber)}
            ${renderDepositContextRow('Дата свята', data.eventDate)}
            ${renderDepositContextRow('Статус', depositStatusLabel(data.status))}
        </div>
        ${data.needsBookingLink ? '<div style="margin-bottom:10px;padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.26);font-size:12px;color:#92400e">Поки немає привʼязаного запису/банкету. Дані можна перевірити, але завдаток залишиться в стані потреби привʼязки.</div>' : ''}
        ${loadError ? `<div id="_tdDepositError" style="margin-bottom:10px;font-size:12px;color:#dc2626">${escapeHtml(loadError)}</div>` : '<div id="_tdDepositError" style="display:none;margin-bottom:10px;font-size:12px;color:#dc2626"></div>'}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
            <div><label ${_lbl}>Прізвище та імʼя клієнта</label><input id="_tdDepositClientName" value="${escapeHtml(data.clientName)}" ${_inp}></div>
            <div><label ${_lbl}>Дата отримання</label><input id="_tdDepositReceivedDate" type="date" value="${escapeHtml(data.receivedDate || getTodayStr())}" ${_inp}></div>
            <div><label ${_lbl}>Дата святкування</label><input id="_tdDepositEventDate" type="date" value="${escapeHtml(depositDateValue(data.eventDate))}" ${_inp}></div>
            <div><label ${_lbl}>Номер банкету</label><input id="_tdDepositBanquetNumber" value="${escapeHtml(data.banquetNumber || data.banquetGroupId || data.bookingId)}" ${_inp}></div>
            <div><label ${_lbl}>Сума</label><input id="_tdDepositAmount" type="number" min="1" step="1" value="${escapeHtml(depositAmountValue(data.amount))}" ${_inp}></div>
            <div><label ${_lbl}>Спосіб внесення</label><select id="_tdDepositPaymentMethod" ${_inp}>
                <option value="">—</option>
                <option value="cash" ${data.paymentMethod === 'cash' ? 'selected' : ''}>Готівка</option>
                <option value="card" ${data.paymentMethod === 'card' ? 'selected' : ''}>Карта</option>
            </select></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
            <button type="button" id="_tdDepositConfirmBtn" onclick="verifyBanquetDepositFromTask(${Number(task.id || 0)})" style="border:1px solid rgba(14,165,233,0.34);background:#0284c7;color:#fff;border-radius:8px;padding:8px 10px;font-weight:800;cursor:pointer">Підтвердити завдаток</button>
            <span id="_tdDepositSavedHint" style="font-size:12px;color:var(--gray-500)">${verified ? 'Дані підтверджені в системі.' : 'Після підтвердження задачу можна виконати.'}</span>
        </div>
    </div>`;
}

function getTaskDetailFormState() {
    const ids = ['_tdTitle', '_tdDesc', '_tdStatus', '_tdPriority', '_tdDeadline', '_tdAssigned', '_tdScheduleDate', '_tdScheduleDuration', '_tdScheduleStart', '_tdCategory', '_tdSubcategory', '_tdMode', '_tdKind', '_tdVisibility', '_tdWorkflow', '_tdRemindAt', '_tdPackStatus', '_tdOwnerRole', '_tdSlaMinutes', '_tdDepositClientName', '_tdDepositReceivedDate', '_tdDepositEventDate', '_tdDepositBanquetNumber', '_tdDepositAmount', '_tdDepositPaymentMethod'];
    const fieldState = ids.map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
    return `${fieldState}|subtasks:${taskDetailSubtaskState()}`;
}

function resetTaskDetailDirtyState() {
    _taskDetailInitialState = getTaskDetailFormState();
}

function isTaskDetailDirty() {
    return _taskDetailInitialState !== null && getTaskDetailFormState() !== _taskDetailInitialState;
}

async function confirmTaskUiAction(message, options = {}) {
    if (typeof confirmModal === 'function') {
        return confirmModal(message, options);
    }
    if (typeof showNotification === 'function') {
        showNotification('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
    }
    return false;
}

async function closeTaskDetailOverlay(force) {
    const overlay = document.getElementById('taskDetailOverlay');
    if (!overlay) return true;
    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, () => {
            overlay.remove();
            _taskDetailInitialState = null;
            window.TaskDetailDrawer?.clearOpenParam?.();
        }, {
            force,
            isDirty: isTaskDetailDirty,
            message: 'Є незбережені зміни в задачі. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    if (!force && isTaskDetailDirty()) {
        const message = 'Є незбережені зміни в задачі. Закрити без збереження?';
        const confirmed = await confirmTaskUiAction(message, { type: 'warning', okText: 'Закрити' });
        if (!confirmed) return false;
    }
    overlay.remove();
    _taskDetailInitialState = null;
    window.TaskDetailDrawer?.clearOpenParam?.();
    return true;
}
window.closeTaskDetailOverlay = closeTaskDetailOverlay;

function syncDetailSubcategoryVisibility() {
    const category = document.getElementById('_tdCategory')?.value || 'admin';
    const wrap = document.getElementById('_tdSubcategoryWrap');
    const select = document.getElementById('_tdSubcategory');
    if (!wrap || !select) return;
    const previous = select.value;
    select.innerHTML = renderSubcategoryOptions(category, previous);
    const show = supportsSubcategory(category);
    wrap.style.display = show ? '' : 'none';
    if (!show) select.value = '';
}

function taskDetailSubtaskRow(item = {}, index = 0) {
    const id = item.id || item.subtaskId || item.subtask_id || '';
    const title = escapeHtml(item.title || '');
    const done = item.isDone === true || item.is_done === true;
    return `<div class="task-subtask-row" data-detail-subtask-row data-subtask-id="${escapeHtml(id)}">
        <input type="checkbox" data-detail-subtask-done ${done ? 'checked' : ''} aria-label="Підзадачу виконано">
        <input type="text" data-detail-subtask-title value="${title}" placeholder="Назва підзадачі" aria-label="Назва підзадачі">
        <button type="button" class="task-subtask-remove" data-detail-subtask-up aria-label="Підняти підзадачу">↑</button>
        <button type="button" class="task-subtask-remove" data-detail-subtask-down aria-label="Опустити підзадачу">↓</button>
        <button type="button" class="task-subtask-remove" data-detail-subtask-remove aria-label="Видалити підзадачу">×</button>
    </div>`;
}

function renderTaskDetailSubtasks(subtasks = []) {
    return subtasks.map(taskDetailSubtaskRow).join('');
}

function readTaskDetailSubtasks() {
    return Array.from(document.querySelectorAll('#_tdSubtasksList [data-detail-subtask-row]'))
        .map((row, index) => ({
            id: row.dataset.subtaskId || undefined,
            title: row.querySelector('[data-detail-subtask-title]')?.value || '',
            is_done: row.querySelector('[data-detail-subtask-done]')?.checked === true,
            sort_order: index,
            source_type: 'manual'
        }))
        .filter(item => String(item.title || '').trim());
}

function taskDetailSubtaskState() {
    return readTaskDetailSubtasks()
        .map(item => `${item.id || 'new'}:${item.is_done ? '1' : '0'}:${item.title}`)
        .join('~');
}

function updateTaskDetailSubtaskProgress() {
    const rows = readTaskDetailSubtasks();
    const total = rows.length;
    const done = rows.filter(item => item.is_done).length;
    const progress = taskSubtaskProgress(done, total) || 0;
    const fill = document.getElementById('_tdSubtaskProgressFill');
    const label = document.getElementById('_tdSubtaskProgressLabel');
    if (fill) fill.style.width = `${progress}%`;
    if (label) label.textContent = total ? `${done}/${total} · ${progress}%` : 'Без підзадач';
}

function addTaskDetailSubtask(value = '') {
    const list = document.getElementById('_tdSubtasksList');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', taskDetailSubtaskRow({ title: value }, list.children.length));
    list.dataset.subtasksLoaded = 'true';
    updateTaskDetailSubtaskProgress();
    list.querySelector('[data-detail-subtask-row]:last-child [data-detail-subtask-title]')?.focus();
}
window.addTaskDetailSubtask = addTaskDetailSubtask;

function bindTaskDetailSubtasks() {
    document.getElementById('_tdSubtaskAdd')?.addEventListener('click', () => addTaskDetailSubtask());
    const list = document.getElementById('_tdSubtasksList');
    if (!list) return;
    list.addEventListener('click', (event) => {
        const row = event.target.closest('[data-detail-subtask-row]');
        if (!row) return;
        if (event.target.closest('[data-detail-subtask-remove]')) {
            row.remove();
        } else if (event.target.closest('[data-detail-subtask-up]')) {
            const prev = row.previousElementSibling;
            if (prev) list.insertBefore(row, prev);
        } else if (event.target.closest('[data-detail-subtask-down]')) {
            const next = row.nextElementSibling;
            if (next) list.insertBefore(next, row);
        }
        updateTaskDetailSubtaskProgress();
    });
    list.addEventListener('input', updateTaskDetailSubtaskProgress);
    list.addEventListener('change', updateTaskDetailSubtaskProgress);
}

function taskDetailDepositPanel() {
    return document.getElementById('_tdDepositPanel');
}

function setBanquetDepositFormError(message = '') {
    const error = document.getElementById('_tdDepositError');
    if (!error) return;
    error.textContent = message || '';
    error.style.display = message ? '' : 'none';
}

function setBanquetDepositFormBusy(busy, label = '') {
    const button = document.getElementById('_tdDepositConfirmBtn');
    if (!button) return;
    if (button.dataset.defaultText === undefined) button.dataset.defaultText = button.textContent || '';
    button.disabled = busy;
    button.textContent = busy ? (label || 'Збереження...') : button.dataset.defaultText;
}

function readBanquetDepositForm() {
    return {
        clientName: document.getElementById('_tdDepositClientName')?.value.trim() || '',
        receivedDate: document.getElementById('_tdDepositReceivedDate')?.value || '',
        eventDate: document.getElementById('_tdDepositEventDate')?.value || '',
        banquetNumber: document.getElementById('_tdDepositBanquetNumber')?.value.trim() || '',
        amount: document.getElementById('_tdDepositAmount')?.value || '',
        paymentMethod: document.getElementById('_tdDepositPaymentMethod')?.value || ''
    };
}

function banquetDepositFormState() {
    const data = readBanquetDepositForm();
    return ['clientName', 'receivedDate', 'eventDate', 'banquetNumber', 'amount', 'paymentMethod']
        .map(key => `${key}:${data[key] || ''}`)
        .join('|');
}

function rememberBanquetDepositFormState() {
    const panel = taskDetailDepositPanel();
    if (panel) panel.dataset.initialDepositState = banquetDepositFormState();
}

function isBanquetDepositFormDirty() {
    const panel = taskDetailDepositPanel();
    return Boolean(panel) && panel.dataset.initialDepositState !== banquetDepositFormState();
}

function validateBanquetDepositForm(data = readBanquetDepositForm()) {
    const required = [
        ['clientName', 'Вкажіть прізвище та імʼя клієнта'],
        ['receivedDate', 'Вкажіть дату отримання завдатку'],
        ['eventDate', 'Вкажіть дату святкування'],
        ['banquetNumber', 'Вкажіть номер банкету'],
        ['amount', 'Вкажіть суму завдатку'],
        ['paymentMethod', 'Оберіть спосіб внесення']
    ];
    const missing = required.find(([key]) => !String(data[key] || '').trim());
    if (missing) return { ok: false, error: missing[1], field: missing[0] };
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: 'Сума завдатку має бути більшою за 0', field: 'amount' };
    }
    if (!['cash', 'card'].includes(data.paymentMethod)) {
        return { ok: false, error: 'Спосіб внесення має бути cash або card', field: 'paymentMethod' };
    }
    return { ok: true };
}

function focusBanquetDepositField(field) {
    const ids = {
        clientName: '_tdDepositClientName',
        receivedDate: '_tdDepositReceivedDate',
        eventDate: '_tdDepositEventDate',
        banquetNumber: '_tdDepositBanquetNumber',
        amount: '_tdDepositAmount',
        paymentMethod: '_tdDepositPaymentMethod'
    };
    const el = document.getElementById(ids[field]);
    if (el) el.focus();
}

function applyBanquetDepositProjection(projection = {}) {
    const panel = taskDetailDepositPanel();
    if (!panel) return;
    const data = depositProjectionForTask({ controlMeta: { depositId: panel.dataset.depositId } }, projection);
    panel.dataset.depositStatus = data.status || '';
    const state = document.getElementById('_tdDepositState');
    if (state) state.textContent = depositStatusLabel(data.status);
    const hint = document.getElementById('_tdDepositSavedHint');
    if (hint) hint.textContent = ['accountant_verified', 'corrected'].includes(data.status)
        ? 'Дані підтверджені в системі.'
        : 'Після підтвердження задачу можна виконати.';
    const fields = {
        _tdDepositClientName: data.clientName,
        _tdDepositReceivedDate: data.receivedDate || document.getElementById('_tdDepositReceivedDate')?.value || getTodayStr(),
        _tdDepositEventDate: depositDateValue(data.eventDate),
        _tdDepositBanquetNumber: data.banquetNumber || data.banquetGroupId || data.bookingId,
        _tdDepositAmount: depositAmountValue(data.amount),
        _tdDepositPaymentMethod: data.paymentMethod || ''
    };
    Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    });
    rememberBanquetDepositFormState();
}

async function reloadBanquetDepositForm(depositId) {
    const loaded = await apiGetBanquetDeposit(depositId);
    if (!loaded?.success) {
        setBanquetDepositFormError(loaded?.error || 'Не вдалося перечитати завдаток із системи');
        return false;
    }
    applyBanquetDepositProjection(loaded);
    return true;
}

async function confirmBanquetDepositFromTask(taskId) {
    const panel = taskDetailDepositPanel();
    if (!panel) return true;
    const depositId = Number(panel.dataset.depositId || 0);
    if (!depositId) {
        setBanquetDepositFormError('У задачі немає id завдатку');
        return false;
    }
    if (['accountant_verified', 'corrected'].includes(panel.dataset.depositStatus || '') && !isBanquetDepositFormDirty()) {
        return true;
    }
    const data = readBanquetDepositForm();
    const validation = validateBanquetDepositForm(data);
    if (!validation.ok) {
        setBanquetDepositFormError(validation.error);
        focusBanquetDepositField(validation.field);
        showNotification(validation.error, 'warning');
        return false;
    }
    setBanquetDepositFormError('');
    setBanquetDepositFormBusy(true, 'Підтвердження...');
    const result = await apiConfirmBanquetDeposit(depositId, {
        clientName: data.clientName,
        receivedDate: data.receivedDate,
        eventDate: data.eventDate,
        banquetNumber: data.banquetNumber,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        sourcePayload: {
            taskId,
            sourceSurface: 'task_detail_deposit_form'
        }
    });
    setBanquetDepositFormBusy(false);
    if (!result?.success) {
        const message = result?.error || 'Не вдалося підтвердити завдаток';
        setBanquetDepositFormError(message);
        focusBanquetDepositField(result?.field);
        showNotification(message, 'error');
        return false;
    }
    const reloaded = await reloadBanquetDepositForm(depositId);
    if (!reloaded) return false;
    resetTaskDetailDirtyState();
    showNotification('Завдаток підтверджено', 'success');
    return true;
}
window.verifyBanquetDepositFromTask = confirmBanquetDepositFromTask;

function openBanquetDepositTaskForCompletion(taskId) {
    showNotification('Спочатку підтвердіть завдаток у задачі', 'warning');
    openTaskDetail(taskId);
}

function renderTaskDetailSource(task = {}) {
    const source = task.drawer?.source || task.taskContext?.source || null;
    if (!source || (!source.type && !source.id && !source.module && !source.surface)) {
        return '<section class="task-detail-source-card"><strong>Джерело задачі</strong><span>Створено вручну або джерело не вказано</span></section>';
    }
    const label = source.label || source.type || source.module || 'Джерело задачі';
    const meta = [source.id ? `#${source.id}` : '', source.module, source.surface].filter(Boolean).join(' · ');
    const link = source.href
        ? `<a href="${escapeHtml(source.href)}" data-task-source-link>Відкрити CRM-джерело</a>`
        : '<span class="task-detail-source-unavailable">CRM-перехід недоступний для цього типу джерела</span>';
    return `<section class="task-detail-source-card"><strong>Джерело задачі</strong><span>${escapeHtml(label)}${meta ? ` · ${escapeHtml(meta)}` : ''}</span>${link}</section>`;
}

function renderTaskDetailContext(task = {}) {
    const expectedResult = task.expectedResult || task.expected_result || task.controlMeta?.expectedResult || '';
    const businessContext = task.businessContext || task.business_context || task.taskContext?.businessContext || 'не вказано';
    const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
    const dependencyTitles = dependencies.map(item => item?.title).filter(Boolean).join(', ');
    const dependencySummary = dependencyTitles || (Number(task.openDependencyCount || task.open_dependency_count || 0)
        ? (task.blockedByTitles || task.blocked_by_titles || 'потрібно завершити попередні задачі')
        : 'Відкритих залежностей немає');
    const reportRequired = task.drawer?.completion?.reportRequired === true || task.reportRequired === true || task.requiresReport === true;
    const snoozedUntil = task.snoozedUntil || task.snoozed_until || '';
    return `<section class="task-detail-context-card"><strong>Контекст і результат</strong><span><b>Бізнес-контекст:</b> ${escapeHtml(businessContext)}</span><span><b>Очікуваний результат:</b> ${escapeHtml(expectedResult || 'не задано')}</span><span><b>Залежності:</b> ${escapeHtml(dependencySummary)}</span><span><b>Звіт про виконання:</b> ${reportRequired ? 'обов’язковий' : 'не потрібен'}</span>${snoozedUntil ? `<span><b>Відкладено до:</b> ${escapeHtml(snoozedUntil)}</span>` : ''}</section>`;
}

function applyTaskDetailActionPermissions(task = {}) {
    const actions = task.drawer?.actions || {};
    const reasons = task.drawer?.actionReasons || {};
    const overlay = document.getElementById('taskDetailOverlay');
    if (!overlay) return;
    const editable = actions.edit === true;
    if (!editable) {
        overlay.querySelectorAll('input, textarea, select, [data-detail-schedule-slot], #_tdSubtaskAdd').forEach(control => {
            control.disabled = true;
            control.setAttribute('aria-disabled', 'true');
        });
    }
    overlay.querySelectorAll('[data-task-drawer-action]').forEach(button => {
        const action = button.dataset.taskDrawerAction;
        const allowed = actions[action] === true || ['close', 'history', 'openSource'].includes(action);
        const reason = allowed ? '' : taskPermissionReasonLabel(reasons[action]);
        button.disabled = !allowed;
        button.setAttribute('aria-disabled', allowed ? 'false' : 'true');
        if (reason) {
            button.title = reason;
            button.setAttribute('aria-describedby', 'taskDetailPermissionHint');
        } else {
            button.removeAttribute('title');
            button.removeAttribute('aria-describedby');
        }
    });
    const assignee = overlay.querySelector('#_tdAssigned');
    if (assignee) {
        const allowed = actions.reassign === true;
        assignee.disabled = !allowed;
        assignee.setAttribute('aria-disabled', allowed ? 'false' : 'true');
        assignee.title = allowed ? '' : taskPermissionReasonLabel(reasons.reassign);
    }
    if (actions.manageObservers !== true) {
        overlay.querySelectorAll('#_tdObservers, [data-task-drawer-action="manageObservers"]').forEach(control => {
            control.disabled = true;
            control.setAttribute('aria-disabled', 'true');
        });
    }
    let hint = overlay.querySelector('#taskDetailPermissionHint');
    if (!hint) {
        hint = document.createElement('p');
        hint.id = 'taskDetailPermissionHint';
        hint.style.cssText = 'margin:0 20px 12px;color:var(--gray-500);font-size:12px;line-height:1.4';
        hint.setAttribute('role', 'status');
        const footer = overlay.querySelector('[data-task-drawer-action="save"]')?.parentElement;
        footer?.insertAdjacentElement('beforebegin', hint);
    }
    if (hint) {
        const denied = Object.entries(reasons)
            .filter(([action, reason]) => reason && actions[action] === false)
            .map(([, reason]) => taskPermissionReasonLabel(reason));
        hint.textContent = [...new Set(denied)].join(' ');
        hint.hidden = !hint.textContent;
    }
}
async function openTaskDetail(taskId, options = {}) {
    if (window.TaskDetailDrawer) return window.TaskDetailDrawer.open(taskId, options);
    return renderTaskDetailDrawer(taskId, options);
}

async function renderTaskDetailDrawer(taskId) {
    try {
        const detailResult = window.TaskDetailDrawer
            ? await window.TaskDetailDrawer.load(taskId, { fetcher: (url) => taskApiFetchWithAuth(url, { headers: {} }) })
            : null;
        if (detailResult && !detailResult.ok) {
            window.TaskDetailDrawer.showError(detailResult);
            return;
        }
        const t = detailResult?.task;
        if (!t || !t.id) {
            const error = { status: 404, error: 'Задачу не знайдено' };
            if (window.TaskDetailDrawer) window.TaskDetailDrawer.showError(error);
            else showNotification(error.error, 'error');
            return;
        }
        const depositTask = isBanquetDepositTask(t);
        const depositId = depositTask ? banquetDepositTaskId(t) : null;
        let depositProjection = null;
        if (depositTask && depositId) {
            depositProjection = await apiGetBanquetDeposit(depositId);
        } else if (depositTask) {
            depositProjection = { success: false, error: 'У задачі немає id завдатку' };
        }

        const statusColor = t.status === 'done' ? '#10B981' : t.status === 'in_progress' ? '#3B82F6' : '#F59E0B';
        const prioColor = t.priority === 'urgent' ? '#E11D48' : t.priority === 'high' ? '#EF4444' : t.priority === 'low' ? '#94A3B8' : '#6B7280';
        const deadlineStr = t.deadline ? new Date(t.deadline).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
        const isOverdue = t.deadline && new Date(t.deadline) < new Date() && t.status !== 'done';

        let overlay = document.getElementById('taskDetailOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'taskDetailOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)';
            document.body.appendChild(overlay);
        }
        overlay.onclick = function(e) { if (e.target === overlay) closeTaskDetailOverlay(false); };

        const dlIso = formatDateTimeInput(t.deadline);
        const remindIso = formatDateTimeInput(t.remindAt || t.remind_at);
        const scheduleStartIso = formatDateTimeInput(taskScheduleStart(t));
        const scheduleDateValue = taskScheduleDate(t) || getTodayStr();
        const scheduleDurationValue = t.effortMinutes || t.effort_minutes || t.schedule?.durationMinutes || 30;
        const scheduleSlotValue = taskScheduleSlot(t) || 'morning';
        const scheduleBadge = renderScheduleBadge(t);
        const scheduleSlotButtons = TASK_SCHEDULE_SLOTS.map(slot => `<button type="button" class="task-slot-btn ${scheduleSlotValue === slot.key ? 'active' : ''}" data-detail-schedule-slot="${slot.key}" aria-pressed="${scheduleSlotValue === slot.key ? 'true' : 'false'}" title="${escapeHtml(slot.label)}">${slot.icon}</button>`).join('');
        const ownerSelectHtml = _assigneeList.map(s => {
            const selected = taskOwnerUserId(t) === Number(s.id) ? ' selected' : '';
            const label = s.label || s.name || s.username || ('User #' + s.id);
            return `<option value="${s.id}"${selected}>${escapeHtml(label)}${s.role ? ' (' + escapeHtml(s.role) + ')' : ''}</option>`;
        }).join('');
        const currentObserverIds = new Set((Array.isArray(t.observers) ? t.observers : [])
            .map(item => Number(item.userId || item.user_id || item.id || 0))
            .filter(Boolean));
        const observerSelectHtml = _assigneeList
            .filter(s => taskOwnerUserId(t) !== Number(s.id))
            .map(s => {
                const selected = currentObserverIds.has(Number(s.id)) ? ' selected' : '';
                const label = s.label || s.name || s.username || ('User #' + s.id);
                return `<option value="${s.id}"${selected}>${escapeHtml(label)}${s.role ? ' (' + escapeHtml(s.role) + ')' : ''}</option>`;
            }).join('');
        const ownerStateLabel = getTaskOwnerStateLabel(t);
        const taskIntel = t.intelligence || {};
        const taskWhy = Array.isArray(taskIntel.why) ? taskIntel.why.join(' ') : (taskIntel.why || '');
        const _lbl = 'style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:3px"';
        const _inp = 'style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box"';
        const categoryValue = t.category || 'admin';
        const subcategoryValue = t.subcategory || '';
        const subcategoryStyle = supportsSubcategory(categoryValue) ? '' : 'display:none';
        const detailSubtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
        const detailSubtaskSummary = taskSubtaskSummary(t);
        const detailSubtaskProgress = detailSubtaskSummary.progress || 0;
        const drawerActions = t.drawer?.actions || {};
        const canSaveTaskDetail = drawerActions.save === true;
        const canCompleteTaskDetail = drawerActions.complete === true;
        const canReassignTaskDetail = drawerActions.reassign === true;
        const canRescheduleTaskDetail = drawerActions.reschedule === true;
        const canReviewTaskDetail = drawerActions.review === true;
        const canDeleteTaskDetail = drawerActions.delete === true;

        overlay.dataset.taskVersion = t.version || 1;
        overlay.innerHTML = `<div style="background:var(--white,#fff);border-radius:16px;max-width:520px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
            <div style="padding:16px 20px;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;gap:12px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor}"></span>
                <h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Задача #${t.id}</h3>
                <span style="font-size:11px;color:var(--gray-400)">Автор: ${escapeHtml(t.created_by || '—')}</span>
                <button onclick="closeTaskDetailOverlay(false)" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--gray-400);padding:4px">✕</button>
            </div>
            <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px">
                <div><label ${_lbl}>Назва</label><input id="_tdTitle" value="${escapeHtml(t.title || '')}" ${_inp}></div>
                <div><label ${_lbl}>Опис</label><textarea id="_tdDesc" rows="3" ${_inp} style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;resize:vertical">${escapeHtml(t.description || '')}</textarea></div>
                <div style="display:flex;gap:8px">
                    <div style="flex:1"><label ${_lbl}>Статус</label><select id="_tdStatus" ${_inp} style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit">
                        <option value="todo" ${t.status==='todo'?'selected':''}>📋 До виконання</option>
                        <option value="in_progress" ${t.status==='in_progress'?'selected':''}>▶ В роботі</option>
                        <option value="done" ${t.status==='done'?'selected':''}>✅ Виконано</option>
                    </select></div>
                    <div style="flex:1"><label ${_lbl}>Пріоритет</label><select id="_tdPriority" ${_inp} style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit">
                        <option value="low" ${t.priority==='low'?'selected':''}>Низький</option>
                        <option value="normal" ${t.priority==='normal'?'selected':''}>Звичайний</option>
                        <option value="urgent" ${t.priority==='urgent'?'selected':''}>🔥 Терміново</option>
                        <option value="high" ${t.priority==='high'?'selected':''}>🔴 Високий</option>
                    </select></div>
                </div>
                <div style="display:flex;gap:8px">
                    <div style="flex:1"><label ${_lbl}>Дедлайн${isOverdue ? ' ⚠️' : ''}</label><input id="_tdDeadline" type="datetime-local" value="${dlIso}" ${_inp}></div>
                    <div style="flex:1"><label ${_lbl}>Призначено</label><select id="_tdAssigned" ${_inp} style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit">
                        <option value="">— нікому —</option>
                        ${ownerSelectHtml}
                    </select></div>
                </div>
                <div style="border:1px solid rgba(20,184,166,0.18);border-radius:12px;padding:10px;background:rgba(20,184,166,0.06)">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                        <strong style="font-size:13px">Smart schedule</strong>
                        ${scheduleBadge || '<span class="task-card-schedule">Без часу</span>'}
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:8px">
                        <div><label ${_lbl}>Дата</label><input id="_tdScheduleDate" type="date" value="${escapeHtml(scheduleDateValue)}" ${_inp}></div>
                        <div><label ${_lbl}>Хв</label><input id="_tdScheduleDuration" type="number" min="5" max="480" step="5" value="${escapeHtml(scheduleDurationValue)}" ${_inp}></div>
                    </div>
                    <div class="task-slot-picker" id="_tdScheduleSlots">${scheduleSlotButtons}</div>
                    <div style="margin-top:8px"><label ${_lbl}>Точний час</label><input id="_tdScheduleStart" type="datetime-local" value="${scheduleStartIso}" ${_inp}></div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
                    <div><label ${_lbl}>Категорія</label><select id="_tdCategory" ${_inp}>
                        ${renderCategoryOptions(categoryValue)}
                    </select></div>
                    <div id="_tdSubcategoryWrap" style="${subcategoryStyle}"><label ${_lbl}>Підкатегорія</label><select id="_tdSubcategory" ${_inp}>
                        ${renderSubcategoryOptions(categoryValue, subcategoryValue)}
                    </select></div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
                    <div><label ${_lbl}>Режим</label><select id="_tdMode" ${_inp}>
                        <option value="work" ${taskMode(t)==='work'?'selected':''}>Робоча</option>
                        <option value="personal" ${taskMode(t)==='personal'?'selected':''}>Особиста</option>
                        <option value="private" ${taskMode(t)==='private'?'selected':''}>Приватна</option>
                        <option value="system" ${taskMode(t)==='system'?'selected':''}>Системна</option>
                    </select></div>
                    <div><label ${_lbl}>Тип наміру</label><select id="_tdKind" ${_inp}>
                        ${['action','reminder','followup','deep_work','checklist','routine','waiting','idea','decision'].map(k => `<option value="${k}" ${taskKind(t)===k?'selected':''}>${escapeHtml(getTaskKindLabel(k))}</option>`).join('')}
                    </select></div>
                    <div><label ${_lbl}>Видимість</label><select id="_tdVisibility" ${_inp}>
                        <option value="team" ${taskVisibility(t)==='team'?'selected':''}>Командна</option>
                        <option value="me_only" ${taskVisibility(t)==='me_only'?'selected':''}>Тільки мені</option>
                        <option value="private" ${taskVisibility(t)==='private'?'selected':''}>Приватна</option>
                    </select></div>
                    <div><label ${_lbl}>Стан процесу</label><select id="_tdWorkflow" ${_inp}>
                        ${['inbox','todo','in_progress','waiting','scheduled','done','archived'].map(w => `<option value="${w}" ${taskWorkflow(t)===w?'selected':''}>${escapeHtml(getWorkflowLabel(w))}</option>`).join('')}
                    </select></div>
                    <div><label ${_lbl}>Нагадати</label><input id="_tdRemindAt" type="datetime-local" value="${remindIso}" ${_inp}></div>
                    <div><label ${_lbl}>Стан пакета</label><select id="_tdPackStatus" ${_inp}>
                        ${['','draft','confirmed','in_production','ready','issued','cancelled'].map(s => `<option value="${s}" ${(t.packStatus || t.pack_status || '')===s?'selected':''}>${escapeHtml(s ? getPackStatusLabel(s) : '—')}</option>`).join('')}
                    </select></div>
                    <div><label ${_lbl}>Роль власника</label><input id="_tdOwnerRole" value="${escapeHtml(t.ownerRole || t.owner_role || '')}" ${_inp}></div>
                    <div><label ${_lbl}>SLA хв</label><input id="_tdSlaMinutes" type="number" min="1" value="${escapeHtml(t.slaMinutes || t.sla_minutes || '')}" ${_inp}></div>
                </div>
                <div style="border:1px solid var(--gray-100);border-radius:10px;padding:10px;background:rgba(15,23,42,0.03)">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--gray-600)">
                        <strong>Операції задачі</strong>
                        <span>${escapeHtml(ownerStateLabel)}</span>
                        ${taskIntel.priorityBand ? `<span class="task-intel-badge task-intel-${escapeHtml(taskIntel.priorityBand)}">${escapeHtml(taskIntel.priorityBand)}</span>` : ''}
                        ${taskIntel.recommendedAction ? `<span class="task-intel-badge">${escapeHtml(taskIntel.recommendedAction)}</span>` : ''}
                    </div>
                    ${taskWhy ? `<div style="margin-top:6px;font-size:12px;color:var(--gray-500)">${escapeHtml(taskWhy)}</div>` : ''}
                </div>
                ${renderTaskDetailContext(t)}
                ${renderTaskDetailSource(t)}
                ${renderBanquetDepositTaskPanel(t, depositProjection, { label: _lbl, input: _inp })}
                <div style="border:1px solid rgba(20,184,166,0.20);border-radius:10px;padding:10px;background:rgba(20,184,166,0.06)">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                        <strong style="font-size:13px">Підзадачі</strong>
                        <span id="_tdSubtaskProgressLabel" style="font-size:11px;font-weight:800;color:#0f766e">${detailSubtaskSummary.total ? `${detailSubtaskSummary.done}/${detailSubtaskSummary.total} · ${detailSubtaskProgress}%` : 'Без підзадач'}</span>
                    </div>
                    <div class="task-subtask-progress" style="margin:0 0 8px">
                        <div id="_tdSubtaskProgressFill" class="task-subtask-progress-fill" style="width:${detailSubtaskProgress}%"></div>
                    </div>
                    <div id="_tdSubtasksList" class="task-subtasks-list" data-subtasks-loaded="true">
                        ${renderTaskDetailSubtasks(detailSubtasks)}
                    </div>
                    <button type="button" id="_tdSubtaskAdd" class="task-subtask-add" style="margin-top:8px">+ Підзадача</button>
                </div>
                <div style="border:1px solid var(--gray-100);border-radius:10px;padding:10px;background:rgba(20,184,166,0.06)">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px">
                        <div>
                            <strong style="font-size:13px">Спостерігачі і матеріали</strong>
                            <div style="font-size:12px;color:var(--gray-500);margin-top:3px">Обрані люди бачать задачу, опис, чекліст, історію дій і робочі матеріали без права змінювати виконання.</div>
                        </div>
                        <span id="_tdObserverCount" style="font-size:11px;font-weight:800;color:#0f766e;background:rgba(20,184,166,0.12);border:1px solid rgba(20,184,166,0.24);border-radius:999px;padding:4px 8px">${Number(t.observerCount || currentObserverIds.size || 0)} доступ</span>
                    </div>
                    <select id="_tdObservers" multiple size="4" ${_inp} style="width:100%;min-height:96px;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;font-family:inherit">
                        ${observerSelectHtml}
                    </select>
                    <div id="_tdObserversHint" style="font-size:12px;color:var(--gray-500);margin-top:6px">Ctrl/Cmd + клік: вибрати кількох спостерігачів. Власник задачі вже має повний доступ.</div>
                    <button type="button" data-task-drawer-action="manageObservers" onclick="saveTaskObservers(${t.id})" style="margin-top:8px;border:1px solid rgba(20,184,166,0.34);background:rgba(20,184,166,0.12);color:#0f766e;border-radius:8px;padding:7px 10px;font-weight:800;cursor:pointer">Зберегти доступ</button>
                </div>
                <div class="action-history-card task-detail-history-card">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                        <strong style="font-size:13px">Історія дій</strong>
                        <button type="button" class="action-history-refresh" onclick="loadTaskHistory(${t.id})">Оновити</button>
                    </div>
                    <div id="_tdHistory" class="task-detail-history-list">Завантаження історії...</div>
                </div>
            </div>
            <div style="padding:12px 20px;border-top:1px solid var(--gray-100);display:flex;gap:8px;flex-wrap:wrap">
                <button data-task-drawer-action="save" onclick="saveTaskDetail(${t.id})" ${canSaveTaskDetail ? '' : 'disabled'} style="flex:2;min-width:120px;padding:10px;border:none;border-radius:10px;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px">💾 Зберегти</button>
                <button data-task-drawer-action="complete" onclick="taskDetailComplete(${t.id})" ${t.status === 'done' || !canCompleteTaskDetail ? 'disabled' : ''} style="flex:1;min-width:110px;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:#10B981;color:#fff;cursor:pointer;font-family:inherit;font-size:13px">Done</button>
                <button data-task-drawer-action="reassign" onclick="taskDetailReassign(${t.id})" ${canReassignTaskDetail ? '' : 'disabled'} style="flex:1;min-width:110px;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:#2563EB;color:#fff;cursor:pointer;font-family:inherit;font-size:13px">Reassign</button>
                <button data-task-drawer-action="reschedule" onclick="taskDetailReschedule(${t.id})" ${canRescheduleTaskDetail ? '' : 'disabled'} style="flex:1;min-width:110px;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:#F59E0B;color:#fff;cursor:pointer;font-family:inherit;font-size:13px">Reschedule</button>
                <button data-task-drawer-action="review" onclick="taskDetailReview(${t.id})" ${canReviewTaskDetail ? '' : 'disabled'} style="flex:1;min-width:110px;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:#7C3AED;color:#fff;cursor:pointer;font-family:inherit;font-size:13px">\u041e\u0446\u0456\u043d\u0438\u0442\u0438</button>
                <button data-task-drawer-action="delete" onclick="deleteTask(${t.id})" ${canDeleteTaskDetail ? '' : 'disabled'} style="flex:1;min-width:110px;padding:10px;border:1px solid #FCA5A5;border-radius:10px;background:#FEF2F2;color:#B91C1C;cursor:pointer;font-family:inherit;font-size:13px">\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438</button>
                <button onclick="closeTaskDetailOverlay(false)" style="flex:1;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:none;cursor:pointer;font-family:inherit;font-size:13px">Скасувати</button>
            </div>
        </div>`;
        document.getElementById('_tdCategory')?.addEventListener('change', syncDetailSubcategoryVisibility);
        bindTaskDetailSubtasks();
        document.querySelectorAll('[data-detail-schedule-slot]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-detail-schedule-slot]').forEach(slotBtn => {
                    const active = slotBtn === btn;
                    slotBtn.classList.toggle('active', active);
                    slotBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
                const exact = document.getElementById('_tdScheduleStart');
                if (exact) exact.value = '';
            });
        });
        syncDetailSubcategoryVisibility();
        updateTaskDetailSubtaskProgress();
        rememberBanquetDepositFormState();
        resetTaskDetailDirtyState();
        applyTaskDetailActionPermissions(t);
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(overlay);
        loadTaskHistory(t.id);
        loadTaskObservers(t.id);

        // Highlight card in list
        document.querySelectorAll('.task-card').forEach(c => c.style.outline = '');
        const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
        if (card) { card.style.outline = '2px solid #10B981'; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    } catch (err) { showNotification('Помилка: ' + err.message, 'error'); }
}
if (window.TaskDetailDrawer) window.TaskDetailDrawer.registerRenderer(renderTaskDetailDrawer, closeTaskDetailOverlay);
window.openTaskDetail = openTaskDetail;

function historyActionTitle(actionType) {
    if (window.ActionHistoryView) return window.ActionHistoryView.titleFor(actionType, 'task');
    const labels = {
        task_completed: 'Задачу виконано',
        task_owner_reassigned: 'Відповідального змінено',
        task_rescheduled: 'Задачу переплановано',
        task_observers_updated: 'Спостерігачів оновлено',
        task_scheduled: 'Задачу заплановано',
        task_schedule_moved: 'Розклад перенесено',
        task_schedule_manual_override: 'Ручний розклад',
        task_schedule_proposal_created: 'Пропозиція розкладу',
        task_slot_missed: 'Слот пропущено',
        task_discipline_penalty_applied: 'Штраф дисципліни застосовано'
    };
    return labels[actionType] || actionType || 'Дія задачі';
}

function shortHistoryValue(value = {}) {
    if (window.ActionHistoryView) return window.ActionHistoryView.valueLabel(value);
    if (!value || typeof value !== 'object') return '';
    if (value.status) return `статус: ${value.status}`;
    if (value.ownerUserId !== undefined) return `відповідальний: ${value.ownerUserId || 'немає'}`;
    if (Array.isArray(value.observerUserIds)) return `спостерігачів: ${value.observerUserIds.length}`;
    if (value.deadline !== undefined) return `дедлайн: ${value.deadline || 'немає'}`;
    if (value.scheduledStartAt !== undefined || value.scheduleStatus !== undefined) {
        return `${value.scheduleStatus || 'розклад'}: ${value.scheduledStartAt || value.scheduleSlot || 'немає'}`;
    }
    return '';
}

function renderTaskHistory(history = []) {
    if (window.ActionHistoryView) {
        return window.ActionHistoryView.renderList(history, {
            kind: 'task',
            listClass: 'task-action-history-list',
            rowClass: 'task-action-history-row',
            emptyMessage: 'Ще немає історії дій'
        });
    }
    if (!history.length) return '<div style="color:var(--gray-400)">Ще немає історії дій</div>';
    return history.map(event => {
        const oldValue = shortHistoryValue(event.oldValue);
        const newValue = shortHistoryValue(event.newValue);
        const when = event.createdAt ? new Date(event.createdAt).toLocaleString('uk-UA') : '';
        return `<div style="border-top:1px solid var(--gray-100);padding:7px 0">
            <div style="display:flex;justify-content:space-between;gap:8px"><strong>${escapeHtml(historyActionTitle(event.actionType))}</strong><span>${escapeHtml(when)}</span></div>
            <div>${escapeHtml(event.actor?.name || 'system')}</div>
            ${(oldValue || newValue) ? `<div style="color:var(--gray-500)">${escapeHtml(oldValue || '—')} → ${escapeHtml(newValue || '—')}</div>` : ''}
        </div>`;
    }).join('');
}

async function loadTaskHistory(taskId) {
    const target = document.getElementById('_tdHistory');
    if (!target) return;
    target.textContent = 'Завантаження історії...';
    const result = await apiGetTaskHistory(taskId);
    if (!result?.success) {
        target.innerHTML = '<div style="color:#ef4444">Не вдалося завантажити історію</div>';
        return;
    }
    target.innerHTML = renderTaskHistory(result.history || []);
}
window.loadTaskHistory = loadTaskHistory;

async function loadTaskObservers(taskId) {
    const select = document.getElementById('_tdObservers');
    const count = document.getElementById('_tdObserverCount');
    if (!select) return;
    const result = await apiGetTaskObservers(taskId);
    if (!result?.success) {
        const hint = document.getElementById('_tdObserversHint');
        if (hint) hint.textContent = 'Не вдалося завантажити спостерігачів. Доступ не змінено.';
        return;
    }
    const ids = new Set((result.observers || []).map(item => Number(item.userId || item.user_id || item.id || 0)).filter(Boolean));
    Array.from(select.options).forEach(option => { option.selected = ids.has(Number(option.value)); });
    if (count) count.textContent = `${ids.size} доступ`;
}
window.loadTaskObservers = loadTaskObservers;

async function saveTaskObservers(taskId) {
    const select = document.getElementById('_tdObservers');
    if (!select) return;
    const observerUserIds = Array.from(select.selectedOptions).map(option => Number(option.value)).filter(Boolean);
    const result = await apiSaveTaskObservers(taskId, observerUserIds);
    if (result?.success) {
        showNotification('Доступ спостерігачів оновлено', 'success');
        const count = document.getElementById('_tdObserverCount');
        if (count) count.textContent = `${(result.observers || []).length} доступ`;
        await loadTaskHistory(taskId);
        return;
    }
    showNotification(result?.error || 'Не вдалося оновити спостерігачів', 'error');
}
window.saveTaskObservers = saveTaskObservers;

async function taskDetailComplete(taskId) {
    if (taskDetailDepositPanel()) {
        const confirmed = await confirmBanquetDepositFromTask(taskId);
        if (!confirmed) return;
    }
    let result = await apiCompleteTask(taskId, { sourceSurface: 'task_detail' });
    if (window.TaskReportGate?.responseNeedsReport?.(result)) {
        const task = allTasks.find(t => Number(t.id) === Number(taskId)) || {};
        const reportId = await window.TaskReportGate.openReportModal(task, { sourceSurface: 'task_detail', taskId });
        if (!reportId) {
            showNotification('Звіт потрібен перед виконанням задачі', 'warning');
            return;
        }
        result = await apiCompleteTask(taskId, { sourceSurface: 'task_detail', reportId });
    }
    if (result?.success) {
        window.SoundEngine?.playTask?.('task-complete');
        showNotification('Задачу виконано', 'success');
        notifyTaskWidgetsChanged({ action: 'task_status', taskId, status: 'done' });
        await closeTaskDetailOverlay(true);
        await loadAllTasks();
        return;
    }
    showNotification(result?.error || 'Не вдалося виконати задачу', 'error');
}
window.taskDetailComplete = taskDetailComplete;

async function taskDetailReassign(taskId) {
    const ownerUserId = document.getElementById('_tdAssigned')?.value;
    if (!ownerUserId) {
        showNotification('Оберіть typed owner для reassignment', 'error');
        return;
    }
    const result = await apiReassignTask(taskId, ownerUserId);
    if (result?.success) {
        showNotification('Owner задачі змінено', 'success');
        await loadTaskHistory(taskId);
        resetTaskDetailDirtyState();
        await loadAllTasks();
        return;
    }
    showNotification(result?.error || 'Не вдалося змінити owner', 'error');
}
window.taskDetailReassign = taskDetailReassign;

async function taskDetailReview(taskId) {
    const action = document.querySelector('[data-task-drawer-action="review"]');
    if (action?.disabled) {
        showNotification(action.title || taskPermissionReasonLabel('TASK_REVIEW_FORBIDDEN'), 'error');
        return;
    }
    if (typeof formModal !== 'function') {
        showNotification('\u0424\u043e\u0440\u043c\u0430 \u043e\u0446\u0456\u043d\u044e\u0432\u0430\u043d\u043d\u044f \u0442\u0438\u043c\u0447\u0430\u0441\u043e\u0432\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430.', 'error');
        return;
    }
    const values = await formModal('\u041e\u0446\u0456\u043d\u0438\u0442\u0438 \u0432\u0438\u043a\u043e\u043d\u0430\u043d\u043d\u044f \u0437\u0430\u0434\u0430\u0447\u0456', [
        { key: 'score', label: '\u041e\u0446\u0456\u043d\u043a\u0430 (1\u201310)', type: 'number', min: 1, max: 10, required: true, defaultValue: '10' },
        { key: 'comment', label: '\u041a\u043e\u043c\u0435\u043d\u0442\u0430\u0440', type: 'textarea', placeholder: '\u041a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 \u0437\u0432\u043e\u0440\u043e\u0442\u043d\u0438\u0439 \u0437\u0432\u2019\u044f\u0437\u043e\u043a' }
    ], { okText: '\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u043e\u0446\u0456\u043d\u043a\u0443', cancelText: '\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438' });
    if (!values) return;
    const score = Number(values.score);
    if (!Number.isInteger(score) || score < 1 || score > 10) {
        showNotification('\u041e\u0446\u0456\u043d\u043a\u0430 \u043c\u0430\u0454 \u0431\u0443\u0442\u0438 \u0432\u0456\u0434 1 \u0434\u043e 10.', 'error');
        return;
    }
    const response = await taskApiFetchWithAuth('/api/tasks/' + taskId + '/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: String(values.comment || '').trim() || null })
    });
    if (!response) return;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
        showNotification(payload?.error || '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u043e\u0446\u0456\u043d\u043a\u0443.', 'error');
        return;
    }
    showNotification('\u041e\u0446\u0456\u043d\u043a\u0443 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e.', 'success');
    notifyTaskWidgetsChanged({ action: 'update', taskId });
    await loadAllTasks();
    await renderTaskDetailDrawer(taskId);
}
window.taskDetailReview = taskDetailReview;

async function taskDetailReschedule(taskId) {
    const date = document.getElementById('_tdScheduleDate')?.value || getTodayStr();
    const durationMinutes = Math.max(5, parseInt(document.getElementById('_tdScheduleDuration')?.value, 10) || 30);
    const manualStart = document.getElementById('_tdScheduleStart')?.value || '';
    const activeSlot = document.querySelector('[data-detail-schedule-slot].active')?.dataset?.detailScheduleSlot || 'morning';
    const payload = manualStart
        ? { schedule: { date, scheduledStartAt: manualStart, durationMinutes }, sourceSurface: 'task_detail' }
        : schedulePayloadFor(date, activeSlot, durationMinutes);
    payload.sourceSurface = 'task_detail';
    const result = await apiScheduleTask(taskId, payload);
    if (result?.success) {
        const proposal = (result.proposals || []).length || result.task?.scheduleStatus === 'proposal';
        showNotification(proposal ? 'Слот зайнятий: збережено пропозицію часу' : 'Розклад задачі оновлено', proposal ? 'info' : 'success');
        await loadTaskHistory(taskId);
        resetTaskDetailDirtyState();
        await loadAllTasks();
        return;
    }
    showNotification(result?.error || 'Не вдалося змінити розклад', 'error');
}
window.taskDetailReschedule = taskDetailReschedule;

async function saveTaskDetail(taskId) {
    const title = document.getElementById('_tdTitle')?.value.trim();
    if (!title) { showNotification('Назва обов\'язкова', 'error'); return; }
    const selectedStatus = document.getElementById('_tdStatus')?.value || 'todo';
    if (selectedStatus === 'done') {
        await taskDetailComplete(taskId);
        return;
    }
    try {
        const category = document.getElementById('_tdCategory')?.value || 'admin';
        const subcategory = selectedSubcategoryFor(category, '_tdSubcategory');
        const scheduleDate = document.getElementById('_tdScheduleDate')?.value || getTodayStr();
        const scheduleDuration = Math.max(5, parseInt(document.getElementById('_tdScheduleDuration')?.value, 10) || 30);
        const scheduleExact = document.getElementById('_tdScheduleStart')?.value || '';
        const scheduleSlot = document.querySelector('[data-detail-schedule-slot].active')?.dataset?.detailScheduleSlot || 'morning';
        const body = {
            title,
            description: document.getElementById('_tdDesc')?.value.trim() || null,
            status: selectedStatus,
            priority: document.getElementById('_tdPriority')?.value || 'normal',
            category,
            subcategory,
            checklist_template_key: normalizeChecklistTemplateKey(category, subcategory),
            deadline: document.getElementById('_tdDeadline')?.value || null,
            effort_minutes: scheduleDuration,
            schedule: scheduleExact
                ? { date: scheduleDate, scheduledStartAt: scheduleExact, durationMinutes: scheduleDuration }
                : { date: scheduleDate, slot: scheduleSlot, durationMinutes: scheduleDuration },
            task_mode: document.getElementById('_tdMode')?.value || 'work',
            task_kind: document.getElementById('_tdKind')?.value || 'action',
            visibility: document.getElementById('_tdVisibility')?.value || 'team',
            workflow_state: document.getElementById('_tdWorkflow')?.value || (selectedStatus === 'done' ? 'done' : 'todo'),
            remind_at: document.getElementById('_tdRemindAt')?.value || null,
            pack_status: document.getElementById('_tdPackStatus')?.value || null,
            owner_role: document.getElementById('_tdOwnerRole')?.value.trim() || null,
            sla_minutes: document.getElementById('_tdSlaMinutes')?.value || null,
            subtasks: readTaskDetailSubtasks(),
            version: document.getElementById('taskDetailOverlay')?.dataset?.taskVersion || undefined
        };
        const res = await taskApiFetchWithAuth(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res) return;
        if (res.ok) {
            await closeTaskDetailOverlay(true);
            showNotification('Задачу збережено');
            await loadAllTasks();
        } else {
            const data = await res.json().catch(() => ({}));
            showNotification(data.error || 'Помилка збереження', 'error');
        }
    } catch (err) { showNotification('Помилка: ' + err.message, 'error'); }
}
window.saveTaskDetail = saveTaskDetail;

async function quickChangeStatus(taskId, newStatus) {
    if (newStatus === 'done') {
        await taskDetailComplete(taskId);
        return;
    }
    try {
        const res = await taskApiFetchWithAuth(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res) {
            showNotification('Помилка зміни статусу', 'error');
            return;
        }
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const mutation = taskMutationFailure(data, res, 'Помилка зміни статусу');
            showNotification(mutation.error, 'error');
            return;
        }
        await closeTaskDetailOverlay(true);
        showNotification('Статус змінено');
        await loadAllTasks();
    } catch (err) { showNotification('Помилка зміни статусу: ' + (err.message || ''), 'error'); }
}
window.quickChangeStatus = quickChangeStatus;

window.TasksPage = {
    ...(window.TasksPage || {}),
    getAssistantSnapshot: getTasksAssistantSnapshot
};

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    let externalTaskRefreshTimer = null;
    window.addEventListener('popstate', () => {
        const state = taskCenterQueryStateFromUrl(new URLSearchParams(window.location.search));
        applyTaskCenterQueryState(state);
        applyTaskViewShell(currentView);
        if (currentView === 'templates') void loadTemplates();
        else void loadAllTasks({ fatal: false });
    });
    window.addEventListener('crm:tasks-updated', (event) => {
        const detail = event?.detail || {};
        const localOrigin = window.TaskUiShared?.TaskMutationSync?.originId?.();
        if (detail.originId ? detail.originId === localOrigin : detail.source === 'tasks_page') return;
        window.clearTimeout(externalTaskRefreshTimer);
        externalTaskRefreshTimer = window.setTimeout(() => {
            loadAllTasks({ fatal: false }).catch(error => {
                console.warn('Tasks page external refresh failed', error);
            });
        }, 300);
    });
}

document.addEventListener('DOMContentLoaded', initPage);
