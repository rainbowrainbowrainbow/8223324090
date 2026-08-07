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
const LEAD_WORKSPACE_CHILD_SOURCE_ORDER = Object.freeze([
    'customer.children',
    'lead.celebrants',
    'customer.childName'
]);
const LEAD_WORKSPACE_NOTES_CONTRACT = Object.freeze({
    mergePolicy: 'render_as_separate_sections',
    leadNotesPath: 'lead.notes',
    customerNotesPath: 'customer.notes',
    childNotePaths: Object.freeze([
        'customer.children[].note',
        'lead.celebrants[].notes'
    ])
});
const ACTIVE_KANBAN_LEAD_TYPES = new Set(['quality']);
const LEAD_TYPE_WORKFLOW_MESSAGES = {
    spam: 'Спам закрито і прибрано з активної воронки',
    collaboration: 'Запит на співпрацю винесено з активної воронки, задача створена й привʼязана до ліда',
    informational: 'Інформаційний запит додано до розсилки й закрито з активної воронки',
    low_quality: 'Неякісний лід закрито з активної воронки',
    quality: 'Лід повернуто до типу “Якісний”'
};
const LEAD_TYPE_REASON_OPTIONS = {
    spam: ['Дубль', 'Бот/реклама', 'Некоректний контакт', 'Не наш запит', 'Інше'],
    low_quality: ['Немає бюджету', 'Не підходить дата', 'Не наш формат', 'Не відповідає', 'Дубль', 'Інше'],
    informational: ['Попросив ціни', 'Попросив програму', 'На майбутнє', 'Без дати', 'Інше']
};
const LEAD_TYPE_REASON_TITLES = {
    spam: 'Причина: Спам',
    low_quality: 'Причина: Неякісний',
    informational: 'Причина: Інформаційний'
};
const DEFAULT_LEAD_QUEUE = 'active';
const LEAD_QUEUE_SUMMARY_ORDER = ['active', 'collaboration', 'informational', 'screened', 'spam', 'all'];
const LEAD_QUEUE_FILTERS = {
    active: {
        label: 'Активні',
        leadType: 'quality',
        emptyTitle: 'Черга “Активні” порожня',
        emptyMessage: 'У цій черзі мають бути якісні ліди, з якими менеджер працює у продажах.'
    },
    collaboration: {
        label: 'Співпраця',
        leadType: 'collaboration',
        emptyTitle: 'Черга “Співпраця” порожня',
        emptyMessage: 'Тут будуть звернення партнерів, підрядників або запити на спільні активності.'
    },
    informational: {
        label: 'Інформаційні',
        leadType: 'informational',
        emptyTitle: 'Черга “Інформаційні” порожня',
        emptyMessage: 'Тут будуть контакти, які просили ціни, програму або інформацію на майбутнє.'
    },
    screened: {
        label: 'Відсіяні',
        leadType: 'low_quality',
        emptyTitle: 'Черга “Відсіяні” порожня',
        emptyMessage: 'Тут будуть неякісні ліди: без бюджету, не наш формат, не відповідають або не підходить дата.'
    },
    spam: {
        label: 'Спам',
        leadType: 'spam',
        emptyTitle: 'Черга “Спам” порожня',
        emptyMessage: 'Тут будуть дублікати, бот-реклама, некоректні контакти та нецільові запити.'
    },
    all: {
        label: 'Усі',
        leadType: '',
        emptyTitle: 'Лідів ще немає',
        emptyMessage: 'Ця черга показує всі типи лідів разом.'
    }
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
        hint: 'Святкування відбулося, фінальні правки і корективи менеджера.'
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
const LEAD_CUSTOMER_FALLBACK_LIMIT = 5;
const LEAD_GUEST_NOTE_PREFIX = 'Гості на бажану дату:';

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
    maysternya_bot: '🤖 Бот-хуки Майстерні',
    phone:          '📞 Телефон',
    'walk-in':      '🚶 Прийшли',
    manual:         '✏️ Ручний',
    landing:        '📄 Лендінг',
    universal:      '🌐 Universal'
};

const LEAD_VIEW_MODES = new Set(['table', 'kanban', 'mailing']);
let currentView = 'table'; // table | kanban | mailing
let currentFilter = '';
let currentTypeFilter = '';
let currentLeadQueue = DEFAULT_LEAD_QUEUE;
let currentDateFilter = '';
let currentPipelineStage = '';
let currentBusinessContext = 'event_genix';
let leadsData = [];
let leadStatsData = null;
let leadLoadSeq = 0;
const LEAD_TABLE_PAGE_SIZE = 100;
const LEAD_KANBAN_PAGE_SIZE = 100;
let leadPagination = { total: 0, limit: LEAD_TABLE_PAGE_SIZE, offset: 0, nextOffset: 0, hasMore: false, loadingMore: false };
let leadKanbanPagination = {};
let leadCustomerSearchMatches = [];
let leadCustomerSearchQuery = '';
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
let kanbanDragState = null;
const pendingLeadStageMoves = new Set();
let kanbanLeadTypeMenuEventsBound = false;
let kanbanLeadTypeTriggerOpenedAt = 0;
let kanbanLeadTypeTriggerOpenedLeadId = 0;
let activeKanbanLeadTypePopover = null;
let kanbanBookingConversionMenuEventsBound = false;
let kanbanBookingConversionTriggerOpenedAt = 0;
let kanbanBookingConversionTriggerOpenedLeadId = 0;
let activeKanbanBookingConversionPopover = null;
let leadTypeReasonRequest = null;
let leadCreateStageReasonRequest = null;
let activeLeadCreateHandoffRequest = null;

const LEAD_CREATE_ACTION_PARAM = 'action';
const LEAD_CREATE_STAGE_PARAM = 'createStage';
const LEAD_CREATE_ORIGIN_PARAM = 'origin';
const LEAD_CREATE_HANDOFF_PARAM = 'handoff';
const LEAD_CREATE_CUSTOMER_PARAMS = ['customerId', 'customer_id', 'selectedCustomerId'];
const LEAD_BOOKING_CREATE_ORIGIN = 'booking';
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

function leadSourceKey(lead = {}) {
    return String(lead.sourceChannel || lead.source_channel || lead.source || '').trim();
}

function leadSourceLabel(valueOrLead) {
    const key = typeof valueOrLead === 'string' ? valueOrLead : leadSourceKey(valueOrLead);
    return SOURCE_MAP[key] || key || '—';
}

function isMaysternyaBotLead(lead = {}) {
    return leadSourceKey(lead) === 'maysternya_bot';
}

function leadOriginBadge(lead = {}) {
    if (isMaysternyaBotLead(lead)) return '🤖 Бот-хуки';
    const label = leadSourceLabel(lead);
    return label && label !== '—' ? label : '';
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

const LEAD_BOOKING_CONVERSION_MODES = Object.freeze({
    activity: Object.freeze({ bookingMode: 'activity', timelineView: 'animators' }),
    kitchen_room: Object.freeze({ bookingMode: 'kitchen_room', timelineView: 'rooms' })
});

const LEAD_BOOKING_CONVERSION_MENU_ITEMS = Object.freeze([
    Object.freeze({
        mode: 'activity',
        icon: '🎭',
        label: 'Бронь з активністю',
        description: 'Свято / програма'
    }),
    Object.freeze({
        mode: 'kitchen_room',
        icon: '🍽',
        label: 'Бронь з їжею та кімнатою',
        description: 'Банкет / меню'
    })
]);

function leadBookingConversionModeConfig(mode) {
    const key = String(mode || '').trim();
    return LEAD_BOOKING_CONVERSION_MODES[key] || null;
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
    const celebrantsGroup = document.getElementById('leadCelebrants')?.closest('.form-group');
    if (celebrantsGroup) celebrantsGroup.hidden = maysternyaMode;
    const dateLabel = document.querySelector('label[for="leadEventDate"], #leadEventDate')?.closest('.form-group')?.querySelector('label');
    if (dateLabel) dateLabel.textContent = maysternyaMode ? 'Бажана дата консультації' : 'Бажана дата';
    const notesLabel = document.getElementById('leadNotes')?.closest('.form-group')?.querySelector('label');
    if (notesLabel) notesLabel.textContent = maysternyaMode ? 'Запит / повідомлення' : 'Нотатки';
    if (maysternyaMode) {
        const children = document.getElementById('leadChildrenCount');
        const adults = document.getElementById('leadAdultsCount');
        if (children) children.value = '';
        if (adults) adults.value = '';
        setCelebrantsEditorValue('leadCelebrants', [], { markInitial: false });
    }
    syncLeadEventDetailsVisibility();
}

function currentLeadUser() {
    const stateUser = typeof AppState !== 'undefined' ? AppState.currentUser : null;
    if (stateUser?.id || stateUser?.username || stateUser?.name) return stateUser;
    try {
        const saved = JSON.parse(localStorage.getItem('pzp_current_user') || 'null');
        return saved && typeof saved === 'object' ? saved : null;
    } catch {
        return null;
    }
}

function findCurrentLeadAssigneeId() {
    const currentUser = currentLeadUser();
    if (!currentUser) return '';
    const currentId = Number(currentUser.id);
    const currentUsername = String(currentUser.username || '').trim().toLowerCase();
    const match = (usersData || []).find(user => {
        if (Number.isInteger(currentId) && currentId > 0 && Number(user.id) === currentId) return true;
        return currentUsername && String(user.username || '').trim().toLowerCase() === currentUsername;
    });
    return match?.id ? String(match.id) : '';
}

function applyDefaultLeadAssignee(options = {}) {
    const sel = document.getElementById('leadAssignedTo');
    if (!sel) return;
    if (!options.force && sel.value) return;
    const assigneeId = findCurrentLeadAssigneeId();
    if (assigneeId && Array.from(sel.options).some(option => option.value === assigneeId)) {
        sel.value = assigneeId;
    }
}

function readLeadGuestInput(id) {
    const value = document.getElementById(id)?.value;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(parsed, 200);
}

function readLeadGuestCounts() {
    return {
        children: readLeadGuestInput('leadChildrenCount'),
        adults: readLeadGuestInput('leadAdultsCount')
    };
}

function syncLeadGuestsTotal() {
    const totalEl = document.getElementById('leadGuestsTotal');
    if (!totalEl) return;
    const counts = readLeadGuestCounts();
    totalEl.textContent = `Разом гостей: ${counts.children + counts.adults}`;
}

function syncLeadEventDetailsVisibility(options = {}) {
    const panel = document.getElementById('leadEventDetails');
    const dateEl = document.getElementById('leadEventDate');
    const show = Boolean(dateEl?.value) && !isMaysternyaLeadContext();
    if (panel) panel.hidden = !show;
    if (!show && options.clearWhenHidden) {
        const children = document.getElementById('leadChildrenCount');
        const adults = document.getElementById('leadAdultsCount');
        if (children) children.value = '';
        if (adults) adults.value = '';
    }
    syncLeadGuestsTotal();
}

function guestCountsFromLeadNotes(notes = '') {
    const line = String(notes || '')
        .split(/\r?\n/)
        .find(item => item.trim().startsWith(LEAD_GUEST_NOTE_PREFIX));
    if (!line) return { children: 0, adults: 0 };
    const children = line.match(/дітей\s*[-–—:]\s*(\d+)/i);
    const adults = line.match(/дорослих\s*[-–—:]\s*(\d+)/i);
    return {
        children: children ? Math.min(Number.parseInt(children[1], 10) || 0, 200) : 0,
        adults: adults ? Math.min(Number.parseInt(adults[1], 10) || 0, 200) : 0
    };
}

function stripLeadGuestSummary(notes = '') {
    return String(notes || '')
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith(LEAD_GUEST_NOTE_PREFIX))
        .join('\n')
        .trim();
}

function parseJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function leadGuestCountValue(...values) {
    for (const value of values) {
        if (value === undefined || value === null || value === '') continue;
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) return Math.min(parsed, 200);
    }
    return 0;
}

function leadPreferenceDateValue(...values) {
    for (const value of values) {
        if (!value) continue;
        const date = String(value).slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    }
    return '';
}

function leadEventPreferenceFromLead(lead = {}) {
    const rawPreference = parseJsonObject(lead.eventPreference || lead.event_preference);
    const legacyCounts = guestCountsFromLeadNotes(lead.notes || '');
    return {
        preferredDate: leadPreferenceDateValue(
            rawPreference.preferredDate,
            rawPreference.preferred_date,
            rawPreference.date,
            rawPreference.eventDate,
            rawPreference.event_date,
            lead.event_date,
            lead.eventDate
        ),
        childrenCount: leadGuestCountValue(
            rawPreference.childrenCount,
            rawPreference.children_count,
            lead.children_count,
            legacyCounts.children
        ),
        adultsCount: leadGuestCountValue(
            rawPreference.adultsCount,
            rawPreference.adults_count,
            legacyCounts.adults
        )
    };
}

function leadConversionPreferredDate(lead = {}) {
    const preference = leadEventPreferenceFromLead(lead);
    return leadPreferenceDateValue(
        preference.preferredDate,
        preference.preferred_date,
        lead.event_date,
        lead.eventDate,
        lead.booking_date,
        lead.bookingDate,
        lead.date
    );
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

function leadStageMoveId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function isLeadStageMovePending(leadId) {
    const id = leadStageMoveId(leadId);
    return id ? pendingLeadStageMoves.has(id) : false;
}

function syncLeadStageMovePendingUi(leadId = null) {
    const idFilter = leadStageMoveId(leadId);
    document.querySelectorAll('[data-lead-id], .kanban-card[data-id]').forEach(el => {
        const id = leadStageMoveId(el.dataset.leadId || el.dataset.id);
        if (!id || (idFilter && id !== idFilter)) return;
        const pending = pendingLeadStageMoves.has(id);
        el.classList.toggle('is-stage-pending', pending);
        if (pending) {
            el.setAttribute('aria-busy', 'true');
            el.dataset.stagePending = 'true';
        } else {
            el.removeAttribute('aria-busy');
            delete el.dataset.stagePending;
        }
    });
}

function setLeadStageMovePending(leadId, pending) {
    const id = leadStageMoveId(leadId);
    if (!id) return;
    if (pending) pendingLeadStageMoves.add(id);
    else pendingLeadStageMoves.delete(id);
    syncLeadStageMovePendingUi(id);
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
        '#lostReasonModal .btn-save',
        '#addMailingModal .btn-save'
    ].join(',')).forEach(el => {
        const keepClickableForGuard = el.matches?.('[data-lead-type-select], [data-lead-booking-convert]');
        if ('disabled' in el) el.disabled = readOnly && !keepClickableForGuard;
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

function canViewLeadRevenue() {
    return typeof canAccess === 'function' && canAccess('view_revenue');
}

function syncLeadRevenueUi() {
    const canViewRevenue = canViewLeadRevenue();
    const budgetGroup = document.getElementById('ccBudgetGroup');
    const budgetInput = document.getElementById('ccBudget');
    if (budgetGroup) budgetGroup.hidden = !canViewRevenue;
    if (budgetInput) budgetInput.disabled = !canViewRevenue;
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
    if (res.status === 401) {
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
    syncLeadRevenueUi();

    normalizeLeadCanonicalRoute();
    setupEvents();
    bindKanbanLeadTypeMenuEvents();
    bindKanbanBookingConversionMenuEvents();
    applyLeadQueryParams();
    await loadUsers();
    await maybeOpenLeadCreateFromUrl();
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
    applyDefaultLeadAssignee();
}

async function loadLeads() {
    const loadSeq = ++leadLoadSeq;
    const tbody = document.getElementById('leadsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Завантаження...</td></tr>';
    syncLeadPresentationUi();
    currentTypeFilter = leadTypeForCurrentQueue();
    leadCustomerSearchMatches = [];
    leadCustomerSearchQuery = '';
    try {
        const params = new URLSearchParams();
        if (currentFilter) params.set('status', currentFilter);
        if (currentTypeFilter) params.set('lead_type', currentTypeFilter);
        if (currentDateFilter) params.set('event_date', currentDateFilter);
        if (currentPipelineStage) params.set('pipeline_stage', currentPipelineStage);
        const search = document.getElementById('leadsSearch')?.value?.trim();
        if (search) params.set('search', search);
        const statsPromise = loadLeadQueueStats();
        let leadsResult;
        if (currentView === 'kanban') {
            leadsResult = await fetchKanbanLeadPages(params);
        } else if (currentView === 'mailing') {
            leadsResult = { leads: [], pagination: { total: 0, hasMore: false } };
        } else {
            leadsResult = await fetchLeadPage(params, { limit: LEAD_TABLE_PAGE_SIZE, offset: 0 });
        }
        const stats = await statsPromise;
        if (loadSeq !== leadLoadSeq) return;
        leadStatsData = stats;
        leadsData = leadsResult.leads;
        if (currentView === 'table') leadPagination = { ...leadsResult.pagination, loadingMore: false };
        if (leadsData.length === 0 && shouldLoadLeadCustomerFallback(search)) {
            leadCustomerSearchQuery = search;
            leadCustomerSearchMatches = await loadLeadCustomerSearchFallback(search);
            if (loadSeq !== leadLoadSeq) return;
        }

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
        if (loadSeq !== leadLoadSeq) return;
        console.error('Load leads error', err);
        const tbody = document.getElementById('leadsTableBody');
        const retryHtml = '<button type="button" class="btn-secondary" data-lead-retry>Повторити</button>';
        if (currentView === 'kanban') {
            const kanbanWrap = document.getElementById('kanbanView');
            if (kanbanWrap) kanbanWrap.innerHTML = `<div class="kanban-empty">Помилка завантаження. ${retryHtml}</div>`;
        } else if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Помилка завантаження ${retryHtml}</td></tr>`;
        }
    }
}

async function loadLeadQueueStats() {
    try {
        const res = await apiFetch('/api/leads/stats');
        if (!res) return null;
        if (!res.ok) throw new Error(`Lead stats failed: ${res.status}`);
        const data = await res.json();
        return data || null;
    } catch (err) {
        if (err?.message === 'Unauthorized') throw err;
        console.warn('Failed to load lead queue stats', err);
        return null;
    }
}

function leadQueueMeta(queue = currentLeadQueue) {
    return LEAD_QUEUE_FILTERS[queue] || LEAD_QUEUE_FILTERS[DEFAULT_LEAD_QUEUE];
}

function leadTypeForQueue(queue = currentLeadQueue) {
    return leadQueueMeta(queue).leadType || '';
}

function leadTypeForCurrentQueue() {
    return leadTypeForQueue(currentLeadQueue);
}

function leadQueueFromLeadType(type) {
    const normalized = LEAD_TYPE_MAP[type] ? type : '';
    return Object.entries(LEAD_QUEUE_FILTERS).find(([, meta]) => meta.leadType === normalized)?.[0] || 'all';
}

function normalizeLeadQueue(value) {
    return LEAD_QUEUE_FILTERS[value] ? value : DEFAULT_LEAD_QUEUE;
}

function syncLeadQueueUi() {
    document.querySelectorAll('[data-lead-queue]').forEach(btn => {
        const active = btn.dataset.leadQueue === currentLeadQueue;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-lead-queue-summary-item]').forEach(btn => {
        const active = btn.dataset.leadQueueSummaryItem === currentLeadQueue;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function setLeadQueue(queue, { replace = true } = {}) {
    currentLeadQueue = normalizeLeadQueue(queue);
    currentTypeFilter = leadTypeForCurrentQueue();
    syncLeadQueueUi();
    syncLeadUrlState({ replace });
    loadLeads();
}

function leadListParams() {
    const params = new URLSearchParams();
    if (currentFilter) params.set('status', currentFilter);
    if (currentTypeFilter) params.set('lead_type', currentTypeFilter);
    if (currentDateFilter) params.set('event_date', currentDateFilter);
    if (currentPipelineStage) params.set('pipeline_stage', currentPipelineStage);
    const search = document.getElementById('leadsSearch')?.value?.trim();
    if (search) params.set('search', search);
    return params;
}

async function fetchLeadPage(baseParams, { limit = LEAD_TABLE_PAGE_SIZE, offset = 0, order = '' } = {}) {
    const params = new URLSearchParams(baseParams);
    params.set('limit', String(limit));
    params.set('offset', String(Math.max(0, Number(offset) || 0)));
    if (order) params.set('order', order);
    const res = await apiFetch(`/api/leads?${params}`);
    if (!res?.ok) throw new Error(`Lead list failed: ${res?.status || 'offline'}`);
    const data = await res.json();
    return {
        leads: Array.isArray(data?.leads) ? data.leads : [],
        pagination: data?.pagination || { total: 0, limit, offset, nextOffset: offset, hasMore: false }
    };
}

async function fetchKanbanLeadPages(baseParams) {
    const stages = currentPipelineStage ? [currentPipelineStage] : PIPELINE_STAGES.map(stage => stage.key);
    const pages = await Promise.all(stages.map(async stage => {
        const params = new URLSearchParams(baseParams);
        params.set('pipeline_stage', stage);
        const page = await fetchLeadPage(params, { limit: LEAD_KANBAN_PAGE_SIZE, offset: 0, order: 'kanban' });
        return [stage, page];
    }));
    leadKanbanPagination = Object.fromEntries(pages.map(([stage, page]) => [stage, { ...page.pagination, loadingMore: false }]));
    return {
        leads: pages.flatMap(([, page]) => page.leads),
        pagination: { total: pages.reduce((sum, [, page]) => sum + Number(page.pagination.total || 0), 0), hasMore: pages.some(([, page]) => page.pagination.hasMore) }
    };
}

async function loadMoreLeads({ stage = '' } = {}) {
    // Load-more requests from separate Kanban columns may run in parallel.
    // Capture the active list generation without invalidating sibling columns;
    // a new filter/view load still increments leadLoadSeq and rejects stale data.
    const loadSeq = leadLoadSeq;
    const isKanban = currentView === 'kanban';
    const state = isKanban ? leadKanbanPagination[stage] : leadPagination;
    if (!state?.hasMore || state.loadingMore) return;
    const nextState = { ...state, loadingMore: true };
    if (isKanban) leadKanbanPagination = { ...leadKanbanPagination, [stage]: nextState };
    else leadPagination = nextState;
    if (isKanban) renderKanban(); else renderTable();

    try {
        const params = leadListParams();
        if (isKanban) params.set('pipeline_stage', stage);
        const page = await fetchLeadPage(params, {
            limit: isKanban ? LEAD_KANBAN_PAGE_SIZE : LEAD_TABLE_PAGE_SIZE,
            offset: state.nextOffset,
            order: isKanban ? 'kanban' : ''
        });
        if (loadSeq !== leadLoadSeq) return;
        const existingIds = new Set(leadsData.map(lead => Number(lead.id)));
        leadsData = [...leadsData, ...page.leads.filter(lead => !existingIds.has(Number(lead.id)))];
        if (isKanban) leadKanbanPagination = { ...leadKanbanPagination, [stage]: { ...page.pagination, loadingMore: false } };
        else leadPagination = { ...page.pagination, loadingMore: false };
        if (isKanban) renderKanban(); else renderTable();
    } catch (err) {
        if (loadSeq !== leadLoadSeq) return;
        console.error('Load more leads error', err);
        if (isKanban) leadKanbanPagination = { ...leadKanbanPagination, [stage]: { ...state, loadingMore: false } };
        else leadPagination = { ...state, loadingMore: false };
        if (typeof showNotification === 'function') showNotification('Не вдалося завантажити наступні ліди. Спробуйте ще раз.', 'error');
        if (isKanban) renderKanban(); else renderTable();
    }
}

function normalizeLeadCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function leadQueueCountsFromStats(stats = leadStatsData) {
    const classification = stats?.classificationStats || stats?.typeStats || {};
    const operational = stats?.operationalQueueStats || {};
    const active = normalizeLeadCount(classification.quality ?? stats?.salesTotal ?? stats?.total);
    const collaboration = normalizeLeadCount(operational.collaboration ?? classification.collaboration);
    const informational = normalizeLeadCount(operational.informational ?? classification.informational);
    const screened = normalizeLeadCount(operational.low_quality ?? classification.low_quality);
    const spam = normalizeLeadCount(operational.spam ?? classification.spam);
    const all = normalizeLeadCount(stats?.allTotal ?? (active + collaboration + informational + screened + spam));
    return { active, collaboration, informational, screened, spam, all };
}

function leadQueueCountsFromCurrentLeads() {
    const counts = { active: 0, collaboration: 0, informational: 0, screened: 0, spam: 0, all: leadsData.length };
    for (const lead of leadsData) {
        const type = lead.lead_type || 'quality';
        if (type === 'quality') counts.active += 1;
        else if (type === 'collaboration') counts.collaboration += 1;
        else if (type === 'informational') counts.informational += 1;
        else if (type === 'low_quality') counts.screened += 1;
        else if (type === 'spam') counts.spam += 1;
    }
    return counts;
}

function leadQueueCount(queue, counts) {
    return normalizeLeadCount(counts?.[queue]);
}

function leadQueueSummaryHintHtml() {
    if (currentLeadQueue !== DEFAULT_LEAD_QUEUE) return '';
    return '<div class="lead-active-queue-hint" role="note">Показані тільки якісні продажні ліди. Інші звернення доступні в чергах вище.</div>';
}

function renderStats() {
    const container = document.getElementById('leadsStats');
    if (!container) return;
    container.classList.add('leads-stats--queue-summary');

    const counts = leadStatsData ? leadQueueCountsFromStats(leadStatsData) : leadQueueCountsFromCurrentLeads();
    const items = LEAD_QUEUE_SUMMARY_ORDER.map(queue => {
        const meta = leadQueueMeta(queue);
        const active = queue === currentLeadQueue ? ' is-active' : '';
        const count = leadQueueCount(queue, counts);
        return `<button type="button" class="lead-queue-summary-chip${active}" data-lead-queue-summary-item="${queue}" onclick="setLeadQueue('${queue}')" aria-pressed="${queue === currentLeadQueue ? 'true' : 'false'}">
            <span class="lead-queue-summary-label">${escapeHtml(meta.label)}</span>
            <strong class="lead-queue-summary-count">${count}</strong>
        </button>`;
    }).join('');

    container.innerHTML = `
        <div class="lead-queue-summary-row">
            <div class="lead-queue-summary" role="group" aria-label="Черги лідів з кількістю записів">
                ${items}
            </div>
            <button type="button" class="lead-workflow-info-btn" id="leadWorkflowInfoBtn" aria-label="Пояснення типів ліда й етапів канбану" aria-haspopup="dialog" aria-controls="leadWorkflowInfoModal" title="Пояснення типів ліда й етапів канбану">i</button>
        </div>
        ${leadQueueSummaryHintHtml()}
    `;
    bindLeadWorkflowInfoButton();
}

function filterByType(type) {
    setLeadQueue(leadQueueFromLeadType(type));
}

function leadPotentialValue(lead) {
    if (!canViewLeadRevenue()) return 0;
    const value = Number(lead?.potential_value ?? lead?.potentialValue ?? lead?.budget_approx ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function isActiveKanbanLead(lead) {
    const type = lead?.lead_type || 'quality';
    return ACTIVE_KANBAN_LEAD_TYPES.has(type);
}

function isSalesMetricLead(lead) {
    return (lead?.lead_type || 'quality') === 'quality';
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

function normalizeLeadCreateStage(value, fallback = 'new') {
    const raw = String(value || '').trim();
    const matched = PIPELINE_STAGES.some(stage => stage.key === raw) ? raw : '';
    return matched || fallback;
}

function positiveLeadQueryId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function readLeadCreateCustomerId(params = new URLSearchParams()) {
    for (const key of LEAD_CREATE_CUSTOMER_PARAMS) {
        const id = positiveLeadQueryId(params.get(key));
        if (id) return id;
    }
    return null;
}

function leadCreateHandoffRequestFromUrl(params = new URLSearchParams()) {
    const api = window.CrmCreateHandoff;
    if (!api) return null;
    const currentRequest = api.readRequestFromUrl?.(window.location.href);
    if (currentRequest?.entity === 'lead') return currentRequest;

    const token = String(params.get(LEAD_CREATE_HANDOFF_PARAM) || '').trim();
    if (!token) return null;
    try {
        return api.createRequest({
            entity: 'lead',
            businessContext: leadBusinessContext(),
            token,
            returnPath: params.get(api.RETURN_PARAM) || ''
        });
    } catch (err) {
        console.warn('Invalid lead create handoff request', err);
        return null;
    }
}

function readLeadCreateDeepLinkOptions() {
    const params = new URLSearchParams(window.location.search);
    if (params.get(LEAD_CREATE_ACTION_PARAM) !== 'create') return null;
    const origin = String(params.get(LEAD_CREATE_ORIGIN_PARAM) || '').trim();
    const fromBooking = origin === LEAD_BOOKING_CREATE_ORIGIN;
    const createStage = fromBooking ? 'deal' : normalizeLeadCreateStage(params.get(LEAD_CREATE_STAGE_PARAM), 'new');
    return {
        createStage,
        origin,
        lockStage: fromBooking,
        sourceCustomerId: readLeadCreateCustomerId(params),
        handoffRequest: leadCreateHandoffRequestFromUrl(params)
    };
}

function clearLeadCreateUrlParams() {
    if (!window.history || !window.location) return;
    const url = new URL(window.location.href);
    const before = url.search;
    [LEAD_CREATE_ACTION_PARAM, LEAD_CREATE_STAGE_PARAM, LEAD_CREATE_ORIGIN_PARAM, LEAD_CREATE_HANDOFF_PARAM, ...LEAD_CREATE_CUSTOMER_PARAMS].forEach(key => {
        url.searchParams.delete(key);
    });
    const handoffApi = window.CrmCreateHandoff;
    [
        handoffApi?.HANDOFF_PARAM,
        handoffApi?.TOKEN_PARAM,
        handoffApi?.CONTEXT_PARAM,
        handoffApi?.ENTITY_PARAM,
        handoffApi?.RETURN_PARAM
    ].filter(Boolean).forEach(key => url.searchParams.delete(key));
    if (url.search === before) return;
    const previousState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    window.history.replaceState({ ...previousState, leadCreateDeepLinkConsumed: true }, '', `${url.pathname}${url.search}${url.hash}`);
}

async function loadLeadCreateCustomer(customerId) {
    const normalizedCustomerId = positiveLeadQueryId(customerId);
    if (!normalizedCustomerId) return null;

    const res = await apiFetch(`/api/customers/${normalizedCustomerId}`);
    if (!res) return null;
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(payload.error || '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u043a\u0430\u0440\u0442\u043a\u0443 \u043a\u043b\u0456\u0454\u043d\u0442\u0430');
    }
    return positiveLeadQueryId(payload.id) ? payload : null;
}

async function maybeOpenLeadCreateFromUrl() {
    const options = readLeadCreateDeepLinkOptions();
    if (!options) return false;
    clearLeadCreateUrlParams();

    let sourceCustomer = null;
    let sourceCustomerLoadFailed = false;
    if (options.sourceCustomerId) {
        try {
            sourceCustomer = await loadLeadCreateCustomer(options.sourceCustomerId);
            sourceCustomerLoadFailed = !sourceCustomer;
        } catch (err) {
            sourceCustomerLoadFailed = true;
            console.warn('Lead create customer prefill failed', err);
        }
    }

    openAddModal(options);
    if (sourceCustomer) {
        prefillLeadModalFromCustomer(sourceCustomer, { includeFallbackNote: false });
    } else if (sourceCustomerLoadFailed && typeof showNotification === 'function') {
        showNotification('\u041a\u0430\u0440\u0442\u043a\u0443 \u043a\u043b\u0456\u0454\u043d\u0442\u0430 \u043d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438. \u0412\u0432\u0435\u0434\u0456\u0442\u044c \u0456\u043c\u02bc\u044f \u0432\u0440\u0443\u0447\u043d\u0443; \u0437\u0432\u02bc\u044f\u0437\u043e\u043a \u0456\u0437 \u0432\u0438\u0431\u0440\u0430\u043d\u0438\u043c \u043a\u043b\u0456\u0454\u043d\u0442\u043e\u043c \u0431\u0443\u0434\u0435 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e.', 'warning');
    }
    return true;
}

function normalizeLeadCanonicalRoute() {
    if (!window.history || !window.location) return;
    const currentPath = window.location.pathname.replace(/\/$/, '').replace(/\.html$/i, '') || '/';
    if (currentPath !== '/leads') return;
    const url = new URL(window.location.href);
    url.pathname = '/sales-funnel';
    const previousState = window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {};
    window.history.replaceState({ ...previousState, leadsRoute: 'sales-funnel' }, '', url);
}

function applyLeadQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get('view');
    if (LEAD_VIEW_MODES.has(requestedView)) currentView = requestedView;
    const requestedStage = params.get('pipeline_stage') || params.get('stage') || '';
    currentPipelineStage = PIPELINE_STAGES.some(stage => stage.key === requestedStage) ? requestedStage : '';
    currentFilter = params.get('status') || currentFilter;
    const requestedQueue = params.get('lead_queue') || params.get('queue');
    if (LEAD_QUEUE_FILTERS[requestedQueue]) {
        currentLeadQueue = requestedQueue;
    } else if (params.has('lead_type')) {
        currentLeadQueue = leadQueueFromLeadType(params.get('lead_type'));
    } else {
        currentLeadQueue = DEFAULT_LEAD_QUEUE;
    }
    currentTypeFilter = leadTypeForCurrentQueue();
    currentDateFilter = params.get('event_date') || currentDateFilter;
    const search = document.getElementById('leadsSearch');
    if (search && params.get('search')) search.value = params.get('search');
    syncLeadQueueUi();

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

function syncLeadUrlState({ replace = true } = {}) {
    if (!window.history || !window.location) return;
    const url = new URL(window.location.href);
    const setOrDelete = (key, value) => {
        const clean = String(value || '').trim();
        if (clean) url.searchParams.set(key, clean);
        else url.searchParams.delete(key);
    };

    if (LEAD_VIEW_MODES.has(currentView) && currentView !== 'table') {
        url.searchParams.set('view', currentView);
    } else {
        url.searchParams.delete('view');
    }
    setOrDelete('status', currentFilter);
    if (currentLeadQueue !== DEFAULT_LEAD_QUEUE) {
        url.searchParams.set('lead_queue', currentLeadQueue);
    } else {
        url.searchParams.delete('lead_queue');
    }
    url.searchParams.delete('queue');
    url.searchParams.delete('lead_type');
    setOrDelete('event_date', currentDateFilter);
    setOrDelete('pipeline_stage', currentPipelineStage);
    url.searchParams.delete('stage');
    setOrDelete('search', document.getElementById('leadsSearch')?.value?.trim() || '');

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;
    const previousState = window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {};
    const state = { ...previousState, leadsView: currentView };
    if (replace) window.history.replaceState(state, '', url);
    else window.history.pushState(state, '', url);
}

function getLeadFilterSummary() {
    const search = document.getElementById('leadsSearch')?.value?.trim();
    const maysternyaMode = isMaysternyaLeadContext();
    return [
        currentLeadQueue !== DEFAULT_LEAD_QUEUE ? { label: maysternyaMode ? 'Черга заявок' : 'Черга лідів', value: leadQueueMeta().label } : null,
        currentPipelineStage ? { label: 'Етап воронки', value: leadPipelineStageLabel(currentPipelineStage) } : null,
        currentFilter ? { label: 'Статус', value: STATUS_MAP[currentFilter]?.label || currentFilter } : null,
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
        clearLabel: 'Скинути фільтри'
    });
    Explainability.setRegion('leadsExplainability', html);
}

function shouldLoadLeadCustomerFallback(search) {
    return String(search || '').trim().length >= 2;
}

function leadCustomerFallbackQueries(search) {
    const trimmed = String(search || '').trim().replace(/\s+/g, ' ');
    if (trimmed.length < 2) return [];
    const compact = trimmed.replace(/\s+/g, '');
    return Array.from(new Set([trimmed, compact].filter(query => query.length >= 2)));
}

async function loadLeadCustomerSearchFallback(search) {
    const matches = [];
    const seenIds = new Set();
    for (const query of leadCustomerFallbackQueries(search)) {
        if (matches.length >= LEAD_CUSTOMER_FALLBACK_LIMIT) break;
        try {
            const params = new URLSearchParams({ q: query });
            const res = await fetch(leadApiUrl(`/api/customers/search?${params}`), {
                headers: getHeaders(false)
            });
            if (!res || res.status === 401 || res.status === 403 || !res.ok) continue;
            const payload = await res.json().catch(() => []);
            const customers = Array.isArray(payload) ? payload : (Array.isArray(payload?.customers) ? payload.customers : []);
            for (const rawCustomer of customers) {
                const customer = normalizeLeadCustomerOption(rawCustomer);
                if (!customer || seenIds.has(customer.id)) continue;
                seenIds.add(customer.id);
                matches.push(customer);
                if (matches.length >= LEAD_CUSTOMER_FALLBACK_LIMIT) break;
            }
        } catch (err) {
            console.warn('Lead customer fallback search failed', err);
        }
    }
    return matches;
}

function leadCustomerFallbackChildrenText(customer = {}) {
    const children = Array.isArray(customer.children)
        ? customer.children.map(child => String(child?.name || child?.childName || child?.child_name || '').trim()).filter(Boolean)
        : [];
    if (children.length === 1) return children[0];
    if (children.length > 1) {
        const visible = children.slice(0, 3).join(', ');
        return children.length > 3 ? `${visible} +${children.length - 3}` : visible;
    }
    return customer.childName || '';
}

function leadCustomerInstagramValue(customer = {}) {
    const direct = String(customer.instagram || '').replace(/^@+/, '').trim();
    if (direct) return direct;
    const identities = Array.isArray(customer.socialIdentities) ? customer.socialIdentities : [];
    const instagram = identities.find(item => /instagram/i.test(String(item?.platform || item?.type || item?.channel || '')));
    return String(instagram?.value || instagram?.handle || instagram?.username || '').replace(/^@+/, '').trim();
}

function leadCustomerFallbackById(customerId) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return (leadCustomerSearchMatches || []).find(customer => Number(customer.id) === id) || null;
}

function renderLeadCustomerSearchFallback() {
    const search = document.getElementById('leadsSearch')?.value?.trim() || '';
    const matches = Array.isArray(leadCustomerSearchMatches) ? leadCustomerSearchMatches.slice(0, LEAD_CUSTOMER_FALLBACK_LIMIT) : [];
    if (!shouldLoadLeadCustomerFallback(search) || search !== leadCustomerSearchQuery || matches.length === 0) return '';
    const visitLabel = isMaysternyaLeadContext() ? 'сес.' : 'віз.';
    const rows = matches.map(customer => {
        const childText = isMaysternyaLeadContext() ? '' : leadCustomerFallbackChildrenText(customer);
        const instagram = leadCustomerInstagramValue(customer);
        const totalBookings = normalizeLeadCount(customer.totalBookings);
        const customerHref = leadCrmContextHref('/customers', { open: customer.id }, customer.businessContext || leadBusinessContext());
        const createLeadDisabled = isLeadBusinessReadOnly() ? ' disabled aria-disabled="true"' : '';
        const meta = [
            customer.phone || '',
            instagram ? '@' + instagram : '',
            childText ? `Діти: ${childText}` : '',
            totalBookings ? `${totalBookings} ${visitLabel}` : ''
        ].filter(Boolean).join(' · ');
        return `<div class="lead-customer-link-preview" data-lead-customer-fallback-id="${escapeHtml(customer.id)}">
            <strong>${escapeHtml(customer.name)}</strong>
            ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
            <div class="lead-customer-fallback-actions" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px">
                <a class="workspace-action" href="${escapeHtml(customerHref)}">
                    <span>Відкрити клієнта</span>
                </a>
                <button type="button" class="workspace-action primary" data-lead-write-action="true" data-lead-customer-create-lead="${escapeHtml(customer.id)}"${createLeadDisabled}>
                    <span>Створити лід</span>
                    <span class="workspace-action-note">без автозбереження</span>
                </button>
            </div>
        </div>`;
    }).join('');
    return `<div class="lead-customer-search-fallback" role="status" aria-live="polite" style="display:grid;gap:8px;max-width:640px;margin:16px auto 0;text-align:left">
        <div class="lead-customer-link-hint" style="margin:0">Ліда не знайдено, але є клієнт</div>
        ${rows}
    </div>`;
}

function resetLeadFilters() {
    currentFilter = '';
    currentLeadQueue = DEFAULT_LEAD_QUEUE;
    currentTypeFilter = leadTypeForCurrentQueue();
    currentDateFilter = '';
    currentPipelineStage = '';
    const search = document.getElementById('leadsSearch');
    if (search) search.value = '';
    syncLeadQueueUi();
    document.querySelectorAll('#filterBtns .filter-btn').forEach(btn => btn.classList.toggle('active', !btn.dataset.status));
    document.querySelectorAll('#dateBtns .filter-btn').forEach(btn => btn.classList.remove('active'));
    syncLeadUrlState();
    loadLeads();
}

function leadEmptyHtml() {
    const filters = getLeadFilterSummary();
    const queue = leadQueueMeta();
    const hasExtraFilters = filters.some(filter => !String(filter.label || '').startsWith('Черга'));
    const maysternyaMode = isMaysternyaLeadContext();
    const customerFallback = renderLeadCustomerSearchFallback();
    if (window.Explainability) {
        const emptyState = Explainability.renderEmptyState({
            icon: '🔎',
            title: hasExtraFilters
                ? `У черзі “${queue.label}” немає лідів за цими фільтрами`
                : queue.emptyTitle,
            message: hasExtraFilters
                ? `Черга “${queue.label}” відкрита, але поточний статус, етап, дата або пошук приховали всі записи.`
                : queue.emptyMessage,
            clearAction: filters.length ? 'leads' : '',
            clearLabel: maysternyaMode ? 'Скинути фільтри заявок' : 'Скинути фільтри лідів'
        });
        return customerFallback
            ? `<div class="lead-empty-with-fallback" style="width:100%;max-width:760px;margin:0 auto">${emptyState}${customerFallback}</div>`
            : emptyState;
    }
    const text = hasExtraFilters
        ? `У черзі “${queue.label}” немає лідів за цими фільтрами`
        : queue.emptyTitle;
    return customerFallback ? `${escapeHtml(text)}${customerFallback}` : text;
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

    const rows = leadsData.map(l => {
        const st = STATUS_MAP[l.status] || { label: l.status, emoji: '❓', cls: '' };
        const lt = LEAD_TYPE_MAP[l.lead_type] || LEAD_TYPE_MAP.quality;
        const src = leadSourceLabel(l);
        const date = l.created_at ? new Date(l.created_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : '—';
        const assigned = l.assigned_name || '—';
        const stage = PIPELINE_STAGES.find(s => s.key === (l.pipeline_stage || 'new'));
        const idleClass = getIdleColor(l);
        const maysternyaKind = isMaysternyaBotLead(l)
            ? 'Бот-хуки'
            : (l.quality_category || l.request_topic || l.topic || lt.label);

        const canConvert = ['new', 'contact', 'proposal'].includes(l.status);
        const convertBtn = canConvert ? `<button class="btn-convert" onclick="convertLead(${l.id})">${leadConversionActionLabel()}</button>` : '';

        return `<tr class="${idleClass}" data-lead-id="${l.id}">
            <td><strong>${escapeHtml(l.client_name || '—')}</strong>${l.instagram ? '<br><small style="color:var(--gray-400)">@' + escapeHtml(l.instagram) + '</small>' : ''}</td>
            <td>${escapeHtml(l.phone || '—')}</td>
            <td>${escapeHtml(src)}</td>
            <td><span class="lead-type-badge ${isMaysternyaBotLead(l) ? 'type-bot-hooks' : lt.cls}">${maysternyaMode ? escapeHtml(maysternyaKind) : `${lt.emoji} ${lt.label}`}</span></td>
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
    const pagination = leadPagination || {};
    const loadMoreRow = pagination.hasMore
        ? `<tr class="lead-pagination-row"><td colspan="8"><button type="button" class="btn-secondary" data-lead-load-more ${pagination.loadingMore ? 'disabled aria-disabled="true"' : ''}>${pagination.loadingMore ? 'Завантаження…' : `Завантажити ще (${leadsData.length} з ${pagination.total || '…'})`}</button></td></tr>`
        : '';
    tbody.innerHTML = rows + loadMoreRow;
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
    if (!canViewLeadRevenue()) return '—';
    if (value === null || value === undefined || value === '') return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString('uk-UA') + ' ₴';
}

function workspaceText(value, fallback = '—') {
    return escapeHtml(value || fallback);
}

function workspaceBookingIsBanquet(booking = {}) {
    const category = String(booking.category || booking.bookingCategory || '').toLowerCase();
    return category === 'banquet'
        || Boolean(booking.banquetGuests || booking.banquet_guests)
        || Boolean(booking.banquetAdults || booking.banquet_adults)
        || Boolean(booking.banquetTables || booking.banquet_tables)
        || Boolean(booking.banquetMenu || booking.banquet_menu);
}

function workspaceBookingDateTimeText(booking = {}) {
    const dateText = workspaceDate(booking.date);
    const timeText = booking.time || '';
    const arrivalText = workspaceBookingIsBanquet(booking) && timeText ? `Прихід гостей: ${timeText}` : timeText;
    return [dateText, arrivalText].filter(Boolean).join(' ');
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
        notes: item.notes || item.note || ''
    }));
    if (lead.childAge || lead.child_age) {
        return [{ name: '', age: lead.childAge || lead.child_age, birthday: '', notes: '' }];
    }
    return [];
}

function formatCelebrantsInput(celebrants = []) {
    return parseJsonArray(celebrants)
        .map(item => [
            item.name || item.childName || item.child_name || '',
            item.birthday || item.birthDate || item.birth_date || '',
            item.age ?? item.childAge ?? item.child_age ?? '',
            item.notes || item.note || ''
        ].filter(value => value !== null && value !== undefined && String(value).trim() !== '').join(' | '))
        .join('\n');
}

function parseCelebrantsInput(value) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const ageTokenPattern = /^(\d{1,3})(?:\s*(?:р\.?|рок(?:и|ів)?))?$/i;
    const agePhrasePattern = /\b(\d{1,3})\s*(?:р\.?|рок(?:и|ів)?)\b/i;
    return String(value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map(line => {
            const parts = (line.includes('|') ? line.split('|') : line.split(','))
                .map(part => part.trim())
                .filter(Boolean);
            const birthday = parts.find(part => datePattern.test(part)) || null;
            const explicitAgePart = parts.find(part => ageTokenPattern.test(part) && !datePattern.test(part));
            const ageMatch = explicitAgePart?.match(ageTokenPattern) || line.replace(/\d{4}-\d{2}-\d{2}/g, '').match(agePhrasePattern);
            const namePart = parts.find(part => !datePattern.test(part) && !ageTokenPattern.test(part));
            const name = parts.length > 1
                ? namePart
                : line
                    .replace(/\d{4}-\d{2}-\d{2}/g, '')
                    .replace(agePhrasePattern, '')
                    .trim();
            const notes = parts
                .filter(part => part !== namePart && part !== birthday && part !== explicitAgePart)
                .filter(part => !datePattern.test(part) && !ageTokenPattern.test(part))
                .join(', ');
            return {
                name: name || null,
                age: ageMatch ? parseInt(ageMatch[1], 10) : null,
                birthday,
                notes: notes || null,
                source: 'operator'
            };
        });
}

function emptyLeadCelebrant() {
    return { name: '', birthday: '', age: '', notes: '', source: 'operator' };
}

function normalizeCelebrantForEditor(item = {}) {
    if (!item || typeof item !== 'object') return emptyLeadCelebrant();
    const ageValue = item.age ?? item.childAge ?? item.child_age ?? '';
    return {
        name: String(item.name || item.childName || item.child_name || '').trim(),
        birthday: String(item.birthday || item.birthDate || item.birth_date || '').trim(),
        age: ageValue === null || ageValue === undefined ? '' : String(ageValue).trim(),
        notes: String(item.notes || item.note || '').trim(),
        source: item.source || 'operator'
    };
}

function cleanCelebrantsForPayload(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .map(normalizeCelebrantForEditor)
        .filter(item => item.name || item.birthday || item.age || item.notes)
        .slice(0, 20)
        .map(item => ({
            name: item.name || null,
            birthday: /^\d{4}-\d{2}-\d{2}$/.test(item.birthday) ? item.birthday : null,
            age: item.age === '' ? null : parseInt(item.age, 10),
            notes: item.notes || null,
            source: item.source || 'operator'
        }))
        .filter(item => item.name || item.birthday || Number.isFinite(item.age) || item.notes)
        .map(item => ({
            ...item,
            age: Number.isFinite(item.age) && item.age >= 0 && item.age <= 120 ? item.age : null
        }));
}

function celebrantsEditorRowsFromValue(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeCelebrantForEditor).filter(item => item.name || item.birthday || item.age || item.notes);
    }
    const parsedJson = parseJsonArray(value);
    if (parsedJson.length) {
        return parsedJson.map(normalizeCelebrantForEditor).filter(item => item.name || item.birthday || item.age || item.notes);
    }
    return parseCelebrantsInput(value).map(normalizeCelebrantForEditor).filter(item => item.name || item.birthday || item.age || item.notes);
}

function getCelebrantsRowsElement(targetId) {
    return document.getElementById(`${targetId}Rows`);
}

function getCelebrantsPreviewElement(targetId) {
    return document.getElementById(`${targetId}Preview`);
}

function readCelebrantsEditorRows(targetId) {
    const rowsEl = getCelebrantsRowsElement(targetId);
    if (!rowsEl) return [];
    return Array.from(rowsEl.querySelectorAll('[data-celebrant-row]')).map(row => normalizeCelebrantForEditor({
        name: row.querySelector('[data-celebrant-field="name"]')?.value || '',
        birthday: row.querySelector('[data-celebrant-field="birthday"]')?.value || '',
        age: row.querySelector('[data-celebrant-field="age"]')?.value || '',
        notes: row.querySelector('[data-celebrant-field="notes"]')?.value || ''
    }));
}

function getCelebrantsEditorState(targetId) {
    return JSON.stringify(cleanCelebrantsForPayload(readCelebrantsEditorRows(targetId)));
}

function renderCelebrantsPreview(targetId) {
    const preview = getCelebrantsPreviewElement(targetId);
    if (!preview) return;
    const count = cleanCelebrantsForPayload(readCelebrantsEditorRows(targetId)).length;
    preview.textContent = count ? `${count} дітей буде збережено` : '0 дітей буде збережено';
}

function syncCelebrantsMirror(targetId, options = {}) {
    const textarea = document.getElementById(targetId);
    const payload = cleanCelebrantsForPayload(readCelebrantsEditorRows(targetId));
    if (textarea) {
        textarea.value = formatCelebrantsInput(payload);
        if (options.markInitial) textarea.dataset.initialValue = JSON.stringify(payload);
    }
    renderCelebrantsPreview(targetId);
    return payload;
}

function renderCelebrantsEditor(targetId, rows = []) {
    const rowsEl = getCelebrantsRowsElement(targetId);
    if (!rowsEl) return;
    const editableRows = (Array.isArray(rows) && rows.length ? rows : [emptyLeadCelebrant()])
        .map(normalizeCelebrantForEditor);
    rowsEl.innerHTML = editableRows.map((item, index) => `
        <div class="lead-celebrant-row" data-celebrant-row data-index="${index}">
            <div class="lead-celebrant-field">
                <label>Ім'я дитини</label>
                <input type="text" data-celebrant-field="name" value="${escapeHtml(item.name)}" placeholder="Саша">
            </div>
            <div class="lead-celebrant-field">
                <label>ДН</label>
                <input type="date" data-celebrant-field="birthday" value="${escapeHtml(item.birthday)}">
            </div>
            <div class="lead-celebrant-field">
                <label>Вік</label>
                <input type="number" min="0" max="120" data-celebrant-field="age" value="${escapeHtml(item.age)}" placeholder="4">
            </div>
            <div class="lead-celebrant-field">
                <label>Нотатка</label>
                <input type="text" data-celebrant-field="notes" value="${escapeHtml(item.notes)}" placeholder="опційно">
            </div>
            <button type="button" class="lead-celebrant-remove" data-celebrants-action="remove" data-target="${escapeHtml(targetId)}" data-index="${index}" aria-label="Прибрати дитину">×</button>
        </div>
    `).join('');
    syncCelebrantsMirror(targetId);
}

function setCelebrantsEditorValue(targetId, value = [], options = {}) {
    const rows = celebrantsEditorRowsFromValue(value);
    renderCelebrantsEditor(targetId, rows);
    syncCelebrantsMirror(targetId, { markInitial: options.markInitial !== false });
}

function getCelebrantsPayload(targetId) {
    return syncCelebrantsMirror(targetId);
}

function isCelebrantsEditorDirty(targetId) {
    const textarea = document.getElementById(targetId);
    const initial = textarea?.dataset?.initialValue || '[]';
    return getCelebrantsEditorState(targetId) !== initial;
}

function bindCelebrantsEditors() {
    if (bindCelebrantsEditors.bound) return;
    bindCelebrantsEditors.bound = true;
    document.addEventListener('input', event => {
        if (!event.target?.matches?.('[data-celebrant-field]')) return;
        const editor = event.target.closest('[data-celebrants-editor]');
        const targetId = editor?.dataset?.celebrantsEditor;
        if (targetId) syncCelebrantsMirror(targetId);
    });
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-celebrants-action]');
        if (!button) return;
        const targetId = button.dataset.target;
        if (!targetId) return;
        const rows = readCelebrantsEditorRows(targetId);
        if (button.dataset.celebrantsAction === 'add') {
            rows.push(emptyLeadCelebrant());
            renderCelebrantsEditor(targetId, rows);
        } else if (button.dataset.celebrantsAction === 'remove') {
            const index = Number.parseInt(button.dataset.index, 10);
            const nextRows = rows.filter((_, i) => i !== index);
            renderCelebrantsEditor(targetId, nextRows.length ? nextRows : [emptyLeadCelebrant()]);
        }
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

function normalizeWorkspaceChild(item = {}) {
    const ageValue = item.ageSnapshot ?? item.age_snapshot ?? item.age ?? item.childAge ?? item.child_age ?? '';
    const birthdayValue = item.birthday || item.birthDate || item.birth_date || item.childBirthday || item.child_birthday || '';
    const birthday = birthdayValue instanceof Date
        ? birthdayValue.toISOString().slice(0, 10)
        : String(birthdayValue || '').trim().slice(0, 10);
    return {
        name: String(item.name || item.childName || item.child_name || '').trim(),
        birthday,
        age: ageValue === null || ageValue === undefined ? '' : String(ageValue).trim(),
        note: String(item.note || item.notes || '').trim()
    };
}

function workspaceChildAgeText(child = {}) {
    if (child.age === '' || child.age === null || child.age === undefined) return '';
    const numberValue = Number(child.age);
    return Number.isFinite(numberValue) && Number.isInteger(numberValue)
        ? `${numberValue} р.`
        : String(child.age).trim();
}

function workspaceCustomerChildRows(customer = {}, lead = {}) {
    const customerChildren = Array.isArray(customer?.children)
        ? customer.children.map(normalizeWorkspaceChild).filter(child => child.name || child.birthday || child.age || child.note)
        : [];
    if (customerChildren.length) return { source: 'customer.children', children: customerChildren };

    const leadChildren = normalizeLeadCelebrants(lead)
        .map(normalizeWorkspaceChild)
        .filter(child => child.name || child.birthday || child.age || child.note);
    if (leadChildren.length) return { source: 'lead.celebrants', children: leadChildren };

    const legacyChild = normalizeWorkspaceChild({
        name: customer?.childName || customer?.child_name,
        birthday: customer?.childBirthday || customer?.child_birthday
    });
    return legacyChild.name || legacyChild.birthday
        ? { source: 'customer.childName', children: [legacyChild] }
        : { source: 'none', children: [] };
}

function renderWorkspaceCustomerChildren(customer = {}, lead = {}) {
    const resolved = workspaceCustomerChildRows(customer, lead);
    if (!resolved.children.length) return workspaceText(null);
    return `
        <div class="workspace-child-list" role="list" data-child-source="${escapeHtml(resolved.source)}">
            ${resolved.children.map((child, index) => {
                const name = child.name || `#${index + 1}`;
                const age = workspaceChildAgeText(child);
                const birthday = child.birthday ? workspaceDate(child.birthday) : '—';
                const note = child.note || '—';
                return `
                    <div class="workspace-row workspace-child-row" role="listitem">
                        <div class="workspace-child-name">${escapeHtml(name)}</div>
                        <div class="workspace-child-facts">
                            <div class="workspace-child-fact">
                                <span>Вік</span>
                                <strong>${age ? escapeHtml(age) : '—'}</strong>
                            </div>
                            <div class="workspace-child-fact">
                                <span>ДН</span>
                                <strong>${escapeHtml(birthday)}</strong>
                            </div>
                            <div class="workspace-child-fact workspace-child-note">
                                <span>Нотатка</span>
                                <strong>${escapeHtml(note)}</strong>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function workspaceCleanNote(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

function workspaceNoteKey(value) {
    return workspaceCleanNote(value).replace(/\s+/g, ' ').toLowerCase();
}

function workspaceStripLeadAutoNoteBlock(value, lead = {}) {
    const text = workspaceCleanNote(value);
    const leadId = String(lead.id || '').trim();
    if (!text || !leadId) return text;
    const lines = text.split('\n');
    const markerPattern = new RegExp(`^\\s*(?:Лід|Lead)\\s*#${leadId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const start = lines.findIndex(line => markerPattern.test(line));
    if (start === -1) return text;
    let end = start + 1;
    while (end < lines.length && lines[end].trim()) end += 1;
    return [
        ...lines.slice(0, start),
        ...lines.slice(end + (end < lines.length ? 1 : 0))
    ].join('\n').trim();
}

function workspaceCustomerVisibleNotes(customer = {}, lead = {}) {
    const text = workspaceStripLeadAutoNoteBlock(customer?.notes, lead);
    const leadNote = workspaceCleanNote(lead?.notes);
    if (!text || !leadNote) return text;
    const leadNoteKeys = new Set([
        workspaceNoteKey(leadNote),
        workspaceNoteKey(`Нотатки ліда: ${leadNote}`),
        workspaceNoteKey(`Lead notes: ${leadNote}`)
    ]);
    return text
        .split('\n')
        .filter(line => !leadNoteKeys.has(workspaceNoteKey(line)))
        .join('\n')
        .trim();
}

function renderWorkspaceNoteText(value) {
    const text = workspaceCleanNote(value);
    return text ? `<div class="workspace-note-text">${escapeHtml(text)}</div>` : workspaceText(null);
}

function workspaceNoteRows(workspace = {}) {
    const lead = workspace.lead || {};
    const customer = workspace.customer || {};
    const rows = [];
    const seen = new Set();
    const add = (source, title, text) => {
        const clean = workspaceCleanNote(text);
        const key = workspaceNoteKey(clean);
        if (!clean || seen.has(key)) return;
        seen.add(key);
        rows.push({
            workspaceNote: true,
            source,
            title,
            text: clean
        });
    };
    add('lead.notes', 'Нотатки ліда', lead.notes);
    add('customer.notes', 'Нотатки клієнта', workspaceCustomerVisibleNotes(customer, lead));
    return rows;
}

function workspaceInteractionRows(workspace = {}) {
    const noteRows = workspaceNoteRows(workspace);
    const activityRows = [...(workspace.interactions || []), ...(workspace.communications || [])].slice(0, 8);
    return [...noteRows, ...activityRows].slice(0, 10);
}

function renderWorkspaceInteractionRow(item = {}) {
    if (item.workspaceNote) {
        return `
            <div class="workspace-row workspace-note-row" data-note-source="${escapeHtml(item.source)}">
                <div class="workspace-row-title">${workspaceText(item.title)}</div>
                <div class="workspace-row-meta workspace-note-source">${workspaceText(item.source)}</div>
                ${renderWorkspaceNoteText(item.text)}
            </div>
        `;
    }
    return `
        <div class="workspace-row">
            <div class="workspace-row-title">${workspaceText(item.summary || item.type || 'Взаємодія')}</div>
            <div class="workspace-row-meta">${workspaceDateTime(item.created_at)}${item.manager_name || item.created_by_name ? ' · ' + workspaceText(item.manager_name || item.created_by_name) : ''}</div>
            ${item.details ? `<div class="workspace-row-meta">${workspaceText(item.details)}</div>` : ''}
        </div>
    `;
}

function leadWorkspaceChildSourceOrder(workspace = {}) {
    const sourceOrder = workspace?.contract?.children?.sourceOrder;
    return Array.isArray(sourceOrder) && sourceOrder.length
        ? sourceOrder
        : [...LEAD_WORKSPACE_CHILD_SOURCE_ORDER];
}

function leadWorkspaceNotesContract(workspace = {}) {
    const notes = workspace?.contract?.notes;
    return notes && typeof notes === 'object'
        ? {
            mergePolicy: notes.mergePolicy || LEAD_WORKSPACE_NOTES_CONTRACT.mergePolicy,
            leadNotesPath: notes.leadNotesPath || LEAD_WORKSPACE_NOTES_CONTRACT.leadNotesPath,
            customerNotesPath: notes.customerNotesPath || LEAD_WORKSPACE_NOTES_CONTRACT.customerNotesPath,
            childNotePaths: Array.isArray(notes.childNotePaths) && notes.childNotePaths.length
                ? notes.childNotePaths
                : [...LEAD_WORKSPACE_NOTES_CONTRACT.childNotePaths]
        }
        : {
            ...LEAD_WORKSPACE_NOTES_CONTRACT,
            childNotePaths: [...LEAD_WORKSPACE_NOTES_CONTRACT.childNotePaths]
        };
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
        || lead.eventType
        || lead.eventId
        || lead.bookingId
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
                <dt>CRM event</dt><dd>${workspaceText(lead.eventType)}</dd>
                <dt>Event ID</dt><dd>${workspaceText(lead.eventId)}</dd>
                <dt>Booking ID</dt><dd>${workspaceText(lead.bookingId)}</dd>
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
    const childSourceOrder = leadWorkspaceChildSourceOrder(workspace);
    const notesContract = leadWorkspaceNotesContract(workspace);
    const customerVisibleNotes = workspaceCustomerVisibleNotes(customer, lead);
    const noteAndInteractionRows = workspaceInteractionRows(workspace);
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
                        ${workspaceBadge(maysternyaMode ? (isMaysternyaBotLead(lead) ? '🤖 Бот-хуки' : (lead.topic || lead.sessionType || leadSourceLabel(lead) || 'Заявка')) : `${type.emoji || ''} ${type.label || lead.leadType || 'Лід'}`)}
                        ${waitingConversation ? workspaceBadge(waitingReplyText(waitingConversation), 'waiting') : ''}
                        ${eventCue ? workspaceBadge(eventCue, eventCueClass) : ''}
                        ${urgency.overdueTasks ? workspaceBadge(`Прострочено задач: ${urgency.overdueTasks}`, 'urgent') : ''}
                    </div>
                </div>
                <div class="workspace-actions">
                    ${leadContactLinks(lead, workspace)}
                    <button type="button" class="workspace-btn" onclick="editLead(${lead.id})">${maysternyaMode ? 'Редагувати заявку' : 'Редагувати'}</button>
                    <button type="button" class="workspace-btn" onclick="openLeadCustomerCard(${lead.id})">${maysternyaMode ? 'Картка клієнта' : 'Картка'}</button>
                    <button type="button" class="workspace-btn" onclick="linkWorkspaceLeadCustomer(${lead.id})">${customer?.id ? 'Змінити клієнта' : 'Привʼязати клієнта'}</button>
                </div>
            </div>
        </section>

        ${renderManagerActionStrip(workspace)}

        <div class="workspace-grid" data-child-source-order="${escapeHtml(childSourceOrder.join('|'))}" data-notes-merge-policy="${escapeHtml(notesContract.mergePolicy)}">
            <section class="workspace-section">
                <h3>Клієнт</h3>
                ${customer ? `
                    <dl class="workspace-kv">
                        <dt>Ім'я</dt><dd>${workspaceText(customer.name)}</dd>
                        <dt>Телефон</dt><dd>${workspaceText(customer.phone)}</dd>
                        ${maysternyaMode ? '' : `<dt>Діти / іменинники</dt><dd>${renderWorkspaceCustomerChildren(customer, lead)}</dd>`}
                        <dt>${maysternyaMode ? 'Сесії' : 'Візити'}</dt><dd>${customer.totalBookings || 0} · ${workspaceMoney(customer.totalSpent)}</dd>
                        <dt>${maysternyaMode ? 'Остання сесія' : 'Останній'}</dt><dd>${workspaceDate(customer.lastVisit)}</dd>
                        ${customerVisibleNotes ? `<dt>Нотатки клієнта</dt><dd>${renderWorkspaceNoteText(customerVisibleNotes)}</dd>` : ''}
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
                    <dt>Джерело</dt><dd>${workspaceText(leadSourceLabel(lead))}</dd>
                    <dt>${maysternyaMode ? 'Бажана дата консультації' : 'Бажана дата'}</dt><dd>${workspaceDate(lead.eventDate)}</dd>
                    <dt>${maysternyaMode ? 'Консультація' : 'Програма'}</dt><dd>${workspaceText(lead.programName || lead.sessionType)}</dd>
                    ${maysternyaMode ? '' : `<dt>Іменинники</dt><dd>${renderCelebrantsValue(lead)}</dd>`}
                    <dt>${maysternyaMode ? 'Повідомлення' : 'Нотатки'}</dt><dd>${renderWorkspaceNoteText(maysternyaMode ? (lead.message || lead.notes) : lead.notes)}</dd>
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
                                <div class="workspace-row-meta">${escapeHtml(workspaceBookingDateTimeText(booking))} · ${workspaceText(booking.status)} · ${workspaceMoney(booking.price)}</div>
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
                ${workspaceList(noteAndInteractionRows, renderWorkspaceInteractionRow, 'Взаємодій і коментарів ще немає')}
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
    return `<button type="button" draggable="false" class="lead-type-select lead-type-select--kanban ${current.cls}" data-lead-type-select data-kanban-interactive="true" data-lead-id="${leadId}" aria-haspopup="menu" aria-expanded="false" aria-label="Якість ліда: ${escapeHtml(clientName)}" title="Змінити якість ліда">
        <span class="lead-type-select-dot" aria-hidden="true">${current.emoji}</span>
        <span class="lead-type-select-label">${escapeHtml(current.label)}</span>
        <span class="lead-type-select-caret" aria-hidden="true">▾</span>
    </button>`;
}

function renderLeadBookingConversionButton(lead = {}) {
    const leadId = Number(lead.id || 0);
    const clientName = lead.client_name || 'лід';
    return `<button type="button" draggable="false" class="kanban-action-btn kanban-booking-convert-btn" data-lead-booking-convert data-kanban-interactive="true" data-lead-id="${leadId}" aria-haspopup="menu" aria-expanded="false" aria-label="Створити бронь: ${escapeHtml(clientName)}" title="Створити бронь">📅</button>`;
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
    const kanbanLeads = leadsData;
    if (kanbanLeads.length === 0) {
        hideFunnelBar();
        kanbanWrap.innerHTML = `<div class="kanban-empty">${leadEmptyHtml()}</div>`;
        return;
    }

    const grouped = {};
    const salesGrouped = {};
    for (const s of PIPELINE_STAGES) grouped[s.key] = [];
    for (const s of PIPELINE_STAGES) salesGrouped[s.key] = [];
    let salesLeadCount = 0;
    for (const l of kanbanLeads) {
        const stage = l.pipeline_stage || 'new';
        if (!grouped[stage]) grouped[stage] = [];
        grouped[stage].push(l);
        if (isSalesMetricLead(l)) {
            if (!salesGrouped[stage]) salesGrouped[stage] = [];
            salesGrouped[stage].push(l);
            salesLeadCount++;
        }
    }

    const { funnelEl, slotEl } = ensureKanbanSummarySlot(kanbanWrap);
    if (funnelEl && slotEl) {
        if (salesLeadCount > 0) {
            funnelEl.innerHTML = renderFunnelBar(salesGrouped);
            funnelEl.style.display = '';
            slotEl.style.display = '';
        } else {
            funnelEl.innerHTML = '';
            funnelEl.style.display = 'none';
            slotEl.style.display = 'none';
        }
    }

    kanbanWrap.innerHTML = PIPELINE_STAGES.map(stage => {
        const leads = grouped[stage.key] || [];
        const pagination = leadKanbanPagination[stage.key] || { total: leads.length, hasMore: false, loadingMore: false };
        const total = Number(pagination.total || leads.length);
        const isEmpty = leads.length === 0;
        const isOverWip = total > WIP_LIMIT;

        // Sum of budget_approx for the column
        const totalSum = leads.reduce((sum, l) => sum + leadPotentialValue(l), 0);

        const cards = leads.map(l => {
            const idleClass = getIdleColor(l);
            const days = getDaysOnStage(l);
            const daysClass = days > 7 ? 'days-warn' : days > 3 ? 'days-mid' : '';
            const phone = l.phone || '';
            const phoneLabel = phone || '—';
            const phoneTel = phone.replace(/[^+\d]/g, '');

            const updatedAt = l.updated_at || l.updatedAt || '';

            return `<div class="kanban-card ${idleClass}" draggable="true" data-id="${l.id}" data-updated-at="${escapeHtml(updatedAt)}">
                <div class="kanban-card-top">
                    <div class="kanban-card-name">${escapeHtml(l.client_name || '—')}</div>
                    <span class="kanban-days ${daysClass}" title="На етапі">${formatDaysLabel(days)}</span>
                </div>
                <div class="kanban-card-meta">
                    <span class="kanban-card-meta-text" title="${escapeHtml(phoneLabel)}">${escapeHtml(phoneLabel)}</span>
                    ${renderLeadTypeSelect(l)}
                    ${leadOriginBadge(l) ? `<span class="lead-origin-chip ${isMaysternyaBotLead(l) ? 'lead-origin-chip--bot' : ''}">${escapeHtml(leadOriginBadge(l))}</span>` : ''}
                </div>
                ${l.event_date ? '<div class="kanban-card-date">📅 ' + new Date(l.event_date).toLocaleDateString('uk-UA') + '</div>' : ''}
                <div class="kanban-card-actions" data-kanban-actions onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()">
                    ${phoneTel ? `<a class="kanban-action-btn" href="tel:${escapeHtml(phoneTel)}" title="Зателефонувати">📞</a>
                    <a class="kanban-action-btn" href="https://t.me/${escapeHtml(phoneTel)}" target="_blank" title="Telegram">💬</a>` : ''}
                    ${renderLeadBookingConversionButton(l)}
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
                    <span class="kanban-count" style="background:${stage.color};color:#fff">${leads.length}${total > leads.length ? ` / ${total}` : ''}${wipWarning}</span>
            </div>
            ${totalSum > 0 ? `<div class="kanban-column-sum">${totalSum.toLocaleString('uk-UA')} ₴</div>` : ''}
                <div class="kanban-cards" data-stage="${stage.key}">
                    ${cards || '<div class="kanban-empty">—</div>'}
                </div>
                ${pagination.hasMore ? `<button type="button" class="btn-secondary kanban-load-more" data-lead-load-more data-lead-load-stage="${escapeHtml(stage.key)}" ${pagination.loadingMore ? 'disabled aria-disabled="true"' : ''}>${pagination.loadingMore ? 'Завантаження…' : `Завантажити ще (${leads.length} з ${total})`}</button>` : ''}
            </div>`;
    }).join('');

    bindKanbanLeadTypeTriggerControls(kanbanWrap);
    bindKanbanBookingConversionTriggerControls(kanbanWrap);
    setupKanbanDragDrop();
    syncLeadReadOnlyUi();
    syncLeadStageMovePendingUi();
}

function setupKanbanDragDrop() {
    const cards = document.querySelectorAll('.kanban-card[draggable]');
    const columns = document.querySelectorAll('.kanban-column');

    cards.forEach(card => {
        card.querySelectorAll('a, button, select, [data-kanban-actions]').forEach(control => {
            if (control.matches?.('[data-lead-type-select]')) return;
            if (control.matches?.('[data-lead-booking-convert]')) return;
            control.addEventListener('click', event => event.stopPropagation());
            control.addEventListener('pointerdown', event => event.stopPropagation());
        });
    });

    cards.forEach(card => {
        card.addEventListener('click', event => {
            if (isKanbanInteractiveTarget(event.target)) return;
            const leadId = Number(card.dataset.id || 0);
            if (leadId) openLeadWorkspace(leadId);
        });
        card.addEventListener('dragstart', e => {
            if (isKanbanInteractiveTarget(e.target)) {
                e.preventDefault();
                return;
            }
            const leadId = leadStageMoveId(card.dataset.id);
            if (isLeadStageMovePending(leadId)) {
                e.preventDefault();
                if (typeof showNotification === 'function') showNotification('Лід уже оновлюється. Дочекайтесь завершення.', 'info');
                return;
            }
            e.dataTransfer.setData('text/plain', card.dataset.id);
            e.dataTransfer.effectAllowed = 'move';
            kanbanDragState = {
                leadId,
                originStage: card.closest('.kanban-cards')?.dataset.stage || '',
                dropped: false
            };
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            clearKanbanDropStates();
            if (!kanbanDragState?.dropped) renderKanban();
            kanbanDragState = null;
            syncKanbanEmptyPlaceholders();
        });
    });

    columns.forEach(col => {
        const dropZone = col.querySelector('.kanban-cards');
        if (!dropZone) return;

        const setDropState = active => {
            col.classList.toggle('is-drop-target', active);
            dropZone.classList.toggle('drag-over', active);
        };

        col.addEventListener('dragenter', e => {
            e.preventDefault();
            setDropState(true);
        });
        col.addEventListener('dragover', e => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const draggingCard = document.querySelector('.kanban-card.dragging');
            if (draggingCard) {
                moveDraggingCardIntoKanbanColumn(dropZone, draggingCard, e.clientY);
            }
            setDropState(true);
        });
        col.addEventListener('dragleave', e => {
            if (!col.contains(e.relatedTarget)) setDropState(false);
        });
        col.addEventListener('drop', async e => {
            e.preventDefault();
            setDropState(false);
            const draggingCard = document.querySelector('.kanban-card.dragging');
            const leadId = e.dataTransfer.getData('text/plain') || draggingCard?.dataset.id;
            const newStage = dropZone.dataset.stage || col.dataset.stage;
            if (!leadId || !newStage) return;
            if (kanbanDragState) kanbanDragState.dropped = true;
            const orderedLeadIds = getKanbanOrderedLeadIds(dropZone);

            // If moving to 'lost', ask for reason
            if (newStage === 'lost') {
                loadLeads();
                showLostReasonModal(parseInt(leadId), newStage, {
                    updated_at: draggingCard?.dataset.updatedAt || leadUpdatedAtForStageMove(leadId)
                });
                return;
            }

            const saved = await updateLeadStage(parseInt(leadId), newStage, {
                updated_at: draggingCard?.dataset.updatedAt || leadUpdatedAtForStageMove(leadId),
                kanban_order: orderedLeadIds
            });
            if (!saved) renderKanban();
        });
    });
}

function clearKanbanDropStates() {
    document.querySelectorAll('.kanban-column.is-drop-target').forEach(col => {
        col.classList.remove('is-drop-target');
    });
    document.querySelectorAll('.kanban-cards.drag-over').forEach(col => {
        col.classList.remove('drag-over');
    });
}

function syncKanbanEmptyPlaceholders() {
    document.querySelectorAll('.kanban-cards').forEach(col => {
        const hasCards = Boolean(col.querySelector('.kanban-card'));
        col.querySelectorAll('.kanban-empty').forEach(empty => {
            empty.hidden = hasCards;
        });
    });
}

function getKanbanOrderedLeadIds(col) {
    return Array.from(col?.querySelectorAll?.('.kanban-card[data-id]') || [])
        .map(card => Number(card.dataset.id))
        .filter(id => Number.isInteger(id) && id > 0);
}

function leadUpdatedAtForStageMove(leadId) {
    const normalizedLeadId = leadStageMoveId(leadId);
    if (!normalizedLeadId) return '';
    if (Number(currentWorkspaceData?.lead?.id) === normalizedLeadId) {
        return currentWorkspaceData.lead.updatedAt || currentWorkspaceData.lead.updated_at || '';
    }
    const lead = leadsData.find(item => Number(item.id) === normalizedLeadId);
    if (lead?.updated_at || lead?.updatedAt) return lead.updated_at || lead.updatedAt;
    const card = document.querySelector(`.kanban-card[data-id="${normalizedLeadId}"]`);
    return card?.dataset?.updatedAt || '';
}

function moveDraggingCardIntoKanbanColumn(col, draggingCard, clientY) {
    const afterElement = getKanbanDragAfterElement(col, clientY);
    if (afterElement) {
        col.insertBefore(draggingCard, afterElement);
    } else {
        col.appendChild(draggingCard);
    }
    syncKanbanEmptyPlaceholders();
}

function getKanbanDragAfterElement(col, y) {
    return Array.from(col.querySelectorAll('.kanban-card[draggable]:not(.dragging)'))
        .reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

async function readLeadStageMovePayload(res) {
    const parsed = await res.json().catch(() => ({}));
    const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const requestId = payload.requestId || payload.request_id || res.headers?.get?.('x-request-id') || '';
    return requestId && !payload.requestId ? { ...payload, requestId } : payload;
}

function leadStageMoveFailureMessage(payload = {}) {
    if (payload.code === 'lead_version_conflict') {
        return 'Лід уже змінили в іншому місці. Оновлюю дошку.';
    }
    if (payload.retryable === true || payload.code === 'lead_write_locked') {
        return 'Лід зараз оновлюється. Спробуйте ще раз через кілька секунд.';
    }
    const message = payload.error || payload.message || 'Не вдалося змінити етап ліда';
    const requestId = payload.requestId || payload.request_id || '';
    return `${message}${requestId ? ` · код: ${requestId}` : ''}`;
}

function notifyLeadStageMoveFailure(payload = {}) {
    if (typeof showNotification !== 'function') return;
    const type = payload.code === 'lead_version_conflict' || payload.retryable === true || payload.code === 'lead_write_locked' ? 'warning' : 'error';
    showNotification(leadStageMoveFailureMessage(payload), type);
}

function isLeadVersionConflictPayload(payload = {}) {
    return payload.code === 'lead_version_conflict';
}

function hasLeadStageMoveWarning(payload = {}, code) {
    return Array.isArray(payload.warnings)
        && payload.warnings.some(warning => warning?.code === code);
}

function notifyLeadStageMoveWarnings(payload = {}) {
    if (typeof showNotification !== 'function') return;
    if (hasLeadStageMoveWarning(payload, 'kanban_order_not_saved')) {
        showNotification('Етап збережено, порядок оновиться після перезавантаження.', 'info');
    }
}

async function updateLeadStage(leadId, stage, extraFields = {}) {
    const normalizedLeadId = leadStageMoveId(leadId);
    if (!normalizedLeadId) return false;
    if (!guardLeadWrite('переміщати ліди між етапами')) return false;
    if (isLeadStageMovePending(normalizedLeadId)) {
        if (typeof showNotification === 'function') showNotification('Лід уже оновлюється. Дочекайтесь завершення.', 'info');
        return false;
    }
    setLeadStageMovePending(normalizedLeadId, true);
    try {
        const body = { pipeline_stage: stage, ...extraFields };
        if (!body.updated_at && !body.updatedAt && !body.lead_updated_at && !body.leadUpdatedAt && !body.version) {
            body.updated_at = leadUpdatedAtForStageMove(normalizedLeadId);
        }
        const res = await apiFetch(`/api/leads/${normalizedLeadId}/stage`, { method: 'PATCH', body: JSON.stringify(body) });
        if (!res) {
            notifyLeadStageMoveFailure();
            return false;
        }
        const data = await readLeadStageMovePayload(res);
        if (res.ok && data.success) {
            if (typeof showNotification === 'function') showNotification(`Етап змінено на: ${stage}`, 'success');
            notifyLeadStageMoveWarnings(data);
            if (data.customer?.id && currentWorkspaceData?.lead?.id === normalizedLeadId) {
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
            const openedCustomerCard = stage === 'deal'
                ? await offerDealCustomerCardFlow(normalizedLeadId, data.lead, data.customer, data.customerLinkMode)
                : false;
            if (!openedCustomerCard) {
                await loadLeads();
                if (workspaceLeadId === normalizedLeadId) openLeadWorkspace(normalizedLeadId, { pushState: false });
            }
            return true;
        }
        notifyLeadStageMoveFailure(data);
        if (isLeadVersionConflictPayload(data)) {
            await loadLeads();
            if (workspaceLeadId === normalizedLeadId) openLeadWorkspace(normalizedLeadId, { pushState: false });
        }
    } catch (e) {
        console.error('Update stage error', e);
        if (e?.message !== 'Unauthorized') {
            notifyLeadStageMoveFailure({ error: e?.message || 'Не вдалося змінити етап ліда' });
        }
    } finally {
        setLeadStageMovePending(normalizedLeadId, false);
    }
    return false;
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

function leadTypeNeedsReason(type) {
    return Object.prototype.hasOwnProperty.call(LEAD_TYPE_REASON_OPTIONS, type);
}

function buildLostReasonText(reason, notes) {
    const cleanReason = String(reason || '').trim();
    const cleanNotes = String(notes || '').trim();
    return cleanNotes ? `${cleanReason}: ${cleanNotes}` : cleanReason;
}

function resetLeadTypeReasonRequest(value = null) {
    const request = leadTypeReasonRequest;
    leadTypeReasonRequest = null;
    if (request?.resolve) request.resolve(value);
}

function populateLostReasonOptions(options = LOSS_REASONS) {
    const select = document.getElementById('lostReasonSelect');
    if (!select) return;
    select.innerHTML = [
        '<option value="">— оберіть причину —</option>',
        ...options.map(reason => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`)
    ].join('');
}

function updateLostReasonDetailsVisibility() {
    const overlay = document.getElementById('lostReasonModal');
    const group = document.getElementById('lostReasonNotesGroup');
    const notes = document.getElementById('lostReasonNotes');
    const select = document.getElementById('lostReasonSelect');
    if (!overlay || !group) return;

    const detailsMode = overlay.dataset.detailsMode || 'always';
    const shouldShow = detailsMode === 'always' || select?.value === 'Інше';
    group.hidden = !shouldShow;
    if (!shouldShow && notes) notes.value = '';
}

function openLostReasonSurface({
    leadId,
    stage = '',
    leadType = '',
    updatedAt = '',
    reasonMode = 'stage',
    title = 'Причина втрати',
    options = LOSS_REASONS,
    detailsMode = 'always'
} = {}) {
    const overlay = document.getElementById('lostReasonModal');
    if (!overlay) return false;
    overlay.dataset.leadId = leadId;
    overlay.dataset.stage = stage;
    overlay.dataset.leadType = leadType;
    overlay.dataset.reasonMode = reasonMode;
    overlay.dataset.detailsMode = detailsMode;
    if (updatedAt) overlay.dataset.leadUpdatedAt = updatedAt;
    else delete overlay.dataset.leadUpdatedAt;

    const titleEl = document.getElementById('lostReasonTitle');
    if (titleEl) titleEl.textContent = title;
    populateLostReasonOptions(options);
    const select = document.getElementById('lostReasonSelect');
    const notes = document.getElementById('lostReasonNotes');
    if (select) select.value = '';
    if (notes) notes.value = '';
    updateLostReasonDetailsVisibility();
    overlay.classList.add('active');
    rememberLeadSecondarySurface('lostReasonModal');
    setTimeout(() => select?.focus(), 0);
    return true;
}

function requestLeadTypeReason(leadId, type) {
    if (!leadTypeNeedsReason(type)) return Promise.resolve(undefined);
    if (!guardLeadWrite('змінювати тип ліда')) return Promise.resolve(null);
    resetLeadTypeReasonRequest(null);

    return new Promise(resolve => {
        leadTypeReasonRequest = { resolve, leadId: Number(leadId), leadType: type };
        const opened = openLostReasonSurface({
            leadId,
            leadType: type,
            reasonMode: 'lead_type',
            title: LEAD_TYPE_REASON_TITLES[type] || 'Причина зміни типу',
            options: LEAD_TYPE_REASON_OPTIONS[type],
            detailsMode: 'other'
        });
        if (!opened) resetLeadTypeReasonRequest(null);
    });
}

function resetLeadCreateStageReasonRequest(value = null) {
    const request = leadCreateStageReasonRequest;
    leadCreateStageReasonRequest = null;
    if (request?.resolve) request.resolve(value);
}

function requestLeadCreateStageLostReason() {
    if (!guardLeadWrite('створювати втрачений лід')) return Promise.resolve(null);
    resetLeadCreateStageReasonRequest(null);

    return new Promise(resolve => {
        leadCreateStageReasonRequest = { resolve };
        const opened = openLostReasonSurface({
            leadId: 0,
            stage: 'lost',
            reasonMode: 'create_stage',
            title: 'Причина втрати нового ліда',
            options: LOSS_REASONS,
            detailsMode: 'always'
        });
        if (!opened) resetLeadCreateStageReasonRequest(null);
    });
}

async function prepareCreateStagePayload(stage) {
    const normalizedStage = normalizeLeadCreateStage(stage, 'new');
    if (normalizedStage === 'deposit_received') {
        const confirmed = await confirmLeadUiAction('Створити лід одразу на етапі “Завдаток”? Це запустить чинні завдаткові hooks після збереження.', {
            type: 'warning',
            okText: 'Так, створити із завдатком',
            cancelText: 'Скасувати'
        });
        if (!confirmed) return null;
        return { pipeline_stage: normalizedStage };
    }
    if (normalizedStage === 'lost') {
        const lostReason = await requestLeadCreateStageLostReason();
        if (!lostReason) return null;
        return { pipeline_stage: normalizedStage, lost_reason: lostReason };
    }
    return { pipeline_stage: normalizedStage };
}
async function leadTypePatchOptions(leadId, type) {
    if (type === 'collaboration') {
        const collaborationTaskPayload = await requestCollaborationLeadTaskPayload(leadId);
        if (!collaborationTaskPayload) return null;
        return { collaborationTaskPayload };
    }
    if (!leadTypeNeedsReason(type)) return {};
    const lostReason = await requestLeadTypeReason(leadId, type);
    if (!lostReason) return null;
    return { lostReason };
}

async function persistLeadType(leadId, type, { reload = true, lostReason, collaborationTaskPayload = null } = {}) {
    if (!guardLeadWrite('змінювати тип ліда')) return false;
    const normalizedType = LEAD_TYPE_MAP[type] ? type : 'quality';
    if (normalizedType === 'collaboration') {
        if (!collaborationTaskPayload) {
            throw new Error('Заповніть задачу для співпраці перед зміною типу ліда');
        }
        const data = await createCollaborationLeadTask(leadId, collaborationTaskPayload);
        if (typeof showNotification === 'function') {
            showNotification(LEAD_TYPE_WORKFLOW_MESSAGES[normalizedType] || 'Співпрацю оформлено', 'success');
        }
        if (reload) await loadLeads();
        return data?.success !== false;
    }

    const body = { lead_type: normalizedType };
    if (lostReason !== undefined) body.lost_reason = lostReason;
    const res = await apiFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res) return false;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Не вдалося змінити тип ліда');
    }
    if (typeof showNotification === 'function') {
        showNotification(LEAD_TYPE_WORKFLOW_MESSAGES[normalizedType] || `Тип змінено: ${LEAD_TYPE_MAP[normalizedType]?.label}`, 'success');
    }
    if (reload) await loadLeads();
    return true;
}

async function setLeadType(leadId, type, event) {
    if (event) event.stopPropagation();
    if (!guardLeadWrite('змінювати тип ліда')) return;
    document.querySelectorAll('.type-menu-popup').forEach(el => el.remove());

    const lead = leadsData.find(l => Number(l.id) === Number(leadId));
    const previousType = LEAD_TYPE_MAP[lead?.lead_type] ? lead.lead_type : 'quality';
    const nextType = LEAD_TYPE_MAP[type] ? type : previousType;
    if (nextType === previousType) return;

    // If quality type from the full menu, show category picker.
    if (nextType === 'quality') {
        showQualityCategoryModal(leadId);
        return;
    }

    try {
        const patchOptions = await leadTypePatchOptions(leadId, nextType);
        if (!patchOptions) return;
        await persistLeadType(leadId, nextType, patchOptions);
    } catch (e) {
        console.error('Set lead type error', e);
        if (typeof showNotification === 'function') showNotification(e.message || 'Не вдалося змінити тип ліда', 'error');
    }
}

function closeKanbanLeadTypeMenus() {
    document.querySelectorAll('.lead-type-popover').forEach(el => el.remove());
    document.querySelectorAll('[data-lead-type-select][aria-expanded="true"]').forEach(control => {
        control.setAttribute('aria-expanded', 'false');
    });
    activeKanbanLeadTypePopover = null;
}

function closeDetachedLeadTypeMenus() {
    if (!activeKanbanLeadTypePopover && !document.querySelector('.lead-type-popover, .type-menu-popup')) return;
    closeKanbanLeadTypeMenus();
    document.querySelectorAll('.type-menu-popup').forEach(el => el.remove());
}

function closeKanbanBookingConversionMenus() {
    document.querySelectorAll('.lead-booking-conversion-popover').forEach(el => el.remove());
    document.querySelectorAll('[data-lead-booking-convert][aria-expanded="true"]').forEach(control => {
        control.setAttribute('aria-expanded', 'false');
    });
    activeKanbanBookingConversionPopover = null;
}

function closeDetachedBookingConversionMenus() {
    if (!activeKanbanBookingConversionPopover && !document.querySelector('.lead-booking-conversion-popover')) return;
    closeKanbanBookingConversionMenus();
}

function closestLeadTypeElement(target, selector) {
    const elementTarget = target?.nodeType === 1 ? target : target?.parentElement;
    return elementTarget?.closest?.(selector) || null;
}

function isKanbanInteractiveTarget(target) {
    return Boolean(closestLeadTypeElement(target, [
        'a',
        'button',
        'select',
        'textarea',
        'input',
        '[data-kanban-actions]',
        '[data-kanban-interactive="true"]',
        '[data-lead-type-select]',
        '[data-lead-booking-convert]',
        '.lead-type-popover',
        '.lead-booking-conversion-popover'
    ].join(',')));
}

function leadTypeTriggerFromEvent(event) {
    if (event?.currentTarget?.matches?.('[data-lead-type-select]')) {
        return event.currentTarget;
    }
    return closestLeadTypeElement(event?.target, '[data-lead-type-select]');
}

function handleKanbanLeadTypeTriggerEvent(event) {
    const trigger = leadTypeTriggerFromEvent(event);
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    if (trigger.disabled) return;

    const leadId = Number(trigger.dataset.leadId || 0);
    if (!leadId) return;
    const justOpened = kanbanLeadTypeTriggerOpenedLeadId === leadId
        && Date.now() - kanbanLeadTypeTriggerOpenedAt < 700;
    if (justOpened) return;

    kanbanLeadTypeTriggerOpenedAt = Date.now();
    kanbanLeadTypeTriggerOpenedLeadId = leadId;
    if (isLeadBusinessReadOnly()) {
        showKanbanLeadTypeReadOnlyNotice(trigger);
        return;
    }

    showKanbanLeadTypeMenu(leadId, event);
}

function bindKanbanLeadTypeTriggerControls(root = document) {
    root.querySelectorAll('[data-lead-type-select]').forEach(trigger => {
        if (trigger.dataset.leadTypeTriggerBound === 'true') return;
        trigger.dataset.leadTypeTriggerBound = 'true';
        trigger.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            handleKanbanLeadTypeTriggerEvent(event);
        });
    });
}

function leadBookingConversionTriggerFromEvent(event) {
    if (event?.currentTarget?.matches?.('[data-lead-booking-convert]')) {
        return event.currentTarget;
    }
    return closestLeadTypeElement(event?.target, '[data-lead-booking-convert]');
}

function handleKanbanBookingConversionTriggerEvent(event) {
    const trigger = leadBookingConversionTriggerFromEvent(event);
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    if (trigger.disabled) return;

    const leadId = Number(trigger.dataset.leadId || 0);
    if (!leadId) return;
    const justOpened = kanbanBookingConversionTriggerOpenedLeadId === leadId
        && Date.now() - kanbanBookingConversionTriggerOpenedAt < 700;
    if (justOpened) return;

    kanbanBookingConversionTriggerOpenedAt = Date.now();
    kanbanBookingConversionTriggerOpenedLeadId = leadId;
    if (!guardLeadWrite('створювати бронювання з ліда')) return;

    showKanbanBookingConversionMenu(leadId, event);
}

function bindKanbanBookingConversionTriggerControls(root = document) {
    root.querySelectorAll('[data-lead-booking-convert]').forEach(trigger => {
        if (trigger.dataset.leadBookingConversionTriggerBound === 'true') return;
        trigger.dataset.leadBookingConversionTriggerBound = 'true';
        trigger.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            handleKanbanBookingConversionTriggerEvent(event);
        });
    });
}

function bindKanbanBookingConversionMenuEvents() {
    if (kanbanBookingConversionMenuEventsBound) return;
    kanbanBookingConversionMenuEventsBound = true;

    const handleTriggerCapture = event => {
        const trigger = leadBookingConversionTriggerFromEvent(event);
        if (trigger) {
            handleKanbanBookingConversionTriggerEvent(event);
            return;
        }
        if (closestLeadTypeElement(event.target, '.lead-booking-conversion-popover')) {
            event.stopPropagation();
            return;
        }
    };

    document.addEventListener('pointerdown', handleTriggerCapture, true);
    document.addEventListener('mousedown', handleTriggerCapture, true);
    document.addEventListener('touchstart', handleTriggerCapture, true);

    document.addEventListener('click', event => {
        const option = closestLeadTypeElement(event.target, '[data-lead-booking-conversion-option]');
        if (option) {
            event.preventDefault();
            event.stopPropagation();
            const leadId = Number(option.dataset.leadId || 0);
            updateLeadBookingConversionFromKanban(leadId, option.dataset.bookingMode || '', event);
            return;
        }

        const trigger = closestLeadTypeElement(event.target, '[data-lead-booking-convert]');
        if (trigger) {
            handleKanbanBookingConversionTriggerEvent(event);
            return;
        }

        if (!closestLeadTypeElement(event.target, '.lead-booking-conversion-popover')) {
            closeKanbanBookingConversionMenus();
        }
    }, true);

    document.addEventListener('scroll', event => {
        if (closestLeadTypeElement(event.target, '.lead-booking-conversion-popover')) return;
        closeDetachedBookingConversionMenus();
    }, true);

    window.addEventListener('resize', closeDetachedBookingConversionMenus);
}

function showKanbanBookingConversionMenu(leadId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const trigger = leadBookingConversionTriggerFromEvent(event)
        || document.querySelector(`[data-lead-booking-convert][data-lead-id="${Number(leadId)}"]`);
    if (!trigger) return;
    if (!guardLeadWrite('створювати бронювання з ліда')) return;

    const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
    closeKanbanLeadTypeMenus();
    closeKanbanBookingConversionMenus();
    if (wasOpen) return;

    trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'lead-booking-conversion-popover';
    menu.setAttribute('role', 'menu');
    menu.dataset.leadId = String(leadId);
    menu.style.top = `${Math.round(rect.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - 256)))}px`;
    menu.innerHTML = LEAD_BOOKING_CONVERSION_MENU_ITEMS.map(item => `<button type="button" class="lead-booking-conversion-item" role="menuitem" data-lead-booking-conversion-option="true" data-lead-id="${Number(leadId)}" data-booking-mode="${escapeHtml(item.mode)}">
        <span class="lead-booking-conversion-icon" aria-hidden="true">${item.icon}</span>
        <span class="lead-booking-conversion-copy">
            <span class="lead-booking-conversion-label">${escapeHtml(item.label)}</span>
            <span class="lead-booking-conversion-description">${escapeHtml(item.description)}</span>
        </span>
    </button>`).join('');
    document.body.appendChild(menu);
    activeKanbanBookingConversionPopover = { leadId: Number(leadId), trigger, menu };
}

async function updateLeadBookingConversionFromKanban(leadId, bookingMode, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    closeKanbanBookingConversionMenus();
    if (!leadBookingConversionModeConfig(bookingMode)) return false;
    if (!guardLeadWrite('створювати бронювання з ліда')) return false;
    return convertLeadToBookingMode(leadId, bookingMode);
}

function showKanbanLeadTypeReadOnlyNotice(trigger) {
    closeKanbanLeadTypeMenus();
    const scope = leadBusinessScope();
    const message = leadReadOnlyMessage('змінювати якість ліда');
    if (typeof showNotification === 'function') showNotification(message, 'warning');
    if (!trigger) return;

    trigger.setAttribute('aria-expanded', 'true');
    trigger.title = message;
    trigger.classList.add('lead-type-select--blocked-pulse');
    setTimeout(() => trigger.classList.remove('lead-type-select--blocked-pulse'), 700);

    const rect = trigger.getBoundingClientRect();
    const notice = document.createElement('div');
    notice.className = 'lead-type-popover lead-type-popover--notice';
    notice.setAttribute('role', 'status');
    notice.dataset.leadTypeReadonlyNotice = 'true';
    notice.style.top = `${Math.round(rect.bottom + 8)}px`;
    notice.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - 280)))}px`;
    const modeLabel = scope?.mode === 'all'
        ? 'увімкнений огляд усіх бізнесів'
        : 'увімкнений огляд кількох бізнесів';
    notice.innerHTML = `<div class="lead-type-popover-notice-title">Тільки перегляд</div>
        <div class="lead-type-popover-notice-text">${escapeHtml(message)}</div>
        <div class="lead-type-popover-notice-meta">${escapeHtml(modeLabel)}. Оберіть один бізнес у перемикачі, щоб змінити якість.</div>`;
    document.body.appendChild(notice);

    setTimeout(() => {
        if (notice.isConnected) notice.remove();
        if (trigger.getAttribute('aria-expanded') === 'true') {
            trigger.setAttribute('aria-expanded', 'false');
        }
    }, 3600);
}

function bindKanbanLeadTypeMenuEvents() {
    if (kanbanLeadTypeMenuEventsBound) return;
    kanbanLeadTypeMenuEventsBound = true;

    const handleTriggerCapture = event => {
        const trigger = leadTypeTriggerFromEvent(event);
        if (trigger) {
            handleKanbanLeadTypeTriggerEvent(event);
            return;
        }
        if (closestLeadTypeElement(event.target, '.lead-type-popover')) {
            event.stopPropagation();
            return;
        }
    };

    document.addEventListener('pointerdown', handleTriggerCapture, true);
    document.addEventListener('mousedown', handleTriggerCapture, true);
    document.addEventListener('touchstart', handleTriggerCapture, true);

    document.addEventListener('click', event => {
        const option = closestLeadTypeElement(event.target, '[data-lead-type-option]');
        if (option) {
            event.preventDefault();
            event.stopPropagation();
            const leadId = Number(option.dataset.leadId || 0);
            updateLeadTypeFromKanbanSelect(leadId, option.dataset.leadType || '', event);
            return;
        }

        const trigger = closestLeadTypeElement(event.target, '[data-lead-type-select]');
        if (trigger) {
            handleKanbanLeadTypeTriggerEvent(event);
            return;
        }

        if (!closestLeadTypeElement(event.target, '.lead-type-popover')) {
            closeKanbanLeadTypeMenus();
        }
    }, true);

    document.addEventListener('scroll', event => {
        if (closestLeadTypeElement(event.target, '.lead-type-popover')) return;
        closeDetachedLeadTypeMenus();
    }, true);

    window.addEventListener('resize', closeDetachedLeadTypeMenus);
}

function showKanbanLeadTypeMenu(leadId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const trigger = leadTypeTriggerFromEvent(event)
        || document.querySelector(`[data-lead-type-select][data-lead-id="${Number(leadId)}"]`);
    if (isLeadBusinessReadOnly()) {
        showKanbanLeadTypeReadOnlyNotice(trigger);
        return;
    }
    if (!guardLeadWrite('змінювати тип ліда')) return;

    const lead = leadsData.find(l => Number(l.id) === Number(leadId));
    const currentType = LEAD_TYPE_MAP[lead?.lead_type] ? lead.lead_type : 'quality';
    const wasOpen = trigger?.getAttribute('aria-expanded') === 'true';
    closeKanbanBookingConversionMenus();
    closeKanbanLeadTypeMenus();
    if (wasOpen || !trigger) return;

    trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'lead-type-popover';
    menu.setAttribute('role', 'menu');
    menu.dataset.leadId = String(leadId);
    menu.style.top = `${Math.round(rect.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - 220)))}px`;
    menu.innerHTML = Object.entries(LEAD_TYPE_MAP).map(([key, meta]) => {
        const selected = key === currentType ? ' is-selected' : '';
        return `<button type="button" class="lead-type-popover-item ${meta.cls}${selected}" role="menuitemradio" aria-checked="${key === currentType ? 'true' : 'false'}" data-lead-type-option="true" data-lead-id="${Number(leadId)}" data-lead-type="${escapeHtml(key)}">
            <span class="lead-type-popover-dot" aria-hidden="true">${meta.emoji}</span>
            <span class="lead-type-popover-label">${escapeHtml(meta.label)}</span>
        </button>`;
    }).join('');
    document.body.appendChild(menu);
    activeKanbanLeadTypePopover = { leadId: Number(leadId), trigger, menu };
}

async function updateLeadTypeFromKanbanSelect(leadId, type, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    closeKanbanLeadTypeMenus();
    const select = document.querySelector(`[data-lead-type-select][data-lead-id="${Number(leadId)}"]`);
    const lead = leadsData.find(l => Number(l.id) === Number(leadId));
    const previousType = LEAD_TYPE_MAP[lead?.lead_type] ? lead.lead_type : 'quality';
    const nextType = LEAD_TYPE_MAP[type] ? type : previousType;
    if (nextType === previousType) return;
    if (!guardLeadWrite('змінювати тип ліда')) {
        return;
    }
    if (nextType === 'quality') {
        showQualityCategoryModal(leadId);
        return;
    }
    const patchOptions = await leadTypePatchOptions(leadId, nextType);
    if (!patchOptions) return;
    if (select) {
        select.disabled = true;
        select.classList.add('is-saving');
    }
    try {
        const saved = await persistLeadType(leadId, nextType, { reload: false, ...patchOptions });
        if (!saved) {
            return;
        }
        if (lead) lead.lead_type = nextType;
        await loadLeads();
    } catch (e) {
        console.error('Kanban lead type select error', e);
        if (typeof showNotification === 'function') showNotification(e.message || 'Не вдалося змінити тип ліда', 'error');
    } finally {
        if (select) {
            select.disabled = false;
            select.classList.remove('is-saving');
        }
    }
}

function showQualityCategoryModal(leadId, options = {}) {
    if (!guardLeadWrite('змінювати тип ліда')) return;
    const overlay = document.getElementById('qualityCategoryModal');
    if (!overlay) return;
    overlay.dataset.leadId = leadId;
    overlay.dataset.openCustomerCard = options.openCustomerCard ? 'true' : 'false';
    overlay.classList.add('active');
}

function closeQualityCategoryModal() {
    const overlay = document.getElementById('qualityCategoryModal');
    if (!overlay) return;
    overlay.classList.remove('active');
    delete overlay.dataset.openCustomerCard;
}

function openLeadWorkflowInfoModal() {
    const overlay = document.getElementById('leadWorkflowInfoModal');
    if (!overlay) return;
    overlay.classList.add('active');
}

function closeLeadWorkflowInfoModal() {
    const overlay = document.getElementById('leadWorkflowInfoModal');
    if (!overlay) return;
    overlay.classList.remove('active');
}

function bindLeadWorkflowInfoButton() {
    const button = document.getElementById('leadWorkflowInfoBtn');
    if (!button || button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', openLeadWorkflowInfoModal);
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

async function closeLostReasonModal(force = false) {
    const overlay = document.getElementById('lostReasonModal');
    const reasonMode = overlay?.dataset.reasonMode || '';
    const closed = await closeLeadSecondaryModal('lostReasonModal', force);
    if (closed && reasonMode === 'lead_type') resetLeadTypeReasonRequest(null);
    if (closed && reasonMode === 'create_stage') resetLeadCreateStageReasonRequest(null);
    return closed;
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
        'ccCelebrants',
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
    const openCustomerCardAfterSave = overlay.dataset.openCustomerCard === 'true';
    const lead = leadsData.find(l => Number(l.id) === Number(leadId));
    const body = { lead_type: 'quality', quality_category: category };
    if (lead && !isActiveKanbanLead(lead)) {
        body.pipeline_stage = 'new';
        body.lost_reason = null;
    }
    closeQualityCategoryModal();

    try {
        await apiFetch(`/api/leads/${leadId}`, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
        if (typeof showNotification === 'function') showNotification(`Якісний лід: ${QUALITY_CATEGORIES[category] || category}`, 'success');
        await loadLeads();
        if (openCustomerCardAfterSave) await openLeadCustomerCard(leadId);
        else if (workspaceLeadId === leadId) openLeadWorkspace(leadId, { pushState: false });
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
    setCelebrantsEditorValue('ccCelebrants', normalizeLeadCelebrants(lead || {}), { markInitial: true });
    const budgetInput = document.getElementById('ccBudget');
    if (budgetInput) budgetInput.value = '';
    syncLeadRevenueUi();
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
            if (canViewLeadRevenue() && c.budget_approx && budgetInput) budgetInput.value = c.budget_approx;
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
    const ccCelebrants = getCelebrantsPayload('ccCelebrants');
    const ccCelebrantsDirty = isCelebrantsEditorDirty('ccCelebrants');

    const body = {
        event_type: document.getElementById('ccEventType')?.value || null,
        event_date: document.getElementById('ccEventDate')?.value || null,
        guest_count: parseInt(document.getElementById('ccGuestCount')?.value) || null,
        children_count: parseInt(document.getElementById('ccChildrenCount')?.value) || null,
        celebrants: ccCelebrants,
        how_found: document.getElementById('ccHowFound')?.value || null,
        email: document.getElementById('ccEmail')?.value || null,
        channel: document.getElementById('ccChannel')?.value || null,
        notes: document.getElementById('ccNotes')?.value || null
    };
    if (canViewLeadRevenue()) body.budget_approx = parseInt(document.getElementById('ccBudget')?.value) || null;
    if (!body.children_count && body.celebrants.length) body.children_count = body.celebrants.length;

    // Also update lead name/phone if changed
    const name = document.getElementById('ccName')?.value.trim();
    const phone = document.getElementById('ccPhone')?.value.trim();
    if (name || phone || body.event_date || body.children_count || ccCelebrantsDirty) {
        try {
            const leadBody = {};
            if (name) leadBody.client_name = name;
            if (phone) leadBody.phone = phone;
            if (body.event_date) leadBody.event_date = body.event_date;
            if (body.children_count) leadBody.children_count = body.children_count;
            if (ccCelebrantsDirty) leadBody.celebrants = body.celebrants || [];
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
function showLostReasonModal(leadId, stage, options = {}) {
    if (!guardLeadWrite('закривати ліди')) return;
    resetLeadTypeReasonRequest(null);
    openLostReasonSurface({
        leadId,
        stage,
        updatedAt: options.updated_at || options.updatedAt || leadUpdatedAtForStageMove(leadId),
        reasonMode: 'stage',
        title: 'Причина втрати',
        options: LOSS_REASONS,
        detailsMode: 'always'
    });
}

async function saveLostReason() {
    if (!guardLeadWrite('закривати ліди')) return;
    const overlay = document.getElementById('lostReasonModal');
    const leadId = parseInt(overlay.dataset.leadId);
    const reason = document.getElementById('lostReasonSelect')?.value;
    const notes = document.getElementById('lostReasonNotes')?.value;
    const lostReason = buildLostReasonText(reason, notes);
    if (!lostReason) {
        if (typeof showNotification === 'function') showNotification('Оберіть причину', 'warning');
        document.getElementById('lostReasonSelect')?.focus();
        return;
    }

    if (overlay.dataset.reasonMode === 'lead_type') {
        const request = leadTypeReasonRequest;
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.markClean(overlay);
        await closeLeadSecondaryModal('lostReasonModal', true);
        leadTypeReasonRequest = null;
        if (request?.resolve) request.resolve(lostReason);
        return;
    }
    if (overlay.dataset.reasonMode === 'create_stage') {
        const request = leadCreateStageReasonRequest;
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.markClean(overlay);
        await closeLeadSecondaryModal('lostReasonModal', true);
        leadCreateStageReasonRequest = null;
        if (request?.resolve) request.resolve(lostReason);
        return;
    }

    await updateLeadStage(leadId, 'lost', {
        updated_at: overlay.dataset.leadUpdatedAt || leadUpdatedAtForStageMove(leadId),
        lost_reason: lostReason,
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
            currentView = LEAD_VIEW_MODES.has(btn.dataset.view) ? btn.dataset.view : 'table';
            syncLeadUrlState();
            loadLeads();
        });
    });

    document.querySelectorAll('[data-lead-queue]').forEach(btn => {
        btn.addEventListener('click', () => {
            setLeadQueue(btn.dataset.leadQueue || DEFAULT_LEAD_QUEUE);
        });
    });

    // Filter buttons
    document.querySelectorAll('#filterBtns .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#filterBtns .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.status;
            currentPipelineStage = '';
            syncLeadUrlState();
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
            syncLeadUrlState();
            loadLeads();
        });
    });

    // Search
    let searchTimeout;
    const searchInput = document.getElementById('leadsSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                syncLeadUrlState();
                loadLeads();
            }, 300);
        });
    }
    document.addEventListener('click', (e) => {
        const clear = e.target.closest('[data-explain-clear="leads"]');
        if (!clear) return;
        e.preventDefault();
        resetLeadFilters();
    });
    document.addEventListener('click', (e) => {
        const createFromCustomer = e.target.closest('[data-lead-customer-create-lead]');
        if (!createFromCustomer) return;
        e.preventDefault();
        openLeadFromCustomerFallback(createFromCustomer.dataset.leadCustomerCreateLead);
    });
    document.addEventListener('click', (e) => {
        const retry = e.target.closest('[data-lead-retry]');
        if (retry) {
            e.preventDefault();
            loadLeads();
            return;
        }
        const loadMore = e.target.closest('[data-lead-load-more]');
        if (!loadMore || loadMore.disabled) return;
        e.preventDefault();
        loadMoreLeads({ stage: loadMore.dataset.leadLoadStage || '' });
    });

    // Add lead button
    const addBtn = document.getElementById('addLeadBtn');
    if (addBtn) addBtn.addEventListener('click', openAddModal);
    bindLeadWorkflowInfoButton();
    bindLeadModalButton('leadModalCancel', closeLeadModal);
    bindLeadModalButton('leadModalSave', saveLead);
    bindCelebrantsEditors();
    const leadEventDate = document.getElementById('leadEventDate');
    leadEventDate?.addEventListener('input', () => syncLeadEventDetailsVisibility({ clearWhenHidden: true }));
    leadEventDate?.addEventListener('change', () => syncLeadEventDetailsVisibility({ clearWhenHidden: true }));
    ['leadChildrenCount', 'leadAdultsCount'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', syncLeadGuestsTotal);
    });
    document.getElementById('lostReasonSelect')?.addEventListener('change', updateLostReasonDetailsVisibility);
    document.getElementById('leadPipelineStage')?.addEventListener('change', syncLeadStageCreateHint);

    // Close modals on overlay click
    document.querySelectorAll('.lead-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                if (overlay.id === 'leadModal') closeLeadModal(false);
                else if (overlay.id === 'customerCardModal') closeCustomerCardModal(false);
                else if (overlay.id === 'qualityCategoryModal') closeQualityCategoryModal();
                else if (overlay.id === 'lostReasonModal') closeLostReasonModal(false);
                else if (overlay.id === 'addMailingModal') closeAddMailingModal(false);
                else if (overlay.id === 'leadWorkflowInfoModal') closeLeadWorkflowInfoModal();
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
        const leadWorkflowInfoModal = document.getElementById('leadWorkflowInfoModal');
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
            return;
        }
        if (leadWorkflowInfoModal?.classList.contains('active')) {
            e.preventDefault();
            closeLeadWorkflowInfoModal();
        }
    });
}

function syncLeadStageCreateHint() {
    const modal = document.getElementById('leadModal');
    const hint = document.getElementById('leadStageHint');
    const select = document.getElementById('leadPipelineStage');
    if (!hint || !select) return;
    const isCreate = !document.getElementById('leadEditId')?.value;
    const locked = modal?.dataset.stageLocked === 'true';
    const stage = normalizeLeadCreateStage(select.value, 'new');
    hint.classList.toggle('is-locked', locked);
    if (locked && modal?.dataset.origin === LEAD_BOOKING_CREATE_ORIGIN) {
        hint.hidden = false;
        hint.textContent = 'Створення з бронювання: етап зафіксовано як “Угода”, щоб бронювання отримало готовий lead/customer handoff.';
        return;
    }
    if (isCreate && stage === 'deposit_received') {
        hint.hidden = false;
        hint.textContent = 'Етап “Завдаток” запустить завдаткові hooks після створення. Перед збереженням буде підтвердження.';
        return;
    }
    if (isCreate && stage === 'lost') {
        hint.hidden = false;
        hint.textContent = 'Для етапу “Втрачено” потрібно буде вказати причину втрати перед збереженням.';
        return;
    }
    hint.hidden = true;
    hint.textContent = '';
}

function configureLeadStageControls({ editing = false, stage = 'new', leadType = 'quality', locked = false, origin = '' } = {}) {
    const stageGroup = document.getElementById('leadStageGroup');
    const typeGroup = document.getElementById('leadTypeGroup');
    const stageEl = document.getElementById('leadPipelineStage');
    const typeEl = document.getElementById('leadLeadType');
    const normalizedStage = normalizeLeadCreateStage(stage, 'new');
    if (stageGroup) stageGroup.style.display = '';
    if (typeGroup) typeGroup.style.display = editing ? '' : 'none';
    if (stageEl) {
        stageEl.value = normalizedStage;
        stageEl.disabled = Boolean(locked);
        stageEl.setAttribute('aria-disabled', locked ? 'true' : 'false');
    }
    if (typeEl) {
        typeEl.value = LEAD_TYPE_MAP[leadType] ? leadType : 'quality';
        typeEl.disabled = !editing;
    }
    const modal = document.getElementById('leadModal');
    if (modal) {
        modal.dataset.origin = origin || '';
        modal.dataset.createStage = normalizedStage;
        modal.dataset.stageLocked = locked ? 'true' : 'false';
    }
    syncLeadStageCreateHint();
}

function resetLeadCreateHandoffState() {
    activeLeadCreateHandoffRequest = null;
    const modal = document.getElementById('leadModal');
    if (!modal) return;
    delete modal.dataset.sourceCustomerId;
    delete modal.dataset.origin;
    delete modal.dataset.createStage;
    delete modal.dataset.stageLocked;
}

function openAddModal(options = {}) {
    if (!guardLeadWrite('створювати ліди')) return;
    const fromBooking = options.origin === LEAD_BOOKING_CREATE_ORIGIN;
    const createStage = fromBooking ? 'deal' : normalizeLeadCreateStage(options.createStage, 'new');
    const sourceCustomerId = positiveLeadQueryId(options.sourceCustomerId);
    activeLeadCreateHandoffRequest = options.handoffRequest || null;

    document.getElementById('leadModalTitle').textContent = isMaysternyaLeadContext() ? 'Нова заявка' : 'Новий лід';
    document.getElementById('leadEditId').value = '';
    document.getElementById('leadName').value = '';
    document.getElementById('leadPhone').value = '';
    document.getElementById('leadInstagram').value = '';
    document.getElementById('leadSource').value = '';
    document.getElementById('leadEventDate').value = '';
    document.getElementById('leadChildrenCount').value = '';
    document.getElementById('leadAdultsCount').value = '';
    setCelebrantsEditorValue('leadCelebrants', [], { markInitial: true });
    document.getElementById('leadNotes').value = '';
    document.getElementById('leadAssignedTo').value = '';
    applyDefaultLeadAssignee({ force: true });
    syncLeadModalBusinessFields();
    syncLeadEventDetailsVisibility({ clearWhenHidden: true });
    configureLeadStageControls({
        editing: false,
        stage: createStage,
        leadType: 'quality',
        locked: Boolean(options.lockStage || fromBooking),
        origin: options.origin || ''
    });

    const modal = document.getElementById('leadModal');
    if (modal) {
        delete modal.dataset.sourceCustomerId;
        if (sourceCustomerId) modal.dataset.sourceCustomerId = String(sourceCustomerId);
    }
    modalInitialState = getModalState();
    modal?.classList.add('active');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
}
function customerFallbackLeadNote(customer = {}) {
    const parts = [
        `Клієнт у базі #${customer.id}: ${customer.name || 'без імені'}.`,
        'Лід відкрито вручну з клієнтської картки; запис ще не створено.'
    ];
    return parts.join('\n');
}

function prefillLeadModalFromCustomer(customer = {}, options = {}) {
    const instagram = leadCustomerInstagramValue(customer);
    const includeFallbackNote = options.includeFallbackNote !== false;
    const nameEl = document.getElementById('leadName');
    const phoneEl = document.getElementById('leadPhone');
    const instagramEl = document.getElementById('leadInstagram');
    const notesEl = document.getElementById('leadNotes');
    if (nameEl) nameEl.value = customer.name || '';
    if (phoneEl) phoneEl.value = customer.phone || '';
    if (instagramEl) instagramEl.value = instagram ? '@' + instagram : '';
    if (notesEl && includeFallbackNote) notesEl.value = customerFallbackLeadNote(customer);

    const modal = document.getElementById('leadModal');
    if (modal && customer.id) modal.dataset.sourceCustomerId = String(customer.id);
    modalInitialState = getModalState();
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
    nameEl?.focus();
}

function openLeadFromCustomerFallback(customerId) {
    const customer = leadCustomerFallbackById(customerId);
    if (!customer) {
        if (typeof showNotification === 'function') showNotification('Клієнта з підказки вже не знайдено. Повторіть пошук.', 'error');
        return;
    }
    openAddModal();
    if (!document.getElementById('leadModal')?.classList.contains('active')) return;
    prefillLeadModalFromCustomer(customer);
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
    const eventPreference = leadEventPreferenceFromLead(lead);
    document.getElementById('leadEventDate').value = eventPreference.preferredDate || '';
    document.getElementById('leadChildrenCount').value = isMaysternyaLeadContext() ? '' : (eventPreference.childrenCount || '');
    document.getElementById('leadAdultsCount').value = isMaysternyaLeadContext() ? '' : (eventPreference.adultsCount || '');
    setCelebrantsEditorValue('leadCelebrants', isMaysternyaLeadContext() ? [] : normalizeLeadCelebrants(lead), { markInitial: true });
    document.getElementById('leadNotes').value = isMaysternyaLeadContext() ? (lead.notes || '') : stripLeadGuestSummary(lead.notes || '');
    document.getElementById('leadAssignedTo').value = lead.assigned_to || '';
    syncLeadEventDetailsVisibility();

    configureLeadStageControls({
        editing: true,
        stage: lead.pipeline_stage || 'new',
        leadType: lead.lead_type || 'quality',
        locked: false,
        origin: ''
    });

    const modal = document.getElementById('leadModal');
    if (modal) resetLeadCreateHandoffState();
    modalInitialState = getModalState();
    modal?.classList.add('active');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
}

function getModalState() {
    const fields = ['leadName', 'leadPhone', 'leadInstagram', 'leadSource', 'leadEventDate', 'leadChildrenCount', 'leadAdultsCount', 'leadCelebrants', 'leadNotes', 'leadAssignedTo', 'leadPipelineStage', 'leadLeadType'];
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
            resetLeadCreateHandoffState();
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
    const leadModal = document.getElementById('leadModal');
    leadModal?.classList.remove('active');
    resetLeadCreateHandoffState();
}

function leadModalSourceCustomerId() {
    const customerId = Number(document.getElementById('leadModal')?.dataset.sourceCustomerId || 0);
    return Number.isInteger(customerId) && customerId > 0 ? customerId : null;
}

async function linkSavedLeadToFallbackCustomer(leadId, customerId) {
    const normalizedLeadId = Number(leadId);
    const normalizedCustomerId = Number(customerId);
    if (!Number.isInteger(normalizedLeadId) || normalizedLeadId <= 0 || !Number.isInteger(normalizedCustomerId) || normalizedCustomerId <= 0) {
        return null;
    }
    try {
        const res = await apiFetch(`/api/leads/${normalizedLeadId}/link-customer`, {
            method: 'POST',
            body: JSON.stringify(leadPayload({
                customerId: normalizedCustomerId
            }))
        });
        if (!res) {
            if (typeof showNotification === 'function') showNotification('Лід створено, але клієнта не привʼязано.', 'warning');
            return null;
        }
        const data = await res.json();
        if (!data.success) {
            if (typeof showNotification === 'function') {
                showNotification(data.error || 'Лід створено, але клієнта не привʼязано.', 'warning');
            }
            return null;
        }
        if (typeof showNotification === 'function') showNotification('Лід створено і привʼязано до клієнта.', 'success');
        return {
            customerId: positiveLeadQueryId(data.customer?.id) || normalizedCustomerId,
            data
        };
    } catch (err) {
        console.warn('Link saved lead to fallback customer failed', err);
        if (typeof showNotification === 'function') showNotification('Лід створено, але клієнта не привʼязано.', 'warning');
        return null;
    }
}

function completeLeadCreateHandoff(leadId, customerId = null) {
    const request = activeLeadCreateHandoffRequest;
    const handoffApi = window.CrmCreateHandoff;
    const normalizedLeadId = positiveLeadQueryId(leadId);
    if (!request || !handoffApi || !normalizedLeadId) return false;

    const payload = { leadId: normalizedLeadId };
    const normalizedCustomerId = positiveLeadQueryId(customerId);
    if (normalizedCustomerId) payload.customerId = normalizedCustomerId;

    const result = handoffApi.sendCreated(request, 'lead.created', payload);
    if (!result?.ok) {
        if (typeof showNotification === 'function') showNotification('Лід створено, але бронювання не отримало handoff. Поверніться до бронювання вручну.', 'warning');
        return false;
    }

    handoffApi.completeChildAfterSend?.(result, { close: true });
    if (result.returnPath) {
        window.setTimeout(() => {
            window.location.assign(result.returnPath);
        }, 150);
    }
    return true;
}
async function saveLead() {
    if (!guardLeadWrite('редагувати ліди')) return;
    const editId = document.getElementById('leadEditId')?.value;
    const name = document.getElementById('leadName')?.value.trim();
    if (!name) { if (typeof showNotification === 'function') showNotification("Ім'я обов'язкове", 'error'); return; }
    if (leadSaveInFlight) return;
    const leadCelebrants = isMaysternyaLeadContext() ? [] : getCelebrantsPayload('leadCelebrants');
    const leadCelebrantsDirty = !isMaysternyaLeadContext() && isCelebrantsEditorDirty('leadCelebrants');
    const eventDate = document.getElementById('leadEventDate')?.value || null;
    const guestCounts = isMaysternyaLeadContext() ? { children: 0, adults: 0 } : readLeadGuestCounts();
    const childrenCount = isMaysternyaLeadContext()
        ? null
        : (guestCounts.children || (leadCelebrants.length ? leadCelebrants.length : null));
    const rawNotes = stripLeadGuestSummary(document.getElementById('leadNotes')?.value.trim() || '');

    const body = {
        client_name: name,
        phone: document.getElementById('leadPhone')?.value.trim() || null,
        instagram: document.getElementById('leadInstagram')?.value.trim() || null,
        source: document.getElementById('leadSource')?.value || null,
        event_date: eventDate,
        children_count: childrenCount,
        notes: rawNotes || null,
        eventPreference: isMaysternyaLeadContext()
            ? null
            : (eventDate ? {
                preferredDate: eventDate,
                childrenCount: childrenCount || 0,
                adultsCount: guestCounts.adults,
                notes: null
            } : null),
        assigned_to: parseInt(document.getElementById('leadAssignedTo')?.value) || null
    };
    if (!editId || leadCelebrantsDirty) body.celebrants = leadCelebrants;

    if (editId) {
        const stageEl = document.getElementById('leadPipelineStage');
        const typeEl = document.getElementById('leadLeadType');
        if (stageEl) body.pipeline_stage = stageEl.value;
        if (typeEl) body.lead_type = typeEl.value;
        const previousLead = leadsData.find(l => Number(l.id) === Number(editId));
        const previousType = LEAD_TYPE_MAP[previousLead?.lead_type] ? previousLead.lead_type : 'quality';
        if (body.lead_type && body.lead_type !== previousType && (leadTypeNeedsReason(body.lead_type) || body.lead_type === 'collaboration')) {
            let patchOptions;
            try {
                patchOptions = await leadTypePatchOptions(editId, body.lead_type);
            } catch (err) {
                console.error('Prepare lead type workflow error', err);
                if (typeof showNotification === 'function') showNotification(err.message || 'Не вдалося підготувати зміну типу ліда', 'error');
                return;
            }
            if (!patchOptions) return;
            if (patchOptions.lostReason !== undefined) body.lost_reason = patchOptions.lostReason;
            if (patchOptions.collaborationTaskPayload) {
                const committed = await persistLeadType(editId, body.lead_type, { reload: false, ...patchOptions });
                if (!committed) return;
                delete body.lead_type;
                delete body.pipeline_stage;
            }
        }
    } else {
        const stagePayload = await prepareCreateStagePayload(document.getElementById('leadPipelineStage')?.value || 'new');
        if (!stagePayload) return;
        Object.assign(body, stagePayload);
    }

    const saveBtn = document.getElementById('leadModalSave');
    const sourceCustomerId = editId ? null : leadModalSourceCustomerId();
    if (!editId && sourceCustomerId) body.customerId = sourceCustomerId;
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
        const savedLeadId = editId || data.lead?.id;
        let linkedCustomerResult = null;
        const responseCustomerId = positiveLeadQueryId(data.customer?.id);
        if (!editId && sourceCustomerId && savedLeadId && responseCustomerId !== sourceCustomerId) {
            linkedCustomerResult = await linkSavedLeadToFallbackCustomer(savedLeadId, sourceCustomerId);
        }
        if (!editId && savedLeadId) {
            completeLeadCreateHandoff(savedLeadId, linkedCustomerResult?.customerId || responseCustomerId || sourceCustomerId || null);
        }
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

async function openLeadCustomerCard(leadId, seedLead = null) {
    const workspace = await loadLeadWorkspaceForConversion(leadId);
    const lead = workspace?.lead || seedLead || leadsData.find(l => l.id === leadId) || {};
    if (workspace?.customer?.id) {
        window.location.href = leadCrmContextHref('/customers', { open: workspace.customer.id }, leadContextFromRecord(lead));
        return true;
    }
    if (!guardLeadWrite('створити картку клієнта для ліда')) return false;
    try {
        const ensured = await ensureLeadCustomerForBooking(leadId, lead);
        if (!ensured?.customer?.id) throw new Error('Customer was not returned');
        window.location.href = leadCrmContextHref('/customers', { open: ensured.customer.id }, leadContextFromRecord(ensured.lead || lead));
        return true;
    } catch (err) {
        console.error('Open lead customer card error', err);
        if (typeof showNotification === 'function') {
            showNotification(err.message || 'Не вдалося відкрити картку клієнта', 'error');
        }
        return false;
    }
}

function syncLeadDealCustomerContext(leadId, lead = null, customer = null) {
    if (!customer?.id || currentWorkspaceData?.lead?.id !== leadId) return;
    currentWorkspaceData = {
        ...currentWorkspaceData,
        lead: lead || currentWorkspaceData.lead,
        customer
    };
}

async function ensureDealCustomerCardForLead(leadId, seedLead = null, serverCustomer = null, serverMode = '') {
    if (serverCustomer?.id) {
        syncLeadDealCustomerContext(leadId, seedLead, serverCustomer);
        return {
            lead: seedLead,
            customer: serverCustomer,
            mode: serverMode || 'created_or_linked'
        };
    }
    return ensureLeadCustomerForBooking(leadId, seedLead);
}

function dealCustomerCardResultText(mode) {
    if (mode === 'created_new') return 'Картку клієнта створено.';
    if (mode === 'linked_existing') return 'Картку клієнта привʼязано до ліда.';
    if (mode === 'updated_existing') return 'Картку клієнта оновлено.';
    return 'Картку клієнта підготовлено.';
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
    const preferredEventDate = leadConversionPreferredDate(conversionLead);
    if (customer?.id) params.set('customerId', customer.id);
    if (customerName) params.set('customerName', customerName);
    if (customerPhone) params.set('customerPhone', customerPhone);
    if (preferredEventDate) {
        params.set('date', preferredEventDate);
        params.set('eventDate', preferredEventDate);
    }
    params.set('leadId', id);
    params.set('convert', 'booking');
    const conversionMode = leadBookingConversionModeConfig(options.bookingMode || options.mode);
    if (conversionMode) {
        params.set('bookingMode', conversionMode.bookingMode);
        params.set('timelineView', conversionMode.timelineView);
    }
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

async function convertLeadToBookingMode(id, bookingMode, options = {}) {
    return convertLead(id, { ...options, bookingMode });
}

async function offerDealCustomerCardFlow(leadId, lead = null, customer = null, mode = '') {
    let ensured = null;
    try {
        ensured = await ensureDealCustomerCardForLead(leadId, lead, customer, mode);
    } catch (err) {
        console.error('Lead deal customer ensure error', err);
        if (typeof showNotification === 'function') {
            showNotification(err.message || 'Не вдалося створити картку клієнта для угоди', 'error');
        }
        return false;
    }
    if (!ensured?.customer?.id) {
        if (typeof showNotification === 'function') showNotification('Не вдалося створити картку клієнта для угоди', 'error');
        return false;
    }
    const resultText = dealCustomerCardResultText(ensured.mode);
    const ok = await confirmLeadUiAction(`Етап змінено на "Угода". ${resultText} Відкрити її зараз?`, {
        okText: 'Відкрити картку',
        cancelText: 'Пізніше',
        type: 'success'
    });
    if (!ok) return false;
    const href = leadCrmContextHref('/customers', { open: ensured.customer.id }, leadContextFromRecord(ensured.lead || lead || {}));
    window.location.href = href;
    return true;
}

function localDateTimeInput(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateInput(date = new Date()) {
    return localDateTimeInput(date).slice(0, 10);
}

async function loadLeadTaskOwners() {
    const ownersRes = await apiFetch('/api/tasks/owners');
    if (!ownersRes) return [];
    const ownersData = await ownersRes.json().catch(() => ({}));
    return Array.isArray(ownersData.users) ? ownersData.users : [];
}

function taskOwnerOptionLabel(owner = {}) {
    return `${owner.label || owner.name || owner.username || ('User #' + owner.id)}${owner.role ? ' (' + owner.role + ')' : ''}`;
}

function leadPrimaryName(lead = {}, leadId = '') {
    return lead.clientName || lead.client_name || lead.name || (leadId ? `лід #${leadId}` : 'лід');
}

function defaultCollaborationTaskTitle(leadId, lead = {}) {
    return `Опрацювати співпрацю: ${leadPrimaryName(lead, leadId)}`;
}

function defaultCollaborationTaskDescription(leadId, lead = {}, comment = '') {
    const contact = [
        lead.phone,
        lead.instagram ? `@${lead.instagram}` : null
    ].filter(Boolean).join(' / ');
    return [
        `Запит на співпрацю з ліда #${leadId}.`,
        leadPrimaryName(lead, leadId) ? `Контакт: ${leadPrimaryName(lead, leadId)}` : null,
        contact ? `Канал: ${contact}` : null,
        lead.notes ? `Нотатки ліда: ${String(lead.notes).slice(0, 600)}` : null,
        comment ? `Коментар менеджера: ${String(comment).trim()}` : null
    ].filter(Boolean).join('\n');
}

async function requestCollaborationTaskValues(leadId, lead = {}) {
    if (typeof formModal !== 'function') {
        throw new Error('Форма задач недоступна. Оновіть сторінку і повторіть дію.');
    }

    let taskOwners = [];
    try {
        taskOwners = await loadLeadTaskOwners();
    } catch (err) {
        console.error('Load collaboration task owners error', err);
        throw new Error('Не вдалося завантажити відповідальних для задачі');
    }
    if (!taskOwners.length) {
        throw new Error('Немає доступних відповідальних для задачі');
    }

    const defaultDeadline = new Date();
    defaultDeadline.setDate(defaultDeadline.getDate() + 1);
    defaultDeadline.setHours(12, 0, 0, 0);

    return formModal('Задача для співпраці', [
        { key: 'title', label: 'Назва задачі', defaultValue: defaultCollaborationTaskTitle(leadId, lead), required: true },
        {
            key: 'ownerUserId',
            label: 'Відповідальний',
            type: 'select',
            required: true,
            options: [
                { value: '', label: 'Оберіть відповідального' },
                ...taskOwners.map(owner => ({
                    value: String(owner.id),
                    label: taskOwnerOptionLabel(owner)
                }))
            ]
        },
        { key: 'deadline', label: 'Дедлайн', type: 'datetime-local', defaultValue: localDateTimeInput(defaultDeadline), required: true },
        {
            key: 'priority',
            label: 'Пріоритет',
            type: 'select',
            defaultValue: 'normal',
            options: [
                { value: 'high', label: 'Високий' },
                { value: 'normal', label: 'Звичайний' },
                { value: 'low', label: 'Низький' }
            ]
        },
        { key: 'comment', label: 'Коментар', type: 'textarea', placeholder: 'Що саме треба перевірити або кому написати...' }
    ], { okText: 'Створити задачу', type: 'success', icon: '🤝' });
}

async function requestCollaborationLeadTaskPayload(leadId) {
    if (!guardLeadWrite('створювати задачу для співпраці')) return null;
    const workspaceLead = Number(currentWorkspaceData?.lead?.id) === Number(leadId) ? currentWorkspaceData.lead : null;
    const lead = leadsData.find(l => Number(l.id) === Number(leadId)) || workspaceLead || {};
    const values = await requestCollaborationTaskValues(leadId, lead);
    if (!values) return null;

    const title = String(values.title || '').trim();
    const ownerUserId = String(values.ownerUserId || '').trim();
    const deadline = values.deadline || '';
    if (!title) throw new Error('Назва задачі обовʼязкова');
    if (!ownerUserId) throw new Error('Оберіть відповідального для задачі');
    if (!deadline) throw new Error('Дедлайн задачі обовʼязковий');

    const body = {
        title,
        description: defaultCollaborationTaskDescription(leadId, lead, values.comment || ''),
        date: String(deadline).slice(0, 10),
        deadline,
        priority: values.priority || 'normal',
        category: 'operational',
        task_type: 'human',
        source_type: 'lead',
        source_id: String(leadId),
        sourceEntityType: 'lead',
        sourceEntityId: String(leadId),
        ownerUserId,
        businessContext: leadContextFromRecord(lead)
    };

    return body;
}

async function createCollaborationLeadTask(leadId, taskPayload) {
    const res = await apiFetch(`/api/leads/${leadId}/collaboration-task`, { method: 'POST', body: JSON.stringify(taskPayload || {}) });
    if (!res) throw new Error('Не вдалося оформити співпрацю');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
        const message = data.message || data.error || (res.status === 409 ? 'Така активна задача вже існує' : 'Не вдалося оформити співпрацю');
        throw new Error(message);
    }
    if (!data.task?.id) throw new Error('Задачу створено без id. Перевірте задачник перед зміною типу ліда.');
    return data;
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
        businessContext: customer.businessContext || customer.business_context || '',
        name: customer.name || customer.clientName || `Клієнт #${customer.id}`,
        phone: customer.phone || '',
        instagram: customer.instagram || '',
        socialIdentities: Array.isArray(customer.socialIdentities)
            ? customer.socialIdentities
            : (Array.isArray(customer.social_identities) ? customer.social_identities : []),
        childName: customer.childName || customer.child_name || '',
        children: Array.isArray(customer.children) ? customer.children : [],
        source: customer.source || '',
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
    const updatedAt = leadUpdatedAtForStageMove(leadId);
    if (stage === 'lost') {
        showLostReasonModal(leadId, stage, { updated_at: updatedAt });
        return;
    }
    await updateLeadStage(leadId, stage, { updated_at: updatedAt });
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
window.openLeadCustomerCard = openLeadCustomerCard;
window.linkWorkspaceLeadCustomer = linkWorkspaceLeadCustomer;
window.closeLeadCustomerLinkModal = closeLeadCustomerLinkModal;
window.moveLeadWorkspaceStage = moveLeadWorkspaceStage;
window.setLeadQueue = setLeadQueue;
window.showKanbanLeadTypeMenu = showKanbanLeadTypeMenu;
window.updateLeadTypeFromKanbanSelect = updateLeadTypeFromKanbanSelect;
window.closeQualityCategoryModal = closeQualityCategoryModal;
window.closeLostReasonModal = closeLostReasonModal;
window.closeAddMailingModal = closeAddMailingModal;
window.LEAD_BOOKING_CONVERSION_MODES = LEAD_BOOKING_CONVERSION_MODES;
window.convertLeadToBookingMode = convertLeadToBookingMode;
