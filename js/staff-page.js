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
    staff: [],
    schedule: {},       // { staffId_date: entry }
    scheduleLoadedRange: null,
    scheduleRawEntries: [], // raw rows for health duplicate/overlap checks
    attendance: {},      // { staffId_date: payroll-ready hr_time_records/staff_checkins row }
    attendanceSummary: null,
    staffingForecast: null,
    staffingForecastBookings: {}, // { date: booking[] } from /api/bookings/:date
    staffingForecastAvailable: false,
    managerAccountability: null,
    accountabilityDeptFilter: 'all',
    accountabilityManagerFilter: 'all',
    scheduleHistory: {}, // { staffId_date: audit entries }
    departments: {},
    displayGroups: [],
    activeDept: 'all',
    healthFilter: 'all',
    includeFreelance: false,
    editingCell: null,  // { staffId, date }
    hoursData: null,    // { staffId: { totalHours, workingDays, ... } }
    showHours: false,
    showLoadView: false,
    showLinkView: false,    // v39.1: account linking overlay
    canManage: false,
    linkData: [],           // v39.1: link-status data
    linkStats: null,        // v39.1: { total, linked, unlinked, freelance }
    allUsers: [],           // v39.1: all users for linking
    professions: [],
    linkingStaffId: null,   // v39.1: staff being linked
    selectedUserId: null,   // v39.1: selected user in link modal
    bulkResults: null,      // v39.1: bulk create results
};

const DEPT_ICONS = {
    animators: '🎭',
    trampoline: '🤸',
    reception: '🛎️',
    admin: '💼',
    cafe: '☕',
    tech: '🔧',
    cleaning: '🧹',
    security: '🛡️'
};

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
        { key: 'animator', label: 'Аніматори', icon: '🎭' },
        { key: 'trampoline_instructor,senior_instructor,instructor', label: 'Батутисти', icon: '🤸' }
    ],
    trampoline: [
        { key: 'trampoline_instructor,senior_instructor,instructor', label: 'Батутисти', icon: '🤸' },
        { key: 'animator', label: 'Аніматори', icon: '🎭' }
    ],
    admin: [
        { key: 'vice_director,art_director,senior_manager', label: 'Керівники', icon: '👑' },
        { key: 'manager', label: 'Менеджери', icon: '💼' },
        { key: 'admin', label: 'Адміністратори', icon: '📋' },
        { key: 'reception', label: 'Рецепція', icon: '🛎️' },
        { key: 'accountant', label: 'Бухгалтери', icon: '💰' },
        { key: 'hr', label: 'HR', icon: '👥' }
    ],
    reception: [
        { key: 'reception', label: 'Рецепція', icon: '🛎️' },
        { key: 'manager,senior_manager', label: 'Менеджери', icon: '💼' }
    ],
    cafe: [
        { key: 'cook', label: 'Кухня', icon: '🍳' },
        { key: 'pizzaiolo', label: 'Піцайоло', icon: '🍕' },
        { key: 'barista', label: 'Бариста', icon: '☕' },
        { key: 'waiter', label: 'Офіціанти', icon: '🍽️' }
    ],
    tech: [
        { departments: 'tech', label: 'Технічний відділ', icon: '🔧' },
        { departments: 'security', key: 'security', label: 'Охорона', icon: '🛡️' }
    ],
    cleaning: [
        { key: 'cleaner,cleaning', label: 'Прибиральники', icon: '🧹' },
        { key: 'dishwasher', label: 'Мийка', icon: '🧽' },
        { key: 'wardrobe', label: 'Гардероб', icon: '🧥' }
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

function staffMatchesDepartmentSubGroup(staff = {}, subGroup = {}) {
    const departmentKeys = departmentSubGroupDepartmentKeys(subGroup);
    if (departmentKeys.length) return departmentKeys.includes(String(staff.department || '').trim());
    const roleKey = normalizeProfessionKey(staff.role_type);
    return Boolean(roleKey && departmentSubGroupRoleKeys(subGroup).includes(roleKey));
}

function shouldRenderDepartmentSubGroups(deptStaff = [], subGroups = null) {
    return Array.isArray(subGroups) && subGroups.length > 0 && Array.isArray(deptStaff) && deptStaff.length > 0;
}

function departmentSubGroupRoleKeySet(subGroups = []) {
    return new Set((subGroups || []).flatMap(departmentSubGroupRoleKeys));
}

function staffMatchesAnyDepartmentSubGroup(staff = {}, subGroups = []) {
    return (subGroups || []).some(subGroup => staffMatchesDepartmentSubGroup(staff, subGroup));
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
    const total = Number(readiness.total || 0);
    const completed = Number(readiness.completed || 0);
    const percent = total
        ? Math.max(0, Math.min(100, Number(readiness.percent || Math.round((completed / total) * 100))))
        : 0;
    return { hasData: true, total, completed, percent };
}

function renderStaffCardReadinessBadge(staff = {}) {
    const readiness = staffCardTrainingReadiness(staff);
    if (!readiness.hasData) {
        return '<span class="staff-card-badge warn" title="Готовність: дані навчання не передано у staff-card">Навч.</span>';
    }
    if (!readiness.total) {
        return '<span class="staff-card-badge warn" title="Готовність: чеклісти навчання не налаштовані">Навч.</span>';
    }
    const state = readiness.percent >= 85 ? 'ok' : (readiness.percent >= 45 ? 'neutral' : 'warn');
    const title = `Готовність навчання: ${readiness.completed}/${readiness.total}`;
    return `<span class="staff-card-badge ${state}" title="${escapeHtml(title)}">${readiness.percent}%</span>`;
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
    return (Array.isArray(staffList) ? staffList : [])
        .filter(staff => isScheduleableStaffForUi(staff, date));
}

function scheduleableStaffErrorMessage(result = {}, fallback = 'Помилка збереження') {
    const code = String(result?.code || '').trim();
    if (code === 'STAFF_INACTIVE') return 'Працівник неактивний і не може бути доданий в активний графік.';
    if (code === 'STAFF_BLACKLISTED') return 'Працівник у чорному списку і не може бути доданий в активний графік.';
    if (code === 'STAFF_NOT_CORE_POOL') return 'Працівник не в основній команді і не може бути доданий в активний графік.';
    if (code === 'STAFF_FREELANCE_NOT_ALLOWED') return 'Фріланс-працівник не може бути доданий без explicit режиму.';
    if (code === 'STAFF_TERMINATED') return 'Працівник звільнений на дату цієї зміни.';
    if (code === 'STAFF_NOT_SCHEDULEABLE') return 'Працівник не доступний для активного графіка на цю дату.';
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

function formatShiftLoadRatio(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    return String(Math.round(value * 100) / 100).replace(/\.0$/, '');
}

function scheduleShiftLoadMeta(entry = {}) {
    const status = normalizeScheduleStatus(entry.status);
    if (!['working', 'remote'].includes(status)) return { bucket: '', className: '', label: '', minutes: 0, ratio: null };
    const start = scheduleTimeToMinutes(entry.shift_start);
    const end = scheduleTimeToMinutes(entry.shift_end);
    if (start === null || end === null) return { bucket: '', className: '', label: '', minutes: 0, ratio: null };
    let minutes = end - start;
    if (minutes <= 0) minutes += 24 * 60;
    if (minutes <= 0) return { bucket: '', className: '', label: '', minutes: 0, ratio: null };
    const exactRatio = minutes / STAFF_FULL_SHIFT_MINUTES;
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
    const professionKey = normalizeProfessionKey(entry.profession_key || currentStaff.role_type);
    return StaffState.staff
        .filter(staff => isScheduleableStaffForUi(staff, entry.date))
        .filter(staff => Number(staff.id) !== Number(entry.staff_id))
        .filter(staff => staffHasProfession(staff, professionKey))
        .filter(staff => !scheduleHasBlockingConflict(staff.id, entry.date, entry.id))
        .map(staff => ({
            value: String(staff.id),
            label: `${staff.name} - ${staff.position || professionLabel(staff.role_type)}`
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'uk'));
}

function scheduleEntryTitle(emp, date, entry, shiftStart, shiftEnd) {
    const parts = [`${emp.name} - ${date}`];
    if (shiftStart && shiftEnd) parts.push(`${String(shiftStart).slice(0, 5)}-${String(shiftEnd).slice(0, 5)}`);
    const loadMeta = scheduleShiftLoadMeta({ ...entry, shift_start: shiftStart, shift_end: shiftEnd });
    if (loadMeta.label && loadMeta.showBadge) parts.push(`load ${loadMeta.label}x`);
    if (isReplacementEntry(entry)) {
        parts.push(`Заміна за: ${entry.original_staff_name || 'працівника'}`);
        if (entry.replacement_reason) parts.push(`Причина: ${entry.replacement_reason}`);
    }
    return parts.join(' | ');
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

function isScheduleManagerStaff(staff = {}) {
    const keys = [staff.role_type, ...staffSecondaryProfessions(staff)].map(normalizeProfessionKey).filter(Boolean);
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

function buildScheduleHealth(dates = getWeekDates(StaffState.weekStart), visibleStaff = scheduleVisibleStaff()) {
    const dateKeys = dates.map(formatDateStr);
    const dateSet = new Set(dateKeys);
    const staffById = new Map((visibleStaff || []).map(staff => [Number(staff.id), staff]));
    const issues = [];
    const rowIssuesByStaff = new Map();
    const staffIssuesByStaff = new Map();
    const cellIssuesByKey = new Map();
    const dayIssuesByDate = new Map();
    const departmentIssuesByKey = new Map();
    const rawEntriesByCell = new Map();

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

    for (const staff of visibleStaff || []) {
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
        if (!readiness.hasData || !readiness.total) {
            addIssue(scheduleHealthIssue({ code: 'missing_readiness', severity: 'warning', scope: 'row', title: 'No readiness', detail: 'У staff-card немає підтвердженої readiness/навчальної готовності.', staff, department }));
        } else if (readiness.percent < 45) {
            addIssue(scheduleHealthIssue({ code: 'low_readiness', severity: 'warning', scope: 'row', title: 'Low readiness', detail: `Готовність навчання ${readiness.percent}%.`, staff, department }));
        } else if (readiness.percent < 85) {
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

            if (staff.is_active === false || pool === 'blacklisted' || pool === 'offboarded' || staff.termination_date) {
                addIssue(scheduleHealthIssue({ code: 'planned_inactive_staff', severity: 'critical', scope: 'cell', title: 'Inactive staff scheduled', detail: 'На зміну поставлений неактивний/offboarded працівник.', staff, date, department }));
            }

            const professionKey = normalizeProfessionKey(entry.profession_key || staff.role_type);
            if (!professionKey) {
                addIssue(scheduleHealthIssue({ code: 'shift_without_role', severity: 'warning', scope: 'cell', title: 'Shift without role', detail: 'Робоча зміна не має професії/ролі.', staff, date, department }));
            } else if (entry.profession_key && !staffHasProfession(staff, entry.profession_key)) {
                addIssue(scheduleHealthIssue({ code: 'profession_mismatch', severity: 'critical', scope: 'cell', title: 'Profession mismatch', detail: 'Професія зміни не відповідає професіям у HR-картці працівника.', staff, date, department }));
            }

            const loadMeta = scheduleShiftLoadMeta({ ...entry, status });
            if (loadMeta.minutes > SCHEDULE_HEALTH_LONG_SHIFT_MINUTES) {
                addIssue(scheduleHealthIssue({ code: 'long_shift', severity: 'warning', scope: 'cell', title: 'Long shift', detail: `Зміна триває ${Math.round(loadMeta.minutes / 60)} годин.`, staff, date, department }));
            }
        }
    }

    for (const [cellKey, entries] of rawEntriesByCell.entries()) {
        if (entries.length < 2) continue;
        const first = entries[0];
        const staff = staffById.get(Number(first.staff_id));
        if (!staff) continue;
        const department = scheduleDisplayDepartmentKey(staff);
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

    const grouped = groupStaffByScheduleDepartment(visibleStaff || []);
    for (const [department, deptStaff] of Object.entries(grouped)) {
        const minWorking = SCHEDULE_HEALTH_DEPARTMENT_MIN_WORKING[department] || 0;
        if (!minWorking) continue;
        for (const date of dateKeys) {
            const entries = deptStaff.map(staff => StaffState.schedule[`${staff.id}_${date}`]).filter(Boolean);
            if (!entries.length) continue;
            const workingCount = entries.filter(entry => scheduleHealthIsWorkStatus(entry.status)).length;
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
        const hasVisibleWork = (visibleStaff || []).some(staff => scheduleHealthIsWorkStatus(StaffState.schedule[`${staff.id}_${date}`]?.status));
        if (!hasVisibleWork) continue;
        const managerPool = StaffState.activeDept === 'all' || StaffState.activeDept === 'reception'
            ? (visibleStaff || [])
            : StaffState.staff;
        const hasManager = managerPool.some(staff => (
            isScheduleManagerStaff(staff) && scheduleHealthIsWorkStatus(StaffState.schedule[`${staff.id}_${date}`]?.status)
        ));
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
    const visible = sorted.slice(0, scope === 'row' ? 3 : 2);
    const extra = Math.max(0, sorted.length - visible.length);
    return `<span class="schedule-health-badges schedule-health-badges-${scope}">
        ${visible.map(issue => {
            const detail = scheduleHealthIssueDetail(issue);
            const label = issue.severity === 'critical' ? '!' : (issue.severity === 'warning' ? '?' : 'i');
            return `<button type="button" class="schedule-health-badge is-${issue.severity}" data-health-detail="${escapeHtml(detail)}" title="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}">${label}</button>`;
        }).join('')}
        ${extra ? `<span class="schedule-health-badge-more" title="${extra} more">+${extra}</span>` : ''}
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

function staffingForecastVisibleDepartments() {
    if (StaffState.activeDept === 'reception') return ['reception', 'managers'];
    if (StaffState.activeDept === 'tech') return ['tech'];
    if (STAFFING_FORECAST_DEPARTMENTS.includes(StaffState.activeDept)) return [StaffState.activeDept];
    return STAFFING_FORECAST_DEPARTMENTS;
}

function staffingForecastScheduledCounts(date, staffList = []) {
    const counts = STAFFING_FORECAST_DEPARTMENTS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    for (const staff of staffList || []) {
        const entry = StaffState.schedule[`${staff.id}_${date}`];
        if (!entry || !scheduleHealthIsWorkStatus(entry.status)) continue;
        const department = staffingForecastDepartmentForShift(staff, entry);
        if (department && Object.prototype.hasOwnProperty.call(counts, department)) {
            counts[department] += 1;
        }
    }
    return counts;
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

function buildStaffingDemandForecast(dates = getWeekDates(StaffState.weekStart), visibleStaff = scheduleVisibleStaff()) {
    const departmentKeys = staffingForecastVisibleDepartments();
    const days = (dates || []).map(dateObj => {
        const date = typeof dateObj === 'string' ? dateObj : formatDateStr(dateObj);
        const recommendation = staffingForecastDayRecommendation(date, StaffState.staffingForecastBookings[date] || []);
        const scheduled = staffingForecastScheduledCounts(date, visibleStaff);
        const gaps = staffingForecastGap(recommendation.recommended, scheduled, departmentKeys);
        const missing = Object.values(gaps).reduce((sum, gap) => sum + gap.missing, 0);
        const overstaffed = Object.values(gaps).reduce((sum, gap) => sum + gap.overstaffed, 0);
        return {
            date,
            ...recommendation,
            scheduled,
            gaps,
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
        source: 'bookings_timeline_heuristics_v1',
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
        return `<div class="forecast-day-card is-${day.severity}">
            <div class="forecast-day-head">
                <span>${escapeHtml(day.date.slice(5))}</span>
                <b>${day.missing ? `${day.missing} missing` : 'covered'}</b>
            </div>
            <div class="forecast-day-meta">
                <span>${day.bookingCount} bookings</span>
                <span>${day.expectedGuests} guests</span>
                ${day.overstaffed ? `<span>${day.overstaffed} over</span>` : ''}
            </div>
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
    const grouped = groupStaffByScheduleDepartment(staffList || []);
    return scheduleDepartmentRenderOrder(grouped);
}

function managerAccountabilityManagersForDepartment(department, managers = []) {
    return managers.filter(manager => {
        const rawDepartment = String(manager.department || '').trim();
        return rawDepartment === department || scheduleDisplayDepartmentKey(manager) === department;
    });
}

function managerAccountabilityMissingReadiness(staffList = []) {
    return (staffList || []).filter(staff => {
        const readiness = staffCardTrainingReadiness(staff);
        return !readiness.hasData || !readiness.total;
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

function buildManagerAccountability(dates = getWeekDates(StaffState.weekStart), staffList = StaffState.staff, health = null) {
    const grouped = groupStaffByScheduleDepartment(staffList || []);
    const departmentKeys = managerAccountabilityDepartmentKeys(staffList);
    const managers = (staffList || []).filter(isManagerAccountabilityStaff);
    const departments = departmentKeys.map(department => {
        const deptStaff = grouped[department] || [];
        const assignedManagers = managerAccountabilityManagersForDepartment(department, managers);
        const issues = managerAccountabilityDepartmentIssues(health, department);
        const healthScore = managerAccountabilityHealthScore(health, department);
        const attendance = managerAccountabilityAttendanceCounts(dates, deptStaff);
        const missingReadiness = managerAccountabilityMissingReadiness(deptStaff);
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
            missingReadiness: managerAccountabilityMetric(missingReadiness),
            unresolvedIssues: issues.critical + issues.warning + attendance.noShows + attendance.unresolvedAttendance + missingReadiness
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
                ${renderManagerAccountabilityMetric(row.missingReadiness, 'readiness')}
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
            return key ? { key, label: label || key, order } : null;
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

function scheduleDisplayDepartmentKey(staff = {}) {
    const backendGroup = normalizeScheduleDisplayGroupKey(staff.display_group || staff.displayGroup);
    if (backendGroup) return backendGroup;
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

function scheduleVisibleStaff(staffList = StaffState.staff) {
    const scheduleable = scheduleableStaffForUi(staffList || []);
    if (StaffState.activeDept === 'all') return scheduleable;
    return scheduleable.filter(staff => scheduleDisplayDepartmentKey(staff) === StaffState.activeDept);
}

function scheduleDepartmentOptions() {
    const labels = scheduleDepartmentLabels();
    const counts = new Map();
    for (const staff of StaffState.staff) {
        const key = scheduleDisplayDepartmentKey(staff);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const ordered = [];
    const seen = new Set();
    const apiOrder = scheduleDisplayGroupOrder();
    const fallbackOrder = SCHEDULE_DEPARTMENT_ORDER;
    for (const key of (apiOrder.length ? apiOrder : fallbackOrder)) {
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

function groupStaffByScheduleDepartment(staffList = StaffState.staff) {
    const grouped = {};
    for (const staff of staffList) {
        const key = scheduleDisplayDepartmentKey(staff);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(staff);
    }
    return grouped;
}

function scheduleDepartmentRenderOrder(grouped = {}) {
    const ordered = SCHEDULE_DEPARTMENT_ORDER.filter(key => grouped[key]);
    const seen = new Set(ordered);
    for (const key of Object.keys(grouped)) {
        if (!seen.has(key)) ordered.push(key);
    }
    return ordered;
}

function scheduleCopyWeekModeForDepartment(department = StaffState.activeDept) {
    if (department === 'all') return 'all';
    if (SCHEDULE_COPY_RAW_DEPARTMENT_SAFE.has(department)) return 'raw_department';
    return 'explicit_staff_ids';
}

function scheduleCopyWeekVisibleStaffIds() {
    return scheduleVisibleStaff()
        .map(staff => Number(staff.id))
        .filter(Number.isFinite);
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

function todayStr() {
    return formatDateStr(new Date());
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
            StaffState.displayGroups = normalizeScheduleDisplayGroups(data.displayGroups || data.display_groups || []);
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

async function fetchSchedule(from, to) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/schedule?from=${from}&to=${to}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            StaffState.displayGroups = normalizeScheduleDisplayGroups(data.displayGroups || data.display_groups || StaffState.displayGroups);
            StaffState.schedule = {};
            StaffState.scheduleRawEntries = [];
            for (const entry of (data.data || [])) {
                const normalizedEntry = { ...entry, status: normalizeScheduleStatus(entry.status) };
                StaffState.scheduleRawEntries.push(normalizedEntry);
                StaffState.schedule[`${normalizedEntry.staff_id}_${normalizedEntry.date}`] = normalizedEntry;
            }
            StaffState.scheduleLoadedRange = { from, to };
        } else {
            StaffState.scheduleLoadedRange = null;
        }
        return data;
    } catch (err) {
        console.error('fetchSchedule error:', err);
        StaffState.scheduleLoadedRange = null;
        showNotification('Помилка завантаження розкладу', 'error');
        return { success: false };
    }
}

async function fetchScheduleAttendance(from, to) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            StaffState.attendance = {};
            for (const row of (data.data || [])) {
                const date = String(row.date || '').slice(0, 10);
                if (!row.staff_id || !date) continue;
                StaffState.attendance[`${row.staff_id}_${date}`] = { ...row, date };
            }
            StaffState.attendanceSummary = data.summary || null;
        }
        return data;
    } catch (err) {
        console.error('fetchScheduleAttendance error:', err);
        StaffState.attendance = {};
        StaffState.attendanceSummary = null;
        return { success: false };
    }
}

function staffingForecastDateKeys(from, to) {
    const fallback = getWeekDates(StaffState.weekStart || new Date()).map(formatDateStr);
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

async function saveScheduleEntry(staffId, date, shiftStart, shiftEnd, status, note, professionKey = null) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch('/api/staff/schedule', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, date, shiftStart, shiftEnd, status, note, professionKey })
    });
    return await res.json();
}

async function fetchScheduleHistory(staffId, date) {
    try {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`/api/staff/schedule/history/${encodeURIComponent(staffId)}/${encodeURIComponent(date)}?limit=50`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            StaffState.scheduleHistory[`${staffId}_${date}`] = Array.isArray(data.data) ? data.data : [];
        }
        return data;
    } catch (err) {
        console.error('fetchScheduleHistory error:', err);
        return { success: false };
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

async function fetchScheduleHours(from, to) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(`/api/staff/schedule/hours?from=${from}&to=${to}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
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
    return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
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
    const actual = [
        details.actualArrival ? `in ${scheduleAttendanceFormatTime(details.actualArrival)}` : '',
        details.actualLeave ? `out ${scheduleAttendanceFormatTime(details.actualLeave)}` : ''
    ].filter(Boolean).join(' · ');
    const planned = [
        details.plannedStart ? String(details.plannedStart).slice(0, 5) : '',
        details.plannedEnd ? String(details.plannedEnd).slice(0, 5) : ''
    ].filter(Boolean).join('-');
    const meta = actual || (planned ? `plan ${planned}` : details.source);
    const title = [
        `Attendance: ${details.label}`,
        planned ? `planned ${planned}` : '',
        actual ? `actual ${actual}` : '',
        details.lateMinutes ? `late ${details.lateMinutes}m` : '',
        details.earlyLeaveMinutes ? `early ${details.earlyLeaveMinutes}m` : '',
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
    const days = buildScheduleAttendanceSummary(dates, staffList);
    if (!staffList.length) {
        container.innerHTML = '<div class="attendance-summary-empty">Немає видимих рядків для attendance summary.</div>';
        return;
    }
    container.innerHTML = days.map(day => `
        <div class="attendance-day-card">
            <div class="attendance-day-head">
                <span>${escapeHtml(day.date.slice(5))}</span>
                <b>${day.counts.checked_in + day.counts.late + day.counts.completed + day.counts.left_early}/${day.plannedWork}</b>
            </div>
            <div class="attendance-day-metrics">
                <span class="is-late">${day.counts.late} late</span>
                <span class="is-absent">${day.counts.absent} absent</span>
                <span class="is-review">${day.counts.manual_review} review</span>
            </div>
        </div>
    `).join('');
}

async function handleAttendanceAction(button) {
    const action = button?.dataset?.attendanceAction;
    const staffId = Number(button?.dataset?.staff);
    if (!action || !Number.isFinite(staffId)) return;
    const staff = StaffState.staff.find(item => Number(item.id) === staffId);
    if (action === 'clock-in' && staff && !isScheduleableStaffForUi(staff, todayStr())) {
        showNotification(scheduleableStaffErrorMessage({ code: 'STAFF_NOT_SCHEDULEABLE' }, 'Працівник недоступний для check-in'), 'error');
        return;
    }
    button.disabled = true;
    const result = await postAttendanceAction(action, staffId);
    if (result.success) {
        const dates = getWeekDates(StaffState.weekStart);
        await fetchScheduleAttendance(formatDateStr(dates[0]), formatDateStr(getScheduleRangeEnd(dates)));
        renderSchedule();
        showNotification('Attendance оновлено');
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
    let html = `<button class="dept-chip ${StaffState.activeDept === 'all' ? 'active' : ''}" data-dept="all">Всі</button>`;
    for (const { value: key, label, count } of options) {
        html += `<button class="dept-chip ${StaffState.activeDept === key ? 'active' : ''}" data-dept="${key}">${label} (${count})</button>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.dept-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            StaffState.activeDept = chip.dataset.dept;
            container.querySelectorAll('.dept-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderSchedule();
        });
    });
    updateScheduleHeaderMetrics();
}

function renderWeekLabel() {
    const dates = getWeekDates(StaffState.weekStart);
    const from = dates[0];
    const to = getScheduleRangeEnd(dates);
    const label = `${from.getDate()} ${STAFF_SCHEDULE_MONTHS_UK[from.getMonth()]} — ${to.getDate()} ${STAFF_SCHEDULE_MONTHS_UK[to.getMonth()]} ${to.getFullYear()}`;
    document.getElementById('weekLabel').textContent = label;
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

function renderSummary(staffList = null) {
    const container = document.getElementById('scheduleSummary');
    const today = todayStr();
    const filtered = Array.isArray(staffList) ? staffList : scheduleVisibleStaff();

    let working = 0, dayoff = 0, vacation = 0, sick = 0, remote = 0, unset = 0, replacements = 0;
    for (const s of filtered) {
        const entry = StaffState.schedule[`${s.id}_${today}`];
        if (!entry) unset++;
        else {
            if (isReplacementEntry(entry)) replacements++;
            if (entry.status === 'working') working++;
            else if (entry.status === 'dayoff') dayoff++;
            else if (entry.status === 'vacation') vacation++;
            else if (entry.status === 'sick') sick++;
            else if (entry.status === 'remote') remote++;
        }
    }

    container.innerHTML = `
        <div class="summary-chip"><span class="chip-dot" style="background:#10B981"></span> На роботі: <span class="chip-count">${working}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#94A3B8"></span> Вихідні: <span class="chip-count">${dayoff}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#3B82F6"></span> Відпустка: <span class="chip-count">${vacation}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#EF4444"></span> Лікарняний: <span class="chip-count">${sick}</span></div>
        <div class="summary-chip"><span class="chip-dot" style="background:#F59E0B"></span> Віддалено: <span class="chip-count">${remote}</span></div>
        ${replacements > 0 ? `<div class="summary-chip summary-chip-replacement"><span class="chip-dot" style="background:#F97316"></span> Заміни: <span class="chip-count">${replacements}</span></div>` : ''}
        ${unset > 0 ? `<div class="summary-chip"><span class="chip-dot" style="background:#CBD5E1"></span> Не заповнено: <span class="chip-count">${unset}</span></div>` : ''}
    `;
    updateScheduleHeaderMetrics({ total: filtered.length, working, dayoff, vacation, sick, remote, unset, replacements }, filtered);
}

function renderEmpRow(emp, dates, today, health = null) {
    const employeeName = String(emp.display_name || emp.name || '').trim() || 'Співробітник';
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
    let html = `<tr class="${isFreelance ? 'emp-freelance' : ''} ${rowHealthClass}">`;
    html += `<td>
        <div class="emp-cell" data-hr-profile="${emp.id}" role="link" tabindex="0"
             title="Відкрити HR профіль: ${escapeHtml(employeeName)}"
             aria-label="Відкрити HR профіль: ${escapeHtml(employeeName)}">
            ${renderStaffCardAvatar(emp, initials, avatarColor)}
            <div class="emp-info">
                <span class="emp-name"><span class="emp-name-text">${escapeHtml(employeeName)}</span>${hrLink}</span>
                <span class="emp-position">${escapeHtml(roleSummary)} ${linkBadge}</span>
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
        const loadMeta = scheduleShiftLoadMeta({ ...entry, status, shift_start: shiftStart, shift_end: shiftEnd });
        const loadClass = loadMeta.className || '';
        const cellHealthIssues = scheduleHealthCellIssues(health, emp.id, ds);
        const cellHealthSeverity = scheduleHealthSeverity(cellHealthIssues);
        const cellHealthClass = cellHealthSeverity !== 'ok' ? `has-health-${cellHealthSeverity}` : '';
        const cellHealthBadges = renderScheduleHealthBadges(cellHealthIssues, 'cell');
        const attendanceRecord = scheduleAttendanceRecord(emp.id, ds);
        const attendanceDetails = scheduleAttendanceDetails(entry, attendanceRecord, ds);
        const attendanceClass = attendanceDetails.status ? `has-attendance-${attendanceDetails.status}` : '';
        const attendanceIndicator = renderScheduleAttendanceIndicator(emp.id, ds, entry);
        let cellContent = '';
        if ((status === 'working' || status === 'remote') && shiftStart && shiftEnd) {
            cellContent = `<span class="sch-time">${shiftStart.slice(0,5)}–${shiftEnd.slice(0,5)}</span>`;
            const activeProfession = professionLabel(entry?.profession_key || emp.role_type);
            if (activeProfession) cellContent += `<span class="sch-profession">${escapeHtml(activeProfession)}</span>`;
            if (isReplacement) {
                cellContent += `<span class="sch-replacement-badge">Заміна</span>`;
                cellContent += `<span class="sch-replacement-from">за ${escapeHtml(entry.original_staff_name || 'працівника')}</span>`;
            }
            if (status === 'remote') cellContent += `<span class="sch-label"><span class="sch-icon">${icon}</span> Відд.</span>`;
        } else if (status === 'working') {
            cellContent = `<span class="sch-label"><span class="sch-icon">${icon}</span> Роб.</span>`;
        } else if (status === 'unset') {
            cellContent = `<span class="sch-label sch-unset"><span class="sch-icon">${icon}</span></span>`;
        } else {
            cellContent = `<span class="sch-label"><span class="sch-icon">${icon}</span> ${STAFF_SCHEDULE_STATUS_LABELS[status] || status}</span>`;
        }

        if (entry?.note) {
            cellContent += `<span class="sch-note">${escapeHtml(entry.note)}</span>`;
        }
        if (attendanceIndicator) {
            cellContent += attendanceIndicator;
        }
        if (cellHealthBadges) {
            cellContent += cellHealthBadges;
        }

        html += `<td>
            <div class="sch-cell status-${status} ${loadClass} ${isToday ? 'today-col' : ''} ${isReplacement ? 'is-replacement' : ''} ${cellHealthClass} ${attendanceClass}"
                 data-staff="${emp.id}" data-date="${ds}"
                 data-shift-load="${loadMeta.bucket || ''}" data-shift-ratio="${loadMeta.label || ''}"
                 data-schedule-id="${entry?.id || ''}" data-hr-shift="${entry?.hr_shift_id || ''}"
                 title="${escapeHtml([scheduleEntryTitle(emp, ds, entry, shiftStart, shiftEnd), attendanceDetails.status ? `attendance ${attendanceDetails.label}` : '', scheduleHealthIssueSummary(cellHealthIssues)].filter(Boolean).join(' | '))}">
                ${cellContent}
            </div>
        </td>`;
    }
    html += `</tr>`;
    return html;
}

function renderSchedule() {
    const dates = getWeekDates(StaffState.weekStart);
    const today = todayStr();

    // Header
    const thead = document.getElementById('scheduleHead');
    let headHtml = '<tr><th>Співробітник</th>';
    for (const d of dates) {
        const ds = formatDateStr(d);
        const isToday = ds === today;
        headHtml += `<th class="${isToday ? 'today' : ''}">
            <span class="th-date">${d.getDate()}</span>
            <span class="th-day">${STAFF_SCHEDULE_DAYS_UK[d.getDay()]}</span>
        </th>`;
    }
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    // Body — group by department
    const tbody = document.getElementById('scheduleBody');
    const baseFiltered = scheduleVisibleStaff();
    const health = buildScheduleHealth(dates, baseFiltered);
    const forecast = buildStaffingDemandForecast(dates, baseFiltered);
    const accountability = buildManagerAccountability(dates, baseFiltered, health);
    const filtered = scheduleHealthFilteredStaff(baseFiltered, health);
    StaffState.staffingForecast = forecast;
    StaffState.managerAccountability = accountability;
    renderScheduleHealthPanel(health);
    renderStaffingForecastPanel(forecast);
    renderManagerAccountabilityPanel(accountability);

    // Group staff by department
    const grouped = groupStaffByScheduleDepartment(filtered);

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
        const icon = DEPT_ICONS[dept] || '';
        const deptStaff = grouped[dept];
        const subGroups = DEPT_SUB_GROUPS[dept];

        // Department header
        bodyHtml += `<tr class="dept-row" data-dept="${dept}"><td colspan="${dates.length + 1}"><span class="dept-icon">${icon}</span> ${deptLabel} <span class="dept-count">${deptStaff.length}</span></td></tr>`;

        if (shouldRenderDepartmentSubGroups(deptStaff, subGroups)) {
            // Render sub-groups within department
            for (const sg of subGroups) {
                const sgStaff = deptStaff.filter(s => staffMatchesDepartmentSubGroup(s, sg));
                if (sgStaff.length === 0) continue;

                bodyHtml += `<tr class="sub-group-row"><td colspan="${dates.length + 1}"><span class="sub-group-icon">${sg.icon}</span> ${sg.label} <span class="sub-group-count">${sgStaff.length}</span></td></tr>`;

                for (const emp of sgStaff) {
                    bodyHtml += renderEmpRow(emp, dates, today, health);
                }
            }
            // Render staff that didn't match any sub-group (edge case)
            const unmatchedByGroup = deptStaff.filter(s => !staffMatchesAnyDepartmentSubGroup(s, subGroups));
            const allRoleKeys = departmentSubGroupRoleKeySet(subGroups);
            const unmatched = unmatchedByGroup.filter(s => {
                const roleKey = normalizeProfessionKey(s.role_type);
                return !roleKey || !allRoleKeys.has(roleKey);
            });
            for (const emp of unmatched) {
                bodyHtml += renderEmpRow(emp, dates, today, health);
            }
        } else {
            // Small department — render without sub-groups
            for (const emp of deptStaff) {
                bodyHtml += renderEmpRow(emp, dates, today, health);
            }
        }
    }

    tbody.innerHTML = bodyHtml;
    if (StaffState.showHours) {
        tbody.classList.add('show-hours');
    }
    renderSummary(filtered);
    renderScheduleAttendanceSummary(dates, filtered);

    // Cell click handlers
    tbody.querySelectorAll('.sch-cell').forEach(cell => {
        if (!StaffState.canManage) cell.setAttribute('aria-readonly', 'true');
        cell.addEventListener('click', () => {
            openEditModal(parseInt(cell.dataset.staff), cell.dataset.date);
        });
    });

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
}

// ==========================================
// EDIT MODAL
// ==========================================

let _staffScheduleInitialState = '';
let _staffFillInitialState = '';

function getStaffScheduleState() {
    return ['schStatus', 'schProfession', 'schStart', 'schEnd', 'schNote'].map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
}

function getStaffFillState() {
    const dayState = Array.from(document.querySelectorAll('#fillDaysRow input[type=checkbox]')).map(cb => cb.checked ? '1' : '0').join('');
    return ['fillStaffSelect', 'fillStatus', 'fillStart', 'fillEnd', 'fillNote'].map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|') + '|days:' + dayState;
}

function openEditModal(staffId, date) {
    const emp = StaffState.staff.find(s => s.id === staffId);
    if (!emp) return;
    if (StaffState.canManage && !isScheduleableStaffForUi(emp, date)) {
        showNotification(scheduleableStaffErrorMessage({ code: 'STAFF_NOT_SCHEDULEABLE' }), 'error');
        return;
    }

    const entry = StaffState.schedule[`${staffId}_${date}`];
    StaffState.editingCell = { staffId, date, entry };

    document.getElementById('schModalTitle').textContent = `${StaffState.canManage ? 'Редагувати' : 'Перегляд'}: ${emp.name} — ${date}`;
    document.getElementById('schStatus').value = entry?.status || 'working';
    document.getElementById('schStart').value = entry?.shift_start || '10:00';
    document.getElementById('schEnd').value = entry?.shift_end || '20:00';
    document.getElementById('schNote').value = entry?.note || '';
    const professionSelect = document.getElementById('schProfession');
    if (professionSelect) {
        const options = staffProfessionOptions(emp, entry?.profession_key || emp.role_type);
        professionSelect.innerHTML = options.length
            ? options.map(option => `<option value="${escapeHtml(option.value)}" ${option.selected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')
            : '<option value="">Професія не задана</option>';
        professionSelect.disabled = !options.length;
    }

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
    loadScheduleCellHistory(staffId, date);
    const overlay = document.getElementById('schModalOverlay');
    _staffScheduleInitialState = getStaffScheduleState();
    overlay?.classList.add('visible');
    if (window.ModalLayer) window.ModalLayer.ensureTopLayer(overlay);
    if (window.UnsafeDismissGuard && overlay) window.UnsafeDismissGuard.remember(overlay);
}

async function closeEditModal(force = false) {
    const overlay = document.getElementById('schModalOverlay');
    const closeNow = () => {
        overlay?.classList.remove('visible');
        StaffState.editingCell = null;
        _staffScheduleInitialState = getStaffScheduleState();
    };
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
}

function toggleTimeFields() {
    const status = document.getElementById('schStatus')?.value;
    const visible = status === 'working' || status === 'remote';
    document.getElementById('schTimeFields').style.display = visible ? '' : 'none';
    const professionGroup = document.getElementById('schProfessionGroup');
    if (professionGroup) professionGroup.style.display = visible ? '' : 'none';
    const entry = getEditingScheduleEntry();
    const isReplacement = isReplacementEntry(entry);
    const canReplace = visible && StaffState.canManage && entry?.id && entry.shift_start && entry.shift_end;
    const replaceBtn = document.getElementById('schReplaceBtn');
    const clearReplacementBtn = document.getElementById('schClearReplacementBtn');
    if (replaceBtn) replaceBtn.hidden = !canReplace;
    if (clearReplacementBtn) clearReplacementBtn.hidden = !(canReplace && isReplacement);
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
        staff_schedule_replacement_restored: 'Повернено оригінальну зміну'
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
    renderScheduleHistoryList(staffId, date, 'loading');
    const result = await fetchScheduleHistory(staffId, date);
    renderScheduleHistoryList(staffId, date, result.success ? 'ready' : 'error');
}

function setScheduleModalReadOnly(readOnly) {
    ['schStatus', 'schProfession', 'schStart', 'schEnd', 'schNote'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = readOnly;
    });
    const saveBtn = document.getElementById('schSaveBtn');
    if (saveBtn) saveBtn.hidden = readOnly;
    const readOnlyHint = document.getElementById('schReadOnlyHint');
    if (readOnlyHint) readOnlyHint.hidden = !readOnly;
}

async function handleSave() {
    const { staffId, date } = StaffState.editingCell;
    const previousEntry = StaffState.editingCell?.entry || StaffState.schedule[`${staffId}_${date}`] || null;
    const emp = StaffState.staff.find(staff => Number(staff.id) === Number(staffId));
    if (emp && !isScheduleableStaffForUi(emp, date)) {
        showNotification(scheduleableStaffErrorMessage({ code: 'STAFF_NOT_SCHEDULEABLE' }), 'error');
        return;
    }
    const status = document.getElementById('schStatus')?.value;
    const showTime = status === 'working' || status === 'remote';
    const shiftStart = showTime ? document.getElementById('schStart')?.value : null;
    const shiftEnd = showTime ? document.getElementById('schEnd')?.value : null;
    const professionKey = showTime ? (document.getElementById('schProfession')?.value || null) : null;
    const note = document.getElementById('schNote')?.value.trim() || null;

    const result = await saveScheduleEntry(staffId, date, shiftStart, shiftEnd, status, note, professionKey);
    if (result.success) {
        replaceScheduleStateEntry(previousEntry, result.data);
        renderSchedule();
        closeEditModal(true);
        showNotification('Зміну збережено');
    } else {
        showNotification(scheduleableStaffErrorMessage(result, 'Помилка збереження'), 'error');
    }
}

function getEditingScheduleEntry() {
    const editing = StaffState.editingCell;
    if (!editing) return null;
    return StaffState.schedule[`${editing.staffId}_${editing.date}`] || editing.entry || null;
}

async function handleReplaceSchedule() {
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
    if (!result) return;

    const apiResult = await replaceScheduleEntry(entry.id, result.replacementStaffId, result.reason);
    if (apiResult.success) {
        replaceScheduleStateEntry(entry, apiResult.data);
        renderSchedule();
        closeEditModal(true);
        showNotification('Підміну виставлено');
    } else {
        showNotification(scheduleableStaffErrorMessage(apiResult, 'Помилка підміни'), 'error');
    }
}

async function handleClearReplacement() {
    const entry = getEditingScheduleEntry();
    if (!entry?.id || !isReplacementEntry(entry)) {
        showNotification('У цьому слоті немає активної підміни', 'error');
        return;
    }
    if (!await confirmModal('Скасувати підміну і повернути зміну оригінальному працівнику?', {
        type: 'warning',
        okText: 'Повернути',
        cancelText: 'Не чіпати'
    })) {
        return;
    }

    const result = await clearScheduleReplacement(entry.id);
    if (result.success) {
        replaceScheduleStateEntry(entry, result.data);
        renderSchedule();
        closeEditModal(true);
        showNotification('Підміну скасовано');
    } else {
        showNotification(result.error || 'Помилка скасування підміни', 'error');
    }
}

// ==========================================
// WEEK NAVIGATION
// ==========================================

async function goToWeek(monday) {
    StaffState.weekStart = monday;
    renderWeekLabel();
    const dates = getWeekDates(monday);
    const from = formatDateStr(dates[0]);
    const to = formatDateStr(getScheduleRangeEnd(dates));
    await fetchSchedule(from, to);
    await fetchScheduleAttendance(from, to);
    await fetchStaffingForecastBookings(from, to);
    renderSchedule();
    if (StaffState.showLoadView) renderLoadView();
}

function prevWeek() {
    const d = new Date(StaffState.weekStart);
    d.setDate(d.getDate() - 7);
    goToWeek(d);
}

function nextWeek() {
    const d = new Date(StaffState.weekStart);
    d.setDate(d.getDate() + 7);
    goToWeek(d);
}

function goToday() {
    goToWeek(getScheduleFocusStart(new Date()));
}

// ==========================================
// FILL WEEK MODAL
// ==========================================

function openFillWeekModal() {
    const select = document.getElementById('fillStaffSelect');
    const filtered = scheduleVisibleStaff();

    select.innerHTML = '<option value="all">Всі видимі працівники</option>';
    for (const emp of filtered) {
        select.innerHTML += `<option value="${emp.id}">${escapeHtml(emp.name)} — ${escapeHtml(emp.position)}</option>`;
    }

    document.getElementById('fillStatus').value = 'working';
    document.getElementById('fillStart').value = '10:00';
    document.getElementById('fillEnd').value = '20:00';
    document.getElementById('fillNote').value = '';
    toggleFillTimeFields();
    const overlay = document.getElementById('fillWeekOverlay');
    _staffFillInitialState = getStaffFillState();
    overlay?.classList.add('visible');
    if (window.ModalLayer) window.ModalLayer.ensureTopLayer(overlay);
    if (window.UnsafeDismissGuard && overlay) window.UnsafeDismissGuard.remember(overlay);
}

async function closeFillWeekModal(force = false) {
    const overlay = document.getElementById('fillWeekOverlay');
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
    document.getElementById('fillTimeFields').style.display = (status === 'working' || status === 'remote') ? '' : 'none';
}

async function handleFillWeekSave() {
    const staffValue = document.getElementById('fillStaffSelect')?.value;
    const status = document.getElementById('fillStatus')?.value;
    const showTime = status === 'working' || status === 'remote';
    const shiftStart = showTime ? document.getElementById('fillStart')?.value : null;
    const shiftEnd = showTime ? document.getElementById('fillEnd')?.value : null;
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
        targetStaff = StaffState.staff.filter(s => s.id === parseInt(staffValue));
    }
    targetStaff = scheduleableStaffForUi(targetStaff);

    // Build entries for the current week's selected days
    const dates = getWeekDates(StaffState.weekStart);
    const entries = [];
    for (const emp of targetStaff) {
        for (const d of dates) {
            const date = formatDateStr(d);
            if (!checkedDays.includes(d.getDay())) continue;
            if (!isScheduleableStaffForUi(emp, date)) continue;
            entries.push({
                staffId: emp.id,
                date,
                shiftStart, shiftEnd, status, note,
                professionKey: showTime ? normalizeProfessionKey(emp.role_type) : null
            });
        }
    }

    if (entries.length === 0) {
        showNotification('Нічого заповнювати', 'error');
        return;
    }

    const result = await bulkSaveSchedule(entries);
    if (result.success) {
        closeFillWeekModal(true);
        showNotification(`Заповнено ${result.count} записів`);
        await goToWeek(StaffState.weekStart);
    } else {
        showNotification(scheduleableStaffErrorMessage(result, 'Помилка збереження'), 'error');
    }
}

// ==========================================
// COPY WEEK
// ==========================================

async function handleCopyWeek() {
    const fromMonday = formatDateStr(StaffState.weekStart);
    const nextMon = new Date(StaffState.weekStart);
    nextMon.setDate(nextMon.getDate() + 7);
    const toMonday = formatDateStr(nextMon);

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
// HOURS TOGGLE
// ==========================================

async function toggleHours() {
    StaffState.showHours = !StaffState.showHours;
    const tbody = document.getElementById('scheduleBody');
    const btn = document.getElementById('toggleHoursBtn');

    if (StaffState.showHours) {
        // Fetch hours for the current visible period.
        const dates = getWeekDates(StaffState.weekStart);
        const from = formatDateStr(dates[0]);
        const to = formatDateStr(getScheduleRangeEnd(dates));
        const result = await fetchScheduleHours(from, to);
        if (result.success) {
            StaffState.hoursData = result.data;
        }
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--primary)';
    } else {
        StaffState.hoursData = null;
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
    }
    renderSchedule();
    // Apply show-hours class after render (tbody is re-created)
    if (StaffState.showHours) {
        document.getElementById('scheduleBody')?.classList.add('show-hours');
    }
}

// ==========================================
// LOAD VIEW (Excel-like daily workload)
// ==========================================

function toggleLoadView() {
    StaffState.showLoadView = !StaffState.showLoadView;
    const loadWrapper = document.getElementById('loadViewWrapper');
    const schedWrapper = document.getElementById('scheduleWrapper');
    const btn = document.getElementById('toggleLoadViewBtn');

    if (StaffState.showLoadView) {
        loadWrapper.style.display = '';
        schedWrapper.style.display = 'none';
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--primary)';
        renderLoadView();
    } else {
        loadWrapper.style.display = 'none';
        schedWrapper.style.display = '';
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
    }
}

function renderLoadView() {
    const dates = getWeekDates(StaffState.weekStart);
    const today = todayStr();
    const filtered = scheduleVisibleStaff();

    // Header
    const thead = document.getElementById('loadViewHead');
    let headHtml = '<tr><th>Показник</th>';
    for (const d of dates) {
        const ds = formatDateStr(d);
        const isToday = ds === today;
        headHtml += `<th class="${isToday ? 'today' : ''}">
            <span class="th-date">${d.getDate()}</span>
            <span class="th-day">${STAFF_SCHEDULE_DAYS_UK[d.getDay()]}</span>
        </th>`;
    }
    headHtml += '<th>Разом</th></tr>';
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
        const grouped = groupStaffByScheduleDepartment(StaffState.staff);
        bodyHtml += `<tr><td colspan="${dates.length + 2}" style="padding:8px 16px;font-weight:800;font-size:12px;color:var(--gray-500);background:var(--gray-50);border-top:2px solid var(--gray-200)">По відділах (на роботі + віддалено)</td></tr>`;

        for (const dept of scheduleDepartmentRenderOrder(grouped)) {
            const deptStaff = grouped[dept] || [];
            if (deptStaff.length === 0) continue;
            const icon = DEPT_ICONS[dept] || '';
            const label = scheduleDisplayDepartmentLabel(dept);
            bodyHtml += `<tr class="load-row-status"><td>${icon} ${label}</td>`;
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

function showOneTimeCredential(credential, title = 'One-time credentials', payload = {}) {
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
    } else {
        console.info(`${title}\n\n${text}`);
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

async function toggleLinkView() {
    StaffState.showLinkView = !StaffState.showLinkView;
    const btn = document.getElementById('toggleLinkViewBtn');

    if (StaffState.showLinkView) {
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--primary)';
        await fetchLinkStatus();
        renderLinkStatsBar();
    } else {
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
        const bar = document.getElementById('linkStatsBar');
        if (bar) bar.remove();
    }
    renderSchedule();
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
        className: 'staff-account-create-modal'
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

function handleExcelExport() {
    const dates = getWeekDates(StaffState.weekStart);
    const grouped = groupStaffByScheduleDepartment(StaffState.staff);

    // Build CSV (BOM for Excel)
    let csv = '\ufeff';
    csv += 'Відділ,Підгрупа,Ім\'я,Посада';
    for (const d of dates) {
        csv += `,${d.getDate()} ${STAFF_SCHEDULE_MONTHS_UK[d.getMonth()]} (${STAFF_SCHEDULE_DAYS_UK[d.getDay()]})`;
    }
    csv += '\n';

    for (const dept of scheduleDepartmentRenderOrder(grouped)) {
        const deptStaff = grouped[dept] || [];
        if (deptStaff.length === 0) continue;
        const deptLabel = scheduleDisplayDepartmentLabel(dept);
        const subGroups = DEPT_SUB_GROUPS[dept];

        const renderStaffCsv = (emp, sgLabel) => {
            let row = `"${deptLabel}","${sgLabel}","${emp.name}","${emp.position}"`;
            for (const d of dates) {
                const ds = formatDateStr(d);
                const entry = StaffState.schedule[`${emp.id}_${ds}`];
                const status = entry ? normalizeScheduleStatus(entry.status) : 'unset';
                const time = (entry?.shift_start && entry?.shift_end)
                    ? `${entry.shift_start.slice(0,5)}-${entry.shift_end.slice(0,5)}`
                    : '';
                const label = STAFF_SCHEDULE_STATUS_LABELS[status] || status;
                row += `,"${time || label}"`;
            }
            csv += row + '\n';
        };

        if (shouldRenderDepartmentSubGroups(deptStaff, subGroups)) {
            for (const sg of subGroups) {
                const sgStaff = deptStaff.filter(s => staffMatchesDepartmentSubGroup(s, sg));
                for (const emp of sgStaff) renderStaffCsv(emp, sg.label);
            }
            const unmatchedByGroup = deptStaff.filter(s => !staffMatchesAnyDepartmentSubGroup(s, subGroups));
            const allRoleKeys = departmentSubGroupRoleKeySet(subGroups);
            const unmatched = unmatchedByGroup.filter(s => {
                const roleKey = normalizeProfessionKey(s.role_type);
                return !roleKey || !allRoleKeys.has(roleKey);
            });
            for (const emp of unmatched) renderStaffCsv(emp, '');
        } else {
            for (const emp of deptStaff) renderStaffCsv(emp, '');
        }
    }

    const from = dates[0];
    const to = getScheduleRangeEnd(dates);
    const filename = `grafik_${formatDateStr(from)}_${formatDateStr(to)}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const touchWindow = typeof openTouchDownloadWindow === 'function'
        ? openTouchDownloadWindow('Графік CSV')
        : null;
    if (typeof finishBlobDownload === 'function') {
        finishBlobDownload(blob, filename, { touchWindow, successMessage: 'Графік експортовано' });
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Графік експортовано');
    }
}

// ==========================================
// PRINT
// ==========================================

function handlePrint() {
    window.print();
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

async function initStaffSchedulePage(options = {}) {
    if (staffScheduleInitPromise) return staffScheduleInitPromise;
    staffScheduleInitPromise = (async () => {
        const mode = staffScheduleMode(options);
        applyStaffScheduleHostMode(mode);
        const host = ensureStaffScheduleShell(options);
        if (!host) throw new Error('Staff schedule shell is not available');

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
        if (bulkBtn) bulkBtn.style.display = isAdmin ? '' : 'none';
        if (importBtn) importBtn.style.display = isAdmin ? '' : 'none';

        // Load data
        await fetchHrProfessions();
        await fetchStaff();
        renderDeptFilter();

        // Init the rolling window: yesterday, today, and the upcoming days.
        StaffState.weekStart = getScheduleFocusStart(new Date());
        renderWeekLabel();

        const dates = getWeekDates(StaffState.weekStart);
        const from = formatDateStr(dates[0]);
        const to = formatDateStr(getScheduleRangeEnd(dates));
        await fetchSchedule(from, to);
        await fetchScheduleAttendance(from, to);
        await fetchStaffingForecastBookings(from, to);
        renderSchedule();

        // Event listeners
        document.getElementById('prevWeekBtn')?.addEventListener('click', prevWeek);
        document.getElementById('nextWeekBtn')?.addEventListener('click', nextWeek);
        document.getElementById('todayWeekBtn')?.addEventListener('click', goToday);
        document.getElementById('schSaveBtn')?.addEventListener('click', handleSave);
        document.getElementById('schReplaceBtn')?.addEventListener('click', handleReplaceSchedule);
        document.getElementById('schClearReplacementBtn')?.addEventListener('click', handleClearReplacement);
        document.getElementById('schCancelBtn')?.addEventListener('click', () => closeEditModal(false));
        document.getElementById('schStatus')?.addEventListener('change', toggleTimeFields);
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
        document.getElementById('fillWeekOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeFillWeekModal(false);
        });

        // Copy week
        document.getElementById('copyWeekBtn')?.addEventListener('click', handleCopyWeek);

        // Hours toggle
        document.getElementById('toggleHoursBtn')?.addEventListener('click', toggleHours);

        // Load view toggle
        document.getElementById('toggleLoadViewBtn')?.addEventListener('click', toggleLoadView);

        // v39.1: Account linking
        document.getElementById('toggleLinkViewBtn')?.addEventListener('click', toggleLinkView);
        document.getElementById('bulkCreateBtn')?.addEventListener('click', handleBulkCreate);
        document.getElementById('importExcelBtn')?.addEventListener('click', triggerExcelImport);
        document.getElementById('excelImportInput')?.addEventListener('change', handleExcelImport);
        document.getElementById('exportExcelBtn')?.addEventListener('click', handleExcelExport);
        document.getElementById('printBtn')?.addEventListener('click', handlePrint);

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
            if (e.key === 'Escape') {
                closeEditModal(false);
                closeFillWeekModal(false);
                closeLinkModal();
                closeBulkResults();
            }
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
    isInitialized: () => staffScheduleInitialized,
    renderSchedule
};

document.addEventListener('DOMContentLoaded', () => {
    if (shouldAutoInitStaffSchedulePage()) initStaffSchedulePage({ mode: 'standalone' });
});
})();
