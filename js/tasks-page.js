/**
 * tasks-page.js — Standalone Tasks page (v7.8)
 */

// ==========================================
// PAGE AUTH & INIT
// ==========================================

function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    if (!el) return;
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TYPE_BADGES = {
    manual: { icon: '✋', label: 'Ручна', cls: 'badge-manual' },
    recurring: { icon: '🔄', label: 'Повторювана', cls: 'badge-recurring' },
    afisha: { icon: '🎭', label: 'Афіша', cls: 'badge-afisha' },
    auto_complete: { icon: '⚡', label: 'Авто', cls: 'badge-auto' }
};

const STATUS_BADGES = {
    todo: { icon: '⬜', label: 'Todo', cls: 'badge-todo' },
    in_progress: { icon: '🔄', label: 'В роботі', cls: 'badge-in-progress' },
    done: { icon: '✅', label: 'Виконано', cls: 'badge-done' }
};

const PRIORITY_BADGES = {
    high: { icon: '🔴', label: 'Високий', cls: 'badge-high' },
    normal: { icon: '', label: 'Звичайний', cls: 'badge-normal' },
    low: { icon: '🔵', label: 'Низький', cls: 'badge-low' }
};

const STATUS_CYCLE = { todo: 'in_progress', in_progress: 'done', done: 'todo' };

const PATTERN_LABELS = {
    daily: 'Щоденно',
    weekdays: 'Будні (пн-пт)',
    weekly: 'Щотижня (пн)',
    custom: 'Обрані дні'
};

async function initPage() {
    const token = localStorage.getItem('pzp_token');
    if (!token) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    const user = await apiVerifyToken();
    if (!user) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    AppState.currentUser = user;
    document.getElementById('currentUser').textContent = user.name;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        window.location = '/';
    });

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('taskDate').value = today;

    // Tab switching
    document.querySelectorAll('.page-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabId = tab.dataset.tab;
            document.getElementById('tasksTab').style.display = tabId === 'tasks' ? '' : 'none';
            document.getElementById('templatesTab').style.display = tabId === 'templates' ? '' : 'none';
            if (tabId === 'templates') loadTemplates();
        });
    });

    // Show custom days field
    document.getElementById('tplPattern').addEventListener('change', (e) => {
        document.getElementById('tplDaysGroup').style.display = e.target.value === 'custom' ? '' : 'none';
    });

    // Filters
    document.getElementById('filterStatus').addEventListener('change', loadTasks);
    document.getElementById('filterType').addEventListener('change', loadTasks);
    document.getElementById('filterDate').addEventListener('change', loadTasks);
    document.getElementById('filterAssigned').addEventListener('input', debounce(loadTasks, 400));
    document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);

    // Add task
    document.getElementById('addTaskBtn').addEventListener('click', addTask);
    document.getElementById('taskTitle').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTask();
    });

    // Add template
    document.getElementById('addTemplateBtn').addEventListener('click', addTemplate);

    await loadTasks();
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// ==========================================
// TASKS API WRAPPERS
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
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API createTask error:', err);
        return null;
    }
}

async function apiPatchTaskStatus(id, status) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${id}/status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API patchTaskStatus error:', err);
        return null;
    }
}

async function apiDeleteTask(id) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API deleteTask error:', err);
        return null;
    }
}

// Template API wrappers
async function apiGetTemplates() {
    try {
        const response = await fetch(`${API_BASE}/task-templates`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getTemplates error:', err);
        return [];
    }
}

async function apiCreateTemplate(data) {
    try {
        const response = await fetch(`${API_BASE}/task-templates`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API createTemplate error:', err);
        return null;
    }
}

async function apiDeleteTemplate(id) {
    try {
        const response = await fetch(`${API_BASE}/task-templates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('API deleteTemplate error:', err);
        return null;
    }
}

// ==========================================
// TASKS LIST
// ==========================================

async function loadTasks() {
    const filters = {};
    const status = document.getElementById('filterStatus').value;
    const type = document.getElementById('filterType').value;
    const date = document.getElementById('filterDate').value;
    const assigned = document.getElementById('filterAssigned').value.trim();
    if (status) filters.status = status;
    if (type) filters.type = type;
    if (date) filters.date = date;
    if (assigned) filters.assigned_to = assigned;

    const tasks = await apiGetTasks(filters);
    renderTasks(tasks);
}

function renderTasks(tasks) {
    const grid = document.getElementById('tasksList');

    if (tasks.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-text">Немає задач за цими фільтрами</div></div>';
        return;
    }

    grid.innerHTML = tasks.map(t => {
        const typeBadge = TYPE_BADGES[t.type] || TYPE_BADGES.manual;
        const statusBadge = STATUS_BADGES[t.status] || STATUS_BADGES.todo;
        const priorityBadge = PRIORITY_BADGES[t.priority] || PRIORITY_BADGES.normal;
        const nextStatus = STATUS_CYCLE[t.status] || 'todo';

        return `
        <div class="card task-card" data-status="${t.status}" data-priority="${t.priority}">
            <div class="card-header">
                <div>
                    <span class="card-title">${escapeHtml(t.title)}</span>
                </div>
                <button class="btn-page-secondary" style="min-height:36px;padding:6px 12px;" onclick="cycleStatus(${t.id}, '${nextStatus}')" title="Змінити статус">
                    ${statusBadge.icon}
                </button>
            </div>
            <div class="card-meta">
                <span class="badge ${typeBadge.cls}">${typeBadge.icon} ${typeBadge.label}</span>
                <span class="badge ${statusBadge.cls}">${statusBadge.label}</span>
                ${t.priority !== 'normal' ? `<span class="badge ${priorityBadge.cls}">${priorityBadge.icon} ${priorityBadge.label}</span>` : ''}
                ${t.date ? `<span>📅 ${escapeHtml(t.date)}</span>` : ''}
                ${t.assigned_to ? `<span>👤 ${escapeHtml(t.assigned_to)}</span>` : ''}
                ${t.afisha_id ? '<span>🎭</span>' : ''}
            </div>
            ${t.description ? `<p style="font-size:13px;color:var(--gray-500);margin-top:8px;">${escapeHtml(t.description)}</p>` : ''}
            <div class="card-actions">
                <button class="btn-page-danger" onclick="deleteTask(${t.id})">Видалити</button>
            </div>
        </div>`;
    }).join('');
}

function clearFilters() {
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterDate').value = '';
    document.getElementById('filterAssigned').value = '';
    loadTasks();
}

// ==========================================
// TASK ACTIONS
// ==========================================

async function addTask() {
    const title = document.getElementById('taskTitle').value.trim();
    if (!title) {
        showNotification('Введіть назву задачі', 'error');
        return;
    }
    const date = document.getElementById('taskDate').value || null;
    const priority = document.getElementById('taskPriority').value;
    const assignedTo = document.getElementById('taskAssignedTo').value.trim() || null;

    const result = await apiCreateTask({ title, date, priority, assigned_to: assignedTo, type: 'manual' });
    if (result && result.success) {
        document.getElementById('taskTitle').value = '';
        showNotification('Задачу додано', 'success');
        await loadTasks();
    } else {
        showNotification('Помилка додавання', 'error');
    }
}

async function cycleStatus(taskId, newStatus) {
    const result = await apiPatchTaskStatus(taskId, newStatus);
    if (result && result.success) {
        await loadTasks();
    } else {
        showNotification('Помилка зміни статусу', 'error');
    }
}

async function deleteTask(taskId) {
    if (!confirm('Видалити цю задачу?')) return;
    const result = await apiDeleteTask(taskId);
    if (result && result.success) {
        showNotification('Задачу видалено', 'success');
        await loadTasks();
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
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔄</div><div class="empty-state-text">Немає шаблонів. Додайте перший!</div></div>';
        return;
    }

    grid.innerHTML = templates.map(t => {
        const patternLabel = PATTERN_LABELS[t.recurrencePattern] || t.recurrencePattern;
        const daysInfo = t.recurrenceDays ? ` (дні: ${escapeHtml(t.recurrenceDays)})` : '';
        const priorityBadge = PRIORITY_BADGES[t.priority] || PRIORITY_BADGES.normal;

        return `
        <div class="card">
            <div class="card-header">
                <span class="card-title">🔄 ${escapeHtml(t.title)}</span>
                <span class="badge ${t.isActive ? 'badge-done' : 'badge-normal'}">${t.isActive ? 'Активний' : 'Пауза'}</span>
            </div>
            <div class="card-meta">
                <span>📅 ${patternLabel}${daysInfo}</span>
                ${t.priority !== 'normal' ? `<span class="badge ${priorityBadge.cls}">${priorityBadge.icon} ${priorityBadge.label}</span>` : ''}
                ${t.assignedTo ? `<span>👤 ${escapeHtml(t.assignedTo)}</span>` : ''}
            </div>
            <div class="card-actions">
                <button class="btn-page-danger" onclick="deleteTemplate(${t.id})">Видалити</button>
            </div>
        </div>`;
    }).join('');
}

async function addTemplate() {
    const title = document.getElementById('tplTitle').value.trim();
    if (!title) {
        showNotification('Введіть назву шаблону', 'error');
        return;
    }

    const recurrencePattern = document.getElementById('tplPattern').value;
    const recurrenceDays = document.getElementById('tplDays').value.trim() || null;
    const priority = document.getElementById('tplPriority').value;
    const assignedTo = document.getElementById('tplAssignedTo').value.trim() || null;

    if (recurrencePattern === 'custom' && !recurrenceDays) {
        showNotification('Вкажіть дні для кастомного розкладу', 'error');
        return;
    }

    const result = await apiCreateTemplate({ title, recurrencePattern, recurrenceDays, priority, assignedTo });
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
    if (!confirm('Видалити цей шаблон?')) return;
    const result = await apiDeleteTemplate(templateId);
    if (result && result.success) {
        showNotification('Шаблон видалено', 'success');
        await loadTemplates();
    } else {
        showNotification('Помилка видалення', 'error');
    }
}

// ==========================================
// START
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
