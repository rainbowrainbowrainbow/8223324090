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
        window.location.href = '/';
        return;
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
}

function showNotification(message, type = '') {
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3000);
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
    const btn = document.getElementById('saveTransBtn');
    if (btn && btn.disabled) return;
    const type = document.getElementById('editType')?.value;
    const categoryId = document.getElementById('editCategory')?.value;
    const amount = parseInt(document.getElementById('editAmount')?.value);
    const date = document.getElementById('editDate')?.value;
    const paymentMethod = document.getElementById('editPayment')?.value;
    const description = document.getElementById('editDescription')?.value.trim();

    if (!amount || amount <= 0) {
        showNotification('Вкажіть суму', 'error');
        return;
    }
    if (!date) {
        showNotification('Вкажіть дату', 'error');
        return;
    }

    const data = { type, categoryId: categoryId ? parseInt(categoryId) : null, amount, date, paymentMethod: paymentMethod || null, description: description || null };

    if (btn) btn.disabled = true;
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
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteTransaction(id) {
    if (!await confirmModal('Видалити транзакцію?', { type: 'danger', okText: 'Видалити' })) return;
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
            <span class="fin-cat-icon">${escapeHtml(d.icon) || '📋'}</span>
            <span class="fin-cat-name">${escapeHtml(d.name)}</span>
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
            <td>${escapeHtml(t.categoryIcon) || ''} ${escapeHtml(t.categoryName) || '—'}</td>
            <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.description) || '—'}</td>
            <td class="fin-amount-${t.type}">${t.type === 'income' ? '+' : '-'}${formatMoney(t.amount)}</td>
            <td>${t.paymentMethod ? `<span class="fin-payment-badge">${PAYMENT_LABELS[t.paymentMethod] || escapeHtml(t.paymentMethod)}</span>` : '—'}</td>
            <td>${escapeHtml(t.createdBy) || '—'}</td>
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
            <td style="font-weight:600">${escapeHtml(s.name)}</td>
            <td>${DEPT_LABELS[s.department] || escapeHtml(s.department)}</td>
            <td>${escapeHtml(s.position)}</td>
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
    document.getElementById('transEditModal')?.classList.add('hidden');
    FinState.editingId = null;
}

function updateCategoryOptions(type) {
    const sel = document.getElementById('editCategory');
    const filtered = FinState.categories.filter(c => c.type === type);
    sel.innerHTML = '<option value="">Без категорії</option>' +
        filtered.map(c => `<option value="${c.id}">${escapeHtml(c.icon) || ''} ${escapeHtml(c.name)}</option>`).join('');
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
        FinState.categories.map(c => `<option value="${c.id}">${escapeHtml(c.icon) || ''} ${escapeHtml(c.name)}</option>`).join('');
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
    const tabs = ['tabDashboard','tabTransactions','tabMonthly','tabSalary','tabBudget',
                  'tabShift','tabForecast','tabPnl','tabDebts','tabAdvanced','tabAccounts','tabPersonal'];
    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const activePanel = document.getElementById({
        dashboard: 'tabDashboard', transactions: 'tabTransactions',
        monthly: 'tabMonthly', salary: 'tabSalary', budget: 'tabBudget',
        shift: 'tabShift', forecast: 'tabForecast', pnl: 'tabPnl',
        debts: 'tabDebts', advanced: 'tabAdvanced', accounts: 'tabAccounts',
        personal: 'tabPersonal'
    }[tabName]);
    if (activePanel) activePanel.style.display = '';

    // Load data for tab
    if (tabName === 'dashboard') fetchDashboard();
    if (tabName === 'transactions') fetchTransactions();
    if (tabName === 'monthly') fetchMonthlyReport();
    if (tabName === 'salary') fetchSalaryReport();
    if (tabName === 'budget') initBudgetTab();
    if (tabName === 'shift') loadShiftData();
    if (tabName === 'forecast') loadForecast();
    if (tabName === 'pnl') loadPnlReport();
    if (tabName === 'debts') loadDebts();
    if (tabName === 'advanced') loadAdvancedDashboard();
    if (tabName === 'accounts') loadAccounts();
    if (tabName === 'personal') loadPersonalAccounts();
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
        window.location.href = '/';
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    try {
        const user = await apiVerifyToken();
        if (!user) throw new Error('Invalid token');

        AppState.currentUser = user;
        const _userEl = document.getElementById('currentUser'); if (_userEl) _userEl.textContent = user.name || user.username;

        // Role-based visibility
        const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager'];
        if (MANAGE_ROLES.includes(user.role)) {
            const addBtn = document.getElementById('addTransactionBtn');
            if (addBtn) addBtn.style.display = '';
            const addExpBtn = document.getElementById('addExpenseBtn');
            if (addExpBtn) addExpBtn.style.display = '';
            const exportBtn = document.getElementById('exportCsvBtn');
            if (exportBtn) exportBtn.style.display = '';
            const xlsxBtn = document.getElementById('exportXlsxBtn');
            if (xlsxBtn) xlsxBtn.style.display = '';
        }
    } catch {
        window.location.href = '/';
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    if (typeof bindLogoutButton === 'function') bindLogoutButton();

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

    // v30.6: P&L year filter
    const pnlYear = document.getElementById('pnlYear');
    if (pnlYear) {
        const curYear = new Date().getFullYear();
        for (let y = curYear; y >= curYear - 5; y--) {
            pnlYear.innerHTML += `<option value="${y}">${y}</option>`;
        }
    }

    // Fetch initial data
    await fetchCategories();
    fetchDashboard();

    // Tab clicks
    document.querySelectorAll('.fin-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Add transaction button (income by default)
    document.getElementById('addTransactionBtn')?.addEventListener('click', () => openTransModal());

    // v33.3: Quick-add expense button
    document.getElementById('addExpenseBtn')?.addEventListener('click', () => {
        openTransModal();
        document.getElementById('editType').value = 'expense';
        updateCategoryOptions('expense');
    });

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

    // v30.6: Shift buttons
    document.getElementById('openShiftBtn')?.addEventListener('click', openShift);
    document.getElementById('closeShiftBtn')?.addEventListener('click', closeShift);

    // v30.6: Currency converter
    document.getElementById('convertCurrencyBtn')?.addEventListener('click', convertCurrency);
});

// ==========================================
// v30.6: CASH REGISTER SHIFTS
// ==========================================

async function loadShiftData() {
    try {
        const data = await apiRequest('GET', '/api/finance/shift/current');
        const container = document.getElementById('shiftStatus');
        if (!container) return;

        if (data.isOpen && data.shift) {
            const s = data.shift;
            container.innerHTML = `
                <div class="fin-stat-card" style="border-left:4px solid #10B981">
                    <div style="font-weight:800;color:#10B981;margin-bottom:8px">Зміна відкрита</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
                        <div>Каса на початок: <b>${formatMoney(s.openingCash)}</b></div>
                        <div>Готівка (дохід): <b style="color:#10B981">+${formatMoney(s.cashIncome)}</b></div>
                        <div>Готівка (витрати): <b style="color:#EF4444">-${formatMoney(s.cashExpense)}</b></div>
                        <div>Очікувана каса: <b style="color:#6366F1">${formatMoney(s.expectedCash)}</b></div>
                    </div>
                </div>
            `;
            document.getElementById('openShiftBtn').style.display = 'none';
            document.getElementById('closeShiftBtn').style.display = '';
            document.getElementById('closeShiftSection').style.display = '';
        } else {
            container.innerHTML = `
                <div class="fin-stat-card" style="border-left:4px solid #9CA3AF">
                    <div style="font-weight:800;color:#9CA3AF">Зміна закрита</div>
                    <div style="font-size:13px;margin-top:4px">Відкрийте нову зміну для обліку готівки</div>
                </div>
            `;
            document.getElementById('openShiftBtn').style.display = '';
            document.getElementById('closeShiftBtn').style.display = 'none';
            document.getElementById('closeShiftSection').style.display = 'none';
        }

        // Load history
        const history = await apiRequest('GET', '/api/finance/shift/history?limit=10');
        const tbody = document.getElementById('shiftHistoryBody');
        if (tbody && history.shifts) {
            tbody.innerHTML = history.shifts.map(s => {
                const diff = s.cash_difference;
                const diffColor = diff === 0 ? '#10B981' : (diff > 0 ? '#3B82F6' : '#EF4444');
                return `<tr>
                    <td>${s.opened_at ? new Date(s.opened_at).toLocaleString('uk-UA') : '—'}</td>
                    <td>${s.closed_at ? new Date(s.closed_at).toLocaleString('uk-UA') : '—'}</td>
                    <td>${formatMoney(s.opening_cash)}</td>
                    <td>${s.closing_cash !== null ? formatMoney(s.closing_cash) : '—'}</td>
                    <td>${s.expected_cash !== null ? formatMoney(s.expected_cash) : '—'}</td>
                    <td style="color:${diffColor};font-weight:700">${diff !== null ? (diff > 0 ? '+' : '') + formatMoney(diff) : '—'}</td>
                    <td><span class="fin-type-badge ${s.status === 'open' ? 'income' : 'expense'}">${s.status === 'open' ? 'Відкрита' : 'Закрита'}</span></td>
                </tr>`;
            }).join('');
        }
    } catch (err) {
        console.error('Failed to load shift data', err);
    }
}

async function openShift() {
    const cashInput = document.getElementById('openingCashInput');
    const openingCash = parseInt(cashInput?.value) || 0;
    try {
        await apiRequest('POST', '/api/finance/shift/open', { openingCash });
        showNotification('Зміну відкрито');
        if (cashInput) cashInput.value = '';
        loadShiftData();
    } catch (err) {
        showNotification(err.message || 'Помилка', 'error');
    }
}

async function closeShift() {
    const cashInput = document.getElementById('closingCashInput');
    const closingCash = parseInt(cashInput?.value);
    if (isNaN(closingCash) || closingCash < 0) {
        showNotification('Вкажіть суму готівки в касі', 'error');
        return;
    }
    try {
        const result = await apiRequest('POST', '/api/finance/shift/close', { closingCash });
        const s = result.summary;
        const diffAbs = Math.abs(s.difference);
        const diffSign = s.difference >= 0 ? '+' : '-';
        showNotification(`Зміну закрито. Різниця: ${diffSign}${formatMoney(diffAbs)}`);
        if (cashInput) cashInput.value = '';
        loadShiftData();
    } catch (err) {
        showNotification(err.message || 'Помилка', 'error');
    }
}

// ==========================================
// v30.6: REVENUE FORECAST
// ==========================================

async function loadForecast() {
    try {
        const days = document.getElementById('forecastDays')?.value || 30;
        const data = await apiRequest('GET', `/api/finance/forecast?days=${days}`);
        const container = document.getElementById('forecastContent');
        if (!container) return;

        let html = `<div class="fin-stats" style="margin-bottom:16px">
            <div class="fin-stat-card fin-stat-income">
                <div class="fin-stat-value">${formatMoney(data.totals.expectedRevenue)}</div>
                <div class="fin-stat-label">Прогноз доходу (${days} дн.)</div>
            </div>
            <div class="fin-stat-card fin-stat-bookings">
                <div class="fin-stat-value">${data.totals.bookingCount}</div>
                <div class="fin-stat-label">Підтверджених бронювань</div>
            </div>
            <div class="fin-stat-card fin-stat-profit">
                <div class="fin-stat-value">${data.totals.bookingCount > 0 ? formatMoney(Math.round(data.totals.expectedRevenue / data.totals.bookingCount)) : '0 ₴'}</div>
                <div class="fin-stat-label">Середній чек</div>
            </div>
        </div>`;

        // Weekly breakdown
        if (data.weekly && data.weekly.length > 0) {
            html += `<div class="fin-table-wrap"><table class="fin-monthly-table">
                <thead><tr><th style="text-align:left">Тиждень</th><th>Бронювань</th><th>Прогноз ₴</th></tr></thead>
                <tbody>${data.weekly.map(w => `<tr>
                    <td style="text-align:left">${formatDate(w.week_start)}</td>
                    <td>${w.booking_count}</td>
                    <td class="fin-amount-income">${formatMoney(w.expected_revenue)}</td>
                </tr>`).join('')}</tbody>
            </table></div>`;
        }

        // Historical pattern
        if (data.historicalAverage && data.historicalAverage.length > 0) {
            const DOW = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
            html += `<div style="margin-top:16px"><h4 style="font-weight:800;margin-bottom:8px">Середній дохід по днях тижня (останні 90 днів)</h4>
                <div class="fin-table-wrap"><table class="fin-monthly-table">
                <thead><tr><th style="text-align:left">День</th><th>Середній дохід</th><th>Середня к-сть</th></tr></thead>
                <tbody>${data.historicalAverage.map(h => `<tr>
                    <td style="text-align:left">${DOW[h.dow] || h.dow}</td>
                    <td class="fin-amount-income">${formatMoney(h.avg_revenue)}</td>
                    <td>${h.avg_count}</td>
                </tr>`).join('')}</tbody>
            </table></div></div>`;
        }

        container.innerHTML = html;
    } catch (err) {
        console.error('Failed to load forecast', err);
    }
}

// ==========================================
// v30.6: ENHANCED P&L REPORT
// ==========================================

async function loadPnlReport() {
    try {
        const year = document.getElementById('pnlYear')?.value || new Date().getFullYear();
        const month = document.getElementById('pnlMonth')?.value || '';
        let url = `/api/finance/report/pnl?year=${year}`;
        if (month) url += `&month=${month}`;

        const data = await apiRequest('GET', url);
        const container = document.getElementById('pnlContent');
        if (!container) return;

        const s = data.summary;
        const incChange = s.incomeChange;
        const expChange = s.expenseChange;

        let html = `<div class="fin-stats">
            <div class="fin-stat-card fin-stat-income">
                <div class="fin-stat-value">${formatMoney(s.totalIncome)}</div>
                <div class="fin-stat-label">Виручка ${incChange !== 0 ? `<span style="color:${incChange >= 0 ? '#10B981' : '#EF4444'}">(${incChange >= 0 ? '+' : ''}${incChange}%)</span>` : ''}</div>
            </div>
            <div class="fin-stat-card fin-stat-expense">
                <div class="fin-stat-value">${formatMoney(s.totalExpenses)}</div>
                <div class="fin-stat-label">Витрати ${expChange !== 0 ? `<span style="color:${expChange <= 0 ? '#10B981' : '#EF4444'}">(${expChange >= 0 ? '+' : ''}${expChange}%)</span>` : ''}</div>
            </div>
            <div class="fin-stat-card fin-stat-profit">
                <div class="fin-stat-value">${formatMoney(s.grossProfit)}</div>
                <div class="fin-stat-label">Чистий прибуток (маржа ${s.margin}%)</div>
            </div>
            <div class="fin-stat-card fin-stat-bookings">
                <div class="fin-stat-value">${formatMoney(data.bookingRevenue)}</div>
                <div class="fin-stat-label">Виручка з бронювань</div>
            </div>
        </div>`;

        // Revenue breakdown
        html += `<div class="fin-categories"><div class="fin-cat-section">
            <h4 style="color:#10B981">Доходи по статтях</h4>`;
        if (data.revenue.length > 0) {
            const maxInc = Math.max(...data.revenue.map(r => r.total), 1);
            html += data.revenue.map(r => `<div class="fin-cat-row">
                <span class="fin-cat-icon">${escapeHtml(r.icon) || '📋'}</span>
                <span class="fin-cat-name">${escapeHtml(r.name)}</span>
                <div class="fin-cat-bar"><div class="fin-cat-bar-fill" style="width:${Math.round(r.total / maxInc * 100)}%;background:#10B981"></div></div>
                <span class="fin-cat-amount" style="color:#10B981">${formatMoney(r.total)}</span>
            </div>`).join('');
        } else {
            html += '<div style="color:var(--gray-400);font-size:13px;padding:8px">Немає даних</div>';
        }
        html += '</div><div class="fin-cat-section"><h4 style="color:#EF4444">Витрати по статтях</h4>';
        if (data.expenses.length > 0) {
            const maxExp = Math.max(...data.expenses.map(r => r.total), 1);
            html += data.expenses.map(r => `<div class="fin-cat-row">
                <span class="fin-cat-icon">${escapeHtml(r.icon) || '📋'}</span>
                <span class="fin-cat-name">${escapeHtml(r.name)}</span>
                <div class="fin-cat-bar"><div class="fin-cat-bar-fill" style="width:${Math.round(r.total / maxExp * 100)}%;background:#EF4444"></div></div>
                <span class="fin-cat-amount" style="color:#EF4444">${formatMoney(r.total)}</span>
            </div>`).join('');
        } else {
            html += '<div style="color:var(--gray-400);font-size:13px;padding:8px">Немає даних</div>';
        }
        html += '</div></div>';

        // Previous period comparison
        html += `<div class="fin-chart"><h4>Порівняння з попереднім періодом</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
                <div><div style="font-size:12px;color:var(--gray-500)">Попередній дохід</div><div style="font-weight:800">${formatMoney(s.previousIncome)}</div></div>
                <div><div style="font-size:12px;color:var(--gray-500)">Попередні витрати</div><div style="font-weight:800">${formatMoney(s.previousExpenses)}</div></div>
                <div><div style="font-size:12px;color:var(--gray-500)">Попередній прибуток</div><div style="font-weight:800;color:${s.previousProfit >= 0 ? '#10B981' : '#EF4444'}">${formatMoney(s.previousProfit)}</div></div>
            </div>
        </div>`;

        container.innerHTML = html;
    } catch (err) {
        console.error('Failed to load P&L', err);
    }
}

// ==========================================
// v30.6: DEBTS
// ==========================================

async function loadDebts() {
    try {
        const data = await apiRequest('GET', '/api/finance/debts');
        const container = document.getElementById('debtsContent');
        if (!container) return;

        let html = `<div class="fin-stats" style="margin-bottom:16px">
            <div class="fin-stat-card fin-stat-expense">
                <div class="fin-stat-value">${formatMoney(data.totalDebt)}</div>
                <div class="fin-stat-label">Загальний борг</div>
            </div>
            <div class="fin-stat-card" style="border-left:3px solid #F59E0B">
                <div class="fin-stat-value" style="color:#F59E0B">${data.count}</div>
                <div class="fin-stat-label">Неоплачених бронювань</div>
            </div>
        </div>`;

        if (data.debts.length > 0) {
            html += `<div class="fin-table-wrap"><table class="fin-table">
                <thead><tr><th>Дата</th><th>Бронювання</th><th>Клієнт</th><th>Ціна</th><th>Сплачено</th><th>Борг</th><th>Дія</th></tr></thead>
                <tbody>${data.debts.map(d => `<tr>
                    <td>${formatDate(d.date)}</td>
                    <td>${escapeHtml(d.label || d.programName || d.bookingId)}</td>
                    <td>${escapeHtml(d.customerName || '—')}<br><small>${d.customerPhone || ''}</small></td>
                    <td>${formatMoney(d.price)}</td>
                    <td>${formatMoney(d.paidAmount || 0)}</td>
                    <td class="fin-amount-expense">${formatMoney(d.debtAmount)}</td>
                    <td><button onclick="markPaid('${d.bookingId}')" class="btn-page-primary" style="font-size:12px;padding:6px 12px;min-height:36px">Сплачено</button></td>
                </tr>`).join('')}</tbody>
            </table></div>`;
        } else {
            html += '<div style="text-align:center;color:var(--gray-400);padding:40px">Немає боргів</div>';
        }

        container.innerHTML = html;
    } catch (err) {
        console.error('Failed to load debts', err);
    }
}

window.markPaid = async function(bookingId) {
    try {
        await apiRequest('POST', `/api/finance/debts/${bookingId}/mark-paid`, {});
        showNotification('Оплату зараховано');
        loadDebts();
    } catch (err) {
        showNotification('Помилка оплати: ' + err.message, 'error');
    }
};

// ==========================================
// v30.6: ADVANCED DASHBOARD
// ==========================================

async function loadAdvancedDashboard() {
    try {
        const data = await apiRequest('GET', '/api/finance/advanced-dashboard');
        const container = document.getElementById('advancedContent');
        if (!container) return;

        const m = data.metrics;
        let html = `<div class="fin-stats">
            <div class="fin-stat-card fin-stat-income">
                <div class="fin-stat-value">${formatMoney(m.monthIncome)}</div>
                <div class="fin-stat-label">Дохід (цей місяць)</div>
            </div>
            <div class="fin-stat-card fin-stat-expense">
                <div class="fin-stat-value">${formatMoney(m.monthExpense)}</div>
                <div class="fin-stat-label">Витрати</div>
            </div>
            <div class="fin-stat-card fin-stat-profit">
                <div class="fin-stat-value">${formatMoney(m.monthProfit)}</div>
                <div class="fin-stat-label">Прибуток (маржа ${m.margin}%)</div>
            </div>
            <div class="fin-stat-card fin-stat-bookings">
                <div class="fin-stat-value">${formatMoney(m.avgBookingPrice)}</div>
                <div class="fin-stat-label">Середній чек (${m.bookingsCount} брон.)</div>
            </div>
        </div>`;

        // Debt alert
        if (data.debt && data.debt.total_debt > 0) {
            html += `<div class="fin-stat-card" style="border-left:4px solid #EF4444;margin-bottom:16px;text-align:left;padding:12px 16px">
                <span style="color:#EF4444;font-weight:800">Борги:</span> ${formatMoney(data.debt.total_debt)} (${data.debt.count} бронювань)
                <button onclick="switchTab('debts')" style="float:right;padding:4px 12px;background:#EF4444;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">Переглянути</button>
            </div>`;
        }

        // Revenue trend chart
        if (data.revenueTrend && data.revenueTrend.length > 0) {
            const maxTrend = Math.max(...data.revenueTrend.map(r => Math.max(r.income, r.expense)), 1);
            html += `<div class="fin-chart"><h4>Тренд доходів/витрат (6 місяців)</h4>
                <div class="fin-bar-chart">${data.revenueTrend.map(r => {
                    const incH = Math.max((r.income / maxTrend) * 140, 2);
                    const expH = Math.max((r.expense / maxTrend) * 140, 2);
                    return `<div class="fin-bar-group">
                        <div class="fin-bar-pair">
                            <div class="fin-bar income" style="height:${incH}px" title="Дохід: ${formatMoney(r.income)}"></div>
                            <div class="fin-bar expense" style="height:${expH}px" title="Витрати: ${formatMoney(r.expense)}"></div>
                        </div>
                        <div class="fin-bar-label">${r.month.substring(5)}</div>
                    </div>`;
                }).join('')}</div></div>`;
        }

        // Cash flow
        if (data.cashFlow && data.cashFlow.length > 0) {
            const maxFlow = Math.max(...data.cashFlow.map(r => Math.max(r.inflow, r.outflow)), 1);
            html += `<div class="fin-chart"><h4>Cash Flow (8 тижнів)</h4>
                <div class="fin-bar-chart">${data.cashFlow.map(r => {
                    const inH = Math.max((r.inflow / maxFlow) * 140, 2);
                    const outH = Math.max((r.outflow / maxFlow) * 140, 2);
                    const weekLabel = r.week ? new Date(r.week).toLocaleDateString('uk-UA', {day:'numeric',month:'short'}) : '';
                    return `<div class="fin-bar-group">
                        <div class="fin-bar-pair">
                            <div class="fin-bar income" style="height:${inH}px" title="Надходження: ${formatMoney(r.inflow)}"></div>
                            <div class="fin-bar expense" style="height:${outH}px" title="Відтік: ${formatMoney(r.outflow)}"></div>
                        </div>
                        <div class="fin-bar-label">${weekLabel}</div>
                    </div>`;
                }).join('')}</div></div>`;
        }

        // Top expenses + Payment distribution side by side
        html += '<div class="fin-categories">';

        // Top expenses
        html += '<div class="fin-cat-section"><h4 style="color:#EF4444">Топ-5 витрат (місяць)</h4>';
        if (data.topExpenses && data.topExpenses.length > 0) {
            html += data.topExpenses.map(e => `<div class="fin-cat-row">
                <span class="fin-cat-icon">${e.icon || '💰'}</span>
                <span class="fin-cat-name">${escapeHtml(e.description || e.category || '—')}</span>
                <span class="fin-cat-amount" style="color:#EF4444">${formatMoney(e.amount)}</span>
            </div>`).join('');
        } else {
            html += '<div style="color:var(--gray-400);font-size:13px;padding:8px">Немає даних</div>';
        }
        html += '</div>';

        // Payment distribution
        html += '<div class="fin-cat-section"><h4 style="color:#6366F1">Способи оплати</h4>';
        if (data.paymentDistribution && data.paymentDistribution.length > 0) {
            const maxPay = Math.max(...data.paymentDistribution.map(p => p.total), 1);
            html += data.paymentDistribution.map(p => `<div class="fin-cat-row">
                <span class="fin-cat-name">${PAYMENT_LABELS[p.payment_method] || p.payment_method}</span>
                <div class="fin-cat-bar"><div class="fin-cat-bar-fill" style="width:${Math.round(p.total / maxPay * 100)}%;background:#6366F1"></div></div>
                <span class="fin-cat-amount" style="color:#6366F1">${formatMoney(p.total)} (${p.count})</span>
            </div>`).join('');
        } else {
            html += '<div style="color:var(--gray-400);font-size:13px;padding:8px">Немає даних</div>';
        }
        html += '</div></div>';

        container.innerHTML = html;
    } catch (err) {
        console.error('Failed to load advanced dashboard', err);
    }
}

// ==========================================
// v30.6: CURRENCY CONVERTER
// ==========================================

async function convertCurrency() {
    const amount = parseFloat(document.getElementById('currencyAmount')?.value);
    const currency = document.getElementById('currencySelect')?.value || 'EUR';
    if (!amount || amount <= 0) {
        showNotification('Вкажіть суму', 'error');
        return;
    }
    try {
        const result = await apiRequest('POST', '/api/finance/currency/convert', { amount, currency });
        const el = document.getElementById('currencyResult');
        if (el) {
            el.innerHTML = `<div class="fin-stat-card" style="text-align:center;border-left:3px solid #10B981">
                <div style="font-size:24px;font-weight:900;color:#10B981">${formatMoney(result.converted.amount)}</div>
                <div style="font-size:13px;color:var(--gray-500)">${result.formatted} (курс: ${result.rate})</div>
            </div>`;
        }
    } catch (err) {
        showNotification(err.message || 'Помилка конвертації', 'error');
    }
}

// ==========================================
// FINANCE ACCOUNTS (v33.5)
// ==========================================

async function loadAccounts() {
    const container = document.getElementById('accountsList');
    if (!container) return;
    try {
        const data = await apiRequest('GET', '/api/finance/accounts');
        const accounts = data.accounts || [];
        if (!accounts.length) {
            container.innerHTML = '<p style="color:var(--gray-400);text-align:center;padding:24px">Рахунків ще немає</p>';
            return;
        }
        container.innerHTML = accounts.map(a => {
            const typeLabel = { cash: 'Готівка', card: 'Карта', bank: 'Банк' }[a.type] || a.type;
            return `<div class="fin-stat-card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;border-left:3px solid ${a.type === 'cash' ? '#10B981' : a.type === 'card' ? '#6366F1' : '#F59E0B'}">
                <span style="font-size:24px">${escapeHtml(a.emoji)}</span>
                <div style="flex:1">
                    <div style="font-weight:700">${escapeHtml(a.name)}</div>
                    <div style="font-size:12px;color:var(--gray-400)">${typeLabel}${a.description ? ' · ' + escapeHtml(a.description) : ''}</div>
                </div>
                <button class="btn-page-ghost" onclick="toggleAccount(${parseInt(a.id, 10)}, false)" title="Деактивувати" style="font-size:16px">🗑️</button>
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = '<p style="color:#EF4444;text-align:center">Помилка завантаження</p>';
    }
}

function openAddAccountModal() {
    document.getElementById('accName').value = '';
    document.getElementById('accEmoji').value = '💳';
    document.getElementById('accType').value = 'cash';
    document.getElementById('accDescription').value = '';
    document.getElementById('addAccountModal')?.classList.remove('hidden');
}

async function saveAccount() {
    const name = document.getElementById('accName')?.value?.trim();
    if (!name) { showNotification('Введи назву', 'error'); return; }
    try {
        await apiRequest('POST', '/api/finance/accounts', {
            name,
            emoji: document.getElementById('accEmoji')?.value || '💳',
            type: document.getElementById('accType')?.value,
            description: document.getElementById('accDescription')?.value?.trim() || null
        });
        document.getElementById('addAccountModal')?.classList.add('hidden');
        showNotification('Рахунок додано!');
        loadAccounts();
    } catch (err) {
        showNotification(err.message || 'Помилка', 'error');
    }
}

async function toggleAccount(id, active) {
    try {
        if (!active && !await confirmModal('Деактивувати рахунок?', { type: 'danger' })) return;
        await apiRequest('PATCH', `/api/finance/accounts/${id}`, { isActive: active });
        showNotification(active ? 'Рахунок активовано' : 'Рахунок деактивовано');
        loadAccounts();
    } catch (err) {
        showNotification(err.message || 'Помилка', 'error');
    }
}

// ==========================================
// PERSONAL ACCOUNTS (v37.9)
// ==========================================

async function loadPersonalAccounts() {
    const container = document.getElementById('personalAccountsList');
    if (!container) return;

    const tgId = AppState.currentUser?.telegram_chat_id;
    if (!tgId) {
        container.innerHTML = '<p style="opacity:.5;font-size:13px;grid-column:1/-1">Прив\'яжіть Telegram у профілі щоб бачити особисті рахунки</p>';
        return;
    }

    container.innerHTML = '<p style="opacity:.5;font-size:13px;grid-column:1/-1">Завантаження...</p>';

    try {
        const data = await apiRequest('GET', `/api/personal-accounts/my?telegram_id=${encodeURIComponent(tgId)}`);
        const accounts = data.accounts || [];

        if (!accounts.length) {
            container.innerHTML = '<p style="opacity:.5;font-size:13px;grid-column:1/-1">Ще немає особистих рахунків.<br>Створи через бота: /new_account Назва</p>';
            return;
        }

        container.innerHTML = accounts.map(a => `
            <div class="fin-personal-card" onclick="loadPersonalTx(${a.id}, '${escapeHtml(a.name)}')">
                <div style="font-size:28px;margin-bottom:8px">${escapeHtml(a.emoji || '💳')}</div>
                <div style="font-weight:700;font-size:14px">${escapeHtml(a.name)}</div>
                <div style="font-size:11px;color:var(--gray-400);margin-top:4px">
                    ${a.role === 'owner' ? '🔑 Власний' : '👥 Спільний доступ'}
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('loadPersonalAccounts error:', e);
        container.innerHTML = '<p style="opacity:.5;font-size:13px;grid-column:1/-1">Помилка завантаження</p>';
    }
}

async function loadPersonalTx(accountId, name) {
    const section = document.getElementById('personalTxSection');
    const titleEl = document.getElementById('personalTxTitle');
    const listEl  = document.getElementById('personalTxList');
    if (!section || !titleEl || !listEl) return;

    section.style.display = 'block';
    titleEl.textContent = `📋 ${name}`;
    listEl.innerHTML = '<p style="opacity:.5;font-size:13px">Завантаження...</p>';

    try {
        const data = await apiRequest('GET', `/api/personal-accounts/${accountId}/transactions`);
        const transactions = data.transactions || [];

        if (!transactions.length) {
            listEl.innerHTML = '<p style="opacity:.5;font-size:13px">Транзакцій ще немає</p>';
            return;
        }

        const inc = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const exp = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        listEl.innerHTML = `
            <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
                <div style="padding:8px 16px;background:#D1FAE5;border-radius:8px;font-size:13px">
                    💰 Дохід: <b>${inc.toLocaleString('uk-UA')} ₴</b>
                </div>
                <div style="padding:8px 16px;background:#FEE2E2;border-radius:8px;font-size:13px">
                    💸 Витрати: <b>${exp.toLocaleString('uk-UA')} ₴</b>
                </div>
            </div>
            <div class="fin-table-wrap">
            <table class="fin-table">
                <thead><tr>
                    <th>Дата</th><th>Тип</th><th>Сума</th><th>Опис</th><th>Категорія</th>
                </tr></thead>
                <tbody>
                ${transactions.map(t => `<tr>
                    <td>${new Date(t.date).toLocaleDateString('uk-UA')}</td>
                    <td>${t.type === 'income' ? '💰 Дохід' : '💸 Витрата'}</td>
                    <td><b>${t.amount.toLocaleString('uk-UA')} ₴</b></td>
                    <td>${escapeHtml(t.description || '—')}</td>
                    <td>${escapeHtml(t.category || '—')}</td>
                </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (e) {
        console.error('loadPersonalTx error:', e);
        listEl.innerHTML = '<p style="opacity:.5;font-size:13px">Помилка завантаження</p>';
    }
}
