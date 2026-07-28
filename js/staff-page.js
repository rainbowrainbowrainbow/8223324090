/**
 * staff-page.js — Staff schedule page (v39.1)
 *
 * LLM HINT: This is the frontend for the /staff page.
 * Shows a rolling schedule grid: rows = employees grouped by department, columns = days.
 * Click on a cell to edit shift via modal (status, time, note).
 * v39.1: Account linking — ✅/⚠️ indicators, link modal, bulk create, Excel import.
 * API used: GET /api/staff, GET /api/staff/schedule, PUT /api/staff/schedule,
 *   GET /api/staff/link-status, POST /api/staff/:id/link, POST /api/staff/bulk-create-accounts.
 * State is in StaffState object (weekStart, staff[], schedule{}, activeDept).
 */

(function () {
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderStaffPulseSwitcher() {
    const container = document.getElementById('staffPulseNavItems');
    const switcher = typeof window !== 'undefined' ? window.HrPulseSwitcher : null;
    if (!container || !switcher || typeof switcher.renderStaffNav !== 'function') return;
    switcher.renderStaffNav(container, { activeId: 'schedule' });
}

let staffScheduleInitPromise = null;
let staffScheduleInitialized = false;
let staffScheduleRefreshQueue = Promise.resolve();
let staffScheduleRangeLoadSeq = 0;
let staffScheduleRangeAbortController = null;
let scheduleCellHistoryAbortController = null;
let staffScheduleLayoutMediaQuery = null;

function staffScheduleMode(options = {}) {
    return options.mode === 'hr' ? 'hr' : 'standalone';
}

function applyStaffScheduleHostMode(mode) {
    const hrMode = mode === 'hr';
    document.documentElement.classList.toggle('staff-schedule-hr-mode', hrMode);
    document.body?.classList.toggle('staff-schedule-hr-mode', hrMode);
}

function ensureStaffScheduleShell(options = {}) {
    const shell = typeof window !== 'undefined' ? window.StaffScheduleShell : null;
    if (!shell || typeof shell.ensure !== 'function') return null;
    const mode = staffScheduleMode(options);
    return shell.ensure({
        host: options.host,
        mode,
        includePulseNav: mode !== 'hr'
    });
}

function shouldAutoInitStaffSchedulePage() {
    return !!document.querySelector('[data-staff-schedule-shell="standalone"]');
}

// ==========================================
// STATE
// ==========================================

const StaffState = {
    weekStart: null,    // First date of the current visible schedule window
    rangeStart: null,   // First date of the current visible schedule range
    rangeEnd: null,     // Last date of the current visible schedule range
    rangeMode: 'rolling',
    rangeLoadState: 'idle',
    rangePending: null,
    rangeRetry: null,
    staff: [],
    schedule: {},       // { staffId_date: entry }
    scheduleLoadedRange: null,
    scheduleRawEntries: [], // raw rows for health duplicate/overlap checks
    attendance: {},      // { staffId_date: payroll-ready hr_time_records/staff_checkins row }
    attendanceSummary: null,
    attendanceUnavailable: false,
    staffingForecast: null,
    staffingForecastBookings: {}, // { date: booking[] } from /api/bookings/:date
    staffingForecastAvailable: false,
    managerAccountability: null,
    accountabilityDeptFilter: 'all',
    accountabilityManagerFilter: 'all',
    scheduleHistory: {}, // { staffId_date: audit entries }
    scheduleHistoryLoadSeq: 0,
    shiftPreferences: {}, // { staffId: preference[] }
    shiftPreferencesLoadSeq: 0,
    scheduleModalSessionSeq: 0,
    departments: {},
    displayGroups: [],
    activeDept: 'all',
    searchQuery: '',
    expandedScheduleGroups: new Set(),
    healthFilter: 'all',
    includeFreelance: false,
    editingCell: null,  // { staffId, date }
    hoursData: null,    // { staffId: { totalHours, workingDays, ... } }
    showHours: false,
    showLoadView: false,
    showLinkView: false,    // v39.1: account linking overlay
    viewMode: 'schedule',
    canManage: false,
    linkData: [],           // v39.1: link-status data
    linkStats: null,        // v39.1: { total, linked, unlinked, freelance }
    allUsers: [],           // v39.1: all users for linking
    professions: [],
    focusedStaffId: null,
    focusScrollPending: false,
    linkingStaffId: null,   // v39.1: staff being linked
    selectedUserId: null,   // v39.1: selected user in link modal
    bulkResults: null,      // v39.1: bulk create results
};

const STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY = 'pzp_staff_schedule_expanded_groups';

const DEPT_ICONS = {
    animators: 'drama',
    trampoline: 'activity',
    reception: 'bell',
    admin: 'briefcase',
    cafe: 'coffee',
    tech: 'wrench',
    cleaning: 'sparkles',
    security: 'shield'
};

const SCHEDULE_CRM_ICON_SVG = {
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    briefcase: '<path d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1"/><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 12h18"/><path d="M9 12v2h6v-2"/>',
    chef: '<path d="M6 13.9A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.9"/><path d="M6 14h12v6H6z"/><path d="M9 14v6"/><path d="M15 14v6"/>',
    clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3"/><path d="M8 12h8"/><path d="M8 16h5"/>',
    coffee: '<path d="M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M16 10h2a3 3 0 0 1 0 6h-2"/><path d="M7 3v2"/><path d="M11 3v2"/><path d="M15 3v2"/>',
    coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
    crown: '<path d="m3 8 4 3 5-7 5 7 4-3-2 11H5Z"/><path d="M5 19h14"/>',
    drama: '<path d="M8 3c2 0 3.5 1 4 2.5C12.5 4 14 3 16 3c2.8 0 5 2.3 5 5.1 0 5.2-6 8.9-9 10.9C9 17 3 13.3 3 8.1 3 5.3 5.2 3 8 3Z"/><path d="M8 9h.01"/><path d="M16 9h.01"/><path d="M9 13c1.2.8 4.8.8 6 0"/>',
    pizza: '<path d="M15 11h.01"/><path d="M11 15h.01"/><path d="M16 16h.01"/><path d="M3 21 21 3a18 18 0 0 1-18 18Z"/><path d="M9 15a6 6 0 0 0 0-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-5"/>',
    sparkles: '<path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7Z"/><path d="m5 16 .8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8Z"/><path d="m19 14 .6 1.4L21 16l-1.4.6L19 18l-.6-1.4L17 16l1.4-.6Z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    utensils: '<path d="M4 3v8"/><path d="M8 3v8"/><path d="M4 7h4"/><path d="M6 11v10"/><path d="M17 3v18"/><path d="M17 3c2.2 1.3 3 3 3 5s-.8 3.7-3 5"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-2.3-2.3Z"/>'
};

function renderScheduleCrmIcon(iconKey, className = 'schedule-crm-icon') {
    const key = String(iconKey || '').trim().replace(/[^a-z0-9_-]/gi, '') || 'users';
    const path = SCHEDULE_CRM_ICON_SVG[key] || SCHEDULE_CRM_ICON_SVG.users;
    return `<span class="${escapeHtml(className)} schedule-crm-icon--${escapeHtml(key)}" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round" focusable="false">${path}</svg>
    </span>`;
}

const STAFF_SCHEDULE_STATUS_LABELS = {
    working: 'Робочий',
    dayoff: 'Вихідний',
    day_off: 'Вихідний',
    vacation: 'Відпустка',
    sick: 'Лікарняний',
    remote: 'Віддалено',
    unset: 'Не заповнено'
};

const STATUS_ICONS = {
    working: '●',
    dayoff: '○',
    day_off: '○',
    vacation: '✈',
    sick: '✚',
    remote: '◉',
    unset: '·'
};

const SCHEDULE_HEALTH_FILTERS = ['all', 'critical', 'warning', 'ok'];
const SCHEDULE_HEALTH_SEVERITY_RANK = { ok: 0, info: 1, warning: 2, critical: 3 };
const SCHEDULE_HEALTH_SCORE_PENALTY = { critical: 18, warning: 6, info: 2 };
const SCHEDULE_HEALTH_LABELS = {
    critical: 'Critical',
    warning: 'Warnings',
    info: 'Info',
    ok: 'OK'
};
const SCHEDULE_HEALTH_LONG_SHIFT_MINUTES = 12 * 60;
const SCHEDULE_HEALTH_LONG_DAY_MINUTES = 14 * 60;
const SCHEDULE_HEALTH_DEPARTMENT_MIN_WORKING = {
    animators: 1,
    trampoline: 1,
    reception: 1,
    cafe: 1,
    tech: 1,
    cleaning: 1
};
const SCHEDULE_HEALTH_MANAGER_ROLES = new Set(['manager', 'senior_manager', 'admin', 'vice_director', 'art_director']);
const MANAGER_ACCOUNTABILITY_ROLES = new Set(['manager', 'senior_manager', 'admin', 'vice_director', 'art_director']);
const MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS = {
    lateReports: 'late_reports_source_missing',
    payrollDiscrepancies: 'payroll_reconciliation_source_missing',
    unapprovedShifts: 'shift_approval_source_missing',
    weeklyTrend: 'historical_accountability_snapshot_missing',
    lastActionDate: 'manager_action_log_source_missing'
};
const MANAGER_ACCOUNTABILITY_MAPPING_SOURCE = 'inferred_from_hr_role_type_same_department';

const SCHEDULE_ATTENDANCE_STATUSES = new Set(['planned', 'checked_in', 'late', 'absent', 'left_early', 'completed', 'manual_review', 'excused']);
const SCHEDULE_ATTENDANCE_LABELS = {
    planned: 'План',
    checked_in: 'Прийшов',
    late: 'Запізн.',
    absent: 'Не вийшов',
    left_early: 'Ранній вихід',
    completed: 'Закрито',
    manual_review: 'Перевірити',
    excused: 'Поважна'
};
const SCHEDULE_ATTENDANCE_LATE_GRACE_MINUTES = 5;

const STAFFING_FORECAST_DEPARTMENTS = ['animators', 'trampoline', 'reception', 'managers', 'tech', 'cafe', 'cleaning'];
const STAFFING_FORECAST_LABELS = {
    animators: 'Аніматори',
    trampoline: 'Батутисти',
    reception: 'Рецепшен',
    managers: 'Менеджери',
    tech: 'Тех/охорона',
    cafe: 'Кафе',
    cleaning: 'Клінінг'
};
const STAFFING_FORECAST_RULES = {
    emptyDay: '0 staff unless active bookings exist',
    animators: '1 per active event, +1 per 12 expected children, respect booking.hosts/secondAnimator',
    trampoline: '1 when booking category/room/program mentions trampoline/batut, +1 per 18 expected children',
    reception: '1 for any active day, +1 when day has 5+ bookings or 3+ peak-time bookings',
    managers: '1 for any active day, +1 when 6+ bookings or 60+ expected guests',
    tech: '1 for any active day, +1 for weekend/evening/high-volume days',
    cafe: '1 when banquet/menu/kitchen/cafe demand exists, +1 for 30+ expected guests',
    cleaning: '1 for any active day, +1 for 5+ bookings or 40+ expected guests'
};
const STAFFING_FORECAST_PEAK_START_MINUTES = 15 * 60;
const STAFFING_FORECAST_PEAK_END_MINUTES = 20 * 60;
const STAFFING_FORECAST_TECH_EVENING_MINUTES = 18 * 60;

// Sub-groups within large departments (by role_type)
const DEPT_SUB_GROUPS = {
    animators: [
        { key: 'animator', label: 'Аніматори', icon: 'drama' },
        { key: 'trampoline_instructor,senior_instructor,instructor', label: 'Батутисти', icon: 'activity' }
    ],
    trampoline: [
        { key: 'trampoline_instructor,senior_instructor,instructor', label: 'Батутисти', icon: 'activity' },
        { key: 'animator', label: 'Аніматори', icon: 'drama' }
    ],
    admin: [
        { key: 'vice_director,art_director,senior_manager', label: 'Керівники', icon: 'crown' },
        { key: 'manager', label: 'Менеджери', icon: 'briefcase' },
        { key: 'admin', label: 'Адміністратори', icon: 'clipboard' },
        { key: 'reception', label: 'Рецепція', icon: 'bell' },
        { key: 'accountant', label: 'Бухгалтери', icon: 'coins' },
        { key: 'hr', label: 'HR', icon: 'users' }
    ],
    reception: [
        { key: 'reception', label: 'Рецепція', icon: 'bell' },
        { key: 'manager,senior_manager', label: 'Менеджери', icon: 'briefcase' }
    ],
    cafe: [
        { key: 'cook', label: 'Кухня', icon: 'chef' },
        { key: 'pizzaiolo', label: 'Піцайоло', icon: 'pizza' },
        { key: 'barista', label: 'Бариста', icon: 'coffee' },
        { key: 'waiter', label: 'Офіціанти', icon: 'utensils' }
    ],
    tech: [
        { departments: 'tech', label: 'Технічний відділ', icon: 'wrench' },
        { departments: 'security', key: 'security', label: 'Охорона', icon: 'shield' }
    ],
    cleaning: [
        { key: 'cleaner,cleaning', label: 'Прибиральники', icon: 'sparkles' },
        { key: 'dishwasher', label: 'Мийка', icon: 'sparkles' },
        { key: 'wardrobe', label: 'Гардероб', icon: 'briefcase' }
    ]
};

const STAFF_ROLE_OPTIONS = [
    { value: 'animator', label: 'Аніматор' },
    { value: 'trampoline_instructor', label: 'Інструктор батутів' },
    { value: 'senior_instructor', label: 'Адміністратор ігрових зон' },
    { value: 'admin', label: 'Адміністратор' },
    { value: 'reception', label: 'Рецепція' },
    { value: 'manager', label: 'Менеджер' },
    { value: 'senior_manager', label: 'Старший менеджер' },
    { value: 'hr', label: 'HR' },
    { value: 'barista', label: 'Бариста' },
    { value: 'cook', label: 'Кухар' },
    { value: 'pizzaiolo', label: 'Піцайоло' },
    { value: 'waiter', label: 'Офіціант' },
    { value: 'cleaner', label: 'Прибиральник' },
    { value: 'dishwasher', label: 'Мийка' },
    { value: 'wardrobe', label: 'Гардероб' },
    { value: 'security', label: 'Охорона' },
    { value: 'maintenance', label: 'Технічний директор' },
    { value: 'it_specialist', label: 'IT / техпідтримка' }
];

const STAFF_ROLE_OPTIONS_BY_DEPT = {
    animators: STAFF_ROLE_OPTIONS.filter(r => ['animator', 'host'].includes(r.value)),
    trampoline: STAFF_ROLE_OPTIONS.filter(r => ['trampoline_instructor', 'senior_instructor', 'animator'].includes(r.value)),
    admin: STAFF_ROLE_OPTIONS.filter(r => ['admin', 'reception', 'manager', 'senior_manager', 'hr'].includes(r.value)),
    cafe: STAFF_ROLE_OPTIONS.filter(r => ['barista', 'cook', 'pizzaiolo', 'waiter'].includes(r.value)),
    tech: STAFF_ROLE_OPTIONS.filter(r => ['maintenance', 'it_specialist'].includes(r.value)),
    cleaning: STAFF_ROLE_OPTIONS.filter(r => ['cleaner', 'dishwasher', 'wardrobe'].includes(r.value)),
    security: STAFF_ROLE_OPTIONS.filter(r => ['security', 'maintenance'].includes(r.value)),
    __default: STAFF_ROLE_OPTIONS
};

function normalizeProfessionKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .slice(0, 64);
}

function departmentSubGroupRoleKeys(subGroup = {}) {
    return String(subGroup.key || '')
        .split(',')
        .map(normalizeProfessionKey)
        .filter(Boolean);
}

function departmentSubGroupDepartmentKeys(subGroup = {}) {
    return String(subGroup.departments || subGroup.department || '')
        .split(',')
        .map(value => String(value || '').trim())
        .filter(Boolean);
}

function shouldRenderDepartmentSubGroups(deptStaff = [], subGroups = null) {
    return Array.isArray(subGroups) && subGroups.length > 0 && Array.isArray(deptStaff) && deptStaff.length > 0;
}

function normalizeScheduleStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    if (!status) return 'unset';
    if (status === 'day_off') return 'dayoff';
    return STAFF_SCHEDULE_STATUS_LABELS[status] ? status : status;
}

function parseProfessionArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return trimmed.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean);
}

function staffSecondaryProfessions(staff = {}) {
    const primary = normalizeProfessionKey(staff.role_type);
    const seen = new Set([primary].filter(Boolean));
    return parseProfessionArray(staff.secondary_professions || staff.secondaryProfessions)
        .map(normalizeProfessionKey)
        .filter(key => key && !seen.has(key) && seen.add(key));
}

function staffProfessionKeys(staff = {}) {
    const seen = new Set();
    return [staff.role_type || staff.roleType, ...staffSecondaryProfessions(staff)]
        .map(normalizeProfessionKey)
        .filter(key => key && !seen.has(key) && seen.add(key));
}

function normalizeScheduleStaffId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function uniqueScheduleStaffById(staffList = []) {
    const seen = new Set();
    const unique = [];
    for (const staff of (Array.isArray(staffList) ? staffList : [])) {
        const id = normalizeScheduleStaffId(staff?.id);
        if (id === null || seen.has(id)) continue;
        seen.add(id);
        unique.push(staff);
    }
    return unique;
}

function professionLabel(key) {
    const normalized = normalizeProfessionKey(key);
    const profession = StaffState.professions.find(item => normalizeProfessionKey(item.key) === normalized);
    if (profession?.title) return profession.title;
    const option = STAFF_ROLE_OPTIONS.find(item => item.value === normalized);
    return option?.label || normalized;
}

function staffCardRoleSummary(staff = {}) {
    const primary = staff.role_type ? professionLabel(staff.role_type) : '';
    const secondary = staffSecondaryProfessions(staff)
        .map(professionLabel)
        .filter(Boolean)
        .slice(0, 2);
    const role = primary || staff.position || '';
    return secondary.length ? `${role} + ${secondary.join(', ')}` : role;
}

function renderStaffCardAvatar(staff = {}, initials = '', fallbackColor = '#6366F1') {
    const photoUrl = String(staff.photo_url || staff.photoUrl || '').trim();
    if (photoUrl) {
        return `<div class="emp-avatar emp-avatar-photo" title="HR фото"><img src="${escapeHtml(photoUrl)}" alt=""></div>`;
    }
    const isFreelance = staff.is_freelance;
    return `<div class="emp-avatar" style="background:${escapeHtml(fallbackColor)}">${isFreelance ? '~' : escapeHtml(initials)}</div>`;
}

function staffCardTrainingReadiness(staff = {}) {
    const readiness = staff.training_readiness || staff.trainingReadiness;
    if (!readiness || typeof readiness !== 'object') {
        return { hasData: false, total: 0, completed: 0, percent: 0 };
    }
    const rawTotal = Number(readiness.total);
    const rawCompleted = Number(readiness.completed);
    const total = Number.isFinite(rawTotal) ? Math.max(0, rawTotal) : 0;
    const completed = Number.isFinite(rawCompleted) ? Math.max(0, rawCompleted) : 0;
    const rawPercent = Number(readiness.percent);
    const percent = total
        ? Math.max(0, Math.min(100, Number.isFinite(rawPercent) ? rawPercent : Math.round((completed / total) * 100)))
        : 0;
    return { hasData: true, total, completed, percent };
}

function renderStaffCardReadinessBadge(staff = {}) {
    const readiness = staffCardTrainingReadiness(staff);
    if (!readiness.hasData || !readiness.total) {
        const title = readiness.hasData
            ? 'Готовність: немає достовірних даних — чеклісти навчання не налаштовані'
            : 'Готовність: немає даних';
        return `<span class="staff-card-badge neutral" data-staff-readiness-state="unknown" title="${escapeHtml(title)}">Немає даних</span>`;
    }
    const state = readiness.percent >= 85 ? 'ok' : (readiness.percent >= 45 ? 'neutral' : 'warn');
    const readinessState = readiness.percent >= 85 ? 'ready' : (readiness.percent >= 45 ? 'partial' : 'low');
    const title = `Готовність навчання: ${readiness.completed}/${readiness.total}`;
    return `<span class="staff-card-badge ${state}" data-staff-readiness-state="${readinessState}" title="${escapeHtml(title)}">${readiness.percent}%</span>`;
}

function renderStaffCardBadges(staff = {}) {
    const accountBadge = staff.has_account
        ? '<span class="staff-card-badge ok" title="CRM акаунт: є">CRM</span>'
        : '<span class="staff-card-badge warn" title="CRM акаунт: не привʼязано">CRM</span>';
    const faceBadge = staff.has_face_descriptor
        ? '<span class="staff-card-badge ok" title="Фото для камери: є">📸</span>'
        : '<span class="staff-card-badge warn" title="Фото для камери: немає">📸</span>';
    const pool = String(staff.hr_pool_status || '').trim();
    const poolBadge = pool && pool !== 'core'
        ? `<span class="staff-card-badge neutral" title="HR пул: ${escapeHtml(pool)}">${escapeHtml(pool)}</span>`
        : '';
    const freelanceBadge = staff.is_freelance
        ? '<span class="staff-card-badge neutral freelance" title="Фріланс-слот: показано тільки в explicit режимі">ФР</span>'
        : '';
    return `${accountBadge}${faceBadge}${renderStaffCardReadinessBadge(staff)}${poolBadge}${freelanceBadge}`;
}

function professionCatalogOptions() {
    return (StaffState.professions || [])
        .filter(item => item.is_active !== false)
        .map(item => ({
            value: normalizeProfessionKey(item.key),
            label: `${item.title || item.key}${item.department ? ' · ' + item.department : ''}`
        }))
        .filter(item => item.value)
        .sort((a, b) => a.label.localeCompare(b.label, 'uk'));
}

function staffRoleOptions() {
    const catalog = professionCatalogOptions();
    return catalog.length ? catalog : STAFF_ROLE_OPTIONS;
}

function staffRoleOptionsByDepartment() {
    const catalog = professionCatalogOptions();
    if (!catalog.length) return STAFF_ROLE_OPTIONS_BY_DEPT;
    const optionsByDepartment = { __default: catalog };
    Object.keys(STAFF_ROLE_OPTIONS_BY_DEPT).forEach(department => {
        optionsByDepartment[department] = catalog;
    });
    return optionsByDepartment;
}

function staffProfessionOptions(staff = {}, current = '') {
    const selected = normalizeProfessionKey(current);
    const seen = new Set();
    const keys = [staff.role_type, ...staffSecondaryProfessions(staff), selected]
        .map(normalizeProfessionKey)
        .filter(key => key && !seen.has(key) && seen.add(key));
    return keys.map(key => ({
        value: key,
        label: professionLabel(key),
        selected: selected ? key === selected : key === normalizeProfessionKey(staff.role_type)
    }));
}

function staffHasProfession(staff = {}, key = '') {
    const normalized = normalizeProfessionKey(key);
    if (!normalized) return false;
    return normalizeProfessionKey(staff.role_type) === normalized
        || staffSecondaryProfessions(staff).includes(normalized);
}

function scheduleStaffDisplayName(staff = {}) {
    return String(staff.display_name || staff.displayName || staff.name || '').trim() || 'Співробітник';
}

function staffUiBoolean(value, fallback = false) {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    const text = String(value ?? '').trim().toLowerCase();
    if (['true', 'yes', 'y'].includes(text)) return true;
    if (['false', 'no', 'n'].includes(text)) return false;
    return fallback;
}

function staffUiDate(value) {
    if (!value) return '';
    if (value instanceof Date) return formatDateStr(value);
    const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
}

function staffPoolStatusForSchedule(staff = {}) {
    return String(staff.hr_pool_status || staff.hrPoolStatus || 'core').trim().toLowerCase() || 'core';
}

function isScheduleableStaffForUi(staff = {}, date = '') {
    if (!staff) return false;
    if (!staffUiBoolean(staff.is_active ?? staff.isActive, true)) return false;
    if (staffPoolStatusForSchedule(staff) !== 'core') return false;
    if (staffUiBoolean(staff.is_freelance ?? staff.isFreelance, false)) return false;
    const targetDate = staffUiDate(date) || todayStr();
    const terminationDate = staffUiDate(staff.termination_date || staff.terminationDate);
    if (terminationDate && targetDate && terminationDate <= targetDate) return false;
    return true;
}

function scheduleableStaffForUi(staffList = [], date = '') {
    return uniqueScheduleStaffById(
        (Array.isArray(staffList) ? staffList : [])
            .filter(staff => isScheduleableStaffForUi(staff, date))
    );
}

function scheduleableStaffErrorMessage(result = {}, fallback = 'Помилка збереження') {
    const code = String(result?.code || '').trim();
    if (code === 'STAFF_INACTIVE') return 'Працівник неактивний і не може бути доданий в активний графік.';
    if (code === 'STAFF_BLACKLISTED') return 'Працівник у чорному списку і не може бути доданий в активний графік.';
    if (code === 'STAFF_NOT_CORE_POOL') return 'Працівник не в основній команді і не може бути доданий в активний графік.';
    if (code === 'STAFF_FREELANCE_NOT_ALLOWED') return 'Фріланс-працівник не може бути доданий без explicit режиму.';
    if (code === 'STAFF_TERMINATED') return 'Працівник звільнений на дату цієї зміни.';
    if (code === 'STAFF_NOT_SCHEDULEABLE') return 'Працівник не доступний для активного графіка на цю дату.';
    if (code === 'HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION') return STAFF_SCHEDULE_PLAN_ERROR_MESSAGES.HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION;
    if (code === 'HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT') return STAFF_SCHEDULE_PLAN_ERROR_MESSAGES.HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT;
    return result?.error || fallback;
}

function isReplacementEntry(entry = {}) {
    return Boolean(entry?.original_staff_id);
}

function scheduleEntryKey(entry = {}) {
    if (!entry?.staff_id || !entry?.date) return '';
    return `${entry.staff_id}_${entry.date}`;
}

function scheduleEntryTime(entry = {}) {
    if (!entry?.shift_start || !entry?.shift_end) return '';
    return `${String(entry.shift_start).slice(0, 5)}-${String(entry.shift_end).slice(0, 5)}`;
}

const STAFF_FULL_SHIFT_MINUTES = 8 * 60;
const STAFF_WEEKEND_FULL_SHIFT_MINUTES = 10 * 60;

function scheduleTimeToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
}

const STAFF_SCHEDULE_MAX_SEGMENTS = 12;
let staffScheduleSegmentClientSeq = 0;

function normalizeSchedulePlanTime(value) {
    const minutes = scheduleTimeToMinutes(value);
    if (minutes === null) return '';
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function schedulePlanDefaultDate(scope, options = {}) {
    const explicitDate = staffUiDate(options.date || options.shiftDate || options.shift_date || options.scheduleDate || options.schedule_date);
    if (explicitDate) return explicitDate;
    if (scope === 'schedule') return staffUiDate(StaffState.editingCell?.date);
    if (scope === 'fill') {
        const selectedDays = new Set(Array.from(document.querySelectorAll('#fillDaysRow input[type=checkbox]:checked'))
            .map(checkbox => Number(checkbox.value))
            .filter(Number.isInteger));
        const date = getScheduleDates().find(item => !selectedDays.size || selectedDays.has(item.getDay()));
        return date ? formatDateStr(date) : '';
    }
    return '';
}

function schedulePlanDefaultPreferences(scope) {
    if (scope === 'schedule') {
        const staffId = Number(StaffState.editingCell?.staffId);
        const preferences = StaffState.shiftPreferences[staffId];
        return Array.isArray(preferences) ? preferences : [];
    }
    if (scope === 'fill') {
        const selected = document.getElementById('fillStaffSelect')?.value || '';
        const staffId = selected === 'all' ? null : normalizeScheduleStaffId(selected);
        const preferences = staffId ? StaffState.shiftPreferences[staffId] : null;
        return Array.isArray(preferences) ? preferences : [];
    }
    return [];
}

function scheduleShiftPreferencesForProfession(preferences = [], professionKey = '') {
    const normalizedProfession = normalizeProfessionKey(professionKey);
    if (!normalizedProfession) return [];
    const savedByDayType = new Map((Array.isArray(preferences) ? preferences : [])
        .map(normalizeScheduleShiftPreference)
        .filter(row => row && row.professionKey === normalizedProfession)
        .map(row => [row.dayType, row]));
    return SCHEDULE_SHIFT_PREFERENCE_DAY_TYPES.map(dayType => (
        savedByDayType.get(dayType) || fallbackScheduleShiftPreference(normalizedProfession, dayType)
    ));
}

function scheduleShiftPreferenceForProfessionDate(preferences = [], professionKey = '', date = '') {
    const dayType = scheduleShiftPreferenceDayType(date);
    return scheduleShiftPreferencesForProfession(preferences, professionKey)
        .find(row => row.dayType === dayType)
        || fallbackScheduleShiftPreference(professionKey, dayType);
}

function schedulePlanDefaultSegmentTimes(scope, professionKey = '', options = {}) {
    const date = schedulePlanDefaultDate(scope, options);
    const preferences = Array.isArray(options.preferences)
        ? options.preferences
        : schedulePlanDefaultPreferences(scope);
    const preference = scheduleShiftPreferenceForProfessionDate(preferences, professionKey, date);
    return {
        shiftStart: preference.startTime || '11:00',
        shiftEnd: preference.endTime || '20:00'
    };
}

function scheduleSegmentDurationMinutes(shiftStart, shiftEnd) {
    const start = scheduleTimeToMinutes(shiftStart);
    const rawEnd = scheduleTimeToMinutes(shiftEnd);
    if (start === null || rawEnd === null) return null;
    if (start === rawEnd) return 0;
    return (rawEnd <= start ? rawEnd + (24 * 60) : rawEnd) - start;
}

function scheduleSegmentClientKey(segment = {}) {
    const existing = String(segment.clientKey || '').trim();
    if (existing) return existing;
    staffScheduleSegmentClientSeq += 1;
    return `segment-${staffScheduleSegmentClientSeq}`;
}

function normalizeScheduleSegmentForUi(segment = {}, fallbackProfessionKey = '', options = {}) {
    const additionalRoleSource = Array.isArray(segment.additionalRoles)
        ? segment.additionalRoles
        : (Array.isArray(segment.additional_roles) ? segment.additional_roles : []);
    const additionalRoles = additionalRoleSource.map(role => ({
        professionKey: normalizeProfessionKey(role.professionKey || role.profession_key),
        compensationMode: String(role.compensationMode || role.compensation_mode || 'unpaid'),
        payMultiplier: role.payMultiplier ?? role.pay_multiplier ?? null,
        policyVersion: role.policyVersion || role.policy_version || null,
        intervalStart: normalizeSchedulePlanTime(role.intervalStart || role.interval_start),
        intervalEnd: normalizeSchedulePlanTime(role.intervalEnd || role.interval_end)
    })).filter(role => role.professionKey);
    const additionalSource = segment.additionalProfessionKeys || segment.additional_profession_keys || [];
    const additionalProfessionKeys = parseProfessionArray(additionalSource)
        .map(normalizeProfessionKey)
        .filter(Boolean);
    additionalRoles.forEach(role => additionalProfessionKeys.push(role.professionKey));
    const professionKey = normalizeProfessionKey(segment.professionKey || segment.profession_key || fallbackProfessionKey);
    const defaultTimes = schedulePlanDefaultSegmentTimes(options.scope, professionKey, {
        ...options,
        date: options.date || segment.date || segment.shift_date || segment.schedule_date
    });
    return {
        id: segment.id ?? null,
        clientKey: scheduleSegmentClientKey(segment),
        professionKey,
        shiftStart: normalizeSchedulePlanTime(segment.shiftStart || segment.shift_start || segment.planned_start) || defaultTimes.shiftStart,
        shiftEnd: normalizeSchedulePlanTime(segment.shiftEnd || segment.shift_end || segment.planned_end) || defaultTimes.shiftEnd,
        breakMinutes: Math.max(0, Number.parseInt(segment.breakMinutes ?? segment.break_minutes ?? 0, 10) || 0),
        note: String(segment.note ?? segment.notes ?? '').trim(),
        additionalRoles,
        additionalProfessionKeys: [...new Set(additionalProfessionKeys)]
    };
}

function sortScheduleSegmentsForUi(segments = [], fallbackProfessionKey = '', options = {}) {
    return segments
        .map((segment, inputIndex) => {
            const normalized = normalizeScheduleSegmentForUi(segment, fallbackProfessionKey, options);
            const startMinutes = scheduleTimeToMinutes(normalized.shiftStart);
            const rawEndMinutes = scheduleTimeToMinutes(normalized.shiftEnd);
            const endMinutes = startMinutes === null || rawEndMinutes === null
                ? Number.MAX_SAFE_INTEGER
                : (rawEndMinutes <= startMinutes ? rawEndMinutes + (24 * 60) : rawEndMinutes);
            return {
                segment: normalized,
                inputIndex,
                startMinutes: startMinutes ?? Number.MAX_SAFE_INTEGER,
                endMinutes
            };
        })
        .sort((left, right) => left.startMinutes - right.startMinutes
            || left.endMinutes - right.endMinutes
            || String(left.segment.professionKey).localeCompare(String(right.segment.professionKey), 'en')
            || left.inputIndex - right.inputIndex)
        .map(item => item.segment);
}

function scheduleEntrySegmentsForUi(entry = null, fallbackProfessionKey = '') {
    const rawSegments = Array.isArray(entry?.segments) ? entry.segments : [];
    const entryDate = entry?.date || entry?.shift_date || entry?.schedule_date;
    if (rawSegments.length) {
        return sortScheduleSegmentsForUi(rawSegments, fallbackProfessionKey, { date: entryDate });
    }
    if (entry && ['working', 'remote'].includes(normalizeScheduleStatus(entry.status)) && entry.shift_start && entry.shift_end) {
        return [normalizeScheduleSegmentForUi({
            professionKey: entry.primary_profession_key || entry.primaryProfessionKey || entry.profession_key || fallbackProfessionKey,
            shiftStart: entry.shift_start,
            shiftEnd: entry.shift_end,
            breakMinutes: entry.break_minutes || 0
        }, fallbackProfessionKey, { date: entryDate })];
    }
    return [];
}

function scheduleEntryProfessionKeys(entry = {}) {
    const explicit = parseProfessionArray(entry.profession_keys || entry.professionKeys || []);
    const fromSegments = scheduleEntrySegmentsForUi(entry).flatMap(segment => [
        segment.professionKey,
        ...(segment.additionalProfessionKeys || [])
    ]);
    return [...new Set([...explicit, ...fromSegments].map(normalizeProfessionKey).filter(Boolean))];
}

function formatScheduleMinutes(minutes) {
    const safeMinutes = Math.max(0, Number(minutes || 0));
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    return remainder ? `${hours} год ${remainder} хв` : `${hours} год`;
}

function formatShiftLoadRatio(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    return String(Math.round(value * 100) / 100).replace(/\.0$/, '');
}

function scheduleShiftLoadDate(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    const raw = String(value || '').trim();
    if (!raw) return null;
    const date = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
    return Number.isFinite(date.getTime()) ? date : null;
}

function scheduleShiftLoadFullShiftMinutes(entry = {}) {
    const date = scheduleShiftLoadDate(entry.date || entry.shift_date || entry.schedule_date);
    if (date && [0, 6].includes(date.getDay())) return STAFF_WEEKEND_FULL_SHIFT_MINUTES;
    return STAFF_FULL_SHIFT_MINUTES;
}

function scheduleShiftLoadMeta(entry = {}) {
    const status = normalizeScheduleStatus(entry.status);
    if (!['working', 'remote'].includes(status)) return { bucket: '', className: '', label: '', minutes: 0, ratio: null };
    const explicitPlannedMinutes = Number(entry.planned_minutes ?? entry.plannedMinutes);
    let minutes = Number.isFinite(explicitPlannedMinutes) && explicitPlannedMinutes >= 0
        ? explicitPlannedMinutes
        : null;
    if (minutes === null) {
        const start = scheduleTimeToMinutes(entry.shift_start);
        const end = scheduleTimeToMinutes(entry.shift_end);
        if (start === null || end === null) return { bucket: '', className: '', label: '', minutes: 0, ratio: null };
        minutes = end - start;
        if (minutes <= 0) minutes += 24 * 60;
    }
    if (minutes <= 0) return { bucket: '', className: '', label: '', minutes: 0, ratio: null };
    const exactRatio = minutes / scheduleShiftLoadFullShiftMinutes(entry);
    const roundedRatio = Math.max(0.25, Math.round(exactRatio * 4) / 4);
    let bucket = 'full';
    if (roundedRatio <= 0.25) bucket = 'quarter';
    else if (roundedRatio <= 0.5) bucket = 'half';
    else if (roundedRatio <= 0.75) bucket = 'three-quarter';
    else if (roundedRatio <= 1) bucket = 'full';
    else if (roundedRatio <= 1.25) bucket = 'long';
    else bucket = 'extra-long';
    const label = formatShiftLoadRatio(roundedRatio);
    return {
        bucket,
        className: `shift-load-${bucket}`,
        label,
        minutes,
        ratio: roundedRatio,
        showBadge: bucket !== 'full'
    };
}

function scheduleHasBlockingConflict(staffId, date, exceptScheduleId = null) {
    const entry = StaffState.schedule[`${staffId}_${date}`];
    if (!entry) return false;
    if (exceptScheduleId && Number(entry.id) === Number(exceptScheduleId)) return false;
    return ['working', 'remote', 'vacation', 'sick'].includes(entry.status);
}

function scheduleReplacementCandidates(entry = {}, currentStaff = {}) {
    const requiredProfessionKeys = scheduleEntryProfessionKeys(entry);
    if (!requiredProfessionKeys.length) {
        requiredProfessionKeys.push(normalizeProfessionKey(entry.profession_key || currentStaff.role_type));
    }
    return StaffState.staff
        .filter(staff => isScheduleableStaffForUi(staff, entry.date))
        .filter(staff => Number(staff.id) !== Number(entry.staff_id))
        .filter(staff => requiredProfessionKeys.filter(Boolean).every(professionKey => staffHasProfession(staff, professionKey)))
        .filter(staff => !scheduleHasBlockingConflict(staff.id, entry.date, entry.id))
        .map(staff => ({
            value: String(staff.id),
            label: `${staff.name} - ${staff.position || professionLabel(staff.role_type)}`
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'uk'));
}

function scheduleEntryTitle(emp, date, entry, shiftStart, shiftEnd) {
    const parts = [`${emp.name} - ${date}`];
    const segments = scheduleEntrySegmentsForUi(entry, entry?.profession_key || emp.role_type);
    if (segments.length) {
        parts.push(...segments.map(segment => {
            const additional = segment.additionalProfessionKeys.length
                ? ` + ${segment.additionalProfessionKeys.map(professionLabel).join(', ')}`
                : '';
            return `${segment.shiftStart}-${segment.shiftEnd} ${professionLabel(segment.professionKey)}${additional}`;
        }));
        parts.push(`Оплачувано: ${formatScheduleMinutes(entry?.planned_minutes ?? entry?.plannedMinutes ?? schedulePlanMetrics(segments).plannedMinutes)}`);
    } else if (shiftStart && shiftEnd) {
        parts.push(`${String(shiftStart).slice(0, 5)}-${String(shiftEnd).slice(0, 5)}`);
    }
    const loadMeta = scheduleShiftLoadMeta({ ...entry, date, shift_start: shiftStart, shift_end: shiftEnd });
    if (loadMeta.label && loadMeta.showBadge) parts.push(`load ${loadMeta.label}x`);
    if (isReplacementEntry(entry)) {
        parts.push(`Заміна за: ${entry.original_staff_name || 'працівника'}`);
        if (entry.replacement_reason) parts.push(`Причина: ${entry.replacement_reason}`);
    }
    return parts.join(' | ');
}

function scheduleCellAriaLabel(emp, date, entry, status, shiftStart, shiftEnd, attendanceDetails = {}, healthIssues = []) {
    const employeeName = String(emp.display_name || emp.name || '').trim() || 'Співробітник';
    const statusLabel = status === 'unset'
        ? 'Не заповнено'
        : (STAFF_SCHEDULE_STATUS_LABELS[status] || status);
    const parts = [
        `Графік: ${employeeName}`,
        `дата ${date}`,
        `статус ${statusLabel}`
    ];
    const segments = scheduleEntrySegmentsForUi(entry, entry?.profession_key || emp.role_type);
    if (segments.length) {
        parts.push(...segments.map((segment, index) => {
            const additionalRoles = segment.additionalProfessionKeys
                .map(professionLabel)
                .filter(Boolean);
            const roleLabel = [professionLabel(segment.professionKey), ...additionalRoles].filter(Boolean).join(', додатково ');
            return `блок ${index + 1}: ${segment.shiftStart}-${segment.shiftEnd}, ${roleLabel}`;
        }));
    } else if (shiftStart && shiftEnd) {
        parts.push(`час ${String(shiftStart).slice(0, 5)}-${String(shiftEnd).slice(0, 5)}`);
    }
    if (isReplacementEntry(entry)) {
        parts.push(`заміна за ${entry.original_staff_name || 'співробітника'}`);
    }
    if (attendanceDetails.status) {
        parts.push(`attendance ${attendanceDetails.label}`);
    }
    const healthSummary = scheduleHealthIssueSummary(healthIssues);
    if (healthSummary) parts.push(healthSummary);
    parts.push(StaffState.canManage ? 'Enter або пробіл відкриває редагування' : 'Enter або пробіл відкриває перегляд');
    return parts.join('. ');
}

function scheduleCompactSegmentTime(value) {
    const normalized = normalizeSchedulePlanTime(value);
    if (!normalized) return '';
    return normalized.endsWith(':00') ? normalized.slice(0, 2) : normalized;
}

function renderScheduleCellSegments(entry, fallbackProfessionKey, sectionProfessionKey, fullRange = false) {
    const segments = scheduleEntrySegmentsForUi(entry, fallbackProfessionKey);
    if (!segments.length) return '';
    const metrics = schedulePlanMetrics(segments);
    const plannedMinutes = Number(entry?.planned_minutes ?? entry?.plannedMinutes);
    const paidMinutes = Number.isFinite(plannedMinutes) ? plannedMinutes : metrics.plannedMinutes;
    if (fullRange) {
        return `<span class="sch-month-summary">${segments.length} ${segments.length === 1 ? 'блок' : 'блоки'} · ${escapeHtml(formatScheduleMinutes(paidMinutes))}</span>`;
    }
    const normalizedSectionProfession = normalizeProfessionKey(sectionProfessionKey);
    const segmentMatchesSection = segment => Boolean(normalizedSectionProfession && (
        segment.professionKey === normalizedSectionProfession
        || segment.additionalProfessionKeys.includes(normalizedSectionProfession)
    ));
    const visibleSegments = segments.slice(0, 2);
    const hiddenSegments = segments.slice(2);
    const hasVisibleSectionMatch = visibleSegments.some(segmentMatchesSection);
    const hasHiddenSectionMatch = hiddenSegments.some(segmentMatchesSection);
    const segmentSummary = segment => {
        const compactTime = `${scheduleCompactSegmentTime(segment.shiftStart)}–${scheduleCompactSegmentTime(segment.shiftEnd)}`;
        const roleSummary = [
            professionLabel(segment.professionKey),
            ...segment.additionalProfessionKeys.map(professionLabel)
        ].filter(Boolean).join(' + ');
        return { compactTime, roleSummary, text: `${compactTime} · ${roleSummary}` };
    };
    const visible = visibleSegments.map(segment => {
        const matchesSection = segmentMatchesSection(segment);
        const additional = segment.additionalProfessionKeys.length
            ? ` +${segment.additionalProfessionKeys.length}`
            : '';
        const summary = segmentSummary(segment);
        return `<span class="sch-segment-line ${matchesSection ? 'is-section-role' : ''}" title="${escapeHtml(summary.text)}">
            <span class="sch-time" data-schedule-compact-time="${escapeHtml(summary.compactTime)}">${escapeHtml(summary.compactTime)}</span>
            <span class="sch-profession">${escapeHtml(professionLabel(segment.professionKey))}${escapeHtml(additional)}</span>
        </span>`;
    }).join('');
    const hiddenSummary = hiddenSegments.map(segment => segmentSummary(segment).text).join(' | ');
    const more = hiddenSegments.length
        ? `<span class="sch-segment-more ${hasHiddenSectionMatch ? 'is-section-role' : ''}" title="${escapeHtml(hiddenSummary)}">+${hiddenSegments.length}</span>`
        : '';
    return `<span class="sch-segment-lines ${hasVisibleSectionMatch ? 'has-section-match' : ''}">${visible}${more}</span>`;
}

function scheduleHealthCellKey(staffId, date) {
    return `${Number(staffId)}_${date}`;
}

function scheduleHealthIsWorkStatus(status) {
    return ['working', 'remote'].includes(normalizeScheduleStatus(status));
}

function scheduleHealthIsOffStatus(status) {
    return ['dayoff', 'vacation', 'sick'].includes(normalizeScheduleStatus(status));
}

function scheduleHealthSeverity(issues = []) {
    return (issues || []).reduce((worst, issue) => (
        SCHEDULE_HEALTH_SEVERITY_RANK[issue.severity] > SCHEDULE_HEALTH_SEVERITY_RANK[worst]
            ? issue.severity
            : worst
    ), 'ok');
}

function scheduleHealthScore(issues = []) {
    const penalty = (issues || []).reduce((sum, issue) => sum + (SCHEDULE_HEALTH_SCORE_PENALTY[issue.severity] || 0), 0);
    return Math.max(0, Math.min(100, 100 - penalty));
}

function scheduleHealthShiftRange(entry = {}) {
    const start = scheduleTimeToMinutes(entry.shift_start);
    const endRaw = scheduleTimeToMinutes(entry.shift_end);
    if (start === null || endRaw === null) return null;
    const end = endRaw <= start ? endRaw + (24 * 60) : endRaw;
    return { start, end };
}

function scheduleHealthRangesOverlap(a, b) {
    if (!a || !b) return false;
    return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

function scheduleHealthShiftProfessionKey(staff = {}, entry = {}) {
    const explicitProfession = normalizeProfessionKey(entry.profession_key || entry.professionKey);
    if (explicitProfession) return explicitProfession;
    return normalizeProfessionKey(staff.role_type || staff.roleType);
}

function scheduleHealthSegmentRange(segment = {}) {
    const start = scheduleTimeToMinutes(segment.shiftStart || segment.shift_start || segment.start);
    const endRaw = scheduleTimeToMinutes(segment.shiftEnd || segment.shift_end || segment.end);
    if (start === null || endRaw === null || start === endRaw) return null;
    return { start, end: endRaw <= start ? endRaw + (24 * 60) : endRaw };
}

function scheduleHealthSegmentRoles(segment = {}) {
    return [...new Set([
        segment.professionKey || segment.profession_key,
        ...(segment.additionalProfessionKeys || segment.additional_profession_keys || [])
    ].map(normalizeProfessionKey).filter(Boolean))];
}

function scheduleHealthBookingFitsSegments(booking = {}, segments = [], professionKey = 'animator') {
    const start = staffingForecastBookingTimeMinutes(booking);
    if (start === null) return false;
    const end = start + Math.max(0, Number(booking.duration || 0));
    return (segments || []).some(segment => {
        if (!scheduleHealthSegmentRoles(segment).includes(professionKey)) return false;
        const range = scheduleHealthSegmentRange(segment);
        return range && start >= range.start && end <= range.end;
    });
}

function scheduleHealthShiftDepartment(staff = {}, entry = {}) {
    return scheduleProfessionDisplayGroupKey(scheduleHealthShiftProfessionKey(staff, entry));
}

function isScheduleManagerStaff(staff = {}, entry = null) {
    if (entry) return SCHEDULE_HEALTH_MANAGER_ROLES.has(scheduleHealthShiftProfessionKey(staff, entry));
    const keys = [staff.role_type || staff.roleType, ...staffSecondaryProfessions(staff)]
        .map(normalizeProfessionKey)
        .filter(Boolean);
    return keys.some(key => SCHEDULE_HEALTH_MANAGER_ROLES.has(key));
}

function scheduleHealthPush(map, key, issue) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(issue);
}

function scheduleHealthIssueSummary(issues = [], limit = 3) {
    return (issues || [])
        .slice(0, limit)
        .map(issue => issue.title || issue.detail || issue.code)
        .filter(Boolean)
        .join(' | ');
}

function scheduleHealthIssueDetail(issue = {}) {
    return [issue.title, issue.detail].filter(Boolean).join(': ');
}

function scheduleHealthCounts(issues = []) {
    return (issues || []).reduce((acc, issue) => {
        acc[issue.severity] = (acc[issue.severity] || 0) + 1;
        return acc;
    }, { critical: 0, warning: 0, info: 0 });
}

function scheduleHealthIssue({ code, severity = 'warning', scope = 'row', title, detail, staff = null, staffId = null, date = '', department = '' }) {
    const resolvedStaffId = Number(staff?.id ?? staffId);
    const staffName = String(staff?.display_name || staff?.name || '').trim();
    return {
        code,
        severity,
        scope,
        title,
        detail,
        staffId: Number.isFinite(resolvedStaffId) ? resolvedStaffId : null,
        staffName,
        date,
        department,
        id: ''
    };
}

function buildScheduleHealth(dates = getScheduleDates(), visibleStaff = scheduleVisibleStaff(), options = {}) {
    const dateKeys = dates.map(formatDateStr);
    const dateSet = new Set(dateKeys);
    const uniqueVisibleStaff = uniqueScheduleStaffById(visibleStaff || []);
    const staffById = new Map(uniqueVisibleStaff.map(staff => [Number(staff.id), staff]));
    const issues = [];
    const rowIssuesByStaff = new Map();
    const staffIssuesByStaff = new Map();
    const cellIssuesByKey = new Map();
    const dayIssuesByDate = new Map();
    const departmentIssuesByKey = new Map();
    const rawEntriesByCell = new Map();
    const workingCountByDepartmentDate = new Map();

    const addIssue = (issue) => {
        if (!issue?.code) return;
        const normalized = { ...issue, id: `${issue.code}:${issues.length + 1}` };
        issues.push(normalized);
        if (normalized.staffId !== null && normalized.staffId !== undefined) {
            scheduleHealthPush(staffIssuesByStaff, Number(normalized.staffId), normalized);
            if (normalized.scope === 'row') scheduleHealthPush(rowIssuesByStaff, Number(normalized.staffId), normalized);
            if (normalized.scope === 'cell' && normalized.date) {
                scheduleHealthPush(cellIssuesByKey, scheduleHealthCellKey(normalized.staffId, normalized.date), normalized);
            }
        }
        if (normalized.date) scheduleHealthPush(dayIssuesByDate, normalized.date, normalized);
        if (normalized.department) scheduleHealthPush(departmentIssuesByKey, normalized.department, normalized);
    };

    const rawEntries = (StaffState.scheduleRawEntries || [])
        .filter(entry => staffById.has(Number(entry.staff_id)) && dateSet.has(entry.date));

    for (const entry of rawEntries) {
        const key = scheduleHealthCellKey(entry.staff_id, entry.date);
        scheduleHealthPush(rawEntriesByCell, key, entry);
    }

    for (const staff of uniqueVisibleStaff) {
        const department = scheduleDisplayDepartmentKey(staff);
        const pool = String(staff.hr_pool_status || '').trim();
        const readiness = staffCardTrainingReadiness(staff);
        const hasRole = Boolean(normalizeProfessionKey(staff.role_type) || staffSecondaryProfessions(staff).length);

        if (staff.is_active === false) {
            addIssue(scheduleHealthIssue({ code: 'staff_inactive', severity: 'critical', scope: 'row', title: 'Staff inactive', detail: 'Працівник не активний, але присутній у видимому графіку.', staff, department }));
        }
        if (pool === 'blacklisted' || pool === 'offboarded' || pool === 'dismissed' || staff.termination_date) {
            addIssue(scheduleHealthIssue({ code: 'staff_blacklisted_or_offboarded', severity: 'critical', scope: 'row', title: 'Offboarded/blacklisted staff', detail: 'Працівник має HR-статус, який не має потрапляти в активний графік.', staff, department }));
        }
        if (staff.is_freelance && !StaffState.includeFreelance) {
            addIssue(scheduleHealthIssue({ code: 'freelance_without_explicit_mode', severity: 'critical', scope: 'row', title: 'Freelance without explicit mode', detail: 'Фріланс/placeholder рядок показаний без include_freelance=true.', staff, department }));
        }
        if (staff.has_account !== true) {
            addIssue(scheduleHealthIssue({ code: 'missing_account', severity: 'warning', scope: 'row', title: 'No CRM account', detail: 'Працівник не привʼязаний до CRM account.', staff, department }));
        }
        if (staff.has_face_descriptor !== true) {
            addIssue(scheduleHealthIssue({ code: 'missing_face_descriptor', severity: 'warning', scope: 'row', title: 'No face descriptor', detail: 'Немає face descriptor для фактичної присутності.', staff, department }));
        }
        if (readiness.hasData && readiness.total > 0 && readiness.percent < 45) {
            addIssue(scheduleHealthIssue({ code: 'low_readiness', severity: 'warning', scope: 'row', title: 'Low readiness', detail: `Готовність навчання ${readiness.percent}%.`, staff, department }));
        } else if (readiness.hasData && readiness.total > 0 && readiness.percent < 85) {
            addIssue(scheduleHealthIssue({ code: 'partial_readiness', severity: 'info', scope: 'row', title: 'Partial readiness', detail: `Готовність навчання ${readiness.percent}%.`, staff, department }));
        }
        if (!hasRole) {
            addIssue(scheduleHealthIssue({ code: 'staff_without_role', severity: 'warning', scope: 'row', title: 'No staff role', detail: 'У картці працівника не задана роль/професія.', staff, department }));
        }

        for (const date of dateKeys) {
            const entry = StaffState.schedule[`${staff.id}_${date}`];
            if (!entry) continue;
            const status = normalizeScheduleStatus(entry.status);
            if (!scheduleHealthIsWorkStatus(status)) continue;
            const segments = scheduleEntrySegmentsForUi(entry, staff.role_type);
            const segmentDepartments = [...new Set(segments
                .flatMap(scheduleHealthSegmentRoles)
                .map(scheduleProfessionDisplayGroupKey)
                .filter(Boolean))];
            const shiftDepartment = segmentDepartments[0] || scheduleHealthShiftDepartment(staff, entry);
            const issueDepartment = shiftDepartment || department;
            for (const segmentDepartment of segmentDepartments.length ? segmentDepartments : [shiftDepartment].filter(Boolean)) {
                const countKey = `${segmentDepartment}:${date}`;
                workingCountByDepartmentDate.set(countKey, (workingCountByDepartmentDate.get(countKey) || 0) + 1);
            }

            if (staff.is_active === false || pool === 'blacklisted' || pool === 'offboarded' || staff.termination_date) {
                addIssue(scheduleHealthIssue({ code: 'planned_inactive_staff', severity: 'critical', scope: 'cell', title: 'Inactive staff scheduled', detail: 'На зміну поставлений неактивний/offboarded працівник.', staff, date, department: issueDepartment }));
            }

            const professionKeys = [...new Set(segments.flatMap(scheduleHealthSegmentRoles))];
            if (!professionKeys.length) {
                addIssue(scheduleHealthIssue({ code: 'shift_without_role', severity: 'warning', scope: 'cell', title: 'Shift without role', detail: 'Робоча зміна не має професії/ролі.', staff, date, department: issueDepartment }));
            } else if (professionKeys.some(professionKey => !staffHasProfession(staff, professionKey))) {
                addIssue(scheduleHealthIssue({ code: 'profession_mismatch', severity: 'critical', scope: 'cell', title: 'Profession mismatch', detail: 'Професія зміни не відповідає професіям у HR-картці працівника.', staff, date, department: issueDepartment }));
            }

            const loadMeta = scheduleShiftLoadMeta({ ...entry, status, date });
            if (loadMeta.minutes > SCHEDULE_HEALTH_LONG_DAY_MINUTES) {
                addIssue(scheduleHealthIssue({ code: 'long_total_day', severity: 'warning', scope: 'cell', title: 'Long total day', detail: `Сумарний оплачуваний план триває ${Math.round(loadMeta.minutes / 60)} годин.`, staff, date, department: issueDepartment }));
            }
            const ranges = segments.map(segment => ({ segment, range: scheduleHealthSegmentRange(segment) }));
            if (ranges.some(item => item.range && (item.range.end - item.range.start) > SCHEDULE_HEALTH_LONG_SHIFT_MINUTES)) {
                addIssue(scheduleHealthIssue({ code: 'long_segment', severity: 'warning', scope: 'cell', title: 'Long segment', detail: 'Окремий часовий блок перевищує 12 годин.', staff, date, department: issueDepartment }));
            }
            let segmentOverlap = false;
            for (let left = 0; left < ranges.length && !segmentOverlap; left += 1) {
                for (let right = left + 1; right < ranges.length; right += 1) {
                    if (scheduleHealthRangesOverlap(ranges[left].range, ranges[right].range)) {
                        segmentOverlap = true;
                        break;
                    }
                }
            }
            if (segmentOverlap) {
                addIssue(scheduleHealthIssue({ code: 'overlapping_segments', severity: 'critical', scope: 'cell', title: 'Overlapping segments', detail: 'Оплачувані часові блоки одного дня перетинаються.', staff, date, department: issueDepartment }));
            }
            const animatorSegments = segments.filter(segment => scheduleHealthSegmentRoles(segment).includes('animator'));
            if (animatorSegments.length) {
                const outsideBookings = (StaffState.staffingForecastBookings[date] || []).filter(booking => {
                    const lineId = booking.lineId || booking.line_id || booking.resourceId || booking.resource_id;
                    return String(lineId || '') === String(staff.id)
                        && staffingForecastIsActiveBooking(booking)
                        && !scheduleHealthBookingFitsSegments(booking, animatorSegments, 'animator');
                });
                if (outsideBookings.length) {
                    addIssue(scheduleHealthIssue({ code: 'booking_outside_availability', severity: 'critical', scope: 'cell', title: 'Booking outside availability', detail: `${outsideBookings.length} існуючих бронювань потрапили у прогалину; їх не видалено, потрібна ручна перевірка.`, staff, date, department: issueDepartment }));
                }
            }
        }
    }

    for (const [cellKey, entries] of rawEntriesByCell.entries()) {
        if (entries.length < 2) continue;
        const first = entries[0];
        const staff = staffById.get(Number(first.staff_id));
        if (!staff) continue;
        const department = scheduleHealthShiftDepartment(staff, first) || scheduleDisplayDepartmentKey(staff);
        const statuses = entries.map(entry => normalizeScheduleStatus(entry.status));

        addIssue(scheduleHealthIssue({ code: 'duplicate_shift', severity: 'critical', scope: 'cell', title: 'Duplicate shift', detail: 'Для одного працівника в один день знайдено кілька рядків графіка.', staff, date: first.date, department }));

        if (statuses.some(scheduleHealthIsWorkStatus) && statuses.some(scheduleHealthIsOffStatus)) {
            addIssue(scheduleHealthIssue({ code: 'planned_off_conflict', severity: 'critical', scope: 'cell', title: 'Planned shift on day off/vacation', detail: 'У той самий день є робоча зміна і day off/vacation/sick.', staff, date: first.date, department }));
        }

        const workingEntries = entries.filter(entry => scheduleHealthIsWorkStatus(entry.status));
        let hasOverlap = false;
        for (let i = 0; i < workingEntries.length && !hasOverlap; i++) {
            for (let j = i + 1; j < workingEntries.length; j++) {
                if (scheduleHealthRangesOverlap(scheduleHealthShiftRange(workingEntries[i]), scheduleHealthShiftRange(workingEntries[j]))) {
                    hasOverlap = true;
                    break;
                }
            }
        }
        if (hasOverlap) {
            addIssue(scheduleHealthIssue({ code: 'overlapping_shift', severity: 'critical', scope: 'cell', title: 'Overlapping shifts', detail: 'Зміни одного працівника перетинаються по часу.', staff, date: first.date, department }));
        }
    }

    const grouped = groupStaffByScheduleDepartment(visibleStaff || [], {
        department: options.department,
        grouping: 'membership'
    });
    for (const [department, deptStaff] of Object.entries(grouped)) {
        const minWorking = SCHEDULE_HEALTH_DEPARTMENT_MIN_WORKING[department] || 0;
        if (!minWorking) continue;
        for (const date of dateKeys) {
            const entries = deptStaff.map(staff => StaffState.schedule[`${staff.id}_${date}`]).filter(Boolean);
            if (!entries.length) continue;
            const workingCount = workingCountByDepartmentDate.get(`${department}:${date}`) || 0;
            if (workingCount < minWorking) {
                addIssue(scheduleHealthIssue({
                    code: 'department_understaffed',
                    severity: 'warning',
                    scope: 'department',
                    title: 'Department understaffed',
                    detail: `${scheduleDisplayDepartmentLabel(department)}: ${workingCount}/${minWorking} людей у роботі.`,
                    date,
                    department
                }));
            }
        }
    }

    for (const date of dateKeys) {
        const hasVisibleWork = uniqueVisibleStaff.some(staff => scheduleHealthIsWorkStatus(StaffState.schedule[`${staff.id}_${date}`]?.status));
        if (!hasVisibleWork) continue;
        const managerPool = StaffState.activeDept === 'all' || StaffState.activeDept === 'reception'
            ? uniqueVisibleStaff
            : StaffState.staff;
        const hasManager = managerPool.some(staff => {
            const entry = StaffState.schedule[`${staff.id}_${date}`];
            return scheduleHealthIsWorkStatus(entry?.status) && isScheduleManagerStaff(staff, entry);
        });
        if (!hasManager) {
            addIssue(scheduleHealthIssue({
                code: 'no_responsible_manager',
                severity: 'warning',
                scope: 'department',
                title: 'No responsible manager',
                detail: 'На день є робочі зміни, але не знайдено відповідального manager у графіку.',
                date,
                department: StaffState.activeDept === 'all' ? 'all' : StaffState.activeDept
            }));
        }
    }

    const counts = scheduleHealthCounts(issues);
    const score = scheduleHealthScore(issues);
    const dayScores = dateKeys.map(date => {
        const dayIssues = dayIssuesByDate.get(date) || [];
        return { date, score: scheduleHealthScore(dayIssues), severity: scheduleHealthSeverity(dayIssues), count: dayIssues.length };
    });
    const departmentScores = Object.keys(grouped).map(department => {
        const deptIssues = departmentIssuesByKey.get(department) || [];
        return {
            department,
            label: scheduleDisplayDepartmentLabel(department),
            score: scheduleHealthScore(deptIssues),
            severity: scheduleHealthSeverity(deptIssues),
            count: deptIssues.length
        };
    });
    const hasScheduleData = rawEntries.length > 0 || (visibleStaff || []).some(staff => dateKeys.some(date => StaffState.schedule[`${staff.id}_${date}`]));
    const health = {
        score,
        severity: scheduleHealthSeverity(issues),
        counts,
        issues,
        rowIssuesByStaff,
        staffIssuesByStaff,
        cellIssuesByKey,
        dayScores,
        departmentScores,
        hasScheduleData,
        visibleStaffCount: (visibleStaff || []).length,
        okStaffCount: 0
    };
    health.okStaffCount = (visibleStaff || []).filter(staff => !scheduleHealthIssuesForStaff(health, staff.id).length).length;
    return health;
}

function scheduleHealthIssuesForStaff(health, staffId) {
    return health?.staffIssuesByStaff?.get(Number(staffId)) || [];
}

function scheduleHealthRowIssues(health, staffId) {
    return health?.rowIssuesByStaff?.get(Number(staffId)) || [];
}

function scheduleHealthCellIssues(health, staffId, date) {
    return health?.cellIssuesByKey?.get(scheduleHealthCellKey(staffId, date)) || [];
}

function scheduleHealthFilteredStaff(staffList = [], health = null) {
    const filter = SCHEDULE_HEALTH_FILTERS.includes(StaffState.healthFilter) ? StaffState.healthFilter : 'all';
    if (filter !== StaffState.healthFilter) StaffState.healthFilter = filter;
    if (filter === 'all' || !health) return staffList;
    return staffList.filter(staff => {
        const issues = scheduleHealthIssuesForStaff(health, staff.id);
        if (filter === 'ok') return issues.length === 0;
        return issues.some(issue => issue.severity === filter);
    });
}

function scheduleHealthIssuesForActiveFilter(health = null) {
    if (!health) return [];
    const filter = SCHEDULE_HEALTH_FILTERS.includes(StaffState.healthFilter) ? StaffState.healthFilter : 'all';
    if (filter === 'all') return health.issues;
    if (filter === 'ok') return [];
    return health.issues.filter(issue => issue.severity === filter);
}

function renderScheduleHealthBadges(issues = [], scope = 'cell') {
    if (!issues?.length) return '';
    const sorted = [...issues].sort((a, b) => (
        SCHEDULE_HEALTH_SEVERITY_RANK[b.severity] - SCHEDULE_HEALTH_SEVERITY_RANK[a.severity]
    ));
    const counts = scheduleHealthCounts(sorted);
    const severity = scheduleHealthSeverity(sorted);
    const count = sorted.length;
    const mark = severity === 'critical' ? '!' : (severity === 'warning' ? '!' : 'i');
    const countLabel = count > 9 ? '9+' : String(count);
    const countSummary = [
        counts.critical ? `${counts.critical} critical` : '',
        counts.warning ? `${counts.warning} warning` : '',
        counts.info ? `${counts.info} info` : ''
    ].filter(Boolean).join(', ');
    const details = sorted.map(scheduleHealthIssueDetail).filter(Boolean);
    const detail = [countSummary || `${count} issue${count === 1 ? '' : 's'}`, ...details].join(' | ');
    const ariaLabel = `Schedule health ${severity}, ${count} issue${count === 1 ? '' : 's'}: ${details.join('; ') || countSummary}`;
    return `<span class="schedule-health-badges schedule-health-badges-${scope}">
        <button type="button" class="schedule-health-badge schedule-health-badge-compact is-${severity}" data-health-detail="${escapeHtml(detail)}" title="${escapeHtml(detail)}" aria-label="${escapeHtml(ariaLabel)}">
            <span class="schedule-health-badge-mark" aria-hidden="true">${mark}</span>
            <span class="schedule-health-badge-count" aria-hidden="true">${countLabel}</span>
        </button>
    </span>`;
}

function renderScheduleHealthIssueList(health = null) {
    if (!health) return '';
    if (!health.hasScheduleData) {
        return '<div class="schedule-health-empty">Немає заповнених змін у видимому періоді. Health показує тільки HR-card ризики працівників.</div>';
    }
    const issues = scheduleHealthIssuesForActiveFilter(health)
        .sort((a, b) => SCHEDULE_HEALTH_SEVERITY_RANK[b.severity] - SCHEDULE_HEALTH_SEVERITY_RANK[a.severity])
        .slice(0, 6);
    if (!issues.length) {
        return '<div class="schedule-health-empty">Для цього health-фільтра немає активних issues.</div>';
    }
    return `<div class="schedule-health-issues">
        ${issues.map(issue => {
            const detail = scheduleHealthIssueDetail(issue);
            const meta = [issue.staffName, issue.date, issue.department && issue.department !== 'all' ? scheduleDisplayDepartmentLabel(issue.department) : '']
                .filter(Boolean)
                .join(' · ');
            return `<button type="button" class="schedule-health-issue is-${issue.severity}" data-health-detail="${escapeHtml(detail)}">
                <span class="schedule-health-issue-level">${escapeHtml(SCHEDULE_HEALTH_LABELS[issue.severity] || issue.severity)}</span>
                <span class="schedule-health-issue-title">${escapeHtml(issue.title || issue.code)}</span>
                ${meta ? `<span class="schedule-health-issue-meta">${escapeHtml(meta)}</span>` : ''}
            </button>`;
        }).join('')}
    </div>`;
}

function renderScheduleHealthPanel(health = null) {
    const container = document.getElementById('scheduleHealthPanel');
    if (!container || !health) return;
    const counts = health.counts || { critical: 0, warning: 0, info: 0 };
    const filterCounts = {
        all: health.visibleStaffCount,
        critical: counts.critical || 0,
        warning: counts.warning || 0,
        ok: health.okStaffCount || 0
    };
    const filterLabels = { all: 'All', critical: 'Critical', warning: 'Warnings', ok: 'OK' };
    const dayHtml = health.dayScores.map(day => `
        <span class="schedule-health-pill is-${day.severity}" title="${day.count} issues">
            ${escapeHtml(day.date.slice(5))}<b>${day.score}</b>
        </span>
    `).join('');
    const departmentHtml = health.departmentScores.map(dept => `
        <span class="schedule-health-pill is-${dept.severity}" title="${dept.count} issues">
            ${escapeHtml(dept.label)}<b>${dept.score}</b>
        </span>
    `).join('');

    container.innerHTML = `
        <div class="schedule-health-head">
            <div class="schedule-health-score is-${health.severity}">
                <span>Health</span>
                <b>${health.score}</b>
            </div>
            <div class="schedule-health-counts">
                <span class="is-critical">${counts.critical || 0} critical</span>
                <span class="is-warning">${counts.warning || 0} warnings</span>
                <span class="is-info">${counts.info || 0} info</span>
            </div>
            <div class="schedule-health-filter-bar" role="group" aria-label="Schedule health filter">
                ${SCHEDULE_HEALTH_FILTERS.map(key => `
                    <button type="button" class="schedule-health-filter ${StaffState.healthFilter === key ? 'active' : ''}" data-health-filter="${key}">
                        ${filterLabels[key]} <b>${filterCounts[key] || 0}</b>
                    </button>
                `).join('')}
            </div>
        </div>
        <div class="schedule-health-metrics">
            <div class="schedule-health-strip" aria-label="Health by day">${dayHtml}</div>
            ${departmentHtml ? `<div class="schedule-health-strip" aria-label="Health by department">${departmentHtml}</div>` : ''}
        </div>
        ${renderScheduleHealthIssueList(health)}
    `;
    container.querySelectorAll('[data-health-filter]').forEach(button => {
        button.addEventListener('click', () => {
            const next = button.dataset.healthFilter;
            if (!SCHEDULE_HEALTH_FILTERS.includes(next)) return;
            StaffState.healthFilter = next;
            renderSchedule();
        });
    });
    bindScheduleHealthDetailButtons(container);
}

function bindScheduleHealthDetailButtons(root = document) {
    root.querySelectorAll('[data-health-detail]').forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const detail = button.dataset.healthDetail || button.getAttribute('title') || '';
            if (detail && typeof showNotification === 'function') {
                showNotification(detail, 'warning');
            }
        });
    });
}

function staffingForecastLabel(key) {
    return STAFFING_FORECAST_LABELS[key] || scheduleDisplayDepartmentLabel(key) || key;
}

function staffingForecastObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function staffingForecastNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function staffingForecastBool(value) {
    if (value === true || value === 1) return true;
    const text = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'так'].includes(text);
}

function staffingForecastBookingText(booking = {}) {
    return [
        booking.category,
        booking.programName,
        booking.program_name,
        booking.programCode,
        booking.program_code,
        booking.label,
        booking.room,
        booking.status
    ].filter(Boolean).join(' ').toLowerCase();
}

function staffingForecastExpectedGuests(booking = {}) {
    const extra = staffingForecastObject(booking.extraData || booking.extra_data);
    const bookingPackage = staffingForecastObject(booking.bookingPackage || booking.booking_package || extra.bookingPackage || extra.package);
    const counts = staffingForecastObject(bookingPackage.counts || extra.counts);
    const banquetTotal = staffingForecastNumber(booking.banquetGuests || booking.banquet_guests)
        + staffingForecastNumber(booking.banquetAdults || booking.banquet_adults);
    const packageTotal = staffingForecastNumber(counts.children || counts.kids)
        + staffingForecastNumber(counts.adults);
    const candidates = [
        booking.expectedGuestCount,
        booking.expected_guest_count,
        booking.guestCount,
        booking.guest_count,
        booking.guests,
        booking.kidsCount,
        booking.kids_count,
        booking.childrenCount,
        booking.children_count,
        booking.banquetGuests,
        booking.banquet_guests,
        booking.banquetAdults,
        booking.banquet_adults,
        extra.expectedGuestCount,
        extra.guestCount,
        extra.guests,
        extra.kidsCount,
        extra.children,
        extra.adults,
        counts.guests,
        counts.total,
        banquetTotal,
        packageTotal
    ].map(staffingForecastNumber).filter(Boolean);
    return Math.max(8, ...candidates, 0);
}

function staffingForecastHostCount(booking = {}) {
    const hosts = booking.hosts;
    if (Array.isArray(hosts)) return Math.max(1, hosts.length);
    const numeric = staffingForecastNumber(hosts);
    if (numeric) return Math.max(1, Math.round(numeric));
    if (typeof hosts === 'string' && hosts.trim()) {
        return Math.max(1, hosts.split(',').map(item => item.trim()).filter(Boolean).length);
    }
    return 1;
}

function staffingForecastBookingTimeMinutes(booking = {}) {
    return scheduleTimeToMinutes(booking.time || booking.startTime || booking.start_time || booking.startsAt || booking.starts_at);
}

function staffingForecastIsActiveBooking(booking = {}) {
    const status = String(booking.status || '').trim().toLowerCase();
    return !['cancelled', 'canceled', 'declined', 'deleted', 'archived', 'rejected', 'void'].includes(status);
}

function staffingForecastIsTrampolineBooking(booking = {}) {
    return /trampoline|batut|батут/.test(staffingForecastBookingText(booking));
}

function staffingForecastIsCafeBooking(booking = {}) {
    const text = staffingForecastBookingText(booking);
    return /cafe|kitchen|banquet|menu|pizza|food|кафе|кух|банкет|меню|піц/.test(text)
        || staffingForecastNumber(booking.banquetGuests || booking.banquet_guests) > 0
        || staffingForecastNumber(booking.banquetAdults || booking.banquet_adults) > 0;
}

function staffingForecastDayRecommendation(date, bookings = []) {
    const activeBookings = (bookings || []).filter(staffingForecastIsActiveBooking);
    const recommended = STAFFING_FORECAST_DEPARTMENTS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    if (!activeBookings.length) {
        return { date, recommended, bookingCount: 0, expectedGuests: 0, peakBookings: 0, source: 'empty_day' };
    }

    const day = new Date(`${date}T00:00:00`).getDay();
    const isWeekend = day === 0 || day === 6;
    let expectedGuests = 0;
    let peakBookings = 0;
    let eveningBookings = 0;
    let cafeGuests = 0;

    for (const booking of activeBookings) {
        const guests = staffingForecastExpectedGuests(booking);
        const minutes = staffingForecastBookingTimeMinutes(booking);
        expectedGuests += guests;
        if (minutes !== null && minutes >= STAFFING_FORECAST_PEAK_START_MINUTES && minutes < STAFFING_FORECAST_PEAK_END_MINUTES) {
            peakBookings += 1;
        }
        if (minutes !== null && minutes >= STAFFING_FORECAST_TECH_EVENING_MINUTES) {
            eveningBookings += 1;
        }
        const hostDemand = Math.max(staffingForecastHostCount(booking), Math.ceil(guests / 12));
        recommended.animators += Math.max(staffingForecastBool(booking.secondAnimator || booking.second_animator) ? 2 : 1, hostDemand);
        if (staffingForecastIsTrampolineBooking(booking)) {
            recommended.trampoline += Math.max(1, Math.ceil(guests / 18));
        }
        if (staffingForecastIsCafeBooking(booking)) {
            cafeGuests += guests;
        }
    }

    recommended.reception = 1 + (activeBookings.length >= 5 || peakBookings >= 3 ? 1 : 0);
    recommended.managers = 1 + (activeBookings.length >= 6 || expectedGuests >= 60 ? 1 : 0);
    recommended.tech = 1 + (isWeekend || eveningBookings >= 2 || expectedGuests >= 70 ? 1 : 0);
    recommended.cafe = cafeGuests ? 1 + (cafeGuests >= 30 ? 1 : 0) : 0;
    recommended.cleaning = 1 + (activeBookings.length >= 5 || expectedGuests >= 40 ? 1 : 0);

    return {
        date,
        recommended,
        bookingCount: activeBookings.length,
        expectedGuests,
        peakBookings,
        source: 'bookings_timeline_heuristics_v1'
    };
}

function staffingForecastDepartmentForShift(staff = {}, entry = {}) {
    const professionKey = normalizeProfessionKey(entry.profession_key || staff.role_type);
    if (['manager', 'senior_manager', 'admin', 'vice_director', 'art_director'].includes(professionKey)) return 'managers';
    if (professionKey === 'reception') return 'reception';
    if (['trampoline_instructor', 'senior_instructor', 'instructor'].includes(professionKey)) return 'trampoline';
    if (professionKey === 'animator') return 'animators';
    if (['cook', 'pizzaiolo', 'barista', 'waiter'].includes(professionKey)) return 'cafe';
    if (['cleaner', 'cleaning', 'dishwasher', 'wardrobe'].includes(professionKey)) return 'cleaning';
    if (['tech', 'technician', 'security'].includes(professionKey)) return 'tech';
    const department = scheduleDisplayDepartmentKey(staff);
    return STAFFING_FORECAST_DEPARTMENTS.includes(department) ? department : '';
}

function staffingForecastDepartmentForProfession(professionKey, staff = {}) {
    const normalized = normalizeProfessionKey(professionKey);
    if (['manager', 'senior_manager', 'admin', 'vice_director', 'art_director'].includes(normalized)) return 'managers';
    if (normalized === 'reception') return 'reception';
    if (['trampoline_instructor', 'senior_instructor', 'instructor'].includes(normalized)) return 'trampoline';
    if (normalized === 'animator') return 'animators';
    if (['cook', 'pizzaiolo', 'barista', 'waiter'].includes(normalized)) return 'cafe';
    if (['cleaner', 'cleaning', 'dishwasher', 'wardrobe'].includes(normalized)) return 'cleaning';
    if (['tech', 'technician', 'security'].includes(normalized)) return 'tech';
    const department = scheduleDisplayDepartmentKey(staff);
    return STAFFING_FORECAST_DEPARTMENTS.includes(department) ? department : '';
}

function staffingForecastVisibleDepartments() {
    if (StaffState.activeDept === 'reception') return ['reception', 'managers'];
    if (StaffState.activeDept === 'tech') return ['tech'];
    if (STAFFING_FORECAST_DEPARTMENTS.includes(StaffState.activeDept)) return [StaffState.activeDept];
    return STAFFING_FORECAST_DEPARTMENTS;
}

function staffingForecastScheduledCounts(date, staffList = [], atMinutes = null) {
    const counts = STAFFING_FORECAST_DEPARTMENTS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    const staffByDepartment = STAFFING_FORECAST_DEPARTMENTS.reduce((acc, key) => ({ ...acc, [key]: new Set() }), {});
    for (const staff of staffList || []) {
        const entry = StaffState.schedule[`${staff.id}_${date}`];
        if (!entry || !scheduleHealthIsWorkStatus(entry.status)) continue;
        const segments = scheduleEntrySegmentsForUi(entry, staff.role_type);
        for (const segment of segments) {
            const range = scheduleHealthSegmentRange(segment);
            if (!range) continue;
            if (Number.isFinite(atMinutes) && !(atMinutes >= range.start && atMinutes < range.end)) continue;
            for (const role of scheduleHealthSegmentRoles(segment)) {
                const department = staffingForecastDepartmentForProfession(role, staff);
                if (department && staffByDepartment[department]) staffByDepartment[department].add(Number(staff.id));
            }
        }
    }
    for (const department of STAFFING_FORECAST_DEPARTMENTS) counts[department] = staffByDepartment[department].size;
    return counts;
}

function staffingForecastCoverageMinutes(bookings = []) {
    const minutes = new Set();
    for (const booking of (bookings || []).filter(staffingForecastIsActiveBooking)) {
        const start = staffingForecastBookingTimeMinutes(booking);
        if (start === null) continue;
        const end = start + Math.max(30, Number(booking.duration || 0));
        minutes.add(start);
        for (let cursor = Math.ceil(start / 30) * 30; cursor < end; cursor += 30) minutes.add(cursor);
    }
    return [...minutes].sort((left, right) => left - right);
}

function staffingForecastBookingActiveAt(booking = {}, minute) {
    const start = staffingForecastBookingTimeMinutes(booking);
    if (start === null) return false;
    const end = start + Math.max(30, Number(booking.duration || 0));
    return minute >= start && minute < end;
}

function staffingForecastGap(recommended = {}, scheduled = {}, departmentKeys = STAFFING_FORECAST_DEPARTMENTS) {
    return departmentKeys.reduce((acc, key) => {
        const need = Number(recommended[key] || 0);
        const planned = Number(scheduled[key] || 0);
        acc[key] = {
            recommended: need,
            scheduled: planned,
            missing: Math.max(0, need - planned),
            overstaffed: Math.max(0, planned - need)
        };
        return acc;
    }, {});
}

function buildStaffingDemandForecast(dates = getScheduleDates(), visibleStaff = scheduleVisibleStaff()) {
    const departmentKeys = staffingForecastVisibleDepartments();
    const days = (dates || []).map(dateObj => {
        const date = typeof dateObj === 'string' ? dateObj : formatDateStr(dateObj);
        const bookings = (StaffState.staffingForecastBookings[date] || []).filter(staffingForecastIsActiveBooking);
        const recommendation = staffingForecastDayRecommendation(date, bookings);
        const coverageSlots = staffingForecastCoverageMinutes(bookings).map(minute => {
            const activeBookings = bookings.filter(booking => staffingForecastBookingActiveAt(booking, minute));
            const slotRecommendation = staffingForecastDayRecommendation(date, activeBookings);
            const scheduled = staffingForecastScheduledCounts(date, visibleStaff, minute);
            return {
                minute,
                time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
                bookingCount: activeBookings.length,
                recommended: slotRecommendation.recommended,
                scheduled,
                gaps: staffingForecastGap(slotRecommendation.recommended, scheduled, departmentKeys)
            };
        });
        const fallbackScheduled = staffingForecastScheduledCounts(date, visibleStaff);
        const gaps = departmentKeys.reduce((acc, key) => {
            if (!coverageSlots.length) {
                acc[key] = staffingForecastGap(recommendation.recommended, fallbackScheduled, [key])[key];
                return acc;
            }
            acc[key] = coverageSlots
                .map(slot => slot.gaps[key])
                .sort((left, right) => right.missing - left.missing || right.recommended - left.recommended || left.scheduled - right.scheduled)[0];
            return acc;
        }, {});
        const scheduled = departmentKeys.reduce((acc, key) => ({ ...acc, [key]: gaps[key]?.scheduled || 0 }), {});
        const missing = Object.values(gaps).reduce((sum, gap) => sum + gap.missing, 0);
        const overstaffed = Object.values(gaps).reduce((sum, gap) => sum + gap.overstaffed, 0);
        return {
            date,
            ...recommendation,
            scheduled,
            gaps,
            coverageSlots,
            missing,
            overstaffed,
            severity: missing > 0 ? 'critical' : (overstaffed > 0 ? 'warning' : 'ok')
        };
    });
    const totals = departmentKeys.reduce((acc, key) => {
        acc[key] = days.reduce((sum, day) => {
            const gap = day.gaps[key] || {};
            return {
                recommended: sum.recommended + (gap.recommended || 0),
                scheduled: sum.scheduled + (gap.scheduled || 0),
                missing: sum.missing + (gap.missing || 0),
                overstaffed: sum.overstaffed + (gap.overstaffed || 0)
            };
        }, { recommended: 0, scheduled: 0, missing: 0, overstaffed: 0 });
        return acc;
    }, {});
    return {
        source: 'bookings_timeline_windows_v2',
        rules: STAFFING_FORECAST_RULES,
        departmentKeys,
        days,
        totals,
        bookingCount: days.reduce((sum, day) => sum + day.bookingCount, 0),
        expectedGuests: days.reduce((sum, day) => sum + day.expectedGuests, 0),
        totalMissing: Object.values(totals).reduce((sum, gap) => sum + gap.missing, 0),
        totalOverstaffed: Object.values(totals).reduce((sum, gap) => sum + gap.overstaffed, 0),
        hasSourceData: StaffState.staffingForecastAvailable
    };
}

function renderStaffingForecastGapChip(key, gap = {}) {
    const state = gap.missing ? 'is-missing' : (gap.overstaffed ? 'is-overstaffed' : 'is-ok');
    const delta = gap.missing ? `-${gap.missing}` : (gap.overstaffed ? `+${gap.overstaffed}` : 'ok');
    return `<span class="forecast-gap-chip ${state}" title="${escapeHtml(staffingForecastLabel(key))}: scheduled ${gap.scheduled || 0}, recommended ${gap.recommended || 0}">
        <span>${escapeHtml(staffingForecastLabel(key))}</span>
        <b>${gap.scheduled || 0}/${gap.recommended || 0}</b>
        <small>${escapeHtml(delta)}</small>
    </span>`;
}

function renderStaffingForecastPanel(forecast = null) {
    const container = document.getElementById('scheduleForecastPanel');
    if (!container) return;
    if (!forecast) {
        container.innerHTML = '';
        return;
    }
    if (!forecast.hasSourceData) {
        container.innerHTML = '<div class="forecast-empty">Staffing forecast unavailable: bookings/timeline data was not loaded. Schedule is unchanged.</div>';
        return;
    }
    const totalsHtml = forecast.departmentKeys
        .map(key => renderStaffingForecastGapChip(key, forecast.totals[key]))
        .join('');
    const daysHtml = forecast.days.map(day => {
        const dayGaps = forecast.departmentKeys
            .map(key => renderStaffingForecastGapChip(key, day.gaps[key]))
            .join('');
        const uncoveredSlots = (day.coverageSlots || []).filter(slot => (
            Object.values(slot.gaps || {}).some(gap => Number(gap.missing || 0) > 0)
        ));
        return `<div class="forecast-day-card is-${day.severity}">
            <div class="forecast-day-head">
                <span>${escapeHtml(day.date.slice(5))}</span>
                <b>${day.missing ? `${day.missing} missing` : 'covered'}</b>
            </div>
            <div class="forecast-day-meta">
                <span>${day.bookingCount} bookings</span>
                <span>${day.expectedGuests} guests</span>
                <span>${day.coverageSlots?.length || 0} time windows</span>
                ${day.overstaffed ? `<span>${day.overstaffed} over</span>` : ''}
            </div>
            ${uncoveredSlots.length ? `<div class="forecast-day-meta">Needs coverage: ${uncoveredSlots.slice(0, 4).map(slot => escapeHtml(slot.time)).join(', ')}</div>` : ''}
            <div class="forecast-day-gaps">${dayGaps}</div>
        </div>`;
    }).join('');
    const rulesHtml = Object.entries(forecast.rules || {})
        .map(([key, rule]) => `<li><b>${escapeHtml(staffingForecastLabel(key))}</b>: ${escapeHtml(rule)}</li>`)
        .join('');
    container.innerHTML = `
        <div class="forecast-head">
            <div>
                <span class="forecast-kicker">Demand forecast</span>
                <b>${forecast.totalMissing ? `${forecast.totalMissing} missing shifts` : 'No staffing gap'}</b>
            </div>
            <div class="forecast-source">${escapeHtml(forecast.source)}</div>
        </div>
        <div class="forecast-total-row">${totalsHtml}</div>
        <div class="forecast-days">${daysHtml}</div>
        <details class="forecast-rules">
            <summary>Rules</summary>
            <ul>${rulesHtml}</ul>
        </details>
    `;
}

function managerAccountabilityStaffName(staff = {}) {
    return String(staff.display_name || staff.name || '').trim() || 'Manager';
}

function isManagerAccountabilityStaff(staff = {}) {
    const keys = [staff.role_type, ...staffSecondaryProfessions(staff)]
        .map(normalizeProfessionKey)
        .filter(Boolean);
    return keys.some(key => MANAGER_ACCOUNTABILITY_ROLES.has(key));
}

function managerAccountabilityDepartmentKeys(staffList = []) {
    const grouped = groupStaffByScheduleDepartment(staffList || [], { grouping: 'membership' });
    return scheduleDepartmentRenderOrder(grouped);
}

function managerAccountabilityManagersForDepartment(department, managers = []) {
    return managers.filter(manager => {
        const rawDepartment = String(manager.department || '').trim();
        return rawDepartment === department || scheduleDisplayDepartmentKey(manager) === department;
    });
}

function managerAccountabilityLowReadiness(staffList = []) {
    return (staffList || []).filter(staff => {
        const readiness = staffCardTrainingReadiness(staff);
        return readiness.hasData && readiness.total > 0 && readiness.percent < 45;
    }).length;
}

function managerAccountabilityAttendanceCounts(dates = [], deptStaff = []) {
    const counts = { noShows: 0, unresolvedAttendance: 0 };
    for (const staff of deptStaff || []) {
        for (const dateObj of dates || []) {
            const date = typeof dateObj === 'string' ? dateObj : formatDateStr(dateObj);
            const entry = StaffState.schedule[`${staff.id}_${date}`];
            const record = scheduleAttendanceRecord(staff.id, date);
            const status = scheduleAttendanceStatus(entry, record, date);
            if (status === 'absent') counts.noShows += 1;
            if (status === 'manual_review' || status === 'left_early') counts.unresolvedAttendance += 1;
        }
    }
    return counts;
}

function managerAccountabilityDepartmentIssues(health = null, department = '') {
    const issues = (health?.issues || []).filter(issue => issue.department === department);
    return {
        issues,
        critical: issues.filter(issue => issue.severity === 'critical').length,
        warning: issues.filter(issue => issue.severity === 'warning').length
    };
}

function managerAccountabilityHealthScore(health = null, department = '') {
    const score = (health?.departmentScores || []).find(item => item.department === department);
    return score || {
        department,
        label: scheduleDisplayDepartmentLabel(department),
        score: 100,
        severity: 'ok',
        count: 0
    };
}

function managerAccountabilityMetric(value, source = 'available') {
    return {
        value,
        available: source === 'available',
        source
    };
}

function buildManagerAccountability(dates = getScheduleDates(), staffList = StaffState.staff, health = null) {
    const grouped = groupStaffByScheduleDepartment(staffList || [], { grouping: 'membership' });
    const departmentKeys = managerAccountabilityDepartmentKeys(staffList);
    const managers = (staffList || []).filter(isManagerAccountabilityStaff);
    const departments = departmentKeys.map(department => {
        const deptStaff = grouped[department] || [];
        const assignedManagers = managerAccountabilityManagersForDepartment(department, managers);
        const issues = managerAccountabilityDepartmentIssues(health, department);
        const healthScore = managerAccountabilityHealthScore(health, department);
        const attendance = managerAccountabilityAttendanceCounts(dates, deptStaff);
        const lowReadiness = managerAccountabilityLowReadiness(deptStaff);
        return {
            department,
            label: scheduleDisplayDepartmentLabel(department),
            assignedManagers,
            managerSource: assignedManagers.length ? MANAGER_ACCOUNTABILITY_MAPPING_SOURCE : 'explicit_department_manager_mapping_missing',
            healthScore,
            openCriticalIssues: managerAccountabilityMetric(issues.critical),
            warningIssues: managerAccountabilityMetric(issues.warning),
            lateReports: managerAccountabilityMetric(null, MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS.lateReports),
            payrollDiscrepancies: managerAccountabilityMetric(null, MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS.payrollDiscrepancies),
            noShows: managerAccountabilityMetric(attendance.noShows),
            unresolvedAttendance: managerAccountabilityMetric(attendance.unresolvedAttendance),
            unapprovedShifts: managerAccountabilityMetric(null, MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS.unapprovedShifts),
            lowReadiness: managerAccountabilityMetric(lowReadiness),
            unresolvedIssues: issues.critical + issues.warning + attendance.noShows + attendance.unresolvedAttendance + lowReadiness
        };
    });

    const managerRows = managers.map(manager => {
        const responsibleDepartments = departments.filter(dept => (
            dept.assignedManagers.some(item => Number(item.id) === Number(manager.id))
        ));
        const unresolvedIssues = responsibleDepartments.reduce((sum, dept) => sum + dept.unresolvedIssues, 0);
        return {
            id: Number(manager.id),
            name: managerAccountabilityStaffName(manager),
            role: professionLabel(manager.role_type) || manager.position || '',
            departments: responsibleDepartments.map(dept => dept.department),
            unresolvedIssues,
            weeklyTrend: managerAccountabilityMetric(null, MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS.weeklyTrend),
            lastActionDate: managerAccountabilityMetric(null, MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS.lastActionDate),
            profileHref: `/hr?employee=${encodeURIComponent(manager.id)}`
        };
    });

    return {
        source: 'staff_schedule_health_attendance_hr_cards',
        mappingSource: MANAGER_ACCOUNTABILITY_MAPPING_SOURCE,
        departments,
        managers: managerRows,
        hasExplicitDepartmentManagerMapping: false,
        missingSources: Object.values(MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS),
        dateRange: dates.map(dateObj => (typeof dateObj === 'string' ? dateObj : formatDateStr(dateObj)))
    };
}

function renderManagerAccountabilityMetric(metric = {}, label = '') {
    if (!metric.available) {
        return `<span class="accountability-metric is-unavailable" title="${escapeHtml(metric.source || 'source unavailable')}">
            <b>N/A</b><span>${escapeHtml(label)}</span>
        </span>`;
    }
    const value = Number(metric.value || 0);
    const state = value > 0 ? 'is-attention' : 'is-ok';
    return `<span class="accountability-metric ${state}">
        <b>${value}</b><span>${escapeHtml(label)}</span>
    </span>`;
}

function managerAccountabilityFilteredDepartments(accountability = null) {
    if (!accountability) return [];
    const deptFilter = StaffState.accountabilityDeptFilter || 'all';
    const managerFilter = StaffState.accountabilityManagerFilter || 'all';
    return (accountability.departments || []).filter(row => {
        if (deptFilter !== 'all' && row.department !== deptFilter) return false;
        if (managerFilter === 'unassigned') return row.assignedManagers.length === 0;
        if (managerFilter !== 'all') {
            return row.assignedManagers.some(manager => String(manager.id) === managerFilter);
        }
        return true;
    });
}

function renderManagerAccountabilityPanel(accountability = null) {
    const container = document.getElementById('managerAccountabilityPanel');
    if (!container) return;
    if (!accountability) {
        container.innerHTML = '';
        return;
    }
    const rows = managerAccountabilityFilteredDepartments(accountability);
    const deptOptions = (accountability.departments || []).map(row => (
        `<option value="${escapeHtml(row.department)}" ${StaffState.accountabilityDeptFilter === row.department ? 'selected' : ''}>${escapeHtml(row.label)}</option>`
    )).join('');
    const managerOptions = (accountability.managers || []).map(manager => (
        `<option value="${escapeHtml(manager.id)}" ${String(StaffState.accountabilityManagerFilter) === String(manager.id) ? 'selected' : ''}>${escapeHtml(manager.name)}</option>`
    )).join('');
    const bodyHtml = rows.length ? rows.map(row => {
        const managerHtml = row.assignedManagers.length
            ? row.assignedManagers.map(manager => `<a href="/hr?employee=${encodeURIComponent(manager.id)}">${escapeHtml(managerAccountabilityStaffName(manager))}</a>`).join(', ')
            : '<span class="accountability-unassigned">Не призначено</span>';
        return `<tr class="${row.openCriticalIssues.value > 0 ? 'has-critical' : ''}">
            <td>
                <button type="button" class="accountability-dept-link" data-accountability-dept="${escapeHtml(row.department)}">
                    ${escapeHtml(row.label)}
                </button>
                <small>${escapeHtml(row.managerSource)}</small>
            </td>
            <td>${managerHtml}</td>
            <td><span class="accountability-health is-${escapeHtml(row.healthScore.severity)}">${row.healthScore.score}</span></td>
            <td>
                ${renderManagerAccountabilityMetric(row.openCriticalIssues, 'critical')}
                ${renderManagerAccountabilityMetric(row.warningIssues, 'warnings')}
            </td>
            <td>
                ${renderManagerAccountabilityMetric(row.noShows, 'no-shows')}
                ${renderManagerAccountabilityMetric(row.unresolvedAttendance, 'attendance')}
            </td>
            <td>
                ${renderManagerAccountabilityMetric(row.lateReports, 'late reports')}
                ${renderManagerAccountabilityMetric(row.payrollDiscrepancies, 'payroll')}
            </td>
            <td>
                ${renderManagerAccountabilityMetric(row.unapprovedShifts, 'unapproved')}
                ${renderManagerAccountabilityMetric(row.lowReadiness, 'low readiness')}
            </td>
            <td class="accountability-actions">
                <button type="button" data-accountability-dept="${escapeHtml(row.department)}">Графік</button>
                <a href="/reports.html">Reports</a>
                <a href="/hr.html">HR</a>
            </td>
        </tr>`;
    }).join('') : '<tr><td colspan="8" class="accountability-empty">Немає відділів для поточного accountability filter.</td></tr>';

    const managerRows = (accountability.managers || []).map(manager => {
        const deptLabels = manager.departments.length
            ? manager.departments.map(dept => scheduleDisplayDepartmentLabel(dept)).join(', ')
            : 'Немає inferred-відділів';
        return `<div class="accountability-manager-row">
            <a href="${escapeHtml(manager.profileHref)}">${escapeHtml(manager.name)}</a>
            <span>${escapeHtml(deptLabels)}</span>
            ${renderManagerAccountabilityMetric(managerAccountabilityMetric(manager.unresolvedIssues), 'unresolved')}
            ${renderManagerAccountabilityMetric(manager.weeklyTrend, 'trend')}
            ${renderManagerAccountabilityMetric(manager.lastActionDate, 'last action')}
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="accountability-head">
            <div>
                <span class="accountability-kicker">Manager accountability</span>
                <b>${rows.reduce((sum, row) => sum + row.unresolvedIssues, 0)} unresolved issues</b>
            </div>
            <div class="accountability-filters">
                <select data-accountability-filter="department" aria-label="Accountability department filter">
                    <option value="all" ${StaffState.accountabilityDeptFilter === 'all' ? 'selected' : ''}>Всі відділи</option>
                    ${deptOptions}
                </select>
                <select data-accountability-filter="manager" aria-label="Accountability manager filter">
                    <option value="all" ${StaffState.accountabilityManagerFilter === 'all' ? 'selected' : ''}>Всі managers</option>
                    <option value="unassigned" ${StaffState.accountabilityManagerFilter === 'unassigned' ? 'selected' : ''}>Без manager</option>
                    ${managerOptions}
                </select>
            </div>
        </div>
        <div class="accountability-note">
            Explicit manager→department mapping is missing. Assigned manager is inferred from HR role_type and same display department; unavailable metrics are not counted as zero.
        </div>
        <div class="accountability-table-wrap">
            <table class="accountability-table">
                <thead>
                    <tr>
                        <th>Відділ</th>
                        <th>Manager</th>
                        <th>Health</th>
                        <th>Issues</th>
                        <th>Attendance</th>
                        <th>Reports/payroll</th>
                        <th>Shifts/readiness</th>
                        <th>Drill-down</th>
                    </tr>
                </thead>
                <tbody>${bodyHtml}</tbody>
            </table>
        </div>
        <div class="accountability-manager-list">
            ${managerRows || '<div class="accountability-empty">Немає manager/senior_manager у поточному staff pool.</div>'}
        </div>
    `;

    container.querySelectorAll('[data-accountability-filter]').forEach(select => {
        select.addEventListener('change', () => {
            if (select.dataset.accountabilityFilter === 'department') {
                StaffState.accountabilityDeptFilter = select.value || 'all';
            } else {
                StaffState.accountabilityManagerFilter = select.value || 'all';
            }
            renderManagerAccountabilityPanel(StaffState.managerAccountability);
        });
    });
    container.querySelectorAll('[data-accountability-dept]').forEach(button => {
        button.addEventListener('click', () => {
            const department = button.dataset.accountabilityDept || 'all';
            StaffState.activeDept = department;
            StaffState.accountabilityDeptFilter = department;
            renderDeptFilter();
            renderSchedule();
            document.getElementById('scheduleWrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

function replaceScheduleStateEntry(previousEntry, nextEntry) {
    if (previousEntry) {
        const oldKey = scheduleEntryKey(previousEntry);
        if (oldKey) delete StaffState.schedule[oldKey];
    }
    if (nextEntry) {
        const normalizedEntry = { ...nextEntry, status: normalizeScheduleStatus(nextEntry.status) };
        const newKey = scheduleEntryKey(normalizedEntry);
        if (newKey) StaffState.schedule[newKey] = normalizedEntry;
    }
}

function replaceScheduleRawStateEntry(previousEntry, nextEntry) {
    const previousKey = scheduleEntryKey(previousEntry || {});
    const rows = Array.isArray(StaffState.scheduleRawEntries) ? StaffState.scheduleRawEntries : [];
    const remaining = previousKey
        ? rows.filter(entry => scheduleEntryKey(entry) !== previousKey)
        : [...rows];
    if (nextEntry) remaining.push({ ...nextEntry, status: normalizeScheduleStatus(nextEntry.status) });
    StaffState.scheduleRawEntries = remaining;
}

const LEGACY_DEPARTMENT_FALLBACK = {
    animators: 'Аніматори',
    trampoline: 'Батутисти',
    admin: 'Адміністрація',
    cafe: 'Кафе',
    tech: 'Технічний відділ',
    cleaning: 'Прибирання',
    security: 'Охорона'
};

const SCHEDULE_DEPARTMENT_ORDER = ['animators', 'trampoline', 'reception', 'admin', 'cafe', 'tech', 'cleaning'];
const SCHEDULE_RECEPTION_ROLE_KEYS = new Set(['reception', 'manager', 'senior_manager']);
const SCHEDULE_COPY_RAW_DEPARTMENT_SAFE = new Set(['animators', 'trampoline', 'cafe', 'cleaning']);
const SCHEDULE_COPY_EXPLICIT_STAFF_CATEGORIES = new Set(['reception', 'tech', 'admin']);
const SCHEDULE_PROFESSION_DISPLAY_GROUP_FALLBACK = Object.freeze({
    animator: 'animators',
    host: 'animators',
    trampoline_instructor: 'trampoline',
    senior_instructor: 'trampoline',
    instructor: 'trampoline',
    reception: 'reception',
    manager: 'reception',
    senior_manager: 'reception',
    admin: 'admin',
    vice_director: 'admin',
    art_director: 'admin',
    hr: 'admin',
    accountant: 'admin',
    barista: 'cafe',
    cook: 'cafe',
    pizzaiolo: 'cafe',
    waiter: 'cafe',
    maintenance: 'tech',
    it_specialist: 'tech',
    security: 'tech',
    cleaner: 'cleaning',
    cleaning: 'cleaning',
    dishwasher: 'cleaning',
    wardrobe: 'cleaning'
});

function normalizeScheduleDisplayGroupKey(value) {
    const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
    return SCHEDULE_DEPARTMENT_ORDER.includes(key) ? key : '';
}

function normalizeScheduleDisplayGroups(groups = []) {
    if (!Array.isArray(groups)) return [];
    return groups
        .map((group, index) => {
            const source = group && typeof group === 'object' ? group : {};
            const key = normalizeScheduleDisplayGroupKey(source.key || source.value || source.id);
            const label = String(source.label || source.name || '').trim();
            const order = Number.isFinite(Number(source.order)) ? Number(source.order) : index;
            return key ? { key, label: label || LEGACY_DEPARTMENT_FALLBACK[key] || key, order } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order || SCHEDULE_DEPARTMENT_ORDER.indexOf(a.key) - SCHEDULE_DEPARTMENT_ORDER.indexOf(b.key));
}

function scheduleDisplayGroupOrder() {
    const apiOrder = (StaffState.displayGroups || []).map(group => group.key).filter(Boolean);
    return apiOrder.length ? apiOrder : SCHEDULE_DEPARTMENT_ORDER;
}

function getDepartmentOptionsFromStaffState() {
    const source = StaffState.departments && Object.keys(StaffState.departments).length
        ? StaffState.departments
        : LEGACY_DEPARTMENT_FALLBACK;
    return Object.entries(source).map(([value, label]) => ({ value, label }));
}

function scheduleCanonicalDisplayGroupKey(staff = {}) {
    const backendGroup = normalizeScheduleDisplayGroupKey(staff.display_group || staff.displayGroup);
    if (backendGroup) return backendGroup;
    return normalizeScheduleDisplayGroupKey(legacyScheduleDisplayDepartmentKey(staff)) || 'admin';
}

function scheduleDisplayDepartmentKey(staff = {}) {
    return scheduleCanonicalDisplayGroupKey(staff);
}

function legacyScheduleDisplayDepartmentKey(staff = {}) {
    const roleKey = normalizeProfessionKey(staff.role_type);
    if (SCHEDULE_RECEPTION_ROLE_KEYS.has(roleKey)) return 'reception';
    const department = String(staff.department || '').trim();
    if (department === 'security') return 'tech';
    return department || 'admin';
}

function scheduleDepartmentLabels() {
    const apiDepartmentLabels = {};
    for (const [key, value] of Object.entries(StaffState.departments || {})) {
        const label = String(value || '').trim();
        if (label && !/^\d+$/.test(label)) apiDepartmentLabels[key] = label;
    }
    const displayGroupLabels = {};
    for (const group of (StaffState.displayGroups || [])) {
        if (group.key && group.label) displayGroupLabels[group.key] = group.label;
    }
    return {
        ...LEGACY_DEPARTMENT_FALLBACK,
        ...apiDepartmentLabels,
        reception: 'Рецепшен',
        tech: 'Технічний відділ',
        ...displayGroupLabels
    };
}

function scheduleDisplayDepartmentLabel(departmentKey) {
    return scheduleDepartmentLabels()[departmentKey] || departmentKey;
}

function scheduleProfessionDisplayGroupKey(professionKey) {
    const key = normalizeProfessionKey(professionKey);
    if (!key) return '';
    if (SCHEDULE_RECEPTION_ROLE_KEYS.has(key)) return 'reception';
    const profession = (StaffState.professions || []).find(item => normalizeProfessionKey(item.key) === key);
    const catalogGroup = normalizeScheduleDisplayGroupKey(profession?.department);
    if (catalogGroup) return catalogGroup;
    return normalizeScheduleDisplayGroupKey(SCHEDULE_PROFESSION_DISPLAY_GROUP_FALLBACK[key]);
}

function staffScheduleDepartmentKeys(staff = {}) {
    const keys = [];
    const seen = new Set();
    const add = (key) => {
        const normalized = normalizeScheduleDisplayGroupKey(key);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        keys.push(normalized);
    };
    add(scheduleCanonicalDisplayGroupKey(staff));
    for (const professionKey of staffProfessionKeys(staff)) {
        add(scheduleProfessionDisplayGroupKey(professionKey));
    }
    return keys.length ? keys : ['admin'];
}

function staffMatchesScheduleDepartment(staff = {}, departmentKey = '') {
    const normalized = normalizeScheduleDisplayGroupKey(departmentKey);
    return Boolean(normalized && staffScheduleDepartmentKeys(staff).includes(normalized));
}

function scheduleDepartmentCountMap(staffList = StaffState.staff) {
    const counts = new Map();
    for (const staff of uniqueScheduleStaffById(scheduleableStaffForUi(staffList || []))) {
        for (const key of staffScheduleDepartmentKeys(staff)) {
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    return counts;
}

function shouldSkipScheduleSubGroup(departmentKey = '', subGroup = {}) {
    const parentKey = normalizeScheduleDisplayGroupKey(departmentKey);
    const parentLabel = normalizeScheduleSearchText(scheduleDisplayDepartmentLabel(parentKey));
    const subGroupLabel = normalizeScheduleSearchText(subGroup.label);
    return Boolean(parentLabel && subGroupLabel && parentLabel === subGroupLabel);
}

function scheduleSubGroupIdentity(subGroup = {}) {
    const roleKeys = departmentSubGroupRoleKeys(subGroup).sort().join(',');
    const departmentKeys = departmentSubGroupDepartmentKeys(subGroup).sort().join(',');
    const label = normalizeScheduleSearchText(subGroup.label);
    if (roleKeys) return `role:${roleKeys}`;
    if (departmentKeys) return `department:${departmentKeys}`;
    return label ? `label:${label}` : '';
}

function compareScheduleSubGroupCandidates(left = {}, right = {}) {
    const leftRoleCount = departmentSubGroupRoleKeys(left).length || Number.MAX_SAFE_INTEGER;
    const rightRoleCount = departmentSubGroupRoleKeys(right).length || Number.MAX_SAFE_INTEGER;
    if (leftRoleCount !== rightRoleCount) return leftRoleCount - rightRoleCount;
    const leftDepartmentCount = departmentSubGroupDepartmentKeys(left).length || Number.MAX_SAFE_INTEGER;
    const rightDepartmentCount = departmentSubGroupDepartmentKeys(right).length || Number.MAX_SAFE_INTEGER;
    if (leftDepartmentCount !== rightDepartmentCount) return leftDepartmentCount - rightDepartmentCount;
    return scheduleSubGroupIdentity(left).localeCompare(scheduleSubGroupIdentity(right), 'uk');
}

function scheduleSubGroupProfessionCandidates(staff = {}, activeDepartment = '') {
    const primary = normalizeProfessionKey(staff.role_type || staff.roleType);
    const secondary = staffSecondaryProfessions(staff);
    const normalizedDepartment = normalizeScheduleDisplayGroupKey(activeDepartment);
    if (!normalizedDepartment) return [primary, ...secondary].filter(Boolean);

    const candidates = [];
    if (primary && scheduleProfessionDisplayGroupKey(primary) === normalizedDepartment) candidates.push(primary);
    for (const professionKey of secondary) {
        if (scheduleProfessionDisplayGroupKey(professionKey) === normalizedDepartment) candidates.push(professionKey);
    }
    return candidates;
}

function scheduleProfessionKeyForDepartment(staff = {}, departmentKey = '') {
    const normalizedDepartment = normalizeScheduleDisplayGroupKey(departmentKey);
    const matchingProfessions = scheduleSubGroupProfessionCandidates(staff, normalizedDepartment);
    return matchingProfessions[0]
        || normalizeProfessionKey(staff.role_type || staff.roleType)
        || staffProfessionKeys(staff)[0]
        || '';
}

function resolveScheduleSubGroup(staff = {}, departmentKey = '', context = {}) {
    const subGroups = Array.isArray(context.subGroups)
        ? context.subGroups
        : (DEPT_SUB_GROUPS[normalizeScheduleDisplayGroupKey(departmentKey)] || []);
    if (!subGroups.length) return null;

    const requestedDepartment = String(context.activeDepartment ?? StaffState.activeDept ?? 'all').trim();
    const activeDepartment = requestedDepartment && requestedDepartment !== 'all'
        ? normalizeScheduleDisplayGroupKey(requestedDepartment)
        : '';
    const professionCandidates = scheduleSubGroupProfessionCandidates(staff, activeDepartment);

    for (const professionKey of professionCandidates) {
        const matchingGroups = subGroups
            .filter(subGroup => departmentSubGroupRoleKeys(subGroup).includes(professionKey))
            .sort(compareScheduleSubGroupCandidates);
        if (matchingGroups.length) return matchingGroups[0];
    }

    const rawDepartment = String(staff.department || '').trim();
    const departmentGroups = subGroups
        .filter(subGroup => departmentSubGroupDepartmentKeys(subGroup).includes(rawDepartment))
        .sort(compareScheduleSubGroupCandidates);
    return departmentGroups[0] || null;
}

function partitionScheduleStaffBySubGroup(departmentKey = '', deptStaff = [], subGroups = null, context = {}) {
    if (!shouldRenderDepartmentSubGroups(deptStaff, subGroups)) {
        return { groups: [], ungrouped: uniqueScheduleStaffById(deptStaff || []), ownershipByStaffId: new Map() };
    }

    const groupBuckets = new Map();
    const ownershipByStaffId = new Map();
    const ungrouped = [];
    for (const staff of uniqueScheduleStaffById(deptStaff || [])) {
        const staffId = normalizeScheduleStaffId(staff.id);
        const subGroup = resolveScheduleSubGroup(staff, departmentKey, { ...context, subGroups });
        if (!subGroup) {
            ungrouped.push(staff);
            continue;
        }
        const identity = scheduleSubGroupIdentity(subGroup);
        if (!identity) {
            ungrouped.push(staff);
            continue;
        }
        if (!groupBuckets.has(identity)) groupBuckets.set(identity, []);
        groupBuckets.get(identity).push(staff);
        ownershipByStaffId.set(staffId, subGroup);
    }

    const groups = (subGroups || [])
        .map(subGroup => ({ subGroup, staff: groupBuckets.get(scheduleSubGroupIdentity(subGroup)) || [] }))
        .filter(group => group.staff.length > 0);
    return { groups, ungrouped, ownershipByStaffId };
}

function normalizeScheduleSearchText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function scheduleVisibleDateKeys() {
    return getScheduleDates().map(formatDateStr);
}

function scheduleEntrySearchParts(entry = null) {
    if (!entry) return [];
    const status = normalizeScheduleStatus(entry.status);
    const professionKey = normalizeProfessionKey(entry.profession_key || entry.professionKey);
    const start = entry.shift_start ? String(entry.shift_start).slice(0, 5) : '';
    const end = entry.shift_end ? String(entry.shift_end).slice(0, 5) : '';
    const segmentParts = scheduleEntrySegmentsForUi(entry, professionKey).flatMap(segment => [
        segment.professionKey,
        professionLabel(segment.professionKey),
        ...segment.additionalProfessionKeys,
        ...segment.additionalProfessionKeys.map(professionLabel),
        segment.shiftStart,
        segment.shiftEnd,
        `${segment.shiftStart}-${segment.shiftEnd}`,
        segment.note
    ]);
    return [
        status,
        STAFF_SCHEDULE_STATUS_LABELS[status] || status,
        professionKey,
        professionKey ? professionLabel(professionKey) : '',
        start,
        end,
        start && end ? `${start}-${end}` : '',
        ...segmentParts
    ];
}

function scheduleStaffSearchHaystack(staff = {}) {
    const displayGroup = scheduleCanonicalDisplayGroupKey(staff);
    const membershipGroups = staffScheduleDepartmentKeys(staff);
    const secondaryKeys = staffSecondaryProfessions(staff);
    const rawSecondary = parseProfessionArray(staff.secondary_professions || staff.secondaryProfessions);
    const todayEntry = StaffState.schedule[`${staff.id}_${todayStr()}`];
    const todayStatus = normalizeScheduleStatus(todayEntry?.status || 'unset');
    const visibleEntryParts = scheduleVisibleDateKeys().flatMap(date => {
        const entry = StaffState.schedule[`${staff.id}_${date}`];
        return scheduleEntrySearchParts(entry);
    });

    return normalizeScheduleSearchText([
        staff.display_name,
        staff.displayName,
        staff.name,
        staff.position,
        staff.role_type,
        staff.roleType,
        staff.role_type ? professionLabel(staff.role_type) : '',
        ...rawSecondary,
        ...secondaryKeys,
        ...secondaryKeys.map(professionLabel),
        staff.department,
        staff.display_group,
        staff.displayGroup,
        displayGroup,
        scheduleDisplayDepartmentLabel(displayGroup),
        ...membershipGroups,
        ...membershipGroups.map(scheduleDisplayDepartmentLabel),
        todayStatus,
        STAFF_SCHEDULE_STATUS_LABELS[todayStatus] || todayStatus,
        ...scheduleEntrySearchParts(todayEntry),
        ...visibleEntryParts
    ].filter(Boolean).join(' '));
}

function scheduleStaffVisibleWithoutSearch(staffList = StaffState.staff) {
    const scheduleable = uniqueScheduleStaffById(scheduleableStaffForUi(staffList || []));
    if (StaffState.activeDept === 'all') return scheduleable;
    return uniqueScheduleStaffById(
        scheduleable.filter(staff => staffMatchesScheduleDepartment(staff, StaffState.activeDept))
    );
}

function scheduleVisibleStaff(staffList = StaffState.staff) {
    const visible = scheduleStaffVisibleWithoutSearch(staffList);
    const query = normalizeScheduleSearchText(StaffState.searchQuery);
    if (!query) return uniqueScheduleStaffById(visible);
    return uniqueScheduleStaffById(
        visible.filter(staff => scheduleStaffSearchHaystack(staff).includes(query))
    );
}

function scheduleFinalVisibleStaffSnapshot(staffList = StaffState.staff, dates = getScheduleDates()) {
    const base = uniqueScheduleStaffById(scheduleVisibleStaff(staffList));
    const health = buildScheduleHealth(dates, base, { department: StaffState.activeDept });
    const visible = uniqueScheduleStaffById(scheduleHealthFilteredStaff(base, health));
    return { base, health, visible };
}

function scheduleDepartmentOptions() {
    const labels = scheduleDepartmentLabels();
    const counts = scheduleDepartmentCountMap(StaffState.staff);
    const ordered = [];
    const seen = new Set();
    for (const key of scheduleDisplayGroupOrder()) {
        if (!labels[key] && !counts.has(key)) continue;
        ordered.push({ value: key, label: labels[key] || key, count: counts.get(key) || 0 });
        seen.add(key);
    }
    for (const key of counts.keys()) {
        if (seen.has(key)) continue;
        ordered.push({ value: key, label: labels[key] || key, count: counts.get(key) || 0 });
    }
    return ordered;
}

function scheduleStaffGroupingDepartmentKeys(staff = {}, options = {}) {
    const activeDepartment = normalizeScheduleDisplayGroupKey(options.department || options.activeDepartment || '');
    if (activeDepartment && activeDepartment !== 'all') {
        return staffMatchesScheduleDepartment(staff, activeDepartment) ? [activeDepartment] : [];
    }
    if (options.grouping === 'membership') return staffScheduleDepartmentKeys(staff);
    return [scheduleCanonicalDisplayGroupKey(staff)];
}

function groupStaffByScheduleDepartment(staffList = StaffState.staff, options = {}) {
    const grouped = {};
    const groupedIds = new Map();
    for (const staff of uniqueScheduleStaffById(staffList)) {
        const staffId = normalizeScheduleStaffId(staff.id);
        for (const key of scheduleStaffGroupingDepartmentKeys(staff, options)) {
            if (!grouped[key]) grouped[key] = [];
            if (!groupedIds.has(key)) groupedIds.set(key, new Set());
            if (groupedIds.get(key).has(staffId)) continue;
            groupedIds.get(key).add(staffId);
            grouped[key].push(staff);
        }
    }
    return grouped;
}

function scheduleDepartmentRenderOrder(grouped = {}) {
    const ordered = scheduleDisplayGroupOrder().filter(key => grouped[key]);
    const seen = new Set(ordered);
    for (const key of Object.keys(grouped)) {
        if (!seen.has(key)) ordered.push(key);
    }
    return ordered;
}

function scheduleGroupStateKey(value = '') {
    return normalizeScheduleDisplayGroupKey(value) || String(value || '').trim();
}

function scheduleExpandedGroupKeysFromStorage() {
    try {
        const raw = localStorage.getItem(STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        const seen = new Set();
        return parsed
            .map(scheduleGroupStateKey)
            .filter(key => key && !seen.has(key) && seen.add(key));
    } catch {
        return [];
    }
}

function hydrateScheduleExpandedGroups() {
    StaffState.expandedScheduleGroups = new Set(scheduleExpandedGroupKeysFromStorage());
}

function persistScheduleExpandedGroups() {
    try {
        const keys = Array.from(StaffState.expandedScheduleGroups instanceof Set ? StaffState.expandedScheduleGroups : [])
            .map(scheduleGroupStateKey)
            .filter(Boolean)
            .sort();
        if (keys.length) {
            localStorage.setItem(STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY, JSON.stringify(keys));
        } else {
            localStorage.removeItem(STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY);
        }
    } catch {}
}

function scheduleSearchAutoExpandsGroups() {
    return Boolean(normalizeScheduleSearchText(StaffState.searchQuery));
}

function isScheduleGroupExpanded(departmentKey = '') {
    const key = scheduleGroupStateKey(departmentKey);
    return Boolean(key && StaffState.expandedScheduleGroups instanceof Set && StaffState.expandedScheduleGroups.has(key));
}

function isScheduleGroupExpandedForRender(departmentKey = '') {
    return scheduleSearchAutoExpandsGroups() || isScheduleGroupExpanded(departmentKey);
}

function setScheduleGroupExpanded(departmentKey = '', expanded = true) {
    const key = scheduleGroupStateKey(departmentKey);
    if (!key) return false;
    if (!(StaffState.expandedScheduleGroups instanceof Set)) {
        StaffState.expandedScheduleGroups = new Set();
    }
    if (expanded) StaffState.expandedScheduleGroups.add(key);
    else StaffState.expandedScheduleGroups.delete(key);
    persistScheduleExpandedGroups();
    return true;
}

function toggleScheduleGroup(departmentKey = '') {
    const key = scheduleGroupStateKey(departmentKey);
    if (!key) return false;
    setScheduleGroupExpanded(key, !isScheduleGroupExpanded(key));
    renderSchedule();
    return true;
}

function scheduleCopyWeekModeForDepartment(department = StaffState.activeDept) {
    if (department === 'all') return 'all';
    if (SCHEDULE_COPY_RAW_DEPARTMENT_SAFE.has(department)) return 'raw_department';
    return 'explicit_staff_ids';
}

function scheduleCopyWeekVisibleStaffIds() {
    return uniqueScheduleStaffById(scheduleVisibleStaff())
        .map(staff => normalizeScheduleStaffId(staff.id))
        .filter(id => id !== null);
}

function scheduleCopyWeekPayload(fromMonday, toMonday, options = {}) {
    const department = StaffState.activeDept || 'all';
    const mode = scheduleCopyWeekModeForDepartment(department);
    const body = {
        fromMonday,
        toMonday,
        displayGroup: department,
        dryRun: Boolean(options.dryRun)
    };
    if (mode === 'raw_department') {
        body.department = department;
    } else if (mode === 'explicit_staff_ids') {
        body.staffIds = scheduleCopyWeekVisibleStaffIds();
        if (!body.staffIds.length) {
            return {
                error: 'Немає видимих працівників для копіювання цієї категорії.',
                body,
                mode
            };
        }
    }
    return { body, mode };
}

const STAFF_SCHEDULE_DAYS_UK = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const STAFF_SCHEDULE_MONTHS_UK = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
const STAFF_SCHEDULE_WINDOW_DAYS = 9;
const STAFF_SCHEDULE_TODAY_OFFSET_DAYS = 1;
const STAFF_SCHEDULE_MAX_RANGE_DAYS = 31;
// A 31-day month has a 16-day second half; keep both half-month presets fitted.
const STAFF_SCHEDULE_LONG_RANGE_DAYS = 16;
const STAFF_SCHEDULE_BULK_CONFIRM_ENTRY_THRESHOLD = 40;
const STAFF_SCHEDULE_LAYOUT = {
    schedule: {
        desktop: { minWidth: 900, stickyColumn: 240, dayColumn: 144 },
        mobile: { minWidth: 900, stickyColumn: 176, dayColumn: 128 },
        // A monthly view is an overview: keep every day visible on a standard
        // desktop workspace instead of making the user hunt through a long row.
        fullRange: {
            desktop: { minWidth: 900, stickyColumn: 220, dayColumn: 30 },
            mobile: { minWidth: 900, stickyColumn: 160, dayColumn: 42 }
        }
    },
    load: {
        desktop: { minWidth: 900, stickyColumn: 156, dayColumn: 82, trailingColumn: 92 },
        mobile: { minWidth: 900, stickyColumn: 130, dayColumn: 72, trailingColumn: 84 }
    }
};

function syncScheduleRangeLayout(wrapperId, dates = [], variant = 'schedule') {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;
    const table = wrapper.querySelector('.schedule-table');
    const dayCount = Array.isArray(dates) ? dates.length : 0;
    const layout = STAFF_SCHEDULE_LAYOUT[variant] || STAFF_SCHEDULE_LAYOUT.schedule;
    const fullRange = dayCount >= 28;
    const rangeLayout = fullRange && layout.fullRange ? layout.fullRange : layout;
    const compactViewport = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(max-width: 768px)').matches;
    const config = rangeLayout[compactViewport ? 'mobile' : 'desktop'] || rangeLayout.desktop || rangeLayout;
    const longRange = dayCount > STAFF_SCHEDULE_LONG_RANGE_DAYS;
    const tableMinWidth = Math.max(
        config.minWidth,
        config.stickyColumn + (dayCount * config.dayColumn) + (config.trailingColumn || 0)
    );

    wrapper.classList.toggle('is-long-range', longRange);
    wrapper.classList.toggle('is-full-range', fullRange);
    wrapper.dataset.scheduleDayCount = String(dayCount);
    wrapper.style.setProperty('--schedule-visible-days', String(dayCount));
    wrapper.style.setProperty('--schedule-sticky-column-width', `${config.stickyColumn}px`);
    wrapper.style.setProperty('--schedule-day-column-width', `${config.dayColumn}px`);
    wrapper.style.setProperty('--schedule-table-min-width', `${longRange ? tableMinWidth : config.minWidth}px`);
    if (config.trailingColumn) wrapper.style.setProperty('--schedule-trailing-column-width', `${config.trailingColumn}px`);
    else wrapper.style.removeProperty('--schedule-trailing-column-width');
    if (table) table.dataset.scheduleDayCount = String(dayCount);
}

function syncScheduleLayoutsForCurrentViewport() {
    const dates = getScheduleDates();
    syncScheduleRangeLayout('scheduleWrapper', dates, 'schedule');
    syncScheduleRangeLayout('loadViewWrapper', dates, 'load');
}

function bindScheduleLayoutViewportSync() {
    if (staffScheduleLayoutMediaQuery || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    staffScheduleLayoutMediaQuery = window.matchMedia('(max-width: 768px)');
    const handleViewportClassChange = () => syncScheduleLayoutsForCurrentViewport();
    if (typeof staffScheduleLayoutMediaQuery.addEventListener === 'function') {
        staffScheduleLayoutMediaQuery.addEventListener('change', handleViewportClassChange);
    } else if (typeof staffScheduleLayoutMediaQuery.addListener === 'function') {
        staffScheduleLayoutMediaQuery.addListener(handleViewportClassChange);
    }
}

// ==========================================
// HELPERS
// ==========================================

function showNotification(message, type = '') {
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3000);
}

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getScheduleFocusStart(d) {
    const date = new Date(d);
    date.setDate(date.getDate() - STAFF_SCHEDULE_TODAY_OFFSET_DAYS);
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatDateStr(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getWeekDates(startDate) {
    const dates = [];
    for (let i = 0; i < STAFF_SCHEDULE_WINDOW_DAYS; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function getScheduleRangeEnd(dates) {
    return dates[dates.length - 1];
}

function cloneScheduleDate(value) {
    const source = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(source.getTime())) return null;
    const date = new Date(source);
    date.setHours(0, 0, 0, 0);
    return date;
}

function parseScheduleDateInput(value) {
    if (value instanceof Date) return cloneScheduleDate(value);
    const raw = String(value || '').trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
        return date;
    }
    return cloneScheduleDate(raw);
}

function scheduleRangeDayCount(from, to) {
    const start = cloneScheduleDate(from);
    const end = cloneScheduleDate(to);
    if (!start || !end) return 0;
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function getScheduleWindowRange(startDate) {
    const start = cloneScheduleDate(startDate) || getScheduleFocusStart(new Date());
    const dates = getWeekDates(start);
    return { start: dates[0], end: getScheduleRangeEnd(dates) };
}

function scheduleCurrentRange() {
    const start = cloneScheduleDate(StaffState.rangeStart || StaffState.weekStart);
    const end = cloneScheduleDate(StaffState.rangeEnd);
    if (start && end && start <= end) return { start, end };
    return getScheduleWindowRange(start || getScheduleFocusStart(new Date()));
}

function scheduleRangeCandidate(startValue, endValue, mode = 'custom') {
    const start = cloneScheduleDate(startValue);
    const end = cloneScheduleDate(endValue);
    if (!start || !end || start > end) return null;
    return {
        start,
        end,
        from: formatDateStr(start),
        to: formatDateStr(end),
        mode: mode || 'custom'
    };
}

function schedulePendingRange() {
    const pending = StaffState.rangePending;
    return pending ? scheduleRangeCandidate(pending.start, pending.end, pending.mode) : null;
}

function scheduleNavigationRange() {
    return schedulePendingRange() || scheduleCurrentRange();
}

function scheduleNavigationMode() {
    return schedulePendingRange()?.mode || StaffState.rangeMode || 'rolling';
}

function scheduleCommittedRangeKey() {
    const start = cloneScheduleDate(StaffState.rangeStart);
    const end = cloneScheduleDate(StaffState.rangeEnd);
    if (!start || !end || start > end) return '';
    return `${formatDateStr(start)}:${formatDateStr(end)}`;
}

function scheduleLoadedRangeMatchesCurrent() {
    const key = scheduleCommittedRangeKey();
    if (!key || !StaffState.scheduleLoadedRange) return false;
    return key === `${StaffState.scheduleLoadedRange.from}:${StaffState.scheduleLoadedRange.to}`;
}

function scheduleHasCommittedRange() {
    return scheduleLoadedRangeMatchesCurrent();
}

function scheduleRangeDataReady() {
    return ['ready', 'empty'].includes(StaffState.rangeLoadState)
        && scheduleLoadedRangeMatchesCurrent();
}

function getScheduleDates(startValue = null, endValue = null) {
    const range = startValue && endValue
        ? { start: cloneScheduleDate(startValue), end: cloneScheduleDate(endValue) }
        : scheduleCurrentRange();
    const start = cloneScheduleDate(range.start);
    const end = cloneScheduleDate(range.end);
    if (!start || !end || start > end) {
        return getWeekDates(getScheduleFocusStart(new Date()));
    }
    const dates = [];
    for (const current = new Date(start); current <= end && dates.length < STAFF_SCHEDULE_MAX_RANGE_DAYS; current.setDate(current.getDate() + 1)) {
        dates.push(new Date(current));
    }
    return dates;
}

function validateScheduleRange(startValue, endValue) {
    const start = parseScheduleDateInput(startValue);
    const end = parseScheduleDateInput(endValue);
    if (!start || !end) {
        return { ok: false, error: 'Оберіть коректні дати періоду' };
    }
    if (start > end) {
        return { ok: false, error: 'Дата початку має бути не пізніше дати завершення' };
    }
    const days = scheduleRangeDayCount(start, end);
    if (days > STAFF_SCHEDULE_MAX_RANGE_DAYS) {
        return { ok: false, error: `Максимальний період графіка — ${STAFF_SCHEDULE_MAX_RANGE_DAYS} день` };
    }
    return { ok: true, start, end, days };
}

function setScheduleRangeState(startValue, endValue, mode = 'custom') {
    const start = cloneScheduleDate(startValue);
    const end = cloneScheduleDate(endValue);
    StaffState.rangeStart = start;
    StaffState.rangeEnd = end;
    StaffState.rangeMode = mode || 'custom';
    StaffState.weekStart = start;
}

function formatSchedulePresetDayRange(presetRange = {}) {
    if (!presetRange.start || !presetRange.end) return '';
    return `${presetRange.start.getDate()}-${presetRange.end.getDate()}`;
}

function syncScheduleRangePresetLabel(button) {
    const preset = button?.dataset?.scheduleRangePreset || '';
    if (!['first-half', 'second-half'].includes(preset)) return;
    const presetRange = schedulePresetRange(preset);
    const label = formatSchedulePresetDayRange(presetRange);
    if (!label) return;
    button.textContent = label;
    button.title = `Показати ${label} число місяця`;
    button.setAttribute('aria-label', `Показати ${label} число місяця`);
}

function syncScheduleRangeControls() {
    const fromInput = document.getElementById('scheduleDateFrom');
    const toInput = document.getElementById('scheduleDateTo');
    if (!fromInput && !toInput) return;
    const fallbackRange = schedulePendingRange()
        || (StaffState.rangeRetry ? scheduleRangeCandidate(StaffState.rangeRetry.start, StaffState.rangeRetry.end, StaffState.rangeRetry.mode) : null)
        || scheduleCurrentRange();
    const range = scheduleHasCommittedRange() ? scheduleCurrentRange() : fallbackRange;
    const activeMode = scheduleHasCommittedRange()
        ? StaffState.rangeMode
        : (schedulePendingRange()?.mode || StaffState.rangeRetry?.mode || '');
    if (fromInput) fromInput.value = formatDateStr(range.start);
    if (toInput) toInput.value = formatDateStr(range.end);
    document.querySelectorAll('[data-schedule-range-preset]').forEach(button => {
        const active = button.dataset.scheduleRangePreset === activeMode;
        syncScheduleRangePresetLabel(button);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function schedulePresetBaseDate() {
    return cloneScheduleDate(schedulePendingRange()?.start || StaffState.rangeStart || StaffState.weekStart) || new Date();
}

function scheduleMonthRange(baseDate = schedulePresetBaseDate()) {
    const base = cloneScheduleDate(baseDate) || new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return { start, end };
}

function schedulePresetRange(preset, baseDate = schedulePresetBaseDate()) {
    const month = scheduleMonthRange(baseDate);
    if (preset === 'first-half') {
        const end = new Date(month.start.getFullYear(), month.start.getMonth(), Math.min(15, month.end.getDate()));
        end.setHours(0, 0, 0, 0);
        return { start: month.start, end };
    }
    if (preset === 'second-half') {
        const start = new Date(month.start.getFullYear(), month.start.getMonth(), Math.min(16, month.end.getDate()));
        start.setHours(0, 0, 0, 0);
        return { start, end: month.end };
    }
    if (preset === 'month') return month;
    return null;
}

function scheduleNavigationStepDays() {
    const mode = scheduleNavigationMode();
    if (mode === 'rolling' || !mode) return 7;
    const range = scheduleNavigationRange();
    return Math.max(1, scheduleRangeDayCount(range.start, range.end));
}

function shiftSchedulePresetRange(direction) {
    const mode = scheduleNavigationMode();
    if (!['first-half', 'second-half', 'month'].includes(mode)) return null;
    const range = scheduleNavigationRange();
    const base = new Date(range.start.getFullYear(), range.start.getMonth() + direction, 1);
    base.setHours(0, 0, 0, 0);
    return schedulePresetRange(mode, base);
}

function shiftScheduleDate(dateValue, days) {
    const date = cloneScheduleDate(dateValue) || getScheduleFocusStart(new Date());
    date.setDate(date.getDate() + days);
    return date;
}

function formatScheduleRangeLabel(from, to) {
    if (!from || !to) return '-';
    const fromLabel = `${from.getDate()} ${STAFF_SCHEDULE_MONTHS_UK[from.getMonth()]}`;
    const toLabel = `${to.getDate()} ${STAFF_SCHEDULE_MONTHS_UK[to.getMonth()]} ${to.getFullYear()}`;
    if (from.getFullYear() !== to.getFullYear()) {
        return `${fromLabel} ${from.getFullYear()} — ${toLabel}`;
    }
    return `${fromLabel} — ${toLabel}`;
}

function scheduleCurrentRangeLabel() {
    const range = scheduleCurrentRange();
    return formatScheduleRangeLabel(range.start, range.end);
}

function syncScheduleRangeActionAvailability() {
    const ready = scheduleRangeDataReady();
    ['exportExcelBtn', 'printBtn'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        button.disabled = !ready;
        button.setAttribute('aria-disabled', ready ? 'false' : 'true');
    });

    ['fillWeekBtn', 'copyWeekBtn'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        button.disabled = !ready;
        button.setAttribute('aria-disabled', ready ? 'false' : 'true');
    });
}

function setScheduleRangeLoadState(state, options = {}) {
    const normalizedState = ['idle', 'loading', 'error', 'empty', 'ready'].includes(state) ? state : 'idle';
    StaffState.rangeLoadState = normalizedState;

    const hasCommittedRange = scheduleHasCommittedRange();
    const busy = normalizedState === 'loading';
    const locked = !scheduleRangeDataReady();
    const region = document.getElementById('scheduleDataRegion');
    if (region) {
        region.dataset.scheduleState = normalizedState;
        region.dataset.hasCommittedRange = hasCommittedRange ? 'true' : 'false';
        region.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    ['scheduleWrapper', 'loadViewWrapper'].forEach(id => {
        const wrapper = document.getElementById(id);
        if (!wrapper) return;
        wrapper.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (locked) {
            wrapper.setAttribute('inert', '');
            wrapper.setAttribute('aria-disabled', 'true');
        } else {
            wrapper.removeAttribute('inert');
            wrapper.removeAttribute('aria-disabled');
        }
    });

    const panel = document.getElementById('scheduleRangeState');
    const title = document.getElementById('scheduleRangeStateTitle');
    const message = document.getElementById('scheduleRangeStateMessage');
    const retryButton = document.getElementById('scheduleRangeRetryBtn');
    if (panel) {
        panel.dataset.state = normalizedState;
        panel.hidden = ['idle', 'ready'].includes(normalizedState);
        panel.setAttribute('role', normalizedState === 'error' ? 'alert' : 'status');
    }
    if (retryButton) retryButton.hidden = normalizedState !== 'error' || !StaffState.rangeRetry;

    const requestedRange = options.range || schedulePendingRange() || StaffState.rangeRetry;
    const requestedLabel = requestedRange?.start && requestedRange?.end
        ? formatScheduleRangeLabel(requestedRange.start, requestedRange.end)
        : '';
    if (normalizedState === 'loading') {
        if (title) title.textContent = 'Завантажуємо графік';
        if (message) message.textContent = requestedLabel ? `Період: ${requestedLabel}.` : 'Очікуємо дані вибраного періоду.';
    } else if (normalizedState === 'error') {
        const confirmedCopy = hasCommittedRange
            ? ` Показано підтверджений період ${scheduleCurrentRangeLabel()}.`
            : ' Дані графіка не показано.';
        const errorCopy = String(options.error || '').trim();
        if (title) title.textContent = 'Період не завантажено';
        if (message) message.textContent = `Не вдалося завантажити ${requestedLabel || 'вибраний період'}.${confirmedCopy}${errorCopy ? ` ${errorCopy}` : ''}`;
    } else if (normalizedState === 'empty') {
        if (title) title.textContent = 'За цей період змін ще немає';
        if (message) message.textContent = 'Графік успішно завантажено. Клітинки можна заповнювати.';
    } else {
        if (title) title.textContent = '';
        if (message) message.textContent = '';
    }

    syncScheduleRangeActionAvailability();
}

function restoreScheduleCommittedRangeUi() {
    if (scheduleHasCommittedRange()) {
        renderWeekLabel();
        return;
    }
    const label = document.getElementById('weekLabel');
    if (label) label.textContent = 'Період не підтверджено';
    syncScheduleRangeControls();
    syncScheduleBulkActionLabels();
    updateScheduleHeaderMetrics();
}

function retryScheduleRangeLoad() {
    const retry = StaffState.rangeRetry;
    if (!retry) return Promise.resolve(false);
    return goToScheduleRange(retry.start, retry.end, retry.mode);
}

function isScheduleCustomRangeMode() {
    return Boolean(StaffState.rangeMode && StaffState.rangeMode !== 'rolling');
}

function canCopyWeekInCurrentRange() {
    const range = scheduleCurrentRange();
    return !isScheduleCustomRangeMode()
        && scheduleRangeDayCount(range.start, range.end) === STAFF_SCHEDULE_WINDOW_DAYS;
}

function selectedWeekdayLabels(weekdayNumbers = []) {
    return weekdayNumbers
        .map(day => STAFF_SCHEDULE_DAYS_UK[Number(day)])
        .filter(Boolean)
        .join(', ');
}

function updateFillWeekModalCopy() {
    const rangeLabel = scheduleCurrentRangeLabel();
    const customRange = isScheduleCustomRangeMode();
    const title = customRange ? 'Заповнити період' : 'Заповнити тиждень';
    const hint = customRange
        ? `Буде заповнено тільки видимий період ${rangeLabel}. Дні тижня нижче працюють як фільтр усередині цього періоду.`
        : `Буде заповнено поточний видимий період ${rangeLabel}. Дні тижня нижче працюють як фільтр.`;
    const overlay = document.getElementById('fillWeekOverlay');
    const titleEl = document.getElementById('fillWeekTitle');
    const hintEl = document.getElementById('fillWeekPeriodHint');
    if (overlay) overlay.setAttribute('aria-label', title);
    if (titleEl) titleEl.textContent = title;
    if (hintEl) hintEl.textContent = hint;
}

function syncScheduleBulkActionLabels() {
    const rangeLabel = scheduleCurrentRangeLabel();
    const customRange = isScheduleCustomRangeMode();
    const fillBtn = document.getElementById('fillWeekBtn');
    if (fillBtn) {
        fillBtn.textContent = customRange ? 'Заповнити період' : 'Заповнити тиждень';
        fillBtn.title = customRange
            ? `Масове заповнення видимого періоду ${rangeLabel}`
            : `Масове заповнення поточного періоду ${rangeLabel}`;
    }

    const copyBtn = document.getElementById('copyWeekBtn');
    if (copyBtn) {
        const allowed = canCopyWeekInCurrentRange();
        copyBtn.textContent = 'Копія тижня';
        copyBtn.classList.toggle('is-disabled', !allowed);
        copyBtn.dataset.scheduleCopyUnavailable = allowed ? 'false' : 'true';
        copyBtn.setAttribute('aria-label', allowed ? 'Копія тижня' : `Копія тижня недоступна для періоду ${rangeLabel}. Натисніть, щоб побачити пояснення.`);
        copyBtn.title = allowed
            ? 'Копіює тільки канонічний 7-денний тиждень у наступний тиждень'
            : `Копія тижня вимкнена для довільного періоду ${rangeLabel}, щоб не копіювати 15-31 день випадково`;
    }
}

const STAFF_SCHEDULE_VIEW_MODES = new Set(['schedule', 'hours', 'load', 'accounts']);

function normalizeScheduleViewMode(mode) {
    return STAFF_SCHEDULE_VIEW_MODES.has(mode) ? mode : 'schedule';
}

function scheduleCurrentViewMode() {
    if (StaffState.showLoadView) return 'load';
    if (StaffState.showLinkView) return 'accounts';
    if (StaffState.showHours) return 'hours';
    return normalizeScheduleViewMode(StaffState.viewMode);
}

function syncScheduleViewSwitch() {
    const activeMode = scheduleCurrentViewMode();
    document.querySelectorAll('[data-schedule-view]').forEach(button => {
        const active = normalizeScheduleViewMode(button.dataset.scheduleView) === activeMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function removeLinkStatsBar() {
    document.getElementById('linkStatsBar')?.remove();
}

function resetSchedulePrimaryViewMode() {
    StaffState.viewMode = 'schedule';
    StaffState.showHours = false;
    StaffState.showLoadView = false;
    StaffState.showLinkView = false;
    StaffState.hoursData = null;
    removeLinkStatsBar();
    const loadWrapper = document.getElementById('loadViewWrapper');
    const scheduleWrapper = document.getElementById('scheduleWrapper');
    if (loadWrapper) loadWrapper.style.display = 'none';
    if (scheduleWrapper) scheduleWrapper.style.display = '';
    syncScheduleViewSwitch();
}

async function setScheduleViewMode(mode = 'schedule') {
    const nextMode = normalizeScheduleViewMode(mode);
    StaffState.viewMode = nextMode;
    StaffState.showHours = nextMode === 'hours';
    StaffState.showLoadView = nextMode === 'load';
    StaffState.showLinkView = nextMode === 'accounts';

    const loadWrapper = document.getElementById('loadViewWrapper');
    const scheduleWrapper = document.getElementById('scheduleWrapper');
    if (loadWrapper) loadWrapper.style.display = StaffState.showLoadView ? '' : 'none';
    if (scheduleWrapper) scheduleWrapper.style.display = StaffState.showLoadView ? 'none' : '';

    let rangeReloaded = false;
    if (StaffState.showHours && (scheduleHasCommittedRange() || schedulePendingRange())) {
        const target = scheduleNavigationRange();
        rangeReloaded = await goToScheduleRange(target.start, target.end, scheduleNavigationMode());
        if (!rangeReloaded) return;
    } else if (!StaffState.showHours) {
        StaffState.hoursData = null;
    }

    if (StaffState.showLinkView) {
        await fetchLinkStatus();
        renderLinkStatsBar();
    } else {
        removeLinkStatsBar();
    }

    if (!rangeReloaded) {
        syncScheduleViewSwitch();
        if (StaffState.showLoadView) {
            renderLoadView();
        } else {
            renderSchedule();
        }
    }
}

function bindScheduleViewSwitchControls() {
    const buttons = document.querySelectorAll('[data-schedule-view]');
    if (!buttons.length) {
        resetSchedulePrimaryViewMode();
        return;
    }
    buttons.forEach(button => {
        if (button.dataset.scheduleViewBound === 'true') return;
        button.addEventListener('click', () => setScheduleViewMode(button.dataset.scheduleView));
        button.dataset.scheduleViewBound = 'true';
    });
    syncScheduleViewSwitch();
}

function todayStr() {
    return formatDateStr(new Date());
}

function normalizeScheduleFocusStaffId(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function scheduleFocusStaffIdFromLocation() {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search || '');
    return normalizeScheduleFocusStaffId(
        params.get('scheduleStaff')
        || params.get('highlight')
        || params.get('staff')
    );
}

function scheduleStaffById(staffId) {
    const id = normalizeScheduleFocusStaffId(staffId);
    if (!id) return null;
    return StaffState.staff.find(staff => Number(staff.id) === id) || null;
}

function syncScheduleFocusDepartment(staffId) {
    const staff = scheduleStaffById(staffId);
    if (!staff) return false;
    const department = scheduleDisplayDepartmentKey(staff);
    if (department && StaffState.activeDept !== department) {
        StaffState.activeDept = department;
        renderDeptFilter();
    }
    if (department) setScheduleGroupExpanded(department, true);
    return true;
}

function focusScheduleStaffRow(staffId, options = {}) {
    const id = normalizeScheduleFocusStaffId(staffId);
    const tbody = document.getElementById('scheduleBody');
    if (!id || !tbody) return false;

    tbody.querySelectorAll('.is-schedule-focus').forEach(row => row.classList.remove('is-schedule-focus'));
    const row = tbody.querySelector(`[data-schedule-staff-row="${id}"]`);
    if (!row) return false;

    row.classList.add('is-schedule-focus');
    if (options.scroll === false) return true;

    const target = row.querySelector('[data-hr-profile]') || row;
    const reduceMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollToRow = () => {
        target.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: reduceMotion ? 'auto' : 'smooth'
        });
        target.focus?.({ preventScroll: true });
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(scrollToRow);
    } else {
        scrollToRow();
    }

    return true;
}

function focusScheduleStaff(staffId, options = {}) {
    const id = normalizeScheduleFocusStaffId(staffId);
    if (!id) return false;

    StaffState.focusedStaffId = id;
    if (options.scroll !== false) StaffState.focusScrollPending = true;
    if (options.syncDepartment !== false) syncScheduleFocusDepartment(id);

    if (options.render !== false && document.getElementById('scheduleBody')) {
        renderSchedule();
    } else if (options.scroll !== false) {
        const applied = focusScheduleStaffRow(id);
        if (applied) StaffState.focusScrollPending = false;
    }

    return true;
}

// ==========================================
// API CALLS
// ==========================================

async function fetchHrProfessions() {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/hr/professions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return { success: false };
        const data = await res.json();
        if (data.success) {
            StaffState.professions = Array.isArray(data.data) ? data.data : [];
        }
        return data;
    } catch (err) {
        console.error('fetchHrProfessions error:', err);
        StaffState.professions = [];
        return { success: false };
    }
}

async function fetchStaff() {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/staff?active=true', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            StaffState.displayGroups = normalizeScheduleDisplayGroups(data.displayGroups || data.display_groups || StaffState.displayGroups);
            StaffState.staff = scheduleableStaffForUi(data.data || []);
            StaffState.departments = data.departments;
        }
        return data;
    } catch (err) {
        console.error('fetchStaff error:', err);
        showNotification('Помилка завантаження персоналу', 'error');
        return { success: false };
    }
}

function isScheduleAbortError(error) {
    return error?.name === 'AbortError';
}

async function parseScheduleReadResponse(response, fallbackError) {
    let data;
    try {
        data = await response.json();
    } catch {
        return {
            success: false,
            status: response.status,
            error: `${fallbackError}: сервер повернув некоректні дані`
        };
    }
    if (!response.ok || data?.success !== true) {
        return {
            success: false,
            status: response.status,
            error: data?.error || `${fallbackError} (HTTP ${response.status})`
        };
    }
    return { success: true, status: response.status, data };
}

async function fetchSchedule(from, to, options = {}) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: options.signal
        });
        const parsed = await parseScheduleReadResponse(res, 'Не вдалося завантажити графік');
        if (!parsed.success) return parsed;

        const schedule = {};
        const scheduleRawEntries = [];
        for (const entry of (parsed.data.data || [])) {
            const normalizedEntry = { ...entry, status: normalizeScheduleStatus(entry.status) };
            scheduleRawEntries.push(normalizedEntry);
            schedule[`${normalizedEntry.staff_id}_${normalizedEntry.date}`] = normalizedEntry;
        }
        return {
            success: true,
            schedule,
            scheduleRawEntries,
            displayGroups: normalizeScheduleDisplayGroups(
                parsed.data.displayGroups || parsed.data.display_groups || StaffState.displayGroups
            )
        };
    } catch (err) {
        if (isScheduleAbortError(err)) return { success: false, aborted: true };
        console.error('fetchSchedule error:', err);
        return { success: false, error: 'Мережева помилка під час завантаження графіка' };
    }
}

async function fetchScheduleAttendance(from, to, options = {}) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: options.signal
        });
        if (res.status === 403) {
            return {
                success: true,
                attendance: {},
                attendanceSummary: null,
                unavailable: true
            };
        }
        const parsed = await parseScheduleReadResponse(res, 'Не вдалося завантажити attendance');
        if (!parsed.success) return parsed;

        const attendance = {};
        for (const row of (parsed.data.data || [])) {
            const date = String(row.date || '').slice(0, 10);
            if (!row.staff_id || !date) continue;
            attendance[`${row.staff_id}_${date}`] = { ...row, date };
        }
        return {
            success: true,
            attendance,
            attendanceSummary: parsed.data.summary || null,
            unavailable: false
        };
    } catch (err) {
        if (isScheduleAbortError(err)) return { success: false, aborted: true };
        console.error('fetchScheduleAttendance error:', err);
        return { success: false, error: 'Мережева помилка під час завантаження attendance' };
    }
}

function staffingForecastDateKeys(from, to) {
    const fallback = getScheduleDates().map(formatDateStr);
    if (!from || !to) return fallback;
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return fallback;
    const dates = [];
    for (const current = new Date(start); current <= end && dates.length <= 31; current.setDate(current.getDate() + 1)) {
        dates.push(formatDateStr(current));
    }
    return dates.length ? dates : fallback;
}

async function fetchStaffingForecastBookings(from, to) {
    const dates = staffingForecastDateKeys(from, to);
    const nextBookings = {};
    let successCount = 0;
    const token = localStorage.getItem('pzp_token');
    await Promise.all(dates.map(async (date) => {
        try {
            const res = await fetch(`/api/bookings/${encodeURIComponent(date)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error(`Bookings ${date} ${res.status}`);
            const data = await res.json();
            const rows = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
            nextBookings[date] = rows;
            successCount += 1;
        } catch (err) {
            console.warn('fetchStaffingForecastBookings error:', date, err);
            nextBookings[date] = [];
        }
    }));
    StaffState.staffingForecastBookings = nextBookings;
    StaffState.staffingForecastAvailable = successCount > 0;
    return { success: successCount > 0, dates, successCount };
}

async function postAttendanceAction(action, staffId) {
    const token = localStorage.getItem('pzp_token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (action === 'clock-in') {
        const res = await fetch('/api/hr/clock-in', {
            method: 'POST',
            headers,
            body: JSON.stringify({ staff_id: staffId })
        });
        return await res.json();
    }
    if (action === 'clock-out') {
        const res = await fetch('/api/hr/clock-out', {
            method: 'POST',
            headers,
            body: JSON.stringify({ staff_id: staffId })
        });
        return await res.json();
    }
    if (action === 'excused') {
        const res = await fetch('/api/hr/mark-absent', {
            method: 'POST',
            headers,
            body: JSON.stringify({ staff_id: staffId, status: 'day_off', notes: 'Excused from schedule attendance panel' })
        });
        return await res.json();
    }
    return { success: false, error: 'Unknown attendance action' };
}

async function saveScheduleEntry(staffId, date, shiftStart, shiftEnd, status, note, professionKey = null, dayPlan = null) {
    const token = localStorage.getItem('pzp_token');
    const payload = { staffId, date, shiftStart, shiftEnd, status, note, professionKey };
    if (dayPlan) {
        payload.segments = dayPlan.segments;
        payload.primaryProfessionKey = dayPlan.primaryProfessionKey;
        if (dayPlan.expectedUpdatedAt) payload.expectedUpdatedAt = dayPlan.expectedUpdatedAt;
    }
    const res = await fetch('/api/staff/schedule', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return await res.json();
}

async function fetchScheduleHistory(staffId, date, options = {}) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/schedule/history/${encodeURIComponent(staffId)}/${encodeURIComponent(date)}?limit=50`, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: options.signal
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) return { success: false, data: [], error: data?.error || `HTTP ${res.status}` };
        return { success: true, data: Array.isArray(data.data) ? data.data : [] };
    } catch (err) {
        if (isScheduleAbortError(err)) return { success: false, data: [], aborted: true };
        console.error('fetchScheduleHistory error:', err);
        return { success: false, data: [], error: err?.message || 'Network error' };
    }
}

async function replaceScheduleEntry(scheduleId, replacementStaffId, reason) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(`/api/staff/schedule/${scheduleId}/replace`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            replacement_staff_id: replacementStaffId,
            reason: reason || null
        })
    });
    return await res.json();
}

async function clearScheduleReplacement(scheduleId) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(`/api/staff/schedule/${scheduleId}/replacement-clear`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    return await res.json();
}

async function bulkSaveSchedule(entries) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch('/api/staff/schedule/bulk', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries })
    });
    return await res.json();
}

async function copyWeekSchedule(fromMonday, toMonday, options = {}) {
    const token = localStorage.getItem('pzp_token');
    const payload = scheduleCopyWeekPayload(fromMonday, toMonday, options);
    if (payload.error) return { success: false, error: payload.error, copyMode: payload.mode };
    const res = await fetch('/api/staff/schedule/copy-week', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.body)
    });
    return await res.json();
}

async function fetchScheduleHours(from, to, options = {}) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/schedule/hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: options.signal
        });
        const parsed = await parseScheduleReadResponse(res, 'Не вдалося завантажити години');
        if (!parsed.success) return parsed;
        return { success: true, data: parsed.data.data || null };
    } catch (err) {
        if (isScheduleAbortError(err)) return { success: false, aborted: true };
        console.error('fetchScheduleHours error:', err);
        return { success: false, error: 'Мережева помилка під час завантаження годин' };
    }
}

function scheduleAttendanceRecord(staffId, date) {
    return StaffState.attendance?.[`${staffId}_${date}`] || null;
}

function scheduleAttendanceIsWork(entry = {}) {
    return ['working', 'remote'].includes(normalizeScheduleStatus(entry?.status));
}

function scheduleAttendanceIsExcusedStatus(status) {
    return ['sick', 'vacation', 'day_off', 'dayoff', 'excused'].includes(normalizeScheduleStatus(status));
}

function scheduleAttendanceFormatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 5);
    return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
}

function scheduleAttendancePlannedTimes(entry = {}, record = {}) {
    return {
        start: entry?.shift_start || record?.planned_start || null,
        end: entry?.shift_end || record?.planned_end || null,
        role: entry?.profession_key || null
    };
}

function scheduleAttendanceIsPastDue(date, plannedStart) {
    const today = todayStr();
    if (date < today) return true;
    if (date > today) return false;
    const startMinutes = scheduleTimeToMinutes(plannedStart);
    if (startMinutes === null) return false;
    const now = new Date();
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    return nowMinutes > startMinutes + SCHEDULE_ATTENDANCE_LATE_GRACE_MINUTES;
}

function scheduleAttendanceStatus(entry = null, record = null, date = '') {
    const planned = scheduleAttendancePlannedTimes(entry, record);
    const scheduleStatus = normalizeScheduleStatus(entry?.status);
    const rawStatus = normalizeScheduleStatus(record?.time_status || record?.status || '');
    const clockIn = record?.clock_in || record?.checkin_at;
    const clockOut = record?.clock_out || record?.checkout_at;
    const lateMinutes = Number(record?.late_minutes || 0);
    const earlyLeaveMinutes = Number(record?.early_leave_minutes || 0);
    const isWork = scheduleAttendanceIsWork(entry) || Boolean(clockIn || clockOut);

    if (!entry && !record) return '';
    if (scheduleAttendanceIsExcusedStatus(rawStatus) || scheduleAttendanceIsExcusedStatus(scheduleStatus)) return 'excused';
    if (['absent', 'no_show'].includes(rawStatus)) return 'absent';
    if (earlyLeaveMinutes > 0 || rawStatus === 'early_leave') return 'left_early';
    if (clockIn && clockOut) {
        if (lateMinutes > SCHEDULE_ATTENDANCE_LATE_GRACE_MINUTES || rawStatus === 'late') return 'late';
        return 'completed';
    }
    if (clockIn) {
        if (lateMinutes > SCHEDULE_ATTENDANCE_LATE_GRACE_MINUTES || rawStatus === 'late') return 'late';
        return 'checked_in';
    }
    if (record && !clockIn && !scheduleAttendanceIsExcusedStatus(rawStatus)) return 'manual_review';
    if (isWork && scheduleAttendanceIsPastDue(date, planned.start)) return 'absent';
    if (isWork) return 'planned';
    return '';
}

function scheduleAttendanceDetails(entry = null, record = null, date = '') {
    const planned = scheduleAttendancePlannedTimes(entry, record);
    const status = scheduleAttendanceStatus(entry, record, date);
    const actualArrival = record?.clock_in || record?.checkin_at || null;
    const actualLeave = record?.clock_out || record?.checkout_at || null;
    const segmentAllocations = Array.isArray(record?.segmentAllocations)
        ? record.segmentAllocations
        : (Array.isArray(record?.segment_allocations) ? record.segment_allocations : []);
    const allocationIssues = Array.isArray(record?.allocationIssues)
        ? record.allocationIssues
        : (Array.isArray(record?.allocation_issues) ? record.allocation_issues : []);
    return {
        status,
        label: SCHEDULE_ATTENDANCE_LABELS[status] || status,
        plannedStart: planned.start,
        plannedEnd: planned.end,
        plannedRole: planned.role,
        actualArrival,
        actualLeave,
        lateMinutes: Number(record?.late_minutes || 0),
        earlyLeaveMinutes: Number(record?.early_leave_minutes || 0),
        totalWorkedMinutes: Number(record?.total_worked_minutes || 0),
        plannedMinutes: Number(record?.plannedMinutes ?? record?.planned_minutes ?? entry?.planned_minutes ?? 0),
        actualMinutes: Number(record?.actualMinutes ?? record?.actual_minutes ?? record?.total_worked_minutes ?? 0),
        overtimeMinutes: Number(record?.overtimeMinutes ?? record?.overtime_minutes ?? 0),
        unallocatedGapMinutes: Number(record?.unallocatedGapMinutes ?? record?.unallocated_gap_minutes ?? 0),
        segmentAllocations,
        allocationSource: record?.allocationSource || record?.allocation_source || 'none',
        allocationIssues,
        source: record?.attendance_source || (record ? 'attendance_record' : 'schedule_plan'),
        timeRecordId: record?.time_record_id || null
    };
}

function scheduleAttendanceActionButtons(staffId, date, details = {}) {
    if (!StaffState.canManage || date !== todayStr()) return '';
    if (!SCHEDULE_ATTENDANCE_STATUSES.has(details.status)) return '';
    const buttons = [];
    if (['planned', 'absent', 'manual_review'].includes(details.status)) {
        buttons.push(`<button type="button" class="attendance-action-btn" data-attendance-action="clock-in" data-staff="${staffId}" title="Підтвердити прихід">IN</button>`);
        buttons.push(`<button type="button" class="attendance-action-btn" data-attendance-action="excused" data-staff="${staffId}" title="Позначити поважну причину">EX</button>`);
    }
    if (['checked_in', 'late'].includes(details.status)) {
        buttons.push(`<button type="button" class="attendance-action-btn" data-attendance-action="clock-out" data-staff="${staffId}" title="Підтвердити вихід">OUT</button>`);
    }
    return buttons.length ? `<span class="attendance-actions">${buttons.join('')}</span>` : '';
}

function renderScheduleAttendanceIndicator(staffId, date, entry = null) {
    const record = scheduleAttendanceRecord(staffId, date);
    const details = scheduleAttendanceDetails(entry, record, date);
    if (!details.status) return '';
    const actualArrival = details.actualArrival ? scheduleAttendanceFormatTime(details.actualArrival) : '';
    const actualLeave = details.actualLeave ? scheduleAttendanceFormatTime(details.actualLeave) : '';
    const actual = actualArrival && actualLeave
        ? `${actualArrival}→${actualLeave}`
        : [
            actualArrival ? `in ${actualArrival}` : '',
            actualLeave ? `out ${actualLeave}` : ''
        ].filter(Boolean).join(' · ');
    const planned = [
        details.plannedStart ? String(details.plannedStart).slice(0, 5) : '',
        details.plannedEnd ? String(details.plannedEnd).slice(0, 5) : ''
    ].filter(Boolean).join('-');
    const paidSummary = details.actualMinutes > 0 ? `${formatScheduleMinutes(details.actualMinutes)} факт` : '';
    const warningMarker = details.allocationIssues.length ? '⚠' : '';
    const meta = [actual || (planned ? `plan ${planned}` : details.source), paidSummary, warningMarker]
        .filter(Boolean)
        .join(' · ');
    const segmentAllocationSummary = details.segmentAllocations.map(allocation => {
        const role = professionLabel(allocation.professionKey || allocation.profession_key);
        const start = String(allocation.shiftStart || allocation.shift_start || '').slice(0, 5);
        const end = String(allocation.shiftEnd || allocation.shift_end || '').slice(0, 5);
        const minutes = Number(allocation.actualMinutes ?? allocation.actual_minutes ?? 0);
        return `${start}-${end} ${role}: ${formatScheduleMinutes(minutes)}`;
    });
    const title = [
        `Attendance: ${details.label}`,
        planned ? `planned ${planned}` : '',
        actual ? `actual ${actual}` : '',
        details.plannedMinutes ? `planned paid ${formatScheduleMinutes(details.plannedMinutes)}` : '',
        details.actualMinutes ? `actual paid ${formatScheduleMinutes(details.actualMinutes)}` : '',
        ...segmentAllocationSummary,
        details.unallocatedGapMinutes ? `gap excluded ${formatScheduleMinutes(details.unallocatedGapMinutes)}` : '',
        details.overtimeMinutes ? `overtime ${formatScheduleMinutes(details.overtimeMinutes)}` : '',
        details.lateMinutes ? `late ${details.lateMinutes}m` : '',
        details.earlyLeaveMinutes ? `early ${details.earlyLeaveMinutes}m` : '',
        ...details.allocationIssues.map(issue => issue?.message || issue?.code || String(issue)),
        `allocation ${details.allocationSource}`,
        `source ${details.source}`
    ].filter(Boolean).join(' | ');
    return `<span class="sch-attendance is-${details.status}" title="${escapeHtml(title)}">
        <span class="sch-attendance-status">${escapeHtml(details.label)}</span>
        ${meta ? `<span class="sch-attendance-meta">${escapeHtml(meta)}</span>` : ''}
        ${scheduleAttendanceActionButtons(staffId, date, details)}
    </span>`;
}

function buildScheduleAttendanceSummary(dates = [], staffList = []) {
    return dates.map(dateObj => {
        const date = formatDateStr(dateObj);
        const counts = { planned: 0, checked_in: 0, late: 0, absent: 0, left_early: 0, completed: 0, manual_review: 0, excused: 0 };
        let plannedWork = 0;
        for (const staff of staffList) {
            const entry = StaffState.schedule[`${staff.id}_${date}`];
            const record = scheduleAttendanceRecord(staff.id, date);
            if (scheduleAttendanceIsWork(entry)) plannedWork++;
            const status = scheduleAttendanceStatus(entry, record, date);
            if (counts[status] !== undefined) counts[status]++;
        }
        return { date, plannedWork, counts };
    });
}

function renderScheduleAttendanceSummary(dates = [], staffList = []) {
    const container = document.getElementById('scheduleAttendanceSummary');
    if (!container) return;
    container.innerHTML = '';
    container.hidden = true;
}

async function handleAttendanceAction(button) {
    const action = button?.dataset?.attendanceAction;
    const staffId = Number(button?.dataset?.staff);
    if (!action || !Number.isFinite(staffId)) return;
    if (!scheduleRangeDataReady()) {
        showNotification('Спочатку дочекайтеся підтвердженого періоду графіка', 'error');
        return;
    }
    const staff = StaffState.staff.find(item => Number(item.id) === staffId);
    if (action === 'clock-in' && staff && !isScheduleableStaffForUi(staff, todayStr())) {
        showNotification(scheduleableStaffErrorMessage({ code: 'STAFF_NOT_SCHEDULEABLE' }, 'Працівник недоступний для check-in'), 'error');
        return;
    }
    button.disabled = true;
    const result = await postAttendanceAction(action, staffId);
    if (result.success) {
        const range = scheduleCurrentRange();
        const mode = StaffState.rangeMode || 'custom';
        const reloaded = await goToScheduleRange(range.start, range.end, mode);
        if (reloaded) {
            showNotification('Attendance оновлено');
        } else {
            showNotification('Attendance оновлено, але період не вдалося перезавантажити', 'error');
        }
    } else {
        button.disabled = false;
        showNotification(scheduleableStaffErrorMessage(result, 'Не вдалося оновити attendance'), 'error');
    }
}

// ==========================================
// RENDERING
// ==========================================

function renderDeptFilter() {
    const container = document.getElementById('deptFilter');
    const options = scheduleDepartmentOptions();
    if (StaffState.activeDept !== 'all' && !options.some(option => option.value === StaffState.activeDept)) {
        StaffState.activeDept = 'all';
    }
    const renderChip = ({ value, label, count }) => {
        const active = StaffState.activeDept === value;
        const accessibleLabel = `${label}: ${Number(count || 0)}`;
        return `<button type="button" class="dept-chip ${active ? 'active' : ''}" data-dept="${escapeHtml(value)}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(label)}">
            <span class="dept-chip-label">${escapeHtml(label)}</span>
            <strong class="dept-chip-count">${Number(count || 0)}</strong>
        </button>`;
    };
    const allCount = uniqueScheduleStaffById(scheduleableStaffForUi(StaffState.staff)).length;
    let html = renderChip({ value: 'all', label: 'Всі', count: allCount });
    for (const { value: key, label, count } of options) {
        html += renderChip({ value: key, label, count });
    }
    container.innerHTML = html;

    if (container.dataset.scheduleDeptFilterBound !== 'true') {
        container.addEventListener('click', event => {
            const chip = event.target.closest('.dept-chip[data-dept]');
            if (!chip || !container.contains(chip)) return;
            StaffState.activeDept = chip.dataset.dept;
            container.querySelectorAll('.dept-chip').forEach(c => c.classList.remove('active'));
            container.querySelectorAll('.dept-chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
            chip.classList.add('active');
            chip.setAttribute('aria-pressed', 'true');
            renderSchedule();
            if (StaffState.showLoadView) renderLoadView();
        });
        container.dataset.scheduleDeptFilterBound = 'true';
    }
    bindScheduleDepartmentFilterScrollCue(container);
    requestAnimationFrame(() => {
        keepScheduleDepartmentChipVisible(
            container,
            container.querySelector('.dept-chip[aria-pressed="true"]')
        );
        syncScheduleDepartmentFilterScrollCue(container);
    });
    updateScheduleHeaderMetrics();
}

function keepScheduleDepartmentChipVisible(container, chip) {
    if (!container || !chip) return;
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    if (maxScrollLeft <= 2) return;
    const containerBox = container.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    const edgeInset = 24;
    let delta = 0;
    if (chipBox.left < containerBox.left + edgeInset) {
        delta = chipBox.left - containerBox.left - edgeInset;
    } else if (chipBox.right > containerBox.right - edgeInset) {
        delta = chipBox.right - containerBox.right + edgeInset;
    }
    if (Math.abs(delta) <= 1) return;
    container.scrollLeft = Math.max(0, Math.min(maxScrollLeft, container.scrollLeft + delta));
}

function syncScheduleDepartmentFilterScrollCue(container = document.getElementById('deptFilter')) {
    if (!container) return;
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    container.dataset.canScrollLeft = container.scrollLeft > 2 ? 'true' : 'false';
    container.dataset.canScrollRight = container.scrollLeft < maxScrollLeft - 2 ? 'true' : 'false';
}

function bindScheduleDepartmentFilterScrollCue(container = document.getElementById('deptFilter')) {
    if (!container || container.dataset.scheduleScrollCueBound === 'true') return;
    const sync = () => syncScheduleDepartmentFilterScrollCue(container);
    container.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    container.dataset.scheduleScrollCueBound = 'true';
}

function renderScheduleStaffFilterInfo(filteredStaff = null) {
    const info = document.getElementById('scheduleStaffFilterInfo');
    if (!info) return;
    const base = scheduleStaffVisibleWithoutSearch();
    const visible = Array.isArray(filteredStaff) ? filteredStaff : scheduleVisibleStaff();
    const query = normalizeScheduleSearchText(StaffState.searchQuery);
    info.textContent = query
        ? `Показано ${visible.length} з ${base.length}`
        : `${base.length} співробітників у графіку`;
}

function bindScheduleStaffSearchControls() {
    const search = document.getElementById('scheduleStaffSearch');
    if (!search) return;
    const stateValue = StaffState.searchQuery || '';
    if (search.value !== stateValue) search.value = stateValue;
    if (search.dataset.scheduleSearchBound === 'true') return;
    search.addEventListener('input', () => {
        StaffState.searchQuery = search.value;
        renderSchedule();
        if (StaffState.showLoadView) renderLoadView();
    });
    search.dataset.scheduleSearchBound = 'true';
}

async function applyScheduleRangeFromInputs() {
    const fromInput = document.getElementById('scheduleDateFrom');
    const toInput = document.getElementById('scheduleDateTo');
    const validation = validateScheduleRange(fromInput?.value, toInput?.value);
    if (!validation.ok) {
        showNotification(validation.error, 'error');
        syncScheduleRangeControls();
        return false;
    }
    return goToScheduleRange(validation.start, validation.end, 'custom');
}

async function applyScheduleRangePreset(preset) {
    const range = schedulePresetRange(preset);
    if (!range) return false;
    return goToScheduleRange(range.start, range.end, preset);
}

function bindScheduleRangeControls() {
    const applyBtn = document.getElementById('applyScheduleRangeBtn');
    const fromInput = document.getElementById('scheduleDateFrom');
    const toInput = document.getElementById('scheduleDateTo');

    syncScheduleRangeControls();
    if (applyBtn && applyBtn.dataset.scheduleRangeBound !== 'true') {
        applyBtn.addEventListener('click', applyScheduleRangeFromInputs);
        applyBtn.dataset.scheduleRangeBound = 'true';
    }
    [fromInput, toInput].forEach(input => {
        if (!input || input.dataset.scheduleRangeBound === 'true') return;
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyScheduleRangeFromInputs();
            }
        });
        input.dataset.scheduleRangeBound = 'true';
    });
    document.querySelectorAll('[data-schedule-range-preset]').forEach(button => {
        if (button.dataset.scheduleRangeBound === 'true') return;
        button.addEventListener('click', () => applyScheduleRangePreset(button.dataset.scheduleRangePreset));
        button.dataset.scheduleRangeBound = 'true';
    });
}

function renderWeekLabel() {
    const dates = getScheduleDates();
    const from = dates[0];
    const to = getScheduleRangeEnd(dates);
    const label = formatScheduleRangeLabel(from, to);
    const weekLabel = document.getElementById('weekLabel');
    if (weekLabel) weekLabel.textContent = label;
    syncScheduleRangeControls();
    syncScheduleBulkActionLabels();
    updateScheduleHeaderMetrics();
}

function setScheduleHeaderMetricText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value === null || value === undefined || value === '' ? '-' : String(value);
}

function formatScheduleActiveLabel(active) {
    const count = Number(active || 0);
    if (count === 1) return '1 активний';
    return `${count} активні`;
}

function scheduleHeaderMetricsFromState(summary = null, staffList = null) {
    const period = document.getElementById('weekLabel')?.textContent?.trim() || '-';
    const department = StaffState.activeDept === 'all'
        ? 'Всі'
        : scheduleDisplayDepartmentLabel(StaffState.activeDept);
    const visibleStaff = Array.isArray(staffList) ? staffList : scheduleVisibleStaff();
    const safeVisibleStaff = Array.isArray(visibleStaff) ? visibleStaff : [];
    const activeSummary = summary || summarizeScheduleToday(safeVisibleStaff);
    const active = Number(activeSummary?.working || 0) + Number(activeSummary?.remote || 0);

    return {
        period,
        department,
        visibleStaffCount: safeVisibleStaff.length,
        activeTodayLabel: formatScheduleActiveLabel(active)
    };
}

function updateScheduleHeaderMetrics(summary = null, staffList = null) {
    // Staff header chips come from local schedule state: week label, active department, visible rows, and today's active shifts.
    const metrics = scheduleHeaderMetricsFromState(summary, staffList);

    setScheduleHeaderMetricText('scheduleHeaderPeriod', metrics.period);
    setScheduleHeaderMetricText('scheduleHeaderDepartment', metrics.department);
    setScheduleHeaderMetricText('scheduleHeaderStaffCount', metrics.visibleStaffCount);
    setScheduleHeaderMetricText('scheduleHeaderStatus', metrics.activeTodayLabel);
}

function summarizeScheduleToday(staffList = null) {
    const today = todayStr();
    const filtered = Array.isArray(staffList) ? staffList : scheduleVisibleStaff();
    const safeFiltered = Array.isArray(filtered) ? filtered : [];
    const summary = { date: today, total: safeFiltered.length, working: 0, dayoff: 0, vacation: 0, sick: 0, remote: 0, unset: 0, replacements: 0 };
    for (const s of safeFiltered) {
        const entry = StaffState.schedule[`${s.id}_${today}`];
        if (!entry) {
            summary.unset++;
        } else {
            if (isReplacementEntry(entry)) summary.replacements++;
            if (entry.status === 'working') summary.working++;
            else if (entry.status === 'dayoff') summary.dayoff++;
            else if (entry.status === 'vacation') summary.vacation++;
            else if (entry.status === 'sick') summary.sick++;
            else if (entry.status === 'remote') summary.remote++;
        }
    }
    return summary;
}

function summarizeScheduleRange(staffList = null, dates = getScheduleDates()) {
    const filtered = Array.isArray(staffList) ? staffList : scheduleVisibleStaff();
    const safeDates = Array.isArray(dates) && dates.length ? dates : getScheduleDates();
    const summary = {
        days: safeDates.length,
        total: filtered.length,
        cells: filtered.length * safeDates.length,
        working: 0,
        dayoff: 0,
        vacation: 0,
        sick: 0,
        remote: 0,
        unset: 0,
        replacements: 0
    };
    for (const s of filtered) {
        for (const d of safeDates) {
            const ds = typeof d === 'string' ? d : formatDateStr(d);
            const entry = StaffState.schedule[`${s.id}_${ds}`];
            if (!entry) {
                summary.unset++;
                continue;
            }
            const status = normalizeScheduleStatus(entry.status);
            if (isReplacementEntry(entry)) summary.replacements++;
            if (status === 'working') summary.working++;
            else if (status === 'dayoff') summary.dayoff++;
            else if (status === 'vacation') summary.vacation++;
            else if (status === 'sick') summary.sick++;
            else if (status === 'remote') summary.remote++;
            else summary.unset++;
        }
    }
    return summary;
}

function renderSummary(staffList = null, dates = getScheduleDates()) {
    const container = document.getElementById('scheduleSummary');
    const filtered = Array.isArray(staffList) ? staffList : scheduleVisibleStaff();
    if (container) {
        container.innerHTML = '';
        container.hidden = true;
    }
    updateScheduleHeaderMetrics(summarizeScheduleToday(filtered), filtered);
}

function renderEmpRow(emp, dates, today, health = null, options = {}) {
    const employeeName = scheduleStaffDisplayName(emp);
    const initials = employeeName.split(' ').map(w => w[0]).join('').slice(0, 2);
    const hoursData = StaffState.hoursData?.[emp.id];
    const hoursLabel = hoursData ? `${hoursData.totalHours}г / ${hoursData.workingDays}д` : '';
    const isFreelance = emp.is_freelance;
    const linkBadge = renderLinkBadge(emp);
    const cardBadges = renderStaffCardBadges(emp);
    const rowHealthIssues = scheduleHealthRowIssues(health, emp.id);
    const rowHealthSeverity = scheduleHealthSeverity(rowHealthIssues);
    const rowHealthClass = rowHealthSeverity !== 'ok' ? `has-health-${rowHealthSeverity}` : '';
    const rowHealthBadges = renderScheduleHealthBadges(rowHealthIssues, 'row');
    const roleSummary = staffCardRoleSummary(emp) || emp.position || '';
    const hrLink = renderHrCrosslink(emp);
    const avatarColor = emp.color || (isFreelance ? '#94A3B8' : '#6366F1');
    const focusClass = Number(StaffState.focusedStaffId) === Number(emp.id) ? 'is-schedule-focus' : '';
    const departmentKey = normalizeScheduleDisplayGroupKey(options.department || '');
    const scheduleProfessionKey = scheduleProfessionKeyForDepartment(emp, departmentKey);
    const departmentAttributes = departmentKey
        ? ` data-schedule-department="${escapeHtml(departmentKey)}"`
        : '';
    const professionAttributes = scheduleProfessionKey
        ? ` data-schedule-profession="${escapeHtml(scheduleProfessionKey)}"`
        : '';
    const subGroup = options.subGroup || null;
    const subGroupIdentity = scheduleSubGroupIdentity(subGroup || {});
    const subGroupAttributes = subGroupIdentity
        ? ` data-schedule-subgroup="${escapeHtml(subGroupIdentity)}" data-schedule-subgroup-label="${escapeHtml(subGroup.label || '')}"`
        : '';
    const focusAttributes = focusClass ? ' aria-current="true"' : '';
    let html = `<tr class="${isFreelance ? 'emp-freelance' : ''} ${rowHealthClass} ${focusClass}" data-schedule-staff-row="${Number(emp.id)}"${departmentAttributes}${professionAttributes}${subGroupAttributes}${focusAttributes}>`;
    html += `<td>
        <div class="emp-cell" data-hr-profile="${emp.id}" role="link" tabindex="0"
             title="Відкрити HR профіль: ${escapeHtml(employeeName)}"
             aria-label="Відкрити HR профіль: ${escapeHtml(employeeName)}">
            ${renderStaffCardAvatar(emp, initials, avatarColor)}
            <div class="emp-info">
                <span class="emp-name"><span class="emp-name-text" title="${escapeHtml(employeeName)}">${escapeHtml(employeeName)}</span>${hrLink}</span>
                <span class="emp-position" title="${escapeHtml(roleSummary)}">${escapeHtml(roleSummary)} ${linkBadge}</span>
                <span class="emp-readiness">${cardBadges}${rowHealthBadges}</span>
                <span class="emp-hours">${hoursLabel}</span>
            </div>
        </div>
    </td>`;

    for (const d of dates) {
        const ds = formatDateStr(d);
        const isToday = ds === today;
        const entry = StaffState.schedule[`${emp.id}_${ds}`];
        const status = entry ? entry.status : 'unset';
        const shiftStart = entry?.shift_start;
        const shiftEnd = entry?.shift_end;
        const icon = STATUS_ICONS[status] || '';
        const isReplacement = isReplacementEntry(entry);
        const loadMeta = scheduleShiftLoadMeta({ ...entry, status, date: ds, shift_start: shiftStart, shift_end: shiftEnd });
        const loadClass = loadMeta.className || '';
        const cellHealthIssues = scheduleHealthCellIssues(health, emp.id, ds);
        const cellHealthSeverity = scheduleHealthSeverity(cellHealthIssues);
        const cellHealthClass = cellHealthSeverity !== 'ok' ? `has-health-${cellHealthSeverity}` : '';
        const cellHealthBadges = renderScheduleHealthBadges(cellHealthIssues, 'cell');
        const attendanceRecord = scheduleAttendanceRecord(emp.id, ds);
        const attendanceDetails = scheduleAttendanceDetails(entry, attendanceRecord, ds);
        let primaryContent = '';
        const metaContent = [];
        if ((status === 'working' || status === 'remote') && (shiftStart && shiftEnd || entry?.segments?.length)) {
            primaryContent = renderScheduleCellSegments(
                entry,
                entry?.profession_key || emp.role_type,
                scheduleProfessionKey,
                dates.length >= 28
            );
            if (isReplacement) {
                metaContent.push(`<span class="sch-replacement-badge">Заміна</span>`);
                metaContent.push(`<span class="sch-replacement-from">за ${escapeHtml(entry.original_staff_name || 'працівника')}</span>`);
            }
            if (status === 'remote') metaContent.push(`<span class="sch-label"><span class="sch-icon">${icon}</span> Відд.</span>`);
        } else if (status === 'working') {
            primaryContent = `<span class="sch-label"><span class="sch-icon">${icon}</span> Роб.</span>`;
        } else if (status === 'unset') {
            primaryContent = `<span class="sch-label sch-unset"><span class="sch-icon">${icon}</span></span>`;
        } else {
            primaryContent = `<span class="sch-label"><span class="sch-icon">${icon}</span> ${STAFF_SCHEDULE_STATUS_LABELS[status] || status}</span>`;
        }

        if (entry?.note) {
            metaContent.push(`<span class="sch-note">${escapeHtml(entry.note)}</span>`);
        }
        const attendanceIndicator = renderScheduleAttendanceIndicator(emp.id, ds, entry);
        const cellContent = `<span class="sch-cell-main">${primaryContent}</span>${metaContent.length ? `<span class="sch-cell-meta">${metaContent.join('')}</span>` : ''}${attendanceIndicator ? `<span class="sch-cell-attendance">${attendanceIndicator}</span>` : ''}`;

        const cellTitle = [scheduleEntryTitle(emp, ds, entry, shiftStart, shiftEnd), attendanceDetails.status ? `attendance ${attendanceDetails.label}` : '', scheduleHealthIssueSummary(cellHealthIssues)].filter(Boolean).join(' | ');
        const cellAriaLabel = scheduleCellAriaLabel(emp, ds, entry, status, shiftStart, shiftEnd, attendanceDetails, cellHealthIssues);

        html += `<td class="schedule-day-cell status-${status} ${isToday ? 'today-col' : ''} ${isReplacement ? 'is-replacement' : ''} ${cellHealthClass}">
            <div class="sch-cell status-${status} ${loadClass} ${isToday ? 'today-col' : ''} ${isReplacement ? 'is-replacement' : ''} ${cellHealthClass}"
                 role="button" tabindex="0" aria-label="${escapeHtml(cellAriaLabel)}"
                 data-staff="${emp.id}" data-date="${ds}"${departmentAttributes}${professionAttributes}
                 data-shift-load="${loadMeta.bucket || ''}" data-shift-ratio="${loadMeta.label || ''}"
                 data-schedule-id="${entry?.id || ''}" data-hr-shift="${entry?.hr_shift_id || ''}"
                 title="${escapeHtml(cellTitle)}">
                ${cellContent}
            </div>
            ${cellHealthBadges}
        </td>`;
    }
    html += `</tr>`;
    return html;
}

function scheduleCellFromEvent(event, tbody) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return null;
    if (target.closest('button, a, input, select, textarea, [data-health-detail], [data-attendance-action]')) return null;
    const cell = target.closest('.sch-cell');
    if (!cell || (tbody && !tbody.contains(cell))) return null;
    return cell;
}

function openScheduleCell(cell) {
    if (!cell) return;
    if (!scheduleRangeDataReady()) {
        showNotification('Редагування доступне після успішного завантаження періоду', 'error');
        return;
    }
    const staffId = parseInt(cell.dataset.staff, 10);
    if (!Number.isFinite(staffId) || !cell.dataset.date) return;
    openEditModal(staffId, cell.dataset.date, {
        trigger: cell,
        department: cell.dataset.scheduleDepartment || '',
        professionKey: cell.dataset.scheduleProfession || ''
    });
}

function bindScheduleCellActivation(tbody) {
    if (!tbody || tbody.dataset.scheduleCellActivationBound === 'true') return;
    tbody.addEventListener('click', (event) => {
        openScheduleCell(scheduleCellFromEvent(event, tbody));
    });
    tbody.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const cell = scheduleCellFromEvent(event, tbody);
        if (!cell) return;
        event.preventDefault();
        event.stopPropagation();
        openScheduleCell(cell);
    });
    tbody.dataset.scheduleCellActivationBound = 'true';
}

function bindScheduleGroupToggles(tbody) {
    if (!tbody || tbody.dataset.scheduleGroupToggleBound === 'true') return;
    tbody.addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-schedule-group-toggle]');
        if (!button || !tbody.contains(button)) return;
        event.preventDefault();
        event.stopPropagation();
        toggleScheduleGroup(button.dataset.scheduleGroupToggle || '');
    });
    tbody.dataset.scheduleGroupToggleBound = 'true';
}

function renderSchedule() {
    const dates = getScheduleDates();
    const today = todayStr();
    syncScheduleRangeLayout('scheduleWrapper', dates, 'schedule');
    bindScheduleStaffSearchControls();

    // Header
    const thead = document.getElementById('scheduleHead');
    let headHtml = '<tr><th scope="col">Співробітник</th>';
    for (const d of dates) {
        const ds = formatDateStr(d);
        const isToday = ds === today;
        headHtml += `<th scope="col" class="${isToday ? 'today' : ''}">
            <span class="th-date">${d.getDate()}</span>
            <span class="th-day">${STAFF_SCHEDULE_DAYS_UK[d.getDay()]}</span>
        </th>`;
    }
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    // Body — group by department
    const tbody = document.getElementById('scheduleBody');
    const visibleSnapshot = scheduleFinalVisibleStaffSnapshot(StaffState.staff, dates);
    const baseFiltered = visibleSnapshot.base;
    renderScheduleStaffFilterInfo(baseFiltered);
    const health = visibleSnapshot.health;
    const filtered = visibleSnapshot.visible;

    // Group staff by department
    const grouped = groupStaffByScheduleDepartment(filtered, {
        department: StaffState.activeDept,
        grouping: StaffState.activeDept === 'all' ? 'membership' : 'canonical'
    });

    let bodyHtml = '';

    if (!filtered.length) {
        const message = baseFiltered.length
            ? 'Немає рядків для поточного health-фільтра.'
            : 'Немає працівників у поточному фільтрі графіка.';
        bodyHtml = `<tr class="schedule-health-empty-row"><td colspan="${dates.length + 1}">${escapeHtml(message)}</td></tr>`;
    }

    for (const dept of scheduleDepartmentRenderOrder(grouped)) {
        if (!grouped[dept]) continue;
        const deptLabel = scheduleDisplayDepartmentLabel(dept);
        const icon = renderScheduleCrmIcon(DEPT_ICONS[dept], 'dept-icon schedule-crm-icon');
        const deptStaff = grouped[dept];
        const subGroups = DEPT_SUB_GROUPS[dept];
        const subGroupPartition = partitionScheduleStaffBySubGroup(dept, deptStaff, subGroups, {
            activeDepartment: dept
        });
        const renderableSubGroups = subGroupPartition.groups
            .filter(group => !shouldSkipScheduleSubGroup(dept, group.subGroup));
        const groupExpanded = isScheduleGroupExpandedForRender(dept);
        const groupStateClass = groupExpanded ? 'is-expanded' : 'is-collapsed';
        const groupToggleLabel = groupExpanded
            ? `Згорнути групу ${deptLabel}`
            : `Розгорнути групу ${deptLabel}`;

        // Department header
        bodyHtml += `<tr class="dept-row ${groupStateClass}" data-dept="${escapeHtml(dept)}"><td class="schedule-category-sticky-cell schedule-group-sticky-cell">
            <button type="button" class="schedule-group-toggle" data-schedule-group-toggle="${escapeHtml(dept)}" aria-expanded="${groupExpanded ? 'true' : 'false'}" aria-label="${escapeHtml(groupToggleLabel)}" title="${escapeHtml(deptLabel)}">
                <span class="schedule-group-caret" aria-hidden="true"></span>
                ${icon}
                <span class="schedule-group-label">${escapeHtml(deptLabel)}</span>
                <span class="dept-count">${deptStaff.length}</span>
            </button>
        </td><td class="schedule-category-fill-cell schedule-group-fill-cell" colspan="${dates.length}" aria-hidden="true">
        </td></tr>`;

        if (!groupExpanded) continue;

        const renderedStaffIds = new Set();
        for (const group of renderableSubGroups) {
            const sg = group.subGroup;
            const sgStaff = group.staff.filter(staff => !renderedStaffIds.has(normalizeScheduleStaffId(staff.id)));
            if (sgStaff.length === 0) continue;
            const subGroupIcon = renderScheduleCrmIcon(sg.icon, 'sub-group-icon schedule-crm-icon');

            bodyHtml += `<tr class="sub-group-row"><td class="schedule-category-sticky-cell schedule-sub-group-sticky-cell">
                ${subGroupIcon}<span class="sub-group-label" title="${escapeHtml(sg.label)}">${escapeHtml(sg.label)}</span> <span class="sub-group-count">${sgStaff.length}</span>
            </td><td class="schedule-category-fill-cell schedule-sub-group-fill-cell" colspan="${dates.length}" aria-hidden="true"></td></tr>`;

            for (const emp of sgStaff) {
                const staffId = normalizeScheduleStaffId(emp.id);
                renderedStaffIds.add(staffId);
                bodyHtml += renderEmpRow(emp, dates, today, health, { subGroup: sg, department: dept });
            }
        }
        // Duplicate-label and ungrouped rows stay under the top-level header without a redundant subgroup header.
        for (const emp of uniqueScheduleStaffById(deptStaff).filter(staff => !renderedStaffIds.has(normalizeScheduleStaffId(staff.id)))) {
            const staffId = normalizeScheduleStaffId(emp.id);
            bodyHtml += renderEmpRow(emp, dates, today, health, {
                subGroup: subGroupPartition.ownershipByStaffId.get(staffId) || null,
                department: dept
            });
        }
    }

    tbody.innerHTML = bodyHtml;
    tbody.classList.toggle('show-hours', Boolean(StaffState.showHours));
    renderSummary(filtered, dates);
    renderScheduleAttendanceSummary(dates, filtered);

    // Cell activation handlers
    tbody.querySelectorAll('.sch-cell').forEach(cell => {
        if (!StaffState.canManage) cell.setAttribute('aria-readonly', 'true');
    });
    bindScheduleCellActivation(tbody);
    bindScheduleGroupToggles(tbody);

    tbody.querySelectorAll('[data-attendance-action]').forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleAttendanceAction(button);
        });
    });

    // Link badge click handlers (v39.1)
    tbody.querySelectorAll('.link-badge.unlinked').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            openLinkModal(parseInt(badge.dataset.linkStaff));
        });
    });
    tbody.querySelectorAll('.link-badge.linked').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const userId = parseInt(badge.dataset.linkedUser, 10);
            if (Number.isFinite(userId)) {
                window.location.href = `/hr?tab=accounts&accountUser=${encodeURIComponent(userId)}`;
            }
        });
    });
    bindScheduleHealthDetailButtons(tbody);

    // Employee profile click handlers: the name/avatar area opens the HR profile,
    // while date cells keep opening shift editing and account badges keep linking accounts.
    tbody.querySelectorAll('[data-hr-profile]').forEach(cell => {
        const open = () => openHrProfile(parseInt(cell.dataset.hrProfile, 10));
        cell.addEventListener('click', (e) => {
            if (e.target.closest('a, button, input, select, textarea, [data-link-staff]')) return;
            open();
        });
        cell.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            open();
        });
    });

    if (StaffState.focusedStaffId) {
        const applied = focusScheduleStaffRow(StaffState.focusedStaffId, {
            scroll: StaffState.focusScrollPending
        });
        if (applied) StaffState.focusScrollPending = false;
    }
    syncScheduleRangeActionAvailability();
}

// ==========================================
// EDIT MODAL
// ==========================================

let _staffScheduleInitialState = '';
let _staffFillInitialState = '';
let _staffScheduleClosePromise = null;
let _staffFillMutationPending = false;

const STAFF_SCHEDULE_PLAN_SCOPES = Object.freeze({
    schedule: Object.freeze({
        editorId: 'schDayPlanEditor',
        listId: 'schSegmentsList',
        addButtonId: 'schAddSegmentBtn',
        primaryId: 'schPrimaryProfession',
        summaryId: 'schPlanSummary',
        statusId: 'schStatus',
        saveButtonId: 'schSaveBtn',
        legacyProfessionId: 'schProfession',
        legacyStartId: 'schStart',
        legacyEndId: 'schEnd'
    }),
    fill: Object.freeze({
        editorId: 'fillDayPlanEditor',
        listId: 'fillSegmentsList',
        addButtonId: 'fillAddSegmentBtn',
        primaryId: 'fillPrimaryProfession',
        summaryId: 'fillPlanSummary',
        statusId: 'fillStatus',
        saveButtonId: 'fillSaveBtn',
        legacyProfessionId: 'fillProfession',
        legacyStartId: 'fillStart',
        legacyEndId: 'fillEnd'
    })
});

function schedulePlanScopeConfig(scope) {
    return STAFF_SCHEDULE_PLAN_SCOPES[scope] || STAFF_SCHEDULE_PLAN_SCOPES.schedule;
}

function schedulePlanIsWorkingStatus(status) {
    return ['working', 'remote'].includes(normalizeScheduleStatus(status));
}

function schedulePlanStaff(scope) {
    if (scope === 'schedule') {
        const staffId = Number(StaffState.editingCell?.staffId);
        const staff = StaffState.staff.find(item => Number(item.id) === staffId);
        return staff ? [staff] : [];
    }
    const selected = document.getElementById('fillStaffSelect')?.value || 'all';
    if (selected === 'all') return uniqueScheduleStaffById(scheduleableStaffForUi(scheduleVisibleStaff()));
    const staffId = normalizeScheduleStaffId(selected);
    return StaffState.staff.filter(item => normalizeScheduleStaffId(item.id) === staffId);
}

function schedulePlanProfessionOptions(scope, selectedKeys = []) {
    const staff = schedulePlanStaff(scope);
    let availableKeys = [];
    if (staff.length) {
        const keySets = staff.map(item => new Set(staffProfessionKeys(item)));
        availableKeys = [...keySets[0]].filter(key => keySets.every(keys => keys.has(key)));
    }
    const selected = parseProfessionArray(selectedKeys).map(normalizeProfessionKey).filter(Boolean);
    const keys = [...new Set([...availableKeys, ...selected])];
    return keys.map(key => ({
        value: key,
        label: professionLabel(key),
        available: availableKeys.includes(key)
    }));
}

function schedulePlanDefaultProfession(scope) {
    if (scope === 'schedule') {
        const editing = StaffState.editingCell;
        const staff = schedulePlanStaff(scope)[0];
        return normalizeProfessionKey(editing?.sectionProfessionKey || staff?.role_type || staffProfessionKeys(staff || {})[0]);
    }
    const options = schedulePlanProfessionOptions(scope);
    return options[0]?.value || '';
}

function createSchedulePlanSegment(scope, overrides = {}) {
    const professionKey = normalizeProfessionKey(overrides.professionKey || overrides.profession_key || schedulePlanDefaultProfession(scope));
    const defaultTimes = schedulePlanDefaultSegmentTimes(scope, professionKey, overrides);
    return normalizeScheduleSegmentForUi({
        professionKey,
        shiftStart: defaultTimes.shiftStart,
        shiftEnd: defaultTimes.shiftEnd,
        breakMinutes: 0,
        note: '',
        additionalProfessionKeys: [],
        ...overrides
    }, professionKey, { scope, date: overrides.date || overrides.shiftDate || overrides.shift_date || overrides.scheduleDate || overrides.schedule_date });
}

function schedulePlanFieldId(scope, field, index, clientKey) {
    const config = schedulePlanScopeConfig(scope);
    if (index === 0 && field === 'profession') return config.legacyProfessionId;
    if (index === 0 && field === 'start') return config.legacyStartId;
    if (index === 0 && field === 'end') return config.legacyEndId;
    return `${scope}Segment-${clientKey}-${field}`;
}

const STAFF_SCHEDULE_PAYROLL_READ_ROLES = new Set([
    'creator',
    'director',
    'vice_director',
    'senior_manager',
    'hr',
    'accountant'
]);

function scheduleCanViewPayrollAmounts() {
    const user = typeof AppState !== 'undefined' ? AppState.currentUser : null;
    return STAFF_SCHEDULE_PAYROLL_READ_ROLES.has(String(user?.role || '').trim().toLowerCase());
}

function scheduleExplicitProfessionRate(staff, professionKey) {
    const normalizedKey = normalizeProfessionKey(professionKey);
    const profession = StaffState.professions.find(item => normalizeProfessionKey(item.key) === normalizedKey);
    const assignment = (Array.isArray(profession?.people) ? profession.people : [])
        .find(person => Number(person.id) === Number(staff?.id));
    const explicitRate = Number(assignment?.explicitRate);
    const available = Boolean(
        staff
        && assignment
        && assignment.isActive !== false
        && assignment.assignmentStatus === 'active'
        && assignment.admissionStatus === 'approved'
        && assignment.rateUnit === 'hour'
        && assignment.rateSource === 'staff_profession_rates.hourly_rate'
        && Number.isFinite(explicitRate)
        && explicitRate > 0
    );
    return {
        available,
        rate: available ? explicitRate : null,
        assignment,
        reason: !staff
            ? 'Оберіть одного працівника.'
            : 'Для цієї професії немає явної погодинної ставки.'
    };
}

function schedulePaidRoleRate(scope, professionKey) {
    const staff = schedulePlanStaff(scope);
    if (staff.length !== 1) {
        return {
            available: false,
            rate: null,
            reason: 'Оплачувану додаткову професію можна налаштувати лише для одного працівника.'
        };
    }
    return scheduleExplicitProfessionRate(staff[0], professionKey);
}

function scheduleFormatMoney(amount) {
    return new Intl.NumberFormat('uk-UA', {
        minimumFractionDigits: Number(amount) % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2
    }).format(Number(amount || 0));
}

function schedulePaidRolePreview(scope, role, segment) {
    if (!role?.professionKey) {
        return 'Необов’язково. Фізичний час працівника при цьому не подвоюється.';
    }
    const rateInfo = schedulePaidRoleRate(scope, role.professionKey);
    if (!rateInfo.available) {
        return `${rateInfo.reason} Додайте її в HR → Команда → картка працівника → ставки професій.`;
    }
    const start = role.intervalStart || segment.shiftStart;
    const end = role.intervalEnd || segment.shiftEnd;
    const minutes = scheduleSegmentDurationMinutes(start, end) || 0;
    const multiplier = Number(role.payMultiplier || 1);
    const base = `${minutes} хв · multiplier ${multiplier.toFixed(1)}`;
    if (!scheduleCanViewPayrollAmounts()) return `Ставка налаштована · ${base}`;
    const amount = (minutes / 60) * rateInfo.rate * multiplier;
    return `${scheduleFormatMoney(rateInfo.rate)} грн/год · ${base} · ≈ ${scheduleFormatMoney(amount)} грн`;
}

function schedulePaidRoleOptions(scope, professionOptions, segment) {
    const paidRole = (segment.additionalRoles || [])
        .find(role => role.compensationMode === 'paid_hourly') || null;
    return [
        '<option value="">Без оплачуваної додаткової професії</option>',
        ...professionOptions.map(option => {
            const isPrimary = option.value === segment.professionKey;
            const selected = option.value === paidRole?.professionKey;
            const rateInfo = schedulePaidRoleRate(scope, option.value);
            const suffix = rateInfo.available ? '' : ' · немає явної ставки';
            return `<option value="${escapeHtml(option.value)}" ${selected ? 'selected' : ''} ${isPrimary ? 'disabled' : ''}>${escapeHtml(option.label)}${escapeHtml(suffix)}</option>`;
        })
    ].join('');
}

function renderSchedulePlanSegmentCard(scope, segment, index, segmentCount) {
    const selectedKeys = [segment.professionKey, ...(segment.additionalProfessionKeys || [])];
    const professionOptions = schedulePlanProfessionOptions(scope, selectedKeys);
    const professionId = schedulePlanFieldId(scope, 'profession', index, segment.clientKey);
    const startId = schedulePlanFieldId(scope, 'start', index, segment.clientKey);
    const endId = schedulePlanFieldId(scope, 'end', index, segment.clientKey);
    const breakId = schedulePlanFieldId(scope, 'break', index, segment.clientKey);
    const noteId = schedulePlanFieldId(scope, 'note', index, segment.clientKey);
    const paidProfessionId = schedulePlanFieldId(scope, 'paid-profession', index, segment.clientKey);
    const paidStartId = schedulePlanFieldId(scope, 'paid-start', index, segment.clientKey);
    const paidEndId = schedulePlanFieldId(scope, 'paid-end', index, segment.clientKey);
    const paidMultiplierId = schedulePlanFieldId(scope, 'paid-multiplier', index, segment.clientKey);
    const paidRole = (segment.additionalRoles || [])
        .find(role => role.compensationMode === 'paid_hourly') || null;
    const optionHtml = professionOptions.length
        ? professionOptions.map(option => `<option value="${escapeHtml(option.value)}" ${option.value === segment.professionKey ? 'selected' : ''}>${escapeHtml(option.label)}${option.available ? '' : ' · поза карткою'}</option>`).join('')
        : '<option value="">Професія не задана</option>';
    const unpaidHtml = professionOptions.length
        ? professionOptions.map(option => {
            const role = (segment.additionalRoles || [])
                .find(item => item.professionKey === option.value && item.compensationMode !== 'paid_hourly');
            const checked = Boolean(role)
                || (segment.additionalProfessionKeys.includes(option.value) && option.value !== paidRole?.professionKey);
            const isPrimary = option.value === segment.professionKey;
            return `<label class="sch-additional-role ${isPrimary ? 'is-primary-role' : ''}">
                <input type="checkbox" data-segment-field="additional-unpaid" value="${escapeHtml(option.value)}" data-compensation-mode="${escapeHtml(role?.compensationMode || 'unpaid')}" data-pay-multiplier="${escapeHtml(role?.payMultiplier ?? '')}" data-policy-version="${escapeHtml(role?.policyVersion || '')}" ${checked ? 'checked' : ''} ${isPrimary ? 'disabled' : ''}>
                <span>${escapeHtml(option.label)}</span>
                <span class="sch-role-pay-status ${isPrimary ? 'is-primary' : 'is-unpaid'}">
                    ${isPrimary ? 'основна роль' : 'без окремої оплати'}
                </span>
            </label>`;
        }).join('')
        : '<span class="sch-segment-empty-roles">У HR-картці немає доступних професій.</span>';

    const paidStart = paidRole?.intervalStart || segment.shiftStart;
    const paidEnd = paidRole?.intervalEnd || segment.shiftEnd;
    const paidMultiplier = Number(paidRole?.payMultiplier || 1);
    const paidRate = paidRole ? schedulePaidRoleRate(scope, paidRole.professionKey) : null;
    const paidRateError = paidRole && !paidRate?.available
        ? `<div class="sch-paid-rate-error">
            <span>${escapeHtml(paidRate?.reason || 'Відсутня явна погодинна ставка.')}</span>
            <a href="/hr">Де додати ставку</a>
        </div>`
        : '';
    return `
        <article class="sch-segment-card" data-segment-index="${index}" data-segment-key="${escapeHtml(segment.clientKey)}" data-segment-id="${segment.id ?? ''}">
            <div class="sch-segment-card-head">
                <strong>Блок ${index + 1}</strong>
                <div class="sch-segment-card-actions" aria-label="Порядок і видалення блоку ${index + 1}">
                    <button type="button" data-segment-action="up" aria-label="Перемістити блок ${index + 1} вище" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" data-segment-action="down" aria-label="Перемістити блок ${index + 1} нижче" ${index === segmentCount - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" data-segment-action="remove" class="sch-segment-remove" aria-label="Видалити блок ${index + 1}">Видалити</button>
                </div>
            </div>
            <div class="sch-segment-grid">
                <div class="form-group sch-segment-profession-field">
                    <label for="${escapeHtml(professionId)}">Професія</label>
                    <select id="${escapeHtml(professionId)}" data-segment-field="profession">${optionHtml}</select>
                    <div class="sch-field-error" data-field-error="profession"></div>
                </div>
                <div class="form-group">
                    <label for="${escapeHtml(startId)}">Початок</label>
                    <input type="time" id="${escapeHtml(startId)}" data-segment-field="start" value="${escapeHtml(segment.shiftStart)}">
                    <div class="sch-field-error" data-field-error="start"></div>
                </div>
                <div class="form-group">
                    <label for="${escapeHtml(endId)}">Завершення</label>
                    <input type="time" id="${escapeHtml(endId)}" data-segment-field="end" value="${escapeHtml(segment.shiftEnd)}">
                    <div class="sch-field-error" data-field-error="end"></div>
                </div>
                <div class="form-group">
                    <label for="${escapeHtml(breakId)}">Перерва, хв</label>
                    <input type="number" id="${escapeHtml(breakId)}" data-segment-field="break" min="0" step="1" inputmode="numeric" value="${Number(segment.breakMinutes || 0)}">
                    <div class="sch-field-error" data-field-error="break"></div>
                </div>
                <div class="form-group sch-segment-note-field">
                    <label for="${escapeHtml(noteId)}">Примітка блоку</label>
                    <input type="text" id="${escapeHtml(noteId)}" data-segment-field="note" value="${escapeHtml(segment.note || '')}" placeholder="Необов'язково">
                </div>
            </div>
            <fieldset class="sch-additional-roles sch-unpaid-roles">
                <legend>Додаткова роль без доплати</legend>
                <div class="sch-additional-role-options">${unpaidHtml}</div>
            </fieldset>
            <fieldset class="sch-additional-roles sch-paid-role-editor">
                <legend>Додаткова оплачувана професія</legend>
                <div class="sch-paid-role-grid">
                    <div class="form-group sch-paid-profession-field">
                        <label for="${escapeHtml(paidProfessionId)}">Оплачувана професія</label>
                        <select id="${escapeHtml(paidProfessionId)}" data-segment-field="paid-profession">${schedulePaidRoleOptions(scope, professionOptions, segment)}</select>
                        <div class="sch-field-error" data-field-error="paid-profession"></div>
                    </div>
                    <div class="form-group">
                        <label for="${escapeHtml(paidStartId)}">Початок оплати</label>
                        <input type="time" id="${escapeHtml(paidStartId)}" data-segment-field="paid-start" value="${escapeHtml(paidStart)}" ${paidRole ? '' : 'disabled'}>
                        <div class="sch-field-error" data-field-error="paid-start"></div>
                    </div>
                    <div class="form-group">
                        <label for="${escapeHtml(paidEndId)}">Завершення оплати</label>
                        <input type="time" id="${escapeHtml(paidEndId)}" data-segment-field="paid-end" value="${escapeHtml(paidEnd)}" ${paidRole ? '' : 'disabled'}>
                        <div class="sch-field-error" data-field-error="paid-end"></div>
                    </div>
                    <div class="form-group">
                        <label for="${escapeHtml(paidMultiplierId)}">Multiplier</label>
                        <input type="number" id="${escapeHtml(paidMultiplierId)}" data-segment-field="paid-multiplier" min="1" max="1" step="0.1" value="${paidMultiplier.toFixed(1)}" readonly aria-readonly="true">
                    </div>
                </div>
                <div class="sch-paid-role-status ${paidRole ? 'is-paid' : 'is-empty'}">
                    ${paidRole
                        ? `${escapeHtml(professionLabel(paidRole.professionKey))} · оплачувана`
                        : 'Оберіть професію, щоб увімкнути окрему оплату'}
                </div>
                <div class="sch-paid-role-preview sch-paid-role-limit-note">
                    Ліміт v1: максимум одна оплачувана додаткова професія в одному фізичному блоці.
                </div>
                <div class="sch-paid-role-preview" data-paid-role-preview>${escapeHtml(schedulePaidRolePreview(scope, paidRole, segment))}</div>
                <div class="sch-paid-role-preview sch-paid-role-policy-note">
                    Окрема оплата розраховується для hourly, per shift і monthly fixed. Hybrid, percent та manual payroll залишаються заблокованими до погодження окремої формули.
                </div>
                ${paidRateError}
            </fieldset>
        </article>`;
}

function readSchedulePlanSegments(scope) {
    const config = schedulePlanScopeConfig(scope);
    const cards = Array.from(document.querySelectorAll(`#${config.listId} .sch-segment-card`));
    if (!cards.length) {
        const profession = document.getElementById(config.legacyProfessionId);
        const start = document.getElementById(config.legacyStartId);
        const end = document.getElementById(config.legacyEndId);
        if (profession && start && end) {
            return [{
                id: null,
                clientKey: `${scope}-legacy-segment`,
                professionKey: normalizeProfessionKey(profession.value),
                shiftStart: normalizeSchedulePlanTime(start.value),
                shiftEnd: normalizeSchedulePlanTime(end.value),
                breakMinutes: 0,
                note: '',
                additionalRoles: [],
                additionalProfessionKeys: []
            }];
        }
    }
    return cards.map(card => {
        const checkedRoles = Array.from(card.querySelectorAll('[data-segment-field="additional-unpaid"]:checked'));
        const paidProfessionKey = normalizeProfessionKey(card.querySelector('[data-segment-field="paid-profession"]')?.value);
        const paidRole = paidProfessionKey
            ? {
                professionKey: paidProfessionKey,
                compensationMode: 'paid_hourly',
                payMultiplier: Number(card.querySelector('[data-segment-field="paid-multiplier"]')?.value || 1),
                policyVersion: null,
                intervalStart: normalizeSchedulePlanTime(card.querySelector('[data-segment-field="paid-start"]')?.value),
                intervalEnd: normalizeSchedulePlanTime(card.querySelector('[data-segment-field="paid-end"]')?.value)
            }
            : null;
        return {
            id: card.dataset.segmentId ? Number(card.dataset.segmentId) : null,
            clientKey: card.dataset.segmentKey || scheduleSegmentClientKey(),
            professionKey: normalizeProfessionKey(card.querySelector('[data-segment-field="profession"]')?.value),
            shiftStart: normalizeSchedulePlanTime(card.querySelector('[data-segment-field="start"]')?.value),
            shiftEnd: normalizeSchedulePlanTime(card.querySelector('[data-segment-field="end"]')?.value),
            breakMinutes: Number.parseInt(card.querySelector('[data-segment-field="break"]')?.value, 10) || 0,
            note: String(card.querySelector('[data-segment-field="note"]')?.value || '').trim(),
            additionalRoles: checkedRoles.map(input => ({
                professionKey: normalizeProfessionKey(input.value),
                compensationMode: input.dataset.compensationMode || 'unpaid',
                payMultiplier: input.dataset.payMultiplier === '' ? null : Number(input.dataset.payMultiplier),
                policyVersion: input.dataset.policyVersion || null
            })).filter(role => role.professionKey && role.professionKey !== paidProfessionKey)
                .concat(paidRole ? [paidRole] : []),
            additionalProfessionKeys: [
                ...checkedRoles.map(input => normalizeProfessionKey(input.value))
                    .filter(key => key && key !== paidProfessionKey),
                ...(paidRole ? [paidRole.professionKey] : [])
            ]
        };
    });
}

function scheduleSegmentAbsoluteBounds(segment) {
    const start = scheduleTimeToMinutes(segment.shiftStart);
    const rawEnd = scheduleTimeToMinutes(segment.shiftEnd);
    if (start === null || rawEnd === null || start === rawEnd) return null;
    return {
        start,
        end: rawEnd <= start ? rawEnd + (24 * 60) : rawEnd
    };
}

function schedulePaidIntervalBounds(segment, role) {
    const segmentBounds = scheduleSegmentAbsoluteBounds(segment);
    const rawStart = scheduleTimeToMinutes(role?.intervalStart || segment.shiftStart);
    const rawEnd = scheduleTimeToMinutes(role?.intervalEnd || segment.shiftEnd);
    if (!segmentBounds || rawStart === null || rawEnd === null || rawStart === rawEnd) return null;
    const start = rawStart < segmentBounds.start ? rawStart + (24 * 60) : rawStart;
    let end = rawEnd < segmentBounds.start ? rawEnd + (24 * 60) : rawEnd;
    if (end <= start) end += 24 * 60;
    return { start, end, segmentBounds };
}

function scheduleMinutesToTime(minutes) {
    const normalized = ((Number(minutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
    return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function normalizeSchedulePaidRoleSegments(segments = []) {
    const normalized = [];
    const errors = [];
    (Array.isArray(segments) ? segments : []).forEach((segment, index) => {
        const paidRoles = (segment.additionalRoles || [])
            .filter(role => role.compensationMode === 'paid_hourly');
        const unpaidRoles = (segment.additionalRoles || [])
            .filter(role => role.compensationMode !== 'paid_hourly')
            .map(role => ({ ...role, compensationMode: 'unpaid', payMultiplier: null }));
        if (paidRoles.length !== 1) {
            normalized.push({
                ...segment,
                additionalRoles: [...unpaidRoles, ...paidRoles],
                additionalProfessionKeys: [...new Set([...unpaidRoles, ...paidRoles].map(role => role.professionKey))]
            });
            return;
        }
        const paidRole = paidRoles[0];
        const bounds = schedulePaidIntervalBounds(segment, paidRole);
        if (!bounds
            || bounds.start < bounds.segmentBounds.start
            || bounds.end > bounds.segmentBounds.end) {
            errors.push({
                index,
                field: 'paid-start',
                message: 'Оплачуваний інтервал має повністю бути в межах основного фізичного блоку.'
            });
            normalized.push(segment);
            return;
        }
        const needsSplit = bounds.start !== bounds.segmentBounds.start || bounds.end !== bounds.segmentBounds.end;
        if (needsSplit && Number(segment.breakMinutes || 0) > 0) {
            errors.push({
                index,
                field: 'break',
                message: 'Перед поділом блоку приберіть перерву: її потрібно задати в конкретному фізичному сегменті після конвертації.'
            });
            normalized.push(segment);
            return;
        }
        const boundaries = [...new Set([
            bounds.segmentBounds.start,
            bounds.start,
            bounds.end,
            bounds.segmentBounds.end
        ])].sort((left, right) => left - right);
        boundaries.slice(0, -1).forEach((sliceStart, sliceIndex) => {
            const sliceEnd = boundaries[sliceIndex + 1];
            if (sliceEnd <= sliceStart) return;
            const paidActive = sliceStart >= bounds.start && sliceEnd <= bounds.end;
            const roles = paidActive
                ? [...unpaidRoles, {
                    professionKey: paidRole.professionKey,
                    compensationMode: 'paid_hourly',
                    payMultiplier: Number(paidRole.payMultiplier || 1),
                    policyVersion: paidRole.policyVersion || null
                }]
                : unpaidRoles.map(role => ({ ...role }));
            normalized.push({
                ...segment,
                id: sliceIndex === 0 ? segment.id : null,
                clientKey: sliceIndex === 0 ? segment.clientKey : scheduleSegmentClientKey(),
                shiftStart: scheduleMinutesToTime(sliceStart),
                shiftEnd: scheduleMinutesToTime(sliceEnd),
                breakMinutes: needsSplit ? 0 : Number(segment.breakMinutes || 0),
                additionalRoles: roles,
                additionalProfessionKeys: [...new Set(roles.map(role => role.professionKey))]
            });
        });
    });
    return { segments: normalized, errors };
}

function buildScheduleOverlapConversionSegments(segments = [], candidate = null, breakTargetKey = '') {
    if (!candidate) return { segments: [], breakTargets: [] };
    const source = (Array.isArray(segments) ? segments : []).map(segment => ({
        ...segment,
        additionalRoles: (segment.additionalRoles || []).map(role => ({ ...role })),
        additionalProfessionKeys: [...(segment.additionalProfessionKeys || [])]
    }));
    const pairIndexes = new Set([candidate.baseIndex, candidate.paidIndex]);
    const pair = [...pairIndexes].map(index => ({
        index,
        segment: source[index],
        bounds: scheduleSegmentAbsoluteBounds(source[index])
    }));
    if (pair.some(item => !item.segment || !item.bounds)) return { segments: [], breakTargets: [] };

    const boundaries = [...new Set(pair.flatMap(item => [item.bounds.start, item.bounds.end]))]
        .sort((left, right) => left - right);
    const reusedIds = new Set();
    const convertedPair = [];
    boundaries.slice(0, -1).forEach((sliceStart, sliceIndex) => {
        const sliceEnd = boundaries[sliceIndex + 1];
        if (sliceEnd <= sliceStart) return;
        const active = pair.filter(item =>
            sliceStart >= item.bounds.start && sliceEnd <= item.bounds.end);
        if (!active.length) return;
        const bothActive = active.length === 2;
        const mainItem = bothActive
            ? pair.find(item => item.index === candidate.baseIndex)
            : active[0];
        const mainSource = mainItem.segment;
        const roles = (mainSource.additionalRoles || [])
            .filter(role => role.compensationMode !== 'paid_hourly'
                && role.professionKey !== candidate.professionKey)
            .map(role => ({ ...role, compensationMode: 'unpaid', payMultiplier: null }));
        if (bothActive) {
            roles.push({
                professionKey: candidate.professionKey,
                compensationMode: 'paid_hourly',
                payMultiplier: 1,
                policyVersion: null
            });
        }
        const canReuseId = mainSource.id && !reusedIds.has(mainItem.index);
        if (canReuseId) reusedIds.add(mainItem.index);
        const conversionBreakKey = `${sliceStart}:${sliceEnd}:${mainItem.index}`;
        convertedPair.push({
            ...mainSource,
            id: canReuseId ? mainSource.id : null,
            clientKey: canReuseId ? mainSource.clientKey : scheduleSegmentClientKey(),
            shiftStart: scheduleMinutesToTime(sliceStart),
            shiftEnd: scheduleMinutesToTime(sliceEnd),
            breakMinutes: conversionBreakKey === breakTargetKey
                ? Number(candidate.breakMinutes || 0)
                : 0,
            additionalRoles: roles,
            additionalProfessionKeys: [...new Set(roles.map(role => role.professionKey))],
            conversionBreakKey
        });
    });

    const breakTargets = convertedPair
        .filter(segment => (
            scheduleSegmentDurationMinutes(segment.shiftStart, segment.shiftEnd)
            > Number(candidate.breakMinutes || 0)
        ))
        .map(segment => ({
            key: segment.conversionBreakKey,
            label: `${segment.shiftStart}–${segment.shiftEnd} · ${professionLabel(segment.professionKey)}`
        }));
    const unaffected = source.filter((segment, index) => !pairIndexes.has(index));
    const normalized = [...unaffected, ...convertedPair]
        .sort((left, right) => {
            const leftBounds = scheduleSegmentAbsoluteBounds(left);
            const rightBounds = scheduleSegmentAbsoluteBounds(right);
            return (leftBounds?.start ?? 0) - (rightBounds?.start ?? 0)
                || (leftBounds?.end ?? 0) - (rightBounds?.end ?? 0);
        })
        .map(segment => {
            const { conversionBreakKey, ...publicSegment } = segment;
            return publicSegment;
        });
    return { segments: normalized, breakTargets };
}

function scheduleOverlapConversionAnalysis(segments = []) {
    const timeline = (Array.isArray(segments) ? segments : []).map((segment, index) => ({
        segment,
        index,
        bounds: scheduleSegmentAbsoluteBounds(segment)
    })).filter(item => item.bounds);
    const pairs = [];
    for (let leftIndex = 0; leftIndex < timeline.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < timeline.length; rightIndex += 1) {
            const left = timeline[leftIndex];
            const right = timeline[rightIndex];
            const overlaps = left.bounds.start < right.bounds.end && right.bounds.start < left.bounds.end;
            if (overlaps) pairs.push({ left, right });
        }
    }
    if (!pairs.length) return { candidate: null, blocker: '' };
    if (pairs.length !== 1) {
        return {
            candidate: null,
            blocker: 'Автоматична конвертація недоступна: одночасно перетинаються понад два блоки. Нормалізуйте ланцюжок по одній парі без спільних перетинів.'
        };
    }
    const { left, right } = pairs[0];
    if (left.bounds.end > 24 * 60 || right.bounds.end > 24 * 60) {
        return {
            candidate: null,
            blocker: 'Автоматична конвертація нічних блоків недоступна без погодженої day-offset моделі. Залиште один overnight-блок або розбийте план після впровадження explicit day offsets.'
        };
    }
    if (left.segment.professionKey === right.segment.professionKey) {
        return {
            candidate: null,
            blocker: 'Автоматична конвертація недоступна: блоки мають однакову основну професію, тому другий блок не можна перетворити на окрему оплачувану роль.'
        };
    }
    const leftContains = left.bounds.start <= right.bounds.start
        && left.bounds.end >= right.bounds.end;
    const rightContains = right.bounds.start <= left.bounds.start
        && right.bounds.end >= left.bounds.end;
    const contained = leftContains || rightContains;
    const base = contained
        ? (leftContains ? left : right)
        : (left.bounds.start < right.bounds.start ? left : right);
    const paid = base === left ? right : left;
    if ((base.segment.additionalRoles || [])
        .some(role => role.compensationMode === 'paid_hourly')) {
        return {
            candidate: null,
            blocker: 'Автоматична конвертація недоступна: фізичний блок уже має оплачувану додаткову професію. Ліміт v1 — максимум одна paid additional role на блок.'
        };
    }
    if ((paid.segment.additionalRoles || []).length > 0) {
        return {
            candidate: null,
            blocker: 'Автоматична конвертація недоступна: блок, який має стати оплачуваною роллю, уже містить додаткові ролі. Спочатку приберіть або окремо нормалізуйте їх.'
        };
    }
    const candidate = {
        kind: contained ? 'contained' : 'partial',
        baseIndex: base.index,
        paidIndex: paid.index,
        professionKey: paid.segment.professionKey,
        start: scheduleMinutesToTime(Math.max(left.bounds.start, right.bounds.start)),
        end: scheduleMinutesToTime(Math.min(left.bounds.end, right.bounds.end)),
        breakMinutes: Math.max(
            Number(left.segment.breakMinutes || 0),
            Number(right.segment.breakMinutes || 0)
        )
    };
    const preview = buildScheduleOverlapConversionSegments(segments, candidate);
    candidate.breakTargets = preview.breakTargets;
    if (candidate.breakMinutes > 0 && !candidate.breakTargets.length) {
        return {
            candidate: null,
            blocker: `Автоматична конвертація недоступна: перерву ${candidate.breakMinutes} хв неможливо помістити в жоден нормалізований сегмент.`
        };
    }
    return { candidate, blocker: '' };
}

function convertScheduleOverlap(scope, candidate, breakTargetKey = '') {
    const source = readSchedulePlanSegments(scope);
    if (!candidate) return null;
    const rateInfo = schedulePaidRoleRate(scope, candidate.professionKey);
    if (!rateInfo.available) return null;
    const converted = buildScheduleOverlapConversionSegments(source, candidate, breakTargetKey);
    if (Number(candidate.breakMinutes || 0) > 0
        && !converted.breakTargets.some(option => option.key === breakTargetKey)) return null;
    return converted.segments.length ? converted.segments : null;
}

function schedulePlanMetrics(segments = []) {
    const timeline = segments.map((segment, index) => {
        const startMinutes = scheduleTimeToMinutes(segment.shiftStart);
        const rawEndMinutes = scheduleTimeToMinutes(segment.shiftEnd);
        const endMinutes = startMinutes === null || rawEndMinutes === null
            ? null
            : (rawEndMinutes <= startMinutes ? rawEndMinutes + (24 * 60) : rawEndMinutes);
        const durationMinutes = startMinutes === null || endMinutes === null
            ? 0
            : Math.max(0, endMinutes - startMinutes);
        const breakMinutes = Math.min(
            durationMinutes,
            Math.max(0, Number(segment.breakMinutes || 0))
        );
        return { segment, index, startMinutes, endMinutes, breakMinutes };
    }).filter(item => item.startMinutes !== null && item.endMinutes !== null)
        .sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);
    const plannedMinutes = segments.reduce((total, segment) => {
        const duration = scheduleSegmentDurationMinutes(segment.shiftStart, segment.shiftEnd);
        return total + (duration && duration > 0 ? Math.max(0, duration - Number(segment.breakMinutes || 0)) : 0);
    }, 0);
    const mergedTimeline = [];
    timeline.forEach(item => {
        const last = mergedTimeline[mergedTimeline.length - 1];
        if (!last || item.startMinutes >= last.endMinutes) {
            mergedTimeline.push({
                startMinutes: item.startMinutes,
                endMinutes: item.endMinutes,
                maxBreakMinutes: item.breakMinutes
            });
            return;
        }
        last.endMinutes = Math.max(last.endMinutes, item.endMinutes);
        // Overlapping source blocks describe the same physical presence. Break offsets
        // are not stored, so the summary must not subtract the same break per role/block.
        last.maxBreakMinutes = Math.max(last.maxBreakMinutes, item.breakMinutes);
    });
    const physicalMinutes = mergedTimeline.reduce(
        (total, item) => {
            const durationMinutes = Math.max(0, item.endMinutes - item.startMinutes);
            return total + Math.max(0, durationMinutes - Math.min(durationMinutes, item.maxBreakMinutes));
        },
        0
    );
    const additionalPaidMinutes = segments.reduce((total, segment) => {
        const duration = scheduleSegmentDurationMinutes(segment.shiftStart, segment.shiftEnd);
        if (!duration || duration <= 0) return total;
        const effectiveMinutes = Math.max(0, duration - Number(segment.breakMinutes || 0));
        const paidRoleCount = (segment.additionalRoles || [])
            .filter(role => role.compensationMode === 'paid_hourly')
            .length;
        return total + (effectiveMinutes * paidRoleCount);
    }, 0);
    const startMinutes = timeline[0]?.startMinutes ?? null;
    const endMinutes = timeline.length ? Math.max(...timeline.map(item => item.endMinutes)) : null;
    const occupiedMinutes = timeline.reduce((total, item) => total + Math.max(0, item.endMinutes - item.startMinutes), 0);
    const gapMinutes = startMinutes === null || endMinutes === null ? 0 : Math.max(0, (endMinutes - startMinutes) - occupiedMinutes);
    const roleKeys = [...new Set(segments.flatMap(segment => [segment.professionKey, ...(segment.additionalProfessionKeys || [])]).filter(Boolean))];
    const toTime = minutes => minutes === null ? '' : `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return {
        timeline,
        plannedMinutes,
        physicalMinutes,
        paidRoleMinutes: plannedMinutes + additionalPaidMinutes,
        gapMinutes,
        roleCount: roleKeys.length,
        envelopeStart: toTime(startMinutes),
        envelopeEnd: toTime(endMinutes)
    };
}

function scheduleOverlappingSegmentIndexes(timeline = []) {
    const indexes = new Set();
    for (let leftIndex = 0; leftIndex < timeline.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < timeline.length; rightIndex += 1) {
            const left = timeline[leftIndex];
            const right = timeline[rightIndex];
            if (left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes) {
                indexes.add(left.index);
                indexes.add(right.index);
            }
        }
    }
    return [...indexes].sort((left, right) => left - right);
}

const STAFF_SCHEDULE_PLAN_ERROR_MESSAGES = Object.freeze({
    HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION: 'Перерва має бути коротшою за тривалість сегмента',
    HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT: 'Нічний часовий блок без day offsets можна зберігати лише як єдиний блок дня'
});

function validateSchedulePlan(scope, options = {}) {
    const config = schedulePlanScopeConfig(scope);
    const status = document.getElementById(config.statusId)?.value || 'working';
    const working = schedulePlanIsWorkingStatus(status);
    const sourceSegments = working ? readSchedulePlanSegments(scope) : [];
    const paidNormalization = normalizeSchedulePaidRoleSegments(sourceSegments);
    const segments = paidNormalization.segments;
    const primaryProfessionKey = working
        ? normalizeProfessionKey(document.getElementById(config.primaryId)?.value || sourceSegments[0]?.professionKey)
        : null;
    const errors = [];
    const errorCodes = [];
    const fieldErrors = [];
    const addCodedError = (code, message) => {
        errorCodes.push(code);
        errors.push(message);
    };
    const addFieldError = (index, field, message) => {
        fieldErrors.push({ index, field, message });
        errors.push(`Блок ${index + 1}: ${message}`);
    };
    if (working && !sourceSegments.length) errors.push('Додайте хоча б один часовий блок.');
    if (sourceSegments.length > STAFF_SCHEDULE_MAX_SEGMENTS) errors.push(`Максимум ${STAFF_SCHEDULE_MAX_SEGMENTS} блоків на день.`);
    if (segments.length > STAFF_SCHEDULE_MAX_SEGMENTS) {
        errors.push(`Після поділу оплачуваного інтервалу утворюється понад ${STAFF_SCHEDULE_MAX_SEGMENTS} фізичних блоків.`);
    }
    const qualifiedStaff = options.staff || schedulePlanStaff(scope);
    const exactSegments = new Set();
    sourceSegments.forEach((segment, index) => {
        const label = `Блок ${index + 1}`;
        if (!segment.professionKey) addFieldError(index, 'profession', 'Оберіть професію.');
        if (!segment.shiftStart) addFieldError(index, 'start', 'Задайте коректний початок.');
        if (!segment.shiftEnd) addFieldError(index, 'end', 'Задайте коректне завершення.');
        const duration = scheduleSegmentDurationMinutes(segment.shiftStart, segment.shiftEnd);
        if (segment.shiftStart && segment.shiftStart === segment.shiftEnd) {
            addFieldError(index, 'end', 'Початок і завершення не можуть збігатися.');
        }
        if (duration !== null && Number(segment.breakMinutes || 0) >= duration) {
            fieldErrors.push({
                index,
                field: 'break',
                message: `${STAFF_SCHEDULE_PLAN_ERROR_MESSAGES.HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION}.`
            });
            addCodedError(
                'HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION',
                `${label}: ${STAFF_SCHEDULE_PLAN_ERROR_MESSAGES.HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION}.`
            );
        }
        if (Number(segment.breakMinutes || 0) < 0) addFieldError(index, 'break', 'Перерва не може бути від’ємною.');
        const additional = segment.additionalProfessionKeys || [];
        if (additional.includes(segment.professionKey)) {
            addFieldError(index, 'paid-profession', 'Основну професію не можна дублювати як додаткову.');
        }
        const roles = [segment.professionKey, ...additional].filter(Boolean);
        const invalidRole = roles.find(role => qualifiedStaff.some(staff => !staffHasProfession(staff, role)));
        if (invalidRole) {
            addFieldError(index, 'paid-profession', `Професія «${professionLabel(invalidRole)}» відсутня в HR-картці одного з вибраних працівників.`);
        }
        const paidRoles = (segment.additionalRoles || [])
            .filter(role => role.compensationMode === 'paid_hourly');
        if (paidRoles.length > 1) {
            addCodedError('HR_SHIFT_PAID_ROLE_LIMIT_EXCEEDED', `${label}: дозволена максимум одна оплачувана додаткова професія.`);
            fieldErrors.push({ index, field: 'paid-profession', message: 'Дозволена максимум одна оплачувана додаткова професія.' });
        }
        const paidRole = paidRoles[0];
        if (paidRole) {
            if (Number(paidRole.payMultiplier) !== 1) {
                addCodedError('HR_SHIFT_PAID_ROLE_POLICY_INVALID', `${label}: для чинної політики multiplier має дорівнювати 1.0.`);
                fieldErrors.push({ index, field: 'paid-profession', message: 'Для чинної політики multiplier має дорівнювати 1.0.' });
            }
            const rateInfo = schedulePaidRoleRate(scope, paidRole.professionKey);
            if (!rateInfo.available) {
                addCodedError(
                    'HR_SHIFT_PAID_ROLE_RATE_REQUIRED',
                    `${label}: ${professionLabel(paidRole.professionKey)} — ${rateInfo.reason}`
                );
                fieldErrors.push({
                    index,
                    field: 'paid-profession',
                    message: `${professionLabel(paidRole.professionKey)} — ${rateInfo.reason}`
                });
            }
            if (!paidRole.intervalStart) addFieldError(index, 'paid-start', 'Задайте початок додаткової оплати.');
            if (!paidRole.intervalEnd) addFieldError(index, 'paid-end', 'Задайте завершення додаткової оплати.');
        }
        const exactKey = [segment.professionKey, segment.shiftStart, segment.shiftEnd].join('|');
        if (exactSegments.has(exactKey)) errors.push(`${label}: точний дубль іншого блоку.`);
        exactSegments.add(exactKey);
    });
    paidNormalization.errors.forEach(error => addFieldError(error.index, error.field, error.message));
    const overnightSegments = sourceSegments.filter(segment => {
        const start = scheduleTimeToMinutes(segment.shiftStart);
        const end = scheduleTimeToMinutes(segment.shiftEnd);
        return start !== null && end !== null && end < start;
    });
    if (sourceSegments.length > 1 && overnightSegments.length > 0) {
        addCodedError(
            'HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT',
            `${STAFF_SCHEDULE_PLAN_ERROR_MESSAGES.HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT}.`
        );
    }
    const metrics = schedulePlanMetrics(segments);
    const sourceMetrics = schedulePlanMetrics(sourceSegments);
    const overlapIndexes = scheduleOverlappingSegmentIndexes(sourceMetrics.timeline);
    let overlapCandidate = null;
    let overlapConversionBlocker = '';
    if (overlapIndexes.length) {
        errors.push('Для одночасної роботи використайте оплачувану додаткову роль, а не другий блок');
        const overlapConversion = scheduleOverlapConversionAnalysis(sourceSegments);
        overlapCandidate = overlapConversion.candidate;
        overlapConversionBlocker = overlapConversion.blocker;
        if (overlapConversionBlocker) errors.push(overlapConversionBlocker);
    }
    if (working && (!primaryProfessionKey || !segments.some(segment => segment.professionKey === primaryProfessionKey))) {
        errors.push('Основна роль дня має бути основною професією одного з блоків.');
    }
    return {
        valid: errors.length === 0,
        errors: [...new Set(errors)],
        errorCodes: [...new Set(errorCodes)],
        fieldErrors,
        overlapIndexes,
        overlapCandidate,
        overlapConversionBlocker,
        sourceSegments,
        segments,
        primaryProfessionKey,
        metrics,
        status
    };
}

function updateSchedulePlanPrimaryOptions(scope, preferredValue = '') {
    const config = schedulePlanScopeConfig(scope);
    const select = document.getElementById(config.primaryId);
    if (!select) return;
    const current = normalizeProfessionKey(preferredValue || select.value);
    const professionKeys = [...new Set(readSchedulePlanSegments(scope).map(segment => segment.professionKey).filter(Boolean))];
    select.innerHTML = professionKeys.length
        ? professionKeys.map(key => `<option value="${escapeHtml(key)}" ${key === current ? 'selected' : ''}>${escapeHtml(professionLabel(key))}</option>`).join('')
        : '<option value="">Немає ролей у блоках</option>';
    if (professionKeys.length && !professionKeys.includes(select.value)) select.value = professionKeys[0];
}

function updateSchedulePaidRolePreviews(scope) {
    const config = schedulePlanScopeConfig(scope);
    document.querySelectorAll(`#${config.listId} .sch-segment-card`).forEach(card => {
        const preview = card.querySelector('[data-paid-role-preview]');
        if (!preview) return;
        const segment = {
            shiftStart: normalizeSchedulePlanTime(card.querySelector('[data-segment-field="start"]')?.value),
            shiftEnd: normalizeSchedulePlanTime(card.querySelector('[data-segment-field="end"]')?.value)
        };
        const professionKey = normalizeProfessionKey(card.querySelector('[data-segment-field="paid-profession"]')?.value);
        const role = professionKey ? {
            professionKey,
            intervalStart: normalizeSchedulePlanTime(card.querySelector('[data-segment-field="paid-start"]')?.value),
            intervalEnd: normalizeSchedulePlanTime(card.querySelector('[data-segment-field="paid-end"]')?.value),
            payMultiplier: Number(card.querySelector('[data-segment-field="paid-multiplier"]')?.value || 1)
        } : null;
        preview.textContent = schedulePaidRolePreview(scope, role, segment);
    });
}

function applySchedulePlanFieldErrors(scope, fieldErrors = []) {
    const config = schedulePlanScopeConfig(scope);
    const list = document.getElementById(config.listId);
    if (!list) return;
    list.querySelectorAll('.sch-field-error').forEach(node => {
        node.textContent = '';
        node.hidden = true;
    });
    list.querySelectorAll('[data-segment-field]').forEach(control => {
        control.removeAttribute('aria-invalid');
        control.removeAttribute('aria-describedby');
        control.closest('.form-group')?.classList.remove('has-error');
    });
    fieldErrors.forEach(error => {
        const card = list.querySelector(`[data-segment-index="${Number(error.index)}"]`);
        const control = card?.querySelector(`[data-segment-field="${error.field}"]`);
        const message = card?.querySelector(`[data-field-error="${error.field}"]`);
        if (!control || !message) return;
        message.hidden = false;
        message.textContent = error.message;
        if (!message.id) message.id = `${control.id || `${scope}-field`}-error`;
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', message.id);
        control.closest('.form-group')?.classList.add('has-error');
    });
}

function applySchedulePlanOverlapState(scope, overlapIndexes = [], descriptionId = '') {
    const config = schedulePlanScopeConfig(scope);
    const list = document.getElementById(config.listId);
    if (!list) return;
    list.querySelectorAll('.sch-segment-card').forEach(card => {
        card.classList.remove('has-overlap');
        card.removeAttribute('aria-invalid');
        card.removeAttribute('aria-describedby');
    });
    overlapIndexes.forEach(index => {
        const card = list.querySelector(`[data-segment-index="${Number(index)}"]`);
        if (!card) return;
        card.classList.add('has-overlap');
        card.setAttribute('aria-invalid', 'true');
        if (descriptionId) card.setAttribute('aria-describedby', descriptionId);
    });
}

function updateScheduleSaveValidation(scope, validation) {
    const config = schedulePlanScopeConfig(scope);
    const saveButton = document.getElementById(config.saveButtonId);
    const actions = typeof saveButton?.closest === 'function'
        ? saveButton.closest('.modal-actions')
        : null;
    if (!saveButton || !actions) return;
    let message = actions.querySelector('[data-schedule-save-validation]');
    if (!message) {
        message = document.createElement('div');
        message.className = 'sch-save-validation';
        message.dataset.scheduleSaveValidation = '';
        message.setAttribute('role', 'status');
        message.setAttribute('aria-live', 'polite');
        actions.prepend(message);
    }
    if (!message.id) message.id = `${scope}-save-validation`;
    const overlapError = validation.overlapIndexes?.length
        ? 'Для одночасної роботи використайте оплачувану додаткову роль, а не другий блок'
        : '';
    const firstError = overlapError || validation.errors[0] || '';
    message.hidden = !firstError;
    message.textContent = firstError;
    actions.classList.toggle('has-validation-message', Boolean(firstError));
    return message.id;
}

function bindScheduleOverlapConversionControls(scope, summary) {
    const config = schedulePlanScopeConfig(scope);
    const breakTarget = summary?.querySelector('[data-schedule-overlap-break-target]');
    const convertButton = summary?.querySelector('[data-schedule-overlap-convert]');
    if (!convertButton) return;
    breakTarget?.addEventListener('change', () => {
        const conversion = breakTarget.closest('.sch-overlap-conversion');
        convertButton.disabled = conversion?.dataset.rateAvailable !== 'true' || !breakTarget.value;
    });
    convertButton.addEventListener('click', () => {
        const validation = validateSchedulePlan(scope);
        const breakTargetKey = breakTarget?.value || '';
        const converted = convertScheduleOverlap(scope, validation.overlapCandidate, breakTargetKey);
        if (!converted) {
            updateSchedulePlanSummary(scope);
            return;
        }
        const candidate = validation.overlapCandidate;
        const primaryProfessionKey = validation.primaryProfessionKey || converted[0]?.professionKey || '';
        renderSchedulePlanEditor(scope, converted, {
            primaryProfessionKey,
            activeIndex: Math.max(0, Math.min(candidate?.baseIndex || 0, converted.length - 1))
        });
        const list = document.getElementById(config.listId);
        const paidCard = Array.from(list?.querySelectorAll('.sch-segment-card') || [])
            .find(item => item.querySelector('[data-segment-field="paid-profession"]')?.value);
        paidCard?.querySelector('[data-segment-field="paid-profession"]')?.focus();
    });
}

function updateSchedulePlanSummary(scope) {
    const config = schedulePlanScopeConfig(scope);
    const summary = document.getElementById(config.summaryId);
    const validation = validateSchedulePlan(scope);
    if (summary) {
        const metrics = validation.metrics;
        const envelope = metrics.envelopeStart && metrics.envelopeEnd
            ? `${metrics.envelopeStart}–${metrics.envelopeEnd}`
            : '—';
        const hasOverlap = validation.overlapIndexes.length > 0;
        const paidRoleHours = hasOverlap
            ? '—'
            : formatScheduleMinutes(metrics.paidRoleMinutes);
        summary.classList.toggle('has-error', !validation.valid);
        summary.innerHTML = `
            <div class="sch-plan-summary-metrics">
                <span><b>${escapeHtml(envelope)}</b> Період дня</span>
                <span><b>${escapeHtml(formatScheduleMinutes(metrics.physicalMinutes))}</b> Фізичний час</span>
                <span class="${hasOverlap ? 'is-unavailable' : ''}">
                    <b>${escapeHtml(paidRoleHours)}</b>
                    Оплачувані роль-години
                    ${hasOverlap ? '<small>після нормалізації</small>' : ''}
                </span>
                <span><b>${metrics.roleCount}</b> Ролей</span>
            </div>
            ${validation.errors.length ? `<ul>${validation.errors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}</ul>` : '<div class="sch-plan-valid">План дня коректний.</div>'}
            ${validation.overlapCandidate ? (() => {
                const candidate = validation.overlapCandidate;
                const rateInfo = schedulePaidRoleRate(scope, candidate.professionKey);
                const needsBreakChoice = Number(candidate.breakMinutes || 0) > 0;
                const disabled = !rateInfo.available || needsBreakChoice;
                const reason = !rateInfo.available ? rateInfo.reason : '';
                const breakChoiceId = `${scope}-overlap-break-target`;
                const breakChoice = needsBreakChoice
                    ? `<label for="${escapeHtml(breakChoiceId)}">Куди перенести перерву ${Number(candidate.breakMinutes)} хв</label>
                        <select id="${escapeHtml(breakChoiceId)}" data-schedule-overlap-break-target>
                            <option value="">Оберіть нормалізований сегмент</option>
                            ${(candidate.breakTargets || []).map(option =>
                                `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`).join('')}
                        </select>
                        <span>Перерва не буде розподілена автоматично: вибір застосовується лише після натискання кнопки конвертації.</span>`
                    : '';
                return `<div class="sch-overlap-conversion" data-rate-available="${rateInfo.available ? 'true' : 'false'}">
                    ${breakChoice}
                    <button type="button" class="btn-page-secondary" data-schedule-overlap-convert ${disabled ? 'disabled' : ''}>
                        Перетворити на одночасні ролі
                    </button>
                    ${reason
                        ? `<span>${escapeHtml(reason)}</span>`
                        : `<span>${candidate.kind === 'partial' ? 'Частковий перетин' : 'Вкладений інтервал'} · ${escapeHtml(professionLabel(candidate.professionKey))}: ${escapeHtml(candidate.start)}–${escapeHtml(candidate.end)} · ліміт v1: одна paid additional role.</span>`}
                </div>`;
            })() : (validation.overlapConversionBlocker
                ? `<div class="sch-overlap-conversion is-blocked" data-schedule-overlap-blocker role="note">
                    <strong>Автоматична конвертація недоступна</strong>
                    <span>${escapeHtml(validation.overlapConversionBlocker)}</span>
                </div>`
                : '')}`;
        bindScheduleOverlapConversionControls(scope, summary);
    }
    applySchedulePlanFieldErrors(scope, validation.fieldErrors);
    updateSchedulePaidRolePreviews(scope);
    const saveButton = document.getElementById(config.saveButtonId);
    if (saveButton) {
        const pending = scope === 'schedule'
            ? Boolean(StaffState.editingCell?.mutationPending || StaffState.editingCell?.shiftPreferencesLoading)
            : _staffFillMutationPending;
        const readOnly = scope === 'schedule' && !StaffState.canManage;
        saveButton.disabled = pending || readOnly || !validation.valid;
    }
    const validationMessageId = updateScheduleSaveValidation(scope, validation);
    applySchedulePlanOverlapState(scope, validation.overlapIndexes, validationMessageId);
    return validation;
}

function renderSchedulePlanEditor(scope, rawSegments = [], options = {}) {
    const config = schedulePlanScopeConfig(scope);
    const list = document.getElementById(config.listId);
    if (!list) return;
    const status = document.getElementById(config.statusId)?.value || 'working';
    let segments = (Array.isArray(rawSegments) ? rawSegments : [])
        .map(segment => normalizeScheduleSegmentForUi(segment, '', { scope, date: options.date }));
    if (schedulePlanIsWorkingStatus(status) && !segments.length) {
        segments = [createSchedulePlanSegment(scope, { date: options.date })];
    }
    const activeIndex = Math.min(Math.max(0, Number(options.activeIndex ?? list.dataset.activeSegmentIndex ?? 0)), Math.max(0, segments.length - 1));
    list.dataset.activeSegmentIndex = String(activeIndex);
    list.innerHTML = segments.map((segment, index) => renderSchedulePlanSegmentCard(scope, segment, index, segments.length)).join('');
    const activeCard = list.querySelector(`[data-segment-index="${activeIndex}"]`);
    activeCard?.classList.add('is-active');
    updateSchedulePlanPrimaryOptions(scope, options.primaryProfessionKey);
    updateSchedulePlanSummary(scope);
}

function getActiveScheduleSegmentCard() {
    const list = document.getElementById('schSegmentsList');
    const activeIndex = Number(list?.dataset.activeSegmentIndex || 0);
    const card = list?.querySelector(`[data-segment-index="${activeIndex}"]`) || list?.querySelector('.sch-segment-card');
    if (card) return card;
    return {
        querySelector(selector) {
            if (selector.includes('profession')) return document.getElementById('schProfession');
            if (selector.includes('start')) return document.getElementById('schStart');
            if (selector.includes('end')) return document.getElementById('schEnd');
            return null;
        }
    };
}

function handleSchedulePlanProfessionChange() {
    const editing = StaffState.editingCell;
    if (!editing) return;
    const cachedPreferences = StaffState.shiftPreferences[Number(editing.staffId)];
    const preferences = Array.isArray(cachedPreferences) ? cachedPreferences : [];
    renderScheduleShiftPreferencePanel(preferences, { autoApply: 'force' });
    if (!Array.isArray(cachedPreferences)) {
        loadScheduleShiftPreferences(editing.staffId, { force: true, autoApply: 'force' });
    }
}

function bindSchedulePlanEditor(scope) {
    const config = schedulePlanScopeConfig(scope);
    const editor = document.getElementById(config.editorId);
    if (!editor || editor.dataset.segmentEditorBound === 'true') return;
    const list = document.getElementById(config.listId);
    const rerender = (segments, options = {}) => renderSchedulePlanEditor(scope, segments, options);
    editor.addEventListener('focusin', event => {
        const card = event.target.closest?.('.sch-segment-card');
        if (!card || !list?.contains(card)) return;
        list.dataset.activeSegmentIndex = card.dataset.segmentIndex || '0';
        list.querySelectorAll('.sch-segment-card').forEach(item => item.classList.toggle('is-active', item === card));
        if (scope === 'schedule' && event.target.matches('[data-segment-field="profession"]')) {
            const preferences = StaffState.shiftPreferences[Number(StaffState.editingCell?.staffId)] || [];
            renderScheduleShiftPreferencePanel(preferences);
        }
    });
    editor.addEventListener('input', event => {
        if (!event.target.matches('[data-segment-field]')) return;
        updateSchedulePlanPrimaryOptions(scope);
        updateSchedulePlanSummary(scope);
    });
    editor.addEventListener('change', event => {
        if (!event.target.matches('[data-segment-field]')) return;
        const card = event.target.closest('.sch-segment-card');
        if (card && list) list.dataset.activeSegmentIndex = card.dataset.segmentIndex || '0';
        if (event.target.matches('[data-segment-field="paid-profession"]')) {
            const primaryValue = document.getElementById(config.primaryId)?.value || '';
            const activeIndex = Number(card?.dataset.segmentIndex || 0);
            const segments = readSchedulePlanSegments(scope);
            rerender(segments, { primaryProfessionKey: primaryValue, activeIndex });
            const nextCard = list?.querySelector(`[data-segment-index="${activeIndex}"]`);
            const paidProfession = nextCard?.querySelector('[data-segment-field="paid-profession"]')?.value;
            const focusTarget = paidProfession
                ? nextCard?.querySelector('[data-segment-field="paid-start"]')
                : nextCard?.querySelector('[data-segment-field="paid-profession"]');
            focusTarget?.focus();
            return;
        }
        if (event.target.matches('[data-segment-field="profession"]')) {
            const primaryValue = document.getElementById(config.primaryId)?.value || '';
            const segments = readSchedulePlanSegments(scope).map(segment => ({
                ...segment,
                additionalRoles: (segment.additionalRoles || [])
                    .filter(role => role.professionKey !== segment.professionKey),
                additionalProfessionKeys: segment.additionalProfessionKeys.filter(key => key !== segment.professionKey)
            }));
            rerender(segments, { primaryProfessionKey: primaryValue, activeIndex: Number(card?.dataset.segmentIndex || 0) });
            if (scope === 'schedule') handleSchedulePlanProfessionChange();
            return;
        }
        updateSchedulePlanPrimaryOptions(scope);
        updateSchedulePlanSummary(scope);
    });
    editor.addEventListener('click', event => {
        const addButton = event.target.closest(`#${config.addButtonId}`);
        if (addButton) {
            const segments = readSchedulePlanSegments(scope);
            if (segments.length >= STAFF_SCHEDULE_MAX_SEGMENTS) {
                showNotification(`Максимум ${STAFF_SCHEDULE_MAX_SEGMENTS} блоків на день`, 'error');
                return;
            }
            segments.push(createSchedulePlanSegment(scope));
            rerender(segments, { activeIndex: segments.length - 1 });
            document.getElementById(schedulePlanFieldId(scope, 'profession', segments.length - 1, segments[segments.length - 1].clientKey))?.focus();
            return;
        }
        const actionButton = event.target.closest('[data-segment-action]');
        if (!actionButton) return;
        const card = actionButton.closest('.sch-segment-card');
        const index = Number(card?.dataset.segmentIndex);
        const segments = readSchedulePlanSegments(scope);
        if (!Number.isInteger(index) || !segments[index]) return;
        const primaryProfessionKey = document.getElementById(config.primaryId)?.value || '';
        if (actionButton.dataset.segmentAction === 'remove') segments.splice(index, 1);
        if (actionButton.dataset.segmentAction === 'up' && index > 0) [segments[index - 1], segments[index]] = [segments[index], segments[index - 1]];
        if (actionButton.dataset.segmentAction === 'down' && index < segments.length - 1) [segments[index + 1], segments[index]] = [segments[index], segments[index + 1]];
        const nextIndex = actionButton.dataset.segmentAction === 'up' ? index - 1
            : actionButton.dataset.segmentAction === 'down' ? index + 1
                : Math.min(index, Math.max(0, segments.length - 1));
        rerender(segments, { primaryProfessionKey, activeIndex: nextIndex });
    });
    document.getElementById(config.primaryId)?.addEventListener('change', () => updateSchedulePlanSummary(scope));
    editor.dataset.segmentEditorBound = 'true';
}

function scheduleEditingCellMatches(staffId, date, rangeKey = '') {
    const editing = StaffState.editingCell;
    const overlay = document.getElementById('schModalOverlay');
    return Boolean(
        editing
        && overlay?.classList.contains('visible')
        && Number(editing.staffId) === Number(staffId)
        && String(editing.date || '') === String(date || '')
        && (!rangeKey || editing.rangeKey === rangeKey)
    );
}

function scheduleModalSessionIsCurrent(session) {
    return Boolean(session && StaffState.editingCell === session);
}

function setScheduleModalMutationControlsDisabled(disabled) {
    ['schSaveBtn', 'schReplaceBtn', 'schClearReplacementBtn'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.disabled = disabled;
    });
}

function beginScheduleModalMutation(session) {
    if (!scheduleModalSessionIsCurrent(session) || session.mutationPending) return false;
    session.mutationPending = true;
    const overlay = document.getElementById('schModalOverlay');
    overlay?.setAttribute?.('aria-busy', 'true');
    setScheduleModalMutationControlsDisabled(true);
    return true;
}

function finishScheduleModalMutation(session) {
    if (!session) return;
    session.mutationPending = false;
    if (!scheduleModalSessionIsCurrent(session) && StaffState.editingCell) return;
    const overlay = document.getElementById('schModalOverlay');
    overlay?.setAttribute?.('aria-busy', 'false');
    setScheduleModalMutationControlsDisabled(false);
    if (document.getElementById('schPlanSummary')) updateSchedulePlanSummary('schedule');
}

function scheduleCellFocusTarget(staffId, date, fallback = null, departmentKey = '') {
    const normalizedDepartment = normalizeScheduleDisplayGroupKey(
        departmentKey || fallback?.dataset?.scheduleDepartment || ''
    );
    const departmentSelector = normalizedDepartment
        ? `[data-schedule-department="${normalizedDepartment}"]`
        : '';
    const selector = `.sch-cell[data-staff="${Number(staffId)}"][data-date="${String(date || '')}"]${departmentSelector}`;
    return document.querySelector(selector)
        || (fallback?.isConnected ? fallback : null)
        || document.getElementById('scheduleStaffSearch')
        || document.getElementById('scheduleWrapper');
}

const SCHEDULE_SHIFT_PREFERENCE_DAY_LABELS = {
    weekday: 'ПН-ПТ',
    weekend: 'СБ-НД'
};
const SCHEDULE_SHIFT_PREFERENCE_DAY_TYPES = ['weekday', 'weekend'];
const SCHEDULE_SHIFT_PREFERENCE_DEFAULTS = Object.freeze({
    default: Object.freeze({
        weekday: Object.freeze({ startTime: '11:00', endTime: '20:00' }),
        weekend: Object.freeze({ startTime: '09:00', endTime: '20:00' })
    }),
    animator: Object.freeze({
        weekday: Object.freeze({ startTime: '12:00', endTime: '20:00' }),
        weekend: Object.freeze({ startTime: '10:00', endTime: '20:00' })
    }),
    instructor: Object.freeze({
        weekday: Object.freeze({ startTime: '11:00', endTime: '20:00' }),
        weekend: Object.freeze({ startTime: '09:00', endTime: '20:00' })
    }),
    trampoline_instructor: Object.freeze({
        weekday: Object.freeze({ startTime: '11:00', endTime: '20:00' }),
        weekend: Object.freeze({ startTime: '09:00', endTime: '20:00' })
    }),
    senior_instructor: Object.freeze({
        weekday: Object.freeze({ startTime: '11:00', endTime: '20:00' }),
        weekend: Object.freeze({ startTime: '09:00', endTime: '20:00' })
    })
});

function scheduleShiftPreferenceDayType(date) {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return 'weekday';
    const day = parsed.getDay();
    return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

function normalizeScheduleShiftPreferenceTime(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return '';
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeScheduleShiftPreference(row = {}) {
    const professionKey = normalizeProfessionKey(row.profession_key || row.professionKey);
    const dayType = String(row.day_type || row.dayType || '').trim().toLowerCase();
    const startTime = normalizeScheduleShiftPreferenceTime(row.start_time || row.startTime);
    const endTime = normalizeScheduleShiftPreferenceTime(row.end_time || row.endTime);
    if (!professionKey || !SCHEDULE_SHIFT_PREFERENCE_DAY_LABELS[dayType] || !startTime || !endTime) return null;
    if (row.is_active === false || row.isActive === false) return null;
    return {
        professionKey,
        dayType,
        startTime,
        endTime,
        source: row.source === 'fallback' ? 'fallback' : 'saved'
    };
}

function fallbackScheduleShiftPreference(professionKey, dayType) {
    const normalizedProfession = normalizeProfessionKey(professionKey);
    const normalizedDayType = SCHEDULE_SHIFT_PREFERENCE_DAY_LABELS[dayType] ? dayType : 'weekday';
    const professionDefaults = SCHEDULE_SHIFT_PREFERENCE_DEFAULTS[normalizedProfession]
        || SCHEDULE_SHIFT_PREFERENCE_DEFAULTS.default;
    const times = professionDefaults[normalizedDayType]
        || SCHEDULE_SHIFT_PREFERENCE_DEFAULTS.default[normalizedDayType]
        || SCHEDULE_SHIFT_PREFERENCE_DEFAULTS.default.weekday;
    return {
        professionKey: normalizedProfession,
        dayType: normalizedDayType,
        startTime: times.startTime,
        endTime: times.endTime,
        source: 'fallback'
    };
}

function scheduleShiftPreferencesForCurrentProfession(preferences = []) {
    const professionKey = normalizeProfessionKey(getActiveScheduleSegmentCard()?.querySelector('[data-segment-field="profession"]')?.value);
    if (!professionKey) return [];
    return scheduleShiftPreferencesForProfession(preferences, professionKey);
}

async function fetchScheduleShiftPreferences(staffId, options = {}) {
    const numericStaffId = Number(staffId);
    if (!numericStaffId) return { success: false, data: [] };
    if (!options.force && Array.isArray(StaffState.shiftPreferences[numericStaffId])) {
        return { success: true, data: StaffState.shiftPreferences[numericStaffId] };
    }
    try {
        const res = await staffApiFetch(`/api/staff/${encodeURIComponent(numericStaffId)}/shift-preferences`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
            return { success: false, data: [], error: data?.error || `HTTP ${res.status}` };
        }
        return { success: true, data: Array.isArray(data.data) ? data.data : [] };
    } catch (err) {
        console.error('fetchScheduleShiftPreferences error:', err);
        return { success: false, data: [] };
    }
}

async function ensureScheduleShiftPreferencesForStaff(staffList = [], options = {}) {
    const failures = [];
    await Promise.all((Array.isArray(staffList) ? staffList : []).map(async staff => {
        const staffId = normalizeScheduleStaffId(staff?.id);
        if (!staffId) return;
        const result = await fetchScheduleShiftPreferences(staffId, { force: options.force });
        if (result?.success) {
            StaffState.shiftPreferences[staffId] = Array.isArray(result.data) ? result.data : [];
            return;
        }
        failures.push(scheduleStaffDisplayName(staff) || `ID ${staffId}`);
    }));
    return {
        success: failures.length === 0,
        failures
    };
}

function scheduleSegmentWithShiftPreference(segment = {}, preferences = [], date = '') {
    const preference = scheduleShiftPreferenceForProfessionDate(preferences, segment.professionKey, date);
    return {
        ...segment,
        shiftStart: preference.startTime || segment.shiftStart,
        shiftEnd: preference.endTime || segment.shiftEnd,
        additionalRoles: (segment.additionalRoles || []).map(role => ({ ...role })),
        additionalProfessionKeys: [...(segment.additionalProfessionKeys || [])]
    };
}

function scheduleSegmentsWithShiftPreferences(segments = [], preferences = [], date = '') {
    return (Array.isArray(segments) ? segments : [])
        .map(segment => scheduleSegmentWithShiftPreference(segment, preferences, date));
}

function applyScheduleShiftPreference(preference = {}) {
    const normalized = normalizeScheduleShiftPreference(preference);
    if (!normalized) return false;
    const status = document.getElementById('schStatus');
    if (status && !['working', 'remote'].includes(status.value)) {
        status.value = 'working';
        toggleTimeFields();
    }
    const activeCard = getActiveScheduleSegmentCard();
    const start = activeCard?.querySelector('[data-segment-field="start"]');
    const end = activeCard?.querySelector('[data-segment-field="end"]');
    if (start) start.value = normalized.startTime;
    if (end) end.value = normalized.endTime;
    setScheduleShiftPreferenceActiveDay(normalized.dayType);
    updateSchedulePlanSummary('schedule');
    return true;
}

function setScheduleShiftPreferenceActiveDay(dayType = '') {
    const activeDayType = String(dayType || '').trim().toLowerCase();
    document.querySelectorAll('#schShiftPreferencePanel .sch-shift-preference-option').forEach(button => {
        const isActive = button.dataset.shiftPrefDay === activeDayType;
        button.classList.toggle('is-recommended', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function applyRecommendedScheduleShiftPreference(preferences = [], mode = false, options = {}) {
    if (!mode || !StaffState.canManage) return;
    const editing = StaffState.editingCell;
    if (!editing) return;
    if (options.onlyIfState && getStaffScheduleState() !== options.onlyIfState) return;
    const current = scheduleShiftPreferencesForCurrentProfession(preferences);
    if (!current.length) return;
    if (mode === 'missing-only') {
        const entry = editing.entry || StaffState.schedule[`${editing.staffId}_${editing.date}`];
        if (entry?.shift_start || entry?.shift_end) return;
    }
    const dayType = scheduleShiftPreferenceDayType(editing.date);
    const recommended = current.find(row => row.dayType === dayType);
    if (recommended && applyScheduleShiftPreference(recommended) && options.resetInitialState) {
        _staffScheduleInitialState = getStaffScheduleState();
    }
}

function renderScheduleShiftPreferencePanel(preferences = [], options = {}) {
    const panel = document.getElementById('schShiftPreferencePanel');
    if (!panel) return;
    const status = document.getElementById('schStatus')?.value || 'working';
    if (!['working', 'remote'].includes(status)) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
    }
    const editing = StaffState.editingCell;
    const professionKey = normalizeProfessionKey(getActiveScheduleSegmentCard()?.querySelector('[data-segment-field="profession"]')?.value);
    if (!editing || !professionKey) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
    }
    const current = scheduleShiftPreferencesForCurrentProfession(preferences);
    const activeDayType = scheduleShiftPreferenceDayType(editing.date);
    const usesFallback = current.some(row => row.source === 'fallback');
    panel.hidden = false;
    if (!current.length) {
        panel.innerHTML = `
            <div class="sch-shift-preferences-head">
                <strong>Типові зміни з картки</strong>
                <span>${escapeHtml(professionLabel(professionKey))}</span>
            </div>
            <div class="sch-shift-preferences-empty">Для цієї професії немає збережених типових змін у картці співробітника.</div>
        `;
        return;
    }
    panel.innerHTML = `
        <div class="sch-shift-preferences-head">
            <strong>Типові зміни з картки</strong>
            <span>${escapeHtml(professionLabel(professionKey))} · ${usesFallback ? 'є fallback' : 'збережено'}</span>
        </div>
        <div class="sch-shift-preference-options">
            ${current.map(row => `
                <button type="button" class="sch-shift-preference-option ${row.dayType === activeDayType ? 'is-recommended' : ''}" data-shift-pref-day="${escapeHtml(row.dayType)}" data-shift-pref-start="${escapeHtml(row.startTime)}" data-shift-pref-end="${escapeHtml(row.endTime)}" data-shift-pref-source="${escapeHtml(row.source)}" aria-pressed="${row.dayType === activeDayType ? 'true' : 'false'}" ${StaffState.canManage ? '' : 'disabled'}>
                    <strong>${escapeHtml(SCHEDULE_SHIFT_PREFERENCE_DAY_LABELS[row.dayType] || row.dayType)}</strong>
                    <span>${escapeHtml(row.startTime)}-${escapeHtml(row.endTime)}</span>
                    <small>${row.source === 'fallback' ? 'Fallback' : 'Збережено'}</small>
                </button>
            `).join('')}
        </div>
    `;
    applyRecommendedScheduleShiftPreference(preferences, options.autoApply, options);
}

function renderScheduleShiftPreferenceLoading() {
    const panel = document.getElementById('schShiftPreferencePanel');
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = `
        <div class="sch-shift-preferences-head">
            <strong>Типові зміни з картки</strong>
            <span>Завантажуються...</span>
        </div>
    `;
}

async function loadScheduleShiftPreferences(staffId, options = {}) {
    const numericStaffId = Number(staffId);
    const requestedEditing = StaffState.editingCell;
    const requestedDate = String(requestedEditing?.date || '');
    const requestedRangeKey = requestedEditing?.rangeKey || '';
    const seq = ++StaffState.shiftPreferencesLoadSeq;
    if (requestedEditing) {
        requestedEditing.shiftPreferencesLoading = true;
        requestedEditing.shiftPreferencesLoadFailed = false;
        updateSchedulePlanSummary('schedule');
    }
    renderScheduleShiftPreferenceLoading();
    const result = await fetchScheduleShiftPreferences(numericStaffId, { force: options.force });
    if (seq !== StaffState.shiftPreferencesLoadSeq
        || !scheduleEditingCellMatches(numericStaffId, requestedDate, requestedRangeKey)) return result;
    if (!result?.success) {
        if (requestedEditing) {
            requestedEditing.shiftPreferencesLoading = false;
            requestedEditing.shiftPreferencesLoadFailed = true;
            updateSchedulePlanSummary('schedule');
        }
        renderScheduleShiftPreferencePanel([], {
            autoApply: options.autoApply,
            onlyIfState: options.onlyIfState,
            resetInitialState: options.resetInitialState
        });
        return result;
    }
    StaffState.shiftPreferences[numericStaffId] = result.data;
    if (requestedEditing) {
        requestedEditing.shiftPreferencesLoading = false;
        requestedEditing.shiftPreferencesLoadFailed = false;
    }
    renderScheduleShiftPreferencePanel(result.data || [], {
        autoApply: options.autoApply,
        onlyIfState: options.onlyIfState,
        resetInitialState: options.resetInitialState
    });
    updateSchedulePlanSummary('schedule');
    return result;
}

function getStaffScheduleState() {
    const fields = ['schStatus', 'schPrimaryProfession', 'schNote'].map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
    return `${fields}|segments:${JSON.stringify(readSchedulePlanSegments('schedule'))}`;
}

function getStaffFillState() {
    const dayState = Array.from(document.querySelectorAll('#fillDaysRow input[type=checkbox]')).map(cb => cb.checked ? '1' : '0').join('');
    const fields = ['fillStaffSelect', 'fillStatus', 'fillPrimaryProfession', 'fillNote'].map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
    return `${fields}|segments:${JSON.stringify(readSchedulePlanSegments('fill'))}|days:${dayState}`;
}

function scheduleEntryPlanUpdatedAt(entry = null) {
    return entry?.planUpdatedAt
        || entry?.plan_updated_at
        || entry?.hrShiftUpdatedAt
        || entry?.hr_shift_updated_at
        || null;
}

function openEditModal(staffId, date, options = {}) {
    if (_staffScheduleClosePromise || StaffState.editingCell?.mutationPending) return;
    if (!scheduleRangeDataReady()) return;
    const emp = StaffState.staff.find(s => s.id === staffId);
    if (!emp) return;
    if (StaffState.canManage && !isScheduleableStaffForUi(emp, date)) {
        showNotification(scheduleableStaffErrorMessage({ code: 'STAFF_NOT_SCHEDULEABLE' }), 'error');
        return;
    }

    const entry = StaffState.schedule[`${staffId}_${date}`];
    const sectionDepartment = normalizeScheduleDisplayGroupKey(options.department || '');
    const sectionProfessionKey = normalizeProfessionKey(options.professionKey);
    StaffState.editingCell = {
        staffId,
        date,
        entry,
        sectionDepartment,
        sectionProfessionKey,
        rangeKey: scheduleCommittedRangeKey(),
        sessionId: ++StaffState.scheduleModalSessionSeq,
        mutationPending: false,
        shiftPreferencesLoading: StaffState.canManage
            && !Array.isArray(StaffState.shiftPreferences[staffId])
            && !entry?.shift_start
            && !entry?.shift_end,
        shiftPreferencesLoadFailed: false,
        planUpdatedAt: scheduleEntryPlanUpdatedAt(entry),
        staleConflict: null
    };

    document.getElementById('schModalTitle').textContent = `${StaffState.canManage ? 'План дня' : 'Перегляд плану'}: ${emp.name} — ${date}`;

    document.getElementById('schStatus').value = entry?.status || 'working';
    document.getElementById('schNote').value = entry?.note || '';
    const selectedProfessionKey = normalizeProfessionKey(
        entry?.primary_profession_key || entry?.primaryProfessionKey || entry?.profession_key || sectionProfessionKey || emp.role_type
    );
    renderSchedulePlanEditor('schedule', scheduleEntrySegmentsForUi(entry, selectedProfessionKey), {
        primaryProfessionKey: selectedProfessionKey
    });

    const isReplacement = isReplacementEntry(entry);
    const canReplace = StaffState.canManage
        && entry?.id
        && ['working', 'remote'].includes(entry.status)
        && entry.shift_start
        && entry.shift_end;
    const replacementDetails = document.getElementById('schReplacementDetails');
    if (replacementDetails) {
        if (isReplacement) {
            replacementDetails.hidden = false;
            replacementDetails.innerHTML = `
                <strong>Активна підміна</strong>
                <span>Замість: ${escapeHtml(entry.original_staff_name || 'працівника')}</span>
                ${entry.replacement_reason ? `<span>Причина: ${escapeHtml(entry.replacement_reason)}</span>` : ''}
            `;
        } else {
            replacementDetails.hidden = true;
            replacementDetails.innerHTML = '';
        }
    }
    const replaceBtn = document.getElementById('schReplaceBtn');
    if (replaceBtn) {
        replaceBtn.hidden = !canReplace;
        replaceBtn.textContent = isReplacement ? 'Змінити заміну' : 'Виставити заміну';
    }
    const clearReplacementBtn = document.getElementById('schClearReplacementBtn');
    if (clearReplacementBtn) {
        clearReplacementBtn.hidden = !(canReplace && isReplacement);
    }

    toggleTimeFields();
    setScheduleModalReadOnly(!StaffState.canManage);
    const stateBeforePreferences = getStaffScheduleState();
    const overlay = document.getElementById('schModalOverlay');
    overlay?.setAttribute?.('aria-busy', 'false');
    _staffScheduleInitialState = stateBeforePreferences;
    const trigger = options.trigger || document.activeElement;
    if (overlay && typeof openModal === 'function') {
        openModal(overlay, trigger, {
            show: modal => {
                modal.classList.remove('hidden');
                modal.classList.add('visible');
            },
            hide: modal => {
                modal.classList.remove('visible');
                modal.classList.add('hidden');
            },
            initialFocus: () => StaffState.canManage
                ? document.getElementById('schStatus')
                : document.getElementById('schCancelBtn'),
            onRequestClose: () => closeEditModal(false),
            restoreFocus: () => scheduleCellFocusTarget(staffId, date, trigger, sectionDepartment)
        });
    } else {
        overlay?.classList.remove('hidden');
        overlay?.classList.add('visible');
    }
    if (window.ModalLayer) window.ModalLayer.ensureTopLayer(overlay);
    if (window.UnsafeDismissGuard && overlay) window.UnsafeDismissGuard.remember(overlay);
    loadScheduleCellHistory(staffId, date);
    loadScheduleShiftPreferences(staffId, {
        autoApply: (!entry?.shift_start && !entry?.shift_end) ? 'missing-only' : false,
        onlyIfState: stateBeforePreferences,
        resetInitialState: true
    });
}

async function refreshStaleScheduleModalPlan(session) {
    if (!scheduleModalSessionIsCurrent(session)) return false;
    const result = await fetchSchedule(session.date, session.date);
    if (!result.success) {
        showNotification(result.error || 'Не вдалося оновити план дня', 'error');
        return false;
    }
    if (!scheduleModalSessionIsCurrent(session)) return false;

    const previousEntry = session.entry || StaffState.schedule[`${session.staffId}_${session.date}`] || null;
    const freshEntry = result.schedule[`${session.staffId}_${session.date}`] || null;
    replaceScheduleStateEntry(previousEntry, freshEntry);
    replaceScheduleRawStateEntry(previousEntry, freshEntry);
    session.entry = freshEntry;
    session.planUpdatedAt = scheduleEntryPlanUpdatedAt(freshEntry);
    session.staleConflict = null;

    const employee = StaffState.staff.find(staff => Number(staff.id) === Number(session.staffId));
    const primaryProfessionKey = normalizeProfessionKey(
        freshEntry?.primary_profession_key
        || freshEntry?.primaryProfessionKey
        || freshEntry?.profession_key
        || session.sectionProfessionKey
        || employee?.role_type
    );
    document.getElementById('schStatus').value = freshEntry?.status || 'working';
    document.getElementById('schNote').value = freshEntry?.note || '';
    renderSchedulePlanEditor('schedule', scheduleEntrySegmentsForUi(freshEntry, primaryProfessionKey), {
        primaryProfessionKey
    });
    toggleTimeFields();
    _staffScheduleInitialState = getStaffScheduleState();
    renderSchedule();
    loadScheduleCellHistory(session.staffId, session.date);
    showNotification('План дня оновлено. Перевірте зміни перед збереженням.', 'info');
    return true;
}

async function closeEditModal(force = false, expectedSession = null) {
    const closingSession = expectedSession || StaffState.editingCell;
    if (expectedSession && !scheduleModalSessionIsCurrent(expectedSession)) return false;
    if (!force && closingSession?.mutationPending) {
        showNotification('Зачекайте завершення операції зі зміною.', 'info');
        return false;
    }
    if (_staffScheduleClosePromise) return _staffScheduleClosePromise;
    const overlay = document.getElementById('schModalOverlay');
    const closeNow = () => {
        if (closingSession && !scheduleModalSessionIsCurrent(closingSession)) return false;
        StaffState.scheduleHistoryLoadSeq += 1;
        StaffState.shiftPreferencesLoadSeq += 1;
        if (scheduleCellHistoryAbortController) {
            scheduleCellHistoryAbortController.abort();
            scheduleCellHistoryAbortController = null;
        }
        if (overlay && typeof closeModal === 'function') closeModal(overlay, { force: true });
        else {
            overlay?.classList.remove('visible');
            overlay?.classList.add('hidden');
        }
        StaffState.editingCell = null;
        overlay?.setAttribute?.('aria-busy', 'false');
        const shiftPreferencePanel = document.getElementById('schShiftPreferencePanel');
        if (shiftPreferencePanel) {
            shiftPreferencePanel.hidden = true;
            shiftPreferencePanel.innerHTML = '';
        }
        const historyPanel = document.getElementById('schHistoryList');
        if (historyPanel) {
            historyPanel.setAttribute('aria-busy', 'false');
            historyPanel.innerHTML = '';
        }
        _staffScheduleInitialState = getStaffScheduleState();
        return true;
    };
    const closeRequest = (async () => {
        if (window.UnsafeDismissGuard && overlay) {
            return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
                force,
                isDirty: () => getStaffScheduleState() !== _staffScheduleInitialState,
                message: 'Є незбережені зміни розкладу. Закрити без збереження?',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
        }
        closeNow();
        return true;
    })();
    _staffScheduleClosePromise = closeRequest;
    try {
        return await closeRequest;
    } finally {
        if (_staffScheduleClosePromise === closeRequest) _staffScheduleClosePromise = null;
    }
}

function toggleTimeFields() {
    const status = document.getElementById('schStatus')?.value;
    const visible = status === 'working' || status === 'remote';
    const editor = document.getElementById('schDayPlanEditor');
    if (editor) editor.hidden = !visible;
    const warning = document.getElementById('schNonWorkingWarning');
    if (warning) warning.hidden = visible;
    if (visible && !readSchedulePlanSegments('schedule').length) renderSchedulePlanEditor('schedule', []);
    const shiftPreferencePanel = document.getElementById('schShiftPreferencePanel');
    if (!visible) {
        if (shiftPreferencePanel) {
            shiftPreferencePanel.hidden = true;
            shiftPreferencePanel.innerHTML = '';
        }
    } else {
        const editing = StaffState.editingCell;
        const preferences = editing ? StaffState.shiftPreferences[Number(editing.staffId)] : null;
        if (Array.isArray(preferences)) renderScheduleShiftPreferencePanel(preferences);
    }
    const entry = getEditingScheduleEntry();
    const isReplacement = isReplacementEntry(entry);
    const canReplace = visible && StaffState.canManage && entry?.id && entry.shift_start && entry.shift_end;
    const replaceBtn = document.getElementById('schReplaceBtn');
    const clearReplacementBtn = document.getElementById('schClearReplacementBtn');
    if (replaceBtn) replaceBtn.hidden = !canReplace;
    if (clearReplacementBtn) clearReplacementBtn.hidden = !(canReplace && isReplacement);
    updateSchedulePlanSummary('schedule');
}

function scheduleAuditDetails(row = {}) {
    const details = row.details;
    if (!details) return {};
    if (typeof details === 'string') {
        try { return JSON.parse(details); } catch { return {}; }
    }
    return details;
}

function scheduleAuditActionLabel(action) {
    const labels = {
        staff_schedule_update: 'Змінено клітинку',
        staff_schedule_bulk_update: 'Масове заповнення',
        staff_schedule_copy_week: 'Копія тижня',
        staff_schedule_replacement_removed: 'Зміну знято через підміну',
        staff_schedule_replacement_set: 'Виставлено підміну',
        staff_schedule_replacement_clear_removed: 'Підміну знято',
        staff_schedule_replacement_restored: 'Повернено оригінальну зміну',
        staff_schedule_stale_rejected: 'Відхилено застаріле збереження'
    };
    return labels[action] || action || 'Зміна графіка';
}

function scheduleAuditValueLabel(field, value) {
    if (value === null || value === undefined || value === '') return 'порожньо';
    if (field === 'status') return STAFF_SCHEDULE_STATUS_LABELS[normalizeScheduleStatus(value)] || value;
    if (field === 'professionKey') return professionLabel(value);
    return String(value);
}

function scheduleAuditChangesText(details = {}) {
    if (details.outcome === 'rejected' && details.code === 'HR_SHIFT_PLAN_STALE') {
        return 'План не змінено: у менеджера була застаріла версія';
    }
    const fieldLabels = {
        status: 'статус',
        shiftStart: 'початок',
        shiftEnd: 'кінець',
        note: 'нотатка',
        professionKey: 'професія',
        originalStaffId: 'оригінальний працівник',
        replacementReason: 'причина підміни'
    };
    const changes = details.changes || {};
    const parts = Object.entries(changes).map(([field, change]) => {
        const label = fieldLabels[field] || field;
        return `${label}: ${scheduleAuditValueLabel(field, change?.from)} → ${scheduleAuditValueLabel(field, change?.to)}`;
    });
    return parts.length ? parts.join('; ') : 'Технічний запис без зміни полів';
}

function formatScheduleAuditTime(value) {
    if (!value) return '';
    try {
        return new Date(value).toLocaleString('uk-UA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return String(value);
    }
}

function renderScheduleHistoryList(staffId, date, state = 'ready') {
    const container = document.getElementById('schHistoryList');
    if (!container) return;
    container.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    if (state === 'loading') {
        container.innerHTML = '<div class="sch-history-empty">Завантажую історію...</div>';
        return;
    }
    if (state === 'error') {
        container.innerHTML = '<div class="sch-history-empty sch-history-error">Не вдалося завантажити історію</div>';
        return;
    }
    const entries = StaffState.scheduleHistory[`${staffId}_${date}`] || [];
    if (!entries.length) {
        container.innerHTML = '<div class="sch-history-empty">Історії для цієї клітинки ще немає</div>';
        return;
    }
    container.innerHTML = entries.map(row => {
        const details = scheduleAuditDetails(row);
        return `<div class="sch-history-item">
            <div class="sch-history-top">
                <strong>${escapeHtml(scheduleAuditActionLabel(row.action))}</strong>
                <span>${escapeHtml(formatScheduleAuditTime(row.created_at))}</span>
            </div>
            <div class="sch-history-meta">${escapeHtml(row.performed_by || 'system')} · ${escapeHtml(details.source || row.action || '')}</div>
            <div class="sch-history-change">${escapeHtml(scheduleAuditChangesText(details))}</div>
        </div>`;
    }).join('');
}

async function loadScheduleCellHistory(staffId, date) {
    const numericStaffId = Number(staffId);
    const normalizedDate = String(date || '');
    const requestedRangeKey = StaffState.editingCell?.rangeKey || '';
    const seq = ++StaffState.scheduleHistoryLoadSeq;
    if (scheduleCellHistoryAbortController) scheduleCellHistoryAbortController.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    scheduleCellHistoryAbortController = controller;

    if (!scheduleEditingCellMatches(numericStaffId, normalizedDate, requestedRangeKey)) {
        if (scheduleCellHistoryAbortController === controller) scheduleCellHistoryAbortController = null;
        return { success: false, data: [], stale: true };
    }
    renderScheduleHistoryList(numericStaffId, normalizedDate, 'loading');
    try {
        const result = await fetchScheduleHistory(numericStaffId, normalizedDate, { signal: controller?.signal });
        if (seq !== StaffState.scheduleHistoryLoadSeq
            || !scheduleEditingCellMatches(numericStaffId, normalizedDate, requestedRangeKey)) {
            return { ...result, stale: true };
        }
        if (result.success) {
            StaffState.scheduleHistory[`${numericStaffId}_${normalizedDate}`] = result.data;
        }
        if (!result.aborted) {
            renderScheduleHistoryList(numericStaffId, normalizedDate, result.success ? 'ready' : 'error');
        }
        return result;
    } finally {
        if (scheduleCellHistoryAbortController === controller) scheduleCellHistoryAbortController = null;
    }
}

function setScheduleModalReadOnly(readOnly) {
    ['schStatus', 'schNote'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = readOnly;
    });
    document.querySelectorAll('#schDayPlanEditor input, #schDayPlanEditor select, #schDayPlanEditor button').forEach(element => {
        if (readOnly) element.disabled = true;
    });
    const saveBtn = document.getElementById('schSaveBtn');
    if (saveBtn) saveBtn.hidden = readOnly;
    const readOnlyHint = document.getElementById('schReadOnlyHint');
    if (readOnlyHint) readOnlyHint.hidden = !readOnly;
    const overlay = document.getElementById('schModalOverlay');
    if (overlay) {
        if (readOnly) overlay.setAttribute('aria-describedby', 'schReadOnlyHint');
        else overlay.removeAttribute('aria-describedby');
    }
    document.querySelectorAll('#schShiftPreferencePanel .sch-shift-preference-option').forEach(button => {
        button.disabled = readOnly;
    });
    updateSchedulePlanSummary('schedule');
}

async function handleSave() {
    if (!StaffState.editingCell || !scheduleRangeDataReady()
        || StaffState.editingCell.rangeKey !== scheduleCommittedRangeKey()) {
        showNotification('Період графіка змінився. Відкрийте клітинку повторно.', 'error');
        return;
    }
    const editingSession = StaffState.editingCell;
    const { staffId, date } = editingSession;
    const editingRangeKey = editingSession.rangeKey;
    const previousEntry = editingSession.entry || StaffState.schedule[`${staffId}_${date}`] || null;
    const emp = StaffState.staff.find(staff => Number(staff.id) === Number(staffId));
    if (emp && !isScheduleableStaffForUi(emp, date)) {
        showNotification(scheduleableStaffErrorMessage({ code: 'STAFF_NOT_SCHEDULEABLE' }), 'error');
        return;
    }
    const validation = updateSchedulePlanSummary('schedule');
    if (!validation.valid) {
        showNotification(validation.errors[0] || 'Перевірте план дня', 'error');
        return;
    }
    const status = validation.status;
    const showTime = schedulePlanIsWorkingStatus(status);
    const needsProfileRead = showTime && !previousEntry?.shift_start && !previousEntry?.shift_end;
    if (needsProfileRead && editingSession.shiftPreferencesLoading) {
        showNotification('Зачекайте: завантажуються типові зміни з HR-картки працівника.', 'info');
        return;
    }
    if (needsProfileRead && editingSession.shiftPreferencesLoadFailed) {
        showNotification('Не вдалося прочитати типові зміни з HR-картки. Не зберігаю fallback-час.', 'error');
        return;
    }
    const shiftStart = showTime ? validation.metrics.envelopeStart : null;
    const shiftEnd = showTime ? validation.metrics.envelopeEnd : null;
    const professionKey = showTime ? validation.primaryProfessionKey : null;
    const note = document.getElementById('schNote')?.value.trim() || null;

    if (!beginScheduleModalMutation(editingSession)) return;
    try {
        const result = await saveScheduleEntry(staffId, date, shiftStart, shiftEnd, status, note, professionKey, {
            primaryProfessionKey: professionKey,
            expectedUpdatedAt: editingSession.planUpdatedAt,
            segments: validation.segments.map(segment => ({
                id: segment.id,
                professionKey: segment.professionKey,
                shiftStart: segment.shiftStart,
                shiftEnd: segment.shiftEnd,
                breakMinutes: segment.breakMinutes,
                note: segment.note || null,
                additionalRoles: (segment.additionalRoles || []).map(role => ({ ...role })),
                additionalProfessionKeys: segment.additionalProfessionKeys
            }))
        });
        if (result.success) {
            if (scheduleRangeDataReady() && editingRangeKey === scheduleCommittedRangeKey()) {
                replaceScheduleStateEntry(previousEntry, result.data);
                renderSchedule();
            }
            if (scheduleModalSessionIsCurrent(editingSession)) {
                await closeEditModal(true, editingSession);
            }
            showNotification('Зміну збережено');
        } else if (['HR_SHIFT_PLAN_STALE', 'HR_SHIFT_PLAN_VERSION_REQUIRED'].includes(result.code)) {
            editingSession.staleConflict = result.details || {};
            showNotification('Цей план уже змінив інший менеджер. Ваші поля не перезаписані.', 'error');
            const shouldRefresh = typeof confirmModal === 'function'
                ? await confirmModal(
                    'На сервері вже є новіша версія плану дня. Оновити форму з сервера?\n\nВаші поточні незбережені поля буде замінено лише після підтвердження.',
                    {
                        type: 'warning',
                        okText: 'Оновити з сервера',
                        cancelText: 'Залишити мої дані'
                    }
                )
                : false;
            if (shouldRefresh && scheduleModalSessionIsCurrent(editingSession)) {
                await refreshStaleScheduleModalPlan(editingSession);
            }
        } else {
            showNotification(scheduleableStaffErrorMessage(result, 'Помилка збереження'), 'error');
        }
    } finally {
        finishScheduleModalMutation(editingSession);
    }
}

function getEditingScheduleEntry() {
    const editing = StaffState.editingCell;
    if (!editing) return null;
    return StaffState.schedule[`${editing.staffId}_${editing.date}`] || editing.entry || null;
}

async function handleReplaceSchedule() {
    if (!StaffState.editingCell || !scheduleRangeDataReady()
        || StaffState.editingCell.rangeKey !== scheduleCommittedRangeKey()) {
        showNotification('Період графіка змінився. Відкрийте клітинку повторно.', 'error');
        return;
    }
    const editingSession = StaffState.editingCell;
    const editingRangeKey = editingSession.rangeKey;
    const entry = getEditingScheduleEntry();
    if (!entry?.id || typeof formModal !== 'function') {
        showNotification('Спочатку збережіть робочий слот графіка', 'error');
        return;
    }
    const currentStaff = StaffState.staff.find(staff => Number(staff.id) === Number(entry.staff_id));
    const candidates = scheduleReplacementCandidates(entry, currentStaff);
    if (!candidates.length) {
        showNotification('Немає вільних кандидатів з потрібною професією на цю дату', 'error');
        return;
    }

    if (!beginScheduleModalMutation(editingSession)) return;
    try {
        const result = await formModal('Підміна зміни', [
            {
                key: 'replacementStaffId',
                label: 'Кого поставити',
                type: 'select',
                options: candidates,
                defaultValue: candidates[0].value,
                required: true
            },
            {
                key: 'reason',
                label: 'Причина',
                type: 'textarea',
                placeholder: 'Хвороба, форс-мажор, домовленість...'
            }
        ], { icon: '↔', okText: isReplacementEntry(entry) ? 'Змінити заміну' : 'Виставити заміну', type: 'warning' });
        if (!result || !scheduleModalSessionIsCurrent(editingSession)) return;

        const apiResult = await replaceScheduleEntry(entry.id, result.replacementStaffId, result.reason);
        if (apiResult.success) {
            if (scheduleRangeDataReady() && editingRangeKey === scheduleCommittedRangeKey()) {
                replaceScheduleStateEntry(entry, apiResult.data);
                renderSchedule();
            }
            if (scheduleModalSessionIsCurrent(editingSession)) {
                await closeEditModal(true, editingSession);
            }
            showNotification('Підміну виставлено');
        } else {
            showNotification(scheduleableStaffErrorMessage(apiResult, 'Помилка підміни'), 'error');
        }
    } finally {
        finishScheduleModalMutation(editingSession);
    }
}

async function handleClearReplacement() {
    if (!StaffState.editingCell || !scheduleRangeDataReady()
        || StaffState.editingCell.rangeKey !== scheduleCommittedRangeKey()) {
        showNotification('Період графіка змінився. Відкрийте клітинку повторно.', 'error');
        return;
    }
    const editingSession = StaffState.editingCell;
    const editingRangeKey = editingSession.rangeKey;
    const entry = getEditingScheduleEntry();
    if (!entry?.id || !isReplacementEntry(entry)) {
        showNotification('У цьому слоті немає активної підміни', 'error');
        return;
    }
    if (!beginScheduleModalMutation(editingSession)) return;
    try {
        if (!await confirmModal('Скасувати підміну і повернути зміну оригінальному працівнику?', {
            type: 'warning',
            okText: 'Повернути',
            cancelText: 'Не чіпати'
        }) || !scheduleModalSessionIsCurrent(editingSession)) {
            return;
        }

        const result = await clearScheduleReplacement(entry.id);
        if (result.success) {
            if (scheduleRangeDataReady() && editingRangeKey === scheduleCommittedRangeKey()) {
                replaceScheduleStateEntry(entry, result.data);
                renderSchedule();
            }
            if (scheduleModalSessionIsCurrent(editingSession)) {
                await closeEditModal(true, editingSession);
            }
            showNotification('Підміну скасовано');
        } else {
            showNotification(result.error || 'Помилка скасування підміни', 'error');
        }
    } finally {
        finishScheduleModalMutation(editingSession);
    }
}

// ==========================================
// WEEK NAVIGATION
// ==========================================

async function goToScheduleRange(startValue, endValue, mode = 'custom') {
    const validation = validateScheduleRange(startValue, endValue);
    if (!validation.ok) {
        showNotification(validation.error, 'error');
        syncScheduleRangeControls();
        return false;
    }

    const target = scheduleRangeCandidate(validation.start, validation.end, mode);
    const requestSeq = ++staffScheduleRangeLoadSeq;
    if (staffScheduleRangeAbortController) staffScheduleRangeAbortController.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    staffScheduleRangeAbortController = controller;
    StaffState.rangePending = target;
    StaffState.rangeRetry = null;
    setScheduleRangeLoadState('loading', { range: target });
    syncScheduleRangeControls();

    const requestOptions = controller ? { signal: controller.signal } : {};
    const includeHours = Boolean(StaffState.showHours);
    try {
        const [scheduleResult, attendanceResult, hoursResult] = await Promise.all([
            fetchSchedule(target.from, target.to, requestOptions),
            fetchScheduleAttendance(target.from, target.to, requestOptions),
            includeHours
                ? fetchScheduleHours(target.from, target.to, requestOptions)
                : Promise.resolve({ success: true, data: null })
        ]);

        if (requestSeq !== staffScheduleRangeLoadSeq || controller?.signal.aborted) return false;

        const failedResult = [scheduleResult, attendanceResult, hoursResult].find(result => !result?.success);
        if (failedResult) {
            if (failedResult.aborted) return false;
            StaffState.rangePending = null;
            StaffState.rangeRetry = target;
            restoreScheduleCommittedRangeUi();
            setScheduleRangeLoadState('error', {
                range: target,
                error: failedResult.error || 'Спробуйте повторити завантаження.'
            });
            return false;
        }

        // Atomic latest-only commit: no individual read mutates committed schedule state.
        StaffState.schedule = scheduleResult.schedule;
        StaffState.scheduleRawEntries = scheduleResult.scheduleRawEntries;
        StaffState.displayGroups = scheduleResult.displayGroups;
        StaffState.attendance = attendanceResult.attendance;
        StaffState.attendanceSummary = attendanceResult.attendanceSummary;
        StaffState.attendanceUnavailable = Boolean(attendanceResult.unavailable);
        StaffState.hoursData = includeHours ? hoursResult.data : null;
        setScheduleRangeState(target.start, target.end, target.mode);
        StaffState.scheduleLoadedRange = { from: target.from, to: target.to };
        StaffState.rangePending = null;
        StaffState.rangeRetry = null;

        renderWeekLabel();
        renderSchedule();
        if (StaffState.showLoadView) renderLoadView();
        syncScheduleViewSwitch();
        setScheduleRangeLoadState(
            StaffState.scheduleRawEntries.length ? 'ready' : 'empty',
            { range: target }
        );
        return true;
    } catch (err) {
        if (requestSeq !== staffScheduleRangeLoadSeq || controller?.signal.aborted || isScheduleAbortError(err)) return false;
        console.error('goToScheduleRange error:', err);
        StaffState.rangePending = null;
        StaffState.rangeRetry = target;
        restoreScheduleCommittedRangeUi();
        setScheduleRangeLoadState('error', {
            range: target,
            error: 'Непередбачена помилка завантаження. Спробуйте ще раз.'
        });
        return false;
    } finally {
        if (requestSeq === staffScheduleRangeLoadSeq && staffScheduleRangeAbortController === controller) {
            staffScheduleRangeAbortController = null;
        }
    }
}

async function goToWeek(monday) {
    const range = getScheduleWindowRange(monday);
    return goToScheduleRange(range.start, range.end, 'rolling');
}

async function openScheduleDayPlan(staffId, date) {
    if (!staffScheduleInitialized && staffScheduleInitPromise) await staffScheduleInitPromise;
    if (!staffScheduleInitialized) return false;
    const normalizedStaffId = normalizeScheduleFocusStaffId(staffId);
    const targetDate = parseScheduleDateInput(date);
    if (!normalizedStaffId || !targetDate) return false;

    const currentRange = scheduleCurrentRange();
    const targetIsLoaded = scheduleRangeDataReady()
        && targetDate >= currentRange.start
        && targetDate <= currentRange.end;
    if (!targetIsLoaded) {
        const loaded = await goToWeek(getScheduleFocusStart(targetDate));
        if (!loaded) return false;
    }

    focusScheduleStaff(normalizedStaffId);
    const dateKey = formatDateStr(targetDate);
    openEditModal(normalizedStaffId, dateKey);
    return Boolean(StaffState.editingCell
        && Number(StaffState.editingCell.staffId) === normalizedStaffId
        && StaffState.editingCell.date === dateKey);
}

function prevWeek() {
    const presetRange = shiftSchedulePresetRange(-1);
    if (presetRange) {
        goToScheduleRange(presetRange.start, presetRange.end, scheduleNavigationMode());
        return;
    }
    const range = scheduleNavigationRange();
    const step = scheduleNavigationStepDays();
    goToScheduleRange(
        shiftScheduleDate(range.start, -step),
        shiftScheduleDate(range.end, -step),
        scheduleNavigationMode()
    );
}

function nextWeek() {
    const presetRange = shiftSchedulePresetRange(1);
    if (presetRange) {
        goToScheduleRange(presetRange.start, presetRange.end, scheduleNavigationMode());
        return;
    }
    const range = scheduleNavigationRange();
    const step = scheduleNavigationStepDays();
    goToScheduleRange(
        shiftScheduleDate(range.start, step),
        shiftScheduleDate(range.end, step),
        scheduleNavigationMode()
    );
}

function goToday() {
    goToWeek(getScheduleFocusStart(new Date()));
}

// ==========================================
// FILL WEEK MODAL
// ==========================================

function openFillWeekModal() {
    if (!scheduleRangeDataReady()) {
        showNotification('Заповнення доступне після успішного завантаження періоду', 'error');
        return;
    }
    const select = document.getElementById('fillStaffSelect');
    const filtered = scheduleVisibleStaff();

    select.innerHTML = '<option value="all">Всі видимі працівники</option>';
    for (const emp of filtered) {
        select.innerHTML += `<option value="${normalizeScheduleStaffId(emp.id)}">${escapeHtml(scheduleStaffDisplayName(emp))} — ${escapeHtml(emp.position)}</option>`;
    }

    document.getElementById('fillStatus').value = 'working';
    document.getElementById('fillNote').value = '';
    renderSchedulePlanEditor('fill', [createSchedulePlanSegment('fill')]);
    toggleFillTimeFields();
    updateFillWeekModalCopy();
    const overlay = document.getElementById('fillWeekOverlay');
    _staffFillInitialState = getStaffFillState();
    overlay?.classList.add('visible');
    if (window.ModalLayer) window.ModalLayer.ensureTopLayer(overlay);
    if (window.UnsafeDismissGuard && overlay) window.UnsafeDismissGuard.remember(overlay);
}

async function closeFillWeekModal(force = false) {
    const overlay = document.getElementById('fillWeekOverlay');
    if (!overlay || !overlay.classList.contains('visible')) return true;

    const closeNow = () => {
        overlay?.classList.remove('visible');
        _staffFillInitialState = getStaffFillState();
    };
    if (window.UnsafeDismissGuard && overlay) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
            force,
            isDirty: () => getStaffFillState() !== _staffFillInitialState,
            message: 'Є незбережені зміни заповнення тижня. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }
    closeNow();
    return true;
}

function toggleFillTimeFields() {
    const status = document.getElementById('fillStatus')?.value;
    const visible = schedulePlanIsWorkingStatus(status);
    const editor = document.getElementById('fillDayPlanEditor');
    if (editor) editor.hidden = !visible;
    const warning = document.getElementById('fillNonWorkingWarning');
    if (warning) warning.hidden = visible;
    if (visible && !readSchedulePlanSegments('fill').length) renderSchedulePlanEditor('fill', []);
    updateSchedulePlanSummary('fill');
}

async function handleFillWeekSave() {
    if (_staffFillMutationPending) return;
    if (!scheduleRangeDataReady()) {
        showNotification('Період графіка змінився. Відкрийте заповнення повторно.', 'error');
        return;
    }
    const staffValue = document.getElementById('fillStaffSelect')?.value;
    const status = document.getElementById('fillStatus')?.value;
    const showTime = schedulePlanIsWorkingStatus(status);
    const note = document.getElementById('fillNote')?.value.trim() || null;

    // Get selected days (checkboxes)
    const checkedDays = [];
    document.querySelectorAll('#fillDaysRow input[type=checkbox]:checked').forEach(cb => {
        checkedDays.push(parseInt(cb.value));
    });
    if (checkedDays.length === 0) {
        showNotification('Оберіть хоча б один день', 'error');
        return;
    }

    // Determine which staff to fill
    let targetStaff;
    if (staffValue === 'all') {
        targetStaff = scheduleVisibleStaff();
    } else {
        const selectedStaffId = normalizeScheduleStaffId(staffValue);
        targetStaff = StaffState.staff.filter(s => normalizeScheduleStaffId(s.id) === selectedStaffId);
    }
    targetStaff = uniqueScheduleStaffById(scheduleableStaffForUi(targetStaff));

    const validation = validateSchedulePlan('fill', { staff: targetStaff });
    if (!validation.valid) {
        updateSchedulePlanSummary('fill');
        showNotification(validation.errors[0] || 'Перевірте шаблон часових блоків', 'error');
        return;
    }
    const professionKey = showTime ? validation.primaryProfessionKey : null;
    const segmentTemplate = showTime ? validation.segments.map(segment => ({
        professionKey: segment.professionKey,
        shiftStart: segment.shiftStart,
        shiftEnd: segment.shiftEnd,
        breakMinutes: segment.breakMinutes,
        note: segment.note || null,
        additionalRoles: (segment.additionalRoles || []).map(role => ({ ...role })),
        additionalProfessionKeys: [...segment.additionalProfessionKeys]
    })) : [];

    if (showTime) {
        _staffFillMutationPending = true;
        updateSchedulePlanSummary('fill');
        const profileResult = await ensureScheduleShiftPreferencesForStaff(targetStaff);
        _staffFillMutationPending = false;
        updateSchedulePlanSummary('fill');
        if (!profileResult.success) {
            showNotification(`Не вдалося прочитати типові зміни з HR-картки: ${profileResult.failures.slice(0, 3).join(', ')}`, 'error');
            return;
        }
    }

    // Build entries for the visible period; selected weekdays stay as a filter inside that period.
    const dates = getScheduleDates();
    const entries = [];
    for (const emp of targetStaff) {
        const staffId = normalizeScheduleStaffId(emp.id);
        const preferences = StaffState.shiftPreferences[staffId] || [];
        for (const d of dates) {
            const date = formatDateStr(d);
            if (!checkedDays.includes(d.getDay())) continue;
            if (!isScheduleableStaffForUi(emp, date)) continue;
            const segments = showTime ? scheduleSegmentsWithShiftPreferences(segmentTemplate, preferences, date) : [];
            const metrics = showTime ? schedulePlanMetrics(segments) : { envelopeStart: null, envelopeEnd: null };
            entries.push({
                staffId,
                date,
                shiftStart: showTime ? metrics.envelopeStart : null,
                shiftEnd: showTime ? metrics.envelopeEnd : null,
                status,
                note,
                professionKey,
                primaryProfessionKey: professionKey,
                segments: segments.map(segment => ({
                    ...segment,
                    additionalRoles: (segment.additionalRoles || []).map(role => ({ ...role })),
                    additionalProfessionKeys: [...(segment.additionalProfessionKeys || [])]
                }))
            });
        }
    }

    if (entries.length === 0) {
        showNotification('Нічого заповнювати', 'error');
        return;
    }

    const currentRange = scheduleCurrentRange();
    const currentMode = StaffState.rangeMode || 'custom';
    const rangeLabel = formatScheduleRangeLabel(dates[0], getScheduleRangeEnd(dates));
    const needsConfirmation = dates.length > STAFF_SCHEDULE_WINDOW_DAYS
        || entries.length >= STAFF_SCHEDULE_BULK_CONFIRM_ENTRY_THRESHOLD;
    _staffFillMutationPending = true;
    updateSchedulePlanSummary('fill');
    try {
        if (needsConfirmation) {
            const confirmLines = [
                `Заповнити ${entries.length} записів за період ${rangeLabel}?`,
                '',
                `Працівників: ${targetStaff.length}`,
                `Днів у періоді: ${dates.length}`,
                `Блоків у шаблоні: ${segmentTemplate.length}`,
                `Вибрані дні тижня: ${selectedWeekdayLabels(checkedDays) || '-'}`,
                'Час: з HR-карток staff_shift_preferences; fallback лише якщо в профілі немає типового часу.',
                '',
                'Існуючі записи для цих дат і працівників можуть бути оновлені.'
            ];
            if (!await confirmModal(confirmLines.join('\n'), { type: 'warning', okText: 'Заповнити' })) return;
        }

        const result = await bulkSaveSchedule(entries);
        if (result.success) {
            closeFillWeekModal(true);
            showNotification(`Заповнено ${result.count} записів`);
            await goToScheduleRange(currentRange.start, currentRange.end, currentMode);
        } else {
            showNotification(scheduleableStaffErrorMessage(result, 'Помилка збереження'), 'error');
        }
    } finally {
        _staffFillMutationPending = false;
        updateSchedulePlanSummary('fill');
    }
}

// ==========================================
// COPY WEEK
// ==========================================

async function handleCopyWeek() {
    if (!scheduleRangeDataReady()) {
        showNotification('Копіювання доступне після успішного завантаження періоду', 'error');
        return;
    }
    if (!canCopyWeekInCurrentRange()) {
        const rangeLabel = scheduleCurrentRangeLabel();
        const message = [
            `Копія тижня недоступна для довільного періоду ${rangeLabel}.`,
            '',
            'Ця дія копіює тільки канонічний 7-денний тижневий шаблон у наступний тиждень.',
            'Щоб уникнути випадкового копіювання 15-31 днів, спочатку поверніться до режиму "Сьогодні".'
        ].join('\n');
        if (typeof confirmModal === 'function') {
            await confirmModal(message, { type: 'warning', okText: 'Зрозуміло' });
        } else {
            showNotification('Копія тижня доступна тільки у звичайному тижневому режимі', 'error');
        }
        return;
    }

    const fromMonday = formatDateStr(StaffState.weekStart);
    const sourceEnd = formatDateStr(shiftScheduleDate(StaffState.weekStart, 6));
    const nextMon = new Date(StaffState.weekStart);
    nextMon.setDate(nextMon.getDate() + 7);
    const toMonday = formatDateStr(nextMon);
    const targetEnd = formatDateStr(shiftScheduleDate(nextMon, 6));

    const deptLabel = StaffState.activeDept === 'all'
        ? 'всіх відділів'
        : scheduleDisplayDepartmentLabel(StaffState.activeDept);
    const copyMode = scheduleCopyWeekModeForDepartment(StaffState.activeDept);

    const preview = await copyWeekSchedule(fromMonday, toMonday, { dryRun: true });
    if (!preview.success) {
        showNotification(scheduleableStaffErrorMessage(preview, 'Не вдалося підготувати preview копіювання тижня'), 'error');
        return;
    }

    const previewLines = [
        `Скопіювати графік ${deptLabel} з тижня ${fromMonday} на тиждень ${toMonday}?`,
        '',
        `Діапазон копіювання: ${fromMonday} - ${sourceEnd} -> ${toMonday} - ${targetEnd}`,
        'Довільний visible range не копіюється цією дією.',
        '',
        `Режим: ${copyMode === 'explicit_staff_ids' ? 'visible staffIds[]' : (copyMode === 'raw_department' ? 'raw department' : 'all staff')}`,
        `Працівників: ${preview.staffCount || 0}`,
        `Змін буде створено/оновлено: ${preview.count || 0}`,
        `Конфліктів із цільовим тижнем: ${preview.conflicts || 0}`,
        '',
        'Існуючі записи в цільовому тижні будуть перезаписані після підтвердження.'
    ];
    if (!await confirmModal(previewLines.join('\n'), { type: 'warning', okText: 'Копіювати' })) return;

    const result = await copyWeekSchedule(fromMonday, toMonday);
    if (result.success) {
        showNotification(`Скопійовано ${result.count} записів на наступний тиждень`);
        // Jump to the target week to see the result
        await goToWeek(nextMon);
    } else {
        showNotification(scheduleableStaffErrorMessage(result, 'Помилка копіювання'), 'error');
    }
}

// ==========================================
// LOAD VIEW (Excel-like daily workload)
// ==========================================

function renderLoadView() {
    const dates = getScheduleDates();
    const today = todayStr();
    syncScheduleRangeLayout('loadViewWrapper', dates, 'load');
    const filtered = scheduleVisibleStaff();
    renderScheduleStaffFilterInfo(filtered);

    // Header
    const thead = document.getElementById('loadViewHead');
    let headHtml = '<tr><th scope="col">Показник</th>';
    for (const d of dates) {
        const ds = formatDateStr(d);
        const isToday = ds === today;
        headHtml += `<th scope="col" class="${isToday ? 'today' : ''}">
            <span class="th-date">${d.getDate()}</span>
            <span class="th-day">${STAFF_SCHEDULE_DAYS_UK[d.getDay()]}</span>
        </th>`;
    }
    headHtml += '<th scope="col">Разом</th></tr>';
    thead.innerHTML = headHtml;

    // Calculate stats per day
    const statuses = ['working', 'remote', 'dayoff', 'vacation', 'sick', 'unset'];
    const statusNames = { working: 'На роботі', remote: 'Віддалено', dayoff: 'Вихідні', vacation: 'Відпустка', sick: 'Лікарняний', unset: 'Не заповнено' };
    const statusCss = { working: 'working', remote: 'remote', dayoff: 'dayoff', vacation: 'vacation', sick: 'sick', unset: 'unset' };

    const dayStats = dates.map(d => {
        const ds = formatDateStr(d);
        const counts = { working: 0, remote: 0, dayoff: 0, vacation: 0, sick: 0, unset: 0, total: filtered.length };
        for (const emp of filtered) {
            const entry = StaffState.schedule[`${emp.id}_${ds}`];
            const status = entry ? entry.status : 'unset';
            if (counts[status] !== undefined) counts[status]++;
            else counts.unset++;
        }
        return counts;
    });

    // Render rows per status
    const tbody = document.getElementById('loadViewBody');
    let bodyHtml = '';

    for (const status of statuses) {
        const weekTotal = dayStats.reduce((sum, d) => sum + d[status], 0);
        bodyHtml += `<tr class="load-row-status">`;
        bodyHtml += `<td>${statusNames[status]}</td>`;
        for (const day of dayStats) {
            const val = day[status];
            bodyHtml += `<td class="${val > 0 ? 'load-cell-' + statusCss[status] : ''}">${val || '-'}</td>`;
        }
        bodyHtml += `<td class="load-cell-total">${weekTotal}</td>`;
        bodyHtml += `</tr>`;
    }

    // Total active row
    bodyHtml += `<tr class="load-total"><td>Всього працює</td>`;
    for (const day of dayStats) {
        const active = day.working + day.remote;
        bodyHtml += `<td class="load-cell-working">${active}</td>`;
    }
    const totalActive = dayStats.reduce((sum, d) => sum + d.working + d.remote, 0);
    bodyHtml += `<td class="load-cell-total">${totalActive}</td></tr>`;

    // Department breakdown (if showing all departments)
    if (StaffState.activeDept === 'all') {
        const grouped = groupStaffByScheduleDepartment(filtered, { grouping: 'membership' });
        bodyHtml += `<tr><td colspan="${dates.length + 2}" style="padding:8px 16px;font-weight:800;font-size:12px;color:var(--gray-500);background:var(--gray-50);border-top:2px solid var(--gray-200)">По відділах (на роботі + віддалено)</td></tr>`;

        for (const dept of scheduleDepartmentRenderOrder(grouped)) {
            const deptStaff = grouped[dept] || [];
            if (deptStaff.length === 0) continue;
            const icon = renderScheduleCrmIcon(DEPT_ICONS[dept], 'load-dept-icon schedule-crm-icon');
            const label = scheduleDisplayDepartmentLabel(dept);
            bodyHtml += `<tr class="load-row-status"><td><span class="load-dept-label">${icon}<span>${escapeHtml(label)}</span></span></td>`;
            for (const d of dates) {
                const ds = formatDateStr(d);
                let active = 0;
                for (const emp of deptStaff) {
                    const entry = StaffState.schedule[`${emp.id}_${ds}`];
                    const status = entry ? entry.status : 'unset';
                    if (status === 'working' || status === 'remote') active++;
                }
                const ratio = active / deptStaff.length;
                const cls = ratio >= 0.7 ? 'load-cell-working' : ratio >= 0.4 ? 'load-cell-remote' : 'load-cell-sick';
                bodyHtml += `<td class="${cls}">${active}/${deptStaff.length}</td>`;
            }
            const weekActive = dates.reduce((sum, d) => {
                const ds = formatDateStr(d);
                let cnt = 0;
                for (const emp of deptStaff) {
                    const entry = StaffState.schedule[`${emp.id}_${ds}`];
                    const status = entry ? normalizeScheduleStatus(entry.status) : 'unset';
                    if (status === 'working' || status === 'remote') cnt++;
                }
                return sum + cnt;
            }, 0);
            bodyHtml += `<td class="load-cell-total">${weekActive}</td></tr>`;
        }
    }

    tbody.innerHTML = bodyHtml;
}

// ==========================================
// ACCOUNT LINKING (v39.1)
// ==========================================

async function staffApiFetch(path, options = {}) {
    const request = {
        ...options,
        headers: { ...(options.headers || {}) }
    };
    if (typeof apiFetchWithAuthRetry === 'function') {
        return apiFetchWithAuthRetry(path, request);
    }
    const token = localStorage.getItem('pzp_token') || localStorage.getItem('pzp_access_token');
    if (token && !request.headers.Authorization) {
        request.headers.Authorization = `Bearer ${token}`;
    }
    return fetch(path, request);
}

async function fetchLinkStatus() {
    try {
        const res = await staffApiFetch('/api/staff/link-status');
        const data = await res.json();
        if (data.success) {
            StaffState.linkData = data.data;
            StaffState.linkStats = data.stats;
        }
        return data;
    } catch (err) {
        console.error('fetchLinkStatus error:', err);
        return { success: false };
    }
}

async function fetchAllUsers() {
    try {
        const res = await staffApiFetch('/api/users');
        const data = await res.json();
        StaffState.allUsers = Array.isArray(data) ? data : (data.data || []);
        return StaffState.allUsers;
    } catch (err) {
        console.error('fetchAllUsers error:', err);
        return [];
    }
}

function getCredentialPassword(credential) {
    return credential?.password || credential?.oneTimePassword || '';
}

function validateStaffAccountManualPassword(values = {}) {
    const password = String(values.password || '');
    if (!password) return null;
    if (password.length < 6) {
        return { key: 'password', message: 'Пароль має бути не менше 6 символів' };
    }
    if (password !== String(values.confirmPassword || '')) {
        return { key: 'confirmPassword', message: 'Паролі не збігаються' };
    }
    return null;
}

function showOneTimeCredential(credential, title = 'Тимчасовий пароль, показується один раз', payload = {}) {
    if (!credential) return;
    const text = `Логін: ${credential.username || ''}\nПароль: ${getCredentialPassword(credential)}`;
    const hasReadiness = Object.prototype.hasOwnProperty.call(payload, 'loginReady');
    const readinessMessage = hasReadiness
        ? (payload.loginReady
            ? '\n\nПеревірено сервером: цей логін і пароль готові до входу.'
            : `\n\nУвага: сервер не підтвердив готовність входу (${payload.loginReadyReason || 'невідомо'}).`)
        : '';
    if (typeof confirmModal === 'function') {
        confirmModal(`${title}\n\n${text}${readinessMessage}\n\nСкопіюйте зараз: старий пароль у CRM не можна переглянути повторно.`, {
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
    }
}

function suggestUsernameFromStaffInfo(info = {}) {
    const key = String(info.unique_person_key || '').replace(/\.\w+$/, '');
    const raw = key || info.name || `staff.${info.id || ''}`;
    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.+|\.+$/g, '');
    return normalized || `staff.${info.id || Date.now()}`;
}

function getStaffAccountRole(info = {}) {
    const role = String(info.role_type || '').trim();
    const aliases = {
        trampoline_instructor: 'animator',
        senior_instructor: 'manager',
        cleaner: 'cleaning',
        technician: 'maintenance',
        head_cook: 'head_chef',
        bartender: 'barista',
        hr_manager: 'hr',
        pizzaiolo: 'cook',
        host: 'animator',
        intern: 'animator'
    };
    const mapped = aliases[role] || role;
    const allowed = new Set(['animator', 'manager', 'hr', 'admin', 'cook', 'barista', 'waiter', 'maintenance', 'cleaning']);
    return allowed.has(mapped) ? mapped : 'animator';
}

function getLinkInfo(staffId) {
    return StaffState.linkData.find(r => r.id === staffId);
}

function renderLinkStatsBar() {
    let bar = document.getElementById('linkStatsBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'linkStatsBar';
        bar.className = 'link-stats-bar';
        const summary = document.getElementById('scheduleSummary');
        summary.parentNode.insertBefore(bar, summary);
    }

    const s = StaffState.linkStats || { total: 0, linked: 0, unlinked: 0, freelance: 0 };
    bar.innerHTML = `
        <div class="link-stat">🔗 Акаунти CRM:</div>
        <div class="link-stat"><span class="link-stat-value" style="color:#22c55e">${s.linked}</span> з акаунтом</div>
        <div class="link-stat"><span class="link-stat-value" style="color:#f59e0b">${s.unlinked}</span> без акаунту</div>
        <div class="link-stat"><span class="link-stat-value" style="color:var(--gray-400)">${s.freelance}</span> фріланс</div>
    `;
}

function renderLinkBadge(emp) {
    if (!StaffState.showLinkView) return '';
    const info = getLinkInfo(emp.id);
    if (!info) return '';

    if (info.is_freelance) {
        return '<span class="link-badge freelance-badge" title="Фріланс-слот">~</span>';
    }
    if (info.user_id) {
        return `<span class="link-badge linked" title="Акаунт: ${escapeHtml(info.username)} (${escapeHtml(info.user_role)}) — натисніть для керування" data-linked-user="${Number(info.user_id)}">✅ ${escapeHtml(info.username)}</span>`;
    }
    return `<span class="link-badge unlinked" title="Немає акаунту — натисніть для зв'язки" data-link-staff="${emp.id}">⚠️ Зв'язати</span>`;
}

function renderHrCrosslink(emp) {
    const staffId = Number(emp?.id);
    if (!Number.isFinite(staffId)) return '';
    return `<a href="/hr?employee=${encodeURIComponent(staffId)}" class="hr-crosslink" title="HR профіль" aria-label="Відкрити HR профіль">👤</a>`;
}

function openHrProfile(staffId) {
    if (!Number.isFinite(staffId)) return;
    window.location.href = `/hr?employee=${encodeURIComponent(staffId)}`;
}

// Open link modal for a specific staff member
async function openLinkModal(staffId) {
    const info = getLinkInfo(staffId);
    if (!info) return;

    StaffState.linkingStaffId = staffId;
    StaffState.selectedUserId = null;

    document.getElementById('linkModalTitle').textContent = `🔗 Зв'язати: ${info.name}`;
    document.getElementById('linkModalSubtitle').textContent = `${info.department} — ${info.position}`;
    document.getElementById('linkConfirmBtn').disabled = true;
    document.getElementById('linkSearchInput').value = '';

    // Fetch users if not loaded
    if (StaffState.allUsers.length === 0) await fetchAllUsers();

    renderLinkUsersList('');
    document.getElementById('linkModalOverlay')?.classList.add('visible');
    document.getElementById('linkSearchInput')?.focus();
}

function closeLinkModal() {
    document.getElementById('linkModalOverlay')?.classList.remove('visible');
    StaffState.linkingStaffId = null;
    StaffState.selectedUserId = null;
}

function renderLinkUsersList(searchTerm) {
    const container = document.getElementById('linkUsersList');
    const term = searchTerm.toLowerCase().trim();

    // Filter users — exclude system accounts
    const systemUsers = ['openclaw', 'guardian', 'system'];
    let users = StaffState.allUsers.filter(u =>
        !systemUsers.includes(u.username) && u.role !== 'bot' && u.role !== 'viewer'
    );

    if (term) {
        users = users.filter(u =>
            (u.name || '').toLowerCase().includes(term) ||
            (u.username || '').toLowerCase().includes(term)
        );
    }

    // Mark which users are already linked
    const linkedUserIds = new Set(StaffState.linkData.filter(r => r.user_id).map(r => r.user_id));

    let html = '';
    for (const u of users) {
        const isLinked = linkedUserIds.has(u.id);
        const linkedTo = isLinked ? StaffState.linkData.find(r => r.user_id === u.id) : null;
        const linkedLabel = isLinked ? ` (→ ${linkedTo?.name || '?'})` : '';
        const selected = StaffState.selectedUserId === u.id;

        html += `<div class="link-user-item ${selected ? 'selected' : ''} ${isLinked ? 'opacity-50' : ''}" data-user-id="${u.id}">
            <input type="radio" name="linkUser" class="user-radio" ${selected ? 'checked' : ''} value="${u.id}">
            <div class="link-user-info">
                <span class="link-user-name">${escapeHtml(u.name)} ${isLinked ? '🔗' : ''}</span>
                <span class="link-user-role">@${escapeHtml(u.username)} · ${escapeHtml(u.role)}${linkedLabel}</span>
            </div>
        </div>`;
    }

    if (users.length === 0) {
        html = '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:13px">Нічого не знайдено</div>';
    }

    container.innerHTML = html;

    // Click handlers
    container.querySelectorAll('.link-user-item').forEach(item => {
        item.addEventListener('click', () => {
            StaffState.selectedUserId = parseInt(item.dataset.userId);
            document.getElementById('linkConfirmBtn').disabled = false;
            renderLinkUsersList(document.getElementById('linkSearchInput')?.value || '');
        });
    });
}

async function confirmLinkAccount() {
    if (!StaffState.linkingStaffId || !StaffState.selectedUserId) return;

    try {
        const res = await staffApiFetch(`/api/staff/${StaffState.linkingStaffId}/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: StaffState.selectedUserId })
        });
        const data = await res.json();

        if (data.success) {
            showNotification('Акаунт зв\'язано');
            closeLinkModal();
            await fetchLinkStatus();
            renderLinkStatsBar();
            renderSchedule();
        } else {
            showNotification(data.error || 'Помилка зв\'язування', 'error');
        }
    } catch (err) {
        showNotification('Помилка мережі', 'error');
    }
}

async function createAccountForLinkingStaff() {
    const info = getLinkInfo(StaffState.linkingStaffId);
    if (!info || typeof formModal !== 'function') return;
    const result = await formModal(`Створити акаунт · ${info.name}`, [
        { key: 'name', label: 'Імʼя в CRM', required: true, defaultValue: info.name || '' },
        { key: 'username', label: 'Логін', required: true, defaultValue: suggestUsernameFromStaffInfo(info) },
        { key: 'password', label: 'Пароль вручну або порожньо для one-time', type: 'password', placeholder: 'Порожньо = CRM згенерує одноразовий пароль' },
        { key: 'confirmPassword', label: 'Повторити пароль, якщо вводите вручну', type: 'password' },
        { key: 'role', label: 'Основна роль', type: 'select', defaultValue: getStaffAccountRole(info), options: [
            { value: 'animator', label: 'Аніматор' },
            { value: 'manager', label: 'Менеджер' },
            { value: 'hr', label: 'HR' },
            { value: 'admin', label: 'Адмін' },
            { value: 'cook', label: 'Кухар' },
            { value: 'barista', label: 'Бариста' },
            { value: 'waiter', label: 'Офіціант' },
            { value: 'maintenance', label: 'Технічний директор' },
            { value: 'cleaning', label: 'Прибиральник' }
        ] }
    ], {
        icon: '👤',
        type: 'info',
        okText: 'Створити',
        className: 'staff-account-create-modal',
        validate: validateStaffAccountManualPassword
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
    try {
        const res = await staffApiFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: String(result.username || '').trim(),
                password: issueOneTime ? undefined : password,
                issueOneTime,
                name: String(result.name || '').trim(),
                role: result.role || 'animator',
                staffId: info.id
            })
        });
        const data = await res.json();
        if (!data.success) {
            showNotification(data.error || 'Не вдалося створити акаунт', 'error');
            return;
        }
        closeLinkModal();
        if (data.credential) {
            showOneTimeCredential(data.credential, `Акаунт ${data.user?.username || result.username} створено`, data);
        } else {
            showNotification(`Акаунт ${data.user?.username || result.username} створено`, 'success');
        }
        await fetchAllUsers();
        await fetchLinkStatus();
        renderLinkStatsBar();
        renderSchedule();
    } catch (err) {
        showNotification('Помилка мережі', 'error');
    }
}

// Bulk create accounts
async function handleBulkCreate() {
    const unlinked = StaffState.linkStats?.unlinked || 0;
    if (unlinked === 0) {
        showNotification('Всі працівники вже мають акаунти', 'success');
        return;
    }

    if (!await confirmModal(`Створити акаунти для ${unlinked} працівників без акаунтів?\n\nCRM покаже одноразові логіни і паролі тільки в цьому вікні. CSV/PDF експорт паролів вимкнено.`, { type: 'warning', okText: 'Створити' })) return;

    showNotification('Створюємо акаунти...');
    try {
        const res = await staffApiFetch('/api/staff/bulk-create-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.success) {
            StaffState.bulkResults = data;
            showBulkResults(data);
            await fetchLinkStatus();
            renderLinkStatsBar();
            renderSchedule();
        } else {
            showNotification(data.error || 'Помилка створення', 'error');
        }
    } catch (err) {
        showNotification('Помилка мережі', 'error');
    }
}

function showBulkResults(data) {
    const body = document.getElementById('bulkResultsBody');
    const created = Array.isArray(data.created) ? data.created : [];
    const skipped = Array.isArray(data.skipped) ? data.skipped : [];
    let html = `<p style="margin:0 0 8px;font-size:14px;font-weight:700">Створено: ${created.length} акаунтів</p>`;
    html += '<p style="margin:0 0 8px;font-size:12px;color:var(--warning,#f59e0b)">Паролі показані один раз. CSV/PDF експорт паролів вимкнено.</p>';

    if (skipped.length > 0) {
        html += `<p style="margin:0 0 8px;font-size:12px;color:var(--gray-500)">Пропущено: ${skipped.length} (дублі або вже привʼязані)</p>`;
    }

    html += `<table class="bulk-results-table">
        <thead><tr><th>Ім'я</th><th>Логін</th><th>Пароль</th><th>Роль</th></tr></thead>
        <tbody>`;

    for (const c of created) {
        const password = getCredentialPassword(c.credential) || c.password || '';
        html += `<tr>
            <td style="font-family:inherit;font-weight:600">${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.username)}</td>
            <td>${escapeHtml(password)}</td>
            <td>${escapeHtml(c.role)}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;
    document.getElementById('bulkCsvBtn')?.classList.add('hidden');
    document.getElementById('bulkPdfBtn')?.classList.add('hidden');
    document.getElementById('bulkResultsOverlay')?.classList.add('visible');
}

function closeBulkResults() {
    document.getElementById('bulkResultsOverlay')?.classList.remove('visible');
}

function copyBulkResults() {
    if (!StaffState.bulkResults) return;
    const lines = ['Ім\'я\tЛогін\tПароль\tРоль'];
    for (const c of (StaffState.bulkResults.created || [])) {
        lines.push(`${c.name}\t${c.username}\t${getCredentialPassword(c.credential) || c.password || ''}\t${c.role}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
        showNotification('Скопійовано в буфер обміну');
    });
}

function downloadBulkCsv() {
    showNotification('CSV експорт паролів вимкнено: one-time credentials можна тільки скопіювати зараз.', 'warning');
}

async function downloadBulkPdf() {
    showNotification('PDF експорт паролів вимкнено: one-time credentials можна тільки скопіювати зараз.', 'warning');
}

// Excel import
function triggerExcelImport() {
    document.getElementById('excelImportInput')?.click();
}

async function handleExcelImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    showNotification('Імпортуємо з Excel...');
    const token = localStorage.getItem('pzp_token');
    const res = await fetch('/api/staff/import-excel', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
    const data = await res.json();

    if (data.success) {
        showNotification(`Імпорт: ${data.created} створено, ${data.updated} оновлено, ${data.skipped} пропущено`);
        await fetchStaff();
        await fetchLinkStatus();
        renderSchedule();
        renderLinkStatsBar();
    } else {
        showNotification(data.error || 'Помилка імпорту', 'error');
    }
    e.target.value = '';
}

// ==========================================
// EXCEL EXPORT
// ==========================================

function scheduleExportVisibleStaff() {
    return scheduleFinalVisibleStaffSnapshot(StaffState.staff, getScheduleDates()).visible;
}

function scheduleExportCell(entry) {
    const status = entry ? normalizeScheduleStatus(entry.status) : 'unset';
    const label = STAFF_SCHEDULE_STATUS_LABELS[status] || status || '';
    const note = String(entry?.note || '').trim();
    const lines = [];
    const segments = scheduleEntrySegmentsForUi(entry, entry?.profession_key);
    if (segments.length && ['working', 'remote'].includes(status)) {
        segments.forEach(segment => {
            const additionalRoles = segment.additionalProfessionKeys.length
                ? ` + ${segment.additionalProfessionKeys.map(professionLabel).join(', ')}`
                : '';
            const breakLabel = segment.breakMinutes > 0 ? ` · перерва ${segment.breakMinutes} хв` : '';
            lines.push(`${segment.shiftStart}-${segment.shiftEnd} · ${professionLabel(segment.professionKey)}${additionalRoles}${breakLabel}`);
            if (segment.note) lines.push(`↳ ${segment.note}`);
        });
        lines.push(`Разом: ${formatScheduleMinutes(schedulePlanMetrics(segments).plannedMinutes)}`);
    }
    if (status && status !== 'working' && status !== 'unset') lines.push(label);
    if (!segments.length && status === 'working') lines.push(label);
    if (note) lines.push(note);
    return {
        status: String(status || 'unset').replace(/[^a-z0-9_-]/gi, ''),
        text: lines.join('\n'),
        html: lines.map(escapeHtml).join('<br>')
    };
}

function scheduleWorkbookSafeWorksheetName(label = '', usedNames = new Set()) {
    const cleaned = String(label || '')
        .replace(/[\\/?*\[\]:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const base = (cleaned || 'Графік').slice(0, 31) || 'Графік';
    let name = base;
    let counter = 2;
    while (usedNames.has(name.toLowerCase())) {
        const suffix = ` ${counter++}`;
        name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    }
    usedNames.add(name.toLowerCase());
    return name;
}

function buildScheduleWorkbookModel() {
    const dates = getScheduleDates();
    const exportStaff = uniqueScheduleStaffById(scheduleExportVisibleStaff());
    const grouped = groupStaffByScheduleDepartment(exportStaff, {
        department: StaffState.activeDept,
        grouping: StaffState.activeDept === 'all' ? 'membership' : 'canonical'
    });
    const from = dates[0];
    const to = getScheduleRangeEnd(dates);
    const periodLabel = formatScheduleRangeLabel(from, to);
    const generatedAt = new Date().toLocaleString('uk-UA');
    const usedSheetNames = new Set();
    const sheets = [];

    for (const dept of scheduleDepartmentRenderOrder(grouped)) {
        const deptStaff = grouped[dept] || [];
        if (deptStaff.length === 0) continue;
        const deptLabel = scheduleDisplayDepartmentLabel(dept);
        const sheetName = scheduleWorkbookSafeWorksheetName(deptLabel, usedSheetNames);
        const rows = [];
        const subGroups = DEPT_SUB_GROUPS[dept];
        const subGroupPartition = partitionScheduleStaffBySubGroup(dept, deptStaff, subGroups, {
            activeDepartment: dept
        });
        const renderableSubGroups = subGroupPartition.groups
            .filter(group => !shouldSkipScheduleSubGroup(dept, group.subGroup));

        const renderStaffRow = (emp, subGroup = null) => {
            const staffId = normalizeScheduleStaffId(emp.id);
            const subGroupIdentity = scheduleSubGroupIdentity(subGroup || {});
            const subGroupLabel = subGroup?.label || '';
            const cells = [];
            for (const d of dates) {
                const ds = formatDateStr(d);
                const entry = StaffState.schedule[`${emp.id}_${ds}`];
                cells.push(scheduleExportCell(entry));
            }
            rows.push({
                staffId,
                department: dept,
                departmentLabel: deptLabel,
                subGroupIdentity,
                subGroupLabel,
                employee: scheduleStaffDisplayName(emp),
                role: staffCardRoleSummary(emp) || emp.position || '',
                cells
            });
        };

        const renderedStaffIds = new Set();
        for (const group of renderableSubGroups) {
            for (const emp of group.staff.filter(staff => !renderedStaffIds.has(normalizeScheduleStaffId(staff.id)))) {
                const staffId = normalizeScheduleStaffId(emp.id);
                renderedStaffIds.add(staffId);
                renderStaffRow(emp, group.subGroup);
            }
        }
        for (const emp of uniqueScheduleStaffById(deptStaff).filter(staff => !renderedStaffIds.has(normalizeScheduleStaffId(staff.id)))) {
            const staffId = normalizeScheduleStaffId(emp.id);
            renderStaffRow(emp, subGroupPartition.ownershipByStaffId.get(staffId) || null);
        }

        sheets.push({ dept, deptLabel, sheetName, rows });
    }

    if (!sheets.length) {
        const sheetName = scheduleWorkbookSafeWorksheetName('Графік', usedSheetNames);
        sheets.push({
            dept: '',
            deptLabel: 'Графік роботи',
            sheetName,
            rows: []
        });
    }

    return {
        period: {
            from: formatDateStr(from),
            to: formatDateStr(to),
            label: periodLabel,
            generatedAt
        },
        dates: dates.map(date => ({
            date: formatDateStr(date),
            day: String(date.getDate()),
            weekday: STAFF_SCHEDULE_DAYS_UK[date.getDay()] || ''
        })),
        sheets
    };
}

function buildScheduleWorkbookExportPayload() {
    const model = buildScheduleWorkbookModel();
    return {
        period: model.period,
        dates: model.dates,
        sheets: model.sheets.map(sheet => ({
            name: sheet.sheetName,
            label: sheet.deptLabel,
            rows: sheet.rows.map(row => ({
                staffId: row.staffId,
                department: row.department,
                departmentLabel: row.departmentLabel,
                subGroupLabel: row.subGroupLabel,
                employee: row.employee,
                role: row.role,
                cells: row.cells.map(cell => ({ status: cell.status, text: cell.text }))
            }))
        }))
    };
}

function buildScheduleWorkbookHtml(options = {}) {
    const model = buildScheduleWorkbookModel();
    const columnCount = model.dates.length + 4;
    const headerCells = model.dates.map(date => `
            <th scope="col" class="date-col">
                <div>${escapeHtml(date.day)}</div>
                <small>${escapeHtml(date.weekday)}</small>
            </th>`).join('');
    const renderBodyRows = sheet => {
        if (!sheet.rows.length) {
            return `<tr><td colspan="${columnCount}" class="empty-cell">Немає співробітників у поточному фільтрі</td></tr>`;
        }
        const departmentRow = `<tr class="dept-row"><td colspan="${columnCount}">${escapeHtml(sheet.deptLabel)} · ${sheet.rows.length}</td></tr>`;
        const staffRows = sheet.rows.map(row => {
            const subGroupAttributes = row.subGroupIdentity
                ? ` data-schedule-subgroup="${escapeHtml(row.subGroupIdentity)}" data-schedule-subgroup-label="${escapeHtml(row.subGroupLabel)}"`
                : '';
            const cells = row.cells
                .map(cell => `<td class="shift-cell status-${escapeHtml(cell.status)}">${cell.html || '&nbsp;'}</td>`)
                .join('');
            return `<tr data-schedule-export-staff-id="${row.staffId}" data-schedule-export-department="${escapeHtml(row.department)}"${subGroupAttributes}>
            <td class="dept-cell">${escapeHtml(row.departmentLabel)}</td>
            <td class="subgroup-cell">${escapeHtml(row.subGroupLabel)}</td>
            <td class="employee-cell">${escapeHtml(row.employee)}</td>
            <td class="role-cell">${escapeHtml(row.role)}</td>
            ${cells}
        </tr>`;
        }).join('\n        ');
        return `${departmentRow}\n        ${staffRows}`;
    };

    const printCss = options.print ? `
        @page { size: landscape; margin: 10mm; }
        body { background: #fff; }
        .sheet { box-shadow: none; padding: 0; }
        .sheet:not(:last-child) { page-break-after: always; break-after: page; }
    ` : '';

    return `<!doctype html>
<html lang="uk">
<head>
    <meta charset="utf-8">
    <title>Графік роботи ${escapeHtml(model.period.label)}</title>
    <style>
        body { margin: 0; padding: 18px; background: #eef2f7; color: #111827; font-family: Calibri, Arial, sans-serif; }
        .sheet { background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 18px; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12); }
        .sheet + .sheet { margin-top: 18px; }
        h1 { margin: 0 0 4px; font-size: 22px; color: #0f172a; }
        .meta { margin: 0 0 14px; color: #475569; font-size: 13px; }
        table.schedule-export-table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 12px; }
        .schedule-export-table th, .schedule-export-table td { border: 1px solid #cbd5e1; padding: 7px 8px; vertical-align: middle; mso-number-format: "\\@"; }
        .schedule-export-table thead th { background: #0f766e; color: #fff; font-weight: 700; text-align: center; }
        .schedule-export-table thead th small { display: block; color: #ccfbf1; font-size: 10px; margin-top: 2px; }
        .dept-cell, .subgroup-cell, .role-cell { color: #475569; }
        .employee-cell { color: #0f172a; font-weight: 700; min-width: 180px; }
        .role-cell { min-width: 150px; }
        .date-col { width: 86px; }
        .dept-row td { background: #e0f2fe; color: #075985; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; }
        .shift-cell { text-align: center; white-space: normal; line-height: 1.25; }
        .status-working { background: #dcfce7; color: #14532d; font-weight: 700; }
        .status-remote { background: #e0e7ff; color: #3730a3; font-weight: 700; }
        .status-dayoff, .status-day_off { background: #f1f5f9; color: #475569; }
        .status-vacation { background: #dbeafe; color: #1d4ed8; font-weight: 700; }
        .status-sick { background: #fee2e2; color: #991b1b; font-weight: 700; }
        .status-unset { background: #fff; color: #94a3b8; }
        .empty-cell { padding: 22px; text-align: center; color: #64748b; }
        ${printCss}
    </style>
</head>
<body>
    ${model.sheets.map(sheet => `<div class="sheet" data-schedule-workbook-sheet="${escapeHtml(sheet.sheetName)}" data-schedule-workbook-department="${escapeHtml(sheet.dept)}">
        <h1>Графік роботи · ${escapeHtml(sheet.deptLabel)}</h1>
        <p class="meta">Період: ${escapeHtml(model.period.label)} · Відділ: ${escapeHtml(sheet.deptLabel)} · Згенеровано: ${escapeHtml(model.period.generatedAt)}</p>
        <table class="schedule-export-table">
            <thead>
                <tr>
                    <th scope="col">Відділ</th>
                    <th scope="col">Підгрупа</th>
                    <th scope="col">Співробітник</th>
                    <th scope="col">Посада</th>
                    ${headerCells}
                </tr>
            </thead>
            <tbody>${renderBodyRows(sheet)}
            </tbody>
        </table>
    </div>`).join('\n    ')}
</body>
</html>`;
}

async function handleExcelExport() {
    if (!scheduleRangeDataReady()) {
        showNotification('Експорт доступний лише для підтвердженого періоду', 'error');
        return false;
    }
    const touchWindow = typeof openTouchDownloadWindow === 'function'
        ? openTouchDownloadWindow('Графік Excel')
        : null;
    try {
        const payload = buildScheduleWorkbookExportPayload();
        const response = await staffApiFetch('/api/staff/schedule/export-xlsx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.error || 'Не вдалося сформувати Excel-файл');
        }
        const blob = await response.blob();
        const filename = `grafik_${payload.period.from}_${payload.period.to}.xlsx`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'Графік експортовано в Excel' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            showNotification('Графік експортовано в Excel');
        }
        return true;
    } catch (err) {
        if (touchWindow && !touchWindow.closed && typeof touchWindow.close === 'function') touchWindow.close();
        console.error('Staff schedule Excel export error:', err);
        showNotification(err.message || 'Не вдалося експортувати графік', 'error');
        return false;
    }
}

// ==========================================
// PRINT
// ==========================================

function handlePrint() {
    if (!scheduleRangeDataReady()) {
        showNotification('Друк доступний лише для підтвердженого періоду', 'error');
        return false;
    }
    const printWindow = window.open('', 'staffSchedulePrint', 'width=1280,height=900');
    if (!printWindow || !printWindow.document) {
        showNotification('Не вдалося відкрити вікно друку. Дозвольте pop-up або скористайтесь експортом.', 'error');
        return false;
    }
    printWindow.document.open();
    printWindow.document.write(buildScheduleWorkbookHtml({ print: true }));
    printWindow.document.close();
    const runPrint = () => {
        if (typeof printWindow.focus === 'function') printWindow.focus();
        if (typeof printWindow.print === 'function') printWindow.print();
    };
    if (typeof printWindow.setTimeout === 'function') {
        printWindow.setTimeout(runPrint, 120);
    } else {
        window.setTimeout(runPrint, 120);
    }
    return true;
}

// v39.11: Add staff modal
async function openAddStaffModal() {
    const DEPTS = getDepartmentOptionsFromStaffState();
    const defaultDepartment = DEPTS[0]?.value || 'animators';
    const roleOptionsByDepartment = staffRoleOptionsByDepartment();
    if (typeof formModal !== 'function') return;
    const result = await formModal('Додати співробітника', [
        { key: 'name', label: 'ПІБ', required: true, placeholder: 'Прізвище Ім\'я По батькові' },
        { key: 'department', label: 'Відділ', type: 'select', options: DEPTS, defaultValue: defaultDepartment, required: true },
        { key: 'position', label: 'Посада', placeholder: 'Аніматор, Менеджер...', required: true },
        {
            key: 'role_type',
            label: 'Роль',
            type: 'select',
            options: roleOptionsByDepartment[defaultDepartment] || staffRoleOptions(),
            optionsBy: roleOptionsByDepartment,
            dependsOn: 'department'
        },
        {
            key: 'secondary_professions',
            label: 'Додаткові професії',
            type: 'textarea',
            placeholder: 'host, trampoline_instructor',
            hint: 'Основна роль лишається джерелом групування графіка.'
        },
        { key: 'phone', label: 'Телефон', placeholder: '+380...' },
        { key: 'address', label: 'Адреса', placeholder: 'Місто, вулиця, будинок' }
    ], { icon: '👤', okText: 'Додати' });
    if (!result) return;
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch('/api/staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                name: result.name.trim(),
                department: result.department,
                position: result.position || '',
                role_type: result.role_type || staffRoleOptions()[0]?.value || 'animator',
                secondary_professions: String(result.secondary_professions || '').split(/[\n,;]+/).map(item => item.trim()).filter(Boolean),
                phone: result.phone || '',
                address: result.address || ''
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (typeof showNotification === 'function') showNotification(err.error || 'Помилка додавання', 'error');
            return;
        }
        if (typeof showNotification === 'function') showNotification('Співробітника додано!', 'success');
        await fetchStaff();
        renderSchedule();
    } catch (e) { if (typeof showNotification === 'function') showNotification(e.message, 'error'); }
}

// Dark mode: handled by shared initDarkMode() from config.js

// ==========================================
// INIT
// ==========================================

function captureStaffScheduleRefreshState() {
    return {
        weekStart: StaffState.weekStart ? cloneScheduleDate(StaffState.weekStart) : null,
        rangeStart: StaffState.rangeStart ? cloneScheduleDate(StaffState.rangeStart) : null,
        rangeEnd: StaffState.rangeEnd ? cloneScheduleDate(StaffState.rangeEnd) : null,
        rangeMode: StaffState.rangeMode,
        activeDept: StaffState.activeDept,
        searchQuery: StaffState.searchQuery,
        healthFilter: StaffState.healthFilter,
        expandedScheduleGroups: new Set(
            StaffState.expandedScheduleGroups instanceof Set ? StaffState.expandedScheduleGroups : []
        )
    };
}

function restoreStaffScheduleRefreshState(snapshot = {}) {
    StaffState.weekStart = snapshot.weekStart ? cloneScheduleDate(snapshot.weekStart) : null;
    StaffState.rangeStart = snapshot.rangeStart ? cloneScheduleDate(snapshot.rangeStart) : null;
    StaffState.rangeEnd = snapshot.rangeEnd ? cloneScheduleDate(snapshot.rangeEnd) : null;
    StaffState.rangeMode = snapshot.rangeMode || StaffState.rangeMode;
    StaffState.activeDept = snapshot.activeDept || 'all';
    StaffState.searchQuery = String(snapshot.searchQuery || '');
    StaffState.healthFilter = snapshot.healthFilter || 'all';
    StaffState.expandedScheduleGroups = new Set(
        snapshot.expandedScheduleGroups instanceof Set ? snapshot.expandedScheduleGroups : []
    );
}

async function performStaffScheduleRefresh(options = {}) {
    if (!staffScheduleInitialized && staffScheduleInitPromise) {
        await staffScheduleInitPromise;
    }
    if (!staffScheduleInitialized) {
        return { success: false, skipped: true, reason: 'not_initialized' };
    }

    const changedStaffId = normalizeScheduleFocusStaffId(options.staffId || options.changedStaffId);
    const preservedState = captureStaffScheduleRefreshState();
    const previousData = {
        professions: StaffState.professions,
        staff: StaffState.staff,
        departments: StaffState.departments,
        displayGroups: StaffState.displayGroups
    };

    const [professionsResult, staffResult] = await Promise.all([
        fetchHrProfessions(),
        fetchStaff()
    ]);

    if (!professionsResult?.success) StaffState.professions = previousData.professions;
    if (!staffResult?.success) {
        StaffState.staff = previousData.staff;
        StaffState.departments = previousData.departments;
        StaffState.displayGroups = previousData.displayGroups;
    }
    if (changedStaffId) delete StaffState.shiftPreferences[changedStaffId];
    restoreStaffScheduleRefreshState(preservedState);
    renderDeptFilter();
    renderSchedule();
    if (StaffState.showLoadView) renderLoadView();

    return {
        success: Boolean(professionsResult?.success && staffResult?.success),
        professions: professionsResult,
        staff: staffResult
    };
}

function refreshStaffSchedulePage(options = {}) {
    const changedStaffId = normalizeScheduleFocusStaffId(options.staffId || options.changedStaffId);
    if (changedStaffId) {
        StaffState.shiftPreferencesLoadSeq += 1;
        delete StaffState.shiftPreferences[changedStaffId];
    }
    const refreshOptions = { ...options, changedStaffId };
    const refreshTask = staffScheduleRefreshQueue
        .catch(() => {})
        .then(() => performStaffScheduleRefresh(refreshOptions));
    staffScheduleRefreshQueue = refreshTask;
    return refreshTask;
}

async function initStaffSchedulePage(options = {}) {
    if (staffScheduleInitPromise) return staffScheduleInitPromise;
    staffScheduleInitPromise = (async () => {
        const mode = staffScheduleMode(options);
        const initialFocusStaffId = normalizeScheduleFocusStaffId(options.focusStaffId) || scheduleFocusStaffIdFromLocation();
        applyStaffScheduleHostMode(mode);
        hydrateScheduleExpandedGroups();
        const host = ensureStaffScheduleShell(options);
        if (!host) throw new Error('Staff schedule shell is not available');
        setScheduleRangeLoadState('idle');

        if (typeof initDarkMode === 'function') initDarkMode();
        if (mode !== 'hr') renderStaffPulseSwitcher();

        let user = options.user || (typeof AppState !== 'undefined' ? AppState.currentUser : null);
        if (!user && typeof apiVerifyToken === 'function') {
            user = await apiVerifyToken();
        }
        if (!user) {
            if (mode !== 'hr') window.location.href = '/';
            else throw new Error('Staff schedule user is not available');
            return;
        }

        if (typeof AppState !== 'undefined') AppState.currentUser = user;
        if (mode !== 'hr') {
            const _userEl = document.getElementById('currentUser');
            if (_userEl) _userEl.textContent = user.name;
            if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
            else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
            if (typeof bindLogoutButton === 'function') bindLogoutButton();
        }

        const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr'];
        const canManage = MANAGE_ROLES.includes(user.role);
        StaffState.canManage = canManage;
        const ADMIN_ROLES = ['creator', 'director'];
        const isAdmin = ADMIN_ROLES.includes(user.role);
        const addBtn = document.getElementById('addStaffBtn');
        if (addBtn) addBtn.style.display = canManage ? '' : 'none';

        // Show admin-only buttons
        const copyBtn = document.getElementById('copyWeekBtn');
        const fillBtn = document.getElementById('fillWeekBtn');
        if (copyBtn) copyBtn.style.display = canManage ? '' : 'none';
        if (fillBtn) fillBtn.style.display = canManage ? '' : 'none';

        // v39.1: Show bulk create and import buttons only for creator/director
        const bulkBtn = document.getElementById('bulkCreateBtn');
        const importBtn = document.getElementById('importExcelBtn');
        if (bulkBtn) bulkBtn.style.display = isAdmin && mode !== 'hr' ? '' : 'none';
        if (importBtn) importBtn.style.display = isAdmin ? '' : 'none';

        // Load data
        await fetchHrProfessions();
        await fetchStaff();
        if (initialFocusStaffId) focusScheduleStaff(initialFocusStaffId, { render: false });
        renderDeptFilter();

        // Init the rolling window: yesterday, today, and the upcoming days.
        resetSchedulePrimaryViewMode();
        await goToWeek(getScheduleFocusStart(new Date()));

        // Event listeners
        bindScheduleRangeControls();
        bindScheduleLayoutViewportSync();
        bindScheduleViewSwitchControls();
        document.getElementById('prevWeekBtn')?.addEventListener('click', prevWeek);
        document.getElementById('nextWeekBtn')?.addEventListener('click', nextWeek);
        document.getElementById('todayWeekBtn')?.addEventListener('click', goToday);
        document.getElementById('schSaveBtn')?.addEventListener('click', handleSave);
        document.getElementById('schReplaceBtn')?.addEventListener('click', handleReplaceSchedule);
        document.getElementById('schClearReplacementBtn')?.addEventListener('click', handleClearReplacement);
        document.getElementById('schCancelBtn')?.addEventListener('click', () => closeEditModal(false));
        document.getElementById('schStatus')?.addEventListener('change', toggleTimeFields);
        bindSchedulePlanEditor('schedule');
        document.getElementById('schShiftPreferencePanel')?.addEventListener('click', event => {
            const button = event.target.closest('[data-shift-pref-start][data-shift-pref-end]');
            if (!button || button.disabled || !StaffState.canManage) return;
            applyScheduleShiftPreference({
                professionKey: getActiveScheduleSegmentCard()?.querySelector('[data-segment-field="profession"]')?.value,
                dayType: button.dataset.shiftPrefDay,
                startTime: button.dataset.shiftPrefStart,
                endTime: button.dataset.shiftPrefEnd,
                isActive: true
            });
        });
        document.getElementById('schHistoryRefreshBtn')?.addEventListener('click', () => {
            const editing = StaffState.editingCell;
            if (editing) loadScheduleCellHistory(editing.staffId, editing.date);
        });

        document.getElementById('schModalOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeEditModal(false);
        });

        // Fill week modal
        document.getElementById('fillWeekBtn')?.addEventListener('click', openFillWeekModal);
        document.getElementById('fillSaveBtn')?.addEventListener('click', handleFillWeekSave);
        document.getElementById('fillCancelBtn')?.addEventListener('click', () => closeFillWeekModal(false));
        document.getElementById('fillStatus')?.addEventListener('change', toggleFillTimeFields);
        document.getElementById('fillStaffSelect')?.addEventListener('change', () => {
            const primaryProfessionKey = document.getElementById('fillPrimaryProfession')?.value || '';
            renderSchedulePlanEditor('fill', readSchedulePlanSegments('fill'), { primaryProfessionKey });
        });
        bindSchedulePlanEditor('fill');
        document.getElementById('fillWeekOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeFillWeekModal(false);
        });

        // Copy week
        document.getElementById('copyWeekBtn')?.addEventListener('click', handleCopyWeek);

        // View switch controls are bound by bindScheduleViewSwitchControls().
        document.getElementById('bulkCreateBtn')?.addEventListener('click', handleBulkCreate);
        document.getElementById('importExcelBtn')?.addEventListener('click', triggerExcelImport);
        document.getElementById('excelImportInput')?.addEventListener('change', handleExcelImport);
        document.getElementById('exportExcelBtn')?.addEventListener('click', handleExcelExport);
        document.getElementById('printBtn')?.addEventListener('click', handlePrint);
        document.getElementById('scheduleRangeRetryBtn')?.addEventListener('click', retryScheduleRangeLoad);

        // v39.11: Add staff button
        document.getElementById('addStaffBtn')?.addEventListener('click', openAddStaffModal);

        // Link modal
        document.getElementById('linkConfirmBtn')?.addEventListener('click', confirmLinkAccount);
        document.getElementById('linkCreateAccountBtn')?.addEventListener('click', createAccountForLinkingStaff);
        document.getElementById('linkCancelBtn')?.addEventListener('click', closeLinkModal);
        document.getElementById('linkSearchInput')?.addEventListener('input', (e) => {
            renderLinkUsersList(e.target.value);
        });
        document.getElementById('linkModalOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeLinkModal();
        });

        // Bulk results modal
        document.getElementById('bulkCloseBtn')?.addEventListener('click', closeBulkResults);
        document.getElementById('bulkCopyBtn')?.addEventListener('click', copyBulkResults);
        document.getElementById('bulkCsvBtn')?.addEventListener('click', downloadBulkCsv);
        document.getElementById('bulkPdfBtn')?.addEventListener('click', downloadBulkPdf);
        document.getElementById('bulkResultsOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeBulkResults();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            if (document.getElementById('fillWeekOverlay')?.classList.contains('visible')) closeFillWeekModal(false);
            else if (document.getElementById('linkModalOverlay')?.classList.contains('visible')) closeLinkModal();
            else if (document.getElementById('bulkResultsOverlay')?.classList.contains('visible')) closeBulkResults();
        });

        staffScheduleInitialized = true;
    })();
    staffScheduleInitPromise.catch(() => {
        staffScheduleInitPromise = null;
        staffScheduleInitialized = false;
    });
    return staffScheduleInitPromise;
}

window.StaffSchedulePage = {
    init: initStaffSchedulePage,
    refresh: refreshStaffSchedulePage,
    isInitialized: () => staffScheduleInitialized,
    focusStaff: focusScheduleStaff,
    openDayPlan: openScheduleDayPlan,
    renderSchedule
};

document.addEventListener('DOMContentLoaded', () => {
    if (shouldAutoInitStaffSchedulePage()) initStaffSchedulePage({ mode: 'standalone' });
});
})();
