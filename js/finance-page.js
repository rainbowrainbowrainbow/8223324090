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

const SALARY_SCHEME_LABELS = {
    per_shift: 'Сума за вихід',
    hourly: 'Погодинна',
    monthly_fixed: 'Фікс за місяць',
    percent: 'Відсоток',
    hybrid: 'Гібридна',
    manual: 'Ручна'
};

const SALARY_STATUS_LABELS = {
    draft: 'Чернетка',
    reviewed: 'Перевірено',
    approved: 'Затверджено',
    paid: 'Виплачено'
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
    return schemes.find(s => String(s.id) === String(row.schemeId))
        || schemes.find(s => String(s.staffId) === String(row.staffId || row.id) && s.isActive)
        || null;
}

function salaryNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function salarySchemePill(type) {
    const schemeType = type || 'hourly';
    return `<span class="salary-pill ${schemeType}">${SALARY_SCHEME_LABELS[schemeType] || schemeType}</span>`;
}

function salaryStatusPill(status) {
    const value = status || 'draft';
    return `<span class="salary-status ${value}">${SALARY_STATUS_LABELS[value] || value}</span>`;
}

function renderSalaryWorkspace() {
    renderSalaryModeButtons();
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
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
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
        return `
            <button type="button" class="salary-staff-item ${active ? 'active' : ''}" data-staff-id="${staffId}">
                <span style="min-width:0">
                    <span class="salary-staff-name">${escapeHtml(row.name)}</span>
                    <span class="salary-staff-meta">${escapeHtml(DEPT_LABELS[row.department] || row.department || '—')} · ${escapeHtml(row.position || row.roleType || '—')}</span>
                    <span style="display:block;margin-top:6px">${salarySchemePill(row.schemeType)}</span>
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
            <div class="salary-summary-card"><b>${formatMoney(totals.base || 0)}</b><span>База</span></div>
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
                        <div><span class="salary-muted">Статус звіту</span><br>${salaryStatusPill(selected.status)}</div>
                        <div><span class="salary-muted">Години</span><br><b>${salaryNumber(selected.hoursWorked || selected.totalHours).toLocaleString('uk-UA')} год</b></div>
                        <div><span class="salary-muted">Виходи</span><br><b>${salaryNumber(selected.daysWorked || selected.shifts).toLocaleString('uk-UA')}</b></div>
                    </div>
                ` : '<div class="salary-muted">Оберіть працівника у списку.</div>'}
            </div>
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

    panel.innerHTML = `
        <div class="salary-panel-title">
            <h3>${FinState.creatingSalaryScheme || !scheme ? 'Нова зарплатна схема' : 'Конструктор схеми'}</h3>
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
        </div>
        <div id="salaryBuilderFields">${renderSalaryBuilderFields(schemeType, config, row)}</div>
        <div class="salary-inline-result">
            <span>Preview до виплати</span>
            <b id="salaryBuilderNet">${formatMoney(0)}</b>
        </div>
        <div class="salary-actions">
            <button type="button" class="btn-page-secondary" id="salaryResetBuilderBtn">Скинути</button>
            <button type="button" class="btn-page-primary" id="salarySaveSchemeBtn">Зберегти схему</button>
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
    const advance = (Array.isArray(c.advances) && c.advances[0]) || {};
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
                <h4>Аванси / вже виплачено</h4>
                <div class="salary-form-grid">
                    <div><label>Назва</label><input type="text" class="salary-builder-input" data-field="advanceLabel" value="${escapeHtml(advance.label || 'Аванс')}"></div>
                    <div><label>Сума</label><input type="number" min="0" step="1" class="salary-builder-input" data-field="advanceAmount" value="${salaryNumber(advance.amount ?? c.advanceAmount)}"></div>
                </div>
            </div>
        </div>
    `;
}

function fieldValue(name) {
    return document.getElementById('salaryMainPanel')?.querySelector(`[data-field="${name}"]`)?.value || '';
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
        config = { monthlyAmount: salaryNumber(fieldValue('monthlyAmount')) };
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
        config = {
            base: {
                kind: fieldValue('baseKind') || 'hourly',
                rate: salaryNumber(fieldValue('baseRate')),
                amount: salaryNumber(fieldValue('baseRate')),
                quantity: salaryNumber(fieldValue('baseQuantity'))
            },
            bonusRules: bonusAmount ? [{ kind: 'fixed', label: fieldValue('bonusLabel') || 'Премія', amount: bonusAmount }] : [],
            percentRules: percentRate ? [{ kind: 'percent', label: 'Відсоток', rate: percentRate, baseAmount: salaryNumber(fieldValue('hybridPercentBase')) }] : [],
            deductions: deductionAmount ? [{ kind: 'fixed', label: fieldValue('deductionLabel') || 'Утримання', amount: deductionAmount }] : [],
            advances: advanceAmount ? [{ kind: 'fixed', label: fieldValue('advanceLabel') || 'Аванс', amount: advanceAmount }] : []
        };
    }

    return { row, schemeType: type, title, config };
}

function payrollSummaryFromLines(lines) {
    const grossGroups = ['base', 'bonus', 'percent', 'manual'];
    const base = lines.filter(x => x.group === 'base').reduce((sum, x) => sum + salaryNumber(x.amount), 0);
    const bonuses = lines.filter(x => x.group === 'bonus').reduce((sum, x) => sum + salaryNumber(x.amount), 0);
    const percent = lines.filter(x => x.group === 'percent').reduce((sum, x) => sum + salaryNumber(x.amount), 0);
    const manual = lines.filter(x => x.group === 'manual').reduce((sum, x) => sum + salaryNumber(x.amount), 0);
    const gross = lines.filter(x => grossGroups.includes(x.group)).reduce((sum, x) => sum + salaryNumber(x.amount), 0);
    const deductions = lines.filter(x => x.group === 'deduction').reduce((sum, x) => sum + Math.abs(salaryNumber(x.amount)), 0);
    const advances = lines.filter(x => x.group === 'advance').reduce((sum, x) => sum + Math.abs(salaryNumber(x.amount)), 0);
    return { base, bonuses, percent, manual, gross, deductions, advances, net: gross - deductions - advances };
}

function calcSalaryDraftPreview() {
    const draft = collectSalaryBuilderDraft();
    const row = draft.row || {};
    const cfg = draft.config || {};
    const lines = [];
    const add = (group, label, amount, quantity, rate) => lines.push({ group, label, amount: Math.round(salaryNumber(amount)), quantity, rate });

    if (draft.schemeType === 'per_shift') {
        add('base', 'Сума за вихід', cfg.rate * cfg.shiftCount, cfg.shiftCount, cfg.rate);
    } else if (draft.schemeType === 'hourly') {
        add('base', 'Погодинна ставка', cfg.hourlyRate * cfg.hours, cfg.hours, cfg.hourlyRate);
    } else if (draft.schemeType === 'monthly_fixed') {
        add('base', 'Фікс за місяць', cfg.monthlyAmount);
    } else if (draft.schemeType === 'percent') {
        add('percent', `Відсоток ${cfg.percentRate}%`, cfg.percentBase * cfg.percentRate / 100, cfg.percentBase, cfg.percentRate);
    } else if (draft.schemeType === 'manual') {
        add('manual', 'Ручна сума', cfg.manualAmount);
    } else {
        const base = cfg.base || {};
        if (base.kind === 'monthly_fixed' || base.kind === 'manual') add('base', SALARY_SCHEME_LABELS[base.kind], base.amount || base.rate);
        else add('base', SALARY_SCHEME_LABELS[base.kind] || 'База', salaryNumber(base.rate) * salaryNumber(base.quantity), base.quantity, base.rate);
        (cfg.bonusRules || []).forEach(x => add('bonus', x.label || 'Бонус', x.amount));
        (cfg.percentRules || []).forEach(x => add('percent', x.label || 'Відсоток', salaryNumber(x.baseAmount) * salaryNumber(x.rate) / 100, x.baseAmount, x.rate));
        (cfg.deductions || []).forEach(x => add('deduction', x.label || 'Утримання', x.amount));
        (cfg.advances || []).forEach(x => add('advance', x.label || 'Аванс', x.amount));
    }

    return {
        name: row.name || '',
        schemeType: draft.schemeType,
        schemeTitle: draft.title,
        lines,
        summary: payrollSummaryFromLines(lines),
        status: 'draft'
    };
}

function renderSalaryPreviewPanel() {
    const panel = document.getElementById('salaryPreviewPanel');
    if (!panel) return;
    const payload = FinState.salaryMode === 'builder' ? calcSalaryDraftPreview() : getSelectedSalaryRow();
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
    panel.innerHTML = `
        <div class="salary-panel-title">
            <h4>Preview / Payslip</h4>
            ${salaryStatusPill(payload.status)}
        </div>
        <div style="margin-bottom:12px">
            <div style="font-weight:900">${escapeHtml(payload.name || 'Нова схема')}</div>
            <div style="margin-top:6px">${salarySchemePill(payload.schemeType)}</div>
        </div>
        <div class="salary-preview-card">
            <div class="salary-preview-row"><span>База</span><b>${formatMoney(summary.base || 0)}</b></div>
            <div class="salary-preview-row"><span>Бонуси / %</span><b class="salary-plus">+ ${formatMoney((summary.bonuses || 0) + (summary.percent || 0) + (summary.manual || 0))}</b></div>
            <div class="salary-preview-row"><span>Утримання</span><b class="salary-minus">- ${formatMoney(summary.deductions || 0)}</b></div>
            <div class="salary-preview-row"><span>Аванси</span><b class="salary-minus">- ${formatMoney(summary.advances || 0)}</b></div>
            <div class="salary-preview-total"><span>До виплати</span><b>${formatMoney(summary.net || 0)}</b></div>
        </div>
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
    if (net) net.textContent = formatMoney(calcSalaryDraftPreview().summary.net);
    renderSalaryPreviewPanel();
}

async function saveSalaryScheme() {
    const draft = collectSalaryBuilderDraft();
    if (!draft.row) return;
    const existing = FinState.creatingSalaryScheme ? null : getEditableSchemeForRow(draft.row);
    const body = {
        staffId: draft.row.staffId || draft.row.id,
        schemeType: draft.schemeType,
        title: draft.title,
        isActive: true,
        config: draft.config
    };
    try {
        if (existing?.id) await apiRequest('PATCH', `/api/payroll/schemes/${existing.id}`, body);
        else await apiRequest('POST', '/api/payroll/schemes', body);
        FinState.creatingSalaryScheme = false;
        showNotification('Зарплатну схему збережено');
        await fetchSalaryReport();
        FinState.salaryMode = 'builder';
        renderSalaryWorkspace();
    } catch (err) {
        showNotification(err.message || 'Не вдалося зберегти схему', 'error');
    }
}

async function generateSalaryReport() {
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
                <div class="salary-muted">Breakdown по схемах, нарахуваннях, утриманнях і авансах.</div>
            </div>
            <button type="button" class="btn-page-secondary" id="salaryReportRefreshBtn">Оновити</button>
        </div>
        <div class="fin-table-wrap">
            <table class="fin-table">
                <thead>
                    <tr>
                        <th>Працівник</th>
                        <th>Відділ</th>
                        <th>Посада</th>
                        <th>Схема</th>
                        <th>База</th>
                        <th>Бонуси / %</th>
                        <th>Утримання</th>
                        <th>Аванс</th>
                        <th>До виплати</th>
                        <th>Статус</th>
                    </tr>
                </thead>
                <tbody id="salaryTableBody">
                    ${rows.map(row => `
                        <tr data-staff-id="${row.staffId || row.id}">
                            <td style="font-weight:700">${escapeHtml(row.name)}</td>
                            <td>${escapeHtml(DEPT_LABELS[row.department] || row.department || '—')}</td>
                            <td>${escapeHtml(row.position || row.roleType || '—')}</td>
                            <td>${salarySchemePill(row.schemeType)}</td>
                            <td>${formatMoney(row.baseAmount || 0)}</td>
                            <td class="salary-plus">${formatMoney(row.bonusesAmount || 0)}</td>
                            <td class="salary-minus">${formatMoney(row.deductionsAmount || 0)}</td>
                            <td class="salary-minus">${formatMoney(row.advancesAmount || 0)}</td>
                            <td class="fin-amount-expense">${formatMoney(row.netAmount || row.estimatedSalary || 0)}</td>
                            <td>${salaryStatusPill(row.status)}</td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot id="salaryTableFoot">
                    <tr>
                        <td colspan="4" style="text-align:right;font-weight:900">Разом:</td>
                        <td>${formatMoney(totals.base || 0)}</td>
                        <td class="salary-plus">${formatMoney(totals.bonuses || 0)}</td>
                        <td class="salary-minus">${formatMoney(totals.deductions || 0)}</td>
                        <td class="salary-minus">${formatMoney(totals.advances || 0)}</td>
                        <td class="fin-amount-expense">${formatMoney(totals.net || data.totalSalary || 0)}</td>
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
        document.getElementById('mainApp')?.classList.add('hidden');
        if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
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
    });

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
