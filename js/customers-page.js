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
    tags: [],
    predefinedTags: [],
    editingTags: [],
    editingChildren: [],
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
    telegram:       'Telegram',
    facebook:       'Facebook',
    instagram:      'Instagram',
    viber:          'Viber',
    tiktok:         'TikTok',
    turbo:          'Turbo',
    bnderoga:       'BnD',
    google:         'Google',
    recommendation: 'За рекомендацією',
    repeat:         'Повторне звернення',
    maysternya_site:'Сайт Майстерні',
    maysternya_bot: 'Бот Майстерні',
    manual:         'Ручне внесення',
    lead:           'Лід',
    other:          'Інше',
    unknown:        'Не вказано'
};

const SOURCE_ALIASES = {
    unknown: ['', 'unknown', 'null', 'undefined', 'не вказано', 'невідомо', 'невідоме джерело'],
    telegram: ['telegram', 'tg', 'телеграм'],
    facebook: ['facebook', 'fb', 'фейсбук'],
    instagram: ['instagram', 'insta', 'ig', 'інстаграм'],
    viber: ['viber', 'вайбер'],
    tiktok: ['tiktok', 'tik tok', 'тік ток', 'тікток'],
    turbo: ['turbo', 'турбо'],
    bnderoga: ['bnderoga', 'bnd', 'бендерога'],
    google: ['google', 'гугл'],
    recommendation: ['recommendation', 'recommend', 'referral', 'рекомендація', 'за рекомендацією', 'рекомендовано'],
    repeat: ['repeat', 'returning', 'повторний', 'повторне звернення', 'повторне', 'постійний'],
    maysternya_site: ['maysternya_site', 'maysternya site', 'сайт майстерні', 'майстерня сайт'],
    maysternya_bot: ['maysternya_bot', 'maysternya bot', 'бот майстерні', 'майстерня бот'],
    manual: ['manual', 'operator', 'ручний', 'ручне внесення', 'вручну'],
    lead: ['lead', 'лід', 'з ліда'],
    other: ['other', 'інше', 'інший', 'інше джерело']
};

const SOURCE_BY_ALIAS = Object.entries(SOURCE_ALIASES).reduce((map, [source, aliases]) => {
    aliases.forEach(alias => map.set(alias, source));
    return map;
}, new Map());

function normalizeCustomerSource(value) {
    const key = String(value ?? '').trim().toLowerCase();
    return SOURCE_BY_ALIAS.get(key) || (SOURCE_LABELS[key] ? key : 'other');
}

function getCustomerSourceLabel(value) {
    return SOURCE_LABELS[normalizeCustomerSource(value)] || SOURCE_LABELS.other;
}

function getCustomerSourceBadgeKey(value) {
    return normalizeCustomerSource(value) || 'unknown';
}

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

const BIRTHDAY_TAG_COLOR = '#EC4899';
const BIRTHDAY_MONTH_NAMES = Object.freeze([
    'січня',
    'лютого',
    'березня',
    'квітня',
    'травня',
    'червня',
    'липня',
    'серпня',
    'вересня',
    'жовтня',
    'листопада',
    'грудня'
]);
const BIRTHDAY_SYSTEM_TAGS = Object.freeze([
    { tag: 'Іменинник', color: BIRTHDAY_TAG_COLOR, system: true, systemKey: 'birthday' },
    ...BIRTHDAY_MONTH_NAMES.map((monthName, index) => ({
        tag: `Іменинники ${monthName}`,
        color: BIRTHDAY_TAG_COLOR,
        system: true,
        systemKey: `birthday_month_${String(index + 1).padStart(2, '0')}`
    }))
]);

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

function dateInputValue(value) {
    if (!value) return '';
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function formatDateOnly(value) {
    const dateOnly = dateInputValue(value);
    if (!dateOnly) return '—';
    const [year, month, day] = dateOnly.split('-');
    return `${day}.${month}.${year}`;
}

function customerChildAgeDisplay(child = {}) {
    if (child.ageSnapshot !== '' && child.ageSnapshot !== null && child.ageSnapshot !== undefined) {
        return `${escapeHtml(String(child.ageSnapshot))} р.`;
    }
    const dateOnly = dateInputValue(child.birthday);
    if (!dateOnly) return '—';
    const [year, month, day] = dateOnly.split('-').map(Number);
    const today = new Date();
    let age = today.getFullYear() - year;
    const birthdayPassed = (today.getMonth() + 1) > month || ((today.getMonth() + 1) === month && today.getDate() >= day);
    if (!birthdayPassed) age -= 1;
    return age >= 0 && age <= 120 ? `${age} р.` : '—';
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

function normalizeCustomerChildForEdit(child = {}) {
    const ageSnapshot = child.ageSnapshot ?? child.age_snapshot ?? child.age ?? child.childAge ?? child.child_age ?? '';
    return {
        name: String(child.name ?? child.childName ?? child.child_name ?? '').trim(),
        birthday: dateInputValue(child.birthday ?? child.birthDate ?? child.birth_date ?? child.childBirthday ?? child.child_birthday),
        ageSnapshot: ageSnapshot === null || ageSnapshot === undefined ? '' : String(ageSnapshot).trim(),
        note: String(child.note ?? child.notes ?? '').trim()
    };
}

function customerChildrenForEdit(customer = {}) {
    const canonical = Array.isArray(customer?.children)
        ? customer.children.map(normalizeCustomerChildForEdit).filter(child => child.name || child.birthday || child.ageSnapshot || child.note)
        : [];
    if (canonical.length) return canonical;
    const legacy = normalizeCustomerChildForEdit({
        name: customer?.childName ?? customer?.child_name,
        birthday: customer?.childBirthday ?? customer?.child_birthday
    });
    return legacy.name || legacy.birthday ? [legacy] : [];
}

function serializedCustomerEditingChildren() {
    return (CrmState.editingChildren || [])
        .map(normalizeCustomerChildForEdit)
        .filter(child => child.name || child.birthday || child.ageSnapshot || child.note);
}

function customerChildrenStateSignature() {
    return JSON.stringify(serializedCustomerEditingChildren());
}

function renderCustomerChildrenValue(customer = {}) {
    const children = customerChildrenForEdit(customer);
    if (!children.length) return '<div class="customer-children-empty">Дітей не вказано</div>';
    return `<div class="customer-children-view" role="list">${children.map((child, index) => {
        const title = child.name || `#${index + 1}`;
        return `<div class="customer-child-card" role="listitem">
            <div class="customer-child-card-head">
                <strong>${escapeHtml(title)}</strong>
            </div>
            <dl class="customer-child-facts">
                <div>
                    <dt>ДН</dt>
                    <dd>${child.birthday ? formatDateOnly(child.birthday) : '—'}</dd>
                </div>
                <div>
                    <dt>Вік</dt>
                    <dd>${customerChildAgeDisplay(child)}</dd>
                </div>
                <div class="customer-child-note">
                    <dt>Нотатка</dt>
                    <dd>${child.note ? escapeHtml(child.note) : '—'}</dd>
                </div>
            </dl>
        </div>`;
    }).join('')}</div>`;
}

function renderCustomerChildrenSection(customer = {}) {
    return `<div class="detail-section customer-children-section">
        <h4>Діти</h4>
        ${renderCustomerChildrenValue(customer)}
    </div>`;
}

function customerChildrenInlineLabel(customer = {}) {
    const children = customerChildrenForEdit(customer);
    if (!children.length) return '';
    if (children.length === 1) {
        const child = children[0];
        const ageSnapshot = child.ageSnapshot !== '' && child.ageSnapshot !== null && child.ageSnapshot !== undefined ? `${child.ageSnapshot} р.` : '';
        return [child.name, ageSnapshot, child.birthday ? formatDateOnly(child.birthday) : '']
            .filter(Boolean)
            .join(', ');
    }
    const names = children.map(child => child.name).filter(Boolean).slice(0, 3).join(', ');
    return names ? `${children.length} дітей: ${names}` : `${children.length} дітей`;
}

function setCustomerEditingChildren(children = []) {
    CrmState.editingChildren = (Array.isArray(children) ? children : [])
        .map(normalizeCustomerChildForEdit)
        .filter(child => child.name || child.birthday || child.ageSnapshot || child.note);
}

function updateCustomerEditingChild(index, field, value) {
    if (!Array.isArray(CrmState.editingChildren)) CrmState.editingChildren = [];
    if (!CrmState.editingChildren[index]) CrmState.editingChildren[index] = normalizeCustomerChildForEdit();
    CrmState.editingChildren[index] = normalizeCustomerChildForEdit({
        ...CrmState.editingChildren[index],
        [field]: value
    });
}

function renderCustomerEditChildren() {
    const list = document.getElementById('editChildrenList');
    if (!list) return;
    const rows = CrmState.editingChildren || [];
    list.innerHTML = rows.length
        ? rows.map((child, index) => `
            <div class="customer-child-edit-row" data-child-index="${index}">
                <div class="customer-child-field">
                    <label class="customer-child-label" for="editChildName${index}">Ім'я</label>
                    <input type="text" id="editChildName${index}" class="customer-child-input" data-child-field="name" value="${escapeHtml(child.name)}" autocomplete="off">
                </div>
                <div class="customer-child-field">
                    <label class="customer-child-label" for="editChildBirthday${index}">ДН</label>
                    <input type="date" id="editChildBirthday${index}" class="customer-child-input" data-child-field="birthday" value="${escapeHtml(child.birthday)}">
                </div>
                <div class="customer-child-field">
                    <label class="customer-child-label" for="editChildAge${index}">Вік</label>
                    <input type="number" id="editChildAge${index}" class="customer-child-input" data-child-field="ageSnapshot" value="${escapeHtml(child.ageSnapshot)}" min="0" max="120" inputmode="numeric">
                </div>
                <div class="customer-child-field">
                    <label class="customer-child-label" for="editChildNote${index}">Нотатка</label>
                    <input type="text" id="editChildNote${index}" class="customer-child-input" data-child-field="note" value="${escapeHtml(child.note)}" autocomplete="off">
                </div>
                <button type="button" class="customer-child-remove-btn" data-child-remove="${index}" aria-label="Прибрати дитину">×</button>
            </div>
        `).join('')
        : '<div class="customer-child-empty">Дітей ще не додано.</div>';
}

function bindCustomerEditChildrenTools() {
    if (bindCustomerEditChildrenTools.bound) return;
    bindCustomerEditChildrenTools.bound = true;
    document.getElementById('editAddChildBtn')?.addEventListener('click', () => {
        CrmState.editingChildren = [...(CrmState.editingChildren || []), normalizeCustomerChildForEdit()];
        renderCustomerEditChildren();
    });
    document.getElementById('editChildrenList')?.addEventListener('input', (event) => {
        const field = event.target?.dataset?.childField;
        const row = event.target?.closest?.('[data-child-index]');
        if (!field || !row) return;
        updateCustomerEditingChild(Number.parseInt(row.dataset.childIndex, 10), field, event.target.value);
    });
    document.getElementById('editChildrenList')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-child-remove]');
        if (!button) return;
        const index = Number.parseInt(button.dataset.childRemove, 10);
        CrmState.editingChildren = (CrmState.editingChildren || []).filter((_, i) => i !== index);
        renderCustomerEditChildren();
    });
}

function customerBusinessScope() {
    return window.CrmBusinessContext?.scope?.() || { mode: 'single', activeContext: customerBusinessContext() };
}

function isMaysternyaCustomerContext() {
    const scope = customerBusinessScope();
    return scope.mode === 'single' && customerBusinessContext() === 'maysternya_doli';
}

function isCustomerBusinessReadOnly() {
    return Boolean(window.CrmBusinessContext?.isReadOnly?.(customerBusinessScope()));
}

function customerReadOnlyMessage(actionLabel = 'змінювати клієнтів') {
    return window.CrmBusinessContext?.readOnlyMessage?.(customerBusinessScope(), actionLabel)
        || 'Огляд кількох бізнесів працює тільки для перегляду. Оберіть один бізнес, щоб змінювати клієнтів.';
}

function guardCustomerWrite(actionLabel = 'змінювати клієнтів') {
    return window.CrmBusinessContext?.guardWrite
        ? window.CrmBusinessContext.guardWrite(actionLabel, customerBusinessScope())
        : !isCustomerBusinessReadOnly();
}

function applyCustomerReadOnlyControls(root = document) {
    if (!isCustomerBusinessReadOnly() || !root?.querySelectorAll) return;
    const message = customerReadOnlyMessage('редагувати клієнтів');
    const actionBox = root.querySelector('.entity-card-actions');
    if (actionBox && actionBox.children.length) {
        actionBox.innerHTML = '<span class="crm-business-readonly-chip">Тільки перегляд</span>';
    }
    root.querySelectorAll([
        '[onclick^="editCustomer"]',
        '[onclick^="confirmDeleteCustomer"]',
        '[onclick^="mergeCustomers"]',
        '[onclick^="addCommunication"]',
        '[onclick^="showAddTagDropdown"]',
        '.crm-tag-remove'
    ].join(',')).forEach(el => {
        el.disabled = true;
        el.setAttribute('aria-disabled', 'true');
        el.classList.add('crm-business-readonly-control');
        el.title = message;
    });
}

function syncCustomerReadOnlyUi() {
    const readOnly = isCustomerBusinessReadOnly();
    if (document.body) {
        document.body.dataset.crmBusinessReadOnly = readOnly ? 'true' : 'false';
    }

    let notice = document.getElementById('customerBusinessReadOnlyNotice');
    if (readOnly && !notice) {
        notice = document.createElement('div');
        notice.id = 'customerBusinessReadOnlyNotice';
        notice.className = 'crm-business-readonly-banner';
        notice.setAttribute('role', 'status');
        const header = document.querySelector('.page-header');
        header?.insertAdjacentElement('afterend', notice);
    }
    if (notice) {
        notice.textContent = customerReadOnlyMessage('редагувати клієнтів');
        notice.hidden = !readOnly;
    }

    const blockedIds = ['addCustomerBtn', 'importVcfBtn', 'saveCustomerBtn'];
    blockedIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = readOnly;
        el.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
        if (readOnly) el.title = customerReadOnlyMessage('редагувати клієнтів');
        else el.removeAttribute('title');
    });
    applyCustomerReadOnlyControls(document);
}

function syncCustomerPresentationUi() {
    const maysternyaMode = isMaysternyaCustomerContext();
    if (document.body) document.body.dataset.customerBusinessContext = customerBusinessContext();
    const title = document.querySelector('.page-header h2');
    if (title) title.textContent = maysternyaMode ? 'Клієнти Майстерні' : 'База клієнтів';
    const addBtn = document.getElementById('addCustomerBtn');
    if (addBtn) addBtn.textContent = maysternyaMode ? '+ Новий клієнт Майстерні' : '+ Новий клієнт';
    const headers = document.querySelectorAll('.crm-table thead th');
    if (headers[4]) headers[4].textContent = maysternyaMode ? 'Сесії' : 'Візити';
    if (headers[5]) headers[5].textContent = maysternyaMode ? 'Оплачено' : 'Витрачено';
    if (headers[6]) headers[6].textContent = maysternyaMode ? 'Остання сесія' : 'Останній візит';
    const sortVisits = document.querySelector('#sortFilter option[value="total_bookings"]');
    if (sortVisits) sortVisits.textContent = maysternyaMode ? 'За сесіями' : 'За візитами';
    const sortSpent = document.querySelector('#sortFilter option[value="total_spent"]');
    if (sortSpent) sortSpent.textContent = maysternyaMode ? 'За оплатами' : 'За витратами';
    syncCustomerEditBusinessFields();
}

function syncCustomerEditBusinessFields() {
    const maysternyaMode = isMaysternyaCustomerContext();
    const childSection = document.getElementById('editChildrenSection');
    if (childSection) childSection.hidden = maysternyaMode;
    if (maysternyaMode) {
        setCustomerEditingChildren([]);
        renderCustomerEditChildren();
    }
}

function initCustomerBusinessContext(user) {
    const api = window.CrmBusinessContext;
    CrmState.businessContext = api?.initPage?.({
        pageId: 'customers',
        user,
        beforeChange: async () => {
            const closed = await closeEditModal(false);
            if (closed === false) return false;
            closeCustomerDetailModal();
            return true;
        },
        onChange: async ({ current }) => {
            CrmState.businessContext = current;
            CrmState.page = 1;
            CrmState.rfmData = null;
            syncCustomerPresentationUi();
            syncCustomerReadOnlyUi();
            await refreshData();
            openCustomerDeepLink();
        }
    }) || 'event_genix';
    syncCustomerPresentationUi();
    syncCustomerReadOnlyUi();
}

function customerHubText(value, fallback = '—') {
    return value ? escapeHtml(value) : fallback;
}

function customerHubAction(href, label, cls = '', options = {}) {
    if (!href) {
        return `<span class="customer-hub-action disabled ${cls}" aria-disabled="true">${escapeHtml(label)}</span>`;
    }
    const target = options.external ? ' target="_blank" rel="noopener"' : '';
    const title = options.title ? ` title="${escapeHtml(options.title)}"` : '';
    const aria = options.ariaLabel ? ` aria-label="${escapeHtml(options.ariaLabel)}"` : '';
    return `<a class="customer-hub-action ${cls}" href="${escapeHtml(href)}"${target}${title}${aria}>${escapeHtml(label)}</a>`;
}

function customerCrmContextHref(path, params = {}, context = customerBusinessContext()) {
    const normalized = window.CrmBusinessContext?.normalize?.(context) || context || 'event_genix';
    const url = new URL(path, window.location.origin);
    if (normalized && normalized !== 'event_genix') url.searchParams.set('businessContext', normalized);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
    });
    return `${url.pathname}${url.search}${url.hash}`;
}

function leadCrmLinkForCustomer(leadId) {
    return customerCrmContextHref('/sales-funnel', { lead: leadId }, customerBusinessContext());
}

const CUSTOMER_PIPELINE_STAGE_MAP = {
    new: { label: 'Новий лід', cls: 'new' },
    contacted: { label: 'Контакт', cls: 'contacted' },
    info_sent: { label: 'Надання інфо', cls: 'info-sent' },
    deal: { label: 'Угода', cls: 'deal' },
    deposit_received: { label: 'Завдаток', cls: 'deposit' },
    waiting: { label: 'В очікуванні', cls: 'waiting' },
    completed: { label: 'Проведено', cls: 'completed' },
    closed: { label: 'Закрито', cls: 'closed' },
    lost: { label: 'Провалено', cls: 'lost' }
};

function customerPipelineStageMeta(customer = {}) {
    const rawStage = customer.leadPipelineStage || customer.pipelineStage || customer.pipeline_stage || '';
    const key = String(rawStage || '').trim();
    if (!key && customer.leadId) return { label: 'Лід без етапу', cls: 'unknown', key: '' };
    if (!key) return { label: 'Без привʼязаного ліда', cls: 'none', key: '' };
    const meta = CUSTOMER_PIPELINE_STAGE_MAP[key] || {
        label: key.replace(/_/g, ' '),
        cls: 'unknown'
    };
    return { ...meta, key };
}

function customerInitials(name) {
    const letters = String(name || '')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => Array.from(part)[0])
        .filter(Boolean);
    return (letters.join('') || 'К').toUpperCase();
}

function pickCustomerHeaderBooking(bookings = []) {
    if (!Array.isArray(bookings) || bookings.length === 0) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const active = bookings.filter(b => b?.status !== 'cancelled');
    const upcoming = active
        .filter(b => {
            const date = new Date(b.date);
            return !Number.isNaN(date.getTime()) && date >= today;
        })
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')));
    return upcoming[0] || active[0] || bookings[0] || null;
}

function customerBookingStatusLabel(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'confirmed') return 'Підтверджено';
    if (normalized === 'cancelled') return 'Скасовано';
    if (normalized === 'completed') return 'Проведено';
    if (normalized === 'pending') return 'Очікує';
    return normalized ? normalized.replace(/_/g, ' ') : '';
}

function customerBookingIsBanquet(booking = {}) {
    const category = String(booking.category || booking.bookingCategory || '').toLowerCase();
    return category === 'banquet'
        || Boolean(booking.banquetGuests || booking.banquet_guests)
        || Boolean(booking.banquetAdults || booking.banquet_adults)
        || Boolean(booking.banquetTables || booking.banquet_tables)
        || Boolean(booking.banquetMenu || booking.banquet_menu);
}

function customerBookingDateTimeText(booking = {}) {
    const dateText = formatDate(booking.date);
    const timeText = booking.time || '';
    const arrivalText = customerBookingIsBanquet(booking) && timeText ? `Прихід гостей: ${timeText}` : timeText;
    return [dateText, arrivalText].filter(Boolean).join(' · ');
}

function customerHeaderBookingDetails(booking, maysternyaMode = false) {
    if (!booking) {
        return {
            title: 'Бронювань немає',
            meta: maysternyaMode ? 'Запис ще не створено' : 'Історія порожня',
            muted: true
        };
    }
    const dateText = customerBookingDateTimeText(booking);
    const roomText = booking.room || booking.resourceName || booking.lineName || (maysternyaMode ? 'Кабінет не вказано' : 'Кімната не вказана');
    const programText = booking.label || booking.programName || '';
    const statusText = customerBookingStatusLabel(booking.status);
    return {
        title: dateText || 'Дата не вказана',
        meta: [roomText, programText, statusText].filter(Boolean).join(' · '),
        muted: false
    };
}

function customerContextualizeHref(href, context = customerBusinessContext()) {
    if (!href || /^(tel:|mailto:|https?:\/\/)/i.test(href)) return href;
    const normalized = window.CrmBusinessContext?.normalize?.(context) || context || 'event_genix';
    const url = new URL(href, window.location.origin);
    if (normalized && normalized !== 'event_genix') url.searchParams.set('businessContext', normalized);
    return `${url.pathname}${url.search}${url.hash}`;
}

function customerHeaderOmniTarget(customer = {}, communicationContext = null) {
    const links = communicationContext?.links || {};
    const rawHref = links.omniExact || links.omniSuggested || links.omniSearch || null;
    const fallbackSearch = customer.phone || customer.name || customer.instagram || '';
    const href = rawHref
        ? customerContextualizeHref(rawHref, customer.businessContext || customerBusinessContext())
        : (fallbackSearch ? customerCrmContextHref('/omni', { search: fallbackSearch }, customer.businessContext || customerBusinessContext()) : null);
    const label = links.omniExact
        ? 'Omni: діалог'
        : links.omniSuggested
            ? 'Omni: збіг'
            : 'Omni: пошук';
    return {
        href,
        label,
        cls: links.omniExact ? 'exact' : (links.omniSuggested ? 'suggested' : 'search')
    };
}

function renderCustomerDetailHero(customer, communicationContext = null, maysternyaMode = false) {
    const stage = customerPipelineStageMeta({
        ...customer,
        leadPipelineStage: customer.leadPipelineStage || communicationContext?.lead?.pipelineStage
    });
    const booking = pickCustomerHeaderBooking(customer.bookings);
    const bookingDetails = customerHeaderBookingDetails(booking, maysternyaMode);
    const omni = customerHeaderOmniTarget(customer, communicationContext);
    const leadLine = customer.leadId
        ? `<a href="${escapeHtml(leadCrmLinkForCustomer(customer.leadId))}">Лід #${escapeHtml(customer.leadId)}</a>`
        : '<span>Лід не привʼязано</span>';
    const contactSummary = [
        customer.phone ? escapeHtml(customer.phone) : 'телефон не вказано',
        customer.instagram ? `@${escapeHtml(customer.instagram)}` : ''
    ].filter(Boolean).map(item => `<span>${item}</span>`).join('');
    const omniButton = omni.href
        ? `<a class="btn-page-secondary entity-card-action customer-hero-omni ${escapeHtml(omni.cls)}" href="${escapeHtml(omni.href)}">${escapeHtml(omni.label)}</a>`
        : '<span class="btn-page-secondary entity-card-action customer-hero-omni disabled" aria-disabled="true">Omni недоступний</span>';

    return `<div class="customer-detail-header entity-card-header customer-detail-hero">
        <div class="customer-hero-identity">
            <div class="customer-hero-avatar" aria-hidden="true">${escapeHtml(customerInitials(customer.name))}</div>
            <div class="entity-card-title-block customer-hero-title">
                <h3>${escapeHtml(customer.name)}</h3>
                <div class="entity-card-meta customer-hero-contact-summary">${contactSummary}</div>
            </div>
        </div>
        <div class="customer-hero-summary" aria-label="Операційний контекст клієнта">
            <div class="customer-hero-tile customer-hero-stage ${escapeHtml(stage.cls)}">
                <span>Етап воронки</span>
                <strong>${escapeHtml(stage.label)}</strong>
                <small>${leadLine}</small>
            </div>
            <div class="customer-hero-tile customer-hero-booking${bookingDetails.muted ? ' muted' : ''}">
                <span>${maysternyaMode ? 'Найближчий запис' : 'Бронювання'}</span>
                <strong>${escapeHtml(bookingDetails.title)}</strong>
                <small>${escapeHtml(bookingDetails.meta)}</small>
            </div>
        </div>
        <div class="entity-card-actions customer-hero-actions" aria-label="Дії клієнта">
            <div class="customer-hero-action-group">
                ${omniButton}
                <button type="button" class="btn-page-secondary entity-card-action" onclick="editCustomer(${customer.id})">✏️ Редагувати</button>
            </div>
            <div class="customer-hero-action-group customer-hero-danger-group">
                <button type="button" class="btn-page-secondary entity-card-action danger" onclick="confirmDeleteCustomer(${customer.id})">🗑 Видалити</button>
            </div>
        </div>
    </div>`;
}

function customerHubDialogTarget(links = {}) {
    if (links.omniExact) {
        return {
            href: links.omniExact,
            confidence: 'exact',
            icon: '💬',
            shortLabel: 'Діалог',
            label: 'Відкрити точний діалог в Omni',
            title: 'Точна Omni-розмова привʼязана до цього клієнта'
        };
    }
    if (links.omniSuggested) {
        return {
            href: links.omniSuggested,
            confidence: 'suggested',
            icon: '💬',
            shortLabel: 'Ймовірний',
            label: 'Відкрити ймовірний діалог в Omni',
            title: 'Ймовірна Omni-розмова знайдена за телефоном або іменем'
        };
    }
    if (links.omniSearch) {
        return {
            href: links.omniSearch,
            confidence: 'search',
            icon: '⌕',
            shortLabel: 'Пошук',
            label: 'Шукати клієнта в Omni',
            title: 'Точної розмови немає: відкрити пошук Omni за даними клієнта'
        };
    }
    return null;
}

function customerHubDialogIcon(target) {
    if (!target?.href) return '';
    return `<a class="customer-dialog-icon ${escapeHtml(target.confidence)}"
        href="${escapeHtml(target.href)}"
        title="${escapeHtml(target.title)}"
        aria-label="${escapeHtml(target.label)}"
        data-dialog-confidence="${escapeHtml(target.confidence)}">
        <span class="customer-dialog-icon-glyph" aria-hidden="true">${escapeHtml(target.icon)}</span>
        <span class="customer-dialog-icon-text">${escapeHtml(target.shortLabel)}</span>
    </a>`;
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
    const dialogTarget = customerHubDialogTarget(links);
    const omniLabel = links.omniExact
        ? 'Відкрити точну Omni-розмову'
        : links.omniSuggested
            ? 'Відкрити ймовірну Omni-розмову'
            : links.omniSearch
                ? 'Шукати в Omni'
                : 'Omni недоступний';
    const booking = context.primaryBooking || null;
    const bookingText = booking
        ? [customerBookingDateTimeText(booking), customerHubText(booking.programName || booking.label || booking.id)].filter(Boolean).join(' · ')
        : 'Пов’язаних бронювань не знайдено';

    return `<div class="customer-comm-hub" data-comm-confidence="${escapeHtml(status)}">
        <div class="customer-hub-status-row">
            <span class="customer-hub-pill ${escapeHtml(status)}">${statusLabel}</span>
            <span class="customer-hub-meta">${escapeHtml(statusText)}</span>
        </div>
        <div class="customer-hub-actions" aria-label="Комунікаційні дії клієнта">
            ${customerHubDialogIcon(dialogTarget)}
            ${customerHubAction(links.call, 'Подзвонити', 'success')}
            ${customerHubAction(omniHref, omniLabel, omniClass, { title: dialogTarget?.title, ariaLabel: dialogTarget?.label })}
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
        f.source ? { label: 'Джерело', value: getCustomerSourceLabel(f.source) } : null,
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

function normalizeCustomerTagCatalogItem(item = {}) {
    const tag = String(item.tag || '').trim();
    if (!tag) return null;
    const count = Number.parseInt(item.count, 10);
    return {
        tag,
        color: item.color || '#6B7280',
        count: Number.isFinite(count) ? count : 0,
        system: Boolean(item.system || item.source === 'system'),
        systemKey: item.systemKey || item.system_key || null
    };
}

function mergeCustomerTagCatalogItem(existing, normalized) {
    return {
        ...(existing || {}),
        ...normalized,
        count: Math.max(existing?.count || 0, normalized.count || 0),
        system: Boolean(existing?.system || normalized.system),
        systemKey: existing?.systemKey || normalized.systemKey || null
    };
}

function currentKyivBirthdayMonthTag() {
    let month = new Date().getMonth() + 1;
    try {
        const value = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            month: '2-digit'
        }).format(new Date());
        const parsed = Number.parseInt(value, 10);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) month = parsed;
    } catch {
        // Browser fallback keeps the UI usable even if Intl timezone data is unavailable.
    }
    const systemKey = `birthday_month_${String(month).padStart(2, '0')}`;
    return BIRTHDAY_SYSTEM_TAGS.find(item => item.systemKey === systemKey)?.tag || '';
}

function getCustomerTagCatalog({ includeBirthdaySystemTags = false } = {}) {
    const byTag = new Map();
    [
        ...(CrmState.predefinedTags || []),
        ...(CrmState.tags || []),
        ...(includeBirthdaySystemTags ? BIRTHDAY_SYSTEM_TAGS : [])
    ].forEach(item => {
        const normalized = normalizeCustomerTagCatalogItem(item);
        if (!normalized) return;
        byTag.set(normalized.tag, mergeCustomerTagCatalogItem(byTag.get(normalized.tag), normalized));
    });
    return [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag, 'uk'));
}

function renderCustomerTagOptions(selectedValue = '', emptyLabel = 'Всі теги', options = {}) {
    const selected = String(selectedValue || '').trim();
    const catalog = getCustomerTagCatalog({
        includeBirthdaySystemTags: Boolean(options.includeBirthdaySystemTags)
    });
    const currentBirthdayTag = options.includeCurrentBirthdayShortcut ? currentKyivBirthdayMonthTag() : '';
    const hasSelected = selected && catalog.some(item => item.tag === selected);
    const rows = [
        `<option value="">${escapeHtml(emptyLabel)}</option>`,
        currentBirthdayTag
            ? `<option value="${escapeHtml(currentBirthdayTag)}"${selected === currentBirthdayTag ? ' selected' : ''}>Іменинники цього місяця</option>`
            : '',
        !hasSelected && selected ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>` : '',
        ...catalog.map(item => {
            const label = item.count > 0 ? `${item.tag} (${item.count})` : item.tag;
            const isSelected = item.tag === selected && item.tag !== currentBirthdayTag;
            return `<option value="${escapeHtml(item.tag)}"${isSelected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        })
    ];
    return rows.filter(Boolean).join('');
}

function setCustomerTagSelectOptions(select, emptyLabel, selectedValue, options = {}) {
    if (!select) return;
    const selected = selectedValue !== undefined ? selectedValue : select.value;
    select.innerHTML = renderCustomerTagOptions(selected, emptyLabel, options);
    select.value = selected || '';
}

function renderCustomerTagFilters() {
    const birthdayFilterOptions = {
        includeBirthdaySystemTags: true,
        includeCurrentBirthdayShortcut: true
    };
    setCustomerTagSelectOptions(document.getElementById('tagFilter'), 'Всі теги', CrmState.filters.tag || '', birthdayFilterOptions);
    setCustomerTagSelectOptions(document.getElementById('bulkTagFilter'), 'Всі клієнти', undefined, birthdayFilterOptions);
}

function renderTagFilters() {
    renderCustomerTagFilters();
}

function customerTagCatalogItem(tag) {
    const normalized = String(tag || '').trim();
    if (!normalized) return null;
    return getCustomerTagCatalog().find(item => item.tag === normalized) || null;
}

function isCustomerSystemTag(item = {}) {
    return Boolean(item.system || item.source === 'system' || item.systemKey || item.system_key);
}

function customerTagStyle(item = {}) {
    const color = escapeHtml(item.color || '#6B7280');
    return `background:${color}20;color:${color};border:1px solid ${color}40`;
}

function renderCustomerTagPill(item = {}, options = {}) {
    const tag = String(item.tag || '').trim();
    if (!tag) return '';
    const isSystem = isCustomerSystemTag(item);
    const classes = ['crm-tag-pill', isSystem ? 'crm-tag-pill--system' : ''].filter(Boolean).join(' ');
    const sourceAttr = isSystem ? 'system' : 'manual';
    const marker = isSystem
        ? '<span class="crm-tag-system-marker" aria-label="Автоматичний тег, керується датою народження" title="Керується датою народження">авто</span>'
        : '';
    const remove = options.removable && !isSystem && options.customerId && item.id
        ? `<button type="button" class="crm-tag-remove" onclick="removeTag(${options.customerId},${item.id},this)" aria-label="Прибрати тег ${escapeHtml(tag)}">×</button>`
        : '';
    const title = isSystem ? 'Керується датою народження' : '';
    return `<span class="${classes}" data-tag-source="${sourceAttr}" style="${customerTagStyle(item)}"${title ? ` title="${title}"` : ''}>${escapeHtml(tag)}${marker}${remove}</span>`;
}

function normalizeCustomerEditTag(item) {
    if (typeof item === 'object' && isCustomerSystemTag(item)) return null;
    const tag = String(typeof item === 'string' ? item : (item?.tag || '')).trim();
    if (!tag) return null;
    const catalogItem = customerTagCatalogItem(tag);
    return {
        tag,
        color: (typeof item === 'object' && item?.color) || catalogItem?.color || '#6B7280'
    };
}

function setCustomerEditingTags(tags = []) {
    const byTag = new Map();
    (Array.isArray(tags) ? tags : []).forEach(item => {
        const normalized = normalizeCustomerEditTag(item);
        if (!normalized) return;
        byTag.set(normalized.tag, {
            ...(byTag.get(normalized.tag) || {}),
            ...normalized
        });
    });
    CrmState.editingTags = [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag, 'uk'));
}

function serializedCustomerEditingTags() {
    return JSON.stringify(CrmState.editingTags.map(item => ({
        tag: item.tag,
        color: item.color || '#6B7280'
    })).sort((a, b) => a.tag.localeCompare(b.tag, 'uk')));
}

function renderCustomerEditTags() {
    const chips = document.getElementById('editTagsChips');
    const options = document.getElementById('editTagOptions');
    if (chips) {
        chips.innerHTML = CrmState.editingTags.length
            ? CrmState.editingTags.map((item, index) => `
                <span class="crm-tag-pill" style="${customerTagStyle(item)}">
                    ${escapeHtml(item.tag)}
                    <button type="button" class="crm-tag-remove" data-edit-tag-remove="${index}" aria-label="Прибрати тег ${escapeHtml(item.tag)}">×</button>
                </span>
            `).join('')
            : '<span class="customer-edit-tags-empty">Теги не вибрані</span>';
    }
    if (options) {
        const selected = new Set(CrmState.editingTags.map(item => item.tag));
        const catalog = getCustomerTagCatalog();
        options.innerHTML = catalog.length
            ? catalog.map((item, index) => `<button type="button" class="crm-tag-option" data-edit-tag-option="${index}" ${selected.has(item.tag) ? 'disabled' : ''}>${escapeHtml(item.tag)}</button>`).join('')
            : '<span class="customer-edit-tags-empty">Каталог тегів порожній. Додайте власний тег нижче.</span>';
        options.querySelectorAll('[data-edit-tag-option]').forEach(button => {
            const item = catalog[Number.parseInt(button.dataset.editTagOption, 10)];
            if (!item) return;
            button.style.color = item.color;
            button.addEventListener('click', () => addCustomerEditTag(item));
        });
    }
}

function addCustomerEditTag(item) {
    const normalized = normalizeCustomerEditTag(item);
    if (!normalized) return;
    setCustomerEditingTags([...CrmState.editingTags, normalized]);
    renderCustomerEditTags();
}

function removeCustomerEditTag(index) {
    CrmState.editingTags = CrmState.editingTags.filter((_, i) => i !== index);
    renderCustomerEditTags();
}

function addCustomCustomerEditTag() {
    const input = document.getElementById('editCustomTagInput');
    const tag = input?.value.trim();
    if (!tag) return;
    addCustomerEditTag({ tag, color: '#6B7280' });
    if (input) input.value = '';
}

function closeCustomerEditTagDropdown() {
    document.getElementById('editTagDropdown')?.classList.remove('is-open');
}

function bindCustomerEditTagTools() {
    if (bindCustomerEditTagTools.bound) return;
    bindCustomerEditTagTools.bound = true;
    document.getElementById('editAddTagBtn')?.addEventListener('click', () => {
        document.getElementById('editTagDropdown')?.classList.toggle('is-open');
    });
    document.getElementById('editCustomTagAddBtn')?.addEventListener('click', addCustomCustomerEditTag);
    document.getElementById('editCustomTagInput')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addCustomCustomerEditTag();
    });
    document.getElementById('editTagsChips')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-edit-tag-remove]');
        if (!button) return;
        removeCustomerEditTag(Number.parseInt(button.dataset.editTagRemove, 10));
    });
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

async function fetchCustomerTags() {
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch(customerApiUrl('/api/customers/tags'), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) {
            window.location.href = '/';
            return;
        }
        const data = await res.json().catch(() => ({}));
        CrmState.tags = Array.isArray(data.tags) ? data.tags : [];
        CrmState.predefinedTags = Array.isArray(data.predefined) ? data.predefined : [];
    } catch (err) {
        console.warn('Customer tags catalog load failed', err);
        CrmState.tags = [];
        CrmState.predefinedTags = [];
    }
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
    if (!guardCustomerWrite(CrmState.editingId ? 'редагувати клієнтів' : 'створювати клієнтів')) {
        throw new Error(customerReadOnlyMessage('редагувати клієнтів'));
    }
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
    if (!guardCustomerWrite('видаляти клієнтів')) {
        throw new Error(customerReadOnlyMessage('видаляти клієнтів'));
    }
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
    const maysternyaMode = isMaysternyaCustomerContext();
    el.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${s.total}</div>
            <div class="stat-label">Клієнтів</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${s.averages?.avg_bookings || 0}</div>
            <div class="stat-label">${maysternyaMode ? 'Сер. сесій' : 'Сер. візитів'}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${formatMoney(parseInt(s.averages?.avg_spent) || 0)}</div>
            <div class="stat-label">${maysternyaMode ? 'Сер. оплата' : 'Сер. витрати'}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${s.bySource?.length || 0}</div>
            <div class="stat-label">Джерел</div>
        </div>
    `;
}

function renderCustomerTable() {
    const tbody = document.getElementById('customerTableBody');
    const maysternyaMode = isMaysternyaCustomerContext();
    syncCustomerPresentationUi();
    renderCustomerExplainability();
    if (CrmState.customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">
            ${customerEmptyHtml()}
        </td></tr>`;
        return;
    }

    tbody.innerHTML = CrmState.customers.map(c => {
        const sourceKey = getCustomerSourceBadgeKey(c.source);
        const sourceLabel = getCustomerSourceLabel(c.source);
        const tagsHtml = (c.tags || []).map(t => renderCustomerTagPill(t)).join('');
        const childrenLabel = customerChildrenInlineLabel(c);
        const ltvBadge = c.ltv > 10000 ? ' 🔥' : '';
        return `<tr data-id="${c.id}">
            <td>
                <div class="customer-name">${escapeHtml(c.name)}${ltvBadge}</div>
                ${!maysternyaMode && childrenLabel ? `<div class="customer-child">${escapeHtml(childrenLabel)}</div>` : ''}
                ${tagsHtml ? `<div class="crm-tags-row">${tagsHtml}</div>` : ''}
            </td>
            <td>${escapeHtml(c.phone) || '—'}</td>
            <td>${c.instagram ? '@' + escapeHtml(c.instagram) : '—'}</td>
            <td><span class="badge badge-source badge-source-${escapeHtml(sourceKey)}">${escapeHtml(sourceLabel)}</span></td>
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
        const [customer, communicationContext] = await Promise.all([
            fetchCustomerDetail(id),
            fetchCustomerCommunicationContext(id).catch(() => null)
        ]);
        const maysternyaMode = isMaysternyaCustomerContext();

        let html = `
            <div class="entity-card-shell entity-card-shell-view entity-card-customer" data-entity-card-mode="customer">
            ${renderCustomerDetailHero(customer, communicationContext, maysternyaMode)}
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
                        <div class="field-label">Джерело</div>
                        <div class="field-value">${escapeHtml(getCustomerSourceLabel(customer.source))}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Лід</div>
                        <div class="field-value">${customer.leadId ? `<a href="${escapeHtml(leadCrmLinkForCustomer(customer.leadId))}">#${escapeHtml(customer.leadId)}</a>` : '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Клієнт з</div>
                        <div class="field-value">${formatDate(customer.createdAt)}</div>
                    </div>
                </div>
            </div>
            ${maysternyaMode ? '' : renderCustomerChildrenSection(customer)}
            <div class="detail-section">
                <h4>Статистика</h4>
                <div class="detail-grid">
                    <div class="detail-field">
                        <div class="field-label">${maysternyaMode ? 'Сесій' : 'Бронювань'}</div>
                        <div class="field-value">${customer.totalBookings}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">${maysternyaMode ? 'Оплачено' : 'Витрачено'}</div>
                        <div class="field-value">${formatMoney(customer.totalSpent)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">${maysternyaMode ? 'Перша сесія' : 'Перший візит'}</div>
                        <div class="field-value">${formatDate(customer.firstVisit)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">${maysternyaMode ? 'Остання сесія' : 'Останній візит'}</div>
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
                ${(customer.tags || []).map(t => renderCustomerTagPill(t, { removable: true, customerId: customer.id })).join('')}
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
        if (!maysternyaMode && customer.certificates && customer.certificates.length > 0) {
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
                <h4>${maysternyaMode ? 'Історія сесій' : 'Історія бронювань'} (${customer.bookings.length})</h4>
                <div class="detail-bookings">`;
            for (const b of customer.bookings) {
                const statusIcon = b.status === 'confirmed' ? '✅' : b.status === 'cancelled' ? '❌' : '⏳';
                const dateTimeText = customerBookingDateTimeText(b);
                html += `<div class="detail-booking-row">
                    <span>${statusIcon}</span>
                    <span style="font-weight:700">${escapeHtml(dateTimeText || 'Дата не вказана')}</span>
                    <span>${escapeHtml(b.label || b.programName || '')}</span>
                    <span style="color:var(--gray-400);margin-left:auto">${b.price ? formatMoney(b.price) : ''}</span>
                </div>`;
            }
            html += `</div></div>`;
        }

        html += `</div>`;
        content.innerHTML = html;
        applyCustomerReadOnlyControls(content);

        loadCommunicationHub(customer.id, communicationContext);

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
    const ids = ['editName', 'editPhone', 'editInstagram', 'editSource', 'editSocialIdentities', 'editNotes'];
    const fieldState = ids.map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
    return `${fieldState}|tags:${serializedCustomerEditingTags()}|children:${customerChildrenStateSignature()}`;
}

function isCustomerEditDirty() {
    return getCustomerEditState() !== _customerEditInitialState;
}

function openEditModal(customer) {
    CrmState.editingId = customer ? customer.id : null;
    const maysternyaMode = isMaysternyaCustomerContext();
    document.getElementById('customerEditTitle').textContent = customer
        ? (maysternyaMode ? 'Редагувати клієнта Майстерні' : 'Редагувати клієнта')
        : (maysternyaMode ? 'Новий клієнт Майстерні' : 'Новий клієнт');

    document.getElementById('editName').value = customer?.name || '';
    document.getElementById('editPhone').value = customer?.phone || '';
    document.getElementById('editInstagram').value = customer?.instagram || '';
    setCustomerEditingChildren(maysternyaMode ? [] : customerChildrenForEdit(customer || {}));
    renderCustomerEditChildren();
    const source = normalizeCustomerSource(customer?.source);
    document.getElementById('editSource').value = source === 'unknown' ? '' : source;
    document.getElementById('editSocialIdentities').value = formatSocialIdentitiesInput(customer?.socialIdentities || []);
    document.getElementById('editNotes').value = customer?.notes || '';
    setCustomerEditingTags(customer?.tags || []);
    closeCustomerEditTagDropdown();
    const customTagInput = document.getElementById('editCustomTagInput');
    if (customTagInput) customTagInput.value = '';
    renderCustomerEditTags();
    syncCustomerEditBusinessFields();

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
        setCustomerEditingTags([]);
        setCustomerEditingChildren([]);
        closeCustomerEditTagDropdown();
        renderCustomerEditTags();
        renderCustomerEditChildren();
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
    if (!guardCustomerWrite(CrmState.editingId ? 'редагувати клієнтів' : 'створювати клієнтів')) return;
    const name = document.getElementById('editName')?.value.trim();
    if (!name) {
        showNotification("Ім'я клієнта обов'язкове", 'error');
        return;
    }
    const children = isMaysternyaCustomerContext() ? [] : serializedCustomerEditingChildren();
    const incompleteChild = children.find(child => !child.name && (child.birthday || child.ageSnapshot || child.note));
    if (incompleteChild) {
        showNotification('Вкажіть імʼя для кожної дитини або очистіть порожній рядок', 'error');
        return;
    }
    const invalidAgeChild = children.find(child => child.ageSnapshot !== '' && (!Number.isInteger(Number(child.ageSnapshot)) || Number(child.ageSnapshot) < 0 || Number(child.ageSnapshot) > 120));
    if (invalidAgeChild) {
        showNotification('Вік дитини має бути числом від 0 до 120', 'error');
        return;
    }
    const firstChild = children[0] || null;

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
        childName: firstChild?.name || null,
        childBirthday: firstChild?.birthday || null,
        children: children.map(child => ({
            name: child.name,
            birthday: child.birthday || null,
            ageSnapshot: child.ageSnapshot === '' ? null : Number(child.ageSnapshot),
            note: child.note || null
        })),
        socialIdentities: parseSocialIdentitiesInput(document.getElementById('editSocialIdentities')?.value),
        source: document.getElementById('editSource')?.value || null,
        notes: document.getElementById('editNotes')?.value.trim() || null,
        tags: CrmState.editingTags.map(item => ({ tag: item.tag, color: item.color }))
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
        if (result?.id) {
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
    if (!guardCustomerWrite('редагувати клієнтів')) return;
    const customer = await fetchCustomerDetail(id);
    closeCustomerDetailModal();
    openEditModal(customer);
};

window.confirmDeleteCustomer = async function(id) {
    if (!guardCustomerWrite('видаляти клієнтів')) return;
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

const pendingCustomerTagActions = new Set();

function setCustomerTagActionButtonState(button, busyText) {
    if (!button) return () => {};
    const previous = {
        disabled: button.disabled,
        text: button.textContent,
        ariaBusy: button.getAttribute('aria-busy')
    };
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-loading');
    if (busyText) button.textContent = busyText;
    return () => {
        button.disabled = previous.disabled;
        if (previous.ariaBusy === null) button.removeAttribute('aria-busy');
        else button.setAttribute('aria-busy', previous.ariaBusy);
        button.classList.remove('is-loading');
        button.textContent = previous.text;
    };
}

async function refreshCustomerTagSurfaces(customerId) {
    await showCustomerDetail(customerId);
    await refreshData();
    renderCustomerTable();
    renderPagination();
    renderTagFilters();
}

window.removeTag = async function(customerId, tagId, button) {
    if (!guardCustomerWrite('редагувати теги клієнта')) return;
    const actionKey = `remove:${customerId}:${tagId}`;
    if (pendingCustomerTagActions.has(actionKey)) return;
    pendingCustomerTagActions.add(actionKey);
    const restoreButton = setCustomerTagActionButtonState(button, '...');
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch(customerApiUrl(`/api/customers/${customerId}/tags/${tagId}`), {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || 'Не вдалося видалити тег');
        }
        await refreshCustomerTagSurfaces(customerId);
    } catch (err) {
        console.error('removeTag error', err);
        if (typeof showNotification === 'function') showNotification('Помилка видалення тегу: ' + err.message, 'error');
    } finally {
        restoreButton();
        pendingCustomerTagActions.delete(actionKey);
    }
};

window.showAddTagDropdown = function(customerId) {
    if (!guardCustomerWrite('редагувати теги клієнта')) return;
    const container = document.getElementById('detailTags');
    if (!container) return;
    // Remove existing dropdown
    const old = container.querySelector('.crm-tag-dropdown');
    if (old) { old.remove(); return; }
    const catalog = getCustomerTagCatalog();
    const dropdown = document.createElement('div');
    dropdown.className = 'crm-tag-dropdown';
    dropdown.innerHTML = catalog.length
        ? catalog.map((item, index) => `<button type="button" class="crm-tag-option" data-tag-index="${index}">${escapeHtml(item.tag)}</button>`).join('')
        : '<div class="crm-tag-option" aria-disabled="true">Немає доступних тегів</div>';
    dropdown.querySelectorAll('[data-tag-index]').forEach(button => {
        const item = catalog[Number.parseInt(button.dataset.tagIndex, 10)];
        if (!item) return;
        button.style.color = item.color;
        button.addEventListener('click', () => window.addTag(customerId, item.tag, item.color, button));
    });
    container.appendChild(dropdown);
};

window.addTag = async function(customerId, tag, color, button) {
    if (!guardCustomerWrite('редагувати теги клієнта')) return;
    const actionKey = `add:${customerId}:${String(tag || '').trim()}`;
    if (pendingCustomerTagActions.has(actionKey)) return;
    pendingCustomerTagActions.add(actionKey);
    const restoreButton = setCustomerTagActionButtonState(button, 'Додаю...');
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch(customerApiUrl(`/api/customers/${customerId}/tags`), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag, color })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || 'Не вдалося додати тег');
        }
        if (payload.message && !payload.tag && typeof showNotification === 'function') {
            showNotification(payload.message, 'info');
        }
        await refreshCustomerTagSurfaces(customerId);
    } catch (err) {
        console.error('addTag error', err);
        if (typeof showNotification === 'function') showNotification('Помилка додавання тегу: ' + err.message, 'error');
    } finally {
        restoreButton();
        pendingCustomerTagActions.delete(actionKey);
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
        applyCustomerReadOnlyControls(el);
    } catch { /* duplicates load failed */ }
}

window.mergeCustomers = async function(primaryId, duplicateId) {
    if (!guardCustomerWrite('обʼєднувати клієнтів')) return;
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

async function loadCommunicationHub(customerId, preloadedContext = null) {
    const hubEl = document.getElementById('customerCommHub');
    if (!hubEl) return;

    if (preloadedContext) {
        hubEl.innerHTML = renderCustomerCommunicationHub(preloadedContext);
        return;
    }

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
    if (!guardCustomerWrite('додавати CRM-нотатки')) return;
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

function npsSegment(score) {
    const value = parseInt(score, 10);
    if (value >= 9) return { key: 'promoter', label: 'Promoter', color: '#059669' };
    if (value >= 7) return { key: 'passive', label: 'Passive', color: '#D97706' };
    return { key: 'detractor', label: 'Detractor', color: '#DC2626' };
}

function renderNpsExplainer(totalResponses) {
    const zeroChecklist = totalResponses > 0 ? '' : `
        <ol class="nps-zero-checklist">
            <li>Ще немає NPS-відповідей у цьому бізнес-контексті.</li>
            <li>NPS з'явиться після відповіді клієнта на кнопку 0-10 у Telegram.</li>
        </ol>`;
    return `<div class="nps-explainer">
        <div class="nps-explainer-title">NPS 0-10</div>
        <p class="nps-explainer-text">NPS = % promoters - % detractors. Promoters: 9-10, passives: 7-8, detractors: 0-6.</p>
        <div class="nps-explainer-grid">
            <div class="nps-explainer-item">
                <strong>Promoters</strong>
                <span>9-10, готові рекомендувати.</span>
            </div>
            <div class="nps-explainer-item">
                <strong>Passives</strong>
                <span>7-8, нейтральні відповіді.</span>
            </div>
            <div class="nps-explainer-item">
                <strong>Detractors</strong>
                <span>0-6, потребують уваги.</span>
            </div>
        </div>
        ${zeroChecklist}
    </div>`;
}

function renderNpsDistribution(distribution = []) {
    const counts = new Map((distribution || []).map(item => [parseInt(item.score, 10), parseInt(item.count, 10) || 0]));
    const maxCount = Math.max(1, ...Array.from(counts.values()));
    return [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(score => {
        const count = counts.get(score) || 0;
        const pct = Math.round(count / maxCount * 100);
        const segment = npsSegment(score);
        return `<div class="nps-bar-row">
            <span class="nps-bar-label">${score}</span>
            <div class="nps-bar-track"><div class="nps-bar-fill" style="width:${pct}%;background:${segment.color}"></div></div>
            <span class="nps-bar-count">${count}</span>
        </div>`;
    }).join('');
}

function renderLegacyReviewsSection(legacyReviews = {}) {
    const total = parseInt(legacyReviews.total, 10) || 0;
    if (!total) return '';
    const avg = parseFloat(legacyReviews.avgRating) || 0;
    const distribution = legacyReviews.distribution || [];
    const counts = new Map(distribution.map(item => [parseInt(item.rating, 10), parseInt(item.count, 10) || 0]));
    const maxCount = Math.max(1, ...Array.from(counts.values()));
    const recent = legacyReviews.recent || [];
    const bars = [5, 4, 3, 2, 1].map(rating => {
        const count = counts.get(rating) || 0;
        const pct = Math.round(count / maxCount * 100);
        return `<div class="nps-bar-row">
            <span class="nps-bar-label">${rating}/5</span>
            <div class="nps-bar-track"><div class="nps-bar-fill" style="width:${pct}%;background:#64748B"></div></div>
            <span class="nps-bar-count">${count}</span>
        </div>`;
    }).join('');
    const recentRows = recent.length ? recent.map(r => `<tr>
        <td class="customer-name">${escapeHtml(r.customer_name || r.customerName || '—')}</td>
        <td>${parseInt(r.rating, 10) || 0}/5</td>
        <td>${escapeHtml(r.comment || '—')}</td>
        <td>${formatDate(r.created_at || r.createdAt)}</td>
    </tr>`).join('') : `<tr><td colspan="4">Немає останніх legacy оцінок</td></tr>`;
    return `<div class="nps-legacy-section">
        <div class="nps-section-title">Післяподієві оцінки 1-5</div>
        <div class="nps-dashboard">
            <div class="nps-score-card">
                <div class="nps-big-score nps-legacy-score">${avg.toFixed(1)}</div>
                <div class="nps-score-label">Середня legacy оцінка</div>
                <div class="nps-score-meta">${total} відповідей 1-5</div>
            </div>
            <div class="nps-score-card">
                <div class="nps-section-title nps-section-title--compact">Розподіл 1-5</div>
                ${bars}
            </div>
        </div>
        <div class="nps-table-block">
            <div class="nps-section-title nps-section-title--compact">Останні legacy оцінки</div>
            <div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Клієнт</th><th>Оцінка</th><th>Коментар</th><th>Дата</th></tr></thead><tbody>${recentRows}</tbody></table></div>
        </div>
    </div>`;
}

async function loadNps() {
    const token = localStorage.getItem('pzp_token');
    const el = document.getElementById('tabNps');
    try {
        const res = await fetch(customerApiUrl('/api/customers/nps-stats'), { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!data.success) { el.innerHTML = '<div class="crm-empty"><div class="empty-icon">📊</div><div class="empty-text">Дані NPS недоступні</div></div>'; return; }

        const npsScore = parseInt(data.npsScore ?? data.avgNps ?? 0, 10) || 0;
        const total = parseInt(data.totalResponses ?? data.totalReviews, 10) || 0;
        const dist = data.distribution || [];
        const recent = data.recentResponses || data.recentReviews || data.recent || [];
        const sentCount = parseInt(data.sentCount, 10) || 0;
        const responseRate = Number(data.responseRate || 0);
        const responseRatePct = Math.round(responseRate * 1000) / 10;
        const promoters = parseInt(data.promoters, 10) || 0;
        const passives = parseInt(data.passives, 10) || 0;
        const detractors = parseInt(data.detractors, 10) || 0;
        const promoterPercent = Number(data.promoterPercent || 0);
        const passivePercent = Number(data.passivePercent || 0);
        const detractorPercent = Number(data.detractorPercent || 0);

        const scoreColor = npsScore >= 50 ? '#059669' : npsScore >= 0 ? '#D97706' : '#DC2626';
        const recentRows = recent.length ? recent.map(r => {
            const score = parseInt(r.nps_score ?? r.npsScore, 10);
            const segment = npsSegment(score);
            return `<tr>
                <td class="customer-name">${escapeHtml(r.customer_name || r.customerName || '—')}</td>
                <td><span class="nps-pill" style="background:${segment.color}">${Number.isInteger(score) ? score : 0}/10</span></td>
                <td>${segment.label}</td>
                <td>${escapeHtml(r.comment || '—')}</td>
                <td>${formatDate(r.created_at || r.createdAt)}</td>
            </tr>`;
        }).join('') : `<tr><td colspan="5">NPS-відповідей ще немає</td></tr>`;

        el.innerHTML = `${renderNpsExplainer(total)}
        <div class="nps-dashboard">
            <div class="nps-score-card">
                <div class="nps-big-score" style="color:${scoreColor}">${npsScore}</div>
                <div class="nps-score-label">NPS</div>
                <div class="nps-score-meta">${total} відповідей · діапазон -100..100</div>
            </div>
            <div class="nps-score-card">
                <div class="nps-big-score nps-response-rate">${responseRatePct.toFixed(1)}%</div>
                <div class="nps-score-label">Response rate</div>
                <div class="nps-score-meta">${total} відповідей із ${sentCount} запитів</div>
            </div>
            <div class="nps-score-card">
                <div class="nps-section-title nps-section-title--compact">Breakdown</div>
                <div class="nps-breakdown">
                    <div><strong>${promoters}</strong><span>Promoters ${promoterPercent.toFixed(1)}%</span></div>
                    <div><strong>${passives}</strong><span>Passives ${passivePercent.toFixed(1)}%</span></div>
                    <div><strong>${detractors}</strong><span>Detractors ${detractorPercent.toFixed(1)}%</span></div>
                </div>
            </div>
            <div class="nps-score-card">
                <div class="nps-section-title nps-section-title--compact">Розподіл 0-10</div>
                ${renderNpsDistribution(dist)}
            </div>
        </div>
        <div class="nps-table-block">
            <div class="nps-section-title">Останні NPS-відповіді</div>
            <div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Клієнт</th><th>NPS</th><th>Група</th><th>Коментар</th><th>Дата</th></tr></thead><tbody>${recentRows}</tbody></table></div>
        </div>
        ${renderLegacyReviewsSection(data.legacyReviews || {})}`;
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
            ${renderCustomerTagOptions('', 'Всі клієнти', { includeBirthdaySystemTags: true, includeCurrentBirthdayShortcut: true })}
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
    const touchWindow = typeof openTouchDownloadWindow === 'function'
        ? openTouchDownloadWindow('vCard клієнтів')
        : null;
    fetch(customerApiUrl('/api/customers/export-vcf'), {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => res.blob()).then(blob => {
        const filename = `customers_${new Date().toISOString().slice(0, 10)}.vcf`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'vCard підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showNotification('vCard завантажено');
        }
    }).catch(() => {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Помилка експорту vCard', 'error');
    });
}

async function importVcf(file) {
    if (!guardCustomerWrite('імпортувати клієнтів')) return;
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
    await Promise.all([fetchCustomers(), fetchStats(), fetchCustomerTags()]);
    renderTagFilters();
    renderStats();
    renderCustomerTable();
    renderPagination();
    syncCustomerReadOnlyUi();
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
    const touchWindow = typeof openTouchDownloadWindow === 'function'
        ? openTouchDownloadWindow('CSV клієнтів')
        : null;
    // Use a hidden link to trigger download with auth
    fetch(customerApiUrl('/api/customers/export'), {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => res.blob()).then(blob => {
        const filename = `customers_${new Date().toISOString().slice(0, 10)}.csv`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'CSV підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showNotification('CSV завантажено');
        }
    }).catch(() => {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Помилка експорту', 'error');
    });
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
    syncCustomerReadOnlyUi();

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
    document.getElementById('addCustomerBtn')?.addEventListener('click', () => {
        if (!guardCustomerWrite('створювати клієнтів')) return;
        openEditModal(null);
    });

    // Export
    document.getElementById('exportCsvBtn')?.addEventListener('click', downloadCSV);

    // vCard
    document.getElementById('exportVcfBtn')?.addEventListener('click', exportVcf);
    document.getElementById('importVcfBtn')?.addEventListener('click', () => {
        if (!guardCustomerWrite('імпортувати клієнтів')) return;
        document.getElementById('vcfFileInput')?.click();
    });
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
    bindCustomerEditTagTools();
    bindCustomerEditChildrenTools();
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
