/**
 * center-page.js — Center (Boss) management page
 * v19.9.0: + Goals, Briefing, Workload, Catalog, CrossSell, Reconciliation, PerfMatrix, Heatmap, Clients, EventLog
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
let catalogProducts = [];
let catalogFilter = 'all';

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
                <th>З дати</th>
                <th>Програма</th>
                <th>Оновлено</th>
                ${isAdminUser ? '<th>Дії</th>' : ''}
            </tr>
        </thead>
        <tbody>`;

    for (const p of prices) {
        const updatedInfo = p.updated_by
            ? `${p.updated_by}, ${new Date(p.updated_at).toLocaleDateString('uk-UA')}`
            : '';
        const linkedBadge = p.product_id
            ? `<span class="price-linked-badge" title="Прив'язано до ${p.product_id}">🔗 ${p.product_id}</span>`
            : (isAdminUser ? `<button class="price-link-btn" onclick="linkPriceToProduct('${escapeHtml(p.code)}')" title="Прив'язати до програми">🔗 Прив'язати</button>` : `<span class="price-unlinked-badge">—</span>`);
        const effectiveDate = p.effective_from
            ? new Date(p.effective_from).toLocaleDateString('uk-UA')
            : 'зараз';

        html += `<tr data-code="${p.code}">
            <td>
                <div style="font-weight:700">${escapeHtml(p.name)}</div>
                <div style="font-size:10px;color:var(--gray-400)">${escapeHtml(p.code)}</div>
            </td>
            <td><span class="price-category-badge">${escapeHtml(p.category) || '—'}</span></td>
            <td>
                ${isAdminUser
                    ? `<input type="number" class="price-inline-input" value="${p.value}" data-code="${escapeHtml(p.code)}" data-original="${p.value}" data-product-id="${p.product_id || ''}"
                        onkeydown="if(event.key==='Enter')confirmPriceChange(this)">
                       <span class="price-unit">${escapeHtml(p.unit) || ''}</span>`
                    : `<span class="price-value-cell">${p.value}</span><span class="price-unit">${escapeHtml(p.unit) || ''}</span>`
                }
            </td>
            <td><span class="price-effective">${effectiveDate}</span></td>
            <td>${linkedBadge}</td>
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

// v20.9.25: Price change with confirmation dialog
function confirmPriceChange(input) {
    const code = input.dataset.code;
    const newValue = parseInt(input.value);
    const original = parseInt(input.dataset.original);
    const productId = input.dataset.productId;

    if (isNaN(newValue) || newValue === original) return;

    const diff = newValue - original;
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    const linkedText = productId ? `\n\nЦіна автоматично оновиться в каталозі програм (${productId}).` : '\n\n⚠ Ціна НЕ прив\'язана до програми — бронювання не зміниться.';

    // Build confirmation dialog
    const overlay = document.createElement('div');
    overlay.className = 'price-confirm-overlay';
    overlay.innerHTML = `
        <div class="price-confirm-dialog">
            <h3>Підтвердження зміни ціни</h3>
            <p><b>${code}</b>: ${original} → ${newValue} ₴ (${diffText} ₴)</p>
            <p style="font-size:12px;color:var(--gray-500)">${linkedText.replace(/\n/g, '<br>')}</p>
            <div class="price-confirm-date">
                <label>Дата введення в дію:</label>
                <div style="display:flex;gap:8px;align-items:center">
                    <button class="price-date-btn active" data-date="">Зараз</button>
                    <input type="date" class="price-date-input" min="${new Date().toISOString().split('T')[0]}" style="display:none">
                    <button class="price-date-btn" data-date="custom">Інший день</button>
                </div>
            </div>
            <div class="price-confirm-actions">
                <button class="btn-confirm-cancel">Скасувати</button>
                <button class="btn-confirm-save">Зберегти</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const dateInput = overlay.querySelector('.price-date-input');
    const dateBtns = overlay.querySelectorAll('.price-date-btn');
    let effectiveFrom = null;

    dateBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dateBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (btn.dataset.date === 'custom') {
                dateInput.style.display = '';
                dateInput.focus();
            } else {
                dateInput.style.display = 'none';
                effectiveFrom = null;
            }
        });
    });
    dateInput.addEventListener('change', () => { effectiveFrom = dateInput.value; });

    overlay.querySelector('.btn-confirm-cancel').addEventListener('click', () => {
        input.value = original;
        overlay.remove();
    });
    overlay.querySelector('.btn-confirm-save').addEventListener('click', async () => {
        overlay.querySelector('.btn-confirm-save').disabled = true;
        overlay.querySelector('.btn-confirm-save').textContent = 'Збереження...';
        const result = await apiUpdatePrice(code, { value: newValue, effectiveFrom: effectiveFrom || undefined });
        overlay.remove();
        if (result.success) {
            input.dataset.original = newValue;
            input.style.borderColor = '#2E7D32';
            setTimeout(() => { input.style.borderColor = ''; }, 1500);
            const syncMsg = result.productSynced ? ' (ціна в каталозі оновлена!)' : '';
            showNotification(`Ціну ${code} оновлено: ${newValue} ₴${syncMsg}`, 'success');
            // v20.9.25: Reload catalog if product was synced
            if (result.productSynced && typeof loadCatalog === 'function') {
                loadCatalog();
            }
        } else {
            input.value = original;
            showNotification(result.error || 'Помилка оновлення', 'error');
        }
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { input.value = original; overlay.remove(); }
    });
}

// Legacy compat
async function savePriceInline(input) { confirmPriceChange(input); }

// v20.9.25: Link price_rule to a product
async function linkPriceToProduct(code) {
    try {
        const resp = await fetch(`${API_BASE}/products?active=true`, { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Помилка завантаження програм');
        const data = await resp.json();
        const products = data.products || data || [];
        if (!products.length) { showNotification('Немає програм для прив\'язки', 'error'); return; }

        const select = products.map(p => `<option value="${p.id}">${p.name} (${p.id}) — ${p.price} ₴</option>`).join('');
        const overlay = document.createElement('div');
        overlay.className = 'price-confirm-overlay';
        overlay.innerHTML = `
            <div class="price-confirm-dialog">
                <h3>Прив'язати до програми</h3>
                <p>Ціна <b>${code}</b> буде автоматично оновлюватись у каталозі.</p>
                <select id="linkProductSelect" style="width:100%;padding:8px 12px;border:1.5px solid var(--gray-200);border-radius:8px;font-family:inherit;font-size:14px;min-height:44px">
                    <option value="">— Оберіть програму —</option>
                    ${select}
                </select>
                <div class="price-confirm-actions">
                    <button class="btn-confirm-cancel">Скасувати</button>
                    <button class="btn-confirm-save">Прив'язати</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('.btn-confirm-cancel').addEventListener('click', () => overlay.remove());
        overlay.querySelector('.btn-confirm-save').addEventListener('click', async () => {
            const productId = document.getElementById('linkProductSelect').value;
            if (!productId) { showNotification('Оберіть програму', 'error'); return; }
            const result = await apiUpdatePrice(code, { productId });
            overlay.remove();
            if (result.success) {
                showNotification(`Ціну ${code} прив'язано до ${productId}`, 'success');
                loadPrices();
            } else {
                showNotification(result.error || 'Помилка', 'error');
            }
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    } catch (err) {
        showNotification(err.message, 'error');
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
        <div class="report-content">${escapeHtml(report.text)}</div>
        <div class="report-meta">${report.author ? `Автор: ${escapeHtml(report.author)}` : ''} ${date ? `| ${date}` : ''}</div>
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
// API CALLS — New features (v19.9)
// ==========================================

async function apiCenterGoals() {
    try {
        const r = await fetch(`${API_BASE}/center/goals`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API goals error:', err); return { success: false }; }
}

async function apiSaveGoals(data) {
    try {
        const r = await fetch(`${API_BASE}/center/goals`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data) });
        return await r.json();
    } catch (err) { console.error('API save goals error:', err); return { success: false }; }
}

async function apiCenterBriefing() {
    try {
        const r = await fetch(`${API_BASE}/center/briefing`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API briefing error:', err); return { success: false }; }
}

async function apiAnimatorWorkload() {
    try {
        const r = await fetch(`${API_BASE}/stats/load?period=month`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API workload error:', err); return null; }
}

async function apiProgramPerformance() {
    try {
        const r = await fetch(`${API_BASE}/center/program-performance`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API program-performance error:', err); return { success: false }; }
}

async function apiSeasonalHeatmap() {
    try {
        const r = await fetch(`${API_BASE}/center/heatmap?months=6`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API heatmap error:', err); return { success: false }; }
}

async function apiSearchClients(search) {
    try {
        const url = search ? `${API_BASE}/center/clients?search=${encodeURIComponent(search)}` : `${API_BASE}/center/clients`;
        const r = await fetch(url, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API clients error:', err); return { success: false, clients: [] }; }
}

async function apiClientBookings(clientId) {
    try {
        const r = await fetch(`${API_BASE}/center/clients/${clientId}/bookings`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API client bookings error:', err); return { success: false, bookings: [] }; }
}

async function apiCrossSell() {
    try {
        const r = await fetch(`${API_BASE}/center/cross-sell`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API cross-sell error:', err); return { success: false }; }
}

async function apiProducts() {
    try {
        const r = await fetch(`${API_BASE}/products?active=true`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        const data = await r.json();
        return Array.isArray(data) ? data : (data.products || data.data || []);
    } catch (err) { console.error('API products error:', err); return []; }
}

async function apiReconciliation() {
    try {
        const r = await fetch(`${API_BASE}/center/reconciliation`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API reconciliation error:', err); return { success: false }; }
}

async function apiEventLog() {
    try {
        const r = await fetch(`${API_BASE}/center/event-log?limit=50`, { headers: getAuthHeaders(false) });
        if (!r.ok) throw new Error('API error');
        return await r.json();
    } catch (err) { console.error('API event-log error:', err); return { success: false, events: [] }; }
}

// ==========================================
// RENDER: REVENUE GOALS (v19.9)
// ==========================================

function renderGoals(goals, kpi) {
    const el = document.getElementById('goalsContent');
    if (!el) return;

    if (!goals) {
        el.innerHTML = '<div class="center-empty">Цілі не налаштовано. Натисніть "Налаштувати".</div>';
        return;
    }

    const weekData = kpi ? kpi.week : { revenue: 0, bookings: 0 };
    const monthData = kpi ? kpi.month : { revenue: 0, bookings: 0 };

    const items = [
        { label: 'Виручка за тиждень', current: weekData.revenue, target: goals.weeklyRevenue, format: 'money' },
        { label: 'Бронювань за тиждень', current: weekData.bookings, target: goals.weeklyBookings, format: 'count' },
        { label: 'Виручка за місяць', current: monthData.revenue, target: goals.monthlyRevenue, format: 'money' },
        { label: 'Бронювань за місяць', current: monthData.bookings, target: goals.monthlyBookings, format: 'count' }
    ];

    el.innerHTML = '<div class="goals-grid">' + items.map(item => {
        if (!item.target || item.target <= 0) return '';
        const pct = Math.min(Math.round(item.current / item.target * 100), 100);
        const color = pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red';
        const currentFmt = item.format === 'money' ? formatPrice(item.current) : item.current;
        const targetFmt = item.format === 'money' ? formatPrice(item.target) : item.target;
        return `
        <div class="goal-card">
            <div class="goal-card-label">${item.label}</div>
            <div class="goal-progress-bar">
                <div class="goal-progress-fill ${color}" style="width:${pct}%"></div>
                <div class="goal-progress-text">${pct}%</div>
            </div>
            <div class="goal-values"><span>${currentFmt}</span><strong>${targetFmt}</strong></div>
        </div>`;
    }).filter(Boolean).join('') + '</div>';
}

function showGoalsForm() {
    const el = document.getElementById('goalsContent');
    if (!el) return;
    // Ensure section is expanded so the form is visible
    const section = el.closest('.center-section');
    if (section && section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
    }
    if (document.getElementById('goalsFormInline')) {
        document.getElementById('goalsFormInline').remove();
        return;
    }
    const html = `
    <div id="goalsFormInline" class="goals-form" style="margin-top:12px">
        <input type="number" id="goalWeekRev" placeholder="Виручка/тиждень (₴)">
        <input type="number" id="goalWeekBook" placeholder="Бронювань/тиждень">
        <input type="number" id="goalMonthRev" placeholder="Виручка/місяць (₴)">
        <input type="number" id="goalMonthBook" placeholder="Бронювань/місяць">
        <div class="goals-form-actions">
            <button onclick="saveGoals()" style="background:var(--primary);color:#fff">Зберегти</button>
            <button onclick="document.getElementById('goalsFormInline').remove()" style="background:var(--gray-100);color:var(--gray-600)">Скасувати</button>
        </div>
    </div>`;
    el.insertAdjacentHTML('beforeend', html);
}

async function saveGoals() {
    const data = {
        weeklyRevenue: parseInt(document.getElementById('goalWeekRev').value) || 0,
        weeklyBookings: parseInt(document.getElementById('goalWeekBook').value) || 0,
        monthlyRevenue: parseInt(document.getElementById('goalMonthRev').value) || 0,
        monthlyBookings: parseInt(document.getElementById('goalMonthBook').value) || 0
    };
    const result = await apiSaveGoals(data);
    if (result.success) {
        showNotification('Цілі збережено', 'success');
        document.getElementById('goalsFormInline')?.remove();
        loadGoals();
    } else {
        showNotification('Помилка збереження', 'error');
    }
}

// ==========================================
// RENDER: WEEKLY BRIEFING (v19.9)
// ==========================================

function renderBriefing(briefing) {
    const el = document.getElementById('briefingContent');
    if (!el) return;

    if (!briefing) {
        el.innerHTML = '<div class="center-empty">Немає даних для брифінгу</div>';
        return;
    }

    const dayNames = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 0: 'Нд' };
    const b = briefing.bookings;
    const t = briefing.tasks;

    // Schedule by day
    let scheduleHtml = '';
    if (b.byDay) {
        for (const [date, bookings] of Object.entries(b.byDay)) {
            const d = new Date(date + 'T12:00:00');
            const dayName = dayNames[d.getDay()] || '';
            const dayNum = d.getDate();
            const rev = bookings.filter(x => x.status === 'confirmed').reduce((s, x) => s + (x.price || 0), 0);
            scheduleHtml += `
            <div class="briefing-day-row">
                <span class="briefing-day-name">${dayName} ${dayNum}</span>
                <span>${bookings.length} бронювань</span>
                <span class="briefing-day-count">${formatPrice(rev)}</span>
            </div>`;
        }
    }

    // Alerts
    let alertsHtml = '';
    if (t.highPriority && t.highPriority.length > 0) {
        alertsHtml += `<div class="briefing-alert warning">&#9888; ${t.highPriority.length} терміново${t.highPriority.length > 1 ? 'х задач' : 'а задача'}</div>`;
    }
    if (briefing.expiringDiscounts && briefing.expiringDiscounts.length > 0) {
        alertsHtml += `<div class="briefing-alert info">&#128276; ${briefing.expiringDiscounts.length} промокод${briefing.expiringDiscounts.length > 1 ? 'ів закінчуються' : ' закінчується'} цього тижня</div>`;
    }
    if (b.preliminary > 0) {
        alertsHtml += `<div class="briefing-alert warning">&#128221; ${b.preliminary} попередн${b.preliminary > 1 ? 'іх бронювань' : 'є бронювання'} очікує підтвердження</div>`;
    }

    // Staff schedule
    let staffHtml = '';
    if (briefing.staff && briefing.staff.length > 0) {
        const staffByDay = {};
        for (const s of briefing.staff) {
            const d = typeof s.date === 'string' ? s.date : s.date?.toISOString().split('T')[0];
            if (!staffByDay[d]) staffByDay[d] = [];
            staffByDay[d].push(s);
        }
        for (const [date, staff] of Object.entries(staffByDay).slice(0, 7)) {
            const d = new Date(date + 'T12:00:00');
            const dayName = dayNames[d.getDay()];
            staffHtml += `<div class="briefing-staff-row">
                <span style="font-weight:700">${dayName} ${d.getDate()}</span>
                <span>${staff.map(s => s.name).join(', ')}</span>
            </div>`;
        }
    }

    el.innerHTML = `
    <div class="briefing-grid">
        <div class="briefing-card">
            <div class="briefing-card-title">Бронювання тижня</div>
            <div style="display:flex;gap:16px;margin-bottom:8px;font-size:13px">
                <span><strong style="font-size:18px;color:#2E7D32">${b.total}</strong> бронювань</span>
                <span><strong style="font-size:18px;color:#2E7D32">${formatPrice(b.revenue)}</strong></span>
            </div>
            ${scheduleHtml || '<div style="color:var(--gray-400);font-size:12px">Немає бронювань</div>'}
        </div>
        <div class="briefing-card">
            <div class="briefing-card-title">Сповіщення</div>
            ${alertsHtml || '<div style="color:var(--gray-400);font-size:12px">Все добре!</div>'}
            <div style="margin-top:10px;font-size:12px;color:var(--gray-500)">
                Задачі: <strong>${t.open}</strong> відкритих з <strong>${t.total}</strong>
            </div>
        </div>
        ${staffHtml ? `<div class="briefing-card">
            <div class="briefing-card-title">Аніматори на тижні</div>
            ${staffHtml}
        </div>` : ''}
    </div>`;
}

// ==========================================
// RENDER: ANIMATOR WORKLOAD (v19.9)
// ==========================================

function renderWorkload(loadData) {
    const el = document.getElementById('workloadContent');
    if (!el) return;

    const animators = loadData?.animatorWorkload || [];
    if (!animators.length) {
        el.innerHTML = '<div class="center-empty">Немає даних про навантаження</div>';
        return;
    }

    const maxMins = Math.max(...animators.map(a => a.totalMinutes), 1);

    el.innerHTML = '<div class="workload-grid">' + animators.map(a => {
        const hours = Math.round(a.totalMinutes / 60 * 10) / 10;
        const pct = Math.round(a.totalMinutes / maxMins * 100);
        const color = pct >= 80 ? '#EF4444' : pct >= 50 ? '#F59E0B' : '#10B981';
        return `
        <div class="workload-card" style="border-left-color:${color}">
            <div class="workload-card-name">${escapeHtml(a.animatorName)}</div>
            <div class="workload-card-stats">
                <div><strong>${a.bookingCount}</strong> бронювань</div>
                <div><strong>${hours}</strong> годин</div>
            </div>
            <div class="workload-bar">
                <div class="workload-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
        </div>`;
    }).join('') + '</div>';
}

// ==========================================
// RENDER: PROGRAM PERFORMANCE (v19.9)
// ==========================================

function renderProgramPerformance(data) {
    const el = document.getElementById('perfContent');
    if (!el) return;

    const programs = data?.programs || [];
    if (!programs.length) {
        el.innerHTML = '<div class="center-empty">Немає даних</div>';
        return;
    }

    const catNames = { quest: 'Квест', animation: 'Анімація', show: 'Шоу', photo: 'Фото', masterclass: 'МК', pinata: 'Піньята', custom: 'Інше' };

    el.innerHTML = `<table class="perf-table">
        <thead><tr>
            <th>Програма</th>
            <th>Категорія</th>
            <th>Бронювань</th>
            <th>Виручка</th>
            <th>Сер. чек</th>
            <th>Сер. дітей</th>
            <th>Конверсія</th>
        </tr></thead>
        <tbody>${programs.map(p => {
            const conversionPct = p.total > 0 ? Math.round(p.confirmed / p.total * 100) : 0;
            const convClass = conversionPct >= 80 ? 'high' : conversionPct >= 50 ? 'medium' : 'low';
            return `<tr>
                <td style="font-weight:700">${escapeHtml(p.program_name)}</td>
                <td><span class="price-category-badge">${catNames[p.category] || p.category || '—'}</span></td>
                <td>${p.total} <span style="font-size:10px;color:var(--gray-400)">(${p.confirmed}✓)</span></td>
                <td style="font-weight:800;color:#2E7D32">${formatPrice(p.revenue)}</td>
                <td>${formatPrice(p.avg_price)}</td>
                <td>${p.avg_kids || '—'}</td>
                <td><span class="perf-conversion ${convClass}">${conversionPct}%</span></td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

// ==========================================
// RENDER: SEASONAL HEATMAP (v19.9)
// ==========================================

function renderHeatmap(data) {
    const el = document.getElementById('heatmapContent');
    if (!el) return;

    const entries = data?.heatmap || [];
    if (!entries.length) {
        el.innerHTML = '<div class="center-empty">Немає даних</div>';
        return;
    }

    // Build a map of date -> count
    const countMap = {};
    let maxCount = 0;
    for (const e of entries) {
        const d = typeof e.date === 'string' ? e.date : e.date?.toISOString().split('T')[0];
        countMap[d] = e.count;
        if (e.count > maxCount) maxCount = e.count;
    }

    // Generate weeks grid covering the period
    const from = new Date(data.period.from + 'T12:00:00');
    const to = new Date(data.period.to + 'T12:00:00');

    // Start from Monday of the first week
    const startDate = new Date(from);
    const dow = startDate.getDay() || 7;
    startDate.setDate(startDate.getDate() - (dow - 1));

    const weeks = [];
    let currentWeek = [];
    const d = new Date(startDate);
    const monthLabels = [];
    let lastMonth = -1;

    while (d <= to || currentWeek.length > 0) {
        if (currentWeek.length === 7) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
        if (d > to && currentWeek.length === 0) break;

        const dateStr = d.toISOString().split('T')[0];
        const count = countMap[dateStr] || 0;
        const level = count === 0 ? 0 : count <= maxCount * 0.25 ? 1 : count <= maxCount * 0.5 ? 2 : count <= maxCount * 0.75 ? 3 : 4;

        // Track month labels
        if (d.getMonth() !== lastMonth && d <= to) {
            monthLabels.push({ weekIdx: weeks.length, name: d.toLocaleString('uk-UA', { month: 'short' }) });
            lastMonth = d.getMonth();
        }

        const inRange = d >= from && d <= to;
        const rev = entries.find(e => {
            const ed = typeof e.date === 'string' ? e.date : e.date?.toISOString().split('T')[0];
            return ed === dateStr;
        });
        const revStr = rev ? ` | ${formatPrice(rev.revenue)}` : '';

        currentWeek.push(inRange
            ? `<div class="heatmap-cell level-${level}" title="${dateStr}: ${count} бронювань${revStr}"></div>`
            : `<div class="heatmap-cell" style="opacity:0.15"></div>`
        );
        d.setDate(d.getDate() + 1);
    }
    if (currentWeek.length > 0) {
        while (currentWeek.length < 7) currentWeek.push('<div class="heatmap-cell" style="opacity:0.15"></div>');
        weeks.push(currentWeek);
    }

    // Month labels row
    let monthHtml = '<div class="heatmap-months">';
    let labelPositions = monthLabels.map((ml, i) => {
        const nextIdx = i + 1 < monthLabels.length ? monthLabels[i + 1].weekIdx : weeks.length;
        const span = nextIdx - ml.weekIdx;
        return `<span class="heatmap-month-label" style="width:${span * 16}px">${ml.name}</span>`;
    });
    monthHtml += labelPositions.join('') + '</div>';

    el.innerHTML = `
    <div class="heatmap-container">
        ${monthHtml}
        <div class="heatmap-grid">
            ${weeks.map(w => `<div class="heatmap-week">${w.join('')}</div>`).join('')}
        </div>
    </div>
    <div class="heatmap-legend">
        <span>Менше</span>
        <div class="heatmap-legend-cell" style="background:var(--gray-100)"></div>
        <div class="heatmap-legend-cell" style="background:#D1FAE5"></div>
        <div class="heatmap-legend-cell" style="background:#6EE7B7"></div>
        <div class="heatmap-legend-cell" style="background:#10B981"></div>
        <div class="heatmap-legend-cell" style="background:#047857"></div>
        <span>Більше</span>
    </div>`;
}

// ==========================================
// RENDER: CLIENTS + HISTORY (v19.9)
// ==========================================

function renderClients(clients) {
    const el = document.getElementById('clientsContent');
    if (!el) return;

    if (!clients || !clients.length) {
        el.innerHTML = '<div class="center-empty" style="padding:20px">Введіть ім\'я або телефон для пошуку</div>';
        return;
    }

    el.innerHTML = clients.map(c => {
        const initials = (c.name || '?').substring(0, 2).toUpperCase();
        const lastVisit = c.last_visit ? new Date(c.last_visit).toLocaleDateString('uk-UA') : '—';
        return `
        <div class="client-card" onclick="showClientProfile(${c.id})">
            <div class="client-card-avatar">${initials}</div>
            <div class="client-card-info">
                <div class="client-card-name">${escapeHtml(c.name || '—')}</div>
                <div class="client-card-meta">${escapeHtml(c.phone || '')} ${c.child_name ? '| Дитина: ' + escapeHtml(c.child_name) : ''}</div>
            </div>
            <div class="client-card-stats">
                <div class="revenue">${formatPrice(c.total_spent)}</div>
                <div>${c.total_bookings || 0} бронювань</div>
                <div style="font-size:10px;color:var(--gray-400)">Останній: ${lastVisit}</div>
            </div>
        </div>`;
    }).join('');
}

async function searchClients() {
    const input = document.getElementById('clientSearchInput');
    const query = input ? input.value.trim() : '';
    const data = await apiSearchClients(query);
    renderClients(data.clients || []);
    document.getElementById('clientBookingsContent')?.classList.add('hidden');
}

async function showClientProfile(clientId) {
    const el = document.getElementById('clientBookingsContent');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = '<div class="center-loading">Завантаження...</div>';

    const [clientsData, bookingsData] = await Promise.all([
        apiSearchClients(''),
        apiClientBookings(clientId)
    ]);

    const client = (clientsData.clients || []).find(c => c.id === clientId);
    const bookings = bookingsData.bookings || [];

    if (!client) {
        el.innerHTML = '<div class="center-empty">Клієнта не знайдено</div>';
        return;
    }

    const tierColor = { 'VIP': '#8B5CF6', 'Premium': '#F59E0B', 'Standard': '#3B82F6' };
    const tc = tierColor[client.loyalty_tier] || '#6B7280';

    let html = `
    <div class="client-profile">
        <div class="client-profile-header">
            <div class="client-profile-name">${escapeHtml(client.name)}</div>
            ${client.loyalty_tier ? `<span class="client-profile-tier" style="background:${tc}15;color:${tc}">${escapeHtml(client.loyalty_tier)}</span>` : ''}
        </div>
        <div class="client-profile-grid">
            <div class="client-profile-stat">
                <div class="client-profile-stat-label">Телефон</div>
                <div class="client-profile-stat-value">${escapeHtml(client.phone || '—')}</div>
            </div>
            <div class="client-profile-stat">
                <div class="client-profile-stat-label">Дитина</div>
                <div class="client-profile-stat-value">${escapeHtml(client.child_name || '—')}</div>
            </div>
            <div class="client-profile-stat">
                <div class="client-profile-stat-label">Бронювань</div>
                <div class="client-profile-stat-value">${client.total_bookings || 0}</div>
            </div>
            <div class="client-profile-stat">
                <div class="client-profile-stat-label">Витрачено</div>
                <div class="client-profile-stat-value" style="color:#2E7D32">${formatPrice(client.total_spent)}</div>
            </div>
            <div class="client-profile-stat">
                <div class="client-profile-stat-label">Перший візит</div>
                <div class="client-profile-stat-value">${client.first_visit ? new Date(client.first_visit).toLocaleDateString('uk-UA') : '—'}</div>
            </div>
            <div class="client-profile-stat">
                <div class="client-profile-stat-label">Останній візит</div>
                <div class="client-profile-stat-value">${client.last_visit ? new Date(client.last_visit).toLocaleDateString('uk-UA') : '—'}</div>
            </div>
        </div>
    </div>`;

    if (bookings.length > 0) {
        html += '<div style="font-size:12px;font-weight:700;margin-bottom:6px;color:var(--gray-600)">Історія бронювань</div>';
        html += bookings.map(b => {
            const dateStr = b.date ? new Date(b.date).toLocaleDateString('uk-UA') : '';
            return `
            <div class="client-booking-row">
                <span class="client-booking-date">${dateStr} ${b.time || ''}</span>
                <span class="client-booking-program">${escapeHtml(b.program_name)}</span>
                <span class="client-booking-price">${formatPrice(b.price)}</span>
                <span class="client-booking-status ${b.status}">${b.status === 'confirmed' ? '✓' : '~'}</span>
            </div>`;
        }).join('');
    } else {
        html += '<div class="center-empty" style="padding:12px">Немає бронювань</div>';
    }

    el.innerHTML = html;
}

// ==========================================
// RENDER: CROSS-SELL (v19.9)
// ==========================================

function renderCrossSell(data) {
    const el = document.getElementById('crossSellContent');
    if (!el) return;

    const combos = data?.combos || [];
    const addons = data?.addons || [];

    if (!combos.length && !addons.length) {
        el.innerHTML = '<div class="center-empty">Недостатньо даних для аналізу</div>';
        return;
    }

    let html = '<div class="cross-sell-grid">';

    if (combos.length) {
        html += '<div><div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--gray-600)">Популярні комбінації</div>';
        html += combos.slice(0, 8).map(c => `
        <div class="combo-card">
            <div class="combo-count">${c.combo_count}</div>
            <div class="combo-programs">
                <span style="font-weight:700">${escapeHtml(c.program_a)}</span>
                <span class="combo-plus">+</span>
                <span style="font-weight:700">${escapeHtml(c.program_b)}</span>
            </div>
        </div>`).join('');
        html += '</div>';
    }

    if (addons.length) {
        html += '<div><div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--gray-600)">Топ додаткові послуги</div>';
        html += addons.map(a => `
        <div class="addon-row">
            <span class="addon-row-name">${escapeHtml(a.program_name)}</span>
            <span class="addon-row-stats">${a.count} разів</span>
            <span class="addon-row-revenue">${formatPrice(a.revenue)}</span>
        </div>`).join('');
        html += '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
}

// ==========================================
// RENDER: FULL CATALOG (v19.9)
// ==========================================

function renderCatalog(products) {
    const el = document.getElementById('catalogContent');
    const tabsEl = document.getElementById('catalogTabs');
    if (!el) return;

    catalogProducts = products || [];
    if (!catalogProducts.length) {
        el.innerHTML = '<div class="center-empty">Немає активних програм</div>';
        return;
    }

    // Build category tabs
    const categories = [...new Set(catalogProducts.map(p => p.category))].filter(Boolean);
    const catNames = { quest: 'Квести', animation: 'Анімація', show: 'Шоу', photo: 'Фото', masterclass: 'Майстер-класи', pinata: 'Піньяти', custom: 'Інше' };

    if (tabsEl) {
        tabsEl.innerHTML = `
            <button class="catalog-filter-tab ${catalogFilter === 'all' ? 'active' : ''}" onclick="filterCatalog('all')">Всі</button>
            ${categories.map(c => `<button class="catalog-filter-tab ${catalogFilter === c ? 'active' : ''}" onclick="filterCatalog('${c}')">${catNames[c] || c}</button>`).join('')}
        `;
    }

    const filtered = catalogFilter === 'all' ? catalogProducts : catalogProducts.filter(p => p.category === catalogFilter);

    el.innerHTML = '<div class="catalog-grid">' + filtered.map(p => {
        const icon = p.icon || (catNames[p.category] ? '' : '');
        const dur = p.duration ? `${p.duration} хв` : '';
        const hosts = p.hosts ? `${p.hosts} анім.` : '';
        const kids = p.kidsCapacity || p.kids_capacity || '';
        const age = p.ageRange || p.age_range || '';
        const meta = [dur, hosts, kids, age].filter(Boolean).join(' | ');
        const priceVal = p.isPerChild || p.is_per_child ? `${formatPrice(p.price)}/дит` : formatPrice(p.price);
        return `
        <div class="catalog-card">
            <div class="catalog-card-icon">${icon}</div>
            <div class="catalog-card-info">
                <div class="catalog-card-name">${escapeHtml(p.name)}</div>
                <div class="catalog-card-meta">${meta}</div>
            </div>
            <div class="catalog-card-price">${priceVal}</div>
        </div>`;
    }).join('') + '</div>';
}

function filterCatalog(cat) {
    catalogFilter = cat;
    renderCatalog(catalogProducts);
}

// ==========================================
// RENDER: FINANCIAL RECONCILIATION (v19.9)
// ==========================================

function renderReconciliation(data) {
    const el = document.getElementById('reconciliationContent');
    if (!el) return;

    if (!data || !data.reconciliation) {
        el.innerHTML = '<div class="center-empty">Немає даних для звірки</div>';
        return;
    }

    const r = data.reconciliation;
    const b = r.bookings;
    const p = r.payments;
    const gapClass = Math.abs(r.gapPercent) <= 5 ? 'ok' : Math.abs(r.gapPercent) <= 20 ? 'warn' : 'danger';
    const gapIcon = gapClass === 'ok' ? '&#10004;' : gapClass === 'warn' ? '&#9888;' : '&#10060;';

    el.innerHTML = `
    <div class="recon-grid">
        <div class="recon-card">
            <div class="recon-card-label">Бронювання (підтверджені)</div>
            <div class="recon-card-value positive">${formatPrice(b.confirmed_revenue)}</div>
            <div class="recon-card-sub">${b.confirmed} з ${b.total_bookings} бронювань</div>
        </div>
        <div class="recon-card">
            <div class="recon-card-label">Фактичні надходження</div>
            <div class="recon-card-value positive">${formatPrice(p.total_income)}</div>
            <div class="recon-card-sub">${p.income_count} транзакцій</div>
        </div>
        <div class="recon-card">
            <div class="recon-card-label">Витрати</div>
            <div class="recon-card-value negative">${formatPrice(p.total_expense)}</div>
            <div class="recon-card-sub">${p.expense_count} транзакцій</div>
        </div>
    </div>
    <div class="recon-gap-bar ${gapClass}">
        <span>${gapIcon} Різниця: <strong>${formatPrice(Math.abs(r.gap))}</strong> (${r.gapPercent}%)</span>
        <span style="font-size:11px">${r.gap > 0 ? 'Не зібрано' : r.gap < 0 ? 'Зібрано більше' : 'Збігається'}</span>
    </div>`;
}

// ==========================================
// RENDER: EVENT TIMELINE (v19.9)
// ==========================================

function renderEventLog(data) {
    const el = document.getElementById('eventLogContent');
    if (!el) return;

    const events = data?.events || [];
    if (!events.length) {
        el.innerHTML = '<div class="center-empty">Немає записів</div>';
        return;
    }

    const actionLabels = {
        create: '📅 Створено бронювання', edit: '✏️ Змінено бронювання',
        delete: '🗑️ Видалено', permanent_delete: '💥 Видалено назавжди',
        shift: '🔄 Перенесено', status_change: '📊 Статус змінено',
        undo_create: '↩️ Скасовано створення', undo_delete: '↩️ Відновлено',
        undo_edit: '↩️ Скасовано зміну', undo_shift: '↩️ Скасовано перенос',
        afisha_create: '🎭 Афіша створена', afisha_edit: '🎭 Афіша змінена',
        afisha_move: '🎭 Афіша перенесена', afisha_delete: '🎭 Афіша видалена',
        tasks_generated: '📋 Завдання створені', automation_triggered: '🤖 Автоматизація',
        certificate_create: '📄 Сертифікат видано', certificate_batch: '📦 Пакет сертифікатів',
        certificate_used: '✅ Сертифікат використано', certificate_revoked: '❌ Сертифікат анульовано',
        certificate_edit: '✏️ Сертифікат змінено', certificate_deleted: '🗑️ Сертифікат видалено',
        certificate_delete: '🗑️ Сертифікат видалено', certificate_blocked: '🔒 Сертифікат заблоковано',
        certificate_expired: '⏰ Сертифікат прострочено',
        contractor_response: '🤝 Відповідь підрядника',
        line_create: '➕ Аніматор доданий', line_delete: '➖ Аніматор видалений',
        line_rename: '✏️ Аніматор перейменований'
    };
    const actionClasses = {
        create: 'create', edit: 'edit', delete: 'delete', permanent_delete: 'delete',
        shift: 'edit', status_change: 'edit',
        undo_create: 'edit', undo_delete: 'create', undo_edit: 'edit', undo_shift: 'edit',
        afisha_create: 'create', afisha_edit: 'edit', afisha_move: 'edit', afisha_delete: 'delete',
        certificate_create: 'create', certificate_used: 'create',
        certificate_revoked: 'delete', certificate_deleted: 'delete', certificate_delete: 'delete'
    };

    el.innerHTML = '<div class="event-timeline">' + events.slice(0, 50).map(e => {
        const label = actionLabels[e.action] || e.action;
        const cls = actionClasses[e.action] || 'edit';
        const time = e.timestamp ? new Date(e.timestamp).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

        const details = buildEventDetails(e);

        return `
        <div class="event-row">
            <div class="event-dot ${cls}"></div>
            <div class="event-info">
                <div class="event-info-action">${label} <span style="font-weight:400;opacity:0.7">— ${escapeHtml(e.user || 'система')}</span></div>
                ${details ? `<div class="event-info-details">${details}</div>` : ''}
            </div>
            <div class="event-time">${time}</div>
        </div>`;
    }).join('') + '</div>';
}

function buildEventDetails(e) {
    const d = e.data || {};
    const action = e.action;

    // Booking actions
    if (['create', 'edit', 'delete', 'permanent_delete', 'shift', 'status_change',
         'undo_create', 'undo_delete', 'undo_edit', 'undo_shift'].includes(action)) {
        const parts = [];
        const name = d.label || d.programName || d.program_name || d.programCode || '';
        if (d.id) parts.push(`<b>${escapeHtml(d.id)}</b>`);
        if (name) parts.push(escapeHtml(name));
        if (d.room) parts.push(escapeHtml(d.room));
        if (d.date && d.time) parts.push(`${d.date} ${d.time}`);
        else if (d.date) parts.push(d.date);
        if (action === 'status_change' && d.status) {
            parts.push(d.status === 'confirmed' ? '→ Підтверджено' : '→ Попереднє');
        }
        if (action === 'shift' && d.newDate) parts.push(`→ ${d.newDate} ${d.newTime || ''}`);
        return parts.join(' · ');
    }

    // Afisha actions
    if (action.startsWith('afisha_')) {
        const parts = [];
        if (d.title) parts.push(`<b>${escapeHtml(d.title)}</b>`);
        if (d.type) parts.push(d.type);
        if (d.date && d.time) parts.push(`${d.date} ${d.time}`);
        else if (d.date) parts.push(d.date);
        if (action === 'afisha_move' && d.from && d.to) {
            parts.push(`${escapeHtml(d.from)} → ${escapeHtml(d.to)}`);
        }
        return parts.join(' · ');
    }

    // Certificate actions
    if (action.startsWith('certificate_')) {
        const parts = [];
        if (d.certCode) parts.push(`<b>${escapeHtml(d.certCode)}</b>`);
        if (d.displayValue) parts.push(escapeHtml(d.displayValue));
        if (d.typeText) parts.push(escapeHtml(d.typeText));
        if (action === 'certificate_batch' && d.quantity) parts.push(`${d.quantity} шт.`);
        return parts.join(' · ');
    }

    // Automation/tasks
    if (action === 'automation_triggered') {
        return `${escapeHtml(d.rule_name || '')} → ${escapeHtml(d.booking_id || '')}`;
    }
    if (action === 'tasks_generated') {
        return `${escapeHtml(d.title || '')} — ${d.count || 0} завдань`;
    }

    // Fallback — show all meaningful fields
    const parts = [];
    if (d.id) parts.push(`#${d.id}`);
    if (d.label || d.title || d.name) parts.push(escapeHtml(d.label || d.title || d.name));
    if (d.room) parts.push(d.room);
    if (d.date) parts.push(d.date);
    return parts.join(' · ');
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
// DATA LOADING — New features (v19.9)
// ==========================================

async function loadGoals() {
    const data = await apiCenterGoals();
    if (data.success) {
        renderGoals(data.goals, centerData?.kpi);
    } else {
        document.getElementById('goalsContent').innerHTML = '<div class="center-empty">Помилка завантаження</div>';
    }
}

async function loadBriefing() {
    const data = await apiCenterBriefing();
    if (data.success) {
        renderBriefing(data.briefing);
    } else {
        document.getElementById('briefingContent').innerHTML = '<div class="center-empty">Помилка</div>';
    }
}

async function loadWorkload() {
    const data = await apiAnimatorWorkload();
    renderWorkload(data);
}

async function loadProgramPerformance() {
    const data = await apiProgramPerformance();
    if (data.success) {
        renderProgramPerformance(data);
    } else {
        document.getElementById('perfContent').innerHTML = '<div class="center-empty">Помилка</div>';
    }
}

async function loadHeatmap() {
    const data = await apiSeasonalHeatmap();
    if (data.success) {
        renderHeatmap(data);
    } else {
        document.getElementById('heatmapContent').innerHTML = '<div class="center-empty">Помилка</div>';
    }
}

async function loadCrossSell() {
    const data = await apiCrossSell();
    if (data.success) {
        renderCrossSell(data);
    } else {
        document.getElementById('crossSellContent').innerHTML = '<div class="center-empty">Помилка</div>';
    }
}

async function loadCatalog() {
    const data = await apiProducts();
    renderCatalog(data);
}

async function loadReconciliation() {
    const data = await apiReconciliation();
    renderReconciliation(data);
}

async function loadEventLog() {
    const data = await apiEventLog();
    renderEventLog(data);
}

// ==========================================
// v20.7.0: HOT LEADS
// ==========================================

async function loadHotLeads() {
    const container = document.getElementById('hotLeadsList');
    if (!container) return;
    try {
        const resp = await fetch('/api/leads/hot', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') } });
        const data = await resp.json();
        if (!data.success || !data.leads.length) {
            container.innerHTML = '<div class="center-empty-mini">Немає гарячих лідів — все під контролем 👍</div>';
            return;
        }
        const badge = document.getElementById('hotLeadsCount');
        if (badge) { badge.textContent = data.leads.length; badge.style.display = ''; }

        container.innerHTML = data.leads.map(l => `
            <div class="hot-lead-card" data-id="${l.id}">
                <div class="hot-lead-info">
                    <strong>${escapeHtml(l.client_name || 'Без імені')}</strong>
                    ${l.program_name ? ' • ' + escapeHtml(l.program_name) : ''}
                    ${l.children_count ? ' • ' + l.children_count + ' дітей' : ''}
                    <div class="hot-lead-meta">
                        Запит: ${new Date(l.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        • Без відповіді ${Math.round(l.hours_waiting)} год
                    </div>
                </div>
                <div class="hot-lead-actions">
                    ${l.phone ? `<a href="tel:${l.phone}" class="btn-lead-action">📞</a>` : ''}
                    <button class="btn-lead-action" onclick="updateLeadStatus(${l.id}, 'contacted')" title="Зв'язались">✅</button>
                    <button class="btn-lead-action" onclick="updateLeadStatus(${l.id}, 'lost')" title="Закрити">✖</button>
                </div>
            </div>
        `).join('');
    } catch {
        container.innerHTML = '<div class="center-empty-mini">Помилка завантаження</div>';
    }
}

async function updateLeadStatus(id, status) {
    try {
        await fetch('/api/leads/' + id, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        loadHotLeads();
    } catch { /* silent */ }
}

// Add Lead modal (simple prompt-based)
function initAddLeadBtn() {
    const btn = document.getElementById('addLeadBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const name = prompt("Ім'я клієнта:");
        if (!name) return;
        const phone = prompt('Телефон (необов\'язково):');
        try {
            await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token'), 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_name: name, phone: phone || null })
            });
            loadHotLeads();
        } catch { /* silent */ }
    });
}

// ==========================================
// v20.7.0: MANAGER CONVERSION
// ==========================================

async function loadConversion() {
    const container = document.getElementById('conversionGrid');
    if (!container) return;
    try {
        const now = new Date();
        const resp = await fetch(`/api/analytics/conversion?period=month&year=${now.getFullYear()}&month=${now.getMonth() + 1}`, {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
        });
        const data = await resp.json();
        if (!data.success || !data.managers.length) {
            container.innerHTML = '<div class="center-empty-mini">Немає даних за цей місяць</div>';
            return;
        }
        container.innerHTML = `
            <table class="conversion-table">
                <thead><tr>
                    <th>Менеджер</th><th>Бронювань</th><th>Підтверджено</th><th>Конверсія</th><th>Середній чек</th><th>Виручка</th>
                </tr></thead>
                <tbody>${data.managers.map(m => `
                    <tr>
                        <td><strong>${escapeHtml(m.name)}</strong></td>
                        <td>${m.total_bookings}</td>
                        <td>${m.booked}</td>
                        <td>
                            <div class="conversion-bar-wrap">
                                <div class="conversion-bar" style="width:${m.conversion}%;background:${m.conversion >= 70 ? '#38A169' : m.conversion >= 50 ? '#D69E2E' : '#E53E3E'}"></div>
                                <span>${m.conversion}%</span>
                            </div>
                        </td>
                        <td>${m.avg_check.toLocaleString('uk-UA')} ₴</td>
                        <td><strong>${m.revenue.toLocaleString('uk-UA')} ₴</strong></td>
                    </tr>
                `).join('')}</tbody>
            </table>`;
    } catch {
        container.innerHTML = '<div class="center-empty-mini">Помилка завантаження</div>';
    }
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
    const ADMIN_ROLES = ['creator', 'director', 'vice_director', 'senior_manager'];
    isAdminUser = ADMIN_ROLES.includes(user.role);

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
        loadProposals(),
        loadBriefing(),
        loadWorkload(),
        loadProgramPerformance(),
        loadHeatmap(),
        loadCrossSell(),
        loadCatalog(),
        loadReconciliation(),
        loadEventLog(),
        loadHotLeads(),
        loadConversion()
    ]);
    initAddLeadBtn();

    // Load goals after overview (needs KPI data)
    await loadGoals();

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
