/**
 * hr-page.js — HR module frontend (v30.7)
 *
 * Grouped sections: company pulse, people, structure, salary/KPI, temporary leftovers.
 * API: /api/hr/*
 */

// ==========================================
// CONSTANTS
// ==========================================

const ROLE_LABELS = {
    creator: 'Творець', director: 'Директор', vice_director: 'Зам. директора',
    senior_manager: 'Старший менеджер', manager: 'Менеджер',
    accountant: 'Бухгалтер', art_director: 'Арт-директор', marketer: 'Маркетолог',
    it_specialist: 'IT-спеціаліст', hr: 'HR', hr_manager: 'HR',
    admin: 'Адмін', security: 'Охорона',
    senior_instructor: 'Адміністратор ігрових зон', instructor: 'Інструктор батутів',
    trampoline_instructor: 'Інструктор батутів',
    head_chef: 'Кухар', head_cook: 'Кухар', cook: 'Кухар',
    head_pastry: 'Шеф-кондитер', pastry_chef: 'Кондитер',
    animator: 'Аніматор', host: 'Ведуча', technician: 'Технічний директор',
    reception: 'Рецепція', barista: 'Бариста', bartender: 'Бариста',
    waiter: 'Офіціант', wardrobe: 'Гардеробник',
    cleaning: 'Прибиральник', cleaner: 'Прибиральник', maintenance: 'Технічний директор',
    pizzaiolo: 'Піцайоло',
    dishwasher: 'Посудомийник', intern: 'Стажер'
};

const STATUS_LABELS = {
    present: 'На роботі', late: 'Запізнився', absent: 'Відсутній',
    clocked_in: 'На роботі', early_leave: 'Пішов раніше', no_show: 'Не з\'явився',
    sick: 'Лікарняний', vacation: 'Відпустка', day_off: 'Вихідний',
    auto_closed: 'Авто-закрито', unscheduled: 'Без розкладу'
};

const DAYS_UK = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_UK = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const MONTHS_SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
const HR_POOL_LABELS = {
    core: 'Основна команда',
    reserve: 'Резерв',
    blacklisted: 'Чорний список'
};

const STAFF_RATE_UNIT_LABELS = {
    hour: 'За годину',
    day: 'За день',
    month: 'За місяць'
};

const STAFF_DOCUMENT_TYPE_LABELS = {
    passport: 'Паспорт',
    tax_id: 'ІПН',
    contract: 'Договір',
    medical_book: 'Медкнижка',
    certificate: 'Сертифікат',
    training: 'Навчання',
    other: 'Інше'
};

const STAFF_RESOURCE_KIND_LABELS = {
    warehouse_stock: 'Склад',
    costume: 'Костюм',
    custom: 'Ручний ресурс'
};

const STAFF_RESOURCE_STATUS_LABELS = {
    issued: 'Видано',
    returned: 'Повернуто',
    lost: 'Втрачено',
    written_off: 'Списано'
};

const STAFF_ROLE_STATUS_LABELS = {
    active: 'Активна',
    inactive: 'Неактивна',
    suspended: 'Призупинена'
};

const STAFF_ROLE_ADMISSION_LABELS = {
    pending: 'Очікує допуск',
    approved: 'Допущено',
    blocked: 'Заблоковано'
};

const STAFF_ROLE_INTERNSHIP_LABELS = {
    none: 'Без стажування',
    in_progress: 'Стажування',
    completed: 'Завершено'
};

const PAYROLL_SCHEME_LABELS = {
    per_shift: 'Сума за вихід',
    hourly: 'Погодинна',
    monthly_fixed: 'Фікс за місяць',
    percent: 'Відсоток',
    hybrid: 'Гібридна',
    manual: 'Ручна'
};

const STAFF_OFFBOARDING_ACCOUNT_LABELS = {
    none: 'Акаунт не змінювався',
    review: 'Потрібна ручна перевірка акаунту',
    disable: 'CRM-акаунт вимкнено'
};

const STAFF_OFFBOARDING_DOC_SOURCE_LABELS = {
    document: 'Документ',
    certification: 'Сертифікація'
};

const STAFF_DEPARTMENT_LABELS = {
    animators: 'Аніматори',
    trampoline: 'Батутисти',
    admin: 'Адміністрація',
    cafe: 'Кафе',
    tech: 'Технічний відділ',
    cleaning: 'Прибирання',
    security: 'Охорона'
};

function hrPulseSwitcher() {
    return typeof window !== 'undefined' ? window.HrPulseSwitcher : null;
}

function hrPulseNavItems() {
    const switcher = hrPulseSwitcher();
    if (!switcher || typeof switcher.items !== 'function') return [];
    return switcher.items().map(item => ({
        ...item,
        href: item.hrHref || ''
    }));
}

function renderHrPulseNavButton(item, badge) {
    const switcher = hrPulseSwitcher();
    if (!switcher || typeof switcher.renderTab !== 'function') return '';
    return switcher.renderTab({ ...item, badge }, {
        tag: 'button',
        className: 'hr-tab hr-pulse-card ui-tab-card',
        classPrefix: 'hr-pulse-card',
        attrs: pulseItem => ({
            'data-nav-id': pulseItem.id,
            'data-tab': pulseItem.tab || pulseItem.id,
            'data-href': pulseItem.href || ''
        })
    });
}

const hrPulseCardBadges = new Map([
    ['reports', { value: 'CSV', title: 'CSV експорт', ariaLabel: 'Звіти доступні для CSV експорту' }]
]);

function applyPulseCardBadgeToElement(badge, state) {
    const visible = Boolean(state?.value);
    badge.textContent = visible ? state.value : '';
    badge.classList.toggle('hidden', !visible);
    badge.hidden = !visible;
    if (visible && state.title) badge.title = state.title;
    else badge.removeAttribute('title');
    if (visible && state.ariaLabel) badge.setAttribute('aria-label', state.ariaLabel);
    else badge.removeAttribute('aria-label');
}

function applyPulseCardBadge(navId) {
    if (typeof document === 'undefined') return;
    const id = String(navId || '').trim();
    if (!id) return;
    const state = hrPulseCardBadges.get(id);
    document.querySelectorAll('.hr-pulse-card-badge[data-pulse-badge]').forEach(badge => {
        if (badge.dataset.pulseBadge === id) applyPulseCardBadgeToElement(badge, state);
    });
}

function applyPulseCardBadges() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.hr-pulse-card-badge[data-pulse-badge]').forEach(badge => {
        applyPulseCardBadgeToElement(badge, hrPulseCardBadges.get(badge.dataset.pulseBadge));
    });
}

function setPulseCardBadge(navId, value, options = {}) {
    const id = String(navId || '').trim();
    if (!id) return;
    const text = value === null || value === undefined ? '' : String(value).trim();
    const shouldHide = options.hidden === true || text === '' || (options.hideZero === true && Number(value) === 0);
    if (shouldHide) {
        hrPulseCardBadges.delete(id);
    } else {
        hrPulseCardBadges.set(id, {
            value: text,
            title: options.title ? String(options.title) : '',
            ariaLabel: options.ariaLabel ? String(options.ariaLabel) : ''
        });
    }
    applyPulseCardBadge(id);
}

const HR_NAV_GROUPS = [
    {
        id: 'pulse',
        label: 'Пульс компанії',
        items: hrPulseNavItems()
    },
    {
        id: 'people',
        label: 'Команда',
        items: [
            { id: 'workers', label: 'Робітники', tab: 'team', bucket: 'workers', visible: () => canSeeHrTeamBucket('workers') },
            { id: 'interns', label: 'Стажери', tab: 'team', bucket: 'interns', visible: () => canSeeHrTeamBucket('interns') },
            { id: 'blacklist', label: 'Чорний список', tab: 'team', bucket: 'blacklist', visible: () => canSeeHrTeamBucket('blacklist') },
            { id: 'reserve', label: 'Резерв', tab: 'team', bucket: 'reserve', visible: () => canSeeHrTeamBucket('reserve') },
            { id: 'dismissed', label: 'Звільнені', tab: 'team', bucket: 'dismissed', visible: () => canSeeHrTeamBucket('dismissed') }
        ]
    },
    {
        id: 'structure',
        label: 'Структура компанії',
        items: [
            { id: 'structure', label: 'Структура' },
            { id: 'professions', label: 'Професії' },
            { id: 'checklists', label: 'Чеклисти' },
            { id: 'accounts', label: 'Акаунти', visible: () => canManageAccountSecurity() }
        ]
    },
    {
        id: 'payroll',
        label: 'ЗП та KPI',
        items: [
            { id: 'salary', label: 'Зарплата' },
            { id: 'zrs', label: 'ЗРС' },
            { id: 'kpi', label: 'KPI' }
        ]
    },
    {
        id: 'other',
        label: 'Вакансії',
        note: 'найм, відгуки, співбесіди, шаблони платформ',
        items: [
            { id: 'vacancies', label: 'Вакансії' }
        ]
    }
];

const HR_STRUCTURE_WORKSPACE_TABS = new Set(['structure', 'professions', 'checklists', 'accounts']);
const HR_PAYROLL_WORKSPACE_TABS = new Set(['salary', 'zrs', 'kpi']);
const HR_OTHER_WORKSPACE_TABS = new Set(['vacancies']);
const HR_PULSE_WORKSPACE_TABS = new Set(['today', 'schedule', 'reports']);
const HR_PEOPLE_WORKSPACE_TABS = new Set(['team']);

const HR_TAB_ALIASES = {
    other: { tab: 'vacancies' },
    payroll: { tab: 'salary' },
    workers: { tab: 'team', bucket: 'workers' },
    rating: { tab: 'kpi' },
    ratings: { tab: 'kpi' },
    leaves: { tab: 'schedule' },
    reserve: { tab: 'team', bucket: 'reserve' },
    blacklist: { tab: 'team', bucket: 'blacklist' },
    dismissed: { tab: 'team', bucket: 'dismissed' },
    fired: { tab: 'team', bucket: 'dismissed' },
    terminated: { tab: 'team', bucket: 'dismissed' },
    interns: { tab: 'team', bucket: 'interns' },
    'ai-team': { tab: 'today' }
};

const PEOPLE_BUCKETS = [
    {
        id: 'workers',
        title: 'Робітники',
        note: 'Основна команда без стажерів'
    },
    {
        id: 'interns',
        title: 'Стажери',
        note: 'Активні стажери та працівники у навчальному статусі'
    },
    {
        id: 'blacklist',
        title: 'Чорний список',
        note: 'Сервісний список із причинами та діями повернення'
    },
    {
        id: 'reserve',
        title: 'Резерв',
        note: 'Кандидати та працівники резервного пулу'
    },
    {
        id: 'dismissed',
        title: 'Звільнені',
        note: 'Архів неактивних профілів після offboarding'
    }
];

const HR_TEAM_MOVE_TARGETS = [
    {
        id: 'workers',
        label: 'Робітники',
        hint: 'Основна команда. Якщо це стажер, треба вибрати нову основну професію.'
    },
    {
        id: 'interns',
        label: 'Стажери',
        hint: 'Профіль стане стажером, а попередня професія збережеться як додаткова.'
    },
    {
        id: 'reserve',
        label: 'Резерв',
        hint: 'Профіль піде в резервний пул без зміни професій.'
    },
    {
        id: 'blacklist',
        label: 'Чорний список',
        hint: 'Потрібна причина, професії не змінюються.'
    }
];

function getHrCurrentUser() {
    try {
        return typeof AppState !== 'undefined' ? AppState.currentUser : null;
    } catch {
        return null;
    }
}

function getHrTeamBucketAccess() {
    return typeof window !== 'undefined' ? window.HrTeamBucketAccess : null;
}

function canSeeHrTeamBucket(bucketId, user = getHrCurrentUser()) {
    const access = getHrTeamBucketAccess();
    if (access && typeof access.canSeeBucket === 'function') {
        return access.canSeeBucket(bucketId, user) !== false;
    }
    return PEOPLE_BUCKETS.some(bucket => bucket.id === bucketId);
}

function canManageHrTeamBucketVisibility(user = getHrCurrentUser()) {
    const access = getHrTeamBucketAccess();
    return Boolean(access && typeof access.canManage === 'function' && access.canManage(user));
}

function visiblePeopleBuckets(user = getHrCurrentUser()) {
    return PEOPLE_BUCKETS.filter(bucket => canSeeHrTeamBucket(bucket.id, user));
}

function firstVisiblePeopleBucketId(user = getHrCurrentUser()) {
    return visiblePeopleBuckets(user)[0]?.id || 'workers';
}

function normalizeVisiblePeopleBucket(bucketId, user = getHrCurrentUser()) {
    const requested = String(bucketId || '').trim();
    if (requested && canSeeHrTeamBucket(requested, user)) return requested;
    return firstVisiblePeopleBucketId(user);
}

// ==========================================
// STATE
// ==========================================

let canManage = false;
let todayData = null;
let todayFilters = { query: '', department: 'all' };
let scheduleWeekStart = null;
let scheduleView = 'week'; // week | month
let scheduleShifts = [];
let scheduleStaff = [];
let shiftTemplates = [];
let editingShift = null; // { staffId, date, existing? }
let contextStaffId = null;
let pollTimer = null;
let hrProfessions = [];
let activePeopleBucket = null;
let pendingPeopleBucket = null;
let draggedTeamStaffId = null;
let staffFoundationLoadSeq = 0;
let staffResourceOptionsLoadSeq = 0;
let staffRoleAssignmentsLoadSeq = 0;
let staffPayrollSchemeLoadSeq = 0;
let staffOffboardingReadiness = null;
let staffLifecycleLoadSeq = 0;
let hrRealtimeRefreshTimer = null;

// ==========================================
// HELPERS
// ==========================================


function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJsString(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n');
}

function normalizeProfessionKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .slice(0, 64);
}

function normalizeProfessionList(value, exclude = []) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string'
            ? (() => {
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : value.split(/[\n,;]+/);
                } catch {
                    return value.split(/[\n,;]+/);
                }
            })()
            : []);
    const blocked = new Set(exclude.map(normalizeProfessionKey).filter(Boolean));
    const seen = new Set();
    const result = [];
    source.forEach(item => {
        const key = normalizeProfessionKey(item);
        if (!key || blocked.has(key) || seen.has(key)) return;
        seen.add(key);
        result.push(key);
    });
    return result;
}

function professionTitle(key) {
    const normalized = normalizeProfessionKey(key);
    const profession = hrProfessions.find(item => normalizeProfessionKey(item.key) === normalized);
    return profession?.title || ROLE_LABELS[normalized] || normalized;
}

function staffSecondaryProfessions(staff = {}) {
    return normalizeProfessionList(staff.secondary_professions || staff.secondaryProfessions, [staff.role_type]);
}

function staffHasProfession(staff = {}, key = '') {
    const normalized = normalizeProfessionKey(key);
    if (!normalized) return true;
    return normalizeProfessionKey(staff.role_type) === normalized || staffSecondaryProfessions(staff).includes(normalized);
}

function staffProfessionOptions(staff = {}, current = '') {
    const selected = normalizeProfessionKey(current);
    const keys = normalizeProfessionList([
        staff.role_type,
        ...staffSecondaryProfessions(staff),
        selected
    ]);
    return keys.map(key => ({
        value: key,
        label: professionTitle(key),
        selected: selected ? key === selected : key === normalizeProfessionKey(staff.role_type)
    }));
}

function normalizeSearchText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['`\u2019\u02bc]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDepartmentKey(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
    return normalized ? normalized.slice(0, 80) : 'none';
}

function departmentLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Без відділу';
    const key = normalizeDepartmentKey(raw);
    if (STAFF_DEPARTMENT_LABELS[key]) return STAFF_DEPARTMENT_LABELS[key];
    return raw
        .split(/[_-]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function companyStructureSelectOptions(current = '') {
    const selected = String(current || '');
    const options = sortCompanyStructureNodes(companyStructureNodes || []).map(node => ({
        value: node.id,
        label: `${node.title}${node.meta ? ' - ' + node.meta : ''}`,
        selected: node.id === selected
    }));
    return [{ value: '', label: 'Без привʼязки', selected: !selected }, ...options];
}

function renderSelectOptions(options = [], selected = '') {
    const selectedValue = String(selected || '');
    return options.map(option => {
        const value = String(option.value ?? '');
        const isSelected = option.selected || value === selectedValue;
        return `<option value="${escapeHtml(value)}"${isSelected ? ' selected' : ''}>${escapeHtml(option.label ?? value)}</option>`;
    }).join('');
}

function companyStructureNodeTitle(nodeId = '') {
    const normalized = String(nodeId || '').trim();
    if (!normalized) return '';
    const node = companyStructureNodeById(normalized);
    return node?.title || normalized;
}

function professionStructureNodeId(professionKey = '') {
    const key = normalizeProfessionKey(professionKey);
    const profession = hrProfessions.find(item => normalizeProfessionKey(item.key) === key);
    return profession?.structure_node_id || profession?.structureNodeId || '';
}

function staffStructureNodeId(staff = {}) {
    return staff.company_structure_node_id || staff.companyStructureNodeId || professionStructureNodeId(staff.role_type);
}

function staffStructureNodeTitle(staff = {}) {
    return companyStructureNodeTitle(staffStructureNodeId(staff));
}

function staffProfessionRateRows(staff = {}) {
    return Array.isArray(staff.profession_rates || staff.professionRates)
        ? (staff.profession_rates || staff.professionRates)
        : [];
}

function normalizeStaffRateUnit(value) {
    const unit = String(value || '').trim().toLowerCase();
    if (['day', 'daily', 'per_day', 'per-day'].includes(unit)) return 'day';
    if (['month', 'monthly', 'per_month', 'per-month'].includes(unit)) return 'month';
    return 'hour';
}

function staffRateUnit(staff = {}) {
    return normalizeStaffRateUnit(staff.rate_unit || staff.rateUnit);
}

function currentEditRateUnit(staff = {}) {
    return normalizeStaffRateUnit(document.getElementById('editRateUnit')?.value || staffRateUnit(staff));
}

function staffRateUnitSuffix(unit = 'hour') {
    const normalized = normalizeStaffRateUnit(unit);
    if (normalized === 'day') return 'день';
    if (normalized === 'month') return 'міс';
    return 'год';
}

function formatStaffRate(rate, unit = 'hour') {
    return `${Number(rate || 0)} ₴/${staffRateUnitSuffix(unit)}`;
}

function staffProfessionRateMap(staff = {}) {
    const map = new Map();
    staffProfessionRateRows(staff).forEach(row => {
        const key = normalizeProfessionKey(row.profession_key || row.professionKey || row.key);
        const rate = Number(row.hourly_rate ?? row.hourlyRate ?? row.rate);
        if (key && Number.isFinite(rate) && rate > 0) map.set(key, rate);
    });
    return map;
}

function staffProfessionRateFor(staff = {}, professionKey = '') {
    const key = normalizeProfessionKey(professionKey);
    const override = staffProfessionRateMap(staff).get(key);
    return Number.isFinite(override) && override > 0 ? override : Number(staff.hourly_rate || 0);
}

function staffProfileCompleteness(staff = {}) {
    const checks = [
        staff.name,
        staff.role_type,
        staff.phone,
        staff.emergency_contact || staff.emergency_phone,
        staff.birth_date,
        staff.address,
        Number(staff.hourly_rate || 0) > 0 || staffProfessionRateRows(staff).length > 0
    ];
    const done = checks.filter(Boolean).length;
    return { done, total: checks.length, percent: Math.round((done / checks.length) * 100) };
}

function renderStaffReadinessBadges(staff = {}) {
    const training = staffTrainingReadiness(staff);
    const profile = staffProfileCompleteness(staff);
    const structureTitle = staffStructureNodeTitle(staff);
    const badge = (state, title, value, label) => `
        <span class="hr-ready-badge ${state}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
            <b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small>
        </span>`;
    return `<div class="hr-ready-badges">
        ${badge(staff.has_face_descriptor ? 'is-ok' : 'is-warn', staff.has_face_descriptor ? 'Фото є' : 'Фото не додано', 'Фото', staff.has_face_descriptor ? 'є' : 'нема')}
        ${badge(staff.has_account ? 'is-ok' : 'is-warn', staff.has_account ? 'CRM акаунт є' : 'CRM акаунт не привʼязано', 'CRM', staff.has_account ? 'є' : 'нема')}
        ${badge(profile.percent >= 85 ? 'is-ok' : profile.percent >= 55 ? 'is-info' : 'is-warn', `Профіль заповнено на ${profile.percent}%`, 'Профіль', `${profile.done}/${profile.total}`)}
        ${badge(trainingTone(training.percent, training.total), training.total ? `Навчання ${training.completed}/${training.total}` : 'Навчальні чек-листи ще не створені', 'Навч.', training.total ? `${training.percent}%` : 'нема')}
        ${badge(structureTitle ? 'is-info' : 'is-muted', structureTitle ? `Структура: ${structureTitle}` : 'Не привʼязано до структури', 'Структ.', structureTitle ? 'є' : 'нема')}
    </div>`;
}

function renderStaffRateSummary(staff = {}) {
    const professionKeys = normalizeProfessionList([staff.role_type, ...staffSecondaryProfessions(staff)]);
    if (!professionKeys.length) return '';
    const unit = staffRateUnit(staff);
    const rates = professionKeys
        .map(key => ({ key, label: professionTitle(key), rate: staffProfessionRateFor(staff, key) }))
        .filter(item => Number(item.rate) > 0);
    if (!rates.length) return '';
    const baseRate = Number(staff.hourly_rate || 0);
    const hasOverrides = staffProfessionRateRows(staff).length > 0;
    if (!hasOverrides && baseRate > 0) return formatStaffRate(baseRate, unit);
    return rates.slice(0, 3).map(item => `${item.label}: ${formatStaffRate(item.rate, unit)}`).join(' · ');
}

function syncStaffProfileHeaderName(value) {
    const header = document.getElementById('editStaffHeaderName');
    if (header) header.textContent = String(value || '').trim() || 'ПІБ';
}

function teamSearchHaystack(staff = {}) {
    const professionTexts = normalizeProfessionList([staff.role_type, ...staffSecondaryProfessions(staff)])
        .flatMap(key => [key, professionTitle(key)]);
    return normalizeSearchText([
        staff.name,
        staff.phone,
        staff.position,
        staff.department,
        staff.address,
        staff.telegram_username,
        staffStructureNodeTitle(staff),
        HR_POOL_LABELS[staffPoolStatus(staff)],
        ...professionTexts
    ].filter(Boolean).join(' '));
}

function staffPoolStatus(staff = {}) {
    return staff.hr_pool_status || 'core';
}

function isInternStaff(staff = {}) {
    return normalizeProfessionKey(staff.role_type) === 'intern' || staffSecondaryProfessions(staff).includes('intern');
}

function bucketForStaff(staff = {}) {
    if (staff.is_active === false) return 'dismissed';
    const pool = staffPoolStatus(staff);
    if (pool === 'blacklisted') return 'blacklist';
    if (pool === 'reserve') return 'reserve';
    return isInternStaff(staff) ? 'interns' : 'workers';
}

function monthOptionLabel(date) {
    return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

function professionOptionsFromCatalog(current = '') {
    const currentKey = normalizeProfessionKey(current);
    const active = hrProfessions.filter(item => item.is_active !== false || normalizeProfessionKey(item.key) === currentKey);
    const catalogOptions = active.map(item => ({
        value: item.key,
        label: `${item.title}${item.department ? ' · ' + item.department : ''}`
    }));
    const known = new Set(catalogOptions.map(item => item.value));
    if (currentKey && !known.has(currentKey)) {
        catalogOptions.push({ value: currentKey, label: ROLE_LABELS[currentKey] || currentKey });
    }
    return catalogOptions.sort((a, b) => a.label.localeCompare(b.label, 'uk'));
}

function renderProfessionChips(keys = []) {
    const normalized = normalizeProfessionList(keys);
    if (!normalized.length) return '';
    return `<div class="hr-secondary-profession-row">${normalized.map(key => `<span class="hr-secondary-profession-chip">${escapeHtml(professionTitle(key))}</span>`).join('')}</div>`;
}

function staffTrainingReadiness(staff = {}) {
    const readiness = staff.training_readiness || staff.trainingReadiness || {};
    const total = Number(readiness.total || 0);
    const completed = Number(readiness.completed || 0);
    const percent = total ? Math.max(0, Math.min(100, Number(readiness.percent || Math.round((completed / total) * 100)))) : 0;
    return {
        ...readiness,
        total,
        completed,
        percent,
        professions: Array.isArray(readiness.professions) ? readiness.professions : []
    };
}

function trainingTone(percent, total = 0) {
    if (!total) return 'is-muted';
    if (percent >= 85) return 'is-ok';
    if (percent >= 45) return 'is-info';
    return 'is-warn';
}

function renderStaffTrainingReadiness(staff = {}) {
    const readiness = staffTrainingReadiness(staff);
    const tone = trainingTone(readiness.percent, readiness.total);
    const label = readiness.total
        ? `${readiness.completed}/${readiness.total} · ${readiness.percent}%`
        : 'Немає чек-листів';
    return `<button type="button" class="hr-team-training-readiness ${tone}" onclick="openStaffTrainingReadiness(${Number(staff.id)})" aria-label="Навчання ${escapeHtml(staff.name || '')}">
        <span class="hr-team-training-head">
            <b>Навчання</b>
            <span>${escapeHtml(label)}</span>
        </span>
        <span class="hr-team-training-meter" aria-hidden="true"><i style="width:${readiness.total ? readiness.percent : 0}%"></i></span>
    </button>`;
}

function onboardingStatusLabel(status) {
    const labels = {
        not_started: 'не стартував',
        in_progress: 'у процесі',
        blocked: 'блок',
        ready: 'готовий',
        completed: 'завершено'
    };
    return labels[status] || labels.in_progress;
}

function staffOnboardingAssignment(staff = {}) {
    const assignment = staff.onboarding_assignment || staff.onboardingAssignment || null;
    if (!assignment || typeof assignment !== 'object') return null;
    const taskSummary = assignment.task_summary || assignment.taskSummary || {};
    const total = Number(assignment.total_items || assignment.totalItems || 0);
    const completed = Number(assignment.completed_items || assignment.completedItems || 0);
    const percent = total > 0
        ? Math.max(0, Math.min(100, Number(assignment.percent || Math.round((completed / total) * 100))))
        : 0;
    return {
        ...assignment,
        responsibleUserId: Number(assignment.responsible_user_id || assignment.responsibleUserId || 0) || null,
        responsibleName: assignment.responsible_name
            || assignment.responsibleName
            || assignment.responsible?.name
            || assignment.responsible_username
            || assignment.responsible?.username
            || null,
        trainingStatus: assignment.training_status || assignment.trainingStatus || assignment.status || 'in_progress',
        total,
        completed,
        percent,
        taskSummary: {
            total: Number(taskSummary.total || assignment.generated_task_count || 0),
            active: Number(taskSummary.active || assignment.active_task_count || 0),
            completed: Number(taskSummary.completed || assignment.completed_task_count || 0)
        }
    };
}

function renderStaffOnboardingAssignment(staff = {}) {
    const assignment = staffOnboardingAssignment(staff);
    const hasResponsible = Boolean(assignment?.responsibleUserId);
    const tone = !assignment ? 'is-empty' : (assignment.trainingStatus === 'completed' ? 'is-ok' : (hasResponsible ? 'is-active' : 'is-empty'));
    const status = assignment ? onboardingStatusLabel(assignment.trainingStatus) : 'не призначено';
    const responsible = hasResponsible ? assignment.responsibleName : 'Відповідального немає';
    const percent = assignment ? assignment.percent : 0;
    const taskText = assignment
        ? `${assignment.taskSummary.active}/${assignment.taskSummary.total} активних задач`
        : 'задачі не створені';
    const action = hasResponsible ? 'Змінити' : 'Призначити';
    return `<div class="hr-team-onboarding-assignment ${tone}">
        <div class="hr-team-onboarding-assignment-head">
            <div>
                <b>Onboarding</b>
                <span>${escapeHtml(responsible)}</span>
            </div>
            ${canManage ? `<button type="button" onclick="openStaffOnboardingAssignment(${Number(staff.id)})">${action}</button>` : ''}
        </div>
        <div class="hr-team-onboarding-meta">
            <span>${escapeHtml(status)}</span>
            <span>${assignment ? `${assignment.completed}/${assignment.total} чек-лист` : 'чек-лист не стартував'}</span>
            <span>${escapeHtml(taskText)}</span>
        </div>
        <div class="hr-team-onboarding-meter" aria-hidden="true"><i style="width:${percent}%"></i></div>
    </div>`;
}

async function ensureOnboardingResponsibleCandidates(force = false) {
    if (Array.isArray(onboardingResponsibleCandidates) && !force) return onboardingResponsibleCandidates;
    const data = await hrFetch('/onboarding/responsible-candidates');
    onboardingResponsibleCandidates = Array.isArray(data?.data) ? data.data : [];
    return onboardingResponsibleCandidates;
}

function responsibleCandidateOptions(currentId = null) {
    const current = currentId ? String(currentId) : '';
    return (onboardingResponsibleCandidates || []).map(user => ({
        value: String(user.id),
        label: `${user.label || user.name || user.username || `User #${user.id}`}${user.role ? ` · ${ROLE_LABELS[user.role] || user.role}` : ''}`,
        selected: current && String(user.id) === current
    }));
}

window.openStaffOnboardingAssignment = async function(staffId) {
    if (!canManage) {
        showNotification('Призначати відповідальних можуть тільки HR/керівники', 'error');
        return;
    }
    const id = Number(staffId);
    const staff = teamStaff.find(item => Number(item.id) === id);
    try {
        const [candidates, current] = await Promise.all([
            ensureOnboardingResponsibleCandidates(true),
            hrFetch(`/staff/${id}/onboarding-assignment`)
        ]);
        if (!candidates.length) {
            showNotification('Немає активних користувачів, яких можна призначити відповідальними', 'warning');
            return;
        }
        const assignment = current?.data || staffOnboardingAssignment(staff) || {};
        const options = responsibleCandidateOptions(assignment.responsible_user_id || assignment.responsibleUserId || candidates[0]?.id);
        const result = await formModal(`Відповідальний за onboarding${staff?.name ? ` · ${staff.name}` : ''}`, [
            {
                key: 'responsibleUserId',
                label: 'Відповідальний',
                type: 'select',
                options,
                defaultValue: String(assignment.responsible_user_id || assignment.responsibleUserId || candidates[0]?.id || ''),
                required: true,
                hint: 'CRM створить або оновить задачі навчання для цього відповідального без дублів.'
            }
        ], { icon: '🎯', okText: 'Зберегти', type: 'info' });
        if (!result) return;
        const ownerId = Number(result.responsibleUserId);
        if (!Number.isInteger(ownerId) || ownerId <= 0) {
            showNotification('Оберіть відповідального', 'error');
            return;
        }
        const saved = await hrFetch(`/staff/${id}/onboarding-assignment`, 'PUT', { responsible_user_id: ownerId });
        if (!saved?.success) {
            showNotification(saved?.error || 'Не вдалося призначити відповідального', 'error');
            return;
        }
        showNotification(saved.action === 'reassigned' ? 'Відповідального оновлено' : 'Відповідального призначено', 'success');
        await loadTeam();
        const onboardingPanel = document.getElementById('onboardingList');
        if (onboardingPanel) loadOnboarding();
    } catch (error) {
        console.error('Onboarding assignment error', error);
        showNotification(error.message || 'Не вдалося оновити відповідального', 'error');
    }
};

function selectedSecondaryProfessionKeys() {
    const picker = document.getElementById('editSecondaryProfessionPicker');
    if (!picker) return [];
    try {
        return normalizeProfessionList(JSON.parse(picker.dataset.selected || '[]'), [document.getElementById('editRoleType')?.value]);
    } catch {
        return [];
    }
}

function setSelectedSecondaryProfessionKeys(keys = [], primaryRole = '') {
    const picker = document.getElementById('editSecondaryProfessionPicker');
    if (!picker) return;
    picker.dataset.selected = JSON.stringify(normalizeProfessionList(keys, [primaryRole]));
}

function staffMoveTargetOptions(currentBucket = 'workers') {
    return HR_TEAM_MOVE_TARGETS
        .filter(target => target.id !== currentBucket && target.id !== 'dismissed' && canSeeHrTeamBucket(target.id))
        .map(target => ({
            value: target.id,
            label: `${target.label} - ${target.hint}`
        }));
}

function preferredWorkerRoleForStaff(staff = {}) {
    const currentPrimary = normalizeProfessionKey(staff.role_type);
    if (currentPrimary && currentPrimary !== 'intern') return currentPrimary;
    const secondary = staffSecondaryProfessions(staff).filter(key => key !== 'intern');
    return secondary[0] || 'animator';
}

function professionSelectOptionsForStaffMove(staff = {}) {
    const preferred = preferredWorkerRoleForStaff(staff);
    return professionOptionsFromCatalog(preferred)
        .filter(option => normalizeProfessionKey(option.value) !== 'intern')
        .map(option => ({ ...option, selected: normalizeProfessionKey(option.value) === preferred }));
}

function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getWeekDates(monday) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function getMonthDates(year, month) {
    const dates = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
    }
    return dates;
}

function todayStr() { return formatDate(new Date()); }

function fmtTime(t) {
    if (!t) return '';
    return String(t).substring(0, 5);
}

function fmtTimeFromISO(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
}

function fmtMinutes(min) {
    if (!min || min <= 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}хв`;
    return m > 0 ? `${h}г ${m}хв` : `${h}г`;
}

function fmtMoney(n) {
    return new Intl.NumberFormat('uk-UA').format(n) + ' ₴';
}

function formatResumeFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} Б`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`;
    return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

async function hrFetch(path, options = {}, legacyBody = undefined) {
    let allowForbiddenResponse = false;
    if (options && typeof options === 'object' && !(options instanceof String)) {
        allowForbiddenResponse = options.allowForbiddenResponse === true;
        if (Object.prototype.hasOwnProperty.call(options, 'allowForbiddenResponse')) {
            const { allowForbiddenResponse: _allowForbiddenResponse, ...cleanOptions } = options;
            options = cleanOptions;
        }
    }
    const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
    const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
    if (typeof options === 'string') {
        options = {
            method: options,
            body: legacyBody !== undefined ? JSON.stringify(legacyBody) : undefined
        };
    } else if (options && options.body && typeof options.body !== 'string' && !(typeof FormData !== 'undefined' && options.body instanceof FormData)) {
        options = { ...options, body: JSON.stringify(options.body) };
    }
    const request = { ...options, headers: { ...headers, ...(options.headers || {}) } };
    const resp = typeof apiFetchWithAuthRetry === 'function'
        ? await apiFetchWithAuthRetry(`/api/hr${path}`, request)
        : await fetch(`/api/hr${path}`, request);
    if (!resp) return null;
    if (resp.status === 401 || (resp.status === 403 && !allowForbiddenResponse)) {
        localStorage.removeItem('pzp_token');
        location.href = '/';
        return null;
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { success: false, status: resp.status, error: data.error || `HTTP ${resp.status}` };
    return data;
}

async function crmApiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (options && options.body && typeof options.body !== 'string') {
        options = { ...options, body: JSON.stringify(options.body) };
    }
    const request = { ...options, headers: { ...headers, ...(options.headers || {}) } };
    const resp = typeof apiFetchWithAuthRetry === 'function'
        ? await apiFetchWithAuthRetry(path, request)
        : await fetch(path, request);
    if (!resp) return null;
    if (resp.status === 401 || resp.status === 403) {
        localStorage.removeItem('pzp_token');
        location.href = '/';
        return null;
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { success: false, status: resp.status, error: data.error || `HTTP ${resp.status}` };
    return data;
}

async function confirmHrAction(message, title = 'Підтвердження') {
    if (typeof customConfirm === 'function') return customConfirm(message, title);
    showNotification('Модалка підтвердження недоступна. Оновіть сторінку і повторіть дію.', 'error');
    return false;
}

// ==========================================
// PAGE INIT
// ==========================================

async function initPage() {
    try {
    initDarkMode();
    const user = await apiVerifyToken();
    if (!user) { window.location.href = '/'; return; }

    AppState.currentUser = user;
    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin'];
    canManage = MANAGE_ROLES.includes(user.role);

    removeLegacyAnimatorShiftSummary();
    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    initTabs();
    initScheduleControls();
    initModals();
    initContextMenu();
    initNewTabs();
    const initialTab = getInitialHrTab();
    await activateHrTab(initialTab, { updateHash: false });
    const employeeId = new URLSearchParams(window.location.search).get('employee');
    if (employeeId && /^\d+$/.test(employeeId)) {
        await activateHrTab('team', { updateHash: false });
        openStaffEdit(parseInt(employeeId, 10));
    }
    window.addEventListener('hashchange', () => {
        const tab = getInitialHrTab();
        activateHrTab(tab, { updateHash: false });
    });
    initHrRealtime();
    startPolling();
    } catch (err) {
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        if (typeof handleStandaloneInitError === 'function') {
            handleStandaloneInitError('hr', err, (failure) => {
                renderStandaloneFatalError({
                    moduleName: 'hr',
                    containerId: 'tab-today',
                    title: 'Не вдалося відкрити HR',
                    message: 'Авторизація пройшла, але ініціалізація HR-модуля впала.',
                    error: failure
                });
            });
        } else {
            console.error('HR initPage failed:', err);
        }
    }
}

function initNewTabs() {
    document.getElementById('leaveStatusFilter')?.addEventListener('change', loadLeaves);
    document.getElementById('btnNewLeave')?.addEventListener('click', showNewLeaveForm);
    document.getElementById('salaryMonth')?.addEventListener('change', () => {
        syncSalaryPeriodInputsToMonth();
        loadSalary();
    });
    document.getElementById('salaryDateFrom')?.addEventListener('change', applySalaryPeriodFilter);
    document.getElementById('salaryDateTo')?.addEventListener('change', applySalaryPeriodFilter);
    document.getElementById('btnApplySalaryPeriod')?.addEventListener('click', applySalaryPeriodFilter);
    document.getElementById('btnResetSalaryPeriod')?.addEventListener('click', () => {
        syncSalaryPeriodInputsToMonth();
        loadSalary();
    });
    document.getElementById('zrsMonth')?.addEventListener('change', loadZrs);
    document.getElementById('kpiMonth')?.addEventListener('change', loadKpi);
    document.getElementById('btnAddAdjustment')?.addEventListener('click', showAdjustmentForm);
    document.getElementById('btnAddZrs')?.addEventListener('click', showZrsForm);
    document.getElementById('btnCommitSalary')?.addEventListener('click', () => window.commitSalaries?.());
    document.getElementById('btnRefreshSalaryReconciliation')?.addEventListener('click', refreshSalaryReconciliation);
    document.getElementById('btnLockSalaryPeriod')?.addEventListener('click', () => setSalaryPeriodLock(true));
    document.getElementById('btnUnlockSalaryPeriod')?.addEventListener('click', () => setSalaryPeriodLock(false));
    document.getElementById('btnReverseSalary')?.addEventListener('click', reverseSalaryPeriod);
    document.getElementById('btnStartOnboarding')?.addEventListener('click', showStartOnboarding);
    document.getElementById('btnFormatVacancyPlatform')?.addEventListener('click', formatVacancyPlatformText);
    document.getElementById('btnCopyVacancyTemplate')?.addEventListener('click', copyVacancyTemplateOutput);
    document.getElementById('vacancyTemplateSource')?.addEventListener('change', renderVacancyTemplateStudio);
    document.getElementById('btnSaveCompanyStructure')?.addEventListener('click', saveCompanyStructure);
    document.getElementById('btnAddProfession')?.addEventListener('click', () => openProfessionEditor());
    bindSecondaryProfessionPicker();
    document.getElementById('editRoleType')?.addEventListener('change', () => {
        const selected = readStaffSecondaryProfessionSelection();
        populateSecondaryProfessionSelect(selected, document.getElementById('editRoleType')?.value);
        refreshStaffRateEditorFromCurrentForm();
        refreshStaffRoleAssignmentsFromCurrentForm();
    });
    document.getElementById('editHourlyRate')?.addEventListener('input', () => {
        refreshStaffRateEditorFromCurrentForm();
        refreshStaffRoleAssignmentsFromCurrentForm();
    });
    document.getElementById('editRateUnit')?.addEventListener('change', () => {
        syncStaffRateUnitUi();
        refreshStaffRateEditorFromCurrentForm();
        refreshStaffRoleAssignmentsFromCurrentForm();
        const payrollType = document.getElementById('editPayrollSchemeType');
        const unit = currentEditRateUnit();
        if (payrollType && !document.getElementById('editPayrollSchemeTitle')?.value) {
            payrollType.value = unit === 'day' ? 'per_shift' : 'hourly';
            updatePayrollAdvancedVisibility();
        }
    });
    document.getElementById('editStaffName')?.addEventListener('input', event => {
        syncStaffProfileHeaderName(event.target?.value || '');
    });
    document.getElementById('editResourceKind')?.addEventListener('change', event => {
        loadStaffResourceOptions(event.target?.value || 'custom');
    });
    document.getElementById('editResourceSourceId')?.addEventListener('change', syncResourceTitleFromOption);
    document.getElementById('editPayrollSchemeType')?.addEventListener('change', updatePayrollAdvancedVisibility);
    const autoLayoutButton = document.getElementById('hrOrgAutoLayoutBtn');
    if (autoLayoutButton) autoLayoutButton.onclick = autoArrangeCompanyOrgChart;
    initCompanyOrgChart();
}

// ==========================================
// TABS
// ==========================================

function initTabs() {
    try {
    renderHrNav(resolveHrTabTarget(requestedHrTarget()).tab);
    bindHrNavClicks();
    } catch (err) {
        console.error('HR init failed:', err);
        throw err;
    }
}

function isHrNavItemVisible(item) {
    return typeof item.visible === 'function' ? item.visible(getHrCurrentUser()) : true;
}

function isHrStructureWorkspaceTab(target) {
    return HR_STRUCTURE_WORKSPACE_TABS.has(target);
}

function isHrPayrollWorkspaceTab(target) {
    return HR_PAYROLL_WORKSPACE_TABS.has(target);
}

function isHrOtherWorkspaceTab(target) {
    return HR_OTHER_WORKSPACE_TABS.has(target);
}

function isHrPulseWorkspaceTab(target) {
    return HR_PULSE_WORKSPACE_TABS.has(target);
}

function isHrPeopleWorkspaceTab(target) {
    return HR_PEOPLE_WORKSPACE_TABS.has(target);
}

function hrWorkspaceGroupId(target) {
    if (isHrPeopleWorkspaceTab(target)) return 'people';
    if (isHrStructureWorkspaceTab(target)) return 'structure';
    if (isHrPayrollWorkspaceTab(target)) return 'payroll';
    if (isHrOtherWorkspaceTab(target)) return 'other';
    return '';
}

function updateHrPageTitle(target) {
    const title = document.getElementById('hrPageTitle');
    if (!title) return;
    const header = title.closest('.page-header');
    const pulseMode = isHrPulseWorkspaceTab(target);
    const peopleMode = isHrPeopleWorkspaceTab(target);
    if (header) header.hidden = pulseMode || peopleMode;
    if (pulseMode || peopleMode) {
        title.textContent = '';
        return;
    }
    if (isHrStructureWorkspaceTab(target)) title.textContent = 'Структура';
    else if (isHrPayrollWorkspaceTab(target)) title.textContent = 'ЗП та KPI';
    else if (isHrOtherWorkspaceTab(target)) title.textContent = 'Вакансії';
    else if (target === 'team') title.textContent = 'Команда';
    else title.textContent = 'HR';
}

function bindHrNavClicks() {
    const nav = document.getElementById('hrNav');
    if (!nav || nav.dataset.bound === 'true') return;
    nav.dataset.bound = 'true';
    nav.addEventListener('click', (event) => {
        const tab = event.target.closest('.hr-tab');
        if (!tab || !nav.contains(tab)) return;
        if (tab.dataset.href) {
            window.location.href = tab.dataset.href;
            return;
        }
        activateHrTab(tab.dataset.tab, {
            updateHash: true,
            bucket: tab.dataset.bucket || null
        });
    });
}

function renderHrNav(activeTarget = requestedHrTarget()) {
    const nav = document.getElementById('hrNav');
    if (!nav) return;
    const resolved = resolveHrTabTarget(activeTarget);
    const target = resolved.tab || activeTarget;
    const workspaceGroupId = hrWorkspaceGroupId(target);
    const workspaceMode = Boolean(workspaceGroupId);
    const peopleMode = workspaceGroupId === 'people';
    const pulseMode = !workspaceMode && isHrPulseWorkspaceTab(target);
    nav.classList.toggle('hr-nav--structure-only', workspaceMode && !peopleMode);
    nav.classList.toggle('hr-nav--pulse', pulseMode);
    nav.classList.toggle('hr-nav--people', peopleMode);
    nav.setAttribute('aria-label', workspaceGroupId === 'people' ? 'Навігація команди' : workspaceGroupId === 'structure' ? 'Навігація структури' : workspaceGroupId === 'payroll' ? 'Навігація ЗП та KPI' : workspaceGroupId === 'other' ? 'Навігація вакансій' : pulseMode ? 'Навігація пульсу компанії' : 'Навігація HR');
    const groups = HR_NAV_GROUPS
        .filter(group => workspaceGroupId ? group.id === workspaceGroupId : group.id === 'pulse')
        .map(group => ({
            ...group,
            items: group.items.filter(isHrNavItemVisible)
        }))
        .filter(group => group.items.length > 0);
    nav.innerHTML = groups.length ? groups.map(group => `
        <section class="hr-nav-group" data-hr-nav-group="${escapeHtml(group.id)}">
            <div class="hr-nav-group-title"${workspaceMode || pulseMode ? ' hidden' : ''}>
                <span>${escapeHtml(group.label)}</span>
                ${group.note ? `<small>${escapeHtml(group.note)}</small>` : ''}
            </div>
            <div class="hr-nav-items">
                ${group.items.map(item => {
                    const tabId = item.tab || item.id;
                    const countBadge = item.bucket ? `<span class="hr-nav-count hidden" data-nav-count="${escapeHtml(item.bucket)}">0</span>` : '';
                    const pulseBadge = item.badge ? String(item.badge) : '';
                    if (pulseMode) return renderHrPulseNavButton(item, pulseBadge);
                    const content = `${escapeHtml(item.label)}${countBadge}`;
                    return `
                    <button type="button" class="hr-tab" data-nav-id="${escapeHtml(item.id)}" data-tab="${escapeHtml(tabId)}"${item.bucket ? ` data-bucket="${escapeHtml(item.bucket)}"` : ''}${item.href ? ` data-href="${escapeHtml(item.href)}"` : ''}>${content}</button>
                `;
                }).join('')}
            </div>
        </section>
    `).join('') : '<div class="hr-nav-empty">Немає доступних HR-розділів</div>';
    applyPulseCardBadges();
    scrollActiveHrPulseCardIntoView();
}

function hashForHrTarget(target, bucket = null) {
    if (target === 'team') {
        if (bucket === 'workers') return 'workers';
        if (bucket === 'interns') return 'interns';
        if (bucket === 'blacklist') return 'blacklist';
        if (bucket === 'reserve') return 'reserve';
        if (bucket === 'dismissed') return 'dismissed';
    }
    return target;
}

function cssEscapeValue(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
}

function syncHrNavActive(target, bucket = null) {
    document.querySelectorAll('.hr-tab').forEach(t => t.classList.remove('active'));
    const effectiveBucket = target === 'team'
        ? (bucket || activePeopleBucket || firstVisiblePeopleBucketId())
        : bucket;
    const tabSelector = cssEscapeValue(target);
    const bucketSelector = effectiveBucket ? `[data-bucket="${cssEscapeValue(effectiveBucket)}"]` : ':not([data-bucket])';
    const tab = document.querySelector(`.hr-tab[data-tab="${tabSelector}"]${bucketSelector}`)
        || document.querySelector(`.hr-tab[data-tab="${tabSelector}"]`);
    tab?.classList.add('active');
    scrollActiveHrPulseCardIntoView();
}

function scrollActiveHrPulseCardIntoView() {
    const nav = document.getElementById('hrNav');
    if (!nav?.classList.contains('hr-nav--pulse')) return;
    const activeCard = nav.querySelector('.hr-pulse-card.active');
    const scroller = activeCard?.closest('.hr-nav-items');
    if (!activeCard || !scroller || scroller.scrollWidth <= scroller.clientWidth + 4) return;
    const reduceMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => {
        activeCard.scrollIntoView({
            block: 'nearest',
            inline: 'center',
            behavior: reduceMotion ? 'auto' : 'smooth'
        });
    });
}

function setHrNavTeamMode(target) {
    const nav = document.getElementById('hrNav');
    if (!nav) return;
    const isTeam = target === 'team';
    nav.hidden = false;
    nav.setAttribute('aria-hidden', 'false');
    nav.classList.toggle('hr-nav--team-hidden', false);
    nav.dataset.teamWorkspace = isTeam ? 'true' : 'false';
}

function updatePeopleNavCounts(grouped = []) {
    const counts = new Map(grouped.map(bucket => [bucket.id, Number(bucket.totalCount ?? bucket.staff?.length ?? 0)]));
    document.querySelectorAll('[data-nav-count]').forEach(badge => {
        const value = counts.has(badge.dataset.navCount) ? counts.get(badge.dataset.navCount) : null;
        badge.textContent = value === null ? '0' : String(value);
        badge.classList.toggle('hidden', value === null);
    });
}

function requestedHrTarget() {
    const hashTab = window.location.hash ? window.location.hash.slice(1) : '';
    const queryTab = new URLSearchParams(window.location.search).get('tab') || '';
    return queryTab || hashTab || 'today';
}

function resolveHrTabTarget(rawTarget) {
    const requested = String(rawTarget || 'today').trim() || 'today';
    if (requested === 'costumes') {
        return { tab: 'today', href: '/warehouse#costumes', alias: true };
    }
    if (requested === 'onboarding') {
        return { tab: 'today', href: '/training#onboarding', alias: true };
    }
    const mapped = HR_TAB_ALIASES[requested] || { tab: requested };
    const target = mapped.tab || 'today';
    if (target === 'accounts' && !canManageAccountSecurity()) {
        return { tab: 'today', alias: requested !== 'today' };
    }
    if (!document.getElementById(`tab-${target}`)) {
        return { tab: 'today', alias: requested !== 'today' };
    }
    return {
        tab: target,
        bucket: mapped.bucket || null,
        alias: target !== requested || !!mapped.bucket
    };
}

function getInitialHrTab() {
    const target = requestedHrTarget();
    if (target === 'costumes') {
        window.location.replace('/warehouse#costumes');
        return 'today';
    }
    if (target === 'onboarding') {
        window.location.replace('/training#onboarding');
        return 'today';
    }
    const resolved = resolveHrTabTarget(target);
    if (resolved.bucket) {
        pendingPeopleBucket = normalizeVisiblePeopleBucket(resolved.bucket);
        if (pendingPeopleBucket !== resolved.bucket) {
            const hashTarget = hashForHrTarget('team', pendingPeopleBucket);
            history.replaceState(null, '', `${window.location.pathname}#${hashTarget}`);
        }
    }
    return resolved.tab;
}

function removeLegacyAnimatorShiftSummary() {
    document.getElementById('shiftsSummarySection')?.remove();
    document.getElementById('shiftsSummaryContainer')?.closest('.page-section')?.remove();
    document.getElementById('shiftsMonthPicker')?.closest('.page-section')?.remove();
}

async function activateHrTab(target, options = {}) {
    removeLegacyAnimatorShiftSummary();
    const resolved = resolveHrTabTarget(target);
    if (resolved.href) {
        window.location.href = resolved.href;
        return;
    }
    target = resolved.tab;
    let requestedBucket = options.bucket || resolved.bucket || null;
    if (target === 'team' && requestedBucket) {
        requestedBucket = normalizeVisiblePeopleBucket(requestedBucket);
    }
    if (requestedBucket) pendingPeopleBucket = requestedBucket;
    const panel = document.getElementById(`tab-${target}`);
    if (!panel) return;
    if (target === 'accounts' && !canManageAccountSecurity()) return activateHrTab('today', { updateHash: true });
    document.querySelectorAll('.hr-tab-content').forEach(c => c.classList.remove('active'));
    renderHrNav(target);
    updateHrPageTitle(target);
    setHrNavTeamMode(target);
    syncHrNavActive(target, requestedBucket);
    panel.classList.add('active');
    if (options.updateHash || resolved.alias) {
        const hashTarget = hashForHrTarget(target, requestedBucket);
        const next = hashTarget === 'today' ? window.location.pathname : `${window.location.pathname}#${hashTarget}`;
        history.replaceState(null, '', next);
    }
    const loaders = {
        today: loadToday, schedule: loadSchedule, team: loadTeam, structure: loadCompanyStructure,
        professions: loadProfessions, checklists: loadProfessionChecklists,
        reports: loadReports, salary: loadSalary, zrs: loadZrs, kpi: loadKpi, onboarding: loadOnboarding,
        vacancies: loadVacancies, accounts: loadAccountCenter
    };
    await loaders[target]?.();
    removeLegacyAnimatorShiftSummary();
}

// ==========================================
// TAB 1: TODAY
// ==========================================

function isTodayFilterActive() {
    return !!normalizeSearchText(todayFilters.query) || todayFilters.department !== 'all';
}

function todayDepartmentOptions(items = []) {
    const departments = new Map();
    items.forEach(item => {
        const key = normalizeDepartmentKey(item.department);
        if (!departments.has(key)) {
            departments.set(key, {
                key,
                label: departmentLabel(item.department),
                count: 0
            });
        }
        departments.get(key).count++;
    });
    return Array.from(departments.values())
        .sort((a, b) => a.label.localeCompare(b.label, 'uk'));
}

function summarizeTodayItems(items = []) {
    const rows = Array.isArray(items) ? items : [];
    const summary = { total_staff: rows.length, present: 0, late: 0, absent: 0, on_vacation: 0, sick: 0 };
    rows.forEach(item => {
        const rec = item.record;
        if (rec) {
            const status = rec.status;
            if (['late', 'present', 'clocked_in', 'early_leave', 'auto_closed', 'unscheduled'].includes(status)) {
                summary.present++;
            } else if (status === 'vacation') {
                summary.on_vacation++;
            } else if (status === 'sick') {
                summary.sick++;
            }
            if (status === 'late') summary.late++;
        } else if (item.shift) {
            summary.absent++;
        }
    });
    return summary;
}

const TODAY_ARRIVED_STATUSES = new Set(['present', 'clocked_in', 'late', 'unscheduled', 'early_leave', 'auto_closed']);

function isTodayItemArrived(item = {}) {
    const rec = item.record;
    if (!rec) return false;
    if (rec.clock_in) return true;
    return TODAY_ARRIVED_STATUSES.has(String(rec.status || ''));
}

function sortTodayItemsForReview(items = []) {
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const arrivedDiff = Number(isTodayItemArrived(a.item)) - Number(isTodayItemArrived(b.item));
            if (arrivedDiff !== 0) return arrivedDiff;
            return a.index - b.index;
        })
        .map(entry => entry.item);
}

function todaySearchHaystack(item = {}) {
    const roleLabel = ROLE_LABELS[item.role_type] || item.role_type || '';
    const status = item.record?.status || (item.shift ? 'absent' : '');
    const statusLabel = STATUS_LABELS[status] || status;
    const shiftText = item.shift
        ? `${fmtTime(item.shift.planned_start)} ${fmtTime(item.shift.planned_end)}`
        : '';
    return normalizeSearchText([
        item.staff_name,
        item.position,
        item.role_type,
        roleLabel,
        item.department,
        departmentLabel(item.department),
        statusLabel,
        shiftText
    ].filter(Boolean).join(' '));
}

function filteredTodayItems(items = []) {
    const query = normalizeSearchText(todayFilters.query);
    const department = todayFilters.department;
    const filtered = items.filter(item => {
        if (department !== 'all' && normalizeDepartmentKey(item.department) !== department) return false;
        if (query && !todaySearchHaystack(item).includes(query)) return false;
        return true;
    });
    return sortTodayItemsForReview(filtered);
}

function todayStaffPhotoUrl(item = {}) {
    const photoUrl = String(item.photo_url || item.photoUrl || '').trim();
    if (!photoUrl) return '';
    const lower = photoUrl.toLowerCase();
    return lower.startsWith('https://') || photoUrl.startsWith('/uploads/') || photoUrl.startsWith('/images/') ? photoUrl : '';
}

function todayAttendanceStatus(item = {}) {
    const rec = item.record;
    if (!rec) return item.shift ? 'absent' : 'special';
    const status = String(rec.status || '').trim();
    if (rec.clock_out || status === 'early_leave' || status === 'auto_closed') return 'done';
    if (status === 'late') return 'late';
    if (['present', 'clocked_in', 'unscheduled'].includes(status)) return 'present';
    if (['sick', 'vacation', 'day_off'].includes(status)) return 'special';
    if (status === 'no_show') return 'absent';
    return 'absent';
}

function todayIsBirthday(item = {}) {
    return item.is_birthday_today === true
        || item.isBirthdayToday === true
        || item.is_birthday_today === 'true'
        || item.isBirthdayToday === 'true';
}

function todayCompactStaffName(name = '') {
    const fullName = String(name || '').replace(/\s+/g, ' ').trim();
    if (!fullName) return '';
    const parts = fullName.split(' ');
    if (parts.length < 2) return fullName;
    const lastName = parts[0];
    const firstName = parts[1];
    const initial = Array.from(firstName || '')[0] || '';
    return initial ? `${lastName} ${initial}.` : lastName;
}

function renderTodayHoneycombTile(item = {}) {
    const staffId = Number(item.staff_id || item.id);
    const safeStaffId = Number.isFinite(staffId) ? staffId : 0;
    const name = item.staff_name || item.name || 'Співробітник';
    const displayName = todayCompactStaffName(name);
    const photoUrl = todayStaffPhotoUrl(item);
    const status = todayAttendanceStatus(item);
    const hasPhoto = Boolean(photoUrl);
    const isBirthday = todayIsBirthday(item);
    const canOpenProfile = Boolean(canManage && safeStaffId && typeof openStaffEdit === 'function');
    const roleLabel = ROLE_LABELS[item.role_type] || item.role_type || '';
    const statusLabel = STATUS_LABELS[item.record?.status] || (status === 'absent' ? 'Відсутній' : status);
    const titleParts = [
        name,
        roleLabel,
        departmentLabel(item.department),
        isBirthday ? `День народження: ${name}` : '',
        statusLabel
    ].filter(Boolean);
    const className = [
        'hr-today-hex-tile',
        `is-${status}`,
        hasPhoto ? 'has-photo' : 'is-missing-photo',
        isBirthday ? 'is-birthday' : ''
    ].filter(Boolean).join(' ');
    const titleText = titleParts.join(' · ');
    const visual = hasPhoto
        ? `<span class="hr-today-hex-photo"><img src="${escapeHtml(photoUrl)}" alt="" loading="lazy" decoding="async"></span>`
        : '';
    const birthday = isBirthday
        ? `<span class="hr-today-hex-birthday" aria-label="День народження">ДН</span>`
        : '';
    const nameLabel = `<span class="hr-today-hex-name">${escapeHtml(displayName || name)}</span>`;
    if (canOpenProfile) {
        return `<button type="button" class="${className}" data-staff-id="${safeStaffId}" data-attendance-status="${escapeHtml(status)}" data-birthday="${isBirthday ? 'true' : 'false'}" title="${escapeHtml(titleText)}" aria-label="${escapeHtml(titleText)}" onclick="openStaffEdit(${safeStaffId})">
            ${visual}
            ${birthday}
            ${nameLabel}
        </button>`;
    }
    return `<div class="${className}" data-staff-id="${safeStaffId}" data-attendance-status="${escapeHtml(status)}" data-birthday="${isBirthday ? 'true' : 'false'}" title="${escapeHtml(titleText)}" aria-label="${escapeHtml(titleText)}">
        ${visual}
        ${birthday}
        ${nameLabel}
    </div>`;
}

function renderTodayHoneycombBoard(items = []) {
    const root = document.getElementById('todayHoneycombBoard');
    if (!root) return;
    if (!items.length) {
        root.innerHTML = '<div class="hr-today-honeycomb-empty">Немає співробітників для цього фільтра</div>';
        return;
    }
    root.innerHTML = items.map(renderTodayHoneycombTile).join('');
}

function bindTodayFilterControls() {
    const search = document.getElementById('todaySearch');
    if (search) {
        if (search.value !== todayFilters.query) search.value = todayFilters.query;
        search.oninput = () => {
            todayFilters.query = search.value;
            if (todayData) renderToday(todayData);
        };
    }
}

function renderTodayDepartmentSegments(items = []) {
    const root = document.getElementById('todayDepartmentSegments');
    if (!root) return;
    const departments = todayDepartmentOptions(items);
    if (todayFilters.department !== 'all' && !departments.some(dep => dep.key === todayFilters.department)) {
        todayFilters.department = 'all';
    }
    const segments = [{ key: 'all', label: 'Всі', count: items.length }, ...departments];
    root.innerHTML = segments.map(segment => {
        const active = todayFilters.department === segment.key;
        return `<button type="button" class="hr-today-segment${active ? ' active' : ''}" data-department="${escapeHtml(segment.key)}" aria-pressed="${active ? 'true' : 'false'}">
            <span>${escapeHtml(segment.label)}</span>
            <strong>${segment.count}</strong>
        </button>`;
    }).join('');
    root.querySelectorAll('[data-department]').forEach(button => {
        button.onclick = () => {
            todayFilters.department = button.dataset.department || 'all';
            if (todayData) renderToday(todayData);
        };
    });
}

function renderTodayFilterInfo(allItems = [], filteredItems = []) {
    const info = document.getElementById('todayFilterInfo');
    if (!info) return;
    const active = isTodayFilterActive();
    info.textContent = active
        ? `Показано ${filteredItems.length} з ${allItems.length}`
        : `${allItems.length} співробітників у пульсі`;
}

function setTodayHeaderMetricText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value === null || value === undefined || value === '' ? '-' : String(value);
}

function formatTodayHeaderDate(date = new Date()) {
    const dayName = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П\'ятниця', 'Субота'][date.getDay()];
    return `${dayName}, ${date.getDate()} ${MONTHS_UK[date.getMonth()]} ${date.getFullYear()}`;
}

function updateTodayHeaderDate(date = new Date()) {
    setTodayHeaderMetricText('todayDate', formatTodayHeaderDate(date));
}

function todayMetricNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
}

function formatTodayRiskCount(count) {
    const value = todayMetricNumber(count);
    if (value === 1) return '1 ризик';
    if (value >= 2 && value <= 4) return `${value} ризики`;
    return `${value} ризиків`;
}

function todayHeaderMetricsFromSummary(summary = {}) {
    const total = todayMetricNumber(summary.total_staff);
    const present = todayMetricNumber(summary.present);
    const late = todayMetricNumber(summary.late);
    const absent = todayMetricNumber(summary.absent);
    const risks = Math.max(0, late + absent);
    const readiness = total > 0 ? Math.max(0, Math.min(100, Math.round(((total - risks) / total) * 100))) : 0;

    return { total, present, late, risks, readiness };
}

function updateTodayHeaderMetrics(summary = {}) {
    // Today header chips use the current attendance summary: on-shift, late, and risk-based readiness.
    const metrics = todayHeaderMetricsFromSummary(summary);

    setTodayHeaderMetricText('todayOnShiftMetric', metrics.present);
    setTodayHeaderMetricText('todayOnShiftMeta', metrics.total > 0 ? `${metrics.present} з ${metrics.total}` : 'немає активних');
    setTodayHeaderMetricText('todayLateMetric', metrics.late);
    setTodayHeaderMetricText('todayLateMeta', metrics.late > 0 ? `${metrics.late} потребують уваги` : 'без запізнень');
    setTodayHeaderMetricText('todayReadinessMetric', `${metrics.readiness}%`);
    setTodayHeaderMetricText('todayReadinessMeta', formatTodayRiskCount(metrics.risks));
}

async function loadToday() {
    if (typeof _loadStaffLinks === 'function') _loadStaffLinks().catch(() => {});
    const data = await hrFetch('/today');
    if (!data || !data.success) {
        updateTodayHeaderDate();
        updateTodayHeaderMetrics();
        setPulseCardBadge('today', null, { hidden: true });
        return;
    }
    todayData = data;
    renderToday(data);
}

function renderToday(data) {
    updateTodayHeaderDate();

    const allItems = Array.isArray(data.data) ? data.data : [];
    const pulseSummary = summarizeTodayItems(allItems);
    setPulseCardBadge('today', pulseSummary.present, {
        hidden: allItems.length === 0,
        title: `На роботі: ${pulseSummary.present} з ${pulseSummary.total_staff}`,
        ariaLabel: `Сьогодні на роботі ${pulseSummary.present} з ${pulseSummary.total_staff}`
    });
    bindTodayFilterControls();
    renderTodayDepartmentSegments(allItems);
    const visibleItems = filteredTodayItems(allItems);
    renderTodayFilterInfo(allItems, visibleItems);
    renderTodayHoneycombBoard(visibleItems);

    const s = isTodayFilterActive() ? summarizeTodayItems(visibleItems) : (data.summary || summarizeTodayItems(allItems));
    updateTodayHeaderMetrics(s);
    document.getElementById('todaySummary').innerHTML = `
        <div class="hr-summary-card green"><div class="value">${s.present}</div><div class="label">На роботі</div></div>
        <div class="hr-summary-card yellow"><div class="value">${s.late}</div><div class="label">Запізнились</div></div>
        <div class="hr-summary-card red"><div class="value">${s.absent}</div><div class="label">Відсутні</div></div>
        <div class="hr-summary-card"><div class="value">${s.sick + s.on_vacation}</div><div class="label">Хвороба / відпустка</div></div>
    `;

    const list = document.getElementById('todayList');
    if (allItems.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає активних співробітників</div>';
        return;
    }
    if (visibleItems.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Нічого не знайдено за цим фільтром</div>';
        return;
    }

    list.innerHTML = visibleItems.map(item => {
        const rec = item.record;
        const shift = item.shift;
        let indicator = 'absent';
        let btnClass = 'clock-in';
        let btnText = 'Відмітити прихід';
        let meta = '';
        let disabled = '';

        if (shift) {
            meta = `Зміна: ${fmtTime(shift.planned_start)}–${fmtTime(shift.planned_end)}`;
        }

        if (rec) {
            const st = rec.status;
            if (st === 'present' || st === 'clocked_in' || st === 'unscheduled') {
                indicator = 'present';
                if (rec.clock_out) {
                    indicator = 'done';
                    btnClass = 'done';
                    btnText = `Відпрацював ${fmtMinutes(rec.total_worked_minutes)}`;
                    disabled = 'disabled';
                    meta += ` | Пішов: ${fmtTimeFromISO(rec.clock_out)}`;
                } else {
                    btnClass = 'clock-out';
                    btnText = `На роботі (з ${fmtTimeFromISO(rec.clock_in)})`;
                    meta += ` | Прийшов: ${fmtTimeFromISO(rec.clock_in)}`;
                }
            } else if (st === 'late') {
                indicator = 'late';
                if (rec.clock_out) {
                    indicator = 'done';
                    btnClass = 'done';
                    btnText = `Відпрацював ${fmtMinutes(rec.total_worked_minutes)}`;
                    disabled = 'disabled';
                } else {
                    btnClass = 'clock-out late';
                    btnText = `На роботі (з ${fmtTimeFromISO(rec.clock_in)})`;
                }
                meta += ` | <span class="late-badge">+${rec.late_minutes}хв</span>`;
            } else if (st === 'early_leave') {
                indicator = 'done';
                btnClass = 'done';
                btnText = `Відпрацював ${fmtMinutes(rec.total_worked_minutes)}`;
                disabled = 'disabled';
            } else if (st === 'auto_closed') {
                indicator = 'auto_closed';
                btnClass = 'done';
                btnText = `Авто-закрито (${fmtMinutes(rec.total_worked_minutes)})`;
                disabled = 'disabled';
            } else if (st === 'sick') {
                indicator = 'sick';
                btnClass = 'special';
                btnText = '🏥 Лікарняний';
                disabled = 'disabled';
            } else if (st === 'vacation') {
                indicator = 'vacation';
                btnClass = 'special';
                btnText = '🌴 Відпустка';
                disabled = 'disabled';
            } else if (st === 'day_off') {
                indicator = 'day_off';
                btnClass = 'special';
                btnText = '📴 Вихідний';
                disabled = 'disabled';
            } else if (st === 'no_show') {
                indicator = 'no_show';
                btnClass = 'clock-in';
                btnText = 'Не з\'явився — відмітити';
            }
        }

        const arrived = isTodayItemArrived(item);
        const roleLabel = ROLE_LABELS[item.role_type] || item.role_type || '';
        const roleMeta = [
            roleLabel,
            item.position && item.position !== roleLabel ? item.position : '',
            item.department ? departmentLabel(item.department) : ''
        ].filter(Boolean).join(' · ');

        return `<div class="hr-staff-row${arrived ? ' hr-staff-row--arrived' : ''}" data-staff-id="${item.staff_id}" data-attendance-state="${arrived ? 'arrived' : 'pending'}" oncontextmenu="showContext(event, ${item.staff_id})">
            <div class="hr-staff-indicator ${indicator}"></div>
            <div class="hr-staff-info">
                <div class="hr-staff-name">${escapeHtml(item.staff_name)} ${typeof staffAccountBadge === 'function' ? staffAccountBadge(item.staff_id, {compact:true}) : ''} <a href="/staff?highlight=${item.staff_id}" class="hr-crosslink" title="Графік" style="font-size:14px;text-decoration:none;opacity:0.5">📅</a></div>
                <div class="hr-staff-meta">${roleMeta}${meta ? ' · ' + meta : ''}</div>
            </div>
            <button type="button" class="hr-clock-btn ${btnClass}" ${disabled}
                onclick="handleClock(${item.staff_id}, '${rec && rec.clock_in && !rec.clock_out ? 'out' : 'in'}', '${escapeHtml(item.staff_name)}', ${rec ? rec.total_worked_minutes || 0 : 0})"
            >${btnText}</button>
        </div>`;
    }).join('');
}

async function handleClock(staffId, action, name, workedMin) {
    if (action === 'out') {
        const message = `Завершити зміну для ${name}?\nУ зарплату буде зараховано планову зміну, якщо вона є; без графіка - фактичний час.`;
        if (!await confirmModal(message, { type: 'warning', okText: 'Завершити' })) return;
    }
    const endpoint = action === 'out' ? '/clock-out' : '/clock-in';
    const body = { staff_id: staffId };
    if (action === 'out') body.settlement_mode = 'scheduled_shift';
    const data = await hrFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    if (!data) return;
    if (!data.success) {
        showNotification(data.error || 'Помилка', 'error');
        return;
    }
    const totalMinutes = Number(data.data?.total_worked_minutes);
    const doneText = action === 'out' && Number.isFinite(totalMinutes)
        ? `Зміну завершено: ${fmtMinutes(totalMinutes)}`
        : 'Зміну завершено';
    showNotification(action === 'out' ? doneText : 'Прихід відмічено', 'success');
    await loadToday();
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        const activeTab = document.querySelector('.hr-tab.active');
        if (activeTab && activeTab.dataset.tab === 'today') loadToday();
    }, 30000);
}

function initHrRealtime() {
    if (typeof window === 'undefined') return;
    window.addEventListener('ws:hr-attendance', () => {
        const activeTab = document.querySelector('.hr-tab.active');
        if (!activeTab || activeTab.dataset.tab !== 'today') return;
        if (hrRealtimeRefreshTimer) clearTimeout(hrRealtimeRefreshTimer);
        hrRealtimeRefreshTimer = setTimeout(() => {
            hrRealtimeRefreshTimer = null;
            loadToday();
        }, 150);
    });
    if (typeof ParkWS !== 'undefined' && ParkWS && typeof ParkWS.connect === 'function') {
        ParkWS.connect();
    }
}

// ==========================================
// CONTEXT MENU
// ==========================================

function initContextMenu() {
    document.addEventListener('click', () => {
        document.getElementById('contextMenu')?.classList.remove('visible');
    });

    document.querySelectorAll('.hr-context-item').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            if (action === 'correct') {
                openCorrectionModal(contextStaffId);
            } else {
                const data = await hrFetch('/mark-absent', {
                    method: 'POST',
                    body: JSON.stringify({ staff_id: contextStaffId, status: action })
                });
                if (data && data.success) {
                    showNotification('Статус оновлено', 'success');
                    await loadToday();
                } else {
                    showNotification(data?.error || 'Помилка', 'error');
                }
            }
        });
    });
}

function showContext(e, staffId) {
    e.preventDefault();
    contextStaffId = staffId;
    const menu = document.getElementById('contextMenu');
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`;
    menu.classList.add('visible');
}

function openCorrectionModal(staffId) {
    if (!todayData) return;
    const item = todayData.data.find(d => d.staff_id === staffId);
    if (!item || !item.record || !item.record.id) {
        showNotification('Немає запису для корекції', 'error');
        return;
    }
    document.getElementById('corrRecordId').value = item.record.id;
    document.getElementById('corrClockIn').value = item.record.clock_in ? fmtTimeFromISO(item.record.clock_in) : '';
    document.getElementById('corrClockOut').value = item.record.clock_out ? fmtTimeFromISO(item.record.clock_out) : '';
    document.getElementById('corrNotes').value = '';
    showHrEditableModal('correctionModal');
}

// ==========================================
// TAB 2: SCHEDULE
// ==========================================

function initScheduleControls() {
    scheduleWeekStart = getMonday(new Date());

    document.getElementById('schedPrev')?.addEventListener('click', () => {
        if (scheduleView === 'week') {
            scheduleWeekStart.setDate(scheduleWeekStart.getDate() - 7);
        } else {
            scheduleWeekStart.setMonth(scheduleWeekStart.getMonth() - 1);
            scheduleWeekStart.setDate(1);
        }
        loadSchedule();
    });

    document.getElementById('schedNext')?.addEventListener('click', () => {
        if (scheduleView === 'week') {
            scheduleWeekStart.setDate(scheduleWeekStart.getDate() + 7);
        } else {
            scheduleWeekStart.setMonth(scheduleWeekStart.getMonth() + 1);
            scheduleWeekStart.setDate(1);
        }
        loadSchedule();
    });

    document.getElementById('schedToday')?.addEventListener('click', () => {
        scheduleWeekStart = getMonday(new Date());
        loadSchedule();
    });

    document.getElementById('schedCopy')?.addEventListener('click', copyWeek);

    document.querySelectorAll('.hr-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.hr-view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            scheduleView = btn.dataset.view;
            if (scheduleView === 'month') {
                scheduleWeekStart = new Date(scheduleWeekStart.getFullYear(), scheduleWeekStart.getMonth(), 1);
            } else {
                scheduleWeekStart = getMonday(scheduleWeekStart);
            }
            loadSchedule();
        });
    });
}

async function loadSchedule() {
    // Load staff and templates
    const [staffData, tplData] = await Promise.all([
        hrFetch('/staff?active=true'),
        hrFetch('/shift-templates')
    ]);
    if (staffData && staffData.success) scheduleStaff = staffData.data;
    if (tplData && tplData.success) {
        shiftTemplates = tplData.data;
        renderTemplateSelect();
    }

    let dates;
    if (scheduleView === 'week') {
        dates = getWeekDates(scheduleWeekStart);
    } else {
        dates = getMonthDates(scheduleWeekStart.getFullYear(), scheduleWeekStart.getMonth());
    }

    const from = formatDate(dates[0]);
    const to = formatDate(dates[dates.length - 1]);

    const shiftsData = await hrFetch(`/shifts?from=${from}&to=${to}`);
    if (shiftsData && shiftsData.success) scheduleShifts = shiftsData.data;

    renderSchedule(dates);
    await loadLeaves();
}

function renderTemplateSelect() {
    const sel = document.getElementById('templateSelect');
    sel.innerHTML = shiftTemplates.map(t =>
        `<option value="${t.id}">${escapeHtml(t.name)} (${fmtTime(t.planned_start)}–${fmtTime(t.planned_end)})</option>`
    ).join('');
}

function renderSchedule(dates) {
    const today = todayStr();

    // Update label
    if (scheduleView === 'week') {
        const sun = dates[6];
        document.getElementById('schedLabel').textContent =             `Тиждень ${dates[0].getDate()}–${sun.getDate()} ${MONTHS_UK[sun.getMonth()]} ${sun.getFullYear()}`;
    } else {
        document.getElementById('schedLabel').textContent =             `${MONTHS_SHORT[scheduleWeekStart.getMonth()]} ${scheduleWeekStart.getFullYear()}`;
    }

    // Build shift lookup: staffId_date → shift
    const shiftMap = {};
    for (const s of scheduleShifts) {
        const d = typeof s.shift_date === 'string' ? s.shift_date.substring(0, 10) : s.shift_date;
        shiftMap[`${s.staff_id}_${d}`] = s;
    }

    // Header
    const head = document.getElementById('schedHead');
    let headHtml = '<tr><th>Ім\'я</th>';
    for (const d of dates) {
        const ds = formatDate(d);
        const isToday = ds === today;
        const label = scheduleView === 'week'
            ? `${DAYS_UK[d.getDay()]} ${d.getDate()}`
            : `${d.getDate()}`;
        headHtml += `<th class="${isToday ? 'today' : ''}">${label}</th>`;
    }
    headHtml += '</tr>';
    head.innerHTML = headHtml;

    // Body
    const body = document.getElementById('schedBody');
    body.innerHTML = scheduleStaff.map(staff => {
        let row = `<tr><td>${escapeHtml(staff.name)}</td>`;
        for (const d of dates) {
            const ds = formatDate(d);
            const isToday = ds === today;
            const isPast = ds < today;
            const shift = shiftMap[`${staff.id}_${ds}`];
            let cellContent;
            let cellExtra = '';
            if (shift) {
                const cls = isPast ? 'past ' + (shift.shift_type || 'regular') : (shift.shift_type || 'regular');
                const professionLabel = professionTitle(shift.profession_key || staff.role_type);
                cellExtra = professionLabel ? `<small class="hr-shift-profession">${escapeHtml(professionLabel)}</small>` : '';
                cellContent = `<span class="hr-shift-cell ${cls}">${fmtTime(shift.planned_start)}–${fmtTime(shift.planned_end)}</span>`;
            } else {
                cellContent = '<span class="hr-shift-cell empty">—</span>';
            }
            row += `<td class="${isToday ? 'today' : ''}" onclick="openShiftModal(${staff.id}, '${ds}')">${cellContent}${cellExtra}</td>`;
        }
        row += '</tr>';
        return row;
    }).join('');
}

function openShiftModal(staffId, date) {
    if (!canManage) return;
    const shiftMap = {};
    for (const s of scheduleShifts) {
        const d = typeof s.shift_date === 'string' ? s.shift_date.substring(0, 10) : s.shift_date;
        shiftMap[`${s.staff_id}_${d}`] = s;
    }
    const existing = shiftMap[`${staffId}_${date}`];
    editingShift = { staffId, date, existing };

    const staff = scheduleStaff.find(s => s.id === staffId);
    const professionSelect = document.getElementById('shiftProfession');
    if (professionSelect) {
        const selectedProfession = existing?.profession_key || staff?.role_type || '';
        const options = staffProfessionOptions(staff || {}, selectedProfession);
        professionSelect.innerHTML = options.length
            ? options.map(option => `<option value="${escapeHtml(option.value)}" ${option.selected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')
            : '<option value="">Професія не задана</option>';
        professionSelect.disabled = !options.length;
    }
    document.getElementById('shiftModalTitle').textContent = existing
        ? `Редагувати зміну — ${staff?.name || ''}`
        : `Додати зміну — ${staff?.name || ''}`;

    if (existing) {
        document.getElementById('shiftStart').value = fmtTime(existing.planned_start);
        document.getElementById('shiftEnd').value = fmtTime(existing.planned_end);
        document.getElementById('shiftType').value = existing.shift_type || 'regular';
        document.getElementById('shiftBreak').value = existing.break_minutes || 30;
        document.getElementById('shiftNotes').value = existing.notes || '';
        document.getElementById('shiftDelete').style.display = '';
        document.getElementById('shiftReplace').style.display = '';
    } else {
        // Use selected template
        const tplId = document.getElementById('templateSelect')?.value;
        const tpl = shiftTemplates.find(t => t.id === parseInt(tplId));
        document.getElementById('shiftStart').value = tpl ? fmtTime(tpl.planned_start) : '12:00';
        document.getElementById('shiftEnd').value = tpl ? fmtTime(tpl.planned_end) : '20:00';
        document.getElementById('shiftType').value = tpl ? tpl.shift_type : 'regular';
        document.getElementById('shiftBreak').value = tpl ? tpl.break_minutes : 30;
        document.getElementById('shiftNotes').value = '';
        document.getElementById('shiftDelete').style.display = 'none';
        document.getElementById('shiftReplace').style.display = 'none';
    }

    showHrEditableModal('shiftModal');
}

async function saveShift() {
    if (!editingShift) return;
    const btn = document.getElementById('shiftSave');
    if (btn && btn.disabled) return;
    const body = {
        staff_id: editingShift.staffId,
        shift_date: editingShift.date,
        planned_start: document.getElementById('shiftStart')?.value,
        planned_end: document.getElementById('shiftEnd')?.value,
        shift_type: document.getElementById('shiftType')?.value,
        break_minutes: parseInt(document.getElementById('shiftBreak')?.value) || 0,
        notes: document.getElementById('shiftNotes')?.value,
        profession_key: document.getElementById('shiftProfession')?.value || null
    };
    const staff = scheduleStaff.find(item => Number(item.id) === Number(editingShift.staffId));
    const selectedProfession = normalizeProfessionKey(body.profession_key || staff?.role_type);
    if (selectedProfession && !staffHasProfession(staff || {}, selectedProfession)) {
        showNotification('Цієї професії немає в картці співробітника. Спочатку додайте її в HR → Команда.', 'error');
        return;
    }

    if (!body.planned_start || !body.planned_end) {
        showNotification('Вкажіть час початку і кінця', 'error');
        return;
    }

    if (btn) btn.disabled = true;
    try {
        let data;
        if (editingShift.existing) {
            data = await hrFetch(`/shifts/${editingShift.existing.id}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
        } else {
            data = await hrFetch('/shifts', {
                method: 'POST',
                body: JSON.stringify(body)
            });
        }

        if (data && data.success) {
            showNotification('Зміну збережено', 'success');
            await closeHrEditableModal('shiftModal', true);
            await loadSchedule();
        } else {
            showNotification(data?.error || 'Помилка', 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteShift() {
    if (!editingShift || !editingShift.existing) return;
    if (!await confirmModal('Видалити зміну?', { type: 'danger', okText: 'Видалити' })) return;
    const data = await hrFetch(`/shifts/${editingShift.existing.id}`, { method: 'DELETE' });
    if (data && data.success) {
        showNotification('Зміну видалено', 'success');
        await closeHrEditableModal('shiftModal', true);
        await loadSchedule();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

async function replaceShift() {
    if (!editingShift?.existing) return;
    const currentStaff = scheduleStaff.find(s => s.id === editingShift.staffId);
    const requiredProfession = normalizeProfessionKey(editingShift.existing.profession_key || currentStaff?.role_type);
    const candidates = scheduleStaff
        .filter(s => s.id !== editingShift.staffId && s.is_active !== false)
        .filter(s => staffHasProfession(s, requiredProfession))
        .map(s => ({ value: String(s.id), label: `${s.name}${s.role_type ? ' · ' + (ROLE_LABELS[s.role_type] || s.role_type) : ''}` }));
    if (!candidates.length) {
        showNotification('Немає активних співробітників для підміни', 'error');
        return;
    }
    const result = await formModal('Підміна зміни', [
        { key: 'replacementStaffId', label: 'Хто замінює', type: 'select', options: candidates, required: true },
        { key: 'reason', label: 'Причина', placeholder: 'Хвороба, прохання менеджера, термінова заміна...' }
    ], { icon: '🔁', okText: 'Зберегти підміну' });
    if (!result) return;
    const data = await hrFetch(`/shifts/${editingShift.existing.id}/replace`, {
        method: 'POST',
        body: {
            replacement_staff_id: parseInt(result.replacementStaffId, 10),
            reason: result.reason || ''
        }
    });
    if (data?.success) {
        showNotification('Підміну збережено', 'success');
        await closeHrEditableModal('shiftModal', true);
        await loadSchedule();
    } else {
        showNotification(data?.error || 'Помилка підміни', 'error');
    }
}

async function copyWeek() {
    if (!canManage) return;
    const sourceWeek = formatDate(scheduleWeekStart);
    const nextWeek = new Date(scheduleWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const targetWeek = formatDate(nextWeek);

    if (!await confirmModal(`Копіювати розклад тижня ${sourceWeek} → ${targetWeek}?`, { type: 'warning', okText: 'Копіювати' })) return;

    const data = await hrFetch('/shifts/copy-week', {
        method: 'POST',
        body: JSON.stringify({ source_week: sourceWeek, target_week: targetWeek })
    });
    if (data && data.success) {
        showNotification(`Скопійовано ${data.count} змін`, 'success');
        scheduleWeekStart = nextWeek;
        await loadSchedule();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

// ==========================================
// TAB 3: TEAM
// ==========================================

async function ensureProfessionsLoaded(options = {}) {
    if (hrProfessions.length && !options.force) return hrProfessions;
    const data = await hrFetch('/professions');
    if (!data?.success) {
        if (!options.silent) showNotification(data?.error || 'Не вдалося завантажити професії', 'error');
        return hrProfessions;
    }
    hrProfessions = Array.isArray(data.data) ? data.data : [];
    return hrProfessions;
}

async function loadProfessions() {
    await ensureProfessionsLoaded({ force: true });
    await ensureCompanyStructureNodesLoaded({ silent: true });
    renderProfessions();
}

function renderProfessions() {
    const root = document.getElementById('professionCatalogList');
    if (!root) return;
    if (!hrProfessions.length) {
        root.innerHTML = '<div class="hr-account-empty">Каталог професій ще порожній.</div>';
        return;
    }
    root.innerHTML = hrProfessions.map(item => `
        <article class="hr-profession-card ${item.is_active === false ? 'inactive' : ''}">
            <div class="hr-profession-card-head">
                <div>
                    <h4>${escapeHtml(item.title || item.key)}</h4>
                    <span class="hr-profession-key">${escapeHtml(item.key)}</span>
                </div>
                ${item.department ? `<span class="hr-profession-chip">${escapeHtml(item.department)}</span>` : ''}
                ${(item.structure_node_id || item.structureNodeId) ? `<span class="hr-profession-chip">${escapeHtml(companyStructureNodeTitle(item.structure_node_id || item.structureNodeId))}</span>` : ''}
            </div>
            <p>${escapeHtml(item.shortInfo || item.short_info || 'Короткий опис ще не заповнений.')}</p>
            <div class="hr-profession-list">
                ${(item.responsibilities || []).slice(0, 4).map(text => `<span>${escapeHtml(text)}</span>`).join('') || '<span>Відповідальності ще не заповнені.</span>'}
            </div>
            <div class="hr-profession-actions">
                ${item.is_virtual || item.isVirtual ? '<span class="hr-profession-chip">Базова професія</span>' : `<button type="button" onclick="openProfessionEditor(${Number(item.id)})">Редагувати</button>`}
            </div>
        </article>
    `).join('');
}

async function loadProfessionChecklists() {
    await ensureProfessionsLoaded({ force: true });
    await ensureCompanyStructureNodesLoaded({ silent: true });
    renderProfessionChecklists();
}

function renderProfessionChecklists() {
    const root = document.getElementById('professionChecklistList');
    if (!root) return;
    const items = hrProfessions.filter(item => item.is_active !== false);
    if (!items.length) {
        root.innerHTML = '<div class="hr-account-empty">Активних професій для чеклістів немає.</div>';
        return;
    }
    root.innerHTML = items.map(item => `
        <article class="hr-checklist-card">
            <div class="hr-checklist-card-head">
                <div>
                    <h4>${escapeHtml(item.title || item.key)}</h4>
                    ${item.department ? `<span class="hr-profession-key">${escapeHtml(item.department)}</span>` : ''}
                </div>
                ${item.is_virtual || item.isVirtual ? '<span class="hr-profession-chip">Базова професія</span>' : `<button type="button" class="btn-secondary" onclick="openProfessionEditor(${Number(item.id)})">Змінити</button>`}
            </div>
            <p>${escapeHtml(item.shortInfo || item.short_info || 'Опис професії ще не заповнений.')}</p>
            <div class="hr-checklist-list">
                ${(item.checklist || []).map(text => `<span>${escapeHtml(text)}</span>`).join('') || '<span>Чекліст ще не заповнений.</span>'}
            </div>
        </article>
    `).join('');
}

function normalizeProfessionTextList(value) {
    if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
    return String(value || '').split(/\n|;/).map(v => v.trim()).filter(Boolean);
}

async function openProfessionEditor(professionId = null) {
    await ensureProfessionsLoaded({ silent: true });
    await ensureCompanyStructureNodesLoaded({ silent: true });
    const current = professionId ? hrProfessions.find(item => Number(item.id) === Number(professionId)) : null;
    if (current?.is_virtual || current?.isVirtual) {
        showNotification('Базову професію не можна редагувати з каталогу. Створіть окрему професію, якщо потрібна інша логіка.', 'warning');
        return;
    }
    const currentStructureNode = current?.structure_node_id || current?.structureNodeId || '';
    const result = await formModal(current ? `Професія · ${current.title}` : 'Нова професія', [
        { key: 'key', label: 'Key', required: true, defaultValue: current?.key || '', placeholder: 'animator', hint: current ? 'Технічний key після створення не змінюється, бо до нього привʼязані графік, ставки, чеклісти й навчання.' : '' },
        { key: 'title', label: 'Назва', required: true, defaultValue: current?.title || '', placeholder: 'Аніматор' },
        { key: 'department', label: 'Напрям', defaultValue: current?.department || '', placeholder: 'Аніматори / Зал / Кухня' },
        { key: 'structureNodeId', label: 'Вузол структури', type: 'select', defaultValue: currentStructureNode, options: companyStructureSelectOptions(currentStructureNode) },
        { key: 'shortInfo', label: 'Короткий опис', type: 'textarea', defaultValue: current?.shortInfo || current?.short_info || '', placeholder: 'Що тримає ця професія' },
        { key: 'responsibilities', label: 'Відповідальності, кожна з нового рядка', type: 'textarea', defaultValue: (current?.responsibilities || []).join('\n') },
        { key: 'checklist', label: 'Чекліст, кожен пункт з нового рядка', type: 'textarea', defaultValue: (current?.checklist || []).join('\n') },
        { key: 'color', label: 'Колір', defaultValue: current?.color || '#10b981', placeholder: '#10b981' },
        { key: 'sortOrder', label: 'Порядок', type: 'number', defaultValue: current?.sortOrder ?? current?.sort_order ?? 100 },
        { key: 'isActive', label: 'Статус', type: 'select', defaultValue: current?.is_active === false ? 'false' : 'true', options: [
            { value: 'true', label: 'Активна' },
            { value: 'false', label: 'Вимкнена' }
        ] }
    ], {
        icon: '🧩',
        type: 'info',
        okText: current ? 'Зберегти' : 'Створити',
        className: 'hr-profession-modal',
        closeOnBackdrop: false
    });
    if (!result) return;
    const body = {
        key: current?.key || result.key,
        title: result.title,
        department: result.department || null,
        shortInfo: result.shortInfo || '',
        responsibilities: normalizeProfessionTextList(result.responsibilities),
        checklist: normalizeProfessionTextList(result.checklist),
        structureNodeId: result.structureNodeId || null,
        color: result.color || null,
        sortOrder: parseInt(result.sortOrder, 10) || 100,
        isActive: result.isActive !== 'false'
    };
    const response = await hrFetch(current ? `/professions/${current.id}` : '/professions', {
        method: current ? 'PUT' : 'POST',
        body
    });
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося зберегти професію', 'error');
        return;
    }
    showNotification(current ? 'Професію оновлено' : 'Професію створено', 'success');
    await ensureProfessionsLoaded({ force: true });
    renderProfessions();
    if (document.getElementById('tab-checklists')?.classList.contains('active')) renderProfessionChecklists();
}

let teamStaff = [];
let staffDocumentNameById = new Map();
let onboardingResponsibleCandidates = null;
let accountUsers = [];
let accountRoleHierarchy = [];
let accountBusinessContexts = [];
let accountActionDefinitions = [];
let accountRolePresets = {};
let accountPageAccessMatrix = {};
let accountActionPermissionsMatrix = {};
let accountStaffOptions = [];
let accountCenterLastUpdatedId = null;
let accountConflicts = null;
let accountDeepLinkApplied = false;
const ACCOUNT_SECURITY_ROLES = ['creator', 'director'];
const ACCOUNT_PROFILE_ROLES = ['creator', 'director'];
const ACCOUNT_NON_DELEGABLE_ACTIONS = new Set(['manage_accounts', 'manage_users', 'manage_settings']);
const ACCOUNT_BUSINESS_SWITCH_ROLES = new Set(['creator', 'director']);
const ACCOUNT_ROLE_PRESET_LABELS = {
    executive: 'Керівництво',
    management: 'Менеджмент',
    operations: 'Операційний блок',
    creative: 'Креатив / арт',
    finance: 'Фінанси',
    programs: 'Програми / анімація',
    maysternyaDoli: 'Майстерня долі',
    support: 'Сервіс / підтримка'
};
const ACCOUNT_ROLE_PRESET_ORDER = ['management', 'operations', 'programs', 'creative', 'finance', 'support', 'maysternyaDoli', 'executive'];
const ACCOUNT_ACTION_LABELS = {
    create_booking: 'Створювати бронювання',
    edit_booking: 'Редагувати бронювання',
    cancel_booking: 'Скасовувати бронювання',
    delete_booking: 'Видаляти бронювання',
    manage_accounts: 'Керувати акаунтами',
    manage_users: 'Керувати користувачами',
    view_all: 'Бачити всі записи',
    view_own: 'Бачити свої записи',
    view_revenue: 'Бачити виручку',
    manage_settings: 'Керувати налаштуваннями',
    export_data: 'Експорт даних',
    manage_staff: 'Керувати персоналом'
};
const ACCOUNT_PAGE_LABELS = {
    '/': 'Таймлайн',
    '/dashboard': 'Dashboard',
    '/tasks': 'Задачі',
    '/chat': 'Чат',
    '/chat-settings': 'Налаштування чату',
    '/center': 'Центр цін',
    '/art': 'Арт',
    '/art-director': 'Арт-директор',
    '/content': 'Контент',
    '/designer': 'Дизайнер',
    '/designs': 'Дизайни',
    '/graduation': 'Випускні',
    '/customers': 'Клієнти',
    '/staff': 'Staff',
    '/warehouse': 'Склад',
    '/training': 'Навчання',
    '/settings': 'Налаштування',
    '/programs': 'Програми',
    '/hr': 'HR',
    '/checkin': 'Check-in',
    '/finance': 'Фінанси',
    '/analytics': 'Аналітика',
    '/status': 'Статус',
    '/guardian-ops': 'Охорона',
    '/omni': 'Omni',
    '/copilot': 'Клешня',
    '/sound': 'Звук',
    '/afisha': 'Афіша',
    '/certificates': 'Сертифікати',
    '/sales-funnel': 'Воронка',
    '/leads': 'Ліди',
    '/report-agent': 'Звіт-агент',
    '/reports': 'Звіти',
    '/game': 'Гра',
    '/profile': 'Профіль',
    '/quiz': 'Квіз',
    '/room': 'Кімната',
    '/shop': 'Магазин'
};

function canManageAccountSecurity() {
    return ACCOUNT_SECURITY_ROLES.includes(AppState.currentUser?.role);
}

function canManageAccountProfile() {
    return ACCOUNT_PROFILE_ROLES.includes(AppState.currentUser?.role);
}

function canManageAccountAccess() {
    return ACCOUNT_PROFILE_ROLES.includes(AppState.currentUser?.role);
}

function canLinkAccounts() {
    return ACCOUNT_SECURITY_ROLES.includes(AppState.currentUser?.role);
}

function canEditAccountBusinessContexts() {
    return ACCOUNT_BUSINESS_SWITCH_ROLES.has(AppState.currentUser?.role);
}

function accountRoleCanSwitchBusinessContext(role = '') {
    return ACCOUNT_BUSINESS_SWITCH_ROLES.has(String(role || '').trim());
}

function normalizeAccountListInput(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => String(item || '').trim())
            .filter(Boolean);
    }
    return String(value || '')
        .split(/[,;\n]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function getAccountBusinessCatalog() {
    if (accountBusinessContexts.length) return accountBusinessContexts;
    if (window.CrmBusinessContext?.contexts) return Object.values(window.CrmBusinessContext.contexts);
    return [
        { key: 'event_genix', label: 'Парк Закревського', shortLabel: 'Парк' },
        { key: 'dar', label: 'Дар', shortLabel: 'Дар' },
        { key: 'maysternya_doli', label: 'Майстерня долі', shortLabel: 'МД' },
        { key: 'crm', label: 'CRM продажі', shortLabel: 'CRM' }
    ];
}

function normalizeAccountBusinessSelection(value, fallback = ['event_genix']) {
    const catalog = new Set(getAccountBusinessCatalog().map(item => item.key));
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[,;\s]+/);
    const seen = new Set();
    const result = [];
    source.forEach(item => {
        const raw = String(item || '').trim();
        const key = window.CrmBusinessContext?.normalize?.(raw) || raw;
        if (!key || !catalog.has(key) || seen.has(key)) return;
        seen.add(key);
        result.push(key);
    });
    if (result.length) return result;
    return fallback ? normalizeAccountBusinessSelection(fallback, null) : [];
}

function getAccountBusinessOptions(selected = []) {
    const current = new Set(normalizeAccountBusinessSelection(selected));
    return getAccountBusinessCatalog().map(ctx => ({
        value: ctx.key,
        label: ctx.label || ctx.key,
        selected: current.has(ctx.key)
    }));
}

function formatAccountBusinessBadges(user = {}) {
    const values = normalizeAccountBusinessSelection(user.business_contexts || user.businessContexts);
    const catalog = new Map(getAccountBusinessCatalog().map(ctx => [ctx.key, ctx]));
    const defaultContext = getAccountDefaultBusinessValue(user, values);
    const labels = values.map(key => catalog.get(key)?.shortLabel || catalog.get(key)?.label || key).join(', ');
    const defaultLabel = catalog.get(defaultContext)?.shortLabel || catalog.get(defaultContext)?.label || defaultContext;
    return `${labels}${defaultContext ? ` · деф: ${defaultLabel}` : ''}`;
}

function getAccountDefaultBusinessValue(user = {}, selected = null) {
    const values = normalizeAccountBusinessSelection(selected || user.business_contexts || user.businessContexts);
    const raw = user.defaultBusinessContext || user.default_business_context || user.defaultContext || user.default_context || '';
    const normalized = raw ? normalizeAccountBusinessSelection([raw], []) : [];
    if (normalized[0] && values.includes(normalized[0])) return normalized[0];
    const nonDefault = values.filter(key => key !== 'event_genix');
    if (nonDefault.length === 1) return nonDefault[0];
    return values.includes('event_genix') ? 'event_genix' : (values[0] || 'event_genix');
}

function getAccountBusinessSelectOptions(selected = [], current = '') {
    const values = normalizeAccountBusinessSelection(selected);
    const requested = current ? normalizeAccountBusinessSelection([current], []) : [];
    const currentKey = requested[0] || getAccountDefaultBusinessValue({}, values);
    return getAccountBusinessCatalog()
        .map(ctx => ({
            value: ctx.key,
            label: `${ctx.label || ctx.key}${values.includes(ctx.key) ? '' : ' · додасться до доступу'}`,
            selected: ctx.key === currentKey
        }));
}

function getAccountRoleOptions(defaultRole = 'animator') {
    const roles = accountRoleHierarchy.length ? accountRoleHierarchy : Object.keys(ROLE_LABELS);
    const currentRole = AppState.currentUser?.role;
    const directorMaxIndex = roles.indexOf('director');
    const allowedRoles = currentRole === 'creator'
        ? roles
        : roles.filter(role => directorMaxIndex < 0 || roles.indexOf(role) >= 0 && roles.indexOf(role) < directorMaxIndex);
    return roles
        .filter(role => allowedRoles.includes(role))
        .map(role => ({ value: role, label: ROLE_LABELS[role] || role }))
        .sort((a, b) => a.label.localeCompare(b.label, 'uk'))
        .map(option => ({ ...option, selected: option.value === defaultRole }));
}

function getAccountExtraRoleOptions(primaryRole = 'animator', selected = []) {
    const selectedRoles = normalizeAccountArray(selected);
    return getAccountRoleOptions()
        .filter(option => option.value !== primaryRole)
        .map(option => ({
            ...option,
            selected: selectedRoles.includes(option.value)
        }));
}

function accountRoleLevel(role = '') {
    const roles = accountRoleHierarchy.length ? accountRoleHierarchy : Object.keys(ROLE_LABELS);
    const index = roles.indexOf(String(role || '').trim());
    return index >= 0 ? index : -1;
}

function accountMaxRoleLevel(user = {}) {
    return normalizeAccountRoleSelection(user.role, user.extra_roles || user.extraRoles)
        .reduce((max, role) => Math.max(max, accountRoleLevel(role)), -1);
}

function currentAccountCanManageRoleSet(primaryRole = 'animator', extraRoles = []) {
    const actorRole = AppState.currentUser?.role;
    if (!ACCOUNT_SECURITY_ROLES.includes(actorRole)) return false;
    if (actorRole === 'creator') return true;
    const directorLevel = accountRoleLevel('director');
    const maxTargetLevel = normalizeAccountRoleSelection(primaryRole, extraRoles)
        .reduce((max, role) => Math.max(max, accountRoleLevel(role)), -1);
    return maxTargetLevel >= 0 && maxTargetLevel < directorLevel;
}

function currentAccountCanMutateTarget(user = {}) {
    const actorRole = AppState.currentUser?.role;
    if (!ACCOUNT_SECURITY_ROLES.includes(actorRole)) return false;
    if (actorRole === 'creator') return true;
    const directorLevel = accountRoleLevel('director');
    const targetLevel = accountMaxRoleLevel(user);
    return targetLevel >= 0 && targetLevel < directorLevel;
}

function currentAccountCanToggleTarget(user = {}) {
    if (!currentAccountCanMutateTarget(user)) return false;
    return Number(user.id) !== Number(AppState.currentUser?.id);
}

function getAccountRolePresetButtons(currentRole = 'animator') {
    const allowedRoleValues = new Set(getAccountRoleOptions(currentRole).map(option => option.value));
    return ACCOUNT_ROLE_PRESET_ORDER
        .map(key => {
            const presetRoles = Array.isArray(accountRolePresets[key]) ? accountRolePresets[key] : [];
            const roles = presetRoles
                .filter(role => role !== 'creator')
                .filter(role => allowedRoleValues.has(role));
            if (!roles.length) return null;
            const sorted = roles.slice().sort((a, b) => accountRoleLevel(b) - accountRoleLevel(a));
            const primary = sorted[0];
            const extraRoles = sorted.filter(role => role !== primary).slice(0, 3);
            if (!currentAccountCanManageRoleSet(primary, extraRoles)) return null;
            const roleNames = [primary, ...extraRoles]
                .map(role => ROLE_LABELS[role] || role)
                .join(', ');
            const values = {
                role: primary,
                extraRoles
            };
            if (key === 'maysternyaDoli' && accountRoleCanSwitchBusinessContext(primary)) {
                values.businessContexts = normalizeAccountBusinessSelection(['event_genix', 'maysternya_doli']);
                values.defaultBusinessContext = 'maysternya_doli';
            }
            return {
                label: ACCOUNT_ROLE_PRESET_LABELS[key] || key,
                hint: `${roleNames}${values.defaultBusinessContext === 'maysternya_doli' ? ' · Майстерня за замовченням' : ''}`,
                values
            };
        })
        .filter(Boolean);
}

function getAccountActionOptions(selected = [], options = {}) {
    const includeNonDelegable = options.includeNonDelegable !== false;
    const current = new Set(normalizeAccountListInput(Array.isArray(selected) ? selected.join(',') : selected));
    const actions = accountActionDefinitions.length
        ? accountActionDefinitions.map(item => item.key || item)
        : Object.keys(ACCOUNT_ACTION_LABELS);
    return actions
        .filter(Boolean)
        .filter(action => includeNonDelegable || !ACCOUNT_NON_DELEGABLE_ACTIONS.has(action))
        .map(action => ({
            value: action,
            label: ACCOUNT_ACTION_LABELS[action] || action,
            selected: current.has(action)
        }));
}

function getAccountPageOptions(selected = []) {
    const current = new Set(normalizeAccountListInput(selected));
    const pages = Object.keys(accountPageAccessMatrix || {}).length
        ? Object.keys(accountPageAccessMatrix)
        : Object.keys(ACCOUNT_PAGE_LABELS);
    const priority = ['/', '/dashboard', '/tasks', '/customers', '/sales-funnel', '/leads', '/hr', '/maysternya-doli'];
    return Array.from(new Set(pages.filter(Boolean)))
        .sort((a, b) => {
            const ai = priority.indexOf(a);
            const bi = priority.indexOf(b);
            if (ai >= 0 || bi >= 0) return (ai >= 0 ? ai : 999) - (bi >= 0 ? bi : 999);
            return (ACCOUNT_PAGE_LABELS[a] || a).localeCompare(ACCOUNT_PAGE_LABELS[b] || b, 'uk');
        })
        .map(page => ({
            value: page,
            label: `${ACCOUNT_PAGE_LABELS[page] || page} · ${page}`,
            selected: current.has(page)
        }));
}

function normalizeAccountRoleSelection(primaryRole = 'animator', extraRoles = []) {
    const roles = [];
    const primary = String(primaryRole || '').trim();
    if (primary) roles.push(primary);
    normalizeAccountArray(extraRoles).forEach(role => {
        if (role && !roles.includes(role)) roles.push(role);
    });
    return roles.filter(role => (accountRoleHierarchy.length ? accountRoleHierarchy : Object.keys(ROLE_LABELS)).includes(role));
}

function accessMatrixAllowsRole(allowedRoles, role) {
    if (allowedRoles === null) return true;
    if (!Array.isArray(allowedRoles)) return false;
    return role === 'creator' || allowedRoles.includes(role);
}

function accessMatrixAllowsAnyRole(allowedRoles, roles = []) {
    return roles.some(role => accessMatrixAllowsRole(allowedRoles, role));
}

function formatAccountRoleAccessPack(primaryRole = 'animator', extraRoles = [], manualAllow = [], manualDeny = [], manualPages = []) {
    const roles = normalizeAccountRoleSelection(primaryRole, extraRoles);
    const roleNames = roles.map(role => ROLE_LABELS[role] || role).join(', ') || 'роль не вибрано';
    const pageEntries = Object.entries(accountPageAccessMatrix || {})
        .filter(([, allowedRoles]) => accessMatrixAllowsAnyRole(allowedRoles, roles))
        .map(([page]) => ACCOUNT_PAGE_LABELS[page] || page)
        .filter(Boolean);
    const actionEntries = Object.entries(accountActionPermissionsMatrix || {})
        .filter(([, allowedRoles]) => accessMatrixAllowsAnyRole(allowedRoles, roles))
        .map(([action]) => ACCOUNT_ACTION_LABELS[action] || action)
        .filter(Boolean);
    const allowEntries = normalizeAccountArray(manualAllow)
        .filter(action => !ACCOUNT_NON_DELEGABLE_ACTIONS.has(action))
        .map(action => ACCOUNT_ACTION_LABELS[action] || action);
    const denyEntries = normalizeAccountArray(manualDeny)
        .map(action => ACCOUNT_ACTION_LABELS[action] || action);
    const pageAllowEntries = normalizeAccountArray(manualPages)
        .map(page => ACCOUNT_PAGE_LABELS[page] || page);
    const shortList = (items, empty = 'немає') => {
        const unique = Array.from(new Set(items));
        if (!unique.length) return empty;
        const visible = unique.slice(0, 10).join(', ');
        return unique.length > 10 ? `${visible} +${unique.length - 10}` : visible;
    };
    return [
        `Пакет ролей: ${roleNames}`,
        `Сторінки: ${shortList(pageEntries)}`,
        `Дії: ${shortList(actionEntries)}`,
        `Ручні сторінки: ${shortList(pageAllowEntries)}`,
        `Ручний allow: ${shortList(allowEntries)}`,
        `Ручний deny: ${shortList(denyEntries)}`,
        'Пакет ролі застосовується автоматично після нового входу. Allow/Deny нижче потрібні тільки для точкових винятків.'
    ].join('\n');
}

function renderAccountRolePackFromForm(values = {}, fallback = {}) {
    return formatAccountRoleAccessPack(
        values.role || fallback.role || 'animator',
        Array.isArray(values.extraRoles) ? values.extraRoles : (fallback.extraRoles || []),
        Array.isArray(values.actionAllowlist) ? values.actionAllowlist : (fallback.actionAllowlist || []),
        Array.isArray(values.actionDenylist) ? values.actionDenylist : (fallback.actionDenylist || []),
        values.pageAllowlist !== undefined ? normalizeAccountListInput(values.pageAllowlist) : (fallback.pageAllowlist || [])
    );
}

async function loadAccountRoleDefinitions() {
    if (accountRoleHierarchy.length && accountBusinessContexts.length && Object.keys(accountRolePresets).length && Object.keys(accountPageAccessMatrix).length && Object.keys(accountActionPermissionsMatrix).length) return;
    const data = await crmApiFetch('/api/users/roles');
    if (Array.isArray(data?.hierarchy)) {
        accountRoleHierarchy = data.hierarchy.filter(role => ROLE_LABELS[role] || role);
    }
    if (data?.rolePresets && typeof data.rolePresets === 'object') {
        accountRolePresets = data.rolePresets;
    }
    if (Array.isArray(data?.businessContexts)) {
        accountBusinessContexts = data.businessContexts;
    }
    if (Array.isArray(data?.actions)) {
        accountActionDefinitions = data.actions;
    } else if (data?.actionPermissions && typeof data.actionPermissions === 'object') {
        accountActionDefinitions = Object.keys(data.actionPermissions).map(key => ({ key, roles: data.actionPermissions[key] || [] }));
    }
    if (data?.pageAccess && typeof data.pageAccess === 'object') {
        accountPageAccessMatrix = data.pageAccess;
    }
    if (data?.actionPermissions && typeof data.actionPermissions === 'object') {
        accountActionPermissionsMatrix = data.actionPermissions;
    } else if (Array.isArray(data?.actions)) {
        accountActionPermissionsMatrix = Object.fromEntries(data.actions.map(action => [action.key, action.roles || []]).filter(([key]) => key));
    }
}

async function loadAccountStaffOptions(force = false) {
    if (accountStaffOptions.length && !force) return;
    const data = await crmApiFetch('/api/users/staff-options');
    if (data?.success && Array.isArray(data.staff)) {
        accountStaffOptions = data.staff;
    }
}

function getAccountStaffSelectOptions(currentUserId = null) {
    const options = [{ value: '', label: 'Без HR staff-профілю' }];
    accountStaffOptions.forEach(staff => {
        const linkedUserId = staff.linked_user_id || staff.linkedUserId;
        const linkedUsername = staff.linked_username || staff.linkedUsername;
        const locked = linkedUserId && Number(linkedUserId) !== Number(currentUserId)
            ? ` · зайнято: ${linkedUsername || 'інший акаунт'}`
            : '';
        options.push({
            value: String(staff.id),
            label: `${staff.name}${staff.department ? ' · ' + staff.department : ''}${staff.position ? ' · ' + staff.position : ''}${locked}`
        });
    });
    return options;
}

function suggestAccountUsernameFromStaff(staff = {}) {
    const key = String(staff.unique_person_key || '').replace(/\.\w+$/, '');
    const raw = key || staff.name || `staff.${staff.id || ''}`;
    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.+|\.+$/g, '');
    return normalized || `staff.${staff.id || Date.now()}`;
}

function staffRoleToAccountRole(roleType) {
    const role = String(roleType || '').trim();
    const aliases = {
        trampoline_instructor: 'instructor',
        cleaner: 'cleaning',
        technician: 'maintenance',
        head_cook: 'head_chef',
        bartender: 'barista',
        hr_manager: 'hr',
        host: 'animator',
        intern: 'animator'
    };
    const mapped = aliases[role] || role;
    const roles = accountRoleHierarchy.length ? accountRoleHierarchy : Object.keys(ROLE_LABELS);
    return roles.includes(mapped) ? mapped : 'animator';
}

function accountCredentialPassword(credential) {
    return credential?.password || credential?.oneTimePassword || '';
}

function showOneTimeCredentialModal(credential, title = 'Одноразові облікові дані', payload = {}) {
    if (!credential) return;
    const username = credential.username || '';
    const password = accountCredentialPassword(credential);
    const text = `Логін: ${username}\nПароль: ${password}`;
    const active = payload.isActive !== false;
    const hasReadiness = Object.prototype.hasOwnProperty.call(payload, 'loginReady');
    const readinessMessage = hasReadiness
        ? (payload.loginReady
            ? '\n\nПеревірено сервером: цей логін і пароль готові до входу.'
            : `\n\nУвага: сервер не підтвердив готовність входу (${payload.loginReadyReason || 'невідомо'}).`)
        : '';
    const statusMessage = active
        ? ''
        : '\n\nУвага: пароль оновлено, але акаунт вимкнений. Активуйте акаунт перед входом.';
    if (typeof confirmModal === 'function') {
        confirmModal(`${title}\n\n${text}${statusMessage}${readinessMessage}\n\nСкопіюйте зараз: старий пароль у CRM не можна переглянути повторно.`, {
            type: 'warning',
            okText: 'Скопіювати',
            cancelText: 'Закрити'
        }).then(ok => {
            if (ok && navigator.clipboard) {
                navigator.clipboard.writeText(text).then(() => showNotification('Одноразові облікові дані скопійовано', 'success'));
            }
        });
        return;
    }
    if (typeof showNotification === 'function') {
        showNotification(text, 'info');
    } else {
        console.info(`${title}\n\n${text}`);
    }
}

function showManualPasswordResetResult(payload = {}, user = {}) {
    const username = payload.login || payload.username || user.username || '';
    const copyText = username ? `Логін: ${username}` : '';
    const active = payload.isActive !== false;
    const hasReadiness = Object.prototype.hasOwnProperty.call(payload, 'loginReady');
    const readinessMessage = hasReadiness && active
        ? (payload.loginReady
            ? 'Сервер перевірив: новий пароль готовий до входу.'
            : `Сервер не підтвердив готовність входу: ${payload.loginReadyReason || 'невідомо'}.`)
        : '';
    const message = [
        username ? `Логін для входу: ${username}` : 'Пароль оновлено.',
        active
            ? 'Пароль оновлено, старі сесії скинуто. Користувач може входити з новим паролем.'
            : 'Пароль оновлено, але акаунт вимкнений. Активуйте акаунт перед входом.',
        readinessMessage
    ].join('\n');

    if (typeof confirmModal === 'function' && username) {
        confirmModal(message, {
            type: active ? 'success' : 'warning',
            okText: 'Скопіювати логін',
            cancelText: 'Закрити'
        }).then(ok => {
            if (ok && navigator.clipboard) {
                navigator.clipboard.writeText(copyText).then(() => showNotification('Логін скопійовано', 'success'));
            }
        });
        return;
    }
    showNotification(active ? message : 'Пароль оновлено, але акаунт вимкнений', active ? 'success' : 'warning');
}

async function loadAccountConflicts() {
    try {
        const data = await crmApiFetch('/api/users/link-conflicts');
        accountConflicts = data?.success ? data : null;
    } catch {
        accountConflicts = null;
    }
    return accountConflicts;
}

function renderAccountConflictSummary() {
    const root = document.getElementById('accountCenterConflictSummary');
    if (!root) return;
    const counts = accountConflicts?.counts || {};
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    root.classList.toggle('hidden', !accountConflicts);
    if (!accountConflicts) {
        root.innerHTML = '';
        return;
    }
    const parts = [
        `unlinked users: ${Number(counts.unlinkedUsers || 0)}`,
        `unlinked staff: ${Number(counts.unlinkedStaff || 0)}`,
        `inactive links: ${Number(counts.inactiveProfileConflicts || 0)}`,
        `telegram duplicates: ${Number(counts.duplicateTelegramIdentities || 0)}`,
        `ambiguous profiles: ${Number(counts.ambiguousProfiles || 0)}`
    ];
    root.innerHTML = `
        <strong>Контроль звʼязків:</strong>
        <span>${total ? parts.join(' · ') : 'конфліктів у швидкому аудиті не знайдено'}</span>
    `;
}

function applyAccountDeepLinkFilters() {
    if (accountDeepLinkApplied) return;
    const params = new URLSearchParams(window.location.search);
    const accountUser = params.get('accountUser');
    const accountStaff = params.get('accountStaff');
    let target = null;
    if (accountUser && /^\d+$/.test(accountUser)) {
        target = accountUsers.find(user => Number(user.id) === Number(accountUser));
    }
    if (!target && accountStaff && /^\d+$/.test(accountStaff)) {
        target = accountUsers.find(user => Number(user.staff_id) === Number(accountStaff));
    }
    if (!target) return;
    accountDeepLinkApplied = true;
    accountCenterLastUpdatedId = target.id;
    setAccountCenterFilters({
        query: target.username || target.name || target.staff_name || '',
        activeOnly: false,
        showSystem: false
    }, { render: false });
}

async function loadTeam() {
    await ensureProfessionsLoaded({ silent: true });
    await ensureCompanyStructureNodesLoaded({ silent: true });
    const grid = document.getElementById('teamGrid');
    if (grid) renderPeopleBucketState('Завантаження команди...', 'loading');
    const data = await hrFetch('/staff');
    if (!data) {
        if (grid) renderPeopleBucketState('Помилка завантаження. Оновіть сторінку.', 'error');
        return;
    }
    if (!data.success) {
        if (grid) renderPeopleBucketState(data.error || 'Помилка сервера', 'error');
        return;
    }
    teamStaff = data.data || [];
    // Show missing data banner
    const activeStaff = teamStaff.filter(s => s.is_active);
    const missingFace = activeStaff.filter(s => !s.has_face_descriptor).length;
    const missingAccount = activeStaff.filter(s => !s.has_account).length;
    const banner = document.getElementById('teamMissingBanner');
    if (banner) {
        if (missingFace > 0 || missingAccount > 0) {
            const msgs = [];
            if (missingFace) msgs.push(`📸 ${missingFace} без фото для камери`);
            if (missingAccount) msgs.push(`🔑 ${missingAccount} без акаунту CRM`);
            banner.innerHTML = `<div class="hr-missing-banner">⚠️ ${msgs.join(' · ')}</div>`;
            banner.style.display = '';
        } else {
            banner.style.display = 'none';
        }
    }
    filterAndRenderTeam();
    // Attach filter listeners (idempotent)
    const searchEl = document.getElementById('teamSearch');
    const roleEl = document.getElementById('teamRoleFilter');
    const activeEl = document.getElementById('teamActiveOnly');
    if (searchEl) searchEl.oninput = filterAndRenderTeam;
    if (roleEl) roleEl.onchange = filterAndRenderTeam;
    if (activeEl) activeEl.onchange = filterAndRenderTeam;
}

function filterAndRenderTeam() {
    const query = normalizeSearchText(document.getElementById('teamSearch')?.value);
    const role = document.getElementById('teamRoleFilter')?.value;
    const showDismissed = document.getElementById('teamActiveOnly')?.checked ?? true;

    let filtered = teamStaff;
    if (!showDismissed) {
        filtered = filtered.filter(s => bucketForStaff(s) !== 'dismissed');
    }
    if (query) {
        filtered = filtered.filter(s => teamSearchHaystack(s).includes(query));
    }
    if (role) {
        filtered = filtered.filter(s => staffHasProfession(s, role));
    }

    updateTeamFilterInfo(filtered.length, teamStaff.length);
    renderTeam(filtered);
}

function updateTeamFilterInfo(filteredCount = 0, totalCount = 0) {
    const info = document.getElementById('teamFilterInfo');
    if (!info) return;
    const query = normalizeSearchText(document.getElementById('teamSearch')?.value);
    const role = document.getElementById('teamRoleFilter')?.value;
    const showDismissed = document.getElementById('teamActiveOnly')?.checked ?? true;
    if (!totalCount) {
        info.textContent = 'Список порожній';
        return;
    }
    const dismissedCount = teamStaff.filter(s => bucketForStaff(s) === 'dismissed').length;
    const activeCount = Math.max(0, totalCount - dismissedCount);
    const visibleTotal = showDismissed ? totalCount : activeCount;
    if (query || role) {
        info.textContent = `${filteredCount} з ${visibleTotal}`;
        return;
    }
    info.textContent = showDismissed
        ? `${activeCount} активних · ${dismissedCount} звільнених`
        : `${activeCount} активних`;
}

function renderTeam(staff) {
    const grid = document.getElementById('teamGrid');
    if (!grid) return;
    grid.className = 'hr-people-accordion';
    const showDismissed = document.getElementById('teamActiveOnly')?.checked ?? true;
    const buckets = visiblePeopleBuckets().filter(bucket => showDismissed || bucket.id !== 'dismissed');
    if (!buckets.length) {
        updatePeopleNavCounts([]);
        grid.innerHTML = '<div class="hr-people-empty">Немає доступних списків команди для цієї ролі</div>';
        syncHrNavActive('team', null);
        return;
    }
    const forcedBucket = pendingPeopleBucket ? normalizeVisiblePeopleBucket(pendingPeopleBucket) : null;
    if (pendingPeopleBucket) {
        activePeopleBucket = forcedBucket;
        pendingPeopleBucket = null;
    }
    if (!forcedBucket && !buckets.some(bucket => bucket.id === activePeopleBucket)) {
        activePeopleBucket = firstVisiblePeopleBucketId();
    }
    if (!activePeopleBucket) activePeopleBucket = firstVisiblePeopleBucketId();
    const countSource = showDismissed ? teamStaff : teamStaff.filter(item => bucketForStaff(item) !== 'dismissed');
    const totalCounts = new Map(buckets.map(bucket => [
        bucket.id,
        countSource.filter(item => bucketForStaff(item) === bucket.id).length
    ]));
    const grouped = buckets.map(bucket => ({
        ...bucket,
        totalCount: totalCounts.get(bucket.id) || 0,
        staff: staff.filter(item => bucketForStaff(item) === bucket.id)
    }));
    updatePeopleNavCounts(grouped);
    grid.innerHTML = grouped.map(bucket => {
        const isOpen = bucket.id === activePeopleBucket;
        return `<section class="hr-people-bucket ${isOpen ? 'is-open' : ''}" data-people-bucket="${escapeHtml(bucket.id)}">
            <button type="button" class="hr-people-bucket-toggle" aria-expanded="${isOpen ? 'true' : 'false'}" onclick="setPeopleBucket('${escapeHtml(bucket.id)}')">
                <span>
                    <span class="hr-people-bucket-title">${escapeHtml(bucket.title)}</span>
                    <span class="hr-people-bucket-note">${escapeHtml(bucket.note)}</span>
                </span>
                <span class="hr-people-bucket-count">${bucket.totalCount}</span>
                <span class="hr-people-bucket-icon">${isOpen ? '▲' : '▼'}</span>
            </button>
            <div class="hr-people-bucket-body">
                ${bucket.staff.length ? `<div class="hr-people-bucket-grid">${renderTeamCards(bucket.staff)}</div>` : '<div class="hr-people-empty">Список порожній за поточними фільтрами</div>'}
            </div>
        </section>`;
    }).join('');
    initTeamDragAndDrop();
    syncHrNavActive('team', activePeopleBucket);
}

function renderPeopleBucketState(message, state = 'empty') {
    const grid = document.getElementById('teamGrid');
    if (!grid) return;
    grid.className = 'hr-people-accordion';
    const buckets = visiblePeopleBuckets();
    if (!buckets.length) {
        updatePeopleNavCounts([]);
        grid.innerHTML = '<div class="hr-people-empty">Немає доступних списків команди для цієї ролі</div>';
        syncHrNavActive('team', null);
        return;
    }
    const grouped = buckets.map(bucket => ({ ...bucket, staff: [] }));
    updatePeopleNavCounts(grouped);
    if (!buckets.some(bucket => bucket.id === activePeopleBucket)) activePeopleBucket = firstVisiblePeopleBucketId();
    if (!activePeopleBucket) activePeopleBucket = firstVisiblePeopleBucketId();
    grid.innerHTML = grouped.map(bucket => {
        const isOpen = bucket.id === activePeopleBucket;
        return `<section class="hr-people-bucket ${isOpen ? 'is-open' : ''}" data-people-bucket="${escapeHtml(bucket.id)}">
            <button type="button" class="hr-people-bucket-toggle" aria-expanded="${isOpen ? 'true' : 'false'}" onclick="setPeopleBucket('${escapeHtml(bucket.id)}')">
                <span>
                    <span class="hr-people-bucket-title">${escapeHtml(bucket.title)}</span>
                    <span class="hr-people-bucket-note">${escapeHtml(bucket.note)}</span>
                </span>
                <span class="hr-people-bucket-count">0</span>
                <span class="hr-people-bucket-icon">${isOpen ? '▲' : '▼'}</span>
            </button>
            <div class="hr-people-bucket-body">
                <div class="hr-people-empty hr-people-empty--${escapeHtml(state)}">${escapeHtml(message)}</div>
            </div>
        </section>`;
    }).join('');
    syncHrNavActive('team', activePeopleBucket);
}

window.setPeopleBucket = function(bucketId) {
    const nextBucket = normalizeVisiblePeopleBucket(bucketId);
    activePeopleBucket = nextBucket;
    const hashTarget = activePeopleBucket ? hashForHrTarget('team', activePeopleBucket) : 'team';
    history.replaceState(null, '', hashTarget === 'team' ? window.location.pathname + '#team' : `${window.location.pathname}#${hashTarget}`);
    filterAndRenderTeam();
};

function renderTeamCards(staff) {
    return staff.map(s => {
        const initials = s.name.split(' ').map(w => w[0]).join('').substring(0, 2);
        const avatar = s.photo_url
            ? `<img src="${escapeHtml(s.photo_url)}" alt="${escapeHtml(s.name)}">`
            : initials;
        const roleLabel = ROLE_LABELS[s.role_type] || s.role_type || '';
        const secondary = staffSecondaryProfessions(s);
        const secondaryChips = renderProfessionChips(secondary);
        const hireStr = s.hire_date ? new Date(s.hire_date).toLocaleDateString('uk-UA') : '';
        const phone = s.phone || '';
        const emergency = s.emergency_contact
            ? `Екстр: ${escapeHtml(s.emergency_contact)}${s.emergency_phone ? ', ' + escapeHtml(s.emergency_phone) : ''}`
            : '';
        const poolStatus = s.hr_pool_status || 'core';
        const poolBadge = poolStatus !== 'core'
            ? `<span class="hr-team-status-pill ${poolStatus === 'blacklisted' ? 'is-warn' : 'is-info'}">${HR_POOL_LABELS[poolStatus] || escapeHtml(poolStatus)}</span>`
            : '';
        const dismissedMeta = s.is_active === false
            ? [
                s.termination_date ? `дата: ${formatStaffDateValue(s.termination_date)}` : '',
                s.termination_reason ? `причина: ${escapeHtml(s.termination_reason)}` : ''
            ].filter(Boolean).join(' · ')
            : '';
        const accountActions = canLinkAccounts()
            ? (s.has_account
                ? `<button type="button" class="hr-account-toggle" onclick="openAccountForStaff(${Number(s.id)}, this)">Акаунт</button>`
                : `
                    <button type="button" class="hr-account-toggle" onclick="openAccountLinkForStaff(${Number(s.id)}, this)">Привʼязати акаунт</button>
                    ${canManageAccountSecurity() ? `<button type="button" class="hr-account-toggle" onclick="openAccountCreateForStaff(${Number(s.id)}, this)">Створити акаунт</button>` : ''}
                `)
            : '';
        const contactRows = [
            phone ? `<span><b>Телефон</b>${escapeHtml(phone)}</span>` : '',
            emergency ? `<span><b>Екстр.</b>${emergency}</span>` : '',
            s.address ? `<span><b>Адреса</b>${escapeHtml(s.address)}</span>` : '',
            renderStaffRateSummary(s) ? `<span><b>Ставка</b>${escapeHtml(renderStaffRateSummary(s))}</span>` : '',
            staffStructureNodeTitle(s) ? `<span><b>Структ.</b>${escapeHtml(staffStructureNodeTitle(s))}</span>` : ''
        ].filter(Boolean).join('');
        const primaryRole = professionTitle(s.role_type) || roleLabel || 'Професія не задана';
        const profileClick = `openStaffEdit(${Number(s.id)})`;
        const avatarNode = canManage
            ? `<button type="button" class="hr-team-avatar hr-team-profile-trigger" style="${s.color ? 'background:' + s.color + '30;color:' + s.color : ''}" onclick="${profileClick}" title="Відкрити профіль: ${escapeHtml(s.name)}" aria-label="Відкрити профіль: ${escapeHtml(s.name)}">${avatar}</button>`
            : `<div class="hr-team-avatar" style="${s.color ? 'background:' + s.color + '30;color:' + s.color : ''}">${avatar}</div>`;
        const nameNode = canManage
            ? `<button type="button" class="hr-team-name hr-team-name-button" onclick="${profileClick}" title="Відкрити профіль">${escapeHtml(s.name)}</button>`
            : `<div class="hr-team-name">${escapeHtml(s.name)}</div>`;
        const profileTopAction = canManage
            ? `<button type="button" class="hr-team-edit hr-team-edit--top" onclick="${profileClick}">Профіль</button>`
            : '';

        return `<article class="hr-team-card ${s.is_active ? '' : 'inactive'}" data-staff-id="${Number(s.id)}" data-current-bucket="${escapeHtml(bucketForStaff(s))}" draggable="${canManage ? 'true' : 'false'}">
            <div class="hr-team-card-head">
                ${avatarNode}
                <div class="hr-team-details">
                    <div class="hr-team-name-row">
                        <div class="hr-team-title-main">
                            ${nameNode}
                            ${s.is_active ? '' : '<span class="hr-team-status-pill is-muted">звільнений</span>'}
                        </div>
                        ${profileTopAction}
                    </div>
                    <div class="hr-team-role">
                        <strong>${escapeHtml(primaryRole)}</strong>
                        ${s.position ? `<span>${escapeHtml(s.position)}</span>` : ''}
                        ${hireStr ? `<span>з ${hireStr}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="hr-team-profession-area">
                ${secondaryChips || '<span class="hr-team-no-secondary">Додаткові професії не додані</span>'}
            </div>
            <div class="hr-team-status-row">
                ${renderStaffReadinessBadges(s)}
                ${poolBadge}
            </div>
            ${renderStaffTrainingReadiness(s)}
            ${renderStaffOnboardingAssignment(s)}
            ${contactRows ? `<div class="hr-team-contact-grid">${contactRows}</div>` : '<div class="hr-team-contact-grid is-empty">Контакти не заповнені</div>'}
            ${dismissedMeta ? `<div class="hr-team-warning-note">Звільнення: ${dismissedMeta}</div>` : ''}
            ${poolStatus === 'blacklisted' && s.blacklist_reason ? `<div class="hr-team-warning-note">Причина: ${escapeHtml(s.blacklist_reason)}</div>` : ''}
            <div class="hr-team-actions">
                ${accountActions}
                ${canManage ? `<button type="button" class="hr-team-document" data-ui-contract="hr-staff-document-paperclip" onclick="openStaffDocuments(${Number(s.id)})" title="Скани документів" aria-label="Скани документів: ${escapeHtml(s.name)}">Док.</button>
                    <button type="button" class="hr-team-move" onclick="openStaffMoveMenu(${Number(s.id)}, this)">Перемістити</button>
                    <button type="button" class="hr-team-delete" onclick="deleteStaffProfile(${Number(s.id)})">Видалити</button>` : ''}
            </div>
        </article>`;
    }).join('');
}

function buildStaffMovePayload(staff = {}, targetBucket = 'workers', targetRole = '', reason = '') {
    const currentPrimary = normalizeProfessionKey(staff.role_type);
    const currentSecondary = staffSecondaryProfessions(staff);
    const body = {};
    if (targetBucket === 'reserve') {
        body.hr_pool_status = 'reserve';
        body.blacklist_reason = null;
        return body;
    }
    if (targetBucket === 'blacklist') {
        body.hr_pool_status = 'blacklisted';
        body.blacklist_reason = String(reason || staff.blacklist_reason || '').trim();
        return body;
    }
    if (targetBucket === 'interns') {
        body.hr_pool_status = 'core';
        body.blacklist_reason = null;
        body.role_type = 'intern';
        body.secondary_professions = normalizeProfessionList([
            currentPrimary && currentPrimary !== 'intern' ? currentPrimary : '',
            ...currentSecondary
        ], ['intern']);
        return body;
    }
    const nextPrimary = normalizeProfessionKey(targetRole) || preferredWorkerRoleForStaff(staff);
    body.hr_pool_status = 'core';
    body.blacklist_reason = null;
    if (currentPrimary === 'intern' || currentSecondary.includes('intern')) {
        body.role_type = nextPrimary;
        body.secondary_professions = normalizeProfessionList(
            currentSecondary.filter(key => key !== 'intern'),
            [nextPrimary]
        );
    }
    return body;
}

async function setStaffProfileActive(staffId, isActive) {
    const data = await hrFetch(`/staff/${staffId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: Boolean(isActive) })
    });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося оновити активність профілю', 'error');
        return false;
    }
    if (isActive && data.account_reactivation_blocked) {
        showNotification('Співробітника активовано, але linked CRM-акаунт потребує доступу manage_accounts.', 'warning');
    }
    return true;
}

function formatStaffDeleteItems(items = [], emptyText = 'немає') {
    if (!Array.isArray(items) || !items.length) return emptyText;
    return items.map(item => `${item.label}: ${Number(item.count || 0)}`).join('; ');
}

async function deleteStaffProfile(staffId) {
    if (!canManage) {
        showNotification('Видалення працівників доступне тільки HR/керівникам', 'error');
        return;
    }
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!staff) return;

    const readiness = await hrFetch(`/staff/${staffId}/delete-readiness`);
    if (!readiness?.success) {
        showNotification(readiness?.error || 'Не вдалося перевірити можливість видалення', 'error');
        return;
    }
    const data = readiness.data || {};
    if (!data.can_delete) {
        const blockers = formatStaffDeleteItems(data.blockers, 'немає');
        if (typeof confirmModal === 'function') {
            await confirmModal(
                `Працівника "${staff.name}" не можна видалити назавжди.\n\nЗнайдені звʼязані записи: ${blockers}.\n\nДля реальної людини використовуйте offboarding. Для дубля спершу приберіть або перенесіть звʼязки.`,
                { type: 'warning', okText: 'Зрозуміло', cancelText: 'Закрити' }
            );
        } else {
            showNotification('Є звʼязані записи. Видалення заблоковано.', 'warning');
        }
        return;
    }

    const cleanup = formatStaffDeleteItems(data.cleanup, 'службових записів немає');
    const result = await formModal(`Видалити працівника · ${staff.name}`, [
        {
            key: 'confirmation',
            label: 'Введіть ТАК для підтвердження',
            placeholder: 'ТАК',
            required: true,
            hint: `Це hard delete для дублів. Після видалення картку не можна відновити з HR. Автоматично зачепить: ${cleanup}.`
        },
        {
            key: 'reason',
            label: 'Причина',
            type: 'textarea',
            placeholder: 'Наприклад: дубль картки працівника'
        }
    ], {
        type: 'danger',
        okText: 'Видалити назавжди',
        cancelText: 'Скасувати',
        closeOnBackdrop: false
    });
    if (!result) return;
    if (String(result.confirmation || '').trim() !== 'ТАК') {
        showNotification('Видалення скасовано: потрібно ввести рівно ТАК', 'warning');
        return;
    }

    const response = await hrFetch(`/staff/${staffId}`, {
        method: 'DELETE',
        body: {
            confirmation: 'ТАК',
            reason: result.reason || 'duplicate_cleanup'
        }
    });
    if (!response?.success) {
        const blockers = response?.data?.blockers ? `: ${formatStaffDeleteItems(response.data.blockers)}` : '';
        showNotification((response?.error || 'Не вдалося видалити працівника') + blockers, 'error');
        return;
    }
    showNotification(`Працівника ${staff.name} видалено`, 'success');
    await loadTeam();
}

window.deleteStaffProfile = deleteStaffProfile;

function focusStaffDocumentsPanel() {
    const panel = document.getElementById('editStaffDocumentsPanel');
    if (!panel) return;
    window.setTimeout(() => {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        panel.classList.add('is-attention');
        document.getElementById('editDocumentFile')?.focus?.({ preventScroll: true });
        window.setTimeout(() => panel.classList.remove('is-attention'), 1800);
    }, 100);
}

async function openStaffDocuments(staffId) {
    if (!canManage) {
        showNotification('Скани документів доступні тільки HR/керівникам', 'error');
        return;
    }
    await openStaffEdit(Number(staffId), { focus: 'documents' });
}

window.openStaffDocuments = openStaffDocuments;

async function openStaffMoveMenu(staffId, button) {
    if (!canManage) {
        showNotification('Переміщення доступне тільки HR/керівникам', 'error');
        return;
    }
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!staff) return;
    await ensureProfessionsLoaded({ silent: true });
    const currentBucket = bucketForStaff(staff);
    const preferredRole = preferredWorkerRoleForStaff(staff);
    const targetOptions = staffMoveTargetOptions(currentBucket);
    if (!targetOptions.length) {
        showNotification('Для вашої ролі немає доступних HR-розділів для переміщення', 'error');
        return;
    }
    const result = await formModal(`Перемістити: ${staff.name}`, [
        {
            key: 'targetBucket',
            label: 'Куди перемістити',
            type: 'select',
            defaultValue: targetOptions[0]?.value || '',
            options: targetOptions
        },
        {
            key: 'targetRole',
            label: 'Основна професія після повернення зі стажерів',
            type: 'select',
            defaultValue: preferredRole,
            options: professionSelectOptionsForStaffMove(staff),
            hint: 'Використовується тільки для переходу зі “Стажери” в “Робітники”.'
        },
        {
            key: 'reason',
            label: 'Причина для чорного списку',
            type: 'textarea',
            defaultValue: staff.blacklist_reason || '',
            placeholder: 'Обовʼязково тільки для чорного списку'
        }
    ], {
        icon: '↔',
        type: 'info',
        okText: 'Перемістити',
        className: 'hr-staff-move-modal'
    });
    if (!result) return;
    const targetBucket = String(result.targetBucket || currentBucket);
    if (targetBucket === currentBucket) {
        showNotification('Співробітник уже в цьому розділі', 'info');
        return;
    }
    if (targetBucket === 'blacklist' && !String(result.reason || staff.blacklist_reason || '').trim()) {
        showNotification('Для чорного списку потрібно вказати причину', 'error');
        return;
    }
    const body = buildStaffMovePayload(staff, targetBucket, result.targetRole, result.reason);
    const reactivating = currentBucket === 'dismissed' && targetBucket !== 'dismissed';
    if (button) button.disabled = true;
    let data;
    try {
        data = await hrFetch(`/staff/${staff.id}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        if (data?.success && reactivating) {
            const activated = await setStaffProfileActive(staff.id, true);
            if (!activated) return;
        }
    } finally {
        if (button) button.disabled = false;
    }
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося перемістити співробітника', 'error');
        return;
    }
    activePeopleBucket = normalizeVisiblePeopleBucket(targetBucket);
    showNotification(`Переміщено в "${HR_TEAM_MOVE_TARGETS.find(item => item.id === targetBucket)?.label || targetBucket}"`, 'success');
    await loadTeam();
}

window.openStaffMoveMenu = openStaffMoveMenu;

async function moveStaffToBucket(staffId, targetBucket, options = {}) {
    if (!canManage) {
        showNotification('Переміщення доступне тільки HR/керівникам', 'error');
        return false;
    }
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!staff) return false;
    const normalizedTarget = normalizeVisiblePeopleBucket(targetBucket);
    const currentBucket = bucketForStaff(staff);
    if (normalizedTarget === currentBucket) return false;
    if (normalizedTarget === 'dismissed') {
        showNotification('Для звільнення відкрийте профіль і завершіть співпрацю через offboarding.', 'warning');
        return false;
    }
    let reason = options.reason || '';
    if (normalizedTarget === 'blacklist' && !String(reason || staff.blacklist_reason || '').trim()) {
        const result = await formModal('Причина чорного списку', [
            { key: 'reason', label: 'Причина', type: 'textarea', required: true }
        ], { icon: '!', type: 'warning', okText: 'Перемістити' });
        if (!result?.reason?.trim()) return false;
        reason = result.reason.trim();
    }
    const body = buildStaffMovePayload(staff, normalizedTarget, options.targetRole || preferredWorkerRoleForStaff(staff), reason);
    const data = await hrFetch(`/staff/${staff.id}`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося перемістити співробітника', 'error');
        return false;
    }
    if (currentBucket === 'dismissed') {
        const activated = await setStaffProfileActive(staff.id, true);
        if (!activated) return false;
    }
    activePeopleBucket = normalizedTarget;
    showNotification(`Переміщено в "${HR_TEAM_MOVE_TARGETS.find(item => item.id === normalizedTarget)?.label || normalizedTarget}"`, 'success');
    await loadTeam();
    return true;
}

function initTeamDragAndDrop() {
    const grid = document.getElementById('teamGrid');
    if (!grid || !canManage) return;
    grid.querySelectorAll('.hr-team-card[draggable="true"]').forEach(card => {
        card.addEventListener('dragstart', event => {
            draggedTeamStaffId = card.dataset.staffId || null;
            card.classList.add('is-dragging');
            event.dataTransfer?.setData('text/plain', draggedTeamStaffId || '');
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => {
            draggedTeamStaffId = null;
            card.classList.remove('is-dragging');
            grid.querySelectorAll('.hr-people-bucket').forEach(bucket => bucket.classList.remove('is-drop-target'));
        });
    });
    grid.querySelectorAll('.hr-people-bucket').forEach(bucket => {
        bucket.addEventListener('dragover', event => {
            if (!draggedTeamStaffId) return;
            event.preventDefault();
            bucket.classList.add('is-drop-target');
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        bucket.addEventListener('dragleave', event => {
            if (bucket.contains(event.relatedTarget)) return;
            bucket.classList.remove('is-drop-target');
        });
        bucket.addEventListener('drop', async event => {
            event.preventDefault();
            bucket.classList.remove('is-drop-target');
            const staffId = draggedTeamStaffId || event.dataTransfer?.getData('text/plain');
            draggedTeamStaffId = null;
            if (!staffId) return;
            await moveStaffToBucket(staffId, bucket.dataset.peopleBucket);
        });
    });
}

function closeStaffTrainingReadinessModal() {
    document.getElementById('staffTrainingReadinessOverlay')?.remove();
}

function renderStaffTrainingProfessionDetails(staffId, entry = {}) {
    const checklist = Array.isArray(entry.checklist) ? entry.checklist : [];
    const courses = Array.isArray(entry.courses) ? entry.courses : [];
    const checklistHtml = checklist.length
        ? checklist.map(item => {
            const done = !!item.completed_at;
            return `<button type="button" class="hr-training-check-item ${done ? 'is-done' : ''}"
                    onclick="toggleStaffProfessionChecklist(${Number(staffId)}, '${escapeJsString(entry.key)}', '${escapeJsString(item.key)}', '${escapeJsString(item.title)}', ${done ? 'false' : 'true'}, this)">
                <span class="hr-training-check-box">${done ? '✓' : ''}</span>
                <span>${escapeHtml(item.title)}</span>
            </button>`;
        }).join('')
        : '<div class="hr-training-empty">Для цієї професії ще немає чек-пунктів.</div>';
    const courseHtml = courses.length
        ? courses.map(course => {
            const total = Number(course.total_lectures || 0);
            const completed = Number(course.completed_lectures || 0);
            const percent = total ? Math.round((completed / total) * 100) : 0;
            return `<div class="hr-training-course-row">
                <div>
                    <b>${escapeHtml(course.title || 'Курс')}</b>
                    <span>${completed}/${total} лекцій</span>
                </div>
                <div class="hr-team-training-meter"><i style="width:${percent}%"></i></div>
            </div>`;
        }).join('')
        : '<div class="hr-training-empty">Для цієї професії ще немає курсу.</div>';
    return `<section class="hr-training-profession-card">
        <div class="hr-training-profession-head">
            <div>
                <h4>${escapeHtml(entry.title || professionTitle(entry.key) || entry.key)}</h4>
                <span>${Number(entry.completed || 0)}/${Number(entry.total || 0)} · ${Number(entry.percent || 0)}%</span>
            </div>
            <div class="hr-team-training-meter"><i style="width:${Number(entry.percent || 0)}%"></i></div>
        </div>
        <div class="hr-training-subtitle">Чек-лист HR</div>
        <div class="hr-training-check-list">${checklistHtml}</div>
        <div class="hr-training-subtitle">Навчальні курси</div>
        <div class="hr-training-course-list">${courseHtml}</div>
    </section>`;
}

function openStaffTrainingReadiness(staffId) {
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!staff) return;
    const readiness = staffTrainingReadiness(staff);
    closeStaffTrainingReadinessModal();
    const overlay = document.createElement('div');
    overlay.id = 'staffTrainingReadinessOverlay';
    overlay.className = 'candidate-detail-overlay';
    overlay.innerHTML = `
        <div class="candidate-detail-modal hr-training-readiness-modal" role="dialog" aria-modal="true" aria-labelledby="staffTrainingReadinessTitle">
            <div class="candidate-detail-head">
                <div>
                    <div class="candidate-detail-kicker">Навчання і чек-листи</div>
                    <h3 id="staffTrainingReadinessTitle">${escapeHtml(staff.name || 'Співробітник')}</h3>
                    <p>${readiness.total ? `${readiness.completed}/${readiness.total} пунктів · ${readiness.percent}% готовності` : 'Для професій ще немає чек-листів'}</p>
                </div>
                <button type="button" class="candidate-detail-close" onclick="closeStaffTrainingReadinessModal()" aria-label="Закрити">×</button>
            </div>
            <div class="hr-training-readiness-summary">
                <div class="hr-team-training-meter"><i style="width:${readiness.total ? readiness.percent : 0}%"></i></div>
            </div>
            <div class="hr-training-profession-list">
                ${readiness.professions.length
                    ? readiness.professions.map(entry => renderStaffTrainingProfessionDetails(staff.id, entry)).join('')
                    : '<div class="hr-training-empty">У співробітника немає активних професій для навчання.</div>'}
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeStaffTrainingReadinessModal();
    });
}

async function toggleStaffProfessionChecklist(staffId, professionKey, checklistKey, title, completed, button) {
    if (button) button.disabled = true;
    const data = await hrFetch(`/staff/${staffId}/profession-checklist`, {
        method: 'PUT',
        body: JSON.stringify({
            profession_key: professionKey,
            checklist_key: checklistKey,
            title,
            completed
        })
    });
    if (!data?.success) {
        if (button) button.disabled = false;
        showNotification(data?.error || 'Не вдалося оновити чек-лист', 'error');
        return;
    }
    showNotification(completed ? 'Чек-пункт закрито' : 'Чек-пункт відкрито', 'success');
    await loadTeam();
    openStaffTrainingReadiness(staffId);
}

window.openStaffTrainingReadiness = openStaffTrainingReadiness;
window.closeStaffTrainingReadinessModal = closeStaffTrainingReadinessModal;
window.toggleStaffProfessionChecklist = toggleStaffProfessionChecklist;

// ==========================================
// TAB 3B: ACCOUNT CENTER
// ==========================================

function isSystemAccount(u) {
    const username = String(u.username || '').toLowerCase();
    const name = String(u.name || '').toLowerCase();
    return username.startsWith('openclaw')
        || username.startsWith('open_claw')
        || username.startsWith('open-claw')
        || name.startsWith('openclaw')
        || name.startsWith('open claw');
}

function formatAccountLastSeen(value) {
    if (!value) return 'активність невідома';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'активність невідома';
    return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function normalizeAccountArray(value) {
    return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function formatAccountAccess(u) {
    const roles = [u.role, ...normalizeAccountArray(u.extra_roles || u.extraRoles)]
        .filter(Boolean)
        .map(role => ROLE_LABELS[role] || role);
    const pages = normalizeAccountArray(u.page_allowlist || u.pageAllowlist);
    const allow = normalizeAccountArray(u.action_allowlist || u.actionAllowlist);
    const deny = normalizeAccountArray(u.action_denylist || u.actionDenylist);
    const businesses = formatAccountBusinessBadges(u);
    return `${roles.join(' + ') || 'user'}${businesses ? ' · бізнеси: ' + businesses : ''}${pages.length ? ' · pages: ' + pages.join(', ') : ''}${allow.length ? ' · allow: ' + allow.join(', ') : ''}${deny.length ? ' · deny: ' + deny.join(', ') : ''}`;
}

function getAccountCenterFilterState() {
    return {
        query: String(document.getElementById('accountCenterSearch')?.value || '').trim(),
        activeOnly: document.getElementById('accountCenterActiveOnly')?.checked !== false,
        showSystem: document.getElementById('accountCenterShowSystem')?.checked === true
    };
}

function hasAccountCenterFilters(filters = getAccountCenterFilterState()) {
    return !!filters.query || filters.activeOnly === false || filters.showSystem === true;
}

function setAccountCenterFilters({ query = '', activeOnly = true, showSystem = false } = {}, { render = false } = {}) {
    const search = document.getElementById('accountCenterSearch');
    const activeOnlyInput = document.getElementById('accountCenterActiveOnly');
    const showSystemInput = document.getElementById('accountCenterShowSystem');
    if (search) search.value = query;
    if (activeOnlyInput) activeOnlyInput.checked = activeOnly !== false;
    if (showSystemInput) showSystemInput.checked = showSystem === true;
    if (render) renderAccountCenter();
}

function resetAccountCenterFilters(options = {}) {
    setAccountCenterFilters({ query: '', activeOnly: true, showSystem: false }, { render: options.render !== false });
}

window.resetAccountCenterFilters = resetAccountCenterFilters;

function accountMatchesSearch(user, query) {
    if (!query) return true;
    const haystack = [
        user.username,
        user.name,
        user.role,
        ...(normalizeAccountArray(user.extra_roles || user.extraRoles)),
        ...(normalizeAccountArray(user.action_allowlist || user.actionAllowlist)),
        ...(normalizeAccountArray(user.action_denylist || user.actionDenylist)),
        ...(normalizeAccountArray(user.business_contexts || user.businessContexts)),
        formatAccountBusinessBadges(user),
        user.profile_name,
        user.staff_name,
        user.staff_department,
        user.staff_position
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase());
}

async function loadAccountCenter(options = {}) {
    const root = document.getElementById('accountCenterList');
    if (root) root.innerHTML = '<div class="hr-account-empty">Завантаження акаунтів...</div>';
    await Promise.all([loadAccountRoleDefinitions(), loadAccountConflicts()]);
    const data = await crmApiFetch('/api/users');
    if (!Array.isArray(data)) {
        if (root) root.innerHTML = `<div class="hr-account-empty">Центр акаунтів недоступний: ${escapeHtml(data?.error || 'немає доступу')}</div>`;
        return;
    }
    accountUsers = data;
    if (options.resetFilters) {
        resetAccountCenterFilters({ render: false });
    }
    applyAccountDeepLinkFilters();
    renderAccountCenter();
    const search = document.getElementById('accountCenterSearch');
    const activeOnly = document.getElementById('accountCenterActiveOnly');
    const showSystem = document.getElementById('accountCenterShowSystem');
    const createBtn = document.getElementById('accountCreateBtn');
    const adminNote = document.getElementById('accountCenterAdminNote');
    const canManageSecurity = canManageAccountSecurity();
    if (createBtn) createBtn.classList.toggle('hidden', !canManageSecurity);
    if (adminNote) adminNote.classList.toggle('hidden', canManageSecurity);
    if (search) search.oninput = renderAccountCenter;
    if (activeOnly) activeOnly.onchange = renderAccountCenter;
    if (showSystem) showSystem.onchange = renderAccountCenter;
}

window.refreshAccountCenter = async function(button) {
    if (button) button.disabled = true;
    try {
        await loadAccountCenter();
    } finally {
        if (button) button.disabled = false;
    }
};

function renderAccountCenter() {
    const root = document.getElementById('accountCenterList');
    if (!root) return;
    renderAccountConflictSummary();
    const canManageSecurity = canManageAccountSecurity();
    const canManageProfile = canManageAccountProfile();
    const canManageAccess = canManageAccountAccess();
    const filters = getAccountCenterFilterState();
    const query = filters.query.toLowerCase();
    const activeOnly = filters.activeOnly;
    const showSystem = filters.showSystem;
    let rows = accountUsers;
    if (!showSystem) rows = rows.filter(u => !isSystemAccount(u));
    if (activeOnly) rows = rows.filter(u => u.is_active !== false);
    if (query) {
        rows = rows.filter(u => accountMatchesSearch(u, query));
    }
    const activeHumanCount = accountUsers.filter(u => u.is_active !== false && !isSystemAccount(u)).length;
    const filterNotice = document.getElementById('accountCenterFilterNotice');
    const resetBtn = document.getElementById('accountCenterResetFiltersBtn');
    const hasFilters = hasAccountCenterFilters(filters);
    const stats = document.getElementById('accountCenterStats');
    if (stats) {
        stats.textContent = `${rows.length} показано · ${activeHumanCount} активних · ${accountUsers.length} всього`;
    }
    if (resetBtn) resetBtn.classList.toggle('hidden', !hasFilters);
    if (filterNotice) {
        filterNotice.classList.toggle('hidden', !hasFilters);
        if (hasFilters) {
            const parts = [];
            if (filters.query) parts.push(`пошук “${escapeHtml(filters.query)}”`);
            if (filters.activeOnly === false) parts.push('показ вимкнених');
            if (filters.showSystem) parts.push('system-акаунти');
            filterNotice.innerHTML = `
                <strong>Увімкнено фільтр:</strong>
                <span>${parts.join(' · ') || 'нестандартний режим перегляду'}</span>
                <button type="button" class="hr-account-inline-action" onclick="resetAccountCenterFilters()">Показати всі активні</button>
            `;
        }
    }
    if (!rows.length) {
        root.innerHTML = `<div class="hr-account-empty">
            <strong>${hasFilters ? 'Акаунтів за цим фільтром немає.' : 'Активних акаунтів немає.'}</strong>
            <span>${hasFilters ? 'Список не порожній: зараз його обмежують пошук або чекбокси.' : 'Увімкніть показ вимкнених або створіть новий акаунт.'}</span>
            ${hasFilters ? '<button type="button" class="hr-account-empty-action" onclick="resetAccountCenterFilters()">Скинути фільтри</button>' : ''}
        </div>`;
        return;
    }
    root.innerHTML = rows.map(u => {
        const active = u.is_active !== false;
        const staff = u.staff_name ? `${escapeHtml(u.staff_name)}${u.staff_department ? ' · ' + escapeHtml(u.staff_department) : ''}` : 'не привʼязано до staff';
        const role = formatAccountAccess(u);
        const recentlyUpdated = Number(accountCenterLastUpdatedId) === Number(u.id);
        const canMutateTarget = currentAccountCanMutateTarget(u);
        const canToggleTarget = currentAccountCanToggleTarget(u);
        const targetProtected = canManageSecurity && !canMutateTarget;
        return `<article class="hr-account-row ${active ? '' : 'is-disabled'} ${recentlyUpdated ? 'is-recently-updated' : ''}">
            <div class="hr-account-avatar">${escapeHtml((u.name || u.username || '?').slice(0, 1).toUpperCase())}</div>
            <div class="hr-account-main">
                <div class="hr-account-title">
                    <strong>${escapeHtml(u.name || u.username || 'Без імені')}</strong>
                    <span>${escapeHtml(u.username || '')}</span>
                </div>
                <div class="hr-account-meta">${escapeHtml(role)} · ${staff} · ${formatAccountLastSeen(u.last_seen_at)}</div>
            </div>
            <div class="hr-account-actions">
                <span class="hr-account-state ${active ? 'ok' : 'off'}">${active ? 'активний' : 'вимкнений'}</span>
                ${u.staff_id ? `<a class="hr-account-link" href="/hr?employee=${encodeURIComponent(u.staff_id)}">HR профіль</a>` : ''}
                ${canManageProfile && canMutateTarget ? `<button type="button" class="hr-account-toggle" onclick="openAccountProfileModal(${Number(u.id)}, this)">Профіль</button>` : ''}
                ${canManageSecurity && canMutateTarget ? `<button type="button" class="hr-account-toggle" onclick="openAccountPasswordModal(${Number(u.id)}, this)">Пароль</button>` : ''}
                ${canManageAccess && canMutateTarget ? `<button type="button" class="hr-account-toggle" onclick="openAccountAccessEditor(${Number(u.id)}, this)">Доступ</button>` : ''}
                ${canToggleTarget ? `<button type="button" class="hr-account-toggle" onclick="toggleAccountActive(${Number(u.id)}, ${active ? 'false' : 'true'}, this)">${active ? 'Вимкнути' : 'Активувати'}</button>` : ''}
                ${targetProtected ? '<span class="hr-account-state off" title="Цей рівень акаунта змінює тільки creator">захищено</span>' : ''}
            </div>
        </article>`;
    }).join('');
}

window.openAccountCreateModal = async function(button, context = {}) {
    if (!canManageAccountSecurity()) {
        showNotification('Створення акаунтів доступне тільки creator/director', 'error');
        return;
    }
    await loadAccountRoleDefinitions();
    await loadAccountStaffOptions();
    const contextStaff = context.staff || (context.staffId ? teamStaff.find(staff => Number(staff.id) === Number(context.staffId)) : null);
    const defaultStaffId = contextStaff?.id ? String(contextStaff.id) : '';
    const defaultName = contextStaff?.name || '';
    const defaultUsername = context.username || (contextStaff ? suggestAccountUsernameFromStaff(contextStaff) : '');
    const defaultRole = staffRoleToAccountRole(context.role || contextStaff?.role_type || 'animator');
    const defaultBusinessContexts = normalizeAccountBusinessSelection(context.businessContexts || ['event_genix']);
    const defaultBusinessContext = getAccountDefaultBusinessValue(context, defaultBusinessContexts);
    const canEditBusiness = canEditAccountBusinessContexts();
    const businessFieldsVisible = values => accountRoleCanSwitchBusinessContext(values.role || defaultRole);
    const createFields = [
        { key: 'name', label: 'Імʼя в CRM', required: true, defaultValue: defaultName, placeholder: 'Женя Аніматор' },
        { key: 'username', label: 'Логін', required: true, defaultValue: defaultUsername, placeholder: 'zhenya.animator' },
        { key: 'password', label: 'Пароль вручну або порожньо для one-time', type: 'password', placeholder: 'Порожньо = CRM згенерує одноразовий пароль' },
        { key: 'confirmPassword', label: 'Повторити пароль, якщо вводите вручну', type: 'password' },
        { key: 'rolePreset', label: 'Швидка пачка доступу', type: 'presetButtons', presets: getAccountRolePresetButtons(defaultRole), hint: 'Пачка виставляє основну роль і додаткові ролі. Creator не видається швидкою пачкою.' },
        { key: 'role', label: 'Основна роль', type: 'select', defaultValue: defaultRole, options: getAccountRoleOptions(defaultRole) },
        { key: 'staffId', label: 'HR staff-профіль', type: 'select', defaultValue: defaultStaffId, options: getAccountStaffSelectOptions() },
        { key: 'extraRoles', label: 'Додаткові ролі', type: 'checkboxGroup', defaultValue: [], dependsOn: 'role', options: getAccountExtraRoleOptions(defaultRole, []), optionsFor: (role, values) => getAccountExtraRoleOptions(role, values.extraRoles || []), hint: 'Це реальні extraRoles акаунта: їх можна активувати як робочу роль у профілі. Основну роль сюди не дублюйте.' },
        { key: 'roleAccessPack', type: 'dynamicNote', render: values => renderAccountRolePackFromForm(values, { role: defaultRole }) },
        { key: 'pageAllowlist', label: 'Дозволити окремі сторінки', type: 'checkboxGroup', defaultValue: [], options: getAccountPageOptions([]), hint: 'Це ручні винятки понад рольову пачку. Сторінки, які вже дає роль, застосуються автоматично після нового входу.' },
        { key: 'actionAllowlist', label: 'Дозволити окремі дії', type: 'checkboxGroup', defaultValue: [], options: getAccountActionOptions([], { includeNonDelegable: false }), hint: 'Allow додає тільки делеговані дії. Керування акаунтами та налаштуваннями видається роллю.' },
        { key: 'actionDenylist', label: 'Заборонити окремі дії', type: 'checkboxGroup', defaultValue: [], options: getAccountActionOptions([]), hint: 'Deny має пріоритет над роллю і allow.' }
    ];
    if (canEditBusiness) {
        createFields.splice(6, 0,
            { key: 'businessContexts', label: 'Доступні бізнеси', type: 'checkboxGroup', required: true, defaultValue: defaultBusinessContexts, options: getAccountBusinessOptions(defaultBusinessContexts), visibleWhen: businessFieldsVisible, hint: 'Акаунт бачитиме дані й перемикач тільки для вибраних бізнесів.' },
            { key: 'defaultBusinessContext', label: 'Бізнес за замовченням', type: 'select', defaultValue: defaultBusinessContext, dependsOn: 'businessContexts', options: getAccountBusinessSelectOptions(defaultBusinessContexts, defaultBusinessContext), optionsFor: (_, values) => getAccountBusinessSelectOptions(values.businessContexts || defaultBusinessContexts, values.defaultBusinessContext || defaultBusinessContext), visibleWhen: businessFieldsVisible, hint: 'Цей бізнес відкриватиметься першим у глобальному перемикачі.' }
        );
    }
    const result = await formModal('Створити CRM акаунт', createFields, {
        icon: '👤',
        type: 'info',
        okText: 'Створити',
        className: 'account-create-modal'
    });
    if (!result) return;
    const password = String(result.password || '');
    const issueOneTime = !password;
    if (password && password.length < 6) {
        showNotification('Пароль має бути не менше 6 символів', 'error');
        return;
    }
    if (password && password !== String(result.confirmPassword || '')) {
        showNotification('Паролі не збігаються', 'error');
        return;
    }
    if (button) button.disabled = true;
    const selectedBusinessContexts = canEditBusiness ? normalizeAccountBusinessSelection(result.businessContexts) : ['event_genix'];
    const selectedDefaultBusinessContext = canEditBusiness
        ? getAccountDefaultBusinessValue({ defaultBusinessContext: result.defaultBusinessContext }, selectedBusinessContexts)
        : 'event_genix';
    const response = await crmApiFetch('/api/users', {
        method: 'POST',
        body: {
            username: String(result.username || '').trim(),
            password: issueOneTime ? undefined : password,
            issueOneTime,
            name: String(result.name || '').trim(),
            role: result.role || 'animator',
            staffId: result.staffId || null,
            businessContexts: selectedBusinessContexts,
            defaultBusinessContext: selectedDefaultBusinessContext,
            extraRoles: normalizeAccountListInput(result.extraRoles),
            pageAllowlist: normalizeAccountListInput(result.pageAllowlist),
            actionAllowlist: Array.isArray(result.actionAllowlist) ? result.actionAllowlist : normalizeAccountListInput(result.actionAllowlist),
            actionDenylist: Array.isArray(result.actionDenylist) ? result.actionDenylist : normalizeAccountListInput(result.actionDenylist)
        }
    });
    if (button) button.disabled = false;
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося створити акаунт', 'error');
        return;
    }
    if (response.credential) {
        showOneTimeCredentialModal(response.credential, `Акаунт ${response.user?.username || result.username} створено`, response);
    } else {
        showNotification(`Акаунт ${response.user?.username || result.username} створено. Передайте пароль користувачу напряму.`, 'success');
    }
    accountCenterLastUpdatedId = response.user?.id || null;
    await loadAccountStaffOptions(true);
    await loadTeam();
    await loadAccountCenter({ resetFilters: true });
};

window.openAccountCreateForStaff = async function(staffId, button) {
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!staff) {
        showNotification('Staff-профіль не знайдено', 'error');
        return;
    }
    await openAccountCreateModal(button, { staff });
};

window.openAccountLinkForStaff = async function(staffId, button) {
    if (!canLinkAccounts()) {
        showNotification('Привʼязка акаунтів доступна тільки creator/director', 'error');
        return;
    }
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!staff) {
        showNotification('Staff-профіль не знайдено', 'error');
        return;
    }
    if (button) button.disabled = true;
    await loadAccountCenter();
    if (button) button.disabled = false;
    const candidates = accountUsers
        .filter(user => user.is_active !== false)
        .filter(user => !user.staff_id || Number(user.staff_id) === Number(staffId))
        .filter(user => !isSystemAccount(user))
        .map(user => ({
            value: String(user.id),
            label: `${user.name || user.username} · ${user.username} · ${user.role}${user.staff_id ? ' · вже привʼязано сюди' : ''}`
        }));
    if (!candidates.length) {
        showNotification('Немає вільних активних акаунтів для привʼязки', 'warning');
        return;
    }
    const result = await formModal(`Привʼязати акаунт · ${staff.name}`, [
        { key: 'userId', label: 'CRM акаунт', type: 'select', required: true, options: candidates }
    ], {
        icon: '🔗',
        type: 'info',
        okText: 'Привʼязати',
        className: 'account-link-modal'
    });
    if (!result?.userId) return;
    const response = await crmApiFetch(`/api/staff/${encodeURIComponent(staffId)}/link`, {
        method: 'POST',
        body: { userId: Number(result.userId) }
    });
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося привʼязати акаунт', 'error');
        return;
    }
    showNotification('Акаунт привʼязано до staff-профілю', 'success');
    accountCenterLastUpdatedId = Number(result.userId);
    await loadAccountStaffOptions(true);
    await loadTeam();
    await loadAccountCenter({ resetFilters: true });
};

window.openAccountForStaff = async function(staffId, button) {
    if (button) button.disabled = true;
    await activateHrTab('accounts', { updateHash: true });
    if (button) button.disabled = false;
    const target = accountUsers.find(user => Number(user.staff_id) === Number(staffId));
    const staff = teamStaff.find(item => Number(item.id) === Number(staffId));
    if (!target) {
        showNotification('Акаунт для цього staff-профілю не знайдено в центрі акаунтів', 'warning');
        return;
    }
    accountCenterLastUpdatedId = target.id;
    setAccountCenterFilters({
        query: target.username || staff?.name || '',
        activeOnly: false,
        showSystem: false
    }, { render: true });
};

async function openAccountProfileModal(userId, button) {
    if (!canManageAccountProfile()) {
        showNotification('Редагування профілю доступне тільки creator/director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
    if (!currentAccountCanMutateTarget(user)) {
        showNotification('Цей акаунт не можна редагувати з поточного рівня доступу', 'error');
        return;
    }
    await loadAccountStaffOptions();
    const result = await formModal(`Профіль акаунта · ${user.username}`, [
        { key: 'name', label: 'Імʼя в CRM', required: true, defaultValue: user.name || user.username || '' },
        { key: 'username', label: 'Логін', required: true, defaultValue: user.username || '', placeholder: 'latin.login' },
        { key: 'staffId', label: 'HR staff-профіль', type: 'select', defaultValue: user.staff_id ? String(user.staff_id) : '', options: getAccountStaffSelectOptions(user.id) }
    ], {
        icon: '👥',
        type: 'info',
        okText: 'Зберегти профіль',
        className: 'account-profile-modal'
    });
    if (!result) return;
    const username = String(result.username || '').trim();
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
        showNotification('Логін: 3-50 символів, латиниця/цифри/крапка/дефіс/підкреслення', 'error');
        return;
    }
    if (button) button.disabled = true;
    const response = await crmApiFetch(`/api/users/${encodeURIComponent(userId)}/profile`, {
        method: 'PATCH',
        body: {
            name: String(result.name || '').trim(),
            username,
            staffId: result.staffId || null
        }
    });
    if (button) button.disabled = false;
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося оновити профіль акаунта', 'error');
        return;
    }
    showNotification('Профіль акаунта оновлено', 'success');
    accountCenterLastUpdatedId = userId;
    await loadAccountStaffOptions(true);
    await loadAccountCenter({ resetFilters: true });
}

async function openAccountPasswordModal(userId, button) {
    if (!canManageAccountSecurity()) {
        showNotification('Зміна пароля доступна тільки creator/director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
    if (!currentAccountCanMutateTarget(user)) {
        showNotification('Пароль цього акаунта не можна змінити з поточного рівня доступу', 'error');
        return;
    }
    const fields = [
        { key: 'mode', label: 'Режим', type: 'select', defaultValue: 'issue', options: [
            { value: 'issue', label: 'Згенерувати одноразовий пароль' },
            { value: 'manual', label: 'Ввести новий пароль вручну' }
        ] },
        { key: 'newPassword', label: 'Новий пароль вручну', type: 'password', placeholder: 'Заповніть тільки для ручного режиму' },
        { key: 'confirmPassword', label: 'Повторити пароль вручну', type: 'password' }
    ];
    if (user.is_active === false) {
        fields.push({
            key: 'activateOnReset',
            label: 'Статус акаунта після зміни',
            type: 'select',
            defaultValue: 'activate',
            options: [
                { value: 'activate', label: 'Активувати акаунт і дозволити вхід' },
                { value: 'keep', label: 'Лишити вимкненим' }
            ]
        });
    }
    const result = await formModal(`Пароль · ${user.username}`, fields, {
        icon: '🔐',
        type: 'warning',
        okText: 'Оновити доступ',
        className: 'account-password-modal'
    });
    if (!result) return;
    const issueOneTime = result.mode !== 'manual';
    const password = String(result.newPassword || '');
    if (!issueOneTime && password.length < 6) {
        showNotification('Пароль має бути не менше 6 символів', 'error');
        return;
    }
    if (!issueOneTime && password !== String(result.confirmPassword || '')) {
        showNotification('Паролі не збігаються', 'error');
        return;
    }
    const activateOnReset = user.is_active === false && result.activateOnReset !== 'keep';
    if (button) button.disabled = true;
    const response = await crmApiFetch(`/api/users/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST',
        body: issueOneTime ? { issueOneTime: true, activateOnReset } : { newPassword: password, activateOnReset }
    });
    if (button) button.disabled = false;
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося змінити пароль', 'error');
        return;
    }
    if (response.credential) {
        showOneTimeCredentialModal(response.credential, `Пароль для ${response.username || user.username} перевипущено`, response);
    } else {
        showManualPasswordResetResult(response, user);
    }
    accountCenterLastUpdatedId = userId;
    await loadAccountCenter({ resetFilters: true });
}

async function openAccountAccessEditor(userId, button) {
    if (!canManageAccountAccess()) {
        showNotification('Зміна доступу доступна тільки creator/director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
    if (!currentAccountCanMutateTarget(user)) {
        showNotification('Доступ цього акаунта не можна змінити з поточного рівня доступу', 'error');
        return;
    }
    const currentPages = normalizeAccountArray(user.page_allowlist || user.pageAllowlist);
    const currentActionAllowlist = normalizeAccountArray(user.action_allowlist || user.actionAllowlist);
    const currentActionDenylist = normalizeAccountArray(user.action_denylist || user.actionDenylist);
    await loadAccountRoleDefinitions();
    const currentBusinessContexts = normalizeAccountBusinessSelection(user.business_contexts || user.businessContexts);
    const currentDefaultBusinessContext = getAccountDefaultBusinessValue(user, currentBusinessContexts);
    const canEditBusiness = canEditAccountBusinessContexts();
    const businessFieldsVisible = values => accountRoleCanSwitchBusinessContext(values.role || user.role);
    const accessFields = [
        { key: 'accessPolicyNote', type: 'note', text: AppState.currentUser?.role === 'director' ? 'Директор може редагувати ролі, сторінки й дії для акаунтів нижче директорського рівня. Creator/director акаунти змінює тільки creator.' : 'Creator має повний контроль доступів і не може випадково забрати власне керування акаунтами.' },
        { key: 'rolePreset', label: 'Швидка пачка доступу', type: 'presetButtons', presets: getAccountRolePresetButtons(user.role || 'animator'), hint: 'Пачка виставляє основну роль і додаткові ролі. Creator не видається швидкою пачкою.' },
        { key: 'role', label: 'Основна роль', type: 'select', defaultValue: user.role || 'animator', options: getAccountRoleOptions(user.role || 'animator') },
        { key: 'extraRoles', label: 'Додаткові ролі', type: 'checkboxGroup', defaultValue: normalizeAccountArray(user.extra_roles || user.extraRoles), dependsOn: 'role', options: getAccountExtraRoleOptions(user.role || 'animator', user.extra_roles || user.extraRoles), optionsFor: (role, values) => getAccountExtraRoleOptions(role, values.extraRoles || []), hint: 'Це реальні extraRoles акаунта: після збереження користувач побачить їх у профілі й зможе перемикати робочу роль.' },
        { key: 'roleAccessPack', type: 'dynamicNote', render: values => renderAccountRolePackFromForm(values, { role: user.role || 'animator', extraRoles: user.extra_roles || user.extraRoles, pageAllowlist: normalizeAccountListInput(currentPages), actionAllowlist: currentActionAllowlist, actionDenylist: currentActionDenylist }) },
        { key: 'pageAllowlist', label: 'Дозволити окремі сторінки', type: 'checkboxGroup', defaultValue: currentPages, options: getAccountPageOptions(currentPages), hint: 'Це ручні винятки понад рольову пачку. Сторінки, які вже дає роль, застосуються автоматично після нового входу.' },
        { key: 'actionAllowlist', label: 'Дозволити окремі дії', type: 'checkboxGroup', defaultValue: currentActionAllowlist, options: getAccountActionOptions(currentActionAllowlist, { includeNonDelegable: false }), hint: 'Allow додає тільки делеговані дії. Керування акаунтами та налаштуваннями видається роллю.' },
        { key: 'actionDenylist', label: 'Заборонити окремі дії', type: 'checkboxGroup', defaultValue: currentActionDenylist, options: getAccountActionOptions(currentActionDenylist), hint: 'Deny має пріоритет над роллю і allow.' }
    ];
    if (canEditBusiness) {
        accessFields.splice(1, 0,
            { key: 'businessContexts', label: 'Доступні бізнеси', type: 'checkboxGroup', required: true, defaultValue: currentBusinessContexts, options: getAccountBusinessOptions(currentBusinessContexts), visibleWhen: businessFieldsVisible, hint: 'Це визначає, які бізнес-контексти користувач може перемикати і які дані бачить у scoped-модулях.' },
            { key: 'defaultBusinessContext', label: 'Бізнес за замовченням', type: 'select', defaultValue: currentDefaultBusinessContext, dependsOn: 'businessContexts', options: getAccountBusinessSelectOptions(currentBusinessContexts, currentDefaultBusinessContext), optionsFor: (_, values) => getAccountBusinessSelectOptions(values.businessContexts || currentBusinessContexts, values.defaultBusinessContext || currentDefaultBusinessContext), visibleWhen: businessFieldsVisible, hint: 'Цей бізнес стане першим після нового входу або чистого браузера.' }
        );
    }
    const formResult = await formModal(`Доступ акаунта · ${user.username}`, accessFields, {
        icon: '🛂',
        type: 'info',
        okText: 'Оновити доступ',
        className: 'account-access-modal'
    });
    if (!formResult) return;
    const extraRoles = normalizeAccountListInput(formResult.extraRoles);
    const pageAllowlist = normalizeAccountListInput(formResult.pageAllowlist);
    const actionAllowlist = Array.isArray(formResult.actionAllowlist) ? formResult.actionAllowlist : normalizeAccountListInput(formResult.actionAllowlist);
    const actionDenylist = Array.isArray(formResult.actionDenylist) ? formResult.actionDenylist : normalizeAccountListInput(formResult.actionDenylist);
    const selectedBusinessContexts = canEditBusiness ? normalizeAccountBusinessSelection(formResult.businessContexts) : ['event_genix'];
    const selectedDefaultBusinessContext = canEditBusiness
        ? getAccountDefaultBusinessValue({ defaultBusinessContext: formResult.defaultBusinessContext }, selectedBusinessContexts)
        : 'event_genix';
    if (button) button.disabled = true;
    const response = await crmApiFetch(`/api/users/${encodeURIComponent(userId)}/access`, {
        method: 'PATCH',
        body: {
            role: formResult.role || user.role,
            businessContexts: selectedBusinessContexts,
            defaultBusinessContext: selectedDefaultBusinessContext,
            extraRoles,
            pageAllowlist,
            actionAllowlist,
            actionDenylist
        }
    });
    if (button) button.disabled = false;
    if (!response?.success) {
        showNotification(response?.error || 'Не вдалося оновити доступ акаунта', 'error');
        return;
    }
    showNotification('Доступ акаунта оновлено. Після нового логіну права перерахуються автоматично.', 'success');
    accountCenterLastUpdatedId = userId;
    await loadAccountCenter({ resetFilters: true });
}

async function toggleAccountActive(userId, isActive, button) {
    if (!Number.isFinite(Number(userId))) return;
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user || !currentAccountCanToggleTarget(user)) {
        showNotification('Цей акаунт не можна активувати або вимкнути з поточного рівня доступу', 'error');
        return;
    }
    const label = isActive ? 'активувати акаунт' : 'вимкнути акаунт';
    let ok = false;
    if (typeof confirmModal === 'function') {
        ok = await confirmModal(`Підтвердити: ${label}?`, { type: isActive ? 'info' : 'warning', okText: isActive ? 'Активувати' : 'Вимкнути' });
    } else if (typeof showNotification === 'function') {
        showNotification('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
    }
    if (!ok) return;
    if (button) button.disabled = true;
    const result = await crmApiFetch(`/api/users/${encodeURIComponent(userId)}/active`, {
        method: 'PATCH',
        body: { isActive }
    });
    if (button) button.disabled = false;
    if (!result?.success) {
        showNotification(result?.error || 'Не вдалося оновити акаунт', 'error');
        return;
    }
    showNotification(isActive ? 'Акаунт активовано' : 'Акаунт вимкнено', 'success');
    await loadAccountCenter();
}

function renderProfessionOptions(options, selectedValues = []) {
    const selected = new Set(normalizeProfessionList(selectedValues));
    return options.map(option => `<option value="${escapeHtml(option.value)}" ${selected.has(normalizeProfessionKey(option.value)) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

function readStaffSecondaryProfessionSelection() {
    const pickerSelection = selectedSecondaryProfessionKeys();
    if (pickerSelection.length || document.getElementById('editSecondaryProfessionPicker')) return pickerSelection;
    return Array.from(document.getElementById('editSecondaryProfessions')?.selectedOptions || [])
        .map(option => option.value);
}

function syncHiddenSecondaryProfessionSelect(options = [], selected = []) {
    const select = document.getElementById('editSecondaryProfessions');
    if (!select) return;
    select.innerHTML = renderProfessionOptions(options, selected);
}

function renderSecondaryProfessionPicker(options = [], selected = [], query = '') {
    const chipsRoot = document.getElementById('editSecondaryProfessionChips');
    const optionsRoot = document.getElementById('editSecondaryProfessionOptions');
    const countRoot = document.getElementById('editSecondaryProfessionCount');
    const selectedSet = new Set(normalizeProfessionList(selected));
    if (countRoot) {
        countRoot.textContent = selectedSet.size
            ? `${selectedSet.size} додатково`
            : 'Додаткові професії не вибрані';
    }
    if (chipsRoot) {
        chipsRoot.innerHTML = selectedSet.size
            ? Array.from(selectedSet).map(key => `
                <button type="button" class="hr-profession-selected-chip" data-secondary-remove="${escapeHtml(key)}">
                    <span>${escapeHtml(professionTitle(key))}</span>
                    <b aria-hidden="true">×</b>
                </button>
            `).join('')
            : '<span class="hr-profession-picker-empty">Додайте професії нижче, якщо співробітник може працювати у кількох ролях.</span>';
    }
    if (optionsRoot) {
        const normalizedQuery = String(query || '').trim().toLowerCase();
        const filtered = options
            .filter(option => !selectedSet.has(normalizeProfessionKey(option.value)))
            .filter(option => {
                if (!normalizedQuery) return true;
                return `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery);
            })
            .slice(0, 18);
        optionsRoot.innerHTML = filtered.length
            ? filtered.map(option => `
                <button type="button" class="hr-profession-option" data-secondary-add="${escapeHtml(option.value)}">
                    <span>${escapeHtml(option.label)}</span>
                </button>
            `).join('')
            : '<div class="hr-profession-picker-empty">Нічого не знайдено або всі професії вже додані.</div>';
    }
}

function setSecondaryProfessionPickerOpen(open) {
    const picker = document.getElementById('editSecondaryProfessionPicker');
    if (picker) picker.classList.toggle('is-open', Boolean(open));
}

function populateSecondaryProfessionSelect(selected = [], primaryRole = '') {
    const primary = normalizeProfessionKey(primaryRole);
    const options = professionOptionsFromCatalog(primary).filter(option => normalizeProfessionKey(option.value) !== primary);
    const normalized = normalizeProfessionList(selected, [primary])
        .filter(key => options.some(option => normalizeProfessionKey(option.value) === key));
    setSelectedSecondaryProfessionKeys(normalized, primary);
    syncHiddenSecondaryProfessionSelect(options, normalized);
    renderSecondaryProfessionPicker(options, normalized, document.getElementById('editSecondaryProfessionSearch')?.value || '');
}

function currentStaffProfessionKeysForEdit(staff = {}) {
    return normalizeProfessionList([
        document.getElementById('editRoleType')?.value || staff.role_type,
        ...readStaffSecondaryProfessionSelection()
    ]);
}

function renderStaffProfessionRatesEditor(staff = {}) {
    const root = document.getElementById('editProfessionRates');
    if (!root) return;
    const primary = normalizeProfessionKey(document.getElementById('editRoleType')?.value || staff.role_type);
    const keys = currentStaffProfessionKeysForEdit(staff).filter(key => key && key !== primary);
    if (!keys.length) {
        root.innerHTML = '<div class="hr-profession-picker-empty">Додаткові професії не вибрані. Для основної професії використовується базова ставка вище.</div>';
        return;
    }
    const rateMap = staffProfessionRateMap(staff);
    const currentInputValues = new Map();
    root.querySelectorAll('[data-profession-rate]').forEach(input => {
        const key = normalizeProfessionKey(input.dataset.professionRate);
        if (key) currentInputValues.set(key, input.value);
    });
    const baseRate = Number(document.getElementById('editHourlyRate')?.value || staff.hourly_rate || 0);
    const unit = currentEditRateUnit(staff);
    const suffix = `₴/${staffRateUnitSuffix(unit)}`;
    root.innerHTML = keys.map(key => {
        const customRate = rateMap.get(key);
        const displayRate = currentInputValues.has(key)
            ? currentInputValues.get(key)
            : (Number.isFinite(customRate) && customRate > 0 ? customRate : '');
        return `<label class="hr-profession-rate-row" data-rate-profession="${escapeHtml(key)}">
            <span><b>${escapeHtml(professionTitle(key))}</b><small>Додаткова професія</small></span>
            <div class="hr-profession-rate-control">
                <input type="number" min="0" step="10" inputmode="decimal" data-profession-rate="${escapeHtml(key)}" value="${displayRate ? escapeHtml(displayRate) : ''}" placeholder="${baseRate > 0 ? escapeHtml(baseRate) : '0'}">
                <small>${escapeHtml(suffix)}</small>
            </div>
        </label>`;
    }).join('');
}

function readStaffProfessionRates() {
    return Array.from(document.querySelectorAll('[data-profession-rate]'))
        .map(input => ({
            profession_key: normalizeProfessionKey(input.dataset.professionRate),
            hourly_rate: Number(input.value || 0)
        }))
        .filter(row => row.profession_key && Number.isFinite(row.hourly_rate) && row.hourly_rate > 0);
}

function populateStaffStructureSelect(staff = {}) {
    const select = document.getElementById('editCompanyStructureNode');
    if (!select) return;
    const current = staff.company_structure_node_id || staff.companyStructureNodeId || '';
    select.innerHTML = renderSelectOptions(companyStructureSelectOptions(current), current);
}

function refreshStaffRateEditorFromCurrentForm() {
    const staffId = Number(document.getElementById('editStaffId')?.value);
    const staff = teamStaff.find(item => Number(item.id) === staffId) || {};
    renderStaffProfessionRatesEditor(staff);
}

function syncStaffRateUnitUi(staff = {}) {
    const unit = currentEditRateUnit(staff);
    const label = document.getElementById('editHourlyRateLabel');
    const hint = document.getElementById('editHourlyRateHint');
    const suffix = staffRateUnitSuffix(unit);
    if (label) label.textContent = `Ставка грн/${suffix}`;
    if (hint) {
        hint.textContent = unit === 'month'
            ? 'Місячна ставка рахується як фікс за зарплатний період. Додаткові професії використовують ту саму одиницю.'
            : unit === 'day'
                ? 'Денна ставка рахується за відпрацьований день. Додаткові професії використовують ту саму одиницю.'
                : 'Погодинна ставка рахується за відпрацьовані години. Додаткові професії використовують ту саму одиницю.';
    }
}

function bindSecondaryProfessionPicker() {
    const search = document.getElementById('editSecondaryProfessionSearch');
    const picker = document.getElementById('editSecondaryProfessionPicker');
    if (search) {
        search.onfocus = () => setSecondaryProfessionPickerOpen(true);
        search.oninput = () => {
            setSecondaryProfessionPickerOpen(true);
            populateSecondaryProfessionSelect(readStaffSecondaryProfessionSelection(), document.getElementById('editRoleType')?.value);
            refreshStaffRateEditorFromCurrentForm();
            refreshStaffRoleAssignmentsFromCurrentForm();
        };
        search.onkeydown = event => {
            if (event.key === 'Escape') {
                setSecondaryProfessionPickerOpen(false);
                search.blur();
            }
        };
    }
    if (picker) {
        picker.onclick = event => {
            const add = event.target.closest('[data-secondary-add]');
            const remove = event.target.closest('[data-secondary-remove]');
            if (!add && !remove) return;
            const current = readStaffSecondaryProfessionSelection();
            const primary = document.getElementById('editRoleType')?.value;
            const next = add
                ? normalizeProfessionList([...current, add.dataset.secondaryAdd], [primary])
                : normalizeProfessionList(current.filter(key => key !== remove.dataset.secondaryRemove), [primary]);
            if (search && add) search.value = '';
            populateSecondaryProfessionSelect(next, primary);
            if (add) {
                setSecondaryProfessionPickerOpen(true);
                search?.focus();
            }
            refreshStaffRateEditorFromCurrentForm();
            refreshStaffRoleAssignmentsFromCurrentForm();
        };
        document.addEventListener('click', event => {
            if (!picker.contains(event.target)) setSecondaryProfessionPickerOpen(false);
        });
    }
}

function populateStaffProfessionControls(staff = {}) {
    const primarySelect = document.getElementById('editRoleType');
    const primary = normalizeProfessionKey(staff.role_type || 'animator') || 'animator';
    if (primarySelect) {
        primarySelect.innerHTML = renderProfessionOptions(professionOptionsFromCatalog(primary), [primary]);
        primarySelect.value = primary;
    }
    const search = document.getElementById('editSecondaryProfessionSearch');
    if (search) search.value = '';
    populateSecondaryProfessionSelect(staffSecondaryProfessions(staff), primary);
    populateStaffStructureSelect(staff);
    renderStaffProfessionRatesEditor(staff);
}

const STAFF_HISTORY_ACTION_LABELS = {
    staff_update: 'Оновлення профілю',
    pool_status_update: 'Переміщення між списками',
    status_change: 'Зміна активності',
    staff_profession_checklist_update: 'Чек-лист професії',
    staff_document_upload: 'Документ додано',
    staff_document_archive: 'Документ архівовано',
    medical_book_update: 'Медкнижку оновлено',
    staff_resource_issue: 'Ресурс видано',
    staff_resource_return: 'Ресурс повернуто',
    staff_offboarding_complete: 'Співпрацю завершено',
    shift_create: 'Додано зміну',
    shift_update: 'Оновлено зміну',
    shift_replace: 'Підміна зміни',
    shift_delete: 'Видалено зміну',
    correction: 'Корекція часу'
};

const STAFF_HISTORY_FIELD_LABELS = {
    name: 'ПІБ',
    role_type: 'основна професія',
    secondary_professions: 'додаткові професії',
    profession_rates: 'ставки по професіях',
    company_structure_node_id: 'вузол структури',
    hr_pool_status: 'HR-статус',
    blacklist_reason: 'чорний список',
    hourly_rate: 'ставка',
    rate_unit: 'тип ставки',
    phone: 'телефон',
    emergency_contact: 'екстрений контакт',
    emergency_phone: 'телефон екстр. контакту',
    telegram_id: 'Telegram ID',
    telegram_username: 'Telegram нік',
    contract_type: 'тип контракту',
    skills: 'навички',
    address: 'адреса',
    notes: 'нотатки',
    birth_date: 'дата народження'
};

function formatStaffHistoryTime(value) {
    if (!value) return 'без дати';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function staffHistoryChangedFields(details = {}) {
    const changes = details?.changes && typeof details.changes === 'object' ? details.changes : null;
    const fields = changes ? Object.keys(changes) : (Array.isArray(details?.changed_fields) ? details.changed_fields : []);
    return fields.map(field => STAFF_HISTORY_FIELD_LABELS[field] || field).slice(0, 8);
}

function renderStaffHistoryRows(rows = []) {
    if (!rows.length) return '<div class="hr-staff-history-empty">Змін профілю ще немає.</div>';
    return rows.map(row => {
        const details = row.details || {};
        const fields = staffHistoryChangedFields(details);
        const fieldHtml = fields.length
            ? `<div class="hr-staff-history-fields">${fields.map(field => `<i>${escapeHtml(field)}</i>`).join('')}</div>`
            : '';
        return `<article class="hr-staff-history-item">
            <b>${escapeHtml(STAFF_HISTORY_ACTION_LABELS[row.action] || row.action || 'Подія')}</b>
            <span>${escapeHtml(formatStaffHistoryTime(row.created_at))} · ${escapeHtml(row.performed_by || 'система')}</span>
            ${fieldHtml}
        </article>`;
    }).join('');
}

async function loadStaffProfileHistory(staffId) {
    const root = document.getElementById('editStaffHistory');
    if (!root || !staffId) return;
    root.innerHTML = 'Історія завантажується...';
    const data = await hrFetch(`/staff/${staffId}/history?limit=30`);
    if (!data?.success) {
        root.innerHTML = '<div class="hr-staff-history-empty">Не вдалося завантажити історію.</div>';
        return;
    }
    root.innerHTML = renderStaffHistoryRows(data.data || []);
}

function activeEditStaffId() {
    return document.getElementById('editStaffId')?.value;
}

function updateStaffPhotoPreview(urlOverride) {
    const preview = document.getElementById('editPhotoPreview');
    if (!preview) return;
    const rawUrl = urlOverride !== undefined
        ? urlOverride
        : document.getElementById('editPhotoUrl')?.value;
    const photoUrl = String(rawUrl || '').trim();
    preview.replaceChildren();
    preview.classList.toggle('has-photo', Boolean(photoUrl));
    if (!photoUrl) {
        preview.textContent = '!';
        return;
    }
    const img = document.createElement('img');
    img.src = photoUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
        preview.classList.remove('has-photo');
        preview.replaceChildren();
        preview.textContent = '!';
    }, { once: true });
    preview.appendChild(img);
}

function clearStaffPhotoUrl() {
    const input = document.getElementById('editPhotoUrl');
    if (input) {
        input.value = '';
        input.focus();
    }
    updateStaffPhotoPreview('');
}

function formatStaffDateValue(value) {
    if (!value) return 'без дати';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toLocaleDateString('uk-UA');
}

function formatStaffFileSize(bytes) {
    return formatResumeFileSize(bytes);
}

function staffDateTone(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
    if (days < 0) return 'hr-staff-foundation-danger';
    if (days <= 30) return 'hr-staff-foundation-warning';
    return '';
}

function renderStaffFoundationEmpty(text) {
    return `<div class="hr-staff-foundation-empty">${escapeHtml(text)}</div>`;
}

function staffDateInputValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function payrollSchemeAmount(scheme = {}, fallbackRate = 0) {
    const config = scheme.config || {};
    const type = scheme.scheme_type || scheme.schemeType || 'hourly';
    if (type === 'per_shift') return Number(config.perShiftRate ?? config.rate ?? config.amount ?? 0);
    if (type === 'monthly_fixed') return Number(config.monthlyAmount ?? config.fixedAmount ?? config.amount ?? 0);
    if (type === 'percent') return Number(config.percentRate ?? config.rate ?? 0);
    if (type === 'manual') return Number(config.manualAmount ?? config.amount ?? 0);
    if (type === 'hybrid') return Number(config.base?.rate ?? config.baseRate ?? fallbackRate ?? 0);
    return Number(config.hourlyRate ?? config.rate ?? fallbackRate ?? 0);
}

function payrollSchemeAmountLabel(type = 'hourly') {
    return {
        per_shift: 'Сума за вихід',
        hourly: 'Ставка за годину',
        monthly_fixed: 'Фікс за місяць',
        percent: 'Відсоток',
        hybrid: 'Базова ставка',
        manual: 'Ручна сума'
    }[type] || 'Ставка';
}

function updatePayrollSchemeAmountLabel() {
    const type = document.getElementById('editPayrollSchemeType')?.value || 'hourly';
    const label = document.getElementById('editPayrollSchemeAmountLabel');
    if (label) label.textContent = payrollSchemeAmountLabel(type);
}

function updatePayrollAdvancedVisibility() {
    updatePayrollSchemeAmountLabel();
    const type = document.getElementById('editPayrollSchemeType')?.value || 'hourly';
    const hybridConfig = document.getElementById('editPayrollHybridConfig');
    if (hybridConfig) hybridConfig.hidden = type !== 'hybrid';
}

function numberFromInput(id, fallback = 0) {
    const value = Number(document.getElementById(id)?.value || fallback || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function textFromInput(id, fallback = '') {
    return (document.getElementById(id)?.value || fallback || '').trim();
}

function setInputValue(id, value = '') {
    const el = document.getElementById(id);
    if (el) el.value = value === null || value === undefined ? '' : String(value);
}

function setPayrollHybridForm(config = {}, fallbackRate = 0) {
    const base = config.base || {};
    const bonus = (Array.isArray(config.bonusRules) && config.bonusRules[0]) || {};
    const percent = (Array.isArray(config.percentRules) && config.percentRules[0]) || {};
    const deduction = (Array.isArray(config.deductions) && config.deductions[0]) || {};
    const advance = (Array.isArray(config.advances) && config.advances[0]) || {};
    setInputValue('editPayrollBaseKind', base.kind || config.baseKind || 'hourly');
    setInputValue('editPayrollBaseQuantity', base.quantity ?? config.baseQuantity ?? '');
    setInputValue('editPayrollHybridPercentRate', percent.rate ?? percent.percentRate ?? '');
    setInputValue('editPayrollHybridPercentBase', percent.baseAmount ?? percent.percentBase ?? '');
    setInputValue('editPayrollBonusLabel', bonus.label || 'Премія');
    setInputValue('editPayrollBonusAmount', bonus.amount ?? config.bonusAmount ?? '');
    setInputValue('editPayrollDeductionLabel', deduction.label || 'Утримання');
    setInputValue('editPayrollDeductionAmount', deduction.amount ?? config.deductionAmount ?? '');
    setInputValue('editPayrollAdvanceLabel', advance.label || 'Аванс');
    setInputValue('editPayrollAdvanceAmount', advance.amount ?? config.advanceAmount ?? '');
    const amount = document.getElementById('editPayrollSchemeAmount');
    if (amount && amount.value === '') amount.value = String(base.rate ?? base.amount ?? config.baseRate ?? fallbackRate ?? 0);
}

function collectPayrollSchemeConfigFromForm(type, amount) {
    if (type !== 'hybrid') return {};
    const bonusAmount = numberFromInput('editPayrollBonusAmount');
    const percentRate = numberFromInput('editPayrollHybridPercentRate');
    const deductionAmount = numberFromInput('editPayrollDeductionAmount');
    const advanceAmount = numberFromInput('editPayrollAdvanceAmount');
    return {
        base: {
            kind: document.getElementById('editPayrollBaseKind')?.value || 'hourly',
            rate: amount,
            amount,
            quantity: numberFromInput('editPayrollBaseQuantity')
        },
        bonusRules: bonusAmount ? [{ kind: 'fixed', label: textFromInput('editPayrollBonusLabel', 'Премія'), amount: bonusAmount }] : [],
        percentRules: percentRate ? [{ kind: 'percent', label: 'Відсоток', rate: percentRate, baseAmount: numberFromInput('editPayrollHybridPercentBase') }] : [],
        deductions: deductionAmount ? [{ kind: 'fixed', label: textFromInput('editPayrollDeductionLabel', 'Утримання'), amount: deductionAmount }] : [],
        advances: advanceAmount ? [{ kind: 'fixed', label: textFromInput('editPayrollAdvanceLabel', 'Аванс'), amount: advanceAmount }] : []
    };
}

function renderStaffRoleAssignments(rows = []) {
    if (!rows.length) return renderStaffFoundationEmpty('Ролі ще не синхронізовані.');
    const optionHtml = (labels, selected) => Object.entries(labels).map(([value, label]) =>
        `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');
    return rows.map(row => {
        const key = normalizeProfessionKey(row.profession_key || row.professionKey);
        const primary = row.is_primary || row.isPrimary;
        const title = row.profession_title || row.professionTitle || professionTitle(key);
        return `<article class="hr-staff-role-assignment-row" data-role-assignment="${escapeHtml(key)}" data-primary="${primary ? 'true' : 'false'}">
            <div class="hr-staff-role-assignment-title">
                <b>${escapeHtml(title)}</b>
                <small>${primary ? 'Основна роль' : 'Додаткова роль'}</small>
            </div>
            <select data-role-field="status" aria-label="Статус ролі ${escapeHtml(title)}">${optionHtml(STAFF_ROLE_STATUS_LABELS, row.status || 'active')}</select>
            <select data-role-field="admission_status" aria-label="Допуск ${escapeHtml(title)}">${optionHtml(STAFF_ROLE_ADMISSION_LABELS, row.admission_status || row.admissionStatus || 'pending')}</select>
            <select data-role-field="internship_status" aria-label="Стажування ${escapeHtml(title)}">${optionHtml(STAFF_ROLE_INTERNSHIP_LABELS, row.internship_status || row.internshipStatus || 'none')}</select>
        </article>`;
    }).join('');
}

function readStaffRoleAssignmentRows() {
    const explicitRates = new Map(readStaffProfessionRates().map(row => [normalizeProfessionKey(row.profession_key), Number(row.hourly_rate || 0)]));
    const baseRate = Number(document.getElementById('editHourlyRate')?.value || 0);
    return Array.from(document.querySelectorAll('[data-role-assignment]')).map(row => {
        const key = normalizeProfessionKey(row.dataset.roleAssignment);
        const isPrimary = row.dataset.primary === 'true';
        return {
            profession_key: key,
            is_primary: isPrimary,
            status: row.querySelector('[data-role-field="status"]')?.value || 'active',
            admission_status: row.querySelector('[data-role-field="admission_status"]')?.value || 'pending',
            internship_status: row.querySelector('[data-role-field="internship_status"]')?.value || 'none',
            hourly_rate: explicitRates.get(key) || (isPrimary && baseRate > 0 ? baseRate : null)
        };
    }).filter(row => row.profession_key);
}

function refreshStaffRoleAssignmentsFromCurrentForm() {
    const root = document.getElementById('editStaffRoleAssignments');
    if (!root) return;
    const existing = new Map(readStaffRoleAssignmentRows().map(row => [row.profession_key, row]));
    const primary = normalizeProfessionKey(document.getElementById('editRoleType')?.value);
    const keys = normalizeProfessionList([primary, ...readStaffSecondaryProfessionSelection()]);
    if (!keys.length) {
        root.innerHTML = renderStaffFoundationEmpty('Спочатку виберіть професію.');
        return;
    }
    const rows = keys.map(key => ({
        profession_key: key,
        profession_title: professionTitle(key),
        is_primary: key === primary,
        status: existing.get(key)?.status || 'active',
        admission_status: existing.get(key)?.admission_status || (key === primary ? 'approved' : 'pending'),
        internship_status: existing.get(key)?.internship_status || (key === 'intern' ? 'in_progress' : 'none')
    }));
    root.innerHTML = renderStaffRoleAssignments(rows);
}

function renderStaffResourceOptions(items = [], selected = '') {
    if (!items.length) return '<option value="">Немає доступних позицій</option>';
    return [
        '<option value="">Виберіть позицію</option>',
        ...items.map(item => {
            const label = item.subtitle ? `${item.label} · ${item.subtitle}` : item.label;
            return `<option value="${escapeHtml(item.id)}" data-title="${escapeHtml(item.label || '')}"${String(item.id) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        })
    ].join('');
}

function selectedStaffResourceOption() {
    const select = document.getElementById('editResourceSourceId');
    const option = select?.selectedOptions?.[0];
    if (!select || !option || !option.value) return null;
    return {
        id: option.value,
        title: option.dataset.title || option.textContent || ''
    };
}

function syncResourceTitleFromOption() {
    const kind = document.getElementById('editResourceKind')?.value || 'custom';
    const title = document.getElementById('editResourceTitle');
    const selected = selectedStaffResourceOption();
    if (kind !== 'custom' && title && selected?.title) title.value = selected.title;
}

function updateResourcePickerVisibility() {
    const kind = document.getElementById('editResourceKind')?.value || 'custom';
    const sourceGroup = document.getElementById('editResourceSourceGroup');
    const titleGroup = document.getElementById('editResourceTitleGroup');
    if (sourceGroup) sourceGroup.hidden = kind === 'custom';
    if (titleGroup) titleGroup.hidden = false;
}

function renderStaffDocuments(rows = []) {
    staffDocumentNameById = new Map(rows.map(doc => [Number(doc.id), doc.original_name || doc.title || 'staff-document']));
    if (!rows.length) return renderStaffFoundationEmpty('Документи ще не додані.');
    return rows.map(doc => {
        const title = doc.title || doc.original_name || 'Документ';
        const type = STAFF_DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type || 'Документ';
        const expires = doc.expires_at ? ` · діє до ${formatStaffDateValue(doc.expires_at)}` : '';
        const issued = doc.issued_at ? ` · видано ${formatStaffDateValue(doc.issued_at)}` : '';
        const note = doc.notes ? ` · ${doc.notes}` : '';
        return `<article class="hr-staff-foundation-item ${staffDateTone(doc.expires_at)}">
            <div>
                <b>${escapeHtml(title)}</b>
                <span>${escapeHtml(type)} · ${escapeHtml(formatStaffFileSize(doc.file_size))}${escapeHtml(issued)}${escapeHtml(expires)}${escapeHtml(note)}</span>
            </div>
            <div class="hr-staff-foundation-actions">
                <button type="button" class="btn-secondary" onclick="downloadStaffDocument(${Number(doc.id)})">Скачати</button>
                <button type="button" class="btn-secondary" onclick="archiveStaffDocument(${Number(doc.id)})">Архів</button>
            </div>
        </article>`;
    }).join('');
}

function renderStaffMedicalBook(rows = []) {
    if (!rows.length) return renderStaffFoundationEmpty('Медкнижка ще не зафіксована.');
    return rows.slice(0, 5).map(item => {
        const status = item.status === 'expired' ? 'прострочено' : 'активно';
        const doc = item.document_title ? ` · файл: ${item.document_title}` : '';
        const note = item.notes ? ` · ${item.notes}` : '';
        return `<article class="hr-staff-foundation-item ${staffDateTone(item.expires_at)}">
            <div>
                <b>Медкнижка · ${escapeHtml(status)}</b>
                <span>видано ${escapeHtml(formatStaffDateValue(item.issued_at))} · діє до ${escapeHtml(formatStaffDateValue(item.expires_at))}${escapeHtml(doc)}${escapeHtml(note)}</span>
            </div>
        </article>`;
    }).join('');
}

function renderStaffResources(rows = []) {
    if (!rows.length) return renderStaffFoundationEmpty('Немає активних виданих ресурсів.');
    return rows.map(item => {
        const kind = STAFF_RESOURCE_KIND_LABELS[item.resource_kind] || item.resource_kind || 'Ресурс';
        const status = STAFF_RESOURCE_STATUS_LABELS[item.status] || item.status || '';
        const due = item.due_return_at ? ` · повернути до ${formatStaffDateValue(item.due_return_at)}` : '';
        const note = item.notes ? ` · ${item.notes}` : '';
        const movementId = item.status === 'returned' ? item.warehouse_return_movement_id : item.warehouse_issue_movement_id;
        const movement = movementId ? ` · рух складу #${movementId}` : '';
        return `<article class="hr-staff-foundation-item ${item.status === 'issued' ? staffDateTone(item.due_return_at) : ''}">
            <div>
                <b>${escapeHtml(item.title || 'Ресурс')}</b>
                <span>${escapeHtml(kind)} · ${escapeHtml(status)} · ${escapeHtml(item.quantity || 1)} шт.${escapeHtml(due)}${escapeHtml(movement)}${escapeHtml(note)}</span>
            </div>
            <div class="hr-staff-foundation-actions">
                ${item.status === 'issued' ? `<button type="button" class="btn-secondary" onclick="returnStaffResource(${Number(item.id)})">Повернуто</button>` : ''}
            </div>
        </article>`;
    }).join('');
}

function renderStaffOffboarding(rows = []) {
    if (!rows.length) return renderStaffFoundationEmpty('Подій завершення співпраці ще немає.');
    return rows.slice(0, 5).map(item => {
        const account = STAFF_OFFBOARDING_ACCOUNT_LABELS[item.account_action] || item.account_action || '';
        const resources = Number(item.open_resource_count || 0);
        const resourceText = resources ? ` · неповернуті ресурси: ${resources}` : '';
        return `<article class="hr-staff-foundation-item ${resources ? 'hr-staff-foundation-warning' : ''}">
            <div>
                <b>${escapeHtml(formatStaffDateValue(item.effective_date))} · ${escapeHtml(HR_POOL_LABELS[item.target_pool_status] || item.target_pool_status || '')}</b>
                <span>${escapeHtml(item.reason || 'Без причини')} · ${escapeHtml(account)}${escapeHtml(resourceText)}</span>
            </div>
        </article>`;
    }).join('');
}

function renderStaffOffboardingReadiness(payload = {}) {
    const openResources = Number(payload.open_resource_count || 0);
    const activeAccounts = Number(payload.active_account_count || 0);
    const documentAlerts = Number(payload.document_alert_count || 0);
    const hasBlockers = Array.isArray(payload.disable_blockers) && payload.disable_blockers.length > 0;
    const hasPermissionBlocker = (payload.disable_blockers || []).some(item => item.block_reason === 'requires_manage_accounts');
    const blockerAlert = hasPermissionBlocker
        ? 'Автоматичне вимкнення акаунта потребує доступу manage_accounts.'
        : 'Автоматичне вимкнення акаунта заблоковано для поточного або protected-акаунта.';
    const summaryTone = openResources || documentAlerts || hasBlockers ? 'is-warning' : 'is-ok';
    const resourceList = (payload.open_resources || []).slice(0, 3).map(item => {
        const due = item.due_return_at ? ` · до ${formatStaffDateValue(item.due_return_at)}` : '';
        return `<span>${escapeHtml(item.title || 'Ресурс')} · ${escapeHtml(String(item.quantity || 1))} шт.${escapeHtml(due)}</span>`;
    }).join('');
    const accountList = (payload.active_accounts || []).slice(0, 3).map(account => {
        const role = ROLE_LABELS[account.role] || account.role || 'роль не вказана';
        const flags = account.is_current_user ? ' · поточний акаунт' : (account.is_protected ? ' · protected' : '');
        return `<span>${escapeHtml(account.username || account.name || 'CRM-акаунт')} · ${escapeHtml(role)}${escapeHtml(flags)}</span>`;
    }).join('');
    const documentList = (payload.document_alerts || []).slice(0, 3).map(item => {
        const source = STAFF_OFFBOARDING_DOC_SOURCE_LABELS[item.source] || item.source || 'Документ';
        const expires = item.expires_at ? ` · до ${formatStaffDateValue(item.expires_at)}` : '';
        return `<span>${escapeHtml(source)}: ${escapeHtml(item.title || 'без назви')}${escapeHtml(expires)}</span>`;
    }).join('');
    const details = [
        resourceList || '<span>Неповернутих ресурсів немає.</span>',
        accountList || '<span>Активного CRM-акаунта не знайдено.</span>',
        documentList || '<span>Критичних строків документів на 30 днів немає.</span>'
    ].join('');
    return `<div class="hr-offboarding-readiness-card ${summaryTone}">
        <div class="hr-offboarding-readiness-grid">
            <div class="${openResources ? 'is-warning' : 'is-ok'}"><b>${openResources}</b><span>ресурси</span></div>
            <div class="${activeAccounts ? 'is-info' : 'is-muted'}"><b>${activeAccounts}</b><span>акаунти</span></div>
            <div class="${documentAlerts ? 'is-warning' : 'is-ok'}"><b>${documentAlerts}</b><span>документи</span></div>
        </div>
        <div class="hr-offboarding-readiness-detail">${details}</div>
        ${hasBlockers ? `<div class="hr-offboarding-readiness-alert">${escapeHtml(blockerAlert)}</div>` : ''}
    </div>`;
}

function lifecycleStatusLabel(status = '') {
    return {
        done: 'Готово',
        blocked: 'Блокер',
        missing: 'Потрібно',
        unknown: 'Немає даних',
        not_applicable: 'Не актуально'
    }[status] || 'Потрібно';
}

function lifecycleStatusTone(item = {}) {
    if (item.status === 'done') return 'is-ok';
    if (item.status === 'blocked' || item.severity === 'critical') return 'is-critical';
    if (item.status === 'unknown') return 'is-unknown';
    if (item.status === 'not_applicable') return 'is-muted';
    return 'is-warning';
}

function lifecycleSummaryLabel(value) {
    return value ? 'Так' : 'Ні';
}

function lifecycleActionNode(action, staffId, item = {}) {
    const id = Number(staffId);
    if (!action || !Number.isFinite(id) || id <= 0 || item.complete || item.status === 'not_applicable') return '';
    const button = (label, handler) => `<button type="button" class="hr-lifecycle-action" onclick="${handler}">${escapeHtml(label)}</button>`;
    if (action === 'profile') return button('Профіль', "document.getElementById('editStaffName')?.focus()");
    if (action === 'documents') return button('Документи', 'focusStaffDocumentsPanel()');
    if (action === 'training') return button('Readiness', `openStaffTrainingReadiness(${id})`);
    if (action === 'onboarding' && canManage) return button('Onboarding', `openStaffOnboardingAssignment(${id})`);
    if (action === 'account' && canLinkAccounts()) {
        const handler = item.key === 'account_linked'
            ? `openAccountLinkForStaff(${id}, this)`
            : `openAccountForStaff(${id}, this)`;
        return button('Акаунт', handler);
    }
    if (action === 'face') return button('Face', "showNotification('Face descriptor додається через camera/check-in flow', 'info')");
    if (action === 'schedule' || action === 'attendance') return '<a class="hr-lifecycle-action" href="/staff">Графік</a>';
    if (action === 'payroll') return '<a class="hr-lifecycle-action" href="/hr#salary">Payroll</a>';
    if (action === 'offboarding') return button('Offboarding', "document.getElementById('editOffboardingReason')?.focus()");
    return '';
}

function renderLifecycleItem(item = {}, staffId) {
    const tone = lifecycleStatusTone(item);
    const detail = item.detail ? `<small>${escapeHtml(item.detail)}</small>` : '';
    const count = item.count !== null && item.count !== undefined ? `<i>${escapeHtml(String(item.count))}</i>` : '';
    const action = lifecycleActionNode(item.action, staffId, item);
    return `<article class="hr-lifecycle-item ${tone}" data-lifecycle-item="${escapeHtml(item.key || '')}">
        <div class="hr-lifecycle-item-main">
            <span class="hr-lifecycle-dot" aria-hidden="true"></span>
            <div>
                <b>${escapeHtml(item.label || item.key || 'Checklist item')}</b>
                ${detail}
            </div>
        </div>
        <div class="hr-lifecycle-item-side">
            ${count}
            <span>${escapeHtml(lifecycleStatusLabel(item.status))}</span>
            ${action}
        </div>
    </article>`;
}

function renderLifecycleSection(section = {}, staffId) {
    const items = Array.isArray(section.items) ? section.items : [];
    return `<section class="hr-lifecycle-section ${section.status === 'critical' ? 'is-critical' : section.status === 'warning' ? 'is-warning' : 'is-ok'}">
        <div class="hr-lifecycle-section-head">
            <div>
                <strong>${escapeHtml(section.label || section.key || 'Lifecycle')}</strong>
                <span>${Number(section.done || 0)}/${Number(section.total || 0)} · ${Number(section.percent || 0)}%</span>
            </div>
            <em>${section.blocked ? `${Number(section.blocked)} блок.` : section.warning ? `${Number(section.warning)} увага` : 'ok'}</em>
        </div>
        <div class="hr-lifecycle-items">${items.map(item => renderLifecycleItem(item, staffId)).join('')}</div>
    </section>`;
}

function renderStaffLifecycleChecklist(payload = {}) {
    const staffId = Number(payload.staff?.id || activeEditStaffId() || 0);
    const summary = payload.summary || {};
    const metrics = payload.metrics || {};
    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    const findingHtml = (payload.findings || []).map(finding =>
        `<div class="hr-lifecycle-finding">${escapeHtml(finding.message || finding.key || '')}</div>`
    ).join('');
    return `<div class="hr-lifecycle-summary">
        <div class="hr-lifecycle-summary-card ${summary.status === 'critical' ? 'is-critical' : summary.status === 'warning' ? 'is-warning' : 'is-ok'}">
            <b>${Number(summary.blocker_count || 0)}</b>
            <span>блокери</span>
        </div>
        <div class="hr-lifecycle-summary-card">
            <b>${Number(summary.warning_count || 0)}</b>
            <span>warnings</span>
        </div>
        <div class="hr-lifecycle-summary-card ${summary.ready_for_schedule ? 'is-ok' : 'is-warning'}">
            <b>${escapeHtml(lifecycleSummaryLabel(summary.ready_for_schedule))}</b>
            <span>готовий до графіка</span>
        </div>
        <div class="hr-lifecycle-summary-card ${summary.ready_for_offboarding ? 'is-ok' : 'is-muted'}">
            <b>${escapeHtml(lifecycleSummaryLabel(summary.ready_for_offboarding))}</b>
            <span>offboarding закритий</span>
        </div>
    </div>
    <div class="hr-lifecycle-metrics">
        <span>Account: ${Number(metrics.active_account_count || 0)}</span>
        <span>Face: ${Number(metrics.face_descriptor_count || 0)}</span>
        <span>Readiness: ${Number(metrics.readiness_percent || 0)}%</span>
        <span>Future shifts: ${Number(metrics.future_schedule_count || 0)}</span>
        <span>Payroll open: ${Number(metrics.open_payroll_count || 0)}</span>
    </div>
    <div class="hr-lifecycle-sections">${sections.map(section => renderLifecycleSection(section, staffId)).join('')}</div>
    ${findingHtml ? `<div class="hr-lifecycle-findings">${findingHtml}</div>` : ''}`;
}

async function loadStaffLifecycleChecklist(staffId, options = {}) {
    const root = document.getElementById('editStaffLifecycleChecklist');
    const id = Number(staffId);
    if (!root || !Number.isFinite(id) || id <= 0) return;
    if (!canManage) {
        root.innerHTML = renderStaffFoundationEmpty('Lifecycle checklist доступний тільки HR/керівнику.');
        return;
    }
    const seq = ++staffLifecycleLoadSeq;
    root.innerHTML = 'Lifecycle checklist завантажується...';
    const data = await hrFetch(`/staff/${id}/lifecycle-checklist`).catch(() => null);
    if (seq !== staffLifecycleLoadSeq) return;
    root.innerHTML = data?.success
        ? renderStaffLifecycleChecklist(data.data || {})
        : renderStaffFoundationEmpty(data?.error || 'Не вдалося завантажити lifecycle checklist.');
}

function setStaffFoundationLoading() {
    const docs = document.getElementById('editStaffDocuments');
    const medical = document.getElementById('editMedicalBookList');
    const resources = document.getElementById('editStaffResources');
    const offboarding = document.getElementById('editStaffOffboarding');
    const readiness = document.getElementById('editOffboardingReadiness');
    const roles = document.getElementById('editStaffRoleAssignments');
    const payroll = document.getElementById('editPayrollSchemeSummary');
    if (docs) docs.innerHTML = 'Документи завантажуються...';
    if (medical) medical.innerHTML = 'Медкнижка завантажується...';
    if (resources) resources.innerHTML = 'Ресурси завантажуються...';
    if (offboarding) offboarding.innerHTML = 'Завершення співпраці завантажується...';
    if (readiness) readiness.innerHTML = 'Перевірка готовності завантажується...';
    if (roles) roles.innerHTML = 'Ролі завантажуються...';
    if (payroll) payroll.textContent = 'Зарплатна схема завантажується...';
}

async function loadStaffFoundation(staffId) {
    const docsRoot = document.getElementById('editStaffDocuments');
    const medicalRoot = document.getElementById('editMedicalBookList');
    const resourcesRoot = document.getElementById('editStaffResources');
    const offboardingRoot = document.getElementById('editStaffOffboarding');
    const readinessRoot = document.getElementById('editOffboardingReadiness');
    if (!docsRoot && !medicalRoot && !resourcesRoot && !offboardingRoot && !readinessRoot) return;
    const seq = ++staffFoundationLoadSeq;
    if (!canManage) {
        const restricted = renderStaffFoundationEmpty('Доступ до HR-документів і offboarding має тільки HR/керівник.');
        if (docsRoot) docsRoot.innerHTML = restricted;
        if (medicalRoot) medicalRoot.innerHTML = restricted;
        if (resourcesRoot) resourcesRoot.innerHTML = restricted;
        if (offboardingRoot) offboardingRoot.innerHTML = restricted;
        if (readinessRoot) readinessRoot.innerHTML = restricted;
        return;
    }
    setStaffFoundationLoading();
    const [docs, medical, resources, offboarding, readiness] = await Promise.all([
        hrFetch(`/staff/${staffId}/documents`).catch(() => null),
        hrFetch(`/staff/${staffId}/medical-book`).catch(() => null),
        hrFetch(`/staff/${staffId}/resources`).catch(() => null),
        hrFetch(`/staff/${staffId}/offboarding`).catch(() => null),
        hrFetch(`/staff/${staffId}/offboarding-readiness`).catch(() => null)
    ]);
    if (seq !== staffFoundationLoadSeq) return;
    staffOffboardingReadiness = readiness?.success ? (readiness.data || null) : null;
    if (docsRoot) docsRoot.innerHTML = docs?.success ? renderStaffDocuments(docs.data || []) : renderStaffFoundationEmpty(docs?.error || 'Не вдалося завантажити документи.');
    if (medicalRoot) medicalRoot.innerHTML = medical?.success ? renderStaffMedicalBook(medical.data || []) : renderStaffFoundationEmpty(medical?.error || 'Не вдалося завантажити медкнижку.');
    if (resourcesRoot) resourcesRoot.innerHTML = resources?.success ? renderStaffResources(resources.data || []) : renderStaffFoundationEmpty(resources?.error || 'Не вдалося завантажити ресурси.');
    if (offboardingRoot) offboardingRoot.innerHTML = offboarding?.success ? renderStaffOffboarding(offboarding.data || []) : renderStaffFoundationEmpty(offboarding?.error || 'Не вдалося завантажити offboarding.');
    if (readinessRoot) readinessRoot.innerHTML = readiness?.success ? renderStaffOffboardingReadiness(readiness.data || {}) : renderStaffFoundationEmpty(readiness?.error || 'Не вдалося завантажити перевірку готовності.');
}

async function loadStaffRoleAssignments(staffId) {
    const root = document.getElementById('editStaffRoleAssignments');
    if (!root || !staffId) return;
    const seq = ++staffRoleAssignmentsLoadSeq;
    root.innerHTML = 'Ролі завантажуються...';
    const data = await hrFetch(`/staff/${staffId}/role-assignments`).catch(() => null);
    if (seq !== staffRoleAssignmentsLoadSeq) return;
    root.innerHTML = data?.success
        ? renderStaffRoleAssignments(data.data || [])
        : renderStaffFoundationEmpty(data?.error || 'Не вдалося завантажити ролі.');
}

async function saveStaffRoleAssignments() {
    const staffId = activeEditStaffId();
    if (!staffId) return;
    const assignments = readStaffRoleAssignmentRows();
    if (!assignments.length) {
        showNotification('Немає ролей для збереження', 'error');
        return;
    }
    const data = await hrFetch(`/staff/${staffId}/role-assignments`, {
        method: 'PUT',
        body: {
            primary_role: document.getElementById('editRoleType')?.value || assignments[0].profession_key,
            assignments
        }
    });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося оновити ролі', 'error');
        return;
    }
    showNotification('Ролі та допуски оновлено', 'success');
    await loadStaffRoleAssignments(staffId);
}

function setPayrollSchemeForm(payload = {}) {
    const scheme = payload.active_scheme || payload.activeScheme || null;
    const fallbackRate = Number(payload.fallback_hourly_rate ?? payload.fallbackHourlyRate ?? document.getElementById('editHourlyRate')?.value ?? 0);
    const fallbackUnit = normalizeStaffRateUnit(payload.fallback_rate_unit ?? payload.fallbackRateUnit ?? currentEditRateUnit());
    const type = scheme?.scheme_type || scheme?.schemeType || (fallbackUnit === 'day' ? 'per_shift' : 'hourly');
    const typeSelect = document.getElementById('editPayrollSchemeType');
    const amountInput = document.getElementById('editPayrollSchemeAmount');
    const titleInput = document.getElementById('editPayrollSchemeTitle');
    const fromInput = document.getElementById('editPayrollSchemeEffectiveFrom');
    const toInput = document.getElementById('editPayrollSchemeEffectiveTo');
    const summary = document.getElementById('editPayrollSchemeSummary');
    if (typeSelect) typeSelect.value = type;
    updatePayrollAdvancedVisibility();
    if (amountInput) amountInput.value = String(payrollSchemeAmount(scheme || { scheme_type: type, config: {} }, fallbackRate) || 0);
    setPayrollHybridForm(scheme?.config || {}, fallbackRate);
    if (titleInput) titleInput.value = scheme?.title || PAYROLL_SCHEME_LABELS[type] || '';
    if (fromInput) fromInput.value = staffDateInputValue(scheme?.effective_from || scheme?.effectiveFrom);
    if (toInput) toInput.value = staffDateInputValue(scheme?.effective_to || scheme?.effectiveTo);
    if (summary) {
        summary.textContent = scheme
            ? `Активна: ${PAYROLL_SCHEME_LABELS[type] || type} · ${scheme.title || 'без назви'}${scheme.effective_from ? ` · з ${formatStaffDateValue(scheme.effective_from)}` : ''}${scheme.effective_to ? ` · до ${formatStaffDateValue(scheme.effective_to)}` : ''}`
            : `Активної схеми немає. За замовченням використовується HR-ставка: ${fmtMoney(fallbackRate)} / ${staffRateUnitSuffix(fallbackUnit)}.`;
    }
}

async function loadStaffPayrollScheme(staffId) {
    const summary = document.getElementById('editPayrollSchemeSummary');
    if (!summary || !staffId) return;
    const seq = ++staffPayrollSchemeLoadSeq;
    summary.textContent = 'Зарплатна схема завантажується...';
    const data = await hrFetch(`/staff/${staffId}/payroll-scheme`).catch(() => null);
    if (seq !== staffPayrollSchemeLoadSeq) return;
    if (!data?.success) {
        summary.textContent = data?.error || 'Не вдалося завантажити зарплатну схему.';
        return;
    }
    setPayrollSchemeForm(data.data || {});
}

async function saveStaffPayrollScheme() {
    const staffId = activeEditStaffId();
    if (!staffId) return;
    const schemeType = document.getElementById('editPayrollSchemeType')?.value || 'hourly';
    const amount = Number(document.getElementById('editPayrollSchemeAmount')?.value || 0);
    const config = collectPayrollSchemeConfigFromForm(schemeType, amount);
    const data = await hrFetch(`/staff/${staffId}/payroll-scheme`, {
        method: 'PUT',
        body: {
            scheme_type: schemeType,
            amount,
            config,
            title: document.getElementById('editPayrollSchemeTitle')?.value || PAYROLL_SCHEME_LABELS[schemeType] || schemeType,
            effective_from: document.getElementById('editPayrollSchemeEffectiveFrom')?.value || null,
            effective_to: document.getElementById('editPayrollSchemeEffectiveTo')?.value || null
        }
    });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося зберегти зарплатну схему', 'error');
        return;
    }
    showNotification('Зарплатну схему оновлено', 'success');
    await loadStaffPayrollScheme(staffId);
}

async function loadStaffResourceOptions(kind = document.getElementById('editResourceKind')?.value || 'custom') {
    updateResourcePickerVisibility();
    const sourceSelect = document.getElementById('editResourceSourceId');
    const hint = document.getElementById('editResourceSourceHint');
    if (!sourceSelect) return;
    if (kind === 'custom') {
        sourceSelect.innerHTML = '<option value="">Ручний запис</option>';
        if (hint) hint.textContent = 'Для ручного ресурсу достатньо назви.';
        return;
    }
    const seq = ++staffResourceOptionsLoadSeq;
    sourceSelect.innerHTML = '<option value="">Завантаження...</option>';
    if (hint) hint.textContent = kind === 'costume' ? 'Підтягується з розділу Склад → Костюми.' : 'Підтягується з активних складських позицій.';
    const data = await hrFetch(`/resource-options?kind=${encodeURIComponent(kind)}&limit=80`).catch(() => null);
    if (seq !== staffResourceOptionsLoadSeq) return;
    sourceSelect.innerHTML = data?.success ? renderStaffResourceOptions(data.data || []) : '<option value="">Не вдалося завантажити</option>';
    syncResourceTitleFromOption();
}

async function uploadStaffDocument() {
    const staffId = activeEditStaffId();
    const fileInput = document.getElementById('editDocumentFile');
    const file = fileInput?.files?.[0];
    if (!staffId || !file) {
        showNotification('Виберіть файл документа', 'error');
        return;
    }
    const body = new FormData();
    body.append('document', file);
    body.append('document_type', document.getElementById('editDocumentType')?.value || 'other');
    body.append('title', document.getElementById('editDocumentTitle')?.value || file.name);
    body.append('notes', document.getElementById('editDocumentNotes')?.value || '');
    const data = await hrFetch(`/staff/${staffId}/documents`, { method: 'POST', body });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося завантажити документ', 'error');
        return;
    }
    ['editDocumentTitle', 'editDocumentNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    if (fileInput) fileInput.value = '';
    showNotification('Документ додано', 'success');
    loadStaffFoundation(staffId);
}

async function downloadStaffDocument(documentId, fallbackName = 'staff-document') {
    const staffId = activeEditStaffId();
    if (!staffId || !documentId) return;
    const touchWindow = typeof openTouchDownloadWindow === 'function'
        ? openTouchDownloadWindow('Документ працівника')
        : null;
    try {
        const resp = typeof apiFetchWithAuthRetry === 'function'
            ? await apiFetchWithAuthRetry(`/api/hr/staff/${staffId}/documents/${documentId}/download`)
            : await fetch(`/api/hr/staff/${staffId}/documents/${documentId}/download`);
        if (!resp?.ok) {
            const payload = await resp?.json?.().catch(() => ({}));
            showNotification(payload?.error || 'Не вдалося скачати документ', 'error');
            if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
            return;
        }
        const blob = await resp.blob();
        const filename = staffDocumentNameById.get(Number(documentId)) || fallbackName || 'staff-document';
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'Документ підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Не вдалося скачати документ', 'error');
    }
}

async function archiveStaffDocument(documentId) {
    const staffId = activeEditStaffId();
    if (!staffId || !documentId) return;
    const ok = await confirmHrAction('Архівувати документ? Файл не буде видимий у активному списку, але залишиться в аудиті.');
    if (!ok) return;
    const data = await hrFetch(`/staff/${staffId}/documents/${documentId}`, { method: 'DELETE' });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося архівувати документ', 'error');
        return;
    }
    showNotification('Документ перенесено в архів', 'success');
    loadStaffFoundation(staffId);
}

async function saveStaffMedicalBook() {
    const staffId = activeEditStaffId();
    if (!staffId) return;
    const body = {
        issued_at: document.getElementById('editMedicalIssuedAt')?.value || null,
        expires_at: document.getElementById('editMedicalExpiresAt')?.value || null,
        notes: document.getElementById('editMedicalNotes')?.value || null
    };
    if (!body.issued_at && !body.expires_at) {
        showNotification('Вкажіть дату медкнижки', 'error');
        return;
    }
    const data = await hrFetch(`/staff/${staffId}/medical-book`, { method: 'POST', body });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося оновити медкнижку', 'error');
        return;
    }
    showNotification('Медкнижку оновлено', 'success');
    loadStaffFoundation(staffId);
}

async function issueStaffResource() {
    const staffId = activeEditStaffId();
    if (!staffId) return;
    const resourceKind = document.getElementById('editResourceKind')?.value || 'custom';
    const selectedResource = selectedStaffResourceOption();
    const body = {
        resource_kind: resourceKind,
        title: document.getElementById('editResourceTitle')?.value || selectedResource?.title || null,
        quantity: Number(document.getElementById('editResourceQuantity')?.value || 1),
        due_return_at: document.getElementById('editResourceDueReturnAt')?.value || null,
        notes: document.getElementById('editResourceNotes')?.value || null
    };
    if (resourceKind === 'warehouse_stock') body.warehouse_stock_id = selectedResource?.id || null;
    if (resourceKind === 'costume') body.costume_id = selectedResource?.id || null;
    if (resourceKind !== 'custom' && !selectedResource?.id) {
        showNotification('Виберіть позицію ресурсу', 'error');
        return;
    }
    if (!body.title) {
        showNotification('Вкажіть назву ресурсу', 'error');
        return;
    }
    const data = await hrFetch(`/staff/${staffId}/resources`, { method: 'POST', body });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося видати ресурс', 'error');
        return;
    }
    ['editResourceTitle', 'editResourceDueReturnAt', 'editResourceNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const source = document.getElementById('editResourceSourceId');
    if (source) source.value = '';
    const quantity = document.getElementById('editResourceQuantity');
    if (quantity) quantity.value = '1';
    showNotification('Ресурс видано', 'success');
    if (resourceKind !== 'custom') loadStaffResourceOptions(resourceKind);
    loadStaffFoundation(staffId);
}

async function returnStaffResource(assignmentId) {
    const staffId = activeEditStaffId();
    if (!staffId || !assignmentId) return;
    const data = await hrFetch(`/staff/${staffId}/resources/${assignmentId}/return`, { method: 'PUT', body: {} });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося повернути ресурс', 'error');
        return;
    }
    showNotification('Ресурс позначено як повернутий', 'success');
    loadStaffResourceOptions(document.getElementById('editResourceKind')?.value || 'custom');
    loadStaffFoundation(staffId);
}

async function completeStaffOffboarding() {
    const staffId = activeEditStaffId();
    if (!staffId) return;
    const reason = document.getElementById('editOffboardingReason')?.value || '';
    if (!reason.trim()) {
        showNotification('Вкажіть причину завершення співпраці', 'error');
        return;
    }
    const selectedAccountAction = document.getElementById('editOffboardingAccountAction')?.value || 'review';
    const hasOffboardingReadiness = Boolean(staffOffboardingReadiness && typeof staffOffboardingReadiness === 'object');
    const activeAccountCount = hasOffboardingReadiness ? Number(staffOffboardingReadiness.active_account_count || 0) : null;
    let accountAction = selectedAccountAction;
    let skippedAccountActionNote = '';
    if (selectedAccountAction === 'disable' && hasOffboardingReadiness && activeAccountCount <= 0) {
        accountAction = 'none';
        skippedAccountActionNote = ' Активного CRM-акаунта немає, тому дію з акаунтом пропущено.';
    }
    if (accountAction === 'disable' && hasOffboardingReadiness && staffOffboardingReadiness.disable_available === false) {
        const needsAccountAccess = (staffOffboardingReadiness.disable_blockers || [])
            .some(item => item.block_reason === 'requires_manage_accounts');
        showNotification(needsAccountAccess
            ? 'Вимкнення CRM-акаунта потребує доступу manage_accounts.'
            : 'CRM-акаунт не можна вимкнути автоматично: перевірте блок готовності.', 'error');
        return;
    }
    const openResources = hasOffboardingReadiness ? Number(staffOffboardingReadiness.open_resource_count || 0) : 0;
    const documentAlerts = hasOffboardingReadiness ? Number(staffOffboardingReadiness.document_alert_count || 0) : 0;
    const readinessNote = !hasOffboardingReadiness
        ? ' Перевірку готовності не завантажено; сервер перевірить доступ і акаунти під час завершення.'
        : openResources || documentAlerts
        ? ` Є хвости: ресурси ${openResources}, документи ${documentAlerts}.`
        : '';
    const ok = await confirmHrAction(`Завершити співпрацю з цим співробітником? Профіль стане неактивним.${readinessNote}`);
    if (!ok) return;
    const body = {
        effective_date: document.getElementById('editOffboardingDate')?.value || todayStr(),
        target_pool_status: document.getElementById('editOffboardingPoolStatus')?.value || 'reserve',
        account_action: accountAction,
        reason,
        notes: document.getElementById('editOffboardingNotes')?.value || null
    };
    const data = await hrFetch(`/staff/${staffId}/offboarding`, { method: 'POST', body, allowForbiddenResponse: true });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося завершити співпрацю', 'error');
        return;
    }
    const resourceNote = data.open_resource_count ? ` Неповернуті ресурси: ${data.open_resource_count}.` : '';
    const accountNote = data.disabled_accounts ? ` Вимкнено CRM-акаунтів: ${data.disabled_accounts}.` : '';
    showNotification(`Співпрацю завершено.${resourceNote}${accountNote}${skippedAccountActionNote}`, data.open_resource_count ? 'warning' : 'success');
    await closeHrEditableModal('staffEditModal', true);
    await loadTeam();
}

async function openStaffEdit(staffId, options = {}) {
    const s = teamStaff.find(st => st.id === staffId);
    if (!s) return;
    const focusTarget = typeof options === 'string' ? options : options?.focus;
    await ensureProfessionsLoaded({ silent: true });
    await ensureCompanyStructureNodesLoaded({ silent: true });

    document.getElementById('editStaffId').value = staffId;
    const editStaffName = document.getElementById('editStaffName');
    if (editStaffName) editStaffName.value = s.name || '';
    syncStaffProfileHeaderName(s.name || '');
    populateStaffProfessionControls(s);
    document.getElementById('editPhone').value = s.phone || '';
    const editPhotoUrl = document.getElementById('editPhotoUrl');
    if (editPhotoUrl) editPhotoUrl.value = s.photo_url || '';
    updateStaffPhotoPreview(s.photo_url || '');
    document.getElementById('editBirthDate').value = s.birth_date ? s.birth_date.substring(0, 10) : '';
    document.getElementById('editAddress').value = s.address || '';
    document.getElementById('editEmergencyContact').value = s.emergency_contact || '';
    document.getElementById('editEmergencyPhone').value = s.emergency_phone || '';
    const primaryRate = staffProfessionRateMap(s).get(normalizeProfessionKey(s.role_type));
    document.getElementById('editHourlyRate').value = primaryRate || s.hourly_rate || 0;
    const rateUnitSelect = document.getElementById('editRateUnit');
    if (rateUnitSelect) rateUnitSelect.value = staffRateUnit(s);
    syncStaffRateUnitUi(s);
    document.getElementById('editTelegramId').value = s.telegram_id || '';
    document.getElementById('editTelegramUsername').value = s.telegram_username || '';
    document.getElementById('editContractType').value = s.contract_type || 'parttime';
    const editPoolStatus = document.getElementById('editPoolStatus');
    if (editPoolStatus) editPoolStatus.value = s.hr_pool_status || 'core';
    document.getElementById('editSkills').value = (s.skills || []).join(', ');
    document.getElementById('editNotes').value = s.notes || '';
    ['editDocumentTitle', 'editDocumentNotes',
     'editMedicalIssuedAt', 'editMedicalExpiresAt', 'editMedicalNotes',
     'editResourceTitle', 'editResourceDueReturnAt', 'editResourceNotes',
     'editOffboardingReason', 'editOffboardingNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const documentFile = document.getElementById('editDocumentFile');
    if (documentFile) documentFile.value = '';
    const documentType = document.getElementById('editDocumentType');
    if (documentType) documentType.value = 'other';
    const resourceKind = document.getElementById('editResourceKind');
    if (resourceKind) resourceKind.value = 'custom';
    const resourceSource = document.getElementById('editResourceSourceId');
    if (resourceSource) resourceSource.innerHTML = '<option value="">Ручний запис</option>';
    updateResourcePickerVisibility();
    const payrollType = document.getElementById('editPayrollSchemeType');
    if (payrollType) {
        const unit = staffRateUnit(s);
        payrollType.value = unit === 'month' ? 'monthly_fixed' : unit === 'day' ? 'per_shift' : 'hourly';
    }
    updatePayrollAdvancedVisibility();
    const payrollAmount = document.getElementById('editPayrollSchemeAmount');
    if (payrollAmount) payrollAmount.value = String(s.hourly_rate || 0);
    setPayrollHybridForm({}, s.hourly_rate || 0);
    const payrollTitle = document.getElementById('editPayrollSchemeTitle');
    if (payrollTitle) payrollTitle.value = '';
    ['editPayrollSchemeEffectiveFrom', 'editPayrollSchemeEffectiveTo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const resourceQuantity = document.getElementById('editResourceQuantity');
    if (resourceQuantity) resourceQuantity.value = '1';
    const offboardingDate = document.getElementById('editOffboardingDate');
    if (offboardingDate) offboardingDate.value = todayStr();
    const offboardingPool = document.getElementById('editOffboardingPoolStatus');
    if (offboardingPool) offboardingPool.value = 'reserve';
    const offboardingAccount = document.getElementById('editOffboardingAccountAction');
    if (offboardingAccount) offboardingAccount.value = 'review';
    staffOffboardingReadiness = null;

    showHrEditableModal('staffEditModal');
    if (focusTarget === 'documents') focusStaffDocumentsPanel();
    loadStaffProfileHistory(staffId);
    loadStaffLifecycleChecklist(staffId);
    loadStaffFoundation(staffId);
    loadStaffRoleAssignments(staffId);
    loadStaffPayrollScheme(staffId);
    loadStaffResourceOptions('custom');
}

async function saveStaffEdit() {
    const staffId = document.getElementById('editStaffId')?.value;
    const body = {
        name: document.getElementById('editStaffName')?.value || null,
        role_type: document.getElementById('editRoleType')?.value,
        secondary_professions: normalizeProfessionList(readStaffSecondaryProfessionSelection(), [document.getElementById('editRoleType')?.value]),
        phone: document.getElementById('editPhone')?.value || null,
        photo_url: document.getElementById('editPhotoUrl')?.value?.trim() || null,
        birth_date: document.getElementById('editBirthDate')?.value || null,
        address: document.getElementById('editAddress')?.value || null,
        emergency_contact: document.getElementById('editEmergencyContact')?.value || null,
        emergency_phone: document.getElementById('editEmergencyPhone')?.value || null,
        hourly_rate: parseFloat(document.getElementById('editHourlyRate')?.value) || 0,
        rate_unit: currentEditRateUnit(),
        telegram_id: document.getElementById('editTelegramId')?.value || null,
        telegram_username: document.getElementById('editTelegramUsername')?.value || null,
        contract_type: document.getElementById('editContractType')?.value || 'parttime',
        company_structure_node_id: document.getElementById('editCompanyStructureNode')?.value || null,
        profession_rates: readStaffProfessionRates(),
        skills: document.getElementById('editSkills')?.value ? document.getElementById('editSkills')?.value.split(',').map(s => s.trim()).filter(Boolean) : null,
        notes: document.getElementById('editNotes')?.value || null
    };
    const editPoolStatus = document.getElementById('editPoolStatus');
    if (editPoolStatus) body.hr_pool_status = editPoolStatus.value || 'core';

    const data = await hrFetch(`/staff/${staffId}`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
    if (data && data.success) {
        showNotification('Профіль оновлено', 'success');
        await closeHrEditableModal('staffEditModal', true);
        await loadTeam();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

// ==========================================
// BACKOFFICE FOUNDATION: STRUCTURE / POOLS
// ==========================================

const DEFAULT_COMPANY_STRUCTURE_TEXT = [
    'Директор',
    'Заступник директора',
    'Топ-менеджер',
    'Менеджер(и)',
    'HR',
    'Бухгалтер',
    'Арт-директор',
    'Адміністратори',
    'Аніматори',
    'Офіціанти',
    'Бариста',
    'Рецепція',
    'Шеф-кухар',
    'Кухарі',
    'Мийка',
    'Шеф-кондитер',
    'Кондитери',
    'Технічний персонал'
].join('\n');

const ORG_TONE_LABELS = {
    gold: 'Керівництво',
    blue: 'Управління',
    purple: 'Операції',
    violet: 'Підтримка'
};

const ORG_LANE_LABELS = {
    root: 'Верхній рівень',
    deputy: 'Заступник',
    leadership: 'Керівний контур',
    operations: 'Операційний контур',
    support: 'Підтримка'
};

const ORG_ALLOWED_TONES = Object.keys(ORG_TONE_LABELS);
const ORG_ALLOWED_LANES = Object.keys(ORG_LANE_LABELS);
const ORG_CANVAS_MIN_WIDTH = 1180;
const ORG_CANVAS_MIN_HEIGHT = 700;
const ORG_CANVAS_PADDING = 32;
const ORG_GRID_STEP = 20;
const ORG_NODE_WIDTH = 142;
const ORG_NODE_HEIGHT = 84;
const ORG_ROOT_NODE_WIDTH = 180;
const ORG_ROOT_NODE_HEIGHT = 96;
const ORG_AUTO_LAYOUT_ROW_GAP = 120;
const ORG_AUTO_LAYOUT_COMPACT_COLUMNS = 7;
const ORG_AUTO_LAYOUT_COMPACT_X_GAP = 20;
const ORG_COLLISION_PADDING_X = 16;
const ORG_COLLISION_PADDING_Y = 18;
const ORG_ONE_SCREEN_MAX_WIDTH = 1240;
const ORG_ONE_SCREEN_MAX_HEIGHT = 760;
const ORG_AUTO_LAYOUT_LANE_RANK = { root: 0, deputy: 1, leadership: 2, operations: 3, support: 4 };
const ORG_AUTO_PARENT_BY_ID = {
    deputy_director: 'director',
    top_manager: 'deputy_director',
    managers: 'top_manager',
    hr: 'deputy_director',
    accountant: 'director',
    art_director: 'deputy_director',
    admins: 'top_manager',
    marketer: 'top_manager',
    it_specialist: 'deputy_director',
    senior_trampoline: 'deputy_director',
    trampoline_instructors: 'senior_trampoline',
    animators: 'art_director',
    waiters: 'admins',
    barista: 'admins',
    reception: 'admins',
    chef: 'deputy_director',
    cooks: 'chef',
    dishwash: 'chef',
    pastry_chef: 'chef',
    pastry_team: 'pastry_chef',
    pastry_wash: 'pastry_chef',
    technical_staff: 'deputy_director',
    wardrobe: 'technical_staff',
    cleaning: 'technical_staff',
    facilities: 'technical_staff'
};
const ORG_AUTO_STACK_PARENT_BY_STACK = {
    management: 'top_manager',
    art: 'art_director',
    trampoline: 'senior_trampoline',
    kitchen: 'chef',
    pastry: 'pastry_chef',
    technical: 'technical_staff'
};
const DEFAULT_COMPANY_STRUCTURE_POSITIONS = {
    director: { x: 500, y: 20 },
    deputy_director: { x: 440, y: 140 },
    accountant: { x: 600, y: 140 },
    top_manager: { x: 40, y: 260 },
    hr: { x: 200, y: 260 },
    art_director: { x: 360, y: 260 },
    it_specialist: { x: 520, y: 260 },
    senior_trampoline: { x: 680, y: 260 },
    chef: { x: 840, y: 260 },
    technical_staff: { x: 1000, y: 260 },
    managers: { x: 40, y: 380 },
    admins: { x: 200, y: 380 },
    marketer: { x: 360, y: 380 },
    animators: { x: 520, y: 380 },
    trampoline_instructors: { x: 680, y: 380 },
    cooks: { x: 840, y: 380 },
    dishwash: { x: 1000, y: 380 },
    pastry_chef: { x: 280, y: 500 },
    wardrobe: { x: 440, y: 500 },
    cleaning: { x: 600, y: 500 },
    facilities: { x: 760, y: 500 },
    waiters: { x: 200, y: 620 },
    barista: { x: 360, y: 620 },
    reception: { x: 520, y: 620 },
    pastry_team: { x: 680, y: 620 },
    pastry_wash: { x: 840, y: 620 }
};

const DEFAULT_COMPANY_STRUCTURE_NODES = [
    { id: 'director', title: 'Директор', description: 'Фінальне рішення, стратегія, ресурси і правила роботи компанії.', tone: 'gold', lane: 'root', parentId: null, stack: null, order: 10, meta: 'центр рішень' },
    { id: 'deputy_director', title: 'Заступник директора', description: 'Тримає операційний контур, контролює виконання рішень і синхронізує керівників напрямів.', tone: 'blue', lane: 'deputy', parentId: null, stack: null, order: 20, meta: 'операційне керування' },
    { id: 'top_manager', title: 'Топ-менеджер', description: 'Веде менеджерський блок, контролює продажі, бронювання і якість сервісного циклу.', tone: 'blue', lane: 'leadership', parentId: null, stack: 'management', order: 30, meta: 'менеджмент' },
    { id: 'managers', title: 'Менеджер(и)', description: 'Працюють із клієнтами, лідами, бронюваннями і щоденними задачами.', tone: 'blue', lane: 'leadership', parentId: null, stack: 'management', order: 31, meta: 'оператори CRM' },
    { id: 'hr', title: 'HR', description: 'Набір, структура команди, зміни, onboarding, дисципліна і кадровий контур.', tone: 'blue', lane: 'leadership', parentId: null, stack: null, order: 40, meta: 'люди' },
    { id: 'accountant', title: 'Бухгалтер', description: 'Фінансові документи, зарплати, звірки і контроль обліку.', tone: 'blue', lane: 'leadership', parentId: null, stack: null, order: 50, meta: 'фінанси' },
    { id: 'art_director', title: 'Арт-директор', description: 'Керує творчим виробництвом, програмами, костюмами, дизайнами і випускними матеріалами.', tone: 'purple', lane: 'leadership', parentId: null, stack: 'art', order: 60, meta: 'креатив' },
    { id: 'admins', title: 'Адміністратори', description: 'Підтримують зал, комунікацію з гостями, порядок і операційне закриття змін.', tone: 'purple', lane: 'leadership', parentId: null, stack: 'art', order: 61, meta: 'зал' },
    { id: 'marketer', title: 'Маркетолог', description: 'Маркетинг, комунікації, контент і кампанії для залучення клієнтів.', tone: 'blue', lane: 'leadership', parentId: null, stack: null, order: 70, meta: 'попит' },
    { id: 'it_specialist', title: 'IT-спеціаліст', description: 'Підтримує CRM, технічні інтеграції, обладнання і цифрові процеси.', tone: 'violet', lane: 'leadership', parentId: null, stack: null, order: 80, meta: 'системи' },
    { id: 'senior_trampoline', title: 'Старший батутіст', description: 'Відповідає за батутну зону, інструкторів, безпеку і якість активностей.', tone: 'purple', lane: 'operations', parentId: null, stack: 'trampoline', order: 90, meta: 'батутна зона' },
    { id: 'trampoline_instructors', title: 'Батутісти-інструктори', description: 'Проводять активності, стежать за безпекою дітей і підтримують правила зони.', tone: 'purple', lane: 'operations', parentId: null, stack: 'trampoline', order: 91, meta: 'інструктори' },
    { id: 'animators', title: 'Аніматори', description: 'Проводять програми, інтерактиви та дитячі свята згідно зі сценарієм.', tone: 'purple', lane: 'operations', parentId: null, stack: null, order: 100, meta: 'програми' },
    { id: 'waiters', title: 'Офіціанти', description: 'Сервіс столів, подача, комунікація з гостями і підтримка банкетів.', tone: 'purple', lane: 'operations', parentId: null, stack: null, order: 110, meta: 'сервіс' },
    { id: 'barista', title: 'Бариста', description: 'Кавовий бар, напої, швидкість видачі і якість продукту.', tone: 'purple', lane: 'operations', parentId: null, stack: null, order: 120, meta: 'бар' },
    { id: 'reception', title: 'Рецепція', description: 'Перша точка контакту гостей, вхідний потік, оплати і навігація.', tone: 'purple', lane: 'operations', parentId: null, stack: null, order: 130, meta: 'вхід' },
    { id: 'chef', title: 'Шеф-кухар', description: 'Керує кухнею, меню, якістю страв, закупками і кухонною дисципліною.', tone: 'violet', lane: 'support', parentId: null, stack: 'kitchen', order: 140, meta: 'кухня' },
    { id: 'cooks', title: 'Кухарі', description: 'Готують страви, тримають стандарти та швидкість видачі.', tone: 'violet', lane: 'support', parentId: null, stack: 'kitchen', order: 141, meta: 'виробництво' },
    { id: 'dishwash', title: 'Мийка', description: 'Посуд, чистота кухонного циклу і санітарна підтримка.', tone: 'violet', lane: 'support', parentId: null, stack: 'kitchen', order: 142, meta: 'санітарія' },
    { id: 'pastry_chef', title: 'Шеф-кондитер', description: 'Керує кондитерським напрямом, виробництвом десертів і стандартами якості.', tone: 'violet', lane: 'support', parentId: null, stack: 'pastry', order: 150, meta: 'кондитерка' },
    { id: 'pastry_team', title: 'Кондитери', description: 'Виготовляють десерти, декор і кондитерські позиції для подій.', tone: 'violet', lane: 'support', parentId: null, stack: 'pastry', order: 151, meta: 'виробництво' },
    { id: 'pastry_wash', title: 'Мийка цех', description: 'Підтримує чистоту і порядок у кондитерському цеху.', tone: 'violet', lane: 'support', parentId: null, stack: 'pastry', order: 152, meta: 'санітарія' },
    { id: 'technical_staff', title: 'Технічний персонал', description: 'Технічна готовність простору, ремонт, обладнання і господарські задачі.', tone: 'violet', lane: 'support', parentId: null, stack: 'technical', order: 160, meta: 'інфраструктура' },
    { id: 'wardrobe', title: 'Гардероб', description: 'Одяг гостей, контроль речей і порядок у гардеробній зоні.', tone: 'violet', lane: 'support', parentId: null, stack: 'technical', order: 161, meta: 'гості' },
    { id: 'cleaning', title: 'Прибирання', description: 'Чистота залу, санвузлів, службових зон і підтримка стандартів протягом дня.', tone: 'violet', lane: 'support', parentId: null, stack: 'technical', order: 162, meta: 'чистота' },
    { id: 'facilities', title: 'Завгосп', description: 'Господарський запас, дрібний ремонт, закупки і побутова підтримка.', tone: 'violet', lane: 'support', parentId: null, stack: 'technical', order: 163, meta: 'господарство' }
];

let companyStructureNodes = [];
let companyStructureLoaded = false;
let companyStructureUpdatedAt = null;
let selectedCompanyStructureNodeId = 'director';
let companyOrgLinkingNodeId = null;
let companyOrgLinkingEndpoint = null;
let companyOrgLinkPointer = null;
let companyOrgDragState = null;
let companyOrgSaveTimer = null;
let companyOrgKeyboardBound = false;
let companyOrgSuppressNextClick = false;

function setCompanyOrgLinkMode(nodeId, endpoint = 'child') {
    companyOrgLinkingNodeId = nodeId || null;
    companyOrgLinkingEndpoint = companyOrgLinkingNodeId ? (endpoint === 'parent' ? 'parent' : 'child') : null;
    companyOrgLinkPointer = null;
    const stage = document.getElementById('companyOrgChart');
    stage?.classList.toggle('is-linking', Boolean(companyOrgLinkingNodeId));
    document.querySelectorAll('[data-org-node-shell]').forEach(shell => {
        const isOrigin = shell.dataset.orgNodeShell === companyOrgLinkingNodeId;
        shell.classList.toggle('is-link-source', isOrigin);
        shell.classList.toggle('is-link-parent-origin', isOrigin && companyOrgLinkingEndpoint === 'parent');
        shell.classList.toggle('is-link-child-origin', isOrigin && companyOrgLinkingEndpoint === 'child');
    });
    updateCompanyOrgLinkStatus();
    renderCompanyOrgLinks();
}

function cloneCompanyStructureNodes(nodes) {
    return (nodes || []).map(node => ({ ...node }));
}

function normalizeCompanyStructureNodeId(value, fallback) {
    return String(value || fallback || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 64) || fallback;
}

function clampCompanyOrgCoord(value, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.min(max, Math.round(numeric)));
}

function snapCompanyOrgCoord(value, max = 5000) {
    const coord = clampCompanyOrgCoord(value, max);
    if (coord === null) return null;
    return Math.max(0, Math.min(max, Math.round(coord / ORG_GRID_STEP) * ORG_GRID_STEP));
}

function companyOrgNodeSize(node = {}) {
    return node.tone === 'gold'
        ? { width: ORG_ROOT_NODE_WIDTH, height: ORG_ROOT_NODE_HEIGHT }
        : { width: ORG_NODE_WIDTH, height: ORG_NODE_HEIGHT };
}

function companyOrgDefaultPosition(node, index) {
    if (node?.id && DEFAULT_COMPANY_STRUCTURE_POSITIONS[node.id]) {
        return DEFAULT_COMPANY_STRUCTURE_POSITIONS[node.id];
    }
    const laneIndex = Math.max(0, ORG_ALLOWED_LANES.indexOf(node?.lane || 'leadership'));
    const column = index % 6;
    const row = Math.floor(index / 6);
    return {
        x: 80 + column * 190,
        y: 80 + laneIndex * 170 + row * 110
    };
}

function normalizeCompanyStructureNodes(nodes) {
    const source = Array.isArray(nodes) && nodes.length ? nodes : DEFAULT_COMPANY_STRUCTURE_NODES;
    const seen = new Set();
    const normalized = source.map((node, index) => {
        const raw = node && typeof node === 'object' ? node : {};
        const baseId = normalizeCompanyStructureNodeId(raw.id, `node_${index + 1}`);
        let id = baseId;
        const suffixBase = (baseId || `node_${index + 1}`).slice(0, 58);
        let suffix = 2;
        while (seen.has(id)) {
            id = `${suffixBase}_${suffix}`.slice(0, 64);
            suffix += 1;
        }
        seen.add(id);
        const tone = ORG_ALLOWED_TONES.includes(raw.tone) ? raw.tone : 'blue';
        const lane = ORG_ALLOWED_LANES.includes(raw.lane) ? raw.lane : 'leadership';
        const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : index;
        const fallbackPosition = companyOrgDefaultPosition({ id, lane, tone }, index);
        return {
            id,
            title: String(raw.title || 'Роль').trim().slice(0, 80) || 'Роль',
            description: String(raw.description || 'Роль у структурі компанії.').trim().slice(0, 1200),
            tone,
            lane,
            parentId: raw.parentId ? normalizeCompanyStructureNodeId(raw.parentId, '') : null,
            stack: raw.stack ? String(raw.stack).trim().slice(0, 64) : null,
            order,
            x: clampCompanyOrgCoord(raw.x, 5000) ?? fallbackPosition.x,
            y: clampCompanyOrgCoord(raw.y, 5000) ?? fallbackPosition.y,
            meta: raw.meta ? String(raw.meta).trim().slice(0, 80) : null
        };
    });
    const ids = new Set(normalized.map(node => node.id));
    const byId = new Map(normalized.map(node => [node.id, node]));
    return normalized.map((node, index) => {
        const fallbackPosition = companyOrgDefaultPosition(node, index);
        let parentId = node.parentId && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
        const visited = new Set([node.id]);
        let cursor = parentId;
        while (cursor) {
            if (visited.has(cursor)) {
                parentId = null;
                break;
            }
            visited.add(cursor);
            cursor = byId.get(cursor)?.parentId || null;
        }
        return {
            ...node,
            parentId,
            x: clampCompanyOrgCoord(node.x, 5000) ?? fallbackPosition.x,
            y: clampCompanyOrgCoord(node.y, 5000) ?? fallbackPosition.y
        };
    });
}

function sortCompanyStructureNodes(nodes) {
    return [...(nodes || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.title).localeCompare(String(b.title), 'uk'));
}

function compareCompanyOrgAutoLayoutNodes(a, b) {
    const laneDelta = (ORG_AUTO_LAYOUT_LANE_RANK[a?.lane] ?? 99) - (ORG_AUTO_LAYOUT_LANE_RANK[b?.lane] ?? 99);
    if (laneDelta) return laneDelta;
    const stackDelta = String(a?.stack || '').localeCompare(String(b?.stack || ''), 'uk');
    if (stackDelta) return stackDelta;
    return (Number(a?.order) || 0) - (Number(b?.order) || 0) || String(a?.title || '').localeCompare(String(b?.title || ''), 'uk');
}

function sortCompanyOrgAutoLayoutNodes(nodes) {
    return [...(nodes || [])].sort(compareCompanyOrgAutoLayoutNodes);
}

function companyStructureNodeById(id) {
    return companyStructureNodes.find(node => node.id === id) || null;
}

function companyStructureChildrenOf(parentId) {
    return sortCompanyStructureNodes(companyStructureNodes.filter(node => node.parentId === parentId));
}

function companyStructureNodesByLane(lane) {
    return sortCompanyStructureNodes(companyStructureNodes.filter(node => node.lane === lane));
}

function companyStructureTextFromNodes(nodes) {
    const byId = new Map((nodes || []).map(node => [node.id, node]));
    return sortCompanyStructureNodes(nodes).map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : null;
        return parent ? `${node.title} <- ${parent.title}` : node.title;
    }).join('\n');
}

function syncCompanyStructureText() {
    const structureText = document.getElementById('companyStructureText');
    if (structureText) {
        structureText.value = companyStructureTextFromNodes(companyStructureNodes) || DEFAULT_COMPANY_STRUCTURE_TEXT;
    }
}

function companyOrgStageSizeForNodes(nodes) {
    const bounds = (nodes || []).reduce((max, node) => {
        const size = companyOrgNodeSize(node);
        return {
            width: Math.max(max.width, Number(node.x || 0) + size.width + ORG_CANVAS_PADDING),
            height: Math.max(max.height, Number(node.y || 0) + size.height + ORG_CANVAS_PADDING)
        };
    }, { width: ORG_CANVAS_MIN_WIDTH, height: ORG_CANVAS_MIN_HEIGHT });
    return {
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height)
    };
}

function companyOrgStageSize() {
    return companyOrgStageSizeForNodes(companyStructureNodes);
}

function companyOrgNeedsOneScreenLayout(nodes) {
    const { width, height } = companyOrgStageSizeForNodes(nodes);
    return width > ORG_ONE_SCREEN_MAX_WIDTH || height > ORG_ONE_SCREEN_MAX_HEIGHT;
}

function compactCompanyOrgNodesForOneScreen(nodes) {
    const normalized = normalizeCompanyStructureNodes(nodes);
    return companyOrgNeedsOneScreenLayout(normalized)
        ? autoArrangeTreeCompanyOrgNodes(normalized)
        : normalized;
}

function companyOrgNodeAnchor(node, edge = 'center') {
    const size = companyOrgNodeSize(node);
    const x = Number(node.x || 0);
    const y = Number(node.y || 0);
    if (edge === 'top') return { x: x + size.width / 2, y };
    if (edge === 'bottom') return { x: x + size.width / 2, y: y + size.height };
    return { x: x + size.width / 2, y: y + size.height / 2 };
}

function companyOrgLinkPath(parent, child) {
    const start = companyOrgNodeAnchor(parent, 'bottom');
    const end = companyOrgNodeAnchor(child, 'top');
    return companyOrgFloatingLinkPath(start, end);
}

function companyOrgFloatingLinkPath(start, end) {
    const midY = Math.round((start.y + end.y) / 2);
    return `M ${Math.round(start.x)} ${Math.round(start.y)} C ${Math.round(start.x)} ${midY}, ${Math.round(end.x)} ${midY}, ${Math.round(end.x)} ${Math.round(end.y)}`;
}

function companyOrgPreviewLinkPath() {
    if (!companyOrgLinkingNodeId || !companyOrgLinkingEndpoint) return '';
    const origin = companyStructureNodeById(companyOrgLinkingNodeId);
    if (!origin) return '';
    const edge = companyOrgLinkingEndpoint === 'parent' ? 'bottom' : 'top';
    const start = companyOrgNodeAnchor(origin, edge);
    const fallbackY = companyOrgLinkingEndpoint === 'parent' ? start.y + 180 : start.y - 180;
    const end = companyOrgLinkPointer || { x: start.x, y: Math.max(0, fallbackY) };
    return companyOrgFloatingLinkPath(start, end);
}

function renderCompanyOrgLinks() {
    const stage = document.getElementById('companyOrgChart');
    const layer = stage?.querySelector('.hr-org-link-layer');
    if (!stage || !layer) return;
    const { width, height } = companyOrgStageSize();
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    const byId = new Map(companyStructureNodes.map(node => [node.id, node]));
    const linkHtml = companyStructureNodes.map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : null;
        if (!parent) return '';
        const active = node.id === selectedCompanyStructureNodeId || parent.id === selectedCompanyStructureNodeId ? ' is-active' : '';
        const path = companyOrgLinkPath(parent, node);
        return `
            <g class="hr-org-link-group${active}" tabindex="0" role="button" data-org-link-child="${escapeHtml(node.id)}" aria-label="Лінія: ${escapeHtml(parent.title)} керує ${escapeHtml(node.title)}">
                <path class="hr-org-link-hit" d="${path}"></path>
                <path class="hr-org-link${active}" d="${path}"></path>
            </g>`;
    }).join('');
    const previewPath = companyOrgPreviewLinkPath();
    const previewHtml = previewPath ? `<path class="hr-org-link-preview" d="${previewPath}"></path>` : '';
    layer.innerHTML = `${linkHtml}${previewHtml}`;
    layer.querySelectorAll('[data-org-link-child]').forEach(link => {
        const activate = () => {
            const child = companyStructureNodeById(link.dataset.orgLinkChild);
            if (child) selectCompanyOrgNodeById(child.id);
        };
        link.addEventListener('click', activate);
        link.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            activate();
        });
    });
}

function renderCompanyOrgNode(node) {
    const tone = ORG_ALLOWED_TONES.includes(node.tone) ? node.tone : 'blue';
    const meta = node.meta || ORG_TONE_LABELS[tone] || '';
    const active = node.id === selectedCompanyStructureNodeId ? ' is-active' : '';
    const linking = node.id === companyOrgLinkingNodeId
        ? ` is-link-source${companyOrgLinkingEndpoint === 'parent' ? ' is-link-parent-origin' : ' is-link-child-origin'}`
        : '';
    const lane = ORG_ALLOWED_LANES.includes(node.lane) ? node.lane : 'leadership';
    const size = companyOrgNodeSize(node);
    const description = String(node.description || '').trim();
    return `
        <span class="hr-org-node-shell${linking}" data-org-node-shell="${escapeHtml(node.id)}" data-org-lane="${escapeHtml(lane)}" style="left:${Number(node.x || 0)}px;top:${Number(node.y || 0)}px;width:${size.width}px;height:${size.height}px;">
            <button type="button" class="hr-org-port hr-org-port--child" data-org-link-child-port="${escapeHtml(node.id)}" aria-label="Точка підпорядкування для ${escapeHtml(node.title)}" title="Ця роль підпорядковується"></button>
            <button type="button" class="hr-org-node hr-org-node--${tone} hr-org-node--lane-${lane}${active}" data-org-node-id="${escapeHtml(node.id)}" aria-label="${escapeHtml(node.title)}. Перетягніть, щоб змінити місце.">
                <span class="hr-org-node-lane">${escapeHtml(ORG_LANE_LABELS[lane] || 'Роль')}</span>
                <span class="hr-org-node-title">${escapeHtml(node.title)}</span>
                <span class="hr-org-node-meta">${escapeHtml(meta)}</span>
                ${description ? `<span class="hr-org-node-description">${escapeHtml(description)}</span>` : ''}
            </button>
            <button type="button" class="hr-org-port hr-org-port--parent" data-org-link-parent-port="${escapeHtml(node.id)}" aria-label="Точка керівника для ${escapeHtml(node.title)}" title="Ця роль керує іншою"></button>
            <button type="button" class="hr-org-node-edit" data-org-edit="${escapeHtml(node.id)}" aria-label="Редагувати ${escapeHtml(node.title)}">Ред.</button>
        </span>`;
}

function bindCompanyOrgChartEvents(stage) {
    stage.querySelectorAll('[data-org-node-id]').forEach(node => {
        node.addEventListener('click', event => {
            if (companyOrgSuppressNextClick) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const nodeId = node.dataset.orgNodeId;
            if (companyOrgLinkingNodeId) {
                event.preventDefault();
                event.stopPropagation();
                selectCompanyOrgNodeById(nodeId);
                if (typeof showNotification === 'function') {
                    showNotification('Щоб змінити керівника, натисніть верхню точку потрібної ролі. Esc — скасувати.', 'info');
                }
                return;
            }
            selectCompanyOrgNodeById(nodeId);
        });
        node.addEventListener('pointerdown', event => startCompanyOrgDrag(event, node.dataset.orgNodeId));
    });
    stage.querySelectorAll('[data-org-edit]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            openCompanyOrgNodeEditor(button.dataset.orgEdit);
        });
    });
    stage.querySelectorAll('[data-org-link-child-port]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            handleCompanyOrgPortClick('child', button.dataset.orgLinkChildPort, event);
        });
    });
    stage.querySelectorAll('[data-org-link-parent-port]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            handleCompanyOrgPortClick('parent', button.dataset.orgLinkParentPort, event);
        });
    });
    stage.addEventListener('mousemove', updateCompanyOrgLinkPointer);
    stage.addEventListener('click', event => {
        if (!companyOrgLinkingNodeId) return;
        if (event.target.closest?.('[data-org-node-shell], [data-org-link-child-port], [data-org-link-parent-port], [data-org-edit], [data-org-link-child]')) return;
        cancelCompanyOrgLinkMode();
    });
}

function renderCompanyOrgChart() {
    const stage = document.getElementById('companyOrgChart');
    if (!stage) return;
    if (!companyStructureNodes.length) {
        companyStructureNodes = cloneCompanyStructureNodes(DEFAULT_COMPANY_STRUCTURE_NODES);
    }
    companyStructureNodes = compactCompanyOrgNodesForOneScreen(companyStructureNodes);
    const { width, height } = companyOrgStageSize();
    stage.style.width = `${width}px`;
    stage.style.minHeight = `${height}px`;
    stage.classList.toggle('is-linking', Boolean(companyOrgLinkingNodeId));
    stage.innerHTML = companyStructureNodes.length ? `
        <svg class="hr-org-link-layer" role="group" aria-label="Лінії підпорядкування" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>
        <div class="hr-org-node-plane">
            ${sortCompanyStructureNodes(companyStructureNodes).map(renderCompanyOrgNode).join('')}
        </div>
    ` : '<div class="hr-org-loading">Немає вузлів структури</div>';
    bindCompanyOrgChartEvents(stage);
    renderCompanyOrgLinks();
    updateCompanyOrgLinkStatus();
    bindCompanyOrgKeyboard();
}

function focusCompanyOrgCanvasOnNode(nodeId) {
    const stage = document.getElementById('companyOrgChart');
    const canvas = stage?.closest?.('.hr-org-canvas');
    const node = companyStructureNodeById(nodeId);
    if (!canvas || !node) return;
    const size = companyOrgNodeSize(node);
    const nextLeft = Math.max(0, Number(node.x || 0) + size.width / 2 - canvas.clientWidth / 2);
    const nextTop = Math.max(0, Number(node.y || 0) - 36);
    canvas.scrollLeft = nextLeft;
    canvas.scrollTop = nextTop;
}

function startCompanyOrgDrag(event, nodeId) {
    if (!nodeId || event.button !== 0 || event.target.closest('[data-org-edit], [data-org-link-child-port], [data-org-link-parent-port]')) return;
    if (companyOrgLinkingNodeId) {
        setCompanyOrgLinkMode(null);
    }
    const node = companyStructureNodeById(nodeId);
    const shell = event.currentTarget.closest('[data-org-node-shell]');
    if (!node || !shell) return;
    selectCompanyOrgNodeById(nodeId);
    event.preventDefault();
    companyOrgDragState = {
        nodeId,
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startX: Number(node.x || 0),
        startY: Number(node.y || 0),
        moved: false,
        shell
    };
    shell.classList.add('is-dragging');
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', moveCompanyOrgDrag);
    window.addEventListener('pointerup', endCompanyOrgDrag, { once: true });
    window.addEventListener('pointercancel', cancelCompanyOrgDrag, { once: true });
}

function moveCompanyOrgDrag(event) {
    if (!companyOrgDragState) return;
    const node = companyStructureNodeById(companyOrgDragState.nodeId);
    if (!node) return;
    const dx = event.clientX - companyOrgDragState.startPointerX;
    const dy = event.clientY - companyOrgDragState.startPointerY;
    const nextX = snapCompanyOrgCoord(companyOrgDragState.startX + dx, 5000) ?? 0;
    const nextY = snapCompanyOrgCoord(companyOrgDragState.startY + dy, 5000) ?? 0;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) companyOrgDragState.moved = true;
    node.x = nextX;
    node.y = nextY;
    companyOrgDragState.shell.style.left = `${nextX}px`;
    companyOrgDragState.shell.style.top = `${nextY}px`;
    renderCompanyOrgLinks();
}

function endCompanyOrgDrag() {
    if (!companyOrgDragState) return;
    const moved = companyOrgDragState.moved;
    companyOrgDragState.shell?.classList.remove('is-dragging');
    companyOrgDragState = null;
    window.removeEventListener('pointermove', moveCompanyOrgDrag);
    window.removeEventListener('pointercancel', cancelCompanyOrgDrag);
    if (moved) {
        companyOrgSuppressNextClick = true;
        window.setTimeout(() => {
            companyOrgSuppressNextClick = false;
        }, 0);
        syncCompanyStructureText();
        scheduleCompanyStructureAutosave();
    }
}

function cancelCompanyOrgDrag() {
    if (!companyOrgDragState) return;
    companyOrgDragState.shell?.classList.remove('is-dragging');
    companyOrgDragState = null;
    window.removeEventListener('pointermove', moveCompanyOrgDrag);
    window.removeEventListener('pointercancel', cancelCompanyOrgDrag);
}

function scheduleCompanyStructureAutosave() {
    window.clearTimeout(companyOrgSaveTimer);
    companyOrgSaveTimer = window.setTimeout(() => {
        saveCompanyStructure({ silent: true, preserveRender: true });
    }, 650);
}

function companyOrgWouldCreateCycle(childId, parentId) {
    if (!childId || !parentId) return false;
    let cursor = parentId;
    const guard = new Set();
    while (cursor && !guard.has(cursor)) {
        if (cursor === childId) return true;
        guard.add(cursor);
        cursor = companyStructureNodeById(cursor)?.parentId;
    }
    return false;
}

function updateCompanyOrgLinkPointer(event) {
    if (!companyOrgLinkingNodeId) return;
    const stage = document.getElementById('companyOrgChart');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    companyOrgLinkPointer = {
        x: Math.max(0, event.clientX - rect.left),
        y: Math.max(0, event.clientY - rect.top)
    };
    renderCompanyOrgLinks();
}

function startCompanyOrgPortLink(endpoint, nodeId) {
    const node = companyStructureNodeById(nodeId);
    if (!node) return;
    selectedCompanyStructureNodeId = node.id;
    setCompanyOrgLinkMode(node.id, endpoint);
    selectCompanyOrgNodeById(node.id);
    if (typeof showNotification === 'function') {
        const next = endpoint === 'parent'
            ? 'натисніть верхній кружок ролі, яка буде підпорядкована'
            : 'натисніть нижній кружок ролі-керівника';
        showNotification(`Лінія почалась від "${node.title}": ${next}. Esc — скасувати.`, 'info');
    }
}

function completeCompanyOrgLinkPair(childId, parentId) {
    const child = companyStructureNodeById(childId);
    const parent = companyStructureNodeById(parentId);
    if (!child || !parent) return cancelCompanyOrgLinkMode();
    if (child.id === parent.id) {
        showNotification('Роль не може бути підпорядкована сама собі', 'warning');
        return;
    }
    if (companyOrgWouldCreateCycle(child.id, parent.id)) {
        showNotification('Таке зʼєднання створить цикл у структурі', 'warning');
        return;
    }
    child.parentId = parent.id;
    setCompanyOrgLinkMode(null);
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(child.id);
    saveCompanyStructure({ silent: true, preserveRender: true }).then(saved => {
        if (saved) showNotification(`Лінію створено: ${parent.title} → ${child.title}`, 'success');
    });
}

function handleCompanyOrgPortClick(endpoint, nodeId, event = null) {
    if (event) updateCompanyOrgLinkPointer(event);
    if (!companyOrgLinkingNodeId) {
        startCompanyOrgPortLink(endpoint, nodeId);
        return;
    }
    if (companyOrgLinkingNodeId === nodeId && companyOrgLinkingEndpoint === endpoint) {
        cancelCompanyOrgLinkMode();
        return;
    }
    if (companyOrgLinkingEndpoint === endpoint) {
        startCompanyOrgPortLink(endpoint, nodeId);
        return;
    }
    const childId = endpoint === 'child' ? nodeId : companyOrgLinkingNodeId;
    const parentId = endpoint === 'parent' ? nodeId : companyOrgLinkingNodeId;
    completeCompanyOrgLinkPair(childId, parentId);
}

function startCompanyOrgLinkMode(nodeId = selectedCompanyStructureNodeId) {
    startCompanyOrgPortLink('child', nodeId);
}

function cancelCompanyOrgLinkMode(options = {}) {
    if (!companyOrgLinkingNodeId) return;
    const selectedId = selectedCompanyStructureNodeId;
    setCompanyOrgLinkMode(null);
    if (options.render !== false) {
        renderCompanyOrgChart();
        selectCompanyOrgNodeById(selectedId);
    }
}

function completeCompanyOrgLink(parentId) {
    const childId = companyOrgLinkingNodeId;
    if (!childId) return;
    if (companyOrgLinkingEndpoint === 'parent') {
        return completeCompanyOrgLinkPair(parentId, companyOrgLinkingNodeId);
    }
    completeCompanyOrgLinkPair(childId, parentId);
}

function clearSelectedCompanyOrgParent() {
    const node = companyStructureNodeById(selectedCompanyStructureNodeId);
    if (!node || !node.parentId) return;
    node.parentId = null;
    setCompanyOrgLinkMode(null);
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(node.id);
    saveCompanyStructure({ silent: true, preserveRender: true }).then(saved => {
        if (saved) showNotification('Лінію прибрано', 'success');
    });
}

function companyOrgNodeRect(node) {
    const size = companyOrgNodeSize(node);
    return {
        x: Number(node.x || 0),
        y: Number(node.y || 0),
        width: size.width,
        height: size.height
    };
}

function companyOrgRectsOverlap(a, b) {
    return a.x < b.x + b.width + ORG_COLLISION_PADDING_X
        && a.x + a.width + ORG_COLLISION_PADDING_X > b.x
        && a.y < b.y + b.height + ORG_COLLISION_PADDING_Y
        && a.y + a.height + ORG_COLLISION_PADDING_Y > b.y;
}

function resolveCompanyOrgNodeOverlaps(nodes) {
    const sorted = sortCompanyStructureNodes(nodes).map(node => ({ ...node }));
    const placed = [];
    sorted.forEach(node => {
        let guard = 0;
        let rect = companyOrgNodeRect(node);
        while (placed.some(item => companyOrgRectsOverlap(rect, item.rect)) && guard < sorted.length * 3) {
            const offender = placed.find(item => companyOrgRectsOverlap(rect, item.rect));
            if (!offender) break;
            const sameBand = Math.abs(rect.y - offender.rect.y) < Math.max(rect.height, offender.rect.height) + ORG_COLLISION_PADDING_Y;
            if (sameBand) {
                node.x = snapCompanyOrgCoord(offender.rect.x + offender.rect.width + ORG_COLLISION_PADDING_X, 5000) ?? node.x;
            } else {
                node.y = snapCompanyOrgCoord(offender.rect.y + offender.rect.height + ORG_COLLISION_PADDING_Y, 5000) ?? node.y;
            }
            rect = companyOrgNodeRect(node);
            guard += 1;
        }
        placed.push({ node, rect });
    });
    return sortCompanyStructureNodes(sorted);
}

function autoArrangeFlatCompanyOrgNodes(nodes) {
    const sorted = sortCompanyStructureNodes(nodes);
    const columns = Math.max(2, Math.min(6, Math.ceil(Math.sqrt(sorted.length * 1.35))));
    return resolveCompanyOrgNodeOverlaps(sorted.map((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
            ...node,
            x: snapCompanyOrgCoord(ORG_CANVAS_PADDING + column * 260),
            y: snapCompanyOrgCoord(ORG_CANVAS_PADDING + row * 180)
        };
    }));
}

function companyOrgHasCycleInMap(byId, childId, parentId) {
    if (!childId || !parentId || childId === parentId) return true;
    let cursor = parentId;
    const guard = new Set();
    while (cursor && !guard.has(cursor)) {
        if (cursor === childId) return true;
        guard.add(cursor);
        cursor = byId.get(cursor)?.parentId || null;
    }
    return false;
}

function primaryCompanyOrgRoot(nodes, byId = new Map((nodes || []).map(node => [node.id, node]))) {
    const sorted = sortCompanyOrgAutoLayoutNodes(nodes || []);
    return byId.get('director')
        || sorted.find(node => node.lane === 'root')
        || sorted.find(node => node.tone === 'gold')
        || sorted[0]
        || null;
}

function preferredCompanyOrgParentId(node, byId, primaryRoot) {
    if (!node || !byId?.size) return null;
    const rootId = primaryRoot?.id || null;
    if (node.id === rootId) return null;
    const candidates = [
        ORG_AUTO_PARENT_BY_ID[node.id],
        node.stack ? ORG_AUTO_STACK_PARENT_BY_STACK[node.stack] : null,
        node.lane === 'deputy' ? 'director' : null,
        node.lane === 'leadership' ? 'deputy_director' : null,
        node.lane === 'operations' ? 'deputy_director' : null,
        node.lane === 'support' ? 'deputy_director' : null,
        rootId
    ].filter(Boolean);
    return candidates.find(parentId => parentId !== node.id && byId.has(parentId)) || null;
}

function inferCompanyOrgAutoLayoutParents(nodes) {
    const next = normalizeCompanyStructureNodes(nodes).map(node => ({ ...node }));
    const byId = new Map(next.map(node => [node.id, node]));
    const primaryRoot = primaryCompanyOrgRoot(next, byId);
    sortCompanyOrgAutoLayoutNodes(next).forEach(node => {
        if (!node || node.id === primaryRoot?.id) {
            if (node) node.parentId = null;
            return;
        }
        if (node.parentId && byId.has(node.parentId) && node.parentId !== node.id) return;
        const parentId = preferredCompanyOrgParentId(node, byId, primaryRoot);
        if (!parentId || companyOrgHasCycleInMap(byId, node.id, parentId)) return;
        node.parentId = parentId;
    });
    return normalizeCompanyStructureNodes(next);
}

function autoArrangeTreeCompanyOrgNodes(nodes) {
    const normalized = inferCompanyOrgAutoLayoutParents(nodes);
    const byId = new Map(normalized.map(node => [node.id, node]));
    const children = new Map();
    normalized.forEach(node => children.set(node.id, []));
    normalized.forEach(node => {
        if (node.parentId && byId.has(node.parentId)) {
            children.get(node.parentId)?.push(node);
        }
    });
    children.forEach(list => list.sort(compareCompanyOrgAutoLayoutNodes));
    const primaryRoot = primaryCompanyOrgRoot(normalized, byId);
    const roots = sortCompanyOrgAutoLayoutNodes(normalized.filter(node => !node.parentId || !byId.has(node.parentId)));
    if (primaryRoot) {
        roots.sort((a, b) => (a.id === primaryRoot.id ? -1 : 0) + (b.id === primaryRoot.id ? 1 : 0));
    }
    const hasAnyLink = normalized.some(node => node.parentId && byId.has(node.parentId));
    if (!hasAnyLink) return autoArrangeFlatCompanyOrgNodes(normalized);

    const next = normalized.map(node => ({ ...node }));
    const nextById = new Map(next.map(node => [node.id, node]));
    const depthById = new Map();
    const depthGroups = new Map();
    const addToDepth = (node, depth) => {
        if (!node || depthById.has(node.id)) return;
        depthById.set(node.id, depth);
        if (!depthGroups.has(depth)) depthGroups.set(depth, []);
        depthGroups.get(depth).push(node);
        (children.get(node.id) || []).forEach(child => addToDepth(child, depth + 1));
    };
    roots.forEach(root => addToDepth(root, 0));
    sortCompanyOrgAutoLayoutNodes(normalized).forEach(node => {
        if (!depthById.has(node.id)) addToDepth(node, 0);
    });

    let visualRow = 0;
    [...depthGroups.keys()].sort((a, b) => a - b).forEach(depth => {
        const levelNodes = [...(depthGroups.get(depth) || [])].sort((a, b) => {
            const parentA = a.parentId ? nextById.get(a.parentId) : null;
            const parentB = b.parentId ? nextById.get(b.parentId) : null;
            const parentDelta = (Number(parentA?.x) || 0) - (Number(parentB?.x) || 0);
            if (parentDelta) return parentDelta;
            return compareCompanyOrgAutoLayoutNodes(a, b);
        });
        for (let index = 0; index < levelNodes.length; index += ORG_AUTO_LAYOUT_COMPACT_COLUMNS) {
            const chunk = levelNodes.slice(index, index + ORG_AUTO_LAYOUT_COMPACT_COLUMNS);
            const rowWidth = chunk.reduce((sum, node, itemIndex) => {
                return sum + (itemIndex ? ORG_AUTO_LAYOUT_COMPACT_X_GAP : 0) + companyOrgNodeSize(node).width;
            }, 0);
            let cursor = Math.max(ORG_CANVAS_PADDING, Math.round((ORG_CANVAS_MIN_WIDTH - rowWidth) / 2));
            chunk.forEach((node, itemIndex) => {
                const target = nextById.get(node.id);
                const size = companyOrgNodeSize(node);
                if (!target) return;
                if (itemIndex) cursor += ORG_AUTO_LAYOUT_COMPACT_X_GAP;
                target.x = snapCompanyOrgCoord(cursor);
                target.y = snapCompanyOrgCoord(ORG_CANVAS_PADDING + visualRow * ORG_AUTO_LAYOUT_ROW_GAP);
                cursor += size.width;
            });
            visualRow += 1;
        }
    });
    return sortCompanyStructureNodes(next);
}

function autoArrangeCompanyOrgChart() {
    companyStructureNodes = autoArrangeTreeCompanyOrgNodes(companyStructureNodes);
    setCompanyOrgLinkMode(null);
    syncCompanyStructureText();
    selectedCompanyStructureNodeId = primaryCompanyOrgRoot(companyStructureNodes)?.id || selectedCompanyStructureNodeId;
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    focusCompanyOrgCanvasOnNode(selectedCompanyStructureNodeId);
    saveCompanyStructure({ silent: true, preserveRender: true }).then(saved => {
        if (saved) showNotification('Структуру впорядковано', 'success');
    });
}

function updateCompanyOrgLinkStatus() {
    const status = document.getElementById('hrOrgLinkStatus');
    if (status) {
        if (companyOrgLinkingNodeId) {
            const source = companyStructureNodeById(companyOrgLinkingNodeId);
            const next = companyOrgLinkingEndpoint === 'parent'
                ? 'натисніть верхній кружок ролі, яка буде підпорядкована'
                : 'натисніть нижній кружок ролі-керівника';
            status.textContent = source ? `Лінія від "${source.title}": ${next}. Esc — скасувати.` : 'Натисніть другий кружок або Esc';
            status.classList.add('is-active');
        } else {
            status.textContent = 'Лінії не вмикаються кнопками: натисніть кружок на одній картці, потім кружок на іншій.';
            status.classList.remove('is-active');
        }
    }
}

function bindCompanyOrgKeyboard() {
    if (companyOrgKeyboardBound) return;
    companyOrgKeyboardBound = true;
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && companyOrgLinkingNodeId) {
            cancelCompanyOrgLinkMode();
        }
    });
}

function ensureCompanyOrgDetailMeta() {
    let meta = document.getElementById('hrOrgDetailMeta');
    const title = document.getElementById('hrOrgDetailTitle');
    if (!meta && title) {
        meta = document.createElement('div');
        meta.id = 'hrOrgDetailMeta';
        meta.className = 'hr-org-detail-meta';
        title.insertAdjacentElement('afterend', meta);
    }
    return meta;
}

function updateCompanyOrgDetail(node) {
    const title = document.getElementById('hrOrgDetailTitle');
    const text = document.getElementById('hrOrgDetailText');
    const meta = ensureCompanyOrgDetailMeta();
    const editButton = document.getElementById('hrOrgEditSelectedBtn');
    if (title) title.textContent = node?.title || 'Роль';
    if (text) text.textContent = node?.description || 'Роль у структурі компанії.';
    if (meta) {
        const parent = node?.parentId ? companyStructureNodeById(node.parentId) : null;
        const childCount = node ? companyStructureChildrenOf(node.id).length : 0;
        meta.innerHTML = node ? `
            <span>${escapeHtml(ORG_LANE_LABELS[node.lane] || 'Рівень')}</span>
            <span>${escapeHtml(ORG_TONE_LABELS[node.tone] || 'Тип')}</span>
            ${parent ? `<span>Підпорядкування: ${escapeHtml(parent.title)}</span>` : '<span>Кореневий вузол</span>'}
            <span>Дочірніх: ${childCount}</span>
            <span>Сітка: ${Math.round(Number(node.x || 0))}, ${Math.round(Number(node.y || 0))}</span>
        ` : '';
    }
    if (editButton) {
        editButton.disabled = !node;
        editButton.onclick = () => node && openCompanyOrgNodeEditor(node.id);
    }
    updateCompanyOrgLinkStatus();
}

function selectCompanyOrgNodeById(id) {
    const node = companyStructureNodeById(id) || companyStructureNodes[0] || null;
    if (!node) return;
    selectedCompanyStructureNodeId = node.id;
    document.querySelectorAll('.hr-org-node.is-active').forEach(item => item.classList.remove('is-active'));
    document.querySelectorAll('[data-org-node-id]').forEach(item => {
        if (item.dataset.orgNodeId === node.id) item.classList.add('is-active');
    });
    updateCompanyOrgDetail(node);
    renderCompanyOrgLinks();
}

function selectCompanyOrgNode(node) {
    const id = typeof node === 'string' ? node : node?.dataset?.orgNodeId;
    selectCompanyOrgNodeById(id);
}

function closeCompanyOrgNodeEditor() {
    document.getElementById('hrOrgNodeEditorOverlay')?.remove();
}

async function requestCloseCompanyOrgNodeEditor(reason = 'button') {
    const overlay = document.getElementById('hrOrgNodeEditorOverlay');
    if (!overlay) return true;
    const closeNow = () => closeCompanyOrgNodeEditor();
    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
            reason,
            message: 'Є незбережені зміни у ролі. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    closeNow();
    return true;
}

function nudgeCompanyOrgNodeEditor(overlay) {
    const dialog = overlay?.querySelector('.hr-org-node-modal');
    if (!dialog) return;
    dialog.classList.remove('is-dismiss-attention');
    void dialog.offsetWidth;
    dialog.classList.add('is-dismiss-attention');
    window.setTimeout(() => dialog.classList.remove('is-dismiss-attention'), 240);
    overlay.querySelector('input[name="title"]')?.focus();
}

function companyOrgNodeEditorOptions(source, selectedValue, labels) {
    return source.map(value => `<option value="${escapeHtml(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join('');
}

function openCompanyOrgNodeEditor(nodeId = selectedCompanyStructureNodeId) {
    const node = companyStructureNodeById(nodeId);
    if (!node) return;
    closeCompanyOrgNodeEditor();
    const parentNode = node.parentId ? companyStructureNodeById(node.parentId) : null;
    const childCount = companyStructureChildrenOf(node.id).length;
    const parentOptions = [
        '<option value="">Без батьківського вузла</option>',
        ...sortCompanyStructureNodes(companyStructureNodes)
            .filter(item => item.id !== node.id)
            .map(item => `<option value="${escapeHtml(item.id)}"${item.id === node.parentId ? ' selected' : ''}>${escapeHtml(item.title)}</option>`)
    ].join('');
    const overlay = document.createElement('div');
    overlay.id = 'hrOrgNodeEditorOverlay';
    overlay.className = 'candidate-detail-overlay';
    overlay.innerHTML = `
        <div class="candidate-detail-modal hr-org-node-modal" role="dialog" aria-modal="true" aria-labelledby="hrOrgNodeEditorTitle">
            <form id="hrOrgNodeForm" class="hr-org-node-form" data-node-id="${escapeHtml(node.id)}">
                <div class="candidate-detail-head">
                    <div>
                        <div class="candidate-detail-kicker">Оргструктура</div>
                        <h3 id="hrOrgNodeEditorTitle">Редагувати вузол</h3>
                    </div>
                    <button type="button" class="candidate-detail-close" id="hrOrgNodeEditorClose" aria-label="Закрити">×</button>
                </div>
                <label>
                    Назва ролі
                    <input type="text" name="title" maxlength="80" required value="${escapeHtml(node.title)}">
                </label>
                <label>
                    Опис / відповідальність
                    <textarea name="description" rows="4" maxlength="1200">${escapeHtml(node.description)}</textarea>
                </label>
                <div class="hr-org-node-editor-summary" aria-label="Поточний стан вузла">
                    <span>ID: <b>${escapeHtml(node.id)}</b></span>
                    <span>Керівник: <b>${escapeHtml(parentNode?.title || 'немає')}</b></span>
                    <span>Дочірніх ролей: <b>${childCount}</b></span>
                    <span>Позиція на сітці: <b>${Math.round(Number(node.x || 0))}, ${Math.round(Number(node.y || 0))}</b></span>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Візуальний тип
                        <select name="tone">${companyOrgNodeEditorOptions(ORG_ALLOWED_TONES, node.tone, ORG_TONE_LABELS)}</select>
                    </label>
                    <label>
                        Рівень
                        <select name="lane">${companyOrgNodeEditorOptions(ORG_ALLOWED_LANES, node.lane, ORG_LANE_LABELS)}</select>
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Батьківський вузол
                        <select name="parentId">${parentOptions}</select>
                    </label>
                    <label>
                        Порядок
                        <input type="number" name="order" step="1" value="${Number(node.order) || 0}">
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Група / стек
                        <input type="text" name="stack" maxlength="64" value="${escapeHtml(node.stack || '')}" placeholder="Напр. kitchen">
                    </label>
                    <label>
                        Підпис
                        <input type="text" name="meta" maxlength="80" value="${escapeHtml(node.meta || '')}" placeholder="Напр. сервіс">
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        X на полотні
                        <input type="number" name="x" min="0" max="5000" step="${ORG_GRID_STEP}" value="${Math.round(Number(node.x || 0))}">
                    </label>
                    <label>
                        Y на полотні
                        <input type="number" name="y" min="0" max="5000" step="${ORG_GRID_STEP}" value="${Math.round(Number(node.y || 0))}">
                    </label>
                </div>
                <div class="hr-org-node-form-actions">
                    <button type="button" class="btn-secondary" id="hrOrgNodeEditorCancel">Скасувати</button>
                    <button type="submit" class="btn-primary">Зберегти вузол</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => {
        if (event.target !== overlay) return;
        event.preventDefault();
        event.stopPropagation();
        nudgeCompanyOrgNodeEditor(overlay);
    });
    overlay.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        requestCloseCompanyOrgNodeEditor('escape');
    });
    document.getElementById('hrOrgNodeEditorClose')?.addEventListener('click', () => requestCloseCompanyOrgNodeEditor('close-button'));
    document.getElementById('hrOrgNodeEditorCancel')?.addEventListener('click', () => requestCloseCompanyOrgNodeEditor('cancel-button'));
    document.getElementById('hrOrgNodeForm')?.addEventListener('submit', saveCompanyOrgNodeFromEditor);
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(overlay);
    overlay.querySelector('input[name="title"]')?.focus();
}

async function saveCompanyOrgNodeFromEditor(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const nodeId = form.dataset.nodeId;
    const index = companyStructureNodes.findIndex(node => node.id === nodeId);
    if (index === -1) return;
    const formData = new FormData(form);
    const order = Number(formData.get('order'));
    const parentId = String(formData.get('parentId') || '').trim();
    const x = snapCompanyOrgCoord(formData.get('x'), 5000);
    const y = snapCompanyOrgCoord(formData.get('y'), 5000);
    if (parentId && companyOrgWouldCreateCycle(nodeId, parentId)) {
        showNotification('Таке підпорядкування створить цикл у структурі', 'warning');
        return;
    }
    const nextNode = {
        ...companyStructureNodes[index],
        title: String(formData.get('title') || '').trim().slice(0, 80) || 'Роль',
        description: String(formData.get('description') || '').trim().slice(0, 1200) || 'Роль у структурі компанії.',
        tone: ORG_ALLOWED_TONES.includes(String(formData.get('tone'))) ? String(formData.get('tone')) : 'blue',
        lane: ORG_ALLOWED_LANES.includes(String(formData.get('lane'))) ? String(formData.get('lane')) : 'leadership',
        parentId: parentId && parentId !== nodeId ? parentId : null,
        stack: String(formData.get('stack') || '').trim().slice(0, 64) || null,
        order: Number.isFinite(order) ? order : companyStructureNodes[index].order,
        meta: String(formData.get('meta') || '').trim().slice(0, 80) || null,
        x: x ?? companyStructureNodes[index].x,
        y: y ?? companyStructureNodes[index].y
    };
    companyStructureNodes[index] = nextNode;
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    selectedCompanyStructureNodeId = nextNode.id;
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(nextNode.id);
    closeCompanyOrgNodeEditor();
    const saved = await saveCompanyStructure({ silent: true });
    if (saved) showNotification('Вузол структури збережено', 'success');
}

function updateCompanyStructureStatus(updatedAt) {
    const statusEl = document.getElementById('companyStructureStatus');
    if (!statusEl) return;
    statusEl.textContent = updatedAt ? `Оновлено: ${new Date(updatedAt).toLocaleString('uk-UA')}` : '';
}

function initCompanyOrgChart() {
    if (!companyStructureNodes.length) {
        companyStructureNodes = cloneCompanyStructureNodes(DEFAULT_COMPANY_STRUCTURE_NODES);
    }
    const autoButton = document.getElementById('hrOrgAutoLayoutBtn');
    if (autoButton) autoButton.onclick = autoArrangeCompanyOrgChart;
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
}

async function ensureCompanyStructureNodesLoaded(options = {}) {
    if (companyStructureLoaded && !options.force) return companyStructureNodes;
    const data = await hrFetch('/company-structure');
    if (!data?.success) {
        if (!options.silent) showNotification(data?.error || 'Не вдалося завантажити структуру', 'error');
        if (!companyStructureNodes.length) companyStructureNodes = compactCompanyOrgNodesForOneScreen(DEFAULT_COMPANY_STRUCTURE_NODES);
        return companyStructureNodes;
    }
    const structure = data.data || data.structure || {};
    companyStructureNodes = compactCompanyOrgNodesForOneScreen(structure.nodes);
    companyStructureUpdatedAt = structure.updatedAt || null;
    companyStructureLoaded = true;
    return companyStructureNodes;
}

async function loadCompanyStructure() {
    const statusEl = document.getElementById('companyStructureStatus');
    if (statusEl) statusEl.textContent = 'Завантаження...';
    const data = await hrFetch('/company-structure');
    if (!data?.success) {
        if (statusEl) statusEl.textContent = data?.error || 'Не вдалося завантажити структуру';
        return;
    }
    const structure = data.data || data.structure || {};
    const notesText = document.getElementById('companyStructureNotes');
    const instructionsText = document.getElementById('companyInstructionsText');
    const savedStructure = structure.structure || structure.structure_text || '';
    companyStructureNodes = compactCompanyOrgNodesForOneScreen(structure.nodes);
    companyStructureUpdatedAt = structure.updatedAt || null;
    companyStructureLoaded = true;
    const generatedStructure = companyStructureTextFromNodes(companyStructureNodes);
    if (notesText) notesText.value = savedStructure && savedStructure !== DEFAULT_COMPANY_STRUCTURE_TEXT && savedStructure !== generatedStructure ? savedStructure : '';
    if (instructionsText) instructionsText.value = structure.instructions || structure.instructions_text || '';
    syncCompanyStructureText();
    renderCompanyOrgChart();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    updateCompanyStructureStatus(structure.updatedAt);
}

async function saveCompanyStructure(options = {}) {
    const notes = document.getElementById('companyStructureNotes')?.value || '';
    window.clearTimeout(companyOrgSaveTimer);
    syncCompanyStructureText();
    const payload = {
        schemaVersion: 1,
        structure: notes.trim() || document.getElementById('companyStructureText')?.value || DEFAULT_COMPANY_STRUCTURE_TEXT,
        instructions: document.getElementById('companyInstructionsText')?.value || '',
        nodes: normalizeCompanyStructureNodes(companyStructureNodes),
        baseUpdatedAt: companyStructureUpdatedAt
    };
    const data = await hrFetch('/company-structure', {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    if (data?.success) {
        const saved = data.data || payload;
        companyStructureNodes = normalizeCompanyStructureNodes(saved.nodes);
        companyStructureUpdatedAt = saved.updatedAt || null;
        companyStructureLoaded = true;
        syncCompanyStructureText();
        if (!options.preserveRender) {
            renderCompanyOrgChart();
            selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
        } else {
            renderCompanyOrgLinks();
            updateCompanyOrgLinkStatus();
        }
        updateCompanyStructureStatus(saved.updatedAt);
        const stale = data.staleRefsCleared || {};
        const staleCount = Number(stale.staff || 0) + Number(stale.professions || 0);
        if (!options.silent) {
            showNotification(staleCount
                ? `Структуру збережено. Очищено застарілих привʼязок: ${staleCount}`
                : 'Структуру та інструкції збережено', 'success');
        }
        return true;
    }
    if (data?.current?.updatedAt) {
        companyStructureUpdatedAt = data.current.updatedAt;
    }
    showNotification(data?.error || 'Не вдалося зберегти', 'error');
    return false;
}

async function setPoolStatus(staffId, status) {
    let reason = null;
    if (status === 'blacklisted') {
        const result = await formModal('Причина чорного списку', [
            { key: 'reason', label: 'Причина', type: 'textarea', required: true }
        ], { icon: '⚠️', type: 'warning' });
        if (!result?.reason?.trim()) return;
        reason = result.reason.trim();
    }
    const data = await hrFetch(`/staff/${staffId}/pool-status`, {
        method: 'PUT',
        body: JSON.stringify({ status, reason })
    });
    if (data?.success) {
        showNotification('HR-статус оновлено', 'success');
        await loadTeam().catch(() => {});
    } else {
        showNotification(data?.error || 'Не вдалося оновити статус', 'error');
    }
}

// ==========================================
// TAB 4: REPORTS
// ==========================================

function setReportHeaderMetricText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value === null || value === undefined || value === '' ? '-' : String(value);
}

function reportMetricNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
}

function formatReportPeopleCount(count) {
    const value = reportMetricNumber(count);
    if (value === 1) return '1 людина';
    if (value >= 2 && value <= 4) return `${value} людини`;
    return `${value} людей`;
}

function formatReportRiskCount(count) {
    const value = reportMetricNumber(count);
    if (value === 1) return '1 ризик';
    if (value >= 2 && value <= 4) return `${value} ризики`;
    return `${value} ризиків`;
}

function reportRiskSummaryFromMetrics(metrics = {}) {
    const late = reportMetricNumber(metrics.totalLate);
    const absent = reportMetricNumber(metrics.totalAbsent);
    const overdueTasks = reportMetricNumber(metrics.totalTasksOverdue);
    return {
        late,
        absent,
        overdueTasks,
        total: Math.max(0, late + absent + overdueTasks)
    };
}

function reportHeaderMetricsFromRows(rows = []) {
    const safeRows = Array.isArray(rows) ? rows : [];
    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    let totalOvertime = 0;
    let totalScheduled = 0;
    let totalTasksAssigned = 0;
    let totalTasksDone = 0;
    let totalTasksOverdue = 0;

    for (const row of safeRows) {
        totalPresent += reportMetricNumber(row.days_worked);
        totalLate += reportMetricNumber(row.late_count);
        totalAbsent += reportMetricNumber(row.days_absent);
        totalOvertime += reportMetricNumber(row.total_overtime_hours);
        totalScheduled += reportMetricNumber(row.days_scheduled);
        totalTasksAssigned += reportMetricNumber(row.task_kpi?.tasks_assigned);
        totalTasksDone += reportMetricNumber(row.task_kpi?.tasks_done);
        totalTasksOverdue += reportMetricNumber(row.task_kpi?.tasks_overdue);
    }

    const attendanceRate = totalScheduled > 0 ? Math.round(totalPresent / totalScheduled * 100) : 0;
    const taskDoneRate = totalTasksAssigned > 0 ? Math.round(totalTasksDone / totalTasksAssigned * 100) : 0;

    return {
        staffCount: safeRows.length,
        totalPresent,
        totalLate,
        totalAbsent,
        totalOvertime,
        totalScheduled,
        totalTasksAssigned,
        totalTasksDone,
        totalTasksOverdue,
        attendanceRate,
        taskDoneRate
    };
}

function updateReportHeaderMetrics(metrics = {}) {
    // Reports header chips mirror the monthly rows rendered below: CSV availability, KPI, risks, and people count.
    const staffCount = reportMetricNumber(metrics.staffCount);
    const taskDoneRate = reportMetricNumber(metrics.taskDoneRate);
    const risks = reportRiskSummaryFromMetrics(metrics);

    setReportHeaderMetricText('reportHeroCsv', 'Готовий');
    setReportHeaderMetricText('reportHeroKpi', `${Math.max(0, Math.min(100, taskDoneRate))}%`);
    setReportHeaderMetricText('reportHeroRisks', formatReportRiskCount(risks.total));
    setReportHeaderMetricText('reportHeroSummary', formatReportPeopleCount(staffCount));
}

async function loadReports() {
    setPulseCardBadge('reports', 'CSV', {
        title: 'CSV експорт',
        ariaLabel: 'Звіти доступні для CSV експорту'
    });
    // Fill month selector
    const sel = document.getElementById('reportMonth');
    if (sel.options.length === 0) {
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
            sel.innerHTML += `<option value="${val}">${label}</option>`;
        }
        sel.addEventListener('change', loadReports);
        document.getElementById('reportExport')?.addEventListener('click', exportCSV);
    }

    const month = sel.value;
    const data = await hrFetch(`/report/monthly?month=${month}`);
    if (!data || !data.success) {
        updateReportHeaderMetrics();
        await loadRoleAssignmentsReport();
        return;
    }

    renderReports(data);
    await loadRoleAssignmentsReport();
}

function renderReports(data) {
    setPulseCardBadge('reports', 'CSV', {
        title: 'CSV експорт',
        ariaLabel: 'Звіти доступні для CSV експорту'
    });
    // Summary
    const rows = Array.isArray(data.data) ? data.data : [];
    const metrics = reportHeaderMetricsFromRows(rows);
    const {
        totalLate,
        totalAbsent,
        totalOvertime,
        totalTasksAssigned,
        totalTasksDone,
        totalTasksOverdue,
        attendanceRate,
        taskDoneRate
    } = metrics;
    updateReportHeaderMetrics(metrics);

    document.getElementById('reportSummary').innerHTML = `
        <div class="hr-report-stat hr-report-stat--presence"><div class="stat-value">${attendanceRate}%</div><div class="stat-label">Присутність</div></div>
        <div class="hr-report-stat hr-report-stat--late"><div class="stat-value">${totalLate}</div><div class="stat-label">Запізнень</div></div>
        <div class="hr-report-stat hr-report-stat--absence"><div class="stat-value">${totalAbsent}</div><div class="stat-label">Відсутностей</div></div>
        <div class="hr-report-stat hr-report-stat--overtime"><div class="stat-value">${totalOvertime.toFixed(0)}г</div><div class="stat-label">Переробка</div></div>
        <div class="hr-report-stat hr-report-stat--tasks"><div class="stat-value">${totalTasksDone}/${totalTasksAssigned}</div><div class="stat-label">Задачі виконано</div></div>
        <div class="hr-report-stat hr-report-stat--kpi"><div class="stat-value">${taskDoneRate}%</div><div class="stat-label">KPI задач</div></div>
        <div class="hr-report-stat hr-report-stat--overdue"><div class="stat-value">${totalTasksOverdue}</div><div class="stat-label">Прострочені</div></div>
    `;

    // Table
    document.getElementById('reportHead').innerHTML = `<tr>
        <th>ПІБ</th><th>Зміни</th><th>Відпрац.</th><th>Запізн.</th>
        <th>Сер. запізн.</th><th>Годин</th><th>Сума</th><th>Задачі</th><th>KPI</th></tr>`;

    document.getElementById('reportBody').innerHTML = rows.map(r => `<tr>
        <td>${escapeHtml(r.staff_name)}</td>
        <td class="num">${r.days_scheduled}</td>
        <td class="num">${r.days_worked}</td>
        <td class="num">${r.late_count}</td>
        <td class="num">${r.avg_late_minutes > 0 ? r.avg_late_minutes + 'хв' : '—'}</td>
        <td class="num">${r.total_worked_hours}г</td>
        <td class="num">${fmtMoney(r.estimated_salary)}</td>
        <td class="num">${r.task_kpi?.tasks_done || 0}/${r.task_kpi?.tasks_assigned || 0}${r.task_kpi?.tasks_overdue ? ` · ${r.task_kpi.tasks_overdue} простр.` : ''}</td>
        <td class="num">${r.task_completion_rate || 0}%</td>
    </tr>`).join('');
}

function roleReportPillClass(value = '') {
    if (['active', 'approved', 'completed'].includes(value)) return 'good';
    if (['pending', 'in_progress'].includes(value)) return 'warn';
    if (['suspended', 'inactive', 'blocked'].includes(value)) return 'bad';
    return 'muted';
}

async function loadRoleAssignmentsReport() {
    const summaryRoot = document.getElementById('roleReportSummary');
    const head = document.getElementById('roleReportHead');
    const body = document.getElementById('roleReportBody');
    if (!summaryRoot || !head || !body) return;
    summaryRoot.innerHTML = '<div class="hr-report-stat hr-report-stat--roles"><div class="stat-value">...</div><div class="stat-label">Ролі</div></div>';
    const data = await hrFetch('/role-assignments/report').catch(() => null);
    if (!data?.success) {
        summaryRoot.innerHTML = `<div class="hr-report-stat hr-report-stat--overdue"><div class="stat-value">!</div><div class="stat-label">${escapeHtml(data?.error || 'Не вдалося завантажити ролі')}</div></div>`;
        head.innerHTML = '';
        body.innerHTML = '';
        return;
    }
    const s = data.summary || {};
    const rows = data.data || [];
    summaryRoot.innerHTML = `
        <div class="hr-report-stat hr-report-stat--people"><div class="stat-value">${Number(s.staff_count || 0)}</div><div class="stat-label">Працівників</div></div>
        <div class="hr-report-stat hr-report-stat--roles"><div class="stat-value">${Number(s.role_count || 0)}</div><div class="stat-label">Ролей</div></div>
        <div class="hr-report-stat hr-report-stat--pending"><div class="stat-value">${Number(s.pending_admissions || 0)}</div><div class="stat-label">Очікують допуск</div></div>
        <div class="hr-report-stat hr-report-stat--blocked"><div class="stat-value">${Number(s.blocked_admissions || 0)}</div><div class="stat-label">Заблоковані</div></div>
        <div class="hr-report-stat hr-report-stat--internship"><div class="stat-value">${Number(s.internships_in_progress || 0)}</div><div class="stat-label">Стажування</div></div>
        <div class="hr-report-stat hr-report-stat--suspended"><div class="stat-value">${Number(s.suspended_roles || 0)}</div><div class="stat-label">Призупинені</div></div>
    `;
    head.innerHTML = `<tr>
        <th>Працівник</th><th>Роль</th><th>Тип</th><th>Статус</th><th>Допуск</th><th>Стажування</th></tr>`;
    body.innerHTML = rows.length ? rows.map(row => `
        <tr>
            <td>
                <b>${escapeHtml(row.staff_name || 'Без імені')}</b>
                <span class="hr-role-report-sub">${escapeHtml(row.position || row.department || '')}</span>
            </td>
            <td>${escapeHtml(row.profession_title || professionTitle(row.profession_key))}</td>
            <td>${row.is_primary ? 'Основна' : 'Додаткова'}</td>
            <td><span class="hr-role-pill ${roleReportPillClass(row.status)}">${escapeHtml(STAFF_ROLE_STATUS_LABELS[row.status] || row.status || '—')}</span></td>
            <td><span class="hr-role-pill ${roleReportPillClass(row.admission_status)}">${escapeHtml(STAFF_ROLE_ADMISSION_LABELS[row.admission_status] || row.admission_status || '—')}</span></td>
            <td><span class="hr-role-pill ${roleReportPillClass(row.internship_status)}">${escapeHtml(STAFF_ROLE_INTERNSHIP_LABELS[row.internship_status] || row.internship_status || '—')}</span></td>
        </tr>
    `).join('') : `<tr><td colspan="6">Рольові призначення ще не синхронізовані.</td></tr>`;
}

async function exportCSV() {
    const month = document.getElementById('reportMonth')?.value;
    const from = `${month}-01`;
    const d = new Date(from);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    const to = formatDate(d);

    const touchWindow = typeof openTouchDownloadWindow === 'function'
        ? openTouchDownloadWindow('HR CSV')
        : null;
    try {
        const token = localStorage.getItem('pzp_token');
        const resp = await fetch(`/api/hr/report/export?from=${from}&to=${to}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) {
            if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
            showNotification('Помилка експорту: ' + resp.statusText, 'error');
            return;
        }
        const blob = await resp.blob();
        const filename = `hr_report_${from}_${to}.csv`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'HR CSV підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Помилка експорту', 'error');
    }
}

// ==========================================
// MODALS
// ==========================================

function showHrEditableModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.scrollTop = 0;
    const dialog = modal.querySelector('.hr-modal');
    if (dialog) dialog.scrollTop = 0;
    const focusTarget = modal.querySelector('input:not([type="hidden"]), select, textarea, button');
    if (focusTarget && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => focusTarget.focus?.({ preventScroll: true }));
    }
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
}

async function closeHrEditableModal(id, force = false, message = 'Є незбережені зміни. Закрити без збереження?') {
    const modal = document.getElementById(id);
    if (!modal) return true;
    const closeNow = () => {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    };
    if (force) {
        closeNow();
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.markClean(modal);
        return true;
    }
    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            message,
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    closeNow();
    return true;
}

function initModals() {
    // Shift modal
    document.getElementById('shiftSave')?.addEventListener('click', saveShift);
    document.getElementById('shiftDelete')?.addEventListener('click', deleteShift);
    document.getElementById('shiftReplace')?.addEventListener('click', replaceShift);
    document.getElementById('shiftCancel')?.addEventListener('click', () => closeHrEditableModal('shiftModal', false, 'Є незбережені зміни у зміні. Закрити без збереження?'));

    // Staff edit modal
    document.getElementById('editSave')?.addEventListener('click', saveStaffEdit);
    document.getElementById('editCancel')?.addEventListener('click', () => closeHrEditableModal('staffEditModal', false, 'Є незбережені зміни співробітника. Закрити без збереження?'));
    document.getElementById('editHistoryRefresh')?.addEventListener('click', () => {
        loadStaffProfileHistory(document.getElementById('editStaffId')?.value);
    });

    // Correction modal
    document.getElementById('corrSave')?.addEventListener('click', saveCorrection);
    document.getElementById('corrCancel')?.addEventListener('click', () => closeHrEditableModal('correctionModal', false, 'Є незбережені зміни корекції. Закрити без збереження?'));

    // Close modals on overlay click
    ['shiftModal', 'staffEditModal', 'correctionModal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeHrEditableModal(id);
        });
    });
}

async function saveCorrection() {
    const recordId = document.getElementById('corrRecordId')?.value;
    const clockIn = document.getElementById('corrClockIn')?.value;
    const clockOut = document.getElementById('corrClockOut')?.value;
    const notes = document.getElementById('corrNotes')?.value;

    if (!clockIn && !clockOut) {
        showNotification('Вкажіть час', 'error');
        return;
    }

    const today = todayStr();
    const body = { notes };
    if (clockIn) body.clock_in = `${today}T${clockIn}:00+02:00`;
    if (clockOut) body.clock_out = `${today}T${clockOut}:00+02:00`;

    const data = await hrFetch(`/records/${recordId}/correct`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
    if (data && data.success) {
        showNotification('Час виправлено', 'success');
        await closeHrEditableModal('correctionModal', true);
        await loadToday();
    } else {
        showNotification(data?.error || 'Помилка', 'error');
    }
}

// ==========================================
// LEAVES (inside schedule)
// ==========================================

async function loadLeaves() {
    const statusFilter = document.getElementById('leaveStatusFilter')?.value || '';
    const data = await hrFetch(`/leave-requests?status=${statusFilter}`);
    if (!data || !data.success) return;
    renderLeaves(data.data);
}

function renderLeaves(leaves) {
    const el = document.getElementById('leavesList');
    if (!leaves.length) {
        el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає заявок</div>';
        return;
    }
    const typeLabels = { vacation: 'Відпустка', sick: 'Лікарняний', day_off: 'Вихідний', unpaid: 'За свій рахунок' };
    const statusColors = { pending: '#F59E0B', approved: '#10B981', rejected: '#EF4444', cancelled: '#9CA3AF' };
    const statusLabels = { pending: 'Очікує', approved: 'Затверджено', rejected: 'Відхилено', cancelled: 'Скасовано' };

    el.innerHTML = leaves.map(l => `
        <div style="background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius);padding:16px;margin-bottom:12px;box-shadow:var(--shadow-xs);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div>
                    <strong>${escapeHtml(l.staff_name)}</strong>
                    <span style="margin-left:8px;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;background:${statusColors[l.status]}20;color:${statusColors[l.status]};">${statusLabels[l.status]}</span>
                </div>
                <span style="font-size:12px;color:var(--gray-500);">${typeLabels[l.type] || l.type}</span>
            </div>
            <div style="font-size:13px;color:var(--gray-600);margin-bottom:6px;">
                ${l.date_from?.split('T')[0]} — ${l.date_to?.split('T')[0]} (${l.days} дн.)
            </div>
            ${l.reason ? `<div style="font-size:12px;color:var(--gray-500);">Причина: ${escapeHtml(l.reason)}</div>` : ''}
            ${l.status === 'pending' && canManage ? `
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <button type="button" onclick="reviewLeave(${l.id}, 'approved')" style="padding:6px 16px;border:none;background:#10B981;color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Затвердити</button>
                    <button type="button" onclick="reviewLeave(${l.id}, 'rejected')" style="padding:6px 16px;border:none;background:#EF4444;color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Відхилити</button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

window.reviewLeave = async function(id, status) {
    let comment = '';
    if (status === 'rejected') {
        comment = await promptModal('Причина відхилення:', { placeholder: 'Вкажіть причину...' });
        if (comment === null) return;
    }
    const data = await hrFetch(`/leave-requests/${id}/review`, 'PUT', { status, comment });
    if (data?.success) { showNotification(status === 'approved' ? 'Заявку затверджено' : 'Заявку відхилено', 'success'); loadLeaves(); }
};

window.showNewLeaveForm = async function() {
    const staff = await hrFetch('/staff?active=true');
    if (!staff?.success) return;
    const staffOptions = staff.data.map(s => ({ value: String(s.id), label: `${s.name}` }));
    const typeOptions = [
        { value: 'vacation', label: 'Відпустка' },
        { value: 'sick', label: 'Лікарняний' },
        { value: 'day_off', label: 'Відгул' },
        { value: 'unpaid', label: 'За свій рахунок' }
    ];
    const result = await formModal('Нова заявка на відпустку', [
        { key: 'staffId', label: 'Співробітник', type: 'select', options: staffOptions, required: true },
        { key: 'type', label: 'Тип', type: 'select', options: typeOptions, defaultValue: 'vacation' },
        { key: 'dateFrom', label: 'Дата з', type: 'date', required: true },
        { key: 'dateTo', label: 'Дата по', type: 'date', required: true },
        { key: 'reason', label: 'Причина', placeholder: 'Необов\'язково' }
    ], { icon: '🏖️' });
    if (!result) return;
    const data = await hrFetch('/leave-requests', 'POST', { staff_id: parseInt(result.staffId), type: result.type, date_from: result.dateFrom, date_to: result.dateTo, reason: result.reason || '' });
    if (data?.success) { showNotification('Заявку створено', 'success'); loadLeaves(); }
};

// ==========================================
// TAB 7: SALARY (#7)
// ==========================================

function ensurePayrollMonthOptions(monthSelect, preferredValue = '') {
    if (monthSelect && !monthSelect.options.length) {
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
            monthSelect.add(new Option(label, val));
        }
    }
    if (monthSelect && preferredValue && Array.from(monthSelect.options).some(option => option.value === preferredValue)) {
        monthSelect.value = preferredValue;
    }
}

function payrollMonthBounds(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return { from: '', to: '' };
    const [year, mon] = month.split('-').map(Number);
    const lastDay = new Date(year, mon, 0).getDate();
    return {
        from: `${month}-01`,
        to: `${month}-${String(lastDay).padStart(2, '0')}`
    };
}

function syncSalaryPeriodInputsToMonth(month = currentSalaryMonth()) {
    const bounds = payrollMonthBounds(month);
    const fromInput = document.getElementById('salaryDateFrom');
    const toInput = document.getElementById('salaryDateTo');
    if (fromInput && bounds.from) fromInput.value = bounds.from;
    if (toInput && bounds.to) toInput.value = bounds.to;
}

function ensureSalaryPeriodInputs(month = currentSalaryMonth()) {
    const bounds = payrollMonthBounds(month);
    const fromInput = document.getElementById('salaryDateFrom');
    const toInput = document.getElementById('salaryDateTo');
    if (fromInput && !fromInput.value && bounds.from) fromInput.value = bounds.from;
    if (toInput && !toInput.value && bounds.to) toInput.value = bounds.to;
}

function currentSalaryPeriod() {
    const month = currentSalaryMonth();
    ensureSalaryPeriodInputs(month);
    const from = document.getElementById('salaryDateFrom')?.value || '';
    const to = document.getElementById('salaryDateTo')?.value || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        showNotification('Оберіть коректний період дат', 'error');
        return null;
    }
    if (from > to) {
        showNotification('Дата початку не може бути пізніше дати завершення', 'error');
        return null;
    }
    const bounds = payrollMonthBounds(month);
    return {
        month,
        from,
        to,
        isCustom: from !== bounds.from || to !== bounds.to
    };
}

function salaryPeriodQueryString() {
    const period = currentSalaryPeriod();
    if (!period) return '';
    return new URLSearchParams({ month: period.month, from: period.from, to: period.to }).toString();
}

function applySalaryPeriodFilter() {
    if (!currentSalaryPeriod()) return;
    loadSalary();
}

async function loadSalary() {
    const monthSelect = document.getElementById('salaryMonth');
    ensurePayrollMonthOptions(monthSelect);
    const month = monthSelect?.value || '';
    ensureSalaryPeriodInputs(month);
    const zrsMonth = document.getElementById('zrsMonth');
    if (zrsMonth) ensurePayrollMonthOptions(zrsMonth, month);
    const query = salaryPeriodQueryString();
    if (!query) return;
    const data = await hrFetch(`/salary?${query}`);
    if (!data || !data.success) return;
    renderSalary(data);
}

function renderSalaryRateSummary(row = {}) {
    const segments = Array.isArray(row.profession_rate_summary) ? row.profession_rate_summary : [];
    const fallbackUnit = staffRateUnit(row);
    const normalized = segments
        .map(segment => ({
            key: normalizeProfessionKey(segment.profession_key || segment.professionKey || segment.key),
            rate: Number(segment.rate || segment.hourly_rate || segment.hourlyRate || 0),
            rateUnit: normalizeStaffRateUnit(segment.rate_unit || segment.rateUnit || fallbackUnit),
            hours: Number(segment.hours || 0),
            days: Number(segment.days || 0)
        }))
        .filter(segment => segment.key && segment.rate > 0);
    if (!normalized.length) return formatStaffRate(row.hourly_rate || 0, fallbackUnit);
    return normalized
        .map(segment => {
            const quantity = segment.rateUnit === 'month'
                ? ''
                : segment.rateUnit === 'day'
                    ? (segment.days ? ` · ${segment.days} дн` : '')
                    : (segment.hours ? ` · ${segment.hours} год` : '');
            return `${escapeHtml(professionTitle(segment.key))}: ${formatStaffRate(segment.rate, segment.rateUnit)}${quantity}`;
        })
        .join('<br>');
}

function currentSalaryMonth() {
    return document.getElementById('salaryMonth')?.value || '';
}

function currentZrsMonth() {
    return document.getElementById('zrsMonth')?.value || currentSalaryMonth();
}

function formatSalaryPeriodDate(value) {
    if (!value) return '';
    const [year, month, day] = String(value).split('-');
    return [day, month, year].filter(Boolean).join('.');
}

function formatPayrollEventTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Kyiv'
    });
}

function renderSalaryPeriodEvents(events = []) {
    const rows = Array.isArray(events) ? events.slice(0, 8) : [];
    if (!rows.length) {
        return `<div class="hr-salary-event">
            <strong>Журнал періоду</strong>
            <span>Дій по цьому місяцю ще немає.</span>
            <span class="meta">—</span>
        </div>`;
    }
    return rows.map(event => {
        const meta = [
            event.items_count !== null && event.items_count !== undefined ? `${Number(event.items_count)} ряд.` : '',
            event.amount !== null && event.amount !== undefined ? fmtMoney(Number(event.amount || 0)) : ''
        ].filter(Boolean).join(' · ');
        const actor = event.actor ? ` · ${escapeHtml(event.actor)}` : '';
        const note = event.note ? `<span>${escapeHtml(event.note)}</span>` : '<span>Без примітки</span>';
        return `<div class="hr-salary-event">
            <strong>${escapeHtml(event.event_label || event.event_type || 'Подія')}</strong>
            <div>${note}<small>${escapeHtml(formatPayrollEventTime(event.created_at))}${actor}</small></div>
            <span class="meta">${escapeHtml(meta || '—')}</span>
        </div>`;
    }).join('');
}

function renderSalaryPeriodControls(data = {}) {
    const lock = data.period_lock || { is_locked: false };
    const reconciliation = data.reconciliation || {};
    const events = Array.isArray(data.events) ? data.events : [];
    const period = data.period || {};
    const isCustomPeriod = period.mode === 'range';
    const periodLabel = period.from && period.to
        ? `${formatSalaryPeriodDate(period.from)} – ${formatSalaryPeriodDate(period.to)}`
        : '';
    const statusEl = document.getElementById('salaryPeriodStatus');
    const reconciliationEl = document.getElementById('salaryReconciliation');
    const eventsEl = document.getElementById('salaryPeriodEvents');
    const commitBtn = document.getElementById('btnCommitSalary');
    const adjustmentBtn = document.getElementById('btnAddAdjustment');
    const refreshBtn = document.getElementById('btnRefreshSalaryReconciliation');
    const lockBtn = document.getElementById('btnLockSalaryPeriod');
    const unlockBtn = document.getElementById('btnUnlockSalaryPeriod');
    const reverseBtn = document.getElementById('btnReverseSalary');
    const isLocked = lock.is_locked === true;

    if (statusEl) {
        statusEl.classList.toggle('is-locked', isLocked);
        const actor = isLocked && lock.locked_by ? ` · ${escapeHtml(lock.locked_by)}` : '';
        statusEl.innerHTML = isCustomPeriod
            ? `Фільтр періоду: ${escapeHtml(periodLabel)} · дії з нарахуванням доступні для повного місяця`
            : isLocked
            ? `Період закрито${actor}${lock.note ? ` · ${escapeHtml(lock.note)}` : ''}`
            : `Період відкрито${lock.unlocked_by ? ` · ${escapeHtml(lock.unlocked_by)}` : ''}`;
    }

    if (commitBtn) commitBtn.disabled = isLocked || isCustomPeriod;
    if (adjustmentBtn) adjustmentBtn.disabled = isLocked || isCustomPeriod;
    if (refreshBtn) refreshBtn.disabled = isCustomPeriod;
    if (lockBtn) lockBtn.hidden = isLocked;
    if (unlockBtn) unlockBtn.hidden = !isLocked;
    if (lockBtn) lockBtn.disabled = isCustomPeriod;
    if (unlockBtn) unlockBtn.disabled = isCustomPeriod;
    if (reverseBtn) reverseBtn.disabled = isCustomPeriod || (Number(reconciliation.finance_salary_count || 0) === 0 && Number(reconciliation.payroll_count || 0) === 0);

    if (reconciliationEl) {
        if (isCustomPeriod) {
            reconciliationEl.innerHTML = `<div class="hr-salary-period-note">Показано розрахунок за обраний календарний період. Звірка, закриття, сторно і нарахування лишаються привʼязаними до місяця ${escapeHtml(data.month || '')}.</div>`;
        } else {
        const variance = Number(reconciliation.variance || 0);
        const statusClass = reconciliation.status === 'ok' ? 'green' : 'yellow';
        reconciliationEl.innerHTML = `
            <div class="hr-summary">
                <div class="hr-summary-card"><div class="value">${fmtMoney(Number(reconciliation.payroll_total || 0))}</div><div class="label">Payroll active</div></div>
                <div class="hr-summary-card"><div class="value">${fmtMoney(Number(reconciliation.finance_salary_total || 0))}</div><div class="label">Finance salary</div></div>
                <div class="hr-summary-card"><div class="value">${fmtMoney(Number(reconciliation.finance_reversal_total || 0))}</div><div class="label">Сторно</div></div>
                <div class="hr-summary-card ${statusClass}"><div class="value">${fmtMoney(variance)}</div><div class="label">Різниця</div></div>
                <div class="hr-summary-card"><div class="value">${Number(reconciliation.orphan_salary_count || 0) + Number(reconciliation.missing_finance_count || 0)}</div><div class="label">Хвости</div></div>
            </div>
        `;
        }
    }

    if (eventsEl) {
        eventsEl.innerHTML = isCustomPeriod ? '' : renderSalaryPeriodEvents(events);
    }
}

function renderSalary(data) {
    const totals = data.totals;
    renderSalaryPeriodControls(data);
    document.getElementById('salaryTotals').innerHTML = `
        <div class="hr-summary">
            <div class="hr-summary-card"><div class="value">${(totals.total_salary || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Всього</div></div>
            <div class="hr-summary-card green"><div class="value">${(totals.total_base || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Базова</div></div>
            <div class="hr-summary-card"><div class="value">${(totals.total_overtime || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Переробки</div></div>
            <div class="hr-summary-card green"><div class="value">${(totals.total_bonuses || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Бонуси</div></div>
            <div class="hr-summary-card red"><div class="value">${(totals.total_deductions || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Утримання</div></div>
            <div class="hr-summary-card red"><div class="value">${(totals.total_advances || 0).toLocaleString('uk-UA')} ₴</div><div class="label">ЗРС</div></div>
        </div>
    `;

    document.getElementById('salaryHead').innerHTML = `<tr>
        <th>Співробітник</th><th>Роль</th><th>Ставка</th><th>Днів</th><th>Годин</th>
        <th>Базова</th><th>Переробки</th><th>Бонуси</th><th>Утримання</th><th>ЗРС</th><th>Всього</th>
    </tr>`;

    document.getElementById('salaryBody').innerHTML = data.data.map(s => `<tr>
        <td><strong>${escapeHtml(s.staff_name)}</strong></td>
        <td>${ROLE_LABELS[s.role_type] || s.role_type || ''}</td>
        <td>${renderSalaryRateSummary(s)}</td>
        <td>${s.days_worked}</td>
        <td>${s.hours_worked}</td>
        <td>${s.base_salary.toLocaleString('uk-UA')} ₴</td>
        <td>${s.overtime_pay ? s.overtime_pay.toLocaleString('uk-UA') + ' ₴' : '—'}</td>
        <td style="color:#10B981;">${(s.bonuses + s.tips) ? '+' + (s.bonuses + s.tips).toLocaleString('uk-UA') + ' ₴' : '—'}</td>
        <td style="color:#EF4444;">${(s.deductions + s.penalties) ? '-' + (s.deductions + s.penalties).toLocaleString('uk-UA') + ' ₴' : '—'}</td>
        <td style="color:#EF4444;">${s.advances ? '-' + s.advances.toLocaleString('uk-UA') + ' ₴' : '—'}</td>
        <td><strong>${s.total_salary.toLocaleString('uk-UA')} ₴</strong></td>
    </tr>`).join('');
}

function formatZrsDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Kyiv'
    });
}

function zrsAdjustmentActive(row = {}) {
    const status = String(row.status || 'applied');
    return status === 'applied' || status === 'pending_review';
}

function zrsStatusLabel(status) {
    const normalized = String(status || 'applied');
    return {
        applied: 'Застосовано',
        pending_review: 'На погодженні',
        voided: 'Скасовано',
        rejected: 'Відхилено'
    }[normalized] || normalized;
}

function renderZrs(adjustmentsData = {}, salaryData = {}) {
    const adjustments = Array.isArray(adjustmentsData.data) ? adjustmentsData.data : [];
    const activeAdjustments = adjustments.filter(zrsAdjustmentActive);
    const salaryRows = Array.isArray(salaryData.data) ? salaryData.data : [];
    const zrsRows = salaryRows.filter(row => Number(row.advances || 0) > 0);
    const totalZrs = Number(salaryData.totals?.total_advances || activeAdjustments.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const affectedCount = zrsRows.length || new Set(activeAdjustments.map(row => row.staff_id)).size;
    const netAfterZrs = salaryRows.reduce((sum, row) => sum + Number(row.total_salary || 0), 0);
    const lock = salaryData.period_lock || { is_locked: false };
    const isLocked = lock.is_locked === true;
    const addBtn = document.getElementById('btnAddZrs');
    const statusEl = document.getElementById('zrsStatus');

    if (addBtn) addBtn.disabled = isLocked;
    if (statusEl) {
        statusEl.classList.toggle('is-locked', isLocked);
        statusEl.textContent = isLocked
            ? `Період закрито${lock.locked_by ? ` · ${lock.locked_by}` : ''}`
            : 'Період відкрито: ЗРС можна додавати до нарахування зарплати.';
    }

    document.getElementById('zrsSummary').innerHTML = `
        <div class="hr-summary">
            <div class="hr-summary-card red"><div class="value">${fmtMoney(totalZrs)}</div><div class="label">ЗРС до вирахування</div></div>
            <div class="hr-summary-card"><div class="value">${affectedCount}</div><div class="label">Співробітників</div></div>
            <div class="hr-summary-card green"><div class="value">${fmtMoney(netAfterZrs)}</div><div class="label">Зарплата після ЗРС</div></div>
        </div>
    `;

    document.getElementById('zrsHead').innerHTML = `<tr>
        <th>Співробітник</th><th>Роль</th><th>ЗРС</th><th>Інші утримання</th><th>Було до ЗРС</th><th>До виплати</th>
    </tr>`;
    document.getElementById('zrsBody').innerHTML = zrsRows.length ? zrsRows.map(row => {
        const advances = Number(row.advances || 0);
        const otherDeductions = Number(row.deductions || 0) + Number(row.penalties || 0);
        const beforeZrs = Number(row.total_salary || 0) + advances;
        return `<tr>
            <td><strong>${escapeHtml(row.staff_name)}</strong></td>
            <td>${ROLE_LABELS[row.role_type] || row.role_type || ''}</td>
            <td style="color:#EF4444;">-${fmtMoney(advances)}</td>
            <td>${otherDeductions ? '-' + fmtMoney(otherDeductions) : '—'}</td>
            <td>${fmtMoney(beforeZrs)}</td>
            <td><strong>${fmtMoney(Number(row.total_salary || 0))}</strong></td>
        </tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:#94A3B8;">ЗРС за цей місяць ще немає</td></tr>';

    document.getElementById('zrsJournalHead').innerHTML = `<tr>
        <th>Дата</th><th>Співробітник</th><th>Сума</th><th>Статус</th><th>Причина</th><th>Додав</th><th>Дія</th>
    </tr>`;
    document.getElementById('zrsJournalBody').innerHTML = adjustments.length ? adjustments.map(row => {
        const status = String(row.status || 'applied');
        const active = zrsAdjustmentActive(row);
        const canVoid = !isLocked && active;
        return `<tr class="${active ? '' : 'is-muted'}">
            <td>${formatZrsDate(row.created_at)}</td>
            <td><strong>${escapeHtml(row.staff_name || '')}</strong></td>
            <td style="color:#EF4444;">${active ? '-' : ''}${fmtMoney(Number(row.amount || 0))}</td>
            <td><span class="zrs-status-badge${active ? '' : ' is-muted'}">${escapeHtml(zrsStatusLabel(status))}</span></td>
            <td>${escapeHtml(row.reason || 'ЗРС під зарплату')}</td>
            <td>${escapeHtml(row.created_by || '—')}</td>
            <td>${canVoid ? `<button type="button" class="zrs-action-btn" onclick="voidZrsAdjustment(${Number(row.id)})">Скасувати</button>` : '—'}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="7" style="text-align:center;color:#94A3B8;">Журнал ЗРС порожній</td></tr>';
}

async function loadZrs() {
    const monthSelect = document.getElementById('zrsMonth');
    ensurePayrollMonthOptions(monthSelect, currentSalaryMonth());
    const month = monthSelect?.value || currentSalaryMonth();
    const salaryMonth = document.getElementById('salaryMonth');
    if (salaryMonth) ensurePayrollMonthOptions(salaryMonth, month);
    const [adjustments, salary] = await Promise.all([
        hrFetch(`/salary/adjustments?month=${month}&type=advance`),
        hrFetch(`/salary?month=${month}`)
    ]);
    if (!adjustments?.success || !salary?.success) return;
    renderZrs(adjustments, salary);
}

async function showZrsForm() {
    const month = currentZrsMonth();
    if (!month) { showNotification('Виберіть місяць', 'error'); return; }
    const staff = await hrFetch('/staff?active=true');
    if (!staff?.success) return;
    const staffOptions = staff.data.map(s => ({ value: String(s.id), label: `${s.name}` }));
    const result = await formModal('ЗРС під зарплату', [
        { key: 'staffId', label: 'Співробітник', type: 'select', options: staffOptions, required: true },
        { key: 'amount', label: 'Сума ЗРС (₴)', type: 'number', required: true, placeholder: '1000' },
        { key: 'reason', label: 'Коментар', placeholder: 'Наприклад: ЗРС під зарплату' }
    ], { icon: '💸' });
    if (!result) return;
    const amount = Math.abs(parseInt(result.amount, 10));
    if (!amount) { showNotification('Вкажіть суму ЗРС', 'error'); return; }
    const data = await hrFetch('/salary/adjustment', 'POST', {
        staff_id: parseInt(result.staffId, 10),
        month,
        type: 'advance',
        amount,
        reason: result.reason || 'ЗРС під зарплату'
    });
    if (data?.success) {
        showNotification('ЗРС додано і буде вирахувано із зарплати', 'success');
        loadZrs();
        loadSalary();
    } else {
        showNotification(data?.error || 'Не вдалося додати ЗРС', 'error');
    }
}

async function voidZrsAdjustment(adjustmentId) {
    const id = Number(adjustmentId);
    if (!Number.isFinite(id) || id <= 0) return;
    const result = await formModal('Скасувати ЗРС', [
        { key: 'reason', label: 'Причина', type: 'textarea', required: true, placeholder: 'Наприклад: помилково доданий аванс' }
    ], { icon: '!', type: 'warning', okText: 'Скасувати ЗРС' });
    if (!result?.reason?.trim()) return;
    const data = await hrFetch(`/salary/adjustment/${id}/void`, 'PUT', { reason: result.reason.trim() });
    if (data?.success) {
        showNotification('ЗРС скасовано і прибрано з розрахунку зарплати', 'success');
        await loadZrs();
        await loadSalary();
    } else {
        showNotification(data?.error || 'Не вдалося скасувати ЗРС', 'error');
    }
}

window.voidZrsAdjustment = voidZrsAdjustment;

window.showAdjustmentForm = async function() {
    const staff = await hrFetch('/staff?active=true');
    if (!staff?.success) return;
    const staffOptions = staff.data.map(s => ({ value: String(s.id), label: `${s.name}` }));
    const typeOptions = [
        { value: 'bonus', label: 'Бонус' },
        { value: 'deduction', label: 'Утримання' },
        { value: 'penalty', label: 'Депреміювання' },
        { value: 'tip', label: 'Чайові' }
    ];
    const result = await formModal('Коригування зарплати', [
        { key: 'staffId', label: 'Співробітник', type: 'select', options: staffOptions, required: true },
        { key: 'type', label: 'Тип', type: 'select', options: typeOptions, defaultValue: 'bonus' },
        { key: 'amount', label: 'Сума (₴)', type: 'number', required: true, placeholder: '500' },
        { key: 'reason', label: 'Причина', placeholder: 'Необов\'язково' }
    ], { icon: '💰' });
    if (!result) return;
    const amount = parseInt(result.amount);
    if (!amount) return;
    const month = document.getElementById('salaryMonth')?.value || '';

    // For penalty/deduction — show template picker
    if (result.type === 'penalty' || result.type === 'deduction') {
        const tplResult = await showDepremiumPicker(parseInt(result.staffId), amount, result.reason, month);
        if (tplResult === false) return; // cancelled
        if (tplResult) {
            const data = await hrFetch('/salary/adjustment', 'POST', {
                staff_id: parseInt(result.staffId), month, type: result.type,
                amount: tplResult.amount, reason: tplResult.reason, template_id: tplResult.template_id
            });
            if (data?.success) {
                if (data.needsReview) showNotification('Депреміювання створено — потрібне погодження директора', 'warning');
                else showNotification('Депреміювання застосовано', 'success');
                loadSalary();
            }
            return;
        }
    }

    const data = await hrFetch('/salary/adjustment', 'POST', { staff_id: parseInt(result.staffId), month, type: result.type, amount, reason: result.reason || '' });
    if (data?.success) { showNotification('Коригування додано', 'success'); loadSalary(); }
};

// v43.0: Depremium template picker with decision panel
const SEVERITY_LABELS = { low: '🟢 Низький', medium: '🟡 Середній', high: '🟠 Високий', critical: '🔴 Критичний' };
const CATEGORY_LABELS = { attendance: 'Відвідуваність', behavior: 'Поведінка', appearance: 'Зовнішній вигляд', service: 'Обслуговування', safety: 'Безпека', theft: 'Крадіжка', substance: 'Речовини', workplace: 'Робоче місце', phone: 'Телефон', general: 'Загальне' };

async function showDepremiumPicker(staffId, initialAmount, initialReason, month) {
    const tplData = await hrFetch('/depremium-templates');
    if (!tplData?.success || !tplData.data?.length) return null; // no templates, use custom

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'hr-modal-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1E1E38;border-radius:16px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;padding:24px;color:#E2E8F0;box-shadow:0 20px 60px rgba(0,0,0,0.4)';

        let selectedTpl = null;
        const templates = tplData.data;

        function render(filter = '') {
            const filtered = templates.filter(t => !filter || t.title.toLowerCase().includes(filter) || t.code.toLowerCase().includes(filter) || t.official_reason.toLowerCase().includes(filter));
            modal.innerHTML = `
                <h3 style="margin:0 0 16px;font-size:18px;font-weight:800">📋 Офіційне правило депреміювання</h3>
                <div style="display:grid;grid-template-columns:1.4fr .8fr;gap:8px;margin-bottom:12px">
                    <input id="dpSearch" class="eg-input" placeholder="Пошук: запізнення, телефон..." value="${escapeHtml(filter)}" style="padding:10px 12px;border:1px solid #3D3D5C;border-radius:10px;background:#2A2A4A;color:#E2E8F0;font-size:14px;min-height:44px">
                    <select id="dpCatFilter" style="padding:10px;border:1px solid #3D3D5C;border-radius:10px;background:#2A2A4A;color:#E2E8F0;font-size:13px;min-height:44px">
                        <option value="">Всі категорії</option>
                        ${Object.entries(CATEGORY_LABELS).map(([k,v]) => '<option value="'+k+'">'+v+'</option>').join('')}
                    </select>
                </div>
                <div style="max-height:280px;overflow-y:auto;display:grid;gap:8px;margin-bottom:16px">
                    ${filtered.map(t => `<button type="button" class="dp-tpl-item" data-id="${t.id}" style="width:100%;text-align:left;padding:12px 14px;border-radius:12px;border:1px solid ${selectedTpl?.id===t.id?'#a78bfa':'rgba(255,255,255,0.08)'};background:${selectedTpl?.id===t.id?'rgba(168,85,247,0.15)':'rgba(255,255,255,0.03)'};cursor:pointer;transition:all .15s;color:#E2E8F0">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                            <span style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#c084fc">${escapeHtml(t.code)}</span>
                            <span style="font-size:11px;font-weight:600" class="severity-${t.severity}">${SEVERITY_LABELS[t.severity]||t.severity}</span>
                        </div>
                        <div style="font-size:14px;font-weight:700;margin-bottom:3px">${escapeHtml(t.title)}</div>
                        <div style="font-size:12px;color:#94A3B8;line-height:1.4">${escapeHtml(t.official_reason)}</div>
                        ${t.amount ? '<div style="margin-top:6px;font-size:13px;font-weight:700;color:#fda4af">-'+t.amount+' ₴</div>' : '<div style="margin-top:6px;font-size:12px;color:#fca5a5;font-weight:600">Повне ненарахування / звільнення</div>'}
                    </button>`).join('')}
                    ${!filtered.length ? '<div style="text-align:center;color:#6B7280;padding:20px">Нічого не знайдено</div>' : ''}
                </div>
                <div id="dpDecisionPanel" style="display:${selectedTpl?'block':'none'}">
                    ${selectedTpl ? renderDecisionPanel(selectedTpl) : ''}
                </div>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button type="button" id="dpApply" style="flex:1;padding:12px;border:none;border-radius:12px;background:${selectedTpl?'#7c3aed':'#3D3D5C'};color:#fff;font-size:14px;font-weight:700;cursor:pointer;min-height:44px;transition:all .15s" ${selectedTpl?'':'disabled'}>Застосувати</button>
                    <button type="button" id="dpCustom" style="padding:12px 20px;border:1px solid #3D3D5C;border-radius:12px;background:transparent;color:#9CA3AF;font-size:13px;cursor:pointer;min-height:44px">Довільна причина</button>
                    <button type="button" id="dpCancel" style="padding:12px 20px;border:1px solid #3D3D5C;border-radius:12px;background:transparent;color:#9CA3AF;font-size:13px;cursor:pointer;min-height:44px">Скасувати</button>
                </div>`;

            // Bind events
            modal.querySelector('#dpSearch')?.addEventListener('input', (e) => render(e.target.value.toLowerCase()));
            modal.querySelectorAll('.dp-tpl-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedTpl = templates.find(t => t.id === parseInt(btn.dataset.id));
                    render(modal.querySelector('#dpSearch')?.value?.toLowerCase() || '');
                    // Load staff history for this template
                    loadStaffHistory(staffId, selectedTpl.id);
                });
            });
            modal.querySelector('#dpApply')?.addEventListener('click', () => {
                if (!selectedTpl) return;
                overlay.remove();
                resolve({ template_id: selectedTpl.id, amount: selectedTpl.amount || initialAmount, reason: selectedTpl.official_reason });
            });
            modal.querySelector('#dpCustom')?.addEventListener('click', () => { overlay.remove(); resolve(null); });
            modal.querySelector('#dpCancel')?.addEventListener('click', () => { overlay.remove(); resolve(false); });
        }

        function renderDecisionPanel(tpl) {
            let warnings = '';
            if (tpl.severity === 'critical') warnings += '<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#fca5a5;font-size:12px">🔴 Критичне порушення — потрібне погодження директора</div>';
            if (tpl.requires_manual_review) warnings += '<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(250,204,21,0.1);border:1px solid rgba(250,204,21,0.2);color:#fde68a;font-size:12px">⚠️ Потрібне ручне погодження</div>';
            if (tpl.is_repeat_offense) warnings += '<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(250,204,21,0.1);border:1px solid rgba(250,204,21,0.2);color:#fde68a;font-size:12px">🔁 Це повторне порушення</div>';
            if (!tpl.can_be_edited) warnings += '<div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);color:#f87171;font-size:12px">🔒 Суму не можна змінювати</div>';

            return `<div style="padding:14px;border-radius:14px;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2)">
                <div style="font-size:12px;font-weight:800;color:#c084fc;letter-spacing:.08em;margin-bottom:4px">${escapeHtml(tpl.code)}</div>
                <div style="font-size:15px;font-weight:700;margin-bottom:4px">${escapeHtml(tpl.title)}</div>
                <div style="font-size:13px;color:#94A3B8;line-height:1.4;margin-bottom:8px">${escapeHtml(tpl.official_reason)}</div>
                <div style="display:flex;gap:12px;font-size:12px;flex-wrap:wrap">
                    ${tpl.amount ? '<span style="color:#fda4af;font-weight:700">-'+tpl.amount+' ₴</span>' : '<span style="color:#fca5a5;font-weight:700">Повне ненарахування</span>'}
                    <span class="severity-${tpl.severity}">${SEVERITY_LABELS[tpl.severity]||''}</span>
                    <span style="color:#94A3B8">${CATEGORY_LABELS[tpl.discipline_category]||''}</span>
                </div>
                ${warnings}
                <div id="dpStaffHistory" style="margin-top:10px"></div>
            </div>`;
        }

        async function loadStaffHistory(sId, tplId) {
            const el = modal.querySelector('#dpStaffHistory');
            if (!el) return;
            const hist = await hrFetch('/depremium-templates/' + tplId + '/staff-history/' + sId);
            if (!hist?.success || !hist.data?.length) { el.innerHTML = '<div style="font-size:11px;color:#6B7280;margin-top:4px">Попередніх порушень не знайдено</div>'; return; }
            el.innerHTML = '<div style="font-size:11px;font-weight:700;color:#fde68a;margin-bottom:4px">⚠️ Попередні порушення (' + hist.data.length + '):</div>' +
                hist.data.slice(0, 3).map(h => '<div style="font-size:11px;color:#94A3B8;padding:2px 0">' + new Date(h.created_at).toLocaleDateString('uk-UA') + ' — ' + (h.amount || 0) + '₴ — ' + escapeHtml(h.reason || '').substring(0, 50) + '</div>').join('');
        }

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        render();
    });
};

// ==========================================
// TAB 8: KPI
// ==========================================

function ensureKpiMonthOptions() {
    const sel = document.getElementById('kpiMonth');
    if (!sel) return null;
    if (!sel.options.length) {
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            sel.add(new Option(monthOptionLabel(d), val));
        }
    }
    return sel;
}

function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function kpiPercent(done, total) {
    return total > 0 ? Math.round(done / total * 100) : null;
}

function renderKpiCard(label, value, note, options = {}) {
    return `<div class="hr-kpi-card ${options.placeholder ? 'is-placeholder' : ''}">
        <div class="hr-kpi-card-label">${escapeHtml(label)}</div>
        <div class="hr-kpi-card-value">${escapeHtml(value)}</div>
        <div class="hr-kpi-card-note">${escapeHtml(note)}</div>
    </div>`;
}

function kpiSignal(text, tone = '') {
    return `<span class="hr-kpi-signal ${tone}">${escapeHtml(text)}</span>`;
}

function renderKpiSourceLabel(label, value) {
    return `<span class="hr-kpi-source"><strong>${escapeHtml(label)}</strong>: ${escapeHtml(value)}</span>`;
}

function renderKpiSources({ rows = [], sources: sourceCounts = {} } = {}) {
    const root = document.getElementById('kpiSources');
    if (!root) return;
    const countText = (count, label) => Number(count || 0) > 0 ? `${Number(count)} ${label}` : 'даних ще немає';
    root.innerHTML = [
        renderKpiSourceLabel('HR-зріз', countText(sourceCounts.staffRows || rows.length, 'працівників')),
        renderKpiSourceLabel('Графік / присутність', countText(sourceCounts.scheduleRows, 'активних рядків')),
        renderKpiSourceLabel('Задачі', countText(sourceCounts.taskRows, 'працівників із задачами')),
        renderKpiSourceLabel('Онбординг', countText(sourceCounts.onboardingRows, 'процесів')),
        renderKpiSourceLabel('Події / внесок', countText(sourceCounts.contributionRows, 'працівників із подіями'))
    ].join('');
}

function toneForPercent(value, good = 90, warn = 75) {
    if (value === null || value === undefined) return '';
    if (value >= good) return 'good';
    if (value >= warn) return 'warn';
    return 'bad';
}

function buildOnboardingKpiMap(list = []) {
    const map = {};
    for (const item of list) {
        const staffId = Number(item.staff_id);
        if (!staffId) continue;
        if (!map[staffId]) {
            map[staffId] = { total: 0, active: 0, completed: 0, completedItems: 0, totalItems: 0 };
        }
        const entry = map[staffId];
        entry.total++;
        if (item.status === 'completed') entry.completed++;
        else entry.active++;
        entry.completedItems += num(item.completed_items);
        entry.totalItems += num(item.total_items);
    }
    Object.values(map).forEach(entry => {
        entry.percent = kpiPercent(entry.completedItems, entry.totalItems);
    });
    return map;
}

async function loadKpi() {
    const sel = ensureKpiMonthOptions();
    const month = sel?.value || '';
    const snapshot = await hrFetch(`/kpi?month=${month}`);
    if (!snapshot?.success) {
        const body = document.getElementById('kpiBody');
        renderKpiSources({ rows: [], sources: {} });
        if (body) body.innerHTML = '<tr><td colspan="7" class="kpi-muted">Не вдалося завантажити KPI-зріз</td></tr>';
        return;
    }
    renderKpi({
        month: snapshot.month || month,
        rows: snapshot.data || [],
        sources: snapshot.sources || {}
    });
}

async function loadRatings() {
    return loadKpi();
}

function renderKpi({ rows = [], sources = {} }) {
    const summary = document.getElementById('kpiSummary');
    const head = document.getElementById('kpiHead');
    const body = document.getElementById('kpiBody');
    if (!summary || !head || !body) return;
    renderKpiSources({ rows, sources });

    const totals = rows.reduce((acc, row) => {
        acc.scheduled += num(row.days_scheduled);
        acc.worked += num(row.days_worked);
        acc.late += num(row.late_count);
        acc.absent += num(row.days_absent);
        acc.overtime += num(row.total_overtime_hours);
        acc.tasksAssigned += num(row.task_kpi?.tasks_assigned);
        acc.tasksDone += num(row.task_kpi?.tasks_done);
        acc.tasksOverdue += num(row.task_kpi?.tasks_overdue);
        acc.eventsPeriod += num(row.contribution_kpi?.events_period);
        acc.onboardingActive += num(row.development_kpi?.active);
        acc.onboardingTotal += num(row.development_kpi?.total);
        acc.onboardingTotalItems += num(row.development_kpi?.total_items);
        acc.onboardingDoneItems += num(row.development_kpi?.completed_items);
        acc.kpiScoreSum += num(row.kpi_score);
        return acc;
    }, { scheduled: 0, worked: 0, late: 0, absent: 0, overtime: 0, tasksAssigned: 0, tasksDone: 0, tasksOverdue: 0, eventsPeriod: 0, onboardingActive: 0, onboardingTotal: 0, onboardingTotalItems: 0, onboardingDoneItems: 0, kpiScoreSum: 0 });
    const attendance = kpiPercent(totals.worked, totals.scheduled);
    const taskRate = kpiPercent(totals.tasksDone, totals.tasksAssigned);
    const onboardingRate = kpiPercent(totals.onboardingDoneItems, totals.onboardingTotalItems);
    const averageScore = rows.length ? Math.round(totals.kpiScoreSum / rows.length) : null;

    summary.innerHTML = [
        attendance !== null
            ? renderKpiCard('Зміни / присутність', `${attendance}%`, `${totals.worked}/${totals.scheduled} відпрацьованих змін`)
            : renderKpiCard('Зміни / присутність', 'даних ще немає', 'Немає запланованих змін у вибраному місяці', { placeholder: true }),
        rows.length
            ? renderKpiCard('Надійність', `${totals.late + totals.absent}`, `${totals.late} запізнень · ${totals.absent} відсутностей`)
            : renderKpiCard('Надійність', 'даних ще немає', 'Потрібні записи присутності за період', { placeholder: true }),
        taskRate !== null
            ? renderKpiCard('Активність / виконання', `${taskRate}%`, `${totals.tasksDone}/${totals.tasksAssigned} задач виконано · ${totals.tasksOverdue} прострочено`)
            : renderKpiCard('Активність / виконання', 'даних ще немає', 'Немає привʼязаних задач за період', { placeholder: true }),
        sources.contributionRows
            ? renderKpiCard('Звіти / внесок', String(totals.eventsPeriod), 'Події за вибраний місяць з календаря бронювань')
            : renderKpiCard('Звіти / внесок', 'даних ще немає', 'Потрібен джерельний сигнал внеску або звітів', { placeholder: true }),
        sources.onboardingRows
            ? renderKpiCard('Статус розвитку', onboardingRate !== null ? `${onboardingRate}%` : `${totals.onboardingActive} активн.`, `${totals.onboardingActive} активних процесів онбордингу`)
            : renderKpiCard('Статус розвитку', 'даних ще немає', 'Немає активних або завершених процесів онбордингу', { placeholder: true }),
        averageScore !== null
            ? renderKpiCard('Підсумковий KPI', `${averageScore}%`, 'Середній бал по доступних KPI-сигналах')
            : renderKpiCard('Підсумковий KPI', 'даних ще немає', 'Потрібен хоча б один KPI-сигнал', { placeholder: true })
    ].join('');

    head.innerHTML = `<tr>
        <th>Працівник</th>
        <th>Бал</th>
        <th>Зміни / присутність</th>
        <th>Надійність</th>
        <th>Активність</th>
        <th>Внесок</th>
        <th>Розвиток</th>
    </tr>`;

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7" class="kpi-muted">Немає KPI-даних працівників за вибраний період</td></tr>';
        return;
    }

    body.innerHTML = rows.map(row => {
        const attendanceRate = num(row.days_scheduled) > 0 ? num(row.attendance_rate) : null;
        const taskAssigned = num(row.task_kpi?.tasks_assigned);
        const taskDone = num(row.task_kpi?.tasks_done);
        const taskDoneRate = taskAssigned > 0 ? num(row.task_completion_rate) : null;
        const reliabilityIssues = num(row.late_count) + num(row.days_absent);
        const contribution = row.contribution_kpi || {};
        const development = row.development_kpi || {};
        const kpiScore = num(row.kpi_score);
        const roleLabel = ROLE_LABELS[row.role_type] || row.role_type || '';

        return `<tr>
            <td>
                <strong>${escapeHtml(row.staff_name)}</strong>
                <div class="kpi-muted">${escapeHtml(roleLabel)}</div>
            </td>
            <td>${kpiSignal(`${kpiScore}%`, toneForPercent(kpiScore, 85, 65))}</td>
            <td>${attendanceRate !== null ? `${kpiSignal(`${attendanceRate}%`, toneForPercent(attendanceRate))}<div class="kpi-muted">${num(row.days_worked)}/${num(row.days_scheduled)} змін</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
            <td>${rows.length ? `${kpiSignal(reliabilityIssues ? `${reliabilityIssues} сигналів` : 'без сигналів', reliabilityIssues === 0 ? 'good' : reliabilityIssues <= 2 ? 'warn' : 'bad')}<div class="kpi-muted">${num(row.late_count)} запізн. · ${num(row.days_absent)} відсутн.</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
            <td>${taskDoneRate !== null ? `${kpiSignal(`${taskDoneRate}%`, toneForPercent(taskDoneRate, 85, 65))}<div class="kpi-muted">${taskDone}/${taskAssigned} задач · ${num(row.task_kpi?.tasks_overdue)} простр.</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
            <td>${num(contribution.events_period) > 0 || num(contribution.total_ratings) > 0 ? `${kpiSignal(`${num(contribution.events_period)} за місяць`, num(contribution.events_period) > 0 ? 'good' : '')}<div class="kpi-muted">${num(contribution.total_ratings)} оцінок · ${num(contribution.avg_rating).toFixed(1)} сер.</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
            <td>${num(development.total) > 0 ? `${kpiSignal(development.percent !== null && development.percent !== undefined ? `${num(development.percent)}%` : `${num(development.active)} активн.`, toneForPercent(development.percent, 90, 60))}<div class="kpi-muted">${num(development.completed)}/${num(development.total)} завершено в онбордингу</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
        </tr>`;
    }).join('');
}

// ==========================================
// TAB 9: ONBOARDING (#5)
// ==========================================

async function loadOnboarding() {
    const data = await hrFetch('/onboarding');
    if (!data || !data.success) return;
    renderOnboarding(data.data);
}

function renderOnboarding(list) {
    const el = document.getElementById('onboardingList');
    if (!list.length) {
        el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає активних онбордингів</div>';
        return;
    }

    el.innerHTML = list.map(o => {
        const pct = o.total_items > 0 ? Math.round(o.completed_items / o.total_items * 100) : 0;
        const items = o.items || [];
        const status = onboardingStatusLabel(o.training_status || o.status);
        const responsible = o.responsible_name || o.responsible_username || 'відповідального не призначено';
        const totalTasks = Number(o.generated_task_count || o.task_summary?.total || 0);
        const activeTasks = Number(o.active_task_count || o.task_summary?.active || 0);
        const completedTasks = Number(o.completed_task_count || o.task_summary?.completed || 0);
        return `
        <div style="background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius);padding:16px;margin-bottom:12px;box-shadow:var(--shadow-xs);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
                <div>
                    <strong>${escapeHtml(o.staff_name)}</strong>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;font-size:12px;color:var(--gray-500);font-weight:800;">
                        <span>${escapeHtml(o.template_name || 'Onboarding')}</span>
                        <span>Відповідальний: ${escapeHtml(responsible)}</span>
                        <span>${escapeHtml(status)}</span>
                        <span>Задачі: ${activeTasks}/${totalTasks} активні · ${completedTasks} виконано</span>
                    </div>
                </div>
                <span style="font-weight:800;color:${pct === 100 ? '#10B981' : '#6366F1'};">${pct}%</span>
            </div>
            <div style="background:var(--gray-100);border-radius:99px;height:6px;margin-bottom:12px;overflow:hidden;">
                <div style="background:${pct === 100 ? '#10B981' : '#6366F1'};height:100%;width:${pct}%;border-radius:99px;transition:width 0.3s;"></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                ${items.map(it => `
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;${it.done ? 'color:var(--gray-400);text-decoration:line-through;' : ''}">
                        <input type="checkbox" ${it.done ? 'checked' : ''} onchange="toggleOnboardingItem(${o.id}, ${it.id}, this.checked)" style="width:16px;height:16px;">
                        <span>${escapeHtml(it.title)}</span>
                    </label>
                `).join('')}
            </div>
        </div>`;
    }).join('');
}

window.toggleOnboardingItem = async function(progressId, itemId, done) {
    const data = await hrFetch(`/onboarding/${progressId}/check`, 'PUT', { item_id: itemId, done });
    if (data?.success) loadOnboarding();
};

window.showStartOnboarding = async function() {
    const [staff, templates, candidates] = await Promise.all([
        hrFetch('/staff?active=true'),
        hrFetch('/onboarding/templates'),
        hrFetch('/onboarding/responsible-candidates')
    ]);
    if (!staff?.success || !templates?.success) return;
    onboardingResponsibleCandidates = Array.isArray(candidates?.data) ? candidates.data : [];
    const staffOptions = staff.data.map(s => ({ value: String(s.id), label: `${s.name}` }));
    const templateOptions = templates.data.map(t => ({ value: String(t.id), label: `${t.name}` }));
    const responsibleOptions = responsibleCandidateOptions(onboardingResponsibleCandidates[0]?.id);
    if (!responsibleOptions.length) {
        showNotification('Немає активних користувачів для призначення відповідального', 'warning');
        return;
    }
    const result = await formModal('Запустити онбординг', [
        { key: 'staffId', label: 'Співробітник', type: 'select', options: staffOptions, required: true },
        { key: 'templateId', label: 'Шаблон', type: 'select', options: templateOptions, required: true },
        { key: 'responsibleUserId', label: 'Відповідальний', type: 'select', options: responsibleOptions, required: true }
    ], { icon: '🚀' });
    if (!result) return;
    const data = await hrFetch('/onboarding/start', 'POST', {
        staff_id: parseInt(result.staffId),
        template_id: parseInt(result.templateId),
        responsible_user_id: parseInt(result.responsibleUserId)
    });
    if (data?.success) { showNotification('Онбординг запущено', 'success'); loadOnboarding(); }
};

async function refreshSalaryReconciliation() {
    const month = currentSalaryMonth();
    if (!month) { showNotification('Виберіть місяць', 'error'); return; }
    const period = currentSalaryPeriod();
    if (period?.isCustom) {
        showNotification('Звірка доступна для повного місяця. Натисніть «Місяць».', 'warning');
        return;
    }
    const data = await hrFetch(`/salary/reconciliation?month=${month}`);
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося оновити звірку', 'error');
        return;
    }
    renderSalaryPeriodControls(data);
    showNotification('Звірку оновлено', 'success');
}

async function setSalaryPeriodLock(locked) {
    const month = currentSalaryMonth();
    if (!month) { showNotification('Виберіть місяць', 'error'); return; }
    const period = currentSalaryPeriod();
    if (period?.isCustom) {
        showNotification('Закриття періоду доступне тільки для повного місяця. Натисніть «Місяць».', 'warning');
        return;
    }
    const okText = locked ? 'Закрити' : 'Відкрити';
    const message = locked
        ? `Закрити зарплатний період ${month}? Після цього коригування і повторне нарахування будуть заблоковані.`
        : `Відкрити зарплатний період ${month}? Це дозволить коригування і повторну роботу з періодом.`;
    if (!await confirmModal(message, { type: locked ? 'warning' : 'info', okText })) return;
    const data = await hrFetch('/salary/period-lock', 'POST', { month, locked, note: locked ? 'Закрито вручну' : 'Відкрито вручну' });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося оновити період', 'error');
        return;
    }
    renderSalaryPeriodControls(data);
    showNotification(locked ? 'Період закрито' : 'Період відкрито', 'success');
    loadSalary();
}

async function reverseSalaryPeriod() {
    const month = currentSalaryMonth();
    if (!month) { showNotification('Виберіть місяць', 'error'); return; }
    const period = currentSalaryPeriod();
    if (period?.isCustom) {
        showNotification('Сторно доступне тільки для повного місяця. Натисніть «Місяць».', 'warning');
        return;
    }
    const reason = await promptModal(`Причина сторно зарплати за ${month}`, {
        placeholder: 'Наприклад: виправлення ставок або помилкове нарахування',
        defaultValue: 'Корекція зарплатного періоду'
    });
    if (reason === null) return;
    if (!await confirmModal(`Сторнувати активні нарахування зарплати за ${month}? Будуть створені finance сторно-транзакції.`, { type: 'danger', okText: 'Сторнувати' })) return;
    const data = await hrFetch('/salary/reverse', 'POST', { month, reason });
    if (!data?.success) {
        showNotification(data?.error || 'Не вдалося сторнувати зарплату', 'error');
        return;
    }
    showNotification(`Сторновано ${data.count || 0} нарахувань`, 'success');
    loadSalary();
}

// Salary commit uses the same backend payroll calculation as the salary preview.
window.commitSalaries = async function commitSalaries() {
    const month = document.getElementById('salaryMonth')?.value;
    if (!month) { showNotification('Виберіть місяць', 'error'); return; }
    const period = currentSalaryPeriod();
    if (period?.isCustom) {
        showNotification('Нарахування зарплати доступне тільки для повного місяця. Натисніть «Місяць».', 'warning');
        return;
    }
    if (!await confirmModal(`Нарахувати зарплати за ${month}?`, { type: 'danger', okText: 'Нарахувати' })) return;
    const data = await hrFetch('/salary/commit', 'POST', { month });
    if (data?.success) {
        showNotification(`Зарплати нараховано (${data.committed ?? data.count ?? 0} транзакцій)`, 'success');
        loadSalary();
    } else {
        showNotification(data?.error || 'Помилка нарахування', 'error');
    }
};

// ==========================================
// DARK MODE
// ==========================================

function initDarkMode() {
    if (localStorage.getItem('pzp_dark_mode') !== 'false') {
        document.body.classList.add('dark-mode');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
    }
}

// ==========================================
// VACANCIES
// ==========================================

let currentVacancyId = null;
let currentApplications = [];
let currentVacancies = [];
let activeVacancyWorkspaceTab = 'vacancies';
let vacancyPlatformTemplates = [];
let vacancyPlatformAiMeta = null;
const VAC_STATUS_LABEL = {
    open: '🟢 Відкрита', paused: '⏸ Призупинена',
    filled: '✅ Заповнена', closed: '❌ Закрита'
};
const APP_STATUS_LABEL = {
    new: '🆕 Новий', contacted: '📞 Зв\'язались', interview: '🎙️ Співбесіда',
    offer: '📝 Оффер', hired: '✅ Найнятий', rejected: '❌ Відхилено'
};
const APP_STATUS_COLOR = {
    new: '#64748B', contacted: '#3B82F6', interview: '#8B5CF6',
    offer: '#F59E0B', hired: '#10B981', rejected: '#EF4444'
};
const RESUME_ACCEPT = '.txt,.md,.csv,.json,.pdf,.doc,.docx,.rtf,.odt';
const FALLBACK_VACANCY_PLATFORM_TEMPLATES = [
    { id: 'workua', label: 'Work.ua', maxChars: 2200, tone: 'структурований, професійний' },
    { id: 'robota', label: 'Robota.ua', maxChars: 2400, tone: 'офіційний, конкретний' },
    { id: 'olx', label: 'OLX Робота', maxChars: 1300, tone: 'короткий і прямий' },
    { id: 'instagram', label: 'Instagram', maxChars: 1100, tone: 'живий, для соцмереж' },
    { id: 'telegram', label: 'Telegram', maxChars: 1400, tone: 'лаконічний, сканований' },
    { id: 'facebook', label: 'Facebook', maxChars: 1600, tone: 'теплий, репутаційний' }
];

function selectedVacancy() {
    return currentVacancies.find(v => parseInt(v.id, 10) === parseInt(currentVacancyId, 10)) || null;
}

function setVacancyWorkspaceTab(tab) {
    const next = ['vacancies', 'responses', 'interviews', 'templates'].includes(tab) ? tab : 'vacancies';
    activeVacancyWorkspaceTab = next;
    document.querySelectorAll('[data-vacancy-tab]').forEach(button => {
        const active = button.dataset.vacancyTab === next;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-vacancy-panel]').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.vacancyPanel === next);
    });
    if (next === 'responses') renderVacancyResponses();
    if (next === 'interviews') renderInterviewResults();
    if (next === 'templates') renderVacancyTemplateStudio();
}

function initVacancyWorkspaceTabs() {
    document.querySelectorAll('[data-vacancy-tab]').forEach(button => {
        if (button.dataset.bound === 'true') return;
        button.dataset.bound = 'true';
        button.addEventListener('click', () => setVacancyWorkspaceTab(button.dataset.vacancyTab));
    });
    const closeBtn = document.getElementById('btnCloseCandidates');
    if (closeBtn && closeBtn.dataset.bound !== 'true') {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', () => {
            const section = document.getElementById('candidatesSection');
            if (section) section.style.display = 'none';
            currentVacancyId = null;
            currentApplications = [];
            renderVacancyResponses();
            renderInterviewResults();
            renderVacancyTemplateStudio();
        });
    }
}

async function loadVacancyPlatformTemplates() {
    if (vacancyPlatformTemplates.length) return vacancyPlatformTemplates;
    const data = await hrFetch('/vacancy-platforms').catch(() => null);
    vacancyPlatformTemplates = Array.isArray(data?.templates) && data.templates.length
        ? data.templates
        : FALLBACK_VACANCY_PLATFORM_TEMPLATES;
    vacancyPlatformAiMeta = data?.ai || null;
    return vacancyPlatformTemplates;
}

function vacancyPlatformTemplateOptions(selected = '') {
    const templates = vacancyPlatformTemplates.length ? vacancyPlatformTemplates : FALLBACK_VACANCY_PLATFORM_TEMPLATES;
    return templates.map(template => {
        const value = template.id;
        return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(template.label)}</option>`;
    }).join('');
}

function vacancyTemplateSourceOptions(selectedId = '') {
    const options = currentVacancies.map(v => {
        const value = String(v.id);
        const selected = selectedId ? value === String(selectedId) : value === String(currentVacancyId || '');
        return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(v.title || 'Вакансія')}</option>`;
    }).join('');
    return `<option value="">Вручну / без вакансії</option>${options}`;
}

function vacancySourcePayload() {
    const sourceSelect = document.getElementById('vacancyTemplateSource');
    const selectedId = sourceSelect?.value || currentVacancyId || '';
    const vacancy = currentVacancies.find(v => String(v.id) === String(selectedId)) || selectedVacancy() || {};
    return {
        id: vacancy.id || null,
        title: vacancy.title || '',
        role_type: vacancy.role_type || '',
        department: vacancy.department || '',
        description: vacancy.description || '',
        requirements: vacancy.requirements || '',
        salary_from: vacancy.salary_from || null,
        salary_to: vacancy.salary_to || null,
        schedule: vacancy.schedule || '',
        work_format: vacancy.work_format || ''
    };
}

function renderVacancyTemplateStudio() {
    const platformSelect = document.getElementById('vacancyPlatformSelect');
    const sourceSelect = document.getElementById('vacancyTemplateSource');
    const meta = document.getElementById('vacancyTemplateAiMeta');
    if (!platformSelect || !sourceSelect) return;
    const currentPlatform = platformSelect.value || vacancyPlatformTemplates[0]?.id || FALLBACK_VACANCY_PLATFORM_TEMPLATES[0].id;
    platformSelect.innerHTML = vacancyPlatformTemplateOptions(currentPlatform);
    sourceSelect.innerHTML = vacancyTemplateSourceOptions(sourceSelect.value);
    if (meta) {
        const configured = vacancyPlatformAiMeta?.configured ? 'AI підключений' : 'AI fallback активний до підключення ключа';
        const model = vacancyPlatformAiMeta?.model || 'mini';
        meta.textContent = `Каркас під форматування mini-моделлю: ${configured}, модель ${model}.`;
    }
}

function selectedVacancyTitle() {
    return selectedVacancy()?.title || 'оберіть вакансію';
}

function renderVacancyResponses() {
    const root = document.getElementById('vacancyResponsesList');
    const hint = document.getElementById('vacancyResponsesHint');
    if (!root) return;
    if (hint) hint.textContent = currentVacancyId
        ? `Відгуки для вакансії: ${selectedVacancyTitle()}`
        : 'Оберіть вакансію у вкладці "Вакансії", щоб бачити відгуки, резюме та джерело кандидата.';
    if (!currentVacancyId) {
        root.innerHTML = '<div class="vacancy-empty-state">Вакансія ще не вибрана. Відкрийте потрібну вакансію у списку.</div>';
        return;
    }
    if (!currentApplications.length) {
        root.innerHTML = '<div class="vacancy-empty-state">Відгуків по цій вакансії ще немає.</div>';
        return;
    }
    root.innerHTML = currentApplications.map(candidate => {
        const files = Array.isArray(candidate.resume_files) ? candidate.resume_files : [];
        const responseText = candidate.raw_application_text || candidate.experience || candidate.notes || 'Текст відгуку ще не доданий.';
        const source = candidate.source || 'manual';
        return `
            <article class="vacancy-response-row">
                <div class="vacancy-response-head">
                    <div>
                        <h4>${escapeHtml(candidate.name || 'Кандидат')}</h4>
                        <span>${escapeHtml(APP_STATUS_LABEL[candidate.status] || candidate.status || 'new')} · джерело: ${escapeHtml(source)}</span>
                    </div>
                    <span>${files.length ? `${files.length} файл(и)` : 'без файлів'}</span>
                </div>
                <p class="vacancy-response-text">${escapeHtml(responseText).slice(0, 700)}</p>
                <div class="kc-actions">
                    <button type="button" class="kc-btn" onclick="openCandidateDetail(${candidate.id})">Картка</button>
                    <button type="button" class="kc-btn" onclick="moveCandidate(${candidate.id},'interview')">На співбесіду</button>
                    <button type="button" class="kc-btn danger" onclick="moveCandidate(${candidate.id},'rejected')">Відхилити</button>
                </div>
            </article>
        `;
    }).join('');
}

function renderInterviewResults() {
    const root = document.getElementById('vacancyInterviewsList');
    const hint = document.getElementById('vacancyInterviewsHint');
    if (!root) return;
    if (hint) hint.textContent = currentVacancyId
        ? `Співбесіди для вакансії: ${selectedVacancyTitle()}`
        : 'Оберіть вакансію у вкладці "Вакансії", щоб бачити результати співбесід.';
    if (!currentVacancyId) {
        root.innerHTML = '<div class="vacancy-empty-state">Вакансія ще не вибрана. Спершу відкрийте її у списку.</div>';
        return;
    }
    const interviews = currentApplications.filter(candidate => (
        ['interview', 'offer', 'hired', 'rejected'].includes(candidate.status)
        || candidate.interview_notes
        || candidate.interview_date
    ));
    if (!interviews.length) {
        root.innerHTML = '<div class="vacancy-empty-state">Співбесіди по цій вакансії ще не зафіксовані.</div>';
        return;
    }
    root.innerHTML = interviews.map(candidate => `
        <article class="vacancy-interview-row">
            <div class="vacancy-interview-head">
                <div>
                    <h4>${escapeHtml(candidate.name || 'Кандидат')}</h4>
                    <span>${escapeHtml(APP_STATUS_LABEL[candidate.status] || candidate.status || 'new')}${candidate.interview_date ? ` · ${new Date(candidate.interview_date).toLocaleDateString('uk-UA')}` : ''}</span>
                </div>
                ${candidate.salary_expectation ? `<span>${escapeHtml(candidate.salary_expectation)} грн</span>` : ''}
            </div>
            <p class="vacancy-interview-notes">${escapeHtml(candidate.interview_notes || candidate.notes || 'Результат співбесіди ще не описаний.').slice(0, 700)}</p>
            <div class="kc-actions">
                <button type="button" class="kc-btn" onclick="openCandidateDetail(${candidate.id})">Картка</button>
                <button type="button" class="kc-btn" onclick="moveCandidate(${candidate.id},'offer')">Оффер</button>
                <button type="button" class="kc-btn success" onclick="hireCandidate(${candidate.id})">Найняти</button>
                <button type="button" class="kc-btn danger" onclick="moveCandidate(${candidate.id},'rejected')">Відхилити</button>
            </div>
        </article>
    `).join('');
}

async function formatVacancyPlatformText() {
    const platform = document.getElementById('vacancyPlatformSelect')?.value || 'workua';
    const sourceText = document.getElementById('vacancyTemplateSourceText')?.value || '';
    const output = document.getElementById('vacancyTemplateOutput');
    const status = document.getElementById('vacancyTemplateStatus');
    const button = document.getElementById('btnFormatVacancyPlatform');
    if (status) status.textContent = 'Форматую текст...';
    if (button) button.disabled = true;
    try {
        const data = await hrFetch('/vacancy-platforms/format-preview', {
            method: 'POST',
            body: {
                platform,
                vacancy: vacancySourcePayload(),
                source_text: sourceText
            }
        });
        if (!data?.success) throw new Error(data?.error || 'Не вдалося відформатувати');
        if (output) output.value = data.formatted_text || '';
        if (status) {
            const mode = data.ai_used ? `AI ${data.ai_model || ''}`.trim() : 'шаблонний fallback';
            status.textContent = `Готово: ${mode}, ${data.template?.label || platform}.`;
        }
    } catch (err) {
        if (status) status.textContent = err.message || 'Помилка форматування';
    } finally {
        if (button) button.disabled = false;
    }
}

async function copyVacancyTemplateOutput() {
    const output = document.getElementById('vacancyTemplateOutput');
    const text = output?.value || '';
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    showNotification('Текст вакансії скопійовано', 'success');
}

async function loadVacancies() {
    initVacancyWorkspaceTabs();
    await loadVacancyPlatformTemplates();
    renderVacancyTemplateStudio();
    const status = document.getElementById('vacStatusFilter')?.value || 'open';
    const list = document.getElementById('vacanciesList');
    if (list) list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:24px">⏳</div>';
    const sec = document.getElementById('candidatesSection');
    if (sec) sec.style.display = 'none';
    currentVacancyId = null;
    currentApplications = [];
    renderVacancyResponses();
    renderInterviewResults();

    const data = await hrFetch(`/vacancies?status=${status}`);
    if (!data?.success) {
        if (list) list.innerHTML = '<div style="text-align:center;color:var(--danger);padding:24px">Помилка завантаження</div>';
        return;
    }
    const vacancies = data.vacancies || [];
    currentVacancies = vacancies;
    renderVacancyTemplateStudio();

    const urgent = vacancies.filter(v => v.priority === 'urgent' && v.status === 'open').length;
    const open = vacancies.filter(v => v.status === 'open').length;
    const totalC = vacancies.reduce((s, v) => s + (parseInt(v.active_candidates) || 0), 0);
    const stats = document.getElementById('vacStats');
    if (stats) stats.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
            <div class="vac-stat-card"><span class="vac-stat-num">${open}</span><span class="vac-stat-label">Відкритих</span></div>
            ${urgent ? `<div class="vac-stat-card urgent"><span class="vac-stat-num">${urgent}</span><span class="vac-stat-label">🔴 Терміново</span></div>` : ''}
            <div class="vac-stat-card"><span class="vac-stat-num">${totalC}</span><span class="vac-stat-label">Кандидатів</span></div>
        </div>`;

    if (!vacancies.length) {
        if (list) list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px">Вакансій немає. Натисни "+ Вакансія"</div>';
        return;
    }
    if (list) list.innerHTML = vacancies.map(v => `
        <div class="hr-vacancy-card" onclick="openCandidates(${v.id},'${escapeHtml(v.title).replace(/'/g,"\\'")}')">
            <div class="vac-header">
                ${v.priority === 'urgent' ? '<span class="vac-badge urgent">🔴 ТЕРМІНОВО</span>' : ''}
                <span class="vac-badge">${VAC_STATUS_LABEL[v.status] || v.status}</span>
                <span class="vac-apps" title="Кандидатів">👥 ${v.active_candidates || 0}</span>
            </div>
            <div class="vac-title">${escapeHtml(v.title)}</div>
            <div class="vac-role">${ROLE_LABELS[v.role_type] || v.role_type}</div>
            ${v.schedule ? `<div class="vac-meta">🕐 ${escapeHtml(v.schedule)}</div>` : ''}
            ${v.salary_from || v.salary_to ? `<div class="vac-meta">💰 ${v.salary_from || '?'}–${v.salary_to || '?'} ₴</div>` : ''}
            ${v.description ? `<div class="vac-desc">${escapeHtml(v.description.slice(0, 120))}${v.description.length > 120 ? '…' : ''}</div>` : ''}
            <div class="vac-actions" onclick="event.stopPropagation()">
                ${v.status === 'open' ? `<button type="button" class="btn-vac-action" onclick="patchVacancy(${v.id},'paused')">Призупинити</button>` : ''}
                ${v.status !== 'filled' && v.status !== 'closed' ? `<button type="button" class="btn-vac-action filled" onclick="patchVacancy(${v.id},'filled')">Заповнено</button>` : ''}
                ${v.status === 'paused' ? `<button type="button" class="btn-vac-action" onclick="patchVacancy(${v.id},'open')">Відкрити</button>` : ''}
                <button type="button" class="btn-vac-action danger" onclick="patchVacancy(${v.id},'closed')">Закрити</button>
            </div>
        </div>
    `).join('');
    document.getElementById('vacStatusFilter').onchange = loadVacancies;
    setVacancyWorkspaceTab(activeVacancyWorkspaceTab);
}

async function patchVacancy(id, status) {
    await hrFetch(`/vacancies/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    loadVacancies();
}

async function openCandidates(vacancyId, title) {
    currentVacancyId = vacancyId;
    document.getElementById('candidatesTitle').textContent = `Кандидати: ${title}`;
    document.getElementById('candidatesSection').style.display = 'block';
    document.getElementById('candidatesSection')?.scrollIntoView({ behavior: 'smooth' });
    await refreshCandidates();
    document.getElementById('btnAddCandidate').onclick = () => addCandidatePrompt(vacancyId);
    renderVacancyTemplateStudio();
}

async function refreshCandidates() {
    if (!currentVacancyId) return;
    const data = await hrFetch(`/vacancies/${currentVacancyId}/applications`);
    if (!data?.success) return;
    const apps = data.applications || [];
    currentApplications = apps;
    renderVacancyResponses();
    renderInterviewResults();
    const statuses = ['new', 'contacted', 'interview', 'offer'];
    const kanban = document.getElementById('candidatesKanban');
    if (!kanban) return;
    kanban.innerHTML = statuses.map(s => `
        <div class="kanban-col">
            <div class="kanban-col-title" style="border-top:3px solid ${APP_STATUS_COLOR[s]}">
                ${APP_STATUS_LABEL[s]} <span class="kanban-count">${apps.filter(a => a.status === s).length}</span>
            </div>
            <div class="kanban-cards">
                ${apps.filter(a => a.status === s).map(a => `
                    <div class="kanban-card">
                        <div class="kc-name">${escapeHtml(a.name)}</div>
                        ${a.phone ? `<div class="kc-meta">📞 ${escapeHtml(a.phone)}</div>` : ''}
                        ${a.telegram_username ? `<div class="kc-meta">✈️ @${escapeHtml(a.telegram_username)}</div>` : ''}
                        ${a.birth_date ? `<div class="kc-meta">🎂 ${new Date(a.birth_date).toLocaleDateString('uk-UA')}</div>` : ''}
                        ${a.address ? `<div class="kc-meta">📍 ${escapeHtml(a.address)}</div>` : ''}
                        ${a.availability ? `<div class="kc-meta">🕒 ${escapeHtml(a.availability)}</div>` : ''}
                        ${a.salary_expectation ? `<div class="kc-meta">💰 ${a.salary_expectation} ₴</div>` : ''}
                        ${a.interview_date ? `<div class="kc-meta">📅 ${new Date(a.interview_date).toLocaleDateString('uk-UA')}</div>` : ''}
                        ${a.experience ? `<div class="kc-meta">${escapeHtml(a.experience).slice(0, 120)}</div>` : ''}
                        ${a.interview_notes ? `<div class="kc-meta">${escapeHtml(a.interview_notes).slice(0, 120)}</div>` : ''}
                        ${candidateResumeBadgeHtml(a)}
                        <div class="kc-actions">
                            <button type="button" class="kc-btn" onclick="openCandidateDetail(${a.id})">Резюме</button>
                            ${s !== 'offer' ? `<button type="button" class="kc-btn" onclick="moveCandidate(${a.id},'${nextCandidateStatus(s)}')">→ ${APP_STATUS_LABEL[nextCandidateStatus(s)]}</button>` : ''}
                            ${s === 'offer' ? `<button type="button" class="kc-btn success" onclick="hireCandidate(${a.id})">Найняти</button>` : ''}
                            <button type="button" class="kc-btn danger" onclick="moveCandidate(${a.id},'rejected')">Відхилити</button>
                        </div>
                    </div>
                `).join('') || '<div style="color:var(--gray-400);font-size:12px;padding:8px">Порожньо</div>'}
            </div>
        </div>
    `).join('');
}

function candidateResumeBadgeHtml(candidate) {
    const files = Array.isArray(candidate.resume_files) ? candidate.resume_files : [];
    const hasText = Boolean(String(candidate.raw_application_text || '').trim());
    if (!hasText && !files.length) return '';
    const parts = [];
    if (hasText) parts.push('текст');
    if (files.length) parts.push(`${files.length} файл${files.length === 1 ? '' : 'и'}`);
    return `<div class="kc-resume-pill">Резюме: ${escapeHtml(parts.join(' + '))}</div>`;
}

function findCurrentApplication(id) {
    return currentApplications.find(app => parseInt(app.id, 10) === parseInt(id, 10)) || null;
}

function renderResumeFiles(files = []) {
    if (!files.length) {
        return '<div class="candidate-detail-empty">Файли резюме ще не додані.</div>';
    }
    return files.map(file => `
        <div class="candidate-resume-file">
            <div>
                <strong>${escapeHtml(file.original_name || 'resume')}</strong>
                <span>${escapeHtml(file.mime_type || file.file_ext || 'файл')} · ${formatResumeFileSize(file.file_size)}</span>
                <em>${escapeHtml(file.extraction_note || (file.extraction_status === 'extracted' ? 'Текст імпортовано' : 'Збережено як вкладення'))}</em>
            </div>
            <button type="button" class="kc-btn" onclick="downloadResumeFile(${file.application_id}, ${file.id})">Завантажити</button>
        </div>
        ${file.extracted_text ? `<pre class="candidate-resume-extracted">${escapeHtml(file.extracted_text)}</pre>` : ''}
    `).join('');
}

function closeCandidateDetailModal() {
    document.getElementById('candidateDetailModal')?.remove();
}

function openCandidateDetail(id) {
    const candidate = findCurrentApplication(id);
    if (!candidate) return;
    closeCandidateDetailModal();
    const files = Array.isArray(candidate.resume_files) ? candidate.resume_files : [];
    const overlay = document.createElement('div');
    overlay.id = 'candidateDetailModal';
    overlay.className = 'candidate-detail-overlay';
    overlay.innerHTML = `
        <div class="candidate-detail-modal" role="dialog" aria-modal="true" aria-labelledby="candidateDetailTitle">
            <div class="candidate-detail-head">
                <div>
                    <span class="candidate-detail-kicker">Картка кандидата</span>
                    <h3 id="candidateDetailTitle">${escapeHtml(candidate.name || 'Кандидат')}</h3>
                    <p>${escapeHtml(APP_STATUS_LABEL[candidate.status] || candidate.status || '')}</p>
                </div>
                <button type="button" class="candidate-detail-close" onclick="closeCandidateDetailModal()" aria-label="Закрити">×</button>
            </div>
            <div class="candidate-detail-grid">
                <section>
                    <h4>Контакти і рекрутерські нотатки</h4>
                    ${candidate.phone ? `<div class="candidate-detail-row"><span>Телефон</span><strong>${escapeHtml(candidate.phone)}</strong></div>` : ''}
                    ${candidate.telegram_username ? `<div class="candidate-detail-row"><span>Telegram</span><strong>@${escapeHtml(candidate.telegram_username)}</strong></div>` : ''}
                    ${candidate.availability ? `<div class="candidate-detail-row"><span>Доступність</span><strong>${escapeHtml(candidate.availability)}</strong></div>` : ''}
                    ${candidate.experience ? `<p>${escapeHtml(candidate.experience)}</p>` : '<div class="candidate-detail-empty">Досвід не заповнений.</div>'}
                    ${candidate.interview_notes ? `<p><strong>Нотатки:</strong> ${escapeHtml(candidate.interview_notes)}</p>` : ''}
                </section>
                <section>
                    <h4>Текст резюме / анкети</h4>
                    ${candidate.raw_application_text ? `<pre class="candidate-resume-text">${escapeHtml(candidate.raw_application_text)}</pre>` : '<div class="candidate-detail-empty">Текст ще не доданий. Можна вставити вручну або імпортувати з TXT/CSV/MD/JSON файлу.</div>'}
                </section>
                <section class="candidate-detail-wide">
                    <h4>Вкладені файли</h4>
                    ${renderResumeFiles(files)}
                </section>
            </div>
        </div>
    `;
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeCandidateDetailModal();
    });
    document.body.appendChild(overlay);
}

async function downloadResumeFile(applicationId, fileId) {
    const candidate = findCurrentApplication(applicationId);
    const file = (candidate?.resume_files || []).find(item => parseInt(item.id, 10) === parseInt(fileId, 10));
    const filename = file?.original_name || 'resume';
    const token = localStorage.getItem('pzp_token');
    const touchWindow = typeof openTouchDownloadWindow === 'function'
        ? openTouchDownloadWindow('Файл резюме')
        : null;
    try {
        const response = await fetch(`/api/hr/applications/${applicationId}/resume-files/${fileId}/download`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!response.ok) {
            showNotification('Не вдалося завантажити файл резюме', 'error');
            if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
            return;
        }
        const blob = await response.blob();
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename || 'resume', { touchWindow, successMessage: 'Файл резюме підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename || 'resume';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Не вдалося завантажити файл резюме', 'error');
    }
}

function nextCandidateStatus(s) {
    const chain = ['new', 'contacted', 'interview', 'offer', 'hired'];
    return chain[chain.indexOf(s) + 1] || 'hired';
}

async function moveCandidate(id, status) {
    await hrFetch(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    refreshCandidates();
}

async function hireCandidate(id) {
    if (!await confirmModal('Найняти кандидата? Буде створений запис у команді.', { type: 'danger' })) return;
    const res = await hrFetch(`/applications/${id}/hire`, { method: 'POST', body: JSON.stringify({}) });
    if (res?.success) {
        showNotification(res.message || 'Кандидата найнято!', 'success');
        loadVacancies();
        refreshCandidates();
    }
}

function closeCandidateIntakeModal() {
    document.getElementById('candidateIntakeModal')?.remove();
}

function candidateNameFromFile(file) {
    return String(file?.name || 'Кандидат')
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim() || 'Кандидат з резюме';
}

function renderCandidateIntakeFiles(input) {
    const list = document.getElementById('candidateResumeFilesList');
    const help = document.getElementById('candidateResumeImportHelp');
    const files = Array.from(input?.files || []);
    if (list) {
        list.innerHTML = files.length
            ? files.map(file => `<span class="candidate-file-chip">${escapeHtml(file.name)} · ${formatResumeFileSize(file.size)}</span>`).join('')
            : '<span class="candidate-file-empty">Файли не вибрані</span>';
    }
    if (help) {
        const hasOnlyText = files.some(file => /\.(txt|md|csv|json)$/i.test(file.name || '') || String(file.type || '').startsWith('text/'));
        help.textContent = files.length
            ? (hasOnlyText ? 'Текстові файли будуть імпортовані у резюме. PDF/DOC/DOCX збережуться як вкладення.' : 'Файли будуть збережені як вкладення; для PDF/DOC/DOCX вставте текст резюме вручну, якщо потрібно.')
            : 'Можна додати текст, файли або обидва варіанти.';
    }
}

function addCandidatePrompt(vacancyId) {
    closeCandidateIntakeModal();
    const overlay = document.createElement('div');
    overlay.id = 'candidateIntakeModal';
    overlay.className = 'candidate-detail-overlay candidate-intake-overlay';
    overlay.innerHTML = `
        <form class="candidate-intake-modal" id="candidateIntakeForm" role="dialog" aria-modal="true" aria-labelledby="candidateIntakeTitle">
            <div class="candidate-detail-head">
                <div>
                    <span class="candidate-detail-kicker">HR вакансії</span>
                    <h3 id="candidateIntakeTitle">Додати кандидата</h3>
                    <p>Заповніть картку вручну, вставте текст резюме або додайте файл.</p>
                </div>
                <button type="button" class="candidate-detail-close" onclick="closeCandidateIntakeModal()" aria-label="Закрити">×</button>
            </div>
            <div class="candidate-intake-grid">
                <label>Ім'я кандидата<input name="name" placeholder="Іван Петренко"></label>
                <label>Телефон<input name="phone" placeholder="+380..."></label>
                <label>Telegram<input name="telegram_username" placeholder="@username"></label>
                <label>Дата народження<input name="birth_date" type="date"></label>
                <label class="wide">Адреса<input name="address" placeholder="Місто, район, вулиця"></label>
                <label class="wide">Доступність<input name="availability" placeholder="Будні після 16:00, вихідні повний день"></label>
                <label class="wide">Досвід<textarea name="experience" rows="3" placeholder="Коротко про досвід і ролі"></textarea></label>
                <label class="wide">Нотатки інтерв'ю<textarea name="interview_notes" rows="3" placeholder="Що важливо перевірити або уточнити"></textarea></label>
                <label class="wide">Текст резюме / анкети<textarea name="raw_application_text" rows="6" placeholder="Вставте резюме, анкету або текст із форми"></textarea></label>
                <div class="candidate-upload-card wide">
                    <div>
                        <strong>Файли резюме</strong>
                        <span id="candidateResumeImportHelp">Можна додати текст, файли або обидва варіанти.</span>
                    </div>
                    <input id="candidateResumeFiles" name="resume_files" type="file" accept="${RESUME_ACCEPT}" multiple>
                    <div id="candidateResumeFilesList" class="candidate-file-list"><span class="candidate-file-empty">Файли не вибрані</span></div>
                </div>
            </div>
            <div class="candidate-intake-actions">
                <span id="candidateIntakeStatus"></span>
                <button type="button" class="btn-secondary" onclick="closeCandidateIntakeModal()">Скасувати</button>
                <button type="submit" class="btn-add">Зберегти кандидата</button>
            </div>
        </form>
    `;
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeCandidateIntakeModal();
    });
    document.body.appendChild(overlay);
    const fileInput = document.getElementById('candidateResumeFiles');
    fileInput?.addEventListener('change', () => renderCandidateIntakeFiles(fileInput));
    document.getElementById('candidateIntakeForm')?.addEventListener('submit', event => handleCandidateIntakeSubmit(event, vacancyId));
}

async function handleCandidateIntakeSubmit(event, vacancyId) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('candidateIntakeStatus');
    const submit = form.querySelector('button[type="submit"]');
    const files = Array.from(document.getElementById('candidateResumeFiles')?.files || []);
    const formData = new FormData(form);
    let name = String(formData.get('name') || '').trim();
    if (!name && files.length) name = candidateNameFromFile(files[0]);
    if (!name) {
        if (status) status.textContent = 'Вкажіть імʼя або додайте файл резюме.';
        return;
    }
    if (submit) submit.disabled = true;
    if (status) status.textContent = 'Створюю кандидата...';
    try {
        const created = await hrFetch(`/vacancies/${vacancyId}/applications`, {
            method: 'POST',
            body: {
                name,
                phone: String(formData.get('phone') || '').trim() || null,
                telegram_username: String(formData.get('telegram_username') || '').trim() || null,
                birth_date: formData.get('birth_date') || null,
                address: String(formData.get('address') || '').trim() || null,
                availability: String(formData.get('availability') || '').trim() || null,
                experience: String(formData.get('experience') || '').trim() || null,
                interview_notes: String(formData.get('interview_notes') || '').trim() || null,
                raw_application_text: String(formData.get('raw_application_text') || '').trim() || null
            }
        });
        if (!created?.success || !created.application?.id) {
            throw new Error(created?.error || 'Не вдалося створити кандидата');
        }
        if (files.length) {
            if (status) status.textContent = 'Завантажую резюме...';
            const uploadBody = new FormData();
            files.forEach(file => uploadBody.append('files', file));
            const uploaded = await hrFetch(`/applications/${created.application.id}/resume-files`, {
                method: 'POST',
                body: uploadBody
            });
            if (!uploaded?.success) {
                showNotification(uploaded?.error || 'Кандидата створено, але файл резюме не завантажився', 'error');
            } else if (!uploaded.extracted_text_appended) {
                showNotification('Файл резюме збережено. Для PDF/DOC/DOCX текст можна додати вручну у картці кандидата.', 'info');
            }
        }
        closeCandidateIntakeModal();
        await refreshCandidates();
    } catch (err) {
        if (status) status.textContent = err.message || 'Помилка збереження кандидата';
        if (submit) submit.disabled = false;
    }
}

// Vacancy create button
document.getElementById('btnAddVacancy')?.addEventListener('click', async () => {
    const roleKeys = Object.keys(ROLE_LABELS);
    const roleOptions = roleKeys.map(k => ({ value: k, label: ROLE_LABELS[k] }));
    const result = await formModal('Нова вакансія', [
        { key: 'title', label: 'Назва вакансії', required: true, placeholder: 'Аніматор на свята' },
        { key: 'role_type', label: 'Роль', type: 'select', options: roleOptions, required: true },
        { key: 'salary_from', label: 'Зарплата від (₴)', type: 'number', placeholder: '0' },
        { key: 'salary_to', label: 'Зарплата до (₴)', type: 'number', placeholder: '0' },
        { key: 'schedule', label: 'Графік', placeholder: 'Пн-Пт 10:00-18:00' }
    ], { icon: '📋' });
    if (!result) return;
    const priority = (await confirmModal('Терміново?', { type: 'danger' })) ? 'urgent' : 'normal';
    hrFetch('/vacancies', {
        method: 'POST',
        body: JSON.stringify({
            title: result.title.trim(),
            role_type: result.role_type,
            salary_from: parseInt(result.salary_from) || null,
            salary_to: parseInt(result.salary_to) || null,
            schedule: result.schedule || null,
            priority
        })
    }).then(r => { if (r?.success) loadVacancies(); });
});

// ==========================================
// BOOT
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
