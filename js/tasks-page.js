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
const STATUS_LABELS = { todo: 'До виконання', in_progress: 'В роботі', done: 'Готово' };
const KANBAN_STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITY_ICONS = { high: '', normal: '', low: '' };
const PATTERN_LABELS = { daily: 'Щоденно', weekdays: 'Будні', weekly: 'Щотижня (пн)', custom: 'Обрані дні' };
const TASK_SCHEDULE_SLOTS = [
    { key: 'morning', icon: '🌅', label: 'Ранок' },
    { key: 'midday', icon: '☀️', label: 'День' },
    { key: 'afternoon', icon: '🌤️', label: 'Після обіду' },
    { key: 'evening', icon: '🌙', label: 'Вечір' }
];

let currentView = 'inbox';
let currentCategory = 'all';
let currentSubcategory = 'all';
let currentScopeFilter = 'all';
let assistantTaskFilter = '';
let allTasks = [];
let userPermissions = null; // v20.9.16: loaded from /api/tasks/permissions
let pageCurrentUser = null;
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

// ==========================================
// UTILITIES
// ==========================================


function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCategoryConfig(category) {
    return TASK_CATEGORY_TREE[category] || TASK_CATEGORY_TREE.admin;
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

function renderCategoryOptions(selected = 'admin') {
    const optionCats = Array.from(new Set([...TOP_LEVEL_ORDER, 'operational', 'maintenance']));
    return optionCats.map(cat => {
        const info = getCategoryConfig(cat);
        return `<option value="${cat}" ${selected === cat ? 'selected' : ''}>${escapeHtml(info.label)}</option>`;
    }).join('');
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
    return task.scheduledStartAt || task.scheduled_start_at || task.schedule?.startAt || null;
}

function taskScheduleEnd(task = {}) {
    return task.scheduledEndAt || task.scheduled_end_at || task.schedule?.endAt || null;
}

function taskScheduleStatus(task = {}) {
    return task.scheduleStatus || task.schedule_status || task.schedule?.status || (taskScheduleStart(task) ? 'scheduled' : 'unscheduled');
}

function taskScheduleSlot(task = {}) {
    return task.scheduleSlot || task.schedule_slot || task.schedule?.slot || null;
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
    return taskTextValue(task.ownerLabel || task.owner_label || task.assigned_to || task.owner);
}

function getTaskOwnerState(task = {}) {
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

function setBoardView(view = 'inbox') {
    currentView = view;
    document.querySelectorAll('.board-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
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
    if (view === 'templates' || userPermissions?.canCreateTasks === false) return false;
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
    const canCreate = userPermissions?.canCreateTasks !== false;
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

function activateTaskView(view = 'inbox') {
    currentView = view;
    assistantTaskFilter = '';
    setBoardView(view);
    applyTaskViewShell(view);
    updateTaskExplainability();
    if (view === 'templates') loadTemplates();
    else renderBoard();
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
    const token = localStorage.getItem('pzp_token');
    if (!token) { window.location.href = '/'; return; }

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
        const params = new URLSearchParams(window.location.search);
        const requestedView = params.get('view');
        assistantTaskFilter = normalizeAssistantTaskFilter(params.get('assistantFilter'));
        const allowedViews = ['inbox', 'today', 'next', 'waiting', 'team', 'my', 'week', 'board', 'routines', 'done_today', 'archive', 'templates'];
        if (requestedView && allowedViews.includes(requestedView)) currentView = requestedView;
        if (assistantTaskFilter === 'overdue' && !requestedView) currentView = 'team';
        if (requestedView === 'focus' || currentView === 'focus') currentView = 'today';

        await _loadAssigneeDropdown();
        bootStep('owners:loaded', { count: _assigneeList.length });
        setupTaskComposer();
        setupTaskGovernanceMenu();
        setupTaskActionDelegation();

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
            currentCategory = chip.dataset.cat || 'all';
            currentSubcategory = 'all';
            renderCategoryFilters();
            renderSubcategoryFilters();
            syncTaskSurfaceVisibility();
            renderBoard();
        });
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
        });
        document.getElementById('taskTitle')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addTask();
        });
        document.querySelectorAll('[data-capture-chip]').forEach(btn => {
            btn.addEventListener('click', () => applyCaptureChip(btn.dataset.captureChip));
        });

        // Templates
        document.getElementById('addTemplateBtn')?.addEventListener('click', addTemplate);
        document.getElementById('tplCategory')?.addEventListener('change', () => syncSubcategorySelect('tplCategory', 'tplSubcategory'));
        document.getElementById('tplPattern')?.addEventListener('change', (e) => {
            document.getElementById('tplDays').style.display = e.target.value === 'custom' ? '' : 'none';
        });
        document.getElementById('createOperationPackBtn')?.addEventListener('click', createOperationPack);
        syncSubcategorySelect('taskCategory', 'taskSubcategory');
        syncSubcategorySelect('tplCategory', 'tplSubcategory');

        // v20.9.16: Load permissions and apply UI restrictions
        const permsResult = await apiGetTaskPermissions();
        if (permsResult && permsResult.permissions) {
            userPermissions = permsResult.permissions;
            applyPermissionsUI(userPermissions);
        }
        document.querySelectorAll('.board-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === currentView));
        bootStep('permissions:loaded', { hasPermissions: Boolean(userPermissions) });

        await loadAllTasks({ fatal: true });
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
    // Hide quick-add form if user cannot create tasks
    if (!perms.canCreateTasks) {
        const quickAdd = document.getElementById('quickAdd');
        if (quickAdd) quickAdd.hidden = true;
        const operationPackBar = document.getElementById('operationPackBar');
        if (operationPackBar) operationPackBar.hidden = true;
        // Also hide templates tab (only creators can add templates)
        const templatesTab = document.querySelector('[data-view="templates"]');
        if (templatesTab) templatesTab.style.display = 'none';
    }
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
        const response = await fetch(`${API_BASE}/tasks${qs}`, { headers: getAuthHeaders(false) });
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
        return await window.TaskCreate.createTask(data, {
            onDuplicate: (err) => showNotification(err.message || 'Активний дубль не створено', 'warning')
        });
    }
    try {
        const response = await fetch(`${API_BASE}/tasks`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        if (response.status === 409) {
            const err = await response.json();
            showNotification(err.message || 'Активний дубль не створено', 'warning');
            return null;
        }
        if (!response.ok) throw new Error('create task API error');
        return await response.json();
    } catch (err) { console.error('API createTask error:', err); return null; }
}

// v33.3: Bulk task actions
async function apiBulkTasks(ids, action, extra = {}) {
    try {
        const response = await fetch(`${API_BASE}/tasks/bulk`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ ids, action, ...extra })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API bulkTasks error:', err); return null; }
}

async function apiPatchTaskStatus(id, status) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${id}/status`, {
            method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ status })
        });
        if (handleAuthError(response)) return null;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                success: false,
                error: payload.error || payload.message || `status update failed (${response.status})`
            };
        }
        return payload;
    } catch (err) {
        console.error('API patchTaskStatus error:', err);
        return { success: false, error: err?.message || 'status update failed' };
    }
}

async function apiGetTaskDedupReport() {
    try {
        const response = await fetch(`${API_BASE}/tasks/dedup-report`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API getTaskDedupReport error:', err); return null; }
}

async function apiCleanupTaskDuplicates(dryRun = false) {
    try {
        const response = await fetch(`${API_BASE}/tasks/dedup-cleanup`, {
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
        const response = await fetch(`${API_BASE}/tasks/${id}/snooze`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ minutes })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API snoozeTask error:', err); return null; }
}

async function apiDeleteTask(id) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${id}`, {
            method: 'DELETE', headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API deleteTask error:', err); return null; }
}

async function apiGetTemplates() {
    try {
        const response = await fetch(`${API_BASE}/task-templates`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        return await response.json();
    } catch (err) { console.error('API getTemplates error:', err); return []; }
}

async function apiCreateTemplate(data) {
    try {
        const response = await fetch(`${API_BASE}/task-templates`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API createTemplate error:', err); return null; }
}

async function apiDeleteTemplate(id) {
    try {
        const response = await fetch(`${API_BASE}/task-templates/${id}`, {
            method: 'DELETE', headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API deleteTemplate error:', err); return null; }
}

// v20.9.16: Permissions API
async function apiGetTaskPermissions() {
    try {
        const response = await fetch(`${API_BASE}/tasks/permissions`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) { console.error('API getTaskPermissions error:', err); return null; }
}

async function apiGetTaskOwners() {
    try {
        const response = await fetch(`${API_BASE}/tasks/owners`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) return [];
        const data = await response.json();
        return data.users || [];
    } catch (err) { console.error('API getTaskOwners error:', err); return []; }
}

async function apiGetTaskHistory(taskId) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}/history?limit=10`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, history: [] };
        if (!response.ok) throw new Error('history API error');
        return await response.json();
    } catch (err) { console.error('API getTaskHistory error:', err); return { success: false, history: [], error: err.message }; }
}

async function apiGetTaskObservers(taskId) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}/observers`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { success: false, observers: [] };
        if (!response.ok) throw new Error('observers API error');
        return await response.json();
    } catch (err) { console.error('API getTaskObservers error:', err); return { success: false, observers: [], error: err.message }; }
}

async function apiSaveTaskObservers(taskId, observerUserIds) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}/observers`, {
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
        const response = await fetch(`${API_BASE}/tasks/${taskId}/complete`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ sourceSurface: options.sourceSurface || 'task_page', reportId: options.reportId || undefined })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) { console.error('API completeTask error:', err); return null; }
}

async function apiReassignTask(taskId, ownerUserId) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}/reassign`, {
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
        const response = await fetch(`${API_BASE}/tasks/${taskId}/reschedule`, {
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
        const response = await fetch(`${API_BASE}/tasks/${taskId}/schedule`, {
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
    const items = ['all', ...TOP_LEVEL_ORDER];
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

async function loadAllTasks(options = {}) {
    const { fatal = false } = options;
    const board = document.getElementById('boardContent');
    if (board) board.innerHTML = '<div class="loading-spinner">Завантаження задач…</div>';
    try {
        const tasks = await apiGetTasks();
        if (!Array.isArray(tasks)) {
            throw new Error('/api/tasks returned non-array payload');
        }
        allTasks = tasks;
        updateCounts();
        renderBoard();
    } catch (err) {
        console.error('loadAllTasks error:', err);
        if (fatal) throw err;
        showNotification('Помилка завантаження задач', 'error');
        if (board) board.innerHTML = '';
    }
}

async function apiCreateOperationPack(data) {
    try {
        const response = await fetch(`${API_BASE}/tasks/operation-pack`, {
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
    return applyTaskScopeFilter(filterByTaxonomy(tasks));
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

function taskMode(t = {}) { return t.taskMode || t.task_mode || 'work'; }
function taskKind(t = {}) { return t.taskKind || t.task_kind || 'action'; }
function taskVisibility(t = {}) { return t.visibility || (taskMode(t) === 'private' ? 'private' : 'team'); }
function taskWorkflow(t = {}) { return t.workflowState || t.workflow_state || (t.status === 'done' ? 'done' : 'todo'); }
function taskDueDate(t = {}) { return (taskScheduleStart(t) || t.deadline || t.remindAt || t.remind_at || t.date || '').slice(0, 10); }
function isActiveTask(t) { return !['done', 'archived', 'cancelled'].includes(t.status); }
function isWaitingTask(t) { return taskWorkflow(t) === 'waiting' || taskKind(t) === 'waiting'; }
function isPrivateTask(t) { return taskVisibility(t) === 'private' || taskMode(t) === 'private'; }
function isTeamTask(t) { return taskVisibility(t) === 'team' && taskMode(t) === 'work'; }
function isInboxTask(t) { return isActiveTask(t) && (taskWorkflow(t) === 'inbox' || (!t.date && !t.deadline && !taskScheduleStart(t))); }
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
        followup: 'Follow-up',
        deep_work: 'Deep work',
        checklist: 'Checklist',
        routine: 'Рутина',
        waiting: 'Чекаю',
        idea: 'Ідея',
        decision: 'Рішення'
    }[kind] || kind;
    return `<span class="task-os-badge kind-${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}

function getVisibilityNote() {
    const visibility = userPermissions?.taskVisibility;
    const notes = [];
    if (visibility === 'own') notes.push('Показано тільки задачі, призначені вам');
    if (visibility === 'department') notes.push('Показано ваші задачі та задачі відділу');
    if (userPermissions?.canCreateTasks === false) notes.push('Створення задач недоступне для вашої ролі');
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
    currentView = 'inbox';
    currentScopeFilter = 'all';
    renderCategoryFilters();
    renderSubcategoryFilters();
    syncTaskScopeFilters();
    document.querySelectorAll('.board-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === 'inbox'));
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
        showNotification(groups.length ? `Знайдено ${duplicateTotal} активних дублів у ${groups.length} групах. Звичайний список показує canonical-рядки.` : 'Активних дублів не знайдено', groups.length ? 'warning' : 'success');
    });

    document.getElementById('taskDedupCleanupBtn')?.addEventListener('click', async () => {
        const dryRun = await apiCleanupTaskDuplicates(true);
        const victims = Number(dryRun?.victims || 0);
        if (!victims) {
            showNotification('Cleanup не потрібен: активних дублів немає', 'success');
            return;
        }
        if (!await confirmModal(`Архівувати ${victims} активних дублів без видалення історії?`, { type: 'warning', okText: 'Архівувати' })) return;
        const result = await apiCleanupTaskDuplicates();
        if (!result?.success) {
            showNotification('Cleanup дублів не виконано', 'error');
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
    const doneToday = filterByCategory(allTasks.filter(isCompletedToday));
    const todayTasks = active.filter(t => t.date === today || !t.date);
    const weekTasks = active.filter(t => t.date >= week.from && t.date <= week.to);
    const myTasks = active.filter(isTaskInMyWorkspace);
    const nextTasks = active.filter(t => {
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
    setCount('countWaiting', active.filter(isWaitingTask).length);
    setCount('countTeam', active.filter(isTeamTask).length);
    setCount('countMy', myTasks.length);
    setCount('countDoneToday', doneToday.length);
    setCount('summaryMy', myTasks.length);
    setCount('summaryToday', todayTasks.length);
    setCount('summaryWaiting', active.filter(isWaitingTask).length);
    setCount('summaryDoneToday', doneToday.length);
}

function getTasksAssistantViewBase(view = currentView) {
    const today = getTodayStr();
    const week = getWeekRange();
    const active = allTasks.filter(isActiveTask);
    switch (view) {
        case 'today':
            return active.filter(t => t.date === today || !t.date);
        case 'next':
            return active.filter(t => {
                const due = taskDueDate(t);
                return due && due > today && due <= week.to;
            });
        case 'waiting':
            return active.filter(isWaitingTask);
        case 'team':
            return active.filter(isTeamTask);
        case 'week':
            return active.filter(t => t.date >= week.from && t.date <= week.to);
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
    const doneToday = filterByCategory(allTasks.filter(isCompletedToday));
    const currentViewBase = filterByCategory(getTasksAssistantViewBase(currentView));
    const currentViewFiltered = applyAssistantTaskFilter(currentViewBase);
    const nextTasks = active.filter(t => {
        const due = taskDueDate(t);
        return due && due > today && due <= week.to;
    });
    return {
        loaded: allTasks.length,
        active: active.length,
        inbox: active.filter(isInboxTask).length,
        today: active.filter(t => t.date === today || !t.date).length,
        week: active.filter(t => t.date >= week.from && t.date <= week.to).length,
        next: nextTasks.length,
        waiting: active.filter(isWaitingTask).length,
        team: active.filter(isTeamTask).length,
        my: active.filter(isTaskInMyWorkspace).length,
        doneToday: doneToday.length,
        archive: filterByCategory(allTasks.filter(t => t.status === 'archived')).length,
        currentView: currentViewBase.length,
        currentVisible: currentViewFiltered.length,
        assistantFilteredOut: Math.max(0, currentViewBase.length - currentViewFiltered.length),
        overdue: active.filter(isOverdueTask).length,
        nearDeadline: active.filter(t => {
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
    renderOperationsSummary();

    switch (currentView) {
        case 'inbox': renderSimpleTaskView(container, 'inbox', t => isInboxTask(t), 'Інбокс чистий. Нові задачі без контексту зʼявлятимуться тут.', t => taskWorkflow(t) === 'inbox' || (!t.date && !t.deadline)); break;
        case 'today': renderTodayView(container); break;
        case 'next': renderSimpleTaskView(container, 'next', t => {
            const today = getTodayStr();
            const week = getWeekRange();
            const due = taskDueDate(t);
            return isActiveTask(t) && due && due > today && due <= week.to;
        }, 'На найближчі дні нічого не заплановано.', t => {
            const today = getTodayStr();
            const week = getWeekRange();
            const due = taskDueDate(t) || (taskCompletedAt(t) || '').slice(0, 10);
            return due && due > today && due <= week.to;
        }); break;
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
    const activeBase = allTasks.filter(t => isActiveTask(t) && (t.date === today || !t.date));
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
    const orderedCats = [...TOP_LEVEL_ORDER, 'operational', 'maintenance', ...Object.keys(groups).filter(cat => !TOP_LEVEL_ORDER.includes(cat) && !['operational', 'maintenance'].includes(cat))];
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
    const activeBase = allTasks.filter(t => isActiveTask(t) && t.date >= week.from && t.date <= week.to);
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
            <b>${tasks.length}</b> виконано сьогодні · newest first · історія лишається в системі
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
    if (result?.success) {
        // Clear archive fields
        const token = localStorage.getItem('pzp_token');
        await fetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ status: 'todo', health_score: 50 })
        }).catch(() => {});
        if (typeof showNotification === 'function') showNotification('Задачу відновлено', 'success');
        await loadAllTasks();
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

function renderTaskCard(t) {
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
    const subtaskBadge = subtaskCount ? `<span class="task-os-badge checklist">${subtaskDone}/${subtaskCount}</span>` : '';
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
    let deadlineHtml = '';
    if (t.deadline) {
        const dl = new Date(t.deadline);
        const now = new Date();
        const diffMin = (dl - now) / (1000 * 60);
        let dlClass = 'deadline-ok';
        if (diffMin < 0) dlClass = 'deadline-overdue';
        else if (diffMin < 60) dlClass = 'deadline-soon';
        const dlTime = dl.toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
        const dlDate = dl.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
        deadlineHtml = `<span class="task-card-deadline ${dlClass}">${dlDate} ${dlTime}</span>`;
    }

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
    const isKanbanCard = currentView === 'board' && KANBAN_STATUSES.includes(t.status);
    const isKanbanSaving = kanbanSavingTaskIds.has(Number(t.id));
    const kanbanAttrs = isKanbanCard
        ? ` draggable="true" data-kanban-card="true" data-status="${escapeHtml(t.status)}" aria-grabbed="false"`
        : ` data-status="${escapeHtml(t.status || '')}"`;

    return `
    <div class="task-card cat-${cat} ${t.priority !== 'normal' ? 'priority-' + t.priority : ''} ${t.status === 'done' ? 'status-done' : ''} ${blockedCount ? 'is-blocked' : ''} ${selfPersonal ? 'is-self-personal' : ''} ${isKanbanSaving ? 'is-kanban-saving' : ''}" data-task-open="true" role="button" tabindex="0" data-task-id="${t.id}" data-subcategory="${escapeHtml(t.subcategory || '')}" data-pack-id="${escapeHtml(t.packId || t.pack_id || '')}"${selfPersonalAttrs}${kanbanAttrs}>
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
            ${ownerHtml}
            ${completedHtml}
            ${intelHtml}
            ${t.type === 'recurring' ? '<span class="badge badge-normal">Повтор</span>' : ''}
            ${t.type === 'afisha' ? '<span class="badge badge-normal">Афіша</span>' : ''}
        </div>
        <div class="task-card-actions">
            <button class="${btnClass}" data-task-action="status" data-task-id="${t.id}" data-next-status="${nextStatus}">${STATUS_ICONS[nextStatus]} ${nextLabel}</button>
            ${!isWaitingTask(t) ? `<button data-task-action="waiting" data-task-id="${t.id}">Чекаю</button>` : ''}
            ${renderCardScheduleActions(t.id)}
            <button data-task-action="snooze" data-task-id="${t.id}" data-minutes="60">+1 год</button>
            ${!userPermissions || userPermissions.canDeleteTasks ? `<button class="btn-delete" data-task-action="delete" data-task-id="${t.id}" aria-label="Видалити задачу">✕</button>` : ''}
        </div>
    </div>`;
}

// ==========================================
// TASK ACTIONS
// ==========================================

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
        ['normal', 'Звичайний'],
        ['high', 'Високий'],
        ['low', 'Низький']
    ];
    return options.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
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
        source_module: 'tasks'
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
    quickTaskBatchItems = [];
    renderQuickTaskBatchItems();
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
    for (let i = 0; i < drafts.length; i += 1) {
        const data = buildTaskCreatePayload(drafts[i]);
        const result = await apiCreateTask(data);
        if (!result || !result.success) {
            if (createdTasks.length) {
                showNotification(`Створено ${createdTasks.length} з ${drafts.length} задач. Задача #${i + 1} не збережена.`, 'warning');
                await loadAllTasks();
            } else {
                showNotification('Помилка додавання задачі', 'error');
            }
            return;
        }
        createdTasks.push(result.task);
        lastCreatedTaskId = result.task?.id || lastCreatedTaskId;
        keepNewTaskVisible(result.task, data);
    }

    const createdMode = mainDraft.assigneeMode;
    resetTaskComposerAfterCreate();
    if (createdTasks.length > 1) {
        showNotification(`Створено ${createdTasks.length} окремі задачі`, 'success');
    } else {
        showNotification(createdMode === 'self' ? 'Задачу додано собі' : 'Задачу додано і призначено команді', 'success');
    }
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

async function handleTaskActionButton(button) {
    const taskId = Number(button.dataset.taskId || 0);
    const action = button.dataset.taskAction || '';
    if (!taskId || !action) return;
    await runTaskAction(button, async () => {
        if (action === 'status') await cycleStatus(taskId, button.dataset.nextStatus || 'done');
        if (action === 'waiting') await markTaskWaiting(taskId);
        if (action === 'schedule') await quickScheduleTask(taskId, button.dataset.scheduleSlotAction || quickScheduleSlot);
        if (action === 'snooze') await snoozeTaskQuick(taskId, Number(button.dataset.minutes || 60));
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

    if (result?.success) {
        if (result.task) applyKanbanTaskStatus(taskId, result.task.status || targetStatus, result.task);
        showNotification(`Задачу переміщено: ${STATUS_LABELS[targetStatus] || targetStatus}`, 'success');
        await loadAllTasks();
        return;
    }

    restoreKanbanTaskSnapshot(rollbackSnapshot);
    renderBoard();
    showNotification(result?.error || 'Не вдалося зберегти переміщення. Задачу повернуто назад.', 'error');
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

    board.addEventListener('click', async (event) => {
        if (Date.now() - lastKanbanDragEndedAt < 300) {
            event.preventDefault();
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

    board.addEventListener('change', (event) => {
        if (!event.target.matches('.task-bulk-cb')) return;
        updateBulkSelection();
    });
}

async function cycleStatus(taskId, newStatus) {
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
    if (result && result.success) {
        await loadAllTasks();
    } else {
        showNotification(result?.error || 'Помилка зміни статусу', 'error');
    }
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
    const token = localStorage.getItem('pzp_token');
    const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
                ${t.defaultTaskKind === 'checklist' ? '<span class="task-os-badge checklist">Checklist</span>' : ''}
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

function getTaskDetailFormState() {
    const ids = ['_tdTitle', '_tdDesc', '_tdStatus', '_tdPriority', '_tdDeadline', '_tdAssigned', '_tdScheduleDate', '_tdScheduleDuration', '_tdScheduleStart', '_tdCategory', '_tdSubcategory', '_tdMode', '_tdKind', '_tdVisibility', '_tdWorkflow', '_tdRemindAt', '_tdPackStatus', '_tdOwnerRole', '_tdSlaMinutes'];
    return ids.map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
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

async function openTaskDetail(taskId) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/tasks/${taskId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) { showNotification('Задачу не знайдено', 'error'); return; }
        const task = await res.json();
        const t = task.data || task;
        if (!t || !t.id) { showNotification('Задачу не знайдено', 'error'); return; }

        const STATUS_LABELS = { todo: 'До виконання', in_progress: 'В роботі', done: 'Виконано' };
        const PRIORITY_LABELS = { low: 'Низький', normal: 'Звичайний', high: 'Високий' };
        const statusColor = t.status === 'done' ? '#10B981' : t.status === 'in_progress' ? '#3B82F6' : '#F59E0B';
        const prioColor = t.priority === 'high' ? '#EF4444' : t.priority === 'low' ? '#94A3B8' : '#6B7280';
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
                        ${['action','reminder','followup','deep_work','checklist','routine','waiting','idea','decision'].map(k => `<option value="${k}" ${taskKind(t)===k?'selected':''}>${escapeHtml({ action:'Дія', reminder:'Нагадування', followup:'Follow-up', deep_work:'Deep work', checklist:'Checklist', routine:'Рутина', waiting:'Чекаю', idea:'Ідея', decision:'Рішення' }[k])}</option>`).join('')}
                    </select></div>
                    <div><label ${_lbl}>Видимість</label><select id="_tdVisibility" ${_inp}>
                        <option value="team" ${taskVisibility(t)==='team'?'selected':''}>Командна</option>
                        <option value="me_only" ${taskVisibility(t)==='me_only'?'selected':''}>Тільки мені</option>
                        <option value="private" ${taskVisibility(t)==='private'?'selected':''}>Приватна</option>
                    </select></div>
                    <div><label ${_lbl}>Workflow</label><select id="_tdWorkflow" ${_inp}>
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
                        <strong>Task operations</strong>
                        <span>${escapeHtml(ownerStateLabel)}</span>
                        ${taskIntel.priorityBand ? `<span class="task-intel-badge task-intel-${escapeHtml(taskIntel.priorityBand)}">${escapeHtml(taskIntel.priorityBand)}</span>` : ''}
                        ${taskIntel.recommendedAction ? `<span class="task-intel-badge">${escapeHtml(taskIntel.recommendedAction)}</span>` : ''}
                    </div>
                    ${taskWhy ? `<div style="margin-top:6px;font-size:12px;color:var(--gray-500)">${escapeHtml(taskWhy)}</div>` : ''}
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
                    <button type="button" onclick="saveTaskObservers(${t.id})" style="margin-top:8px;border:1px solid rgba(20,184,166,0.34);background:rgba(20,184,166,0.12);color:#0f766e;border-radius:8px;padding:7px 10px;font-weight:800;cursor:pointer">Зберегти доступ</button>
                </div>
                <div style="border:1px solid var(--gray-100);border-radius:10px;padding:10px">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                        <strong style="font-size:13px">Task Action History</strong>
                        <button type="button" onclick="loadTaskHistory(${t.id})" style="border:1px solid var(--gray-200);background:none;border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer">Оновити</button>
                    </div>
                    <div id="_tdHistory" style="font-size:12px;color:var(--gray-500)">Завантаження історії...</div>
                </div>
            </div>
            <div style="padding:12px 20px;border-top:1px solid var(--gray-100);display:flex;gap:8px;flex-wrap:wrap">
                <button onclick="saveTaskDetail(${t.id})" style="flex:2;min-width:120px;padding:10px;border:none;border-radius:10px;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px">💾 Зберегти</button>
                <button onclick="taskDetailComplete(${t.id})" ${t.status === 'done' ? 'disabled' : ''} style="flex:1;min-width:110px;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:#10B981;color:#fff;cursor:pointer;font-family:inherit;font-size:13px">Done</button>
                <button onclick="taskDetailReassign(${t.id})" style="flex:1;min-width:110px;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:#2563EB;color:#fff;cursor:pointer;font-family:inherit;font-size:13px">Reassign</button>
                <button onclick="taskDetailReschedule(${t.id})" style="flex:1;min-width:110px;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:#F59E0B;color:#fff;cursor:pointer;font-family:inherit;font-size:13px">Reschedule</button>
                <button onclick="closeTaskDetailOverlay(false)" style="flex:1;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:none;cursor:pointer;font-family:inherit;font-size:13px">Скасувати</button>
            </div>
        </div>`;
        document.getElementById('_tdCategory')?.addEventListener('change', syncDetailSubcategoryVisibility);
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
        resetTaskDetailDirtyState();
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(overlay);
        loadTaskHistory(t.id);
        loadTaskObservers(t.id);

        // Highlight card in list
        document.querySelectorAll('.task-card').forEach(c => c.style.outline = '');
        const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
        if (card) { card.style.outline = '2px solid #10B981'; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    } catch (err) { showNotification('Помилка: ' + err.message, 'error'); }
}
window.openTaskDetail = openTaskDetail;

function historyActionTitle(actionType) {
    const labels = {
        task_completed: 'Task completed',
        task_owner_reassigned: 'Owner reassigned',
        task_rescheduled: 'Task rescheduled',
        task_observers_updated: 'Observers updated',
        task_scheduled: 'Task scheduled',
        task_schedule_moved: 'Schedule moved',
        task_schedule_manual_override: 'Manual schedule',
        task_schedule_proposal_created: 'Schedule proposal',
        task_slot_missed: 'Slot missed',
        task_discipline_penalty_applied: 'Discipline penalty'
    };
    return labels[actionType] || actionType || 'Task action';
}

function shortHistoryValue(value = {}) {
    if (!value || typeof value !== 'object') return '';
    if (value.status) return `status: ${value.status}`;
    if (value.ownerUserId !== undefined) return `owner: ${value.ownerUserId || 'none'}`;
    if (Array.isArray(value.observerUserIds)) return `observers: ${value.observerUserIds.length}`;
    if (value.deadline !== undefined) return `deadline: ${value.deadline || 'none'}`;
    if (value.scheduledStartAt !== undefined || value.scheduleStatus !== undefined) {
        return `${value.scheduleStatus || 'schedule'}: ${value.scheduledStartAt || value.scheduleSlot || 'none'}`;
    }
    return '';
}

function renderTaskHistory(history = []) {
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
        showNotification('Задачу виконано', 'success');
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
        const token = localStorage.getItem('pzp_token');
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
            version: document.getElementById('taskDetailOverlay')?.dataset?.taskVersion || undefined
        };
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
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
        const token = localStorage.getItem('pzp_token');
        await fetch(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ status: newStatus })
        });
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

document.addEventListener('DOMContentLoaded', initPage);
