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
const profileResourceStates = new Map();
let activeProfessionKey = null;
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
let myCabinetLastLoadedAt = 0;
let myTasksSegment = 'all';
let cabinetProjectionRequestSequence = 0;
let cabinetLiveCounterPromise = null;
const cabinetProjectionInFlightByPath = new Map();
let cabinetProjectionRecent = { path: '', at: 0, data: null };
const CABINET_PROJECTION_RECENT_REUSE_MS = 2500;
let cabinetCreateDuePreset = 'today';
let cabinetMyDayListMode = 'focused';
let cabinetMyDaySegment = 'today';
let cabinetMyDayViewMode = 'compact';
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
let activeCabinetInlineTaskId = null;
let cabinetCreatePriority = 'normal';
let cabinetTaskComposerExpanded = false;
let cabinetPulseCounts = { alerts: 0, funnel: 0 };
let cabinetTaskSoundSettings = { enabled: true, volume: 0.4, theme: 'subtle' };
let cabinetSnoozeOutsideBound = false;
let cabinetTaskDragDropBound = false;
let cabinetTaskDragState = null;
let cabinetSubtaskDragDropBound = false;
let cabinetSubtaskDragState = null;
let cabinetUndoToastTimer = null;
let cabinetProjectionRefreshTimer = null;
let profileSecurityData = null;
let cabinetSavedDecompositionTemplates = [];
let cabinetDecompositionSuggestions = [];
let cabinetSuggestionTimer = null;
let lastCabinetSuggestionKey = '';
let lastCabinetCreatedTaskId = null;
let cabinetTaskCreatePending = false;
let cabinetTaskCreateAttempt = null;
let profileWidgetConfig = [];
let profileWidgetSettingsOpen = false;
const expandedCabinetSubtaskIds = new Set();
const collapsedCabinetSubtaskIds = new Set();
const cabinetSubtaskCache = new Map();
const loadingCabinetSubtaskIds = new Set();
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
let achievementCheckPending = false;

const CABINET_TASK_SEGMENTS = [
    { id: 'all', label: 'Всі мої', hint: 'Усі активні задачі, де ви власник або виконавець' },
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
const CABINET_MY_DAY_LIST_MODES = ['focused', 'all'];
const CABINET_MY_DAY_LIST_MODE_OPTIONS = [
    { value: 'focused', label: 'Обрана дата' },
    { value: 'all', label: 'Всі' }
];
const CABINET_MY_DAY_VIEW_MODES = ['compact', 'detailed'];
const CABINET_MY_DAY_VIEW_MODE_OPTIONS = [
    { value: 'compact', label: 'Компактний' },
    { value: 'detailed', label: 'Повний' }
];
const CABINET_MY_DAY_SEGMENTS = [
    { id: 'today', label: 'Сьогодні' },
    { id: 'overdue', label: 'Прострочено', tone: 'hot' },
    { id: 'waiting', label: 'Чекаю' },
    { id: 'completed', label: 'Готово' },
    { id: 'private', label: 'Приватне' }
];
const CABINET_MY_DAY_ALL_GROUP_IDS = ['overdue', 'today', 'tomorrow', 'later', 'no_date'];
const CABINET_MY_DAY_ALL_DEFAULT_COLLAPSED = ['later', 'no_date'];
const collapsedCabinetAllGroupIds = new Set(CABINET_MY_DAY_ALL_DEFAULT_COLLAPSED);
const expandedCabinetMyDayTaskIds = new Set();

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

async function refreshProfileRewardSurfaces(options = {}) {
    const {
        reloadAchievements = false,
        reloadQuests = true,
        reloadWallet = true,
        reloadSeason = false,
        reloadProfile = false
    } = options;

    if (reloadProfile && currentUserId) {
        profileData = await apiGet(isOwnProfile ? '/auth/profile' : `/auth/profile/${currentUserId}`);
    }
    if (reloadAchievements) myAchievements = await apiGet('/achievements') || [];
    if (reloadQuests && isOwnProfile) questsData = await apiGet('/quests/daily');
    if (reloadWallet && isOwnProfile) walletData = await apiGet('/wallet');
    if (reloadSeason && isOwnProfile) {
        seasonalQuests = null;
        await loadSeasonalQuests();
    }

    renderProfile();
}

async function checkProfileAutoRewards() {
    if (!isOwnProfile || achievementCheckPending) return;
    achievementCheckPending = true;
    try {
        const result = await apiPost('/achievements/check', {});
        await apiPost('/quests/check-titles', {});
        const awardedCount = result?.count || result?.awarded?.length || 0;
        if (awardedCount > 0) {
            if (typeof showNotification === 'function') {
                showNotification(`🎉 Нові досягнення: ${awardedCount}. Нагороду зараховано`, 'success');
            }
            await refreshProfileRewardSurfaces({
                reloadAchievements: true,
                reloadQuests: false,
                reloadWallet: true
            });
        }
    } catch (error) {
        console.warn('Profile auto reward check failed', error);
    } finally {
        achievementCheckPending = false;
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

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
    return normalizeProfileProfessionKey(staff.role_type || staff.roleType || profileRole(profileData) || 'default');
}

function profileSecondaryProfessionKeys() {
    const primary = profilePrimaryProfessionKey();
    const staff = profileStaffProfile();
    return normalizeProfileProfessionList(staff.secondary_professions || staff.secondaryProfessions, [primary]);
}

function profileProfessionEntry(key, options = {}) {
    const normalized = normalizeProfileProfessionKey(key) || 'default';
    const catalog = profileProfessionByKey(normalized);
    const guide = PROFILE_PROFESSION_GUIDES[normalized] || PROFILE_PROFESSION_GUIDES.default;
    const title = catalog?.title || profileRoleLabel(normalized);
    return {
        key: normalized,
        title,
        department: catalog?.department || '',
        shortInfo: catalog?.shortInfo || catalog?.short_info || guide.focus,
        responsibilities: Array.isArray(catalog?.responsibilities) && catalog.responsibilities.length
            ? catalog.responsibilities
            : guide.responsibilities,
        checklist: Array.isArray(catalog?.checklist) && catalog.checklist.length
            ? catalog.checklist
            : guide.checklist,
        color: catalog?.color || '#10b981',
        primary: options.primary === true
    };
}

function profileProfessionEntries() {
    const primary = profilePrimaryProfessionKey();
    const keys = [primary, ...profileSecondaryProfessionKeys()].filter(Boolean);
    const unique = [];
    const seen = new Set();
    keys.forEach((key, index) => {
        const normalized = normalizeProfileProfessionKey(key);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        unique.push(profileProfessionEntry(normalized, { primary: index === 0 }));
    });
    return unique.length ? unique : [profileProfessionEntry('default', { primary: true })];
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
    const requested = tab === 'profile' ? 'professions' : tab;
    return normalizeProfileTaskTab(requested);
}

function syncProfileTabToUrl(tab = activeTab, options = {}) {
    if (typeof window === 'undefined' || !window.history || !window.location) return;
    const normalized = normalizeProfileTab(tab) || 'professions';
    const params = new URLSearchParams(window.location.search || '');
    if (normalized === 'professions') params.delete('tab');
    else params.set('tab', normalized);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
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
        { id: 'achievements', label: 'Досягнення' },
        { id: 'leaderboard', label: 'Рейтинг' },
        { id: 'inventory', label: 'Інвентар', ownOnly: true },
        { id: 'shop', label: 'Магазин', ownOnly: true },
        { id: 'quests', label: 'Щоденні', ownOnly: true },
        { id: 'season', label: 'Сезон' },
        { id: 'teams', label: 'Команди' },
        { id: 'referral', label: 'Реферали', ownOnly: true }
    ];
}

const PROFILE_CREATOR_ONLY_TABS = new Set(['inventory', 'shop']);
const PROFILE_ALWAYS_SOON_TABS = new Set(['quests', 'season', 'teams', 'referral']);
const PROFILE_SOON_TAB_COPY = {
    inventory: {
        title: 'Інвентар скоро',
        kicker: 'Creator preview',
        message: 'Інвентар ще закритий для команди. Після запуску тут будуть робочі нагороди та предмети без тестової візуальної мішанини.'
    },
    shop: {
        title: 'Магазин скоро',
        kicker: 'Creator preview',
        message: 'Магазин поки доступний тільки Creator для перевірки балансу і товарів. Для команди покупки закриті до повного запуску.'
    },
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
    if (PROFILE_CREATOR_ONLY_TABS.has(tab) && !profileViewerIsCreator()) {
        return { code: 'creator_only', soon: true, creatorOnly: true };
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
    return `<button class="${classes}" data-profile-tab="${tab}" onclick="switchTab('${tab}')"${attrs}>${escapeHtml(label)}${options.suffix || ''}</button>`;
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
            return entries.length > 1 ? `${entries.length} професії` : '1 професія';
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
            signal: controller?.signal || externalSignal
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
        myCabinetLastLoadedAt = Date.now();
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
    const focusDate = requestedFocusDate || selectedFocusDate;
    const path = focusDate
        ? `/tasks/my-cabinet?focusDate=${encodeURIComponent(focusDate)}`
        : '/tasks/my-cabinet';
    const cacheKey = path;
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
            if (requestSequence !== cabinetProjectionRequestSequence) return myCabinetData;
            if (data && typeof data === 'object') {
                cabinetProjectionRecent = { path: cacheKey, at: Date.now(), data };
            }
            return setMyCabinetProjectionData(data, {
                keepExistingOnError: options.keepExistingOnError,
                message: options.message
            });
        } catch (error) {
            if (requestSequence !== cabinetProjectionRequestSequence) return myCabinetData;
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
        if (!user) { window.location.href = '/'; return; }
        if (typeof AppState !== 'undefined') AppState.currentUser = user;
        if (typeof hydrateBusinessOperatingProfile === 'function') await hydrateBusinessOperatingProfile(user);
        if (typeof hydrateActionPermissions === 'function') await hydrateActionPermissions(user);
        window.WorkingRole?.hydrate?.();
        currentUserId = user.id;
        loadCabinetMyDayViewModePreference();
    } catch (e) { window.location.href = '/'; return; }

    // Check URL for user ID
    const params = new URLSearchParams(window.location.search);
    const viewUserId = parseInt(params.get('id')) || currentUserId;
    isOwnProfile = viewUserId === currentUserId;
    const requestedTab = params.get('tab');
    const normalizedRequestedTab = normalizeProfileTab(requestedTab);
    const allowedOwnTabs = ['professions', 'checklists', 'materials', 'myday', 'settings', 'achievements', 'inventory', 'shop', 'leaderboard', 'quests', 'season', 'teams', 'referral'];
    if (isOwnProfile && normalizedRequestedTab && allowedOwnTabs.includes(normalizedRequestedTab)) {
        activeTab = normalizedRequestedTab;
    }
    syncProfileTabToUrl(activeTab, { replace: true });
    if (typeof window !== 'undefined' && window.addEventListener && !window.__profileTabPopstateBound) {
        window.__profileTabPopstateBound = true;
        window.addEventListener('popstate', async () => {
            const nextTab = normalizeProfileTab(new URLSearchParams(window.location.search || '').get('tab')) || 'professions';
            if (nextTab && nextTab !== activeTab) await switchTab(nextTab, { skipUrl: true });
        });
    }

    // Load data
    await loadProfileData(viewUserId);
    renderProfile();
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
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
            await refreshCabinetPulseCounts();
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
    if (!isOwnProfile) {
        if (tab === 'achievements') {
            myAchievements = await loadProfileResource('achievements', async () => await apiGet('/achievements') || []);
        }
        return;
    }
    if (['inventory', 'shop'].includes(tab)) {
        const inventoryResource = await loadProfileResource('inventory', async () => {
            const [wallet, inventory] = await Promise.all([apiGet('/wallet'), apiGet('/inventory')]);
            return { wallet, inventory: inventory || [] };
        });
        walletData = inventoryResource.wallet;
        myInventory = inventoryResource.inventory;
    }
    if (tab === 'achievements') {
        myAchievements = await loadProfileResource('achievements', async () => await apiGet('/achievements') || []);
    }
    if (['quests', 'titles'].includes(tab)) {
        const questResource = await loadProfileResource('quests', async () => {
            const [quests, titles, streaks] = await Promise.all([apiGet('/quests/daily'), apiGet('/quests/titles'), apiGet('/streaks')]);
            return { quests, titles, streaks };
        });
        questsData = questResource.quests;
        titlesData = questResource.titles;
        allStreaks = questResource.streaks;
    }
    if (isProfileTaskProjectionTab(tab)) {
        await loadProfileResource('cabinet', async () => {
            await loadMyCabinetProjection();
            applyCabinetTaskSoundPreferences(myCabinetData?.preferences || {});
            await refreshCabinetPulseCounts();
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
    const primary = entries[0] || profileProfessionEntry('default', { primary: true });
    const secondary = entries.slice(1, 4);
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
                    <strong>${secondary.length ? `${secondary.length} активні` : 'немає'}</strong>
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
    const active = profileActiveProfessionEntry();
    return `
        <div class="profile-work-hub-context" aria-label="Активна професія профілю">
            <div class="profile-work-hub-context-copy">
                <span class="profile-kicker">Активна професія</span>
                <strong>${escapeHtml(active.title)}</strong>
                <small>${escapeHtml(active.department || active.shortInfo || 'Професійний контекст')}</small>
            </div>
            <div class="profile-profession-switcher" role="list" aria-label="Перемикач професій">
                ${entries.map(entry => `
                    <button type="button"
                        class="profile-profession-switch ${entry.key === active.key ? 'active' : ''}"
                        style="--profession-color:${escapeHtml(entry.color)}"
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
    const visibleTabs = profileSecondaryTabOrder()
        .filter(tab => !(tab.ownOnly && !isOwnProfile));
    const unlockedTabs = visibleTabs.filter(tab => !profileTabLock(tab.id));
    const lockedTabs = visibleTabs.filter(tab => profileTabLock(tab.id));
    const body = [
        unlockedTabs.map(tab => renderProfilePrimaryTab(tab.id, tab.label, { ownOnly: tab.ownOnly })).join(''),
        renderProfileSoonMenu(lockedTabs)
    ].filter(Boolean).join('');
    if (!body) return '';
    return `
        <nav class="profile-secondary-work-menu" data-profile-tab-rail="true" aria-label="Додаткові розділи профілю">
            <div class="profile-secondary-work-menu-head">
                <div>
                    <span class="profile-kicker">Розділи профілю</span>
                    <strong>Робота, акаунт і розвиток</strong>
                </div>
            </div>
            <div class="profile-secondary-tabs" role="tablist" aria-label="Додаткові розділи профілю">
                ${body}
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
                <span class="profile-kicker">Мій день</span>
                <strong>${escapeHtml(name)}</strong>
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
    const primaryProfession = professionEntries[0];
    const secondaryCount = Math.max(0, professionEntries.length - 1);
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
            <span>Профіль працівника</span>
        </div>

        <div class="profile-header profile-work-header profile-friendly-shell ${isMyDayTab ? 'profile-work-header--myday' : ''}">
            ${isMyDayTab ? renderProfileMyDayCapsule(p, professionEntries) : `
                <div class="profile-identity-block">
                    ${isOwnProfile
                        ? renderProfileAvatarVisual('profile-work-avatar profile-avatar-clickable', p, ' role="button" tabindex="0" title="Змінити аватар" onclick="switchTab(\'settings\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();switchTab(\'settings\');}"')
                        : renderProfileAvatarVisual('profile-work-avatar', p)}
                    <div class="profile-identity-copy">
                        <div class="profile-identity-title-row">
                            <div>
                                <div class="profile-kicker">Особистий робочий профіль</div>
                                <h1>${escapeHtml(name)}</h1>
                            </div>
                            ${titleHtml ? `<div class="profile-title-row">${titleHtml}</div>` : ''}
                        </div>
                        <div class="profile-working-role-wrap">
                            <div class="profile-role-line profile-role-line--primary">
                                <span class="profile-role-pill profile-role-pill--profession">${escapeHtml(primaryProfession.title)}</span>
                                ${isOwnProfile ? `<button type="button" id="profileWorkingRoleTrigger" class="profile-working-role-trigger" aria-expanded="false" aria-controls="profileWorkingRolePanel">
                                    <small>Робоча роль</small>
                                    <b>${escapeHtml(workingRoleLabel)}</b>
                                </button>` : `<span class="profile-role-pill">Доступ: ${escapeHtml(roleLabel)}</span>`}
                            </div>
                            ${isOwnProfile ? renderProfileWorkingRoleControl(workingRoleState) : ''}
                        </div>
                        <div class="profile-identity-meta-row">
                            ${secondaryCount ? `<span>+${secondaryCount} додаткові професії</span>` : '<span>одна активна професія</span>'}
                            ${username ? `<span>@${escapeHtml(username)}</span>` : '<span>username не вказано</span>'}
                            <span class="${p.user?.telegramConnected ? 'is-ok' : ''}">${p.user?.telegramConnected ? 'Telegram підключено' : 'Telegram не підключено'}</span>
                        </div>
                        ${p.user?.bio || p.bio ? `<div class="profile-bio">${escapeHtml(p.user?.bio || p.bio)}</div>` : ''}
                    </div>
                </div>

                ${renderProfileProfessionHeaderPanel(professionEntries)}
            `}
        </div>

        <section class="profile-work-hub ${isMyDayTab ? 'profile-work-hub--myday' : ''}" aria-label="Робочий доступ профілю">
            ${isMyDayTab ? '' : renderProfileProfessionSwitcher(professionEntries)}
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
    const requestSeq = ++profileTabRequestSeq;
    activeTab = tab;
    if (!options.skipUrl) syncProfileTabToUrl(tab);
    const locked = profileTabLock(tab);
    if (!locked && isProfileTaskProjectionTab(tab)) {
        myCabinetLoadState = myCabinetData ? 'refreshing' : 'loading';
        const tabContent = document.getElementById('tabContent');
        if (tabContent) {
            tabContent.innerHTML = renderTabContent();
            attachProfileListeners();
        }
    }
    if (!locked) await ensureProfileTabData(tab);
    if (requestSeq !== profileTabRequestSeq || activeTab !== tab) return false;
    // Lazy load data for tabs that need it
    if (!locked && tab === 'shop' && shopItems.length === 0) await loadShopItems();
    if (!locked && tab === 'leaderboard' && !leaderboardData) await loadLeaderboard();
    if (!locked && tab === 'season' && !seasonalQuests) await loadSeasonalQuests();
    if (!locked && tab === 'teams' && !teamsData) await loadTeamsData();
    if (!locked && tab === 'referral' && !referralData) await loadReferralData();
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
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
    const activeSoon = profileSecondaryTabOrder().some(item => item.id === tab && profileTabLock(item.id));
    document.querySelectorAll('[data-profile-soon-trigger]').forEach(btn => {
        btn.classList.toggle('active', activeSoon);
        btn.setAttribute('aria-selected', activeSoon ? 'true' : 'false');
        if (activeSoon) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
    document.querySelectorAll('.profile-soon-menu-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.profileTab === tab);
    });
    return true;
}

async function setProfileProfessionContext(key) {
    const normalized = normalizeProfileProfessionKey(key);
    if (!profileProfessionKeys().includes(normalized)) return;
    activeProfessionKey = normalized;
    if (activeTab === 'materials') {
        const tabContent = document.getElementById('tabContent');
        if (tabContent) tabContent.innerHTML = renderProfileMaterialsTab();
        await loadProfileWorkMaterials(normalized);
    }
    renderProfile();
}

function renderTabContent() {
    const locked = profileTabLock(activeTab);
    if (locked) return renderProfileComingSoon(activeTab);
    switch (activeTab) {
        case 'profile':
        case 'professions': return renderProfileProfessionsTab();
        case 'checklists': return renderProfileChecklistsTab();
        case 'materials': return renderProfileMaterialsTab();
        case 'myday': return renderMyDayTab();
        case 'mytasks': return renderMyDayTab();
        case 'settings': return renderProfileSettingsTab();
        case 'achievements': return renderAchievements();
        case 'inventory': return renderInventory();
        case 'shop': return renderShopTab();
        case 'leaderboard': return renderLeaderboardTab();
        case 'room': return '<div style="text-align:center;padding:40px;color:var(--gray-400)">Кімнату прибрано. Використовуй інші розділи!</div>';
        case 'quests': return renderQuests();
        case 'titles': return renderTitles();
        case 'season': return renderSeasonTab();
        case 'teams': return renderTeamsTab();
        case 'referral': return renderReferralTab();
        default: return renderProfileProfessionsTab();
    }
}

function profileProfessionGuide(role = profileRole()) {
    const entry = profileProfessionEntry(role || profilePrimaryProfessionKey(), { primary: true });
    return {
        focus: entry.shortInfo,
        responsibilities: entry.responsibilities,
        checklist: entry.checklist
    };
}

function profileProfessionContext() {
    const p = profileData || {};
    const user = profileUser(p);
    const role = profilePrimaryProfessionKey();
    const primaryProfession = profileProfessionEntry(role, { primary: true });
    const shift = p.nextShift || p.todayShift || {};
    return {
        role,
        roleLabel: primaryProfession.title,
        displayName: profileDisplayName(p),
        username: profileUsername(p),
        department: primaryProfession.department || shift.department || user.department || p.department || '',
        position: shift.position || user.position || p.position || primaryProfession.title,
        telegramConnected: Boolean(user.telegramConnected),
        guide: {
            focus: primaryProfession.shortInfo,
            responsibilities: primaryProfession.responsibilities,
            checklist: primaryProfession.checklist
        },
        professions: profileProfessionEntries()
    };
}

function profileAllProfessionTasks() {
    const buckets = [
        profileData?.myTasks,
        profileData?.tasks?.overdueList,
        profileData?.tasks?.upcoming,
        myCabinetData?.all,
        myCabinetData?.today,
        myCabinetData?.overdue,
        myCabinetData?.waiting,
        myCabinetData?.private
    ];
    const seen = new Set();
    const list = [];
    buckets.forEach(bucket => {
        if (!Array.isArray(bucket)) return;
        bucket.forEach(task => {
            const key = task?.id || task?.taskId || task?.task_id || `${task?.title || ''}-${task?.deadline || task?.scheduledStartAt || ''}`;
            if (!key || seen.has(String(key))) return;
            seen.add(String(key));
            list.push(task);
        });
    });
    return list;
}

function profileProfessionChecklistTasks() {
    return profileAllProfessionTasks()
        .filter(task => {
            const category = String(task.category || '').toLowerCase();
            const kind = String(task.taskKind || task.task_kind || task.kind || '').toLowerCase();
            const title = String(task.title || '').toLowerCase();
            return category === 'checklist' || kind === 'checklist' || title.includes('чек') || title.includes('checklist');
        })
        .slice(0, 5);
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
    const checklistTasks = profileProfessionChecklistTasks();
    const checklistItems = profileProfessionEntries()
        .flatMap(entry => (entry.checklist || []).map(item => `${entry.title}: ${item}`))
        .slice(0, 8);
    if (checklistTasks.length) {
        return `<div class="profile-work-list">${checklistTasks.map(task => renderProfileTaskRow(task, 'Чекліст')).join('')}</div>`;
    }
    return renderProfileProfessionFallbackChecklist(checklistItems.length ? checklistItems : profileProfessionGuide().checklist);
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
    const tasks = profileProfessionChecklistTasks();
    return `
        <div class="profile-professions-hub profile-work-hub-grid">
            <section class="profile-work-panel profile-work-panel-primary profile-role-focus-panel" style="--profession-color:${escapeHtml(active.color)}">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Чекліст активної професії</span>
                        <h2>${escapeHtml(active.title)}</h2>
                    </div>
                    <span>${escapeHtml(active.department || active.key)}</span>
                </div>
                <p>${escapeHtml(active.shortInfo || 'HR опис професії ще не заповнений.')}</p>
                ${renderProfileChecklistItemsForProfession(active)}
            </section>
            <section class="profile-work-panel profile-work-panel-tasks">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Живі checklist-задачі</span>
                        <h2>З task engine</h2>
                    </div>
                    <a href="/tasks?category=checklist">Задачі</a>
                </div>
                ${tasks.length
                    ? `<div class="profile-work-list">${tasks.map(task => renderProfileTaskRow(task, 'Чекліст')).join('')}</div>`
                    : '<div class="profile-empty-professional">Активних checklist-задач для цього профілю зараз немає.</div>'}
            </section>
            <section class="profile-work-panel profile-work-panel-wide">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Усі професійні чеклісти</span>
                        <h2>Швидкий доступ</h2>
                    </div>
                    <a href="/hr?tab=checklists">HR чеклісти</a>
                </div>
                <div class="profile-profession-roster">
                    ${profileProfessionEntries().map(entry => `
                        <article class="profile-profession-card ${entry.key === active.key ? 'is-primary' : ''}" style="--profession-color:${escapeHtml(entry.color)}">
                            <div class="profile-profession-card-head">
                                <span>${entry.key === active.key ? 'Активна' : (entry.primary ? 'Основна' : 'Додаткова')}</span>
                                <button type="button" class="profile-inline-switch" onclick="setProfileProfessionContext('${escapeHtml(entry.key)}')">Відкрити</button>
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
    if (!options.force && profileMaterialsState.loaded && profileMaterialsState.key === normalized) return profileMaterialsState;
    profileMaterialsState = {
        key: normalized,
        loading: true,
        loaded: false,
        articles: [],
        materials: [],
        error: ''
    };
    const tabContent = document.getElementById('tabContent');
    if (activeTab === 'materials' && tabContent) tabContent.innerHTML = renderProfileMaterialsTab();
    try {
        const trainingRole = encodeURIComponent(profileTrainingRoleKey(normalized));
        const [knowledgeBase, legacyMaterials] = await Promise.all([
            apiGet(`/training/knowledge-base?role=${trainingRole}`),
            apiGet('/training/materials?page=1&limit=30')
        ]);
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

function renderProfileProfessionResponsibilities(items = []) {
    return `
        <div class="profile-profession-responsibilities">
            ${items.map(item => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>`;
}

function renderProfileProfessionCard(entry) {
    return `
        <article class="profile-profession-card ${entry.primary ? 'is-primary' : ''}" style="--profession-color:${escapeHtml(entry.color)}">
            <div class="profile-profession-card-head">
                <span>${entry.key === profileActiveProfessionEntry().key ? 'Активна' : (entry.primary ? 'Основна' : 'Додаткова')}</span>
                <button type="button" class="profile-inline-switch" onclick="setProfileProfessionContext('${escapeHtml(entry.key)}')">Обрати</button>
                ${entry.department ? `<small>${escapeHtml(entry.department)}</small>` : ''}
            </div>
            <h3>${escapeHtml(entry.title)}</h3>
            <p>${escapeHtml(entry.shortInfo || 'Короткий опис ще не заповнено в HR каталозі.')}</p>
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
    const context = profileProfessionContext();
    const guide = context.guide;
    const nextShift = p.nextShift || p.todayShift || null;
    const professions = context.professions || profileProfessionEntries();
    const activeProfession = profileActiveProfessionEntry();

    return `
        <div class="profile-professions-hub">
            <section class="profile-work-panel profile-profession-hero">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Активний професійний контекст</span>
                        <h2>${escapeHtml(activeProfession.title)}</h2>
                    </div>
                    <span>${escapeHtml(activeProfession.department || context.position || context.roleLabel)}</span>
                </div>
                <p>${escapeHtml(activeProfession.shortInfo || guide.focus)}</p>
                <div class="profile-profession-meta">
                    <span>Основна: ${escapeHtml(professions[0]?.title || activeProfession.title)}</span>
                    <span>Активна: ${escapeHtml(activeProfession.title)}</span>
                    ${professions.length > 1 ? `<span>${professions.length - 1} додаткові професії</span>` : ''}
                    ${context.department ? `<span>Зона: ${escapeHtml(context.department)}</span>` : ''}
                    ${context.username ? `<span>@${escapeHtml(context.username)}</span>` : ''}
                    <span>${context.telegramConnected ? 'Telegram підключено' : 'Telegram не підключено'}</span>
                </div>
                ${renderProfileProfessionResponsibilities(activeProfession.responsibilities || guide.responsibilities)}
            </section>

            <section class="profile-work-panel profile-profession-roster-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Професії працівника</span>
                        <h2>Primary + additional</h2>
                    </div>
                    <a href="/hr#team">Редагувати в HR</a>
                </div>
                <div class="profile-profession-roster">
                    ${professions.map(entry => renderProfileProfessionCard({
                        ...entry,
                        primary: entry.key === activeProfession.key ? true : entry.primary
                    })).join('')}
                </div>
            </section>

            <section class="profile-work-panel profile-profession-checklist-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Чекліст ролі</span>
                        <h2>Що тримати під контролем</h2>
                    </div>
                    <a href="/tasks?view=my">Відкрити задачі</a>
                </div>
                ${renderProfileProfessionChecklist()}
            </section>

            <section class="profile-work-panel profile-profession-ops-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Операційний стан</span>
                        <h2>Сьогодні для ролі</h2>
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
                    : '<div class="profile-empty-professional">Активних задач для цієї ролі зараз немає.</div>'}
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
                    <a href="/hr?tab=schedule">Графік <span>зміни й присутність</span></a>
                    <a href="/training">Навчання <span>матеріали ролі</span></a>
                </div>
            </section>

        </div>`;
}

function renderProfileSettingsTab() {
    const avatar = profileAvatarData(profileData);
    const currentColor = avatar.color || '#f59e0b';
    const crop = normalizeProfileAvatarCrop(avatar.crop);
    return `
        <div class="profile-settings-shell">
            <section class="profile-work-panel profile-settings-panel">
                <div class="profile-panel-head">
                    <div>
                        <span class="profile-kicker">Налаштування профілю</span>
                        <h2>Аватарка</h2>
                    </div>
                    <span>Header + sidebar</span>
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
            ${renderProfileSecurityPanel()}
        </div>`;
}

function renderProfileSecurityPanel() {
    const security = profileSecurityData || {};
    const user = security.user || profileUser(profileData);
    const rawSessions = Array.isArray(security.sessions) ? security.sessions : [];
    const sessions = normalizeProfileSecuritySessions(rawSessions);
    const events = Array.isArray(security.events) ? security.events : [];
    const passwordChanged = user.password_changed_at || user.passwordChangedAt;
    const sessionRevokedAt = user.session_revoked_at || user.sessionRevokedAt;
    const lastSeenAt = user.last_seen_at || user.lastSeenAt;
    return `
        <section class="profile-work-panel profile-settings-panel profile-security-panel">
            <div class="profile-panel-head">
                <div>
                    <span class="profile-kicker">Безпека акаунта</span>
                    <h2>Пароль, сесії, журнал</h2>
                </div>
                <span>${sessions.length} активн${sessions.length === 1 ? 'ий' : 'их'} пристро${sessions.length === 1 ? 'й' : 'їв'}</span>
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
                    ${sessions.length
                        ? sessions.map(renderProfileSessionRow).join('')
                        : '<div class="profile-security-empty">Активні пристрої не знайдено. Поточний legacy-вхід завершиться після logout або завершення JWT.</div>'}
                </div>
                <div class="profile-security-card">
                    <div class="profile-security-card-head">
                        <b>Журнал акаунта</b>
                        <span>паролі, ролі, сесії</span>
                    </div>
                    ${events.length
                        ? events.map(renderProfileSecurityEventRow).join('')
                        : '<div class="profile-security-empty">Подій безпеки акаунта ще немає.</div>'}
                </div>
            </div>
        </section>`;
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
const CABINET_PLANNING_TASK_BUCKETS = ['all', 'overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'plusThreeDays', 'monthEnd', 'noDate'];
const cabinetClassificationMutationInFlight = new Set();
const cabinetClassificationMutationQueue = new Map();
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

function applyCabinetTaskMyDayClassification(taskId, classification = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) return false;
    let changed = false;
    forEachCabinetProjectionTaskList((owner, key) => {
        owner[key].forEach(task => {
            if (cabinetProjectionTaskId(task) !== id) return;
            task.myDay = {
                ...(task.myDay || {}),
                direction: classification.direction || null,
                impacts: Array.isArray(classification.impacts) ? classification.impacts : []
            };
            changed = true;
        });
    });
    return changed;
}

function refreshCabinetTaskClassificationBadges(taskId, classification = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) return;
    document.querySelectorAll(`[data-my-day-classification-badges="${id}"]`).forEach(node => {
        node.innerHTML = window.MyDayClassification?.renderTaskBadges?.(classification, { taskId: id }) || '';
    });
    bindCabinetTaskActions(document);
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
        completedTodayKind: Number(task.completedSubtasksToday ?? task.completed_subtask_count_today ?? fallback.completedSubtasksToday ?? fallback.completed_subtask_count_today ?? 0) > 0
            ? 'task_and_subtasks'
            : 'task',
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
        refreshMyCabinetTab({ silent: true }).catch(error => console.warn('Profile cabinet background refresh failed', error));
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
        window.TaskUI?.closeActionMenu?.();
        tabContent.innerHTML = renderTabContent();
        attachProfileListeners();
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
    const countText = total > 0 && returned > 0 ? `<small>Показано ${escapeHtml(returned)} із ${escapeHtml(total)}</small>` : '';
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
            limit: String(limit)
        });
        const payload = await apiGetScopedJson(`/tasks/my-cabinet?${params.toString()}`, {
            timeoutMs: CABINET_PROJECTION_TIMEOUT_MS
        });
        mergeCabinetBucketPage(bucket, payload);
        renderCabinetActiveTab();
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
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date).reduce((acc, part) => {
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
    return cabinetList('completedTodayTasks');
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

function cabinetTaskCompletedSubtasksToday(task = {}) {
    const explicit = Number(task.completedSubtasksToday ?? task.completed_subtask_count_today ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const today = cabinetCompletedTodayKey();
    return (Array.isArray(task.subtasks) ? task.subtasks : []).filter(item => {
        const completedAt = item.completedAt || item.completed_at || '';
        return (item.isDone === true || item.is_done === true) && completedAt && cabinetKyivDateKey(completedAt) === today;
    }).length;
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

function cabinetCompletedTodayTaskImpacts(task = {}) {
    return Array.isArray(task?.myDay?.impacts)
        ? task.myDay.impacts.filter(impact => Number(impact?.id) > 0)
        : [];
}

function cabinetCompletedTodayMetrics(tasks = cabinetCompletedTodayTasksList()) {
    const parentTasks = tasks.filter(cabinetTaskParentCompletedToday).length;
    const subtasks = tasks.reduce((sum, task) => sum + cabinetTaskCompletedSubtasksToday(task), 0);
    const seconds = tasks.reduce((sum, task) => sum + Math.max(0, Number(task.actualSecondsToday ?? task.actual_seconds_today ?? 0)), 0);
    return {
        parentTasks,
        subtasks,
        totalUnits: parentTasks + subtasks,
        seconds
    };
}

function cabinetCompletedTodayImpactDistribution(tasks = cabinetCompletedTodayTasksList()) {
    const map = new Map();
    let withoutImpact = 0;
    tasks.forEach(task => {
        const impacts = cabinetCompletedTodayTaskImpacts(task);
        if (!impacts.length) {
            withoutImpact += 1;
            return;
        }
        impacts.forEach(impact => {
            const id = Number(impact.id);
            if (!Number.isInteger(id) || id <= 0) return;
            const current = map.get(id) || { ...impact, count: 0 };
            current.count += 1;
            map.set(id, current);
        });
    });
    return {
        impacts: [...map.values()].sort((a, b) => b.count - a.count || String(a.name || '').localeCompare(String(b.name || ''))),
        withoutImpact
    };
}

function cabinetCompletionRowTypeLabel(task = {}, mode = 'today') {
    if (mode !== 'today') return 'Задача виконана';
    const completedSubtasksToday = cabinetTaskCompletedSubtasksToday(task);
    if (cabinetTaskParentCompletedToday(task)) return 'Задача виконана';
    if (completedSubtasksToday > 0) return `Виконано ${formatCabinetPulseCount(completedSubtasksToday)} підпунктів`;
    return 'Оновлено сьогодні';
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

function renderCabinetCompletionRowImpacts(impacts = [], limit = 2) {
    const list = Array.isArray(impacts) ? impacts : [];
    if (!list.length) {
        return '<div class="cabinet-completion-row-impacts"><span class="cabinet-completion-impact-chip is-muted">Без впливу</span></div>';
    }
    const safeLimit = Math.max(1, Number(limit || 2));
    const visible = list.slice(0, safeLimit);
    const hidden = Math.max(0, list.length - visible.length);
    return `<div class="cabinet-completion-row-impacts">
        ${visible.map(impact => `<span class="cabinet-completion-impact-chip" style="--my-day-chip-color:${escapeHtml(impact.color || '#64748b')}">${renderCabinetImpactIcon(impact, { size: 13, className: 'cabinet-completion-impact-chip-icon' })}<span>${escapeHtml(impact.name || 'Вплив')}</span></span>`).join('')}
        ${hidden ? `<span class="cabinet-completion-impact-chip is-muted" aria-label="${escapeHtml(`Ще ${hidden} впливів`)}">+${formatCabinetPulseCount(hidden)}</span>` : ''}
    </div>`;
}

function renderCabinetCompletionTaskRow(task = {}, index = 0, mode = 'today') {
    const taskId = normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
    const completedAt = cabinetTaskCompletedAt(task);
    const subSummary = cabinetSubtaskSummary(task);
    const impacts = cabinetCompletedTodayTaskImpacts(task);
    const impactChips = renderCabinetCompletionRowImpacts(impacts, 2);
    const progress = subSummary.total
        ? `${formatCabinetPulseCount(subSummary.done)}/${formatCabinetPulseCount(subSummary.total)} пунктів`
        : '';
    const seconds = mode === 'today'
        ? Number(task.actualSecondsToday ?? task.actual_seconds_today ?? 0)
        : Number(task.actualSeconds ?? task.actual_seconds ?? 0);
    const completedMeta = [
        cabinetCompletionRowTypeLabel(task, mode),
        completedAt ? profileFormatTime(completedAt) : '',
        cabinetFormatDuration(seconds),
        progress
    ].filter(Boolean).join(' · ');
    const actionAttrs = taskId
        ? `data-cabinet-task-action="open" data-task-id="${taskId}"`
        : 'disabled';
    return `<button type="button" class="cabinet-completion-row" ${actionAttrs} aria-label="${escapeHtml(`Відкрити виконання: ${task.title || 'Без назви'}`)}">
        <span class="cabinet-completion-row-mark" aria-hidden="true">${index + 1}</span>
        <span class="cabinet-completion-row-main">
            <b>${escapeHtml(task.title || 'Без назви')}</b>
            <small>${escapeHtml(completedMeta)}</small>
            ${impactChips}
        </span>
    </button>`;
}

function renderCabinetCompletedTodayTaskRow(task = {}, index = 0) {
    return renderCabinetCompletionTaskRow(task, index, 'today');
}

function renderCabinetImpactIcon(impact = {}, options = {}) {
    const size = Math.max(10, Math.min(24, Number(options.size || 16)));
    const className = escapeHtml(options.className || 'cabinet-completion-impact-icon');
    const wrapperClass = escapeHtml(options.wrapperClass || 'cabinet-completion-icon');
    const color = escapeHtml(impact.color || '#64748b');
    if (typeof window !== 'undefined' && window.MyDayImpactIcons && typeof window.MyDayImpactIcons.render === 'function') {
        return `<span class="${wrapperClass}" style="--my-day-chip-color:${color}" aria-hidden="true">${window.MyDayImpactIcons.render(impact, { size })}</span>`;
    }
    return `<span class="${wrapperClass}" style="--my-day-chip-color:${color}" aria-hidden="true">
        <svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M8 12h8M12 8v8"></path>
        </svg>
    </span>`;
}

function cabinetCompletedTodayDistributionItems(distribution = cabinetCompletedTodayImpactDistribution()) {
    const impactItems = (Array.isArray(distribution.impacts) ? distribution.impacts : []).map(impact => ({
        key: `impact:${Number(impact.id)}`,
        label: impact.name || 'Вплив',
        count: Number(impact.count || 0),
        color: impact.color || '#64748b',
        iconRecord: impact,
        muted: false
    }));
    if (Number(distribution.withoutImpact || 0) > 0) {
        impactItems.push({
            key: 'none',
            label: 'Без впливу',
            count: Number(distribution.withoutImpact || 0),
            color: '#5eead4',
            iconRecord: null,
            muted: true
        });
    }
    return impactItems
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count || String(a.label || '').localeCompare(String(b.label || '')));
}

function renderCabinetCompletedTodayPulseImpacts(distribution = cabinetCompletedTodayImpactDistribution(), totalTasks = 0, options = {}) {
    const limit = Math.max(1, Number(options.limit || 3));
    const items = cabinetCompletedTodayDistributionItems(distribution).slice(0, limit);
    if (!items.length) {
        return '<div class="cabinet-completion-empty-mini">Ще немає класифікації.</div>';
    }
    const max = Math.max(1, ...items.map(item => item.count));
    const ariaLabel = options.ariaLabel || 'Топ впливів виконань';
    return `<div class="cabinet-completion-impact-bars" aria-label="${escapeHtml(ariaLabel)}">
        ${items.map(item => {
            const width = Math.max(8, Math.round((item.count / max) * 100));
            return `<div class="cabinet-completion-impact-row ${item.muted ? 'is-muted' : ''}">
                ${item.iconRecord ? renderCabinetImpactIcon(item.iconRecord, { size: 14 }) : '<span class="cabinet-completion-icon is-muted" aria-hidden="true"></span>'}
                <span>${escapeHtml(item.label)}</span>
                <div class="cabinet-completion-bar" aria-hidden="true"><i style="width:${width}%; --my-day-chip-color:${escapeHtml(item.color)}"></i></div>
                <b>${formatCabinetPulseCount(item.count)}</b>
            </div>`;
        }).join('')}
        ${totalTasks > items.reduce((sum, item) => sum + item.count, 0) && options.showOther
            ? `<div class="cabinet-completion-more">+${formatCabinetPulseCount(totalTasks - items.reduce((sum, item) => sum + item.count, 0))} інших</div>`
            : ''}
    </div>`;
}

function normalizeCabinetCompletionTab(tab = completedDashboardTab) {
    return tab === 'history' ? 'history' : 'today';
}

function renderCabinetCompletionTabs(activeTab = normalizeCabinetCompletionTab()) {
    const todayCount = cabinetCompletedTodayMetrics().totalUnits;
    const historyCount = cabinetCompletionHistoryTotalCount();
    return `<div class="cabinet-completion-tabs" role="tablist" aria-label="Зріз виконань">
        <button type="button" id="cabinetCompletionTabToday" class="${activeTab === 'today' ? 'active' : ''}" data-cabinet-completion-tab="today" role="tab" aria-selected="${activeTab === 'today' ? 'true' : 'false'}" aria-controls="cabinetCompletionDetails">Сьогодні <b>${formatCabinetPulseCount(todayCount)}</b></button>
        <button type="button" id="cabinetCompletionTabHistory" class="${activeTab === 'history' ? 'active' : ''}" data-cabinet-completion-tab="history" role="tab" aria-selected="${activeTab === 'history' ? 'true' : 'false'}" aria-controls="cabinetCompletionDetails">Історія <b>${formatCabinetPulseCount(historyCount)}</b></button>
    </div>`;
}

function renderCabinetCompletionDetails() {
    const activeTab = normalizeCabinetCompletionTab();
    const todayTasks = cabinetCompletedTodayTasksList();
    const historyState = cabinetCompletionHistoryState();
    const history = historyState.items;
    const tasks = activeTab === 'history' ? history : todayTasks;
    const visibleCount = cabinetCompletionVisibleCount(tasks.length);
    const visibleTasks = tasks.slice(0, visibleCount);
    const localOverflow = Math.max(0, tasks.length - visibleTasks.length);
    const historyHasMore = activeTab === 'history' && Boolean(historyState.hasMore);
    const historyLoading = activeTab === 'history' && Boolean(historyState.loading);
    const historyError = activeTab === 'history' ? historyState.error || '' : '';
    const distribution = cabinetCompletedTodayImpactDistribution(tasks);
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
    const distributionHint = activeTab === 'history' && historyHasMore
        ? '<small>Серед завантажених</small>'
        : '';
    const footerLabel = activeTab === 'history' && historyHasMore && !localOverflow
        ? 'Завантажити ще'
        : `Показати ще · +${formatCabinetPulseCount(localOverflow)}`;
    const showFooter = activeTab === 'history'
        ? (localOverflow > 0 || historyHasMore || Boolean(historyError))
        : localOverflow > 0;
    return `<div id="cabinetCompletionDetails" class="cabinet-completion-details" data-cabinet-completion-details role="tabpanel" aria-labelledby="${activeTab === 'history' ? 'cabinetCompletionTabHistory' : 'cabinetCompletionTabToday'}">
        <div class="cabinet-completion-impact-strip">
            <h4>${activeTab === 'history' ? 'Класифікація історії' : 'Класифікація сьогодні'}${distributionHint}</h4>
            ${renderCabinetCompletedTodayPulseImpacts(distribution, tasks.length, { limit: 4, showOther: true, ariaLabel: activeTab === 'history' ? 'Топ впливів історії виконань' : 'Топ впливів виконань сьогодні' })}
        </div>
        <div class="cabinet-completion-list">
            <div class="cabinet-completion-list-head">
                <h4>${escapeHtml(title)}</h4>
                <span>${escapeHtml(countLabel)}</span>
            </div>
            ${visibleTasks.length
                ? rows
                : `<div class="cabinet-completion-empty">${escapeHtml(empty)}</div>`}
            ${historyError ? `<div class="cabinet-completion-error" role="status">${escapeHtml(historyError)}</div>` : ''}
            ${historyLoading ? '<div class="cabinet-completion-loading" role="status">Завантажуємо історію…</div>' : ''}
            ${showFooter ? `<button type="button" class="cabinet-completion-all" data-cabinet-completion-all="true" ${historyLoading ? 'disabled aria-busy="true"' : ''}>${escapeHtml(historyError ? 'Повторити' : footerLabel)}</button>` : ''}
        </div>
    </div>`;
}

function renderCabinetCompletionPulse() {
    const tasks = cabinetCompletedTodayTasksList();
    const historyCounts = cabinetCompletedHistoryCounts();
    const metrics = cabinetCompletedTodayMetrics(tasks);
    const distribution = cabinetCompletedTodayImpactDistribution(tasks);
    const expanded = Boolean(completedDashboardExpanded);
    const hasData = tasks.length > 0 || metrics.totalUnits > 0;
    const allTimeLabel = `${formatCabinetPulseCount(Math.max(historyCounts.total, historyCounts.shown))} за весь час`;
    return `<section class="cabinet-completion-pulse ${hasData ? '' : 'is-empty'} ${expanded ? 'is-expanded' : ''}" data-cabinet-completion-pulse aria-label="Виконано">
        <div class="cabinet-completion-summary">
            <div class="cabinet-completion-head">
                <div class="cabinet-completion-title">
                    <span class="cabinet-kicker">Виконано</span>
                    <h3>${hasData ? `${formatCabinetPulseCount(metrics.totalUnits)} разом` : 'Ще немає виконань'}</h3>
                    <p>${escapeHtml(allTimeLabel)} · останні ${formatCabinetPulseCount(historyCounts.shown)} задач</p>
                </div>
            </div>
            <div class="cabinet-completion-metrics">
                <span><b>${formatCabinetPulseCount(metrics.parentTasks)}</b><small>задач</small></span>
                <span><b>${formatCabinetPulseCount(metrics.subtasks)}</b><small>пункти</small></span>
                <span><b>${escapeHtml(cabinetFormatDuration(metrics.seconds))}</b><small>час</small></span>
            </div>
            <div class="cabinet-completion-top">
                ${renderCabinetCompletedTodayPulseImpacts(distribution, tasks.length, { limit: 3, showOther: true })}
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

function normalizeCabinetMyDayListMode(mode = 'focused') {
    const normalized = String(mode || 'focused');
    return CABINET_MY_DAY_LIST_MODES.includes(normalized) ? normalized : 'focused';
}

function normalizeCabinetMyDayViewMode(mode = 'compact') {
    const normalized = String(mode || 'compact').trim().toLowerCase();
    return CABINET_MY_DAY_VIEW_MODES.includes(normalized) ? normalized : 'compact';
}

function cabinetMyDayBusinessPreferenceScope() {
    const timelineScope = typeof window !== 'undefined' && window.TimelineBusinessContext?.current
        ? window.TimelineBusinessContext.current()
        : null;
    const user = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    return String(timelineScope?.apiValue || timelineScope?.key || user.defaultBusinessContext || user.default_business_context || 'default').trim() || 'default';
}

function cabinetMyDayViewPreferenceKey() {
    const user = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    const userId = String(user.id || user.user_id || currentUserId || 'anonymous').trim() || 'anonymous';
    const business = cabinetMyDayBusinessPreferenceScope().replace(/[^a-zA-Z0-9:_-]/g, '_');
    const key = `my-day-card-view:${userId}:${business}`;
    return typeof window !== 'undefined' && window.TimelineBusinessContext?.storageKey
        ? window.TimelineBusinessContext.storageKey(key)
        : key;
}

function loadCabinetMyDayViewModePreference() {
    try {
        const stored = window.localStorage?.getItem?.(cabinetMyDayViewPreferenceKey());
        cabinetMyDayViewMode = normalizeCabinetMyDayViewMode(stored || 'compact');
    } catch {
        cabinetMyDayViewMode = 'compact';
    }
    return cabinetMyDayViewMode;
}

function getCabinetMyDayViewMode() {
    cabinetMyDayViewMode = normalizeCabinetMyDayViewMode(cabinetMyDayViewMode);
    return cabinetMyDayViewMode;
}

function setCabinetMyDayViewMode(mode = 'compact', options = {}) {
    cabinetMyDayViewMode = normalizeCabinetMyDayViewMode(mode);
    try { window.localStorage?.setItem?.(cabinetMyDayViewPreferenceKey(), cabinetMyDayViewMode); } catch {}
    document.querySelectorAll?.('[data-cabinet-my-day-view-mode]').forEach(button => {
        const active = button.dataset.cabinetMyDayViewMode === cabinetMyDayViewMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (options.rerender === true && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        renderCabinetActiveTab();
    }
    return cabinetMyDayViewMode;
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
        renderCabinetActiveTab();
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

function getCabinetMyDayListMode() {
    cabinetMyDayListMode = normalizeCabinetMyDayListMode(cabinetMyDayListMode);
    return cabinetMyDayListMode;
}

function getCabinetMyDayState() {
    return {
        selectedDuePreset: normalizeCabinetDuePreset(cabinetCreateDuePreset),
        selectedDueDate: cabinetSelectedDueDate(),
        selectedPriority: normalizeCabinetPriority(cabinetCreatePriority),
        listMode: getCabinetMyDayListMode(),
        viewMode: getCabinetMyDayViewMode()
    };
}

function setCabinetMyDayListMode(mode = 'focused', options = {}) {
    cabinetMyDayListMode = normalizeCabinetMyDayListMode(mode);
    document.querySelectorAll?.('[data-cabinet-list-mode]').forEach(btn => {
        const active = btn.dataset.cabinetListMode === cabinetMyDayListMode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (options.rerender === true && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        renderCabinetActiveTab();
    }
    return cabinetMyDayListMode;
}

function normalizeCabinetMyDaySegment(segment = cabinetMyDaySegment) {
    const value = String(segment || '').trim().toLowerCase();
    return CABINET_MY_DAY_SEGMENTS.some(item => item.id === value) ? value : 'today';
}

function getCabinetMyDaySegment() {
    cabinetMyDaySegment = normalizeCabinetMyDaySegment(cabinetMyDaySegment);
    return cabinetMyDaySegment;
}

function cabinetMyDayTodayTasks() {
    return cabinetFocusedMyDayTasks({
        ...getCabinetMyDayState(),
        selectedDuePreset: 'today',
        selectedDueDate: cabinetDateKeyOffset(0)
    });
}

function cabinetMyDayOverdueTasks() {
    return cabinetFocusedOverdueTasks([]);
}

function cabinetMyDaySegmentTasks(segment = getCabinetMyDaySegment()) {
    switch (normalizeCabinetMyDaySegment(segment)) {
        case 'overdue':
            return cabinetMyDayOverdueTasks();
        case 'waiting':
            return cabinetList('waiting');
        case 'completed':
            return cabinetCompletedHistoryList();
        case 'private':
            return cabinetList('private');
        case 'today':
        default:
            return cabinetMyDayTodayTasks();
    }
}

function cabinetMyDaySegmentCounts() {
    const completedCounts = cabinetCompletedHistoryCounts();
    return {
        today: cabinetMyDaySegmentTasks('today').length,
        overdue: cabinetMyDaySegmentTasks('overdue').length,
        waiting: cabinetMyDaySegmentTasks('waiting').length,
        completed: completedCounts.total,
        private: cabinetMyDaySegmentTasks('private').length
    };
}

function setCabinetMyDaySegment(segment = 'today', options = {}) {
    cabinetMyDaySegment = normalizeCabinetMyDaySegment(segment);
    document.querySelectorAll?.('[data-cabinet-my-day-segment]').forEach(button => {
        const active = button.dataset.cabinetMyDaySegment === cabinetMyDaySegment;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (options.rerender === true && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        renderCabinetActiveTab();
    }
    return cabinetMyDaySegment;
}

function renderCabinetMyDaySegments() {
    const activeSegment = getCabinetMyDaySegment();
    const counts = cabinetMyDaySegmentCounts();
    const buttons = CABINET_MY_DAY_SEGMENTS.map(segment => {
        const active = activeSegment === segment.id;
        const count = counts[segment.id] ?? 0;
        const classes = [
            'cabinet-my-day-segment',
            active ? 'active' : '',
            segment.tone ? `is-${segment.tone}` : ''
        ].filter(Boolean).join(' ');
        return `<button type="button"
            class="${classes}"
            role="tab"
            data-cabinet-my-day-segment="${escapeHtml(segment.id)}"
            aria-selected="${active ? 'true' : 'false'}"
            aria-pressed="${active ? 'true' : 'false'}"
            aria-controls="cabinetMyDaySegmentPanel">
                <span>${escapeHtml(segment.label)}</span>
                <b>${formatCabinetPulseCount(count)}</b>
            </button>`;
    }).join('');
    return `
        <div class="cabinet-my-day-segments" role="tablist" aria-label="Зріз задач Мого дня">
            ${buttons}
        </div>`;
}

function renderCabinetMyDayListModeToggle() {
    const activeViewMode = getCabinetMyDayViewMode();
    const viewButtons = CABINET_MY_DAY_VIEW_MODE_OPTIONS.map(({ value, label }) => `
        <button type="button" class="cabinet-list-mode-chip ${activeViewMode === value ? 'active' : ''}" data-cabinet-my-day-view-mode="${value}" aria-pressed="${activeViewMode === value ? 'true' : 'false'}" aria-label="Вигляд карток: ${escapeHtml(label)}">${escapeHtml(label)}</button>
    `).join('');
    return `
        <div class="cabinet-day-list-toolbar">
            <span class="cabinet-view-mode-label">Вигляд карток</span>
            <div class="cabinet-view-mode-toggle" role="group" aria-label="Вигляд карток: Компактний або Повний">${viewButtons}</div>
        </div>`;
}

function normalizeCabinetAllGroupId(groupId = '') {
    const normalized = String(groupId || '').trim();
    return CABINET_MY_DAY_ALL_GROUP_IDS.includes(normalized) ? normalized : '';
}

function isCabinetAllGroupCollapsed(groupId = '') {
    const normalized = normalizeCabinetAllGroupId(groupId);
    return Boolean(normalized && collapsedCabinetAllGroupIds.has(normalized));
}

function setCabinetAllGroupCollapsed(groupId = '', collapsed = true, options = {}) {
    const normalized = normalizeCabinetAllGroupId(groupId);
    if (!normalized) return false;
    if (collapsed) collapsedCabinetAllGroupIds.add(normalized);
    else collapsedCabinetAllGroupIds.delete(normalized);
    if (options.rerender === true && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        renderCabinetActiveTab();
    }
    return collapsedCabinetAllGroupIds.has(normalized);
}

function toggleCabinetAllGroup(groupId = '', options = {}) {
    const normalized = normalizeCabinetAllGroupId(groupId);
    if (!normalized) return false;
    return setCabinetAllGroupCollapsed(normalized, !isCabinetAllGroupCollapsed(normalized), options);
}

function setCabinetTaskComposerExpanded(expanded = true, options = {}) {
    cabinetTaskComposerExpanded = Boolean(expanded);
    const form = document.getElementById('cabinetTaskComposer');
    if (!form) return;
    form.classList.toggle('is-expanded', cabinetTaskComposerExpanded);
    form.classList.toggle('is-collapsed', !cabinetTaskComposerExpanded);
    form.dataset.cabinetComposerState = cabinetTaskComposerExpanded ? 'expanded' : 'collapsed';
    form.querySelectorAll('[data-cabinet-composer-advanced]').forEach(node => {
        if (cabinetTaskComposerExpanded) node.removeAttribute('hidden');
        else node.setAttribute('hidden', '');
        node.setAttribute('aria-hidden', cabinetTaskComposerExpanded ? 'false' : 'true');
    });
    form.querySelectorAll('[data-cabinet-composer-toggle]').forEach(button => {
        button.setAttribute('aria-expanded', cabinetTaskComposerExpanded ? 'true' : 'false');
        button.textContent = cabinetTaskComposerExpanded ? 'Згорнути' : 'Більше параметрів';
    });
    if (options.focusDate) document.getElementById('cabinetTaskDate')?.focus();
    else if (options.focusTitle) document.getElementById('cabinetTaskTitle')?.focus();
}
window.setCabinetTaskComposerExpanded = setCabinetTaskComposerExpanded;

function cabinetSelectedFocusDateNeedsFetch(state = getCabinetMyDayState()) {
    const preset = normalizeCabinetDuePreset(state.selectedDuePreset);
    if (!state.selectedDueDate || preset === 'no_date') return '';
    if (preset === 'custom') return state.selectedDueDate;
    return myCabinetData?.meta?.planning?.isPartial ? state.selectedDueDate : '';
}

function renderCabinetMyDaySegmentPanelFromState(state = getCabinetMyDayState()) {
    const focusedTasks = cabinetFocusedMyDayTasks(state);
    const focusedMeta = cabinetFocusedMyDayMeta(state);
    const overdue = cabinetMyDayOverdueTasks();
    const activeFocus = focusedTasks.length;
    const focusedDropOptions = state.selectedDuePreset === 'today'
        ? {
            dropTarget: 'today',
            dropHint: 'Перетягніть сюди, щоб запланувати на сьогодні',
            dropLabel: 'Сьогодні: перетягніть сюди задачу, щоб перенести її на сьогодні'
        }
        : {};
    const primaryContext = {
        isAllMode: false,
        allGroups: [],
        focusedMeta,
        focusedTasks,
        focusedDropOptions,
        overdue,
        waiting: cabinetList('waiting'),
        deferred: cabinetList('deferred'),
        privateTasks: cabinetList('private'),
        privatePreview: cabinetList('private').slice(0, 4)
    };
    return `<div class="cabinet-day-workspace cabinet-day-workspace--two-column" id="cabinetMyDaySegmentPanel" role="region" aria-label="Мій день: ${escapeHtml(focusedMeta.statLabel || focusedMeta.title || '')} і прострочені" data-active-today="${activeFocus}" data-active-overdue="${overdue.length}" data-cabinet-my-day-layout="focused-overdue" data-cabinet-focused-preset="${escapeHtml(state.selectedDuePreset)}">
                <div class="cabinet-day-workspace-toolbar">
                    ${renderCabinetMyDayListModeToggle()}
                </div>
                <div class="cabinet-day-primary cabinet-day-column cabinet-day-column--today">
                    ${renderCabinetMyDayTodayPrimary(primaryContext)}
                </div>
                <div class="cabinet-day-secondary cabinet-day-column cabinet-day-column--overdue">
                    ${renderCabinetOverdueTriageList(overdue)}
                </div>
            </div>`;
}

function rerenderCabinetMyDaySegmentPanel() {
    const panel = document.getElementById?.('cabinetMyDaySegmentPanel');
    if (!panel) return false;
    panel.outerHTML = renderCabinetMyDaySegmentPanelFromState();
    attachProfileListeners();
    return true;
}

async function refreshCabinetFocusedDatePanel(options = {}) {
    const state = getCabinetMyDayState();
    const focusDate = cabinetSelectedFocusDateNeedsFetch(state);
    if (focusDate) {
        await refreshMyCabinetTab({
            silent: true,
            keepExistingOnError: true,
            focusDate
        });
    }
    if (options.rerender !== false && activeTab === 'myday') rerenderCabinetMyDaySegmentPanel();
}

function setCabinetDuePreset(preset = 'today', options = {}) {
    cabinetCreateDuePreset = normalizeCabinetDuePreset(preset);
    const date = document.getElementById?.('cabinetTaskDate');
    if (date && cabinetCreateDuePreset !== 'custom') date.value = cabinetDueDateForPreset(cabinetCreateDuePreset);
    document.querySelectorAll?.('[data-cabinet-due-preset]').forEach(btn => {
        const active = btn.dataset.cabinetDuePreset === cabinetCreateDuePreset;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (cabinetCreateDuePreset === 'custom') setCabinetTaskComposerExpanded(true, { focusDate: true });
    if (options.refreshList === true) {
        refreshCabinetFocusedDatePanel({ rerender: options.rerender !== false })
            .catch(error => console.warn('Profile cabinet focused date refresh failed', error));
    } else if (options.rerender === true) {
        rerenderCabinetMyDaySegmentPanel();
    }
    return cabinetCreateDuePreset;
}

function syncCabinetTaskCreateMode() {
    const mode = document.getElementById('cabinetTaskMode')?.value || 'work';
    const visibility = document.getElementById('cabinetTaskVisibility');
    const category = document.getElementById('cabinetTaskCategory');
    if (visibility && window.TaskCreate?.defaultVisibilityForTaskMode) {
        visibility.value = window.TaskCreate.defaultVisibilityForTaskMode(mode, visibility.value);
    } else if (visibility) {
        visibility.value = mode === 'private' ? 'private' : (mode === 'personal' ? 'me_only' : 'team');
    }
    if (category && (mode === 'personal' || mode === 'private') && category.value === 'admin') {
        category.value = 'personal';
    }
}

function validateCabinetPlainTaskTitle(title = '') {
    const normalized = String(title || '').trim();
    if (!normalized) return 'Заповніть назву задачі';
    if (normalized.length > CABINET_TASK_PLAIN_TITLE_MAX_LENGTH) {
        return `Для звичайного створення назва має бути до ${CABINET_TASK_PLAIN_TITLE_MAX_LENGTH} символів. Скоротіть текст або натисніть «Заповнити з AI».`;
    }
    return '';
}

function cabinetTaskCreateSignature(draft = {}) {
    const subtasks = Array.isArray(draft.subtasks) ? draft.subtasks : [];
    return JSON.stringify({
        title: String(draft.title || '').trim(),
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
        sourceType: String(draft.sourceType || '').trim(),
        impactIds: Array.isArray(draft.impactIds) ? draft.impactIds.map(Number).filter(Number.isInteger).sort((a, b) => a - b) : [],
        reportRequired: draft.reportRequired === true,
        allowReschedule: draft.allowReschedule !== false,
        subtasks: subtasks.map(item => ({
            title: String(item?.title || '').trim(),
            sourceType: String(item?.sourceType || item?.source_type || '').trim()
        }))
    });
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

function setCabinetTaskCreateBusy(busy = false) {
    const form = document.getElementById('cabinetTaskComposer');
    if (form) form.dataset.cabinetCreateBusy = busy ? 'true' : 'false';
    form?.querySelectorAll?.('[data-cabinet-create-action], [data-task-ai-draft-submit-intent]')
        .forEach(button => {
            button.disabled = Boolean(busy);
            button.setAttribute('aria-busy', busy ? 'true' : 'false');
        });
}

function setCabinetTaskComposerStatus(message = '', type = '') {
    const node = document.getElementById('cabinetTaskComposerStatus') || document.querySelector('[data-task-ai-draft-status]');
    if (!node) return;
    node.textContent = message;
    node.className = `task-ai-draft-status cabinet-task-composer-status ${type || ''}`.trim();
}

function autoGrowCabinetTaskInput(input = document.getElementById('cabinetTaskTitle')) {
    if (!input || String(input.tagName || '').toLowerCase() !== 'textarea') return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(input.scrollHeight || 0, 46), 180)}px`;
}

function cabinetSubtaskRow(value = '', sourceType = 'manual') {
    return `<div class="cabinet-subtask-row" data-cabinet-subtask-row data-subtask-source="${escapeHtml(sourceType || 'manual')}">
        <input type="text" data-cabinet-subtask-title value="${escapeHtml(value)}" placeholder="Назва підзадачі" aria-label="Назва підзадачі">
        <button type="button" class="cabinet-subtask-remove" data-cabinet-subtask-remove aria-label="Видалити підзадачу">×</button>
    </div>`;
}

function addCabinetSubtask(value = '', sourceType = 'manual') {
    const list = document.getElementById('cabinetSubtaskList');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', cabinetSubtaskRow(value, sourceType));
    setCabinetDecompositionMode(sourceType === 'manual' ? 'manual' : (sourceType === 'template' ? 'template' : 'ai'), { keepStatus: true });
    list.querySelector('[data-cabinet-subtask-row]:last-child [data-cabinet-subtask-title]')?.focus();
}
window.addCabinetSubtask = addCabinetSubtask;

function readCabinetSubtasks() {
    return Array.from(document.querySelectorAll('#cabinetSubtaskList [data-cabinet-subtask-row]'))
        .map((row, index) => ({
            title: row.querySelector('[data-cabinet-subtask-title]')?.value || '',
            sort_order: index,
            source_type: row.dataset.subtaskSource || 'manual'
        }))
        .filter(item => String(item.title || '').trim());
}

function readCabinetComposerImpactIds() {
    try {
        return window.MyDayClassification?.readComposerClassification?.().impactIds || [];
    } catch {
        return [];
    }
}

function setCabinetComposerImpactIds(impactIds = []) {
    const selected = new Set((Array.isArray(impactIds) ? impactIds : []).map(Number).filter(Number.isInteger));
    document.querySelectorAll('[data-my-day-composer-impact-chip]').forEach(input => {
        input.disabled = false;
        input.checked = selected.has(Number(input.value));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function readCabinetAiDraft() {
    const kind = document.getElementById('cabinetTaskKind')?.value || 'action';
    const selectedMode = document.getElementById('cabinetTaskMode')?.value || cabinetCreateDefaultsForSegment(myTasksSegment).mode;
    const selectedDate = document.getElementById('cabinetTaskDate')?.value || '';
    const subtasks = readCabinetSubtasks();
    const structuralMode = kind === 'checklist' || subtasks.length ? 'checklist' : 'simple';
    return {
        title: document.getElementById('cabinetTaskTitle')?.value.trim() || '',
        description: document.getElementById('cabinetTaskDetails')?.value.trim() || '',
        category: document.getElementById('cabinetTaskCategory')?.value || cabinetCreateDefaultsForSegment(myTasksSegment, selectedMode).category,
        priority: readCabinetCreatePriority(),
        taskType: 'human',
        mode: structuralMode,
        structuralMode,
        taskMode: selectedMode,
        kind,
        taskKind: kind,
        visibility: document.getElementById('cabinetTaskVisibility')?.value || (selectedMode === 'private' ? 'private' : (selectedMode === 'personal' ? 'me_only' : 'team')),
        workflowState: kind === 'waiting' ? 'waiting' : 'inbox',
        duePreset: cabinetCreateDuePreset,
        scheduleDate: selectedDate,
        durationMinutes: 30,
        scheduleSlot: 'morning',
        sourceType: 'manual',
        sourceModule: 'profile_my_cabinet',
        sourceSurface: 'profile_my_cabinet',
        impactIds: readCabinetComposerImpactIds(),
        subtasks,
        scheduleConfirmed: cabinetCreateDuePreset !== 'no_date',
        reportRequired: document.getElementById('cabinetTaskReportRequired')?.checked === true,
        allowReschedule: document.getElementById('cabinetTaskAllowReschedule')?.checked !== false,
        captureIntent: { waiting: kind === 'waiting' }
    };
}

function applyCabinetAiDraftField(field, value, meta = {}) {
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
    if (field === 'mode') {
        const mode = String(value || '');
        const kind = document.getElementById('cabinetTaskKind');
        if (value === 'checklist') {
            if (kind) kind.value = 'checklist';
        } else if (mode === 'simple' || mode === 'action') {
            if (kind && kind.value === 'checklist') kind.value = 'action';
        }
        return;
    }
    if (field === 'impactIds') {
        setCabinetComposerImpactIds(value);
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
    if (field === 'subtasks') {
        replaceCabinetSubtasks(Array.isArray(value) ? value : [], { sourceType: meta.source === 'manual' ? 'manual' : 'ai' });
        setCabinetDecompositionMode(Array.isArray(value) && value.length ? 'ai' : 'none', { keepRows: true, keepStatus: true });
    }
}

function focusCabinetAiDraftField(field) {
    const map = {
        title: 'cabinetTaskTitle',
        description: 'cabinetTaskDetails',
        mode: 'cabinetTaskMode',
        subtasks: 'cabinetSubtaskList',
        scheduleDate: 'cabinetTaskDate',
        priority: 'cabinetTaskPriority'
    };
    if (field === 'impactIds') {
        document.querySelector('[data-my-day-composer-impact-chip]')?.focus();
        return;
    }
    document.getElementById(map[field])?.focus();
}

function setCabinetSubtaskDraftStatus(message = '', type = '') {
    const node = document.getElementById('cabinetSubtaskDraftStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `cabinet-subtask-status ${type || ''}`.trim();
}

function setCabinetDecompositionMode(mode = 'manual', options = {}) {
    const normalized = ['none', 'manual', 'template', 'ai', 'template_ai'].includes(mode) ? mode : 'manual';
    const select = document.getElementById('cabinetDecompositionMode');
    if (select) select.value = normalized;
    const template = document.getElementById('cabinetDecompositionTemplate');
    if (template) template.disabled = !['template', 'template_ai'].includes(normalized);
    const draftBtn = document.getElementById('cabinetSubtaskDraftBtn');
    if (draftBtn) {
        draftBtn.disabled = ['none', 'manual'].includes(normalized);
        draftBtn.textContent = normalized === 'template' ? 'Шаблон' : 'AI';
    }
    if (normalized === 'none') document.getElementById('cabinetSubtaskAcceptDraftBtn')?.setAttribute('hidden', '');
    if (normalized === 'none' && !options.keepRows) {
        const list = document.getElementById('cabinetSubtaskList');
        if (list) list.innerHTML = '';
    }
    if (!options.keepStatus) setCabinetSubtaskDraftStatus('');
}

function replaceCabinetSubtasks(items = [], options = {}) {
    const list = document.getElementById('cabinetSubtaskList');
    if (!list) return;
    list.innerHTML = '';
    items.forEach(item => {
        list.insertAdjacentHTML('beforeend', cabinetSubtaskRow(
            item.title || item.name || '',
            item.source_type || item.sourceType || options.sourceType || 'ai'
        ));
    });
}

function renderCabinetSavedTemplateOptions() {
    const select = document.getElementById('cabinetSavedDecompositionTemplate');
    if (!select) return;
    const current = select.value;
    const options = ['<option value="">Мої шаблони</option>'];
    cabinetSavedDecompositionTemplates.forEach(template => {
        const count = Array.isArray(template.items) ? template.items.length : (Array.isArray(template.subtasks) ? template.subtasks.length : 0);
        const label = `${template.name || template.title || 'Шаблон'}${count ? ` (${count})` : ''}`;
        options.push(`<option value="${escapeHtml(template.id)}">${escapeHtml(label)}</option>`);
    });
    select.innerHTML = options.join('');
    if (current && cabinetSavedDecompositionTemplates.some(template => String(template.id) === String(current))) {
        select.value = current;
    }
}

async function refreshCabinetSavedTemplates() {
    if (!window.TaskCreate?.requestSavedDecompositionTemplates) return;
    cabinetSavedDecompositionTemplates = await window.TaskCreate.requestSavedDecompositionTemplates({ limit: 50 });
    renderCabinetSavedTemplateOptions();
}

async function applySelectedCabinetSavedTemplate() {
    const templateId = document.getElementById('cabinetSavedDecompositionTemplate')?.value || '';
    if (!templateId) {
        setCabinetSubtaskDraftStatus('Оберіть збережений шаблон.', 'warning');
        return;
    }
    const result = await window.TaskCreate?.applySavedDecompositionTemplate?.(templateId);
    if (!result?.success) {
        setCabinetSubtaskDraftStatus(result?.error || 'Не вдалося застосувати шаблон.', 'error');
        return;
    }
    replaceCabinetSubtasks(result.subtasks || [], { sourceType: 'template' });
    setCabinetDecompositionMode('template', { keepRows: true, keepStatus: true });
    setCabinetSubtaskDraftStatus('Шаблон додано як чернетку. Список можна змінити перед збереженням.', 'success');
    await refreshCabinetSavedTemplates();
}

async function saveCabinetSubtasksAsTemplate() {
    const subtasks = readCabinetSubtasks();
    if (subtasks.length < 2) {
        setCabinetSubtaskDraftStatus('Для шаблону потрібно мінімум дві підзадачі.', 'warning');
        return;
    }
    const title = document.getElementById('cabinetTaskTitle')?.value.trim() || '';
    let values = null;
    if (typeof formModal === 'function') {
        values = await formModal('Зберегти шаблон підзадач', [
            {
                key: 'name',
                label: 'Назва шаблону',
                type: 'text',
                required: true,
                defaultValue: title ? `${title} · підзадачі` : 'Новий шаблон підзадач'
            },
            {
                key: 'description',
                label: 'Опис',
                type: 'textarea',
                defaultValue: ''
            }
        ], {
            okText: 'Зберегти',
            cancelText: 'Скасувати',
            type: 'info'
        });
    } else {
        const name = null;
        values = name ? { name, description: '' } : null;
    }
    if (!values?.name) return;
    const result = await window.TaskCreate?.saveDecompositionTemplate?.({
        name: values.name,
        description: values.description || '',
        category: document.getElementById('cabinetTaskCategory')?.value || 'personal',
        subtasks
    });
    if (!result?.success) {
        setCabinetSubtaskDraftStatus(result?.error || 'Не вдалося зберегти шаблон.', 'error');
        return;
    }
    await refreshCabinetSavedTemplates();
    const select = document.getElementById('cabinetSavedDecompositionTemplate');
    if (select && result.template?.id) select.value = String(result.template.id);
    setCabinetSubtaskDraftStatus('Шаблон підзадач збережено.', 'success');
}

async function updateSelectedCabinetSavedTemplate() {
    const templateId = document.getElementById('cabinetSavedDecompositionTemplate')?.value || '';
    if (!templateId) {
        setCabinetSubtaskDraftStatus('Оберіть шаблон для оновлення.', 'warning');
        return;
    }
    const subtasks = readCabinetSubtasks();
    if (subtasks.length < 2) {
        setCabinetSubtaskDraftStatus('Для шаблону потрібно мінімум дві підзадачі.', 'warning');
        return;
    }
    const current = cabinetSavedDecompositionTemplates.find(template => String(template.id) === String(templateId)) || {};
    let values = null;
    if (typeof formModal === 'function') {
        values = await formModal('Оновити шаблон підзадач', [
            {
                key: 'name',
                label: 'Назва шаблону',
                type: 'text',
                required: true,
                defaultValue: current.name || current.title || 'Шаблон підзадач'
            },
            {
                key: 'description',
                label: 'Опис',
                type: 'textarea',
                defaultValue: current.description || ''
            }
        ], {
            okText: 'Оновити',
            cancelText: 'Скасувати',
            type: 'info'
        });
    } else {
        const name = null;
        values = name ? { name, description: current.description || '' } : null;
    }
    if (!values?.name) return;
    const result = await window.TaskCreate?.updateDecompositionTemplate?.(templateId, {
        name: values.name,
        description: values.description || '',
        category: document.getElementById('cabinetTaskCategory')?.value || current.category || 'personal',
        subtasks
    });
    if (!result?.success) {
        setCabinetSubtaskDraftStatus(result?.error || 'Не вдалося оновити шаблон.', 'error');
        return;
    }
    await refreshCabinetSavedTemplates();
    const select = document.getElementById('cabinetSavedDecompositionTemplate');
    if (select) select.value = String(templateId);
    setCabinetSubtaskDraftStatus('Шаблон підзадач оновлено.', 'success');
}

async function deleteSelectedCabinetSavedTemplate() {
    const templateId = document.getElementById('cabinetSavedDecompositionTemplate')?.value || '';
    if (!templateId) {
        setCabinetSubtaskDraftStatus('Оберіть шаблон для видалення.', 'warning');
        return;
    }
    if (typeof confirmModal === 'function') {
        const confirmed = await confirmModal('Видалити цей шаблон підзадач?', { type: 'danger', okText: 'Видалити' });
        if (!confirmed) return;
    } else {
        setCabinetSubtaskDraftStatus('Видалення шаблону тимчасово недоступне без CRM confirm modal.', 'warning');
        return;
    }
    const result = await window.TaskCreate?.deleteDecompositionTemplate?.(templateId);
    if (!result?.success) {
        setCabinetSubtaskDraftStatus(result?.error || 'Не вдалося видалити шаблон.', 'error');
        return;
    }
    await refreshCabinetSavedTemplates();
    setCabinetSubtaskDraftStatus('Шаблон видалено.', 'success');
}

function renderCabinetDecompositionSuggestions() {
    const host = document.getElementById('cabinetDecompositionSuggestions');
    if (!host) return;
    if (!cabinetDecompositionSuggestions.length) {
        host.hidden = true;
        host.innerHTML = '';
        return;
    }
    host.hidden = false;
    host.innerHTML = cabinetDecompositionSuggestions.map((suggestion, index) => {
        const count = Array.isArray(suggestion.subtasks) ? suggestion.subtasks.length : 0;
        const label = suggestion.type === 'saved_template'
            ? `Шаблон: ${suggestion.title || suggestion.template?.name || ''}`
            : (suggestion.title || 'Схожа структура');
        return `<button type="button" class="cabinet-suggestion-chip" data-cabinet-suggestion-index="${index}">
            ${escapeHtml(label)} · ${count}
        </button>`;
    }).join('');
}

async function refreshCabinetDecompositionSuggestions() {
    if (!window.TaskCreate?.requestDecompositionSuggestions) return;
    const title = document.getElementById('cabinetTaskTitle')?.value.trim() || '';
    const category = document.getElementById('cabinetTaskCategory')?.value || 'personal';
    const key = [title, category].join('|');
    if (key === lastCabinetSuggestionKey) return;
    lastCabinetSuggestionKey = key;
    if (title.length < 3) {
        cabinetDecompositionSuggestions = [];
        renderCabinetDecompositionSuggestions();
        return;
    }
    const result = await window.TaskCreate.requestDecompositionSuggestions({
        title,
        category,
        taskKind: document.getElementById('cabinetTaskKind')?.value || 'action',
        taskMode: document.getElementById('cabinetTaskMode')?.value || 'personal'
    });
    cabinetDecompositionSuggestions = result?.success ? (result.suggestions || []) : [];
    renderCabinetDecompositionSuggestions();
}

function scheduleCabinetDecompositionSuggestions() {
    clearTimeout(cabinetSuggestionTimer);
    cabinetSuggestionTimer = setTimeout(refreshCabinetDecompositionSuggestions, 450);
}

function applyCabinetSuggestion(index) {
    const suggestion = cabinetDecompositionSuggestions[index];
    if (!suggestion) return;
    const sourceType = suggestion.type === 'saved_template' ? 'template' : 'system';
    replaceCabinetSubtasks(suggestion.subtasks || suggestion.template?.subtasks || [], { sourceType });
    setCabinetDecompositionMode(suggestion.type === 'saved_template' ? 'template' : 'manual', { keepRows: true, keepStatus: true });
    setCabinetSubtaskDraftStatus('Підказку додано як чернетку. Список можна змінити перед збереженням.', 'success');
}

async function generateCabinetSubtasks() {
    const input = document.getElementById('cabinetTaskTitle');
    const title = input?.value.trim() || '';
    const mode = document.getElementById('cabinetDecompositionMode')?.value || 'ai';
    if (!title) {
        setCabinetSubtaskDraftStatus('Додайте назву задачі перед генерацією підзадач.', 'warning');
        input?.focus();
        return;
    }
    if (mode === 'none' || mode === 'manual') {
        setCabinetSubtaskDraftStatus('Оберіть AI або шаблонний режим декомпозиції.', 'warning');
        return;
    }
    const button = document.getElementById('cabinetSubtaskDraftBtn');
    const acceptBtn = document.getElementById('cabinetSubtaskAcceptDraftBtn');
    const oldText = button?.textContent || '';
    if (button) {
        button.disabled = true;
        button.textContent = '...';
    }
    if (acceptBtn) acceptBtn.hidden = true;
    setCabinetSubtaskDraftStatus(mode === 'template' ? 'Готую шаблонну чернетку...' : 'AI готує чернетку. Нічого ще не збережено...', '');
    const selectedMode = document.getElementById('cabinetTaskMode')?.value || cabinetCreateDefaultsForSegment(myTasksSegment).mode;
    const result = await window.TaskCreate?.requestDecompositionDraft?.({
        title,
        category: document.getElementById('cabinetTaskCategory')?.value || 'personal',
        taskKind: document.getElementById('cabinetTaskKind')?.value || 'action',
        taskMode: selectedMode,
        mode,
        decompositionMode: mode,
        templateKey: document.getElementById('cabinetDecompositionTemplate')?.value || '',
        sourceModule: 'profile_my_cabinet',
        sourceType: 'manual'
    });
    if (button) {
        button.disabled = false;
        button.textContent = oldText || (mode === 'template' ? 'Шаблон' : 'AI');
    }
    if (!result?.success) {
        setCabinetSubtaskDraftStatus(result?.error || 'Не вдалося підготувати чернетку. Додайте підзадачі вручну.', 'error');
        return;
    }
    replaceCabinetSubtasks(result.subtasks || [], {
        sourceType: result.source === 'template' || result.source === 'template_fallback' ? 'template' : 'ai'
    });
    if (acceptBtn) acceptBtn.hidden = false;
    const sourceLabel = result.source === 'template_fallback'
        ? 'AI недоступний, використано шаблон.'
        : (result.source === 'template' ? 'Шаблонну чернетку додано.' : 'AI чернетку додано.');
    setCabinetSubtaskDraftStatus(`${sourceLabel} Перевірте список перед збереженням задачі.`, 'success');
}

function bindCabinetSubtasks() {
    document.getElementById('cabinetDecompositionMode')?.addEventListener('change', event => setCabinetDecompositionMode(event.target.value));
    document.getElementById('cabinetSubtaskDraftBtn')?.addEventListener('click', generateCabinetSubtasks);
    document.getElementById('cabinetApplySavedTemplateBtn')?.addEventListener('click', applySelectedCabinetSavedTemplate);
    document.getElementById('cabinetSaveSubtasksTemplateBtn')?.addEventListener('click', saveCabinetSubtasksAsTemplate);
    document.getElementById('cabinetUpdateSavedTemplateBtn')?.addEventListener('click', updateSelectedCabinetSavedTemplate);
    document.getElementById('cabinetDeleteSavedTemplateBtn')?.addEventListener('click', deleteSelectedCabinetSavedTemplate);
    const cabinetTaskTitle = document.getElementById('cabinetTaskTitle');
    cabinetTaskTitle?.addEventListener('input', () => {
        autoGrowCabinetTaskInput(cabinetTaskTitle);
        scheduleCabinetDecompositionSuggestions();
    });
    autoGrowCabinetTaskInput(cabinetTaskTitle);
    document.getElementById('cabinetTaskCategory')?.addEventListener('change', () => {
        refreshCabinetSavedTemplates();
        scheduleCabinetDecompositionSuggestions();
    });
    document.getElementById('cabinetDecompositionSuggestions')?.addEventListener('click', event => {
        const chip = event.target.closest('[data-cabinet-suggestion-index]');
        if (!chip) return;
        applyCabinetSuggestion(Number(chip.dataset.cabinetSuggestionIndex));
    });
    document.getElementById('cabinetSubtaskAcceptDraftBtn')?.addEventListener('click', () => {
        setCabinetSubtaskDraftStatus('Чернетку прийнято. Остаточно вона збережеться разом із задачею.', 'success');
        document.getElementById('cabinetSubtaskAcceptDraftBtn')?.setAttribute('hidden', '');
    });
    refreshCabinetSavedTemplates();
    setCabinetDecompositionMode(document.getElementById('cabinetDecompositionMode')?.value || 'none', { keepRows: true, keepStatus: true });
    const list = document.getElementById('cabinetSubtaskList');
    if (!list || list.dataset.cabinetSubtasksBound === 'true') return;
    list.dataset.cabinetSubtasksBound = 'true';
    list.addEventListener('click', (event) => {
        const remove = event.target.closest('[data-cabinet-subtask-remove]');
        if (!remove) return;
        remove.closest('[data-cabinet-subtask-row]')?.remove();
    });
}

function profileLiveCounterScope(payload = {}) {
    const safePayload = payload || {};
    const apiScope = typeof window !== 'undefined' ? window.CrmBusinessContext?.scope?.() : null;
    const scope = safePayload.scope || apiScope || {};
    const selectedContexts = Array.isArray(scope.selectedContexts) && scope.selectedContexts.length
        ? scope.selectedContexts
        : [scope.activeContext || (typeof window !== 'undefined' ? window.CrmBusinessContext?.current?.() : null) || 'event_genix'];
    return {
        mode: scope.mode || 'single',
        activeContext: scope.activeContext || selectedContexts[0] || 'event_genix',
        selectedContexts
    };
}

function profileLiveCounterBucket(payload = {}) {
    const safePayload = payload || {};
    const counters = safePayload.counters || {};
    const scope = profileLiveCounterScope(safePayload);
    if (scope.mode === 'multi' || scope.mode === 'all') return counters.total || {};
    return counters.byBusiness?.[scope.activeContext] || counters.total || {};
}

function safeCabinetPulseCount(value) {
    const count = Number(value || 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function syncCabinetPulseCounts(liveCounters) {
    const bucket = profileLiveCounterBucket(liveCounters || {});
    const leads = bucket.leads || {};
    cabinetPulseCounts = {
        alerts: safeCabinetPulseCount(bucket.alerts?.active),
        funnel: safeCabinetPulseCount(leads.hot) || safeCabinetPulseCount(leads.new)
    };
}

async function refreshCabinetPulseCounts() {
    if (cabinetLiveCounterPromise) return cabinetLiveCounterPromise;
    cabinetLiveCounterPromise = (async () => {
        try {
            const liveCounters = await apiGetScoped('/business/live-counters');
            syncCabinetPulseCounts(liveCounters);
            return liveCounters;
        } finally {
            cabinetLiveCounterPromise = null;
        }
    })();
    return cabinetLiveCounterPromise;
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

function cabinetTaskQuickCounts(data = myCabinetData) {
    const stats = data?.stats || {};
    const quick = stats.taskQuick || stats.tasksQuick || {};
    const completed = Number(quick.completedToday ?? stats.todayDone ?? quick.completed ?? stats.completedCount ?? stats.doneCount ?? 0);
    const todayFallback = Array.isArray(data?.today) ? data.today.length : cabinetList('today').length;
    const overdueFallback = Array.isArray(data?.overdue) ? data.overdue.length : cabinetList('overdue').length;
    const todayRemaining = Number(quick.todayRemaining ?? stats.todayWorkloadCount ?? stats.todayPlanned ?? todayFallback ?? 0);
    const overdueCarryover = Number(quick.overdueCarryover ?? stats.overdueCarryoverCount ?? stats.overdueCarryover ?? overdueFallback ?? 0);
    const safeToday = Number.isFinite(todayRemaining) && todayRemaining > 0 ? todayRemaining : 0;
    const safeOverdue = Number.isFinite(overdueCarryover) && overdueCarryover > 0 ? overdueCarryover : 0;
    const remaining = Number(
        quick.activeMyDay
        ?? stats.activeMyDayCount
        ?? stats.activeMyDay
        ?? (safeOverdue > 0 ? safeToday + safeOverdue : quick.remaining)
        ?? safeToday
    );
    return {
        completed: Number.isFinite(completed) && completed > 0 ? Math.floor(completed) : 0,
        remaining: Number.isFinite(remaining) && remaining > 0 ? Math.floor(remaining) : 0,
        todayRemaining: safeToday > 0 ? Math.floor(safeToday) : 0,
        overdueCarryover: safeOverdue > 0 ? Math.floor(safeOverdue) : 0,
        scope: quick.scope || 'completed_units_today_and_active_my_day_or_undated'
    };
}

function renderCabinetTaskQuickSplit(counts = cabinetTaskQuickCounts()) {
    return [
        '<span class="cabinet-quick-split" aria-hidden="true">',
        '<span class="cabinet-quick-half cabinet-quick-half--completed">',
        '<span class="cabinet-quick-mini-icon">✓</span>',
        '<span class="cabinet-quick-mini-copy">',
        '<span class="cabinet-quick-mini-count">' + formatCabinetPulseCount(counts.completed) + '</span>',
        '<span class="cabinet-quick-mini-label">виконано сьогодні</span>',
        '</span>',
        '</span>',
        '<span class="cabinet-quick-divider"></span>',
        '<span class="cabinet-quick-half cabinet-quick-half--remaining">',
        '<span class="cabinet-quick-mini-icon">!</span>',
        '<span class="cabinet-quick-mini-copy">',
        '<span class="cabinet-quick-mini-count">' + formatCabinetPulseCount(counts.remaining) + '</span>',
        '<span class="cabinet-quick-mini-label">активні</span>',
        '</span>',
        '</span>',
        '</span>'
    ].join('');
}

function cabinetAlertQuickState(count = 0) {
    const safeCount = Math.max(0, Math.floor(Number(count || 0)));
    if (safeCount >= 10) {
        return {
            helper: 'Критичні алерти потребують уваги',
            tone: 'critical'
        };
    }
    if (safeCount > 0) {
        return {
            helper: 'Є активні алерти для перевірки',
            tone: 'hot'
        };
    }
    return {
        helper: 'Критичних алертів немає',
        tone: 'zero'
    };
}

function getCabinetQuickMode() {
    const saved = localStorage.getItem('cabinetQuickMode');
    return ['tasks', 'alerts', 'funnel'].includes(saved) ? saved : 'tasks';
}

function setCabinetQuickMode(mode) {
    if (!['tasks', 'alerts', 'funnel'].includes(mode)) return;
    localStorage.setItem('cabinetQuickMode', mode);
}

function syncCabinetQuickMode(mode) {
    if (!['tasks', 'alerts', 'funnel'].includes(mode)) return;
    setCabinetQuickMode(mode);
    const root = document.querySelector('.cabinet-quick-cluster');
    if (!root) return;
    root.querySelectorAll('.cabinet-quick-segment').forEach(btn => {
        const isActive = btn.dataset.mode === mode;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function renderCabinetPulseCluster() {
    const taskQuick = cabinetTaskQuickCounts();
    const alertsCount = cabinetPulseCounts.alerts;
    const alertState = cabinetAlertQuickState(alertsCount);
    const funnelCount = cabinetPulseCounts.funnel;
    const activeMode = getCabinetQuickMode();
    const items = [
        {
            id: 'tasks',
            label: '\u0417\u0430\u0434\u0430\u0447\u0456',
            helper: 'Сьогодні виконано / активні задачі',
            count: `${formatCabinetPulseCount(taskQuick.completed)} виконано сьогодні, ${formatCabinetPulseCount(taskQuick.remaining)} активні`,
            splitHtml: renderCabinetTaskQuickSplit(taskQuick),
            tone: taskQuick.remaining > 0 ? 'live' : 'zero',
            action: "switchTab('myday')"
        },
        {
            id: 'alerts',
            label: '\u0410\u043b\u0435\u0440\u0442\u0438',
            helper: alertState.helper,
            count: formatCabinetPulseCount(alertsCount),
            tone: alertState.tone,
            action: 'openCabinetAlerts(event)'
        },
        {
            id: 'funnel',
            label: '\u0412\u043e\u0440\u043e\u043d\u043a\u0430',
            helper: 'Перейти до лідів',
            count: formatCabinetPulseCount(funnelCount),
            tone: funnelCount > 0 ? 'live' : 'zero',
            action: 'openCabinetFunnel()'
        }
    ];
    const segmentsHtml = items.map(item => {
        const isActive = item.id === activeMode;
        return [
            '<button type="button"',
            ' class="cabinet-quick-segment cabinet-quick-segment--' + item.id + ' cabinet-quick-segment--' + item.tone + (isActive ? ' is-active' : '') + '"',
            ' data-mode="' + item.id + '"',
            ' role="tab"',
            ' aria-selected="' + (isActive ? 'true' : 'false') + '"',
            ' aria-label="' + escapeHtml(item.helper) + '. Поточне значення: ' + item.count + '"',
            ' title="' + escapeHtml(item.helper) + ': ' + item.count + '"',
            ' onclick="syncCabinetQuickMode(\'' + item.id + '\'); ' + item.action + '">',
            '<span class="cabinet-quick-plate"></span>',
            '<span class="cabinet-quick-body">',
            '<span class="cabinet-quick-label">' + escapeHtml(item.label) + '</span>',
            '<span class="cabinet-quick-hint">' + escapeHtml(item.helper) + '</span>',
            item.splitHtml || '<span class="cabinet-quick-count">' + item.count + '</span>',
            '</span>',
            '</button>'
        ].join('');
    }).join('');
    return '<div class="cabinet-quick-cluster" role="tablist" aria-label="\u0428\u0432\u0438\u0434\u043a\u0438\u0439 \u0432\u0438\u0431\u0456\u0440 \u0440\u043e\u0431\u043e\u0447\u043e\u0433\u043e \u0440\u0435\u0436\u0438\u043c\u0443 \u043e\u0441\u043e\u0431\u0438\u0441\u0442\u043e\u0433\u043e \u043a\u0430\u0431\u0456\u043d\u0435\u0442\u0443">' + segmentsHtml + '</div>';
}

function openCabinetAlerts(event) {
    syncCabinetQuickMode('alerts');
    if (typeof toggleAlertsPanel === 'function') {
        toggleAlertsPanel(event);
        return;
    }
    window.location.href = '/dashboard?panel=alerts';
}

function openCabinetFunnel() {
    syncCabinetQuickMode('funnel');
    window.location.href = '/sales-funnel';
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

    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDue = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const tomorrow = new Date(startToday);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (startDue < startToday) return { key: 'overdue', label: 'Прострочено', detail: formatDate(dueDate) };
    if (sameCalendarDay(startDue, startToday)) return { key: 'today', label: 'Сьогодні', detail: formatDate(dueDate) };
    if (sameCalendarDay(startDue, tomorrow)) return { key: 'tomorrow', label: 'Завтра', detail: formatDate(dueDate) };
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

function renderCabinetTaskPriorityControl(task = {}, taskIdAttr = '') {
    const selected = normalizeCabinetPriority(task.priority || 'normal');
    return `<select class="cabinet-task-priority-select cabinet-task-priority-select--${escapeHtml(selected)}" data-cabinet-task-priority-select data-task-id="${taskIdAttr}" aria-label="Пріоритет задачі" ${taskIdAttr ? '' : 'disabled'}>
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

function renderCabinetTaskMoreAction(taskIdAttr = '') {
    if (!taskIdAttr) return '';
    return `<button type="button" class="cabinet-task-more" data-cabinet-task-action="more" data-task-id="${taskIdAttr}" aria-haspopup="dialog" aria-label="Більше дій">...</button>`;
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
    const task = findCabinetTask(id) || {};
    const result = await apiPut(`/tasks/${id}`, cabinetTaskUpdatePayload(task, patch));
    if (!result?.success) throw new Error(result?.error || 'Task update failed');
    notifyTaskWidgetsChanged({ action: options.action || 'task_update', taskId: id });
    if (typeof showNotification === 'function' && options.notify !== false) {
        showNotification(options.message || 'Задачу оновлено', 'success');
    }
    await refreshMyCabinetTab();
    return result.task || result;
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
        { id: 'no_date', label: 'Без дати', detail: hasFixedSchedule ? 'недоступно для задачі зі слотом' : 'прибрати дату і дедлайн', enabled: canReschedule && !hasFixedSchedule },
        { id: 'waiting', label: 'Чекаю', detail: 'перевести в очікування', enabled: true },
        { id: 'private', label: 'Приватне', detail: 'видимість тільки для себе', enabled: cabinetTaskVisibility(task) !== 'private' }
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
    const menuHtml = `
        ${renderCabinetMoveMenuItems(task)}
        ${window.TaskUI?.renderMenuItems([
            { label: 'Відкрити у повному списку', detail: 'деталі, історія, спостерігачі', attrs: { 'data-cabinet-task-action': 'open', 'data-task-id': taskId } }
            ,
            { label: '\u0412\u043f\u043b\u0438\u0432\u0438', detail: '\u043e\u0441\u043e\u0431\u0438\u0441\u0442\u0435 \u043c\u0430\u0440\u043a\u0443\u0432\u0430\u043d\u043d\u044f \u0437\u0430\u0434\u0430\u0447\u0456', attrs: { 'data-cabinet-task-action': 'classification', 'data-task-id': taskId } },
            { label: '\u041f\u043e\u0442\u0440\u0456\u0431\u043d\u043e \u0441\u043f\u043e\u0447\u0430\u0442\u043a\u0443', detail: '\u0434\u043e\u0434\u0430\u0442\u0438 \u0430\u0431\u043e \u0441\u0442\u0432\u043e\u0440\u0438\u0442\u0438 \u0437\u0430\u0434\u0430\u0447\u0443-\u043f\u0435\u0440\u0435\u0434\u0443\u043c\u043e\u0432\u0443', attrs: { 'data-cabinet-task-action': 'dependencies', 'data-task-id': taskId } },
            ...(task.isBlocked ? [{ label: '\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0438 \u043f\u043e\u043f\u0440\u0438 \u0431\u043b\u043e\u043a\u0435\u0440', detail: '\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043d\u044f \u043d\u0435 \u0431\u043b\u043e\u043a\u0443\u0454\u0442\u044c\u0441\u044f \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u043d\u043e', attrs: { 'data-cabinet-task-action': 'complete-despite-blocker', 'data-task-id': taskId } }] : []),
        ]) || ''}`;
    const root = window.TaskUI?.openActionMenu(button, menuHtml, { title: 'Перенести в...' });
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

function cabinetTaskReportBadge(task = {}) {
    const gate = window.TaskReportGate;
    const required = gate?.taskRequiresReport ? gate.taskRequiresReport(task) : Boolean(task.reportRequired || task.requiresReport);
    if (!required) return '';
    const reportId = gate?.taskReportId ? gate.taskReportId(task) : (task.reportId || task.report_id || null);
    return reportId
        ? `<span class="cabinet-task-report-badge cabinet-task-report-badge--done">Звіт #${escapeHtml(reportId)}</span>`
        : '<span class="cabinet-task-report-badge">потрібен звіт</span>';
}

function cabinetSubtaskSummary(task = {}) {
    const total = Number(task.subtask_count || task.subtaskCount || 0);
    const done = Number(task.subtask_done_count || task.subtaskDoneCount || 0);
    const progress = window.TaskCreate?.subtaskProgress
        ? window.TaskCreate.subtaskProgress(done, total)
        : (total ? Math.round((done / total) * 100) : null);
    return { total, done, progress };
}

function cabinetTaskHasSubtasks(task = {}) {
    return cabinetSubtaskSummary(task).total > 0;
}

function cabinetTaskIsDecomposed(task = {}) {
    const rawCount = Number(task.subtask_count ?? task.subtaskCount ?? 0);
    return cabinetTaskHasSubtasks(task)
        || (Number.isFinite(rawCount) && rawCount > 0)
        || (Array.isArray(task.subtasks) && task.subtasks.length > 0)
        || Boolean(task.decompositionMode || task.decomposition_mode);
}

function cabinetTaskCompletionBlockedBySubtasks(task = {}) {
    const summary = cabinetSubtaskSummary(task);
    return summary.total > 0 && summary.done < summary.total;
}

function cabinetSubtaskCompletionTitle(task = {}) {
    const summary = cabinetSubtaskSummary(task);
    if (!summary.total) return '';
    return summary.done >= summary.total
        ? 'Усі підпункти закриті. Задачу можна виконати.'
        : `Спочатку закрийте всі підпункти: ${summary.done}/${summary.total}.`;
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

    const decompositionDiff = Number(cabinetTaskHasSubtasks(b)) - Number(cabinetTaskHasSubtasks(a));
    if (decompositionDiff) return decompositionDiff;

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

function normalizeCabinetSubtask(item = {}) {
    return {
        id: item.id || item.subtaskId || item.subtask_id || '',
        title: item.title || '',
        isDone: item.is_done === true || item.isDone === true,
        sort_order: Number.parseInt(item.sort_order ?? item.sortOrder ?? 0, 10) || 0,
        sortOrder: Number.parseInt(item.sort_order ?? item.sortOrder ?? 0, 10) || 0,
        source_type: item.source_type || item.sourceType || 'manual',
        sourceType: item.source_type || item.sourceType || 'manual'
    };
}

function cachedCabinetSubtasks(taskId, task = {}) {
    const id = Number(taskId);
    if (cabinetSubtaskCache.has(id)) return cabinetSubtaskCache.get(id);
    if (Array.isArray(task.subtasks)) return task.subtasks.map(normalizeCabinetSubtask);
    return null;
}

function cabinetTaskNumericId(task = {}) {
    return normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
}

function cabinetSubtaskRemainingLabel(remaining = 0) {
    const count = Math.max(0, Number(remaining) || 0);
    if (count === 1) return '1 пункт залишився';
    if (count >= 2 && count <= 4) return `${count} пункти залишилось`;
    return `${count} пунктів залишилось`;
}

function cabinetDefaultInlineTaskId(tasks = []) {
    const candidates = tasks
        .map(task => ({ task, id: cabinetTaskNumericId(task), summary: cabinetSubtaskSummary(task) }))
        .filter(item => item.id && cabinetTaskIsDecomposed(item.task) && item.summary.total > 0)
        .filter(item => !['done', 'cancelled', 'archived'].includes(String(item.task.status || '').toLowerCase()))
        .filter(item => !collapsedCabinetSubtaskIds.has(item.id));
    const actionable = candidates.find(item => item.summary.done < item.summary.total);
    return actionable?.id || null;
}

function cabinetResolveActiveInlineTaskId(tasks = [], options = {}) {
    if (options.allowInlineChecklist === false) return null;
    const candidates = tasks
        .map(task => ({ task, id: cabinetTaskNumericId(task), summary: cabinetSubtaskSummary(task) }))
        .filter(item => item.id && cabinetTaskIsDecomposed(item.task) && item.summary.total > 0);
    const candidateIds = new Set(candidates.map(item => item.id));
    const requested = normalizeCabinetTaskId(options.activeInlineTaskId ?? activeCabinetInlineTaskId);
    if (requested && candidateIds.has(requested) && !collapsedCabinetSubtaskIds.has(requested)) {
        activeCabinetInlineTaskId = requested;
        return requested;
    }
    const nextId = cabinetDefaultInlineTaskId(tasks);
    activeCabinetInlineTaskId = nextId;
    return nextId;
}

function setCabinetActiveInlineTask(taskId, options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) {
        activeCabinetInlineTaskId = null;
        return null;
    }
    activeCabinetInlineTaskId = id;
    collapsedCabinetSubtaskIds.delete(id);
    if (options.expanded === true) {
        expandedCabinetSubtaskIds.clear();
        expandedCabinetSubtaskIds.add(id);
    } else if (options.expanded === false) {
        expandedCabinetSubtaskIds.delete(id);
    }
    return activeCabinetInlineTaskId;
}

function isCabinetTaskInlineActive(taskId, context = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id || context.allowInlineChecklist === false) return false;
    return id === normalizeCabinetTaskId(context.activeInlineTaskId ?? activeCabinetInlineTaskId);
}

function cabinetNextActionableSubtask(task = {}, taskId = 0) {
    const subtasks = cachedCabinetSubtasks(taskId, task) || [];
    if (!subtasks.length) return null;
    return subtasks.map(normalizeCabinetSubtask).find(item => !item.isDone) || null;
}

function renderCabinetActiveSubtaskSlice(task = {}, taskIdAttr = '') {
    const taskId = Number(taskIdAttr || 0);
    const summary = cabinetSubtaskSummary(task);
    if (!taskId || !summary.total) return '';
    const remaining = Math.max(0, summary.total - summary.done);
    const nextSubtask = cabinetNextActionableSubtask(task, taskId);
    const nextTitle = nextSubtask?.title || (remaining ? cabinetSubtaskRemainingLabel(remaining) : 'Усі пункти закриті');
    const nextMarkup = nextSubtask?.id
        ? `<label class="cabinet-subtask-slice-check">
                <input type="checkbox" data-cabinet-subtask-done data-task-id="${taskIdAttr}" data-subtask-id="${escapeHtml(nextSubtask.id)}">
                <span>${escapeHtml(nextTitle)}</span>
            </label>`
        : `<div class="cabinet-subtask-slice-empty">${escapeHtml(nextTitle)}</div>`;
    return `<div class="cabinet-subtask-active-slice" data-cabinet-active-subtask-slice="${taskIdAttr}" aria-label="Активний пункт чекліста">${nextMarkup}</div>`;
}

function isCabinetSubtasksExpanded(taskId, task = {}) {
    const id = Number(taskId);
    if (!id) return false;
    if (collapsedCabinetSubtaskIds.has(id)) return false;
    if (expandedCabinetSubtaskIds.has(id)) return true;
    if (activeTab === 'myday' && cabinetTaskIsDecomposed(task)) return false;
    return Array.isArray(cachedCabinetSubtasks(id, task));
}

function updateCabinetTaskSubtaskSummary(taskId, subtasks = []) {
    const id = Number(taskId);
    const total = subtasks.length;
    const done = subtasks.filter(item => normalizeCabinetSubtask(item).isDone).length;
    if (!myCabinetData || typeof myCabinetData !== 'object') return;
    forEachCabinetProjectionTaskList((owner, key) => {
        owner[key] = owner[key].map(task => {
            const currentId = Number(task.id || task.taskId || task.task_id || 0);
            if (currentId !== id) return task;
            return {
                ...task,
                subtask_count: total,
                subtaskCount: total,
                subtask_done_count: done,
                subtaskDoneCount: done,
                subtasks: subtasks.map(normalizeCabinetSubtask)
            };
        });
    });
}

function renderCabinetSubtaskProgress(task = {}) {
    const summary = cabinetSubtaskSummary(task);
    if (!summary.total) return '';
    return `<div class="cabinet-subtask-progress">
        <div class="cabinet-subtask-progress-bar"><div class="cabinet-subtask-progress-fill" style="width:${summary.progress}%"></div></div>
        <span>${summary.done}/${summary.total} · ${summary.progress}%</span>
    </div>`;
}

function renderCabinetSubtaskToggle(task = {}, taskIdAttr = '', expanded = null) {
    const summary = cabinetSubtaskSummary(task);
    if (!summary.total || !taskIdAttr) return '';
    const isExpanded = expanded === null ? isCabinetSubtasksExpanded(Number(taskIdAttr), task) : Boolean(expanded);
    const label = isExpanded ? 'Згорнути' : 'Пункти';
    return `<button type="button" class="cabinet-subtask-toggle" data-cabinet-task-action="subtasks-toggle" data-task-id="${taskIdAttr}" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="cabinetSubtasksPanel${taskIdAttr}" title="${escapeHtml(cabinetSubtaskCompletionTitle(task))}">
        <span>${label}</span>
        <b>${summary.done}/${summary.total}</b>
    </button>`;
}

function renderCabinetMyDaySubtaskSummary(task = {}, taskIdAttr = '', expanded = null, options = {}) {
    const summary = cabinetSubtaskSummary(task);
    const taskId = Number(taskIdAttr || 0);
    if (!summary.total || !taskId) return '';
    const isExpanded = expanded === null ? isCabinetSubtasksExpanded(taskId, task) : Boolean(expanded);
    const remaining = Math.max(0, summary.total - summary.done);
    const state = remaining > 0 ? cabinetSubtaskRemainingLabel(remaining) : 'Готово';
    const shouldShowActiveSlice = Boolean(options.inlineActive && !isExpanded);
    return `<div class="cabinet-subtask-summary ${isExpanded ? 'is-expanded' : 'is-collapsed'} ${shouldShowActiveSlice ? 'has-active-slice' : ''}" data-cabinet-subtask-summary="${taskIdAttr}">
        <button type="button" class="cabinet-subtask-toggle" data-cabinet-task-action="subtasks-toggle" data-task-id="${taskIdAttr}" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="cabinetSubtasksPanel${taskIdAttr}" title="${escapeHtml(cabinetSubtaskCompletionTitle(task))}">
            <span class="cabinet-subtask-toggle-main"><span>Чекліст</span><b>${summary.done}/${summary.total}</b></span>
            <small>${escapeHtml(state)}</small>
        </button>
        ${renderCabinetSubtaskProgress(task)}
        ${shouldShowActiveSlice ? renderCabinetActiveSubtaskSlice(task, taskIdAttr) : ''}
    </div>`;
}

function renderCabinetSubtaskCollapsedSummary(task = {}) {
    const summary = cabinetSubtaskSummary(task);
    if (!summary.total) return '';
    const remaining = Math.max(0, summary.total - summary.done);
    const state = remaining > 0 ? cabinetSubtaskRemainingLabel(remaining) : 'Готово';
    return `<div class="cabinet-subtask-compact-summary" aria-label="Короткий стан чекліста">
        <span>Чекліст ${summary.done}/${summary.total}</span>
        <b>${escapeHtml(state)}</b>
    </div>`;
}

function renderCabinetSubtasksPanel(task = {}, taskIdAttr = '', expanded = null, options = {}) {
    const summary = cabinetSubtaskSummary(task);
    const taskId = Number(taskIdAttr || 0);
    if (!summary.total || !taskId) return '';
    const isExpanded = expanded === null ? isCabinetSubtasksExpanded(taskId, task) : Boolean(expanded);
    const showHead = options.showHead !== false;
    const subtasks = cachedCabinetSubtasks(taskId, task);
    let body = '<div class="cabinet-subtask-inline-empty">Розгорніть, щоб закривати підпункти прямо тут.</div>';
    if (isExpanded && loadingCabinetSubtaskIds.has(taskId)) {
        body = '<div class="cabinet-subtask-inline-empty">Завантажую підпункти...</div>';
    } else if (isExpanded && Array.isArray(subtasks)) {
        body = subtasks.length
            ? subtasks.map(item => {
                const subtask = normalizeCabinetSubtask(item);
                return `<div class="cabinet-subtask-inline-item ${subtask.isDone ? 'is-done' : ''}" data-cabinet-inline-subtask data-task-id="${taskIdAttr}" data-subtask-id="${escapeHtml(subtask.id)}">
                    <button type="button" class="cabinet-subtask-drag-handle" data-cabinet-subtask-drag-handle draggable="true" aria-label="Перетягнути підзадачу" title="Перетягніть, щоб змінити порядок">⋮⋮</button>
                    <label class="cabinet-subtask-inline-check">
                    <input type="checkbox" data-cabinet-subtask-done data-task-id="${taskIdAttr}" data-subtask-id="${escapeHtml(subtask.id)}" ${subtask.isDone ? 'checked' : ''}>
                    <span>${escapeHtml(subtask.title || 'Підпункт без назви')}</span>
                    </label>
                </div>`;
            }).join('')
            : '<div class="cabinet-subtask-inline-empty">Підпункти не знайдені.</div>';
    }
    return `<div id="cabinetSubtasksPanel${taskIdAttr}" class="cabinet-subtask-inline-panel" data-cabinet-subtasks-panel="${taskIdAttr}" ${isExpanded ? '' : 'hidden'}>
        ${showHead ? `<div class="cabinet-subtask-inline-head">
            <span>Підпункти можна виконувати у будь-якому порядку</span>
            <b>${summary.done}/${summary.total}</b>
        </div>` : ''}
        <div class="cabinet-subtask-inline-list">${body}</div>
    </div>`;
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
    const base = 'Перенесено ' + count + ' ' + cabinetTaskPostponementWord(count);
    if (count >= 3) return base + ' · Потребує рішення';
    if (count === 2) return base + ' · Пріоритет підвищено';
    return base;
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
        canSplit: source.canSplit === true,
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
        permissions.canSplit && ['split', 'Розбити на кроки', 'Додати підзадачі через наявний checklist flow'],
        permissions.canReassign && ['reassign', 'Змінити виконавця', 'Передати задачу іншому доступному виконавцю'],
        permissions.canReschedule && ['reschedule', 'Перепланувати', 'Обрати нову дату через канонічний reschedule flow'],
        permissions.canArchive && ['archive', 'Скасувати задачу', 'Перемістити в архів із можливістю відновлення']
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
        + '<p class="cabinet-postponement-recommendation">Задачу переносять уже втретє. Можливо, її потрібно уточнити, розбити або передати іншому виконавцю.</p>'
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
    const title = label + '. Відкрити пояснення перенесень.';
    const taskId = normalizeCabinetTaskId(task.id || task.taskId || task.task_id);
    return '<button type="button" class="cabinet-postponement-badge cabinet-postponement-badge--level-' + level
        + '" data-cabinet-task-action="postponement-explanation" data-task-id="' + escapeHtml(taskId || '')
        + '" aria-haspopup="dialog" aria-expanded="false" aria-controls="taskUiActionSurface" title="' + escapeHtml(title)
        + '" aria-label="' + escapeHtml(title) + '" ' + (taskId ? '' : 'disabled') + '>' + escapeHtml(label) + '</button>';
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

async function splitCabinetPostponementTask(taskId) {
    if (typeof formModal !== 'function') throw new Error('Форма підзадач тимчасово недоступна.');
    const values = await formModal('Розбити задачу на кроки', [
        {
            key: 'steps',
            label: 'Кроки — кожен з нового рядка',
            type: 'textarea',
            required: true,
            placeholder: 'Уточнити результат\nПідготувати матеріали\nВиконати та перевірити'
        }
    ], { icon: '🧩', okText: 'Додати кроки', cancelText: 'Скасувати' });
    if (!values) return { cancelled: true };
    const steps = String(values.steps || '')
        .split(/\r?\n/)
        .map(value => value.replace(/^[-*•\d.)\s]+/, '').trim())
        .filter(Boolean)
        .slice(0, 20);
    if (steps.length < 2) throw new Error('Додайте щонайменше два окремі кроки.');
    const created = [];
    for (const title of steps) {
        const result = await apiPost(`/tasks/${taskId}/subtasks`, {
            title,
            sourceType: 'manual'
        });
        if (!result?.success || !result.subtask) {
            const error = new Error(result?.error || `Не вдалося додати крок «${title}».`);
            error.partialSubtasks = created;
            throw error;
        }
        created.push(normalizeCabinetSubtask(result.subtask));
    }
    return { success: true, created };
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
                    label: `${owner.label || owner.name || owner.username || ('User #' + owner.id)}${owner.role ? ' (' + owner.role + ')' : ''}`
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
    const confirmed = await confirmModal('Скасувати задачу? Вона буде переміщена в архів, і її можна буде відновити.', {
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
    if (action === 'split') return splitCabinetPostponementTask(taskId);
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
    const permissionKey = { split: 'canSplit', reassign: 'canReassign', reschedule: 'canReschedule', archive: 'canArchive' }[action];
    const root = button?.closest?.('#taskUiActionSurface') || document.getElementById?.('taskUiActionSurface');
    if (!taskId || !permissionKey || permissions[permissionKey] !== true) {
        setCabinetPostponementActionState(root, button, { message: 'Ця дія недоступна для вашої ролі.', tone: 'error' });
        return;
    }
    if (button.dataset.pending === 'true') return;
    button.dataset.pending = 'true';
    const pendingLabel = { split: 'Додаю кроки...', reassign: 'Змінюю виконавця...', reschedule: 'Переплановую...', archive: 'Переміщую в архів...' }[action];
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
            split: 'Кроки додано до задачі',
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
        if (Array.isArray(error?.partialSubtasks) && error.partialSubtasks.length) {
            const existing = cabinetSubtaskCache.get(taskId) || cachedCabinetSubtasks(taskId, task) || [];
            const updated = [...existing.map(normalizeCabinetSubtask), ...error.partialSubtasks];
            cabinetSubtaskCache.set(taskId, updated);
            updateCabinetTaskSubtaskSummary(taskId, updated);
        }
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
        cabinetTaskVisibleBadge('postponement', renderCabinetPostponementBadge(task)),
        cabinetTaskVisibleBadge('report', cabinetTaskReportBadge(task))
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

function renderCabinetMyDayClassificationZone(task = {}, taskId = 0, taskIdAttr = '') {
    const badges = `<span data-my-day-classification-badges="${taskIdAttr}">${window.MyDayClassification?.renderTaskBadges?.(task.myDay, { taskId }) || ''}</span>`;
    const blocker = window.MyDayDependencies?.renderTaskBlocker?.(task) || '';
    return [badges, blocker].filter(Boolean).join('');
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
    const text = expanded ? '−' : '+';
    return `<button type="button" class="${escapeHtml(buttonClassName)} cabinet-task-action-details" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" aria-expanded="${expanded ? 'true' : 'false'}" data-cabinet-task-action="toggle-my-day-details" data-task-id="${escapeHtml(taskIdAttr)}" ${taskIdAttr ? '' : 'disabled'}>${escapeHtml(text)}</button>`;
}

function renderCabinetTaskCard(task, compact = false, options = {}) {
    const taskId = Number(task.id || task.taskId || task.task_id || 0);
    const taskIdAttr = Number.isInteger(taskId) && taskId > 0 ? String(taskId) : '';
    const due = cabinetTaskDueValue(task);
    const scheduleStatus = task.scheduleStatus || task.schedule_status || task.schedule?.status || '';
    const subSummary = cabinetSubtaskSummary(task);
    const taskStatus = task.status || 'todo';
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
    const snoozeActionLabel = 'Відкласти задачу';
    const openActionLabel = 'Відкрити задачу у повному списку';
    const doneBlocked = cabinetTaskCompletionBlockedBySubtasks(task);
    const doneTitle = doneBlocked ? cabinetSubtaskCompletionTitle(task) : doneActionLabel;
    const isDecomposed = cabinetTaskIsDecomposed(task);
    const isMyDayCard = options.surface === 'myday' || activeTab === 'myday';
    const suppressMoveTodayAction = options.suppressMoveTodayAction === true;
    const suppressOverdueRescheduleMenu = options.suppressOverdueRescheduleMenu === true;
    const inlineContext = {
        activeInlineTaskId: options.activeInlineTaskId ?? activeCabinetInlineTaskId,
        allowInlineChecklist: isMyDayCard && options.allowInlineChecklist !== false
    };
    const inlineActive = isMyDayCard && isDecomposed && isCabinetTaskInlineActive(taskId, inlineContext);
    const subtasksExpanded = isDecomposed && taskIdAttr ? isCabinetSubtasksExpanded(taskId, task) : false;
    const globalViewMode = getCabinetMyDayViewMode();
    const cardDetailsExpanded = isCabinetMyDayTaskExpanded(taskId);
    const showMyDayDetails = isMyDayCard && (globalViewMode === 'detailed' || cardDetailsExpanded);
    const myDayTimeSummaryHtml = isMyDayCard ? renderCabinetMyDayTimeSummary(task, showMyDayDetails) : '';
    const myDayFactsHtml = isMyDayCard ? [
        cabinetTaskVisibleBadge('due', renderCabinetDueBadge(task, taskIdAttr, dueState, { suppressOverdueRescheduleMenu })),
        cabinetTaskVisibleBadge('priority', renderCabinetTaskPriorityControl(task, taskIdAttr)),
        cabinetTaskVisibleBadge('postponement', renderCabinetPostponementBadge(task)),
        suppressMoveTodayAction ? null : cabinetTaskVisibleBadge('move-today', renderCabinetMoveTodayAction(task, taskIdAttr, dueState)),
        scheduleStatus === 'proposal' ? cabinetTaskVisibleBadge('schedule', '<span>потрібне підтвердження часу</span>') : null,
        scheduleStatus === 'missed' ? cabinetTaskVisibleBadge('schedule', '<span>слот пропущено</span>') : null
    ].filter(Boolean).join('') : '';
    const myDayDetailsHtml = isMyDayCard && showMyDayDetails ? [
        relationLabel ? cabinetTaskVisibleBadge('relation', `<span class="cabinet-task-relation-badge">${escapeHtml(relationLabel)}</span>`) : null,
        cabinetTaskVisibleBadge('mode', `<span>${escapeHtml(taskModeLabel(task))}</span>`),
        cabinetTaskVisibleBadge('kind', `<span>${escapeHtml(taskKindLabel(task))}</span>`),
        cabinetTaskVisibleBadge('report', cabinetTaskReportBadge(task)),
        myDayTimeSummaryHtml
    ].filter(Boolean).join('') : '';
    const myDayClassificationHtml = isMyDayCard ? renderCabinetMyDayClassificationZone(task, taskId, taskIdAttr) : '';
    const metadataHtml = !isMyDayCard ? `
                    ${renderCabinetDueBadge(task, taskIdAttr, dueState)}
                    ${renderCabinetMoveTodayAction(task, taskIdAttr, dueState)}
                    ${renderCabinetTaskPriorityControl(task, taskIdAttr)}
                    ${relationLabel ? `<span class="cabinet-task-relation-badge">${escapeHtml(relationLabel)}</span>` : ''}
                    <span>${taskModeLabel(task)}</span>
                    <span>${taskKindLabel(task)}</span>
                    ${scheduleStatus === 'proposal' ? '<span>потрібне підтвердження часу</span>' : ''}
                    ${scheduleStatus === 'missed' ? '<span>слот пропущено</span>' : ''}
                    ${subSummary.total ? `<span>${subSummary.done}/${subSummary.total}</span>` : ''}
                    ${cabinetTaskReportBadge(task)}
                ` : '';
    const cardClass = [
        'cabinet-task-card',
        'is-personal-day-card',
        isMyDayCard ? 'is-my-day-compact-card' : '',
        options.cardClassName || '',
        attentionLevel ? 'attention-level-' + attentionLevel : '',
        `priority-${priority}`,
        isDecomposed ? 'is-decomposed' : '',
        inlineActive ? 'is-inline-checklist-active' : '',
        isDecomposed && subtasksExpanded ? 'is-subtasks-expanded' : '',
        isDecomposed && !subtasksExpanded ? 'is-subtasks-collapsed' : ''
    ].filter(Boolean).join(' ');
    const myDaySubtaskSummary = isMyDayCard && isDecomposed
        ? renderCabinetMyDaySubtaskSummary(task, taskIdAttr, subtasksExpanded, { inlineActive })
        : '';
    const isAiCreated = window.TaskAiDraft?.isAiTask?.(task) === true;
    const aiCreatedMarker = isAiCreated
        ? '<span class="task-ai-created-marker" aria-label="Створено з допомогою AI">✨ AI</span>'
        : '';
    const taskTitleHtml = `<div class="cabinet-task-title" title="${escapeHtml(task.title || 'Без назви')}">${aiCreatedMarker}${escapeHtml(task.title || 'Без назви')}</div>`;
    const detailToggleHtml = isMyDayCard && globalViewMode === 'compact' ? renderCabinetMyDayDetailToggle(taskIdAttr, cardDetailsExpanded) : '';
    const taskTimerActionHtml = isMyDayCard ? renderCabinetMyDayTimeTrigger(task) : '';
    const extraCommandsHtml = options.extraCommandsHtml || '';
    const extraAttrs = options.cardAttrs || '';
    const taskActionsHtml = `<div class="cabinet-task-actions">
                <button type="button" class="cabinet-task-action-btn cabinet-task-action-done" title="${escapeHtml(doneTitle)}" aria-label="${escapeHtml(doneActionLabel)}" data-tooltip="${escapeHtml(doneActionLabel)}" data-cabinet-task-action="done" data-task-id="${taskIdAttr}" ${taskIdAttr && !doneBlocked ? '' : 'disabled'}>✓</button>
                ${taskTimerActionHtml}
                ${isMyDayCard ? `<button type="button" class="cabinet-task-action-btn cabinet-task-action-ai" title="AI: розмітити" aria-label="AI: розмітити" data-tooltip="AI: розмітити" data-cabinet-task-action="ai-classification" data-task-id="${taskIdAttr}" ${taskIdAttr ? '' : 'disabled'}>AI</button>` : ''}
                ${detailToggleHtml}
                ${renderCabinetTaskMoreAction(taskIdAttr)}
            </div>`;
    if (isMyDayCard) {
        return `
        <div class="${cardClass}${isAiCreated ? ' is-ai-created' : ''}" data-task-id="${taskIdAttr}" data-task-status="${escapeHtml(taskStatus)}" data-task-priority="${escapeHtml(priority)}" data-task-attention-level="${attentionLevel}" data-task-due-state="${escapeHtml(dueState.key)}" data-my-day-view-mode="${escapeHtml(globalViewMode)}" data-my-day-details-expanded="${showMyDayDetails ? 'true' : 'false'}" data-cabinet-task-decomposed="${isDecomposed ? 'true' : 'false'}"${isAiCreated ? ' data-ai-created="true" aria-label="Задача створена з допомогою AI"' : ''}${dragAttrs}${extraAttrs ? ` ${extraAttrs}` : ''}>
            <div class="cabinet-task-main cabinet-task-main--my-day">
                <div class="cabinet-task-zone cabinet-task-zone--header">
                    ${taskTitleHtml}
                    ${taskActionsHtml}
                </div>
                ${myDayFactsHtml ? `<div class="cabinet-task-zone cabinet-task-zone--facts">${myDayFactsHtml}</div>` : ''}
                ${myDayClassificationHtml ? `<div class="cabinet-task-zone cabinet-task-zone--classification">${myDayClassificationHtml}</div>` : ''}
                ${myDayDetailsHtml ? `<div class="cabinet-task-zone cabinet-task-zone--details">${myDayDetailsHtml}</div>` : ''}
                ${extraCommandsHtml ? `<div class="cabinet-task-zone cabinet-task-zone--commands">${extraCommandsHtml}</div>` : ''}
                ${showMyDayDetails ? myDaySubtaskSummary : ''}
                ${renderCabinetSubtasksPanel(task, taskIdAttr, subtasksExpanded, { showHead: false })}
            </div>
        </div>`;
    }
    return `
        <div class="${cardClass}${isAiCreated ? ' is-ai-created' : ''}" data-task-id="${taskIdAttr}" data-task-status="${escapeHtml(taskStatus)}" data-task-priority="${escapeHtml(priority)}" data-task-attention-level="${attentionLevel}" data-task-due-state="${escapeHtml(dueState.key)}" data-cabinet-task-decomposed="${isDecomposed ? 'true' : 'false'}"${isAiCreated ? ' data-ai-created="true" aria-label="Задача створена з допомогою AI"' : ''}${dragAttrs}>
            <div class="cabinet-task-main">
                ${taskTitleHtml}
                <div class="cabinet-task-meta">
                    ${metadataHtml}
                    ${isMyDayCard ? '' : renderCabinetSubtaskToggle(task, taskIdAttr, subtasksExpanded)}
                    ${isMyDayCard ? '' : renderCabinetSubtaskProgress(task)}
                </div>
                ${myDaySubtaskSummary}
                ${!isMyDayCard && inlineActive && !subtasksExpanded ? renderCabinetActiveSubtaskSlice(task, taskIdAttr) : ''}
                ${!isMyDayCard && isDecomposed && !subtasksExpanded && !inlineActive ? renderCabinetSubtaskCollapsedSummary(task) : ''}
                ${renderCabinetSubtasksPanel(task, taskIdAttr, subtasksExpanded, { showHead: !isMyDayCard })}
            </div>
            ${taskActionsHtml}
        </div>`;
}

function renderCabinetSection(title, list, emptyText, compact = false, options = {}) {
    const visibleList = options.keepOrder ? [...list] : sortCabinetTasksForDisplay(list);
    const dropTarget = options.dropTarget ? String(options.dropTarget) : '';
    const sectionId = normalizeCabinetAllGroupId(options.sectionId || '');
    const isCollapsible = Boolean(options.collapsible && sectionId);
    const isCollapsed = Boolean(isCollapsible && options.collapsed);
    const sectionBodyId = isCollapsible ? `cabinetAllGroupBody-${sectionId}` : '';
    const dropAttrs = dropTarget
        ? ` data-cabinet-task-drop-target="${escapeHtml(dropTarget)}" aria-label="${escapeHtml(options.dropLabel || 'Перетягніть задачу сюди')}"`
        : '';
    const groupAttrs = sectionId
        ? ` data-cabinet-all-group="${escapeHtml(sectionId)}" data-cabinet-all-group-collapsed="${isCollapsed ? 'true' : 'false'}"`
        : '';
    const sectionClass = [
        'cabinet-task-section',
        dropTarget ? 'cabinet-task-section--drop-target' : '',
        compact ? 'is-secondary-section' : '',
        isCollapsible ? 'is-collapsible' : '',
        isCollapsed ? 'is-collapsed' : '',
        options.tone ? `is-${options.tone}` : '',
        options.className || '',
        visibleList.length ? '' : 'is-compact-empty'
    ].filter(Boolean).join(' ');
    const dropHint = dropTarget
        ? `<span class="cabinet-section-drop-hint">${escapeHtml(options.dropHint || 'Можна перетягнути задачу сюди')}</span>`
        : '';
    const titleMarkup = isCollapsible
        ? `<button type="button" class="cabinet-section-toggle" data-cabinet-all-group-toggle="${escapeHtml(sectionId)}" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-controls="${escapeHtml(sectionBodyId)}">
                <span class="cabinet-section-title">${escapeHtml(title)}</span>
                <span class="cabinet-section-toggle-icon" aria-hidden="true"></span>
            </button>`
        : `<h3>${escapeHtml(title)}</h3>`;
    const cardOptions = options.cardOptions || {};
    const bodyContent = visibleList.length
        ? (isCollapsed ? '' : visibleList.map(task => renderCabinetTaskCard(task, compact, cardOptions)).join(''))
        : (isCollapsed ? '' : `<div class="cabinet-empty">${escapeHtml(emptyText)}</div>`);
    const bodyAttrs = isCollapsible
        ? ` id="${escapeHtml(sectionBodyId)}"${isCollapsed ? ' hidden' : ''}`
        : '';
    return `
        <section class="${sectionClass}"${dropAttrs}${groupAttrs}>
            <div class="cabinet-section-head">
                ${titleMarkup}
                <div class="cabinet-section-head-meta">
                    ${dropHint}
                    <span>${visibleList.length}</span>
                </div>
            </div>
            <div class="cabinet-section-body"${bodyAttrs}>${bodyContent}</div>
        </section>`;
}

function renderCabinetPriorityPresets(selected = cabinetCreatePriority) {
    const activePriority = normalizeCabinetPriority(selected);
    return CABINET_TASK_PRIORITIES.map(item => `
        <button type="button"
                class="cabinet-priority-chip cabinet-priority-chip--${escapeHtml(item.value)} ${activePriority === item.value ? 'active' : ''}"
                data-cabinet-priority-preset="${escapeHtml(item.value)}"
                aria-pressed="${activePriority === item.value ? 'true' : 'false'}"
                aria-label="Пріоритет: ${escapeHtml(item.label)}"
                title="${escapeHtml(item.hint || item.label)}">${escapeHtml(item.label)}</button>
    `).join('');
}

function readCabinetCreatePriority() {
    const selectValue = document.getElementById('cabinetTaskPriority')?.value;
    return normalizeCabinetPriority(selectValue || cabinetCreatePriority);
}

function setCabinetCreatePriority(priority = 'normal') {
    cabinetCreatePriority = normalizeCabinetPriority(priority);
    const select = document.getElementById('cabinetTaskPriority');
    if (select) select.value = cabinetCreatePriority;
    document.querySelectorAll('[data-cabinet-priority-preset]').forEach(btn => {
        const active = btn.dataset.cabinetPriorityPreset === cabinetCreatePriority;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function renderCabinetTaskComposer(options = {}) {
    const segment = options.segment || myTasksSegment || 'all';
    const defaults = cabinetCreateDefaultsForSegment(segment, options.mode || '');
    const expanded = Boolean(cabinetTaskComposerExpanded);
    const dateValue = cabinetSelectedDueDate();
    const categories = CABINET_TASK_CATEGORIES.map(([value, label]) =>
        `<option value="${value}" ${defaults.category === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');
    const activeDuePreset = normalizeCabinetDuePreset(cabinetCreateDuePreset);
    const duePresets = CABINET_DUE_PRESETS.map(({ value, label }) => `
        <button type="button" class="cabinet-due-chip ${activeDuePreset === value ? 'active' : ''}" data-cabinet-due-preset="${value}" aria-pressed="${activeDuePreset === value ? 'true' : 'false'}" aria-label="Дата задачі: ${escapeHtml(label)}">${escapeHtml(label)}</button>
    `).join('');
    const selectedPriority = normalizeCabinetPriority(cabinetCreatePriority);
    const priorityPresets = renderCabinetPriorityPresets(selectedPriority);
    const priorityOptions = CABINET_TASK_PRIORITIES.map(item =>
        `<option value="${item.value}" ${selectedPriority === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`
    ).join('');

    return `
        <form class="cabinet-capture cabinet-task-composer ${expanded ? 'is-expanded' : 'is-collapsed'}" id="cabinetTaskComposer" data-source-surface="profile_${escapeHtml(activeTab)}" data-cabinet-composer-state="${expanded ? 'expanded' : 'collapsed'}" aria-describedby="cabinetTaskComposerStatus" onsubmit="createCabinetTask(event, '${escapeHtml(options.mode || '')}')">
            <div class="cabinet-task-composer-head">
                <div>
                    <span class="cabinet-kicker">Нова задача</span>
                    <h3>Додати в мій робочий простір</h3>
                </div>
            </div>
            <div class="cabinet-task-composer-main">
                <label class="cabinet-task-title-field" for="cabinetTaskTitle">
                    <span>Що потрібно зробити?</span>
                    <textarea id="cabinetTaskTitle" rows="1" autocomplete="off" placeholder="Напишіть коротку назву або опишіть задачу детально" data-task-ai-source-field="title"></textarea>
                </label>
                <div class="cabinet-task-composer-actions">
                    <button type="submit" class="cabinet-task-create-submit" data-cabinet-create-action="plain" aria-busy="false">Створити</button>
                    <button type="button" class="cabinet-task-ai-fill task-ai-draft-trigger" id="cabinetTaskAiFillBtn" data-cabinet-create-action="ai" data-task-ai-draft-preview aria-busy="false">Заповнити з AI</button>
                    <button type="button" class="cabinet-task-composer-toggle" data-cabinet-composer-toggle aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="cabinetTaskComposerAdvanced">${expanded ? 'Згорнути' : 'Більше параметрів'}</button>
                </div>
                <div class="cabinet-task-composer-main-advanced" id="cabinetTaskComposerAdvanced" data-cabinet-composer-advanced aria-hidden="${expanded ? 'false' : 'true'}" ${expanded ? '' : 'hidden'}>
                    <label for="cabinetTaskCategory">
                        <span>Категорія</span>
                        <select id="cabinetTaskCategory">${categories}</select>
                    </label>
                    <label for="cabinetTaskMode">
                        <span>Режим</span>
                        <select id="cabinetTaskMode" onchange="syncCabinetTaskCreateMode()">
                            <option value="work" ${defaults.mode === 'work' ? 'selected' : ''}>Робоча</option>
                            <option value="personal" ${defaults.mode === 'personal' ? 'selected' : ''}>Особиста</option>
                            <option value="private" ${defaults.mode === 'private' ? 'selected' : ''}>Приватна</option>
                        </select>
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
                </div>
            </div>
            <div class="task-ai-draft-panel" data-task-ai-draft-panel>
                <textarea id="cabinetTaskDetails" data-task-ai-source-field="description" hidden aria-hidden="true"></textarea>
                <p id="cabinetTaskComposerStatus" class="task-ai-draft-status cabinet-task-composer-status" data-task-ai-draft-status role="status" aria-live="polite"></p>
                <div class="task-ai-draft-review-host" data-task-ai-draft-review hidden></div>
            </div>
            <div class="cabinet-task-composer-meta">
                <div class="cabinet-task-composer-essential">
                    <div class="cabinet-task-control-group cabinet-task-control-group--due">
                        <div class="cabinet-due-presets" role="group" aria-label="Коли виконати">${duePresets}</div>
                    </div>
                    <div class="cabinet-task-control-group cabinet-task-control-group--priority">
                        <div class="cabinet-priority-presets" role="group" aria-label="Пріоритет задачі">${priorityPresets}</div>
                    </div>
                </div>
                <div class="cabinet-task-composer-meta-advanced" data-cabinet-composer-advanced aria-hidden="${expanded ? 'false' : 'true'}" ${expanded ? '' : 'hidden'}>
                    ${window.MyDayClassification?.renderComposerFields?.() || ''}
                    <label for="cabinetTaskDate">
                        <span>Дата</span>
                        <input id="cabinetTaskDate" type="date" value="${escapeHtml(dateValue)}">
                    </label>
                    <label for="cabinetTaskPriority">
                        <span>Пріоритет</span>
                        <select id="cabinetTaskPriority">${priorityOptions}</select>
                    </label>
                    <label for="cabinetTaskVisibility">
                        <span>Видимість</span>
                        <select id="cabinetTaskVisibility">
                            <option value="team" ${defaults.visibility === 'team' ? 'selected' : ''}>Командна</option>
                            <option value="me_only" ${defaults.visibility === 'me_only' ? 'selected' : ''}>Тільки мені</option>
                            <option value="private" ${defaults.visibility === 'private' ? 'selected' : ''}>Приватна</option>
                        </select>
                    </label>
                    <label class="cabinet-task-report-toggle" for="cabinetTaskReportRequired">
                        <input id="cabinetTaskReportRequired" type="checkbox">
                        <span>Потрібен звіт перед виконанням</span>
                    </label>
                    <label class="cabinet-task-report-toggle" for="cabinetTaskAllowReschedule">
                        <input id="cabinetTaskAllowReschedule" type="checkbox" checked>
                        <span>Дозволити перенесення</span>
                    </label>
                </div>
            </div>
            <div class="cabinet-task-subtasks" data-cabinet-composer-advanced aria-hidden="${expanded ? 'false' : 'true'}" ${expanded ? '' : 'hidden'}>
                <div class="cabinet-task-subtasks-head">
                    <span>Підзадачі</span>
                </div>
                <div class="cabinet-decomposition-controls">
                    <select id="cabinetDecompositionMode" aria-label="Режим декомпозиції">
                        <option value="none">Без декомпозиції</option>
                        <option value="manual">Вручну</option>
                        <option value="template">Шаблон</option>
                    </select>
                    <select id="cabinetDecompositionTemplate" aria-label="Шаблон декомпозиції">
                        <option value="personal_home">Побут / особисте</option>
                        <option value="event_preparation">Підготовка події</option>
                        <option value="content_creation">Контент</option>
                        <option value="crm_sales_followup">CRM / продаж</option>
                    </select>
                    <button type="button" id="cabinetSubtaskAcceptDraftBtn" class="cabinet-subtask-add" hidden>Прийняти</button>
                </div>
                <div class="cabinet-template-controls">
                    <select id="cabinetSavedDecompositionTemplate" aria-label="Мій шаблон підзадач">
                        <option value="">Мої шаблони</option>
                    </select>
                    <button type="button" id="cabinetApplySavedTemplateBtn" class="cabinet-subtask-add">Застосувати</button>
                    <button type="button" id="cabinetSaveSubtasksTemplateBtn" class="cabinet-subtask-add">Зберегти</button>
                    <button type="button" id="cabinetUpdateSavedTemplateBtn" class="cabinet-subtask-add">Оновити</button>
                    <button type="button" id="cabinetDeleteSavedTemplateBtn" class="cabinet-subtask-remove">Видалити</button>
                </div>
                <div id="cabinetDecompositionSuggestions" class="cabinet-decomposition-suggestions" hidden></div>
                <div id="cabinetSubtaskDraftStatus" class="cabinet-subtask-status" aria-live="polite"></div>
                <div class="cabinet-subtask-list-toolbar">
                    <button type="button" class="cabinet-subtask-add" onclick="addCabinetSubtask()">+ Підзадача</button>
                </div>
                <div id="cabinetSubtaskList" class="cabinet-subtask-list"></div>
            </div>
        </form>`;
}

function renderLegacyMyDayTab() {
    const today = cabinetList('today');
    const deferred = cabinetList('deferred');
    const overdue = cabinetList('overdue');
    const waiting = cabinetList('waiting');
    const privateTasks = cabinetList('private').slice(0, 4);
    return `
        <div class="cabinet-shell">
            <div class="cabinet-hero">
                <div>
                    <div class="cabinet-kicker">Особистий центр керування</div>
                    <h2>Мій день</h2>
                    <p>Сьогоднішні, приватні задачі й короткий огляд без шуму повної дошки.</p>
                </div>
            </div>
            ${renderCabinetPulseCluster()}
            ${renderCabinetCompletionPulse()}
            ${renderCabinetTaskSoundControls()}
            ${renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' })}
            <div class="cabinet-grid">
                ${renderCabinetSection('Сьогодні', today, 'На сьогодні немає активних задач.', false, {
                    dropTarget: 'today',
                    dropHint: 'Киньте сюди прострочену задачу',
                    dropLabel: 'Сьогодні: перетягніть сюди прострочену задачу, щоб перенести її на сьогодні'
                })}
                ${renderCabinetSection('Відкладено', deferred, 'Відкладених задач немає.', true)}
                ${renderCabinetSection('Прострочено', overdue, 'Немає прострочених задач.', true)}
                ${renderCabinetSection('Чекаю', waiting, 'Нічого не зависло в очікуванні.', true)}
                ${renderCabinetSection('Приватне', privateTasks, 'Приватний шар порожній.', true)}
                <section class="cabinet-task-section">
                    <div class="cabinet-section-head"><h3>Вечірній огляд</h3><span>5 хв</span></div>
                    <div class="cabinet-review">
                        <p>Що завершено, що перенести, що зависло, що краще делегувати?</p>
                        <a href="/tasks?view=waiting">Відкрити очікування</a>
                        <a href="/tasks?view=today">Відкрити сьогодні</a>
                    </div>
                </section>
            </div>
        </div>`;
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
    return cabinetTaskDateKeyFromValue(cabinetTaskDueValue(task));
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

function cabinetFocusableMyDayTasks() {
    const now = new Date();
    return cabinetActiveMyDaySourceTasks()
        .filter(task => cabinetTaskIsOpenForMyDay(task))
        .filter(task => !isCabinetDeferredTask(task, now));
}

function cabinetFocusedMyDayMeta(state = getCabinetMyDayState()) {
    const preset = normalizeCabinetDuePreset(state.selectedDuePreset);
    const map = {
        today: {
            title: 'Сьогодні',
            statLabel: 'Сьогодні',
            emptyText: 'На сьогодні немає активних задач.'
        },
        tomorrow: {
            title: 'Завтра',
            statLabel: 'Завтра',
            emptyText: 'На завтра немає активних задач.'
        },
        day_after_tomorrow: {
            title: 'Післязавтра',
            statLabel: 'Післязавтра',
            emptyText: 'На післязавтра немає активних задач.'
        },
        plus_3_days: {
            title: '+3 дні',
            statLabel: '+3 дні',
            emptyText: 'На цю дату немає активних задач.'
        },
        month_end: {
            title: 'Кінець місяця',
            statLabel: 'Кінець місяця',
            emptyText: 'На кінець місяця немає активних задач.'
        },
        no_date: {
            title: 'Без дати',
            statLabel: 'Без дати',
            emptyText: 'Задач без дати немає.'
        },
        custom: {
            title: 'Обрана дата',
            statLabel: 'Обрана дата',
            emptyText: state.selectedDueDate ? 'На обрану дату немає активних задач.' : 'Оберіть дату в параметрах задачі.'
        }
    };
    return map[preset] || map.today;
}

function cabinetFocusedMyDayTasks(state = getCabinetMyDayState()) {
    const preset = normalizeCabinetDuePreset(state.selectedDuePreset);
    const tasks = cabinetFocusableMyDayTasks();
    if (preset === 'no_date') {
        return tasks.filter(task => !cabinetTaskFocusDateKey(task));
    }
    const selectedDate = state.selectedDueDate || '';
    if (!selectedDate) return [];
    return tasks.filter(task => cabinetTaskFocusDateKey(task) === selectedDate);
}

function cabinetFocusedOverdueTasks(exclude = []) {
    const excludeSet = new Set(exclude);
    const todayKey = cabinetDateKeyOffset(0);
    return cabinetFocusableMyDayTasks().filter(task => {
        if (excludeSet.has(task)) return false;
        const key = cabinetTaskFocusDateKey(task);
        return Boolean(key && key < todayKey);
    });
}

function cabinetTaskUniqueKey(task = {}, fallback = '') {
    return cabinetProjectionTaskId(task)
        || `${fallback}:${task.title || ''}:${cabinetTaskFocusDateKey(task)}:${cabinetTaskCreatedTime(task)}`;
}

function sortCabinetLaterTasksForDisplay(list = []) {
    return [...list].sort((a, b) => {
        const dueDiff = cabinetTaskFocusDateKey(a).localeCompare(cabinetTaskFocusDateKey(b));
        return dueDiff || compareCabinetTasksForDisplay(a, b);
    });
}

function cabinetAllMyDayGroups() {
    const todayKey = cabinetDateKeyOffset(0);
    const tomorrowKey = cabinetDateKeyOffset(1);
    const groups = [
        { id: 'overdue', title: 'Прострочені', emptyText: 'Немає прострочених задач.', tasks: [], tone: 'overdue-priority' },
        { id: 'today', title: 'Сьогодні', emptyText: 'На сьогодні немає активних задач.', tasks: [] },
        { id: 'tomorrow', title: 'Завтра', emptyText: 'На завтра немає активних задач.', tasks: [] },
        { id: 'later', title: 'Пізніше', emptyText: 'Пізніших задач немає.', tasks: [] },
        { id: 'no_date', title: 'Без дати', emptyText: 'Задач без дати немає.', tasks: [] }
    ];
    const byId = Object.fromEntries(groups.map(group => [group.id, group]));
    const seen = new Set();
    cabinetFocusableMyDayTasks().forEach((task, index) => {
        const uniqueKey = cabinetTaskUniqueKey(task, `all:${index}`);
        if (seen.has(uniqueKey)) return;
        seen.add(uniqueKey);
        const dueKey = cabinetTaskFocusDateKey(task);
        if (!dueKey) {
            byId.no_date.tasks.push(task);
        } else if (dueKey < todayKey) {
            byId.overdue.tasks.push(task);
        } else if (dueKey === todayKey) {
            byId.today.tasks.push(task);
        } else if (dueKey === tomorrowKey) {
            byId.tomorrow.tasks.push(task);
        } else {
            byId.later.tasks.push(task);
        }
    });
    return groups.map(group => ({
        ...group,
        tasks: group.id === 'later'
            ? sortCabinetLaterTasksForDisplay(group.tasks)
            : sortCabinetTasksForDisplay(group.tasks)
    }));
}

function cabinetAllMyDayTaskCount(groups = cabinetAllMyDayGroups()) {
    return groups.reduce((sum, group) => sum + group.tasks.length, 0);
}

function renderCabinetAllMyDayGroups(groups = cabinetAllMyDayGroups(), options = {}) {
    const visibleGroups = groups.filter(group => group.tasks.length > 0);
    const visibleTasks = visibleGroups.flatMap(group => group.tasks);
    const activeInlineTaskId = cabinetResolveActiveInlineTaskId(visibleTasks, {
        activeInlineTaskId: options.activeInlineTaskId,
        allowInlineChecklist: options.allowInlineChecklist !== false
    });
    if (!visibleGroups.length) {
        return renderCabinetSection('Всі задачі', [], 'Активних задач немає.', true, {
            className: 'cabinet-task-section--all-group',
            keepOrder: true,
            cardOptions: {
                surface: 'myday',
                allowInlineChecklist: false
            }
        });
    }
    return visibleGroups.map(group => renderCabinetSection(group.title, group.tasks, group.emptyText, true, {
        className: 'cabinet-task-section--all-group',
        collapsible: true,
        collapsed: isCabinetAllGroupCollapsed(group.id),
        keepOrder: true,
        sectionId: group.id,
        tone: group.tone || '',
        cardOptions: {
            surface: 'myday',
            activeInlineTaskId,
            allowInlineChecklist: options.allowInlineChecklist !== false
        }
    })).join('');
}

function renderMyTasksTab() {
    return renderMyDayTab();
}

function renderCabinetLoadNotice() {
    if (myCabinetLoadState === 'loading' && !myCabinetData) {
        return `<div class="cabinet-load-notice is-loading" role="status" aria-live="polite">
            <span>Завантажую Мій день…</span>
        </div>`;
    }
    if (myCabinetLoadState === 'refreshing' && myCabinetData) {
        return `<div class="cabinet-load-notice is-loading is-refreshing" role="status" aria-live="polite">
            <span>Оновлюю задачі, поточні дані залишаються на екрані.</span>
        </div>`;
    }
    if (!myCabinetLoadError) return '';
    return `
        <div class="cabinet-load-notice" role="status" aria-live="polite">
            <span>${escapeHtml(myCabinetLoadError)}</span>
            <button type="button" data-cabinet-refresh>Повторити</button>
        </div>`;
}

function renderCabinetMyDayTodayPrimary(context = {}) {
    const {
        isAllMode = false,
        allGroups = [],
        focusedMeta = cabinetFocusedMyDayMeta(),
        focusedTasks = [],
        focusedDropOptions = {}
    } = context;
    if (isAllMode) return renderCabinetAllMyDayGroups(allGroups, { allowInlineChecklist: true });
    const activeInlineTaskId = cabinetResolveActiveInlineTaskId(focusedTasks);
    return renderCabinetSection(focusedMeta.title, focusedTasks, focusedMeta.emptyText, false, {
        ...focusedDropOptions,
        cardOptions: {
            surface: 'myday',
            activeInlineTaskId,
            allowInlineChecklist: true
        }
    });
}

function cabinetVisibleTaskListForSegment(segment = getCabinetMyDaySegment(), context = {}) {
    const normalized = normalizeCabinetMyDaySegment(segment);
    if (normalized === 'today') {
        return context.isAllMode
            ? (context.allGroups || []).flatMap(group => group.tasks || [])
            : (context.focusedTasks || []);
    }
    if (normalized === 'overdue') return context.overdue || cabinetMyDayOverdueTasks();
    if (normalized === 'waiting') return context.waiting || cabinetList('waiting');
    if (normalized === 'private') return context.privateTasks || cabinetList('private');
    return [];
}

function renderCabinetOverdueTriageProgress(task = {}) {
    const summary = cabinetSubtaskSummary(task);
    if (!summary.total) return '<span class="cabinet-overdue-triage-progress">Без чекліста</span>';
    const remaining = Math.max(0, summary.total - summary.done);
    const stateLabel = remaining ? cabinetSubtaskRemainingLabel(remaining) : 'Готово';
    return `<span class="cabinet-overdue-triage-progress">Чекліст ${summary.done}/${summary.total} · ${escapeHtml(stateLabel)}</span>`;
}

function renderCabinetOverdueTriageRow(task = {}) {
    const taskId = cabinetTaskNumericId(task);
    const taskIdAttr = taskId ? String(taskId) : '';
    const due = cabinetTaskDueValue(task);
    const dueState = getCabinetTaskDueState(task, due);
    const moveState = cabinetTaskMoveToTodayState(task, dueState);
    const noDateTarget = cabinetTaskMoveTargets(task).find(target => target.id === 'no_date') || {};
    const canReschedule = cabinetTaskAllowsReschedule(task) && taskId;
    const triageActions = `<div class="cabinet-overdue-triage-actions cabinet-overdue-triage-actions--commands">
        <button type="button" class="cabinet-overdue-triage-action is-primary" data-cabinet-task-action="move-to-today" data-task-id="${taskIdAttr}" ${moveState.canMove ? '' : 'disabled'} title="${escapeHtml(moveState.canMove ? 'Перенести на сьогодні' : moveState.reason || 'Перенесення недоступне')}">На сьогодні</button>
        <button type="button" class="cabinet-overdue-triage-action" data-cabinet-task-action="reschedule-overdue" data-reschedule-option="custom" data-source-surface="profile_my_cabinet_overdue_triage" data-task-id="${taskIdAttr}" ${canReschedule ? '' : 'disabled'}>Відкласти</button>
        <button type="button" class="cabinet-overdue-triage-action" data-cabinet-task-action="move-target" data-cabinet-move-target="no_date" data-cabinet-move-method="triage" data-task-id="${taskIdAttr}" ${noDateTarget.enabled === false || !taskIdAttr ? 'disabled' : ''}>Без дати</button>
    </div>`;
    return renderCabinetTaskCard(task, false, {
        surface: 'myday',
        allowInlineChecklist: true,
        cardClassName: 'cabinet-overdue-triage-row',
        cardAttrs: 'data-cabinet-overdue-triage-row',
        suppressMoveTodayAction: true,
        suppressOverdueRescheduleMenu: true,
        extraCommandsHtml: triageActions
    });
}

function renderCabinetOverdueTriageList(tasks = []) {
    const visibleList = sortCabinetTasksForDisplay(tasks);
    const count = visibleList.length;
    return `<section class="cabinet-task-section cabinet-overdue-triage ${count ? '' : 'is-compact-empty'}" data-cabinet-overdue-triage>
        <div class="cabinet-section-head">
            <h3>Прострочено · ${count}</h3>
            <div class="cabinet-section-head-meta">
                <span>${count ? 'Швидко розібрати борг дня' : 'Боргу немає'}</span>
            </div>
        </div>
        <div class="cabinet-overdue-triage-list">
            ${count
                ? visibleList.map(renderCabinetOverdueTriageRow).join('')
                : '<div class="cabinet-empty">Немає прострочених задач.</div>'}
            ${renderCabinetBucketMore('overdue', 'Показати ще прострочені')}
        </div>
    </section>`;
}

function renderCabinetMyDaySegmentPrimary(activeSegment = getCabinetMyDaySegment(), context = {}) {
    const segment = normalizeCabinetMyDaySegment(activeSegment);
    if (segment === 'today') return renderCabinetMyDayTodayPrimary(context);
    if (segment === 'overdue') {
        return renderCabinetOverdueTriageList(context.overdue || cabinetMyDayOverdueTasks());
    }
    if (segment === 'waiting') {
        const tasks = context.waiting || cabinetList('waiting');
        const activeInlineTaskId = cabinetResolveActiveInlineTaskId(tasks);
        return renderCabinetSection('Чекаю', context.waiting || cabinetList('waiting'), 'Немає задач в очікуванні', true, {
            className: 'cabinet-task-section--segment',
            cardOptions: {
                surface: 'myday',
                activeInlineTaskId,
                allowInlineChecklist: true
            }
        });
    }
    if (segment === 'completed') return '';
    if (segment === 'private') {
        const tasks = context.privateTasks || cabinetList('private');
        const activeInlineTaskId = cabinetResolveActiveInlineTaskId(tasks);
        return renderCabinetSection('Приватне', tasks, 'Приватних задач немає', true, {
            className: 'cabinet-task-section--segment',
            cardOptions: {
                surface: 'myday',
                activeInlineTaskId,
                allowInlineChecklist: true
            }
        });
    }
    return renderCabinetMyDayTodayPrimary(context);
}

function renderCabinetMyDaySecondary(activeSegment = getCabinetMyDaySegment(), context = {}) {
    const segment = normalizeCabinetMyDaySegment(activeSegment);
    const showTaskSlices = segment === 'today';
    return `
        <aside class="cabinet-day-secondary" aria-label="Додаткові зрізи дня">
            ${showTaskSlices ? `
                ${renderCabinetSection('Чекаю', context.waiting || cabinetList('waiting'), 'Немає задач в очікуванні', true)}
                ${renderCabinetSection('Відкладено', context.deferred || cabinetList('deferred'), 'Відкладених задач немає.', true)}
                ${renderCabinetSection('Приватне', context.privatePreview || cabinetList('private').slice(0, 4), 'Приватних задач немає', true)}
                <section class="cabinet-task-section is-secondary-section is-compact-empty">
                    <div class="cabinet-section-head"><h3>Вечірній огляд</h3><span>5 хв</span></div>
                    <div class="cabinet-review">
                        <p>Що завершено, що перенести, що зависло, що краще делегувати?</p>
                        <a href="/tasks?view=waiting">Відкрити очікування</a>
                        <a href="/tasks?view=today">Відкрити сьогодні</a>
                    </div>
                </section>
            ` : ''}
        </aside>`;
}

function renderMyDayCommandCenterTab() {
    if (window.MyDayHabits?.state?.surface === 'setup') {
        return `<div class="my-day-life-shell">${window.MyDayHabits?.renderSetupSurface?.() || ''}</div>`;
    }
    const myDayState = getCabinetMyDayState();
    const focusedTasks = cabinetFocusedMyDayTasks(myDayState);
    const focusedMeta = cabinetFocusedMyDayMeta(myDayState);
    const overdue = cabinetMyDayOverdueTasks();
    const deferred = cabinetList('deferred');
    const waiting = cabinetList('waiting');
    const privateTasks = cabinetList('private');
    const privatePreview = privateTasks.slice(0, 4);
    const activeFocus = focusedTasks.length;
    const focusedDropOptions = {
        dropTarget: 'today',
        dropHint: 'Перетягніть сюди, щоб запланувати на сьогодні',
        dropLabel: 'Сьогодні: перетягніть сюди задачу, щоб перенести її на сьогодні'
    };
    if (myDayState.selectedDuePreset !== 'today') {
        focusedDropOptions.dropTarget = '';
        focusedDropOptions.dropHint = '';
        focusedDropOptions.dropLabel = '';
    }
    const primaryContext = {
        isAllMode: false,
        allGroups: [],
        focusedMeta,
        focusedTasks,
        focusedDropOptions,
        overdue,
        waiting,
        deferred,
        privateTasks,
        privatePreview
    };
    if (window.MyDayHabits?.state?.mode === 'habits') {
        return `<div class="my-day-life-shell">${window.MyDayHabits?.renderModeTabs?.() || ''}${window.MyDayHabits?.renderPanel?.() || ''}</div>`;
    }
    if (window.MyDayHabits?.state?.mode === 'contribution') {
        return `<div class="my-day-life-shell">${window.MyDayHabits?.renderModeTabs?.() || ''}${window.MyDayContribution?.renderPanel?.() || ''}</div>`;
    }
    return `
        <div class="cabinet-shell cabinet-command-center" id="myDayDayPanel" role="tabpanel" aria-labelledby="myDayModeDay">
            ${window.MyDayHabits?.renderModeTabs?.() || ''}
            ${renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' })}
            ${renderCabinetLoadNotice()}
            ${renderCabinetCompletionPulse()}
            <div class="cabinet-day-workspace cabinet-day-workspace--two-column" id="cabinetMyDaySegmentPanel" role="region" aria-label="Мій день: ${escapeHtml(focusedMeta.statLabel || focusedMeta.title || '')} і прострочені" data-active-today="${activeFocus}" data-active-overdue="${overdue.length}" data-cabinet-my-day-layout="focused-overdue" data-cabinet-focused-preset="${escapeHtml(myDayState.selectedDuePreset)}">
                <div class="cabinet-day-workspace-toolbar">
                    ${renderCabinetMyDayListModeToggle()}
                </div>
                <div class="cabinet-day-primary cabinet-day-column cabinet-day-column--today">
                    ${myCabinetLoadState === 'loading' && !myCabinetData ? renderCabinetLoadingSkeleton() : renderCabinetMyDayTodayPrimary(primaryContext)}
                </div>
                <div class="cabinet-day-secondary cabinet-day-column cabinet-day-column--overdue">
                    ${myCabinetLoadState === 'loading' && !myCabinetData ? renderCabinetLoadingSkeleton() : renderCabinetOverdueTriageList(overdue)}
                </div>
            </div>
        </div>`;
}

function renderMyDayTab() {
    return renderMyDayCommandCenterTab();
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

async function loadCabinetTaskSubtasks(taskId) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) return [];
    if (cabinetSubtaskCache.has(id)) return cabinetSubtaskCache.get(id);
    loadingCabinetSubtaskIds.add(id);
    rerenderCabinetTaskTabs();
    const result = await apiGet(`/tasks/${id}/subtasks`);
    loadingCabinetSubtaskIds.delete(id);
    if (!result?.success || !Array.isArray(result.subtasks)) {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Не вдалося завантажити підпункти задачі', 'error');
        rerenderCabinetTaskTabs();
        return [];
    }
    const subtasks = result.subtasks.map(normalizeCabinetSubtask);
    cabinetSubtaskCache.set(id, subtasks);
    updateCabinetTaskSubtaskSummary(id, subtasks);
    rerenderCabinetTaskTabs();
    return subtasks;
}

async function toggleCabinetTaskSubtasks(taskId) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) return;
    const task = findCabinetTask(id) || {};
    if (activeTab === 'myday' && cabinetTaskIsDecomposed(task)) {
        if (expandedCabinetSubtaskIds.has(id)) {
            expandedCabinetSubtaskIds.delete(id);
            setCabinetActiveInlineTask(id, { expanded: false });
            rerenderCabinetTaskTabs();
            return;
        }
        setCabinetActiveInlineTask(id, { expanded: true });
        if (!cabinetSubtaskCache.has(id) && !Array.isArray(task.subtasks)) {
            await loadCabinetTaskSubtasks(id);
            return;
        }
        rerenderCabinetTaskTabs();
        return;
    }
    if (isCabinetSubtasksExpanded(id, task)) {
        expandedCabinetSubtaskIds.delete(id);
        collapsedCabinetSubtaskIds.add(id);
        rerenderCabinetTaskTabs();
        return;
    }
    collapsedCabinetSubtaskIds.delete(id);
    expandedCabinetSubtaskIds.add(id);
    if (!cabinetSubtaskCache.has(id) && !Array.isArray(task.subtasks)) {
        await loadCabinetTaskSubtasks(id);
        return;
    }
    rerenderCabinetTaskTabs();
}

async function updateCabinetSubtaskDone(input) {
    const taskId = normalizeCabinetTaskId(input?.dataset?.taskId);
    const subtaskId = normalizeCabinetTaskId(input?.dataset?.subtaskId);
    if (!taskId || !subtaskId) return;
    const nextDone = input.checked === true;
    const previousDone = !nextDone;
    input.disabled = true;
    const result = await apiPatch(`/tasks/${taskId}/subtasks/${subtaskId}`, { is_done: nextDone });
    if (!result?.success || !result.subtask) {
        input.checked = previousDone;
        input.disabled = false;
        if (typeof showNotification === 'function') showNotification(result?.error || 'Не вдалося оновити підпункт', 'error');
        return;
    }
    const task = findCabinetTask(taskId) || {};
    const cached = cabinetSubtaskCache.get(taskId) || cachedCabinetSubtasks(taskId, task) || [];
    const updated = cached.map(item => Number(item.id) === subtaskId
        ? normalizeCabinetSubtask(result.subtask)
        : normalizeCabinetSubtask(item));
    cabinetSubtaskCache.set(taskId, updated);
    updateCabinetTaskSubtaskSummary(taskId, updated);
    notifyTaskWidgetsChanged({ action: 'subtask_status', taskId, subtaskId });
    const summary = cabinetSubtaskSummary(task);
    if (summary.total && summary.done >= summary.total && typeof showNotification === 'function') {
        showNotification('Усі підпункти закриті. Тепер можна виконати задачу.', 'success');
    }
    rerenderCabinetTaskTabs();
}

function cabinetSubtaskOrderFromList(list) {
    return Array.from(list?.querySelectorAll?.('[data-cabinet-inline-subtask]') || [])
        .map(row => normalizeCabinetTaskId(row.dataset.subtaskId))
        .filter(Boolean);
}

function cabinetSubtasksFromList(list) {
    return Array.from(list?.querySelectorAll?.('[data-cabinet-inline-subtask]') || [])
        .map((row, index) => ({
            id: normalizeCabinetTaskId(row.dataset.subtaskId),
            title: row.querySelector('.cabinet-subtask-inline-check span')?.textContent || '',
            isDone: row.classList.contains('is-done') || row.querySelector('[data-cabinet-subtask-done]')?.checked === true,
            sort_order: index,
            sortOrder: index
        }))
        .filter(item => item.id);
}

function clearCabinetSubtaskDropPlacement() {
    document.querySelectorAll('.cabinet-subtask-inline-item.is-drop-before, .cabinet-subtask-inline-item.is-drop-after').forEach(row => {
        row.classList.remove('is-drop-before', 'is-drop-after');
    });
}

function clearCabinetSubtaskDropMarkers() {
    clearCabinetSubtaskDropPlacement();
    document.querySelectorAll('.cabinet-subtask-inline-item.is-dragging').forEach(row => {
        row.classList.remove('is-dragging');
    });
    document.body?.classList.remove('cabinet-subtask-dragging');
}

function orderCabinetSubtasksByIds(taskId, orderedIds = [], fallback = []) {
    const task = findCabinetTask(taskId) || {};
    const current = cabinetSubtaskCache.get(taskId) || cachedCabinetSubtasks(taskId, task) || fallback || [];
    const byId = new Map(current.map(item => [Number(normalizeCabinetSubtask(item).id), normalizeCabinetSubtask(item)]));
    const ordered = orderedIds
        .map((id, index) => {
            const subtask = byId.get(Number(id));
            if (!subtask) return null;
            return {
                ...subtask,
                sort_order: index,
                sortOrder: index
            };
        })
        .filter(Boolean);
    if (ordered.length !== orderedIds.length) return null;
    return ordered;
}

async function saveCabinetSubtaskOrder(taskId, orderedIds = [], previousSubtasks = []) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id || orderedIds.length < 2) return false;
    const optimistic = orderCabinetSubtasksByIds(id, orderedIds, previousSubtasks);
    if (!optimistic) return false;
    cabinetSubtaskCache.set(id, optimistic);
    updateCabinetTaskSubtaskSummary(id, optimistic);

    const result = await apiPost(`/tasks/${id}/subtasks/reorder`, { subtaskIds: orderedIds });
    if (!result?.success || !Array.isArray(result.subtasks)) {
        const previous = previousSubtasks.map(normalizeCabinetSubtask);
        cabinetSubtaskCache.set(id, previous);
        updateCabinetTaskSubtaskSummary(id, previous);
        rerenderCabinetTaskTabs();
        if (typeof showNotification === 'function') {
            showNotification(result?.error || 'Не вдалося зберегти порядок підзадач', 'error');
        }
        return false;
    }
    const canonical = result.subtasks.map(normalizeCabinetSubtask);
    cabinetSubtaskCache.set(id, canonical);
    updateCabinetTaskSubtaskSummary(id, canonical);
    notifyTaskWidgetsChanged({ action: 'subtask_reorder', taskId: id });
    return true;
}

function handleCabinetSubtaskDragStart(event) {
    const handle = event.target?.closest?.('[data-cabinet-subtask-drag-handle]');
    const row = handle?.closest?.('[data-cabinet-inline-subtask]');
    if (!row || !row.closest('.cabinet-shell')) return;
    const taskId = normalizeCabinetTaskId(row.dataset.taskId);
    const subtaskId = normalizeCabinetTaskId(row.dataset.subtaskId);
    if (!taskId || !subtaskId) {
        event.preventDefault();
        return;
    }
    event.stopPropagation();
    cabinetSubtaskDragState = { taskId, subtaskId };
    row.classList.add('is-dragging');
    document.body?.classList.add('cabinet-subtask-dragging');
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-eventgenix-subtask', `${taskId}:${subtaskId}`);
        event.dataTransfer.setData('text/plain', String(subtaskId));
    }
}

function handleCabinetSubtaskDragOver(event) {
    if (!cabinetSubtaskDragState) return;
    const row = event.target?.closest?.('[data-cabinet-inline-subtask]');
    if (!row || Number(row.dataset.taskId) !== cabinetSubtaskDragState.taskId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    clearCabinetSubtaskDropPlacement();
    const rect = row.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    row.classList.add(before ? 'is-drop-before' : 'is-drop-after');
}

async function persistCabinetSubtaskDrop(targetRow, insertAfter = false) {
    if (!targetRow || !cabinetSubtaskDragState) return;
    const taskId = cabinetSubtaskDragState.taskId;
    const list = targetRow.closest('.cabinet-subtask-inline-list');
    const dragged = list?.querySelector(`[data-cabinet-inline-subtask][data-subtask-id="${cabinetSubtaskDragState.subtaskId}"]`);
    if (!list || !dragged || Number(targetRow.dataset.taskId) !== taskId) return;
    const previous = (cabinetSubtaskCache.get(taskId) || cabinetSubtasksFromList(list)).map(normalizeCabinetSubtask);
    const previousOrder = cabinetSubtaskOrderFromList(list);
    if (dragged !== targetRow) {
        if (insertAfter) {
            targetRow.insertAdjacentElement('afterend', dragged);
        } else {
            list.insertBefore(dragged, targetRow);
        }
    }
    const nextOrder = cabinetSubtaskOrderFromList(list);
    if (nextOrder.join(',') === previousOrder.join(',')) return;
    list.classList.add('is-reorder-saving');
    const ok = await saveCabinetSubtaskOrder(taskId, nextOrder, previous);
    list.classList.remove('is-reorder-saving');
    if (ok && typeof showNotification === 'function') {
        showNotification('Порядок підзадач збережено', 'success');
    }
}

async function handleCabinetSubtaskDrop(event) {
    if (!cabinetSubtaskDragState) return;
    const row = event.target?.closest?.('[data-cabinet-inline-subtask]');
    if (!row || Number(row.dataset.taskId) !== cabinetSubtaskDragState.taskId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = row.getBoundingClientRect();
    const insertAfter = event.clientY >= rect.top + rect.height / 2;
    try {
        await persistCabinetSubtaskDrop(row, insertAfter);
    } catch (error) {
        console.error('Profile cabinet subtask reorder failed', error);
        if (typeof showNotification === 'function') {
            showNotification(error?.message || 'Не вдалося зберегти порядок підзадач', 'error');
        }
        rerenderCabinetTaskTabs();
    } finally {
        cabinetSubtaskDragState = null;
        clearCabinetSubtaskDropMarkers();
    }
}

function handleCabinetSubtaskDragEnd() {
    cabinetSubtaskDragState = null;
    clearCabinetSubtaskDropMarkers();
}

async function moveCabinetSubtaskByKeyboard(handle, direction) {
    const row = handle?.closest?.('[data-cabinet-inline-subtask]');
    const list = row?.closest?.('.cabinet-subtask-inline-list');
    if (!row || !list) return;
    const taskId = normalizeCabinetTaskId(row.dataset.taskId);
    const rows = Array.from(list.querySelectorAll('[data-cabinet-inline-subtask]'));
    const index = rows.indexOf(row);
    const targetIndex = index + direction;
    if (!taskId || index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;
    const previous = (cabinetSubtaskCache.get(taskId) || cabinetSubtasksFromList(list)).map(normalizeCabinetSubtask);
    if (direction < 0) {
        list.insertBefore(row, rows[targetIndex]);
    } else {
        rows[targetIndex].insertAdjacentElement('afterend', row);
    }
    const nextOrder = cabinetSubtaskOrderFromList(list);
    list.classList.add('is-reorder-saving');
    const ok = await saveCabinetSubtaskOrder(taskId, nextOrder, previous);
    list.classList.remove('is-reorder-saving');
    if (ok) {
        const nextRow = list.querySelector(`[data-cabinet-inline-subtask][data-subtask-id="${row.dataset.subtaskId}"] [data-cabinet-subtask-drag-handle]`);
        nextRow?.focus();
    }
}

function handleCabinetSubtaskHandleKeydown(event) {
    const handle = event.target?.closest?.('[data-cabinet-subtask-drag-handle]');
    if (!handle) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    moveCabinetSubtaskByKeyboard(handle, event.key === 'ArrowUp' ? -1 : 1);
}

function bindCabinetSubtaskDragDrop() {
    if (cabinetSubtaskDragDropBound) return;
    cabinetSubtaskDragDropBound = true;
    document.addEventListener('dragstart', handleCabinetSubtaskDragStart);
    document.addEventListener('dragover', handleCabinetSubtaskDragOver);
    document.addEventListener('drop', handleCabinetSubtaskDrop);
    document.addEventListener('dragend', handleCabinetSubtaskDragEnd);
    document.addEventListener('keydown', handleCabinetSubtaskHandleKeydown);
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
    if (event.target?.closest?.('[data-cabinet-inline-subtask]')) return;
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

function showCabinetTaskUndoToast(taskId, restoreStatus = 'todo') {
    const existing = document.querySelector('.cabinet-task-undo-toast');
    if (existing) existing.remove();
    if (cabinetUndoToastTimer) clearTimeout(cabinetUndoToastTimer);

    const toast = document.createElement('div');
    toast.className = 'cabinet-task-undo-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
        <span>Задачу виконано</span>
        <button type="button" data-cabinet-undo-task="${taskId}">Скасувати</button>`;
    const undoBtn = toast.querySelector('[data-cabinet-undo-task]');
    const scheduleDismiss = (delay = 6000) => {
        if (cabinetUndoToastTimer) clearTimeout(cabinetUndoToastTimer);
        cabinetUndoToastTimer = setTimeout(() => {
            toast.classList.remove('is-visible');
            setTimeout(() => toast.remove(), 240);
            cabinetUndoToastTimer = null;
        }, delay);
    };
    undoBtn?.addEventListener('click', async () => {
        if (cabinetUndoToastTimer) {
            clearTimeout(cabinetUndoToastTimer);
            cabinetUndoToastTimer = null;
        }
        undoBtn.disabled = true;
        undoBtn.setAttribute('aria-busy', 'true');
        try {
            await setCabinetTaskStatus(taskId, normalizeCabinetRestoreStatus(restoreStatus), { silent: true, allowUndo: false });
            if (typeof showNotification === 'function') showNotification('Задачу повернуто', 'success');
            toast.remove();
        } catch (error) {
            undoBtn.disabled = false;
            undoBtn.removeAttribute('aria-busy');
            scheduleDismiss(9000);
            if (typeof showNotification === 'function') showNotification(error?.message || 'Не вдалося скасувати виконання', 'error');
        }
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    scheduleDismiss();
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

function setCabinetTaskClassificationBusy(taskId, busy, options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    const pendingImpactId = Number(options.impactId);
    if (!id) return;
    document.querySelectorAll('[data-my-day-task-impact-chips]').forEach(group => {
        if (!group.querySelector?.(`[data-task-id="${id}"]`)) return;
        group.classList.toggle('is-classification-pending', Boolean(busy));
        group.setAttribute('aria-busy', busy ? 'true' : 'false');
    });
    document.querySelectorAll(`[data-cabinet-task-action="classification"][data-task-id="${id}"], [data-cabinet-task-action="remove-impact"][data-task-id="${id}"]`).forEach(chip => {
        const isPendingChip = Number(chip.dataset.myDayImpactId) === pendingImpactId;
        chip.disabled = Boolean(busy);
        chip.classList.toggle('is-pending', Boolean(busy && isPendingChip));
        chip.setAttribute('aria-busy', busy ? 'true' : 'false');
    });
}

function queueCabinetTaskClassificationMutation(taskId, runner) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id || typeof runner !== 'function') return Promise.resolve(null);
    const key = String(id);
    const previous = cabinetClassificationMutationQueue.get(key) || Promise.resolve();
    const next = previous.catch(() => null).then(() => runner()).finally(() => {
        if (cabinetClassificationMutationQueue.get(key) === next) {
            cabinetClassificationMutationQueue.delete(key);
        }
    });
    cabinetClassificationMutationQueue.set(key, next);
    return next;
}

async function removeCabinetTaskImpact(button, taskId) {
    const impactId = Number(button?.dataset?.myDayImpactId);
    if (!Number.isInteger(impactId)) {
        if (typeof showNotification === 'function') showNotification('Не вдалося визначити вплив', 'error');
        return;
    }
    return queueCabinetTaskClassificationMutation(taskId, async () => {
        const key = String(taskId);
        const task = findCabinetTask(taskId) || {};
        const currentImpacts = Array.isArray(task?.myDay?.impacts) ? task.myDay.impacts : [];
        const remainingImpactIds = currentImpacts
            .map(impact => Number(impact.id))
            .filter(id => Number.isInteger(id) && id !== impactId);
        if (remainingImpactIds.length === currentImpacts.length) return;
        cabinetClassificationMutationInFlight.add(key);
        setCabinetTaskClassificationBusy(taskId, true, { impactId });
        try {
            const result = await window.MyDayClassification?.saveTaskClassification?.(taskId, {
                impactIds: remainingImpactIds
            });
            const classification = result?.classification || { impacts: currentImpacts.filter(impact => Number(impact.id) !== impactId) };
            applyCabinetTaskMyDayClassification(taskId, classification);
            refreshCabinetTaskClassificationBadges(taskId, classification);
            notifyTaskWidgetsChanged({ action: 'task_impact_removed', taskId, impactId });
            if (typeof showNotification === 'function') showNotification('Вплив прибрано', 'success');
        } catch (error) {
            setCabinetTaskClassificationBusy(taskId, false, { impactId });
            if (typeof showNotification === 'function') showNotification(error.message || 'Не вдалося прибрати вплив', 'error');
        } finally {
            cabinetClassificationMutationInFlight.delete(key);
        }
    });
}

function waitForCabinetCompletionAnimation(card) {
    if (!card?.isConnected) return Promise.resolve();
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

    if (['timer-start', 'timer-stop', 'time-entry', 'time-entries', 'time-menu'].includes(action)) {
        try { await window.MyDayTimeTracking?.handleAction?.(action, taskId, () => refreshMyCabinetTab({ silent: false, keepExistingOnError: true }), button, findCabinetTask(taskId) || {}); }
        catch (error) { if (typeof showNotification === 'function') showNotification(error.message || 'Time update failed', 'error'); }
        return;
    }

    if (action === 'postponement-explanation') {
        openCabinetPostponementExplanation(button);
        return;
    }

    if (action === 'dependencies') {
        const anchor = stableCabinetTaskSurfaceAnchor(button, taskId, 'dependencies');
        await window.MyDayDependencies?.openManager?.(anchor, findCabinetTask(taskId) || {}, async () => {
            await refreshMyCabinetTab({ silent: false, keepExistingOnError: true });
        });
        return;
    }

    if (action === 'toggle-my-day-details') {
        toggleCabinetMyDayTaskDetails(taskId, { rerender: true });
        return;
    }

    if (action === 'dependency-open') {
        if (window.TaskDetailDrawer?.open) window.TaskDetailDrawer.open(taskId, { view: 'my', sourceSurface: 'profile_my_day_dependency' });
        else window.location.href = `/tasks?view=my&open=${encodeURIComponent(taskId)}`;
        return;
    }

    if (action === 'complete-despite-blocker') {
        await setCabinetTaskStatus(taskId, 'done', { previousStatus: 'todo', task: findCabinetTask(taskId) || {} });
        return;
    }

    if (action === 'remove-impact') {
        await removeCabinetTaskImpact(button, taskId);
        return;
    }

    if (action === 'classification') {
        const anchor = stableCabinetTaskSurfaceAnchor(button, taskId, 'more');
        await window.MyDayClassification?.openTaskEditor?.(anchor, findCabinetTask(taskId) || {}, async () => {
            await refreshMyCabinetTab({ silent: false, keepExistingOnError: true });
        });
        return;
    }
    if (action === 'ai-classification') {
        const anchor = stableCabinetTaskSurfaceAnchor(button, taskId, 'ai-classification');
        await window.MyDayClassification?.autoClassifyTask?.(anchor, findCabinetTask(taskId) || {}, {
            onApplied: async result => {
                if (result?.classification && applyCabinetTaskMyDayClassification(taskId, result.classification)) {
                    refreshCabinetTaskClassificationBadges(taskId, result.classification);
                }
                notifyTaskWidgetsChanged({ action: 'task_ai_classification', taskId });
                try {
                    await refreshMyCabinetTab({ silent: true, keepExistingOnError: true });
                } catch (error) {
                    console.warn('Profile cabinet AI classification refresh failed', error);
                }
            }
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

    if (action === 'open') {
        if (window.TaskDetailDrawer?.open) {
            window.TaskDetailDrawer.open(taskId, { view: 'my', sourceSurface: 'profile_my_day' });
        } else {
            window.location.href = `/tasks?view=my&open=${encodeURIComponent(taskId)}`;
        }
        return;
    }

    if (action === 'subtasks-toggle') {
        await toggleCabinetTaskSubtasks(taskId);
        return;
    }

    if (action === 'move-to-today') {
        button.disabled = true;
        button.classList.add('is-busy');
        const card = button.closest('.cabinet-task-card, .cabinet-overdue-triage-row');
        card?.classList.add('is-updating');
        try {
            await moveCabinetTaskToToday(taskId, 'button');
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
    if (action === 'done') {
        const task = findCabinetTask(taskId) || {};
        if (cabinetTaskCompletionBlockedBySubtasks(task)) {
            if (activeTab === 'myday') setCabinetActiveInlineTask(taskId, { expanded: true });
            else expandedCabinetSubtaskIds.add(Number(taskId));
            if (!cabinetSubtaskCache.has(Number(taskId))) await loadCabinetTaskSubtasks(taskId);
            else rerenderCabinetTaskTabs();
            if (typeof showNotification === 'function') showNotification(cabinetSubtaskCompletionTitle(task), 'warning');
            return;
        }
    }
    button.disabled = true;
    button.classList.add('is-busy');
    card?.classList.add('is-updating');
    try {
        if (action === 'done') {
            unlockCabinetTaskCompletionSound();
            await setCabinetTaskStatus(taskId, 'done', { previousStatus, task: findCabinetTask(taskId) || {}, card });
        } else if (action === 'snooze') {
            closeCabinetSnoozeMenus();
            let minutes = button.dataset.minutes || 60;
            if (minutes === 'custom') {
                const raw = typeof promptModal === 'function' ? await promptModal('На скільки хвилин відкласти задачу?', { inputType: 'number', defaultValue: '60' }) : null;
                if (raw === null) return;
                minutes = raw;
            }
            await snoozeCabinetTask(taskId, minutes);
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
    await refreshCabinetPulseCounts();
    if (!options.silent) renderCabinetActiveTab();
    return projection;
}

async function verifyCabinetCreatedTask(result = {}) {
    const taskId = createdCabinetTaskId(result);
    if (!taskId) {
        return {
            ok: false,
            reason: 'missing_id',
            message: 'Сервер не повернув ID створеної задачі. Успіх не підтверджено.'
        };
    }

    const projection = await refreshMyCabinetTab({ silent: true, force: true });
    if (cabinetTaskProjectionContainsId(projection, taskId)) {
        return { ok: true, taskId };
    }

    const canonical = await apiGet(`/tasks/${encodeURIComponent(taskId)}`);
    const canonicalId = createdCabinetTaskId({ task: canonical });
    if (canonicalId === taskId) {
        const retryProjection = await refreshMyCabinetTab({ silent: true, force: true });
        if (cabinetTaskProjectionContainsId(retryProjection, taskId)) {
            return { ok: true, taskId };
        }
        return {
            ok: false,
            taskId,
            reason: 'projection_missing',
            message: `Сервер створив задачу #${taskId}, але Мій день її не повернув. Перевірте бізнес-контекст або відкрийте повний список задач.`
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
            title: 'Задачу створено в основних задачах',
            message: draft.title ? `«${draft.title}»` : 'Задачу додано в основний список',
            details: postCreateWarningCount > 0 ? [`Додаткові кроки синхронізуються: ${postCreateWarningCount}`] : [],
            durationMs: 8000,
            fadeDurationMs: 850,
            pauseOnInteract: true,
            closeButton: true
        };
    payload.title = 'Задачу створено в основних задачах';
    if (taskId) {
        payload.actions = [{
            label: 'Відкрити',
            onClick: () => {
                window.location.href = `/tasks?view=my&open=${encodeURIComponent(taskId)}`;
            }
        }];
    }
    showNotification(payload, 'success');
}

async function setCabinetTaskStatus(taskId, status, options = {}) {
    const id = normalizeCabinetTaskId(taskId);
    if (!id) throw new Error('Invalid task id');
    let result;
    if (status === 'done') {
        const sourceSurface = 'profile_my_cabinet';
        const task = options.task || findCabinetTask(id) || {};
        result = await apiPost(`/tasks/${id}/complete`, { sourceSurface });
        if (window.TaskReportGate?.responseNeedsReport?.(result)) {
            const reportId = await window.TaskReportGate.openReportModal(task, { sourceSurface, taskId: id });
            if (!reportId) throw new Error('Звіт потрібен перед виконанням задачі');
            result = await apiPost(`/tasks/${id}/complete`, { sourceSurface, reportId });
        }
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
    if (!options.silent && status === 'done' && options.allowUndo !== false) {
        playCabinetTaskCompletionFeedback();
        await waitForCabinetCompletionAnimation(options.card);
        showCabinetTaskUndoToast(id, options.previousStatus || 'todo');
    } else if (!options.silent && typeof showNotification === 'function') {
        showNotification(status === 'done' ? 'Задачу виконано' : 'Статус задачі оновлено', 'success');
    }
    if (status === 'done') {
        if (!appliedLocal) await refreshMyCabinetTab({ silent: true });
        renderCabinetActiveTab();
        scheduleCabinetProjectionRefresh();
    } else {
        await refreshMyCabinetTab({ silent: true });
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
    if (option === 'today') {
        dateText = profileDateOffsetStr(0);
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
    if (options.refresh !== false) await refreshMyCabinetTab();
    return result;
}

async function moveCabinetTaskToToday(taskId, method = 'button') {
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
    await rescheduleCabinetTask(id, 'today', {
        sourceSurface
    });
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

async function createCabinetTask(event, mode) {
    event.preventDefault();
    if (cabinetTaskCreatePending) return;
    const input = document.getElementById('cabinetTaskTitle');
    let myDayClassification = null;
    try {
        myDayClassification = window.MyDayClassification?.readComposerClassification?.() || null;
    } catch (error) {
        if (typeof showNotification === 'function') showNotification(error.message || '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u0438 \u043c\u0430\u0440\u043a\u0443\u0432\u0430\u043d\u043d\u044f.', 'error');
        return;
    }

    const kind = document.getElementById('cabinetTaskKind')?.value || 'action';
    const selectedMode = mode || document.getElementById('cabinetTaskMode')?.value || cabinetCreateDefaultsForSegment(myTasksSegment).mode;
    const selectedDate = document.getElementById('cabinetTaskDate')?.value || '';
    const current = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    const title = String(input?.value || '').trim();
    const subtasks = readCabinetSubtasks();
    const composer = document.getElementById('cabinetTaskComposer');
    const aiCommitPayload = window.TaskAiDraft?.commitPayloadFor?.(composer);
    const titleError = !aiCommitPayload ? validateCabinetPlainTaskTitle(title) : '';
    if (titleError) {
        input?.focus();
        setCabinetTaskComposerStatus(titleError, 'error');
        if (typeof showNotification === 'function') showNotification(titleError, 'error');
        return;
    }
    const draft = {
        title,
        description: document.getElementById('cabinetTaskDetails')?.value.trim() || '',
        ownerUserId: current.id || current.user_id,
        category: document.getElementById('cabinetTaskCategory')?.value || cabinetCreateDefaultsForSegment(myTasksSegment, selectedMode).category,
        priority: readCabinetCreatePriority(),
        taskType: 'human',
        mode: selectedMode,
        taskMode: selectedMode,
        structuralMode: kind === 'checklist' || subtasks.length ? 'checklist' : 'simple',
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
        impactIds: myDayClassification?.impactIds || [],
        subtasks,
        scheduleConfirmed: cabinetCreateDuePreset !== 'no_date',
        reportRequired: document.getElementById('cabinetTaskReportRequired')?.checked === true,
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
            const details = document.getElementById('cabinetTaskDetails');
            if (details) details.value = '';
            window.TaskAiDraft?.clear?.(composer);
            if (typeof showNotification === 'function') showNotification(`Створено ${bundleTasks.length || 'кілька'} AI-задач`, 'success');
            await refreshMyCabinetTab();
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
            subtasks: draft.subtasks,
            allowReschedule: draft.allowReschedule,
            controlMeta: {
                canReschedule: draft.allowReschedule,
                allowReschedule: draft.allowReschedule
            }
        };
        if (draft.reportRequired) {
            payload.reportRequired = true;
            payload.controlMeta.reportRequired = true;
        }
        if (dueDate) {
            payload.date = dueDate;
            payload.schedule = { date: dueDate, slot: 'morning', durationMinutes: 30 };
            payload.effort_minutes = 30;
        }
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
                finalDraft: {
                    ...draft,
                    ...(aiCommitPayload.finalDraft || {}),
                    ownerUserId: draft.ownerUserId,
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
        if (!aiCommitPayload) {
            if (result?.networkError || !result) rememberCabinetTaskCreateAttempt(createSignature, 'unknown', directCreateIdempotencyKey);
            else clearCabinetTaskCreateAttempt(createSignature, directCreateIdempotencyKey);
            cabinetTaskCreatePending = false;
            setCabinetTaskCreateBusy(false);
        }
        if (!result?.duplicate && typeof showNotification === 'function') {
            showNotification(result?.error || 'Не вдалося створити задачу', 'error');
        }
        return;
    }
    const postCreateWarningCount = Array.isArray(result.postCreateWarnings) ? result.postCreateWarnings.length : 0;
    const verification = await verifyCabinetCreatedTask(result);
    if (!verification.ok) {
        if (!aiCommitPayload) {
            rememberCabinetTaskCreateAttempt(createSignature, 'unknown', directCreateIdempotencyKey);
            cabinetTaskCreatePending = false;
            setCabinetTaskCreateBusy(false);
        }
        if (typeof showNotification === 'function') {
            showNotification(verification.message || 'Створення задачі не підтверджено', 'warning');
        }
        return;
    }

    lastCabinetCreatedTaskId = verification.taskId || lastCabinetCreatedTaskId;
    if (!aiCommitPayload) clearCabinetTaskCreateAttempt(createSignature, directCreateIdempotencyKey);
    if (aiCommitPayload) {
        window.TaskAiDraft?.markCommittedTaskId?.(verification.taskId);
    }
    if (!aiCommitPayload && myDayClassification?.impactIds?.length) {
        try {
            await window.MyDayClassification?.saveTaskClassification?.(verification.taskId, myDayClassification);
        } catch (error) {
            if (typeof showNotification === 'function') showNotification(error.message || '\u0417\u0430\u0434\u0430\u0447\u0443 \u0441\u0442\u0432\u043e\u0440\u0435\u043d\u043e, \u0430\u043b\u0435 \u043c\u0430\u0440\u043a\u0443\u0432\u0430\u043d\u043d\u044f \u043d\u0435 \u0437\u0431\u0435\u0440\u0435\u0433\u043b\u043e\u0441\u044f.', 'warning');
        }
    }

    notifyTaskWidgetsChanged({ action: 'create', taskId: verification.taskId });
    if (input) input.value = '';
    const details = document.getElementById('cabinetTaskDetails');
    if (details) details.value = '';
    window.TaskAiDraft?.clear?.(composer);
    setCabinetCreatePriority('normal');
    const subtaskList = document.getElementById('cabinetSubtaskList');
    if (subtaskList) subtaskList.innerHTML = '';
    cabinetDecompositionSuggestions = [];
    lastCabinetSuggestionKey = '';
    renderCabinetDecompositionSuggestions();
    setCabinetSubtaskDraftStatus('');
    document.getElementById('cabinetSubtaskAcceptDraftBtn')?.setAttribute('hidden', '');
    setCabinetDecompositionMode('none', { keepRows: true, keepStatus: true });
    cabinetCreateDuePreset = 'today';
    cabinetTaskComposerExpanded = false;
    if (typeof showNotification === 'function') {
        showCabinetTaskCreateSuccessToast(result, draft, verification, postCreateWarningCount);
    }
    try {
        await refreshMyCabinetTab();
        setCabinetTaskComposerStatus('Задачу створено.', 'success');
    } finally {
        cabinetTaskCreatePending = false;
        setCabinetTaskCreateBusy(false);
    }
}

// ==========================================
// INVENTORY
// ==========================================
function renderInventory() {
    if (profileTabLock('inventory')) return renderProfileComingSoon('inventory');
    const items = myInventory || [];

    if (items.length === 0) {
        return `<div class="inventory-empty-state" style="text-align:center;padding:48px 20px">
            <div style="font-size:16px;font-weight:700;color:var(--gray-700);margin-bottom:4px">Інвентар порожній</div>
            <div style="font-size:13px;color:var(--gray-400)">Купуй предмети в магазині або отримуй за ачивки</div>
            <button onclick="switchTab('shop')" style="margin-top:16px;padding:10px 24px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-weight:700;cursor:pointer;font-family:inherit">🛒 Перейти в магазин</button>
        </div>`;
    }

    const cardsHtml = items.map(item => {
        const emoji = CATEGORY_EMOJIS[item.category] || '📦';
        const rarityColor = { common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' }[item.rarity] || '#9ca3af';
        return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--gray-50,#f9fafb);border-radius:12px;border-left:4px solid ${rarityColor}">
            <div style="font-size:28px;flex-shrink:0">${escapeHtml(emoji)}</div>
            <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:700;color:var(--gray-800)">${escapeHtml(item.name)}</div>
                <div style="font-size:12px;color:var(--gray-400)">${RARITY_LABELS[item.rarity] || item.rarity}${item.quantity > 1 ? ' · x' + item.quantity : ''}</div>
            </div>
            ${item.isEquipped ? '<span style="padding:4px 10px;border-radius:6px;background:var(--primary);color:#fff;font-size:11px;font-weight:700">Одягнено</span>' : ''}
        </div>`;
    }).join('');

    return `<div style="margin-top:16px">
        <h3 style="margin-bottom:12px">Інвентар (${items.length})</h3>
        <div style="display:flex;flex-direction:column;gap:8px">${cardsHtml}</div>
    </div>`;
}

// ==========================================
// ACHIEVEMENTS (with category filter)
// ==========================================
const ACH_CATEGORIES = [
    { id: 'all', label: 'Всі' },
    { id: 'work', label: '🔨 Робота' },
    { id: 'minigame', label: '🎮 Ігри' },
    { id: 'quiz', label: '📊 Квізи' },
    { id: 'social', label: '💬 Соціальні' },
    { id: 'streaks', label: '🔥 Стріки' },
    { id: 'special', label: '⭐ Особливі' },
];

function setAchCat(cat) {
    achCatFilter = cat;
    switchTab('achievements');
}

function renderAchievements() {
    const visible = myAchievements.filter(a => !a.isSecret || a.completed);
    const filtered = achCatFilter === 'all' ? visible : visible.filter(a => a.category === achCatFilter);

    const tabsHtml = ACH_CATEGORIES.map(c =>
        `<button class="profile-secondary-tab ${achCatFilter === c.id ? 'active' : ''}"
                 onclick="setAchCat('${c.id}')">${c.label}</button>`
    ).join('');

    let cardsHtml = filtered.map(a => {
        const pct = a.target > 1 ? Math.min(100, Math.round((a.progress / a.target) * 100)) : (a.completed ? 100 : 0);
        const rewardState = a.completed
            ? '<span class="achievement-state achievement-state--claimed">Нагороду зараховано</span>'
            : (a.progress > 0
                ? '<span class="achievement-state achievement-state--progress">У процесі</span>'
                : '<span class="achievement-state achievement-state--locked">Заблоковано</span>');
        return `
        <div class="achievement-card ${a.completed ? 'completed unlocked' : ''} ${!a.completed && a.progress === 0 ? 'locked' : ''}">
            <div class="achievement-icon">${a.icon}</div>
            <div class="achievement-info">
                <h3>${escapeHtml(a.name)} <span class="rarity-badge rarity-${a.rarity}">${RARITY_LABELS[a.rarity] || a.rarity}</span></h3>
                <p>${escapeHtml(a.description)}</p>
                <div class="achievement-reward">+${a.rewardCoins} 💰 ${rewardState}</div>
                ${a.target > 1 ? `
                <div class="achievement-progress" style="height:6px;background:var(--gray-200);border-radius:3px;margin-top:6px">
                    <div class="achievement-progress-fill" style="width:${pct}%;height:100%;border-radius:3px;background:var(--primary);transition:width 0.4s"></div>
                </div>
                <div style="font-size:11px;color:var(--gray-400);margin-top:2px">${a.progress}/${a.target}</div>
                ` : ''}
            </div>
        </div>`;
    }).join('');

    if (!cardsHtml) cardsHtml = '<div class="empty-state"><div class="empty-state-icon">🏆</div><div class="empty-state-text">Немає ачивок в цій категорії</div></div>';

    return `
    <div class="achievements-section" style="margin-top:16px">
        <h3 style="margin-bottom:12px">🏆 Ачивки (${visible.filter(a => a.completed).length}/${visible.length})</h3>
        <div class="profile-secondary-tabs">${tabsHtml}</div>
        <div class="achievements-grid">${cardsHtml}</div>
    </div>`;
}

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
function renderDailyPreview() {
    if (!questsData?.quests || questsData.quests.length === 0) return '';
    const unclaimed = questsData.quests.filter(q => q.completed && !q.claimed).length;
    const done = questsData.quests.filter(q => q.completed).length;
    const total = questsData.quests.length;
    const totalCoins = questsData.quests.reduce((s, q) => s + (q.rewardCoins || 0), 0);
    const earnedCoins = questsData.quests.filter(q => q.claimed).reduce((s, q) => s + (q.rewardCoins || 0), 0);

    // Show first 3 incomplete quests as preview
    const preview = questsData.quests.filter(q => !q.claimed).slice(0, 3);
    const previewHtml = preview.map(q => {
        const icon = QUEST_ICONS[q.questType] || '📋';
        const pct = q.targetValue > 0 ? Math.min(100, Math.round((q.progress / q.targetValue) * 100)) : 0;
        const canClaim = q.completed && !q.claimed;
        const pending = isRewardClaimPending('quest', q.id);
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;${canClaim || pending ? 'opacity:1' : ''}">
            <span style="font-size:18px;flex-shrink:0">${icon}</span>
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(q.title)}</div>
                <div style="height:4px;background:var(--gray-200);border-radius:2px;margin-top:3px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${canClaim ? '#22c55e' : 'var(--primary)'};border-radius:2px;transition:width 0.4s"></div>
                </div>
            </div>
            <span style="font-size:11px;color:var(--gray-400);flex-shrink:0">${q.progress}/${q.targetValue}</span>
            ${canClaim || pending ? renderRewardClaimButton('quest', q.id, 'Забрати', { stopPropagation: true, compact: true }) : ''}
        </div>`;
    }).join('');

    return `
    <div style="margin-bottom:16px;padding:16px;background:var(--gray-50,#f9fafb);border-radius:12px;border:1px solid var(--gray-100,#f3f4f6)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0;font-size:15px;font-weight:700">📋 Щоденні завдання</h3>
            <div style="display:flex;gap:12px;align-items:center">
                <span style="font-size:12px;color:var(--gray-400)">💰 ${earnedCoins}/${totalCoins}</span>
                <span style="font-size:13px;font-weight:700;color:var(--primary)">${done}/${total}</span>
            </div>
        </div>
        <div style="height:6px;background:var(--gray-200);border-radius:3px;overflow:hidden;margin-bottom:10px">
            <div style="height:100%;width:${total > 0 ? Math.round(done/total*100) : 0}%;background:var(--primary);border-radius:3px;transition:width 0.4s"></div>
        </div>
        ${unclaimed > 0 ? `<div style="color:#22c55e;font-size:13px;font-weight:600;margin-bottom:8px;animation:badge-pulse 1.5s infinite">🎁 ${unclaimed} нагород готові до збору!</div>` : ''}
        ${previewHtml}
        ${questsData.quests.length > 3 ? `<button onclick="switchTab('quests')" style="margin-top:8px;width:100%;padding:8px 16px;border:none;border-radius:8px;background:var(--primary);color:#fff;font-weight:600;cursor:pointer;font-family:inherit;font-size:13px">Всі завдання →</button>` : ''}
    </div>`;
}

function renderQuests() {
    if (profileTabLock('quests')) return renderProfileComingSoon('quests');
    if (!questsData?.quests) return '<div style="text-align:center;padding:40px;color:var(--gray-500)">Квести завантажуються...</div>';

    const quests = questsData.quests;
    let html = '<div class="quests-container" style="margin-top:16px">';
    html += '<h3>Щоденні квести</h3>';

    for (const q of quests) {
        const icon = QUEST_ICONS[q.questType] || '📋';
        const pct = q.targetValue > 0 ? Math.min(100, Math.round((q.progress / q.targetValue) * 100)) : 0;
        const canClaim = q.completed && !q.claimed;
        const pending = isRewardClaimPending('quest', q.id);

        html += `
        <div class="quest-card ${q.completed ? 'completed' : ''} ${q.claimed ? 'claimed' : ''}">
            <div class="quest-icon">${icon}</div>
            <div class="quest-info">
                <div class="quest-title">${escapeHtml(q.title)}</div>
                <div class="quest-desc">${escapeHtml(q.description)} (${q.progress}/${q.targetValue})</div>
                <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
            </div>
            <div style="text-align:right">
                <div class="quest-reward">+${q.rewardCoins} \ud83d\udcb0</div>
                ${canClaim || pending ? renderRewardClaimButton('quest', q.id, 'Забрати') : ''}
                ${q.claimed ? '<span class="reward-state-badge reward-state-badge--claimed">Отримано</span>' : ''}
            </div>
        </div>`;
    }

    html += '</div>';
    return html;
}

// ==========================================
// TITLES
// ==========================================
function renderTitles() {
    if (!titlesData?.titles) return '<div style="text-align:center;padding:40px;color:var(--gray-500)">Титули завантажуються...</div>';

    let html = '<div style="margin-top:16px"><h3>Титули</h3>';
    html += '<div class="titles-grid">';

    for (const t of titlesData.titles) {
        const isActive = titlesData.activeTitle === t.code;
        html += `
        <div class="title-card ${t.earned ? '' : 'locked'} ${isActive ? 'active' : ''}"
             ${t.earned ? `onclick="setTitle('${escapeHtml(t.code)}')"` : ''}>
            <div class="title-card-icon">${t.icon}</div>
            <div>
                <div class="title-card-name">${escapeHtml(t.name)} <span class="rarity-badge ${t.rarity}">${RARITY_LABELS[t.rarity]}</span></div>
                <div class="title-card-desc">${escapeHtml(t.description)}</div>
                ${!t.earned ? `<div style="font-size:10px;color:var(--gray-400);margin-top:2px">${escapeHtml(t.conditionType)}: ${t.conditionValue}</div>` : ''}
            </div>
        </div>`;
    }

    html += '</div>';
    if (titlesData.activeTitle) {
        html += `<button onclick="setTitle('')" style="margin-top:8px;padding:4px 12px;font-size:12px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);background:none;cursor:pointer;color:var(--gray-500)">Зняти титул</button>`;
    }
    html += '</div>';
    return html;
}

// ==========================================
// SHOP TAB
// ==========================================
async function loadShopItems() {
    if (profileTabLock('shop')) return;
    const data = await apiGet('/gamification/shop');
    shopItems = data || [];
}

function renderShopTab() {
    if (profileTabLock('shop')) return renderProfileComingSoon('shop');
    if (!shopItems.length) return '<div class="empty-state"><div class="empty-state-icon">🛒</div><div class="empty-state-text">Магазин порожній</div></div>';

    const ownedCodes = new Set((myInventory || []).map(i => i.code));
    const coins = walletData?.coins || 0;

    let cardsHtml = shopItems.map(item => {
        const owned = ownedCodes.has(item.code);
        const canAfford = coins >= (item.priceCoins || item.price_coins || 0);
        const price = item.priceCoins || item.price_coins || 0;
        const emoji = CATEGORY_EMOJIS[item.category] || '📦';

        return `
        <div class="shop-card ${owned ? 'owned' : ''}" ${item.featured ? 'style="border-color:#fbbf24"' : ''}>
            <div class="shop-icon">${emoji}</div>
            <div class="shop-name">${escapeHtml(item.name)}</div>
            ${item.description ? `<div class="shop-desc">${escapeHtml(item.description)}</div>` : ''}
            <span class="rarity-badge rarity-${item.rarity}">${RARITY_LABELS[item.rarity] || item.rarity}</span>
            <div class="shop-price" style="margin-top:8px">${price === 0 ? 'Безкоштовно' : `💰 ${formatCoins(price)}`}</div>
            ${owned
                ? '<button class="shop-buy-btn" disabled>✅ У вас є</button>'
                : `<button class="shop-buy-btn" ${!canAfford ? 'disabled' : ''} onclick="buyItem(${item.id},'${escapeHtml(item.name).replace(/'/g, "\\'")}')">
                    ${canAfford ? '🛒 Купити' : '🔒 Замало монет'}
                   </button>`
            }
        </div>`;
    }).join('');

    return `
    <div style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3>🛒 Магазин</h3>
            <span class="coins-balance">🪙 ${formatCoins(coins)}</span>
        </div>
        <div class="shop-grid">${cardsHtml}</div>
    </div>`;
}

async function buyItem(itemId, itemName) {
    if (profileTabLock('shop')) {
        if (typeof showNotification === 'function') showNotification('Магазин поки закритий для цієї ролі', 'warning');
        return;
    }
    if (!await confirmModal(`Купити "${itemName}"?`, { okText: 'Купити', cancelText: 'Скасувати' })) return;
    const result = await apiPost('/gamification/shop/buy', { itemId });
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification(`Придбано: ${itemName}!`, 'success');
        // Refresh data
        walletData = await apiGet('/wallet');
        myInventory = await apiGet('/inventory') || [];
        await loadShopItems();
        switchTab('shop');
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка покупки', 'error');
    }
}

// ==========================================
// LEADERBOARD TAB
// ==========================================
async function loadLeaderboard() {
    leaderboardData = await apiGet(`/gamification/leaderboard?sort=${leaderboardSort}`);
}

function setLeaderboardSort(sort) {
    leaderboardSort = sort;
    leaderboardData = null;
    switchTab('leaderboard');
}

function renderLeaderboardTab() {
    // Mode toggle: Overall vs Monthly
    const modeHtml = `
    <div class="profile-secondary-tabs">
        <button class="profile-secondary-tab ${leaderboardMode === 'overall' ? 'active' : ''}"
                onclick="setLeaderboardMode('overall')">🏅 Загальний</button>
        <button class="profile-secondary-tab ${leaderboardMode === 'monthly' ? 'active' : ''}"
                onclick="setLeaderboardMode('monthly')">📅 Щомісячний</button>
    </div>`;

    if (leaderboardMode === 'monthly') {
        return modeHtml + renderMonthlyLeaderboard();
    }

    if (!leaderboardData) return modeHtml + '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">Завантаження рейтингу...</div></div>';

    const list = Array.isArray(leaderboardData) ? leaderboardData : (leaderboardData.leaderboard || []);
    if (!list.length) return modeHtml + '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">Рейтинг поки порожній</div></div>';

    const sortTabs = [
        { id: 'xp', label: 'За XP' },
        { id: 'coins', label: 'За монети' },
        { id: 'achievements', label: 'За ачивки' }
    ];

    const tabsHtml = sortTabs.map(s =>
        `<button class="profile-secondary-tab ${leaderboardSort === s.id ? 'active' : ''}"
                 onclick="setLeaderboardSort('${s.id}')">${s.label}</button>`
    ).join('');

    const rankIcons = ['🥇', '🥈', '🥉'];
    const listHtml = list.map((u, i) => {
        const isMe = u.id === currentUserId || u.userId === currentUserId;
        const avatarLetter = (u.displayName || u.username || '?')[0].toUpperCase();
        const scoreValue = leaderboardSort === 'coins' ? formatCoins(u.coins) :
                          leaderboardSort === 'achievements' ? (u.achievementsCount || u.achievements || 0) :
                          formatCoins(u.xp || 0);
        const scoreLabel = leaderboardSort === 'coins' ? 'монет' :
                          leaderboardSort === 'achievements' ? 'ачивок' : 'XP';

        return `
        <div class="leaderboard-item ${isMe ? 'is-me' : ''}">
            <div class="leaderboard-rank ${i < 3 ? `top-${i + 1}` : ''}">${rankIcons[i] || (i + 1)}</div>
            <div class="leaderboard-avatar">${avatarLetter}</div>
            <div class="leaderboard-user">
                <div class="leaderboard-name">${escapeHtml(u.displayName || u.username)}</div>
                <div class="leaderboard-title-text">${escapeHtml(u.activeTitle || u.role || '')}</div>
            </div>
            <div class="leaderboard-score">
                <div class="leaderboard-score-value">${scoreValue}</div>
                <div class="leaderboard-score-label">${scoreLabel}</div>
            </div>
        </div>`;
    }).join('');

    return `
    <div style="margin-top:16px">
        <h3 style="margin-bottom:12px">📊 Рейтинг</h3>
        ${modeHtml}
        <div class="profile-secondary-tabs">${tabsHtml}</div>
        <div class="leaderboard-list">${listHtml}</div>
    </div>`;
}

function renderMonthlyLeaderboard() {
    const months = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
    const categories = [
        { id: 'overall', label: 'Загальний' },
        { id: 'bookings', label: 'Бронювання' },
        { id: 'tasks', label: 'Задачі' },
        { id: 'xp', label: 'XP' },
        { id: 'coins', label: 'Монети' }
    ];

    const catTabs = categories.map(c =>
        `<button class="profile-secondary-tab ${monthlyCategory === c.id ? 'active' : ''}"
                 onclick="setMonthlyFilter('${c.id}')">${c.label}</button>`
    ).join('');

    let listHtml = '';
    const data = monthlyLeaderboard;
    const list = data?.leaderboard || [];

    if (list.length === 0) {
        listHtml = '<div class="empty-state" style="padding:20px"><div class="empty-state-text">Немає даних за цей місяць. Рейтинг оновлюється автоматично.</div></div>';
    } else {
        const rankIcons = ['🥇', '🥈', '🥉'];
        listHtml = `<div class="leaderboard-list">${list.map((u, i) => `
            <div class="leaderboard-item">
                <div class="leaderboard-rank ${i < 3 ? `top-${i + 1}` : ''}">${rankIcons[i] || u.rank || (i + 1)}</div>
                <div class="leaderboard-avatar">${(u.display_name || u.username || '?')[0].toUpperCase()}</div>
                <div class="leaderboard-user">
                    <div class="leaderboard-name">${escapeHtml(u.display_name || u.username)}</div>
                    <div class="leaderboard-title-text">${escapeHtml(u.title || '')}</div>
                </div>
                <div class="leaderboard-score">
                    <div class="leaderboard-score-value">${formatCoins(u.score)}</div>
                    <div class="leaderboard-score-label">${monthlyCategory}</div>
                </div>
            </div>
        `).join('')}</div>`;
    }

    return `
    <div style="margin-top:8px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <h4>📅 ${months[monthlyMonth - 1]} ${monthlyYear}</h4>
        </div>
        <div class="profile-secondary-tabs">${catTabs}</div>
        ${listHtml}
    </div>`;
}

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

function attachProfileListeners() {
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

    document.querySelectorAll('[data-cabinet-subtask-done]').forEach(input => {
        if (input.dataset.cabinetSubtaskBound === 'true') return;
        input.dataset.cabinetSubtaskBound = 'true';
        input.addEventListener('change', event => {
            event.stopPropagation();
            updateCabinetSubtaskDone(input);
        });
    });

    document.querySelectorAll('[data-cabinet-due-preset]').forEach(button => {
        if (button.dataset.cabinetDueBound === 'true') return;
        button.dataset.cabinetDueBound = 'true';
        button.addEventListener('click', () => setCabinetDuePreset(button.dataset.cabinetDuePreset, { refreshList: true }));
    });
    document.querySelectorAll('[data-cabinet-list-mode]').forEach(button => {
        if (button.dataset.cabinetListModeBound === 'true') return;
        button.dataset.cabinetListModeBound = 'true';
        button.addEventListener('click', () => setCabinetMyDayListMode(button.dataset.cabinetListMode, { rerender: true }));
    });
    document.querySelectorAll('[data-cabinet-my-day-view-mode]').forEach(button => {
        if (button.dataset.cabinetMyDayViewModeBound === 'true') return;
        button.dataset.cabinetMyDayViewModeBound = 'true';
        button.addEventListener('click', () => setCabinetMyDayViewMode(button.dataset.cabinetMyDayViewMode, { rerender: true }));
    });
    document.querySelectorAll('[data-cabinet-my-day-segment]').forEach(button => {
        if (button.dataset.cabinetMyDaySegmentBound === 'true') return;
        button.dataset.cabinetMyDaySegmentBound = 'true';
        button.addEventListener('click', () => setCabinetMyDaySegment(button.dataset.cabinetMyDaySegment, { rerender: true }));
    });
    document.querySelectorAll('[data-cabinet-all-group-toggle]').forEach(button => {
        if (button.dataset.cabinetAllGroupBound === 'true') return;
        button.dataset.cabinetAllGroupBound = 'true';
        button.addEventListener('click', () => toggleCabinetAllGroup(button.dataset.cabinetAllGroupToggle, { rerender: true }));
    });
    document.querySelectorAll('[data-cabinet-refresh]').forEach(button => {
        if (button.dataset.cabinetRefreshBound === 'true') return;
        button.dataset.cabinetRefreshBound = 'true';
        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            button.disabled = true;
            button.classList.add('is-busy');
            try {
                await refreshMyCabinetTab({ silent: false, keepExistingOnError: true });
            } finally {
                button.disabled = false;
                button.classList.remove('is-busy');
            }
        });
    });
    document.querySelectorAll('[data-cabinet-bucket-more]').forEach(button => {
        if (button.dataset.cabinetBucketMoreBound === 'true') return;
        button.dataset.cabinetBucketMoreBound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            void loadCabinetBucketPage(button);
        });
    });
    document.querySelectorAll('[data-cabinet-priority-preset]').forEach(button => {
        if (button.dataset.cabinetPriorityBound === 'true') return;
        button.dataset.cabinetPriorityBound = 'true';
        button.addEventListener('click', () => setCabinetCreatePriority(button.dataset.cabinetPriorityPreset));
    });
    const cabinetPriority = document.getElementById('cabinetTaskPriority');
    if (cabinetPriority && cabinetPriority.dataset.cabinetPrioritySelectBound !== 'true') {
        cabinetPriority.dataset.cabinetPrioritySelectBound = 'true';
        cabinetPriority.addEventListener('change', () => setCabinetCreatePriority(cabinetPriority.value));
    }
    const cabinetDate = document.getElementById('cabinetTaskDate');
    if (cabinetDate && cabinetDate.dataset.cabinetDateBound !== 'true') {
        cabinetDate.dataset.cabinetDateBound = 'true';
        cabinetDate.addEventListener('change', () => {
            setCabinetDuePreset('custom', { rerender: true });
            const focusDate = cabinetSelectedDueDate();
            if (!focusDate) return;
            refreshMyCabinetTab({ silent: true, keepExistingOnError: true })
                .then(() => rerenderCabinetMyDaySegmentPanel())
                .catch(error => console.warn('Profile cabinet custom focus refresh failed', error));
        });
    }
    document.querySelectorAll('[data-cabinet-composer-toggle]').forEach(button => {
        if (button.dataset.cabinetComposerToggleBound === 'true') return;
        button.dataset.cabinetComposerToggleBound = 'true';
        button.addEventListener('click', () => setCabinetTaskComposerExpanded(!cabinetTaskComposerExpanded, { focusTitle: !cabinetTaskComposerExpanded }));
    });
    bindCabinetTaskDragDrop();
    bindCabinetSubtaskDragDrop();
    bindCabinetSubtasks();

    const myDayTimeTracking = window.MyDayTimeTracking;
    if (myDayTimeTracking) {
        if (activeTab === 'myday') myDayTimeTracking.bind?.(document);
        else myDayTimeTracking.syncTicker?.(false);
    }
    if (myDayTimeTracking && activeTab === 'myday' && !myDayTimeTracking.state.loaded && !myDayTimeTracking.state.loading) {
        myDayTimeTracking.load().then(() => {
            if (activeTab === 'myday') renderCabinetActiveTab();
        }).catch(error => console.warn('My Day timer load failed', error));
    }

    const myDayClassification = window.MyDayClassification;
    if (myDayClassification && activeTab === 'myday') {
        const rerenderMyDayClassificationSurface = async () => {
            renderCabinetActiveTab();
        };
        myDayClassification.bind(document, rerenderMyDayClassificationSurface);
        if (!myDayClassification.state.loaded && !myDayClassification.state.loading && !myDayClassification.state.error) {
            const taxonomyLoad = myDayClassification.load();
            if (myDayClassification.state.loading) rerenderMyDayClassificationSurface();
            taxonomyLoad.then(rerenderMyDayClassificationSurface).catch(() => {
                rerenderMyDayClassificationSurface();
            });
        }
    }

    if (window.TaskAiDraft && activeTab === 'myday') {
        const composer = document.getElementById('cabinetTaskComposer');
        window.TaskAiDraft.bindComposer(composer, {
            sourceModule: 'profile_my_cabinet',
            sourceSurface: 'profile_my_cabinet',
            readDraft: readCabinetAiDraft,
            applyField: applyCabinetAiDraftField,
            focusField: focusCabinetAiDraftField,
            requestSubmit: () => composer?.requestSubmit?.(),
            commitBundle: window.TaskCreate?.commitAiDraftBundle
        });
    }

    const myDayHabits = window.MyDayHabits;
    if (myDayHabits && activeTab === 'myday') {
        const rerenderMyDayHabitsSurface = async () => {
            renderCabinetActiveTab();
        };
        myDayHabits.bind(document, rerenderMyDayHabitsSurface);
        if (activeTab === 'myday' && myDayHabits.state.mode === 'habits' && !myDayHabits.state.loaded && !myDayHabits.state.loading) {
            const habitsLoad = myDayHabits.load();
            if (myDayHabits.state.loading) rerenderMyDayHabitsSurface();
            habitsLoad.then(rerenderMyDayHabitsSurface).catch(rerenderMyDayHabitsSurface);
        }
        if (activeTab === 'myday' && myDayHabits.state.mode === 'contribution' && window.MyDayContribution && !window.MyDayContribution.state.loaded && !window.MyDayContribution.state.loading && !window.MyDayContribution.state.error) {
            const contributionLoad = window.MyDayContribution.load();
            if (window.MyDayContribution.state.loading) rerenderMyDayHabitsSurface();
            contributionLoad.then(rerenderMyDayHabitsSurface).catch(rerenderMyDayHabitsSurface);
        }
        if (activeTab === 'myday' && window.MyDayContribution) {
            window.MyDayContribution.bind(document, rerenderMyDayHabitsSurface);
        }
        if (myDayHabits.state.surface === 'setup' && !myDayHabits.state.settingsLoaded && !myDayHabits.state.settingsLoading) {
            const settingsLoad = myDayHabits.loadSettings();
            if (myDayHabits.state.settingsLoading) rerenderMyDayHabitsSurface();
            settingsLoad.then(rerenderMyDayHabitsSurface).catch(rerenderMyDayHabitsSurface);
        }
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

    // Check for auto-awarded achievements/titles without exposing fake manual claim UX.
    checkProfileAutoRewards();
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
    window.addEventListener('crm:timer-updated', (event) => {
        if (event?.detail?.source !== 'global') return;
        if (!profileData || !isOwnProfile || activeTab !== 'myday') return;
        window.clearTimeout(profileTaskProjectionRefreshTimer);
        profileTaskProjectionRefreshTimer = window.setTimeout(async () => {
            try {
                await window.MyDayTimeTracking?.load?.();
            } catch (error) {
                console.warn('Profile My Day timer state refresh failed', error);
            }
            refreshMyCabinetTab({ silent: true, keepExistingOnError: true }).catch(error => {
                console.warn('Profile My Day timer refresh failed', error);
            });
        }, 120);
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
