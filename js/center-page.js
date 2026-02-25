/**
 * center-page.js — Center (Boss) management page
 * v18.1.0: Digital Workers, KPI, Price Rules, Tasks, Daily Report
 */

// Page name constant — easy to rename
const CENTER_PAGE_TITLE = 'Центр керування';

let centerData = null;
let pricesData = [];
let tasksData = [];
let currentPeriod = 'today';
let isAdminUser = false;

// ==========================================
// NOTIFICATIONS
// ==========================================

function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    if (!el) return;
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

// ==========================================
// API CALLS
// ==========================================

async function apiCenterOverview() {
    try {
        const response = await fetch(`${API_BASE}/center/overview`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API center overview error:', err);
        return null;
    }
}

async function apiCenterPrices() {
    try {
        const response = await fetch(`${API_BASE}/center/prices`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API center prices error:', err);
        return null;
    }
}

async function apiUpdatePrice(code, data) {
    try {
        const response = await fetch(`${API_BASE}/center/prices/${code}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error('API update price error:', err);
        return { success: false, error: err.message };
    }
}

async function apiCreatePrice(data) {
    try {
        const response = await fetch(`${API_BASE}/center/prices`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error('API create price error:', err);
        return { success: false, error: err.message };
    }
}

async function apiDeletePrice(code) {
    try {
        const response = await fetch(`${API_BASE}/center/prices/${code}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error('API delete price error:', err);
        return { success: false, error: err.message };
    }
}

async function apiCenterTasks() {
    try {
        const response = await fetch(`${API_BASE}/center/tasks`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API center tasks error:', err);
        return null;
    }
}

async function apiCenterReport() {
    try {
        const response = await fetch(`${API_BASE}/center/report`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API center report error:', err);
        return null;
    }
}

// ==========================================
// TIME HELPERS
// ==========================================

function timeAgo(dateStr) {
    if (!dateStr) return 'невідомо';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'щойно';
    if (mins < 60) return `${mins} хв тому`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} год тому`;
    const days = Math.floor(hours / 24);
    return `${days} д. тому`;
}

function formatPrice(amount) {
    if (amount === null || amount === undefined) return '0 ₴';
    return Number(amount).toLocaleString('uk-UA') + ' ₴';
}

// ==========================================
// RENDER: WORKERS
// ==========================================

function renderWorkers(workers) {
    const grid = document.getElementById('workersGrid');
    if (!grid) return;

    if (!workers || workers.length === 0) {
        grid.innerHTML = '<div class="center-empty"><span>🤖</span>Немає зареєстрованих воркерів</div>';
        return;
    }

    grid.innerHTML = workers.map(w => {
        const workerEmoji = w.name === 'kleshnya' ? '🦀' :
                           w.name === 'svitlana' ? '📋' :
                           w.name === 'warehouse_bot' ? '📦' : '🤖';
        return `
        <div class="worker-card" data-worker-id="${w.id}" onclick="toggleWorkerDetails(this)">
            <div class="worker-card-header">
                <div class="worker-card-name">${workerEmoji} ${w.displayName}</div>
                <div class="worker-card-status">${w.emoji} ${w.label}</div>
            </div>
            <div class="worker-card-purpose">${w.purpose ? w.purpose.substring(0, 60) + (w.purpose.length > 60 ? '...' : '') : ''}</div>
            <div class="worker-card-activity">Остання дія: ${timeAgo(w.lastActivity)}</div>
            <div class="worker-card-details">
                <div class="worker-detail-row">
                    <span class="worker-detail-label">Тип</span>
                    <span class="worker-detail-value">${w.type || 'bot'}</span>
                </div>
                <div class="worker-detail-row">
                    <span class="worker-detail-label">Статус</span>
                    <span class="worker-detail-value">${w.isActive ? 'Активний' : 'Вимкнений'}</span>
                </div>
                <div class="worker-detail-row">
                    <span class="worker-detail-label">Призначення</span>
                    <span class="worker-detail-value" style="text-align:right;max-width:60%">${w.purpose || '—'}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function toggleWorkerDetails(card) {
    card.classList.toggle('expanded');
}

// ==========================================
// RENDER: KPI
// ==========================================

function renderKPI(kpi, period) {
    const grid = document.getElementById('kpiGrid');
    if (!grid || !kpi) return;

    const data = kpi[period];
    if (!data) {
        grid.innerHTML = '<div class="center-empty">Немає даних</div>';
        return;
    }

    grid.innerHTML = `
        <div class="kpi-card">
            <div class="kpi-card-label">Виручка</div>
            <div class="kpi-card-value revenue">${formatPrice(data.revenue)}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-card-label">Бронювань</div>
            <div class="kpi-card-value">${data.bookings}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-card-label">Сер. чек</div>
            <div class="kpi-card-value">${data.avgCheck > 0 ? formatPrice(data.avgCheck) : '—'}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-card-label">Топ програма</div>
            <div class="kpi-card-value" style="font-size:13px">${data.topProgram}</div>
        </div>
    `;
}

// ==========================================
// RENDER: PRICES
// ==========================================

function renderPrices(prices) {
    const container = document.getElementById('pricesContent');
    if (!container) return;

    if (!prices || prices.length === 0) {
        container.innerHTML = '<div class="center-empty"><span>💰</span>Немає цінових правил</div>';
        appendPriceAddRow(container);
        return;
    }

    // Group by category
    const categories = {};
    for (const p of prices) {
        const cat = p.category || 'Інше';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(p);
    }

    let html = `<table class="prices-table">
        <thead>
            <tr>
                <th>Назва</th>
                <th>Категорія</th>
                <th>Ціна</th>
                <th>Оновлено</th>
                ${isAdminUser ? '<th>Дії</th>' : ''}
            </tr>
        </thead>
        <tbody>`;

    for (const p of prices) {
        const updatedInfo = p.updated_by
            ? `${p.updated_by}, ${new Date(p.updated_at).toLocaleDateString('uk-UA')}`
            : '';

        html += `<tr data-code="${p.code}">
            <td>
                <div style="font-weight:700">${p.name}</div>
                <div style="font-size:10px;color:var(--gray-400)">${p.code}</div>
            </td>
            <td><span class="price-category-badge">${p.category || '—'}</span></td>
            <td>
                ${isAdminUser
                    ? `<input type="number" class="price-inline-input" value="${p.value}" data-code="${p.code}" data-original="${p.value}"
                        onkeydown="if(event.key==='Enter')savePriceInline(this)"
                        onblur="savePriceInline(this)">
                       <span class="price-unit">${p.unit || ''}</span>`
                    : `<span class="price-value-cell">${p.value}</span><span class="price-unit">${p.unit || ''}</span>`
                }
            </td>
            <td><span class="price-updated">${updatedInfo}</span></td>
            ${isAdminUser ? `<td class="price-actions">
                <button class="btn-price-delete" onclick="deletePrice('${p.code}')" title="Видалити">✕</button>
            </td>` : ''}
        </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    if (isAdminUser) {
        appendPriceAddRow(container);
    }
}

function appendPriceAddRow(container) {
    const addHtml = `
    <div class="price-add-row" id="priceAddRow">
        <input type="text" id="newPriceCode" placeholder="Код (напр. balloon_pack)">
        <input type="text" id="newPriceName" placeholder="Назва">
        <input type="number" id="newPriceValue" placeholder="Ціна">
        <input type="text" id="newPriceUnit" placeholder="грн" style="width:60px">
        <input type="text" id="newPriceCategory" placeholder="Категорія">
        <button onclick="addNewPrice()">+ Додати</button>
    </div>`;
    container.insertAdjacentHTML('beforeend', addHtml);
}

async function savePriceInline(input) {
    const code = input.dataset.code;
    const newValue = parseInt(input.value);
    const original = parseInt(input.dataset.original);

    if (isNaN(newValue) || newValue === original) return;

    const result = await apiUpdatePrice(code, { value: newValue });
    if (result.success) {
        input.dataset.original = newValue;
        input.style.borderColor = '#2E7D32';
        setTimeout(() => { input.style.borderColor = ''; }, 1000);
        showNotification(`Ціну ${code} оновлено: ${newValue}`, 'success');
    } else {
        input.value = original;
        showNotification(result.error || 'Помилка оновлення', 'error');
    }
}

async function addNewPrice() {
    const code = document.getElementById('newPriceCode').value.trim();
    const name = document.getElementById('newPriceName').value.trim();
    const value = parseInt(document.getElementById('newPriceValue').value);
    const unit = document.getElementById('newPriceUnit').value.trim();
    const category = document.getElementById('newPriceCategory').value.trim();

    if (!code || !name || isNaN(value)) {
        showNotification("Заповніть код, назву і ціну", 'error');
        return;
    }

    const result = await apiCreatePrice({ code, name, value, unit, category });
    if (result.success) {
        showNotification(`Ціну "${name}" створено`, 'success');
        loadPrices();
    } else {
        showNotification(result.error || 'Помилка створення', 'error');
    }
}

async function deletePrice(code) {
    if (!confirm(`Видалити ціну "${code}"?`)) return;
    const result = await apiDeletePrice(code);
    if (result.success) {
        showNotification(`Ціну ${code} видалено`, 'success');
        loadPrices();
    } else {
        showNotification(result.error || 'Помилка видалення', 'error');
    }
}

// ==========================================
// RENDER: TASKS
// ==========================================

function renderTasks(tasks) {
    const container = document.getElementById('tasksList');
    if (!container) return;

    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<div class="center-empty"><span>📋</span>Немає активних задач</div>';
        return;
    }

    container.innerHTML = tasks.slice(0, 30).map(t => {
        const priorityClass = t.priority === 'high' ? ' center-task-priority-high' : '';
        return `
        <div class="center-task-row${priorityClass}">
            <div class="center-task-status ${t.status}"></div>
            <div class="center-task-title">${t.title}</div>
            ${t.assigned_to ? `<span class="center-task-assignee">${t.assigned_to}</span>` : ''}
            <span style="font-size:11px;color:var(--gray-400)">${t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜'}</span>
        </div>`;
    }).join('');
}

// ==========================================
// RENDER: REPORT
// ==========================================

function renderReport(report) {
    const container = document.getElementById('reportContent');
    if (!container) return;

    if (!report) {
        container.innerHTML = '<div class="center-empty"><span>📊</span>Звіт ще не згенеровано</div>';
        return;
    }

    const date = report.date ? new Date(report.date).toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }) : '';

    container.innerHTML = `
        <div class="report-content">${report.text}</div>
        <div class="report-meta">${report.author ? `Автор: ${report.author}` : ''} ${date ? `| ${date}` : ''}</div>
    `;
}

// ==========================================
// DATA LOADING
// ==========================================

async function loadOverview() {
    const data = await apiCenterOverview();
    if (!data || !data.success) {
        document.getElementById('workersGrid').innerHTML = '<div class="center-empty">Помилка завантаження</div>';
        document.getElementById('kpiGrid').innerHTML = '<div class="center-empty">Помилка завантаження</div>';
        return;
    }
    centerData = data;
    renderWorkers(data.workers);
    renderKPI(data.kpi, currentPeriod);
}

async function loadPrices() {
    const data = await apiCenterPrices();
    if (!data || !data.success) {
        document.getElementById('pricesContent').innerHTML = '<div class="center-empty">Помилка завантаження цін</div>';
        return;
    }
    pricesData = data.prices || [];
    renderPrices(pricesData);
}

async function loadTasks() {
    const data = await apiCenterTasks();
    if (!data || !data.success) {
        document.getElementById('tasksList').innerHTML = '<div class="center-empty">Помилка завантаження задач</div>';
        return;
    }
    tasksData = data.tasks || [];
    renderTasks(tasksData);
}

async function loadReport() {
    const data = await apiCenterReport();
    if (!data || !data.success) {
        document.getElementById('reportContent').innerHTML = '<div class="center-empty">Помилка завантаження звіту</div>';
        return;
    }
    renderReport(data.report);
}

// ==========================================
// SIDEBAR + AUTH
// ==========================================

function initSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebarNav');
    if (toggle && sidebar) {
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
        // Close on outside click (mobile)
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle) {
                sidebar.classList.remove('open');
            }
        });
    }
}

async function initAuth() {
    const token = localStorage.getItem('pzp_token');
    const savedUser = localStorage.getItem(CONFIG.STORAGE.CURRENT_USER);

    if (!token || !savedUser) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        return false;
    }

    // Verify token
    const user = await apiVerifyToken();
    if (!user) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        return false;
    }

    AppState.currentUser = user;
    isAdminUser = user.role === 'admin';

    // Set username
    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('pzp_token');
            localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
            window.location.href = '/';
        });
    }

    // Role-based sidebar visibility
    document.querySelectorAll('.sidebar-admin-only').forEach(el => {
        el.classList.toggle('hidden', !isAdminUser);
    });
    document.querySelectorAll('.sidebar-no-viewer').forEach(el => {
        el.classList.toggle('hidden', user.role === 'viewer');
    });

    return true;
}

// ==========================================
// INIT
// ==========================================

async function initCenterPage() {
    // Dark mode
    if (typeof initDarkMode === 'function') initDarkMode();

    initSidebar();

    const authed = await initAuth();
    if (!authed) return;

    // Check admin access
    if (!isAdminUser) {
        document.querySelector('.center-page').innerHTML = `
            <div class="center-empty" style="padding:60px">
                <span style="font-size:48px">🔒</span>
                <h2>Доступ обмежено</h2>
                <p>Ця сторінка доступна тільки адміністраторам</p>
                <a href="/" style="color:var(--primary);font-weight:700">← Повернутись на таймлайн</a>
            </div>`;
        return;
    }

    // KPI period tabs
    document.querySelectorAll('.kpi-period-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.kpi-period-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentPeriod = tab.dataset.period;
            if (centerData) renderKPI(centerData.kpi, currentPeriod);
        });
    });

    // Load all data in parallel
    await Promise.all([
        loadOverview(),
        loadPrices(),
        loadTasks(),
        loadReport()
    ]);

    // Profile handler
    if (typeof initProfileHandler === 'function') initProfileHandler();
}

document.addEventListener('DOMContentLoaded', initCenterPage);
