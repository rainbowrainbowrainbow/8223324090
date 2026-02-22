/**
 * js/analytics-page.js — Unified Analytics dashboard (v16.1)
 *
 * Cross-module KPIs, charts, comparisons: bookings + finance + HR + CRM.
 */

/* global apiRequest, apiVerifyToken, initDarkMode, showNotification */

// ==========================================
// STATE
// ==========================================

const AnState = {
    period: 'month',
    customFrom: null,
    customTo: null,
    overview: null,
    charts: null,
    comparison: null
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
            <div class="an-kpi-value" style="font-size:22px">${fmtMoney(f.income)} <span style="font-size:16px;color:var(--gray-400)">/</span> <span style="color:#EF4444">${fmtMoney(f.expense)}</span></div>
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
            <div class="an-kpi-value" style="font-size:22px">${h.totalHours || 0} <span style="font-size:14px;color:var(--gray-400)">год</span> / ${h.activeStaff || 0} <span style="font-size:14px;color:var(--gray-400)">осіб</span></div>
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
                    <div class="an-legend-item"><div class="an-legend-dot" style="background:#10B981"></div> Виручка</div>
                    <div class="an-legend-item"><div class="an-legend-dot" style="background:#3B82F6"></div> Кількість</div>
                </div>
            </div>

            <div class="an-chart-container">
                <div class="an-chart-title">Фінансові потоки по днях</div>
                <div id="dailyFinanceChart" class="an-bar-chart"></div>
                <div class="an-legend">
                    <div class="an-legend-item"><div class="an-legend-dot" style="background:#10B981"></div> Доходи</div>
                    <div class="an-legend-item"><div class="an-legend-dot" style="background:#EF4444"></div> Витрати</div>
                </div>
            </div>

            <div class="an-charts-row">
                <div class="an-chart-container">
                    <div class="an-chart-title">Топ-10 програм за виручкою</div>
                    <div id="topProgramsChart"></div>
                </div>
                <div class="an-chart-container">
                    <div class="an-chart-title">Навантаження по днях тижня</div>
                    <div id="weekdayChart" class="an-bar-chart" style="height:120px"></div>
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
    if (!daily.length) { el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px">Немає даних</div>'; return; }
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
    if (!daily.length) { el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px">Немає даних</div>'; return; }
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
    if (!programs.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:8px">Немає даних</div>'; return; }
    const maxRev = Math.max(...programs.map(p => p.revenue), 1);
    el.innerHTML = `<table class="an-mini-table">${programs.map((p, i) => {
        const rankClass = i < 3 ? `rank-${i + 1}` : 'rank-n';
        return `<tr>
            <td style="width:40px"><span class="rank ${rankClass}">${i + 1}</span></td>
            <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name || '—'}</td>
            <td style="width:40px;text-align:center;font-size:12px;color:var(--gray-400)">${p.count}x</td>
            <td style="text-align:right;font-weight:700;color:#10B981">${fmtMoney(p.revenue)}</td>
        </tr>`;
    }).join('')}</table>`;
}

function renderWeekdayChart(weekday) {
    const el = document.getElementById('weekdayChart');
    if (!weekday.length) { el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:30px">Немає даних</div>'; return; }
    const maxCnt = Math.max(...weekday.map(w => w.count), 1);
    el.innerHTML = weekday.map(w => {
        const h = Math.max((w.count / maxCnt) * 100, 2);
        return `<div class="an-bar-group">
            <div class="an-bar-pair" style="height:100px">
                <div class="an-bar purple" style="height:${h}px" title="${w.name}: ${w.count} бронювань, ${fmtMoney(w.revenue)}"></div>
            </div>
            <div class="an-bar-label">${w.name}</div>
        </div>`;
    }).join('');
}

function renderFinCategories(cats) {
    const el = document.getElementById('finCatsChart');
    if (!cats.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:8px">Немає даних</div>'; return; }
    const maxTotal = Math.max(...cats.map(c => c.total), 1);
    el.innerHTML = cats.slice(0, 8).map(c => `
        <div class="an-hbar-row">
            <span class="an-hbar-label">${c.icon || ''} ${c.name}</span>
            <div class="an-hbar-track">
                <div class="an-hbar-fill" style="width:${Math.round(c.total / maxTotal * 100)}%;background:${c.color || '#6366F1'}"></div>
            </div>
            <span class="an-hbar-value">${fmtMoney(c.total)}</span>
        </div>
    `).join('');
}

function renderSegments(seg) {
    const el = document.getElementById('segmentsChart');
    if (!seg || !seg.total) { el.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:8px">Немає даних</div>'; return; }
    el.innerHTML = `
        <div class="an-segments">
            <div class="an-segment">
                <div class="an-segment-count" style="color:#10B981">${seg.champions || 0}</div>
                <div class="an-segment-label">Чемпіони (5+)</div>
            </div>
            <div class="an-segment">
                <div class="an-segment-count" style="color:#3B82F6">${seg.loyal || 0}</div>
                <div class="an-segment-label">Лояльні (3-4)</div>
            </div>
            <div class="an-segment">
                <div class="an-segment-count" style="color:#F59E0B">${seg.potential || 0}</div>
                <div class="an-segment-label">Нові (1-2)</div>
            </div>
            <div class="an-segment">
                <div class="an-segment-count" style="color:#94A3B8">${seg.inactive || 0}</div>
                <div class="an-segment-label">Неактивні</div>
            </div>
        </div>
        <div style="text-align:center;margin-top:8px;font-size:12px;color:var(--gray-400)">Всього: ${seg.total} клієнтів</div>
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
                <div class="an-chart-title" style="margin-bottom:8px">
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
                                <td style="font-weight:700">${fmt(m.current)}</td>
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
    document.getElementById('customRange').classList.toggle('visible', period === 'custom');
    if (period !== 'custom') refreshAll();
}

function applyCustomRange() {
    const from = document.getElementById('customFrom').value;
    const to = document.getElementById('customTo').value;
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
    fetchComparison();
}

// ==========================================
// INIT
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof initDarkMode === 'function') initDarkMode();

    const token = localStorage.getItem('token');
    if (!token) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    try {
        const user = await apiVerifyToken();
        if (!user) throw new Error('Invalid token');
        document.getElementById('currentUser').textContent = user.name || user.username;
    } catch {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('token');
        window.location.href = '/';
    });

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
});
