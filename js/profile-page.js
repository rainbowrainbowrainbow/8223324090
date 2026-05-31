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
let myTasksSegment = 'all';
let cabinetCreateDuePreset = 'today';
let cabinetTaskComposerExpanded = false;
let cabinetPulseCounts = { alerts: 0, funnel: 0 };
let cabinetSnoozeOutsideBound = false;
let cabinetTaskDragDropBound = false;
let cabinetTaskDragState = null;
let cabinetUndoToastTimer = null;
let profileSecurityData = null;
let cabinetSavedDecompositionTemplates = [];
let cabinetDecompositionSuggestions = [];
let cabinetSuggestionTimer = null;
let lastCabinetSuggestionKey = '';
let lastCabinetCreatedTaskId = null;
let profileWidgetConfig = [];
let profileWidgetSettingsOpen = false;
const expandedCabinetSubtaskIds = new Set();
const collapsedCabinetSubtaskIds = new Set();
const cabinetSubtaskCache = new Map();
const loadingCabinetSubtaskIds = new Set();

function notifyTaskWidgetsChanged(detail = {}) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('crm:tasks-updated', {
        detail: {
            source: 'profile_my_cabinet',
            ...detail
        }
    }));
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

const CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT = 36;

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
        instructor: 'Інструктор',
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
        ...profileWorkHubTabOrder().map(({ id, label, ownOnly }) => ({ id, label, ownOnly })),
        { id: 'achievements', label: 'Досягнення' },
        { id: 'leaderboard', label: 'Рейтинг' },
        { id: 'inventory', label: 'Інвентар', ownOnly: true },
        { id: 'shop', label: 'Магазин', ownOnly: true },
        { id: 'myday', label: 'Мій день', ownOnly: true },
        { id: 'mytasks', label: 'Мої задачі', ownOnly: true },
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

function profileWorkTabMetric(tabId) {
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
        case 'mytasks':
            return `${cabinetList('all').length || Number(profileData?.tasks?.assigned || 0)} активні`;
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

function profileAvatarData(data = profileData) {
    const user = profileUser(data);
    return {
        url: user.avatarUrl || user.avatar_url || data?.avatarUrl || data?.avatar_url || '',
        emoji: user.avatarEmoji || user.avatar_emoji || data?.avatarEmoji || data?.avatar_emoji || '',
        color: user.avatarColor || user.avatar_color || data?.avatarColor || data?.avatar_color || '#f59e0b',
        initial: profileInitial(data)
    };
}

function renderProfileAvatarVisual(className = 'profile-work-avatar', data = profileData, attrs = '') {
    const avatar = profileAvatarData(data);
    const style = avatar.color ? ` style="background:${escapeHtml(avatar.color)}"` : '';
    if (avatar.url) {
        return `<div class="${className}"${attrs}><img src="${escapeHtml(avatar.url)}" alt=""></div>`;
    }
    return `<div class="${className}"${style}${attrs}>${escapeHtml(avatar.initial)}</div>`;
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

async function apiPost(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return null;
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            return {
                success: false,
                error: window.CrmApiErrors?.format?.(payload, 'Помилка запиту') || payload.error || payload.message || 'Помилка запиту',
                requestId: payload.requestId || payload.request_id || null,
                status: r.status
            };
        }
        return payload;
    } catch (e) { console.error('API POST', path, e); return null; }
}

async function apiPut(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return null;
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            return {
                success: false,
                error: window.CrmApiErrors?.format?.(payload, 'Помилка запиту') || payload.error || payload.message || 'Помилка запиту',
                requestId: payload.requestId || payload.request_id || null,
                status: r.status
            };
        }
        return payload;
    } catch (e) { console.error('API PUT', path, e); return null; }
}

async function apiPatch(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return null;
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            return {
                success: false,
                error: window.CrmApiErrors?.format?.(payload, 'Помилка запиту') || payload.error || payload.message || 'Помилка запиту',
                requestId: payload.requestId || payload.request_id || null,
                status: r.status
            };
        }
        return payload;
    } catch (e) { console.error('API PATCH', path, e); return null; }
}

async function apiDelete(path) {
    try {
        const r = await fetch(`/api${path}`, { method: 'DELETE', headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return null;
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
            return {
                success: false,
                error: window.CrmApiErrors?.format?.(payload, 'Помилка запиту') || payload.error || payload.message || 'Помилка запиту',
                requestId: payload.requestId || payload.request_id || null,
                status: r.status
            };
        }
        return payload;
    } catch (e) { console.error('API DELETE', path, e); return null; }
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
        window.WorkingRole?.hydrate?.();
        currentUserId = user.id;
    } catch (e) { window.location.href = '/'; return; }

    // Check URL for user ID
    const params = new URLSearchParams(window.location.search);
    const viewUserId = parseInt(params.get('id')) || currentUserId;
    isOwnProfile = viewUserId === currentUserId;
    const requestedTab = params.get('tab');
    const normalizedRequestedTab = requestedTab === 'profile' ? 'professions' : requestedTab;
    const allowedOwnTabs = ['professions', 'checklists', 'materials', 'myday', 'mytasks', 'settings', 'achievements', 'inventory', 'shop', 'leaderboard', 'quests', 'season', 'teams', 'referral'];
    if (isOwnProfile && normalizedRequestedTab && allowedOwnTabs.includes(normalizedRequestedTab)) {
        activeTab = normalizedRequestedTab;
    }

    // Load data
    await loadProfileData(viewUserId);
    renderProfile();
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
}

async function loadProfileData(userId) {
    const results = await Promise.all([
        apiGet(isOwnProfile ? '/auth/profile' : `/auth/profile/${userId}`),
        isOwnProfile ? apiGet('/wallet') : null,
        isOwnProfile ? apiGet('/inventory') : null,
        apiGet('/achievements'),
        null, // notes retired from My Cabinet/profile surface
        isOwnProfile ? apiGet('/quests/daily') : null,
        isOwnProfile ? apiGet('/quests/titles') : null,
        isOwnProfile ? apiGet('/streaks') : null,
        isOwnProfile ? apiGet('/tasks/my-cabinet') : null,
        isOwnProfile ? apiGet('/dashboard/alerts') : null,
        isOwnProfile ? apiGet('/leads/new-count') : null,
        isOwnProfile ? apiGet('/auth/security') : null
    ]);

    profileData = results[0];
    walletData = results[1];
    myInventory = results[2] || [];
    myAchievements = results[3] || [];
    myNotes = results[4] || [];
    questsData = results[5];
    titlesData = results[6];
    allStreaks = results[7];
    myCabinetData = results[8];
    syncCabinetPulseCounts(results[9], results[10]);
    profileSecurityData = results[11];
    profileWidgetConfig = normalizeProfileCockpitWidgets(profileData?.profilePreferences?.cockpitWidgets);
    ensureActiveProfessionKey();
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
    const time = `${shift.start || ''}${shift.end ? ' - ' + shift.end : ''}`.trim();
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
    const body = profileSecondaryTabOrder()
        .map(tab => renderProfilePrimaryTab(tab.id, tab.label, { ownOnly: tab.ownOnly }))
        .filter(Boolean)
        .join('');
    if (!body) return '';
    return `
        <nav class="profile-secondary-work-menu" aria-label="Додаткові розділи профілю">
            <div class="profile-secondary-tabs" role="tablist" aria-label="Додаткові розділи профілю">
                ${body}
            </div>
        </nav>`;
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

        <div class="profile-header profile-work-header">
            <div class="profile-identity-block">
                ${isOwnProfile
                    ? renderProfileAvatarVisual('profile-work-avatar profile-avatar-clickable', p, ' role="button" tabindex="0" title="Змінити аватар" onclick="switchTab(\'settings\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();switchTab(\'settings\');}"')
                    : renderProfileAvatarVisual('profile-work-avatar', p)}
                <div class="profile-identity-copy">
                    <div class="profile-kicker">Особистий робочий профіль</div>
                    <h1>${escapeHtml(name)}</h1>
                    <div class="profile-working-role-wrap">
                        <div class="profile-role-line">
                            <span>${escapeHtml(primaryProfession.title)}</span>
                            ${secondaryCount ? `<span>+${secondaryCount} додаткові професії</span>` : ''}
                            ${isOwnProfile ? `<button type="button" id="profileWorkingRoleTrigger" class="profile-working-role-trigger" aria-expanded="false" aria-controls="profileWorkingRolePanel">
                                <small>Робоча роль</small>
                                <b>${escapeHtml(workingRoleLabel)}</b>
                            </button>` : `<span>Доступ: ${escapeHtml(roleLabel)}</span>`}
                            ${username ? `<span>@${escapeHtml(username)}</span>` : ''}
                            <span class="${p.user?.telegramConnected ? 'is-ok' : ''}">${p.user?.telegramConnected ? 'Telegram підключено' : 'Telegram не підключено'}</span>
                        </div>
                        ${isOwnProfile ? renderProfileWorkingRoleControl(workingRoleState) : ''}
                    </div>
                    ${titleHtml ? `<div class="profile-title-row">${titleHtml}</div>` : ''}
                    ${p.user?.bio || p.bio ? `<div class="profile-bio">${escapeHtml(p.user?.bio || p.bio)}</div>` : ''}
                </div>
            </div>

            ${renderProfileProfessionHeaderPanel(professionEntries)}
        </div>

        <section class="profile-work-hub" aria-label="Робочий доступ профілю">
            ${renderProfileProfessionSwitcher(professionEntries)}
            ${renderProfileSecondaryTabs()}
        </section>

        <div id="tabContent">
            ${renderTabContent()}
        </div>
    </div>`;

    document.getElementById('main-content').innerHTML = html;
    attachProfileListeners();
}

async function switchTab(tab) {
    activeTab = tab;
    const locked = profileTabLock(tab);
    if (!locked && isOwnProfile && (tab === 'myday' || tab === 'mytasks') && !myCabinetData) {
        myCabinetData = await apiGet('/tasks/my-cabinet');
    }
    if (!locked && isOwnProfile && (tab === 'myday' || tab === 'mytasks')) {
        await refreshCabinetPulseCounts();
    }

    // Lazy load data for tabs that need it
    if (!locked && tab === 'shop' && shopItems.length === 0) await loadShopItems();
    if (!locked && tab === 'leaderboard' && !leaderboardData) await loadLeaderboard();
    if (!locked && tab === 'season' && !seasonalQuests) await loadSeasonalQuests();
    if (!locked && tab === 'teams' && !teamsData) await loadTeamsData();
    if (!locked && tab === 'referral' && !referralData) await loadReferralData();
    if (!locked && tab === 'materials') await loadProfileWorkMaterials(profileActiveProfessionEntry().key);

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
        case 'mytasks': return renderMyTasksTab();
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
                    <a href="/profile?tab=mytasks">Мої задачі <span>робочий список</span></a>
                    <a href="/tasks?view=my">Задачі CRM <span>повний модуль</span></a>
                    <a href="/hr?tab=schedule">Графік <span>зміни й присутність</span></a>
                    <a href="/training">Навчання <span>матеріали ролі</span></a>
                </div>
            </section>

        </div>`;
}

function renderProfileSettingsTab() {
    const avatar = profileAvatarData(profileData);
    const currentColor = avatar.color || '#f59e0b';
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
                            ${avatar.url ? `<img src="${escapeHtml(avatar.url)}" alt="">` : escapeHtml(avatar.initial)}
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
                        <details class="profile-avatar-url-details">
                            <summary>Вставити посилання на фото</summary>
                            <div class="profile-avatar-url-row">
                                <input id="profileAvatarUrl" type="url" placeholder="https://.../avatar.jpg" value="${escapeHtml(avatar.url)}" oninput="previewProfileAvatarUrl()">
                                <button type="button" onclick="saveProfileAvatar('image')">Зберегти URL</button>
                            </div>
                        </details>
                        <p class="profile-avatar-note">Найзручніше — обрати фото з пристрою, перевірити preview і натиснути «Зберегти фото». Sidebar оновиться одразу після збереження.</p>
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
    if (type === 'account_roles_updated') {
        const parts = [];
        if (details.oldRole || details.newRole) parts.push(`${details.oldRole || '—'} → ${details.newRole || '—'}`);
        if (details.changed?.extraRoles) parts.push('додаткові ролі оновлено');
        if (details.changed?.pageAllowlist) parts.push('сторінки доступу оновлено');
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
    const url = String(document.getElementById('profileAvatarUrl')?.value || '').trim();
    preview.innerHTML = '';
    if (mode === 'image' && url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        preview.style.background = 'transparent';
        preview.appendChild(img);
        return;
    }
    preview.style.background = color;
    preview.textContent = profileAvatarData().initial;
}

function selectProfileAvatarColor(color) {
    const input = document.getElementById('profileAvatarColor');
    if (input) input.value = color;
    document.querySelectorAll('.profile-avatar-color-grid button').forEach(btn => {
        btn.classList.toggle('active', (btn.getAttribute('title') || '').toLowerCase() === color.toLowerCase());
    });
    paintProfileAvatarPreview('initials');
}

function previewProfileAvatarUrl() {
    const url = String(document.getElementById('profileAvatarUrl')?.value || '').trim();
    paintProfileAvatarPreview(url ? 'image' : 'initials');
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
        const hasUrl = String(document.getElementById('profileAvatarUrl')?.value || '').trim();
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
        const urlInput = document.getElementById('profileAvatarUrl');
        if (urlInput && result.user?.avatarUrl) urlInput.value = result.user.avatarUrl;
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
        avatarUrl: String(document.getElementById('profileAvatarUrl')?.value || '').trim()
    };
    const result = await apiPatch('/auth/profile/avatar', payload);
    applyProfileAvatarResult(result);
}

function renderProfileTaskRow(task, tag = '') {
    const dueAt = task.scheduledStartAt || task.scheduled_start_at || task.schedule?.startAt || task.deadline;
    const due = dueAt ? profileFormatTime(dueAt) : 'Без дедлайну';
    const priority = task.priority || 'medium';
    return `
        <div class="profile-task-row ${task.isOverdue || tag === 'Прострочено' ? 'is-overdue' : ''}">
            <div>
                <b>${escapeHtml(task.title || 'Без назви')}</b>
                <span>${escapeHtml(tag || task.status || 'todo')} · ${escapeHtml(due)}</span>
            </div>
            <small>${escapeHtml(priority)}</small>
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

function findCabinetTask(taskId) {
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const buckets = ['all', 'today', 'overdue', 'waiting', 'private', 'createdByMe', 'completedHistory'];
    for (const bucket of buckets) {
        const found = cabinetList(bucket).find(task => Number(task.id || task.taskId || task.task_id) === id);
        if (found) return found;
    }
    return null;
}

function cabinetCompletedHistoryList() {
    return cabinetList('completedHistory');
}

function cabinetCompletedHistoryCounts(data = myCabinetData) {
    const history = Array.isArray(data?.completedHistory) ? data.completedHistory : [];
    const quick = data?.stats?.taskQuick || {};
    const total = Number(quick.completedTotal ?? quick.completed ?? history.length) || history.length;
    const shown = Number(quick.completedHistoryShown ?? history.length) || history.length;
    const overflow = Number(quick.completedHistoryOverflow ?? Math.max(0, total - shown)) || 0;
    return { total, shown: Math.min(shown, history.length), overflow };
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

function closeCabinetCompletedDayDividers(except = null) {
    document.querySelectorAll('.cabinet-completed-day-divider.is-open').forEach(divider => {
        if (divider === except) return;
        divider.classList.remove('is-open');
        divider.querySelector('[data-cabinet-completed-day-divider]')?.setAttribute('aria-expanded', 'false');
    });
}

function cabinetTaskPriorityLabel(priority = '') {
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

function renderCabinetCompletedHistoryTile(task = {}, index = 0) {
    const taskId = Number(task.id || task.taskId || task.task_id || 0);
    const stableId = Number.isInteger(taskId) && taskId > 0 ? taskId : `x${index}`;
    const detailId = `cabinetCompletedDetail${stableId}`;
    const title = task.title || 'Без назви';
    const completedAt = cabinetTaskCompletedAt(task);
    const completedLabel = completedAt ? profileFormatTime(completedAt) : 'час не вказано';
    const priority = String(task.priority || 'normal').toLowerCase();
    const priorityLabel = cabinetTaskPriorityLabel(priority);
    const categoryLabel = cabinetTaskCategoryLabel(task);
    const subSummary = cabinetSubtaskSummary(task);
    const subtaskLabel = subSummary.total ? `${subSummary.done}/${subSummary.total} підзадач` : '';
    const tooltip = cabinetCompletedHistoryDetail(task);
    return `
        <span class="cabinet-completed-item" role="listitem">
        <button type="button"
                class="cabinet-completed-tile cabinet-completed-tile--${escapeHtml(priority)}"
                aria-label="${escapeHtml(tooltip)}"
                aria-describedby="${escapeHtml(detailId)}"
                title="${escapeHtml(tooltip)}">
            <span class="cabinet-completed-mark" aria-hidden="true"></span>
            <span id="${escapeHtml(detailId)}" class="cabinet-completed-detail" role="tooltip">
                <b>${escapeHtml(title)}</b>
                <span>${escapeHtml(completedLabel)}</span>
                <small>${escapeHtml([priorityLabel, categoryLabel, subtaskLabel].filter(Boolean).join(' · '))}</small>
            </span>
        </button>
        </span>`;
}

function renderCabinetCompletedDayDivider(group = {}, groupIndex = 0) {
    const day = group.day || cabinetCompletedHistoryDayMeta(null);
    const count = group.tasks?.length || 0;
    const safeKey = String(day.key || `day-${groupIndex}`).replace(/[^a-z0-9_-]/gi, '');
    const detailId = `cabinetCompletedDay${safeKey}${groupIndex}`;
    const label = `${day.longLabel}: ${formatCabinetPulseCount(count)} виконаних задач у видимій історії`;
    return `
        <span class="cabinet-completed-day-divider" role="listitem" data-day-key="${escapeHtml(day.key)}">
            <button type="button"
                    class="cabinet-completed-day-button"
                    data-cabinet-completed-day-divider
                    aria-expanded="false"
                    aria-label="${escapeHtml(label)}"
                    aria-describedby="${escapeHtml(detailId)}"
                    title="${escapeHtml(label)}">
                <span class="cabinet-completed-day-line" aria-hidden="true"></span>
                <span class="cabinet-completed-day-dot" aria-hidden="true"></span>
                <span class="cabinet-completed-day-count" aria-hidden="true">${formatCabinetPulseCount(count)}</span>
                <span id="${escapeHtml(detailId)}" class="cabinet-completed-day-label" role="tooltip">
                    <b>${escapeHtml(day.shortLabel)}</b>
                    <span>${escapeHtml(day.longLabel)}</span>
                    <small>${formatCabinetPulseCount(count)} виконаних у видимому вікні</small>
                </span>
            </button>
        </span>`;
}

function renderCabinetCompletedDayGroup(group = {}, groupIndex = 0) {
    const day = group.day || cabinetCompletedHistoryDayMeta(null);
    const taskRows = Array.isArray(group.tasks) ? group.tasks : [];
    return `
        <span class="cabinet-completed-day-group"
              role="group"
              aria-label="${escapeHtml(`${day.longLabel}: ${formatCabinetPulseCount(taskRows.length)} виконаних задач`)}">
            ${renderCabinetCompletedDayDivider(group, groupIndex)}
            ${taskRows.map(({ task, index }) => renderCabinetCompletedHistoryTile(task, index)).join('')}
        </span>`;
}

function renderCabinetCompletedDayStats(groups = [], overflow = 0) {
    if (!groups.length) return '';
    const stats = groups.map(group => {
        const day = group.day || cabinetCompletedHistoryDayMeta(null);
        const count = group.tasks?.length || 0;
        return `<span class="cabinet-completed-day-stat" title="${escapeHtml(day.longLabel)}"><span>${escapeHtml(day.statLabel)}</span><b>${formatCabinetPulseCount(count)}</b></span>`;
    }).join('');
    const overflowHint = overflow > 0
        ? `<span class="cabinet-completed-day-stat cabinet-completed-day-stat--muted" title="Ще ${formatCabinetPulseCount(overflow)} виконаних задач поза видимим вікном"><span>Поза вікном</span><b>+${formatCabinetPulseCount(overflow)}</b></span>`
        : '';
    return `
        <div class="cabinet-completed-day-stats" aria-label="Статистика закриття за видимими днями">
            <span class="cabinet-completed-day-stats-label">Видимі дні</span>
            ${stats}
            ${overflowHint}
        </div>`;
}

function renderCabinetCompletedHistoryStrip() {
    const history = cabinetCompletedHistoryList();
    const counts = cabinetCompletedHistoryCounts();
    const visible = history.slice(0, CABINET_COMPLETED_HISTORY_VISIBLE_LIMIT);
    const groups = groupCabinetCompletedHistoryByDay(visible);
    const total = Math.max(counts.total, visible.length);
    const overflow = Math.max(counts.overflow, total - visible.length);
    return `
        <section class="cabinet-completed-strip" aria-label="Компактна історія виконаних задач">
            <div class="cabinet-completed-strip-head">
                <div>
                    <span class="cabinet-kicker">Історія закриття</span>
                    <b>${formatCabinetPulseCount(total)}</b>
                </div>
                <small>${visible.length ? `останні ${visible.length} виконаних` : 'ще немає виконаних задач'}</small>
            </div>
            ${visible.length ? `
                <div class="cabinet-completed-history-body">
                <div class="cabinet-completed-track" role="list" aria-label="Останні виконані задачі, згруповані за днем">
                    ${groups.map((group, index) => renderCabinetCompletedDayGroup(group, index)).join('')}
                    ${overflow > 0 ? `<span class="cabinet-completed-overflow" role="listitem" title="Ще ${formatCabinetPulseCount(overflow)} виконаних задач у повній історії">+${formatCabinetPulseCount(overflow)}</span>` : ''}
                </div>
                ${renderCabinetCompletedDayStats(groups, overflow)}
                </div>
            ` : '<div class="cabinet-completed-empty">Коли задача буде виконана, вона зʼявиться тут маленьким маркером з деталями.</div>'}
        </section>`;
}

function normalizedCabinetTaskToken(value, fallback = '') {
    const token = String(value ?? '').trim().toLowerCase();
    return token || fallback;
}

function cabinetTaskMode(task = {}) {
    return normalizedCabinetTaskToken(task.taskMode || task.task_mode || task.mode, 'work');
}

function cabinetTaskKind(task = {}) {
    return normalizedCabinetTaskToken(task.taskKind || task.task_kind || task.kind, 'action');
}

function cabinetTaskWorkflow(task = {}) {
    return normalizedCabinetTaskToken(task.workflowState || task.workflow_state || task.workflow, 'todo');
}

function cabinetTaskVisibility(task = {}) {
    return normalizedCabinetTaskToken(task.visibility, cabinetTaskMode(task) === 'private' ? 'private' : 'team');
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

function cabinetDueDateForPreset(preset = cabinetCreateDuePreset) {
    if (window.TaskCreate?.dateForDuePresetValue) {
        return window.TaskCreate.dateForDuePresetValue(preset, document.getElementById('cabinetTaskDate')?.value || '');
    }
    if (preset === 'no_date') return '';
    const d = new Date();
    if (preset === 'tomorrow') d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function setCabinetDuePreset(preset = 'today') {
    cabinetCreateDuePreset = ['today', 'tomorrow', 'no_date', 'custom'].includes(preset) ? preset : 'today';
    const date = document.getElementById('cabinetTaskDate');
    if (date && cabinetCreateDuePreset !== 'custom') date.value = cabinetDueDateForPreset(cabinetCreateDuePreset);
    document.querySelectorAll('[data-cabinet-due-preset]').forEach(btn => {
        const active = btn.dataset.cabinetDuePreset === cabinetCreateDuePreset;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (cabinetCreateDuePreset === 'custom') setCabinetTaskComposerExpanded(true, { focusDate: true });
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
    document.getElementById('cabinetTaskTitle')?.addEventListener('input', scheduleCabinetDecompositionSuggestions);
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

function syncCabinetPulseCounts(alertsData, funnelData) {
    const alerts = Array.isArray(alertsData?.alerts) ? alertsData.alerts : [];
    const readIds = (() => {
        try { return new Set(JSON.parse(localStorage.getItem('crm_alerts_read_v2') || '[]')); } catch { return new Set(); }
    })();
    const dismissedIds = (() => {
        try { return new Set(JSON.parse(localStorage.getItem('crm_alerts_dismissed') || '[]')); } catch { return new Set(); }
    })();
    const unreadAlerts = alerts.filter(alert => alert?.id && !readIds.has(alert.id) && !dismissedIds.has(alert.id));
    cabinetPulseCounts = {
        alerts: Number(alertsData?.count ?? unreadAlerts.length ?? 0) || 0,
        funnel: Number(funnelData?.count || funnelData?.newCount || funnelData?.total || 0) || 0
    };
}

async function refreshCabinetPulseCounts() {
    const [alertsData, funnelData] = await Promise.all([
        apiGet('/dashboard/alerts'),
        apiGet('/leads/new-count')
    ]);
    syncCabinetPulseCounts(alertsData, funnelData);
}

function formatCabinetPulseCount(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n > 99) return '99+';
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
        scope: quick.scope || 'completed_today_and_active_my_day_or_undated'
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
    if (activeTab === 'mytasks') return 'tasks';
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

function renderCabinetDueBadge(task = {}, taskIdAttr = '', dueState = {}) {
    const label = `${dueState.label || ''}${dueState.detail ? ` · ${dueState.detail}` : ''}`;
    const className = `cabinet-task-due-badge cabinet-task-due-badge--${escapeHtml(dueState.key || 'none')}`;
    if (dueState.key !== 'overdue' || !taskIdAttr) {
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
    const raw = task.scheduledStartAt || task.scheduled_start_at || task.deadline || task.remindAt || task.remind_at || task.date || '';
    const key = String(raw || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

function cabinetTaskDueValue(task = {}) {
    return task.scheduledStartAt
        || task.scheduled_start_at
        || task.schedule?.startAt
        || task.deadline
        || task.remindAt
        || task.remind_at
        || task.date
        || '';
}

function cabinetTaskScheduleStartTime(task = {}) {
    const raw = task.scheduledStartAt || task.scheduled_start_at || task.schedule?.scheduledStartAt || task.schedule?.startAt || '';
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
        isDone: item.is_done === true || item.isDone === true
    };
}

function cachedCabinetSubtasks(taskId, task = {}) {
    const id = Number(taskId);
    if (cabinetSubtaskCache.has(id)) return cabinetSubtaskCache.get(id);
    if (Array.isArray(task.subtasks)) return task.subtasks.map(normalizeCabinetSubtask);
    return null;
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
    Object.keys(myCabinetData).forEach(key => {
        if (!Array.isArray(myCabinetData[key])) return;
        myCabinetData[key] = myCabinetData[key].map(task => {
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
    const label = isExpanded ? 'Згорнути' : 'Розгорнути';
    return `<button type="button" class="cabinet-subtask-toggle" data-cabinet-task-action="subtasks-toggle" data-task-id="${taskIdAttr}" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="cabinetSubtasksPanel${taskIdAttr}" title="${escapeHtml(cabinetSubtaskCompletionTitle(task))}">
        <span>${label}</span>
        <b>Пункти ${summary.done}/${summary.total}</b>
    </button>`;
}

function renderCabinetSubtaskCollapsedSummary(task = {}) {
    const summary = cabinetSubtaskSummary(task);
    if (!summary.total) return '';
    const remaining = Math.max(0, summary.total - summary.done);
    const state = remaining > 0 ? `Залишилось ${remaining}` : 'Усі підпункти закриті';
    return `<div class="cabinet-subtask-compact-summary" aria-label="Короткий стан чекліста">
        <span>Чекліст згорнуто</span>
        <b>${escapeHtml(state)}</b>
    </div>`;
}

function renderCabinetSubtasksPanel(task = {}, taskIdAttr = '', expanded = null) {
    const summary = cabinetSubtaskSummary(task);
    const taskId = Number(taskIdAttr || 0);
    if (!summary.total || !taskId) return '';
    const isExpanded = expanded === null ? isCabinetSubtasksExpanded(taskId, task) : Boolean(expanded);
    const subtasks = cachedCabinetSubtasks(taskId, task);
    let body = '<div class="cabinet-subtask-inline-empty">Розгорніть, щоб закривати підпункти прямо тут.</div>';
    if (isExpanded && loadingCabinetSubtaskIds.has(taskId)) {
        body = '<div class="cabinet-subtask-inline-empty">Завантажую підпункти...</div>';
    } else if (isExpanded && Array.isArray(subtasks)) {
        body = subtasks.length
            ? subtasks.map(item => {
                const subtask = normalizeCabinetSubtask(item);
                return `<label class="cabinet-subtask-inline-item ${subtask.isDone ? 'is-done' : ''}">
                    <input type="checkbox" data-cabinet-subtask-done data-task-id="${taskIdAttr}" data-subtask-id="${escapeHtml(subtask.id)}" ${subtask.isDone ? 'checked' : ''}>
                    <span>${escapeHtml(subtask.title || 'Підпункт без назви')}</span>
                </label>`;
            }).join('')
            : '<div class="cabinet-subtask-inline-empty">Підпункти не знайдені.</div>';
    }
    return `<div id="cabinetSubtasksPanel${taskIdAttr}" class="cabinet-subtask-inline-panel" data-cabinet-subtasks-panel="${taskIdAttr}" ${isExpanded ? '' : 'hidden'}>
        <div class="cabinet-subtask-inline-head">
            <span>Підпункти можна виконувати у будь-якому порядку</span>
            <b>${summary.done}/${summary.total}</b>
        </div>
        <div class="cabinet-subtask-inline-list">${body}</div>
    </div>`;
}

function renderCabinetTaskCard(task, compact = false) {
    const taskId = Number(task.id || task.taskId || task.task_id || 0);
    const taskIdAttr = Number.isInteger(taskId) && taskId > 0 ? String(taskId) : '';
    const due = cabinetTaskDueValue(task);
    const scheduleStatus = task.scheduleStatus || task.schedule_status || task.schedule?.status || '';
    const subSummary = cabinetSubtaskSummary(task);
    const taskStatus = task.status || 'todo';
    const priority = task.priority || 'normal';
    const priorityLabel = { high: 'Високий', critical: 'Критично', low: 'Низький', normal: 'Звичайний' }[priority] || priority;
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
    const subtasksExpanded = isDecomposed && taskIdAttr ? isCabinetSubtasksExpanded(taskId, task) : false;
    const cardClass = [
        'cabinet-task-card',
        isDecomposed ? 'is-decomposed' : '',
        isDecomposed && subtasksExpanded ? 'is-subtasks-expanded' : '',
        isDecomposed && !subtasksExpanded ? 'is-subtasks-collapsed' : ''
    ].filter(Boolean).join(' ');
    return `
        <div class="${cardClass}" data-task-id="${taskIdAttr}" data-task-status="${escapeHtml(taskStatus)}" data-task-due-state="${escapeHtml(dueState.key)}" data-cabinet-task-decomposed="${isDecomposed ? 'true' : 'false'}"${dragAttrs}>
            <div class="cabinet-task-main">
                <div class="cabinet-task-title">${escapeHtml(task.title || 'Без назви')}</div>
                <div class="cabinet-task-meta">
                    ${renderCabinetDueBadge(task, taskIdAttr, dueState)}
                    ${renderCabinetMoveTodayAction(task, taskIdAttr, dueState)}
                    <span class="cabinet-task-priority cabinet-task-priority--${escapeHtml(priority)}">${escapeHtml(priorityLabel)}</span>
                    ${relationLabel ? `<span class="cabinet-task-relation-badge">${escapeHtml(relationLabel)}</span>` : ''}
                    <span>${taskModeLabel(task)}</span>
                    <span>${taskKindLabel(task)}</span>
                    ${scheduleStatus === 'proposal' ? '<span>потрібне підтвердження часу</span>' : ''}
                    ${scheduleStatus === 'missed' ? '<span>слот пропущено</span>' : ''}
                    ${subSummary.total ? `<span>${subSummary.done}/${subSummary.total}</span>` : ''}
                    ${renderCabinetSubtaskToggle(task, taskIdAttr, subtasksExpanded)}
                    ${cabinetTaskReportBadge(task)}
                    ${renderCabinetSubtaskProgress(task)}
                </div>
                ${isDecomposed && !subtasksExpanded ? renderCabinetSubtaskCollapsedSummary(task) : ''}
                ${renderCabinetSubtasksPanel(task, taskIdAttr, subtasksExpanded)}
            </div>
            <div class="cabinet-task-actions">
                <button type="button" class="cabinet-task-action-btn cabinet-task-action-done" title="${escapeHtml(doneTitle)}" aria-label="${escapeHtml(doneActionLabel)}" data-tooltip="${escapeHtml(doneActionLabel)}" data-cabinet-task-action="done" data-task-id="${taskIdAttr}" ${taskIdAttr && !doneBlocked ? '' : 'disabled'}>✓</button>
                ${compact ? '' : `<span class="cabinet-snooze-wrap"><button type="button" class="cabinet-task-action-btn" title="${escapeHtml(snoozeActionLabel)}" aria-label="${escapeHtml(snoozeActionLabel)}" data-tooltip="${escapeHtml(snoozeActionLabel)}" data-cabinet-task-action="snooze-menu" data-task-id="${taskIdAttr}" aria-haspopup="menu" aria-expanded="false" ${taskIdAttr ? '' : 'disabled'}>⏰</button>${renderCabinetSnoozeMenu(taskIdAttr)}</span>`}
                <button type="button" class="cabinet-task-action-btn" title="${escapeHtml(openActionLabel)}" aria-label="${escapeHtml(openActionLabel)}" data-tooltip="${escapeHtml(openActionLabel)}" data-cabinet-task-action="open" data-task-id="${taskIdAttr}" ${taskIdAttr ? '' : 'disabled'}>↗</button>
            </div>
        </div>`;
}

function renderCabinetSection(title, list, emptyText, compact = false, options = {}) {
    const visibleList = sortCabinetTasksForDisplay(list);
    const dropTarget = options.dropTarget ? String(options.dropTarget) : '';
    const dropAttrs = dropTarget
        ? ` data-cabinet-task-drop-target="${escapeHtml(dropTarget)}" aria-label="${escapeHtml(options.dropLabel || 'Перетягніть задачу сюди')}"`
        : '';
    const sectionClass = `cabinet-task-section${dropTarget ? ' cabinet-task-section--drop-target' : ''}`;
    const dropHint = dropTarget
        ? `<span class="cabinet-section-drop-hint">${escapeHtml(options.dropHint || 'Можна перетягнути задачу сюди')}</span>`
        : '';
    return `
        <section class="${sectionClass}"${dropAttrs}>
            <div class="cabinet-section-head">
                <h3>${escapeHtml(title)}</h3>
                <div class="cabinet-section-head-meta">
                    ${dropHint}
                    <span>${visibleList.length}</span>
                </div>
            </div>
            ${visibleList.length
                ? visibleList.map(task => renderCabinetTaskCard(task, compact)).join('')
                : `<div class="cabinet-empty">${escapeHtml(emptyText)}</div>`}
        </section>`;
}

function renderCabinetTaskComposer(options = {}) {
    const segment = options.segment || myTasksSegment || 'all';
    const defaults = cabinetCreateDefaultsForSegment(segment, options.mode || '');
    const expanded = Boolean(cabinetTaskComposerExpanded);
    const dateValue = window.TaskCreate?.dateForDuePresetValue
        ? window.TaskCreate.dateForDuePresetValue(cabinetCreateDuePreset, '')
        : cabinetDueDateForPreset(cabinetCreateDuePreset);
    const categories = CABINET_TASK_CATEGORIES.map(([value, label]) =>
        `<option value="${value}" ${defaults.category === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');
    const duePresets = [
        ['today', 'Сьогодні'],
        ['tomorrow', 'Завтра'],
        ['no_date', 'Без дати'],
        ['custom', 'Інша дата']
    ].map(([value, label]) => `
        <button type="button" class="cabinet-due-chip ${cabinetCreateDuePreset === value ? 'active' : ''}" data-cabinet-due-preset="${value}" aria-pressed="${cabinetCreateDuePreset === value ? 'true' : 'false'}">${escapeHtml(label)}</button>
    `).join('');

    return `
        <form class="cabinet-capture cabinet-task-composer ${expanded ? 'is-expanded' : 'is-collapsed'}" id="cabinetTaskComposer" data-source-surface="profile_${escapeHtml(activeTab)}" data-cabinet-composer-state="${expanded ? 'expanded' : 'collapsed'}" onsubmit="createCabinetTask(event, '${escapeHtml(options.mode || '')}')">
            <div class="cabinet-task-composer-head">
                <div>
                    <span class="cabinet-kicker">Нова задача</span>
                    <h3>Додати в мій робочий простір</h3>
                </div>
                <div class="cabinet-task-composer-actions">
                    <button type="button" class="cabinet-task-composer-toggle" data-cabinet-composer-toggle aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="cabinetTaskComposerAdvanced">${expanded ? 'Згорнути' : 'Більше параметрів'}</button>
                    <button type="submit" class="cabinet-task-create-submit">Створити задачу</button>
                </div>
            </div>
            <div class="cabinet-task-composer-main">
                <label class="cabinet-task-title-field" for="cabinetTaskTitle">
                    <span>Назва</span>
                    <input id="cabinetTaskTitle" autocomplete="off" placeholder="${escapeHtml(defaults.placeholder)}">
                </label>
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
            <div class="cabinet-task-composer-meta">
                <div class="cabinet-task-composer-essential">
                    <div class="cabinet-due-presets" role="group" aria-label="Коли виконати">${duePresets}</div>
                    <span class="cabinet-task-composer-hint">Швидко створіть задачу або відкрийте параметри для підзадач, типу й видимості.</span>
                </div>
                <div class="cabinet-task-composer-meta-advanced" data-cabinet-composer-advanced aria-hidden="${expanded ? 'false' : 'true'}" ${expanded ? '' : 'hidden'}>
                    <label for="cabinetTaskDate">
                        <span>Дата</span>
                        <input id="cabinetTaskDate" type="date" value="${escapeHtml(dateValue)}">
                    </label>
                    <label for="cabinetTaskPriority">
                        <span>Пріоритет</span>
                        <select id="cabinetTaskPriority">
                            <option value="normal">Звичайний</option>
                            <option value="high">Високий</option>
                            <option value="low">Низький</option>
                        </select>
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
                        <option value="ai">AI чернетка</option>
                        <option value="template_ai">Шаблон + AI</option>
                    </select>
                    <select id="cabinetDecompositionTemplate" aria-label="Шаблон декомпозиції">
                        <option value="personal_home">Побут / особисте</option>
                        <option value="event_preparation">Підготовка події</option>
                        <option value="content_creation">Контент</option>
                        <option value="crm_sales_followup">CRM / продаж</option>
                    </select>
                    <button type="button" id="cabinetSubtaskDraftBtn" class="cabinet-subtask-add">AI</button>
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

function renderMyDayTab() {
    const today = cabinetList('today');
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
            ${renderCabinetCompletedHistoryStrip()}
            ${renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' })}
            <div class="cabinet-grid">
                ${renderCabinetSection('Сьогодні', today, 'На сьогодні немає активних задач.', false, {
                    dropTarget: 'today',
                    dropHint: 'Киньте сюди прострочену задачу',
                    dropLabel: 'Сьогодні: перетягніть сюди прострочену задачу, щоб перенести її на сьогодні'
                })}
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

function renderMyTasksTab() {
    const all = cabinetList('all');
    const counts = cabinetSegmentCounts(all);
    const activeSegment = cabinetSegmentConfig(myTasksSegment);
    const filtered = sortCabinetTasksForDisplay(all.filter(task => cabinetTaskMatchesSegment(task, myTasksSegment)));
    return `
        <div class="cabinet-shell cabinet-shell--mytasks">
            <div class="cabinet-toolbar cabinet-toolbar--tasker">
                <div>
                    <div class="cabinet-kicker">Особиста проекція</div>
                    <h2>Мої задачі</h2>
                    <p>Фільтрований список ваших задач із основного task engine: статуси, підзадачі, дедлайни і переходи без денного cockpit-шуму.</p>
                </div>
                <div class="cabinet-toolbar-actions">
                    <button type="button" class="cabinet-link-btn cabinet-link-btn--secondary" onclick="switchTab('myday')">Додати в Мій день</button>
                    <a href="/tasks?view=my" class="cabinet-link-btn">Повний список задач</a>
                </div>
            </div>
            <div class="cabinet-segments">
                ${CABINET_TASK_SEGMENTS.map(segment => `
                    <button type="button" class="${myTasksSegment === segment.id ? 'active' : ''}" onclick="setMyTasksSegment('${segment.id}')" aria-pressed="${myTasksSegment === segment.id ? 'true' : 'false'}" title="${escapeHtml(segment.hint)}">
                        <span>${escapeHtml(segment.label)}</span>
                        <b>${counts[segment.id] || 0}</b>
                    </button>
                `).join('')}
            </div>
            <div class="cabinet-list" data-cabinet-active-segment="${escapeHtml(myTasksSegment)}">
                <div class="cabinet-list-head">
                    <div>
                        <h3>${escapeHtml(activeSegment.label)}</h3>
                        <p>${escapeHtml(activeSegment.hint)}</p>
                    </div>
                    <span>${filtered.length} / ${all.length}</span>
                </div>
                ${filtered.length ? filtered.map(task => renderCabinetTaskCard(task)).join('') : `<div class="cabinet-empty">У сегменті "${escapeHtml(activeSegment.label)}" поки немає задач.</div>`}
            </div>
        </div>`;
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
    if (!tabContent || !['myday', 'mytasks'].includes(activeTab)) return;
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
    undoBtn?.addEventListener('click', async () => {
        undoBtn.disabled = true;
        try {
            await setCabinetTaskStatus(taskId, normalizeCabinetRestoreStatus(restoreStatus), { silent: true, allowUndo: false });
            if (typeof showNotification === 'function') showNotification('Задачу повернуто', 'success');
            toast.remove();
        } catch (error) {
            undoBtn.disabled = false;
            if (typeof showNotification === 'function') showNotification(error?.message || 'Не вдалося скасувати виконання', 'error');
        }
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    cabinetUndoToastTimer = setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => toast.remove(), 240);
    }, 6000);
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

    if (action === 'snooze-menu') {
        toggleCabinetSnoozeMenu(button);
        return;
    }

    if (action === 'reschedule-overdue-menu') {
        toggleCabinetRescheduleMenu(button);
        return;
    }

    if (action === 'open') {
        window.location.href = `/tasks?view=my&open=${encodeURIComponent(taskId)}`;
        return;
    }

    if (action === 'subtasks-toggle') {
        await toggleCabinetTaskSubtasks(taskId);
        return;
    }

    if (action === 'move-to-today') {
        button.disabled = true;
        button.classList.add('is-busy');
        const card = button.closest('.cabinet-task-card');
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

    const card = button.closest('.cabinet-task-card');
    const previousStatus = normalizeCabinetRestoreStatus(card?.dataset?.taskStatus || 'todo');
    if (action === 'done') {
        const task = findCabinetTask(taskId) || {};
        if (cabinetTaskCompletionBlockedBySubtasks(task)) {
            expandedCabinetSubtaskIds.add(Number(taskId));
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
            await setCabinetTaskStatus(taskId, 'done', { previousStatus, task: findCabinetTask(taskId) || {} });
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
            await rescheduleCabinetTask(taskId, button.dataset.rescheduleOption || 'tomorrow');
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

async function refreshMyCabinetTab() {
    myCabinetData = await apiGet('/tasks/my-cabinet');
    await refreshCabinetPulseCounts();
    const tabContent = document.getElementById('tabContent');
    if (tabContent && (activeTab === 'myday' || activeTab === 'mytasks')) {
        tabContent.innerHTML = renderTabContent();
        attachProfileListeners();
    }
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
    } else if (typeof apiQuickTaskStatus === 'function') {
        result = await apiQuickTaskStatus(id, status);
    } else {
        result = await apiPatch(`/auth/tasks/${id}/quick-status`, { status });
    }
    if (!result?.success) throw new Error(result?.error || 'Task status update failed');
    notifyTaskWidgetsChanged({ action: 'task_status', taskId: id, status });
    if (!options.silent && status === 'done' && options.allowUndo !== false) {
        showCabinetTaskUndoToast(id, options.previousStatus || 'todo');
    } else if (!options.silent && typeof showNotification === 'function') {
        showNotification(status === 'done' ? 'Задачу виконано' : 'Статус задачі оновлено', 'success');
    }
    await refreshMyCabinetTab();
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
    if (!dateText) return;
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
    await refreshMyCabinetTab();
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

async function createCabinetTask(event, mode) {
    event.preventDefault();
    const input = document.getElementById('cabinetTaskTitle');
    const title = String(input?.value || '').trim();
    if (!title) {
        input?.focus();
        if (typeof showNotification === 'function') showNotification('Заповніть назву задачі', 'error');
        return;
    }
    const kind = document.getElementById('cabinetTaskKind')?.value || 'action';
    const selectedMode = mode || document.getElementById('cabinetTaskMode')?.value || cabinetCreateDefaultsForSegment(myTasksSegment).mode;
    const selectedDate = document.getElementById('cabinetTaskDate')?.value || '';
    const current = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    const draft = {
        title,
        ownerUserId: current.id || current.user_id,
        category: document.getElementById('cabinetTaskCategory')?.value || cabinetCreateDefaultsForSegment(myTasksSegment, selectedMode).category,
        priority: document.getElementById('cabinetTaskPriority')?.value || 'normal',
        taskType: 'human',
        mode: selectedMode,
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
        subtasks: readCabinetSubtasks(),
        reportRequired: document.getElementById('cabinetTaskReportRequired')?.checked === true,
        allowReschedule: document.getElementById('cabinetTaskAllowReschedule')?.checked !== false,
        captureIntent: { waiting: kind === 'waiting' }
    };
    const payload = window.TaskCreate?.buildPayload
        ? window.TaskCreate.buildPayload(draft, { sourceModule: 'profile_my_cabinet', sourceSurface: 'profile_my_cabinet', scheduleSlot: 'morning' })
        : {
            title,
            ownerUserId: draft.ownerUserId,
            category: draft.category,
            priority: draft.priority,
            task_mode: draft.mode,
            task_kind: draft.kind,
            visibility: draft.visibility,
            workflow_state: draft.workflowState,
            date: selectedDate || new Date().toISOString().slice(0, 10),
            schedule: { date: selectedDate || new Date().toISOString().slice(0, 10), slot: 'morning', durationMinutes: 30 },
            effort_minutes: 30,
            source_type: 'manual',
            source_module: 'profile_my_cabinet',
            subtasks: draft.subtasks,
            allowReschedule: draft.allowReschedule,
            controlMeta: {
                canReschedule: draft.allowReschedule,
                allowReschedule: draft.allowReschedule
            }
        };
    const result = window.TaskCreate?.createTask
        ? await window.TaskCreate.createTask(payload, {
            onDuplicate: err => {
                if (typeof showNotification === 'function') showNotification(err.message || 'Активний дубль не створено', 'warning');
            }
        })
        : await apiPost('/tasks', payload);
    if (!result?.success) {
        if (!result?.duplicate && typeof showNotification === 'function') {
            showNotification(result?.error || 'Не вдалося створити задачу', 'error');
        }
        return;
    }
    lastCabinetCreatedTaskId = normalizeCabinetTaskId(result.task?.id || result.taskId || result.id) || lastCabinetCreatedTaskId;
    if (input) input.value = '';
    const subtaskList = document.getElementById('cabinetSubtaskList');
    if (subtaskList) subtaskList.innerHTML = '';
    cabinetDecompositionSuggestions = [];
    lastCabinetSuggestionKey = '';
    renderCabinetDecompositionSuggestions();
    setCabinetSubtaskDraftStatus('');
    document.getElementById('cabinetSubtaskAcceptDraftBtn')?.setAttribute('hidden', '');
    setCabinetDecompositionMode('none', { keepRows: true, keepStatus: true });
    cabinetTaskComposerExpanded = false;
    if (typeof showNotification === 'function') showNotification('Задачу створено в основних задачах', 'success');
    await refreshMyCabinetTab();
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

function attachProfileListeners() {
    if (!cabinetSnoozeOutsideBound) {
        cabinetSnoozeOutsideBound = true;
        document.addEventListener('click', event => {
            if (!event.target.closest('.cabinet-task-actions, .cabinet-reschedule-wrap')) closeCabinetSnoozeMenus();
            if (!event.target.closest('.profile-cockpit-widget')) closeProfileWidgetTooltips();
            if (!event.target.closest('.profile-working-role-wrap')) closeProfileWorkingRolePanel();
            if (!event.target.closest('.cabinet-completed-day-divider')) closeCabinetCompletedDayDividers();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeCabinetSnoozeMenus();
            if (event.key === 'Escape') closeProfileWidgetTooltips();
            if (event.key === 'Escape') closeProfileWorkingRolePanel();
            if (event.key === 'Escape') closeCabinetCompletedDayDividers();
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

    document.querySelectorAll('[data-cabinet-completed-day-divider]').forEach(button => {
        if (button.dataset.cabinetCompletedDayBound === 'true') return;
        button.dataset.cabinetCompletedDayBound = 'true';
        button.addEventListener('click', event => {
            event.stopPropagation();
            const divider = button.closest('.cabinet-completed-day-divider');
            const open = !divider?.classList.contains('is-open');
            closeCabinetCompletedDayDividers(open ? divider : null);
            divider?.classList.toggle('is-open', open);
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    });

    document.querySelectorAll('[data-cabinet-task-action]').forEach(button => {
        if (button.dataset.cabinetActionBound === 'true') return;
        button.dataset.cabinetActionBound = 'true';
        button.addEventListener('click', handleCabinetTaskActionClick);
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
        button.addEventListener('click', () => setCabinetDuePreset(button.dataset.cabinetDuePreset));
    });
    const cabinetDate = document.getElementById('cabinetTaskDate');
    if (cabinetDate && cabinetDate.dataset.cabinetDateBound !== 'true') {
        cabinetDate.dataset.cabinetDateBound = 'true';
        cabinetDate.addEventListener('change', () => setCabinetDuePreset('custom'));
    }
    document.querySelectorAll('[data-cabinet-composer-toggle]').forEach(button => {
        if (button.dataset.cabinetComposerToggleBound === 'true') return;
        button.dataset.cabinetComposerToggleBound = 'true';
        button.addEventListener('click', () => setCabinetTaskComposerExpanded(!cabinetTaskComposerExpanded, { focusTitle: !cabinetTaskComposerExpanded }));
    });
    bindCabinetTaskDragDrop();
    bindCabinetSubtasks();

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
    window.addEventListener('workingRoleChanged', () => {
        if (profileData && isOwnProfile) renderProfile();
    });
    window.addEventListener('rolePreviewChanged', () => {
        if (profileData && isOwnProfile) renderProfile();
    });
}

document.addEventListener('DOMContentLoaded', initProfilePage);
