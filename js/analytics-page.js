/**
 * js/analytics-page.js — Unified Analytics dashboard (v16.1)
 *
 * Cross-module KPIs, charts, comparisons: bookings + finance + HR + CRM.
 */

/* global apiVerifyToken, initDarkMode */

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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


// ==========================================
// STATE
// ==========================================

const AnState = {
    period: 'month',
    customFrom: null,
    customTo: null,
    overview: null,
    charts: null,
    comparison: null,
    dealsLifecycle: null
};

// ==========================================
// FORMATTING
// ==========================================

function fmtMoney(amount) {
    if (!amount && amount !== 0) return '0 ₴';
    return amount.toLocaleString('uk-UA') + ' ₴';
}

function fmtDate(dateStr) {
    if (!dateStr) return '—';
    const p = dateStr.split('-');
    return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : dateStr;
}

function fmtNum(n) {
    if (!n && n !== 0) return '0';
    return n.toLocaleString('uk-UA');
}

function safeCssAccent(value, fallback = '#6366F1') {
    const color = String(value || '').trim();
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback;
}

function growthBadge(pct) {
    if (pct > 0) return `<span class="an-growth up">▲ ${pct}%</span>`;
    if (pct < 0) return `<span class="an-growth down">▼ ${Math.abs(pct)}%</span>`;
    return `<span class="an-growth flat">— 0%</span>`;
}

// ==========================================
// API
// ==========================================

function getParams() {
    if (AnState.period === 'custom' && AnState.customFrom && AnState.customTo) {
        return `from=${AnState.customFrom}&to=${AnState.customTo}`;
    }
    return `period=${AnState.period}`;
}

async function fetchOverview() {
    try {
        const res = await apiRequest('GET', `/api/analytics/overview?${getParams()}`);
        AnState.overview = res;
        renderKPIs(res);
    } catch (err) {
        console.error('Failed to fetch overview', err);
    }
}

async function fetchCharts() {
    try {
        const res = await apiRequest('GET', `/api/analytics/charts?${getParams()}`);
        AnState.charts = res;
        renderCharts(res);
    } catch (err) {
        console.error('Failed to fetch charts', err);
    }
}

async function fetchComparison() {
    try {
        const res = await apiRequest('GET', `/api/analytics/comparison?${getParams()}`);
        AnState.comparison = res;
        renderComparison(res);
    } catch (err) {
        console.error('Failed to fetch comparison', err);
    }
}

async function fetchDealsLifecycle() {
    try {
        const res = await apiRequest('GET', `/api/analytics/deals-lifecycle?${getParams()}`);
        AnState.dealsLifecycle = res;
        renderDealsLifecycle(res);
    } catch (err) {
        console.error('Failed to fetch deals lifecycle', err);
    }
}

// ==========================================
// RENDER — KPI CARDS
// ==========================================

function renderKPIs(data) {
    const el = document.getElementById('kpiGrid');
    if (!data) { el.innerHTML = ''; return; }

    const b = data.bookings || {};
    const f = data.finance || {};
    const c = data.customers || {};
    const h = data.hr || {};

    el.innerHTML = `
        <div class="an-kpi-card green">
            <div class="an-kpi-label">Виручка бронювань</div>
            <div class="an-kpi-value">${fmtMoney(b.revenue)}</div>
            <div class="an-kpi-sub">
                ${growthBadge(b.revenueGrowth)}
                <span class="an-kpi-prev">vs ${fmtMoney(b.prevRevenue)}</span>
            </div>
        </div>
        <div class="an-kpi-card blue">
            <div class="an-kpi-label">Бронювань</div>
            <div class="an-kpi-value">${fmtNum(b.total)}</div>
            <div class="an-kpi-sub">
                ${growthBadge(b.countGrowth)}
                <span class="an-kpi-prev">${b.confirmed || 0} підтв / ${b.preliminary || 0} попер</span>
            </div>
        </div>
        <div class="an-kpi-card purple">
            <div class="an-kpi-label">Середній чек</div>
            <div class="an-kpi-value">${fmtMoney(b.avgCheck)}</div>
            <div class="an-kpi-sub">
                ${growthBadge(b.avgGrowth)}
            </div>
        </div>
        <div class="an-kpi-card orange">
            <div class="an-kpi-label">Фін. дохід / витрати</div>
            <div class="an-kpi-value an-kpi-value--split">
                ${fmtMoney(f.income)}
                <span class="an-inline-divider">/</span>
                <span class="an-danger-text">${fmtMoney(f.expense)}</span>
            </div>
            <div class="an-kpi-sub">
                ${growthBadge(f.profitGrowth)}
                <span class="an-kpi-prev">Прибуток: ${fmtMoney(f.profit)}</span>
            </div>
        </div>
        <div class="an-kpi-card teal">
            <div class="an-kpi-label">Нових клієнтів</div>
            <div class="an-kpi-value">${fmtNum(c.newCustomers)}</div>
            <div class="an-kpi-sub">
                ${growthBadge(c.newGrowth)}
                <span class="an-kpi-prev">vs ${fmtNum(c.prevNew)}</span>
            </div>
        </div>
        <div class="an-kpi-card red">
            <div class="an-kpi-label">HR: годин / працівників</div>
            <div class="an-kpi-value an-kpi-value--split">
                ${h.totalHours || 0} <span class="an-inline-meta">год</span>
                <span class="an-inline-divider">/</span>
                ${h.activeStaff || 0} <span class="an-inline-meta">осіб</span>
            </div>
        </div>
    `;
}

// ==========================================
// RENDER — CHARTS
// ==========================================

function renderCharts(data) {
    const el = document.getElementById('chartsContent');
    if (!data) { el.innerHTML = ''; return; }

    el.innerHTML = `
        <div class="an-section">
            <h3 class="an-section-title">Графіки за період</h3>

            <div class="an-chart-container">
                <div class="an-chart-title">Доходи бронювань по днях</div>
                <div id="dailyBookingsChart" class="an-bar-chart"></div>
                <div class="an-legend">
                    <div class="an-legend-item"><div class="an-legend-dot an-legend-dot--success"></div> Виручка</div>
                    <div class="an-legend-item"><div class="an-legend-dot an-legend-dot--info"></div> Кількість</div>
                </div>
            </div>

            <div class="an-chart-container">
                <div class="an-chart-title">Фінансові потоки по днях</div>
                <div id="dailyFinanceChart" class="an-bar-chart"></div>
                <div class="an-legend">
                    <div class="an-legend-item"><div class="an-legend-dot an-legend-dot--success"></div> Доходи</div>
                    <div class="an-legend-item"><div class="an-legend-dot an-legend-dot--danger"></div> Витрати</div>
                </div>
            </div>

            <div class="an-charts-row">
                <div class="an-chart-container">
                    <div class="an-chart-title">Топ-10 програм за виручкою</div>
                    <div id="topProgramsChart"></div>
                </div>
                <div class="an-chart-container">
                    <div class="an-chart-title">Навантаження по днях тижня</div>
                    <div id="weekdayChart" class="an-bar-chart an-bar-chart--short"></div>
                </div>
            </div>

            <div class="an-charts-row">
                <div class="an-chart-container">
                    <div class="an-chart-title">Фінансові категорії</div>
                    <div id="finCatsChart"></div>
                </div>
                <div class="an-chart-container">
                    <div class="an-chart-title">Сегменти клієнтів</div>
                    <div id="segmentsChart"></div>
                </div>
            </div>
        </div>
    `;

    renderDailyBookingsChart(data.dailyBookings || []);
    renderDailyFinanceChart(data.dailyFinance || []);
    renderTopPrograms(data.topPrograms || []);
    renderWeekdayChart(data.weekdayLoad || []);
    renderFinCategories(data.financeCategories || []);
    renderSegments(data.customerSegments || {});
}

function renderDailyBookingsChart(daily) {
    const el = document.getElementById('dailyBookingsChart');
    if (!daily.length) { el.innerHTML = '<div class="an-empty-state">Немає даних</div>'; return; }
    const maxRev = Math.max(...daily.map(d => d.revenue), 1);
    const maxCnt = Math.max(...daily.map(d => d.count), 1);
    el.innerHTML = daily.map(d => {
        const revH = Math.max((d.revenue / maxRev) * 140, 2);
        const cntH = Math.max((d.count / maxCnt) * 140, 2);
        return `<div class="an-bar-group">
            <div class="an-bar-pair">
                <div class="an-bar green" style="height:${revH}px" title="${fmtMoney(d.revenue)}"></div>
                <div class="an-bar blue" style="height:${cntH}px" title="${d.count} бронювань"></div>
            </div>
            <div class="an-bar-label">${d.date.substring(8)}</div>
        </div>`;
    }).join('');
}

function renderDailyFinanceChart(daily) {
    const el = document.getElementById('dailyFinanceChart');
    if (!daily.length) { el.innerHTML = '<div class="an-empty-state">Немає даних</div>'; return; }
    const maxVal = Math.max(...daily.map(d => Math.max(d.income, d.expense)), 1);
    el.innerHTML = daily.map(d => {
        const incH = Math.max((d.income / maxVal) * 140, 2);
        const expH = Math.max((d.expense / maxVal) * 140, 2);
        return `<div class="an-bar-group">
            <div class="an-bar-pair">
                <div class="an-bar green" style="height:${incH}px" title="Дохід: ${fmtMoney(d.income)}"></div>
                <div class="an-bar red" style="height:${expH}px" title="Витрати: ${fmtMoney(d.expense)}"></div>
            </div>
            <div class="an-bar-label">${d.date.substring(8)}</div>
        </div>`;
    }).join('');
}

function renderTopPrograms(programs) {
    const el = document.getElementById('topProgramsChart');
    if (!programs.length) { el.innerHTML = '<div class="an-empty-state an-empty-state--compact">Немає даних</div>'; return; }
    const maxRev = Math.max(...programs.map(p => p.revenue), 1);
    el.innerHTML = `<table class="an-mini-table">${programs.map((p, i) => {
        const rankClass = i < 3 ? `rank-${i + 1}` : 'rank-n';
        return `<tr>
            <td style="width:40px"><span class="rank ${rankClass}">${i + 1}</span></td>
            <td class="an-program-name">${escapeHtml(p.name) || '—'}</td>
            <td class="an-table-count" style="width:40px">${p.count}x</td>
            <td class="an-money-positive">${fmtMoney(p.revenue)}</td>
        </tr>`;
    }).join('')}</table>`;
}

function renderWeekdayChart(weekday) {
    const el = document.getElementById('weekdayChart');
    if (!weekday.length) { el.innerHTML = '<div class="an-empty-state an-empty-state--chart">Немає даних</div>'; return; }
    const maxCnt = Math.max(...weekday.map(w => w.count), 1);
    el.innerHTML = weekday.map(w => {
        const h = Math.max((w.count / maxCnt) * 100, 2);
        return `<div class="an-bar-group">
            <div class="an-bar-pair" style="height:100px">
                <div class="an-bar purple" style="height:${h}px" title="${escapeHtml(w.name)}: ${w.count} бронювань, ${fmtMoney(w.revenue)}"></div>
            </div>
            <div class="an-bar-label">${escapeHtml(w.name)}</div>
        </div>`;
    }).join('');
}

function renderFinCategories(cats) {
    const el = document.getElementById('finCatsChart');
    if (!cats.length) { el.innerHTML = '<div class="an-empty-state an-empty-state--compact">Немає даних</div>'; return; }
    const maxTotal = Math.max(...cats.map(c => c.total), 1);
    el.innerHTML = cats.slice(0, 8).map(c => {
        const accent = safeCssAccent(c.color);
        return `
            <div class="an-hbar-row">
                <span class="an-hbar-label">${escapeHtml(c.icon) || ''} ${escapeHtml(c.name)}</span>
                <div class="an-hbar-track">
                    <div class="an-hbar-fill" style="width:${Math.round(c.total / maxTotal * 100)}%;--an-hbar-accent:${accent}"></div>
                </div>
                <span class="an-hbar-value">${fmtMoney(c.total)}</span>
            </div>
        `;
    }).join('');
}

function renderSegments(seg) {
    const el = document.getElementById('segmentsChart');
    if (!seg || !seg.total) { el.innerHTML = '<div class="an-empty-state an-empty-state--compact">Немає даних</div>'; return; }
    el.innerHTML = `
        <div class="an-segments">
            <div class="an-segment">
                <div class="an-segment-count an-segment-count--champions">${seg.champions || 0}</div>
                <div class="an-segment-label">Чемпіони (5+)</div>
            </div>
            <div class="an-segment">
                <div class="an-segment-count an-segment-count--loyal">${seg.loyal || 0}</div>
                <div class="an-segment-label">Лояльні (3-4)</div>
            </div>
            <div class="an-segment">
                <div class="an-segment-count an-segment-count--potential">${seg.potential || 0}</div>
                <div class="an-segment-label">Нові (1-2)</div>
            </div>
            <div class="an-segment">
                <div class="an-segment-count an-segment-count--inactive">${seg.inactive || 0}</div>
                <div class="an-segment-label">Неактивні</div>
            </div>
        </div>
        <div class="an-segment-total">Всього: ${seg.total} клієнтів</div>
    `;
}

function renderDealsLifecycle(data) {
    const el = document.getElementById('dealsLifecycleContent');
    if (!el) return;
    if (!data) { el.innerHTML = ''; return; }
    const maxVal = Math.max(...(data.trend || []).map(d => Math.max(d.accepted || 0, d.closed || 0)), 1);
    const bars = (data.trend || []).map(d => {
        const acceptedH = Math.max(((d.accepted || 0) / maxVal) * 120, d.accepted ? 2 : 0);
        const closedH = Math.max(((d.closed || 0) / maxVal) * 120, d.closed ? 2 : 0);
        return `<div class="an-bar-group">
            <div class="an-bar-pair" style="height:120px">
                <div class="an-bar blue" style="height:${acceptedH}px" title="Прийнято: ${d.accepted || 0}"></div>
                <div class="an-bar green" style="height:${closedH}px" title="Закрито: ${d.closed || 0}"></div>
            </div>
            <div class="an-bar-label">${String(d.date || '').substring(8)}</div>
        </div>`;
    }).join('');

    el.innerHTML = `
        <div class="an-section">
            <h3 class="an-section-title">Прийняті vs закриті угоди</h3>
            <div class="an-charts-row">
                <div class="an-chart-container">
                    <div class="an-chart-title">${fmtDate(data.period?.from)} — ${fmtDate(data.period?.to)}</div>
                    <div class="an-kpi-grid an-kpi-grid--compact">
                        <div class="an-kpi-card blue"><div class="an-kpi-label">Прийнято</div><div class="an-kpi-value">${fmtNum(data.accepted)}</div></div>
                        <div class="an-kpi-card green"><div class="an-kpi-label">Закрито</div><div class="an-kpi-value">${fmtNum(data.closed)}</div></div>
                        <div class="an-kpi-card teal"><div class="an-kpi-label">Конверсія</div><div class="an-kpi-value">${data.conversionRatio || 0}%</div></div>
                    </div>
                    <div class="an-helper-text">Accepted: deposit_received/waiting. Closed: completed/closed.</div>
                </div>
                <div class="an-chart-container">
                    <div class="an-chart-title">Динаміка за датами</div>
                    <div class="an-bar-chart an-bar-chart--deals">${bars || '<div class="an-empty-state an-empty-state--chart">Немає даних</div>'}</div>
                    <div class="an-legend">
                        <div class="an-legend-item"><div class="an-legend-dot an-legend-dot--info"></div> Прийнято</div>
                        <div class="an-legend-item"><div class="an-legend-dot an-legend-dot--success"></div> Закрито</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ==========================================
// RENDER — COMPARISON TABLE
// ==========================================

function renderComparison(data) {
    const el = document.getElementById('comparisonContent');
    if (!data || !data.metrics) { el.innerHTML = ''; return; }

    const fmtPeriod = (p) => `${fmtDate(p.from)} — ${fmtDate(p.to)}`;

    el.innerHTML = `
        <div class="an-section">
            <h3 class="an-section-title">Порівняння з попереднім періодом</h3>
            <div class="an-chart-container">
                <div class="an-chart-title an-chart-title--spaced">
                    Поточний: ${fmtPeriod(data.current)} &nbsp;vs&nbsp; Попередній: ${fmtPeriod(data.previous)}
                </div>
                <table class="an-comp-table">
                    <thead>
                        <tr>
                            <th>Метрика</th>
                            <th>Поточний</th>
                            <th>Попередній</th>
                            <th>Зміна</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.metrics.map(m => {
                            const isMoney = ['bookingRevenue', 'finIncome', 'finExpense'].includes(m.key);
                            const fmt = isMoney ? fmtMoney : fmtNum;
                            return `<tr>
                                <td>${m.label}</td>
                                <td class="an-comp-current">${fmt(m.current)}</td>
                                <td>${fmt(m.previous)}</td>
                                <td>${growthBadge(m.growth)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// ==========================================
// PERIOD SWITCHING
// ==========================================

function switchPeriod(period) {
    AnState.period = period;
    document.querySelectorAll('.an-period-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.period === period);
    });
    document.getElementById('customRange')?.classList.toggle('visible', period === 'custom');
    if (period !== 'custom') refreshAll();
}

function applyCustomRange() {
    const from = document.getElementById('customFrom')?.value;
    const to = document.getElementById('customTo')?.value;
    if (!from || !to) {
        showNotification('Оберіть обидві дати', 'error');
        return;
    }
    AnState.customFrom = from;
    AnState.customTo = to;
    refreshAll();
}

function refreshAll() {
    fetchOverview();
    fetchCharts();
    fetchDealsLifecycle();
    fetchComparison();
}

window.CrmAnalyticsWidgets = {
    renderKPIs,
    renderCharts,
    renderDailyBookingsChart,
    renderDailyFinanceChart,
    renderTopPrograms,
    renderWeekdayChart,
    renderFinCategories,
    renderSegments,
    renderDealsLifecycle,
    renderComparison,
    growthBadge,
    fmtMoney,
    fmtDate,
    fmtNum,
    safeCssAccent
};

// ==========================================
// INIT
// ==========================================

async function initStandaloneAnalyticsPage() {
    if (typeof initDarkMode === 'function') initDarkMode();

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
            handleStandaloneInitError('analytics', err, (failure) => {
                renderStandaloneFatalError({
                    moduleName: 'analytics',
                    containerId: 'kpiGrid',
                    title: 'Не вдалося відкрити аналітику',
                    message: 'Авторизація пройшла, але ініціалізація аналітики впала.',
                    error: failure
                });
            });
        } else {
            console.error('[analytics:init] runtime failure', err);
        }
        return;
    }

    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    // Period tabs
    document.querySelectorAll('.an-period-tab').forEach(btn => {
        btn.addEventListener('click', () => switchPeriod(btn.dataset.period));
    });

    // Custom range apply
    document.getElementById('applyCustomBtn')?.addEventListener('click', applyCustomRange);

    // Modal close
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.modal').classList.add('hidden'));
    });
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    });

    // Initial load
    refreshAll();
}

if (document.getElementById('kpiGrid') && document.getElementById('chartsContent')) {
    document.addEventListener('DOMContentLoaded', initStandaloneAnalyticsPage);
}
