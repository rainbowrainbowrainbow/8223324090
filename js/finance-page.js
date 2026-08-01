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
    salaryWorkspace: null,
    salaryMode: 'overview',
    selectedSalaryStaffId: null,
    creatingSalaryScheme: false,
    page: 1,
    totalPages: 1,
    editingId: null,
    currentTab: 'transactions',
    mode: 'overview',
    analyticsOverview: null,
    analyticsCharts: null,
    comparison: null,
    dealsLifecycle: null,
    unifiedLoaded: false
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

const SALARY_SCHEME_LABELS = {
    per_shift: 'Сума за вихід',
    hourly: 'Погодинна',
    monthly_fixed: 'Фікс за місяць',
    percent: 'Відсоток',
    hybrid: 'Гібридна',
    manual: 'Ручна'
};

const SALARY_SCHEME_DISPLAY_LABELS = {
    ...SALARY_SCHEME_LABELS,
    piece: 'За одиницю'
};

const SALARY_STATUS_LABELS = {
    draft: 'Чернетка',
    reviewed: 'Перевірено',
    approved: 'Затверджено',
    paid: 'Виплачено',
    legacy_accounted: 'Історично враховано',
    legacy_manual_salary_finance: 'Історична ручна зарплатна операція',
    legacy_zrs_voided: 'Історичний ЗРС скасовано',
    legacy_workflow: 'Історичний workflow',
    voided: 'Скасовано'
};

// ==========================================
// FORMATTING
// ==========================================

function formatMoney(amount) {
    if (!amount && amount !== 0) return '0 ₴';
    return (Number(amount) || 0).toLocaleString('uk-UA') + ' ₴';
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return dateStr;
}

function formatCompactMoney(amount) {
    const value = Number(amount) || 0;
    const abs = Math.abs(value);
    if (abs >= 1000000) return `${Math.round(value / 100000) / 10} млн ₴`;
    if (abs >= 1000) return `${Math.round(value / 100) / 10} тис ₴`;
    return `${value.toLocaleString('uk-UA')} ₴`;
}

function renderFinanceChartReadout(chartEl, chartId, items = []) {
    if (!chartEl) return;
    const container = chartEl.closest('.fin-chart') || chartEl.parentElement;
    if (!container) return;
    container.querySelector(`.fin-chart-readout[data-chart="${chartId}"]`)?.remove();
    const visibleItems = items.filter(Boolean);
    if (!visibleItems.length) return;
    const readout = document.createElement('div');
    readout.className = 'fin-chart-readout';
    readout.dataset.chart = chartId;
    readout.innerHTML = visibleItems.map(item => `
        <span class="fin-chart-readout-item">
            <b>${escapeHtml(item.label)}</b>
            <span>${escapeHtml(item.value)}</span>
        </span>
    `).join('');
    chartEl.insertAdjacentElement('afterend', readout);
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

function getAnalyticsParams() {
    const { from, to } = getFilterDates();
    return new URLSearchParams({ period: 'custom', from, to }).toString();
}

function getInitialFinanceMode() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode') || params.get('tab');
    if (mode === 'operations') return 'operations';
    if (mode === 'insights') return 'insights';
    return 'overview';
}

function getInitialFinanceTab() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const map = {
        dashboard: 'dashboard',
        transactions: 'transactions',
        operations: 'transactions',
        shift: 'shift',
        cash: 'shift',
        forecast: 'forecast',
        pnl: 'pnl',
        debts: 'debts',
        monthly: 'monthly',
        salary: 'salary',
        budget: 'budget',
        advanced: 'advanced',
        accounts: 'accounts',
        personal: 'personal'
    };
    return map[tab] || 'transactions';
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

async function fetchUnifiedOverview() {
    const { from, to } = getFilterDates();
    const analyticsParams = getAnalyticsParams();
    const [financeDashboard, analyticsOverview, analyticsCharts, comparison, lifecycle] = await Promise.allSettled([
        apiRequest('GET', `/api/finance/dashboard?from=${from}&to=${to}`),
        apiRequest('GET', `/api/analytics/overview?${analyticsParams}`),
        apiRequest('GET', `/api/analytics/charts?${analyticsParams}`),
        apiRequest('GET', `/api/analytics/comparison?${analyticsParams}`),
        apiRequest('GET', `/api/analytics/deals-lifecycle?${analyticsParams}`)
    ]);

    if (financeDashboard.status === 'fulfilled') FinState.dashboard = financeDashboard.value;
    else console.error('[finance:unified] finance dashboard failed', financeDashboard.reason);
    if (analyticsOverview.status === 'fulfilled') FinState.analyticsOverview = analyticsOverview.value;
    else console.error('[finance:unified] analytics overview failed', analyticsOverview.reason);
    if (analyticsCharts.status === 'fulfilled') FinState.analyticsCharts = analyticsCharts.value;
    else console.error('[finance:unified] analytics charts failed', analyticsCharts.reason);
    if (comparison.status === 'fulfilled') FinState.comparison = comparison.value;
    else console.error('[finance:unified] comparison failed', comparison.reason);
    if (lifecycle.status === 'fulfilled') FinState.dealsLifecycle = lifecycle.value;
    else console.error('[finance:unified] deals lifecycle failed', lifecycle.reason);

    FinState.unifiedLoaded = true;
    renderCurrentFinanceMode();
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
        const [report, workspace] = await Promise.all([
            apiRequest('GET', `/api/finance/report/salary?month=${month}`),
            apiRequest('GET', `/api/payroll/schemes?month=${month}`)
        ]);
        FinState.salaryReport = report;
        FinState.salaryWorkspace = {
            ...(workspace || {}),
            ...(report || {}),
            staff: report?.staff || workspace?.staff || [],
            schemes: workspace?.schemes || [],
            totals: report?.totals || workspace?.totals || {},
            month
        };
        const rows = FinState.salaryWorkspace.staff || [];
        if (!rows.some(row => String(row.staffId || row.id) === String(FinState.selectedSalaryStaffId))) {
            FinState.selectedSalaryStaffId = rows[0]?.staffId || rows[0]?.id || null;
        }
        renderSalaryWorkspace();
    } catch (err) {
        console.error('Failed to fetch salary report', err);
        showNotification('Не вдалося завантажити зарплати', 'error');
    }
}

async function saveTransaction() {
    if (!financeCanManageTransactions()) {
        showNotification('Недостатньо прав для керування фінансовими транзакціями', 'error');
        return;
    }
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
        await closeTransModal(true);
        refreshData();
    } catch (err) {
        showNotification('Помилка збереження', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteTransaction(id) {
    if (!financeCanManageTransactions()) {
        showNotification('Недостатньо прав для керування фінансовими транзакціями', 'error');
        return;
    }
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
        renderFinanceChartReadout(el, 'dailyFinanceLegacy', []);
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
    renderFinanceChartReadout(el, 'dailyFinanceLegacy', daily.map(d => ({
        label: String(d.date || '').substring(5, 10),
        value: `+${formatCompactMoney(d.income)} / -${formatCompactMoney(d.expense)}`
    })));
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
// RENDERING — UNIFIED FINANCE + ANALYTICS
// ==========================================

function financeMetricParts() {
    const analytics = FinState.analyticsOverview || {};
    const dashboard = FinState.dashboard || {};
    const bookings = analytics.bookings || {};
    const finance = analytics.finance || dashboard.totals || {};
    const customers = analytics.customers || {};
    const hr = analytics.hr || {};
    const totals = dashboard.totals || {};
    const income = Number(finance.income ?? totals.income ?? 0);
    const expense = Number(finance.expense ?? totals.expense ?? 0);
    const profit = Number(finance.profit ?? totals.profit ?? (income - expense));
    const margin = income > 0 ? Math.round((profit / income) * 100) : 0;
    return { bookings, finance, customers, hr, income, expense, profit, margin };
}

function renderExecutiveCards() {
    const el = document.getElementById('faExecutiveZone');
    if (!el) return;
    const { bookings, customers, hr, income, expense, profit, margin } = financeMetricParts();
    const bookingRevenue = Number(bookings.revenue ?? FinState.dashboard?.bookingRevenue?.revenue ?? 0);
    const bookingCount = Number(bookings.total ?? FinState.dashboard?.bookingRevenue?.count ?? 0);
    const avgCheck = Number(bookings.avgCheck ?? (bookingCount ? bookingRevenue / bookingCount : 0));
    const riskTone = profit < 0 ? 'red' : margin < 15 ? 'orange' : 'green';
    const riskCopy = profit < 0
        ? 'Кеш gap: витрати вищі за доходи'
        : margin < 15
            ? 'Маржа потребує уваги'
            : 'Маржа в робочому коридорі';
    el.innerHTML = `
        <article class="fa-exec-card green">
            <div class="fa-exec-label">Виручка бронювань</div>
            <div class="fa-exec-value">${formatMoney(bookingRevenue)}</div>
            <div class="fa-exec-meta">${bookingCount || 0} бронювань за період</div>
        </article>
        <article class="fa-exec-card orange">
            <div class="fa-exec-label">Доходи / витрати / прибуток</div>
            <div class="fa-exec-value">${formatMoney(income)} / ${formatMoney(expense)}</div>
            <div class="fa-exec-meta">Прибуток: ${formatMoney(profit)}</div>
        </article>
        <article class="fa-exec-card blue">
            <div class="fa-exec-label">Бронювання + середній чек</div>
            <div class="fa-exec-value">${bookingCount || 0} · ${formatMoney(avgCheck)}</div>
            <div class="fa-exec-meta">${bookings.confirmed || 0} підтверджені / ${bookings.preliminary || 0} попередні</div>
        </article>
        <article class="fa-exec-card purple">
            <div class="fa-exec-label">Нові клієнти</div>
            <div class="fa-exec-value">${customers.newCustomers || 0}</div>
            <div class="fa-exec-meta">Попередній період: ${customers.prevNew || 0}</div>
        </article>
        <article class="fa-exec-card blue">
            <div class="fa-exec-label">HR: години / штат</div>
            <div class="fa-exec-value">${hr.totalHours || 0} год / ${hr.activeStaff || 0}</div>
            <div class="fa-exec-meta">Операційне навантаження команди</div>
        </article>
        <article class="fa-exec-card ${riskTone}">
            <div class="fa-exec-label">Ризик / маржа</div>
            <div class="fa-exec-value">${margin}%</div>
            <div class="fa-exec-meta">${riskCopy}</div>
        </article>
    `;
}

function renderActionRail() {
    const el = document.getElementById('faActionRail');
    if (!el) return;
    const actions = [
        ['transactions', 'Відкрити транзакції', 'Операційний рух коштів за період'],
        ['debts', 'Подивитись борги', 'Контроль несплат і касових ризиків'],
        ['salary', 'Перевірити зарплати', 'Payroll, схеми та звіти команди'],
        ['accounts', 'Рахунки та каса', 'Баланс рахунків і касові операції'],
        ['insights', 'Клієнтські сегменти', 'Перейти до insight-аналітики']
    ];
    el.innerHTML = actions.map(([target, title, meta]) => `
        <button type="button" class="fa-action-card" data-fa-action="${target}">
            <span class="fa-action-title">${title}</span>
            <span class="fa-action-meta">${meta}</span>
        </button>
    `).join('');
}

function renderOverviewWorkspace() {
    const el = document.getElementById('faWorkspace');
    if (!el) return;
    el.innerHTML = `
        <div class="fa-panel-grid">
            <section class="an-chart-container">
                <h3 class="an-chart-title">Доходи бронювань по днях</h3>
                <div id="dailyBookingsChart" class="an-bar-chart"></div>
                <div class="an-legend">
                    <span class="an-legend-item"><span class="an-legend-dot an-legend-dot--success"></span>Виручка</span>
                    <span class="an-legend-item"><span class="an-legend-dot an-legend-dot--info"></span>Бронювання</span>
                </div>
            </section>
            <section class="an-chart-container">
                <h3 class="an-chart-title">Фінансові потоки по днях</h3>
                <div id="dailyFinanceChart" class="an-bar-chart"></div>
                <div class="an-legend">
                    <span class="an-legend-item"><span class="an-legend-dot an-legend-dot--success"></span>Дохід</span>
                    <span class="an-legend-item"><span class="an-legend-dot an-legend-dot--danger"></span>Витрата</span>
                </div>
            </section>
        </div>
        <div class="fa-panel-grid">
            <section class="an-chart-container">
                <h3 class="an-chart-title">Топ програм за виручкою</h3>
                <div id="topProgramsChart"></div>
            </section>
            <section class="an-chart-container">
                <h3 class="an-chart-title">Фінансові категорії</h3>
                <div id="finCatsChart"></div>
            </section>
        </div>
    `;
    const widgets = window.CrmAnalyticsWidgets || {};
    const charts = FinState.analyticsCharts || {};
    widgets.renderDailyBookingsChart?.(charts.dailyBookings || []);
    widgets.renderDailyFinanceChart?.(charts.dailyFinance || []);
    widgets.renderTopPrograms?.(charts.topPrograms || []);
    widgets.renderFinCategories?.(charts.financeCategories || []);
}

function renderInsightsWorkspace() {
    const el = document.getElementById('faWorkspace');
    if (!el) return;
    el.innerHTML = `
        <section class="an-section">
            <h3 class="an-section-title">Порівняння та lifecycle</h3>
            <div class="fa-panel-grid">
                <div id="comparisonContent"></div>
                <div id="dealsLifecycleContent"></div>
            </div>
        </section>
        <section class="an-section">
            <h3 class="an-section-title">Операційні патерни</h3>
            <div class="fa-panel-grid">
                <section class="an-chart-container">
                    <h3 class="an-chart-title">Навантаження по днях тижня</h3>
                    <div id="weekdayChart"></div>
                </section>
                <section class="an-chart-container">
                    <h3 class="an-chart-title">Сегменти клієнтів</h3>
                    <div id="segmentsChart"></div>
                </section>
            </div>
        </section>
    `;
    const widgets = window.CrmAnalyticsWidgets || {};
    const charts = FinState.analyticsCharts || {};
    widgets.renderComparison?.(FinState.comparison);
    widgets.renderDealsLifecycle?.(FinState.dealsLifecycle);
    widgets.renderWeekdayChart?.(charts.weekdayLoad || []);
    widgets.renderSegments?.(charts.customerSegments || {});
}

function renderCurrentFinanceMode() {
    if (FinState.mode === 'operations') return;
    renderExecutiveCards();
    renderActionRail();
    if (FinState.mode === 'insights') renderInsightsWorkspace();
    else renderOverviewWorkspace();
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

    const canManageTransactions = financeCanManageTransactions();
    tbody.innerHTML = FinState.transactions.map(t => `
        <tr${canManageTransactions ? ` onclick="editTransaction(${t.id})" title="Натисніть для редагування"` : ''}>
            <td>${formatDate(t.date)}</td>
            <td><span class="fin-type-badge ${t.type}">${t.type === 'income' ? 'Дохід' : 'Витрата'}</span></td>
            <td>${escapeHtml(t.categoryIcon) || ''} ${escapeHtml(t.categoryName) || '—'}</td>
            <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.description) || '—'}${t.payrollHistoricalClassification ? `<br><small>${escapeHtml(SALARY_STATUS_LABELS[t.payrollHistoricalClassification] || t.payrollHistoricalClassification)} · ${escapeHtml(t.payrollHistoricalMessage || '')}</small>` : ''}</td>
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
        renderFinanceChartReadout(el, 'monthlyFinance', []);
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
    renderFinanceChartReadout(el, 'monthlyFinance', months.map((m, i) => ({
        label: SHORT_MONTHS[i] || m.monthName || String(i + 1),
        value: `+${formatCompactMoney(m.income)} / -${formatCompactMoney(m.expense)}`
    })));
}

// ==========================================
// RENDERING — SALARY REPORT
// ==========================================

function renderSalaryReport(data) {
    renderSalaryReportTable(data || FinState.salaryWorkspace);
}

function getSalaryRows() {
    return FinState.salaryWorkspace?.staff || FinState.salaryReport?.staff || [];
}

function getSelectedSalaryRow() {
    const rows = getSalaryRows();
    return rows.find(row => String(row.staffId || row.id) === String(FinState.selectedSalaryStaffId)) || rows[0] || null;
}

function getSalarySchemes() {
    return FinState.salaryWorkspace?.schemes || [];
}

function getEditableSchemeForRow(row) {
    if (!row) return null;
    const schemes = getSalarySchemes();
    return schemes.find(s => String(s.id) === String(row.schemeId)) || null;
}

function salaryNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function salarySchemePill(type) {
    const schemeType = type || 'hourly';
    return `<span class="salary-pill ${schemeType}">${SALARY_SCHEME_DISPLAY_LABELS[schemeType] || schemeType}</span>`;
}

function salaryStatusPill(status) {
    const value = status || 'draft';
    return `<span class="salary-status ${value}">${SALARY_STATUS_LABELS[value] || value}</span>`;
}

function financeCanUsePayrollAction(action) {
    if (typeof canUseAction === 'function') return canUseAction(action) === true;
    if (typeof canAccess === 'function') return canAccess(action) === true;
    return false;
}

function financeCanManageTransactions() {
    return financeCanUsePayrollAction('finance.manage');
}

const PAYROLL_INSTALLMENT_KIND_LABELS = {
    advance: 'Аванс',
    final: 'Фінальна зарплата'
};

const PAYROLL_INSTALLMENT_STATUS_LABELS = {
    draft: 'Чернетка',
    approved: 'Погоджено',
    due: 'До сплати',
    overdue: 'Прострочено',
    partially_paid: 'Частково виплачено',
    paid: 'Виплачено',
    overpaid: 'Переплата',
    reversed: 'Сторновано',
    not_due: 'Ще не час',
    conflict: 'Конфлікт',
    error: 'Помилка',
    view_only: 'Тільки перегляд'
};

const PAYROLL_BLOCKER_MESSAGES = {
    PAYROLL_LEAVE_POLICY_UNDEFINED: 'Для відпустки, лікарняного, вихідного або неоплачуваного дня потрібно явно вказати payroll policy. Погодження заблоковано без правила оплати.',
    PAYROLL_LEAVE_POLICY_UNSUPPORTED: 'Вказана payroll policy для відсутності не підтримується canonical payroll calculator. Погодження заблоковано.',
    PAYROLL_ATTENDANCE_OPEN: 'Є незакритий запис відвідування. Погодження payroll можливе тільки після закриття табеля.',
    PAYROLL_MONTHLY_NORM_REQUIRED: 'Не визначена місячна норма для розрахунку зарплати. Погодження заблоковано.',
    PAYROLL_ADVANCE_PLANNED_NORM_REQUIRED: 'Не визначена планова норма для авансу. Погодження заблоковано.'
};

function payrollBlockerMessage(issue = {}) {
    const code = String(issue.code || '').trim();
    return PAYROLL_BLOCKER_MESSAGES[code] || issue.message || 'Payroll потребує перевірки перед погодженням.';
}

function payrollDateValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    try {
        return new Date(value).toISOString().slice(0, 10);
    } catch (err) {
        return '';
    }
}

function payrollNextMonthStart(value) {
    const date = payrollDateValue(value);
    const match = date.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (!match) return '';
    return new Date(Date.UTC(Number(match[1]), Number(match[2]), 1)).toISOString().slice(0, 10);
}

function payrollDisplayDate(value) {
    const date = payrollDateValue(value);
    return date ? formatDate(date) : '—';
}

function payrollDisplayDateTime(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return payrollDisplayDate(value);
    return parsed.toLocaleString('uk-UA', {
        dateStyle: 'short',
        timeStyle: 'short'
    });
}

function salaryInstallments(row = {}) {
    const installments = row.installments
        || row.payrollInstallments
        || row.payroll_installments
        || row.payrollSettlement?.installments
        || row.payroll_settlement?.installments
        || row.settlementModel?.installments
        || row.settlement_model?.installments
        || [];
    return Array.isArray(installments) ? installments : [];
}

function salaryInstallmentMovements(installment = {}) {
    const movements = installment.movements
        || installment.paymentMovements
        || installment.payment_movements
        || [];
    return Array.isArray(movements) ? movements : [];
}

function payrollAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
}

function nullablePayrollAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
}

function formatPayrollFactAmount(value) {
    const amount = nullablePayrollAmount(value);
    return amount === null ? '—' : formatMoney(amount);
}

function payrollRowPaidAmount(row = {}) {
    const direct = nullablePayrollAmount(row.paidAmount ?? row.paid_amount);
    if (direct !== null) return direct;
    const installments = salaryInstallments(row);
    return installments.length
        ? installments.reduce((sum, installment) => sum + payrollAmount(installment.paidAmount ?? installment.paid_amount), 0)
        : null;
}

function payrollRowBalanceAmount(row = {}) {
    const direct = nullablePayrollAmount(
        row.balanceAmount ?? row.balance_amount ?? row.outstandingAmount ?? row.outstanding_amount
    );
    if (direct !== null) return direct;
    const installments = salaryInstallments(row);
    return installments.length
        ? installments.reduce((sum, installment) => sum + payrollAmount(installment.outstandingAmount ?? installment.outstanding_amount ?? installment.balanceAmount ?? installment.balance_amount), 0)
        : null;
}

function payrollRowDisplayStatus(row = {}) {
    return row.payrollSettlement?.legacy?.historicalStatus
        || row.payroll_settlement?.legacy?.historicalStatus
        || row.status
        || 'draft';
}

function payrollInstallmentTone(status) {
    if (['paid', 'not_due'].includes(status)) return 'is-positive';
    if (['overdue', 'partially_paid'].includes(status)) return 'is-warning';
    if (['overpaid', 'reversed', 'conflict', 'error'].includes(status)) return 'is-negative';
    return 'is-neutral';
}

function payrollInstallmentBlockers(installment = {}) {
    const direct = Array.isArray(installment.blockers) ? installment.blockers : [];
    const blocking = Array.isArray(installment.blockingIssues) ? installment.blockingIssues : [];
    const payroll = Array.isArray(installment.payrollBlockingIssues) ? installment.payrollBlockingIssues : [];
    const snapshot = installment.calculationSnapshot || installment.calculation_snapshot || {};
    const snapshotBlockers = Array.isArray(snapshot.blockers) ? snapshot.blockers : [];
    return [...direct, ...blocking, ...payroll, ...snapshotBlockers];
}

function renderPayrollInstallmentBlockers(installment = {}) {
    const blockers = payrollInstallmentBlockers(installment);
    if (!blockers.length) return '';
    return `<div class="salary-additional-warning" role="alert">
        ${blockers.map(issue => `<div><code>${escapeHtml(issue.code || 'PAYROLL_BLOCKED')}</code> — ${escapeHtml(payrollBlockerMessage(issue))}</div>`).join('')}
    </div>`;
}

function payrollBusinessContext() {
    return FinState.salaryWorkspace?.businessContext
        || FinState.salaryReport?.businessContext
        || FinState.currentBusinessContext
        || 'event_genix';
}

function payrollApiUrl(url, businessContext = payrollBusinessContext()) {
    if (!businessContext) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}businessContext=${encodeURIComponent(businessContext)}`;
}

function payrollIdempotencyKey(prefix, id) {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${id}-${globalThis.crypto.randomUUID()}`;
    return `${prefix}-${id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function payrollApiRequest(method, url, body, headers = {}) {
    const token = localStorage.getItem('pzp_token');
    const requestHeaders = { ...headers };
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    if (body) requestHeaders['Content-Type'] = 'application/json';
    const res = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        localStorage.removeItem('pzp_token');
        window.location.href = '/';
        return null;
    }
    if (!res.ok || data?.success === false) {
        const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = data?.code;
        throw err;
    }
    return data;
}

async function fetchPayrollPaymentOptions() {
    return payrollApiRequest('GET', payrollApiUrl('/api/payroll/payment-options'));
}

function payrollOptionList(items = []) {
    return (Array.isArray(items) ? items : []).map(item => {
        const id = item.id ?? item.value ?? '';
        const label = item.name || item.title || item.label || item.code || id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
    }).join('');
}

function openPayrollDialog({ title, fields }) {
    return new Promise(resolve => {
        document.getElementById('salaryPayrollActionModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'salaryPayrollActionModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content modal-medium" role="dialog" aria-modal="true" aria-labelledby="salaryPayrollActionTitle">
                <button type="button" class="modal-close" data-payroll-dialog-cancel aria-label="Закрити">×</button>
                <h3 id="salaryPayrollActionTitle">${escapeHtml(title)}</h3>
                <form class="salary-payroll-dialog-form">
                    <div class="salary-form-grid">
                        ${fields.map(field => {
                            const required = field.required ? 'required' : '';
                            const value = field.value ?? '';
                            if (field.type === 'select') {
                                return `<div><label>${escapeHtml(field.label)}</label><select name="${escapeHtml(field.name)}" ${required}>${field.options || ''}</select></div>`;
                            }
                            if (field.type === 'textarea') {
                                return `<div><label>${escapeHtml(field.label)}</label><textarea name="${escapeHtml(field.name)}" ${required}>${escapeHtml(value)}</textarea></div>`;
                            }
                            return `<div><label>${escapeHtml(field.label)}</label><input type="${escapeHtml(field.type || 'text')}" name="${escapeHtml(field.name)}" value="${escapeHtml(value)}" ${required}></div>`;
                        }).join('')}
                    </div>
                    <div class="salary-actions">
                        <button type="button" class="btn-page-secondary" data-payroll-dialog-cancel>Скасувати</button>
                        <button type="submit" class="btn-page-primary">Підтвердити</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);
        const close = value => {
            modal.remove();
            resolve(value);
        };
        modal.querySelectorAll('[data-payroll-dialog-cancel]').forEach(btn => {
            btn.addEventListener('click', () => close(null));
        });
        modal.addEventListener('click', event => {
            if (event.target === modal) close(null);
        });
        modal.querySelector('form')?.addEventListener('submit', event => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(event.currentTarget).entries());
            close(data);
        });
        modal.querySelector('input,select,textarea')?.focus();
    });
}

async function approveFinancePayrollInstallment(installmentId) {
    await payrollApiRequest('POST', payrollApiUrl(`/api/payroll/installments/${installmentId}/approve`), {});
    showNotification('Payroll installment погоджено');
}

async function cancelFinancePayrollAdvance(installmentId) {
    const values = await openPayrollDialog({
        title: 'Скасувати аванс',
        fields: [
            { name: 'reason', label: 'Причина', type: 'textarea', value: '', required: true }
        ]
    });
    if (!values) return;
    await payrollApiRequest('POST', `/api/payroll/installments/${installmentId}/cancel`, {
        reason: values.reason
    });
    showNotification('Аванс скасовано; final перераховано як повний місячний net');
}

async function updateFinancePayrollSchedule(installmentId, currentDate) {
    const values = await openPayrollDialog({
        title: 'Змінити планову дату виплати',
        fields: [
            { name: 'scheduledPaymentDate', label: 'Планова дата', type: 'date', value: payrollDateValue(currentDate), required: true },
            { name: 'reason', label: 'Причина / аудит', type: 'textarea', value: '' }
        ]
    });
    if (!values) return;
    await payrollApiRequest('PATCH', `/api/payroll/installments/${installmentId}/schedule`, {
        scheduledPaymentDate: values.scheduledPaymentDate,
        reason: values.reason || ''
    });
    showNotification('Планову дату оновлено');
}

async function confirmFinancePayrollPayment(installmentId, defaultAmount) {
    const options = await fetchPayrollPaymentOptions();
    const expenseCategories = options?.categories?.expense || [];
    const accounts = options?.accounts || [];
    const paymentMethods = options?.paymentMethods || ['cash', 'card', 'transfer', 'mixed'];
    const values = await openPayrollDialog({
        title: 'Підтвердити payroll виплату',
        fields: [
            { name: 'actualPaymentDate', label: 'Фактична дата', type: 'date', value: payrollDateValue(new Date()), required: true },
            { name: 'amount', label: 'Сума', type: 'number', value: defaultAmount || 0, required: true },
            { name: 'accountId', label: 'Рахунок', type: 'select', options: payrollOptionList(accounts), required: true },
            { name: 'paymentMethod', label: 'Спосіб оплати', type: 'select', options: paymentMethods.map(method => `<option value="${escapeHtml(method)}">${escapeHtml(PAYMENT_LABELS[method] || method)}</option>`).join(''), required: true },
            { name: 'categoryId', label: 'Категорія витрати', type: 'select', options: payrollOptionList(expenseCategories), required: true },
            { name: 'businessContext', label: 'Business context', type: 'text', value: options?.businessContext || payrollBusinessContext(), required: true },
            { name: 'reason', label: 'Коментар', type: 'textarea', value: 'Payroll payment' }
        ]
    });
    if (!values) return;
    await payrollApiRequest('POST', payrollApiUrl(`/api/payroll/installments/${installmentId}/payments/confirm`, values.businessContext), {
        amount: values.amount,
        actualPaymentDate: values.actualPaymentDate,
        accountId: values.accountId,
        paymentMethod: values.paymentMethod,
        categoryId: values.categoryId,
        businessContext: values.businessContext,
        reason: values.reason || 'Payroll payment',
        description: values.reason || 'Payroll payment'
    }, { 'Idempotency-Key': payrollIdempotencyKey('payroll-confirm', installmentId) });
    showNotification('Виплату підтверджено');
}

async function reverseFinancePayrollPayment(movementId, defaultAmount) {
    const options = await fetchPayrollPaymentOptions();
    const incomeCategories = options?.categories?.income || [];
    const accounts = options?.accounts || [];
    const paymentMethods = options?.paymentMethods || ['cash', 'card', 'transfer', 'mixed'];
    const values = await openPayrollDialog({
        title: 'Сторнувати payroll виплату',
        fields: [
            { name: 'actualPaymentDate', label: 'Дата сторно', type: 'date', value: payrollDateValue(new Date()), required: true },
            { name: 'amount', label: 'Сума сторно', type: 'number', value: defaultAmount || 0, required: true },
            { name: 'accountId', label: 'Рахунок', type: 'select', options: payrollOptionList(accounts), required: true },
            { name: 'paymentMethod', label: 'Спосіб оплати', type: 'select', options: paymentMethods.map(method => `<option value="${escapeHtml(method)}">${escapeHtml(PAYMENT_LABELS[method] || method)}</option>`).join(''), required: true },
            { name: 'categoryId', label: 'Категорія повернення', type: 'select', options: payrollOptionList(incomeCategories), required: true },
            { name: 'businessContext', label: 'Business context', type: 'text', value: options?.businessContext || payrollBusinessContext(), required: true },
            { name: 'reason', label: 'Причина', type: 'textarea', value: '', required: true }
        ]
    });
    if (!values) return;
    await payrollApiRequest('POST', payrollApiUrl(`/api/payroll/payments/${movementId}/reverse`, values.businessContext), {
        amount: values.amount,
        actualPaymentDate: values.actualPaymentDate,
        accountId: values.accountId,
        paymentMethod: values.paymentMethod,
        categoryId: values.categoryId,
        businessContext: values.businessContext,
        reason: values.reason,
        description: values.reason
    }, { 'Idempotency-Key': payrollIdempotencyKey('payroll-reverse', movementId) });
    showNotification('Сторно створено');
}

async function handleFinancePayrollAction(button) {
    const action = button?.dataset?.payrollAction;
    if (!action) return;
    const installmentId = button.dataset.installmentId;
    const movementId = button.dataset.movementId;
    const amount = payrollAmount(button.dataset.amount);
    const currentDate = button.dataset.currentDate || '';
    button.disabled = true;
    try {
        if (action === 'approve') await approveFinancePayrollInstallment(installmentId);
        if (action === 'cancel') await cancelFinancePayrollAdvance(installmentId);
        if (action === 'schedule') await updateFinancePayrollSchedule(installmentId, currentDate);
        if (action === 'confirm') await confirmFinancePayrollPayment(installmentId, amount);
        if (action === 'reverse') await reverseFinancePayrollPayment(movementId, amount);
        await fetchSalaryReport();
    } catch (err) {
        const suffix = err?.status === 409 ? ' (конфлікт/ідемпотентність)' : '';
        showNotification(`${err.message || 'Payroll дія не виконана'}${suffix}`, 'error');
    } finally {
        button.disabled = false;
    }
}

function renderFinancePayrollInstallmentActions(installment = {}) {
    const id = installment.id;
    if (!id) return '';
    const status = installment.settlementStatus || installment.workflowStatus || installment.workflow_status || 'draft';
    const balance = payrollAmount(installment.outstandingAmount ?? installment.outstanding_amount ?? installment.balanceAmount ?? installment.balance_amount);
    const blockers = payrollInstallmentBlockers(installment);
    const blockerTitle = blockers.length ? blockers.map(payrollBlockerMessage).join(' ') : '';
    const buttons = [];
    if (financeCanUsePayrollAction('manage_payroll_accrual') && status === 'draft') {
        buttons.push(`<button type="button" class="salary-payroll-action" data-payroll-action="schedule" data-installment-id="${Number(id)}" data-current-date="${escapeHtml(installment.scheduledPaymentDate || '')}">Планова дата</button>`);
    }
    if (financeCanUsePayrollAction('approve_payroll_installment') && status === 'draft') {
        buttons.push(`<button type="button" class="salary-payroll-action" data-payroll-action="approve" data-installment-id="${Number(id)}" ${blockers.length ? `disabled title="${escapeHtml(blockerTitle)}" aria-disabled="true"` : ''}>Погодити</button>`);
        if (installment.kind === 'advance') {
            buttons.push(`<button type="button" class="salary-payroll-action is-danger" data-payroll-action="cancel" data-installment-id="${Number(id)}">Скасувати аванс</button>`);
        }
    }
    if (financeCanUsePayrollAction('confirm_payroll_payment') && balance > 0 && !['draft', 'reversed'].includes(status)) {
        buttons.push(`<button type="button" class="salary-payroll-action is-primary" data-payroll-action="confirm" data-installment-id="${Number(id)}" data-amount="${balance}">Підтвердити виплату</button>`);
    }
    return buttons.length ? `<div class="salary-payroll-actions">${buttons.join('')}</div>` : '';
}

function renderFinancePayrollMovements(installment = {}) {
    const movements = salaryInstallmentMovements(installment);
    if (!movements.length) return '<div class="salary-muted">Фактичних виплат ще немає.</div>';
    return `<div class="salary-payroll-movements">${movements.map(movement => {
        const isPayment = (movement.type || movement.movementType || movement.movement_type) === 'payment';
        const amount = payrollAmount(movement.amount);
        const actor = movement.actorUsername || movement.actor_username || movement.actor || '—';
        const role = movement.actorRole || movement.actor_role || '';
        const recordedAt = movement.createdAt || movement.created_at;
        return `<div class="salary-payroll-movement ${isPayment ? '' : 'is-reversal'}">
            <div><strong>${escapeHtml(isPayment ? 'Оплата' : 'Сторно')} · ${formatMoney(amount)}</strong><span>${payrollDisplayDate(movement.actualPaymentDate || movement.actual_payment_date)} · зафіксовано ${payrollDisplayDateTime(recordedAt)} · ${escapeHtml(actor)}${role ? ` (${escapeHtml(role)})` : ''}</span></div>
            <small>${escapeHtml(movement.reason || '')}${movement.financeTransactionId || movement.finance_transaction_id ? ` · Finance #${escapeHtml(movement.financeTransactionId || movement.finance_transaction_id)}` : ''}</small>
            ${isPayment && financeCanUsePayrollAction('reverse_payroll_payment') ? `<button type="button" class="salary-payroll-action is-danger" data-payroll-action="reverse" data-movement-id="${Number(movement.id)}" data-amount="${amount}">Сторнувати</button>` : ''}
        </div>`;
    }).join('')}</div>`;
}

function renderFinancePayrollInstallments(row = {}) {
    const installments = salaryInstallments(row);
    if (!installments.length) {
        const reportId = row.reportId ?? row.payroll_report_id ?? null;
        if (!reportId) {
            return '<div class="salary-payroll-installments is-legacy"><div class="salary-muted">Нарахування за цей місяць ще не створено.</div></div>';
        }
        const legacy = row.payrollSettlement?.legacy || row.payroll_settlement?.legacy || null;
        const message = legacy?.message
            || (legacy?.historicalStatus === 'legacy_accounted'
                ? 'Історично враховано; факт виплати користувачем не підтверджено'
                : `Історичний статус: ${legacy?.historicalStatus || legacy?.reportStatus || row.status || 'невідомий'}. Факт виплати не підтверджено.`);
        return `<div class="salary-payroll-installments is-legacy"><div class="salary-muted">${escapeHtml(message)}</div></div>`;
    }
    return `<div class="salary-payroll-installments" aria-label="Payroll installments">
        ${installments.map(installment => {
            const status = installment.settlementStatus || installment.workflowStatus || installment.workflow_status || 'draft';
            const approvedBy = installment.approvedByUsername || installment.approved_by_username || installment.approvedBy || installment.approved_by || '—';
            const approvedAt = installment.approvedAt || installment.approved_at;
            const actualDates = installment.actualPaymentDates || installment.actual_payment_dates || [];
            const paymentMovements = salaryInstallmentMovements(installment).filter(movement => (
                movement.movementType || movement.movement_type || movement.type
            ) === 'payment');
            const paymentConfirmers = [...new Set(paymentMovements.map(movement => (
                movement.actorUsername || movement.actor_username || movement.actor || ''
            )).filter(Boolean))];
            const lastConfirmation = paymentMovements.map(movement => movement.createdAt || movement.created_at)
                .filter(Boolean)
                .sort()
                .at(-1);
            return `<article class="salary-payroll-installment ${payrollInstallmentTone(status)}">
                <header>
                    <div>
                        <strong>${escapeHtml(PAYROLL_INSTALLMENT_KIND_LABELS[installment.kind] || installment.kind || 'Installment')}</strong>
                        <span>${payrollDisplayDate(installment.earningFrom || installment.earning_from)}–${payrollDisplayDate(installment.earningTo || installment.earning_to)}</span>
                    </div>
                    <span class="salary-status ${escapeHtml(status)}">${escapeHtml(PAYROLL_INSTALLMENT_STATUS_LABELS[status] || status)}</span>
                </header>
                <div class="salary-payroll-grid">
                    <div><span>Calculated</span><b>${formatMoney(installment.calculatedAmount ?? installment.calculated_amount ?? installment.lockedAmount ?? installment.locked_amount)}</b></div>
                    <div><span>Paid</span><b>${formatMoney(installment.paidAmount ?? installment.paid_amount)}</b></div>
                    <div><span>Balance</span><b>${formatMoney(installment.outstandingAmount ?? installment.outstanding_amount ?? installment.balanceAmount ?? installment.balance_amount)}</b></div>
                    <div><span>Scheduled</span><b>${payrollDisplayDate(installment.scheduledPaymentDate || installment.scheduled_payment_date)}</b></div>
                    <div><span>Actual dates</span><b>${(Array.isArray(actualDates) ? actualDates : []).map(payrollDisplayDate).join(', ') || '—'}</b></div>
                    <div><span>Approved</span><b>${escapeHtml(approvedBy)}</b><small>${payrollDisplayDateTime(approvedAt)}</small></div>
                    <div><span>Payment confirmed</span><b>${escapeHtml(paymentConfirmers.join(', ') || '—')}</b><small>${payrollDisplayDateTime(lastConfirmation)}</small></div>
                </div>
                ${renderPayrollInstallmentBlockers(installment)}
                ${renderFinancePayrollInstallmentActions(installment)}
                ${renderFinancePayrollMovements(installment)}
            </article>`;
        }).join('')}
    </div>`;
}

function renderSalaryWorkspace() {
    renderSalaryModeButtons();
    renderSalaryActionButtons();
    renderSalaryStaffList();
    renderSalaryMainPanel();
    renderSalaryPreviewPanel();
}

function setSalaryMode(mode) {
    if (!['overview', 'builder', 'report'].includes(mode)) return;
    FinState.salaryMode = mode;
    if (mode !== 'builder') FinState.creatingSalaryScheme = false;
    renderSalaryWorkspace();
}

function renderSalaryModeButtons() {
    document.querySelectorAll('.salary-mode-btn').forEach(btn => {
        const active = btn.dataset.mode === FinState.salaryMode;
        const requiresRules = btn.dataset.mode === 'builder';
        const visible = !requiresRules || financeCanUsePayrollAction('manage_payroll_rules');
        btn.hidden = !visible;
        btn.disabled = !visible;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

function renderSalaryActionButtons() {
    const createSchemeBtn = document.getElementById('salaryCreateSchemeBtn');
    const generateReportBtn = document.getElementById('salaryGenerateReportBtn');
    if (createSchemeBtn) {
        const allowed = financeCanUsePayrollAction('manage_payroll_rules');
        createSchemeBtn.hidden = !allowed;
        createSchemeBtn.disabled = !allowed;
    }
    if (generateReportBtn) {
        const allowed = financeCanUsePayrollAction('manage_payroll_accrual');
        generateReportBtn.hidden = !allowed;
        generateReportBtn.disabled = !allowed;
        generateReportBtn.textContent = 'Розрахувати';
    }
    if (!financeCanUsePayrollAction('manage_payroll_rules') && FinState.salaryMode === 'builder') {
        FinState.salaryMode = 'overview';
        FinState.creatingSalaryScheme = false;
    }
}

function renderSalaryStaffList() {
    const container = document.getElementById('salaryStaffList');
    if (!container) return;
    const rows = getSalaryRows();
    if (!rows.length) {
        container.innerHTML = '<div class="salary-muted" style="padding:12px">Немає працівників для payroll за цей місяць.</div>';
        return;
    }

    container.innerHTML = rows.map(row => {
        const staffId = row.staffId || row.id;
        const active = String(staffId) === String(FinState.selectedSalaryStaffId);
        const paid = payrollRowPaidAmount(row);
        const balance = payrollRowBalanceAmount(row);
        return `
            <button type="button" class="salary-staff-item ${active ? 'active' : ''}" data-staff-id="${staffId}">
                <span style="min-width:0">
                    <span class="salary-staff-name">${escapeHtml(row.name)}</span>
                    <span class="salary-staff-meta">${escapeHtml(DEPT_LABELS[row.department] || row.department || '—')} · ${escapeHtml(row.position || row.roleType || '—')}</span>
                    <span style="display:block;margin-top:6px">${salarySchemePill(row.schemeType)}</span>
                    <span class="salary-staff-meta">Виплачено: ${formatPayrollFactAmount(paid)} · Залишок: ${formatPayrollFactAmount(balance)}</span>
                </span>
                <span class="salary-staff-amount">${formatMoney(row.netAmount || row.estimatedSalary || 0)}</span>
            </button>
        `;
    }).join('');
}

function renderSalaryMainPanel() {
    const panel = document.getElementById('salaryMainPanel');
    if (!panel) return;
    if (FinState.salaryMode === 'builder') {
        renderSalaryBuilder(panel);
    } else if (FinState.salaryMode === 'report') {
        renderSalaryReportTable(FinState.salaryWorkspace);
    } else {
        renderSalaryOverview(panel);
    }
}

function renderSalaryOverview(panel) {
    const data = FinState.salaryWorkspace || {};
    const rows = getSalaryRows();
    const selected = getSelectedSalaryRow();
    const totals = data.totals || {};
    const typeCounts = rows.reduce((acc, row) => {
        const key = row.schemeType || 'hourly';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    panel.innerHTML = `
        <div class="salary-panel-title">
            <h3>Огляд зарплат за ${escapeHtml(data.month || '')}</h3>
            <span class="salary-muted">${rows.length} працівників</span>
        </div>
        <div class="salary-summary-grid">
            <div class="salary-summary-card"><b>${formatMoney(totals.net || data.totalSalary || 0)}</b><span>Нараховано</span></div>
            <div class="salary-summary-card"><b>${formatPayrollFactAmount(totals.paid)}</b><span>Виплачено</span></div>
            <div class="salary-summary-card"><b>${formatPayrollFactAmount(totals.balance ?? totals.outstanding)}</b><span>Залишок</span></div>
            <div class="salary-summary-card"><b>${formatMoney(totals.base || 0)}</b><span>База</span></div>
            <div class="salary-summary-card"><b>${formatMoney(totals.additional || 0)}</b><span>Одночасна доплата</span></div>
            <div class="salary-summary-card"><b>${formatMoney(totals.bonuses || 0)}</b><span>Бонуси / %</span></div>
            <div class="salary-summary-card"><b>${formatMoney((totals.deductions || 0) + (totals.advances || 0))}</b><span>Утримано</span></div>
            <div class="salary-summary-card"><b>${formatMoney(totals.net || data.totalSalary || 0)}</b><span>До виплати</span></div>
        </div>
        <div class="salary-blocks">
            <div class="salary-block">
                <h4>Типи схем</h4>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${Object.keys(typeCounts).map(type => `${salarySchemePill(type)} <span class="salary-muted">${typeCounts[type]}</span>`).join('')}
                </div>
            </div>
            <div class="salary-block salary-block--base">
                <h4>${selected ? escapeHtml(selected.name) : 'Працівник не вибраний'}</h4>
                ${selected ? `
                    <div class="salary-form-grid" style="margin-bottom:0">
                        <div><span class="salary-muted">Схема</span><br>${salarySchemePill(selected.schemeType)}</div>
                        <div><span class="salary-muted">Статус звіту</span><br>${salaryStatusPill(payrollRowDisplayStatus(selected))}</div>
                        <div><span class="salary-muted">Години</span><br><b>${salaryNumber(selected.hoursWorked || selected.totalHours).toLocaleString('uk-UA')} год</b></div>
                        <div><span class="salary-muted">Виходи</span><br><b>${salaryNumber(selected.daysWorked || selected.shifts).toLocaleString('uk-UA')}</b></div>
                    </div>
                ` : '<div class="salary-muted">Оберіть працівника у списку.</div>'}
            </div>
            ${selected ? `
                <div class="salary-block salary-block--base">
                    <h4>Факт виплати</h4>
                    <div class="salary-form-grid" style="margin-bottom:0">
                        <div><span class="salary-muted">Виплачено</span><br><b>${formatPayrollFactAmount(payrollRowPaidAmount(selected))}</b></div>
                        <div><span class="salary-muted">Залишок</span><br><b>${formatPayrollFactAmount(payrollRowBalanceAmount(selected))}</b></div>
                    </div>
                    ${renderFinancePayrollInstallments(selected)}
                </div>
            ` : ''}
        </div>
    `;
}

function renderSalaryBuilder(panel) {
    const row = getSelectedSalaryRow();
    if (!row) {
        panel.innerHTML = '<div class="salary-muted">Оберіть працівника, щоб налаштувати зарплатну схему.</div>';
        return;
    }
    const scheme = FinState.creatingSalaryScheme ? null : getEditableSchemeForRow(row);
    const config = scheme?.config || {};
    const schemeType = scheme?.schemeType || row.schemeType || 'per_shift';
    const title = scheme?.title || row.schemeTitle || SALARY_SCHEME_LABELS[schemeType] || '';
    const selectedMonth = document.getElementById('salaryMonth')?.value
        || FinState.salaryWorkspace?.month
        || FinState.salaryReport?.month
        || '';
    const selectedEffectiveFrom = /^\d{4}-\d{2}$/.test(selectedMonth)
        ? `${selectedMonth}-01`
        : '';
    const sourceEffectiveFrom = payrollDateValue(scheme?.effectiveFrom);
    const effectiveFrom = sourceEffectiveFrom && (!selectedEffectiveFrom || selectedEffectiveFrom <= sourceEffectiveFrom)
        ? payrollNextMonthStart(sourceEffectiveFrom)
        : selectedEffectiveFrom;

    panel.innerHTML = `
        <div class="salary-panel-title">
            <h3>${FinState.creatingSalaryScheme || !scheme ? 'Нова зарплатна схема' : 'Нова версія схеми'}</h3>
            <span class="salary-muted">${escapeHtml(row.name)}</span>
        </div>
        <div class="salary-form-grid">
            <div>
                <label>Назва схеми</label>
                <input type="text" class="salary-builder-input" data-field="title" value="${escapeHtml(title)}" placeholder="Сума за вихід">
            </div>
            <div>
                <label>Тип схеми</label>
                <select class="salary-builder-input" data-field="schemeType">
                    ${Object.keys(SALARY_SCHEME_LABELS).map(type => `<option value="${type}" ${type === schemeType ? 'selected' : ''}>${SALARY_SCHEME_LABELS[type]}</option>`).join('')}
                </select>
            </div>
            <div>
                <label>Нова версія діє з</label>
                <input type="date" class="salary-builder-input" data-field="effectiveFrom" value="${escapeHtml(effectiveFrom)}" required>
            </div>
        </div>
        <div id="salaryBuilderFields">${renderSalaryBuilderFields(schemeType, config, row)}</div>
        <div class="salary-inline-result">
            <span>Preview до виплати</span>
            <b id="salaryBuilderNet">${formatMoney(0)}</b>
        </div>
        <div class="salary-actions">
            <button type="button" class="btn-page-secondary" id="salaryResetBuilderBtn">Скинути</button>
            <button type="button" class="btn-page-primary" id="salarySaveSchemeBtn">Створити нову версію</button>
        </div>
    `;
    updateSalaryBuilderPreview();
}

function renderSalaryBuilderFields(type, config, row) {
    const c = config || {};
    if (type === 'per_shift') {
        return `
            <div class="salary-block salary-block--base">
                <h4>Простий сценарій: сума за вихід</h4>
                <div class="salary-form-grid">
                    <div>
                        <label>Сума за 1 вихід</label>
                        <input type="number" min="0" step="1" class="salary-builder-input" data-field="perShiftRate" value="${salaryNumber(c.rate ?? c.perShiftRate ?? c.amount)}" placeholder="1500">
                    </div>
                    <div>
                        <label>Кількість виходів для preview</label>
                        <input type="number" min="0" step="1" class="salary-builder-input" data-field="shiftCount" value="${salaryNumber(c.shiftCount ?? c.shifts ?? row.daysWorked ?? row.shifts)}" placeholder="12">
                    </div>
                </div>
            </div>
        `;
    }
    if (type === 'hourly') {
        return `
            <div class="salary-block salary-block--base">
                <h4>Погодинна схема</h4>
                <div class="salary-form-grid">
                    <div>
                        <label>Ставка за годину</label>
                        <input type="number" min="0" step="1" class="salary-builder-input" data-field="hourlyRate" value="${salaryNumber(c.hourlyRate ?? c.rate ?? row.hourlyRate)}">
                    </div>
                    <div>
                        <label>Години для preview</label>
                        <input type="number" min="0" step="0.5" class="salary-builder-input" data-field="hours" value="${salaryNumber(c.hours ?? row.hoursWorked ?? row.totalHours)}">
                    </div>
                </div>
            </div>
        `;
    }
    if (type === 'monthly_fixed') {
        return `
            <div class="salary-block salary-block--base">
                <h4>Фікс за місяць</h4>
                <div class="salary-form-grid">
                    <div>
                        <label>Місячна сума</label>
                        <input type="number" min="0" step="1" class="salary-builder-input" data-field="monthlyAmount" value="${salaryNumber(c.monthlyAmount ?? c.fixedAmount ?? c.amount)}">
                    </div>
                    <div>
                        <label>Місяць норми</label>
                        <input type="month" class="salary-builder-input" data-field="monthlyNormMonth" value="${escapeHtml(c.monthlyNormMonth || c.monthly_norm_month || '')}">
                    </div>
                    <div>
                        <label>Норма, годин</label>
                        <input type="number" min="0" step="0.25" class="salary-builder-input" data-field="monthlyNormHours" value="${salaryNumber(c.monthlyNormMinutes ?? c.monthly_norm_minutes) / 60}">
                    </div>
                    <div>
                        <label>Джерело норми</label>
                        <input type="text" maxlength="120" class="salary-builder-input" data-field="monthlyNormSource" value="${escapeHtml(c.monthlyNormSource || c.monthly_norm_source || '')}">
                    </div>
                    <label>
                        <input type="checkbox" class="salary-builder-input" data-field="monthlyNormConfirmed" ${(c.monthlyNormConfirmed ?? c.monthly_norm_confirmed) === true ? 'checked' : ''}>
                        Норму перевірено
                    </label>
                </div>
            </div>
        `;
    }
    if (type === 'percent') {
        return `
            <div class="salary-block salary-block--percent">
                <h4>Відсоток від показника</h4>
                <div class="salary-form-grid">
                    <div>
                        <label>Відсоток</label>
                        <input type="number" min="0" step="0.1" class="salary-builder-input" data-field="percentRate" value="${salaryNumber(c.percentRate ?? c.rate)}">
                    </div>
                    <div>
                        <label>База для preview</label>
                        <input type="number" min="0" step="1" class="salary-builder-input" data-field="percentBase" value="${salaryNumber(c.percentBase ?? c.baseAmount)}">
                    </div>
                    <div>
                        <label>Джерело</label>
                        <select class="salary-builder-input" data-field="sourceMetric">
                            <option value="manual" ${(c.sourceMetric || c.source || 'manual') === 'manual' ? 'selected' : ''}>Ручний показник</option>
                            <option value="finance_income" ${(c.sourceMetric || c.source) === 'finance_income' ? 'selected' : ''}>Дохід місяця</option>
                        </select>
                    </div>
                </div>
            </div>
        `;
    }
    if (type === 'manual') {
        return `
            <div class="salary-block salary-block--base">
                <h4>Ручна fallback схема</h4>
                <div class="salary-form-grid">
                    <div>
                        <label>Сума до нарахування</label>
                        <input type="number" min="0" step="1" class="salary-builder-input" data-field="manualAmount" value="${salaryNumber(c.manualAmount ?? c.amount)}">
                    </div>
                </div>
            </div>
        `;
    }

    const base = c.base || {};
    const bonus = (Array.isArray(c.bonusRules) && c.bonusRules[0]) || {};
    const percent = (Array.isArray(c.percentRules) && c.percentRules[0]) || {};
    const deduction = (Array.isArray(c.deductions) && c.deductions[0]) || {};
    const advance = (Array.isArray(c.zrsRules) && c.zrsRules[0])
        || (Array.isArray(c.zrs) && c.zrs[0])
        || (Array.isArray(c.advances) && c.advances[0])
        || {};
    return `
        <div class="salary-blocks">
            <div class="salary-block salary-block--base">
                <h4>Базова частина</h4>
                <div class="salary-form-grid">
                    <div>
                        <label>Тип бази</label>
                        <select class="salary-builder-input" data-field="baseKind">
                            ${['hourly','per_shift','monthly_fixed','manual'].map(kind => `<option value="${kind}" ${(base.kind || c.baseKind || 'hourly') === kind ? 'selected' : ''}>${SALARY_SCHEME_LABELS[kind] || kind}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label>Ставка / сума</label>
                        <input type="number" min="0" step="1" class="salary-builder-input" data-field="baseRate" value="${salaryNumber(base.rate ?? base.amount ?? c.baseRate ?? c.baseAmount)}">
                    </div>
                    <div>
                        <label>Кількість для preview</label>
                        <input type="number" min="0" step="0.5" class="salary-builder-input" data-field="baseQuantity" value="${salaryNumber(base.quantity ?? c.baseQuantity ?? row.hoursWorked ?? row.totalHours)}">
                    </div>
                    <div>
                        <label>Місяць норми (для фіксу)</label>
                        <input type="month" class="salary-builder-input" data-field="monthlyNormMonth" value="${escapeHtml(base.monthlyNormMonth || base.monthly_norm_month || '')}">
                    </div>
                    <div>
                        <label>Норма, годин (для фіксу)</label>
                        <input type="number" min="0" step="0.25" class="salary-builder-input" data-field="monthlyNormHours" value="${salaryNumber(base.monthlyNormMinutes ?? base.monthly_norm_minutes) / 60}">
                    </div>
                    <div>
                        <label>Джерело норми</label>
                        <input type="text" maxlength="120" class="salary-builder-input" data-field="monthlyNormSource" value="${escapeHtml(base.monthlyNormSource || base.monthly_norm_source || '')}">
                    </div>
                    <label>
                        <input type="checkbox" class="salary-builder-input" data-field="monthlyNormConfirmed" ${(base.monthlyNormConfirmed ?? base.monthly_norm_confirmed) === true ? 'checked' : ''}>
                        Норму перевірено
                    </label>
                </div>
            </div>
            <div class="salary-block salary-block--bonus">
                <h4>Бонуси</h4>
                <div class="salary-form-grid">
                    <div><label>Назва</label><input type="text" class="salary-builder-input" data-field="bonusLabel" value="${escapeHtml(bonus.label || 'Премія')}"></div>
                    <div><label>Сума</label><input type="number" min="0" step="1" class="salary-builder-input" data-field="bonusAmount" value="${salaryNumber(bonus.amount ?? c.bonusAmount)}"></div>
                </div>
            </div>
            <div class="salary-block salary-block--percent">
                <h4>Відсоткова частина</h4>
                <div class="salary-form-grid">
                    <div><label>%</label><input type="number" min="0" step="0.1" class="salary-builder-input" data-field="hybridPercentRate" value="${salaryNumber(percent.rate ?? percent.percentRate)}"></div>
                    <div><label>База</label><input type="number" min="0" step="1" class="salary-builder-input" data-field="hybridPercentBase" value="${salaryNumber(percent.baseAmount ?? percent.percentBase)}"></div>
                </div>
            </div>
            <div class="salary-block salary-block--deduction">
                <h4>Утримання / штрафи</h4>
                <div class="salary-form-grid">
                    <div><label>Назва</label><input type="text" class="salary-builder-input" data-field="deductionLabel" value="${escapeHtml(deduction.label || 'Утримання')}"></div>
                    <div><label>Сума</label><input type="number" min="0" step="1" class="salary-builder-input" data-field="deductionAmount" value="${salaryNumber(deduction.amount ?? c.deductionAmount)}"></div>
                </div>
            </div>
            <div class="salary-block salary-block--advance">
                <h4>ЗРС / legacy утримання</h4>
                <div class="salary-form-grid">
                    <div><label>Назва</label><input type="text" class="salary-builder-input" data-field="advanceLabel" value="${escapeHtml(advance.label || 'ЗРС')}"></div>
                    <div><label>Сума</label><input type="number" min="0" step="1" class="salary-builder-input" data-field="advanceAmount" value="${salaryNumber(advance.amount ?? c.advanceAmount)}"></div>
                </div>
            </div>
        </div>
    `;
}

function fieldValue(name) {
    return document.getElementById('salaryMainPanel')?.querySelector(`[data-field="${name}"]`)?.value || '';
}

function fieldChecked(name) {
    return document.getElementById('salaryMainPanel')?.querySelector(`[data-field="${name}"]`)?.checked === true;
}

function collectSalaryMonthlyNorm() {
    return {
        monthlyNormMinutes: Math.round(salaryNumber(fieldValue('monthlyNormHours')) * 60),
        monthlyNormMonth: fieldValue('monthlyNormMonth') || null,
        monthlyNormSource: fieldValue('monthlyNormSource') || null,
        monthlyNormConfirmed: fieldChecked('monthlyNormConfirmed')
    };
}

function collectSalaryBuilderDraft() {
    const row = getSelectedSalaryRow();
    const type = fieldValue('schemeType') || row?.schemeType || 'per_shift';
    const title = fieldValue('title') || SALARY_SCHEME_LABELS[type] || '';
    let config = {};

    if (type === 'per_shift') {
        config = { rate: salaryNumber(fieldValue('perShiftRate')), shiftCount: salaryNumber(fieldValue('shiftCount')) };
    } else if (type === 'hourly') {
        config = { hourlyRate: salaryNumber(fieldValue('hourlyRate')), hours: salaryNumber(fieldValue('hours')) };
    } else if (type === 'monthly_fixed') {
        config = {
            monthlyAmount: salaryNumber(fieldValue('monthlyAmount')),
            ...collectSalaryMonthlyNorm()
        };
    } else if (type === 'percent') {
        config = {
            percentRate: salaryNumber(fieldValue('percentRate')),
            percentBase: salaryNumber(fieldValue('percentBase')),
            sourceMetric: fieldValue('sourceMetric') || 'manual'
        };
    } else if (type === 'manual') {
        config = { manualAmount: salaryNumber(fieldValue('manualAmount')) };
    } else {
        const bonusAmount = salaryNumber(fieldValue('bonusAmount'));
        const percentRate = salaryNumber(fieldValue('hybridPercentRate'));
        const deductionAmount = salaryNumber(fieldValue('deductionAmount'));
        const advanceAmount = salaryNumber(fieldValue('advanceAmount'));
        const baseKind = fieldValue('baseKind') || 'hourly';
        config = {
            base: {
                ...(baseKind === 'monthly_fixed' ? collectSalaryMonthlyNorm() : {}),
                kind: baseKind,
                rate: salaryNumber(fieldValue('baseRate')),
                amount: salaryNumber(fieldValue('baseRate')),
                quantity: salaryNumber(fieldValue('baseQuantity'))
            },
            bonusRules: bonusAmount ? [{ kind: 'fixed', label: fieldValue('bonusLabel') || 'Премія', amount: bonusAmount }] : [],
            percentRules: percentRate ? [{ kind: 'percent', label: 'Відсоток', rate: percentRate, baseAmount: salaryNumber(fieldValue('hybridPercentBase')) }] : [],
            deductions: deductionAmount ? [{ kind: 'fixed', label: fieldValue('deductionLabel') || 'Утримання', amount: deductionAmount }] : [],
            zrsRules: advanceAmount ? [{ kind: 'fixed', label: fieldValue('advanceLabel') || 'ЗРС', amount: advanceAmount }] : []
        };
    }

    return { row, schemeType: type, title, effectiveFrom: fieldValue('effectiveFrom'), config };
}

function canonicalSalaryBuilderPreview() {
    const row = getSelectedSalaryRow();
    if (!row) return null;
    return {
        ...row,
        canonicalPreview: true
    };
}

function canonicalSalaryNet(payload) {
    return salaryNumber(payload?.summary?.net ?? payload?.netAmount ?? payload?.estimatedSalary ?? 0);
}

function renderSalaryPreviewPanel() {
    const panel = document.getElementById('salaryPreviewPanel');
    if (!panel) return;
    const payload = FinState.salaryMode === 'builder' ? canonicalSalaryBuilderPreview() : getSelectedSalaryRow();
    if (!payload) {
        panel.innerHTML = '<div class="salary-muted">Оберіть працівника для preview.</div>';
        return;
    }
    const summary = payload.summary || {
        base: payload.baseAmount || 0,
        bonuses: (payload.bonusesAmount || 0) - (payload.percentAmount || 0),
        percent: payload.percentAmount || 0,
        gross: payload.grossAmount || 0,
        deductions: payload.deductionsAmount || 0,
        advances: payload.advancesAmount || 0,
        net: payload.netAmount || payload.estimatedSalary || 0
    };
    const lines = payload.lines || [];
    const previewTransparency = payrollTransparency(payload);
    const previewAdditionalRoles = Array.isArray(previewTransparency.additionalRoles)
        ? previewTransparency.additionalRoles
        : [];
    const previewBlockers = Array.isArray(payload.payrollBlockingIssues)
        ? payload.payrollBlockingIssues
        : (Array.isArray(payload.payroll_blocking_issues) ? payload.payroll_blocking_issues : []);
    const additionalBlocked = previewBlockers.length > 0 || previewAdditionalRoles.some(role => (
        role.status === 'blocked' || role.amount === null || role.amount === undefined
    ));
    panel.innerHTML = `
        <div class="salary-panel-title">
            <h4>Preview / Payslip</h4>
            ${salaryStatusPill(payload.status)}
        </div>
        ${payload.canonicalPreview ? '<div class="salary-muted salary-canonical-preview-note">Показано останній серверний розрахунок. Збережіть схему та натисніть «Розрахувати», щоб оновити суму.</div>' : ''}
        <div style="margin-bottom:12px">
            <div style="font-weight:900">${escapeHtml(payload.name || 'Нова схема')}</div>
            <div style="margin-top:6px">${salarySchemePill(payload.schemeType)}</div>
        </div>
        <div class="salary-preview-card">
            <div class="salary-preview-row"><span>База</span><b>${formatMoney(summary.base || 0)}</b></div>
            <div class="salary-preview-row"><span>Одночасна додаткова професія</span>${additionalBlocked
                ? '<b class="salary-additional-warning">Не розраховано</b>'
                : `<b class="salary-plus">+ ${formatMoney(summary.additional || 0)}</b>`}</div>
            <div class="salary-preview-row"><span>Бонуси / %</span><b class="salary-plus">+ ${formatMoney((summary.bonuses || 0) + (summary.percent || 0) + (summary.manual || 0))}</b></div>
            <div class="salary-preview-row"><span>Утримання</span><b class="salary-minus">- ${formatMoney(summary.deductions || 0)}</b></div>
            <div class="salary-preview-row"><span>ЗРС</span><b class="salary-minus">- ${formatMoney(summary.advances || 0)}</b></div>
            <div class="salary-preview-total"><span>До виплати</span><b>${formatMoney(summary.net || 0)}</b></div>
        </div>
        ${FinState.salaryMode === 'builder' ? '' : renderFinancePayrollInstallments(payload)}
        ${renderPayrollTimeBreakdown(payload)}
        <div class="salary-lines">${renderPayrollAdditionalBreakdown(payload)}</div>
        <div class="salary-lines">
            ${lines.length ? lines.map(item => `
                <div class="salary-line-item">
                    <span>${escapeHtml(item.label || item.lineType || item.group)}</span>
                    <b>${['deduction','advance'].includes(item.group) ? '-' : '+'}${formatMoney(Math.abs(salaryNumber(item.amount)))}</b>
                </div>
            `).join('') : '<div class="salary-muted">Line items зʼявляться після налаштування схеми.</div>'}
        </div>
    `;
}

function updateSalaryBuilderPreview() {
    if (FinState.salaryMode !== 'builder') return;
    const net = document.getElementById('salaryBuilderNet');
    if (net) net.textContent = formatMoney(canonicalSalaryNet(canonicalSalaryBuilderPreview()));
    renderSalaryPreviewPanel();
}

async function saveSalaryScheme() {
    if (!financeCanUsePayrollAction('manage_payroll_rules')) {
        showNotification('Недостатньо прав для керування правилами payroll', 'error');
        return;
    }
    const draft = collectSalaryBuilderDraft();
    if (!draft.row) return;
    const existing = FinState.creatingSalaryScheme ? null : getEditableSchemeForRow(draft.row);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom || '')) {
        showNotification('Вкажіть дату, з якої діє нова версія схеми', 'error');
        return;
    }
    const sourceEffectiveFrom = payrollDateValue(existing?.effectiveFrom);
    if (sourceEffectiveFrom && draft.effectiveFrom <= sourceEffectiveFrom) {
        showNotification('Нова версія має починатися пізніше за поточну', 'error');
        return;
    }
    const body = {
        staffId: draft.row.staffId || draft.row.id,
        schemeType: draft.schemeType,
        title: draft.title,
        isActive: true,
        effectiveFrom: draft.effectiveFrom,
        supersedesSchemeId: existing?.id || null,
        config: draft.config
    };
    try {
        await apiRequest('POST', '/api/payroll/schemes', body);
        FinState.creatingSalaryScheme = false;
        showNotification('Нову effective-dated версію зарплатної схеми створено');
        await fetchSalaryReport();
        FinState.salaryMode = 'builder';
        renderSalaryWorkspace();
    } catch (err) {
        showNotification(err.message || 'Не вдалося зберегти схему', 'error');
    }
}

async function generateSalaryReport() {
    if (!financeCanUsePayrollAction('manage_payroll_accrual')) {
        showNotification('Недостатньо прав для нарахування payroll', 'error');
        return;
    }
    const month = document.getElementById('salaryMonth')?.value;
    if (!month) return;
    try {
        const result = await apiRequest('POST', `/api/payroll/generate?month=${month}`, {});
        showNotification(`Звіт згенеровано: ${result.generated || 0}`);
        FinState.salaryMode = 'report';
        await fetchSalaryReport();
    } catch (err) {
        showNotification(err.message || 'Не вдалося згенерувати звіт', 'error');
    }
}

async function exportPayrollCSV() {
    const month = document.getElementById('salaryMonth')?.value;
    if (!month) return;
    let touchWindow = null;
    try {
        touchWindow = typeof openTouchDownloadWindow === 'function'
            ? openTouchDownloadWindow('Payroll CSV')
            : null;
        const token = localStorage.getItem('pzp_token');
        const response = await fetch(`/api/payroll/export?month=${encodeURIComponent(month)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Payroll export failed');
        const blob = await response.blob();
        const filename = `payroll_${month}.csv`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'Payroll CSV підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Не вдалося експортувати payroll CSV', 'error');
    }
}

async function exportPayrollXLSX() {
    const month = document.getElementById('salaryMonth')?.value;
    if (!month) return;
    let touchWindow = null;
    try {
        touchWindow = typeof openTouchDownloadWindow === 'function'
            ? openTouchDownloadWindow('Payroll Excel')
            : null;
        const token = localStorage.getItem('pzp_token');
        const response = await fetch(`/api/payroll/export-xlsx?month=${encodeURIComponent(month)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Payroll Excel export failed');
        const blob = await response.blob();
        const filename = `payroll_${month}.xlsx`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'Payroll Excel підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Не вдалося експортувати payroll Excel', 'error');
    }
}

function payrollTransparency(row = {}) {
    return row.payrollTransparency || row.payroll_transparency || {
        physicalHours: row.physicalHours ?? row.physical_hours ?? row.hoursWorked ?? 0,
        baseRoleHours: row.baseRoleHours ?? row.base_role_hours ?? row.hoursWorked ?? 0,
        additionalRoleHours: row.additionalRoleHours ?? row.additional_role_hours ?? 0,
        additionalAmount: row.additionalAmount ?? row.additional_amount ?? 0,
        additionalRoles: row.additionalRoles || row.additional_roles || []
    };
}

function renderPayrollTimeBreakdown(row = {}) {
    const transparency = payrollTransparency(row);
    return `<div class="salary-time-breakdown">
        <span><b>${salaryNumber(transparency.physicalHours).toLocaleString('uk-UA')}</b> фізичних год</span>
        <span>${salaryNumber(transparency.baseRoleHours).toLocaleString('uk-UA')} год основної професії</span>
        <span>${salaryNumber(transparency.additionalRoleHours).toLocaleString('uk-UA')} год додаткової професії</span>
    </div>`;
}

function payrollAdditionalRoleBlocker(role = {}, blockers = []) {
    if (role.blockerCode || role.blocker_code) {
        return {
            code: role.blockerCode || role.blocker_code,
            message: role.blockerMessage || role.blocker_message || role.blockerCode || role.blocker_code
        };
    }
    return blockers.find(issue => (
        (!issue.professionKey && !issue.profession_key
            || (issue.professionKey || issue.profession_key) === (role.professionKey || role.profession_key))
        && (!issue.date || issue.date === (role.workDate || role.work_date))
    )) || null;
}

function renderPayrollAdditionalBreakdown(row = {}) {
    const transparency = payrollTransparency(row);
    const roles = Array.isArray(transparency.additionalRoles) ? transparency.additionalRoles : [];
    const blockers = Array.isArray(row.payrollBlockingIssues)
        ? row.payrollBlockingIssues
        : (Array.isArray(row.payroll_blocking_issues) ? row.payroll_blocking_issues : []);
    if (!roles.length && !blockers.length) return '<span class="salary-muted">Немає</span>';
    const lines = roles.map(role => {
        const blocker = payrollAdditionalRoleBlocker(role, blockers);
        const blocked = role.status === 'blocked'
            || role.amount === null
            || role.amount === undefined
            || Boolean(blocker);
        const trace = [
            role.attendanceRef ? `attendance #${role.attendanceRef}` : '',
            role.segmentRef ? `segment #${role.segmentRef}` : '',
            role.roleRef ? `role #${role.roleRef}` : ''
        ].filter(Boolean).join(' · ');
        const status = blocked
            ? '<span class="salary-additional-warning">Потрібна перевірка</span>'
            : '';
        const amount = blocked
            ? '<strong class="salary-additional-warning">Не розраховано</strong>'
            : `<strong>+ ${formatMoney(role.amount || 0)}</strong>`;
        const rateLabel = role.rate === null || role.rate === undefined
            ? 'ставку не визначено'
            : formatMoney(role.rate);
        const multiplierLabel = role.multiplier === null || role.multiplier === undefined
            ? 'multiplier не визначено'
            : salaryNumber(role.multiplier).toLocaleString('uk-UA');
        return `<div class="salary-additional-line">
            <div><b>${escapeHtml(role.professionKey || '—')}</b>${status}</div>
            <div>${salaryNumber(role.hours).toLocaleString('uk-UA')} год × ${escapeHtml(rateLabel)} × ${escapeHtml(multiplierLabel)}</div>
            ${amount}
            ${blocker ? `<div class="salary-additional-warning"><code>${escapeHtml(blocker.code || 'PAYROLL_BLOCKED')}</code> — ${escapeHtml(blocker.message || '')}</div>` : ''}
            <small>${escapeHtml(trace || role.policyVersion || 'Немає snapshot reference')}</small>
        </div>`;
    });
    if (blockers.length) {
        lines.push(`<div class="salary-additional-warning" role="alert">
            ${blockers.map(issue => `<code>${escapeHtml(issue.code || 'PAYROLL_BLOCKED')}</code> — ${escapeHtml(issue.message || 'Payroll потребує перевірки')}`).join('<br>')}
        </div>`);
    }
    return lines.join('');
}

function renderPayrollProfessionBreakdown(row = {}) {
    const items = row.professionRateSummary || row.profession_rate_summary || [];
    if (!Array.isArray(items) || !items.length) return '<span class="salary-muted">—</span>';
    return items.map(item => {
        const profession = item.profession_key || item.professionKey || '—';
        const quantity = item.rate_unit === 'day'
            ? `${item.days || 0} дн`
            : item.rate_unit === 'month'
                ? 'місяць'
                : `${item.actual_hours ?? item.hours ?? 0} год`;
        const source = item.allocation_source || item.allocationSource || 'none';
        const kind = item.kind === 'overtime' ? ' · overtime' : '';
        return `<div class="salary-muted"><b>${escapeHtml(profession)}</b> · ${escapeHtml(quantity)} · ${formatMoney(item.rate || 0)} / ${escapeHtml(item.rate_unit || 'hour')} · ${formatMoney(item.amount || 0)}${kind} · ${escapeHtml(source)}</div>`;
    }).join('');
}

function renderSalaryReportTable(data) {
    const panel = document.getElementById('salaryMainPanel');
    if (!panel) return;
    const rows = data?.staff || [];
    const totals = data?.totals || {};
    if (!rows.length) {
        panel.innerHTML = '<div class="salary-muted">Немає зарплатних даних за цей період.</div>';
        return;
    }

    panel.innerHTML = `
        <div class="salary-report-tools">
            <div>
                <div style="font-weight:900">Звіт за ${escapeHtml(data.month || '')}</div>
                <div class="salary-muted">Breakdown по схемах, нарахуваннях, утриманнях і ЗРС.</div>
                <div class="salary-role-hours-note">Оплачувані години професій можуть перевищувати фізичні години через одночасну роботу.</div>
            </div>
            <div>
                <button type="button" class="btn-page-secondary" id="salaryReportExportBtn">CSV</button>
                <button type="button" class="btn-page-secondary" id="salaryReportExportXlsxBtn">Excel</button>
                <button type="button" class="btn-page-secondary" id="salaryReportRefreshBtn">Оновити</button>
            </div>
        </div>
        <div class="fin-table-wrap">
            <table class="fin-table">
                <thead>
                    <tr>
                        <th>Працівник</th>
                        <th>Відділ</th>
                        <th>Посада</th>
                        <th>Схема</th>
                        <th>Час</th>
                        <th>Професії / фактична оплата</th>
                        <th>База</th>
                        <th>Додаткова одночасна оплата</th>
                        <th>Бонуси / %</th>
                        <th>Утримання</th>
                        <th>ЗРС</th>
                        <th>До виплати</th>
                        <th>Статус</th>
                        <th>Виплачено</th>
                        <th>Залишок</th>
                        <th>Installments / movements</th>
                    </tr>
                </thead>
                <tbody id="salaryTableBody">
                    ${rows.map(row => `
                        <tr data-staff-id="${row.staffId || row.id}">
                            <td style="font-weight:700">${escapeHtml(row.name)}</td>
                            <td>${escapeHtml(DEPT_LABELS[row.department] || row.department || '—')}</td>
                            <td>${escapeHtml(row.position || row.roleType || '—')}</td>
                            <td>${salarySchemePill(row.schemeType)}</td>
                            <td>${renderPayrollTimeBreakdown(row)}</td>
                            <td>${renderPayrollProfessionBreakdown(row)}</td>
                            <td>${formatMoney(row.baseAmount || 0)}</td>
                            <td class="salary-plus">${renderPayrollAdditionalBreakdown(row)}</td>
                            <td class="salary-plus">${formatMoney(row.bonusesAmount || 0)}</td>
                            <td class="salary-minus">${formatMoney(row.deductionsAmount || 0)}</td>
                            <td class="salary-minus">${formatMoney(row.advancesAmount || 0)}</td>
                            <td class="fin-amount-expense">${formatMoney(row.netAmount || row.estimatedSalary || 0)}</td>
                            <td>${salaryStatusPill(payrollRowDisplayStatus(row))}</td>
                            <td class="salary-plus">${formatPayrollFactAmount(payrollRowPaidAmount(row))}</td>
                            <td class="salary-minus">${formatPayrollFactAmount(payrollRowBalanceAmount(row))}</td>
                            <td>${renderFinancePayrollInstallments(row)}</td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot id="salaryTableFoot">
                    <tr>
                        <td colspan="6" style="text-align:right;font-weight:900">Разом:</td>
                        <td>${formatMoney(totals.base || 0)}</td>
                        <td class="salary-plus">${formatMoney(totals.additional || 0)}</td>
                        <td class="salary-plus">${formatMoney(totals.bonuses || 0)}</td>
                        <td class="salary-minus">${formatMoney(totals.deductions || 0)}</td>
                        <td class="salary-minus">${formatMoney(totals.advances || 0)}</td>
                        <td class="fin-amount-expense">${formatMoney(totals.net || data.totalSalary || 0)}</td>
                        <td></td>
                        <td class="salary-plus">${formatPayrollFactAmount(totals.paid)}</td>
                        <td class="salary-minus">${formatPayrollFactAmount(totals.balance ?? totals.outstanding)}</td>
                        <td></td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

// ==========================================
// MODALS
// ==========================================

let _transEditInitialState = '';
let _accountModalInitialState = '';

function getTransEditState() {
    const ids = ['editType', 'editCategory', 'editAmount', 'editDate', 'editPayment', 'editDescription'];
    return ids.map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
}

function isTransEditDirty() {
    return getTransEditState() !== _transEditInitialState;
}

function getAccountModalState() {
    const ids = ['accName', 'accEmoji', 'accType', 'accDescription', 'accIsPersonal'];
    return ids.map(id => {
        const el = document.getElementById(id);
        if (el?.type === 'checkbox') return el.checked ? '1' : '0';
        return el ? String(el.value || '') : '';
    }).join('|');
}

function isAccountModalDirty() {
    return getAccountModalState() !== _accountModalInitialState;
}

function openTransModal(id) {
    if (!financeCanManageTransactions()) {
        showNotification('Недостатньо прав для керування фінансовими транзакціями', 'error');
        return;
    }
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

    _transEditInitialState = getTransEditState();
    modal.classList.remove('hidden');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
}

async function closeTransModal(force = false) {
    const modal = document.getElementById('transEditModal');
    const closeNow = () => {
        modal?.classList.add('hidden');
        FinState.editingId = null;
        _transEditInitialState = getTransEditState();
    };
    if (window.UnsafeDismissGuard && modal) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            force,
            isDirty: isTransEditDirty,
            message: 'Є незбережені зміни транзакції. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    closeNow();
    return true;
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
// MODE / TAB SWITCHING
// ==========================================

function setFinanceMode(mode, options = {}) {
    if (!['overview', 'operations', 'insights'].includes(mode)) mode = 'overview';
    FinState.mode = mode;

    document.querySelectorAll('.fa-mode-btn').forEach(btn => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const executive = document.getElementById('faExecutiveZone');
    const actions = document.getElementById('faActionRail');
    const workspace = document.getElementById('faWorkspace');
    const operationsNav = document.getElementById('financeOperationsNav');
    const operationsWorkspace = document.getElementById('financeOperationalWorkspace');
    const isOperations = mode === 'operations';
    if (executive) executive.style.display = isOperations ? 'none' : '';
    if (actions) actions.style.display = isOperations ? 'none' : '';
    if (workspace) workspace.style.display = isOperations ? 'none' : '';
    if (operationsNav) operationsNav.style.display = isOperations ? '' : 'none';
    if (operationsWorkspace) operationsWorkspace.style.display = isOperations ? '' : 'none';

    if (isOperations) {
        if (options.switchTab !== false) switchTab(options.tab || FinState.currentTab || 'transactions', { preserveMode: true });
        return;
    }
    if (FinState.unifiedLoaded) renderCurrentFinanceMode();
}

function switchTab(tabName, options = {}) {
    if (!tabName) tabName = 'transactions';
    FinState.currentTab = tabName;
    if (!options.preserveMode) setFinanceMode('operations', { switchTab: false });

    document.querySelectorAll('.fin-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

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
    let touchWindow = null;
    try {
        touchWindow = typeof openTouchDownloadWindow === 'function'
            ? openTouchDownloadWindow('Finance CSV')
            : null;
        const { from, to } = getFilterDates();
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/finance/export?from=${from}&to=${to}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const filename = `finance_${from}_${to}.csv`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'CSV завантажено' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            showNotification('CSV завантажено');
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Помилка експорту', 'error');
    }
}

// ==========================================
// EXCEL EXPORT (v17.0)
// ==========================================

async function exportXLSX() {
    let touchWindow = null;
    try {
        touchWindow = typeof openTouchDownloadWindow === 'function'
            ? openTouchDownloadWindow('Finance Excel')
            : null;
        const { from, to } = getFilterDates();
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/finance/export-xlsx?from=${from}&to=${to}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const filename = `finance_${from}_${to}.xlsx`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'Excel завантажено' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            showNotification('Excel завантажено');
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
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
    fetchUnifiedOverview();
    if (FinState.currentTab === 'dashboard') fetchDashboard();
    if (FinState.currentTab === 'transactions') fetchTransactions();
    if (FinState.currentTab === 'monthly') fetchMonthlyReport();
    if (FinState.currentTab === 'salary') fetchSalaryReport();
}

// ==========================================
// INIT
// ==========================================

let financePageInitInFlight = false;

async function initFinancePage() {
    if (financePageInitInFlight) return;
    financePageInitInFlight = true;
    // Dark mode
    if (typeof initDarkMode === 'function') initDarkMode();

    // Auth check
    const token = localStorage.getItem('pzp_token');
    if (!token) {
        window.location.href = '/';
        document.getElementById('mainApp')?.classList.add('hidden');
        if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
        return;
    }

    try {
        const user = await apiVerifyToken();
        if (!user) throw new Error('Invalid token');

        const permissions = typeof hydrateActionPermissions === 'function'
            ? await hydrateActionPermissions(user)
            : null;
        if (!permissions) {
            financePageInitInFlight = false;
            if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
            if (typeof renderPermissionBootstrapError === 'function') {
                renderPermissionBootstrapError({ containerId: 'tabDashboard', target: document.getElementById('tabDashboard'), retry: initFinancePage });
            }
            return;
        }
        AppState.currentUser = user;
        const _userEl = document.getElementById('currentUser'); if (_userEl) _userEl.textContent = user.name || user.username;

        const canManageTransactions = financeCanManageTransactions();
        const addBtn = document.getElementById('addTransactionBtn');
        if (addBtn) addBtn.style.display = canManageTransactions ? '' : 'none';
        const addExpBtn = document.getElementById('addExpenseBtn');
        if (addExpBtn) addExpBtn.style.display = canManageTransactions ? '' : 'none';
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
    } catch (err) {
        if (err?.message === 'Invalid token') {
            window.location.href = '/';
            document.getElementById('mainApp')?.classList.add('hidden');
            if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
            return;
        }
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        if (typeof handleStandaloneInitError === 'function') {
            handleStandaloneInitError('finance', err, (failure) => {
                renderStandaloneFatalError({
                    moduleName: 'finance',
                    containerId: 'tabDashboard',
                    title: 'Не вдалося відкрити фінанси',
                    message: 'Авторизація пройшла, але ініціалізація фінансового модуля впала.',
                    error: failure
                });
            });
        } else {
            console.error('[finance:init] runtime failure', err);
        }
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
    FinState.mode = getInitialFinanceMode();
    FinState.currentTab = getInitialFinanceTab();
    await fetchUnifiedOverview();
    setFinanceMode(FinState.mode, { tab: FinState.currentTab });

    // Tab clicks
    document.querySelectorAll('.fin-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.querySelectorAll('.fa-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setFinanceMode(btn.dataset.mode, { tab: FinState.currentTab }));
    });

    document.getElementById('faActionRail')?.addEventListener('click', (event) => {
        const card = event.target.closest('[data-fa-action]');
        if (!card) return;
        const action = card.dataset.faAction;
        if (action === 'insights') setFinanceMode('insights');
        else switchTab(action);
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
    document.getElementById('cancelTransBtn')?.addEventListener('click', () => closeTransModal(false));

    // Type change → update category options
    document.getElementById('editType')?.addEventListener('change', (e) => {
        updateCategoryOptions(e.target.value);
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal?.id === 'transEditModal') closeTransModal(false);
            else if (modal?.id === 'addAccountModal') closeAddAccountModal(false);
            else modal?.classList.add('hidden');
        });
    });

    // Modal backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target !== modal) return;
            if (modal.id === 'transEditModal') closeTransModal(false);
            else if (modal.id === 'addAccountModal') closeAddAccountModal(false);
            else modal.classList.add('hidden');
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
    document.getElementById('salaryMonth')?.addEventListener('change', () => {
        FinState.creatingSalaryScheme = false;
        fetchSalaryReport();
    });
    document.querySelectorAll('.salary-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setSalaryMode(btn.dataset.mode));
    });
    document.getElementById('salaryCreateSchemeBtn')?.addEventListener('click', () => {
        if (!financeCanUsePayrollAction('manage_payroll_rules')) {
            showNotification('Недостатньо прав для керування правилами payroll', 'error');
            return;
        }
        if (!FinState.selectedSalaryStaffId) {
            const first = getSalaryRows()[0];
            FinState.selectedSalaryStaffId = first?.staffId || first?.id || null;
        }
        FinState.creatingSalaryScheme = true;
        setSalaryMode('builder');
    });
    document.getElementById('salaryGenerateReportBtn')?.addEventListener('click', generateSalaryReport);
    document.getElementById('salaryStaffList')?.addEventListener('click', (event) => {
        const item = event.target.closest('[data-staff-id]');
        if (!item) return;
        FinState.selectedSalaryStaffId = item.dataset.staffId;
        FinState.creatingSalaryScheme = false;
        renderSalaryWorkspace();
    });
    document.getElementById('salaryMainPanel')?.addEventListener('input', (event) => {
        if (!event.target.classList.contains('salary-builder-input')) return;
        updateSalaryBuilderPreview();
    });
    document.getElementById('salaryMainPanel')?.addEventListener('change', (event) => {
        if (event.target.matches('[data-field="schemeType"]')) {
            const fields = document.getElementById('salaryBuilderFields');
            const row = getSelectedSalaryRow();
            if (fields && row) fields.innerHTML = renderSalaryBuilderFields(event.target.value, {}, row);
            updateSalaryBuilderPreview();
            return;
        }
        if (event.target.classList.contains('salary-builder-input')) updateSalaryBuilderPreview();
    });
    document.getElementById('salaryMainPanel')?.addEventListener('click', (event) => {
        const actionButton = event.target.closest('[data-payroll-action]');
        if (actionButton) {
            event.preventDefault();
            event.stopPropagation();
            handleFinancePayrollAction(actionButton);
            return;
        }
        const row = event.target.closest('tr[data-staff-id]');
        if (row) {
            FinState.selectedSalaryStaffId = row.dataset.staffId;
            renderSalaryWorkspace();
            return;
        }
        if (event.target.id === 'salarySaveSchemeBtn') saveSalaryScheme();
        if (event.target.id === 'salaryResetBuilderBtn') {
            FinState.creatingSalaryScheme = false;
            renderSalaryWorkspace();
        }
        if (event.target.id === 'salaryReportRefreshBtn') fetchSalaryReport();
        if (event.target.id === 'salaryReportExportBtn') exportPayrollCSV();
        if (event.target.id === 'salaryReportExportXlsxBtn') exportPayrollXLSX();
    });
    document.getElementById('salaryPreviewPanel')?.addEventListener('click', (event) => {
        const actionButton = event.target.closest('[data-payroll-action]');
        if (!actionButton) return;
        event.preventDefault();
        event.stopPropagation();
        handleFinancePayrollAction(actionButton);
    });

    // v30.6: Shift buttons
    document.getElementById('openShiftBtn')?.addEventListener('click', openShift);
    document.getElementById('closeShiftBtn')?.addEventListener('click', closeShift);

    // v30.6: Currency converter
    document.getElementById('convertCurrencyBtn')?.addEventListener('click', convertCurrency);
    document.getElementById('openCurrencyRatesBtn')?.addEventListener('click', () => openCurrencyRatesModal({ updateUrl: true }));
    document.getElementById('refreshCurrencyRatesBtn')?.addEventListener('click', () => loadCurrencyRatesModal({ force: true }));
    window.addEventListener('finance:open-currency-rates', () => openCurrencyRatesModal({ updateUrl: true }));
    if (new URLSearchParams(window.location.search).get('currency') === 'rates' || window.location.hash === '#currency-rates') {
        setTimeout(() => openCurrencyRatesModal({ updateUrl: false }), 0);
    }
}

document.addEventListener('DOMContentLoaded', () => { void initFinancePage(); });

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

const FINANCE_CURRENCY_ORDER = ['USD', 'EUR', 'GBP', 'PLN', 'CZK'];

function formatCurrencyRate(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return 'н/д';
    return amount.toLocaleString('uk-UA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatCurrencyUpdatedAt(value) {
    if (!value) return 'оновлення не вказано';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function loadCurrencyRatesModal() {
    const grid = document.getElementById('currencyRatesGrid');
    const meta = document.getElementById('currencyRatesMeta');
    if (grid) grid.innerHTML = '<div class="currency-rates-note" style="grid-column:1/-1">Завантажую курси...</div>';
    if (meta) meta.textContent = 'Оновлюю курси...';
    try {
        const data = await apiRequest('GET', '/api/finance/currency/rates');
        const rates = data?.rates || {};
        const cards = FINANCE_CURRENCY_ORDER.map(code => {
            const value = rates[code];
            return `<article class="currency-rate-card">
                <div class="currency-rate-code">${escapeHtml(code)}</div>
                <div class="currency-rate-value">₴${escapeHtml(formatCurrencyRate(value))}</div>
                <div class="currency-rate-caption">за 1 ${escapeHtml(code)}</div>
            </article>`;
        }).join('');
        if (grid) grid.innerHTML = cards || '<div class="currency-rates-error" style="grid-column:1/-1">Курси тимчасово недоступні.</div>';
        if (meta) meta.textContent = `База: ${escapeHtml(data?.base || 'UAH')} · ${formatCurrencyUpdatedAt(data?.updatedAt || data?.date)}`;
    } catch (err) {
        if (grid) grid.innerHTML = `<div class="currency-rates-error" style="grid-column:1/-1">${escapeHtml(err.message || 'Не вдалося завантажити курси валют')}</div>`;
        if (meta) meta.textContent = 'Курси тимчасово недоступні';
    }
}

function openCurrencyRatesModal(options = {}) {
    const modal = document.getElementById('currencyRatesModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (options.updateUrl) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('currency', 'rates');
            window.history.replaceState({}, '', url.toString());
        } catch {}
    }
    loadCurrencyRatesModal();
}

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
            const typeLabel = { cash: 'Готівка', card: 'Карта', bank: 'Банк', personal: 'Особистий' }[a.type] || a.type;
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
    const modal = document.getElementById('addAccountModal');
    document.getElementById('accName').value = '';
    document.getElementById('accEmoji').value = '💳';
    document.getElementById('accType').value = 'cash';
    document.getElementById('accDescription').value = '';
    const personalInput = document.getElementById('accIsPersonal');
    if (personalInput) personalInput.checked = false;
    _accountModalInitialState = getAccountModalState();
    modal?.classList.remove('hidden');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
}

async function closeAddAccountModal(force = false) {
    const modal = document.getElementById('addAccountModal');
    if (!modal) return true;

    const closeNow = () => {
        modal.classList.add('hidden');
        _accountModalInitialState = getAccountModalState();
    };

    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            force,
            isDirty: isAccountModalDirty,
            message: 'Є незбережені зміни в рахунку. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }

    if (!force && isAccountModalDirty() && typeof confirmModal === 'function') {
        const confirmed = await confirmModal('Є незбережені зміни в рахунку. Закрити без збереження?', {
            type: 'warning',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
        if (!confirmed) return false;
    }

    closeNow();
    return true;
}

async function saveAccount() {
    const name = document.getElementById('accName')?.value?.trim();
    if (!name) { showNotification('Введи назву', 'error'); return; }
    try {
        const isPersonal = document.getElementById('accIsPersonal')?.checked === true;
        await apiRequest('POST', '/api/finance/accounts', {
            name,
            emoji: document.getElementById('accEmoji')?.value || '💳',
            type: document.getElementById('accType')?.value,
            description: document.getElementById('accDescription')?.value?.trim() || null,
            isPersonal
        });
        const modal = document.getElementById('addAccountModal');
        if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.markClean(modal);
        await closeAddAccountModal(true);
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
