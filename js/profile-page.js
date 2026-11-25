/**
 * profile-page.js — Profile + Character + Inventory + Achievements + Shop + Leaderboard + Room + Quests + Titles
 * v25.2.0 — Unified tab system (removed old System A)
 */

// ==========================================
// STATE
// ==========================================
let profileData = null;
let myInventory = [];
let myAchievements = [];
let myNotes = [];
let walletData = null;
let currentUserId = null;
let isOwnProfile = true;
let questsData = null;
let titlesData = null;
let shopItems = [];
let leaderboardData = null;
let achCatFilter = 'all';
let leaderboardSort = 'xp';
let activeTab = 'professions';
let profileTabRequestSeq = 0;
let initialHrReminderLinkPending = false;
const profileResourceStates = new Map();
let activeProfessionKey = null;
const PROFILE_EMPLOYEE_TABS = { salary: 'Зарплата', results: 'Мої результати' };
const profileEmployeeMonthState = {};
let profileMaterialsState = {
    key: null,
    loading: false,
    loaded: false,
    articles: [],
    materials: [],
    error: ''
};
let myCabinetData = null;
let myCabinetLoadError = '';
let myCabinetLoadState = 'idle';
let profileControlTasks = null;
let profileControlView = 'control';
let myTasksSegment = 'all';
let cabinetProjectionRequestSequence = 0;
const cabinetProjectionInFlightByPath = new Map();
let cabinetProjectionRecent = { path: '', at: 0, data: null };
const CABINET_PROJECTION_RECENT_REUSE_MS = 2500;
let cabinetCreateDuePreset = 'today';
let completedDashboardShowAll = false;
let completedDashboardExpanded = false;
let completedDashboardTab = 'today';
let completedDashboardVisibleCount = 5;
let completedDashboardHistoryVisibleCount = 5;
let completedDashboardHistoryState = {
    scopeKey: '',
    items: [],
    nextCursor: '',
    hasMore: false,
    loading: false,
    error: '',
    requestSeq: 0,
    total: 0,
    limit: 36,
    initialized: false
};
let cabinetCreatePriority = 'normal';
let cabinetTaskComposerExpanded = false;
let cabinetCreateContext = null;
let cabinetLeadCollaboration = null;
let cabinetCreateAssignment = null;
let myDayUndatedOpen = false;
let cabinetTaskSoundSettings = { enabled: true, volume: 0.4, theme: 'subtle' };
let cabinetSnoozeOutsideBound = false;
let cabinetTaskDragDropBound = false;
let cabinetTaskDragState = null;
let cabinetUndoToastTimer = null;
let cabinetProjectionRefreshTimer = null;
let profileSecurityData = null;
let lastCabinetCreatedTaskId = null;
let cabinetTaskCreatePending = false;
let cabinetTaskCreateAttempt = null;
let profileWidgetConfig = [];
let profileWidgetSettingsOpen = false;
const CABINET_TASK_PLAIN_TITLE_MAX_LENGTH = 180;
const CABINET_TASK_CREATE_UNKNOWN_TTL_MS = 2 * 60 * 1000;
const CABINET_TASK_CREATE_IDEMPOTENCY_STORAGE_KEY = 'eventGenix.myDay.directCreate.pending.v1';

function notifyTaskWidgetsChanged(detail = {}) {
    const payload = { source: 'profile_my_cabinet', ...detail };
    if (window.TaskUiShared?.TaskMutationSync?.emit) return window.TaskUiShared.TaskMutationSync.emit(payload);
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return null;
    window.dispatchEvent(new CustomEvent('crm:tasks-updated', { detail: payload }));
    return payload;
}

function normalizeCabinetTaskSoundSettings(input = {}) {
    const volume = Math.max(0, Math.min(1, Number(input.task_sound_volume ?? input.taskSoundVolume ?? input.volume ?? 0.4) || 0));
    const theme = String(input.task_sound_theme ?? input.taskSoundTheme ?? input.theme ?? 'subtle').trim();
    return {
        enabled: input.task_sound_enabled !== undefined ? Boolean(input.task_sound_enabled)
            : input.taskSoundEnabled !== undefined ? Boolean(input.taskSoundEnabled)
                : input.enabled !== undefined ? Boolean(input.enabled)
                    : true,
        volume,
        theme: CABINET_TASK_SOUND_THEMES.some(item => item.value === theme) ? theme : 'subtle'
    };
}

function applyCabinetTaskSoundPreferences(preferences = {}) {
    cabinetTaskSoundSettings = normalizeCabinetTaskSoundSettings(preferences);
    window.SoundEngine?.configureTask?.(cabinetTaskSoundSettings);
}

// v30.8.0 — Gamification v3 state
let allStreaks = null;
let seasonalQuests = null;
let teamsData = null;
let challengesData = null;
let referralData = null;
let monthlyLeaderboard = null;
let monthlyCategory = 'overall';
let monthlyYear = new Date().getFullYear();
let monthlyMonth = new Date().getMonth() + 1;
let leaderboardMode = 'overall'; // 'overall' or 'monthly'
let rewardClaimPending = new Set();
let profileAutoRewardCheckCompletedKey = '';
const profileAutoRewardChecksPending = new Map();

const CABINET_TASK_SEGMENTS = [
    { id: 'all', label: 'Всі мої', hint: 'Усі активні задачі, де ви виконавець, автор або учасник' },
    { id: 'personal', label: 'Особисті', hint: 'Ваші особисті задачі і задачі категорії personal' },
    { id: 'private', label: 'Приватні', hint: 'Задачі з приватною видимістю тільки для вас' },
    { id: 'work', label: 'Робочі', hint: 'Командні та операційні задачі' },
    { id: 'actionable', label: 'Виконати', hint: 'Активні задачі, які можна закривати через дію виконання' },
    { id: 'idea', label: 'Ідеї', hint: 'Ідеї та записи для подальшого розбору' }
];

const CABINET_TASK_CATEGORIES = [
    ['admin', 'Адмін'],
    ['event', 'Івент'],
    ['purchase', 'Закупівлі'],
    ['orders', 'Замовлення'],
    ['operational', 'Операційні'],
    ['maintenance', 'Технічні'],
    ['trampoline', 'Батути'],
    ['personal', 'Особисті'],
    ['improvement', 'Покращення'],
    ['checklist', 'Чек-лісти']
];

const CABINET_TASK_PRIORITIES = window.TaskUiShared?.TASK_PRIORITY_OPTIONS || [
    { value: 'urgent', label: 'Терміново', hint: 'Піднімає задачу вгору і створює нагадування без руху' },
    { value: 'high', label: 'Високий', hint: 'Вище звичайних задач' },
    { value: 'normal', label: 'Звичайний', hint: 'Стандартний пріоритет' },
    { value: 'low', label: 'Низький', hint: 'Можна виконати пізніше' }
];
const CABINET_TASK_PRIORITY_VALUES = window.TaskUiShared?.TASK_PRIORITY_VALUES || CABINET_TASK_PRIORITIES.map(item => item.value);

const CABINET_DUE_PRESETS = [
    { value: 'today', label: 'Сьогодні' },
    { value: 'tomorrow', label: 'Завтра' },
    { value: 'day_after_tomorrow', label: 'Післязавтра' },
    { value: 'plus_3_days', label: '+3 дні' },
    { value: 'month_end', label: 'Кінець місяця' },
    { value: 'no_date', label: 'Без дати' },
    { value: 'custom', label: 'Інша дата' }
];
const CABINET_DUE_PRESET_VALUES = CABINET_DUE_PRESETS.map(item => item.value);
const CABINET_DUE_PRESET_ALIASES = {
    day_after: 'day_after_tomorrow'
};
const expandedCabinetMyDayTaskIds = new Set();
let myDayLinkedDate = null;
let pendingMyDayPeriod = null;

const CABINET_TASK_SOUND_THEMES = [
    { value: 'subtle', label: 'Мʼякий' },
    { value: 'classic', label: 'Класичний' },
    { value: 'rock', label: 'Рок' }
];

const CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT = 36;
const CABINET_COMPLETION_ROWS_INITIAL = 5;
const CABINET_COMPLETION_ROWS_BATCH = 5;

const PROFILE_COCKPIT_DEFAULT_WIDGETS = [
    'active_tasks',
    'today_progress',
    'next_shift',
    'attention',
    'bookings_today',
    'certificates',
    'achievements'
];

const PROFILE_COCKPIT_WIDGETS = [
    {
        id: 'active_tasks',
        group: 'priority',
        label: 'Мої активні задачі',
        target: '/tasks?view=my',
        icon: '✓',
        hint: 'Активні задачі, де ви власник або виконавець. Натисніть, щоб відкрити персональний список задач.'
    },
    {
        id: 'today_progress',
        group: 'today',
        label: 'На сьогодні',
        target: '/profile?tab=myday',
        icon: '◷',
        hint: 'Скільки задач на сьогодні вже закрито і скільки ще залишилось у вашому робочому зрізі.'
    },
    {
        id: 'next_shift',
        group: 'today',
        label: 'Наступна зміна',
        target: '/hr?tab=schedule',
        icon: '⏱',
        hint: 'Найближча запланована зміна зі staff schedule. Натисніть, щоб відкрити графік.'
    },
    {
        id: 'attention',
        group: 'priority',
        label: 'Потребують уваги',
        target: '/tasks?view=overdue',
        icon: '!',
        hint: 'Прострочені задачі з вашого персонального зрізу. Картка показується тільки коли є реальний борг.'
    },
    {
        id: 'bookings_today',
        group: 'business',
        label: 'Бронювання сьогодні',
        target: '/',
        icon: '◫',
        hint: 'Кількість активних бронювань на сьогодні з CRM timeline.'
    },
    {
        id: 'certificates',
        group: 'business',
        label: 'Сертифікати / видачі',
        target: '/certificates',
        icon: '◇',
        hint: 'Сертифікати, видані від вашого імені. Натисніть, щоб перейти до реєстру.'
    },
    {
        id: 'achievements',
        group: 'growth',
        label: 'Досягнення',
        target: '/profile?tab=achievements',
        icon: '★',
        hint: 'Ваш прогрес у досягненнях і streak. Натисніть, щоб відкрити розділ досягнень.'
    }
];

// ==========================================
// UTILITIES
// ==========================================
function _hasUnclaimedQuests() {
    if (!questsData?.quests) return false;
    return questsData.quests.some(q => q.completed && !q.claimed);
}

function rewardClaimKey(kind, id) {
    return `${kind}:${id}`;
}

function isRewardClaimPending(kind, id) {
    return rewardClaimPending.has(rewardClaimKey(kind, id));
}

function setRewardClaimPending(kind, id, pending) {
    const key = rewardClaimKey(kind, id);
    if (pending) rewardClaimPending.add(key);
    else rewardClaimPending.delete(key);
}

function renderRewardClaimButton(kind, id, label = 'Забрати', options = {}) {
    const pending = isRewardClaimPending(kind, id);
    const action = kind === 'season' ? `claimSeasonQuest(${id})` : `claimQuest(${id})`;
    const click = options.stopPropagation
        ? `event.stopPropagation();${action}`
        : action;
    const className = `quest-claim-btn ${pending ? 'is-pending' : ''} ${options.compact ? 'is-compact' : ''}`.trim();
    return `<button class="${className}" ${pending ? 'disabled aria-busy="true"' : ''} onclick="${click}">${pending ? 'Забираю...' : label}</button>`;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? 'Invalid Date' : profileDateFormatter.format(dt);
}

const profileDateFormatter = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
const cabinetKyivDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit'
});

function profileDateOffsetStr(days = 0) {
    const d = new Date();
    d.setDate(d.getDate() + Number(days || 0));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function profileDeadlineForDate(dateText) {
    return dateText ? `${dateText}T18:00:00` : null;
}

function profileFormatTime(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatCoins(n) { return (n || 0).toLocaleString('uk-UA'); }

function profileUser(data = profileData) {
    return data?.user || data || {};
}

function profileDisplayName(data = profileData) {
    const user = profileUser(data);
    return data?.displayName || user.displayName || user.name || user.username || data?.username || 'Користувач';
}

function profileUsername(data = profileData) {
    const user = profileUser(data);
    return user.username || data?.username || '';
}

function profileRole(data = profileData) {
    const user = profileUser(data);
    return user.role || data?.role || '';
}

function profileRoleLabel(role) {
    const labels = {
        creator: 'Creator',
        director: 'Директор',
        vice_director: 'Заступник директора',
        senior_manager: 'Старший менеджер',
        manager: 'Менеджер',
        admin: 'Адміністратор',
        hr: 'HR',
        accountant: 'Бухгалтер',
        animator: 'Аніматор',
        instructor: 'Інструктор батутів',
        trampoline_instructor: 'Інструктор батутів',
        senior_instructor: 'Адміністратор ігрових зон',
        maintenance: 'Технічний директор',
        technician: 'Технічний директор',
        cleaning: 'Прибиральник',
        cleaner: 'Прибиральник',
        barista: 'Бариста',
        bartender: 'Бариста',
        cook: 'Кухар',
        head_cook: 'Кухар',
        head_chef: 'Кухар',
        art_director: 'Арт-директор'
    };
    return labels[role] || role || 'Працівник';
}

function profileExtraRoles(data = profileData) {
    const user = profileUser(data);
    const baseRole = String(user.role || data?.role || '').trim();
    const roles = [];
    if (Array.isArray(user.extraRoles)) roles.push(...user.extraRoles);
    if (Array.isArray(user.extra_roles)) roles.push(...user.extra_roles);
    if (Array.isArray(user.roles)) roles.push(...user.roles.filter(role => role !== baseRole));
    return Array.from(new Set(roles.filter(Boolean).map(role => String(role).trim()).filter(role => role && role !== baseRole)));
}

function profileWorkingRoleState(data = profileData) {
    const user = profileUser(data);
    if (window.WorkingRole?.getState) return window.WorkingRole.getState(user);
    const baseRole = String(user.role || data?.role || '').trim();
    const extraRoles = profileExtraRoles(data);
    const activeRole = String(user.activeRole || user.workingRole || baseRole || '').trim();
    const availableRoles = Array.from(new Set([baseRole, ...extraRoles].filter(Boolean)));
    return {
        baseRole,
        realRole: baseRole,
        extraRoles,
        availableRoles,
        activeRole,
        workingRole: activeRole,
        effectiveRole: activeRole,
        isBaseActive: activeRole === baseRole,
        baseLabel: profileRoleLabel(baseRole),
        realLabel: profileRoleLabel(baseRole),
        activeLabel: profileRoleLabel(activeRole),
        workingLabel: profileRoleLabel(activeRole),
        effectiveLabel: profileRoleLabel(activeRole),
        changedSurfaces: profileWorkingRoleImpact(activeRole)
    };
}

function profileWorkingRoleImpact(role) {
    const startPage = window.RoleShell?.getStartPage?.(role) || '/dashboard';
    const dashboardPreset = window.RoleShell?.getDashboardPreset?.(role) || role || 'default';
    const quickAccess = window.RoleShell?.getQuickAccessHrefs?.(role) || [];
    return [
        { label: 'Sidebar / navigation', detail: 'Рольовий фокус меню, порядок груп і quick access перебудовуються під цей режим.' },
        { label: 'Dashboard preset', detail: `Preset: ${dashboardPreset}` },
        { label: 'Quick access', detail: quickAccess.length ? quickAccess.join(' · ') : 'Базовий набір швидких входів' },
        { label: 'Start page', detail: startPage }
    ];
}

function renderProfileWorkingRoleControl(state = profileWorkingRoleState()) {
    const available = Array.isArray(state.availableRoles) ? state.availableRoles.filter(Boolean) : [];
    const extraRoles = Array.isArray(state.extraRoles) ? state.extraRoles.filter(Boolean) : [];
    const activeRole = state.activeRole || state.workingRole || state.baseRole || '';
    const baseRole = state.baseRole || state.realRole || '';
    const roleButtons = available.length
        ? available.map(role => {
            const active = role === activeRole;
            const base = role === baseRole;
            return `<button type="button" class="profile-working-role-option ${active ? 'active' : ''}" data-profile-working-role="${escapeHtml(role)}" aria-pressed="${active ? 'true' : 'false'}">
                <b>${escapeHtml(window.RoleShell?.getRoleLabel?.(role) || profileRoleLabel(role))}</b>
                <span>${base ? 'Base role' : 'Granted extra role'}</span>
            </button>`;
        }).join('')
        : '<div class="profile-working-role-empty">Роль акаунта ще не завантажена.</div>';
    const extraHtml = extraRoles.length
        ? extraRoles.map(role => `<span>${escapeHtml(window.RoleShell?.getRoleLabel?.(role) || profileRoleLabel(role))}</span>`).join('')
        : '<em>Додаткові ролі ще не надані</em>';
    const impact = (Array.isArray(state.changedSurfaces) && state.changedSurfaces.length ? state.changedSurfaces : profileWorkingRoleImpact(activeRole))
        .map(item => `<li><b>${escapeHtml(item.label || item.key || '')}</b><span>${escapeHtml(item.detail || '')}</span></li>`)
        .join('');
    const previewNotice = state.previewRole
        ? `<div class="profile-working-role-preview-note">Preview зараз активний як ${escapeHtml(state.previewLabel || profileRoleLabel(state.previewRole))}. Реальна working role лишається ${escapeHtml(state.activeLabel || profileRoleLabel(activeRole))}.</div>`
        : '';
    return `
        <div id="profileWorkingRolePanel" class="profile-working-role-panel" hidden>
            <div class="profile-working-role-head">
                <div>
                    <span class="profile-kicker">Working role flow</span>
                    <h2>Робоча роль акаунта</h2>
                </div>
                <button type="button" class="profile-working-role-close" data-profile-working-role-close aria-label="Закрити">×</button>
            </div>
            <div class="profile-working-role-grid">
                <div><span>Base role</span><b>${escapeHtml(state.baseLabel || profileRoleLabel(baseRole))}</b></div>
                <div><span>Current working role</span><b>${escapeHtml(state.activeLabel || state.workingLabel || profileRoleLabel(activeRole))}</b></div>
                <div class="profile-working-role-grants"><span>Additional granted roles</span><div>${extraHtml}</div></div>
            </div>
            ${previewNotice}
            <div class="profile-working-role-options" role="list" aria-label="Доступні робочі ролі">${roleButtons}</div>
            ${!state.isBaseActive && baseRole ? `<button type="button" class="profile-working-role-reset" data-profile-working-role-reset>Switch back to base role</button>` : ''}
            <div class="profile-working-role-impact">
                <h3>What changes in this mode</h3>
                <ul>${impact}</ul>
            </div>
        </div>`;
}

const PROFILE_PROFESSION_GUIDES = {
    creator: {
        focus: 'Стратегія CRM, контроль системи, фінальні рішення і якість операцій.',
        responsibilities: ['Тримати фокус команди', 'Приймати фінальні рішення', 'Контролювати критичні алерти'],
        checklist: ['Перевірити критичні алерти', 'Подивитись задачі, що потребують рішення', 'Звірити ключові звіти та фінанси']
    },
    director: {
        focus: 'Операційне керування, пріоритети дня, відповідальність за результат команди.',
        responsibilities: ['Керувати денним фокусом', 'Знімати блокери', 'Контролювати якість виконання'],
        checklist: ['Перевірити задачі команди', 'Підтвердити ризикові рішення', 'Закрити прострочені блокери']
    },
    vice_director: {
        focus: 'Операційна підтримка директора, дисципліна процесів і контроль виконання.',
        responsibilities: ['Підтримувати операційний ритм', 'Контролювати дедлайни', 'Підхоплювати проблемні ділянки'],
        checklist: ['Перевірити сьогоднішні задачі', 'Оновити статуси проблемних процесів', 'Підготувати питання для директора']
    },
    senior_manager: {
        focus: 'Продажі, менеджери, ліди, якість комунікації та виконання плану.',
        responsibilities: ['Контролювати ліди', 'Допомагати менеджерам', 'Підтримувати якість CRM-воронки'],
        checklist: ['Відкрити гарячі ліди', 'Перевірити прострочені follow-up', 'Оновити статус ключових клієнтів']
    },
    manager: {
        focus: 'Клієнти, ліди, бронювання, follow-up і чистота CRM-карток.',
        responsibilities: ['Обробляти ліди', 'Вести клієнтів до бронювання', 'Фіксувати домовленості'],
        checklist: ['Перевірити нові ліди', 'Дотиснути відкриті follow-up', 'Оновити картки клієнтів після дзвінків']
    },
    admin: {
        focus: 'Зал, прийом гостей, зміни, касова дисципліна і операційні задачі дня.',
        responsibilities: ['Тримати зміну', 'Фіксувати операційні події', 'Передавати важливе наступній зміні'],
        checklist: ['Перевірити графік зміни', 'Закрити задачі залу', 'Передати критичні нотатки команді']
    },
    accountant: {
        focus: 'Фінанси, звіти, перевірка витрат/доходів і статуси закриття.',
        responsibilities: ['Перевіряти звіти', 'Підтверджувати фінансові записи', 'Контролювати розбіжності'],
        checklist: ['Відкрити звіти в обробці', 'Перевірити суми та категорії', 'Поставити статус затвердження']
    },
    hr: {
        focus: 'Команда, структура, вакансії, onboarding і кадрові процеси.',
        responsibilities: ['Вести кандидатів', 'Підтримувати структуру', 'Контролювати адаптацію'],
        checklist: ['Перевірити вакансії', 'Оновити кадрові задачі', 'Подивитись onboarding та резерв']
    },
    animator: {
        focus: 'Програми, взаємодія з дітьми, підготовка до подій і якість враження.',
        responsibilities: ['Готуватись до програм', 'Вести подію за сценарієм', 'Повідомляти про ризики'],
        checklist: ['Перевірити сьогоднішню програму', 'Підготувати реквізит', 'Передати результат після події']
    },
    instructor: {
        focus: 'Безпека зони, інструктаж, контроль правил і підтримка гостей.',
        responsibilities: ['Контролювати безпеку', 'Проводити інструктаж', 'Реагувати на порушення'],
        checklist: ['Перевірити зону перед зміною', 'Провести інструктаж', 'Зафіксувати інциденти або ризики']
    },
    art_director: {
        focus: 'Креатив, дизайни, шаблони, brand book і якість візуальних матеріалів.',
        responsibilities: ['Керувати креативними задачами', 'Підтримувати бренд', 'Готувати матеріали до публікації'],
        checklist: ['Перевірити активні дизайни', 'Оновити творчі задачі', 'Підготувати матеріали до погодження']
    },
    default: {
        focus: 'Персональний робочий контекст, задачі, зміни і чеклісти для вашої ролі.',
        responsibilities: ['Тримати задачі в актуальному статусі', 'Перевіряти зміну', 'Фіксувати важливі робочі дії'],
        checklist: ['Перевірити задачі на сьогодні', 'Оновити статуси', 'Переглянути наступну зміну']
    }
};

function normalizeProfileProfessionKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .slice(0, 64);
}

function normalizeProfileProfessionList(value, exclude = []) {
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
    const blocked = new Set(exclude.map(normalizeProfileProfessionKey).filter(Boolean));
    const seen = new Set();
    const result = [];
    source.forEach(item => {
        const key = normalizeProfileProfessionKey(item);
        if (!key || blocked.has(key) || seen.has(key)) return;
        seen.add(key);
        result.push(key);
    });
    return result;
}

function profileProfessionCatalog() {
    return Array.isArray(profileData?.professionCatalog) ? profileData.professionCatalog : [];
}

function profileStaffProfile() {
    return profileData?.staffProfile || {};
}

function profileProfessionByKey(key) {
    const normalized = normalizeProfileProfessionKey(key);
    return profileProfessionCatalog().find(item => normalizeProfileProfessionKey(item.key) === normalized) || null;
}

function profilePrimaryProfessionKey() {
    const staff = profileStaffProfile();
    return normalizeProfileProfessionKey(staff.role_type || staff.roleType);
}

function profileSecondaryProfessionKeys() {
    const primary = profilePrimaryProfessionKey();
    const staff = profileStaffProfile();
    return normalizeProfileProfessionList([
        ...normalizeProfileProfessionList(staff.secondary_professions || staff.secondaryProfessions),
        ...(staff.professionAssignments || []).map(item => item.key)
    ], [primary]);
}

function profileProfessionEntry(key, options = {}) {
    const normalized = normalizeProfileProfessionKey(key) || 'default';
    const catalog = profileProfessionByKey(normalized);
    const guide = PROFILE_PROFESSION_GUIDES[normalized] || PROFILE_PROFESSION_GUIDES.default;
    const title = catalog?.title || (normalized === 'default' ? 'Професію не призначено' : profileRoleLabel(normalized));
    return {
        key: normalized,
        title,
        department: catalog?.department || '',
        shortInfo: catalog?.shortInfo || catalog?.short_info || guide.focus,
        responsibilities: Array.isArray(catalog?.responsibilities) && catalog.responsibilities.length
            ? catalog.responsibilities
            : guide.responsibilities,
        checklist: Array.isArray(catalog?.checklist) ? catalog.checklist : [],
        color: catalog?.color || '#10b981',
        assignment: profileStaffProfile().professionAssignments?.find(item => item.key === normalized) || null,
        primary: options.primary === true
    };
}

function profileProfessionEntries() {
    const primary = profilePrimaryProfessionKey();
    const keys = [primary, ...profileSecondaryProfessionKeys()].filter(Boolean);
    const unique = [];
    const seen = new Set();
    keys.forEach(key => {
        const normalized = normalizeProfileProfessionKey(key);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        unique.push(profileProfessionEntry(normalized, { primary: normalized === primary }));
    });
    return unique;
}

function profileProfessionKeys() {
    return profileProfessionEntries().map(entry => entry.key);
}

function ensureActiveProfessionKey() {
    const keys = profileProfessionKeys();
    if (!keys.length) {
        activeProfessionKey = 'default';
        return activeProfessionKey;
    }
    if (!activeProfessionKey || !keys.includes(normalizeProfileProfessionKey(activeProfessionKey))) {
        activeProfessionKey = keys[0];
    }
    return activeProfessionKey;
}

function profileActiveProfessionEntry() {
    const activeKey = ensureActiveProfessionKey();
    return profileProfessionEntries().find(entry => entry.key === activeKey)
        || profileProfessionEntries()[0]
        || profileProfessionEntry('default', { primary: true });
}

function profileTrainingRoleKey(key = ensureActiveProfessionKey()) {
    const normalized = normalizeProfileProfessionKey(key);
    const knownTrainingRoles = new Set(['animator', 'admin', 'manager']);
    if (knownTrainingRoles.has(normalized)) return normalized;
    if (/admin|reception|cashier|operator/.test(normalized)) return 'admin';
    if (/manager|director|creator|sales|lead/.test(normalized)) return 'manager';
    if (/animator|quest|host|show|photo|mk|pinata/.test(normalized)) return 'animator';
    return normalized || 'all';
}

function normalizeProfileTaskTab(tab) {
    return tab === 'mytasks' ? 'myday' : tab;
}

function normalizeProfileTab(tab) {
    if (isOwnProfile) {
        if (['profile', 'professions', 'checklists', 'materials'].includes(tab)) return 'workbase';
        if (PROFILE_ALWAYS_SOON_TABS.has(tab)) return 'myday';
    }
    const requested = tab === 'profile' ? 'professions' : tab;
    return normalizeProfileTaskTab(requested);
}

function focusProfileWorkBaseSection() {
    if (activeTab !== 'workbase') return;
    const hash = window.location.hash;
    if (!['#work-base-checklists', '#work-base-materials'].includes(hash)) return;
    window.requestAnimationFrame(() => {
        if (activeTab !== 'workbase' || window.location.hash !== hash) return;
        const section = document.getElementById(hash.slice(1));
        section?.focus({ preventScroll: true });
        section?.scrollIntoView({ block: 'start' });
    });
}

function applyProfilePeriodFromUrl() {
    if (activeTab !== 'myday') return;
    const period = new URLSearchParams(window.location.search).get('period');
    pendingMyDayPeriod = ['today', 'overdue', 'future'].includes(period) ? period : null;
}

function syncProfileTabToUrl(tab = activeTab, options = {}) {
    if (typeof window === 'undefined' || !window.history || !window.location) return;
    const normalized = normalizeProfileTab(tab) || 'professions';
    const params = new URLSearchParams(window.location.search || '');
    if (normalized === 'professions') params.delete('tab');
    else params.set('tab', normalized);
    if (normalized !== 'myday') {
        params.delete('period');
        params.delete('open');
        params.delete('date');
    }
    const query = params.toString();
    const hash = options.hash ?? window.location.hash;
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`;
    if (nextUrl === currentUrl) return;
    const method = options.replace ? 'replaceState' : 'pushState';
    window.history[method]?.({ profileTab: normalized }, '', nextUrl);
}

function isProfileTaskProjectionTab(tab = activeTab) {
    return normalizeProfileTaskTab(tab) === 'myday';
}

function profileWorkHubTabOrder() {
    return [
        {
            id: 'professions',
            label: 'Професії',
            kicker: 'Профконтекст',
            detail: 'Огляд, перемикання і база ролі',
            core: true
        },
        {
            id: 'checklists',
            label: 'Чеклісти',
            kicker: 'Контроль ролі',
            detail: 'Пункти активної професії та live-задачі',
            core: true
        },
        {
            id: 'materials',
            label: 'Матеріали',
            kicker: 'База знань',
            detail: 'Навчання, інструкції і робочі нотатки',
            core: true
        },
        {
            id: 'settings',
            label: 'Налаштування',
            kicker: 'Акаунт',
            detail: 'Профіль, avatar і безпека',
            ownOnly: true
        }
    ];
}

function profileSecondaryTabOrder() {
    return [
        { id: 'myday', label: 'Мій день', ownOnly: true },
        ...profileWorkHubTabOrder().map(({ id, label, ownOnly }) => ({ id, label, ownOnly })),
        ...Object.entries(PROFILE_EMPLOYEE_TABS).map(([id, label]) => ({ id, label, ownOnly: true })),
        { id: 'achievements', label: 'Досягнення' },
        { id: 'leaderboard', label: 'Рейтинг' },
        { id: 'inventory', label: 'Інвентар' },
        { id: 'shop', label: 'Магазин' },
        { id: 'quests', label: 'Щоденні', ownOnly: true },
        { id: 'season', label: 'Сезон' },
        { id: 'teams', label: 'Команди' },
        { id: 'referral', label: 'Реферали', ownOnly: true }
    ];
}

const PROFILE_ALWAYS_SOON_TABS = new Set(['shop', 'inventory', 'achievements', 'leaderboard', 'quests', 'season', 'teams', 'referral', 'titles', 'room']);
const PROFILE_SOON_TAB_COPY = {
    inventory: { title: 'Інвентар скоро', kicker: 'Скоро', message: 'Інвентар поки недоступний у версії для парку.' },
    shop: { title: 'Магазин скоро', kicker: 'Скоро', message: 'Магазин поки недоступний у версії для парку.' },
    achievements: { title: 'Досягнення скоро', kicker: 'Скоро', message: 'Досягнення поки недоступні у версії для парку.' },
    leaderboard: { title: 'Рейтинг скоро', kicker: 'Скоро', message: 'Рейтинг поки недоступний у версії для парку.' },
    quests: {
        title: 'Щоденні скоро',
        kicker: 'Coming soon',
        message: 'Щоденні завдання ще в підготовці. Розділ буде відкрито після перевірки нагород і стабільності прогресу.'
    },
    season: {
        title: 'Сезон скоро',
        kicker: 'Coming soon',
        message: 'Сезонний прогрес закритий до повного запуску правил, винагород і періодів сезону.'
    },
    teams: {
        title: 'Команди скоро',
        kicker: 'Coming soon',
        message: 'Командні механіки ще не відкриті. Поки вони не впливають на роботу профілю або рейтинг.'
    },
    referral: {
        title: 'Реферали скоро',
        kicker: 'Coming soon',
        message: 'Реферальна програма буде доступна після окремого запуску правил, винагород і звітності.'
    }
};

function profileViewerRole() {
    const appUser = typeof AppState !== 'undefined' ? AppState.currentUser : null;
    return String(appUser?.role || appUser?.account_role || appUser?.accountRole || profileRole(profileData) || '').toLowerCase();
}

function profileViewerIsCreator() {
    return profileViewerRole() === 'creator';
}

function profileTabLock(tab) {
    if (PROFILE_ALWAYS_SOON_TABS.has(tab)) {
        return { code: 'soon', soon: true, creatorOnly: false };
    }
    return null;
}

function profileCanOpenTab(tab) {
    return !profileTabLock(tab);
}

function renderProfilePrimaryTab(tab, label, options = {}) {
    if (options.ownOnly && !isOwnProfile) return '';
    const lock = profileTabLock(tab);
    const classes = [
        'profile-primary-tab',
        activeTab === tab ? 'active' : '',
        lock ? 'is-soon is-locked' : ''
    ].filter(Boolean).join(' ');
    const attrs = lock
        ? ' data-profile-locked="true" data-profile-soon="скоро"'
        : '';
    return `<button type="button" class="${classes}" data-profile-tab="${tab}" onclick="switchTab('${tab}')"${activeTab === tab ? ' aria-current="page"' : ''}${attrs}>${escapeHtml(label)}${options.suffix || ''}</button>`;
}

function renderProfileSoonMenu(tabs = []) {
    const visibleTabs = tabs.filter(tab => !(tab.ownOnly && !isOwnProfile));
    if (!visibleTabs.length) return '';
    const activeSoon = visibleTabs.some(tab => tab.id === activeTab);
    const items = visibleTabs.map(tab => {
        const active = tab.id === activeTab;
        const copy = PROFILE_SOON_TAB_COPY[tab.id] || {};
        return `
            <button type="button"
                class="profile-soon-menu-item ${active ? 'active' : ''}"
                data-profile-tab="${escapeHtml(tab.id)}"
                onclick="switchProfileSoonTab('${escapeHtml(tab.id)}')"
                role="menuitem">
                <span>${escapeHtml(tab.label)}</span>
                <small>${escapeHtml(copy.kicker || 'Coming soon')}</small>
            </button>`;
    }).join('');
    return `
        <div class="profile-soon-menu" data-profile-soon-menu>
            <button type="button"
                class="profile-primary-tab profile-soon-menu-trigger ${activeSoon ? 'active' : ''}"
                data-profile-soon-trigger="true"
                aria-haspopup="menu"
                aria-expanded="false"
                onclick="toggleProfileSoonMenu(event)">
                Скоро <span>${visibleTabs.length}</span>
            </button>
            <div class="profile-soon-menu-panel" data-profile-soon-panel-menu role="menu" hidden>
                ${items}
            </div>
        </div>`;
}

function profileWorkTabMetric(tabId) {
    tabId = normalizeProfileTaskTab(tabId);
    const active = profileActiveProfessionEntry();
    const entries = profileProfessionEntries();
    const quick = myCabinetData?.stats?.taskQuick || {};
    switch (tabId) {
        case 'professions':
            return entries.length ? `Призначено: ${entries.length}` : 'Не призначено';
        case 'checklists':
            return `${(active.checklist || []).length || 0} пунктів`;
        case 'materials': {
            const loadedForActive = profileMaterialsState.loaded && profileMaterialsState.key === active.key;
            if (!loadedForActive) return profileTrainingRoleKey(active.key);
            const count = (profileMaterialsState.articles || []).length + (profileMaterialsState.materials || []).length;
            return count ? `${count} матеріалів` : 'немає';
        }
        case 'myday':
            return `${Number(quick.completedToday || quick.completed || 0)} виконано`;
        case 'settings':
            return 'безпека';
        default:
            return '';
    }
}

function renderProfileWorkAccessTab(tab) {
    if (tab.ownOnly && !isOwnProfile) return '';
    const lock = profileTabLock(tab.id);
    const active = activeTab === tab.id;
    const classes = [
        'profile-work-access-tab',
        tab.core ? 'profile-work-access-tab--core' : 'profile-work-access-tab--support',
        active ? 'active' : '',
        lock ? 'is-soon is-locked' : ''
    ].filter(Boolean).join(' ');
    const attrs = [
        `data-profile-tab="${escapeHtml(tab.id)}"`,
        tab.core ? 'data-profile-core-access="true"' : '',
        lock ? 'data-profile-locked="true" data-profile-soon="скоро"' : '',
        `aria-selected="${active ? 'true' : 'false'}"`,
        active ? 'aria-current="page"' : ''
    ].filter(Boolean).join(' ');
    return `
        <button type="button" role="tab" class="${classes}" onclick="switchTab('${escapeHtml(tab.id)}')" ${attrs}>
            <span class="profile-work-access-kicker">${escapeHtml(tab.kicker || '')}</span>
            <b>${escapeHtml(tab.label)}</b>
            <small>${escapeHtml(tab.detail || '')}</small>
            <em>${escapeHtml(profileWorkTabMetric(tab.id))}</em>
        </button>`;
}

function renderProfileComingSoon(tab) {
    const copy = PROFILE_SOON_TAB_COPY[tab] || {
        title: 'Скоро',
        kicker: 'Coming soon',
        message: 'Розділ ще не відкритий для роботи.'
    };
    return `
    <div class="profile-soon-panel" data-profile-soon-panel="${escapeHtml(tab)}">
        <div class="profile-soon-ribbon">скоро</div>
        <div class="profile-soon-kicker">${escapeHtml(copy.kicker)}</div>
        <h3>${escapeHtml(copy.title)}</h3>
        <p>${escapeHtml(copy.message)}</p>
    </div>`;
}

function profileInitial(data = profileData) {
    return profileDisplayName(data).trim().charAt(0).toUpperCase() || '?';
}

const RARITY_LABELS = { common: 'Звичайний', uncommon: 'Незвичайний', rare: 'Рідкісний', epic: 'Епічний', legendary: 'Легендарний' };
const CATEGORY_EMOJIS = { background: '🖼️', weapon: '⚔️', hat: '🎩', outfit: '👕', frame: '🖼️', coupon: '🎫', effect: '✨', wallpaper: '🏠', floor: '🟫', furniture: '🪑' };
const NOTE_COLORS = ['#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#f3e8ff', '#e0e7ff'];
const FURNITURE_EMOJIS = { furn_desk: '🖥️', furn_plant: '🪴', furn_trophy: '🏆', furn_arcade: '🎮', furn_dino_statue: '🦕' };
const MOOD_EMOJIS = { happy: '😊', working: '💼', tired: '😴', excited: '🤩', chill: '😎' };
const QUEST_ICONS = { complete_tasks: '✅', create_booking: '📋', play_minigame: '🎮', visit_room: '🏠', send_message: '💬', early_login: '🌅', mark_shift: '⏰', meta_quest: '⭐' };
const PROFILE_AVATAR_COLORS = ['#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#64748b'];
const PROFILE_AVATAR_CROP_DEFAULT = Object.freeze({ x: 50, y: 50, zoom: 1 });

function clampProfileNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
}

function normalizeProfileAvatarCrop(input = {}) {
    return {
        x: Math.round(clampProfileNumber(input.x ?? input.positionX, 0, 100, PROFILE_AVATAR_CROP_DEFAULT.x)),
        y: Math.round(clampProfileNumber(input.y ?? input.positionY, 0, 100, PROFILE_AVATAR_CROP_DEFAULT.y)),
        zoom: Number(clampProfileNumber(input.zoom ?? input.scale, 1, 2, PROFILE_AVATAR_CROP_DEFAULT.zoom).toFixed(2))
    };
}

function profileAvatarPhotoUrl(data = profileData) {
    const user = profileUser(data);
    return user.avatarUrl || user.avatar_url || data?.avatarUrl || data?.avatar_url || '';
}

function profileAvatarCropHash(value) {
    const text = String(value || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36) || '0';
}

function profileCurrentUserSnapshot() {
    const appUser = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    let savedUser = {};
    try {
        const key = (typeof CONFIG !== 'undefined' && CONFIG.STORAGE?.CURRENT_USER) ? CONFIG.STORAGE.CURRENT_USER : 'pzp_current_user';
        savedUser = JSON.parse(localStorage.getItem(key) || '{}') || {};
    } catch {}
    return { ...savedUser, ...appUser };
}

function profileAvatarCropUsesSession(data = profileData, sessionUser = profileCurrentUserSnapshot()) {
    if (!sessionUser?.id && !sessionUser?.username) return false;
    if (data === profileData && isOwnProfile) return true;
    const user = data?.user || data || {};
    const ids = [user.id, data?.id].map(value => String(value || '').trim()).filter(Boolean);
    const usernames = [user.username, data?.username].map(value => String(value || '').trim()).filter(Boolean);
    return (sessionUser.id && ids.includes(String(sessionUser.id))) ||
        (sessionUser.username && usernames.includes(String(sessionUser.username)));
}

function profileAvatarCropOwnerCandidates(data = profileData) {
    const user = data?.user || data || {};
    const sessionUser = profileCurrentUserSnapshot();
    const useSession = profileAvatarCropUsesSession(data, sessionUser);
    const candidates = [
        user.id,
        user.username,
        data?.id,
        data?.username,
        useSession ? sessionUser.id : null,
        useSession ? sessionUser.username : null,
        useSession ? currentUserId : null,
        user.name,
        data?.name,
        'current'
    ];
    const seen = new Set();
    return candidates
        .map(value => String(value || '').trim())
        .filter(value => {
            if (!value || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
}

function profileAvatarCropStorageKeys(data = profileData, urlOverride = '') {
    const url = urlOverride || profileAvatarPhotoUrl(data);
    const hash = profileAvatarCropHash(url);
    const owners = profileAvatarCropOwnerCandidates(data);
    return owners.map(value => `pzp_profile_avatar_crop:${value}:${hash}`);
}

function profileAvatarCropStorageKey(data = profileData, urlOverride = '') {
    return profileAvatarCropStorageKeys(data, urlOverride)[0] || `pzp_profile_avatar_crop:current:${profileAvatarCropHash(urlOverride || profileAvatarPhotoUrl(data))}`;
}

function readProfileAvatarCrop(data = profileData, urlOverride = '') {
    const user = data?.user || data || {};
    const url = urlOverride || profileAvatarPhotoUrl(data);
    const sessionUser = profileCurrentUserSnapshot();
    const directSources = profileAvatarCropUsesSession(data, sessionUser) ? [user, data, sessionUser] : [user, data];
    for (const source of directSources) {
        const direct = source?.avatarCrop || source?.avatar_crop;
        const directUrl = source?.avatarCropUrl || source?.avatar_crop_url || '';
        if (direct && typeof direct === 'object' && (!directUrl || directUrl === url)) return normalizeProfileAvatarCrop(direct);
    }
    try {
        for (const key of profileAvatarCropStorageKeys(data, url)) {
            const raw = localStorage.getItem(key);
            if (raw) return normalizeProfileAvatarCrop(JSON.parse(raw));
        }
    } catch {}
    return { ...PROFILE_AVATAR_CROP_DEFAULT };
}

function writeProfileAvatarCrop(data = profileData, urlOverride = '', crop = PROFILE_AVATAR_CROP_DEFAULT) {
    const normalized = normalizeProfileAvatarCrop(crop);
    try {
        profileAvatarCropStorageKeys(data, urlOverride).forEach(key => {
            localStorage.setItem(key, JSON.stringify(normalized));
        });
    } catch {}
    return normalized;
}

function profileAvatarCropStyle(crop = PROFILE_AVATAR_CROP_DEFAULT) {
    const normalized = normalizeProfileAvatarCrop(crop);
    return `width:100%;height:100%;object-fit:cover;object-position:${normalized.x}% ${normalized.y}%;transform:scale(${normalized.zoom});transform-origin:${normalized.x}% ${normalized.y}%;display:block;`;
}

function applyProfileAvatarCropToImage(img, crop = null) {
    if (!img) return;
    const normalized = normalizeProfileAvatarCrop(crop || readProfileAvatarCrop());
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.objectPosition = `${normalized.x}% ${normalized.y}%`;
    img.style.transform = `scale(${normalized.zoom})`;
    img.style.transformOrigin = `${normalized.x}% ${normalized.y}%`;
    img.style.display = 'block';
}

function currentProfileAvatarCropFromControls() {
    return normalizeProfileAvatarCrop({
        x: document.getElementById('profileAvatarPositionX')?.value,
        y: document.getElementById('profileAvatarPositionY')?.value,
        zoom: document.getElementById('profileAvatarZoom')?.value
    });
}

function syncProfileAvatarCropControls(crop = PROFILE_AVATAR_CROP_DEFAULT) {
    const normalized = normalizeProfileAvatarCrop(crop);
    const fields = {
        profileAvatarPositionX: normalized.x,
        profileAvatarPositionY: normalized.y,
        profileAvatarZoom: normalized.zoom
    };
    Object.entries(fields).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = String(value);
    });
    const valueEl = document.getElementById('profileAvatarCropValue');
    if (valueEl) valueEl.textContent = `${normalized.x}/${normalized.y} · ${normalized.zoom.toFixed(2)}x`;
}

function profileAvatarData(data = profileData) {
    const user = profileUser(data);
    const url = profileAvatarPhotoUrl(data);
    return {
        url,
        emoji: user.avatarEmoji || user.avatar_emoji || data?.avatarEmoji || data?.avatar_emoji || '',
        color: user.avatarColor || user.avatar_color || data?.avatarColor || data?.avatar_color || '#f59e0b',
        initial: profileInitial(data),
        crop: readProfileAvatarCrop(data, url)
    };
}

function renderProfileAvatarVisual(className = 'profile-work-avatar', data = profileData, attrs = '') {
    const avatar = profileAvatarData(data);
    const style = avatar.color ? ` style="background:${escapeHtml(avatar.color)}"` : '';
    if (avatar.url) {
        return `<div class="${className}"${attrs}><img src="${escapeHtml(avatar.url)}" alt="" style="${profileAvatarCropStyle(avatar.crop)}"></div>`;
    }
    return `<div class="${className}"${style}${attrs}>${escapeHtml(avatar.initial)}</div>`;
}

function syncOwnProfileAvatarSession(data = profileData) {
    if (!isOwnProfile || !data?.user) return data;
    const sessionUser = profileCurrentUserSnapshot();
    const serverUser = data.user || {};
    const avatarUrl = serverUser.avatarUrl || serverUser.avatar_url || sessionUser.avatarUrl || sessionUser.avatar_url || '';
    const sessionCrop = sessionUser.avatarCrop || sessionUser.avatar_crop;
    const sessionCropUrl = sessionUser.avatarCropUrl || sessionUser.avatar_crop_url || '';
    const {
        avatarCrop,
        avatar_crop,
        avatarCropUrl,
        avatar_crop_url,
        ...sessionBase
    } = sessionUser;
    const nextUser = {
        ...sessionBase,
        ...serverUser,
        id: serverUser.id || sessionUser.id || currentUserId || null
    };
    if (!nextUser.avatarCrop && sessionCrop && typeof sessionCrop === 'object' && (!sessionCropUrl || sessionCropUrl === avatarUrl)) {
        nextUser.avatarCrop = normalizeProfileAvatarCrop(sessionCrop);
        nextUser.avatarCropUrl = sessionCropUrl || avatarUrl;
    }
    data.user = nextUser;
    return data;
}

// ==========================================
// API
// ==========================================
async function apiGet(path) {
    try {
        const r = await fetch(`/api${path}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return null;
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { console.error('API GET', path, e); return null; }
}

async function apiGetScoped(path) {
    try {
        const raw = String(path || '');
        const normalized = raw.startsWith('/api') ? raw : `/api${raw.startsWith('/') ? raw : `/${raw}`}`;
        const url = typeof window !== 'undefined' && window.CrmBusinessContext?.apiUrl
            ? window.CrmBusinessContext.apiUrl(normalized)
            : normalized;
        const r = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return null;
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { console.error('API scoped GET', path, e); return null; }
}

function cabinetCompletionHistoryApiUrl({ cursor = '', limit = CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT } = {}) {
    const params = new URLSearchParams();
    params.set('period', 'history');
    params.set('planningView', 'my-day');
    params.set('limit', String(Math.max(1, Math.min(100, Number(limit || CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT) || CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT))));
    if (cursor) params.set('cursor', String(cursor));
    const path = `/api/tasks/my-cabinet/completions?${params.toString()}`;
    return typeof window !== 'undefined' && window.CrmBusinessContext?.apiUrl
        ? window.CrmBusinessContext.apiUrl(path)
        : path;
}

async function fetchCabinetCompletionHistoryPage({ cursor = '', limit = CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT } = {}) {
    const url = cabinetCompletionHistoryApiUrl({ cursor, limit });
    const response = await fetch(url, { headers: getAuthHeaders(false) });
    if (handleAuthError(response)) {
        return { success: false, error: 'Потрібна повторна авторизація.', status: response?.status || 401 };
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
        return {
            success: false,
            error: payload?.error || payload?.message || 'Не вдалося завантажити історію виконань.',
            code: payload?.code || '',
            status: response.status
        };
    }
    return {
        success: true,
        items: Array.isArray(payload.items) ? payload.items : [],
        pagination: payload.pagination || {},
        totals: payload.totals || {}
    };
}

async function apiGetScopedJson(path, options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || CABINET_PROJECTION_TIMEOUT_MS));
    const raw = String(path || '');
    const normalized = raw.startsWith('/api') ? raw : `/api${raw.startsWith('/') ? raw : `/${raw}`}`;
    const url = typeof window !== 'undefined' && window.CrmBusinessContext?.apiUrl
        ? window.CrmBusinessContext.apiUrl(normalized)
        : normalized;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller && typeof window !== 'undefined' && typeof window.setTimeout === 'function'
        ? window.setTimeout(() => controller.abort(), timeoutMs)
        : null;
    const externalSignal = options.signal;
    const abortFromExternal = () => controller?.abort?.();
    if (externalSignal && controller) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener?.('abort', abortFromExternal, { once: true });
    }
    try {
        const response = await fetch(url, {
            headers: getAuthHeaders(false),
            signal: controller?.signal || externalSignal,
            cache: options.cache
        });
        if (handleAuthError(response)) return null;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            const error = new Error(payload?.error || `HTTP ${response.status}`);
            error.status = response.status;
            error.code = payload?.code || '';
            throw error;
        }
        return payload;
    } catch (error) {
        if (error?.name === 'AbortError') {
            const timeoutError = new Error('Час очікування задач вичерпано. Спробуйте повторити.');
            timeoutError.name = 'TimeoutError';
            timeoutError.code = 'MY_DAY_CABINET_TIMEOUT';
            throw timeoutError;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            const offlineError = new Error('Немає зʼєднання. Мій день покаже останні дані, якщо вони вже були завантажені.');
            offlineError.name = 'OfflineError';
            offlineError.code = 'MY_DAY_CABINET_OFFLINE';
            throw offlineError;
        }
        throw error;
    } finally {
        if (timeout) window.clearTimeout(timeout);
        externalSignal?.removeEventListener?.('abort', abortFromExternal);
    }
}

function cabinetProjectionLoadErrorText(message = '') {
    return message || 'Не вдалося завантажити задачі. Перевірте зʼєднання і повторіть спробу.';
}

function setMyCabinetProjectionData(data, options = {}) {
    if (data && typeof data === 'object') {
        myCabinetData = data;
        myCabinetLoadError = '';
        syncCabinetCompletionHistoryStateFromProjection(data);
        myCabinetLoadState = 'loaded';
        syncProfileControlCount();
        return myCabinetData;
    }
    myCabinetLoadError = cabinetProjectionLoadErrorText(options.message);
    myCabinetLoadState = myCabinetData && options.keepExistingOnError === true ? 'stale' : 'error';
    if (options.keepExistingOnError !== true) {
        myCabinetData = null;
    }
    return null;
}

async function loadMyCabinetProjection(options = {}) {
    const requestedFocusDate = cabinetTaskDateKeyFromValue(options.focusDate || '');
    const selectedFocusDate = normalizeCabinetDuePreset(cabinetCreateDuePreset) === 'custom'
        ? cabinetSelectedDueDate()
        : '';
    const focusDate = requestedFocusDate || myDayLinkedDate || selectedFocusDate;
    const params = new URLSearchParams({ planningView: 'my-day' });
    if (focusDate) params.set('focusDate', focusDate);
    const path = `/tasks/my-cabinet?${params}`;
    const reminderScope = cabinetHrReminderScope();
    const cacheKey = `${reminderScope}:${path}`;
    const now = Date.now();
    if (options.force !== true
        && cabinetProjectionRecent.path === cacheKey
        && cabinetProjectionRecent.data
        && now - cabinetProjectionRecent.at <= CABINET_PROJECTION_RECENT_REUSE_MS) {
        return setMyCabinetProjectionData(cabinetProjectionRecent.data, {
            keepExistingOnError: options.keepExistingOnError,
            message: options.message
        });
    }
    if (cabinetProjectionInFlightByPath.has(cacheKey)) {
        return cabinetProjectionInFlightByPath.get(cacheKey);
    }
    const requestSequence = ++cabinetProjectionRequestSequence;
    myCabinetLoadState = myCabinetData ? 'refreshing' : 'loading';
    if (!myCabinetData) myCabinetLoadError = '';
    const promise = (async () => {
        try {
            const data = await apiGetScopedJson(path, {
                timeoutMs: options.timeoutMs || CABINET_PROJECTION_TIMEOUT_MS
            });
            if (requestSequence !== cabinetProjectionRequestSequence || reminderScope !== cabinetHrReminderScope()) return myCabinetData;
            if (data && typeof data === 'object') {
                data.hrReminderScope = reminderScope;
                cabinetProjectionRecent = { path: cacheKey, at: Date.now(), data };
            }
            return setMyCabinetProjectionData(data, {
                keepExistingOnError: options.keepExistingOnError,
                message: options.message
            });
        } catch (error) {
            if (requestSequence !== cabinetProjectionRequestSequence || reminderScope !== cabinetHrReminderScope()) return myCabinetData;
            return setMyCabinetProjectionData(null, {
                keepExistingOnError: options.keepExistingOnError !== false,
                message: error?.message || options.message
            });
        } finally {
            if (cabinetProjectionInFlightByPath.get(cacheKey) === promise) {
                cabinetProjectionInFlightByPath.delete(cacheKey);
            }
        }
    })();
    cabinetProjectionInFlightByPath.set(cacheKey, promise);
    return promise;
}

async function apiPost(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return normalizeApiErrorResult({ status: r?.status || 401 }, 'Помилка запиту');
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            return normalizeApiErrorResult({ ...payload, status: r.status }, 'Помилка запиту');
        }
        return payload;
    } catch (e) {
        console.error('API POST', path, e);
        return normalizeApiErrorResult(e, 'Помилка запиту');
    }
}

async function apiPut(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return normalizeApiErrorResult({ status: r?.status || 401 }, 'Помилка запиту');
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            return normalizeApiErrorResult({ ...payload, status: r.status }, 'Помилка запиту');
        }
        return payload;
    } catch (e) {
        console.error('API PUT', path, e);
        return normalizeApiErrorResult(e, 'Помилка запиту');
    }
}

async function apiPatch(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return normalizeApiErrorResult({ status: r?.status || 401 }, 'Помилка запиту');
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            return normalizeApiErrorResult({ ...payload, status: r.status }, 'Помилка запиту');
        }
        return payload;
    } catch (e) {
        console.error('API PATCH', path, e);
        return normalizeApiErrorResult(e, 'Помилка запиту');
    }
}

async function apiDelete(path) {
    try {
        const r = await fetch(`/api${path}`, { method: 'DELETE', headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return normalizeApiErrorResult({ status: r?.status || 401 }, 'Помилка запиту');
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            return normalizeApiErrorResult({ ...payload, status: r.status }, 'Помилка запиту');
        }
        return payload;
    } catch (e) {
        console.error('API DELETE', path, e);
        return normalizeApiErrorResult(e, 'Помилка запиту');
    }
}

// ==========================================
// PAGE INIT
// ==========================================
async function initProfilePage() {
    // Dark mode
    if (localStorage.getItem('pzp_dark_mode') !== 'false') {
        document.body.classList.add('dark-mode');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
    }

    // Get current user
    try {
        const user = typeof apiVerifyToken === 'function' ? await apiVerifyToken() : null;
        if (!user) {
            if (typeof handleTransientAuthSessionBootstrap === 'function'
                && handleTransientAuthSessionBootstrap({ retry: () => window.location.reload(), containerId: 'main-content' })) {
                return;
            }
            const route = typeof normalizeSafeAuthReturnRoute === 'function' ? normalizeSafeAuthReturnRoute() : '';
            if (route.startsWith('/profile?tab=myday&open=') && typeof rememberAuthReturnRoute === 'function') {
                rememberAuthReturnRoute('my-day-task');
            }
            window.location.href = '/';
            return;
        }
        if (typeof AppState !== 'undefined') AppState.currentUser = user;
        if (typeof hydrateBusinessOperatingProfile === 'function') await hydrateBusinessOperatingProfile(user);
        if (!user.accessContext || user.accessContext.status === 'ready') {
            if (typeof hydrateActionPermissions === 'function') await hydrateActionPermissions(user);
            window.WorkingRole?.hydrate?.();
        }
        currentUserId = user.id;
    } catch (e) {
        if (typeof handleTransientAuthSessionBootstrap === 'function'
            && handleTransientAuthSessionBootstrap({ retry: () => window.location.reload(), containerId: 'main-content' })) {
            return;
        }
        window.location.href = '/';
        return;
    }

    // Check URL for user ID
    const params = new URLSearchParams(window.location.search);
    const viewUserId = parseInt(params.get('id')) || currentUserId;
    isOwnProfile = viewUserId === currentUserId;
    const authenticatedProfileUser = typeof AppState !== 'undefined' ? AppState.currentUser : null;
    if (isOwnProfile && authenticatedProfileUser?.accessContext && authenticatedProfileUser.accessContext.status !== 'ready') {
        document.getElementById('main-content').innerHTML = '<div class="profile-page"><section class="profile-work-panel"><h1>Ваш акаунт</h1><p>Оберіть доступний бізнес, щоб відкрити робочий профіль. Якщо доступу немає, зверніться до власника організації.</p><div class="profile-avatar-action-row"><a href="/" class="profile-settings-primary">Вибрати бізнес</a><button type="button" onclick="window.location.reload()">Перевірити доступ</button><button type="button" onclick="logout()">Вийти</button></div></section></div>';
        if (canOpenOrganizationSettings(authenticatedProfileUser)) {
            const actions = document.querySelector('#main-content .profile-avatar-action-row');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Керувати організацією';
            button.addEventListener('click', () => openOrganizationSettings({ opener: button }));
            actions.appendChild(button);
        }
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell({ markRuntimeReady: false });
        else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
        const telegramPanel = document.createElement('section');
        telegramPanel.className = 'profile-work-panel';
        document.getElementById('main-content').appendChild(telegramPanel);
        void window.TelegramCrmProfile?.mount(telegramPanel);
        return;
    }
    const requestedTab = params.get('tab');
    const normalizedRequestedTab = normalizeProfileTab(requestedTab);
    const allowedOwnTabs = ['workbase', 'myday', 'control', 'settings', ...Object.keys(PROFILE_EMPLOYEE_TABS)];
    if (isOwnProfile) {
        activeTab = allowedOwnTabs.includes(normalizedRequestedTab) ? normalizedRequestedTab : 'myday';
    }
    const legacySection = { checklists: '#work-base-checklists', materials: '#work-base-materials' }[requestedTab];
    syncProfileTabToUrl(activeTab, { replace: true, hash: activeTab === 'workbase' && legacySection ? legacySection : undefined });
    applyProfilePeriodFromUrl();
    if (typeof window !== 'undefined' && window.addEventListener && !window.__profileTabPopstateBound) {
        window.__profileTabPopstateBound = true;
        window.addEventListener('crm:alerts-updated', syncProfileControlNewBadge);
        const refreshVisibleControl = () => {
            if (!document.hidden && activeTab === 'control') void loadProfileControlTasks();
        };
        document.addEventListener('visibilitychange', refreshVisibleControl);
        window.addEventListener('online', refreshVisibleControl);
        window.addEventListener('ws:alert', refreshVisibleControl);
        window.addEventListener('popstate', async () => {
            const nextTab = normalizeProfileTab(new URLSearchParams(window.location.search || '').get('tab')) || (isOwnProfile ? 'myday' : 'professions');
            if (nextTab !== activeTab || ['myday', 'workbase'].includes(nextTab) || Object.hasOwn(PROFILE_EMPLOYEE_TABS, nextTab)) {
                await switchTab(nextTab, { skipUrl: true });
            }
            syncMyDayTaskDialog();
        });
        for (const event of ['crmBusinessContextChanged', 'crmBusinessScopeChanged', 'permissions:lifecycle']) {
            window.addEventListener(event, () => {
                const taskDialog = document.querySelector('.park-task-dialog[open]');
                if (taskDialog && (!taskDialog.canLeave || taskDialog.canLeave())) {
                    // Data invalidation is not an explicit user dismissal. Keep the
                    // navigation intent and reload detail through the scoped API.
                    taskDialog.dataset.keepTaskIntent = 'true';
                    taskDialog.close();
                    queueMicrotask(() => syncMyDayTaskDialog());
                }
                const composer = document.getElementById('cabinetTaskComposer');
                if (composer && composer.dataset.creationScope !== cabinetHrReminderScope()) {
                    cabinetCreateContext = null;
                    cabinetLeadCollaboration = null;
                    cabinetCreateAssignment = null;
                    myCabinetData = null;
                    myDayUndatedOpen = false;
                    myCabinetLoadState = 'loading';
                    rerenderCabinetTaskTabs();
                    void refreshMyCabinetTab({ force: true, keepExistingOnError: false });
                }
                profileControlTasks = null;
                document.querySelectorAll('[data-profile-control-list]').forEach(list => {
                    list.innerHTML = renderProfileControlList(list.dataset.profileControlList);
                });
                syncProfileControlCount();
                if (isOwnProfile && activeTab === 'control') void loadProfileControlTasks();
                for (const tab of Object.keys(PROFILE_EMPLOYEE_TABS)) delete profileEmployeeMonthState[tab];
                if (isOwnProfile && Object.hasOwn(PROFILE_EMPLOYEE_TABS, activeTab)) {
                    void loadProfileEmployeeMonth(activeTab);
                }
            });
        }
    }

    // Load data
    initialHrReminderLinkPending = isOwnProfile && activeTab === 'myday'
        && window.location.hash === '#hr-personal-reminders';
    await loadProfileData(viewUserId);
    renderProfile();
    if (isOwnProfile && activeTab === 'control') void loadProfileControlTasks();
    if (isOwnProfile && activeTab === 'workbase') {
        void loadProfileWorkMaterials();
        focusProfileWorkBaseSection();
    }
    if (isOwnProfile && Object.hasOwn(PROFILE_EMPLOYEE_TABS, activeTab)) void loadProfileEmployeeMonth(activeTab);
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
    syncMyDayTaskDialog(null, { initialize: true });
}

async function loadProfileData(userId) {
    profileData = syncOwnProfileAvatarSession(await apiGet(isOwnProfile ? '/auth/profile' : `/auth/profile/${userId}`));
    myNotes = [];
    if (!isOwnProfile) {
        myCabinetData = null;
        myCabinetLoadError = '';
    }
    profileWidgetConfig = normalizeProfileCockpitWidgets(profileData?.profilePreferences?.cockpitWidgets);
    ensureActiveProfessionKey();
    if (isOwnProfile && isProfileTaskProjectionTab(activeTab)) {
        myCabinetLoadState = myCabinetData ? 'refreshing' : 'loading';
        loadProfileResource('cabinet', async () => {
            await loadMyCabinetProjection({ keepExistingOnError: true });
            applyCabinetTaskSoundPreferences(myCabinetData?.preferences || {});

            return myCabinetData;
        }).then(() => renderCabinetActiveTab()).catch(error => {
            console.warn('Profile My Day initial projection failed', error);
            renderCabinetActiveTab();
        });
        return;
    }
    await ensureProfileTabData(activeTab);
}

function getProfileResourceState(key) {
    return profileResourceStates.get(key) || { status: 'unloaded', promise: null, value: undefined, error: null };
}

function loadProfileResource(key, loader) {
    const current = getProfileResourceState(key);
    if (current.status === 'loaded') return Promise.resolve(current.value);
    if (current.status === 'loading') return current.promise;

    const promise = Promise.resolve()
        .then(loader)
        .then(value => {
            profileResourceStates.set(key, { status: 'loaded', promise: null, value, error: null });
            return value;
        })
        .catch(error => {
            profileResourceStates.set(key, { status: 'error', promise: null, value: undefined, error });
            throw error;
        });
    profileResourceStates.set(key, { status: 'loading', promise, value: undefined, error: null });
    return promise;
}

async function ensureProfileTabData(tab = activeTab) {
    if (!isOwnProfile || profileTabLock(tab)) return;
    if (isProfileTaskProjectionTab(tab)) {
        await loadProfileResource('cabinet', async () => {
            await loadMyCabinetProjection();
            applyCabinetTaskSoundPreferences(myCabinetData?.preferences || {});

            return myCabinetData;
        });
    }
    if (tab === 'settings') {
        profileSecurityData = await loadProfileResource('security', () => apiGet('/auth/security'));
    }
}

function profileCockpitWidgetDef(id) {
    return PROFILE_COCKPIT_WIDGETS.find(widget => widget.id === id) || null;
}

function normalizeProfileCockpitWidgets(value) {
    const allowed = new Set(PROFILE_COCKPIT_WIDGETS.map(widget => widget.id));
    const source = Array.isArray(value) ? value : [];
    const selected = [];
    source.forEach(id => {
        const key = String(id || '').trim();
        if (allowed.has(key) && !selected.includes(key)) selected.push(key);
    });
    return selected.length ? selected : [...PROFILE_COCKPIT_DEFAULT_WIDGETS];
}

function profileTodayDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function profileFormatShortDate(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function profileShiftValue(shift) {
    if (!shift) return 'Зміна не призначена';
    const day = shift.date ? profileFormatShortDate(shift.date) : 'сьогодні';
    const segments = Array.isArray(shift.segments) ? shift.segments : (Array.isArray(shift.blocks) ? shift.blocks : []);
    const time = segments.length
        ? segments.map(segment => `${segment.start || ''}–${segment.end || ''}${segment.professionKey ? ` ${segment.professionKey}` : ''}`).join('; ')
        : `${shift.start || ''}${shift.end ? ' - ' + shift.end : ''}`.trim();
    return `${day}${time ? ' · ' + time : ''}`;
}

function profileShiftMeta(shift) {
    if (!shift) return 'Сьогодні без зміни';
    return shift.position || shift.department || shift.status || 'графік роботи';
}

function profileOverviewHref(target) {
    if (target === '/') return `/?date=${encodeURIComponent(profileTodayDateString())}`;
    return target || '/profile';
}

function profileOverviewWidgetData(id) {
    const p = profileData || {};
    const tasks = p.tasks || {};
    const day = p.dayProgress || {};
    const activeTasks = Number(tasks.assigned || 0) + Number(tasks.in_progress || 0);
    const overdueCount = Number(tasks.overdue || 0);
    const completedToday = Number(day.tasksDoneToday || 0);
    const remainingToday = Number(day.tasksRemaining || 0);
    const todayTotal = completedToday + remainingToday;
    const completedAch = myAchievements.filter(a => a.completed);
    const totalAch = myAchievements.filter(a => !a.isSecret || a.completed).length;
    const nextShift = p.nextShift || null;
    const streakCurrent = p.streak?.current || p.currentStreak || 0;
    const def = profileCockpitWidgetDef(id);
    if (!def) return null;
    const base = {
        ...def,
        href: profileOverviewHref(def.target),
        tone: '',
        meta: '',
        value: '0',
        hidden: false
    };
    switch (id) {
        case 'active_tasks':
            return {
                ...base,
                value: activeTasks,
                meta: overdueCount > 0 ? `${overdueCount} прострочено` : 'у фокусі',
                tone: overdueCount > 0 ? 'warning' : 'focus'
            };
        case 'today_progress':
            return {
                ...base,
                value: `${completedToday}/${todayTotal || 0}`,
                meta: todayTotal ? 'закрито / всього' : 'задач на сьогодні немає',
                tone: todayTotal > 0 && completedToday >= todayTotal ? 'ok' : 'focus'
            };
        case 'next_shift':
            return {
                ...base,
                value: profileShiftValue(nextShift),
                meta: profileShiftMeta(nextShift),
                tone: nextShift ? 'schedule' : 'muted'
            };
        case 'attention':
            return {
                ...base,
                value: overdueCount,
                meta: overdueCount > 0 ? 'відкрити борги' : 'немає прострочених',
                tone: overdueCount > 0 ? 'danger' : 'ok',
                hidden: overdueCount <= 0
            };
        case 'bookings_today':
            return {
                ...base,
                value: Number(day.bookingsToday || 0),
                meta: 'timeline сьогодні',
                tone: 'business'
            };
        case 'certificates':
            return {
                ...base,
                value: Number(p.certificates?.total || 0),
                meta: 'видано від вашого імені',
                tone: 'business'
            };
        case 'achievements':
            return {
                ...base,
                value: `${completedAch.length}/${totalAch || 0}`,
                meta: streakCurrent ? `${streakCurrent} днів streak` : 'прогрес і нагороди',
                tone: 'growth'
            };
        default:
            return base;
    }
}

function profileVisibleCockpitWidgets(options = {}) {
    const limit = Number(options.limit || 0);
    const selected = normalizeProfileCockpitWidgets(profileWidgetConfig);
    const widgets = selected
        .map(profileOverviewWidgetData)
        .filter(Boolean)
        .filter(widget => !widget.hidden);
    const fallback = PROFILE_COCKPIT_DEFAULT_WIDGETS.map(profileOverviewWidgetData).filter(Boolean).filter(widget => !widget.hidden);
    const usable = widgets.length ? widgets : (fallback.length ? fallback : [profileOverviewWidgetData('active_tasks')].filter(Boolean));
    return limit > 0 ? usable.slice(0, limit) : usable;
}

function renderProfileCockpitWidget(widget, context = 'overview') {
    const hint = widget.hint || '';
    const classes = ['profile-cockpit-widget', `profile-cockpit-widget--${widget.group}`, `profile-cockpit-widget--${widget.tone || 'neutral'}`].join(' ');
    return `
        <article class="${classes}" role="link" tabindex="0" data-profile-widget-target="${escapeHtml(widget.href)}" data-profile-widget-id="${escapeHtml(widget.id)}" data-profile-widget-context="${escapeHtml(context)}" aria-label="${escapeHtml(`${widget.label}: ${widget.value}. ${hint}`)}">
            <div class="profile-cockpit-widget-top">
                <span class="profile-cockpit-widget-icon">${escapeHtml(widget.icon || '•')}</span>
                <span class="profile-cockpit-widget-label">${escapeHtml(widget.label)}</span>
                <button type="button" class="profile-cockpit-widget-info" data-profile-tooltip-toggle aria-expanded="false" aria-label="Пояснення віджета">i</button>
            </div>
            <b>${escapeHtml(widget.value)}</b>
            <small>${escapeHtml(widget.meta || '')}</small>
            <span class="profile-cockpit-tooltip" role="tooltip">${escapeHtml(hint)} ${widget.href ? 'Перехід: ' + escapeHtml(widget.href) : ''}</span>
        </article>`;
}

function renderProfileCockpitWidgetStrip(options = {}) {
    const context = options.context || 'overview';
    const widgets = profileVisibleCockpitWidgets({ limit: options.limit || 0 });
    return `
        <div class="profile-cockpit-strip profile-cockpit-strip--${escapeHtml(context)}" data-profile-cockpit-strip="${escapeHtml(context)}">
            ${widgets.map(widget => renderProfileCockpitWidget(widget, context)).join('')}
        </div>`;
}

function renderProfileWidgetSettingsPanel() {
    if (!isOwnProfile) return '';
    const selected = normalizeProfileCockpitWidgets(profileWidgetConfig);
    const selectedSet = new Set(selected);
    const sorted = [
        ...selected.map(profileCockpitWidgetDef).filter(Boolean),
        ...PROFILE_COCKPIT_WIDGETS.filter(widget => !selectedSet.has(widget.id))
    ];
    const body = sorted.map((widget, index) => {
        const checked = selectedSet.has(widget.id);
        return `
            <div class="profile-widget-config-item ${checked ? 'is-active' : ''}" data-profile-widget-config-item data-widget-id="${escapeHtml(widget.id)}">
                <label>
                    <input type="checkbox" ${checked ? 'checked' : ''} data-profile-widget-config-check>
                    <span>
                        <b>${escapeHtml(widget.label)}</b>
                        <small>${escapeHtml(widget.hint)}</small>
                    </span>
                </label>
                <div class="profile-widget-config-actions">
                    <button type="button" data-profile-widget-move="up" ${index === 0 ? 'disabled' : ''} aria-label="Підняти">↑</button>
                    <button type="button" data-profile-widget-move="down" ${index === sorted.length - 1 ? 'disabled' : ''} aria-label="Опустити">↓</button>
                </div>
            </div>`;
    }).join('');
    return `
        <section class="profile-widget-config-panel ${profileWidgetSettingsOpen ? 'is-open' : ''}" id="profileWidgetConfigPanel" ${profileWidgetSettingsOpen ? '' : 'hidden'}>
            <div class="profile-widget-config-head">
                <div>
                    <span class="profile-kicker">Налаштування cockpit</span>
                    <h3>Віджети огляду</h3>
                    <p>Увімкніть потрібні картки й підніміть найважливіші вгору. Порядок збережеться у вашому профілі.</p>
                </div>
                <button type="button" data-profile-widget-config-reset>Скинути</button>
            </div>
            <div class="profile-widget-config-list">${body}</div>
            <div class="profile-widget-config-footer">
                <button type="button" class="profile-widget-config-save" data-profile-widget-config-save>Зберегти набір</button>
            </div>
        </section>`;
}

function renderProfileProfessionHeaderPanel(entries = profileProfessionEntries()) {
    const primary = entries.find(entry => entry.primary) || profileProfessionEntry('default');
    const secondary = entries.filter(entry => !entry.primary);
    return `
        <div class="profile-profession-header-panel">
            <div class="profile-profession-header-main" style="--profession-color:${escapeHtml(primary.color)}">
                <span class="profile-kicker">Основна професія</span>
                <h2>${escapeHtml(primary.title)}</h2>
                <p>${escapeHtml(primary.shortInfo || 'Професійний контекст буде показано після заповнення HR каталогу.')}</p>
            </div>
            <div class="profile-profession-header-stack">
                <div class="profile-profession-header-stack-title">
                    <span class="profile-kicker">Додаткові ролі</span>
                    <strong>${secondary.length || 'немає'}</strong>
                </div>
                ${secondary.length
                    ? secondary.map(item => `
                        <div class="profile-profession-header-chip" style="--profession-color:${escapeHtml(item.color)}">
                            <b>${escapeHtml(item.title)}</b>
                            <span>${escapeHtml(item.department || item.key)}</span>
                        </div>
                    `).join('')
                    : '<div class="profile-profession-header-empty">Додаткові професії ще не призначені</div>'}
            </div>
        </div>`;
}

function renderProfileProfessionSwitcher(entries = profileProfessionEntries()) {
    if (!entries.length) return '';
    const active = profileActiveProfessionEntry();
    return `
        <div class="profile-work-hub-context" aria-label="Перегляд професій профілю">
            <div class="profile-work-hub-context-copy">
                <span class="profile-kicker">Обрана професія</span>
                <strong>${escapeHtml(active.title)}</strong>
                <small>${escapeHtml(active.department || active.shortInfo || 'Професійний контекст')}</small>
            </div>
            <div class="profile-profession-switcher" role="group" aria-label="Перемикач професій">
                ${entries.map(entry => `
                    <button type="button"
                        class="profile-profession-switch ${entry.key === active.key ? 'active' : ''}"
                        style="--profession-color:${escapeHtml(entry.color)}"
                        data-profile-profession="${escapeHtml(entry.key)}"
                        onclick="setProfileProfessionContext('${escapeHtml(entry.key)}')"
                        aria-pressed="${entry.key === active.key ? 'true' : 'false'}">
                        <span>${entry.primary ? 'Основна' : 'Додаткова'}</span>
                        <b>${escapeHtml(entry.title)}</b>
                    </button>
                `).join('')}
            </div>
        </div>`;
}

function renderProfileWorkHubTabs(entries = profileProfessionEntries()) {
    const active = profileActiveProfessionEntry();
    const coreCount = profileWorkHubTabOrder().filter(tab => tab.core).length;
    return `
        <nav class="profile-work-access-menu" aria-label="Основний робочий доступ профілю">
            <div class="profile-work-access-head">
                <div>
                    <span class="profile-kicker">Робочий hub</span>
                    <strong>${escapeHtml(active.title)}</strong>
                    <small>${escapeHtml(entries.length > 1 ? `${entries.length} професії в профілі` : 'одна активна професія')}</small>
                </div>
                <span>${coreCount} основні входи</span>
            </div>
            <div class="profile-primary-tabs profile-work-tabs profile-work-access-tabs" role="tablist" aria-label="Професії, чеклісти, матеріали та особиста робота">
                ${profileWorkHubTabOrder().map(renderProfileWorkAccessTab).join('')}
            </div>
        </nav>`;
}

function renderProfileSecondaryTabs() {
    if (!isOwnProfile) return '';
    const controlCount = profileControlCount();
    const tabs = [
        ['myday', 'Мій день'], ['control', 'На контролі'], ['results', PROFILE_EMPLOYEE_TABS.results],
        ['salary', PROFILE_EMPLOYEE_TABS.salary], ['workbase', 'Робоча база'], ['settings', 'Налаштування']
    ];
    return `
        <nav class="profile-secondary-work-menu profile-park-nav" aria-label="Розділи профілю">
            <div class="profile-secondary-tabs">
                ${tabs.map(([id, label]) => id === 'control'
                    ? `<a class="profile-primary-tab${activeTab === id ? ' active' : ''}" data-profile-tab="control" data-profile-control-link href="/profile?tab=control"${activeTab === id ? ' aria-current="page"' : ''}>На контролі <span data-profile-control-count${controlCount == null ? ' hidden' : ''}>${escapeHtml(controlCount ?? '')}</span> ${renderProfileControlNewBadge({ announce: true })}</a>`
                    : renderProfilePrimaryTab(id, label)).join('')}
            </div>
        </nav>`;
}

function closeProfileSoonMenu() {
    document.querySelectorAll('[data-profile-soon-menu]').forEach(menu => {
        menu.classList.remove('is-open');
        const panel = menu.querySelector('[data-profile-soon-panel-menu]');
        const trigger = menu.querySelector('[data-profile-soon-trigger]');
        if (panel) panel.hidden = true;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
}

function toggleProfileSoonMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const trigger = event?.currentTarget;
    const menu = trigger?.closest?.('[data-profile-soon-menu]');
    if (!menu) return;
    const willOpen = !menu.classList.contains('is-open');
    closeProfileSoonMenu();
    menu.classList.toggle('is-open', willOpen);
    const panel = menu.querySelector('[data-profile-soon-panel-menu]');
    if (panel) panel.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

async function switchProfileSoonTab(tab) {
    closeProfileSoonMenu();
    await switchTab(tab);
}

function renderProfileMyDayCapsule(data = profileData, professionEntries = profileProfessionEntries()) {
    const name = profileDisplayName(data);
    const avatarAttrs = isOwnProfile
        ? ' role="button" tabindex="0" title="Змінити аватар" onclick="switchTab(\'settings\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();switchTab(\'settings\');}"'
        : '';
    return `
        <div class="profile-my-day-capsule" data-profile-my-day-capsule>
            ${renderProfileAvatarVisual(`profile-work-avatar profile-my-day-capsule-avatar${isOwnProfile ? ' profile-avatar-clickable' : ''}`, data, avatarAttrs)}
            <div class="profile-my-day-capsule-copy">
                <h1>Мій день</h1>
                <span>${escapeHtml(name)}</span>
            </div>
        </div>`;
}

// ==========================================
// RENDER
// ==========================================
function renderProfile() {
    if (!profileData) {
        document.getElementById('main-content').innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-500)">Профіль не знайдено</div>';
        return;
    }

    const p = profileData;
    const name = profileDisplayName(p);
    const username = profileUsername(p);
    const role = profileRole(p);
    const roleLabel = profileRoleLabel(role);
    const workingRoleState = profileWorkingRoleState(p);
    const workingRoleLabel = workingRoleState.activeLabel || workingRoleState.workingLabel || roleLabel;
    const professionEntries = profileProfessionEntries();
    const primaryProfession = professionEntries.find(entry => entry.primary);
    const secondaryCount = professionEntries.filter(entry => !entry.primary).length;
    const isMyDayTab = activeTab === 'myday';

    // Active title
    const activeTitleDef = titlesData?.titles?.find(t => t.code === titlesData.activeTitle);
    const titleHtml = activeTitleDef
        ? `<span class="title-badge rarity-${activeTitleDef.rarity}">${activeTitleDef.icon} ${escapeHtml(activeTitleDef.name)}</span>`
        : '';

    let html = `
    <div class="profile-page profile-work-mode">
        <div class="profile-page-head">
            <a href="/">\u2190 Назад до CRM</a>
        </div>

        <div class="profile-header profile-work-header profile-friendly-shell${isOwnProfile ? ' profile-work-header--own' : ''}${isMyDayTab ? ' profile-work-header--myday' : ''}">
            ${isMyDayTab ? renderProfileMyDayCapsule(p, professionEntries) : `
                <div class="profile-identity-block">
                    ${isOwnProfile
                        ? renderProfileAvatarVisual('profile-work-avatar profile-avatar-clickable', p, ' role="button" tabindex="0" title="Змінити аватар" onclick="switchTab(\'settings\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();switchTab(\'settings\');}"')
                        : renderProfileAvatarVisual('profile-work-avatar', p)}
                    <div class="profile-identity-copy">
                        <div class="profile-identity-title-row">
                            <div>
                                <h1>${escapeHtml(name)}</h1>
                            </div>
                            ${titleHtml ? `<div class="profile-title-row">${titleHtml}</div>` : ''}
                        </div>
                        <div class="profile-working-role-wrap">
                            <div class="profile-role-line profile-role-line--primary">
                                ${!isOwnProfile && primaryProfession ? `<span class="profile-role-pill profile-role-pill--profession">${escapeHtml(primaryProfession.title)}</span>` : ''}
                                ${isOwnProfile ? `<button type="button" id="profileWorkingRoleTrigger" class="profile-working-role-trigger" aria-expanded="false" aria-controls="profileWorkingRolePanel">
                                    <small>Робоча роль</small>
                                    <b>${escapeHtml(workingRoleLabel)}</b>
                                </button>` : `<span class="profile-role-pill">Доступ: ${escapeHtml(roleLabel)}</span>`}
                            </div>
                            ${isOwnProfile ? renderProfileWorkingRoleControl(workingRoleState) : ''}
                        </div>
                        <div class="profile-identity-meta-row">
                            ${secondaryCount ? `<span>Додаткових професій: ${secondaryCount}</span>` : ''}
                            ${username ? `<span>@${escapeHtml(username)}</span>` : '<span>username не вказано</span>'}
                            <span class="${p.user?.telegramConnected ? 'is-ok' : ''}">${p.user?.telegramConnected ? 'Telegram-сповіщення підключено' : 'Telegram-сповіщення не підключено'}</span>
                            ${isOwnProfile ? '<a href="/profile?tab=settings#telegram-crm">Telegram для задач CRM</a>' : ''}
                        </div>
                        ${p.user?.bio || p.bio ? `<div class="profile-bio">${escapeHtml(p.user?.bio || p.bio)}</div>` : ''}
                    </div>
                </div>

                ${isOwnProfile ? '' : renderProfileProfessionHeaderPanel(professionEntries)}
            `}
        </div>

          ${isOwnProfile ? `<details class="profile-work-panel profile-work-access" id="profileWorkAccess">
              <summary>Робочий доступ</summary>
              <p id="profileWorkAccessHint">Перевірте, чи доступні ваші задачі, графік, чат, афіша та навчання в Парку.</p>
              <button type="button" class="btn btn-secondary" id="profileWorkAccessCheck" aria-describedby="profileWorkAccessHint">Перевірити робочий доступ</button>
              <progress id="profileWorkAccessProgress" aria-label="Перевірка робочого доступу" hidden></progress>
              <p id="profileWorkAccessStatus" role="status"></p>
              <ul id="profileWorkAccessResults" hidden></ul>
          </details>` : ''}
          <section class="profile-work-hub ${isMyDayTab ? 'profile-work-hub--myday' : ''}" aria-label="Робочий доступ профілю">
            ${isOwnProfile ? '' : renderProfileProfessionSwitcher(professionEntries)}
            ${renderProfileSecondaryTabs()}
        </section>

        <div id="tabContent">
            ${renderTabContent()}
        </div>
    </div>`;

    document.getElementById('main-content').innerHTML = html;
    attachProfileListeners();
}

async function switchTab(tab, options = {}) {
    tab = normalizeProfileTab(tab);
    if ((tab === 'control' || Object.hasOwn(PROFILE_EMPLOYEE_TABS, tab)) && !isOwnProfile) tab = 'professions';
    const taskDialog = document.querySelector('.park-task-dialog[open]');
    if (tab !== 'myday' && taskDialog?.canLeave && !taskDialog.canLeave()) {
        if (options.skipUrl) {
            window.history.pushState({ ...window.history.state, myDayTask: Number(taskDialog.dataset.myDayTask) }, '', taskDialog.taskLocation);
        }
        return false;
    }
    const requestSeq = ++profileTabRequestSeq;
    activeTab = tab;
    if (tab !== 'myday') {
        myDayLinkedDate = null;
        document.querySelector('.park-task-dialog[open]')?.close();
    }
    if (!options.skipUrl) syncProfileTabToUrl(tab, { hash: '' });
    else applyProfilePeriodFromUrl();
    const locked = profileTabLock(tab);
    if (!locked && isProfileTaskProjectionTab(tab)) {
        if (!myCabinetData) myCabinetLoadState = 'loading';
        const tabContent = document.getElementById('tabContent');
        if (tabContent) {
            tabContent.innerHTML = renderTabContent();
            attachProfileListeners();
        }
    }
    if (!locked) await ensureProfileTabData(tab);
    if (requestSeq !== profileTabRequestSeq || activeTab !== tab) return false;
    if (!locked && tab === 'materials') await loadProfileWorkMaterials(profileActiveProfessionEntry().key);
    if (requestSeq !== profileTabRequestSeq || activeTab !== tab) return false;

    const tabContent = document.getElementById('tabContent');
    if (tabContent) {
        tabContent.innerHTML = renderTabContent();
        attachProfileListeners();
    }
    // Update tab buttons
    document.querySelectorAll('.profile-primary-tab, .profile-work-access-tab').forEach(btn => {
        const tabName = btn.dataset.profileTab || btn.getAttribute('onclick')?.match(/switchTab\('(\w+)'\)/)?.[1];
        const isActive = tabName === tab;
        btn.classList.toggle('active', isActive);
        if (btn.getAttribute('role') === 'tab') btn.setAttribute('aria-selected', String(isActive));
        if (isActive) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
    if (tab === 'workbase') {
        void loadProfileWorkMaterials();
        focusProfileWorkBaseSection();
    }
    if (Object.hasOwn(PROFILE_EMPLOYEE_TABS, tab)) void loadProfileEmployeeMonth(tab);
    if (tab === 'control') {
        void loadProfileControlTasks();
        void window.loadAlertBell?.();
    }
    return true;
}

async function setProfileProfessionContext(key) {
    const normalized = normalizeProfileProfessionKey(key);
    if (!profileProfessionKeys().includes(normalized)) return;
    const focused = document.activeElement;
    const selector = focused?.classList.contains('profile-inline-switch')
        ? '.profile-inline-switch' : '.profile-profession-switch';
    const restoreFocus = focused?.dataset.profileProfession === normalized;
    const tab = activeTab;
    activeProfessionKey = normalized;
    if (tab === 'workbase') {
        const panel = document.getElementById('tabContent');
        if (panel) panel.innerHTML = renderProfileWorkBase();
        if (restoreFocus) panel?.querySelector(`[data-profile-profession="${normalized}"]`)?.focus();
        void loadProfileWorkMaterials(normalized);
        return;
    }
    if (activeTab === 'materials') {
        const tabContent = document.getElementById('tabContent');
        if (tabContent) tabContent.innerHTML = renderProfileMaterialsTab();
        await loadProfileWorkMaterials(normalized);
    }
    if (tab !== activeTab || normalized !== activeProfessionKey) return;
    renderProfile();
    if (restoreFocus) document.querySelector(`${selector}[data-profile-profession="${normalized}"]`)?.focus();
}

function renderTabContent() {
    const locked = profileTabLock(activeTab);
    if (locked) return renderProfileComingSoon(activeTab);
    switch (activeTab) {
        case 'workbase': return isOwnProfile ? renderProfileWorkBase() : renderProfileProfessionsTab();
        case 'profile':
        case 'professions': return renderProfileProfessionsTab();
        case 'checklists': return renderProfileChecklistsTab();
        case 'materials': return renderProfileMaterialsTab();
        case 'salary':
        case 'results': return isOwnProfile ? renderProfileEmployeeMonth(activeTab) : '';
        case 'myday': return renderMyDayTab();
        case 'mytasks': return renderMyDayTab();
        case 'control': return isOwnProfile ? renderProfileControlTasks() : '';
        case 'settings': return renderProfileSettingsTab();









        default: return renderProfileProfessionsTab();
    }
}

function profileEmployeeSelectedMonth() {
    const month = new URLSearchParams(window.location.search).get('month');
    return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(month || '') ? month
        : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date()).slice(0, 7);
}

let profileEmployeeRenderers;
let profileEmployeeRenderersPromise;
const profilePageScript = typeof document === 'undefined' ? null : document.currentScript;
const profileAssetQuery = profilePageScript?.src ? new URL(profilePageScript.src).search : '';

async function ensureProfileEmployeeRenderers() {
    if (profileEmployeeRenderers) return profileEmployeeRenderers;
    profileEmployeeRenderersPromise ||= import(`/js/profile-employee-views.js${profileAssetQuery}`).then(({ createEmployeeRenderers }) =>
        createEmployeeRenderers({ escapeHtml, profileEmployeeDateText, profileEmployeeTime, profileEmployeeMoney,
            profileEmployeeNumber, profileProfessionByKey, profileRoleLabel })).catch(error => {
        profileEmployeeRenderersPromise = null;
        throw error;
    });
    profileEmployeeRenderers = await profileEmployeeRenderersPromise;
    return profileEmployeeRenderers;
}

async function loadProfileEmployeeMonth(tab, month = profileEmployeeSelectedMonth()) {
    if (!isOwnProfile || activeTab !== tab || !Object.hasOwn(PROFILE_EMPLOYEE_TABS, tab)) return;
    if (!/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) return;
    if (month !== profileEmployeeSelectedMonth()) {
        const url = new URL(window.location.href);
        url.searchParams.set('month', month);
        window.history.pushState({ profileTab: tab }, '', url);
    }
    const state = { month, loading: true };
    profileEmployeeMonthState[tab] = state;
    const update = () => {
        if (activeTab !== tab || profileEmployeeMonthState[tab] !== state) return;
        const body = document.getElementById('profileEmployeeMonthBody');
        const monthSelect = document.getElementById('profileEmployeeMonthSelect');
        const yearSelect = document.getElementById('profileEmployeeYearSelect');
        if (monthSelect && yearSelect) {
            [yearSelect.value, monthSelect.value] = month.split('-');
            document.getElementById('profileEmployeePrevMonth').disabled = month === '1900-01';
            document.getElementById('profileEmployeeNextMonth').disabled = month === '2099-12';
        }
        if (!body) return;
        const restoreFocus = body.contains(document.activeElement);
        body.setAttribute('aria-busy', String(state.loading));
        body.innerHTML = renderProfileEmployeeMonthBody(tab, state);
        if (restoreFocus) (body.querySelector('button') || monthSelect)?.focus();
    };
    update();
    try {
        const [data] = await Promise.all([
            apiGetScoped(`/auth/profile/me/${tab}?month=${encodeURIComponent(month)}`),
            ensureProfileEmployeeRenderers()
        ]);
        state.data = data?.month === month ? data : null;
    } catch {
        state.data = null;
    }
    state.loading = false;
    update();
}

const profileMonthLabelFormat = new Intl.DateTimeFormat('uk-UA', { month: 'long', timeZone: 'UTC' });
const profileMonthOptions = Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1).padStart(2, '0'),
    label: profileMonthLabelFormat.format(new Date(Date.UTC(2000, index, 1)))
}));

function changeProfileEmployeeMonth(tab) {
    const year = document.getElementById('profileEmployeeYearSelect').value;
    const month = document.getElementById('profileEmployeeMonthSelect').value;
    return loadProfileEmployeeMonth(tab, `${year}-${month}`);
}

function stepProfileEmployeeMonth(tab, delta) {
    const [year, month] = profileEmployeeSelectedMonth().split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    return loadProfileEmployeeMonth(tab, date.toISOString().slice(0, 7));
}

function renderProfileEmployeeMonth(tab) {
    const month = profileEmployeeSelectedMonth();
    const current = profileEmployeeMonthState[tab];
    const state = current?.month === month ? current : { loading: true };
    const [selectedYear, selectedMonth] = month.split('-');
    const years = Array.from({ length: 200 }, (_, index) => String(2099 - index));
    return `
        <section class="profile-work-panel profile-employee-month" aria-labelledby="profileEmployeeMonthTitle">
            <div class="profile-panel-head">
                <h2 id="profileEmployeeMonthTitle">${PROFILE_EMPLOYEE_TABS[tab]}</h2>
                <div class="profile-month-picker" role="group" aria-label="Період">
                    <button type="button" aria-label="Попередній місяць" id="profileEmployeePrevMonth"
                        onclick="stepProfileEmployeeMonth('${tab}', -1)"${month === '1900-01' ? ' disabled' : ''}>‹</button>
                    <div class="profile-month-field">
                        <label for="profileEmployeeMonthSelect">Місяць</label>
                        <select id="profileEmployeeMonthSelect" onchange="changeProfileEmployeeMonth('${tab}')">
                            ${profileMonthOptions.map(({ value, label }) => `<option value="${value}"${value === selectedMonth ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="profile-month-field">
                        <label for="profileEmployeeYearSelect">Рік</label>
                        <select id="profileEmployeeYearSelect" onchange="changeProfileEmployeeMonth('${tab}')">
                            ${years.map(year => `<option${year === selectedYear ? ' selected' : ''}>${year}</option>`).join('')}
                        </select>
                    </div>
                    <button type="button" aria-label="Наступний місяць" id="profileEmployeeNextMonth"
                        onclick="stepProfileEmployeeMonth('${tab}', 1)"${month === '2099-12' ? ' disabled' : ''}>›</button>
                </div>
            </div>
            <div id="profileEmployeeMonthBody" aria-busy="${state.loading}">
                ${renderProfileEmployeeMonthBody(tab, state)}
            </div>
        </section>`;
}

function renderProfileEmployeeMonthBody(tab, state) {
    if (state.loading) return '<p role="status">Завантаження…</p>';
    if (!state.data) return `<div class="profile-month-message">
        <p role="alert">Не вдалося завантажити дані за цей місяць.</p>
        <button type="button" class="profile-inline-switch" onclick="loadProfileEmployeeMonth('${tab}')">Спробувати ще раз</button>
    </div>`;
    if (state.data.state === 'unavailable') return '<p role="status">Дані працівника недоступні в цьому кабінеті.</p>';
    return tab === 'salary' ? profileEmployeeRenderers.renderSalary(state.data) : profileEmployeeRenderers.renderResults(state.data);
}

const profileSalaryFormat = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' });
const profileResultNumber = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
const profileEmployeeDate = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short' });
const profileEmployeeTime = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', timeStyle: 'short' });

function profileEmployeeDateText(date, format = profileEmployeeDate) {
    if (!date || !Number.isFinite(Date.parse(date))) return '—';
    return format.format(new Date(date));
}

function profileEmployeeMoney(value) {
    return value == null || !Number.isFinite(Number(value)) ? 'Немає даних' : profileSalaryFormat.format(value);
}

function profileEmployeeNumber(value) {
    return value == null ? '—' : profileResultNumber.format(value);
}

function renderProfileProfessionFallbackChecklist(items = []) {
    return `
        <div class="profile-profession-checklist-fallback">
            ${items.map(item => `
                <div class="profile-profession-check-item">
                    <span></span>
                    <b>${escapeHtml(item)}</b>
                </div>
            `).join('')}
        </div>`;
}

function renderProfileProfessionChecklist() {
    return renderProfileChecklistItemsForProfession();
}

function renderProfileChecklistItemsForProfession(entry = profileActiveProfessionEntry()) {
    const items = Array.isArray(entry.checklist) ? entry.checklist : [];
    if (!items.length) {
        return `
            <div class="profile-empty-professional">
                Чекліст для професії "${escapeHtml(entry.title)}" ще не доданий в HR каталозі.
            </div>`;
    }
    return renderProfileProfessionFallbackChecklist(items);
}

function renderProfileChecklistsTab() {
    const active = profileActiveProfessionEntry();
    return `
        <div class="profile-professions-hub profile-work-hub-grid">
            <section class="profile-work-panel profile-work-panel-primary profile-role-focus-panel" style="--profession-color:${escapeHtml(active.color)}">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Шаблон чекліста обраної професії</span>
                        <h2>${escapeHtml(active.title)}</h2>
                    </div>
                    <span>${escapeHtml(active.department || active.key)}</span>
                </div>
                <p>${escapeHtml(active.shortInfo || 'HR опис професії ще не заповнений.')}</p>
                ${renderProfileChecklistItemsForProfession(active)}
            </section>
            <section class="profile-work-panel profile-work-panel-wide">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Усі професійні чеклісти</span>
                        <h2>Швидкий доступ</h2>
                    </div>
                    ${profileCanAccessHr('hr.staff.view') ? '<a href="/hr?tab=checklists">HR чеклісти</a>' : ''}
                </div>
                <div class="profile-profession-roster">
                    ${profileProfessionEntries().map(entry => `
                        <article class="profile-profession-card ${entry.primary ? 'is-primary' : ''}" style="--profession-color:${escapeHtml(entry.color)}">
                            <div class="profile-profession-card-head">
                                <span>${entry.primary ? 'Основна' : 'Додаткова'}</span>
                                <button type="button" class="profile-inline-switch" data-profile-profession="${escapeHtml(entry.key)}" aria-pressed="${entry.key === active.key}" onclick="setProfileProfessionContext('${escapeHtml(entry.key)}')">Відкрити</button>
                            </div>
                            <h3>${escapeHtml(entry.title)}</h3>
                            ${renderProfileChecklistItemsForProfession(entry)}
                        </article>
                    `).join('')}
                </div>
            </section>
        </div>`;
}

function profileMaterialMatchesProfession(item, entry) {
    if (!item || !entry) return false;
    const haystack = [
        item.role,
        item.category,
        item.title,
        item.summary,
        item.content,
        item.description
    ].map(value => String(value || '').toLowerCase()).join(' ');
    const keys = [
        entry.key,
        entry.title,
        entry.department,
        profileTrainingRoleKey(entry.key)
    ].map(value => String(value || '').toLowerCase()).filter(Boolean);
    return keys.some(key => haystack.includes(key));
}

function profileNormalizeMaterialDate(value) {
    if (!value) return '';
    try {
        return new Date(value).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch {
        return '';
    }
}

async function loadProfileWorkMaterials(key = profileActiveProfessionEntry().key, options = {}) {
    const normalized = normalizeProfileProfessionKey(key) || profileActiveProfessionEntry().key;
    if (normalized === 'default') return;
    if (!options.force && profileMaterialsState.loaded && profileMaterialsState.key === normalized) return profileMaterialsState;
    profileMaterialsState = {
        key: normalized,
        loading: true,
        loaded: false,
        articles: [],
        materials: [],
        error: ''
    };
    const pending = profileMaterialsState;
    const tabContent = document.getElementById('tabContent');
    if (activeTab === 'materials' && tabContent) tabContent.innerHTML = renderProfileMaterialsTab();
    const workBaseMaterials = document.querySelector('[data-work-base-materials]');
    if (activeTab === 'workbase' && workBaseMaterials) workBaseMaterials.innerHTML = renderProfileWorkBaseMaterials();
    try {
        const trainingRole = encodeURIComponent(profileTrainingRoleKey(normalized));
        const [knowledgeBase, legacyMaterials] = await Promise.all([
            apiGet(`/training/knowledge-base?role=${trainingRole}`),
            apiGet('/training/materials?page=1&limit=30')
        ]);
        if (profileMaterialsState !== pending) return;
        const entry = profileProfessionEntry(normalized, { primary: normalized === profilePrimaryProfessionKey() });
        const articles = Array.isArray(knowledgeBase?.articles) ? knowledgeBase.articles : [];
        const allMaterials = Array.isArray(legacyMaterials?.materials) ? legacyMaterials.materials : [];
        const relevantMaterials = allMaterials
            .filter(item => profileMaterialMatchesProfession(item, entry))
            .slice(0, 8);
        profileMaterialsState = {
            key: normalized,
            loading: false,
            loaded: true,
            articles,
            materials: relevantMaterials,
            error: ''
        };
    } catch (error) {
        if (profileMaterialsState !== pending) return;
        console.warn('Profile materials load failed', error);
        profileMaterialsState = {
            key: normalized,
            loading: false,
            loaded: true,
            articles: [],
            materials: [],
            error: 'Не вдалося завантажити матеріали. Спробуйте оновити сторінку.'
        };
    }
    if (activeTab === 'materials') {
        const currentTabContent = document.getElementById('tabContent');
        if (currentTabContent) {
            currentTabContent.innerHTML = renderProfileMaterialsTab();
            attachProfileListeners();
        }
    }
    if (activeTab === 'workbase' && workBaseMaterials?.isConnected) {
        workBaseMaterials.innerHTML = renderProfileWorkBaseMaterials();
    } else if (activeTab === 'workbase') {
        const currentMaterials = document.querySelector('[data-work-base-materials]');
        if (currentMaterials) currentMaterials.innerHTML = renderProfileWorkBaseMaterials();
    }
    return profileMaterialsState;
}

function renderProfileMaterialArticleCard(article) {
    const href = `/training?article=${encodeURIComponent(article.id || '')}`;
    const read = Boolean(article.user_completed_at || article.userCompletedAt);
    return `
        <a class="profile-material-card ${read ? 'is-read' : ''}" href="${href}">
            <span>${escapeHtml(article.icon || '📄')}</span>
            <b>${escapeHtml(article.title || 'Матеріал без назви')}</b>
            <small>${escapeHtml(article.summary || article.category || 'Training knowledge base')}</small>
            <em>${escapeHtml(article.difficulty || 'base')} · ${escapeHtml(String(article.read_time_minutes || 5))} хв${read ? ' · прочитано' : ''}</em>
        </a>`;
}

function renderProfileLegacyMaterialCard(material) {
    return `
        <article class="profile-material-card">
            <span>📎</span>
            <b>${escapeHtml(material.title || 'Матеріал')}</b>
            <small>${escapeHtml(material.content || material.category || '').slice(0, 180)}</small>
            <em>${escapeHtml(material.category || 'training')} ${profileNormalizeMaterialDate(material.created_at || material.createdAt)}</em>
        </article>`;
}

function renderProfileMaterialsTab() {
    const active = profileActiveProfessionEntry();
    if (active.key === 'default') return '<p class="profile-empty-professional">Матеріали з’являться після призначення професії.</p>';
    const state = profileMaterialsState.key === active.key ? profileMaterialsState : {
        loading: false,
        loaded: false,
        articles: [],
        materials: [],
        error: ''
    };
    const articles = state.articles || [];
    const materials = state.materials || [];
    return `
        <div class="profile-professions-hub profile-materials-hub">
            <section class="profile-work-panel profile-work-panel-primary profile-role-focus-panel" style="--profession-color:${escapeHtml(active.color)}">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Матеріали активної професії</span>
                        <h2>${escapeHtml(active.title)}</h2>
                    </div>
                    <a href="/training">Навчання</a>
                </div>
                <p>${escapeHtml(active.shortInfo || 'Опис професії буде показано після заповнення HR каталогу.')}</p>
                ${renderProfileProfessionResponsibilities((active.responsibilities || []).slice(0, 6))}
            </section>
            <section class="profile-work-panel profile-work-panel-tasks">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Джерела</span>
                        <h2>Що показуємо</h2>
                    </div>
                    <button type="button" class="profile-inline-switch" onclick="loadProfileWorkMaterials('${escapeHtml(active.key)}', { force: true })">Оновити</button>
                </div>
                <div class="profile-profession-signal-grid">
                    <div><b>${articles.length}</b><span>training articles</span></div>
                    <div><b>${materials.length}</b><span>approved materials</span></div>
                    <div><b>${(active.checklist || []).length}</b><span>пункти checklist</span></div>
                </div>
            </section>
            <section class="profile-work-panel profile-work-panel-wide">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Training knowledge base</span>
                        <h2>Матеріали для ${escapeHtml(active.title)}</h2>
                    </div>
                    <span>${state.loading ? 'завантаження' : `${articles.length} матеріалів`}</span>
                </div>
                ${state.loading
                    ? '<div class="profile-empty-professional">Завантажую матеріали для активної професії...</div>'
                    : state.error
                        ? `<div class="profile-empty-professional">${escapeHtml(state.error)}</div>`
                        : articles.length
                            ? `<div class="profile-material-grid">${articles.map(renderProfileMaterialArticleCard).join('')}</div>`
                            : `<div class="profile-empty-professional">Матеріали для професії "${escapeHtml(active.title)}" ще не додані в Training knowledge base.</div>`}
            </section>
            <section class="profile-work-panel profile-work-panel-wide">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Додаткові матеріали</span>
                        <h2>Approved training notes</h2>
                    </div>
                    <a href="/training">Відкрити training</a>
                </div>
                ${materials.length
                    ? `<div class="profile-material-grid">${materials.map(renderProfileLegacyMaterialCard).join('')}</div>`
                    : '<div class="profile-empty-professional">Додаткові approved materials для цієї професії не знайдені. Це чесний empty state, без fake-карток.</div>'}
            </section>
        </div>`;
}

function renderProfileWorkBaseMaterials() {
    const active = profileActiveProfessionEntry();
    if (active.key === 'default') return '<p>Матеріали з’являться після призначення професії.</p>';
    const state = profileMaterialsState.key === active.key ? profileMaterialsState : null;
    if (!state || state.loading) return '<p role="status">Завантажуємо матеріали…</p>';
    if (state.error) {
        return `<p role="status">${escapeHtml(state.error)}</p>
            <button type="button" onclick="loadProfileWorkMaterials(undefined, { force: true })">Спробувати знову</button>`;
    }
    const cards = [...state.articles.map(renderProfileMaterialArticleCard), ...state.materials.map(renderProfileLegacyMaterialCard)];
    return cards.length ? `<div class="profile-material-grid">${cards.join('')}</div>`
        : '<p>Матеріалів для цієї професії поки немає.</p>';
}

function renderProfileWorkBase() {
    const active = profileActiveProfessionEntry();
    const entries = profileProfessionEntries();
    const professions = entries.map(entry => {
        const department = entry.department || (entry.key === 'art_director' ? 'Креатив' : '');
        return `<button type="button" class="profile-work-base-profession" data-profile-profession="${escapeHtml(entry.key)}"
            aria-pressed="${entry.key === active.key}" onclick="setProfileProfessionContext('${escapeHtml(entry.key)}')">
            <strong>${escapeHtml(entry.title)}</strong>
            ${department ? `<small>${escapeHtml(department)}</small>` : ''}
            <span>${entry.primary ? 'Основна' : 'Додаткова'}</span>
        </button>`;
    });
    return `<div class="profile-work-base">
        <section class="profile-work-panel" aria-labelledby="workBaseProfessionsTitle">
            <h2 id="workBaseProfessionsTitle">Доступні професії</h2>
            ${professions.length ? `<div class="profile-work-base-roster" role="group" aria-label="Перемикач професій">${professions.join('')}</div>`
                : '<p>Професії ще не призначено.</p>'}
        </section>
        <section id="work-base-checklists" class="profile-work-panel" tabindex="-1" aria-labelledby="workBaseChecklistsTitle">
            <h2 id="workBaseChecklistsTitle">Чеклісти професій</h2>
            ${entries.length ? renderProfileChecklistItemsForProfession(active) : '<p>Чеклісти з’являться після призначення професії.</p>'}
        </section>
        <section id="work-base-materials" class="profile-work-panel" tabindex="-1" aria-labelledby="workBaseMaterialsTitle">
            <h2 id="workBaseMaterialsTitle">Матеріали</h2>
            <div data-work-base-materials>${renderProfileWorkBaseMaterials()}</div>
        </section>
    </div>`;
}

function renderProfileProfessionResponsibilities(items = []) {
    return `
        <div class="profile-profession-responsibilities">
            ${items.map(item => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>`;
}

function profileCanAccessHr(action) {
    return typeof canAccessPage === 'function' && canAccessPage('/hr')
        && typeof canUseAction === 'function' && canUseAction(action);
}

function renderProfileProfessionCard(entry) {
    const selected = entry.key === ensureActiveProfessionKey();
    const status = { active: 'Активна', inactive: 'Неактивна', suspended: 'Призупинена' };
    const admission = { approved: 'Допущено', pending: 'Очікує допуску', blocked: 'Допуск заблоковано' };
    const internship = { in_progress: 'Стажування триває', completed: 'Стажування завершено' };
    const assignmentLabels = [status[entry.assignment?.status], admission[entry.assignment?.admissionStatus], internship[entry.assignment?.internshipStatus]].filter(Boolean);
    return `
        <article class="profile-profession-card ${entry.primary ? 'is-primary' : ''}" style="--profession-color:${escapeHtml(entry.color)}">
            <div class="profile-profession-card-head">
                <span>${entry.primary ? 'Основна' : 'Додаткова'}</span>
                <button type="button" class="profile-inline-switch" data-profile-profession="${escapeHtml(entry.key)}" aria-pressed="${selected}" onclick="setProfileProfessionContext('${escapeHtml(entry.key)}')">${selected ? 'Обрана' : 'Обрати'}</button>
                ${entry.department ? `<small>${escapeHtml(entry.department)}</small>` : ''}
            </div>
            <h3>${escapeHtml(entry.title)}</h3>
            <p>${escapeHtml(entry.shortInfo || 'Короткий опис ще не заповнено в HR каталозі.')}</p>
            ${assignmentLabels.length ? `<div class="profile-profession-meta">${assignmentLabels.map(label => `<span>${label}</span>`).join('')}</div>` : ''}
            ${renderProfileProfessionResponsibilities((entry.responsibilities || []).slice(0, 4))}
            ${(entry.checklist || []).length ? `
                <div class="profile-profession-card-checklist">
                    ${(entry.checklist || []).slice(0, 3).map(item => `<span>${escapeHtml(item)}</span>`).join('')}
                </div>
            ` : ''}
        </article>`;
}

function renderProfileProfessionsTab() {
    const p = profileData || {};
    const tasks = p.tasks || {};
    const myTasks = Array.isArray(p.myTasks) ? p.myTasks : [];
    const overdue = Array.isArray(tasks.overdueList) ? tasks.overdueList : [];
    const nextShift = p.nextShift || p.todayShift || null;
    const professions = profileProfessionEntries();
    if (!professions.length) return '<p class="profile-empty-professional">Професії ще не призначено. Зверніться до відповідального за команду, якщо очікуєте тут свої професії.</p>';
    const activeProfession = profileActiveProfessionEntry();

    return `
        <div class="profile-professions-hub">
            <section class="profile-work-panel profile-profession-hero">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Обрана професія</span>
                        <h2>${escapeHtml(activeProfession.title)}</h2>
                    </div>
                    ${activeProfession.department ? `<span>${escapeHtml(activeProfession.department)}</span>` : ''}
                </div>
                <p>${escapeHtml(activeProfession.shortInfo)}</p>
                <div class="profile-profession-meta">
                    <span>${activeProfession.primary ? 'Основна професія' : 'Додаткова професія'}</span>
                </div>
                ${renderProfileProfessionResponsibilities(activeProfession.responsibilities)}
            </section>

            <section class="profile-work-panel profile-profession-roster-panel">
                <div class="profile-panel-head">
                    <div>
                        <h2>Призначені професії</h2>
                    </div>
                    ${profileCanAccessHr('hr.staff.manage') ? '<a href="/hr#team">Редагувати в HR</a>' : ''}
                </div>
                <div class="profile-profession-roster">
                    ${professions.map(renderProfileProfessionCard).join('')}
                </div>
            </section>

            <section class="profile-work-panel profile-profession-checklist-panel">
                <div class="profile-panel-head">
                    <div>
                        <h2>Шаблон чекліста професії</h2>
                    </div>
                    <a href="/tasks?view=my">Відкрити задачі</a>
                </div>
                ${renderProfileProfessionChecklist()}
            </section>

            <section class="profile-work-panel profile-profession-ops-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Операційний стан</span>
                        <h2>Мої зміни та задачі</h2>
                    </div>
                    ${nextShift ? '<span>зміна знайдена</span>' : '<span>без зміни</span>'}
                </div>
                <div class="profile-profession-signal-grid">
                    <div>
                        <b>${escapeHtml(profileShiftValue(nextShift))}</b>
                        <span>${escapeHtml(profileShiftMeta(nextShift))}</span>
                    </div>
                    <div>
                        <b>${myTasks.length}</b>
                        <span>активних задач</span>
                    </div>
                    <div class="${overdue.length ? 'is-danger' : ''}">
                        <b>${overdue.length}</b>
                        <span>прострочених</span>
                    </div>
                </div>
            </section>

            <section class="profile-work-panel profile-profession-active-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Робочий список</span>
                        <h2>Найближчі задачі</h2>
                    </div>
                    <span>${myTasks.length}</span>
                </div>
                ${myTasks.length
                    ? `<div class="profile-work-list">${myTasks.slice(0, 5).map(renderProfileTaskRow).join('')}</div>`
                    : '<div class="profile-empty-professional">Активних задач зараз немає.</div>'}
            </section>

            <section class="profile-work-panel profile-profession-links-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Маршрути</span>
                        <h2>Пов'язані місця</h2>
                    </div>
                </div>
                <div class="profile-quick-link-stack">
                    <a href="/profile?tab=myday">Мій день <span>особистий зріз</span></a>
                    <a href="/tasks?view=my">Повний список задач <span>основний модуль Tasks</span></a>
                    ${profileCanAccessHr('hr.schedule.view') ? '<a href="/hr?tab=schedule">Графік <span>зміни й присутність</span></a>' : ''}
                    <a href="/training">Навчання <span>матеріали ролі</span></a>
                </div>
            </section>

        </div>`;
}

function renderProfileSettingsTab() {
    const avatar = profileAvatarData(profileData);
    const identity = profileData?.user || {};
    const currentColor = avatar.color || '#f59e0b';
    const crop = normalizeProfileAvatarCrop(avatar.crop);
    return `
        <div class="profile-settings-shell">
            <section class="profile-work-panel profile-settings-panel profile-settings-account" aria-labelledby="profileAccountHeading">
                <div class="profile-panel-head"><h2 id="profileAccountHeading">Акаунт</h2></div>
                <div class="profile-settings-identity">
                    <dl>
                        <div><dt>Імʼя та прізвище</dt><dd>${escapeHtml(identity.name || 'Не задано')}</dd></div>
                        <div><dt>Логін для входу</dt><dd>${escapeHtml(identity.username || 'Не задано')}</dd></div>
                    </dl>
                </div>
                <section id="telegram-crm" data-telegram-crm-profile aria-labelledby="telegramCrmHeading"></section>
                ${renderProfileSecurityPanel()}
            </section>
            <section class="profile-work-panel profile-settings-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Налаштування профілю</span>
                        <h2>Аватарка</h2>
                    </div>
                </div>
                <div class="profile-avatar-editor">
                    <div>
                        <div id="profileAvatarPreview" class="profile-avatar-preview" style="background:${escapeHtml(currentColor)}">
                            ${avatar.url ? `<img src="${escapeHtml(avatar.url)}" alt="" style="${profileAvatarCropStyle(crop)}">` : escapeHtml(avatar.initial)}
                        </div>
                        <div class="profile-avatar-preview-hint">Так аватарка буде виглядати в меню та профілі</div>
                    </div>
                    <div class="profile-avatar-controls">
                        <input type="hidden" id="profileAvatarColor" value="${escapeHtml(currentColor)}">
                        <div class="profile-avatar-section">
                            <label>Літера замість фото</label>
                            <div class="profile-avatar-color-grid">
                                ${PROFILE_AVATAR_COLORS.map(color => `<button type="button" class="${color.toLowerCase() === currentColor.toLowerCase() ? 'active' : ''}" style="background:${color}" title="${color}" onclick="selectProfileAvatarColor('${color}')"></button>`).join('')}
                            </div>
                            <div class="profile-avatar-action-row">
                                <button type="button" class="profile-settings-primary" onclick="saveProfileAvatar('initials')">Зберегти літеру</button>
                            </div>
                        </div>
                        <div class="profile-avatar-upload-card">
                            <label for="profileAvatarFile">Фото з пристрою</label>
                            <div class="profile-avatar-upload-row">
                                <input id="profileAvatarFile" class="profile-avatar-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onchange="handleProfileAvatarFileChange(this)">
                                <label class="profile-avatar-file-pick" for="profileAvatarFile">
                                    <span>↑</span>
                                    <b id="profileAvatarFileName">Обрати фото</b>
                                    <small id="profileAvatarFileMeta">JPG, PNG, WebP або GIF до 5 МБ</small>
                                </label>
                                <div class="profile-avatar-upload-actions">
                                    <button type="button" id="profileAvatarUploadBtn" class="profile-settings-primary" onclick="uploadProfileAvatarFile()" disabled>Зберегти фото</button>
                                    <button type="button" onclick="clearProfileAvatarFile()">Скинути вибір</button>
                                </div>
                            </div>
                        </div>
                        <div class="profile-avatar-crop-card">
                            <label>Підгонка фото</label>
                            <div class="profile-avatar-crop-grid">
                                <label class="profile-avatar-crop-control" for="profileAvatarZoom">
                                    <span>Масштаб</span>
                                    <input id="profileAvatarZoom" type="range" min="1" max="2" step="0.05" value="${crop.zoom}" oninput="updateProfileAvatarCropFromControls()">
                                </label>
                                <label class="profile-avatar-crop-control" for="profileAvatarPositionX">
                                    <span>Горизонталь</span>
                                    <input id="profileAvatarPositionX" type="range" min="0" max="100" step="1" value="${crop.x}" oninput="updateProfileAvatarCropFromControls()">
                                </label>
                                <label class="profile-avatar-crop-control" for="profileAvatarPositionY">
                                    <span>Вертикаль</span>
                                    <input id="profileAvatarPositionY" type="range" min="0" max="100" step="1" value="${crop.y}" oninput="updateProfileAvatarCropFromControls()">
                                </label>
                            </div>
                            <div class="profile-avatar-crop-actions">
                                <span id="profileAvatarCropValue">${crop.x}/${crop.y} · ${crop.zoom.toFixed(2)}x</span>
                                <button type="button" onclick="resetProfileAvatarCrop()">По центру</button>
                                <button type="button" class="profile-settings-primary" onclick="saveProfileAvatarCrop()">Застосувати</button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>`;
}

function renderProfileSecurityPanel() {
    const security = profileSecurityData || {};
    const user = security.user || profileUser(profileData);
    const rawSessions = Array.isArray(security.sessions) ? security.sessions : [];
    const sessions = normalizeProfileSecuritySessions(rawSessions);
    const events = Array.isArray(security.events) ? [...security.events].sort((a, b) =>
        profileSessionTimeValue(b.created_at || b.createdAt) - profileSessionTimeValue(a.created_at || a.createdAt)) : [];
    const passwordChanged = user.password_changed_at || user.passwordChangedAt;
    const sessionRevokedAt = user.session_revoked_at || user.sessionRevokedAt;
    const lastSeenAt = user.last_seen_at || user.lastSeenAt;
    return `
        <section class="profile-security-panel" aria-labelledby="profileSecurityHeading">
            <div class="profile-panel-head">
                <div>
                    <span class="profile-kicker">Безпека акаунта</span>
                    <h3 id="profileSecurityHeading">Пароль, сесії, журнал</h3>
                </div>
                <span>Активні пристрої: ${sessions.length}</span>
            </div>
            <div class="profile-security-grid">
                ${profileSecurityMetric('Пароль', passwordChanged ? profileFormatTime(passwordChanged) : 'потрібно оновити', passwordChanged ? 'остання зміна' : 'немає зафіксованої зміни', passwordChanged ? 'ok' : 'danger')}
                ${profileSecurityMetric('Остання активність', lastSeenAt ? profileFormatTime(lastSeenAt) : 'немає даних', 'за даними CRM')}
                ${profileSecurityMetric('Скидання сесій', sessionRevokedAt ? profileFormatTime(sessionRevokedAt) : 'не виконувалось', 'остання примусова відвʼязка')}
            </div>
            <div class="profile-security-actions">
                <button type="button" class="profile-settings-primary" onclick="openProfilePasswordModal()">Змінити пароль</button>
                <button type="button" class="profile-security-danger" onclick="revokeProfileSessions()">Вийти з усіх пристроїв</button>
            </div>
            <div class="profile-security-columns">
                <div class="profile-security-card">
                    <div class="profile-security-card-head">
                        <b>Активні пристрої</b>
                        <span>${rawSessions.length > sessions.length ? 'повтори refresh-token згруповано' : 'без зайвих повторів'}</span>
                    </div>
                    ${renderProfileSecurityList(sessions, renderProfileSessionRow, 'пристрої', 'Активних пристроїв не знайдено.')}
                </div>
                <div class="profile-security-card">
                    <div class="profile-security-card-head">
                        <b>Журнал акаунта</b>
                        <span>паролі, ролі, сесії</span>
                    </div>
                    ${renderProfileSecurityList(events, renderProfileSecurityEventRow, 'події', 'Подій безпеки акаунта ще немає.')}
                </div>
            </div>
        </section>`;
}

function renderProfileSecurityList(items, renderRow, label, empty) {
    const limit = 5;
    if (!items.length) return `<p class="profile-security-empty">${empty}</p>`;
    return items.slice(0, limit).map(renderRow).join('') + (items.length > limit ? `
        <details class="profile-security-more">
            <summary><span>Показати ще: ${label} (${items.length - limit})</span><span>Згорнути: ${label}</span></summary>
            ${items.slice(limit).map(renderRow).join('')}
        </details>` : '');
}

function profileSecurityMetric(label, value, hint, tone = '') {
    return `
        <div class="profile-security-metric ${tone}">
            <span>${escapeHtml(label)}</span>
            <b>${escapeHtml(value)}</b>
            <small>${escapeHtml(hint || '')}</small>
        </div>`;
}

function profileSessionTimeValue(value) {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
}

function normalizeProfileSecuritySessions(sessions = []) {
    const grouped = new Map();
    sessions.forEach(session => {
        const label = sessionDeviceLabel(session);
        const ip = session.ip_address || session.ipAddress || 'IP не зафіксовано';
        const key = `${label}|${ip}`;
        const createdAt = session.created_at || session.createdAt || null;
        const expiresAt = session.expires_at || session.expiresAt || null;
        const createdMs = profileSessionTimeValue(createdAt);
        const expiresMs = profileSessionTimeValue(expiresAt);
        const current = grouped.get(key);
        if (!current) {
            grouped.set(key, {
                ...session,
                deviceLabel: label,
                ipAddress: ip,
                tokenCount: 1,
                latestCreatedMs: createdMs,
                latestExpiresMs: expiresMs,
                created_at: createdAt,
                expires_at: expiresAt
            });
            return;
        }
        current.tokenCount += 1;
        if (createdMs >= current.latestCreatedMs) {
            current.latestCreatedMs = createdMs;
            current.created_at = createdAt;
            current.createdAt = createdAt;
        }
        if (expiresMs >= current.latestExpiresMs) {
            current.latestExpiresMs = expiresMs;
            current.expires_at = expiresAt;
            current.expiresAt = expiresAt;
        }
    });
    return Array.from(grouped.values())
        .sort((a, b) => (b.latestCreatedMs || 0) - (a.latestCreatedMs || 0));
}

function sessionDeviceLabel(session) {
    const device = String(session.device_info || session.deviceInfo || '').trim();
    if (!device) return 'Невідомий пристрій';
    if (/iPhone|iPad|Android/i.test(device)) return 'Мобільний браузер';
    if (/Windows/i.test(device)) return 'Windows браузер';
    if (/Mac OS|Macintosh/i.test(device)) return 'Mac браузер';
    return device.slice(0, 80);
}

function renderProfileSessionRow(session) {
    const ip = session.ipAddress || session.ip_address || 'IP не зафіксовано';
    const tokenCount = Number(session.tokenCount || 1);
    return `
        <div class="profile-security-row">
            <div>
                <b>${escapeHtml(session.deviceLabel || sessionDeviceLabel(session))}</b>
                <span>${escapeHtml(ip)}</span>
            </div>
            <small>${profileFormatTime(session.created_at || session.createdAt)} → ${profileFormatTime(session.expires_at || session.expiresAt)}${tokenCount > 1 ? ` · ${tokenCount} входів згруповано` : ''}</small>
        </div>`;
}

function accountSecurityEventLabel(type) {
    const labels = {
        login_success: 'Вхід виконано',
        login_failed: 'Невдала спроба входу',
        session_logout: 'Вихід із пристрою',
        password_changed: 'Пароль змінено',
        password_reset_by_admin: 'Пароль скинуто адміністратором',
        password_one_time_reissued: 'One-time пароль перевипущено',
        sessions_revoked: 'Сесії відкликано',
        account_created: 'Акаунт створено',
        account_created_with_staff_link: 'Акаунт створено і привʼязано до працівника',
        account_profile_updated: 'Профіль акаунта змінено',
        account_profile_staff_linked: 'Акаунт привʼязано до працівника',
        account_profile_staff_unlinked: 'Акаунт відвʼязано від працівника',
        account_staff_unlinked: 'Акаунт відвʼязано від працівника',
        bulk_account_created_with_staff_link: 'Акаунт створено масово',
        account_impersonation_started: 'Impersonation акаунта запущено',
        account_roles_updated: 'Ролі та доступ змінено',
        account_access_updated: 'Ролі та доступ змінено',
        account_activated: 'Акаунт активовано',
        account_deactivated: 'Акаунт деактивовано'
    };
    return labels[type] || type || 'Подія акаунта';
}

function accountSecurityReasonLabel(reason) {
    const labels = {
        auth_login: 'вхід',
        password_mismatch: 'невірний пароль',
        user_not_found: 'користувача не знайдено',
        inactive_account: 'акаунт вимкнено',
        self_service: 'самостійна дія',
        account_management: 'керування акаунтом',
        logout_current_device: 'поточний пристрій',
        logout_all_devices: 'усі пристрої'
    };
    return labels[reason] || reason || '';
}

function accountSecurityEventDetails(event) {
    const details = event.details && typeof event.details === 'object' ? event.details : {};
    const type = event.event_type || event.eventType;
    if (type === 'account_roles_updated' || type === 'account_access_updated') {
        const parts = [];
        if (details.oldRole || details.newRole) parts.push(`${details.oldRole || '—'} → ${details.newRole || '—'}`);
        if (details.changed?.extraRoles) parts.push('додаткові ролі оновлено');
        if (details.changed?.pageAllowlist) parts.push('сторінки доступу оновлено');
        if (details.changed?.actionAllowlist) parts.push('дозволи дій оновлено');
        if (details.changed?.actionDenylist) parts.push('заборони дій оновлено');
        return parts.join(' · ');
    }
    if (type === 'login_failed') return accountSecurityReasonLabel(details.reason || event.reason);
    if (type === 'login_success') return details.parsedCredentialBlock ? 'вхід із credential block' : 'сесію створено';
    if (type === 'session_logout') return 'поточну refresh-сесію відкликано';
    if (type === 'sessions_revoked') return details.scope === 'all_devices' ? 'усі активні сесії' : 'сесії відкликано';
    if (type === 'account_impersonation_started') return details.targetRole ? `роль цілі: ${details.targetRole}` : '';
    if (type === 'password_reset_by_admin' || type === 'password_one_time_reissued') {
        return details.sessionsRevoked ? 'старі сесії відкликано' : '';
    }
    if (type === 'account_created') {
        return details.role ? `роль: ${details.role}` : '';
    }
    return '';
}

function renderProfileSecurityEventRow(event) {
    const actor = event.actor_username || event.actorUsername || 'CRM';
    const target = event.target_username || event.targetUsername || '';
    const reason = event.reason || '';
    const actorSubject = target && target !== actor
        ? `${actor} → ${target}`
        : actor;
    const detail = accountSecurityEventDetails(event);
    const meta = [
        actorSubject,
        accountSecurityReasonLabel(reason),
        detail
    ].filter(Boolean).join(' · ');
    return `
        <div class="profile-security-row">
            <div>
                <b>${escapeHtml(accountSecurityEventLabel(event.event_type || event.eventType))}</b>
                <span>${escapeHtml(meta)}</span>
            </div>
            <small>${profileFormatTime(event.created_at || event.createdAt)}</small>
        </div>`;
}

async function refreshProfileSecurityPanel() {
    profileSecurityData = await apiGet('/auth/security');
    if (activeTab === 'settings') {
        const tabContent = document.getElementById('tabContent');
        if (tabContent) tabContent.innerHTML = renderTabContent();
    }
}

async function profileSecurityFetch(path, options = {}) {
    const response = await fetch(`/api${path}`, {
        ...options,
        headers: { ...getAuthHeaders(), ...(options.headers || {}) }
    });
    if (handleAuthError(response)) return { success: false, error: 'Потрібна повторна авторизація' };
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data.error || 'Помилка запиту' };
    return { success: true, ...data };
}

async function openProfilePasswordModal() {
    if (typeof formModal !== 'function') {
        if (typeof showNotification === 'function') showNotification('Форма зміни пароля недоступна', 'error');
        return;
    }
    const values = await formModal('Змінити пароль', [
        { key: 'currentPassword', label: 'Поточний пароль', type: 'password', required: true },
        { key: 'newPassword', label: 'Новий пароль', type: 'password', required: true },
        { key: 'repeatPassword', label: 'Повторіть новий пароль', type: 'password', required: true }
    ], { okText: 'Оновити пароль', type: 'warning', icon: '🔐' });
    if (!values) return;
    if (String(values.newPassword || '').length < 8) {
        if (typeof showNotification === 'function') showNotification('Новий пароль має бути не менше 8 символів', 'error');
        return;
    }
    if (values.newPassword !== values.repeatPassword) {
        if (typeof showNotification === 'function') showNotification('Нові паролі не збігаються', 'error');
        return;
    }
    const result = await profileSecurityFetch('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({
            currentPassword: values.currentPassword,
            newPassword: values.newPassword
        })
    });
    if (!result.success) {
        if (typeof showNotification === 'function') showNotification(result.error || 'Не вдалося змінити пароль', 'error');
        return;
    }
    if (typeof showNotification === 'function') showNotification('Пароль оновлено', 'success');
    await refreshProfileSecurityPanel();
}

async function revokeProfileSessions() {
    let confirmed = false;
    if (typeof confirmModal === 'function') {
        confirmed = await confirmModal('Завершити всі активні сесії? Поточний пристрій теж вийде з CRM.', {
            type: 'danger',
            okText: 'Завершити сесії',
            cancelText: 'Скасувати'
        });
    } else if (typeof showNotification === 'function') {
        showNotification('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
    }
    if (!confirmed) return;
    const result = await profileSecurityFetch('/auth/security/revoke-sessions', { method: 'POST', body: '{}' });
    if (!result.success) {
        if (typeof showNotification === 'function') showNotification(result.error || 'Не вдалося завершити сесії', 'error');
        return;
    }
    if (typeof showNotification === 'function') showNotification('Сесії завершено. Потрібен повторний вхід.', 'success');
    setTimeout(() => logout(), 700);
}

function profileOverviewMetric(label, value, hint, tone = '') {
    return `
        <div class="profile-overview-metric ${tone}">
            <b>${escapeHtml(value)}</b>
            <span>${escapeHtml(label)}</span>
            <small>${escapeHtml(hint || '')}</small>
        </div>`;
}

function paintProfileAvatarPreview(mode = 'initials') {
    const preview = document.getElementById('profileAvatarPreview');
    if (!preview) return;
    const color = document.getElementById('profileAvatarColor')?.value || '#f59e0b';
    const url = String(profileAvatarPhotoUrl(profileData) || '').trim();
    const crop = currentProfileAvatarCropFromControls();
    preview.innerHTML = '';
    if (mode === 'image' && url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        applyProfileAvatarCropToImage(img, crop);
        preview.style.background = 'transparent';
        preview.appendChild(img);
        return;
    }
    preview.style.background = color;
    preview.textContent = profileAvatarData().initial;
}

function updateProfileAvatarCropFromControls() {
    const crop = currentProfileAvatarCropFromControls();
    syncProfileAvatarCropControls(crop);
    document.querySelectorAll('.profile-avatar-preview img, .profile-work-avatar img').forEach(img => {
        applyProfileAvatarCropToImage(img, crop);
    });
}

function resetProfileAvatarCrop() {
    syncProfileAvatarCropControls(PROFILE_AVATAR_CROP_DEFAULT);
    updateProfileAvatarCropFromControls();
}

function saveProfileAvatarCrop() {
    const url = String(profileAvatarPhotoUrl(profileData) || '').trim();
    if (!url) {
        if (typeof showNotification === 'function') showNotification('Спочатку збережіть або виберіть фото профілю', 'warning');
        return;
    }
    const crop = writeProfileAvatarCrop(profileData, url, currentProfileAvatarCropFromControls());
    if (profileData?.user) {
        profileData.user.avatarCrop = crop;
        profileData.user.avatarCropUrl = url;
    }
    if (typeof AppState !== 'undefined' && AppState.currentUser) {
        AppState.currentUser.avatarCrop = crop;
        AppState.currentUser.avatarCropUrl = url;
    }
    try {
        const saved = JSON.parse(localStorage.getItem('pzp_current_user') || '{}');
        localStorage.setItem('pzp_current_user', JSON.stringify({ ...saved, avatarCrop: crop, avatarCropUrl: url }));
    } catch {}
    updateProfileAvatarCropFromControls();
    if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    if (typeof showNotification === 'function') showNotification('Кадрування аватарки застосовано', 'success');
}

function selectProfileAvatarColor(color) {
    const input = document.getElementById('profileAvatarColor');
    if (input) input.value = color;
    document.querySelectorAll('.profile-avatar-color-grid button').forEach(btn => {
        btn.classList.toggle('active', (btn.getAttribute('title') || '').toLowerCase() === color.toLowerCase());
    });
    paintProfileAvatarPreview('initials');
}

function formatProfileFileSize(bytes) {
    const size = Number(bytes || 0);
    if (!size) return '0 КБ';
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} МБ`;
    return `${Math.ceil(size / 1024)} КБ`;
}

function clearProfileAvatarFile(options = {}) {
    const input = document.getElementById('profileAvatarFile');
    const nameEl = document.getElementById('profileAvatarFileName');
    const metaEl = document.getElementById('profileAvatarFileMeta');
    const uploadBtn = document.getElementById('profileAvatarUploadBtn');
    const pick = document.querySelector('.profile-avatar-file-pick');
    if (input) input.value = '';
    if (nameEl) nameEl.textContent = 'Обрати фото';
    if (metaEl) metaEl.textContent = 'JPG, PNG, WebP або GIF до 5 МБ';
    if (uploadBtn) uploadBtn.disabled = true;
    if (pick) pick.classList.remove('has-file');
    if (options.restorePreview !== false) {
        const hasUrl = String(profileAvatarPhotoUrl(profileData) || '').trim();
        paintProfileAvatarPreview(hasUrl ? 'image' : 'initials');
    }
}

function handleProfileAvatarFileChange(input) {
    const file = input?.files?.[0];
    const nameEl = document.getElementById('profileAvatarFileName');
    const metaEl = document.getElementById('profileAvatarFileMeta');
    const uploadBtn = document.getElementById('profileAvatarUploadBtn');
    const pick = document.querySelector('.profile-avatar-file-pick');
    if (uploadBtn) uploadBtn.disabled = true;
    if (!file) {
        clearProfileAvatarFile();
        return;
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (file.size > 5 * 1024 * 1024) {
        if (typeof showNotification === 'function') showNotification('Фото профілю має бути до 5 МБ', 'error');
        clearProfileAvatarFile();
        return;
    }
    if (file.type && !allowed.includes(file.type)) {
        if (typeof showNotification === 'function') showNotification('Підтримуються тільки JPG, PNG, WebP або GIF', 'error');
        clearProfileAvatarFile();
        return;
    }

    if (nameEl) nameEl.textContent = file.name;
    if (metaEl) metaEl.textContent = `${formatProfileFileSize(file.size)} · готово до збереження`;
    if (uploadBtn) uploadBtn.disabled = false;
    if (pick) pick.classList.add('has-file');

    const reader = new FileReader();
    reader.onload = () => {
        const preview = document.getElementById('profileAvatarPreview');
        if (!preview) return;
        preview.innerHTML = '';
        const img = document.createElement('img');
        img.src = reader.result;
        img.alt = '';
        applyProfileAvatarCropToImage(img, currentProfileAvatarCropFromControls());
        preview.style.background = 'transparent';
        preview.appendChild(img);
    };
    reader.readAsDataURL(file);
}

function applyProfileAvatarResult(result, message = 'Аватарку оновлено') {
    if (!result?.success || !result.user) {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Не вдалося зберегти аватарку', 'error');
        return false;
    }
    const avatarUrl = result.user.avatarUrl || result.user.avatar_url || '';
    if (avatarUrl) {
        result.user.avatarCrop = readProfileAvatarCrop({ user: result.user }, avatarUrl);
        result.user.avatarCropUrl = avatarUrl;
    }
    profileData.user = { ...(profileData.user || {}), ...result.user };
    try {
        const saved = JSON.parse(localStorage.getItem('pzp_current_user') || '{}');
        const next = { ...saved, ...result.user };
        localStorage.setItem('pzp_current_user', JSON.stringify(next));
        if (typeof AppState !== 'undefined') AppState.currentUser = { ...(AppState.currentUser || {}), ...next };
    } catch {
        localStorage.setItem('pzp_current_user', JSON.stringify(result.user));
        if (typeof AppState !== 'undefined') AppState.currentUser = result.user;
    }
    if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    if (typeof showNotification === 'function') showNotification(message, 'success');
    renderProfile();
    return true;
}

async function uploadProfileAvatarFile() {
    const input = document.getElementById('profileAvatarFile');
    const file = input?.files?.[0];
    if (!file) {
        if (typeof showNotification === 'function') showNotification('Оберіть фото з пристрою', 'error');
        return;
    }

    const button = document.getElementById('profileAvatarUploadBtn');
    const originalText = button?.textContent || 'Завантажити';
    if (button) {
        button.disabled = true;
        button.textContent = 'Завантаження...';
    }

    try {
        const body = new FormData();
        body.append('file', file);
        const response = await fetch('/api/auth/profile/avatar/upload', {
            method: 'POST',
            headers: getAuthHeaders(false),
            body
        });
        if (handleAuthError(response)) return;
        const result = await response.json().catch(() => ({ success: false, error: 'Помилка відповіді сервера' }));
        if (!response.ok) {
            if (typeof showNotification === 'function') showNotification(result?.error || 'Не вдалося завантажити фото', 'error');
            return;
        }
        const avatarUrl = result.user?.avatarUrl || result.user?.avatar_url || '';
        if (avatarUrl) {
            const crop = writeProfileAvatarCrop({ user: result.user }, avatarUrl, currentProfileAvatarCropFromControls());
            result.user.avatarCrop = crop;
            result.user.avatarCropUrl = avatarUrl;
        }
        applyProfileAvatarResult(result, 'Фото профілю оновлено');
    } catch (err) {
        if (typeof showNotification === 'function') showNotification(err.message || 'Не вдалося завантажити фото', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

async function saveProfileAvatar(type) {
    const payload = {
        avatarType: type,
        avatarEmoji: '',
        avatarColor: document.getElementById('profileAvatarColor')?.value || '#f59e0b',
        avatarUrl: type === 'image' ? String(profileAvatarPhotoUrl(profileData) || '').trim() : ''
    };
    const result = await apiPatch('/auth/profile/avatar', payload);
    if (result?.success && result.user && type === 'image') {
        const avatarUrl = result.user.avatarUrl || result.user.avatar_url || payload.avatarUrl;
        const crop = writeProfileAvatarCrop({ user: result.user }, avatarUrl, currentProfileAvatarCropFromControls());
        result.user.avatarCrop = crop;
        result.user.avatarCropUrl = avatarUrl;
    }
    applyProfileAvatarResult(result);
}

function renderProfileTaskRow(task, tag = '') {
    const dueAt = task.scheduledStartAt || task.scheduled_start_at || task.schedule?.startAt || task.deadline;
    const due = dueAt ? profileFormatTime(dueAt) : 'Без дедлайну';
    const priority = normalizeCabinetPriority(task.priority || task.taskPriority || task.priority_level);
    const priorityLabel = cabinetTaskPriorityLabel(priority);
    const classes = [
        'profile-task-row',
        task.isOverdue || tag === 'Прострочено' ? 'is-overdue' : '',
        `priority-${priority}`,
        priority === 'urgent' ? 'is-urgent' : ''
    ].filter(Boolean).join(' ');
    return `
        <div class="${classes}" data-task-priority="${escapeHtml(priority)}">
            <div>
                <b>${escapeHtml(task.title || 'Без назви')}</b>
                <span>${escapeHtml(tag || task.status || 'todo')} · ${escapeHtml(due)}</span>
            </div>
            <small class="profile-task-priority profile-task-priority--${escapeHtml(priority)}">${escapeHtml(priorityLabel)}</small>
        </div>`;
}

function renderProfileActivityRow(item) {
    const action = PROFILE_ACTION_NAMES[item.action] || item.action || 'Активність';
    const detail = profileActivityDetail(item);
    return `
        <div class="profile-activity-row">
            <span>${escapeHtml(action)}</span>
            <b>${escapeHtml(detail || 'Оновлення')}</b>
            <small>${profileFormatTime(item.created_at)}</small>
        </div>`;
}

function cabinetList(name) {
    const list = myCabinetData?.[name];
    return Array.isArray(list) ? list : [];
}

function cabinetPlanningList(name) {
    const list = myCabinetData?.planning?.[name];
    return Array.isArray(list) ? list : [];
}

function findCabinetTask(taskId) {
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const buckets = ['all', 'today', 'deferred', 'overdue', 'waiting', 'private', 'createdByMe', 'completedTodayTasks', 'completedHistory'];
    for (const bucket of buckets) {
        const found = cabinetList(bucket).find(task => Number(task.id || task.taskId || task.task_id) === id);
        if (found) return found;
    }
    for (const bucket of CABINET_PLANNING_TASK_BUCKETS) {
        const found = cabinetPlanningList(bucket).find(task => Number(task.id || task.taskId || task.task_id) === id);
        if (found) return found;
    }
    return null;
}

const CABINET_ACTIVE_TASK_BUCKETS = ['all', 'focus', 'today', 'next', 'deferred', 'waiting', 'private', 'overdue', 'inbox', 'createdByMe'];
const CABINET_PLANNING_TASK_BUCKETS = ['all', 'overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'plusThreeDays', 'monthEnd', 'noDate', 'future', 'focusDate'];
const cabinetBucketLoadStates = new Map();
const CABINET_PROJECTION_TIMEOUT_MS = 15000;
const CABINET_BUCKET_PAGE_LIMIT = 80;

function cabinetProjectionTaskId(task = {}) {
    return normalizeCabinetTaskId(task?.id || task?.taskId || task?.task_id);
}

function forEachCabinetProjectionTaskList(callback) {
    if (!myCabinetData || typeof myCabinetData !== 'object') return;
    Object.keys(myCabinetData).forEach(key => {
        if (Array.isArray(myCabinetData[key])) callback(myCabinetData, key, key);
    });
    const planning = myCabinetData.planning;
    if (!planning || typeof planning !== 'object') return;
    Object.keys(planning).forEach(key => {
        if (Array.isArray(planning[key])) callback(planning, key, `planning.${key}`);
    });
}

function removeCabinetTaskFromProjection(taskId) {
    const id = normalizeCabinetTaskId(taskId);
    const removed = { task: null, buckets: [] };
    if (!id || !myCabinetData || typeof myCabinetData !== 'object') return removed;
    CABINET_ACTIVE_TASK_BUCKETS.forEach(bucket => {
        const list = myCabinetData[bucket];
        if (!Array.isArray(list)) return;
        for (let index = list.length - 1; index >= 0; index -= 1) {
            if (cabinetProjectionTaskId(list[index]) !== id) continue;
            const [task] = list.splice(index, 1);
            if (!removed.task) removed.task = task;
            removed.buckets.push(bucket);
        }
    });
    const planning = myCabinetData.planning;
    if (planning && typeof planning === 'object') {
        CABINET_PLANNING_TASK_BUCKETS.forEach(bucket => {
            const list = planning[bucket];
            if (!Array.isArray(list)) return;
            for (let index = list.length - 1; index >= 0; index -= 1) {
                if (cabinetProjectionTaskId(list[index]) !== id) continue;
                const [task] = list.splice(index, 1);
                if (!removed.task) removed.task = task;
                removed.buckets.push(`planning.${bucket}`);
            }
            if (!removed.buckets.includes(`planning.${bucket}`)) return;
            const meta = cabinetBucketMeta(bucket);
            if (!meta) return;
            meta.total = Math.max(0, Number(meta.total) - 1);
            meta.returned = list.length;
            if (meta.nextCursor) meta.nextCursor.offset = Math.max(0, Number(meta.nextCursor.offset) - 1);
        });
    }
    return removed;
}

function bumpCabinetNumber(target, key, delta, min = 0) {
    if (!target || typeof target !== 'object') return;
    const current = Number(target[key] || 0);
    const next = current + delta;
    target[key] = min === null ? next : Math.max(min, next);
}

function normalizeCabinetCompletedTaskForProjection(task = {}, fallback = {}) {
    const now = new Date().toISOString();
    const completedAt = task.completedAt || task.completed_at || now;
    const actualSecondsToday = task.actualSecondsToday ?? task.actual_seconds_today ?? fallback.actualSecondsToday ?? fallback.actual_seconds_today ?? 0;
    return {
        ...fallback,
        ...task,
        status: 'done',
        workflowState: 'done',
        workflow_state: 'done',
        completedAt,
        completed_at: completedAt,
        completedParentToday: true,
        completedTodayKind: 'task',
        actualSecondsToday,
        updatedAt: task.updatedAt || task.updated_at || completedAt,
        updated_at: task.updated_at || task.updatedAt || completedAt
    };
}

function syncCabinetProjectionCountersFromBuckets() {
    if (!myCabinetData?.stats) return;
    myCabinetData.stats.waitingCount = cabinetList('waiting').length;
    myCabinetData.stats.overdueCount = cabinetList('overdue').length;
    myCabinetData.stats.deferredCount = cabinetList('deferred').length;
    myCabinetData.stats.privateCount = cabinetList('private').length;
    myCabinetData.stats.inboxCount = cabinetList('inbox').length;
    myCabinetData.stats.focusCount = cabinetList('focus').length;
}

function applyCabinetCompletionStats(removedBuckets = []) {
    if (!myCabinetData || typeof myCabinetData !== 'object') return;
    myCabinetData.stats = myCabinetData.stats || {};
    const stats = myCabinetData.stats;
    stats.taskQuick = stats.taskQuick || {};
    const quick = stats.taskQuick;
    bumpCabinetNumber(stats, 'todayDone', 1, 0);
    bumpCabinetNumber(quick, 'completed', 1, 0);
    bumpCabinetNumber(quick, 'completedToday', 1, 0);
    bumpCabinetNumber(quick, 'completedTotal', 1, 0);
    bumpCabinetNumber(quick, 'completedUnitsToday', 1, 0);
    bumpCabinetNumber(quick, 'completedUnitsTotal', 1, 0);
    bumpCabinetNumber(quick, 'completedParentToday', 1, 0);
    bumpCabinetNumber(quick, 'completedParentTotal', 1, 0);

    const hadToday = removedBuckets.includes('today');
    const hadOverdue = removedBuckets.includes('overdue');
    if (hadToday) {
        bumpCabinetNumber(stats, 'todayPlanned', -1, 0);
        bumpCabinetNumber(stats, 'todayWorkloadCount', -1, 0);
        bumpCabinetNumber(quick, 'todayRemaining', -1, 0);
    }
    if (hadOverdue) {
        bumpCabinetNumber(stats, 'overdueCarryover', -1, 0);
        bumpCabinetNumber(stats, 'overdueCarryoverCount', -1, 0);
        bumpCabinetNumber(quick, 'overdueCarryover', -1, 0);
    }
    if (hadToday || hadOverdue) {
        bumpCabinetNumber(stats, 'activeMyDay', -1, 0);
        bumpCabinetNumber(stats, 'activeMyDayCount', -1, 0);
        bumpCabinetNumber(quick, 'remaining', -1, 0);
        bumpCabinetNumber(quick, 'activeMyDay', -1, 0);
    }
    quick.completedHistoryShown = cabinetCompletedHistoryList().length;
    quick.completedHistoryOverflow = Math.max(0, Number(quick.completedParentTotal ?? quick.completedTotal ?? 0) - quick.completedHistoryShown);
    syncCabinetProjectionCountersFromBuckets();
}

function applyCabinetTaskStatusToProjection(taskId, status, resultTask = {}, fallbackTask = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id || !myCabinetData || typeof myCabinetData !== 'object') return false;
    if (status !== 'done') return false;
    const removed = removeCabinetTaskFromProjection(id);
    const baseTask = resultTask && Object.keys(resultTask).length ? resultTask : (removed.task || fallbackTask || {});
    const completedTask = normalizeCabinetCompletedTaskForProjection(baseTask, removed.task || fallbackTask || {});
    completedTask.id = completedTask.id || id;
    myCabinetData.completedHistory = Array.isArray(myCabinetData.completedHistory) ? myCabinetData.completedHistory : [];
    myCabinetData.completedHistory = myCabinetData.completedHistory.filter(task => cabinetProjectionTaskId(task) !== id);
    myCabinetData.completedHistory.unshift(completedTask);
    myCabinetData.completedHistory = myCabinetData.completedHistory.slice(0, CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT);
    myCabinetData.completedTodayTasks = Array.isArray(myCabinetData.completedTodayTasks) ? myCabinetData.completedTodayTasks : [];
    myCabinetData.completedTodayTasks = myCabinetData.completedTodayTasks.filter(task => cabinetProjectionTaskId(task) !== id);
    myCabinetData.completedTodayTasks.unshift(completedTask);
    applyCabinetCompletionStats(removed.buckets);
    syncCabinetCompletionHistoryStateFromProjection(myCabinetData);
    return true;
}

function applyCabinetTaskPriorityToProjection(taskId, priority = 'normal', resultTask = {}) {
    const id = normalizeCabinetTaskId(taskId);
    const normalized = normalizeCabinetPriority(priority);
    if (!id || !myCabinetData || typeof myCabinetData !== 'object') return false;
    let updated = false;
    forEachCabinetProjectionTaskList((owner, key) => {
        owner[key] = owner[key].map(task => {
            if (cabinetProjectionTaskId(task) !== id) return task;
            updated = true;
            return {
                ...task,
                ...(resultTask || {}),
                priority: normalized,
                taskPriority: normalized,
                priority_level: normalized
            };
        });
    });
    return updated;
}

function scheduleCabinetProjectionRefresh(delay = 900) {
    if (cabinetProjectionRefreshTimer) clearTimeout(cabinetProjectionRefreshTimer);
    cabinetProjectionRefreshTimer = setTimeout(() => {
        cabinetProjectionRefreshTimer = null;
        if (!isOwnProfile || !isProfileTaskProjectionTab(activeTab)) return;
        refreshMyCabinetTab({ silent: true, force: true }).catch(error => console.warn('Profile cabinet background refresh failed', error));
    }, delay);
}

function cabinetTaskProjectionContainsId(data, taskId) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id || !data || typeof data !== 'object') return false;
    const buckets = ['all', 'today', 'deferred', 'overdue', 'waiting', 'private', 'createdByMe', 'completedTodayTasks', 'completedHistory'];
    const foundInLegacyBuckets = buckets.some(bucket => Array.isArray(data[bucket])
        && data[bucket].some(task => normalizeCabinetTaskId(task?.id || task?.taskId || task?.task_id) === id));
    if (foundInLegacyBuckets) return true;
    const planning = data.planning;
    return Boolean(planning && typeof planning === 'object' && CABINET_PLANNING_TASK_BUCKETS.some(bucket => Array.isArray(planning[bucket])
        && planning[bucket].some(task => normalizeCabinetTaskId(task?.id || task?.taskId || task?.task_id) === id)));
}

function createdCabinetTaskId(result = {}) {
    return normalizeCabinetTaskId(result?.task?.id || result?.task?.taskId || result?.task?.task_id || result?.taskId || result?.task_id || result?.id);
}

function renderCabinetActiveTab() {
    const tabContent = document.getElementById('tabContent');
    if (tabContent && isProfileTaskProjectionTab(activeTab)) {
        const restore = window.ProfileMyDay?.preservePosition(tabContent);
        window.TaskUI?.closeActionMenu?.();
        const workspace = tabContent.querySelector('.park-my-day #cabinetMyDaySegmentPanel');
        if (workspace) {
            workspace.outerHTML = renderParkMyDayWorkspace();
            tabContent.querySelector('[data-park-my-day-notice]').innerHTML = renderCabinetLoadNotice();
            tabContent.querySelector('[data-cabinet-completion-pulse]').outerHTML = renderCabinetCompletionPulse();
            const reminders = tabContent.querySelector('[data-park-my-day-reminders]');
            if (reminders) reminders.innerHTML = renderMyDayHrReminders();
        } else {
            tabContent.innerHTML = renderTabContent();
        }
        attachProfileListeners();
        restore?.();
        if (pendingMyDayPeriod) {
            const period = tabContent.querySelector(`[data-park-period="${pendingMyDayPeriod}"]`);
            if (period) {
                pendingMyDayPeriod = null;
                window.requestAnimationFrame(() => period.scrollIntoView({ block: 'nearest' }));
            }
        }
        if (initialHrReminderLinkPending) {
            initialHrReminderLinkPending = false;
            if (activeTab === 'myday' && window.location.hash === '#hr-personal-reminders') {
                window.requestAnimationFrame(() => {
                    document.getElementById('hr-personal-reminders')?.scrollIntoView({ block: 'center' });
                });
            }
        }
    }
}

function cabinetCompletedHistoryList() {
    const state = syncCabinetCompletionHistoryStateFromProjection();
    return Array.isArray(state.items) ? state.items : cabinetList('completedHistory');
}

function cabinetBucketMeta(bucket = '') {
    const key = String(bucket || '').trim();
    const meta = myCabinetData?.meta || {};
    if (key === 'completedToday') return meta.buckets?.completedToday || meta.completedToday || null;
    if (key === 'completedHistory') return meta.buckets?.completedHistory || meta.completedHistory || null;
    return meta.buckets?.planning?.[key]
        || meta.planning?.buckets?.[key]
        || meta.buckets?.[key]
        || null;
}

function renderCabinetBucketMore(bucket = '', label = 'Показати ще') {
    const meta = cabinetBucketMeta(bucket);
    if (!meta?.hasMore && !meta?.isPartial) return '';
    const offset = Number(meta.nextCursor?.offset ?? (Number(meta.offset || 0) + Number(meta.returned || 0)));
    const limit = Number(meta.nextCursor?.limit || meta.limit || CABINET_BUCKET_PAGE_LIMIT);
    const total = Number(meta.total || 0);
    const returned = Number(meta.returned || offset || 0);
    const countText = bucket === 'completedToday' && total > 0 ? `<small>Показано ${escapeHtml(returned)} із ${escapeHtml(total)}</small>` : '';
    return `<button type="button" class="cabinet-bucket-more" data-cabinet-bucket-more="${escapeHtml(bucket)}" data-cabinet-bucket-offset="${escapeHtml(offset)}" data-cabinet-bucket-limit="${escapeHtml(limit)}" aria-label="${escapeHtml(label)}">${escapeHtml(label)}${countText}</button>`;
}

function mergeCabinetBucketPage(bucket = '', payload = {}) {
    const key = String(bucket || '').trim();
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : (Array.isArray(payload.items) ? payload.items : []);
    if (!key || !myCabinetData || typeof myCabinetData !== 'object') return false;
    const appendUnique = (owner, listKey) => {
        if (!owner || typeof owner !== 'object') return;
        owner[listKey] = Array.isArray(owner[listKey]) ? owner[listKey] : [];
        const existing = new Set(owner[listKey].map(task => cabinetProjectionTaskId(task)).filter(Boolean));
        tasks.forEach(task => {
            const id = cabinetProjectionTaskId(task);
            if (id && existing.has(id)) return;
            if (id) existing.add(id);
            owner[listKey].push(task);
        });
    };
    if (key === 'completedToday') appendUnique(myCabinetData, 'completedTodayTasks');
    else if (key === 'completedHistory') appendUnique(myCabinetData, 'completedHistory');
    else {
        myCabinetData.planning = myCabinetData.planning && typeof myCabinetData.planning === 'object' ? myCabinetData.planning : {};
        appendUnique(myCabinetData.planning, key);
        appendUnique(myCabinetData.planning, 'all');
    }
    const pageMeta = payload.meta?.bucketPage || null;
    if (pageMeta) {
        myCabinetData.meta = myCabinetData.meta || {};
        myCabinetData.meta.buckets = myCabinetData.meta.buckets || {};
        if (key === 'completedToday' || key === 'completedHistory') {
            myCabinetData.meta.buckets[key] = pageMeta;
        } else {
            myCabinetData.meta.buckets.planning = myCabinetData.meta.buckets.planning || {};
            myCabinetData.meta.buckets.planning[key] = pageMeta;
            myCabinetData.meta.planning = myCabinetData.meta.planning || {};
            myCabinetData.meta.planning.buckets = myCabinetData.meta.planning.buckets || {};
            myCabinetData.meta.planning.buckets[key] = pageMeta;
        }
    }
    return true;
}

async function loadCabinetBucketPage(button) {
    const bucket = String(button?.dataset?.cabinetBucketMore || '').trim();
    if (!bucket) return;
    const key = bucket;
    if (cabinetBucketLoadStates.get(key) === 'loading') return;
    const sourceProjection = myCabinetData;
    const scope = cabinetProjectionScopeKey();
    const focusDate = bucket === 'focusDate' ? myDayLinkedDate || cabinetSelectedDueDate() : '';
    const offset = Math.max(0, Number(button?.dataset?.cabinetBucketOffset || 0));
    const limit = Math.max(1, Math.min(Number(button?.dataset?.cabinetBucketLimit || CABINET_BUCKET_PAGE_LIMIT), CABINET_BUCKET_PAGE_LIMIT));
    cabinetBucketLoadStates.set(key, 'loading');
    button.disabled = true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    try {
        const params = new URLSearchParams({
            bucket,
            offset: String(offset),
            limit: String(limit),
            planningView: 'my-day'
        });
        if (focusDate) params.set('focusDate', focusDate);
        const payload = await apiGetScopedJson(`/tasks/my-cabinet?${params.toString()}`, {
            timeoutMs: CABINET_PROJECTION_TIMEOUT_MS
        });
        if (myCabinetData !== sourceProjection || scope !== cabinetProjectionScopeKey()
            || (focusDate && focusDate !== (myDayLinkedDate || cabinetSelectedDueDate()))) return;
        mergeCabinetBucketPage(bucket, payload);
        if (bucket === 'completedToday') rerenderCabinetCompletionPulse();
        else rerenderCabinetMyDaySegmentPanel();
    } catch (error) {
        cabinetBucketLoadStates.set(key, 'error');
        window.showNotification?.(error?.message || 'Не вдалося дозавантажити задачі.', 'error');
    } finally {
        cabinetBucketLoadStates.delete(key);
        if (button.isConnected) {
            button.disabled = false;
            button.classList.remove('is-busy');
            button.removeAttribute('aria-busy');
        }
    }
}

function bindCabinetBucketButtons(root) {
    root.querySelectorAll('[data-cabinet-bucket-more]').forEach(button => {
        if (button.dataset.cabinetBucketMoreBound === 'true') return;
        button.dataset.cabinetBucketMoreBound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            void loadCabinetBucketPage(button);
        });
    });
}

function renderCabinetLoadingSkeleton() {
    const rows = Array.from({ length: 4 }).map(() => `
        <div class="cabinet-task-card is-personal-day-card is-my-day-compact-card cabinet-task-card--skeleton" aria-hidden="true">
            <div class="cabinet-task-main cabinet-task-main--my-day">
                <div class="cabinet-task-skeleton-line is-title"></div>
                <div class="cabinet-task-skeleton-row">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </div>`).join('');
    return `<section class="cabinet-task-section cabinet-task-section--loading" aria-label="Завантаження задач">
        <div class="cabinet-section-head"><h3>Завантажую Мій день…</h3><span>без очікування повного списку</span></div>
        <div class="cabinet-section-body">${rows}</div>
    </section>`;
}

function cabinetCompletedHistoryCounts(data = myCabinetData) {
    const history = Array.isArray(data?.completedHistory) ? data.completedHistory : [];
    const quick = data?.stats?.taskQuick || {};
    const total = Number(quick.completedParentTotal ?? quick.completedHistoryTotal ?? quick.completedTotal ?? quick.completed ?? history.length) || history.length;
    const shown = Number(quick.completedHistoryShown ?? history.length) || history.length;
    const overflow = Number(quick.completedHistoryOverflow ?? Math.max(0, total - shown)) || 0;
    return { total, shown: Math.min(shown, history.length), overflow };
}

function cabinetCompletionHistoryMeta(data = myCabinetData) {
    const meta = data?.meta?.completedHistory || {};
    return {
        nextCursor: typeof meta.nextCursor === 'string' ? meta.nextCursor : '',
        hasMore: Boolean(meta.hasMore),
        limit: Math.max(1, Math.min(100, Number(meta.limit || CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT) || CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT)),
        returned: Math.max(0, Number(meta.returned || 0) || 0)
    };
}

function cabinetCompletionHistoryScopeKey(data = myCabinetData) {
    const user = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    const userId = String(user.id || user.user_id || currentUserId || 'anonymous').trim() || 'anonymous';
    const business = cabinetMyDayBusinessPreferenceScope().replace(/[^a-zA-Z0-9:_-]/g, '_');
    const metaScope = data?.meta?.businessScope && typeof data.meta.businessScope === 'object'
        ? JSON.stringify(data.meta.businessScope)
        : '';
    return `${userId}:${business}:${metaScope}`;
}

function mergeCabinetCompletionHistoryItems(primary = [], secondary = []) {
    const seen = new Set();
    const result = [];
    [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])].forEach(task => {
        const id = cabinetProjectionTaskId(task);
        const key = id ? `id:${id}` : `fallback:${cabinetTaskCompletedAt(task)}:${task?.title || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push(task);
    });
    return result;
}

function resetCabinetCompletionHistoryState(scopeKey = cabinetCompletionHistoryScopeKey()) {
    completedDashboardHistoryState = {
        scopeKey,
        items: [],
        nextCursor: '',
        hasMore: false,
        loading: false,
        error: '',
        requestSeq: completedDashboardHistoryState.requestSeq || 0,
        total: 0,
        limit: CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT,
        initialized: false
    };
    completedDashboardHistoryVisibleCount = CABINET_COMPLETION_ROWS_INITIAL;
    completedDashboardShowAll = false;
    return completedDashboardHistoryState;
}

function syncCabinetCompletionHistoryStateFromProjection(data = myCabinetData) {
    const scopeKey = cabinetCompletionHistoryScopeKey(data);
    const projectionItems = Array.isArray(data?.completedHistory) ? data.completedHistory : [];
    const meta = cabinetCompletionHistoryMeta(data);
    const counts = cabinetCompletedHistoryCounts(data);
    const current = completedDashboardHistoryState || {};
    const scopeChanged = current.scopeKey !== scopeKey;
    if (scopeChanged) {
        resetCabinetCompletionHistoryState(scopeKey);
    }
    const state = completedDashboardHistoryState;
    const preservePagination = !scopeChanged && state.initialized && state.items.length > projectionItems.length;
    const inferredHasMore = Boolean(meta.hasMore && meta.nextCursor);
    state.scopeKey = scopeKey;
    state.items = mergeCabinetCompletionHistoryItems(projectionItems, scopeChanged ? [] : state.items);
    state.nextCursor = preservePagination ? (state.nextCursor || '') : (meta.nextCursor || state.nextCursor || '');
    state.hasMore = preservePagination ? Boolean(state.hasMore) : inferredHasMore;
    state.limit = meta.limit || state.limit || CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT;
    state.total = Math.max(Number(counts.total || 0) || 0, state.items.length);
    state.initialized = true;
    if (!state.loading) state.error = state.error || '';
    return state;
}

function cabinetCompletionHistoryState() {
    return syncCabinetCompletionHistoryStateFromProjection();
}

function cabinetCompletionHistoryLoadedCount() {
    return cabinetCompletionHistoryState().items.length;
}

function cabinetCompletionHistoryTotalCount() {
    const state = cabinetCompletionHistoryState();
    return Math.max(Number(state.total || 0) || 0, state.items.length);
}

function cabinetTaskCompletedAt(task = {}) {
    return task.completedAt || task.completed_at || task.updatedAt || task.updated_at || task.createdAt || task.created_at || '';
}

function cabinetTaskCanonicalCompletedAt(task = {}) {
    return task.completedAt || task.completed_at || '';
}

function cabinetKyivDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
        const parts = cabinetKyivDateFormatter.formatToParts(date).reduce((acc, part) => {
            if (part.type !== 'literal') acc[part.type] = part.value;
            return acc;
        }, {});
        return `${parts.year}-${parts.month}-${parts.day}`;
    } catch (error) {
        return date.toISOString().slice(0, 10);
    }
}

function cabinetCompletedHistoryDayMeta(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
        return {
            key: 'unknown',
            shortLabel: 'Без дати',
            longLabel: 'Дата закриття не збережена',
            statLabel: 'Без дати'
        };
    }
    const key = cabinetKyivDateKey(date);
    const today = cabinetKyivDateKey(new Date());
    const yesterday = cabinetKyivDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    let relative = '';
    if (key === today) relative = 'Сьогодні';
    if (key === yesterday) relative = 'Вчора';
    const shortDate = date.toLocaleDateString('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit',
        month: '2-digit'
    });
    const longDate = date.toLocaleDateString('uk-UA', {
        timeZone: 'Europe/Kyiv',
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
    return {
        key,
        shortLabel: relative || shortDate,
        longLabel: relative ? `${relative}, ${longDate}` : longDate,
        statLabel: relative || shortDate
    };
}

function groupCabinetCompletedHistoryByDay(tasks = []) {
    return tasks.reduce((groups, task, index) => {
        const completedAt = cabinetTaskCanonicalCompletedAt(task) || cabinetTaskCompletedAt(task);
        const day = cabinetCompletedHistoryDayMeta(completedAt);
        const last = groups[groups.length - 1];
        if (!last || last.day.key !== day.key) {
            groups.push({ day, tasks: [] });
        }
        groups[groups.length - 1].tasks.push({ task, index });
        return groups;
    }, []);
}

function normalizeCabinetPriority(priority = '') {
    if (window.TaskUiShared?.normalizeTaskPriority) {
        return window.TaskUiShared.normalizeTaskPriority(priority);
    }
    const value = String(priority || '').trim().toLowerCase();
    if (value === 'critical') return 'urgent';
    if (value === 'medium') return 'normal';
    return CABINET_TASK_PRIORITIES.some(item => item.value === value) ? value : 'normal';
}

function setCabinetPriorityClass(element, priority = 'normal') {
    if (!element) return normalizeCabinetPriority(priority);
    if (window.TaskUiShared?.applyPriorityClasses) {
        return window.TaskUiShared.applyPriorityClasses(element, priority, {
            priorityClassPrefix: 'priority-'
        });
    }
    const normalized = normalizeCabinetPriority(priority);
    CABINET_TASK_PRIORITY_VALUES.forEach(value => element.classList.remove(`priority-${value}`));
    element.classList.add(`priority-${normalized}`);
    return normalized;
}

function setCabinetPrioritySelectVisual(select, priority = 'normal') {
    if (!select) return normalizeCabinetPriority(priority);
    if (window.TaskUiShared?.applyPriorityClasses) {
        return window.TaskUiShared.applyPriorityClasses(select, priority, {
            selectClassPrefix: 'cabinet-task-priority-select--'
        });
    }
    const normalized = normalizeCabinetPriority(priority);
    CABINET_TASK_PRIORITY_VALUES.forEach(value => select.classList.remove(`cabinet-task-priority-select--${value}`));
    select.classList.add(`cabinet-task-priority-select--${normalized}`);
    select.value = normalized;
    return normalized;
}

function setCabinetPrioritySelectBusy(select, busy) {
    if (!select) return;
    const isBusy = Boolean(busy);
    select.disabled = isBusy;
    select.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    select.closest('.cabinet-task-card')?.classList.toggle('is-updating', isBusy);
}

function cabinetTaskMutationFailure(payload = {}, fallback = 'Не вдалося оновити задачу') {
    if (window.TaskUiShared?.taskMutationFailure) {
        return window.TaskUiShared.taskMutationFailure(payload, null, fallback);
    }
    return {
        success: false,
        error: window.CrmApiErrors?.format?.(payload, fallback) || payload.error || payload.message || fallback,
        offline: Boolean(payload.offline),
        status: payload.status || null,
        requestId: payload.requestId || payload.request_id || null
    };
}

function cabinetTaskOfflineFailure(error, fallback = 'Немає звʼязку з сервером. Перевірте інтернет і спробуйте ще раз.') {
    if (window.TaskUiShared?.taskOfflineFailure) {
        return window.TaskUiShared.taskOfflineFailure(error, fallback);
    }
    return {
        success: false,
        error: fallback,
        offline: true,
        status: null,
        requestId: null,
        details: error?.message ? { message: error.message } : null
    };
}

function normalizeCabinetTaskMutationResult(result, fallback = 'Не вдалося оновити задачу') {
    if (window.TaskUiShared?.normalizeTaskMutationResult) {
        return window.TaskUiShared.normalizeTaskMutationResult(result, fallback);
    }
    if (result?.success) return result;
    if (result && result.success === false) return cabinetTaskMutationFailure(result, fallback);
    return cabinetTaskOfflineFailure(null, fallback);
}

function applyCabinetTaskPriorityVisualState(taskId, priority = 'normal', sourceSelect = null) {
    const id = normalizeCabinetTaskId(taskId);
    const normalized = normalizeCabinetPriority(priority);
    if (!id) return normalized;
    const cards = new Set();
    const sourceCard = sourceSelect?.closest?.('.cabinet-task-card');
    if (sourceCard) cards.add(sourceCard);
    document.querySelectorAll(`.cabinet-task-card[data-task-id="${id}"]`).forEach(card => cards.add(card));
    cards.forEach(card => {
        if (window.TaskUiShared?.applyPriorityClasses) {
            window.TaskUiShared.applyPriorityClasses(card, normalized, {
                priorityClassPrefix: 'priority-',
                dataAttribute: 'taskPriority'
            });
            window.TaskUiShared.applyPriorityClasses(card.querySelector('[data-cabinet-task-priority-select]'), normalized, {
                selectClassPrefix: 'cabinet-task-priority-select--'
            });
        } else {
            setCabinetPriorityClass(card, normalized);
            card.dataset.taskPriority = normalized;
            setCabinetPrioritySelectVisual(card.querySelector('[data-cabinet-task-priority-select]'), normalized);
        }
    });
    setCabinetPrioritySelectVisual(sourceSelect, normalized);
    return normalized;
}

function cabinetTaskPriorityRank(task = {}) {
    if (window.TaskUiShared?.taskPriorityRank) {
        return window.TaskUiShared.taskPriorityRank(task);
    }
    const priority = normalizeCabinetPriority(task.priority || task.taskPriority || task.priority_level);
    const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
    return rank[priority] ?? rank.normal;
}

function cabinetTaskPriorityLabel(priority = '') {
    if (window.TaskUiShared?.taskPriorityLabel) {
        return window.TaskUiShared.taskPriorityLabel(priority);
    }
    const normalized = normalizeCabinetPriority(priority);
    const configured = CABINET_TASK_PRIORITIES.find(item => item.value === normalized);
    if (configured) return configured.label;
    const labels = {
        critical: 'Критично',
        high: 'Високий',
        medium: 'Середній',
        normal: 'Звичайний',
        low: 'Низький'
    };
    return labels[String(priority || '').toLowerCase()] || priority || 'Звичайний';
}

function cabinetTaskCategoryLabel(task = {}) {
    const category = cabinetTaskCategory(task);
    const found = CABINET_TASK_CATEGORIES.find(([value]) => value === category);
    return found?.[1] || taskKindLabel(task) || 'Задача';
}

function cabinetCompletedHistoryDetail(task = {}) {
    const parts = [
        task.title || 'Без назви',
        cabinetTaskCompletedAt(task) ? `виконано ${profileFormatTime(cabinetTaskCompletedAt(task))}` : 'час виконання не вказано',
        cabinetTaskPriorityLabel(task.priority),
        cabinetTaskCategoryLabel(task)
    ].filter(Boolean);
    return parts.join(' · ');
}

function renderCabinetCompletedHistoryStrip() {
    return renderCabinetCompletionPulse();
}

function cabinetCompletedTodayTasksList() {
    return cabinetList('completedTodayTasks').filter(cabinetTaskParentCompletedToday);
}

function cabinetCompletedTodayKey() {
    return myCabinetData?.meta?.calendar?.today || cabinetKyivDateKey(new Date());
}

function cabinetTaskParentCompletedToday(task = {}) {
    const completedAt = cabinetTaskCanonicalCompletedAt(task);
    return String(task.status || task.workflowState || task.workflow_state || '').toLowerCase() === 'done'
        && completedAt
        && cabinetKyivDateKey(completedAt) === cabinetCompletedTodayKey();
}

function cabinetFormatDuration(seconds = 0) {
    const total = Math.max(0, Math.round(Number(seconds || 0)));
    if (!total) return '0 хв';
    const hours = Math.floor(total / 3600);
    const minutes = Math.max(0, Math.round((total % 3600) / 60));
    if (hours && minutes) return `${hours} год ${minutes} хв`;
    if (hours) return `${hours} год`;
    return `${Math.max(1, minutes)} хв`;
}

function cabinetCompletedTodayMetrics(tasks = cabinetCompletedTodayTasksList()) {
    const quick = myCabinetData?.stats?.taskQuick || {};
    return {
        parentTasks: Number(quick.completedParentToday ?? tasks.length)
    };
}

function cabinetCompletionVisibleCount(total = 0) {
    const safeTotal = Math.max(0, Number(total || 0));
    if (normalizeCabinetCompletionTab() === 'history') {
        const current = Math.max(CABINET_COMPLETION_ROWS_INITIAL, Number(completedDashboardHistoryVisibleCount || 0));
        return Math.min(safeTotal, Number.isFinite(current) ? current : CABINET_COMPLETION_ROWS_INITIAL);
    }
    if (completedDashboardShowAll) return safeTotal;
    const current = Math.max(CABINET_COMPLETION_ROWS_INITIAL, Number(completedDashboardVisibleCount || 0));
    return Math.min(safeTotal, Number.isFinite(current) ? current : CABINET_COMPLETION_ROWS_INITIAL);
}

function renderCabinetCompletionTaskRow(task = {}, index = 0, mode = 'today') {
    const taskId = normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
    const completedAt = cabinetTaskCompletedAt(task);
    const completedMeta = [
        'Задача виконана',
        completedAt ? profileFormatTime(completedAt) : ''
    ].filter(Boolean).join(' · ');
    const actionAttrs = taskId
        ? `data-cabinet-task-action="open" data-task-id="${taskId}"`
        : 'disabled';
    return `<div class="park-completed-row"><button type="button" class="cabinet-completion-row" ${actionAttrs} aria-label="${escapeHtml(`Відкрити виконання: ${task.title || 'Без назви'}`)}">
        <span class="cabinet-completion-row-mark" aria-hidden="true">${cabinetTaskStatus(task) === 'done' ? '✓' : index + 1}</span>
        <span class="cabinet-completion-row-main">
            <b>${escapeHtml(task.title || 'Без назви')}</b>
            <small>${escapeHtml(completedMeta)}</small>
        </span>
    </button>
    ${mode === 'history' && taskId ? `<button type="button" class="park-task-secondary" data-cabinet-task-action="restore-completed" data-task-id="${taskId}">Відновити</button>` : ''}
    </div>`;
}

function normalizeCabinetCompletionTab(tab = completedDashboardTab) {
    return tab === 'history' ? 'history' : 'today';
}

function renderCabinetCompletionTabs(activeTab = normalizeCabinetCompletionTab()) {
    const todayCount = cabinetCompletedTodayMetrics().parentTasks;
    const historyCount = cabinetCompletionHistoryTotalCount();
    return `<div class="cabinet-completion-tabs" role="tablist" aria-label="Зріз виконань">
        <button type="button" id="cabinetCompletionTabToday" class="${activeTab === 'today' ? 'active' : ''}" data-cabinet-completion-tab="today" role="tab" tabindex="${activeTab === 'today' ? '0' : '-1'}" aria-selected="${activeTab === 'today' ? 'true' : 'false'}" aria-controls="cabinetCompletionDetails">Сьогодні <b>${formatCabinetPulseCount(todayCount)}</b></button>
        <button type="button" id="cabinetCompletionTabHistory" class="${activeTab === 'history' ? 'active' : ''}" data-cabinet-completion-tab="history" role="tab" tabindex="${activeTab === 'history' ? '0' : '-1'}" aria-selected="${activeTab === 'history' ? 'true' : 'false'}" aria-controls="cabinetCompletionDetails">Історія <b>${formatCabinetPulseCount(historyCount)}</b></button>
    </div>`;
}

function renderCabinetCompletionDetails() {
    const activeTab = normalizeCabinetCompletionTab();
    const todayTasks = cabinetCompletedTodayTasksList();
    const historyState = cabinetCompletionHistoryState();
    const history = historyState.items;
    const cancelledTasks = activeTab === 'history' ? cabinetList('cancelledHistory') : [];
    const tasks = activeTab === 'history' ? history : todayTasks;
    const visibleCount = cabinetCompletionVisibleCount(tasks.length);
    const visibleTasks = tasks.slice(0, visibleCount);
    const localOverflow = Math.max(0, tasks.length - visibleTasks.length);
    const historyHasMore = activeTab === 'history' && Boolean(historyState.hasMore);
    const historyLoading = activeTab === 'history' && Boolean(historyState.loading);
    const historyError = activeTab === 'history' ? historyState.error || '' : '';
    const title = activeTab === 'history' ? 'Історія' : 'Сьогодні';
    const empty = activeTab === 'history'
        ? 'Історія виконань поки порожня.'
        : 'Ще немає виконань сьогодні.';
    const rows = activeTab === 'history'
        ? groupCabinetCompletedHistoryByDay(visibleTasks).map((group, groupIndex) => {
            const day = group.day || cabinetCompletedHistoryDayMeta(null);
            return `<div class="cabinet-completion-day-divider" role="separator">${escapeHtml(day.longLabel)}</div>
                ${group.tasks.map(({ task, index }) => renderCabinetCompletionTaskRow(task, index, activeTab)).join('')}`;
        }).join('')
        : visibleTasks.map((task, index) => renderCabinetCompletionTaskRow(task, index, activeTab)).join('');
    const totalHistory = cabinetCompletionHistoryTotalCount();
    const countLabel = activeTab === 'history'
        ? `Завантажено ${formatCabinetExactCount(history.length)} із ${formatCabinetExactCount(totalHistory)}`
        : `${formatCabinetPulseCount(visibleTasks.length)} з ${formatCabinetPulseCount(tasks.length)}`;
    const footerLabel = activeTab === 'history' && historyHasMore && !localOverflow
        ? 'Завантажити ще'
        : `Показати ще · +${formatCabinetPulseCount(localOverflow)}`;
    const showFooter = activeTab === 'history'
        ? (localOverflow > 0 || historyHasMore || Boolean(historyError))
        : localOverflow > 0;
    return `<div id="cabinetCompletionDetails" class="cabinet-completion-details" data-cabinet-completion-details role="tabpanel" tabindex="0" aria-labelledby="${activeTab === 'history' ? 'cabinetCompletionTabHistory' : 'cabinetCompletionTabToday'}">
        <div class="cabinet-completion-list">
            <div class="cabinet-completion-list-head">
                <h4>${escapeHtml(title)}</h4>
                <span>${escapeHtml(countLabel)}</span>
            </div>
            ${visibleTasks.length
                ? rows
                : cancelledTasks.length ? '' : `<div class="cabinet-completion-empty">${escapeHtml(empty)}</div>`}
            ${cancelledTasks.length ? `<div class="cabinet-completion-day-divider">Нещодавно скасовані</div>
                ${cancelledTasks.map(task => `<div class="park-completed-row"><button type="button" class="cabinet-completion-row"
                    data-cabinet-task-action="open" data-task-id="${normalizeCabinetTaskId(task.id)}">
                    <span class="cabinet-completion-row-main"><b>${escapeHtml(task.title || 'Без назви')}</b>
                    <small>Скасовано</small></span>
                </button></div>`).join('')}` : ''}
            ${historyError ? `<div class="cabinet-completion-error" role="status">${escapeHtml(historyError)}</div>` : ''}
            ${historyLoading ? '<div class="cabinet-completion-loading" role="status">Завантажуємо історію…</div>' : ''}
            ${showFooter ? `<button type="button" class="cabinet-completion-all" data-cabinet-completion-all="true" ${historyLoading ? 'disabled aria-busy="true"' : ''}>${escapeHtml(historyError ? 'Повторити' : footerLabel)}</button>` : ''}
            ${activeTab !== 'history' && !showFooter ? renderCabinetBucketMore('completedToday') : ''}
        </div>
    </div>`;
}

function renderCabinetCompletionPulse() {
    const tasks = cabinetCompletedTodayTasksList();
    const historyCounts = cabinetCompletedHistoryCounts();
    const metrics = cabinetCompletedTodayMetrics(tasks);
    if (activeTab === 'myday') {
        return `<section class="cabinet-completion-pulse park-completion-board is-expanded" data-cabinet-completion-pulse aria-label="Виконано сьогодні">
            <div class="park-completion-heading">
                <h3><span aria-hidden="true">✓</span> Виконано сьогодні</h3>
                <b>${formatCabinetPulseCount(metrics.parentTasks)}</b>
            </div>
            <a href="/profile?tab=results" class="profile-task-kpi-link">КПД за задачами</a>
            ${renderCabinetCompletionTabs()}
            ${renderCabinetCompletionDetails()}
        </section>`;
    }
    const expanded = Boolean(completedDashboardExpanded);
    const hasData = tasks.length > 0 || metrics.parentTasks > 0;
    const allTimeLabel = `${formatCabinetPulseCount(Math.max(historyCounts.total, historyCounts.shown))} за весь час`;
    return `<section class="cabinet-completion-pulse ${hasData ? '' : 'is-empty'} ${expanded ? 'is-expanded' : ''}" data-cabinet-completion-pulse aria-label="Виконано">
        <div class="cabinet-completion-summary">
            <div class="cabinet-completion-head">
                <div class="cabinet-completion-title">
                    <span class="cabinet-kicker">Виконано</span>
                    <h3>${hasData ? 'Виконано сьогодні' : 'Ще немає виконань'}</h3>
                    <p>${escapeHtml(allTimeLabel)} · останні ${formatCabinetPulseCount(historyCounts.shown)} задач</p>
                </div>
            </div>
            <div class="cabinet-completion-metrics">
                <span><b>${formatCabinetPulseCount(metrics.parentTasks)}</b><small>задач</small></span>
            </div>
            <div class="cabinet-completion-actions">
                <button type="button" class="cabinet-completion-toggle" data-cabinet-completion-toggle aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="cabinetCompletionDetails">
                    ${expanded ? 'Згорнути' : 'Відкрити'}
                </button>
            </div>
        </div>
        ${expanded ? `${renderCabinetCompletionTabs()}${renderCabinetCompletionDetails()}` : ''}
    </section>`;
}

function renderCabinetCompletedTodayDashboard() {
    return renderCabinetCompletionPulse();
}

function rerenderCabinetCompletionPulse() {
    const current = document.querySelector('[data-cabinet-completion-pulse]');
    if (!current) return;
    current.outerHTML = renderCabinetCompletionPulse();
    const next = document.querySelector('[data-cabinet-completion-pulse]');
    if (!next) return;
    bindCabinetTaskActions(next);
    bindCabinetCompletionPulse(next);
    bindCabinetBucketButtons(next);
}

function rerenderCabinetCompletedTodayDashboard() {
    rerenderCabinetCompletionPulse();
}

async function loadNextCabinetCompletionHistoryPage() {
    const state = cabinetCompletionHistoryState();
    if (state.loading || !state.hasMore || !state.nextCursor) return state;
    const requestSeq = (state.requestSeq || 0) + 1;
    const scopeKey = state.scopeKey;
    const cursor = state.nextCursor;
    state.requestSeq = requestSeq;
    state.loading = true;
    state.error = '';
    rerenderCabinetCompletionPulse();
    try {
        const result = await fetchCabinetCompletionHistoryPage({ cursor, limit: state.limit || CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT });
        const current = completedDashboardHistoryState;
        if (current.requestSeq !== requestSeq || current.scopeKey !== scopeKey || normalizeCabinetCompletionTab() !== 'history') {
            if (current.requestSeq === requestSeq && current.scopeKey === scopeKey) current.loading = false;
            return current;
        }
        if (!result?.success) {
            current.loading = false;
            current.error = result?.error || 'Не вдалося завантажити історію виконань.';
            return current;
        }
        const pagination = result.pagination || {};
        current.items = mergeCabinetCompletionHistoryItems(current.items, result.items || []);
        current.nextCursor = typeof pagination.nextCursor === 'string' ? pagination.nextCursor : '';
        current.hasMore = Boolean(pagination.hasMore);
        current.limit = Number(pagination.limit || current.limit || CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT) || CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT;
        current.total = Math.max(
            Number(result.totals?.completedParentTotal || 0) || 0,
            current.total || 0,
            current.items.length
        );
        current.loading = false;
        current.error = '';
        return current;
    } catch (error) {
        const current = completedDashboardHistoryState;
        if (current.requestSeq === requestSeq && current.scopeKey === scopeKey) {
            current.loading = false;
            current.error = error?.message || 'Не вдалося завантажити історію виконань.';
        }
        return current;
    } finally {
        rerenderCabinetCompletionPulse();
    }
}

function showAllCabinetCompletionDetails() {
    completedDashboardExpanded = true;
    if (normalizeCabinetCompletionTab() === 'history') {
        const state = cabinetCompletionHistoryState();
        completedDashboardShowAll = false;
        completedDashboardHistoryVisibleCount = Math.max(CABINET_COMPLETION_ROWS_INITIAL, state.items.length);
        rerenderCabinetCompletionPulse();
        return;
    }
    completedDashboardShowAll = true;
    const tasks = cabinetCompletedTodayTasksList();
    completedDashboardVisibleCount = Math.max(CABINET_COMPLETION_ROWS_INITIAL, tasks.length);
    rerenderCabinetCompletionPulse();
}

async function showMoreCabinetCompletionDetails() {
    completedDashboardExpanded = true;
    if (normalizeCabinetCompletionTab() === 'history') {
        const state = cabinetCompletionHistoryState();
        const current = cabinetCompletionVisibleCount(state.items.length);
        if (current < state.items.length) {
            completedDashboardHistoryVisibleCount = Math.min(state.items.length, current + CABINET_COMPLETION_ROWS_BATCH);
            completedDashboardShowAll = false;
            rerenderCabinetCompletionPulse();
            return;
        }
        if (state.hasMore && !state.loading) {
            await loadNextCabinetCompletionHistoryPage();
            const nextState = cabinetCompletionHistoryState();
            completedDashboardHistoryVisibleCount = Math.min(nextState.items.length, current + CABINET_COMPLETION_ROWS_BATCH);
            completedDashboardShowAll = false;
            rerenderCabinetCompletionPulse();
            return;
        }
        completedDashboardHistoryVisibleCount = current;
        rerenderCabinetCompletionPulse();
        return;
    }
    const tasks = cabinetCompletedTodayTasksList();
    const current = cabinetCompletionVisibleCount(tasks.length);
    completedDashboardVisibleCount = Math.min(tasks.length, current + CABINET_COMPLETION_ROWS_BATCH);
    completedDashboardShowAll = completedDashboardVisibleCount >= tasks.length;
    rerenderCabinetCompletionPulse();
}

function showAllCabinetCompletedTodayDetails() {
    showMoreCabinetCompletionDetails();
}

function setCabinetCompletionTab(tab = 'today') {
    completedDashboardTab = normalizeCabinetCompletionTab(tab);
    completedDashboardExpanded = true;
    completedDashboardShowAll = false;
    if (completedDashboardTab === 'history') {
        completedDashboardHistoryVisibleCount = Math.max(CABINET_COMPLETION_ROWS_INITIAL, Number(completedDashboardHistoryVisibleCount || 0));
        cabinetCompletionHistoryState();
    } else {
        completedDashboardVisibleCount = CABINET_COMPLETION_ROWS_INITIAL;
    }
    rerenderCabinetCompletionPulse();
}

function toggleCabinetCompletionDetails() {
    completedDashboardExpanded = !completedDashboardExpanded;
    if (!completedDashboardExpanded) {
        completedDashboardShowAll = false;
        completedDashboardVisibleCount = CABINET_COMPLETION_ROWS_INITIAL;
    } else if (!completedDashboardVisibleCount || completedDashboardVisibleCount < CABINET_COMPLETION_ROWS_INITIAL) {
        completedDashboardVisibleCount = CABINET_COMPLETION_ROWS_INITIAL;
    }
    rerenderCabinetCompletionPulse();
}

function toggleCabinetCompletedTodayDetails() {
    toggleCabinetCompletionDetails();
}

function normalizedCabinetTaskToken(value, fallback = '') {
    const token = String(value ?? '').trim().toLowerCase();
    return token || fallback;
}

function cabinetTaskMode(task = {}) {
    return window.TaskUiShared?.taskMode?.(task)
        || normalizedCabinetTaskToken(task.taskMode || task.task_mode || task.mode, 'work');
}

function cabinetTaskKind(task = {}) {
    return window.TaskUiShared?.taskKind?.(task)
        || normalizedCabinetTaskToken(task.taskKind || task.task_kind || task.kind, 'action');
}

function cabinetTaskWorkflow(task = {}) {
    return window.TaskUiShared?.taskWorkflow?.(task)
        || normalizedCabinetTaskToken(task.workflowState || task.workflow_state || task.workflow, 'todo');
}

function cabinetTaskVisibility(task = {}) {
    return window.TaskUiShared?.taskVisibility?.(task)
        || normalizedCabinetTaskToken(task.visibility, cabinetTaskMode(task) === 'private' ? 'private' : 'team');
}

function cabinetTaskCategory(task = {}) {
    return normalizedCabinetTaskToken(task.category || task.taskCategory || task.task_category);
}

function cabinetTaskStatus(task = {}) {
    return normalizedCabinetTaskToken(task.status);
}

function isCabinetPersonalTask(task = {}) {
    const visibility = cabinetTaskVisibility(task);
    return cabinetTaskMode(task) === 'personal'
        || visibility === 'me_only'
        || cabinetTaskCategory(task) === 'personal';
}

function isCabinetWaitingTask(task = {}) {
    return cabinetTaskWorkflow(task) === 'waiting'
        || cabinetTaskKind(task) === 'waiting'
        || cabinetTaskStatus(task) === 'waiting'
        || task.waiting === true;
}

function isCabinetActionableTask(task = {}) {
    return !isCabinetWaitingTask(task)
        && !isCabinetIdeaTask(task)
        && !['done', 'archived', 'cancelled'].includes(cabinetTaskStatus(task));
}

function isCabinetPrivateTask(task = {}) {
    return cabinetTaskVisibility(task) === 'private' || cabinetTaskMode(task) === 'private';
}

function isCabinetIdeaTask(task = {}) {
    const category = cabinetTaskCategory(task);
    return cabinetTaskKind(task) === 'idea'
        || category === 'idea'
        || category === 'ideas'
        || category === 'improvement'
        || task.idea === true;
}

function cabinetTaskMatchesSegment(task = {}, segment = myTasksSegment) {
    switch (segment) {
        case 'personal':
            return isCabinetPersonalTask(task);
        case 'private':
            return isCabinetPrivateTask(task);
        case 'work':
            return cabinetTaskMode(task) === 'work';
        case 'actionable':
            return isCabinetActionableTask(task);
        case 'idea':
            return isCabinetIdeaTask(task);
        case 'all':
        default:
            return true;
    }
}

function cabinetSegmentCounts(tasks = cabinetList('all')) {
    return CABINET_TASK_SEGMENTS.reduce((acc, segment) => {
        acc[segment.id] = tasks.filter(task => cabinetTaskMatchesSegment(task, segment.id)).length;
        return acc;
    }, {});
}

function cabinetSegmentConfig(segment = myTasksSegment) {
    return CABINET_TASK_SEGMENTS.find(item => item.id === segment) || CABINET_TASK_SEGMENTS[0];
}

function cabinetCreateDefaultsForSegment(segment = myTasksSegment, modeOverride = '') {
    const defaults = {
        category: 'admin',
        mode: 'work',
        kind: 'action',
        visibility: 'team',
        placeholder: 'Що треба зробити?'
    };
    if (segment === 'personal' || modeOverride === 'personal') {
        return { ...defaults, category: 'personal', mode: 'personal', visibility: 'me_only', placeholder: 'Особиста задача для себе' };
    }
    if (segment === 'private' || modeOverride === 'private') {
        return { ...defaults, category: 'personal', mode: 'private', visibility: 'private', placeholder: 'Приватна задача тільки для мене' };
    }
    if (segment === 'actionable') {
        return { ...defaults, kind: 'action', placeholder: 'Що треба виконати?' };
    }
    if (segment === 'idea') {
        return { ...defaults, category: 'improvement', kind: 'idea', placeholder: 'Ідея, яку треба не загубити' };
    }
    return defaults;
}

function normalizeCabinetDuePreset(preset = 'today') {
    const raw = String(preset || 'today');
    const normalized = CABINET_DUE_PRESET_ALIASES[raw] || raw;
    return CABINET_DUE_PRESET_VALUES.includes(normalized) ? normalized : 'today';
}

function cabinetMyDayBusinessPreferenceScope() {
    const timelineScope = typeof window !== 'undefined' && window.TimelineBusinessContext?.current
        ? window.TimelineBusinessContext.current()
        : null;
    const user = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    return String(timelineScope?.apiValue || timelineScope?.key || user.defaultBusinessContext || user.default_business_context || 'default').trim() || 'default';
}

function cabinetProjectionScopeKey() {
    const user = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    const userId = String(user.id || user.user_id || currentUserId || 'anonymous').trim() || 'anonymous';
    const business = cabinetMyDayBusinessPreferenceScope().replace(/[^a-zA-Z0-9:_-]/g, '_');
    return `${userId}:${business}`;
}

function isCabinetMyDayTaskExpanded(taskId) {
    const id = normalizeCabinetTaskId(taskId);
    return Boolean(id && expandedCabinetMyDayTaskIds.has(id));
}

function toggleCabinetMyDayTaskDetails(taskId, options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) return false;
    const expanded = options.expanded ?? !expandedCabinetMyDayTaskIds.has(id);
    if (expanded) expandedCabinetMyDayTaskIds.add(id);
    else expandedCabinetMyDayTaskIds.delete(id);
    if (options.rerender === true && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        const card = options.card;
        const task = findCabinetTask(id);
        if (card?.isConnected && task && card.dataset.taskId === String(id)) {
            const markup = renderCabinetTaskCard(task, false, { surface: 'myday' });
            card.insertAdjacentHTML('beforebegin', markup);
            const updatedCard = card.previousElementSibling;
            card.remove();
            attachProfileListeners();
            updatedCard?.querySelector('[data-cabinet-task-action="toggle-my-day-details"]')?.focus({ preventScroll: true });
        }
    }
    return expandedCabinetMyDayTaskIds.has(id);
}

function cabinetDateKeyOffset(days = 0) {
    const base = new Date(`${cabinetKyivDateKey(new Date())}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + Number(days || 0));
    return base.toISOString().slice(0, 10);
}

function cabinetMonthEndDateKey() {
    const base = new Date(`${cabinetKyivDateKey(new Date())}T12:00:00Z`);
    base.setUTCMonth(base.getUTCMonth() + 1, 0);
    return base.toISOString().slice(0, 10);
}

function cabinetManualDueDateValue() {
    return document.getElementById?.('cabinetTaskDate')?.value || '';
}

function cabinetDueDateForPreset(preset = cabinetCreateDuePreset, manualDate = cabinetManualDueDateValue()) {
    const normalized = normalizeCabinetDuePreset(preset);
    if (window.TaskCreate?.dateForDuePresetValue) {
        const resolvedDate = window.TaskCreate.dateForDuePresetValue(normalized, manualDate);
        return normalized === 'custom' ? cabinetTaskDateKeyFromValue(resolvedDate) : resolvedDate;
    }
    if (normalized === 'no_date') return '';
    if (normalized === 'custom') return cabinetTaskDateKeyFromValue(manualDate);
    if (normalized === 'tomorrow') return cabinetDateKeyOffset(1);
    if (normalized === 'day_after_tomorrow') return cabinetDateKeyOffset(2);
    if (normalized === 'plus_3_days') return cabinetDateKeyOffset(3);
    if (normalized === 'month_end') return cabinetMonthEndDateKey();
    return cabinetDateKeyOffset(0);
}

function cabinetSelectedDueDate() {
    return cabinetDueDateForPreset(cabinetCreateDuePreset);
}

function setCabinetTaskComposerExpanded(expanded = true) {
    cabinetTaskComposerExpanded = Boolean(expanded);
    const form = document.getElementById('cabinetTaskComposer');
    if (!form) return;
    if (form.hasAttribute?.('data-cabinet-composer-simple')) return;
    form.classList.toggle('is-expanded', cabinetTaskComposerExpanded);
    form.classList.toggle('is-collapsed', !cabinetTaskComposerExpanded);
    form.dataset.cabinetComposerState = cabinetTaskComposerExpanded ? 'expanded' : 'collapsed';
    const advanced = document.getElementById('cabinetTaskComposerAdvanced');
    if (advanced) advanced.hidden = !cabinetTaskComposerExpanded;
    form.querySelectorAll('[data-cabinet-composer-toggle]').forEach(button => {
        button.setAttribute('aria-expanded', cabinetTaskComposerExpanded ? 'true' : 'false');
        button.textContent = cabinetTaskComposerExpanded ? 'Згорнути' : 'Більше параметрів';
    });
}
window.setCabinetTaskComposerExpanded = setCabinetTaskComposerExpanded;

function rerenderCabinetMyDaySegmentPanel() {
    const panel = document.getElementById('cabinetMyDaySegmentPanel');
    if (!panel) return false;
    const restore = window.ProfileMyDay?.preservePosition(panel.parentElement);
    panel.outerHTML = renderParkMyDayWorkspace();
    attachProfileListeners();
    restore?.();
    return true;
}

function setCabinetDuePreset(preset = 'today', options = {}) {
    cabinetCreateDuePreset = normalizeCabinetDuePreset(preset);
    const date = document.getElementById?.('cabinetTaskDate');
    if (date && cabinetCreateDuePreset !== 'custom') date.value = cabinetDueDateForPreset(cabinetCreateDuePreset);
    if (options.rerender === true) {
        rerenderCabinetMyDaySegmentPanel();
    }
    return cabinetCreateDuePreset;
}

function cabinetTaskVisibilityHint(visibility) {
    return visibility === 'team' ? '' : 'Видно власнику задачі та доданим спостерігачам.';
}

function syncCabinetTaskVisibilityHint() {
    const select = document.getElementById('cabinetTaskVisibility');
    const hint = document.getElementById('cabinetTaskVisibilityHint');
    if (select && hint) {
        hint.textContent = cabinetTaskVisibilityHint(select.value);
        hint.hidden = !hint.textContent;
    }
}

function syncCabinetTaskCreateMode() {
    const mode = document.getElementById('cabinetTaskMode')?.value || 'work';
    const visibility = document.getElementById('cabinetTaskVisibility');
    const category = document.getElementById('cabinetTaskCategory');
    if (visibility) {
        if (visibility.options?.[0]) visibility.options[0].disabled = mode !== 'work';
        visibility.value = mode === 'private' ? 'private' : (mode === 'personal' ? 'me_only' : 'team');
        syncCabinetTaskVisibilityHint();
    }
    if (category && (mode === 'personal' || mode === 'private') && category.value === 'admin') {
        category.value = 'personal';
    }
}

function validateCabinetPlainTaskTitle(title = '') {
    const normalized = String(title || '').trim();
    if (!normalized) return 'Заповніть назву задачі';
    if (normalized.length > CABINET_TASK_PLAIN_TITLE_MAX_LENGTH) {
        return `Скоротіть назву до ${CABINET_TASK_PLAIN_TITLE_MAX_LENGTH} символів.`;
    }
    return '';
}

function cabinetTaskCreateSignature(draft = {}) {
    return JSON.stringify({
        title: String(draft.title || '').trim(),
        ownerUserId: draft.ownerUserId || null,
        deadlineTime: draft.deadlineTime || '',
        durationMinutes: draft.durationMinutes || 30,
        sourceId: draft.sourceId || '',
        sourceEntityType: draft.sourceEntityType || '',
        sourceEntityId: draft.sourceEntityId || '',
        description: String(draft.description || '').trim(),
        category: String(draft.category || '').trim(),
        priority: String(draft.priority || '').trim(),
        mode: String(draft.mode || '').trim(),
        taskMode: String(draft.taskMode || '').trim(),
        structuralMode: String(draft.structuralMode || '').trim(),
        kind: String(draft.kind || '').trim(),
        visibility: String(draft.visibility || '').trim(),
        workflowState: String(draft.workflowState || '').trim(),
        duePreset: String(draft.duePreset || '').trim(),
        scheduleDate: String(draft.scheduleDate || '').trim(),
        ...(draft.dueMode === 'deadline' ? { dueMode: draft.dueMode } : {}),
        sourceType: String(draft.sourceType || '').trim(),
        sourceModule: draft.sourceModule || '',
        coAssigneeUserIds: (draft.coAssigneeUserIds || []).slice().sort((a, b) => a - b),
        ...(draft.shiftAssignment ? { shiftAssignment: draft.shiftAssignment } : {}),
        impactIds: Array.isArray(draft.impactIds) ? draft.impactIds.map(Number).filter(Number.isInteger).sort((a, b) => a - b) : [],
        allowReschedule: draft.allowReschedule !== false
    });
}

const cabinetAssignmentPickers = new WeakMap();

function readCabinetOwner(form = document.getElementById('cabinetTaskComposer')) {
    const user = AppState.currentUser || {};
    const state = cabinetAssignmentPickers.get(form);
    return state ? state.ownerId : Number(user.id || user.user_id || currentUserId);
}

function readCabinetCreateCoAssignees(form) {
    const state = cabinetAssignmentPickers.get(form);
    return state ? [...state.selected.keys()].filter(id => id !== state.ownerId) : [];
}

function bindCabinetAssignmentPicker(form) {
    const picker = form?.querySelector('[data-cabinet-assignment]');
    if (!picker || cabinetAssignmentPickers.has(form)) return;
    const visibility = form.querySelector('#cabinetTaskVisibility');
    const mode = form.querySelector('#cabinetTaskMode');
    const summary = picker.querySelector('summary');
    const search = picker.querySelector('input[type="search"]');
    const results = picker.querySelector('[data-assignment-results]');
    const status = picker.querySelector('[role="status"]');
    const shift = picker.querySelector('[data-assignment-shift]');
    const shiftDate = shift.querySelector('input');
    const shiftGroups = shift.querySelector('select');
    const confirmShift = shift.querySelector('button');
    const retryShift = shift.querySelector('[data-assignment-retry]');
    const manual = picker.querySelector('[data-assignment-manual]');
    const shiftButton = picker.querySelector('[data-assignment-shift-mode]');
    const peopleButton = picker.querySelector('[data-assignment-people-mode]');
    const morePeople = picker.querySelector('[data-assignment-more]');
    const self = readCabinetOwner(form);
    const state = { selected: new Map([[self, 'Я']]), ownerId: self, implicitSelf: true };
    cabinetAssignmentPickers.set(form, state);
    let canAssign = false;
    let requestNumber = 0;
    let scope = cabinetHrReminderScope();
    let groups = [];
    let candidates = [];
    let nextAfter = null;
    let debounce;
    const assignmentLocked = () => cabinetLeadCollaboration?.request && cabinetLeadCollaboration.composer.contains(form);

    function reset() {
        clearTimeout(debounce);
        requestNumber++;
        state.selected = new Map([[self, 'Я']]);
        state.ownerId = self;
        state.implicitSelf = true;
        state.shiftAssignment = null;
        state.needsShiftConfirmation = false;
        peopleButton.textContent = 'Люди';
        showShift(false);
        search.value = '';
        picker.open = false;
        results.replaceChildren();
        morePeople.hidden = true;
        status.textContent = '';
        renderSelection();
    }

    function sync() {
        const team = mode.value === 'work' && visibility.value === 'team';
        picker.hidden = !team;
        if (!team) reset();
    }

    function renderSelection() {
        if (state.needsShiftConfirmation) {
            summary.textContent = 'Кому · Підтвердьте склад зміни';
            return;
        }
        if (!state.selected.size) {
            summary.textContent = 'Кому · Оберіть виконавця';
            return;
        }
        const co = readCabinetCreateCoAssignees(form).map(id => state.selected.get(id));
        const parts = ['Кому · Відповідальний: ' + state.selected.get(state.ownerId)];
        if (co.length) parts.push('Співвиконавці: ' + co.slice(0, 2).join(', ') + (co.length > 2 ? ' +' + (co.length - 2) : ''));
        if (state.shiftAssignment) parts.push(shiftGroups.selectedOptions[0].textContent, state.shiftAssignment.date);
        summary.textContent = parts.join(' · ');
    }

    function showShift(visible) {
        shift.hidden = !visible;
        const preview = !visible && Boolean(state.shiftAssignment);
        manual.hidden = !preview;
        search.closest('label').hidden = visible || preview;
        peopleButton.setAttribute('aria-pressed', String(!visible));
        shiftButton.setAttribute('aria-pressed', String(visible));
        morePeople.hidden = visible || preview || !nextAfter;
    }

    function showShiftGroup() {
        const group = groups.find(item => item.key === shiftGroups.value);
        const available = group?.users.length || 0;
        confirmShift.disabled = !available || group.unavailableCount > 0 || available > 101;
        status.textContent = group?.unavailableCount
            ? 'Частині зміни призначити задачу неможливо. Оберіть людей вручну.'
            : available > 101 ? 'Зміна перевищує ліміт виконавців.'
                : available ? 'Побачать задачу: ' + group.users.map(person => person.label).join(', ') : 'На цю дату виконавців немає.';
    }

    async function loadShift() {
        const request = ++requestNumber;
        const context = cabinetHrReminderScope();
        if (state.shiftAssignment) state.needsShiftConfirmation = true;
        renderSelection();
        const previous = shiftGroups.value || state.shiftAssignment?.group;
        groups = [];
        shiftGroups.replaceChildren();
        results.replaceChildren();
        confirmShift.disabled = true;
        retryShift.hidden = true;
        peopleButton.textContent = 'Люди';
        if (!shiftDate.value) {
            status.textContent = 'Оберіть дату зміни.';
            return;
        }
        status.textContent = 'Завантаження зміни…';
        const params = new URLSearchParams({ date: shiftDate.value });
        const current = () => request === requestNumber && context === cabinetHrReminderScope() && form.isConnected && !shift.hidden;
        let data;
        try {
            data = await apiGetScopedJson('/tasks/shift-assignees?' + params);
            if (!Array.isArray(data?.groups)) throw new Error('Invalid shift roster');
        } catch (error) {
            if (!current()) return;
            const forbidden = error.status === 403;
            status.textContent = forbidden ? 'Немає доступу до графіка.' : 'Не вдалося завантажити графік. Спробуйте ще раз.';
            retryShift.hidden = forbidden;
            peopleButton.textContent = 'Обрати людей';
            return;
        }
        if (!current()) return;
        groups = data.groups;
        for (const group of groups) shiftGroups.add(new Option(group.label, group.key));
        if (groups.some(group => group.key === previous)) shiftGroups.value = previous;
        showShiftGroup();
    }

    function selectPeopleManually() {
        if (state.shiftAssignment && state.needsShiftConfirmation) {
            state.selected.clear();
            state.ownerId = null;
        }
        state.shiftAssignment = null;
        state.needsShiftConfirmation = false;
        peopleButton.textContent = 'Люди';
        showShift(false);
        renderSelection();
        renderCandidates([]);
        search.focus();
        void load();
    }
    manual.addEventListener('click', selectPeopleManually);
    retryShift.addEventListener('click', loadShift);
    peopleButton.addEventListener('click', () => {
        if (!state.shiftAssignment || state.needsShiftConfirmation) {
            selectPeopleManually();
            return;
        }
        showShift(false);
        renderCandidates([]);
        status.textContent = 'Склад прив’язаний до графіка.';
    });
    shiftButton.addEventListener('click', () => {
        clearTimeout(debounce);
        showShift(true);
        state.needsShiftConfirmation = true;
        shiftDate.value = state.shiftAssignment?.date || form.querySelector('#cabinetTaskDate').value || '';
        shiftDate.focus();
        void loadShift();
    });
    shiftDate.addEventListener('change', loadShift);
    shiftGroups.addEventListener('change', () => {
        state.needsShiftConfirmation = true;
        results.replaceChildren();
        renderSelection();
        showShiftGroup();
    });
    confirmShift.addEventListener('click', () => {
        const group = groups.find(item => item.key === shiftGroups.value);
        if (confirmShift.disabled || !group) return;
        const previousOwner = readCabinetOwner(form);
        const participants = group.users.map(person => [Number(person.id), Number(person.id) === self ? 'Я' : person.label]);
        state.selected = new Map(participants);
        state.ownerId = state.selected.has(previousOwner) ? previousOwner : participants[0][0];
        state.implicitSelf = false;
        state.shiftAssignment = { group: group.key, date: shiftDate.value };
        state.needsShiftConfirmation = false;
        renderSelection();
        renderCandidates([]);
        status.textContent = 'Зміна підтверджена. За потреби позначте іншого відповідального.';
    });
    state.reloadShift = () => {
        picker.open = true;
        showShift(true);
        shiftDate.value = state.shiftAssignment?.date || shiftDate.value;
        void loadShift();
    };

    function renderCandidates(people) {
        const rows = new Map(state.selected);
        const details = new Map();
        for (const person of people) {
            const id = Number(person.id);
            if (!(id > 0)) continue;
            rows.set(id, id === self ? 'Я' : window.TaskUiShared.taskPersonLabel(person));
            details.set(id, person);
        }
        if (shift.hidden && !state.shiftAssignment && matchesSelfSearch()) rows.set(self, 'Я');
        results.replaceChildren();
        const single = cabinetLeadCollaboration?.composer.contains(form);
        const primary = readCabinetOwner(form);
        const labelCounts = new Map();
        for (const label of rows.values()) labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
        for (const [id, label] of rows) {
            const row = document.createElement('div');
            row.className = 'cabinet-assignment-row';
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.disabled = !shift.hidden || Boolean(state.shiftAssignment);
            toggle.textContent = label;
            const person = details.get(id);
            const subtitleValues = [person?.positionLabel, person?.departmentLabel];
            if (labelCounts.get(label) > 1) subtitleValues.unshift(person?.username || `№${id}`);
            const subtitleText = subtitleValues.filter(Boolean).join(' · ');
            if (subtitleText) {
                const subtitle = document.createElement('small');
                subtitle.textContent = subtitleText;
                toggle.append(subtitle);
            }
            toggle.setAttribute('aria-pressed', String(state.selected.has(id)));
            toggle.addEventListener('click', () => {
                if (!shift.hidden || state.shiftAssignment || assignmentLocked()) return;
                state.shiftAssignment = null;
                state.needsShiftConfirmation = false;
                if (single || (state.implicitSelf && id !== self)) {
                    state.selected.clear();
                    state.ownerId = null;
                }
                state.implicitSelf = false;
                if (state.selected.has(id)) {
                    state.selected.delete(id);
                    if (state.ownerId === id) state.ownerId = state.selected.keys().next().value ?? null;
                } else if (state.selected.has(id) || state.selected.size < 101) {
                    state.selected.set(id, label);
                    state.ownerId ??= id;
                }
                else {
                    status.textContent = 'Можна вибрати до 101 виконавця.';
                    return;
                }
                renderSelection();
                renderCandidates(people);
                (results.querySelector('[data-assignment-user="' + id + '"]') || search).focus();
            });
            toggle.dataset.assignmentUser = String(id);
            row.append(toggle);
            if (state.selected.has(id) && !single) {
                const owner = document.createElement('button');
                owner.type = 'button';
                owner.className = 'cabinet-assignment-primary';
                owner.disabled = primary === id;
                owner.textContent = owner.disabled ? 'Відповідальний' : 'Зробити відповідальним';
                owner.setAttribute('aria-label', (owner.disabled ? 'Відповідальний: ' : 'Зробити відповідальним: ') + label);
                owner.addEventListener('click', () => {
                    if (assignmentLocked()) return;
                    state.ownerId = id;
                    renderSelection();
                    renderCandidates(people);
                    if (!manual.hidden) manual.focus();
                    else if (shift.hidden) results.querySelector('[data-assignment-user="' + id + '"]')?.focus();
                    else confirmShift.focus();
                });
                row.append(owner);
            }
            results.append(row);
        }
    }

    function matchesSelfSearch() {
        const query = search.value.trim().toLocaleLowerCase('uk');
        const user = AppState.currentUser || {};
        return !query || query === 'я' || [user.name, user.username, String(self)].some(value =>
            String(value || '').toLocaleLowerCase('uk').includes(query));
    }

    async function load(append = false) {
        if (!shift.hidden || state.shiftAssignment || assignmentLocked()) return;
        const request = ++requestNumber;
        const context = cabinetHrReminderScope();
        const current = () => request === requestNumber && form.isConnected && context === cabinetHrReminderScope()
            && shift.hidden && !assignmentLocked();
        if (!current()) return;
        status.textContent = 'Завантаження…';
        try {
            const access = await apiGetScopedJson('/tasks/permissions');
            if (!current()) return;
            const permissions = access?.permissions;
            const canCreate = access?.capabilities?.create?.allowed ?? permissions?.canCreateTasks;
            const pack = document.querySelector('[data-cabinet-operation-pack]');
            if (pack) pack.hidden = !canCreate || Boolean(cabinetLeadCollaboration?.composer.contains(form));
            if (canCreate === false) form.querySelectorAll('[data-cabinet-create-action]').forEach(button => { button.disabled = true; });
            canAssign = Boolean(permissions?.canAssignAnyone || ['all', 'department'].includes(permissions?.taskVisibility));
            shiftButton.hidden = !canAssign || Boolean(cabinetLeadCollaboration?.composer.contains(form));
            const query = new URLSearchParams({ q: search.value.trim() });
            if (append && nextAfter) query.set('after', nextAfter);
            const data = canAssign ? await apiGetScopedJson('/tasks/owners?' + query) : { users: [] };
            if (!current()) return;
            if (!Array.isArray(data?.users)) throw new Error('Owner directory unavailable');
            const assignment = cabinetCreateAssignment;
            if (state.implicitSelf && assignment) {
                const matches = person => String(person.id) === String(assignment.ownerUserId)
                    || (assignment.assignee && [person.name, person.username, person.label].includes(assignment.assignee));
                let preferred = data.users.find(matches);
                const knownAssignee = assignment.ownerUserId || assignment.assignee;
                if (!preferred && canAssign && knownAssignee && !search.value.trim()) {
                    const lookup = new URLSearchParams({ q: knownAssignee });
                    const exact = await apiGetScopedJson('/tasks/owners?' + lookup);
                    if (!current()) return;
                    preferred = exact?.users?.find(matches);
                }
                if (preferred && state.implicitSelf) {
                    state.ownerId = Number(preferred.id);
                    state.selected = new Map([[state.ownerId, state.ownerId === self ? 'Я' : window.TaskUiShared.taskPersonLabel(preferred)]]);
                    state.implicitSelf = false;
                    renderSelection();
                }
            }
            candidates = append ? [...candidates, ...data.users] : data.users;
            nextAfter = data.nextAfter || null;
            morePeople.hidden = !nextAfter;
            renderCandidates(candidates);
            status.textContent = canAssign && search.value.trim() && candidates.length === 0 && !matchesSelfSearch() ? 'Нікого не знайдено.' : '';
        } catch (error) {
            if (current()) status.textContent = 'Не вдалося завантажити виконавців. Повторіть пошук.';
        }
    }

    search.addEventListener('input', () => {
        requestNumber++;
        morePeople.hidden = true;
        clearTimeout(debounce);
        debounce = setTimeout(load, 200);
    });
    morePeople.addEventListener('click', () => { if (nextAfter) void load(true); });
    picker.addEventListener('toggle', () => {
        if (!picker.open) return;
        if (!shift.hidden) return;
        if (state.shiftAssignment) {
            manual.focus();
            return;
        }
        search.focus();
        void load();
    });
    picker.addEventListener('keydown', event => {
        if (event.key === 'Escape' && picker.open) {
            event.stopPropagation();
            picker.open = false;
            summary.focus();
        }
        if (event.key === 'Enter' && event.target === search) event.preventDefault();
    });
    form.addEventListener('reset', reset);
    visibility.addEventListener('change', sync);
    mode.addEventListener('change', sync);
    form.closest('.park-composer')?.addEventListener('toggle', event => {
        if (event.target !== form.closest('.park-composer') || !event.target.open) return;
        if (scope !== cabinetHrReminderScope()) {
            scope = cabinetHrReminderScope();
            reset();
        }
        void load();
    });
    sync();
    if (form.closest('.park-composer')?.open) void load();
}

function cabinetTaskCreateRetryBlockMessage(signature = '') {
    if (!cabinetTaskCreateAttempt || cabinetTaskCreateAttempt.signature !== signature) return '';
    if (cabinetTaskCreateAttempt.status !== 'unknown') return '';
    if (cabinetTaskCreateAttempt.idempotencyKey) return '';
    const ageMs = Date.now() - Number(cabinetTaskCreateAttempt.createdAt || 0);
    if (ageMs > CABINET_TASK_CREATE_UNKNOWN_TTL_MS) {
        cabinetTaskCreateAttempt = null;
        return '';
    }
    return 'Попередній запит із таким самим текстом ще не підтверджено. Щоб уникнути дубля, змініть текст або оновіть список перед повтором.';
}

function readCabinetTaskCreateIdempotencyStore() {
    try {
        if (typeof window === 'undefined' || !window.sessionStorage) return {};
        const parsed = JSON.parse(window.sessionStorage.getItem(CABINET_TASK_CREATE_IDEMPOTENCY_STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function writeCabinetTaskCreateIdempotencyStore(store = {}) {
    try {
        if (typeof window === 'undefined' || !window.sessionStorage) return;
        window.sessionStorage.setItem(CABINET_TASK_CREATE_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(store || {}));
    } catch {}
}

function randomCabinetTaskCreateIdempotencyKey() {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
        return `direct_${window.crypto.randomUUID()}`;
    }
    return `direct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function cabinetTaskCreateIdempotencyKeyForSignature(signature = '') {
    const normalized = String(signature || '').trim();
    if (!normalized) return '';
    if (cabinetTaskCreateAttempt?.signature === normalized && cabinetTaskCreateAttempt.idempotencyKey) {
        return cabinetTaskCreateAttempt.idempotencyKey;
    }
    const store = readCabinetTaskCreateIdempotencyStore();
    const existing = store[normalized];
    const ageMs = Date.now() - Number(existing?.createdAt || 0);
    if (existing?.idempotencyKey && ageMs >= 0 && ageMs <= CABINET_TASK_CREATE_UNKNOWN_TTL_MS) {
        return String(existing.idempotencyKey);
    }
    const idempotencyKey = randomCabinetTaskCreateIdempotencyKey();
    store[normalized] = { idempotencyKey, createdAt: Date.now() };
    writeCabinetTaskCreateIdempotencyStore(store);
    return idempotencyKey;
}

function rememberCabinetTaskCreateAttempt(signature = '', status = 'in_flight', idempotencyKey = '') {
    cabinetTaskCreateAttempt = { signature, status, idempotencyKey, createdAt: Date.now() };
    if (signature && idempotencyKey) {
        const store = readCabinetTaskCreateIdempotencyStore();
        store[signature] = { idempotencyKey, createdAt: cabinetTaskCreateAttempt.createdAt };
        writeCabinetTaskCreateIdempotencyStore(store);
    }
}

function clearCabinetTaskCreateAttempt(signature = '', idempotencyKey = '') {
    if (signature) {
        const store = readCabinetTaskCreateIdempotencyStore();
        if (!store[signature] || !idempotencyKey || store[signature].idempotencyKey === idempotencyKey) {
            delete store[signature];
            writeCabinetTaskCreateIdempotencyStore(store);
        }
    }
    if (!signature || cabinetTaskCreateAttempt?.signature === signature) cabinetTaskCreateAttempt = null;
}

function setCabinetTaskCreateBusy(busy = false, form = document.getElementById('cabinetTaskComposer')) {
    if (form) form.dataset.cabinetCreateBusy = busy ? 'true' : 'false';
    form?.querySelectorAll?.('[data-cabinet-create-action], [data-task-ai-draft-submit-intent]')
        .forEach(button => {
            button.disabled = Boolean(busy);
            button.setAttribute('aria-busy', busy ? 'true' : 'false');
        });
}

function setCabinetTaskComposerStatus(message = '', type = '', root = document) {
    const status = root === document ? document.getElementById('cabinetTaskComposerStatus') : root.querySelector('#cabinetTaskComposerStatus');
    const node = status || root.querySelector?.('[data-task-ai-draft-status]');
    if (!node) return;
    node.textContent = message;
    node.className = `task-ai-draft-status cabinet-task-composer-status ${type || ''}`.trim();
}

function setCabinetTaskTitleGuidance(message = '', type = '') {
    const guidance = document.getElementById('cabinetTaskTitleGuidance');
    const input = document.getElementById('cabinetTaskTitle');
    if (guidance) {
        guidance.textContent = message;
        guidance.className = `cabinet-task-title-guidance ${type || ''}`.trim();
    }
    input?.setAttribute?.('aria-invalid', type === 'error' ? 'true' : 'false');
}

function autoGrowCabinetTaskInput(input = document.getElementById('cabinetTaskTitle')) {
    if (!input || String(input.tagName || '').toLowerCase() !== 'textarea') return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(input.scrollHeight || 0, 46), 180)}px`;
}

function readCabinetAiDraft() {
    const kind = document.getElementById('cabinetTaskKind')?.value || 'action';
    const selectedMode = document.getElementById('cabinetTaskMode')?.value || cabinetCreateDefaultsForSegment(myTasksSegment).mode;
    const selectedDate = document.getElementById('cabinetTaskDate')?.value || '';
    return {
        title: document.getElementById('cabinetTaskTitle')?.value.trim() || '',
        description: document.getElementById('cabinetTaskDetails')?.value.trim() || '',
        category: document.getElementById('cabinetTaskCategory')?.value || cabinetCreateDefaultsForSegment(myTasksSegment, selectedMode).category,
        priority: readCabinetCreatePriority(),
        taskType: 'human',
        mode: 'simple',
        structuralMode: 'simple',
        taskMode: selectedMode,
        kind,
        taskKind: kind,
        visibility: document.getElementById('cabinetTaskVisibility')?.value || (selectedMode === 'private' ? 'private' : (selectedMode === 'personal' ? 'me_only' : 'team')),
        workflowState: kind === 'waiting' ? 'waiting' : 'inbox',
        duePreset: cabinetCreateDuePreset,
        scheduleDate: selectedDate,
        durationMinutes: 30,
        scheduleSlot: 'morning',
        ownerUserId: readCabinetOwner(),
        sourceType: 'manual',
        sourceModule: 'profile_my_cabinet',
        sourceSurface: 'profile_my_cabinet',
        scheduleConfirmed: cabinetCreateDuePreset !== 'no_date',
        allowReschedule: document.getElementById('cabinetTaskAllowReschedule')?.checked !== false,
        captureIntent: { waiting: kind === 'waiting' }
    };
}

function applyCabinetAiDraftField(field, value) {
    if (field === 'title') {
        const input = document.getElementById('cabinetTaskTitle');
        if (input) input.value = String(value || '');
        return;
    }
    if (field === 'description') {
        const textarea = document.getElementById('cabinetTaskDetails');
        if (textarea) textarea.value = String(value || '');
        return;
    }
    if (field === 'scheduleDate') {
        const input = document.getElementById('cabinetTaskDate');
        const date = String(value || '').trim();
        if (input) input.value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
        setCabinetDuePreset(date ? 'custom' : 'no_date');
        return;
    }
    if (field === 'priority') {
        setCabinetCreatePriority(String(value || 'normal'));
        return;
    }
}

function focusCabinetAiDraftField(field) {
    const map = {
        title: 'cabinetTaskTitle',
        description: 'cabinetTaskDetails',
        mode: 'cabinetTaskMode',
        scheduleDate: 'cabinetTaskDate',
        priority: 'cabinetTaskPriority'
    };
    if (['description', 'mode', 'priority'].includes(field)) {
        setCabinetTaskComposerExpanded(true);
        const details = document.querySelector('.park-composer-options');
        if (details) details.open = true;
    }
    document.getElementById(map[field])?.focus();
}

function formatCabinetPulseCount(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n > 99) return '99+';
    return String(Math.floor(n));
}

function formatCabinetExactCount(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0';
    return String(Math.floor(n));
}

function taskModeLabel(task) {
    const mode = cabinetTaskMode(task);
    return { work: 'Робоча', personal: 'Особиста', private: 'Приватна', system: 'Системна' }[mode] || mode;
}

function taskKindLabel(task) {
    const kind = cabinetTaskKind(task);
    return {
        action: 'Дія',
        reminder: 'Нагадування',
        followup: 'Дотиск',
        deep_work: 'Глибока робота',
        checklist: 'Чеклист',
        routine: 'Рутина',
        waiting: 'Чекаю',
        idea: 'Ідея',
        decision: 'Рішення'
    }[kind] || kind;
}

function normalizeCabinetTaskDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function sameCalendarDay(a, b) {
    return a && b
        && a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function getCabinetTaskDueState(task, dueValue) {
    const now = new Date();
    const workflow = task?.workflowState || task?.workflow_state || '';
    const kind = task?.taskKind || task?.task_kind || '';
    const snoozedUntil = normalizeCabinetTaskDate(task?.snoozedUntil || task?.snoozed_until);
    if (snoozedUntil && snoozedUntil > now) {
        return {
            key: 'snoozed',
            label: 'Відкладено',
            detail: `до ${snoozedUntil.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
        };
    }
    if (workflow === 'waiting' || kind === 'waiting') {
        return { key: 'waiting', label: 'Чекаю', detail: 'потрібен наступний сигнал' };
    }
    const dueDate = normalizeCabinetTaskDate(dueValue);
    if (!dueDate) return { key: 'none', label: 'Без дати', detail: 'можна спланувати пізніше' };

    const todayKey = cabinetKyivDateKey(now);
    const dueKey = window.TaskUiShared?.taskDueDate(task) || cabinetTaskDateKeyFromValue(dueValue);
    const daysUntilDue = (Date.parse(dueKey) - Date.parse(todayKey)) / 86400000;
    if (daysUntilDue < 0) return { key: 'overdue', label: 'Прострочено', detail: formatDate(dueDate) };
    if (daysUntilDue === 0) return { key: 'today', label: 'Сьогодні', detail: formatDate(dueDate) };
    if (daysUntilDue === 1) return { key: 'tomorrow', label: 'Завтра', detail: formatDate(dueDate) };
    return { key: 'planned', label: 'Заплановано', detail: formatDate(dueDate) };
}

function getCabinetTaskRelationLabel(task) {
    const current = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    const currentId = Number(current.id || current.user_id || 0);
    const ownerId = Number(task?.ownerUserId || task?.owner_user_id || task?.assignedUserId || task?.assigned_user_id || 0);
    const creatorId = Number(task?.createdByUserId || task?.created_by_user_id || task?.creatorUserId || task?.creator_user_id || 0);
    const mode = task?.taskMode || task?.task_mode || 'work';
    if (currentId && ownerId === currentId && creatorId === currentId && (mode === 'personal' || mode === 'private')) return 'Собі';
    if (currentId && ownerId === currentId && creatorId && creatorId !== currentId) return 'Мені';
    if (currentId && creatorId === currentId && ownerId && ownerId !== currentId) return 'Я поставив';
    return '';
}

function renderCabinetSnoozeMenu(taskIdAttr) {
    const options = [
        ['15', '15 хв'],
        ['60', '1 год'],
        ['240', '4 год'],
        ['1440', 'Завтра'],
        ['custom', 'Інше...']
    ];
    return `
        <div class="cabinet-snooze-menu" role="menu" hidden>
            ${options.map(([minutes, label]) => `<button type="button" role="menuitem" data-cabinet-task-action="snooze" data-task-id="${taskIdAttr}" data-minutes="${minutes}" ${taskIdAttr ? '' : 'disabled'}>${escapeHtml(label)}</button>`).join('')}
        </div>`;
}

function renderCabinetTaskPriorityControl(task = {}, taskIdAttr = '', canEdit = true) {
    const selected = normalizeCabinetPriority(task.priority || 'normal');
    return `<select class="cabinet-task-priority-select cabinet-task-priority-select--${escapeHtml(selected)}" data-cabinet-task-priority-select data-task-id="${taskIdAttr}" aria-label="Пріоритет задачі" ${taskIdAttr && canEdit ? '' : 'disabled'}>
        ${CABINET_TASK_PRIORITIES.map(item => `<option value="${item.value}" ${item.value === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
    </select>`;
}

function renderCabinetTaskSoundControls() {
    const prefs = normalizeCabinetTaskSoundSettings(cabinetTaskSoundSettings);
    return `
        <div class="cabinet-task-sound-controls" data-cabinet-task-sound-controls aria-label="Звук задач">
            <label class="cabinet-task-sound-toggle">
                <input type="checkbox" data-cabinet-task-sound-toggle ${prefs.enabled ? 'checked' : ''}>
                <span>Звук задач</span>
            </label>
            <label class="cabinet-task-sound-field">
                <span>Гучність</span>
                <input type="range" min="0" max="1" step="0.05" value="${prefs.volume}" data-cabinet-task-sound-volume>
            </label>
            <label class="cabinet-task-sound-field">
                <span>Тема</span>
                <select data-cabinet-task-sound-theme>
                    ${CABINET_TASK_SOUND_THEMES.map(theme => `<option value="${theme.value}" ${theme.value === prefs.theme ? 'selected' : ''}>${escapeHtml(theme.label)}</option>`).join('')}
                </select>
            </label>
            <button type="button" data-cabinet-task-sound-test>Тест</button>
        </div>`;
}

function renderCabinetMyDaySoundSettingsAction() {
    return `<button type="button"
        class="cabinet-day-action cabinet-day-action--settings"
        data-cabinet-my-day-sound-settings
        aria-haspopup="dialog"
        aria-label="Налаштувати звук задач"
        title="Налаштувати звук задач">Звук</button>`;
}

function openCabinetMyDaySoundSettings(button) {
    const content = `<div class="cabinet-sound-settings-menu">${renderCabinetTaskSoundControls()}</div>`;
    const root = window.TaskUI?.openActionMenu?.(button, content, { title: 'Звук задач' });
    if (root) bindCabinetTaskSoundControls(root);
}

function cabinetControlMeta(task = {}) {
    const value = task.controlMeta || task.control_meta || {};
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function cabinetTaskAllowsReschedule(task = {}) {
    const meta = cabinetControlMeta(task);
    const explicitFalse = value => value === false || value === 'false' || value === '0' || value === 0 || value === 'off' || value === 'no';
    return !explicitFalse(task.canReschedule)
        && !explicitFalse(task.allowReschedule)
        && !explicitFalse(meta.canReschedule)
        && !explicitFalse(meta.allowReschedule)
        && !explicitFalse(meta.rescheduleAllowed);
}

function renderCabinetRescheduleMenu(taskIdAttr) {
    const options = [
        ['today', 'Сьогодні'],
        ['tomorrow', 'Завтра'],
        ['day_after', 'Післязавтра'],
        ['custom', 'Обрати дату']
    ];
    return `
        <div class="cabinet-snooze-menu cabinet-reschedule-menu" role="menu" hidden>
            ${options.map(([option, label]) => `<button type="button" role="menuitem" data-cabinet-task-action="reschedule-overdue" data-task-id="${taskIdAttr}" data-reschedule-option="${option}" ${taskIdAttr ? '' : 'disabled'}>${escapeHtml(label)}</button>`).join('')}
        </div>`;
}

function renderCabinetDueBadge(task = {}, taskIdAttr = '', dueState = {}, options = {}) {
    const label = `${dueState.label || ''}${dueState.detail ? ` · ${dueState.detail}` : ''}`;
    const className = `cabinet-task-due-badge cabinet-task-due-badge--${escapeHtml(dueState.key || 'none')}`;
    if (dueState.key !== 'overdue' || !taskIdAttr || options.suppressOverdueRescheduleMenu === true) {
        return `<span class="${className}">${escapeHtml(label)}</span>`;
    }
    const canReschedule = cabinetTaskAllowsReschedule(task);
    return `<span class="cabinet-reschedule-wrap">
        <button type="button" class="${className} cabinet-task-due-action" data-cabinet-task-action="reschedule-overdue-menu" data-task-id="${taskIdAttr}" aria-haspopup="menu" aria-expanded="false" ${canReschedule ? '' : 'disabled'} title="${canReschedule ? 'Перенести прострочену задачу' : 'Перенесення вимкнено для цієї задачі'}">${escapeHtml(label)}</button>
        ${canReschedule ? renderCabinetRescheduleMenu(taskIdAttr) : ''}
    </span>`;
}

function cabinetTaskMoveToTodayState(task = {}, dueState = null) {
    const taskId = Number(task.id || task.taskId || task.task_id || 0);
    const state = dueState || getCabinetTaskDueState(task, cabinetTaskDueValue(task));
    const status = String(task.status || '').toLowerCase();
    if (!Number.isInteger(taskId) || taskId <= 0) {
        return { canMove: false, reason: 'Не вдалося визначити задачу', key: state?.key || 'unknown' };
    }
    if (['done', 'cancelled', 'archived'].includes(status)) {
        return { canMove: false, reason: 'Закриті задачі не переносяться', key: state?.key || 'closed' };
    }
    if (!cabinetTaskAllowsReschedule(task)) {
        return { canMove: false, reason: 'Перенесення вимкнено для цієї задачі', key: state?.key || 'locked' };
    }
    if (state?.key === 'today') {
        return { canMove: false, reason: 'Ця задача вже у Мій день', key: 'today' };
    }
    if (state?.key === 'none') {
        return { canMove: false, reason: 'Задача без дати вже входить у денний зріз', key: 'none' };
    }
    return { canMove: true, reason: '', key: state?.key || 'unknown' };
}

function cabinetTaskCanMoveToToday(task = {}, dueState = null) {
    return cabinetTaskMoveToTodayState(task, dueState).canMove;
}

function renderCabinetMoveTodayAction(task = {}, taskIdAttr = '', dueState = {}) {
    if (!taskIdAttr || !cabinetTaskCanMoveToToday(task, dueState)) return '';
    return `<button type="button" class="cabinet-task-move-today" data-cabinet-task-action="move-to-today" data-task-id="${taskIdAttr}" title="Перенести задачу у Мій день">На сьогодні</button>`;
}

function renderCabinetTaskMoreAction(taskIdAttr = '', iconOnly = false) {
    if (!taskIdAttr) return '';
    const icon = '<svg class="cabinet-task-control-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="19" cy="12" r="1.75"/></svg>';
    return `<button type="button" class="cabinet-task-more" data-cabinet-task-action="more" data-task-id="${taskIdAttr}" aria-haspopup="dialog" aria-label="Більше дій"${iconOnly ? ' title="Більше дій"' : ''}>${iconOnly ? icon : '...'}</button>`;
}

function cabinetTaskUpdatePayload(task = {}, patch = {}) {
    return {
        title: task.title || 'Без назви',
        description: task.description || '',
        date: task.date || null,
        status: task.status || 'todo',
        priority: task.priority || 'normal',
        assigned_to: task.assigned_to || task.assignedTo || null,
        owner: task.owner || task.assigned_to || task.assignedTo || null,
        owner_user_id: task.ownerUserId || task.owner_user_id || task.assignedUserId || task.assigned_user_id || null,
        category: cabinetTaskCategory(task) || 'personal',
        subcategory: task.subcategory || null,
        task_type: task.taskType || task.task_type || 'human',
        task_mode: cabinetTaskMode(task),
        task_kind: cabinetTaskKind(task),
        visibility: cabinetTaskVisibility(task),
        workflow_state: cabinetTaskWorkflow(task),
        deadline: task.deadline || null,
        remind_at: task.remindAt || task.remind_at || null,
        pack_status: task.packStatus || task.pack_status || null,
        sourceSurface: 'profile_my_cabinet',
        ...patch
    };
}

async function updateCabinetTaskFields(taskId, patch = {}, options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) throw new Error('Invalid task id');
    const task = options.task || findCabinetTask(id) || {};
    const result = await apiPut(`/tasks/${id}`, cabinetTaskUpdatePayload(task, patch));
    if (!result?.success) throw new Error(result?.error || 'Task update failed');
    notifyTaskWidgetsChanged({ action: options.action || 'task_update', taskId: id });
    if (typeof showNotification === 'function' && options.notify !== false) {
        showNotification(options.message || 'Задачу оновлено', 'success');
    }
    await refreshMyCabinetTab();
    return result.task || result;
}

async function submitMyDayTaskAction(task, kind, fields, operationId) {
    const id = normalizeCabinetTaskId(task?.id);
    const version = Number(task?.version);
    if (!id || !Number.isSafeInteger(version) || version < 1) {
        throw Object.assign(new Error('Версію задачі не підтверджено. Перевірте актуальні дані.'), { status: 409 });
    }
    const body = { ...fields, version, sourceSurface: 'profile_my_cabinet', myDayOperationId: operationId };
    const path = '/tasks/' + id;
    const result = kind === 'editor' ? await apiPut(path, body)
        : await apiPost(path + (kind === 'complete' ? '/complete' : '/reschedule'), body);
    if (!result?.success) {
        const status = Number(result?.status) || null;
        throw Object.assign(new Error(result?.error || 'Не вдалося зберегти задачу.'), {
            status, outcomeUnknown: !status || status >= 500
        });
    }
    onMyDayTaskActionConfirmed(kind, id);
    return result.task || result;
}

function onMyDayTaskActionConfirmed(kind, id) {
    const actions = { editor: 'task_update', complete: 'task_status', cancel: 'task_status', schedule: 'task_reschedule' };
    const status = { complete: 'done', cancel: 'cancelled' }[kind];
    notifyTaskWidgetsChanged({ action: actions[kind], taskId: id, ...(status && { status }) });
    void refreshMyCabinetTab({ force: true, silent: true }).catch(error => console.error('My Day projection refresh', error));
}

function cabinetTaskMoveTargets(task = {}) {
    const taskId = Number(task.id || task.taskId || task.task_id || 0);
    const dueState = getCabinetTaskDueState(task, cabinetTaskDueValue(task));
    const canMove = cabinetTaskMoveToTodayState(task, dueState).canMove;
    const canReschedule = cabinetTaskAllowsReschedule(task) && taskId > 0;
    const hasFixedSchedule = Boolean(task.scheduledStartAt || task.scheduled_start_at || task.schedule?.startAt);
    return [
        { id: 'today', label: 'Сьогодні', detail: 'перенести у головну зону дня', enabled: canMove },
        { id: 'tomorrow', label: 'Завтра', detail: 'перепланувати на завтра', enabled: canReschedule },
        { id: 'snooze_hour', label: 'Відкласти... +1 год', detail: 'через наявний snooze', enabled: canReschedule },
        { id: 'snooze_custom', label: 'Відкласти... інша дата', detail: 'обрати дату вручну', enabled: canReschedule },
        { id: 'no_date', label: 'Без дати', detail: hasFixedSchedule ? 'недоступно для задачі зі слотом' : 'прибрати дату і дедлайн', enabled: canReschedule && !hasFixedSchedule }
    ];
}

function renderCabinetMoveMenuItems(task = {}) {
    const taskId = Number(task.id || task.taskId || task.task_id || 0);
    const attrs = target => ({
        'data-cabinet-task-action': 'move-target',
        'data-cabinet-move-target': target.id,
        'data-task-id': taskId
    });
    return window.TaskUI?.renderMenuItems(cabinetTaskMoveTargets(task).map(target => ({
        label: target.label,
        detail: target.detail,
        disabled: target.enabled === false,
        tone: target.id === 'today' ? 'primary' : '',
        attrs: attrs(target)
    }))) || '';
}

function openCabinetTaskActionMenu(button) {
    const taskId = normalizeCabinetTaskId(button?.dataset?.taskId);
    const task = findCabinetTask(taskId) || {};
    const menuHtml = renderCabinetMoveMenuItems(task);
    const root = window.TaskUI?.openActionMenu(button, menuHtml, { title: 'Дії із задачею' });
    root?.querySelectorAll('[data-cabinet-task-action]').forEach(actionButton => {
        actionButton.addEventListener('click', handleCabinetTaskActionClick);
    });
}

function stableCabinetTaskSurfaceAnchor(button, taskId, preferredAction = 'more') {
    if (button?.isConnected && !button.closest?.('#taskUiActionSurface')) return button;
    const safeTaskId = String(normalizeCabinetTaskId(taskId) || '').replace(/"/g, '');
    if (!safeTaskId) return button || null;
    const selectors = [
        `.cabinet-task-card[data-task-id="${safeTaskId}"] [data-cabinet-task-action="${preferredAction}"]`,
        `.cabinet-overdue-triage-row[data-task-id="${safeTaskId}"] [data-cabinet-task-action="${preferredAction}"]`,
        `.cabinet-task-card[data-task-id="${safeTaskId}"] [data-cabinet-task-action="more"]`,
        `.cabinet-overdue-triage-row[data-task-id="${safeTaskId}"] [data-cabinet-task-action="more"]`,
        `.cabinet-task-card[data-task-id="${safeTaskId}"]`,
        `.cabinet-overdue-triage-row[data-task-id="${safeTaskId}"]`
    ];
    return document.querySelector(selectors.join(',')) || button || null;
}

function cabinetTaskCreatedTime(task = {}) {
    const raw = task.created_at || task.createdAt || task.created || '';
    const parsed = raw ? Date.parse(raw) : NaN;
    if (!Number.isNaN(parsed)) return parsed;
    const id = Number(task.id || task.taskId || task.task_id || 0);
    return Number.isFinite(id) ? id : 0;
}

function cabinetTaskDueKey(task = {}) {
    if (window.TaskUiShared?.taskDueDate) return window.TaskUiShared.taskDueDate(task);
    const raw = task.scheduledStartAt || task.scheduled_start_at || task.snoozedUntil || task.snoozed_until || task.date || task.deadline || task.remindAt || task.remind_at || '';
    const key = String(raw || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

function cabinetTaskDueValue(task = {}) {
    if (window.TaskUiShared?.taskDueValue) return window.TaskUiShared.taskDueValue(task) || '';
    return task.scheduledStartAt
        || task.scheduled_start_at
        || task.schedule?.startAt
        || task.snoozedUntil
        || task.snoozed_until
        || task.date
        || task.deadline
        || task.remindAt
        || task.remind_at
        || '';
}

function cabinetTaskScheduleStartTime(task = {}) {
    const raw = window.TaskUiShared?.taskScheduledStart?.(task)
        || task.scheduledStartAt || task.scheduled_start_at || task.schedule?.scheduledStartAt || task.schedule?.startAt || '';
    const parsed = raw ? Date.parse(raw) : NaN;
    return Number.isNaN(parsed) ? null : parsed;
}

function cabinetTaskFocusRank(task = {}) {
    const rank = Number(task.focusRank || task.focus_rank || 0);
    return Number.isFinite(rank) && rank > 0 ? rank : 0;
}

function compareCabinetTasksForDisplay(a = {}, b = {}) {
    const aIsNew = lastCabinetCreatedTaskId && String(a.id || a.taskId || a.task_id) === String(lastCabinetCreatedTaskId);
    const bIsNew = lastCabinetCreatedTaskId && String(b.id || b.taskId || b.task_id) === String(lastCabinetCreatedTaskId);
    if (aIsNew !== bIsNew) return aIsNew ? -1 : 1;
    const aBlocked = Boolean(a.isBlocked);
    const bBlocked = Boolean(b.isBlocked);
    if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;

    const priorityDiff = cabinetTaskPriorityRank(a) - cabinetTaskPriorityRank(b);
    if (priorityDiff) return priorityDiff;


    const aFocus = cabinetTaskFocusRank(a);
    const bFocus = cabinetTaskFocusRank(b);
    if (Boolean(aFocus) !== Boolean(bFocus)) return aFocus ? -1 : 1;
    if (aFocus && bFocus && aFocus !== bFocus) return aFocus - bFocus;

    const aDue = cabinetTaskDueKey(a);
    const bDue = cabinetTaskDueKey(b);
    if (aDue && bDue && aDue !== bDue) return aDue.localeCompare(bDue);
    if (aDue !== bDue) return aDue ? -1 : 1;

    const aSchedule = cabinetTaskScheduleStartTime(a);
    const bSchedule = cabinetTaskScheduleStartTime(b);
    if ((aSchedule !== null) !== (bSchedule !== null)) return aSchedule === null ? -1 : 1;
    if (aSchedule !== null && bSchedule !== null && aSchedule !== bSchedule) return aSchedule - bSchedule;

    const createdDiff = cabinetTaskCreatedTime(b) - cabinetTaskCreatedTime(a);
    if (createdDiff) return createdDiff;

    return 0;
}

function sortCabinetTasksForDisplay(list = []) {
    return [...list].sort(compareCabinetTasksForDisplay);
}

function cabinetTaskNumericId(task = {}) {
    return normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
}

function cabinetTaskPostponementCount(task = {}) {
    return Math.max(0, Number(task.postponementCount ?? task.postponement_count ?? 0) || 0);
}

function cabinetTaskAttentionLevel(task = {}) {
    const explicit = task.attentionLevel;
    const normalized = Number(explicit);
    return explicit !== null && explicit !== undefined && Number.isFinite(normalized)
        ? Math.max(0, Math.min(3, Math.trunc(normalized)))
        : Math.min(3, cabinetTaskPostponementCount(task));
}

function cabinetTaskPostponementWord(count = 0) {
    const absolute = Math.abs(Number(count) || 0);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (last === 1 && lastTwo !== 11) return 'раз';
    if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'рази';
    return 'разів';
}

function cabinetTaskPostponementBadgeLabel(task = {}) {
    const count = cabinetTaskPostponementCount(task);
    if (!count) return '';
    return count + ' ' + (cabinetTaskPostponementWord(count) === 'разів' ? 'перенесень' : 'перенесення');
}

function cabinetPostponementReasonLabel(value = '') {
    const reason = String(value || '').trim().toLowerCase();
    return {
        overdue_to_today: 'Прострочену задачу перенесено на сьогодні',
        move_to_today: 'Прострочену задачу перенесено на сьогодні',
        overdue_to_tomorrow: 'Прострочену задачу перенесено на завтра',
        overdue_reschedule: 'Прострочену задачу переплановано',
        missed_slot: 'Пропущений часовий слот переплановано',
        manual_reschedule: 'Задачу переплановано користувачем',
        manual_schedule: 'Задачу переплановано користувачем',
        bot_reschedule: 'Бот перепланував прострочену задачу',
        hermes_reschedule: 'Hermes перепланував прострочену задачу',
        second_postponement: 'Задачу повторно перенесено після прострочення',
        watchdog_auto_reschedule: 'Система автоматично перепланувала прострочену задачу'
    }[reason] || '';
}

function cabinetPostponementActorLabel(explanation = {}) {
    const actorType = String(explanation.actorType || '').trim().toLowerCase();
    const actorName = String(explanation.actorName || '').trim();
    if (actorType === 'system') return 'Система';
    if (actorType === 'bot') {
        return explanation.sourceSurface === 'hermes' ? 'Hermes' : actorName || 'Бот';
    }
    if (actorType === 'manual') return actorName || 'Користувач';
    return '';
}

function cabinetPostponementDateLabel(value, includeTime = false) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? new Date(raw + 'T12:00:00Z')
        : new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    const options = {
        timeZone: 'Europe/Kyiv',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    };
    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }
    return date.toLocaleString('uk-UA', options);
}

function cabinetPostponementActionPermissions(task = {}) {
    const source = task.actionPermissions && typeof task.actionPermissions === 'object'
        ? task.actionPermissions
        : {};
    return {
        canReassign: source.canReassign === true,
        canReschedule: source.canReschedule === true,
        canArchive: source.canArchive === true
    };
}

function renderCabinetPostponementActions(task = {}) {
    const count = cabinetTaskPostponementCount(task);
    if (count < 3) return '';
    const taskId = normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
    const permissions = cabinetPostponementActionPermissions(task);
    const definitions = [
        permissions.canReassign && ['reassign', 'Змінити виконавця', 'Передати задачу іншому доступному виконавцю'],
        permissions.canReschedule && ['reschedule', 'Перепланувати', 'Обрати нову дату через канонічний reschedule flow'],
        permissions.canArchive && ['archive', 'Архівувати задачу', 'Перемістити в архів із можливістю відновлення']
    ].filter(Boolean);
    const actions = taskId && definitions.length
        ? '<div class="cabinet-postponement-actions" aria-label="Рекомендовані дії">'
            + definitions.map(([action, label, detail]) => '<button type="button" class="cabinet-postponement-action cabinet-postponement-action--'
                + escapeHtml(action) + '" data-cabinet-postponement-action="' + escapeHtml(action)
                + '" data-task-id="' + escapeHtml(taskId) + '"><span>' + escapeHtml(label)
                + '</span><small>' + escapeHtml(detail) + '</small></button>').join('')
            + '</div>'
        : '';
    return '<section class="cabinet-postponement-decision" aria-label="Рішення для повторно перенесеної задачі">'
        + '<p class="cabinet-postponement-recommendation">Задачу переносять уже втретє. Можливо, її потрібно уточнити або передати іншому виконавцю.</p>'
        + actions
        + '<p class="cabinet-postponement-action-status" data-cabinet-postponement-action-status role="status" aria-live="polite"></p>'
        + '</section>';
}

function renderCabinetPostponementExplanation(task = {}) {
    const count = cabinetTaskPostponementCount(task);
    if (!count) return '';
    const explanation = task.postponementExplanation && typeof task.postponementExplanation === 'object'
        ? task.postponementExplanation
        : {};
    const oldDue = cabinetPostponementDateLabel(explanation.oldDue);
    const newDue = cabinetPostponementDateLabel(explanation.newDue);
    const postponedAt = cabinetPostponementDateLabel(
        explanation.lastPostponedAt || task.lastPostponedAt || task.last_postponed_at,
        true
    );
    const actor = cabinetPostponementActorLabel(explanation);
    const reason = cabinetPostponementReasonLabel(explanation.reason);
    const priorityBefore = explanation.priorityBefore ? cabinetTaskPriorityLabel(explanation.priorityBefore) : '';
    const priorityAfter = explanation.priorityAfter ? cabinetTaskPriorityLabel(explanation.priorityAfter) : '';
    const priorityText = explanation.priorityEscalated === true
        ? priorityBefore && priorityAfter
            ? 'Пріоритет автоматично змінено з ' + priorityBefore + ' на ' + priorityAfter + '.'
            : 'Пріоритет автоматично підвищено.'
        : '';
    const facts = [];
    if (oldDue && newDue) {
        facts.push('<div class="cabinet-postponement-fact"><dt>Остання зміна дати</dt><dd><span>' + escapeHtml(oldDue) + '</span><span class="cabinet-postponement-arrow" aria-hidden="true">→</span><span>' + escapeHtml(newDue) + '</span></dd></div>');
    } else if (newDue) {
        facts.push('<div class="cabinet-postponement-fact"><dt>Нова дата</dt><dd><span>' + escapeHtml(newDue) + '</span></dd></div>');
    }
    if (postponedAt) {
        facts.push('<div class="cabinet-postponement-fact"><dt>Коли</dt><dd><time datetime="' + escapeHtml(explanation.lastPostponedAt || task.lastPostponedAt || task.last_postponed_at || '') + '">' + escapeHtml(postponedAt) + '</time></dd></div>');
    }
    if (actor) {
        facts.push('<div class="cabinet-postponement-fact"><dt>Хто переніс</dt><dd>' + escapeHtml(actor) + '</dd></div>');
    }
    if (reason) {
        facts.push('<div class="cabinet-postponement-fact"><dt>Причина</dt><dd>' + escapeHtml(reason) + '</dd></div>');
    }
    const taskId = normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
    const historyLink = taskId
        ? '<a class="cabinet-postponement-history-link" href="/tasks?view=my&amp;open=' + encodeURIComponent(taskId) + '">Переглянути всю історію</a>'
        : '';
    return '<div class="cabinet-postponement-popover" data-cabinet-postponement-popover>'
        + '<p class="cabinet-postponement-summary">Задачу було перенесено після прострочення ' + count + ' ' + cabinetTaskPostponementWord(count) + '.</p>'
        + (priorityText ? '<p class="cabinet-postponement-priority">' + escapeHtml(priorityText) + '</p>' : '')
        + (facts.length ? '<dl class="cabinet-postponement-facts">' + facts.join('') + '</dl>' : '')
        + historyLink
        + renderCabinetPostponementActions(task)
        + '</div>';
}

function renderCabinetPostponementBadge(task = {}) {
    const count = cabinetTaskPostponementCount(task);
    if (!count) return '';
    const level = count >= 3 ? 3 : count === 2 ? 2 : 1;
    const label = cabinetTaskPostponementBadgeLabel(task);
    const canDecide = level === 3 && Object.values(cabinetPostponementActionPermissions(task)).some(Boolean);
    const action = canDecide ? 'Вирішити' : 'Переглянути перенесення';
    const title = label + '. ' + action;
    const taskId = normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
    return '<button type="button" class="cabinet-postponement-badge cabinet-postponement-badge--level-' + level
        + '" data-cabinet-task-action="postponement-explanation" data-task-id="' + escapeHtml(taskId || '')
        + '" aria-haspopup="dialog" aria-expanded="false" aria-controls="taskUiActionSurface" title="' + escapeHtml(title)
        + '" aria-label="' + escapeHtml(title) + '" ' + (taskId ? '' : 'disabled') + '>' + escapeHtml(label)
        + (canDecide ? '<span class="cabinet-postponement-action-label">Вирішити</span>' : '') + '</button>';
}

function setCabinetPostponementActionState(root, activeButton, options = {}) {
    if (!root) return;
    const busy = options.busy === true;
    root.setAttribute?.('aria-busy', busy ? 'true' : 'false');
    root.querySelectorAll?.('[data-cabinet-postponement-action]').forEach(button => {
        button.disabled = busy;
        button.classList?.toggle('is-busy', busy && button === activeButton);
    });
    const status = root.querySelector?.('[data-cabinet-postponement-action-status]');
    if (status) {
        status.textContent = options.message || '';
        status.dataset.tone = options.tone || '';
    }
}

async function reassignCabinetPostponementTask(taskId, task = {}) {
    if (typeof formModal !== 'function') throw new Error('Форма вибору виконавця тимчасово недоступна.');
    const ownersResult = await apiGet('/tasks/owners');
    const owners = Array.isArray(ownersResult?.users) ? ownersResult.users : [];
    if (!owners.length) throw new Error(ownersResult?.error || 'Немає доступних виконавців для цієї задачі.');
    const values = await formModal('Змінити виконавця', [
        {
            key: 'ownerUserId',
            label: 'Новий виконавець',
            type: 'select',
            required: true,
            defaultValue: String(task.ownerUserId || task.owner_user_id || ''),
            options: [
                { value: '', label: 'Оберіть виконавця' },
                ...owners.map(owner => ({
                    value: String(owner.id),
                    label: window.TaskUiShared?.taskPersonLabel?.(owner) || owner.label || owner.name || owner.username || `Користувач №${owner.id}`
                }))
            ]
        }
    ], { icon: '👤', okText: 'Змінити виконавця', cancelText: 'Скасувати' });
    if (!values?.ownerUserId) return { cancelled: true };
    const executePrivateTaskHandoff = window.TaskUiShared?.executePrivateTaskHandoff;
    if (typeof executePrivateTaskHandoff !== 'function') {
        throw new Error('\u041f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043d\u044f \u043f\u0435\u0440\u0435\u0434\u0430\u0447\u0456 \u043f\u0440\u0438\u0432\u0430\u0442\u043d\u043e\u0457 \u0437\u0430\u0434\u0430\u0447\u0456 \u0442\u0438\u043c\u0447\u0430\u0441\u043e\u0432\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0435.');
    }
    const result = await executePrivateTaskHandoff(confirmed => {
        const payload = {
            ownerUserId: Number(values.ownerUserId),
            sourceSurface: 'profile_my_cabinet_postponement_action'
        };
        if (confirmed === true) payload.confirmPrivateHandoff = true;
        return apiPost(`/tasks/${taskId}/reassign`, payload);
    });
    if (result?.cancelled) return result;
    if (!result?.success) throw new Error(result?.error || 'Не вдалося змінити виконавця.');
    return result;
}

async function archiveCabinetPostponementTask(taskId) {
    if (typeof confirmModal !== 'function') throw new Error('Підтвердження архівування тимчасово недоступне.');
    const confirmed = await confirmModal('Архівувати задачу? Її можна буде відновити.', {
        type: 'danger',
        okText: 'Перемістити в архів',
        cancelText: 'Залишити задачу'
    });
    if (!confirmed) return { cancelled: true };
    const result = await apiPost('/tasks/bulk', { ids: [taskId], action: 'archive' });
    if (!result?.success) throw new Error(result?.error || 'Не вдалося перемістити задачу в архів.');
    return result;
}

async function runCabinetPostponementAction(action, taskId, task = {}) {
    if (action === 'reassign') return reassignCabinetPostponementTask(taskId, task);
    if (action === 'reschedule') {
        return rescheduleCabinetTask(taskId, 'custom', {
            sourceSurface: 'profile_my_cabinet_postponement_action',
            notify: false,
            refresh: false
        });
    }
    if (action === 'archive') return archiveCabinetPostponementTask(taskId);
    throw new Error('Невідома дія для задачі.');
}

async function handleCabinetPostponementActionClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    const action = String(button?.dataset?.cabinetPostponementAction || '');
    const taskId = normalizeCabinetTaskId(button?.dataset?.taskId);
    const task = findCabinetTask(taskId) || {};
    const permissions = cabinetPostponementActionPermissions(task);
    const permissionKey = { reassign: 'canReassign', reschedule: 'canReschedule', archive: 'canArchive' }[action];
    const root = button?.closest?.('#taskUiActionSurface') || document.getElementById?.('taskUiActionSurface');
    if (!taskId || !permissionKey || permissions[permissionKey] !== true) {
        setCabinetPostponementActionState(root, button, { message: 'Ця дія недоступна для вашої ролі.', tone: 'error' });
        return;
    }
    if (button.dataset.pending === 'true') return;
    button.dataset.pending = 'true';
    const pendingLabel = { reassign: 'Змінюю виконавця...', reschedule: 'Переплановую...', archive: 'Переміщую в архів...' }[action];
    setCabinetPostponementActionState(root, button, { busy: true, message: pendingLabel });
    try {
        const result = await runCabinetPostponementAction(action, taskId, task);
        if (result?.cancelled) {
            setCabinetPostponementActionState(root, button, { message: '' });
            button.focus?.({ preventScroll: true });
            return;
        }
        notifyTaskWidgetsChanged({ action: `task_${action}`, taskId });
        await refreshMyCabinetTab({ silent: true });
        const remainsVisible = Boolean(findCabinetTask(taskId));
        window.TaskUI?.closeActionMenu?.();
        renderCabinetActiveTab();
        const successMessage = {
            reassign: 'Виконавця змінено',
            reschedule: 'Задачу переплановано',
            archive: 'Задачу переміщено в архів. Її можна відновити.'
        }[action];
        if (typeof showNotification === 'function') showNotification(successMessage, 'success');
        if (remainsVisible) {
            window.requestAnimationFrame?.(() => {
                document.querySelector?.(`[data-cabinet-task-action="postponement-explanation"][data-task-id="${taskId}"]`)?.focus?.({ preventScroll: true });
            });
        }
    } catch (error) {
        console.error('Profile postponement decision action failed', error);
        setCabinetPostponementActionState(root, button, {
            message: error?.message || 'Не вдалося виконати дію. Спробуйте ще раз.',
            tone: 'error'
        });
    } finally {
        delete button.dataset.pending;
        if (root?.isConnected) setCabinetPostponementActionState(root, button, {
            busy: false,
            message: root.querySelector?.('[data-cabinet-postponement-action-status]')?.textContent || '',
            tone: root.querySelector?.('[data-cabinet-postponement-action-status]')?.dataset?.tone || ''
        });
    }
}

function openCabinetPostponementExplanation(button) {
    const taskId = normalizeCabinetTaskId(button?.dataset?.taskId);
    const task = findCabinetTask(taskId);
    if (!taskId || !task) {
        if (typeof showNotification === 'function') showNotification('Не вдалося відкрити пояснення перенесення', 'error');
        return null;
    }
    const root = window.TaskUI?.openActionMenu?.(
        button,
        renderCabinetPostponementExplanation(task),
        {
            title: 'Історія перенесень',
            surfaceClassName: 'task-ui-action-surface--postponement'
        }
    );
    root?.querySelectorAll?.('[data-cabinet-postponement-action]').forEach(actionButton => {
        actionButton.addEventListener('click', handleCabinetPostponementActionClick);
    });
    if (!root && typeof showNotification === 'function') {
        showNotification('Не вдалося відкрити пояснення перенесення', 'error');
    }
    return root || null;
}

function cabinetTaskVisibleBadge(key = '', html = '') {
    if (!html) return null;
    return `<span class="cabinet-task-visible-badge cabinet-task-visible-badge--${escapeHtml(key)}" data-cabinet-visible-badge="${escapeHtml(key)}">${html}</span>`;
}

function cabinetTaskVisibleBadges(task = {}, context = {}) {
    const {
        taskIdAttr = '',
        dueState = {},
        relationLabel = '',
        scheduleStatus = ''
    } = context;
    const required = [
        cabinetTaskVisibleBadge('due', renderCabinetDueBadge(task, taskIdAttr, dueState)),
        cabinetTaskVisibleBadge('priority', renderCabinetTaskPriorityControl(task, taskIdAttr)),
        cabinetTaskVisibleBadge('postponement', renderCabinetPostponementBadge(task))
    ].filter(Boolean);
    const optional = [
        cabinetTaskVisibleBadge('move-today', renderCabinetMoveTodayAction(task, taskIdAttr, dueState)),
        relationLabel ? cabinetTaskVisibleBadge('relation', `<span class="cabinet-task-relation-badge">${escapeHtml(relationLabel)}</span>`) : null,
        cabinetTaskVisibleBadge('mode', `<span>${escapeHtml(taskModeLabel(task))}</span>`),
        cabinetTaskVisibleBadge('kind', `<span>${escapeHtml(taskKindLabel(task))}</span>`),
        scheduleStatus === 'proposal' ? cabinetTaskVisibleBadge('schedule', '<span>потрібне підтвердження часу</span>') : null,
        scheduleStatus === 'missed' ? cabinetTaskVisibleBadge('schedule', '<span>слот пропущено</span>') : null
    ].filter(Boolean);
    return [...required, ...optional.slice(0, Math.max(0, 5 - required.length))];
}

function renderCabinetMyDayTimeTrigger(task = {}, buttonClassName = 'cabinet-task-action-btn') {
    const tracking = window.MyDayTimeTracking;
    if (typeof tracking?.renderTaskTrigger === 'function') {
        return tracking.renderTaskTrigger(task, { buttonClassName }) || '';
    }
    return tracking?.renderTaskControls?.(task, { detailed: false, buttonClassName }) || '';
}

function renderCabinetMyDayTimeSummary(task = {}, showDetails = false) {
    if (!showDetails) return '';
    return window.MyDayTimeTracking?.renderTaskSummary?.(task) || '';
}

function renderCabinetMyDayDetailToggle(taskIdAttr = '', expanded = false, buttonClassName = 'cabinet-task-action-btn') {
    const label = expanded ? 'Сховати деталі задачі' : 'Показати деталі задачі';
    return `<button type="button" class="${escapeHtml(buttonClassName)} cabinet-task-action-details" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" aria-expanded="${expanded ? 'true' : 'false'}" data-cabinet-task-action="toggle-my-day-details" data-task-id="${escapeHtml(taskIdAttr)}" ${taskIdAttr ? '' : 'disabled'}>
        <svg class="cabinet-task-control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>
    </button>`;
}

function renderCabinetTaskCard(task, compact = false, options = {}) {
    if (options.surface === 'myday' && activeTab === 'myday' && window.ProfileMyDay) {
        const id = normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
        const due = getCabinetTaskDueState(task, cabinetTaskDueValue(task));
        const title = task.title || 'Без назви';
        const taskBlocked = task.isBlocked || (Array.isArray(task.dependencies)
            && task.dependencies.some(item => item?.isOpen !== false && !['done', 'archived', 'cancelled'].includes(item?.status)));
        const blocked = taskBlocked ? (task.blockedByTitles || task.blocked_by_titles || 'Спочатку виконайте задачу, від якої залежить ця.') : '';
        const canEdit = task.actionPermissions?.canMutate ?? window.ProfileMyDay.taskRole(task) === 'executor';
        return window.ProfileMyDay.renderCard({
            id, title, status: cabinetTaskStatus(task), due: cabinetTaskFocusDateKey(task),
            overdueDays: window.TaskUiShared?.daysBetweenTaskDates(cabinetTaskFocusDateKey(task), cabinetDateKeyOffset(0)),
            time: window.TaskUiShared?.taskExplicitTime(task),
            canComplete: task.actionPermissions?.canChangeStatus !== false,
            priority: normalizeCabinetPriority(task.priority),
            mode: cabinetTaskMode(task), modeLabel: taskModeLabel(task),
            blocked,
            postponementBadge: renderCabinetPostponementBadge(task),
            substitution: task.substitution,
            isAi: window.TaskAiDraft?.isAiTask?.(task) === true,
            role: window.ProfileMyDay.taskRole(task),
            executor: task.ownerLabel || task.owner_name || task.owner_username,
            dueState: due.key,
            canReschedule: cabinetTaskAllowsReschedule(task),
            canMoveToToday: cabinetTaskCanMoveToToday(task, due),
            canEdit
        });
    }
    const taskId = Number(task.id || task.taskId || task.task_id || 0);
    const taskIdAttr = Number.isInteger(taskId) && taskId > 0 ? String(taskId) : '';
    const due = cabinetTaskDueValue(task);
    const scheduleStatus = task.scheduleStatus || task.schedule_status || task.schedule?.status || '';
    const taskStatus = task.status || 'todo';
    const canEditTask = task.actionPermissions?.canMutate !== false;
    const priority = normalizeCabinetPriority(task.priority || 'normal');
    const attentionLevel = cabinetTaskAttentionLevel(task);
    const dueState = getCabinetTaskDueState(task, due);
    const relationLabel = getCabinetTaskRelationLabel(task);
    const moveToTodayState = cabinetTaskMoveToTodayState(task, dueState);
    const canMoveToToday = moveToTodayState.canMove;
    const dragKind = dueState.key === 'overdue' ? 'overdue' : 'to-today';
    const dragAttrs = canMoveToToday
        ? ` draggable="true" data-cabinet-task-drag="${dragKind}" data-cabinet-task-drag-target="today" aria-grabbed="false" title="Перетягніть у колонку Сьогодні, щоб перенести задачу на сьогодні"`
        : '';
    const doneActionLabel = 'Виконати задачу';
    const isMyDayCard = options.surface === 'myday' || activeTab === 'myday';
    const suppressMoveTodayAction = options.suppressMoveTodayAction === true;
    const suppressOverdueRescheduleMenu = options.suppressOverdueRescheduleMenu === true;
    const cardDetailsExpanded = isCabinetMyDayTaskExpanded(taskId);
    const showMyDayDetails = isMyDayCard && cardDetailsExpanded;
    const myDayTimeSummaryHtml = isMyDayCard ? renderCabinetMyDayTimeSummary(task, showMyDayDetails) : '';
    const myDayFactsHtml = isMyDayCard ? [
        cabinetTaskVisibleBadge('viewer-role', `<span>${escapeHtml(window.TaskUiShared?.taskViewerRoleLabel(task) || '')}</span>`),
        cabinetTaskVisibleBadge('due', renderCabinetDueBadge(task, taskIdAttr, dueState, { suppressOverdueRescheduleMenu: suppressOverdueRescheduleMenu || showMyDayDetails })),
        cabinetTaskVisibleBadge('priority', showMyDayDetails ? '' : renderCabinetTaskPriorityControl(task, taskIdAttr, canEditTask)),
        cabinetTaskVisibleBadge('postponement', renderCabinetPostponementBadge(task)),
        suppressMoveTodayAction || showMyDayDetails ? null : cabinetTaskVisibleBadge('move-today', renderCabinetMoveTodayAction(task, taskIdAttr, dueState)),
        scheduleStatus === 'proposal' ? cabinetTaskVisibleBadge('schedule', '<span>потрібне підтвердження часу</span>') : null,
        scheduleStatus === 'missed' ? cabinetTaskVisibleBadge('schedule', '<span>слот пропущено</span>') : null
    ].filter(Boolean).join('') : '';
    const myDayDetailsHtml = isMyDayCard && showMyDayDetails ? [
        relationLabel ? cabinetTaskVisibleBadge('relation', `<span class="cabinet-task-relation-badge">${escapeHtml(relationLabel)}</span>`) : null,
        cabinetTaskVisibleBadge('mode', `<span>${escapeHtml(taskModeLabel(task))}</span>`),
        cabinetTaskVisibleBadge('kind', `<span>${escapeHtml(taskKindLabel(task))}</span>`),
        myDayTimeSummaryHtml
    ].filter(Boolean).join('') : '';
    const metadataHtml = !isMyDayCard ? `
                    ${renderCabinetDueBadge(task, taskIdAttr, dueState)}
                    ${renderCabinetMoveTodayAction(task, taskIdAttr, dueState)}
                    ${renderCabinetTaskPriorityControl(task, taskIdAttr, canEditTask)}
                    ${relationLabel ? `<span class="cabinet-task-relation-badge">${escapeHtml(relationLabel)}</span>` : ''}
                    <span>${taskModeLabel(task)}</span>
                    <span>${taskKindLabel(task)}</span>
                    ${scheduleStatus === 'proposal' ? '<span>потрібне підтвердження часу</span>' : ''}
                    ${scheduleStatus === 'missed' ? '<span>слот пропущено</span>' : ''}
                ` : '';
    const cardClass = [
        'cabinet-task-card',
        'is-personal-day-card',
        isMyDayCard ? 'is-my-day-compact-card' : '',
        options.cardClassName || '',
        attentionLevel ? 'attention-level-' + attentionLevel : '',
        `priority-${priority}`,
    ].filter(Boolean).join(' ');
    const isAiCreated = window.TaskAiDraft?.isAiTask?.(task) === true;
    const aiCreatedMarker = isAiCreated
        ? '<span class="task-ai-created-marker" aria-label="Створено з допомогою AI">✨ AI</span>'
        : '';
    const taskTitleHtml = `<div class="cabinet-task-title" title="${escapeHtml(task.title || 'Без назви')}">${aiCreatedMarker}${escapeHtml(task.title || 'Без назви')}</div>`;
    const detailToggleHtml = isMyDayCard ? renderCabinetMyDayDetailToggle(taskIdAttr, cardDetailsExpanded) : '';
    const taskTimerActionHtml = isMyDayCard && canEditTask ? renderCabinetMyDayTimeTrigger(task) : '';
    const extraCommandsHtml = options.extraCommandsHtml || '';
    const extraAttrs = options.cardAttrs || '';
    const doneIcon = '<svg class="cabinet-task-control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg>';
    const doneButton = `<button type="button" class="cabinet-task-action-btn cabinet-task-action-done" title="${escapeHtml(doneActionLabel)}" aria-label="${escapeHtml(doneActionLabel)}" data-tooltip="${escapeHtml(doneActionLabel)}" data-cabinet-task-action="done" data-task-id="${taskIdAttr}" ${!taskIdAttr ? 'disabled' : ''}>${isMyDayCard ? doneIcon : '✓'}${showMyDayDetails ? 'Виконати' : ''}</button>`;
    const taskActionsHtml = `<div class="cabinet-task-actions">
                ${showMyDayDetails ? '' : detailToggleHtml}
                ${doneButton}
                ${taskTimerActionHtml}
                ${renderCabinetTaskMoreAction(taskIdAttr, isMyDayCard)}
            </div>`;
    const hasBlocker = isMyDayCard && (task.isBlocked || (Array.isArray(task.dependencies)
        && task.dependencies.some(item => item?.isOpen !== false && !['done', 'archived', 'cancelled'].includes(item?.status))));
    const blocker = hasBlocker ? window.MyDayDependencies?.renderTaskBlocker?.(task) || 'Є незавершена передумова' : '';
    const visibility = cabinetTaskVisibility(task);
    if (isMyDayCard) {
        return `
        <div class="${cardClass}${isAiCreated ? ' is-ai-created' : ''}" data-task-id="${taskIdAttr}" data-task-status="${escapeHtml(taskStatus)}" data-task-priority="${escapeHtml(priority)}" data-task-attention-level="${attentionLevel}" data-task-due-state="${escapeHtml(dueState.key)}" data-my-day-details-expanded="${showMyDayDetails ? 'true' : 'false'}"${isAiCreated ? ' data-ai-created="true" aria-label="Задача створена з допомогою AI"' : ''}${dragAttrs}${extraAttrs ? ` ${extraAttrs}` : ''}>
            <div class="cabinet-task-main cabinet-task-main--my-day">
                <div class="cabinet-task-zone cabinet-task-zone--header">
                    ${taskTitleHtml}
                    ${showMyDayDetails ? detailToggleHtml : taskActionsHtml}
                </div>
                ${myDayFactsHtml ? `<div class="cabinet-task-zone cabinet-task-zone--facts">${myDayFactsHtml}</div>` : ''}
                ${showMyDayDetails && task.description?.trim() ? `<p class="cabinet-task-description">${escapeHtml(task.description)}</p>` : ''}
                ${showMyDayDetails || blocker ? `<div class="cabinet-task-zone cabinet-task-zone--completion">${blocker}${showMyDayDetails ? taskActionsHtml : ''}</div>` : ''}
                ${myDayDetailsHtml ? `<div class="cabinet-task-zone cabinet-task-zone--details">${myDayDetailsHtml}</div>` : ''}
                ${showMyDayDetails && visibility !== 'team' ? `<p class="cabinet-task-visibility">${escapeHtml(cabinetTaskVisibilityHint(visibility))}</p>` : ''}
                ${extraCommandsHtml && !showMyDayDetails ? `<div class="cabinet-task-zone cabinet-task-zone--commands">${extraCommandsHtml}</div>` : ''}
            </div>
        </div>`;
    }
    return `
        <div class="${cardClass}${isAiCreated ? ' is-ai-created' : ''}" data-task-id="${taskIdAttr}" data-task-status="${escapeHtml(taskStatus)}" data-task-priority="${escapeHtml(priority)}" data-task-attention-level="${attentionLevel}" data-task-due-state="${escapeHtml(dueState.key)}"${isAiCreated ? ' data-ai-created="true" aria-label="Задача створена з допомогою AI"' : ''}${dragAttrs}>
            <div class="cabinet-task-main">
                ${taskTitleHtml}
                <div class="cabinet-task-meta">
                    ${metadataHtml}
                </div>
            </div>
            ${taskActionsHtml}
        </div>`;
}

function renderCabinetSection(title, tasks, emptyText, options = {}) {
    const body = tasks.length
        ? tasks.map(task => renderCabinetTaskCard(task, false, options.cardOptions)).join('')
        : `<div class="cabinet-empty">${escapeHtml(emptyText)}</div>`;
    return `
        <section class="cabinet-task-section ${options.className || ''}${tasks.length ? '' : ' is-compact-empty'}" ${options.sectionAttrs || ''}>
            <div class="cabinet-section-head"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(options.countLabel || tasks.length)}</span></div>
            <div class="cabinet-section-body">${body}${options.footer || ''}</div>
        </section>`;
}

function readCabinetCreatePriority() {
    const selectValue = document.getElementById('cabinetTaskPriority')?.value;
    return normalizeCabinetPriority(selectValue || cabinetCreatePriority);
}

function setCabinetCreatePriority(priority = 'normal') {
    cabinetCreatePriority = normalizeCabinetPriority(priority);
    const select = document.getElementById('cabinetTaskPriority');
    if (select) select.value = cabinetCreatePriority;
}

function bindMyDayTaskNavigation(composer) {
    const workspace = document.getElementById('myDayDayPanel');
    if (!workspace || !composer) return;
    workspace.querySelectorAll('.park-task-menu:not([data-bound])').forEach(menu => {
        menu.dataset.bound = 'true';
        menu.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !menu.open) return;
            event.preventDefault();
            menu.open = false;
            menu.querySelector('summary').focus();
        });
    });
    const undated = workspace.querySelector('.park-undated');
    if (undated && !undated.dataset.bound) {
        undated.dataset.bound = 'true';
        undated.addEventListener('toggle', () => { myDayUndatedOpen = undated.open; });
    }
    const businessContext = window.CrmBusinessContext?.scope?.()?.activeContext;
    if (businessContext) {
        workspace.querySelectorAll('[data-profile-control-shortcut], [data-profile-team-link]').forEach(link => {
            const url = new URL(link.href);
            url.searchParams.set('businessContext', businessContext);
            link.href = url.href;
        });
    }
    if (composer.dataset.creationBound) return;
    composer.dataset.creationBound = 'true';
    composer.dataset.creationScope = cabinetHrReminderScope();
    workspace.querySelector('[data-cabinet-operation-pack] button')?.addEventListener('click', createCabinetOperationPack);
    const url = new URL(window.location.href);
    const token = url.searchParams.get('create');
    if (!token || !isOwnProfile) return;
    let handoff = null;
    try { handoff = window.TaskLinks?.takeCreationDraft(token); } catch (error) { console.warn('Task draft handoff unavailable', error); }
    url.searchParams.delete('create');
    window.history.replaceState(window.history.state, '', url);
    composer.closest('.park-composer').open = true;
    if (handoff?.businessContext && handoff.businessContext !== businessContext) {
        setCabinetTaskComposerStatus('Оберіть бізнес, з якого відкрили створення задачі.', 'warning');
    } else if (handoff) {
        cabinetCreateAssignment = { ownerUserId: handoff.ownerUserId, assignee: handoff.assignee };
        if (handoff.sourceType) {
            cabinetCreateContext = {
                sourceType: handoff.sourceType,
                sourceId: handoff.sourceId ? String(handoff.sourceId) : null,
                sourceModule: handoff.sourceModule || 'profile_my_cabinet',
                sourceEntityType: handoff.sourceEntityType || handoff.sourceType,
                sourceEntityId: handoff.sourceEntityId || handoff.sourceId || null
            };
            const contextLabel = composer.querySelector('[data-cabinet-create-context]');
            contextLabel.textContent = `Джерело: ${handoff.sourceLabel || handoff.sourceType}${handoff.sourceId ? ` · ${handoff.sourceId}` : ''}`;
            contextLabel.hidden = false;
        }
        const fields = { cabinetTaskTitle: 'title', cabinetTaskDetails: 'description', cabinetTaskCategory: 'category',
            cabinetTaskKind: 'kind', cabinetTaskTime: 'time' };
        Object.entries(fields).forEach(([id, key]) => {
            const field = composer.querySelector('#' + id);
            if (field && handoff[key]) field.value = handoff[key];
        });
        if (handoff.priority) setCabinetCreatePriority(handoff.priority);
        if (handoff.mode === 'personal') {
            composer.querySelector('#cabinetTaskMode').value = 'personal';
            syncCabinetTaskCreateMode();
        }
        if (handoff.date === 'undated') {
            setCabinetDuePreset('no_date');
        } else if (handoff.date) {
            composer.querySelector('#cabinetTaskDate').value = handoff.date;
            setCabinetDuePreset('custom');
        }
        const leadId = handoff.sourceType === 'lead' && window.TaskLinks.taskId(handoff.sourceId);
        if (handoff.workflow === 'lead_collaboration' && leadId) {
            configureCabinetLeadCollaboration(composer, workspace, leadId, handoff);
        }
        composer.querySelector('.park-composer-options').open = true;
    }
    window.requestAnimationFrame(() => {
        const title = composer.querySelector('#cabinetTaskTitle');
        if (title?.isConnected) title.focus();
    });
}

function configureCabinetLeadCollaboration(form, workspace, leadId, handoff) {
    cabinetLeadCollaboration = {
        leadId,
        businessContext: handoff.businessContext,
        pendingLeadEdits: handoff.pendingLeadEdits || {},
        scope: cabinetHrReminderScope(),
        composer: form.closest('.park-composer')
    };
    const status = form.querySelector('[data-cabinet-create-context]');
    status.textContent = `Лід №${leadId} · після створення задачі тип ліда зміниться на «Співпраця».`;
    status.hidden = false;
    form.querySelector('[data-cabinet-create-action="plain"]').textContent = 'Оформити співпрацю';
    form.querySelector('#cabinetTaskPriority option[value="urgent"]')?.remove();
    form.querySelectorAll('[data-task-ai-draft-preview]').forEach(element => {
        element.hidden = true;
    });
    ['cabinetTaskMode', 'cabinetTaskKind', 'cabinetTaskCategory', 'cabinetTaskVisibility', 'cabinetTaskAllowReschedule', 'cabinetDueMode'].forEach(id => {
        const label = form.querySelector('#' + id)?.closest('label');
        if (label) label.hidden = true;
    });
    const pack = workspace.querySelector('[data-cabinet-operation-pack]');
    if (pack) pack.hidden = true;
}

async function submitCabinetLeadCollaboration(form) {
    const workflow = cabinetLeadCollaboration;
    if (!workflow || workflow.scope !== cabinetHrReminderScope()) return;
    const path = `/leads/${workflow.leadId}`;
    cabinetTaskCreatePending = true;
    setCabinetTaskCreateBusy(true, form);
    try {
        if (!workflow.createdTask && !workflow.request) {
            const titleField = form.querySelector('#cabinetTaskTitle');
            const dateField = form.querySelector('#cabinetTaskDate');
            const timeField = form.querySelector('#cabinetTaskTime');
            const ownerField = form.querySelector('[data-cabinet-assignment] summary');
            const title = titleField.value.trim();
            const date = dateField.value;
            const time = timeField.value;
            const ownerUserId = readCabinetOwner(form);
            const titleError = validateCabinetPlainTaskTitle(title);
            if (titleError || !date || !time || !ownerUserId) {
                setCabinetTaskComposerStatus(titleError || 'Оберіть відповідального, дату й час.', 'error', form);
                (titleError ? titleField : !date ? dateField : !time ? timeField : ownerField).focus();
                return;
            }
            workflow.request = {
                title, date, deadline: `${date}T${time}:00`, ownerUserId,
                description: form.querySelector('#cabinetTaskDetails').value.trim(),
                priority: readCabinetCreatePriority(),
                businessContext: workflow.businessContext,
                idempotencyKey: randomCabinetTaskCreateIdempotencyKey()
            };
            workflow.lockedFields = [...form.querySelectorAll('input:enabled, select:enabled, textarea:enabled, [data-cabinet-assignment] button:enabled')];
            workflow.lockedFields.forEach(field => { field.disabled = true; });
        }
        if (!workflow.createdTask) {
            setCabinetTaskComposerStatus('Зберігаю співпрацю…', '', form);
            const result = await apiPost(`${path}/collaboration-task`, workflow.request);
            if (workflow !== cabinetLeadCollaboration || workflow.scope !== cabinetHrReminderScope()) return;
            if (!result?.success || !result.task?.id) {
                if (result?.status >= 400 && result.status < 500) {
                    workflow.request = null;
                    workflow.lockedFields.forEach(field => { field.disabled = false; });
                    setCabinetTaskComposerStatus(result.message || result.error || 'Не вдалося оформити співпрацю.', 'error', form);
                } else {
                    setCabinetTaskComposerStatus('Не вдалося підтвердити створення задачі. Повторіть збереження.', 'error', form);
                }
                return;
            }
            workflow.createdTask = result.task;
            notifyTaskWidgetsChanged({ action: 'create', taskId: result.task.id });
        }
        if (workflow.scope !== cabinetHrReminderScope()) return;
        if (Object.keys(workflow.pendingLeadEdits).length) {
            form.querySelector('[data-cabinet-create-action="plain"]').textContent = 'Зберегти зміни ліда';
            setCabinetTaskComposerStatus('Задачу створено. Зберігаю решту змін ліда…', '', form);
            const saved = await apiPatch(path, { ...workflow.pendingLeadEdits, businessContext: workflow.businessContext });
            if (workflow !== cabinetLeadCollaboration || workflow.scope !== cabinetHrReminderScope()) return;
            if (!saved?.success) {
                setCabinetTaskComposerStatus('Задачу створено. Повторіть збереження решти змін ліда.', 'error', form);
                return;
            }
        }
        const params = new URLSearchParams({ lead: String(workflow.leadId), businessContext: workflow.businessContext });
        window.location.assign(`/sales-funnel?${params}`);
    } finally {
        cabinetTaskCreatePending = false;
        setCabinetTaskCreateBusy(false, form);
    }
}

function renderCabinetOperationPack() {
    return `<details class="park-composer-options" data-cabinet-operation-pack hidden>
        <summary>Операційний пакет</summary>
        <div class="cabinet-task-composer-main-advanced">
            <label>Пакет <select name="preset">
                <option value="kitchen_basic">Кухня</option>
                <option value="cake_basic">Торт</option>
                <option value="cake_with_decor">Торт і прикраси</option>
                <option value="hall_prep_basic">Підготовка залу</option>
                <option value="purchase_basic">Закупка</option>
            </select></label>
            <label>Назва пакета <input name="title"></label>
            <label>Джерело <select name="sourceType">
                <option value="">Без джерела</option>
                <option value="booking">Бронювання</option>
                <option value="order">Замовлення</option>
                <option value="lead">Лід</option>
                <option value="customer">Клієнт</option>
            </select></label>
            <label>ID джерела <input name="sourceId"></label>
            <button type="button" class="cabinet-task-create-submit">Створити пакет</button>
            <p role="status" data-operation-pack-status></p>
        </div>
    </details>`;
}

async function createCabinetOperationPack(event) {
    const button = event.currentTarget;
    if (button.disabled) return;
    const pack = button.closest('[data-cabinet-operation-pack]');
    const status = pack.querySelector('[data-operation-pack-status]');
    const sourceType = pack.querySelector('[name="sourceType"]').value || cabinetCreateContext?.sourceEntityType;
    const sourceId = pack.querySelector('[name="sourceId"]').value.trim() || cabinetCreateContext?.sourceEntityId;
    const data = {
        preset: pack.querySelector('[name="preset"]').value,
        title: pack.querySelector('[name="title"]').value.trim(),
        source_entity_type: sourceType,
        source_entity_id: sourceId,
        date: cabinetSelectedDueDate(),
        priority: readCabinetCreatePriority()
    };
    const signature = cabinetTaskCreateSignature({ title: JSON.stringify(data), kind: 'operation_pack' });
    const key = cabinetTaskCreateIdempotencyKeyForSignature(signature);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
        // The pack ID is also its duplicate signature on the existing endpoint.
        // A stable ID lets a lost response be retried safely.
        const hex = (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
        const id = Array.from(new Uint8Array(hex).slice(0, 16), value => value.toString(16).padStart(2, '0')).join('');
        const packId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20)}`;
        const result = await apiPost('/tasks/operation-pack', { ...data, packId });
        if (!result?.success) {
            status.textContent = result?.error || 'Не вдалося створити пакет. Спробуйте ще раз.';
            return;
        }
        clearCabinetTaskCreateAttempt(signature, key);
        pack.querySelector('[name="title"]').value = '';
        status.textContent = `Задач у пакеті: ${result.tasks?.length || 0}`;
        notifyTaskWidgetsChanged({ action: 'create', taskId: result.tasks?.[0]?.id });
        await refreshMyCabinetTab({ force: true });
    } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
}

function renderCabinetTaskComposer(options = {}) {
    const segment = options.segment || myTasksSegment || 'all';
    const defaults = cabinetCreateDefaultsForSegment(segment, options.mode || '');
    const simple = options.simple === true;
    const expanded = simple || Boolean(cabinetTaskComposerExpanded);
    const dateValue = cabinetSelectedDueDate();
    const categories = CABINET_TASK_CATEGORIES.map(([value, label]) =>
        `<option value="${value}" ${defaults.category === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');
    const selectedPriority = normalizeCabinetPriority(cabinetCreatePriority);
    const priorityOptions = CABINET_TASK_PRIORITIES.map(item =>
        `<option value="${item.value}" ${selectedPriority === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`
    ).join('');

    return `
        <form class="cabinet-capture cabinet-task-composer ${expanded ? 'is-expanded' : 'is-collapsed'}" id="cabinetTaskComposer" data-source-surface="profile_${escapeHtml(activeTab)}" data-cabinet-composer-state="${expanded ? 'expanded' : 'collapsed'}"${simple ? ' data-cabinet-composer-simple' : ''} aria-label="Нова задача" aria-describedby="cabinetTaskComposerStatus" onsubmit="createCabinetTask(event)">
            <div class="cabinet-task-composer-main">
                <label class="cabinet-task-title-field" for="cabinetTaskTitle">
                    <span>Назва задачі</span>
                    <textarea id="cabinetTaskTitle" name="title" rows="1" autocomplete="off" enterkeyhint="done" placeholder="Що потрібно зробити?" data-task-ai-source-field="title" aria-required="true" aria-describedby="cabinetTaskTitleGuidance cabinetTaskComposerStatus" aria-invalid="false"></textarea>
                    <span id="cabinetTaskTitleGuidance" class="cabinet-task-title-guidance" aria-live="polite"></span>
                </label>
                <details class="cabinet-assignment" data-cabinet-assignment>
                    <summary>Кому · Відповідальний: Я</summary>
                    <button type="button" data-assignment-people-mode aria-pressed="true">Люди</button>
                    <button type="button" data-assignment-shift-mode aria-pressed="false" hidden>Відділ на зміні</button>
                    <button type="button" data-assignment-manual hidden>Змінити склад вручну</button>
                    <label>Пошук виконавців <input type="search" placeholder="Ім’я, посада або відділ"></label>
                    <div data-assignment-shift hidden>
                        <label>Дата зміни <input type="date"></label>
                        <div><label for="cabinetShiftGroup">Відділ</label><select id="cabinetShiftGroup"></select></div>
                        <button type="button" disabled>Підтвердити склад</button>
                        <button type="button" data-assignment-retry hidden>Повторити</button>
                    </div>
                    <p role="status"></p>
                    <div data-assignment-results></div>
                    <button type="button" data-assignment-more hidden>Показати ще</button>
                </details>
                <div class="cabinet-task-create-date">
                    <label for="cabinetTaskDate">
                        <span>Термін</span>
                        <input id="cabinetTaskDate" name="date" type="date" value="${escapeHtml(dateValue)}">
                    </label>
                    <label for="cabinetDueMode">
                        <span>Тип терміну</span>
                        <select id="cabinetDueMode">
                            <option value="scheduled">На дату</option>
                            <option value="deadline">До дати</option>
                        </select>
                    </label>
                </div>
                <label class="park-task-mode" for="cabinetTaskMode">
                    <span>Вид задачі</span>
                    <select id="cabinetTaskMode" aria-describedby="cabinetTaskVisibilityHint" onchange="syncCabinetTaskCreateMode()">
                        <option value="work" ${defaults.mode === 'work' ? 'selected' : ''}>Робоча</option>
                        <option value="personal" ${defaults.mode === 'personal' ? 'selected' : ''}>Особиста</option>
                    </select>
                </label>
                <button type="submit" class="cabinet-task-create-submit" data-cabinet-create-action="plain" aria-busy="false">Додати задачу</button>
            </div>
            <p id="cabinetTaskVisibilityHint" class="park-task-visibility"${defaults.visibility === 'team' ? ' hidden' : ''}>${cabinetTaskVisibilityHint(defaults.visibility)}</p>
            <div class="cabinet-task-composer-actions">
                ${simple ? '' : `<button type="button" class="cabinet-task-composer-toggle" data-cabinet-composer-toggle aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="cabinetTaskComposerAdvanced">${expanded ? 'Згорнути' : 'Більше параметрів'}</button>`}
                <button type="button" class="cabinet-task-ai-fill task-ai-draft-trigger" id="cabinetTaskAiFillBtn" data-cabinet-create-action="ai" data-task-ai-draft-preview aria-busy="false">Заповнити з AI</button>
            </div>
            <p data-cabinet-create-context hidden></p>
            <div class="task-ai-draft-panel" data-task-ai-draft-panel>
                <p id="cabinetTaskComposerStatus" class="task-ai-draft-status cabinet-task-composer-status" data-task-ai-draft-status role="status" aria-live="polite"></p>
                <div class="task-ai-draft-review-host" data-task-ai-draft-review hidden></div>
            </div>
            ${simple ? '<details class="park-composer-options"><summary>Параметри задачі</summary>' : ''}
            <div id="cabinetTaskComposerAdvanced" data-cabinet-composer-advanced ${expanded ? '' : 'hidden'}>
                <label class="cabinet-task-description-field" for="cabinetTaskDetails">
                    <span>Опис</span>
                    <textarea id="cabinetTaskDetails" name="description" rows="3" data-task-ai-source-field="description"></textarea>
                </label>
                <div class="cabinet-task-composer-main-advanced">
                    <label for="cabinetTaskCategory">
                        <span>Категорія</span>
                        <select id="cabinetTaskCategory">${categories}</select>
                    </label>
                    <label for="cabinetTaskKind">
                        <span>Тип</span>
                        <select id="cabinetTaskKind">
                            <option value="action" ${defaults.kind === 'action' ? 'selected' : ''}>Дія</option>
                            <option value="reminder" ${defaults.kind === 'reminder' ? 'selected' : ''}>Нагадування</option>
                            <option value="followup" ${defaults.kind === 'followup' ? 'selected' : ''}>Дотиск</option>
                            <option value="idea" ${defaults.kind === 'idea' ? 'selected' : ''}>Ідея</option>
                        </select>
                    </label>
                    <label for="cabinetTaskTime"><span>Час</span><input type="time" id="cabinetTaskTime"></label>
                    <label for="cabinetTaskPriority">
                        <span>Пріоритет</span>
                        <select id="cabinetTaskPriority">${priorityOptions}</select>
                    </label>
                    <label for="cabinetTaskVisibility">
                        <span>Видимість</span>
                        <select id="cabinetTaskVisibility" name="visibility" aria-describedby="cabinetTaskVisibilityHint">
                            <option value="team" ${defaults.mode !== 'work' ? 'disabled' : ''} ${defaults.visibility === 'team' ? 'selected' : ''}>Команда</option>
                            <option value="me_only" ${defaults.visibility === 'me_only' ? 'selected' : ''}>Тільки я</option>
                            <option value="private">Приватна</option>

                        </select>

                    </label>
                    <label class="cabinet-task-reschedule-toggle" for="cabinetTaskAllowReschedule">
                        <input id="cabinetTaskAllowReschedule" type="checkbox" checked>
                        <span>Дозволити перенесення</span>
                    </label>
                </div>
            </div>
            ${simple ? '</details>' : ''}
        </form>
        ${simple ? renderCabinetOperationPack() : ''}`;
}

function cabinetTaskDateKeyFromValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const plainDate = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(plainDate) && !/[tz]|[+-]\d{2}:?\d{2}$/i.test(raw)) return plainDate;
    const parsed = normalizeCabinetTaskDate(raw);
    return parsed ? cabinetKyivDateKey(parsed) : '';
}

function cabinetTaskFocusDateKey(task = {}) {
    return window.TaskUiShared?.taskDueDate(task) || cabinetTaskDateKeyFromValue(cabinetTaskDueValue(task));
}

function cabinetTaskIsOpenForMyDay(task = {}) {
    return !['done', 'archived', 'cancelled'].includes(cabinetTaskStatus(task));
}

function isCabinetDeferredTask(task = {}, now = new Date()) {
    const snoozedUntil = normalizeCabinetTaskDate(task?.snoozedUntil || task?.snoozed_until);
    return Boolean(snoozedUntil && snoozedUntil > now);
}

function cabinetActiveMyDaySourceTasks() {
    const seen = new Set();
    const merged = [];
    const addTask = (bucket, task, index) => {
        const key = cabinetProjectionTaskId(task) || `${bucket}:${index}:${task.title || ''}:${cabinetTaskFocusDateKey(task)}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(task);
    };
    cabinetPlanningList('all').forEach((task, index) => addTask('planning.all', task, index));
    cabinetList('all').forEach((task, index) => addTask('all', task, index));
    if (merged.length) return merged;
    ['today', 'next', 'overdue', 'private', 'waiting'].forEach(bucket => {
        cabinetList(bucket).forEach((task, index) => {
            addTask(bucket, task, index);
        });
    });
    return merged;
}

function renderCabinetLoadNotice() {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!offline && myCabinetLoadState === 'loading' && !myCabinetData) {
        return `<div class="cabinet-load-notice is-loading">
            <span>Завантажую Мій день…</span>
        </div>`;
    }
    if (!offline && myCabinetLoadState === 'refreshing' && myCabinetData) {
        return `<div class="cabinet-load-notice is-loading is-refreshing">
            <span>Оновлюю задачі, поточні дані залишаються на екрані.</span>
        </div>`;
    }
    if (!myCabinetLoadError && !offline) return '';
    const message = offline ? 'Немає з’єднання. Після підключення повторіть завантаження.' : myCabinetLoadError;
    return `
        <div class="cabinet-load-notice">
            <span>${escapeHtml(message)}</span>
            <button type="button" data-cabinet-refresh>Повторити</button>
        </div>`;
}

function refreshCabinetConnectivityNotice() {
    const notice = document.querySelector('[data-park-my-day-notice]');
    if (!notice) return;
    const restoreFocus = notice.contains(document.activeElement);
    notice.innerHTML = renderCabinetLoadNotice();
    bindCabinetRefreshButton(notice);
    if (restoreFocus) {
        (notice.querySelector('button') || document.querySelector('[data-park-task-group]'))?.focus({ preventScroll: true });
    }
}

function cabinetHrReminderScope() {
    const scope = window.CrmBusinessContext?.scope?.();
    return JSON.stringify([scope?.mode, scope?.activeContext, scope?.selectedContexts || []]);
}

function renderProfileControlNewBadge({ announce = false } = {}) {
    const count = window.getUnreadControlCompletionCount?.() || 0;
    return `<span class="profile-control-new"${announce ? ' role="status"' : ''}><span data-profile-control-new${count ? '' : ' hidden'}>${count ? `Нових: ${count}` : ''}</span></span>`;
}

let profileControlCompletionSignature = '';

function syncProfileControlNewBadge(event) {
    const completions = event?.detail?.alerts?.filter(alert => alert.type === 'control_completion');
    if (completions) {
        const signature = completions.map(alert => alert.id).sort().join('|');
        if (signature !== profileControlCompletionSignature) {
            profileControlCompletionSignature = signature;
            if (!document.hidden && activeTab === 'control') void loadProfileControlTasks();
        }
    }
    const count = window.getUnreadControlCompletionCount?.() || 0;
    const label = count ? `Нових: ${count}` : '';
    document.querySelectorAll('[data-profile-control-new]').forEach(badge => {
        if (badge.textContent === label) return;
        badge.hidden = !count;
        badge.textContent = label;
    });
}

const PROFILE_CONTROL_VIEWS = ['control', 'controlCompleted'];

function profileControlState(view) {
    const state = profileControlTasks?.[view];
    return state?.scope === cabinetHrReminderScope() ? state : null;
}

function profileControlCount() {
    return profileControlState('control')?.meta?.total
        ?? (myCabinetData?.hrReminderScope === cabinetHrReminderScope() ? myCabinetData.stats?.controlCount : null);
}

function syncProfileControlCount() {
    const badge = document.querySelector?.('[data-profile-control-count]');
    if (!badge) return;
    const count = profileControlCount();
    badge.hidden = count == null;
    badge.textContent = count ?? '';
}

function renderProfileControlList(view) {
    const completed = view === 'controlCompleted';
    const state = profileControlState(view);
    const tasks = state?.tasks || [];
    const meta = state?.meta;
    return `${tasks.length ? `<ul>${tasks.map(task => {
            const id = cabinetProjectionTaskId(task);
            const date = completed
                ? cabinetTaskDateKeyFromValue(task.completedAt || task.completed_at)
                : cabinetTaskFocusDateKey(task);
            const overdue = !completed && date && date < cabinetDateKeyOffset();
            const datePrefix = completed ? 'Завершено · ' : (overdue ? 'Прострочено · ' : '');
            return `<li>
                <a href="/tasks?view=my&amp;open=${id}">${escapeHtml(task.title || 'Без назви')}</a>
                <span>${task.ownerLabel ? `${completed ? 'Виконавець:' : 'Виконує'} ${escapeHtml(task.ownerLabel)}` : 'Виконавця не призначено'}</span>
                ${date ? `<span${overdue ? ' class="is-overdue"' : ''}>${datePrefix}<time datetime="${escapeHtml(date)}">${escapeHtml(profileEmployeeDateText(date))}</time></span>` : '<span>Без дати</span>'}
            </li>`;
        }).join('')}</ul>` : ''}
        ${!state || (state.loading && !tasks.length) ? '<p>Завантажуємо задачі…</p>' : ''}
        ${state?.error ? `<p role="alert">${escapeHtml(state.error)}</p>` : ''}
        ${meta && !tasks.length && !state.loading && !state.error ? `<p>${completed ? 'Ще немає завершених задач на контролі.' : 'Зараз немає відкритих задач на контролі.'}</p>` : ''}
        ${state?.error || meta?.nextCursor ? `<button type="button" class="cabinet-bucket-more" data-profile-control-offset="${state.error ? state.offset : Number(meta.nextCursor.offset)}"${state.loading ? ' disabled' : ''}>${state.error ? 'Повторити' : 'Показати ще'}</button>` : ''}`;
}

function renderProfileControlTasks() {
    const active = profileControlView;
    return `<section class="profile-work-panel profile-control-tasks" aria-labelledby="profileControlHeading" data-profile-control-panel>
        <h2 id="profileControlHeading" tabindex="-1">На контролі</h2>
        <div class="profile-control-tabs" role="tablist" aria-labelledby="profileControlHeading">
            <button id="profile-control-active" type="button" role="tab" aria-controls="profile-control-panel-control" aria-selected="${active === 'control'}" tabindex="${active === 'control' ? 0 : -1}" data-profile-control-view="control">Активні</button>
            <button id="profile-control-completed" type="button" role="tab" aria-controls="profile-control-panel-controlCompleted" aria-selected="${active === 'controlCompleted'}" tabindex="${active === 'controlCompleted' ? 0 : -1}" data-profile-control-view="controlCompleted">Завершені ${renderProfileControlNewBadge()}</button>
        </div>
        ${PROFILE_CONTROL_VIEWS.map(view => `<div id="profile-control-panel-${view}" role="tabpanel" aria-labelledby="profile-control-${view === 'control' ? 'active' : 'completed'}" data-profile-control-list="${view}"${view === active ? ' tabindex="0"' : ' hidden'}>${renderProfileControlList(view)}</div>`).join('')}
    </section>`;
}

function bindProfileControlTabs() {
    const panel = document.querySelector('[data-profile-control-panel]');
    if (!panel || panel.dataset.bound) return;
    panel.dataset.bound = 'true';
    const tabs = [...panel.querySelectorAll('[data-profile-control-view]')];
    panel.addEventListener('click', event => {
        const tab = event.target.closest('[data-profile-control-view]');
        if (tab && profileControlView !== tab.dataset.profileControlView) {
            profileControlView = tab.dataset.profileControlView;
            for (const button of tabs) {
                const selected = button === tab;
                const list = document.getElementById(button.getAttribute('aria-controls'));
                button.setAttribute('aria-selected', String(selected));
                button.tabIndex = selected ? 0 : -1;
                list.hidden = !selected;
                if (selected) list.tabIndex = 0;
                else list.removeAttribute('tabindex');
            }
            void loadProfileControlTasks();
        }
        const more = event.target.closest('[data-profile-control-offset]');
        if (more) void loadProfileControlTasks(Number(more.dataset.profileControlOffset));
    });
    panel.addEventListener('keydown', event => {
        const tab = event.target.closest('[data-profile-control-view]');
        const index = tabs.indexOf(tab);
        if (index < 0) return;
        const next = { ArrowLeft: (index + tabs.length - 1) % tabs.length,
            ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
        if (!Number.isInteger(next)) return;
        event.preventDefault();
        tabs.forEach((button, i) => { button.tabIndex = i === next ? 0 : -1; });
        tabs[next].focus();
    });
    panel.addEventListener('focusout', event => {
        if (!event.target.closest('[data-profile-control-view]') || event.relatedTarget?.closest?.('[data-profile-control-view]')) return;
        tabs.forEach(button => { button.tabIndex = button.dataset.profileControlView === profileControlView ? 0 : -1; });
    });
}

async function loadProfileControlTasks(offset = 0) {
    if (!isOwnProfile || activeTab !== 'control') return;
    const view = profileControlView;
    const scope = cabinetHrReminderScope();
    const previous = profileControlState(view);
    if (previous?.loading) return;
    profileControlTasks ||= {};
    const state = { scope, offset, tasks: previous?.tasks || [], meta: previous?.meta || null, loading: true };
    profileControlTasks[view] = state;
    const repaint = () => {
        if (state !== profileControlState(view) || activeTab !== 'control') return;
        const list = document.getElementById(`profile-control-panel-${view}`);
        if (!list) return;
        const focused = list.contains(document.activeElement);
        if (focused) list.focus({ preventScroll: true });
        list.setAttribute('aria-busy', String(state.loading));
        list.innerHTML = renderProfileControlList(view);
    };
    repaint();
    try {
        const payload = await apiGetScopedJson(`/tasks/my-cabinet?bucket=${view}&offset=${offset}&limit=${CABINET_BUCKET_PAGE_LIMIT}`);
        if (!Array.isArray(payload?.tasks) || !payload.meta?.bucketPage) throw new Error('Missing task control projection');
        const existing = offset ? state.tasks : [];
        const seen = new Set(existing.map(cabinetProjectionTaskId));
        state.tasks = [...existing, ...payload.tasks.filter(task => !seen.has(cabinetProjectionTaskId(task)))];
        state.meta = payload.meta.bucketPage;
        if (view === 'control' && state === profileControlState(view)) syncProfileControlCount();
    } catch (error) {
        state.error = 'Не вдалося завантажити задачі на контролі.';
    } finally {
        state.loading = false;
        repaint();
    }
}

function renderMyDayHrReminders() {
    if (!isOwnProfile) return '';
    if (myCabinetData?.hrReminderScope !== cabinetHrReminderScope()) return '';
    const reminders = myCabinetData?.hrReminders;
    if (reminders === null) return '<p role="status">Не вдалося завантажити нагадування HR. Оновіть сторінку.</p>';
    if (!Array.isArray(reminders) || !reminders.length) return '';
    const stages = { overdue: 'Прострочено', today: 'Сьогодні', upcoming: 'Наближається строк' };
    return `<section id="hr-personal-reminders" class="profile-work-panel" aria-label="Нагадування HR">
        <h2>Нагадування HR</h2>
        <ul>${reminders.map(item => `<li>
            <strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(stages[item.stage] || '')}
            <time datetime="${escapeHtml(item.dueDate)}">${escapeHtml(item.dueDate)}</time>
            <div>${escapeHtml(item.message)}</div>
        </li>`).join('')}</ul>
    </section>`;
}

function renderParkMyDayWorkspace() {
    const today = myCabinetData?.meta?.calendar?.today || cabinetDateKeyOffset(0);
    const activeTasks = cabinetActiveMyDaySourceTasks();
    const currentFocusProjection = myCabinetData?.meta?.calendar?.focusDate === myDayLinkedDate;
    const listFor = bucket => {
        const projected = bucket !== 'focusDate' || currentFocusProjection ? myCabinetData?.planning?.[bucket] : null;
        const tasks = Array.isArray(projected) ? projected : activeTasks.filter(task => {
            if (!cabinetTaskIsOpenForMyDay(task) || isCabinetDeferredTask(task)) return false;
            const due = cabinetTaskFocusDateKey(task);
            return bucket === 'overdue' ? due && due < today
                : bucket === 'future' ? due > today
                : bucket === 'focusDate' ? due === myDayLinkedDate
                : bucket === 'noDate' ? !due : due === today;
        });
        return tasks.filter(task => window.ProfileMyDay?.taskRole(task) !== 'author');
    };
    const totalFor = bucket => cabinetBucketMeta(bucket)?.total ?? listFor(bucket).length;
    const group = (bucket, title, empty) => {
        const list = listFor(bucket);
        const metadata = bucket !== 'focusDate' || currentFocusProjection ? cabinetBucketMeta(bucket) : null;
        const total = metadata?.total ?? list.length;
        const sectionOptions = {
            className: 'park-period-section',
            cardOptions: { surface: 'myday' },
            countLabel: `Показано ${list.length} із ${total}`,
            footer: metadata ? renderCabinetBucketMore(bucket) : '',
            sectionAttrs: `data-park-task-group="${bucket}" aria-label="${escapeHtml(title)}" tabindex="-1"`
        };
        if (!list.length || !window.ProfileMyDay) {
            const message = metadata?.hasMore ? 'Задачі цієї групи ще не завантажено.' : empty;
            return renderCabinetSection(title, list, message, sectionOptions);
        }
        const roleGroups = ['executor', 'participant', 'viewer'].map(role => ({
            role, tasks: list.filter(task => window.ProfileMyDay.taskRole(task) === role)
        })).filter(item => item.tasks.length);
        return `<section class="cabinet-task-section park-period-section" ${sectionOptions.sectionAttrs}>
            <div class="cabinet-section-head"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(sectionOptions.countLabel)}</span></div>
            <div class="cabinet-section-body">${roleGroups.map(({ role, tasks }) => `
                <div class="park-my-day-role-group"><h4>${escapeHtml(window.ProfileMyDay.roleLabel(role))}</h4>
                    ${tasks.map(task => renderCabinetTaskCard(task, false, sectionOptions.cardOptions)).join('')}
                </div>`).join('')}${sectionOptions.footer || ''}</div></section>`;
    };
    let content;
    if (myCabinetLoadState === 'loading' && !myCabinetData) content = renderCabinetLoadingSkeleton();
    else if (!myCabinetData && myCabinetLoadError) content = '';
    else {
        const linkedPeriod = myDayLinkedDate && myDayLinkedDate !== today
            ? (myDayLinkedDate < today ? 'overdue' : 'future') : null;
        const noDate = `<details class="park-undated"${myDayUndatedOpen ? ' open' : ''}>
            <summary>Без дати · ${totalFor('noDate')}</summary>
            ${group('noDate', 'Без дати', 'Задач без дати немає.')}
        </details>`;
        const periods = [
            ['today', group('today', 'Сьогодні', 'На сьогодні задач немає.')],
            ['overdue', group('overdue', 'Прострочені', 'Немає прострочених задач.')],
            ['future', group('future', 'Майбутні', 'Немає майбутніх задач.')]
        ];
        content = periods.map(([key, sections]) => `<div class="park-period-column" data-park-period="${key}">${
            key === linkedPeriod ? group('focusDate', `Задачі на ${profileEmployeeDateText(myDayLinkedDate)}`, 'На цю дату немає активних задач.') : sections
        }</div>`).join('') + noDate;
    }
    return `
        <section id="cabinetMyDaySegmentPanel" class="park-my-day-workspace" aria-label="Список задач">
            <div class="park-my-day-groups">${content}</div>
        </section>`;
}

function renderMyDayCommandCenterTab() {
    const composerOpen = window.matchMedia?.('(min-width: 64rem)').matches;
    return `
        <div class="cabinet-shell cabinet-command-center park-my-day" id="myDayDayPanel">
            <div data-park-my-day-reminders>${renderMyDayHrReminders()}</div>
            <nav class="park-task-navigation" aria-label="Перегляди задач">
                <a href="/profile?tab=control" data-profile-control-shortcut>На контролі</a>
                <a href="/tasks?view=team" data-profile-team-link>Задачі команди</a>
            </nav>
            <details class="park-composer"${composerOpen ? ' open' : ''}>
                <summary>Нова задача</summary>
                ${renderCabinetTaskComposer({ segment: 'all', mode: 'work', simple: true })}
            </details>
            <div data-park-my-day-notice role="status">${renderCabinetLoadNotice()}</div>
            <div class="park-day-board">
                ${renderParkMyDayWorkspace()}
                ${renderCabinetCompletionPulse()}
            </div>
        </div>`;
}

function renderMyDayTab() {
    return renderMyDayCommandCenterTab();
}

function focusMyDayTaskDate(due) {
    if (myDayLinkedDate === due) return;
    myDayLinkedDate = due;
    const today = cabinetDateKeyOffset(0);
    if (activeTab === 'myday') rerenderCabinetMyDaySegmentPanel();
    if (due && due !== today) {
        void refreshMyCabinetTab({ silent: true, keepExistingOnError: true, focusDate: due });
    }
}

function syncMyDayTaskDialog(opener = null, { initialize = false } = {}) {
    const current = document.querySelector('.park-task-dialog[open]');
    const url = new URL(window.location.href);
    if (initialize && isOwnProfile && activeTab === 'myday' && url.searchParams.has('taskContextChanged')) {
        url.searchParams.delete('taskContextChanged');
        window.history.replaceState(window.history.state, '', url);
        showNotification('Активний бізнес змінився. Задача з попереднього бізнесу не відкрилася.', 'info');
    }
    const rawId = url.searchParams.get('open');
    const taskId = isOwnProfile && activeTab === 'myday' && /^[1-9]\d*$/.test(rawId || '')
        ? Number(rawId) : null;
    if (current && Number(current.dataset.myDayTask) === taskId
        && current.dataset.myDayMode === (url.searchParams.get('mode') || '')) return;
    if (current?.canLeave && !current.canLeave()) {
        window.history.pushState({ ...window.history.state, myDayTask: Number(current.dataset.myDayTask) }, '', current.taskLocation);
        return;
    }
    current?.close();
    if (!Number.isSafeInteger(taskId) || !window.ProfileMyDay) {
        if (rawId && isOwnProfile && activeTab === 'myday') {
            window.ProfileMyDay?.openTaskDialog({ taskId: '—', opener,
                load: () => Promise.reject(Object.assign(new Error('Некоректне посилання на задачу.'), { status: 400 })),
                onClose: dialog => {
                    if (dialog.dataset.keepTaskIntent === 'true') return;
                    url.searchParams.delete('open'); window.history.replaceState(window.history.state, '', url);
                }
            });
        }
        focusMyDayTaskDate(null);
        return;
    }
    const returnTo = window.TaskLinks?.taskCenterReturnUrl(url.searchParams.get('returnTo'));
    if (initialize && !returnTo && window.history.state?.myDayTask !== taskId) {
        const base = new URL(url);
        base.searchParams.delete('open');
        base.searchParams.delete('date');
        base.searchParams.delete('mode');
        window.history.replaceState(window.history.state, '', base);
        window.history.pushState({ ...window.history.state, myDayTask: taskId }, '', url);
    }
    const date = url.searchParams.get('date');
    if (date === 'undated') focusMyDayTaskDate('');
    else if (/^\d{4}-\d{2}-\d{2}$/.test(date || '')) focusMyDayTaskDate(date);
    window.ProfileMyDay.openTaskDialog({
        taskId, opener, mode: url.searchParams.get('mode'),
        load: signal => apiGetScopedJson(`/tasks/${taskId}`, { signal, cache: 'no-store' }),
        loadHistory: signal => apiGetScopedJson(`/tasks/${taskId}/history`, { signal, cache: 'no-store' }),
        draftScope: { actor: AppState.currentUser?.id, business: AppState.currentUser?.activeBusinessContext },
        save: (task, patch, operationId) => submitMyDayTaskAction(task, 'editor', patch, operationId),
        complete: (task, operationId) => submitMyDayTaskAction(task, 'complete', {}, operationId),
        cancel: async () => {
            const result = await apiPost(`/tasks/${taskId}/cancel`, { sourceSurface: 'profile_my_cabinet' });
            if (!result?.success) throw Object.assign(new Error(result?.error || 'Не вдалося скасувати задачу.'), {
                outcomeUnknown: !result || Number(result.status) >= 500
            });
            onMyDayTaskActionConfirmed('cancel', taskId);
        },
        reschedule: (date, task, operationId) => submitMyDayTaskAction(task, 'schedule', { deadline: profileDeadlineForDate(date) }, operationId),
        onReconciled: kind => onMyDayTaskActionConfirmed(kind, taskId),
        selectDate: task => {
            const due = cabinetTaskFocusDateKey(task);
            if (!opener && due !== date) focusMyDayTaskDate(due);
            return due;
        },
        statusLabel: task => ({ todo: 'До виконання', in_progress: 'У роботі', waiting: 'Очікує',
            review: 'На перевірці', done: 'Виконано', cancelled: 'Скасовано', archived: 'Архівна' })[cabinetTaskStatus(task)] || 'Відкрита',
        onClose: dialog => {
            if (dialog.dataset.keepTaskIntent === 'true') return;
            if (document.querySelector('.park-task-dialog[open]')) return;
            const location = new URL(window.location.href);
            if (location.searchParams.get('open') !== dialog.dataset.myDayTask) return;
            if (returnTo) {
                window.location.replace(returnTo);
                return;
            }
            if (window.history.state?.myDayTask === taskId && activeTab === 'myday') {
                window.history.back();
                return;
            }
            location.searchParams.delete('open');
            location.searchParams.delete('date');
            location.searchParams.delete('mode');
            window.history.replaceState(window.history.state, '', location);
            focusMyDayTaskDate(null);
        }
    });
}

function setMyTasksSegment(segment) {
    myTasksSegment = CABINET_TASK_SEGMENTS.some(item => item.id === segment) ? segment : 'all';
    const tabContent = document.getElementById('tabContent');
    if (tabContent) {
        tabContent.innerHTML = renderTabContent();
        attachProfileListeners();
    }
}

function normalizeCabinetTaskId(value) {
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function rerenderCabinetTaskTabs() {
    const tabContent = document.getElementById('tabContent');
    if (!tabContent || !isProfileTaskProjectionTab(activeTab)) return;
    tabContent.innerHTML = renderTabContent();
    attachProfileListeners();
}

function normalizeCabinetRestoreStatus(value) {
    return ['todo', 'in_progress'].includes(value) ? value : 'todo';
}

function closeCabinetSnoozeMenus(exceptWrap = null) {
    document.querySelectorAll('.cabinet-task-actions.is-snooze-open').forEach(actions => {
        if (exceptWrap && actions.contains(exceptWrap)) return;
        actions.classList.remove('is-snooze-open');
        actions.querySelectorAll('[data-cabinet-task-action="snooze-menu"]').forEach(btn => {
            btn.setAttribute('aria-expanded', 'false');
        });
        actions.querySelectorAll('.cabinet-snooze-menu').forEach(menu => {
            menu.hidden = true;
        });
    });
    document.querySelectorAll('.cabinet-reschedule-wrap.is-open').forEach(wrap => {
        if (exceptWrap && wrap === exceptWrap) return;
        wrap.classList.remove('is-open');
        wrap.querySelectorAll('[data-cabinet-task-action="reschedule-overdue-menu"]').forEach(btn => {
            btn.setAttribute('aria-expanded', 'false');
        });
        wrap.querySelectorAll('.cabinet-reschedule-menu').forEach(menu => {
            menu.hidden = true;
        });
    });
}

function toggleCabinetSnoozeMenu(button) {
    const actions = button.closest('.cabinet-task-actions');
    const wrap = button.closest('.cabinet-snooze-wrap');
    const menu = wrap?.querySelector('.cabinet-snooze-menu');
    if (!actions || !menu) return;
    const willOpen = menu.hidden;
    closeCabinetSnoozeMenus(wrap);
    actions.classList.toggle('is-snooze-open', willOpen);
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function toggleCabinetRescheduleMenu(button) {
    const wrap = button.closest('.cabinet-reschedule-wrap');
    const menu = wrap?.querySelector('.cabinet-reschedule-menu');
    if (!wrap || !menu) return;
    const willOpen = menu.hidden;
    closeCabinetSnoozeMenus(wrap);
    wrap.classList.toggle('is-open', willOpen);
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function clearCabinetTaskDragState() {
    document.querySelectorAll('.cabinet-task-card.is-dragging').forEach(card => {
        card.classList.remove('is-dragging');
        card.setAttribute('aria-grabbed', 'false');
    });
    document.querySelectorAll('.cabinet-task-section--drop-target.is-drag-over').forEach(section => {
        section.classList.remove('is-drag-over');
    });
    document.body?.classList.remove('cabinet-task-dragging');
    window.TaskUI?.closeDropDock?.();
    cabinetTaskDragState = null;
}

function isCabinetTaskDragInteractiveTarget(target) {
    return Boolean(target?.closest?.('button, a, input, select, textarea, label, [role="menu"], .cabinet-snooze-menu'));
}

function handleCabinetTaskDragStart(event) {
    const card = event.target?.closest?.('[data-cabinet-task-drag]');
    if (!card || !card.closest('.cabinet-shell')) return;
    if (card.dataset.cabinetTaskDragTarget && card.dataset.cabinetTaskDragTarget !== 'today') return;
    if (isCabinetTaskDragInteractiveTarget(event.target)) {
        event.preventDefault();
        return;
    }
    const taskId = normalizeCabinetTaskId(card.dataset.taskId);
    if (!taskId) {
        event.preventDefault();
        return;
    }
    cabinetTaskDragState = { taskId };
    card.classList.add('is-dragging');
    card.setAttribute('aria-grabbed', 'true');
    document.body?.classList.add('cabinet-task-dragging');
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(taskId));
    }
    const task = findCabinetTask(taskId) || {};
    window.TaskUI?.showDropDock?.({
        title: 'Перенести в',
        targets: cabinetTaskMoveTargets(task),
        onSelect: async target => {
            const currentTaskId = cabinetTaskDragState?.taskId || taskId;
            clearCabinetTaskDragState();
            try {
                await executeCabinetMoveTarget(currentTaskId, target, { method: 'drag' });
            } catch (error) {
                console.error('Profile cabinet DropDock move failed', error);
                if (typeof showNotification === 'function') {
                    showNotification(error?.message || 'Не вдалося перенести задачу', 'error');
                }
            }
        }
    });
}

function handleCabinetTaskDragOver(event) {
    if (!cabinetTaskDragState) return;
    const section = event.target?.closest?.('[data-cabinet-task-drop-target="today"]');
    if (!section) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    section.classList.add('is-drag-over');
}

function handleCabinetTaskDragLeave(event) {
    const section = event.target?.closest?.('[data-cabinet-task-drop-target="today"]');
    if (!section || section.contains(event.relatedTarget)) return;
    section.classList.remove('is-drag-over');
}

async function handleCabinetTaskDrop(event) {
    const section = event.target?.closest?.('[data-cabinet-task-drop-target="today"]');
    if (!section || !cabinetTaskDragState) return;
    event.preventDefault();
    const taskId = normalizeCabinetTaskId(event.dataTransfer?.getData('text/plain') || cabinetTaskDragState.taskId);
    clearCabinetTaskDragState();
    if (!taskId) return;
    try {
        await moveCabinetTaskToToday(taskId, 'drag');
    } catch (error) {
        console.error('Profile cabinet overdue drop failed', error);
        if (typeof showNotification === 'function') {
            showNotification(error?.message || 'Не вдалося перенести задачу на сьогодні', 'error');
        }
    }
}

function bindCabinetTaskDragDrop() {
    if (cabinetTaskDragDropBound) return;
    cabinetTaskDragDropBound = true;
    document.addEventListener('dragstart', handleCabinetTaskDragStart);
    document.addEventListener('dragover', handleCabinetTaskDragOver);
    document.addEventListener('dragleave', handleCabinetTaskDragLeave);
    document.addEventListener('drop', handleCabinetTaskDrop);
    document.addEventListener('dragend', clearCabinetTaskDragState);
}

function showCabinetTaskUndoToast(taskId, restoreStatus = 'todo', options = {}) {
    const existing = document.querySelector('.cabinet-task-undo-toast');
    if (existing) existing.remove();
    if (cabinetUndoToastTimer) clearTimeout(cabinetUndoToastTimer);

    const toast = document.createElement('div');
    toast.className = 'cabinet-task-undo-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
        <span>${escapeHtml(options.message || 'Задачу виконано')}</span>
        <button type="button" data-cabinet-undo-task="${taskId}">Скасувати</button>`;
    const undoBtn = toast.querySelector('[data-cabinet-undo-task]');
    let remaining = 12000;
    let expiresAt = 0;
    let busy = false;
    const pause = () => {
        if (cabinetUndoToastTimer) clearTimeout(cabinetUndoToastTimer);
        cabinetUndoToastTimer = null;
        if (expiresAt) remaining = Math.max(0, expiresAt - Date.now());
        expiresAt = 0;
    };
    const scheduleDismiss = () => {
        if (busy || toast.matches(':hover') || toast.contains(document.activeElement) || !toast.isConnected) return;
        if (cabinetUndoToastTimer) clearTimeout(cabinetUndoToastTimer);
        expiresAt = Date.now() + remaining;
        cabinetUndoToastTimer = setTimeout(() => {
            toast.classList.remove('is-visible');
            setTimeout(() => toast.remove(), 240);
            cabinetUndoToastTimer = null;
        }, remaining);
    };
    toast.addEventListener('pointerenter', pause);
    toast.addEventListener('pointerleave', scheduleDismiss);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('focusout', () => queueMicrotask(scheduleDismiss));
    undoBtn?.addEventListener('click', async () => {
        busy = true;
        pause();
        undoBtn.disabled = true;
        undoBtn.setAttribute('aria-busy', 'true');
        try {
            if (options.restore) await options.restore();
            else await setCabinetTaskStatus(taskId, normalizeCabinetRestoreStatus(restoreStatus), { silent: true, allowUndo: false });
            if (typeof showNotification === 'function') showNotification('Задачу повернуто', 'success');
            toast.remove();
            document.querySelector(`.park-task-card[data-task-id="${taskId}"] [data-cabinet-task-action="open"]`)?.focus();
        } catch (error) {
            undoBtn.disabled = false;
            undoBtn.removeAttribute('aria-busy');
            busy = false;
            remaining = 12000;
            scheduleDismiss();
            if (typeof showNotification === 'function') showNotification(error?.message || 'Не вдалося скасувати дію', 'error');
        }
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    scheduleDismiss();
    return undoBtn;
}

function unlockCabinetTaskCompletionSound() {
    try {
        window.SoundEngine?.unlock?.();
    } catch {}
}

function playCabinetTaskCompletionFeedback() {
    try {
        window.SoundEngine?.playTask?.('task-complete');
    } catch {}
}

async function saveCabinetTaskSoundPreferences(patch = {}) {
    cabinetTaskSoundSettings = normalizeCabinetTaskSoundSettings({ ...cabinetTaskSoundSettings, ...patch });
    window.SoundEngine?.configureTask?.(cabinetTaskSoundSettings);
    const result = await apiPatch('/tasks/preferences', {
        task_sound_enabled: cabinetTaskSoundSettings.enabled,
        task_sound_volume: cabinetTaskSoundSettings.volume,
        task_sound_theme: cabinetTaskSoundSettings.theme
    });
    if (result?.preferences) {
        applyCabinetTaskSoundPreferences(result.preferences);
        rerenderCabinetTaskTabs();
    } else if (result && result.success === false && typeof showNotification === 'function') {
        showNotification(result.error || 'Не вдалося зберегти звук задач', 'error');
    }
}

async function patchCabinetTaskPriority(taskId, priority) {
    const result = await apiPatch(`/tasks/${taskId}/priority`, {
        priority,
        sourceSurface: 'profile_my_cabinet'
    });
    return normalizeCabinetTaskMutationResult(result, 'Не вдалося змінити пріоритет');
}

async function updateCabinetTaskPriority(select) {
    const taskId = normalizeCabinetTaskId(select?.dataset?.taskId);
    const priority = normalizeCabinetPriority(select?.value);
    if (!taskId || !select) return;
    const previous = normalizeCabinetPriority(findCabinetTask(taskId)?.priority || 'normal');
    setCabinetPrioritySelectBusy(select, true);
    const result = await patchCabinetTaskPriority(taskId, priority);
    setCabinetPrioritySelectBusy(select, false);
    if (result?.success) {
        applyCabinetTaskPriorityToProjection(taskId, priority, result.task || {});
        applyCabinetTaskPriorityVisualState(taskId, priority, select);
        notifyTaskWidgetsChanged({ action: 'task_priority', taskId, priority });
        try {
            await refreshMyCabinetTab({ silent: true });
        } catch (error) {
            console.warn('Profile cabinet priority refresh failed', error);
        }
        renderCabinetActiveTab();
        if (typeof showNotification === 'function') showNotification('Пріоритет оновлено', 'success');
        return;
    }
    applyCabinetTaskPriorityVisualState(taskId, previous, select);
    if (typeof showNotification === 'function') showNotification(result?.error || 'Не вдалося змінити пріоритет', 'error');
}

function waitForCabinetCompletionAnimation(card) {
    if (!card?.isConnected || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
    card.classList.remove('is-updating');
    card.classList.add('is-completed-feedback');
    return new Promise(resolve => setTimeout(resolve, 340));
}

async function handleCabinetTaskActionClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    const action = button?.dataset?.cabinetTaskAction || '';
    const taskId = normalizeCabinetTaskId(button?.dataset?.taskId);
    if (!taskId) {
        if (typeof showNotification === 'function') showNotification('Не вдалося визначити задачу', 'error');
        return;
    }
    const parkMenu = button.closest('.park-task-menu');
    const menuTrigger = parkMenu?.querySelector('summary');
    if (parkMenu) {
        parkMenu.open = false;
        menuTrigger?.focus({ preventScroll: true });
    }

    if (action === 'postponement-explanation') {
        openCabinetPostponementExplanation(button);
        return;
    }

    if (action === 'toggle-my-day-details') {
        const expanded = toggleCabinetMyDayTaskDetails(taskId, { rerender: true, card: button.closest('.cabinet-task-card') });
        const task = findCabinetTask(taskId);
        return;
    }

    if (action === 'priority-menu') {
        const task = findCabinetTask(taskId) || {};
        const anchor = stableCabinetTaskSurfaceAnchor(button, taskId);
        const root = window.TaskUI?.openActionMenu(anchor, renderCabinetTaskPriorityControl(task, String(taskId)), { title: 'Пріоритет задачі' });
        root?.querySelector('[data-cabinet-task-priority-select]')?.addEventListener('change', event => {
            const select = event.currentTarget;
            void updateCabinetTaskPriority(select).finally(() => window.TaskUI?.closeActionMenu?.());
        });
        return;
    }

    if (action === 'more') {
        openCabinetTaskActionMenu(button);
        return;
    }

    if (action === 'move-target') {
        const target = button.dataset.cabinetMoveTarget || '';
        button.disabled = true;
        button.classList.add('is-busy');
        window.TaskUI?.closeActionMenu?.();
        try {
            await executeCabinetMoveTarget(taskId, target, { method: button.dataset.cabinetMoveMethod || 'menu' });
        } catch (error) {
            console.error('Profile cabinet move menu failed', error);
            if (typeof showNotification === 'function') {
                showNotification(error?.message || 'Не вдалося перенести задачу', 'error');
            }
        } finally {
            if (button.isConnected) {
                button.disabled = false;
                button.classList.remove('is-busy');
            }
        }
        return;
    }

    if (action === 'snooze-menu') {
        toggleCabinetSnoozeMenu(button);
        return;
    }

    if (action === 'reschedule-overdue-menu') {
        toggleCabinetRescheduleMenu(button);
        return;
    }

    if (action === 'restore-completed') {
        try { await setCabinetTaskStatus(taskId, 'todo'); }
        catch (error) { window.showNotification?.(error.message, 'error'); }
        return;
    }

    if (action === 'open' || action === 'edit') {
        const mode = action === 'edit' ? 'edit' : '';
        if (activeTab === 'myday' && window.ProfileMyDay) {
            const url = new URL(window.location.href);
            url.searchParams.set('open', String(taskId));
            url.searchParams.delete('date');
            if (mode) url.searchParams.set('mode', mode);
            else url.searchParams.delete('mode');
            window.history.pushState({ ...window.history.state, myDayTask: taskId }, '', url);
            syncMyDayTaskDialog(menuTrigger || button);
        } else if (window.TaskDetailDrawer?.open) {
            window.TaskDetailDrawer.open(taskId, { view: 'my', mode, sourceSurface: 'profile_my_day' });
        } else {
            const task = findCabinetTask(taskId) || {};
            window.location.href = TaskLinks.taskUrl(taskId, { businessContext: task.business_context || task.businessContext, mode });
        }
        return;
    }

    if (action === 'move-to-today') {
        const quickAction = button.dataset.cabinetMoveUndo === 'true';
        button.disabled = true;
        button.classList.add('is-busy');
        const card = button.closest('.cabinet-task-card, .cabinet-overdue-triage-row');
        card?.classList.add('is-updating');
        try {
            await moveCabinetTaskToToday(taskId, 'button', { undo: quickAction, focusUndo: event.detail === 0 });
        } catch (error) {
            console.error('Profile cabinet move to today failed', error);
            if (typeof showNotification === 'function') {
                showNotification(error?.message || 'Не вдалося перенести задачу на сьогодні', 'error');
            }
        } finally {
            if (button.isConnected) {
                button.disabled = false;
                button.classList.remove('is-busy');
            }
            if (card?.isConnected) card.classList.remove('is-updating');
        }
        return;
    }

    const card = button.closest('.cabinet-task-card, .cabinet-overdue-triage-row');
    const previousStatus = normalizeCabinetRestoreStatus(card?.dataset?.taskStatus || 'todo');
    const restore = action === 'done' && document.activeElement === button
        ? window.ProfileMyDay?.preservePosition(document.getElementById('tabContent')) : null;
    button.disabled = true;
    button.classList.add('is-busy');
    card?.classList.add('is-updating');
    try {
        if (action === 'done') {
            unlockCabinetTaskCompletionSound();
            await setCabinetTaskStatus(taskId, 'done', {
                previousStatus, task: findCabinetTask(taskId) || {}, card, restore, focusUndo: event.detail === 0
            });
        } else if (action === 'snooze') {
            closeCabinetSnoozeMenus();
            let minutes = button.dataset.minutes || 60;
            if (minutes === 'custom') {
                const raw = typeof promptModal === 'function' ? await promptModal('На скільки хвилин відкласти задачу?', { inputType: 'number', defaultValue: '60' }) : null;
                if (raw === null) return;
                minutes = raw;
            }
            await snoozeCabinetTask(taskId, minutes);
        } else if (action === 'reschedule-date') {
            if (cabinetTaskAllowsReschedule(findCabinetTask(taskId) || {})) {
                await rescheduleCabinetTask(taskId, 'custom', { sourceSurface: 'profile_my_cabinet' });
            }
        } else if (action === 'reschedule-overdue') {
            closeCabinetSnoozeMenus();
            const sourceSurface = button.dataset.sourceSurface || '';
            await rescheduleCabinetTask(taskId, button.dataset.rescheduleOption || 'tomorrow', sourceSurface ? { sourceSurface } : {});
        }
    } catch (error) {
        console.error('Profile cabinet task action failed', error);
        if (typeof showNotification === 'function') {
            showNotification(error?.message || 'Не вдалося виконати дію із задачею', 'error');
        }
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.classList.remove('is-busy');
        }
        if (card?.isConnected) card.classList.remove('is-updating');
    }
}

function bindCabinetTaskActions(root = document) {
    root?.querySelectorAll?.('[data-cabinet-task-action]').forEach(button => {
        if (button.dataset.cabinetActionBound === 'true') return;
        button.dataset.cabinetActionBound = 'true';
        button.addEventListener('click', handleCabinetTaskActionClick);
    });
}

function bindCabinetCompletionPulse(root = document) {
    root?.querySelectorAll?.('[data-cabinet-completion-toggle]').forEach(button => {
        if (button.dataset.cabinetCompletionToggleBound === 'true') return;
        button.dataset.cabinetCompletionToggleBound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            toggleCabinetCompletionDetails();
        });
    });
    root?.querySelectorAll?.('[data-cabinet-completion-tab]').forEach(button => {
        if (button.dataset.cabinetCompletionTabBound === 'true') return;
        button.dataset.cabinetCompletionTabBound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setCabinetCompletionTab(button.dataset.cabinetCompletionTab || 'today');
            document.getElementById(button.id)?.focus({ preventScroll: true });
        });
        button.addEventListener('keydown', event => {
            const current = button.dataset.cabinetCompletionTab;
            const arrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
            if (!arrow && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            const tab = arrow ? (current === 'today' ? 'history' : 'today') : (event.key === 'Home' ? 'today' : 'history');
            setCabinetCompletionTab(tab);
            document.getElementById(tab === 'today' ? 'cabinetCompletionTabToday' : 'cabinetCompletionTabHistory')?.focus({ preventScroll: true });
        });
    });
    root?.querySelectorAll?.('[data-cabinet-completion-all]').forEach(button => {
        if (button.dataset.cabinetCompletionAllBound === 'true') return;
        button.dataset.cabinetCompletionAllBound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            showMoreCabinetCompletionDetails().catch(error => {
                console.error('Completion history pagination failed', error);
                const state = cabinetCompletionHistoryState();
                state.loading = false;
                state.error = error?.message || 'Не вдалося завантажити історію виконань.';
                rerenderCabinetCompletionPulse();
            });
        });
    });
}

function bindCabinetCompletedTodayDashboard(root = document) {
    bindCabinetCompletionPulse(root);
}

async function refreshMyCabinetTab(options = {}) {
    const projection = await loadMyCabinetProjection({
        keepExistingOnError: options.keepExistingOnError !== false,
        focusDate: options.focusDate || '',
        force: options.force === true
    });
    applyCabinetTaskSoundPreferences(myCabinetData?.preferences || {});

    if (!options.silent) renderCabinetActiveTab();
    return projection;
}

async function verifyCabinetCreatedTask(result = {}, focusDate = '', allowOutsideProjection = false) {
    const taskId = createdCabinetTaskId(result);
    if (!taskId) {
        return {
            ok: false,
            reason: 'missing_id',
            message: 'Сервер не повернув ID створеної задачі. Успіх не підтверджено.'
        };
    }

    const projection = await refreshMyCabinetTab({ silent: true, force: true, focusDate });
    if (cabinetTaskProjectionContainsId(projection, taskId)) {
        return { ok: true, taskId };
    }

    const canonical = await apiGet(`/tasks/${encodeURIComponent(taskId)}`);
    const canonicalId = createdCabinetTaskId({ task: canonical?.task || canonical });
    if (canonicalId === taskId) {
        if (allowOutsideProjection) return { ok: true, taskId };
        const refreshed = await refreshMyCabinetTab({ silent: true, force: true, focusDate });
        if (cabinetTaskProjectionContainsId(refreshed, taskId)) return { ok: true, taskId };
        return {
            ok: false, taskId, reason: 'projection_missing',
            message: `Сервер створив задачу #${taskId}, але Мій день її ще не показує. Оновіть список.`
        };
    }

    return {
        ok: false,
        taskId,
        reason: 'canonical_missing',
        message: `CRM не підтвердила задачу #${taskId} після створення. Оновіть сторінку і перевірте список задач.`
    };
}

function showCabinetTaskCreateSuccessToast(result = {}, draft = {}, verification = {}, postCreateWarningCount = 0) {
    const taskId = verification.taskId || createdCabinetTaskId(result);
    const task = result.task || { id: taskId, title: draft.title, category: draft.category, priority: draft.priority };
    const payload = window.TaskCreate?.buildCreateNotification
        ? window.TaskCreate.buildCreateNotification([task], [draft], { postCreateWarningCount })
        : {
            type: postCreateWarningCount > 0 ? 'warning' : 'success',
            title: 'Задачу створено в основних задачах',
            message: draft.title ? `«${draft.title}»` : 'Задачу додано в основний список',
            details: postCreateWarningCount > 0 ? [`Потрібно перевірити: ${postCreateWarningCount}`] : [],
            durationMs: 8000,
            fadeDurationMs: 850,
            pauseOnInteract: true,
            closeButton: true
        };
    payload.title = 'Задачу створено в основних задачах';
    if (taskId) {
        payload.actions = [
            {
                label: 'Відкрити',
                href: TaskLinks.taskUrl(taskId, { businessContext: task.business_context || task.businessContext })
            },
            {
                label: 'Редагувати',
                href: TaskLinks.taskUrl(taskId, { businessContext: task.business_context || task.businessContext, mode: 'edit' })
            }
        ];
    }
    showNotification(payload, payload.type || 'success');
}

async function setCabinetTaskStatus(taskId, status, options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) throw new Error('Invalid task id');
    let result;
    if (status === 'done') {
        const sourceSurface = 'profile_my_cabinet';
        result = await apiPost(`/tasks/${id}/complete`, { sourceSurface });
    } else {
        const sourceSurface = 'profile_my_cabinet';
        result = await apiPatch(`/tasks/${id}/status`, { status, sourceSurface });
    }
    const mutation = normalizeCabinetTaskMutationResult(result, 'Task status update failed');
    if (!mutation.success) throw new Error(mutation.error || 'Task status update failed');
    notifyTaskWidgetsChanged({ action: 'task_status', taskId: id, status });
    const updatedTask = result.task || result.data?.task || {};
    const appliedLocal = status === 'done'
        ? applyCabinetTaskStatusToProjection(id, status, updatedTask, options.task || {})
        : false;
    let undo;
    const feedback = !options.silent && status === 'done' && options.allowUndo !== false;
    if (feedback) {
        playCabinetTaskCompletionFeedback();
    } else if (!options.silent && typeof showNotification === 'function') {
        showNotification(status === 'done' ? 'Задачу виконано' : 'Статус задачі оновлено', 'success');
    }
    if (status === 'done') {
        if (!appliedLocal) await refreshMyCabinetTab({ silent: true, force: true });
        const update = () => {
            if (feedback) undo = showCabinetTaskUndoToast(id, options.previousStatus || 'todo');
            renderCabinetActiveTab();
            options.restore?.();
            if (options.focusUndo) undo?.focus();
        };
        if (!feedback || !window.ProfileMyDay?.transitionCompletion(options.card, update)) {
            if (feedback) await waitForCabinetCompletionAnimation(options.card);
            update();
        }
        scheduleCabinetProjectionRefresh();
    } else {
        await refreshMyCabinetTab({ silent: true, force: true });
        renderCabinetActiveTab();
    }
    return { ...result, appliedLocal };
}

async function snoozeCabinetTask(taskId, minutes) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) throw new Error('Invalid task id');
    const delay = Math.max(5, parseInt(minutes, 10) || 60);
    const result = await apiPost(`/tasks/${id}/snooze`, {
        minutes: delay,
        sourceSurface: 'profile_my_cabinet'
    });
    if (!result?.success) throw new Error(result?.error || 'Task snooze failed');
    notifyTaskWidgetsChanged({ action: 'task_snooze', taskId: id });
    if (typeof showNotification === 'function') showNotification(`Задачу відкладено на ${delay} хв`, 'success');
    await refreshMyCabinetTab();
}

async function rescheduleCabinetTask(taskId, option = 'tomorrow', options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) throw new Error('Invalid task id');
    let dateText = '';
    if (options.date) {
        dateText = options.date;
    } else if (option === 'today') {
        dateText = cabinetDateKeyOffset();
    } else if (option === 'day_after') {
        dateText = profileDateOffsetStr(2);
    } else if (option === 'custom') {
        dateText = typeof promptModal === 'function'
            ? await promptModal('Нова дата для задачі:', { inputType: 'date', defaultValue: profileDateOffsetStr(1) })
            : null;
    } else {
        dateText = profileDateOffsetStr(1);
    }
    if (!dateText) return { cancelled: true };
    const sourceSurface = options.sourceSurface || 'profile_my_cabinet_overdue_badge';
    const result = await apiPost(`/tasks/${id}/reschedule`, {
        deadline: profileDeadlineForDate(dateText),
        sourceSurface
    });
    if (!result?.success) throw new Error(result?.error || 'Task reschedule failed');
    notifyTaskWidgetsChanged({ action: 'task_reschedule', taskId: id, option });
    if (typeof showNotification === 'function' && options.notify !== false) {
        const label = option === 'today' ? 'сьогодні' : dateText;
        showNotification(`Задачу перенесено на ${label}`, 'success');
    }
    if (options.refresh !== false) await refreshMyCabinetTab({ force: true });
    return result;
}

async function moveCabinetTaskToToday(taskId, method = 'button', options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) throw new Error('Invalid task id');
    const task = findCabinetTask(id) || {};
    const dueState = getCabinetTaskDueState(task, cabinetTaskDueValue(task));
    const moveState = cabinetTaskMoveToTodayState(task, dueState);
    if (!moveState.canMove) {
        if (dueState.key === 'today' && typeof showNotification === 'function') {
            showNotification('Ця задача вже у Мій день', 'info');
            return;
        }
        if (dueState.key === 'none' && typeof showNotification === 'function') {
            showNotification('Задача без дати вже входить у денний зріз', 'info');
            return;
        }
        throw new Error(moveState.reason || 'Цю задачу не можна перенести');
    }
    const sourceSurface = method === 'drag'
        ? (dueState.key === 'overdue'
            ? 'profile_my_cabinet_overdue_to_today_drop'
            : 'profile_my_cabinet_move_to_today_drop')
        : (dueState.key === 'overdue'
            ? 'profile_my_cabinet_overdue_to_today_button'
            : 'profile_my_cabinet_move_to_today_button');
    const scope = cabinetHrReminderScope();
    const result = await rescheduleCabinetTask(id, 'today', { sourceSurface, notify: !options.undo });
    if (!options.undo || scope !== cabinetHrReminderScope()) return result;
    const eventId = normalizeCabinetTaskId(result?.historyEvent?.id);
    if (!eventId || !result?.historyEvent?.meta?.undo) {
        window.showNotification?.('Задачу перенесено на сьогодні', 'success');
        return result;
    }
    const undo = showCabinetTaskUndoToast(id, null, {
        message: 'Задачу перенесено на сьогодні',
        restore: async () => {
            if (scope !== cabinetHrReminderScope()) throw new Error('Поверніться до бізнесу, в якому перенесли задачу.');
            const restored = await apiPost(`/tasks/${id}/reschedule/undo`, { eventId });
            if (!restored?.success) throw new Error(restored?.error || 'Не вдалося скасувати перенесення.');
            notifyTaskWidgetsChanged({ action: 'task_reschedule', taskId: id });
            await refreshMyCabinetTab({ force: true });
        }
    });
    if (options.focusUndo && activeTab === 'myday') undo?.focus();
    return result;
}

async function executeCabinetMoveTarget(taskId, target, options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) throw new Error('Invalid task id');
    if (target === 'today') {
        await moveCabinetTaskToToday(id, options.method || 'button');
        return;
    }
    if (target === 'tomorrow') {
        await rescheduleCabinetTask(id, 'tomorrow', { sourceSurface: 'profile_my_cabinet' });
        return;
    }
    if (target === 'snooze_hour') {
        await snoozeCabinetTask(id, 60);
        return;
    }
    if (target === 'snooze_custom') {
        await rescheduleCabinetTask(id, 'custom', { sourceSurface: 'profile_my_cabinet' });
        return;
    }
    if (target === 'waiting') {
        await updateCabinetTaskFields(id, {
            workflow_state: 'waiting',
            task_kind: 'waiting'
        }, {
            action: 'task_waiting',
            message: 'Задачу перенесено в очікування'
        });
        return;
    }
    if (target === 'private') {
        await updateCabinetTaskFields(id, {
            task_mode: 'private',
            visibility: 'private'
        }, {
            action: 'task_visibility',
            message: 'Задачу зроблено приватною'
        });
        return;
    }
    if (target === 'no_date') {
        await updateCabinetTaskFields(id, {
            date: null,
            deadline: null,
            remind_at: null,
            scheduled_start_at: null,
            scheduled_end_at: null,
            snoozed_until: null,
            workflow_state: 'inbox'
        }, {
            action: 'task_no_date',
            message: 'Дату задачі прибрано'
        });
        return;
    }
    throw new Error('Невідома дія перенесення');
}

async function createCabinetTask(event) {
    event.preventDefault();
    if (cabinetTaskCreatePending) return;
    const input = document.getElementById('cabinetTaskTitle');
    const kind = document.getElementById('cabinetTaskKind')?.value || 'action';
    const selectedMode = document.getElementById('cabinetTaskMode')?.value === 'personal' ? 'personal' : 'work';
    const selectedDate = document.getElementById('cabinetTaskDate')?.value || '';
    const current = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    const title = String(input?.value || '').trim();
    const composer = document.getElementById('cabinetTaskComposer');
    if (cabinetLeadCollaboration?.composer.contains(composer)) {
        await submitCabinetLeadCollaboration(composer);
        return;
    }
    const aiCommitPayload = window.TaskAiDraft?.commitPayloadFor?.(composer);
    const assignmentState = cabinetAssignmentPickers.get(composer);
    if (assignmentState?.needsShiftConfirmation) {
        setCabinetTaskComposerStatus('Підтвердьте склад зміни перед створенням задачі.', 'error');
        return;
    }
    if (assignmentState?.ownerId === null) {
        setCabinetTaskComposerStatus('Оберіть виконавця.', 'error');
        composer.querySelector('[data-cabinet-assignment] summary')?.focus();
        return;
    }
    if (aiCommitPayload && assignmentState?.shiftAssignment) {
        setCabinetTaskComposerStatus('Для AI-чернетки відкрийте «Люди» й натисніть «Змінити склад вручну».', 'error');
        return;
    }
    const coAssigneeUserIds = readCabinetCreateCoAssignees(composer);
    const titleError = !aiCommitPayload ? validateCabinetPlainTaskTitle(title) : '';
    if (titleError) {
        input?.focus();
        setCabinetTaskTitleGuidance(titleError, 'error');
        setCabinetTaskComposerStatus('');
        return;
    }
    const draft = {
        title,
        description: document.getElementById('cabinetTaskDetails')?.value.trim() || '',
        ownerUserId: readCabinetOwner(composer),
        deadlineTime: document.getElementById('cabinetTaskTime')?.value || '',
        dateOnly: true,
        ...(coAssigneeUserIds.length && { coAssigneeUserIds }),
        dueMode: composer?.querySelector?.('#cabinetDueMode')?.value,
        ...(assignmentState?.shiftAssignment ? { shiftAssignment: assignmentState.shiftAssignment } : {}),
        category: document.getElementById('cabinetTaskCategory')?.value || cabinetCreateDefaultsForSegment(myTasksSegment, selectedMode).category,
        priority: readCabinetCreatePriority(),
        taskType: 'human',
        mode: selectedMode,
        taskMode: selectedMode,
        structuralMode: 'simple',
        kind,
        visibility: document.getElementById('cabinetTaskVisibility')?.value || (selectedMode === 'private' ? 'private' : (selectedMode === 'personal' ? 'me_only' : 'team')),
        workflowState: kind === 'waiting' ? 'waiting' : 'inbox',
        duePreset: cabinetCreateDuePreset,
        scheduleDate: selectedDate,
        durationMinutes: 30,
        scheduleSlot: 'morning',
        sourceType: 'manual',
        sourceModule: 'profile_my_cabinet',
        sourceSurface: 'profile_my_cabinet',
        ...cabinetCreateContext,
        scheduleConfirmed: cabinetCreateDuePreset !== 'no_date',
        allowReschedule: document.getElementById('cabinetTaskAllowReschedule')?.checked !== false,
        captureIntent: { waiting: kind === 'waiting' }
    };
    if (aiCommitPayload) {
        if (window.TaskAiDraft?.isCommitPending?.(composer)) return;
        if (aiCommitPayload.commitType === 'bundle') {
            if (!window.TaskCreate?.commitAiDraftBundle) {
                if (typeof showNotification === 'function') showNotification('Створення кількох AI-задач тимчасово недоступне. Ручне створення працює як раніше.', 'error');
                return;
            }
            window.TaskAiDraft?.setCommitPending?.(composer, true);
            let bundleResult;
            try {
                bundleResult = await window.TaskCreate.commitAiDraftBundle({
                    ...aiCommitPayload,
                    sourceContext: cabinetCreateContext,
                    coAssigneeUserIds,
                    sourceSurface: 'profile_my_cabinet'
                });
            } finally {
                window.TaskAiDraft?.setCommitPending?.(composer, false);
            }
            if (!bundleResult?.success) {
                if (typeof showNotification === 'function') showNotification(bundleResult?.error || 'AI bundle не створено. Ручне створення доступне.', 'error');
                return;
            }
            const bundleTasks = (Array.isArray(bundleResult.tasks) ? bundleResult.tasks : [])
                .map(row => row?.task || row)
                .filter(Boolean);
            bundleTasks.forEach(task => {
                const id = task?.id || task?.taskId || task?.task_id;
                window.TaskAiDraft?.markCommittedTaskId?.(id);
                notifyTaskWidgetsChanged({ action: 'create', taskId: id });
            });
            if (input) input.value = '';
            setCabinetTaskTitleGuidance('');
            const details = document.getElementById('cabinetTaskDetails');
            if (details) details.value = '';
            window.TaskAiDraft?.clear?.(composer);
            if (typeof showNotification === 'function') showNotification(`Створено ${bundleTasks.length || 'кілька'} AI-задач`, 'success');
            await refreshMyCabinetTab({ force: true });
            return;
        }
    }
    let payload;
    if (window.TaskCreate?.buildPayload) {
        payload = window.TaskCreate.buildPayload(draft, {
            sourceModule: 'profile_my_cabinet',
            sourceSurface: 'profile_my_cabinet',
            scheduleSlot: 'morning'
        });
    } else {
        const dueDate = cabinetDueDateForPreset(draft.duePreset, draft.scheduleDate);
        payload = {
            title,
            ownerUserId: draft.ownerUserId,
            category: draft.category,
            priority: draft.priority,
            task_mode: draft.mode,
            task_kind: draft.kind,
            visibility: draft.visibility,
            workflow_state: draft.workflowState,
            source_type: 'manual',
            source_module: 'profile_my_cabinet',
            allowReschedule: draft.allowReschedule,
            controlMeta: {
                canReschedule: draft.allowReschedule,
                allowReschedule: draft.allowReschedule
            }
        };
        if (dueDate) payload.date = dueDate;
        if (dueDate && draft.deadlineTime) {
            const start = `${dueDate}T${draft.deadlineTime}`;
            payload.deadline = `${start}:00`;
            payload.schedule = { date: dueDate, scheduledStartAt: start, durationMinutes: draft.durationMinutes };
            payload.effort_minutes = draft.durationMinutes;
        }
    }
    if (draft.shiftAssignment) payload.shiftAssignment = draft.shiftAssignment;
    if (!aiCommitPayload && !cabinetCreateContext && draft.dueMode === 'deadline') {
        const deadlineDate = cabinetDueDateForPreset(draft.duePreset, draft.scheduleDate);
        delete payload.date;
        delete payload.schedule;
        if (deadlineDate) payload.deadline = deadlineDate + 'T' + (draft.deadlineTime || '23:59') + ':00';
    }
    const createSignature = cabinetTaskCreateSignature(draft);
    const directCreateIdempotencyKey = !aiCommitPayload ? cabinetTaskCreateIdempotencyKeyForSignature(createSignature) : '';
    if (!aiCommitPayload) {
        const retryBlockMessage = cabinetTaskCreateRetryBlockMessage(createSignature);
        if (retryBlockMessage) {
            input?.focus();
            setCabinetTaskComposerStatus(retryBlockMessage, 'warning');
            if (typeof showNotification === 'function') showNotification(retryBlockMessage, 'warning');
            return;
        }
        cabinetTaskCreatePending = true;
        rememberCabinetTaskCreateAttempt(createSignature, 'in_flight', directCreateIdempotencyKey);
        setCabinetTaskCreateBusy(true);
        setCabinetTaskComposerStatus('Створюю задачу...', '');
    }
    let result;
    if (aiCommitPayload) {
        if (!window.TaskCreate?.commitAiDraft) {
            if (typeof showNotification === 'function') showNotification('AI commit тимчасово недоступний. Скасуйте AI-зміни або створіть задачу вручну.', 'error');
            return;
        }
        window.TaskAiDraft?.setCommitPending?.(composer, true);
        try {
            result = await window.TaskCreate.commitAiDraft({
                ...aiCommitPayload,
                sourceContext: cabinetCreateContext,
                acceptedFieldMask: [...new Set([...aiCommitPayload.acceptedFieldMask, 'owner', 'visibility'])],
                coAssigneeUserIds,
                finalDraft: {
                    ...draft,
                    ...(aiCommitPayload.finalDraft || {}),
                    ownerUserId: draft.ownerUserId,
                    visibility: draft.visibility,
                    sourceType: 'ai_draft',
                    sourceModule: 'profile_my_cabinet',
                    sourceSurface: 'profile_my_cabinet'
                }
            });
        } finally {
            window.TaskAiDraft?.setCommitPending?.(composer, false);
        }
    } else {
        try {
            result = window.TaskCreate?.createTask
                ? await window.TaskCreate.createTask(payload, {
                    idempotencyKey: directCreateIdempotencyKey,
                    onDuplicate: err => {
                        if (typeof showNotification === 'function') showNotification(err.message || 'Активний дубль не створено', 'warning');
                    }
                })
                : await apiPost('/tasks', { ...payload, idempotencyKey: directCreateIdempotencyKey });
        } catch (error) {
            result = { success: false, networkError: true, error: error?.message || 'Не вдалося створити задачу' };
        }
    }
    if (!result?.success) {
        if (result?.code === 'TASK_SHIFT_ROSTER_CHANGED') cabinetAssignmentPickers.get(composer)?.reloadShift();
        if (!aiCommitPayload) {
            if (result?.networkError || !result || result.status >= 500) rememberCabinetTaskCreateAttempt(createSignature, 'unknown', directCreateIdempotencyKey);
            else clearCabinetTaskCreateAttempt(createSignature, directCreateIdempotencyKey);
            cabinetTaskCreatePending = false;
            setCabinetTaskCreateBusy(false);
        }
        setCabinetTaskComposerStatus(result?.error || 'Не вдалося створити задачу', 'error');
        if (!result?.duplicate && typeof showNotification === 'function') {
            showNotification(result?.error || 'Не вдалося створити задачу', 'error');
        }
        return;
    }
    const postCreateWarningCount = Array.isArray(result.postCreateWarnings) ? result.postCreateWarnings.length : 0;
    const delegated = Number(draft.ownerUserId) !== Number(current.id || current.user_id);
    const verification = await verifyCabinetCreatedTask(result, draft.duePreset === 'custom' ? draft.scheduleDate : '', delegated);
    if (!verification.ok) {
        if (!aiCommitPayload) {
            rememberCabinetTaskCreateAttempt(createSignature, 'unknown', directCreateIdempotencyKey);
            cabinetTaskCreatePending = false;
            setCabinetTaskCreateBusy(false);
        }
        setCabinetTaskComposerStatus(verification.message || 'Створення задачі не підтверджено', 'warning');
        if (typeof showNotification === 'function') {
            showNotification(verification.message || 'Створення задачі не підтверджено', 'warning');
        }
        return;
    }

    lastCabinetCreatedTaskId = verification.taskId || lastCabinetCreatedTaskId;
    if (aiCommitPayload) {
        window.TaskAiDraft?.markCommittedTaskId?.(verification.taskId);
    }
    notifyTaskWidgetsChanged({ action: 'create', taskId: verification.taskId });
    if (!aiCommitPayload) clearCabinetTaskCreateAttempt(createSignature, directCreateIdempotencyKey);
    cabinetCreateContext = null;
    cabinetCreateAssignment = null;
    composer?.querySelector?.('[data-cabinet-create-context]')?.setAttribute('hidden', '');
    // The list refresh keeps the composer mounted. Restore its defaults after a confirmed save.
    composer?.reset?.();
    composer?.querySelector('.park-composer-options')?.removeAttribute('open');
    if (input) input.value = '';
    setCabinetTaskTitleGuidance('');
    const details = document.getElementById('cabinetTaskDetails');
    if (details) details.value = '';
    window.TaskAiDraft?.clear?.(composer);
    setCabinetCreatePriority('normal');
    setCabinetDuePreset('today');
    setCabinetTaskComposerExpanded(false);
    const modeSelect = document.getElementById('cabinetTaskMode');
    if (modeSelect) modeSelect.value = 'work';
    syncCabinetTaskCreateMode();
    if (typeof showNotification === 'function') {
        showCabinetTaskCreateSuccessToast(result, draft, verification, postCreateWarningCount);
    }
    try {
        await refreshMyCabinetTab();
        setCabinetTaskComposerStatus('Задачу створено.', 'success');
        if (activeTab === 'myday') document.getElementById('cabinetTaskTitle')?.focus({ preventScroll: true });
    } finally {
        cabinetTaskCreatePending = false;
        setCabinetTaskCreateBusy(false);
    }
}

// ==========================================
// INVENTORY
// ==========================================
// ==========================================
// NOTES
// ==========================================
function renderNotes() {
    const sorted = [...myNotes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    let notesHtml = sorted.map(n => `
    <div class="note-card" style="background:${escapeHtml(n.color)}" data-note-id="${n.id}">
        ${n.pinned ? '<div class="note-pin">📌</div>' : ''}
        ${n.title ? `<div class="note-title">${escapeHtml(n.title)}</div>` : ''}
        <div class="note-content">${escapeHtml(n.content)}</div>
        <div class="note-date">${formatDate(n.updatedAt || n.createdAt)}</div>
        <div class="note-actions">
            <button class="note-action-btn" onclick="pinNote(${n.id})" title="${n.pinned ? 'Відкріпити' : 'Закріпити'}">📌</button>
            <button class="note-action-btn" onclick="deleteNote(${n.id})" title="Видалити">🗑️</button>
        </div>
    </div>`).join('');

    return `
    <div class="notes-section">
        <h3>📝 Нотатки</h3>
        <div class="notes-grid">
            ${notesHtml}
            <button class="add-note-btn" onclick="showAddNote()">+ Нова нотатка</button>
        </div>
    </div>`;
}

// Room tab removed in v38.16.0 — renderRoom() deleted

// ==========================================
// QUESTS
// ==========================================
// ==========================================
// MINI AVATAR (for chat)
// ==========================================
function renderMiniAvatar(equipped, name) {
    const letter = (name || '?')[0].toUpperCase();
    const hatMap = { hat_dino: '🦕', hat_crown: '👑', hat_chef: '👨‍🍳' };
    const hatEmoji = equipped?.head ? (hatMap[equipped.head.code] || '') : '';
    const frameRarity = equipped?.frame?.rarity || '';
    const effectCode = equipped?.effect?.code || '';

    return `
    <div class="chat-avatar-mini">
        <div class="mini-initial">${escapeHtml(letter)}</div>
        ${hatEmoji ? `<div class="mini-hat">${hatEmoji}</div>` : ''}
        ${frameRarity ? `<div class="mini-frame rarity-${escapeHtml(frameRarity)}"></div>` : ''}
        ${effectCode ? `<div class="mini-effect effect-${escapeHtml(effectCode.replace('fx_', ''))}"></div>` : ''}
    </div>`;
}

// ==========================================
// ACTIONS
// ==========================================
function closeProfileWidgetTooltips(except = null) {
    document.querySelectorAll('.profile-cockpit-widget.is-tooltip-open').forEach(card => {
        if (card === except) return;
        card.classList.remove('is-tooltip-open');
        card.querySelector('[data-profile-tooltip-toggle]')?.setAttribute('aria-expanded', 'false');
    });
}

function closeProfileWorkingRolePanel() {
    const panel = document.getElementById('profileWorkingRolePanel');
    const trigger = document.getElementById('profileWorkingRoleTrigger');
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function setProfileWorkingRolePanelOpen(open) {
    const panel = document.getElementById('profileWorkingRolePanel');
    const trigger = document.getElementById('profileWorkingRoleTrigger');
    if (!panel || !trigger) return;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function refreshProfileWorkingRoleSurface() {
    renderProfile();
}

function setProfileWorkingRole(role) {
    const ok = window.WorkingRole?.setActiveRole?.(role);
    if (!ok) {
        if (typeof showNotification === 'function') showNotification('Цю робочу роль не надано цьому акаунту', 'error');
        return;
    }
    refreshProfileWorkingRoleSurface();
}

function navigateProfileWidget(target) {
    const href = String(target || '').trim();
    if (!href) return;
    const url = new URL(href, window.location.origin);
    if (url.pathname === '/profile' && url.searchParams.get('tab')) {
        const tab = url.searchParams.get('tab');
        history.replaceState(null, '', `/profile?tab=${encodeURIComponent(tab)}`);
        switchTab(tab);
        return;
    }
    window.location.href = url.pathname + url.search + url.hash;
}

function moveProfileWidgetConfigItem(item, direction) {
    if (!item) return;
    const list = item.closest('.profile-widget-config-list');
    if (!list) return;
    if (direction === 'up' && item.previousElementSibling) {
        list.insertBefore(item, item.previousElementSibling);
    } else if (direction === 'down' && item.nextElementSibling) {
        list.insertBefore(item.nextElementSibling, item);
    }
    Array.from(list.querySelectorAll('[data-profile-widget-config-item]')).forEach((row, index, rows) => {
        row.querySelector('[data-profile-widget-move="up"]')?.toggleAttribute('disabled', index === 0);
        row.querySelector('[data-profile-widget-move="down"]')?.toggleAttribute('disabled', index === rows.length - 1);
    });
}

function readProfileWidgetConfigFromPanel() {
    const panel = document.getElementById('profileWidgetConfigPanel');
    if (!panel) return normalizeProfileCockpitWidgets(profileWidgetConfig);
    const ids = [];
    panel.querySelectorAll('[data-profile-widget-config-item]').forEach(row => {
        const checked = row.querySelector('[data-profile-widget-config-check]')?.checked;
        const id = row.dataset.widgetId;
        if (checked && id) ids.push(id);
    });
    return normalizeProfileCockpitWidgets(ids);
}

async function saveProfileWidgetConfig(ids = null) {
    const widgets = normalizeProfileCockpitWidgets(ids || readProfileWidgetConfigFromPanel());
    const result = await apiPatch('/auth/profile/cockpit-widgets', { widgets });
    if (!result?.success) {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Не вдалося зберегти віджети профілю', 'error');
        return;
    }
    profileWidgetConfig = normalizeProfileCockpitWidgets(result.widgets || widgets);
    if (profileData) {
        profileData.profilePreferences = {
            ...(profileData.profilePreferences || {}),
            cockpitWidgets: profileWidgetConfig
        };
    }
    profileWidgetSettingsOpen = false;
    renderProfile();
    if (typeof showNotification === 'function') showNotification('Віджети огляду збережено', 'success');
}

function bindCabinetTaskSoundControls(root = document) {
    root.querySelectorAll?.('[data-cabinet-task-sound-toggle]').forEach(input => {
        if (input.dataset.cabinetTaskSoundBound === 'true') return;
        input.dataset.cabinetTaskSoundBound = 'true';
        input.addEventListener('change', () => saveCabinetTaskSoundPreferences({ enabled: input.checked }));
    });

    root.querySelectorAll?.('[data-cabinet-task-sound-volume]').forEach(input => {
        if (input.dataset.cabinetTaskSoundBound === 'true') return;
        input.dataset.cabinetTaskSoundBound = 'true';
        input.addEventListener('input', () => {
            cabinetTaskSoundSettings = normalizeCabinetTaskSoundSettings({ ...cabinetTaskSoundSettings, volume: input.value });
            window.SoundEngine?.configureTask?.(cabinetTaskSoundSettings);
        });
        input.addEventListener('change', () => saveCabinetTaskSoundPreferences({ volume: input.value }));
    });

    root.querySelectorAll?.('[data-cabinet-task-sound-theme]').forEach(select => {
        if (select.dataset.cabinetTaskSoundBound === 'true') return;
        select.dataset.cabinetTaskSoundBound = 'true';
        select.addEventListener('change', () => saveCabinetTaskSoundPreferences({ theme: select.value }));
    });

    root.querySelectorAll?.('[data-cabinet-task-sound-test]').forEach(button => {
        if (button.dataset.cabinetTaskSoundBound === 'true') return;
        button.dataset.cabinetTaskSoundBound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            window.SoundEngine?.playTask?.('task-complete');
        });
    });
}

function bindCabinetRefreshButton(root = document) {
    root.querySelectorAll('[data-cabinet-refresh]').forEach(button => {
        if (button.dataset.cabinetRefreshBound === 'true') return;
        button.dataset.cabinetRefreshBound = 'true';
        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            button.disabled = true;
            button.classList.add('is-busy');
            try {
                await refreshMyCabinetTab({ force: true, silent: false, keepExistingOnError: true });
            } finally {
                button.disabled = false;
                button.classList.remove('is-busy');
            }
        });
    });
}

let profileWorkAccessEpoch = 0;
for (const event of ['crmBusinessContextChanged', 'crmBusinessScopeChanged', 'crm:auth-cleared']) {
    window.addEventListener(event, () => {
        profileWorkAccessEpoch++;
        const status = document.getElementById('profileWorkAccessStatus');
        const list = document.getElementById('profileWorkAccessResults');
        if (status) status.textContent = '';
        if (list) { list.replaceChildren(); list.hidden = true; }
    });
}

async function checkProfileWorkAccess() {
    const button = document.getElementById('profileWorkAccessCheck');
    const status = document.getElementById('profileWorkAccessStatus');
    const list = document.getElementById('profileWorkAccessResults');
    const progress = document.getElementById('profileWorkAccessProgress');
    if (!isOwnProfile || !button || button.disabled) return;
    const session = captureApiAuthSessionSnapshot();
    const epoch = profileWorkAccessEpoch;
    const context = JSON.stringify(getCrmBusinessScope());
    const current = () => epoch === profileWorkAccessEpoch && button.isConnected && document.getElementById('profileWorkAccessCheck') === button
        && isApiAuthSessionSnapshotCurrent(session) && JSON.stringify(getCrmBusinessScope()) === context;
    button.disabled = true;
    progress.hidden = false;
    list.hidden = true;
    list.replaceChildren();
    status.textContent = '';
    try {
        const response = await safeFetch('/api/work-access/check', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
        const result = response ? await response.json() : null;
        if (!current()) return;
        if (!response?.ok || !result?.success || !result.readiness?.checks) {
            status.textContent = result?.error || 'Не вдалося завершити перевірку. Повторіть пізніше.';
            return;
        }
        const labels = { profile: 'Картка працівника', active: 'Активність акаунта й картки',
            membership: 'Членство в Парку', role: 'Робоча роль', pages: 'Робочі розділи',
            modules: 'Модулі Парку', data: 'Читання робочих даних' };
        for (const [key, label] of Object.entries(labels)) {
            const item = document.createElement('li');
            item.textContent = label + ': ' + (result.readiness.checks[key]?.passed ? 'підтверджено' : 'потребує перевірки');
            list.appendChild(item);
        }
        list.hidden = false;
        status.textContent = result.readiness.ready ? 'Робочий доступ підтверджено на час цієї перевірки.'
            : result.readiness.nextStep;
    } catch {
        if (current()) status.textContent = 'Не вдалося завершити перевірку. Повторіть пізніше.';
    } finally {
        if (button.isConnected) { button.disabled = false; progress.hidden = true; }
    }
}

function attachProfileListeners() {
    if (cabinetLeadCollaboration && cabinetLeadCollaboration.scope !== cabinetHrReminderScope()) {
        cabinetLeadCollaboration = null;
    }
    const collaborationComposer = cabinetLeadCollaboration?.composer;
    const newComposer = document.querySelector('.park-composer');
    if (collaborationComposer && newComposer && collaborationComposer !== newComposer) {
        newComposer.replaceWith(collaborationComposer);
    }
    document.getElementById('profileWorkAccessCheck')?.addEventListener('click', checkProfileWorkAccess);
    bindProfileControlTabs();
    if (isOwnProfile) void window.TelegramCrmProfile?.mount(document.querySelector('[data-telegram-crm-profile]'));
    const controlLink = document.querySelector('[data-profile-control-link]');
    if (controlLink && !controlLink.dataset.bound) {
        controlLink.dataset.bound = 'true';
        controlLink.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void switchTab('control');
        });
    }
    if (!cabinetSnoozeOutsideBound) {
        cabinetSnoozeOutsideBound = true;
        document.addEventListener('click', event => {
            if (!event.target.closest('.cabinet-task-actions, .cabinet-reschedule-wrap')) closeCabinetSnoozeMenus();
            if (!event.target.closest('.profile-cockpit-widget')) closeProfileWidgetTooltips();
            if (!event.target.closest('.profile-working-role-wrap')) closeProfileWorkingRolePanel();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeCabinetSnoozeMenus();
            if (event.key === 'Escape') closeProfileWidgetTooltips();
            if (event.key === 'Escape') closeProfileWorkingRolePanel();
        });
    }

    const workingRoleTrigger = document.getElementById('profileWorkingRoleTrigger');
    if (workingRoleTrigger && workingRoleTrigger.dataset.profileWorkingRoleBound !== 'true') {
        workingRoleTrigger.dataset.profileWorkingRoleBound = 'true';
        workingRoleTrigger.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setProfileWorkingRolePanelOpen(document.getElementById('profileWorkingRolePanel')?.hidden !== false);
        });
    }

    document.querySelectorAll('[data-profile-working-role]').forEach(button => {
        if (button.dataset.profileWorkingRoleBound === 'true') return;
        button.dataset.profileWorkingRoleBound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            setProfileWorkingRole(button.dataset.profileWorkingRole || '');
        });
    });

    const workingRoleReset = document.querySelector('[data-profile-working-role-reset]');
    if (workingRoleReset && workingRoleReset.dataset.profileWorkingRoleBound !== 'true') {
        workingRoleReset.dataset.profileWorkingRoleBound = 'true';
        workingRoleReset.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (window.WorkingRole?.resetToBase?.()) refreshProfileWorkingRoleSurface();
        });
    }

    const workingRoleClose = document.querySelector('[data-profile-working-role-close]');
    if (workingRoleClose && workingRoleClose.dataset.profileWorkingRoleBound !== 'true') {
        workingRoleClose.dataset.profileWorkingRoleBound = 'true';
        workingRoleClose.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            closeProfileWorkingRolePanel();
        });
    }

    document.querySelectorAll('[data-profile-widget-target]').forEach(card => {
        if (card.dataset.profileWidgetBound === 'true') return;
        card.dataset.profileWidgetBound = 'true';
        card.addEventListener('click', event => {
            if (event.target.closest('[data-profile-tooltip-toggle]')) return;
            navigateProfileWidget(card.dataset.profileWidgetTarget);
        });
        card.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (event.target.closest('[data-profile-tooltip-toggle]')) return;
            event.preventDefault();
            navigateProfileWidget(card.dataset.profileWidgetTarget);
        });
    });

    document.querySelectorAll('[data-profile-tooltip-toggle]').forEach(button => {
        if (button.dataset.profileTooltipBound === 'true') return;
        button.dataset.profileTooltipBound = 'true';
        button.addEventListener('click', event => {
            event.stopPropagation();
            const card = button.closest('.profile-cockpit-widget');
            const open = !card?.classList.contains('is-tooltip-open');
            closeProfileWidgetTooltips(open ? card : null);
            card?.classList.toggle('is-tooltip-open', open);
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    });

    document.querySelectorAll('[data-profile-widget-config-toggle]').forEach(button => {
        if (button.dataset.profileWidgetConfigBound === 'true') return;
        button.dataset.profileWidgetConfigBound = 'true';
        button.addEventListener('click', () => {
            profileWidgetSettingsOpen = !profileWidgetSettingsOpen;
            const tabContent = document.getElementById('tabContent');
            if (tabContent) {
                tabContent.innerHTML = renderTabContent();
                attachProfileListeners();
            }
        });
    });

    document.querySelectorAll('[data-profile-widget-move]').forEach(button => {
        if (button.dataset.profileWidgetMoveBound === 'true') return;
        button.dataset.profileWidgetMoveBound = 'true';
        button.addEventListener('click', () => moveProfileWidgetConfigItem(button.closest('[data-profile-widget-config-item]'), button.dataset.profileWidgetMove));
    });

    document.querySelectorAll('[data-profile-widget-config-check]').forEach(input => {
        if (input.dataset.profileWidgetInputBound === 'true') return;
        input.dataset.profileWidgetInputBound = 'true';
        input.addEventListener('change', () => {
            input.closest('[data-profile-widget-config-item]')?.classList.toggle('is-active', input.checked);
        });
    });

    document.querySelector('[data-profile-widget-config-save]')?.addEventListener('click', () => saveProfileWidgetConfig());
    document.querySelector('[data-profile-widget-config-reset]')?.addEventListener('click', () => saveProfileWidgetConfig(PROFILE_COCKPIT_DEFAULT_WIDGETS));

    bindCabinetTaskActions(document);
    bindCabinetCompletedTodayDashboard(document);

    document.querySelectorAll('[data-cabinet-task-priority-select]').forEach(select => {
        if (select.dataset.cabinetPriorityQuickBound === 'true') return;
        select.dataset.cabinetPriorityQuickBound = 'true';
        select.addEventListener('click', event => event.stopPropagation());
        select.addEventListener('change', event => {
            event.stopPropagation();
            updateCabinetTaskPriority(select);
        });
    });

    bindCabinetTaskSoundControls(document);

    document.querySelectorAll('[data-cabinet-my-day-sound-settings]').forEach(button => {
        if (button.dataset.cabinetMyDaySoundBound === 'true') return;
        button.dataset.cabinetMyDaySoundBound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            openCabinetMyDaySoundSettings(button);
        });
    });

    bindCabinetRefreshButton();
    bindCabinetBucketButtons(document);
    const cabinetPriority = document.getElementById('cabinetTaskPriority');
    if (cabinetPriority && cabinetPriority.dataset.cabinetPrioritySelectBound !== 'true') {
        cabinetPriority.dataset.cabinetPrioritySelectBound = 'true';
        cabinetPriority.addEventListener('change', () => setCabinetCreatePriority(cabinetPriority.value));
    }
    const cabinetDate = document.getElementById('cabinetTaskDate');
    if (cabinetDate && cabinetDate.dataset.cabinetDateBound !== 'true') {
        cabinetDate.dataset.cabinetDateBound = 'true';
        cabinetDate.addEventListener('change', () => {
            const hasRequiredDate = cabinetLeadCollaboration?.composer.contains(cabinetDate);
            setCabinetDuePreset(cabinetDate.value || hasRequiredDate ? 'custom' : 'no_date');
        });
    }
    const visibility = document.getElementById('cabinetTaskVisibility');
    if (visibility && visibility.dataset.cabinetVisibilityBound !== 'true') {
        visibility.dataset.cabinetVisibilityBound = 'true';
        visibility.addEventListener('change', syncCabinetTaskVisibilityHint);
    }
    const taskTitle = document.getElementById('cabinetTaskTitle');
    if (taskTitle && taskTitle.dataset.cabinetTitleBound !== 'true') {
        taskTitle.dataset.cabinetTitleBound = 'true';
        taskTitle.addEventListener('input', () => {
            autoGrowCabinetTaskInput(taskTitle);
            if (taskTitle.getAttribute('aria-invalid') === 'true' && !validateCabinetPlainTaskTitle(taskTitle.value)) {
                setCabinetTaskTitleGuidance('');
                setCabinetTaskComposerStatus('');
            }
        });
        autoGrowCabinetTaskInput(taskTitle);
    }
    document.querySelectorAll('[data-cabinet-composer-toggle]').forEach(button => {
        if (button.dataset.cabinetComposerToggleBound === 'true') return;
        button.dataset.cabinetComposerToggleBound = 'true';
        button.addEventListener('click', () => setCabinetTaskComposerExpanded(!cabinetTaskComposerExpanded));
    });
    bindCabinetTaskDragDrop();

    const composer = document.getElementById('cabinetTaskComposer');
    bindMyDayTaskNavigation(composer);
    bindCabinetAssignmentPicker(composer);
    if (window.TaskAiDraft && activeTab === 'myday' && composer) {
        window.TaskAiDraft.bindComposer(composer, {
            sourceModule: 'profile_my_cabinet',
            sourceSurface: 'profile_my_cabinet',
            readDraft: readCabinetAiDraft,
            hideImpactReview: true,
            applyField: applyCabinetAiDraftField,
            focusField: focusCabinetAiDraftField,
            requestSubmit: () => composer?.requestSubmit?.(),
            commitBundle: payload => {
                const assignment = cabinetAssignmentPickers.get(composer);
                if (assignment?.shiftAssignment || assignment?.needsShiftConfirmation) {
                    return { success: false, error: 'Для AI-пакета оберіть людей вручну. Для підтвердженої зміни відкрийте «Люди» й натисніть «Змінити склад вручну».' };
                }
                if (assignment?.ownerId === null) {
                    return { success: false, error: 'Оберіть виконавця.' };
                }
                return window.TaskCreate.commitAiDraftBundle({ ...payload, sourceContext: cabinetCreateContext });
            },
            readCoAssignees: () => readCabinetCreateCoAssignees(composer)
        });
    }

    // Inventory slot click — equip/unequip
    document.querySelectorAll('.inventory-slot[data-item-id]').forEach(slot => {
        slot.addEventListener('click', async () => {
            const itemId = parseInt(slot.dataset.itemId);
            const equipSlot = slot.dataset.slot;
            if (!equipSlot) return; // coupons etc

            const item = myInventory.find(i => i.itemId === itemId);
            if (!item) return;

            try {
                if (item.isEquipped) {
                    await apiPut('/profile/unequip', { slot: equipSlot });
                } else {
                    await apiPut('/profile/equip', { item_id: itemId, slot: equipSlot });
                }
                await loadProfileData(currentUserId);
                renderProfile();
            } catch (e) { showNotification('Помилка екіпірування', 'error'); }
        });
    });

}

async function claimQuest(questId) {
    if (profileTabLock('quests')) {
        if (typeof showNotification === 'function') {
            showNotification('Щоденні завдання ще закриті', 'warning');
        }
        return;
    }
    if (isRewardClaimPending('quest', questId)) return;
    setRewardClaimPending('quest', questId, true);
    renderProfile();
    try {
        const result = await apiPost(`/quests/claim/${questId}`);
        if (result?.success) {
            if (typeof showNotification === 'function') {
                showNotification(`🎉 Отримано: +${result.reward || result.coins || 0} 💰`, 'success');
            }
            setRewardClaimPending('quest', questId, false);
            await refreshProfileRewardSurfaces({ reloadQuests: true, reloadWallet: true });
            return;
        }
        if (typeof showNotification === 'function') {
            showNotification(result?.error || 'Не вдалося забрати нагороду', 'error');
        }
    } finally {
        if (isRewardClaimPending('quest', questId)) {
            setRewardClaimPending('quest', questId, false);
            renderProfile();
        }
    }
}

async function setTitle(titleCode) {
    await apiPut('/quests/titles/set', { title_code: titleCode || null });
    titlesData = await apiGet('/quests/titles');
    renderProfile();
}

// updateMood() removed — Room tab removed in v38.16.0

async function showAddNote() {
    const result = await formModal('Нова нотатка', [
        { key: 'title', label: 'Заголовок', required: true, placeholder: 'Заголовок нотатки' },
        { key: 'content', label: 'Текст', type: 'textarea', placeholder: 'Текст нотатки...' }
    ], { icon: '📝' });
    if (!result) return;
    const { title, content } = result;
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];

    const res = await apiPost('/notes', { title, content, color });
    if (res && res.id) {
        myNotes.push(res);
        renderProfile();
    }
}

async function deleteNote(id) {
    if (!await confirmModal('Видалити нотатку?', { type: 'danger', okText: 'Видалити' })) return;
    await apiDelete(`/notes/${id}`);
    myNotes = myNotes.filter(n => n.id !== id);
    renderProfile();
}

async function pinNote(id) {
    const result = await apiPut(`/notes/${id}/pin`, {});
    if (result?.success !== undefined) {
        const note = myNotes.find(n => n.id === id);
        if (note) note.pinned = result.pinned;
        renderProfile();
    }
}

// ==========================================
// LEVEL PROGRESS (v30.8.0)
// ==========================================
function renderLevelProgress() {
    const p = profileData;
    if (!p) return '';

    const level = p.level || 1;
    const xp = p.xp || 0;
    const title = p.title || 'Новачок';
    const xpForCurrent = p.xpForCurrent || 0;
    const xpForNext = p.xpForNext;
    const isMaxLevel = !xpForNext;

    const pct = isMaxLevel ? 100 : Math.min(100, Math.round(((xp - xpForCurrent) / (xpForNext - xpForCurrent)) * 100));
    const xpNeeded = isMaxLevel ? 'MAX' : `${formatCoins(xp - xpForCurrent)} / ${formatCoins(xpForNext - xpForCurrent)}`;

    return `
    <div class="level-progress-card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
            <div class="level-badge-lg" data-level="${level}">
                <span class="level-number">${level}</span>
            </div>
            <div style="flex:1">
                <div style="font-weight:800;font-size:16px;color:var(--gray-800)">${escapeHtml(title)}</div>
                <div style="font-size:12px;color:var(--gray-400)">Рівень ${level}${xpForNext ? ` → ${p.nextTitle || ''}` : ' (МАКС)'}</div>
            </div>
            <div style="text-align:right">
                <div style="font-weight:800;font-size:18px;color:var(--primary)">${formatCoins(xp)}</div>
                <div style="font-size:11px;color:var(--gray-400)">XP</div>
            </div>
        </div>
        <div class="xp-progress-bar">
            <div class="xp-progress-fill" style="width:${pct}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px">
            <span style="font-size:11px;color:var(--gray-400)">${xpNeeded} XP</span>
            <span style="font-size:11px;color:var(--gray-400)">${pct}%</span>
        </div>
    </div>`;
}

// ==========================================
// STREAK WIDGET (v39.7.0 — multi-type with profession titles)
// ==========================================
function renderStreakWidget() {
    const role = (profileData?.user?.role || profileData?.role || '').toLowerCase();

    // Profession-based config for role title & overall streak flavor
    const STREAK_PROFILES = {
        animator: { icon: '🎭', label: 'Аніматор', color: '#f59e0b',
            titles: { 3: 'Новачок сцени', 7: 'Зірка вечірок', 14: 'Майстер шоу', 30: 'Легенда анімації', 60: 'Гранд-аніматор', 100: 'Безсмертний шоумен' } },
        manager: { icon: '📋', label: 'Менеджер', color: '#3b82f6',
            titles: { 3: 'Організатор', 7: 'Координатор', 14: 'Стратег', 30: 'Операційний ас', 60: 'Топ-менеджер', 100: 'Бізнес-гуру' } },
        director: { icon: '👑', label: 'Директор', color: '#a855f7',
            titles: { 5: 'Візіонер', 10: 'Лідер', 20: 'Стратегічний розум', 40: 'Залізний директор', 70: 'Легенда бізнесу', 100: 'Незламний' } },
        admin: { icon: '⚙️', label: 'Адміністратор', color: '#6366f1',
            titles: { 3: 'Сисадмін', 7: 'Девопс', 14: 'Архітектор', 30: 'Хранитель системи', 60: 'Невидимий герой', 100: 'Цифровий бог' } },
        creator: { icon: '🔮', label: 'Творець', color: '#ec4899',
            titles: { 3: 'Натхненний', 7: 'Творець', 14: 'Візіонер', 30: 'Деміург', 60: 'Майстер світів', 100: 'Абсолют' } }
    };

    const STREAK_TYPE_META = {
        login:    { icon: '📅', label: 'Щоденний вхід', color: '#22c55e' },
        task:     { icon: '✅', label: 'Завдання', color: '#3b82f6' },
        booking:  { icon: '📋', label: 'Бронювання', color: '#f59e0b' },
        quiz:     { icon: '🧠', label: 'Вікторина', color: '#a855f7' },
        minigame: { icon: '🎮', label: 'Гра', color: '#ec4899' }
    };

    const prof = STREAK_PROFILES[role] || STREAK_PROFILES.animator;

    // Build streak cards from API data
    const streakEntries = allStreaks && typeof allStreaks === 'object' ? Object.entries(allStreaks) : [];
    const totalCurrent = streakEntries.reduce((sum, [, s]) => sum + (s.current || 0), 0);
    const bestOverall = streakEntries.reduce((max, [, s]) => Math.max(max, s.best || 0), 0);
    const activeToday = streakEntries.filter(([, s]) => s.activeToday).length;

    // Role title from best individual streak
    const longestCurrent = streakEntries.reduce((max, [, s]) => Math.max(max, s.current || 0), 0);
    const titleKeys = Object.keys(prof.titles).map(Number).sort((a, b) => a - b);
    const earnedKey = titleKeys.filter(k => longestCurrent >= k).pop();
    const currentTitle = earnedKey ? prof.titles[earnedKey] : '';
    const nextTitleKey = titleKeys.find(k => longestCurrent < k);
    const nextTitle = nextTitleKey ? prof.titles[nextTitleKey] : '';

    // Streak type cards
    const typeCardsHtml = streakEntries.map(([type, s]) => {
        const meta = STREAK_TYPE_META[type] || { icon: '❓', label: type, color: '#6b7280' };
        const current = s.current || 0;
        const best = s.best || 0;
        const nextM = s.nextMilestone;
        const pct = nextM ? Math.min(100, Math.round((current / nextM.days) * 100)) : 100;
        return `
        <div class="streak-type-card ${s.activeToday ? 'active-today' : ''}" style="--streak-color:${meta.color}">
            <div class="streak-type-header">
                <span class="streak-type-icon">${meta.icon}</span>
                <span class="streak-type-label">${meta.label}</span>
                ${s.activeToday ? '<span class="streak-today-badge">✓ сьогодні</span>' : ''}
            </div>
            <div class="streak-type-stats">
                <div class="streak-type-current" style="color:${meta.color}">🔥 ${current}</div>
                <div class="streak-type-best">🏅 ${best}</div>
            </div>
            ${nextM ? `
            <div class="streak-type-progress">
                <div class="streak-type-bar"><div class="streak-type-fill" style="width:${pct}%;background:${meta.color}"></div></div>
                <span class="streak-type-target">${nextM.days}д → +${nextM.coins}🪙</span>
            </div>` : '<div class="streak-type-max">🏆 Макс!</div>'}
        </div>`;
    }).join('');

    // Heatmap for last 30 days (based on login streak)
    const loginStreak = allStreaks?.login?.current || profileData?.streak?.current || profileData?.streak?.current_streak || 0;
    const last30 = [];
    for (let i = 29; i >= 0; i--) {
        const active = i < loginStreak;
        last30.push(`<div class="streak-day ${active ? 'active' : ''}" title="${active ? '🔥' : '⬜'}" ${active ? `style="background:${prof.color}"` : ''}></div>`);
    }

    return `
    <div class="streak-section" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
            <span style="font-size:22px">${prof.icon}</span>
            <span style="font-size:14px;font-weight:700;color:${prof.color}">${escapeHtml(prof.label)}</span>
            ${currentTitle ? `<span style="font-size:12px;background:${prof.color}20;color:${prof.color};padding:2px 10px;border-radius:10px;font-weight:600">— ${escapeHtml(currentTitle)}</span>` : ''}
            ${nextTitle ? `<span style="font-size:11px;color:var(--gray-400)">→ ${escapeHtml(nextTitle)} (${nextTitleKey}д)</span>` : ''}
        </div>
        <div class="streak-widget">
            <div class="streak-card">
                <div class="streak-icon">🔥</div>
                <div class="streak-value">${totalCurrent}</div>
                <div class="streak-label">Загальний streak</div>
            </div>
            <div class="streak-card">
                <div class="streak-icon">🏅</div>
                <div class="streak-value">${bestOverall}</div>
                <div class="streak-label">Найкращий рекорд</div>
            </div>
            <div class="streak-card">
                <div class="streak-icon">⚡</div>
                <div class="streak-value">${activeToday}/${streakEntries.length}</div>
                <div class="streak-label">Активних сьогодні</div>
            </div>
        </div>
        <div class="streak-types-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-top:12px">
            ${typeCardsHtml}
        </div>
        <div class="streak-heatmap" style="margin-top:12px">
            <div style="font-size:11px;color:var(--gray-400);margin-bottom:4px">Вхід за останні 30 днів:</div>
            <div class="heatmap-grid">${last30.join('')}</div>
        </div>
        <div style="margin-top:8px;text-align:center">
            <button class="streak-freeze-btn" onclick="buyStreakFreeze()">❄️ Заморозити streak (50 🪙)</button>
        </div>
    </div>`;
}

async function buyStreakFreeze() {
    if (!await confirmModal('Заморозити streak за 50 монет? (1 раз/тиждень)', { okText: 'Заморозити', cancelText: 'Скасувати' })) return;
    const result = await apiPost('/gamification/streak/freeze');
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification('❄️ Streak заморожено!', 'success');
        walletData = await apiGet('/wallet');
        renderProfile();
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка', 'error');
    }
}

// ==========================================
// SEASONAL QUESTS TAB (v30.8.0)
// ==========================================
async function loadSeasonalQuests() {
    if (profileTabLock('season')) return;
    seasonalQuests = await apiGet('/gamification/seasons');
    // Also check progress
    await apiPost('/gamification/seasons/check');
    seasonalQuests = await apiGet('/gamification/seasons');
}

function renderSeasonTab() {
    if (profileTabLock('season')) return renderProfileComingSoon('season');
    if (!seasonalQuests) return '<div class="empty-state"><div class="empty-state-icon">🏔️</div><div class="empty-state-text">Завантаження сезонних квестів...</div></div>';

    const quests = Array.isArray(seasonalQuests) ? seasonalQuests : [];
    if (quests.length === 0) {
        return '<div class="empty-state"><div class="empty-state-icon">🏔️</div><div class="empty-state-text">Наразі немає активних сезонних квестів</div></div>';
    }

    const season = quests[0]?.season || 'spring';
    const seasonNames = { winter: '❄️ Зимовий сезон', spring: '🌸 Весняний сезон', summer: '☀️ Літній сезон', autumn: '🍂 Осінній сезон' };
    const seasonColors = { winter: '#60a5fa', spring: '#34d399', summer: '#fbbf24', autumn: '#f97316' };
    const seasonGradients = {
        winter: 'linear-gradient(135deg, #1e40af, #3b82f6, #60a5fa)',
        spring: 'linear-gradient(135deg, #059669, #10b981, #34d399)',
        summer: 'linear-gradient(135deg, #d97706, #f59e0b, #fbbf24)',
        autumn: 'linear-gradient(135deg, #c2410c, #ea580c, #f97316)'
    };

    const endDate = quests[0]?.end_date;
    const daysLeft = endDate ? Math.max(0, Math.ceil((new Date(endDate) - new Date()) / 86400000)) : 0;

    // Season Pass tier progression
    const completedCount = quests.filter(q => q.completed).length;
    const claimedCount = quests.filter(q => q.claimed).length;
    const totalQuests = quests.length;
    const passPct = totalQuests > 0 ? Math.round((completedCount / totalQuests) * 100) : 0;

    const PASS_TIERS = [
        { name: 'Бронзовий', icon: '🥉', threshold: 0.25, color: '#cd7f32' },
        { name: 'Срібний', icon: '🥈', threshold: 0.5, color: '#c0c0c0' },
        { name: 'Золотий', icon: '🥇', threshold: 0.75, color: '#ffd700' },
        { name: 'Діамантовий', icon: '💎', threshold: 1.0, color: '#60a5fa' }
    ];
    const currentTier = PASS_TIERS.filter(t => (completedCount / totalQuests) >= t.threshold).pop();
    const nextTier = PASS_TIERS.find(t => (completedCount / totalQuests) < t.threshold);

    // Season pass timeline
    const timelineHtml = quests.map((q, i) => {
        const done = q.completed;
        const claimed = q.claimed;
        const tierForThis = PASS_TIERS.find(t => ((i + 1) / totalQuests) <= t.threshold) || PASS_TIERS[3];
        return `<div class="pass-node ${done ? 'done' : ''} ${claimed ? 'claimed' : ''}" style="--node-color:${done ? (seasonColors[season] || '#6366f1') : 'var(--gray-300)'}" title="${escapeHtml(q.title)}">
            <div class="pass-node-dot">${done ? (claimed ? '✅' : '🎁') : (i + 1)}</div>
        </div>`;
    }).join('<div class="pass-connector"></div>');

    let cardsHtml = quests.map(q => {
        const progress = q.progress || 0;
        const target = q.target_value;
        const pct = Math.min(100, Math.round((progress / target) * 100));
        const completed = q.completed;
        const claimed = q.claimed;
        const canClaim = completed && !claimed;
        const pending = isRewardClaimPending('season', q.id);

        return `
        <div class="season-quest-card ${completed ? 'completed' : ''} ${claimed ? 'claimed' : ''}">
            <div class="season-quest-icon">${q.icon || '🏔️'}</div>
            <div class="season-quest-info">
                <h4>${escapeHtml(q.title)}</h4>
                <p>${escapeHtml(q.description)}</p>
                <div class="season-quest-progress">
                    <div class="season-quest-bar"><div class="season-quest-fill" style="width:${pct}%;background:${seasonColors[season] || '#6366f1'}"></div></div>
                    <span>${progress}/${target}</span>
                </div>
                <div class="season-quest-reward">
                    ${q.reward_coins ? `🪙 ${q.reward_coins}` : ''} ${q.reward_xp ? `⚡ ${q.reward_xp} XP` : ''}
                    ${q.reward_title ? `🏷️ "${escapeHtml(q.reward_title)}"` : ''}
                </div>
            </div>
            <div>
                ${canClaim || pending ? renderRewardClaimButton('season', q.id, 'Забрати!') : ''}
                ${claimed ? '<span class="reward-state-badge reward-state-badge--claimed">✅ Отримано</span>' : ''}
            </div>
        </div>`;
    }).join('');

    const totalCoins = quests.reduce((s, q) => s + (q.reward_coins || 0), 0);
    const totalXP = quests.reduce((s, q) => s + (q.reward_xp || 0), 0);

    return `
    <div style="margin-top:16px">
        <div class="season-banner" style="background:${seasonGradients[season] || seasonGradients.spring};color:white;border-radius:var(--radius-md);padding:24px 20px;margin-bottom:16px;text-align:center;position:relative;overflow:hidden">
            <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2220%22 cy=%2230%22 r=%2240%22 fill=%22rgba(255,255,255,0.05)%22/><circle cx=%2280%22 cy=%2270%22 r=%2260%22 fill=%22rgba(255,255,255,0.03)%22/></svg>')"></div>
            <div style="position:relative;z-index:1">
                <h3 style="margin:0 0 4px;font-size:22px;font-weight:800">${seasonNames[season] || season}</h3>
                <div style="font-size:13px;opacity:0.9;margin-bottom:12px">Залишилось ${daysLeft} днів</div>
                <div style="display:flex;justify-content:center;gap:20px;font-size:13px;font-weight:600">
                    <span>${currentTier ? `${currentTier.icon} ${currentTier.name}` : '🏁 Старт'}</span>
                    <span>🪙 ${totalCoins} монет</span>
                    <span>⚡ ${totalXP} XP</span>
                </div>
            </div>
        </div>
        <div class="season-pass-progress" style="background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:16px;margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span style="font-size:13px;font-weight:700">Сезонний пас</span>
                <span style="font-size:13px;color:var(--gray-500)">${completedCount}/${totalQuests} завершено (${passPct}%)</span>
            </div>
            <div style="height:8px;background:var(--gray-100);border-radius:4px;overflow:hidden;margin-bottom:12px">
                <div style="height:100%;width:${passPct}%;background:${seasonColors[season] || '#6366f1'};border-radius:4px;transition:width 0.4s"></div>
            </div>
            <div class="pass-tiers" style="display:flex;justify-content:space-between;margin-bottom:12px">
                ${PASS_TIERS.map(t => {
                    const reached = (completedCount / totalQuests) >= t.threshold;
                    return `<div style="text-align:center;opacity:${reached ? 1 : 0.4}">
                        <div style="font-size:20px">${t.icon}</div>
                        <div style="font-size:10px;font-weight:600;color:${reached ? t.color : 'var(--gray-400)'}">${t.name}</div>
                        <div style="font-size:9px;color:var(--gray-400)">${Math.round(t.threshold * 100)}%</div>
                    </div>`;
                }).join('')}
            </div>
            <div class="pass-timeline" style="display:flex;align-items:center;overflow-x:auto;gap:0;padding:4px 0">
                ${timelineHtml}
            </div>
        </div>
        ${cardsHtml}
    </div>`;
}

async function claimSeasonQuest(questId) {
    if (profileTabLock('season')) {
        if (typeof showNotification === 'function') showNotification('Сезонний розділ ще закритий', 'warning');
        return;
    }
    if (isRewardClaimPending('season', questId)) return;
    setRewardClaimPending('season', questId, true);
    renderProfile();
    try {
        const result = await apiPost(`/gamification/seasons/${questId}/claim`);
        if (result?.success) {
            if (typeof showNotification === 'function') showNotification(`🎉 Отримано: +${result.coins || 0} 🪙`, 'success');
            if (result.title && typeof AchievementPopup !== 'undefined') {
                AchievementPopup.show({ name: result.title, description: 'Новий титул за сезонний квест!', icon: '🏷️', rarity: 'epic', reward_coins: result.coins });
            }
            setRewardClaimPending('season', questId, false);
            await refreshProfileRewardSurfaces({ reloadQuests: true, reloadWallet: true, reloadSeason: true });
            return;
        }
        if (typeof showNotification === 'function') showNotification(result?.error || 'Не вдалося забрати сезонну нагороду', 'error');
    } finally {
        if (isRewardClaimPending('season', questId)) {
            setRewardClaimPending('season', questId, false);
            renderProfile();
        }
    }
}

// ==========================================
// TEAMS & CHALLENGES TAB (v30.8.0)
// ==========================================
async function loadTeamsData() {
    if (profileTabLock('teams')) return;
    const [teams, challenges] = await Promise.all([
        apiGet('/gamification/teams'),
        apiGet('/gamification/challenges')
    ]);
    teamsData = teams;
    challengesData = Array.isArray(challenges) ? challenges : [];
}

function renderTeamsTab() {
    if (profileTabLock('teams')) return renderProfileComingSoon('teams');
    if (!teamsData) return '<div class="empty-state"><div class="empty-state-icon">⚡</div><div class="empty-state-text">Завантаження команд...</div></div>';

    const teams = teamsData.teams || [];
    const userTeamId = teamsData.userTeamId;
    const challenges = challengesData || [];

    let teamsHtml = teams.map(t => {
        const isMyTeam = t.id === userTeamId;
        const memberAvatars = (t.members || []).slice(0, 5).map(m =>
            `<div class="team-member-avatar" title="${escapeHtml(m.display_name || m.username)}">${(m.display_name || m.username || '?')[0].toUpperCase()}</div>`
        ).join('');

        return `
        <div class="team-card ${isMyTeam ? 'my-team' : ''}" style="border-left:4px solid ${t.color || '#6366f1'}">
            <div class="team-header">
                <span class="team-icon">${t.icon || '⚡'}</span>
                <span class="team-name">${escapeHtml(t.name)}</span>
                <span class="team-count">${t.member_count || t.members?.length || 0} чол.</span>
            </div>
            <div class="team-members">${memberAvatars}${(t.members?.length || 0) > 5 ? `<span style="font-size:11px;color:var(--gray-400)">+${t.members.length - 5}</span>` : ''}</div>
            <div style="margin-top:8px">
                ${isMyTeam
                    ? `<button class="team-btn leave" onclick="leaveMyTeam()">Вийти</button>`
                    : (!userTeamId ? `<button class="team-btn join" onclick="joinTeamById(${t.id})">Приєднатися</button>` : '')}
                ${isMyTeam ? '<span style="font-size:12px;color:var(--primary);font-weight:700">Ваша команда</span>' : ''}
            </div>
        </div>`;
    }).join('');

    let challengesHtml = '';
    if (challenges.length > 0) {
        challengesHtml = `<h3 style="margin:20px 0 12px">🏆 Активні челенджі</h3>`;
        for (const ch of challenges) {
            const daysLeft = Math.max(0, Math.ceil((new Date(ch.end_date) - new Date()) / 86400000));
            const teamScores = (ch.teams || []).sort((a, b) => b.score - a.score);

            let scoresHtml = teamScores.map((ts, i) => {
                const pct = ch.target_value > 0 ? Math.min(100, Math.round((ts.score / ch.target_value) * 100)) : 0;
                const isMyTeamScore = ts.team_id === userTeamId;
                const rankIcons = ['🥇', '🥈', '🥉'];
                return `
                <div class="challenge-team-score ${isMyTeamScore ? 'my-team' : ''}">
                    <span class="challenge-rank">${rankIcons[i] || (i + 1)}</span>
                    <span class="challenge-team-name">${ts.team_icon || ''} ${escapeHtml(ts.team_name)}</span>
                    <div class="challenge-score-bar" style="flex:1"><div class="challenge-score-fill" style="width:${pct}%;background:${ts.team_color || '#6366f1'}"></div></div>
                    <span class="challenge-score-num">${ts.score}/${ch.target_value}</span>
                </div>`;
            }).join('');

            challengesHtml += `
            <div class="challenge-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                    <h4>${ch.icon || '🏆'} ${escapeHtml(ch.title)}</h4>
                    <span style="font-size:12px;color:var(--gray-400)">${daysLeft} днів</span>
                </div>
                ${ch.description ? `<p style="font-size:13px;color:var(--gray-500);margin-bottom:10px">${escapeHtml(ch.description)}</p>` : ''}
                <div class="challenge-scores">${scoresHtml}</div>
                <div style="font-size:12px;color:var(--gray-400);margin-top:8px">
                    Нагорода: ${ch.reward_coins_per_member} 🪙 + ${ch.reward_xp_per_member} XP на учасника
                </div>
            </div>`;
        }
    }

    return `
    <div style="margin-top:16px">
        <h3 style="margin-bottom:12px">⚡ Команди</h3>
        <div class="teams-grid">${teamsHtml}</div>
        ${challengesHtml}
    </div>`;
}

async function joinTeamById(teamId) {
    if (profileTabLock('teams')) {
        if (typeof showNotification === 'function') showNotification('Команди ще закриті', 'warning');
        return;
    }
    const result = await apiPost(`/gamification/teams/${teamId}/join`);
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification(`⚡ Ви приєдналися до команди!`, 'success');
        teamsData = null;
        switchTab('teams');
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка', 'error');
    }
}

async function leaveMyTeam() {
    if (profileTabLock('teams')) {
        if (typeof showNotification === 'function') showNotification('Команди ще закриті', 'warning');
        return;
    }
    if (!await confirmModal('Вийти з команди?', { type: 'danger', okText: 'Вийти', cancelText: 'Скасувати' })) return;
    const result = await apiPost('/gamification/teams/leave');
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification('Ви вийшли з команди', 'success');
        teamsData = null;
        switchTab('teams');
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка', 'error');
    }
}

// ==========================================
// REFERRAL TAB (v30.8.0)
// ==========================================
async function loadReferralData() {
    if (profileTabLock('referral')) return;
    referralData = await apiGet('/gamification/referral');
}

function renderReferralTab() {
    if (profileTabLock('referral')) return renderProfileComingSoon('referral');
    if (!referralData) return '<div class="empty-state"><div class="empty-state-icon">🤝</div><div class="empty-state-text">Завантаження...</div></div>';

    const code = referralData.code || '';
    const referrals = referralData.referrals || [];
    const totalReferred = referralData.totalReferred || 0;
    const totalRewarded = referralData.totalRewarded || 0;
    const totalCoins = referralData.totalCoinsEarned || 0;

    // Milestone progress
    const milestones = [
        { target: 5, label: 'Рекрутер 🤝', reward: '1000 🪙' },
        { target: 10, label: 'HR-Менеджер 👔', reward: '2500 🪙 + предмет' }
    ];

    let milestonesHtml = milestones.map(m => {
        const pct = Math.min(100, Math.round((totalRewarded / m.target) * 100));
        return `
        <div class="referral-milestone ${totalRewarded >= m.target ? 'reached' : ''}">
            <div class="referral-milestone-label">${escapeHtml(m.label)}</div>
            <div class="referral-milestone-bar"><div class="referral-milestone-fill" style="width:${pct}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray-400)">
                <span>${totalRewarded}/${m.target}</span>
                <span>${m.reward}</span>
            </div>
        </div>`;
    }).join('');

    let referralsHtml = referrals.length > 0
        ? referrals.map(r => `
            <div class="referral-row">
                <span class="referral-user">👤 ${escapeHtml(r.referred_username || '—')}</span>
                <span class="referral-status ${r.status}">${r.status === 'rewarded' ? '✅ Нагороджено' : r.status === 'active' ? '⏳ Активний' : '📋 Очікує'}</span>
                <span class="referral-date">${formatDate(r.created_at)}</span>
            </div>`).join('')
        : '<div class="empty-state" style="padding:20px"><div class="empty-state-text">Поки немає рефералів. Поділіться кодом!</div></div>';

    return `
    <div style="margin-top:16px">
        <h3 style="margin-bottom:16px">🤝 Реферальна програма</h3>

        <div class="referral-code-card">
            <div style="font-size:13px;color:var(--gray-500);margin-bottom:6px">Ваш реферальний код:</div>
            <div style="display:flex;gap:8px;align-items:center">
                <div class="referral-code-display">${escapeHtml(code)}</div>
                <button class="referral-copy-btn" onclick="copyReferralCode('${escapeHtml(code)}')">📋 Копіювати</button>
            </div>
            <div style="font-size:12px;color:var(--gray-400);margin-top:8px">
                Ви отримаєте <strong>500 🪙</strong> коли реферал створить перше бронювання.
                Реферал отримує <strong>200 🪙</strong> при реєстрації.
            </div>
        </div>

        <div class="referral-stats" style="margin:16px 0">
            <div class="referral-stat-card">
                <div class="referral-stat-value">${totalReferred}</div>
                <div class="referral-stat-label">Запрошено</div>
            </div>
            <div class="referral-stat-card">
                <div class="referral-stat-value">${totalRewarded}</div>
                <div class="referral-stat-label">Активних</div>
            </div>
            <div class="referral-stat-card">
                <div class="referral-stat-value">${formatCoins(totalCoins)} 🪙</div>
                <div class="referral-stat-label">Зароблено</div>
            </div>
        </div>

        <div style="margin-bottom:16px">
            <h4 style="margin-bottom:8px">🎯 Досягнення</h4>
            ${milestonesHtml}
        </div>

        <h4 style="margin-bottom:8px">📋 Мої реферали</h4>
        <div class="referral-list">${referralsHtml}</div>
    </div>`;
}

function copyReferralCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        if (typeof showNotification === 'function') showNotification('📋 Код скопійовано!', 'success');
    }).catch(() => {
        // Fallback
        const input = document.createElement('input');
        input.value = code;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        if (typeof showNotification === 'function') showNotification('📋 Код скопійовано!', 'success');
    });
}

// ==========================================
// MONTHLY LEADERBOARD EXTENSION (v30.8.0)
// ==========================================
function setLeaderboardMode(mode) {
    leaderboardMode = mode;
    if (mode === 'monthly' && !monthlyLeaderboard) {
        loadMonthlyLeaderboard().then(() => switchTab('leaderboard'));
        return;
    }
    switchTab('leaderboard');
}

async function loadMonthlyLeaderboard() {
    monthlyLeaderboard = await apiGet(`/gamification/leaderboard/monthly?year=${monthlyYear}&month=${monthlyMonth}&category=${monthlyCategory}`);
}

function setMonthlyFilter(category) {
    monthlyCategory = category;
    monthlyLeaderboard = null;
    loadMonthlyLeaderboard().then(() => switchTab('leaderboard'));
}

// ==========================================
// INIT
// ==========================================
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    let profileTaskProjectionRefreshTimer = null;
    for (const eventName of ['online', 'offline']) {
        window.addEventListener(eventName, refreshCabinetConnectivityNotice);
    }
    window.addEventListener('workingRoleChanged', () => {
        if (profileData && isOwnProfile) renderProfile();
    });
    window.addEventListener('rolePreviewChanged', () => {
        if (profileData && isOwnProfile) renderProfile();
    });
    window.addEventListener('crm:tasks-updated', (event) => {
        const detail = event?.detail || {};
        const localOrigin = window.TaskUiShared?.TaskMutationSync?.originId?.();
        if (detail.originId ? detail.originId === localOrigin : detail.source === 'profile_my_cabinet') return;
        if (!profileData || !isOwnProfile || !isProfileTaskProjectionTab(activeTab)) return;
        window.clearTimeout(profileTaskProjectionRefreshTimer);
        profileTaskProjectionRefreshTimer = window.setTimeout(() => {
            refreshMyCabinetTab({ silent: false }).catch(error => {
                console.warn('Profile task projection refresh failed', error);
            });
        }, 300);
    });
    window.addEventListener('task-ai-draft-bundle-committed', (event) => {
        if (!profileData || !isOwnProfile || !isProfileTaskProjectionTab(activeTab)) return;
        const taskIds = Array.isArray(event?.detail?.taskIds) ? event.detail.taskIds : [];
        taskIds.forEach(taskId => notifyTaskWidgetsChanged({ action: 'create', taskId }));
        refreshMyCabinetTab({ silent: false, force: true }).catch(error => {
            console.warn('Profile AI bundle refresh failed', error);
        });
    });
    if (!window.__profileSoonMenuBound) {
        window.__profileSoonMenuBound = true;
        window.addEventListener('click', event => {
            if (!event.target?.closest?.('[data-profile-soon-menu]')) closeProfileSoonMenu();
        });
        window.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeProfileSoonMenu();
        });
    }
}

document.addEventListener('DOMContentLoaded', initProfilePage);
