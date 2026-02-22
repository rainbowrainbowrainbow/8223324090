/**
 * js/finance-page.js — Finance module frontend (v16.0)
 *
 * Dashboard, transactions CRUD, monthly P&L, salary report, CSV export.
 */

/* global apiVerifyToken, initDarkMode, apiGetBudgetComparison, apiSaveBudget */

// ==========================================
// HELPERS — apiRequest & showNotification
// ==========================================

async function apiRequest(method, url, body) {
    const token = localStorage.getItem('pzp_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('pzp_token');
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        if (document.getElementById('mainApp')) document.getElementById('mainApp').style.display = 'none';
        throw new Error('Unauthorized');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
}

function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    if (!el) return;
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

// ==========================================
// STATE
// ==========================================

const FinState = {
    categories: [],
    transactions: [],
    dashboard: null,
    monthlyReport: null,
    salaryReport: null,
    page: 1,
    totalPages: 1,
    editingId: null,
    currentTab: 'dashboard'
};

const PAYMENT_LABELS = {
    cash: 'Готівка',
    card: 'Картка',
    transfer: 'Переказ',
    mixed: 'Змішаний'
};

const DEPT_LABELS = {
    animators: 'Аніматори',
    admin: 'Адміністрація',
    cafe: 'Кафе',
    tech: 'Технічний',
    cleaning: 'Прибирання',
    security: 'Охорона'
};

// ==========================================
// FORMATTING
// ==========================================

function formatMoney(amount) {
    if (!amount && amount !== 0) return '0 ₴';
    return amount.toLocaleString('uk-UA') + ' ₴';
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return dateStr;
}

// ==========================================
// PERIOD HELPERS
// ==========================================

function getCurrentMonthRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const lastDay = new Date(year, month, 0).getDate();
    return {
        from: `${year}-${String(month).padStart(2, '0')}-01`,
        to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
}

function getFilterDates() {
    const from = document.getElementById('dateFromFilter')?.value;
    const to = document.getElementById('dateToFilter')?.value;
    if (from && to) return { from, to };
    return getCurrentMonthRange();
}

// ==========================================
// API CALLS
// ==========================================

async function fetchCategories() {
    try {
        const res = await apiRequest('GET', '/api/finance/categories');
        FinState.categories = res || [];
        populateCategoryFilter();
    } catch (err) {
        console.error('Failed to fetch categories', err);
    }
}

async function fetchDashboard() {
    try {
        const { from, to } = getFilterDates();
        const res = await apiRequest('GET', `/api/finance/dashboard?from=${from}&to=${to}`);
        FinState.dashboard = res;
        renderStats(res);
        renderDailyChart(res.daily || []);
        renderCategoryBreakdown(res.incomeByCategory || [], res.expenseByCategory || []);
    } catch (err) {
        console.error('Failed to fetch dashboard', err);
    }
}

async function fetchTransactions() {
    try {
        const { from, to } = getFilterDates();
        const type = document.getElementById('typeFilter')?.value || '';
        const categoryId = document.getElementById('categoryFilter')?.value || '';
        const paymentMethod = document.getElementById('paymentFilter')?.value || '';
        const search = document.getElementById('searchInput')?.value || '';

        const params = new URLSearchParams({ page: FinState.page, limit: 50, from, to });
        if (type) params.append('type', type);
        if (categoryId) params.append('categoryId', categoryId);
        if (paymentMethod) params.append('paymentMethod', paymentMethod);
        if (search) params.append('search', search);

        const res = await apiRequest('GET', `/api/finance/transactions?${params}`);
        FinState.transactions = res.transactions || [];
        FinState.totalPages = res.totalPages || 1;
        renderTransactionTable();
        renderPagination();
    } catch (err) {
        console.error('Failed to fetch transactions', err);
    }
}

async function fetchMonthlyReport() {
    try {
        const year = document.getElementById('yearFilter')?.value || new Date().getFullYear();
        const res = await apiRequest('GET', `/api/finance/report/monthly?year=${year}`);
        FinState.monthlyReport = res;
        renderMonthlyReport(res);
        renderMonthlyChart(res.months || []);
    } catch (err) {
        console.error('Failed to fetch monthly report', err);
    }
}

async function fetchSalaryReport() {
    try {
        const month = document.getElementById('salaryMonth')?.value;
        if (!month) return;
        const res = await apiRequest('GET', `/api/finance/report/salary?month=${month}`);
        FinState.salaryReport = res;
        renderSalaryReport(res);
    } catch (err) {
        console.error('Failed to fetch salary report', err);
    }
}

async function saveTransaction() {
    const type = document.getElementById('editType').value;
    const categoryId = document.getElementById('editCategory').value;
    const amount = parseInt(document.getElementById('editAmount').value);
    const date = document.getElementById('editDate').value;
    const paymentMethod = document.getElementById('editPayment').value;
    const description = document.getElementById('editDescription').value.trim();

    if (!amount || amount <= 0) {
        showNotification('Вкажіть суму', 'error');
        return;
    }
    if (!date) {
        showNotification('Вкажіть дату', 'error');
        return;
    }

    const data = { type, categoryId: categoryId ? parseInt(categoryId) : null, amount, date, paymentMethod: paymentMethod || null, description: description || null };

    try {
        if (FinState.editingId) {
            await apiRequest('PUT', `/api/finance/transactions/${FinState.editingId}`, data);
            showNotification('Транзакцію оновлено');
        } else {
            await apiRequest('POST', '/api/finance/transactions', data);
            showNotification('Транзакцію створено');
        }
        closeTransModal();
        refreshData();
    } catch (err) {
        showNotification('Помилка збереження', 'error');
    }
}

async function deleteTransaction(id) {
    if (!confirm('Видалити транзакцію?')) return;
    try {
        await apiRequest('DELETE', `/api/finance/transactions/${id}`);
        showNotification('Транзакцію видалено');
        refreshData();
    } catch (err) {
        showNotification('Помилка видалення', 'error');
    }
}

// ==========================================
// RENDERING — STATS
// ==========================================

function renderStats(data) {
    const el = document.getElementById('finStats');
    if (!data || !data.totals) {
        el.innerHTML = '';
        return;
    }
    const t = data.totals;
    el.innerHTML = `
        <div class="fin-stat-card fin-stat-income">
            <div class="fin-stat-value">${formatMoney(t.income)}</div>
            <div class="fin-stat-label">Доходи (${t.incomeCount})</div>
        </div>
        <div class="fin-stat-card fin-stat-expense">
            <div class="fin-stat-value">${formatMoney(t.expense)}</div>
            <div class="fin-stat-label">Витрати (${t.expenseCount})</div>
        </div>
        <div class="fin-stat-card fin-stat-profit">
            <div class="fin-stat-value">${formatMoney(t.profit)}</div>
            <div class="fin-stat-label">Прибуток</div>
        </div>
        <div class="fin-stat-card fin-stat-bookings">
            <div class="fin-stat-value">${formatMoney(data.bookingRevenue?.revenue || 0)}</div>
            <div class="fin-stat-label">Бронювання (${data.bookingRevenue?.count || 0})</div>
        </div>
    `;
}

// ==========================================
// RENDERING — DAILY CHART
// ==========================================

function renderDailyChart(daily) {
    const el = document.getElementById('dailyChart');
    if (!daily || daily.length === 0) {
        el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px">Немає даних за період</div>';
        return;
    }

    const maxVal = Math.max(...daily.map(d => Math.max(d.income, d.expense)), 1);

    el.innerHTML = daily.map(d => {
        const incH = Math.max((d.income / maxVal) * 140, 2);
        const expH = Math.max((d.expense / maxVal) * 140, 2);
        const dayLabel = d.date.substring(8); // DD
        return `
            <div class="fin-bar-group">
                <div class="fin-bar-pair">
                    <div class="fin-bar income" style="height:${incH}px" title="Дохід: ${formatMoney(d.income)}"></div>
                    <div class="fin-bar expense" style="height:${expH}px" title="Витрати: ${formatMoney(d.expense)}"></div>
                </div>
                <div class="fin-bar-label">${dayLabel}</div>
            </div>
        `;
    }).join('');
}

// ==========================================
// RENDERING — CATEGORY BREAKDOWN
// ==========================================

function renderCategoryBreakdown(incomeData, expenseData) {
    renderCatSection('incomeCats', incomeData, '#10B981');
    renderCatSection('expenseCats', expenseData, '#EF4444');
}

function renderCatSection(elId, data, color) {
    const el = document.getElementById(elId);
    if (!data || data.length === 0) {
        el.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:8px">Немає даних</div>';
        return;
    }
    const maxTotal = Math.max(...data.map(d => d.total), 1);
    el.innerHTML = data.map(d => `
        <div class="fin-cat-row">
            <span class="fin-cat-icon">${d.icon || '📋'}</span>
            <span class="fin-cat-name">${d.name}</span>
            <div class="fin-cat-bar">
                <div class="fin-cat-bar-fill" style="width:${Math.round(d.total / maxTotal * 100)}%;background:${d.color || color}"></div>
            </div>
            <span class="fin-cat-amount" style="color:${d.color || color}">${formatMoney(d.total)}</span>
        </div>
    `).join('');
}

// ==========================================
// RENDERING — TRANSACTIONS TABLE
// ==========================================

function renderTransactionTable() {
    const tbody = document.getElementById('transTableBody');
    if (!FinState.transactions.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:24px">Немає транзакцій за період</td></tr>';
        return;
    }

    tbody.innerHTML = FinState.transactions.map(t => `
        <tr onclick="editTransaction(${t.id})" title="Натисніть для редагування">
            <td>${formatDate(t.date)}</td>
            <td><span class="fin-type-badge ${t.type}">${t.type === 'income' ? 'Дохід' : 'Витрата'}</span></td>
            <td>${t.categoryIcon || ''} ${t.categoryName || '—'}</td>
            <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description || '—'}</td>
            <td class="fin-amount-${t.type}">${t.type === 'income' ? '+' : '-'}${formatMoney(t.amount)}</td>
            <td>${t.paymentMethod ? `<span class="fin-payment-badge">${PAYMENT_LABELS[t.paymentMethod] || t.paymentMethod}</span>` : '—'}</td>
            <td>${t.createdBy || '—'}</td>
        </tr>
    `).join('');
}

// ==========================================
// RENDERING — PAGINATION
// ==========================================

function renderPagination() {
    const el = document.getElementById('pagination');
    if (FinState.totalPages <= 1) { el.innerHTML = ''; return; }

    let html = `<button ${FinState.page <= 1 ? 'disabled' : ''} onclick="goToPage(${FinState.page - 1})">←</button>`;
    for (let p = 1; p <= FinState.totalPages && p <= 10; p++) {
        html += `<button class="${p === FinState.page ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
    }
    html += `<button ${FinState.page >= FinState.totalPages ? 'disabled' : ''} onclick="goToPage(${FinState.page + 1})">→</button>`;
    el.innerHTML = html;
}

// ==========================================
// RENDERING — MONTHLY REPORT
// ==========================================

function renderMonthlyReport(data) {
    if (!data || !data.months) return;

    const tbody = document.getElementById('monthlyTableBody');
    tbody.innerHTML = data.months.map(m => `
        <tr>
            <td>${m.monthName}</td>
            <td class="fin-amount-income">${formatMoney(m.income)}</td>
            <td class="fin-amount-expense">${formatMoney(m.expense)}</td>
            <td style="color:${m.profit >= 0 ? '#10B981' : '#EF4444'};font-weight:700">${formatMoney(m.profit)}</td>
        </tr>
    `).join('');

    const tfoot = document.getElementById('monthlyTableFoot');
    const t = data.totals;
    tfoot.innerHTML = `
        <tr>
            <td>РАЗОМ</td>
            <td class="fin-amount-income">${formatMoney(t.income)}</td>
            <td class="fin-amount-expense">${formatMoney(t.expense)}</td>
            <td style="color:${t.profit >= 0 ? '#10B981' : '#EF4444'};font-weight:700">${formatMoney(t.profit)}</td>
        </tr>
    `;
}

function renderMonthlyChart(months) {
    const el = document.getElementById('monthlyChart');
    if (!months || months.length === 0) {
        el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px">Немає даних</div>';
        return;
    }

    const maxVal = Math.max(...months.map(m => Math.max(m.income, m.expense)), 1);
    const SHORT_MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

    el.innerHTML = months.map((m, i) => {
        const incH = Math.max((m.income / maxVal) * 140, 2);
        const expH = Math.max((m.expense / maxVal) * 140, 2);
        return `
            <div class="fin-bar-group">
                <div class="fin-bar-pair">
                    <div class="fin-bar income" style="height:${incH}px" title="${m.monthName}: ${formatMoney(m.income)}"></div>
                    <div class="fin-bar expense" style="height:${expH}px" title="${m.monthName}: ${formatMoney(m.expense)}"></div>
                </div>
                <div class="fin-bar-label">${SHORT_MONTHS[i]}</div>
            </div>
        `;
    }).join('');
}

// ==========================================
// RENDERING — SALARY REPORT
// ==========================================

function renderSalaryReport(data) {
    if (!data) return;
    const tbody = document.getElementById('salaryTableBody');
    const tfoot = document.getElementById('salaryTableFoot');

    if (!data.staff || data.staff.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:24px">Немає даних за період</td></tr>';
        tfoot.innerHTML = '';
        return;
    }

    tbody.innerHTML = data.staff.map(s => `
        <tr>
            <td style="font-weight:600">${s.name}</td>
            <td>${DEPT_LABELS[s.department] || s.department}</td>
            <td>${s.position}</td>
            <td>${s.hourlyRate} ₴</td>
            <td>${s.totalHours} год</td>
            <td class="fin-amount-expense">${formatMoney(s.estimatedSalary)}</td>
        </tr>
    `).join('');

    tfoot.innerHTML = `
        <tr>
            <td colspan="5" style="text-align:right;font-weight:800">РАЗОМ:</td>
            <td class="fin-amount-expense" style="font-weight:800">${formatMoney(data.totalSalary)}</td>
        </tr>
    `;
}

// ==========================================
// MODALS
// ==========================================

function openTransModal(id) {
    FinState.editingId = id || null;
    const modal = document.getElementById('transEditModal');
    const title = document.getElementById('transEditTitle');

    if (id) {
        title.textContent = 'Редагувати транзакцію';
        const tx = FinState.transactions.find(t => t.id === id);
        if (tx) {
            document.getElementById('editType').value = tx.type;
            updateCategoryOptions(tx.type);
            document.getElementById('editCategory').value = tx.categoryId || '';
            document.getElementById('editAmount').value = tx.amount;
            document.getElementById('editDate').value = tx.date;
            document.getElementById('editPayment').value = tx.paymentMethod || '';
            document.getElementById('editDescription').value = tx.description || '';
        }
    } else {
        title.textContent = 'Нова транзакція';
        document.getElementById('editType').value = 'income';
        updateCategoryOptions('income');
        document.getElementById('editAmount').value = '';
        // Default date: today
        const now = new Date();
        document.getElementById('editDate').value = now.toISOString().split('T')[0];
        document.getElementById('editPayment').value = '';
        document.getElementById('editDescription').value = '';
    }

    modal.classList.remove('hidden');
}

function closeTransModal() {
    document.getElementById('transEditModal').classList.add('hidden');
    FinState.editingId = null;
}

function updateCategoryOptions(type) {
    const sel = document.getElementById('editCategory');
    const filtered = FinState.categories.filter(c => c.type === type);
    sel.innerHTML = '<option value="">Без категорії</option>' +
        filtered.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('');
}

// Global functions for onclick
window.editTransaction = function(id) {
    openTransModal(id);
};

window.confirmDeleteTransaction = function(id) {
    deleteTransaction(id);
};

window.goToPage = function(page) {
    if (page < 1 || page > FinState.totalPages) return;
    FinState.page = page;
    fetchTransactions();
};

// ==========================================
// FILTER HELPERS
// ==========================================

function populateCategoryFilter() {
    const sel = document.getElementById('categoryFilter');
    if (!sel) return;
    sel.innerHTML = '<option value="">Всі категорії</option>' +
        FinState.categories.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('');
}

function populateYearFilter() {
    const sel = document.getElementById('yearFilter');
    if (!sel) return;
    const currentYear = new Date().getFullYear();
    sel.innerHTML = '';
    for (let y = currentYear; y >= currentYear - 5; y--) {
        sel.innerHTML += `<option value="${y}">${y}</option>`;
    }
}

// ==========================================
// TAB SWITCHING
// ==========================================

function switchTab(tabName) {
    FinState.currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.fin-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Show/hide tab panels
    document.getElementById('tabDashboard').style.display = tabName === 'dashboard' ? '' : 'none';
    document.getElementById('tabTransactions').style.display = tabName === 'transactions' ? '' : 'none';
    document.getElementById('tabMonthly').style.display = tabName === 'monthly' ? '' : 'none';
    document.getElementById('tabSalary').style.display = tabName === 'salary' ? '' : 'none';
    document.getElementById('tabBudget').style.display = tabName === 'budget' ? '' : 'none';

    // Load data for tab
    if (tabName === 'dashboard') fetchDashboard();
    if (tabName === 'transactions') fetchTransactions();
    if (tabName === 'monthly') fetchMonthlyReport();
    if (tabName === 'salary') fetchSalaryReport();
    if (tabName === 'budget') initBudgetTab();
}

// ==========================================
// CSV EXPORT
// ==========================================

async function exportCSV() {
    try {
        const { from, to } = getFilterDates();
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/finance/export?from=${from}&to=${to}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `finance_${from}_${to}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('CSV завантажено');
    } catch (err) {
        showNotification('Помилка експорту', 'error');
    }
}

// ==========================================
// EXCEL EXPORT (v17.0)
// ==========================================

async function exportXLSX() {
    try {
        const { from, to } = getFilterDates();
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/finance/export-xlsx?from=${from}&to=${to}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `finance_${from}_${to}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Excel завантажено');
    } catch (err) {
        showNotification('Помилка експорту', 'error');
    }
}

// ==========================================
// BUDGET (v17.0)
// ==========================================

let budgetInitialized = false;

function initBudgetTab() {
    if (!budgetInitialized) {
        // Populate year selector
        const yearSelect = document.getElementById('budgetYear');
        if (yearSelect && yearSelect.options.length === 0) {
            const currentYear = new Date().getFullYear();
            for (let y = currentYear - 1; y <= currentYear + 1; y++) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                if (y === currentYear) opt.selected = true;
                yearSelect.appendChild(opt);
            }
        }

        // Set current month
        const monthSelect = document.getElementById('budgetMonth');
        if (monthSelect) monthSelect.value = new Date().getMonth() + 1;

        // Populate category selector
        const catSelect = document.getElementById('budgetCategorySelect');
        if (catSelect && catSelect.options.length === 0) {
            for (const cat of FinState.categories) {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = `${cat.icon || ''} ${cat.name} (${cat.type === 'income' ? 'дохід' : 'витрата'})`;
                catSelect.appendChild(opt);
            }
        }

        budgetInitialized = true;
    }
    loadBudgetComparison();
}

async function loadBudgetComparison() {
    const year = parseInt(document.getElementById('budgetYear')?.value) || new Date().getFullYear();
    const month = parseInt(document.getElementById('budgetMonth')?.value) || (new Date().getMonth() + 1);

    const data = await apiGetBudgetComparison(year, month);
    if (!data) return;

    const container = document.getElementById('budgetComparison');
    if (data.comparison.length === 0) {
        container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400);">Бюджет на цей місяць ще не встановлено. Додайте план нижче.</div>';
        return;
    }

    // Render totals
    const t = data.totals;
    let html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px;">
        <div class="fin-stat-card fin-stat-income">
            <div class="fin-stat-value">${formatMoney(t.incomeActual)}</div>
            <div class="fin-stat-label">Дохід (план: ${formatMoney(t.incomePlanned)})</div>
        </div>
        <div class="fin-stat-card fin-stat-expense">
            <div class="fin-stat-value">${formatMoney(t.expenseActual)}</div>
            <div class="fin-stat-label">Витрати (план: ${formatMoney(t.expensePlanned)})</div>
        </div>
        <div class="fin-stat-card fin-stat-profit">
            <div class="fin-stat-value">${formatMoney(t.profitActual)}</div>
            <div class="fin-stat-label">Прибуток (план: ${formatMoney(t.profitPlanned)})</div>
        </div>
    </div>`;

    // Render comparison table
    html += `<div class="fin-table-wrap"><table class="fin-monthly-table">
        <thead><tr>
            <th style="text-align:left">Категорія</th>
            <th>План ₴</th>
            <th>Факт ₴</th>
            <th>Різниця ₴</th>
            <th>%</th>
        </tr></thead><tbody>`;

    for (const c of data.comparison) {
        const diffColor = c.categoryType === 'expense'
            ? (c.diff > 0 ? '#EF4444' : '#10B981')
            : (c.diff >= 0 ? '#10B981' : '#EF4444');
        const pctColor = c.categoryType === 'expense'
            ? (c.percentUsed > 100 ? '#EF4444' : '#10B981')
            : (c.percentUsed >= 80 ? '#10B981' : '#F59E0B');

        html += `<tr>
            <td style="text-align:left">${c.categoryIcon || ''} ${escapeHtml(c.categoryName)}</td>
            <td>${formatMoney(c.planned)}</td>
            <td>${formatMoney(c.actual)}</td>
            <td style="color:${diffColor};font-weight:700">${c.diff > 0 ? '+' : ''}${formatMoney(c.diff)}</td>
            <td style="color:${pctColor};font-weight:700">${c.percentUsed}%</td>
        </tr>`;
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

async function saveBudgetPlan() {
    const year = parseInt(document.getElementById('budgetYear')?.value);
    const month = parseInt(document.getElementById('budgetMonth')?.value);
    const categoryId = parseInt(document.getElementById('budgetCategorySelect')?.value);
    const plannedAmount = parseInt(document.getElementById('budgetAmountInput')?.value);

    if (!categoryId || isNaN(plannedAmount) || plannedAmount < 0) {
        showNotification('Вкажіть категорію та суму', 'error');
        return;
    }

    const result = await apiSaveBudget({ year, month, categoryId, plannedAmount });
    if (result && result.success) {
        showNotification('Бюджет збережено');
        document.getElementById('budgetAmountInput').value = '';
        loadBudgetComparison();
    } else {
        showNotification(result?.error || 'Помилка', 'error');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// DATA REFRESH
// ==========================================

function refreshData() {
    fetchDashboard();
    if (FinState.currentTab === 'transactions') fetchTransactions();
    if (FinState.currentTab === 'monthly') fetchMonthlyReport();
    if (FinState.currentTab === 'salary') fetchSalaryReport();
}

// ==========================================
// INIT
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // Dark mode
    if (typeof initDarkMode === 'function') initDarkMode();

    // Auth check
    const token = localStorage.getItem('pzp_token');
    if (!token) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    try {
        const user = await apiVerifyToken();
        if (!user) throw new Error('Invalid token');

        document.getElementById('currentUser').textContent = user.name || user.username;

        // Role-based visibility
        if (user.role === 'admin') {
            const addBtn = document.getElementById('addTransactionBtn');
            if (addBtn) addBtn.style.display = '';
            const exportBtn = document.getElementById('exportCsvBtn');
            if (exportBtn) exportBtn.style.display = '';
            const xlsxBtn = document.getElementById('exportXlsxBtn');
            if (xlsxBtn) xlsxBtn.style.display = '';
        }
    } catch {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        window.location.href = '/';
    });

    // Set default dates to current month
    const range = getCurrentMonthRange();
    const dateFrom = document.getElementById('dateFromFilter');
    const dateTo = document.getElementById('dateToFilter');
    if (dateFrom) dateFrom.value = range.from;
    if (dateTo) dateTo.value = range.to;

    // Salary month default
    const salaryMonth = document.getElementById('salaryMonth');
    if (salaryMonth) {
        const now = new Date();
        salaryMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Year filter
    populateYearFilter();

    // Fetch initial data
    await fetchCategories();
    fetchDashboard();

    // Tab clicks
    document.querySelectorAll('.fin-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Add transaction button
    document.getElementById('addTransactionBtn')?.addEventListener('click', () => openTransModal());

    // Export CSV & XLSX
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);
    document.getElementById('exportXlsxBtn')?.addEventListener('click', exportXLSX);

    // Save transaction
    document.getElementById('saveTransBtn')?.addEventListener('click', saveTransaction);
    document.getElementById('cancelTransBtn')?.addEventListener('click', closeTransModal);

    // Type change → update category options
    document.getElementById('editType')?.addEventListener('change', (e) => {
        updateCategoryOptions(e.target.value);
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.add('hidden');
        });
    });

    // Modal backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    });

    // Filter change handlers (debounced search)
    let searchTimer;
    document.getElementById('searchInput')?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            FinState.page = 1;
            fetchTransactions();
        }, 300);
    });

    ['typeFilter', 'categoryFilter', 'paymentFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            FinState.page = 1;
            fetchTransactions();
        });
    });

    // Date filter changes → refresh all data
    ['dateFromFilter', 'dateToFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', refreshData);
    });

    // Year filter change
    document.getElementById('yearFilter')?.addEventListener('change', fetchMonthlyReport);

    // Salary month change
    document.getElementById('salaryMonth')?.addEventListener('change', fetchSalaryReport);
});
