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
    it_specialist: 'IT-спеціаліст', hr: 'HR-менеджер', hr_manager: 'HR-менеджер',
    admin: 'Адмін', security: 'Охорона',
    senior_instructor: 'Старший інструктор', instructor: 'Інструктор',
    trampoline_instructor: 'Інструктор батутів',
    head_chef: 'Шеф-повар', head_cook: 'Шеф-повар', cook: 'Повар',
    head_pastry: 'Шеф-кондитер', pastry_chef: 'Кондитер',
    animator: 'Аніматор', host: 'Ведуча', technician: 'Технік',
    reception: 'Рецепція', barista: 'Бариста', bartender: 'Бармен',
    waiter: 'Офіціант', wardrobe: 'Гардеробник',
    cleaning: 'Клінінг', cleaner: 'Прибиральник', maintenance: 'Технік',
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

const HR_NAV_GROUPS = [
    {
        id: 'pulse',
        label: 'Пульс компанії',
        items: [
            { id: 'today', label: 'Сьогодні' },
            { id: 'schedule', label: 'Графік', href: '/staff' },
            { id: 'reports', label: 'Звіти' }
        ]
    },
    {
        id: 'people',
        label: 'Команда',
        items: [
            { id: 'team', label: 'Команда', tab: 'team' }
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
            { id: 'kpi', label: 'KPI' }
        ]
    },
    {
        id: 'other',
        label: 'Тимчасове',
        note: 'нерозподілені HR-розділи',
        items: [
            { id: 'onboarding', label: 'Onboarding' },
            { id: 'vacancies', label: 'Вакансії' },
            { id: 'costumes', label: 'Костюми', href: '/art?tab=costumes' }
        ]
    }
];

const HR_STRUCTURE_WORKSPACE_TABS = new Set(['structure', 'professions', 'checklists', 'accounts']);
const HR_PAYROLL_WORKSPACE_TABS = new Set(['salary', 'kpi']);
const HR_OTHER_WORKSPACE_TABS = new Set(['onboarding', 'vacancies']);

const HR_TAB_ALIASES = {
    other: { tab: 'onboarding' },
    payroll: { tab: 'salary' },
    workers: { tab: 'team', bucket: 'workers' },
    rating: { tab: 'kpi' },
    ratings: { tab: 'kpi' },
    leaves: { tab: 'schedule' },
    reserve: { tab: 'team', bucket: 'reserve' },
    blacklist: { tab: 'team', bucket: 'blacklist' },
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
    const rates = professionKeys
        .map(key => ({ key, label: professionTitle(key), rate: staffProfessionRateFor(staff, key) }))
        .filter(item => Number(item.rate) > 0);
    if (!rates.length) return '';
    const baseRate = Number(staff.hourly_rate || 0);
    const hasOverrides = staffProfessionRateRows(staff).length > 0;
    if (!hasOverrides && baseRate > 0) return `${baseRate} ₴/год`;
    return rates.slice(0, 3).map(item => `${item.label}: ${item.rate} ₴/год`).join(' · ');
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
        .filter(target => target.id !== currentBucket && canSeeHrTeamBucket(target.id))
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
    if (resp.status === 401 || resp.status === 403) {
        localStorage.removeItem('pzp_token');
        location.href = '/';
        return null;
    }
    return resp.json();
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
    document.getElementById('salaryMonth')?.addEventListener('change', loadSalary);
    document.getElementById('kpiMonth')?.addEventListener('change', loadKpi);
    document.getElementById('btnAddAdjustment')?.addEventListener('click', showAdjustmentForm);
    document.getElementById('btnStartOnboarding')?.addEventListener('click', showStartOnboarding);
    document.getElementById('btnSaveCompanyStructure')?.addEventListener('click', saveCompanyStructure);
    document.getElementById('btnAddProfession')?.addEventListener('click', () => openProfessionEditor());
    bindSecondaryProfessionPicker();
    document.getElementById('editRoleType')?.addEventListener('change', () => {
        const selected = readStaffSecondaryProfessionSelection();
        populateSecondaryProfessionSelect(selected, document.getElementById('editRoleType')?.value);
        refreshStaffRateEditorFromCurrentForm();
    });
    document.getElementById('editHourlyRate')?.addEventListener('input', refreshStaffRateEditorFromCurrentForm);
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

function hrWorkspaceGroupId(target) {
    if (isHrStructureWorkspaceTab(target)) return 'structure';
    if (isHrPayrollWorkspaceTab(target)) return 'payroll';
    if (isHrOtherWorkspaceTab(target)) return 'other';
    return '';
}

function updateHrPageTitle(target) {
    const title = document.getElementById('hrPageTitle');
    if (!title) return;
    if (isHrStructureWorkspaceTab(target)) title.textContent = 'Структура';
    else if (isHrPayrollWorkspaceTab(target)) title.textContent = 'ЗП та KPI';
    else if (isHrOtherWorkspaceTab(target)) title.textContent = 'Тимчасове';
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
    nav.classList.toggle('hr-nav--structure-only', workspaceMode);
    nav.setAttribute('aria-label', workspaceGroupId === 'structure' ? 'Навігація структури' : workspaceGroupId === 'payroll' ? 'Навігація ЗП та KPI' : workspaceGroupId === 'other' ? 'Навігація тимчасових HR-розділів' : 'HR navigation');
    const groups = HR_NAV_GROUPS
        .filter(group => workspaceGroupId ? group.id === workspaceGroupId : group.id === 'pulse')
        .map(group => ({
            ...group,
            items: group.items.filter(isHrNavItemVisible)
        }))
        .filter(group => group.items.length > 0);
    nav.innerHTML = groups.length ? groups.map(group => `
        <section class="hr-nav-group" data-hr-nav-group="${escapeHtml(group.id)}">
            <div class="hr-nav-group-title"${workspaceMode ? ' hidden' : ''}>
                <span>${escapeHtml(group.label)}</span>
                ${group.note ? `<small>${escapeHtml(group.note)}</small>` : ''}
            </div>
            <div class="hr-nav-items">
                ${group.items.map(item => {
                    const tabId = item.tab || item.id;
                    const countBadge = item.bucket ? `<span class="hr-nav-count hidden" data-nav-count="${escapeHtml(item.bucket)}">0</span>` : '';
                    return `
                    <button type="button" class="hr-tab" data-nav-id="${escapeHtml(item.id)}" data-tab="${escapeHtml(tabId)}"${item.bucket ? ` data-bucket="${escapeHtml(item.bucket)}"` : ''}${item.href ? ` data-href="${escapeHtml(item.href)}"` : ''}>${escapeHtml(item.label)}${countBadge}</button>
                `;
                }).join('')}
            </div>
        </section>
    `).join('') : '<div class="hr-nav-empty">Немає доступних HR-розділів</div>';
}

function hashForHrTarget(target, bucket = null) {
    if (target === 'team') {
        if (bucket === 'workers') return 'workers';
        if (bucket === 'interns') return 'interns';
        if (bucket === 'blacklist') return 'blacklist';
        if (bucket === 'reserve') return 'reserve';
    }
    return target;
}

function cssEscapeValue(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
}

function syncHrNavActive(target, bucket = null) {
    document.querySelectorAll('.hr-tab').forEach(t => t.classList.remove('active'));
    if (target === 'team') return;
    const tabSelector = cssEscapeValue(target);
    const bucketSelector = bucket ? `[data-bucket="${cssEscapeValue(bucket)}"]` : ':not([data-bucket])';
    const tab = document.querySelector(`.hr-tab[data-tab="${tabSelector}"]${bucketSelector}`)
        || document.querySelector(`.hr-tab[data-tab="${tabSelector}"]`);
    tab?.classList.add('active');
}

function setHrNavTeamMode(target) {
    const nav = document.getElementById('hrNav');
    if (!nav) return;
    const isTeam = target === 'team';
    nav.hidden = isTeam;
    nav.setAttribute('aria-hidden', isTeam ? 'true' : 'false');
    nav.classList.toggle('hr-nav--team-hidden', isTeam);
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
        return { tab: 'today', href: '/art?tab=costumes', alias: true };
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
        window.location.replace('/art?tab=costumes');
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
        reports: loadReports, salary: loadSalary, kpi: loadKpi, onboarding: loadOnboarding,
        vacancies: loadVacancies, accounts: loadAccountCenter
    };
    await loaders[target]?.();
    removeLegacyAnimatorShiftSummary();
}

// ==========================================
// TAB 1: TODAY
// ==========================================

async function loadToday() {
    if (typeof _loadStaffLinks === 'function') _loadStaffLinks().catch(() => {});
    const data = await hrFetch('/today');
    if (!data || !data.success) return;
    todayData = data;
    renderToday(data);
}

function renderToday(data) {
    const today = new Date();
    const dayName = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П\'ятниця', 'Субота'][today.getDay()];
    document.getElementById('todayDate').textContent =         `${dayName}, ${today.getDate()} ${MONTHS_UK[today.getMonth()]} ${today.getFullYear()}`;

    const s = data.summary;
    document.getElementById('todaySummary').innerHTML = `
        <div class="hr-summary-card green"><div class="value">${s.present}</div><div class="label">На роботі</div></div>
        <div class="hr-summary-card yellow"><div class="value">${s.late}</div><div class="label">Запізнились</div></div>
        <div class="hr-summary-card red"><div class="value">${s.absent}</div><div class="label">Відсутні</div></div>
        <div class="hr-summary-card"><div class="value">${s.sick + s.on_vacation}</div><div class="label">Хвороба / відпустка</div></div>
    `;

    const list = document.getElementById('todayList');
    if (data.data.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:40px;">Немає активних співробітників</div>';
        return;
    }

    list.innerHTML = data.data.map(item => {
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

        const roleLabel = ROLE_LABELS[item.role_type] || item.role_type || '';

        return `<div class="hr-staff-row" data-staff-id="${item.staff_id}" oncontextmenu="showContext(event, ${item.staff_id})">
            <div class="hr-staff-indicator ${indicator}"></div>
            <div class="hr-staff-info">
                <div class="hr-staff-name">${escapeHtml(item.staff_name)} ${typeof staffAccountBadge === 'function' ? staffAccountBadge(item.staff_id, {compact:true}) : ''} <a href="/staff?highlight=${item.staff_id}" class="hr-crosslink" title="Графік" style="font-size:14px;text-decoration:none;opacity:0.5">📅</a></div>
                <div class="hr-staff-meta">${roleLabel}${meta ? ' · ' + meta : ''}</div>
            </div>
            <button type="button" class="hr-clock-btn ${btnClass}" ${disabled}
                onclick="handleClock(${item.staff_id}, '${rec && rec.clock_in && !rec.clock_out ? 'out' : 'in'}', '${escapeHtml(item.staff_name)}', ${rec ? rec.total_worked_minutes || 0 : 0})"
            >${btnText}</button>
        </div>`;
    }).join('');
}

async function handleClock(staffId, action, name, workedMin) {
    if (action === 'out') {
        const worked = fmtMinutes(workedMin) || 'невідомо';
        if (!await confirmModal(`Завершити зміну для ${name}?\nВідпрацьовано: ${worked}`, { type: 'warning', okText: 'Завершити' })) return;
    }
    const endpoint = action === 'out' ? '/clock-out' : '/clock-in';
    const data = await hrFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ staff_id: staffId })
    });
    if (!data) return;
    if (!data.success) {
        showNotification(data.error || 'Помилка', 'error');
        return;
    }
    showNotification(action === 'out' ? 'Зміну завершено' : 'Прихід відмічено', 'success');
    await loadToday();
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        const activeTab = document.querySelector('.hr-tab.active');
        if (activeTab && activeTab.dataset.tab === 'today') loadToday();
    }, 30000);
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
                <button type="button" onclick="openProfessionEditor(${Number(item.id)})">Редагувати</button>
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
                <button type="button" class="btn-secondary" onclick="openProfessionEditor(${Number(item.id)})">Змінити</button>
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
let accountUsers = [];
let accountRoleHierarchy = [];
let accountBusinessContexts = [];
let accountActionDefinitions = [];
let accountStaffOptions = [];
let accountCenterLastUpdatedId = null;
let accountConflicts = null;
let accountDeepLinkApplied = false;
const ACCOUNT_SECURITY_ROLES = ['creator', 'director', 'art_director'];
const ACCOUNT_PROFILE_ROLES = ['creator', 'director', 'art_director'];
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

function normalizeAccountListInput(value) {
    return String(value || '')
        .split(',')
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
    return roles
        .map(role => ({ value: role, label: ROLE_LABELS[role] || role }))
        .sort((a, b) => a.label.localeCompare(b.label, 'uk'))
        .map(option => ({ ...option, selected: option.value === defaultRole }));
}

function getAccountActionOptions(selected = []) {
    const current = new Set(normalizeAccountListInput(Array.isArray(selected) ? selected.join(',') : selected));
    const actions = accountActionDefinitions.length
        ? accountActionDefinitions.map(item => item.key || item)
        : Object.keys(ACCOUNT_ACTION_LABELS);
    return actions
        .filter(Boolean)
        .map(action => ({
            value: action,
            label: ACCOUNT_ACTION_LABELS[action] || action,
            selected: current.has(action)
        }));
}

async function loadAccountRoleDefinitions() {
    if (accountRoleHierarchy.length && accountBusinessContexts.length) return;
    const data = await crmApiFetch('/api/users/roles');
    if (Array.isArray(data?.hierarchy)) {
        accountRoleHierarchy = data.hierarchy.filter(role => ROLE_LABELS[role] || role);
    }
    if (Array.isArray(data?.businessContexts)) {
        accountBusinessContexts = data.businessContexts;
    }
    if (Array.isArray(data?.actions)) {
        accountActionDefinitions = data.actions;
    } else if (data?.actionPermissions && typeof data.actionPermissions === 'object') {
        accountActionDefinitions = Object.keys(data.actionPermissions).map(key => ({ key, roles: data.actionPermissions[key] || [] }));
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

function showOneTimeCredentialModal(credential, title = 'One-time credentials', payload = {}) {
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
                navigator.clipboard.writeText(text).then(() => showNotification('One-time credentials скопійовано', 'success'));
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
    const activeOnly = document.getElementById('teamActiveOnly')?.checked ?? true;
    const grid = document.getElementById('teamGrid');
    if (grid) renderPeopleBucketState('Завантаження команди...', 'loading');
    const data = await hrFetch(`/staff?active=${activeOnly}`);
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
    if (activeEl) activeEl.onchange = loadTeam;
}

function filterAndRenderTeam() {
    const query = normalizeSearchText(document.getElementById('teamSearch')?.value);
    const role = document.getElementById('teamRoleFilter')?.value;

    let filtered = teamStaff;
    if (query) {
        filtered = filtered.filter(s => teamSearchHaystack(s).includes(query));
    }
    if (role) {
        filtered = filtered.filter(s => staffHasProfession(s, role));
    }

    renderTeam(filtered);
}

function renderTeam(staff) {
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
    const forcedBucket = pendingPeopleBucket ? normalizeVisiblePeopleBucket(pendingPeopleBucket) : null;
    if (pendingPeopleBucket) {
        activePeopleBucket = forcedBucket;
        pendingPeopleBucket = null;
    }
    if (!forcedBucket && !buckets.some(bucket => bucket.id === activePeopleBucket)) {
        activePeopleBucket = null;
    }
    const totalCounts = new Map(buckets.map(bucket => [
        bucket.id,
        teamStaff.filter(item => bucketForStaff(item) === bucket.id).length
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
    if (!buckets.some(bucket => bucket.id === activePeopleBucket)) activePeopleBucket = null;
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
    activePeopleBucket = activePeopleBucket === nextBucket ? null : nextBucket;
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

        return `<article class="hr-team-card ${s.is_active ? '' : 'inactive'}" data-staff-id="${Number(s.id)}" data-current-bucket="${escapeHtml(bucketForStaff(s))}" draggable="${canManage ? 'true' : 'false'}">
            <div class="hr-team-card-head">
                <div class="hr-team-avatar" style="${s.color ? 'background:' + s.color + '30;color:' + s.color : ''}">${avatar}</div>
                <div class="hr-team-details">
                    <div class="hr-team-name-row">
                        <div class="hr-team-name">${escapeHtml(s.name)}</div>
                        ${s.is_active ? '' : '<span class="hr-team-status-pill is-muted">звільнений</span>'}
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
            ${contactRows ? `<div class="hr-team-contact-grid">${contactRows}</div>` : '<div class="hr-team-contact-grid is-empty">Контакти не заповнені</div>'}
            ${poolStatus === 'blacklisted' && s.blacklist_reason ? `<div class="hr-team-warning-note">Причина: ${escapeHtml(s.blacklist_reason)}</div>` : ''}
            <div class="hr-team-actions">
                ${accountActions}
                ${canManage ? `<button type="button" class="hr-team-edit" onclick="openStaffEdit(${Number(s.id)})">Профіль</button>
                    <button type="button" class="hr-team-move" onclick="openStaffMoveMenu(${Number(s.id)}, this)">Перемістити</button>` : ''}
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
    if (button) button.disabled = true;
    let data;
    try {
        data = await hrFetch(`/staff/${staff.id}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
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
                ${canManageProfile ? `<button type="button" class="hr-account-toggle" onclick="openAccountProfileModal(${Number(u.id)}, this)">Профіль</button>` : ''}
                ${canManageSecurity ? `<button type="button" class="hr-account-toggle" onclick="openAccountPasswordModal(${Number(u.id)}, this)">Пароль</button>` : ''}
                ${canManageAccess ? `<button type="button" class="hr-account-toggle" onclick="openAccountAccessEditor(${Number(u.id)}, this)">Доступ</button>` : ''}
                <button type="button" class="hr-account-toggle" onclick="toggleAccountActive(${Number(u.id)}, ${active ? 'false' : 'true'}, this)">${active ? 'Вимкнути' : 'Активувати'}</button>
            </div>
        </article>`;
    }).join('');
}

window.openAccountCreateModal = async function(button, context = {}) {
    if (!canManageAccountSecurity()) {
        showNotification('Створення акаунтів доступне тільки creator/director/art director', 'error');
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
    const result = await formModal('Створити CRM акаунт', [
        { key: 'name', label: 'Імʼя в CRM', required: true, defaultValue: defaultName, placeholder: 'Женя Аніматор' },
        { key: 'username', label: 'Логін', required: true, defaultValue: defaultUsername, placeholder: 'zhenya.animator' },
        { key: 'password', label: 'Пароль вручну або порожньо для one-time', type: 'password', placeholder: 'Порожньо = CRM згенерує одноразовий пароль' },
        { key: 'confirmPassword', label: 'Повторити пароль, якщо вводите вручну', type: 'password' },
        { key: 'role', label: 'Основна роль', type: 'select', defaultValue: defaultRole, options: getAccountRoleOptions(defaultRole) },
        { key: 'staffId', label: 'HR staff-профіль', type: 'select', defaultValue: defaultStaffId, options: getAccountStaffSelectOptions() },
        { key: 'businessContexts', label: 'Доступні бізнеси', type: 'checkboxGroup', required: true, defaultValue: defaultBusinessContexts, options: getAccountBusinessOptions(defaultBusinessContexts), hint: 'Акаунт бачитиме дані й перемикач тільки для вибраних бізнесів.' },
        { key: 'defaultBusinessContext', label: 'Бізнес за замовченням', type: 'select', defaultValue: defaultBusinessContext, options: getAccountBusinessSelectOptions(defaultBusinessContexts, defaultBusinessContext), hint: 'Цей бізнес відкриватиметься першим у глобальному перемикачі.' },
        { key: 'extraRoles', label: 'Додаткові ролі через кому', placeholder: 'manager, accountant', hint: 'Це реальні extraRoles акаунта: їх можна активувати як робочу роль у профілі. Основну роль сюди не дублюйте.' },
        { key: 'pageAllowlist', label: 'Додаткові сторінки через кому', placeholder: '/maysternya-doli' },
        { key: 'actionAllowlist', label: 'Дозволити окремі дії', type: 'checkboxGroup', defaultValue: [], options: getAccountActionOptions([]), hint: 'Allow додає дію, навіть якщо базова роль її не має.' },
        { key: 'actionDenylist', label: 'Заборонити окремі дії', type: 'checkboxGroup', defaultValue: [], options: getAccountActionOptions([]), hint: 'Deny має пріоритет над роллю і allow.' }
    ], {
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
    const selectedBusinessContexts = normalizeAccountBusinessSelection(result.businessContexts);
    const selectedDefaultBusinessContext = getAccountDefaultBusinessValue({ defaultBusinessContext: result.defaultBusinessContext }, selectedBusinessContexts);
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
        showNotification('Привʼязка акаунтів доступна тільки creator/director/art director', 'error');
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
        showNotification('Редагування профілю доступне тільки creator/director/art director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
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
        showNotification('Зміна пароля доступна тільки creator/director/art director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
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
        showNotification('Зміна доступу доступна тільки creator/director/art director', 'error');
        return;
    }
    const user = accountUsers.find(item => Number(item.id) === Number(userId));
    if (!user) return;
    const currentExtra = normalizeAccountArray(user.extra_roles || user.extraRoles).join(', ');
    const currentPages = normalizeAccountArray(user.page_allowlist || user.pageAllowlist).join(', ');
    const currentActionAllowlist = normalizeAccountArray(user.action_allowlist || user.actionAllowlist);
    const currentActionDenylist = normalizeAccountArray(user.action_denylist || user.actionDenylist);
    await loadAccountRoleDefinitions();
    const currentBusinessContexts = normalizeAccountBusinessSelection(user.business_contexts || user.businessContexts);
    const currentDefaultBusinessContext = getAccountDefaultBusinessValue(user, currentBusinessContexts);
    const formResult = await formModal(`Доступ акаунта · ${user.username}`, [
        { key: 'role', label: 'Основна роль', type: 'select', defaultValue: user.role || 'animator', options: getAccountRoleOptions(user.role || 'animator') },
        { key: 'businessContexts', label: 'Доступні бізнеси', type: 'checkboxGroup', required: true, defaultValue: currentBusinessContexts, options: getAccountBusinessOptions(currentBusinessContexts), hint: 'Це визначає, які бізнес-контексти користувач може перемикати і які дані бачить у scoped-модулях.' },
        { key: 'defaultBusinessContext', label: 'Бізнес за замовченням', type: 'select', defaultValue: currentDefaultBusinessContext, options: getAccountBusinessSelectOptions(currentBusinessContexts, currentDefaultBusinessContext), hint: 'Цей бізнес стане першим після нового входу або чистого браузера.' },
        { key: 'extraRoles', label: 'Додаткові ролі через кому', defaultValue: currentExtra, placeholder: 'manager, accountant', hint: 'Це реальні extraRoles акаунта: після збереження користувач побачить їх у профілі й зможе перемикати робочу роль.' },
        { key: 'pageAllowlist', label: 'Додаткові сторінки через кому', defaultValue: currentPages, placeholder: '/maysternya-doli' },
        { key: 'actionAllowlist', label: 'Дозволити окремі дії', type: 'checkboxGroup', defaultValue: currentActionAllowlist, options: getAccountActionOptions(currentActionAllowlist), hint: 'Allow додає дію, навіть якщо базова роль її не має.' },
        { key: 'actionDenylist', label: 'Заборонити окремі дії', type: 'checkboxGroup', defaultValue: currentActionDenylist, options: getAccountActionOptions(currentActionDenylist), hint: 'Deny має пріоритет над роллю і allow.' }
    ], {
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
    const selectedBusinessContexts = normalizeAccountBusinessSelection(formResult.businessContexts);
    const selectedDefaultBusinessContext = getAccountDefaultBusinessValue({ defaultBusinessContext: formResult.defaultBusinessContext }, selectedBusinessContexts);
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
    const keys = currentStaffProfessionKeysForEdit(staff);
    if (!keys.length) {
        root.innerHTML = '<div class="hr-profession-picker-empty">Спочатку виберіть основну професію.</div>';
        return;
    }
    const rateMap = staffProfessionRateMap(staff);
    const currentInputValues = new Map();
    root.querySelectorAll('[data-profession-rate]').forEach(input => {
        const key = normalizeProfessionKey(input.dataset.professionRate);
        if (key) currentInputValues.set(key, input.value);
    });
    const baseRate = Number(document.getElementById('editHourlyRate')?.value || staff.hourly_rate || 0);
    root.innerHTML = keys.map(key => {
        const customRate = rateMap.get(key);
        const displayRate = currentInputValues.has(key)
            ? currentInputValues.get(key)
            : (Number.isFinite(customRate) && customRate > 0 ? customRate : '');
        return `<label class="hr-profession-rate-row" data-rate-profession="${escapeHtml(key)}">
            <span>${escapeHtml(professionTitle(key))}</span>
            <input type="number" min="0" step="10" inputmode="decimal" data-profession-rate="${escapeHtml(key)}" value="${displayRate ? escapeHtml(displayRate) : ''}" placeholder="${baseRate > 0 ? escapeHtml(baseRate) : '0'}">
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

function bindSecondaryProfessionPicker() {
    const search = document.getElementById('editSecondaryProfessionSearch');
    const picker = document.getElementById('editSecondaryProfessionPicker');
    if (search) {
        search.oninput = () => {
            populateSecondaryProfessionSelect(readStaffSecondaryProfessionSelection(), document.getElementById('editRoleType')?.value);
            refreshStaffRateEditorFromCurrentForm();
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
            refreshStaffRateEditorFromCurrentForm();
        };
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
    shift_create: 'Додано зміну',
    shift_update: 'Оновлено зміну',
    shift_replace: 'Підміна зміни',
    shift_delete: 'Видалено зміну',
    correction: 'Корекція часу'
};

const STAFF_HISTORY_FIELD_LABELS = {
    role_type: 'основна професія',
    secondary_professions: 'додаткові професії',
    profession_rates: 'ставки по професіях',
    company_structure_node_id: 'вузол структури',
    hr_pool_status: 'HR-статус',
    blacklist_reason: 'чорний список',
    hourly_rate: 'ставка',
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

async function openStaffEdit(staffId) {
    const s = teamStaff.find(st => st.id === staffId);
    if (!s) return;
    await ensureProfessionsLoaded({ silent: true });
    await ensureCompanyStructureNodesLoaded({ silent: true });

    document.getElementById('editStaffId').value = staffId;
    populateStaffProfessionControls(s);
    document.getElementById('editPhone').value = s.phone || '';
    document.getElementById('editBirthDate').value = s.birth_date ? s.birth_date.substring(0, 10) : '';
    document.getElementById('editAddress').value = s.address || '';
    document.getElementById('editEmergencyContact').value = s.emergency_contact || '';
    document.getElementById('editEmergencyPhone').value = s.emergency_phone || '';
    document.getElementById('editHourlyRate').value = s.hourly_rate || 0;
    document.getElementById('editTelegramId').value = s.telegram_id || '';
    document.getElementById('editTelegramUsername').value = s.telegram_username || '';
    document.getElementById('editContractType').value = s.contract_type || 'parttime';
    document.getElementById('editPoolStatus').value = s.hr_pool_status || 'core';
    document.getElementById('editBlacklistReason').value = s.blacklist_reason || '';
    document.getElementById('editSkills').value = (s.skills || []).join(', ');
    document.getElementById('editNotes').value = s.notes || '';

    showHrEditableModal('staffEditModal');
    loadStaffProfileHistory(staffId);
}

async function saveStaffEdit() {
    const staffId = document.getElementById('editStaffId')?.value;
    const body = {
        role_type: document.getElementById('editRoleType')?.value,
        secondary_professions: normalizeProfessionList(readStaffSecondaryProfessionSelection(), [document.getElementById('editRoleType')?.value]),
        phone: document.getElementById('editPhone')?.value || null,
        birth_date: document.getElementById('editBirthDate')?.value || null,
        address: document.getElementById('editAddress')?.value || null,
        emergency_contact: document.getElementById('editEmergencyContact')?.value || null,
        emergency_phone: document.getElementById('editEmergencyPhone')?.value || null,
        hourly_rate: parseFloat(document.getElementById('editHourlyRate')?.value) || 0,
        telegram_id: document.getElementById('editTelegramId')?.value || null,
        telegram_username: document.getElementById('editTelegramUsername')?.value || null,
        contract_type: document.getElementById('editContractType')?.value || 'parttime',
        hr_pool_status: document.getElementById('editPoolStatus')?.value || 'core',
        blacklist_reason: document.getElementById('editBlacklistReason')?.value || null,
        company_structure_node_id: document.getElementById('editCompanyStructureNode')?.value || null,
        profession_rates: readStaffProfessionRates(),
        skills: document.getElementById('editSkills')?.value ? document.getElementById('editSkills')?.value.split(',').map(s => s.trim()).filter(Boolean) : null,
        notes: document.getElementById('editNotes')?.value || null
    };

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
            <button type="button" class="hr-org-node-edit" data-org-edit="${escapeHtml(node.id)}" aria-label="Редагувати ${escapeHtml(node.title)}">✎</button>
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

async function loadReports() {
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
    if (!data || !data.success) return;

    renderReports(data);
}

function renderReports(data) {
    // Summary
    const rows = data.data;
    let totalPresent = 0, totalLate = 0, totalAbsent = 0, totalOvertime = 0;
    let totalTasksAssigned = 0, totalTasksDone = 0, totalTasksOverdue = 0;
    for (const r of rows) {
        totalPresent += r.days_worked;
        totalLate += r.late_count;
        totalAbsent += r.days_absent;
        totalOvertime += r.total_overtime_hours;
        totalTasksAssigned += r.task_kpi?.tasks_assigned || 0;
        totalTasksDone += r.task_kpi?.tasks_done || 0;
        totalTasksOverdue += r.task_kpi?.tasks_overdue || 0;
    }
    const totalScheduled = rows.reduce((a, r) => a + r.days_scheduled, 0);
    const attendanceRate = totalScheduled > 0 ? Math.round(totalPresent / totalScheduled * 100) : 0;
    const taskDoneRate = totalTasksAssigned > 0 ? Math.round(totalTasksDone / totalTasksAssigned * 100) : 0;

    document.getElementById('reportSummary').innerHTML = `
        <div class="hr-report-stat"><div class="stat-value">${attendanceRate}%</div><div class="stat-label">Присутність</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalLate}</div><div class="stat-label">Запізнень</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalAbsent}</div><div class="stat-label">Відсутностей</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalOvertime.toFixed(0)}г</div><div class="stat-label">Переробка</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalTasksDone}/${totalTasksAssigned}</div><div class="stat-label">Задачі виконано</div></div>
        <div class="hr-report-stat"><div class="stat-value">${taskDoneRate}%</div><div class="stat-label">KPI задач</div></div>
        <div class="hr-report-stat"><div class="stat-value">${totalTasksOverdue}</div><div class="stat-label">Прострочені</div></div>
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

async function exportCSV() {
    const month = document.getElementById('reportMonth')?.value;
    const from = `${month}-01`;
    const d = new Date(from);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    const to = formatDate(d);

    const token = localStorage.getItem('pzp_token');
    const resp = await fetch(`/api/hr/report/export?from=${from}&to=${to}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) {
        showNotification('Помилка експорту: ' + resp.statusText, 'error');
        return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hr_report_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

async function loadSalary() {
    const monthSelect = document.getElementById('salaryMonth');
    if (monthSelect && !monthSelect.options.length) {
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
            monthSelect.add(new Option(label, val));
        }
    }
    const month = monthSelect?.value || '';
    const data = await hrFetch(`/salary?month=${month}`);
    if (!data || !data.success) return;
    renderSalary(data);
}

function renderSalaryRateSummary(row = {}) {
    const segments = Array.isArray(row.profession_rate_summary) ? row.profession_rate_summary : [];
    const normalized = segments
        .map(segment => ({
            key: normalizeProfessionKey(segment.profession_key || segment.professionKey || segment.key),
            rate: Number(segment.rate || segment.hourly_rate || segment.hourlyRate || 0),
            hours: Number(segment.hours || 0)
        }))
        .filter(segment => segment.key && segment.rate > 0);
    if (!normalized.length) return `${Number(row.hourly_rate || 0)} ₴/год`;
    return normalized
        .map(segment => `${escapeHtml(professionTitle(segment.key))}: ${segment.rate} ₴/год${segment.hours ? ` · ${segment.hours} год` : ''}`)
        .join('<br>');
}

function renderSalary(data) {
    const totals = data.totals;
    document.getElementById('salaryTotals').innerHTML = `
        <div class="hr-summary">
            <div class="hr-summary-card"><div class="value">${(totals.total_salary || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Всього</div></div>
            <div class="hr-summary-card green"><div class="value">${(totals.total_base || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Базова</div></div>
            <div class="hr-summary-card"><div class="value">${(totals.total_overtime || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Переробки</div></div>
            <div class="hr-summary-card green"><div class="value">${(totals.total_bonuses || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Бонуси</div></div>
            <div class="hr-summary-card red"><div class="value">${(totals.total_deductions || 0).toLocaleString('uk-UA')} ₴</div><div class="label">Утримання</div></div>
        </div>
    `;

    document.getElementById('salaryHead').innerHTML = `<tr>
        <th>Співробітник</th><th>Роль</th><th>Ставка</th><th>Днів</th><th>Годин</th>
        <th>Базова</th><th>Переробки</th><th>Бонуси</th><th>Утримання</th><th>Всього</th>
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
        <td><strong>${s.total_salary.toLocaleString('uk-UA')} ₴</strong></td>
    </tr>`).join('');
}

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
                    <button type="button" id="dpApply" style="flex:1;padding:12px;border:none;border-radius:12px;background:${selectedTpl?'#7c3aed':'#3D3D5C'};color:#fff;font-size:14px;font-weight:700;cursor:pointer;min-height:44px;transition:all .15s" ${selectedTpl?'':'disabled'}>✅ Застосувати</button>
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

function renderKpiSources({ rows = [], onboarding = [], ratings = [] } = {}) {
    const sources = document.getElementById('kpiSources');
    if (!sources) return;
    sources.innerHTML = [
        renderKpiSourceLabel('monthly report', rows.length ? `${rows.length} staff rows` : 'даних ще немає'),
        renderKpiSourceLabel('onboarding', onboarding.length ? `${onboarding.length} records` : 'даних ще немає'),
        renderKpiSourceLabel('ratings context', ratings.length ? `${ratings.length} records` : 'даних ще немає')
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
    const [monthly, onboarding, ratings] = await Promise.all([
        hrFetch(`/report/monthly?month=${month}`),
        hrFetch('/onboarding'),
        hrFetch('/ratings')
    ]);
    if (!monthly?.success) {
        const body = document.getElementById('kpiBody');
        renderKpiSources({
            rows: [],
            onboarding: onboarding?.success ? onboarding.data || [] : [],
            ratings: ratings?.success ? ratings.data || [] : []
        });
        if (body) body.innerHTML = '<tr><td colspan="6" class="kpi-muted">Не вдалося завантажити KPI-зріз</td></tr>';
        return;
    }
    renderKpi({
        month,
        rows: monthly.data || [],
        onboarding: onboarding?.success ? onboarding.data || [] : [],
        ratings: ratings?.success ? ratings.data || [] : []
    });
}

async function loadRatings() {
    return loadKpi();
}

function renderKpi({ rows, onboarding, ratings }) {
    const summary = document.getElementById('kpiSummary');
    const head = document.getElementById('kpiHead');
    const body = document.getElementById('kpiBody');
    if (!summary || !head || !body) return;
    renderKpiSources({ rows, onboarding, ratings });

    const totals = rows.reduce((acc, row) => {
        acc.scheduled += num(row.days_scheduled);
        acc.worked += num(row.days_worked);
        acc.late += num(row.late_count);
        acc.absent += num(row.days_absent);
        acc.overtime += num(row.total_overtime_hours);
        acc.tasksAssigned += num(row.task_kpi?.tasks_assigned);
        acc.tasksDone += num(row.task_kpi?.tasks_done);
        acc.tasksOverdue += num(row.task_kpi?.tasks_overdue);
        return acc;
    }, { scheduled: 0, worked: 0, late: 0, absent: 0, overtime: 0, tasksAssigned: 0, tasksDone: 0, tasksOverdue: 0 });
    const attendance = kpiPercent(totals.worked, totals.scheduled);
    const taskRate = kpiPercent(totals.tasksDone, totals.tasksAssigned);
    const events30d = ratings.reduce((acc, row) => acc + num(row.events_30d), 0);
    const onboardingActive = onboarding.filter(item => item.status !== 'completed').length;
    const onboardingTotalItems = onboarding.reduce((acc, item) => acc + num(item.total_items), 0);
    const onboardingDoneItems = onboarding.reduce((acc, item) => acc + num(item.completed_items), 0);
    const onboardingRate = kpiPercent(onboardingDoneItems, onboardingTotalItems);

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
        ratings.length
            ? renderKpiCard('Звіти / внесок', String(events30d), 'Події за 30 днів з існуючого event-контексту')
            : renderKpiCard('Звіти / внесок', 'даних ще немає', 'Потрібен джерельний сигнал внеску або звітів', { placeholder: true }),
        onboarding.length
            ? renderKpiCard('Статус розвитку', onboardingRate !== null ? `${onboardingRate}%` : `${onboardingActive} активн.`, `${onboardingActive} активних onboarding-процесів`)
            : renderKpiCard('Статус розвитку', 'даних ще немає', 'Немає активних або завершених onboarding-процесів', { placeholder: true })
    ].join('');

    const ratingMap = {};
    ratings.forEach(row => { ratingMap[Number(row.id)] = row; });
    const onboardingMap = buildOnboardingKpiMap(onboarding);

    head.innerHTML = `<tr>
        <th>Працівник</th>
        <th>Зміни / присутність</th>
        <th>Надійність</th>
        <th>Активність</th>
        <th>Внесок</th>
        <th>Розвиток</th>
    </tr>`;

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="kpi-muted">Немає staff KPI-даних за вибраний період</td></tr>';
        return;
    }

    body.innerHTML = rows.map(row => {
        const staffId = Number(row.staff_id);
        const attendanceRate = num(row.days_scheduled) > 0 ? num(row.attendance_rate) : null;
        const taskAssigned = num(row.task_kpi?.tasks_assigned);
        const taskDone = num(row.task_kpi?.tasks_done);
        const taskDoneRate = taskAssigned > 0 ? num(row.task_completion_rate) : null;
        const reliabilityIssues = num(row.late_count) + num(row.days_absent);
        const contribution = ratingMap[staffId];
        const development = onboardingMap[staffId];
        const roleLabel = ROLE_LABELS[row.role_type] || row.role_type || '';

        return `<tr>
            <td>
                <strong>${escapeHtml(row.staff_name)}</strong>
                <div class="kpi-muted">${escapeHtml(roleLabel)}</div>
            </td>
            <td>${attendanceRate !== null ? `${kpiSignal(`${attendanceRate}%`, toneForPercent(attendanceRate))}<div class="kpi-muted">${num(row.days_worked)}/${num(row.days_scheduled)} змін</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
            <td>${rows.length ? `${kpiSignal(reliabilityIssues ? `${reliabilityIssues} сигналів` : 'без сигналів', reliabilityIssues === 0 ? 'good' : reliabilityIssues <= 2 ? 'warn' : 'bad')}<div class="kpi-muted">${num(row.late_count)} запізн. · ${num(row.days_absent)} відсутн.</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
            <td>${taskDoneRate !== null ? `${kpiSignal(`${taskDoneRate}%`, toneForPercent(taskDoneRate, 85, 65))}<div class="kpi-muted">${taskDone}/${taskAssigned} задач · ${num(row.task_kpi?.tasks_overdue)} простр.</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
            <td>${contribution ? `${kpiSignal(`${num(contribution.events_30d)} за 30 дн`, num(contribution.events_30d) > 0 ? 'good' : '')}<div class="kpi-muted">${num(contribution.total_events)} подій всього</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
            <td>${development ? `${kpiSignal(development.percent !== null ? `${development.percent}%` : `${development.active} активн.`, toneForPercent(development.percent, 90, 60))}<div class="kpi-muted">${development.completed}/${development.total} onboarding завершено</div>` : '<span class="kpi-muted">даних ще немає</span>'}</td>
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
        return `
        <div style="background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius);padding:16px;margin-bottom:12px;box-shadow:var(--shadow-xs);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div>
                    <strong>${escapeHtml(o.staff_name)}</strong>
                    <span style="font-size:12px;color:var(--gray-500);margin-left:8px;">${escapeHtml(o.template_name || '')}</span>
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
    const [staff, templates] = await Promise.all([
        hrFetch('/staff?active=true'),
        hrFetch('/onboarding/templates')
    ]);
    if (!staff?.success || !templates?.success) return;
    const staffOptions = staff.data.map(s => ({ value: String(s.id), label: `${s.name}` }));
    const templateOptions = templates.data.map(t => ({ value: String(t.id), label: `${t.name}` }));
    const result = await formModal('Запустити онбординг', [
        { key: 'staffId', label: 'Співробітник', type: 'select', options: staffOptions, required: true },
        { key: 'templateId', label: 'Шаблон', type: 'select', options: templateOptions, required: true }
    ], { icon: '🚀' });
    if (!result) return;
    const data = await hrFetch('/onboarding/start', 'POST', { staff_id: parseInt(result.staffId), template_id: parseInt(result.templateId) });
    if (data?.success) { showNotification('Онбординг запущено', 'success'); loadOnboarding(); }
};

// v39.8: commitSalaries — was missing, button existed but function didn't
window.commitSalaries = async function() {
    const month = document.getElementById('salaryMonth')?.value;
    if (!month) { showNotification('Виберіть місяць', 'error'); return; }
    if (!await confirmModal(`Нарахувати зарплати за ${month}?`, { type: 'danger', okText: 'Нарахувати' })) return;
    const data = await hrFetch('/salary/commit', 'POST', { month });
    if (data?.success) {
        showNotification(`Зарплати нараховано (${data.count || 0} транзакцій)`, 'success');
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

async function loadVacancies() {
    const status = document.getElementById('vacStatusFilter')?.value || 'open';
    const list = document.getElementById('vacanciesList');
    if (list) list.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:24px">⏳</div>';
    const sec = document.getElementById('candidatesSection');
    if (sec) sec.style.display = 'none';

    const data = await hrFetch(`/vacancies?status=${status}`);
    if (!data?.success) {
        if (list) list.innerHTML = '<div style="text-align:center;color:var(--danger);padding:24px">Помилка завантаження</div>';
        return;
    }
    const vacancies = data.vacancies || [];

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
                ${v.status === 'open' ? `<button type="button" class="btn-vac-action" onclick="patchVacancy(${v.id},'paused')">⏸</button>` : ''}
                ${v.status !== 'filled' && v.status !== 'closed' ? `<button type="button" class="btn-vac-action filled" onclick="patchVacancy(${v.id},'filled')">✅ Заповнено</button>` : ''}
                ${v.status === 'paused' ? `<button type="button" class="btn-vac-action" onclick="patchVacancy(${v.id},'open')">▶ Відкрити</button>` : ''}
                <button type="button" class="btn-vac-action danger" onclick="patchVacancy(${v.id},'closed')">✕</button>
            </div>
        </div>
    `).join('');
    document.getElementById('vacStatusFilter').onchange = loadVacancies;
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
}

async function refreshCandidates() {
    if (!currentVacancyId) return;
    const data = await hrFetch(`/vacancies/${currentVacancyId}/applications`);
    if (!data?.success) return;
    const apps = data.applications || [];
    currentApplications = apps;
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
                            ${s === 'offer' ? `<button type="button" class="kc-btn success" onclick="hireCandidate(${a.id})">✅ Найняти</button>` : ''}
                            <button type="button" class="kc-btn danger" onclick="moveCandidate(${a.id},'rejected')">✕</button>
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
    const response = await fetch(`/api/hr/applications/${applicationId}/resume-files/${fileId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) {
        showNotification('Не вдалося завантажити файл резюме', 'error');
        return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'resume';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
