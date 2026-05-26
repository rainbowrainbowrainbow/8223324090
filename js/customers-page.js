/**
 * customers-page.js — CRM customer management page (v15.1)
 *
 * LLM HINT: Frontend for /customers page.
 * Shows customer list with filters, RFM analytics, CRUD, CSV export.
 * API: GET /api/customers, GET /api/customers/rfm, GET /api/customers/stats,
 *      GET /api/customers/export, POST/PUT/DELETE /api/customers/:id.
 * State is in CrmState object.
 */

// ==========================================
// STATE
// ==========================================

const CrmState = {
    customers: [],
    rfmData: null,
    stats: null,
    businessContext: 'event_genix',
    page: 1,
    pages: 1,
    total: 0,
    editingId: null,
    activeTab: 'list',
    filters: {
        search: '',
        source: '',
        sortBy: 'updated_at',
        dateFrom: '',
        dateTo: '',
        tag: '',
        minVisits: null,
        maxVisits: null,
        journeySegment: '',
        journeyLabel: ''
    }
};

const SOURCE_LABELS = {
    telegram:       '🔵 TG',
    facebook:       '🔷 FB',
    instagram:      '🟣 IG',
    viber:          '🟢 Viber',
    tiktok:         '⚫ TikTok',
    turbo:          '🟠 Turbo',
    bnderoga:       '🟡 BnD',
    google:         '🔍 Google',
    recommendation: '🤝 Рекомендація',
    repeat:         '🔄 Повторний',
    manual:         '✏️ Ручний',
    other:          'Інше',
    unknown:        'Не вказано'
};

const RFM_SEGMENTS = {
    champion: { label: 'Чемпіони', icon: '🏆', color: '#059669' },
    loyal: { label: 'Лояльні', icon: '💚', color: '#2563EB' },
    potential: { label: 'Потенційні', icon: '⭐', color: '#D97706' },
    at_risk: { label: 'Під загрозою', icon: '⚠️', color: '#DC2626' },
    lost: { label: 'Втрачені', icon: '💤', color: '#64748B' }
};

const CUSTOMER_LIFECYCLE_SEGMENTS = [
    {
        id: 'prospects',
        label: 'Перспективні (0 візитів)',
        countKey: 'prospects',
        color: '#7C3AED',
        icon: '◎',
        kind: 'customers',
        minVisits: 0,
        maxVisits: 0,
        actionLabel: 'Показати клієнтів без візитів'
    },
    {
        id: 'first_timers',
        label: 'Нові (1 візит)',
        countKey: 'first_timers',
        color: '#3B82F6',
        icon: '🆕',
        kind: 'customers',
        minVisits: 1,
        maxVisits: 1,
        actionLabel: 'Показати нових клієнтів'
    },
    {
        id: 'returning',
        label: 'Повторні (2-4)',
        countKey: 'returning',
        color: '#10B981',
        icon: '↻',
        kind: 'customers',
        minVisits: 2,
        maxVisits: 4,
        actionLabel: 'Показати повторних клієнтів'
    },
    {
        id: 'loyal',
        label: 'Лояльні (5+)',
        countKey: 'loyal',
        color: '#F59E0B',
        icon: '★',
        kind: 'customers',
        minVisits: 5,
        maxVisits: null,
        actionLabel: 'Показати лояльних клієнтів'
    }
];

// ==========================================
// HELPERS
// ==========================================


function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = date.getFullYear();
    return `${dd}.${mm}.${yy}`;
}

function formatMoney(amount) {
    if (!amount) return '0 ₴';
    return amount.toLocaleString('uk-UA') + ' ₴';
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatDate(value);
    return date.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function customerBusinessContext() {
    return window.CrmBusinessContext?.normalize?.(CrmState.businessContext) || CrmState.businessContext || 'event_genix';
}

function customerApiUrl(url) {
    return window.CrmBusinessContext?.apiUrl
        ? window.CrmBusinessContext.apiUrl(url, customerBusinessContext())
        : url;
}

function customerPayload(payload = {}) {
    return window.CrmBusinessContext?.payload
        ? window.CrmBusinessContext.payload(payload, customerBusinessContext())
        : { ...(payload || {}), businessContext: customerBusinessContext() };
}

function initCustomerBusinessContext(user) {
    const api = window.CrmBusinessContext;
    CrmState.businessContext = api?.set?.(api.current?.() || 'event_genix', { updateUrl: true }) || 'event_genix';
    const select = document.getElementById('customerBusinessContext');
    if (!select || !api?.options) return;
    const options = api.options(user);
    select.innerHTML = options.map(ctx => `<option value="${ctx.key}">${escapeHtml(ctx.label)}</option>`).join('');
    select.value = customerBusinessContext();
    select.hidden = options.length <= 1;
    select.addEventListener('change', async event => {
        CrmState.businessContext = api.set(event.target.value, { updateUrl: true });
        CrmState.page = 1;
        CrmState.rfmData = null;
        await refreshData();
        openCustomerDeepLink();
    });
}

function customerHubText(value, fallback = '—') {
    return value ? escapeHtml(value) : fallback;
}

function customerHubAction(href, label, cls = '', options = {}) {
    if (!href) {
        return `<span class="customer-hub-action disabled ${cls}" aria-disabled="true">${escapeHtml(label)}</span>`;
    }
    const target = options.external ? ' target="_blank" rel="noopener"' : '';
    return `<a class="customer-hub-action ${cls}" href="${escapeHtml(href)}"${target}>${escapeHtml(label)}</a>`;
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function formatSocialIdentitiesInput(identities = []) {
    return parseJsonArray(identities)
        .map(item => [item.channel || item.type || '', item.handle || item.username || item.value || item.externalId || item.url || ''].filter(Boolean).join(': '))
        .filter(Boolean)
        .join('\n');
}

function parseSocialIdentitiesInput(value) {
    return String(value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map(line => {
            const [rawChannel, ...rest] = line.split(':');
            const channel = rest.length ? rawChannel.trim().toLowerCase() : 'other';
            const handle = rest.length ? rest.join(':').trim() : rawChannel.trim();
            return { channel, handle, source: 'operator' };
        });
}

const CUSTOMER_IDENTITY_PRESETS = {
    telegram: { label: 'Telegram', from: 'instagram' },
    viber: { label: 'Viber', from: 'phone' },
    instagram: { label: 'Instagram', from: 'instagram' },
    phone: { label: 'Телефон', from: 'phone' },
    facebook: { label: 'Facebook', from: '' }
};

function normalizeCustomerIdentityHandle(channel, handle) {
    const value = String(handle || '').trim();
    if (!value) return '';
    if ((channel === 'telegram' || channel === 'instagram') && !value.startsWith('@')) return `@${value}`;
    return value;
}

function inferCustomerIdentityHandle(channel) {
    const preset = CUSTOMER_IDENTITY_PRESETS[channel];
    if (!preset) return '';
    if (preset.from === 'phone') return document.getElementById('editPhone')?.value.trim() || '';
    if (preset.from === 'instagram') return document.getElementById('editInstagram')?.value.trim().replace(/^@+/, '') || '';
    return '';
}

function addCustomerIdentityLine(channel) {
    const preset = CUSTOMER_IDENTITY_PRESETS[channel];
    const textarea = document.getElementById('editSocialIdentities');
    if (!preset || !textarea) return;

    const handle = normalizeCustomerIdentityHandle(channel, inferCustomerIdentityHandle(channel));
    const existingLines = String(textarea.value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const alreadyHasChannel = existingLines.some(line => line.toLowerCase().startsWith(`${channel}:`));
    if (alreadyHasChannel) {
        textarea.focus();
        return;
    }
    existingLines.push(`${channel}: ${handle}`);
    textarea.value = existingLines.join('\n');
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
}

function bindCustomerIdentityTools() {
    document.querySelectorAll('[data-customer-identity-add]').forEach(btn => {
        btn.addEventListener('click', () => addCustomerIdentityLine(btn.dataset.customerIdentityAdd));
    });
}

function renderSocialIdentities(identities = [], instagram = '') {
    const normalized = parseJsonArray(identities);
    const items = normalized.length ? normalized : (instagram ? [{ channel: 'instagram', handle: instagram, source: 'legacy_primary' }] : []);
    if (!items.length) return '-';
    return items.map(item => {
        const channel = item.channel || item.type || 'other';
        const value = item.channel === 'instagram' && item.handle ? '@' + item.handle : (item.handle || item.username || item.value || item.externalId || item.url || '');
        return escapeHtml([channel, value].filter(Boolean).join(': '));
    }).join('<br>');
}

function customerHubReplySlaLabel(conversation) {
    if (!conversation?.waitingReply) return '';
    switch (conversation.replySlaState) {
        case 'overdue': return 'SLA прострочено';
        case 'due_soon': return 'SLA скоро спливає';
        case 'on_track': return 'SLA в нормі';
        default: return '';
    }
}

function customerHubWaitingReply(conversation) {
    if (!conversation || !conversation.waitingReply || !conversation.awaitingReplySince) return '';
    const details = [
        `Очікуємо відповідь з ${formatDateTime(conversation.awaitingReplySince)}`,
        customerHubReplySlaLabel(conversation),
        conversation.replyOwner || ''
    ].filter(Boolean).join(' · ');
    return `<div class="customer-hub-waiting-line">${escapeHtml(details)}</div>`;
}

function customerHubConversation(conversation) {
    if (!conversation) return '';
    const confidence = conversation.confidence || 'suggested';
    const statusLabel = confidence === 'exact' ? 'Точний зв’язок' : 'Ймовірний збіг';
    const sendNote = conversation.sendCapable === false
        ? `<span class="customer-hub-warning">${escapeHtml(conversation.channelNote || 'Канал не позначено як готовий до відправки')}</span>`
        : '';

    return `<div class="customer-hub-conversation ${escapeHtml(confidence)}">
        <div class="customer-hub-conversation-top">
            <span class="customer-hub-channel">${customerHubText(conversation.channel)}</span>
            <span class="customer-hub-pill ${escapeHtml(confidence)}">${statusLabel}</span>
            ${conversation.waitingReply ? '<span class="customer-hub-pill waiting">Очікуємо відповідь</span>' : ''}
            ${conversation.unreadCount ? `<span class="customer-hub-unread">${conversation.unreadCount} нових</span>` : ''}
        </div>
        <div class="customer-hub-meta">${customerHubText(conversation.customerName || conversation.customerPhone || 'Omni')} · ${customerHubText(conversation.status)}</div>
        ${customerHubWaitingReply(conversation)}
        <div class="customer-hub-preview">${customerHubText(conversation.lastMessage, 'Останнього повідомлення немає')}</div>
        <div class="customer-hub-meta">${formatDateTime(conversation.lastMessageAt)} ${sendNote}</div>
    </div>`;
}

function renderCustomerCommunicationHub(context) {
    if (!context) {
        return `<div class="customer-hub-empty">Комунікаційний контекст недоступний. Картка клієнта лишається доступною без live-каналу.</div>`;
    }

    const live = context.live || {};
    const links = context.links || {};
    const summary = context.summary || {};
    const primary = live.primaryConversation || null;
    const status = live.status || 'unavailable';
    const statusLabel = status === 'exact'
        ? 'Точна live-розмова'
        : status === 'suggested'
            ? 'Ймовірна live-розмова'
            : 'Live-розмову не знайдено';
    const statusText = live.explanation || 'Перевірте Omni або додайте CRM-нотатку нижче.';
    const omniHref = links.omniExact || links.omniSuggested || links.omniSearch;
    const omniClass = links.omniExact ? 'primary' : (links.omniSuggested ? 'suggested' : '');
    const omniLabel = links.omniExact
        ? 'Відкрити точну Omni-розмову'
        : links.omniSuggested
            ? 'Відкрити ймовірну Omni-розмову'
            : links.omniSearch
                ? 'Шукати в Omni'
                : 'Omni недоступний';
    const booking = context.primaryBooking || null;
    const bookingText = booking
        ? `${formatDate(booking.date)} ${customerHubText(booking.time, '')} · ${customerHubText(booking.programName || booking.label || booking.id)}`
        : 'Пов’язаних бронювань не знайдено';

    return `<div class="customer-comm-hub" data-comm-confidence="${escapeHtml(status)}">
        <div class="customer-hub-status-row">
            <span class="customer-hub-pill ${escapeHtml(status)}">${statusLabel}</span>
            <span class="customer-hub-meta">${escapeHtml(statusText)}</span>
        </div>
        <div class="customer-hub-actions" aria-label="Комунікаційні дії клієнта">
            ${customerHubAction(links.call, 'Подзвонити', 'success')}
            ${customerHubAction(omniHref, 'Telegram у CRM', omniClass)}
            ${customerHubAction(omniHref, omniLabel, omniClass)}
            ${customerHubAction(links.leadWorkspace, 'Відкрити кейс ліда')}
            ${customerHubAction(links.booking, 'Відкрити бронювання')}
        </div>
        <div class="customer-hub-grid">
            <div class="customer-hub-card">
                <div class="customer-hub-card-title">Live Omni</div>
                ${primary ? customerHubConversation(primary) : '<div class="customer-hub-empty">Точної live-розмови немає. Якщо потрібен канал, відкрийте Omni через пошук і зв’яжіть розмову з клієнтом, коли точність підтверджена.</div>'}
            </div>
            <div class="customer-hub-card">
                <div class="customer-hub-card-title">CRM-контекст</div>
                <div class="customer-hub-row"><span>Лід</span><strong>${context.lead?.id ? `#${context.lead.id}` : 'не прив’язано'}</strong></div>
                <div class="customer-hub-row"><span>Бронювання</span><strong>${escapeHtml(bookingText)}</strong></div>
                <div class="customer-hub-row"><span>CRM-журнал</span><strong>${summary.crmLogCount || 0} записів</strong></div>
                <div class="customer-hub-note">CRM-журнал нижче - це внутрішні нотатки/лог. Live-історія повідомлень лишається в Omni.</div>
            </div>
        </div>
        <div class="customer-hub-policy">${escapeHtml(context.sendPolicy?.message || 'Хаб відкриває контекст і канали без прямої відправки з картки клієнта.')}</div>
    </div>`;
}

function getCustomerDeepLinkId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = parseInt(params.get('open') || params.get('highlight'), 10);
    if (Number.isInteger(fromQuery) && fromQuery > 0) return fromQuery;

    const hashMatch = (window.location.hash || '').match(/(?:^#|[?&])id=(\d+)/);
    if (hashMatch) {
        const fromHash = parseInt(hashMatch[1], 10);
        if (Number.isInteger(fromHash) && fromHash > 0) return fromHash;
    }
    return null;
}

function highlightCustomerRow(customerId) {
    const row = document.querySelector(`tr[data-id="${customerId}"]`);
    if (!row) return;
    row.style.outline = '2px solid #2563EB';
    row.style.outlineOffset = '-2px';
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openCustomerDeepLink() {
    const customerId = getCustomerDeepLinkId();
    if (!customerId) return;
    showCustomerDetail(customerId);
    requestAnimationFrame(() => highlightCustomerRow(customerId));
}

function getCustomerLifecycleSegment(segmentId) {
    return CUSTOMER_LIFECYCLE_SEGMENTS.find(segment => segment.id === segmentId) || null;
}

function hasVisitBound(value) {
    return value !== null && value !== undefined && value !== '';
}

function parseJourneyVisitBound(value) {
    if (!hasVisitBound(value)) return null;
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function setCustomerFilterInputsFromState() {
    const fields = {
        searchInput: CrmState.filters.search || '',
        sourceFilter: CrmState.filters.source || '',
        sortFilter: CrmState.filters.sortBy || 'updated_at',
        dateFromFilter: CrmState.filters.dateFrom || '',
        dateToFilter: CrmState.filters.dateTo || '',
        tagFilter: CrmState.filters.tag || ''
    };
    Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
}

function customerLifecycleUrl(stage) {
    const url = new URL('/customers', window.location.origin);
    url.searchParams.set('tab', 'list');
    url.searchParams.set('journey', stage.id);
    if (customerBusinessContext() !== 'event_genix') url.searchParams.set('businessContext', customerBusinessContext());
    if (hasVisitBound(stage.minVisits)) url.searchParams.set('minVisits', stage.minVisits);
    if (hasVisitBound(stage.maxVisits)) url.searchParams.set('maxVisits', stage.maxVisits);
    return url;
}

function syncCustomerLifecycleUrl(stage) {
    if (!window.history?.replaceState || !stage) return;
    const url = customerLifecycleUrl(stage);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

function applyCustomerLifecycleSegment(stage, options = {}) {
    if (!stage || stage.kind !== 'customers') return false;
    CrmState.filters = {
        ...CrmState.filters,
        search: '',
        source: '',
        sortBy: 'total_bookings',
        dateFrom: '',
        dateTo: '',
        tag: '',
        minVisits: hasVisitBound(stage.minVisits) ? stage.minVisits : null,
        maxVisits: hasVisitBound(stage.maxVisits) ? stage.maxVisits : null,
        journeySegment: stage.id,
        journeyLabel: stage.label
    };
    CrmState.page = 1;
    setCustomerFilterInputsFromState();
    if (!options.skipUrl) syncCustomerLifecycleUrl(stage);
    return true;
}

function applyInitialCustomerQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab') || '';
    const requestedJourney = params.get('journey') || '';
    const stage = getCustomerLifecycleSegment(requestedJourney);
    if (stage?.kind === 'customers') {
        applyCustomerLifecycleSegment(stage, { skipUrl: true });
        return 'list';
    }
    const minVisits = params.get('minVisits');
    const maxVisits = params.get('maxVisits');
    if (hasVisitBound(minVisits) || hasVisitBound(maxVisits)) {
        CrmState.filters.minVisits = parseJourneyVisitBound(minVisits);
        CrmState.filters.maxVisits = parseJourneyVisitBound(maxVisits);
        CrmState.filters.sortBy = 'total_bookings';
        setCustomerFilterInputsFromState();
    }
    return ['list', 'rfm', 'duplicates', 'nps', 'bulk'].includes(requestedTab) ? requestedTab : '';
}

function getCustomerFilterSummary() {
    const f = CrmState.filters;
    return [
        f.journeyLabel ? { label: 'Сегмент клієнтів', value: f.journeyLabel } : null,
        f.search ? { label: 'Пошук', value: f.search } : null,
        f.tag ? { label: 'Тег', value: f.tag } : null,
        f.source ? { label: 'Джерело', value: SOURCE_LABELS[f.source] || f.source } : null,
        f.dateFrom ? { label: 'Візити від', value: f.dateFrom } : null,
        f.dateTo ? { label: 'Візити до', value: f.dateTo } : null
    ].filter(Boolean);
}

function renderCustomerExplainability() {
    if (!window.Explainability) return;
    const filters = getCustomerFilterSummary();
    const html = Explainability.renderFilterSummary(filters, {
        label: 'Фільтри клієнтів',
        clearAction: filters.length ? 'customers' : '',
        clearLabel: 'Показати всіх клієнтів'
    });
    Explainability.setRegion('customerExplainability', html);
}

async function resetCustomerFilters() {
    CrmState.filters = {
        search: '',
        source: '',
        sortBy: 'updated_at',
        dateFrom: '',
        dateTo: '',
        tag: '',
        minVisits: null,
        maxVisits: null,
        journeySegment: '',
        journeyLabel: ''
    };
    CrmState.page = 1;
    const fields = {
        searchInput: '',
        sourceFilter: '',
        sortFilter: 'updated_at',
        dateFromFilter: '',
        dateToFilter: '',
        tagFilter: ''
    };
    Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
    await fetchCustomers();
    renderCustomerTable();
    renderPagination();
}

function customerEmptyHtml() {
    const filters = getCustomerFilterSummary();
    if (window.Explainability) {
        return Explainability.renderEmptyState({
            icon: '👥',
            title: filters.length ? 'Клієнтів за цими фільтрами не знайдено' : 'Клієнтів ще немає',
            message: filters.length
                ? 'Поточний пошук, тег, джерело або діапазон дат приховали всі записи. Скиньте фільтри, щоб повернути повний список.'
                : 'Коли клієнта буде створено або привʼязано до бронювання, він зʼявиться у цьому списку.',
            clearAction: filters.length ? 'customers' : '',
            clearLabel: 'Показати всіх клієнтів'
        });
    }
    return filters.length ? 'Клієнтів за цими фільтрами не знайдено' : 'Клієнтів ще немає';
}

// ==========================================
// API CALLS
// ==========================================

async function fetchCustomers() {
    const token = localStorage.getItem('pzp_token');
    const params = new URLSearchParams();
    params.set('page', CrmState.page);
    params.set('limit', 50);
    if (CrmState.filters.search) params.set('search', CrmState.filters.search);
    if (CrmState.filters.source) params.set('source', CrmState.filters.source);
    if (CrmState.filters.sortBy) params.set('sortBy', CrmState.filters.sortBy);
    if (CrmState.filters.dateFrom) params.set('dateFrom', CrmState.filters.dateFrom);
    if (CrmState.filters.dateTo) params.set('dateTo', CrmState.filters.dateTo);
    if (CrmState.filters.tag) params.set('tag', CrmState.filters.tag);
    if (hasVisitBound(CrmState.filters.minVisits)) params.set('minVisits', CrmState.filters.minVisits);
    if (hasVisitBound(CrmState.filters.maxVisits)) params.set('maxVisits', CrmState.filters.maxVisits);

    const tableBody = document.getElementById('crmTableBody');
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="8" class="empty-state">Завантаження...</td></tr>';

    const res = await fetch(customerApiUrl(`/api/customers?${params}`), {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401 || res.status === 403) {
        window.location.href = '/';
        return;
    }
    const data = await res.json();
    CrmState.customers = data.customers || [];
    CrmState.total = data.total || 0;
    CrmState.pages = data.pages || 1;
    CrmState.page = data.page || 1;
}

async function fetchStats() {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(customerApiUrl('/api/customers/stats'), {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    CrmState.stats = await res.json();
}

async function fetchRFM() {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(customerApiUrl('/api/customers/rfm'), {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    CrmState.rfmData = await res.json();
}

async function fetchCustomerDetail(id) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(customerApiUrl(`/api/customers/${id}`), {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(payload.error || 'Помилка завантаження клієнта');
    }
    return payload;
}

async function fetchCustomerCommunicationContext(id) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(customerApiUrl(`/api/customers/${id}/communication-context`), {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('communication context error');
    const data = await res.json();
    return data.context || null;
}

async function saveCustomer(data) {
    const token = localStorage.getItem('pzp_token');
    const url = CrmState.editingId
        ? `/api/customers/${CrmState.editingId}`
        : '/api/customers';
    const method = CrmState.editingId ? 'PUT' : 'POST';

    const res = await fetch(customerApiUrl(url), {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(customerPayload(data))
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(payload.error || 'Помилка збереження клієнта');
    }
    return payload;
}

async function deleteCustomer(id) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(customerApiUrl(`/api/customers/${id}`), {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

// ==========================================
// RENDERING
// ==========================================

function renderStats() {
    const el = document.getElementById('crmStats');
    if (!CrmState.stats) {
        el.innerHTML = '';
        return;
    }
    const s = CrmState.stats;
    el.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${s.total}</div>
            <div class="stat-label">Клієнтів</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${s.averages?.avg_bookings || 0}</div>
            <div class="stat-label">Сер. візитів</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${formatMoney(parseInt(s.averages?.avg_spent) || 0)}</div>
            <div class="stat-label">Сер. витрати</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${s.bySource?.length || 0}</div>
            <div class="stat-label">Джерел</div>
        </div>
    `;
}

function renderCustomerTable() {
    const tbody = document.getElementById('customerTableBody');
    renderCustomerExplainability();
    if (CrmState.customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">
            ${customerEmptyHtml()}
        </td></tr>`;
        return;
    }

    tbody.innerHTML = CrmState.customers.map(c => {
        const sourceLabel = SOURCE_LABELS[c.source] || c.source || '—';
        const tagsHtml = (c.tags || []).map(t =>
            `<span class="crm-tag-pill" style="background:${escapeHtml(t.color)}20;color:${escapeHtml(t.color)};border:1px solid ${escapeHtml(t.color)}40">${escapeHtml(t.tag)}</span>`
        ).join('');
        const ltvBadge = c.ltv > 10000 ? ' 🔥' : '';
        return `<tr data-id="${c.id}">
            <td>
                <div class="customer-name">${escapeHtml(c.name)}${ltvBadge}</div>
                ${c.childName ? `<div class="customer-child">👶 ${escapeHtml(c.childName)}</div>` : ''}
                ${tagsHtml ? `<div class="crm-tags-row">${tagsHtml}</div>` : ''}
            </td>
            <td>${escapeHtml(c.phone) || '—'}</td>
            <td>${c.instagram ? '@' + escapeHtml(c.instagram) : '—'}</td>
            <td>${c.source ? `<span class="badge badge-source badge-source-${escapeHtml(c.source)}">${escapeHtml(sourceLabel)}</span>` : '—'}</td>
            <td><span class="badge badge-visits">${c.totalBookings}</span></td>
            <td><span class="badge badge-spent">${formatMoney(c.totalSpent)}</span></td>
            <td>${formatDate(c.lastVisit)}</td>
        </tr>`;
    }).join('');

    // Click handler for rows
    tbody.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => {
            const id = parseInt(row.dataset.id);
            showCustomerDetail(id);
        });
    });
}

function renderPagination() {
    const el = document.getElementById('pagination');
    if (CrmState.pages <= 1) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = `
        <button ${CrmState.page <= 1 ? 'disabled' : ''} data-page="${CrmState.page - 1}">‹</button>
        <span class="page-info">${CrmState.page} / ${CrmState.pages} (${CrmState.total})</span>
        <button ${CrmState.page >= CrmState.pages ? 'disabled' : ''} data-page="${CrmState.page + 1}">›</button>
    `;

    el.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', async () => {
            CrmState.page = parseInt(btn.dataset.page);
            await fetchCustomers();
            renderCustomerTable();
            renderPagination();
        });
    });
}

function renderRFM() {
    if (!CrmState.rfmData) return;

    const overviewEl = document.getElementById('rfmOverview');
    const segments = CrmState.rfmData.segments;

    overviewEl.innerHTML = Object.entries(RFM_SEGMENTS).map(([key, seg]) => {
        const count = segments[key === 'at_risk' ? 'atRisk' : key] || 0;
        return `<div class="rfm-segment-card">
            <div class="rfm-segment-icon" style="background: ${seg.color}15">${seg.icon}</div>
            <div class="rfm-segment-info">
                <div class="rfm-count" style="color: ${seg.color}">${count}</div>
                <div class="rfm-label">${seg.label}</div>
            </div>
        </div>`;
    }).join('');

    const tbody = document.getElementById('rfmTableBody');
    const customers = CrmState.rfmData.customers || [];

    if (customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6">
            <div class="crm-empty">
                <div class="empty-icon">📊</div>
                <div class="empty-text">Недостатньо даних для аналітики</div>
            </div>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = customers.map(c => {
        const seg = RFM_SEGMENTS[c.rfmSegment] || RFM_SEGMENTS.potential;
        return `<tr data-id="${c.id}">
            <td><span class="customer-name">${escapeHtml(c.name)}</span></td>
            <td>${c.recencyDays !== null ? c.recencyDays + ' дн.' : '—'}</td>
            <td>${c.frequency}</td>
            <td>${formatMoney(c.monetary)}</td>
            <td><b>${c.rfmScore}</b> (${c.rScore}/${c.fScore}/${c.mScore})</td>
            <td><span class="badge rfm-${c.rfmSegment}">${seg.icon} ${seg.label}</span></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => {
            showCustomerDetail(parseInt(row.dataset.id));
        });
    });
}

async function showCustomerDetail(id) {
    const modal = document.getElementById('customerDetailModal');
    const content = document.getElementById('customerDetailContent');
    content.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400)">Завантаження...</div>';
    modal.classList.remove('hidden');

    try {
        const customer = await fetchCustomerDetail(id);

        let html = `
            <div class="entity-card-shell entity-card-shell-view entity-card-customer" data-entity-card-mode="customer">
            <div class="customer-detail-header entity-card-header">
                <div class="entity-card-title-block">
                    <span class="entity-card-kicker">Customer workspace</span>
                    <h3>${escapeHtml(customer.name)}</h3>
                    <div class="entity-card-meta">${escapeHtml(customer.phone) || 'телефон не вказано'}${customer.instagram ? ' · @' + escapeHtml(customer.instagram) : ''}</div>
                </div>
                <div class="entity-card-actions">
                    <button class="btn-page-secondary entity-card-action" onclick="editCustomer(${customer.id})">✏️ Редагувати</button>
                    <button class="btn-page-secondary entity-card-action danger" onclick="confirmDeleteCustomer(${customer.id})">🗑 Видалити</button>
                </div>
            </div>
            <div class="detail-section">
                <h4>Контакти</h4>
                <div class="detail-grid">
                    <div class="detail-field">
                        <div class="field-label">Телефон</div>
                        <div class="field-value">${escapeHtml(customer.phone) || '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Instagram</div>
                        <div class="field-value">${customer.instagram ? '@' + escapeHtml(customer.instagram) : '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Соц. ідентичності</div>
                        <div class="field-value">${renderSocialIdentities(customer.socialIdentities, customer.instagram)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Ім'я дитини</div>
                        <div class="field-value">${escapeHtml(customer.childName) || '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">ДН дитини</div>
                        <div class="field-value">${formatDate(customer.childBirthday)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Джерело</div>
                        <div class="field-value">${SOURCE_LABELS[customer.source] || escapeHtml(customer.source) || '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Клієнт з</div>
                        <div class="field-value">${formatDate(customer.createdAt)}</div>
                    </div>
                </div>
            </div>
            <div class="detail-section">
                <h4>Статистика</h4>
                <div class="detail-grid">
                    <div class="detail-field">
                        <div class="field-label">Бронювань</div>
                        <div class="field-value">${customer.totalBookings}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Витрачено</div>
                        <div class="field-value">${formatMoney(customer.totalSpent)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Перший візит</div>
                        <div class="field-value">${formatDate(customer.firstVisit)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Останній візит</div>
                        <div class="field-value">${formatDate(customer.lastVisit)}</div>
                    </div>
            </div>
            </div>`;

        html += `<div class="detail-section customer-comm-hub-section">
            <h4>Комунікаційний хаб</h4>
            <div id="customerCommHub" class="customer-comm-hub-loading" aria-live="polite">Завантаження комунікаційного контексту...</div>
        </div>`;

        // v30.4: Tags section
        html += `<div class="detail-section">
            <h4>Теги</h4>
            <div class="crm-tags-detail" id="detailTags">
                ${(customer.tags || []).map(t =>
                    `<span class="crm-tag-pill" style="background:${t.color}20;color:${t.color};border:1px solid ${t.color}40">${escapeHtml(t.tag)} <button class="crm-tag-remove" onclick="removeTag(${customer.id},${t.id})">×</button></span>`
                ).join('')}
                <button class="crm-tag-add-btn" onclick="showAddTagDropdown(${customer.id})">+ Тег</button>
            </div>
        </div>`;

        // v30.4: LTV
        if (customer.ltv > 0) {
            html += `<div class="detail-section">
                <h4>LTV (Lifetime Value)</h4>
                <div class="stat-value" style="font-size:24px;color:var(--primary)">${formatMoney(customer.ltv)}</div>
            </div>`;
        }

        // v30.4: Communications timeline
        html += `<div class="detail-section">
            <h4>CRM-журнал комунікацій <button class="crm-tag-add-btn" onclick="addCommunication(${customer.id})" style="margin-left:8px">+ Нотатка</button></h4>
            <div class="customer-hub-note">Це внутрішні записи CRM. Live-історія повідомлень відкривається окремо в Omni.</div>
            <div id="detailComms" class="comm-timeline"><div style="color:var(--gray-400);font-size:12px">Завантаження...</div></div>
        </div>`;

        if (customer.notes) {
            html += `<div class="detail-section">
                <h4>Нотатки</h4>
                <div style="font-size:13px;color:var(--gray-600);white-space:pre-wrap">${escapeHtml(customer.notes)}</div>
            </div>`;
        }

        // Certificates
        if (customer.certificates && customer.certificates.length > 0) {
            html += `<div class="detail-section">
                <h4>Сертифікати (${customer.certificates.length})</h4>
                <div class="detail-bookings">`;
            for (const cert of customer.certificates) {
                const statusIcon = cert.status === 'active' ? '🟢' : cert.status === 'used' ? '✅' : '🔴';
                html += `<div class="detail-booking-row">
                    <span>${statusIcon}</span>
                    <span style="font-weight:700">${escapeHtml(cert.certCode)}</span>
                    <span>${escapeHtml(cert.displayValue)}</span>
                    <span style="color:var(--gray-400);margin-left:auto">${formatDate(cert.validUntil)}</span>
                </div>`;
            }
            html += `</div></div>`;
        }

        // Bookings
        if (customer.bookings && customer.bookings.length > 0) {
            html += `<div class="detail-section">
                <h4>Історія бронювань (${customer.bookings.length})</h4>
                <div class="detail-bookings">`;
            for (const b of customer.bookings) {
                const statusIcon = b.status === 'confirmed' ? '✅' : b.status === 'cancelled' ? '❌' : '⏳';
                html += `<div class="detail-booking-row">
                    <span>${statusIcon}</span>
                    <span style="font-weight:700">${formatDate(b.date)}</span>
                    <span>${escapeHtml(b.time || '')}</span>
                    <span>${escapeHtml(b.label || b.programName || '')}</span>
                    <span style="color:var(--gray-400);margin-left:auto">${b.price ? formatMoney(b.price) : ''}</span>
                </div>`;
            }
            html += `</div></div>`;
        }

        html += `</div>`;
        content.innerHTML = html;

        loadCommunicationHub(customer.id);

        // Load communications timeline
        loadCommunications(customer.id).then(comms => {
            const commsEl = document.getElementById('detailComms');
            if (!commsEl) return;
            const COMM_ICONS = { call: '📞', sms: '💬', telegram: '💬', email: '📧', note: '📝', meeting: '🤝' };
            if (comms.length === 0) {
                commsEl.innerHTML = '<div class="customer-hub-empty">CRM-журнал поки порожній. Live-історія повідомлень відкривається в Omni.</div>';
                return;
            }
            commsEl.innerHTML = comms.map(c => `<div class="comm-entry">
                <span class="comm-icon">${COMM_ICONS[c.type] || '📝'}</span>
                <span class="comm-text">${escapeHtml(c.summary)}</span>
                <span class="comm-date">${formatDate(c.created_at || c.createdAt)}</span>
            </div>`).join('');
        });
    } catch (err) {
        content.innerHTML = `<div style="text-align:center;padding:20px;color:#DC2626">Помилка завантаження</div>`;
    }
}

function closeCustomerDetailModal() {
    const modal = document.getElementById('customerDetailModal');
    if (!modal) return true;
    modal.dataset.backdropPointerDown = 'false';
    modal.classList.add('hidden');
    return true;
}

function bindEntityModalSafeClose(modal, closeFn) {
    if (!modal || modal.dataset.entitySafeCloseBound === 'true') return;
    modal.dataset.entitySafeCloseBound = 'true';
    modal.dataset.backdropPointerDown = 'false';

    const content = modal.querySelector('.modal-content');
    if (content) {
        content.addEventListener('pointerdown', (event) => {
            modal.dataset.backdropPointerDown = 'false';
            event.stopPropagation();
        });
        content.addEventListener('click', (event) => event.stopPropagation());
    }

    modal.addEventListener('pointerdown', (event) => {
        modal.dataset.backdropPointerDown = String(event.target === modal);
    });

    modal.addEventListener('pointerup', (event) => {
        const startedOnBackdrop = modal.dataset.backdropPointerDown === 'true';
        modal.dataset.backdropPointerDown = 'false';
        if (!startedOnBackdrop || event.target !== modal) return;
        closeFn();
    });
}

function bindCustomerEntityEscapeClose() {
    if (bindCustomerEntityEscapeClose.bound) return;
    bindCustomerEntityEscapeClose.bound = true;

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (document.querySelector('.confirm-overlay')) return;
        const editModal = document.getElementById('customerEditModal');
        const detailModal = document.getElementById('customerDetailModal');
        if (editModal && !editModal.classList.contains('hidden')) {
            event.preventDefault();
            closeEditModal(false);
            return;
        }
        if (detailModal && !detailModal.classList.contains('hidden')) {
            event.preventDefault();
            closeCustomerDetailModal();
        }
    });
}

// ==========================================
// CRUD HANDLERS
// ==========================================

let _customerEditInitialState = '';

function getCustomerEditState() {
    const ids = ['editName', 'editPhone', 'editInstagram', 'editChildName', 'editChildBirthday', 'editSource', 'editSocialIdentities', 'editNotes'];
    return ids.map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
}

function isCustomerEditDirty() {
    return getCustomerEditState() !== _customerEditInitialState;
}

function openEditModal(customer) {
    CrmState.editingId = customer ? customer.id : null;
    document.getElementById('customerEditTitle').textContent = customer ? 'Редагувати клієнта' : 'Новий клієнт';

    document.getElementById('editName').value = customer?.name || '';
    document.getElementById('editPhone').value = customer?.phone || '';
    document.getElementById('editInstagram').value = customer?.instagram || '';
    document.getElementById('editChildName').value = customer?.childName || '';
    document.getElementById('editChildBirthday').value = customer?.childBirthday ? customer.childBirthday.slice(0, 10) : '';
    document.getElementById('editSource').value = customer?.source || '';
    document.getElementById('editSocialIdentities').value = formatSocialIdentitiesInput(customer?.socialIdentities || []);
    document.getElementById('editNotes').value = customer?.notes || '';

    const modal = document.getElementById('customerEditModal');
    _customerEditInitialState = getCustomerEditState();
    modal?.classList.remove('hidden');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
    document.getElementById('editName')?.focus();
}

async function closeEditModal(force = false) {
    const modal = document.getElementById('customerEditModal');
    const closeNow = () => {
        modal?.classList.add('hidden');
        CrmState.editingId = null;
        _customerEditInitialState = getCustomerEditState();
    };
    if (window.UnsafeDismissGuard && modal) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            force,
            isDirty: isCustomerEditDirty,
            message: 'Є незбережені зміни клієнта. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    closeNow();
    return true;
}

async function handleSave() {
    const name = document.getElementById('editName')?.value.trim();
    if (!name) {
        showNotification("Ім'я клієнта обов'язкове", 'error');
        return;
    }

    const saveBtn = document.getElementById('saveCustomerBtn');
    const originalSaveText = saveBtn?.textContent;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = CrmState.editingId ? 'Зберігаю...' : 'Створюю...';
    }

    const data = {
        name,
        phone: document.getElementById('editPhone')?.value.trim() || null,
        instagram: document.getElementById('editInstagram')?.value.trim().replace('@', '') || null,
        childName: document.getElementById('editChildName')?.value.trim() || null,
        childBirthday: document.getElementById('editChildBirthday')?.value || null,
        socialIdentities: parseSocialIdentitiesInput(document.getElementById('editSocialIdentities')?.value),
        source: document.getElementById('editSource')?.value || null,
        notes: document.getElementById('editNotes')?.value.trim() || null
    };

    try {
        const wasEditing = Boolean(CrmState.editingId);
        const result = await saveCustomer(data);
        if (result.error) {
            showNotification(result.error, 'error');
            return;
        }
        await closeEditModal(true);
        showNotification(wasEditing ? 'Клієнта оновлено' : 'Клієнта створено');
        await refreshData();
        if (!wasEditing && result?.id) {
            await showCustomerDetail(result.id);
        }
    } catch (err) {
        showNotification(err.message || 'Помилка збереження', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalSaveText || 'Зберегти';
        }
    }
}

// Global function called from detail modal
window.editCustomer = async function(id) {
    const customer = await fetchCustomerDetail(id);
    closeCustomerDetailModal();
    openEditModal(customer);
};

window.confirmDeleteCustomer = async function(id) {
    if (!await confirmModal('Видалити клієнта? Бронювання будуть відв\'язані.', { type: 'danger', okText: 'Видалити' })) return;
    try {
        await deleteCustomer(id);
        closeCustomerDetailModal();
        showNotification('Клієнта видалено');
        await refreshData();
    } catch (err) {
        showNotification('Помилка видалення', 'error');
    }
};

// ==========================================
// v30.4: TAG MANAGEMENT
// ==========================================

window.removeTag = async function(customerId, tagId) {
    const token = localStorage.getItem('pzp_token');
    try {
        await fetch(customerApiUrl(`/api/customers/${customerId}/tags/${tagId}`), {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        });
        showCustomerDetail(customerId);
        refreshData();
    } catch (err) {
        console.error('removeTag error', err);
        if (typeof showNotification === 'function') showNotification('Помилка видалення тегу: ' + err.message, 'error');
    }
};

window.showAddTagDropdown = function(customerId) {
    const predefined = ['VIP', 'Проблемний', 'Корпорат', 'Рекомендація', 'Постійний'];
    const colors = { 'VIP': '#F59E0B', 'Проблемний': '#EF4444', 'Корпорат': '#3B82F6', 'Рекомендація': '#10B981', 'Постійний': '#8B5CF6' };
    const html = predefined.map(t =>
        `<button class="crm-tag-option" onclick="addTag(${customerId},'${t}','${colors[t]}')" style="color:${colors[t]}">${t}</button>`
    ).join('');
    const container = document.getElementById('detailTags');
    // Remove existing dropdown
    const old = container.querySelector('.crm-tag-dropdown');
    if (old) { old.remove(); return; }
    const dropdown = document.createElement('div');
    dropdown.className = 'crm-tag-dropdown';
    dropdown.innerHTML = html;
    container.appendChild(dropdown);
};

window.addTag = async function(customerId, tag, color) {
    const token = localStorage.getItem('pzp_token');
    try {
        await fetch(customerApiUrl(`/api/customers/${customerId}/tags`), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag, color })
        });
        showCustomerDetail(customerId);
        refreshData();
    } catch (err) {
        console.error('addTag error', err);
        if (typeof showNotification === 'function') showNotification('Помилка додавання тегу: ' + err.message, 'error');
    }
};

// ==========================================
// v30.4: DUPLICATES
// ==========================================

async function loadDuplicates() {
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch(customerApiUrl('/api/customers/duplicates'), { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const el = document.getElementById('tabDuplicates');
        if (!data.duplicates || data.duplicates.length === 0) {
            el.innerHTML = '<div class="crm-empty"><div class="empty-icon">✅</div><div class="empty-text">Дублікатів не знайдено</div></div>';
            return;
        }
        el.innerHTML = `<h4 style="margin-bottom:12px">⚠️ Знайдено ${data.count} можливих дублікатів</h4>
            <div class="duplicates-list">${data.duplicates.map(d => `
                <div class="duplicate-pair">
                    <div class="dup-card">
                        <b>${escapeHtml(d.name1)}</b><br>
                        📞 ${escapeHtml(d.phone1 || '—')} · IG: ${escapeHtml(d.ig1 || '—')}<br>
                        ${d.bookings1} бронювань · ${formatMoney(d.spent1)}
                    </div>
                    <span class="dup-match">= ${d.match_type === 'phone' ? '📞' : '📷'}</span>
                    <div class="dup-card">
                        <b>${escapeHtml(d.name2)}</b><br>
                        📞 ${escapeHtml(d.phone2 || '—')} · IG: ${escapeHtml(d.ig2 || '—')}<br>
                        ${d.bookings2} бронювань · ${formatMoney(d.spent2)}
                    </div>
                    <button class="btn-page-primary" onclick="mergeCustomers(${d.id1},${d.id2})" style="padding:6px 12px;font-size:12px;min-height:36px">Об'єднати →</button>
                </div>
            `).join('')}</div>`;
    } catch { /* duplicates load failed */ }
}

window.mergeCustomers = async function(primaryId, duplicateId) {
    if (!await confirmModal(`Об'єднати клієнтів? Всі бронювання будуть перенесені до основного профілю.`, { type: 'warning', okText: "Об'єднати" })) return;
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch(customerApiUrl(`/api/customers/${primaryId}/merge`), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ duplicateId })
        });
        const data = await res.json();
        if (data.success) {
            showNotification('Клієнтів об\'єднано');
            loadDuplicates();
            refreshData();
        } else {
            showNotification(data.error || 'Помилка', 'error');
        }
    } catch { showNotification('Помилка об\'єднання', 'error'); }
};

// ==========================================
// v30.4: COMMUNICATIONS
// ==========================================

async function loadCommunicationHub(customerId) {
    const hubEl = document.getElementById('customerCommHub');
    if (!hubEl) return;

    try {
        const context = await fetchCustomerCommunicationContext(customerId);
        hubEl.innerHTML = renderCustomerCommunicationHub(context);
    } catch (err) {
        hubEl.innerHTML = `<div class="customer-hub-empty error">Комунікаційний контекст недоступний. Картка клієнта та CRM-журнал нижче лишаються доступними.</div>`;
    }
}

async function loadCommunications(customerId) {
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch(customerApiUrl(`/api/customers/${customerId}/communications`), { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        return data.communications || [];
    } catch { return []; }
}

window.addCommunication = async function(customerId) {
    const summary = await promptModal('Нотатка:', { placeholder: 'Введіть нотатку...' });
    if (!summary) return;
    const token = localStorage.getItem('pzp_token');
    await fetch(customerApiUrl(`/api/customers/${customerId}/communications`), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note', direction: 'internal', summary })
    });
    showCustomerDetail(customerId);
};

// ==========================================
// v30.4: NPS DASHBOARD
// ==========================================

async function loadNps() {
    const token = localStorage.getItem('pzp_token');
    const el = document.getElementById('tabNps');
    try {
        const res = await fetch(customerApiUrl('/api/customers/nps-stats'), { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!data.success) { el.innerHTML = '<div class="crm-empty"><div class="empty-icon">📊</div><div class="empty-text">Дані NPS недоступні</div></div>'; return; }

        const avg = parseFloat(data.avgNps) || 0;
        const total = parseInt(data.totalReviews) || 0;
        const dist = data.distribution || [];
        const recent = data.recentReviews || [];

        const scoreColor = avg >= 4 ? '#059669' : avg >= 3 ? '#D97706' : '#DC2626';
        const maxCount = Math.max(1, ...dist.map(d => parseInt(d.count) || 0));

        const NPS_COLORS = { 5: '#059669', 4: '#10B981', 3: '#F59E0B', 2: '#F97316', 1: '#EF4444' };

        el.innerHTML = `<div class="nps-dashboard">
            <div class="nps-score-card">
                <div class="nps-big-score" style="color:${scoreColor}">${avg.toFixed(1)}</div>
                <div style="font-size:14px;font-weight:700;color:var(--gray-500);margin-top:4px">Середня оцінка</div>
                <div style="font-size:12px;color:var(--gray-400);margin-top:4px">${total} відгуків</div>
            </div>
            <div class="nps-score-card">
                <h4 style="margin-bottom:12px;font-size:12px;font-weight:800;color:var(--gray-500);text-transform:uppercase">Розподіл оцінок</h4>
                ${[5,4,3,2,1].map(score => {
                    const item = dist.find(d => parseInt(d.rating) === score);
                    const count = item ? parseInt(item.count) : 0;
                    const pct = Math.round(count / maxCount * 100);
                    return `<div class="nps-bar-row">
                        <span class="nps-bar-label">${'⭐'.repeat(score)}</span>
                        <div class="nps-bar-track"><div class="nps-bar-fill" style="width:${pct}%;background:${NPS_COLORS[score]}"></div></div>
                        <span class="nps-bar-count">${count}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>
        ${recent.length > 0 ? `<div style="margin-top:16px">
            <h4 style="margin-bottom:12px;font-size:12px;font-weight:800;color:var(--gray-500);text-transform:uppercase">Останні відгуки</h4>
            <div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Клієнт</th><th>Оцінка</th><th>Коментар</th><th>Дата</th></tr></thead><tbody>
            ${recent.map(r => `<tr>
                <td class="customer-name">${escapeHtml(r.customer_name || r.customerName || '—')}</td>
                <td>${'⭐'.repeat(parseInt(r.rating) || 0)}</td>
                <td>${escapeHtml(r.comment || '—')}</td>
                <td>${formatDate(r.created_at || r.createdAt)}</td>
            </tr>`).join('')}
            </tbody></table></div>
        </div>` : ''}`;
    } catch { el.innerHTML = '<div class="crm-empty"><div class="empty-icon">📊</div><div class="empty-text">Помилка завантаження NPS</div></div>'; }
}

// ==========================================
// v30.4: BULK MESSAGING
// ==========================================

async function loadBulkTab() {
    const el = document.getElementById('tabBulk');
    el.innerHTML = `<div class="bulk-form">
        <h4 style="margin-bottom:16px;font-size:14px;font-weight:800">Масова розсилка Telegram</h4>
        <label>Фільтр по тегу</label>
        <select id="bulkTagFilter">
            <option value="">Всі клієнти</option>
            <option value="VIP">VIP</option>
            <option value="Корпорат">Корпорат</option>
            <option value="Постійний">Постійний</option>
        </select>
        <label>Мін. кількість візитів</label>
        <input type="number" id="bulkMinVisits" value="0" min="0">
        <label>Джерело</label>
        <select id="bulkSourceFilter">
            <option value="">Всі джерела</option>
            <option value="telegram">Telegram</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
        </select>
        <label>Шаблон повідомлення</label>
        <textarea id="bulkTemplate" placeholder="Привіт, {name}! Запрошуємо {childName} на свято 🎉"></textarea>
        <div style="font-size:11px;color:var(--gray-400);margin-top:-8px;margin-bottom:12px">Доступні змінні: {name}, {childName}, {phone}</div>
        <div id="bulkPreview" class="bulk-preview" style="display:none"></div>
        <div style="display:flex;gap:8px">
            <button class="btn-page-secondary" onclick="previewBulk()" style="flex:1">Попередній перегляд</button>
            <button class="btn-page-primary" onclick="sendBulk()" style="flex:1">Надіслати</button>
        </div>
    </div>`;
}

window.previewBulk = async function() {
    const token = localStorage.getItem('pzp_token');
    const filters = {
        tags: document.getElementById('bulkTagFilter')?.value ? [document.getElementById('bulkTagFilter')?.value] : [],
        minVisits: parseInt(document.getElementById('bulkMinVisits')?.value) || 0,
        source: document.getElementById('bulkSourceFilter')?.value || undefined
    };
    const template = document.getElementById('bulkTemplate')?.value;
    if (!template.trim()) { showNotification('Введіть шаблон повідомлення', 'error'); return; }
    try {
        const res = await fetch(customerApiUrl('/api/customers/bulk-message'), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(customerPayload({ filters, template, dryRun: true }))
        });
        const data = await res.json();
        const preview = document.getElementById('bulkPreview');
        preview.style.display = '';
        preview.textContent = `Отримають: ${data.recipientCount || 0} клієнтів`;
    } catch { showNotification('Помилка перегляду', 'error'); }
};

let _sendBulkBusy = false;
window.sendBulk = async function() {
    if (_sendBulkBusy) return;
    if (!await confirmModal('Надіслати повідомлення всім обраним клієнтам?', { type: 'warning', okText: 'Надіслати' })) return;
    if (_sendBulkBusy) return;
    const template = document.getElementById('bulkTemplate')?.value;
    if (!template.trim()) { showNotification('Введіть шаблон повідомлення', 'error'); return; }
    _sendBulkBusy = true;
    const btn = document.querySelector('[onclick="sendBulk()"]');
    if (btn) btn.disabled = true;
    const token = localStorage.getItem('pzp_token');
    const filters = {
        tags: document.getElementById('bulkTagFilter')?.value ? [document.getElementById('bulkTagFilter')?.value] : [],
        minVisits: parseInt(document.getElementById('bulkMinVisits')?.value) || 0,
        source: document.getElementById('bulkSourceFilter')?.value || undefined
    };
    try {
        const res = await fetch(customerApiUrl('/api/customers/bulk-message'), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(customerPayload({ filters, template, dryRun: false }))
        });
        const data = await res.json();
        if (data.success) {
            showNotification(`Надіслано: ${data.sent || 0} повідомлень`);
        } else {
            showNotification(data.error || 'Помилка розсилки', 'error');
        }
    } catch { showNotification('Помилка розсилки', 'error'); }
    finally {
        _sendBulkBusy = false;
        if (btn) btn.disabled = false;
    }
};

// ==========================================
// v30.4: VCARD EXPORT/IMPORT
// ==========================================

function exportVcf() {
    const token = localStorage.getItem('pzp_token');
    fetch(customerApiUrl('/api/customers/export-vcf'), {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => res.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customers_${new Date().toISOString().slice(0, 10)}.vcf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showNotification('vCard завантажено');
    }).catch(() => showNotification('Помилка експорту vCard', 'error'));
}

async function importVcf(file) {
    const token = localStorage.getItem('pzp_token');
    const formData = new FormData();
    formData.append('vcf', file);
    try {
        const res = await fetch(customerApiUrl('/api/customers/import-vcf'), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            showNotification(`Імпортовано: ${data.imported || 0}, оновлено: ${data.updated || 0}`);
            await refreshData();
        } else {
            showNotification(data.error || 'Помилка імпорту', 'error');
        }
    } catch { showNotification('Помилка імпорту vCard', 'error'); }
}

// ==========================================
// TAB SWITCHING
// ==========================================

function switchTab(tab) {
    CrmState.activeTab = tab;
    document.querySelectorAll('.crm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const tabs = ['tabList', 'tabRfm', 'tabDuplicates', 'tabNps', 'tabBulk'];
    const map = { list: 'tabList', rfm: 'tabRfm', duplicates: 'tabDuplicates', nps: 'tabNps', bulk: 'tabBulk' };
    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === map[tab] ? '' : 'none';
    });

    if (tab === 'rfm' && !CrmState.rfmData) {
        fetchRFM().then(renderRFM).catch(function(err) { console.warn('RFM load failed', err); });
    }
    if (tab === 'duplicates') loadDuplicates();
    if (tab === 'nps') loadNps();
    if (tab === 'bulk') loadBulkTab();
}

// ==========================================
// REFRESH
// ==========================================

async function refreshData() {
    await Promise.all([fetchCustomers(), fetchStats()]);
    renderStats();
    renderCustomerTable();
    renderPagination();
    if (CrmState.activeTab === 'rfm') {
        await fetchRFM();
        renderRFM();
    }
}

// ==========================================
// EXPORT
// ==========================================

function downloadCSV() {
    const token = localStorage.getItem('pzp_token');
    // Use a hidden link to trigger download with auth
    fetch(customerApiUrl('/api/customers/export'), {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => res.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showNotification('CSV завантажено');
    }).catch(() => showNotification('Помилка експорту', 'error'));
}

// ==========================================
// INIT
// ==========================================

let searchTimeout = null;

async function initPage() {
    initDarkMode();

    const token = localStorage.getItem('pzp_token');
    if (!token) {
        window.location.href = '/';
        return;
    }

    const user = await apiVerifyToken();
    if (!user) {
        window.location.href = '/';
        return;
    }

    AppState.currentUser = user;
    const _userEl = document.getElementById('currentUser'); if (_userEl) _userEl.textContent = user.name;
    initCustomerBusinessContext(user);
    const initialTab = applyInitialCustomerQueryParams();

    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    const canManage = MANAGE_ROLES.includes(user.role);
    document.getElementById('addCustomerBtn').style.display = canManage ? '' : 'none';
    document.getElementById('exportCsvBtn').style.display = canManage ? '' : 'none';
    document.getElementById('exportVcfBtn').style.display = canManage ? '' : 'none';
    document.getElementById('importVcfBtn').style.display = canManage ? '' : 'none';

    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();

    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    // Tabs
    document.querySelectorAll('.crm-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Filters with debounce
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            CrmState.filters.search = e.target.value;
            CrmState.page = 1;
            await fetchCustomers();
            renderCustomerTable();
            renderPagination();
        }, 300);
    });

    document.getElementById('sourceFilter')?.addEventListener('change', async (e) => {
        CrmState.filters.source = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

    document.getElementById('sortFilter')?.addEventListener('change', async (e) => {
        CrmState.filters.sortBy = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

    document.getElementById('dateFromFilter')?.addEventListener('change', async (e) => {
        CrmState.filters.dateFrom = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

    document.getElementById('dateToFilter')?.addEventListener('change', async (e) => {
        CrmState.filters.dateTo = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

    // Add customer
    document.getElementById('addCustomerBtn')?.addEventListener('click', () => openEditModal(null));

    // Export
    document.getElementById('exportCsvBtn')?.addEventListener('click', downloadCSV);

    // vCard
    document.getElementById('exportVcfBtn')?.addEventListener('click', exportVcf);
    document.getElementById('importVcfBtn')?.addEventListener('click', () => document.getElementById('vcfFileInput')?.click());
    document.getElementById('vcfFileInput')?.addEventListener('change', (e) => {
        if (e.target.files[0]) { importVcf(e.target.files[0]); e.target.value = ''; }
    });

    // Tag filter
    document.getElementById('tagFilter')?.addEventListener('change', async (e) => {
        CrmState.filters.tag = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });
    document.addEventListener('click', async (e) => {
        const clear = e.target.closest('[data-explain-clear="customers"]');
        if (!clear) return;
        e.preventDefault();
        await resetCustomerFilters();
    });

    // Save customer
    bindCustomerIdentityTools();
    document.getElementById('saveCustomerBtn')?.addEventListener('click', handleSave);
    document.getElementById('cancelEditBtn')?.addEventListener('click', () => closeEditModal(false));

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal?.id === 'customerEditModal') closeEditModal(false);
            else if (modal?.id === 'customerDetailModal') closeCustomerDetailModal();
            else modal?.classList.add('hidden');
        });
    });

    document.querySelectorAll('.modal').forEach(modal => {
        if (modal.id === 'customerEditModal' || modal.id === 'customerDetailModal') return;
        bindEntityModalSafeClose(modal, () => modal.classList.add('hidden'));
    });
    bindEntityModalSafeClose(document.getElementById('customerDetailModal'), closeCustomerDetailModal);
    bindEntityModalSafeClose(document.getElementById('customerEditModal'), () => closeEditModal(false));
    bindCustomerEntityEscapeClose();

    // Load initial data
    await refreshData();
    if (initialTab && initialTab !== 'list') switchTab(initialTab);
    openCustomerDeepLink();
}

document.addEventListener('DOMContentLoaded', initPage);
