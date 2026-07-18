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
let pricePositionsData = [];
let operationsData = null;
let operationsLoading = false;
let admissionTicketCatalog = null;
let admissionTicketCatalogLoading = false;
let admissionTicketTariffSaving = false;
let canEditAdmissionTicketTariffs = false;
const centerSectionState = new Map();

const BANQUET_TERMS_PRICE_RULES = Object.freeze([
    {
        code: 'banquet_own_cake_fee',
        label: 'Плата за свій торт',
        description: 'Сума, яка підставляється в умови банкету для власного торта.',
        unit: 'грн'
    },
    {
        code: 'banquet_cork_fee',
        label: 'Cork Fee',
        description: 'Плата за власні напої у стандартних умовах банкету.',
        unit: 'грн'
    },
    {
        code: 'banquet_menu_correction_deadline_days',
        label: 'Меню можна коригувати за',
        description: 'Крайній строк коригування меню до дати банкету.',
        unit: 'доби'
    },
    {
        code: 'banquet_date_change_deadline_days',
        label: 'Дату можна змінити за',
        description: 'Крайній строк зміни дати до дати банкету.',
        unit: 'діб'
    }
]);

// ==========================================
// NOTIFICATIONS
// ==========================================


// ==========================================
// API CALLS — existing
// ==========================================

function centerScopedApiUrl(path) {
    const apiUrl = window.CrmBusinessContext?.apiUrl;
    return typeof apiUrl === 'function' ? apiUrl(path) : path;
}

function centerApiFailure(errorOrPayload = {}, fallbackMessage = 'API error') {
    if (typeof normalizeApiErrorResult === 'function') {
        return normalizeApiErrorResult(errorOrPayload, fallbackMessage);
    }
    if (errorOrPayload?.success) return errorOrPayload;
    const payload = errorOrPayload instanceof Error
        ? { error: errorOrPayload.message, offline: true }
        : (errorOrPayload || {});
    return {
        ...payload,
        success: false,
        error: payload.error || payload.message || fallbackMessage,
        offline: Boolean(payload.offline),
        status: payload.status || null,
        requestId: payload.requestId || payload.request_id || null
    };
}

async function centerMutationJson(response, fallbackMessage = 'API error') {
    if (typeof handleAuthError === 'function' && handleAuthError(response)) {
        return centerApiFailure({ status: response?.status || 401 }, fallbackMessage);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
        return centerApiFailure({ ...body, status: response.status }, fallbackMessage);
    }
    if (body && typeof body === 'object' && !Array.isArray(body) && body.success !== true) {
        return { success: true, ...body };
    }
    return body;
}

function centerBookingIsBanquet(booking = {}) {
    const category = String(booking.category || booking.bookingCategory || '').toLowerCase();
    return category === 'banquet'
        || Boolean(booking.banquetGuests || booking.banquet_guests)
        || Boolean(booking.banquetAdults || booking.banquet_adults)
        || Boolean(booking.banquetTables || booking.banquet_tables)
        || Boolean(booking.banquetMenu || booking.banquet_menu);
}

function centerBookingDateTimeText(booking = {}) {
    const dateText = booking.date ? new Date(booking.date).toLocaleDateString('uk-UA') : '';
    const timeText = booking.time || '';
    const arrivalText = centerBookingIsBanquet(booking) && timeText ? `Прихід гостей: ${timeText}` : timeText;
    return [dateText, arrivalText].filter(Boolean).join(' ');
}

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

async function apiCenterPricePositions() {
    try {
        const response = await fetch(`${API_BASE}/center/prices/positions`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API center price positions error:', err);
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
        return await centerMutationJson(response, 'Не вдалося оновити ціну');
    } catch (err) {
        console.error('API update price error:', err);
        return centerApiFailure(err, 'Не вдалося оновити ціну');
    }
}

async function apiCreatePrice(data) {
    try {
        const response = await fetch(`${API_BASE}/center/prices`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        return await centerMutationJson(response, 'Не вдалося створити ціну');
    } catch (err) {
        console.error('API create price error:', err);
        return centerApiFailure(err, 'Не вдалося створити ціну');
    }
}

async function apiDeletePrice(code) {
    try {
        const response = await fetch(`${API_BASE}/center/prices/${code}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        return await centerMutationJson(response, 'Не вдалося видалити ціну');
    } catch (err) {
        console.error('API delete price error:', err);
        return centerApiFailure(err, 'Не вдалося видалити ціну');
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

async function apiCenterOperationsToday() {
    try {
        const response = await fetch(`${API_BASE}/center/operations/today`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API center operations error:', err);
        return null;
    }
}

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
        return await centerMutationJson(response, 'Не вдалося перерахувати лояльність');
    } catch (err) {
        console.error('API recalculate loyalty error:', err);
        return centerApiFailure(err, 'Не вдалося перерахувати лояльність');
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
        return await centerMutationJson(response, 'Не вдалося створити промокод');
    } catch (err) {
        console.error('API create discount error:', err);
        return centerApiFailure(err, 'Не вдалося створити промокод');
    }
}

async function apiDeleteDiscount(id) {
    try {
        const response = await fetch(`${API_BASE}/loyalty/discounts/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        return await centerMutationJson(response, 'Не вдалося видалити промокод');
    } catch (err) {
        console.error('API delete discount error:', err);
        return centerApiFailure(err, 'Не вдалося видалити промокод');
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
        return await centerMutationJson(response, 'Не вдалося створити пропозицію');
    } catch (err) {
        console.error('API create proposal error:', err);
        return centerApiFailure(err, 'Не вдалося створити пропозицію');
    }
}

async function apiDeleteProposal(id) {
    try {
        const response = await fetch(`${API_BASE}/loyalty/proposals/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        return await centerMutationJson(response, 'Не вдалося видалити пропозицію');
    } catch (err) {
        console.error('API delete proposal error:', err);
        return centerApiFailure(err, 'Не вдалося видалити пропозицію');
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

function formatDateShort(value) {
    if (!value) return '—';
    return new Date(`${value}T12:00:00`).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function formatDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function centerStateHtml(title, detail = '', type = 'empty') {
    const typeClass = type === 'error' ? ' is-error' : '';
    return `<div class="center-state${typeClass}"><strong>${escapeHtml(title)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
}

function setContainerState(id, title, detail = '', type = 'empty') {
    const el = document.getElementById(id);
    if (el) el.innerHTML = centerStateHtml(title, detail, type);
}

function setContainerLoading(id, label = 'Завантаження актуальних даних...') {
    setContainerState(id, label, 'CRM оновлює цей блок з реального джерела.', 'loading');
}

function setBadgeCount(id, count) {
    const badge = document.getElementById(id);
    if (!badge) return;
    const visible = Number(count || 0) > 0;
    badge.textContent = visible ? String(count) : '';
    badge.style.display = visible ? '' : 'none';
}

function renderCenterFreshness(data) {
    const el = document.getElementById('centerFreshness');
    if (!el) return;
    if (!data?.generatedAt) {
        el.innerHTML = '<span class="center-hero-status-dot"></span>Дані ще оновлюються';
        return;
    }
    el.innerHTML = `<span class="center-hero-status-dot"></span>Оновлено ${formatDateTime(data.generatedAt)}`;
}

function renderCenterTruth(data) {
    const strip = document.getElementById('centerTruthStrip');
    if (!strip || !data?.kpi) return;
    const periodMeta = data.periods?.[currentPeriod];
    const current = data.kpi[currentPeriod] || data.kpi.today || {};
    const tasks = data.tasks || {};
    const overdue = Number(tasks.overdue || 0);
    const dueToday = Number(tasks.dueToday || 0);
    const taskClass = overdue > 0 ? ' is-danger' : dueToday > 0 ? ' is-warning' : '';
    const periodText = periodMeta
        ? `${periodMeta.label}: ${formatDateShort(periodMeta.from)}-${formatDateShort(periodMeta.to)}`
        : 'Період KPI';

    strip.innerHTML = `
        <div class="center-truth-card">
            <span>Актуальність</span>
            <strong>${data.generatedAt ? formatDateTime(data.generatedAt) : 'оновлюється'}</strong>
            <small>${escapeHtml(data.source?.bookings || 'CRM-джерела')}</small>
        </div>
        <div class="center-truth-card${taskClass}">
            <span>Задачі зараз</span>
            <strong>${Number(tasks.open || 0)} відкритих</strong>
            <small>${overdue} прострочених · ${dueToday} на сьогодні</small>
        </div>
        <div class="center-truth-card">
            <span>${escapeHtml(periodText)}</span>
            <strong>${formatPrice(current.revenue || 0)}</strong>
            <small>${Number(current.confirmedBookings || 0)} підтверджених · ${Number(current.preliminaryBookings || 0)} попередніх</small>
        </div>
    `;
}

function setInitialLoadingStates() {
    [
        ['kpiGrid', 'Завантаження KPI...'],
        ['workersGrid', 'Оновлюємо digital workers...'],
        ['pricesContent', 'Оновлюємо централізовані ціни...'],
        ['tasksList', 'Оновлюємо відкриті задачі...'],
        ['reportContent', 'Перевіряємо щоденний звіт...'],
        ['goalsContent', 'Перевіряємо цілі...'],
        ['briefingContent', 'Готуємо тижневий брифінг...'],
        ['workloadContent', 'Рахуємо навантаження...'],
        ['perfContent', 'Рахуємо ефективність програм...'],
        ['heatmapContent', 'Будуємо сезонну карту...'],
        ['crossSellContent', 'Перевіряємо cross-sell дані...'],
        ['catalogContent', 'Оновлюємо каталог...'],
        ['reconciliationContent', 'Звіряємо фінанси...'],
        ['eventLogContent', 'Оновлюємо стрічку подій...'],
        ['hotLeadsList', 'Перевіряємо гарячі ліди...'],
        ['conversionGrid', 'Рахуємо ефективність менеджерів...']
    ].forEach(([id, label]) => setContainerLoading(id, label));
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
        const workerEmoji = w.name === 'kleshnya' ? '🤖' :
                           w.name === 'svitlana' ? '📋' :
                           w.name === 'warehouse_bot' ? '📦' : '🤖';
        return `
        <div class="worker-card" data-worker-id="${w.id}" onclick="toggleWorkerDetails(this)">
            <div class="worker-card-header">
                <div class="worker-card-name">${workerEmoji} ${escapeHtml(w.displayName)}</div>
                <div class="worker-card-status">${w.emoji} ${escapeHtml(w.label)}</div>
            </div>
            <div class="worker-card-purpose">${w.purpose ? escapeHtml(w.purpose.substring(0, 60)) + (w.purpose.length > 60 ? '...' : '') : ''}</div>
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
        grid.innerHTML = centerStateHtml('Немає KPI-даних', 'Для цього періоду немає доступних бронювань або джерело ще оновлюється.');
        return;
    }
    const periodMeta = centerData?.periods?.[period];
    const periodText = periodMeta ? `${formatDateShort(periodMeta.from)}-${formatDateShort(periodMeta.to)}` : '';
    const projectedNote = Number(data.projectedRevenue || 0) > Number(data.revenue || 0)
        ? `Планово з попередніми: ${formatPrice(data.projectedRevenue)}`
        : 'Тільки підтверджені бронювання';

    grid.innerHTML = `
        <div class="kpi-card">
            <div class="kpi-card-label">Підтверджена виручка</div>
            <div class="kpi-card-value revenue">${formatPrice(data.revenue)}</div>
            <div class="kpi-card-meta">${escapeHtml(projectedNote)}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-card-label">Бронювань у періоді</div>
            <div class="kpi-card-value">${data.bookings}</div>
            <div class="kpi-card-meta">${Number(data.confirmedBookings || 0)} підтверджених · ${Number(data.preliminaryBookings || 0)} попередніх</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-card-label">Сер. чек</div>
            <div class="kpi-card-value">${data.avgCheck > 0 ? formatPrice(data.avgCheck) : '—'}</div>
            <div class="kpi-card-meta">За підтвердженими бронюваннями</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-card-label">Топ програма</div>
            <div class="kpi-card-value" style="font-size:13px">${escapeHtml(data.topProgram)}</div>
            <div class="kpi-card-meta">${periodText || 'Поточний період'} · main bookings</div>
        </div>
    `;
    renderCenterTruth(centerData);
}

// ==========================================
// RENDER: PRICES
// ==========================================

function renderPrices(prices) {
    const container = document.getElementById('pricesContent');
    if (!container) return;

    if (!prices || prices.length === 0) {
        container.innerHTML = `${renderBanquetTermsPriceBlock([])}<div class="center-empty">Немає цінових правил</div>`;
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
            ? `${escapeHtml(p.updated_by)}, ${new Date(p.updated_at).toLocaleDateString('uk-UA')}`
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
                    ? `<div class="price-inline-wrap">
                        <input type="number" class="price-inline-input" value="${p.value}" data-code="${escapeHtml(p.code)}" data-original="${p.value}" data-product-id="${p.product_id || ''}"
                            onkeydown="if(event.key==='Enter')confirmPriceChange(this)"
                            oninput="this.parentElement.querySelector('.price-save-btn').classList.toggle('changed', this.value!=this.dataset.original)">
                        <span class="price-unit">${escapeHtml(p.unit) || ''}</span>
                        <button class="price-save-btn" onclick="confirmPriceChange(this.parentElement.querySelector('.price-inline-input'))" title="Зберегти">✓</button>
                       </div>`
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
    container.innerHTML = `${renderBanquetTermsPriceBlock(prices)}${html}`;

    if (isAdminUser) {
        appendPriceAddRow(container);
    }
}

function priceRuleByCode(prices = []) {
    return new Map((Array.isArray(prices) ? prices : [])
        .map(price => [String(price?.code || '').trim(), price])
        .filter(([code]) => code));
}

function formatBanquetRuleValue(rule, fallbackUnit = '') {
    if (!rule) return '—';
    const value = rule.value === null || rule.value === undefined || rule.value === ''
        ? '—'
        : Number(rule.value).toLocaleString('uk-UA');
    const unit = rule.unit || fallbackUnit;
    return `${value}${unit ? ` ${unit}` : ''}`;
}

function renderBanquetTermsPriceInput(rule, config) {
    if (!rule) {
        return `<span class="banquet-terms-price-missing">Не знайдено</span>`;
    }
    const unit = rule.unit || config.unit || '';
    if (isAdminUser) {
        return `<div class="price-inline-wrap banquet-terms-price-inline">
            <input type="number" class="price-inline-input" value="${rule.value}" data-code="${escapeHtml(rule.code)}" data-original="${rule.value}" data-product-id="${rule.product_id || ''}"
                onkeydown="if(event.key==='Enter')confirmPriceChange(this)"
                oninput="this.parentElement.querySelector('.price-save-btn').classList.toggle('changed', this.value!=this.dataset.original)">
            <span class="price-unit">${escapeHtml(unit)}</span>
            <button class="price-save-btn" onclick="confirmPriceChange(this.parentElement.querySelector('.price-inline-input'))" title="Зберегти">✓</button>
        </div>`;
    }
    return `<span class="price-value-cell">${escapeHtml(formatBanquetRuleValue(rule, config.unit))}</span>`;
}

function renderBanquetTermsPriceBlock(prices = []) {
    const byCode = priceRuleByCode(prices);
    const missing = [];
    const rows = BANQUET_TERMS_PRICE_RULES.map(config => {
        const rule = byCode.get(config.code);
        if (!rule) missing.push(config.code);
        const updatedInfo = rule?.updated_by
            ? `${escapeHtml(rule.updated_by)}, ${new Date(rule.updated_at).toLocaleDateString('uk-UA')}`
            : '';
        return `
            <div class="banquet-terms-price-row ${rule ? '' : 'is-missing'}">
                <div class="banquet-terms-price-main">
                    <strong>${escapeHtml(config.label)}</strong>
                    <span>${escapeHtml(config.description)}</span>
                    <code>${escapeHtml(config.code)}</code>
                </div>
                <div class="banquet-terms-price-control">
                    ${renderBanquetTermsPriceInput(rule, config)}
                    ${updatedInfo ? `<small>${updatedInfo}</small>` : ''}
                </div>
            </div>
        `;
    }).join('');

    return `
        <section class="banquet-terms-price-panel" aria-label="Умови банкету">
            <div class="banquet-terms-price-header">
                <div>
                    <strong>Умови банкету</strong>
                    <span>Ці значення підставляються в Банкетний лист через price_rules.</span>
                </div>
                <span class="banquet-terms-price-badge">price_rules</span>
            </div>
            ${missing.length ? `<div class="banquet-terms-price-warning">Не знайдено правила: ${missing.map(code => `<code>${escapeHtml(code)}</code>`).join(', ')}. Додайте його через форму нижче або перевірте seed migration 267.</div>` : ''}
            <div class="banquet-terms-price-grid">
                ${rows}
            </div>
        </section>
    `;
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

function appendPricePositionsPanel(container) {
    if (!container || !Array.isArray(pricePositionsData) || pricePositionsData.length === 0) return;

    const unlinked = pricePositionsData.filter(p => !p.priceCode);
    const linkedCount = pricePositionsData.length - unlinked.length;
    const visibleUnlinked = unlinked.slice(0, 12);
    const rows = visibleUnlinked.map(p => `
        <div class="price-position-row">
            <div class="price-position-main">
                <div class="price-position-name">${escapeHtml(p.productName || p.productLabel || p.productId)}</div>
                <div class="price-position-meta">${escapeHtml(p.productCategory || '—')} · ${escapeHtml(p.productId)} · ${formatPrice(p.productPrice || 0)}</div>
            </div>
            ${isAdminUser ? `<button type="button" class="price-link-btn" onclick="createPriceForProduct('${escapeHtml(p.productId)}')">Створити правило</button>` : '<span class="price-unlinked-badge">немає правила</span>'}
        </div>
    `).join('');
    const hiddenCount = Math.max(0, unlinked.length - visibleUnlinked.length);

    container.insertAdjacentHTML('beforeend', `
        <div class="price-position-panel">
            <div class="price-position-header">
                <strong>Позиції каталогу</strong>
                <span>${linkedCount}/${pricePositionsData.length} привʼязані до price_rules</span>
            </div>
            ${unlinked.length
                ? `<div class="price-position-note">Ці програми беруть базову ціну з products і ще не мають централізованого правила.</div>${rows}${hiddenCount ? `<div class="price-position-note">+${hiddenCount} позицій приховано у короткому списку.</div>` : ''}`
                : '<div class="price-position-note">Усі активні product-позиції мають price rule linkage.</div>'
            }
        </div>
    `);
}

async function createPriceForProduct(productId) {
    const product = pricePositionsData.find(p => p.productId === productId);
    if (!product) return;

    const result = await apiCreatePrice({
        code: product.productId,
        name: product.productName || product.productLabel || product.productId,
        value: Number(product.productPrice || 0),
        unit: 'грн',
        category: product.productCategory || 'program',
        description: 'Створено з каталогу програм для централізованого price linkage'
    });
    if (!result.success) {
        showNotification(result.error || 'Не вдалося створити правило ціни', 'error');
        return;
    }

    const linkResult = await apiUpdatePrice(product.productId, { productId });
    if (!linkResult.success) {
        showNotification(linkResult.error || 'Правило створено, але привʼязка не вдалася', 'error');
        return;
    }

    showNotification(`Правило ціни для ${product.productName || productId} створено і привʼязано`, 'success');
    await loadPrices();
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
    const todayStr = new Date().toISOString().split('T')[0];
    const overlay = document.createElement('div');
    overlay.className = 'price-confirm-overlay';
    overlay.innerHTML = `
        <div class="price-confirm-dialog">
            <h3>Підтвердження зміни ціни</h3>
            <p><b>${code}</b>: ${original} → ${newValue} ₴ (${diffText} ₴)</p>
            <p style="font-size:12px;color:var(--gray-500)">${linkedText.replace(/\n/g, '<br>')}</p>
            <div class="price-confirm-date">
                <label>Коли вступає в дію:</label>
                <div class="price-date-options">
                    <button class="price-date-btn active" data-date="now">Прямо зараз</button>
                    <button class="price-date-btn" data-date="custom">З певної дати</button>
                </div>
                <div class="price-date-custom" style="display:none">
                    <div class="price-date-fields">
                        <input type="date" class="price-date-input" value="${todayStr}" min="${todayStr}">
                        <input type="time" class="price-time-input" value="08:00">
                    </div>
                    <span class="price-date-hint">Мінімум — сьогодні. Заднім числом не можна.</span>
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
    const timeInput = overlay.querySelector('.price-time-input');
    const customBlock = overlay.querySelector('.price-date-custom');
    const dateBtns = overlay.querySelectorAll('.price-date-btn');
    let useCustomDate = false;

    dateBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dateBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            useCustomDate = btn.dataset.date === 'custom';
            customBlock.style.display = useCustomDate ? '' : 'none';
        });
    });

    overlay.querySelector('.btn-confirm-cancel').addEventListener('click', () => {
        input.value = original;
        overlay.remove();
    });
    overlay.querySelector('.btn-confirm-save').addEventListener('click', async () => {
        let effectiveFrom = undefined;
        if (useCustomDate) {
            const dateVal = dateInput.value;
            const timeVal = timeInput.value || '08:00';
            if (!dateVal) {
                showNotification('Оберіть дату введення в дію', 'error');
                return;
            }
            // Validate not in the past
            const chosen = new Date(`${dateVal}T${timeVal}`);
            if (chosen < new Date()) {
                showNotification('Дата не може бути в минулому', 'error');
                return;
            }
            effectiveFrom = `${dateVal}T${timeVal}`;
        }

        overlay.querySelector('.btn-confirm-save').disabled = true;
        overlay.querySelector('.btn-confirm-save').textContent = 'Збереження...';
        const result = await apiUpdatePrice(code, { value: newValue, effectiveFrom });
        overlay.remove();
        if (result.success) {
            input.dataset.original = newValue;
            input.style.borderColor = '#2E7D32';
            setTimeout(() => { input.style.borderColor = ''; }, 1500);
            const syncMsg = result.productSynced ? ' (ціна в каталозі оновлена!)' : '';
            const dateMsg = effectiveFrom ? ` з ${new Date(effectiveFrom).toLocaleString('uk-UA')}` : '';
            showNotification(`Ціну ${code} оновлено: ${newValue} ₴${dateMsg}${syncMsg}`, 'success');
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

        const select = products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.id}) — ${p.price} ₴</option>`).join('');
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
    if (!await confirmModal(`Видалити ціну "${code}"?`, { type: 'danger', okText: 'Видалити' })) return;
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
        container.innerHTML = centerStateHtml('Немає активних задач', 'У центрі показуються відкриті задачі; виконані й архівні не змішуються з операційним списком.');
        return;
    }

    container.innerHTML = tasks.slice(0, 30).map(t => {
        const priorityClass = t.priority === 'high' ? ' center-task-priority-high' : '';
        const overdueClass = t.is_overdue ? ' is-overdue' : '';
        const statusIcon = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
        return `
        <div class="center-task-row${priorityClass}${overdueClass}">
            <div class="center-task-status ${t.status}"></div>
            <div class="center-task-title">${escapeHtml(t.title)}</div>
            ${t.assigned_to ? `<span class="center-task-assignee">${escapeHtml(t.assigned_to)}</span>` : ''}
            ${t.is_overdue ? '<span class="center-task-overdue">прострочено</span>' : ''}
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
        const chartsGrid = document.getElementById('chartsSection')?.querySelector('.charts-grid');
        if (chartsGrid) chartsGrid.innerHTML = '<div class="center-empty">Дані для графіків недоступні</div>';
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
        showNotification(result.error || 'Помилка перерахунку', 'error');
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
            <button onclick="document.getElementById('addDiscountForm')?.classList.add('hidden')" style="background:var(--gray-100);color:var(--gray-600)">Скасувати</button>
        </div>
    `;
}

let _submitDiscountBusy = false;
async function submitNewDiscount() {
    if (_submitDiscountBusy) return;
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

    _submitDiscountBusy = true;
    try {
        const result = await apiCreateDiscount({ code, name, type, value, min_order, max_uses, valid_from, valid_until, category });
        if (result.id) {
            showNotification(`Промокод ${code.toUpperCase()} створено`, 'success');
            document.getElementById('addDiscountForm')?.classList.add('hidden');
            loadDiscounts();
        } else {
            showNotification(result.error || 'Помилка створення', 'error');
        }
    } finally {
        _submitDiscountBusy = false;
    }
}

async function deleteDiscount(id) {
    if (!await confirmModal('Деактивувати цей промокод?', { type: 'warning', okText: 'Деактивувати' })) return;
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
        document.getElementById('proposalFormInline')?.remove();
        return;
    }

    // Build options for discount codes select
    const codeOptions = discountCodes
        .filter(d => d.is_active)
        .map(d => `<option value="${d.id}">${escapeHtml(d.code)} — ${escapeHtml(d.name)}</option>`)
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
            <button onclick="document.getElementById('proposalFormInline')?.remove()" style="background:var(--gray-100);color:var(--gray-600)">Скасувати</button>
        </div>
    </div>`;

    container.insertAdjacentHTML('beforebegin', formHtml);
}

let _submitProposalBusy = false;
async function submitNewProposal() {
    if (_submitProposalBusy) return;
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

    _submitProposalBusy = true;
    try {
        const result = await apiCreateProposal({ title, description, discount_code_id, target_segment, start_date, end_date, banner_color });
        if (result.id) {
            showNotification('Пропозицію створено', 'success');
            const form = document.getElementById('proposalFormInline');
            if (form) form.remove();
            loadProposals();
        } else {
            showNotification(result.error || 'Помилка створення', 'error');
        }
    } finally {
        _submitProposalBusy = false;
    }
}

async function deleteProposal(id) {
    if (!await confirmModal('Видалити цю пропозицію?', { type: 'danger', okText: 'Видалити' })) return;
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
        return await centerMutationJson(r, 'Не вдалося зберегти цілі');
    } catch (err) { console.error('API save goals error:', err); return centerApiFailure(err, 'Не вдалося зберегти цілі'); }
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
        document.getElementById('goalsFormInline')?.remove();
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
            <button onclick="document.getElementById('goalsFormInline')?.remove()" style="background:var(--gray-100);color:var(--gray-600)">Скасувати</button>
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
        showNotification(result.error || 'Помилка збереження', 'error');
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

    if (!loadData) {
        el.innerHTML = centerStateHtml('Помилка навантаження аніматорів', 'Дані /api/stats/load зараз недоступні.', 'error');
        return;
    }

    const animators = loadData?.animatorWorkload || [];
    if (!animators.length) {
        el.innerHTML = centerStateHtml('Немає даних про навантаження', 'За поточний місяць не знайдено підтверджених бронювань з аніматорами.');
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
            const dateTimeText = centerBookingDateTimeText(b);
            return `
            <div class="client-booking-row">
                <span class="client-booking-date">${escapeHtml(dateTimeText)}</span>
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
// RENDER: OPERATIONS CENTER
// ==========================================

function opsItems(value) {
    return Array.isArray(value) ? value : [];
}

function opsText(value, fallback = '—') {
    const text = String(value || '').trim();
    return text || fallback;
}

function opsMoney(value) {
    return Number(value || 0).toLocaleString('uk-UA') + ' грн';
}

function opsBadge(label, tone = 'info') {
    return `<span class="center-ops-badge is-${escapeHtml(tone)}">${escapeHtml(label || 'info')}</span>`;
}

function opsRowMeta(parts) {
    const safe = (parts || []).map(part => opsText(part, '')).filter(Boolean);
    return safe.length ? `<div class="center-ops-row-meta">${safe.map(escapeHtml).join(' · ')}</div>` : '';
}

function renderOpsEmpty(title, detail = '') {
    return `<div class="center-ops-empty"><strong>${escapeHtml(title)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
}

function renderOpsSummaryTile(label, value, detail = '', tone = 'info') {
    return `<div class="center-ops-summary-item is-${escapeHtml(tone)}">
        <span>${escapeHtml(label)}</span>
        <strong>${Number(value || 0)}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </div>`;
}

function renderOpsIssue(issue = {}) {
    const ref = issue.ref || {};
    const action = ref.staffId
        ? `<a href="/hr?employee=${encodeURIComponent(ref.staffId)}" class="center-ops-link">HR</a>`
        : ref.reportId
            ? `<a href="/reports?reportId=${encodeURIComponent(ref.reportId)}" class="center-ops-link">Звіт</a>`
            : ref.bookingId
                ? `<a href="/?bookingId=${encodeURIComponent(ref.bookingId)}" class="center-ops-link">Бронювання</a>`
                : ref.taskId
                    ? `<a href="/tasks?task=${encodeURIComponent(ref.taskId)}" class="center-ops-link">Задача</a>`
                    : '';
    return `<div class="center-ops-row center-ops-row--issue is-${escapeHtml(issue.severity || 'info')}">
        <div class="center-ops-row-main">
            <strong>${escapeHtml(issue.title || 'Issue')}</strong>
            ${opsRowMeta([issue.detail])}
        </div>
        ${action}
    </div>`;
}

function renderOpsBooking(booking = {}) {
    const isPreliminary = booking.status === 'preliminary';
    const paymentTone = Number(booking.debtAmount || 0) > 0 ? 'warning' : 'ok';
    const paymentLabel = Number(booking.debtAmount || 0) > 0 ? `борг ${opsMoney(booking.debtAmount)}` : 'оплачено';
    return `<div class="center-ops-row">
        <div class="center-ops-time">${escapeHtml(booking.time || '—')}</div>
        <div class="center-ops-row-main">
            <strong>${escapeHtml(booking.programName || booking.label || booking.id)}</strong>
            ${opsRowMeta([booking.room, booking.clientName, booking.status])}
        </div>
        <div class="center-ops-row-tags">
            ${opsBadge(paymentLabel, paymentTone)}
            ${isPreliminary ? opsBadge('не підтверджено', 'warning') : opsBadge('підтверджено', 'ok')}
        </div>
        <div class="center-ops-actions">
            ${booking.customerPhone ? `<a href="tel:${escapeHtml(booking.customerPhone)}" class="center-ops-link">Дзвінок</a>` : ''}
            ${isPreliminary ? `<button type="button" class="center-ops-link center-ops-link--button" onclick="confirmOperationsBooking('${escapeHtml(booking.id)}', this)">Підтвердити</button>` : ''}
            <a href="/staff?date=${encodeURIComponent(booking.date || '')}" class="center-ops-link">Графік</a>
        </div>
    </div>`;
}

function renderOpsShift(shift = {}) {
    const attendance = shift.attendance || {};
    const actual = [shift.actualArrival, shift.actualLeave].filter(Boolean).join('-');
    return `<div class="center-ops-row">
        <div class="center-ops-avatar">${escapeHtml(String(shift.name || '?').slice(0, 2).toUpperCase())}</div>
        <div class="center-ops-row-main">
            <strong>${escapeHtml(shift.name || 'Працівник')}</strong>
            ${opsRowMeta([shift.position || shift.roleType, `${shift.plannedStart || '—'}-${shift.plannedEnd || '—'}`, actual ? `факт ${actual}` : 'факт ще не зафіксовано'])}
        </div>
        <div class="center-ops-row-tags">
            ${opsBadge(attendance.label || attendance.status || 'planned', attendance.severity || 'info')}
        </div>
        <a href="/hr?employee=${encodeURIComponent(shift.staffId || '')}" class="center-ops-link">HR</a>
    </div>`;
}

function renderOpsTask(task = {}) {
    return `<div class="center-ops-row ${task.isOverdue ? 'is-critical' : ''}">
        <div class="center-ops-row-main">
            <strong>${escapeHtml(task.title || 'Задача')}</strong>
            ${opsRowMeta([task.priority, task.assignedTo || 'без відповідального', task.deadline ? formatDateTime(task.deadline) : task.date])}
        </div>
        ${opsBadge(task.status || 'todo', task.isOverdue ? 'critical' : 'info')}
        <a href="/tasks?task=${encodeURIComponent(task.id || '')}" class="center-ops-link">Відкрити</a>
    </div>`;
}

function renderOpsReport(report = {}) {
    const tone = report.approvalStatus === 'rejected' ? 'critical' : report.approvalStatus === 'approved' ? 'ok' : 'warning';
    return `<div class="center-ops-row">
        <div class="center-ops-row-main">
            <strong>Звіт #${escapeHtml(report.id || '')}</strong>
            ${opsRowMeta([report.category || report.type, report.submittedBy, report.createdAt ? formatDateTime(report.createdAt) : ''])}
        </div>
        <div class="center-ops-row-tags">
            ${opsBadge(report.status || 'new', 'info')}
            ${opsBadge(report.approvalStatus || 'none', tone)}
        </div>
        <a href="/reports?reportId=${encodeURIComponent(report.id || '')}" class="center-ops-link">Звіт</a>
    </div>`;
}

function renderOpsTimelineEvent(event = {}) {
    return `<div class="center-ops-row center-ops-row--timeline">
        <div class="center-ops-time">${escapeHtml(event.time || '—')}</div>
        <div class="center-ops-row-main">
            <strong>${escapeHtml(event.title || event.type || 'Подія')}</strong>
            ${opsRowMeta([event.detail, event.status])}
        </div>
        ${event.bookingId ? `<a href="/?bookingId=${encodeURIComponent(event.bookingId)}" class="center-ops-link">Timeline</a>` : ''}
    </div>`;
}

function renderOpsNotes(notes = []) {
    if (!notes.length) return renderOpsEmpty('Нотаток передачі зміни немає');
    return notes.map(note => `<div class="center-ops-note">
        <strong>${escapeHtml(note.author || note.by || 'Зміна')}</strong>
        <span>${escapeHtml(note.text || note.note || '')}</span>
        ${note.createdAt ? `<small>${escapeHtml(formatDateTime(note.createdAt))}</small>` : ''}
    </div>`).join('');
}

function renderOpsList(items, renderer, emptyTitle, emptyDetail = '') {
    const list = opsItems(items);
    return list.length ? list.map(renderer).join('') : renderOpsEmpty(emptyTitle, emptyDetail);
}

function renderOperationsCenter(data) {
    const container = document.getElementById('operationsCenter');
    if (!container) return;
    if (!data?.success) {
        setContainerState('operationsCenter', 'Не вдалося завантажити зміну', 'Перевірте /api/center/operations/today або повторіть пізніше.', 'error');
        return;
    }
    const counts = data.counts || {};
    const incidents = opsItems(data.incidents);
    const blockerTone = Number(counts.incidents || 0) > 0 ? 'warning' : 'ok';
    const generated = data.generatedAt ? formatDateTime(data.generatedAt) : '—';

    container.innerHTML = `<div class="center-ops-shell">
        <div class="center-ops-head">
            <div>
                <h2>Зміна сьогодні</h2>
                <p>${escapeHtml(data.date || '')} · оновлено ${escapeHtml(generated)}</p>
            </div>
            <div class="center-ops-head-actions">
                <a href="/staff" class="center-ops-link">Графік</a>
                <a href="/tasks?source=center-ops" class="center-ops-link">Інцидент</a>
                <a href="/reports" class="center-ops-link">Звіти</a>
                <button type="button" class="center-ops-link center-ops-link--button" onclick="loadOperationsCenter({ force: true })">Оновити</button>
            </div>
        </div>

        <div class="center-ops-summary">
            ${renderOpsSummaryTile('Бронювання', counts.bookings, 'сьогодні', 'info')}
            ${renderOpsSummaryTile('На зміні', counts.onShiftNow, `${counts.activeShifts || 0} заплановано`, 'ok')}
            ${renderOpsSummaryTile('Запізнення', counts.lateStaff, 'потрібна реакція', counts.lateStaff ? 'warning' : 'ok')}
            ${renderOpsSummaryTile('Невихід', counts.noShowStaff, 'критично', counts.noShowStaff ? 'critical' : 'ok')}
            ${renderOpsSummaryTile('Оплати', counts.pendingPayments, 'до контролю', counts.pendingPayments ? 'warning' : 'ok')}
            ${renderOpsSummaryTile('Блокери', counts.incidents, 'issues', blockerTone)}
        </div>

        <div class="center-ops-grid">
            <section class="center-ops-panel center-ops-panel--wide">
                <div class="center-ops-panel-title">
                    <strong>Критичні питання</strong>
                    ${opsBadge(`${incidents.length}`, blockerTone)}
                </div>
                <div class="center-ops-list">${renderOpsList(incidents, renderOpsIssue, 'Критичних питань немає')}</div>
            </section>

            <section class="center-ops-panel">
                <div class="center-ops-panel-title"><strong>Хто зараз на зміні</strong></div>
                <div class="center-ops-list">${renderOpsList(data.onShiftNow, renderOpsShift, 'Зараз немає активної зміни')}</div>
            </section>

            <section class="center-ops-panel">
                <div class="center-ops-panel-title"><strong>Бронювання</strong></div>
                <div class="center-ops-list">${renderOpsList(data.bookings, renderOpsBooking, 'Бронювань на сьогодні немає')}</div>
            </section>

            <section class="center-ops-panel">
                <div class="center-ops-panel-title"><strong>Таймлайн</strong></div>
                <div class="center-ops-list">${renderOpsList(data.timelineEvents, renderOpsTimelineEvent, 'Подій timeline ще немає')}</div>
            </section>

            <section class="center-ops-panel">
                <div class="center-ops-panel-title"><strong>Відкриті задачі</strong></div>
                <div class="center-ops-list">${renderOpsList(data.openTasks, renderOpsTask, 'Операційних задач немає')}</div>
            </section>

            <section class="center-ops-panel">
                <div class="center-ops-panel-title"><strong>Звіти на перевірку</strong></div>
                <div class="center-ops-list">${renderOpsList(data.pendingReports, renderOpsReport, 'Немає звітів на ревʼю')}</div>
            </section>

            <section class="center-ops-panel center-ops-panel--wide">
                <div class="center-ops-panel-title">
                    <strong>Передача зміни</strong>
                    <a href="/tasks?source=center-ops&kind=handover" class="center-ops-link">Нова нотатка</a>
                </div>
                <div class="center-ops-notes">${renderOpsNotes(opsItems(data.handoverNotes))}</div>
            </section>
        </div>
    </div>`;
}

async function loadOperationsCenter(options = {}) {
    const container = document.getElementById('operationsCenter');
    if (!container) return;
    if (operationsLoading) return;
    if (operationsData && !options.force) {
        renderOperationsCenter(operationsData);
        return;
    }
    operationsLoading = true;
    setContainerLoading('operationsCenter', 'Оновлюємо стан зміни...');
    const data = await apiCenterOperationsToday();
    operationsLoading = false;
    if (!data || !data.success) {
        setContainerState('operationsCenter', 'Не вдалося завантажити зміну', 'API /api/center/operations/today не повернув актуальний стан.', 'error');
        return;
    }
    operationsData = data;
    renderOperationsCenter(data);
}

async function confirmOperationsBooking(id, button) {
    if (!id) return;
    const oldText = button?.textContent;
    if (button) {
        button.disabled = true;
        button.textContent = '...';
    }
    try {
        const response = await fetch(`${API_BASE}/bookings/${encodeURIComponent(id)}/confirm`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ source: 'center_operations' })
        });
        const result = await centerMutationJson(response, 'Не вдалося підтвердити бронювання');
        if (!result.success) throw new Error(result.error || 'confirm failed');
        if (typeof showNotification === 'function') showNotification('Бронювання підтверджено', 'success');
        await loadOperationsCenter({ force: true });
    } catch (err) {
        console.error('Operations confirm booking error:', err);
        if (typeof showNotification === 'function') showNotification('Не вдалося підтвердити бронювання', 'error');
        if (button) {
            button.disabled = false;
            button.textContent = oldText || 'Підтвердити';
        }
    }
}

window.loadOperationsCenter = loadOperationsCenter;
window.confirmOperationsBooking = confirmOperationsBooking;
window.addEventListener('center:tab-change', event => {
    if (event.detail?.tab === 'operations') loadOperationsCenter();
});

// ==========================================
// DATA LOADING
// ==========================================

async function loadOverview() {
    setContainerLoading('kpiGrid', 'Завантаження KPI...');
    const data = await apiCenterOverview();
    if (!data || !data.success) {
        setContainerState('kpiGrid', 'Помилка завантаження KPI', 'Дані не залишено як старі: оновіть сторінку або перевірте API /api/center/overview.', 'error');
        renderCenterFreshness(null);
        return;
    }
    centerData = data;
    renderCenterFreshness(data);
    renderCenterTruth(data);
    renderKPI(data.kpi, currentPeriod);
}

async function loadWorkers() {
    setContainerLoading('workersGrid', 'Оновлюємо digital workers...');
    try {
        const response = await fetch(`${API_BASE}/center/workers`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return;
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        if (data.success) {
            renderWorkers(data.workers);
        } else {
            setContainerState('workersGrid', 'Помилка завантаження воркерів', 'Статус digital workers не оновився.', 'error');
        }
    } catch (err) {
        console.error('Load workers error:', err);
        setContainerState('workersGrid', 'Помилка завантаження воркерів', 'Статус digital workers не оновився.', 'error');
    }
}

async function loadPrices() {
    setContainerLoading('pricesContent', 'Оновлюємо централізовані ціни...');
    const [data, positionsData] = await Promise.all([
        apiCenterPrices(),
        apiCenterPricePositions()
    ]);
    if (!data || !data.success) {
        setContainerState('pricesContent', 'Помилка завантаження цін', 'Централізовані правила price_rules зараз недоступні.', 'error');
        return;
    }
    pricesData = data.prices || [];
    pricePositionsData = positionsData?.success ? (positionsData.positions || []) : [];
    renderPrices(pricesData);
    appendPricePositionsPanel(document.getElementById('pricesContent'));
}

async function loadTasks() {
    setContainerLoading('tasksList', 'Оновлюємо відкриті задачі...');
    const data = await apiCenterTasks();
    if (!data || !data.success) {
        setContainerState('tasksList', 'Помилка завантаження задач', 'Операційний список очищено від старого стану, повторіть пізніше.', 'error');
        return;
    }
    tasksData = data.tasks || [];
    renderTasks(tasksData);
}

async function loadReport() {
    setContainerLoading('reportContent', 'Перевіряємо щоденний звіт...');
    const data = await apiCenterReport();
    if (!data || !data.success) {
        setContainerState('reportContent', 'Помилка завантаження звіту', 'Останній звіт не підтягнувся з settings.', 'error');
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
        if (section) section.querySelector('.charts-grid').innerHTML = centerStateHtml('Немає даних для графіків', 'Графіки використовують /api/stats/revenue і /api/stats/programs за останні 7 днів.');
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
    setContainerLoading('goalsContent', 'Перевіряємо цілі...');
    const data = await apiCenterGoals();
    if (data.success) {
        renderGoals(data.goals, centerData?.kpi);
    } else {
        setContainerState('goalsContent', 'Помилка завантаження цілей', 'Налаштування center_revenue_goals зараз недоступне.', 'error');
    }
}

async function loadBriefing() {
    setContainerLoading('briefingContent', 'Готуємо тижневий брифінг...');
    const data = await apiCenterBriefing();
    if (data.success) {
        renderBriefing(data.briefing);
    } else {
        setContainerState('briefingContent', 'Помилка брифінгу', 'Не вдалося зібрати бронювання, задачі й персонал на тиждень.', 'error');
    }
}

async function loadWorkload() {
    setContainerLoading('workloadContent', 'Рахуємо навантаження аніматорів...');
    const data = await apiAnimatorWorkload();
    renderWorkload(data);
}

async function loadProgramPerformance() {
    setContainerLoading('perfContent', 'Рахуємо ефективність програм...');
    const data = await apiProgramPerformance();
    if (data.success) {
        renderProgramPerformance(data);
    } else {
        setContainerState('perfContent', 'Помилка ефективності програм', 'Матриця програм не отримала актуальні booking-дані.', 'error');
    }
}

async function loadHeatmap() {
    setContainerLoading('heatmapContent', 'Будуємо сезонну карту...');
    const data = await apiSeasonalHeatmap();
    if (data.success) {
        renderHeatmap(data);
    } else {
        setContainerState('heatmapContent', 'Помилка сезонної карти', 'Heatmap не отримав booking-дані за останні місяці.', 'error');
    }
}

async function loadCrossSell() {
    setContainerLoading('crossSellContent', 'Перевіряємо cross-sell дані...');
    const data = await apiCrossSell();
    if (data.success) {
        renderCrossSell(data);
    } else {
        setContainerState('crossSellContent', 'Помилка cross-sell аналізу', 'Комбінації й add-ons не підтягнулись з бронювань.', 'error');
    }
}

async function loadCatalog() {
    setContainerLoading('catalogContent', 'Оновлюємо каталог програм...');
    const data = await apiProducts();
    renderCatalog(data);
}

async function loadReconciliation() {
    setContainerLoading('reconciliationContent', 'Звіряємо фінансові дані...');
    const data = await apiReconciliation();
    renderReconciliation(data);
}

async function loadEventLog() {
    setContainerLoading('eventLogContent', 'Оновлюємо стрічку подій...');
    const data = await apiEventLog();
    renderEventLog(data);
}

// ==========================================
// v20.7.0: HOT LEADS
// ==========================================

async function loadHotLeads() {
    const container = document.getElementById('hotLeadsList');
    if (!container) return;
    setContainerLoading('hotLeadsList', 'Перевіряємо гарячі ліди...');
    setBadgeCount('hotLeadsCount', 0);
    try {
        const resp = await fetch(centerScopedApiUrl('/api/leads/hot'), { headers: getAuthHeaders(false) });
        const data = await resp.json();
        if (!data.success || !data.leads.length) {
            container.innerHTML = centerStateHtml('Немає гарячих лідів', 'Ліди без відповіді або з високим ризиком не знайдені.');
            return;
        }
        setBadgeCount('hotLeadsCount', data.leads.length);

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
        container.innerHTML = centerStateHtml('Помилка завантаження лідів', 'Не вдалося прочитати /api/leads/hot.', 'error');
    }
}

async function updateLeadStatus(id, status) {
    try {
        const token = localStorage.getItem('pzp_token') || localStorage.getItem('token');
        await fetch('/api/leads/' + id, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ pipeline_stage: status })
        });
        loadHotLeads();
    } catch { /* silent */ }
}

// Add Lead modal
function initAddLeadBtn() {
    const btn = document.getElementById('addLeadBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const result = await formModal('Новий лід', [
            { key: 'name', label: 'Ім\'я клієнта', required: true, placeholder: 'Іван Петренко' },
            { key: 'phone', label: 'Телефон', placeholder: '+380...' }
        ], { icon: '👤' });
        if (!result) return;
        try {
            const token = localStorage.getItem('pzp_token') || localStorage.getItem('token');
            await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_name: result.name, phone: result.phone || null })
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
    setContainerLoading('conversionGrid', 'Рахуємо ефективність менеджерів...');
    try {
        const now = new Date();
        const token = localStorage.getItem('pzp_token') || localStorage.getItem('token');
        const resp = await fetch(`/api/analytics/conversion?period=month&year=${now.getFullYear()}&month=${now.getMonth() + 1}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await resp.json();
        if (!data.success || !data.managers.length) {
            container.innerHTML = centerStateHtml('Немає даних за цей місяць', 'Конверсія менеджерів рахується з бронювань поточного місяця.');
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
        container.innerHTML = centerStateHtml('Помилка завантаження конверсії', 'Не вдалося прочитати /api/analytics/conversion.', 'error');
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
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        return false;
    }

    // Verify token
    const user = await apiVerifyToken();
    if (!user) {
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        return false;
    }

    AppState.currentUser = user;
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    const ADMIN_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    isAdminUser = ADMIN_ROLES.includes(user.role);
    canEditAdmissionTicketTariffs = typeof hasMinRole === 'function'
        ? hasMinRole('senior_manager')
        : ['creator', 'director', 'vice_director', 'senior_manager'].includes(user.role);

    // Set username
    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;

    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    // Role-based sidebar visibility
    document.querySelectorAll('.sidebar-admin-only').forEach(el => {
        el.classList.toggle('hidden', !isAdminUser);
    });
    document.querySelectorAll('.sidebar-no-viewer').forEach(el => {
        el.classList.toggle('hidden', user.role === 'viewer');
    });

    return true;
}

const ADMISSION_TARIFF_COLUMNS = Object.freeze([
    { context: 'standard', dayType: 'weekday', label: 'Стандарт · будні' },
    { context: 'standard', dayType: 'weekend', label: 'Стандарт · вихідні' },
    { context: 'reserved_table_room', dayType: 'weekday', label: 'Бронювання · будні' },
    { context: 'reserved_table_room', dayType: 'weekend', label: 'Бронювання · вихідні' }
]);

function admissionTicketLocalizedMessage(value, fallback) {
    const message = String(value || '').trim();
    return /[А-Яа-яІіЇїЄєҐґ]/u.test(message) ? message : fallback;
}

function admissionTicketTariffFor(type, context, dayType) {
    return (Array.isArray(type?.currentTariffs) ? type.currentTariffs : []).find(tariff => (
        tariff.admissionContext === context && tariff.dayType === dayType
    )) || null;
}

function admissionTicketLatestTariffFor(type, context, dayType) {
    const history = Array.isArray(type?.tariffHistory) ? type.tariffHistory : [];
    const matching = history.filter(tariff => (
        tariff.admissionContext === context && tariff.dayType === dayType
    ));
    if (matching.length) {
        return matching.reduce((latest, tariff) => (
            Number(tariff.revision || 0) > Number(latest.revision || 0) ? tariff : latest
        ));
    }
    return (Array.isArray(type?.headTariffs) ? type.headTariffs : []).find(tariff => (
        tariff.admissionContext === context && tariff.dayType === dayType
    )) || admissionTicketTariffFor(type, context, dayType);
}

function admissionTicketDateLabel(value) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime())
        ? escapeHtml(String(value))
        : date.toLocaleDateString('uk-UA');
}

function admissionTicketTodayDateOnly() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function admissionTicketMoneyLabel(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
        ? `${amount.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} грн`
        : '—';
}

function renderAdmissionTicketTariffCell(type, column) {
    const tariff = admissionTicketTariffFor(type, column.context, column.dayType);
    const unavailable = tariff?.availability === 'unavailable';
    const price = tariff
        ? (unavailable ? 'Недоступний' : admissionTicketMoneyLabel(tariff.amountUah))
        : 'Немає конфігурації';
    const action = canEditAdmissionTicketTariffs
        ? `<button type="button" class="btn btn-secondary ticket-tariff-edit"
                data-ticket-code="${escapeHtml(type.code)}"
                data-admission-context="${escapeHtml(column.context)}"
                data-day-type="${escapeHtml(column.dayType)}">
                Нова ревізія
           </button>`
        : '';
    return `
        <td>
            <div class="ticket-tariff-cell">
                <strong class="${unavailable ? 'ticket-tariff-unavailable' : ''}">${escapeHtml(price)}</strong>
                <small>Діє з ${admissionTicketDateLabel(tariff?.effectiveFrom)}</small>
                <small>Ревізія ${tariff?.revision ?? '—'}</small>
                ${action}
            </div>
        </td>`;
}

function renderAdmissionTicketHistory(type) {
    const history = Array.isArray(type?.tariffHistory) ? type.tariffHistory : [];
    if (!history.length) return '';
    return `
        <details class="ticket-history">
            <summary>Історія тарифів (${history.length})</summary>
            <ul>
                ${history.map(item => `
                    <li>
                        ${escapeHtml(item.admissionContext)} · ${escapeHtml(item.dayType)} ·
                        ${item.availability === 'unavailable' ? 'недоступний' : escapeHtml(admissionTicketMoneyLabel(item.amountUah))} ·
                        з ${admissionTicketDateLabel(item.effectiveFrom)} · rev ${escapeHtml(String(item.revision))}
                        ${item.changeNote ? ` — ${escapeHtml(item.changeNote)}` : ''}
                    </li>`).join('')}
            </ul>
        </details>`;
}

function renderAdmissionTicketCatalog() {
    const container = document.getElementById('ticketCatalogMatrix');
    const state = document.getElementById('ticketCatalogState');
    if (!container || !state) return;
    const types = Array.isArray(admissionTicketCatalog?.ticketTypes)
        ? admissionTicketCatalog.ticketTypes
        : [];
    state.classList.add('hidden');
    if (!types.length) {
        container.innerHTML = centerStateHtml(
            'Каталог порожній',
            'Для поточного business context не знайдено типів квитків.'
        );
        return;
    }
    container.innerHTML = `
        <div class="ticket-matrix-wrap">
            <table class="ticket-matrix">
                <thead>
                    <tr>
                        <th>Тип квитка</th>
                        ${ADMISSION_TARIFF_COLUMNS.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${types.map(type => `
                        <tr>
                            <td>
                                <div class="ticket-type-meta">
                                    <strong>${escapeHtml(type.name)}</strong>
                                    <code>${escapeHtml(type.code)}</code>
                                    <span class="ticket-system-chip">
                                        ${type.audience === 'adult' ? 'Дорослий' : 'Дитячий'} ·
                                        ${type.allocationStrategy === 'remainder' ? 'автоматичний залишок' : 'ручна кількість'}
                                    </span>
                                    ${type.requirementText ? `<span class="ticket-requirement">${escapeHtml(type.requirementText)}</span>` : ''}
                                    ${renderAdmissionTicketHistory(type)}
                                </div>
                            </td>
                            ${ADMISSION_TARIFF_COLUMNS.map(column => renderAdmissionTicketTariffCell(type, column)).join('')}
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

async function loadAdmissionTicketCatalog({ force = false } = {}) {
    if (admissionTicketCatalogLoading) return;
    if (admissionTicketCatalog && !force) {
        renderAdmissionTicketCatalog();
        return;
    }
    const state = document.getElementById('ticketCatalogState');
    const container = document.getElementById('ticketCatalogMatrix');
    if (state) {
        state.classList.remove('hidden', 'is-error');
        state.innerHTML = '<strong>Завантаження тарифів…</strong><small>Читаємо актуальні ревізії для поточного business context.</small>';
    }
    if (container) container.innerHTML = '';
    admissionTicketCatalogLoading = true;
    try {
        const result = await apiGetAdmissionTicketCatalog();
        if (!result?.success) {
            throw new Error(admissionTicketLocalizedMessage(
                result?.error,
                'Не вдалося завантажити каталог квитків.'
            ));
        }
        admissionTicketCatalog = result;
        renderAdmissionTicketCatalog();
    } catch (error) {
        if (state) {
            state.classList.remove('hidden');
            state.classList.add('is-error');
            state.innerHTML = centerStateHtml(
                'Помилка завантаження тарифів',
                error?.message || 'Повторіть спробу.',
                'error'
            );
        }
    } finally {
        admissionTicketCatalogLoading = false;
    }
}

function syncAdmissionTicketTariffAmountInput(availability) {
    const amount = document.getElementById('ticketTariffAmount');
    if (!amount) return;
    const unavailable = availability === 'unavailable';
    amount.disabled = unavailable;
    amount.required = !unavailable;
    amount.setAttribute('aria-required', unavailable ? 'false' : 'true');
    if (unavailable) {
        amount.value = '';
        amount.setAttribute('aria-invalid', 'false');
    }
}

function openAdmissionTicketTariffDialog({ code, context, dayType, errorMessage = '' } = {}) {
    if (!canEditAdmissionTicketTariffs) return;
    const type = admissionTicketCatalog?.ticketTypes?.find(item => item.code === code);
    const tariff = admissionTicketTariffFor(type, context, dayType);
    const latestTariff = admissionTicketLatestTariffFor(type, context, dayType);
    const dialog = document.getElementById('ticketTariffDialog');
    if (!type || !dialog) return;
    document.getElementById('ticketTariffDialogTitle').textContent = `Нова ревізія: ${type.name}`;
    document.getElementById('ticketTariffDialogMeta').textContent = `${context} · ${dayType} · поточна rev ${tariff?.revision ?? 0} · остання rev ${latestTariff?.revision ?? 0}`;
    document.getElementById('ticketTariffCode').value = code;
    document.getElementById('ticketTariffContext').value = context;
    document.getElementById('ticketTariffDay').value = dayType;
    document.getElementById('ticketTariffExpectedRevision').value = String(latestTariff?.revision ?? 0);
    document.getElementById('ticketTariffAvailability').value = tariff?.availability || 'available';
    const amountInput = document.getElementById('ticketTariffAmount');
    amountInput.value = tariff?.amountUah ?? '';
    amountInput.setAttribute('aria-invalid', 'false');
    syncAdmissionTicketTariffAmountInput(tariff?.availability || 'available');
    document.getElementById('ticketTariffEffectiveFrom').value = admissionTicketTodayDateOnly();
    document.getElementById('ticketTariffChangeNote').value = '';
    const error = document.getElementById('ticketTariffError');
    error.textContent = errorMessage;
    error.classList.toggle('hidden', !errorMessage);
    dialog.showModal();
}

async function saveAdmissionTicketTariffRevision(event) {
    event.preventDefault();
    if (!canEditAdmissionTicketTariffs || admissionTicketTariffSaving) return;
    const code = document.getElementById('ticketTariffCode').value;
    const admissionContext = document.getElementById('ticketTariffContext').value;
    const dayType = document.getElementById('ticketTariffDay').value;
    const availability = document.getElementById('ticketTariffAvailability').value;
    const saveButton = document.getElementById('ticketTariffSave');
    const error = document.getElementById('ticketTariffError');
    const amountInput = document.getElementById('ticketTariffAmount');
    const amountRaw = String(amountInput?.value || '').trim();
    const amountUah = Number(amountRaw);
    error.classList.add('hidden');
    amountInput?.setAttribute('aria-invalid', 'false');
    if (
        availability === 'available'
        && (
            !amountRaw
            || !Number.isSafeInteger(amountUah)
            || amountUah < 0
            || amountUah > 2147483647
        )
    ) {
        error.textContent = 'Вкажіть суму цілими гривнями від 0 до 2 147 483 647.';
        error.classList.remove('hidden');
        amountInput?.setAttribute('aria-invalid', 'true');
        amountInput?.focus();
        return;
    }
    admissionTicketTariffSaving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Збереження…';
    const result = await apiCreateAdmissionTicketTariffRevision(code, {
        admissionContext,
        dayType,
        availability,
        amountUah: availability === 'available'
            ? amountUah
            : null,
        effectiveFrom: document.getElementById('ticketTariffEffectiveFrom').value,
        expectedRevision: Number(document.getElementById('ticketTariffExpectedRevision').value),
        changeNote: document.getElementById('ticketTariffChangeNote').value.trim() || null
    });
    admissionTicketTariffSaving = false;
    saveButton.disabled = false;
    saveButton.textContent = 'Зберегти ревізію';
    if (result?.success) {
        document.getElementById('ticketTariffDialog').close();
        admissionTicketCatalog = null;
        await loadAdmissionTicketCatalog({ force: true });
        return;
    }
    if (result?.status === 409) {
        document.getElementById('ticketTariffDialog').close();
        admissionTicketCatalog = null;
        await loadAdmissionTicketCatalog({ force: true });
        openAdmissionTicketTariffDialog({
            code,
            context: admissionContext,
            dayType,
            errorMessage: 'Тариф уже змінив інший керівник. Показано актуальну ревізію — перевірте значення і повторіть зміну.'
        });
        return;
    }
    error.textContent = admissionTicketLocalizedMessage(
        result?.error,
        'Не вдалося зберегти тариф. Перевірте дані та повторіть спробу.'
    );
    error.classList.remove('hidden');
}

function bindAdmissionTicketCatalogUi() {
    const matrix = document.getElementById('ticketCatalogMatrix');
    if (!matrix || matrix.dataset.bound === 'true') return;
    matrix.dataset.bound = 'true';
    matrix.addEventListener('click', event => {
        const button = event.target.closest('.ticket-tariff-edit');
        if (!button) return;
        openAdmissionTicketTariffDialog({
            code: button.dataset.ticketCode,
            context: button.dataset.admissionContext,
            dayType: button.dataset.dayType
        });
    });
    document.getElementById('ticketCatalogRefresh')?.addEventListener('click', () => {
        admissionTicketCatalog = null;
        void loadAdmissionTicketCatalog({ force: true });
    });
    document.getElementById('ticketTariffCancel')?.addEventListener('click', () => {
        if (!admissionTicketTariffSaving) document.getElementById('ticketTariffDialog')?.close();
    });
    document.getElementById('ticketTariffAvailability')?.addEventListener('change', event => {
        syncAdmissionTicketTariffAmountInput(event.target.value);
    });
    document.getElementById('ticketTariffForm')?.addEventListener('submit', saveAdmissionTicketTariffRevision);
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

    bindAdmissionTicketCatalogUi();
    if (new URLSearchParams(window.location.search).get('tab') === 'tickets') {
        void loadAdmissionTicketCatalog();
    }
    setInitialLoadingStates();

    enhanceCenterSectionHeaders();
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

    bindCenterSectionLoading();
    await loadInitiallyVisibleCenterSections();
    initAddLeadBtn();

    // Profile handler
    if (typeof initProfileHandler === 'function') initProfileHandler();
}

window.addEventListener('center:tab-change', event => {
    if (event.detail?.tab === 'tickets') void loadAdmissionTicketCatalog();
});

// ==========================================
// COLLAPSIBLE SECTIONS
// ==========================================

function toggleSection(titleEl) {
    const section = titleEl.closest('.center-section');
    if (!section) return;
    section.classList.toggle('collapsed');
    const expanded = !section.classList.contains('collapsed');
    const toggle = section.querySelector('.center-section-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    // Save state
    const sectionId = section.id;
    if (sectionId) {
        const collapsed = JSON.parse(localStorage.getItem('center_collapsed') || '{}');
        collapsed[sectionId] = section.classList.contains('collapsed');
        localStorage.setItem('center_collapsed', JSON.stringify(collapsed));
    }
    if (expanded) {
        void loadCenterSection(sectionId);
        window.dispatchEvent(new CustomEvent('center:section-open', { detail: { sectionId } }));
    }
}

function restoreCollapsedState() {
    const saved = JSON.parse(localStorage.getItem('center_collapsed') || '{}');
    // Keep the first screen focused on KPI. Sections explicitly left open by a
    // user are restored and loaded once during startup below.
    const defaultOpen = ['kpiSection'];
    document.querySelectorAll('.center-section').forEach(section => {
        const id = section.id;
        if (!id) return;
        const collapsed = id in saved ? Boolean(saved[id]) : !defaultOpen.includes(id);
        section.classList.toggle('collapsed', collapsed);
        const toggle = section.querySelector('.center-section-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
}

function enhanceCenterSectionHeaders() {
    document.querySelectorAll('.center-section').forEach(section => {
        const title = section.querySelector(':scope > .center-section-title');
        const body = section.querySelector(':scope > .section-body');
        if (!title || !body || title.dataset.centerSectionEnhanced === 'true') return;
        const bodyId = body.id || `${section.id || 'center'}Body`;
        body.id = bodyId;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'center-section-toggle';
        toggle.setAttribute('aria-controls', bodyId);
        toggle.setAttribute('aria-expanded', section.classList.contains('collapsed') ? 'false' : 'true');
        Array.from(title.childNodes).forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE && node.matches('.btn-center-action')) return;
            toggle.appendChild(node);
        });
        title.removeAttribute('onclick');
        title.prepend(toggle);
        toggle.addEventListener('click', () => toggleSection(toggle));
        title.dataset.centerSectionEnhanced = 'true';
    });
}

function centerSectionLoader(sectionId) {
    const loaders = {
        kpiSection: loadOverview,
        hotLeadsSection: loadHotLeads,
        conversionSection: loadConversion,
        chartsSection: loadCharts,
        goalsSection: loadGoals,
        briefingSection: loadBriefing,
        workersSection: loadWorkers,
        workloadSection: loadWorkload,
        tasksSection: loadTasks,
        perfSection: loadProgramPerformance,
        heatmapSection: loadHeatmap,
        crossSellSection: loadCrossSell,
        loyaltySection: loadLoyalty,
        discountsSection: loadDiscounts,
        proposalsSection: loadProposals,
        pricesSection: loadPrices,
        catalogSection: loadCatalog,
        reconciliationSection: loadReconciliation,
        eventLogSection: loadEventLog,
        reportSection: loadReport
    };
    return loaders[sectionId] || null;
}

function centerSectionRetry(section) {
    const body = section?.querySelector('.section-body');
    if (!body || body.querySelector('[data-center-section-retry]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-center-action';
    button.dataset.centerSectionRetry = section.id;
    button.textContent = 'Повторити';
    body.appendChild(button);
}

function clearCenterSectionRetry(section) {
    section?.querySelectorAll('[data-center-section-retry]').forEach(button => button.remove());
}

function isInitiallyVisibleCenterSection(section) {
    if (!section?.id || section.classList.contains('collapsed')) return false;
    if (section.hidden || section.style.display === 'none') return false;
    return !section.closest('[hidden], .hidden');
}

async function loadInitiallyVisibleCenterSections() {
    const sections = [...document.querySelectorAll('.center-section')]
        .filter(isInitiallyVisibleCenterSection)
        .filter(section => typeof centerSectionLoader(section.id) === 'function');
    await Promise.all(sections.map(section => loadCenterSection(section.id)));
}

async function loadCenterSection(sectionId, { force = false } = {}) {
    const loader = centerSectionLoader(sectionId);
    if (!loader) return;
    const previous = centerSectionState.get(sectionId);
    if (previous?.status === 'loading') return previous.promise;
    if (!force && previous?.status === 'loaded') return previous.promise;
    const section = document.getElementById(sectionId);
    clearCenterSectionRetry(section);
    const promise = Promise.resolve()
        .then(loader)
        .then(() => {
            const failed = Boolean(section?.querySelector('.center-state.is-error, .center-state--error, .center-error'));
            centerSectionState.set(sectionId, { status: failed ? 'error' : 'loaded', promise: null });
            if (failed) centerSectionRetry(section);
            else clearCenterSectionRetry(section);
        })
        .catch(err => {
            console.error(`Center section ${sectionId} load failed`, err);
            centerSectionState.set(sectionId, { status: 'error', promise: null });
            centerSectionRetry(section);
        });
    centerSectionState.set(sectionId, { status: 'loading', promise });
    return promise;
}

function bindCenterSectionLoading() {
    if (bindCenterSectionLoading.bound) return;
    bindCenterSectionLoading.bound = true;
    document.addEventListener('click', event => {
        const retry = event.target.closest('[data-center-section-retry]');
        if (!retry) return;
        event.preventDefault();
        void loadCenterSection(retry.dataset.centerSectionRetry, { force: true });
    });
}

document.addEventListener('DOMContentLoaded', initCenterPage);
