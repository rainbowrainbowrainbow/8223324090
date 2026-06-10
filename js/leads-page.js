/**
 * leads-page.js — Sales Funnel page (v29.1.0)
 * Lead types, pipeline stages, kanban, customer cards, mailing list
 */

const STATUS_MAP = {
    new: { label: 'Новий', emoji: '🔵', cls: 'new' },
    contact: { label: 'Контакт', emoji: '🟡', cls: 'contact' },
    proposal: { label: 'Пропозиція', emoji: '🟠', cls: 'proposal' },
    booked: { label: 'Заброньовано', emoji: '🟢', cls: 'booked' },
    completed: { label: 'Відбулось', emoji: '✅', cls: 'completed' },
    lost: { label: 'Втрачено', emoji: '❌', cls: 'lost' }
};

const LEAD_TYPE_MAP = {
    quality:       { label: 'Якісний', emoji: '🟢', cls: 'type-quality' },
    spam:          { label: 'Спам', emoji: '🔴', cls: 'type-spam' },
    collaboration: { label: 'Співпраця', emoji: '🤝', cls: 'type-collab' },
    informational: { label: 'Інформаційний', emoji: '📩', cls: 'type-info' },
    low_quality:   { label: 'Неякісний', emoji: '⬇️', cls: 'type-low' }
};

const QUALITY_CATEGORIES = {
    birthday:   'День народження',
    graduation: 'Випускний',
    trip:       'Виїзд',
    corporate:  'Корпоратив'
};

const PIPELINE_STAGES = [
    {
        key: 'new',
        label: 'Новий лід',
        emoji: '🔵',
        color: '#3B82F6',
        hint: 'Сюди падають нові заявки з форми, дзвінка, чату або ручного створення. Менеджер ще не почав опрацювання.'
    },
    {
        key: 'contacted',
        label: 'Контакт',
        emoji: '📞',
        color: '#8B5CF6',
        hint: 'Етап виявлення потреби: контакт встановлено, менеджер уточнює запит, дату, формат, бюджет і очікування клієнта.'
    },
    {
        key: 'info_sent',
        label: 'Надання інфо',
        emoji: '📋',
        color: '#F59E0B',
        hint: 'Клієнту вже надіслали програму, умови, ціни або підбірку варіантів. Тепер чекаємо реакцію чи уточнення.'
    },
    {
        key: 'deal',
        label: 'Угода',
        emoji: '🤝',
        color: '#F97316',
        hint: 'Тут узгоджуються фінальні умови: дата, пакет, склад послуги, допи, знижка, сума і наступний крок до бронювання.'
    },
    {
        key: 'deposit_received',
        label: 'Завдаток',
        emoji: '💰',
        color: '#10B981',
        hint: 'Передоплата або фінальне підтвердження отримані. Лід має бути звʼязаний із бронюванням і готовий до підготовки.'
    },
    {
        key: 'waiting',
        label: 'В очікуванні',
        emoji: '⏳',
        color: '#06B6D4',
        hint: 'Пауза за клієнтом: чекаємо відповідь, рішення, оплату або уточнення. Має бути зрозумілий follow-up.'
    },
    {
        key: 'completed',
        label: 'Проведено',
        emoji: '✅',
        color: '#22C55E',
        hint: 'Послугу або подію виконано. Тут лишаються ліди, які вже доведені до результату і потребують фінального закриття.'
    },
    {
        key: 'closed',
        label: 'Закрито',
        emoji: '💚',
        color: '#059669',
        hint: 'Кейс завершено: фінальні нотатки, клієнт, бронювання, оплати та результат зафіксовані.'
    },
    {
        key: 'lost',
        label: 'Провалено',
        emoji: '❌',
        color: '#EF4444',
        hint: 'Втрачений лід: клієнт відмовився, обрав інше, не відповідає або причина втрати вже зафіксована.'
    }
];

const WIP_LIMIT = 10;

const LOSS_REASONS = [
    'Вибрали конкурента',
    'Дорого',
    'Не відповідає',
    'Не підходить дата',
    'Інше'
];

const SOURCE_MAP = {
    telegram:       '🔵 Telegram',
    facebook:       '🔷 Facebook',
    instagram:      '🟣 Instagram',
    viber:          '🟢 Viber',
    tiktok:         '⚫ TikTok',
    turbo:          '🟠 Turbo',
    bnderoga:       '🟡 BnD',
    google:         '🔍 Google',
    recommendation: '🤝 Рекомендація',
    site:           '🌐 Сайт',
    maysternya_site:'🌐 Сайт Майстерні',
    phone:          '📞 Телефон',
    'walk-in':      '🚶 Прийшли',
    manual:         '✏️ Ручний',
    landing:        '📄 Лендінг',
    universal:      '🌐 Universal'
};

let currentView = 'table'; // table | kanban | mailing
let currentFilter = '';
let currentTypeFilter = '';
let currentDateFilter = '';
let currentPipelineStage = '';
let currentBusinessContext = 'event_genix';
let leadsData = [];
let pipelineData = {};
let usersData = [];
let modalInitialState = '';
let customerCardInitialState = '';
const leadSecondaryInitialState = new Map();
const LEAD_SECONDARY_MODAL_FIELDS = {
    lostReasonModal: ['lostReasonSelect', 'lostReasonNotes'],
    addMailingModal: ['mailingName', 'mailingPhone', 'mailingEmail', 'mailingChannel', 'mailingNotes']
};
let leadModalLastTouchAt = 0;
let leadSaveInFlight = false;
let workspaceLeadId = null;
let workspaceRequestSeq = 0;
let workspaceEventsBound = false;
let currentWorkspaceData = null;
let leadCustomerLinkState = {
    leadId: null,
    customers: [],
    searchTimer: null
};
const MAYSTERNYA_LEAD_TASK_PRESETS = {
    callback: {
        title: lead => `Передзвонити: ${lead.clientName || lead.client_name || 'клієнт Майстерні'}`,
        description: leadId => `Follow-up Майстерні з заявки #${leadId}: передзвонити клієнту.`,
        label: 'Передзвонити',
        priority: 'high',
        icon: '📞',
        offsetDays: 1,
        hour: 10
    },
    write: {
        title: lead => `Написати клієнту: ${lead.clientName || lead.client_name || 'клієнт Майстерні'}`,
        description: leadId => `Follow-up Майстерні з заявки #${leadId}: написати клієнту в доступний канал.`,
        label: 'Написати',
        priority: 'high',
        icon: '💬',
        offsetDays: 0,
        hour: 16
    },
    payment: {
        title: lead => `Нагадати оплату: ${lead.clientName || lead.client_name || 'клієнт Майстерні'}`,
        description: leadId => `Follow-up Майстерні з заявки #${leadId}: нагадати про оплату або підтвердження запису.`,
        label: 'Оплата',
        priority: 'normal',
        icon: '₴',
        offsetDays: 1,
        hour: 11
    },
    post_session: {
        title: lead => `Follow-up після сесії: ${lead.clientName || lead.client_name || 'клієнт Майстерні'}`,
        description: leadId => `Follow-up Майстерні з заявки #${leadId}: написати після консультації, зафіксувати результат і наступний крок.`,
        label: 'Після сесії',
        priority: 'normal',
        icon: '✓',
        offsetDays: 2,
        hour: 12
    }
};

// Auth helpers
function getToken() { return localStorage.getItem('pzp_token'); }
function getHeaders(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    const t = getToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
}

function leadBusinessContext() {
    return window.CrmBusinessContext?.normalize?.(currentBusinessContext) || currentBusinessContext || 'event_genix';
}

function leadApiUrl(url) {
    if (!/^\/api\/(leads|customers)\b/.test(String(url))) return url;
    return window.CrmBusinessContext?.apiUrl
        ? window.CrmBusinessContext.apiUrl(url, leadBusinessContext())
        : url;
}

function leadPayload(payload = {}) {
    return window.CrmBusinessContext?.payload
        ? window.CrmBusinessContext.payload(payload, leadBusinessContext())
        : { ...(payload || {}), businessContext: leadBusinessContext() };
}

function leadContextFromRecord(record = {}) {
    return window.CrmBusinessContext?.normalize?.(
        record.businessContext
        || record.business_context
        || record.inbound?.businessContext
        || currentBusinessContext
    ) || currentBusinessContext || 'event_genix';
}

function leadRecordText(record = {}, keys = []) {
    for (const key of keys) {
        const value = record?.[key];
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function leadTimelineRouteForContext(context = leadBusinessContext()) {
    const normalized = window.CrmBusinessContext?.normalize?.(context) || context || 'event_genix';
    if (normalized === 'maysternya_doli') return '/maysternya-doli';
    return '/';
}

function leadTimelineHref(params = {}, context = leadBusinessContext()) {
    const normalized = window.CrmBusinessContext?.normalize?.(context) || context || 'event_genix';
    const url = new URL(leadTimelineRouteForContext(normalized), window.location.origin);
    if (normalized && normalized !== 'event_genix') url.searchParams.set('businessContext', normalized);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
    });
    return `${url.pathname}${url.search}${url.hash}`;
}

function leadBusinessScope() {
    return window.CrmBusinessContext?.scope?.() || { mode: 'single', activeContext: leadBusinessContext() };
}

function isMaysternyaLeadContext() {
    const scope = leadBusinessScope();
    return scope.mode === 'single' && leadBusinessContext() === 'maysternya_doli';
}

function leadConversionActionLabel() {
    return isMaysternyaLeadContext() ? 'Створити запис' : 'Конвертувати';
}

function syncLeadPresentationUi() {
    const maysternyaMode = isMaysternyaLeadContext();
    if (document.body) document.body.dataset.leadBusinessContext = leadBusinessContext();
    const addBtn = document.getElementById('addLeadBtn');
    if (addBtn) addBtn.textContent = maysternyaMode ? '+ Нова заявка' : '+ Новий лід';
    const search = document.getElementById('leadsSearch');
    if (search) search.placeholder = maysternyaMode ? 'Пошук за клієнтом, телефоном, запитом...' : "Пошук за ім'ям, телефоном...";
    const bookedFilter = document.querySelector('#filterBtns .filter-btn[data-status="booked"]');
    if (bookedFilter) bookedFilter.textContent = maysternyaMode ? 'Записано' : 'Заброньовано';
    const headers = document.querySelectorAll('#tableView .leads-table thead th');
    const labels = maysternyaMode
        ? ['Клієнт', 'Контакт', 'Джерело', 'Запит', 'Етап', 'Дата', 'Дії']
        : ["Ім'я", 'Телефон', 'Джерело', 'Тип', 'Етап', 'Дата', 'Дії'];
    headers.forEach((header, index) => {
        if (labels[index]) header.textContent = labels[index];
    });
    syncLeadModalBusinessFields();
}

function syncLeadModalBusinessFields() {
    const maysternyaMode = isMaysternyaLeadContext();
    const childrenGroup = document.getElementById('leadChildrenCount')?.closest('.form-group');
    const celebrantsGroup = document.getElementById('leadCelebrants')?.closest('.form-group');
    if (childrenGroup) childrenGroup.hidden = maysternyaMode;
    if (celebrantsGroup) celebrantsGroup.hidden = maysternyaMode;
    const dateLabel = document.querySelector('label[for="leadEventDate"], #leadEventDate')?.closest('.form-group')?.querySelector('label');
    if (dateLabel) dateLabel.textContent = maysternyaMode ? 'Бажана дата консультації' : 'Бажана дата';
    const notesLabel = document.getElementById('leadNotes')?.closest('.form-group')?.querySelector('label');
    if (notesLabel) notesLabel.textContent = maysternyaMode ? 'Запит / повідомлення' : 'Нотатки';
    if (maysternyaMode) {
        const children = document.getElementById('leadChildrenCount');
        const celebrants = document.getElementById('leadCelebrants');
        if (children) children.value = '';
        if (celebrants) celebrants.value = '';
    }
}

function isLeadBusinessReadOnly() {
    return Boolean(window.CrmBusinessContext?.isReadOnly?.(leadBusinessScope()));
}

function leadReadOnlyMessage(actionLabel = 'змінювати ліди') {
    return window.CrmBusinessContext?.readOnlyMessage?.(leadBusinessScope(), actionLabel)
        || 'Огляд кількох бізнесів працює тільки для перегляду. Оберіть один бізнес, щоб змінювати ліди.';
}

function guardLeadWrite(actionLabel = 'змінювати ліди') {
    return window.CrmBusinessContext?.guardWrite
        ? window.CrmBusinessContext.guardWrite(actionLabel, leadBusinessScope())
        : !isLeadBusinessReadOnly();
}

function syncLeadReadOnlyUi() {
    const readOnly = isLeadBusinessReadOnly();
    if (document.body) document.body.dataset.crmBusinessReadOnly = readOnly ? 'true' : 'false';
    let notice = document.getElementById('leadBusinessReadOnlyNotice');
    if (readOnly && !notice) {
        notice = document.createElement('div');
        notice.id = 'leadBusinessReadOnlyNotice';
        notice.className = 'crm-business-readonly-banner';
        notice.setAttribute('role', 'status');
        document.querySelector('.leads-toolbar')?.insertAdjacentElement('afterend', notice);
    }
    if (notice) {
        notice.textContent = leadReadOnlyMessage('редагувати ліди');
        notice.hidden = !readOnly;
    }
    ['addLeadBtn', 'leadModalSave', 'mailingModalSave'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = readOnly;
        el.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
        if (readOnly) el.title = leadReadOnlyMessage('редагувати ліди');
        else el.removeAttribute('title');
    });
    document.querySelectorAll([
        '[data-lead-write-action="true"]',
        '.lead-actions .btn-edit',
        '.lead-actions .btn-type',
        '.lead-actions .btn-delete',
        '.lead-actions .btn-convert',
        '.kanban-card-actions button',
        '[data-lead-type-select]',
        '.btn-add-mailing',
        '#addMailingModal .btn-save'
    ].join(',')).forEach(el => {
        el.disabled = readOnly;
        el.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
        el.classList.toggle('crm-business-readonly-control', readOnly);
        if (readOnly) el.title = leadReadOnlyMessage('редагувати ліди');
        else el.removeAttribute('title');
    });
    document.querySelectorAll('.kanban-card[draggable]').forEach(card => {
        card.draggable = !readOnly;
        card.classList.toggle('crm-business-readonly-control', readOnly);
        if (readOnly) card.title = leadReadOnlyMessage('перетягувати ліди між етапами');
        else card.removeAttribute('title');
    });
}

function initLeadBusinessContext(user) {
    const api = window.CrmBusinessContext;
    currentBusinessContext = api?.initPage?.({
        pageId: 'leads',
        user,
        beforeChange: async () => closeLeadWorkspace({ pushState: false, guard: true }),
        onChange: async ({ current }) => {
            currentBusinessContext = current;
            workspaceLeadId = null;
            closeLeadWorkspace({ pushState: false, force: true, guard: false });
            syncLeadPresentationUi();
            syncLeadReadOnlyUi();
            await loadLeads();
        }
    }) || 'event_genix';
    syncLeadPresentationUi();
    syncLeadReadOnlyUi();
}

async function apiFetch(url, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !guardLeadWrite('змінювати ліди')) {
        throw new Error(leadReadOnlyMessage('змінювати ліди'));
    }
    opts.headers = { ...getHeaders(!!opts.body), ...opts.headers };
    const res = await fetch(leadApiUrl(url), opts);
    if (res.status === 403) {
        const payload = await res.clone().json().catch(() => ({}));
        if (payload.code === 'business_scope_read_only') {
            const message = payload.error || leadReadOnlyMessage('змінювати ліди');
            if (typeof showNotification === 'function') showNotification(message, 'warning');
            throw new Error(message);
        }
    }
    if (res.status === 401 || res.status === 403) {
        window.location.href = '/';
        throw new Error('Unauthorized');
    }
    return res;
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
    if (!getToken()) { window.location.href = '/'; return; }

    const saved = localStorage.getItem('pzp_dark_mode');
    if (saved !== 'false') {
        document.body.classList.add('dark-mode');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
    }

    // Check TEST_MODE badge
    checkTestMode();

    try {
        const savedUser = localStorage.getItem('pzp_current_user');
        if (savedUser && typeof AppState !== 'undefined') AppState.currentUser = JSON.parse(savedUser);
    } catch {}
    initLeadBusinessContext(typeof AppState !== 'undefined' ? AppState.currentUser : null);

    setupEvents();
    applyLeadQueryParams();
    await loadUsers();
    await loadLeads();
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
    openWorkspaceFromUrl();
});

async function checkTestMode() {
    try {
        const res = await apiFetch('/api/version');
        if (res.ok) {
        if (!res) return;
            const data = await res.json();
            if (data.testMode) {
                const badge = document.getElementById('testModeBadge');
                if (badge) badge.style.display = 'inline-flex';
            }
        }
    } catch(e) { /* */ }
}

async function loadUsers() {
    try {
        const res = await apiFetch('/api/leads/assignees');
        if (res.ok) {
        if (!res) return;
            const data = await res.json();
            usersData = Array.isArray(data) ? data : (data.users || []);
        }
    } catch (e) { console.warn('Failed to load users', e); }

    const sel = document.getElementById('leadAssignedTo');
    if (!sel) return;
    sel.innerHTML = '<option value="">— не призначено —</option>';
    for (const u of usersData) {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.name || u.username;
        sel.appendChild(opt);
    }
}

async function loadLeads() {
    const tbody = document.getElementById('leadsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Завантаження...</td></tr>';
    syncLeadPresentationUi();
    try {
        const params = new URLSearchParams();
        if (currentFilter) params.set('status', currentFilter);
        if (currentTypeFilter) params.set('lead_type', currentTypeFilter);
        if (currentDateFilter) params.set('event_date', currentDateFilter);
        if (currentPipelineStage) params.set('pipeline_stage', currentPipelineStage);
        const search = document.getElementById('leadsSearch')?.value?.trim();
        if (search) params.set('search', search);
        params.set('limit', '200');

        const res = await apiFetch(`/api/leads?${params}`);
        if (!res) return;
        const data = await res.json();
        leadsData = data.leads || [];

        renderStats();
        if (currentView === 'kanban') {
            renderKanban();
        } else if (currentView === 'mailing') {
            loadMailing();
        } else {
            renderTable();
        }
        syncWorkspaceHighlight();
    } catch (err) {
        console.error('Load leads error', err);
        const tbody = document.getElementById('leadsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Помилка завантаження</td></tr>';
    }
}

function renderStats() {
    const container = document.getElementById('leadsStats');
    if (!container) return;

    // Count by type
    const typeCounts = { quality: 0, spam: 0, collaboration: 0, informational: 0, low_quality: 0 };
    for (const l of leadsData) {
        const t = l.lead_type || 'quality';
        if (typeCounts[t] !== undefined) typeCounts[t]++;
    }
    const total = leadsData.length;

    container.innerHTML = `
        <div class="leads-stat type-quality" onclick="filterByType('quality')"><div class="stat-val">${typeCounts.quality}</div><div class="stat-lbl">Якісні</div></div>
        <div class="leads-stat type-spam" onclick="filterByType('spam')"><div class="stat-val">${typeCounts.spam}</div><div class="stat-lbl">Спам</div></div>
        <div class="leads-stat type-collab" onclick="filterByType('collaboration')"><div class="stat-val">${typeCounts.collaboration}</div><div class="stat-lbl">Співпраця</div></div>
        <div class="leads-stat type-info" onclick="filterByType('informational')"><div class="stat-val">${typeCounts.informational}</div><div class="stat-lbl">Інформаційні</div></div>
        <div class="leads-stat type-low" onclick="filterByType('low_quality')"><div class="stat-val">${typeCounts.low_quality}</div><div class="stat-lbl">Неякісні</div></div>
        <div class="leads-stat total"><div class="stat-val">${total}</div><div class="stat-lbl">Всього</div></div>
    `;
}

function filterByType(type) {
    currentTypeFilter = currentTypeFilter === type ? '' : type;
    loadLeads();
}

function getIdleColor(lead) {
    const hoursIdle = lead.hours_idle || ((Date.now() - new Date(lead.last_contact_at || lead.created_at).getTime()) / 3600000);
    if (hoursIdle < 24) return 'idle-green';
    if (hoursIdle < 48) return 'idle-yellow';
    return 'idle-red';
}

function ensureKanbanSummarySlot(kanbanWrap) {
    let layoutEl = document.getElementById('leadsKanbanLayout');
    if (!layoutEl && kanbanWrap && kanbanWrap.parentNode) {
        layoutEl = document.createElement('div');
        layoutEl.id = 'leadsKanbanLayout';
        layoutEl.className = 'leads-kanban-layout';
        kanbanWrap.parentNode.insertBefore(layoutEl, kanbanWrap);
        layoutEl.appendChild(kanbanWrap);
    }

    let slotEl = document.getElementById('kanbanSummarySlot');
    if (!slotEl && layoutEl) {
        slotEl = document.createElement('div');
        slotEl.id = 'kanbanSummarySlot';
        slotEl.className = 'kanban-summary-slot';
        slotEl.style.display = 'none';
        layoutEl.appendChild(slotEl);
    }

    let funnelEl = document.getElementById('kanbanFunnel');
    if (!funnelEl && slotEl) {
        funnelEl = document.createElement('div');
        funnelEl.id = 'kanbanFunnel';
        slotEl.appendChild(funnelEl);
    } else if (funnelEl && slotEl && funnelEl.parentNode !== slotEl) {
        slotEl.appendChild(funnelEl);
    }

    return { layoutEl, slotEl, funnelEl };
}

function getKanbanFunnelElements() {
    return ensureKanbanSummarySlot(document.getElementById('kanbanView'));
}

function hideFunnelBar() {
    const { funnelEl, slotEl } = getKanbanFunnelElements();
    if (funnelEl) {
        funnelEl.innerHTML = '';
        funnelEl.style.display = 'none';
    }
    if (slotEl) slotEl.style.display = 'none';
}

function todayKyiv(offsetDays = 0) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
}

function leadDateFilterLabel(value) {
    if (!value) return '';
    if (value === todayKyiv(0)) return 'Сьогодні';
    if (value === todayKyiv(1)) return 'Завтра';
    return value;
}

function leadPipelineStageLabel(value) {
    return PIPELINE_STAGES.find(stage => stage.key === value)?.label || value;
}

function applyLeadQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get('view');
    if (['table', 'kanban', 'mailing'].includes(requestedView)) currentView = requestedView;
    const requestedStage = params.get('pipeline_stage') || params.get('stage') || '';
    currentPipelineStage = PIPELINE_STAGES.some(stage => stage.key === requestedStage) ? requestedStage : '';
    currentFilter = params.get('status') || currentFilter;
    currentTypeFilter = params.get('lead_type') || currentTypeFilter;
    currentDateFilter = params.get('event_date') || currentDateFilter;
    const search = document.getElementById('leadsSearch');
    if (search && params.get('search')) search.value = params.get('search');

    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === currentView);
    });
    document.querySelectorAll('#filterBtns .filter-btn').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.status || '') === currentFilter);
    });
    document.querySelectorAll('#dateBtns .filter-btn').forEach(btn => {
        const dateKey = btn.dataset.date;
        const expected = dateKey === 'tomorrow' ? todayKyiv(1) : todayKyiv(0);
        btn.classList.toggle('active', currentDateFilter === expected);
    });
}

function getLeadFilterSummary() {
    const search = document.getElementById('leadsSearch')?.value?.trim();
    const maysternyaMode = isMaysternyaLeadContext();
    return [
        currentPipelineStage ? { label: 'Етап воронки', value: leadPipelineStageLabel(currentPipelineStage) } : null,
        currentFilter ? { label: 'Статус', value: STATUS_MAP[currentFilter]?.label || currentFilter } : null,
        currentTypeFilter ? { label: maysternyaMode ? 'Запит' : 'Тип', value: LEAD_TYPE_MAP[currentTypeFilter]?.label || currentTypeFilter } : null,
        currentDateFilter ? { label: maysternyaMode ? 'Дата консультації' : 'Дата події', value: leadDateFilterLabel(currentDateFilter) } : null,
        search ? { label: 'Пошук', value: search } : null
    ].filter(Boolean);
}

function renderLeadExplainability() {
    if (!window.Explainability) return;
    const filters = getLeadFilterSummary();
    const html = Explainability.renderFilterSummary(filters, {
        label: 'Фільтри лідів',
        clearAction: filters.length ? 'leads' : '',
        clearLabel: 'Показати всі ліди'
    });
    Explainability.setRegion('leadsExplainability', html);
}

function resetLeadFilters() {
    currentFilter = '';
    currentTypeFilter = '';
    currentDateFilter = '';
    currentPipelineStage = '';
    const search = document.getElementById('leadsSearch');
    if (search) search.value = '';
    document.querySelectorAll('#filterBtns .filter-btn').forEach(btn => btn.classList.toggle('active', !btn.dataset.status));
    document.querySelectorAll('#dateBtns .filter-btn').forEach(btn => btn.classList.remove('active'));
    loadLeads();
}

function leadEmptyHtml() {
    const filters = getLeadFilterSummary();
    const maysternyaMode = isMaysternyaLeadContext();
    if (window.Explainability) {
        return Explainability.renderEmptyState({
            icon: '🔎',
            title: filters.length
                ? (maysternyaMode ? 'Заявок за цими фільтрами немає' : 'Лідів за цими фільтрами немає')
                : (maysternyaMode ? 'Заявок ще немає' : 'Лідів ще немає'),
            message: filters.length
                ? 'Поточний статус, тип, дата або пошук приховали всі записи. Скиньте фільтри, щоб повернути повний список.'
                : (maysternyaMode
                    ? 'Коли сайт або менеджер додасть заявку Майстерні, вона буде у цьому списку.'
                    : 'Коли зʼявляться заявки або менеджер додасть лід вручну, вони будуть у цьому списку.'),
            clearAction: filters.length ? 'leads' : '',
            clearLabel: maysternyaMode ? 'Показати всі заявки' : 'Показати всі ліди'
        });
    }
    return filters.length
        ? (maysternyaMode ? 'Немає заявок за поточними фільтрами' : 'Немає лідів за поточними фільтрами')
        : (maysternyaMode ? 'Немає заявок' : 'Немає лідів');
}

function renderTable() {
    const tbody = document.getElementById('leadsTableBody');
    const tableWrap = document.getElementById('tableView');
    const kanbanWrap = document.getElementById('kanbanView');
    const mailingWrap = document.getElementById('mailingView');
    if (tableWrap) tableWrap.style.display = '';
    if (kanbanWrap) kanbanWrap.style.display = 'none';
    if (mailingWrap) mailingWrap.style.display = 'none';
    hideFunnelBar();

    if (!tbody) return;
    const maysternyaMode = isMaysternyaLeadContext();
    renderLeadExplainability();
    if (leadsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">${leadEmptyHtml()}</td></tr>`;
        return;
    }

    tbody.innerHTML = leadsData.map(l => {
        const st = STATUS_MAP[l.status] || { label: l.status, emoji: '❓', cls: '' };
        const lt = LEAD_TYPE_MAP[l.lead_type] || LEAD_TYPE_MAP.quality;
        const src = SOURCE_MAP[l.source] || (l.source || '—');
        const date = l.created_at ? new Date(l.created_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : '—';
        const assigned = l.assigned_name || '—';
        const stage = PIPELINE_STAGES.find(s => s.key === (l.pipeline_stage || 'new'));
        const idleClass = getIdleColor(l);

        const canConvert = ['new', 'contact', 'proposal'].includes(l.status);
        const convertBtn = canConvert ? `<button class="btn-convert" onclick="convertLead(${l.id})">${leadConversionActionLabel()}</button>` : '';

        return `<tr class="${idleClass}" data-lead-id="${l.id}">
            <td><strong>${escapeHtml(l.client_name || '—')}</strong>${l.instagram ? '<br><small style="color:var(--gray-400)">@' + escapeHtml(l.instagram) + '</small>' : ''}</td>
            <td>${escapeHtml(l.phone || '—')}</td>
            <td>${escapeHtml(typeof src === 'string' ? src : '')}</td>
            <td><span class="lead-type-badge ${lt.cls}">${maysternyaMode ? escapeHtml(l.quality_category || l.request_topic || l.topic || lt.label) : `${lt.emoji} ${lt.label}`}</span></td>
            <td><span class="pipeline-stage">${stage ? stage.emoji + ' ' + stage.label : '—'}</span></td>
            <td>${date}</td>
            <td class="lead-actions">
                <button class="btn-workspace" onclick="openLeadWorkspace(${l.id})">${maysternyaMode ? 'Заявка' : 'Кейс'}</button>
                <button class="btn-edit" onclick="editLead(${l.id})">Деталі</button>
                <button class="btn-type" onclick="showTypeMenu(${l.id}, event)">${maysternyaMode ? 'Запит' : 'Тип'}</button>
                ${convertBtn}
                <button class="btn-delete" onclick="deleteLead(${l.id})">✕</button>
            </td>
        </tr>`;
    }).join('');
    syncLeadReadOnlyUi();
}

// ==========================================
// UNIFIED MANAGER WORKSPACE
// ==========================================
function getWorkspaceLeadIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('lead') || params.get('leadId');
    const id = parseInt(raw, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function setWorkspaceUrl(leadId, replace = false) {
    const url = new URL(window.location.href);
    if (leadId) url.searchParams.set('lead', leadId);
    else url.searchParams.delete('lead');
    const state = leadId ? { leadWorkspace: leadId } : {};
    if (replace) window.history.replaceState(state, '', url);
    else window.history.pushState(state, '', url);
}

function bindWorkspaceEvents() {
    if (workspaceEventsBound) return;
    workspaceEventsBound = true;

    document.getElementById('leadWorkspaceClose')?.addEventListener('click', () => closeLeadWorkspace());
    document.getElementById('leadWorkspaceBackdrop')?.addEventListener('click', () => closeLeadWorkspace());
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && workspaceLeadId) closeLeadWorkspace();
    });
    window.addEventListener('popstate', () => {
        const leadId = getWorkspaceLeadIdFromUrl();
        if (leadId) openLeadWorkspace(leadId, { pushState: false });
        else closeLeadWorkspace({ pushState: false });
    });
}

function openWorkspaceFromUrl() {
    const leadId = getWorkspaceLeadIdFromUrl();
    if (leadId) openLeadWorkspace(leadId, { pushState: false });
}

function showWorkspaceShell() {
    const panel = document.getElementById('leadWorkspace');
    const backdrop = document.getElementById('leadWorkspaceBackdrop');
    if (!panel || !backdrop) return;
    panel.hidden = false;
    backdrop.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
        panel.classList.add('active');
        backdrop.classList.add('active');
        document.getElementById('leadWorkspaceClose')?.focus({ preventScroll: true });
    });
}

async function closeLeadWorkspace(options = {}) {
    const { pushState = true, force = false, guard = true } = options;
    if (guard && !force && !(await closeActiveLeadEditableSurfaces(false))) return false;

    const panel = document.getElementById('leadWorkspace');
    const backdrop = document.getElementById('leadWorkspaceBackdrop');
    workspaceLeadId = null;
    if (panel) {
        panel.classList.remove('active');
        panel.setAttribute('aria-hidden', 'true');
        setTimeout(() => { if (!workspaceLeadId) panel.hidden = true; }, 200);
    }
    if (backdrop) {
        backdrop.classList.remove('active');
        setTimeout(() => { if (!workspaceLeadId) backdrop.hidden = true; }, 200);
    }
    if (pushState) setWorkspaceUrl(null);
    syncWorkspaceHighlight();
    return true;
}

async function openLeadWorkspace(leadId, options = {}) {
    const { pushState = true } = options;
    const id = parseInt(leadId, 10);
    if (!Number.isInteger(id) || id <= 0) return;
    if (workspaceLeadId !== id && !(await closeActiveLeadEditableSurfaces(false))) return;

    bindWorkspaceEvents();
    workspaceLeadId = id;
    workspaceRequestSeq += 1;
    const requestSeq = workspaceRequestSeq;

    if (pushState) setWorkspaceUrl(id);
    showWorkspaceShell();
    syncWorkspaceHighlight();
    renderWorkspaceLoading(id);

    try {
        const res = await apiFetch(`/api/leads/${id}/workspace`);
        if (!res) return;
        const data = await res.json();
        if (requestSeq !== workspaceRequestSeq) return;
        if (!res.ok || !data.success) {
            renderWorkspaceError(data.error || 'Не вдалося завантажити кейс');
            return;
        }
        renderLeadWorkspaceContent(data.workspace);
    } catch (err) {
        if (requestSeq === workspaceRequestSeq) renderWorkspaceError(err.message || 'Помилка завантаження кейсу');
    }
}

function syncWorkspaceHighlight() {
    document.querySelectorAll('[data-lead-id], .kanban-card[data-id]').forEach(el => {
        const id = parseInt(el.dataset.leadId || el.dataset.id, 10);
        el.classList.toggle('is-workspace-open', !!workspaceLeadId && id === workspaceLeadId);
    });
}

function renderWorkspaceLoading(id) {
    document.getElementById('leadWorkspaceTitle').textContent = `Лід #${id}`;
    document.getElementById('leadWorkspaceSubtitle').textContent = 'Завантаження робочого простору';
    const body = document.getElementById('leadWorkspaceBody');
    if (body) body.innerHTML = '<div class="workspace-loading">Завантаження кейсу...</div>';
}

function renderWorkspaceError(message) {
    const body = document.getElementById('leadWorkspaceBody');
    if (body) body.innerHTML = `<div class="workspace-error">${escapeHtml(message || 'Помилка завантаження')}</div>`;
}

function workspaceDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function workspaceDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return workspaceDate(value);
    return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function workspaceMoney(value) {
    const num = parseInt(value, 10);
    if (!num) return '0 ₴';
    return num.toLocaleString('uk-UA') + ' ₴';
}

function workspaceText(value, fallback = '—') {
    return escapeHtml(value || fallback);
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

function normalizeLeadCelebrants(lead = {}) {
    const raw = parseJsonArray(lead.celebrants);
    if (raw.length) return raw.filter(Boolean).map(item => ({
        name: item.name || item.childName || item.child_name || '',
        age: item.age ?? item.childAge ?? item.child_age ?? '',
        birthday: item.birthday || item.birthDate || item.birth_date || '',
        notes: item.notes || ''
    }));
    if (lead.childAge || lead.child_age) {
        return [{ name: '', age: lead.childAge || lead.child_age, birthday: '', notes: '' }];
    }
    return [];
}

function formatCelebrantsInput(celebrants = []) {
    return parseJsonArray(celebrants)
        .map(item => [item.name || item.childName || item.child_name || '', item.age || '', item.birthday || ''].filter(Boolean).join(', '))
        .join('\n');
}

function parseCelebrantsInput(value) {
    return String(value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map(line => {
            const parts = line.split(',').map(part => part.trim()).filter(Boolean);
            const ageMatch = line.match(/\b(\d{1,3})\b/);
            const birthday = parts.find(part => /^\d{4}-\d{2}-\d{2}$/.test(part)) || null;
            return {
                name: parts[0] && !/^\d{1,3}$/.test(parts[0]) && !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) ? parts[0] : null,
                age: ageMatch ? parseInt(ageMatch[1], 10) : null,
                birthday,
                source: 'operator'
            };
        });
}

function renderCelebrantsValue(lead = {}) {
    const celebrants = normalizeLeadCelebrants(lead);
    if (!celebrants.length) return workspaceText(lead.childrenCount || lead.children_count);
    return celebrants.map((item, index) => {
        const label = item.name || `#${index + 1}`;
        const details = [item.age ? `${item.age} р.` : '', item.birthday || ''].filter(Boolean).join(', ');
        return escapeHtml(details ? `${label} (${details})` : label);
    }).join('<br>');
}

function workspaceBadge(text, cls = '') {
    if (!text) return '';
    return `<span class="workspace-badge ${cls}">${escapeHtml(text)}</span>`;
}

function workspaceLink(href, label, cls = '') {
    if (!href) return `<span class="workspace-btn ${cls}" aria-disabled="true">${escapeHtml(label)}</span>`;
    return `<a class="workspace-btn ${cls}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function workspaceSafeExternalUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const url = new URL(text);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function workspaceInlineLink(href, label = href) {
    const safeUrl = workspaceSafeExternalUrl(href);
    if (!safeUrl) return workspaceText(label || href);
    return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${workspaceText(label || safeUrl)}</a>`;
}

function workspaceObjectEntries(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value).filter(([, item]) => item !== undefined && item !== null && String(item).trim());
}

function renderLeadInboundSection(lead = {}) {
    const contactChannels = Array.isArray(lead.contactChannels)
        ? lead.contactChannels.map(item => String(item || '').trim()).filter(Boolean)
        : [];
    const utmEntries = workspaceObjectEntries(lead.utm);
    const hasInboundData = Boolean(
        lead.externalId
        || lead.inquiryId
        || lead.page
        || lead.email
        || lead.topic
        || lead.message
        || lead.sessionType
        || contactChannels.length
        || utmEntries.length
    );
    if (!hasInboundData) return '';

    return `
        <section class="workspace-section">
            <h3>Дані заявки</h3>
            <dl class="workspace-kv">
                <dt>Бізнес</dt><dd>${workspaceText(lead.businessContext)}</dd>
                <dt>External ID</dt><dd>${workspaceText(lead.externalId)}</dd>
                <dt>Inquiry ID</dt><dd>${workspaceText(lead.inquiryId)}</dd>
                <dt>Email</dt><dd>${workspaceText(lead.email)}</dd>
                <dt>Тема</dt><dd>${workspaceText(lead.topic)}</dd>
                <dt>Повідомлення</dt><dd>${workspaceText(lead.message)}</dd>
                <dt>Тип сесії</dt><dd>${workspaceText(lead.sessionType)}</dd>
                <dt>Сторінка</dt><dd>${lead.page ? workspaceInlineLink(lead.page) : workspaceText(null)}</dd>
                <dt>Канали</dt><dd>${contactChannels.length ? contactChannels.map(item => workspaceBadge(item)).join(' ') : workspaceText(null)}</dd>
                <dt>UTM</dt><dd>${utmEntries.length ? utmEntries.map(([key, value]) => `${escapeHtml(key)}=${workspaceText(value)}`).join('<br>') : workspaceText(null)}</dd>
            </dl>
        </section>
    `;
}

function workspaceList(items, renderer, emptyText) {
    if (!items || !items.length) return `<div class="workspace-empty">${escapeHtml(emptyText)}</div>`;
    return `<div class="workspace-list">${items.map(renderer).join('')}</div>`;
}

function leadOmniSearch(workspace) {
    const lead = workspace.lead || {};
    const customer = workspace.customer || {};
    return lead.phone || customer.phone || lead.clientName || customer.name || '';
}

function leadCrmContextHref(path, params = {}, context = leadBusinessContext()) {
    const normalized = window.CrmBusinessContext?.normalize?.(context) || context || 'event_genix';
    const url = new URL(path, window.location.origin);
    if (normalized && normalized !== 'event_genix') url.searchParams.set('businessContext', normalized);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
    });
    return `${url.pathname}${url.search}${url.hash}`;
}

function leadOmniHref(workspace, conversation) {
    const context = leadContextFromRecord(workspace?.lead || {});
    if (conversation?.id) return leadCrmContextHref('/omni', { conversation: conversation.id }, context);
    const conversations = workspace.conversations || [];
    const exactConversation = conversations.find(conv => conv && conv.id);
    if (exactConversation) return leadCrmContextHref('/omni', { conversation: exactConversation.id }, context);
    const omniSearch = leadOmniSearch(workspace);
    return omniSearch ? leadCrmContextHref('/omni', { search: omniSearch }, context) : null;
}

function leadContactLinks(lead, workspace) {
    const phone = lead.phone || workspace.customer?.phone || '';
    const tel = phone ? 'tel:' + phone.replace(/[^+\d]/g, '') : null;
    const omni = leadOmniHref(workspace);
    return [
        workspaceLink(tel, 'Подзвонити', 'success'),
        workspaceLink(omni, 'Telegram у CRM', 'primary'),
        workspaceLink(omni, 'Комунікації')
    ].join('');
}

function jsCallAttr(call) {
    return escapeHtml(call);
}

function workspaceAction(action) {
    const cls = ['workspace-action', action.cls || '', action.disabled ? 'disabled' : ''].filter(Boolean).join(' ');
    const title = action.title ? ` title="${escapeHtml(action.title)}"` : '';
    const note = action.note ? `<span class="workspace-action-note">${escapeHtml(action.note)}</span>` : '';
    const label = `<span class="workspace-action-label">${escapeHtml(action.label)}</span>${note}`;
    if (action.href && !action.disabled) {
        const target = action.external ? ' target="_blank" rel="noopener"' : '';
        return `<a class="${cls}" href="${escapeHtml(action.href)}"${target}${title}>${label}</a>`;
    }
    if (action.onClick && !action.disabled) {
        return `<button type="button" class="${cls}" onclick="${jsCallAttr(action.onClick)}"${title}>${label}</button>`;
    }
    return `<span class="${cls}" aria-disabled="true"${title}>${label}</span>`;
}

function exactLeadConversation(workspace) {
    return (workspace.conversations || []).find(conv => conv && conv.id && conv.confidence === 'exact') || null;
}

function waitingReplyConversation(workspace) {
    const conversations = workspace.conversations || [];
    return conversations.find(conv => conv && conv.waitingReply && conv.confidence === 'exact')
        || conversations.find(conv => conv && conv.waitingReply)
        || null;
}

function replySlaText(conversation) {
    if (!conversation?.waitingReply) return '';
    switch (conversation.replySlaState) {
        case 'overdue': return 'SLA прострочено';
        case 'due_soon': return 'SLA скоро спливає';
        case 'on_track': return 'SLA в нормі';
        default: return '';
    }
}

function waitingReplyText(conversation) {
    if (!conversation?.waitingReply || !conversation.awaitingReplySince) return '';
    const sla = replySlaText(conversation);
    return [`Очікуємо відповідь з ${workspaceDateTime(conversation.awaitingReplySince)}`, sla].filter(Boolean).join(' · ');
}

function exactLeadBooking(workspace) {
    const leadBookingId = workspace.lead?.bookingId;
    if (!leadBookingId) return null;
    return (workspace.bookings || []).find(booking => booking && String(booking.id) === String(leadBookingId)) || null;
}

function timelineHrefForBooking(booking, context = leadBusinessContext()) {
    if (!booking?.id || !booking?.date) return null;
    return leadTimelineHref({
        date: String(booking.date).slice(0, 10),
        highlight: booking.id
    }, context);
}

function exactOpenWorkspaceTask(workspace) {
    const leadId = String(workspace.lead?.id || '');
    const exactBooking = exactLeadBooking(workspace);
    const exactBookingId = exactBooking ? String(exactBooking.id) : '';
    return (workspace.tasks || []).find(task => {
        if (!task || ['done', 'archived', 'cancelled'].includes(task.status)) return false;
        if (task.isExactCaseTask) return true;
        if (task.sourceType === 'lead' && String(task.sourceId || '') === leadId) return true;
        return exactBookingId && task.sourceType === 'booking' && String(task.sourceId || '') === exactBookingId;
    }) || null;
}

function renderWorkspaceStageControl(lead) {
    const currentStage = lead.pipelineStage || 'new';
    const options = PIPELINE_STAGES.map(stage =>
        `<option value="${escapeHtml(stage.key)}"${stage.key === currentStage ? ' selected' : ''}>${escapeHtml(`${stage.emoji} ${stage.label}`)}</option>`
    ).join('');
    return `
        <label class="workspace-stage-control">
            <span>Етап</span>
            <select aria-label="Змінити етап ліда" onchange="moveLeadWorkspaceStage(${lead.id}, this.value)">
                ${options}
            </select>
        </label>
    `;
}

function renderManagerActionStrip(workspace) {
    const lead = workspace.lead || {};
    const customer = workspace.customer || null;
    const phone = lead.phone || customer?.phone || '';
    const tel = phone ? 'tel:' + phone.replace(/[^+\d]/g, '') : null;
    const exactConversation = exactLeadConversation(workspace);
    const waitingConversation = waitingReplyConversation(workspace);
    const exactBooking = exactLeadBooking(workspace);
    const exactTask = exactOpenWorkspaceTask(workspace);
    const bookingHref = timelineHrefForBooking(exactBooking, leadContextFromRecord(lead));
    const canConfirmBooking = exactBooking?.status === 'preliminary' && typeof canAccess === 'function' && canAccess('edit_booking');
    const canSeeBookingButNotConfirm = exactBooking?.status === 'preliminary' && !canConfirmBooking;
    const maysternyaMode = isMaysternyaLeadContext();
    const customerHref = customer?.id ? leadCrmContextHref('/customers', { open: customer.id }, leadContextFromRecord(lead)) : null;
    const taskHref = exactTask ? leadCrmContextHref('/tasks', { open: exactTask.id }, leadContextFromRecord(lead)) : null;

    const actions = [
        { label: 'Подзвонити', href: tel, cls: 'success', disabled: !tel, note: tel ? '' : 'немає телефону' },
        maysternyaMode ? {
            label: exactBooking ? 'Відкрити запис' : 'Створити запис',
            href: exactBooking ? bookingHref : null,
            onClick: exactBooking ? null : `convertLead(${lead.id})`,
            cls: 'primary',
            disabled: exactBooking ? !bookingHref : false,
            note: exactBooking ? 'є повʼязаний запис' : 'драфт у Майстерні'
        } : null,
        {
            label: 'Omni exact',
            href: exactConversation ? leadOmniHref(workspace, exactConversation) : null,
            cls: 'primary',
            disabled: !exactConversation,
            note: exactConversation ? '' : 'немає точної розмови'
        },
        {
            label: 'Картка клієнта',
            href: customerHref,
            disabled: !customer?.id,
            note: customer?.id ? '' : 'клієнта не привʼязано'
        },
        {
            label: maysternyaMode ? 'Запис' : 'Бронювання',
            href: bookingHref,
            disabled: !bookingHref,
            note: bookingHref ? '' : 'немає exact booking'
        },
        {
            label: maysternyaMode ? 'Передзвонити' : 'Callback',
            onClick: `createLeadWorkspaceCallbackTask(${lead.id})`,
            cls: 'warning'
        },
        maysternyaMode ? {
            label: 'Написати',
            onClick: `createLeadWorkspaceFollowUpTask(${lead.id}, 'write')`,
            cls: 'warning'
        } : null,
        maysternyaMode ? {
            label: 'Оплата',
            onClick: `createLeadWorkspaceFollowUpTask(${lead.id}, 'payment')`,
            cls: 'warning'
        } : null,
        maysternyaMode ? {
            label: 'Після сесії',
            onClick: `createLeadWorkspaceFollowUpTask(${lead.id}, 'post_session')`,
            cls: 'warning'
        } : null,
        {
            label: 'Відкрити задачу',
            href: taskHref,
            disabled: !exactTask,
            note: exactTask ? '' : 'немає exact задачі'
        },
        {
            label: 'Виконати задачу',
            onClick: exactTask ? `completeLeadWorkspaceTask(${lead.id}, ${exactTask.id})` : null,
            cls: 'success',
            disabled: !exactTask,
            note: exactTask ? '' : 'немає exact задачі'
        },
        {
            label: 'Підтвердити бронювання',
            onClick: canConfirmBooking ? `confirmLeadWorkspaceBooking(${lead.id}, ${JSON.stringify(String(exactBooking.id))})` : null,
            cls: 'success',
            disabled: !canConfirmBooking,
            note: exactBooking?.status === 'preliminary'
                ? (canSeeBookingButNotConfirm ? 'немає права edit_booking' : '')
                : (exactBooking ? 'не preliminary' : 'немає exact booking')
        }
    ].filter(Boolean);

    return `
        <section class="manager-action-strip" aria-label="Швидкі дії менеджера">
            <div class="manager-action-strip-head">
                <div>
                    <h3>Швидкі дії</h3>
                    <p>Тільки дії з точним контекстом або чесною недоступністю.</p>
                </div>
                ${renderWorkspaceStageControl(lead)}
            </div>
            ${waitingConversation ? `<div class="manager-action-strip-note waiting">${escapeHtml(waitingReplyText(waitingConversation))}</div>` : ''}
            <div class="manager-action-grid">
                ${actions.map(workspaceAction).join('')}
            </div>
        </section>
    `;
}

function renderLeadWorkspaceContent(workspace) {
    const lead = workspace.lead || {};
    const customer = workspace.customer;
    const card = workspace.customerCard || {};
    const canonical = workspace.canonical || {};
    const urgency = workspace.urgency || {};
    const maysternyaMode = isMaysternyaLeadContext();
    const stage = PIPELINE_STAGES.find(s => s.key === (canonical.stage || lead.pipelineStage || 'new'));
    const status = STATUS_MAP[canonical.aggregateStatus || lead.status] || {};
    const type = LEAD_TYPE_MAP[lead.leadType] || LEAD_TYPE_MAP.quality;
    const waitingConversation = waitingReplyConversation(workspace);
    const eventDays = urgency.daysUntilEvent;
    const eventCue = eventDays === null || eventDays === undefined
        ? ''
        : eventDays < 0 ? `Подія минула ${Math.abs(eventDays)} дн. тому`
        : eventDays === 0 ? 'Подія сьогодні'
        : eventDays === 1 ? 'Подія завтра'
        : `До події ${eventDays} дн.`;
    const eventCueClass = eventDays !== null && eventDays !== undefined && eventDays <= 1 ? 'urgent' : 'warning';
    document.getElementById('leadWorkspaceTitle').textContent = maysternyaMode
        ? (lead.clientName ? `Заявка: ${lead.clientName}` : `Заявка #${lead.id}`)
        : (lead.clientName || `Лід #${lead.id}`);
    document.getElementById('leadWorkspaceSubtitle').textContent = maysternyaMode
        ? `Майстерня долі · заявка #${lead.id} · запис і follow-up`
        : `Кейс ліда #${lead.id} · canonical: pipeline_stage`;

    const customerHref = customer?.id ? leadCrmContextHref('/customers', { open: customer.id }, leadContextFromRecord(lead)) : null;
    const body = document.getElementById('leadWorkspaceBody');
    if (!body) return;
    currentWorkspaceData = workspace;

    body.innerHTML = `
        <section class="workspace-hero">
            <div class="workspace-hero-main">
                <div>
                    <h3 class="workspace-name">${workspaceText(lead.clientName, maysternyaMode ? `Заявка #${lead.id}` : `Лід #${lead.id}`)}</h3>
                    <div class="workspace-meta">
                        ${workspaceText(lead.phone)}${lead.instagram ? ' · @' + workspaceText(lead.instagram).replace(/^@/, '') : ''}
                    </div>
                    <div class="workspace-badge-row">
                        ${workspaceBadge(stage ? `${stage.emoji} ${stage.label}` : (lead.pipelineStage || 'new'), 'stage')}
                        ${workspaceBadge(status.label ? `${status.emoji || ''} ${status.label}` : lead.status)}
                        ${workspaceBadge(maysternyaMode ? (lead.topic || lead.sessionType || lead.sourceChannel || 'Заявка') : `${type.emoji || ''} ${type.label || lead.leadType || 'Лід'}`)}
                        ${waitingConversation ? workspaceBadge(waitingReplyText(waitingConversation), 'waiting') : ''}
                        ${eventCue ? workspaceBadge(eventCue, eventCueClass) : ''}
                        ${urgency.overdueTasks ? workspaceBadge(`Прострочено задач: ${urgency.overdueTasks}`, 'urgent') : ''}
                    </div>
                </div>
                <div class="workspace-actions">
                    ${leadContactLinks(lead, workspace)}
                    <button type="button" class="workspace-btn" onclick="editLead(${lead.id})">${maysternyaMode ? 'Редагувати заявку' : 'Редагувати'}</button>
                    <button type="button" class="workspace-btn" onclick="showCustomerCardModal(${lead.id})">${maysternyaMode ? 'Картка клієнта' : 'Картка'}</button>
                    <button type="button" class="workspace-btn" onclick="linkWorkspaceLeadCustomer(${lead.id})">${customer?.id ? 'Змінити клієнта' : 'Привʼязати клієнта'}</button>
                </div>
            </div>
        </section>

        ${renderManagerActionStrip(workspace)}

        <div class="workspace-grid">
            <section class="workspace-section">
                <h3>Клієнт</h3>
                ${customer ? `
                    <dl class="workspace-kv">
                        <dt>Ім'я</dt><dd>${workspaceText(customer.name)}</dd>
                        <dt>Телефон</dt><dd>${workspaceText(customer.phone)}</dd>
                        ${maysternyaMode ? '' : `<dt>Дитина</dt><dd>${workspaceText(customer.childName)}</dd>`}
                        <dt>${maysternyaMode ? 'Сесії' : 'Візити'}</dt><dd>${customer.totalBookings || 0} · ${workspaceMoney(customer.totalSpent)}</dd>
                        <dt>${maysternyaMode ? 'Остання сесія' : 'Останній'}</dt><dd>${workspaceDate(customer.lastVisit)}</dd>
                    </dl>
                    <div class="workspace-actions" style="justify-content:flex-start;margin-top:12px">
                        ${workspaceLink(customerHref, 'Відкрити клієнта')}
                    </div>
                ` : `
                    <div class="workspace-empty">Клієнта ще не прив'язано. Дані ліда і картки доступні в цьому кейсі.</div>
                `}
            </section>

            <section class="workspace-section">
                <h3>${maysternyaMode ? 'Запит' : 'Кейс і дата'}</h3>
                <dl class="workspace-kv">
                    <dt>Відповідальний</dt><dd>${workspaceText(lead.assignedName)}</dd>
                    <dt>Джерело</dt><dd>${workspaceText(lead.sourceChannel || lead.source)}</dd>
                    <dt>${maysternyaMode ? 'Бажана дата консультації' : 'Бажана дата'}</dt><dd>${workspaceDate(lead.eventDate || card.event_date)}</dd>
                    <dt>${maysternyaMode ? 'Консультація' : 'Програма'}</dt><dd>${workspaceText(lead.programName || lead.sessionType)}</dd>
                    ${maysternyaMode ? '' : `<dt>Іменинники</dt><dd>${renderCelebrantsValue(lead)}</dd>`}
                    <dt>${maysternyaMode ? 'Повідомлення' : 'Нотатки'}</dt><dd>${workspaceText(maysternyaMode ? (lead.message || lead.notes || card.notes) : (lead.notes || card.notes))}</dd>
                </dl>
            </section>

            ${renderLeadInboundSection(lead)}

            <section class="workspace-section full">
                <h3>${maysternyaMode ? 'Записи та сесії' : 'Бронювання та події'}</h3>
                ${workspaceList(workspace.bookings || [], booking => `
                    <div class="workspace-row">
                        <div class="workspace-row-top">
                            <div>
                                <div class="workspace-row-title">${workspaceText(booking.programName || booking.category || `Бронювання ${booking.id}`)}</div>
                                <div class="workspace-row-meta">${workspaceDate(booking.date)} ${workspaceText(booking.time, '')} · ${workspaceText(booking.status)} · ${workspaceMoney(booking.price)}</div>
                            </div>
                            ${booking.date ? `<a class="workspace-row-link" href="${escapeHtml(timelineHrefForBooking(booking, leadContextFromRecord(lead)))}">Таймлайн</a>` : ''}
                        </div>
                    </div>
                `, maysternyaMode ? 'Повʼязаних записів поки немає' : 'Пов’язаних бронювань поки немає')}
            </section>

            <section class="workspace-section">
                <h3>Наступні дії</h3>
                ${workspaceList(workspace.tasks || [], task => `
                    <div class="workspace-row">
                        <div class="workspace-row-top">
                            <div>
                                <div class="workspace-row-title">${workspaceText(task.title)}</div>
                                <div class="workspace-row-meta">${workspaceText(task.status)} · ${workspaceText(task.priority)}${task.deadline ? ' · дедлайн ' + workspaceDateTime(task.deadline) : ''}</div>
                            </div>
                            <a class="workspace-row-link" href="${escapeHtml(leadCrmContextHref('/tasks', { open: task.id }, leadContextFromRecord(lead)))}">Задача</a>
                        </div>
                    </div>
                `, 'Немає прив’язаних задач або next action')}
            </section>

            <section class="workspace-section">
                <h3>Нотатки і взаємодії</h3>
                ${workspaceList([...(workspace.interactions || []), ...(workspace.communications || [])].slice(0, 8), item => `
                    <div class="workspace-row">
                        <div class="workspace-row-title">${workspaceText(item.summary || item.type || 'Взаємодія')}</div>
                        <div class="workspace-row-meta">${workspaceDateTime(item.created_at)}${item.manager_name || item.created_by_name ? ' · ' + workspaceText(item.manager_name || item.created_by_name) : ''}</div>
                        ${item.details ? `<div class="workspace-row-meta">${workspaceText(item.details)}</div>` : ''}
                    </div>
                `, 'Взаємодій і коментарів ще немає')}
            </section>

            <section class="workspace-section full">
                <h3>Комунікації</h3>
                ${workspaceList(workspace.conversations || [], conv => `
                    <div class="workspace-row">
                        <div class="workspace-row-top">
                            <div>
                                <div class="workspace-row-title">${workspaceText(conv.customerName || conv.customerPhone || conv.channel)}</div>
                                <div class="workspace-row-meta">${workspaceText(conv.channel)} · ${workspaceText(conv.status)} · ${workspaceDateTime(conv.lastMessageAt)}</div>
                                ${conv.waitingReply ? `<div class="workspace-row-meta waiting">${escapeHtml(waitingReplyText(conv))}</div>` : ''}
                                <div class="workspace-row-meta">${workspaceText(conv.lastMessage, 'Останнього повідомлення немає')}</div>
                            </div>
                            <a class="workspace-row-link" href="${escapeHtml(leadOmniHref(workspace, conv))}">Omni</a>
                        </div>
                    </div>
                `, 'Розмови не знайдено. Відкрийте комунікації з контекстним пошуком.')}
                <div class="workspace-actions" style="justify-content:flex-start;margin-top:12px">
                    ${workspaceLink(leadOmniHref(workspace), 'Відкрити комунікації', 'primary')}
                </div>
            </section>
        </div>
    `;
}

// ==========================================
// KANBAN VIEW
// ==========================================
function getDaysOnStage(lead) {
    const ref = lead.stage_changed_at || lead.last_contact_at || lead.created_at;
    if (!ref) return 0;
    return Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
}

function formatDaysLabel(days) {
    if (days === 0) return 'сьогодні';
    if (days === 1) return '1 день';
    if (days < 5) return days + ' дні';
    return days + ' днів';
}

function renderFunnelBar(grouped) {
    // Only count stages that form the funnel (exclude lost/closed)
    const funnelStages = PIPELINE_STAGES.filter(s => s.key !== 'lost' && s.key !== 'closed');
    const counts = funnelStages.map(s => (grouped[s.key] || []).length);
    const maxCount = Math.max(...counts, 1);

    const bars = funnelStages.map((stage, i) => {
        const count = counts[i];
        const pct = Math.max(Math.round((count / maxCount) * 100), 8);
        const nextCount = counts[i + 1];
        const convRate = (i < funnelStages.length - 1 && count > 0)
            ? Math.round((nextCount / count) * 100) + '%'
            : '';

        return `<div class="funnel-step">
            <div class="funnel-bar" style="width:${pct}%;background:${stage.color}">
                <span class="funnel-bar-label">${stage.emoji} ${count}</span>
            </div>
            ${convRate ? `<div class="funnel-arrow">→ ${convRate}</div>` : ''}
        </div>`;
    }).join('');

    return `<div class="funnel-bar-container">${bars}</div>`;
}

function renderPipelineStageHelp(stage = {}) {
    const label = stage.label || 'етап';
    const hint = stage.hint || 'Опис етапу ще не задано.';
    return `<button type="button" class="pipeline-stage-help" aria-label="${escapeHtml(`${label}: ${hint}`)}" data-tooltip="${escapeHtml(hint)}">!</button>`;
}

function renderLeadTypeSelect(lead = {}) {
    const leadId = Number(lead.id || 0);
    const currentType = LEAD_TYPE_MAP[lead.lead_type] ? lead.lead_type : 'quality';
    const current = LEAD_TYPE_MAP[currentType] || LEAD_TYPE_MAP.quality;
    const clientName = lead.client_name || 'лід';
    const options = Object.entries(LEAD_TYPE_MAP).map(([key, meta]) => {
        const selected = key === currentType ? ' selected' : '';
        return `<option value="${escapeHtml(key)}"${selected}>${meta.emoji} ${escapeHtml(meta.label)}</option>`;
    }).join('');
    return `<select class="lead-type-select lead-type-select--kanban ${current.cls}" data-lead-type-select data-lead-id="${leadId}" aria-label="Якість ліда: ${escapeHtml(clientName)}" title="Змінити якість ліда" onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()" onchange="updateLeadTypeFromKanbanSelect(${leadId}, this.value, event)">
        ${options}
    </select>`;
}

function renderKanban() {
    const tableWrap = document.getElementById('tableView');
    const kanbanWrap = document.getElementById('kanbanView');
    const mailingWrap = document.getElementById('mailingView');
    if (tableWrap) tableWrap.style.display = 'none';
    if (kanbanWrap) kanbanWrap.style.display = 'flex';
    if (mailingWrap) mailingWrap.style.display = 'none';

    if (!kanbanWrap) return;
    renderLeadExplainability();
    if (leadsData.length === 0) {
        hideFunnelBar();
        kanbanWrap.innerHTML = leadEmptyHtml();
        return;
    }

    // Group leads by pipeline_stage
    const grouped = {};
    for (const s of PIPELINE_STAGES) grouped[s.key] = [];
    for (const l of leadsData) {
        const stage = l.pipeline_stage || 'new';
        if (!grouped[stage]) grouped[stage] = [];
        grouped[stage].push(l);
    }

    const { funnelEl, slotEl } = ensureKanbanSummarySlot(kanbanWrap);
    if (funnelEl && slotEl) {
        funnelEl.innerHTML = renderFunnelBar(grouped);
        funnelEl.style.display = '';
        slotEl.style.display = '';
    }

    kanbanWrap.innerHTML = PIPELINE_STAGES.map(stage => {
        const leads = grouped[stage.key] || [];
        const isEmpty = leads.length === 0;
        const isOverWip = leads.length > WIP_LIMIT;

        // Sum of budget_approx for the column
        const totalSum = leads.reduce((sum, l) => sum + (l.budget_approx || 0), 0);

        const cards = leads.map(l => {
            const idleClass = getIdleColor(l);
            const days = getDaysOnStage(l);
            const daysClass = days > 7 ? 'days-warn' : days > 3 ? 'days-mid' : '';
            const phone = l.phone || '';
            const phoneLabel = phone || '—';
            const phoneTel = phone.replace(/[^+\d]/g, '');

            return `<div class="kanban-card ${idleClass}" draggable="true" data-id="${l.id}" onclick="openLeadWorkspace(${l.id})">
                <div class="kanban-card-top">
                    <div class="kanban-card-name">${escapeHtml(l.client_name || '—')}</div>
                    <span class="kanban-days ${daysClass}" title="На етапі">${formatDaysLabel(days)}</span>
                </div>
                <div class="kanban-card-meta">
                    <span class="kanban-card-meta-text" title="${escapeHtml(phoneLabel)}">${escapeHtml(phoneLabel)}</span>
                    ${renderLeadTypeSelect(l)}
                </div>
                ${l.event_date ? '<div class="kanban-card-date">📅 ' + new Date(l.event_date).toLocaleDateString('uk-UA') + '</div>' : ''}
                <div class="kanban-card-actions" data-kanban-actions onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()">
                    ${phoneTel ? `<a class="kanban-action-btn" href="tel:${escapeHtml(phoneTel)}" title="Зателефонувати">📞</a>
                    <a class="kanban-action-btn" href="https://t.me/${escapeHtml(phoneTel)}" target="_blank" title="Telegram">💬</a>` : ''}
                    <button class="kanban-action-btn" type="button" onclick="event.stopPropagation(); editLead(${l.id})" title="Редагувати">✎</button>
                </div>
            </div>`;
        }).join('');

        const wipWarning = isOverWip ? `<span class="wip-warning" title="Забагато лідів!">⚠️</span>` : '';

        return `<div class="kanban-column ${isEmpty ? 'kanban-column-empty' : ''} ${isOverWip ? 'kanban-column-wip' : ''}" data-stage="${stage.key}">
            <div class="kanban-column-header" style="border-bottom-color:${stage.color}">
                <div class="kanban-stage-title" style="color:${stage.color}">
                    <span>${stage.emoji} ${escapeHtml(stage.label)}</span>
                    ${renderPipelineStageHelp(stage)}
                </div>
                <span class="kanban-count" style="background:${stage.color};color:#fff">${leads.length}${wipWarning}</span>
            </div>
            ${totalSum > 0 ? `<div class="kanban-column-sum">${totalSum.toLocaleString('uk-UA')} ₴</div>` : ''}
            <div class="kanban-cards" data-stage="${stage.key}">
                ${cards || '<div class="kanban-empty">—</div>'}
            </div>
        </div>`;
    }).join('');

    setupKanbanDragDrop();
    syncLeadReadOnlyUi();
}

function setupKanbanDragDrop() {
    const cards = document.querySelectorAll('.kanban-card[draggable]');
    const columns = document.querySelectorAll('.kanban-cards');

    cards.forEach(card => {
        card.querySelectorAll('a, button, select, [data-kanban-actions], [data-lead-type-select]').forEach(control => {
            control.addEventListener('click', event => event.stopPropagation());
            control.addEventListener('pointerdown', event => event.stopPropagation());
        });
    });

    cards.forEach(card => {
        card.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', card.dataset.id);
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    columns.forEach(col => {
        col.addEventListener('dragover', e => {
            e.preventDefault();
            col.classList.add('drag-over');
        });
        col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
        col.addEventListener('drop', async e => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const leadId = e.dataTransfer.getData('text/plain');
            const newStage = col.dataset.stage;
            if (!leadId || !newStage) return;

            // If moving to 'lost', ask for reason
            if (newStage === 'lost') {
                showLostReasonModal(parseInt(leadId), newStage);
                return;
            }

            await updateLeadStage(parseInt(leadId), newStage);
        });
    });
}

async function updateLeadStage(leadId, stage, extraFields = {}) {
    if (!guardLeadWrite('переміщати ліди між етапами')) return;
    try {
        const body = { pipeline_stage: stage, ...extraFields };
        const res = await apiFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(body) });
        if (!res) return;
        const data = await res.json();
        if (data.success) {
            if (typeof showNotification === 'function') showNotification(`Етап змінено на: ${stage}`, 'success');
            if (stage === 'deal' && data.customer?.id && currentWorkspaceData?.lead?.id === leadId) {
                currentWorkspaceData = {
                    ...currentWorkspaceData,
                    lead: data.lead || currentWorkspaceData.lead,
                    customer: data.customer
                };
            }

            // If deposit_received, show task summary
            if (stage === 'deposit_received') {
                if (typeof showNotification === 'function') showNotification('💰 Завдаток! Задачі створені автоматично', 'success');
            }
            if (stage === 'deal') {
                const openedBookingDraft = await offerDealBookingFlow(leadId, data.lead);
                if (openedBookingDraft) return;
            }
            await loadLeads();
            if (workspaceLeadId === leadId) openLeadWorkspace(leadId, { pushState: false });
        }
    } catch (e) {
        console.error('Update stage error', e);
    }
}

// ==========================================
// LEAD TYPE MENU (context)
// ==========================================
function showTypeMenu(leadId, event) {
    if (!guardLeadWrite('змінювати тип ліда')) return;
    event.stopPropagation();
    // Remove existing menu
    document.querySelectorAll('.type-menu-popup').forEach(el => el.remove());

    const lead = leadsData.find(l => l.id === leadId);
    if (!lead) return;

    const menu = document.createElement('div');
    menu.className = 'type-menu-popup';
    menu.innerHTML = `
        <button onclick="setLeadType(${leadId}, 'quality', event)">🟢 Якісний</button>
        <button onclick="setLeadType(${leadId}, 'spam', event)">🔴 Спам</button>
        <button onclick="setLeadType(${leadId}, 'collaboration', event)">🤝 Співпраця</button>
        <button onclick="setLeadType(${leadId}, 'informational', event)">📩 Інформаційний</button>
        <button onclick="setLeadType(${leadId}, 'low_quality', event)">⬇️ Неякісний</button>
    `;

    const rect = event.target.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = rect.left + 'px';
    document.body.appendChild(menu);

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function handler() {
            menu.remove();
            document.removeEventListener('click', handler);
        }, { once: true });
    }, 50);
}

async function persistLeadType(leadId, type, { reload = true } = {}) {
    if (!guardLeadWrite('змінювати тип ліда')) return false;
    const normalizedType = LEAD_TYPE_MAP[type] ? type : 'quality';
    const body = { lead_type: normalizedType };
    // Collaboration: auto-create task
    if (normalizedType === 'collaboration') {
        body.notes = (leadsData.find(l => l.id === leadId)?.notes || '') + '\n[Співпраця] Потрібна задача для відділу';
    }
    const res = await apiFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res) return false;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Не вдалося змінити тип ліда');
    }
    if (typeof showNotification === 'function') showNotification(`Тип змінено: ${LEAD_TYPE_MAP[normalizedType]?.label}`, 'success');

    // If informational, suggest mailing
    if (normalizedType === 'informational') {
        if (typeof showNotification === 'function') showNotification('📩 Автоматично додано до розсилки', 'info');
    }
    if (reload) await loadLeads();
    return true;
}

async function setLeadType(leadId, type, event) {
    if (event) event.stopPropagation();
    if (!guardLeadWrite('змінювати тип ліда')) return;
    document.querySelectorAll('.type-menu-popup').forEach(el => el.remove());

    // If quality type from the full menu, show category picker.
    if (type === 'quality') {
        showQualityCategoryModal(leadId);
        return;
    }

    try {
        await persistLeadType(leadId, type);
    } catch (e) {
        console.error('Set lead type error', e);
        if (typeof showNotification === 'function') showNotification(e.message || 'Не вдалося змінити тип ліда', 'error');
    }
}

async function updateLeadTypeFromKanbanSelect(leadId, type, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const select = event?.target?.closest?.('[data-lead-type-select]');
    const lead = leadsData.find(l => Number(l.id) === Number(leadId));
    const previousType = LEAD_TYPE_MAP[lead?.lead_type] ? lead.lead_type : 'quality';
    const nextType = LEAD_TYPE_MAP[type] ? type : previousType;
    if (nextType === previousType) return;
    if (!guardLeadWrite('змінювати тип ліда')) {
        if (select) select.value = previousType;
        return;
    }
    if (select) {
        select.disabled = true;
        select.classList.add('is-saving');
    }
    try {
        const saved = await persistLeadType(leadId, nextType, { reload: false });
        if (!saved) {
            if (select) select.value = previousType;
            return;
        }
        if (lead) lead.lead_type = nextType;
        await loadLeads();
    } catch (e) {
        if (select) select.value = previousType;
        console.error('Kanban lead type select error', e);
        if (typeof showNotification === 'function') showNotification(e.message || 'Не вдалося змінити тип ліда', 'error');
    } finally {
        if (select) {
            select.disabled = false;
            select.classList.remove('is-saving');
        }
    }
}

function showQualityCategoryModal(leadId) {
    if (!guardLeadWrite('змінювати тип ліда')) return;
    const overlay = document.getElementById('qualityCategoryModal');
    if (!overlay) return;
    overlay.dataset.leadId = leadId;
    overlay.classList.add('active');
}

function closeQualityCategoryModal() {
    document.getElementById('qualityCategoryModal')?.classList.remove('active');
}

function getLeadSecondaryState(modalId) {
    const fields = LEAD_SECONDARY_MODAL_FIELDS[modalId] || [];
    return fields.map(id => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }).join('|');
}

function rememberLeadSecondarySurface(modalId) {
    const overlay = document.getElementById(modalId);
    if (!overlay) return;
    leadSecondaryInitialState.set(modalId, getLeadSecondaryState(modalId));
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(overlay);
}

function isLeadSecondaryDirty(modalId) {
    return getLeadSecondaryState(modalId) !== (leadSecondaryInitialState.get(modalId) || '');
}

async function confirmLeadUiAction(message, options = {}) {
    if (typeof confirmModal === 'function') {
        return confirmModal(message, options);
    }
    if (typeof showNotification === 'function') {
        showNotification('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
    }
    return false;
}

async function closeLeadSecondaryModal(modalId, force = false) {
    const overlay = document.getElementById(modalId);
    if (!overlay) return true;
    const closeNow = () => {
        overlay.classList.remove('active');
        leadSecondaryInitialState.set(modalId, getLeadSecondaryState(modalId));
    };

    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
            force,
            isDirty: () => isLeadSecondaryDirty(modalId)
        });
    }

    if (!force && isLeadSecondaryDirty(modalId)) {
        const confirmed = await confirmLeadUiAction('Є незбережені зміни. Закрити без збереження?', {
            type: 'warning',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
        if (!confirmed) return false;
    }

    closeNow();
    return true;
}

function closeLostReasonModal(force = false) {
    return closeLeadSecondaryModal('lostReasonModal', force);
}

function closeAddMailingModal(force = false) {
    return closeLeadSecondaryModal('addMailingModal', force);
}

async function closeActiveLeadEditableSurfaces(force = false) {
    const surfaces = [
        { id: 'leadModal', close: () => closeLeadModal(force) },
        { id: 'customerCardModal', close: () => closeCustomerCardModal(force) },
        { id: 'lostReasonModal', close: () => closeLostReasonModal(force) },
        { id: 'addMailingModal', close: () => closeAddMailingModal(force) }
    ];

    for (const surface of surfaces) {
        const overlay = document.getElementById(surface.id);
        if (overlay?.classList.contains('active') && !(await surface.close())) return false;
    }
    return true;
}

function getCustomerCardState() {
    const fields = [
        'ccName',
        'ccPhone',
        'ccEmail',
        'ccChannel',
        'ccEventType',
        'ccEventDate',
        'ccGuestCount',
        'ccChildrenCount',
        'ccBudget',
        'ccHowFound',
        'ccNotes'
    ];
    return fields.map(id => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }).join('|');
}

function isCustomerCardDirty() {
    return getCustomerCardState() !== customerCardInitialState;
}

async function closeCustomerCardModal(force = false) {
    const overlay = document.getElementById('customerCardModal');
    if (!overlay) return true;

    const closeNow = () => {
        overlay.classList.remove('active');
        customerCardInitialState = getCustomerCardState();
    };

    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
            force,
            isDirty: isCustomerCardDirty,
            message: 'Є незбережені зміни в картці клієнта. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }

    if (!force && isCustomerCardDirty()) {
        const confirmed = await confirmLeadUiAction('Є незбережені зміни в картці клієнта. Закрити без збереження?', {
            type: 'warning',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
        if (!confirmed) return false;
    }

    closeNow();
    return true;
}

async function setQualityCategory(category) {
    const overlay = document.getElementById('qualityCategoryModal');
    if (!overlay) return;
    const leadId = parseInt(overlay.dataset.leadId);
    closeQualityCategoryModal();

    try {
        await apiFetch(`/api/leads/${leadId}`, {
            method: 'PATCH',
            body: JSON.stringify({ lead_type: 'quality', quality_category: category })
        });
        if (typeof showNotification === 'function') showNotification(`Якісний лід: ${QUALITY_CATEGORIES[category] || category}`, 'success');
        // Show customer card modal
        showCustomerCardModal(leadId);
        await loadLeads();
    } catch (e) {
        console.error('Set quality category error', e);
    }
}

// ==========================================
// CUSTOMER CARD MODAL
// ==========================================
async function showCustomerCardModal(leadId) {
    const overlay = document.getElementById('customerCardModal');
    if (!overlay) return;

    const lead = leadsData.find(l => l.id === leadId);
    overlay.dataset.leadId = leadId;

    // Pre-fill from lead data
    document.getElementById('ccName').value = lead?.client_name || '';
    document.getElementById('ccPhone').value = lead?.phone || '';
    document.getElementById('ccEmail').value = '';
    document.getElementById('ccChannel').value = lead?.source_channel || lead?.source || '';
    document.getElementById('ccEventType').value = lead?.quality_category || '';
    document.getElementById('ccEventDate').value = lead?.event_date ? lead.event_date.split('T')[0] : '';
    document.getElementById('ccGuestCount').value = '';
    document.getElementById('ccChildrenCount').value = lead?.children_count || '';
    document.getElementById('ccCelebrants').value = formatCelebrantsInput(lead?.celebrants || []);
    document.getElementById('ccBudget').value = '';
    document.getElementById('ccHowFound').value = '';
    document.getElementById('ccNotes').value = '';

    // Load existing card if any
    try {
        const res = await apiFetch(`/api/leads/${leadId}/card`);
        if (!res) return;
        const data = await res.json();
        if (data.card) {
            const c = data.card;
            if (c.email) document.getElementById('ccEmail').value = c.email;
            if (c.channel) document.getElementById('ccChannel').value = c.channel;
            if (c.event_type) document.getElementById('ccEventType').value = c.event_type;
            if (c.event_date) document.getElementById('ccEventDate').value = c.event_date.split('T')[0];
            if (c.guest_count) document.getElementById('ccGuestCount').value = c.guest_count;
            if (c.children_count) document.getElementById('ccChildrenCount').value = c.children_count;
            if (c.budget_approx) document.getElementById('ccBudget').value = c.budget_approx;
            if (c.how_found) document.getElementById('ccHowFound').value = c.how_found;
            if (c.notes) document.getElementById('ccNotes').value = c.notes;
        }
    } catch(e) { /* ok */ }

    customerCardInitialState = getCustomerCardState();
    overlay.classList.add('active');
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(overlay);
}

async function saveCustomerCard() {
    if (!guardLeadWrite('редагувати картку клієнта ліда')) return;
    const overlay = document.getElementById('customerCardModal');
    const leadId = parseInt(overlay.dataset.leadId);

    const body = {
        event_type: document.getElementById('ccEventType')?.value || null,
        event_date: document.getElementById('ccEventDate')?.value || null,
        guest_count: parseInt(document.getElementById('ccGuestCount')?.value) || null,
        children_count: parseInt(document.getElementById('ccChildrenCount')?.value) || null,
        celebrants: parseCelebrantsInput(document.getElementById('ccCelebrants')?.value),
        budget_approx: parseInt(document.getElementById('ccBudget')?.value) || null,
        how_found: document.getElementById('ccHowFound')?.value || null,
        email: document.getElementById('ccEmail')?.value || null,
        channel: document.getElementById('ccChannel')?.value || null,
        notes: document.getElementById('ccNotes')?.value || null
    };
    if (!body.children_count && body.celebrants.length) body.children_count = body.celebrants.length;

    // Also update lead name/phone if changed
    const name = document.getElementById('ccName')?.value.trim();
    const phone = document.getElementById('ccPhone')?.value.trim();
    if (name || phone || body.event_date || body.children_count || (body.celebrants || []).length) {
        try {
            const leadBody = {};
            if (name) leadBody.client_name = name;
            if (phone) leadBody.phone = phone;
            if (body.event_date) leadBody.event_date = body.event_date;
            if (body.children_count) leadBody.children_count = body.children_count;
            leadBody.celebrants = body.celebrants || [];
            await apiFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(leadBody) });
        } catch(e) { /* non-blocking */ }
    }

    try {
        const res = await apiFetch(`/api/leads/${leadId}/card`, { method: 'POST', body: JSON.stringify(body) });
        if (!res) return;
        const data = await res.json();
        if (data.success) {
            if (typeof showNotification === 'function') showNotification('Картка клієнта збережена', 'success');
            if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.markClean(overlay);
            await closeCustomerCardModal(true);
            await loadLeads();
            if (workspaceLeadId === leadId) openLeadWorkspace(leadId, { pushState: false });
        }
    } catch (e) {
        console.error('Save card error', e);
        if (typeof showNotification === 'function') showNotification('Помилка збереження картки', 'error');
    }
}

// ==========================================
// LOST REASON MODAL
// ==========================================
function showLostReasonModal(leadId, stage) {
    if (!guardLeadWrite('закривати ліди')) return;
    const overlay = document.getElementById('lostReasonModal');
    if (!overlay) return;
    overlay.dataset.leadId = leadId;
    overlay.dataset.stage = stage;
    document.getElementById('lostReasonSelect').value = '';
    document.getElementById('lostReasonNotes').value = '';
    overlay.classList.add('active');
    rememberLeadSecondarySurface('lostReasonModal');
}

async function saveLostReason() {
    if (!guardLeadWrite('закривати ліди')) return;
    const overlay = document.getElementById('lostReasonModal');
    const leadId = parseInt(overlay.dataset.leadId);
    const reason = document.getElementById('lostReasonSelect')?.value;
    const notes = document.getElementById('lostReasonNotes')?.value;

    await updateLeadStage(leadId, 'lost', {
        lost_reason: reason + (notes ? ': ' + notes : ''),
        lead_type: 'low_quality'
    });
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.markClean(overlay);
    await closeLostReasonModal(true);

    // Suggest mailing
    if (typeof showNotification === 'function') {
        showNotification('Лід позначено як втрачений. Контакт додано до розсилки.', 'info');
    }
}

// ==========================================
// MAILING LIST VIEW
// ==========================================
async function loadMailing() {
    if (window.Explainability) Explainability.setRegion('leadsExplainability', '');
    const tableWrap = document.getElementById('tableView');
    const kanbanWrap = document.getElementById('kanbanView');
    const mailingWrap = document.getElementById('mailingView');
    if (tableWrap) tableWrap.style.display = 'none';
    if (kanbanWrap) kanbanWrap.style.display = 'none';
    if (mailingWrap) mailingWrap.style.display = '';
    hideFunnelBar();

    try {
        const res = await apiFetch('/api/leads/mailing');
        if (!res) return;
        const data = await res.json();
        const list = data.list || [];

        mailingWrap.innerHTML = `
            <div class="mailing-header">
                <h3>Список розсилки (${list.length})</h3>
                <button class="btn-add-mailing" onclick="showAddMailingModal()">+ Додати контакт</button>
            </div>
            ${list.length === 0 ? '<div class="empty-state">Список розсилки порожній</div>' :
            `<table class="leads-table"><thead><tr>
                <th>Ім'я</th><th>Телефон</th><th>Email</th><th>Канал</th><th>Примітки</th><th>Дії</th>
            </tr></thead><tbody>
            ${list.map(m => `<tr>
                <td>${escapeHtml(m.name || m.lead_name || '—')}</td>
                <td>${escapeHtml(m.phone || '—')}</td>
                <td>${escapeHtml(m.email || '—')}</td>
                <td>${SOURCE_MAP[m.source_channel] || escapeHtml(m.source_channel) || '—'}</td>
                <td>${escapeHtml(m.notes || '—')}</td>
                <td><button class="btn-delete" onclick="deleteMailingEntry(${m.id})">✕</button></td>
            </tr>`).join('')}
            </tbody></table>`}
        `;
        syncLeadReadOnlyUi();
    } catch(e) {
        if (mailingWrap) mailingWrap.innerHTML = '<div class="empty-state">Помилка завантаження</div>';
    }
}

function showAddMailingModal() {
    if (!guardLeadWrite('редагувати розсилку')) return;
    const overlay = document.getElementById('addMailingModal');
    if (!overlay) return;
    document.getElementById('mailingName').value = '';
    document.getElementById('mailingPhone').value = '';
    document.getElementById('mailingEmail').value = '';
    document.getElementById('mailingChannel').value = '';
    document.getElementById('mailingNotes').value = '';
    overlay.classList.add('active');
    rememberLeadSecondarySurface('addMailingModal');
}

async function saveMailingEntry() {
    if (!guardLeadWrite('редагувати розсилку')) return;
    const overlay = document.getElementById('addMailingModal');
    const name = document.getElementById('mailingName')?.value.trim();
    const phone = document.getElementById('mailingPhone')?.value.trim();
    if (!name && !phone) {
        if (typeof showNotification === 'function') showNotification("Ім'я або телефон обов'язкові", 'error');
        return;
    }
    try {
        const body = {
            name: name || null,
            phone: phone || null,
            email: document.getElementById('mailingEmail')?.value.trim() || null,
            source_channel: document.getElementById('mailingChannel')?.value || null,
            notes: document.getElementById('mailingNotes')?.value.trim() || null
        };
        await apiFetch('/api/leads/mailing', { method: 'POST', body: JSON.stringify(body) });
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.markClean(overlay);
        await closeAddMailingModal(true);
        if (typeof showNotification === 'function') showNotification('Контакт додано до розсилки', 'success');
        loadMailing();
    } catch(e) {
        if (typeof showNotification === 'function') showNotification('Помилка: ' + e.message, 'error');
    }
}

async function deleteMailingEntry(id) {
    if (!guardLeadWrite('редагувати розсилку')) return;
    if (typeof confirmModal === 'function') {
        if (!await confirmModal('Видалити з розсилки?', { type: 'danger', okText: 'Видалити' })) return;
    }
    try {
        await apiFetch(`/api/leads/mailing/${id}`, { method: 'DELETE' });
        loadMailing();
    } catch(e) { /* */ }
}

// ==========================================
// SETUP
// ==========================================
function bindLeadModalButton(id, action) {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.leadModalBound === 'true') return;
    btn.dataset.leadModalBound = 'true';

    const run = (event) => {
        if (event.type === 'touchend') {
            leadModalLastTouchAt = Date.now();
            event.preventDefault();
        } else if (event.type === 'click' && Date.now() - leadModalLastTouchAt < 700) {
            return;
        }
        action();
    };

    btn.addEventListener('click', run);
    btn.addEventListener('touchend', run, { passive: false });
}

function setupEvents() {
    if (setupEvents.bound) return;
    setupEvents.bound = true;
    bindWorkspaceEvents();

    // View toggle buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentView = btn.dataset.view;
            if (currentView === 'kanban') renderKanban();
            else if (currentView === 'mailing') loadMailing();
            else renderTable();
            syncWorkspaceHighlight();
        });
    });

    // Filter buttons
    document.querySelectorAll('#filterBtns .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#filterBtns .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.status;
            currentTypeFilter = '';
            currentPipelineStage = '';
            loadLeads();
        });
    });

    // Date filter buttons (Сьогодні / Завтра)
    document.querySelectorAll('#dateBtns .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const isActive = btn.classList.contains('active');
            document.querySelectorAll('#dateBtns .filter-btn').forEach(b => b.classList.remove('active'));
            if (isActive) {
                // Toggle off — clear date filter
                currentDateFilter = '';
            } else {
                btn.classList.add('active');
                const now = new Date();
                if (btn.dataset.date === 'tomorrow') {
                    now.setDate(now.getDate() + 1);
                }
                currentDateFilter = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
            }
            loadLeads();
        });
    });

    // Search
    let searchTimeout;
    const searchInput = document.getElementById('leadsSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(loadLeads, 300);
        });
    }
    document.addEventListener('click', (e) => {
        const clear = e.target.closest('[data-explain-clear="leads"]');
        if (!clear) return;
        e.preventDefault();
        resetLeadFilters();
    });

    // Add lead button
    const addBtn = document.getElementById('addLeadBtn');
    if (addBtn) addBtn.addEventListener('click', openAddModal);
    bindLeadModalButton('leadModalCancel', closeLeadModal);
    bindLeadModalButton('leadModalSave', saveLead);

    // Close modals on overlay click
    document.querySelectorAll('.lead-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                if (overlay.id === 'leadModal') closeLeadModal(false);
                else if (overlay.id === 'customerCardModal') closeCustomerCardModal(false);
                else if (overlay.id === 'qualityCategoryModal') closeQualityCategoryModal();
                else if (overlay.id === 'lostReasonModal') closeLostReasonModal(false);
                else if (overlay.id === 'addMailingModal') closeAddMailingModal(false);
                else overlay.classList.remove('active');
            }
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.querySelector('.confirm-overlay')) return;
        const modal = document.getElementById('leadModal');
        const customerCardModal = document.getElementById('customerCardModal');
        const lostReasonModal = document.getElementById('lostReasonModal');
        const addMailingModal = document.getElementById('addMailingModal');
        const qualityCategoryModal = document.getElementById('qualityCategoryModal');
        if (modal?.classList.contains('active')) {
            e.preventDefault();
            closeLeadModal(false);
            return;
        }
        if (customerCardModal?.classList.contains('active')) {
            e.preventDefault();
            closeCustomerCardModal(false);
            return;
        }
        if (lostReasonModal?.classList.contains('active')) {
            e.preventDefault();
            closeLostReasonModal(false);
            return;
        }
        if (addMailingModal?.classList.contains('active')) {
            e.preventDefault();
            closeAddMailingModal(false);
            return;
        }
        if (qualityCategoryModal?.classList.contains('active')) {
            e.preventDefault();
            closeQualityCategoryModal();
        }
    });
}

function openAddModal() {
    if (!guardLeadWrite('створювати ліди')) return;
    document.getElementById('leadModalTitle').textContent = isMaysternyaLeadContext() ? 'Нова заявка' : 'Новий лід';
    document.getElementById('leadEditId').value = '';
    document.getElementById('leadName').value = '';
    document.getElementById('leadPhone').value = '';
    document.getElementById('leadInstagram').value = '';
    document.getElementById('leadSource').value = '';
    document.getElementById('leadEventDate').value = '';
    document.getElementById('leadChildrenCount').value = '';
    document.getElementById('leadCelebrants').value = '';
    document.getElementById('leadNotes').value = '';
    document.getElementById('leadAssignedTo').value = '';
    syncLeadModalBusinessFields();

    // Hide pipeline/type fields for new lead
    const stageGroup = document.getElementById('leadStageGroup');
    if (stageGroup) stageGroup.style.display = 'none';

    const modal = document.getElementById('leadModal');
    modalInitialState = getModalState();
    modal?.classList.add('active');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
}

function editLead(id) {
    if (!guardLeadWrite('редагувати ліди')) return;
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return;

    document.getElementById('leadModalTitle').textContent = isMaysternyaLeadContext() ? 'Редагування заявки' : 'Редагування ліду';
    document.getElementById('leadEditId').value = id;
    document.getElementById('leadName').value = lead.client_name || '';
    document.getElementById('leadPhone').value = lead.phone || '';
    document.getElementById('leadInstagram').value = lead.instagram || '';
    document.getElementById('leadSource').value = lead.source || '';
    document.getElementById('leadEventDate').value = lead.event_date ? lead.event_date.split('T')[0] : '';
    document.getElementById('leadChildrenCount').value = isMaysternyaLeadContext() ? '' : (lead.children_count || '');
    document.getElementById('leadCelebrants').value = isMaysternyaLeadContext() ? '' : formatCelebrantsInput(lead.celebrants || []);
    document.getElementById('leadNotes').value = lead.notes || '';
    document.getElementById('leadAssignedTo').value = lead.assigned_to || '';

    // Show pipeline/type fields for existing lead
    const stageGroup = document.getElementById('leadStageGroup');
    if (stageGroup) {
        stageGroup.style.display = '';
        document.getElementById('leadPipelineStage').value = lead.pipeline_stage || 'new';
        document.getElementById('leadLeadType').value = lead.lead_type || 'quality';
    }

    const modal = document.getElementById('leadModal');
    modalInitialState = getModalState();
    modal?.classList.add('active');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
}

function getModalState() {
    const fields = ['leadName', 'leadPhone', 'leadInstagram', 'leadSource', 'leadEventDate', 'leadChildrenCount', 'leadCelebrants', 'leadNotes', 'leadAssignedTo', 'leadPipelineStage', 'leadLeadType'];
    return fields.map(id => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }).join('|');
}

function isModalDirty() {
    return getModalState() !== modalInitialState;
}

async function closeLeadModal(force = false) {
    const modal = document.getElementById('leadModal');
    if (window.UnsafeDismissGuard && modal) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, () => {
            modal.classList.remove('active');
            modalInitialState = getModalState();
        }, {
            force,
            isDirty: isModalDirty,
            message: 'Є незбережені зміни в ліді. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    syncLeadModalBusinessFields();
    if (!force && isModalDirty()) {
        if (typeof confirmModal === 'function') {
            if (!await confirmModal('Є незбережені дані. Закрити?', { type: 'warning', okText: 'Закрити' })) return;
        }
    }
    document.getElementById('leadModal')?.classList.remove('active');
}

async function saveLead() {
    if (!guardLeadWrite('редагувати ліди')) return;
    const editId = document.getElementById('leadEditId')?.value;
    const name = document.getElementById('leadName')?.value.trim();
    if (!name) { if (typeof showNotification === 'function') showNotification("Ім'я обов'язкове", 'error'); return; }
    if (leadSaveInFlight) return;

    const body = {
        client_name: name,
        phone: document.getElementById('leadPhone')?.value.trim() || null,
        instagram: document.getElementById('leadInstagram')?.value.trim() || null,
        source: document.getElementById('leadSource')?.value || null,
        event_date: document.getElementById('leadEventDate')?.value || null,
        children_count: isMaysternyaLeadContext() ? null : (parseInt(document.getElementById('leadChildrenCount')?.value) || null),
        celebrants: isMaysternyaLeadContext() ? [] : parseCelebrantsInput(document.getElementById('leadCelebrants')?.value),
        notes: document.getElementById('leadNotes')?.value.trim() || null,
        assigned_to: parseInt(document.getElementById('leadAssignedTo')?.value) || null
    };
    if (!body.children_count && body.celebrants.length) body.children_count = body.celebrants.length;

    // Add pipeline/type if editing
    if (editId) {
        const stageEl = document.getElementById('leadPipelineStage');
        const typeEl = document.getElementById('leadLeadType');
        if (stageEl) body.pipeline_stage = stageEl.value;
        if (typeEl) body.lead_type = typeEl.value;
    }

    const saveBtn = document.getElementById('leadModalSave');
    try {
        leadSaveInFlight = true;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Збереження...';
        }
        let res;
        if (editId) {
            res = await apiFetch(`/api/leads/${editId}`, { method: 'PATCH', body: JSON.stringify(leadPayload(body)) });
        } else {
            res = await apiFetch('/api/leads', { method: 'POST', body: JSON.stringify(leadPayload(body)) });
        }
        const data = await res.json();
        if (!data.success) { if (typeof showNotification === 'function') showNotification(data.error || 'Помилка', 'error'); return; }
        closeLeadModal(true);
        await loadLeads();
        if (editId && workspaceLeadId === parseInt(editId, 10)) {
            openLeadWorkspace(parseInt(editId, 10), { pushState: false });
        }
    } catch (err) {
        console.error('Save lead error', err);
        if (typeof showNotification === 'function') showNotification('Помилка збереження', 'error');
    } finally {
        leadSaveInFlight = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Зберегти';
        }
    }
}

async function deleteLead(id) {
    if (!guardLeadWrite('видаляти ліди')) return;
    if (typeof confirmModal === 'function') {
        if (!await confirmModal('Видалити лід?', { type: 'danger', okText: 'Видалити' })) return;
    }
    try {
        await apiFetch(`/api/leads/${id}`, { method: 'DELETE' });
        if (workspaceLeadId === id) closeLeadWorkspace();
        await loadLeads();
    } catch (err) {
        console.error('Delete lead error', err);
        if (typeof showNotification === 'function') showNotification('Помилка: ' + err.message, 'error');
    }
}

async function resolveLeadConversionRecord(id) {
    const fromWorkspace = currentWorkspaceData?.lead?.id === id ? currentWorkspaceData.lead : null;
    let lead = fromWorkspace || leadsData.find(l => l.id === id) || null;
    if (!isMaysternyaLeadContext()) return lead;
    const hasMaysternyaDraftContext = Boolean(lead?.topic || lead?.message || lead?.page || lead?.inbound?.topic || lead?.inbound?.message);
    if (hasMaysternyaDraftContext) return lead;
    try {
        const res = await apiFetch(`/api/leads/${id}/workspace`);
        if (!res) return lead;
        const data = await res.json();
        if (data.success && data.workspace?.lead) {
            lead = { ...(lead || {}), ...data.workspace.lead };
            if (currentWorkspaceData?.lead?.id === id) currentWorkspaceData = data.workspace;
        }
    } catch (err) {
        console.warn('Lead conversion workspace hydrate failed', err);
    }
    return lead;
}

function leadHasExactBookingContext(leadId, lead = null) {
    if (lead?.bookingId || lead?.booking_id) return true;
    if (currentWorkspaceData?.lead?.id !== leadId) return false;
    return Boolean(exactLeadBooking(currentWorkspaceData));
}

async function loadLeadWorkspaceForConversion(id) {
    if (currentWorkspaceData?.lead?.id === id) return currentWorkspaceData;
    try {
        const res = await apiFetch(`/api/leads/${id}/workspace`);
        if (!res) return null;
        const data = await res.json();
        if (data.success && data.workspace) return data.workspace;
    } catch (err) {
        console.warn('Lead booking customer workspace hydrate failed', err);
    }
    return null;
}

async function ensureLeadCustomerForBooking(leadId, seedLead = null) {
    const workspace = await loadLeadWorkspaceForConversion(leadId);
    const workspaceLead = workspace?.lead ? { ...(seedLead || {}), ...workspace.lead } : seedLead;
    const workspaceCustomer = workspace?.customer || null;
    const linkBody = workspaceCustomer?.id
        ? { customerId: workspaceCustomer.id }
        : { createNew: true };

    const res = await apiFetch(`/api/leads/${leadId}/link-customer`, {
        method: 'POST',
        body: JSON.stringify(leadPayload(linkBody))
    });
    if (!res) throw new Error('Customer link request failed');
    const data = await res.json();
    if (!data.success || !data.customer?.id) {
        throw new Error(data.error || 'Не вдалося створити або привʼязати клієнта');
    }

    if (currentWorkspaceData?.lead?.id === leadId) {
        currentWorkspaceData = {
            ...currentWorkspaceData,
            lead: workspaceLead || currentWorkspaceData.lead,
            customer: data.customer
        };
    }

    return {
        lead: workspaceLead || seedLead,
        customer: data.customer,
        mode: data.mode,
        suggestions: data.suggestions || []
    };
}

async function convertLead(id, options = {}) {
    if (!guardLeadWrite('конвертувати ліди')) return;
    const lead = options.lead || await resolveLeadConversionRecord(id);
    if (!lead) return;
    let ensured = null;
    try {
        ensured = await ensureLeadCustomerForBooking(id, lead);
    } catch (err) {
        console.error('Lead booking customer ensure error', err);
        if (typeof showNotification === 'function') {
            showNotification(err.message || 'Не вдалося створити картку клієнта для бронювання', 'error');
        }
        return false;
    }
    const conversionLead = ensured.lead || lead;
    const customer = ensured.customer || null;
    const params = new URLSearchParams();
    const customerName = customer?.name || leadRecordText(conversionLead, ['client_name', 'clientName', 'customerName', 'name']);
    const customerPhone = customer?.phone || leadRecordText(conversionLead, ['phone', 'clientPhone', 'customerPhone', 'contact_phone', 'contactPhone', 'contact', 'whatsapp']);
    const rawEventDate = leadRecordText(conversionLead, ['event_date', 'eventDate', 'booking_date', 'bookingDate', 'date']);
    if (customer?.id) params.set('customerId', customer.id);
    if (customerName) params.set('customerName', customerName);
    if (customerPhone) params.set('customerPhone', customerPhone);
    if (rawEventDate) {
        const eventDate = String(rawEventDate).split('T')[0];
        params.set('date', eventDate);
        params.set('eventDate', eventDate);
    }
    params.set('leadId', id);
    params.set('convert', 'booking');
    if (isMaysternyaLeadContext()) {
        const topic = leadRecordText(conversionLead, ['topic', 'request_topic', 'requestTopic', 'sessionType', 'quality_category', 'qualityCategory', 'programName', 'program_name']);
        const message = leadRecordText(conversionLead, ['message', 'notes', 'comment', 'description']);
        const source = leadRecordText(conversionLead, ['sourceChannel', 'source_channel', 'source']);
        const page = leadRecordText(conversionLead, ['page', 'pageUrl', 'page_url', 'url']);
        const sessionType = leadRecordText(conversionLead, ['sessionType', 'session_type']);
        if (topic) params.set('topic', topic);
        if (message) params.set('message', message.slice(0, 900));
        if (source) params.set('source', source);
        if (page) params.set('page', page);
        if (sessionType) params.set('sessionType', sessionType);
    }
    window.location.href = leadTimelineHref(Object.fromEntries(params.entries()), leadContextFromRecord(conversionLead));
    return true;
}

async function offerDealBookingFlow(leadId, lead = null) {
    if (leadHasExactBookingContext(leadId, lead)) return false;
    const ok = await confirmLeadUiAction('Етап змінено на "Угода". Створити бронювання на таймлайні зараз?', {
        okText: 'Створити бронювання',
        cancelText: 'Пізніше',
        type: 'success'
    });
    if (!ok) return false;
    return convertLead(leadId, { lead });
}

function localDateTimeInput(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateInput(date = new Date()) {
    return localDateTimeInput(date).slice(0, 10);
}

async function createLeadWorkspaceCallbackTask(leadId) {
    return createLeadWorkspaceFollowUpTask(leadId, 'callback');
}

async function createLeadWorkspaceFollowUpTask(leadId, presetKey = 'callback') {
    if (!guardLeadWrite('створювати задачі з ліда')) return;
    const workspace = currentWorkspaceData?.lead?.id === leadId ? currentWorkspaceData : null;
    const lead = workspace?.lead || leadsData.find(l => l.id === leadId) || {};
    const preset = MAYSTERNYA_LEAD_TASK_PRESETS[presetKey] || MAYSTERNYA_LEAD_TASK_PRESETS.callback;
    const defaultDeadline = new Date();
    defaultDeadline.setDate(defaultDeadline.getDate() + (preset.offsetDays ?? 1));
    defaultDeadline.setHours(preset.hour ?? 10, 0, 0, 0);
    const defaultTitle = typeof preset.title === 'function'
        ? preset.title(lead)
        : `Передзвонити: ${lead.clientName || lead.client_name || `лід #${leadId}`}`;
    let taskOwners = [];
    try {
        const ownersRes = await apiFetch('/api/tasks/owners');
        const ownersData = await ownersRes.json();
        taskOwners = ownersData.users || [];
    } catch (err) {
        console.error('Load task owners error', err);
    }
    if (!taskOwners.length) {
        if (typeof showNotification === 'function') showNotification('Немає доступних виконавців для задачі', 'error');
        return;
    }

    let values = null;
    if (typeof formModal === 'function') {
        values = await formModal(isMaysternyaLeadContext() ? 'Нова дія Майстерні' : 'Нова дія для ліда', [
            { key: 'title', label: 'Що зробити', defaultValue: defaultTitle, required: true },
            { key: 'deadline', label: 'Коли', type: 'datetime-local', defaultValue: localDateTimeInput(defaultDeadline), required: true },
            {
                key: 'priority',
                label: 'Пріоритет',
                type: 'select',
                defaultValue: preset.priority || 'high',
                options: [
                    { value: 'high', label: 'Високий' },
                    { value: 'normal', label: 'Звичайний' },
                    { value: 'low', label: 'Низький' }
                ]
            },
            {
                key: 'ownerUserId',
                label: 'Виконавець',
                type: 'select',
                required: true,
                options: [
                    { value: '', label: 'Оберіть виконавця' },
                    ...taskOwners.map(owner => ({
                        value: String(owner.id),
                        label: `${owner.label || owner.name || owner.username || ('User #' + owner.id)}${owner.role ? ' (' + owner.role + ')' : ''}`
                    }))
                ]
            }
        ], { okText: 'Створити задачу', type: 'success', icon: preset.icon || '📞' });
    } else if (typeof promptModal === 'function') {
        const title = await promptModal('Назва callback-задачі', { defaultValue: defaultTitle, okText: 'Створити' });
        values = title ? { title, deadline: localDateTimeInput(defaultDeadline), priority: preset.priority || 'high' } : null;
    }
    if (!values) return;

    const title = String(values.title || '').trim();
    if (!title) {
        if (typeof showNotification === 'function') showNotification('Назва задачі обовʼязкова', 'error');
        return;
    }
    if (!values.ownerUserId) {
        if (typeof showNotification === 'function') showNotification('Оберіть виконавця задачі', 'error');
        return;
    }

    try {
        const deadline = values.deadline || localDateTimeInput(defaultDeadline);
        const body = {
            title,
            description: typeof preset.description === 'function'
                ? preset.description(leadId)
                : `Швидка дія з workspace ліда #${leadId}`,
            date: deadline ? String(deadline).slice(0, 10) : localDateInput(),
            deadline,
            priority: values.priority || preset.priority || 'high',
            category: 'operational',
            task_type: 'human',
            source_type: 'lead',
            source_id: String(leadId),
            sourceEntityType: 'lead',
            sourceEntityId: String(leadId),
            ownerUserId: values.ownerUserId,
            businessContext: leadContextFromRecord(lead)
        };
        const res = await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
        if (!res) return;
        const data = await res.json();
        if (data.success) {
            if (typeof showNotification === 'function') showNotification('Follow-up задачу створено і привʼязано до ліда', 'success');
            await openLeadWorkspace(leadId, { pushState: false });
        } else if (typeof showNotification === 'function') {
            showNotification(data.error || 'Не вдалося створити задачу', 'error');
        }
    } catch (err) {
        console.error('Create lead workspace task error', err);
        if (typeof showNotification === 'function') showNotification('Помилка створення callback-задачі', 'error');
    }
}

async function completeLeadWorkspaceTask(leadId, taskId) {
    if (!guardLeadWrite('змінювати задачі ліда')) return;
    if (!taskId) return;
    const ok = typeof confirmModal === 'function'
        ? await confirmModal('Позначити цю exact задачу як виконану?', { okText: 'Виконати', type: 'success' })
        : true;
    if (!ok) return;

    try {
        const res = await apiFetch(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'done' })
        });
        if (!res) return;
        const data = await res.json();
        if (data.success) {
            if (typeof showNotification === 'function') showNotification('Задачу виконано', 'success');
            await openLeadWorkspace(leadId, { pushState: false });
        } else if (typeof showNotification === 'function') {
            showNotification(data.error || 'Не вдалося виконати задачу', 'error');
        }
    } catch (err) {
        console.error('Complete workspace task error', err);
        if (typeof showNotification === 'function') showNotification('Помилка виконання задачі', 'error');
    }
}

async function confirmLeadWorkspaceBooking(leadId, bookingId) {
    if (!guardLeadWrite('підтверджувати бронювання ліда')) return;
    if (!bookingId) return;
    const ok = typeof confirmModal === 'function'
        ? await confirmModal('Підтвердити exact preliminary бронювання?', { okText: 'Підтвердити', type: 'success' })
        : true;
    if (!ok) return;

    try {
        const res = await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}/confirm`, {
            method: 'POST',
            body: JSON.stringify({ source: 'lead_workspace' })
        });
        if (!res) return;
        const data = await res.json();
        if (data.success !== false) {
            if (typeof showNotification === 'function') showNotification('Бронювання підтверджено', 'success');
            await openLeadWorkspace(leadId, { pushState: false });
        } else if (typeof showNotification === 'function') {
            showNotification(data.error || 'Не вдалося підтвердити бронювання', 'error');
        }
    } catch (err) {
        console.error('Confirm workspace booking error', err);
        if (typeof showNotification === 'function') showNotification('Помилка підтвердження бронювання', 'error');
    }
}

function ensureLeadCustomerLinkModal() {
    let modal = document.getElementById('leadCustomerLinkModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'leadCustomerLinkModal';
    modal.className = 'lead-modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'leadCustomerLinkTitle');
    modal.innerHTML = `
        <div class="lead-modal lead-customer-link-modal">
            <h2 id="leadCustomerLinkTitle">Привʼязати клієнта</h2>
            <p class="lead-customer-link-hint" id="leadCustomerLinkHint">Оберіть існуючого клієнта зі списку або створіть нового з даних ліда.</p>
            <div class="form-group">
                <label for="leadCustomerSearch">Пошук клієнта</label>
                <input type="search" id="leadCustomerSearch" placeholder="Імʼя, телефон або Instagram" autocomplete="off">
            </div>
            <div class="form-group">
                <label for="leadCustomerSelect">Існуючий клієнт</label>
                <select id="leadCustomerSelect">
                    <option value="">Почніть пошук клієнта</option>
                </select>
            </div>
            <div class="lead-customer-link-preview is-empty" id="leadCustomerLinkPreview">Клієнта ще не вибрано.</div>
            <div class="modal-btns">
                <button type="button" class="btn-cancel" id="leadCustomerLinkCancel">Скасувати</button>
                <button type="button" class="btn-cancel" id="leadCustomerCreateNew">Створити нового з ліда</button>
                <button type="button" class="btn-save" id="leadCustomerLinkSubmit">Привʼязати існуючого</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeLeadCustomerLinkModal();
    });
    modal.querySelector('#leadCustomerLinkCancel')?.addEventListener('click', closeLeadCustomerLinkModal);
    modal.querySelector('#leadCustomerCreateNew')?.addEventListener('click', submitLeadCustomerCreateNew);
    modal.querySelector('#leadCustomerLinkSubmit')?.addEventListener('click', submitLeadCustomerLinkExisting);
    modal.querySelector('#leadCustomerSelect')?.addEventListener('change', renderLeadCustomerLinkPreview);
    modal.querySelector('#leadCustomerSearch')?.addEventListener('input', (event) => {
        clearTimeout(leadCustomerLinkState.searchTimer);
        leadCustomerLinkState.searchTimer = setTimeout(() => {
            loadLeadCustomerLinkOptions(event.target.value);
        }, 250);
    });

    return modal;
}

function normalizeLeadCustomerOption(customer) {
    if (!customer || !customer.id) return null;
    return {
        id: Number(customer.id),
        name: customer.name || customer.clientName || `Клієнт #${customer.id}`,
        phone: customer.phone || '',
        instagram: customer.instagram || '',
        childName: customer.childName || customer.child_name || '',
        totalBookings: Number(customer.totalBookings ?? customer.total_bookings ?? 0) || 0
    };
}

function leadCustomerSearchSeed(workspace) {
    const lead = workspace?.lead || {};
    const customer = workspace?.customer || {};
    return lead.phone || customer.phone || lead.clientName || lead.client_name || customer.name || '';
}

function mergeLeadCustomerOptions(customers) {
    const seen = new Set();
    leadCustomerLinkState.customers = (customers || [])
        .map(normalizeLeadCustomerOption)
        .filter(Boolean)
        .filter(customer => {
            if (seen.has(customer.id)) return false;
            seen.add(customer.id);
            return true;
        });
}

function renderLeadCustomerLinkOptions(selectedId = '') {
    const select = document.getElementById('leadCustomerSelect');
    if (!select) return;
    const customers = leadCustomerLinkState.customers;
    const visitLabel = isMaysternyaLeadContext() ? 'сес.' : 'віз.';
    if (!customers.length) {
        select.innerHTML = '<option value="">Нічого не знайдено</option>';
        renderLeadCustomerLinkPreview();
        return;
    }
    select.innerHTML = '<option value="">Оберіть існуючого клієнта</option>' + customers.map(customer => {
        const meta = [
            customer.phone,
            customer.instagram ? '@' + String(customer.instagram).replace(/^@+/, '') : '',
            customer.totalBookings ? `${customer.totalBookings} ${visitLabel}` : ''
        ].filter(Boolean).join(' · ');
        const label = `${customer.name}${meta ? ' · ' + meta : ''}`;
        return `<option value="${customer.id}"${String(customer.id) === String(selectedId) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    renderLeadCustomerLinkPreview();
}

function renderLeadCustomerLinkPreview() {
    const preview = document.getElementById('leadCustomerLinkPreview');
    const select = document.getElementById('leadCustomerSelect');
    if (!preview || !select) return;
    const selectedId = Number(select.value || 0);
    const customer = leadCustomerLinkState.customers.find(item => item.id === selectedId);
    if (!customer) {
        preview.className = 'lead-customer-link-preview is-empty';
        preview.textContent = 'Клієнта ще не вибрано.';
        return;
    }
    preview.className = 'lead-customer-link-preview';
    preview.innerHTML = `
        <strong>${escapeHtml(customer.name)}</strong>
        <span>ID ${escapeHtml(customer.id)}${customer.phone ? ' · ' + escapeHtml(customer.phone) : ''}${customer.instagram ? ' · @' + escapeHtml(String(customer.instagram).replace(/^@+/, '')) : ''}${customer.totalBookings ? ' · ' + escapeHtml(customer.totalBookings) + ' ' + escapeHtml(isMaysternyaLeadContext() ? 'сес.' : 'віз.') : ''}</span>
    `;
}

async function loadLeadCustomerLinkOptions(query) {
    const select = document.getElementById('leadCustomerSelect');
    const trimmed = String(query || '').trim();
    if (!select) return;
    if (trimmed.length < 2) {
        const workspace = currentWorkspaceData?.lead?.id === leadCustomerLinkState.leadId ? currentWorkspaceData : null;
        const current = normalizeLeadCustomerOption(workspace?.customer);
        mergeLeadCustomerOptions(current ? [current] : []);
        renderLeadCustomerLinkOptions(current?.id || '');
        return;
    }

    select.innerHTML = '<option value="">Пошук клієнтів...</option>';
    try {
        const customers = await apiFetch(`/api/customers/search?q=${encodeURIComponent(trimmed)}`)
            .then(res => res ? res.json() : []);
        const workspace = currentWorkspaceData?.lead?.id === leadCustomerLinkState.leadId ? currentWorkspaceData : null;
        const current = normalizeLeadCustomerOption(workspace?.customer);
        const stillInitialSearch = trimmed === String(leadCustomerSearchSeed(workspace) || '').trim();
        mergeLeadCustomerOptions([current, ...(Array.isArray(customers) ? customers : [])].filter(Boolean));
        renderLeadCustomerLinkOptions(stillInitialSearch ? (current?.id || '') : '');
    } catch (err) {
        console.error('Lead customer search error', err);
        select.innerHTML = '<option value="">Помилка пошуку клієнтів</option>';
        if (typeof showNotification === 'function') showNotification('Не вдалося завантажити список клієнтів', 'error');
    }
}

async function linkWorkspaceLeadCustomer(leadId) {
    if (!guardLeadWrite('привʼязувати клієнта до ліда')) return;
    const workspace = currentWorkspaceData?.lead?.id === leadId ? currentWorkspaceData : null;
    const modal = ensureLeadCustomerLinkModal();
    leadCustomerLinkState.leadId = leadId;
    leadCustomerLinkState.customers = [];

    const lead = workspace?.lead || {};
    const hint = modal.querySelector('#leadCustomerLinkHint');
    const title = modal.querySelector('#leadCustomerLinkTitle');
    const input = modal.querySelector('#leadCustomerSearch');
    const current = normalizeLeadCustomerOption(workspace?.customer);
    const seed = leadCustomerSearchSeed(workspace);
    if (title) title.textContent = isMaysternyaLeadContext() ? 'Привʼязати клієнта Майстерні' : 'Привʼязати клієнта';
    if (hint) {
        const leadLabel = lead.clientName || lead.client_name || `лід #${leadId}`;
        hint.textContent = isMaysternyaLeadContext()
            ? `Заявка: ${leadLabel}. Оберіть існуючого клієнта Майстерні або створіть нового з даних заявки.`
            : `Лід: ${leadLabel}. Оберіть існуючого клієнта зі списку або створіть нового з даних ліда.`;
    }
    if (input) input.value = seed;
    mergeLeadCustomerOptions(current ? [current] : []);
    renderLeadCustomerLinkOptions(current?.id || '');
    modal.classList.add('active');
    setTimeout(() => input?.focus(), 30);
    await loadLeadCustomerLinkOptions(seed);
}

function closeLeadCustomerLinkModal() {
    clearTimeout(leadCustomerLinkState.searchTimer);
    const modal = document.getElementById('leadCustomerLinkModal');
    if (modal) modal.classList.remove('active');
}

async function submitLeadCustomerLink(body, successText) {
    if (!guardLeadWrite('привʼязувати клієнта до ліда')) return;
    const leadId = leadCustomerLinkState.leadId;
    if (!leadId) return;
    try {
        const res = await apiFetch(`/api/leads/${leadId}/link-customer`, {
            method: 'POST',
            body: JSON.stringify(leadPayload(body))
        });
        if (!res) return;
        const data = await res.json();
        if (data.success) {
            const suggestionText = data.suggestions?.length ? ` Є ${data.suggestions.length} можливих дублікатів.` : '';
            closeLeadCustomerLinkModal();
            if (typeof showNotification === 'function') showNotification(successText + suggestionText, 'success');
            await openLeadWorkspace(leadId, { pushState: false });
        } else if (typeof showNotification === 'function') {
            showNotification(data.error || 'Не вдалося привʼязати клієнта', 'error');
        }
    } catch (err) {
        console.error('Link lead customer error', err);
        if (typeof showNotification === 'function') showNotification('Помилка привʼязки клієнта', 'error');
    }
}

async function submitLeadCustomerLinkExisting() {
    const select = document.getElementById('leadCustomerSelect');
    const customerId = Number(select?.value || 0);
    if (!Number.isInteger(customerId) || customerId <= 0) {
        if (typeof showNotification === 'function') showNotification('Оберіть існуючого клієнта зі списку', 'error');
        select?.focus();
        return;
    }
    await submitLeadCustomerLink({ customerId }, 'Клієнта привʼязано до ліда.');
}

async function submitLeadCustomerCreateNew() {
    const ok = await confirmLeadUiAction('Створити нового клієнта з даних цього ліда?', {
        okText: 'Створити і привʼязати',
        type: 'success'
    });
    if (!ok) return;
    await submitLeadCustomerLink({ createNew: true }, 'Нового клієнта створено і привʼязано до ліда.');
}

async function moveLeadWorkspaceStage(leadId, stage) {
    if (!leadId || !stage) return;
    if (stage === 'lost') {
        showLostReasonModal(leadId, stage);
        return;
    }
    await updateLeadStage(leadId, stage);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.openLeadWorkspace = openLeadWorkspace;
window.closeLeadWorkspace = closeLeadWorkspace;
window.createLeadWorkspaceCallbackTask = createLeadWorkspaceCallbackTask;
window.createLeadWorkspaceFollowUpTask = createLeadWorkspaceFollowUpTask;
window.completeLeadWorkspaceTask = completeLeadWorkspaceTask;
window.confirmLeadWorkspaceBooking = confirmLeadWorkspaceBooking;
window.linkWorkspaceLeadCustomer = linkWorkspaceLeadCustomer;
window.closeLeadCustomerLinkModal = closeLeadCustomerLinkModal;
window.moveLeadWorkspaceStage = moveLeadWorkspaceStage;
window.updateLeadTypeFromKanbanSelect = updateLeadTypeFromKanbanSelect;
window.closeQualityCategoryModal = closeQualityCategoryModal;
window.closeLostReasonModal = closeLostReasonModal;
window.closeAddMailingModal = closeAddMailingModal;
