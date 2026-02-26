/**
 * center-page.js — Center (Boss) management page
 * v19.8.0: Digital Workers, KPI, Price Rules, Tasks, Charts, Loyalty, Discounts, Proposals, Report
 */

// Page name constant — easy to rename
const CENTER_PAGE_TITLE = 'Центр керування';

let centerData = null;
let pricesData = [];
let tasksData = [];
let currentPeriod = 'today';
let isAdminUser = false;
let chartsInstances = {};
let loyaltyTiers = [];
let discountCodes = [];
let proposals = [];

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
// API CALLS — existing
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
// API CALLS — Loyalty & Discounts (v19.7)
// ==========================================

async function apiLoyaltyTiers() {
    try {
        const response = await fetch(`${API_BASE}/loyalty/tiers`, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API loyalty tiers error:', err);
        return [];
    }
}

async function apiLoyaltyCustomers(segment) {
    try {
        const url = segment ? `${API_BASE}/loyalty/customers?segment=${segment}&limit=100` : `${API_BASE}/loyalty/customers?limit=100`;
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API loyalty customers error:', err);
        return { items: [], total: 0 };
    }
}

async function apiRecalculateLoyalty() {
    try {
        const response = await fetch(`${API_BASE}/loyalty/recalculate`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API recalculate loyalty error:', err);
        return { success: false };
    }
}

async function apiGetDiscounts() {
    try {
        const response = await fetch(`${API_BASE}/loyalty/discounts`, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API get discounts error:', err);
        return [];
    }
}

async function apiCreateDiscount(data) {
    try {
        const response = await fetch(`${API_BASE}/loyalty/discounts`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (err) {
        console.error('API create discount error:', err);
        return { error: err.message };
    }
}

async function apiDeleteDiscount(id) {
    try {
        const response = await fetch(`${API_BASE}/loyalty/discounts/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        return await response.json();
    } catch (err) {
        console.error('API delete discount error:', err);
        return { error: err.message };
    }
}

async function apiGetProposals() {
    try {
        const response = await fetch(`${API_BASE}/loyalty/proposals`, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API get proposals error:', err);
        return [];
    }
}

async function apiCreateProposal(data) {
    try {
        const response = await fetch(`${API_BASE}/loyalty/proposals`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (err) {
        console.error('API create proposal error:', err);
        return { error: err.message };
    }
}

async function apiDeleteProposal(id) {
    try {
        const response = await fetch(`${API_BASE}/loyalty/proposals/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        return await response.json();
    } catch (err) {
        console.error('API delete proposal error:', err);
        return { error: err.message };
    }
}

// ==========================================
// API CALLS — Charts (v19.8)
// ==========================================

async function apiChartsData() {
    try {
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const from = weekAgo.toISOString().split('T')[0];
        const to = today.toISOString().split('T')[0];

        const [revenueResp, programsResp] = await Promise.all([
            fetch(`${API_BASE}/stats/revenue?from=${from}&to=${to}`, { headers: getAuthHeaders(false) }),
            fetch(`${API_BASE}/stats/programs?from=${from}&to=${to}`, { headers: getAuthHeaders(false) })
        ]);

        if (!revenueResp.ok || !programsResp.ok) throw new Error('API error');
        const revenue = await revenueResp.json();
        const programs = await programsResp.json();

        return {
            daily: revenue.daily || [],
            programs: (programs.byCount || []).map(p => ({ name: p.programName, count: p.count }))
        };
    } catch (err) {
        console.error('API charts data error:', err);
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// RENDER: WORKERS
// ==========================================

function renderWorkers(workers) {
    const grid = document.getElementById('workersGrid');
    if (!grid) return;

    if (!workers || workers.length === 0) {
        grid.innerHTML = '<div class="center-empty">Немає зареєстрованих воркерів</div>';
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
        container.innerHTML = '<div class="center-empty">Немає цінових правил</div>';
        appendPriceAddRow(container);
        return;
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
                <div style="font-weight:700">${escapeHtml(p.name)}</div>
                <div style="font-size:10px;color:var(--gray-400)">${escapeHtml(p.code)}</div>
            </td>
            <td><span class="price-category-badge">${escapeHtml(p.category) || '—'}</span></td>
            <td>
                ${isAdminUser
                    ? `<input type="number" class="price-inline-input" value="${p.value}" data-code="${escapeHtml(p.code)}" data-original="${p.value}"
                        onkeydown="if(event.key==='Enter')savePriceInline(this)"
                        onblur="savePriceInline(this)">
                       <span class="price-unit">${escapeHtml(p.unit) || ''}</span>`
                    : `<span class="price-value-cell">${p.value}</span><span class="price-unit">${escapeHtml(p.unit) || ''}</span>`
                }
            </td>
            <td><span class="price-updated">${updatedInfo}</span></td>
            ${isAdminUser ? `<td class="price-actions">
                <button class="btn-price-delete" onclick="deletePrice('${escapeHtml(p.code)}')" title="Видалити">✕</button>
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
        container.innerHTML = '<div class="center-empty">Немає активних задач</div>';
        return;
    }

    container.innerHTML = tasks.slice(0, 30).map(t => {
        const priorityClass = t.priority === 'high' ? ' center-task-priority-high' : '';
        const statusIcon = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
        return `
        <div class="center-task-row${priorityClass}">
            <div class="center-task-status ${t.status}"></div>
            <div class="center-task-title">${escapeHtml(t.title)}</div>
            ${t.assigned_to ? `<span class="center-task-assignee">${escapeHtml(t.assigned_to)}</span>` : ''}
            <span style="font-size:11px;color:var(--gray-400)">${statusIcon}</span>
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
        container.innerHTML = '<div class="center-empty">Звіт ще не згенеровано</div>';
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
// RENDER: CHARTS (v19.8)
// ==========================================

function renderCharts(statsData) {
    if (!statsData || typeof Chart === 'undefined') {
        document.getElementById('chartsSection').querySelector('.charts-grid').innerHTML =
            '<div class="center-empty">Дані для графіків недоступні</div>';
        return;
    }

    const isDark = document.body.classList.contains('dark-mode');
    const textColor = isDark ? '#9CA3AF' : '#6B7280';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    const defaultOptions = {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.8,
        plugins: {
            legend: { display: false }
        },
        scales: {
            x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
            y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor }, beginAtZero: true }
        }
    };

    // Prepare data from stats
    const dailyData = statsData.daily || [];
    const labels = dailyData.map(d => {
        const date = new Date(d.date);
        return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
    });
    const revenues = dailyData.map(d => d.revenue || 0);
    const bookingCounts = dailyData.map(d => d.count || 0);

    // 1. Revenue chart
    if (chartsInstances.revenue) chartsInstances.revenue.destroy();
    const revenueCtx = document.getElementById('revenueChart');
    if (revenueCtx) {
        chartsInstances.revenue = new Chart(revenueCtx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: revenues,
                    backgroundColor: 'rgba(16, 185, 129, 0.6)',
                    borderColor: '#10B981',
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                ...defaultOptions,
                scales: {
                    ...defaultOptions.scales,
                    y: { ...defaultOptions.scales.y, ticks: { ...defaultOptions.scales.y.ticks, callback: v => v.toLocaleString() + ' ₴' } }
                }
            }
        });
    }

    // 2. Bookings chart
    if (chartsInstances.bookings) chartsInstances.bookings.destroy();
    const bookingsCtx = document.getElementById('bookingsChart');
    if (bookingsCtx) {
        chartsInstances.bookings = new Chart(bookingsCtx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: bookingCounts,
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#3B82F6'
                }]
            },
            options: defaultOptions
        });
    }

    // 3. Top programs chart
    if (chartsInstances.programs) chartsInstances.programs.destroy();
    const programsCtx = document.getElementById('programsChart');
    if (programsCtx) {
        const programs = statsData.programs || [];
        const topPrograms = programs.slice(0, 6);
        const programColors = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899'];

        chartsInstances.programs = new Chart(programsCtx, {
            type: 'doughnut',
            data: {
                labels: topPrograms.map(p => p.name || 'Інше'),
                datasets: [{
                    data: topPrograms.map(p => p.count || 0),
                    backgroundColor: programColors.slice(0, topPrograms.length),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 1.8,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { size: 10 }, padding: 6, boxWidth: 12 }
                    }
                }
            }
        });
    }

    // 4. Load by day of week
    if (chartsInstances.load) chartsInstances.load.destroy();
    const loadCtx = document.getElementById('loadChart');
    if (loadCtx) {
        const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
        const loadByDay = new Array(7).fill(0);
        for (const d of dailyData) {
            const date = new Date(d.date);
            const dayIdx = (date.getDay() + 6) % 7; // Monday=0
            loadByDay[dayIdx] += d.count || 0;
        }

        chartsInstances.load = new Chart(loadCtx, {
            type: 'bar',
            data: {
                labels: dayNames,
                datasets: [{
                    data: loadByDay,
                    backgroundColor: dayNames.map((_, i) => i >= 5 ? 'rgba(245, 158, 11, 0.6)' : 'rgba(59, 130, 246, 0.5)'),
                    borderRadius: 6
                }]
            },
            options: defaultOptions
        });
    }
}

// ==========================================
// RENDER: LOYALTY (v19.7)
// ==========================================

function renderLoyaltyTiers(tiers, customerCounts) {
    const grid = document.getElementById('loyaltyTiersGrid');
    if (!grid) return;

    if (!tiers || tiers.length === 0) {
        grid.innerHTML = '<div class="center-empty">Немає рівнів лояльності</div>';
        return;
    }

    grid.innerHTML = tiers.map(t => {
        const count = customerCounts ? (customerCounts[t.name] || 0) : 0;
        return `
        <div class="loyalty-tier-card" style="background: ${t.color}15; border-color: ${t.color}40">
            <div class="loyalty-tier-name" style="color: ${t.color}">${escapeHtml(t.name)}</div>
            <div class="loyalty-tier-discount" style="color: ${t.color}">${t.discount_percent}%</div>
            <div class="loyalty-tier-reqs">від ${t.min_bookings} броней / ${formatPrice(t.min_spent)}</div>
            <div class="loyalty-tier-count">${count} клієнтів</div>
        </div>`;
    }).join('');

    // Stats
    const statsEl = document.getElementById('loyaltyStats');
    if (statsEl && customerCounts) {
        const total = Object.values(customerCounts).reduce((s, v) => s + v, 0);
        statsEl.innerHTML = `<span>Всього клієнтів: <strong>${total}</strong></span>`;
    }
}

async function recalculateLoyalty() {
    showNotification('Перерахунок лояльності...', '');
    const result = await apiRecalculateLoyalty();
    if (result.success) {
        showNotification(`Оновлено ${result.updated} клієнтів`, 'success');
        loadLoyalty();
    } else {
        showNotification('Помилка перерахунку', 'error');
    }
}

// ==========================================
// RENDER: DISCOUNTS (v19.7)
// ==========================================

function renderDiscounts(codes) {
    const container = document.getElementById('discountsList');
    if (!container) return;

    if (!codes || codes.length === 0) {
        container.innerHTML = '<div class="center-empty">Немає промокодів</div>';
        return;
    }

    const now = new Date();

    container.innerHTML = codes.map(d => {
        const isExpired = d.valid_until && new Date(d.valid_until) < now;
        const isActive = d.is_active && !isExpired;
        const statusClass = isActive ? 'active' : isExpired ? 'expired' : 'inactive';
        const statusText = isActive ? 'Активний' : isExpired ? 'Закінчився' : 'Неактивний';

        const valueText = d.type === 'percent' ? `${d.value}%` : `${d.value} ₴`;
        const usageText = d.max_uses ? `${d.usage_count || 0}/${d.max_uses}` : `${d.usage_count || 0}`;

        let dateRange = '';
        if (d.valid_from || d.valid_until) {
            const from = d.valid_from ? new Date(d.valid_from).toLocaleDateString('uk-UA') : '...';
            const to = d.valid_until ? new Date(d.valid_until).toLocaleDateString('uk-UA') : '...';
            dateRange = `${from} — ${to}`;
        }

        return `
        <div class="discount-row">
            <span class="discount-code-badge">${escapeHtml(d.code)}</span>
            <div class="discount-info">
                <div class="discount-info-name">${escapeHtml(d.name)}</div>
                <div class="discount-info-details">
                    ${dateRange ? dateRange + ' | ' : ''}
                    ${d.min_order > 0 ? 'мін. ' + formatPrice(d.min_order) + ' | ' : ''}
                    ${d.category ? 'категорія: ' + escapeHtml(d.category) : ''}
                </div>
            </div>
            <span class="discount-value-badge">${valueText}</span>
            <span class="discount-usage">Використань: ${usageText}</span>
            <span class="discount-status ${statusClass}">${statusText}</span>
            <div class="discount-actions">
                <button class="btn-price-delete" onclick="deleteDiscount(${d.id})" title="Деактивувати">✕</button>
            </div>
        </div>`;
    }).join('');
}

function showAddDiscountForm() {
    const form = document.getElementById('addDiscountForm');
    if (!form) return;

    if (!form.classList.contains('hidden')) {
        form.classList.add('hidden');
        return;
    }

    form.classList.remove('hidden');
    form.innerHTML = `
        <div class="discount-form-grid">
            <input type="text" id="dcCode" placeholder="Код (напр. SPRING25)" style="text-transform:uppercase">
            <input type="text" id="dcName" placeholder="Назва знижки">
            <select id="dcType">
                <option value="percent">Відсоток (%)</option>
                <option value="fixed">Фіксована (₴)</option>
            </select>
            <input type="number" id="dcValue" placeholder="Значення (5-100 або сума)">
            <input type="number" id="dcMinOrder" placeholder="Мін. замовлення (₴)">
            <input type="number" id="dcMaxUses" placeholder="Макс. використань">
            <input type="date" id="dcFrom" placeholder="Дійсний з">
            <input type="date" id="dcUntil" placeholder="Дійсний до">
            <input type="text" id="dcCategory" placeholder="Категорія (необ.)">
        </div>
        <div class="discount-form-actions">
            <button onclick="submitNewDiscount()" style="background:var(--primary);color:#fff">Створити</button>
            <button onclick="document.getElementById('addDiscountForm').classList.add('hidden')" style="background:var(--gray-100);color:var(--gray-600)">Скасувати</button>
        </div>
    `;
}

async function submitNewDiscount() {
    const code = document.getElementById('dcCode').value.trim();
    const name = document.getElementById('dcName').value.trim();
    const type = document.getElementById('dcType').value;
    const value = parseInt(document.getElementById('dcValue').value);
    const min_order = parseInt(document.getElementById('dcMinOrder').value) || 0;
    const max_uses = parseInt(document.getElementById('dcMaxUses').value) || null;
    const valid_from = document.getElementById('dcFrom').value || null;
    const valid_until = document.getElementById('dcUntil').value || null;
    const category = document.getElementById('dcCategory').value.trim() || null;

    if (!code || !name || isNaN(value)) {
        showNotification('Заповніть код, назву та значення', 'error');
        return;
    }

    const result = await apiCreateDiscount({ code, name, type, value, min_order, max_uses, valid_from, valid_until, category });
    if (result.id) {
        showNotification(`Промокод ${code.toUpperCase()} створено`, 'success');
        document.getElementById('addDiscountForm').classList.add('hidden');
        loadDiscounts();
    } else {
        showNotification(result.error || 'Помилка створення', 'error');
    }
}

async function deleteDiscount(id) {
    if (!confirm('Деактивувати цей промокод?')) return;
    const result = await apiDeleteDiscount(id);
    if (result.success) {
        showNotification('Промокод деактивовано', 'success');
        loadDiscounts();
    } else {
        showNotification(result.error || 'Помилка', 'error');
    }
}

// ==========================================
// RENDER: PROPOSALS (v19.7)
// ==========================================

function renderProposals(items) {
    const container = document.getElementById('proposalsList');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="center-empty">Немає пропозицій зі знижками</div>';
        return;
    }

    const segmentLabels = {
        all: 'Всі',
        new: 'Нові клієнти',
        loyal: 'Постійні',
        at_risk: 'Під ризиком',
        birthday: 'Іменинники',
        vip: 'VIP'
    };

    container.innerHTML = items.map(p => {
        const isActive = p.is_active !== false;
        const now = new Date();
        const isExpired = p.end_date && new Date(p.end_date) < now;

        let dateRange = '';
        if (p.start_date || p.end_date) {
            const from = p.start_date ? new Date(p.start_date).toLocaleDateString('uk-UA') : '...';
            const to = p.end_date ? new Date(p.end_date).toLocaleDateString('uk-UA') : '...';
            dateRange = `${from} — ${to}`;
        }

        const discountInfo = p.discount_code
            ? `Промокод: ${p.discount_code} (${p.discount_type === 'percent' ? p.discount_value + '%' : p.discount_value + ' ₴'})`
            : '';

        return `
        <div class="proposal-card" style="border-color: ${p.banner_color || '#10B981'}; background: ${p.banner_color || '#10B981'}08; ${isExpired ? 'opacity:0.5' : ''}">
            <div class="proposal-card-header">
                <div class="proposal-card-title">${escapeHtml(p.title)}</div>
                <span class="proposal-card-segment">${segmentLabels[p.target_segment] || p.target_segment || 'Всі'}</span>
            </div>
            ${p.description ? `<div class="proposal-card-desc">${escapeHtml(p.description)}</div>` : ''}
            <div class="proposal-card-meta">
                ${discountInfo ? `<span>${discountInfo}</span>` : ''}
                ${dateRange ? `<span>${dateRange}</span>` : ''}
                <span>${isExpired ? 'Закінчилась' : isActive ? 'Активна' : 'Неактивна'}</span>
            </div>
            <div class="proposal-card-actions">
                <button class="btn-price-delete" onclick="deleteProposal(${p.id})" title="Видалити">✕</button>
            </div>
        </div>`;
    }).join('');
}

function showAddProposalForm() {
    const container = document.getElementById('proposalsList');
    if (!container) return;

    // Check if form already exists
    if (document.getElementById('proposalFormInline')) {
        document.getElementById('proposalFormInline').remove();
        return;
    }

    // Build options for discount codes select
    const codeOptions = discountCodes
        .filter(d => d.is_active)
        .map(d => `<option value="${d.id}">${d.code} — ${d.name}</option>`)
        .join('');

    const formHtml = `
    <div id="proposalFormInline" class="discount-add-form" style="margin-bottom:10px">
        <div class="discount-form-grid">
            <input type="text" id="propTitle" placeholder="Назва пропозиції">
            <input type="text" id="propDesc" placeholder="Опис (необ.)">
            <select id="propCodeId">
                <option value="">Без промокоду</option>
                ${codeOptions}
            </select>
            <select id="propSegment">
                <option value="all">Всі клієнти</option>
                <option value="new">Нові клієнти</option>
                <option value="loyal">Постійні</option>
                <option value="vip">VIP</option>
                <option value="at_risk">Під ризиком</option>
                <option value="birthday">Іменинники</option>
            </select>
            <input type="date" id="propStart" placeholder="Початок">
            <input type="date" id="propEnd" placeholder="Кінець">
            <input type="color" id="propColor" value="#10B981" style="height:38px">
        </div>
        <div class="discount-form-actions">
            <button onclick="submitNewProposal()" style="background:var(--primary);color:#fff">Створити</button>
            <button onclick="document.getElementById('proposalFormInline').remove()" style="background:var(--gray-100);color:var(--gray-600)">Скасувати</button>
        </div>
    </div>`;

    container.insertAdjacentHTML('beforebegin', formHtml);
}

async function submitNewProposal() {
    const title = document.getElementById('propTitle').value.trim();
    const description = document.getElementById('propDesc').value.trim() || null;
    const discount_code_id = parseInt(document.getElementById('propCodeId').value) || null;
    const target_segment = document.getElementById('propSegment').value;
    const start_date = document.getElementById('propStart').value || null;
    const end_date = document.getElementById('propEnd').value || null;
    const banner_color = document.getElementById('propColor').value;

    if (!title) {
        showNotification('Введіть назву пропозиції', 'error');
        return;
    }

    const result = await apiCreateProposal({ title, description, discount_code_id, target_segment, start_date, end_date, banner_color });
    if (result.id) {
        showNotification('Пропозицію створено', 'success');
        const form = document.getElementById('proposalFormInline');
        if (form) form.remove();
        loadProposals();
    } else {
        showNotification(result.error || 'Помилка створення', 'error');
    }
}

async function deleteProposal(id) {
    if (!confirm('Видалити цю пропозицію?')) return;
    const result = await apiDeleteProposal(id);
    if (result.success) {
        showNotification('Пропозицію видалено', 'success');
        loadProposals();
    } else {
        showNotification(result.error || 'Помилка', 'error');
    }
}

// ==========================================
// SEND REPORT TO TELEGRAM (v19.8)
// ==========================================

async function sendReportToTelegram() {
    try {
        showNotification('Надсилання звіту в Telegram...', '');
        const response = await fetch(`${API_BASE}/shifts/daily-digest`, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        if (data.success) {
            showNotification(`Звіт надіслано! Бронювань: ${data.bookings}, задач: ${data.tasks}`, 'success');
        } else {
            showNotification('Не вдалось надіслати звіт', 'error');
        }
    } catch (err) {
        console.error('Send report error:', err);
        showNotification('Помилка надсилання звіту', 'error');
    }
}

// ==========================================
// DATA LOADING
// ==========================================

async function loadOverview() {
    const data = await apiCenterOverview();
    if (!data || !data.success) {
        document.getElementById('kpiGrid').innerHTML = '<div class="center-empty">Помилка завантаження</div>';
        return;
    }
    centerData = data;
    renderKPI(data.kpi, currentPeriod);
}

async function loadWorkers() {
    try {
        const response = await fetch(`${API_BASE}/center/workers`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return;
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        if (data.success) {
            renderWorkers(data.workers);
        } else {
            document.getElementById('workersGrid').innerHTML = '<div class="center-empty">Помилка завантаження</div>';
        }
    } catch (err) {
        console.error('Load workers error:', err);
        document.getElementById('workersGrid').innerHTML = '<div class="center-empty">Помилка завантаження</div>';
    }
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

async function loadCharts() {
    const data = await apiChartsData();
    if (data) {
        renderCharts(data);
    } else {
        const section = document.getElementById('chartsSection');
        if (section) section.querySelector('.charts-grid').innerHTML = '<div class="center-empty">Немає даних для графіків</div>';
    }
}

async function loadLoyalty() {
    const [tiers, customersData] = await Promise.all([
        apiLoyaltyTiers(),
        apiLoyaltyCustomers()
    ]);

    loyaltyTiers = tiers || [];

    // Count customers per tier
    const customerCounts = {};
    if (customersData && customersData.items) {
        for (const c of customersData.items) {
            const tierName = c.tier_name || 'Без рівня';
            customerCounts[tierName] = (customerCounts[tierName] || 0) + 1;
        }
    }

    renderLoyaltyTiers(loyaltyTiers, customerCounts);
}

async function loadDiscounts() {
    discountCodes = await apiGetDiscounts();
    renderDiscounts(discountCodes);
}

async function loadProposals() {
    proposals = await apiGetProposals();
    renderProposals(proposals);
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

    // Restore collapsed sections from localStorage
    restoreCollapsedState();

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
        loadWorkers(),
        loadPrices(),
        loadTasks(),
        loadReport(),
        loadCharts(),
        loadLoyalty(),
        loadDiscounts(),
        loadProposals()
    ]);

    // Profile handler
    if (typeof initProfileHandler === 'function') initProfileHandler();
}

// ==========================================
// COLLAPSIBLE SECTIONS
// ==========================================

function toggleSection(titleEl) {
    const section = titleEl.closest('.center-section');
    if (!section) return;
    section.classList.toggle('collapsed');
    // Save state
    const sectionId = section.id;
    if (sectionId) {
        const collapsed = JSON.parse(localStorage.getItem('center_collapsed') || '{}');
        collapsed[sectionId] = section.classList.contains('collapsed');
        localStorage.setItem('center_collapsed', JSON.stringify(collapsed));
    }
}

function restoreCollapsedState() {
    const saved = JSON.parse(localStorage.getItem('center_collapsed') || '{}');
    // Default: all collapsed except KPI and Charts
    const defaultOpen = ['kpiSection', 'chartsSection'];
    document.querySelectorAll('.center-section').forEach(section => {
        const id = section.id;
        if (!id) return;
        if (id in saved) {
            // User has explicitly set this section
            if (saved[id]) section.classList.add('collapsed');
        } else {
            // Default: collapse everything except KPI and Charts
            if (!defaultOpen.includes(id)) section.classList.add('collapsed');
        }
    });
}

document.addEventListener('DOMContentLoaded', initCenterPage);
