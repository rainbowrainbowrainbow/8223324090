/**
 * tasks-page.js — Task Board v10.0 (Tasker + Kleshnya)
 * Views: Today, Week, My Tasks, Kanban, Templates
 * Features: task_type (human/bot), owner, deadline, points, escalation
 */

// ==========================================
// CONSTANTS
// ==========================================

const CAT_LABELS = {
    event: { icon: '', label: 'Івент', color: '#E65100' },
    purchase: { icon: '', label: 'Закупівлі', color: '#2E7D32' },
    admin: { icon: '', label: 'Адмін', color: '#1565C0' },
    trampoline: { icon: '', label: 'Батути', color: '#7B1FA2' },
    personal: { icon: '', label: 'Особисті', color: '#455A64' },
    improvement: { icon: '', label: 'Покращення', color: '#0891B2' }
};

const STATUS_CYCLE = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
const STATUS_ICONS = { todo: '', in_progress: '', done: '' };
const STATUS_LABELS = { todo: 'До виконання', in_progress: 'В роботі', done: 'Готово' };
const PRIORITY_ICONS = { high: '', normal: '', low: '' };
const PATTERN_LABELS = { daily: 'Щоденно', weekdays: 'Будні', weekly: 'Щотижня (пн)', custom: 'Обрані дні' };

let currentView = 'today';
let currentCategory = 'all';
let allTasks = [];
let userPermissions = null; // v20.9.16: loaded from /api/tasks/permissions

// ==========================================
// UTILITIES
// ==========================================


function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ==========================================
// PAGE INIT
// ==========================================

async function initPage() {
    initDarkMode();
    const token = localStorage.getItem('pzp_token');
    if (!token) {
        window.location.href = '/';
        throw new Error('Unauthorized');
    }

    const user = await apiVerifyToken();
    if (!user) {
        window.location.href = '/';
        throw new Error('Unauthorized');
    }

    AppState.currentUser = user;
    document.getElementById('currentUser').textContent = user.name;
    if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    _loadAssigneeDropdown();

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        window.location = '/';
    });

    // Board tab switching
    document.querySelectorAll('.board-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentView = tab.dataset.view;

            const isTemplates = currentView === 'templates';
            document.getElementById('catFilters').style.display = isTemplates ? 'none' : '';
            document.getElementById('quickAdd').style.display = isTemplates ? 'none' : '';
            document.getElementById('boardContent').style.display = isTemplates ? 'none' : '';
            document.getElementById('templatesSection').style.display = isTemplates ? '' : 'none';

            if (isTemplates) {
                loadTemplates();
            } else {
                renderBoard();
            }
        });
    });

    // Category filter chips
    document.querySelectorAll('.cat-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentCategory = chip.dataset.cat;
            renderBoard();
        });
    });

    // Quick add task
    document.getElementById('addTaskBtn')?.addEventListener('click', addTask);
    document.getElementById('taskTitle')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTask();
    });

    // Templates
    document.getElementById('addTemplateBtn')?.addEventListener('click', addTemplate);
    document.getElementById('tplPattern')?.addEventListener('change', (e) => {
        document.getElementById('tplDays').style.display = e.target.value === 'custom' ? '' : 'none';
    });

    // v20.9.16: Load permissions and apply UI restrictions
    const permsResult = await apiGetTaskPermissions();
    if (permsResult && permsResult.permissions) {
        userPermissions = permsResult.permissions;
        applyPermissionsUI(userPermissions);
    }

    await loadAllTasks();
    await loadMyPoints();
}

// v20.9.16: Hide/show UI elements based on role permissions
function applyPermissionsUI(perms) {
    // Hide quick-add form if user cannot create tasks
    if (!perms.canCreateTasks) {
        const quickAdd = document.getElementById('quickAdd');
        if (quickAdd) quickAdd.style.display = 'none';
        // Also hide templates tab (only creators can add templates)
        const templatesTab = document.querySelector('[data-view="templates"]');
        if (templatesTab) templatesTab.style.display = 'none';
    }
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
    try {
        const response = await fetch(`${API_BASE}/tasks`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        // v33.3: Handle duplicate (409)
        if (response.status === 409) {
            const err = await response.json();
            if (await confirmModal(`⚠️ ${err.message || 'Задача вже існує'}\nВсе одно додати дубль?`, { type: 'warning', okText: 'Додати' })) {
                return apiCreateTask({ ...data, force: true });
            }
            return null;
        }
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
        return await response.json();
    } catch (err) { console.error('API patchTaskStatus error:', err); return null; }
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

// v10.0: Points API
async function apiGetMyPoints(username) {
    try {
        const response = await fetch(`${API_BASE}/points/${encodeURIComponent(username)}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) { console.error('API getMyPoints error:', err); return null; }
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

// ==========================================
// LOAD & RENDER
// ==========================================

async function loadAllTasks() {
    const board = document.getElementById('boardContent');
    if (board) board.innerHTML = '<div class="loading-spinner">Завантаження задач…</div>';
    try {
        allTasks = await apiGetTasks();
        updateCounts();
        renderBoard();
    } catch (err) {
        console.error('loadAllTasks error:', err);
        showNotification('Помилка завантаження задач', 'error');
        if (board) board.innerHTML = '';
    }
}

// v10.0: Load user points
async function loadMyPoints() {
    const username = AppState.currentUser?.username;
    if (!username) return;
    const points = await apiGetMyPoints(username);
    const bar = document.getElementById('pointsBar');
    if (points && bar) {
        document.getElementById('pointsPermanent').textContent = points.permanent_points || 0;
        document.getElementById('pointsMonthly').textContent = points.monthly_points || 0;
        bar.style.display = '';
    }
}

function filterByCategory(tasks) {
    if (currentCategory === 'all') return tasks;
    return tasks.filter(t => (t.category || 'admin') === currentCategory);
}

function updateCounts() {
    const today = getTodayStr();
    const week = getWeekRange();
    const username = AppState.currentUser?.name;

    const active = allTasks.filter(t => t.status !== 'done');
    const todayTasks = active.filter(t => t.date === today || !t.date);
    const weekTasks = active.filter(t => t.date >= week.from && t.date <= week.to);
    const myTasks = active.filter(t => t.assigned_to && t.assigned_to === username);

    document.getElementById('countToday').textContent = todayTasks.length;
    document.getElementById('countWeek').textContent = weekTasks.length;
    document.getElementById('countMy').textContent = myTasks.length;
}

function renderBoard() {
    const container = document.getElementById('boardContent');

    switch (currentView) {
        case 'today': renderTodayView(container); break;
        case 'week': renderWeekView(container); break;
        case 'my': renderMyView(container); break;
        case 'board': renderKanbanView(container); break;
        default: renderTodayView(container);
    }
}

// ==========================================
// VIEW: TODAY
// ==========================================

function renderTodayView(container) {
    const today = getTodayStr();
    let tasks = allTasks.filter(t => t.date === today || (!t.date && t.status !== 'done'));
    tasks = filterByCategory(tasks);

    if (tasks.length === 0) {
        container.innerHTML = '<div class="empty-state"><span>🎉</span>Немає задач на сьогодні!</div>';
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
    for (const cat of ['event', 'purchase', 'admin', 'trampoline', 'personal', 'improvement']) {
        if (!groups[cat]) continue;
        const info = CAT_LABELS[cat];
        html += `<div class="group-header">${info.icon} ${info.label} <span style="font-size:12px;color:var(--gray-400)">(${groups[cat].length})</span></div>`;
        html += groups[cat].map(t => renderTaskCard(t)).join('');
    }
    container.innerHTML = html;
}

// ==========================================
// VIEW: WEEK
// ==========================================

function renderWeekView(container) {
    const week = getWeekRange();
    let tasks = allTasks.filter(t => t.date >= week.from && t.date <= week.to && t.status !== 'done');
    tasks = filterByCategory(tasks);

    if (tasks.length === 0) {
        container.innerHTML = '<div class="empty-state">Немає задач на цей тиждень!</div>';
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
        html += groups[date].map(t => renderTaskCard(t)).join('');
    }
    container.innerHTML = html;
}

// ==========================================
// VIEW: MY TASKS
// ==========================================

function renderMyView(container) {
    const username = AppState.currentUser?.name;
    let tasks = allTasks.filter(t => t.assigned_to && t.assigned_to === username && t.status !== 'done');
    tasks = filterByCategory(tasks);

    if (tasks.length === 0) {
        container.innerHTML = '<div class="empty-state">Немає задач, призначених вам!</div>';
        return;
    }

    container.innerHTML = tasks.map(t => renderTaskCard(t)).join('');
}

// ==========================================
// VIEW: KANBAN
// ==========================================

function renderKanbanView(container) {
    let tasks = filterByCategory(allTasks);

    const todo = tasks.filter(t => t.status === 'todo');
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    const done = tasks.filter(t => t.status === 'done');

    container.innerHTML = `
        <div class="kanban">
            <div class="kanban-col">
                <div class="kanban-col-header">
                    До виконання <span class="kanban-col-count">${todo.length}</span>
                </div>
                ${todo.length ? todo.map(t => renderTaskCard(t)).join('') : '<div class="empty-state">Порожньо</div>'}
            </div>
            <div class="kanban-col">
                <div class="kanban-col-header">
                    В роботі <span class="kanban-col-count">${inProgress.length}</span>
                </div>
                ${inProgress.length ? inProgress.map(t => renderTaskCard(t)).join('') : '<div class="empty-state">Порожньо</div>'}
            </div>
            <div class="kanban-col">
                <div class="kanban-col-header">
                    Готово <span class="kanban-col-count">${done.length}</span>
                </div>
                ${done.length ? done.map(t => renderTaskCard(t)).join('') : '<div class="empty-state">Порожньо</div>'}
            </div>
        </div>`;
}

// ==========================================
// TASK CARD
// ==========================================

function renderTaskCard(t) {
    const cat = t.category || 'admin';
    const catInfo = CAT_LABELS[cat] || CAT_LABELS.admin;
    const nextStatus = STATUS_CYCLE[t.status] || 'todo';
    const nextLabel = STATUS_LABELS[nextStatus];
    const priorityIcon = PRIORITY_ICONS[t.priority] || '';

    const btnClass = nextStatus === 'done' ? 'btn-done' :
                     nextStatus === 'in_progress' ? 'btn-progress' : '';

    // v10.0: Task type badge
    const taskType = t.task_type || 'human';
    const typeBadge = `<span class="badge-type badge-${taskType}">${taskType === 'bot' ? 'Бот' : 'Людина'}</span>`;

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

    // v10.0: Owner line
    const ownerHtml = (t.owner && t.owner !== t.assigned_to) ? `<span class="task-card-owner">${escapeHtml(t.owner)}</span>` : '';

    return `
    <div class="task-card cat-${cat} ${t.priority !== 'normal' ? 'priority-' + t.priority : ''} ${t.status === 'done' ? 'status-done' : ''}" data-task-id="${t.id}" onclick="openTaskDetail(${t.id})" style="cursor:pointer">
        <label class="task-checkbox-wrap" onclick="event.stopPropagation()">
            <input type="checkbox" class="task-bulk-cb" data-id="${t.id}" onchange="updateBulkSelection()">
        </label>
        <div class="task-card-title">${escHtml}${priorityIcon ? priorityIcon + ' ' : ''}${escapeHtml(t.title)}</div>
        <div class="task-card-meta">
            ${typeBadge}
            <span>${catInfo.icon} ${catInfo.label}</span>
            ${t.date ? `<span>${formatDateShort(t.date)}</span>` : ''}
            ${deadlineHtml}
            ${t.assigned_to ? `<span class="task-assignee-badge" title="Відповідальний: ${escapeHtml(t.assigned_to)}">👤 ${escapeHtml(t.assigned_to)}</span>` : '<span class="task-no-assignee">— нікому</span>'}
            ${ownerHtml}
            ${t.type === 'recurring' ? '<span class="badge badge-normal">Повтор</span>' : ''}
            ${t.type === 'afisha' ? '<span class="badge badge-normal">Афіша</span>' : ''}
        </div>
        <div class="task-card-actions">
            <button class="${btnClass}" onclick="cycleStatus(${t.id}, '${nextStatus}')">${STATUS_ICONS[nextStatus]} ${nextLabel}</button>
            ${!userPermissions || userPermissions.canDeleteTasks ? `<button class="btn-delete" onclick="deleteTask(${t.id})">✕</button>` : ''}
        </div>
    </div>`;
}

// ==========================================
// TASK ACTIONS
// ==========================================

let _assigneeList = [];
async function _loadAssigneeDropdown() {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/hr/staff?active=true', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        _assigneeList = (data.data || []).filter(s => s.name).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
        const sel = document.getElementById('taskAssignedTo');
        if (sel) {
            sel.innerHTML = '<option value="">— нікому —</option>' +
                _assigneeList.map(s => `<option value="${s.name}">${s.name}${s.role_type ? ' (' + s.role_type + ')' : ''}</option>`).join('');
        }
    } catch {}
}

async function addTask() {
    const title = document.getElementById('taskTitle')?.value.trim();
    if (!title) {
        showNotification('Введіть назву задачі', 'error');
        return;
    }

    const category = document.getElementById('taskCategory')?.value;
    const priority = document.getElementById('taskPriority')?.value;
    const taskType = document.getElementById('taskType')?.value || 'human';
    const deadlineTime = document.getElementById('taskDeadlineTime')?.value || '';
    const assignedTo = document.getElementById('taskAssignedTo')?.value || null;
    const today = getTodayStr();

    const data = { title, date: today, priority, category, task_type: taskType, source_type: 'manual', assigned_to: assignedTo };

    // Build deadline if time specified
    if (deadlineTime) {
        data.deadline = `${today}T${deadlineTime}:00`;
    }

    const result = await apiCreateTask(data);
    if (result && result.success) {
        document.getElementById('taskTitle').value = '';
        if (document.getElementById('taskDeadlineTime')) document.getElementById('taskDeadlineTime').value = '';
        showNotification('Задачу додано', 'success');
        await loadAllTasks();
    } else {
        showNotification('Помилка додавання', 'error');
    }
}

async function cycleStatus(taskId, newStatus) {
    const result = await apiPatchTaskStatus(taskId, newStatus);
    if (result && result.success) {
        // Update local cache
        const task = allTasks.find(t => t.id === taskId);
        if (task) task.status = newStatus;
        updateCounts();
        renderBoard();
        // v10.0: Reload points if task completed (Kleshnya awards points)
        if (newStatus === 'done') loadMyPoints();
    } else {
        showNotification('Помилка зміни статусу', 'error');
    }
}

async function deleteTask(taskId) {
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
        const cat = CAT_LABELS[t.category] || CAT_LABELS.admin;

        return `
        <div class="task-card cat-${t.category || 'admin'}">
            <div class="task-card-title">${escapeHtml(t.title)}</div>
            <div class="task-card-meta">
                <span>${cat.label}</span>
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
    const category = document.getElementById('tplCategory')?.value;

    if (recurrencePattern === 'custom' && !recurrenceDays) {
        showNotification('Вкажіть дні для кастомного розкладу', 'error');
        return;
    }

    const result = await apiCreateTemplate({ title, recurrencePattern, recurrenceDays, priority, assignedTo, category });
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
    const labels = { done: 'Виконати', archive: 'Архівувати' };
    if (!await confirmModal(`${labels[action] || action} ${ids.length} задач?`, { type: 'danger' })) return;
    const result = await apiBulkTasks(ids, action);
    if (result && result.success) {
        showNotification(`${labels[action] || action}: ${result.affected || ids.length} задач`, 'success');
        clearBulkSelection();
        await loadAndRender();
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
async function openTaskDetail(taskId) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/tasks/${taskId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) { showNotification('Задачу не знайдено', 'error'); return; }
        const task = await res.json();
        const t = task.data || task;
        if (!t || !t.id) { showNotification('Задачу не знайдено', 'error'); return; }

        const STATUS_LABELS = { todo: 'До виконання', in_progress: 'В роботі', done: 'Виконано', cancelled: 'Скасовано' };
        const PRIORITY_LABELS = { low: 'Низький', normal: 'Звичайний', high: 'Високий' };
        const statusColor = t.status === 'done' ? '#10B981' : t.status === 'in_progress' ? '#3B82F6' : t.status === 'cancelled' ? '#94A3B8' : '#F59E0B';
        const prioColor = t.priority === 'high' ? '#EF4444' : t.priority === 'low' ? '#94A3B8' : '#6B7280';
        const deadlineStr = t.deadline ? new Date(t.deadline).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
        const isOverdue = t.deadline && new Date(t.deadline) < new Date() && t.status !== 'done' && t.status !== 'cancelled';

        let overlay = document.getElementById('taskDetailOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'taskDetailOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)';
            document.body.appendChild(overlay);
        }
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

        const dlIso = t.deadline ? new Date(t.deadline).toISOString().slice(0, 16) : '';
        const _lbl = 'style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:3px"';
        const _inp = 'style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box"';

        overlay.innerHTML = `<div style="background:var(--white,#fff);border-radius:16px;max-width:520px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
            <div style="padding:16px 20px;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;gap:12px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor}"></span>
                <h3 style="margin:0;font-size:16px;font-weight:800;flex:1">Задача #${t.id}</h3>
                <span style="font-size:11px;color:var(--gray-400)">Автор: ${escapeHtml(t.created_by || '—')}</span>
                <button onclick="document.getElementById('taskDetailOverlay').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--gray-400);padding:4px">✕</button>
            </div>
            <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px">
                <div><label ${_lbl}>Назва</label><input id="_tdTitle" value="${escapeHtml(t.title || '')}" ${_inp}></div>
                <div><label ${_lbl}>Опис</label><textarea id="_tdDesc" rows="3" ${_inp} style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;resize:vertical">${escapeHtml(t.description || '')}</textarea></div>
                <div style="display:flex;gap:8px">
                    <div style="flex:1"><label ${_lbl}>Статус</label><select id="_tdStatus" ${_inp} style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit">
                        <option value="todo" ${t.status==='todo'?'selected':''}>📋 До виконання</option>
                        <option value="in_progress" ${t.status==='in_progress'?'selected':''}>▶ В роботі</option>
                        <option value="done" ${t.status==='done'?'selected':''}>✅ Виконано</option>
                        <option value="cancelled" ${t.status==='cancelled'?'selected':''}>✕ Скасовано</option>
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
                        ${_assigneeList.map(s => `<option value="${escapeHtml(s.name)}"${t.assigned_to === s.name ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                    </select></div>
                </div>
                <div><label ${_lbl}>Категорія</label><select id="_tdCategory" ${_inp} style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit">
                    <option value="admin" ${t.category==='admin'?'selected':''}>Адмін</option>
                    <option value="event" ${t.category==='event'?'selected':''}>Подія</option>
                    <option value="purchase" ${t.category==='purchase'?'selected':''}>Закупка</option>
                    <option value="trampoline" ${t.category==='trampoline'?'selected':''}>Батут</option>
                    <option value="personal" ${t.category==='personal'?'selected':''}>Особисте</option>
                    <option value="improvement" ${t.category==='improvement'?'selected':''}>Покращення</option>
                </select></div>
            </div>
            <div style="padding:12px 20px;border-top:1px solid var(--gray-100);display:flex;gap:8px">
                <button onclick="saveTaskDetail(${t.id})" style="flex:2;padding:10px;border:none;border-radius:10px;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px">💾 Зберегти</button>
                <button onclick="document.getElementById('taskDetailOverlay').remove()" style="flex:1;padding:10px;border:1px solid var(--gray-200);border-radius:10px;background:none;cursor:pointer;font-family:inherit;font-size:13px">Скасувати</button>
            </div>
        </div>`;

        // Highlight card in list
        document.querySelectorAll('.task-card').forEach(c => c.style.outline = '');
        const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
        if (card) { card.style.outline = '2px solid #10B981'; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    } catch (err) { showNotification('Помилка: ' + err.message, 'error'); }
}
window.openTaskDetail = openTaskDetail;

async function saveTaskDetail(taskId) {
    const title = document.getElementById('_tdTitle')?.value.trim();
    if (!title) { showNotification('Назва обов\'язкова', 'error'); return; }
    try {
        const token = localStorage.getItem('pzp_token');
        const body = {
            title,
            description: document.getElementById('_tdDesc')?.value.trim() || null,
            status: document.getElementById('_tdStatus')?.value || 'todo',
            priority: document.getElementById('_tdPriority')?.value || 'normal',
            category: document.getElementById('_tdCategory')?.value || 'admin',
            assigned_to: document.getElementById('_tdAssigned')?.value.trim() || null,
            deadline: document.getElementById('_tdDeadline')?.value || null
        };
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            document.getElementById('taskDetailOverlay')?.remove();
            showNotification('Задачу збережено');
            if (typeof loadTasks === 'function') loadTasks();
        } else {
            const data = await res.json().catch(() => ({}));
            showNotification(data.error || 'Помилка збереження', 'error');
        }
    } catch (err) { showNotification('Помилка: ' + err.message, 'error'); }
}
window.saveTaskDetail = saveTaskDetail;

async function quickChangeStatus(taskId, newStatus) {
    try {
        const token = localStorage.getItem('pzp_token');
        await fetch(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ status: newStatus })
        });
        document.getElementById('taskDetailOverlay')?.remove();
        showNotification('Статус змінено');
        if (typeof loadTasks === 'function') loadTasks();
    } catch (err) { showNotification('Помилка зміни статусу: ' + (err.message || ''), 'error'); }
}
window.quickChangeStatus = quickChangeStatus;

document.addEventListener('DOMContentLoaded', initPage);
